from __future__ import annotations

import math
import random
from pathlib import Path
from zlib import crc32

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps, ImageStat


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "material-sources"
OUT = ROOT / "public" / "sticky-materials" / "premium"
SEED = 991_337

RGB = tuple[int, int, int]
RGBA = tuple[int, int, int, int]

COLORS = ["sun", "sky", "mint", "coral", "violet", "ink"]

INK_TARGETS: dict[str, RGB] = {
    "sun": (236, 156, 31),
    "sky": (64, 145, 224),
    "mint": (102, 171, 74),
    "coral": (230, 83, 76),
    "violet": (137, 91, 224),
    "ink": (132, 91, 58),
}

LIGHT_PAD_BOXES = {
    "sun": (24, 20, 345, 558),
    "sky": (358, 20, 585, 525),
    "mint": (607, 20, 820, 525),
    "coral": (842, 20, 1054, 525),
    "violet": (1075, 20, 1290, 525),
}

DARK_PAD_BOXES = {
    "sun": (43, 42, 333, 468),
    "sky": (356, 42, 628, 468),
    "mint": (649, 42, 919, 468),
    "coral": (941, 42, 1212, 468),
    "violet": (1233, 42, 1505, 468),
}

LIGHT_NOTE_BOXES = {
    "sun": (27, 579, 211, 655),
    "sky": (228, 579, 410, 655),
    "mint": (430, 579, 612, 655),
    "coral": (632, 579, 813, 655),
    "violet": (832, 579, 1014, 655),
}

DARK_NOTE_BOXES = {
    "sun": (43, 489, 333, 584),
    "sky": (356, 489, 628, 584),
    "mint": (649, 494, 919, 584),
    "coral": (941, 489, 1212, 584),
    "violet": (1233, 489, 1505, 584),
}

LIGHT_PIN_BOXES = {
    "sun": (28, 792, 126, 954),
    "sky": (186, 792, 286, 954),
    "mint": (280, 792, 425, 954),
    "coral": (420, 792, 545, 954),
    "violet": (540, 792, 675, 960),
}

DARK_PIN_BOXES = {
    "sun": (967, 612, 1031, 716),
    "sky": (1041, 612, 1105, 716),
    "mint": (1118, 612, 1183, 716),
    "coral": (1192, 612, 1257, 716),
    "violet": (1266, 612, 1332, 716),
}

LIGHT_TAPES = [
    (29, 700, 178, 782),
    (221, 700, 403, 782),
    (478, 700, 648, 782),
    (680, 700, 850, 782),
]

DARK_TAPES = [
    (51, 632, 151, 712),
    (190, 632, 492, 712),
    (546, 632, 662, 712),
    (723, 632, 924, 712),
]


def stable_seed(value: str) -> int:
    return SEED + crc32(value.encode("utf-8")) % 1_000_000


def clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def save(img: Image.Image, name: str, *, quality: int = 92) -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".webp":
        img.save(path, "WEBP", quality=quality, method=6)
        return
    img.save(path, optimize=True)


