package launcher.minecraft;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Shared, thread-safe launch progress that the UI polls via /api/launch/progress.
 *
 * The launch runs on a background thread and reports its stage + overall percent
 * here so the frontend can show a real progress bar instead of an instant "started".
 */
public final class LaunchProgress {

    private static volatile String stage = "idle";
    private static volatile String message = "Ready";
    private static volatile int percent = 0;
    private static volatile boolean error = false;

    private LaunchProgress() {}

    /** Called when a launch begins — clears any previous state. */
    public static synchronized void begin() {
        stage = "preparing";
        message = "Подготовка...";
        percent = 1;
        error = false;
    }

    /** Report a normal progress update. */
    public static synchronized void update(String stage, int percent, String message) {
        LaunchProgress.stage = stage;
        LaunchProgress.percent = Math.max(0, Math.min(100, percent));
        LaunchProgress.message = message;
        LaunchProgress.error = false;
    }

    /** Report the game process has been started. */
    public static synchronized void running(String message) {
        stage = "running";
        percent = 100;
        LaunchProgress.message = message;
        error = false;
    }

    /** Report a failure — the UI shows the message and stops polling. */
    public static synchronized void fail(String message) {
        stage = "error";
        LaunchProgress.message = message;
        error = true;
    }

    /** Snapshot for JSON serialization. */
    public static synchronized Map<String, Object> snapshot() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("stage", stage);
        m.put("percent", percent);
        m.put("message", message);
        m.put("error", error);
        return m;
    }
}
