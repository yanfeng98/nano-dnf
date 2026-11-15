#!/usr/bin/env python3
"""Extract V2 room13 target captions, complete logs and counter for manual review.

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
p.add_argument('--out', type=Path, default=Path('/tmp/nano142-room13'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '190', '-i', str(a.video),
    '-t', '46', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 92
selected = []
for page in range(4):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 190 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        frame.save(a.out / f'142-v2-{time:g}-room13.png')
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [190.5, 195, 197.5, 198, 199, 199.5, 200, 205, 205.5, 206, 209, 209.5, 210, 211, 211.5, 215, 219.5, 220, 225, 229.5, 230, 231.5, 232, 232.5, 233, 235]:
            name = f'142-v2-{time:g}-room13.png'
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((a.out / name).read_bytes()).hexdigest()))
    targets.save(a.out / f'142-room13-targets-{page}.jpg', quality=95)
    logs.save(a.out / f'142-room13-logs-{page}.jpg', quality=95)
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
# Manual readings, not OCR output.
credit_windows = [(197.5, 198, 1), (199, 199.5, 1), (205.5, 206, 1), (209, 209.5, 1), (211, 211.5, 1), (219.5, 220, 1), (229.5, 230, 1), (231.5, 232, 1), (232.5, 233, 1)]
report = dict(manualCreditWindows=[dict(start=a,end=b,new60Credits=n) for a,b,n in credit_windows],
              manualCreditTotal=540, manualRoster={'goblinRed':2,'goblinBlue':2,'cat':2,'deepElite':2,'throwerElite':1}, video=a.video.name, sourceFps=30, start=190, strideFrames=15, samples=92,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '13']) for c in native['clients']],
              limits=['Manual caption/log annotations, not automatic OCR.',
                      'The window map occludes the kill counter; no independently readable counter delta is claimed.',
                      'Native map counts alone do not prove the recorded total or spawn timing.',
                      'No runtime XP formula, actor depth or AI is inferred by extraction.'])
(a.out / '142-room13-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room13: 92 half-second frames extracted; manual roster, death credits and bunker spawns remain to review.')
