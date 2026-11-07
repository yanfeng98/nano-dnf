#!/usr/bin/env python3
"""Measure death-cross pulses and panel disappearance at source 30fps.

Audit crops only. First visible cross is not assumed to be the fatal-hit frame.
Run sequentially, after tests/browser processes have finished on this host.
"""
import argparse,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--video',type=Path,default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out',type=Path,default=Path('/tmp/nano-target-death-evidence'))
a=p.parse_args()
if a.out.resolve().is_relative_to(ROOT/'assets'):p.error('video evidence cannot be written to runtime assets')
a.out.mkdir(parents=True,exist_ok=True);records=[]
contact=Image.new('RGB',(1200,9*65),'#171717');draw=ImageDraw.Draw(contact)
for column,(name,start,indices) in enumerate([
 ('normal',99.5,[9,11,15,19,26,34,41,49,50]),
 ('boss',328.0,[6,9,12,17,24,31,32,36,37])]):
 folder=a.out/name;folder.mkdir(exist_ok=True)
 subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(a.video),'-t','2',
  '-vf','fps=30,crop=1200:100:240:80,scale=600:50','-y',str(folder/'%03d.png')],check=True)
 rows=[];files=sorted(folder.glob('*.png'))
 for i,file in enumerate(files):
  image=Image.open(file).convert('RGB');pixels=np.array(image).astype(int)
  face=pixels[7:37,7:36];r,g,b=face[:,:,0],face[:,:,1],face[:,:,2]
  red=int(np.count_nonzero((r>150)&(r>g*2.5)&(r>b*2.5)))
  border=pixels[22:24,100:210] if name=='normal' else pixels[5:8,200:550]
  r,g,b=border[:,:,0],border[:,:,1],border[:,:,2]
  mask=(r>100)&(g>90)&(r>g*1.05)&(b<g*.9) if name=='normal' else (r>70)&(r>g*.9)&(r<g*1.3)&(g>b)&(b>40)
  count=int(mask.sum());present=count>(50 if name=='normal' else 200)
  rows.append({'time':round(start+i/30,6),'cross_red_pixels':red,'cross_on':red>90,
   'border_pixels':count,'panel_present':present,'ghost_probe_rgb':pixels[28,40,:3].tolist()})
 for row,i in enumerate(indices):
  image=Image.open(files[i]);contact.paste(image,(column*600,row*65+15))
  draw.text((column*600+2,row*65),f'{name} {start+i/30:.3f}s',fill='white')
 def runs(key):
  output=[]
  for row in rows:
   if not output or output[-1]['on']!=row[key]:output.append({'on':row[key],'start':row['time'],'end_inclusive':row['time'],'frames':1})
   else:output[-1]['end_inclusive']=row['time'];output[-1]['frames']+=1
  return output
 bright=[r for r in runs('cross_on') if r['on']]
 first=next(r['time'] for r in rows if r['cross_on']);gone=next(r['time'] for r in rows if r['time']>first and not r['panel_present'])
 records.append({'sample':name,'first_cross':first,'panel_gone':gone,'visible_cross_to_gone':round(gone-first,6),
  'bright_start_intervals':[round(bright[i]['start']-bright[i-1]['start'],6) for i in range(1,len(bright))],
  'cross_runs':runs('cross_on'),'panel_runs':runs('panel_present'),'rows':rows})
contact.save(a.out/'death-sequence.png')
(a.out/'death-measurement.json').write_text(json.dumps({'video':a.video.name,'fps':30,
 'crop':'original (240,80,1200,100), normalize to 600x50; source-time samples ±1 frame',
 'scope':'Measures visible pulses and removal; fatal-hit onset, other monsters and universal hold rules remain unproven.',
 'samples':records},ensure_ascii=False,indent=2)+'\n')
print('Target death evidence ->',a.out)
