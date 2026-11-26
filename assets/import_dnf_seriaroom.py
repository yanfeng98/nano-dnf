#!/usr/bin/env python3
"""Bake Seria's Room (赛丽亚的房间) and authentic Hendon Myre NPC sprites out of the DNF 70-era client.

Extracts:
- `sprite_map.NPK`: `gateback.img`, `gatestorage.img`, `postbox.img`, `gatepillar.img`
- `sprite_map_npc.NPK`:
  - `npc_dj1.img` (火罐, 4 frames)
  - `npc_or.img` (奥兰, 6 idle frames)
  - `npc_pj.img` (风振, 4 frames)

Usage:
    python3 assets/import_dnf_seriaroom.py
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

from PIL import Image
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import shelf_pack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "seriaroom.png"
META = ROOT / "assets" / "dnf_src" / "seriaroom.json"


def load_npk_entries(client: pathlib.Path, npk_name: str) -> dict[str, bytes]:
    for folder in ("ImagePacks2_70", "ImagePacks2"):
        npk_path = client / folder / npk_name
        if npk_path.exists():
            with open(npk_path, "rb") as f:
                npk = NPK.open(f)
                npk.load_all()
                return {e.name.replace("\\", "/").split("/")[-1]: e.data for e in npk.files}
    raise SystemExit(f"{npk_name} not found under {client}")


def decode_frame(entries: dict[str, bytes], filename: str, frame_index: int, crop: bool = True) -> Image.Image:
    if filename not in entries:
        raise SystemExit(f"{filename} not found")
    img = IMGFactory.open(io.BytesIO(entries[filename]))
    pil = img.build(img.images[frame_index]).convert("RGBA")
    if crop:
        bbox = pil.getbbox()
        if bbox:
            pil = pil.crop(bbox)
    return pil


def bake_seriaroom(client: pathlib.Path) -> None:
    map_entries = load_npk_entries(client, "sprite_map.NPK")
    npc_entries = load_npk_entries(client, "sprite_map_npc.NPK")

    art: list[tuple[str, Image.Image]] = [
        ("gateback", decode_frame(map_entries, "gateback.img", 0, crop=False)),
        ("gatestorage", decode_frame(map_entries, "gatestorage.img", 6, crop=True)),
        ("postbox", decode_frame(map_entries, "postbox.img", 0, crop=True)),
        ("gatepillar", decode_frame(map_entries, "gatepillar.img", 0, crop=True)),
    ]

    # Fire Pot (火罐) - npc_dj1.img (4 frames)
    for i in range(4):
        art.append((f"firepot_{i}", decode_frame(npc_entries, "npc_dj1.img", i, crop=False)))

    # Oran (奥兰) - npc_or.img (6 idle frames)
    for i in range(6):
        art.append((f"oran_{i}", decode_frame(npc_entries, "npc_or.img", i, crop=False)))

    # Feng Zhen (风振) - npc_pj.img (4 frames)
    for i in range(4):
        art.append((f"fengzhen_{i}", decode_frame(npc_entries, "npc_pj.img", i, crop=False)))

    # Authentic Seria (赛丽亚) - npc_se.img (6 idle frames)
    for i in range(6):
        art.append((f"seria_{i}", decode_frame(npc_entries, "npc_se.img", i, crop=False)))

    width = 1024
    spots, height = shelf_pack([(im.width, im.height) for _, im in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, im), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(im, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h}

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(
        json.dumps({"sheet": {"w": sheet.width, "h": sheet.height}, "rects": rects}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"seriaroom: {len(art)} pieces -> {OUT} ({sheet.width}x{sheet.height})")
    for name, r in rects.items():
        print(f"  {name:14s}: [{r['x']:4d}, {r['y']:4d}, {r['w']:4d}, {r['h']:4d}]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = ap.parse_args()
    bake_seriaroom(args.client)


if __name__ == "__main__":
    main()
