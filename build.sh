#!/usr/bin/env bash
# Сборка vulkan-launcher.jar из src/.
#
# Требуется JDK 17+ (проект собран Temurin 17.0.19). Проверено: классы,
# собранные этим скриптом, байт-в-байт совпадают с классами в боевом jar.
#
# Использование:  ./build.sh
# Результат:      build/libs/vulkan-launcher.jar
#
# ВАЖНО про видео: крупные mp4 намеренно НЕ кладутся в jar.
# Фронтенд их не запрашивает — фоны отдаются эндпоинтом /videos/ из папки
# videos/ рядом с jar (см. web/js/app.js и launcher/web/WebServer.java).
# В боевом jar от 12.08 эти файлы лежали мёртвым грузом на 1,28 ГБ.

set -euo pipefail

# javac и jar — нативные Windows-бинарники, а пути в скрипте заданы в Unix-виде.
# Их переводит MSYS, но только пока не выставлен MSYS_NO_PATHCONV. Если он пришёл
# из окружения (его удобно включать для robocopy), сборка молча ломается на
# «file not found: \c\Users\...». Поэтому снимаем его здесь.
unset MSYS_NO_PATHCONV

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
OUT="$ROOT/build"
CLASSES="$OUT/classes"
JAR="$OUT/libs/vulkan-launcher.jar"

echo "[build] чистим $CLASSES"
rm -rf "$CLASSES"
mkdir -p "$CLASSES" "$OUT/libs"

echo "[build] компиляция Java"
# Список источников держим относительным: javac читает @-файл сам, без MSYS,
# и абсолютный Unix-путь внутри него он бы не понял.
cd "$SRC"
find src/main/java -name '*.java' > "$ROOT/build/sources.txt"
javac -encoding UTF-8 --release 17 \
      -d "$CLASSES" \
      -cp "$SRC/lib/gson-2.10.1.jar" \
      "@$ROOT/build/sources.txt"
cd "$ROOT"

echo "[build] вшиваем gson"
unzip -o -q "$SRC/lib/gson-2.10.1.jar" -d "$CLASSES"

echo "[build] ресурсы веб-интерфейса"
mkdir -p "$CLASSES/web"
cp -r "$SRC/src/main/resources/web/." "$CLASSES/web/"
# страховка: видео не должно попадать внутрь jar
find "$CLASSES/web" -name '*.mp4' -delete

echo "[build] манифест и упаковка"
printf 'Manifest-Version: 1.0\nMain-Class: launcher.Main\n' > "$OUT/manifest.txt"
jar cfm "$JAR" "$OUT/manifest.txt" -C "$CLASSES" .

echo "[build] готово: $JAR ($(stat -c %s "$JAR") байт)"
