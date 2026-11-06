#!/usr/bin/env python3
"""Bake the classic result circle, reward chest and gold digits from the local client.

The circle is an additive layer, so its native black backdrop is deliberately
preserved. All frames are copied without keying, scaling, painting or cropping.
Existing ui.png is separate: its older bake must not change while adding these.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ('magic', 'sprite_interface_newresult.NPK', 'sprite/interface/newresult/result.img', 1),
    ('chest', 'sprite_interface2_reward_ver2.0.NPK', 'sprite/interface2/reward_ver2.0/reward_ver2.img', 53),
] + [
    (f'digit{i}', 'sprite_interface2_reward_ver2.0.NPK',
     'sprite/interface2/reward_ver2.0/reward_ver2.img', 62+i)
    for i in range(10)
] + [
    ('cardGold', 'sprite_interface2_reward_ver2.0.NPK', 'sprite/interface2/reward_ver2.0/reward_ver2.img', 36),
    ('cardGlow', 'sprite_interface2_reward_ver2.0.NPK', 'sprite/interface2/reward_ver2.0/reward_ver2.img', 40),
    ('cardBurst', 'sprite_interface2_reward_ver2.0.NPK', 'sprite/interface2/reward_ver2.0/reward_ver2.img', 58),
]

def frames(client):
    for name, pack, entry, index in SOURCES:
        with (client/'ImagePacks2'/pack).open('rb') as f:
            item = next(e for e in NPK.open(f).files if e.name.replace('\\', '/') == entry)
            obj = IMGFactory.open(io.BytesIO(item.data))
            frame = obj.images[index]
            while type(frame).__name__ == 'ImageLink':
                frame = obj.images[frame.index]
            image = obj.build(frame).convert('RGBA')
            yield name, image, dict(pack=pack, entry=entry, frame=index,
                offset=[frame.x, frame.y], rgba_sha256=hashlib.sha256(image.tobytes()).hexdigest())

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    p.add_argument('--out', type=Path, default=ROOT/'assets/results-reference.png')
    a = p.parse_args()
    source = list(frames(a.client))
    sheet = Image.new('RGBA', (sum(im.width for _, im, _ in source), max(im.height for _, im, _ in source)))
    table = {}; x = 0
    for name, image, meta in source:
        # paste preserves even the native transparent pixels' RGB values.
        sheet.paste(image, (x, 0))
        table[name] = dict(rect=[x, 0, image.width, image.height], **meta)
        x += image.width
    a.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(a.out)
    print(json.dumps(dict(sheet=list(sheet.size), frames=table), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
