#!/usr/bin/env python3
"""Extract deep-entry targets/logs for manual roster and credit review, not OCR."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=ROOT.parent / 'dnf-素材/00002-幽暗密林深处.mp4')
p.add_argument('--out', type=Path, default=Path('/tmp/nano136-deep-entry'))
args = p.parse_args()
if args.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime art')
args.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '12', '-i', str(args.video),
    '-t', '14', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 28
targets = Image.new('RGB', (1440, 1400), '#181818')
scenes = Image.new('RGB', (1440, 2065), '#181818')
target_labels, scene_labels = ImageDraw.Draw(targets), ImageDraw.Draw(scenes)
selected = []
for index, rgb in enumerate(frames):
    time = 12 + index / 2
    frame = Image.fromarray(rgb)
    name = f'136-v2-{time:g}-entry.png'
    frame.save(args.out / name)
    x, y = index % 2 * 720, index // 2 * 100
    targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
    target_labels.text((x, y), f'V2 {time:g}s', fill='white')
    x, y = index % 4 * 360, index // 4 * 295
    scenes.paste(frame.resize((360, 270)), (x, y + 20))
    scene_labels.text((x, y), f'V2 {time:g}s', fill='white')
    if time in [12, 15.5, 17.5, 20.5, 21, 23.5, 25.5]:
        selected.append(dict(time=time, frame=name,
                             sha256=hashlib.sha256((args.out / name).read_bytes()).hexdigest()))
targets.save(args.out / '136-entry-targets.png')
scenes.save(args.out / '136-entry-scenes.png')
report = dict(
    video=args.video.name, sourceFps=30, sampleStart=12, strideFrames=15, sampleCount=28,
    method='Manual target-name/level/log/counter reading; extraction is reproducible, not OCR',
    selectedFrames=selected,
    observations=[
        dict(type='goblinRed', label='赤哥布林', level=5, count=4, creditEach=50,
             targetTimes=[12, 13.5, 15.5, 18, 20.5], logEvidenceTime=21),
        dict(type='goblinBlue', label='青哥布林', level=6, count=3, creditEach=60,
             targetTimes=[21, 22.5, 25.5], logEvidenceTime=25.5),
    ],
    clearCounter=7, totalDeathCredit=380,
    limits=[
        'Four50 logs are readable at21s, three60 logs at25.5s; the cumulative counter reaches7.',
        'No numeric enemy HP, AI, physical position or exact entry/spawn timing is inferred.',
        'A blue goblin is visible before the later blue target selection; the old wave trigger is not validated.',
        'These credits are room-specific observations, not a global monster-level formula.',
        'Player starting XP and progression thresholds remain uncalibrated.',
    ])
(args.out / '136-deep-entry-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Deep entry: four Lv5 red50 + three Lv6 blue60 =380; exact28-frame extraction complete.')
