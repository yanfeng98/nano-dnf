#!/usr/bin/env python3
"""Match native StoneHead bitmap against normalized V2 room24/41/43 frames.

Frames: V2 crop1440:1080:240:0, scale720:540, fps2 starting74s;
001 corresponds74.25s. With --room 41 use exact10.5..25.5s frames at0.5s.
With --room 24 use exact277..311s frames at0.1s.
Camera is independently tracked, never fitted here.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import cv2
import numpy as np
from client_pvf import PvfArchive
from client_animation import parse_animation
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--room',choices=['24','41','43'],default='43')
p.add_argument('--frames',type=Path,required=True)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/room43-rocks.json'))
a=p.parse_args();root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'assets'))
from import_dnf_scene import decode_at
cv2.setNumThreads(1)
obj='passiveobject/mapobject/obstacle/stonehead1.obj'
ani='map/mirkwood/animation/stonehead.ani'
profile={'24':('n410(3,0).map','54-room24',[[286,498,246,0]]),
         '41':('s419(0,3).map','47-room41',[[286,515,176,0],[286,927,278,0]]),
         '43':('n423(2,3).map','02-room43',[[286,519,309,0],[286,1045,346,0],[286,1490,347,0]])}[a.room]
mapname='map/mirkwooddeep/'+profile[0]
with PvfArchive(a.client/'Script.pvf') as pvf:
 listing=[v for _,v in pvf.tokens('passiveobject/passiveobject.lst')]
 index=listing.index(286)
 assert listing[index+1].lower()=='mapobject/obstacle/stonehead1.obj'
 values=[v for _,v in pvf.tokens(obj)]
 width=values[values.index('[width]')+1:values.index('[width]')+3]
 animation=parse_animation(pvf.read(ani))
 mapTokens=pvf.tokens(mapname)
 tokens=[v for _,v in mapTokens]
 records=[]
 for section in ['[passive object]', '[special passive object]']:
  if section not in tokens:continue
  i=tokens.index(section)+1
  while i<len(mapTokens) and mapTokens[i][0]!=5:
   length=4 if section=='[passive object]' else 5+6*tokens[i+4]
   record=tokens[i:i+length]
   assert len(record)==length
   if record[0]==286:records.append(record)
   i+=length
  assert mapTokens[i][0]==5
 source={'objectListRecord':listing[index:index+2],'map':mapname,'mapSha256':hashlib.sha256(pvf.read(mapname)).hexdigest(),
 'object':obj,'objectSha256':hashlib.sha256(pvf.read(obj)).hexdigest(),
 'width':width,'passType':values[values.index('[pass type]')+1],
 'animation':animation,'records':records}
assert sorted(records)==profile[2],records
assert width==[140,28] and source['passType']=='[do not pass]'
assert animation['paths']==['Map/02obj009.img']
im,offset=decode_at(a.client,'sprite_map.NPK','sprite/map/02obj009.img',0)
rgba=np.array(im.convert('RGBA'));source.update(imageSize=list(im.size),imageOffset=list(offset),rgbaSha256=hashlib.sha256(rgba.tobytes()).hexdigest())
assert animation['frames'][0]['xy']==[-59,-81] and list(offset)==[0,7]
chip=cv2.resize(rgba,None,fx=1.125,fy=1.125)
template=cv2.cvtColor(chip[:,:,:3],cv2.COLOR_RGB2GRAY);mask=(chip[:,:,3]>220).astype('uint8')*255
h,w=template.shape;camera=json.loads((root/f'docs/reference-evidence/{profile[1]}-camera.json').read_text());rows=[]
for n,c in enumerate(camera,1):
 path=a.frames/f'{n:03d}.png'
 if not path.exists():continue
 gray=cv2.imread(str(path),0)
 for _,x,y,_ in records:
  ex=(x-59)*1.125-c['camera_px'];ey=92+(y-74)*1.125
  if ex<12 or ex+w>708:continue
  visibleH=min(h,int(465-ey)-9)
  if visibleH<35:continue
  left,top=round(ex)-8,round(ey)-8
  roi=gray[top:top+visibleH+17,left:left+w+17]
  scores=cv2.matchTemplate(roi,template[:visibleH],cv2.TM_CCOEFF_NORMED,mask=mask[:visibleH])
  scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
  _,score,_,(dx,dy)=cv2.minMaxLoc(scores)
  rows.append({'frame':n,'time':c['t'],'native':[x,y],'score':score,
   'templateHeight':visibleH,'expectedTopLeft':[ex,ey],'measuredTopLeft':[left+dx,top+dy],
   'residual':[left+dx-ex,top+dy-ey],'accepted':score>=.94 and abs(left+dx-ex)<=2 and abs(top+dy-ey)<=2})
result={'source':source,'screenScale':1.125,'screenYPhase':92,'gate':{'score':.94,'positionResidualPx':2},'observations':rows,
 'limits':['Occluded observations are retained as exclusions, not evidence of a different position.','Native static pass flag does not alone prove all engine collision behavior.']}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for _,x,y,_ in records:
 group=[r for r in rows if r['native']==[x,y]];good=[r for r in group if r['accepted']]
 assert len(good)>=2, (x,y,good)
 print([x,y],len(good),'/',len(group),'best',max((r['score'] for r in group),default=None))
