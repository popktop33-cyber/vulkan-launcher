package launcher.minecraft;

import launcher.LauncherConfig;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Какую Java отдать игре.
 *
 * Раньше выбор был «первая существующая»: своя настройка, потом JAVA_HOME, потом
 * та Java, на которой работает сам лаунчер. Версию не смотрел никто, и этого
 * хватало, пока все версии игры шли на одной Java. Теперь нет: 1.21.11 требует
 * Java 21, и запуск на 17-й кончается не понятной ошибкой лаунчера, а падением
 * самой JVM ещё до кода игры:
 *
 *     UnsupportedClassVersionError: class file version 65.0 … up to 61.0
 *
 * Снаружи это выглядит как «игра не запускается», и по тексту причины не угадать.
 * Хуже того, JAVA_HOME в том порядке стоял ВЫШЕ рабочей JVM: у кого он указывает
 * на старую Java, у того падало всё новее 1.20.1, хотя подходящая лежала рядом —
 * ею же лаунчер и был запущен.
 *
 * Отсюда порядок: сначала ищем ту, что подходит по версии, и только потом «хоть
 * какую-нибудь». Требуемая версия берётся из version-JSON (поле javaVersion), а
 * не из головы: у 1.20.1 это 17, у 1.21.11 — 21.
 *
 * Каждый кандидат проверяется запуском {@code java -version}, и ответ
 * запоминается: бэкенд живёт долго, а запусков игры за его жизнь бывает много,
 * поэтому платим за проверку один раз.
 */
public final class JavaRuntime {

    /** Версии уже проверенных Java: путь → старшая версия (0 — не запустилась). */
    private static final Map<String, Integer> VERSIONS = new ConcurrentHashMap<>();

    /** java version "21.0.5" / openjdk version "1.8.0_402" */
    private static final Pattern VERSION = Pattern.compile("version \"(\\d+)(?:\\.(\\d+))?");

    /** Папки, где Java ставится сама: те же поставщики, что ищет installer/main.js. */
    private static final String[] VENDORS = {
        "Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto",
        "BellSoft", "Semeru", "Oracle", "JetBrains"
    };

    private JavaRuntime() {}

    /**
     * Java ровно той версии, что требует игра, либо null.
     *
     * Отличается от pick() намеренно. pick() берёт ближайшую подходящую по
     * правилу «не старее требуемой», и для игры, которой нужна Java 8, это
     * даёт 17 — формально подходит (17 больше 8), а игра на ней не идёт.
     * Требование в version-JSON это не минимум, а та версия, на которой
     * версию проверяли, поэтому для запуска ищем точное совпадение, а если
     * такого нет — честно идём скачивать нужную (см. JavaInstaller).
     */
    public static String pickExact(LauncherConfig cfg, int required) {
        if (required <= 0) return null;
        for (String exe : candidates(cfg)) {
            if (versionOf(exe) == required) return exe;
        }
        return null;
    }

