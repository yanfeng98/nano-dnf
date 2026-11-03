#!/usr/bin/env python3
"""Bake the orange ground-wave family confirmed by V2 111.333–111.900.

Body42–50, normalwaveslash.ani / hadouken_ken, hadouken_hadou and the
common CastingGage flash. Do not substitute legacy normalwave1/2 wedges
or the installed client's newer blue light_hadouken variant.
"""
import argparse
import io
from pathlib import Path
from PIL import Image, ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
import import_dnf_swordman as body
from import_dnf_reference_player import native_wave_body
ROOT = Path(__file__).resolve().parent.parent

def native_entries(client):
    with (client / 'ImagePacks2/sprite_character_swordman_effect.NPK').open('rb') as f:
        result = {}
        for entry in NPK.open(f).files:
            name = entry.name.rsplit('/', 1)[-1].lower()
            if name in ['hadouken_ken.img', 'hadouken_hadou.img', 'skillicon.img']:
                result[name] = IMGFactory.open(io.BytesIO(entry.data))
    with (client / 'ImagePacks2/sprite_common_etc.NPK').open('rb') as f:
        entry = next(e for e in NPK.open(f).files if e.name.lower().endswith('/castinggage.img'))
        result['castinggage.img'] = IMGFactory.open(io.BytesIO(entry.data))
        return result

def patch_wave_effects(sheet, client):
    rows = sheet.height // 128
    if rows == 30:  # thirteen skills + seventeen extras, before ground wave
        new = Image.new('RGBA', (sheet.width, 32 * 128))
        new.paste(sheet.crop((0, 0, sheet.width, 13 * 128)), (0, 0))
        new.paste(sheet.crop((0, 13 * 128, sheet.width, sheet.height)), (0, 14 * 128))
        sheet = new
    elif rows == 31:  # standard full bake already inserted skill and ghost front
        new = Image.new('RGBA', (sheet.width, 32 * 128))
        new.paste(sheet, (0, 0)); sheet = new
    elif rows != 32:
        raise ValueError(f'Unexpected effects grid: {sheet.size}')
    entries = native_entries(client)
    specs = [(13, 'hadouken_ken.img', (-108, -234), (-128, -192, 192, 128)),
             (31, 'hadouken_hadou.img', (-280, -231), (-160, -160, 160, 160))]
    for row, name, offset, window in specs:
        sheet.paste((0, 0, 0, 0), (0, row * 128, sheet.width, (row + 1) * 128))
        source = entries[name]
        expected = 5
        if len(source.images) != expected: raise ValueError(f'Unexpected {name} frame count')
        left, top, right, bottom = window
        for i, frame in enumerate(source.images):
            pic = source.build(frame).convert('RGBA')
            x, y = frame.x + offset[0], frame.y + offset[1]
            if x < left or y < top or x + pic.width > right or y + pic.height > bottom:
                raise ValueError(f'{name} frame{i} would be clipped')
            canvas = Image.new('RGBA', (right - left, bottom - top))
            canvas.alpha_composite(pic, (x - left, y - top))
            sheet.paste(canvas.resize((128, 128), Image.Resampling.LANCZOS), (i * 128, row * 128))
    return sheet

def append_body(client):
    path = ROOT / 'assets/slayer.png'; old = Image.open(path).convert('RGBA')
    if old.width != body.COLS * body.FRAME_W or old.height not in [14 * body.FRAME_H, 15 * body.FRAME_H]:
        raise ValueError(f'Unexpected Slayer grid: {old.size}')
    sheet = Image.new('RGBA', (old.width, 15 * body.FRAME_H)); sheet.paste(old, (0, 0))
    sheet.paste((0, 0, 0, 0), (0, 14 * body.FRAME_H, sheet.width, 15 * body.FRAME_H))
    decoder = body.Decoder(client)
    layers = [(key, decoder.frames(key)) for key in body.LAYERS]
    overlays = [(decoder.frames(key), ref, w, h) for key, ref, w, h in body.OVERLAYS]
    # Preserve the historical shared-sheet fallback. The dedicated native
    # body below uses the recorded short sword and the common ANI root.
    for col, index in enumerate(range(42, 51)):
        pic, x, y, foot = body.composed_frame(layers, overlays, index)
        cell = Image.new('RGBA', (body.FRAME_W, body.FRAME_H))
        body.place(cell, pic, x, y, foot)
        sheet.alpha_composite(cell, (col * body.FRAME_W, 14 * body.FRAME_H))
    sheet.save(path)
    native_wave_body(client).save(ROOT / 'assets/normal-wave-body.png')

def native_effect_sheet(client):
    """Native fire slash / fire fan / casting flash / casting gauge rows."""
    sheet = Image.new('RGBA', (6 * 320, 4 * 320))
    entries = native_entries(client)
    for row, name, offset, window in [
        (0, 'hadouken_ken.img', (-108,-234), (-128,-192,192,128)),
        # The moving record is centred on native x180; retain img offsets.
        (1, 'hadouken_hadou.img', (-280,-231), (-160,-160,160,160)),
        (2, 'castinggage.img', (-58,-167), (-160,-256,160,64))]:
        source = entries[name]
        indices = range(4,10) if row == 2 else range(5)
        for col, index in enumerate(indices):
            frame = source.images[index]
            pic = source.build(frame).convert('RGBA')
            x, y = frame.x + offset[0] - window[0], frame.y + offset[1] - window[1]
            if x < 0 or y < 0 or x + pic.width > 320 or y + pic.height > 320:
                raise ValueError(f'Native wave effect {name} {col} would be clipped')
            sheet.alpha_composite(pic, (col * 320 + x, row * 320 + y))
    gauge = entries['castinggage.img']
    for col, index, x, y in [(0,0,-26,-112),(1,1,-25,-111),(2,2,-29,-114)]:
        f = gauge.images[index]
        sheet.alpha_composite(gauge.build(f).convert('RGBA'), (col*320+x+160,3*320+y+256))
    return sheet

def append_icon(client):
    path = ROOT / 'assets/skills.png'; old = Image.open(path).convert('RGBA')
    if old.size not in [(416, 64), (448, 64)]: raise ValueError(f'Unexpected icon grid: {old.size}')
    sheet = Image.new('RGBA', (448, 64)); sheet.paste(old, (0, 0))
    icons = native_entries(client)['skillicon.img']
    tile = Image.new('RGBA', (32, 32), (18, 22, 36, 255))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, 31, 31), radius=6, outline=(226, 191, 114, 255), width=1)
    tile.alpha_composite(icons.build(icons.images[6]).convert('RGBA').resize((32, 32), Image.Resampling.LANCZOS))
    sheet.paste(tile, (416, 0)); sheet.save(path)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    args = p.parse_args()
    append_body(args.client); append_icon(args.client)
    native_effect_sheet(args.client).save(ROOT / 'assets/normal-wave.png')
    path = ROOT / 'assets/effects.png'
    patch_wave_effects(Image.open(path).convert('RGBA'), args.client).save(path)
    print('Ground wave: nine body poses, five fire slash/fan frames, casting flash and gauge')
