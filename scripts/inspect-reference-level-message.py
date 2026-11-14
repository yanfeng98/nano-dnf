#!/usr/bin/env python3
"""Extract the V1 level3-to4 message transition for manual UI review, not OCR."""
import argparse,hashlib,io,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--video',type=Path,default=ROOT.parent/'dnf-素材/00001-幽暗密林.mp4')
p.add_argument('--out',type=Path,default=Path('/tmp/nano127-level-message-evidence'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
sheet=Image.new('RGB',(720,540));draw=ImageDraw.Draw(sheet);rows=[]
for i,(time,level,message) in enumerate([(96.8,3,None),(97,4,'[阿努纳奇]已达到Lv4'),
 (97.6,4,'[阿努纳奇]已达到Lv4'),(98,4,'[阿努纳奇]已达到Lv4')]):
 png=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(a.video),'-frames:v','1',
  '-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 name=f'127-v1-{time:g}-level-message.png';(a.out/name).write_bytes(png)
 im=Image.open(io.BytesIO(png));x=i%2*360;y=i//2*270
 sheet.paste(im.resize((360,270)),(x,y));draw.text((x,y),f'V1 {time:g}s Lv{level}',fill='red')
 rows.append(dict(time=time,frame=name,sha256=hashlib.sha256(png).hexdigest(),manualLevel=level,
  manualMessage=message,logRoi=[15,90,250,245],genericBannerObserved=False))
sheet.save(a.out/'127-level-message-contact.png')
report=dict(source=a.video.name,method='Manual reading; extraction is reproducible and is not OCR',samples=rows,
 firstLogRowApproximateY=102,limits=['The central generic LEVEL UP - Lv banner is not the native word near the character.',
 'Native level-up light pillar/word art and timing are not reconstructed by this message check.',
 'Font rasterization and exact text ink bounds remain uncalibrated; y102 is the row anchor used for layout.',
 'The observed upgrade time does not establish the numeric XP threshold or hidden character build.'])
(a.out/'127-level-message-reference.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('V1 level-message frames extracted:',[(r['time'],r['manualLevel']) for r in rows])
