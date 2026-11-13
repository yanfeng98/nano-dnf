#!/usr/bin/env python3
"""Measure native radar frame, tile pitch and player glyph in both recordings.

Inputs are exact raw frames, normalized720x540, named00001-60.png etc.
Keep rejected controls and competing scales. The lower ring half avoids the
separate top badge/FPS/button overlays; it does not validate the whole skin.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'));from import_dnf_scene import decode_at
cv2.setNumThreads(1);atlas,offset=decode_at(a.client,'sprite_map_minimap.NPK','sprite/map/minimap/minimap.img',0);atlas=np.array(atlas.convert('RGBA'));packed=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'))
ring=atlas[28:132,549:653];marker=atlas[44:63,272:286];tile,_=decode_at(a.client,'sprite_map_minimap.NPK','sprite/map/minimap/act1.img',0);tile=np.array(tile.convert('RGBA'))
cutChecks={}
for name,native,existing in [('ring',ring,packed[18:122,82:186]),('marker',marker,packed[18:37,64:78])]:
 opaque=(native[:,:,3]>220)|(existing[:,:,3]>220);assert np.array_equal(native[opaque],existing[opaque])
 different=np.any(native!=existing,axis=2);maxAlpha=int(max(native[:,:,3][different].max(initial=0),existing[:,:,3][different].max(initial=0)));assert maxAlpha<=4
 cutChecks[name]={'differingPixels':int(different.sum()),'maximumAlphaInDifferences':maxAlpha,'opaquePixelsIdentical':True,'nativeRgbaSha256':hashlib.sha256(native.tobytes()).hexdigest(),'packedRgbaSha256':hashlib.sha256(existing.tobytes()).hexdigest()}
assert np.array_equal(tile,packed[:18,252:270])
radar=[('00001',60),('00001',74)]+[('00002',t)for t in [10.5,15.5,25.5,40,60,72.5]]
negative=[('00001',20),('00001',40),('00001',76),('00002',74.25),('00002',277)]
rows=[]
def match(raw,pic,mask,roi):
 x,y,w,h=roi;z=cv2.matchTemplate(raw[y:y+h,x:x+w],cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask);z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,v,_,(dx,dy)=cv2.minMaxLoc(z);return v,[dx+x,dy+y]
for video,time in radar+negative:
 file=a.frames/f'{video}-{time}.png';raw=cv2.imread(str(file),0);assert raw is not None
 isRadar=(video,time)in radar
 for scale in [1,1.125]:
  im=cv2.resize(ring,None,fx=scale,fy=scale);top=round(54*scale);pic=im[top:];mask=(pic[:,:,3]>220).astype('uint8')*255
  score,pos=match(raw,pic,mask,[560,0,160,165]);pos[1]-=top
  rows.append({'part':'ring','video':video,'time':time,'referenceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'radarSample':isRadar,'scale':scale,'fixedVisiblePatchAfterResize':[0,top,im.shape[1],im.shape[0]-top],'score':score,'bitmap':pos,'pixels':int(np.count_nonzero(mask)),'accepted':score>=.94 and pos==[594,24]})
 if not isRadar:continue
 for scale in [1,1.125,2,2.25]:
  im=cv2.resize(marker,(round(marker.shape[1]*scale),round(marker.shape[0]*scale)));mask=(im[:,:,3]>220).astype('uint8')*255;score,pos=match(raw,im,mask,[620,50,70,65])
  rows.append({'part':'marker','video':video,'time':time,'scale':scale,'score':score,'bitmap':pos,'pixels':int(np.count_nonzero(mask)),'accepted':score>=.94 and pos==[649,70] and scale==1.125})
 if video=='00002' and time in [10.5,15.5,25.5]:
  # The source E-room directly above the entry has no player glyph over it.
  for scale in [1,1.125,2,2.25]:
   im=cv2.resize(tile,None,fx=scale,fy=scale);mask=(im[:,:,3]>220).astype('uint8')*255;score,pos=match(raw,im,mask,[630,40,65,70])
   rows.append({'part':'neighborTile','video':video,'time':time,'scale':scale,'score':score,'bitmap':pos,'pixels':int(np.count_nonzero(mask)),'accepted':score>=.94 and pos==[646,51]})
ringPass=[r for r in rows if r['part']=='ring' and r['radarSample'] and r['scale']==1.125 and r['accepted']]
assert len(ringPass)==8;assert all(not r['accepted']for r in rows if r['part']=='ring' and not r['radarSample'])
assert any(r['accepted']for r in rows if r['part']=='marker');assert any(r['accepted']for r in rows if r['part']=='neighborTile')
# Calibrate the10.5s black curtain from two HUD regions outside the radar.
dim=np.array(Image.open(a.frames/'00002-10.5.png').convert('RGB')).astype(float)
bright=np.array(Image.open(a.frames/'00002-15.5.png').convert('RGB')).astype(float)
fadeControls=[]
for label,box in [('stageTitle',[590,3,110,14]),('hpBorder',[3,465,12,55])]:
 x,y,w,h=box;f=bright[y:y+h,x:x+w];d=dim[y:y+h,x:x+w];m=(f[:,:,0]>140)&(f[:,:,1]>100)&(f[:,:,2]<170)
 F=f[m];D=d[m];ratio=float(np.sum(F*D)/np.sum(F*F));fadeControls.append({'label':label,'roi':box,'goldPixels':int(m.sum()),'blackOpacity':1-ratio,'rgbResidual':float(np.sqrt(np.mean((D-F*ratio)**2)))})
assert abs(fadeControls[0]['blackOpacity']-fadeControls[1]['blackOpacity'])<.03
entryFade={'time':10.5,'fullBrightnessReference':15.5,'controls':fadeControls,'adoptedBlackOpacity':float(np.mean([r['blackOpacity']for r in fadeControls])),'limits':'State alignment for geometry comparison only; no native transition start/duration is inferred. The radar itself is not used to estimate this opacity.'}
result={'source':{'pack':'sprite_map_minimap.NPK','atlas':'sprite/map/minimap/minimap.img','atlasSize':list(atlas.shape[1::-1]),'atlasOffset':list(offset),'ringRect':[549,28,104,104],'markerRect':[272,44,14,19],'tileEntry':'sprite/map/minimap/act1.img','tileFrame':0,'packedAsset':'assets/minimap.png','packedAssetSha256':hashlib.sha256((root/'assets/minimap.png').read_bytes()).hexdigest(),'nativeOpaqueCutsIdenticalToPackedAsset':True,'rgbaCutChecks':cutChecks},'gate':{'texture':.94,'requiredBitmapForRing':[594,24]},'entryFade':entryFade,'ringCoverage':{'accepted':8,'observedRadarFrames':8,'negativeFrames':5},'observations':rows,'adopted':{'ringScale':1.125,'ringBitmap':[594,23.5,117,117],'contentCentre':[656,81],'tileScale':1.125,'tilePitch':20.25,'playerBitmap':[649.25,69.75,16,21],'playerScale':1.125,'playerPivot':[6,10]},'limits':['Only the fixed lower ring half is identified against the video; badge/FPS/button occlusions do not validate the whole radar skin.','Marker candidates use explicitly rounded destination dimensions, matching drawMinimapPiece; fractional-factor resize is not equivalent for this small glyph. Rejected scale controls are retained.','Tile identity checks the E-room above the current entry, not a fabricated alternate map.','Integer template search locates the coarse frame at594,24; retained browser integer/fractional controls refine its runtime top to23.5. Native background material is independently verified in107-radar-background-measurement.json; exact background placement, counter semantics, blue button, full-window geometry and edge clipping remain open.','The atlas white point is present in the recording and is not removed. The regenerated packed cuts preserve native RGBA; prior packed differences affected six ring pixels and one marker pixel with alpha no greater than4.']}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('ring',len(ringPass),'marker',sum(r['part']=='marker'and r['accepted']for r in rows),'tiles',sum(r['part']=='neighborTile'and r['accepted']for r in rows))
