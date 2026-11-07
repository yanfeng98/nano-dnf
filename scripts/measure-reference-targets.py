#!/usr/bin/env python3
"""Reproduce target-UI evidence from the two local recordings (audit output only).

Video pixels never go into assets/. Uses the measured two-color stacks, not
unobserved damage/HP formulas. Heavy jobs must run after browser tests finish.
"""
import argparse,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=Path(__file__).resolve().parents[2]/'dnf-素材')
p.add_argument('--out',type=Path,default=Path('/tmp/nano-target-measurement'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cases=[(1,t) for t in [95,100,130,250,260,270,280,290,300,310,328.5]]+[(2,t) for t in [327,330,334,350,370,380]]
contact=Image.new('RGB',(720,len(cases)*60),'#181818');draw=ImageDraw.Draw(contact);rows=[]
for i,(video,time) in enumerate(cases):
 name='00001-幽暗密林.mp4' if video==1 else '00002-幽暗密林深处.mp4'
 raw=a.out/f'v{video}-{time:g}-raw.png'
 subprocess.run(['ffmpeg','-loglevel','error','-ss',f'{time-.001:.3f}','-i',str(a.videos/name),
  '-frames:v','1','-vf','crop=1440:1080:240:0','-y',str(raw)],check=True)
 image=Image.open(raw).convert('RGB');small=image.resize((720,540),Image.Resampling.BILINEAR)
 patch=small.crop((0,43,590,85));patch.save(a.out/f'v{video}-{time:g}-target.png')
 contact.paste(small.crop((0,43,720,85)),(0,i*60+15));draw.text((2,i*60),f'V{video} {time:g}s',fill='white')
 # Below the name/category, inside the 1068-video-pixel boss track.
 pixels=np.array(image)[146:150,88:1158,:3].astype(float);r,g,b=pixels[:,:,0],pixels[:,:,1],pixels[:,:,2]
 masks={'green':(g>110)&(g>r*1.1)&(b<60),'orange':(r>150)&(g>60)&(g<180)&(b<65),
  'red':(r>100)&(g<60)&(b<60),'black':(r<45)&(g<45)&(b<45)}
 counts={key:int(np.count_nonzero(mask.mean(axis=0)>.5)) for key,mask in masks.items()}
 ordinary=(video==1 and time<200) or (video==2 and time in [334,350])
 record={'video':name,'time':time,'target_kind':'ordinary' if ordinary else 'boss'}
 if not ordinary:record['color_bins_columns']=counts
 if video==1 and time in [250,270]:
  left,right=(500,1150) if time==250 else (460,760)
  region=np.array(image)[98:154,left:right,:3].astype(float)
  scores=[(float(np.mean((region[:,lag:]-region[:,:-lag])**2)),lag) for lag in range(65,96)]
  record['ALERT_repeat_best_video_px']=[{'period':lag,'mse':score} for score,lag in sorted(scores)[:3]]
 rows.append(record)
contact.save(a.out/'target-sequence.png')
output={'normalization':'crop 1440x1080 at (240,0), normalize to 720x540; game arena adds x=120',
 'scope':'Visible layer ordering and artwork/geometry evidence. Color bins may include faded hit ghosts; inspect the sequence. Equal layer capacities and monster balance are not established by these frames.',
 'rows':rows}
(a.out/'target-measurement.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print('Target evidence ->',a.out)
