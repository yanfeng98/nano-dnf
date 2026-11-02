#!/usr/bin/env python3
"""Append native HardAttack art, preserving every existing sprite/icon/effect cell.

Sources: local Script.pvf hardattack.ani + hardattack1/2.ani (manifest in docs),
local skin/equipment NPKs, and hardattackblade1/2.img in swordman_effect.NPK.
No recording pixels are used as game artwork. Safe to rerun after a full bake.
"""
import argparse
import io
from pathlib import Path
from PIL import Image, ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
import import_dnf_swordman as body
ROOT = Path(__file__).resolve().parent.parent
SKILL_INDEX = 12
BODY_ROW = 13

def native_entries(client):
    with (client / 'ImagePacks2/sprite_character_swordman_effect.NPK').open('rb') as f:
        pack = NPK.open(f)
        result = {}
        for entry in pack.files:
            name = entry.name.rsplit('/', 1)[-1].lower()
            if name in ['hardattackblade1.img', 'hardattackblade2.img', 'skillicon.img']:
                result[name] = IMGFactory.open(io.BytesIO(entry.data))
        return result

def patch_effect_sheet(sheet, client):
    """Insert the new skill before extras, append its front layer after extras."""
    old_rows = sheet.height // 128
    if old_rows == 28:  # previous twelve skills and sixteen auxiliary rows
        expanded = Image.new('RGBA', (sheet.width, 30 * 128))
        expanded.paste(sheet.crop((0, 0, sheet.width, 12 * 128)), (0, 0))
        expanded.paste(sheet.crop((0, 12 * 128, sheet.width, sheet.height)), (0, 13 * 128))
        sheet = expanded
    elif old_rows == 29:  # full importer has already inserted the skill row
        expanded = Image.new('RGBA', (sheet.width, 30 * 128))
        expanded.paste(sheet, (0, 0)); sheet = expanded
    elif old_rows != 30:
        raise ValueError(f'Unexpected effects layout: {sheet.size}')
    entries = native_entries(client)
    # Both native ANIs place images at (-172,-233). Common 212px square window
    # [-50,-166,162,46] preserves registration across frames and both layers.
    # Rendering the cell at 144.16px gives 0.68 screen pixels/client pixel.
    for row, name in [(SKILL_INDEX, 'hardattackblade1.img'), (29, 'hardattackblade2.img')]:
        sheet.paste((0, 0, 0, 0), (0, row * 128, sheet.width, (row + 1) * 128))
        img = entries[name]
        if len(img.images) != 6: raise ValueError(f'Unexpected {name} length')
        for i, frame in enumerate(img.images):
            pic = img.build(frame).convert('RGBA')
            x, y = frame.x - 172, frame.y - 233
            if x < -50 or y < -166 or x + pic.width > 162 or y + pic.height > 46:
                raise ValueError(f'{name} frame{i} exceeds the declared window')
            canvas = Image.new('RGBA', (212, 212))
            canvas.alpha_composite(pic, (x + 50, y + 166))
            sheet.paste(canvas.resize((128, 128), Image.Resampling.LANCZOS), (i * 128, row * 128))
    return sheet

def append_body(client):
    path = ROOT / 'assets/slayer.png'
    old = Image.open(path).convert('RGBA')
    if old.size[0] != body.COLS * body.FRAME_W or old.height not in [13 * body.FRAME_H, 14 * body.FRAME_H]:
        raise ValueError(f'Unexpected Slayer layout {old.size}')
    sheet = Image.new('RGBA', (old.width, 14 * body.FRAME_H)); sheet.paste(old, (0, 0))
    sheet.paste((0, 0, 0, 0), (0, BODY_ROW * body.FRAME_H, sheet.width, sheet.height))
    source = body.Decoder(client)
    layers = [(key, source.frames(key)) for key in body.LAYERS]
    overlays = [(source.frames(key), ref, w, h) for key, ref, w, h in body.OVERLAYS]
    for col, index in enumerate(range(139, 157)):
        pic, x, y, foot = body.composed_frame(layers, overlays, index)
        cell = Image.new('RGBA', (body.FRAME_W, body.FRAME_H))
        body.place(cell, pic, x, y, foot)
        sheet.alpha_composite(cell, (col * body.FRAME_W, BODY_ROW * body.FRAME_H))
    sheet.save(path)

def append_icon(client):
    path = ROOT / 'assets/skills.png'; old = Image.open(path).convert('RGBA')
    if old.size not in [(384, 64), (416, 64)]: raise ValueError(f'Unexpected icon layout {old.size}')
    sheet = Image.new('RGBA', (416, 64)); sheet.paste(old, (0, 0))
    icons = native_entries(client)['skillicon.img']
    tile = Image.new('RGBA', (32, 32), (18, 22, 36, 255))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, 31, 31), radius=6, outline=(226, 191, 114, 255), width=1)
    tile.alpha_composite(icons.build(icons.images[10]).convert('RGBA').resize((32, 32), Image.Resampling.LANCZOS))
    sheet.paste(tile, (384, 0)); sheet.save(path)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    args = p.parse_args()
    append_body(args.client); append_icon(args.client)
    effect = ROOT / 'assets/effects.png'
    patch_effect_sheet(Image.open(effect).convert('RGBA'), args.client).save(effect)
    print('Appended ghost slash: 18 body frames, colour icon10, six back/front effect frames')
