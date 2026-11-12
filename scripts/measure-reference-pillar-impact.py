#!/usr/bin/env python3
"""Measure the native1002/226 pillar cap transition using native877/288 as camera anchor.

Frames: ffmpeg -ss 62 -i V2 -t 2.5 -vf crop=1440:1080:240:0,scale=720:540.
First impact at63.6667 is a manually inspected flash/9-damage event; the
independent texture matches bound the clear forms without treating occlusion as damage.
"""
import argparse
import cv2,numpy as np,json
from PIL import Image
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frames',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
a=parser.parse_args()
atlas=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'))
forms={k:cv2.resize(atlas[y:y+h,x:x+w],(50,round(h*1.125))) for k,(x,y,w,h) in {'flat':(0,0,44,133),'damaged':(44,0,44,111)}.items()}
base=forms['flat'];mask=(base[:,:,3]>180).astype('uint8')*255;mask[:65]=0;mask[145:]=0
rows=[]
for p in sorted(a.frames.glob('*.png')):
 t=62+(int(p.stem)-1)/30
 if not 63.2<=t<=64.1:continue
 gray=cv2.imread(str(p),0)
 result=cv2.matchTemplate(gray[270:440,150:650],cv2.cvtColor(base[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
 _,score,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(result,nan=-1,posinf=-1,neginf=-1));x+=150;y+=270
 expected=x+140.625
 vals={}
 for kind,pic in forms.items():
  # Each state has a different cap height, both share native bottom361.
  cap=pic[:40];h,w=cap.shape[:2];m=(cap[:,:,3]>220).astype('uint8')*255
  yy=round(360.875-pic.shape[0]);xx=round(expected)
  result=cv2.matchTemplate(gray[yy-3:yy+h+4,xx-5:xx+w+6],cv2.cvtColor(cap[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=m)
  _,v,_,loc=cv2.minMaxLoc(np.nan_to_num(result,nan=-1,posinf=-1,neginf=-1));vals[kind]=round(v,3)
 rows.append({'t':round(t,4),'anchorScore':round(score,3),'anchorXY':[x,y],'capScores':vals})
flat=[r for r in rows if r['anchorScore']>.9 and r['capScores']['flat']>.85]
damaged=[r for r in rows if r['anchorScore']>.9 and r['capScores']['damaged']>.85]
assert len(flat)>=10 and len(damaged)>=3
report={'source':'V2 62..64.5 seconds, 30fps, normalized720x540',
 'targetNativeXY':[1002,226],'cameraAnchorNativeXY':[877,288],
 'lastClearFlat':max(r['t'] for r in flat),'firstClearDamaged':min(r['t'] for r in damaged),
 'manuallyInspectedImpact':{'time':63.6667,'previousFrameIntact':63.6333,'damageText':'9','effect':'white hit flash with stone particles at the tracked pillar'},
 'samples':rows,'limits':'Texture bounds do not equate low correlation with damage. Prior visible footage56..63.633 was inspected; no earlier hit at this pillar was identified. Native integer HP semantics, weaker attack response, particle physics and walk collision remain unverified.'}
assert abs(report['lastClearFlat']-63.6333)<.001
assert abs(report['firstClearDamaged']-64.0333)<.001
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps(report,indent=2)+'\n')
print(report['lastClearFlat'],report['firstClearDamaged'])
