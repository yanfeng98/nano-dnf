#!/usr/bin/env python3
"""Bake the town and its NPCs out of the DNF client.

Town art comes from `sprite_map_grenselos.NPK` (the Gran Floris town set:
far/mid/tile, houses, trees, walls, props); the gate is borrowed from the
Elvengard set in `sprite_map.NPK`, because Grenselos has no door. NPCs come
from `sprite_map_npc.NPK`. Sizes/entries were measured 2026-10-24 while
checking what the town could be built from (`docs/adr/0065`).

    python3 assets/import_dnf_town.py --client /home/luyanfeng/dnf-client/地下城与勇士
    python3 assets/import_dnf_town.py --preview
    python3 assets/import_dnf_town.py --npc --table
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at, shelf_pack  # noqa: E402
from import_dnf_ui import cell, decode_run  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/home/luyanfeng/dnf-client/地下城与勇士")
TOWN = "sprite_map_grenselos.NPK"
MAP = "sprite_map.NPK"
NPC = "sprite_map_npc.NPK"
OUT = ROOT / "assets" / "town.png"
META = ROOT / "assets" / "dnf_src" / "town.json"
NPC_OUT = ROOT / "assets" / "npc.png"
NPC_META = ROOT / "assets" / "dnf_src" / "npc.json"

# Static pieces: name, pack, entry. `decode_at` crops to ink and keeps the
# frame-space offset; the renderer places each picture from its own base.
STATIC = [
    ("far", TOWN, "sprite/map/grenselos/far.img"),
    ("mid", TOWN, "sprite/map/grenselos/mid.img"),
    ("tile", TOWN, "sprite/map/grenselos/grtile.img"),
    ("house1", TOWN, "sprite/map/grenselos/house1.img"),
    ("house2", TOWN, "sprite/map/grenselos/house2.img"),
    ("house3", TOWN, "sprite/map/grenselos/house3.img"),
    ("house4", TOWN, "sprite/map/grenselos/house4.img"),
    ("house5", TOWN, "sprite/map/grenselos/house5.img"),
    ("house6", TOWN, "sprite/map/grenselos/house6.img"),
    ("brleft", TOWN, "sprite/map/grenselos/brleft.img"),
    ("brright", TOWN, "sprite/map/grenselos/brright.img"),
    ("brrightblock", TOWN, "sprite/map/grenselos/brrightblock.img"),
    ("wall01", TOWN, "sprite/map/grenselos/wall01.img"),
    ("wall02", TOWN, "sprite/map/grenselos/wall02.img"),
    ("wallleft", TOWN, "sprite/map/grenselos/wallleft.img"),
    ("wallright", TOWN, "sprite/map/grenselos/wallright.img"),
    ("tree1", TOWN, "sprite/map/grenselos/tree1.img"),
    ("tree2", TOWN, "sprite/map/grenselos/tree2.img"),
    ("pole1", TOWN, "sprite/map/grenselos/telegraphpole1.img"),
    ("pole2", TOWN, "sprite/map/grenselos/telegraphpole2.img"),
    ("pole3", TOWN, "sprite/map/grenselos/telegraphpole3.img"),
    ("sandbag1", TOWN, "sprite/map/grenselos/sandbag1.img"),
    ("sandbag2", TOWN, "sprite/map/grenselos/sandbag2.img"),
    ("crate1", TOWN, "sprite/map/grenselos/woodenboxpile1.img"),
    ("crate2", TOWN, "sprite/map/grenselos/woodenboxpile2.img"),
    ("gravelLarge", TOWN, "sprite/map/grenselos/gravellarge.img"),
    ("gravelMid", TOWN, "sprite/map/grenselos/gravelmid.img"),
    ("gravelSmall", TOWN, "sprite/map/grenselos/gravelsmall.img"),
    ("seriaHouse", MAP, "sprite/map/egseriahouse.img"),
    ("gate", MAP, "sprite/map/elvensgate.img"),
]

# Animated pieces: name, pack, entry, first, count, note.
RUNS = [
    ("gateDoor", MAP, "sprite/map/gatedoor.img", 0, 10, "城门门扇动画"),
    ("gateLight", MAP, "sprite/map/gatelight.img", 0, 10, "城门灯光动画"),
]

# The eight town NPCs (`docs/adr/0065`).
NPCS = [
    ("seria", "sprite/map/npc/npc_sr.img", "主线任务：赛丽亚"),
    ("minet", "sprite/map/npc/npc_minet.img", "支线任务 1：敏泰"),
    ("gsd", "sprite/map/npc/npc_gsd.img", "支线任务 2：GSD"),
    ("kanna", "sprite/map/npc/kanna.img", "商店：卡妮娜"),
    ("brownie", "sprite/map/npc/npc_brownie.img", "仓库/重置：布兰妮"),
    ("sinda", "sprite/map/npc/npc_sin.img", "铁匠/分解：辛达"),
    ("guard", "sprite/map/npc/npc_guardian.img", "装饰：守卫"),
    ("guardCaptain", "sprite/map/npc/npc_guardian_captin.img", "装饰：守卫队长"),
]


def bake_town(client: pathlib.Path):
    art = []
    pieces = {}
    for name, pack, entry in STATIC:
        picture, offset = decode_at(client, pack, entry, 0)
        art.append((name, picture, 1))
        pieces[name] = {
            "pack": pack, "entry": entry, "size": list(picture.size),
            "offset": list(offset),
        }
    runs = {}
    for name, pack, entry, first, count, note in RUNS:
        frames = decode_run(client, pack, entry, first, count)
        run, size, anchor, ink = cell(frames)
        for index, picture in enumerate(run):
            art.append((f"{name}{index}", picture, 1))
        runs[name] = {
            "pack": pack, "entry": entry, "first": first, "frames": len(run),
            "cell": list(size), "anchor": list(anchor), "ink": ink, "note": note,
        }

    width = 1600
    spots, height = shelf_pack([(p.width, p.height) for _, p, _ in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, picture, _), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(picture, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h}
    for name, block in pieces.items():
        block["rect"] = rects[name]
    for name, block in runs.items():
        block["rects"] = [rects[f"{name}{i}"] for i in range(block["frames"])]
        block["cells"] = [rects[f"{name}{i}"] for i in range(block["frames"])]
    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({
        "sheet": {"w": sheet.width, "h": sheet.height},
        "pieces": pieces, "runs": runs, "rects": rects,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"town: {len(art)} frames -> {OUT} ({sheet.size[0]}x{sheet.size[1]})")


def bake_npcs(client: pathlib.Path):
    art = []
    meta = {}
    for name, entry, note in NPCS:
        frames = decode_run(client, NPC, entry, 0, 60)
        run, size, anchor, ink = cell(frames)
        for index, picture in enumerate(run):
            art.append((f"{name}{index}", picture))
        meta[name] = {
            "pack": NPC, "entry": entry, "first": 0, "frames": len(run),
            "cell": list(size), "anchor": list(anchor), "ink": ink, "note": note,
        }
    width = 1600
    spots, height = shelf_pack([(p.width, p.height) for _, p in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, picture), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(picture, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h}
    for name, block in meta.items():
        block["rects"] = [rects[f"{name}{i}"] for i in range(block["frames"])]
    sheet.save(NPC_OUT)
    NPC_META.parent.mkdir(parents=True, exist_ok=True)
    NPC_META.write_text(json.dumps({
        "sheet": {"w": sheet.width, "h": sheet.height},
        "runs": meta, "rects": rects,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"npc: {len(art)} frames -> {NPC_OUT} ({sheet.size[0]}x{sheet.size[1]})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--table", action="store_true")
    ap.add_argument("--npc", action="store_true")
    args = ap.parse_args()

    if args.npc:
        bake_npcs(args.client)
        return
    bake_town(args.client)


if __name__ == "__main__":
    main()
