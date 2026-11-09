#!/usr/bin/env python3
"""Check dense room24 camera motion with independently matched gate textures.

Input: exact raw 30fps samples every 3 frames, 277..311s, 720x540.
Gate patches are evidence only; no reference pixels enter game assets.
"""
import argparse,json
from pathlib import Path
import cv2
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/54-room24-camera.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano54/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cameras=json.loads(a.camera.read_text());files=sorted(a.frames.glob('*.png'))
assert len(files)==len(cameras)
checks={}
for name,time,x,y,w,h in [('west',277.5,78,230,20,100),('east',307,676,230,20,80)]:
 index=next(i for i,c in enumerate(cameras)if c['t']==time)
 reference=cv2.imread(str(files[index]),0)[y:y+h,x:x+w];rows=[]
 for i,file in enumerate(files):
  predicted=cameras[i]['camera_px']-cameras[index]['camera_px']
  # Identical door ornaments occur at both ends: only test this identity while
  # its expected position is visible, still finding the best match globally.
  if not 0<=x-predicted<=720-w:continue
  scores=cv2.matchTemplate(cv2.imread(str(file),0)[150:350],reference,cv2.TM_CCOEFF_NORMED)
  _,score,_,(actual,top)=cv2.minMaxLoc(scores)
  if score<.85:continue
  rows.append({'time':cameras[i]['t'],'score':score,'observed_delta':x-actual,'predicted_delta':predicted,'error_px':abs(x-actual-predicted)})
 assert len(rows)>10 and max(r['error_px']for r in rows)<1,name+' gate contradicts camera'
 checks[name]=rows
report={'gate_checks':checks,'width_lower_bound_world':(720+max(c['camera_px']for c in cameras)-min(c['camera_px']for c in cameras))*168/265,
 'limits':'Camera span and gate texture identity only. Foreground tree identity, position, damage, enemies and exact wall offsets remain unverified.'}
(a.out/'54-room24-gate-measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print({k:len(v)for k,v in checks.items()},report['width_lower_bound_world'])
