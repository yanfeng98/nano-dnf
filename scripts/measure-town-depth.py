#!/usr/bin/env python3
"""V1 town vertical motion: track the player's name and static architecture.

Video crops are audit evidence, never game assets. Only continuous intervals
with stable scenery are used for vertical fits; the room seam is excluded.
"""
import argparse
import json
import subprocess
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--video', type=Path, default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
parser.add_argument('--out', type=Path, default=Path('/tmp/nano-town-depth'))
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)
subprocess.run(['ffmpeg', '-v', 'error', '-threads', '1', '-y', '-ss', '11.49',
                '-i', str(args.video), '-t', '1.85', '-vf',
                'crop=1440:1080:240:0,scale=720:540', '-vsync', '0',
                str(args.out/'frame-%03d.png')], check=True)
frames = [cv2.imread(str(args.out/f'frame-{i:03d}.png')) for i in range(1, 57)]
template = cv2.cvtColor(frames[49], cv2.COLOR_BGR2GRAY)[227:242, 258:346]
cv2.imwrite(str(args.out/'name-template.png'), template)
detector = cv2.SIFT_create(nfeatures=1000)
previous = None
camera = 0.0
samples = []
for index, image in enumerate(frames):
    # Do not infer one world-camera coordinate through a town-room change.
    if 37 <= index <= 40:
        previous = None
        camera = 0.0
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    roi = gray[190:430, 200:410]
    _, score, _, location = cv2.minMaxLoc(cv2.matchTemplate(roi, template, cv2.TM_CCOEFF_NORMED))
    mask = np.zeros(gray.shape, np.uint8)
    # Exclude the large screen-fixed town title and upper-right HUD.
    mask[100:255, :600] = 255
    keys, descriptors = detector.detectAndCompute(gray, mask)
    dx = None
    matches_used = 0
    if previous is not None:
        old_keys, old_descriptors = previous
        matches = cv2.BFMatcher().knnMatch(old_descriptors, descriptors, k=2)
        good = [a for a, b in matches if a.distance < .6*b.distance]
        delta = np.array([np.array(keys[m.trainIdx].pt)-old_keys[m.queryIdx].pt for m in good])
        delta = delta[np.abs(delta[:, 1]) < .8]
        if len(delta) > 5:
            values, counts = np.unique(np.round(delta[:, 0]), return_counts=True)
            mode = values[np.argmax(counts)]
            selected = delta[np.abs(delta[:, 0]-mode) < 1, 0]
            dx = float(np.median(selected))
            camera -= dx
            matches_used = len(selected)
    previous = keys, descriptors
    samples.append({'sample': index+1, 'time': 11.5+index/30,
                    'name_x': location[0]+200, 'name_y': location[1]+190,
                    'name_score': score, 'camera_x': None if 37 <= index <= 39 else camera,
                    'camera_segment': 1 if index < 37 else (None if index < 40 else 2),
                    'background_dx': dx, 'background_matches': matches_used})

def fit(first, last, field):
    selected = samples[first-1:last]
    times = np.array([s['time'] for s in selected])
    values = np.array([s[field] for s in selected])
    slope, offset = np.polyfit(times, values, 1)
    residual = values-slope*times-offset
    return {'first': first, 'last': last, 'time': [float(times[0]), float(times[-1])],
            'speed': float(slope), 'rms': float(np.sqrt(np.mean(residual**2)))}

horizontal = fit(1, 16, 'camera_x')
vertical = [fit(22, 31, 'name_y'), fit(46, 52, 'name_y')]
for window in vertical:
    selected = samples[window['first']-1:window['last']]
    window['camera_span'] = max(s['camera_x'] for s in selected)-min(s['camera_x'] for s in selected)
    window['name_x_span'] = max(s['name_x'] for s in selected)-min(s['name_x'] for s in selected)
    window['ratio_to_horizontal'] = window['speed']/abs(horizontal['speed'])
    window['minimum_name_score'] = min(s['name_score'] for s in selected)
    if window['camera_span'] > .1 or window['name_x_span'] != 0 or window['minimum_name_score'] < .5:
        raise ValueError('The selected vertical interval is no longer stationary in x')
result = {'video': args.video.name, 'normalized_size': [720, 540],
          'horizontal': horizontal, 'vertical': vertical, 'samples': samples,
          'ratio_band': [.48, .53], 'target_ratio': .5,
          'limits': 'Two short vertical intervals. Player-name bob/occlusion and compressed video limit precision. '
                    'The ratio band pads the observed .496..514 range; it is not an exact client constant. '
                    'No diagonal-input or camera-response rule is inferred; samples 38..40 cross a town room seam.'}
(args.out/'measurement.json').write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k != 'samples'}, indent=2, ensure_ascii=False))
