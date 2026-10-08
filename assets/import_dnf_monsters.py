#!/usr/bin/env python3
"""Bake 幽暗密林's monsters out of a local DNF client into one frame sheet.

**What a monster's art is.** One `.img` is the whole monster: `goblin/body0.img`
is seventeen frames holding stand, walk, attack, hurt and get-up in one run.
Which range is which action **is not in the client** - it lives in the encrypted
`Script.pvf` `.ani`, which cannot be read - so this script bakes every frame in
the client's own order and the named ranges come from watching the recording
(`docs/granfloris-assets.md`, `assets/match_monster_motions.py`).

**How a frame is placed.** Each frame carries its own size and its own offset
`(x, y)`, and the offset is **where that frame's bitmap is drawn** - a position
in one shared space per `.img`, not a distance from the anchor. Standing frames
of one monster all put their feet on the same row of that space (the goblin's
bitmaps are 76 tall at y=84, so its ground row is 160; the beast's are 164 tall
at y=183, so its row is 347).

That reading took two attempts to get right, so it is worth stating how it was
settled rather than asserted: every candidate rule was rendered and looked at.
`anchor - offset` puts a goblin's feet on the ground but detaches 牛头巨兽's
white mane from its head; `anchor + offset` draws nothing on screen at all;
`draw at (x, y)` puts both the mane on the head **and** the feet on the ground,
for the goblin, the tauren and the cat demon alike.

So this script re-bases each monster onto its own ground point: frame 0's
footprint centre becomes the cell's anchor, and every other frame is placed
relative to that. A cell therefore has to hold the art on *every* side of that
point - the beast swings 290 px to its left on one frame.

**Recolours are free.** A goblin's ten bodies share one bitmap size and one
anchor per frame - they are the same animation recoloured - so one bake covers
the whole colour family.

    python3 assets/import_dnf_monsters.py             # write assets/monsters.png
    python3 assets/import_dnf_monsters.py --preview   # labelled contact sheet
    python3 assets/import_dnf_monsters.py --report    # per-monster extents only
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
OUT = ROOT / "assets" / "monsters.png"
META = ROOT / "assets" / "dnf_src" / "monsters.json"

# Which body answers for which of the game's enemy archetypes. The archetype is
# the *behaviour* (`src/core.js` ENEMY_TYPES); this is only what it looks like.
# Keys are the behaviour ids the renderer knows.
ROSTER = [
    # 幽暗密林 - the first stage, and the only one with rooms so far.
    ("grunt",  "sprite_monster_goblin.NPK",            "goblin/body0.img"),
    ("coward", "sprite_monster_goblin_event.NPK",      "goblin/event/cowardgoblin.img"),
    ("caster", "sprite_monster_goblin.NPK",            "goblin/rtrowgoblin.img"),
    ("brute",  "sprite_monster_tau.NPK",               "tau/body01.img"),
    ("elite",  "sprite_monster_goblin.NPK",            "goblin/whiteboss.img"),
    ("boss",   "sprite_monster_tau.NPK",               "tau/body02.img"),
]

# Layers drawn on top of a body, in order. The beast's white mane is the reason
# the boss reads as 牛头巨兽 rather than as a plain tau; it carries its own
# anchor per frame, exactly like a body does.
OVERLAYS = {
    "boss": [("sprite_monster_tau_equipment.NPK", "tau/equipment/hair02.img")],
}

# Where the ground point sits inside a cell. Not centred: a monster's art is
# mostly *above* its feet, and a swing reaches forward, so the anchor wants room
# above and to both sides.
ANCHOR_IN_CELL = (300, 340)

# Sized by measurement, not by taste: `--report` prints how far each monster's
# art reaches from its own feet over every frame, and 牛头巨兽 (`tau/body02`) is
# the one that sets the cell - 170 px left of the feet when it swings, 222 above
# them, and 146 below on the frame it goes down. A goblin needs a fraction of
# this and simply rattles around inside its cell.
CELL = (480, 500)


def offset_of(frame) -> tuple[int, int]:
    """A frame's placement, following a link to the frame it reuses.

    `ImageLink` stores an index and nothing else - it means "this frame is that
    frame", and it carries no offset of its own (`pydnfex/img/image/link.py`),
    so a link frame is drawn where the frame it points at is drawn. The tau
    bodies use these, so a bake that reads `frame.x` crashes on the boss.
    """
    if hasattr(frame, "x"):
        return frame.x, frame.y
    final = getattr(frame, "final_image", None)
    if final is not None and hasattr(final, "x"):
        return final.x, final.y
    return 0, 0


def ground_of(frames):
    """The standing frame's foot centre, in the .img's own shared space.

    Frame 0 is the idle frame in every monster we bake, so it is the one that
    says where this monster's feet are - both how far down and where across.
    """
    picture, x, y = frames[0]
    spot = picture.getbbox()
    if spot is None:
        return x + picture.width / 2, y + picture.height
    return x + (spot[0] + spot[2]) / 2, y + spot[3]


def decode(client: pathlib.Path, pack: str, entry: str):
    """[(rgba, x, y)] for one .img, black backdrop keyed out, in frame order."""
    handle = open(client / "ImagePacks2" / pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if not item.name.replace("\\", "/").endswith(entry):
                continue
            img = IMGFactory.open(io.BytesIO(item.data))
            out = []
            for index in range(len(img.images)):
                frame = img.images[index]
                picture = img.build(frame).convert("RGBA")
                x, y = offset_of(frame)
                out.append((key_black(picture), x, y))
            return out
        raise SystemExit(f"{entry} not found in {pack}")
    finally:
        handle.close()


def key_black(picture: Image.Image) -> Image.Image:
    """Drop the client's black backdrop - the same rule the other imports use."""
    pixels = picture.load()
    for y in range(picture.height):
        for x in range(picture.width):
            r, g, b, a = pixels[x, y]
            if a and r < 26 and g < 26 and b < 26:
                pixels[x, y] = (r, g, b, 0)
    return picture


