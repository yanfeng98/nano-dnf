#!/usr/bin/env python3
"""Independent HD debris identities, pre-burst controls and rotation-phase checks.

Input: V2 -ss 83.5 -t 1.5 -vf crop=1440:1080:240:0 -vsync 0,
30fps files001.png..045.png. No emitter parameters are written to the game.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frames', type=Path, required=True)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=Path('/tmp/nano98-evidence'))
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'assets'))
from import_dnf_scene import decode_at
cv2.setNumThreads(1)

sources = {k: np.array(decode_at(args.client, 'sprite_map_breakableobject_stonepillar.NPK',
    f'sprite/map/breakableobject/stonepillar/stonepillarparticle{k}.img', 0)[0]) for k in range(1, 5)}
provenance = json.loads((root / 'docs/reference-evidence/91-pillar-effect-client.json').read_text())
for k, image in sources.items():
    assert hashlib.sha256(image.tobytes()).hexdigest() == provenance['particleImages'][k-1]['rgbaSha256']
flat = np.array(Image.open(root / 'assets/pillar-pale.png').convert('RGBA'))[:133, :44]
cap = cv2.resize(flat, None, fx=2.25, fy=2.25)[:60]
cap_mask = (cap[:, :, 3] > 200).astype('uint8')*255
cap_gray = cv2.cvtColor(cap[:, :, :3], cv2.COLOR_RGB2GRAY)
frames, rows = {}, []
for index in range(1, 33):
    image = cv2.imread(str(args.frames / f'{index:03d}.png'))
    assert image is not None and image.shape[:2] == (1080, 1440)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scores = cv2.matchTemplate(gray[690:780, :1100], cap_gray, cv2.TM_CCOEFF_NORMED, mask=cap_mask)
    scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
    _, score, _, (x, y) = cv2.minMaxLoc(scores)
    assert score > .93, (index, score)
    # Intact(966,349) anchors damaged(920,313); both translations are eliminated.
    ground = np.array([x+49.5-47*2.25, y+690+189])
    frames[index] = {'gray': gray, 'rgb': cv2.cvtColor(image, cv2.COLOR_BGR2RGB), 'ground': ground}
    coarse = cv2.resize(gray, (720, 540))
    left, top = max(0, math.floor(ground[0]/2-120)), max(100, math.floor(ground[1]/2-150))
    right, bottom = min(720, math.ceil(ground[0]/2+120)), min(466, math.ceil(ground[1]/2+70))
    roi = coarse[top:bottom, left:right]
    candidates = []
    for kind, source in sources.items():
        rgba = cv2.resize(source, None, fx=1.125, fy=1.125)
        # Seed search only; each accepted seed is checked over360degrees in HD.
        for angle in range(-10, 100, 5):
            chip = np.array(Image.fromarray(rgba).rotate(angle, resample=Image.Resampling.BICUBIC, expand=True))
            h, w = chip.shape[:2]
            z = cv2.matchTemplate(roi, cv2.cvtColor(chip[:, :, :3], cv2.COLOR_RGB2GRAY),
                                 cv2.TM_CCOEFF_NORMED, mask=(chip[:, :, 3] > 220).astype('uint8')*255)
            z = np.nan_to_num(z, nan=-1, posinf=-1, neginf=-1)
            for _ in range(8):
                _, value, _, (xx, yy) = cv2.minMaxLoc(z)
                if value < .9:
                    break
                point = np.array([left+xx+w/2, top+yy+h/2])
                candidates.append({'kind': kind, 'angle': angle, 'score': value, 'xy': point.tolist()})
                z[max(0,yy-8):yy+9, max(0,xx-8):xx+9] = -1
    candidates.sort(key=lambda m:-m['score'])
    kept = []
    for candidate in candidates:
        if not any(np.linalg.norm(np.array(candidate['xy'])-m['xy']) < 10 for m in kept):
            kept.append(candidate)
    rows.append({'frame': index, 'time': 83.5+(index-1)/30, 'groundHd': ground.tolist(),
                 'anchorScore': score, 'matches': kept[:25]})

forms = {}
for kind, source in sources.items():
    image = Image.fromarray(cv2.resize(source, None, fx=2.25, fy=2.25))
    for angle in range(-182, 183):
        rgba = np.array(image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True))
        forms[kind, angle] = (rgba, cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY),
                              (rgba[:, :, 3] > 220).astype('uint8')*255)


def best(gray, center, kind, angles):
    left, top = np.floor(np.array(center)-80).astype(int)
    roi = gray[top:top+161, left:left+161]
    result, curve = None, {}
    for angle in angles:
        _, template, mask = forms[kind, angle]
        z = cv2.matchTemplate(roi, template, cv2.TM_CCOEFF_NORMED, mask=mask)
        z = np.nan_to_num(z, nan=-1, posinf=-1, neginf=-1)
        _, value, _, (x, y) = cv2.minMaxLoc(z)
        curve[angle] = value
        if result is None or value > result['score']:
            h, w = template.shape
            result = {'kind': kind, 'angle': angle, 'score': value, 'maskPixels': int(np.count_nonzero(mask)),
                      'rectHd': [int(left+x), int(top+y), w, h],
                      'centerHd': [float(left+x+w/2), float(top+y+h/2)]}
    return result, curve


control = rows[6]  # 83.7s, before this burst.
verified = []
for frame, kind in [(11, 3), (12, 3), (13, 3), (14, 1), (15, 1), (16, 1)]:
    row = rows[frame-1]
    seed = max((m for m in row['matches'] if m['kind'] == kind), key=lambda m:m['score'])
    center = np.array(seed['xy'])*2
    alternatives = [best(frames[frame]['gray'], center, k, range(-180, 181, 2))[0] for k in sources]
    chosen, curve = best(frames[frame]['gray'], center, kind, range(-180, 181))
    assert chosen['score'] > .94
    chosen.update({'frame': frame, 'time': row['time'], 'nativeCenter':
                   ((np.array(chosen['centerHd'])-row['groundHd'])/2.25).tolist(), 'alternatives': alternatives})
    level = [angle for angle, value in curve.items() if value >= chosen['score']-.01]
    chosen['angleScoreLevelSet'] = {'scoreDrop': .01, 'min': min(level), 'max': max(level)}
    chosen['conditionalInitialAngleModels'] = {
        str(offset): {'positiveDegreesPerSecond': 179, 'maximumAgeSeconds': .5,
                      'bestTextureScoreWithinAllowedAngles': max(value for angle, value in curve.items()
                          if offset <= angle <= offset+179*.5)}
        for offset in [0, 50, 70]}
    chosen['largeTemplateIdentityMargin'] = chosen['score']-max(m['score'] for m in alternatives if m['kind'] not in [kind, 4])
    assert chosen['largeTemplateIdentityMargin'] > .07
    before = np.array(chosen['nativeCenter'])*2.25+control['groundHd']
    chosen['preburstControl'] = best(frames[7]['gray'], before, kind, [chosen['angle']])[0]
    assert chosen['preburstControl']['score'] < .7
    verified.append(chosen)

# Named ANI endpoint358deg over2000ms is checked for compatibility, not fitted.
speed = 179
phase = float(np.mean([m['time']-m['angle']/speed for m in verified]))
errors = [m['angle']-speed*(m['time']-phase) for m in verified]
report = {'source': {'video': 'V2', 'startSeconds': 83.5, 'fps': 30, 'crop': [1440,1080,240,0],
                     'nativeTarget': [920,313], 'nativeAnchor': [966,349], 'nativeScale': 2.25},
          'cameraAnchors': [{k:r[k] for k in ['frame','time','groundHd','anchorScore']} for r in rows],
          'verified': verified, 'rotationPhaseDiagnostic': {'assumedAniDegreesPerSecond': speed,
              'bestPhaseOriginSeconds': phase, 'rmsAngularResidualDegrees': float(np.sqrt(np.mean(np.array(errors)**2))),
              'maximumAbsoluteAngularResidualDegrees': max(map(abs, errors))},
          'coarseVisibleLargeCandidates': [{'frame': r['frame'], 'time': r['time'],
              'matches': [m for m in r['matches'] if m['kind'] != 4]} for r in rows],
          'limits': ['Two independently identified instances provide a visible-count lower bound, not an exact emitter count.',
                     'Coarse seeds search a limited range; all four HD alternatives cover a full360degrees.',
                     'Type4 is not accepted as an identity/count from its high small-template correlations.',
                     'Phase fit and score-level sets are diagnostics, not a birth-time confidence interval or angle accuracy.',
                     'Six short, partly occluded observations do not select a rotation pivot or emission distribution.',
                     'Initial-angle models are conditional tests of direct positive sprite offsets within0.5s, not decoding of PTL40/50/70 or object int75; no runtime emitter is added.']}
(args.out / 'measurement.json').write_text(json.dumps(report, indent=2)+'\n')
proof = Image.new('RGB', (720, len(verified)*150), '#242424')
draw = ImageDraw.Draw(proof)
for i, match in enumerate(verified):
    y = i*150
    draw.text((8,y+4), f"{match['time']:.4f}s type{match['kind']} angle{match['angle']} score{match['score']:.4f}", fill='white')
    for column, label in enumerate(['reference', 'native template', 'pre-burst best']):
        draw.text((column*240+8,y+23), label, fill='white')
    x,t,w,h = match['rectHd']
    proof.paste(Image.fromarray(frames[match['frame']]['rgb'][t:t+h,x:x+w]), (8,y+45))
    rgba = Image.fromarray(forms[match['kind'],match['angle']][0])
    proof.paste(rgba, (248,y+45), rgba)
    x,t,w,h = match['preburstControl']['rectHd']
    proof.paste(Image.fromarray(frames[7]['rgb'][t:t+h,x:x+w]), (488,y+45))
proof.save(args.out / 'native-proof.png')
print(json.dumps({'verified': len(verified), 'minimumScore': min(m['score'] for m in verified),
                  'maximumPreburstControlScore': max(m['preburstControl']['score'] for m in verified),
                  'phaseDiagnostic': report['rotationPhaseDiagnostic']}, indent=2))
