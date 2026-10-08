#!/usr/bin/env python3
"""Read-only side-by-side: one stage-select boss portrait vs client monster art.

Usage:  gf_boss_sheet.py <spec.tsv> <outdir>

spec.tsv is TSV, one candidate per line, '#' comments and blank lines ignored:
    <中文名>\t<slot frame idx>\t<label>\t<stack>\t<frames>

`stack` is one or more `NPK::entry-substring` items joined by `+`. The first item
is the base (its canvas and frame count drive the cell); the rest are pasted on
top at their own (x, y) on that canvas - that is how the client draws a monster,
whose body/clothes/hair/mask live in separate .img files (sometimes in separate
packs). Example:

    sprite_monster_lugaru.NPK::lugaru/heart.img+sprite_monster_lugaru_equipment.NPK::equipment/heart_mask_1.img

`frames` is a comma list of frame indices (0-based), or `ink` (first few frames
that have ink), or `all`.

The first line seen for a 中文名 fixes which slot frame is drawn; every line with
that name is appended to that boss's sheet, written as <outdir>/boss-<中文名>-match.png
Each cell is labelled `label: entry (nf frames)` + pack path + frames + canvas/anchor.

Frames are rendered on the full (mw x mh) canvas at their own (x, y), then the
whole cell is cropped to the union bbox of the stack's real frames - so 1x1
placeholder frames stay blank instead of masquerading as art, and the art is
shown large while keeping a common ground position.
"""
import io
import os
import re
import sys
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

