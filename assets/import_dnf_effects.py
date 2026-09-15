#!/usr/bin/env python3
"""Bake the official DNF slash effects used by the four Slayer skills.

Sources (mirrored on GitHub, fetched through jsDelivr):
  上挑      sprite_character_swordman_effect.NPK/upperslash.img
  崩山击    sprite_character_swordman_effect.NPK/blast-front.img
  十字斩    sprite_character_swordman_effect_atgorecross.NPK/cross.img
  鬼斩      sprite_character_swordman_effect.NPK/atghost.img

    pip install pydnfex pillow
    python3 assets/import_dnf_effects.py

Writes assets/effects.png: four rows (SKILL_ORDER) x four 128x128 frames.
As with the sprite sheet, DNF artwork belongs to Neople/Nexon.
"""

from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dnf_src"
CDN = "https://cdn.jsdelivr.net/gh"

EFFECTS = [
    ("upSlash", f"{CDN}/LoveOyy/sprite_character_swordman_effect.NPK@master/upperslash.img.js"),
    ("mountainBreaker", f"{CDN}/LoveOyy/sprite_character_swordman_effect.NPK@master/blast-front.img.js"),
    ("crossSlash", f"{CDN}/LoveOyy/sprite_character_swordman_effect_atgorecross.NPK@master/cross.img.js"),
    ("ghostSlash", f"{CDN}/LoveOyy/sprite_character_swordman_effect.NPK@master/atghost.img.js")
]

FRAMES = 4
CELL = 128
PADDING = 6


def key_black_background(image: Image.Image, low: int = 26, soft: int = 48) -> Image.Image:
    """Drop the opaque black backdrop some effect exports carry.

    A few DNF effect IMG files store their frames without alpha (the game uses
    additive blending / a colour board that is not part of this export), so the
    pixels arrive as RGB on solid black. Keying the black out keeps the bright
    slash/blast art and gives it a clean alpha ramp.
    """
    if image.getchannel("A").getextrema() != (255, 255):
        return image
    out = image.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            red, green, blue, alpha = pixels[x, y]
            luma = max(red, green, blue)
            if luma <= low:
                pixels[x, y] = (0, 0, 0, 0)
            elif luma < soft:
                pixels[x, y] = (red, green, blue, int(alpha * (luma - low) / (soft - low)))
    return out


def fetch(name: str, url: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    target = SRC / name
    if target.exists() and target.stat().st_size > 1024:
        return target
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=180) as response:
        target.write_bytes(response.read())
    return target


def load_img(path: Path):
    try:
        from pydnfex.img.version import IMGFactory
    except ImportError:
        print("missing dependency: pip install pydnfex pillow", file=sys.stderr)
        raise SystemExit(2)
    with open(path, "rb") as handle:
        return IMGFactory.open(io.BytesIO(handle.read()))


def pick_frames(count: int) -> list[int]:
    if count <= FRAMES:
        return list(range(count))
    step = (count - 1) / (FRAMES - 1)
    return [round(index * step) for index in range(FRAMES)]


def bake_row(img, row: int, sheet: Image.Image) -> None:
    indices = pick_frames(len(img.images))
    frames = [
        (index, key_black_background(img.build(img.images[index]).convert("RGBA")))
        for index in indices
    ]

    union = None
    for index, frame in frames:
        left = img.images[index].x
        top = img.images[index].y
        box = (left, top, left + frame.width, top + frame.height)
        union = box if union is None else (
            min(union[0], box[0]),
            min(union[1], box[1]),
            max(union[2], box[2]),
            max(union[3], box[3])
        )

    window = (
        union[0] - PADDING,
        union[1] - PADDING,
        union[2] + PADDING,
        union[3] + PADDING
    )
    span_w = window[2] - window[0]
    span_h = window[3] - window[1]
    scale = min((CELL - 8) / span_w, (CELL - 8) / span_h)
    placed_w = max(1, int(span_w * scale))
    placed_h = max(1, int(span_h * scale))
    offset_x = (CELL - placed_w) // 2
    offset_y = (CELL - placed_h) // 2

    for column, (index, frame) in enumerate(frames):
        layer = Image.new("RGBA", (span_w, span_h), (0, 0, 0, 0))
        layer.alpha_composite(frame, (img.images[index].x - window[0], img.images[index].y - window[1]))
        layer = layer.resize((placed_w, placed_h), Image.LANCZOS)
        sheet.alpha_composite(layer, (column * CELL + offset_x, row * CELL + offset_y))

    print(f"  row {row}: {len(frames)} frames of {len(img.images)} (indices {indices})")


def main() -> None:
    sheet = Image.new("RGBA", (CELL * FRAMES, CELL * len(EFFECTS)), (0, 0, 0, 0))
    for row, (skill, url) in enumerate(EFFECTS):
        print(f"{skill}:")
        img = load_img(fetch(f"effect_{skill}.img", url))
        bake_row(img, row, sheet)
    sheet.save(ROOT / "effects.png")
    print(f"wrote {ROOT / 'effects.png'} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
