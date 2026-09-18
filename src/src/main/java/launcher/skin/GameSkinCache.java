package launcher.skin;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import launcher.LauncherConfig;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Base64;

/**
 * Профиль и текстуры игрока ely.by, сложенные на диск, — то, из чего лаунчер
 * кормит игру, когда интернета нет.
 *
 * Зачем это вообще. Агент authlib-injector ходит за профилем и текстурой на
 * ely.by при каждом запуске. Пока сеть есть, всё хорошо; без сети игра
 * оставалась со Стивом, потому что брать текстуру было неоткуда — ни профиля,
 * ни картинки на диске не лежало. Здесь они и лежат: профиль как есть (ответ
 * ely.by целиком) и обе картинки — скин и плащ.
 *
 * Картинку берём из кэша лаунчера по нику (SkinService), а не из ссылки внутри
 * профиля. Причина конкретная: файл по ссылке отстаёт — после того как игрок
 * надел новый скин, старый отдаётся ещё минутами (разбор в SkinService.adopt).
 * То, что лаунчер показывает в витрине, уже свежее, и логично, чтобы игра
 * показывала ровно то же. Ссылка из профиля остаётся запасным путём — на
 * случай, когда по нику в кэше пусто.
 *
 * Профиль перезапрашивается при каждом запуске, и это важно: в нём лежат ник и
 * признак slim-модели, а он в самой картинке не зашит — по ней не отличить slim
 * от classic. Не дозвонились — отдаём вчерашний: он ничем не хуже, а запуск
 * из-за него тормозить не должен.
 */
public final class GameSkinCache {

    /**
     * Виды текстур — так, как их называет протокол: клиент присылает в профиле
     * именно SKIN и CAPE. Имена файлов на диске — отдельные константы, потому
     * что путать их нельзя: разойдись они, и на месте плаща оказался бы скин
     * (уже случалось ровно так).
     */
    public static final String SKIN = "SKIN";
    public static final String CAPE = "CAPE";
    public static final String PROFILE = "profile.json";
    private static final String SKIN_FILE = "skin.png";
    private static final String CAPE_FILE = "cape.png";

    /** Профиль спрашиваем по UUID с корнем authlib: без него ely.by отвечает 404. */
    private static final String PROFILE_API =
        "https://authserver.ely.by/api/authlib-injector/sessionserver/session/minecraft/profile/";

    private static final String UA = "vulkan-launcher/2.0";
    private static final int PROFILE_TIMEOUT = 5000;
    private static final int TEXTURE_TIMEOUT = 8000;

    private GameSkinCache() {}

    /**
     * Папка кэша игрока. UUID приходит из аккаунта, но идёт в путь к файлу —
     * поэтому сначала проверяется на формат, иначе «..» в поле аккаунта выписало
     * бы файл куда угодно.
     */
    public static Path dir(String uuid) {
        String key = key(uuid);
        return key == null ? null : LauncherConfig.dataDir().resolve("authlib").resolve(key);
    }

    /** Файл профиля на диске либо null. */
    public static Path profileFile(String uuid) {
        Path dir = dir(uuid);
        return dir == null ? null : dir.resolve(PROFILE);
    }

    /** Готов ли кэш отдать игре профиль с картинкой. */
    public static boolean ready(String uuid) {
        Path dir = dir(uuid);
        return dir != null
                && Files.isRegularFile(dir.resolve(PROFILE))
                && Files.isRegularFile(dir.resolve(SKIN_FILE));
    }

    /** Файл картинки на диске либо null. kind — SKIN или CAPE. */
    public static Path texture(String uuid, String kind) {
        Path dir = dir(uuid);
        if (dir == null) return null;
        Path p = dir.resolve(CAPE.equals(kind) ? CAPE_FILE : SKIN_FILE);
        return Files.isRegularFile(p) ? p : null;
    }

    /**
     * Обновить кэш: сходить за профилем и убедиться, что картинки на месте.
     *
     * true — кэш готов, игру можно вести на свой сервер. false — отдавать
     * нечего, пусть агент идёт на ely.by обычным путём.
     */
    public static synchronized boolean refresh(String uuid, String nick) {
        Path dir = dir(uuid);
        if (dir == null) return false;

        Path profile = dir.resolve(PROFILE);
        byte[] fresh = fetch(PROFILE_API + key(uuid) + "?unsigned=false", PROFILE_TIMEOUT);
        try {
            Files.createDirectories(dir);
            if (fresh != null && isProfile(fresh)) write(profile, fresh);
        } catch (Exception e) {
            System.out.println("[authlib] кэш профиля не лёг: " + e.getMessage());
        }
        // Профиля нет ни свежего, ни вчерашнего — рассказывать игре нечего
        if (!Files.isRegularFile(profile)) return false;

        Path skin = dir.resolve(SKIN_FILE);
        if (!Files.isRegularFile(skin)) {
            // Своего файла нет вовсе — тут поход в сеть уместен, иначе показывать
            // будет нечего. SkinService сам решит, спрашивать Mojang или ely.by.
            Path fetched = nick == null || nick.isBlank() ? null : SkinService.skin(nick);
            if (fetched != null) copy(fetched, skin);
            else download(textureUrl(profile, SKIN), skin);
        } else if (newer(uiFile(nick, ".png"), skin)) {
            // Файл витрины свежее нашего — значит, игрок надел скин уже после
            // прошлого запуска. Забираем его, и без единого запроса в сеть:
            // mtime свежее ровно тогда, когда SkinService.adopt записал новую
            // картинку. Именно из-за этого сравнения игра показывает тот же
            // скин, что и лаунчер, а не тот, что ely.by отдаёт по нику с
            // задержкой в минуты.
            copy(uiFile(nick, ".png"), skin);
        }

        Path cape = dir.resolve(CAPE_FILE);
        if (!Files.isRegularFile(cape)) {
            Path fetched = nick == null || nick.isBlank() ? null : SkinService.cape(nick);
            if (fetched != null) copy(fetched, cape);
            else download(textureUrl(profile, CAPE), cape);
        } else if (newer(uiFile(nick, ".cape.png"), cape)) {
            copy(uiFile(nick, ".cape.png"), cape);
        }

        return Files.isRegularFile(skin);
    }

