import cv2,numpy as np,json
from PIL import Image
from pathlib import Path
import argparse
p=argparse.ArgumentParser(description='Native prop identity checks for room24; frames277..311s every0.1s')
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/54-room24-camera.json'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano54/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
atlas=np.array(Image.open('assets/forest.png').convert('RGBA'));cams=json.loads(a.camera.read_text());z=265/168;rows=[]
for kind,rect,scales,cutoff,minimum in [('barrel',(560,1874,63,78),np.arange(.65,.801,.025),22,.9),('wallStone',(418,803,167,125),np.arange(.4,.801,.025),60,.8),('rockFlat',(585,803,141,89),np.arange(.4,.801,.025),60,.8),('treeLeafy',(160,803,153,203),np.arange(.4,.901,.025),100,.85)]:
 x,y,w,h=rect;src=atlas[y:y+h,x:x+w]
 for t in [277,278,279,281,285,293,301,307]:
  i=round((t-277)*10);im=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);cam=cams[i];candidates=[]
  for sc in scales:
   pic=cv2.resize(src,None,fx=sc*z,fy=sc*z);hh,ww=pic.shape[:2];used=min(hh,cutoff);tem=cv2.cvtColor(pic[:used,:,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:used,:,3]>180).astype(np.uint8)*255
   scores=cv2.matchTemplate(im[150:460],tem,cv2.TM_CCOEFF_NORMED,mask=mask);scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
   for _ in range(5):
    _,v,_,(xx,yy)=cv2.minMaxLoc(scores)
    if v<minimum:break
    candidates.append(dict(kind=kind,time=t,scale=round(float(sc),3),score=v,xy=[xx,yy+150],size=[ww,hh],world=(xx+ww/2+cam['camera_px'])/z,bottom=yy+150+hh+cam['camera_y_px']))
    scores[max(0,yy-35):yy+35,max(0,xx-35):xx+35]=-1
  chosen=[]
  for q in sorted(candidates,key=lambda q:-q['score']):
   if any(abs(q['xy'][0]-o['xy'][0])<40 and abs(q['xy'][1]-o['xy'][1])<40 for o in chosen):continue
   chosen.append(q)
  rows+=chosen
(a.out/'54-room24-props-measurement.json').write_text(json.dumps(rows,indent=2)+'\n')

# Static mirrored green-tree form: full opaque-pixel identity, not fruit state.
tree=np.array(Image.open('assets/tree-reference.png').convert('RGBA'));fits=[]
for t,region in [(293,(220,140,520,450)),(307,(100,140,400,450))]:
 i=round((t-277)*10);image=cv2.imread(str(a.frames/f'{i+1:03d}.png'),0);camera=cams[i]
 x0,y0,x1,y1=region;best={'score':-1}
 for sx in np.arange(.69,.741,.005):
  for sy in np.arange(.69,.741,.005):
   pic=cv2.resize(tree,None,fx=sx*z,fy=sy*z);h,w=pic.shape[:2]
   if w>x1-x0 or h>y1-y0:continue
   mask=(pic[:,:,3]>180).astype(np.uint8)*255;template=cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY)
   scores=cv2.matchTemplate(image[y0:y1,x0:x1],template,cv2.TM_CCOEFF_NORMED,mask=mask)
   _,value,_,(x,y)=cv2.minMaxLoc(np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1))
   if value>best['score']:best={'time':t,'score':value,'scale':[round(float(sx),3),round(float(sy),3)],'xy':[x+x0,y+y0],'size':[w,h],'world':(x+x0+w/2+camera['camera_px'])/z,'bottom':y+y0+h+camera['camera_y_px']}
 assert best['score']>.94,'native tree identity does not fit source'
 fits.append(best)
(a.out/'54-tree-layout-fit.json').write_text(json.dumps(fits,indent=2)+'\n')
