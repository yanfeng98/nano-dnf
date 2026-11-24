#!/usr/bin/env python3
"""Extract authentic DNF 60/70 impact hit-flash starbursts and italic bitmap damage digits.

Sources (ADR 0074 — local client ImagePacks2_70):
- sprite_common_hiteffect.NPK:
    - knocklarge.img (3 frames: spiky white-yellow starburst, cyan crackle, orange sparks)
    - knocksmall.img (3 frames: compact radial starburst)
    - slashlarge1.img (3 frames: diagonal impact slash streak)
- sprite_common_digit.NPK:
    - adddamage.img (10 italic bold bitmap glyphs 0..9)

Outputs:
- assets/impact-flash.png (432x384: 3 cols x 3 rows of 144x128 cells)
- assets/damage-digits.png (240x66: 10 cols x 3 rows of 24x22 cells; rows = normal/crit/playerHurt)
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
    """Convert black-backed DNF additive hit-effect frames to crisp transparent RGBA."""
    out = frame.convert("RGBA")
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = max(r, g, b)
            if lum <= 14:
                px[x, y] = (0, 0, 0, 0)
            elif lum < 44:
                alpha = int((lum - 14) / 30.0 * a)
                px[x, y] = (r, g, b, alpha)
    return out


def build_impact_flash_sheet(client: Path) -> Image.Image:
    npk_path = client / "ImagePacks2_70" / "sprite_common_hiteffect.NPK"
    if not npk_path.exists():
        npk_path = client / "ImagePacks2" / "sprite_common_hiteffect.NPK"

    cell_w, cell_h = 144, 128
    sheet = Image.new("RGBA", (cell_w * 3, cell_h * 3), (0, 0, 0, 0))
    rows = [
        ("knocklarge.img", 1.0),
        ("knocksmall.img", 1.35),
        ("slashlarge1.img", 1.0),
    ]
    for row_idx, (entry, scale) in enumerate(rows):
        frames = load_npk_img_frames(npk_path, entry)
        for col_idx in range(min(3, len(frames))):
            fr = key_black_additive(frames[col_idx])
            bbox = fr.getbbox()
            if bbox is not None:
                fr = fr.crop(bbox)
            if scale != 1.0:
                nw = max(1, int(round(fr.width * scale)))
                nh = max(1, int(round(fr.height * scale)))
                fr = fr.resize((nw, nh), Image.Resampling.NEAREST)
            # Fit inside cell if larger
            if fr.width > cell_w - 4 or fr.height > cell_h - 4:
                ratio = min((cell_w - 4) / fr.width, (cell_h - 4) / fr.height)
                fr = fr.resize(
                    (max(1, int(fr.width * ratio)), max(1, int(fr.height * ratio))),
                    Image.Resampling.BILINEAR,
                )
            ox = col_idx * cell_w + (cell_w - fr.width) // 2
            oy = row_idx * cell_h + (cell_h - fr.height) // 2
            sheet.alpha_composite(fr, (ox, oy))
    return sheet


def recolor_digit(
    glyph: Image.Image,
    top_rgb: tuple[int, int, int],
    bot_rgb: tuple[int, int, int],
    outline_rgb: tuple[int, int, int],
) -> Image.Image:
    """Recolor a client italic damage glyph (preserving its crisp dark outline and interior gradient)."""
    # Upscale 2x with NEAREST for razor-sharp pixel art at 800x600 native resolution
    up = glyph.convert("RGBA").resize(
        (glyph.width * 2, glyph.height * 2), Image.Resampling.NEAREST
    )
    w, h = up.size
    px = up.load()
    # Find vertical ink bounds for clean top-to-bottom gradient
    ys = [y for y in range(h) for x in range(w) if px[x, y][3] > 64]
    y_min = min(ys) if ys else 0
    y_max = max(ys) if ys else max(1, h - 1)
    span = max(1, y_max - y_min)

    for y in range(h):
        t = (y - y_min) / span
        t = max(0.0, min(1.0, t))
        # Slight highlight boost near top of glyph
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 32:
                px[x, y] = (0, 0, 0, 0)
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            if lum < 0.28:
                # Crisp dark outline pixel
                px[x, y] = (outline_rgb[0], outline_rgb[1], outline_rgb[2], a)
            else:
                # Interior fill pixel: blend gradient modulated by original shading
                shade = min(1.12, 0.72 + lum * 0.48)
                nr = int(max(0, min(255, (top_rgb[0] * (1.0 - t) + bot_rgb[0] * t) * shade)))
                ng = int(max(0, min(255, (top_rgb[1] * (1.0 - t) + bot_rgb[1] * t) * shade)))
                nb = int(max(0, min(255, (top_rgb[2] * (1.0 - t) + bot_rgb[2] * t) * shade)))
                px[x, y] = (nr, ng, nb, a)
    return up


def build_damage_digits_sheet(client: Path) -> Image.Image:
    npk_path = client / "ImagePacks2_70" / "sprite_common_digit.NPK"
    if not npk_path.exists():
        npk_path = client / "ImagePacks2" / "sprite_common_digit.NPK"

    frames = load_npk_img_frames(npk_path, "adddamage.img")
    if len(frames) < 10:
        raise RuntimeError(f"expected 10 digits in adddamage.img, got {len(frames)}")

    cell_w, cell_h = 24, 22
    sheet = Image.new("RGBA", (cell_w * 10, cell_h * 3), (0, 0, 0, 0))
    palettes = [
        # Row 0: Normal hit — crisp DNF yellow-to-gold with black outline (matches V1 95s/290s, V2 155s)
        ((255, 250, 96), (242, 178, 18), (12, 8, 4)),
        # Row 1: Critical hit — bright yellow-white top to fiery orange-red bottom with dark crimson outline
        ((255, 252, 150), (255, 86, 16), (36, 6, 4)),
        # Row 2: Player damage taken — vivid red top to deep crimson bottom with black outline
        ((255, 92, 92), (206, 16, 24), (20, 4, 4)),
    ]

    for row_idx, (top_rgb, bot_rgb, out_rgb) in enumerate(palettes):
        for digit in range(10):
            colored = recolor_digit(frames[digit], top_rgb, bot_rgb, out_rgb)
            ox = digit * cell_w + (cell_w - colored.width) // 2
            oy = row_idx * cell_h + (cell_h - colored.height) // 2
            sheet.alpha_composite(colored, (ox, oy))
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    impact_sheet = build_impact_flash_sheet(args.client)
    impact_out = ROOT / "assets" / "impact-flash.png"
    impact_sheet.save(impact_out)
    print(f"wrote {impact_out} ({impact_sheet.size})")

    digits_sheet = build_damage_digits_sheet(args.client)
    digits_out = ROOT / "assets" / "damage-digits.png"
    digits_sheet.save(digits_out)
    print(f"wrote {digits_out} ({digits_sheet.size})")


if __name__ == "__main__":
    main()
