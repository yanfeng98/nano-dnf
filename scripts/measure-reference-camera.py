#!/usr/bin/env python3
"""Cross-check camera translation with a graph of static image features.

Requires opencv-python, numpy, scipy. Input: normalized 720x540 frames with
explicit timestamps (--start/--step); prefer selecting exact raw video frames.
Default horizontal matching retains the earlier room43 path. Optional 2D and
spatial-coverage modes distinguish camera movement from a moving actor.
Camera travel is not an exact room width. Cross-check identified native props.
"""
import argparse
import cv2,numpy as np,json
from pathlib import Path
from scipy.optimize import least_squares
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('frames',type=Path)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--start',type=float,default=74.25,help='Exact timestamp of first sample; does not imply a left-wall camera')
parser.add_argument('--max-pair-gap',type=int,default=0,help='Limit comparisons to nearby frames; zero retains long-range loop constraints')
parser.add_argument('--spatial-consensus',action='store_true',help='Rank translation clusters by spatial coverage to reject a feature-rich moving actor')
parser.add_argument('--normalize-min',action='store_true',help='Use the minimum observed horizontal camera as origin; does not prove an exact left wall')
parser.add_argument('--track-y',action='store_true',help='Fit vertical translation too when the recording camera moves during jumps')
parser.add_argument('--times',type=Path,help='JSON array of strictly increasing timestamps for nonuniform/revisited samples')
parser.add_argument('--step',type=float,default=.5,help='Seconds between input samples')
parser.add_argument('--diagnostics',type=Path,help='Save graph connectivity and residuals for independent review')
parser.add_argument('--mask-top',type=int,default=100,help='First scene row used for features; raise to exclude parallax treetops')
parser.add_argument('--mask-bottom',type=int,default=450,help='Last scene row used for features')
args=parser.parse_args()
fs=sorted(args.frames.glob('*.png'));s=cv2.SIFT_create(nfeatures=2200)
if args.max_pair_gap<0:raise ValueError('Pair gap must not be negative')
if args.spatial_consensus and not args.track_y:raise ValueError('Spatial consensus requires track-y')
if len(fs)<2 or args.step<=0:raise ValueError('Need at least two frames and a positive sample step')
times=json.loads(args.times.read_text()) if args.times else [round(args.start+i*args.step,6) for i in range(len(fs))]
if len(times)!=len(fs) or not all(isinstance(t,(int,float)) and np.isfinite(t) for t in times):raise ValueError('Need one finite timestamp per input frame')
if any(b<=a for a,b in zip(times,times[1:])):raise ValueError('Timestamps must be strictly increasing')
if not 0<=args.mask_top<args.mask_bottom<=540:raise ValueError('Invalid scene mask bounds')
mask=np.zeros((540,720),np.uint8);mask[args.mask_top:args.mask_bottom,:]=255;mask[:280,:185]=0;mask[:180,580:]=0;mask[350:,600:]=0
features=[s.detectAndCompute(cv2.imread(str(f),0),mask) for f in fs]
edges=[];vertical_edges=[]
for i,(ka,da) in enumerate(features):
 if da is None:continue
 for j in range(i+1,len(fs)):
  if args.max_pair_gap and j-i>args.max_pair_gap:continue
  if j-i>10 and (i%4 or j%4):continue
  kb,db=features[j]
  if db is None or len(db)<2:continue
  ms=cv2.BFMatcher().knnMatch(da,db,k=2);good=[pair[0] for pair in ms if len(pair)==2 and pair[0].distance<.62*pair[1].distance]
  if len(good)<10:continue
  delta=np.float32([kb[m.trainIdx].pt for m in good])-np.float32([ka[m.queryIdx].pt for m in good])
  if args.track_y:
   bins,counts=np.unique(np.round(delta/2),axis=0,return_counts=True)
   if args.spatial_consensus:
    positions=np.array([ka[m.queryIdx].pt for m in good])
    candidates=[]
    for mode in bins[counts>=3]*2:
     indices=np.all(abs(delta-mode)<2,axis=1)
     if indices.sum()<10:continue
     cells=len(np.unique(np.floor(positions[indices]/48),axis=0))
     candidates.append((cells,int(indices.sum()),indices))
    if not candidates:continue
    selected=delta[max(candidates,key=lambda c:c[:2])[2]]
   else:
    mode=bins[np.argmax(counts)]*2
    selected=delta[np.all(abs(delta-mode)<2,axis=1)]
  else:
   delta=delta[abs(delta[:,1])<1.5]
   if len(delta)<10:continue
   bins,counts=np.unique(np.round(delta[:,0]/2),return_counts=True)
   mode=bins[np.argmax(counts)]*2
   selected=delta[abs(delta[:,0]-mode)<2]
  if len(selected)<10:continue
  edges.append((i,j,-float(np.median(selected[:,0])),min(len(selected),50)))
  vertical_edges.append(-float(np.median(selected[:,1])))
