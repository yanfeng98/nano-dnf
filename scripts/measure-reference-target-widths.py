#!/usr/bin/env python3
"""Measure observed target-frame endpoints; never infer HP/level formulas.

Labels/levels below are read from source captions. Border masks measure the
track even when HP is empty. All video-derived output is audit-only.
"""
import argparse,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
import cv2
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=ROOT.parent/'dnf-素材')
p.add_argument('--out',type=Path,default=Path('/tmp/nano-target-width-evidence'))
a=p.parse_args()
if a.out.resolve().is_relative_to(ROOT/'assets'):p.error('video pixels cannot enter runtime assets')
a.out.mkdir(parents=True,exist_ok=True)
profiles=[(1,'grunt',4,181,[95,125,130]),(1,'goblinBlue',4,144,[110,115,150]),
 (1,'goblinRed',4,144,[180,215,230]),(1,'caster',4,144,[155,155.1]),
 (1,'burningThrower',4,217,[220,220.1]),(2,'grunt',4,116,[239.9,240,240.1]),
 (2,'goblinBlue',6,144,[90,95,170,280]),(2,'goblinRed',5,116,[12,13.5,15.8,18,20.5]),
 (2,'goblinRed',6,144,[80,85,140,150]),
 (2,'cat',6,162,[160,180,334]),(2,'throwerElite',6,162,[65,70,260,310]),
 (2,'throwerElite',7,196,[354.9,355,355.1]),(2,'deepElite',6,198,[120,220]),
 (2,'deepElite',7,240,[345,350,360])]
cases=[(v,kind,level,width,t) for v,kind,level,width,times in profiles for t in times]
contact=Image.new('RGB',(1200,((len(cases)+1)//2)*65),'#171717');d=ImageDraw.Draw(contact);rows=[]
for i,(video,kind,level,width,time) in enumerate(cases):
 name='00001-幽暗密林.mp4' if video==1 else '00002-幽暗密林深处.mp4'
 file=a.out/f'v{video}-{time:g}.png'
 subprocess.run(['ffmpeg','-loglevel','error','-ss',f'{time-.001:.3f}','-i',str(a.videos/name),
  '-frames:v','1','-vf','crop=1200:100:240:80','-y',str(file)],check=True)
 image=Image.open(file).convert('RGB');pixels=np.array(image).astype(float);r,g,b=pixels[:,:,0],pixels[:,:,1],pixels[:,:,2]
 gold=(r>100)&(g>90)&(b>45)&(r>g*.95)&(r<g*1.4)&(g>b*1.08)&(g<b*1.9)
 silver=(r>90)&(g>90)&(b>90)&(np.maximum.reduce([r,g,b])-np.minimum.reduce([r,g,b])<35)
 candidates=[]
 for y in list(range(42,50))+list(range(72,83)):
  line=cv2.morphologyEx((gold|silver)[y:y+1].astype('uint8'),cv2.MORPH_CLOSE,np.ones((1,5),'uint8'))[0]
  edges=np.diff(np.r_[0,line,0].astype(int));starts=np.where(edges==1)[0];ends=np.where(edges==-1)[0]
  runs=[(int(s),int(e)) for s,e in zip(starts,ends) if e-s>130 and s<110 and e>150]
  if runs:
   start,end=max(runs,key=lambda v:v[1]-v[0]);candidates.append({'y':y,'start':start,'end_exclusive':end})
 edge=float(np.median([c['end_exclusive'] for c in candidates])) if candidates else None
 origin=46.5 if kind=='burningThrower' else 39.75
 rows.append({'video':name,'time':time,'type':kind,'level':level,'frame':'champion' if kind=='burningThrower' else 'normal',
  'border_candidates':candidates,'right_edge_video_px':edge,
  'estimated_canvas_fill_width':round(edge/2-origin,3) if edge is not None else None,'reference_profile_width':width})
 x=(i%2)*600;y=(i//2)*65;contact.paste(image.resize((600,50)),(x,y+15));d.text((x+2,y),f'V{video} {time:g}s / {kind} Lv{level}',fill='white')
contact.save(a.out/'width-reference-sequence.png')
(a.out/'width-measurement.json').write_text(json.dumps({'crop':'original (240,80,1200,100), widths normalized by /2',
 'scope':'Per-caption observed profiles; border masks have compression/outlier error. No extrapolation to other levels/stages or demo maxHp.',
 'rows':rows},ensure_ascii=False,indent=2)+'\n')
print('Target width evidence ->',a.out)
