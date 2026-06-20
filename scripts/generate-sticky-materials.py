from __future__ import annotations

import math
import random
from pathlib import Path
from zlib import crc32

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "sticky-materials"
SEED = 42817


def stable_seed(value: str) -> int:
    return SEED + crc32(value.encode("utf-8")) % 100_000


def save_material(img: Image.Image, path: str, quality: int = 78) -> None:
    destination = OUT / path
    if destination.suffix == ".webp":
        img.convert("RGB").save(destination, "WEBP", quality=quality, method=6)
        return

    img.save(destination, optimize=True)


def clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(clamp(a[i] * (1 - t) + b[i] * t) for i in range(4))


def noisy_surface(
    path: str,
    base: tuple[int, int, int, int],
    warm: tuple[int, int, int, int],
    cool: tuple[int, int, int, int],
    size: int = 512,
    alpha_jitter: int = 10,
    fibers: int = 120,
    blur: float = 0.25,
) -> None:
    rng = random.Random(stable_seed(path))
    img = Image.new("RGBA", (size, size), base)
    px = img.load()

    for y in range(size):
        wave = math.sin(y / 31.0) * 4 + math.sin(y / 113.0) * 5
        for x in range(size):
            grain = rng.randint(-alpha_jitter, alpha_jitter) + wave + math.sin((x + y) / 67.0) * 4
            tint = warm if grain >= 0 else cool
            amount = min(0.22, abs(grain) / 80)
            px[x, y] = mix(base, tint, amount)

    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(fibers):
        x = rng.randint(-80, size + 80)
        y = rng.randint(0, size)
        length = rng.randint(6, 58)
        tilt = rng.uniform(-0.12, 0.12)
        color = mix(warm, cool, rng.random())
        color = (color[0], color[1], color[2], rng.randint(3, 10))
        draw.line((x, y, x + length, y + tilt * length), fill=color, width=rng.choice([1, 1, 1, 2]))

    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    save_material(img, path, quality=76)


def ruled_paper(path: str, tone: str) -> None:
    if tone == "dark":
        base = (12, 25, 34, 222)
        line = (96, 179, 245, 42)
        margin = (98, 176, 238, 48)
        fiber_warm = (104, 180, 246, 130)
        fiber_cool = (18, 42, 60, 150)
    else:
        base = (248, 252, 247, 238)
        line = (48, 110, 176, 36)
        margin = (52, 136, 202, 44)
        fiber_warm = (255, 244, 210, 150)
        fiber_cool = (181, 213, 235, 130)

    size = 512
    noisy_surface(path, base, fiber_warm, fiber_cool, size=size, alpha_jitter=5, fibers=80, blur=0.22)
    img = Image.open(OUT / path).convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    for y in range(74, size, 43):
        draw.line((0, y, size, y), fill=line, width=1)
    draw.line((89, 0, 89, size), fill=margin, width=1)

    # Slight uneven shadowing near page edges.
    edge = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    edge_draw = ImageDraw.Draw(edge, "RGBA")
    for i in range(36):
        alpha = clamp((36 - i) * (2.2 if tone == "dark" else 1.15))
        edge_draw.rectangle((i, i, size - i - 1, size - i - 1), outline=(0, 0, 0, alpha))
    img = Image.alpha_composite(img, edge.filter(ImageFilter.GaussianBlur(6)))
    save_material(img, path, quality=78)


