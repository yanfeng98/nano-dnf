#!/usr/bin/env python3
"""Cross-check room13 camera motion with native pillar/barrel caps.

Frames: V2 190..235.5 and 266.5..271.5s, every 15th raw 30fps frame, normalized to 720x540.
Caps use local client atlases. Source frames remain evidence only, never game art.
"""
import argparse, json
from pathlib import Path
import cv2, numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/52-room13-camera.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano52/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
atlas=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'));cams=json.loads(a.camera.read_text());out=[]
for time in [190,192,200,210,220,230,235.5,266.5,268,270,271.5]:
 i=next(i for i,c in enumerate(cams) if c["t"]==time);gray=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);c=cams[i]
 for kind,x,h in [('flat',0,133),('damaged',44,111)]:
  pic=cv2.resize(atlas[:h,x:x+44],None,fx=.706*265/168,fy=.715*265/168);height,w=pic.shape[:2];top=pic[:30];t=cv2.cvtColor(top[:,:,:3],cv2.COLOR_RGB2GRAY);m=(top[:,:,3]>200).astype(np.uint8)*255
  score=cv2.matchTemplate(gray[110:470],t,cv2.TM_CCOEFF_NORMED,mask=m);score=np.nan_to_num(score,nan=-1,posinf=-1,neginf=-1)
  for _ in range(20):
   _,v,_,(xx,yy)=cv2.minMaxLoc(score)
   if v<.88:break
   out.append(dict(time=time,kind=kind,score=v,x=xx,y=yy+110,w=w,h=height,world=(xx+w/2+c['camera_px'])/(265/168),bottom=yy+110+height+c['camera_y_px']))
   score[max(0,yy-20):yy+20,max(0,xx-22):xx+22]=-1
pillars=out
atlas=np.array(Image.open('assets/forest.png').convert('RGBA'))[1874:1952,560:623];cams=json.loads(a.camera.read_text());out=[];zoom=265/168
for time in [c['t'] for c in cams]:
 i=next(i for i,c in enumerate(cams) if c["t"]==time);gray=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);c=cams[i];candidates=[]
 for scale in np.arange(.65,.801,.025):
  pic=cv2.resize(atlas,None,fx=scale*zoom,fy=scale*zoom);h,w=pic.shape[:2];top=pic[:24];template=cv2.cvtColor(top[:,:,:3],cv2.COLOR_RGB2GRAY);mask=(top[:,:,3]>180).astype(np.uint8)*255
  score=cv2.matchTemplate(gray[180:475],template,cv2.TM_CCOEFF_NORMED,mask=mask);score=np.nan_to_num(score,nan=-1,posinf=-1,neginf=-1)
  for _ in range(12):
   _,v,_,(x,y)=cv2.minMaxLoc(score)
   if v<.9:break
   candidates.append(dict(time=time,scale=round(float(scale),3),score=v,x=x,y=y+180,w=w,h=h,world=(x+w/2+c['camera_px'])/zoom,bottom=y+180+h+c['camera_y_px']))
   score[max(0,y-20):y+20,max(0,x-25):x+25]=-1
 chosen=[]
 for q in sorted(candidates,key=lambda q:-q['score']):
  if any(abs(q['x']-o['x'])<40 and abs(q['y']-o['y'])<30 for o in chosen):continue
  chosen.append(q)
 out+=chosen
barrels=out


cross_visit=[]
for center in [242,270,613,641,670,772,804,943,970,997]:
 first=[q['world'] for q in pillars if q['kind']=='flat' and q['time']<236 and abs(q['world']-center)<4]
 revisit=[q['world'] for q in pillars if q['kind']=='flat' and q['time']>=266 and abs(q['world']-center)<4]
 if first and revisit:
  error=abs(float(np.median(first))-float(np.median(revisit)))
  cross_visit.append({'group_center_world':center,'first_median':float(np.median(first)),'return_median':float(np.median(revisit)),'error_world':error})
assert len(cross_visit)>=8 and max(q['error_world'] for q in cross_visit)<1,'return pillars contradict the combined camera path'
report={'cross_visit_flat_pillars':cross_visit,'pillars':pillars,'barrels':barrels,'width_lower_bound_world':(720+max(c['camera_px'] for c in cams)-min(c['camera_px'] for c in cams))/(265/168),'limits':'Native cap positions only. Unseen initial damage, absolute wall offsets, enemy states and damage rules remain unverified.'}
(a.out/'52-room13-layout-measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print('pillar observations',len(pillars),'barrel observations',len(barrels))
