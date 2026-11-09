#!/usr/bin/env python3
"""Independently verify room25 camera with static foreground texture identities.

Input: exact 30fps raw frames 312..385s selected every15 frames, normalized
crop=1440:1080:240:0,scale=720:540. Patches are evidence, never game assets.
A single chest or rear bunker repeats: use both chests and the front bunker
rather than accepting whichever identical object gives the highest score.
"""
import argparse,json
from pathlib import Path
import cv2
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/55-room25-camera.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano55/texture-measurement.json'))
a=p.parse_args();cs=json.loads(a.camera.read_text());fs=sorted(a.frames.glob('*.png'))
assert len(fs)==len(cs)==147 and cs[0]['t']==312 and cs[-1]['t']==385
checks={}
for name,t,x,y,w,h,minimum in [('west-gate',312,6,243,38,90,3),('entry-stump',312,470,325,56,80,7),('front-bunker',316,480,390,70,52,6),('paired-chests',330,194,251,192,60,20),('barrel-rim',330,401,234,55,30,40)]:
 idx=next(i for i,c in enumerate(cs)if c['t']==t)
 patch=cv2.imread(str(fs[idx]),0)[y:y+h,x:x+w];rows=[]
 for i,f in enumerate(fs):
  delta=cs[i]['camera_px']-cs[idx]['camera_px'];pred=x-delta
  if not 0<=pred<=720-w:continue
  scores=cv2.matchTemplate(cv2.imread(str(f),0)[180:450],patch,cv2.TM_CCOEFF_NORMED)
  _,score,_,(actual,top)=cv2.minMaxLoc(scores)
  if score>.9:rows.append(dict(t=cs[i]['t'],score=score,error_px=abs(actual-pred)))
 assert len(rows)>=minimum and max(r['error_px']for r in rows)<1.1,name
 checks[name]={'reference':[t,x,y,w,h],'samples':rows}
span=max(c['camera_px']for c in cs)-min(c['camera_px']for c in cs)
report={'checks':checks,'camera_span_px':span,'width_lower_bound_world':(720+span)*168/265,'limits':'Camera capacity only; exact wall offsets, prop layout and lifecycle, enemy placement and room appearance remain unverified.'}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
print({k:len(v['samples'])for k,v in checks.items()},report['width_lower_bound_world'])
