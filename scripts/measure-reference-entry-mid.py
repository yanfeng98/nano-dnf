#!/usr/bin/env python3
"""Check entry-room midground scale and parallax against three native textures.

Reference images are normalized 720x540 evidence, never game assets. Match
different visible bark regions in three cameras, unwrap their periodic X
coordinates, and compare the inferred displacement to the map's scroll ratio.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from client_animation import parse_animation
from client_pvf import PvfArchive

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=ROOT / 'docs/reference-evidence/83-entry-mid-measurement.json')
args = parser.parse_args()

with PvfArchive(args.client / 'Script.pvf') as pvf:
    map_entry = 'map/mirkwooddeep/s419(0,3).map'
    tokens = pvf.tokens(map_entry)
    scroll_index = next(i for i, item in enumerate(tokens) if item[1] == '[middle sight scroll]')
    scroll = tokens[scroll_index + 1][1] / 100
    animation_entry = 'map/mirkwooddeep/animation/mid1.ani'
    animation = parse_animation(pvf.read(animation_entry))
    assert animation['paths'] == ['Map/02mid0.img']
    assert scroll == .9
    provenance = dict(map_entry=map_entry,
        map_sha256=hashlib.sha256(pvf.read(map_entry)).hexdigest(),
        animation_entry=animation_entry, animation=animation, native_scroll=scroll)

atlas = np.array(Image.open(ROOT / 'assets/forest.png').convert('RGBA'))
mid = atlas[:380, 640:1280]
cameras = json.loads((ROOT / 'docs/reference-evidence/47-room41-camera.json').read_text())
rows = []
for time, source_x, source_y in [(13.5, 560, 160), (17.5, 65, 100), (25.5, 395, 220)]:
    camera = next(c['camera_px'] for c in cameras if c['t'] == time)
    reference = cv2.imread(str(ROOT / f'docs/reference-evidence/47-room41-{time}-reference.png'), 0)[:240]
    patch = mid[source_y:source_y + 32, source_x:source_x + 28]
    scaled = cv2.resize(patch, None, fx=1.125, fy=1.125)
    mask = (scaled[:, :, 3] > 230).astype('uint8') * 255
    template = cv2.cvtColor(scaled[:, :, :3], cv2.COLOR_RGB2GRAY)
    scores = cv2.matchTemplate(reference, template, cv2.TM_CCOEFF_NORMED, mask=mask)
    scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
    _, score, _, (x, y) = cv2.minMaxLoc(scores)
    dx = x - source_x * 1.125
    # Select the periodic copy nearest the independently declared scroll.
    dx += round((-camera * scroll - dx) / 720) * 720
    error_x = dx + camera * scroll
    phase_y = y - source_y * 1.125
    assert score > .85 and abs(error_x) < .6
    assert abs(phase_y + 106.5) <= 1
    rows.append(dict(time=time, camera_px=camera, source_xy=[source_x, source_y],
        matched_xy=[x, y], correlation=score, unwrapped_x=dx,
        native_scroll_error_px=error_x, inferred_screen_y=phase_y))

fit = np.polyfit([r['camera_px'] for r in rows], [-r['unwrapped_x'] for r in rows], 1)
assert abs(float(fit[0]) - scroll) < .002
report = dict(provenance=provenance, screen_scale=1.125, screen_y=-106.5,
    fitted_scroll=float(fit[0]), samples=rows,
    limits='Entry midground only. Pixel sampling permits one-pixel vertical phase uncertainty. Far layer, other rooms and scenery interactions remain open.')
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('scroll', report['fitted_scroll'], 'correlations', [round(r['correlation'], 4) for r in rows])
