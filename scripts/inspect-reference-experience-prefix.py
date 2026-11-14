#!/usr/bin/env python3
"""Extract consecutive XP floats for manual prefix inspection; not OCR."""
import argparse,hashlib,io,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
from pydnfex.npk import NPK
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=ROOT.parent/'dnf-素材')
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano124-experience-prefix'))
p.add_argument('--scan-client',action='store_true')
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cases=[(1,71.3,(370,205,455,250),'80',False),
 (1,71.5,(370,190,455,235),'80',False),
 (1,71.7,(370,190,455,235),'80',None),
 (2,15.8,(370,105,455,150),'50',False),
 (2,16,(370,85,455,130),'50',False),
 (2,16.2,(370,85,455,130),'50',False),
 (1,73.6,(330,180,415,225),'40',False),
 (1,73.8,(275,175,360,220),'40',False),
 (1,74,(275,175,360,220),'40',None)]
sheet=Image.new('RGB',(1020,660),'#181818');draw=ImageDraw.Draw(sheet);rows=[]
for i,(video,time,box,amount,prefix) in enumerate(cases):
 source=next(a.videos.glob(f'{video:05d}-*.mp4'))
 png=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(source),
  '-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540',
  '-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 name=f'124-v{video}-{time:g}-experience-prefix.png';(a.out/name).write_bytes(png)
 im=Image.open(io.BytesIO(png));x=i%3*340;y=i//3*220
 sheet.paste(im.crop(box).resize((340,180),Image.Resampling.NEAREST),(x,y+25))
 draw.text((x,y),f'V{video} {time:g}s',fill='white')
 rows.append(dict(video=video,time=time,frame=name,frameSha256=hashlib.sha256(png).hexdigest(),
  roi=list(box),manualAmount=amount,manualVisiblePlus=prefix,
  limitation='Occluded by item label; no prefix conclusion' if time==71.7 else
   'Text no longer visible; no prefix conclusion' if time==74 else
   'Manual float-caption reading; digit4 checked against native glyph in audit123'))
sheet.save(a.out/'124-experience-prefix-contact.png')
report=dict(method='Manual reading of consecutive original frames, not OCR',samples=rows,
 limits=['Only these three death events are established here; clear rewards and other floating messages are separate.',
  'The old +40 description confused the italic 4 with a plus. Native glyph matching is in audit123.'])
if a.scan_client:
 matches=[];checked=0
 for folder in ['ImagePacks2','ImagePacks2_70']:
  for pack in sorted((a.client/folder).glob('*')):
   if pack.suffix.lower()!='.npk' or not any(s in pack.name.lower() for s in ['sprite_common','sprite_interface']):continue
   with pack.open('rb') as f:
    for entry in NPK.open(f).files:
     if any(s in entry.name.lower() for s in ['expup','experience']):
      matches.append(dict(folder=folder,pack=pack.name,entry=entry.name))
   checked+=1
 report['clientSearch']=dict(scope='Common and interface pack indices only, not a whole-client absence proof',packsChecked=checked,matches=matches)
(a.out/'124-experience-prefix.json').write_text(json.dumps(report,indent=2)+'\n')
print('XP float evidence:',len(rows),'frames; seven readable samples, two inconclusive')
