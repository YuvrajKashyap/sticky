from __future__ import annotations

import math
import random
from pathlib import Path
from zlib import crc32

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "sticky-materials" / "mockup-real"
MOCKUPS = ROOT / "assets" / "mockups"
SEED = 731_947

Tone = str
RGBA = tuple[int, int, int, int]
RGB = tuple[int, int, int]


LIST_COLORS: dict[str, dict[str, RGB]] = {
    "sun": {"base": (247, 171, 36), "light": (255, 219, 104), "ink": (143, 76, 2)},
    "sky": {"base": (49, 139, 221), "light": (146, 199, 246), "ink": (10, 77, 158)},
    "mint": {"base": (93, 169, 69), "light": (166, 216, 105), "ink": (37, 105, 24)},
    "coral": {"base": (235, 82, 70), "light": (255, 150, 128), "ink": (167, 35, 28)},
    "violet": {"base": (119, 79, 218), "light": (185, 151, 244), "ink": (73, 35, 166)},
    "ink": {"base": (128, 89, 56), "light": (184, 139, 95), "ink": (72, 43, 24)},
}


NOTE_COLORS: dict[str, tuple[RGB, RGB]] = {
    "sun": ((255, 237, 143), (245, 191, 48)),
    "sky": ((205, 234, 252), (113, 184, 231)),
    "mint": ((217, 241, 193), (137, 197, 111)),
    "coral": ((255, 211, 207), (236, 126, 128)),
    "violet": ((230, 211, 255), (178, 141, 230)),
    "ink": ((226, 194, 154), (155, 105, 68)),
}


def stable_seed(value: str) -> int:
    return SEED + crc32(value.encode("utf-8")) % 1_000_000


def clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def rgba(rgb: RGB, alpha: int = 255) -> RGBA:
    return (rgb[0], rgb[1], rgb[2], alpha)


