#!/usr/bin/env python3
"""Verify native bag-counter art and a shared subpixel model against both videos.

Input exact720x540 frames named00001-60.png etc, as in batch107.
Only the fixed lower digit strip is measured because FPS overlays its top.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,required=True);a=p.parse_args()
cv2.setNumThreads(1);root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'));from import_dnf_scene import decode_at
atlas,_=decode_at(a.client,'sprite_map_minimap.NPK','sprite/map/minimap/minimap.img',0);atlas=np.array(atlas.convert('RGBA'));packed=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'))
xs=[263,282,298,319,339,360,385,407,426,446];widths=[11,7,11,11,11,11,11,11,11,11];packedXs=[443,458,469,484,499,514,529,544,559,574];cuts=[]
for name,(sx,sy,w,h),(px,py)in [('bag',(277,115,54,23),(385,18))]+[(str(d),(xs[d],154,widths[d],13),(packedXs[d],18))for d in range(10)]:
 raw=atlas[sy:sy+h,sx:sx+w];assert np.array_equal(raw,packed[py:py+h,px:px+w]);cuts.append({'name':name,'nativeRect':[sx,sy,w,h],'packedRect':[px,py,w,h],'rgbaSha256':hashlib.sha256(raw.tobytes()).hexdigest()})
def model(rect,box,x,y,scale=1.125):
 sx,sy,w,h=rect;bx,by,bw,bh=box;yy,xx=np.mgrid[by:by+bh,bx:bx+bw];src=atlas[sy:sy+h,sx:sx+w].astype('float32');src[:,:,:3]*=src[:,:,3:4]/255
 mx=((xx+.5-x)/scale-.5).astype('float32');my=((yy+.5-y)/scale-.5).astype('float32');pic=cv2.remap(src,mx,my,cv2.INTER_LINEAR);mask=pic[:,:,3]>220;rgb=pic[:,:,:3][mask]/(pic[:,:,3:4][mask]/255)
 return rgb,mask
def compare(raw,rect,box,x,y):
 rgb,mask=model(rect,box,x,y);bx,by,w,h=box;r=raw[by:by+h,bx:bx+w][mask];g=lambda p:cv2.cvtColor(p.reshape(1,-1,3).astype('float32'),cv2.COLOR_RGB2GRAY).ravel()
 return {'ncc':float(np.corrcoef(g(rgb),g(r))[0,1]),'pixels':int(mask.sum())}
rows=[]
for video,time,text in [('00001',60,'0'),('00001',74,'4'),('00002',10.5,'0'),('00002',15.5,'0'),('00002',25.5,'7'),('00002',40,'8'),('00002',60,'14')]:
 file=a.frames/f'{video}-{time}.png';raw=np.array(Image.open(file).convert('RGB')).astype(float)
 rows.append({'video':video,'time':time,'part':'bag','referenceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),**compare(raw,(277,115,54,23),(589,25,32,31),591.75,27)})
 x=645.625-(sum(widths[int(d)]for d in text)+len(text)-1)*1.125
 for digit in map(int,text):
  box=(int(x)-1,38,round(widths[digit]*1.125)+3,11)
  rows.append({'video':video,'time':time,'part':'digit-lower','digit':digit,'position':[x,32.5],'roi':list(box),**compare(raw,(xs[digit],154,widths[digit],13),box,x,32.5)})
  x+=(widths[digit]+1)*1.125
assert all(r['ncc']>=.94 for r in rows),rows
result={'source':{'pack':'sprite_map_minimap.NPK','entry':'sprite/map/minimap/minimap.img','nativeCutsEqualPackedAsset':True,'cuts':cuts},'model':{'scale':1.125,'bagPosition':[591.75,27],'digitRight':645.625,'digitTop':32.5,'nativeDigitGap':1,'fixedDigitVisibleRows':[38,49],'fitFrame':['00002',15.5],'holdouts':'other frames; no per-frame pose fit'},'gate':{'ncc':.94},'observations':rows,'limits':['FPS occludes the upper digits; this fixed lower strip does not prove the upper glyph composite.','Pixel matching establishes art/position, not counter semantics or native event timing.','Counter flashes and the blue map button are not identified or implemented here.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('native cuts11; video component observations',len(rows),'minimum NCC',min(r['ncc']for r in rows))
