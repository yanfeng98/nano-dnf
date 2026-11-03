#!/usr/bin/env python3
"""Compare native base weapon art with two unscaled recording poses.

Scores are masked RGB cosine similarities at the measured character root;
they identify a visual model, not an inventory item or an item-stat snapshot.
"""
import argparse,io,json,os,subprocess
from pathlib import Path
import cv2,numpy as np
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--video',type=Path,default=ROOT.parent/'dnf-素材/00002-幽暗密林深处.mp4')
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-wave-weapon-match'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);cv2.setNumThreads(1)
poses=[(42,'111.333333'),(46,'111.633333')];targets={}
for frame,time in poses:
    file=a.out/f'reference-{frame}.png'
    # 1/16000 source timestamps round just below some n/30 values. Seek
    # 1ms earlier so a decimal n/30 does not accidentally skip that frame.
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{float(time)-.001:.6f}','-i',str(a.video),'-vf',
        'crop=1440:1080:240:0,scale=720:540','-frames:v','1',str(file)],check=True)
    targets[frame]=cv2.imread(str(file))
results={str(frame):[] for frame,_ in poses}
for item in os.scandir(a.client/'ImagePacks2'):
    if not item.name.startswith('sprite_character_swordman_equipment_weapon_') or not item.name.lower().endswith('.npk'):continue
    with open(item.path,'rb') as handle:
        for entry in NPK.open(handle).files:
            name=entry.name.rsplit('/',1)[-1]
            if name.startswith('(') or not (name.endswith('0000c.img') or name=='katana5601c.img'):continue
            img=IMGFactory.open(io.BytesIO(entry.data))
            for frame,time in poses:
                native=img.images[frame]
                while type(native).__name__=='ImageLink':native=img.images[native.index]
                pixels=np.array(img.build(native).convert('RGBA'));best=(-1,None)
                for scale in np.arange(.85,1.151,.025):
                    q=cv2.resize(pixels,None,fx=float(scale),fy=float(scale));mask=q[:,:,3]>100
                    expected=(round(416+(native.x-232)*scale),round(420+(native.y-333)*scale))
                    for dy in range(-3,4):
                        for dx in range(-3,4):
                            x,y=expected[0]+dx,expected[1]+dy
                            region=targets[frame][y:y+q.shape[0],x:x+q.shape[1]]
                            if region.shape[:2]!=q.shape[:2]:continue
                            source=q[:,:,:3][:,:,::-1][mask].astype(float);observed=region[mask].astype(float)
                            score=float((source*observed).sum()/np.sqrt((source*source).sum()*(observed*observed).sum()))
                            if score>best[0]:best=(score,[float(scale),x,y])
                results[str(frame)].append({'entry':name,'pack':item.name,'score':best[0],'placement':best[1]})
for candidates in results.values():candidates.sort(key=lambda c:c['score'],reverse=True)
result={'video':a.video.name,'poses':[{'native_body_frame':f,'time':t} for f,t in poses],
        'measured_recording_root':[416,420],'results':results,
        'limits':'Nine base weapon families plus the old katana5601. This is a visual-model comparison; exact inventory item, all skin variants and equipment stats are not inferred.'}
(a.out/'measurement.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print([(f,v[0]['entry'],v[0]['score']) for f,v in results.items()])