def mix_rgb(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(clamp(a[i] * (1 - t) + b[i] * t) for i in range(3))  # type: ignore[return-value]


def mix_rgba(a: RGBA, b: RGBA, t: float) -> RGBA:
    return tuple(clamp(a[i] * (1 - t) + b[i] * t) for i in range(4))  # type: ignore[return-value]


def save(img: Image.Image, name: str, quality: int = 88) -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".webp":
        img.save(path, "WEBP", quality=quality, method=4)
        return
    img.save(path, optimize=True)


def autocontrast_luma(img: Image.Image, size: tuple[int, int], strength: float) -> Image.Image:
    luma = img.convert("L").resize(size, Image.Resampling.LANCZOS)
    luma = ImageOps.autocontrast(luma, cutoff=2)
    luma = ImageEnhance.Contrast(luma).enhance(1.55)
    neutral = Image.new("L", size, 128)
    return Image.blend(neutral, luma, strength)


def mockup_luma(name: str, box: tuple[int, int, int, int], size: tuple[int, int], strength: float) -> Image.Image:
    source = MOCKUPS / name
    if not source.exists():
        return Image.new("L", size, 128)
    return autocontrast_luma(Image.open(source).crop(box), size, strength)


def textured_paper(
    size: tuple[int, int],
    base: RGBA,
    warm: RGBA,
    cool: RGBA,
    seed_name: str,
    *,
    fibers: int = 260,
    wrinkle_count: int = 16,
    mockup: Image.Image | None = None,
    dark: bool = False,
) -> Image.Image:
    rng = random.Random(stable_seed(seed_name))
    w, h = size
    base_img = Image.new("RGBA", size, base)

    noise_a = Image.effect_noise(size, rng.uniform(22, 34)).convert("L")
    noise_b = Image.effect_noise((max(64, w // 4), max(64, h // 4)), rng.uniform(35, 50)).convert("L")
    noise_b = noise_b.resize(size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))
    luma = ImageChops.add(ImageEnhance.Contrast(noise_a).enhance(0.8), ImageEnhance.Contrast(noise_b).enhance(0.35), scale=1.6)

    color_noise = ImageOps.colorize(luma, black=cool[:3], white=warm[:3]).convert("RGBA")
    img = Image.blend(base_img, color_noise, 0.18 if not dark else 0.23)

    if mockup is not None:
        paper_shadow = ImageOps.colorize(mockup, black=(0, 0, 0), white=(255, 255, 255)).convert("RGBA")
        img = Image.blend(img, paper_shadow, 0.07 if not dark else 0.1)

    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    for _ in range(fibers):
        x = rng.randint(-80, w + 80)
        y = rng.randint(0, h)
        length = rng.randint(12, 110)
        drift = rng.randint(-5, 8)
        alpha = rng.randint(4, 13) if not dark else rng.randint(3, 9)
        tone = warm if rng.random() > 0.45 else cool
        draw.line((x, y, x + length, y + drift), fill=(tone[0], tone[1], tone[2], alpha), width=rng.choice([1, 1, 1, 2]))

    for _ in range(wrinkle_count):
        x = rng.randint(-40, w)
        y = rng.randint(0, h)
        length = rng.randint(w // 5, w // 2)
        amp = rng.uniform(-10, 10)
        points = []
        for step in range(16):
            px = x + length * step / 15
            py = y + math.sin(step / 15 * math.pi * 2 + rng.random()) * amp
            points.append((px, py))
        draw.line(points, fill=(255, 255, 255, rng.randint(5, 12) if not dark else rng.randint(2, 6)), width=1)
        draw.line([(px, py + 2) for px, py in points], fill=(0, 0, 0, rng.randint(4, 9) if not dark else rng.randint(8, 18)), width=1)

    img = Image.alpha_composite(img, overlay.filter(ImageFilter.GaussianBlur(0.25)))
    return img


def irregular_mask(size: tuple[int, int], seed_name: str, jitter: int = 9, steps: int = 22, inset: int = 10) -> Image.Image:
    rng = random.Random(stable_seed(seed_name))
    w, h = size
    points: list[tuple[float, float]] = []

    for i in range(steps + 1):
        x = inset + (w - inset * 2) * i / steps
        points.append((x, inset + rng.randint(-jitter, jitter)))
    for i in range(1, steps + 1):
        y = inset + (h - inset * 2) * i / steps
        points.append((w - inset + rng.randint(-jitter, jitter), y))
    for i in range(steps, -1, -1):
        x = inset + (w - inset * 2) * i / steps
        points.append((x, h - inset + rng.randint(-jitter, jitter)))
    for i in range(steps, 0, -1):
        y = inset + (h - inset * 2) * i / steps
        points.append((inset + rng.randint(-jitter, jitter), y))

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(1.45))


def shadowed_sprite(paper: Image.Image, mask: Image.Image, seed_name: str, *, shadow_alpha: int = 92) -> Image.Image:
    rng = random.Random(stable_seed(seed_name))
    w, h = paper.size
    sprite = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    shadow_mask = mask.filter(ImageFilter.GaussianBlur(rng.uniform(7, 12)))
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, shadow_alpha))
    sprite.alpha_composite(Image.composite(shadow, Image.new("RGBA", (w, h), (0, 0, 0, 0)), shadow_mask), (rng.randint(1, 4), rng.randint(4, 8)))

    paper = paper.copy()
    paper.putalpha(mask)
    sprite = Image.alpha_composite(sprite, paper)

    edge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    edge_mask = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(0.7))
    edge_color = Image.new("RGBA", (w, h), (94, 58, 26, 34))
    sprite = Image.alpha_composite(sprite, Image.composite(edge_color, edge, edge_mask))
    return sprite


def apply_rounded_alpha(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius=radius, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def canvas(tone: Tone) -> None:
    dark = tone == "dark"
    size = (1728, 1040)
    base = (7, 13, 18, 255) if dark else (255, 243, 224, 255)
    warm = (51, 71, 84, 255) if dark else (255, 231, 187, 255)
    cool = (2, 5, 8, 255) if dark else (236, 213, 180, 255)
    mockup_name = "pad_dark_mockup.png" if dark else "pad_light_mockup.png"
    luma = mockup_luma(mockup_name, (300, 40, 1580, 900), size, 0.18)
    img = textured_paper(size, base, warm, cool, f"canvas-{tone}", fibers=600, wrinkle_count=28, mockup=luma, dark=dark)

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow, "RGBA")
    if dark:
        g.ellipse((-240, -260, 620, 360), fill=(61, 111, 147, 34))
        g.ellipse((1080, 600, 1980, 1260), fill=(83, 53, 138, 28))
    else:
        g.ellipse((-180, -220, 560, 340), fill=(255, 205, 122, 58))
        g.ellipse((1040, 600, 1920, 1240), fill=(255, 193, 137, 36))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(90)))
    save(img.convert("RGB"), f"canvas-{tone}.webp", quality=88)


