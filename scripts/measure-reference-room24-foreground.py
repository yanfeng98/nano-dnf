#!/usr/bin/env python3
"""Check native close-layer placements and fit their camera motion in V2.

Input exact277..311s normalized frames every0.1s. Samples every0.5s retain
unaccepted observations; the same .94 texture and2px geometry gates apply.
"""
import argparse,json,hashlib,sys
from pathlib import Path
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,default=Path('/tmp/room24-foreground.json'));a=p.parse_args()
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'))
from import_dnf_scene import decode_at
proof=json.loads((root/'docs/reference-evidence/102-room24-foreground-source.json').read_text());images={};rows=[];cv2.setNumThreads(1)
for image in proof['images']:
 im,_=decode_at(a.client,'sprite_map.NPK',image['path'],image['frame']);assert hashlib.sha256(im.tobytes()).hexdigest()==image['rgbaSha256'];images[image['path']]=np.array(im.convert('RGBA'))
cameras=json.loads((root/'docs/reference-evidence/54-room24-camera.json').read_text())
for c in cameras[::5]:
 gray=cv2.imread(str(a.frames/f'{round((c["t"]-277)*10)+1:03d}.png'),0);assert gray is not None
 for index,o in enumerate(proof['items']):
  pic=cv2.resize(images[o['image']],None,fx=1.125,fy=1.125);h,w=pic.shape[:2]
  ex=o['left']*1.125-c['camera_px']*proof['scroll'];ey=92+o['top']*1.125
  if ex<6 or ex+w>714:continue
  hh=min(h,int(465-ey)-5)
  if hh<12:continue
  pic=pic[:hh];mask=(pic[:,:,3]>220).astype('uint8')*255
  if np.count_nonzero(mask)<100:continue
  left,top=round(ex)-4,round(ey)-4
  z=cv2.matchTemplate(gray[top:top+hh+9,left:left+w+9],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1)
  _,score,_,(dx,dy)=cv2.minMaxLoc(z)
  rows.append({'object':index,'native':o['native'][:2],'time':c['t'],'cameraPx':c['camera_px'],'score':score,'height':hh,'expected':[ex,ey],'measured':[left+dx,top+dy],'residual':[left+dx-ex,top+dy-ey],'accepted':score>=.94 and max(abs(left+dx-ex),abs(top+dy-ey))<=2})
coverage=[]
for i,o in enumerate(proof['items']):
 group=[r for r in rows if r['object']==i];good=[r for r in group if r['accepted']];coverage.append({'object':i,'native':o['native'],'animation':o['animation'],'accepted':len(good),'observed':len(group),'bestScore':max((r['score'] for r in group),default=None)})
# Unique highest canopy: the same physical tree is tracked across independent cameras.
track=[r for r in rows if r['native']==[656,440] and r['accepted']];assert len(track)>=3
matrix=np.array([[1,-r['cameraPx']] for r in track]);measured=np.array([r['measured'][0] for r in track]);coef=np.linalg.lstsq(matrix,measured,rcond=None)[0]
fit={'native':[656,440],'samples':len(track),'scroll':float(coef[1]),'intercept':float(coef[0]),'expectedIntercept':587*1.125,'rmsePx':float(np.sqrt(np.mean((matrix@coef-measured)**2)))}
assert abs(fit['scroll']-proof['scroll'])<.005
result={'source':'102-room24-foreground-source.json','screenScale':1.125,'screenYPhase':92,'mapNearScroll':proof['scroll'],'gate':{'texture':.94,'geometryPx':2},'coverage':coverage,'observations':rows,'independentCameraFit':fit,'limits':['Seven objects have accepted individual observations; eight others are clipped, overlapped, below the UI or insufficiently correlated in this method, not visually verified.','Native list order is preserved by the compositor; this measurement does not independently verify every overlap.','Additional unmatched foreground features are not inferred from this map.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('accepted',sum(r['accepted'] for r in rows),'objects',sum(c['accepted']>0 for c in coverage),'fit',fit)
