#!/usr/bin/env python3
"""Match room33 native pillars to prior observations and independent raw-frame caps.

Input: ffmpeg -ss 106 -i V2.mp4 -vf
'select=not(mod(n\\,15)),crop=1440:1080:(iw-1440)/2:0,scale=720:540'
-vsync 0 -frames:v 84 frames/%03d.png
The 1920x1080 source contains a centred 1440x1080 game viewport.
"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from client_pvf import PvfArchive

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--frames', type=Path, required=True, help='V2 106..147.5s, every 15th 30fps frame at 720x540')
parser.add_argument('--out', type=Path, default=Path('docs/reference-evidence/94-room33-pillar-anchors.json'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = 'map/mirkwooddeep/n433(2,2).map'
with PvfArchive(args.client / 'Script.pvf') as archive:
    raw = archive.read(source)
    tokens = archive.tokens(source)
values = [v for _, v in tokens]
records = []
section_counts = {}
for section in ['[passive object]', '[special passive object]']:
    i = values.index(section) + 1
    count = 0
    while i < len(tokens) and tokens[i][0] != 5:
        # Special header: object,x,y,height,number of six-field payloads.
        length = 4 if section == '[passive object]' else 5 + 6 * values[i + 4]
        record = values[i:i + length]
        assert len(record) == length
        if section == '[special passive object]':
            assert all(tokens[i + 5 + 6 * n][0] == 7 for n in range(record[4]))
        if record[0] == 231:
            records.append({'section': section, 'record': record})
        count += 1
        i += length
    assert tokens[i][0] == 5
    section_counts[section] = count
assert len(records) == 12
observations = json.loads((root / 'docs/reference-evidence/50-room33-layout-measurement.json').read_text())['pillars']
cameras = {c['t']: c for c in json.loads((root / 'docs/reference-evidence/50-room33-camera.json').read_text())}
atlas = np.array(Image.open(root / 'assets/pillar-pale.png').convert('RGBA'))
seen = set()
measurements = []
for observed in observations:
    damaged = observed['kind'] == 'damaged'
    center_offset = 3 if damaged else 1
    def predicted_center(p):
        return (p['record'][1] - 11 + center_offset) * 1.125
    native = min(records, key=lambda p: abs(predicted_center(p) - observed['world'] * 265 / 168))
    record = native['record']
    nx, ny = record[1:3]
    dx = observed['world'] * 265 / 168 - predicted_center(native)
    dy = observed['bottom'] - (92 + (ny + 13) * 1.125)
    assert abs(dx) < 1.1 and abs(dy) < 1.6, (observed, record, dx, dy)
    seen.add((nx, ny))
    t = observed['time']
    camera = cameras[t]
    frame = cv2.imread(str(args.frames / f'{round((t-106)*2)+1:03d}.png'), cv2.IMREAD_GRAYSCALE)
    assert frame is not None
    bitmap = atlas[:111, 44:88] if damaged else atlas[:133, :44]
    template = cv2.resize(bitmap, None, fx=1.125, fy=1.125)[:30]
    mask = (template[:, :, 3] > 200).astype(np.uint8) * 255
    gray = cv2.cvtColor(template[:, :, :3], cv2.COLOR_RGB2GRAY)
    left = (nx - 11 + (-19 if damaged else -21)) * 1.125 - camera['camera_px']
    top = 92 + (ny + (-98 if damaged else -120)) * 1.125 - camera['camera_y_px']
    x0, y0 = max(0, round(left)-5), max(0, round(top)-5)
    roi = frame[y0:min(540, round(top)+35), x0:min(720, round(left)+55)]
    direct = None
    if roi.shape[0] >= gray.shape[0] and roi.shape[1] >= gray.shape[1]:
        scores = cv2.matchTemplate(roi, gray, cv2.TM_CCOEFF_NORMED, mask=mask)
        scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
        _, score, _, (x, y) = cv2.minMaxLoc(scores)
        direct = {'score': score, 'residualTopLeft': [x+x0-left, y+y0-top]}
    measurements.append({'time': t, 'kind': observed['kind'], 'nativeXY': [nx, ny],
                         'priorResidualCenterBottom': [dx, dy], 'rawFrameCap': direct})
assert len(seen) == 12
valid = [m for m in measurements if m['rawFrameCap'] and m['rawFrameCap']['score'] >= .94]
assert len(valid) == len(measurements), 'All prior cap observations must reproduce in raw frames'
assert all(max(map(abs, m['rawFrameCap']['residualTopLeft'])) < 1.5 for m in valid)
report = {'source': source, 'sha256': hashlib.sha256(raw).hexdigest(), 'nativePillars': records,
          'sectionCounts': section_counts, 'identifiedCount': len(seen), 'observations': measurements,
          'rawCapCountAbove094': len(valid),
          'transform': {'screenScale': 1.125, 'originXNative': 11, 'groundOriginScreenY': 92},
          'limits': ['Prior cap templates used approximate scales: center/bottom residuals are bounded by 1.1/1.6px, not subpixel engine measurements.',
                     'Raw-frame cap scores diagnose direct asset alignment; occlusion and sampling can reduce them.',
                     'Later damage is not an initial state; exact hit threshold, debris, loot, and damaged-state pass semantics remain open.']}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'identifiedCount': len(seen), 'observations': len(measurements), 'rawCapCountAbove094': len(valid)}, indent=2))
