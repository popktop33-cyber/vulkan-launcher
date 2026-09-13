package launcher.catalog;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import launcher.minecraft.LoaderStore;
import launcher.minecraft.VersionManager;

public final class CatalogService {
    private static final Gson GSON = new Gson();
    // Follow redirects — Forge/NeoForge/Modrinth endpoints may 3xx
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private static final long LOADER_TTL_MS = 15 * 60 * 1000L;
    private static final long MODS_TTL_MS = 60 * 1000L;

    private static final Map<String, CacheEntry<List<Map<String, Object>>>> LOADER_CACHE = new ConcurrentHashMap<>();
    private static final Map<String, CacheEntry<List<Map<String, Object>>>> MOD_CACHE = new ConcurrentHashMap<>();

    private CatalogService() {}

    public static List<Map<String, Object>> getLoaders(String version) throws Exception {
        String cacheKey = version == null ? "" : version.trim();
        long now = System.currentTimeMillis();
        CacheEntry<List<Map<String, Object>>> cached = LOADER_CACHE.get(cacheKey);
        List<Map<String, Object>> list;
        if (cached != null && now - cached.timeMs < LOADER_TTL_MS) {
            list = cached.value;
        } else {
            list = loadLoaders(cacheKey);
            LOADER_CACHE.put(cacheKey, new CacheEntry<>(now, list));
        }
        // Пометку «уже собрана» ставим при каждом обращении, а не один раз вместе
        // с загрузкой списка: сам список живёт в кэше четверть часа, а сборка
        // появляется на диске в любой момент — иначе игрок поставит загрузчик
        // и не увидит, что тот готов, пока кэш не истечёт.
        return withInstalled(list, cacheKey);
    }

    /**
     * Дополнить каталог тем, что уже собрано на диске.
     *
     * Каждый источник отдаёт только свежую сборку своей семьи, а собранная может
     * быть старше. Без этой вставки её не оказалось бы в списке вовсе: игрок
     * не увидел бы ни пометки, ни возможности её выбрать — а выбранная строка
     * молча уехала бы на свежую, то есть на новую загрузку поверх готового.
     */
    private static List<Map<String, Object>> withInstalled(List<Map<String, Object>> list, String mcVersion) {
        List<Map<String, Object>> onDisk = LoaderStore.installed(mcVersion);
        Set<String> built = new LinkedHashSet<>();
        for (Map<String, Object> row : onDisk) built.add(loaderKey(row));

        List<Map<String, Object>> out = new ArrayList<>(list);
        Set<String> shown = new LinkedHashSet<>();
        for (Map<String, Object> row : out) {
            String key = loaderKey(row);
            shown.add(key);
            // У ваниллы отдельной сборки нет — признак тот же, что в списке версий
            row.put("installed", "vanilla".equals(row.get("familyKey"))
                ? VersionManager.isInstalled(mcVersion)
                : built.contains(key));
        }
        for (Map<String, Object> row : onDisk) {
            if (shown.contains(loaderKey(row))) continue;
            Map<String, Object> extra = new LinkedHashMap<>(row);
            extra.put("id", row.get("familyKey") + ":" + row.get("build") + "@" + mcVersion);
            extra.put("channel", "");
            extra.put("recommended", false);
            extra.put("installed", true);
            out.add(extra);
        }
        out.sort(Comparator
            .comparingInt((Map<String, Object> row) -> familyOrder(String.valueOf(row.get("familyKey"))))
            .thenComparing(row -> String.valueOf(row.get("build")), Comparator.reverseOrder()));
        return out;
    }

    private static String loaderKey(Map<String, Object> row) {
        return row.get("familyKey") + "|" + row.get("build");
    }

