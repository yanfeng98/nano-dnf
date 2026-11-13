#!/usr/bin/env python3
"""Fit the native radar's radial brown material and retain holdout controls.

Input exact raw720x540 reference frames, named00001-60.png etc.
The fit uses V2 15.5s empty-disc regions. Other times and V1 are holdouts.
Only texture placement/size are fitted; no colour curve or mask tuning.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'));from import_dnf_scene import decode_at
cv2.setNumThreads(1);atlas,_=decode_at(a.client,'sprite_map_minimap.NPK','sprite/map/minimap/minimap.img',0);atlas=np.array(atlas.convert('RGBA'));bg=atlas[:74,350:424,:3];ring=atlas[28:132,549:653]
packed=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));assert np.array_equal(atlas[:74,350:424],packed[18:92,307:381])
fitRois=[[615,75,18,25],[636,108,32,14],[620,102,14,14],[626,59,8,14]]
def samples(boxes):
 xs=[];ys=[]
 for x,y,w,h in boxes:
  yy,xx=np.mgrid[y:y+h,x:x+w];xs.extend(xx.ravel());ys.extend(yy.ravel())
 return np.array(xs,dtype='float32'),np.array(ys,dtype='float32')
def field(xs,ys,size,cx,cy):
 mx=((xs+.5-594)/1.125-.5).reshape(1,-1).astype('float32');my=((ys+.5-23.5)/1.125-.5).reshape(1,-1).astype('float32');r=cv2.remap(ring,mx,my,cv2.INTER_LINEAR)[0].astype(float);alpha=r[:,3:4]/255
 mx=((xs+.5-(cx-size/2))*74/size-.5).reshape(1,-1).astype('float32');my=((ys+.5-(cy-size/2))*74/size-.5).reshape(1,-1).astype('float32');b=cv2.remap(bg,mx,my,cv2.INTER_LINEAR)[0].astype(float)
 return r[:,:3]*alpha+b*(1-alpha),r[:,:3]*alpha+np.array([32,52,10])*(1-alpha)
xs,ys=samples(fitRois);ref=np.array(Image.open(a.frames/'00002-15.5.png').convert('RGB'))[ys.astype(int),xs.astype(int)].astype(float);fits=[]
for size in np.arange(76,116,1):
 for cx in np.arange(653,658.1,.5):
  for cy in np.arange(78,83.1,.5):
   image,_=field(xs,ys,float(size),float(cx),float(cy));fits.append((float(np.mean(abs(image-ref))),float(size),float(cx),float(cy)))
fits.sort();adopted=[92,656,81.5];observations=[]
controls=[('00002',15.5,fitRois,'fit'),('00002',25.5,fitRois,'holdout')]+[('00001',t,[[636,114,32,10]],'holdout')for t in [60,74]]+[('00002',t,[[636,108,32,14]],'holdout')for t in [40,60,72.5]]
for video,time,boxes,kind in controls:
 xs,ys=samples(boxes);image,old=field(xs,ys,*adopted);file=a.frames/f'{video}-{time}.png';ref=np.array(Image.open(file).convert('RGB'))[ys.astype(int),xs.astype(int)].astype(float)
 observations.append({'video':video,'time':time,'kind':kind,'rois':boxes,'pixels':len(xs),'referenceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'nativeBackgroundRgbMae':float(np.mean(abs(image-ref))),'legacyGreenRgbMae':float(np.mean(abs(old-ref)))})
assert all(r['nativeBackgroundRgbMae']<r['legacyGreenRgbMae']for r in observations)
result={'source':{'pack':'sprite_map_minimap.NPK','entry':'sprite/map/minimap/minimap.img','nativeRect':[350,0,74,74],'packedRect':[307,18,74,74],'rgbaSha256':hashlib.sha256(atlas[:74,350:424].tobytes()).hexdigest(),'nativeCropIdenticalToPackedAsset':True},'frameModel':[594,23.5,117,117],'fit':{'reference':['00002',15.5],'rois':fitRois,'sizeSearch':[76,115,1],'centreXSearch':[653,658,.5],'centreYSearch':[78,83,.5],'top10':[{'rgbMae':r[0],'size':r[1],'centre':[r[2],r[3]]}for r in fits[:10]]},'adopted':{'screenBox':[610,35.5,92,92],'fitRgbMae':observations[0]['nativeBackgroundRgbMae']},'observations':observations,'limits':['The radial material is a native bitmap, not a sampled replacement colour.','Neighboring size/centre fits have very similar residuals; the adopted near-optimal box does not establish an exact engine-authored rectangle.','Ring composition is modeled with bilinear sampling; source compression, subpixel sampling and unverified clip geometry remain residuals.','Counter, blue button and full-window skin/layout remain unverified.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('best',fits[0],'controls',[(r['video'],r['time'],round(r['nativeBackgroundRgbMae'],3),round(r['legacyGreenRgbMae'],3))for r in observations])
