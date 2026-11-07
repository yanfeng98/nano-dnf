#!/usr/bin/env python3
"""Bake UI portraits from the local client. No video pixels enter game assets.

Monster face links: taubeast.mob -> MonsterFace f16; kurogaru.mob -> f13.
The reward avatar is the Swordman job's defaultfaces f0. The steel portrait
frame is the first 36x36 of monster_hp f11; the name plate is reward f60.
Appended frames preserve that first atlas section and add ordinary faces,
full native target tracks/end caps, the death cross and three ALERT tiles.
"""
import argparse,hashlib,io,json
from pathlib import Path
from PIL import Image
from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
ROOT=Path(__file__).resolve().parents[1]
SOURCES=[
 ('player','ImagePacks2_70','sprite_character.NPK','sprite/character/defaultfaces.img',0,None),
 ('boss','ImagePacks2_70','sprite_monster.NPK','sprite/monster/monsterface.img',16,None),
 ('lugaruBoss','ImagePacks2_70','sprite_monster.NPK','sprite/monster/monsterface.img',13,None),
 ('frame','ImagePacks2_70','sprite_interface_newstyle_windows_monster_hp.NPK','sprite/interface/newstyle/windows/monster_hp/monster_hp.img',11,(0,0,36,36)),
 ('namePlate','ImagePacks2','sprite_interface2_reward_ver2.0.NPK','sprite/interface2/reward_ver2.0/reward_ver2.img',60,None),
]

# MonsterFace links from Script_70.pvf; champion recolours reuse their base face.
for name,index in [('grunt',0),('coward',1),('caster',4),('brute',15),('elite',3),
                   ('goblinBlue',7),('goblinRed',9),('cat',11),('throwerElite',2)]:
 SOURCES.append((name,'ImagePacks2_70','sprite_monster.NPK','sprite/monster/monsterface.img',index,None))
for name,index in [('deathCross',0),('normalFrame',1),('normalFill',2),('normalCap',8),
                   ('championFrame',9),('championCap',10),('bossFrame',11),('bossCap',12),
                   ('alertRed',13),('alertOrange',14),('alertGreen',15)]:
 SOURCES.append((name,'ImagePacks2_70','sprite_interface_newstyle_windows_monster_hp.NPK',
  'sprite/interface/newstyle/windows/monster_hp/monster_hp.img',index,None))

def frames(client):
 for name,folder,pack,entry,index,crop in SOURCES:
  with (client/folder/pack).open('rb') as f:
   item=next(e for e in NPK.open(f).files if e.name.replace('\\','/')==entry)
   obj=IMGFactory.open(io.BytesIO(item.data));frame=obj.images[index]
   while type(frame).__name__=='ImageLink':frame=obj.images[frame.index]
   source=obj.build(frame).convert('RGBA');image=source.crop(crop) if crop else source
   yield name,image,dict(folder=folder,pack=pack,entry=entry,frame=index,crop=list(crop) if crop else None,
    source_size=list(source.size),source_rgba_sha256=hashlib.sha256(source.tobytes()).hexdigest(),
    rgba_sha256=hashlib.sha256(image.tobytes()).hexdigest())
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
 p.add_argument('--out',type=Path,default=ROOT/'assets/portraits-reference.png')
 a=p.parse_args();items=list(frames(a.client));sheet=Image.new('RGBA',(sum(im.width for _,im,_ in items),max(im.height for _,im,_ in items)))
 table=[];x=0
 for name,im,meta in items:
  sheet.paste(im,(x,0));table.append(dict(name=name,rect=[x,0,im.width,im.height],**meta));x+=im.width
 a.out.parent.mkdir(parents=True,exist_ok=True);sheet.save(a.out)
 print(json.dumps(dict(sheet=list(sheet.size),frames=table),indent=2))
if __name__=='__main__':main()
