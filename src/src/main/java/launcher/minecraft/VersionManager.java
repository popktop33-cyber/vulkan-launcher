package launcher.minecraft;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import launcher.LauncherConfig;
import launcher.VersionCatalog;

public class VersionManager {

    private static final String MANIFEST_URL =
        "https://launchermeta.mojang.com/mc/game/version_manifest.json";
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private static final Gson GSON = new Gson();

    private static final List<Map<String, String>> POPULAR = List.of(
        Map.of("id", "1.8.9", "label", "PvP classic"),
        Map.of("id", "1.12.2", "label", "Legacy Forge"),
        Map.of("id", "1.16.5", "label", "Stable"),
        Map.of("id", "1.20.1", "label", "Forge popular"),
        Map.of("id", "1.20.4", "label", "Fabric LTS"),
        Map.of("id", "1.21.1", "label", "Recommended"),
        Map.of("id", "1.21.4", "label", "pulsePLUS"),
        Map.of("id", "1.21.5", "label", "Newest")
    );

    private static List<VersionEntry> cache = null;
    private static Map<String, String> urlCache = new HashMap<>();
    private static long cacheTime = 0;
    private static final long CACHE_TTL = 10 * 60 * 1000L;

    public record VersionEntry(String id, String type, String url, String releaseTime) {}

    public static List<VersionEntry> getVersions(boolean includeSnapshots) throws Exception {
        ensureCache();
        List<VersionEntry> list = cache;
        if (!includeSnapshots) {
            list = list.stream().filter(v -> "release".equals(v.type())).toList();
        }
        return sortAscendingByCatalog(list);
    }

    public static List<Map<String, String>> getPopularVersions() {
        return POPULAR;
    }

    public static List<Map<String, Object>> getCatalogVersions() throws Exception {
        Map<String, VersionEntry> byId = new LinkedHashMap<>();
        for (VersionEntry entry : getVersions(false)) {
            byId.put(entry.id(), entry);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (String id : VersionCatalog.defaultVersionRange()) {
            VersionEntry entry = byId.get(id);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", id);
            row.put("type", entry != null ? entry.type() : "release");
            row.put("available", entry != null);
            row.put("installed", isInstalled(id));
            row.put("label", labelFor(id));
            out.add(row);
        }
        return out;
    }

    /**
     * Скачана ли версия целиком.
     *
     * Признак — описание и клиент на диске. Библиотеки и ресурсы сюда не входят:
     * они общие для всех версий и лежат отдельно от них, так что спрашивать про
     * них у каждой версии было бы неправдой. Именно этот признак подсвечивается
     * в списке, чтобы было видно, что уже не придётся качать.
     */
    public static boolean isInstalled(String id) {
        Path dir = LauncherConfig.tlVersionsDir().resolve(id);
        Path json = dir.resolve(id + ".json");
        if (!Files.isRegularFile(json)) return false;
        try {
            JsonObject meta = GSON.fromJson(Files.readString(json), JsonObject.class);
            // У части версий клиент лежит под другим именем — это поле "jar"
            String jar = meta != null && meta.has("jar") ? meta.get("jar").getAsString() : id;
            Path jarPath = jar.equals(id)
                ? dir.resolve(id + ".jar")
                : LauncherConfig.tlVersionsDir().resolve(jar).resolve(jar + ".jar");
            return Files.isRegularFile(jarPath);
        } catch (Exception e) {
            return Files.isRegularFile(dir.resolve(id + ".jar"));
        }
    }

    public static String getVersionUrl(String version) throws Exception {
        ensureCache();
        if (urlCache.containsKey(version)) return urlCache.get(version);
        refreshCache();
        if (urlCache.containsKey(version)) return urlCache.get(version);
        throw new IllegalArgumentException("Version not found in Mojang API: " + version);
    }

    private static void ensureCache() throws Exception {
        if (cache == null || System.currentTimeMillis() - cacheTime > CACHE_TTL) {
            refreshCache();
        }
    }

    private static void refreshCache() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(new URI(MANIFEST_URL)).build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new java.io.IOException("Manifest HTTP " + resp.statusCode());
        }

        JsonObject root = GSON.fromJson(resp.body(), JsonObject.class);
        JsonArray versions = root.getAsJsonArray("versions");

        List<VersionEntry> list = new ArrayList<>();
        Map<String, String> urls = new HashMap<>();

        for (JsonElement el : versions) {
            JsonObject v = el.getAsJsonObject();
            String id = v.get("id").getAsString();
            String type = v.get("type").getAsString();
            String url = v.get("url").getAsString();
            String time = v.has("releaseTime") ? v.get("releaseTime").getAsString() : "";
            list.add(new VersionEntry(id, type, url, time));
            urls.put(id, url);
        }

        cache = Collections.unmodifiableList(list);
        urlCache = Collections.unmodifiableMap(urls);
        cacheTime = System.currentTimeMillis();
    }

    private static List<VersionEntry> sortAscendingByCatalog(List<VersionEntry> input) {
        Map<String, Integer> order = new HashMap<>();
        List<String> catalog = VersionCatalog.defaultVersionRange();
        for (int i = 0; i < catalog.size(); i++) {
            order.put(catalog.get(i), i);
        }
        return input.stream()
            .sorted(Comparator
                .comparingInt((VersionEntry v) -> order.getOrDefault(v.id(), Integer.MAX_VALUE))
                .thenComparing(VersionEntry::id))
            .toList();
    }

    private static String labelFor(String id) {
        return POPULAR.stream()
            .filter(p -> id.equals(p.get("id")))
            .map(p -> p.get("label"))
            .findFirst()
            .orElse("");
    }
}
