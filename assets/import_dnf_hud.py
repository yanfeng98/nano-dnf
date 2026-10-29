#!/usr/bin/env python3
"""Bake the combat HUD pieces out of the DNF client into `assets/hud.png`.

The recording's HUD is the client's 800x600 layout at **x1.8** (measured
2026-10-24: bottom bar 800x91 -> 1440x164, slot 40x39 -> 72x70, orb 56x56 ->
~101 px).  We bake the client pieces at their own size and let `render.js`
place them at the recording's rectangles.

    python3 assets/import_dnf_hud.py --client /home/luyanfeng/dnf-client/地下城与勇士
    python3 assets/import_dnf_hud.py --table
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_ui import cell, decode_run  # noqa: E402
from import_dnf_scene import shelf_pack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "hud.png"
META = ROOT / "assets" / "dnf_src" / "hud.json"

HUD = "sprite_interface2_hud.NPK"
IFACE = "sprite_interface.NPK"
QUEST = "sprite_interface2_quest_mission.NPK"

# (name, pack, entry, first frame, count, note)
RUNS = [
    ("hudBar", HUD, "sprite/interface2/hud/hud.img", 0, 1,
     "底部主 HUD 条 800x91（录像 1440x164 的来源）"),
    ("orbRed", HUD, "sprite/interface2/hud/hud.img", 1, 1,
     "红 HP 球液体 56x56"),
    ("orbBlue", HUD, "sprite/interface2/hud/hud.img", 2, 1,
     "蓝 MP 球液体 56x56"),
    ("slotFrame", IFACE, "sprite/interface/mainhud.img", 77, 1,
     "技能/物品槽框 40x39（录像 72x70）"),
    ("menu", HUD, "sprite/interface2/hud/menu_icon.img", 1, 1,
     "中央圆形菜单 65x65（录像约 117px）"),
    ("quest", QUEST, "sprite/interface2/quest/mission/mission.img", 0, 1,
     "任务追踪底板 154x52"),
    ("chat", IFACE, "sprite/interface/chatting.img", 0, 1,
     "旧式聊天框底板 317x146"),
]


def capsule(picture, width, extension=68):
    """Keep round end caps, extend their centre; all pixels come from the client.

    Bake at 2x canvas size. Socket and liquid use the SAME .675 scale and
    34px canvas extension, so their rims cannot drift independently.
    """
    scaled = picture.resize((width, width), Image.Resampling.NEAREST)
    half = width // 2
    out = Image.new("RGBA", (width, width + extension))
    out.paste(scaled.crop((0, 0, width, half)), (0, 0))
    out.paste(scaled.crop((0, half, width, half + 1)).resize((width, extension)), (0, half))
    out.paste(scaled.crop((0, half, width, width)), (0, half + extension))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args()

    art = []
    meta = {}
    for name, pack, entry, first, count, note in RUNS:
        source = pack
        if not (args.client / "ImagePacks2" / pack).exists():
            legacy = args.client / "ImagePacks2_70" / pack
            if legacy.exists():
                source = "../ImagePacks2_70/" + pack
        frames = decode_run(args.client, source, entry, first, count)
        run, size, anchor, ink = cell(frames)
        if name in ("orbRed", "orbBlue"):
            run = [capsule(picture, 76) for picture in run]
            size = run[0].size
            anchor = (0, 0)
            ink = run[0].getbbox()
        for index, picture in enumerate(run):
            art.append((f"{name}{index}", picture, pack, entry, first + index))
        meta[name] = {
            "pack": source, "entry": entry, "first": first, "frames": len(run),
            "cell": list(size), "anchor": list(anchor), "ink": ink, "note": note,
        }
        print(f"{name:10s} {entry:48s} {count:2d}f  cell {size[0]:4d}x{size[1]:<4d}"
              f"  ink [{ink[0]},{ink[1]},{ink[2]},{ink[3]}]")

    bar = next(picture for name, picture, *_ in art if name == "hudBar0")
    for name, box in [("socketLeft", (0, 0, 80, 80)),
                      ("socketRight", (720, 0, 800, 80))]:
        picture = capsule(bar.crop(box), 108)
        art.append((name + "0", picture, HUD, "sprite/interface2/hud/hud.img", 0))
        meta[name] = {"pack": HUD, "entry": "sprite/interface2/hud/hud.img", "first": 0,
                      "frames": 1, "cell": list(picture.size), "anchor": [0, 0],
                      "ink": list(picture.getbbox()),
                      "note": "client socket end caps extended with same transform as liquid"}

    width = 1600
    spots, height = shelf_pack([(p.width, p.height) for _, p, _, _, _ in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, picture, pack, entry, index), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(picture, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h, "pack": pack,
                       "entry": entry, "frame": index}
    for name, block in meta.items():
        block["rects"] = [rects[f"{name}{i}"] for i in range(block["frames"])]

    if args.table:
        print("\n    /* generated by assets/import_dnf_hud.py --table - do not hand-edit */")
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
        target = ROOT / "assets" / "dnf_src" / "hud-preview.png"
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
