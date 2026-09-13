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
  runtime-x64/          — Java для 64-битной Windows
  runtime-x86/          — Java для 32-битной Windows
  ЗАПУСТИТЬ.bat         — выбирает рантайм по разрядности и запускает
  ПРОЧТИ МЕНЯ.txt       — пояснение для игрока

Рантаймы кладутся оба: на 32-битной Windows 64-битный не запустится вовсе,
а на 64-битной 32-битный хоть и пойдёт, но упрётся в предел памяти.

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
CACHE = os.path.join(BUILD, "javaruntime")
STAGE = os.path.join(BUILD, "javabuild")
OUT = os.path.join(BUILD, "vulkan-launcher-java.zip")

# Одна и та же дата у всех записей: иначе архив менялся бы при каждой сборке
# и контрольная сумма ничего бы не значила.
STAMP = (2026, 1, 1, 0, 0, 0)

RUNTIMES = [
    ("runtime-x64", "x64", "jre-x64.zip", "64-битная Windows"),
    ("runtime-x86", "x32", "jre-x86.zip", "32-битная Windows"),
]

ADOPTIUM = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/{arch}/jre/hotspot/normal/eclipse"


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        print(f"  уже скачано: {os.path.basename(dest)} "
              f"({os.path.getsize(dest) / 1048576:.1f} МБ)")
        return
    print(f"  качаю: {url}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
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
    for _, arch, cache_name, label in RUNTIMES:
        download(ADOPTIUM.format(arch=arch), os.path.join(CACHE, cache_name))

    print("[java-zip] раскладываю")
    if os.path.exists(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE)

    for target_name, _, cache_name, label in RUNTIMES:
        n = unpack_jre(os.path.join(CACHE, cache_name), os.path.join(STAGE, target_name))
        print(f"  {target_name}: {n} файлов ({label})")

    shutil.copy2(JAR, os.path.join(STAGE, "vulkan-launcher.jar"))

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
