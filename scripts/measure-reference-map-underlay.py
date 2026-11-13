#!/usr/bin/env python3
"""Check the unchanged native radar rim outside the full window in V1."""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();cv2.setNumThreads(1)
root=Path(__file__).resolve().parents[1];atlas=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));src=atlas[18:122,82:186].astype('float32');src[:,:,:3]*=src[:,:,3:4]/255
rows=[]
for time in [76,100,160,220,280]:
 f=a.frames/f'00001-{time}.png';raw=np.array(Image.open(f).convert('RGB')).astype(float)
 for name,(x,y,w,h)in [('left',(594,55,18,63)),('bottom',(620,122,70,12))]:
  yy,xx=np.mgrid[y:y+h,x:x+w];v=cv2.remap(src,((xx+.5-594)/1.125-.5).astype('float32'),((yy+.5-23.5)/1.125-.5).astype('float32'),cv2.INTER_LINEAR);m=v[:,:,3]>220
  rgb=v[:,:,:3][m]/(v[:,:,3:4][m]/255);r=raw[yy,xx][m];gray=lambda p:cv2.cvtColor(p.reshape(1,-1,3).astype('float32'),cv2.COLOR_RGB2GRAY).ravel();score=float(np.corrcoef(gray(rgb),gray(r))[0,1]);rows.append({'time':time,'part':name,'roi':[x,y,w,h],'pixels':int(m.sum()),'ncc':score,'referenceSha256':hashlib.sha256(f.read_bytes()).hexdigest()})
assert all(r['ncc']>=.94 and r['pixels']>=250 for r in rows)
r={'source':'existing native ring at packed82,18,104,104; native identity established in107','model':[594,23.5,117,117],'observations':rows,'limits':['Only exposed rim portions outside the ordinary window are checked.','This does not establish underlying map-content centre, full-window skin, opacity or switching animation.']};a.out.write_text(json.dumps(r,indent=2)+'\n');print([(x['time'],x['part'],round(x['ncc'],5),x['pixels'])for x in rows])
