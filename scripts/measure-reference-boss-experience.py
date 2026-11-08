#!/usr/bin/env python3
"""Constrain recording XP thresholds using separately visible boss credits.

Bounds propagate ±2px endpoint uncertainty, not a fitted replacement formula.
The selected intervals require no other XP event; log crops are retained for
manual checking. No runtime balance or progression data is changed.
"""
import argparse,io,json,subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
p.add_argument('--stable-evidence',type=Path,default=Path('docs/reference-evidence/42-xp-stable-bars.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-xp43'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
stable=json.loads(a.stable_evidence.read_text())
sheet=Image.new('RGB',(1380,800));draw=ImageDraw.Draw(sheet);reports=[]
for row,(video,times,credit) in enumerate([(1,[325,330,332.5],280),(2,[385,386,386.7],360)]):
 source=next(a.videos.glob(f'{video:05d}-*.mp4'));samples=[]
 for col,t in enumerate(times):
  raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(t),'-i',str(source),'-frames:v','1',
   '-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
  im=Image.open(io.BytesIO(raw)).convert('RGB');rgb=np.asarray(im).astype(float)[486:493,134:294]
  green=(rgb[:,:,1]>110)&(rgb[:,:,1]>rgb[:,:,0]*1.25)&(rgb[:,:,1]>rgb[:,:,2]*1.25)
  end=0
  while end<160 and green.sum(axis=0)[end]>=3:end+=1
  if not 0<end<160:raise ValueError('Expected partially filled stable bar')
  samples.append({'time':t,'fill_pixels':end})
  x,y=col*460,row*400
  draw.text((x,y),f'V{video} {t}s fill {end}/160',fill='white')
  sheet.paste(im.crop((15,90,230,240)).resize((430,300)),(x,y+20))
  sheet.paste(im.crop((75,477,300,500)).resize((450,46)),(x,y+330))
 assert samples[1]['fill_pixels']==samples[2]['fill_pixels'],'Bar must settle before clear credit'
 before=samples[0]['fill_pixels'];after=samples[2]['fill_pixels'];delta=after-before
 # Two endpoint errors of ±2px give a conservative delta error of ±4px.
 assert delta>4
 current=[credit*160/(delta+4),credit*160/(delta-4)]
 record=next(r for r in stable['reports'] if r['video']==video)
 assert record['samples'][0]['fill_pixels']==after
 residual=record['samples'][1]['fraction_interval'];total=record['observed_clear_credit']
 # Use independent interval extrema (conservative; shared endpoints correlated).
 pre=[(after-2)/160,(after+2)/160]
 following=[(total-(1-pre[0])*current[1])/residual[1],
            (total-(1-pre[1])*current[0])/residual[0]]
 reports.append({'video':video,'source':source.name,'level':record['samples'][0]['level'],
  'boss_credit_read_from_log':credit,'samples':samples,'fill_delta_pixels':delta,
  'current_level_threshold_interval':current,'next_level_threshold_interval':following,
  'limits':'Intervals assume boss credit is the sole XP change in the selected segment and clear total is the sole later net credit. Conservative independent extrema are used; negative lower bounds would be inconclusive. No exact threshold or global progression law is identified.'})
sheet.save(a.out/'43-boss-xp-contact.png')
(a.out/'43-boss-xp-measurement.json').write_text(json.dumps({'endpoint_uncertainty_pixels':2,'reports':reports},indent=2)+'\n')
for report in reports:print(report['video'],report['current_level_threshold_interval'],report['next_level_threshold_interval'])
