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
MONSTER = "sprite_monster_common.NPK"

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
    # The way out of a room: **one gate per direction** (`docs/adr/0030`), and
    # the client already has all three - a side gate you walk through left/right,
    # an `up` gate that stands on the floor's far edge, and a `down` gate that
    # lies on the floor in front of you. Family 02 is the set's own family, the
    # same one the room art comes from.
    ("gate",     GATE, "sprite/map/pathgate/granflorissidegate02.img", 0),
    ("gateUp",   GATE, "sprite/map/pathgate/granflorisupgate02.img", 0),
    ("gateDown", GATE, "sprite/map/pathgate/granflorisdowngate02.img", 0),
    # ...and the door that stands *in* a gate while the room is not cleared: the
    # client's own barred leaf, one per direction, drawn at its own offset.
    ("door",     GATE, "sprite/map/pathgate/granflorissidedoor02.img", 0),
    ("doorUp",   GATE, "sprite/map/pathgate/granflorisupdoor02.img", 0),
    ("doorDown", GATE, "sprite/map/pathgate/granflorisdowndoor02.img", 0),
    # The barrel: the client's own breakable, and **frame 0 only**. The twelve
    # frames that follow are the pieces it breaks into; they are baked below,
    # with the offsets they fly to (`BARREL_*`).
    ("barrel", BREAK, "sprite/map/breakableobject/barrel.img", 0),
    # 怪物死的两样东西，都是客户端的（`docs/adr/0031`）。
    #
    # 1) **白烟**：`monsterdieblood` —— 一团**白色的不规则云**。客户端把它当"白色形状、
    #    颜色由引擎挑"用（`tinted()` 那条注释说的就是这一类东西），死亡这里它就是白的。
    #    录像里普通怪死就是几片这样的白团撒在尸体上、0.35-0.6 秒散掉，尸体随烟一起没。
    # 2) 青白色的圆爆：`monsterdieflash`，白核 + 青边（采样 (255,255,255) 核心、
    #    (1,145,255) 外环）。一帧，亮 0.1-0.3 秒、最大 129x83 游戏像素 —— 但**不是每只
    #    怪都有**：录像六次击杀里只拍到一次（那只是带诅咒的哥布林），所以留给了精英与 Boss。
    #
    # 这里曾经还烘过三块 `hiteffect/bloodlarge` 的"红肉块"，已经删掉：录像里那些红球
    # 是**怪掉在地上的东西**（怪死时从尸体里飞出来的掉落物，有高光、有名字条），
    # 不是血 —— 地上、尸体上都不留任何红的。
    ("deathSmoke", MONSTER, "sprite/monster/common/monsterdieblood.img", 0),
    ("deathBurst", MONSTER, "sprite/monster/common/monsterdieflash.img", 0),
]

# 木桶碎开的那 12 帧。客户端把 13 帧摆在同一格里，每帧带自己的 (x, y)；烘成"照 ink 裁"
# 之后要画得叠得回去，就得知道每帧相对**第 0 帧**的偏移 —— 那是量出来的，写在下面这张
# 表里，跟着 manifest 一起出去（`src/render.js` SCENE.barrelBreak）。
BARREL_ENTRY = "sprite/map/breakableobject/barrel.img"
BARREL_PIECES = 12

SHELF_W = 1280


def offset_of(frame) -> tuple[int, int]:
    if hasattr(frame, "x"):
        return frame.x, frame.y
    final = getattr(frame, "final_image", None)
    if final is not None and hasattr(final, "x"):
        return final.x, final.y
    return 0, 0


def tinted(picture: Image.Image, colour) -> Image.Image:
    """A white mask, washed to one colour.

    The client stores a few things as a **white shape whose colour the engine
    picks at draw time** - `monsterdieblood` is one, the room gates' lights are
    another. Baking the colour in keeps `src/render.js` drawing plain images and
    keeps the tint itself reviewable in the sheet.
    """
    out = picture.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            pixels[x, y] = (round(r * colour[0] / 255), round(g * colour[1] / 255),
                            round(b * colour[2] / 255), a)
    return out


def decode_at(client: pathlib.Path, pack: str, entry: str, frame_index: int, tint=None):
    """(the art cropped to its ink, that ink's top-left in the frame's own space).

    The offset is what a *group* of frames needs to line up again once each has
    been cropped on its own - the barrel's break pieces are the reason.
    """
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            frame = img.images[frame_index]
            full = img.build(frame).convert("RGBA")
            if tint is not None:
                full = tinted(full, tint)
            spot = full.getbbox()
            if spot is None:
                return full, offset_of(frame)
            # 落在**帧自己那个空间**里的位置：帧的锚点偏移 + ink 在画布里的位置。
            # 两个都要加 —— 光有画布里的 bbox 会永远得到 (0, 0)。
            anchor = offset_of(frame)
            return full.crop(spot), (anchor[0] + spot[0], anchor[1] + spot[1])
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def decode(client: pathlib.Path, pack: str, entry: str, frame_index: int):
    return decode_at(client, pack, entry, frame_index)[0]


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
    for piece in PIECES:
        name, pack, entry, index = piece[:4]
        tint = piece[4] if len(piece) > 4 else None
        picture, _at = decode_at(args.client, pack, entry, index, tint)
        art.append((name, picture, pack, entry, index))
        print(f"{name:12s} {entry:44s} {picture.width:4d}x{picture.height:<4d}")

    # The barrel's twelve break frames, and where each one flies to. The offset
    # is `this frame's ink corner - frame 0's ink corner`, both read in the
    # frame's own space, so the renderer can stack the pieces back onto the
    # whole barrel it just replaced.
    base = decode_at(args.client, BREAK, BARREL_ENTRY, 0)[1]
    break_at = []
    for index in range(1, BARREL_PIECES + 1):
        picture, at = decode_at(args.client, BREAK, BARREL_ENTRY, index)
        name = f"barrel{index}"
        break_at.append({"piece": name, "dx": at[0] - base[0], "dy": at[1] - base[1]})
        art.append((name, picture, BREAK, BARREL_ENTRY, index))
        print(f"{name:12s} {BARREL_ENTRY:44s} {picture.width:4d}x{picture.height:<4d}")

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
        print("\n    /* [piece, dx, dy] - see barrelBreak in src/render.js */")
        print("    barrelBreak: [")
        for item in break_at:
            print(f'      ["{item["piece"]}", {item["dx"]}, {item["dy"]}],')
        print("    ],")
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
