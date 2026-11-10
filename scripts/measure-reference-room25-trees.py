#!/usr/bin/env python3
"""Fit observed boss-room tree forms to exact half-second normalized frames.

Native RGBA only. Occluded trees use visible left strips; the second foreground
root is below the HUD and is inferred from its native height. No fruit lifecycle
or original collider is inferred. Local client is the only art source.
"""
import argparse,json,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'assets'))
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cams=json.loads(Path('docs/reference-evidence/55-room25-camera.json').read_text());zoom=265/168
sources={name:np.array(decode_at(a.client,'sprite_map_breakableobject_actiontreerenew.NPK',f'sprite/map/breakableobject/actiontreerenew/actiontree1-{name}.img',0)[0]) for name in ['grakkarak','lorien','mirkwood','sunderland']}
for name in ['02','03']:sources[name]=np.array(decode_at(a.client,'sprite_map.NPK',f'sprite/map/{name}obj300.img',0)[0])
images={}
def picture(t):
 if t not in images:images[t]=np.array(Image.open(a.frames/f'{round((t-312)*2)+1:04d}.png').convert('RGB'))
 return images[t]
def write(name,value):(a.out/f'57-room25-tree-{name}.json').write_text(json.dumps(value,indent=2)+'\n')
def fit(src,t,region,box):
 x0,y0,x1,y1=region;im=cv2.imread(str(a.frames/f'{round((t-312)*2)+1:04d}.png'),0);camera=cams[round((t-312)*2)];best={'score':-1}
 for sx in np.arange(.685,.741,.005):
  for sy in np.arange(.685,.741,.005):
   pic=cv2.resize(src,None,fx=sx*zoom,fy=sy*zoom);h,w=pic.shape[:2];used=min(h,round(h*box[3]/203))
   if w>x1-x0 or used>y1-y0:continue
   mask=(pic[:used,:,3]>180).astype(np.uint8)*255;mask[:,round(w*box[2]/153):]=0
   scores=cv2.matchTemplate(im[y0:y1,x0:x1],cv2.cvtColor(pic[:used,:,:3],cv2.COLOR_RGB2GRAY),cv2.TM_CCOEFF_NORMED,mask=mask)
   _,value,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1))
   if value>best['score']:best=dict(time=t,score=value,scale=[round(float(sx),3),round(float(sy),3)],xy=[x+x0,y+y0],size=[w,h],mask_native=list(box),world=(x+x0+w/2+camera['camera_px'])/zoom,bottom=y+y0+h+camera['camera_y_px'])
 return best
back=[]
for kind in ['03','02','sunderland']:
 for flip in [False,True]:
  src=sources[kind][:,::-1].copy() if flip else sources[kind]
  for label,t,region in [('first-back',316.5,(450,75,720,350)),('second-back',320,(110,210,350,480))]:
   back.append(dict(label=label,kind=kind,flip=flip,**fit(src,t,region,(0,0,55,170))))
write('back-candidates',back)
front=[]
# Retain the earlier poor first-back fit to document why 319s under loot text
# cannot establish that tree's shape. Use 316.5s for its accepted measurement.
for label,t,region,box in [('first-back',319,(90,75,330,340),(0,0,55,203)),('first-front',319,(160,110,390,370),(0,0,153,203)),('second-back',320,(110,210,350,480),(0,0,55,203)),('second-front',320,(180,250,420,480),(0,0,153,170))]:
 front.append(dict(label=label,**fit(sources['sunderland'],t,region,box)))
write('front-fit',front)
layout=[next(q for q in back if q['label']=='first-back' and q['kind']=='sunderland' and not q['flip']),next(q for q in front if q['label']=='first-front'),next(q for q in back if q['label']=='second-back' and q['kind']=='03' and not q['flip']),next(q for q in front if q['label']=='second-front')]
layout=[dict(q,piece='treeBossFruit',geometry_form='plain' if i==2 else 'fruit')for i,q in enumerate(layout)]
assert all(q['score']>.9 for q in layout)
write('layout',layout)
def colors(label,t,xy,size,columns,rows):
 x,y=xy;w,h=size;actual=picture(t)[y:y+h,x:x+w];result=[]
 for kind in ['grakkarak','lorien','mirkwood','sunderland','03']:
  native=cv2.resize(sources[kind],(w,h));mask=native[:,:,3]>220;mask[:,columns:]=False;mask[rows:]=False
  left=native[:,:,:3][mask].astype(float);right=actual[mask].astype(float)
  result.append(dict(label=label,kind='map03' if kind=='03' else kind,pixels=int(mask.sum()),rmse=float(np.sqrt(np.mean((left-right)**2))),cosine=float(np.sum(left*right)/np.sqrt(np.sum(left*left)*np.sum(right*right)))))
 return result
write('front-colors',colors('first-front',319,(188,127),(173,229),173,229))
write('back-colors',colors('first-back',316.5,(494,96),(173,227),62,190)+colors('second-back',320,(143,231),(171,227),61,190))
print([(q['label'],q['piece'],q['world'],q['bottom'])for q in layout])