def crop(src: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return src.crop(box).convert("RGBA")


def corner_background(img: Image.Image) -> RGB:
    w, h = img.size
    crops = [
        img.crop((0, 0, min(18, w), min(18, h))),
        img.crop((max(0, w - 18), 0, w, min(18, h))),
        img.crop((0, max(0, h - 18), min(18, w), h)),
        img.crop((max(0, w - 18), max(0, h - 18), w, h)),
    ]
    means = [ImageStat.Stat(region.convert("RGB")).mean for region in crops]
    return tuple(int(sum(mean[i] for mean in means) / len(means)) for i in range(3))  # type: ignore[return-value]


def transparent_from_background(
    img: Image.Image,
    *,
    threshold: int,
    grow: int = 3,
    strict: bool = False,
) -> Image.Image:
    rgba = img.convert("RGBA")
    bg = corner_background(rgba)
    rgb = rgba.convert("RGB")
    diff_channels = [
        ImageChops.difference(channel, Image.new("L", rgba.size, bg[index]))
        for index, channel in enumerate(rgb.split())
    ]
    diff = ImageChops.lighter(ImageChops.lighter(diff_channels[0], diff_channels[1]), diff_channels[2])
    soft_start = threshold if strict else threshold * 0.45
    soft_width = 42 if strict else threshold * 0.9
    alpha = diff.point(lambda p: 0 if p < soft_start else clamp((p - soft_start) * 255 / soft_width))
    for _ in range(grow):
        alpha = alpha.filter(ImageFilter.MaxFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
    out = rgba.copy()
    out.putalpha(alpha)
    return out


def transparent_colorful_hardware(
    img: Image.Image,
    *,
    bg_threshold: int,
    saturation_threshold: int,
    grow: int = 1,
) -> Image.Image:
    rgba = img.convert("RGBA")
    bg = corner_background(rgba)
    rgb = rgba.convert("RGB")
    diff_channels = [
        ImageChops.difference(channel, Image.new("L", rgba.size, bg[index]))
        for index, channel in enumerate(rgb.split())
    ]
    diff = ImageChops.lighter(ImageChops.lighter(diff_channels[0], diff_channels[1]), diff_channels[2])
    diff_alpha = diff.point(lambda p: 0 if p < bg_threshold else clamp((p - bg_threshold) * 255 / 42))
    saturation = rgb.convert("HSV").getchannel("S")
    saturation_alpha = saturation.point(
        lambda p: 0 if p < saturation_threshold else clamp((p - saturation_threshold) * 255 / 68),
    )
    alpha = ImageChops.lighter(diff_alpha, saturation_alpha)
    for _ in range(grow):
        alpha = alpha.filter(ImageFilter.MaxFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))
    out = rgba.copy()
    out.putalpha(alpha)
    return out


def transparent_dark_pin_hardware(img: Image.Image, target: RGB) -> Image.Image:
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    alpha = Image.new("L", rgba.size, 0)
    alpha_pixels = alpha.load()
    target_dominant = max(range(3), key=lambda index: target[index])

    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            channels = (r, g, b)
            maximum = max(channels)
            minimum = min(channels)
            saturation = maximum - minimum
            luma = r * 0.2126 + g * 0.7152 + b * 0.0722
            pixel_dominant = max(range(3), key=lambda index: channels[index])
            color_distance = sum(abs(channels[index] - target[index]) for index in range(3))
            matches_pin_color = (
                color_distance < 225
                and saturation > 22
                and maximum > 45
                and pixel_dominant == target_dominant
            )
            matches_pin_stem = (
                saturation < 58
                and 34 < luma < 190
                and y > height * 0.38
                and width * 0.22 < x < width * 0.78
            )

            if matches_pin_color or matches_pin_stem:
                alpha_pixels[x, y] = 255

    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgba.copy()
    out.putalpha(alpha)
    return out


def trim_transparent(img: Image.Image, padding: int = 8) -> Image.Image:
    alpha = img.getchannel("A")
    box = alpha.point(lambda p: 255 if p > 8 else 0).getbbox()
    if box is None:
        return img
    left = max(0, box[0] - padding)
    top = max(0, box[1] - padding)
    right = min(img.width, box[2] + padding)
    bottom = min(img.height, box[3] + padding)
    return img.crop((left, top, right, bottom))


def tint_sprite(img: Image.Image, target: RGB, *, strength: float = 0.42) -> Image.Image:
    rgba = img.convert("RGBA")
    luma = ImageOps.grayscale(rgba.convert("RGB"))
    low = tuple(clamp(channel * 0.62) for channel in target)
    high = tuple(clamp(channel + (255 - channel) * 0.5) for channel in target)
    colored = ImageOps.colorize(luma, low, high).convert("RGBA")
    blended = Image.blend(rgba, colored, strength)
    blended.putalpha(rgba.getchannel("A"))
    return blended


def paper_mask(size: tuple[int, int], seed: str, *, inset: int = 3, jitter: int = 3, steps: int = 18) -> Image.Image:
    rng = random.Random(stable_seed(seed))
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
    return mask.filter(ImageFilter.GaussianBlur(0.6))


def rounded_mask(size: tuple[int, int], radius: int = 7, inset: int = 3) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size[0] - inset - 1, size[1] - inset - 1),
        radius=radius,
        fill=255,
    )
    return mask.filter(ImageFilter.GaussianBlur(0.45))


