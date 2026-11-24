#!/usr/bin/env python3
"""Extract authentic DNF 60/70 Swordman 3-hit basic attack slash streaks.

Source (ADR 0074 — local client ImagePacks2_70/sprite_common_hiteffect.NPK):
- Row 0 (combo_index 0, downward slash):   slashlarge1.img (3 frames: white-gold lens, cyan flash, orange speed line)
- Row 1 (combo_index 1, horizontal slash): slashlarge2.img (3 frames: wide horizontal white-gold lens, cyan flash, orange speed line — matches 00001 @ 2:44)
- Row 2 (combo_index 2, upward slash):     slashlarge3.img (3 frames: upward white-gold lens, cyan flash, orange speed line)

Output:
- assets/basic-slash.png (960x552: 3 cols x 3 rows of 320x184 cells, native 1:1 pixel resolution)
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

DEFAULT_CLIENT = Path("/mnt/c/dnf/地下城与勇士")
ROOT = Path(__file__).resolve().parent.parent

CELL_W = 320
CELL_H = 184


def load_npk_img_frames(npk_path: Path, entry_suffix: str) -> list[Image.Image]:
    with open(npk_path, "rb") as handle:
        npk = NPK.open(handle)
        for item in npk.files:
            if item.name.lower().endswith(entry_suffix.lower()):
                img = IMGFactory.open(io.BytesIO(item.data))
                frames: list[Image.Image] = []
                for meta in img.images:
                    built = img.build(meta)
                    if built is not None:
                        frames.append(built.convert("RGBA"))
                return frames
    raise FileNotFoundError(f"{entry_suffix} not found in {npk_path}")


def key_black_additive(frame: Image.Image) -> Image.Image:
    """Convert black-backed DNF additive slash frames to crisp transparent RGBA."""
    out = frame.convert("RGBA")
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = max(r, g, b)
            if lum <= 12:
                px[x, y] = (0, 0, 0, 0)
            elif lum < 40:
                alpha = int((lum - 12) / 28.0 * a)
                px[x, y] = (r, g, b, alpha)
    return out


def build_basic_slash_sheet(client: Path) -> Image.Image:
    npk_path = client / "ImagePacks2_70" / "sprite_common_hiteffect.NPK"
    if not npk_path.exists():
        npk_path = client / "ImagePacks2" / "sprite_common_hiteffect.NPK"

    sheet = Image.new("RGBA", (CELL_W * 3, CELL_H * 3), (0, 0, 0, 0))
    rows = [
        "slashlarge1.img",  # Row 0: combo 0 downward diagonal white-gold -> cyan -> orange
        "slashlarge2.img",  # Row 1: combo 1 wide horizontal white-gold -> cyan -> orange (00001 @ 2:44)
        "slashlarge3.img",  # Row 2: combo 2 upward diagonal white-gold -> cyan -> orange
    ]
    for row_idx, entry in enumerate(rows):
        frames = load_npk_img_frames(npk_path, entry)
        for col_idx in range(min(3, len(frames))):
            fr = key_black_additive(frames[col_idx])
            bbox = fr.getbbox()
            if bbox is not None:
                fr = fr.crop(bbox)
            if fr.width > CELL_W or fr.height > CELL_H:
                ratio = min(CELL_W / fr.width, CELL_H / fr.height)
                fr = fr.resize(
                    (max(1, int(fr.width * ratio)), max(1, int(fr.height * ratio))),
                    Image.Resampling.BILINEAR,
                )
            ox = col_idx * CELL_W + (CELL_W - fr.width) // 2
            oy = row_idx * CELL_H + (CELL_H - fr.height) // 2
            sheet.alpha_composite(fr, (ox, oy))
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    sheet = build_basic_slash_sheet(args.client)
    out_path = ROOT / "assets" / "basic-slash.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size})")


if __name__ == "__main__":
    main()
