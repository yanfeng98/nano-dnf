#!/usr/bin/env python3
"""Measure 312s entry fade against stable 312.5s HUD borders, independently of game rendering."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'docs/reference-evidence'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--stable', type=Path, default=EVIDENCE / '85-room25-312.5-fade-reference.png')
parser.add_argument('--out', type=Path, default=EVIDENCE / '85-room25-entry-fade.json')
args = parser.parse_args()
faded_path = EVIDENCE / '58-room25-closeback-312-reference.png'
faded = np.array(Image.open(faded_path).convert('RGB')).astype(float)
stable = np.array(Image.open(args.stable).convert('RGB')).astype(float)
regions = []
for name, (x, y, w, h) in [
    ('left-frame', (0, 455, 34, 85)), ('right-frame', (686, 455, 34, 85)),
    ('center-frame', (300, 477, 95, 63)), ('map-frame', (591, 29, 115, 12))
]:
    a, b = faded[y:y+h, x:x+w], stable[y:y+h, x:x+w]
    mask = (b.mean(2) > 40) & (b.max(2) - b.min(2) > 15)
    scale = float((a[mask] * b[mask]).sum() / (b[mask] ** 2).sum())
    error = float(np.sqrt(np.mean((a[mask] - scale * b[mask]) ** 2)))
    assert .72 < scale < .75 and error < 6
    regions.append(dict(name=name, roi=[x, y, w, h], pixels=int(mask.sum()),
                        brightness_scale=scale, rmse=error))
result = dict(time=312, stableTime=312.5,
    blackOpacity=round(1 - float(np.median([r['brightness_scale'] for r in regions])), 3),
    regions=regions,
    sources=[dict(file=p.name, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
             for p in [faded_path, args.stable]],
    limits='Recorded entry fade only. This calibrates the captured reference state, not a permanent world tint or a change to transition duration.')
args.out.write_text(json.dumps(result, indent=2) + '\n')
print('312s black opacity', result['blackOpacity'])
