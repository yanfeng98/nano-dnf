#!/usr/bin/env python3
"""Bake 幽暗密林's room art - forest, ground and props - out of the DNF client.

**Which set.** Gran-Floris room art is not one picture; it is five numbered sets
of layers (`docs/granfloris-assets.md` 第三节), and a set is a `far` panorama, a
`mid` layer, four `tile` ground strips and a pile of numbered `obj` props.
`docs/granfloris-assets.md` guessed set **01** for 幽暗密林 and said so out loud
("the binding is in the encrypted Script.pvf, so the mapping below is our
choice"). The owner's recording settles it: the 幽暗密林 rooms in
`assets/dnf_src/bilibili/BV1d24y1P74G.mp4` are **set 02** - the trunks are
violet-blue with orange-brown bark streaks, which is `02mid0` and not `01mid1`.
`docs/adr/0028` records that correction.

**What is placed where.** A `far` and a `mid` layer are strips that tile
horizontally and stand on the band's far edge; a `tile` is the ground itself;
an `obj` is a single prop with a footprint. So each entry is baked **cropped to
its own ink**, and the game decides the composition (`src/render.js` SCENE).
That is the opposite of the monster bake, which needed a fixed cell because
every frame of a monster has to land on the same ground point.

    python3 assets/import_dnf_scene.py             # write assets/forest.png
    python3 assets/import_dnf_scene.py --preview   # labelled contact sheet
    python3 assets/import_dnf_scene.py --table     # the rect table, as JS
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "forest.png"
META = ROOT / "assets" / "dnf_src" / "forest.json"

MAP = "sprite_map.NPK"
GATE = "sprite_map_pathgate.NPK"
BREAK = "sprite_map_breakableobject.NPK"

# (name, pack, entry, frame). Names are what `src/render.js` SCENE.pieces and a
# room's `props` list use, so they are part of the game's vocabulary, not of the
# bake's convenience.
PIECES = [
    # The three layer strips, painted in this order.
    ("far",   MAP, "sprite/map/02far0.img", 0),
    ("mid",   MAP, "sprite/map/02mid0.img", 0),
    ("tile0", MAP, "sprite/map/02tile00.img", 0),
    ("tile1", MAP, "sprite/map/02tile01.img", 0),
    ("tile2", MAP, "sprite/map/02tile02.img", 0),
    ("tile3", MAP, "sprite/map/02tile03.img", 0),
    # Props: trees, stone, undergrowth. A room's `props` picks from these.
    ("trunkTall",  MAP, "sprite/map/02obj101.img", 0),
    ("trunkBent",  MAP, "sprite/map/02obj102.img", 0),
    ("trunkMossy", MAP, "sprite/map/02obj103.img", 0),
    ("treeLeafy",  MAP, "sprite/map/02obj300.img", 0),
    ("stump",      MAP, "sprite/map/02obj400.img", 0),
    ("wallStone",  MAP, "sprite/map/02obj008.img", 0),
    ("rockFlat",   MAP, "sprite/map/02obj009.img", 0),
    ("rockSmall",  MAP, "sprite/map/02obj010.img", 0),
    ("pillar",     MAP, "sprite/map/02obj006.img", 0),
    ("bush",       MAP, "sprite/map/02obj001.img", 0),
    ("flower",     MAP, "sprite/map/02obj002.img", 0),
    ("grass",      MAP, "sprite/map/02obj201.img", 0),
    ("grassFlower", MAP, "sprite/map/02obj202.img", 0),
    ("sprout",     MAP, "sprite/map/02obj500.img", 0),
    # The way out of a room is a stone gate in the client's own forest palette
    # (family 02 = the set's own family), and the barrel is the client's own
    # breakable, used here as scenery.
    ("gate",   GATE, "sprite/map/pathgate/granflorissidegate02.img", 0),
    ("barrel", BREAK, "sprite/map/breakableobject/barrel.img", 0),
]

SHELF_W = 1280


def offset_of(frame) -> tuple[int, int]:
    if hasattr(frame, "x"):
        return frame.x, frame.y
    final = getattr(frame, "final_image", None)
    if final is not None and hasattr(final, "x"):
        return final.x, final.y
    return 0, 0


def crop_ink(picture: Image.Image) -> Image.Image:
    """The art alone, no canvas - what the composition actually places."""
    spot = picture.getbbox()
    if spot is None:
        return picture
    return picture.crop(spot)


def decode(client: pathlib.Path, pack: str, entry: str, frame_index: int):
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            frame = img.images[frame_index]
            return crop_ink(img.build(frame).convert("RGBA"))
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def shelf_pack(sizes, width):
    """Place (w, h) boxes on shelves of `width`. Simple, and the sheet is small."""
    placed, x, y, shelf = [], 0, 0, 0
    for w, h in sizes:
        if x + w > width and x > 0:
            y += shelf
            x, shelf = 0, 0
        placed.append((x, y, w, h))
        x += w
        shelf = max(shelf, h)
    return placed, y + shelf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args()

    art = []
    for name, pack, entry, index in PIECES:
        picture = decode(args.client, pack, entry, index)
        art.append((name, picture, pack, entry, index))
        print(f"{name:12s} {entry:44s} {picture.width:4d}x{picture.height:<4d}")

    spots, height = shelf_pack([(p.width, p.height) for _, p, _, _, _ in art], SHELF_W)
    sheet = Image.new("RGBA", (SHELF_W, height), (0, 0, 0, 0))
    rects = {}
    for (name, picture, pack, entry, index), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(picture, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h,
                       "pack": pack, "entry": entry, "frame": index}

    if args.table:
        print("\n    pieces: {")
        for name in rects:
            r = rects[name]
            print(f'      {name}: [{r["x"]}, {r["y"]}, {r["w"]}, {r["h"]}],')
        print("    },")
        return

    if args.preview:
        target = ROOT / "assets" / "dnf_src" / "forest-preview.png"
        back = Image.new("RGBA", sheet.size, (26, 26, 32, 255))
        draw = ImageDraw.Draw(back)
        for step in range(0, max(sheet.size), 40):
            draw.line([(step, 0), (step, sheet.height)], fill=(44, 44, 52, 255))
            draw.line([(0, step), (sheet.width, step)], fill=(44, 44, 52, 255))
        back.alpha_composite(sheet)
        for name, r in rects.items():
            draw.rectangle([r["x"], r["y"], r["x"] + r["w"] - 1, r["y"] + r["h"] - 1],
                           outline=(255, 224, 120, 255))
            draw.text((r["x"] + 3, r["y"] + 3), name, fill=(255, 224, 120))
        target.parent.mkdir(parents=True, exist_ok=True)
        back.save(target)
        print(f"preview -> {target} ({back.size[0]}x{back.size[1]})")
        return

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({"sheet": {"w": sheet.width, "h": sheet.height},
                                "pieces": rects}, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    print(f"{len(rects)} pieces -> {OUT} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
