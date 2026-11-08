#!/usr/bin/env python3
"""Locate room42 native pillars/chests against independently tracked cameras.

Input frames: seek V2 at 28s, select every 15th raw 30fps frame through 73.5s,
crop=1440:1080:240:0,scale=720:540. No reference crop becomes a game asset.
"""
import argparse,io,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-room46/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
zoom=265/168;cameras=json.loads(a.camera.read_text());templates={}
with (a.client/'ImagePacks2/sprite_map_breakableobject_stonepillar.NPK').open('rb') as handle:
 for entry in NPK.open(handle).files:
  if not entry.name.endswith(('/stonepillar.img','/stonepillardamaged.img')):continue
  obj=IMGFactory.open(io.BytesIO(entry.data));pic=np.array(obj.build(obj.images[0]).convert('RGBA'))
  templates['damaged' if 'damaged' in entry.name else 'flat']=cv2.resize(pic,None,fx=.706*zoom,fy=.715*zoom)
def frame(time):
 index=round((time-28)*2)
 assert abs(cameras[index]['t']-time)<1e-6
 return cv2.imread(str(a.frames/f'{index+1:03d}.png')),cameras[index]['camera_px']
def matches(region,template,mask):
 z=cv2.matchTemplate(region,template,cv2.TM_CCOEFF_NORMED,mask=mask)
 return np.nan_to_num(z,nan=-1,posinf=-1,neginf=-1)
pillars=[]
for time in [28,44.5,60,66.5,72.5]:
 image,camera=frame(time);gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)[190:480]
 for kind,pic in templates.items():
  template=cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:,:,3]>150).astype('uint8')*255
  scores=matches(gray,template,mask);h,w=template.shape
  for _ in range(15):
   _,correlation,_,(x,y)=cv2.minMaxLoc(scores)
   if correlation<.75:break
   pillars.append({'time':time,'kind':kind,'correlation':float(correlation),'screen_rect':[x,y+190,w,h],
    'panorama_center':x+w/2+camera,'world_center':(x+w/2+camera)/zoom,'bottom':y+190+h})
   scores[max(0,y-60):y+60,max(0,x-22):x+22]=-1
# A partial first chest is behind a log/HUD. Fit its visible upper-right only;
# the second chest also has whole upper-face fits in two independent views.
atlas=np.array(Image.open('assets/forest.png').convert('RGBA'))
chest=cv2.resize(atlas[1874:1930,623:709],None,fx=.72*zoom,fy=.72*zoom)
chests=[]
for first,times in [(True,[44.5,48,56,60]),(False,[66.5,72.5])]:
 for time in times:
  image,camera=frame(time);gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
  template=cv2.cvtColor(chest[:40,:,:3],cv2.COLOR_RGB2GRAY);mask=(chest[:40,:,3]>150).astype('uint8')*255
  if first:mask[:,:65]=0
  top=400 if first else 300
  _,correlation,_,(x,y)=cv2.minMaxLoc(matches(gray[top:475],template,mask))
  chests.append({'time':time,'chest':1 if first else 2,'correlation':float(correlation),
   'world_center':(x+chest.shape[1]/2+camera)/zoom,'bottom':y+top+chest.shape[0],
   'mask':'upper-right only' if first else 'upper face'})
# Preserve the evidence that flat and damaged are states, not interchangeable art.
states=[]
for center,bottom in [(571,378),(1129,361)]:
 observations=[]
 for sample in cameras:
  image,camera=frame(sample['t']);gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY);values={}
  for kind,pic in templates.items():
   h,w=pic.shape[:2];x=round(center-camera-w/2);y=bottom-h
   if x<3 or x+w+3>720:continue
   template=cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:,:,3]>150).astype('uint8')*255
   _,value,_,_=cv2.minMaxLoc(matches(gray[y-2:y+h+2,x-3:x+w+3],template,mask));values[kind]=float(value)
  if values and max(values.values())>.75:observations.append({'time':sample['t'],'correlations':values})
 states.append({'panorama_center':center,'bottom':bottom,'observations':observations})
(a.out/'46-room42-layout-measurement.json').write_text(json.dumps({'zoom':zoom,'pillars':pillars,'chests':chests,
 'width_lower_bound_world':(720+max(c['camera_px'] for c in cameras)-min(c['camera_px'] for c in cameras))/zoom,
 'limits':'Static-feature motion and independent native-texture locations. Width remains a lower bound. Later first visibility does not identify an initial damage state. Collision, damage thresholds, foliage and background phase remain unverified.'},indent=2)+'\n')
(a.out/'46-room42-pillar-states.json').write_text(json.dumps({'tracked_pillars':states,
 'limits':'Visible flat-to-damaged transitions only; not a hit-count, HP, collision or trigger rule.'},indent=2)+'\n')
indices=sorted(set(list(range(0,len(cameras),8))+[len(cameras)-1]));sheet=Image.new('RGB',(1440,290*((len(indices)+3)//4)));draw=ImageDraw.Draw(sheet)
for j,index in enumerate(indices):
 image,_=frame(cameras[index]['t']);x=j%4*360;y=j//4*290
 sheet.paste(Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB)).resize((360,270)),(x,y+20));draw.text((x,y),str(cameras[index]['t']),fill='white')
sheet.save(a.out/'46-room42-contact.png')
for time in [28,72.5,73.5]:
 image,_=frame(time);Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB)).save(a.out/f'46-room42-{time}-reference.png')
print('pillar observations',len(pillars),'chest observations',len(chests))
