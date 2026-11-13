#!/usr/bin/env python3
"""Measure map-window cell scale from exact720x540 raw video frames.

The grid controls deliberately exclude the panel, text and buttons: identifying
these cells does not establish the frame skin, alpha or its layout.
"""
import argparse,hashlib,json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();cv2.setNumThreads(1)
root=Path(__file__).resolve().parents[1]
asset=root/'assets/minimap.png';sheet=np.array(Image.open(asset).convert('RGBA'))
observations=[]
samples={'00001':[76,100,160,220,280],'00002':[74.25,100,150,200,277,300]}
for video,times in samples.items():
 for time in times:
  file=a.frames/f'{video}-{time}.png';raw=cv2.imread(str(file),0)
  assert raw is not None and raw.shape==(540,720),file
  controls=[('E',[252,0,18,18],[619,54] if video=='00001'else[599,115])]
  if video=='00001':controls.append(('W',[306,0,18,18],[659,95]))
  else:controls.extend([('W-top',[306,0,18,18],[680,54]),('W-bottom',[306,0,18,18],[680,115])])
  for label,(sx,sy,w,h),expected in controls:
   for scale in [1,1.125,1.25,2]:
    pic=cv2.resize(sheet[sy:sy+h,sx:sx+w],(round(w*scale),round(h*scale)))
    mask=(pic[:,:,3]>220).astype('uint8')*255
    # Small fixed control box around the predetermined cell, not a whole-map best match.
    x,y=expected;x-=3;y-=3
    roi=raw[y:y+42,x:x+42]
    z=cv2.matchTemplate(roi,cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
    z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(dx,dy)=cv2.minMaxLoc(z)
    pos=[x+dx,y+dy]
    observations.append({'video':video,'time':time,'referenceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'cell':label,'sourceRect':[sx,sy,w,h],'scale':scale,'dimensions':[pic.shape[1],pic.shape[0]],'score':score,'bitmap':pos,'expectedBitmap':expected,'pixels':int(np.count_nonzero(mask)),'accepted':score>=.94 and pos==expected})
accepted=[r for r in observations if r['accepted'] and r['scale']==1.125]
assert len(accepted)>=22
for video,times in samples.items():
 for time in times:assert any(r['video']==video and r['time']==time and r['cell']=='E'for r in accepted),(video,time)
# Preserve false shape matches at alternate scales instead of calling all controls negative.
result={'source':{'packedAsset':'assets/minimap.png','sha256':hashlib.sha256(asset.read_bytes()).hexdigest(),'nativePack':'sprite_map_minimap.NPK','nativeEntry':'sprite/map/minimap/act1.img','nativeTileSize':18,'tileIdentityProof':'107-radar-measurement.json'},'gate':{'ncc':.94,'requiresPredeterminedBitmap':True},'windowFrames':11,'acceptedNativeScaleObservations':len(accepted),'gridGeometry':{'nativeScale':1.125,'pitch':20.25,'ordinaryFirstCellCoarseBitmap':[619,54],'deepFirstColumnBottomCellCoarseBitmap':[599,115]},'observations':observations,'limits':['Cell templates locate coarse integer bitmaps; fractional runtime placement is not yet established.','Alternative-scale high scores are retained and do not alone establish geometry; compare all cells and predetermined positions.','Some W cells are covered by the blue player glyph; rejected observations remain in the report.','No panel skin, border thickness, title height, button material, counter or compositing order is proven by these cell controls.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('window frames11; accepted native-scale cell observations',len(accepted))
