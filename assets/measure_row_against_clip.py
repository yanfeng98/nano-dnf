#!/usr/bin/env python3
"""Put a baked row and its reference clip on **one ruler**, column by column.

    python3 assets/measure_row_against_clip.py crossSlash
    python3 assets/measure_row_against_clip.py crossSlash --columns 16-21
    python3 assets/measure_row_against_clip.py crossSlash --json /tmp/row.json

**Why this exists.** 十字斩 has been reworked twenty times and most of those
rounds ended in «还是不对» because the *measuring* was redone from scratch every
time, in a scratch file that was thrown away - and three of those scratch files
were wrong (one compared column 15 against reference frame 15 instead of 37 and
returned a tidy `0.000` for the control; see `assets/dnf_effect_picks.md` 第二十二节).
A number you cannot re-run is not a number.

**What it measures.** The bake composes a row in the client's own pixels, and
`fit_scale` + `size` are chosen so that one of those pixels is one *screen*
pixel (`0008`). So the composed canvas is already in the same unit as the clip:
one client px, where one Slayer-height is 84. This reports both sides in
**client px relative to the point he cast from** - x positive is in front of
him, y positive is up from the ground line - which is the frame the owner's eye
uses when he says «剑气都到身后了».

**Always read a column against the control.** `--control` defaults to the
columns of the move the owner has already accepted (十字斩's 十 is the standing
one); a change that improves a column while moving the control is not an
improvement, it is a ruler that moved. The trap this file exists to close is
that a *thin* shape scores well against almost any target, so a bare IoU can
prefer the wrong art - see `match_effect_shape.py`.

Needs the installed client (`--client`) and `pydnfex`, like
`import_dnf_effects.py`, and `ffmpeg` on PATH for the clip.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
CLIPS = ROOT / "dnf_src" / "bilibili" / "skill-clips"

SLAYER_REF_HEIGHT = 218.0      # the clip's own Slayer, in the clip's own pixels
SLAYER_CLIENT_HEIGHT = 84.0    # ours, in client px  (see CONTEXT.md, 身位)
SCALE = SLAYER_CLIENT_HEIGHT / SLAYER_REF_HEIGHT


def load_bake():
    spec = importlib.util.spec_from_file_location("bake", ROOT / "import_dnf_effects.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["bake"] = module
    try:
        spec.loader.exec_module(module)
    except SystemExit:
        pass
    return module


# --- the two ink kinds, with the **same** thresholds on both sides ------------
#
# The clips are black-background composites with no alpha, so "red" is a colour
# test; the bake's frames do have alpha, and the same test runs on them. The
# tint rules are deliberately blunt: they are a ruler, not a judgement, and a
# ruler that is blunt the same way on both sides still measures the difference.

def kind_of(rgb):
    r, g, b = rgb[:, :, 0].astype(np.int16), rgb[:, :, 1].astype(np.int16), rgb[:, :, 2].astype(np.int16)
    red = (r > 90) & (r > 1.7 * g) & (r > 1.7 * b)
    gold = (r > 150) & (g > 100) & (b < 130) & (r > 1.35 * b) & (g > 1.15 * b) & ~red
    return red, gold


def clip_anchor(frame: np.ndarray) -> tuple[float, float] | None:
    """The caster's boots in the clip's own px: (axis x, sole y).

    Bright and unsaturated, inside the ground band - the same reading
    `dnf_effect_picks.md` 第二十节 used for the 靴心 table. It is measured rather
    than remembered because the whole point of `0012` was that the caster's own
    axis is the thing that moves, and a remembered constant is how that got
    missed for nineteen rounds.
    """
    a = frame.astype(np.int16)
    mx = np.maximum(np.maximum(a[:, :, 0], a[:, :, 1]), a[:, :, 2])
    mn = np.minimum(np.minimum(a[:, :, 0], a[:, :, 1]), a[:, :, 2])
    mask = ((mx - mn) < 45) & (mx > 105)
    mask[:600] = False
    mask[800:] = False
    mask[:, :480] = False
    mask[:, 920:] = False
    ys, xs = np.nonzero(mask)
    if len(ys) < 40:
        return None
    bottom = ys.max()
    keep = ys >= max(ys.min(), bottom - 55)
    return float(xs[keep].mean()), float(bottom)


def biggest(mask: np.ndarray) -> np.ndarray | None:
    """The ink that is the move, not the sword hanging off him.

    At the third act the clip's own blade is red too, and it sits on the
    caster's right, which is *behind* him - taking the union of the red ink
    puts the far edge 40px in front of where the effect actually stops and makes
    every later column read as if it were still flying.
    """
    from scipy import ndimage

    labels, count = ndimage.label(mask, np.ones((3, 3)))
    if count == 0:
        return None
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == int(np.argmax(sizes)) + 1


def clip_columns(folder: str, first: int, last: int) -> list[dict]:
    """Every column's ink, in client px relative to the point he cast from.

    Column `c` of the row is clip frame `#(first + c)`, and the point he cast
    from is where his boots stood on **column 0's frame** - not where they stand
    on the column being measured. That distinction is `0012`: he walks forward
    during the move, so an anchor read off each frame separately would follow him
    and quietly cancel out the displacement that whole ADR is about.
    """
    clips = sorted(CLIPS.glob(f"*{folder}*.mp4"))
    if not clips:
        raise SystemExit(f"no clip matching {folder!r} in {CLIPS}")
    work = pathlib.Path(tempfile.mkdtemp(prefix="measure-row-"))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(clips[0]), "-vsync", "0", str(work / "f%03d.png")],
        check=True,
    )
    out = []
    origin = None
    sole = 0.0
    for frame_number in range(first, last + 1):
        path = work / f"f{frame_number:03d}.png"
        if not path.exists():
            out.append(None)
            continue
        frame = np.asarray(Image.open(path).convert("RGB"))
        if origin is None:
            found = clip_anchor(frame)
            if found is None:
                raise SystemExit(f"no caster found on the clip's own frame #{first}")
            origin, sole = found
        red, gold = kind_of(frame)
        # The clip's own HUD: an icon column on the left, banners top and bottom,
        # and a readout strip on the right.
        red[:330] = False
        red[840:] = False
        red[:, :300] = False
        red[:, 1200:] = False
        gold[:330] = False
        gold[840:] = False
        gold[:, :300] = False
        gold[:, 1200:] = False
        box = {}
        for name, mask in (("red", red), ("gold", gold)):
            ink = biggest(mask)
            if ink is None:
                continue
            ys, xs = np.nonzero(ink)
            if len(ys) < 25:
                continue
            box[name] = (
                (origin - xs.max()) * SCALE, (origin - xs.min()) * SCALE,
                (sole - ys.max()) * SCALE, (sole - ys.min()) * SCALE,
            )
        out.append(box)
    shutil.rmtree(work, ignore_errors=True)
    return out


def baked_columns(client: pathlib.Path, skill: str, pick: dict) -> list[dict]:
    """The row as it will actually be drawn, in the same client px.

    Composed rather than read back off `assets/effects.png`: the sheet is a
    fitted cell, and reading the fit back out means inverting the very mapping
    (`0008`) that the numbers are supposed to be checked against.
    """
    bake = load_bake()
    frames, origin = bake.pick_frames(client, "stages", None, "", pick)
    out = []
    for frame in frames:
        alpha = np.asarray(frame)[:, :, 3]
        ink = alpha > 25
        box = {}
        if ink.sum() > 25:
            rgba = np.asarray(frame)
            red, gold = kind_of(rgba)
            for name, mask in (("red", red & ink), ("gold", gold & ink)):
                blob = biggest(mask)
                if blob is None or blob.sum() < 25:
                    continue
                ys, xs = np.nonzero(blob)
                box[name] = (
                    float(xs.min() + origin[0]), float(xs.max() + 1 + origin[0]),
                    float(-(ys.max() + 1 + origin[1])), float(-(ys.min() + origin[1])),
                )
        out.append(box)
    return out


def sheet(clip: str, first: int, length: int, pick: dict, client: pathlib.Path,
          columns: range, out: pathlib.Path, size=(320, 300)) -> None:
    """The same two rulers as a picture: clip | row, column by column.

    The numbers decide whether a change is right; this decides whether anyone
    can see it. Both halves are pasted so that **the point he cast from** sits
    at the same pixel and the ground line is the same row, so a shape that lands
    where the clip's does overlaps it, and one that does not is visibly off.
    """
    from PIL import Image, ImageDraw

    bake = load_bake()
    frames, origin = bake.pick_frames(client, "stages", None, "", pick)
    width, height = size
    ax, ay = width // 2, int(height * 0.72)      # the cast point, and the floor
    clips = sorted(CLIPS.glob(f"*{clip}*.mp4"))
    work = pathlib.Path(tempfile.mkdtemp(prefix="sheet-"))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(clips[0]), "-vsync", "0", str(work / "f%03d.png")],
        check=True,
    )
    rows = []
    for column in columns:
        number = first + column
        path = work / f"f{number:03d}.png"
        if not path.exists():
            continue
        frame = np.asarray(Image.open(path).convert("RGB"))
        found = clip_anchor(frame)
        if found is None:
            continue
        anchor_x, sole = found
        box = (anchor_x - ax / SCALE, sole - ay / SCALE,
               anchor_x + (width - ax) / SCALE, sole + (height - ay) / SCALE)
        left = Image.open(path).convert("RGB").crop(box).resize(size, Image.LANCZOS)
        canvas = Image.new("RGB", size, (16, 16, 22))
        art = frames[column] if column < len(frames) else None
        if art is not None and art.getbbox():
            canvas.paste(art, (ax + origin[0], ay + origin[1]), art)
        row = Image.new("RGB", (width * 2 + 8, height + 16), (0, 0, 0))
        row.paste(left, (0, 16))
        row.paste(canvas, (width + 8, 16))
        draw = ImageDraw.Draw(row)
        draw.text((4, 3), f"clip #{number}", fill=(255, 255, 0))
        draw.text((width + 12, 3), f"row col {column}", fill=(120, 255, 120))
        rows.append(row)
    shutil.rmtree(work, ignore_errors=True)
    if not rows:
        raise SystemExit("no columns to draw")
    columns_per_row = max(1, 1800 // (width * 2 + 8))
    rows_of = [rows[i:i + columns_per_row] for i in range(0, len(rows), columns_per_row)]
    sheet_image = Image.new("RGB", ((width * 2 + 8) * columns_per_row,
                                    (height + 16) * len(rows_of)), (0, 0, 0))
    for r, group in enumerate(rows_of):
        for c, row in enumerate(group):
            sheet_image.paste(row, (c * (width * 2 + 8), r * (height + 16)))
    sheet_image.save(out)
    print(f"wrote {out} ({sheet_image.width}x{sheet_image.height})")


def fmt(box) -> str:
    if not box:
        return " " * 30
    x0, x1, y0, y1 = box
    return f"{x0:7.1f}..{x1:6.1f} {y0:6.1f}..{y1:6.1f} w{x1 - x0:5.1f} h{y1 - y0:5.1f}"


def suggest(mine, target) -> str:
    """What to add to a stage's `offset` to put its ink on the clip's box.

    A stage's `offset` is a placement **before** `mirror_layer`, and the mirror
    negates x about the caster, so both the ink's forward distance and its
    height move **against** the offset by exactly one pixel per pixel. Composed
    ink is therefore a pure translation of the offset, and the correction is
    `mine - target` on both axes - which is why a layer can be solved in one
    pass instead of being nudged.
    """
    if not mine or not target:
        return "        -"
    a, b = centre(mine), centre(target)
    return f"  offset += ({a[0] - b[0]:+7.1f}, {a[1] - b[1]:+7.1f})"


def centre(box):
    return None if not box else ((box[0] + box[1]) / 2, (box[2] + box[3]) / 2)


def parse_columns(text: str | None) -> range | None:
    if not text:
        return None
    lo, _, hi = text.partition("-")
    return range(int(lo), int(hi or lo) + 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("skill", help="row key in PICKS, e.g. crossSlash")
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--clip", help="override the row's own `clip`")
    parser.add_argument("--columns", help="only these row columns, e.g. 16-21")
    parser.add_argument("--kind", choices=("red", "gold", "both"), default="both")
    parser.add_argument("--control", help="columns the owner has already accepted, e.g. 16-21")
    parser.add_argument("--per-stage", action="store_true",
                        help="compose each stage alone, so a layer can be solved on the "
                             "columns it actually plays")
    parser.add_argument("--sheet", type=pathlib.Path,
                        help="also write a PNG: clip | row, every column, on one ruler")
    parser.add_argument("--sheet-size", default="320x300")
    parser.add_argument("--json", type=pathlib.Path, help="also write the numbers here")
    args = parser.parse_args()

    bake = load_bake()
    pick = bake.PICKS[args.skill]
    clip = args.clip or pick.get("clip")
    if not clip:
        raise SystemExit(f"{args.skill} does not name a `clip` in import_dnf_effects.py")
    first = int(pick.get("firstFrame", 0))
    length = int(pick["length"])
    if args.sheet:
        width, _, height = args.sheet_size.partition("x")
        sheet(clip, first, length, pick, args.client,
              parse_columns(args.columns) or range(length), args.sheet,
              (int(width), int(height)))
        return

    ours = baked_columns(args.client, args.skill, pick)
    theirs = clip_columns(clip, first, first + length - 1)
    wanted = parse_columns(args.columns)

    print(f"{args.skill}: row is {length} columns, column c is clip frame #{first}+c of {clip}")
    print("client px relative to the point he cast from · x+ is in front of him, y+ is up\n")
    for kind in ("red", "gold"):
        if args.kind not in ("both", kind):
            continue
        print(f"=== {kind} ink ===")
        print(f"{'col':>4} {'clip':>5}  {'clip frame':<34} {'the row':<34} {'dcentre':>16}")
        for column in range(length):
            if wanted and column not in wanted:
                continue
            mine, ref = ours[column].get(kind), (theirs[column] or {}).get(kind)
            dc = ""
            if centre(mine) and centre(ref):
                a, b = centre(mine), centre(ref)
                dc = f"{a[0] - b[0]:+7.1f},{a[1] - b[1]:+6.1f}"
            print(f"{column:>4} {first + column:>5}  {fmt(ref):<34} {fmt(mine):<34} {dc:>16}")
        print()

    if args.per_stage:
        print("=== one layer at a time ===")
        print("The clip's own box on a column is **every** layer the clip draws "
              "there, so this only reads on the columns where this layer is the "
              "one that dominates (第二十二节's caveat).\n")
        for index, stage in enumerate(pick.get("stages", [])):
            alone = baked_columns(args.client, args.skill, {**pick, "stages": [stage]})
            played = [
                c for c in range(length)
                if alone[c].get("red") or alone[c].get("gold")
            ]
            if not played:
                continue
            name = f"{stage.get('entry')} f{stage.get('frames')}"
            print(f"col {played[0]:>2}-{played[-1]:<2} {name:<42}")
            for column in played:
                mine = alone[column].get(args.kind if args.kind != "both" else "red")
                ref = (theirs[column] or {}).get(args.kind if args.kind != "both" else "red")
                print(f"      col {column:>2} (clip #{first + column:>2})  "
                      f"{fmt(ref):<34} {fmt(mine):<34}{suggest(mine, ref)}")
            print()

    control = parse_columns(args.control)
    if control:
        print("control rows (owner-accepted):", " ".join(str(c) for c in control))
        for column in control:
            mine, ref = ours[column].get("red"), (theirs[column] or {}).get("red")
            if centre(mine) and centre(ref):
                a, b = centre(mine), centre(ref)
                print(f"  col {column:>2} (clip #{first + column}): "
                      f"w {mine[1] - mine[0]:5.1f} vs {ref[1] - ref[0]:5.1f}, "
                      f"h {mine[3] - mine[2]:5.1f} vs {ref[3] - ref[2]:5.1f}, "
                      f"centre {a[0] - b[0]:+6.1f},{a[1] - b[1]:+6.1f}")

    if args.json:
        args.json.write_text(
            json.dumps({"ours": ours, "clip": theirs, "first": first}, indent=1)
        )
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
