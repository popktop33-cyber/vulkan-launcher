package launcher.minecraft;

import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;

/**
 * Аргументы JVM для запуска игры.
 *
 * Набор — это флаги Aikar (https://mcflags.emc.gs), отраслевой стандарт для
 * Minecraft. Без них G1 получает параметры, плохо подходящие игре: средний FPS
 * может быть высоким, а рывки — постоянными, потому что сборка мусора
 * срабатывает в самые неудачные моменты.
 *
 * Что делают ключевые:
 *   G1NewSizePercent / G1MaxNewSizePercent — расширяют молодое поколение.
 *     В игре почти весь мусор молодой, и на маленьком eden сборки идут часто.
 *   InitiatingHeapOccupancyPercent=15 — запускает фоновую сборку заранее,
 *     чтобы она не совпала с пиком нагрузки.
 *   AlwaysPreTouch — заранее выделяет и «протрогает» страницы кучи, чтобы
 *     игра не спотыкалась на их выделении по ходу.
 *   DisableExplicitGC — игнорирует System.gc(), который иначе даёт фриз.
 *   MaxTenuringThreshold=1 — почти всё умирает молодым и не доходит до старого
 *     поколения, а значит долгих сборок становится меньше.
 */
public final class JvmFlags {

    private JvmFlags() {}

    /** Полный объём оперативной памяти машины в МБ; 0 — если узнать не удалось. */
    public static long totalSystemRamMb() {
        try {
            com.sun.management.OperatingSystemMXBean bean =
                (com.sun.management.OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
            return bean.getTotalMemorySize() / (1024L * 1024L);
        } catch (Throwable t) {
            return 0L;
        }
    }

    /** Сколько памяти ставить по умолчанию, если пользователь ещё не выбирал. */
    public static int defaultRamMb() {
        long total = totalSystemRamMb();
        if (total <= 0) return 2048;
        if (total <= 4096) return 2048;
        if (total <= 8192) return 3072;
        if (total <= 16384) return 4096;
        return 6144;
    }

    /**
     * Не даём выставить столько, что системе не останется памяти.
     * Windows и сама игра вне кучи тоже требуют своего, а уход в свап хуже,
     * чем меньшая куча: свап даёт те самые длинные фризы, от которых уходим.
     */
    public static int clampRamMb(int requested) {
        final int min = 512;
        long total = totalSystemRamMb();
        if (total <= 0) return Math.max(min, Math.min(requested, 32768));
        long cap = Math.max(min, Math.min((long) (total * 0.6), 32768));
        return (int) Math.max(min, Math.min(requested, cap));
    }

    /** Полный набор для клиента. */
    public static List<String> aikar(int ramMb) {
        int ram = clampRamMb(ramMb);
        List<String> f = new ArrayList<>();
        // Xms равен Xmx: иначе куча растёт по ходу игры, а каждое расширение — рывок
        f.add("-Xms" + ram + "m");
        f.add("-Xmx" + ram + "m");
        f.add("-Xss1M");
        f.add("-XX:+UseG1GC");
        f.add("-XX:+ParallelRefProcEnabled");
        f.add("-XX:MaxGCPauseMillis=200");
        f.add("-XX:+UnlockExperimentalVMOptions");
        f.add("-XX:+DisableExplicitGC");
        f.add("-XX:+AlwaysPreTouch");
        f.add("-XX:G1NewSizePercent=30");
        f.add("-XX:G1MaxNewSizePercent=40");
        f.add("-XX:G1HeapRegionSize=8M");
        f.add("-XX:G1ReservePercent=20");
        f.add("-XX:G1HeapWastePercent=5");
        f.add("-XX:G1MixedGCCountTarget=4");
        f.add("-XX:InitiatingHeapOccupancyPercent=15");
        f.add("-XX:G1MixedGCLiveThresholdPercent=90");
        f.add("-XX:G1RSetUpdatingPauseTimePercent=5");
        f.add("-XX:SurvivorRatio=32");
        f.add("-XX:+PerfDisableSharedMem");
        f.add("-XX:MaxTenuringThreshold=1");
        f.add("-Dusing.aikars.flags=https://mcflags.emc.gs");
        f.add("-Daikars.new.flags=true");
        return f;
    }
}
