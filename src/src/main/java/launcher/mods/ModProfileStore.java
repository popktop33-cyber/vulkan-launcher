package launcher.mods;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import launcher.LauncherConfig;

public final class ModProfileStore {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public record ModState(String fileName, boolean enabled) {}

    public static final class Snapshot {
        public String version = "";
        public List<ModState> states = new ArrayList<>();
    }

    private ModProfileStore() {}

    public static Path snapshotFile(String version) {
        return LauncherConfig.dataDir().resolve("mod-state").resolve(version + ".json");
    }

    public static void saveSnapshot(String version, List<ModManager.ModEntry> mods) {
        try {
            Snapshot snapshot = new Snapshot();
            snapshot.version = version;
            for (ModManager.ModEntry mod : mods) {
                snapshot.states.add(new ModState(mod.fileName(), mod.enabled()));
            }
            Path file = snapshotFile(version);
            Files.createDirectories(file.getParent());
            try (BufferedWriter writer = Files.newBufferedWriter(file)) {
                GSON.toJson(snapshot, writer);
            }
        } catch (Exception ignored) {}
    }

    public static Map<String, Boolean> loadSnapshot(String version) {
        Path file = snapshotFile(version);
        if (!Files.exists(file)) return Map.of();
        try (BufferedReader reader = Files.newBufferedReader(file)) {
            Snapshot snapshot = GSON.fromJson(reader, Snapshot.class);
            Map<String, Boolean> map = new LinkedHashMap<>();
            if (snapshot != null && snapshot.states != null) {
                for (ModState state : snapshot.states) {
                    map.put(state.fileName(), state.enabled());
                }
            }
            return map;
        } catch (Exception e) {
            return Map.of();
        }
    }
}
