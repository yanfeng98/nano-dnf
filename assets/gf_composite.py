#!/usr/bin/env python3
"""Read-only: composite an .img's frames out of several layer .imgs, on one canvas.

DNF monsters are drawn as a stack of .img files that all share one canvas and
one frame count (body + clothes + hair + accessory + weapon). This renders that
stack the way the client does: for each requested frame index, every layer's
frame is pasted at its own (x, y) on the shared canvas, in the order given.

Usage:
  gf_composite.py <out.png> <npk> <frames|all|ink> <scale> <entry> [<entry>...]

The first <entry> is the base: its canvas size and its frames dictate the grid,
and the image is cropped to the union bbox of the base's frames.
Each cell is labelled `#<i>` plus the frame count of every layer.
"""
import io
import os
import sys
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

FONTS = ["/mnt/c/Windows/Fonts/simhei.ttf",
         "/usr/share/fonts/truetype/arphic/uming.ttc",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
COLS = 10
LABEL_H = 16
CLIENT = Path(os.environ.get("GF_CLIENT", "/mnt/c/dnf/地下城与勇士"))


def resolve_npk(spec):
    """Absolute path, or a bare NPK name looked up in the client's pack dirs."""
    spec = spec.strip()
    p = Path(spec)
    if p.is_file():
        return p
    for sub in ("ImagePacks2", "ImagePacks2_70"):
        cand = CLIENT / sub / spec
        if cand.is_file():
            return cand
    raise FileNotFoundError(spec)


def font(size):
    for p in FONTS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def main():
    out_path = Path(sys.argv[1])
    frames_spec = sys.argv[2]
    scale = float(sys.argv[3])
    items = sys.argv[4:]
    fnt = font(11)

    layers = []
    for order, item in enumerate(items):
        npk_spec, _, needle = item.partition("::")
        npk_path = resolve_npk(npk_spec)
        with open(npk_path, "rb") as h:   # handle stays open while entry.data reads
            npk = NPK.open(h)
            for e in npk.files:
                if needle.lower() in e.name.lower():
                    layers.append((order, e.name, IMGFactory.open(io.BytesIO(bytes(e.data)))))
                    break
        layers.sort(key=lambda t: t[0])
    if not layers:
        raise SystemExit("no matching entries")
    base_name, base = layers[0][1], layers[0][2]

    if frames_spec == "all":
        idxs = list(range(len(base.images)))
    elif frames_spec == "ink":
        idxs = []
        for i, fr in enumerate(base.images):
            pil = base.build(fr).convert("RGBA")
            if pil.getbbox() is not None and pil.getbbox() != (0, 0, 1, 1):
                idxs.append(i)
                if len(idxs) >= 12:
                    break
    else:
        idxs = [int(x) for x in frames_spec.split(",")]

    # canvas + crop box from the base layer's real frames
    x0 = y0 = 10 ** 9
    x1 = y1 = -10 ** 9
    for fr in base.images:
        if getattr(fr, "w", 0) <= 1 or getattr(fr, "h", 0) <= 1:
            continue
        x0, y0 = min(x0, fr.x), min(y0, fr.y)
        x1, y1 = max(x1, fr.x + fr.w), max(y1, fr.y + fr.h)
    box = None if x0 > x1 else (x0, y0, x1, y1)
    cw = max(getattr(base.images[0], "mw", 0), x1 if box else 1)
    ch = max(getattr(base.images[0], "mh", 0), y1 if box else 1)

    arts = []
    for i in idxs:
        canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
        for _, name, img in layers:
            if i >= len(img.images):
                continue
            fr = img.images[i]
            try:
                pil = img.build(fr).convert("RGBA")
            except Exception as e:  # noqa: BLE001
                print(f"  !! {name}[{i}]: {e}")
                continue
            canvas.paste(pil, (getattr(fr, "x", 0), getattr(fr, "y", 0)), pil)
        if box:
            canvas = canvas.crop(box)
        arts.append(canvas)

    bw = max(a.width for a in arts) or 1
    bh = max(a.height for a in arts) or 1
    rows = (len(arts) + COLS - 1) // COLS
    cw2 = int(bw * scale) + 6
    ch2 = int(bh * scale) + LABEL_H + 4
    cols = min(COLS, len(arts))
    sheet = PILImage.new("RGB", (cols * cw2 + 6, rows * ch2 + 34), (46, 46, 52))
    draw = ImageDraw.Draw(sheet)
    stack = " + ".join(Path(n).name for _, n, _ in layers)
    draw.text((8, 5), f"{Path(npk_path).name} :: {stack}   [{frames_spec}]  "
                      f"canvas {cw}x{ch}", font=font(15), fill=(255, 255, 255))
    for k, a in enumerate(arts):
        s = a.resize((max(1, int(a.width * scale)), max(1, int(a.height * scale))),
                     PILImage.LANCZOS)
        cx = 6 + (k % cols) * cw2
        cy = 30 + (k // cols) * ch2
        draw.rectangle([cx, cy, cx + cw2 - 2, cy + ch2 - 2], fill=(84, 84, 90),
                       outline=(180, 170, 70))
        sheet.paste(s, (cx + 3, cy + 2 + (int(bh * scale) - s.height) // 2), s)
        draw.text((cx + 3, cy + ch2 - LABEL_H), f"#{idxs[k]}", font=fnt, fill=(255, 240, 180))
    sheet.save(out_path)
    print(f"wrote {out_path}  {len(arts)} frames  {sheet.width}x{sheet.height}  stack={stack}")


if __name__ == "__main__":
    main()
