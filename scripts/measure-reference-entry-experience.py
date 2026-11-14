#!/usr/bin/env python3
"""Measure entry XP bars and bound a same-level threshold from observed credits.

Credits are manual log readings, not OCR. Bounds are observational constraints,
not an exact progression table. No runtime data is changed.
"""
import argparse
import hashlib
import io
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos', type=Path, default=Path(__file__).resolve().parents[2] / 'dnf-素材')
p.add_argument('--out', type=Path, default=Path('/tmp/nano121-entry-xp'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
# V1 log sums after two 40XP kills, the 80XP champion, then another 40XP kill.
cases = [(1,60,3,0),(1,70.8,3,80),(1,71.5,3,160),(1,73.6,3,200),
         (2,15.5,6,0),(2,15.8,6,50)]
sheet = Image.new('RGB',(900,len(cases)*75),'#181818')
draw = ImageDraw.Draw(sheet)
rows=[]
for i,(video,time,level,credit) in enumerate(cases):
    source=next(a.videos.glob(f'{video:05d}-*.mp4'))
    png=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(source),
        '-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540',
        '-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
    im=Image.open(io.BytesIO(png)).convert('RGB')
    strip=np.asarray(im)[486:493,134:294].astype(float)
    green=(strip[:,:,1]>110)&(strip[:,:,1]>strip[:,:,0]*1.25)&(strip[:,:,1]>strip[:,:,2]*1.25)
    columns=green.sum(axis=0)>=3
    end=0
    while end<160 and columns[end]: end+=1
    if not end: raise ValueError(f'V{video} {time}: missing connected XP fill')
    filename=f'121-v{video}-{time:g}-entry-xp.png'
    (a.out/filename).write_bytes(png)
    sheet.paste(im.crop((75,477,300,500)).resize((900,46)),(0,i*75+25))
    draw.text((0,i*75),f'V{video} {time:g}s Lv{level}, fill {end}/160, observed credit +{credit}',fill='white')
    rows.append(dict(video=video,time=time,level=level,credit=credit,fill=end,
        fractionInterval=[max(0,(end-2)/160),min(1,(end+2)/160)],
        frame=filename,sha256=hashlib.sha256(png).hexdigest()))
# Intersect all intervals for starting XP at each positive integer threshold.
# Bound the scan using the first/last V1 samples, with endpoint error included.
v1=[r for r in rows if r['video']==1]
f0,f1=v1[0]['fractionInterval'],v1[-1]['fractionInterval']
credit=v1[-1]['credit']
scan_max=int(credit/(f1[0]-f0[1]))+1
feasible=[]
for threshold in range(1,scan_max+1):
    lo=max(r['fractionInterval'][0]*threshold-r['credit'] for r in v1)
    hi=min(r['fractionInterval'][1]*threshold-r['credit'] for r in v1)
    if max(0,lo)<=min(threshold,hi): feasible.append(threshold)
report=dict(track=[134,486,160,7],endpointUncertaintyPixels=2,samples=rows,
    v1ThresholdIntegerInterval=[min(feasible),max(feasible)],
    limits=['Assumes listed credits are the only XP changes; all V1 samples remain Lv3.',
        'Intervals bound a threshold; they do not uniquely identify it or the initial XP integer.',
        'Deep entry is measured separately and supplies no global level-scaling formula.',
        'Manual credit readings must be checked against the accompanying full frames/logs.'])
sheet.save(a.out/'121-entry-xp-contact.png')
(a.out/'121-entry-xp.json').write_text(json.dumps(report,indent=2)+'\n')
print([(r['video'],r['time'],r['fill']) for r in rows])
print('V1 feasible integer threshold:',report['v1ThresholdIntegerInterval'])
