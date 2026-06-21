from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def compare(reference_path: Path, screenshot_path: Path, diff_path: Path | None = None) -> dict[str, object]:
    reference = Image.open(reference_path).convert("RGB")
    screenshot = Image.open(screenshot_path).convert("RGB")

    resized = False
    if screenshot.size != reference.size:
        screenshot = screenshot.resize(reference.size, Image.Resampling.LANCZOS)
        resized = True

    diff = ImageChops.difference(reference, screenshot)
    stat = ImageStat.Stat(diff)
    gray_diff = ImageOpsGrayscale(diff)

    reference_edges = ImageOpsGrayscale(reference).filter(ImageFilter.FIND_EDGES)
    screenshot_edges = ImageOpsGrayscale(screenshot).filter(ImageFilter.FIND_EDGES)
    edge_delta = ImageStat.Stat(ImageChops.difference(reference_edges, screenshot_edges)).mean[0]

    if diff_path:
        diff_path.parent.mkdir(parents=True, exist_ok=True)
        amplified = diff.point(lambda value: min(255, value * 3))
        amplified.save(diff_path)

    rms = math.sqrt(mean([channel * channel for channel in stat.rms]))
    return {
        "reference": str(reference_path),
        "screenshot": str(screenshot_path),
        "size": list(reference.size),
        "resized": resized,
        "meanAbsDelta": round(mean(stat.mean), 3),
        "rmsDelta": round(rms, 3),
        "edgeDelta": round(edge_delta, 3),
        "channelMean": [round(value, 3) for value in stat.mean],
        "diff": str(diff_path) if diff_path else None,
    }


def ImageOpsGrayscale(image: Image.Image) -> Image.Image:
    return image.convert("L")


def main() -> None:
    if len(sys.argv) not in {3, 4}:
        print(
            "Usage: python scripts/compare-mockup-screenshots.py <reference.png> <screenshot.png> [diff.png]",
            file=sys.stderr,
        )
        raise SystemExit(2)

    reference_path = Path(sys.argv[1])
    screenshot_path = Path(sys.argv[2])
    diff_path = Path(sys.argv[3]) if len(sys.argv) == 4 else None
    print(json.dumps(compare(reference_path, screenshot_path, diff_path), indent=2))


if __name__ == "__main__":
    main()