def wood(path: str, dark: bool = False) -> None:
    rng = random.Random(SEED + (921 if dark else 317))
    w, h = 960, 720
    img = Image.new("RGBA", (w, h), (66, 39, 22, 255) if dark else (190, 126, 60, 255))
    px = img.load()

    palette = (
        [(36, 22, 13), (51, 31, 17), (77, 48, 28), (105, 66, 37)]
        if dark
        else [(152, 92, 38), (185, 119, 53), (216, 157, 82), (238, 188, 111)]
    )

    plank_w = 180
    for x in range(w):
        plank = x // plank_w
        base = palette[plank % len(palette)]
        seam = 0
        if x % plank_w < 4 or x % plank_w > plank_w - 5:
            seam = -32 if dark else -36
        for y in range(h):
            wave = (
                math.sin((x + plank * 31) / 17.0) * 9
                + math.sin((x + y * 0.18) / 41.0) * 11
                + math.sin((y + plank * 61) / 97.0) * 8
                + rng.randint(-8, 8)
                + seam
            )
            px[x, y] = (
                clamp(base[0] + wave),
                clamp(base[1] + wave * 0.72),
                clamp(base[2] + wave * 0.45),
                255,
            )

    draw = ImageDraw.Draw(img, "RGBA")
    for x in range(0, w, plank_w):
        draw.line((x, 0, x, h), fill=(0, 0, 0, 68 if dark else 34), width=3)
        draw.line((x + 4, 0, x + 4, h), fill=(255, 235, 180, 12 if dark else 24), width=1)

    knots = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    kdraw = ImageDraw.Draw(knots, "RGBA")
    for _ in range(34):
        cx = rng.randint(30, w - 30)
        cy = rng.randint(40, h - 40)
        rx = rng.randint(15, 48)
        ry = rng.randint(8, 26)
        fill = (13, 8, 5, rng.randint(8, 22)) if dark else (86, 47, 18, rng.randint(7, 18))
        ring = (8, 5, 3, rng.randint(18, 38)) if dark else (103, 58, 24, rng.randint(14, 28))
        kdraw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=fill)
        for inset in range(0, rng.randint(2, 5)):
            if rx - inset * 7 <= 3 or ry - inset * 4 <= 3:
                break
            kdraw.ellipse(
                (
                    cx - rx + inset * 7,
                    cy - ry + inset * 4,
                    cx + rx - inset * 7,
                    cy + ry - inset * 4,
                ),
                outline=ring,
                width=1,
            )
    img = Image.alpha_composite(img, knots.filter(ImageFilter.GaussianBlur(1.35)))

    img = img.filter(ImageFilter.UnsharpMask(radius=1.1, percent=120, threshold=3))
    save_material(img, path, quality=80)


NOTE_COLORS = {
    "sun": ((255, 218, 101, 246), (255, 246, 177, 248), (155, 93, 11, 88)),
    "coral": ((255, 159, 167, 244), (255, 213, 213, 248), (155, 42, 46, 84)),
    "mint": ((181, 221, 142, 244), (229, 246, 202, 248), (56, 109, 41, 84)),
    "sky": ((167, 211, 247, 244), (221, 241, 255, 248), (32, 103, 166, 84)),
    "violet": ((196, 165, 238, 244), (232, 216, 255, 248), (79, 53, 145, 84)),
    "ink": ((128, 111, 96, 244), (187, 169, 144, 248), (39, 31, 26, 92)),
}


def note(path: str, color_key: str, dark: bool = False) -> None:
    rng = random.Random(stable_seed(path))
    base, hi, edge_color = NOTE_COLORS[color_key]
    if dark:
        base = mix(base, (20, 20, 22, 255), 0.62)
        hi = mix(hi, (38, 38, 42, 255), 0.58)
        edge_color = mix(edge_color, (0, 0, 0, 255), 0.5)

    w, h = 460, 176
    img = Image.new("RGBA", (w, h), base)
    px = img.load()
    for y in range(h):
        for x in range(w):
            vertical = y / h
            horizontal = x / w
            wave = math.sin(x / 23.0) * 4 + math.sin((x + y) / 69.0) * 6 + rng.randint(-8, 8)
            tint = mix(base, hi, 0.25 + vertical * 0.25 + horizontal * 0.05)
            px[x, y] = (
                clamp(tint[0] + wave),
                clamp(tint[1] + wave),
                clamp(tint[2] + wave),
                tint[3],
            )

    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(18 if dark else 24):
        x = rng.randint(0, w)
        y = rng.randint(0, h)
        length = rng.randint(4, 34)
        alpha = rng.randint(1 if dark else 2, 3 if dark else 5)
        draw.line((x, y, x + length, y + rng.randint(-5, 5)), fill=(255, 255, 230, alpha), width=1)

    for i in range(18):
        alpha = clamp((18 - i) * 3.8)
        draw.rectangle((i, i, w - i - 1, h - i - 1), outline=(edge_color[0], edge_color[1], edge_color[2], alpha))

    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow, "RGBA")
    sdraw.rectangle((0, h - 16, w, h), fill=(0, 0, 0, 20 if dark else 16))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(11)))
    save_material(img, path, quality=78)


