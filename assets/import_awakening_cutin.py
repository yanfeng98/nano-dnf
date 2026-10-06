#!/usr/bin/env python3
"""Bake 魔狱血刹's 觉醒插画 (the cut-in) out of the reference clip.

**Why not the client.** The one place every other piece of art in this game comes
from has nothing here: the client ships no 一觉 illustration for the Berserker -
`sprite_interface2_awakening` carries the class's name plate ("狱血魔神
Hellbenter") and a button frame, and the only two big character plates in the
whole install are the *second* awakening's (`awakening2_cha.img` f2, 血魔, and
`sword_berserker_neo_buff.img`), which are another awakening's look. So the
picture comes from the reference the owner handed over instead.

**Where from, and which frame.** `assets/dnf_src/bilibili/skill-clips/
11_魔狱血刹.mp4` is 1440x1080 at 30fps and its cut-in is on screen from t=0.85s
to t=1.88s: the white-maned 狱血魔神 slides in from the left and holds. t=1.50s
is the fullest pose of the hold, and the training room's backdrop is pure black
- which is what makes this bake possible at all.

**The crop stops at the HUD line.** The clip's own skill bar is painted *over*
the illustration's lower body from y~900 down, and the subtitle "4.20开" sits at
y~885-945; the bake keeps y < 884 so neither ends up inside the picture. What is
left is the part the reference itself shows above its own HUD, which is also
where the cut-in sits in the running game (the bar is drawn over it there too).

**The key is a flood fill, not a threshold.** A plain luma ramp (what
`key_black_background` in import_dnf_effects.py does) eats the illustration's own
dark pixels - the demon's black outline and the shadowed half of its mane - and
those holes read as damage once the picture is over a room that is not black. So
the black is found instead: everything connected to the frame's border through
dark pixels is backdrop and goes transparent; dark pixels *inside* the figure are
the figure and stay. A one-pixel feather keeps the silhouette from looking
sawtoothed.

    ffmpeg must be on PATH (the frame is pulled out of the clip above).
    python3 assets/import_awakening_cutin.py [--time 1.50]

Writes assets/awakening.png (RGBA). The clip it reads is gitignored local
material, the same way the client NPKs are - see README's 「狂战士技能参考」.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
CLIP = ROOT / "dnf_src" / "bilibili" / "skill-clips" / "11_魔狱血刹.mp4"
OUT = ROOT / "awakening.png"

# The region to keep, in the clip's own 1440x1080 pixels. x starts at 0 because
# the illustration itself is cut by the frame's left edge in the clip - the
# reference's cut-in hangs off the corner - and the renderer puts that edge on
# the screen's own edge, so the two cuts are the same cut.
CROP = (0, 588, 560, 884)
# A pixel this dark *and* reachable from the border is backdrop. 54 rather than
# a tighter number because the recording is lossy: the black around the figure
# comes back at luma 35-50 in the glow's halo, and at 34 those pixels stayed as
# grey smears along the left edge. The figure's own darks are all *inside* it, so
# the flood fill never reaches them at either number.
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
    import io

    return Image.open(io.BytesIO(raw)).convert("RGB")


def key_backdrop(image: Image.Image, dark: int = DARK) -> Image.Image:
    """Black that touches the border goes; black inside the figure stays."""
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
    # One pixel of feather on the silhouette; without it the crop of a video
    # frame goes in with a hard, blocky edge at 1:1.
    alpha = out.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(alpha)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--time", type=float, default=1.50, help="seconds into the clip")
    parser.add_argument("--clip", type=Path, default=CLIP)
    args = parser.parse_args()

    frame = grab_frame(args.clip, args.time)
    cut_in = key_backdrop(frame.crop(CROP))
    box = cut_in.getbbox()
    cut_in.save(OUT)
    print(f"wrote {OUT} ({cut_in.width}x{cut_in.height}, ink {box})")


if __name__ == "__main__":
    main()
