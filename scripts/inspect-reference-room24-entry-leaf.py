#!/usr/bin/env python3
"""Reproduce the entry-leaf discrepancy and check its one-second persistence.

References are normalized720x540 raw video frames277..278s, every3 raw30fps
frames. Actual #stage screenshots include120px side margins at960x540;
normalize that viewport explicitly before comparing the same game region.
--require-match exits1 when the current rendered leaf does not match.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True);p.add_argument('--renders',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,required=True);p.add_argument('--require-match',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'assets'))
from import_dnf_scene import decode_at
cv2.setNumThreads(1)
im,_=decode_at(a.client,'sprite_map_pathgate.NPK','sprite/map/pathgate/granflorissidedoor02.img',0)
native=cv2.resize(np.array(im.convert('RGBA')),None,fx=1.125,fy=1.125)[65:140]
mask=(native[:,:,3]>220).astype('uint8')*255;texture=cv2.cvtColor(native[:,:,:3],cv2.COLOR_RGB2GRAY)
def observe(file):
 raw=cv2.imread(str(file));assert raw is not None
 shape=list(raw.shape[:2]);crop=[120,0,720,540] if shape==[540,960] else [0,0,720,540]
 assert shape in [[540,960],[540,720]],shape
 x,y,w,h=crop;raw=raw[y:y+h,x:x+w];gray=cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY)
 # One fixed small search region, identical for normalized reference and runtime.
 z=cv2.matchTemplate(gray[264:349,4:70],texture,cv2.TM_CCOEFF_NORMED,mask=mask)
 z=np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1);_,score,_,(x,y)=cv2.minMaxLoc(z);x+=4;y+=264
 return {'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'inputHeightWidth':shape,'viewportCrop':crop,'nativeNcc':score,'matchedPatch':[x,y,56,75],'passesNativeIdentity':score>=.94},gray[y:y+75,x:x+56],raw
rows=[];tiles=[]
for n in range(11):
 record,patch,raw=observe(a.frames/f'{n+1:03d}.png');record['time']=round(277+n/10,1);rows.append(record);tiles.append(patch)
master=tiles[-1].astype(float).ravel()
for r,tile in zip(rows,tiles):
 values=tile.astype(float).ravel();r['temporalNccAgainst278']=float(np.corrcoef(master,values)[0,1]);r['temporalContrastSlope']=float(np.dot(master-master.mean(),values-values.mean())/np.dot(master-master.mean(),master-master.mean()))
actual,_,raw=observe(a.renders/'278.png')
assert rows[-1]['passesNativeIdentity'],'native door identity must be established in the reference'
assert min(r['temporalNccAgainst278'] for r in rows)>=.97,'the claimed persistence must survive the full fixed one-second series'
result={'nativeSource':'103-room24-west-gate-source.json','nativePatchAfterFullResize':[0,65,56,75],'nativeIdentityGate':.94,'referenceTemporalGate':.97,'referenceObservations':rows,'runtime278':actual,'minimumTemporalNcc':min(r['temporalNccAgainst278'] for r in rows),'minimumTemporalContrastSlope':min(r['temporalContrastSlope'] for r in rows),'maximumTemporalContrastSlope':max(r['temporalContrastSlope'] for r in rows),'limits':['Native identity passes at278s; earlier native comparisons below.94 are retained, not called native-identity matches.','The already-identified leaf patch persists across277..278s; this contradicts only an immediate500ms entry fade in that interval. It does not establish the opening trigger or general fade law.','Temporal contrast slope is an image regression, not an alpha estimate; scene fade, compression and subpixel sampling remain confounders.','Visible bars and this diagnostic do not establish passability, so no travel rule is changed.',('The runtime leaf identity now matches; opening/light clocks and passability remain unverified.' if actual['passesNativeIdentity'] else 'The runtime leaf-state discrepancy remains intentionally unresolved.')]}
a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('reference native',round(rows[-1]['nativeNcc'],6),'runtime native',round(actual['nativeNcc'],6),'temporal min',round(result['minimumTemporalNcc'],6))
if a.require_match and not actual['passesNativeIdentity']:raise SystemExit('entry leaf mismatch: the current runtime does not show the reference leaf')
