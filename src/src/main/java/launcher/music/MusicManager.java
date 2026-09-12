package launcher.music;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Random;
import launcher.LauncherConfig;

public final class MusicManager {
    private static final Gson GSON = new Gson();
    private static final Random RANDOM = new Random();
    private static final List<String> DEFAULT_BYTEBEAT = List.of("dream_space", "saturn");

    private static volatile boolean playing = true;
    private static volatile double volume = 0.70d;
    private static volatile String currentTrack = "No track loaded";
    private static volatile String currentTrackType = "idle";
    private static volatile int crossfadeSeconds = 4;

    private MusicManager() {}

    public static synchronized void ensureInitialized() {
        LauncherConfig cfg = LauncherConfig.get();
        playing = cfg.musicEnabled;
        volume = cfg.musicVolume / 100.0d;
        try {
          Files.createDirectories(LauncherConfig.musicDir());
        } catch (IOException ignored) {}
        if (playing && "No track loaded".equals(currentTrack)) {
            currentTrack = chooseNextTrack();
        }
    }

    public static synchronized Map<String, Object> state() {
        ensureInitialized();
        return Map.of(
            "playing", playing,
            "volume", (int) Math.round(volume * 100),
            "currentTrack", currentTrack,
            "currentTrackType", currentTrackType,
            "musicDir", LauncherConfig.musicDir().toString(),
            "crossfadeSeconds", crossfadeSeconds,
            "playlist", discoverTrackNames()
        );
    }

    public static synchronized Map<String, Object> toggle() {
        ensureInitialized();
        playing = !playing;
        LauncherConfig cfg = LauncherConfig.get();
        cfg.musicEnabled = playing;
        cfg.save();
        if (playing) currentTrack = chooseNextTrack();
        return state();
    }

    public static synchronized Map<String, Object> next() {
        ensureInitialized();
        currentTrack = chooseNextTrack();
        playing = true;
        return state();
    }

    public static synchronized Map<String, Object> updateVolume(double newVolume) {
        ensureInitialized();
        volume = Math.max(0.0d, Math.min(1.0d, newVolume));
        LauncherConfig cfg = LauncherConfig.get();
        cfg.musicVolume = (int) Math.round(volume * 100);
        cfg.save();
        return state();
    }

    public static List<Path> discoverTracks() {
        try {
            Files.createDirectories(LauncherConfig.musicDir());
            List<Path> found = new ArrayList<>();
            try (var stream = Files.list(LauncherConfig.musicDir())) {
                stream.filter(Files::isRegularFile)
                    .filter(path -> {
                        String name = path.getFileName().toString().toLowerCase();
                        return name.endsWith(".mp3")
                            || name.endsWith(".wav")
                            || name.endsWith(".ogg")
                            || name.endsWith(".bb")
                            || name.endsWith(".txt");
                    })
                    .forEach(found::add);
            }
            Collections.shuffle(found);
            return found;
        } catch (IOException ignored) {
            return List.of();
        }
    }

    public static List<String> discoverTrackNames() {
        List<String> names = new ArrayList<>();
        for (Path path : discoverTracks()) {
            names.add(path.getFileName().toString());
        }
        if (names.isEmpty()) names.addAll(DEFAULT_BYTEBEAT);
        return names;
    }

    public static String moduleCodeExample() {
        return """
            // MusicManager integration:
            // 1. create %APPDATA%/pulsePLUS/music if missing
            // 2. choose random mp3/wav/ogg/bytebeat source on startup
            // 3. when track ends, call next()
            // 4. fade current clip down while fading next one up over crossfadeSeconds
            // 5. persist musicEnabled + musicVolume in LauncherConfig
            """;
    }

    private static String chooseNextTrack() {
        List<Path> tracks = discoverTracks();
        if (!tracks.isEmpty()) {
            Path pick = tracks.get(RANDOM.nextInt(tracks.size()));
            String name = pick.getFileName().toString();
            String lower = name.toLowerCase();
            currentTrackType = lower.endsWith(".mp3") || lower.endsWith(".wav") || lower.endsWith(".ogg") ? "audio" : "bytebeat";
            return name;
        }
        currentTrackType = "bytebeat";
        return DEFAULT_BYTEBEAT.get(RANDOM.nextInt(DEFAULT_BYTEBEAT.size()));
    }
}
