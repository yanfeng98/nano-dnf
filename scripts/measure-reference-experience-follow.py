#!/usr/bin/env python3
"""Compare XP, player-name and independent bark motion in fixed V1 frames.

Video-derived word/name templates are audit-only, never game assets. A native
bark patch controls camera movement. This is not a complete kill counter.
"""
import argparse,hashlib,io,json,subprocess
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--video',type=Path,default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out',type=Path,default=Path('/tmp/nano130-follow-evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);cv2.setNumThreads(1)
def green(image):
 v=image.astype('float32');return np.maximum(0,v[:,:,1]-np.maximum(v[:,:,0],v[:,:,2]))
sourcePath=ROOT/'docs/reference-evidence/110-00001-71.3-counter-event.png'
source=np.array(Image.open(sourcePath).convert('RGB'))
word=green(source)[225:242,417:441]
name=cv2.cvtColor(source[255:274,368:459],cv2.COLOR_RGB2GRAY)
atlas=np.array(Image.open(ROOT/'assets/forest.png').convert('RGBA'))
bark=cv2.resize(atlas[160:192,1090:1118],None,fx=1.125,fy=1.125)
barkMask=(bark[:,:,3]>230).astype('uint8')*255
barkGray=cv2.cvtColor(bark[:,:,:3],cv2.COLOR_RGB2GRAY)
times=[60,69.6,69.8,70.3,71.1,71.3,73.2,73.6,73.8]
sheet=Image.new('RGB',(1080,810));draw=ImageDraw.Draw(sheet);rows=[]
for index,time in enumerate(times):
 png=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(a.video),'-frames:v','1',
  '-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 filename=f'130-v1-{time:g}-follow.png';(a.out/filename).write_bytes(png)
 image=Image.open(io.BytesIO(png)).convert('RGB');rgb=np.array(image);gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
 scores=cv2.matchTemplate(green(rgb)[80:400],word,cv2.TM_CCOEFF_NORMED)
 maxScore=float(scores.max());peaks=[]
 for _ in range(4):
  _,value,_,(x,y)=cv2.minMaxLoc(scores)
  if value<.8:break
  peaks.append(dict(score=value,x=x,y=y+80))
  scores[max(0,y-12):y+13,max(0,x-22):x+23]=-1
 ns=cv2.matchTemplate(gray[150:330],name,cv2.TM_CCOEFF_NORMED)
 _,nv,_,(nx,ny)=cv2.minMaxLoc(ns)
 bs=cv2.matchTemplate(gray[70:112],barkGray,cv2.TM_CCOEFF_NORMED,mask=barkMask)
 bs=np.nan_to_num(bs,nan=-1,posinf=-1,neginf=-1);_,bv,_,(bx,by)=cv2.minMaxLoc(bs)
 row=dict(time=time,frame=filename,sha256=hashlib.sha256(png).hexdigest(),
  suffixMaxScore=maxScore,suffixPeaks=peaks,name=dict(score=nv,x=nx,y=ny+150),
  bark=dict(score=bv,x=bx,y=by+70),reliableName=(nv>.75),reliableBark=(bv>.85))
 rows.append(row);x=index%3*360;y=index//3*270
 sheet.paste(image.resize((360,270)),(x,y));draw.text((x,y),f'V1 {time:g}s',fill='red')
byTime={r['time']:r for r in rows};pairs=[]
for before,after in [(73.2,73.6),(73.6,73.8)]:
 b,f=byTime[before],byTime[after]
 assert b['reliableName'] and f['reliableName'] and b['reliableBark'] and f['reliableBark']
 assert len(b['suffixPeaks'])==len(f['suffixPeaks'])==1
 xpDelta=[f['suffixPeaks'][0][axis]-b['suffixPeaks'][0][axis] for axis in ['x','y']]
 nameDelta=[f['name'][axis]-b['name'][axis] for axis in ['x','y']]
 barkDelta=[f['bark'][axis]-b['bark'][axis] for axis in ['x','y']]
 assert abs(barkDelta[0])<=1 and abs(barkDelta[1])<=1
 assert abs(xpDelta[0]-nameDelta[0])<=1
 if before==73.6:assert abs(xpDelta[1]-nameDelta[1])<=1
 pairs.append(dict(before=before,after=after,suffixDelta=xpDelta,nameDelta=nameDelta,barkDelta=barkDelta))
assert not byTime[60]['suffixPeaks'] and not byTime[71.1]['suffixPeaks'],'known no-caption controls'
assert len(byTime[69.8]['suffixPeaks'])==2,'two simultaneous floats must remain distinguishable in this frame'
sheet.save(a.out/'130-experience-follow-contact.png')
report=dict(video=a.video.name,templateSource=sourcePath.name,
 templateSourceSha256=hashlib.sha256(sourcePath.read_bytes()).hexdigest(),
 templateRects=dict(suffix=[417,225,24,17],name=[368,255,91,19],nativeBarkAtlas=[1090,160,28,32]),
 samples=rows,stationaryCameraPairs=pairs,limits=[
 'Coordinates are template origins; relative movement is measured, not an absolute baseline or head gap.',
 'The low-confidence name/bark at69.8 are not used to infer camera movement.',
 'The two early40XP captions can overlap after reaching the same plateau; a single visual footprint cannot prove a single kill.',
 'The71.3 source match is not an independent validation. Primary motion pairs use73.2/73.6/73.8.',
 'These fixed samples and controls do not prove a complete automatic XP ledger or general detector recall.'])
(a.out/'130-experience-follow.json').write_text(json.dumps(report,indent=2)+'\n')
print('stationary-camera follow pairs',pairs)