def wood_panel(tone: Tone) -> None:
    dark = tone == "dark"
    w, h = (900, 1420)
    mock_name = "board_dark_mockup.png" if dark else "board_light_mockup.png"
    source = MOCKUPS / mock_name
    if source.exists():
        # Blank lower area from the third board in the mockup. It carries the
        # real board grain without task cards, pins, or sidebar artifacts.
        texture = Image.open(source).convert("RGB").crop((820, 438, 1048, 888))
        texture = texture.resize((w, h), Image.Resampling.BICUBIC)
        texture = ImageEnhance.Contrast(texture).enhance(1.18 if not dark else 1.28)
        texture = ImageEnhance.Sharpness(texture).enhance(1.18)
        img = texture.convert("RGBA")
    else:
        fallback = (52, 34, 24, 255) if dark else (198, 139, 74, 255)
        img = Image.new("RGBA", (w, h), fallback)

    draw = ImageDraw.Draw(img, "RGBA")
    for x in (w * 0.25, w * 0.5, w * 0.75):
        draw.line((x, 0, x, h), fill=(0, 0, 0, 38 if dark else 26), width=3)
        draw.line((x + 5, 0, x + 5, h), fill=(255, 236, 182, 8 if dark else 18), width=1)

    fine_noise = Image.effect_noise((w, h), 13).convert("L")
    fine = ImageOps.colorize(
        fine_noise,
        black=(21, 14, 9) if dark else (119, 75, 34),
        white=(120, 94, 70) if dark else (245, 188, 104),
    ).convert("RGBA")
    img = Image.blend(img, fine, 0.045 if not dark else 0.065)

    vignette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette, "RGBA")
    for i in range(44):
        vd.rounded_rectangle((i, i, w - i - 1, h - i - 1), radius=24, outline=(0, 0, 0, clamp((44 - i) * (2.1 if dark else 1.45))), width=1)
    img = Image.alpha_composite(img, vignette.filter(ImageFilter.GaussianBlur(5)))
    save(img.convert("RGB"), f"wood-panel-{tone}.webp", quality=90)


def pad_body(color: str, tone: Tone) -> None:
    dark = tone == "dark"
    accent = LIST_COLORS[color]
    if dark:
        base_rgb = mix_rgb(accent["base"], (5, 11, 15), 0.76)
        warm_rgb = mix_rgb(accent["light"], (27, 35, 38), 0.7)
        cool_rgb = mix_rgb(accent["base"], (0, 4, 7), 0.82)
    else:
        base_rgb = mix_rgb(accent["light"], (255, 250, 231), 0.72)
        warm_rgb = mix_rgb(accent["light"], (255, 236, 185), 0.35)
        cool_rgb = mix_rgb(accent["base"], (219, 205, 180), 0.74)

    size = (760, 1500)
    mock_name = "pad_dark_mockup.png" if dark else "pad_light_mockup.png"
    luma = mockup_luma(mock_name, (260, 120, 1520, 900), size, 0.16)
    paper = textured_paper(
        size,
        rgba(base_rgb, 246),
        rgba(warm_rgb, 255),
        rgba(cool_rgb, 255),
        f"pad-body-{color}-{tone}",
        fibers=460,
        wrinkle_count=24,
        mockup=luma,
        dark=dark,
    )
    draw = ImageDraw.Draw(paper, "RGBA")
    line = rgba(mix_rgb(accent["base"], (180, 180, 180), 0.4), 44 if not dark else 66)
    margin = rgba(accent["base"], 54 if not dark else 90)
    for y in range(132, size[1] - 72, 72):
        draw.line((34, y, size[0] - 34, y + random.Random(stable_seed(f"{color}-{tone}-{y}")).randint(-2, 2)), fill=line, width=2)
    draw.line((122, 58, 122, size[1] - 48), fill=margin, width=2)

    mask = irregular_mask(size, f"pad-body-mask-{color}-{tone}", jitter=2, steps=18, inset=18)
    sprite = shadowed_sprite(paper, mask, f"pad-body-shadow-{color}-{tone}", shadow_alpha=56 if not dark else 100)
    save(sprite, f"pad-body-{color}-{tone}.webp", quality=88)


