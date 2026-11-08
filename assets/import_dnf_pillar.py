#!/usr/bin/env python3
"""Bake the recording's flat and damaged stone pillars from the local client.

V2 76s: the broad elliptical cap and moss pattern match stonepillar.img f0,
not the diagonally broken 01obj006 used previously. Its ink is 44x133 at
anchor (2,7). V2 room42 also has the distinct stonepillardamaged frame (44x111,
anchor 3,29). Append it after the original 44x133 region without changing that
region's RGBA. No recolouring or painting is applied.
"""
import argparse
import pathlib
import sys
import hashlib
import json
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=pathlib.Path, default=pathlib.Path('/mnt/c/dnf/地下城与勇士'))
args = parser.parse_args()
pack = 'sprite_map_breakableobject_stonepillar.NPK'
sources = [('pillarPale', 'stonepillar'), ('pillarDamagedDecor', 'stonepillardamaged')]
decoded = [(name, stem, *decode_at(args.client, pack,
           f'sprite/map/breakableobject/stonepillar/{stem}.img', 0)) for name, stem in sources]
sheet = Image.new('RGBA', (sum(pic.width for _, _, pic, _ in decoded), max(pic.height for _, _, pic, _ in decoded)))
proof = {}; x = 0
for name, stem, pic, offset in decoded:
    sheet.paste(pic, (x, 0))
    proof[name] = dict(rect=[x, 0, pic.width, pic.height], offset=list(offset),
        folder='ImagePacks2', pack=pack, entry=f'sprite/map/breakableobject/stonepillar/{stem}.img',
        frame=0, rgba_sha256=hashlib.sha256(pic.tobytes()).hexdigest())
    x += pic.width
sheet.save(ROOT / 'assets/pillar-pale.png')
print(json.dumps(dict(sheet=list(sheet.size), frames=proof), indent=2))
