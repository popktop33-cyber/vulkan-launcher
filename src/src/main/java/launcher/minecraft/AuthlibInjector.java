package launcher.minecraft;

import launcher.LauncherConfig;
import launcher.skin.AuthlibServer;
import launcher.skin.GameSkinCache;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;

/**
 * authlib-injector — javaagent, который подменяет у игрового клиента адреса
 * серверов авторизации и сессии.
 *
 * Зачем. Аккаунт ely.by лаунчер отдаёт игре как legacy: ник верный, токена нет.
 * В таком виде клиент идёт за текстурами на sessionserver.mojang.com — и не
 * получает ничего. Скин игрока лежит не там, а на ely.by, и в логе игры это
 * видно прямым текстом:
 *
 *     Environment: sessionHost=https://sessionserver.mojang.com, …
 *     Failed to load texture for profile … Connection timed out
 *
 * Поэтому в одиночной игре и на любом сервере игрок видел Стива, сколько бы
 * скинов ни нанадевал в лаунчере.
 *
 * С агентом клиент спрашивает ely.by — он пишет об этом сам:
 * «Authentication server: https://ely.by». Токен при этом не нужен: профиль с
 * текстурами отдаётся по одному UUID —
 *
 *     GET https://authserver.ely.by/api/authlib-injector/sessionserver/session/minecraft/profile/<uuid>?unsigned=false
 *     → 200, подписанный профиль (проверено и с «Authorization: Bearer 0»,
 *       и вовсе без заголовка — ответ одинаковый)
 *
 * Именно поэтому офлайн-запуск перестаёт быть помехой. Требуется только
 * настоящий UUID с ely.by: по офлайн-значению тот же адрес отвечает 204, то
 * есть «нет такого игрока» (см. ElybyProfile и AccountStore).
 *
 * Файл кладём в папку данных, а не внутрь сборки: агент один на все версии и не
 * должен теряться при пересборке установщика. Версия прибита гвоздями вместе с
 * размером и SHA-1 — качать по изменяемому адресу и запускать что придёт было
 * бы слишком щедро.
 *
 * Подключать агент можно только после проверки serverReachable(): если ely.by
 * недоступен, агент не оставляет игру без скинов, а не даёт ей запуститься
 * вовсе — разбор в самом методе.
 *
 * Впрочем, до ely.by дело доходит только когда своего кэша ещё нет. Обычный
 * путь теперь другой: агенту указывается сервер авторизации самого лаунчера
 * (AuthlibServer), и игра берёт профиль и текстуры с диска. Тогда сети не нужно
 * ни при запуске, ни потом — скин виден и без интернета.
 */
public final class AuthlibInjector {

    /** Версия агента. Менять только вместе с SIZE и SHA1 ниже. */
    private static final String VERSION = "1.2.8";
    private static final String URL =
        "https://github.com/yushijinhun/authlib-injector/releases/download/v" + VERSION
        + "/authlib-injector-" + VERSION + ".jar";
    private static final long SIZE = 349681L;
    private static final String SHA1 = "0e0e66d8a4f91a26f33b9c09f5cdffce4a11f0b8";

    /** Имя, которое агент сам разворачивает в адрес ely.by. */
    private static final String SERVER = "ely.by";

    /** Адрес, по которому агент берёт настройки ely.by при старте. */
    private static final String METADATA = "https://authserver.ely.by/api/authlib-injector";

    private static final String UA = "vulkan-launcher/2.0";
    private static final int TIMEOUT = 20000;

    /** Сколько ждём ely.by перед запуском игры. Короче: это задержка старта. */
    private static final int PROBE_TIMEOUT = 5000;
    private static final int MAX_REDIRECTS = 5;

    /**
     * Агент подставляет имя сервера в --versionType, и в главном меню версия
     * выглядит как «1.21.11-ely.by». Это не версия игры, а метка самого агента —
     * гасим: показывать игроку нечего, а больше флаг ни на что не влияет.
     */
    private static final String NO_SERVER_NAME = "-Dauthlibinjector.noShowServerName";

    private AuthlibInjector() {}

    /** Аргумент JVM для уже проверенного файла: идём на настоящий ely.by. */
    public static String agentArg(Path jar) {
        return agentArg(jar, SERVER);
    }

    /** Тот же аргумент, но с указанием, где агенту брать сервер авторизации. */
    public static String agentArg(Path jar, String target) {
        return "-javaagent:" + jar.toAbsolutePath() + "=" + target;
    }

