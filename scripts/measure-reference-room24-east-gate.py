#!/usr/bin/env python3
"""Measure the native room24 boss-side east gate against exact277..311s frames.

All patches are fixed in the full-size resized native image. Rejected and
occluded observations are retained; this does not infer travel or fade rules.
"""
import argparse,json,sys
from pathlib import Path
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'))
from import_dnf_scene import decode_at
cv2.setNumThreads(1)
proof=json.loads((root/'docs/reference-evidence/104-room24-east-gate-source.json').read_text());gate=proof['gate']
cameras=json.loads((root/'docs/reference-evidence/54-room24-camera.json').read_text())
patches={'frame':[100,120,30,70],'under':[25,240,70,80],'over':[40,95,35,45],'door':[0,65,56,75]};parts={};rows=[]
for name in patches:
 im,_=decode_at(a.client,'sprite_map_pathgate.NPK',proof['animations'][name]['concreteImage'],0)
 parts[name]=cv2.resize(np.array(im.convert('RGBA')),None,fx=1.125,fy=1.125)
for c in cameras:
 for name,(x,y,w,h) in patches.items():
  off=gate['parts'][name]['offset'];ex=(gate['anchor'][0]+off[0])*1.125-c['camera_px']+x;ey=92+(gate['anchor'][1]+off[1])*1.125+y
  if ex<4 or ex+w+5>720 or ey<4 or ey+h+5>465:continue
  tile=parts[name][y:y+h,x:x+w];mask=(tile[:,:,3]>220).astype('uint8')*255
  if np.count_nonzero(mask)<100:continue
  raw=cv2.imread(str(a.frames/f'{round((c["t"]-277)*10)+1:03d}.png'));assert raw is not None
  gray=cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY);left=round(ex)-4;top=round(ey)-4
  z=cv2.matchTemplate(gray[top:top+h+9,left:left+w+9],cv2.cvtColor(tile[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
  z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(dx,dy)=cv2.minMaxLoc(z)
  residual=[left+dx-ex,top+dy-ey];target=cv2.cvtColor(raw[top+dy:top+dy+h,left+dx:left+dx+w],cv2.COLOR_BGR2RGB)[mask>0].astype(float)
  rows.append({'part':name,'time':c['t'],'cameraPx':c['camera_px'],'patch':[x,y,w,h],'score':score,'pixels':int(np.count_nonzero(mask)),'rgbRmse':float(np.sqrt(np.mean((tile[:,:,:3][mask>0].astype(float)-target)**2))),'expectedPatch':[ex,ey],'measuredPatch':[left+dx,top+dy],'residual':residual,'accepted':score>=.94 and max(abs(v) for v in residual)<=2})
coverage={n:{'observed':sum(r['part']==n for r in rows),'accepted':sum(r['part']==n and r['accepted'] for r in rows)} for n in patches}
track=[r for r in rows if r['part']=='under' and r['accepted']];matrix=np.array([[1,-r['cameraPx']] for r in track]);obs=np.array([r['measuredPatch'][0]-patches['under'][0] for r in track]);coef=np.linalg.lstsq(matrix,obs,rcond=None)[0]
fit={'samples':len(track),'cameraSpanPx':max(r['cameraPx'] for r in track)-min(r['cameraPx'] for r in track),'intercept':float(coef[0]),'scroll':float(coef[1]),'rmsePx':float(np.sqrt(np.mean((matrix@coef-obs)**2)))}
assert coverage['frame']['accepted']>=5 and coverage['under']['accepted']>=5 and coverage['door']['accepted']>=1
result={'source':'104-room24-east-gate-source.json','screenScale':1.125,'screenYPhase':92,'gate':{'texture':.94,'geometryPx':2},'coverage':coverage,'observations':rows,'underTreeCameraFit':fit,'limits':['Boss neighbour selects native375 object;06 frame/door,02 vegetation and red02 light are retained.','Video UI, text, actors, effects and clipping cause rejected observations, all retained.','Native bottom layer comes from the object; these texture matches do not independently prove every occlusion relationship.','Static pose only: native leaf transitions, light/fade clock, passability and tile collision semantics remain unverified.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(coverage,fit)
