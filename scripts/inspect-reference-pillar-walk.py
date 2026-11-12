#!/usr/bin/env python3
"""Export native walk dimensions; keep engine pass-state interpretation explicit."""
import argparse
import hashlib
import json
from pathlib import Path
from client_pvf import PvfArchive

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=Path('docs/reference-evidence/93-pillar-walk-source.json'))
args = parser.parse_args()
entries = ['character/swordman/swordman.chr',
           'passiveobject/mapobject/breakableobject/actionstonepillar.obj']
clients = []
for filename in ['Script.pvf', 'Script_70.pvf']:
    records = {}
    with PvfArchive(args.client / filename) as archive:
        for name in entries:
            tokens = archive.tokens(name)
            values = [v for _, v in tokens]
            start = values.index('[width]')
            record = {'sha256': hashlib.sha256(archive.read(name)).hexdigest(),
                      'width': values[start + 1:start + 3]}
            if '[pass type]' in values:
                record['passType'] = values[values.index('[pass type]') + 1]
            records[name] = record
    assert records[entries[0]]['width'] == [40, 10]
    assert records[entries[1]]['width'] == [58, 20]
    assert records[entries[1]]['passType'] == '[do not pass]'
    clients.append({'file': filename, 'entries': records})
result = {'clients': clients, 'mapping': {
    'nativeToWorldX': '(720/640)/CAMERA.zoom',
    'nativeToWorldDepth': '(720/640)/CAMERA.zoom/DEPTH.scale',
    'pillarCenter': 'native physical anchor, not bitmap bottom',
    'dimensionInterpretation': 'full extents; consistent with independent video contact check'},
    'limits': ['The static object pass flag is retained after damage; exact native engine post-hit changes remain unproved.',
               'Enemy native footprints remain unknown; existing enemy width fallback is retained.',
               'Only 12 video-identified room42 pillars are enabled; two unmatched map records are not added.']}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(args.out)
