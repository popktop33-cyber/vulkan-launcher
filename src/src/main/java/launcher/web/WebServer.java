package launcher.web;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import launcher.LauncherConfig;
import launcher.auth.Account;
import launcher.auth.AccountStore;
import launcher.auth.MicrosoftAuth;
import launcher.auth.Session;
import launcher.catalog.CatalogService;
import launcher.minecraft.MinecraftLauncher;
import launcher.minecraft.VersionManager;
import launcher.music.MusicManager;
import launcher.mods.ModInstallService;
import launcher.mods.ModManager;
import launcher.mods.ModUpdateService;
import launcher.mods.PerformancePack;

public class WebServer {

    private final int port;
    private HttpServer server;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final String WEB_DIR = "src/main/resources/web";

    public WebServer(int port) {
        this.port = port;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.setExecutor(Executors.newCachedThreadPool());

        server.createContext("/", this::handleStatic);
        server.createContext("/api/state", this::handleState);
        server.createContext("/api/versions", this::handleVersions);
        server.createContext("/api/launch", this::handleLaunch);
        server.createContext("/api/launch/progress", this::handleLaunchProgress);
        server.createContext("/api/mods", this::handleMods);
        server.createContext("/api/mods/auto-disable", this::handleAutoDisableMods);
        server.createContext("/api/mods/check-updates", this::handleCheckModUpdates);
        server.createContext("/api/mods/install", this::handleModInstall);
        server.createContext("/api/mods/auto-install", this::handleModAutoInstall);
        server.createContext("/api/mods/install-performance", this::handleInstallPerformance);
        server.createContext("/api/catalog/loaders", this::handleLoadersCatalog);
        server.createContext("/api/catalog/mods", this::handleModsCatalog);
        server.createContext("/api/catalog/categories", this::handleCatalogCategories);
        server.createContext("/api/catalog/project", this::handleCatalogProject);
        server.createContext("/api/catalog/versions", this::handleCatalogVersions);
        server.createContext("/api/config", this::handleConfig);
        // Учётные записи. Более длинные пути регистрируются отдельно: HttpServer
        // выбирает контекст по самому длинному совпадению префикса.
        server.createContext("/api/accounts", this::handleAccounts);
        server.createContext("/api/accounts/msa/start", this::handleMsaStart);
        server.createContext("/api/accounts/msa/poll", this::handleMsaPoll);
        server.createContext("/api/music/state", this::handleMusicState);
        server.createContext("/api/music/tracks", this::handleMusicTracks);
        server.createContext("/api/music/file", this::handleMusicFile);
        server.createContext("/api/music/toggle", this::handleMusicToggle);
        server.createContext("/api/music/next", this::handleMusicNext);
        server.createContext("/api/music/volume", this::handleMusicVolume);
        server.createContext("/api/music/save-bytebeat", this::handleSaveBytebeatFormula);
        server.createContext("/api/music/delete-bytebeat", this::handleDeleteBytebeatFile);
        server.createContext("/videos/", this::handleVideos);

        server.start();
        System.out.println("[pulsePLUS] HTTP on port " + port);
    }

    public void stop() {
        if (server != null) server.stop(0);
    }

    private void handleStatic(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equalsIgnoreCase("GET")) {
            send(ex, 405, "text/plain", "Method Not Allowed");
            return;
        }
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";
        if (path.contains("..")) {
            send(ex, 403, "text/plain", "Forbidden");
            return;
        }

        byte[] bytes = readResource("web" + path);
        if (bytes == null) {
            Path fs = Path.of(WEB_DIR + path);
            if (Files.exists(fs)) bytes = Files.readAllBytes(fs);
        }
        if (bytes == null) {
            send(ex, 404, "text/plain", "Not Found");
            return;
        }

