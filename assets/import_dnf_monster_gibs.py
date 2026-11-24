#!/usr/bin/env python3
"""Extract authentic DNF 60/70 per-species monster death gibs into `assets/monster-gibs.png`.

Source (preferring `ImagePacks2_70`, falling back to `ImagePacks2`):
  - `sprite_monster_common.NPK :: sprite/monster/common/m0002..m0009.img`

Output: `144x288` RGBA sprite sheet (8 species rows x 4 chunk columns, 36x36 cells):
  - row 0 (`m0002`): green goblin (`grunt`, `coward`, default)
  - row 1 (`m0008`): red / cursed goblin (`goblinRed`, `cursedRed`)
  - row 2 (`m0007`): blue / frost goblin (`goblinBlue`)
  - row 3 (`m0003`): charcoal / elite goblin (`elite`, `throwerElite`, `deepElite`)
  - row 4 (`m0004`): pale / caster goblin (`caster`, `burningThrower`)
  - row 5 (`m0006`): orange cat / lugaru (`cat`)
  - row 6 (`m0005`): dark-violet cursed lugaru boss (`lugaruBoss`, `deepBoss`)
  - row 7 (`m0009`): ochre-brown brute / tau (`brute`, `boss`)
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "assets"))
from import_dnf_ui import IMGFactory, NPK  # noqa: E402

DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "monster-gibs.png"
CELL = 36
COLS = 4

SPECIES_ROWS: list[tuple[str, str]] = [
    ("goblinGreen", "sprite/monster/common/m0002.img"),
    ("goblinRed", "sprite/monster/common/m0008.img"),
    ("goblinBlue", "sprite/monster/common/m0007.img"),
    ("goblinElite", "sprite/monster/common/m0003.img"),
    ("goblinCaster", "sprite/monster/common/m0004.img"),
    ("lugaruOrange", "sprite/monster/common/m0006.img"),
    ("lugaruDark", "sprite/monster/common/m0005.img"),
    ("tauOchre", "sprite/monster/common/m0009.img"),
]


def resolve_npk(client: pathlib.Path, filename: str) -> pathlib.Path:
    for subdir in ("ImagePacks2_70", "ImagePacks2"):
        candidate = client / subdir / filename
        if candidate.exists():
            return candidate
    raise SystemExit(f"Missing {filename} under {client}/ImagePacks2_70 or ImagePacks2")


def fit_centered(frame: Image.Image, cell: int) -> Image.Image:
    bbox = frame.getbbox()
    if bbox is None:
        raise SystemExit("Encountered empty gib frame")
    cropped = frame.crop(bbox)
    max_dim = cell - 2
    if cropped.width > max_dim or cropped.height > max_dim:
        scale = min(max_dim / cropped.width, max_dim / cropped.height)
        new_w = max(1, int(round(cropped.width * scale)))
        new_h = max(1, int(round(cropped.height * scale)))
        cropped = cropped.resize((new_w, new_h), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    dx = (cell - cropped.width) // 2
    dy = (cell - cropped.height) // 2
    canvas.alpha_composite(cropped, (dx, dy))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    npk_path = resolve_npk(args.client, "sprite_monster_common.NPK")
    needed = {entry for _, entry in SPECIES_ROWS}
    imgs: dict[str, object] = {}
    with open(npk_path, "rb") as handle:
        npk = NPK.open(handle)
        for item in npk.files:
            norm = item.name.replace("\\", "/")
            if norm in needed:
                imgs[norm] = IMGFactory.open(io.BytesIO(item.data))

    missing = needed - set(imgs.keys())
    if missing:
        raise SystemExit(f"Missing entries in {npk_path}: {sorted(missing)}")

    sheet = Image.new("RGBA", (CELL * COLS, CELL * len(SPECIES_ROWS)), (0, 0, 0, 0))
    for row_idx, (_species, entry) in enumerate(SPECIES_ROWS):
        target = imgs[entry]
        if len(target.images) < COLS:
            raise SystemExit(f"{entry} has only {len(target.images)} frames (need {COLS})")
        for col_idx in range(COLS):
            raw = target.build(target.images[col_idx]).convert("RGBA")
            cell_img = fit_centered(raw, CELL)
            sheet.alpha_composite(cell_img, (col_idx * CELL, row_idx * CELL))

    sheet.save(OUT)
    print(f"Wrote {OUT} ({sheet.width}x{sheet.height}) from {npk_path}")


if __name__ == "__main__":
    main()
