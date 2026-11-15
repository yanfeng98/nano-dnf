#!/usr/bin/env python3
"""Extract V2 room33 target captions, complete logs and counter for manual review.

Extraction is reproducible; this script does not perform OCR or infer a roster.
Manual reading and native bunker spawn rules must be checked before adopting a roster.
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
p.add_argument('--out', type=Path, default=Path('/tmp/nano140-room33'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '106', '-i', str(a.video),
    '-t', '42', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 84
selected = []
for page in range(4):
    targets = Image.new('RGB', (1440, 1200), '#181818')
    logs = Image.new('RGB', (1440, 1200), '#181818')
    td, ld = ImageDraw.Draw(targets), ImageDraw.Draw(logs)
    for i, rgb in enumerate(frames[page * 24:(page + 1) * 24]):
        time = 106 + (page * 24 + i) / 2
        frame = Image.fromarray(rgb)
        frame.save(a.out / f'140-v2-{time:g}-room33.png')
        x, y = i % 2 * 720, i // 2 * 100
        td.text((x, y), f'V2 {time:g}s', fill='white')
        targets.paste(frame.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        x, y = i % 6 * 240, i // 6 * 300
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        logs.paste(frame.crop((12, 95, 252, 345)), (x, y + 16))
        logs.paste(frame.crop((595, 25, 660, 50)), (x, y + 270))
        if time in [106.5, 110, 118, 125, 133, 138, 142, 146, 112, 112.5, 124.5, 128, 128.5, 140.5, 141, 142.5, 144, 144.5]:
            name = f'140-v2-{time:g}-room33.png'
            selected.append(dict(time=time, file=name, sha256=hashlib.sha256((a.out / name).read_bytes()).hexdigest()))
    targets.save(a.out / f'140-room33-targets-{page}.jpg', quality=95)
    logs.save(a.out / f'140-room33-logs-{page}.jpg', quality=95)
# Number the eight visible log rows so manual shift alignments can be audited.
numbered = Image.new('RGB', (1000, 900), '#181818')
nd = ImageDraw.Draw(numbered)
for i, time in enumerate([106, 112.5, 125, 128.5, 139, 141, 142.5, 144.5]):
    x, y = i % 4 * 250, i // 4 * 450
    frame = Image.fromarray(frames[round((time - 106) * 2)])
    nd.text((x, y), str(time), fill='white')
    for row in range(8):
        numbered.paste(frame.crop((20, 101 + row * 17, 220, 116 + row * 17)).resize((220, 30)),
                       (x + 20, y + 30 + row * 45))
        nd.text((x, y + 30 + row * 45), str(row + 1), fill='white')
numbered.save(a.out / '140-room33-numbered-logs.png')
native = json.loads((ROOT / 'docs/reference-evidence/137-room14-roster-reference.json').read_text())
# Manual readings are declared separately from the automated extraction.
credit_windows = [(112,112.5,1),(124.5,125,1),(128,128.5,2),
                  (140.5,141,1),(142,142.5,2),(144,144.5,1)]
report = dict(manualCreditWindows=[dict(start=a,end=b,new60Credits=n) for a,b,n in credit_windows],
              manualCreditTotal=480,
              video=a.video.name, sourceFps=30, start=106, strideFrames=15, samples=84,
              selectedFrames=selected,
              clients=[dict(file=c['file'], rooms=[r for r in c['rooms'] if r['room'] == '33']) for c in native['clients']],
              limits=['Manual caption/log annotations, not automatic OCR.',
                      'The window map occludes the kill counter; no independently readable counter delta is claimed.',
                      'Native map counts alone do not prove the recorded total or spawn timing.',
                      'No runtime XP formula, actor depth or AI is inferred by extraction.'])
(a.out / '140-room33-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room33: 84 half-second frames extracted; declared manual credit windows total eight60 credits. Activation/AI/bunker semantics remain unverified.')
