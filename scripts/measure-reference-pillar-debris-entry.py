#!/usr/bin/env python3
"""Independent entry-burst candidates plus HD verification of native type3.

Input: V2 from26s, 30fps, original crop=1440:1080:240:0.
Tiny type4 produces background matches and is not counted as a verified fragment.
The output is evidence only, not a guessed game emitter.
"""
import argparse
import cv2,numpy as np,json,sys
from PIL import Image,ImageDraw
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'assets'))
from import_dnf_scene import decode_at
sources={i:np.array(decode_at(a.client,'sprite_map_breakableobject_stonepillar.NPK',f'sprite/map/breakableobject/stonepillar/stonepillarparticle{i}.img',0)[0]) for i in range(1,5)}
cv2.setNumThreads(1)
forms={i:cv2.resize(sources[i],None,fx=1.125,fy=1.125)for i in range(1,5)}
rows=[]
for index in range(28,51):
 time=26+(index-1)/30;image=cv2.imread(str(a.frames/f'{index:03d}.png'));assert image is not None and image.shape[:2]==(1080,1440);image=cv2.resize(image,(720,540));gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY);left,top=240,100;roi=gray[top:440,left:700];matches=[]
 for kind,rgba in forms.items():
  for angle in range(round(179*(time-27))-15,round(179*(time-27))+16,5):
   chip=np.array(Image.fromarray(rgba).rotate(angle,resample=Image.Resampling.BICUBIC,expand=True));h,w=chip.shape[:2];mask=(chip[:,:,3]>220).astype('uint8')*255
   z=cv2.matchTemplate(roi,cv2.cvtColor(chip[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1)
   for _ in range(10):
    _,value,_,(x,y)=cv2.minMaxLoc(z)
    if value<.88:break
    matches.append({'kind':kind,'angle':angle,'score':float(value),'xy':[x+left+w/2,y+top+h/2]});z[max(0,y-8):y+9,max(0,x-8):x+9]=-1
 matches.sort(key=lambda m:-m['score']);kept=[]
 for m in matches:
  if not any(np.linalg.norm(np.array(m['xy'])-q['xy'])<10 for q in kept):kept.append(m)
 rows.append({'frame':index,'time':time,'matches':kept[:20]})


# Refine the two separate type3 instances over three independent frames.
verified=[]
for index in [42,43,44]:
 row=next(r for r in rows if r['frame']==index)
 candidates=[m for m in row['matches'] if m['kind']==3 and m['score']>.9]
 assert len(candidates)>=2
 gray=cv2.cvtColor(cv2.imread(str(a.frames/f'{index:03d}.png')),cv2.COLOR_BGR2GRAY)
 for candidate in candidates:
  expected=np.array(candidate['xy'])*2;left,top=np.floor(expected-65).astype(int)
  roi=gray[top:top+131,left:left+131];best=None
  rgba=cv2.resize(sources[3],None,fx=2.25,fy=2.25)
  for angle in range(candidate['angle']-12,candidate['angle']+13):
   chip=np.array(Image.fromarray(rgba).rotate(angle,resample=Image.Resampling.BICUBIC,expand=True));h,w=chip.shape[:2]
   z=cv2.matchTemplate(roi,cv2.cvtColor(chip[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=(chip[:,:,3]>220).astype('uint8')*255)
   z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(x,y)=cv2.minMaxLoc(z)
   if best is None or score>best['score']:best={'frame':index,'time':row['time'],'kind':3,'angle':angle,'score':score,'centerHd':[left+x+w/2,top+y+h/2]}
  assert best['score']>.94,best
  verified.append(best)
preburst=[m['score'] for r in rows if r['time']<27 for m in r['matches'] if m['kind']==4]
assert preburst and max(preburst)>.9
report={'preburstType4MaxScore':max(preburst),'sourceCrop':[1440,1080],'coarseSearchScale':.5,'samples':rows,'type3HdMatches':verified,
 'limits':'Independent type3 source identity verified at6 locations across3 frames. Two distinct instances are visible. Existing coarse types2/3 give lower bounds only, not exact burst count. Type4 round 8x8 texture has strong matches before the burst and cannot identify debris by correlation alone. Emission parameters, pivot and total count remain unresolved.'}
(a.out/'measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print('verified HD type3',[(q['frame'],round(q['score'],4),q['centerHd'])for q in verified])
