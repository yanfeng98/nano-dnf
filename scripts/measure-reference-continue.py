#!/usr/bin/env python3
"""Contact sheets proving world play after rewards. Video pixels are audit evidence only."""
import argparse, subprocess
from pathlib import Path
from PIL import Image, ImageDraw

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--videos', type=Path, default=Path('../dnf-素材'))
    p.add_argument('--out', type=Path, default=Path('/tmp/nano-continue-reference'))
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    for video, times in [(1, [355,356,357,358,359,360]), (2, [408,409,410,412,414,415])]:
        source = next(a.videos.glob(f'{video:05d}-*.mp4'))
        sheet = Image.new('RGB', (1080,580)); draw = ImageDraw.Draw(sheet)
        for i, seconds in enumerate(times):
            target = a.out / f'v{video}-{seconds}.png'
            subprocess.run(['ffmpeg','-loglevel','error','-ss',str(seconds-.001),'-i',str(source),
                '-frames:v','1','-vf','crop=1440:1080:240:0,scale=720:540','-y',str(target)], check=True)
            x,y = i%3*360,i//3*290
            with Image.open(target) as im: sheet.paste(im.resize((360,270)),(x,y+20))
            draw.text((x,y), f'V{video} {seconds}s', fill='white')
        sheet.save(a.out / f'v{video}-continue-reference.jpg', quality=90)

if __name__ == '__main__': main()