def pad_header(color: str, tone: Tone) -> None:
    dark = tone == "dark"
    accent = LIST_COLORS[color]
    size = (760, 166)
    if dark:
        base = mix_rgb(accent["base"], (14, 14, 16), 0.58)
        warm = mix_rgb(accent["light"], (50, 36, 24), 0.55)
        cool = mix_rgb(accent["base"], (0, 0, 0), 0.72)
    else:
        base = mix_rgb(accent["light"], (255, 215, 124), 0.42)
        warm = mix_rgb(accent["light"], (255, 244, 199), 0.24)
        cool = mix_rgb(accent["base"], (196, 126, 32), 0.36)
    paper = textured_paper(size, rgba(base, 248), rgba(warm, 255), rgba(cool, 255), f"pad-header-{color}-{tone}", fibers=120, wrinkle_count=6, dark=dark)
    mask = irregular_mask(size, f"pad-header-mask-{color}-{tone}", jitter=2, steps=14, inset=10)
    sprite = shadowed_sprite(paper, mask, f"pad-header-shadow-{color}-{tone}", shadow_alpha=42 if not dark else 74)
    save(sprite, f"pad-header-{color}-{tone}.webp", quality=88)


def fold_bar(color: str, tone: Tone) -> None:
    dark = tone == "dark"
    accent = LIST_COLORS[color]
    size = (760, 130)
    if dark:
        base = mix_rgb(accent["base"], (6, 9, 11), 0.66)
        warm = mix_rgb(accent["light"], (43, 31, 21), 0.6)
        cool = (4, 6, 8)
    else:
        base = mix_rgb(accent["light"], (255, 234, 174), 0.45)
        warm = mix_rgb(accent["light"], (255, 250, 218), 0.22)
        cool = mix_rgb(accent["base"], (215, 169, 87), 0.42)
    paper = textured_paper(size, rgba(base, 244), rgba(warm, 255), rgba(cool, 255), f"fold-{color}-{tone}", fibers=90, wrinkle_count=5, dark=dark)
    fold_shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(fold_shadow, "RGBA")
    draw.polygon((0, 18, size[0] - 52, 0, size[0], size[1], 42, size[1]), fill=(0, 0, 0, 0))
    draw.line((0, 18, 42, size[1]), fill=(0, 0, 0, 60 if dark else 34), width=3)
    draw.line((size[0] - 52, 0, size[0], size[1]), fill=(0, 0, 0, 54 if dark else 28), width=3)
    draw.rectangle((0, size[1] - 22, size[0], size[1]), fill=(0, 0, 0, 44 if dark else 24))
    paper = Image.alpha_composite(paper, fold_shadow.filter(ImageFilter.GaussianBlur(4)))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon((0, 18, size[0] - 52, 0, size[0], size[1] - 12, 34, size[1]), fill=255)
    paper.putalpha(mask.filter(ImageFilter.GaussianBlur(0.3)))
    save(paper, f"fold-{color}-{tone}.webp", quality=88)


