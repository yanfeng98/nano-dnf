#!/usr/bin/env python3
"""Export a source-backed room24 side gate, with its normal or boss material.

Raw object int data is retained. Concrete material art is checked against the film;
this export does not claim native open/fade/light timing or travel semantics.
"""
import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from client_pvf import PvfArchive
from client_animation import parse_animation
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'));p.add_argument('--out',type=Path,default=None);p.add_argument('--proof',type=Path,default=None);p.add_argument('--entry',type=Path,default=None);p.add_argument('--direction',choices=['W','E'],default='W');p.add_argument('--boss',action='store_true');a=p.parse_args()
if a.out is None:a.out=ROOT/('assets/native-pathgate-east.png' if a.direction=='E' else 'assets/native-pathgate.png')
if a.proof is None:a.proof=ROOT/('docs/reference-evidence/104-room24-east-gate-source.json' if a.direction=='E' else 'docs/reference-evidence/103-room24-west-gate-source.json')
if a.entry is None:a.entry=Path('/tmp/nano104-native-east-entry.json' if a.direction=='E' else '/tmp/nano103-native-gate-entry.json')
mapname='map/mirkwooddeep/n410(3,0).map';side='Left' if a.direction=='W' else 'Right';objectname='passiveobject/mapobject/pathgate/act1/mirkwood'+side.lower()+('boss' if a.boss else 'normal')+'.obj';dungeon='dungeon/act1/mirkwooddeep.dgn';images={};parts={};animations={}
with PvfArchive(a.client/'Script.pvf') as pvf:
 obj=[v for _,v in pvf.tokens(objectname)];mapValues=[v for _,v in pvf.tokens(mapname)];dgn=[v for _,v in pvf.tokens(dungeon)];i=dgn.index('[pathgate object]');assert ((372 if a.boss else 371) if a.direction=='W' else (375 if a.boss else 374)) in dgn[i+1:i+11]
 start=mapValues.index('[pathgate pos]')+(1 if a.direction=='W' else 3);anchor=mapValues[start:start+2];assert anchor==([16,244] if a.direction=='W' else [1553,240])
 sourceNames={'under':'GranFlorisLeftU1','frame':'GranFlorisLeftGate','door':'GranFlorisLeftCloseDoor','light':'GranFlorisLeftLight','over':'GranFlorisLeftO1'}
 for part,name in sourceNames.items():
  name=name.replace('Left',side)
  assert 'Animation/'+name+'.ani' in obj
  entry='passiveobject/mapobject/pathgate/act1/animation/'+name.lower()+'.ani';raw=pvf.read(entry);ani=parse_animation(raw,include_image=True);assert len(ani['frames'])>=1
  f=ani['frames'][0];sx,sy=dict(f['props']).get(7,[1,1]);assert abs(sx)==1 and sy==1
  # Normal frame/leaf use02 and light01; boss frame/leaf use06 and light02.
  # Under/over vegetation remains02 in both native objects.
  material=('02' if a.boss else '01') if part=='light' else ('06' if a.boss and part in ['frame','door'] else '02');imagePath='sprite/'+ani['paths'][f['image']].replace('%d%d',material).lower();key=(imagePath,f['frame'],sx<0)
  if key not in images:
   im,offset=decode_at(a.client,'sprite_map_pathgate.NPK',imagePath,f['frame']);originalHash=hashlib.sha256(im.tobytes()).hexdigest()
   if sx<0:im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
   images[key]=(im,offset,sum(v[0].width for v in images.values()),originalHash)
  im,offset,atlasX,originalHash=images[key]
  dx=(f['xy'][0]+offset[0])*sx+(-im.width if sx<0 else 0);dy=f['xy'][1]+offset[1]
  parts[part]={'rect':[atlasX,0,im.width,im.height],'offset':[dx,dy]}
  animations[part]={'entry':entry,'sha256':hashlib.sha256(raw).hexdigest(),'data':ani,'concreteImage':imagePath,'material':material}
 proof={'dungeon':dungeon,'dungeonSha256':hashlib.sha256(pvf.read(dungeon)).hexdigest(),'map':mapname,'mapSha256':hashlib.sha256(pvf.read(mapname)).hexdigest(),'object':objectname,'objectSha256':hashlib.sha256(pvf.read(objectname)).hexdigest(),'objectTokens':obj,'animations':animations}
if a.direction=='W':assert parts['over']['offset']==[-67,-11] and parts['frame']['offset']==[-36,-193]
else:assert parts['over']['offset']==[-62,-50]
if a.direction=='E' and not a.boss:assert parts['frame']['offset']==[-120,-212]
canvas=Image.new('RGBA',(sum(v[0].width for v in images.values()),max(v[0].height for v in images.values())))
for im,offset,x,h in images.values():canvas.alpha_composite(im,(x,0))
a.out.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.out);gate={'anchor':anchor,'parts':parts};
if a.direction=='E':
 assert obj[obj.index('[layer]')+1]=='[bottom]'
 gate.update(layer='[bottom]',sprite='nativePathGateEast')
a.entry.write_text(json.dumps(gate,indent=2)+'\n')
proof.update(gate=gate,screenScale=1.125,screenYPhase=92,atlasSize=list(canvas.size),atlasRgbaSha256=hashlib.sha256(canvas.tobytes()).hexdigest(),images=[{'path':key[0],'frame':key[1],'flipX':key[2],'offset':list(v[1]),'rect':[v[2],0,v[0].width,v[0].height],'originalRgbaSha256':v[3],'bakedRgbaSha256':hashlib.sha256(v[0].tobytes()).hexdigest()} for key,v in images.items()],limits=['The object raw int sequence is preserved; its first values are not interpreted as engine state opcodes.','Static frame/bush poses have video evidence; under-bush pixels are partly hidden by the frame and video text.','Open/fade/light timing and entry-door passability versus visible bars remain unresolved.','The native LeftDoor tile and other gates are outside this slice.'])
if a.direction=='E':proof['limits']=['Static east gate pose and bottom layer come from the native map/object/ANI/IMG chain.','Open/fade/light timing and passability remain unresolved.','Native RightDoor tile collision semantics and other gates remain unverified.']
a.proof.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');print('gate atlas',canvas.size,'parts',parts)