PROBE = Path(__file__).resolve().parent / "dnf_src" / "granfloris-probe"
CLIENT = Path(os.environ.get("GF_CLIENT", "/mnt/c/dnf/地下城与勇士"))
FONT_CANDIDATES = [
    "/mnt/c/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/mnt/c/Windows/Fonts/msyh.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
BG = (40, 42, 48)
CELL_BG = (86, 86, 92)
LABEL_BG = (20, 22, 26)
BORDER = (210, 200, 80)
LABEL_H = 34
PORTRAIT_W = 400
CELL_W = 470
CELL_H = 470
COLS = 3
GAP = 8
MAX_FRAMES = int(os.environ.get("GF_MAX_FRAMES", "3"))
PORTRAIT_CROP = (400, 0, 672, 292)     # right side of a 672x292 (4x) slot frame
MARGIN = 4


def font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


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


def load_npk_entries(path):
    """[(entry name, raw bytes)] - read eagerly so no handle outlives the block."""
    with open(path, "rb") as h:
        npk = NPK.open(h)
        return [(e.name, bytes(e.data)) for e in npk.files]


def frame_on_canvas(img, frame, canvas=None):
    pil = img.build(frame).convert("RGBA")
    if canvas is None:
        cw = max(getattr(frame, "mw", pil.width), pil.width)
        ch = max(getattr(frame, "mh", pil.height), pil.height)
        canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(pil, (getattr(frame, "x", 0), getattr(frame, "y", 0)), pil)
    return canvas


def union_box(layers):
    """bbox covering every real frame of every layer, in canvas coords."""
    x0 = y0 = 10 ** 9
    x1 = y1 = -10 ** 9
    for _, _, img in layers:
        for fr in img.images:
            w, h = getattr(fr, "w", 0), getattr(fr, "h", 0)
            if w <= 1 or h <= 1:
                continue
            x, y = getattr(fr, "x", 0), getattr(fr, "y", 0)
            x0, y0 = min(x0, x), min(y0, y)
            x1, y1 = max(x1, x + w), max(y1, y + h)
    if x0 > x1:
        return None
    return (max(0, x0 - MARGIN), max(0, y0 - MARGIN), x1 + MARGIN, y1 + MARGIN)


def has_ink(pil):
    bb = pil.getbbox()
    return bb is not None and bb != (0, 0, 1, 1)


def build_layers(stack):
    """`a.NPK::entry + b.NPK::entry` -> [(npk path, entry name, img)]"""
    layers = []
    for item in stack.split("+"):
        item = item.strip()
        if not item:
            continue
        npk_spec, _, needle = item.partition("::")
        npk = resolve_npk(npk_spec)
        entries = load_npk_entries(str(npk))
        hit = [(n, d) for n, d in entries if needle.lower() in n.lower()]
        if not hit:
            raise LookupError(f"{npk.name}: no entry matching '{needle}'")
        nm, data = hit[0]
        layers.append((str(npk), nm, IMGFactory.open(io.BytesIO(data))))
    if not layers:
        raise ValueError("empty stack")
    return layers


def pick_frames(layers, spec):
    base = layers[0][2]
    spec = spec.strip().lower()
    if spec == "all":
        return list(range(min(len(base.images), MAX_FRAMES)))
    if spec == "ink":
        out = []
        for i in range(len(base.images)):
            canvas = PILImage.new(
                "RGBA", (max(base.images[0].mw, 1), max(base.images[0].mh, 1)), (0, 0, 0, 0))
            for _, _, img in layers:
                if i < len(img.images):
                    canvas = frame_on_canvas(img, img.images[i], canvas)
            if has_ink(canvas):
                out.append(i)
                if len(out) >= MAX_FRAMES:
                    break
        return out or [0]
    return [int(x) for x in spec.split(",") if x.strip() != ""]


def fit(pil, box):
    w, h = pil.size
    scale = min(box / max(w, 1), box / max(h, 1))
    if scale == 1.0:
        return pil
    resample = PILImage.LANCZOS if scale < 1.0 else PILImage.NEAREST
    return pil.resize((max(1, int(w * scale)), max(1, int(h * scale))), resample)


def cell(canvas, draw, x, y, arts, title, fnt):
    w, h = CELL_W, CELL_H + LABEL_H
    draw.rectangle([x, y, x + w, y + h], fill=CELL_BG, outline=BORDER)
    art_h = CELL_H - 6
    if arts:
        scaled = [fit(a, art_h) for a in arts]
        total = sum(s.width for s in scaled) + 10 * (len(scaled) - 1)
        cx = x + max(3, (w - total) // 2)
        for s in scaled:
            canvas.paste(s, (cx, y + 3 + (art_h - s.height) // 2), s)
            cx += s.width + 10
    draw.rectangle([x, y + h - LABEL_H, x + w, y + h], fill=LABEL_BG)
    draw.text((x + 3, y + h - LABEL_H + 2), title[0][:54], font=fnt, fill=(255, 240, 180))
    if len(title) > 1:
        draw.text((x + 3, y + h - 17), title[1][:54], font=fnt, fill=(170, 220, 255))


def paste_portrait(sheet, draw, fnt, name, slot, top):
    slot_png = PROBE / "slots" / f"granfloris-f{slot}.png"
    if not slot_png.exists():
        return
    portrait = PILImage.open(slot_png).convert("RGBA").crop(PORTRAIT_CROP)
    portrait = fit(portrait, PORTRAIT_W - 8)
    draw.rectangle([8, top, 8 + PORTRAIT_W, top + portrait.height + 20],
                   fill=(18, 18, 22), outline=BORDER)
    sheet.paste(portrait, (12, top + 2), portrait)
    draw.text((12, top + portrait.height + 2), f"选关条头像 {name} (slot frame {slot})",
              font=fnt, fill=(255, 220, 120))


def main():
    spec_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    fnt = font(12)
    fnt_big = font(20)

    groups, order = {}, []
    for raw in spec_path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.rstrip("\n").split("\t")
        name, slot, label, stack, frames = [p.strip() for p in parts[:5]]
        if name not in groups:
            groups[name] = {"slot": slot, "lines": []}
            order.append(name)
        groups[name]["lines"].append((label, stack, frames))

    for name in order:
        g = groups[name]
        cells = []
        for label, stack, frames in g["lines"]:
            arts = None
            try:
                layers = build_layers(stack)
                idxs = pick_frames(layers, frames)
                box = union_box(layers)
                base = layers[0][2]
                arts, geo = [], ""
                for i in idxs:
                    cw = max(getattr(base.images[i], "mw", 1), box[2] if box else 1)
                    ch = max(getattr(base.images[i], "mh", 1), box[3] if box else 1)
                    canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
                    for _, _, img in layers:
                        if i < len(img.images):
                            canvas = frame_on_canvas(img, img.images[i], canvas)
                    fr = base.images[i]
                    geo = (f"canvas {getattr(fr, 'mw', '?')}x{getattr(fr, 'mh', '?')} "
                           f"anchor ({getattr(fr, 'x', '?')},{getattr(fr, 'y', '?')})")
                    arts.append(canvas.crop(box) if box else canvas)
                packs = " + ".join(f"{Path(p).name}/{Path(n).name}" for p, n, _ in layers)
                title = (f"{label} ({len(base.images)}f)",
                         f"{packs}  frames {idxs}  {geo}")
            except Exception as e:  # noqa: BLE001
                title = (f"{label} !! {str(e)[:44]}", stack[:54])
            cells.append((label, arts if isinstance(arts, list) else None, title))

        rows = max(1, (len(cells) + COLS - 1) // COLS)
        width = PORTRAIT_W + 16 + COLS * (CELL_W + GAP) + GAP
        height = 44 + rows * (CELL_H + LABEL_H + GAP) + GAP
        sheet = PILImage.new("RGB", (width, height), BG)
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 12), f"选关条「{name}」vs 客户端怪物美术（左：选关条头像）",
                  font=fnt_big, fill=(255, 255, 255))
        paste_portrait(sheet, draw, fnt, name, g["slot"], 44)
        for i, (label, arts, title) in enumerate(cells):
            cx = PORTRAIT_W + 16 + (i % COLS) * (CELL_W + GAP)
            cy = 44 + (i // COLS) * (CELL_H + LABEL_H + GAP)
            cell(sheet, draw, cx, cy, arts, title, fnt)
        safe = re.sub(r"[^\w一-鿿-]+", "_", name)
        out = out_dir / f"boss-{safe}-match.png"
        sheet.save(out)
        print(f"wrote {out}  ({len(cells)} candidates, {sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
