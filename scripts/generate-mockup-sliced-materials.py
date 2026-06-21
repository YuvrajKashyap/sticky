from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, ImageStat

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover - local generation falls back to PIL.
    cv2 = None
    np = None


ROOT = Path(__file__).resolve().parents[1]
MOCKUPS = ROOT / "assets" / "mockups"
OUT = ROOT / "public" / "sticky-materials" / "mockup-sliced"

MODES = {
    "pad-light": "pad_light_mockup.png",
    "pad-dark": "pad_dark_mockup.png",
    "board-light": "board_light_mockup.png",
    "board-dark": "board_dark_mockup.png",
}

COLORS = ["sun", "sky", "mint", "coral", "violet"]
BOARD_COLORS = {
    "sun": "sun",
    "sky": "sky",
    "mint": "mint",
    "coral": "coral",
    "violet": "violet",
    "ink": "ink",
}

PAD_COLUMNS = [
    (260, 48, 526, 515),
    (532, 48, 830, 893),
    (838, 48, 1095, 350),
    (1102, 55, 1373, 895),
    (1388, 58, 1670, 902),
]

BOARD_COLUMNS = [
    (260, 64, 515, 895),
    (532, 64, 798, 895),
    (815, 64, 1048, 895),
    (1065, 64, 1328, 895),
    (1350, 64, 1640, 895),
]

BOARD_HEADERS = {
    "sun": (286, 78, 488, 124),
    "sky": (558, 78, 780, 124),
    "mint": (842, 78, 1035, 124),
    "coral": (1087, 78, 1302, 124),
    "violet": (1376, 78, 1610, 124),
    "ink": (276, 658, 494, 724),
}

BOARD_QUICK = {
    "sun": (276, 145, 490, 212),
    "sky": (548, 145, 785, 212),
    "mint": (820, 151, 1037, 199),
    "coral": (1080, 145, 1315, 212),
    "violet": (1376, 145, 1612, 202),
    "ink": (276, 145, 490, 212),
}

BOARD_NOTES = {
    "sun": [(276, 230, 502, 281), (545, 527, 784, 604), (1130, 768, 1352, 816)],
    "coral": [(276, 313, 502, 401), (546, 433, 786, 524), (1080, 295, 1318, 373)],
    "sky": [(276, 423, 502, 510), (548, 606, 787, 686), (1082, 376, 1317, 456)],
    "mint": [(276, 536, 502, 618), (545, 639, 786, 718), (1375, 507, 1612, 650)],
    "violet": [(546, 292, 786, 346), (1081, 524, 1318, 603), (1376, 215, 1609, 351)],
    "ink": [(276, 658, 494, 724), (1136, 788, 1352, 818), (1376, 816, 1610, 868)],
}

BOARD_COMPLETED = {
    "sun": (276, 658, 494, 724),
    "sky": (546, 758, 786, 814),
    "mint": (856, 395, 1037, 440),
    "coral": (1132, 771, 1352, 818),
    "violet": (1376, 816, 1612, 869),
    "ink": (276, 658, 494, 724),
}


def save(img: Image.Image, mode: str, name: str, quality: int = 92) -> None:
    destination = OUT / mode / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.suffix == ".webp":
        img.save(destination, "WEBP", quality=quality, method=5)
        return
    img.save(destination, optimize=True)


