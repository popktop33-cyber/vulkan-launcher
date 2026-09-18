#!/usr/bin/env python3
"""
Сборка vulkan-launcher-java.zip — версии лаунчера без установщика.

Зачем она нужна. Обычная сборка несёт внутри Electron, то есть Chromium:
двести с лишним мегабайт, требование Windows 10 и набора инструкций SSE3,
и установщик, который антивирусы умеют молча блокировать — на слабой
машине это выглядит как «дважды щёлкнул и ничего не произошло».
Здесь ничего этого нет: обычная Java, интерфейс открывается в браузере,
который у игрока уже есть.

Что внутри архива:
  vulkan-launcher.jar   — бэкенд, он же отдаёт весь интерфейс по HTTP
  runtime-x64/          — Java 17 для 64-битной Windows
  runtime-x86/          — Java 17 для 32-битной Windows
  runtime21-x64/        — Java 21 для 64-битной Windows
  videos/               — фоны вкладок, облегчённые: 720p, 30 кадров в секунду
  ЗАПУСТИТЬ.bat         — выбирает рантайм по разрядности и запускает
  ПРОЧТИ МЕНЯ.txt       — пояснение для игрока

Рантаймы кладутся оба набора и обе разрядности. Разрядности — потому что на
32-битной Windows 64-битный не запустится вовсе, а на 64-битной 32-битный хоть
и пойдёт, но упрётся в предел памяти. Версии — потому что одной Java на всё не
хватает: 1.21.x требует Java 21, а 1.20.x — 17. Раньше лежала только 17, и игра
на 1.21 не запускалась с «нужна Java 21 или новее», хотя подходящая была бы
рядом. JavaRuntime.bundled() ищет папки `runtime*` рядом с jar и отдаёт игре ту,
что подходит по версии.

Java 21 для 32-битной Windows не существует (Adoptium отдаёт 404), поэтому
32-битный набор остаётся на 17-й, и версии 1.21+ на такой системе не пойдут —
это ограничение самой Java, а не лаунчера.

Ролики лежат рядом с jar, а не в папке игрока: WebServer ищет фон сначала в
данных игрока, потом рядом с собой, поэтому в архиве они находятся сразу и
докладывать их руками не нужно. Набор здесь облегчённый (720p30) — окно
лаунчера меньше 720p, а кадров вдвое меньше, и на слабой машине это ровно
вдвое дешевле: замерено 70% ядра против 50%.

Использование:  python make-java-zip.py
Результат:      build/vulkan-launcher-java.zip

Отметки времени внутри архива фиксированы, поэтому пересборка из тех же
исходников даёт тот же файл и ту же контрольную сумму — опубликованную
сумму можно проверить, просто собрав архив заново.
"""

import codecs
import hashlib
import os
import shutil
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(ROOT, "build")
JAR = os.path.join(BUILD, "libs", "vulkan-launcher.jar")
SRC_DIR = os.path.join(ROOT, "java-dist")
LITE_VIDEOS = os.path.join(ROOT, "installer", "backend", "videos-lite")
CACHE = os.path.join(BUILD, "javaruntime")
STAGE = os.path.join(BUILD, "javabuild")
OUT = os.path.join(BUILD, "vulkan-launcher-java.zip")

# Одна и та же дата у всех записей: иначе архив менялся бы при каждой сборке
# и контрольная сумма ничего бы не значила.
STAMP = (2026, 1, 1, 0, 0, 0)

RUNTIMES = [
    ("runtime-x64",    17, "x64", "jre17-x64.zip", "64-бит, Java 17"),
    ("runtime-x86",    17, "x32", "jre17-x86.zip", "32-бит, Java 17"),
    # Java 21 для 32-битной Windows не существует: Adoptium отдаёт на неё 404
    # (проверено по всем сочетаниям jre/jdk). Поэтому x86 остаётся на 17-й, и
    # версии игры, которым нужна 21, на 32-битной системе не запустятся —
    # подходящей JVM для неё просто нет.
    ("runtime21-x64",  21, "x64", "jre21-x64.zip", "64-бит, Java 21"),
]

ADOPTIUM = "https://api.adoptium.net/v3/binary/latest/{ver}/ga/windows/{arch}/jre/hotspot/normal/eclipse"

