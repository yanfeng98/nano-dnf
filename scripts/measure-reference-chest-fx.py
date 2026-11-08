#!/usr/bin/env python3
"""Inspect local native chest FX and match outline structure in both recordings.

Outputs audit material only. Correlation is weak under the overlaid flash;
consistent scale/location across samples is not an exact animation model.
"""
from pathlib import Path
from PIL import Image,ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
import io,subprocess,json
import cv2,numpy as np
import argparse
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--out',type=Path,default=Path('/tmp/nano-chest38'))
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
args=p.parse_args();out=args.out;out.mkdir(parents=True,exist_ok=True)
with (args.client/'ImagePacks2/sprite_interface2_reward_ver2.0.NPK').open('rb') as f:
 e=next(e for e in NPK.open(f).files if e.name.endswith('/reward_ver2.img'));obj=IMGFactory.open(io.BytesIO(e.data))
 for i in [54,55,58]:
  fr=obj.images[i];im=obj.build(fr).convert('RGBA');im.save(out/f'f{i}.png');a=np.array(im);p=a[:,:,:3].sum(2);y,x=np.unravel_index(p.argmax(),p.shape);print(i,im.size,'max',x,y,'alpha',np.unique(a[:,:,3])[:12])
for v,start,length in [(1,345,1.7),(2,397.5,1.7)]:
 src=next(args.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(src),'-t',str(length),'-vf','crop=1440:1080:240:0,scale=720:540','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
 fs=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3)
 sheet=Image.new('RGB',(1000,220*((len(fs[::3])+4)//5)));d=ImageDraw.Draw(sheet)
 for j,i in enumerate(range(0,len(fs),3)):
  crop=Image.fromarray(fs[i]).crop((330,135,530,335));sheet.paste(crop,(j%5*200,j//5*220+20));d.text((j%5*200,j//5*220),f'V{v} {start+i/30:.3f}',fill='white')
 sheet.save(out/f'v{v}-fx-contact.png')
 np.save(out/f'v{v}.npy',fs)
 index=39 if v==1 else 42
 Image.fromarray(fs[index]).crop((330,135,530,335)).save(out/f'38-chest-v{v}-reference.png')

src=np.array(Image.open(out/'f54.png').convert('RGBA'));rows=[]
for v,index,time in [(1,39,346.3),(1,42,346.4),(2,42,398.9),(2,45,399.)]:
 ref=np.load(out/f'v{v}.npy')[index];best=None
 for scale in np.arange(1,1.251,.025):
  im=cv2.resize(src,None,fx=scale,fy=scale)
  target=ref[120:350,320:560].astype('float32');target=target[:,:,1]+target[:,:,2]-2*target[:,:,0];template=im[:,:,3].astype('float32');scores=cv2.matchTemplate(target,template,cv2.TM_CCOEFF_NORMED)
  _,val,_,loc=cv2.minMaxLoc(scores)
  if best is None or val>best['cyan_structure_correlation']:best={'scale':round(float(scale),3),'cyan_structure_correlation':val,'xy':[320+loc[0],120+loc[1]]}
 rows.append({'video':v,'time':time,**best})
print(json.dumps(rows,indent=2));(out/'38-outline-fit.json').write_text(json.dumps(rows,indent=2)+'\n')

# White-core bounds distinguish the old half-size flash from the source.
core=[]
native=np.array(Image.open(out/'f58.png').convert('RGB'))
for v,index in [(1,39),(2,42)]:
 ref=np.load(out/f'v{v}.npy')[index][160:260,360:460]
 record={'video':v,'limits':'Thresholded white-core bounds include compression and additive background; not an exact scale fit.'}
 for label,pixels,offset in [('reference',ref,(360,160)),('native',native,(0,0))]:
  mask=(pixels[:,:,0]>180)&(pixels[:,:,1]>230)&(pixels[:,:,2]>230)
  ys,xs=np.where(mask)
  record[label]=[int(xs.min()+offset[0]),int(ys.min()+offset[1]),int(xs.max()+offset[0])+1,int(ys.max()+offset[1])+1]
 core.append(record)
(out/'38-flash-core.json').write_text(json.dumps(core,indent=2)+'\n')
