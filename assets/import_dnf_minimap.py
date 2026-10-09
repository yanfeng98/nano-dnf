#!/usr/bin/env python3
"""Bake the dungeon map's tiles - the map window in the corner of a room.

The client's act-1 minimap art is `sprite/map/minimap/act1.img`: 122 frames of
18x18, and **one frame is one cell of the dungeon map**. A frame holds either a
room (a blob) or a corridor passing through, plus a stub towards every neighbour
it links to, and comes in two brightnesses - **the dim one is the cell you have
not been to, the bright one is the cell you have** (measured: ink mean red 103-110
against 145-163).

The client does not say which frame is which; that lives in `Script.pvf`. So this
measures it off the pixels instead, the same way the monsters' action ranges were
read off the recording: ink is the khaki the map is drawn in (the ground under it
is a green with a much lower blue), the four edge midpoints say which ways out a
cell has, and a wide row of ink says room rather than corridor. The table it
prints is what `--table` hands to `src/render.js` MINIMAP.

The reference for the whole drawing is the owner's 幽暗密林 recording
(`assets/dnf_src/bilibili/BV1d24y1P74G.mp4`), where the map window is in the
top-right from 76s on and the round "radar" form sits there for the twenty
seconds before it (`docs/adr/0029`).

    python3 assets/import_dnf_minimap.py            # write assets/minimap.png
    python3 assets/import_dnf_minimap.py --table    # the frame table, as JS
    python3 assets/import_dnf_minimap.py --preview  # labelled contact sheet
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
from collections import defaultdict

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "minimap.png"
META = ROOT / "assets" / "dnf_src" / "minimap.json"

PACK = "sprite_map_minimap.NPK"
ENTRY = "sprite/map/minimap/act1.img"
TILE = 18

# The atlas the markers are cut from. Its one frame is 974x943 and holds the four
# tile families *and* the two markers and the round disc frame, so there is no
# need to go looking for a second pack. Rects are in the frame's own space.
ATLAS_PACK = "sprite_map_minimap.NPK"
ATLAS_ENTRY = "sprite/map/minimap/minimap.img"
MARKERS = [
    ("boss", 358, 288, 16, 14),     # the red horned face: the boss's room
    ("marker", 272, 44, 14, 19),    # the blue lozenge: the room he is in
    ("ring", 549, 28, 104, 104)     # the disc the radar form is cut into
]

# The window itself is nine pieces of the client's own panel - an ordinary
# 9-slice, and the recording's window is exactly it: a pale hairline edge round a
# dark interior, with the title painted on the top strip. It lives in the older
# client's interface pack; the current one has no `sprite_interface.NPK`.
WINDOW_FOLDER = "ImagePacks2_70"
WINDOW_PACK = "sprite_interface.NPK"
WINDOW_ENTRY = "sprite/interface/minimap.img"
WINDOW_SLICES = ["tl", "top", "tr", "left", "centre", "right", "bl", "bottom", "br"]
WINDOW_FIRST = 27

# The four ways out of a cell, as bits: N=1, E=2, S=4, W=8. `EDGE` is where that
# way's stub has to show ink for the cell to count as having it.
EDGE = {"N": (1, (9, 0)), "E": (2, (17, 9)), "S": (4, (9, 17)), "W": (8, (0, 9))}
# How bright a frame's ink has to be to be the "you have been here" one.
BRIGHT = 128

# The client's unknown-room cell, and the one the blank is taken from.
UNKNOWN_FRAME = 120

# Where the recording pins a shape to one frame, this is that frame. It was read
# by scaling every candidate to the recording's own cell pitch (40.5 px), sliding
# it over the cell and keeping the best fit: the winners came in at RMSE 6.3-8.0
# against 10.9+ for the runner-up, so they are not close calls. Everything the
# recording never shows falls back to the plainest frame of its shape.
FROM_VIDEO = {
    "room:E": 0,
    "room:W": 24,
    "room:N": 8,
    "corr:ESW": 96,
    "corr:NS": 72,
    "corr:SW": 88,
    "corr:NSW": 104,
    "corr:NEW": 48,
}


def is_ink(pixel) -> bool:
    """The map is drawn in a khaki; the ground it sits on is a deep green.

    Measured off the frames: khaki is `(108..176, 111..192, 32..80)`, ground is
    `(32..96, 64..144, 0..16)`. The blue channel alone separates them.
    """
    r, g, b, a = pixel
    return a > 100 and b >= 28 and r >= 88


def read_tile(picture: Image.Image):
    """(kind, exits, bright, share) for one 18x18 frame."""
    pixels = picture.load()
    ink = [(x, y) for y in range(TILE) for x in range(TILE) if is_ink(pixels[x, y])]
    if len(ink) < 8:
        return "empty", 0, False, 0.0
    share = len(ink) / (TILE * TILE)
    red = sum(pixels[x, y][0] for x, y in ink) / len(ink)
    exits = 0
    for _name, (bit, (ex, ey)) in EDGE.items():
        if any(is_ink(pixels[x, y])
               for x in range(max(0, ex - 2), min(TILE, ex + 3))
               for y in range(max(0, ey - 2), min(TILE, ey + 3))):
            exits |= bit
    widest = max(sum(1 for x in range(TILE) if is_ink(pixels[x, y])) for y in range(TILE))
    kind = "room" if widest >= 7 and share >= 0.18 else "corr"
    return kind, exits, red >= BRIGHT, share


def decode(client: pathlib.Path, folder: str, pack: str, entry: str):
    handle = open(client / folder / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            out = []
            for index in range(len(img.images)):
                out.append(img.build(img.images[index]).convert("RGBA"))
            return out
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def cut(picture: Image.Image, x: int, y: int, w: int, h: int) -> Image.Image:
    """One rect out of an atlas, checked rather than trusted."""
    if x + w > picture.width or y + h > picture.height:
        raise SystemExit(f"rect ({x},{y},{w},{h}) runs off a "
                         f"{picture.width}x{picture.height} atlas")
    return picture.crop((x, y, x + w, y + h))


def blank_cell(unknown: Image.Image) -> Image.Image:
    """The unknown-room frame with its glyph taken out - an empty cell.

    **The client has no empty cell.** Every frame of `act1.img` carries either a
    room or a corridor, and the recording's map is covered edge to edge for the
    same reason: its dungeon uses every cell. A five-room stage on a 4x3 grid
    does not, and the cells it leaves over have to be drawn as *the cell and
    nothing else* or the map reads as a few tiles floating in the dark.

    So the blank is taken from the "?" frame, which is a plain cell with a glyph
    on it, and the glyph is taken out by running each of its rows straight from
    the pixel before the run to the pixel after it. The cell's background is a
    flat green, so there is nothing to invent - the fill is the same colour the
    glyph was covering.
    """
    out = unknown.copy()
    pixels = out.load()
    # The glyph sits in the middle and its edges are the same greens the cell is
    # shaded with, so no colour test separates them cleanly. The box does: inside
    # it every row is replaced by a straight run from the cell's own edge pixels
    # on either side, which keeps each row's own shading and leaves the rounded
    # corners - the only part of the cell that is not flat - untouched.
    left, right, top, bottom = 4, 13, 2, 15
    for y in range(top, bottom + 1):
        start = pixels[left - 1, y]
        end = pixels[right + 1, y]
        for x in range(left, right + 1):
            part = (x - left + 1) / (right - left + 2)
            pixels[x, y] = tuple(
                round(start[channel] + (end[channel] - start[channel]) * part)
                for channel in range(4)
            )
    return out


def exits_name(exits: int) -> str:
    return "".join(name for name, (bit, _) in EDGE.items() if exits & bit)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args()

    frames = decode(args.client, "ImagePacks2", PACK, ENTRY)
    groups = defaultdict(list)
    for index, picture in enumerate(frames):
        kind, exits, bright, share = read_tile(picture)
        groups[(kind, exits)].append((bright, share, index))

    # One frame per shape, and it is the **dim** one.
    #
    # The two brightnesses look like "been there / not been there" and they are
    # not: in the recording **every** cell of the map is drawn in the dim khaki
    # from the first room to the boss room - sampled on the room centres at 90s
    # and again at 250s, 112-119 red both times, against the bright family's
    # 145-163. So the reference's map is the dim family throughout, and the
    # bright frames are for a state this game does not draw yet.
    #
    # Among the frames of a shape, the plainest is the one with the most ink: a
    # room's own blob rather than one of the variants the client keeps for a cell
    # that opens onto a corridor.
    chosen = {}
    for (kind, exits), members in sorted(groups.items()):
        if kind == "empty":
            continue
        dim = [m for m in members if not m[0]]
        if not dim:
            continue
        dim.sort(key=lambda m: (-m[1], m[2]))
        key = f"{kind}:{exits_name(exits) or '-'}"
        picked = FROM_VIDEO.get(key, dim[0][2])
        chosen[(kind, exits)] = picked
        source = "recording" if key in FROM_VIDEO else f"plainest of {len(dim)}"
        print(f"{kind:5s} {exits_name(exits):4s} -> #{picked:3d}  "
              f"({len(members)} frames for this shape, {source})")

    if args.table:
        print("\n    tiles: {")
        for (kind, exits), index in sorted(chosen.items()):
            print(f'      "{kind}:{exits_name(exits) or "-"}": {index},')
        print("    },")
        return

    # Row 1: the tiles, one column each, in the order the table is printed.
    order = sorted(chosen.items())
    layout = {}
    for column, ((kind, exits), index) in enumerate(order):
        layout[f"{kind}:{exits_name(exits) or '-'}"] = column

    # Row 2: what is not a cell - the two markers, the disc, and the window's
    # own nine pieces.
    atlas = decode(args.client, "ImagePacks2", ATLAS_PACK, ATLAS_ENTRY)[0]
    specials = [(name, cut(atlas, *rect)) for name, *rect in MARKERS]
    blank = blank_cell(frames[UNKNOWN_FRAME])
    specials.insert(0, ("blank", blank))
    window = decode(args.client, WINDOW_FOLDER, WINDOW_PACK, WINDOW_ENTRY)
    for offset, name in enumerate(WINDOW_SLICES):
        specials.append((name, window[WINDOW_FIRST + offset]))

    gap = 4
    tiles_w = TILE * len(order)
    row_h = max(piece.height for _, piece in specials)
    specials_w = sum(piece.width + gap for _, piece in specials) - gap
    sheet = Image.new("RGBA", (max(tiles_w, specials_w), TILE + row_h), (0, 0, 0, 0))
    for column, ((_kind, _exits), index) in enumerate(order):
        sheet.alpha_composite(frames[index], (column * TILE, 0))
    places = {}
    left = 0
    for name, piece in specials:
        places[name] = [left, TILE, piece.width, piece.height]
        sheet.alpha_composite(piece, (left, TILE))
        left += piece.width + gap

    if args.preview:
        target = ROOT / "assets" / "dnf_src" / "minimap-tiles.png"
        zoom = 4
        out = sheet.resize((sheet.width * zoom, sheet.height * zoom), Image.NEAREST)
        draw = ImageDraw.Draw(out)
        for key, column in layout.items():
            draw.text((column * TILE * zoom + 3, TILE * zoom + 4), key, fill=(255, 224, 120))
        for name, rect in places.items():
            draw.text((rect[0] * zoom + 3, (TILE + rect[3]) * zoom + 4), name,
                      fill=(255, 224, 120))
        out = out.crop((0, 0, out.width, out.height + 20))
        back = Image.new("RGBA", out.size, (110, 130, 90, 255))
        back.alpha_composite(out)
        target.parent.mkdir(parents=True, exist_ok=True)
        back.save(target)
        print(f"preview -> {target} ({back.size[0]}x{back.size[1]})")
        return

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({"tile": TILE, "columns": layout, "pieces": places},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(order)} tiles + {len(specials)} pieces -> {OUT} "
          f"({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
