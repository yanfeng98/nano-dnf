#!/usr/bin/env python3
"""Extract authentic DNF 60/70 consumable icons into `assets/consumables.png`.

Source: `ImagePacks2/sprite_item_stackable.NPK :: sprite/item/stackable/consumption.img`
Output: `84x28` RGBA sprite sheet (3 x 28x28 cells):
  - cell 0 (`x =  0`): frame 40 — HP Potion (classic red cross-stopper flask)
  - cell 1 (`x = 28`): frame 41 — MP Potion (classic blue flask)
  - cell 2 (`x = 56`): frame  0 — Resurrect Coin (复活币, half-sun / half-moon coin)
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
OUT = ROOT / "assets" / "consumables.png"
CELL = 28

PICKS: list[tuple[str, int]] = [
    ("hpPotion", 40),
    ("mpPotion", 41),
    ("resurrectCoin", 0),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    npk_path = args.client / "ImagePacks2" / "sprite_item_stackable.NPK"
    if not npk_path.exists():
        raise SystemExit(f"Missing {npk_path}")

    with open(npk_path, "rb") as handle:
        npk = NPK.open(handle)
        target = None
        for item in npk.files:
            if item.name.replace("\\", "/") == "sprite/item/stackable/consumption.img":
                target = IMGFactory.open(io.BytesIO(item.data))
                break
        if target is None:
            raise SystemExit("sprite/item/stackable/consumption.img not found")

        sheet = Image.new("RGBA", (CELL * len(PICKS), CELL), (0, 0, 0, 0))
        for idx, (_name, frame_idx) in enumerate(PICKS):
            frame = target.build(target.images[frame_idx]).convert("RGBA")
            if frame.size != (CELL, CELL):
                frame = frame.resize((CELL, CELL), Image.Resampling.NEAREST)
            sheet.paste(frame, (idx * CELL, 0), frame)

    sheet.save(OUT)
    print(f"Wrote {OUT} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
