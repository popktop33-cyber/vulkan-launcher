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
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Источник модов на CurseForge.
 *
 * У CurseForge нет открытого API: запрос без ключа отдаёт 403, а ключ выдают
 * через console.curseforge.com. Поэтому по умолчанию идём через публичный
 * прокси api.curse.tools — он повторяет официальную схему один в один.
 * Если в настройках вписан свой ключ, идём напрямую в официальный API: он
 * надёжнее и не зависит от чужого сервера.
 *
 * Наружу отдаём те же поля, что и Modrinth, чтобы фронтенд не различал
 * источники и не обрастал ветвлениями.
 */
public final class CurseForgeSource {

    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(15))
        .build();

    /*
     * База прокси — именно /v1, а не документированный /v1/cf.
     *
     * На /v1/cf прокси отвечает 302 в http://…/v1/…, а Java по правилам
     * HttpClient.Redirect.NORMAL за HTTPS→HTTP редиректом не идёт и отдаёт
     * наружу голый 302. Канонический /v1 отвечает 200 сразу, без единого
     * редиректа — проверено на поиске, файлах и описании.
     */
    private static final String PROXY = "https://api.curse.tools/v1";
    private static final String OFFICIAL = "https://api.curseforge.com/v1";

    private static final int GAME_ID = 432;   // Minecraft
    private static final int CLASS_MODS = 6;  // категория «Mods»

    private CurseForgeSource() {}

    /* Ключ есть — идём в официальный API, нет — через прокси. */
    private static String base() {
        String key = launcher.LauncherConfig.get().curseforgeKey;
        return (key == null || key.isBlank()) ? PROXY : OFFICIAL;
    }

    private static HttpRequest.Builder request(String url) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
            .header("User-Agent", "vulkan-launcher/1.0")
            .timeout(Duration.ofSeconds(20));
        String key = launcher.LauncherConfig.get().curseforgeKey;
        if (key != null && !key.isBlank()) b.header("x-api-key", key.trim());
        return b;
    }

    private static JsonObject getObject(String url) throws Exception {
        HttpResponse<String> resp = HTTP.send(request(url).GET().build(),
                                              HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new IOException("CurseForge HTTP " + resp.statusCode());
        }
        return GSON.fromJson(resp.body(), JsonObject.class);
    }

    private static JsonArray data(String url) throws Exception {
        JsonObject root = getObject(url);
        JsonArray arr = root == null ? null : root.getAsJsonArray("data");
        return arr == null ? new JsonArray() : arr;
    }

    /* CurseForge называет загрузчики числами. */
    private static int loaderType(String family) {
        if (family == null) return 0;
        switch (family.trim().toLowerCase()) {
            case "forge":    return 1;
            case "fabric":   return 4;
            case "quilt":    return 5;
            case "neoforge": return 6;
            default:         return 0;
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private static String str(JsonObject o, String key, String fallback) {
        if (o == null || !o.has(key) || o.get(key).isJsonNull()) return fallback;
        try { return o.get(key).getAsString(); } catch (Exception e) { return fallback; }
    }

    private static long num(JsonObject o, String key) {
        if (o == null || !o.has(key) || o.get(key).isJsonNull()) return 0L;
        try { return o.get(key).getAsLong(); } catch (Exception e) { return 0L; }
    }

    /**
     * Иконка нужного размера.
     *
     * Полноразмерную брать нельзя, и это не мелочь: у CurseForge logo.url — это
     * PNG 512x512 весом 35 КБ, а список каталога показывает двенадцать строк
     * разом. Modrinth для сравнения отдаёт 96px WebP в 4.8 КБ. Разница в семь
     * раз по весу и в шестьдесят по числу пикселей на каждую иконку.
     *
     * Превью на forgecdn живёт по пути /thumbnails/{a}/{b}/{size}/{size}/файл,
     * причём поддерживаются только 64 и 256 — на 128 приходит XML с ошибкой.
     * Проверено запросами: 64x64 это 2.9 КБ, 256x256 — 19.5 КБ, полная 512x512
     * — 35 КБ.
     */
    private static String iconOf(JsonObject mod, int size) {
        JsonObject logo = mod.has("logo") && mod.get("logo").isJsonObject()
            ? mod.getAsJsonObject("logo") : null;
        if (logo == null) return "";

        String thumb = str(logo, "thumbnailUrl", "");
        if (!thumb.isBlank()) {
            if (size == 64 || size == 256) {
                return thumb.replace("/256/256/", "/" + size + "/" + size + "/");
            }
            return thumb;
        }
        // Превью не пришло — придётся взять полную
        return str(logo, "url", "");
    }

    /** Версии Minecraft из списка gameVersions: загрузчики и «Client» отсеиваем. */
    private static boolean looksLikeMcVersion(String value) {
        return value != null && value.matches("\\d+\\.\\d+.*");
    }

    public static List<Map<String, Object>> search(String version, String loader,
                                                   String query, int limit,
                                                   List<String> categoryIds, int offset) throws Exception {
        StringBuilder url = new StringBuilder(base())
            .append("/mods/search?gameId=").append(GAME_ID)
            .append("&classId=").append(CLASS_MODS)
            .append("&searchFilter=").append(enc(!query.isBlank() ? query : (categoryIds != null && !categoryIds.isEmpty() ? "" : "optimization")))
            .append("&pageSize=").append(Math.max(1, Math.min(limit, 30)))
            .append("&index=").append(Math.max(0, offset))
            .append("&sortField=2&sortOrder=desc");   // 2 — по популярности
        if (version != null && !version.isBlank()) url.append("&gameVersion=").append(enc(version));
        int lt = loaderType(loader);
        if (lt != 0) url.append("&modLoaderType=").append(lt);

        /* CurseForge принимает только одну категорию за запрос (categoryId), а не
           набор. При нескольких выбранных группах берём первую — это ограничение
           их API, и оно честно показано в подсказке к чипам в интерфейсе. */
        if (categoryIds != null && !categoryIds.isEmpty()) {
            String cfId = launcher.catalog.CatalogService.curseforgeCategory(categoryIds.get(0));
            if (!cfId.isBlank()) url.append("&categoryId=").append(enc(cfId));
        }

        JsonArray hits = data(url.toString());
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonElement el : hits) {
            if (!el.isJsonObject()) continue;
            JsonObject mod = el.getAsJsonObject();

            Set<String> versions = new LinkedHashSet<>();
            JsonArray latest = mod.getAsJsonArray("latestFiles");
            if (latest != null) {
                for (JsonElement fEl : latest) {
                    if (!fEl.isJsonObject()) continue;
                    JsonArray gv = fEl.getAsJsonObject().getAsJsonArray("gameVersions");
                    if (gv == null) continue;
                    for (JsonElement v : gv) {
                        String s = v.getAsString();
                        if (looksLikeMcVersion(s)) versions.add(s);
                    }
                }
            }

            String author = "";
            JsonArray authors = mod.getAsJsonArray("authors");
            if (authors != null && !authors.isEmpty() && authors.get(0).isJsonObject()) {
                author = str(authors.get(0).getAsJsonObject(), "name", "");
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("source", "curseforge");
            row.put("name", str(mod, "name", ""));
            row.put("author", author);
            row.put("desc", str(mod, "summary", ""));
            // Числовой id — то, по чему CurseForge отдаёт описание и файлы
            row.put("slug", str(mod, "id", ""));
            row.put("url", str(mod.has("links") && mod.get("links").isJsonObject()
                ? mod.getAsJsonObject("links") : null, "websiteUrl", ""));
            // В списке — мелкая, в панели описания — крупная
            row.put("iconUrl", iconOf(mod, 256));
            row.put("iconSmall", iconOf(mod, 64));
            row.put("downloads", num(mod, "downloadCount"));
            row.put("loaders", loader.isBlank() ? new ArrayList<String>()
                                                : new ArrayList<>(List.of(loader)));
            row.put("versions", new ArrayList<>(versions));
            row.put("clientSide", "");
            row.put("serverSide", "");
            out.add(row);
        }
        return out;
    }

    /** Полное описание. CurseForge отдаёт его готовым HTML — разбираем на фронте. */
    public static Map<String, Object> project(String modId) throws Exception {
        JsonObject root = getObject(base() + "/mods/" + enc(modId));
        JsonObject mod = root == null || !root.has("data") || !root.get("data").isJsonObject()
            ? new JsonObject() : root.getAsJsonObject("data");

        String body = "";
        try {
            JsonObject desc = getObject(base() + "/mods/" + enc(modId) + "/description");
            body = str(desc, "data", "");
        } catch (Exception ignored) {
            // Описание не критично: без него карточка всё равно откроется
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", "curseforge");
        out.put("name", str(mod, "name", ""));
        out.put("slug", modId);
        out.put("iconUrl", iconOf(mod, 256));
        out.put("url", str(mod.has("links") && mod.get("links").isJsonObject()
            ? mod.getAsJsonObject("links") : null, "websiteUrl", ""));
        out.put("downloads", num(mod, "downloadCount"));
        out.put("summary", str(mod, "summary", ""));
        out.put("format", "html");     // подсказка фронтенду, как разбирать
        out.put("body", body);
        return out;
    }

    public static List<Map<String, Object>> versions(String modId, String mcVersion,
                                                     String loader) throws Exception {
        StringBuilder url = new StringBuilder(base())
            .append("/mods/").append(enc(modId)).append("/files?pageSize=40");
        if (mcVersion != null && !mcVersion.isBlank()) {
            url.append("&gameVersion=").append(enc(mcVersion));
        }
        int lt = loaderType(loader);
        if (lt != 0) url.append("&modLoaderType=").append(lt);

        JsonArray files = data(url.toString());
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonElement el : files) {
            if (!el.isJsonObject()) continue;
            JsonObject f = el.getAsJsonObject();
            String downloadUrl = str(f, "downloadUrl", "");

            List<String> gameVersions = new ArrayList<>();
            JsonArray gv = f.getAsJsonArray("gameVersions");
            if (gv != null) {
                for (JsonElement v : gv) gameVersions.add(v.getAsString());
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", str(f, "id", ""));
            row.put("name", str(f, "displayName", ""));
            row.put("fileName", str(f, "fileName", ""));
            row.put("downloadUrl", downloadUrl);
            row.put("date", str(f, "fileDate", ""));
            row.put("downloads", num(f, "downloadCount"));
            row.put("releaseType", (int) num(f, "releaseType"));
            row.put("gameVersions", gameVersions);
            row.put("loaders", new ArrayList<String>());
            out.add(row);
        }
        return out;
    }
}
