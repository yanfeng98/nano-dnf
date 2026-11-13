#!/usr/bin/env python3
"""Retain rejected whole-panel integer sampling controls; no skin identification claim."""
import argparse
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--frames",type=Path,required=True);args=parser.parse_args()
from PIL import Image
import cv2,numpy as np,json
cv2.setNumThreads(1)
a=Image.open('assets/minimap.png').convert('RGBA'); pieces={'tl':[190,18,5,5],'top':[199,18,18,5],'tr':[221,18,4,5],'left':[229,18,5,18],'right':[260,18,4,18],'bl':[268,18,5,4],'bottom':[277,18,18,4],'br':[299,18,4,4]}
def panel(cols,rows,th):
 w=cols*18+9;h=rows*18+th+9;p=Image.new('RGBA',(w,h)); dest={'tl':(0,0,5,5),'tr':(w-4,0,4,5),'bl':(0,h-4,5,4),'br':(w-4,h-4,4,4),'top':(5,0,w-9,5),'bottom':(5,h-4,w-9,4),'left':(0,5,5,h-9),'right':(w-4,5,4,h-9)}
 for k,(x,y,ww,hh)in dest.items():
  sx,sy,sw,sh=pieces[k]; im=a.crop((sx,sy,sx+sw,sy+sh)).resize((ww,hh),Image.Resampling.BILINEAR);p.paste(im,(x,y))
 return np.array(p)
out=[]
for v,t,c,r in [('00001',100,4,3),('00002',277,5,4)]:
 raw=cv2.imread(str(args.frames/f'{v}-{t}.png'),0)
 for scale in [1,1.125,1.25]:
  cand=[]
  for th in range(14,23):
   base=panel(c,r,th);h,w=base.shape[:2]; pic=cv2.resize(base,(round(w*scale),round(h*scale)));mask=(pic[:,:,3]>220).astype('uint8')*255
   z=cv2.matchTemplate(raw[:155,570:],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,s,_,(dx,dy)=cv2.minMaxLoc(z);cand.append({'scale':scale,'title':th,'score':s,'box':[570+dx,dy,pic.shape[1],pic.shape[0]],'pixels':int(np.count_nonzero(mask))})
  out.append({'video':v,'scale':scale,'best':sorted(cand,key=lambda x:-x['score'])[:3]})
print(json.dumps(out,indent=2))
