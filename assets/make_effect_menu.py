#!/usr/bin/env python3
"""Render the effect reference sheets used to pick DNF skill effects by eye.

    pip install pydnfex pillow
    python3 assets/make_effect_menu.py

Writes (both gitignored, they are working references):
  assets/dnf_effect_candidates.png - every candidate, numbered, 4 sampled frames
  assets/dnf_effect_preview.png    - the four frames each skill currently uses

The owner reads a number off the candidate sheet and it goes into the EFFECTS
table of assets/import_dnf_effects.py.
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dnf_src"
SLASH = "https://cdn.jsdelivr.net/gh/LoveOyy/sprite_character_swordman_effect.NPK@master"
STEP = "https://cdn.jsdelivr.net/gh/LoveOyy/sprite_character_swordman_effect_ghoststep.NPK@master"

CANDIDATES = [
    ("atghost", f"{SLASH}/atghost.img.js"),
    ("blast-back", f"{SLASH}/blast-back.img.js"),
    ("dotarea", f"{SLASH}/dotarea.img.js"),
    ("fire-back", f"{SLASH}/fire-back.img.js"),
    ("fire-front", f"{SLASH}/fire-front.img.js"),
    ("fullmoon", f"{SLASH}/fullmoon.img.js"),
    ("ghost", f"{SLASH}/ghost.img.js"),
    ("grandwave", f"{SLASH}/grandwave.img.js"),
    ("grandwaveblade", f"{SLASH}/grandwaveblade.img.js"),
    ("hardattackblade1", f"{SLASH}/hardattackblade1.img.js"),
    ("hardattackblade2", f"{SLASH}/hardattackblade2.img.js"),
    ("hardattackoncharge", f"{SLASH}/hardattackoncharge.img.js"),
    ("jumpattackhold", f"{SLASH}/jumpattackhold.img.js"),
    ("momentaryslashblade", f"{SLASH}/momentaryslashblade.img.js"),
    ("normalwave1", f"{SLASH}/normalwave1.img.js"),
    ("normalwave2", f"{SLASH}/normalwave2.img.js"),
    ("pinchhpregen", f"{SLASH}/pinchhpregen.img.js"),
    ("pinchhpregen2", f"{SLASH}/pinchhpregen2.img.js"),
    ("releasewave1", f"{SLASH}/releasewave1.img.js"),
    ("releasewave2", f"{SLASH}/releasewave2.img.js"),
    ("releasewave3", f"{SLASH}/releasewave3.img.js"),
    ("slash-1", f"{SLASH}/slash-1.img.js"),
    ("slash-2", f"{SLASH}/slash-2.img.js"),
    ("summonarea", f"{SLASH}/summonarea.img.js"),
    ("surajin", f"{SLASH}/surajin.img.js"),
    ("sword-effect", f"{SLASH}/sword-effect.img.js"),
    ("tombstone", f"{SLASH}/tombstone.img.js"),
    ("tombstonedust", f"{SLASH}/tombstonedust.img.js"),
    ("tombstoneglow1", f"{SLASH}/tombstoneglow1.img.js"),
    ("upperslash", f"{SLASH}/upperslash.img.js"),
    ("01_sword_dodge", f"{STEP}/01_sword_dodge.img.js"),
]

SKILL_NAMES = [
    "上挑",
    "崩山击",
    "十字斩",
    "鬼斩",
    "三段斩",
    "裂波斩",
    "怒气爆发",
    "月光斩",
    "抓头",
    "鬼影闪",
    "崩山裂地斩",
]


def fetch(name: str, url: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    target = SRC / f"cand_{name}.img"
    if target.exists() and target.stat().st_size > 512:
        return target
    with urllib.request.urlopen(url, timeout=180) as response:
        target.write_bytes(response.read())
    return target


def load_img(path: Path):
    from pydnfex.img.version import IMGFactory

    with open(path, "rb") as handle:
        return IMGFactory.open(io.BytesIO(handle.read()))


def sampled_frames(img, count: int = 4):
    total = len(img.images)
    if total <= count:
        indices = list(range(total))
    else:
        step = (total - 1) / (count - 1)
        indices = sorted({round(index * step) for index in range(count)})
    frames = []
    for index in indices:
        try:
            frames.append(img.build(img.images[index]).convert("RGBA"))
        except Exception:
            continue
    return frames


def build_candidate_sheet() -> None:
    cell = 104
    sheet = Image.new("RGBA", (150 + cell * 4, cell * len(CANDIDATES)), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    for row, (name, url) in enumerate(CANDIDATES):
        img = load_img(fetch(name, url))
        y = row * cell
        draw.text((6, y + cell // 2 - 6), f"{row} {name} ({len(img.images)})", fill=(255, 215, 120, 255))
        for column, frame in enumerate(sampled_frames(img)):
            scale = min((cell - 10) / frame.width, (cell - 10) / frame.height, 1.0)
            size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
            sheet.alpha_composite(
                frame.resize(size, Image.LANCZOS),
                (150 + column * cell + (cell - size[0]) // 2, y + (cell - size[1]) // 2),
            )
    sheet.save(ROOT / "dnf_effect_candidates.png")
    print(f"wrote {ROOT / 'dnf_effect_candidates.png'} ({sheet.width}x{sheet.height})")


def build_preview() -> None:
    atlas = Image.open(ROOT / "effects.png").convert("RGBA")
    cell = atlas.width // 4
    scale = 0.75
    step = int(cell * scale)
    sheet = Image.new("RGBA", (156 + 4 * step, step * len(SKILL_NAMES)), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    for row, name in enumerate(SKILL_NAMES):
        y = row * step
        draw.text((6, y + step // 2 - 6), name, fill=(255, 215, 120, 255))
        for column in range(4):
            tile = atlas.crop((column * cell, row * cell, (column + 1) * cell, (row + 1) * cell))
            sheet.alpha_composite(tile.resize((step - 6, step - 6), Image.LANCZOS), (156 + column * step, y))
    sheet.save(ROOT / "dnf_effect_preview.png")
    print(f"wrote {ROOT / 'dnf_effect_preview.png'} ({sheet.width}x{sheet.height})")


def main() -> None:
    build_candidate_sheet()
    build_preview()


if __name__ == "__main__":
    main()
