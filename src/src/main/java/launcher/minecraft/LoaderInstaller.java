package launcher.minecraft;

import java.io.File;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import launcher.LauncherConfig;

/**
 * Installs Forge / NeoForge into the launcher's OWN game folder by downloading and
 * running their official installer headlessly (`--installClient`). This makes the
 * launcher fully self-contained — it never reads versions from TLauncher or any other
 * external launcher.
 *
 * Fabric and Quilt are NOT handled here — they install directly from their meta APIs
 * in MinecraftLauncher (pure library loaders, no installer needed).
 */
public final class LoaderInstaller {

    private LoaderInstaller() {}

    /**
     * Ensure the given loader is installed; returns the produced version directory
     * (…/versions/&lt;name&gt;) or null if installation is unsupported/failed.
     */
    static Path install(String family, String mcVersion, String build,
                        Path versionsDir, Path libsDir) throws Exception {
        switch (family) {
            case "forge":
                return runInstaller(installerUrlForge(mcVersion, build), versionsDir, "Forge");
            case "neoforge":
                return runInstaller(installerUrlNeoForge(build), versionsDir, "NeoForge");
            case "optifine":
                return installOptiFine(mcVersion, versionsDir, libsDir);
            default:
                return null;
        }
    }

    private static String installerUrlForge(String mcVersion, String build) {
        // https://maven.minecraftforge.net/net/minecraftforge/forge/<mc>-<build>/forge-<mc>-<build>-installer.jar
        String v = mcVersion + "-" + build;
        return "https://maven.minecraftforge.net/net/minecraftforge/forge/" + v + "/forge-" + v + "-installer.jar";
    }

    private static String installerUrlNeoForge(String build) {
        // https://maven.neoforged.net/releases/net/neoforged/neoforge/<build>/neoforge-<build>-installer.jar
        return "https://maven.neoforged.net/releases/net/neoforged/neoforge/" + build + "/neoforge-" + build + "-installer.jar";
    }

