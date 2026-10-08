#!/usr/bin/env python3
"""Read-only zoom of a pixel region of a PNG.

Usage:  gf_zoom.py <in.png> <out.png> <x0> <y0> <x1> <y1> <scale>
"""
import sys
from pathlib import Path

from PIL import Image


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    x0, y0, x1, y1, scale = (float(v) for v in sys.argv[3:8])
    im = Image.open(src).convert("RGBA")
    box = (int(x0), int(y0), int(x1), int(y1))
    crop = im.crop(box)
    crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))),
                       Image.NEAREST)
    bg = Image.new("RGB", crop.size, (0, 0, 0))
    bg.paste(crop, (0, 0), crop)
    bg.save(dst)
    print(f"{dst}  crop={box} -> {bg.width}x{bg.height}")


if __name__ == "__main__":
    main()
