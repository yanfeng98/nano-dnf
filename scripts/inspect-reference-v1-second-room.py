#!/usr/bin/env python3
"""Extract V1 second-room logs and targets for manual event review, without OCR."""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out', type=Path, default=Path('/tmp/nano149-v1-second-room'))
p.add_argument('--start', type=float, default=76)
p.add_argument('--duration', type=float, default=50)
p.add_argument('--stride', type=int, default=15)
a = p.parse_args()
if a.start < 0 or a.duration <= 0 or a.stride < 1 or abs(a.start*30-round(a.start*30)) > 1e-6:
    p.error('use a nonnegative30fps-aligned start, positive duration and stride')
if a.out.resolve().is_relative_to(ROOT/'assets'):
    p.error('recording pixels are evidence, not runtime artwork')
a.out.mkdir(parents=True, exist_ok=True)
raw = subprocess.run(['ffmpeg','-loglevel','error','-threads','1','-ss',str(a.start),'-i',str(a.video),
    '-t',str(a.duration),'-vf',f"select='not(mod(n,{a.stride}))',crop=1440:1080:240:0,scale=720:540",
    '-vsync','0','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
frames = np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3)
assert len(frames)==math.ceil(a.duration*30/a.stride-1e-9), len(frames)
rows=[]
for page in range(math.ceil(len(frames)/20)):
    logs=Image.new('RGB',(1200,1600),'#181818');targets=Image.new('RGB',(1440,1000),'#181818')
    ld,td=ImageDraw.Draw(logs),ImageDraw.Draw(targets)
    for i,rgb in enumerate(frames[page*20:(page+1)*20]):
        t=a.start+(page*20+i)*a.stride/30;im=Image.fromarray(rgb);name=f'149-v1-{t:g}-second-room.png'
        im.save(a.out/name)
        rows.append({'time':t,'frame':name,'sha256':hashlib.sha256((a.out/name).read_bytes()).hexdigest()})
        x,y=i%4*300,i//4*320;ld.text((x,y),f'V1 {t:g}s',fill='white')
        logs.paste(im.crop((12,95,252,345)),(x,y+20))
        x,y=i%2*720,i//2*100;td.text((x,y),f'V1 {t:g}s',fill='white')
        targets.paste(im.crop((0,43,360,85)).resize((720,84)),(x,y+16))
    logs.save(a.out/f'149-v1-logs-{page}.png');targets.save(a.out/f'149-v1-targets-{page}.png')
report={'video':a.video.name,'sourceFps':30,'start':a.start,'strideFrames':a.stride,'samples':rows,
        'limits':['Manual log/target review required; extraction does not infer a roster or event count.',
                  'The97s upgrade segment may need finer temporal samples to resolve repeated XP/SP rows.',
                  'No runtime room assignment, enemy behavior or progression value is changed.']}
(a.out/'149-v1-second-room-extraction.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'Extracted{len(frames)} frames at stride{a.stride}; manual room boundaries and ledger remain to review.')
