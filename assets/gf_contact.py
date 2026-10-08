#!/usr/bin/env python3
"""Contact sheets for DNF monster packs (granfloris probe, read-only).

  gf_contact.py sheet  <out_prefix> <npk>...      one page (or more) per pack
  gf_contact.py index  <out_prefix> <cols> <cell> <npk>...

Each cell holds the first frame that has ink, drawn on mid grey so white and
black art both stay readable; the label is the entry basename + frame count.
Written by the granfloris monster-inventory probe; the client is only ever read.
"""
import io
import sys
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

# Cells carry both ASCII (entry names) and Chinese, so the font must cover both.
# The repo's usual DroidSansFallbackFull is CJK-only here - every ASCII glyph
# comes out as a tofu box (/tmp/fonttest.png) - hence this order.
FONT_CANDIDATES = [
    "/mnt/c/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/mnt/c/Windows/Fonts/msyh.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
BG = (90, 90, 96)
LABEL_BG = (24, 24, 28)
BORDER = (200, 200, 60)
LABEL_H = 34


def font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def load_npk(path):
    with open(path, "rb") as h:
        npk = NPK.open(h)
        return [(e.name, bytes(e.data)) for e in npk.files]


def frame_image(img, index):
    if index >= len(img.images):
        return None
    try:
        pil = img.build(img.images[index])
    except Exception:  # noqa: BLE001
        return None
    if pil is None:
        return None
    pil = pil.convert("RGBA")
    return pil if pil.getbbox() else None


def first_inked(img, limit=80):
    for i in range(min(limit, len(img.images))):
        pil = frame_image(img, i)
        if pil is not None:
            return i, pil
    return None, None


def fit(pil, box, max_up=6.0):
    """Scale to fill `box`; DNF frames are often tiny, so upscaling (nearest, to
    keep pixels crisp) matters more than downscaling."""
    w, h = pil.size
    scale = min(box / max(w, 1), box / max(h, 1), max_up)
    if scale == 1.0:
        return pil
    resample = PILImage.LANCZOS if scale < 1.0 else PILImage.NEAREST
    return pil.resize((max(1, int(w * scale)), max(1, int(h * scale))), resample)


def cell(canvas, draw, x, y, w, h, pil, title, sub, fnt):
    draw.rectangle([x, y, x + w, y + h], fill=BG, outline=BORDER)
    art_h = h - LABEL_H - 4
    if pil is not None:
        art = fit(pil, art_h)
        canvas.paste(art, (x + (w - art.size[0]) // 2, y + 2 + (art_h - art.size[1]) // 2), art)
    draw.rectangle([x, y + h - LABEL_H, x + w, y + h], fill=LABEL_BG)
    if title:
        tw = draw.textlength(title, font=fnt)
        draw.text((x + (w - tw) / 2, y + h - LABEL_H + 1), title, font=fnt, fill=(255, 240, 180))
    if sub:
        sw = draw.textlength(sub, font=fnt)
        draw.text((x + (w - sw) / 2, y + h - 17), sub, font=fnt, fill=(170, 220, 255))


def new_page(width, height):
    canvas = PILImage.new("RGB", (width, height), (48, 48, 54))
    return canvas, ImageDraw.Draw(canvas)


def write_sheet(out_dir, specs, cols=6, cell_w=330, cell_h=300, per_page=42):
    """`specs` are either a plain npk path (label = pack stem minus the
    `sprite_monster_` prefix) or `label:path` to name the sheet explicitly.
    Files land as <out_dir>/<label>-<pack stem>.png, one per pack."""
    fnt = font(13)
    out_dir = Path(out_dir)
    for spec in specs:
        label, _, path = spec.partition(":")
        if not path:
            label, path = "", spec
        entries = load_npk(path)
        pack_name = Path(path).stem
        label = (label or pack_name.replace("sprite_monster_", "")).replace("/", "_")
        out_prefix = out_dir / f"{label}-{pack_name}"
        pages = max(1, (len(entries) + per_page - 1) // per_page)
        print(f"{pack_name}: {len(entries)} entries, {pages} page(s)")
        for page in range(pages):
            chunk = entries[page * per_page:(page + 1) * per_page]
            rows = (len(chunk) + cols - 1) // cols
            width = cols * (cell_w + 8) + 8
            height = rows * (cell_h + 8) + 8 + 30
            canvas, draw = new_page(width, height)
            title = pack_name if pages == 1 else f"{pack_name}  page {page + 1}/{pages}"
            draw.text((10, 6), title, font=font(18), fill=(255, 255, 255))
            for i, (name, data) in enumerate(chunk):
                cx = 8 + (i % cols) * (cell_w + 8)
                cy = 38 + (i // cols) * (cell_h + 8)
                try:
                    img = open_img(data)
                    idx, art = first_inked(img)
                    sub = f"{len(img.images)}f, first inked #{idx}" if art is not None else \
                          f"{len(img.images)}f, no ink"
                except Exception as e:  # noqa: BLE001
                    art, sub = None, f"FAIL {str(e)[:18]}"
                cell(canvas, draw, cx, cy, cell_w, cell_h, art, Path(name).name[:34], sub, fnt)
            out = f"{out_prefix}-{page + 1}.png" if pages > 1 else f"{out_prefix}.png"
            canvas.save(out)
            print(f"  wrote {out}")


def open_img(data):
    return IMGFactory.open(io.BytesIO(data))


def write_index(out_prefix, paths, cols=10, cell_w=170, cell_h=170, per_page=None):
    per_page = per_page or cols * 8
    fnt = font(11)
    pages = max(1, (len(paths) + per_page - 1) // per_page)
    for page in range(pages):
        chunk = paths[page * per_page:(page + 1) * per_page]
        rows = (len(chunk) + cols - 1) // cols
        width = cols * (cell_w + 6) + 6
        height = rows * (cell_h + 6) + 6 + 28
        canvas, draw = new_page(width, height)
        draw.text((8, 4), f"monster pack index  page {page + 1}/{pages}  ({len(paths)} packs)",
                  font=font(16), fill=(255, 255, 255))
        for i, path in enumerate(chunk):
            cx = 6 + (i % cols) * (cell_w + 6)
            cy = 32 + (i // cols) * (cell_h + 6)
            label = Path(path).stem.replace("sprite_monster", "m")
            pil = None
            try:
                for name, data in load_npk(path):
                    idx, art = first_inked(open_img(data), limit=6)
                    if art is not None:
                        pil = art
                        break
            except Exception:  # noqa: BLE001
                pass
            cell(canvas, draw, cx, cy, cell_w, cell_h, pil, label[:30], "", fnt)
        out = f"{out_prefix}-{page + 1}.png" if pages > 1 else f"{out_prefix}.png"
        canvas.save(out)
        print(f"wrote {out}  ({len(chunk)} packs)")


def main():
    mode = sys.argv[1]
    if mode == "sheet":
        write_sheet(sys.argv[2], sys.argv[3:])
    elif mode == "index":
        write_index(sys.argv[2], sys.argv[5:], cols=int(sys.argv[3]), cell_w=int(sys.argv[4]),
                    cell_h=int(sys.argv[4]))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
