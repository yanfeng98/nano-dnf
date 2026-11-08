#!/usr/bin/env python3
"""Match local native combat labels; retain reference crops only as audit evidence."""
from pathlib import Path
import argparse,io,json,subprocess
from PIL import Image,ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-xp41'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
with (a.client/'ImagePacks2/sprite_interface_newresult.NPK').open('rb') as f:
 entry=next(e for e in NPK.open(f).files if e.name.endswith('/result2_mainhud.img'));obj=IMGFactory.open(io.BytesIO(entry.data))
rows=[];crops=[('operation',11,(674,345,715,370),(665,338,720,374)),('technique',10,(675,362,715,387),(665,355,720,392)),('hits',12,(662,380,715,405),(655,372,720,409)),('rating',14,(675,397,712,422),(665,389,720,426))]
for v,time in [(1,332.5),(2,386.7)]:
 source=next(a.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(source),'-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 image=Image.open(io.BytesIO(raw)).convert('RGB');ref=np.array(image)
 for label,index,box,search in crops:
  image.crop(box).save(a.out/f'41-v{v}-{label}-reference.png')
  frame=obj.images[index]
  while type(frame).__name__=='ImageLink':frame=obj.images[frame.index]
  src=np.array(obj.build(frame).convert('RGBA'));best=None;x,y,r,b=search
  for scale in np.arange(.75,1.251,.025):
   im=cv2.resize(src,None,fx=scale,fy=scale);template=im[:,:,0].astype('float32')*im[:,:,3]/255;region=ref[y:b,x:r,0].astype('float32')
   if template.shape[0]>region.shape[0] or template.shape[1]>region.shape[1]:continue
   scores=cv2.matchTemplate(region,template,cv2.TM_CCOEFF_NORMED);_,value,_,loc=cv2.minMaxLoc(scores)
   if best is None or value>best['correlation']:best={'scale':round(float(scale),3),'correlation':value,'xy':[x+loc[0],y+loc[1]]}
  rows.append({'video':v,'time':time,'label':label,'native_frame':index,'search_region':search,**best})
 image.crop((630,396,714,422)).save(a.out/f'41-v{v}-grade-reference.png')
(a.out/'41-combat-label-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')

source=next(a.videos.glob('00001-*.mp4'))
raw=subprocess.run(['ffmpeg','-loglevel','error','-ss','60','-i',str(source),'-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
Image.open(io.BytesIO(raw)).crop((630,396,714,422)).save(a.out/'41-v1-ss-reference.png')
