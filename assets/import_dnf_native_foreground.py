#!/usr/bin/env python3
"""Compose room24's authored close layer from local client pixels only."""
import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from client_pvf import PvfArchive
from client_animation import parse_animation
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=ROOT/'assets/deep-room24-foreground.png')
p.add_argument('--proof',type=Path,default=ROOT/'docs/reference-evidence/102-room24-foreground-source.json')
a=p.parse_args();source='map/mirkwooddeep/n410(3,0).map';items=[];images={};animations={}
with PvfArchive(a.client/'Script.pvf') as pvf:
 values=[v for _,v in pvf.tokens(source)];start=values.index('[animation]')+1;end=values.index('[/animation]');assert (end-start)%5==0
 scroll=values[values.index('[near sight scroll]')+1]/100
 for i in range(start,end,5):
  name,layer,x,y,z=values[i:i+5]
  if layer!='[close]':continue
  assert z==0
  entry='map/mirkwooddeep/'+name.lower();raw=pvf.read(entry);ani=parse_animation(raw,include_image=True)
  assert len(ani['frames'])==1 and ani['overall']==[(1,0)]
  f=ani['frames'][0];assert not f['boxes'] and all(t==12 for t,_ in f['props'])
  imagePath='sprite/'+ani['paths'][f['image']].lower();key=(imagePath,f['frame'])
  if key not in images:images[key]=decode_at(a.client,'sprite_map.NPK',*key)
  image,offset=images[key]
  items.append({'animation':name,'native':[x,y,z],'image':imagePath,'frame':f['frame'],'aniXY':f['xy'],'imageOffset':list(offset),'size':list(image.size),'left':x+f['xy'][0]+offset[0],'top':y+f['xy'][1]+offset[1]})
  animations[name]={'entry':entry,'sha256':hashlib.sha256(raw).hexdigest(),'data':ani}
 proof={'map':source,'mapSha256':hashlib.sha256(pvf.read(source)).hexdigest(),'scroll':scroll,'animations':animations}
assert len(items)==15 and len(images)==3 and scroll==1.1
originY=250;width=max(7*224,max(i['left']+i['size'][0] for i in items));height=max(i['top']+i['size'][1] for i in items)-originY
canvas=Image.new('RGBA',(width,height))
for item in items:canvas.alpha_composite(images[(item['image'],item['frame'])][0],(item['left'],item['top']-originY))
a.out.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.out)
proof.update(items=items,nativeXOrigin=0,nativeYOrigin=originY,screenY=92+originY*1.125,screenScale=1.125,order='original close-layer list',size=list(canvas.size),rgbaSha256=hashlib.sha256(canvas.tobytes()).hexdigest(),images=[{'path':name,'frame':frame,'size':list(im.size),'offset':list(offset),'rgbaSha256':hashlib.sha256(im.tobytes()).hexdigest()} for (name,frame),(im,offset) in images.items()],limits=['Only seven objects have high-score individual video matches in the initial measurement; remaining objects are not claimed as visually verified.','This exports only the map close layer. Additional unmatched foreground features and other layers remain open.','No collision is inferred from these render-only map records.'])
a.proof.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');print('foreground items',len(items),'images',len(images),'size',canvas.size,'scroll',scroll)