    /** Файл в кэше витрины лаунчера. Только путь: никаких запросов в сеть. */
    private static Path uiFile(String nick, String suffix) {
        if (nick == null || nick.isBlank() || !SkinService.validNick(nick)) return null;
        return SkinService.skinsDir().resolve(nick.toLowerCase() + suffix);
    }

    private static boolean newer(Path candidate, Path than) {
        try {
            return candidate != null && Files.isRegularFile(candidate)
                    && Files.getLastModifiedTime(candidate).compareTo(
                       Files.getLastModifiedTime(than)) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Ссылка на текстуру внутри профиля — запасной источник картинки. */
    public static String textureUrl(Path profile, String kind) {
        try {
            JsonObject o = JsonParser.parseString(
                    Files.readString(profile, StandardCharsets.UTF_8)).getAsJsonObject();
            for (JsonElement el : o.getAsJsonArray("properties")) {
                JsonObject prop = el.getAsJsonObject();
                if (!"textures".equals(prop.get("name").getAsString())) continue;
                JsonObject tex = JsonParser.parseString(new String(
                        Base64.getDecoder().decode(prop.get("value").getAsString()),
                        StandardCharsets.UTF_8)).getAsJsonObject();
                JsonObject textures = tex.getAsJsonObject("textures");
                if (textures == null || !textures.has(kind)) return null;
                return textures.getAsJsonObject(kind).get("url").getAsString();
            }
        } catch (Exception e) {
            // Битую ссылку в профиле видеть не страшно: ниже её просто не будет
        }
        return null;
    }

    /** Ответ ely.by выглядит как профиль, а не как страница ошибки. */
    private static boolean isProfile(byte[] body) {
        try {
            JsonObject o = JsonParser.parseString(new String(body, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            return o.has("id") && o.has("properties");
        } catch (Exception e) {
            return false;
        }
    }

    private static void copy(Path from, Path to) {
        try {
            Files.createDirectories(to.getParent());
            Path tmp = to.resolveSibling(to.getFileName() + ".part");
            Files.copy(from, tmp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(tmp, to, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            System.out.println("[authlib] картинка не скопировалась: " + e.getMessage());
        }
    }

    private static void download(String url, Path to) {
        if (url == null) return;
        byte[] b = fetch(url, TEXTURE_TIMEOUT);
        if (b == null || !isPng(b)) return;   // не PNG — лучше пусто, чем битый файл
        write(to, b);
    }

    /**
     * Пишем через временный файл: игру могут запускать как раз в этот момент, и
     * наполовину записанный скин — это битая картинка на экране.
     */
    private static void write(Path to, byte[] b) {
        try {
            Files.createDirectories(to.getParent());
            Path tmp = to.resolveSibling(to.getFileName() + ".part");
            Files.write(tmp, b);
            Files.move(tmp, to, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            System.out.println("[authlib] не записал " + to.getFileName() + ": " + e.getMessage());
        }
    }

    /** PNG начинается с сигнатуры — по ней и отсекаем страницы ошибок. */
    private static boolean isPng(byte[] b) {
        return b != null && b.length >= 8 && b[0] == (byte) 0x89 && b[1] == 'P';
    }

    /**
     * Тело ответа либо null. Редиректы разбираем вручную — ely.by уводит часть
     * ссылок на другой хост, и полагаться на то, что HttpURLConnection пройдёт
     * цепочку сам, не стоит (та же причина, что в SkinService).
     */
    private static byte[] fetch(String url, int timeout) {
        if (url == null) return null;
        String target = url;
        for (int hop = 0; hop <= 5; hop++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) URI.create(target).toURL().openConnection();
                c.setConnectTimeout(timeout);
                c.setReadTimeout(timeout);
                c.setRequestProperty("User-Agent", UA);
                c.setInstanceFollowRedirects(false);
                int code = c.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) return null;
                    target = URI.create(target).resolve(loc).toString();
                    continue;
                }
                if (code != 200) return null;
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    in.transferTo(out);
                    return out.toByteArray();
                }
            } catch (Exception e) {
                return null;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return null;
    }

    /** UUID без дефисов в нижнем регистре, либо null если это не UUID. */
    public static String key(String uuid) {
        if (uuid == null) return null;
        String s = uuid.replace("-", "").trim().toLowerCase();
        return s.matches("[0-9a-f]{32}") ? s : null;
    }
}
