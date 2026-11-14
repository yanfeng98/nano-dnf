#!/usr/bin/env python3
"""Audit background visibility under the adopted window/rim geometry.
These are model-space bounds, not a native engine geometry identification.
"""
import json,argparse
from pathlib import Path
import cv2,numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];im=np.array(Image.open(root/'assets/minimap.png').convert('RGBA'));alpha=im[18:122,82:186,3].astype('float32')/255
yy,xx=np.mgrid[0:150,570:720];ring=cv2.remap(alpha,((xx+.5-594)/1.125-.5).astype('float32'),((yy+.5-23.5)/1.125-.5).astype('float32'),cv2.INTER_LINEAR)
bg=(xx+.5>=610)&(xx+.5<702)&(yy+.5>=35.5)&(yy+.5<127.5);disc=(xx+.5-655.3125)**2+(yy+.5-79.1875)**2<=50.625**2
rows=[]
for shift in [-2,-1,0,1,2]:
 left=613.875+shift;bottom=119.625+shift;covered=(xx+.5>=left)&(xx+.5<705)&(yy+.5>=28.5)&(yy+.5<bottom)
 weight=np.where(bg&disc&~covered,1-ring,0)
 support=weight>.2;coords=np.argwhere(support)
 rows.append({'windowLeftAndBottomShift':shift,'effectiveBackgroundPixels':float(weight.sum()),'pixelsOver20PercentContribution':int(support.sum()),'pixelsOver50PercentContribution':int((weight>.5).sum()),'supportBounds':None if not len(coords)else[int(coords[:,1].min()+570),int(coords[:,0].min()),int(coords[:,1].max()+570),int(coords[:,0].max())]})
r={'model':'batch107 radar background/rim and109 full-window rectangle; ideal hard window/disc boundaries','windowEdgeSensitivityPixels':[-2,-1,0,1,2],'observations':rows,'limits':['Window shadow/soft edges and exact native window bounds remain unverified.','Effective pixel counts are support weights, not texture identity evidence.','Do not fit material or colour from a sparse or geometry-sensitive support.']};a.out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(rows,indent=2))
