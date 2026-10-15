#!/usr/bin/env python3
"""Bake the interface art 幽暗密林 needs out of the DNF client into one sheet.

**Why these pieces and not others.** Everything here answers a frame of the
owner's recording (`dnf-dungeon-videos/00001-幽暗密林.mp4`) that this game did
not have yet: the cutscene before the first room (54.0-55.9 s), the two-line
stage title floating in it, the champion aura around a 咒之赤哥布林, the green
foot marker under the Slayer, the letter grade on the 战绩 panel and the red
chest the 奖励 screen opens. `docs/adr/0042` records what each one is for.

**Two things the client does NOT have**, both worth knowing before looking for
them again:

- **the decorated frame around the cutscene.** The recording's illustration sits
  in a carved wooden border; this client's `cutscene/lorien.img` is a plain
  800x600 picture with no border, and a size scan over all 639 images larger
  than 500x380 finds nothing frame-shaped. The border belongs to the map-select
  UI of the client the recording was made on. So we bake the picture the
  recording is *of* and leave the border off rather than draw one in.
- **the ground nameplate's box.** The recording drops a small rounded plate with
  an item's name in it; this client draws that plate in code (`Enter 掉落物名牌
  / 浮字`), so there is nothing to bake. `src/render.js` draws our own.

**Frames line up by their own anchor, not by their ink.** A `tile`/`obj` bake
crops to the ink because the game places each one from its own box; an animation
cannot do that - the title's 14 frames are three different sizes and the glow
has to stay put. So a run of frames goes into one **fixed cell** and every frame
is placed so its `.img` anchor lands on the same point of that cell, exactly the
way the client would have drawn it.

    python3 assets/import_dnf_ui.py             # write assets/ui.png
    python3 assets/import_dnf_ui.py --preview   # labelled contact sheet
    python3 assets/import_dnf_ui.py --table     # the rect table, as JS
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_monsters import key_black  # noqa: E402
from import_dnf_scene import decode, decode_at, offset_of, shelf_pack  # noqa: E402

from pydnfex.img.version import IMGFactory  # noqa: E402
from pydnfex.npk import NPK  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "ui.png"
META = ROOT / "assets" / "dnf_src" / "ui.json"

CUTSCENE = "sprite_map_cutscene.NPK"
TITLE = "sprite_map_title.NPK"
BREAK = "sprite_map_breakableobject.NPK"
ETC = "sprite_common_etc.NPK"
CHAMP = "sprite_monster_common.NPK"
COMBO = "sprite_interface2_ui_comboeffect.NPK"

# (name, pack, entry, first frame, how many, what the run is). A count of 1 is a
# still. `champdark`/`champdarkback` are one animation in two layers: the back
# one is drawn behind the monster and the front one over it.
RUNS = [
    ("cutscene", CUTSCENE, "sprite/map/cutscene/lorien.img", 0, 1,
     "进副本前那张过场插画（800x600，客户端里没有画框）"),
    ("stageTitle", TITLE, "sprite/map/title/mirkwood.img", 0, 14,
     "关卡名两行大字：`幽暗密林` + `Gran-Floris 格兰之森`，14 帧是发光脉动"),
    ("champdark", CHAMP, "sprite/monster/common/champdark.img", 0, 16,
     "冠军怪的紫光环（正面层）——录像里 `咒之赤哥布林` 身上那一圈"),
    ("champdarkback", CHAMP, "sprite/monster/common/champdarkback.img", 0, 12,
     "同一圈光环的背面层，画在怪身后"),
    ("champfire", CHAMP, "sprite/monster/common/champfire.img", 0, 16,
     "同一族里**火**属性的那一圈 —— 录像里 `燃烧之投掷哥布林` 用的就是它"),
    ("champfireback", CHAMP, "sprite/monster/common/champfireback.img", 0, 12,
     "火光环的背面层"),
    ("dropMark", ETC, "sprite/common/etc/movedestinationmark.img", 0, 6,
     "他脚下的亮绿色椭圆（只有玩家有，怪没有）"),
    ("chestOpen", BREAK, "sprite/map/breakableobject/treasurebox.img", 0, 3,
     "地图里的红木金边宝箱：合盖 → 掀盖 → 全开"),
    ("rank", COMBO, "sprite/interface2/ui/comboeffect/dungeon_rank.img", 0, 17,
     "评级字母：白/彩两套 SSS..F，末帧是爆闪"),
    ("scoreDigit", COMBO, "sprite/interface2/ui/comboeffect/dungeon_score.img", 0, 10,
     "评分那几行用的黄色数字 0-9"),
    ("rewardChest", "sprite_interface2_reward_ver2.0.NPK",
     "sprite/interface2/reward_ver2.0/reward_ver2.img", 36, 1,
     "结算 `奖励` 那一页的宝箱卡面（153x97，满箱金币）"),
]


def decode_run(client: pathlib.Path, pack: str, entry: str, first: int, count: int):
    """[(rgba, ax, ay)] for `count` frames from `first`, each with its anchor.

    The anchor is the frame's own `(x, y)` - where its bitmap is drawn in the
    shared space of the `.img` - which is what lines a run up (see the module
    docstring). A link frame carries no offset of its own, so it follows the
    frame it points at.
    """
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            picked = []
            # clamp to what the .img actually has - a colour sibling of an aura
            #    need not carry the same number of frames as the one next to it.
            count = min(count, len(img.images) - first)
            for index in range(first, first + count):
                frame = img.images[index]
                picture = img.build(frame).convert("RGBA")
                """Some `.img`s are drawn on an opaque black backdrop and
                some carry their own alpha, and which is which differs per pack:
                the foot marker and the champion aura are backdrop ones, the
                title and the rank letters are not. A corner that is opaque and
                black is the tell, and keying it is the same rule the monster
                bake uses - guessing per run would have punched holes in art
                that is legitimately dark.
                """
                corner = picture.getpixel((0, 0))
                if corner[3] > 200 and corner[0] < 26 and corner[1] < 26 and corner[2] < 26:
                    picture = key_black(picture)
                ax, ay = offset_of(frame)
                picked.append((picture, ax, ay))
            return picked
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def cell(frames):
    """One fixed cell holding a run, plus where the run's ink sits in it.

    Frame `i` is drawn at `anchor - its own offset`, with the anchor being
    wherever the `.img`'s shared origin falls - so the cell is simply the box
    the run occupies in that shared space and nothing has to be hand-tuned.
    Frame `i` is at `(anchor_x - fx, anchor_y - fy)`; the cell has to reach
    `anchor + (width - offset)`, because the offsets run the other way.

    `ink` is the box the *art* covers across all frames, in cell coordinates:
    the title wants its centre on a point of the screen and the foot marker
    wants its own centre under a pair of feet, and neither of those is the
    shared origin.
    """
    ax = max(0, max(fx for _, fx, _ in frames))
    ay = max(0, max(fy for _, _, fy in frames))
    width = ax + max(p.width - fx for p, fx, _ in frames)
    height = ay + max(p.height - fy for p, _, fy in frames)
    run = []
    for picture, fx, fy in frames:
        art = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        art.alpha_composite(picture, (ax - fx, ay - fy))
        run.append(art)
    spot = None
    for art in run:
        box = art.getbbox()
        if box is None:
            continue
        spot = box if spot is None else (
            min(spot[0], box[0]), min(spot[1], box[1]),
            max(spot[2], box[2]), max(spot[3], box[3]),
        )
    ink = [0, 0, 0, 0] if spot is None else [
        spot[0], spot[1], spot[2] - spot[0], spot[3] - spot[1],
    ]
    return run, (width, height), (ax, ay), ink


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args()

    art = []
    meta = {}
    for name, pack, entry, first, count, note in RUNS:
        frames = decode_run(args.client, pack, entry, first, count)
        run, size, anchor, ink = cell(frames)
        for index, picture in enumerate(run):
            art.append((f"{name}{index}", picture, pack, entry, first + index))
        meta[name] = {
            "pack": pack, "entry": entry, "first": first, "frames": len(run),
            "cell": list(size), "anchor": list(anchor), "ink": ink, "note": note,
        }
        print(f"{name:14s} {entry:46s} {count:3d}f  cell {size[0]:4d}x{size[1]:<4d}"
              f"  ink [{ink[0]},{ink[1]},{ink[2]},{ink[3]}]")

    spots, height = shelf_pack([(p.width, p.height) for _, p, _, _, _ in art], 1600)
    sheet = Image.new("RGBA", (1600, height), (0, 0, 0, 0))
    rects = {}
    for (name, picture, pack, entry, index), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(picture, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h, "pack": pack,
                       "entry": entry, "frame": index}
    for name, block in meta.items():
        block["rects"] = [rects[f"{name}{i}"] for i in range(block["frames"])]

    if args.table:
        print("\n    /* generated by assets/import_dnf_ui.py --table - do not hand-edit */")
        for name, block in meta.items():
            print(f'    {name}: {{ cell: [{block["cell"][0]}, {block["cell"][1]}], '
                  f'anchor: [{block["anchor"][0]}, {block["anchor"][1]}], '
                  f'ink: [{block["ink"][0]}, {block["ink"][1]}, {block["ink"][2]}, '
                  f'{block["ink"][3]}], frames: [')
            for r in block["rects"]:
                print(f'      [{r["x"]}, {r["y"]}, {r["w"]}, {r["h"]}],')
            print("    ]},")
        return

    if args.preview:
        target = ROOT / "assets" / "dnf_src" / "ui-preview.png"
        zoom = 2
        out = sheet.resize((sheet.width * zoom, sheet.height * zoom), Image.NEAREST)
        draw = ImageDraw.Draw(out)
        for name, block in meta.items():
            r = block["rects"][0]
            draw.text((r["x"] * zoom, r["y"] * zoom + 2), name, fill=(255, 224, 120))
        target.parent.mkdir(parents=True, exist_ok=True)
        out.save(target)
        print(f"preview -> {target} ({out.size[0]}x{out.size[1]})")
        return

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({
        "sheet": {"w": sheet.width, "h": sheet.height},
        "runs": meta,
        "rects": rects,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(art)} frames in {len(meta)} runs -> {OUT} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
