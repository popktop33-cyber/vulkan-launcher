package launcher.minecraft;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import launcher.LauncherConfig;

/**
 * Сборки «версия игры + загрузчик» на диске — по папке на каждую.
 *
 * <p>Forge, NeoForge и OptiFine заводят себе папку сами: их установщик пишет в
 * {@code game/versions} описание сборки, и по одному её наличию видно, что
 * сборка собрана. Fabric и Quilt так не умеют — они целиком помещаются в список
 * библиотек, и лаунчер применял их в памяти, не оставляя на диске ничего. Из-за
 * этого про них нельзя было сказать «уже установлено», и признака, по которому
 * повторный запуск мог бы обойтись без похода в сеть, попросту не существовало.
 *
 * <p>Теперь и они получают свою папку с описанием ({@code inheritsFrom} = версия
 * игры). Все сборки читаются одним обходом каталога: имя семейства берётся из
 * имени папки, версия игры — из {@code inheritsFrom}, поэтому разбирать
 * названия, придуманные чужими установщиками, не приходится.
 */
public final class LoaderStore {

    private static final Gson GSON = new Gson();

    private LoaderStore() {}

    /**
     * Имя папки сборки — то же, что даёт официальный установщик Fabric:
     * {@code fabric-loader-0.16.10-1.21.4}.
     */
    public static String dirName(String family, String build, String mcVersion) {
        return family + "-loader-" + build + "-" + mcVersion;
    }

    /** Путь к описанию сборки внутри общего каталога версий. */
    public static Path jsonFor(Path versionsRoot, String family, String build, String mcVersion) {
        String name = dirName(family, build, mcVersion);
        return versionsRoot.resolve(name).resolve(name + ".json");
    }

    /** Собрана ли конкретная сборка — по описанию на диске. */
    public static boolean isInstalled(String family, String build, String mcVersion) {
        return Files.isRegularFile(jsonFor(LauncherConfig.tlVersionsDir(), family, build, mcVersion));
    }

    /** Все собранные сборки, разложенные по версии игры, которую они дополняют. */
    public static Map<String, List<Map<String, Object>>> installedByVersion() {
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        for (Map<String, Object> row : scan()) {
            String mc = String.valueOf(row.get("mcVersion"));
            out.computeIfAbsent(mc, k -> new ArrayList<>()).add(row);
        }
        return out;
    }

    /** Собранные сборки для одной версии игры. */
    public static List<Map<String, Object>> installed(String mcVersion) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : scan()) {
            if (mcVersion.equals(row.get("mcVersion"))) out.add(row);
        }
        return out;
    }

    /**
     * Один обход {@code game/versions}.
     *
     * Ванильные версии сюда не попадают намеренно: у них нет {@code inheritsFrom},
     * и это же поле отвечает на вопрос, какую версию игры сборка дополняет —
     * у NeoForge версии нет в имени папки, а у Forge есть, так что имя годится
     * не для всех и опираться на него нельзя.
     */
    private static List<Map<String, Object>> scan() {
        List<Map<String, Object>> out = new ArrayList<>();
        Path root = LauncherConfig.tlVersionsDir();
        if (!Files.isDirectory(root)) return out;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(root)) {
            for (Path dir : ds) {
                if (!Files.isDirectory(dir)) continue;
                String name = dir.getFileName().toString();
                Path json = dir.resolve(name + ".json");
                if (!Files.isRegularFile(json)) continue;

                JsonObject meta;
                try {
                    meta = GSON.fromJson(Files.readString(json), JsonObject.class);
                } catch (Exception broken) {
                    // Битый или чужой JSON — молча пропускаем: одна испорченная
                    // папка не должна ронять весь список версий.
                    continue;
                }
                if (meta == null || !meta.has("inheritsFrom")) continue;
                String mcVersion = meta.get("inheritsFrom").getAsString();

                String family = familyOf(name);
                if (family == null) continue;

                Map<String, Object> row = new LinkedHashMap<>();
                row.put("name", name);
                row.put("mcVersion", mcVersion);
                row.put("familyKey", family);
                row.put("family", displayFamily(family));
                row.put("build", buildOf(name, family, mcVersion));
                String build = String.valueOf(row.get("build"));
                row.put("label", build.isBlank() ? displayFamily(family)
                                                : displayFamily(family) + " " + build);
                out.add(row);
            }
        } catch (IOException e) {
            System.err.println("[pulsePLUS] Не удалось прочитать список сборок: " + e.getMessage());
        }
        return out;
    }

    /** Семейство загрузчика по имени папки. null — папка не похожа на сборку. */
    private static String familyOf(String dirName) {
        String n = dirName.toLowerCase();
        if (n.startsWith("fabric-loader-")) return "fabric";
        if (n.startsWith("quilt-loader-"))  return "quilt";
        if (n.startsWith("neoforge-"))      return "neoforge";
        if (n.contains("-forge-"))          return "forge";
        if (n.startsWith("optifine "))      return "optifine";
        return null;
    }

    /**
     * Версия загрузчика из имени папки.
     *
     * Версию игры отрезаем ту, что уже знаем из {@code inheritsFrom}: у Fabric
     * она стоит хвостом, а у Forge — головой, и угадывать, где она, не нужно.
     */
    private static String buildOf(String dirName, String family, String mcVersion) {
        switch (family) {
            case "fabric":
            case "quilt": {
                String tail = dirName.substring((family + "-loader-").length());
                String suffix = "-" + mcVersion;
                return tail.endsWith(suffix) ? tail.substring(0, tail.length() - suffix.length()) : tail;
            }
            case "forge": {
                String prefix = mcVersion + "-forge-";
                return dirName.startsWith(prefix) ? dirName.substring(prefix.length()) : "";
            }
            case "neoforge":
                return dirName.substring("neoforge-".length());
            default:
                // OptiFine версию в имени папки не носит — её знает только JSON,
                // а он у нас и так уже прочитан не для этого поля.
                return "";
        }
    }

    private static String displayFamily(String family) {
        return switch (family) {
            case "fabric"   -> "Fabric";
            case "forge"    -> "Forge";
            case "neoforge" -> "NeoForge";
            case "quilt"    -> "Quilt";
            case "optifine" -> "OptiFine";
            default         -> family;
        };
    }
}
