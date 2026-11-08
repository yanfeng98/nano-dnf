#!/usr/bin/env python3
"""Cross-check room33 camera motion with native caps, bunker walls and a gate strip.

Frames: V2 106..147.5s, every 15th raw 30fps frame, normalized to 720x540.
Caps/walls use local client atlases. The gate strip is evidence only, never game art.
"""
import argparse, json
from pathlib import Path
import cv2, numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/50-room33-camera.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano50/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
atlas=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'));cams=json.loads(a.camera.read_text());out=[]
for time in [106,107,113,117,125,129,133,145,146,147]:
 i=round((time-106)*2);gray=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);c=cams[i]
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
for time in [106,107,125,129,133,145]:
 i=round((time-106)*2);gray=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);c=cams[i];candidates=[]
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
atlas=np.array(Image.open('assets/goblin-bunker.png').convert('RGBA'))[:,:142];cams=json.loads(a.camera.read_text());out=[];z=265/168
native_mask=np.zeros(atlas.shape[:2],np.uint8);native_mask[80:115,15:60]=255;native_mask[atlas[:,:,3]<200]=0
for time,region in [(106,(500,250,720,475)),(133,(0,150,350,440))]:
 c=cams[round((time-106)*2)];im=cv2.imread(str(a.frames/f'{round((time-106)*2)+1:03d}.png'),0);x0,y0,x1,y1=region
 for sx in np.arange(.55,.851,.025):
  for sy in np.arange(.55,.851,.025):
   pic=cv2.resize(atlas,None,fx=sx*z,fy=sy*z);h,w=pic.shape[:2];t=cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY);m=cv2.resize(native_mask,(w,h),interpolation=cv2.INTER_NEAREST)
   if w>x1-x0:continue
   r=cv2.matchTemplate(im[y0:y1,x0:x1],t,cv2.TM_CCOEFF_NORMED,mask=m);r=np.nan_to_num(r,nan=-1,posinf=-1,neginf=-1);_,v,_,(x,y)=cv2.minMaxLoc(r);out.append(dict(time=time,scale=[round(float(sx),3),round(float(sy),3)],score=v,x=x+x0,y=y+y0,w=w,h=h,world=(x+x0+w/2+c['camera_px'])/z,bottom=y+y0+h+c['camera_y_px']))

bunkers=[max((q for q in out if q['time']==time),key=lambda q:q['score']) for time in [106,133]]
origin=cams[0]['camera_px'];ref=cv2.imread(str(a.frames/'001.png'),0)
template=ref[115:235,205:226];gate=[]
for i,camera in enumerate(cams):
 image=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0)
 scores=cv2.matchTemplate(image[90:300],template,cv2.TM_CCOEFF_NORMED)
 _,score,_,(x,y)=cv2.minMaxLoc(scores)
 if score<.75:continue
 observed=205-x;predicted=camera['camera_px']-origin
 gate.append({'time':camera['t'],'score':score,'relative_camera_px':observed,'predicted_px':predicted,'error_px':abs(observed-predicted)})
assert len(gate)>15 and max(q['error_px'] for q in gate)<3,'gate identity contradicts camera fit'
report={'pillars':pillars,'barrels':barrels,'bunkers':bunkers,'independent_gate_strip':gate,
 'width_lower_bound_world':(720+max(c['camera_px'] for c in cams)-min(c['camera_px'] for c in cams))/(265/168),
 'limits':'Native cap/wall identity and gate-strip motion, not exact room walls, initial unseen damage states, HP or bunker spawn/destruction rules. Origin is the minimum observed camera; vertical camera motion remains outside runtime calibration.'}
(a.out/'50-room33-layout-measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print('native pillar caps',len(pillars),'barrel caps',len(barrels),'bunkers',len(bunkers),'gate checks',len(gate))
