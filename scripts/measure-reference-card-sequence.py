#!/usr/bin/env python3
"""Measure the shared cyan card fade, prompt and counter in both recordings.

All video crops go to the audit output directory; none become game art. V2's
first card has a separate repeating highlight, so it cannot define flip order.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'assets'))
import import_dnf_results as native
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=ROOT.parent/'dnf-素材')
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-reference-card-sequence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);cv2.setNumThreads(1)
art={name:np.array(im) for name,im,_ in native.frames(a.client)}
card=cv2.resize(art['cardGold'],None,fx=1.125,fy=1.125)
fill=art['cardGlow'][50,80,:3].astype(float)
summary=[];samples=[];shots=[]

def gold_mask(im):
    im=im.astype(float)
    return ((im[:,:,0]>100)&(im[:,:,1]>60)&(im[:,:,0]>.9*im[:,:,1])&(im[:,:,2]<.8*im[:,:,1]))

for video,start,anchor in [(1,346.5,346+19/30),(2,399.0,399.2)]:
    name='幽暗密林' if video==1 else '幽暗密林深处'
    cmd=['ffmpeg','-v','error','-threads','1','-ss',str(start-.001),'-i',
         str(a.videos/f'0000{video}-{name}.mp4'),'-t','6.1','-vf',
         'crop=1440:1080:240:0,scale=720:540','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
    proc=subprocess.Popen(cmd,stdout=subprocess.PIPE);rows=[];fit=None;blue_fit=None;i=0
    selected={round((anchor+age-start)*30) for age in [1.2,1.5,1.9,2+1/30,2.5+1/30,5.5+1/30]}
    while True:
        data=proc.stdout.read(720*540*3)
        if not data: break
        if len(data)!=720*540*3: raise RuntimeError('Truncated reference frame')
        im=np.frombuffer(data,'uint8').reshape(540,720,3);time=start+i/30
        gold=[float(gold_mask(im[195:288,15+179*c:170+179*c]).mean()) for c in range(4)]
        hint=int(gold_mask(im[330:362,250:480]).sum());digit=int(gold_mask(im[410:475,330:375]).sum())
        roi=im[190:300].astype(float)
        cyan=(roi[:,:,0]>60)&(roi[:,:,1]>180)&(roi[:,:,2]>210)
        extent=np.flatnonzero(cyan.sum(0)>20)
        rows.append(dict(video=video,frame=i,time=round(time,6),gold=gold,hint=hint,digit=digit,
            cyan_bounds=[int(extent.min()),int(extent.max())] if len(extent) else None))
        if i in selected:
            shots.append((video,time,Image.fromarray(im).crop((0,180,720,480)).resize((360,150))))
        if abs(time-(anchor+1.2))<.01:
            observed=im[188:297,9:181].astype(float);mask=card[:,:,3]>220
            choices=[]
            for alpha in np.arange(0,1.501,.01):
                predicted=np.minimum(255,card[:,:,:3].astype(float)+alpha*fill)
                choices.append((float(np.square((predicted-observed)[mask]).mean()),float(alpha)))
            mse,alpha=min(choices);blue_fit=dict(alpha=alpha,rmse=mse**.5)
        if video==1 and abs(time-349)<.01:
            choices=[];roi=im[170:315,:188]
            for scale in np.arange(1,1.201,.00625):
                v=cv2.resize(art['cardGold'],None,fx=float(scale),fy=float(scale))
                if v.shape[0]>roi.shape[0] or v.shape[1]>roi.shape[1]:continue
                _,score,_,loc=cv2.minMaxLoc(cv2.matchTemplate(roi,v[:,:,:3],cv2.TM_CCORR_NORMED,
                    mask=(v[:,:,3]>100).astype('uint8')*255))
                choices.append(dict(score=float(score),scale=float(scale),left=loc[0],top=170+loc[1],size=[v.shape[1],v.shape[0]]))
            fit=max(choices,key=lambda x:x['score'])
        i+=1
    if proc.wait()!=0: raise RuntimeError('Reference decode failed')
    events=[]
    for c in range(4):
        events.append(dict(card=c,thresholds={str(t):next((r['time'] for r in rows if r['gold'][c]>t),None) for t in [.05,.15,.3]}))
    summary.append(dict(video=video,modeled_card_origin=anchor,origin_note='joint spread/prompt fit; not a hidden client formula',
        gold_threshold_events=events,prompt_first=next(r['time'] for r in rows if r['hint']>100),
        counter_first=next(r['time'] for r in rows if r['digit']>80),blue_addition_fit=blue_fit,gold_native_fit=fit))
    samples.extend(rows)
canvas=Image.new('RGB',(2160,350),'#223344');draw=ImageDraw.Draw(canvas)
for n,(video,time,im) in enumerate(shots):
    x=n%6*360;y=n//6*175;canvas.paste(im,(x,y+25));draw.text((x+5,y+5),f'V{video} {time:.4f}s',fill='white')
canvas.save(a.out/'reference-contact.jpg')
(a.out/'measurement.json').write_text(json.dumps(summary,indent=2)+'\n')
(a.out/'samples.json').write_text(json.dumps(samples,indent=2)+'\n')
print(json.dumps(summary,indent=2))
