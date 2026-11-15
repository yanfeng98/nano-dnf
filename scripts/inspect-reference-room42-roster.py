#!/usr/bin/env python3
"""Extract continuous room42 targets, complete logs and counters for manual review.

This is not OCR. No recording pixels become runtime artwork.
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
p.add_argument('--out', type=Path, default=Path('/tmp/nano138-room42-evidence'))
args = p.parse_args()
if args.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime art')
args.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '26', '-i', str(args.video),
    '-t', '48', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 96
selected = []
widths = []
for page in range(4):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 26 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [49, 53.5, 54, 55, 58]:
            pixels = rgb.astype(float)
            r, g, b = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
            gold = ((r > 100) & (g > 90) & (b > 45) & (r > g * .95) &
                    (r < g * 1.4) & (g > b * 1.08) & (g < b * 1.9))
            candidates = []
            for y in [62, 75, 76]:
                xs = np.where(gold[y, 35:260])[0]
                if len(xs) > 100:
                    candidates.append(int(xs[-1]) + 36)
            edge = float(np.median(candidates)) if candidates else None
            assert edge is not None and abs((edge - 39.75) - 196) <= 2
            widths.append(dict(time=time, borderRightExclusive=candidates,
                               estimatedFillWidth=edge - 39.75, referenceProfileWidth=196))
        if time in [27.5, 35.5, 40.5, 41, 44, 45.5, 49, 52, 58, 59.5, 65, 73.5]:
            name = f'138-v2-{time:g}-room42.png'
            frame.save(args.out / name)
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((args.out / name).read_bytes()).hexdigest()))
    targets.save(args.out / f'138-room42-targets-{page}.png')
    logs.save(args.out / f'138-room42-logs-{page}.png')
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
report = dict(video=args.video.name, sourceFps=30, start=26, strideFrames=15, samples=96,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '42']) for c in native['clients']],
              manualObservations=[dict(time=27.5, counter=7, target='throwerElite', level=6),
                                  dict(time=40.5, target='deepElite', level=6),
                                  dict(time=49, target='cat', level=7),
                                  dict(time=58, target='cat', level=7, floatingCredit=70),
                                  dict(time=73.5, counter=15)],
              manualRoster=[dict(type='deepElite', level=6, count=2, creditEach=60),
                            dict(type='throwerElite', level=6, count=3, creditEach=60),
                            dict(type='cat', level=6, count=2, creditEach=60),
                            dict(type='cat', level=7, count=1, creditEach=70)],
              totalCredit=490, cat7TargetWidths=widths,
              targetWidthMethod='Gold border endpoints at normalized rows62/75/76, fill origin39.75; compression tolerance2px. Observed profile, not HP formula.',
              limits=['Manual readings, not automatic OCR.',
                      'Full log crops are necessary: new credits append below the first two lines.',
                      'Native map records corroborate the count and types, not a general server level formula.',
                      'Later target selection does not establish later spawning; old death-triggered waves lack evidence.',
                      'Native X projection does not establish exact depth, jitter, activation or AI.',
                      'Global progression and the other rooms remain unresolved.'])
(args.out / '138-room42-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room42: two Lv6 captains + three Lv6 throwers + two Lv6 cats + one Lv7 cat; eight kills,490 XP.')
