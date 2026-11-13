#!/usr/bin/env python3
"""Measure the entry-room door's visible fade without inventing a clear trigger.

Input: V2 exact24.5..25.9s raw30fps, normalized720x540, files001..043.
A fixed outer-spike control registers the camera independently of the leaf.
The leaf uses347 opaque native pixels, with zero native-light-mask overlap.
Image mixture fractions are proxies, not a decoded engine-alpha clock.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,required=True)
p.add_argument('--source-out',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'assets'),str(root/'scripts')]
from import_dnf_scene import decode_at
from client_pvf import PvfArchive
from client_animation import parse_animation
cv2.setNumThreads(1)
source={}
with PvfArchive(a.client/'Script.pvf') as pvf:
 for side in ['left','right']:
  name='passiveobject/mapobject/pathgate/act1/animation/granfloris'+side+'opendoor.ani';raw=pvf.read(name);ani=parse_animation(raw,True)
  assert dict(ani['frames'][0]['props'])[12]==500
  assert dict(ani['frames'][1]['props'])[9]==[255,255,255,0]
  source[side]={'entry':name,'sha256':hashlib.sha256(raw).hexdigest(),'data':ani}
source['limits']=['The raw interpolation flag is retained, not assigned an undocumented opcode name.','The500ms source field supports the chosen duration; the recording does not establish an exact engine clock or clear-event trigger.']
a.source_out.write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
parts={}
for part,image in [('frame','sidegate02'),('door','sidedoor02'),('light','sidelight01')]:
 im,_=decode_at(a.client,'sprite_map_pathgate.NPK','sprite/map/pathgate/granfloris'+image+'.img',0)
 parts[part]=cv2.resize(np.array(im.convert('RGBA')),None,fx=1.125,fy=1.125)
x,y,w,h=130,90,12,70;control=parts['frame'][y:y+h,x:x+w];controlMask=(control[:,:,3]>220).astype('uint8')*255
leafMask=parts['door'][75:120,38:53,3]>220
lightAlpha=parts['light'][111:156,58:73,3];assert np.count_nonzero(leafMask&(lightAlpha>10))==0
rows=[];tiles=[];floorTop=92+(238-212)*1.125
for n in range(1,44):
 file=a.frames/f'{n:03d}.png';raw=cv2.imread(str(file));assert raw is not None and raw.shape[:2]==(540,720)
 gray=cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY);top=round(floorTop)+y-3
 scores=cv2.matchTemplate(gray[top:top+h+7,690:720],cv2.cvtColor(control[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=controlMask)
 scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1);_,score,_,(dx,dy)=cv2.minMaxLoc(scores)
 frameLeft=690+dx-x;frameTop=top+dy-y;leafLeft=frameLeft+round(30*1.125);leafTop=frameTop+round(48*1.125)
 tiles.append(raw[leafTop+75:leafTop+120,leafLeft+38:leafLeft+53].astype(float))
 rows.append({'time':24.5+(n-1)/30,'frameSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'controlNcc':score,'controlAccepted':score>=.94 and abs(frameTop-floorTop)<=2,'frameBitmap':[frameLeft,frameTop],'leafPatch':[leafLeft+38,leafTop+75,15,45]})
closed=np.median(np.stack(tiles[:13]),axis=0)[leafMask];opened=np.median(np.stack(tiles[36:43]),axis=0)[leafMask];difference=closed-opened
assert np.mean(np.abs(difference))>10,'the endpoint must contain substantial actual leaf contrast'
for row,tile in zip(rows,tiles):
 values=tile[leafMask];fraction=float(np.sum((values-opened)*difference)/np.sum(difference*difference))
 row.update(mixtureProxy=fraction,rgbResidual=float(np.sqrt(np.mean((values-(opened+fraction*difference))**2))))
accepted=[r for r in rows if r['controlAccepted']];times=np.array([r['time'] for r in accepted]);fractions=np.array([r['mixtureProxy']for r in accepted]);models=[]
for duration in [0,.3,.4,.5,.6,.7]:
 fits=[]
 for start in np.arange(25,25.501,.001):
  predicted=(times<start).astype(float) if duration==0 else np.clip(1-(times-start)/duration,0,1)
  fits.append((float(np.mean(abs(predicted-fractions))),float(start),float(np.sqrt(np.mean((predicted-fractions)**2)))))
 error,start,rmse=min(fits);models.append({'duration':duration,'start':start,'meanAbsoluteProxyError':error,'proxyRmse':rmse})
native=next(m for m in models if m['duration']==.5);instant=models[0]
assert native['meanAbsoluteProxyError']<instant['meanAbsoluteProxyError']/2,'gradual fade must beat immediate disappearance with the same accepted samples'
result={'nativeSource':a.source_out.name,'normalization':'exact raw30fps, crop1440:1080:240:0 scale720:540; no fps resampling','controlPatchAfterFullResize':[130,90,12,70],'leafPatchAfterFullResize':[38,75,15,45],'nativeOpaqueLeafPixels':int(leafMask.sum()),'nativeLightMaskOverlapPixels':0,'closedEndpointTimes':[24.5,24.9],'openEndpointTimes':[25.7,25.9],'controlGate':{'ncc':.94,'verticalResidualPx':2},'acceptedControls':len(accepted),'observations':rows,'candidateModels':models,'adoptedDurationSeconds':.5,'limits':['Endpoint mixture fractions are image regressions, not measured engine alpha. Effects, sampling phase and background changes remain confounders; all control rejections and RGB residuals are retained.','The native500ms model beats instant disappearance, but600ms fits slightly better here; this does not resolve the exact native clock.','The fitted visual start is not a measured enemy-death or room-clear event.','Native light trigger/clock, hit-stop behavior and uncleared entry passability remain unverified.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('controls',len(accepted),'leaf pixels',int(leafMask.sum()),'models',models)