    /**
     * Аргументы для запуска игры. Пустой список — подключать агент нельзя.
     *
     * Порядок здесь такой. Сначала свой сервер: если профиль с картинкой уже
     * лежит на диске, игре не нужен ни ely.by, ни интернет вообще — метаданные
     * агент забирает у нас, а значит, и погасить JVM из-за недоступного ely.by
     * ему не на чем (разбор в serverReachable). Своего кэша нет — идём на
     * ely.by прежним путём, но только убедившись, что он отвечает.
     *
     * Сам агент всё равно нужен: он и подменяет клиенту сервер авторизации.
     * Файл берётся из папки данных, то есть со второго запуска сеть ему не
     * нужна вовсе.
     */
    public static List<String> argsFor(String uuid, String nick) {
        boolean local = AuthlibServer.ready() && GameSkinCache.refresh(uuid, nick);
        if (!local && !serverReachable()) return List.of();

        Path jar = ensure();
        if (jar == null) return List.of();
        String target = local ? AuthlibServer.apiRoot() : SERVER;
        return List.of(agentArg(jar, target), NO_SERVER_NAME);
    }

    /**
     * Отвечает ли ely.by прямо сейчас.
     *
     * Проверка обязательна, и вот почему. Если сервер недоступен, authlib-injector
     * не просто оставляет игру без скинов — он гасит JVM с кодом 1 ещё до main,
     * и игра не запускается совсем. Проверено дважды: на закрытом порту
     * (ConnectException) и на несуществующем домене (SSLHandshakeException) —
     * в обоих случаях процесс кончается, не дойдя до кода игры.
     *
     * Отсюда правило: не смогли дозвониться — идём без агента. Скин не покажется,
     * зато игрок попадёт в игру. Обратный размен несоизмерим.
     */
    public static boolean serverReachable() {
        String target = METADATA;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) URI.create(target).toURL().openConnection();
                c.setConnectTimeout(PROBE_TIMEOUT);
                c.setReadTimeout(PROBE_TIMEOUT);
                c.setRequestProperty("User-Agent", UA);
                c.setInstanceFollowRedirects(false);
                int code = c.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) return false;
                    target = URI.create(target).resolve(loc).toString();
                    continue;
                }
                // Тело не читаем: нужен только факт ответа, а настройки агент
                // заберёт себе сам, когда стартует.
                return code >= 200 && code < 400;
            } catch (Exception e) {
                System.out.println("[authlib] ely.by не отвечает (" + e.getMessage()
                        + ") — запускаем без агента, скин не подгрузится");
                return false;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return false;
    }

    /**
     * Путь к проверенному агенту, либо null, если достать его не удалось.
     *
     * null — не повод не запускать игру: без агента она работает как раньше,
     * просто со Стивом. Ронять запуск из-за скина нельзя.
     */
    public static Path ensure() {
        Path jar = LauncherConfig.dataDir().resolve("authlib-injector-" + VERSION + ".jar");
        if (isValid(jar)) return jar;

        Path tmp = jar.resolveSibling(jar.getFileName() + ".part");
        try {
            byte[] b = fetch(URL);
            if (b == null) {
                System.out.println("[authlib] агент не скачался: " + URL);
                return null;
            }
            // Сверяем и размер, и сумму: обрывок загрузки по размеру может и
            // совпасть, а вот подменённый файл не должен попасть в JVM.
            if (b.length != SIZE || !SHA1.equalsIgnoreCase(sha1(b))) {
                System.out.println("[authlib] файл не сошёлся по контрольной сумме — не беру");
                return null;
            }
            Files.createDirectories(jar.getParent());
            Files.write(tmp, b);
            Files.move(tmp, jar, StandardCopyOption.REPLACE_EXISTING);
            System.out.println("[authlib] агент готов: " + jar);
            return jar;
        } catch (Exception e) {
            System.out.println("[authlib] не положил агент: " + e.getMessage());
            try { Files.deleteIfExists(tmp); } catch (Exception ignored) { }
            return null;
        }
    }

    /** Годен ли уже лежащий файл. */
    private static boolean isValid(Path jar) {
        try {
            if (!Files.isRegularFile(jar) || Files.size(jar) != SIZE) return false;
            return SHA1.equalsIgnoreCase(sha1(Files.readAllBytes(jar)));
        } catch (Exception e) {
            return false;
        }
    }

    private static String sha1(byte[] b) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-1").digest(b);
        StringBuilder s = new StringBuilder(d.length * 2);
        for (byte x : d) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    /**
     * Тело ответа либо null. Редиректы разбираются вручную: GitHub уводит
     * загрузку на release-assets.githubusercontent.com, и полагаться на то, что
     * HttpURLConnection пройдёт эту цепочку сам, не стоит.
     */
    private static byte[] fetch(String url) {
        String target = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) URI.create(target).toURL().openConnection();
                c.setConnectTimeout(TIMEOUT);
                c.setReadTimeout(TIMEOUT);
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
}
