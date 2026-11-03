#!/usr/bin/env python3
"""Reference player's native short sword, identified in V2 111.333/111.633.

Keep the historical katana sheet available; the playable reference profile
uses this complete sheet so equipping the short sword does not change per move.
"""
from pathlib import Path
from contextlib import contextmanager
import argparse
from PIL import Image
import import_dnf_swordman as body
ROOT=Path(__file__).resolve().parents[1]

def weapon_sources():
    return {f'weapon_{part}':('sprite_character_swordman_equipment_weapon_sswd.NPK',
        f'sprite/character/swordman/equipment/weapon/sswd/sswd0000{part}.img') for part in ['b','c']}

@contextmanager
def reference_weapon():
    saved={key:body.PACKS[key] for key in weapon_sources()}
    body.PACKS.update(weapon_sources())
    try: yield
    finally: body.PACKS.update(saved)

def native_wave_body(client):
    with reference_weapon():
        decoder=body.Decoder(client)
        layers=[(key,decoder.frames(key)) for key in body.LAYERS]
        overlays=[(decoder.frames(key),ref,w,h) for key,ref,w,h in body.OVERLAYS]
        sheet=Image.new('RGBA',(9*384,320))
        for col,index in enumerate(range(42,51)):
            pic,x,y,_=body.composed_frame(layers,overlays,index)
            px,py=x-232+160,y-333+240
            if px<0 or py<0 or px+pic.width>384 or py+pic.height>320:
                raise ValueError(f'Native reference wave body{index} would be clipped')
            sheet.alpha_composite(pic,(col*384+px,py))
        return sheet

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
    args=parser.parse_args()
    with reference_weapon():
        sheet=body.build(args.client,False)
    sheet.save(ROOT/'assets/slayer-reference.png')
    native_wave_body(args.client).save(ROOT/'assets/normal-wave-body.png')
    print('Reference short sword sswd0000: complete player sheet + native wave body')
