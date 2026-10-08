#!/usr/bin/env python3
"""Read-only strip of every frame of one .img entry, laid out in a grid.

Usage:  gf_strip.py <npk> <entry-substring> <out.png> [cols] [cell]
Frames are drawn on their own canvas (mw x mh) at (x, y) - what the client
draws - then cropped to the union bbox of the whole .img so every frame keeps
the same ground position. Each cell is labelled `<basename> #<i>`.
"""
import io
import sys
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

FONTS = ["/mnt/c/Windows/Fonts/simhei.ttf",
         "/usr/share/fonts/truetype/arphic/uming.ttc",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
LABEL_H = 16


def font(size):
    for p in FONTS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def main():
    npk_path = Path(sys.argv[1])
    needle = sys.argv[2].lower()
    out_path = Path(sys.argv[3])
    cols = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    cell = int(sys.argv[5]) if len(sys.argv) > 5 else 130
    fnt = font(11)
    with open(npk_path, "rb") as h:  # handle must outlive every entry.data read
        npk = NPK.open(h)
        for entry in npk.files:
            if needle not in entry.name.lower():
                continue
            img = IMGFactory.open(io.BytesIO(bytes(entry.data)))
            base = Path(entry.name).stem
            # union bbox over real frames
            x0 = y0 = 10 ** 9
            x1 = y1 = -10 ** 9
            for fr in img.images:
                if getattr(fr, "w", 0) <= 1 or getattr(fr, "h", 0) <= 1:
                    continue
                x0, y0 = min(x0, fr.x), min(y0, fr.y)
                x1, y1 = max(x1, fr.x + fr.w), max(y1, fr.y + fr.h)
            box = None if x0 > x1 else (x0, y0, x1, y1)
            arts = []
            for i, fr in enumerate(img.images):
                try:
                    a = img.build(fr).convert("RGBA")
                except Exception as e:  # noqa: BLE001
                    print(f"  !! {base}[{i}]: {e}")
                    a = PILImage.new("RGBA", (1, 1))
                cw, ch = max(getattr(fr, "mw", a.width), a.width), \
                         max(getattr(fr, "mh", a.height), a.height)
                canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
                canvas.paste(a, (getattr(fr, "x", 0), getattr(fr, "y", 0)), a)
                if box:
                    canvas = canvas.crop(box)
                arts.append(canvas)
            if not arts:
                continue
            # figure out the scale that fits every frame in one cell
            bw, bh = max(a.width for a in arts) or 1, max(a.height for a in arts) or 1
            scale = min(cell / bw, (cell - LABEL_H) / bh, 1.0) if max(bw, bh) > cell \
                else min(cell / bw, (cell - LABEL_H) / bh)
            rows = (len(arts) + cols - 1) // cols
            cw2 = int(bw * scale) + 6
            ch2 = int(bh * scale) + LABEL_H + 4
            sheet = PILImage.new("RGB", (cols * cw2 + 6, rows * ch2 + 6 + 26),
                                 (46, 46, 52))
            draw = ImageDraw.Draw(sheet)
            draw.text((8, 5), f"{Path(npk_path).name} :: {entry.name}  "
                              f"{len(img.images)} frames  canvas "
                              f"{img.images[0].mw}x{img.images[0].mh}  anchor "
                              f"({img.images[0].x},{img.images[0].y})",
                      font=font(15), fill=(255, 255, 255))
            for i, a in enumerate(arts):
                s = a.resize((max(1, int(a.width * scale)), max(1, int(a.height * scale))),
                             PILImage.LANCZOS)
                cx = 6 + (i % cols) * cw2
                cy = 32 + (i // cols) * ch2
                draw.rectangle([cx, cy, cx + cw2 - 2, cy + ch2 - 2], fill=(84, 84, 90),
                               outline=(180, 170, 70))
                sheet.paste(s, (cx + 3, cy + 2 + (int(bh * scale) - s.height) // 2), s)
                draw.text((cx + 3, cy + ch2 - LABEL_H), f"#{i}", font=fnt,
                          fill=(255, 240, 180))
            sheet.save(out_path)
            print(f"wrote {out_path}  {len(arts)} frames  {sheet.width}x{sheet.height}  "
                  f"cell={cw2}x{ch2} scale={scale:.3f}")
            return


if __name__ == "__main__":
    main()
