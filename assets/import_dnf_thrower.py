#!/usr/bin/env python3
"""Bake the brown throwing captain's native body6 without touching the old atlas.

Script_70.pvf: goblinthrowertaskmaster.mob -> Animation_Gero -> body6.img,
MonsterFace f6. Blue GoblinTaskmaster remains in monsters.png row9.
"""
import argparse,hashlib,io,json
from pathlib import Path
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
from import_dnf_monsters import offset_of,ground_of
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
 p.add_argument('--out',type=Path,default=ROOT/'assets/thrower-reference.png');a=p.parse_args()
 pack='sprite_monster_goblin.NPK';entry='sprite/monster/goblin/body6.img'
 with (a.client/'ImagePacks2'/pack).open('rb') as f:
  item=next(e for e in NPK.open(f).files if e.name.replace('\\','/')==entry)
  obj=IMGFactory.open(io.BytesIO(item.data));frames=[]
  for im in obj.images:
   while type(im).__name__=='ImageLink':im=obj.images[im.index]
   x,y=offset_of(im);frames.append((obj.build(im).convert('RGBA'),x,y))
 foot=ground_of(frames);cw,ch=360,420;ax,ay=180,260
 sheet=Image.new('RGBA',(cw*len(frames),ch));proof=[]
 for i,(im,x,y) in enumerate(frames):
  cell=Image.new('RGBA',(cw,ch));paste=(round(ax+x-foot[0]),round(ay+y-foot[1]))
  cell.paste(im,paste);sheet.paste(cell,(i*cw,0))
  proof.append({'frame':i,'rect':[i*cw,0,cw,ch],'source_size':list(im.size),'native_xy':[x,y],
   'paste_xy':list(paste),'source_rgba_sha256':hashlib.sha256(im.tobytes()).hexdigest(),
   'cell_rgba_sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
 a.out.parent.mkdir(parents=True,exist_ok=True);sheet.save(a.out)
 print(json.dumps({'folder':'ImagePacks2','pack':pack,'entry':entry,'sheet':list(sheet.size),
  'cell':[cw,ch],'anchor':[ax,ay],'native_ground':list(foot),'stand':frames[0][0].getbbox()[3]-frames[0][0].getbbox()[1],
  'frames':proof},indent=2))
if __name__=='__main__':main()
