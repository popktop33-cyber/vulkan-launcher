package launcher.mods;

import java.util.List;
import java.util.Map;

/**
 * Набор модов, которые дают основной прирост производительности.
 *
 * Каждый берётся с Modrinth по слагу. Вместе они дают кратный рост FPS на слабых
 * машинах — это не «оптимизация ради галочки», а самый заметный рычаг из всех,
 * что есть у лаунчера: флаги JVM убирают рывки, а эти моды поднимают сам FPS.
 *
 *   sodium        — переписанный рендерер, главный вклад в FPS
 *   lithium       — оптимизация игровой логики и физики
 *   ferrite-core  — заметно меньше памяти под модели и блокстейты
 *   immediatelyfast — быстрее отрисовка интерфейса и текста
 *   krypton       — сетевой стек, меньше нагрузка в мультиплеере
 *   entityculling — не рисует сущности, которых не видно
 *   modernfix     — ускоряет загрузку и снижает потребление памяти
 *
 * MemoryLeakFix в набор не входит: под 1.21.4 сборки нет, и мод висел бы
 * вечной ошибкой в отчёте. Проверено запросом к Modrinth.
 */
public final class PerformancePack {

    private PerformancePack() {}

    /** Слаг на Modrinth → человеческое имя для интерфейса. */
    public static final Map<String, String> MODS = Map.of(
        "sodium",         "Sodium",
        "lithium",        "Lithium",
        "ferrite-core",   "FerriteCore",
        "immediatelyfast", "ImmediatelyFast",
        "krypton",        "Krypton",
        "entityculling",  "EntityCulling",
        "modernfix",      "ModernFix"
    );

    /**
     * Порядок установки. Map.of порядок не гарантирует, поэтому список отдельный —
     * ставим от самого важного к вспомогательному, чтобы при обрыве связи
     * главное уже стояло.
     */
    public static final List<String> ORDER = List.of(
        "sodium", "lithium", "ferrite-core", "immediatelyfast",
        "krypton", "entityculling", "modernfix"
    );

    public static String name(String slug) {
        return MODS.getOrDefault(slug, slug);
    }
}
