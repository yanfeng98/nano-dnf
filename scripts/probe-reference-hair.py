#!/usr/bin/env python3
"""Audit hair candidates in fixed head regions; output is not an asset selection.

Fixed ROI includes uncovered reference pixels, unlike candidate-alpha-only
ranking. Uses local client art and reference frames supplied via --references.
"""
import argparse,io,json,re
from pathlib import Path
import numpy as np
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--references',type=Path,required=True)
p.add_argument('--out',type=Path,default=Path('/tmp/nano-hair-probe.json'));a=p.parse_args()
poses={42:(416,420,(222,243,248,269)),46:(416,420,(284,232,312,258))};refs={i:np.array(Image.open(a.references/f'reference-{i}.png').convert('RGB')) for i in poses}
rows=[]
with (a.client/'ImagePacks2_70/sprite_character_swordman_equipment_avatar_hair.NPK').open('rb') as f:
 for e in NPK.open(f).files:
  name=e.name.rsplit('/',1)[-1]
  if not re.fullmatch(r'sm_hair\d+a.img',name):continue
  obj=IMGFactory.open(io.BytesIO(e.data));scores={}
  for index,(rx,ry,box) in poses.items():
   if index>=len(obj.images):break
   fr=obj.images[index]
   while type(fr).__name__=='ImageLink':fr=obj.images[fr.index]
   canvas=Image.new('RGBA',(500,500));canvas.alpha_composite(obj.build(fr).convert('RGBA'),(fr.x,fr.y))
   part=canvas.crop(box);part=part.resize((round(part.width*1.125),round(part.height*1.125)),Image.Resampling.BILINEAR)
   src=np.asarray(part).astype(float);alpha=src[:,:,3:]/255;h,w=src.shape[:2];best=1e12
   x=round(rx+(box[0]-232)*1.125);y=round(ry+(box[1]-333)*1.125)
   for dy in range(-4,5):
    for dx in range(-4,5):
     ref=refs[index][y+dy:y+dy+h,x+dx:x+dx+w].astype(float)
     border=np.concatenate([ref[:2].reshape(-1,3),ref[-2:].reshape(-1,3),ref[:,:2].reshape(-1,3),ref[:,-2:].reshape(-1,3)])
     bg=np.median(border,axis=0);pred=src[:,:,:3]*alpha+bg*(1-alpha)
     best=min(best,float(np.mean((pred-ref)**2)))
   scores[str(index)]=best
  if len(scores)==len(poses):rows.append({'entry':name,'scores':scores,'mean':sum(scores.values())/len(scores)})
rows.sort(key=lambda r:r['mean']);a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps({'limits':'Approximate local background; no face/skin layer and no independent held-out validation. Do not deploy the winner automatically.','ranking':rows},indent=2)+'\n')
print([(r['entry'],round(r['mean'],2)) for r in rows[:8]])
