#!/usr/bin/env python3
"""Compare measured pillar faces in native-canvas room42 captures.

Masks come only from the client's pillar alpha/colour, never a painted asset.
This verifies the sampled anchors/art, not the entire scene or damage triggers.
"""
import argparse,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('captures',type=Path)
p.add_argument('--references',type=Path,default=Path('docs/reference-evidence'))
a=p.parse_args();atlas=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'));rows=[]
cases=[('entry-flat',26.5,0,133,(360,230,49,150)),('entry-front',28,0,133,(481,327,49,150)),
       ('entry-back',28,0,133,(546,228,49,150)),('right-front',72.5,0,133,(351,305,49,150)),
       ('right-back',72.5,0,133,(444,246,49,150))]
for label,time,native_x,native_h,box in cases:
 x,y,w,h=box
 ref_file='47-room42-entry-reference.png' if time==26.5 else f'46-room42-{time}-reference.png'
 ref=np.array(Image.open(a.references/ref_file).convert('RGB'))[y:y+h,x:x+w]
 actual=np.array(Image.open(a.captures/f'{time}.png').convert('RGB'))
 native=cv2.resize(atlas[:native_h,native_x:native_x+44],(w,h))
 mask=(native[:,:,3]>220)&(native[:,:,0]>70)&(native[:,:,1]>70)&(native[:,:,2]>45)
 mask[min(80 if label=="entry-flat" else 100,h):]=False
 best={'cosine':0}
 for dy in range(-2,3):
  for dx in range(-2,3):
   patch=actual[y+dy:y+dy+h,x+120+dx:x+120+dx+w]
   av=patch[mask].astype(float).ravel();rv=ref[mask].astype(float).ravel()
   cosine=float(np.dot(av,rv)/np.sqrt(np.dot(av,av)*np.dot(rv,rv)))
   if cosine>best['cosine']:best={'cosine':cosine,'dx':dx,'dy':dy,'pixels':int(mask.sum())}
 rows.append({'label':label,'time':time,**best})
poses=json.loads((a.captures/'poses.json').read_text())
result={'pillar_faces':rows,'width':poses[0]['width'],'chests':len([p for p in poses[0]['props'] if p['piece']=='chest']),
        'limits':'Five sampled faces only; background, flowers, trees, doors, collision and pillar damage triggers remain outside this comparison.'}
(a.captures/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
camera=json.loads((a.references/'46-room42-camera.json').read_text())
span=max(c['camera_px'] for c in camera)-min(c['camera_px'] for c in camera)
assert result['width']*265/168>=720+span,'room width is below the independently observed camera bound'
assert result['chests']==2,'both observed chests must exist'
assert all(r['pixels']>1000 and r['cosine']>.97 for r in rows),'native sampled pillar faces must match the reference'
