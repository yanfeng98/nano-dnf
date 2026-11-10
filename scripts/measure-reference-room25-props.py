#!/usr/bin/env python3
"""Measure room25 native props. Exact 312..385s half-second frames, 720x540.
Only visible cap/wall regions identify assets; this does not prove lifecycle.
"""
import argparse,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cams=json.load(open('docs/reference-evidence/55-room25-camera.json'));atlas=np.array(Image.open('assets/forest.png').convert('RGBA'));b=np.array(Image.open('assets/goblin-bunker.png').convert('RGBA'))[:,:142];z=265/168;rows=[]
for kind,src,cutoff,minimum in [('barrel',atlas[1874:1952,560:623],22,.9),('chest',atlas[1874:1930,623:709],22,.88),('goblinBunker',b,999,.85)]:
 for t in [314,315,316,317,318,319,320,322,330,345,375]:
  i=round((t-312)*2);im=cv2.imread(str(a.frames/f'{i+1:04d}.png'),0);cam=cams[i];candidates=[]
  for sx in np.arange(.60,.801,.025):
   for sy in np.arange(.60,.801,.025):
    pic=cv2.resize(src,None,fx=sx*z,fy=sy*z);h,w=pic.shape[:2];used=min(h,cutoff);mask=(pic[:used,:,3]>180).astype(np.uint8)*255
    if kind=='goblinBunker':
     mask[:]=0;mask[round(h*88/138):round(h*127/138),round(w*17/142):round(w*68/142)]=(pic[round(h*88/138):round(h*127/138),round(w*17/142):round(w*68/142),3]>180).astype(np.uint8)*255
    tem=cv2.cvtColor(pic[:used,:,:3],cv2.COLOR_RGB2GRAY)
    scores=cv2.matchTemplate(im[150:480],tem,cv2.TM_CCOEFF_NORMED,mask=mask);scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
    for _ in range(4):
     _,v,_,(x,y)=cv2.minMaxLoc(scores)
     if v<minimum:break
     candidates.append(dict(kind=kind,time=t,scale=[round(float(sx),3),round(float(sy),3)],score=v,xy=[x,y+150],size=[w,h],world=(x+w/2+cam['camera_px'])/z,bottom=y+150+h+cam['camera_y_px']))
     scores[max(0,y-35):y+35,max(0,x-35):x+35]=-1
  chosen=[]
  for q in sorted(candidates,key=lambda q:-q['score']):
   if any(abs(q['xy'][0]-o['xy'][0])<40 and abs(q['xy'][1]-o['xy'][1])<40 for o in chosen):continue
   chosen.append(q)
  rows+=chosen
(a.out/'56-room25-props-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')
for r in rows:print(r)

# Fine wall fits and deliberately retained low-score partial chest candidates.
rows=[]
for kind,t,src,region,maskbox in [('back-bunker',314,b,(500,180,720,450),(17,88,68,127)),('front-bunker',318,b,(0,290,240,480),(17,88,68,127)),('third-chest',318,atlas[1874:1930,623:709],(300,230,470,330),(0,0,24,28)),('third-chest',319,atlas[1874:1930,623:709],(170,230,360,330),(0,0,24,28))]:
 im=cv2.imread(str(a.frames/f'{round((t-312)*2)+1:04d}.png'),0);cam=cams[round((t-312)*2)];x0,y0,x1,y1=region;best={'score':-1}
 for sx in np.arange(.63,.751,.005):
  for sy in np.arange(.67,.751,.005):
   pic=cv2.resize(src,None,fx=sx*z,fy=sy*z);h,w=pic.shape[:2]
   if h>y1-y0 or w>x1-x0:continue
   mask=(pic[:,:,3]>180).astype(np.uint8)*255;xx,yy,xx1,yy1=maskbox
   rect=np.zeros_like(mask);rect[round(yy*h/src.shape[0]):round(yy1*h/src.shape[0]),round(xx*w/src.shape[1]):round(xx1*w/src.shape[1])]=255;mask&=rect
   scores=cv2.matchTemplate(im[y0:y1,x0:x1],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1);_,v,_,(x,y)=cv2.minMaxLoc(scores)
   if v>best['score']:best=dict(kind=kind,time=t,score=v,scale=[round(float(sx),3),round(float(sy),3)],xy=[x+x0,y+y0],size=[w,h],world=(x+x0+w/2+cam['camera_px'])/z,bottom=y+y0+h+cam['camera_y_px'])
 rows.append(best);print(best,flush=True)
(a.out/'56-room25-partial-fit.json').write_text(json.dumps(rows,indent=2)+'\n')

# A fruit tree hides the third chest. Reuse independently fitted chest dimensions
# and match only its visible left cap; do not infer scale from the tiny fragment.
c=cams[14];src=atlas[1874:1930,623:709]
pic=cv2.resize(src,None,fx=.7*z,fy=.725*z);h,w=pic.shape[:2]
mask=np.zeros((h,w),np.uint8);mask[:31,:26]=(pic[:31,:26,3]>180)*255
im=cv2.imread(str(a.frames/'0015.png'),0)
scores=cv2.matchTemplate(im[230:330,170:360],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
_,value,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1))
assert value>.93
report=dict(time=319,score=value,scale=[.7,.725],xy=[x+170,y+230],size=[w,h],world=(x+170+w/2+c['camera_px'])/z,bottom=y+230+h+c['camera_y_px'],mask=[0,0,26,31],limits='Partial cap only; scale borrowed from two unobscured same-native chests, lower edge obscured. No initial-state/lifecycle inference.')
(a.out/'56-room25-third-chest.json').write_text(json.dumps(report,indent=2)+'\n')