def extent(frames, foot):
    """How far the art reaches from `foot`, on each side, over all frames.

    An overlay is measured against the **body's** foot, not one of its own - a
    mane has no feet, it just has to land on the head.
    """
    fx, fy = foot
    left = top = 0
    right = bottom = 0
    for picture, x, y in frames:
        spot = picture.getbbox()
        if spot is None:
            continue
        left = max(left, fx - (x + spot[0]))
        top = max(top, fy - (y + spot[1]))
        right = max(right, (x + spot[2]) - fx)
        bottom = max(bottom, (y + spot[3]) - fy)
    return left, top, right, bottom


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    ax, ay = ANCHOR_IN_CELL
    cw, ch = CELL
    rows, meta = [], {}
    for kind, pack, entry in ROSTER:
        body = decode(args.client, pack, entry)
        foot = ground_of(body)
        layers = [body] + [
            decode(args.client, extra_pack, extra)
            for extra_pack, extra in OVERLAYS.get(kind, [])
        ]
        count = max(len(layer) for layer in layers)
        left, top, right, bottom = extent(body, foot)
        for layer in layers[1:]:
            l2, t2, r2, b2 = extent(layer, foot)
            left, top = max(left, l2), max(top, t2)
            right, bottom = max(right, r2), max(bottom, b2)
        meta[kind] = {
            "pack": pack, "entry": entry, "frames": count, "foot": list(foot),
            "reach": {"left": left, "top": top, "right": right, "bottom": bottom},
        }
        rows.append((kind, layers, count))
        left, top = int(left), int(top)
        right, bottom = int(right), int(bottom)
        fits = left <= ax and right <= cw - ax and top <= ay and bottom <= ch - ay
        print(f"{kind:7s} {entry:36s} {count:3d}f  reach "
              f"L{left:3d} T{top:3d} R{right:3d} B{bottom:3d}"
              f"{'' if fits else '   <-- DOES NOT FIT THE CELL'}")
        if not fits:
            print("  the cell has to grow before this can bake", file=sys.stderr)

    if args.report:
        return

    cols = max(count for _, _, count in rows)
    sheet = Image.new("RGBA", (cw * cols, ch * len(rows)), (0, 0, 0, 0))
    for index, (kind, layers, count) in enumerate(rows):
        fx, fy = meta[kind]["foot"]
        for column in range(count):
            cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            for layer in layers:
                if column >= len(layer):
                    continue
                picture, x, y = layer[column]
                cell.alpha_composite(
                    picture,
                    (int(round(ax + x - fx)), int(round(ay + y - fy))),
                )
            sheet.alpha_composite(cell, (column * cw, index * ch))

    if args.preview:
        target = ROOT / "assets" / "dnf_src" / "monsters-preview.png"
        zoom = 2
        out = sheet.resize((sheet.width * zoom, sheet.height * zoom), Image.NEAREST)
        draw = ImageDraw.Draw(out)
        for index, (kind, _, count) in enumerate(rows):
            draw.text((4, index * ch * zoom + 4), f"{kind} ({count}f)",
                      fill=(255, 224, 120))
        target.parent.mkdir(parents=True, exist_ok=True)
        out.save(target)
        print(f"preview -> {target} ({out.size[0]}x{out.size[1]})")
        return

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({
        "cell": {"w": cw, "h": ch},
        "anchor": {"x": ax, "y": ay},
        "cols": cols,
        "rows": {kind: {**meta[kind], "row": index} for index, (kind, _, _) in enumerate(rows)},
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(rows)} monsters, {cols} columns, cell {cw}x{ch} -> {OUT} "
          f"({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
