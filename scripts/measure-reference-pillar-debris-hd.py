#!/usr/bin/env python3
"""Refine native debris correspondences at the original1440x1080 crop.

The prior720x540 tracks locate search regions only. Texture score selects
positions/angles before three rotation-pivot hypotheses are compared.
No inferred emission parameters are applied to the game.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'assets'))
from import_dnf_scene import decode_at
prior = json.loads((root / 'docs/reference-evidence/91-pillar-debris-tracks.json').read_text())['tracks']
coarse = json.loads((root / 'docs/reference-evidence/91-pillar-debris-candidates.json').read_text())
source = json.loads((root / 'docs/reference-evidence/91-pillar-effect-client.json').read_text())
scale = 2.25
interpolations = {'nearest': cv2.INTER_NEAREST, 'linear': cv2.INTER_LINEAR}
flat = np.array(Image.open(root / 'assets/pillar-pale.png').convert('RGBA'))[:133, :44]
chips = {}
for kind in [1, 2, 3, 4]:
    pic, offset = decode_at(a.client, 'sprite_map_breakableobject_stonepillar.NPK',
        f'sprite/map/breakableobject/stonepillar/stonepillarparticle{kind}.img', 0)
    ani = source['clients'][0]['animations'][f'stonepillarparticle{kind}.ani']['frames'][0]['xy']
    chips[kind] = {'rgba': np.array(pic), 'imageCenter': [pic.width / 2, pic.height / 2],
                   'aniCenter': [ani[0] + offset[0] + pic.width / 2, ani[1] + offset[1] + pic.height / 2]}


def scores(image, template, mask):
    return np.nan_to_num(cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED, mask=mask),
                         nan=-1, posinf=-1, neginf=-1)


def peak_delta(values, x, y, axis):
    if axis == 0:
        if x == 0 or x == values.shape[1] - 1: return 0
        left, center, right = values[y, x-1:x+2]
    else:
        if y == 0 or y == values.shape[0] - 1: return 0
        left, center, right = values[y-1:y+2, x]
    den = 2 * (left - 2 * center + right)
    if abs(den) < 1e-9: return 0
    value = float((left - right) / den)
    return value if abs(value) <= .5 else 0


frames = {}
for track in prior.values():
    for point in track['points']:
        time = 63.6667 + point['t']
        index = round((time - 62) * 30) + 1
        if index in frames: continue
        image = cv2.imread(str(a.frames / f'{index:03d}.png'))
        assert image is not None and image.shape[:2] == (1080, 1440)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        anchor = None
        for filtering, interpolation in interpolations.items():
            template = cv2.resize(flat, (99, 299), interpolation=interpolation)
            mask = (template[:, :, 3] > 200).astype('uint8') * 255
            mask[:130] = 0; mask[290:] = 0
            values = scores(gray[540:880, 300:1300], cv2.cvtColor(template[:, :, :3], cv2.COLOR_RGB2GRAY), mask)
            _, value, _, (x, y) = cv2.minMaxLoc(values)
            if anchor is None or value > anchor['score']:
                anchor = {'score': value, 'x': x + 300 + peak_delta(values, x, y, 0), 'y': y + 540,
                          'filtering': filtering}
        assert anchor['score'] > .9
        camera = (877 + 1) * scale - (anchor['x'] + 99 / 2)
        frames[index] = {'gray': gray, 'anchor': anchor, 'targetGroundX': 1002 * scale - camera}

tracks = {}
for name, old in prior.items():
    kind = 1 if name in ['left', 'right'] else 2
    points = []
    for point in old['points']:
        time = 63.6667 + point['t']
        index = round((time - 62) * 30) + 1
        frame = frames[index]
        old_frame = next(r for r in coarse if abs(r['t'] - time) < .001)
        expected = np.array([(old_frame['center'] + point['raw'][0]) * 2,
                             (346.25 + point['raw'][1]) * 2])
        radius = math.ceil(np.linalg.norm(chips[kind]['rgba'].shape[:2]) * scale / 2) + 12
        left, top = np.floor(expected - radius).astype(int)
        roi = frame['gray'][top:top+2*radius+1, left:left+2*radius+1]
        best = None
        angle_scores = {}
        for filtering, interpolation in interpolations.items():
            rgba = cv2.resize(chips[kind]['rgba'], None, fx=scale, fy=scale, interpolation=interpolation)
            for angle in range(point['angle'] - 15, point['angle'] + 16):
                rotated = np.array(Image.fromarray(rgba).rotate(angle, resample=Image.Resampling.BICUBIC, expand=True))
                height, width = rotated.shape[:2]
                mask = (rotated[:, :, 3] > 220).astype('uint8') * 255
                values = scores(roi, cv2.cvtColor(rotated[:, :, :3], cv2.COLOR_RGB2GRAY), mask)
                _, value, _, (x, y) = cv2.minMaxLoc(values)
                angle_scores[angle] = max(value, angle_scores.get(angle, -1))
                if best is None or value > best['score']:
                    center = [left+x+width/2+peak_delta(values, x, y, 0),
                              top+y+height/2+peak_delta(values, x, y, 1)]
                    best = {'score': value, 'angle': angle, 'filtering': filtering, 'centerHd': center,
                            'nativeCenter': [(center[0]-frame['targetGroundX'])/scale,
                                             (center[1]-(226*scale+184))/scale]}
        level_set = [angle for angle, value in angle_scores.items() if value >= best['score'] - .01]
        best['angleScoreLevelSet'] = {'scoreDrop': .01, 'min': min(level_set), 'max': max(level_set),
                                     'touchesSearchBoundary': min(level_set) == point['angle']-15 or max(level_set) == point['angle']+15}
        best['angleScores'] = [{'angle': angle, 'score': value} for angle, value in sorted(angle_scores.items())]
        points.append({'frame': index, 't': point['t'], **best})
    tracks[name] = {'kind': kind, 'points': points}

# Eliminate each track's unknown initial position and velocity before
# comparing pivot models. Native gravity is named PTL data, not fitted here.
models = {}
for model in ['imageCenter', 'aniOrigin', 'imageTopLeft']:
    residuals = []
    per_track = {}
    for name, track in tracks.items():
        points = [q for q in track['points'] if q['score'] >= .9]
        assert len(points) >= 5, (name, len(points))
        t = np.array([q['t'] for q in points])
        positions = np.array([q['nativeCenter'] for q in points])
        vector = {'imageCenter': [0, 0], 'aniOrigin': chips[track['kind']]['aniCenter'],
                  'imageTopLeft': chips[track['kind']]['imageCenter']}[model]
        angles = np.radians([q['angle'] for q in points])
        correction = np.array([(np.cos(angles)-1)*vector[0]+np.sin(angles)*vector[1],
                               -np.sin(angles)*vector[0]+(np.cos(angles)-1)*vector[1]]).T
        physical = positions - correction
        physical[:, 1] -= 600 * t*t
        design = np.column_stack([np.ones(len(t)), t])
        fit = design @ np.linalg.lstsq(design, physical, rcond=None)[0]
        error = physical-fit
        residuals.extend(error.flatten().tolist())
        per_track[name] = {'qualifiedPoints': len(points), 'rmseHdPixels': float(np.sqrt(np.mean(error**2))*scale)}
    models[model] = {'rmseHdPixels': float(np.sqrt(np.mean(np.array(residuals)**2))*scale), 'tracks': per_track}
report = {'sourceCrop': [1440, 1080], 'nativeScale': scale, 'angleStepDegrees': 1,
          'cameraAnchors': {str(i): f['anchor'] for i, f in frames.items()}, 'tracks': tracks, 'pivotModels': models,
          'limits': 'Texture-refined correspondences, not a runtime emitter. Pivot residuals use named native gravity1200 and eliminate unknown initial position/velocity. The 1degree search step is resolution, not accuracy; score-level sets are sensitivity diagnostics, not statistical confidence intervals. Narrow noisy tracks may not uniquely distinguish models; initial area, emission distribution and small fragments remain unverified.'}
(a.out / 'measurement.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(models, indent=2))
