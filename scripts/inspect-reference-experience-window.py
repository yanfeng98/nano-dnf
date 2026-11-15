#!/usr/bin/env python3
"""Audit the old XP measurement ROI without treating green extent as gauge width."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', type=Path, default=Path('/tmp/nano138-xp-window'))
args = p.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
cases = [('121-v1-60-entry-xp.png', 'stable'),
         ('134-v1-82.5-second-room.png', 'stable'),
         ('134-v1-83.5-second-room.png', 'stable'),
         ('134-v1-96.5-second-room.png', 'stable'),
         ('127-v1-97-level-message.png', 'upgrade-animation'),
         ('134-v1-98-second-room.png', 'stable'),
         ('121-v2-15.5-entry-xp.png', 'stable')]
rows = []
sheet = Image.new('RGB', (1488, len(cases) * 230), '#202020')
draw = ImageDraw.Draw(sheet)
for index, (filename, phase) in enumerate(cases):
    path = ROOT / 'docs/reference-evidence' / filename
    image = Image.open(path).convert('RGB')
    rgb = np.array(image).astype(float)
    green = ((rgb[:, :, 1] > 110) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.25)
             & (rgb[:, :, 1] > rgb[:, :, 2] * 1.25))
    columns = green[486:493, 124:311].sum(axis=0) >= 3
    edges = np.diff(np.r_[False, columns, False].astype(int))
    runs = [[124 + int(a), 124 + int(b)]
            for a, b in zip(np.where(edges == 1)[0], np.where(edges == -1)[0])]
    legacy = columns[10:170]  # Old x134..294 ROI, inside the wider124..311 scan.
    fill = 0
    while fill < 160 and legacy[fill]:
        fill += 1
    rows.append(dict(frame=filename, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), phase=phase,
                     greenRunsExclusive=runs, legacyConnectedPixels=fill,
                     greenColumnsLeftOfLegacy=int(columns[:10].sum()),
                     greenColumnsRightOfLegacy=int(columns[170:].sum())))
    sheet.paste(image.crop((124, 477, 310, 500)).resize((1488, 184), Image.Resampling.NEAREST),
                (0, index * 230 + 30))
    draw.text((0, index * 230), filename, fill='white')
    for x in range(130, 311, 10):
        draw.text(((x - 124) * 8, index * 230 + 213), str(x), fill='white')
report = dict(legacyRoi=[134, 486, 160, 7], widerScan=[124, 486, 187, 7], samples=rows,
              interpretation='The old ROI omits green pixels on the left and clips stable near-full samples on the right.',
              limits=['Green-mask extent is not automatically the physical gauge width: frame clipping, glow and rasterization must be separated.',
                      'The97s full-width pulse is an animation control, not a stable balance measurement.',
                      'Nominal160 width and prior growth fits remain assumptions requiring independent frame/clip calibration.',
                      'No new nominal width, initial XP, threshold or runtime growth rule is adopted.'])
sheet.save(args.out / '138-experience-window-contact.png')
(args.out / '138-experience-window.json').write_text(json.dumps(report, indent=2) + '\n')
print([(r['frame'], r['greenRunsExclusive'], r['legacyConnectedPixels']) for r in rows])
