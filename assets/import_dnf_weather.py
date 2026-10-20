#!/usr/bin/env python3
"""Bake the client's rain weather sprites into `assets/weather.png`.

The video's rain is a screen-space particle field (`docs/adr/0057`): the client
ships the art in `sprite_map.NPK` as

  sprite/map/rain.img       two 5x43 white streaks (the falling drops)
  sprite/map/raindrop.img   seven small frames (the splash where one lands)

Both are tiny, so they are packed into one sheet with a one-pixel gutter. The
rect table is printed for `src/render.js`'s `WEATHER` constant; the JSON copy
under `assets/dnf_src/` is only for reference (that directory is gitignored).

    python3 assets/import_dnf_weather.py --client "/home/luyanfeng/dnf-client/地下城与勇士"
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
PACK = "sprite_map.NPK"
PIECES = [
    ("rain0", "sprite/map/rain.img", 0),
    ("rain1", "sprite/map/rain.img", 1),
    ("raindrop0", "sprite/map/raindrop.img", 0),
    ("raindrop1", "sprite/map/raindrop.img", 1),
    ("raindrop2", "sprite/map/raindrop.img", 2),
    ("raindrop3", "sprite/map/raindrop.img", 3),
    ("raindrop4", "sprite/map/raindrop.img", 4),
    ("raindrop5", "sprite/map/raindrop.img", 5),
    ("raindrop6", "sprite/map/raindrop.img", 6),
]
GUTTER = 1


def decode_at(npk, entry: str, index: int) -> Image.Image:
    for item in npk.files:
        if item.name.replace("\\", "/") != entry:
            continue
        img = IMGFactory.open(io.BytesIO(bytes(item.data)))
        frame = img.images[index]
        while type(frame).__name__ == "ImageLink":
            frame = img.images[frame.index]
        raw = frame.data
        if raw[:4] != b"DDS ":
            from pydnfex.img.image.format import FormatConvertor
            from pydnfex.util import image as image_util

            try:
                raw = FormatConvertor.to_raw(raw, frame.format)
            except Exception:
                pass
            return image_util.load_raw(raw, frame.w, frame.h).convert("RGBA")
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    raise SystemExit(f"{entry} not found in {PACK}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()
    with open(args.client / "ImagePacks2" / PACK, "rb") as handle:
        npk = NPK.open(handle)
        art = [(name, decode_at(npk, entry, index)) for name, entry, index in PIECES]

    # shelf pack: rows of at most 256 px, one-pixel gutter between frames
    width = 0
    height = 0
    x = 0
    y = 0
    row_h = 0
    spots = {}
    for name, picture in art:
        if x and x + picture.width > 256:
            x = 0
            y += row_h + GUTTER
            row_h = 0
        spots[name] = [x, y, picture.width, picture.height]
        x += picture.width + GUTTER
        width = max(width, x)
        row_h = max(row_h, picture.height)
        height = max(height, y + row_h)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for name, picture in art:
        px, py = spots[name][0], spots[name][1]
        sheet.alpha_composite(picture, (px, py))

    target = ROOT / "assets" / "weather.png"
    sheet.save(target)
    meta = ROOT / "assets" / "dnf_src" / "weather.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"cell": [width, height], "pieces": spots}, indent=2) + "\n")
    print(f"wrote {target} ({width}x{height})")
    print("WEATHER pieces for src/render.js:")
    for name, _ in art:
        print(f"  {name}: [{spots[name][0]}, {spots[name][1]}, {spots[name][2]}, {spots[name][3]}],")
    return 0


if __name__ == "__main__":
    sys.exit(main())
