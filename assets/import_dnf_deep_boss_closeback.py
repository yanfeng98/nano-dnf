#!/usr/bin/env python3
"""Compose a native deep-room closeback list, preserving original order.

Only local client pixels. Tree4's measured -16 native-pixel Y correction and
screen Y=2 are reference calibration, not claims about the unmodified client.
The asset keeps right-edge overhang; physical room bounds remain separate.
"""
import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from client_pvf import PvfArchive
from client_animation import parse_animation
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--pvf',default='Script.pvf')
p.add_argument('--map',default='map/mirkwooddeep/b417(4,1).map')
p.add_argument('--tree4-y',type=int,default=-16)
p.add_argument('--tree0-y',type=int,default=0)
p.add_argument('--origin-x',type=int,default=0,help='native X coordinate at the left edge of the measured room')
p.add_argument('--out',type=Path)
a=p.parse_args();entry=a.map.lower();items=[];images={};animations={}
if a.out is None:
 if entry!='map/mirkwooddeep/b417(4,1).map':p.error('--out is required for a non-boss map')
 a.out=ROOT/'assets/deep-boss-closeback.png'
with PvfArchive(a.client/a.pvf) as pvf:
 tokens=pvf.tokens(entry)
 def section(name):
  start=next(i for i,q in enumerate(tokens)if q[1]=='['+name+']')+1
  end=next(i for i,q in enumerate(tokens[start:],start)if q[1]=='[/'+name+']')
  return tokens[start:end]
 placements=section('animation');assert len(placements)%5==0
 for i in range(0,len(placements),5):
  name,layer,x,y,z=[q[1]for q in placements[i:i+5]]
  if layer!='[closeback]':continue
  ani_entry=str(Path(entry).parent)+'/'+name.lower();raw=pvf.read(ani_entry);ani=parse_animation(raw)
  assert len(ani['frames'])==1 and len(ani['paths'])==1
  assert ani['overall']==[(1,0)],'unsupported overall animation transform'
  frame=ani['frames'][0];assert all(ty==12 for ty,value in frame['props'])
  source='sprite/'+ani['paths'][0].lower();key=(source,frame['frame'])
  if key not in images:images[key]=decode_at(a.client,'sprite_map.NPK',source,frame['frame'])
  im,offset=images[key];dx,dy=frame['xy'];adjust=a.tree4_y if name.lower()=='animation/tree4.ani'else a.tree0_y if name.lower()=='animation/tree0.ani'else 0
  items.append(dict(animation=name,source=source,frame=frame['frame'],pos=[x,y,z],ani_xy=[dx,dy],img_offset=list(offset),size=list(im.size),native_y_adjust=adjust,left=x+dx+offset[0],top=y+dy+offset[1]+80+adjust))
  animations[name]={'entry':ani_entry,'sha256':hashlib.sha256(raw).hexdigest(),'animation':ani}
 proof={'pvf':a.pvf,'version':pvf.version,'map_entry':entry,'map_sha256':hashlib.sha256(pvf.read(entry)).hexdigest(),'tile_count':len(section('tile')),'animations':animations}
assert len(items)>0
if entry=='map/mirkwooddeep/b417(4,1).map':assert len(items)==28
map_width=proof['tile_count']*224;width=max(map_width,max(q['left']+q['size'][0]for q in items))
canvas=Image.new('RGBA',(width,480))
for q in items:canvas.alpha_composite(images[(q['source'],q['frame'])][0],(q['left'],q['top']))
if a.origin_x:
 canvas=canvas.crop((a.origin_x,0,width,canvas.height))
 proof['raster_native_x_origin']=a.origin_x
a.out.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.out)
proof.update(size=list(canvas.size),map_native_width=map_width,raster_native_y_origin=80,screen_y=2,screen_native_scale=1.125,order='original closeback list; no sorting by Y',items=items,assets=[dict(source=name,frame=frame,size=list(im.size),offset=list(offset),rgba_sha256=hashlib.sha256(im.tobytes()).hexdigest())for(name,frame),(im,offset)in images.items()],rgba_sha256=hashlib.sha256(canvas.tobytes()).hexdigest(),limits=('Boss closeback only. Tree4 Y is measured, not native ANI. Other rooms, far/mid motion, floor and foreground layers remain unverified.' if entry=='map/mirkwooddeep/b417(4,1).map' else 'Selected room closeback only. Tree0/Tree4 Y must be checked against recording; other layers, rooms and lifecycle remain unverified.'))
print(json.dumps(proof,indent=2))
