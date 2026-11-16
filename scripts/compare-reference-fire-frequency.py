#!/usr/bin/env python3
"""Compare two fire creation-frequency hypotheses using a simple orange profile."""
from pathlib import Path
import argparse,hashlib
import json,cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);args=p.parse_args();ROOT=Path(__file__).resolve().parents[1]
r=json.load(open(ROOT/'docs/reference-evidence/157-native-missiles.json'));atlas=Image.open(ROOT/'docs/reference-evidence/157-native-missiles-raw.png');kernels=[]
for f in r['files']['passiveobject/common/animation/firemissileparticle1.ani']['animation']['frames'][:2]:
 b=f['bitmapEvidence'];x,y=r['tiles'][b['tile']]['pasteXY'];w,h=b['size'];im=atlas.crop((x,y,x+w,y+h)).rotate(180).resize((round(w*.7*1.125),round(h*.7*1.125)),Image.Resampling.BILINEAR)
 p=np.array(im).astype(float);kernels.append((np.maximum(0,p[:,:,0]-p[:,:,2]-70)*p[:,:,3]/255).sum(axis=0))
rows=[]
for t,head in [(61.4,217),(61.5,251)]:
 path=args.frames/f'149-v1-{t:g}-second-room.png';im=cv2.imread(str(path)).astype(float);obs=np.maximum(0,im[295:330,100:270,2]-im[295:330,100:270,0]-70).sum(axis=0)
 for rate in [20,50]:
  best=None
  for phase in np.arange(0,1/rate,.0025):
   for offset in range(-8,9):
    pred=np.zeros(170)
    for age in np.arange(phase,.35,1/rate):
     k=kernels[0 if age<.23 else 1]*(1 if age<.23 else 100/255);center=head+offset-337.5*(age-phase)-100
     left=round(center-len(k)/2)
     for j,v in enumerate(k):
      if 0<=left+j<170:pred[left+j]+=v
    score=float(np.dot(obs,pred)/(np.linalg.norm(obs)*np.linalg.norm(pred)))
    if best is None or score>best['score']:best={'t':t,'frame':path.name,'frameSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'rateHz':rate,'phase':float(phase),'offset':offset,'score':score,'observed':obs.tolist(),'predicted':pred.tolist()}
  rows.append(best);print(t,rate,best['score'],best['phase'],best['offset'])
args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps({'models':rows,'limits':['Exploratory one-dimensional orange-energy additive model, not engine compositing proof.','Phase and position fitted separately; does not establish unique frequency semantics.']},indent=2)+'\n')
