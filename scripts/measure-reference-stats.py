#!/usr/bin/env python3
"""Rebuild local stats references. Video crops are audit evidence, never assets."""
from pathlib import Path
import argparse,io,json,subprocess
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos',type=Path,default=Path('../dnf-素材'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-stats39'))
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);evidence=[]
for v,start,length,held in [(1,332.5,10,339.0),(2,386.7,10.3,393.0)]:
 source=next(a.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(start),'-i',str(source),'-t',str(length),'-vf','crop=1440:1080:240:0,scale=720:540','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True).stdout
 frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,540,720,3);indices=list(range(0,len(frames),15))
 sheet=Image.new('RGB',(1440,290*((len(indices)+3)//4)));d=ImageDraw.Draw(sheet)
 for j,i in enumerate(indices):
  x,y=j%4*360,j//4*290;sheet.paste(Image.fromarray(frames[i]).resize((360,270)),(x,y+20));d.text((x,y),f'V{v} {start+i/30:.3f}',fill='white')
 sheet.save(a.out/f'39-v{v}-stats-contact.png')
 ref=Image.fromarray(frames[round((held-start)*30)]);ref.save(a.out/f'39-v{v}-stats-reference.png')
 ref.crop((129,320,288,480)).save(a.out/f'39-v{v}-rank-reference.png')
 ref.crop((405,154,589,179)).save(a.out/f'39-v{v}-bar-reference.png')
 evidence.append({'video':v,'source':source.name,'held_frame':held,'table':[104,68,512,214],'badge':[129,320,159,160],
  'limits':'Manual display geometry, not a scoring formula. Phase anchors remain approximate.',
  'relative_display_anchors':{'total':.5,'operation':1.1,'technique':1.9,'hits':2.7,'badge':3.6}})
(a.out/'39-stats-measurement.json').write_text(json.dumps(evidence,indent=2)+'\n')

# Preparatory evidence for the experience breakdown, not a payment formula.
finals=Image.new('RGB',(580,247));draw=ImageDraw.Draw(finals);xp=[]
for v,t,base,rank,channel,total in [(1,341.0,1760,528,88,2376),(2,396.0,4680,1404,234,6318)]:
 source=next(a.videos.glob(f'{v:05d}-*.mp4'))
 raw=subprocess.run(['ffmpeg','-loglevel','error','-ss',str(t),'-i',str(source),'-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540','-f','image2pipe','-vcodec','png','-'],capture_output=True,check=True).stdout
 im=Image.open(io.BytesIO(raw)).crop((330,285,620,512));finals.paste(im,((v-1)*290,20));draw.text(((v-1)*290,0),f'V{v} {t:.3f}',fill='white')
 assert base+rank+channel==total
 xp.append({'video':v,'final_frame':t,'base_observed':base,'rank_S_addition_observed':rank,
  'matched_channel_addition_observed':channel,'total_observed':total,'arithmetic_verified':True,
  'rank_ratio':rank/base,'channel_ratio':channel/base,
  'limits':'Two S-ranked observed outcomes; other grades, event bonuses, base XP and payment timing are not reconstructed.'})
finals.save(a.out/'40-xp-final-reference.png')
(a.out/'40-xp-observed-amounts.json').write_text(json.dumps(xp,indent=2)+'\n')
