package launcher.mods;

import java.util.List;
import java.util.Map;

public final class ModCatalog {
    private static final Map<String, List<String>> KNOWN_COMPATIBILITY = Map.of(
        "sodium", List.of("1.20.1", "1.20.4", "1.21", "1.21.1", "1.21.4", "1.21.5"),
        "lithium", List.of("1.20.1", "1.20.4", "1.21", "1.21.1", "1.21.4", "1.21.5"),
        "fabric-api", List.of("1.19.4", "1.20.1", "1.20.4", "1.21", "1.21.1", "1.21.4", "1.21.5"),
        "jei", List.of("1.20.1", "1.20.4", "1.21", "1.21.1", "1.21.4"),
        "modmenu", List.of("1.20.1", "1.20.4", "1.21", "1.21.1", "1.21.4", "1.21.5")
    );

    private ModCatalog() {}

    public static boolean isKnownCompatible(String modId, String mcVersion) {
        List<String> versions = KNOWN_COMPATIBILITY.get(normalize(modId));
        if (versions == null) return true;
        return versions.contains(mcVersion);
    }

    public static String latestKnownVersion(String modId) {
        return switch (normalize(modId)) {
            case "sodium" -> "0.6.x";
            case "lithium" -> "0.14.x";
            case "fabric-api" -> "0.100.x+";
            case "jei" -> "17.x";
            case "modmenu" -> "11.x";
            default -> "";
        };
    }

    private static String normalize(String modId) {
        return modId == null ? "" : modId.trim().toLowerCase();
    }
}
