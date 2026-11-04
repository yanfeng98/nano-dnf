#!/usr/bin/env python3
"""Measure V2 town gait from native pose templates; never exports game art."""
import sys,json,subprocess,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'assets'))
import import_dnf_swordman as b
import import_dnf_reference_player as r
import cv2,numpy as np
cv2.setNumThreads(1)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,default=Path('/tmp/nano-town-walk-measurement'))
parser.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--video',type=Path,default=ROOT.parent/'dnf-素材/00002-幽暗密林深处.mp4')
a=parser.parse_args();out=a.out;out.mkdir(parents=True,exist_ok=True);templates=[];packed={};feet={}
subprocess.run(['ffmpeg','-v','error','-threads','1','-y','-ss','1.199','-i',str(a.video),'-t','1.15','-vf','crop=1440:1080:240:0,scale=720:540','-vsync','0',str(out/'ref-%03d.png')],check=True)
with r.reference_weapon():
 d=b.Decoder(a.client);ls=[(k,d.frames(k)) for k in b.LAYERS];ov=[(d.frames(k),ref,w,h) for k,ref,w,h in b.OVERLAYS]
 for label,indices in [('idle',range(176,180)),('walk',range(180,188))]:
  packed[label]=[]
  for i in indices:
   im,x,y,foot=b.composed_frame(ls,ov,i)
   px=round(b.ANCHOR_X-b.foot_centre(foot)*b.SCALE)
   py=round(b.ANCHOR_Y+(y-b.ORIGIN[1])*b.SCALE)
   packed[label].append([round(px+(232-x)*b.SCALE-b.ANCHOR_X,3),round(py+(333-y)*b.SCALE-b.ANCHOR_Y,3)])
   feet[i]=x+b.foot_centre(foot)
 for i in range(180,188):
  im,x,y,foot=b.composed_frame(ls,ov,i)
  for scale in [1.075,1.1,1.125,1.15,1.175]:
   pixels=cv2.resize(np.array(im)[:,::-1],None,fx=scale,fy=scale,interpolation=cv2.INTER_LINEAR)
   templates.append((i,scale,x,y,im.width,pixels[:,:,:3][:,:,::-1],(pixels[:,:,3]>160).astype('uint8')*255))
results=[]
for path in sorted(out.glob('ref-*.png')):
 im=cv2.imread(str(path));roi=im[265:420,:280];best=(-1,None)
 for i,scale,x,y,w,t,mask in templates:
  scores=cv2.matchTemplate(roi,t,cv2.TM_CCORR_NORMED,mask=mask);_,val,_,loc=cv2.minMaxLoc(scores)
  if val>best[0]:best=(val,dict(frame=i,scale=scale,rootX=loc[0]+(x+w-232)*scale,rootY=265+loc[1]+(333-y)*scale,left=loc[0],top=265+loc[1]))
 v=best[1];v.update(sample=int(path.stem.split('-')[1]),score=best[0]);results.append(v)
window=[v for v in results if 9<=v['sample']<=32]
expected=[pose for pose in range(180,188) for _ in range(3)]
if [v['frame'] for v in window] != expected:
 raise ValueError('The recording no longer matches the measured three-frame pose sequence')
background=[cv2.imread(str(out/f"ref-{v['sample']:03d}.png"))[200:260,300:600].astype(float) for v in window]
background_rms=float(np.sqrt(np.mean([(v-background[0])**2 for v in background])))
t=np.array([(v['sample']-1)/30+1.2 for v in window]);x=np.array([v['rootX'] for v in window])
def fit(x):
 k,c=np.polyfit(t,x,1)
 return {'speed':float(k),'rms':float(np.sqrt(np.mean((x-(k*t+c))**2)))}
measurement={'video':a.video.name,'normalized_size':[720,540],
 'window':[float(t[0]),float(t[-1])],'static_background_rms':background_rms,'pose_hold_video_frames':3,'samples':window,'fixed_root_fit':fit(x),
 'foot_center_fit':fit(x-np.array([(feet[v['frame']]-232)*v['scale'] for v in window])),
 'native_root':[232,333],'packed_roots':packed,
 'limits':'One leftward eight-pose cycle with static scenery. Template colours/equipment differ. Fits support anchor consistency and 10fps, not exact avatar scale, depth/diagonal speed or camera response.'}
(out/'measurement.json').write_text(json.dumps(measurement,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in measurement.items() if k not in ['samples']},ensure_ascii=False,indent=2))