    /* ── Группы модов ───────────────────────────────────────────────────────────
       Один список на оба источника: у Modrinth категории текстовые, у CurseForge
       числовые, и сводить их на лету — значит показывать пользователю разные
       наборы чипов при переключении источника.

       У CurseForge поиск принимает только ОДНУ категорию (categoryId), а не
       набор, поэтому при нескольких выбранных группах в запрос уходит первая.
       Это ограничение их API, а не наше. */
    public record CategoryGroup(String id, String label, String modrinth, String curseforge) {}

    private static final List<CategoryGroup> CATEGORIES = List.of(
        new CategoryGroup("optimization", "Оптимизация",     "optimization",  "6814"),
        new CategoryGroup("library",      "Библиотеки",      "library",       "421"),
        new CategoryGroup("technology",   "Технологии",      "technology",    "412"),
        new CategoryGroup("magic",        "Магия",           "magic",         "419"),
        new CategoryGroup("worldgen",     "Генерация мира",  "worldgen",      "406"),
        new CategoryGroup("mobs",         "Мобы",            "mobs",          "411"),
        new CategoryGroup("adventure",    "Приключения",     "adventure",     "422"),
        new CategoryGroup("decoration",   "Украшения",       "decoration",    "424"),
        new CategoryGroup("storage",      "Хранилища",       "storage",       "420"),
        new CategoryGroup("utility",      "Утилиты",         "utility",       "5191"),
        new CategoryGroup("food",         "Еда",             "food",          "436"),
        new CategoryGroup("equipment",    "Снаряжение",      "equipment",     "434")
    );

