"""Measure one frame of an effect against the reference's own numbers.

    python3 assets/measure_effect.py --box x0,y0,x1,y1 --char-h 75 shot.png

Everything comes out in **Slayer-heights** (身位), so a frame off the 1440x1080
reference and a frame off our own 1120x720 capture are the same kind of number:
the box says where the effect is, `--char-h` says how tall the character is in
that picture, and the rest is arithmetic.

Two groups of numbers, because the owner's complaints are two different things:

  * the fire's **top profile** - how wide it runs, how high it stands, how far
    the tall tongues outrun the short ones (`p90/p10`), how many tongues stand
    out of it at all, and where the tallest one sits. A rank whose tallest
    tongue is dead centre reads as 「中间高，两边低」 however tall it is.
  * its **solidity** - the share of the effect's own bounding box that is lit
    red at all. A comb of thin strands and a solid mass of blood can have the
    same profile and read nothing alike, which is what 「参差」 turned out to
    mean when it was measured.

The reference is 2.9x our scale (its Slayer is 222px, ours 84). Pixel-level
thresholds fragment differently at those two densities, so **pass a reference
frame through `--rescale-to` first** when comparing across the two - otherwise
it reports tongues that are only an artefact of the bigger picture.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def hot_mask(pixels: np.ndarray) -> np.ndarray:
    """Lit red: clearly red-dominant and not dark. Ours and the reference's fire
    are both blood red, so one test reads both."""
    red, green, blue = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    return (red > 90) & (red > green * 1.9 + 12) & (red > blue * 1.9 + 12)


def row_extent(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """Topmost lit row per column, and the bottom of the whole effect."""
    rows = np.nonzero(mask.any(axis=1))[0]
    bottom = int(rows.max())
    top = np.full(mask.shape[1], np.nan)
    for x in range(mask.shape[1]):
        column = np.nonzero(mask[:, x])[0]
        if len(column):
            top[x] = column[0]
    return top, bottom


def report(path: Path, box, char_h: float, rescale_to: float | None) -> None:
    image = Image.open(path).convert("RGB")
    if rescale_to:
        # Normalise the *picture* to our scale before measuring, so a tongue has
        # the same number of pixels under it in both.
        scale = rescale_to / char_h
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
        box = tuple(round(value * scale) for value in box)
        char_h = rescale_to
    pixels = np.asarray(image).astype(int)
    x0, y0, x1, y1 = box
    crop = pixels[y0:y1, x0:x1]
    mask = hot_mask(crop)
    top, bottom = row_extent(mask)
    lit = ~np.isnan(top)
    if lit.sum() < 5:
        print(f"{path.name}: nothing lit in {box}")
        return
    heights = (bottom - top[lit]) / char_h
    heights = heights[heights > 0.05]
    columns = np.nonzero(lit)[0]
    span = (columns.max() - columns.min() + 1) / char_h
    # A tongue is a local top that stands at least a twelfth of a body above
    # its neighbours; anything smaller is the art's own texture, not a tongue.
    prominence = char_h / 12
    profile = np.where(np.isnan(top), bottom, top)[lit]
    peaks = [
        index
        for index in range(1, len(profile) - 1)
        if profile[index] <= profile[index - 1]
        and profile[index] <= profile[index + 1]
        and min(max(profile[max(0, index - 4):index + 1]), max(profile[index:index + 5])) - profile[index]
        > prominence
    ]
    tallest = int(np.argmin(profile))
    middle = (len(profile) - 1) / 2
    print(f"--- {path.name}")
    print(f"    width      {span:5.2f} 身位")
    print(f"    height     mean {heights.mean():4.2f}  p10 {np.percentile(heights, 10):4.2f}"
          f"  p90 {np.percentile(heights, 90):4.2f}  max {heights.max():4.2f} 身位")
    print(f"    p90/p10    {np.percentile(heights, 90) / max(np.percentile(heights, 10), 0.01):5.2f}"
          f"      tongues {len(peaks)}")
    print(f"    solidity   {mask.sum() / mask.size * 100:5.1f}%")
    print(f"    tallest at {(tallest - middle) / char_h:+.2f} 身位 off the middle")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path, nargs="+")
    parser.add_argument("--box", required=True, help="x0,y0,x1,y1 in the picture's own pixels")
    parser.add_argument("--char-h", type=float, required=True,
                        help="the character's height in that picture, in its own pixels")
    parser.add_argument("--rescale-to", type=float, default=None,
                        help="resize so the character measures this tall before measuring")
    args = parser.parse_args()
    box = tuple(int(value) for value in args.box.split(","))
    for frame in args.frames:
        report(frame, box, args.char_h, args.rescale_to)


if __name__ == "__main__":
    main()
