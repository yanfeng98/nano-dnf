#!/usr/bin/env python3
"""Copy native green XP digits and plus; the localized Chinese label is excluded."""
import argparse,hashlib,io,json
from pathlib import Path
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=ROOT/'assets/experience-digits.png')
p.add_argument('--proof',type=Path,default=ROOT/'docs/reference-evidence/123-experience-digits-source.json')
a=p.parse_args();pack='sprite_common_etc.NPK';entry='sprite/common/etc/expup.img'
with (a.client/'ImagePacks2'/pack).open('rb') as f:
 item=next(e for e in NPK.open(f).files if e.name==entry)
 obj=IMGFactory.open(io.BytesIO(item.data));atlas=Image.new('RGBA',(176,16));rows=[]
 for slot,index in enumerate(list(range(10))+[11]):
  frame=obj.images[index];im=obj.build(frame).convert('RGBA')
  assert frame.x==0 and im.width<=16 and frame.y+im.height<=16
  atlas.alpha_composite(im,(slot*16,frame.y))
  rows.append(dict(character=str(index) if index<10 else '+',frame=index,rect=[slot*16,frame.y,im.width,im.height],
      offset=[frame.x,frame.y],advance=im.width+1,rgbaSha256=hashlib.sha256(im.tobytes()).hexdigest()))
a.out.parent.mkdir(parents=True,exist_ok=True);atlas.save(a.out)
a.proof.parent.mkdir(parents=True,exist_ok=True)
a.proof.write_text(json.dumps(dict(folder='ImagePacks2',pack=pack,entry=entry,cell=[16,16],glyphs=rows,
 atlasRgbaSha256=hashlib.sha256(atlas.tobytes()).hexdigest(),limits=['Original pixels, no recoloring, scaling, keying or font painting.','Native frame10 says Chinese experience and is not exported; the English suffix is still a fallback.','Advances follow glyph width plus one; exact engine kerning remains unverified.']),indent=2)+'\n')
print('native XP glyphs',[(r['character'],r['rect'],r['advance']) for r in rows])