    /**
     * Download the installer jar, run it in headless client-install mode against our
     * game root, and return the version directory it created.
     */
    private static Path runInstaller(String installerUrl, Path versionsDir, String label) throws Exception {
        Path gameRoot = versionsDir.getParent();               // …/pulsePLUS/game
        Files.createDirectories(versionsDir);

        // The installer refuses to run without a launcher_profiles.json in the target dir.
        Path profiles = gameRoot.resolve("launcher_profiles.json");
        if (!Files.exists(profiles)) {
            Files.writeString(profiles, "{\"profiles\":{},\"selectedProfile\":\"\",\"clientToken\":\"pulseplus\"}");
        }

        // Snapshot existing version dirs so we can detect the one the installer adds.
        Set<String> before = listVersionDirs(versionsDir);

        Path installer = gameRoot.resolve("installer-tmp.jar");
        System.out.println("[pulsePLUS] Downloading " + label + " installer: " + installerUrl);
        MinecraftLauncher.fetchFile(installerUrl, installer);

        String java = MinecraftLauncher.findConsoleJava(LauncherConfig.get());
        System.out.println("[pulsePLUS] Running " + label + " installer (headless client install)...");
        LaunchProgress.update("install", 8, "Запуск установщика " + label + "...");

        Process p = new ProcessBuilder(java, "-jar",
                installer.toAbsolutePath().toString(),
                "--installClient", gameRoot.toAbsolutePath().toString())
            .redirectErrorStream(true)
            .directory(gameRoot.toFile())
            .start();
        // Drain output so the installer never blocks on a full pipe
        try (var r = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.toLowerCase().contains("error") || line.toLowerCase().contains("exception")) {
                    System.err.println("[installer] " + line);
                }
            }
        }
        int code = p.waitFor();
        try { Files.deleteIfExists(installer); } catch (Exception ignored) {}
        if (code != 0) {
            System.err.println("[pulsePLUS] " + label + " installer exit code " + code);
        }

        // The new version dir is whatever appeared that wasn't there before.
        Set<String> after = listVersionDirs(versionsDir);
        after.removeAll(before);
        Path best = null;
        for (String name : after) {
            Path dir = versionsDir.resolve(name);
            if (Files.exists(dir.resolve(name + ".json"))) { best = dir; break; }
        }
        if (best == null) {
            // Fall back: maybe it was already present under a matching name
            best = findByLabel(versionsDir, label);
        }
        return best;
    }

    /**
     * Install OptiFine (standalone, launchwrapper-based) fully from BMCLAPI — no ad-gated
     * optifine.net download and no external launcher. We drop the OptiFine jar + LaunchWrapper
     * as libraries and generate an inheritsFrom version JSON with the OptiFine tweaker.
     */
    private static Path installOptiFine(String mcVersion, Path versionsDir, Path libsDir) throws Exception {
        com.google.gson.Gson gson = new com.google.gson.Gson();
        String listUrl = "https://bmclapi2.bangbang93.com/optifine/" + mcVersion;
        String body = MinecraftLauncher.fetchText(listUrl);
        com.google.gson.JsonArray arr = gson.fromJson(body, com.google.gson.JsonArray.class);

        String type = null, patch = null;
        for (com.google.gson.JsonElement el : arr) {
            com.google.gson.JsonObject o = el.getAsJsonObject();
            String t = o.has("type") ? o.get("type").getAsString() : "";
            String p = o.has("patch") ? o.get("patch").getAsString() : "";
            String fn = o.has("filename") ? o.get("filename").getAsString() : "";
            if (fn.startsWith("preview_") || p.contains("pre") || !t.startsWith("HD_U")) continue;
            type = t; patch = p; break;
        }
        if (type == null) throw new IOException("OptiFine для " + mcVersion + " не найден на зеркале");

        String ofVer = mcVersion + "_" + type + "_" + patch;      // 1.20.1_HD_U_I6
        // 1. Download the OptiFine jar into our libraries as optifine:OptiFine:<ofVer>
        String ofRel = "optifine/OptiFine/" + ofVer + "/OptiFine-" + ofVer + ".jar";
        Path ofJar = libsDir.resolve(ofRel);
        if (!Files.exists(ofJar)) {
            LaunchProgress.update("install", 8, "Загрузка OptiFine " + type + "_" + patch + "...");
            // BMCLAPI redirects OptiFine through a third-party CDN that can be flaky
            // (rate limiting). Try several times with a longer backoff before giving up.
            String dl = "https://bmclapi2.bangbang93.com/optifine/" + mcVersion + "/" + type + "/" + patch;
            Exception last = null;
            for (int attempt = 1; attempt <= 6; attempt++) {
                try {
                    MinecraftLauncher.fetchFile(dl, ofJar);
                    if (Files.size(ofJar) > 100_000) { last = null; break; }   // a real jar, not an error page
                    throw new IOException("OptiFine ответ слишком мал (" + Files.size(ofJar) + " б)");
                } catch (Exception e) {
                    last = e;
                    try { Files.deleteIfExists(ofJar); } catch (Exception ignored) {}
                    Thread.sleep(1500L * attempt);
                }
            }
            if (last != null) {
                throw new IOException("Не удалось скачать OptiFine (зеркало BMCLAPI недоступно). "
                    + "Попробуйте позже или установите OptiFine вручную с optifine.net в папку "
                    + "game/libraries/" + ofRel + ". Причина: " + last.getMessage());
            }
        }

        // 2. Generate the version JSON (inheritsFrom vanilla + launchwrapper + tweaker)
        String name = "OptiFine " + mcVersion;
        Path dir = versionsDir.resolve(name);
        Files.createDirectories(dir);

        com.google.gson.JsonObject json = new com.google.gson.JsonObject();
        json.addProperty("id", name);
        json.addProperty("inheritsFrom", mcVersion);
        json.addProperty("mainClass", "net.minecraft.launchwrapper.Launch");
        com.google.gson.JsonObject args = new com.google.gson.JsonObject();
        com.google.gson.JsonArray game = new com.google.gson.JsonArray();
        game.add("--tweakClass"); game.add("optifine.OptiFineTweaker");
        args.add("game", game);
        json.add("arguments", args);
        com.google.gson.JsonArray libs = new com.google.gson.JsonArray();
        com.google.gson.JsonObject l1 = new com.google.gson.JsonObject();
        l1.addProperty("name", "optifine:OptiFine:" + ofVer);
        libs.add(l1);
        com.google.gson.JsonObject l2 = new com.google.gson.JsonObject();
        l2.addProperty("name", "net.minecraft:launchwrapper:1.12");
        l2.addProperty("url", "https://libraries.minecraft.net/");
        libs.add(l2);
        json.add("libraries", libs);

        Files.writeString(dir.resolve(name + ".json"), gson.toJson(json));
        System.out.println("[pulsePLUS] OptiFine installed: " + name + " (" + ofVer + ")");
        return dir;
    }

    private static Set<String> listVersionDirs(Path versionsDir) throws IOException {
        Set<String> out = new HashSet<>();
        if (!Files.isDirectory(versionsDir)) return out;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(versionsDir)) {
            for (Path p : ds) if (Files.isDirectory(p)) out.add(p.getFileName().toString());
        }
        return out;
    }

    private static Path findByLabel(Path versionsDir, String label) throws IOException {
        String key = label.toLowerCase();
        if (!Files.isDirectory(versionsDir)) return null;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(versionsDir)) {
            for (Path p : ds) {
                if (Files.isDirectory(p) && p.getFileName().toString().toLowerCase().contains(key)
                    && Files.exists(p.resolve(p.getFileName().toString() + ".json"))) {
                    return p;
                }
            }
        }
        return null;
    }
}
