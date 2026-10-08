#!/usr/bin/env python3
"""Bake the 格兰之森 region map's stage cards out of a local DNF client.

The client draws its own region menu: `sprite/worldmap/selectdungeonslot/
granfloris.img` is nine 168x73 cards, and **each card already has the stage's
Chinese name and a portrait of that stage's boss painted into it**. That is the
region map this game needs, so we take it whole rather than draw our own.

Frame order is the client's, and it is the authority for `STAGE.slot`
(`docs/granfloris-assets.md` 第二节):

    f0 幽暗密林   f1 幽暗密林深处  f2 冰霜幽暗密林  f3 雷鸣废墟
    f4 猛毒雷鸣废墟 f5 格拉卡      f6 烈焰格拉卡    f7 暗黑雷鸣废墟
    f8 亡月雷鸣废墟（转职，本作不用）

The cards are **not** the monsters' own art scaled down - they are painted
separately (measured: masked matching against the monster `.img` never gets
below RMSE 94/255). So they are good for exactly one job: being the menu.

    python3 assets/import_dnf_region.py            # write assets/region.png
    python3 assets/import_dnf_region.py --preview  # labelled check sheet
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "region.png"

PACK = "sprite_worldmap_selectdungeonslot.NPK"
ENTRY = "sprite/worldmap/selectdungeonslot/granfloris.img"
CARD_W, CARD_H = 168, 73
COLS = 5

STAGE_NAMES = [
    "幽暗密林", "幽暗密林深处", "冰霜幽暗密林", "雷鸣废墟", "猛毒雷鸣废墟",
    "格拉卡", "烈焰格拉卡", "暗黑雷鸣废墟", "亡月雷鸣废墟",
]


def frames(client: pathlib.Path) -> list[Image.Image]:
    handle = open(client / "ImagePacks2" / PACK, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if item.name.replace("\\", "/").endswith(ENTRY.rsplit("/", 1)[-1]):
                img = IMGFactory.open(io.BytesIO(item.data))
                return [img.build(f).convert("RGBA") for f in img.images]
        raise SystemExit(f"{ENTRY} not found in {PACK}")
    finally:
        handle.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    cards = frames(args.client)
    if len(cards) < 8:
        print(f"expected at least 8 cards, got {len(cards)}", file=sys.stderr)
        raise SystemExit(2)

    rows = (len(cards) + COLS - 1) // COLS
    sheet = Image.new("RGBA", (CARD_W * COLS, CARD_H * rows), (0, 0, 0, 0))
    for index, card in enumerate(cards[:9]):
        sheet.alpha_composite(card, ((index % COLS) * CARD_W, (index // COLS) * CARD_H))

    if args.preview:
        target = ROOT / "assets" / "dnf_src" / "region-preview.png"
        zoom = 3
        pad = 22
        out = Image.new("RGBA", (CARD_W * zoom * 3 + 8, (CARD_H * zoom + pad) * 3 + 8), (26, 26, 32, 255))
        draw = ImageDraw.Draw(out)
        for index, card in enumerate(cards[:9]):
            cell = card.resize((CARD_W * zoom, CARD_H * zoom), Image.NEAREST)
            x = (index % 3) * (CARD_W * zoom + 4)
            y = (index // 3) * (CARD_H * zoom + pad)
            out.alpha_composite(cell, (x, y + pad))
            draw.text((x + 4, y + 4), f"f{index}  {STAGE_NAMES[index]}", fill=(255, 224, 120))
        target.parent.mkdir(parents=True, exist_ok=True)
        out.save(target)
        print(f"preview -> {target} ({out.size[0]}x{out.size[1]})")
        return

    sheet.save(OUT)
    print(f"{len(cards)} cards, {CARD_W}x{CARD_H}, {COLS} per row -> {OUT} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
