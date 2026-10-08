#!/usr/bin/env python3
"""Cut a strip of consecutive video frames, cropped and zoomed, to read an action.

The client's `.img` files hold every action in one run of frames (stand, walk,
attack, hurt, get up) and the boundaries live in the encrypted Script.pvf, so
the only place the boundary is *observable* is gameplay footage. This cuts a
window of the recording into a labelled strip you can put next to a `.img`
frame strip and read off which frames the game plays for which action.

    python3 assets/gf_video_strip.py <video> --start 100 --end 101.5 \
        --box 1300,430,220,300 --zoom 3 --out sheet.png

`--box x,y,w,h` is the crop in video pixels. `--every N` keeps every Nth frame
(the game runs at 30 fps; N=2 gives 15 rows of poses, which is usually enough).
`--grid C` sets how many cells per row.
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import tempfile

from PIL import Image, ImageDraw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=pathlib.Path)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--box", required=True, help="x,y,w,h in video pixels")
    ap.add_argument("--zoom", type=int, default=3)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--grid", type=int, default=10)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    x, y, w, h = (int(v) for v in args.box.split(","))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(args.start), "-to", str(args.end),
             "-i", str(args.video), "-vf", f"fps={args.fps}",
             str(pathlib.Path(tmp) / "f%05d.png")], check=True)
        shots = sorted(pathlib.Path(tmp).glob("f*.png"))[::args.every]
        if not shots:
            raise SystemExit("no frames decoded - check --start/--end")
        cw, ch = w * args.zoom, h * args.zoom
        cols = args.grid
        rows = (len(shots) + cols - 1) // cols
        out = Image.new("RGB", (cw * cols, (ch + 16) * rows), (18, 18, 22))
        draw = ImageDraw.Draw(out)
        for i, shot in enumerate(shots):
            cell = Image.open(shot).crop((x, y, x + w, y + h))
            cell = cell.resize((cw, ch), Image.NEAREST)
            cx, cy = (i % cols) * cw, (i // cols) * (ch + 16)
            out.paste(cell, (cx, cy + 16))
            draw.text((cx + 4, cy + 3), f"+{i * args.every / args.fps:.2f}s", fill=(255, 224, 120))
        out.save(args.out)
        print(f"{len(shots)} frames -> {args.out} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    main()