# Без него Adoptium отвечает 403 (проверено на Python-urllib).
USER_AGENT = "vulkan-launcher-build/1.1 (+https://github.com/popktop33-cyber/vulkan-launcher)"


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        print(f"  уже скачано: {os.path.basename(dest)} "
              f"({os.path.getsize(dest) / 1048576:.1f} МБ)")
        return
    print(f"  качаю: {url}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    # Свой User-Agent обязателен: Adoptium отдаёт на «Python-urllib/3.x»
    # ошибку 403 Forbidden, и выглядит это как недоступный адрес, а не как
    # запрет по клиенту.
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    os.replace(tmp, dest)
    print(f"  готово: {os.path.getsize(dest) / 1048576:.1f} МБ")


def unpack_jre(zip_path, target):
    if os.path.exists(target):
        shutil.rmtree(target)
    with zipfile.ZipFile(zip_path) as z:
        top = sorted({n.split("/")[0] for n in z.namelist()})[0] + "/"
        count = 0
        for entry in z.namelist():
            if not entry.startswith(top) or entry.endswith("/"):
                continue
            out = os.path.join(target, entry[len(top):].replace("/", os.sep))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(z.read(entry))
            count += 1
    return count


def write_text(src_name, dst_path, encoding, bom=b""):
    """
    Перекодировка из UTF-8 в то, что нужно Windows.

    Кодируем ДО открытия файла: open(..., "wb") обнуляет его сразу, и если
    кодирование сорвётся, на месте останется пустышка — так уже случалось.
    """
    with open(os.path.join(SRC_DIR, src_name), encoding="utf-8") as f:
        text = f.read().replace("\r\n", "\n")
    data = bom + text.replace("\n", "\r\n").encode(encoding)
    with open(dst_path, "wb") as f:
        f.write(data)
    return len(data)


def zip_tree(root, out):
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            entries.append((full, os.path.relpath(full, root).replace(os.sep, "/")))
    entries.sort(key=lambda e: e[1])

    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for full, arc in entries:
            info = zipfile.ZipInfo(arc, date_time=STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0          # Windows: иначе права из Unix
            info.external_attr = 0o600 << 16
            with open(full, "rb") as f:
                z.writestr(info, f.read())
    return len(entries)


def main():
    if not os.path.exists(JAR):
        print("Нет build/libs/vulkan-launcher.jar — сначала соберите бэкенд: ./build.sh")
        return 1

    print("[java-zip] рантаймы Java")
    for _, ver, arch, cache_name, label in RUNTIMES:
        download(ADOPTIUM.format(ver=ver, arch=arch), os.path.join(CACHE, cache_name))

    print("[java-zip] раскладываю")
    if os.path.exists(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE)

    for target_name, _, _, cache_name, label in RUNTIMES:
        n = unpack_jre(os.path.join(CACHE, cache_name), os.path.join(STAGE, target_name))
        print(f"  {target_name}: {n} файлов ({label})")

    shutil.copy2(JAR, os.path.join(STAGE, "vulkan-launcher.jar"))

    # Фоны вкладок кладём рядом с jar: WebServer ищет их там вторым местом
    # после папки игрока, поэтому в архиве они работают сразу. Без этого
    # интерфейс открывался с пустым фоном, и докладывать ролики приходилось
    # руками — игрок про это не знал.
    if not os.path.isdir(LITE_VIDEOS):
        print(f"Нет папки {LITE_VIDEOS} — соберите облегчённые ролики")
        return 1
    videos = [n for n in sorted(os.listdir(LITE_VIDEOS)) if n.endswith(".mp4")]
    if not videos:
        print(f"В {LITE_VIDEOS} нет роликов")
        return 1
    shutil.copytree(LITE_VIDEOS, os.path.join(STAGE, "videos"))
    total = sum(os.path.getsize(os.path.join(LITE_VIDEOS, n)) for n in videos)
    print(f"  videos: {len(videos)} роликов ({total / 1048576:.1f} МБ)")

    # cmd.exe читает .bat в кодировке консоли, а не в UTF-8: русский текст
    # в UTF-8 превращался на экране в мусор. CP866 — родная для русской
    # Windows, и файл, и вывод в ней совпадают.
    n = write_text("ЗАПУСТИТЬ.bat", os.path.join(STAGE, "ЗАПУСТИТЬ.bat"), "cp866")
    print(f"  ЗАПУСТИТЬ.bat: {n} байт (CP866)")
    # Блокнот по метке порядка байтов понимает UTF-8 даже на старых сборках.
    n = write_text("ПРОЧТИ МЕНЯ.txt", os.path.join(STAGE, "ПРОЧТИ МЕНЯ.txt"),
                   "utf-8", codecs.BOM_UTF8)
    print(f"  ПРОЧТИ МЕНЯ.txt: {n} байт (UTF-8 с меткой)")

    print("[java-zip] упаковываю")
    count = zip_tree(STAGE, OUT)
    size = os.path.getsize(OUT)
    digest = hashlib.sha256(open(OUT, "rb").read()).hexdigest()
    print(f"\n{OUT}")
    print(f"  файлов: {count}, размер: {size / 1048576:.1f} МБ")
    print(f"  sha256: {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
