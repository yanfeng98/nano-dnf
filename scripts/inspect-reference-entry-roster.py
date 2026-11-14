#!/usr/bin/env python3
"""Reproduce the four manually identified V1 entry-room target labels.

This extracts evidence, not OCR. The labels below are human readings of the
saved target crops; counter 0 -> 4 and clear evidence is from audits110/115.
No recording pixels are copied to runtime assets.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path,
                        default=Path(__file__).resolve().parents[2] / "dnf-素材/00001-幽暗密林.mp4")
    parser.add_argument("--out", type=Path, default=Path("/tmp/nano119-entry-roster"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cases = [(62, "coward", "胆小哥布林"), (64, "cursedRed", "诅咒之赤哥布林"),
             (65.5, "caster", "投掷哥布林"), (66.5, "grunt", "哥布林")]
    sheet = Image.new("RGB", (720, 100 * len(cases)), "#181818")
    draw = ImageDraw.Draw(sheet)
    rows = []
    for index, (time, enemy_type, label) in enumerate(cases):
        png = subprocess.run([
            "ffmpeg", "-loglevel", "error", "-ss", str(time), "-i", str(args.video),
            "-frames:v", "1", "-vf", "crop=1440:1080:240:0,scale=720:540",
            "-f", "image2pipe", "-vcodec", "png", "-"
        ], capture_output=True, check=True).stdout
        frame = Image.open(io.BytesIO(png)).convert("RGB")
        assert frame.size == (720, 540)
        name = f"119-entry-{time:g}-reference.png"
        (args.out / name).write_bytes(png)
        roi = frame.crop((0, 43, 360, 85))
        sheet.paste(roi.resize((720, 84)), (0, index * 100 + 16))
        draw.text((0, index * 100), f"V1 {time:g}s: {enemy_type} Lv4", fill="white")
        rows.append({"time": time, "type": enemy_type, "label": label, "level": 4,
                     "category": "人型", "file": name,
                     "frameSha256": hashlib.sha256(png).hexdigest(),
                     "roi": [0, 43, 360, 42],
                     "roiRgbSha256": hashlib.sha256(roi.tobytes()).hexdigest()})
    sheet.save(args.out / "119-entry-targets.png")
    report = {
        "source": args.video.name,
        "normalization": "crop centred1440x1080 at x240; scale720x540",
        "method": "manual target-name/portrait reading; extraction is reproducible, not automated OCR",
        "observations": rows,
        "countEvidence": "audits110/115: counter0 before combat and4 before leaving cleared entry",
        "limits": ["No exact spawn coordinates, AI, HP or XP formula is established here.",
                   "Four distinct types plus four total kills support one of each in this recorded room.",
                   "Initial placement of the four runtime slots is retained pending separate measurement."]
    }
    (args.out / "119-entry-roster-reference.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("V1 entry target crops extracted:", [(r["time"], r["label"]) for r in rows])


if __name__ == "__main__":
    main()
