package launcher;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;

/**
 * Переезд со старых папок профилей на сборки в instances/.
 *
 * До 13.09.2026 у лаунчера было ровно две игровые папки — minecraft/ и vanilla/,
 * и все версии с загрузчиками жили в них вперемешку: миры, моды и настройки одной
 * сборки лежали рядом с другой. Теперь у каждой сборки своя папка в instances/,
 * и то, что уже нажито, надо перенести туда, а не бросить.
 *
 * Переносим ровно один раз и только в одну сторону: то, что лежит в старой папке
 * и ещё не занято в сборке, переезжает в сборку. Обратно ничего не возвращается.
 * Удаления здесь нет вовсе — только перенос, поэтому сломать этим нечего: при
 * любой ошибке файл остаётся там, где был, и попытка повторится при следующем
 * запуске.
 *
 * Четыре папки остаются на месте намеренно: assets, libraries, versions и
 * downloads. Это общие склады прежних раскладок — оттуда лаунчер берёт уже
 * скачанное, чтобы не качать заново (см. legacyAssetRoots в MinecraftLauncher).
 * Переехав в сборку, они стали бы не видны всем остальным сборкам.
 */
public final class ProfileMigrator {

    /** Склады, общие для всех сборок: их не трогаем. */
    private static final Set<String> SHARED = Set.of("assets", "libraries", "versions", "downloads");

    /** Старые папки профилей и режим, которому каждая принадлежала. */
    private static final List<String[]> LEGACY = List.of(
        new String[]{"minecraft", "pulse"},
        new String[]{"vanilla",   "vanilla"});

    private ProfileMigrator() {}

    /**
     * Перенести нажитое из старых папок профилей в папки сборок.
     * Вызывать до того, как лаунчер заведёт хоть одну папку сборки: иначе
     * пустая заготовка встретит перенос и он пройдёт вхолостую.
     */
    public static void migrate() {
        for (String[] row : LEGACY) {
            try {
                migrateOne(LauncherConfig.dataDir().resolve(row[0]), row[1]);
            } catch (Exception e) {
                // Ничего не теряем: неудавшийся перенос просто повторится позже
                System.err.println("[pulsePLUS] Перенос " + row[0] + " не удался: " + e);
            }
        }
    }

    private static void migrateOne(Path legacy, String mode) throws IOException {
        if (!Files.isDirectory(legacy)) return;

        Path target = LauncherConfig.gameDir(mode);
        if (target.equals(legacy)) return;

        int moved = 0;
        Files.createDirectories(target);

        try (DirectoryStream<Path> entries = Files.newDirectoryStream(legacy)) {
            for (Path src : entries) {
                String name = src.getFileName().toString();
                if (SHARED.contains(name.toLowerCase())) continue;
                moved += moveInto(src, target.resolve(name));
            }
        }

        if (moved > 0) {
            System.out.println("[pulsePLUS] " + legacy.getFileName() + " → " + target.getFileName()
                + ": перенесено " + moved + " шт.");
        }
    }

    /**
     * Перенести один элемент внутрь сборки. Возвращает число перенесённых
     * записей: папка может сливаться по частям, если её место уже занято.
     *
     * Занятое не перезаписывается никогда — при совпадении имён в сборке
     * остаётся то, что там уже лежит, а старое остаётся на прежнем месте.
     */
    private static int moveInto(Path src, Path dst) throws IOException {
        if (!Files.exists(dst)) {
            Files.move(src, dst);
            return 1;
        }
        if (!Files.isDirectory(src) || !Files.isDirectory(dst)) return 0;

        // Место занято — сливаем по одному элементу. Одного уровня хватает:
        // mods/ внутри себя держит только jar-файлы, а saves/ — целые миры,
        // и те и другие переносятся целиком.
        int moved = 0;
        try (DirectoryStream<Path> kids = Files.newDirectoryStream(src)) {
            for (Path kid : kids) {
                Path kdst = dst.resolve(kid.getFileName());
                if (Files.exists(kdst)) continue;
                try {
                    Files.move(kid, kdst);
                    moved++;
                } catch (IOException skip) {
                    // Занятый файл — не повод бросать остальные
                }
            }
        }
        return moved;
    }
}
