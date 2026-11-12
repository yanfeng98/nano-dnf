#!/usr/bin/env python3
"""Export the source-backed room24 west gate, including mirrored bushes.

Raw object int data is retained. Concrete02 art is checked against the film;
this export does not claim native open/fade/light timing or travel semantics.
"""
import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from client_pvf import PvfArchive
from client_animation import parse_animation
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,default=ROOT/'assets/native-pathgate.png');p.add_argument('--proof',type=Path,default=ROOT/'docs/reference-evidence/103-room24-west-gate-source.json');p.add_argument('--entry',type=Path,default=Path('/tmp/nano103-native-gate-entry.json'));a=p.parse_args()
mapname='map/mirkwooddeep/n410(3,0).map';objectname='passiveobject/mapobject/pathgate/act1/mirkwoodleftnormal.obj';dungeon='dungeon/act1/mirkwooddeep.dgn';images={};parts={};animations={}
with PvfArchive(a.client/'Script.pvf') as pvf:
 obj=[v for _,v in pvf.tokens(objectname)];mapValues=[v for _,v in pvf.tokens(mapname)];dgn=[v for _,v in pvf.tokens(dungeon)];i=dgn.index('[pathgate object]');assert 371 in dgn[i+1:i+11]
 anchor=mapValues[mapValues.index('[pathgate pos]')+1:mapValues.index('[pathgate pos]')+3];assert anchor==[16,244]
 sourceNames={'under':'GranFlorisLeftU1','frame':'GranFlorisLeftGate','door':'GranFlorisLeftCloseDoor','light':'GranFlorisLeftLight','over':'GranFlorisLeftO1'}
 for part,name in sourceNames.items():
  entry='passiveobject/mapobject/pathgate/act1/animation/'+name.lower()+'.ani';raw=pvf.read(entry);ani=parse_animation(raw,include_image=True);assert len(ani['frames'])>=1
  f=ani['frames'][0];sx,sy=dict(f['props']).get(7,[1,1]);assert abs(sx)==1 and sy==1
  # Material02 is used by this object; the native light material is01.
  material='01' if part=='light' else '02';imagePath='sprite/'+ani['paths'][f['image']].replace('%d%d',material).lower();key=(imagePath,f['frame'],sx<0)
  if key not in images:
   im,offset=decode_at(a.client,'sprite_map_pathgate.NPK',imagePath,f['frame']);originalHash=hashlib.sha256(im.tobytes()).hexdigest()
   if sx<0:im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
   images[key]=(im,offset,sum(v[0].width for v in images.values()),originalHash)
  im,offset,atlasX,originalHash=images[key]
  dx=(f['xy'][0]+offset[0])*sx+(-im.width if sx<0 else 0);dy=f['xy'][1]+offset[1]
  parts[part]={'rect':[atlasX,0,im.width,im.height],'offset':[dx,dy]}
  animations[part]={'entry':entry,'sha256':hashlib.sha256(raw).hexdigest(),'data':ani,'concreteImage':imagePath,'material':material}
 proof={'dungeon':dungeon,'dungeonSha256':hashlib.sha256(pvf.read(dungeon)).hexdigest(),'map':mapname,'mapSha256':hashlib.sha256(pvf.read(mapname)).hexdigest(),'object':objectname,'objectSha256':hashlib.sha256(pvf.read(objectname)).hexdigest(),'objectTokens':obj,'animations':animations}
assert parts['over']['offset']==[-67,-11] and parts['frame']['offset']==[-36,-193]
canvas=Image.new('RGBA',(sum(v[0].width for v in images.values()),max(v[0].height for v in images.values())))
for im,offset,x,h in images.values():canvas.alpha_composite(im,(x,0))
a.out.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.out);gate={'anchor':anchor,'parts':parts};a.entry.write_text(json.dumps(gate,indent=2)+'\n')
proof.update(gate=gate,screenScale=1.125,screenYPhase=92,atlasSize=list(canvas.size),atlasRgbaSha256=hashlib.sha256(canvas.tobytes()).hexdigest(),images=[{'path':key[0],'frame':key[1],'flipX':key[2],'offset':list(v[1]),'rect':[v[2],0,v[0].width,v[0].height],'originalRgbaSha256':v[3],'bakedRgbaSha256':hashlib.sha256(v[0].tobytes()).hexdigest()} for key,v in images.items()],limits=['The object raw int sequence is preserved; its first values are not interpreted as engine state opcodes.','Static frame/bush poses have video evidence; under-bush pixels are partly hidden by the frame and video text.','Open/fade/light timing and entry-door passability versus visible bars remain unresolved.','The native LeftDoor tile and other gates are outside this slice.'])
a.proof.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');print('gate atlas',canvas.size,'parts',parts)
