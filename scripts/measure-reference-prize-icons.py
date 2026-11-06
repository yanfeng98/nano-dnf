#!/usr/bin/env python3
"""Compare local native prize icons with audit-only crops from both recordings."""
import argparse,io,json,subprocess,sys
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'assets'))
import import_dnf_results as native

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
    p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
    p.add_argument('--out',type=Path,default=Path('/tmp/nano-prize-icons-reference'))
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    icons={n:(im,meta) for n,im,meta in native.frames(a.client) if n in ['staffIcon','totemIcon']}
    measurements=[];sheet=Image.new('RGB',(880,600),'#142033');d=ImageDraw.Draw(sheet)
    for i,(v,t,label) in enumerate([(1,354,'staffIcon'),(1,355,'staffIcon'),(2,406,'totemIcon'),(2,407,'totemIcon')]):
        video=next(a.videos.glob(f'{v:05d}-*.mp4'))
        data=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(t-.001),'-i',str(video),
            '-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],
            capture_output=True,check=True).stdout
        reference=Image.open(io.BytesIO(data)).convert('RGB');ref=np.array(reference)
        im,meta=icons[label];source=np.array(im.convert('RGB'));best=None
        for scale in np.arange(.8,1.301,.005):
            scaled=cv2.resize(source,None,fx=scale,fy=scale,interpolation=cv2.INTER_NEAREST)
            match=cv2.matchTemplate(ref[180:255,:180],scaled,cv2.TM_CCOEFF_NORMED)
            _,score,_,pos=cv2.minMaxLoc(match)
            if best is None or score>best['score']:
                best=dict(score=score,scale=float(scale),x=pos[0],y=pos[1]+180,size=list(scaled.shape[:2][::-1]))
        def foreground(rgb):
            rgb=rgb.astype(float)
            if label=='staffIcon':
                mask=(rgb[:,:,0]>60)&(rgb[:,:,0]>1.25*rgb[:,:,1])&(rgb[:,:,0]>1.25*rgb[:,:,2])
            else:
                mask=(rgb[:,:,1]>70)&(rgb[:,:,1]>1.2*rgb[:,:,0])&(rgb[:,:,1]>1.05*rgb[:,:,2])
            return mask.astype('uint8')*255
        foreground_best=None
        for scale in np.arange(.8,1.301,.005):
            scaled=cv2.resize(foreground(source),None,fx=scale,fy=scale,interpolation=cv2.INTER_NEAREST)
            match=cv2.matchTemplate(foreground(ref[195:240,60:115]),scaled,cv2.TM_CCOEFF_NORMED)
            _,score,_,pos=cv2.minMaxLoc(match)
            if foreground_best is None or score>foreground_best['score']:
                foreground_best=dict(score=score,scale=float(scale),x=pos[0]+60,y=pos[1]+195,size=list(scaled.shape[:2][::-1]))
        measurements.append(dict(video=v,time=t,icon=label,source=meta,fit=best,foreground_fit=foreground_best,
            caution='Whole-icon RGB fit includes black dithering; use foreground/held-out frames to judge size.'))
        reference.crop((9,188,181,297)).save(a.out/f'{label}-{t}-reference.png')
        x,y=i%2*440,i//2*300
        sheet.paste(reference.crop((0,180,190,305)).resize((380,250)),(x,y+25))
        enlarged=im.resize((56,56),Image.Resampling.NEAREST);sheet.paste(enlarged,(x+380,y+80),enlarged)
        d.text((x,y+5),f'V{v} {t}s: reference + local {label}',fill='white')
    sheet.save(a.out/'reference-native-contact.jpg',quality=90)
    (a.out/'measurement.json').write_text(json.dumps(measurements,indent=2)+'\n')
    print(json.dumps([dict(video=x['video'],fit=x['fit'],foreground_fit=x['foreground_fit']) for x in measurements],indent=2))

if __name__=='__main__':main()
