#!/usr/bin/env python3
"""Bake the recording's flat-capped stone pillar from the local client.

V2 76s: the broad elliptical cap and moss pattern match stonepillar.img f0,
not the diagonally broken 01obj006 used previously. Its ink is 44x133 at
anchor (2,7). No recolouring or painting is applied.
"""
import argparse
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=pathlib.Path, default=pathlib.Path('/mnt/c/dnf/地下城与勇士'))
args = parser.parse_args()
pic, offset = decode_at(args.client, 'sprite_map_breakableobject_stonepillar.NPK',
                        'sprite/map/breakableobject/stonepillar/stonepillar.img', 0)
pic.save(ROOT / 'assets/pillar-pale.png')
print('pillarPale', pic.size, 'offset', offset)
