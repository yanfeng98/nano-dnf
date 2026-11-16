#!/usr/bin/env python3
"""Review a native fire image candidate in four manually isolated video fronts."""
from pathlib import Path
import argparse,hashlib
import json,cv2,numpy as np,math
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=Path,required=True);p.add_argument('--out',type=Path,required=True);args=p.parse_args()
ROOT=Path(__file__).resolve().parents[1]
cv2.setNumThreads(1)
r=json.load(open(ROOT/'docs/reference-evidence/157-native-missiles.json'));a=Image.open(ROOT/'docs/reference-evidence/157-native-missiles-raw.png');fr=r['files']['passiveobject/common/animation/firemissileparticle1.ani']['animation']['frames'][0];f=fr['bitmapEvidence'];x,y=r['tiles'][f['tile']]['pasteXY'];w,h=f['size'];raw=a.crop((x,y,x+w,y+h));templates=[]
for factor in [.5,.7,.9,1]:
 for angle in range(0,360,10):
  im=raw.rotate(angle,Image.Resampling.BICUBIC,expand=True);im=im.resize((round(im.width*factor*1.125),round(im.height*factor*1.125)),Image.Resampling.BILINEAR);p=np.array(im)
  for cutoff in [120,190]:
   mask=(p[:,:,3]>cutoff).astype('uint8')*255
   if (mask>0).sum()<20:continue
   templates.append((factor,angle,cutoff,p[:,:,:3][:,:,::-1].copy(),mask))
rows=[]
for t,edge in [(61.2,149),(61.3,181),(61.4,217),(61.5,251)]:
 path=args.frames/f'149-v1-{t:g}-second-room.png';im=cv2.imread(str(path));roi=im[295:335,edge-30:edge+10];trials=[]
 for factor,angle,cutoff,pic,mask in templates:
  h,w=pic.shape[:2]
  if w>40 or h>40:continue
  scores=cv2.matchTemplate(roi,pic,cv2.TM_CCOEFF_NORMED,mask=mask);scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1);_,score,_,(mx,my)=cv2.minMaxLoc(scores)
  trials.append({'factor':factor,'anglePIL':angle,'maskAlphaMin':cutoff,'score':score,'xy':[mx+edge-30,my+295],'wh':[w,h]})
 rows.append({'t':t,'frame':path.name,'frameSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'roiXYWH':[edge-30,295,40,40],'trials':trials,'best':max(trials,key=lambda q:q['score'])})
 print(t,rows[-1]['best'])
report={'sourceRGBAsha256':f['rgbaSHA256'],'sourceIMGsha256':f['imgSHA256'],'samples':rows,
'presentationCandidate':{'nativeScale':.7,'anglePIL':180,'basis':'61.2s visible match; not a native ANI rotation interpretation'},
'limits':['Small isolated colour templates support a candidate, not unique engine child linkage.','Scale and angle vary across best fits; presentation candidate is partial, not a full particle calibration.','PTL scheduling, compositing, random area and other variants remain unproved.']}
args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(report,indent=2)+'\n')
