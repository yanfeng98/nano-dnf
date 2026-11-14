#!/usr/bin/env python3
"""Check a fixed exposed bottom strip against the existing native radial material.
No new pose or colour fit is performed; the model is the batch107 radar model.
Alpha audit114 establishes that this ROI is fully opaque rim, so it cannot test
the radial background. Retained to reproduce and correct the earlier experiment.
"""
import argparse,hashlib,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();cv2.setNumThreads(1)
root=Path(__file__).resolve().parents[1];atlas=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));bg=atlas[18:92,307:381,:3];ring=atlas[18:122,82:186].astype('float32');ring[:,:,:3]*=ring[:,:,3:4]/255
roi=[636,122,32,4];x,y,w,h=roi;yy,xx=np.mgrid[y:y+h,x:x+w]
r=cv2.remap(ring,((xx+.5-594)/1.125-.5).astype('float32'),((yy+.5-23.5)/1.125-.5).astype('float32'),cv2.INTER_LINEAR);alpha=r[:,:,3:4]/255
b=cv2.remap(bg,((xx+.5-610)*74/92-.5).astype('float32'),((yy+.5-35.5)*74/92-.5).astype('float32'),cv2.INTER_LINEAR).astype(float);model=r[:,:,:3]+b*(1-alpha);rows=[]
for t in [76,100,160,220,280]:
 f=a.frames/f'00001-{t}.png';raw=np.array(Image.open(f).convert('RGB'))[y:y+h,x:x+w].astype(float)
 rows.append({'time':t,'referenceSha256':hashlib.sha256(f.read_bytes()).hexdigest(),'pixels':w*h,'nativeBackgroundRgbMae':float(np.mean(abs(model-raw))),'referenceMeanRgb':raw.mean(axis=(0,1)).tolist()})
assert np.all(alpha==1), 'the historical ROI must remain opaque for this interpretation'
result={'backgroundIdentifiable':False,'effectiveBackgroundWeight':float(np.sum(1-alpha)),'interpretation':'ROI is fully opaque rim; its error cannot constrain background or establish a shadow.', 'source':'existing native radial material and ring; identities verified in107','roi':roi,'backgroundBox':[610,35.5,92,92],'ringBox':[594,23.5,117,117],'observations':rows,'limits':['This ROI has zero background contribution under the verified ring model. Do not fit background or shadow from its RGB residual.','No new fitting; original background placement is approximate and retains107 limits.']};a.out.write_text(json.dumps(result,indent=2)+'\n');print([(r['time'],round(r['nativeBackgroundRgbMae'],4),r['referenceMeanRgb'])for r in rows])
