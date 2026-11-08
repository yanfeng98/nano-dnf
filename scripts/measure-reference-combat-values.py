#!/usr/bin/env python3
"""Extract undimmed combat numeric fields; references are evidence, never assets."""
import argparse,io,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
import cv2,numpy as np
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-combat45'))
p.add_argument('--atlas',type=Path,default=Path('assets/results-reference.png'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
rows=[];sheet=Image.new('RGB',(900,270));draw=ImageDraw.Draw(sheet)
for col,(v,t) in enumerate([(1,332.5),(2,386.7),(1,60)]):
 source=next(a.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(t),'-i',str(source),'-frames:v','1',
  '-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 im=Image.open(io.BytesIO(raw)).convert('RGB');name=['v1','v2','early'][col]
 for kind,box in [('operation',(620,345,675,369)),('technique',(620,362,675,386)),('hits',(620,380,665,404))]:
  im.crop(box).save(a.out/f'45-{name}-{kind}-reference.png')
 draw.text((col*300,0),f'V{v} {t}s',fill='white');sheet.paste(im.crop((615,342,720,425)).resize((294,232)),(col*300,25))
 rows.append({'video':v,'time':t,'operation':'85%','technique':'57%','hits':15 if col==0 else 23 if col==1 else 0,
  'grade':'SS' if col==2 else 'S','limits':'Visible numeric fields and letter identity only; no hidden scoring formula or exact letter bitmap inferred.'})
sheet.save(a.out/'45-combat-values-contact.png')
(a.out/'45-combat-values-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')

# Compare the already imported native white-percent font with every field.
atlas=np.array(Image.open(a.atlas).convert('RGBA'))
rects=[(7381,15),(7396,11),(7407,16),(7423,15),(7438,15),(7453,16),(7469,15),(7484,16),(7500,15),(7515,15),(6651,15)]
fits=[]
for name,hits in [('v1','15'),('v2','23'),('early','0')]:
 for kind,text,origin in [('operation','85%',(620,345)),('technique','57%',(620,362)),('hits',hits,(620,380))]:
  ref=np.array(Image.open(a.out/f'45-{name}-{kind}-reference.png'))[:,:,0].astype('float32');best=None
  for scale in np.arange(.9,1.251,.025):
   for overlap in np.arange(0,5.1,.5):
    glyphs=[rects[10 if ch=='%' else int(ch)] for ch in text]
    advances=[(w-overlap)*scale for x,w in glyphs]
    width=round(sum(advances[:-1])+glyphs[-1][1]*scale);height=round(13*scale)
    if width>ref.shape[1] or height>ref.shape[0]:continue
    template=np.zeros((height,width),dtype='float32');cursor=0
    for (x,w),advance in zip(glyphs,advances):
     glyph=cv2.resize(atlas[:13,x:x+w],(round(w*scale),height))
     ink=glyph[:,:,0].astype('float32')*glyph[:,:,3]/255;left=round(cursor);span=min(ink.shape[1],width-left)
     template[:,left:left+span]=np.maximum(template[:,left:left+span],ink[:,:span]);cursor+=advance
    _,correlation,_,loc=cv2.minMaxLoc(cv2.matchTemplate(ref,template,cv2.TM_CCOEFF_NORMED))
    if best is None or correlation>best['correlation']:
     best={'scale':round(float(scale),3),'overlap':float(overlap),'correlation':correlation,'xy':[origin[0]+loc[0],origin[1]+loc[1]]}
  fits.append({'reference':name,'kind':kind,'text':text,**best})
(a.out/'45-combat-value-fit.json').write_text(json.dumps(fits,indent=2)+'\n')
print(json.dumps(fits,indent=2))
