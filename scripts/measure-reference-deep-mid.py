#!/usr/bin/env python3
"""Verify the remaining eight route midgrounds against native map data and bark.

Regions were identified by an exploratory texture scan. This repeatable check
uses fixed source patches, not a search that changes its expectations to fit
the implementation. Reference frames are evidence only, never game assets.
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
EVIDENCE = ROOT / 'docs/reference-evidence'
PROFILES = [
    ('42', 1, 3, '46-room42', 'map/mirkwooddeep/h434(1,2).map', 0,
     [(28, 450, 100), (72.5, 65, 100), (73.5, 65, 100)]),
    ('43', 2, 3, '02-room43', 'map/mirkwooddeep/n423(2,3).map', 0,
     [(74.25, 450, 160), (90.25, 175, 160), (104.25, 450, 100)]),
    ('33', 2, 2, '50-room33', 'map/mirkwooddeep/n433(2,2).map', 11,
     [(125, 450, 100), (133, 10, 100), (146, 450, 100)]),
    ('23', 2, 1, '51-room23', 'map/mirkwooddeep/n432(2,2).map', 46,
     [(150, 505, 220), (180, 450, 100)]),
    ('13', 2, 0, '52-room13', 'map/mirkwooddeep/n412(2,0).map', 41,
     [(190, 340, 100), (210, 10, 100), (235.5, 10, 100), (271.5, 340, 100)]),
    ('14', 3, 0, '53-room14', 'map/mirkwooddeep/402.map', 0,
     [(260, 330, 100, 20, 24), (261.3, 330, 100, 20, 24)]),
    ('24', 3, 1, '54-room24', 'map/mirkwooddeep/n410(3,0).map', 0,
     [(277, 450, 160), (281, 395, 220), (293, 10, 100), (307, 450, 160)]),
    ('25', 4, 1, '55-room25', 'map/mirkwooddeep/b417(4,1).map', 0,
     [(312, 210, 100, 20, 24), (314.5, 570, 100, 20, 24),
      (319, 550, 130, 20, 24), (330, 270, 100, 20, 24), (370, 150, 100, 20, 24)]),
]


def reference_path(room, prefix, time):
    if room == '43':
        return EVIDENCE / f'02-room43-{time:06.2f}.png'
    if room == '14' and time == 261.3:
        return EVIDENCE / '53-room14-maximum-camera-reference.png'
    if room == '25':
        return EVIDENCE / f'58-room25-closeback-{time}-reference.png'
    return EVIDENCE / f'{prefix}-{time}-reference.png'


def measure(client):
    atlas = np.array(Image.open(ROOT / 'assets/forest.png').convert('RGBA'))
    mid = atlas[:380, 640:1280]
    rooms = []
    with PvfArchive(client / 'Script.pvf') as pvf:
        ani_entry = 'map/mirkwooddeep/animation/mid1.ani'
        animation = parse_animation(pvf.read(ani_entry))
        assert animation['paths'] == ['Map/02mid0.img']
        for room, col, row, prefix, map_entry, origin, samples in PROFILES:
            tokens = pvf.tokens(map_entry)
            index = next(i for i, item in enumerate(tokens) if item[1] == '[middle sight scroll]')
            scroll = tokens[index + 1][1] / 100
            assert scroll == .9 and [7, 'Animation/mid1.ani'] in tokens
            cameras = json.loads((EVIDENCE / f'{prefix}-camera.json').read_text())
            measurements = []
            for sample in samples:
                time, sx, sy = sample[:3]
                sw, sh = sample[3:] or (28, 32)
                camera = next(c['camera_px'] for c in cameras if c['t'] == time)
                source = mid[sy:sy + sh, sx:sx + sw]
                scaled = cv2.resize(source, None, fx=1.125, fy=1.125)
                mask = (scaled[:, :, 3] > 230).astype('uint8') * 255
                path = reference_path(room, prefix, time)
                reference = cv2.imread(str(path), 0)[:240]
                scores = cv2.matchTemplate(reference,
                    cv2.cvtColor(scaled[:, :, :3], cv2.COLOR_RGB2GRAY),
                    cv2.TM_CCOEFF_NORMED, mask=mask)
                scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
                scores[:120, :160] = -1  # chat overlay
                scores[:130, 600:] = -1  # radar overlay
                _, score, _, (x, y) = cv2.minMaxLoc(scores)
                expected_x = -(camera + origin * 1.125) * scroll
                actual_x = x - sx * 1.125
                actual_x += round((expected_x - actual_x) / 720) * 720
                error_x = actual_x - expected_x
                phase_y = y - sy * 1.125
                assert score > .84 and abs(error_x) < 1.5, (room, time, score, error_x)
                assert abs(phase_y + 106.5) <= 1.5, (room, time, phase_y)
                # Inset the resampling boundary by one pixel for Canvas checks.
                w, h = scaled.shape[1] - 1, scaled.shape[0] - 1
                measurements.append(dict(time=time, camera_px=camera,
                    reference=path.name, source_rect=[sx, sy, sw, sh],
                    roi=[x, y, w, h], correlation=score,
                    native_scroll_error_px=error_x, inferred_screen_y=phase_y))
            rooms.append(dict(room=room, col=col, row=row, originX=origin,
                map_entry=map_entry, map_sha256=hashlib.sha256(pvf.read(map_entry)).hexdigest(),
                scroll=scroll, screenY=-106.5, screenScale=1.125, samples=measurements))
    return dict(animation_entry=ani_entry, animation=animation, rooms=rooms,
        limits='Visible midground regions only. Room 14 has two nearby eastern cameras; its scroll ratio is declared by the client map. Vertical phase permits 1.5px sampling uncertainty. Far layer, props and interactions remain open.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    parser.add_argument('--out', type=Path, default=EVIDENCE / '86-deep-mid-measurement.json')
    args = parser.parse_args()
    result = measure(args.client)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print([(r['room'], len(r['samples'])) for r in result['rooms']])
