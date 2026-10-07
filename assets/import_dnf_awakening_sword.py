#!/usr/bin/env python3
"""Bake 魔狱血刹's 血气之剑 (the 短剑) out of the reference clip.

**Why not the client this time.** Every other piece of art here is assembled from
the client's own entries, and this one was too - for six rounds. The client ships
`sword-normal.img` as three lengths of a *steel* sword: a serrated blade with a
thin red edge, a black four-pointed crossguard and a gold eye. The reference does
not draw that. It draws a short red shaft, the same black crossguard and gold eye,
and **a rounded red mass hanging under it** - and no rearrangement of `sword-normal`,
`woong-dodge` or `sim1-dodge` reproduced it well enough to pass. The owner asked
for the two things that do work: 「要不你通过抠图来吧」.

**Where from.** `assets/dnf_src/bilibili/skill-clips/11_魔狱血刹.mp4` is 1440x1080
at 30 fps and the sword is on screen from t=2.07s to t=4.87s at a *constant* size
(80x154 px) - the training clip caught it already grown, which is why it is one
sprite and not a growth ladder. The training room's backdrop is pure black, which
is what makes the key possible at all.

**The frame.** The sword drifts either side of him; `--time 4.667` is one where
he is well clear of it, so the crop holds the sword and nothing else.

**The key is the same border flood fill the cut-in uses** (`import_awakening_cutin.py`):
black reachable from the crop's border is backdrop and goes; black *inside* the
sword - the crossguard and the eye's dark ring - is the sword and stays. A plain
luma threshold would punch the crossguard out of the middle of the sprite.

    ffmpeg must be on PATH (the frame is pulled out of the clip above).
    python3 assets/import_dnf_awakening_sword.py [--time 4.667]

Writes assets/awakening_sword.png (RGBA). The clip it reads is gitignored local
material, the same way the client NPKs are.
"""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent
CLIP = ROOT / "dnf_src" / "bilibili" / "skill-clips" / "11_魔狱血刹.mp4"
OUT = ROOT / "awakening_sword.png"

# The window the sword sits in, in the clip's own 1440x1080 pixels, for the
# default --time. Wide enough to hold the whole sprite with black all round it -
# the flood fill needs a border that is backdrop or it has nowhere to start.
CROP = (652, 424, 756, 586)
# Same number and same reason as the cut-in's: the recording is lossy and the
# black around a glowing sprite comes back at luma 35-50.
DARK = 54


def grab_frame(clip: Path, seconds: float) -> Image.Image:
    if not clip.exists():
        print(f"missing reference clip: {clip}", file=sys.stderr)
        print("see README 「狂战士技能参考」 for the yt-dlp line", file=sys.stderr)
        raise SystemExit(2)
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", str(seconds), "-i", str(clip),
         "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
        check=True, capture_output=True,
    ).stdout
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _widest_row(picture, threshold: int = 24) -> int:
    alpha = picture.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    best, best_row = -1, 0
    for row in range(height):
        left = right = None
        for column in range(width):
            if pixels[column, row] > threshold:
                if left is None:
                    left = column
                right = column
        if left is None:
            continue
        if right - left + 1 > best:
            best, best_row = right - left + 1, row
    return best_row


def _narrow_after(picture, row: int, threshold: int = 24, share: float = 0.78) -> int:
    alpha = picture.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()

    def span(at):
        left = right = None
        for column in range(width):
            if pixels[column, at] > threshold:
                if left is None:
                    left = column
                right = column
        return 0 if left is None else right - left + 1

    wide = span(row)
    if not wide:
        return 0
    cut = wide * share
    step = 0
    while row + step + 1 < height and span(row + step + 1) >= cut:
        step += 1
    return step


