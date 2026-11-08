#!/usr/bin/env python3
"""Measure stable pre/post-clear XP bars; test local-table hypotheses only.

The level-up full-bar animation is deliberately excluded. No runtime progression
or reward data is modified. Pixel endpoints have a conservative two-pixel error.
"""
import argparse, io, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--videos', type=Path, default=Path('../dnf-素材'))
p.add_argument('--client-evidence', type=Path, default=Path('docs/reference-evidence/41-client-experience.json'))
p.add_argument('--out', type=Path, default=Path('/tmp/nano-xp42'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
values = json.loads(a.client_evidence.read_text())['clients'][0]['entries']['character/exptable.tbl']['raw_values']
sheet = Image.new('RGB', (900, 320))
draw = ImageDraw.Draw(sheet)
reports = []
for row, (video, before, after, level, payout) in enumerate([(1,332.5,357,4,2376),(2,386.7,410,6,6318)]):
    samples = []
    source = next(a.videos.glob(f'{video:05d}-*.mp4'))
    for col, time in enumerate([before, after]):
        raw = subprocess.run(['ffmpeg','-loglevel','error','-ss',str(time),'-i',str(source),
            '-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540',
            '-f','image2pipe','-vcodec','png','-'], capture_output=True, check=True).stdout
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        rgb = np.asarray(im).astype(float)
        strip = rgb[486:493,134:294]
        # Bright green XP fill, measured only in stable frames without magic FX.
        green = (strip[:,:,1] > 110) & (strip[:,:,1] > strip[:,:,0]*1.25) & (strip[:,:,1] > strip[:,:,2]*1.25)
        occupied = np.where(green.sum(axis=0) >= 3)[0]
        if not len(occupied) or occupied[0] > 2:
            raise ValueError(f'V{video} {time}: no connected green fill at track origin')
        end = 0
        while end < 160 and green.sum(axis=0)[end] >= 3:
            end += 1
        fraction = end/160
        samples.append({'time':time,'level':level+col,'fill_pixels':end,'track_pixels':160,
                        'fraction':fraction,'fraction_interval':[max(0,(end-2)/160),min(1,(end+2)/160)]})
        sheet.paste(im.crop((75,477,300,500)).resize((450,46)), (col*450,row*160+30))
        draw.text((col*450,row*160),f'V{video} {time}s Lv{level+col}, fill {end}/160',fill='white')
    hypotheses=[]
    for offset in [-1,0,1]:
        index=level-1+offset
        for semantics in ['per_level','cumulative']:
            current = values[index] if semantics=='per_level' else values[index]-values[index-1]
            following = values[index+1] if semantics=='per_level' else values[index+1]-values[index]
            lo,hi=samples[0]['fraction_interval'];post_lo,post_hi=samples[1]['fraction_interval']
            interval=[(1-hi)*current+post_lo*following,(1-lo)*current+post_hi*following]
            hypotheses.append({'semantics':semantics,'table_index_for_current_level':index,
                'index_offset_from_level_minus_one':offset,'current_threshold':current,
                'next_threshold':following,'required_credit_interval':interval,
                'observed_credit_inside_interval':interval[0]<=payout<=interval[1]})
    reports.append({'video':video,'source':source.name,'observed_clear_credit':payout,'samples':samples,
                    'local_table_hypotheses':hypotheses})
sheet.save(a.out/'42-xp-stable-bars.png')
result={'track':[134,486,160,7],'endpoint_uncertainty_pixels':2,'reports':reports,
        'limits':'Tests only the listed index/threshold interpretations, assuming the visible clear total is the sole net credit between frames. Does not establish server scaling, a replacement formula, or absence of other XP events. Full-bar level-up animation is not residual XP.'}
(a.out/'42-xp-stable-bars.json').write_text(json.dumps(result,indent=2)+'\n')
for report in reports:
    print('V',report['video'], [(s['level'],s['fill_pixels']) for s in report['samples']],
          'matching hypotheses:',[h for h in report['local_table_hypotheses'] if h['observed_credit_inside_interval']])
