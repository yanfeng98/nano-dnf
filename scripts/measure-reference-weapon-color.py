#!/usr/bin/env python3
"""Find the reference short-sword colour, then verify two held-out cast poses.

Native art stays native; video frames are audit evidence only. A masked colour
match identifies an appearance, not the inventory item or its stats.
"""
import argparse
import io
import json
import re
import subprocess
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=ROOT.parent/'dnf-素材/00002-幽暗密林深处.mp4')
p.add_argument('--normal-video', type=Path, default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out', type=Path, default=Path('/tmp/nano-reference-weapon-color'))
a = p.parse_args()
a.out.mkdir(parents=True,exist_ok=True)
cv2.setNumThreads(1)
poses = [(185,1.966667,84.5,398.2,True),(42,111.333333,416,420,False),(46,111.633333,416,420,False)]
references = {}
for frame,time,*_ in poses:
    file = a.out/f'reference-{frame}.png'
    subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss',f'{time-.001:.6f}',
                    '-i',str(a.video),'-vf','crop=1440:1080:240:0,scale=720:540',
                    '-frames:v','1',str(file)],check=True)
    references[frame] = cv2.imread(str(file))

normal_frame = a.out/'normal-reference-185.png'
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','13.132333',
                '-i',str(a.normal_video),'-vf','crop=1440:1080:240:0,scale=720:540',
                '-frames:v','1',str(normal_frame)],check=True)

pack = a.client/'ImagePacks2/sprite_character_swordman_equipment_weapon_sswd.NPK'
objects = {}

def decoded(obj,index):
    item = obj.images[index]
    while type(item).__name__ == 'ImageLink':
        item = obj.images[item.index]
    return obj.build(item).convert('RGBA'),item.x,item.y

with pack.open('rb') as handle:
    entries = {e.name.rsplit('/',1)[-1]:e for e in NPK.open(handle).files}
    def get(model,suffix):
        key = model,suffix
        if key not in objects:
            name = f'sswd{model}{suffix}.img'
            if name not in entries:
                return None
            objects[key] = IMGFactory.open(io.BytesIO(entries[name].data))
        return objects[key]

    def match(model,pose):
        frame,_,rx,ry,flip = pose
        stage = Image.new('RGBA',(500,500))
        for suffix in ['b','c']:
            obj = get(model,suffix)
            if obj is None:
                continue
            image,x,y = decoded(obj,frame)
            stage.alpha_composite(image,(x-232+250,y-333+250))
        box = stage.getbbox()
        if not box:
            return None
        image = stage.crop(box)
        pixels = np.array(image)
        if flip:
            pixels = pixels[:,::-1]
        x,y = box[0]-250,box[1]-250
        best = None
        for scale in np.arange(.9,1.251,.025):
            v = cv2.resize(pixels,None,fx=float(scale),fy=float(scale))
            mask = (v[:,:,3]>150).astype('uint8')*255
            if np.count_nonzero(mask)<200:
                continue
            px = round(rx+((-x-image.width) if flip else x)*scale)
            py = round(ry+y*scale)
            h,w = v.shape[:2]
            if px-6<0 or py-6<0 or px+w+6>720 or py+h+6>540:
                continue
            roi = references[frame][py-6:py+h+6,px-6:px+w+6]
            score,_,loc,_ = cv2.minMaxLoc(cv2.matchTemplate(roi,v[:,:,:3][:,:,::-1],cv2.TM_SQDIFF_NORMED,mask=mask))
            if best is None or score<best['score']:
                best = dict(score=float(score),scale=float(scale),left=px-6+loc[0],top=py-6+loc[1])
        return dict(model=model,frame=frame,**best) if best is not None else None

    ranking = []
    for name in entries:
        if not re.fullmatch('sswd[0-9]+c.img',name):
            continue
        model = name[4:-5]
        try:
            result = match(model,poses[0])
            if result:
                ranking.append(result)
        except (IndexError,ValueError):
            continue
    ranking.sort(key=lambda v:v['score'])
    selected = ranking[0]['model']
    held_out = [match(model,pose) for model in ['0000','0001',selected] for pose in poses[1:]]
    saved_reference = references[185]
    references[185] = cv2.imread(str(normal_frame))
    normal_held_out = [match(model,(185,13.133333,302,378,True)) for model in ['0000','0001',selected]]
    references[185] = saved_reference
    geometry = []
    for suffix in ['b','c']:
        old,new = get('0000',suffix),get(selected,suffix)
        same = len(old.images)==len(new.images)
        for index in range(min(len(old.images),len(new.images))):
            before,x,y = decoded(old,index)
            after,xx,yy = decoded(new,index)
            same = same and (x,y,before.size)==(xx,yy,after.size) and np.array_equal(np.array(before.getchannel('A')),np.array(after.getchannel('A')))
        geometry.append(dict(part=suffix,frames=len(new.images),same_alpha_and_coordinates=same))

result = dict(video=a.video.name,selected=selected,catalog_models=sum(bool(re.fullmatch('sswd[0-9]+c.img',name)) for name in entries),
              candidates=len(ranking),town_ranking=ranking[:15],
              held_out_cast_poses=held_out,normal_video=a.normal_video.name,
              held_out_normal_town=normal_held_out,geometry=geometry,
              limits='Masked normalized squared colour error, lower is better. Selection uses town frame185; '
                     'frames42/46 are held out. Bright cast effects limit the last pose. Fitted scale/translation '
                     'do not prove complete avatar geometry, exact inventory identity, stats or historical ownership.')
assert selected=='0006', 'Recheck the selected appearance before changing the bake'
assert all(v['same_alpha_and_coordinates'] for v in geometry)
(a.out/'measurement.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='town_ranking'},indent=2,ensure_ascii=False))
