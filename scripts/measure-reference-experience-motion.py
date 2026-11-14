#!/usr/bin/env python3
"""Track the native zero glyph in two consecutive death-XP captions.

The fixed glyph, search strips and late brightness samples are declared below.
Item-label occlusion is not treated as text expiry. Source crops are evidence,
never game art. Timing is bounded by the 30fps recording cadence.
"""
import argparse,hashlib,json,subprocess
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=ROOT.parent/'dnf-素材')
p.add_argument('--out',type=Path,default=Path('/tmp/nano125-experience-motion'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);cv2.setNumThreads(1)
atlas=np.array(Image.open(ROOT/'assets/experience-digits.png').convert('RGBA'))
template=cv2.resize(atlas[2:14,:11],None,fx=1.125,fy=1.125)
mask=(template[:,:,3]>200).astype('uint8')*255
ink=(template[:,:,1]>150)&(template[:,:,3]>200)&(template[:,:,1]>template[:,:,0]*1.4)
selected=[0,1,3,6,9,10,12,15,18,21,24,25,27,30]
sheet=Image.new('RGB',(1120,760),'#181818');draw=ImageDraw.Draw(sheet);reports=[]
for group,(video,start,box,display,baselineIndex,lateIndices,control) in enumerate([
 (2,15.6,(401,60,419,170),(380,90,460,170),12,[12,15,18,21,24],(445,90,460,104)),
 (1,71.1,(401,170,420,270),(380,180,460,260),12,[12,24],(445,180,460,194))]):
 source=next(a.videos.glob(f'{video:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(source),'-t','1.4',
  '-vf','crop=1440:1080:240:0,scale=720:540','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
 frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3);samples=[]
 x0,y0,x1,y1=box
 for i,im in enumerate(frames):
  roi=im[y0:y1,x0:x1,::-1].astype('float32')
  scores=cv2.matchTemplate(roi,template[:,:,:3][:,:,::-1].astype('float32'),cv2.TM_CCORR_NORMED,mask=mask)
  scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1)
  _,score,_,(x,y)=cv2.minMaxLoc(scores)
  samples.append(dict(index=i,time=round(start+i/30,6),correlation=score,x=x0+x,y=y0+y,
   rgbSha256=hashlib.sha256(im.tobytes()).hexdigest()))
 seen=[s for s in samples if s['correlation']>.85]
 first,last=seen[0],seen[-1]
 plateauY=int(np.median([s['y'] for s in seen[-5:]]))
 plateauX=int(np.median([s['x'] for s in seen[-5:]]))
 firstPlateau=next(s for s in seen if abs(s['y']-plateauY)<=1)
 assert first['index']>0 and last['index']+1<len(samples)
 span=(last['index']-first['index']+1)/30
 rise=(firstPlateau['index']-first['index'])/30
 assert abs(span-.8)<1e-6 and abs(rise-.3)<1e-6
 assert abs(first['y']-plateauY-33)<=1
 # Use the same stationary bark after disappearance as the background.
 background=frames[27].astype(float);baseline=frames[baselineIndex].astype(float)
 h,w=ink.shape
 def green(im):return im[plateauY:plateauY+h,plateauX:plateauX+w,1][ink]
 delta=green(baseline)-green(background);cx,cy,cx1,cy1=control
 opacity=[]
 for index in lateIndices+[27]:
  im=frames[index].astype(float)
  ratio=float(np.dot(green(im)-green(background),delta)/np.dot(delta,delta))
  error=float(np.abs(im[cy:cy1,cx:cx1]-baseline[cy:cy1,cx:cx1]).mean())
  opacity.append(dict(time=round(start+index/30,6),relativeOpacity=ratio,
   meanGreen=float(green(im).mean()),backgroundControlMae=error))
  if index!=27 and video==2:assert .96<ratio<1.04 and error<3,(video,index,plateauX,plateauY,ratio,error)
 bg=background[plateauY:plateauY+h,plateauX:plateauX+w]
 obs=baseline[plateauY:plateauY+h,plateauX:plateauX+w]
 predicted=((template[:,:,:3].astype(float)-bg)*template[:,:,3,None]/255)[ink]
 observed=(obs-bg)[ink]
 absolute=float(np.sum(observed*predicted)/np.sum(predicted*predicted))
 for j,index in enumerate(selected):
  x=j%7*160;y=group*380+j//7*190
  draw.text((x,y),f'V{video} {start+index/30:.3f}s',fill='white')
  sheet.paste(Image.fromarray(frames[index]).crop(display).resize((160,160),Image.Resampling.NEAREST),(x,y+20))
 reports.append(dict(video=video,source=source.name,searchBox=list(box),samples=samples,
  visibilityThreshold=.85,firstVisible=first['time'],lastVisible=last['time'],
  visibleSpanSeconds=span,lifetimeInterval=[span-1/30,span+1/30],
  firstPlateau=firstPlateau['time'],riseSeconds=rise,riseScreenPixels=first['y']-plateauY,
  plateauGlyphOrigin=[plateauX,plateauY],opacityPixelCount=int(ink.sum()),
  relativeOpacitySamples=opacity,brightnessInferenceAccepted=(video==2),
  approximateAbsoluteOpacity=absolute if video==2 else None))
sheet.save(a.out/'125-experience-motion-contact.png')
report=dict(template='native expup.img frame0, scale1.125; alpha>200 mask',reports=reports,
 limits=['Visibility may be interrupted by an item label; only first/last reidentified glyphs bound the span.',
  'Lifetime/rise boundaries have one-frame sampling uncertainty; position endpoints permit one screen pixel error.',
  'V2 opacity uses a stable bark control and20 bright glyph pixels; absolute fit also depends on raster phase/compression. V1 control is unstable, so its brightness inference is rejected.',
  'Native death phase, origin offset and interaction with combat hit-stop are not identified by this measurement.'])
(a.out/'125-experience-motion.json').write_text(json.dumps(report,indent=2)+'\n')
print([(r['video'],r['visibleSpanSeconds'],r['riseSeconds'],r['riseScreenPixels']) for r in reports])
