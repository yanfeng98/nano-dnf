#!/usr/bin/env python3
"""Locate entry-room rocks and barrel caps; reject mixed-layer camera aliases.

Frames are exact 10.5..25.5s at 0.5s intervals from the normalized V2 recording.
Only local extracted client assets supply templates. No crop becomes game art.
"""
import argparse,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--camera',type=Path,default=Path('docs/reference-evidence/47-room41-camera.json'))
p.add_argument('--room42-entry',type=Path,required=True,help='Exact normalized 26.5s frame')
p.add_argument('--out',type=Path,default=Path('/tmp/nano-room47/evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cameras=json.loads(a.camera.read_text());atlas=np.array(Image.open('assets/forest.png').convert('RGBA'));zoom=265/168
rows=[]
for kind,rect,times,scales,top,limit,threshold in [
 ('rock',(585,803,141,89),[12,17.5,22.5,25.5],np.arange(.45,.851,.025),185,None,.75),
 ('barrel-cap',(560,1874,63,78),[10.5,13.5,17.5,22.5,25.5],np.arange(.6,.926,.025),285,20,.7)
]:
 x,y,w,h=rect;src=atlas[y:y+h,x:x+w]
 for time in times:
  index=round((time-cameras[0]["t"])*2);gray=cv2.imread(str(a.frames/f'{index+1:03d}.png'),0)[top:450 if kind=='rock' else 475];candidates=[]
  for scale in scales:
   pic=cv2.resize(src,None,fx=scale*zoom,fy=scale*zoom);height,width=pic.shape[:2]
   used=height if limit is None else round(limit*scale*zoom)
   template=cv2.cvtColor(pic[:used,:,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:used,:,3]>(200 if kind=='rock' else 170)).astype('uint8')*255
   scores=cv2.matchTemplate(gray,template,cv2.TM_CCOEFF_NORMED,mask=mask);scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
   for _ in range(6):
    _,value,_,(left,up)=cv2.minMaxLoc(scores)
    if value<threshold:break
    candidates.append({'kind':kind,'time':time,'scale':round(float(scale),3),'correlation':float(value),
     'screen_rect':[left,up+top,width,height],'panorama_center':left+width/2+cameras[index]['camera_px'],
     'bottom':up+top+height,'mask':'whole native rock' if limit is None else 'native upper cap'})
    scores[max(0,up-35):up+35,max(0,left-50):left+50]=-1
  chosen=[]
  for item in sorted(candidates,key=lambda q:-q['correlation']):
   if any(abs(item['screen_rect'][0]-other['screen_rect'][0])<60 and abs(item['screen_rect'][1]-other['screen_rect'][1])<45 for other in chosen):continue
   chosen.append(item)
  rows.extend(chosen)
result={'matches':rows,'width_lower_bound_world':(720+max(c['camera_px'] for c in cameras)-min(c['camera_px'] for c in cameras))/zoom,
 'limits':'Ground-band feature translation independently supported by stable native prop locations. Exact wall/door offsets, foliage, collision and hidden damage rules remain unverified. The 26.5s entry pillar is flat; 28s is already a later damaged state.'}
(a.out/'47-room41-layout-measurement.json').write_text(json.dumps(result,indent=2)+'\n')
for time in [10.5,13.5,17.5,25.5]:
 image=Image.open(a.frames/f'{round((time-cameras[0]["t"])*2)+1:03d}.png');image.save(a.out/f'47-room41-{time}-reference.png')
Image.open(a.room42_entry).save(a.out/'47-room42-entry-reference.png')
indices=sorted(set(list(range(0,len(cameras),4))+[len(cameras)-1]));board=Image.new('RGB',(1440,290*((len(indices)+3)//4)));draw=ImageDraw.Draw(board)
for j,i in enumerate(indices):
 x,y=j%4*360,j//4*290;board.paste(Image.open(a.frames/f'{i+1:03d}.png').resize((360,270)),(x,y+20));draw.text((x,y),str(cameras[i]['t']),fill='white')
board.save(a.out/'47-room41-contact.png');print('matches',len(rows),'width lower bound',result['width_lower_bound_world'])

# First room42 pillar: entry and later damage must not be conflated.
pillar=np.array(Image.open('assets/pillar-pale.png').convert('RGBA'));states=[]
for time,file in [(26.5,a.out/'47-room42-entry-reference.png'),(28,Path('docs/reference-evidence/46-room42-28-reference.png'))]:
 image=cv2.imread(str(file),0);scores={}
 for name,x,h in [('flat',0,133),('damaged',44,111)]:
  pic=cv2.resize(pillar[:h,x:x+44],None,fx=.706*zoom,fy=.715*zoom)
  template=cv2.cvtColor(pic[:,:,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:,:,3]>150).astype('uint8')*255
  matched=cv2.matchTemplate(image[220:390,350:420],template,cv2.TM_CCOEFF_NORMED,mask=mask)
  _,value,_,point=cv2.minMaxLoc(np.nan_to_num(matched,nan=-1,posinf=-1,neginf=-1))
  scores[name]={'correlation':float(value),'xy':[350+point[0],220+point[1]]}
 states.append({'time':time,'best_state':max(scores,key=lambda k:scores[k]['correlation']),'fits':scores})
(a.out/'47-room42-entry-state.json').write_text(json.dumps({'observations':states,
 'limits':'Initial flat and later damaged appearances only. No HP or hit-count transition rule inferred.'},indent=2)+'\n')

source=atlas[1874:1952,560:623];gray=cv2.imread(str(a.frames/'001.png'),0)[180:350,640:720];best=None
for scale in np.arange(.6,.901,.025):
 pic=cv2.resize(source,None,fx=scale*zoom,fy=scale*zoom);h,w=pic.shape[:2];used=round(20*scale*zoom)
 template=cv2.cvtColor(pic[:used,:50,:3],cv2.COLOR_RGB2GRAY);mask=(pic[:used,:50,3]>170).astype('uint8')*255
 matched=cv2.matchTemplate(gray,template,cv2.TM_CCOEFF_NORMED,mask=mask)
 _,value,_,point=cv2.minMaxLoc(np.nan_to_num(matched,nan=-1,posinf=-1,neginf=-1))
 if best is None or value>best['correlation']:
  best={'time':cameras[0]['t'],'correlation':float(value),'scale':round(float(scale),3),
        'screen_rect':[640+point[0],180+point[1],w,h],'mask':'upper cap, left50 pixels; right edge clipped'}
(a.out/'47-room41-initial-edge-barrel.json').write_text(json.dumps(best,indent=2)+'\n')