    /**
     * Путь к подходящей Java. required — старшая версия, которую требует версия
     * игры (0 — требование неизвестно, тогда годится любая работающая).
     *
     * Если подходящей нет, но какая-то Java на компьютере точно есть, бросаем
     * исключение с внятным текстом: игра на неподходящей не запустится всё равно,
     * и лучше сказать это прямо, чем показать падение JVM. А вот если не нашлось
     * вообще ничего (наши проверки не сработали, PATH и тот молчит), ведём себя
     * как раньше — пусть попробует, вдруг она есть.
     */
    public static String pick(LauncherConfig cfg, int required) {
        List<String> order = candidates(cfg);

        // Требование неизвестно (установщик загрузчика, незнакомый version-JSON):
        // годится первая живая — так было и раньше.
        if (required <= 0) {
            for (String exe : order) if (versionOf(exe) != 0) return exe;
            System.out.println("[java] ни одна Java не ответила, пробую «" + lastResort() + "» из PATH");
            return lastResort();
        }

        // Выбор человека проверяется первым, но не отменяет требование версии:
        // Java 8, указанная руками, игру 1.21 не запустит, и делать вид, что
        // запустит, нельзя.
        String chosen = path(cfg.javaPath);
        if (chosen != null && versionOf(chosen) >= required) return chosen;

        warm(order);                       // версии всех кандидатов — разом, а не по очереди

        String best = null;
        int bestVersion = 0;
        String older = null;
        int olderVersion = -1;

        for (String exe : order) {
            int v = versionOf(exe);
            if (v == 0) continue;                       // нет такого или не отвечает
            if (v < required) {
                if (v > olderVersion) { olderVersion = v; older = exe; }
                continue;
            }
            // Ближайшая подходящая, а не самая новая: у 1.21.11 требование 21,
            // и запускать её на 25-й, которая стоит ради самого лаунчера, — значит
            // испытывать игру на JVM, которой при её выпуске ещё не существовало.
            // Требование из version-JSON и есть та Java, на которой её проверяли.
            if (best == null || v < bestVersion) { best = exe; bestVersion = v; }
        }

        if (best != null) {
            if (chosen != null) {
                System.out.println("[java] указанная в настройках Java не подходит "
                    + "(нужна " + required + " или новее), беру " + best);
            }
            System.out.println("[java] игра пойдёт на Java " + bestVersion + ": " + best);
            return best;
        }
        if (older != null) {
            throw new IllegalStateException(
                "Этой версии игры нужна Java " + required + " или новее, а на компьютере только "
                + olderVersion + " (" + older + "). Установите новую Java или укажите её путь в настройках.");
        }
        System.out.println("[java] подходящая Java не нашлась, пробую «" + lastResort() + "» из PATH");
        return lastResort();
    }

    /** java.exe вместо javaw.exe — для установщиков, чей вывод надо читать. */
    public static String console(String exe) {
        return exe.replace("javaw.exe", "java.exe").replace("javaw", "java");
    }

    /** Старшая версия Java по пути к исполняемому файлу; 0 — не запустилась. */
    public static int versionOf(String exe) {
        if (exe == null || exe.isBlank()) return 0;
        Integer known = VERSIONS.get(exe);
        if (known != null) return known;
        int v = probe(exe);
        VERSIONS.put(exe, v);
        return v;
    }

