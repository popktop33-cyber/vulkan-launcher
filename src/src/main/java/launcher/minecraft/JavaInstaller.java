package launcher.minecraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import launcher.LauncherConfig;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Java под конкретную версию игры: откуда взять и куда положить.
 *
 * Зачем это нужно. Одной Java на все версии не хватает, и разница не в
 * «новее — значит лучше»: у каждой версии игры в version-JSON записано своё
 * требование, и оно не минимум, а именно та версия, на которой её проверяли.
 *
 *   1.8 — 1.16.5   Java 8    jre-legacy
 *   1.17 — 1.20.x  Java 17   java-runtime-gamma
 *   1.21.x         Java 21   java-runtime-delta
 *   26.1 и новее   Java 25   java-runtime-epsilon
 *
 * Проверка «версия не меньше требуемой» здесь не годится, и это не придирка:
 * для 1.16.5 она пропускает Java 17 (17 больше 8), а игра на ней не идёт.
 * Поэтому берём ровно тот компонент, что назван в version-JSON.
 *
 * Откуда берём. У Mojang есть манифест с готовыми сборками JRE под каждую
 * платформу — те же самые, что качает официальный лаунчер, со ссылками и
 * контрольными суммами. Если компонента для нашей платформы там нет (так
 * бывает на 32-битной Windows: Java 21 и 25 для неё не выпускают вовсе),
 * идём в Adoptium за ближайшей подходящей.
 *
 * Где храним. Скачанное лежит один раз в папке лаунчера, а в сборку кладётся
 * копией: сборку можно удалить, не задев соседние, и игра всегда идёт на своей
 * Java — той, что осталась в её папке, даже если систему потом почистили.
 */
public final class JavaInstaller {

    /** Манифест всех сборок Java: платформа → компонент → список версий. */
    private static final String ALL_URL =
        "https://piston-meta.mojang.com/v1/products/java-runtime/"
        + "2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

    private static final String ADOPTIUM =
        "https://api.adoptium.net/v3/binary/latest/%d/ga/windows/%s/jre/hotspot/normal/eclipse";

