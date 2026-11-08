#!/usr/bin/env python3
"""Match native UI faces through the observed chest-list sequence; audit only."""
import subprocess,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
outdir=Path('/tmp/nano-chest37');outdir.mkdir(parents=True,exist_ok=True)
atlas=Image.open('assets/portraits-reference.png').convert('RGB');out=[]
for v,start,dur,faces in [(1,342.8,3.84,[(24,'boss'),(399,'goblinRed'),(303,'caster')]),(2,397,2.2,[(48,'lugaruBoss')])]:
 source=next(Path('../dnf-素材').glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(source),'-t',str(dur),'-vf','crop=1440:1080:240:0,scale=720:540','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
 fs=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3)
 for x,name in faces:
  template=np.array(atlas.crop((x,0,x+24,24)).resize((27,27),Image.Resampling.BILINEAR));scores=[]
  for i,f in enumerate(fs):
   res=cv2.matchTemplate(f[140:320,105:500],template,cv2.TM_CCOEFF_NORMED);_,val,_,loc=cv2.minMaxLoc(res)
   scores.append({'t':round(i/30,4),'correlation':round(val,4),'xy':[105+loc[0],140+loc[1]]})
  y={'boss':150,'goblinRed':200,'caster':235,'lugaruBoss':150}[name]
  Image.fromarray(fs[15]).crop((118,y,145,y+27)).save(outdir/f'37-list-v{v}-{name}-reference.png')
  out.append({'video':v,'face':name,'samples':scores});print(v,name,[s for s in scores[::15]])
(outdir/'37-list-measurement.json').write_text(json.dumps(out,indent=2)+'\n')
