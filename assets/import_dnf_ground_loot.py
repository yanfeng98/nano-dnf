#!/usr/bin/env python3
"""Extract authentic DNF 60/70 ground-dropped item sprites into `assets/ground-loot.png`.

Sources (preferring `ImagePacks2_70`, falling back to `ImagePacks2`):
  - `sprite_item.NPK :: sprite/item/fieldimage.img`
  - `sprite_item.NPK :: sprite/item/field_consumption.img`
  - `sprite_item.NPK :: sprite/item/field_material.img`

Output: `624x48` RGBA sprite sheet (13 x 48x48 cells, bottom-centered on y = 44):
  - cell  0 (`x =   0`): gold coin pile (`fieldimage.img` frame 27)
  - cell  1 (`x =  48`): red HP potion vial (`field_consumption.img` frame 13)
  - cell  2 (`x =  96`): blue MP potion vial (`field_consumption.img` frame 14)
  - cell  3 (`x = 144`): material pouch (`fieldimage.img` frame 25)
  - cell  4 (`x = 192`): fate / resurrect gold coin (`fieldimage.img` frame 26)
  - cell  5 (`x = 240`): rare crystal / gem pile (`fieldimage.img` frame 24)
  - cell  6 (`x = 288`): weapon / katana (`fieldimage.img` frame 11)
  - cell  7 (`x = 336`): armor / equipment (`fieldimage.img` frame 0)
  - cell  8 (`x = 384`): green herb / leaf / flower (`fieldimage.img` frame 29)
  - cell  9 (`x = 432`): berry / fruit (`field_material.img` frame 9)
  - cell 10 (`x = 480`): bread / food (`field_material.img` frame 3)
  - cell 11 (`x = 528`): stone / iron / ore (`field_material.img` frame 46)
  - cell 12 (`x = 576`): fur / cloth / leather (`field_material.img` frame 0)
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

PICKS: list[tuple[str, str, str, int]] = [
    ("goldPile", "sprite_item.NPK", "sprite/item/fieldimage.img", 27),
    ("hpPotion", "sprite_item.NPK", "sprite/item/field_consumption.img", 13),
    ("mpPotion", "sprite_item.NPK", "sprite/item/field_consumption.img", 14),
    ("materialPouch", "sprite_item.NPK", "sprite/item/fieldimage.img", 25),
    ("fateCoin", "sprite_item_stackable.NPK", "sprite/item/stackable/consumption.img", 0),
    ("rareCrystal", "sprite_item.NPK", "sprite/item/fieldimage.img", 24),
    ("weapon", "sprite_item.NPK", "sprite/item/fieldimage.img", 11),
    ("equipment", "sprite_item.NPK", "sprite/item/fieldimage.img", 0),
    ("herbLeaf", "sprite_item.NPK", "sprite/item/fieldimage.img", 29),
    ("berryFruit", "sprite_item.NPK", "sprite/item/field_material.img", 9),
    ("breadFood", "sprite_item.NPK", "sprite/item/field_material.img", 3),
    ("stoneOre", "sprite_item.NPK", "sprite/item/field_material.img", 46),
    ("leatherFur", "sprite_item.NPK", "sprite/item/field_material.img", 0),
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

    imgs: dict[tuple[str, str], object] = {}
    needed_by_npk: dict[str, set[str]] = {}
    for _label, npk_name, img_name, _frame_idx in PICKS:
        needed_by_npk.setdefault(npk_name, set()).add(img_name)

    for npk_name, needed in needed_by_npk.items():
        npk_path = resolve_npk(args.client, npk_name)
        with open(npk_path, "rb") as handle:
            npk = NPK.open(handle)
            for item in npk.files:
                norm = item.name.replace("\\", "/")
                if norm in needed:
                    imgs[(npk_name, norm)] = IMGFactory.open(io.BytesIO(item.data))
        missing = [n for n in needed if (npk_name, n) not in imgs]
        if missing:
            raise SystemExit(f"Missing entries in {npk_path}: {sorted(missing)}")

    sheet = Image.new("RGBA", (CELL * len(PICKS), CELL), (0, 0, 0, 0))
    for idx, (label, npk_name, img_name, frame_idx) in enumerate(PICKS):
        target = imgs[(npk_name, img_name)]
        raw = target.build(target.images[frame_idx]).convert("RGBA")
        if label == "fateCoin":
            # Key out the black inventory-slot backdrop around the half-gold/half-silver coin
            px = raw.load()
            w, h = raw.size
            visited = set()
            stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
            while stack:
                x, y = stack.pop()
                if (x, y) in visited or not (0 <= x < w and 0 <= y < h):
                    continue
                visited.add((x, y))
                r, g, b, a = px[x, y]
                if a == 0 or (r < 28 and g < 28 and b < 28):
                    px[x, y] = (0, 0, 0, 0)
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                        if (nx, ny) not in visited:
                            stack.append((nx, ny))
            bb = raw.getbbox()
            if bb:
                raw = raw.crop(bb).resize((22, 16), Image.Resampling.NEAREST)
        cell_img = fit_to_cell(raw, CELL, GROUND_Y)
        sheet.alpha_composite(cell_img, (idx * CELL, 0))

    sheet.save(OUT)
    print(f"Wrote {OUT} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
