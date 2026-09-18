package launcher.skin;

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
 * Скин и плащ игрока по никнейму — без входа в аккаунт.
 *
 * Первым идёт Mojang: только он отдаёт и правильный скин, и плащ. mc-heads и
 * minotar сигнала «ник не найден» не дают вовсе — на несуществующий ник они
 * возвращают дефолтного Стива с кодом 200 (проверено: файл байт в байт совпадает
 * с ответом на заведомо мусорный ник). Поэтому их спрашиваем только когда
 * предыдущие упали с ошибкой, и никогда — когда те честно ответили «нет такого»:
 * иначе вместо дефолтного Стива приедет чужой скин, а это хуже, потому что
 * снаружи неотличимо от правильного.
 *
 * Второй источник — ely.by: это другая система аккаунтов, ника у Mojang может
 * не быть, а на ely.by он есть. Чистый «нет» у Mojang — не повод остановиться.
 */
public final class SkinService {

    private SkinService() {}

    private static final long TTL_HIT  = 24 * 60 * 60 * 1000L;  // скин есть — сутки
    private static final long TTL_MISS = 60 * 60 * 1000L;       // скина нет — час
    private static final int  TIMEOUT  = 8000;
    private static final int  MAX_REDIRECTS = 5;

    /**
     * Выставляется, когда источник упал с ошибкой (сеть, 5xx), и НЕ выставляется
     * на чистый промах (404/204). Только по нему решается, звать ли запасные.
     *
     * resolve() объявлен synchronized, поэтому флаг не бывает нужен двум потокам
     * разом — но пишет его http(), а читает lookup(), так что сбрасывается он в
     * начале lookup(), а не в http().
     */
    private static boolean networkFailed = false;

    /** Что нашлось. Пустой skinUrl означает «ник не зарегистрирован нигде». */
    private static final class Found {
        String uuid = "", skinUrl = "", capeUrl = "", source = "";
        boolean isEmpty() { return skinUrl.isEmpty(); }
    }

    public static Path skinsDir() {
        return LauncherConfig.dataDir().resolve("skins");
    }

    /** Файл скина на диске, либо null если скина нет. */
    public static Path skin(String nick) { return resolve(nick, false); }

    /** Файл плаща на диске, либо null если плаща нет. */
    public static Path cape(String nick) { return resolve(nick, true); }

    /**
     * Ник идёт в имя файла кэша, поэтому пропускаем только буквы, цифры и
     * подчёркивание. Без этой проверки через «../» в URL можно выписать файл
     * за пределы папки кэша.
     */
    public static boolean validNick(String nick) {
        return nick != null && nick.matches("[A-Za-z0-9_]{1,16}");
    }

    /**
     * Забыть всё, что мы знаем о нике: скин, плащ и запись кэша.
     *
     * Нужен после того, как игрок сменил скин на сайте ely.by или Mojang: без
     * этого сутки отдавался бы старый файл. Отрицательный кэш ещё коварнее —
     * он живёт час, и всё это время только что загруженный скин не появился бы
     * вовсе, причём выглядело бы это как «фича не работает».
     *
     * Ошибки удаления глотаем: файла может не быть, и это не повод падать.
     */
    public static synchronized void forget(String nick) {
        if (!validNick(nick)) return;
        String key = nick.toLowerCase();
        Path dir = skinsDir();
        for (String name : new String[]{ key + ".png", key + ".cape.png", key + ".meta.json" }) {
            try {
                Files.deleteIfExists(dir.resolve(name));
            } catch (Exception e) {
                System.out.println("[skin] не удалил " + name + ": " + e.getMessage());
            }
        }
    }

