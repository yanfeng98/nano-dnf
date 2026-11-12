#!/usr/bin/env python3
"""Export native room24 normal/bottom decorations with ANI/IMG offsets.

The runtime atlas contains only local client pixels. Map placements, layers,
frame image indices and delays are exported without guessing a foliage layout.
"""
import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from client_pvf import PvfArchive
from client_animation import parse_animation
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=ROOT/'assets/native-flora.png')
p.add_argument('--proof',type=Path,default=ROOT/'docs/reference-evidence/101-room24-flora-source.json')
p.add_argument('--entries',type=Path,default=Path('/tmp/nano101-native-flora-entries.json'))
a=p.parse_args();source='map/mirkwooddeep/n410(3,0).map';images={};animations={};entries=[]
with PvfArchive(a.client/'Script.pvf') as pvf:
 values=[v for _,v in pvf.tokens(source)]
 start=values.index('[animation]')+1;end=values.index('[/animation]');assert (end-start)%5==0
 for i in range(start,end,5):
  name,layer,x,y,z=values[i:i+5]
  if layer not in ['[normal]','[bottom]']:continue
  assert z==0
  path='map/mirkwooddeep/'+name.lower();raw=pvf.read(path)
  ani=parse_animation(raw,include_image=True)
  assert all(t in [0,1] for t,_ in ani['overall'])
  frames=[]
  for f in ani['frames']:
   assert not f['boxes'] and all(t==12 for t,_ in f['props'])
   imagePath='sprite/'+ani['paths'][f['image']].lower();key=(imagePath,f['frame'])
   if key not in images:
    image,offset=decode_at(a.client,'sprite_map.NPK',*key)
    assert image.width<=128 and image.height<=80
    images[key]=(image,offset,len(images)*128)
   image,offset,atlasX=images[key]
   frames.append({'rect':[atlasX,0,image.width,image.height],
                  'offset':[f['xy'][0]+offset[0],f['xy'][1]+offset[1]],
                  'delay':dict(f['props'])[12]})
  entries.append({'piece':'nativeFlora','nativeDecoration':{'x':x,'y':y,'layer':layer,'frames':frames}})
  animations[name]={'entry':path,'sha256':hashlib.sha256(raw).hexdigest(),'animation':ani}
 proof={'map':source,'mapSha256':hashlib.sha256(pvf.read(source)).hexdigest(),'animations':animations}
assert len(entries)==10 and len(images)==8
atlas=Image.new('RGBA',(len(images)*128,80));sourceImages=[]
for (name,frame),(im,offset,x) in images.items():
 atlas.alpha_composite(im,(x,0))
 sourceImages.append({'path':name,'frame':frame,'offset':offset,'size':list(im.size),'rect':[x,0,im.width,im.height],'rgbaSha256':hashlib.sha256(im.tobytes()).hexdigest()})
a.out.parent.mkdir(parents=True,exist_ok=True);atlas.save(a.out)
proof.update(entries=entries,images=sourceImages,atlasSize=list(atlas.size),atlasRgbaSha256=hashlib.sha256(atlas.tobytes()).hexdigest(),limits=['Foreground close-layer trees remain outside this export.','Native initial animation phase and phase across revisits require separate video evidence.'])
a.proof.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');a.entries.write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
print('native decorations',len(entries),'atlas images',len(images))
