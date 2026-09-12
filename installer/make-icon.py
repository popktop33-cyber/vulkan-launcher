"""Иконки vulkan launcher.

Небула: газовое облако из мягких пятен, разбитое шумом, со звёздами.
Две темы — фиолетовая (режим чита) и зелёная (Vanilla). Палитра согласована
с launcher-redesign-preview.html и с акцентом bytebeat-вкладки.

Запуск:  python make-icon.py
Выход:   icon-vulkan.ico, icon-vanilla.ico, icon.ico (= vulkan, для установщика)
         icon-vulkan.png, icon-vanilla.png (превью)
"""
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 1024
RADIUS = 224
SEED = 20260912

THEMES = {
    # фиолетовая — режим чита
    "vulkan": {
        "bg_top": (18, 14, 34),
        "bg_bot": (8, 7, 16),
        "core": (176, 150, 255),
        "mid": (124, 92, 255),
        "deep": (66, 36, 150),
        "star": (236, 228, 255),
    },
    # зелёная — Vanilla
    "vanilla": {
        "bg_top": (14, 30, 22),
        "bg_bot": (7, 14, 10),
        "core": (168, 241, 183),
        "mid": (77, 178, 102),
        "deep": (28, 100, 54),
        "star": (232, 255, 238),
    },
}


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask():
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=RADIUS, fill=255)
    return m


def clip(layer, mask):
    return Image.composite(layer, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask)


def gradient(theme):
    g = Image.new("RGB", (1, S))
    for y in range(S):
        g.putpixel((0, y), lerp(theme["bg_top"], theme["bg_bot"], y / (S - 1)))
    return g.resize((S, S))


def blob(cx, cy, r, color, alpha):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(color) + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.55))


def make_nebula(theme):
    rnd = random.Random(SEED)
    mask = rounded_mask()

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(gradient(theme), (0, 0), mask)

    # Газовое облако: пятна вытянуты по диагонали, чтобы читалось как туманность,
    # а не как набор кругов.
    cloud = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for i in range(26):
        t = i / 25
        cx = S * (0.18 + 0.64 * t) + rnd.uniform(-70, 70)
        cy = S * (0.74 - 0.46 * t) + rnd.uniform(-70, 70)
        r = S * rnd.uniform(0.08, 0.22)
        color = lerp(theme["deep"], theme["mid"], rnd.random())
        cloud = Image.alpha_composite(cloud, blob(cx, cy, r, color, int(rnd.uniform(38, 96))))

    # Яркое ядро. Концентрированное намеренно: на 16–32 px (панель задач, ярлык)
    # мягкое облако схлопывается в тёмное пятно и фиолетовую от зелёной уже не отличить.
    cloud = Image.alpha_composite(cloud, blob(S * 0.46, S * 0.58, S * 0.26, theme["core"], 150))
    cloud = Image.alpha_composite(cloud, blob(S * 0.46, S * 0.58, S * 0.13, theme["core"], 205))

    # Шум разбивает облако на волокна — без него видны отдельные эллипсы
    noise = Image.effect_noise((S, S), 60).filter(ImageFilter.GaussianBlur(9))
    noise = noise.point(lambda v: 112 + v * 0.56)
    cloud.putalpha(ImageChops.multiply(cloud.getchannel("A"), noise))

    img = Image.alpha_composite(img, clip(cloud, mask))

    # Звёзды: ядро плюс мягкое свечение вокруг
    stars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    for _ in range(90):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        r = rnd.uniform(1.0, 3.4)
        sd.ellipse([x - r, y - r, x + r, y + r], fill=theme["star"] + (int(rnd.uniform(90, 235)),))
    stars = Image.alpha_composite(stars.filter(ImageFilter.GaussianBlur(7)), stars)
    img = Image.alpha_composite(img, clip(stars, mask))

    ImageDraw.Draw(img).rounded_rectangle(
        [1, 1, S - 2, S - 2], radius=RADIUS - 1, outline=theme["core"] + (50,), width=3
    )
    return img


def preview_strip():
    """Контрольный лист: как иконка выглядит в тех размерах, где она реально живёт
    (панель задач, ярлык, список файлов). Увеличение кратно 8 для глаза."""
    sizes = [16, 24, 32, 48]
    scale, gap = 8, 12
    cell = max(sizes) * scale
    strip = Image.new("RGBA", ((cell + gap) * len(sizes) + gap, (cell + gap) * 2 + gap), (22, 22, 26, 255))
    for row, name in enumerate(THEMES):
        ico = Image.open(f"icon-{name}.ico")
        for col, size in enumerate(sizes):
            ico.size = (size, size)  # у ICO так выбирается нужный кадр
            frame = ico.copy().convert("RGBA")
            frame = frame.resize((size * scale, size * scale), Image.NEAREST)
            x = gap + col * (cell + gap) + (cell - size * scale) // 2
            y = gap + row * (cell + gap) + (cell - size * scale) // 2
            strip.paste(frame, (x, y), frame)
    strip.save("icon-preview-sizes.png")
    print("готово: icon-preview-sizes.png (сверху vulkan, снизу vanilla; 16/24/32/48 px)")


def main():
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    for name, theme in THEMES.items():
        img = make_nebula(theme)
        img.resize((256, 256), Image.LANCZOS).save(f"icon-{name}.ico", sizes=sizes)
        img.resize((512, 512), Image.LANCZOS).save(f"icon-{name}.png")
        print(f"готово: icon-{name}.ico")

    # Установщик и exe берут фиолетовую — она основная
    Image.open("icon-vulkan.ico").save("icon.ico")
    print("готово: icon.ico (копия vulkan)")
    preview_strip()


if __name__ == "__main__":
    main()
