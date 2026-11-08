#!/usr/bin/env python3
"""Extract visible result point/percent distinctions, without inferring inputs."""
import argparse,json
from pathlib import Path
from PIL import Image
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--references',type=Path,default=Path('docs/reference-evidence'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-score44'))
p.add_argument('--atlas',type=Path,default=Path('assets/results-reference.png'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);rows=[]
for v,hits,total in [(1,15,85),(2,23,77)]:
 im=Image.open(a.references/f'39-v{v}-stats-reference.png')
 for kind,box in [('full-total',(320,90,520,135)),('operation-points',(320,147,375,177)),('technique-points',(320,185,375,215))]:
  im.crop(box).save(a.out/f'44-v{v}-{kind}-reference.png')
 assert 60+40-hits==total
 rows.append({'video':v,'source_reference':f'39-v{v}-stats-reference.png','operation_points':60,
  'technique_points':40,'operation_percent':85,'technique_percent':57,'hits':hits,'total':total,'maximum':140,
  'interpretation':'Visible points sum minus one per hit explains both totals. A shared 70-point component maximum is consistent with both truncated percentages and the 140-point total.',
  'limits':'Only the two final outcomes are verified. Hidden inputs, other point values, percent rounding and grade thresholds remain unverified; do not call the full scoring algorithm restored.'})
(a.out/'44-score-parts-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')

# Fixed-scale denominator fits explain the revised full-total spacing.
atlas=np.array(Image.open(a.atlas).convert('RGBA'));fits=[]
for v in [1,2]:
 ref=np.array(Image.open(a.references/f'39-v{v}-stats-reference.png').convert('RGB'))[:,:,0].astype('float32')
 for char,x,w,box in [('1',6711,22,(415,85,458,135)),('4',6800,34,(435,85,487,135)),('0',6679,32,(470,85,525,135))]:
  im=cv2.resize(atlas[:29,x:x+w],None,fx=1.125,fy=1.125)
  template=im[:,:,0].astype('float32')*im[:,:,3]/255
  l,t,r,b=box
  _,correlation,_,loc=cv2.minMaxLoc(cv2.matchTemplate(ref[t:b,l:r],template,cv2.TM_CCOEFF_NORMED))
  fits.append({'video':v,'glyph':char,'scale':1.125,'xy':[l+loc[0],t+loc[1]],'correlation':correlation})
(a.out/'44-denominator-fit.json').write_text(json.dumps(fits,indent=2)+'\n')
