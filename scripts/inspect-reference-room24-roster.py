#!/usr/bin/env python3
"""Extract V2 room24 target captions, complete logs and counter for manual review.

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
p.add_argument('--out', type=Path, default=Path('/tmp/nano143-room24'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '277', '-i', str(a.video),
    '-t', '35', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 70
selected = []
for page in range(3):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 277 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        frame.save(a.out / f'143-v2-{time:g}-room24.png')
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [277.5, 280, 285, 285.5, 286, 290, 292, 292.5, 295, 300, 300.5, 301, 302, 302.5, 304.5, 305, 310, 311, 311.5]:
            name = f'143-v2-{time:g}-room24.png'
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((a.out / name).read_bytes()).hexdigest()))
    targets.save(a.out / f'143-room24-targets-{page}.jpg', quality=95)
    logs.save(a.out / f'143-room24-logs-{page}.jpg', quality=95)
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
# These are manual log readings, not OCR output.
credit_windows = [(285.5, 286, 3), (292, 292.5, 3), (300.5, 301, 1), (302, 302.5, 1), (304.5, 305, 1), (311, 311.5, 1)]
report = dict(manualCreditWindows=[dict(start=a,end=b,new60Credits=n) for a,b,n in credit_windows],
              manualCreditTotal=600, manualRoster={'goblinRed':3,'goblinBlue':4,'deepElite':2,'throwerElite':1}, video=a.video.name, sourceFps=30, start=277, strideFrames=15, samples=70,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '24']) for c in native['clients']],
              limits=['Manual caption/log annotations, not automatic OCR.',
                      'The window map occludes the kill counter; no independently readable counter delta is claimed.',
                      'Native map counts alone do not prove the recorded total or spawn timing.',
                      'No runtime XP formula, actor depth or AI is inferred by extraction.'])
(a.out / '143-room24-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room24: 70 half-second frames extracted; manual roster, death credits and bunker spawns remain to review.')
