#!/usr/bin/env python3
"""Align manually transcribed scrolling logs; never infer OCR from image pixels.

Repeated XP rows alone cannot identify a scroll. Require a non-XP token that
occurs once in both snapshots inside the retained overlap. This makes each
count independently reviewable against the cited source frames.
"""
import argparse
import hashlib
import json
from pathlib import Path
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('ledger', type=Path)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
source = json.loads(a.ledger.read_text())
rows = source['snapshots']
transitions = []
credits = []
for before, after in zip(rows, rows[1:]):
    old, new = before['lines'], after['lines']
    if old == new:
        kept = len(old)
    else:
        candidates = []
        for size in range(1, min(len(old), len(new)) + 1):
            overlap = old[-size:]
            if overlap != new[:size]:
                continue
            anchored = any(not token.startswith('xp:') and old.count(token) == new.count(token) == 1
                           for token in overlap)
            if anchored:
                candidates.append(size)
        if not candidates:
            raise ValueError(f"{before['time']}->{after['time']}: no unique retained non-XP anchor; transcribe intermediate frames")
        kept = max(candidates)
    added = new[kept:]
    values = [int(token.split(':')[1]) for token in added if token.startswith('xp:')]
    credits.extend(values)
    transitions.append(dict(times=[before['time'], after['time']], retainedRows=kept,
                            newLines=added, newXPCredits=values))
result = dict(source=a.ledger.name, sourceSha256=hashlib.sha256(a.ledger.read_bytes()).hexdigest(),
              transitions=transitions, credits=credits, creditedDeaths=len(credits), totalXP=sum(credits),
              limits=['Input is manual transcription, not OCR; source frames must be reviewed.',
                      'Identical snapshots add no events; XP rows already present in the baseline are excluded.',
                      'Uniquely retained non-XP anchors rule out counting repeated unchanged XP lines as new.',
                      'This does not infer actor identity, position, AI, difficulty or a global XP formula.'])
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(result, indent=2) + '\n')
print('New credits:', credits, 'deaths:', len(credits), 'XP:', sum(credits))
