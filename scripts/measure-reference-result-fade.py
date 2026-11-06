#!/usr/bin/env python3
"""Measure reward-to-world fade in both local recordings; outputs audit evidence only."""
import argparse, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
    p.add_argument('--out',type=Path,default=Path('/tmp/nano-result-fade-reference'))
    a=p.parse_args(); a.out.mkdir(parents=True,exist_ok=True); results=[]
    for video,start in [(1,355),(2,407.5)]:
        source=next(a.videos.glob(f'{video:05d}-*.mp4'))
        raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start-.001),'-i',str(source),
            '-t','1.6','-vf','crop=1440:1080:240:0,scale=720:540',
            '-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True).stdout
        frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3)
        # This fixed header patch excludes the cursor, player, menu and prize row.
        samples=frames[:,60:130,300:420].astype(float).reshape(len(frames),-1)
        full=samples[:4].mean(0); world=samples[-4:].mean(0); delta=full-world
        opacity=((samples-world)@delta)/(delta@delta)
        best=None
        for onset in np.arange(0,.7,1/300):
            for duration in np.arange(.3,1.001,1/300):
                expected=np.clip(1-(np.arange(len(frames))/30-onset)/duration,0,1)
                mse=float(np.mean((expected-opacity)**2))
                if best is None or mse<best['mse']:
                    best=dict(mse=mse,onset=float(start+onset),duration=float(duration))
        results.append(dict(video=video,region=[300,60,120,70],fit=best,
            assumptions='Linear RGB projection between local full-overlay and clear-world samples; approximate, not a client formula.',
            samples=[dict(time=round(start+i/30,6),opacity=float(x)) for i,x in enumerate(opacity)]))
        sheet=Image.new('RGB',(1440,580)); draw=ImageDraw.Draw(sheet)
        for j,index in enumerate(range(0,len(frames),6)):
            x,y=j%4*360,j//4*290
            sheet.paste(Image.fromarray(frames[index]).resize((360,270)),(x,y+20))
            draw.text((x,y),f'V{video} {start+index/30:.3f}s',fill='white')
        sheet.save(a.out/f'v{video}-fade-contact.jpg',quality=90)
    (a.out/'measurement.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps([dict(video=r['video'],fit=r['fit']) for r in results],indent=2))

if __name__=='__main__': main()
