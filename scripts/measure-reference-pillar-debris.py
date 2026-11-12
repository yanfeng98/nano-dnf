#!/usr/bin/env python3
"""Measure native debris texture/rotation candidates; emission and pivot stay unproven.

Input: V2 from62s, 30fps, crop=1440:1080:240:0,scale=720:540.
The four tracks are manual correspondence hypotheses gated by texture score;
their search seeds do not become game motion parameters.
"""
import argparse,sys
import cv2,numpy as np,json
from PIL import Image,ImageDraw
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'assets'))
from import_dnf_scene import decode_at
atlas=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'))
pic=cv2.resize(atlas[:133,:44],(50,150));mask=(pic[:,:,3]>180).astype('uint8')*255;mask[:65]=0;mask[145:]=0
forms={i:cv2.resize(np.array(decode_at(a.client,'sprite_map_breakableobject_stonepillar.NPK',f'sprite/map/breakableobject/stonepillar/stonepillarparticle{i}.img',0)[0]),None,fx=1.125,fy=1.125)for i in range(1,4)}
rows=[];panels=[]
for index in range(51,67):
 p=a.frames/f'{index:03d}.png';image=cv2.imread(str(p));gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
 scores=cv2.matchTemplate(gray[270:440,150:650],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
 _,score,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1));x+=150
 center=x+25+140.625;left=round(center-150);roi=gray[130:420,left:left+300];matches=[]
 for kind,chip in forms.items():
  for angle in range(0,360,10):
   c=np.array(Image.fromarray(chip).rotate(angle,resample=Image.Resampling.BICUBIC,expand=True));h,w=c.shape[:2];m=(c[:,:,3]>200).astype('uint8')*255
   z=cv2.matchTemplate(roi,cv2.cvtColor(c[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=m);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1)
   for _ in range(3):
    _,v,_,(xx,yy)=cv2.minMaxLoc(z)
    if v<.85:break
    matches.append({'kind':kind,'angle':angle,'score':round(v,4),'xy':[xx+left,yy+130],'relativeCenter':[round(xx+left+w/2-center,3),yy+130+h/2-346.25]})
    z[max(0,yy-8):yy+9,max(0,xx-8):xx+9]=-1
 matches.sort(key=lambda m:-m['score']);kept=[]
 for m in matches:
  if not any(np.linalg.norm(np.array(m['relativeCenter'])-k['relativeCenter'])<14 for k in kept):kept.append(m)
 matches=kept[:12]
 panel=Image.fromarray(cv2.cvtColor(image[130:420,left:left+300],cv2.COLOR_BGR2RGB));d=ImageDraw.Draw(panel);d.text((3,3),str(round(62+(index-1)/30,4)),fill='white')
 for m in matches:
  if m['kind']==4:continue
  xx,yy=m['xy'];d.rectangle((xx-left,yy-130,xx-left+20,yy-110),outline='red');d.text((xx-left,yy-140),str(m['kind']),fill='white')
 panels.append(panel);rows.append({'t':round(62+(index-1)/30,4),'center':center,'matches':matches})
out=Image.new('RGB',(1200,1160))
for i,p in enumerate(panels):out.paste(p,((i%4)*300,(i//4)*290))
out.save(a.out/'contact.jpg');(a.out/'candidates.json').write_text(json.dumps(rows,indent=2)+'\n')

import math
tracks={k:[]for k in ['mid','left','right','midright']}
for r in rows:
 t=r['t']-63.6667
 for name,kind,x0,vx,y0,vy in [('mid',2,-17,75,-86,-194),('left',1,-20,-50,-103,-300),('right',1,15,80,-105,-280),('midright',2,15,60,-85,-240)]:
  candidates=[m for m in r['matches'] if m['kind']==kind and m['score']>.9]
  if not candidates:continue
  pred=np.array([x0+vx*t,y0+vy*t+675*t*t])
  m=min(candidates,key=lambda m:np.linalg.norm(np.array(m['relativeCenter'])-pred))
  if np.linalg.norm(np.array(m['relativeCenter'])-pred)>20:continue
  cx,cy={1:(-8.5,-13.5),2:(-3.5,-3)}[kind];radians=math.radians(m['angle']);dx=(cx*math.cos(radians)+cy*math.sin(radians))*1.125;dy=(-cx*math.sin(radians)+cy*math.cos(radians))*1.125
  x,y=m['relativeCenter'];tracks[name].append({'t':t,'xy':[x-dx,y-dy],'raw':m['relativeCenter'],'angle':m['angle'],'score':m['score']})
report={}
for name,points in tracks.items():
 t=np.array([r['t']for r in points]);angles=np.array([r['angle']for r in points]);models={}
 for coordinate in ['raw','xy']:
  x=np.array([r[coordinate][0]for r in points]);y=np.array([r[coordinate][1]for r in points]);vx=np.polyfit(t,x,1);q=np.polyfit(t,y,2)
  fixed=np.polyfit(t,y-675*t*t,1);rmse=np.sqrt(np.mean((y-(fixed[0]*t+fixed[1]+675*t*t))**2))
  models[coordinate]={'horizontalNativeSpeed':float(vx[0]/1.125),'freeFittedNativeGravity':float(2*q[0]/1.125),'fixed1200GravityRmsePx':float(rmse),'fixedGravityInitialNativeVerticalSpeed':float(fixed[0]/1.125),'fixedGravityInitialNativeVerticalOffset':float(fixed[1]/1.125)}
 report[name]={'points':points,'rotationDegreesPerSecond':float(np.polyfit(t,angles,1)[0]),'models':models,'fixed179RotationRmsErrorDegrees':float(np.std(angles-179*t))}
result={'tracks':report,'limits':'Four manually selected moving fragment tracks using native types1/2; other types are source-listed but not isolated. Background false positives remain in candidates.json, not the selected tracks. The two rotation-pivot models differ. Source gravity1200 is compatible with low pixel residuals, not uniquely recovered from these short tracks. No emission distribution or new runtime trajectories are inferred.'}
(a.out/'tracks.json').write_text(json.dumps(result,indent=2)+'\n')
print({k:{'points':len(v['points']),'rotation':v['rotationDegreesPerSecond']}for k,v in report.items()})
