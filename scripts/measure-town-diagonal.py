#!/usr/bin/env python3
"""Compare cardinal and diagonal town speeds in one continuous V1 clip.

Tracks the same player and architecture before, during, and after diagonal
motion. Video crops are audit evidence only.
"""
import argparse
import json
import subprocess
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out', type=Path, default=Path('/tmp/nano-town-diagonal'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','13.132','-i',str(a.video),
                '-vf','crop=1440:1080:240:0,scale=720:540','-frames:v','1',str(a.out/'template-frame.png')],check=True)
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','17.999','-i',str(a.video),'-t','1.30',
                '-vf','crop=1440:1080:240:0,scale=720:540',str(a.out/'frame-%03d.png')],check=True)
template = cv2.imread(str(a.out/'template-frame.png'),0)[227:242,258:346]
sift = cv2.SIFT_create(nfeatures=1200)
previous = None
camera = 0.0
samples = []
for i in range(39):
    im = cv2.imread(str(a.out/f'frame-{i+1:03d}.png'),0)
    _, score, _, loc = cv2.minMaxLoc(cv2.matchTemplate(im[190:460,100:610],template,cv2.TM_CCOEFF_NORMED))
    mask = np.zeros(im.shape,np.uint8)
    mask[110:270,:580] = 255
    keys, desc = sift.detectAndCompute(im,mask)
    dx = None
    count = 0
    if previous is not None:
        old_keys, old_desc = previous
        matches = cv2.BFMatcher().knnMatch(old_desc,desc,k=2)
        good = [x for x,y in matches if x.distance < .6*y.distance]
        ds = np.array([np.array(keys[m.trainIdx].pt)-old_keys[m.queryIdx].pt for m in good])
        ds = ds[abs(ds[:,1]) < .8]
        if len(ds) > 5:
            vals,counts = np.unique(np.round(ds[:,0]),return_counts=True)
            mode = vals[counts.argmax()]
            selected = ds[abs(ds[:,0]-mode) < 1,0]
            dx = float(np.median(selected))
            camera -= dx
            count = len(selected)
    previous = keys,desc
    samples.append(dict(sample=i+1,time=18+i/30,name_x=loc[0]+100,name_y=loc[1]+190,
                        score=score,camera_x=camera,background_dx=dx,matches=count))
def fit(first,last,field):
    chosen=samples[first-1:last]
    times=np.array([v['time'] for v in chosen])
    values=np.array([v['name_x']+v['camera_x'] if field=='world_x' else v['name_y'] for v in chosen])
    slope,offset=np.polyfit(times,values,1)
    return dict(first=first,last=last,time=[float(times[0]),float(times[-1])],
                speed=float(slope),rms=float(np.sqrt(np.mean((values-slope*times-offset)**2))))
vertical=fit(13,20,'name_y')
horizontal=fit(28,38,'world_x')
diagonal=dict(x=fit(21,27,'world_x'),y=fit(21,27,'name_y'))
inner=dict(x=fit(22,26,'world_x'),y=fit(22,26,'name_y'))
for result in [diagonal,inner]:
    result['x_ratio']=abs(result['x']['speed']/horizontal['speed'])
    result['y_ratio']=abs(result['y']['speed']/vertical['speed'])
result=dict(video=a.video.name,normalized_size=[720,540],horizontal=horizontal,vertical=vertical,
            diagonal=diagonal,inner_window=inner,axis_ratio_band=[.9,1.1],samples=samples,
            limits='One short diagonal interval with seven 30fps samples; the inner five-sample fit '
                   'checks interval-boundary sensitivity. Architecture translation is removed before '
                   'horizontal fitting. Name bob and video compression limit precision. This supports '
                   'independent town axes, not exact client constants or dungeon movement rules.')
if not all(.9<=result['diagonal'][key]<=1.1 for key in ['x_ratio','y_ratio']):
    raise ValueError('The clip no longer supports independent diagonal axis speeds')
(a.out/'measurement.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='samples'},indent=2,ensure_ascii=False))
