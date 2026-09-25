"""Measure the baked 大蹦 rows, column by column, in Slayer-heights.

    python3 assets/measure_rift.py [--cols 20,24,28]

The renderer's job for this move is to blit two cells, so measuring the cells
is measuring the move - minus the Slayer, who stands in the near end of the
fire. That is what makes this the fast loop: no browser, no capture, and the
numbers the owner's complaints turn into are the ones in `measure_effect.py`.

The two rows are composited the way `drawWorld` does it - the ground row first,
the front row over it - and then read with the same tests, so a column here and
a frame of the reference video are the same kind of measurement.

One client pixel is `fit_scale(window)` of a cell pixel for both rows, since
both declare the same window - that comes out of the bake. A Slayer-height is
**141 client px**: `SPRITE.bodyHeight` (84 screen px, `src/render.js`) over
`RIFT_CLIENT_PX` (0.596 screen px per client px, the bake). That one is written
down here rather than read, so a change to either constant has to be carried
across by hand.

The reference side of the same measurement is `measure_effect.py`, which takes
a frame off either clip instead of the sheet.
"""

import argparse
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
# The bake's own window and cell, read rather than restated: a window is a zoom,
# and a hard-coded 0.457 here would go stale the day the window moves.
BAKE = (ROOT / "import_dnf_effects.py").read_text(encoding="utf8")
CELL = int(re.search(r"^RIFT_CELL = (\d+)", BAKE, re.M).group(1))
WINDOW = tuple(
    int(value)
    for value in re.search(r'"mountainRift": \{"palette".*?"window": \(([^)]+)\)', BAKE, re.S)
    .group(1)
    .split(",")
)
SLayer_CLIENT_PX = 141  # the reference's own measure of him, in the pack's units


def hot(pixels: np.ndarray) -> np.ndarray:
    red, green, blue = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    return (red > 90) & (red > green * 1.9 + 12) & (red > blue * 1.9 + 12)


def at(cell_px: float, origin: int, span: int) -> float:
    """A cell pixel back in the client's own coordinates."""
    return WINDOW[origin] + cell_px * span / CELL


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cols", default="22,24,26,28,30")
    parser.add_argument("--sheet", type=Path, default=ROOT / "rift.png")
    parser.add_argument("--rows", default="0,1", help="which rows to composite, bottom first")
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    rows = [int(value) for value in args.rows.split(",")]
    scale = CELL / max(WINDOW[2] - WINDOW[0], WINDOW[3] - WINDOW[1])
    body = SLayer_CLIENT_PX * scale  # a Slayer-height, in cell pixels

    for column in [int(value) for value in args.cols.split(",")]:
        canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        for row in rows:
            canvas.alpha_composite(sheet.crop((column * CELL, row * CELL, (column + 1) * CELL, (row + 1) * CELL)))
        pixels = np.asarray(canvas.convert("RGB")).astype(int)
        mask = hot(pixels)
        if mask.sum() < 20:
            print(f"col {column:>3}: nothing lit")
            continue
        ys, xs = np.nonzero(mask)
        width = (xs.max() - xs.min() + 1) / body
        height = (ys.max() - ys.min() + 1) / body
        # Solidity is against the effect's own bounding box, not the square it
        # happens to sit in - otherwise a tall thin rank scores lower for being
        # tall, and the number stops being comparable with the reference's.
        solid = mask.sum() / max(1, (ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1))
        # The floor the move stands on, in client y: the effect's own bottom.
        foot = at(float(ys.max()), 1, CELL * (WINDOW[3] - WINDOW[1]) / CELL)
        # Top profile: the topmost lit cell pixel in each column of the effect.
        top = np.full(CELL, np.nan)
        for x in range(CELL):
            found = np.nonzero(mask[:, x])[0]
            if len(found):
                top[x] = found[0]
        lit = ~np.isnan(top)
        tops = top[lit]
        # A tongue is a local peak standing an eighth of a body out of its
        # neighbours; smaller than that is the art's texture, not a tongue.
        reach = body / 12
        tongues = 0
        for index in range(1, len(tops) - 1):
            if tops[index] <= tops[index - 1] and tops[index] <= tops[index + 1]:
                rise = min(max(tops[max(0, index - 4):index + 1]), max(tops[index:index + 5])) - tops[index]
                if rise > reach:
                    tongues += 1
        tallest = int(np.argmin(tops))
        print(
            f"col {column:>3} ({column / 44:.2f})  "
            f"width {width:4.2f}  span {width * 141:5.0f}cp  "
            f"tall {height:4.2f}  solid {solid * 100:4.1f}%  "
            f"tongues {tongues:>3}  tallest {(tallest - (len(tops) - 1) / 2) / body:+.2f} off middle  "
            f"foot y {foot:6.0f}"
        )


if __name__ == "__main__":
    main()
