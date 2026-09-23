#!/usr/bin/env python3
"""Slice the downloaded Bilibili Berserker showcase into one clip per skill.

The reference video (assets/dnf_src/bilibili/BV1oUDLBaEaK.mp4, "当年转职成
狂战士…魔狱血刹") walks the 狂战士 skill set through the training room: on a
black background, one skill at a time, its name large at the top and a level
caption ("10级技能崩山击") along the bottom. Every skill owns a slice of the
timeline and the cut between two of them is where that big top title changes,
so the whole preview run is read off the top-band motion of the frames.

Writes per skill:
  assets/dnf_src/bilibili/skill-clips/<NN>_<Name>.mp4   that skill's clip
  assets/dnf_src/bilibili/skill-clips/<NN>_<Name>.png   contact sheet, every frame
  assets/dnf_src/bilibili/skill-clips/_overview.png     first frame of every skill
  assets/dnf_src/bilibili/skill-clips/INDEX.txt         the manifest

Outputs are DNF art references (gitignored); the script is the record of how
they were cut, and `--detect` re-derives the boundaries for verification.
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
BILI_DIR = ROOT / "dnf_src" / "bilibili"
OUT_DIR = BILI_DIR / "skill-clips"
DEFAULT_INPUT = BILI_DIR / "BV1oUDLBaEaK.mp4"

# The training-room section runs from the first card (a ~0.4s crossfade out of
# the boss fight, clean by 11.4) to the skill-tree window (57.63). Inside it the
# top title changes at these frames; each entry is (name, level, start, end).
SEGMENTS = (
    ("崩山击", 10, 11.550, 13.567),
    ("十字斩", 15, 13.567, 16.567),
    ("死亡抗拒", 20, 16.567, 19.667),
    ("嗜魂之手", 25, 19.667, 22.867),
    ("暴走", 25, 22.867, 26.300),
    ("血气分流", 30, 26.300, 29.367),
    ("血之狂暴", 35, 29.367, 32.900),
    ("怒气爆发", 35, 32.900, 36.133),
    ("嗜魂封魔斩", 40, 36.133, 42.000),
    ("崩山裂地斩", 45, 42.000, 46.533),
    ("魔狱血刹", 50, 46.533, 57.633),
)

# The preview run lives between the boss-fight flash and the skill tree; the
# detector only scans here so a gameplay explosion can't be mistaken for a cut.
DETECT_WINDOW = (11.0, 58.0)

FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def cut_clip(src: pathlib.Path, start: float, end: float, out: pathlib.Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", str(src),
            "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
            "-c:v", "libx264", "-crf", "16", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(out),
        ],
        check=True,
    )


def frames_of(path: pathlib.Path):
    import av

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return [Image.fromarray(f.to_ndarray(format="rgb24")) for f in container.decode(stream)]


def contact_sheet(title: str, frames, out: pathlib.Path, columns: int = 12, cell: int = 150) -> None:
    font = load_font(12)
    head = load_font(18)
    rows = -(-len(frames) // columns)
    sheet = Image.new("RGB", (columns * cell, rows * (cell + 20) + 28), (18, 18, 26))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 4), f"{title} — {len(frames)} 帧", fill=(255, 235, 150), font=head)
    for index, frame in enumerate(frames):
        column, row = index % columns, index // columns
        x, y = column * cell, 28 + row * (cell + 20)
        scale = min((cell - 8) / frame.width, (cell - 8) / frame.height, 1.0)
        size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
        sheet.paste(frame.resize(size, Image.LANCZOS), (x + (cell - size[0]) // 2, y + 16 + (cell - size[1]) // 2))
        draw.text((x + 3, y), str(index), fill=(150, 200, 255), font=font)
    sheet.save(out)


def detect_boundaries(src: pathlib.Path) -> list[float]:
    """Top-band motion peaks inside DETECT_WINDOW = the skill-title cuts."""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS)
    diffs: list[float] = []
    prev = None
    while True:
        if not cap.grab():
            break
        ok, frame = cap.retrieve()
        if not ok:
            break
        band = cv2.cvtColor(frame[0:150, 0:1080], cv2.COLOR_BGR2GRAY).astype(np.int16)
        diffs.append(0.0 if prev is None else float(np.abs(band - prev).mean()))
        prev = band
    cap.release()
    diffs = np.asarray(diffs)
    lo, hi = int(DETECT_WINDOW[0] * fps), int(DETECT_WINDOW[1] * fps)
    score = diffs[lo:hi]
    peaks: list[int] = []
    for idx in range(1, len(score) - 1):
        if score[idx] > 12 and score[idx] == score[idx - 1:idx + 2].max():
            if not peaks or idx - peaks[-1] > int(0.4 * fps):
                peaks.append(idx)
    return [(lo + p) / fps for p in peaks]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=pathlib.Path, default=DEFAULT_INPUT)
    parser.add_argument("--out", type=pathlib.Path, default=OUT_DIR)
    parser.add_argument("--detect", action="store_true", help="print auto-detected cuts and exit")
    args = parser.parse_args()

    if args.detect:
        print("detected cuts:", ", ".join(f"{t:.3f}" for t in detect_boundaries(args.input)))
        print("table starts :", ", ".join(f"{s[2]:.3f}" for s in SEGMENTS))
        return 0

    if not args.input.exists():
        print(f"missing input {args.input}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    index: list[str] = []
    first_frames: list[tuple[str, Image.Image]] = []

    for number, (name, level, start, end) in enumerate(SEGMENTS, 1):
        stem = f"{number:02d}_{name}"
        clip = args.out / f"{stem}.mp4"
        cut_clip(args.input, start, end, clip)
        frames = frames_of(clip)
        if not frames:
            print(f"  {stem}: no frames", file=sys.stderr)
            continue
        title = f"{number:02d} {name} · Lv{level} · {start:.2f}-{end:.2f}s"
        contact_sheet(title, frames, args.out / f"{stem}.png")
        first_frames.append((f"{number:02d} {name} (Lv{level})", frames[0]))
        index.append(f"{stem}.mp4: {name} (Lv{level}) t={start:.3f}-{end:.3f}s, {len(frames)} frames")
        print(f"  {stem}: {len(frames)} frames")

    if first_frames:
        cols, cell = 4, 360
        rows = -(-len(first_frames) // cols)
        sheet = Image.new("RGB", (cols * cell, rows * (cell + 30) + 8), (18, 18, 26))
        draw = ImageDraw.Draw(sheet)
        font = load_font(20)
        for i, (name, frame) in enumerate(first_frames):
            x, y = (i % cols) * cell, (i // cols) * (cell + 30) + 8
            scale = min((cell - 8) / frame.width, (cell - 8) / frame.height, 1.0)
            sheet.paste(frame.resize((int(frame.width * scale), int(frame.height * scale)), Image.LANCZOS), (x + 4, y + 4))
            draw.text((x + 8, y + cell), name, fill=(255, 235, 150), font=font)
        sheet.save(args.out / "_overview.png")

    (args.out / "INDEX.txt").write_text(
        f"source: {args.input.name} (Bilibili BV1oUDLBaEaK, 狂战士 training-room run)\n"
        + "\n".join(index) + "\n"
    )
    print(f"wrote {len(index)} clips to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