    private static final String UA = "vulkan-launcher/1.1";

    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(30))
        .build();

    /** Сколько файлов тянем разом. Mojang не любит жадных — восемь уже много. */
    private static final int PARALLEL = 8;

    private JavaInstaller() {}

    /**
     * Java для этой версии игры — в папке сборки. Скачивает, если её там нет.
     *
     * component и majorVersion берутся из version-JSON игры. Если component
     * пустой, подбираем по majorVersion.
     */
    public static Path ensure(String mcVersion, String loaderId,
                              String component, int majorVersion) throws Exception {
        Path inInstance = LauncherConfig.instanceDir(mcVersion, loaderId).resolve("java");
        Path exe = exeIn(inInstance);
        if (exe != null) return exe;                 // уже стоит — ничего не делаем

        String arch = archTag();
        String comp = component == null || component.isBlank()
            ? componentFor(majorVersion) : component;

        LaunchProgress.update("java", 2, "Готовим Java " + majorVersion + " для этой сборки...");

        Path cache = download(comp, majorVersion, arch);
        copyTree(cache, inInstance);

        Path ready = exeIn(inInstance);
        if (ready == null) {
            throw new IOException("Java скачалась, но не запустилась: " + inInstance);
        }
        return ready;
    }

    /** Путь к javaw.exe внутри папки Java, либо null, если её там нет. */
    public static Path exeIn(Path javaHome) {
        for (String name : new String[]{"javaw.exe", "java.exe"}) {
            Path p = javaHome.resolve("bin").resolve(name);
            if (Files.isRegularFile(p)) return p;
        }
        return null;
    }

    /** Компонент Mojang по старшей версии Java — когда version-JSON его не назвал. */
    public static String componentFor(int major) {
        if (major <= 8)  return "jre-legacy";
        if (major <= 16) return "java-runtime-alpha";
        if (major <= 17) return "java-runtime-gamma";
        if (major <= 21) return "java-runtime-delta";
        return "java-runtime-epsilon";
    }

    /**
     * Тег платформы в манифесте Mojang.
     *
     * Разрядность берём у самой JVM, а не у системы: лаунчер может быть
     * 32-битным на 64-битной Windows, и тогда скачанная 64-битная Java просто
     * не запустится — её нельзя ни запустить, ни даже проверить версию.
     */
    private static String archTag() {
        String arch = System.getProperty("os.arch", "").toLowerCase(Locale.ROOT);
        boolean sixtyFour = System.getProperty("sun.arch.data.model", "64").contains("64");
        if (arch.contains("aarch64") || arch.contains("arm64")) {
            return sixtyFour ? "windows-arm64" : "windows-x86";
        }
        return sixtyFour ? "windows-x64" : "windows-x86";
    }

    /** Скачать компонент в кэш лаунчера и вернуть папку с ним. */
    private static Path download(String component, int majorVersion, String arch) throws Exception {
        Path cache = LauncherConfig.dataDir().resolve("java").resolve(component + "-" + arch);
        Path exe = exeIn(cache);
        if (exe != null) return cache;               // уже скачано раньше

        try {
            Path manifest = componentManifest(component, arch);
            if (manifest != null) {
                unpackFromMojang(manifest, cache);
                return cache;
            }
            System.out.println("[java] компонента " + component + " нет для " + arch
                + " — беру Adoptium");
        } catch (Exception e) {
            System.out.println("[java] манифест Mojang не отдал " + component
                + " (" + e.getMessage() + ") — беру Adoptium");
        }
        unpackFromAdoptium(cache, majorVersion, arch);
        return cache;
    }

    /** Ссылка на манифест файлов компонента, либо null, если его нет для платформы. */
    private static Path componentManifest(String component, String arch) throws Exception {
        Path cached = LauncherConfig.dataDir().resolve("java").resolve("all.json");
        String body = readCached(cached, ALL_URL);
        JsonObject all = JsonParser.parseString(body).getAsJsonObject();
        JsonObject platform = all.getAsJsonObject(arch);
        if (platform == null || !platform.has(component)) return null;

        JsonArray builds = platform.getAsJsonArray(component);
        if (builds.isEmpty()) return null;
        String url = builds.get(0).getAsJsonObject()
            .getAsJsonObject("manifest").get("url").getAsString();

        Path manifest = LauncherConfig.dataDir().resolve("java")
            .resolve(component + "-" + arch + ".json");
        String mbody = readCached(manifest, url);
        Files.createDirectories(manifest.getParent());
        Files.writeString(manifest, mbody);
        return manifest;
    }

    /**
     * Файл из кэша, если он там есть, иначе скачиваем.
     *
     * Манифест версий Java меняется раз в несколько месяцев, а тянется он на
     * каждый запуск новой версии игры: держим его на диске, чтобы не ходить
     * в сеть дважды за один и тот же ответ.
     */
    private static String readCached(Path file, String url) throws Exception {
        if (Files.isRegularFile(file) && Files.size(file) > 100) {
            return Files.readString(file);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("User-Agent", UA)
            .timeout(Duration.ofMinutes(2))
            .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new IOException("HTTP " + resp.statusCode() + " для " + url);
        }
        Files.createDirectories(file.getParent());
        Files.writeString(file, resp.body());
        return resp.body();
    }

    /**
     * Разложить файлы JRE по путям из манифеста.
     *
     * У каждой записи-файла в манифесте есть downloads.raw — обычная ссылка;
     * lzma-вариант нам не нужен (проверено: raw есть у всех 402 файлов).
     * Каталоги идут отдельными записями без downloads и просто создаются.
     */
    private static void unpackFromMojang(Path manifest, Path target) throws Exception {
        JsonObject files = JsonParser.parseString(Files.readString(manifest))
            .getAsJsonObject().getAsJsonObject("files");

        List<Map.Entry<String, JsonElement>> real = new ArrayList<>();
        for (Map.Entry<String, JsonElement> e : files.entrySet()) {
            JsonObject f = e.getValue().getAsJsonObject();
            if ("directory".equals(f.has("type") ? f.get("type").getAsString() : "file")) {
                Files.createDirectories(target.resolve(e.getKey()));
            } else if (f.has("downloads") && f.getAsJsonObject("downloads").has("raw")) {
                real.add(e);
            }
        }

        AtomicInteger done = new AtomicInteger();
        int total = real.size();
        ExecutorService pool = Executors.newFixedThreadPool(PARALLEL);
        try {
            List<Future<?>> tasks = new ArrayList<>();
            for (Map.Entry<String, JsonElement> e : real) {
                tasks.add(pool.submit(() -> {
                    try {
                        JsonObject raw = e.getValue().getAsJsonObject()
                            .getAsJsonObject("downloads").getAsJsonObject("raw");
                        Path dest = target.resolve(e.getKey());
                        fetchVerified(raw.get("url").getAsString(), dest,
                                      raw.get("sha1").getAsString());
                        int n = done.incrementAndGet();
                        if (n % 40 == 0 || n == total) {
                            LaunchProgress.update("java", 2 + n * 60 / Math.max(total, 1),
                                "Java: " + n + " из " + total + " файлов");
                        }
                    } catch (Exception ex) {
                        throw new RuntimeException(ex);
                    }
                }));
            }
            for (Future<?> t : tasks) t.get(15, TimeUnit.MINUTES);
        } finally {
            pool.shutdownNow();
        }
    }

    /** Запасной источник: одиночный архив Adoptium, когда у Mojang нет компонента. */
    private static void unpackFromAdoptium(Path cache, int major, String arch) throws Exception {
        // У Adoptium своя разметка разрядности: x64 для 64-бит, x32 для 32-бит.
        // Для Windows на ARM сборок нет вовсе — честно скажем об этом.
        if (arch.contains("arm")) {
            throw new IOException("Для Windows на ARM подходящей Java " + major
                + " нет ни у Mojang, ни у Adoptium");
        }
        String a = arch.endsWith("x64") ? "x64" : "x32";
        String url = String.format(Locale.ROOT, ADOPTIUM, major, a);
        LaunchProgress.update("java", 5, "Качаю Java " + major + "...");

        Path zip = cache.getParent().resolve("jre-" + major + "-" + a + ".zip");
        fetchVerified(url, zip, null);

        Files.createDirectories(cache);
        try (var zf = new java.util.zip.ZipFile(zip.toFile())) {
            var entries = zf.entries();
            String top = null;
            while (entries.hasMoreElements()) {
                String n = entries.nextElement().getName();
                int slash = n.indexOf('/');
                if (slash > 0) { top = n.substring(0, slash + 1); break; }
            }
            if (top == null) throw new IOException("Пустой архив Java: " + zip);
            entries = zf.entries();
            while (entries.hasMoreElements()) {
                var e = entries.nextElement();
                String n = e.getName();
                if (!n.startsWith(top) || e.isDirectory()) continue;
                Path out = cache.resolve(n.substring(top.length()));
                Files.createDirectories(out.getParent());
                try (InputStream in = zf.getInputStream(e)) {
                    Files.copy(in, out, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
        Files.deleteIfExists(zip);
    }

    /**
     * Скачать файл и проверить контрольную сумму.
     *
     * Проверка обязательна: файлы JRE качаются сотнями и параллельно, а
     * оборванная загрузка оставляет усечённый файл, который потом молча
     * считается готовым — и Java не запускается без внятной причины.
     * Пишем во временный файл и переименовываем, чтобы обрыва не осталось.
     */
    private static void fetchVerified(String url, Path dest, String sha1) throws Exception {
        if (Files.isRegularFile(dest) && (sha1 == null || sha1.equals(sha1Of(dest)))) return;
        Files.createDirectories(dest.getParent());
        Path tmp = dest.resolveSibling(dest.getFileName() + ".part");

        Exception last = null;
        for (int attempt = 1; attempt <= 4; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("User-Agent", UA)
                    .timeout(Duration.ofMinutes(5))
                    .build();
                HttpResponse<InputStream> resp =
                    HTTP.send(req, HttpResponse.BodyHandlers.ofInputStream());
                if (resp.statusCode() != 200) {
                    throw new IOException("HTTP " + resp.statusCode() + " для " + url);
                }
                try (InputStream in = resp.body()) {
                    Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
                }
                if (sha1 != null && !sha1.equals(sha1Of(tmp))) {
                    throw new IOException("Сумма не сошлась: " + dest.getFileName());
                }
                Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING);
                return;
            } catch (Exception e) {
                last = e;
                Files.deleteIfExists(tmp);
                if (attempt < 4) Thread.sleep(300L * attempt);
            }
        }
        throw last != null ? last : new IOException("Не скачалось: " + url);
    }

    private static String sha1Of(Path file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buf = new byte[1 << 16];
            int r;
            while ((r = in.read(buf)) > 0) md.update(buf, 0, r);
        }
        return HexFormat.of().formatHex(md.digest());
    }

    /** Скопировать дерево Java в папку сборки. */
    private static void copyTree(Path from, Path to) throws Exception {
        if (Files.exists(to)) deleteTree(to);
        try (var walk = Files.walk(from)) {
            for (Path src : walk.toList()) {
                Path dst = to.resolve(from.relativize(src).toString());
                if (Files.isDirectory(src)) Files.createDirectories(dst);
                else {
                    Files.createDirectories(dst.getParent());
                    Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    private static void deleteTree(Path root) throws Exception {
        try (var walk = Files.walk(root)) {
            for (Path p : walk.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        }
    }
}
