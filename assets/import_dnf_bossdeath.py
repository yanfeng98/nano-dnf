#!/usr/bin/env python3
"""Bake 牛头巨兽's death pieces into `assets/bossdeath.png`.

The client's `sprite_monster_tau.NPK :: sprite/monster/tau/metacowpiece.img` is
the boss's own five-piece meat/chunk art: a large brown slab, a dark piece and
three smaller pieces.  These are the shapes the reference's boss death leaves on
the floor (docs/adr/0034 追记二) - the generic `splashbloodlarge` chunks read as
flat blood, not as pieces of the beast.

    python3 assets/import_dnf_bossdeath.py --client "/home/luyanfeng/dnf-client/地下城与勇士"
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

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK = "sprite_monster_tau.NPK"
ENTRY = "sprite/monster/tau/metacowpiece.img"
FRAMES = 5
GUTTER = 1


def frame_image(img, index: int) -> Image.Image:
    frame = img.images[index]
    while type(frame).__name__ == "ImageLink":
        frame = img.images[frame.index]
    raw = frame.data
    if raw[:4] == b"DDS ":
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    from pydnfex.img.image.format import FormatConvertor
    from pydnfex.util import image as image_util

    try:
        raw = FormatConvertor.to_raw(raw, frame.format)
    except Exception:
        pass
    return image_util.load_raw(raw, frame.w, frame.h).convert("RGBA")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()
    with open(args.client / "ImagePacks2" / PACK, "rb") as handle:
        npk = NPK.open(handle)
        data = None
        for item in npk.files:
            if item.name.replace("\\", "/") == ENTRY:
                data = bytes(item.data)
                break
    if data is None:
        raise SystemExit(f"{ENTRY} not found in {PACK}")
    img = IMGFactory.open(io.BytesIO(data))
    pieces = []
    for index in range(FRAMES):
        picture = frame_image(img, index)
        ink = picture.getbbox()
        if ink is None:
            raise SystemExit(f"frame {index} is empty")
        pieces.append(picture.crop(ink))
    width = sum(piece.width for piece in pieces) + GUTTER * (len(pieces) - 1)
    height = max(piece.height for piece in pieces)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    spots = []
    x = 0
    for piece in pieces:
        sheet.alpha_composite(piece, (x, 0))
        spots.append([x, 0, piece.width, piece.height])
        x += piece.width + GUTTER
    target = ROOT / "assets" / "bossdeath.png"
    sheet.save(target)
    meta = ROOT / "assets" / "dnf_src" / "bossdeath.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"cell": [width, height], "frames": spots}, indent=2) + "\n")
    print(f"wrote {target} ({width}x{height})")
    print("BOSSPIECE frames for src/render.js:")
    for spot in spots:
        print(f"  [{spot[0]}, {spot[1]}, {spot[2]}, {spot[3]}],")
    return 0


if __name__ == "__main__":
    sys.exit(main())
