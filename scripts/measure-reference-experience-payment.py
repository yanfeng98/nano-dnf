#!/usr/bin/env python3
"""Inspect the visible clear-credit/level-up before the result count-up.

Only image evidence is produced. This does not infer base-XP or server payout
formulas, and does not modify runtime progression or player data.
"""
from pathlib import Path
import argparse,json,subprocess
from PIL import Image,ImageDraw
import numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-xp41'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
sheet=Image.new('RGB',(1200,520));draw=ImageDraw.Draw(sheet);rows=[]
for row,(v,start,box,total,before,after) in enumerate([(1,332.5,(300,150,500,390),2376,4,5),(2,386.7,(430,130,630,370),6318,6,7)]):
 source=next(a.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(source),'-t','1.2','-vf','crop=1440:1080:240:0,scale=720:540','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
 frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3)
 for j,i in enumerate([0,3,6,9,15,24]):
  sheet.paste(Image.fromarray(frames[i]).crop(box),(j*200,row*260+20));draw.text((j*200,row*260),f'V{v} {start+i/30:.3f}',fill='white')
 rows.append({'video':v,'sample_start':start,'sample_fps':30,'visible_transition_interval':[round(start+.1,3),round(start+.2,3)],'level_before':before,'level_after':after,'clear_total_observed':total,'interpretation':'Total-XP float/level-up precedes the later result count-up; do not pay again for each displayed line.','limits':'Visible credit/level change; exact server transaction time and base-XP formula are not observed.'})
sheet.save(a.out/'41-xp-payment-contact.png');(a.out/'41-xp-payment-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')
