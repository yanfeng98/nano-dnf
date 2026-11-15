#!/usr/bin/env python3
"""Extract V2 room25 target captions, complete logs and counter for manual review.

Extraction is reproducible; this script does not perform OCR or infer a roster.
Manual readings and native map records must be checked before adopting a roster.
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
p.add_argument('--out', type=Path, default=Path('/tmp/nano144-room25'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '312', '-i', str(a.video),
    '-t', '76', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 152
selected = []
for page in range(7):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 312 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        frame.save(a.out / f'144-v2-{time:g}-room25.png')
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [312.5, 320, 325, 330, 340, 350, 360, 370, 380, 386, 387.5]:
            name = f'144-v2-{time:g}-room25.png'
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((a.out / name).read_bytes()).hexdigest()))
    targets.save(a.out / f'144-room25-targets-{page}.jpg', quality=95)
    logs.save(a.out / f'144-room25-logs-{page}.jpg', quality=95)
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
report = dict(video=a.video.name, sourceFps=30, start=312, strideFrames=15, samples=152,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '25']) for c in native['clients']],
              limits=['Manual caption/log annotations, not automatic OCR.',
                      'The window map occludes the kill counter; no independently readable counter delta is claimed.',
                      'Native map counts alone do not prove the recorded total or spawn timing.',
                      'No runtime XP formula, actor depth or AI is inferred by extraction.'])
(a.out / '144-room25-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room25: 152 half-second frames extracted; manual roster, death credits and bunker spawns remain to review.')
