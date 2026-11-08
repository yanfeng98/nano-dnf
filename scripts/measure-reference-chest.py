#!/usr/bin/env python3
"""Rebuild chest/list reference contact sheets, never runtime assets.

Phase anchors are manual observations with fade-boundary uncertainty; this
script makes their surrounding 30fps frames inspectable, not auto-certified.
"""
import argparse
import json
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos', type=Path, default=Path('../dnf-素材'))
p.add_argument('--out', type=Path, default=Path('/tmp/nano-chest36'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
measurements = []
for video, stage, start, length, reward_at, cards_at in [
    (1, 'mirkwood', 342, 5, 342.8, 346 + 19 / 30),
    (2, 'mirkwooddeep', 396.5, 3.5, 397.0, 399.2),
]:
    source = next(a.videos.glob(f'{video:05d}-*.mp4'))
    raw = subprocess.run([
        'ffmpeg', '-loglevel', 'error', '-ss', str(start), '-i', str(source),
        '-t', str(length), '-vf', 'crop=1440:1080:240:0,scale=720:540',
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
    ], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
    indices = list(range(0, len(frames), 6))
    sheet = Image.new('RGB', (1440, 290 * ((len(indices) + 3) // 4)))
    draw = ImageDraw.Draw(sheet)
    for j, i in enumerate(indices):
        x, y = j % 4 * 360, j // 4 * 290
        sheet.paste(Image.fromarray(frames[i]).resize((360, 270)), (x, y + 20))
        draw.text((x, y), f'V{video} {start+i/30:.3f}s', fill='white')
    sheet.save(a.out / f'36-chest-v{video}-contact.png')
    list_at = 343.3 if video == 1 else 397.3
    list_frame = frames[round((list_at - start) * 30)]
    Image.fromarray(list_frame).crop((100, 140, 360, 270)).resize((1040, 520)).save(
        a.out / f'36-chest-list-v{video}.png')
    measurements.append(dict(stage=stage, source=source.name, reward_at=reward_at,
        spread_at=cards_at, list_seconds=round(cards_at-reward_at, 6),
        uncertainty_seconds=0.2,
        limits='Manual phase anchors across fades; not exact first-visible pixels or a general list-length formula.'))
(a.out / '36-chest-measurement.json').write_text(json.dumps(measurements, indent=2)+'\n')
print(json.dumps(measurements, indent=2))
