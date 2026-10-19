#!/usr/bin/env python3
"""Cut the two portraits the reference recording already shows.

Both are **the recording's own pixels**, not redrawn:

- `assets/boss_portrait.png` — the 80x80 bull-head portrait in the lord's
  target frame at t=250s (video 1920x1080, crop `[248,86,80,80]`).
- `assets/reward_avatar.png` — the 52x60 player face in the name plate on the
  clear reward page at t=354s (crop `[270,264,52,60]`).

Why not bake them from the client? The client's `tau/body02.img` is a **side
view**; at 40 px it reads as a shoulder, not the face the recording's target
frame shows, and the reward page's name-plate avatar is a UI portrait the
client keeps inside `Script.pvf`. The recording is the authority the owner
compares against, and this is the same provenance the 觉醒插画 already uses
(`assets/import_awakening_cutin.py`).

    python3 assets/import_reference_portraits.py
    python3 assets/import_reference_portraits.py --video /path/to/00001-幽暗密林.mp4
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_VIDEO = pathlib.Path(
    "/home/luyanfeng/luyanfeng/dnf-dungeon-videos/00001-幽暗密林.mp4")
OUT_BOSS = ROOT / "assets" / "boss_portrait.png"
OUT_AVATAR = ROOT / "assets" / "reward_avatar.png"

# (output, timestamp, crop) — crops are in the 1920x1080 frame.
CUTS = [
    (OUT_BOSS, 250.0, (248, 86, 328, 166)),
    (OUT_AVATAR, 354.0, (270, 264, 322, 324)),
]


def ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    local = pathlib.Path.home() / ".local" / "bin" / "ffmpeg"
    if local.exists():
        return str(local)
    raise SystemExit("ffmpeg not found (PATH or ~/.local/bin)")


def frame_at(video: pathlib.Path, seconds: float, target: pathlib.Path) -> Image.Image:
    subprocess.run(
        [ffmpeg(), "-hide_banner", "-loglevel", "error", "-ss", str(seconds),
         "-i", str(video), "-frames:v", "1", "-y", str(target)],
        check=True,
    )
    return Image.open(target).convert("RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=pathlib.Path, default=DEFAULT_VIDEO)
    args = ap.parse_args()
    if not args.video.exists():
        raise SystemExit(f"reference video not found: {args.video}")

    with tempfile.TemporaryDirectory() as tmp:
        for index, (out, seconds, box) in enumerate(CUTS):
            frame = frame_at(args.video, seconds, pathlib.Path(tmp) / f"{index}.png")
            crop = frame.crop(box)
            out.parent.mkdir(parents=True, exist_ok=True)
            crop.save(out)
            print(f"{out.name}: {crop.width}x{crop.height} <- t={seconds}s {box}")


if __name__ == "__main__":
    main()
