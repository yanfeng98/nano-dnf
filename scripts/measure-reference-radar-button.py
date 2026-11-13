#!/usr/bin/env python3
"""Identify the native magnifier with a fixed lower strip below the video FPS.

Input exact720x540 frames named00001-60.png etc (batch107 sampling).
Fit only V2 15.5s; all other clear frames use the same pose without refitting.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,required=True);a=p.parse_args()
cv2.setNumThreads(1);root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'));from import_dnf_scene import decode_at
atlas,_=decode_at(a.client,'sprite_map_minimap.NPK','sprite/map/minimap/minimap.img',0);atlas=np.array(atlas.convert('RGBA'));packed=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));assert np.array_equal(atlas[245:269,268:292],packed[18:42,589:613])
yy,xx=np.mgrid[40:56,676:712];rects={'first':[268,245,24,24],'third':[327,244,24,24]}
def compare(raw,part,scale,x,y):
 sx,sy,w,h=rects[part];src=atlas[sy:sy+h,sx:sx+w].astype('float32');src[:,:,:3]*=src[:,:,3:4]/255
 mx=((xx+.5-x)/scale-.5).astype('float32');my=((yy+.5-y)/scale-.5).astype('float32');v=cv2.remap(src,mx,my,cv2.INTER_LINEAR);mask=v[:,:,3]>220
 rgb=v[:,:,:3][mask]/(v[:,:,3:4][mask]/255);ref=raw[yy,xx][mask];gray=lambda p:cv2.cvtColor(p.reshape(1,-1,3).astype('float32'),cv2.COLOR_RGB2GRAY).ravel()
 return {'ncc':float(np.corrcoef(gray(rgb),gray(ref))[0,1]),'pixels':int(mask.sum())}
def frame(video,time):
 f=a.frames/f'{video}-{time}.png';return np.array(Image.open(f).convert('RGB')).astype(float),hashlib.sha256(f.read_bytes()).hexdigest()
raw,_=frame('00002',15.5);fits=[]
for part in rects:
 for scale in [1,1.125,1.25]:
  for x in np.arange(677,683.1,.25):
   for y in np.arange(25,30.1,.25):
    r=compare(raw,part,scale,float(x),float(y))
    if r['pixels']>=80:fits.append({'part':part,'scale':scale,'x':float(x),'y':float(y),**r})
fits.sort(key=lambda r:-r['ncc']);assert fits[0]['part']=='first' and fits[0]['scale']==1.125 and fits[0]['x']==680.5 and fits[0]['y']==25.75
controls=[max((r for r in fits if r['part']==part and r['scale']==scale),key=lambda r:r['ncc'])for part in rects for scale in [1,1.125,1.25]]
rows=[]
for video,time in [('00001',60),('00001',74)]+[('00002',t)for t in [10.5,15.5,25.5,40,60,72.5]]:
 raw,sha=frame(video,time);positive=not(video=='00002' and time==72.5);r=compare(raw,'first',1.125,680.5,25.75)
 rows.append({'video':video,'time':time,'referenceSha256':sha,'clearSample':positive,**r})
assert all(r['ncc']>=.94 for r in rows if r['clearSample']);assert rows[-1]['ncc']<.94
result={'source':{'pack':'sprite_map_minimap.NPK','entry':'sprite/map/minimap/minimap.img','nativeRect':rects['first'],'packedRect':[589,18,24,24],'nativeRgbaEqualPacked':True,'rgbaSha256':hashlib.sha256(atlas[245:269,268:292].tobytes()).hexdigest()},'fixedVisibleRoi':[676,40,36,16],'fit':{'frame':['00002',15.5],'partCandidates':rects,'scales':[1,1.125,1.25],'xSearch':[677,683,.25],'ySearch':[25,30,.25],'bestByPartAndScale':controls,'top15':fits[:15]},'adopted':{'screenBox':[680.5,25.75,27,27],'nativeScale':1.125},'gate':{'ncc':.94},'observations':rows,'limits':['Only the fixed lower strip below FPS is verified; the upper composite is occluded.','72.5s increment flash is retained as an occluded negative control, not a material mismatch.','No hover/pressed-state meaning is assigned to the alternative native variants; their engine states remain unknown.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('clear frames7; minimumNCC',min(r['ncc']for r in rows if r['clearSample']),'flash',rows[-1]['ncc'])
