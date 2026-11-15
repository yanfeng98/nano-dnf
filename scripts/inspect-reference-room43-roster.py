#!/usr/bin/env python3
"""Extract V2 room43 target captions, complete logs and counter for manual review.

Extraction is reproducible; this script does not perform OCR or infer a roster.
The annotated roster below was checked manually against continuous target/log sheets.
"""
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
p.add_argument('--out', type=Path, default=Path('/tmp/nano139-room43'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '74', '-i', str(a.video),
    '-t', '32', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 64
selected = []
for page in range(3):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 74 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        frame.save(a.out / f'139-v2-{time:g}-room43.png')
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [74.5, 76, 80, 82.5, 90, 95, 100, 104.5]:
            name = f'139-v2-{time:g}-room43.png'
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((a.out / name).read_bytes()).hexdigest()))
    targets.save(a.out / f'139-room43-targets-{page}.jpg', quality=95)
    logs.save(a.out / f'139-room43-logs-{page}.jpg', quality=95)
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
report = dict(video=a.video.name, sourceFps=30, start=74, strideFrames=15, samples=64,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '43']) for c in native['clients']],
              manualTargets=[dict(time=80, type='goblinRed', level=6),
                             dict(time=82.5, type='deepElite', level=6),
                             dict(time=83, type='throwerElite', level=6),
                             dict(time=90, type='goblinBlue', level=6)],
              manualRoster=[dict(type='goblinRed', level=6, count=2, creditEach=60),
                            dict(type='goblinBlue', level=6, count=2, creditEach=60),
                            dict(type='deepElite', level=6, count=3, creditEach=60),
                            dict(type='throwerElite', level=6, count=1, creditEach=60)],
              manualCreditWindows=[dict(start=80, end=84, credits=[60, 60, 60]),
                                   dict(start=90, end=94, credits=[60, 60, 60]),
                                   dict(start=95, end=100.5, credits=[60, 60])],
              totalCredit=480,
              limits=['Manual caption/log annotations, not automatic OCR.',
                      'The window map occludes the kill counter; no independently readable counter delta is claimed.',
                      'Native map counts alone do not prove the recorded total or spawn timing.',
                      'No runtime XP formula, actor depth or AI is inferred by extraction.'])
(a.out / '139-room43-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room43: two Lv6 red, two Lv6 blue, three Lv6 captains, one Lv6 thrower; eight60 credits=480. Counter occluded.')
