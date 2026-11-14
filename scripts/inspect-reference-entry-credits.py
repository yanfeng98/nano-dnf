#!/usr/bin/env python3
"""Assemble the checked-in V1 entry death logs; readings are manual, not OCR.

Frames come from the reproducible extraction in audits121/130. This records
only the observed room; it does not infer a type-wide or level-wide XP rule.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=Path('/tmp/nano132-entry-credits'))
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
evidence = ROOT / 'docs/reference-evidence'
sheet = Image.new('RGB', (1000, 660), '#181818')
draw = ImageDraw.Draw(sheet)
rows = []
for index, (time, amount, cumulative, filename) in enumerate([
    (69.6, 40, 40, '130-v1-69.6-follow.png'),
    (69.8, 40, 80, '130-v1-69.8-follow.png'),
    (71.3, 80, 160, '130-v1-71.3-follow.png'),
    (73.6, 40, 200, '130-v1-73.6-follow.png'),
]):
    path = evidence / filename
    frame = Image.open(path).convert('RGB')
    assert frame.size == (720, 540)
    x, y = index % 2 * 500, index // 2 * 330
    draw.text((x, y), f'V1 {time}s: +{amount}, cumulative {cumulative}', fill='white')
    # Include the target strip and growing log rather than isolated digits.
    sheet.paste(frame.crop((0, 20, 360, 235)).resize((500, 299)), (x, y + 25))
    rows.append(dict(time=time, frame=filename,
                     sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                     manualCredit=amount, cumulativeCredit=cumulative))
report = dict(
    method='Manual log readings in original-frame extracts, not OCR',
    video='00001-幽暗密林.mp4', samples=rows,
    entryRosterSource='119-entry-roster-reference.json',
    entryCountSource='115-entry-enemy-configuration.json referenceOrdinary: 0 -> 4',
    runtimeCredits={'grunt': 40, 'coward': 40, 'caster': 40, 'cursedRed': 80},
    total=200,
    limits=[
        'The target/portrait and purple aura identify the 80-credit cursed-red death.',
        'The other three roster members each pay 40; first-pair order is not identified.',
        'Room observations do not establish credits in other rooms or another stage.',
        'Initial XP, thresholds, exact death phase and clear rewards remain separate questions.',
    ])
sheet.save(args.out / '132-entry-credits-contact.png')
(args.out / '132-entry-credits-reference.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('V1 entry: four credits', [row['manualCredit'] for row in rows], 'total', report['total'])