        cors(ex);
        ex.getResponseHeaders().set("Content-Type", contentType(path));
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private void handleState(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        LauncherConfig cfg = LauncherConfig.get();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ramMb", cfg.ramMb);
        out.put("selectedVersion", cfg.selectedVersion);
        out.put("vanillaVersion", cfg.vanillaVersion);
        out.put("autoUpdateMods", cfg.autoUpdateMods);
        out.put("autoDisableIncompatibleMods", cfg.autoDisableIncompatibleMods);
        out.put("useDownloadedModsLibrary", cfg.useDownloadedModsLibrary);
        out.put("musicEnabled", cfg.musicEnabled);
        out.put("musicVolume", cfg.musicVolume);
        out.put("lastMode", cfg.lastMode);
        out.put("userName", cfg.userName);
        out.put("javaPath", cfg.javaPath);
        out.put("msaClientId", cfg.msaClientId);
        out.put("accounts", accountListJson());
        out.put("activeAccountId", activeAccountId());
        out.put("pulseLoaderId", cfg.pulseLoaderId);
        out.put("vanillaLoaderId", cfg.vanillaLoaderId);
        // Use LinkedHashMap so all paths are always serialized (Map.of has iteration-order quirks in GSON)
        Map<String, String> paths = new LinkedHashMap<>();
        paths.put("minecraft",    LauncherConfig.minecraftGameDir().toString());
        paths.put("vanilla",      LauncherConfig.vanillaGameDir().toString());
        paths.put("mods",         LauncherConfig.modsDir(cfg.selectedVersion).toString());
        paths.put("downloadedMods", LauncherConfig.downloadedModsDir().toString());
        paths.put("music",        LauncherConfig.musicDir().toString());
        paths.put("tlVersions",   LauncherConfig.tlVersionsDir().toString());
        out.put("paths", paths);
        sendJson(ex, 200, out);
    }

    // ── Учётные записи ──────────────────────────────────────────────────────

