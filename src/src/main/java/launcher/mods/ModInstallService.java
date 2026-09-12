package launcher.mods;

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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import launcher.LauncherConfig;

/**
 * Downloads mods from Modrinth into the correct profile-specific mods folder.
 *
 * pulse profile  → %APPDATA%/pulsePLUS/minecraft/mods/
 * vanilla profile → %APPDATA%/pulsePLUS/vanilla/mods/
 */
public class ModInstallService {

    private static final Gson GSON = new Gson();
    // Follow redirects — some CDNs 3xx to the actual file; default policy is NEVER
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

    /**
     * Download a mod from Modrinth into the correct profile mods directory.
     *
     * @param slug      Modrinth project slug (e.g. "fabric-api")
     * @param mcVersion Target Minecraft version
     * @param loader    Loader family ("fabric", "forge", "quilt", …)
     * @param mode      Profile mode — "pulse" or "vanilla"
     * @return filename of the downloaded JAR
     */
    public static String install(String slug, String mcVersion, String loader, String mode) throws Exception {
        String encodedSlug = URLEncoder.encode(slug, StandardCharsets.UTF_8);
        // Modrinth expects JSON arrays: ["1.21.4"] and ["fabric"]
        String gameVersionsParam = URLEncoder.encode("[\"" + mcVersion + "\"]", StandardCharsets.UTF_8);
        String loadersParam      = URLEncoder.encode("[\"" + loader.toLowerCase() + "\"]", StandardCharsets.UTF_8);
        String url = "https://api.modrinth.com/v2/project/" + encodedSlug + "/version"
            + "?game_versions=" + gameVersionsParam
            + "&loaders=" + loadersParam;

        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("User-Agent", "pulsePLUS-launcher/1.0")
            .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            throw new IOException("Modrinth API HTTP " + resp.statusCode() + " for " + slug);
        }

        JsonArray versions = GSON.fromJson(resp.body(), JsonArray.class);
        if (versions == null || versions.isEmpty()) {
            throw new Exception("No compatible version for " + slug + " / " + mcVersion + " / " + loader);
        }

        JsonObject version = versions.get(0).getAsJsonObject();
        JsonArray files = version.getAsJsonArray("files");
        if (files == null || files.isEmpty()) {
            throw new Exception("No files in Modrinth version for " + slug);
        }

        // Prefer primary file, fall back to first
        String downloadUrl = null;
        String filename    = null;
        for (JsonElement fileEl : files) {
            JsonObject file = fileEl.getAsJsonObject();
            boolean primary = file.has("primary") && file.get("primary").getAsBoolean();
            if (primary || downloadUrl == null) {
                downloadUrl = file.get("url").getAsString();
                filename    = file.get("filename").getAsString();
                if (primary) break;
            }
        }
        if (downloadUrl == null) throw new Exception("No download URL for " + slug);

        // Route to the correct profile mods directory
        Path modsDir = LauncherConfig.modsDir(mcVersion, mode);
        Files.createDirectories(modsDir);
        Path dest = modsDir.resolve(filename);

        // NOTE: BodyHandlers.ofFile() throws NoSuchFileException on HTTP/2 CDNs
        // (Cloudflare, used by Modrinth). Download to memory, verify status, then write.
        HttpRequest dlReq = HttpRequest.newBuilder(URI.create(downloadUrl))
            .header("User-Agent", "pulsePLUS-launcher/1.0")
            .build();
        HttpResponse<byte[]> dlResp = HTTP.send(dlReq, HttpResponse.BodyHandlers.ofByteArray());
        if (dlResp.statusCode() != 200) {
            throw new IOException("Download HTTP " + dlResp.statusCode() + " for " + filename);
        }
        byte[] data = dlResp.body();
        if (data == null || data.length == 0) {
            throw new IOException("Empty download for " + filename);
        }
        Files.write(dest, data, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);

        System.out.println("[pulsePLUS] Installed mod [" + mode + "]: " + filename
            + " (" + data.length + " bytes) → " + modsDir);
        return filename;
    }

    /** Legacy overload — defaults to pulse profile */
    public static String install(String slug, String mcVersion, String loader) throws Exception {
        return install(slug, mcVersion, loader, "pulse");
    }

    /**
     * Auto-install essential mods for the given loader into the correct profile folder.
     *
     * fabric → fabric-api
     * quilt  → qsl
     */
    public static List<String> autoInstall(String mcVersion, String loader, String mode) {
        List<String> essentialSlugs = switch (loader.toLowerCase()) {
            case "fabric" -> List.of("fabric-api");
            case "quilt"  -> List.of("qsl");
            default       -> List.of();
        };

        List<String> installed = new ArrayList<>();
        for (String slug : essentialSlugs) {
            try {
                String filename = install(slug, mcVersion, loader, mode);
                installed.add(filename);
            } catch (Exception e) {
                System.err.println("[pulsePLUS] Auto-install failed for " + slug + ": " + e.getMessage());
            }
        }
        return installed;
    }

    /** Legacy overload — defaults to pulse profile */
    public static List<String> autoInstall(String mcVersion, String loader) {
        return autoInstall(mcVersion, loader, "pulse");
    }
}
