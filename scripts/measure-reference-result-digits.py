#!/usr/bin/env python3
"""Compare native result digits with local reference frames; audit only.

The 1.125 shared UI scale and four-pixel overlap explain both observed totals.
Per-glyph optima vary with compression, neighbouring glyphs and resampling.
"""
import argparse,io,json
from pathlib import Path
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--references',type=Path,default=Path('docs/reference-evidence'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-digits40'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
with (a.client/'ImagePacks2/sprite_interface_newresult.NPK').open('rb') as f:
 entry=next(e for e in NPK.open(f).files if e.name.endswith('/result.img'));obj=IMGFactory.open(io.BytesIO(entry.data))
rows=[]
for v in [1,2]:
 ref=np.array(Image.open(a.references/f'39-v{v}-stats-reference.png').convert('RGB'))
 cases=[(35 if v==1 else 34,(315,85,375,135),'total-first',0),
  (32 if v==1 else 34,(350,85,405,135),'total-second',0),
  (24,(385,85,445,140),'slash',0),
  (53,(315,147,350,177),'operation-six',0),(47,(340,147,375,177),'operation-zero',0),
  (76,(463,152,510,178),'percent-eight',2),(73,(478,152,522,178),'percent-five',2),
  (26,(492,152,535,178),'percent-sign',2),
  (57,(312,229,342,256),'hit-minus',0),
  (59 if v==1 else 60,(325,229,355,256),'hit-first',0),
  (63 if v==1 else 61,(340,229,375,256),'hit-second',0)]
 for index,box,label,channel in cases:
  frame=obj.images[index]
  while type(frame).__name__=='ImageLink':frame=obj.images[frame.index]
  src=np.array(obj.build(frame).convert('RGBA'));best=None;x,y,r,b=box
  for scale in np.arange(.9,1.251,.025):
   im=cv2.resize(src,None,fx=scale,fy=scale)
   template=im[:,:,channel].astype('float32')*im[:,:,3]/255
   region=ref[y:b,x:r,channel].astype('float32')
   if region.shape[0]<template.shape[0] or region.shape[1]<template.shape[1]:continue
   scores=cv2.matchTemplate(region,template,cv2.TM_CCOEFF_NORMED);_,val,_,loc=cv2.minMaxLoc(scores)
   if best is None or val>best['correlation']:best={'scale':round(float(scale),3),'correlation':val,'xy':[x+loc[0],y+loc[1]]}
  rows.append({'video':v,'frame':index,'label':label,'channel':channel,'search_region':box,**best})
(a.out/'40-number-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')
for v in [1,2]:
 im=Image.open(a.references/f'39-v{v}-stats-reference.png')
 for label,box in [('total',(320,90,398,135)),('percent',(470,154,522,178)),('red',(310,230,375,258))]:
  im.crop(box).save(a.out/f'40-v{v}-{label}-reference.png')
print(json.dumps(rows,indent=2))