    private List<Map<String, Object>> accountListJson() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Account a : AccountStore.get().all()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", a.id);
            m.put("type", a.type);
            m.put("name", a.name);
            m.put("uuid", a.uuid);
            m.put("initial", a.initial());
            m.put("microsoft", a.isMicrosoft());
            m.put("lastLogin", a.lastLogin);
            list.add(m);
        }
        return list;
    }

    private String activeAccountId() {
        Account a = AccountStore.get().active();
        return a == null ? "" : a.id;
    }

    private Map<String, Object> accountsPayload() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("accounts", accountListJson());
        out.put("activeAccountId", activeAccountId());
        return out;
    }

    private void handleAccounts(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        AccountStore store = AccountStore.get();
        try {
            if (ex.getRequestMethod().equalsIgnoreCase("GET")) {
                sendJson(ex, 200, accountsPayload());
                return;
            }
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
                send(ex, 405, "text/plain", "GET or POST only");
                return;
            }
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            String action = body != null && body.has("action") ? body.get("action").getAsString() : "";
            switch (action) {
                case "add-offline":
                    store.addOffline(body.has("name") ? body.get("name").getAsString() : "");
                    break;
                case "select":
                    Session.invalidate();   // у другого аккаунта свой токен
                    store.select(body.has("id") ? body.get("id").getAsString() : "");
                    break;
                case "remove":
                    Session.invalidate();
                    store.remove(body.has("id") ? body.get("id").getAsString() : "");
                    break;
                default:
                    sendJson(ex, 400, Map.of("ok", false, "error", "Неизвестное действие: " + action));
                    return;
            }
            sendJson(ex, 200, accountsPayload());
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", String.valueOf(e.getMessage())));
        }
    }

    /** Ожидающий вход Microsoft: между start и poll надо помнить код устройства. */
    private static MicrosoftAuth.DeviceCode pendingDeviceCode;

    private void handleMsaStart(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            pendingDeviceCode = MicrosoftAuth.start(LauncherConfig.get().msaClientId);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("userCode", pendingDeviceCode.userCode);
            out.put("verificationUri", pendingDeviceCode.verificationUri);
            out.put("message", pendingDeviceCode.message);
            out.put("interval", pendingDeviceCode.intervalSeconds);
            out.put("expiresAt", pendingDeviceCode.expiresAt);
            sendJson(ex, 200, out);
        } catch (MicrosoftAuth.AuthError e) {
            sendJson(ex, 400, Map.of("ok", false, "error", e.getMessage()));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", String.valueOf(e.getMessage())));
        }
    }

    private void handleMsaPoll(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        if (pendingDeviceCode == null) {
            sendJson(ex, 400, Map.of("ok", false, "error", "Вход не начат"));
            return;
        }
        try {
            MicrosoftAuth.AuthResult result = MicrosoftAuth.poll(LauncherConfig.get().msaClientId, pendingDeviceCode);
            pendingDeviceCode = null;
            Session.invalidate();
            Map<String, Object> out = new LinkedHashMap<>(accountsPayload());
            out.put("status", "ok");
            out.put("name", result.account.name);
            sendJson(ex, 200, out);
        } catch (MicrosoftAuth.Pending e) {
            // Пользователь ещё не подтвердил вход — это не ошибка
            sendJson(ex, 200, Map.of("ok", true, "status", "pending"));
        } catch (MicrosoftAuth.AuthError e) {
            pendingDeviceCode = null;
            sendJson(ex, 400, Map.of("ok", false, "status", "error", "error", e.getMessage()));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "status", "error", "error", String.valueOf(e.getMessage())));
        }
    }

    private void handleVersions(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("popular", VersionManager.getPopularVersions());
            out.put("versions", VersionManager.getCatalogVersions());
            sendJson(ex, 200, out);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleLaunch(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            String mode = body.has("mode") ? body.get("mode").getAsString() : "pulse";
            LauncherConfig cfg = LauncherConfig.get();
            String version = body.has("version")
                ? body.get("version").getAsString()
                : ("vanilla".equals(mode) ? cfg.vanillaVersion : cfg.selectedVersion);
            String loaderId = body.has("loaderId")
                ? body.get("loaderId").getAsString()
                : ("vanilla".equals(mode) ? cfg.vanillaLoaderId : cfg.pulseLoaderId);

            if ("vanilla".equals(mode)) cfg.vanillaVersion = version;
            else cfg.selectedVersion = version;
            if ("vanilla".equals(mode)) cfg.vanillaLoaderId = loaderId;
            else cfg.pulseLoaderId = loaderId;
            cfg.save();

            if (cfg.autoDisableIncompatibleMods && !"vanilla".equals(mode)) {
                ModManager.autoDisableIncompatible(version, mode);
            }

            // Reset progress before the background launch starts so the UI can poll it
            launcher.minecraft.LaunchProgress.begin();

            final String finalLoaderId = loaderId;
            final String finalVersion = version;
            final String finalMode = mode;
            new Thread(() -> {
                try {
                    MinecraftLauncher.launch(finalVersion, finalMode, finalLoaderId);
                } catch (Exception err) {
                    System.err.println("[pulsePLUS] Launch error: " + err.getMessage());
                    launcher.minecraft.LaunchProgress.fail("Ошибка запуска: " + err.getMessage());
                }
            }, "mc-launch").start();

            sendJson(ex, 200, Map.of("ok", true, "version", version, "mode", mode, "loaderId", loaderId));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleLaunchProgress(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        sendJson(ex, 200, launcher.minecraft.LaunchProgress.snapshot());
    }

    private void handleMods(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        String method = ex.getRequestMethod().toUpperCase();
        LauncherConfig cfg = LauncherConfig.get();

        if ("GET".equals(method)) {
            try {
                String mode = queryParam(ex, "mode", cfg.lastMode);
                String targetVersion = "vanilla".equalsIgnoreCase(mode) ? cfg.vanillaVersion : cfg.selectedVersion;
                // Pass mode so mods are read from the correct profile folder
                List<ModManager.ModEntry> mods = ModManager.listMods(targetVersion, mode);
                sendJson(ex, 200, Map.of("mods", mods));
            } catch (Exception e) {
                sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
            }
            return;
        }

        if ("POST".equals(method)) {
            try {
                JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
                String action = body.has("action") ? body.get("action").getAsString() : "";
                String name = body.has("name") ? body.get("name").getAsString() : "";
                String mcVersion = body.has("mcVersion") ? body.get("mcVersion").getAsString() : cfg.selectedVersion;
                // "mode" routes the operation to the correct profile folder
                String mode = body.has("mode") ? body.get("mode").getAsString() : cfg.lastMode;
                if ("enable".equals(action)) ModManager.enableMod(name, mcVersion, mode);
                else if ("disable".equals(action)) ModManager.disableMod(name, mcVersion, mode);
                else if ("restore".equals(action)) ModManager.restoreSnapshot(mcVersion, mode);
                else {
                    sendJson(ex, 400, Map.of("ok", false, "error", "Unknown action"));
                    return;
                }
                sendJson(ex, 200, Map.of("ok", true));
            } catch (Exception e) {
                sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
            }
            return;
        }

        send(ex, 405, "text/plain", "Method Not Allowed");
    }

    private void handleAutoDisableMods(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        try {
            LauncherConfig cfg = LauncherConfig.get();
            String mcVersion = queryParam(ex, "mcVersion", cfg.selectedVersion);
            String mode = queryParam(ex, "mode", cfg.lastMode);
            ModManager.AutoDisableResult result = ModManager.autoDisableIncompatible(mcVersion, mode);
            sendJson(ex, 200, Map.of(
                "ok", true,
                "disabled", result.disabled(),
                "kept", result.kept()
            ));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleCheckModUpdates(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        try {
            LauncherConfig cfg = LauncherConfig.get();
            String mcVersion = queryParam(ex, "mcVersion", cfg.selectedVersion);
            String mode = queryParam(ex, "mode", cfg.lastMode);
            List<ModManager.ModEntry> mods = ModManager.listMods(mcVersion, mode);
            sendJson(ex, 200, Map.of(
                "ok", true,
                "autoUpdateEnabled", cfg.autoUpdateMods,
                "results", ModUpdateService.check(mods)
            ));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleModInstall(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            String mcVersion = body.has("mcVersion") ? body.get("mcVersion").getAsString() : LauncherConfig.get().selectedVersion;
            String loader    = body.has("loader")    ? body.get("loader").getAsString()    : "fabric";
            // "mode" tells us which profile folder to use (pulse or vanilla)
            String mode      = body.has("mode")      ? body.get("mode").getAsString()      : LauncherConfig.get().lastMode;

            /* Две дороги. Обычная — по slug, когда ставится последняя подходящая
               версия. Вторая — по прямой ссылке: так ставится конкретная версия,
               выбранная вручную, и она одна на оба источника. */
            String fileName;
            if (body.has("downloadUrl") && !body.get("downloadUrl").getAsString().isBlank()) {
                fileName = ModInstallService.installFromUrl(
                    body.get("downloadUrl").getAsString(),
                    body.has("fileName") ? body.get("fileName").getAsString() : "",
                    mcVersion, mode);
            } else {
                String slug = body.has("slug") ? body.get("slug").getAsString() : "";
                if (slug.isBlank()) { sendJson(ex, 400, Map.of("ok", false, "error", "slug is required")); return; }
                fileName = ModInstallService.install(slug, mcVersion, loader, mode);
            }
            sendJson(ex, 200, Map.of("ok", true, "filename", fileName, "mode", mode));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    /**
     * Ставит набор модов производительности (см. PerformancePack).
     * Результат отдаём по каждому моду отдельно: если связь оборвётся на середине,
     * будет видно, что успело встать, а что нет.
     */
    private void handleInstallPerformance(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            LauncherConfig cfg = LauncherConfig.get();
            String mcVersion = body != null && body.has("mcVersion")
                ? body.get("mcVersion").getAsString() : cfg.vanillaVersion;
            String loader = body != null && body.has("loader")
                ? body.get("loader").getAsString() : "fabric";
            String mode = body != null && body.has("mode")
                ? body.get("mode").getAsString() : "vanilla";

            List<Map<String, Object>> rows = new ArrayList<>();
            int ok = 0;
            int failed = 0;
            for (String slug : PerformancePack.ORDER) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("slug", slug);
                row.put("name", PerformancePack.name(slug));
                try {
                    row.put("file", ModInstallService.install(slug, mcVersion, loader, mode));
                    row.put("ok", true);
                    ok++;
                } catch (Exception e) {
                    row.put("ok", false);
                    row.put("error", String.valueOf(e.getMessage()));
                    failed++;
                }
                rows.add(row);
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", failed == 0);
            out.put("installed", ok);
            out.put("failed", failed);
            out.put("results", rows);
            sendJson(ex, 200, out);
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", String.valueOf(e.getMessage())));
        }
    }

    private void handleModAutoInstall(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            JsonObject body  = GSON.fromJson(readBody(ex), JsonObject.class);
            String mcVersion = body.has("mcVersion") ? body.get("mcVersion").getAsString() : LauncherConfig.get().selectedVersion;
            String loader    = body.has("loader")    ? body.get("loader").getAsString()    : "fabric";
            String mode      = body.has("mode")      ? body.get("mode").getAsString()      : LauncherConfig.get().lastMode;
            List<String> installed = ModInstallService.autoInstall(mcVersion, loader, mode);
            sendJson(ex, 200, Map.of("ok", true, "installed", installed));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleLoadersCatalog(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        try {
            String version = queryParam(ex, "version", LauncherConfig.get().vanillaVersion);
            sendJson(ex, 200, Map.of(
                "ok", true,
                "version", version,
                "loaders", CatalogService.getLoaders(version)
            ));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleModsCatalog(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        try {
            String version = queryParam(ex, "version", LauncherConfig.get().vanillaVersion);
            String loader = queryParam(ex, "loader", "fabric");
            String query = queryParam(ex, "query", "");
            String source = queryParam(ex, "source", LauncherConfig.get().modSource);
            int limit = Integer.parseInt(queryParam(ex, "limit", "12"));
            int offset = Integer.parseInt(queryParam(ex, "offset", "0"));
            // Пустая строка означает «группы не выбраны» — тогда фильтра нет
            String categoriesParam = queryParam(ex, "categories", "");
            List<String> categories = categoriesParam.isBlank()
                ? List.of()
                : List.of(categoriesParam.split(","));
            sendJson(ex, 200, Map.of(
                "ok", true,
                "version", version,
                "loader", loader,
                "source", source,
                "offset", offset,
                "results", CatalogService.searchMods(version, loader, query, limit, source, categories, offset)
            ));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    /** Группы модов. Список один на оба источника — см. CatalogService.CATEGORIES. */
    private void handleCatalogCategories(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        try {
            sendJson(ex, 200, Map.of("ok", true, "categories", CatalogService.categories()));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    /** Полное описание проекта: у Modrinth это markdown, у CurseForge — HTML. */
    private void handleCatalogProject(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        try {
            String slug = queryParam(ex, "slug", "");
            String source = queryParam(ex, "source", LauncherConfig.get().modSource);
            if (slug.isBlank()) { sendJson(ex, 400, Map.of("ok", false, "error", "slug is required")); return; }
            sendJson(ex, 200, Map.of("ok", true, "project", CatalogService.projectDetail(source, slug)));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    /** Список версий проекта под текущую сборку — для выбора вручную. */
    private void handleCatalogVersions(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        try {
            String slug = queryParam(ex, "slug", "");
            String source = queryParam(ex, "source", LauncherConfig.get().modSource);
            String version = queryParam(ex, "version", "");
            String loader = queryParam(ex, "loader", "");
            if (slug.isBlank()) { sendJson(ex, 400, Map.of("ok", false, "error", "slug is required")); return; }
            sendJson(ex, 200, Map.of("ok", true,
                "versions", CatalogService.projectVersions(source, slug, version, loader)));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleConfig(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            LauncherConfig cfg = LauncherConfig.get();
            if (body.has("ramMb")) cfg.ramMb = body.get("ramMb").getAsInt();
            if (body.has("autoUpdateMods")) cfg.autoUpdateMods = body.get("autoUpdateMods").getAsBoolean();
            if (body.has("autoDisableIncompatibleMods")) cfg.autoDisableIncompatibleMods = body.get("autoDisableIncompatibleMods").getAsBoolean();
            if (body.has("useDownloadedModsLibrary")) cfg.useDownloadedModsLibrary = body.get("useDownloadedModsLibrary").getAsBoolean();
            if (body.has("musicEnabled")) cfg.musicEnabled = body.get("musicEnabled").getAsBoolean();
            if (body.has("musicVolume")) cfg.musicVolume = body.get("musicVolume").getAsInt();
            if (body.has("lastMode")) cfg.lastMode = body.get("lastMode").getAsString();
            if (body.has("userName")) cfg.userName = body.get("userName").getAsString();
            if (body.has("javaPath")) cfg.javaPath = body.get("javaPath").getAsString();
            if (body.has("msaClientId")) cfg.msaClientId = body.get("msaClientId").getAsString().trim();
            if (body.has("curseforgeKey")) cfg.curseforgeKey = body.get("curseforgeKey").getAsString().trim();
            if (body.has("modSource")) cfg.modSource = body.get("modSource").getAsString().trim();
            if (body.has("selectedVersion")) cfg.selectedVersion = body.get("selectedVersion").getAsString();
            if (body.has("vanillaVersion")) cfg.vanillaVersion = body.get("vanillaVersion").getAsString();
            if (body.has("pulseLoaderId")) cfg.pulseLoaderId = body.get("pulseLoaderId").getAsString();
            if (body.has("vanillaLoaderId")) cfg.vanillaLoaderId = body.get("vanillaLoaderId").getAsString();
            cfg.save();
            sendJson(ex, 200, Map.of("ok", true));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void cors(HttpExchange ex) {
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
    }

    private void send(HttpExchange ex, int code, String ct, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", ct + "; charset=UTF-8");
        ex.sendResponseHeaders(code, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }

    private void sendJson(HttpExchange ex, int code, Object data) throws IOException {
        send(ex, code, "application/json", GSON.toJson(data));
    }

    private String readBody(HttpExchange ex) throws IOException {
        return new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }

    private String queryParam(HttpExchange ex, String key, String fallback) {
        String query = ex.getRequestURI().getRawQuery();
        if (query == null || query.isBlank()) return fallback;
        for (String part : query.split("&")) {
            int idx = part.indexOf('=');
            if (idx <= 0) continue;
            String name = java.net.URLDecoder.decode(part.substring(0, idx), StandardCharsets.UTF_8);
            if (!key.equals(name)) continue;
            return java.net.URLDecoder.decode(part.substring(idx + 1), StandardCharsets.UTF_8);
        }
        return fallback;
    }

    private byte[] readResource(String path) {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(path)) {
            if (is == null) return null;
            return is.readAllBytes();
        } catch (IOException e) {
            return null;
        }
    }

    private String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=UTF-8";
        if (path.endsWith(".css")) return "text/css; charset=UTF-8";
        if (path.endsWith(".js")) return "application/javascript; charset=UTF-8";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".mp4")) return "video/mp4";
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".wav")) return "audio/wav";
        if (path.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private void handleMusicState(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        sendJson(ex, 200, MusicManager.state());
    }

    private void handleMusicTracks(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        sendJson(ex, 200, Map.of(
            "ok", true,
            "tracks", MusicManager.discoverTrackNames()
        ));
    }

    private void handleMusicFile(HttpExchange ex) throws IOException {
        cors(ex);
        String name = queryParam(ex, "name", "");
        if (name.isBlank()) {
            send(ex, 400, "text/plain", "Missing file name");
            return;
        }
        Path file = LauncherConfig.musicDir().resolve(name).normalize();
        if (!file.startsWith(LauncherConfig.musicDir()) || !Files.exists(file) || Files.isDirectory(file)) {
            send(ex, 404, "text/plain", "Not Found");
            return;
        }
        byte[] bytes = Files.readAllBytes(file);
        ex.getResponseHeaders().set("Content-Type", contentType(file.getFileName().toString()));
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private void handleMusicToggle(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        sendJson(ex, 200, MusicManager.toggle());
    }

    private void handleMusicNext(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        sendJson(ex, 200, MusicManager.next());
    }

    private void handleMusicVolume(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
            send(ex, 204, "text/plain", "");
            return;
        }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            send(ex, 405, "text/plain", "POST only");
            return;
        }
        JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
        double volume = body != null && body.has("volume") ? body.get("volume").getAsDouble() : 0.7d;
        sendJson(ex, 200, MusicManager.updateVolume(volume));
    }

    private void handleVideos(HttpExchange ex) throws IOException {
        cors(ex);
        if (!ex.getRequestMethod().equalsIgnoreCase("GET") && !ex.getRequestMethod().equalsIgnoreCase("HEAD")) {
            send(ex, 405, "text/plain", "Method Not Allowed");
            return;
        }
        String uriPath = ex.getRequestURI().getPath(); // e.g. /videos/pulsePLUS_play.mp4
        if (uriPath.contains("..")) { send(ex, 403, "text/plain", "Forbidden"); return; }
        String filename = uriPath.substring(uriPath.lastIndexOf('/') + 1);
        if (filename.isBlank()) { send(ex, 400, "text/plain", "Bad Request"); return; }

        Path videoFile = resolveVideo(filename);
        if (videoFile == null) {
            send(ex, 404, "text/plain", "Video not found: " + filename);
            return;
        }

        long fileSize = Files.size(videoFile);
        String rangeHeader = ex.getRequestHeaders().getFirst("Range");
        ex.getResponseHeaders().set("Content-Type", "video/mp4");
        ex.getResponseHeaders().set("Accept-Ranges", "bytes");
        ex.getResponseHeaders().set("Cache-Control", "public, max-age=86400");

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            // Partial content for video seeking
            String[] parts = rangeHeader.substring(6).split("-");
            long start = parts[0].isBlank() ? 0 : Long.parseLong(parts[0]);
            long end = (parts.length > 1 && !parts[1].isBlank()) ? Long.parseLong(parts[1]) : fileSize - 1;
            if (end >= fileSize) end = fileSize - 1;
            long length = end - start + 1;
            ex.getResponseHeaders().set("Content-Range", "bytes " + start + "-" + end + "/" + fileSize);
            ex.sendResponseHeaders(206, length);
            if (!ex.getRequestMethod().equalsIgnoreCase("HEAD")) {
                try (var fis = Files.newInputStream(videoFile); var out = ex.getResponseBody()) {
                    fis.skip(start);
                    byte[] buf = new byte[65536];
                    long remaining = length;
                    int read;
                    while (remaining > 0 && (read = fis.read(buf, 0, (int) Math.min(buf.length, remaining))) != -1) {
                        out.write(buf, 0, read);
                        remaining -= read;
                    }
                }
            }
        } else {
            ex.sendResponseHeaders(200, fileSize);
            if (!ex.getRequestMethod().equalsIgnoreCase("HEAD")) {
                try (var fis = Files.newInputStream(videoFile); var out = ex.getResponseBody()) {
                    byte[] buf = new byte[65536];
                    int read;
                    while ((read = fis.read(buf)) != -1) out.write(buf, 0, read);
                }
            }
        }
        ex.close();
    }

    /**
     * Resolve a background video by name.
     *
     * The user's own copy in {@code %APPDATA%/pulsePLUS/videos} wins, so backgrounds can
     * be swapped without touching the installation. The copy shipped next to the JAR is
     * the fallback and keeps a fresh install working before anything is seeded.
     * Returns null when the name resolves outside both folders or does not exist.
     */
    private Path resolveVideo(String filename) {
        Path userDir = LauncherConfig.videosDir();
        Path userFile = userDir.resolve(filename).normalize();
        if (userFile.startsWith(userDir) && Files.exists(userFile)) return userFile;

        Path jarDir;
        try {
            jarDir = Path.of(WebServer.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParent();
        } catch (Exception e) {
            jarDir = Path.of(".");
        }
        Path jarVideos = jarDir.resolve("videos");
        Path jarFile = jarVideos.resolve(filename).normalize();
        return (jarFile.startsWith(jarVideos) && Files.exists(jarFile)) ? jarFile : null;
    }

    private void handleSaveBytebeatFormula(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            String filename = body.has("filename") ? body.get("filename").getAsString() : "";
            String formula = body.has("formula") ? body.get("formula").getAsString() : "";
            if (filename.isBlank() || formula.isBlank()) {
                sendJson(ex, 400, Map.of("ok", false, "error", "filename and formula required"));
                return;
            }
            Path file = LauncherConfig.musicDir().resolve(filename).normalize();
            if (!file.startsWith(LauncherConfig.musicDir()) || file.getFileName().toString().contains("..")) {
                sendJson(ex, 403, Map.of("ok", false, "error", "Invalid filename"));
                return;
            }
            Files.createDirectories(LauncherConfig.musicDir());
            Files.writeString(file, formula, StandardCharsets.UTF_8);
            sendJson(ex, 200, Map.of("ok", true, "filename", filename));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private void handleDeleteBytebeatFile(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { send(ex, 405, "text/plain", "POST only"); return; }
        try {
            JsonObject body = GSON.fromJson(readBody(ex), JsonObject.class);
            String filename = body.has("filename") ? body.get("filename").getAsString() : "";
            if (filename.isBlank()) {
                sendJson(ex, 400, Map.of("ok", false, "error", "filename required"));
                return;
            }
            Path file = LauncherConfig.musicDir().resolve(filename).normalize();
            if (!file.startsWith(LauncherConfig.musicDir()) || !Files.exists(file)) {
                sendJson(ex, 404, Map.of("ok", false, "error", "File not found"));
                return;
            }
            Files.delete(file);
            sendJson(ex, 200, Map.of("ok", true));
        } catch (Exception e) {
            sendJson(ex, 500, Map.of("ok", false, "error", e.getMessage()));
        }
    }
}
