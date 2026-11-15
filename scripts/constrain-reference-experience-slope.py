#!/usr/bin/env python3
"""Bound XP per visible pixel from stable same-level samples, without gauge width.

The ledger is manually read in audits121/134. This measures green endpoints in
an expanded window; it does not identify the physical fill/glow boundary, a
level threshold, initial XP, or a server progression formula.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', type=Path, default=Path('/tmp/nano145-experience-slope.json'))
a = p.parse_args()
entry = ROOT / 'docs/reference-evidence/121-entry-xp.json'
second = ROOT / 'docs/reference-evidence/134-second-room-constraint.json'
observations = [r for r in json.loads(entry.read_text())['samples'] if r['video'] == 1]
observations += json.loads(second.read_text())['secondRoomConstraint']['addedObservations']
rows = []
for r in observations:
    path = ROOT / 'docs/reference-evidence' / r['frame']
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(float)[486:493, 124:311]
    mask = ((rgb[:, :, 1] > 110) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.25)
            & (rgb[:, :, 1] > rgb[:, :, 2] * 1.25)).sum(axis=0) >= 3
    edges = np.diff(np.r_[False, mask, False].astype(int))
    runs = [(124 + int(lo), 124 + int(hi)) for lo, hi in
            zip(np.where(edges == 1)[0], np.where(edges == -1)[0])]
    candidates = [(lo, hi) for lo, hi in runs if 129 <= lo <= 136]
    if len(candidates) != 1:
        raise ValueError(f'{path.name}: ambiguous connected fill {runs}')
    lo, hi = candidates[0]
    if hi == 311:
        raise ValueError(f'{path.name}: expanded window still clips the endpoint')
    rows.append(dict(frame=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                     time=r['time'], credit=r['credit'], greenStart=lo, greenEndExclusive=hi))
constraints = []
for i, first in enumerate(rows):
    for last in rows[i+1:]:
        credit = last['credit'] - first['credit']
        if credit <= 0:
            continue
        delta = last['greenEndExclusive'] - first['greenEndExclusive']
        if delta + 4 <= 0:
            raise ValueError('Observed endpoint order contradicts the positive XP ledger')
        # Two independent ±2px endpoint errors; fixed origin cancels.
        constraints.append(dict(times=[first['time'], last['time']], credit=credit,
                                endpointDelta=delta, xpPerPixelLower=credit/(delta+4),
                                xpPerPixelUpper=credit/(delta-4) if delta > 4 else None))
lo = max(r['xpPerPixelLower'] for r in constraints)
hi = min(r['xpPerPixelUpper'] for r in constraints if r['xpPerPixelUpper'] is not None)
report = dict(inputs=[dict(file=f.name, sha256=hashlib.sha256(f.read_bytes()).hexdigest())
                      for f in [entry, second]], endpointErrorPixels=2, samples=rows,
              constraints=constraints, xpPerVisiblePixelInterval=[lo, hi], feasible=lo <= hi,
              limits=['Assumes a fixed same-level linear gauge, stable glow offset, and the manual XP ledger.',
                      'This is a ratio of threshold to track width, not an identified threshold.',
                      'No physical gauge width, initial balance, XP formula or runtime value is adopted.',
                      'Upgrade flashes and frames after the level change are excluded.'])
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(report, indent=2) + '\n')
print('XP per visible pixel:', [lo, hi], 'feasible:', lo <= hi)
