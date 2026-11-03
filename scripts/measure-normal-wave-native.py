#!/usr/bin/env python3
"""Verify ground-wave sheets against local native pixels and the shared ANI root.

No game art is drawn or resized here. Run after import_dnf_normal_wave.py.
"""
import argparse, hashlib, json, sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'assets'))
import import_dnf_swordman as body
from import_dnf_normal_wave import native_entries
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-wave-native-measurement.json'))
a = p.parse_args()
d = body.Decoder(a.client)
source_hashes = {}
for key in dict.fromkeys(body.LAYERS + [v[0] for v in body.OVERLAYS]):
    pack, entry = body.PACKS[key]
    raw = next(e.data for e in d._pack(pack).files if e.name.replace('\\','/') == entry)
    assert d.raw(key) == raw, f'Stale cached client layer: {key}'
    source_hashes[key] = hashlib.sha256(raw).hexdigest()
layers = [(k,d.frames(k)) for k in body.LAYERS]
overlays = [(d.frames(k),ref,w,h) for k,ref,w,h in body.OVERLAYS]
actual = Image.open(ROOT/'assets/normal-wave-body.png').convert('RGBA')
assert actual.size == (3456,320)
frames=[]
for col,index in enumerate(range(42,51)):
    pic,x,y,foot=body.composed_frame(layers,overlays,index)
    expected=Image.new('RGBA',(384,320))
    expected.alpha_composite(pic,(x-242+160,y-341+240))
    cell=actual.crop((col*384,0,(col+1)*384,320))
    assert cell.tobytes()==expected.tobytes(), f'Body{index} differs from native composition'
    old_x=round(88-body.foot_centre(foot)*0.68)
    native_x=round(88+(x-242)*0.68)
    frames.append({'image':index,'source_composite_x':x,'packed_x':old_x,
                   'native_x':native_x,'old_root_error_world_px':old_x-native_x})
fx=Image.open(ROOT/'assets/normal-wave.png').convert('RGBA')
assert fx.size==(1536,512)
entries=native_entries(a.client)
for row,name,offset in [(0,'normalwave1.img',(-43,-106)),(1,'normalwave2.img',(-70,-54))]:
    source=entries[name]
    for col,f in enumerate(source.images):
        expected=Image.new('RGBA',(256,256))
        expected.alpha_composite(source.build(f).convert('RGBA'),(f.x+offset[0]+64,f.y+offset[1]+160))
        actual=fx.crop((col*256,row*256,(col+1)*256,(row+1)*256))
        assert actual.tobytes()==expected.tobytes(), f'{name}{col} changed native pixels'
result={'source':'local client, wave.ani; ImagePacks2 skin/equipment and base swordman effect NPK',
        'source_layer_sha256':source_hashes,'body_origin':[242,341],'body_cell':[384,320],'body_root_in_cell':[160,240],
        'effect_native_window':[-64,-160,192,96],'world_scale':0.68,
        'body_native_pixel_match':True,'effect_native_pixel_match':True,'frames':frames,
        'old_frame43_to44_root_shift_world_px':frames[2]['old_root_error_world_px']-frames[1]['old_root_error_world_px'],
        'recording_cast_identity_confirmed':False,
        'limits':'Checks installed-client animation geometry and pixels. Does not prove the recording used this animation/art variant, timing, rank or balance.'}
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f'9 body poses and 10 FX frames match native pixels; old leg-switch root shift={result["old_frame43_to44_root_shift_world_px"]}worldpx -> fixed root. {a.out}')
