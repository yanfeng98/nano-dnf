#!/usr/bin/env python3
"""Separate fixed-model residuals by row and native ring alpha.
A fitted black overlay is an exploratory control, not an identified engine layer.
"""
import argparse,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--radar-frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();cv2.setNumThreads(1)
root=Path(__file__).resolve().parents[1];atlas=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));bg=atlas[18:92,307:381,:3];ring=atlas[18:122,82:186].astype('float32');ring[:,:,:3]*=ring[:,:,3:4]/255
xx,yy=np.meshgrid(np.arange(636,668),np.arange(114,128));r=cv2.remap(ring,((xx+.5-594)/1.125-.5).astype('float32'),((yy+.5-23.5)/1.125-.5).astype('float32'),cv2.INTER_LINEAR);alpha=r[:,:,3:4]/255
b=cv2.remap(bg,((xx+.5-610)*74/92-.5).astype('float32'),((yy+.5-35.5)*74/92-.5).astype('float32'),cv2.INTER_LINEAR).astype(float);model=r[:,:,:3]+b*(1-alpha)
fit=np.array(Image.open(a.frames/'00001-76.png').convert('RGB'))[114:128,636:668].astype(float);ratios=np.clip(np.sum(model*fit,axis=(1,2))/np.sum(model*model,axis=(1,2)),0,1)
rows=[]
for kind,folder,times in [('window',a.frames,[76,100,160,220,280]),('radar-control',a.radar_frames,[60,74])]:
 for t in times:
  raw=np.array(Image.open(folder/f'00001-{t}.png').convert('RGB'))[114:128,636:668].astype(float)
  for i,y in enumerate(range(114,128)):
   row={'mode':kind,'time':t,'y':y,'pixels':32,'ringAlphaMean':float(alpha[i].mean()),'nativeModelRgbMae':float(np.mean(abs(model[i]-raw[i]))),'fitBlackOpacity':float(1-ratios[i]),'fixedShadowModelRgbMae':float(np.mean(abs(model[i]*ratios[i]-raw[i])))}
   for name,mask in [('opaque',alpha[i,:,0]>.86),('translucent',alpha[i,:,0]<=.86)]:
    row[name]={'pixels':int(mask.sum()),'rgbMae':float(np.mean(abs(model[i][mask]-raw[i][mask])))if mask.any()else None}
   rows.append(row)
result={'roi':[636,114,32,14],'fitFrame':['00001',76],'rowOpacityFitScope':'one scalar black overlay per row fitted once; no held-out refit','observations':rows,'limits':['Lower residual after fitting does not identify a shadow layer or justify runtime recolouring.','Rows114..120 intersect the full-window panel; they cannot identify exposed background.','The original radial background rectangle remains approximate; translucent pixels depend on unverified underlying layers.']};a.out.write_text(json.dumps(result,indent=2)+'\n')
for y in [120,122,124,126]:
 rr=[r for r in rows if r['mode']=='window' and r['y']==y];cc=[r for r in rows if r['mode']=='radar-control' and r['y']==y];print(y,'alpha',rr[0]['ringAlphaMean'],'window',sum(x['nativeModelRgbMae']for x in rr)/5,'fit',sum(x['fixedShadowModelRgbMae']for x in rr)/5,'radar',sum(x['nativeModelRgbMae']for x in cc)/2,'fit',sum(x['fixedShadowModelRgbMae']for x in cc)/2)
