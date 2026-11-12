#!/usr/bin/env python3
"""Verify native left-gate poses, material controls and an unresolved leaf.

Use normalized exact277..311s frames at0.1s. Fixed visible patches avoid the
video message stack and the bottom HUD. No gate travel rule is inferred here.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,default=Path('/tmp/room24-west-gate.json'));a=p.parse_args()
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'))
from import_dnf_scene import decode_at
source=json.loads((root/'docs/reference-evidence/103-room24-west-gate-source.json').read_text());gate=source['gate'];cameras=json.loads((root/'docs/reference-evidence/54-room24-camera.json').read_text());cv2.setNumThreads(1)
parts={}
for name in ['frame','over','door']:
 info=source['animations'][name];im,off=decode_at(a.client,'sprite_map_pathgate.NPK',info['concreteImage'],0)
 if name=='over':im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
 parts[name]=cv2.resize(np.array(im.convert('RGBA')),None,fx=1.125,fy=1.125)
patches={'frame':[117,100,30,70],'over':[60,35,60,45],'door':[0,65,56,75]};rows=[];controls=[]
for c in cameras[:30]:
 raw=cv2.imread(str(a.frames/f'{round((c["t"]-277)*10)+1:03d}.png'));assert raw is not None;gray=cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY)
 for name,box in patches.items():
  x,y,w,h=box;tile=parts[name][y:y+h,x:x+w];mask=(tile[:,:,3]>220).astype('uint8')*255
  offset=gate['parts'][name]['offset'];leftBitmap=(gate['anchor'][0]+offset[0])*1.125-c['camera_px'];topBitmap=92+(gate['anchor'][1]+offset[1])*1.125
  ex=leftBitmap+x;ey=topBitmap+y
  if ex<0 or ex+w+4>720 or ey+h+4>465:continue
  left=max(0,round(ex)-4);top=round(ey)-4
  z=cv2.matchTemplate(gray[top:top+h+9,left:left+w+9],cv2.cvtColor(tile[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(dx,dy)=cv2.minMaxLoc(z)
  dst=cv2.cvtColor(raw[top+dy:top+dy+h,left+dx:left+dx+w],cv2.COLOR_BGR2RGB);pixels=mask>0;rgb=tile[:,:,:3][pixels].astype(float);target=dst[pixels].astype(float)
  row={'part':name,'time':c['t'],'cameraPx':c['camera_px'],'patch':box,'score':score,'rgbRmse':float(np.sqrt(np.mean((rgb-target)**2))),'bitmapExpected':[leftBitmap,topBitmap],'bitmapMeasured':[left+dx-x,top+dy-y],'residual':[left+dx-ex,top+dy-ey],'accepted':score>=.94 and max(abs(left+dx-ex),abs(top+dy-ey))<=2};rows.append(row)
  if name=='over':
   for material in [1,2,3,4,5]:
    im,_=decode_at(a.client,'sprite_map_pathgate.NPK',f'sprite/map/pathgate/granflorisbush{material:02d}.img',0);pic=cv2.resize(np.array(im.convert('RGBA'))[:,::-1],None,fx=1.125,fy=1.125)[y:y+h,x:x+w]
    q=pic[:,:,:3][pixels].astype(float);controls.append({'time':c['t'],'material':material,'rgbRmseAtSamePose':float(np.sqrt(np.mean((q-target)**2)))})
track=[r for r in rows if r['part']=='frame' and r['accepted']];fit=None
if len(track)>=3:
 matrix=np.array([[1,-r['cameraPx']] for r in track]);obs=np.array([r['bitmapMeasured'][0] for r in track]);coef=np.linalg.lstsq(matrix,obs,rcond=None)[0];fit={'samples':len(track),'cameraSpanPx':max(r['cameraPx'] for r in track)-min(r['cameraPx'] for r in track),'intercept':float(coef[0]),'scroll':float(coef[1]),'rmsePx':float(np.sqrt(np.mean((matrix@coef-obs)**2)))}
coverage={name:{'observed':sum(r['part']==name for r in rows),'accepted':sum(r['part']==name and r['accepted'] for r in rows)} for name in patches}
assert coverage['frame']['accepted']>=2 and coverage['over']['accepted']>=2
result={'source':'103-room24-west-gate-source.json','screenScale':1.125,'screenYPhase':92,'gate':{'texture':.94,'geometryPx':2},'coverage':coverage,'observations':rows,'materialControlsAtIdenticalPose':controls,'frameCameraFit':fit,'limits':['Grayscale leaf texture alone cannot discriminate the green material variants;02 is selected using the object material data, with colour controls retained.','Video text, actors and partial clipping prevent full-gate image verification.','The door image observation is retained as a state discrepancy: entry exitMode is currently open; video bars do not prove passability on their own.','This does not establish native open/fade/light timing.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(coverage,'fit',fit)
