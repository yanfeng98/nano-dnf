#!/usr/bin/env python3
"""Cross-check the native boss closeback layout against exact reference frames.

Same 312..385s half-second frames as batch55. Actor/loot/radar regions are
excluded explicitly. 370s uses only y100..170 because a jumping sword covers
lower pixels. Candidate placements never change the reference masks.
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
proof=json.loads(Path('docs/reference-evidence/58-closeback-native-proof.json').read_text())
cameras=json.loads(Path('docs/reference-evidence/55-room25-camera.json').read_text());cache={}
for palette in ['02','03']:
 for item in proof['items']:
  name=item['source'].replace('/02','/'+palette);key=(name,item['frame'])
  if key not in cache:cache[key]=decode_at(a.client,'sprite_map.NPK',name,item['frame'])
def compose(tree4_y, palette='02', order='list'):
 canvas=Image.new('RGBA',tuple(proof['size']));items=proof['items']
 if order=='y':items=sorted(items,key=lambda q:q['pos'][1])
 for q in items:
  im,offset=cache[(q['source'].replace('/02','/'+palette),q['frame'])]
  x,y,z=q['pos'];dx,dy=q['ani_xy'];adjust=tree4_y if q['animation'].lower()=='animation/tree4.ani'else 0
  canvas.alpha_composite(im,(x+dx+offset[0],y+dy+offset[1]+80+adjust))
 return np.array(canvas.crop((0,0,proof['map_native_width'],480)).resize((2268,540),Image.Resampling.BILINEAR))
regions=[(312,(185,80,395,200)),(314.5,(250,80,300,90)),(319,(450,80,120,120)),(330,(185,100,395,120)),(370,(185,100,395,70))]
refs={t:np.array(Image.open(a.frames/f'{round((t-312)*2)+1:04d}.png').convert('RGB')) for t,_ in regions}
baseline=compose(0);fixed=[]
for t,(x,y,w,h)in regions:
 cx=round(cameras[round((t-312)*2)]['camera_px'])+x
 fixed.append((t,cx,y-2,w,h,refs[t][y:y+h,x:x+w],baseline[y-2:y-2+h,cx:cx+w,3]>220))
scan=[]
for correction in range(-24,5):
 image=compose(correction);mse=[]
 for t,x,y,w,h,ref,mask in fixed:mse.append(float(np.mean((image[y:y+h,x:x+w,:3][mask].astype(float)-ref[mask].astype(float))**2)))
 scan.append(dict(native_tree4_y=correction,mean_mse=float(np.mean(mse)),frame_mse=mse))
def compare(name, image):
 out=[]
 for t,(x,y,w,h)in regions:
  cx=round(cameras[round((t-312)*2)]['camera_px'])+x;pic=image[y-2:y-2+h,cx:cx+w];mask=pic[:,:,3]>220
  left=pic[:,:,:3][mask].astype(float);right=refs[t][y:y+h,x:x+w][mask].astype(float)
  out.append(dict(time=t,roi=[x,y,w,h],pixels=int(mask.sum()),cosine=float(np.sum(left*right)/np.sqrt(np.sum(left*left)*np.sum(right*right))),rmse=float(np.sqrt(np.mean((left-right)**2)))))
 return dict(candidate=name,frames=out)
adjust=next(q['native_y_adjust']for q in proof['items']if q['animation'].lower()=='animation/tree4.ani')
accepted=compare('measured original-order set02',compose(adjust))
assert min(q['cosine']for q in accepted['frames'])>.98
# Global texture matching checks the camera independently at the west side.
files=sorted(a.frames.glob('*.png'));reference=cv2.imread(str(files[0]),0);tracking=[]
for label,x,y,w,h in [('mossy-bark',575,195,40,35),('central-bark',300,195,40,35)]:
 template=reference[y:y+h,x:x+w];samples=[]
 for i in range(12):
  delta=cameras[i]['camera_px']-cameras[0]['camera_px']
  if not 0<=x-delta<=720-w:continue
  scores=cv2.matchTemplate(cv2.imread(str(files[i]),0)[150:280],template,cv2.TM_CCOEFF_NORMED)
  _,value,_,(actual,top)=cv2.minMaxLoc(scores)
  if value>.8:samples.append(dict(time=cameras[i]['t'],score=value,x=actual,y=top+150,error_px=abs(x-actual-delta)))
 assert len(samples)>=4 and max(s['error_px']for s in samples)<1
 tracking.append(dict(label=label,reference_rect=[x,y,w,h],samples=samples))
report=dict(calibration=dict(tree4_native_y=adjust,screen_y=2,screen_native_scale=1.125,scan=scan,best_scan=min(scan,key=lambda q:q['mean_mse'])),accepted=accepted,alternatives=[compare('unadjusted ANI set02',baseline),compare('Y-sorted set02',compose(adjust,order='y')),compare('original-order set03',compose(adjust,palette='03'))],bark_tracking=tracking,limits='Native closeback plane only; other layers, rooms, map bounds, actors and lifecycle are not established by these regions.')
(a.out/'58-closeback-measurement.json').write_text(json.dumps(report,indent=2)+'\n')
print('best Tree4 Y',report['calibration']['best_scan']['native_tree4_y'],'accepted',[(q['time'],round(q['cosine'],5))for q in accepted['frames']])
