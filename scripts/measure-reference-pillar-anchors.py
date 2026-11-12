#!/usr/bin/env python3
"""Cross-check native room42 pillar anchors against batch46 video measurements.

Does not infer hit thresholds, collision changes, or presence of occluded objects.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from client_pvf import PvfArchive

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=Path('docs/reference-evidence/88-pillar-anchors.json'))
args = parser.parse_args()
source = 'map/mirkwooddeep/h434(1,2).map'
with PvfArchive(args.client / 'Script.pvf') as archive:
    raw = archive.read(source)
    tokens = archive.tokens(source)

pillars = []
for section, stride in [('[passive object]', 4), ('[special passive object]', 11)]:
    index = next(i for i, (_, value) in enumerate(tokens) if value == section) + 1
    values = []
    while index < len(tokens):
        kind, value = tokens[index]
        if kind == 5 and str(value).startswith('[') and value != '[item]':
            break
        values.append(value)
        index += 1
    assert len(values) % stride == 0, (section, len(values))
    for index in range(0, len(values), stride):
        record = values[index:index + stride]
        if record[0] == 231:
            pillars.append({'section': section, 'record': record})

root = Path(__file__).resolve().parents[1]
observations = json.loads((root / 'docs/reference-evidence/46-room42-layout-measurement.json').read_text())['pillars']
# Scale is independently established by native floor/background matching (batches68–87).
scale = 1.125
proof = json.loads((root / 'docs/reference-evidence/46-pillar-native-proof.json').read_text())
animations = json.loads((root / 'docs/reference-evidence/49-pillar-client.json').read_text())
client = next(c for c in animations['clients'] if c['file'] == 'Script.pvf')
prefix = 'passiveobject/mapobject/breakableobject/animation/stonepillar/'
frames = {}
for kind, sprite, ani in [('flat', 'pillarPale', 'stonepillar0.ani'),
                          ('damaged', 'pillarDamagedDecor', 'stonepillar1.ani')]:
    frame = client['entries'][prefix + ani]['animation']['frames'][-1]
    bitmap = proof['frames'][sprite]
    frames[kind] = {
        'centerX': frame['xy'][0] + bitmap['offset'][0] + bitmap['rect'][2] / 2,
        'bottomY': frame['xy'][1] + bitmap['offset'][1] + bitmap['rect'][3],
    }

matches = []
clipped = []
seen = set()
for observed in observations:
    offset = frames[observed['kind']]
    distances = [abs((p['record'][1] + offset['centerX']) * scale - observed['panorama_center']) for p in pillars]
    index = int(np.argmin(distances))
    assert distances[index] < 4, (observed, distances[index])
    seen.add(index)
    record = pillars[index]['record']
    if observed['bottom'] >= 480:
        clipped.append({'observation': observed, 'nativeXY': record[1:3],
                        'reason': 'Touches the batch46 search ROI bottom at y480; not an independent bottom measurement.'})
        continue
    # Candidate ground origin is tested, not fitted to each pillar: native y0 -> screen92.
    predicted_bottom = 92 + (record[2] + offset['bottomY']) * scale
    residual_y = observed['bottom'] - predicted_bottom
    assert abs(residual_y) < 1, (observed, residual_y)
    matches.append({'time': observed['time'], 'kind': observed['kind'],
                    'nativeXY': record[1:3], 'observedCenterBottom': [observed['panorama_center'], observed['bottom']],
                    'groundAnchorScreen': [record[1] * scale, 92 + record[2] * scale],
                    'residualXY': [observed['panorama_center'] - (record[1] + offset['centerX']) * scale, residual_y]})
# An independent regression checks the common y transformation across different pillars.
x = np.array([m['nativeXY'][1] for m in matches])
y = np.array([m['observedCenterBottom'][1] for m in matches])
slope, intercept = np.polyfit(x, y, 1)
assert abs(slope - scale) < .01
report = {
    'source': source, 'sha256': hashlib.sha256(raw).hexdigest(),
    'nativePillars': pillars, 'nativeCount': len(pillars), 'observedUniqueCount': len(seen),
    'unmatchedNativeRecords': [p for i, p in enumerate(pillars) if i not in seen],
    'bitmapOffsetsFromGroundAnchorNative': frames,
    'transform': {'scale': scale, 'groundOriginScreenY': 92, 'fittedBitmapBottomSlope': float(slope),
                  'fittedBitmapBottomIntercept': float(intercept), 'predictedBitmapBottomIntercept': 106.625},
    'observations': matches, 'boundaryClippedObservations': clipped,
    'maxAbsResidualXY': np.max(np.abs([m['residualXY'] for m in matches]), axis=0).tolist(),
    'limits': '24 prior video texture matches (two bottom-clipped) identify 12 of 14 native records. Unmatched records do not prove additional visible pillars. Bitmap bottom is 13 native pixels below the physical anchor. HP, first effective hit, walk-box width semantics and damaged collision remain unverified.'
}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['nativeCount', 'observedUniqueCount', 'maxAbsResidualXY', 'transform']}, indent=2))
