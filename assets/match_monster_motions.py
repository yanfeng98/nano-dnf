#!/usr/bin/env python3
"""Put a monster on screen next to its own .img frames, for reading the actions.

**Why this exists.** A monster's `.img` holds every action in one run of frames -
stand, walk, attack, hurt, get up - and **which frame range belongs to which
action is not in the client**: it lives in the encrypted `Script.pvf` `.ani`
data, which cannot be read (`docs/granfloris-assets.md` 第一节). The only place
the boundary is observable is gameplay footage, where you can *see* the monster
walking and then *see* which pose it is in.

So this sheet carries two panels of the same thing at the same scale:

  top     the recording, cropped to the monster, one cell per video frame
  bottom  that monster's `.img`, every frame, indexed `f0..fN`

Read a pose off the top panel, find it in the bottom panel, write the index
down. A run of top cells that all resolve to one bottom index is one action, and
the boundaries between runs are the boundary you were looking for.

The `.img` frames are drawn at the same pixel scale as the recording (the client
draws monsters about 1:1), so the two panels can be compared directly.

    python3 assets/match_monster_motions.py \
        --pack sprite_monster_goblin.NPK --entry goblin/body0.img \
        --start 100 --end 102 --box 1300,430,260,300 --zoom 3 \
        --out assets/dnf_src/bilibili/mirkwood/match-goblin-body0.png
"""

from __future__ import annotations

import argparse
import io
import pathlib
import subprocess

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")


def img_frames(client: pathlib.Path, pack: str, entry: str) -> list[Image.Image]:
    """Every frame of one .img, black backdrop keyed out, in canvas order."""
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            out = []
            for index in range(len(img.images)):
                picture = img.build(img.images[index]).convert("RGBA")
                picture = key_black(picture)
                out.append(picture)
            return out
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def key_black(picture: Image.Image) -> Image.Image:
    """Drop the client's black backdrop - same rule import_dnf_effects.py uses."""
    pixels = picture.load()
    for y in range(picture.height):
        for x in range(picture.width):
            r, g, b, a = pixels[x, y]
            if a and r < 26 and g < 26 and b < 26:
                pixels[x, y] = (r, g, b, 0)
    return picture


def crop_art(picture: Image.Image) -> Image.Image:
    box = picture.getbbox()
    return picture.crop(box) if box else picture


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=pathlib.Path, required=True)
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--pack", required=True)
    ap.add_argument("--entry", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--box", required=True, help="x,y,w,h crop in video pixels")
    ap.add_argument("--zoom", type=int, default=3)
    ap.add_argument("--every", type=int, default=2)
    ap.add_argument("--grid", type=int, default=12)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    args = ap.parse_args()

    import tempfile

    x, y, w, h = (int(v) for v in args.box.split(","))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(args.start), "-to", str(args.end),
             "-i", str(args.video), "-vf", f"fps={args.fps}",
             str(pathlib.Path(tmp) / "f%05d.png")], check=True)
        shots = sorted(pathlib.Path(tmp).glob("f*.png"))[::args.every]
        # Convert inside the block: Image.open is lazy, and the frames have to
        # be read before TemporaryDirectory deletes them.
        cells = [Image.open(p).crop((x, y, x + w, y + h)).convert("RGB") for p in shots]

    art = [crop_art(p) for p in img_frames(args.client, args.pack, args.entry)]

    z = args.zoom
    cw, ch = w * z, h * z
    cols = args.grid
    rows = (len(cells) + cols - 1) // cols
    aw = max(p.width for p in art) * z + 8
    ah = max(p.height for p in art) * z + 20

    width = max(cw * cols, aw * min(len(art), cols))
    height = (ch + 18) * rows + ah * ((len(art) + cols - 1) // cols) + 30
    out = Image.new("RGB", (width, height), (18, 18, 22))
    draw = ImageDraw.Draw(out)

    draw.text((6, 4), f"录像 {args.pack}::{args.entry}  {args.start}-{args.end}s  "
                      f"每 {args.every} 帧一格（+t 是相对起点）", fill=(255, 224, 120))
    for i, cell in enumerate(cells):
        cx, cy = (i % cols) * cw, 26 + (i // cols) * (ch + 18)
        out.paste(cell.resize((cw, ch), Image.NEAREST), (cx, cy + 14))
        draw.text((cx + 3, cy + 1), f"+{i * args.every / args.fps:.2f}s", fill=(160, 220, 255))

    base = 26 + rows * (ch + 18) + 10
    draw.text((6, base - 14), "客户端 .img 全部帧（同一个尺度）", fill=(255, 224, 120))
    for i, picture in enumerate(art):
        cell = picture.resize((picture.width * z, picture.height * z), Image.NEAREST)
        cx, cy = (i % cols) * aw, base + (i // cols) * ah
        out.paste(cell, (cx + 4, cy + 16))
        draw.text((cx + 3, cy + 2), f"f{i}", fill=(255, 200, 140))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print(f"{len(cells)} video cells + {len(art)} art frames -> {args.out} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    main()