    /**
     * Кандидаты по порядку. Своя настройка и JAVA_HOME идут первыми не потому,
     * что им доверяем, а потому что их выбор сделал человек: если они подходят
     * по версии, ничего искать не придётся.
     */
    private static List<String> candidates(LauncherConfig cfg) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        add(out, cfg.javaPath);
        add(out, path(System.getenv("JAVA_HOME")));
        add(out, path(System.getProperty("java.home")));
        out.addAll(bundled());
        out.addAll(installed());
        out.add(lastResort());
        return new ArrayList<>(out);
    }

    /**
     * Java, лежащая папкой рядом с лаунчером: runtime-x64, runtime21-x86 и подобные.
     *
     * Они есть только в сборке без установщика, и там их несколько намеренно:
     * игре 1.21.x нужна Java 21, а 1.20.x — 17, одной на всё не хватает. До этой
     * правки вторая лежала бы рядом и оставалась невидимой: кандидаты
     * перечисляли системные Java, JAVA_HOME и ту, на которой запущен сам
     * лаунчер, — а папку рядом никто не смотрел. Снаружи это выглядело как
     * «игра не запускается, хотя Java 21 лежит в соседней папке».
     */
    private static List<String> bundled() {
        List<String> out = new ArrayList<>();
        File here = jarDir();
        if (here == null) return out;
        File[] dirs = here.listFiles();
        if (dirs == null) return out;
        // Порядок обхода у файловой системы свой, а от него зависит, какую из
        // равных по версии выберет pick. Сортируем, чтобы выбор был один и тот же.
        Arrays.sort(dirs);
        String win = exeName();
        for (File dir : dirs) {
            if (!dir.isDirectory() || !dir.getName().startsWith("runtime")) continue;
            File exe = new File(new File(dir, "bin"), win);
            if (exe.exists()) out.add(exe.getAbsolutePath());
        }
        return out;
    }

    /** Папка, в которой лежит наш jar; null, если определить не удалось. */
    private static File jarDir() {
        try {
            return new File(JavaRuntime.class.getProtectionDomain()
                .getCodeSource().getLocation().toURI()).getParentFile();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Спросить версии у всех кандидатов разом.
     *
     * Одна проба — это запуск JVM, около трети секунды, а кандидатов бывает
     * пять-шесть: по очереди первый запуск игры ждал бы их все. Разом — столько
     * же, сколько одна. Ответы кэшируются, так что платим один раз за жизнь
     * бэкенда.
     */
    private static void warm(List<String> order) {
        order.parallelStream().forEach(JavaRuntime::versionOf);
    }

    private static void add(LinkedHashSet<String> out, String dir) {
        String exe = path(dir);
        if (exe != null) out.add(exe);
    }

    /**
     * Путь к javaw по тому, что ввёл человек. Годится и папка Java, и сам
     * исполняемый файл: в настройках это свободное поле с подсказкой
     * «Auto-detect», и угадывать, что имел в виду игрок, дешевле, чем объяснять.
     */
    private static String path(String home) {
        if (home == null || home.isBlank()) return null;
        String value = home.trim().replace("\"", "");
        File file = new File(value);
        if (file.isFile()) return file.getPath();          // указали сам java.exe/javaw.exe
        String exe = value + File.separator + "bin" + File.separator + exeName();
        return new File(exe).exists() ? exe : null;
    }

    /**
     * Java, поставленные в систему: Program Files у каждого поставщика плюс
     * пользовательские установки в LOCALAPPDATA (туда ставит свои JDK IntelliJ и
     * часть установщиков Oracle).
     */
    private static List<String> installed() {
        String win = exeName();
        List<String> bases = new ArrayList<>();
        for (String env : new String[]{"ProgramFiles", "ProgramFiles(x86)"}) {
            String b = System.getenv(env);
            if (b != null) bases.add(b);
        }
        String local = System.getenv("LOCALAPPDATA");
        if (local != null) bases.add(local + File.separator + "Programs");

        List<String> out = new ArrayList<>();
        for (String base : bases) {
            for (String vendor : VENDORS) {
                File dir = new File(base, vendor);
                File[] children = dir.listFiles();
                if (children == null) continue;
                // Порядок обхода файловой системы свой, а от него зависит, какую
                // из равных по версии выберет pick. Сортируем, чтобы выбор был
                // один и тот же от запуска к запуску (в bundled() то же самое).
                Arrays.sort(children);
                for (File jdk : children) {
                    String exe = jdk + File.separator + "bin" + File.separator + win;
                    if (new File(exe).exists()) out.add(exe);
                }
            }
        }
        return out;
    }

    private static String exeName() {
        boolean win = System.getProperty("os.name", "").toLowerCase().contains("win");
        return win ? "javaw.exe" : "java";
    }

    /** Последняя надежда — то, что лежит в PATH. */
    private static String lastResort() {
        return "java";
    }

    /** Спросить у Java её версию. Долго (запуск процесса), поэтому с кэшем. */
    private static int probe(String exe) {
        Process p = null;
        try {
            ProcessBuilder pb = new ProcessBuilder(exe, "-version");
            pb.redirectErrorStream(true);
            p = pb.start();

            // Вывод читаем отдельным потоком. Раньше его читали прямо здесь, до
            // waitFor, и таймаут ниже не работал никогда: чтение ждёт закрытия
            // потока, то есть конца процесса, — зависшая Java блокировала
            // проверку навсегда. Вызовов у нас немного, но каждый запуск игры
            // проходит через этот код, а путь к Java игрок вводит руками.
            Process proc = p;
            String[] out = new String[1];
            Thread reader = new Thread(() -> {
                try (var in = proc.getInputStream()) {
                    out[0] = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                } catch (Exception ignored) {
                    // процесс убили — считаем, что версии нет
                }
            });
            reader.setDaemon(true);
            reader.start();

            if (!p.waitFor(15, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return 0;                 // не ответила за 15 секунд — негодная
            }
            reader.join(2000);            // join даёт видимость записи из потока
            return parse(out[0]);
        } catch (Exception e) {
            return 0;                 // нет файла, не запускается, не отвечает
        } finally {
            if (p != null) p.destroy();
        }
    }

    /** «version "21.0.5"» → 21, «version "1.8.0_402"» → 8. */
    static int parse(String versionOutput) {
        Matcher m = VERSION.matcher(versionOutput == null ? "" : versionOutput);
        if (!m.find()) return 0;
        int major = Integer.parseInt(m.group(1));
        if (major != 1) return major;
        return m.group(2) == null ? 0 : Integer.parseInt(m.group(2));
    }
}