def apply_alpha_mask(img: Image.Image, mask: Image.Image) -> Image.Image:
    out = img.convert("RGBA")
    existing = out.getchannel("A")
    out.putalpha(ImageChops.multiply(existing, mask))
    return out


def add_fiber_overlay(img: Image.Image, seed: str, *, strength: int = 16) -> Image.Image:
    rng = random.Random(stable_seed(seed))
    rgba = img.convert("RGBA")
    overlay = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    for _ in range(max(80, rgba.width // 2)):
        x = rng.randint(-20, rgba.width + 20)
        y = rng.randint(0, rgba.height)
        length = rng.randint(12, max(24, rgba.width // 2))
        tone = rng.choice([(255, 255, 255), (87, 62, 39), (192, 157, 104)])
        alpha = rng.randint(3, strength)
        draw.line((x, y, x + length, y + rng.randint(-3, 4)), fill=(*tone, alpha), width=1)
    return Image.alpha_composite(rgba, overlay.filter(ImageFilter.GaussianBlur(0.25)))


def sprite_variant(img: Image.Image, seed: str, variant: int) -> Image.Image:
    out = add_fiber_overlay(img, f"{seed}-{variant}", strength=12)
    if variant == 2:
        out = ImageEnhance.Brightness(out).enhance(1.025)
        out = ImageEnhance.Contrast(out).enhance(1.025)
    elif variant == 3:
        out = ImageEnhance.Brightness(out).enhance(0.975)
        out = ImageEnhance.Color(out).enhance(1.045)
    return out


def rounded_panel(size: tuple[int, int], tone: str, name: str) -> None:
    dark = tone == "dark"
    w, h = size
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=28, fill=255)

    fill = Image.new("RGBA", size, (12, 18, 24, 224) if dark else (255, 251, 244, 232))
    noise = Image.effect_noise(size, 18).convert("L")
    noise_rgba = Image.merge("RGBA", (noise, noise, noise, Image.new("L", size, 15)))
    fill = Image.alpha_composite(fill, noise_rgba)

    shine = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shine, "RGBA")
    draw.rounded_rectangle((1, 1, w - 2, h - 2), radius=27, outline=(255, 255, 255, 48 if dark else 120), width=1)
    draw.rectangle((0, 0, w, h // 2), fill=(255, 255, 255, 16 if dark else 46))
    fill.putalpha(mask)
    img = Image.alpha_composite(img, fill)
    img = Image.alpha_composite(img, shine)
    save(img, f"{name}-{tone}.png")


def canvas(tone: str) -> None:
    dark = tone == "dark"
    size = (1728, 1040)
    base = Image.new("RGBA", size, (5, 10, 14, 255) if dark else (255, 244, 229, 255))
    rng = random.Random(stable_seed(f"canvas-{tone}"))
    noise_a = Image.effect_noise(size, 24 if dark else 19).convert("L")
    noise_b = Image.effect_noise((432, 260), 45).convert("L").resize(size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(3.0))
    luma = ImageChops.add(noise_a, noise_b, scale=1.7)
    if dark:
        texture = ImageOps.colorize(luma, (0, 3, 7), (35, 48, 56)).convert("RGBA")
        amount = 0.23
    else:
        texture = ImageOps.colorize(luma, (232, 211, 178), (255, 250, 239)).convert("RGBA")
        amount = 0.18
    out = Image.blend(base, texture, amount)
    wash = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(wash, "RGBA")
    for _ in range(9):
        x = rng.randint(-240, size[0])
        y = rng.randint(-180, size[1])
        radius = rng.randint(240, 560)
        color = (69, 118, 148, 18) if dark else (255, 211, 139, 35)
        draw.ellipse((x, y, x + radius, y + radius), fill=color)
    vignette = Image.new("L", size, 0)
    vd = ImageDraw.Draw(vignette)
    for i in range(90):
        vd.rectangle((i, i, size[0] - i, size[1] - i), outline=clamp(i * 1.8))
    edge = Image.new("RGBA", size, (0, 0, 0, 95 if dark else 26))
    out = Image.alpha_composite(out, wash.filter(ImageFilter.GaussianBlur(90)))
    out = Image.composite(out, Image.alpha_composite(out, edge), ImageOps.invert(vignette).filter(ImageFilter.GaussianBlur(40)))
    save(out.convert("RGB"), f"canvas-{tone}.webp", quality=90)


def enhance_material(img: Image.Image, tone: str, name: str) -> Image.Image:
    out = img.convert("RGBA")
    out = ImageEnhance.Sharpness(out).enhance(1.15)
    out = ImageEnhance.Contrast(out).enhance(1.08 if tone == "light" else 1.16)
    return add_fiber_overlay(out, name, strength=10 if tone == "light" else 8)


def extract_pad_assets(src: Image.Image, tone: str) -> None:
    boxes = LIGHT_PAD_BOXES if tone == "light" else DARK_PAD_BOXES
    for color in COLORS:
        source_color = "sun" if color == "ink" else color
        pad = apply_alpha_mask(crop(src, boxes[source_color]), rounded_mask((boxes[source_color][2] - boxes[source_color][0], boxes[source_color][3] - boxes[source_color][1]), radius=8, inset=4))
        if color == "ink":
            pad = tint_sprite(pad, INK_TARGETS["ink"], strength=0.52)
        pad = enhance_material(pad, tone, f"pad-{color}-{tone}")
        save(pad, f"pad-column-{color}-{tone}.png")

        header_h = max(64, int(pad.height * 0.16))
        header = trim_transparent(pad.crop((0, 0, pad.width, header_h + 10)), padding=4)
        header = apply_alpha_mask(header, paper_mask(header.size, f"header-{color}-{tone}", inset=2, jitter=2))
        save(header, f"pad-header-{color}-{tone}.png")

        fold_h = max(74, int(pad.height * 0.2))
        fold = trim_transparent(pad.crop((0, pad.height - fold_h, pad.width, pad.height)), padding=4)
        fold = apply_alpha_mask(fold, paper_mask(fold.size, f"fold-{color}-{tone}", inset=2, jitter=2))
        save(fold, f"fold-{color}-{tone}.png")


def extract_note_assets(src: Image.Image, tone: str) -> None:
    boxes = LIGHT_NOTE_BOXES if tone == "light" else DARK_NOTE_BOXES
    for color in COLORS:
        source_color = "sun" if color == "ink" else color
        note = apply_alpha_mask(
            crop(src, boxes[source_color]),
            paper_mask((boxes[source_color][2] - boxes[source_color][0], boxes[source_color][3] - boxes[source_color][1]), f"note-mask-{color}-{tone}", inset=3, jitter=3),
        )
        if color == "ink":
            note = tint_sprite(note, INK_TARGETS["ink"], strength=0.58)
        note = enhance_material(trim_transparent(note, padding=8), tone, f"note-{color}-{tone}")
        for variant in range(1, 4):
            save(sprite_variant(note, f"note-{color}-{tone}", variant), f"note-{color}-{tone}-{variant}.png")
        save(sprite_variant(note, f"quick-{color}-{tone}", 2), f"quick-{color}-{tone}.png")


def extract_hardware(src: Image.Image, tone: str) -> None:
    pin_boxes = LIGHT_PIN_BOXES if tone == "light" else DARK_PIN_BOXES
    for color in COLORS:
        source_color = "sun" if color == "ink" else color
        source_pin = crop(src, pin_boxes[source_color])
        if tone == "dark":
            pin = transparent_dark_pin_hardware(source_pin, INK_TARGETS[source_color])
        else:
            pin = transparent_colorful_hardware(
                source_pin,
                bg_threshold=68,
                saturation_threshold=34,
                grow=1,
            )
        if color == "ink":
            pin = tint_sprite(pin, INK_TARGETS["ink"], strength=0.62)
        save(trim_transparent(pin, padding=6), f"pin-{color}-{tone}.png")

    paperclip_box = (690, 813, 940, 904) if tone == "light" else (1366, 632, 1458, 816)
    paperclip = transparent_colorful_hardware(
        crop(src, paperclip_box),
        bg_threshold=64 if tone == "light" else 30,
        saturation_threshold=28 if tone == "light" else 20,
        grow=1,
    )
    save(trim_transparent(paperclip, padding=8), f"paperclip-{tone}.png")

    tape_boxes = LIGHT_TAPES if tone == "light" else DARK_TAPES
    for index, box in enumerate(tape_boxes, start=1):
        tape = transparent_from_background(crop(src, box), threshold=20 if tone == "light" else 16, grow=1, strict=True)
        tape = trim_transparent(tape, padding=6)
        save(tape, f"tape-{tone}-{index}.png")


def wood_panels(light_src: Image.Image, dark_src: Image.Image) -> None:
    light = crop(light_src, (1050, 545, 1504, 760)).resize((760, 1500), Image.Resampling.LANCZOS)
    dark = crop(dark_src, (44, 748, 738, 987)).resize((760, 1500), Image.Resampling.LANCZOS)

    for tone, img in [("light", light), ("dark", dark)]:
        img = ImageEnhance.Contrast(img).enhance(1.12 if tone == "light" else 1.22)
        img = ImageEnhance.Sharpness(img).enhance(1.18)
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay, "RGBA")
        for x in (190, 380, 570):
            draw.line((x, 0, x, img.height), fill=(35, 18, 8, 34 if tone == "light" else 72), width=4)
            draw.line((x + 5, 0, x + 5, img.height), fill=(255, 230, 182, 18 if tone == "light" else 7), width=1)
        for y in range(0, img.height, 220):
            draw.line((24, y, img.width - 24, y + random.Random(stable_seed(f"wood-{tone}-{y}")).randint(-5, 5)), fill=(255, 228, 174, 11 if tone == "light" else 5), width=1)
        img = Image.alpha_composite(img.convert("RGBA"), overlay)
        save(img.convert("RGB"), f"wood-panel-{tone}.webp", quality=92)


def main() -> None:
    light_path = SOURCE / "premium-light-atlas.png"
    dark_path = SOURCE / "premium-dark-atlas.png"
    if not light_path.exists() or not dark_path.exists():
        raise SystemExit("Missing premium atlas images in assets/material-sources")

    OUT.mkdir(parents=True, exist_ok=True)
    light = Image.open(light_path).convert("RGBA")
    dark = Image.open(dark_path).convert("RGBA")

    canvas("light")
    canvas("dark")
    rounded_panel((272, 1040), "light", "rail")
    rounded_panel((272, 1040), "dark", "rail")
    rounded_panel((248, 58), "light", "topbar")
    rounded_panel((248, 58), "dark", "topbar")
    wood_panels(light, dark)

    for tone, src in [("light", light), ("dark", dark)]:
        extract_pad_assets(src, tone)
        extract_note_assets(src, tone)
        extract_hardware(src, tone)

    print(f"Generated premium material assets in {OUT}")


if __name__ == "__main__":
    main()
