#!/usr/bin/env python3
"""Reuse the local client's gold level glyphs for known skill-rank labels."""
import argparse
from pathlib import Path
from PIL import Image, ImageOps
from import_dnf_scene import decode_at
ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
args = parser.parse_args()
sheet = Image.new('RGBA', (220, 24))
for index in range(11):
    pic, _ = decode_at(args.client, 'sprite_interface2_hud.NPK', 'sprite/interface2/hud/level02.img', index)
    sheet.alpha_composite(pic, (index * 20, 0))
    grey = ImageOps.grayscale(pic).convert('RGBA'); grey.putalpha(pic.getchannel('A'))
    sheet.alpha_composite(grey, (index * 20, 12))
sheet.save(ROOT / 'assets/skill-ranks.png')
print('Client level02 glyphs: 0–9, Lv prefix; gold and derived-grey rows')
