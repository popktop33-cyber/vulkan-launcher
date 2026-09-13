package launcher.minecraft;

import launcher.LauncherConfig;
import launcher.auth.Session;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import com.google.gson.*;

public class MinecraftLauncher {

    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL).build();
    private static final Gson GSON = new Gson();
    private static final String MC_MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
    private static final String FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader/";
    private static final String QUILT_META  = "https://meta.quiltmc.org/v3/versions/loader/";

    // ── Public entry point ──────────────────────────────────────────────────

    public static void launch(String mcVersion, String mode, String loaderId) throws Exception {
        // Fabric and Quilt are pure library loaders — they install fully from their
        // own meta APIs and run through the main (vanilla) path below. Forge/NeoForge
        // need their official installer to patch the client, so they go through the
        // self-installing generic launcher. Nothing here depends on TLauncher.
        String family = loaderFamily(loaderId);
        if (family != null && !family.equals("vanilla") && !family.equals("fabric") && !family.equals("quilt")) {
            launchModpackLoader(mcVersion, mode, loaderId, family);
            return;
        }

        LauncherConfig cfg = LauncherConfig.get();

        // Папка сборки: mods, saves, config — у каждой версии с загрузчиком свои,
        // и запущенная сборка берётся из аргументов, а не из настроек: запускают
        // именно то, что выбрано в окне, даже если настройки ещё не сохранены.
        Path profileDir = LauncherConfig.instanceDir(mcVersion, loaderId);
        Files.createDirectories(profileDir);
        Files.createDirectories(profileDir.resolve("mods"));

        /*
         * Everything lives inside the launcher's own data dir — self-contained:
         *   %APPDATA%/pulsePLUS/game/versions/<ver>/<ver>.json|jar
         *   %APPDATA%/pulsePLUS/game/{libraries,assets}
         *
         * Именно game/, а не cache/: у оболочки лаунчера там же лежит профиль
         * Chromium, а его Cache она чистит при каждом старте окна. Windows не
         * различает регистр — «cache» и «Cache» одна папка, и скачанное
         * пропадало после каждого перезапуска.
         */
        Path tlVersionsDir = LauncherConfig.tlVersionsDir();

        // ── 1. Fetch Minecraft version JSON (into TLauncher versions folder) ─
        LaunchProgress.update("version", 4, "Получение версии " + mcVersion + "...");
        Path versionDir  = tlVersionsDir.resolve(mcVersion);
        Path versionJson = versionDir.resolve(mcVersion + ".json");
        Files.createDirectories(versionDir);
        if (!Files.exists(versionJson)) {
            System.out.println("[pulsePLUS] Fetching Minecraft version manifest...");
            String versionUrl = resolveMinecraftVersionUrl(mcVersion);
            download(versionUrl, versionJson);
        }
        JsonObject meta = GSON.fromJson(Files.readString(versionJson), JsonObject.class);

        // ── 2. Download vanilla client JAR (into TLauncher versions folder) ──
        String jarField = meta.has("jar") ? meta.get("jar").getAsString() : mcVersion;
        Path jarVersionDir = jarField.equals(mcVersion) ? versionDir : tlVersionsDir.resolve(jarField);
        Path clientJar     = jarVersionDir.resolve(jarField + ".jar");
        Files.createDirectories(jarVersionDir);
        if (!Files.exists(clientJar)) {
            LaunchProgress.update("client", 8, "Загрузка клиента Minecraft " + jarField + "...");
            System.out.println("[pulsePLUS] Downloading Minecraft " + jarField + " client...");
            String jarUrl = meta.getAsJsonObject("downloads").getAsJsonObject("client").get("url").getAsString();
            download(jarUrl, clientJar);
        }

        // ── 3. Download ALL libraries (both types) ──────────────────────────
        LaunchProgress.update("libraries", 12, "Загрузка библиотек...");
        Path libsDir = LauncherConfig.librariesDir();
        List<Path> classpath = new ArrayList<>();
        downloadAllLibraries(meta.getAsJsonArray("libraries"), libsDir, classpath);

        // ── 4. Apply Fabric / Quilt loader if requested ─────────────────────
        String mainClass = meta.get("mainClass").getAsString();
        String fabricBuild = null;
        if (loaderId != null && loaderId.startsWith("fabric:")) {
            fabricBuild = parseFabricBuild(loaderId);
            // Auto-update: use the newest loader build when enabled (they're backward-compatible)
            if (cfg.autoUpdateMods) fabricBuild = latestMetaLoaderBuild(FABRIC_META, mcVersion, fabricBuild);
            LaunchProgress.update("fabric", 44, "Установка Fabric " + fabricBuild + "...");
            String fabricMain = applyMetaLoader(FABRIC_META, mcVersion, fabricBuild, libsDir, classpath,
                "Fabric", "fabric", tlVersionsDir);
            if (fabricMain != null) mainClass = fabricMain;
        } else if (loaderId != null && loaderId.startsWith("quilt:")) {
            fabricBuild = parseFabricBuild(loaderId);   // same "family:build@mc" format
            if (cfg.autoUpdateMods) fabricBuild = latestMetaLoaderBuild(QUILT_META, mcVersion, fabricBuild);
            LaunchProgress.update("quilt", 44, "Установка Quilt " + fabricBuild + "...");
            String quiltMain = applyMetaLoader(QUILT_META, mcVersion, fabricBuild, libsDir, classpath,
                "Quilt", "quilt", tlVersionsDir);
            if (quiltMain != null) mainClass = quiltMain;
        }

        // Client JAR goes last in classpath
        classpath.add(clientJar);

        // ── 5. Extract natives ──────────────────────────────────────────────
        LaunchProgress.update("natives", 50, "Распаковка нативных библиотек...");
        Path nativesDir = jarVersionDir.resolve("natives");
        extractNatives(classpath, nativesDir);

        // ── 6. Download assets ──────────────────────────────────────────────
        Path assetsDir = LauncherConfig.assetsDir();
        String assetIndexId = meta.getAsJsonObject("assetIndex").get("id").getAsString();
        String assetIndexUrl = meta.getAsJsonObject("assetIndex").get("url").getAsString();
        downloadAllAssets(assetIndexUrl, assetIndexId, assetsDir);

        // ── 7. Build and run launch command ─────────────────────────────────
        // Аккаунт решает, что подставить: офлайн-ник или настоящие данные Microsoft.
        Session session = Session.forActive(cfg);
        String username = session.name;
        String nativesPath = nativesDir.toAbsolutePath().toString();
        String cp = buildClasspath(classpath);
        String launcherBrand = "vulkan";
        String launcherVersion = "1.0";

        List<String> cmd = new ArrayList<>();
        cmd.add(findJava(cfg));
        // Флаги Aikar: без них G1 даёт рывки на ровном месте (см. JvmFlags)
        cmd.addAll(JvmFlags.aikar(cfg.ramMb));
        cmd.add("-Djava.library.path=" + nativesPath);
        cmd.add("-Djna.tmpdir=" + nativesPath);
        cmd.add("-Dorg.lwjgl.system.SharedLibraryExtractPath=" + nativesPath);
        cmd.add("-Dio.netty.native.workdir=" + nativesPath);
        cmd.add("-Dminecraft.launcher.brand=" + launcherBrand);
        cmd.add("-Dminecraft.launcher.version=" + launcherVersion);
        if (fabricBuild != null) {
            cmd.add("-DFabricMcEmu= net.minecraft.client.main.Main ");
        }
        // Log4j config if available
        Path log4jConfig = versionDir.resolve("log4j2.xml");
        if (Files.exists(log4jConfig)) {
            cmd.add("-Dlog4j.configurationFile=" + log4jConfig.toAbsolutePath());
        }
        cmd.add("-cp");
        cmd.add(cp);
        cmd.add(mainClass);

        // Game args
        cmd.addAll(Arrays.asList(
            "--username",    username,
            "--version",     mcVersion,
            "--gameDir",     profileDir.toAbsolutePath().toString(),
            "--assetsDir",   assetsDir.toAbsolutePath().toString(),
            "--assetIndex",  assetIndexId,
            "--uuid",        session.uuid,
            "--accessToken", session.accessToken,
            "--clientId",    session.userType.equals("msa") ? cfg.msaClientId : "",
            "--xuid",        session.xuid,
            "--userType",    session.userType,
            "--versionType", "release"
        ));

        // IMPORTANT: do NOT use inheritIO(). When the backend is spawned by Electron
        // with piped stdio, the Minecraft child would inherit that pipe; if Electron
        // drains it slowly (or not at all in a packaged windowless app), the 64 KB OS
        // pipe buffer fills and Minecraft blocks on write() — the process "just hangs".
        // Redirect the game's output to its own log file so it never blocks.
        Path logsDir = LauncherConfig.logsDir();
        Files.createDirectories(logsDir);
        Path gameLog = logsDir.resolve("minecraft-" + profileDir.getFileName() + ".log");

        LaunchProgress.update("starting", 97, "Запуск игры...");
        System.out.println("[pulsePLUS] Launching " + mcVersion
            + (fabricBuild != null ? " + Fabric " + fabricBuild : " vanilla")
            + " → " + profileDir + " (log: " + gameLog + ")");
        new ProcessBuilder(cmd)
            .directory(profileDir.toFile())
            .redirectErrorStream(true)                              // merge stderr into stdout
            .redirectOutput(ProcessBuilder.Redirect.to(gameLog.toFile()))
            .start();
        LaunchProgress.running("Игра запущена");
    }

    // Backward-compat overload
    public static void launch(String version, String mode) throws Exception {
        launch(version, mode, null);
    }

    /** Parse the loader family from a loaderId like "neoforge:21.1.72@1.21.1". */
    private static String loaderFamily(String loaderId) {
        if (loaderId == null || loaderId.isBlank()) return null;
        int c = loaderId.indexOf(':');
        return c > 0 ? loaderId.substring(0, c).toLowerCase() : loaderId.toLowerCase();
    }

    // ── Generic loader launcher (Forge / NeoForge / Quilt / OptiFine) ───────────
    //
    // Forge/NeoForge are installed on demand by running their official installer into
    // the launcher's OWN game folder (see LoaderInstaller), producing a version JSON
    // with a full arguments{jvm,game} block. We then download every listed library +
    // the base client jar, extract natives, download assets, and substitute the ${...}
    // placeholders in the argument lists exactly as the JSON specifies. No TLauncher.

    private static void launchModpackLoader(String mcVersion, String mode, String loaderId, String family) throws Exception {
        LauncherConfig cfg = LauncherConfig.get();
        Path profileDir = LauncherConfig.instanceDir(mcVersion, loaderId);
        Files.createDirectories(profileDir);
        Files.createDirectories(profileDir.resolve("mods"));

        // All storage lives inside the launcher's own data dir — self-contained.
        Path tlVersionsDir = LauncherConfig.tlVersionsDir();
        Path libsDir       = LauncherConfig.librariesDir();
        Path assetsDir     = LauncherConfig.assetsDir();
        String build = parseFabricBuild(loaderId);   // "forge:47.4.20@1.20.1" → "47.4.20"

        // 1. Find the loader version JSON we produced earlier; install it if missing.
        Path versionDir = findLoaderVersionDir(tlVersionsDir, family, mcVersion, build);
        if (versionDir == null) {
            LaunchProgress.update("install", 6, "Установка " + family + " " + build + "...");
            versionDir = LoaderInstaller.install(family, mcVersion, build, tlVersionsDir, libsDir);
            if (versionDir == null) {
                throw new IOException("Не удалось установить " + family + " " + build + " для " + mcVersion);
            }
        }
        String versionName = versionDir.getFileName().toString();
        Path versionJson = versionDir.resolve(versionName + ".json");
        if (!Files.exists(versionJson)) {
            throw new IOException("Не найден JSON версии: " + versionJson);
        }
        System.out.println("[pulsePLUS] Loader version: " + versionName);
        JsonObject meta = GSON.fromJson(Files.readString(versionJson), JsonObject.class);

        // 2. Resolve inheritsFrom (some loaders split into parent + child JSON)
        String parentId = meta.has("inheritsFrom") ? meta.get("inheritsFrom").getAsString() : null;
        JsonObject baseMeta = null;
        if (parentId != null) {
            Path parentJson = tlVersionsDir.resolve(parentId).resolve(parentId + ".json");
            if (!Files.exists(parentJson)) {
                // Fetch the vanilla parent from Mojang
                Files.createDirectories(parentJson.getParent());
                download(resolveMinecraftVersionUrl(parentId), parentJson);
            }
            baseMeta = GSON.fromJson(Files.readString(parentJson), JsonObject.class);
        }

        // Detect the module-based loaders (modern Forge/NeoForge use BootstrapLauncher
        // + ModLauncher). They ship a SPLIT client (…:slim + …:extra) inside their
        // library list, so the full vanilla client must NOT go on the classpath — two
        // "client" modules exporting the same package makes the module layer fail with
        // "Modules minecraft and client export package … to module mixin_synthetic".
        String metaMain = meta.has("mainClass") ? meta.get("mainClass").getAsString()
                        : (baseMeta != null && baseMeta.has("mainClass") ? baseMeta.get("mainClass").getAsString() : "");
        boolean moduleBased = metaMain.contains("bootstraplauncher")
                           || metaMain.contains("BootstrapLauncher")
                           || metaMain.contains("ForgeBootstrap")
                           || metaMain.contains("bootstrap.ForgeBootstrap")
                           || metaMain.contains("modlauncher");

        // 3. Base client jar — the "jar" field points at the vanilla version id.
        //    Only needed for legacy (launchwrapper) loaders like OptiFine / old Forge.
        String jarField = meta.has("jar") ? meta.get("jar").getAsString()
                        : (parentId != null ? parentId : mcVersion);
        Path clientVersionDir = tlVersionsDir.resolve(jarField);
        Path clientJar = clientVersionDir.resolve(jarField + ".jar");
        if (!moduleBased && !Files.exists(clientJar)) {
            LaunchProgress.update("client", 8, "Загрузка клиента " + jarField + "...");
            JsonObject jarMeta = baseMeta != null ? baseMeta
                               : GSON.fromJson(Files.readString(ensureVanillaJson(tlVersionsDir, jarField)), JsonObject.class);
            String jarUrl = jarMeta.getAsJsonObject("downloads").getAsJsonObject("client").get("url").getAsString();
            download(jarUrl, clientJar);
        }

        // 4. Download all libraries (loader JSON first, then parent's) into classpath
        LaunchProgress.update("libraries", 12, "Загрузка библиотек " + family + "...");
        List<Path> classpath = new ArrayList<>();
        if (meta.has("libraries")) downloadAllLibraries(meta.getAsJsonArray("libraries"), libsDir, classpath);
        if (baseMeta != null && baseMeta.has("libraries")) {
            downloadAllLibraries(baseMeta.getAsJsonArray("libraries"), libsDir, classpath);
        }
        // Legacy loaders patch the vanilla client at runtime and need it on the classpath;
        // module-based loaders provide their own split client via libraries.
        if (!moduleBased) classpath.add(clientJar);

        // 5. Natives
        LaunchProgress.update("natives", 50, "Распаковка нативных библиотек...");
        Path nativesDir = clientVersionDir.resolve("natives");
        extractNatives(classpath, nativesDir);

        // 6. Assets (asset index may live in loader JSON or its parent)
        JsonObject assetSource = meta.has("assetIndex") ? meta : baseMeta;
        String assetIndexId = assetSource.getAsJsonObject("assetIndex").get("id").getAsString();
        String assetIndexUrl = assetSource.getAsJsonObject("assetIndex").get("url").getAsString();
        downloadAllAssets(assetIndexUrl, assetIndexId, assetsDir);

        // 7. Build the command from the JSON's arguments block, substituting placeholders
        LaunchProgress.update("starting", 97, "Запуск " + family + "...");
        String mainClass = meta.has("mainClass") ? meta.get("mainClass").getAsString()
                         : baseMeta.get("mainClass").getAsString();

        Map<String, String> vars = new HashMap<>();
        // Аккаунт решает, что подставить: офлайн-ник или настоящие данные Microsoft
        Session session = Session.forActive(cfg);
        vars.put("auth_player_name", session.name);
        vars.put("version_name", versionName);
        vars.put("game_directory", profileDir.toAbsolutePath().toString());
        vars.put("assets_root", assetsDir.toAbsolutePath().toString());
        vars.put("assets_index_name", assetIndexId);
        vars.put("auth_uuid", session.uuid);
        vars.put("auth_access_token", session.accessToken);
        vars.put("clientid", "msa".equals(session.userType) ? cfg.msaClientId : "");
        vars.put("auth_xuid", session.xuid);
        vars.put("user_type", session.userType);
        vars.put("version_type", "release");
        vars.put("natives_directory", nativesDir.toAbsolutePath().toString());
        vars.put("launcher_name", "vulkan");
        vars.put("launcher_version", "1.0");
        vars.put("classpath", buildClasspath(classpath));
        vars.put("classpath_separator", File.pathSeparator);
        vars.put("library_directory", libsDir.toAbsolutePath().toString());
        vars.put("game_assets", assetsDir.toAbsolutePath().toString());
        vars.put("user_properties", "{}");

        List<String> cmd = new ArrayList<>();
        cmd.add(findJava(cfg));
        // Флаги Aikar: без них G1 даёт рывки на ровном месте (см. JvmFlags)
        cmd.addAll(JvmFlags.aikar(cfg.ramMb));

        // Merge base (vanilla) + loader argument arrays. Loaders that inheritFrom
        // vanilla (e.g. OptiFine) only ADD args (a tweakClass), relying on the base
        // for the standard jvm/game args, so a plain replace would drop them.
        JsonArray jvmArgs  = mergedArgs(baseMeta, meta, "jvm");
        JsonArray gameArgs = mergedArgs(baseMeta, meta, "game");

        boolean cpAdded = false;
        if (jvmArgs.size() > 0) {
            List<String> jvm = resolveArgs(jvmArgs, vars);
            cmd.addAll(jvm);
            cpAdded = jvm.stream().anyMatch(a -> a.equals("-cp") || a.equals("-classpath"));
        } else {
            // Legacy JSON with no jvm args — supply the essentials
            cmd.add("-Djava.library.path=" + vars.get("natives_directory"));
            cmd.add("-cp");
            cmd.add(vars.get("classpath"));
            cpAdded = true;
        }
        if (!cpAdded) { cmd.add("-cp"); cmd.add(vars.get("classpath")); }

        cmd.add(mainClass);

        if (gameArgs.size() > 0) {
            cmd.addAll(resolveArgs(gameArgs, vars));
        }
        // Legacy string form (1.12-): base's minecraftArguments + any loader extras
        String mcArgs = baseMeta != null && baseMeta.has("minecraftArguments") ? baseMeta.get("minecraftArguments").getAsString()
                      : (meta.has("minecraftArguments") ? meta.get("minecraftArguments").getAsString() : null);
        if (gameArgs.size() == 0 && mcArgs != null) {
            for (String tok : mcArgs.split(" ")) cmd.add(substitute(tok, vars));
            if (meta.has("minecraftArguments") && baseMeta != null) {
                // loader added its own tail (e.g. --tweakClass) after the base string
                for (String tok : meta.get("minecraftArguments").getAsString().split(" ")) cmd.add(substitute(tok, vars));
            }
        }

        Path logsDir = LauncherConfig.logsDir();
        Files.createDirectories(logsDir);
        Path gameLog = logsDir.resolve("minecraft-" + profileDir.getFileName() + ".log");

        System.out.println("[pulsePLUS] Launching " + versionName + " (" + family + ") → " + profileDir);
        new ProcessBuilder(cmd)
            .directory(profileDir.toFile())
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.to(gameLog.toFile()))
            .start();
        LaunchProgress.running("Игра запущена");
    }

    /**
     * Locate an already-installed loader version dir. Installer names vary:
     *   NeoForge → "neoforge-21.1.72"   (build in name, mc version absent)
     *   Forge    → "1.20.1-forge-47.4.20" (both present)
     * so we match on family AND (mc version OR build) and require the version JSON.
     */
    private static Path findLoaderVersionDir(Path versionsRoot, String family, String mcVersion, String build) throws IOException {
        if (!Files.isDirectory(versionsRoot)) return null;
        String famLc = family.toLowerCase();
        String buildLc = build == null ? "" : build.toLowerCase();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(versionsRoot)) {
            Path best = null;
            for (Path p : ds) {
                if (!Files.isDirectory(p)) continue;
                String n = p.getFileName().toString().toLowerCase();
                boolean matchesVersion = n.contains(mcVersion) || (!buildLc.isEmpty() && n.contains(buildLc));
                if (n.contains(famLc) && matchesVersion
                    && Files.exists(p.resolve(p.getFileName().toString() + ".json"))) {
                    if (n.equals(famLc + " " + mcVersion)) return p; // exact TLauncher-style
                    if (best == null) best = p;
                }
            }
            return best;
        }
    }

    private static Path ensureVanillaJson(Path versionsRoot, String versionId) throws Exception {
        Path json = versionsRoot.resolve(versionId).resolve(versionId + ".json");
        if (!Files.exists(json)) {
            Files.createDirectories(json.getParent());
            download(resolveMinecraftVersionUrl(versionId), json);
        }
        return json;
    }

    /** Concatenate a base version's argument array with a child (loader) version's. */
    private static JsonArray mergedArgs(JsonObject base, JsonObject child, String key) {
        JsonArray out = new JsonArray();
        if (base != null && base.has("arguments") && base.getAsJsonObject("arguments").has(key)) {
            out.addAll(base.getAsJsonObject("arguments").getAsJsonArray(key));
        }
        if (child != null && child.has("arguments") && child.getAsJsonObject("arguments").has(key)) {
            out.addAll(child.getAsJsonObject("arguments").getAsJsonArray(key));
        }
        return out;
    }

    /** Resolve a Mojang-style argument array, applying OS rules and ${...} substitution. */
    private static List<String> resolveArgs(JsonArray args, Map<String, String> vars) {
        List<String> out = new ArrayList<>();
        for (JsonElement el : args) {
            if (el.isJsonPrimitive()) {
                out.add(substitute(el.getAsString(), vars));
            } else if (el.isJsonObject()) {
                JsonObject obj = el.getAsJsonObject();
                if (obj.has("rules") && !rulesAllow(obj.getAsJsonArray("rules"))) continue;
                JsonElement value = obj.get("value");
                if (value == null) continue;
                if (value.isJsonPrimitive()) {
                    out.add(substitute(value.getAsString(), vars));
                } else if (value.isJsonArray()) {
                    for (JsonElement v : value.getAsJsonArray()) out.add(substitute(v.getAsString(), vars));
                }
            }
        }
        return out;
    }

    /** Null-safe string getter for optional JSON fields. */
    private static String optString(JsonObject obj, String key) {
        JsonElement e = obj.get(key);
        return e != null && !e.isJsonNull() ? e.getAsString() : null;
    }

    /** Replace ${name} tokens using the provided variable map. */
    private static String substitute(String in, Map<String, String> vars) {
        if (in == null || in.indexOf("${") < 0) return in;
        String out = in;
        for (Map.Entry<String, String> e : vars.entrySet()) {
            out = out.replace("${" + e.getKey() + "}", e.getValue());
        }
        return out;
    }

    // ── Mojang version manifest ─────────────────────────────────────────────

    private static String resolveMinecraftVersionUrl(String version) throws Exception {
        String body = fetchString(MC_MANIFEST);
        JsonObject manifest = GSON.fromJson(body, JsonObject.class);
        for (JsonElement el : manifest.getAsJsonArray("versions")) {
            JsonObject v = el.getAsJsonObject();
            if (version.equals(v.get("id").getAsString())) {
                return v.get("url").getAsString();
            }
        }
        throw new IOException("Minecraft version not found in manifest: " + version);
    }

    // ── Library downloading ─────────────────────────────────────────────────

    private static void downloadAllLibraries(JsonArray libs, Path libsDir, List<Path> classpath) throws Exception {
        // One library at a time over the network is far too slow (100+ requests) and
        // makes the launch feel like it re-downloads everything. Resolve every library
        // first (building the classpath in the correct order), then fetch only the
        // MISSING ones in parallel.
        record Lib(Path dest, String url, boolean isNative) {}
        List<Lib> missing = new ArrayList<>();
        // Библиотеки от прежних раскладок: их тоже не надо качать заново
        List<Path> legacyLibs = legacyLibraryRoots();
        int adoptedLibs = 0;

        for (JsonElement el : libs) {
            JsonObject lib = el.getAsJsonObject();
            if (lib.has("rules") && !rulesAllow(lib.getAsJsonArray("rules"))) continue;

            // The maven coordinate is always present and gives the on-disk path.
            String name = lib.has("name") ? lib.get("name").getAsString() : null;
            String relPath = null;
            String downloadUrl = null;

            if (lib.has("downloads") && lib.getAsJsonObject("downloads").has("artifact")) {
                JsonObject artifact = lib.getAsJsonObject("downloads").getAsJsonObject("artifact");
                relPath = optString(artifact, "path");
                downloadUrl = optString(artifact, "url");
            }
            if ((relPath == null || relPath.isBlank()) && name != null) {
                relPath = mavenRelPath(name);
            }
            if (relPath == null || relPath.isBlank()) continue; // nothing to resolve
            if ((downloadUrl == null || downloadUrl.isBlank()) && name != null && lib.has("url")) {
                String baseUrl = lib.get("url").getAsString();
                if (baseUrl.startsWith("http")) downloadUrl = baseUrl + relPath;
            }
            // Only real http(s) URLs are downloadable. Installer-generated jars carry a
            // relative "/libraries/..." URL — those are produced in-place by the loader
            // installer, so they already exist on disk in our own libraries folder.
            if (downloadUrl != null && !downloadUrl.startsWith("http")) downloadUrl = null;

            Path dest = libsDir.resolve(relPath);
            boolean isNative = name != null && name.contains(":natives-");
            if (isNative && !isNativeForCurrentOS(name)) continue;
            // "downloadOnly" libs (e.g. NeoForge's client :slim/:extra/:srg) must be
            // present on disk for the loader to find via ${library_directory}, but must
            // NOT be on the classpath — otherwise two "minecraft" modules collide.
            boolean downloadOnly = lib.has("downloadOnly") && lib.get("downloadOnly").getAsBoolean();

            if (!Files.exists(dest)) {
                // Раньше библиотека могла лежать в каталоге другой раскладки —
                // переносим её оттуда, а не тянем из сети
                if (adoptFile(dest, relPath, legacyLibs)) {
                    adoptedLibs++;
                } else if (downloadUrl != null && !downloadUrl.isBlank()) {
                    missing.add(new Lib(dest, downloadUrl, isNative));
                } else {
                    // No URL and not on disk — the loader installer should have produced
                    // it. Warn (rare) rather than fail the whole launch.
                    System.err.println("[pulsePLUS] Lib missing (installer-generated, no url): " + relPath);
                }
            }
            if (!isNative && !downloadOnly) classpath.add(dest);
        }

        if (adoptedLibs > 0) {
            System.out.println("[pulsePLUS] Libraries: перенесено из старого кэша " + adoptedLibs);
        }
        if (missing.isEmpty()) {
            LaunchProgress.update("libraries", 40, "Библиотеки уже загружены");
            return;
        }

        // Download the missing libraries concurrently — keep concurrency modest,
        // Mojang's library CDN drops connections under heavy parallel load.
        int threads = 6;
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
        java.util.concurrent.atomic.AtomicInteger done = new java.util.concurrent.atomic.AtomicInteger();
        int totalDl = missing.size();
        System.out.println("[pulsePLUS] Libraries: downloading " + totalDl + " missing...");
        List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
        for (Lib l : missing) {
            futures.add(pool.submit(() -> {
                try {
                    Files.createDirectories(l.dest().getParent());
                    download(l.url(), l.dest());
                } catch (Exception e) {
                    System.err.println("[pulsePLUS] Skip lib " + l.dest().getFileName() + ": " + e.getMessage());
                }
                int d = done.incrementAndGet();
                LaunchProgress.update("libraries", 12 + (28 * d / totalDl),
                    "Загрузка библиотек " + d + "/" + totalDl + "...");
            }));
        }
        pool.shutdown();
        pool.awaitTermination(10, java.util.concurrent.TimeUnit.MINUTES);
        System.out.println("[pulsePLUS] Libraries: done");
    }

    // ── Fabric / Quilt loader integration ───────────────────────────────────
    //
    // Both Fabric and Quilt expose an identical "profile/json" endpoint that lists
    // the loader libraries (each with a maven base url) and the main class. Everything
    // is fetched straight from their meta APIs — fully self-contained, no external
    // launcher required.
    //
    // Профиль сохраняется на диск как обычная версия (см. LoaderStore): сама игра
    // запускается прежним ванильным путём — Fabric и Quilt лишь добавляют
    // библиотеки и подменяют главный класс, — но описание сборки остаётся
    // лежать рядом с версиями, и по нему видно, что она уже собрана.

    /** Newest loader build for the given MC version from a Fabric/Quilt meta API, or the fallback. */
    private static String latestMetaLoaderBuild(String metaBase, String mcVersion, String fallback) {
        try {
            String body = fetchString(metaBase + mcVersion);
            JsonArray arr = GSON.fromJson(body, JsonArray.class);
            // The list is ordered newest-first; take the first stable build.
            for (JsonElement el : arr) {
                JsonObject obj = el.getAsJsonObject();
                if (!obj.has("loader")) continue;
                JsonObject loader = obj.getAsJsonObject("loader");
                // Prefer stable builds; fall back to whatever is first if none are marked stable.
                if (loader.has("stable") && !loader.get("stable").getAsBoolean()) continue;
                return loader.get("version").getAsString();
            }
            // No stable build found — use the very first entry
            if (arr.size() > 0) {
                JsonObject loader = arr.get(0).getAsJsonObject().getAsJsonObject("loader");
                return loader.get("version").getAsString();
            }
        } catch (Exception e) {
            System.err.println("[pulsePLUS] latest loader lookup failed: " + e.getMessage());
        }
        return fallback;
    }

    /**
     * Применить загрузчик из мета-API Fabric/Quilt.
     *
     * Описание сборки кладётся на диск — в свою папку рядом с версиями игры,
     * ровно как это делают установщики Forge и NeoForge. Отсюда два следствия:
     * сборка становится видна в списке версий (её находят по {@code inheritsFrom}),
     * а повторный запуск читает описание с диска и не ходит за ним в сеть.
     *
     * Пишем только после того, как библиотеки разложены: описание — это признак
     * «сборка готова», и оставить его при оборванной загрузке значит соврать
     * следующему запуску, что качать уже нечего.
     */
    private static String applyMetaLoader(String metaBase, String mcVersion, String loaderBuild,
                                          Path libsDir, List<Path> classpath, String label,
                                          String family, Path versionsDir) throws Exception {
        Path jsonPath = LoaderStore.jsonFor(versionsDir, family, loaderBuild, mcVersion);
        JsonObject profile = null;
        boolean fromDisk = false;

        if (Files.isRegularFile(jsonPath)) {
            try {
                profile = GSON.fromJson(Files.readString(jsonPath), JsonObject.class);
                fromDisk = profile != null && profile.has("libraries");
            } catch (Exception broken) {
                profile = null;
            }
            if (!fromDisk) {
                System.err.println("[pulsePLUS] " + label + ": описание сборки нечитаемо, беру заново");
                profile = null;
            }
        }

        if (profile == null) {
            String profileUrl = metaBase + mcVersion + "/" + loaderBuild + "/profile/json";
            System.out.println("[pulsePLUS] Fetching " + label + " profile: " + profileUrl);
            String body;
            try { body = fetchString(profileUrl); }
            catch (Exception e) { System.err.println("[pulsePLUS] " + label + " profile fetch failed: " + e.getMessage()); return null; }
            profile = GSON.fromJson(body, JsonObject.class);
        } else {
            System.out.println("[pulsePLUS] " + label + " уже установлен: " + jsonPath.getParent().getFileName());
        }

        String loaderMain = profile.has("mainClass") ? profile.get("mainClass").getAsString() : null;

        if (profile.has("libraries")) {
            String defaultMaven = label.equals("Quilt") ? "https://maven.quiltmc.org/repository/release/" : "https://maven.fabricmc.net/";
            for (JsonElement el : profile.getAsJsonArray("libraries")) {
                JsonObject lib = el.getAsJsonObject();
                String name = lib.get("name").getAsString();
                String baseUrl = lib.has("url") ? lib.get("url").getAsString() : defaultMaven;
                if (baseUrl.startsWith("/")) continue;
                String relPath = mavenRelPath(name);
                Path dest = libsDir.resolve(relPath);
                if (!Files.exists(dest)) {
                    Files.createDirectories(dest.getParent());
                    System.out.println("[pulsePLUS] Downloading " + label + " lib: " + name);
                    try { download(baseUrl + relPath, dest); }
                    catch (Exception e) { System.err.println("[pulsePLUS] Skip: " + name); continue; }
                }
                // Loader libs go first in classpath
                if (!classpath.contains(dest)) classpath.add(0, dest);
            }
        }

        if (!fromDisk) {
            profile.addProperty("id", jsonPath.getParent().getFileName().toString());
            profile.addProperty("inheritsFrom", mcVersion);
            Files.createDirectories(jsonPath.getParent());
            Files.writeString(jsonPath, GSON.toJson(profile));
            System.out.println("[pulsePLUS] " + label + " установлен: " + jsonPath.getParent().getFileName());
        }
        return loaderMain;
    }

    private static String parseFabricBuild(String loaderId) {
        // fabric:0.16.10@1.21.4 → 0.16.10
        int colon = loaderId.indexOf(':');
        int at = loaderId.lastIndexOf('@');
        if (colon < 0 || at <= colon) return null;
        return loaderId.substring(colon + 1, at);
    }

    // ── Native extraction ───────────────────────────────────────────────────

    private static void extractNatives(List<Path> classpath, Path nativesDir) throws Exception {
        Files.createDirectories(nativesDir);
        // The native JAR classifier we want depends on OS + CPU architecture.
        // e.g. lwjgl-3.3.3-natives-windows.jar (x64) vs -natives-windows-arm64.jar.
        String wantSuffix = nativeClassifierSuffix();
        // Native JARs live in the same dir as their base library (which is on the
        // classpath); scan each unique classpath dir for the matching-arch native JAR.
        Set<Path> scanned = new HashSet<>();
        for (Path p : classpath) {
            Path dir = p.getParent();
            if (dir == null || !scanned.add(dir)) continue;
            if (!Files.exists(dir)) continue;
            try (var ds = Files.newDirectoryStream(dir, "*.jar")) {
                for (Path native_jar : ds) {
                    if (native_jar.getFileName().toString().endsWith(wantSuffix)) {
                        extractJar(native_jar, nativesDir);
                    }
                }
            }
        }
    }

    /** Native JAR filename suffix for the current OS + architecture. */
    private static String nativeClassifierSuffix() {
        String os = System.getProperty("os.name", "").toLowerCase();
        String arch = System.getProperty("os.arch", "").toLowerCase();
        String osTag = os.contains("win") ? "windows" : os.contains("mac") ? "macos" : "linux";
        boolean arm64 = arch.contains("aarch64") || arch.contains("arm64");
        boolean x86_32 = arch.equals("x86") || arch.equals("i386") || arch.equals("i686");
        if (arm64) return "natives-" + osTag + "-arm64.jar";
        if (x86_32 && osTag.equals("windows")) return "natives-windows-x86.jar";
        return "natives-" + osTag + ".jar"; // default: x64
    }

    private static void extractJar(Path jar, Path destDir) {
        try (ZipInputStream zis = new ZipInputStream(Files.newInputStream(jar))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName();
                if (name.contains("..")) continue;
                if (!name.endsWith(".dll") && !name.endsWith(".so") && !name.endsWith(".dylib")) continue;
                // Native libs may be nested (e.g. windows/x64/org/lwjgl/lwjgl.dll) —
                // flatten to the basename so java.library.path can find them.
                String baseName = name.substring(name.lastIndexOf('/') + 1);
                if (baseName.isBlank()) continue;
                Path dest = destDir.resolve(baseName);
                if (!Files.exists(dest)) Files.copy(zis, dest);
            }
        } catch (Exception e) {
            System.err.println("[pulsePLUS] Native extract failed for " + jar.getFileName() + ": " + e.getMessage());
        }
    }

    // ── Asset downloading ───────────────────────────────────────────────────

    /**
     * Перенести уже скачанный файл из старого каталога.
     *
     * relPath — путь внутри каталога-источника; он одинаков во всех схемах,
     * потому что и библиотеки, и ресурсы раскладываются по своему обычному
     * виду (maven-координата и хеш соответственно). Оригинал не трогаем:
     * связываем жёсткой связью, а если она не выйдет — копируем.
     *
     * @return true, если файл удалось перенести
     */
    private static boolean adoptFile(Path dest, String relPath, List<Path> roots) {
        // Готовое не трогаем. Files.copy молча перезаписывает существующую цель
        // (проверено: вопреки документации исключения не бросает), а подменять
        // уже скачанный файл нельзя — поэтому выход здесь, а не надежда на то,
        // что вызывающий сам проверил наличие.
        if (Files.exists(dest)) return Files.isRegularFile(dest);
        for (Path root : roots) {
            Path src = root.resolve(relPath);
            if (!Files.isRegularFile(src)) continue;
            try {
                Files.createDirectories(dest.getParent());
                try {
                    Files.createLink(dest, src);   // тот же том — связь бесплатна
                } catch (Exception noLink) {
                    try {
                        Files.copy(src, dest);     // другой том или ФС без связей
                    } catch (Exception copyFailed) {
                        // Обрыв копии оставил бы обрезанный файл, а он на вид
                        // ничем не отличается от целого: следующая загрузка
                        // приняла бы его за готовый и не перекачала. Убираем.
                        try { Files.deleteIfExists(dest); } catch (Exception ignored) { }
                        throw copyFailed;
                    }
                }
                return true;
            } catch (Exception ignored) {
                // не вышло с этим каталогом — пробуем следующий
            }
        }
        return false;
    }

    /**
     * Каталоги, куда лаунчер складывал ресурсы раньше.
     *
     * Объекты ресурсов названы своим хешем от содержимого и потому одинаковы
     * для всех версий игры сразу — в этих папках лежит больше полугигабайта
     * уже скачанного, и качать то же самое заново незачем.
     */
    private static List<Path> legacyAssetRoots() {
        Path data = LauncherConfig.dataDir();
        return existingDirs(List.of(
            data.resolve("cache").resolve("assets"),      // прошлый общий кэш
            data.resolve("vanilla").resolve("assets"),    // кэши по профилям
            data.resolve("minecraft").resolve("assets")));
    }

    /** Каталоги с библиотеками от прежних раскладок. */
    private static List<Path> legacyLibraryRoots() {
        Path data = LauncherConfig.dataDir();
        return existingDirs(List.of(
            data.resolve("cache").resolve("libraries"),
            data.resolve("vanilla").resolve("libraries"),
            data.resolve("minecraft").resolve("libraries")));
    }

    private static List<Path> existingDirs(List<Path> candidates) {
        List<Path> out = new ArrayList<>();
        for (Path p : candidates) if (Files.isDirectory(p)) out.add(p);
        return out;
    }

    private static void downloadAllAssets(String indexUrl, String indexId, Path assetsDir) throws Exception {
        Path indexPath = assetsDir.resolve("indexes").resolve(indexId + ".json");
        if (!Files.exists(indexPath)) {
            // Указатель на набор ресурсов тоже мог остаться в старом каталоге
            if (!adoptFile(indexPath, "indexes/" + indexId + ".json", legacyAssetRoots())) {
                Files.createDirectories(indexPath.getParent());
                System.out.println("[pulsePLUS] Downloading asset index " + indexId + "...");
                download(indexUrl, indexPath);
            }
        }
        JsonObject index = GSON.fromJson(Files.readString(indexPath), JsonObject.class);
        JsonObject objects = index.getAsJsonObject("objects");
        int total = objects.size();

        // Collect only the assets that are still missing
        List<Path> legacy = legacyAssetRoots();
        List<String[]> missing = new ArrayList<>(); // [hash, prefix, key]
        int skipped = 0;
        int adopted = 0;
        for (Map.Entry<String, JsonElement> entry : objects.entrySet()) {
            String hash = entry.getValue().getAsJsonObject().get("hash").getAsString();
            String prefix = hash.substring(0, 2);
            Path dest = assetsDir.resolve("objects").resolve(prefix).resolve(hash);
            if (Files.exists(dest)) { skipped++; continue; }
            if (adoptFile(dest, "objects/" + prefix + "/" + hash, legacy)) { adopted++; continue; }
            missing.add(new String[]{hash, prefix, entry.getKey()});
        }
        if (adopted > 0) {
            System.out.println("[pulsePLUS] Assets: перенесено из старого кэша " + adopted);
        }
        System.out.println("[pulsePLUS] Assets: " + skipped + " cached, downloading " + missing.size() + " of " + total + "...");

        if (missing.isEmpty()) {
            LaunchProgress.update("assets", 95, "Ресурсы готовы");
            return;
        }
        LaunchProgress.update("assets", 55, "Загрузка ресурсов 0/" + missing.size() + "...");

        // Download missing assets in parallel. Assets are tiny individual objects, so a
        // higher concurrency dramatically cuts wall-clock time; download() already
        // retries transient CDN drops, so 16 is safe.
        int threads = 16;
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
        java.util.concurrent.atomic.AtomicInteger done = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger failed = new java.util.concurrent.atomic.AtomicInteger();
        List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
        int totalMissing = missing.size();
        for (String[] a : missing) {
            String hash = a[0], prefix = a[1], key = a[2];
            Path dest = assetsDir.resolve("objects").resolve(prefix).resolve(hash);
            futures.add(pool.submit(() -> {
                try {
                    Files.createDirectories(dest.getParent());
                    download("https://resources.download.minecraft.net/" + prefix + "/" + hash, dest);
                    int d = done.incrementAndGet();
                    // Map asset progress onto the 55%–95% band; throttle UI updates
                    if (d % 15 == 0 || d == totalMissing) {
                        LaunchProgress.update("assets", 55 + (40 * d / totalMissing),
                            "Загрузка ресурсов " + d + "/" + totalMissing + "...");
                    }
                } catch (Exception e) {
                    failed.incrementAndGet();
                    System.err.println("[pulsePLUS] Asset skip: " + key + " (" + e.getMessage() + ")");
                }
            }));
        }
        pool.shutdown();
        pool.awaitTermination(10, java.util.concurrent.TimeUnit.MINUTES);
        System.out.println("[pulsePLUS] Assets: downloaded " + done.get()
            + ", cached " + skipped + ", failed " + failed.get());
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Derive a group/artifact identity key from a Maven-layout path
     * (…/group/artifact/version/artifact-version[-classifier].jar).
     * Returns the artifact directory path as the key, or null if the path is not in
     * Maven layout (e.g. the vanilla client JAR) so it's never collapsed by artifact.
     */
    private static String mavenArtifactKey(Path jar) {
        Path versionDir = jar.getParent();
        if (versionDir == null) return null;
        Path artifactDir = versionDir.getParent();
        if (artifactDir == null || artifactDir.getFileName() == null) return null;
        String artifact = artifactDir.getFileName().toString();
        String version = versionDir.getFileName() != null ? versionDir.getFileName().toString() : "";
        String file = jar.getFileName().toString();
        // Only treat as a Maven artifact when the file name matches "<artifact>-<version>"
        String core = artifact + "-" + version;
        if (!file.startsWith(core)) return null;
        // Keep the classifier in the key so different classifiers of the SAME artifact
        // (e.g. NeoForge's client :slim / :extra / :srg) are NOT collapsed together,
        // while different VERSIONS of the same artifact (Fabric vs vanilla ASM) still are.
        String rest = file.substring(core.length());          // "-slim.jar", ".jar", "-natives-windows.jar"
        String classifier = rest.startsWith("-") && rest.endsWith(".jar")
            ? rest.substring(1, rest.length() - 4) : "";
        return artifactDir.toAbsolutePath() + "|" + classifier;
    }

    private static String mavenRelPath(String coord) {
        // group:artifact:version[:classifier]
        String[] parts = coord.split(":");
        String group    = parts[0].replace('.', '/');
        String artifact = parts[1];
        String version  = parts[2];
        String classifier = parts.length > 3 ? "-" + parts[3] : "";
        return group + "/" + artifact + "/" + version + "/" + artifact + "-" + version + classifier + ".jar";
    }

    private static boolean isNativeForCurrentOS(String name) {
        boolean win = System.getProperty("os.name", "").toLowerCase().contains("win");
        boolean mac = System.getProperty("os.name", "").toLowerCase().contains("mac");
        boolean linux = System.getProperty("os.name", "").toLowerCase().contains("linux");
        if (name.contains("natives-windows") && win) return true;
        if (name.contains("natives-macos")   && mac) return true;
        if (name.contains("natives-linux")   && linux) return true;
        return false;
    }

    private static boolean rulesAllow(JsonArray rules) {
        String os = System.getProperty("os.name", "").toLowerCase();
        String osName = os.contains("win") ? "windows" : os.contains("mac") ? "osx" : "linux";
        boolean allowed = false;
        for (JsonElement el : rules) {
            JsonObject rule = el.getAsJsonObject();
            String action = rule.get("action").getAsString();
            if (!rule.has("os")) {
                // Check features (demo, custom_resolution) — skip those
                if (!rule.has("features")) allowed = "allow".equals(action);
            } else {
                JsonObject osObj = rule.getAsJsonObject("os");
                if (osObj.has("name") && osObj.get("name").getAsString().equals(osName)) {
                    allowed = "allow".equals(action);
                }
            }
        }
        return allowed;
    }

    private static String buildClasspath(List<Path> paths) {
        String sep = System.getProperty("os.name", "").toLowerCase().contains("win") ? ";" : ":";
        StringBuilder sb = new StringBuilder();
        Set<Path> seenPaths = new LinkedHashSet<>();
        // Dedupe by Maven artifact (group/artifact) too — Fabric ships its own ASM
        // version, and having two ASM versions on the classpath makes Fabric refuse
        // to launch ("duplicate ASM classes found"). Fabric libs are added first, so
        // keeping the first occurrence of each artifact lets Fabric's version win.
        Set<String> seenArtifacts = new LinkedHashSet<>();
        for (Path p : paths) {
            Path abs = p.toAbsolutePath();
            if (!seenPaths.add(abs)) continue;
            String artifactKey = mavenArtifactKey(p);
            if (artifactKey != null && !seenArtifacts.add(artifactKey)) {
                System.out.println("[pulsePLUS] Classpath: skip duplicate artifact " + artifactKey + " → " + p.getFileName());
                continue;
            }
            if (sb.length() > 0) sb.append(sep);
            sb.append(abs);
        }
        return sb.toString();
    }

    private static String fetchString(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(new URI(url))
            .header("User-Agent", "pulsePLUS/1.0").build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) throw new IOException("HTTP " + resp.statusCode() + " for " + url);
        return resp.body();
    }

    private static void download(String url, Path dest) throws Exception {
        // Try the primary URL, then known mirrors. Some Mojang hosts (notably
        // libraries.minecraft.net) are blocked or unreachable on certain networks;
        // when that happens the download fails, the file never persists, and every
        // launch re-downloads it ("it downloads the version every single time").
        // A mirror fallback keeps the launch working on restrictive networks.
        Exception last = null;
        for (String candidate : mirrorCandidates(url)) {
            try {
                downloadOnce(candidate, dest);
                return; // success on this mirror
            } catch (Exception e) {
                last = e;
            }
        }
        throw last != null ? last : new IOException("Download failed: " + url);
    }

    /** Primary URL followed by mirror alternatives for hosts that are often blocked. */
    private static List<String> mirrorCandidates(String url) {
        List<String> out = new ArrayList<>();
        out.add(url);
        if (url.startsWith("https://libraries.minecraft.net/")) {
            out.add(url.replace("https://libraries.minecraft.net/", "https://bmclapi2.bangbang93.com/maven/"));
        } else if (url.startsWith("https://piston-data.mojang.com/")) {
            out.add(url.replace("https://piston-data.mojang.com/", "https://bmclapi2.bangbang93.com/"));
        } else if (url.startsWith("https://resources.download.minecraft.net/")) {
            out.add(url.replace("https://resources.download.minecraft.net/", "https://bmclapi2.bangbang93.com/assets/"));
        } else if (url.startsWith("https://maven.minecraftforge.net/")) {
            // Forge installer / libraries — BMCLAPI mirror for blocked/slow networks
            out.add(url.replace("https://maven.minecraftforge.net/", "https://bmclapi2.bangbang93.com/maven/"));
        } else if (url.startsWith("https://maven.neoforged.net/releases/")) {
            out.add(url.replace("https://maven.neoforged.net/releases/", "https://bmclapi2.bangbang93.com/maven/"));
        }
        return out;
    }

    private static void downloadOnce(String url, Path dest) throws Exception {
        // Transient failures (handshake drops under load) are retried with backoff.
        Exception last = null;
        Path tmp = dest.resolveSibling(dest.getFileName() + ".part");
        for (int attempt = 1; attempt <= 4; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(new URI(url))
                    .header("User-Agent", "pulsePLUS/1.0")
                    .timeout(java.time.Duration.ofSeconds(120))
                    .build();
                // NOTE: BodyHandlers.ofFile() throws NoSuchFileException on HTTP/2 servers.
                HttpResponse<InputStream> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofInputStream());
                if (resp.statusCode() != 200) {
                    throw new IOException("HTTP " + resp.statusCode() + " for " + url);
                }
                if (dest.getParent() != null) Files.createDirectories(dest.getParent());
                // Download atomically: write to a .part file, then move into place only
                // on success — never leave a truncated "real" file that the existence
                // check would wrongly treat as already-downloaded next launch.
                try (InputStream in = resp.body()) {
                    Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
                }
                try {
                    Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (Exception atomicFailed) {
                    Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING);
                }
                return; // success
            } catch (Exception e) {
                last = e;
                try { Files.deleteIfExists(tmp); } catch (Exception ignored) {}
                if (attempt < 4) Thread.sleep(250L * attempt); // linear backoff
            }
        }
        throw last;
    }

    static String findJava(LauncherConfig cfg) {
        if (cfg.javaPath != null && !cfg.javaPath.isBlank()) {
            if (new File(cfg.javaPath).exists()) return cfg.javaPath;
        }
        String javaHome = System.getenv("JAVA_HOME");
        if (javaHome != null) {
            boolean win = System.getProperty("os.name","").toLowerCase().contains("win");
            String exec = javaHome + File.separator + "bin" + File.separator + (win ? "javaw.exe" : "java");
            if (new File(exec).exists()) return exec;
        }
        // Своя Java: сборка без Electron приносит рантайм рядом с собой.
        // Без этой ветки игра ушла бы в «java» из PATH, а её там может не быть
        // вовсе — те же Legacy Launcher и подобные носят Java внутри и в
        // систему её не прописывают, так что «java» у игрока не находится.
        String own = System.getProperty("java.home");
        if (own != null && !own.isBlank()) {
            boolean win = System.getProperty("os.name","").toLowerCase().contains("win");
            String exec = own + File.separator + "bin" + File.separator + (win ? "javaw.exe" : "java");
            if (new File(exec).exists()) return exec;
        }
        return "java";
    }

    /** Console java (java.exe, not javaw) — needed to run installers and read output. */
    static String findConsoleJava(LauncherConfig cfg) {
        String j = findJava(cfg);
        return j.replace("javaw.exe", "java.exe");
    }

    /** Package-visible download for helper classes (LoaderInstaller). */
    static void fetchFile(String url, Path dest) throws Exception { download(url, dest); }

    /** Package-visible text fetch for helper classes (LoaderInstaller). */
    static String fetchText(String url) throws Exception { return fetchString(url); }
}
