package launcher.mods;

import java.util.ArrayList;
import java.util.List;

public final class ModUpdateService {
    public record UpdateCheckResult(
        String fileName,
        String currentVersion,
        String latestKnownVersion,
        boolean criticalUpdate,
        String message
    ) {}

    private ModUpdateService() {}

    public static List<UpdateCheckResult> check(List<ModManager.ModEntry> mods) {
        List<UpdateCheckResult> results = new ArrayList<>();
        for (ModManager.ModEntry mod : mods) {
            String latest = ModCatalog.latestKnownVersion(mod.name());
            if (latest.isBlank()) {
                results.add(new UpdateCheckResult(
                    mod.fileName(),
                    mod.version(),
                    "",
                    false,
                    "No catalog entry. Keeping current build."
                ));
                continue;
            }
            boolean critical = isClearlyOutdated(mod.version(), latest);
            results.add(new UpdateCheckResult(
                mod.fileName(),
                mod.version(),
                latest,
                critical,
                critical
                    ? "Important update available."
                    : "Current build is acceptable. Update skipped."
            ));
        }
        return results;
    }

    private static boolean isClearlyOutdated(String current, String latest) {
        if (current == null || current.isBlank() || "?".equals(current)) return true;
        return !current.startsWith(latest.replace(".x", ""));
    }
}
