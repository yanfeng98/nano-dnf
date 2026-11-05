#!/usr/bin/env python3
"""Measure classic result art against both owner-provided recordings.

Video crops are audit evidence only. Native art comes exclusively from the local
client. Correlations describe the measured layers, not whole-screen fidelity.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'assets'))
import import_dnf_results as native

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--videos', type=Path, default=ROOT.parent/'dnf-素材')
p.add_argument('--out', type=Path, default=Path('/tmp/nano-reference-result-measurements'))
a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)
art = {name: np.array(image) for name, image, _ in native.frames(a.client)}

def frame(video, seconds):
    target = a.out/f'v{video}-{seconds}.png'
    if not target.exists():
        name = '幽暗密林' if video == 1 else '幽暗密林深处'
        subprocess.run(['ffmpeg','-v','error','-threads','1','-ss',str(seconds-.001),
            '-i',str(a.videos/f'0000{video}-{name}.mp4'),'-frames:v','1',
            '-vf','crop=1440:1080:240:0,scale=720:540','-threads','1',str(target)], check=True)
    return cv2.imread(str(target)).astype('float32')

def circle_template(scale, angle):
    n = round(420*scale)
    im = cv2.resize(art['magic'][:,:,:3].astype('float32'), (n,n))
    blue = im[:,:,2]-im[:,:,0]  # Native ndarray is RGBA.
    return cv2.warpAffine(blue, cv2.getRotationMatrix2D((n/2,n/2),angle,1), (n,n))

def circle_score(ref, scale, angle):
    t = circle_template(scale,angle); n = t.shape[0]; left=360-n//2; top=270-n//2
    yy,xx = np.mgrid[:n,:n]
    # Exclude the list/chest and lower HUD, keeping exposed outer-circle areas.
    mask = (((yy+top<130)|(yy+top>350))&(yy+top<480)&
            ((xx-n/2)**2+(yy-n/2)**2<(n/2)**2))
    obs = (ref[:,:,0]-ref[:,:,2])[top:top+n,left:left+n][mask]
    sample = t[mask]; obs=obs-obs.mean(); sample=sample-sample.mean()
    return float(np.dot(sample,obs)/(np.linalg.norm(sample)*np.linalg.norm(obs)))

ref = frame(1,345)
fit = max((dict(score=circle_score(ref,float(scale),angle),scale=float(scale),angle=angle)
    for scale in np.arange(1.075,1.1751,.0125) for angle in range(360)),key=lambda x:x['score'])
print('circle scale fit',fit,flush=True)
series=[]
for video, times in [(1,[343.5,344,345,346,347.5,349,354]),(2,[397.5,400.5,401.5])]:
    for seconds in times:
        ref=frame(video,seconds)
        score,angle=max((circle_score(ref,1.125,angle),angle) for angle in range(360))
        series.append(dict(video=video,seconds=seconds,angle=angle,score=score))

# Independently match the thin gold 3, and locate the dedicated reward chest.
matched=[]
for name,video,seconds,box,scales in [
    ('digit3',1,349.6,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('digit3',2,402.4,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('digit2',1,350.4,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('digit1',1,351.4,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('digit2',2,403.2,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('digit1',2,404.1,(310,405,410,485),np.arange(.9,1.251,.0125)),
    ('chest',1,345,(260,130,610,350),np.arange(1,1.201,.0125))]:
    ref=frame(video,seconds);x,y,x1,y1=box;roi=ref[y:y1,x:x1]
    choices=[]
    for scale in scales:
        v=cv2.resize(art[name],None,fx=float(scale),fy=float(scale))
        ink=v[:,:,3]>100
        if name=='chest': ink &= v[:,:,:3].max(2)>55
        mask=ink.astype('uint8')*255
        _,score,_,loc=cv2.minMaxLoc(cv2.matchTemplate(roi,v[:,:,:3][:,:,::-1].astype('float32'),
            cv2.TM_CCORR_NORMED,mask=mask))
        choices.append(dict(score=float(score),scale=float(scale),left=x+loc[0],top=y+loc[1],
            size=[v.shape[1],v.shape[0]]))
    matched.append(dict(name=name,video=video,seconds=seconds,**max(choices,key=lambda x:x['score'])))
report=dict(circle_fit=fit,circle_series=series,native_matches=matched)
(a.out/'measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
