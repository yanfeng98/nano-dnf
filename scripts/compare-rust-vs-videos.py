#!/usr/bin/env python3
"""Render headless Rust snapshots and stitch side-by-side comparisons against the two reference videos."""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VIDEO_DIR = Path("/home/luyanfeng/luyanfeng/dnf-素材")
V1 = VIDEO_DIR / "00001-幽暗密林.mp4"
V2 = VIDEO_DIR / "00002-幽暗密林深处.mp4"

PAIRS = [
    ("v1_entry", V1, "58"),
    ("v1_boss", V1, "290"),
    ("v2_entry", V2, "25"),
    ("v1_results", V1, "335"),
    ("town", V2, "415"),
]


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/nano-dnf-compare")
    out_dir.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        ["cargo", "run", "--example", "snapshot_reference", "-p", "render-rs", "--", str(out_dir)],
        cwd=REPO / "rust",
        check=True,
    )

    rows = []
    for name, vid, ts in PAIRS:
        ref_jpg = out_dir / f"{name}_ref.png"
        rust_png = out_dir / f"{name}.png"
        pair_png = out_dir / f"{name}_pair.png"
        # Crop centered 4:3 (1440x1080) from 1920x1080 video and scale to native 800x600
        subprocess.run(
            [
                "ffmpeg", "-y", "-ss", ts, "-i", str(vid),
                "-frames:v", "1",
                "-vf", "crop=1440:1080:240:0,scale=800:600",
                str(ref_jpg),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        # Stitch native 800x600 video frame (left) and 800x600 Rust render (right) -> 1600x600 pair
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(ref_jpg), "-i", str(rust_png),
                "-filter_complex",
                "[0:v][1:v]hstack=inputs=2[out]",
                "-map", "[out]", str(pair_png),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        rows.append(pair_png)

    sheet = out_dir / "comparison_sheet.jpg"
    inputs = []
    for p in rows:
        inputs += ["-i", str(p)]
    fc = "".join(f"[{i}:v]" for i in range(len(rows))) + f"vstack=inputs={len(rows)},scale=1600:-1[out]"
    subprocess.run(
        ["ffmpeg", "-y"] + inputs + ["-filter_complex", fc, "-map", "[out]", "-q:v", "3", str(sheet)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    print(f"Side-by-side comparison sheet written to: {sheet}")


if __name__ == "__main__":
    main()
