#!/usr/bin/env python3
"""Read-only contact sheets of DNF client NPK entries.

Renders the first frame of every matching .img entry into one PNG grid,
each cell captioned with the entry basename.

Usage:
  gf_sheets.py <out.png> <npk> [substring ...]
      substring: only entries whose path contains it (case-insensitive).
                 No substring => every entry.

Options via env:
  GF_SCALE   float downscale factor applied to each cell (default 1.0)
  GF_COLS    number of columns (default 6)
  GF_CELL    max cell box in px (default 240)
"""
import io
import os
import sys
from pathlib import Path

from PIL import Image as PILImage, ImageDraw

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

SCALE = float(os.environ.get("GF_SCALE", "1.0"))
COLS = int(os.environ.get("GF_COLS", "6"))
CELL = int(os.environ.get("GF_CELL", "240"))
CAPTION = 14


def first_frame(data):
    img = IMGFactory.open(io.BytesIO(data))
    if not img.images:
        raise ValueError("no frames")
    frame = img.build(img.images[0])
    if SCALE != 1.0:
        frame = frame.resize(
            (max(1, int(frame.width * SCALE)), max(1, int(frame.height * SCALE))),
            PILImage.LANCZOS,
        )
    return frame


def main():
    out_path = Path(sys.argv[1])
    npk_path = Path(sys.argv[2])
    needles = [s.lower() for s in sys.argv[3:]]

    with open(npk_path, "rb") as h:
        npk = NPK.open(h)
        items = []
        for entry in npk.files:
            name = entry.name
            low = name.lower()
            if needles and not any(n in low for n in needles):
                continue
            try:
                frame = first_frame(bytes(entry.data))
            except Exception as e:  # noqa: BLE001
                print(f"  !! {name}: {e}", file=sys.stderr)
                continue
            items.append((name.split("/")[-1].replace(".img", ""), frame))

    if not items:
        print("no matching entries", file=sys.stderr)
        return 1

    cell_w = min(CELL, max(f.width for _, f in items))
    cell_h = max(min(CELL, max(f.height for _, f in items)), 1)
    rows = (len(items) + COLS - 1) // COLS
    sheet = PILImage.new(
        "RGB", (COLS * cell_w, rows * (cell_h + CAPTION)), (24, 24, 28)
    )
    draw = ImageDraw.Draw(sheet)
    for i, (label, frame) in enumerate(items):
        cx = (i % COLS) * cell_w
        cy = (i // COLS) * (cell_h + CAPTION)
        sheet.paste(frame, (cx, cy + CAPTION), frame if frame.mode == "RGBA" else None)
        draw.text((cx + 2, cy + 2), label[:34], fill=(255, 220, 120))

    sheet.save(out_path)
    print(f"{out_path}  {len(items)} entries  {sheet.width}x{sheet.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
