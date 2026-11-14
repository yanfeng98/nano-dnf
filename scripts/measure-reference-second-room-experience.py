#!/usr/bin/env python3
"""Sample exact V1 frames around the first upgrade, without assuming XP credits.

The bar is often hidden by the level-up animation. Connected green width is
reported as an observation, not treated as a trustworthy balance automatically.
Logs and the visible level remain available for manual event review.
"""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=ROOT.parent / 'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out', type=Path, default=Path('/tmp/nano134-second-room-xp'))
args = p.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '76', '-i', str(args.video),
    '-t', '24', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 48, f'Expected exact half-second samples, got {len(frames)}'
rows = []
for index, rgb in enumerate(frames):
    time = 76 + index / 2
    image = Image.fromarray(rgb)
    name = f'134-v1-{time:g}-second-room.png'
    image.save(args.out / name)
    strip = rgb[486:493, 134:294].astype(float)
    green = ((strip[:, :, 1] > 110) & (strip[:, :, 1] > strip[:, :, 0] * 1.25)
             & (strip[:, :, 1] > strip[:, :, 2] * 1.25)).sum(axis=0) >= 3
    fill = 0
    while fill < 160 and green[fill]:
        fill += 1
    rows.append(dict(time=time, frame=name, connectedGreenPixels=fill,
                     sha256=hashlib.sha256((args.out / name).read_bytes()).hexdigest(),
                     credit=None, level=None))
    page = index // 12
    if index % 12 == 0:
        sheet = Image.new('RGB', (1000, 1080), '#181818')
        draw = ImageDraw.Draw(sheet)
    x, y = index % 4 * 250, (index % 12) // 4 * 360
    draw.text((x, y), f'V1 {time:g}s green={fill}/160', fill='white')
    sheet.paste(image.crop((10, 95, 250, 345)), (x, y + 20))
    sheet.paste(image.crop((75, 477, 300, 500)), (x, y + 280))
    if index % 12 == 11:
        sheet.save(args.out / f'134-second-room-contact-{page}.png')
report = dict(video=args.video.name, sampleStart=76, sourceFps=30, strideFrames=15,
              track=[134, 486, 160, 7], samples=rows,
              limits=['No XP ledger or level classification is inferred automatically.',
                      'Connected green width can be contaminated by upgrade flashes.',
                      'Manual log reading and event ordering are required before using a balance constraint.'])
entry_path = ROOT / 'docs/reference-evidence/121-entry-xp.json'
prior_path = ROOT / 'docs/reference-evidence/128-experience-scale-constraints.json'
observations = [r for r in json.loads(entry_path.read_text())['samples'] if r['video'] == 1]
additional = []
for time, credit in [(82.5, 240), (83.5, 280), (96.5, 280)]:
    row = next(r for r in rows if r['time'] == time)
    fill = row['connectedGreenPixels']
    observation = dict(time=time, credit=credit, level=3, frame=row['frame'], sha256=row['sha256'],
                       fractionInterval=[max(0, (fill - 2) / 160), min(1, (fill + 2) / 160)])
    additional.append(observation)
    observations.append(observation)
feasible = []
for threshold in range(1, 2462):
    lo = math.ceil(max(0, *[r['fractionInterval'][0] * threshold - r['credit']
                           for r in observations]) - 1e-9)
    hi = math.floor(min(*[r['fractionInterval'][1] * threshold - r['credit']
                         for r in observations], threshold - 281) + 1e-9)
    # Every selected sample is still Lv3: XP + 280 must remain below threshold.
    if lo <= hi:
        feasible.append(dict(threshold=threshold, initialXpIntegerInterval=[lo, hi]))
assert feasible
bounds = [feasible[0]['threshold'], feasible[-1]['threshold']]
models = []
for model in json.loads(prior_path.read_text())['models']:
    if not model['jointFeasible']:
        continue
    interval = model['jointScaleInterval']
    midpoint = model['illustrativeMidpointNotRuntimeValue']
    unscaled = model['illustrativeLevel3to7Thresholds']['3'] / midpoint
    implied = [value * unscaled for value in interval]
    models.append(dict(semantics=model['semantics'], indexOffset=model['indexOffset'],
                       clearEndpointErrorPixels=model['clearEndpointErrorPixels'],
                       impliedLv3ThresholdInterval=implied,
                       compatibleWithSecondRoom=max(bounds[0], implied[0]) <= min(bounds[1], implied[1])))
report['secondRoomConstraint'] = dict(
    method='Manual new40/40 log readings and Lv3 classification, combined with audit121 bar constraints',
    addedObservations=additional, thresholdIntegerInterval=bounds,
    endpointInitialXpIntervals=[feasible[0], feasible[-1]],
    priorScaledModels=models,
    inputHashes={path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in [entry_path, prior_path]},
    limits=['Assumes the listed XP credits are the only changes before the first upgrade.',
            'The full-looking Lv3 bar is a clipped endpoint observation, not a level-up event.',
            'The upgrade animation at97s is excluded from balance constraints.',
            'Eliminating a scaled-table candidate does not prove the remaining curve is the server rule.',
            'No midpoint, exact threshold, initial balance or runtime growth table is adopted.'])
(args.out / '134-second-room-experience.json').write_text(json.dumps(report, indent=2) + '\n')
summary = dict(video=report['video'], sourceFps=30, sampleStart=76, strideFrames=15,
               selectedSamples=[r for r in rows if r['time'] in [82.5, 83.5, 96.5, 98]],
               secondRoomConstraint=report['secondRoomConstraint'],
               reproduce='python3 scripts/measure-reference-second-room-experience.py',
               limits=report['limits'])
(args.out / '134-second-room-constraint.json').write_text(json.dumps(summary, indent=2) + '\n')
print('Exact half-second samples:', len(rows))
print('Connected green pixels:', [(r['time'], r['connectedGreenPixels']) for r in rows])
print('Lv3 integer threshold interval:', bounds)
print('Prior scaled candidates:', models)