    public static List<Map<String, Object>> categories() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (CategoryGroup g : CATEGORIES) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", g.id());
            row.put("label", g.label());
            out.add(row);
        }
        return out;
    }

    /** Числовой id группы для CurseForge — нужен источнику модов. */
    public static String curseforgeCategory(String id) {
        CategoryGroup g = category(id);
        return g == null ? "" : g.curseforge();
    }

    private static CategoryGroup category(String id) {
        for (CategoryGroup g : CATEGORIES) {
            if (g.id().equals(id)) return g;
        }
        return null;
    }

    public static List<Map<String, Object>> searchMods(String version, String loader, String query, int limit) throws Exception {
        return searchMods(version, loader, query, limit, "modrinth", List.of(), 0);
    }

    /**
     * Поиск с выбором источника и групп. CurseForge отдаёт ту же форму строки,
     * поэтому вызывающий код о source больше нигде не думает.
     *
     * @param categoryIds выбранные группы (наши id, не исходные)
     * @param offset      сколько результатов пропустить — для «показать больше»
     */
    public static List<Map<String, Object>> searchMods(String version, String loader, String query,
                                                       int limit, String source,
                                                       List<String> categoryIds, int offset) throws Exception {
        if ("curseforge".equalsIgnoreCase(source)) {
            return CurseForgeSource.search(version, loader, query, limit, categoryIds, offset);
        }
        return searchModrinth(version, loader, query, limit, categoryIds, offset);
    }

    private static List<Map<String, Object>> searchModrinth(String version, String loader, String query,
                                                               int limit, List<String> categoryIds, int offset) throws Exception {
        String loaderKey = normalizeLoader(loader);
        String versionKey = version == null ? "" : version.trim();
        String queryKey = query == null ? "" : query.trim();
        String cacheKey = versionKey + "|" + loaderKey + "|" + queryKey + "|" + limit
            + "|" + String.join(",", categoryIds) + "|" + offset;
        long now = System.currentTimeMillis();
        CacheEntry<List<Map<String, Object>>> cached = MOD_CACHE.get(cacheKey);
        if (cached != null && now - cached.timeMs < MODS_TTL_MS) {
            return cached.value;
        }

        List<Map<String, Object>> loaded = loadMods(versionKey, loaderKey, queryKey, limit, categoryIds, offset);
        MOD_CACHE.put(cacheKey, new CacheEntry<>(now, loaded));
        return loaded;
    }

    private static List<Map<String, Object>> loadLoaders(String version) throws Exception {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(loaderRow("vanilla", version, version, "", true));

        // Query the four loader sources in parallel so a single slow/unreachable one
        // (e.g. NeoForge maven timing out) doesn't serialize behind the others.
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(5);
        try {
            var fFabric   = pool.submit(() -> loadFabric(version));
            var fForge    = pool.submit(() -> loadForge(version));
            var fNeoForge = pool.submit(() -> loadNeoForge(version));
            var fQuilt    = pool.submit(() -> loadQuilt(version));
            var fOpti     = pool.submit(() -> loadOptiFine(version));
            rows.addAll(safeGet(fFabric));
            rows.addAll(safeGet(fForge));
            rows.addAll(safeGet(fNeoForge));
            rows.addAll(safeGet(fQuilt));
            rows.addAll(safeGet(fOpti));
        } finally {
            pool.shutdownNow();
        }

        Map<String, Map<String, Object>> unique = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            unique.putIfAbsent(String.valueOf(row.get("id")), row);
        }

        return unique.values().stream()
            .sorted(Comparator
                .comparingInt((Map<String, Object> row) -> familyOrder(String.valueOf(row.get("familyKey"))))
                .thenComparing(row -> String.valueOf(row.get("build")), Comparator.reverseOrder()))
            .toList();
    }

    /** Get a future's result, or an empty list if it failed/was interrupted. */
    private static List<Map<String, Object>> safeGet(java.util.concurrent.Future<List<Map<String, Object>>> f) {
        try {
            return f.get(12, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception e) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadFabric(String version) {
        try {
            JsonArray arr = readJsonArray("https://meta.fabricmc.net/v2/versions/loader/" + encode(version));
            List<Map<String, Object>> out = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            for (JsonElement el : arr) {
                JsonObject obj = el.getAsJsonObject();
                if (!obj.has("loader")) continue;
                JsonObject loader = obj.getAsJsonObject("loader");
                String build = loader.get("version").getAsString();
                if (!seen.add(build)) continue;
                out.add(loaderRow("fabric", version, build, "", out.isEmpty()));
                if (out.size() >= 1) break;
            }
            return out;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadForge(String version) {
        try {
            JsonObject root = readJsonObject("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
            JsonObject promos = root.getAsJsonObject("promos");
            if (promos == null) return List.of();
            List<Map<String, Object>> out = new ArrayList<>();
            String recommended = promos.has(version + "-recommended") ? promos.get(version + "-recommended").getAsString() : "";
            String latest = promos.has(version + "-latest") ? promos.get(version + "-latest").getAsString() : "";
            // Just one build: prefer the recommended, else latest.
            if (!recommended.isBlank()) out.add(loaderRow("forge", version, recommended, "recommended", true));
            else if (!latest.isBlank()) out.add(loaderRow("forge", version, latest, "latest", true));
            return out;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadQuilt(String version) {
        try {
            JsonArray arr = readJsonArray("https://meta.quiltmc.org/v3/versions/loader/" + encode(version));
            List<Map<String, Object>> out = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            for (JsonElement el : arr) {
                JsonObject obj = el.getAsJsonObject();
                if (!obj.has("loader")) continue;
                JsonObject loader = obj.getAsJsonObject("loader");
                String build = loader.get("version").getAsString();
                if (!seen.add(build)) continue;
                out.add(loaderRow("quilt", version, build, "", out.isEmpty()));
                if (out.size() >= 1) break;
            }
            return out;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadNeoForge(String version) {
        try {
            JsonObject root = readJsonObject("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge");
            JsonArray versions = root.getAsJsonArray("versions");
            if (versions == null) return List.of();

            String prefix = neoForgePrefix(version);
            List<String> filtered = new ArrayList<>();
            for (JsonElement el : versions) {
                String value = el.getAsString();
                if (value.startsWith(prefix + ".") || value.startsWith(prefix + "-") || value.equals(prefix)) {
                    filtered.add(value);
                }
            }
            filtered.sort(CatalogService::compareVersionStringsDesc);

            List<Map<String, Object>> out = new ArrayList<>();
            for (String build : filtered.stream().limit(1).toList()) {
                out.add(loaderRow("neoforge", version, build, "", out.isEmpty()));
            }
            return out;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadOptiFine(String version) {
        try {
            // BMCLAPI mirrors OptiFine downloads (optifine.net itself is ad-gated).
            JsonArray arr = readJsonArray("https://bmclapi2.bangbang93.com/optifine/" + encode(version));
            for (JsonElement el : arr) {
                JsonObject o = el.getAsJsonObject();
                String type = o.has("type") ? o.get("type").getAsString() : "";
                String patch = o.has("patch") ? o.get("patch").getAsString() : "";
                String filename = o.has("filename") ? o.get("filename").getAsString() : "";
                // Skip previews — take the first stable HD_U release
                if (filename.startsWith("preview_") || patch.contains("pre")) continue;
                if (!type.startsWith("HD_U")) continue;
                String build = type + "_" + patch;               // e.g. HD_U_I6
                return List.of(loaderRow("optifine", version, build, "", false));
            }
            return List.of();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<Map<String, Object>> loadMods(String version, String loader, String query,
                                                      int limit, List<String> categoryIds, int offset) {
        if (loader.isBlank() || "vanilla".equals(loader)) {
            return List.of();
        }
        try {
            /* Пустой запрос означал «покажи хоть что-нибудь», и туда подставлялось
               слово optimization. С выбранной группой это ломало фильтр: текст
               перебивал категорию, и «Магия» возвращала один мод про оптимизацию.
               Когда группа выбрана, поиск идёт по пустому запросу — тогда работает
               именно фасет. */
            String resolvedQuery = !query.isBlank() ? query
                : (categoryIds != null && !categoryIds.isEmpty() ? "" : "optimization");

            /* Группы внутри одной группы фасетов Modrinth складывает по ИЛИ,
               а сами группы между собой — по И. Отсюда две отдельные скобки:
               загрузчик и категории не должны смешиваться. */
            StringBuilder facets = new StringBuilder("[[\"versions:").append(version)
                .append("\"],[\"categories:").append(loader)
                .append("\"],[\"project_type:mod\"]");
            List<String> modrinthCats = new ArrayList<>();
            for (String id : categoryIds) {
                CategoryGroup g = category(id);
                if (g != null) modrinthCats.add("\"categories:" + g.modrinth() + "\"");
            }
            if (!modrinthCats.isEmpty()) {
                facets.append(",[").append(String.join(",", modrinthCats)).append("]");
            }
            facets.append("]");

            String url = "https://api.modrinth.com/v2/search?query=" + encode(resolvedQuery)
                + "&facets=" + encode(facets.toString())
                + "&limit=" + Math.max(1, Math.min(limit, 30))
                + "&offset=" + Math.max(0, offset)
                + "&index=relevance";
            JsonObject root = readJsonObject(url);
            JsonArray hits = root.getAsJsonArray("hits");
            if (hits == null) return List.of();

            List<Map<String, Object>> out = new ArrayList<>();
            for (JsonElement el : hits) {
                JsonObject hit = el.getAsJsonObject();
                Map<String, Object> row = new LinkedHashMap<>();
                String slug = stringOr(hit, "slug", "");
                row.put("name", stringOr(hit, "title", slug));
                row.put("author", stringOr(hit, "organization", stringOr(hit, "author", "")));
                row.put("desc", stringOr(hit, "description", ""));
                row.put("slug", slug);
                row.put("url", "https://modrinth.com/mod/" + slug);
                // У Modrinth иконка уже 96px WebP — одна и та же для списка и панели
                row.put("iconUrl", stringOr(hit, "icon_url", ""));
                row.put("iconSmall", stringOr(hit, "icon_url", ""));
                row.put("downloads", hit.has("downloads") ? hit.get("downloads").getAsLong() : 0L);
                row.put("loaders", collectLoaderCategories(hit.getAsJsonArray("categories")));
                row.put("versions", collectStrings(hit.getAsJsonArray("versions")));
                row.put("clientSide", stringOr(hit, "client_side", ""));
                row.put("serverSide", stringOr(hit, "server_side", ""));
                out.add(row);
            }
            return out;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    /* ── Полное описание и список версий ────────────────────────────────────────
       Форма ответа у обоих источников одна и та же, различается только формат
       тела: Modrinth отдаёт markdown, CurseForge — готовый HTML. Разбирает его
       фронтенд, поэтому здесь тело уходит как есть, с пометкой format. */

    public static Map<String, Object> projectDetail(String source, String slug) throws Exception {
        if ("curseforge".equalsIgnoreCase(source)) {
            return CurseForgeSource.project(slug);
        }
        JsonObject p = readJsonObject("https://api.modrinth.com/v2/project/" + encode(slug));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", "modrinth");
        out.put("name", stringOr(p, "title", slug));
        out.put("slug", stringOr(p, "slug", slug));
        out.put("iconUrl", stringOr(p, "icon_url", ""));
        out.put("url", "https://modrinth.com/mod/" + stringOr(p, "slug", slug));
        out.put("downloads", p.has("downloads") ? p.get("downloads").getAsLong() : 0L);
        out.put("summary", stringOr(p, "description", ""));
        out.put("format", "markdown");
        out.put("body", stringOr(p, "body", ""));
        return out;
    }

    public static List<Map<String, Object>> projectVersions(String source, String slug,
                                                            String mcVersion, String loader) throws Exception {
        if ("curseforge".equalsIgnoreCase(source)) {
            return CurseForgeSource.versions(slug, mcVersion, loader);
        }

        StringBuilder url = new StringBuilder("https://api.modrinth.com/v2/project/")
            .append(encode(slug)).append("/version");
        List<String> params = new ArrayList<>();
        if (mcVersion != null && !mcVersion.isBlank()) {
            params.add("game_versions=" + encode("[\"" + mcVersion + "\"]"));
        }
        String family = normalizeLoader(loader);
        if (family != null && !family.isBlank()) {
            params.add("loaders=" + encode("[\"" + family + "\"]"));
        }
        if (!params.isEmpty()) url.append('?').append(String.join("&", params));

        JsonArray versions = readJsonArray(url.toString());
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonElement el : versions) {
            if (!el.isJsonObject()) continue;
            JsonObject v = el.getAsJsonObject();
            JsonArray files = v.getAsJsonArray("files");
            if (files == null || files.isEmpty()) continue;

            // Основной файл, а если такого нет — первый попавшийся
            JsonObject file = files.get(0).getAsJsonObject();
            for (JsonElement fEl : files) {
                JsonObject f = fEl.getAsJsonObject();
                if (f.has("primary") && f.get("primary").getAsBoolean()) { file = f; break; }
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", stringOr(v, "id", ""));
            row.put("name", stringOr(v, "name", stringOr(v, "version_number", "")));
            row.put("fileName", stringOr(file, "filename", ""));
            row.put("downloadUrl", stringOr(file, "url", ""));
            row.put("date", stringOr(v, "date_published", ""));
            row.put("downloads", v.has("downloads") ? v.get("downloads").getAsLong() : 0L);
            row.put("releaseType", releaseTypeRank(stringOr(v, "version_type", "release")));
            row.put("gameVersions", collectStrings(v.getAsJsonArray("game_versions")));
            row.put("loaders", collectStrings(v.getAsJsonArray("loaders")));
            out.add(row);
        }
        return out;
    }

    /* Modrinth называет тип словами, CurseForge — числами (1 release, 2 beta,
       3 alpha). Приводим к одному виду, чтобы фронтенд красил одинаково. */
    private static int releaseTypeRank(String type) {
        return switch (type == null ? "" : type.toLowerCase()) {
            case "beta" -> 2;
            case "alpha" -> 3;
            default -> 1;
        };
    }

    private static Map<String, Object> loaderRow(String familyKey, String mcVersion, String build, String channel, boolean recommended) {
        String family = switch (familyKey) {
            case "vanilla" -> "Vanilla";
            case "fabric" -> "Fabric";
            case "forge" -> "Forge";
            case "neoforge" -> "NeoForge";
            case "quilt" -> "Quilt";
            case "optifine" -> "OptiFine";
            default -> familyKey;
        };
        String id = "vanilla".equals(familyKey)
            ? "vanilla:" + mcVersion
            : familyKey + ":" + build + "@" + mcVersion;
        String label = "vanilla".equals(familyKey)
            ? family + " " + mcVersion
            : family + " " + build;

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", id);
        row.put("familyKey", familyKey);
        row.put("family", family);
        row.put("mcVersion", mcVersion);
        row.put("build", build);
        row.put("channel", channel);
        row.put("recommended", recommended);
        row.put("label", label);
        return row;
    }

    private static int familyOrder(String familyKey) {
        return switch (familyKey) {
            case "vanilla" -> 0;
            case "fabric" -> 1;
            case "forge" -> 2;
            case "neoforge" -> 3;
            case "quilt" -> 4;
            case "optifine" -> 5;
            default -> 9;
        };
    }

    private static String neoForgePrefix(String version) {
        if (version == null || version.isBlank()) return "";
        if (!version.startsWith("1.")) return version;
        String[] parts = version.split("\\.");
        if (parts.length < 2) return version;
        if (parts.length == 2) return parts[1];
        return parts[1] + "." + parts[2];
    }

    private static String normalizeLoader(String loader) {
        if (loader == null) return "";
        return loader.trim().toLowerCase();
    }

    private static List<String> collectStrings(JsonArray arr) {
        List<String> out = new ArrayList<>();
        if (arr == null) return out;
        for (JsonElement el : arr) {
            out.add(el.getAsString());
        }
        return out;
    }

    private static List<String> collectLoaderCategories(JsonArray arr) {
        List<String> out = new ArrayList<>();
        if (arr == null) return out;
        for (JsonElement el : arr) {
            String value = el.getAsString().toLowerCase();
            if (value.equals("fabric") || value.equals("forge") || value.equals("quilt") || value.equals("neoforge")) {
                out.add(switch (value) {
                    case "fabric" -> "Fabric";
                    case "forge" -> "Forge";
                    case "quilt" -> "Quilt";
                    case "neoforge" -> "NeoForge";
                    default -> value;
                });
            }
        }
        return out;
    }

    private static JsonObject readJsonObject(String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("User-Agent", "pulsePLUS-launcher")
            .timeout(java.time.Duration.ofSeconds(10))   // one dead source must not hang the whole loader list
            .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new IOException("HTTP " + resp.statusCode() + " for " + url);
        }
        return GSON.fromJson(resp.body(), JsonObject.class);
    }

    private static JsonArray readJsonArray(String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("User-Agent", "pulsePLUS-launcher")
            .timeout(java.time.Duration.ofSeconds(10))
            .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new IOException("HTTP " + resp.statusCode() + " for " + url);
        }
        return GSON.fromJson(resp.body(), JsonArray.class);
    }

    private static String stringOr(JsonObject obj, String key, String fallback) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsString() : fallback;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private static int compareVersionStringsDesc(String left, String right) {
        String[] a = left.split("[^0-9]+");
        String[] b = right.split("[^0-9]+");
        int len = Math.max(a.length, b.length);
        for (int i = 0; i < len; i++) {
            int av = i < a.length && !a[i].isBlank() ? Integer.parseInt(a[i]) : 0;
            int bv = i < b.length && !b[i].isBlank() ? Integer.parseInt(b[i]) : 0;
            if (av != bv) return Integer.compare(bv, av);
        }
        return right.compareTo(left);
    }

    private record CacheEntry<T>(long timeMs, T value) {}
}
