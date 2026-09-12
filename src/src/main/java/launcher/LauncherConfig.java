package launcher;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Central configuration and directory layout for pulsePLUS.
 *
 * Directory structure:
 *   %APPDATA%/pulsePLUS/              — dataDir()
 *     config.json
 *     minecraft/                      — minecraftGameDir()  (pulse profile)
 *       mods/                         — modsDir("pulse")
 *     vanilla/                        — vanillaGameDir()    (vanilla profile)
 *       mods/                         — modsDir("vanilla")
 *     downloaded-mods/                — downloadedModsDir()
 *     music/                          — musicDir()
 *     videos/                         — videosDir()        (background videos)
 *     logs/                           — logsDir()
 *     cache/                          — local cache (libs, assets)
 *
 *   %APPDATA%/.tlauncher/legacy/Minecraft/game/
 *     versions/                       — tlVersionsDir()     (shared TLauncher versions)
 */
public class LauncherConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = dataDir().resolve("config.json");
    private static LauncherConfig instance;

    public int ramMb = launcher.minecraft.JvmFlags.defaultRamMb();
    public String selectedVersion = "1.21.4";
    public String vanillaVersion = "26.2";
    public String pulseLoaderId = "fabric:0.16.10@1.21.4";
    public String vanillaLoaderId = "vanilla:26.2";
    public boolean autoUpdateMods = false;
    public boolean autoDisableIncompatibleMods = true;
    public boolean useDownloadedModsLibrary = true;
    public boolean musicEnabled = true;
    public int musicVolume = 70;
    public String lastMode = "pulse";
    public String userName = "Player";
    public String javaPath = "";
    /** Client ID приложения Azure для входа Microsoft. Публичный клиент, секрета нет. */
    public String msaClientId = "";

    // ── Base directories ────────────────────────────────────────────────────

    /** %APPDATA%/pulsePLUS — root for all launcher data */
    public static Path dataDir() {
        String appdata = System.getenv("APPDATA");
        Path base = appdata != null ? Path.of(appdata) : Path.of(System.getProperty("user.home"));
        return base.resolve("pulsePLUS");
    }

    /**
     * Shared game root for versions + libraries, INSIDE the launcher's own data dir.
     * Self-contained: does NOT depend on TLauncher (or any other launcher) being
     * installed, so the launcher works on any machine.
     * Path: %APPDATA%/pulsePLUS/game
     */
    public static Path tlGameDir() {
        return dataDir().resolve("game");
    }

    // ── Profile game directories ────────────────────────────────────────────

    /** Minecraft game dir for the pulse (modded) profile */
    public static Path minecraftGameDir() {
        return dataDir().resolve("minecraft");
    }

    /** Minecraft game dir for the vanilla profile */
    public static Path vanillaGameDir() {
        return dataDir().resolve("vanilla");
    }

    /** Game dir for the given profile mode ("pulse" or "vanilla") */
    public static Path gameDir(String mode) {
        return "vanilla".equalsIgnoreCase(mode) ? vanillaGameDir() : minecraftGameDir();
    }

    // ── Mods directories ────────────────────────────────────────────────────

    /**
     * Mods directory for a specific profile mode.
     * pulse  → %APPDATA%/pulsePLUS/minecraft/mods
     * vanilla → %APPDATA%/pulsePLUS/vanilla/mods
     */
    public static Path modsDir(String mcVersion, String mode) {
        return gameDir(mode).resolve("mods");
    }

    /** Mods directory for the pulse profile (legacy overload) */
    public static Path modsDir(String mcVersion) {
        return minecraftGameDir().resolve("mods");
    }

    /** Downloaded mods library — shared across profiles */
    public static Path downloadedModsDir() {
        return dataDir().resolve("downloaded-mods");
    }

    /** Disabled mods for a specific profile / version (legacy — always pulse) */
    public static Path disabledModsDir(String mcVersion) {
        return minecraftGameDir().resolve("disabled-mods").resolve(mcVersion);
    }

    /** Disabled mods for a specific profile mode and version */
    public static Path disabledModsDir(String mcVersion, String mode) {
        return gameDir(mode).resolve("disabled-mods").resolve(mcVersion);
    }

    // ── Versions directories ────────────────────────────────────────────────

    /**
     * Versions directory (Minecraft + loader version JSON/JARs), inside the launcher's
     * own data dir — self-contained, no external launcher required.
     * Path: %APPDATA%/pulsePLUS/game/versions
     */
    public static Path tlVersionsDir() {
        return tlGameDir().resolve("versions");
    }

    /** Shared libraries directory: %APPDATA%/pulsePLUS/game/libraries */
    public static Path librariesDir() {
        return tlGameDir().resolve("libraries");
    }

    /** Local launcher cache root (libraries, assets) */
    public static Path cacheDir() {
        return dataDir().resolve("cache");
    }

    // ── Other shared directories ────────────────────────────────────────────

    public static Path logsDir()  { return dataDir().resolve("logs");  }
    public static Path musicDir() { return dataDir().resolve("music"); }

    /**
     * Background videos for the launcher UI.
     * Seeded on first launch from the copy shipped with the installer, then owned by
     * the user: drop your own *.mp4 here to replace the backgrounds without touching
     * the installation. WebServer reads this folder first, the shipped copy second.
     */
    public static Path videosDir() { return dataDir().resolve("videos"); }

    // ── Config persistence ──────────────────────────────────────────────────

    public static LauncherConfig get() {
        if (instance == null) instance = load();
        return instance;
    }

    private static LauncherConfig load() {
        if (!Files.exists(FILE)) return new LauncherConfig();
        try (BufferedReader r = Files.newBufferedReader(FILE)) {
            LauncherConfig c = GSON.fromJson(r, LauncherConfig.class);
            return c == null ? new LauncherConfig() : c.clamp();
        } catch (Exception e) {
            return new LauncherConfig();
        }
    }

    public void save() {
        clamp();
        try {
            Files.createDirectories(FILE.getParent());
            try (BufferedWriter w = Files.newBufferedWriter(FILE)) {
                GSON.toJson(this, w);
            }
        } catch (Exception ignored) {}
    }

    private LauncherConfig clamp() {
        // Потолок по памяти считаем от объёма машины: уход в свап даёт те самые
        // длинные фризы, от которых мы уходим флагами JVM
        ramMb = launcher.minecraft.JvmFlags.clampRamMb(ramMb);
        if (ramMb < 512) ramMb = 512;
        if (selectedVersion == null || selectedVersion.isBlank()) selectedVersion = "1.21.4";
        if (vanillaVersion == null || vanillaVersion.isBlank()) vanillaVersion = "26.2";
        if (pulseLoaderId == null || pulseLoaderId.isBlank()) pulseLoaderId = "fabric:0.16.10@1.21.4";
        if (vanillaLoaderId == null || vanillaLoaderId.isBlank()) vanillaLoaderId = "vanilla:26.2";
        if (lastMode == null || lastMode.isBlank()) lastMode = "pulse";
        if (userName == null || userName.isBlank()) userName = "Player";
        if (musicVolume < 0) musicVolume = 0;
        if (musicVolume > 100) musicVolume = 100;
        return this;
    }
}
