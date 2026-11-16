#!/usr/bin/env python3
"""Expose the client's legacy ASCII glyphs through a Unicode cmap, for inspection.

The original font is never modified. No outline or horizontal metric changes
are allowed, and this candidate is not installed into runtime assets.
"""
import argparse
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, default=Path('/mnt/c/dnf/地下城与勇士/Fonts/Gasinamu.ttf'))
p.add_argument('--out', type=Path, default=Path('/tmp/nano150-level-font'))
a = p.parse_args()
if a.out.resolve().is_relative_to(ROOT/'assets'):
    p.error('this is an inspection candidate, not a verified runtime font')
a.out.mkdir(parents=True, exist_ok=True)
f = TTFont(a.source, recalcTimestamp=False)
original = {name:hashlib.sha256(f.getTableData(name)).hexdigest() for name in ['glyf','hmtx']}
legacy = next(t for t in f['cmap'].tables if t.platformID == 3 and t.platEncID == 5)
mapping = {k:v for k,v in legacy.cmap.items() if 32 <= k < 127}
assert all(ord(c) in mapping for c in 'Lv.0123456789')
t = CmapSubtable.newSubtable(4)
t.platformID,t.platEncID,t.language = 3,1,0
t.cmap = mapping
f['cmap'].tables.append(t)
output = a.out/'gasinamu-ascii.ttf'
f.save(output)
adapted = TTFont(output)
after = {name:hashlib.sha256(adapted.getTableData(name)).hexdigest() for name in original}
assert original == after, 'source outlines or horizontal metrics changed'
report = dict(source=str(a.source),sourceSha256=hashlib.sha256(a.source.read_bytes()).hexdigest(),
              legacyCmap=dict(platformID=3,encodingID=5,entries=len(legacy.cmap)),
              addedUnicodeASCIIEntries=len(mapping),glyphMap={c:mapping[ord(c)] for c in 'Lv.0123456789'},
              output=output.name,outputSha256=hashlib.sha256(output.read_bytes()).hexdigest(),
              unchangedTableHashes=original,verifiedUnchanged=original==after,
              limits=['Unicode cmap exposes existing ASCII glyph IDs; no new glyphs are drawn.',
                      'Container headers/checksums may be normalized when saving; glyf/hmtx bytes are verified unchanged.',
                      'This does not prove the exact recorded font or Windows rasterization pipeline.',
                      'No runtime asset, experience threshold, progress width or renderer is changed.'])
(a.out/'font-mapping.json').write_text(json.dumps(report,indent=2)+'\n')
print('ASCII mapping added:',len(mapping),'outline/metric hashes unchanged:',original==after)
