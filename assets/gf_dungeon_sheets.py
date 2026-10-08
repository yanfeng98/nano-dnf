#!/usr/bin/env python3
"""One labelled contact sheet per Gran-Floris dungeon.

Each sheet grids every frame of every asset found for that dungeon
(title banner, per-dungeon breakable props, slot icon), labelled with the
source pack + entry basename.

Usage: gf_dungeon_sheets.py <client_root> <outdir>
"""
import io
import sys
from pathlib import Path

from PIL import Image as PILImage, ImageDraw

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

# 关卡中文名 -> (codename, 备注)
DUNGEONS = [
    ("幽暗密林", "mirkwood", "草木：grass1/2mirkwood；路：granfloris*；BGM mirkwood.ogg"),
    ("幽暗密林深处", "mirkwooddeep", "无专属草木（沿用 mirkwood）"),
    ("冰霜幽暗密林", "mirkwoodfrost", "无专属草木；地图集 02 的 f 后缀=覆雪变体"),
    ("雷鸣废墟", "sunderland", "草木：grass1/2sunderland；BGM sunderland.ogg"),
    ("猛毒雷鸣废墟", "sunderlandpoison", "无专属草木（沿用 sunderland）"),
    ("格拉卡", "grakkarak", "草木：grass1/2grakkarak；BGM grakkarak_new.ogg"),
    ("烈焰格拉卡", "grakkarakburning", "无专属草木（沿用 grakkarak）"),
    ("暗黑雷鸣废墟", "sunderlanddark", "无专属草木（沿用 sunderland）"),
]

# (label, pack file under ImagePacks2, entry substring, max frames)
SOURCES = [
    ("title", "sprite_map_title.NPK", "title/{code}.img", 14),
    ("breakable", "sprite_map_breakableobject.NPK", "grass{1|2}{code}.img", 1),
    ("actiontree", "sprite_map_breakableobject_actiontreerenew.NPK", "actiontree1-{code}.img", 1),
    ("slot", "sprite_worldmap_selectdungeonslot.NPK", "selectdungeonslot/granfloris.img", 1),
]

SLOT_ORDER = ["mirkwood", "mirkwooddeep", "mirkwoodfrost", "sunderland",
              "sunderlandpoison", "grakkarak", "grakkarakburning", "sunderlanddark",
              "deadmoon"]

CAP = 15
COLS = 5
MAXW = 1900


def load_entry(npk_path, pred):
    """Return [(entry_basename, [PIL frames])] for entries matching pred."""
    out = []
    with open(npk_path, "rb") as h:
        npk = NPK.open(h)
        for entry in npk.files:
            if not pred(entry.name):
                continue
            img = IMGFactory.open(io.BytesIO(bytes(entry.data)))
            frames = [img.build(f) for f in img.images]
            out.append((entry.name.split("/")[-1].replace(".img", ""), frames))
    return out


def main():
    root = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    packs = {name: root / "ImagePacks2" / name for _, name, _, _ in SOURCES}

    slot = load_entry(packs["sprite_worldmap_selectdungeonslot.NPK"],
                      lambda n: n.endswith("selectdungeonslot/granfloris.img"))
    slot_frames = {code: [slot[0][1][i]] for i, code in enumerate(SLOT_ORDER)}

    for cn, code, note in DUNGEONS:
        cells = []  # (label, PIL frame)
        titles = load_entry(packs["sprite_map_title.NPK"],
                            lambda n, c=code: n == f"sprite/map/title/{c}.img")
        for base, frames in titles:
            for i, f in enumerate(frames):
                cells.append((f"title/{base} f{i}", f))
        for base, frames in load_entry(
                packs["sprite_map_breakableobject.NPK"],
                lambda n, c=code: n.split("/")[-1] in (f"grass1{c}.img", f"grass2{c}.img")):
            cells.append((f"breakableobject/{base}", frames[0]))
        for base, frames in load_entry(
                packs["sprite_map_breakableobject_actiontreerenew.NPK"],
                lambda n, c=code: n.split("/")[-1] == f"actiontree1-{c}.img"):
            for i, f in enumerate(frames):
                cells.append((f"actiontreerenew/{base} f{i}", f))
        for f in slot_frames.get(code, []):
            cells.append(("selectdungeonslot/granfloris", f))

        cell_h = max(f.height for _, f in cells) + CAP
        col_w = min(MAXW // COLS, max(f.width for _, f in cells) + 10)
        ncols = min(COLS, len(cells))
        rows = (len(cells) + ncols - 1) // ncols
        sheet = PILImage.new("RGB", (ncols * col_w, rows * cell_h + 40), (18, 18, 22))
        d = ImageDraw.Draw(sheet)
        d.text((6, 6), f"{cn}  [{code}]   {note}", fill=(255, 235, 150))
        for i, (label, f) in enumerate(cells):
            cx = (i % ncols) * col_w
            cy = 40 + (i // ncols) * cell_h
            d.text((cx + 3, cy + 2), label[:30], fill=(140, 220, 255))
            sheet.paste(f, (cx + 3, cy + CAP), f)
        path = out_dir / f"map-{code}-{cn}-overview.png"
        sheet.save(path)
        print(f"{path}  cells={len(cells)}  {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    main()