adj=[set() for _ in fs]
for i,j,_,_ in edges:adj[i].add(j);adj[j].add(i)
seen={0};todo=[0]
while todo:
 for j in adj[todo.pop()]-seen:seen.add(j);todo.append(j)
if len(seen)!=len(fs):
 raise ValueError('Camera graph disconnected; resample or split the segment. Unconstrained frames: '+str([i for i in range(len(fs)) if i not in seen]))
matrix=np.zeros((len(edges),len(fs)-1));target=np.zeros(len(edges))
for row,(i,j,dx,n) in enumerate(edges):
 weight=np.sqrt(n/20)
 if i:matrix[row,i-1]=-weight
 if j:matrix[row,j-1]=weight
 target[row]=dx*weight
# Linear graph solution supplies a useful initial camera path. Starting every
# frame at zero makes a long room's soft-L1 solve spend its budget in flat tails.
x0=np.linalg.lstsq(matrix,target,rcond=None)[0]
def err(x):
 c=np.r_[0,x];return np.array([(c[j]-c[i]-dx)*np.sqrt(n/20) for i,j,dx,n in edges])
r=least_squares(err,x0,jac=lambda x:matrix.copy(),loss='soft_l1',f_scale=2,max_nfev=100)
c=np.r_[0,r.x]
if not r.success:raise RuntimeError('Camera fit did not converge: '+r.message)
args.out.parent.mkdir(parents=True,exist_ok=True)
vertical=None
if args.track_y:
 ytarget=np.array([dy*np.sqrt(edge[3]/20) for edge,dy in zip(edges,vertical_edges)])
 y0=np.linalg.lstsq(matrix,ytarget,rcond=None)[0]
 yr=least_squares(lambda x:matrix@x-ytarget,y0,jac=lambda x:matrix.copy(),loss='soft_l1',f_scale=2,max_nfev=100)
 if not yr.success:raise RuntimeError('Vertical camera fit did not converge: '+yr.message)
 vertical=np.r_[0,yr.x]
origin=float(c.min()) if args.normalize_min else 0
records=[{'t':times[i],'camera_px':round(float(x-origin),2),
 **({'relative_camera_px':round(float(x),2)} if args.normalize_min else {}),
 **({'camera_y_px':round(float(vertical[i]),2)} if vertical is not None else {})} for i,x in enumerate(c)]
args.out.write_text(json.dumps(records,indent=2)+'\n')
if args.diagnostics:
 residual=[float(c[j]-c[i]-dx) for i,j,dx,_ in edges]
 args.diagnostics.parent.mkdir(parents=True,exist_ok=True)
 args.diagnostics.write_text(json.dumps({'frames':[f.name for f in fs],'start':times[0],'step':args.step,'sample_times':times if args.times else None,'feature_rows':[args.mask_top,args.mask_bottom],
  'origin_relative_px':origin,'connected_frames':len(seen),'spatial_consensus':args.spatial_consensus,'max_pair_gap':args.max_pair_gap,'track_y':args.track_y,'vertical_edge_deltas_px':vertical_edges if args.track_y else None,'edges':edges,'edge_residuals_px':residual,
  'median_absolute_residual_px':float(np.median(np.abs(residual))),
  'span_px':float(c.max()-c.min()),'limits':'Relative translation from static-feature constraints; not absolute camera, exact room width, or proof of layer identity. Check matching world props independently.'},indent=2)+'\n')
print('edges',len(edges),'residual',np.median(abs(err(r.x))),'range',c.min(),c.max())
print([(round(times[i],3),round(float(c[i]),2)) for i in sorted(set([0,len(fs)-1]+list(range(0,len(fs),max(1,len(fs)//8)))))])
