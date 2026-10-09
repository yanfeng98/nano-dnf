#!/usr/bin/env python3
"""Labelled contact sheet for a set of `.img` entries inside one client pack.

The Gran-Floris room art is not one picture: it is a `far` panorama, a `mid`
layer, four `tile` ground strips and a pile of numbered `obj` props, each its
own `.img` (`docs/granfloris-assets.md` 第三节). Same for the minimap pack.
Picking from those means being able to see every entry at once, with its name
and its size next to it - which is all this prints.

Frames are placed at their own `(x, y)`, the rule the monster bake settled on
(`assets/import_dnf_monsters.py`): for a static layer `x, y` is where the
bitmap goes, and most entries here are one frame anyway.

    python3 assets/gf_map_sheet.py --pack sprite_map.NPK --match sprite/map/02 \
        --exclude f.img --out .../map-set02-all.png
"""

from __future__ import annotations

import argparse
import io
import pathlib

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")


def offset_of(frame) -> tuple[int, int]:
    """A frame's placement, following an ImageLink to the frame it reuses."""
    if hasattr(frame, "x"):
        return frame.x, frame.y
    final = getattr(frame, "final_image", None)
    if final is not None and hasattr(final, "x"):
        return final.x, final.y
    return 0, 0


def entries(client: pathlib.Path, pack: str, match: str, exclude: str | None):
    """[(entry_name, [(rgba, x, y), ...])] for every entry whose path matches."""
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        out = []
        for item in npk.files:
            name = item.name.replace("\\", "/")
            if match not in name:
                continue
            if exclude and name.endswith(exclude):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            frames = []
            for frame in img.images:
                picture = img.build(frame).convert("RGBA")
                x, y = offset_of(frame)
                frames.append((picture, x, y))
            out.append((name, frames))
        return out
    finally:
        handle.close()


def layer_box(frames):
    """The box one entry's frames cover together, in that entry's own space."""
    spot = None
    for picture, x, y in frames:
        bbox = picture.getbbox()
        if bbox is None:
            continue
        box = (x + bbox[0], y + bbox[1], x + bbox[2], y + bbox[3])
        spot = box if spot is None else (
            min(spot[0], box[0]), min(spot[1], box[1]),
            max(spot[2], box[2]), max(spot[3], box[3]),
        )
    return spot


def render(frames, box) -> Image.Image:
    strip = Image.new("RGBA", (max(1, box[2] - box[0]), max(1, box[3] - box[1])),
                      (0, 0, 0, 0))
    for picture, x, y in frames:
        strip.alpha_composite(picture, (x - box[0], y - box[1]))
    return strip


def checker(size, step=8) -> Image.Image:
    """A backdrop that shows both dark art and transparent holes."""
    back = Image.new("RGBA", size, (58, 58, 66, 255))
    draw = ImageDraw.Draw(back)
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x // step + y // step) % 2:
                draw.rectangle([x, y, x + step - 1, y + step - 1], fill=(78, 78, 88, 255))
    return back


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--pack", required=True)
    ap.add_argument("--match", required=True, help="substring of the entry path")
    ap.add_argument("--exclude", default=None, help="skip names ending with this")
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--cell", type=int, default=260)
    ap.add_argument("--label", type=int, default=13)
    ap.add_argument("--cols", type=int, default=6)
    args = ap.parse_args()

    found = entries(args.client, args.pack, args.match, args.exclude)
    if not found:
        raise SystemExit(f"nothing matched {args.match!r} in {args.pack}")

    rows = []
    for name, frames in found:
        box = layer_box(frames)
        if box is None:
            box = (0, 0, 1, 1)
        wide, tall = box[2] - box[0], box[3] - box[1]
        print(f"{name:48s} {len(frames):2d}f  ink {wide:4d}x{tall:<4d} at ({box[0]},{box[1]})")
        rows.append((name, render(frames, box)))

    cols = args.cols
    cell = args.cell
    grid_h = cell + args.label
    sheet = Image.new("RGBA", (cols * cell + 4, (len(rows) + cols - 1) // cols * grid_h + 4),
                      (24, 24, 30, 255))
    draw = ImageDraw.Draw(sheet)

    for index, (name, strip) in enumerate(rows):
        cx = (index % cols) * cell + 2
        cy = (index // cols) * grid_h + 2
        draw.rectangle([cx, cy, cx + cell - 2, cy + cell + args.label - 2],
                       fill=(32, 32, 40, 255))
        draw.text((cx + 3, cy + 2), name.replace("sprite/map/", "").replace(".img", ""),
                  fill=(255, 224, 120))
        draw.text((cx + 3, cy + 2 + args.label),
                  f"{strip.width}x{strip.height}", fill=(150, 150, 160))
        room = Image.new("RGBA", (cell - 6, cell - args.label - 6), (0, 0, 0, 0))
        back = checker(room.size)
        room.alpha_composite(back)
        scale = min((cell - 8) / max(strip.width, 1),
                    (cell - args.label - 8) / max(strip.height, 1), 1.0)
        small = strip if scale == 1.0 else strip.resize(
            (max(1, int(strip.width * scale)), max(1, int(strip.height * scale))),
            Image.NEAREST)
        room.alpha_composite(small, ((room.width - small.width) // 2,
                                     (room.height - small.height) // 2))
        sheet.alpha_composite(room, (cx + 3, cy + args.label + 3))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    print(f"{len(rows)} entries -> {args.out} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
