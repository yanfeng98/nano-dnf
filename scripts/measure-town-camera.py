#!/usr/bin/env python3
"""Compare town camera models with V1 architecture/name traces.

Reuses the committed 30fps trace from measure-town-depth.py and independently
tracks a later rightward/stop sequence. Crops are audit evidence only.
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
p.add_argument('--out', type=Path, default=Path('/tmp/nano-town-camera'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','13.132','-i',str(a.video),
                '-vf','crop=1440:1080:240:0,scale=720:540','-frames:v','1',str(a.out/'template-frame.png')],check=True)
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','17','-i',str(a.video),'-t','5',
                '-vf','crop=1440:1080:240:0,scale=720:540,fps=10',str(a.out/'frame-%03d.png')],check=True)
template = cv2.imread(str(a.out/'template-frame.png'),0)[227:242,258:346]
sift = cv2.SIFT_create(nfeatures=1200)
previous = None
camera = 0.0
samples = []
for i in range(50):
    # New town room at the ninth/tenth sample: relative camera offsets restart.
    if i in [8,9]:
        previous = None
        camera = 0.0
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
    samples.append(dict(sample=i+1,time=17.05+i*.1,name_x=loc[0]+100,name_y=loc[1]+190,
                        score=score,camera_x=camera,background_dx=dx,matches=count))
prior = json.loads((ROOT/'docs/reference-evidence/20-town-depth-measurement.json').read_text())
left = [dict(t=s['time'],x=s['name_x']+44,c=s['camera_x']) for s in prior['samples'][:35]]
right = [dict(t=s['time'],x=s['name_x']+44,c=s['camera_x']) for s in samples[9:]]
lo = float(np.median([s['x'] for s in left]))
hi = float(np.median([s['x'] for s in right]))
center,radius = (lo+hi)/2,(hi-lo)/2
models = {}
for model in ['center','ease8','zone']:
    residual = []
    for trace in [left,right]:
        predicted = trace[0]['c']
        for prev,s in zip(trace,trace[1:]):
            world = s['x']+s['c']
            dt = s['t']-prev['t']
            if model == 'center':
                predicted = world-center
            elif model == 'ease8':
                predicted += (world-center-predicted)*(1-np.exp(-8*dt))
            else:
                screen = world-predicted
                if screen < center-radius:
                    predicted = world-center+radius
                elif screen > center+radius:
                    predicted = world-center-radius
            residual.append(predicted-s['c'])
    models[model] = dict(rms=float(np.sqrt(np.mean(np.array(residual)**2))),max_error=float(max(abs(np.array(residual)))))
result = dict(video=a.video.name,left_name_center=lo,right_name_center=hi,
              fitted_name_center=center,fitted_half_width=radius,
              models=models,samples=samples,camera_radius_band=[52,60],target_radius=56,
              limits='Name-template center has a small offset from the character root; only the 112px separation '
                     'determines the radius. Keep the 720px viewport center at 360. These traces support '
                     'a horizontal activity window and no stop drift, not every hidden camera rule or scene seam.')
if models['zone']['rms'] > 2 or not 52 <= radius <= 60:
    raise ValueError('The recording no longer supports the measured camera window')
(a.out/'measurement.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k != 'samples'},indent=2,ensure_ascii=False))
