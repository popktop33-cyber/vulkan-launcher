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
 *     instances/                      — instancesDir()  папка на каждую сборку
 *       fabric-loader-0.19.5-1.21.1/  — gameDir("vanilla")
 *         mods/                       — modsDir("1.21.1", "vanilla")
 *         saves/ config/ options.txt  — всё, что игра пишет в --gameDir
 *       1.20.1-forge-47.4.0/          — вторая сборка, своя и независимая
 *     minecraft/ vanilla/             — старые папки профилей; после переноса
 *                                       в них остаются только общие корни
 *                                       (assets, libraries, versions) —
 *                                       оттуда берутся уже скачанные файлы
 *     downloaded-mods/                — downloadedModsDir()
 *     music/                          — musicDir()
 *     videos/                         — videosDir()        (background videos)
 *     logs/                           — logsDir()
 *     cache/                          — служебный кэш лаунчера (НЕ файлы игры)
 *     game/                           — tlGameDir()  общий каталог игры
 *       versions/                     — версии: описание и клиент
 *       libraries/                    — библиотеки
 *       assets/                       — ресурсы
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
    /**
     * Скачивать нужную версию Java под версию игры, когда подходящей нет.
     *
     * Включено по умолчанию: одной Java на все версии не хватает, и разница
     * не в «новее — значит лучше». Игре 1.16.5 нужна Java 8, и на 17 она не
     * пойдёт; игре 26.1 нужна 25, и её на машине обычно нет вовсе. Выключенный
     * тумблер возвращает прежнее поведение — берём, что найдётся.
     */
    public boolean autoJava = true;
    /** Client ID приложения Azure для входа Microsoft. Публичный клиент, секрета нет. */
    public String msaClientId = "";
    /**
     * Личный ключ CurseForge. Пусто — идём через публичный прокси api.curse.tools,
     * он работает без ключа. Ключ вписан — обращаемся напрямую в официальный API.
     */
    public String curseforgeKey = "";
    /** Источник каталога модов по умолчанию: "modrinth" или "curseforge". */
    public String modSource = "modrinth";
    /**
     * Подключать ли игре authlib-injector под аккаунтом ely.by.
     *
     * Агент нужен, чтобы клиент брал скины у ely.by, а не у Mojang. Выключить
     * стоит, если с ним перестал пускать какой-то сервер: без агента игра
     * работает как раньше, просто со Стивом (см. launcher.minecraft.AuthlibInjector).
     */
    public boolean authlibInjector = true;

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

    // ── Per-instance game directories ───────────────────────────────────────
    //
    // У каждой сборки «версия + загрузчик» своя папка в instances/ — как в Prism
    // или MultiMC. Туда игра пишет всё, что попадает в --gameDir: mods, saves,
    // config, options.txt, servers.dat, resourcepacks, screenshots. Сборки друг
    // о друге не знают: миров и настроек у них порознь.
    //
    // Общими остаются только versions/, libraries/ и assets/ из game(). Клиент,
    // библиотеки и ресурсы адресуются хешем и для всех сборок одинаковы —
    // копия на каждую стоила бы гигабайтов на ровном месте.
    //
    // Имя папки намеренно совпадает с именем папки версии на диске
    // (fabric-loader-0.19.5-1.21.1, 1.20.1-forge-47.4.0, neoforge-21.1.235):
    // сборка называется одинаково и в списке версий, и в проводнике.

    /** Корень всех сборок: %APPDATA%/pulsePLUS/instances */
    public static Path instancesDir() {
        return dataDir().resolve("instances");
    }

    /** Версия игры, выбранная сейчас в профиле ("pulse" или "vanilla"). */
    public static String versionFor(String mode) {
        LauncherConfig c = get();
        return "vanilla".equalsIgnoreCase(mode) ? c.vanillaVersion : c.selectedVersion;
    }

    /** Загрузчик, выбранный сейчас в профиле ("pulse" или "vanilla"). */
    public static String loaderIdFor(String mode) {
        LauncherConfig c = get();
        return "vanilla".equalsIgnoreCase(mode) ? c.vanillaLoaderId : c.pulseLoaderId;
    }

    /**
     * Имя папки сборки по версии игры и идентификатору загрузчика.
     *
     * Повторяет то, как зовёт свои папки сам загрузчик: установщик Forge заводит
     * {@code 1.20.1-forge-47.4.0}, NeoForge — {@code neoforge-21.1.235}, а Fabric
     * мы ставим своим кодом и зовём {@code fabric-loader-<сборка>-<версия>}.
     * Одна и та же строка получается и у папки сборки, и у папки версии — так
     * их можно сверять глазами, не держа таблицу соответствий в голове.
     *
     * Сборка неопознанного семейства тоже получит папку: имя чистится до
     * допустимого в Windows, лишь бы сборка не потерялась молча.
     */
    public static String instanceName(String mcVersion, String loaderId) {
        String family = loaderFamily(loaderId);
        String build  = loaderBuild(loaderId);
        String ver    = mcVersion == null || mcVersion.isBlank() ? versionFromLoaderId(loaderId) : mcVersion.trim();
        if (ver.isBlank()) ver = "1.21.4";

        // Ванилла — это просто версия; загрузчик без сборки тоже ничего не добавляет
        if (family.isBlank() || "vanilla".equals(family) || build.isBlank()) return safeName(ver);

        switch (family) {
            case "fabric":
            case "quilt":    return safeName(family + "-loader-" + build + "-" + ver);
            case "forge":    return safeName(ver + "-forge-" + build);
            case "neoforge": return safeName("neoforge-" + build);
            default:         return safeName(family + "-" + build + "-" + ver);
        }
    }

    /** Папка сборки: %APPDATA%/pulsePLUS/instances/<имя> */
    public static Path instanceDir(String mcVersion, String loaderId) {
        return instancesDir().resolve(instanceName(mcVersion, loaderId));
    }

    /** Папка сборки, выбранной сейчас в этом профиле. */
    public static Path gameDir(String mode) {
        return instanceDir(versionFor(mode), loaderIdFor(mode));
    }

    /** Minecraft game dir for the pulse (modded) profile */
    public static Path minecraftGameDir() {
        return gameDir("pulse");
    }

    /** Minecraft game dir for the vanilla profile */
    public static Path vanillaGameDir() {
        return gameDir("vanilla");
    }

    // ── Разбор идентификатора загрузчика ────────────────────────────────────
    // Формат: "<семейство>:<сборка>@<версия игры>", например fabric:0.19.5@1.21.1.
    // У ваниллы сборки нет вовсе: vanilla:1.21.1.

    private static String loaderFamily(String loaderId) {
        if (loaderId == null) return "";
        int c = loaderId.indexOf(':');
        return (c > 0 ? loaderId.substring(0, c) : loaderId).trim().toLowerCase();
    }

    private static String loaderBuild(String loaderId) {
        if (loaderId == null) return "";
        int c = loaderId.indexOf(':');
        if (c < 0) return "";
        String rest = loaderId.substring(c + 1);
        int at = rest.indexOf('@');
        return (at >= 0 ? rest.substring(0, at) : rest).trim();
    }

    private static String versionFromLoaderId(String loaderId) {
        if (loaderId == null) return "";
        int at = loaderId.indexOf('@');
        return at >= 0 ? loaderId.substring(at + 1).trim() : "";
    }

    /** Имя папки: только то, что Windows примет без вопросов. */
    static String safeName(String raw) {
        String s = raw.trim().replaceAll("[^A-Za-z0-9._-]+", "-").replaceAll("^-+|-+$", "");
        return s.isEmpty() ? "instance" : s;
    }

    // ── Mods directories ────────────────────────────────────────────────────

    /**
     * Mods directory for a specific profile mode.
     * pulse  → instances/<сборка pulse>/mods
     * vanilla → instances/<сборка vanilla>/mods
     *
     * Загрузчик берётся из профиля, версия — из аргумента: список модов всегда
     * относится к той сборке, что выбрана в этом профиле сейчас.
     */
    public static Path modsDir(String mcVersion, String mode) {
        return instanceDir(mcVersion, loaderIdFor(mode)).resolve("mods");
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
        return instanceDir(mcVersion, loaderIdFor(mode)).resolve("disabled-mods").resolve(mcVersion);
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

    /**
     * Shared assets directory: %APPDATA%/pulsePLUS/game/assets
     *
     * Ресурсы и библиотеки лежат рядом с версиями, а не в отдельном cache/.
     * Так вышло не для красоты: раньше и то и другое складывалось в
     * %APPDATA%/pulsePLUS/cache, а оболочка лаунчера держит профиль Chromium
     * в %APPDATA%/pulsePLUS. Windows не различает регистр, поэтому «cache»
     * и хромовский «Cache» — одна и та же папка, и clearCache() при каждом
     * запуске стирал скачанные библиотеки вместе с ресурсами. Игра качала
     * их заново после каждого перезапуска.
     *
     * Теперь общий каталог игры один и тот же для всех профилей и версий —
     * как в обычном .minecraft.
     */
    public static Path assetsDir() {
        return tlGameDir().resolve("assets");
    }

    /**
     * Место для служебного кэша лаунчера (не для файлов игры).
     *
     * ВНИМАНИЕ: сюда нельзя класть ничего, что жалко потерять. Имя совпадает
     * с хромовским Cache в каталоге данных, а его чистит clearCache() при
     * старте окна. Файлы самой игры живут в tlGameDir() — см. assetsDir().
     */
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
