#!/usr/bin/env python3
"""Bake the official DNF skill effects used by the Slayer hotbar.

Each skill pulls the effect the game itself uses for that move, out of the
local client when one is installed (C:\\dnf through WSL by default) and out of
the GitHub mirror otherwise:

  上挑        effect/upperslash.img
  崩山击      effect/normalwave1.img
  十字斩      effect/gorecross/gorecross_cross.img
  鬼斩        effect/ghost.img
  三段斩      effect/momentaryslashblade.img
  裂波斩      effect/grandwaveblade.img
  怒气爆发    effect/blast-back.img
  月光斩      effect/fullmoon.img
  抓头        effect/pinchhpregen.img
  鬼影闪      effect/ghostsidewind/01_sword_dodge.img
  崩山裂地斩  effect/fire-front.img

Two things make the baked rows read like the real move instead of a stray
spark: the four frames are taken from the densest window of the animation
(DNF effects start and end nearly invisible, so sampling the first and last
frame wastes half the row) and each row is cropped to the pixels that are
actually drawn before it is scaled into its cell.

    pip install pydnfex pillow
    python3 assets/import_dnf_effects.py [--client /mnt/c/dnf/地下城与勇士]

Writes assets/effects.png: one row per SKILL_ORDER entry, four 128x128 frames.
As with the sprite sheet, DNF artwork belongs to Neople/Nexon.
"""

from __future__ import annotations

import argparse
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dnf_src"
CDN = "https://cdn.jsdelivr.net/gh"
DEFAULT_CLIENT = Path("/mnt/c/dnf/地下城与勇士")

SLASH = f"{CDN}/LoveOyy/sprite_character_swordman_effect.NPK@master"
GORE = f"{CDN}/LoveOyy/sprite_character_swordman_effect_atgorecross.NPK@master"
STEP = f"{CDN}/LoveOyy/sprite_character_swordman_effect_ghoststep.NPK@master"

# One row per skill, in SKILL_ORDER: (skill, client NPK, entry, mirror url).
# The comment on each line is the move the effect belongs to.
EFFECTS = [
    ("upSlash", "sprite_character_swordman_effect.NPK", "upperslash.img", f"{SLASH}/upperslash.img.js"),
    ("mountainBreaker", "sprite_character_swordman_effect.NPK", "normalwave1.img", f"{SLASH}/normalwave1.img.js"),
    ("crossSlash", "sprite_character_swordman_effect_gorecross.NPK", "gorecross_cross.img", f"{GORE}/cross.img.js"),
    ("ghostSlash", "sprite_character_swordman_effect.NPK", "ghost.img", f"{SLASH}/atghost.img.js"),
    ("tripleSlash", "sprite_character_swordman_effect.NPK", "momentaryslashblade.img", f"{SLASH}/momentaryslashblade.img.js"),
    ("waveSlash", "sprite_character_swordman_effect.NPK", "grandwaveblade.img", f"{SLASH}/grandwaveblade.img.js"),
    ("rageBurst", "sprite_character_swordman_effect.NPK", "blast-back.img", f"{SLASH}/blast-back.img.js"),
    ("moonlightSlash", "sprite_character_swordman_effect.NPK", "fullmoon.img", f"{SLASH}/fullmoon.img.js"),
    ("graspHead", "sprite_character_swordman_effect.NPK", "pinchhpregen.img", f"{SLASH}/pinchhpregen.img.js"),
    ("ghostStep", "sprite_character_swordman_effect_ghostsidewind.NPK", "01_sword_dodge.img", f"{STEP}/01_sword_dodge.img.js"),
    ("mountainRift", "sprite_character_swordman_effect.NPK", "fire-front.img", f"{SLASH}/fire-front.img.js")
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

    The backdrop is detected rather than assumed: some exports carry a black
    background *and* a few transparent pixels, which an alpha-extrema test walks
    straight past, leaving a black box around the move.
    """
    pixels = image.load()
    total = image.width * image.height
    dark = 0
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 0 and max(red, green, blue) <= low:
                dark += 1
    if total == 0 or dark < total * 0.15:
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


def from_client(client: Path, npk_name: str, entry: str, cache_name: str):
    """Pull one .img straight out of an installed client, caching it locally."""
    cached = SRC / cache_name
    if cached.exists():
        return cached
    pack = client / "ImagePacks2" / npk_name
    if not pack.exists():
        return None
    try:
        from pydnfex.npk import NPK
    except ImportError:
        return None
    handle = open(pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if item.name.rsplit("/", 1)[-1] == entry:
                SRC.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(item.data)
                return cached
    finally:
        handle.close()
    return None


def drawn_area(frame: Image.Image) -> int:
    box = frame.getbbox()
    return 0 if box is None else (box[2] - box[0]) * (box[3] - box[1])


def active_window(frames: list[Image.Image], count: int) -> list[int]:
    """Indices of the densest run of frames: where the effect is really visible."""
    if len(frames) <= count:
        return list(range(len(frames)))
    areas = [drawn_area(frame) for frame in frames]
    best, best_score = 0, None
    for start in range(len(frames) - count + 1):
        score = sum(areas[start:start + count])
        if best_score is None or score > best_score:
            best, best_score = start, score
    return list(range(best, best + count))


def bake_row(img, row: int, sheet: Image.Image) -> None:
    built = [
        key_black_background(img.build(image).convert("RGBA"))
        for image in img.images
    ]
    indices = active_window(built, FRAMES)
    frames = [(index, built[index]) for index in indices]

    # Crop to the pixels that exist instead of the img's empty canvas, so a
    # 40px spark does not end up floating in the middle of a 128px cell.
    union = None
    for index, frame in frames:
        box = frame.getbbox()
        if box is None:
            continue
        entry = img.images[index]
        placed = (entry.x + box[0], entry.y + box[1], entry.x + box[2], entry.y + box[3])
        union = placed if union is None else (
            min(union[0], placed[0]),
            min(union[1], placed[1]),
            max(union[2], placed[2]),
            max(union[3], placed[3])
        )
    if union is None:
        print(f"  row {row}: nothing drawn, skipping")
        return

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=DEFAULT_CLIENT,
                        help="installed DNF client (ImagePacks2 lives inside it)")
    args = parser.parse_args()

    sheet = Image.new("RGBA", (CELL * FRAMES, CELL * len(EFFECTS)), (0, 0, 0, 0))
    for row, (skill, npk_name, entry, url) in enumerate(EFFECTS):
        print(f"{skill}:")
        path = None
        if args.client.exists():
            path = from_client(args.client, npk_name, entry, f"effect_{entry}")
        if path is None:
            path = fetch(f"effect_{entry}", url)
        img = load_img(path)
        bake_row(img, row, sheet)
    sheet.save(ROOT / "effects.png")
    print(f"wrote {ROOT / 'effects.png'} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