def tape(path: str, dark: bool = False) -> None:
    rng = random.Random(stable_seed(path))
    w, h = 320, 86
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    base = (231, 226, 204, 105) if not dark else (180, 168, 150, 82)
    hi = (255, 255, 244, 74) if not dark else (255, 245, 220, 32)
    draw = ImageDraw.Draw(img, "RGBA")
    points = [(18, 7), (w - 24, 2), (w - 11, h - 14), (11, h - 5)]
    draw.polygon(points, fill=base)
    for _ in range(120):
        x = rng.randint(8, w - 8)
        y = rng.randint(5, h - 5)
        draw.line((x, y, x + rng.randint(8, 35), y + rng.randint(-3, 3)), fill=hi, width=1)
    draw.line((20, 8, w - 22, 4), fill=(255, 255, 255, 46), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.25))
    img.save(OUT / path, optimize=True)


PIN_COLORS = {
    "sun": (247, 163, 18),
    "sky": (30, 136, 229),
    "mint": (65, 173, 71),
    "coral": (238, 62, 64),
    "violet": (115, 77, 226),
}


def pin(path: str, key: str) -> None:
    rgb = PIN_COLORS[key]
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow, "RGBA")
    sdraw.ellipse((43, 64, 99, 91), fill=(0, 0, 0, 92))
    sdraw.rectangle((61, 57, 70, 95), fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle((60, 54, 69, 91), fill=(68, 47, 34, 190))
    draw.ellipse((35, 21, 94, 80), fill=(rgb[0] - 22, rgb[1] - 20, rgb[2] - 16, 255))
    draw.ellipse((42, 19, 88, 65), fill=(rgb[0], rgb[1], rgb[2], 255))
    draw.ellipse((49, 24, 69, 44), fill=(255, 255, 245, 148))
    draw.ellipse((70, 51, 86, 67), fill=(0, 0, 0, 46))
    draw.ellipse((41, 18, 90, 68), outline=(255, 255, 255, 64), width=2)
    img.save(OUT / path, optimize=True)


def fold(path: str, dark: bool = False) -> None:
    w, h = 480, 96
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    fill = (250, 230, 178, 190) if not dark else (60, 44, 25, 176)
    shade = (154, 91, 14, 60) if not dark else (0, 0, 0, 76)
    draw.polygon((0, 16, w - 32, 0, w, h, 24, h), fill=fill)
    draw.line((0, 16, 24, h), fill=shade, width=2)
    draw.line((w - 32, 0, w, h), fill=shade, width=2)
    draw.rectangle((0, h - 14, w, h), fill=shade)
    img = img.filter(ImageFilter.GaussianBlur(0.3))
    img.save(OUT / path, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for existing in OUT.iterdir():
        if existing.is_file():
            existing.unlink()

    noisy_surface(
        "paper-fiber-light.webp",
        (255, 248, 232, 206),
        (255, 232, 182, 160),
        (207, 181, 138, 130),
        alpha_jitter=5,
        fibers=70,
        blur=0.2,
    )
    noisy_surface(
        "paper-fiber-dark.webp",
        (9, 16, 20, 210),
        (50, 40, 30, 130),
        (8, 30, 43, 140),
        alpha_jitter=5,
        fibers=70,
        blur=0.2,
    )
    ruled_paper("ruled-paper-light.webp", "light")
    ruled_paper("ruled-paper-dark.webp", "dark")
    wood("wood-board-light.webp", dark=False)
    wood("wood-board-dark.webp", dark=True)
    tape("tape-light.png", dark=False)
    tape("tape-dark.png", dark=True)
    fold("fold-light.png", dark=False)
    fold("fold-dark.png", dark=True)
    for key in NOTE_COLORS:
        note(f"note-{key}-light.webp", key, dark=False)
        note(f"note-{key}-dark.webp", key, dark=True)
    for key in PIN_COLORS:
        pin(f"pin-{key}.png", key)


if __name__ == "__main__":
    main()
