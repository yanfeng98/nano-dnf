#!/usr/bin/env python3
"""Compare limited main-fire blend/alpha hypotheses against aligned video pixels."""
from pathlib import Path
import argparse,hashlib
import json,cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);args=p.parse_args();ROOT=Path(__file__).resolve().parents[1];args.out.parent.mkdir(parents=True,exist_ok=True)
cv2.setNumThreads(1)
r=json.load(open(ROOT/'docs/reference-evidence/157-native-missiles.json'));atlas=Image.open(ROOT/'docs/reference-evidence/157-native-missiles-raw.png');pics=[]
for f in r['files']['passiveobject/common/animation/firemissileparticle1.ani']['animation']['frames'][:2]:
 b=f['bitmapEvidence'];x,y=r['tiles'][b['tile']]['pasteXY'];w,h=b['size'];im=atlas.crop((x,y,x+w,y+h)).rotate(180).resize((round(w*.7*1.125),round(h*.7*1.125)),Image.Resampling.BILINEAR)
 pix=np.array(im).astype(float);offset=[-(b['offset'][i]+f['xy'][i]+[w,h][i])*.7*1.125 for i in range(2)];pics.append((pix,offset))
base=cv2.imread(str(args.frames/'149-v1-60.7-second-room.png'));pillar=base[345:421,408:434]
def shift(a):
 q=cv2.matchTemplate(a[290:480,300:560],pillar,cv2.TM_CCOEFF_NORMED);_,score,_,(x,y)=cv2.minMaxLoc(q);assert score>.98,score;return x+300-408,y+290-345
bg=cv2.imread(str(args.frames/'149-v1-61.9-second-room.png'));bdx,bdy=shift(bg);results=[]
for t,head,hy in [(61.4,217,316),(61.5,251,320)]:
 target=cv2.imread(str(args.frames/f'149-v1-{t:g}-second-room.png'));dx,dy=shift(target);back=cv2.warpAffine(bg,np.float32([[1,0,dx-bdx],[0,1,dy-bdy]]),(720,540));back=back[295:335,120:270,::-1].astype(float);obs=target[295:335,120:270,::-1].astype(float)
 velocity=337.5*(-.03598+2*.000958388*(head-19-130))
 for blend in ['normal','additive']:
  for interp in [False,True]:
   best={'mse':float('inf')}
   for phase in [0,.005,.01,.015]:
    for ox in range(-6,5,2):
     for oy in range(-2,3):
      pred=back.copy()
      for age in reversed(np.arange(phase,.35,.02)):
       idx=0 if age<.23 else 1;pix,off=pics[idx];alpha=(1-(1-100/255)*age/.23) if interp and age<.23 else (1 if idx==0 else 100/255)
       x=round(head+ox-337.5*age+off[0])-120;y=round(hy+oy-velocity*age+225*age*age/2+off[1])-295
       h,w=pix.shape[:2];x0=max(0,x);x1=min(150,x+w);y0=max(0,y);y1=min(40,y+h)
       if x0>=x1 or y0>=y1:continue
       p=pix[y0-y:y1-y,x0-x:x1-x];a=p[:,:,3:4]/255*alpha;b=pred[y0:y1,x0:x1]
       pred[y0:y1,x0:x1]=np.minimum(255,b+p[:,:,:3]*a) if blend=='additive' else b*(1-a)+p[:,:,:3]*a
      mse=float(np.mean((pred-obs)**2))
      if mse<best['mse']:best={'t':t,'blend':blend,'alphaInterpolated':interp,'phase':phase,'offset':[ox,oy],'mse':mse};image=pred.copy()
   results.append(best);print(best);Image.fromarray(image.clip(0,255).astype('uint8')).resize((600,160)).save(args.out.with_name(f'{args.out.stem}-{t}-{blend}-{interp}.png'))
args.out.write_text(json.dumps({'models':results,'sourceFrameSHA256':{name:hashlib.sha256((args.frames/name).read_bytes()).hexdigest() for name in ['149-v1-60.7-second-room.png','149-v1-61.9-second-room.png','149-v1-61.4-second-room.png','149-v1-61.5-second-room.png']},'limits':['Background61.9s aligned by pillar; foreground actors and compression may differ.','Limited simplified main-particle model; ignores lights/random area; not a native blend/interpolation proof.','Forest parallax may differ from pillar alignment; all residuals remain large, so this is not a definitive choice.']},indent=2)+'\n')
