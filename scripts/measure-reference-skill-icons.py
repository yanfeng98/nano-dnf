#!/usr/bin/env python3
"""Locate client skill icons in stored reference frames without changing game art."""
import argparse
import io
import json
from pathlib import Path
import cv2
import numpy as np
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--references', type=Path, default=ROOT / 'docs/reference-evidence/frames')
parser.add_argument('--out', type=Path, default=Path('/tmp/nano-skill-icon-geometry.json'))
parser.add_argument('--identify', action='store_true', help='also search all atlas frames in V2 76s')
args = parser.parse_args()
pack = 'sprite_character_swordman_effect.NPK'
entry = 'sprite/character/swordman/effect/skillicon.img'
icons = {}
with (args.client / 'ImagePacks2' / pack).open('rb') as handle:
    item = next(e for e in NPK.open(handle).files if e.name.endswith('/skillicon.img'))
    entry = item.name
    img = IMGFactory.open(io.BytesIO(item.data))
    count = len(img.images)
    for index, frame in enumerate(img.images):
        if args.identify or index in [10, 94, 6]:
            icons[index] = cv2.cvtColor(np.array(img.build(frame).convert('RGB')), cv2.COLOR_RGB2BGR)


def match(image, index, x):
    roi = image[499:537, x - 4:x + 35]
    best = (-1, None)
    for size in range(28, 35):
        template = cv2.resize(icons[index], (size, size), interpolation=cv2.INTER_LINEAR)
        _, score, _, point = cv2.minMaxLoc(cv2.matchTemplate(roi, template, cv2.TM_CCOEFF_NORMED))
        if score > best[0]:
            best = (score, [size, x - 4 + point[0], 499 + point[1]])
    return {'frame': index, 'correlation': round(best[0], 4), 'size_x_y': best[1]}


result = {'pack': pack, 'entry': entry, 'atlas_frames': count, 'references': []}
for name in ['00001-0076.00.jpg', '00001-0150.00.jpg', '00002-0012.00.jpg',
             '00002-0076.00.jpg', '00002-0104.00.jpg']:
    image = cv2.imread(str(args.references / name))
    if image is None:
        raise FileNotFoundError(name)
    result['references'].append({'reference': name,
                                 'matches': [match(image, i, x) for i, x in zip([10, 94, 6], [429, 464, 499])]})
if args.identify:
    image = cv2.imread(str(args.references / '00002-0076.00.jpg'))
    result['identification'] = [sorted([match(image, i, x) for i in icons],
                                       key=lambda m: m['correlation'], reverse=True)[:5]
                                for x in [429, 464, 499]]
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(f'Wrote icon measurements to {args.out}')
