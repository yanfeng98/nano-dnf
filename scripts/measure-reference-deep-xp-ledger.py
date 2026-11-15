#!/usr/bin/env python3
"""Cross-check a manual same-level XP ledger against unclipped green endpoints.

This fits pixels per XP without assuming a physical track width. The fit does
not identify a threshold or establish the manual death ledger independently.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('manifest', type=Path)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
manifest = json.loads(a.manifest.read_text())
rows = []
for sample in manifest['samples']:
    path = Path(sample['frame'])
    im = Image.open(path).convert('RGB')
    occupied = [sum(im.getpixel((x,y))[1] > 110 and
                    im.getpixel((x,y))[1] > im.getpixel((x,y))[0]*1.25 and
                    im.getpixel((x,y))[1] > im.getpixel((x,y))[2]*1.25
                    for y in range(486,493)) >= 3 for x in range(124,311)]
    runs = []
    start = None
    for i, on in enumerate(occupied + [False]):
        if on and start is None:
            start = i + 124
        if not on and start is not None:
            runs.append((start, i+124));start = None
    fill = [(lo,hi) for lo,hi in runs if 129 <= lo <= 136]
    if len(fill) != 1 or fill[0][1] == 311:
        raise ValueError(f'{path}: missing, ambiguous or clipped endpoint {runs}')
    rows.append({**sample, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                 'greenStart':fill[0][0], 'greenEndExclusive':fill[0][1]})
x = [r['cumulativeXP'] for r in rows]
y = [r['greenEndExclusive'] for r in rows]
mx,my = sum(x)/len(x),sum(y)/len(y)
slope = sum((u-mx)*(v-my) for u,v in zip(x,y))/sum((u-mx)**2 for u in x)
intercept = my-slope*mx
constraints = []
for i, first in enumerate(rows):
    for last in rows[i+1:]:
        credit = last['cumulativeXP']-first['cumulativeXP']
        delta = last['greenEndExclusive']-first['greenEndExclusive']
        if credit <= 0 or delta <= 4:
            raise ValueError('samples must increase and resolve a >4px endpoint delta')
        constraints.append(dict(times=[first['time'],last['time']],xpDelta=credit,
                                endpointDelta=delta,interval=[credit/(delta+4),credit/(delta-4)]))
interval = [max(c['interval'][0] for c in constraints),min(c['interval'][1] for c in constraints)]
result = dict(manifest=a.manifest.name,manifestSha256=hashlib.sha256(a.manifest.read_bytes()).hexdigest(),
              samples=rows, endpointErrorPixels=2, pairConstraints=constraints,
              xpPerVisiblePixelInterval=interval, feasible=interval[0]<=interval[1],
              leastSquaresXPPerPixel=1/slope, leastSquaresEndpointIntercept=intercept,
              residualPixels=[v-(intercept+slope*u) for u,v in zip(x,y)],
              limits=['Manual cumulative credits come from prior room audits, not from the runtime.',
                      'Assumes no level change, no unlisted XP event and a fixed same-level linear fill/glow relationship.',
                      'Small residuals support ledger consistency; they do not independently prove each death count or timing.',
                      'No physical track width, initial XP integer, threshold, scaling formula or runtime value is adopted.'])
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps(result,indent=2)+'\n')
print('XP/pixel interval:',interval,'fit:',1/slope,'max residual px:',max(abs(r) for r in result['residualPixels']))
