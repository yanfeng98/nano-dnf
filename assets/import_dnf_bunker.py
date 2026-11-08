#!/usr/bin/env python3
"""Bake four native GoblinBunker idle phases with shared IMG/ANI coordinates.

Local body/door/floor use frame0; flag and grass use frames0..3 at 150ms.
All five ANI origins are (-77,-132), so IMG offsets share a common canvas.
No recolouring, hand drawing or video pixels are used.
"""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image
from import_dnf_scene import decode_at

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
a = parser.parse_args()
pack = 'sprite_map_trap_goblinbunker.NPK'
layers, proof = {}, {}
for name in ['floorgrass', 'body', 'door', 'flag', 'grass']:
    count = 4 if name in ['flag', 'grass'] else 1
    layers[name] = []
    for frame in range(count):
        entry = f'sprite/map/trap/goblinbunker/gobbunk_{name}.img'
        image, offset = decode_at(a.client, pack, entry, frame)
        layers[name].append((image, offset))
        proof[f'{name}:{frame}'] = {'entry': entry, 'frame': frame, 'offset': list(offset),
            'size': list(image.size), 'rgba_sha256': hashlib.sha256(image.tobytes()).hexdigest()}
left = min(offset[0] for frames in layers.values() for _, offset in frames)
top = min(offset[1] for frames in layers.values() for _, offset in frames)
right = max(offset[0] + image.width for frames in layers.values() for image, offset in frames)
bottom = max(offset[1] + image.height for frames in layers.values() for image, offset in frames)
w, h = right - left, bottom - top
sheet = Image.new('RGBA', (w * 4, h))
for phase in range(4):
    canvas = Image.new('RGBA', (w, h))
    for name in ['floorgrass', 'body', 'door', 'flag', 'grass']:
        frames = layers[name]
        image, offset = frames[phase % len(frames)]
        canvas.alpha_composite(image, (offset[0] - left, offset[1] - top))
    sheet.paste(canvas, (phase * w, 0))
sheet.save(ROOT / 'assets/goblin-bunker.png')
print(json.dumps({'pack': pack, 'sheet': list(sheet.size), 'frame': [w, h],
    'crop': [left, top, right, bottom], 'native_root_in_frame': [77-left, 132-top],
    'phase_ms': 150, 'layers': proof, 'sheet_rgba_sha256': hashlib.sha256(sheet.tobytes()).hexdigest()}, indent=2))