    /**
     * Записать нику скин, который игрок только что надел на ely.by.
     *
     * Почему не просто перечитать. Файл https://skinsystem.ely.by/skins/<ник>.png
     * обновляется с задержкой: проверено живьём — учётка приняла новый скин сразу
     * (сайт показал его в ту же секунду), а файл по нику отдавал прежний скин ещё
     * шесть минут. Перечитав сразу после надевания, мы запомнили бы ПРЕЖНИЙ скин
     * на сутки, и снаружи это снова выглядело бы как «надел, а не поменялось».
     *
     * Поэтому берём не файл по нику, а ту самую картинку, которую игрок выбрал:
     * хеш — это её содержимое, и она уже лежит в кэше витрины, её показывали в
     * сетке. Копируем её нику со свежей отметкой времени, чтобы дальше скин жил
     * обычным порядком: сутки, потом перечитается с ely.by (к тому времени файл
     * по нику догонит).
     *
     * false — картинки нет. Тогда вызывающий перечитает как обычно, и хуже, чем
     * было, не станет.
     */
    public static synchronized boolean adopt(String nick, String hash) {
        if (!validNick(nick)) return false;
        Path src = ElybyCatalog.preview(hash);
        if (src == null || !Files.exists(src)) return false;
        try {
            Path dir = skinsDir();
            Files.createDirectories(dir);
            String key = nick.toLowerCase();
            Path plain = dir.resolve(key + ".png");
            Path cape  = dir.resolve(key + ".cape.png");
            // Через временный файл: Стив в диораме может читать этот же путь
            // прямо сейчас, а наполовину записанный скин — это битая картинка
            Path tmp = plain.resolveSibling(key + "-" + Thread.currentThread().getId() + ".part");
            Files.copy(src, tmp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(tmp, plain, StandardCopyOption.REPLACE_EXISTING);

            Found f = new Found();
            f.source  = "ely.by";
            f.skinUrl = "https://skinsystem.ely.by/skins/" + nick + ".png";
            // Плащ надевание скина не меняет, поэтому упоминаем его только если
            // он и правда лежит на диске: иначе запись обещала бы то, чего нет
            f.capeUrl = Files.exists(cape)
                    ? "https://skinsystem.ely.by/cloaks/" + nick + ".png" : "";
            writeMeta(dir.resolve(key + ".meta.json"), f);
            return true;
        } catch (Exception e) {
            System.out.println("[skin] не записал надетый скин " + nick + ": " + e.getMessage());
            return false;
        }
    }

    private static synchronized Path resolve(String nick, boolean wantCape) {
        if (!validNick(nick)) return null;
        Path dir = skinsDir();
        // Windows не различает регистр — «Steve» и «steve» одна папка
        String key = nick.toLowerCase();
        Path png  = dir.resolve(key + (wantCape ? ".cape.png" : ".png"));
        Path meta = dir.resolve(key + ".meta.json");

        long age = ageOf(meta);
        if (Files.exists(png) && age >= 0 && age < TTL_HIT)   return png;
        // Отрицательный кэш: ник, которого нет нигде, иначе переспрашивался бы
        // на каждом запуске
        if (!Files.exists(png) && age >= 0 && age < TTL_MISS) return null;

        Found found;
        try {
            found = lookup(nick);
        } catch (Exception e) {
            // Сеть отвалилась — отдаём то, что уже лежит, вместо пустоты
            return Files.exists(png) ? png : null;
        }

        try {
            Files.createDirectories(dir);
            Path plain = dir.resolve(key + ".png");
            Path cape  = dir.resolve(key + ".cape.png");
            if (!found.skinUrl.isEmpty()) download(found.skinUrl, plain);
            else Files.deleteIfExists(plain);
            if (!found.capeUrl.isEmpty()) download(found.capeUrl, cape);
            else Files.deleteIfExists(cape);

            // Запись пишем ПОСЛЕ загрузки и по тому, что реально легло на диск.
            // Раньше она писалась до неё, и это было хуже ошибки в логе: не
            // дозвонившись до ely.by, мы всё равно отмечали «скин есть, свежий».
            // Дальше запись жила сутки, и всё это время игрок видел прежний скин
            // по кнопке «Обновить» — то есть выглядело как «скин не меняется».
            // Теперь незавершённая загрузка не оставляет следа: файл на диске
            // по-прежнему отдаётся (лучше старый, чем ничего), но срок ему не
            // продлевается, и следующий запрос сходит в сеть заново.
            if (!networkFailed && !found.skinUrl.isEmpty() && Files.exists(plain)) {
                Found onDisk = new Found();
                onDisk.uuid    = found.uuid;
                onDisk.source  = found.source;
                onDisk.skinUrl = found.skinUrl;
                // Плащ мог и не скачаться — тогда и в записи его быть не должно
                onDisk.capeUrl = Files.exists(cape) ? found.capeUrl : "";
                writeMeta(meta, onDisk);
            } else if (found.skinUrl.isEmpty()) {
                writeMeta(meta, found);   // чистый промах: ник нигде не значится
            }
        } catch (Exception e) {
            System.out.println("[skin] не сохранил " + nick + ": " + e.getMessage());
        }
        return Files.exists(png) ? png : null;
    }

    /** Возраст записи в миллисекундах, либо -1 если её нет или она протухла. */
    private static long ageOf(Path meta) {
        if (!Files.exists(meta)) return -1;
        try {
            JsonObject o = JsonParser.parseString(
                    Files.readString(meta, StandardCharsets.UTF_8)).getAsJsonObject();
            boolean hit = o.has("skinUrl") && !o.get("skinUrl").getAsString().isEmpty();
            long at  = o.get("fetchedAt").getAsLong();
            long age = System.currentTimeMillis() - at;
            return age < (hit ? TTL_HIT : TTL_MISS) ? age : -1;
        } catch (Exception e) {
            return -1;   // битая запись — считаем, что её нет
        }
    }

    private static void writeMeta(Path meta, Found f) throws Exception {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", f.uuid);
        o.addProperty("skinUrl", f.skinUrl);
        o.addProperty("capeUrl", f.capeUrl);
        o.addProperty("source", f.source);
        o.addProperty("fetchedAt", System.currentTimeMillis());
        Files.writeString(meta, o.toString(), StandardCharsets.UTF_8);
    }

    /**
     * Проход по источникам.
     *
     * Порядок принципиален: Mojang и ely.by — разные системы аккаунтов, поэтому
     * чистый промах у первого не повод останавливаться. Запасные подключаются
     * только когда что-то упало: они не умеют говорить «нет такого».
     *
     * http() не бросает исключений — он возвращает null и сам поднимает
     * networkFailed, поэтому try/catch здесь не нужен.
     */
    private static Found lookup(String nick) {
        networkFailed = false;

        String uuid = mojangUuid(nick);
        if (uuid != null) {
            Found f = mojangTextures(uuid);
            if (f != null) return f;
        }

        // ely.by — вторая система аккаунтов. Проверено живьём: он резолвит и
        // часть имён Mojang тоже (в батче из 98 имён нашлись Notch и jeb_), так
        // что 200 здесь не значит «аккаунт именно на ely.by». Для нас это
        // безразлично: Mojang идёт первым, и сюда мы попадаем только когда он
        // имени не знает.
        if (elybyHas(nick)) {
            Found f = new Found();
            f.source  = "ely.by";
            f.skinUrl = "https://skinsystem.ely.by/skins/" + nick + ".png";
            f.capeUrl = "https://skinsystem.ely.by/cloaks/" + nick + ".png";
            return f;
        }

        // Запасные — только при сетевой беде. Плаща у них нет, и «нет такого
        // ника» они сказать не умеют: на любой мусор отдают дефолтного Стива
        // с кодом 200.
        if (networkFailed) {
            Found f = new Found();
            f.source  = "mc-heads";
            f.skinUrl = "https://mc-heads.net/skin/" + nick;
            return f;
        }

        return new Found();   // нигде не зарегистрирован
    }

    /** 204 = такого ника на ely.by нет. Это чистый промах, а не ошибка. */
    private static boolean elybyHas(String nick) {
        return http("https://authserver.ely.by/api/users/profiles/minecraft/" + nick) != null;
    }

    private static String mojangUuid(String nick) {
        byte[] b = http("https://api.mojang.com/users/profiles/minecraft/" + nick);
        if (b == null) return null;      // 404 — ник не занят, networkFailed не трогаем
        try {
            return JsonParser.parseString(new String(b, StandardCharsets.UTF_8))
                             .getAsJsonObject().get("id").getAsString();
        } catch (Exception e) {
            return null;
        }
    }

    private static Found mojangTextures(String uuid) {
        byte[] b = http("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid);
        if (b == null) return null;
        try {
            JsonObject o = JsonParser.parseString(
                    new String(b, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!o.has("properties")) return null;
            String b64 = null;
            for (var p : o.getAsJsonArray("properties")) {
                JsonObject prop = p.getAsJsonObject();
                if ("textures".equals(prop.get("name").getAsString())) {
                    b64 = prop.get("value").getAsString();
                }
            }
            if (b64 == null) return null;
            JsonObject t = JsonParser.parseString(
                    new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8))
                    .getAsJsonObject();
            if (!t.has("textures")) return null;
            JsonObject tex = t.getAsJsonObject("textures");
            Found f = new Found();
            f.uuid   = uuid;
            f.source = "mojang";
            // В ответе ссылки идут по http, но https на том же хосте отвечает
            if (tex.has("SKIN")) f.skinUrl = tex.getAsJsonObject("SKIN").get("url").getAsString();
            if (tex.has("CAPE")) f.capeUrl = tex.getAsJsonObject("CAPE").get("url").getAsString();
            return f.isEmpty() ? null : f;
        } catch (Exception e) {
            return null;
        }
    }

    private static void download(String url, Path to) throws Exception {
        byte[] b = http(url);
        // Пришёл не PNG — лучше пусто, чем битый файл на диске
        if (b == null || b.length < 8 || b[0] != (byte) 0x89 || b[1] != 'P') {
            Files.deleteIfExists(to);
            return;
        }
        Files.createDirectories(to.getParent());
        Files.write(to, b);
    }

    /**
     * Тело ответа, либо null.
     *
     * null означает и «чистый промах» (404/204), и «источник недоступен» —
     * различает их только флаг networkFailed. Исключений не бросает намеренно:
     * вызывающий код тогда читается линейно, без try вокруг каждого запроса.
     *
     * Редиректы разбираются вручную. Причина конкретная:
     * skinsystem.ely.by уводит на http-адрес textures.minecraft.net, а
     * HttpURLConnection из соображений безопасности отказывается понижать схему
     * с https на http — и молча возвращает 301 с HTML внутри. curl -L за таким
     * редиректом идёт, поэтому на стенде баг не виден, а в лаунчере у всего
     * ely.by скин тихо не скачивался бы.
     */
    private static byte[] http(String url) {
        String target = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) URI.create(target).toURL().openConnection();
                c.setConnectTimeout(TIMEOUT);
                c.setReadTimeout(TIMEOUT);
                // Без своего User-Agent ely.by и Mojang отвечают по-разному
                c.setRequestProperty("User-Agent", "vulkan-launcher/2.0");
                c.setInstanceFollowRedirects(false);
                int code = c.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) { networkFailed = true; return null; }
                    target = upgradeScheme(URI.create(target).resolve(loc).toString());
                    continue;
                }
                if (code == 204 || code == 404) return null;    // чистый промах
                if (code >= 400) { networkFailed = true; return null; }
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    in.transferTo(out);
                    return out.toByteArray();
                }
            } catch (Exception e) {
                networkFailed = true;
                return null;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        networkFailed = true;   // редиректы зациклились
        return null;
    }

    /** textures.minecraft.net отдаёт то же самое и по https — берём его. */
    private static String upgradeScheme(String url) {
        return url.startsWith("http://") ? "https://" + url.substring(7) : url;
    }
}
