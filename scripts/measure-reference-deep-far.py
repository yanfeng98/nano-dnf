#!/usr/bin/env python3
"""Recover far-layer projection from native transparent gaps, not foreground trees.

Mask out the measured midground, closeback, UI and resampling edges. Search the
original client far image without imposing the predicted phase, then compare
the recovered phase to each map's own distant-scroll declaration.
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
E = ROOT / 'docs/reference-evidence'
SAMPLES = [('41', 17.5), ('33', 125), ('33', 146), ('23', 180),
           ('13', 190), ('25', 319), ('25', 370)]
CLOSEBACKS = dict(zip(['41', '42', '43', '33', '23', '13', '14', '24', '25'],
    ['deep-entry-closeback.png', 'deep-room42-closeback.png', 'deep-room43-closeback.png',
     'deep-room33-closeback.png', 'deep-room23-closeback.png', 'deep-room13-closeback.png',
     'deep-room14-closeback.png', 'deep-room24-closeback.png', 'deep-boss-closeback.png']))
CAMERAS = {'41': '47-room41', '42': '46-room42', '43': '02-room43', '33': '50-room33',
           '23': '51-room23', '13': '52-room13', '14': '53-room14',
           '24': '54-room24', '25': '55-room25'}


def visible_far(mid, back, camera, origin):
    back_alpha = cv2.warpAffine(back[:, :, 3],
        np.float32([[1.125, 0, -camera], [0, 1.125, 2]]), (720, 120))
    mid_alpha = np.zeros((120, 720), np.uint8)
    phase = -(camera + origin * 1.125) * .9
    for copy in range(-1, 4):
        layer = cv2.warpAffine(mid[:, :, 3],
            np.float32([[1.125, 0, phase + copy * 720], [0, 1.125, -106.5]]), (720, 120))
        mid_alpha = np.maximum(mid_alpha, layer)
    mask = ((back_alpha == 0) & (mid_alpha == 0)).astype(np.uint8) * 255
    mask[:, :210] = 0  # target panel, watermark and chat
    mask[:, 590:] = 0  # minimap and room title
    return cv2.erode(mask, np.ones((5, 5), np.uint8))


def measure(client):
    rooms = json.loads((E / '86-deep-mid-measurement.json').read_text())['rooms']
    rooms = [dict(room='41', col=0, row=3, originX=0,
                  map_entry='map/mirkwooddeep/s419(0,3).map')] + rooms
    with PvfArchive(client / 'Script.pvf') as pvf:
        ani_entry = 'map/mirkwooddeep/animation/far0.ani'
        ani = parse_animation(pvf.read(ani_entry))
        assert ani['paths'] == ['Map/02far0.img']
        maps = []
        for room in rooms:
            tokens = pvf.tokens(room['map_entry'])
            index = next(i for i, t in enumerate(tokens) if t[1] == '[far sight scroll]')
            scroll = tokens[index + 1][1] / 100
            assert scroll == .56 and [7, 'Animation/far0.ani'] in tokens
            maps.append(dict(room=room['room'], col=room['col'], row=room['row'],
                originX=room['originX'], scroll=scroll, screenY=-102, screenScale=1.125,
                map_entry=room['map_entry'], map_sha256=hashlib.sha256(pvf.read(room['map_entry'])).hexdigest()))

    atlas = np.array(Image.open(ROOT / 'assets/forest.png').convert('RGBA'))
    mid, far = atlas[:380, 640:1280], atlas[:375, :640, :3]
    search = np.tile(cv2.resize(far, None, fx=1.125, fy=1.125), (1, 2, 1))
    samples = []
    mask_dir = E / '87-far-masks'
    mask_dir.mkdir(exist_ok=True)
    for room_id, time in SAMPLES:
        room = next(r for r in maps if r['room'] == room_id)
        prefix = CAMERAS[room_id]
        cameras = json.loads((E / f'{prefix}-camera.json').read_text())
        camera = next(c['camera_px'] for c in cameras if c['t'] == time)
        reference_name = (f'58-room25-closeback-{time}-reference.png' if room_id == '25'
                          else f'{prefix}-{time}-reference.png')
        reference = np.array(Image.open(E / reference_name).convert('RGB'))[:120]
        back = np.array(Image.open(ROOT / 'assets' / CLOSEBACKS[room_id]).convert('RGBA'))
        mask = visible_far(mid, back, camera, room['originX'])
        scores = cv2.matchTemplate(search, reference, cv2.TM_CCOEFF_NORMED, mask=mask)
        scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
        _, score, _, (x, y) = cv2.minMaxLoc(scores)
        expected_x = ((camera + room['originX'] * 1.125) * room['scroll']) % 720
        x_error = (x - expected_x + 360) % 720 - 360
        assert score > .75 and abs(x_error) < 2.5 and abs(y - 102) <= 1.5, (room_id, time, score, x_error, y)
        pixels = int((mask > 0).sum())
        assert pixels > 250
        rgba = np.full((120, 720, 4), 255, np.uint8)
        rgba[:, :, 3] = mask
        mask_name = f'87-far-masks/{room_id}-{time}.png'
        Image.fromarray(rgba).save(E / mask_name)
        samples.append(dict(room=room_id, time=time, camera_px=camera, reference=reference_name,
            mask=mask_name, pixels=pixels, source_correlation=score,
            matched_source_xy=[x, y], expected_source_x=expected_x, x_error_px=x_error))
    return dict(animation_entry=ani_entry, animation=ani, rooms=maps, samples=samples,
        limits='Seven informative masked regions in five rooms support geometry. Four other rooms use the same native animation/scroll metadata; their far layer is obscured or lacks discriminating texture. Colour differences remain separately measurable; no whole-scene equivalence is claimed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    parser.add_argument('--out', type=Path, default=E / '87-deep-far-measurement.json')
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    result = measure(args.client)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print([(r['room'], r['time'], round(r['source_correlation'], 3)) for r in result['samples']])
