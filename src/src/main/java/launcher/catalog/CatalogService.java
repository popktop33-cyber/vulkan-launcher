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
        if (cached != null && now - cached.timeMs < LOADER_TTL_MS) {
            return cached.value;
        }

        List<Map<String, Object>> loaded = loadLoaders(cacheKey);
        LOADER_CACHE.put(cacheKey, new CacheEntry<>(now, loaded));
        return loaded;
    }

    public static List<Map<String, Object>> searchMods(String version, String loader, String query, int limit) throws Exception {
        String loaderKey = normalizeLoader(loader);
        String versionKey = version == null ? "" : version.trim();
        String queryKey = query == null ? "" : query.trim();
        String cacheKey = versionKey + "|" + loaderKey + "|" + queryKey + "|" + limit;
        long now = System.currentTimeMillis();
        CacheEntry<List<Map<String, Object>>> cached = MOD_CACHE.get(cacheKey);
        if (cached != null && now - cached.timeMs < MODS_TTL_MS) {
            return cached.value;
        }

        List<Map<String, Object>> loaded = loadMods(versionKey, loaderKey, queryKey, limit);
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

    private static List<Map<String, Object>> loadMods(String version, String loader, String query, int limit) {
        if (loader.isBlank() || "vanilla".equals(loader)) {
            return List.of();
        }
        try {
            String resolvedQuery = query.isBlank() ? "optimization" : query;
            String facets = "[[\"versions:" + version + "\"],[\"categories:" + loader + "\"],[\"project_type:mod\"]]";
            String url = "https://api.modrinth.com/v2/search?query=" + encode(resolvedQuery)
                + "&facets=" + encode(facets)
                + "&limit=" + Math.max(1, Math.min(limit, 30))
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
                row.put("iconUrl", stringOr(hit, "icon_url", ""));
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