def crop(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return source.crop(box).convert("RGBA")


def material_canvas(source: Image.Image, box: tuple[int, int, int, int], size: tuple[int, int]) -> Image.Image:
    tile = crop(source, box).filter(ImageFilter.GaussianBlur(0.35))
    canvas = tile.resize(size, Image.Resampling.BICUBIC)
    texture = Image.effect_noise(size, 5.5).convert("L").filter(ImageFilter.GaussianBlur(0.45))
    texture_rgba = Image.merge("RGBA", (texture, texture, texture, Image.new("L", size, 18)))
    return Image.alpha_composite(canvas, texture_rgba)


def luma_saturation(img: Image.Image) -> tuple[Image.Image, Image.Image]:
    rgba = img.convert("RGBA")
    rgb = rgba.convert("RGB")
    hsl = rgb.convert("HSV")
    return ImageOps.grayscale(rgb), hsl.getchannel("S")


def deink(img: Image.Image, dark: bool, *, strength: int = 2) -> Image.Image:
    """Remove source text and check circles while keeping photographed material."""
    rgba = img.convert("RGBA")
    luma, saturation = luma_saturation(rgba)
    local_luma = luma.filter(ImageFilter.MedianFilter(31)).filter(ImageFilter.GaussianBlur(1.8))
    local_saturation = saturation.filter(ImageFilter.MedianFilter(31)).filter(ImageFilter.GaussianBlur(1.6))

    if dark:
        text_mask = ImageChops.subtract(luma, local_luma).point(lambda p: 255 if p > 9 else 0)
        color_mask = ImageChops.multiply(
            ImageChops.subtract(saturation, local_saturation).point(lambda p: 255 if p > 12 else 0),
            ImageChops.subtract(luma, local_luma).point(lambda p: 255 if p > 5 else 0),
        )
    else:
        text_mask = ImageChops.subtract(local_luma, luma).point(lambda p: 255 if p > 10 else 0)
        color_mask = ImageChops.multiply(
            ImageChops.subtract(saturation, local_saturation).point(lambda p: 255 if p > 12 else 0),
            ImageChops.subtract(local_luma, luma).point(lambda p: 255 if p > 5 else 0),
        )

    mask = ImageChops.lighter(text_mask, color_mask)
    for _ in range(strength):
        mask = mask.filter(ImageFilter.MaxFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(2.2))

    if cv2 is not None and np is not None and rgba.width * rgba.height <= 360_000:
        rgb = np.array(rgba.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        cv_mask = np.array(mask.point(lambda p: 255 if p > 18 else 0), dtype=np.uint8)
        repaired = cv2.inpaint(bgr, cv_mask, 4, cv2.INPAINT_TELEA)
        repaired_rgb = cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB)
        out = Image.fromarray(repaired_rgb).convert("RGBA")
        out.putalpha(rgba.getchannel("A"))
        return out

    fill = rgba.filter(ImageFilter.MedianFilter(13)).filter(ImageFilter.GaussianBlur(2.4))
    return Image.composite(fill, rgba, mask)


def transparent_from_background(img: Image.Image, *, dark: bool, pad: int = 3) -> Image.Image:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    samples = [
        rgba.crop((0, 0, min(12, w), min(12, h))),
        rgba.crop((max(0, w - 12), 0, w, min(12, h))),
        rgba.crop((0, max(0, h - 12), min(12, w), h)),
        rgba.crop((max(0, w - 12), max(0, h - 12), w, h)),
    ]
    values = []
    for sample in samples:
        stat = ImageStat.Stat(sample.convert("RGB"))
        values.append(tuple(int(v) for v in stat.mean))
    bg = tuple(sum(value[i] for value in values) // len(values) for i in range(3))

    diff = Image.new("L", rgba.size, 0)
    src = rgba.convert("RGB").load()
    px = diff.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            distance = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            px[x, y] = 255 if distance > (44 if dark else 38) else 0

    binary = diff.filter(ImageFilter.MaxFilter(5)).point(lambda p: 255 if p > 24 else 0)
    if cv2 is not None and np is not None:
        arr = np.array(binary, dtype=np.uint8)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        arr = cv2.morphologyEx(arr, cv2.MORPH_CLOSE, kernel, iterations=2)
        arr = cv2.dilate(arr, kernel, iterations=1)
        flood = arr.copy()
        flood_mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
        cv2.floodFill(flood, flood_mask, (0, 0), 255)
        holes = cv2.bitwise_not(flood)
        arr = cv2.bitwise_or(arr, holes)
        alpha = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.45))
    else:
        alpha = binary.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(0.5))

    if pad:
        alpha_draw = ImageDraw.Draw(alpha)
        alpha_draw.rectangle((0, 0, w - 1, h - 1), outline=0, width=pad)

    out = rgba.copy()
    out.putalpha(alpha)
    return out


def slice_pad(mode: str, source: Image.Image) -> None:
    dark = mode.endswith("dark")
    save(deink(crop(source, (0, 0, 242, 941)), dark, strength=3), mode, "rail.webp")
    save(deink(crop(source, (1418, 8, 1660, 64)), dark, strength=2), mode, "topbar.webp")
    bg_box = (952, 350, 1080, 740) if not dark else (946, 350, 1080, 740)
    save(material_canvas(source, bg_box, (1430, 941)), mode, "canvas.webp")

    for index, box in enumerate(PAD_COLUMNS, start=1):
        column = deink(crop(source, box), dark, strength=2)
        save(column, mode, f"column-{index}.webp")


def slice_board(mode: str, source: Image.Image) -> None:
    dark = mode.endswith("dark")
    save(deink(crop(source, (0, 0, 242, 941)), dark, strength=3), mode, "rail.webp")
    save(deink(crop(source, (1442, 8, 1660, 58)), dark, strength=2), mode, "topbar.webp")
    bg_box = (242, 0, 255, 941) if not dark else (242, 0, 255, 941)
    save(material_canvas(source, bg_box, (1430, 941)), mode, "canvas.webp")

    # The third board has the largest blank wood area, so use it as the board material source.
    blank_wood = crop(source, (818, 440, 1048, 890)).resize((760, 1500), Image.Resampling.LANCZOS)
    save(blank_wood, mode, "wood-column.webp")

    for color, box in BOARD_HEADERS.items():
        header = deink(crop(source, box), dark, strength=2)
        save(header, mode, f"header-{color}.webp")

    for color, box in BOARD_QUICK.items():
        quick = deink(crop(source, box), dark, strength=2)
        save(quick, mode, f"quick-{color}.webp")

    for color, box in BOARD_COMPLETED.items():
        completed = deink(crop(source, box), dark, strength=2)
        save(completed, mode, f"completed-{color}.webp")

    for color, boxes in BOARD_NOTES.items():
        for index, box in enumerate(boxes, start=1):
            note = deink(crop(source, box), dark, strength=2)
            save(note, mode, f"note-{color}-{index}.webp")

    # Shared small hardware cutouts.
    pin_boxes = {
        "sun": (385, 46, 421, 82),
        "sky": (652, 48, 690, 84),
        "mint": (934, 48, 972, 84),
        "coral": (1190, 49, 1227, 85),
        "violet": (1560, 50, 1598, 86),
    }
    for color, box in pin_boxes.items():
        save(transparent_from_background(crop(source, box), dark=dark, pad=1), mode, f"pin-{color}.png")

    paperclip_box = (1534, 70, 1564, 126)
    save(transparent_from_background(crop(source, paperclip_box), dark=dark, pad=1), mode, "paperclip.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for child in OUT.glob("*"):
        if child.is_file():
            child.unlink()
        else:
            for file in child.rglob("*"):
                if file.is_file():
                    file.unlink()

    for mode, filename in MODES.items():
        source = Image.open(MOCKUPS / filename).convert("RGB")
        if mode.startswith("pad"):
            slice_pad(mode, source)
        else:
            slice_board(mode, source)


if __name__ == "__main__":
    main()
