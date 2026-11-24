#!/usr/bin/env python3
"""Extract authentic DNF 60/70 ground-dropped item sprites into `assets/ground-loot.png`.

Sources (preferring `ImagePacks2_70`, falling back to `ImagePacks2`):
  - `sprite_item.NPK :: sprite/item/fieldimage.img`
  - `sprite_item.NPK :: sprite/item/field_consumption.img`

Output: `384x48` RGBA sprite sheet (8 x 48x48 cells, bottom-centered on y = 44):
  - cell 0 (`x =   0`): gold coin pile (`fieldimage.img` frame 27)
  - cell 1 (`x =  48`): red HP potion vial (`field_consumption.img` frame 13)
  - cell 2 (`x =  96`): blue MP potion vial (`field_consumption.img` frame 14)
  - cell 3 (`x = 144`): material pouch (`fieldimage.img` frame 25)
  - cell 4 (`x = 192`): fate / resurrect gold coin (`fieldimage.img` frame 26)
  - cell 5 (`x = 240`): rare crystal / gem pile (`fieldimage.img` frame 24)
  - cell 6 (`x = 288`): weapon / katana (`fieldimage.img` frame 11)
  - cell 7 (`x = 336`): armor / equipment (`fieldimage.img` frame 0)
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
OUT = ROOT / "assets" / "ground-loot.png"
CELL = 48
GROUND_Y = 44

PICKS: list[tuple[str, str, int]] = [
    ("goldPile", "sprite/item/fieldimage.img", 27),
    ("hpPotion", "sprite/item/field_consumption.img", 13),
    ("mpPotion", "sprite/item/field_consumption.img", 14),
    ("materialPouch", "sprite/item/fieldimage.img", 25),
    ("fateCoin", "sprite/item/fieldimage.img", 26),
    ("rareCrystal", "sprite/item/fieldimage.img", 24),
    ("weapon", "sprite/item/fieldimage.img", 11),
    ("equipment", "sprite/item/fieldimage.img", 0),
]


def resolve_npk(client: pathlib.Path, filename: str) -> pathlib.Path:
    for subdir in ("ImagePacks2_70", "ImagePacks2"):
        candidate = client / subdir / filename
        if candidate.exists():
            return candidate
    raise SystemExit(f"Missing {filename} under {client}/ImagePacks2_70 or ImagePacks2")


def fit_to_cell(frame: Image.Image, cell: int, ground_y: int) -> Image.Image:
    bbox = frame.getbbox()
    if bbox is None:
        raise SystemExit("Encountered empty item frame")
    cropped = frame.crop(bbox)
    max_dim = cell - 4
    if cropped.width > max_dim or cropped.height > max_dim:
        scale = min(max_dim / cropped.width, max_dim / cropped.height)
        new_w = max(1, int(round(cropped.width * scale)))
        new_h = max(1, int(round(cropped.height * scale)))
        cropped = cropped.resize((new_w, new_h), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    dx = (cell - cropped.width) // 2
    dy = max(2, ground_y - cropped.height)
    canvas.alpha_composite(cropped, (dx, dy))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    npk_path = resolve_npk(args.client, "sprite_item.NPK")
    imgs: dict[str, object] = {}
    needed = {img_name for _, img_name, _ in PICKS}
    with open(npk_path, "rb") as handle:
        npk = NPK.open(handle)
        for item in npk.files:
            norm = item.name.replace("\\", "/")
            if norm in needed:
                imgs[norm] = IMGFactory.open(io.BytesIO(item.data))

    missing = needed - set(imgs.keys())
    if missing:
        raise SystemExit(f"Missing entries in {npk_path}: {sorted(missing)}")

    sheet = Image.new("RGBA", (CELL * len(PICKS), CELL), (0, 0, 0, 0))
    for idx, (_label, img_name, frame_idx) in enumerate(PICKS):
        target = imgs[img_name]
        raw = target.build(target.images[frame_idx]).convert("RGBA")
        cell_img = fit_to_cell(raw, CELL, GROUND_Y)
        sheet.alpha_composite(cell_img, (idx * CELL, 0))

    sheet.save(OUT)
    print(f"Wrote {OUT} ({sheet.width}x{sheet.height}) from {npk_path}")


if __name__ == "__main__":
    main()
