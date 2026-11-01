#!/usr/bin/env python3
"""Reproduce selected client HUD contact sheets; these are candidates, not skin matches."""
import argparse
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

SOURCES = [
    ('ImagePacks2', 'sprite_interface2_hud.NPK', ['hpmp_vessel', 'hud02', 'menu_icon'], 'new'),
    ('ImagePacks2', 'sprite_interface2_hud(ex).NPK', ['hud', 'menu_icon'], 'ex'),
    ('ImagePacks2_70', 'sprite_interface.NPK', ['mainhud'], 'legacy'),
]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=Path('/tmp/nano-hud-candidates'))
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
manifest = []
for folder, pack, names, tag in SOURCES:
    with (args.client / folder / pack).open('rb') as handle:
        for entry in NPK.open(handle).files:
            stem = Path(entry.name).stem
            if stem not in names:
                continue
            img = IMGFactory.open(io.BytesIO(entry.data))
            sheet_name = f'{tag}-{stem}.jpg'
            board = Image.new('RGBA', (1100, 110 * ((len(img.images) + 9) // 10)), (35, 35, 35, 255))
            draw = ImageDraw.Draw(board)
            for index, frame in enumerate(img.images):
                pic = img.build(frame).convert('RGBA')
                box = pic.getbbox()
                if box:
                    pic = pic.crop(box)
                native = pic.size
                manifest.append({'folder': folder, 'pack': pack, 'entry': entry.name,
                                 'frame': index, 'size': native, 'sheet': sheet_name})
                pic.thumbnail((104, 82))
                x, y = (index % 10) * 110, (index // 10) * 110
                board.alpha_composite(pic, (x + (110 - pic.width) // 2, y))
                draw.text((x + 2, y + 83), f'{index} {native[0]}x{native[1]}', fill='white')
            board.convert('RGB').save(args.out / sheet_name)
(args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(f'{len(manifest)} candidate frames -> {args.out}')
