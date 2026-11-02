#!/usr/bin/env python3
"""Bake cooldown icons from local client grey twins, preserving the colour/buff atlas."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageOps
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
from import_dnf_art import ICON_FRAMES, SKILL_IDS

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/dnf_src/skills-disabled.json')
args = parser.parse_args()
source = ROOT / 'assets/skills.png'
colour = Image.open(source).convert('RGBA')
assert colour.width == len(SKILL_IDS) * 32 and colour.height >= 32
pack = 'sprite_character_swordman_effect.NPK'
with (args.client / 'ImagePacks2' / pack).open('rb') as handle:
    entry = next(e for e in NPK.open(handle).files if e.name.endswith('/skillicon.img'))
    img = IMGFactory.open(io.BytesIO(entry.data))
    sheet = Image.new('RGBA', (colour.width, 32))
    records = []
    for index, skill in enumerate(SKILL_IDS):
        tile = colour.crop((index * 32, 0, index * 32 + 32, 32))
        grey = ImageOps.grayscale(tile).convert('RGBA')
        grey.putalpha(tile.getchannel('A'))
        frame = ICON_FRAMES.get(skill)
        if frame is not None:
            frame += 1
            native = img.build(img.images[frame]).convert('RGBA')
            native = native.resize((32, 32), Image.Resampling.LANCZOS)
            grey.alpha_composite(native)
            origin = {'pack': pack, 'entry': entry.name, 'frame': frame, 'kind': 'client-grey-twin'}
        else:
            origin = {'kind': 'derived-grey-effect-thumbnail',
                      'note': 'No selected atlas icon; desaturated existing client-effect thumbnail, not a verified recording icon.'}
        sheet.alpha_composite(grey, (index * 32, 0))
        records.append({'skill': skill, 'rect': [index * 32, 0, 32, 32], **origin})
output = ROOT / 'assets/skills-disabled.png'
sheet.save(output)
args.manifest.parent.mkdir(parents=True, exist_ok=True)
args.manifest.write_text(json.dumps({'colour_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                                     'disabled_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                                     'icons': records}, ensure_ascii=False, indent=2))
print(f'{len(records)} cooldown icons -> {output}; colour/buff atlas unchanged')
