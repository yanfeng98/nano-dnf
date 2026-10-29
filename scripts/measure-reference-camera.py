#!/usr/bin/env python3
"""Cross-check camera translation with a graph of static image features.

Requires opencv-python, numpy, scipy. Input: normalized 720x540 frames sampled
at 2fps from V2 74s, fps filter centers first sample at 74.25s. Mask excludes
HUD, chat and score. Multiple frame pairs constrain drift; values are camera
travel, not exact room widths. See docs/reference-video-audit.md.
"""
import argparse
import cv2,numpy as np,json
from pathlib import Path
from scipy.optimize import least_squares
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('frames',type=Path)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
fs=sorted(args.frames.glob('*.png'));s=cv2.SIFT_create(nfeatures=2200)
mask=np.zeros((540,720),np.uint8);mask[100:450,:]=255;mask[:280,:185]=0;mask[:180,580:]=0;mask[350:,600:]=0
features=[s.detectAndCompute(cv2.imread(str(f),0),mask) for f in fs];edges=[]
for i,(ka,da) in enumerate(features):
 for j in range(i+1,len(fs)):
  if j-i>10 and (i%4 or j%4):continue
  kb,db=features[j];ms=cv2.BFMatcher().knnMatch(da,db,k=2);good=[m for m,n in ms if m.distance<.62*n.distance]
  if len(good)<10:continue
  delta=np.float32([kb[m.trainIdx].pt for m in good])-np.float32([ka[m.queryIdx].pt for m in good]);delta=delta[abs(delta[:,1])<1.5]
  if len(delta)<10:continue
  v,c=np.unique(np.round(delta[:,0]/2),return_counts=True);mode=v[np.argmax(c)]*2;sel=delta[abs(delta[:,0]-mode)<2,0]
  if len(sel)<10:continue
  edges.append((i,j,-float(np.median(sel)),min(len(sel),50)))
x0=np.zeros(len(fs)-1)
def err(x):
 c=np.r_[0,x];return np.array([(c[j]-c[i]-dx)*np.sqrt(n/20) for i,j,dx,n in edges])
r=least_squares(err,x0,loss='soft_l1',f_scale=2,max_nfev=100)
c=np.r_[0,r.x];args.out.write_text(json.dumps([{'t':74.25+i*.5,'camera_px':round(float(x),2)} for i,x in enumerate(c)],indent=2))
print('edges',len(edges),'residual',np.median(abs(err(r.x))),'range',c.min(),c.max());print([(74.25+i*.5,round(float(c[i]),2)) for i in [0,4,12,32,48,52,56,60]])
