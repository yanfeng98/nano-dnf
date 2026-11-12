#!/usr/bin/env python3
"""Compare conditional debris pivot fits under video and angle-derived clocks.

This is a sensitivity diagnostic, not proof of native hit-stop/timer behavior.
All fits share named gravity1200 and eliminate each track's initial position/velocity.
"""
import argparse
import json
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--prior', type=Path, default=root/'docs/reference-evidence/92-pillar-hd-measurement.json')
parser.add_argument('--new', type=Path, default=root/'docs/reference-evidence/98-pillar-room43-debris-measurement.json')
parser.add_argument('--out', type=Path, default=root/'docs/reference-evidence/98-pillar-particle-clock-models.json')
args = parser.parse_args()
prior = json.loads(args.prior.read_text())
new = json.loads(args.new.read_text())
source = json.loads((root/'docs/reference-evidence/91-pillar-effect-client.json').read_text())
tracks = {name: {'kind': track['kind'], 'points': [p for p in track['points'] if p['score'] >= .9]}
          for name, track in prior['tracks'].items()}
for kind in [1, 3]:
    tracks[f'room43-type{kind}'] = {'kind': kind, 'points': [
        {'t': p['time'], 'angle': p['angle'], 'nativeCenter': p['nativeCenter']}
        for p in new['verified'] if p['kind'] == kind]}
centers, ani_vectors = {}, {}
for kind in range(1, 5):
    image = source['particleImages'][kind-1]
    centers[kind] = np.array(image['size'])/2
    ani = source['clients'][0]['animations'][f'stonepillarparticle{kind}.ani']['frames'][0]['xy']
    ani_vectors[kind] = np.array(ani)+image['imgOffset']+centers[kind]
models = {}
for clock in ['video', 'angle']:
    for pivot in ['imageCenter', 'aniOrigin', 'imageTopLeft']:
        residuals, per_track = [], {}
        for name, track in tracks.items():
            points = track['points']
            angles = np.array([p['angle'] for p in points])
            assert angles.max()-angles.min() < 180
            radians = np.radians(angles)
            t = np.array([p['t'] for p in points]) if clock == 'video' else angles/179
            t -= t[0]
            positions = np.array([p['nativeCenter'] for p in points])
            vector = {'imageCenter': np.zeros(2), 'aniOrigin': ani_vectors[track['kind']],
                      'imageTopLeft': centers[track['kind']]}[pivot]
            correction = np.array([(np.cos(radians)-1)*vector[0]+np.sin(radians)*vector[1],
                                   -np.sin(radians)*vector[0]+(np.cos(radians)-1)*vector[1]]).T
            physical = positions-correction
            physical[:, 1] -= 600*t*t
            design = np.column_stack([np.ones(len(t)), t])
            error = physical-design@np.linalg.lstsq(design, physical, rcond=None)[0]
            residuals.extend(error.flatten().tolist())
            per_track[name] = {'points': len(points), 'rmseHdPixels': float(np.sqrt(np.mean(error**2))*2.25)}
        models[f'{clock}-{pivot}'] = {'rmseHdPixels': float(np.sqrt(np.mean(np.array(residuals)**2))*2.25),
                                      'tracks': per_track}
assert sum(len(t['points']) for t in tracks.values()) == 42
report = {'points': 42, 'tracks': 6, 'gravityHypothesis': 1200, 'angularSpeedHypothesis': 179,
          'models': models, 'limits': [
              'Both clocks are hypotheses. Lower residual does not identify a native engine clock or prove hit-stop.',
              'Angles and positions come from the same image fits and have correlated uncertainty; angle-derived time is not independent ground truth.',
              'The same42 observations and initial-position/velocity fitting rules are used across all six models.',
              'The two short room43 tracks each have only three points; their low errors cannot select a pivot.',
              'Native gravity units, update integration and exact timing remain conditional; no runtime rule is changed.']}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({name: m['rmseHdPixels'] for name, m in models.items()}, indent=2))
