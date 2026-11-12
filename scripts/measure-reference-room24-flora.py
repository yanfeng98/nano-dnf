#!/usr/bin/env python3
"""Check authored room24 decorations against independent V2 camera measurements.

Input exact277..311s frames every0.1s. The best of four native images is an
identity check only; it does not establish animation phase or a clock model.
"""
import argparse,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,default=Path('/tmp/nano101-flora-measurement.json'));a=p.parse_args()
root=Path(__file__).resolve().parents[1];proof=json.loads((root/'docs/reference-evidence/101-room24-flora-source.json').read_text());atlas=np.array(Image.open(root/'assets/native-flora.png').convert('RGBA'));cams=json.loads((root/'docs/reference-evidence/54-room24-camera.json').read_text());rows=[];cv2.setNumThreads(1)
for i,c in enumerate(cams,1):
 gray=cv2.imread(str(a.frames/f'{i:03d}.png'),0);assert gray is not None
 for entry in proof['entries']:
  n=entry['nativeDecoration'];candidates=[]
  for frameIndex,f in enumerate(n['frames']):
   x,y,w,h=f['rect'];pic=cv2.resize(atlas[y:y+h,x:x+w],None,fx=1.125,fy=1.125)
   ex=(n['x']+f['offset'][0])*1.125-c['camera_px'];ey=92+(n['y']+f['offset'][1])*1.125
   hh,ww=pic.shape[:2];hh=min(hh,int(465-ey)-5)
   if ex<6 or ex+ww>714 or ey<6 or hh<15:continue
   mask=(pic[:hh,:,3]>220).astype('uint8')*255
   if np.count_nonzero(mask)<80:continue
   left,top=round(ex)-4,round(ey)-4
   z=cv2.matchTemplate(gray[top:top+hh+9,left:left+ww+9],cv2.cvtColor(pic[:hh,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
   z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(dx,dy)=cv2.minMaxLoc(z)
   candidates.append({'frameIndex':frameIndex,'score':score,'expectedTopLeft':[ex,ey],'measuredTopLeft':[left+dx,top+dy],'residual':[left+dx-ex,top+dy-ey],'height':hh})
  if not candidates:continue
  best=max(candidates,key=lambda r:r['score']);best.update(time=c['t'],native=[n['x'],n['y']],layer=n['layer'],accepted=best['score']>=.94 and max(map(abs,best['residual']))<=2);rows.append(best)
r={'source':'101-room24-flora-source.json','gate':{'score':.94,'positionResidualPx':2},'observations':rows,'limits':['Image identity and geometric alignment only; animation initial phase and timing across revisits remain unproved.','Rejected observations are retained, including occlusion and compression uncertainty.']};r['coverage']=[]
for e in proof['entries']:
 n=e['nativeDecoration'];group=[q for q in rows if q['native']==[n['x'],n['y']]];good=[q for q in group if q['accepted']];r['coverage'].append({'native':[n['x'],n['y']],'accepted':len(good),'observed':len(group),'bestScore':max((q['score'] for q in group),default=None)});print(n['x'],n['y'],len(good),max((q['score'] for q in good),default=None))

a.out.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
