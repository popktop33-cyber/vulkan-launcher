package launcher.mods;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import launcher.LauncherConfig;

public class ModManager {

    public record ModEntry(
        String name,
        String version,
        String fileName,
        boolean enabled,
        boolean compatible,
        boolean downloaded,
        String latestKnownVersion
    ) {}

    public record AutoDisableResult(List<String> disabled, List<String> kept) {}

    /** List mods for a specific profile mode (pulse or vanilla). */
    public static List<ModEntry> listMods(String mcVersion, String mode) throws IOException {
        List<ModEntry> result = new ArrayList<>();
        Path modsDir = LauncherConfig.modsDir(mcVersion, mode);
        Path downloadsDir = LauncherConfig.downloadedModsDir();

        if (Files.exists(modsDir)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(modsDir, "*.jar")) {
                for (Path p : stream) {
                    ModEntry entry = parseMod(p, true, mcVersion, false);
                    if (entry != null) result.add(entry);
                }
            }
        }

        Path disabledDir = LauncherConfig.disabledModsDir(mcVersion, mode);
        if (Files.exists(disabledDir)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(disabledDir, "*.jar")) {
                for (Path p : stream) {
                    ModEntry entry = parseMod(p, false, mcVersion, false);
                    if (entry != null) result.add(entry);
                }
            }
        }

        if (Files.exists(downloadsDir)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(downloadsDir, "*.jar")) {
                for (Path p : stream) {
                    ModEntry entry = parseMod(p, false, mcVersion, true);
                    if (entry != null) result.add(entry);
                }
            }
        }
        return result;
    }

    /** Legacy overload — always uses the pulse profile folder. */
    public static List<ModEntry> listMods(String mcVersion) throws IOException {
        return listMods(mcVersion, "pulse");
    }

    public static AutoDisableResult autoDisableIncompatible(String mcVersion, String mode) throws IOException {
        List<String> disabled = new ArrayList<>();
        List<String> kept = new ArrayList<>();
        List<ModEntry> mods = listMods(mcVersion, mode);
        ModProfileStore.saveSnapshot(mcVersion, mods);

        for (ModEntry mod : mods) {
            if (!mod.enabled()) {
                kept.add(mod.fileName());
                continue;
            }
            if (mod.compatible()) {
                kept.add(mod.fileName());
                continue;
            }
            disableMod(mod.fileName(), mcVersion, mode);
            disabled.add(mod.fileName());
        }
        return new AutoDisableResult(disabled, kept);
    }

    /** Legacy overload — always uses the pulse profile folder. */
    public static AutoDisableResult autoDisableIncompatible(String mcVersion) throws IOException {
        return autoDisableIncompatible(mcVersion, "pulse");
    }

    public static void restoreSnapshot(String mcVersion, String mode) throws IOException {
        Map<String, Boolean> snapshot = ModProfileStore.loadSnapshot(mcVersion);
        for (Map.Entry<String, Boolean> entry : snapshot.entrySet()) {
            if (entry.getValue()) enableMod(entry.getKey(), mcVersion, mode);
            else disableMod(entry.getKey(), mcVersion, mode);
        }
    }

    /** Legacy overload — always uses the pulse profile folder. */
    public static void restoreSnapshot(String mcVersion) throws IOException {
        restoreSnapshot(mcVersion, "pulse");
    }

    private static ModEntry parseMod(Path jar, boolean enabled, String mcVersion, boolean downloaded) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            ZipEntry fabricEntry = zip.getEntry("fabric.mod.json");
            String modId = jar.getFileName().toString().replace(".jar", "");
            String version = "?";
            if (fabricEntry != null) {
                try (InputStream is = zip.getInputStream(fabricEntry)) {
                    JsonObject json = new Gson().fromJson(new InputStreamReader(is), JsonObject.class);
                    modId = json.has("id") ? json.get("id").getAsString() : modId;
                    version = json.has("version") ? json.get("version").getAsString() : version;
                }
            }
            boolean compatible = ModCatalog.isKnownCompatible(modId, mcVersion);
            return new ModEntry(
                modId,
                version,
                jar.getFileName().toString(),
                enabled,
                compatible,
                downloaded,
                ModCatalog.latestKnownVersion(modId)
            );
        } catch (Exception e) {
            return null;
        }
    }

    public static void disableMod(String fileName, String mcVersion, String mode) throws IOException {
        Path modsDir = LauncherConfig.modsDir(mcVersion, mode);
        Path disabledDir = LauncherConfig.disabledModsDir(mcVersion, mode);
        Files.createDirectories(disabledDir);
        Path src = modsDir.resolve(fileName);
        if (Files.exists(src)) {
            Files.move(src, disabledDir.resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Legacy overload — always uses the pulse profile folder. */
    public static void disableMod(String fileName, String mcVersion) throws IOException {
        disableMod(fileName, mcVersion, "pulse");
    }

    public static void enableMod(String fileName, String mcVersion, String mode) throws IOException {
        Path modsDir = LauncherConfig.modsDir(mcVersion, mode);
        Path disabledDir = LauncherConfig.disabledModsDir(mcVersion, mode);
        Files.createDirectories(modsDir);

        Path disabled = disabledDir.resolve(fileName);
        if (Files.exists(disabled)) {
            Files.move(disabled, modsDir.resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
            return;
        }

        Path downloaded = LauncherConfig.downloadedModsDir().resolve(fileName);
        if (Files.exists(downloaded)) {
            Files.copy(downloaded, modsDir.resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Legacy overload — always uses the pulse profile folder. */
    public static void enableMod(String fileName, String mcVersion) throws IOException {
        enableMod(fileName, mcVersion, "pulse");
    }
}
