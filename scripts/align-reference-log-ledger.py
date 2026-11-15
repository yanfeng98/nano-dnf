#!/usr/bin/env python3
"""Align manually transcribed scrolling logs; never infer OCR from image pixels.

Repeated XP rows alone cannot identify a scroll. Require a retained context
containing a non-XP row and occurring once in each snapshot. A compound SP/XP
pattern can be unique even when no individual SP row is unique.
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
            # Count the whole ordered block, not only individual row labels.
            # Pure XP runs remain insufficient even when their length is unique.
            def occurrences(lines):
                return sum(lines[i:i+size] == overlap for i in range(len(lines)-size+1))
            anchored = (any(not token.startswith('xp:') for token in overlap)
                        and occurrences(old) == occurrences(new) == 1)
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
                      'A unique retained context including non-XP rows identifies the maximal retained block; repeated XP runs alone are rejected.',
                      'This does not infer actor identity, position, AI, difficulty or a global XP formula.'])
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(result, indent=2) + '\n')
print('New credits:', credits, 'deaths:', len(credits), 'XP:', sum(credits))