def note_sprite(color: str, tone: Tone, variant: int) -> None:
    dark = tone == "dark"
    top, bottom = NOTE_COLORS[color]
    if dark:
        top = mix_rgb(top, (12, 14, 16), 0.62)
        bottom = mix_rgb(bottom, (8, 9, 11), 0.68)
    size = (760, 270)
    base = mix_rgb(top, bottom, 0.38)
    paper = textured_paper(
        size,
        rgba(base, 245),
        rgba(top, 255),
        rgba(bottom, 255),
        f"note-{color}-{tone}-{variant}",
        fibers=170,
        wrinkle_count=10,
        dark=dark,
    )
    wash = Image.new("RGBA", size, (0, 0, 0, 0))
    wd = ImageDraw.Draw(wash, "RGBA")
    wd.rectangle((0, 0, size[0], size[1] // 2), fill=(255, 255, 255, 30 if not dark else 8))
    wd.rectangle((0, size[1] - 42, size[0], size[1]), fill=(0, 0, 0, 22 if not dark else 44))
    paper = Image.alpha_composite(paper, wash.filter(ImageFilter.GaussianBlur(16)))
    mask = irregular_mask(size, f"note-mask-{color}-{tone}-{variant}", jitter=3 + variant, steps=16, inset=20)
    sprite = shadowed_sprite(paper, mask, f"note-shadow-{color}-{tone}-{variant}", shadow_alpha=62 if not dark else 104)
    save(sprite, f"note-{color}-{tone}-{variant}.webp", quality=88)


def quick_note(tone: Tone) -> None:
    dark = tone == "dark"
    size = (760, 180)
    base = (36, 31, 26, 236) if dark else (255, 244, 221, 244)
    warm = (74, 58, 42, 255) if dark else (255, 252, 238, 255)
    cool = (18, 18, 18, 255) if dark else (220, 188, 144, 255)
    paper = textured_paper(size, base, warm, cool, f"quick-note-{tone}", fibers=120, wrinkle_count=6, dark=dark)
    mask = irregular_mask(size, f"quick-note-mask-{tone}", jitter=3, steps=14, inset=14)
    sprite = shadowed_sprite(paper, mask, f"quick-note-shadow-{tone}", shadow_alpha=58 if not dark else 98)
    save(sprite, f"quick-note-{tone}.webp", quality=88)


def tape(tone: Tone, variant: int) -> None:
    dark = tone == "dark"
    rng = random.Random(stable_seed(f"tape-{tone}-{variant}"))
    size = (360, 104)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    base = (236, 225, 197, 116) if not dark else (190, 176, 154, 88)
    hi = (255, 255, 242, 78) if not dark else (255, 245, 220, 36)
    left = rng.randint(10, 24)
    points = [
        (left, rng.randint(8, 18)),
        (size[0] - rng.randint(22, 36), rng.randint(4, 14)),
        (size[0] - rng.randint(10, 20), size[1] - rng.randint(14, 26)),
        (rng.randint(7, 18), size[1] - rng.randint(6, 18)),
    ]
    draw.polygon(points, fill=base)
    for _ in range(150):
        x = rng.randint(8, size[0] - 8)
        y = rng.randint(7, size[1] - 8)
        draw.line((x, y, x + rng.randint(10, 48), y + rng.randint(-4, 4)), fill=hi, width=1)
    draw.line((points[0][0] + 4, points[0][1] + 1, points[1][0] - 5, points[1][1] + 1), fill=(255, 255, 255, 42), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.2))
    save(img, f"tape-{tone}-{variant}.png")


def pin(color: str) -> None:
    rgb = LIST_COLORS[color]["base"]
    size = (180, 180)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow, "RGBA")
    sd.ellipse((58, 94, 136, 130), fill=(0, 0, 0, 92))
    sd.rectangle((84, 76, 98, 138), fill=(0, 0, 0, 78))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(8)))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle((84, 74, 97, 135), fill=(70, 45, 28, 205))
    draw.ellipse((43, 31, 135, 123), fill=rgba(mix_rgb(rgb, (48, 20, 12), 0.24)))
    draw.ellipse((54, 25, 127, 99), fill=rgba(rgb))
    draw.ellipse((65, 34, 91, 58), fill=(255, 255, 244, 160))
    draw.ellipse((98, 74, 122, 96), fill=(0, 0, 0, 44))
    draw.ellipse((53, 25, 128, 100), outline=(255, 255, 255, 62), width=3)
    save(img, f"pin-{color}.png")


def paperclip() -> None:
    size = (120, 270)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    color = (139, 98, 222, 230)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow, "RGBA")
    sd.rounded_rectangle((34, 10, 88, 250), radius=28, outline=(0, 0, 0, 120), width=13)
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(5)))
    draw.rounded_rectangle((30, 8, 82, 244), radius=27, outline=color, width=10)
    draw.rounded_rectangle((45, 42, 68, 222), radius=18, outline=(185, 151, 244, 230), width=7)
    draw.line((56, 216, 75, 250), fill=(80, 45, 150, 190), width=7)
    glint = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glint, "RGBA")
    gd.line((37, 28, 56, 14), fill=(255, 255, 255, 118), width=4)
    img = Image.alpha_composite(img, glint.filter(ImageFilter.GaussianBlur(0.5)))
    save(img, "paperclip-violet.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for existing in OUT.iterdir():
        if existing.is_file():
            existing.unlink()

    for tone in ("light", "dark"):
        canvas(tone)
        wood_panel(tone)
        quick_note(tone)
        for variant in range(1, 4):
            tape(tone, variant)

    for color in LIST_COLORS:
        pin(color)
        for tone in ("light", "dark"):
            pad_body(color, tone)
            pad_header(color, tone)
            fold_bar(color, tone)
            for variant in range(1, 4):
                note_sprite(color, tone, variant)

    paperclip()


if __name__ == "__main__":
    main()
