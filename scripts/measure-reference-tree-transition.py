#!/usr/bin/env python3
"""Identify fruit pixels across exact 317..321s tenth-second reference frames.

Use a 61x100 left-crown strip: the score overlay covers the lower-right scene.
Discard low-correlation transition frames. This bounds visual change only;
it does not establish effective-hit count, HP, drops or an exact trigger time.
"""
import argparse,sys,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'assets'))
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();forms={}
for name,pack,entry in [('plain','sprite_map.NPK','sprite/map/03obj300.img'),('fruit','sprite_map_breakableobject_actiontreerenew.NPK','sprite/map/breakableobject/actiontreerenew/actiontree1-sunderland.img')]:
 src=np.array(decode_at(a.client,pack,entry,0)[0]);forms[name]=cv2.resize(src,None,fx=.71*265/168,fy=.71*265/168)[:100,:61]
f=forms['fruit'];plain=forms['plain'];fruit_rgb=f[:,:,:3].astype(int);plain_rgb=plain[:,:,:3].astype(int)
berry=(fruit_rgb[:,:,0]-fruit_rgb[:,:,1]>15)&(fruit_rgb[:,:,0]-fruit_rgb[:,:,2]>15)&(fruit_rgb[:,:,0]>40)&(f[:,:,3]>220)&(plain[:,:,3]>220)&(np.max(abs(fruit_rgb-plain_rgb),axis=2)>20)
files=sorted(a.frames.glob('*.png'));assert len(files)==41
rows=[]
for i,file in enumerate(files):
 gray=cv2.imread(str(file),0);rgb=np.array(Image.open(file).convert('RGB'));best=None
 for name,pic in forms.items():
  mask=(pic[:,:,3]>180).astype(np.uint8)*255
  scores=cv2.matchTemplate(gray[200:340],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
  _,value,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1))
  if best is None or value>best['score']:best=dict(time=round(317+i*.1,1),score=value,template=name,xy=[x,y+200])
 x,y=best['xy'];region=rgb[y:y+100,x:x+61].astype(int)
 red=float(np.median(region[berry,0]-region[berry,1]));best['berry_red_minus_green']=red
 best['qualified']=best['score']>.8;best['state']='fruit' if red>20 else 'plain' if red<0 else 'unknown'
 rows.append(best)
fruit=[r for r in rows if r['qualified'] and r['state']=='fruit'];bare=[r for r in rows if r['qualified'] and r['state']=='plain']
assert len(fruit)>=5 and len(bare)>=20 and rows[0]['state']=='fruit'
report={'berry_pixels':int(berry.sum()),'last_clear_fruit':max(r['time']for r in fruit),'first_clear_plain':min(r['time']for r in bare),'samples':rows,'limits':'Visual transition bound only; low-correlation frames are occluded or shaking, so no exact trigger/HP/drop inference.'}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
print(report['berry_pixels'],report['last_clear_fruit'],report['first_clear_plain'])
