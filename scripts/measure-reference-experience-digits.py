#!/usr/bin/env python3
"""Check native XP glyphs in three observed float-text regions.

Only glyph-local correlations are measured. This is not a whole-caption match,
a font search, an XP payout formula or proof of the suffix/plus layout.
"""
import argparse,hashlib,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--out',type=Path,default=ROOT/'docs/reference-evidence/123-experience-digits-reference.json')
a=p.parse_args();cv2.setNumThreads(1)
atlas=np.array(Image.open(ROOT/'assets/experience-digits.png').convert('RGBA'))
proof=json.loads((ROOT/'docs/reference-evidence/123-experience-digits-source.json').read_text())
profiles=[('110-00001-71.3-counter-event.png',(385,216,445,245),[8,0]),
 ('121-v2-15.8-entry-xp.png',(385,117,442,145),[5,0]),
 ('121-v1-73.6-entry-xp.png',(340,194,405,225),[4,0])]
rows=[]
for name,box,digits in profiles:
 path=ROOT/'docs/reference-evidence'/name
 ref=cv2.imread(str(path)).astype('float32');x,y,x1,y1=box;roi=ref[y:y1,x:x1]
 for digit in digits:
  sx,sy,w,h=proof['glyphs'][digit]['rect'];source=atlas[sy:sy+h,sx:sx+w]
  im=cv2.resize(source,None,fx=1.125,fy=1.125)
  mask=(im[:,:,3]>200).astype('uint8')*255
  scores=cv2.matchTemplate(roi,im[:,:,:3][:,:,::-1].astype('float32'),cv2.TM_CCORR_NORMED,mask=mask)
  scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
  _,score,_,(left,top)=cv2.minMaxLoc(scores)
  assert score>.86,(name,digit,score)
  rows.append(dict(frame=name,frameSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
   digit=digit,sourceFrame=digit,scale=1.125,searchBox=list(box),
   screenRect=[x+left,y+top,im.shape[1],im.shape[0]],correlation=score))
report=dict(samples=rows,limits=['Known float-text ROIs only; transparent pixels are excluded, native dark outline is retained.',
 'Only the observed 0/4/5/8 glyphs are tested. Other numerals share the native run but have no independent sample here.',
 'Correlations do not establish exact raster phase, kerning, English suffix, plus visibility, motion or amount rules.'])
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
print('XP glyph correlations',[round(r['correlation'],6) for r in rows])