def key_backdrop(image: Image.Image, dark: int = DARK) -> Image.Image:
    """Black that touches the border goes; black inside the sword stays."""
    from collections import deque

    width, height = image.size
    pixels = image.load()
    backdrop = [[False] * width for _ in range(height)]
    seen = [[False] * width for _ in range(height)]

    def is_dark(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        return max(red, green, blue) <= dark

    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if is_dark(x, y) and not seen[y][x]:
                seen[y][x] = True
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_dark(x, y) and not seen[y][x]:
                seen[y][x] = True
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        backdrop[y][x] = True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not seen[ny][nx] and is_dark(nx, ny):
                seen[ny][nx] = True
                queue.append((nx, ny))

    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    source = image.load()
    target = out.load()
    for y in range(height):
        for x in range(width):
            red, green, blue = source[x, y]
            target[x, y] = (0, 0, 0, 0) if backdrop[y][x] else (red, green, blue, 255)
    alpha = out.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(alpha)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--time", type=float, default=4.667, help="seconds into the clip")
    parser.add_argument("--clip", type=Path, default=CLIP)
    parser.add_argument("--crop", type=str, default=None, help="x0,y0,x1,y1 override")
    parser.add_argument("--masses", action="store_true",
                        help="also cut the grown masses out of the second clip")
    args = parser.parse_args()

    if args.masses:
        cut_masses()
        return

    crop = CROP
    if args.crop:
        crop = tuple(int(value) for value in args.crop.split(","))

    frame = grab_frame(args.clip, args.time)
    sword = key_backdrop(frame.crop(crop))
    ink = sword.getbbox()
    if ink is None:
        print("nothing keyed out - the crop missed the sword", file=sys.stderr)
        raise SystemExit(1)
    sword = sword.crop(ink)
    sword.save(OUT)
    print(f"wrote {OUT} ({sword.width}x{sword.height}, ink {ink})")




# ---------------------------------------------------------------------------
# **The grown sword's mass, off the second clip.**
#
# `11_魔狱血刹.mp4` catches the sword already grown - its drop is the *short* one,
# and stretching it into the long shape is what the owner sent back: the lobes of
# a 290-px mass squeezed into 70 px band, and the fully-grown sword still wrong
# (「最后完全体的剑不对」).
#
# `BV1oUDLBaEaK.mp4` is the clip the owner pointed at for the growth
# (「1:06到1:16是剑长大的过程」), and it is a *dungeon*, not the training room -
# the backdrop is a blue-grey floor, so the black flood fill cannot run. The key
# there is by colour: the sword is the only strongly red thing in the window, and
# its dark crossguard is recovered by dilating the red envelope and keeping the
# dark pixels inside it.
#
# The stages are the ones the measurement table names, in seconds into that clip
# and the mass height they were measured at (a Slayer is 280 px there):
#
#     68.0 s   99 px     70.0 s  140 px     72.2 s  254 px
#
# Each is cut to `assets/awakening_sword_mass_<t>.png`, the mass only - the split
# is at the crossguard's own bottom edge, the same `_narrow_after` walk the bake
# does.
MASS_CLIP = ROOT / "dnf_src" / "bilibili" / "BV1oUDLBaEaK.mp4"
MASS_STAGES = ((68.0, 99), (69.4, 110), (70.0, 140), (72.2, 254))


def cut_masses() -> None:
    import numpy as np
    import cv2
    from collections import deque

    for seconds, want in MASS_STAGES:
        raw = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-ss", str(seconds), "-i", str(MASS_CLIP),
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            check=True, capture_output=True,
        ).stdout
        frame = Image.open(io.BytesIO(raw)).convert("RGB")
        a = np.array(frame).astype(np.int16)
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        red = ((r - g) > 45) & ((r - b) > 35) & (r > 70)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(red.astype(np.uint8), 8)
        best = None
        for i in range(1, count):
            x, y, w, h, area = stats[i]
            if w > 120 or h < 80 or not (0.7 * want < h < 2.6 * want):
                continue
            if best is None or area > best[0]:
                best = (area, x, y, w, h)
        if best is None:
            print(f"  {seconds}s: no sword found", file=sys.stderr)
            continue
        _, x, y, w, h = best
        keyed = key_red(frame.crop((max(0, x - 12), max(0, y - 12),
                                    x + w + 12, y + h + 12)))
        ink = keyed.getbbox()
        if ink:
            keyed = keyed.crop(ink)
        guard_row = _widest_row(keyed) + _narrow_after(keyed, _widest_row(keyed))
        mass = keyed.crop((0, guard_row, keyed.width, keyed.height))
        box = mass.getbbox()
        if box:
            mass = mass.crop(box)
        target = ROOT / f"awakening_sword_mass_{int(seconds * 10)}.png"
        mass.save(target)
        print(f"wrote {target} ({mass.width}x{mass.height})")


def key_red(image: Image.Image) -> Image.Image:
    """The sword out of a *floor*, not out of black - see `cut_masses`."""
    import numpy as np
    from collections import deque

    a = np.array(image).astype(np.int16)
    height, width, _ = a.shape
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = ((r - g) > 45) & ((r - b) > 35) & (r > 70)
    envelope = np.array(
        Image.fromarray((red * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    ) > 127
    dark = a.mean(2) < 45
    sword = red | (envelope & dark)

    seen = np.zeros((height, width), bool)
    backdrop = np.zeros((height, width), bool)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if not sword[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if not sword[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        backdrop[y, x] = True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not seen[ny, nx] and not sword[ny, nx]:
                seen[ny, nx] = True
                queue.append((nx, ny))

    out = np.dstack([a.astype(np.uint8), ((~backdrop) * 255).astype(np.uint8)])
    keyed = Image.fromarray(out, "RGBA")
    keyed.putalpha(keyed.getchannel("A").filter(ImageFilter.GaussianBlur(0.6)))
    return keyed


if __name__ == "__main__":
    main()
