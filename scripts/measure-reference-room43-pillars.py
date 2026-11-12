#!/usr/bin/env python3
"""Cross-check all room43 native columns with raw-frame cap detections.

Input: ffmpeg -ss 74 -i V2.mp4 -t 31.5 -vf
'fps=2,crop=1440:1080:240:0,scale=720:540' frames/%03d.png
The fps filter's first sample is labelled74.25s, matching the camera evidence.
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
parser.add_argument('--frames', type=Path, required=True)
parser.add_argument('--out', type=Path, default=Path('docs/reference-evidence/97-room43-pillar-anchors.json'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
cv2.setNumThreads(1)
source = 'map/mirkwooddeep/n423(2,3).map'
with PvfArchive(args.client / 'Script.pvf') as archive:
    raw = archive.read(source)
    tokens = archive.tokens(source)
values = [v for _, v in tokens]
records = []
for section in ['[passive object]', '[special passive object]']:
    i = values.index(section) + 1
    while i < len(tokens) and tokens[i][0] != 5:
        length = 4 if section == '[passive object]' else 5 + 6 * values[i+4]
        record = values[i:i+length]
        assert len(record) == length
        if record[0] == 231:
            records.append({'section': section, 'record': record})
        i += length
    assert tokens[i][0] == 5
assert len(records) == 6
cameras = json.loads((root / 'docs/reference-evidence/02-room43-camera.json').read_text())
atlas = np.array(Image.open(root / 'assets/pillar-pale.png').convert('RGBA'))
matches, rejected = [], []
for i, camera in enumerate(cameras):
    gray = cv2.imread(str(args.frames / f'{i+1:03d}.png'), cv2.IMREAD_GRAYSCALE)
    assert gray is not None and gray.shape == (540, 720)
    for kind, left, height, center_offset in [('flat', 0, 133, 1), ('damaged', 44, 111, 3)]:
        bitmap = cv2.resize(atlas[:height, left:left+44], None, fx=1.125, fy=1.125)
        cap = bitmap[:30]
        mask = (cap[:, :, 3] > 200).astype(np.uint8)*255
        template = cv2.cvtColor(cap[:, :, :3], cv2.COLOR_RGB2GRAY)
        scores = cv2.matchTemplate(gray[110:470], template, cv2.TM_CCOEFF_NORMED, mask=mask)
        scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
        for _ in range(10):
            _, score, _, (x, local_y) = cv2.minMaxLoc(scores)
            if score < .94:
                break
            y = local_y + 110
            center = x + bitmap.shape[1]/2 + camera['camera_px']
            bottom = y + bitmap.shape[0]
            def distance(p):
                r = p['record']
                return abs(center-(r[1]+center_offset)*1.125) + abs(bottom-(92+(r[2]+13)*1.125))
            native = min(records, key=distance)['record']
            residual = [center-(native[1]+center_offset)*1.125, bottom-(92+(native[2]+13)*1.125)]
            row = {'time': camera['t'], 'kind': kind, 'score': score,
                   'rect': [x, y, bitmap.shape[1], bitmap.shape[0]], 'nativeXY': native[1:3],
                   'residualCenterBottom': residual}
            if max(map(abs, residual)) < 1.5:
                matches.append(row)
            else:
                row['nearestNativeXY'] = row.pop('nativeXY')
                rejected.append(row)
            scores[max(0,local_y-20):local_y+20, max(0,x-25):x+25] = -1
for native in records:
    observed = [m for m in matches if m['nativeXY'] == native['record'][1:3]]
    assert len({m['time'] for m in observed}) >= 2, native
    assert min(observed, key=lambda m:m['time'])['kind'] == 'flat', native
report = {'source': source, 'sha256': hashlib.sha256(raw).hexdigest(),
          'nativePillars': records, 'nativeCount': 6, 'observations': matches,
          'highScoreCandidatesRejectedByNativeGeometry': rejected,
          'transform': {'screenScale': 1.125, 'originXNative': 0, 'groundOriginScreenY': 92},
          'maxAbsResidualCenterBottom': np.max(np.abs([m['residualCenterBottom'] for m in matches]), axis=0).tolist(),
          'limits': ['Texture correlation alone is insufficient: rejected high-score candidates do not establish new columns; nearestNativeXY is only their comparison target.',
                     'Half-second samples identify visible intact/damaged states, not the precise hit frame or native HP.',
                     'Debris, loot, exact damaged pass rules and non-column scenery remain open.']}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'nativeCount': 6, 'matches': len(matches), 'rejectedCandidates': len(rejected),
                  'maxResidual': report['maxAbsResidualCenterBottom']}, indent=2))
