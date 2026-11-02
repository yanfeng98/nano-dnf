#!/usr/bin/env python3
"""Export selected facts from the owner's local PVF, without unpacking all scripts.

Binary format references (reader implementation written for this small audit):
https://github.com/similing4/pvf/blob/master/chunk.md
https://github.com/zjysun/dnf-pvf-parser-ts/blob/main/src/pvf/binaryAni.ts
The installed client is the source of the exported facts; reader documentation
is not evidence of recording-version balance or learned skill levels.
"""
from pathlib import Path
import struct, numpy as np
import argparse, json
parser=argparse.ArgumentParser(description="Read local basic-skill identity and animation evidence; never modifies the client")
parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
parser.add_argument('--out', type=Path, default=Path('/tmp/nano-client-basic-skills.json'))
args=parser.parse_args()
p=args.client/'Script.pvf'; f=p.open('rb')
u=lambda b,o=0:struct.unpack_from('<I',b,o)[0]
def dec(data,crc):
 a=np.frombuffer(data,dtype='<u4') ^ np.uint32(crc ^ 0x81A79011)
 return ((a >> 6) | (a << 26)).tobytes()
size=u(f.read(4));f.read(size);version,length,crc,count=struct.unpack('<4I',f.read(16));base=f.tell()+length
tree=dec(f.read(length),crc);entries={};pos=0
for i in range(count):
 number,n=struct.unpack_from('<2I',tree,pos);pos+=8
 name=tree[pos:pos+n].decode('cp949',errors='replace').replace('\\','/').lower();pos+=n
 size,crc,offset=struct.unpack_from('<3I',tree,pos);pos+=12;entries[name]=(size,crc,offset)
def read(name):
 size,crc,offset=entries[name];f.seek(base+offset);return dec(f.read((size+3)&~3),crc)[:size]
st=read('stringtable.bin')
def string(n):
 start,end=struct.unpack_from('<2I',st,4+n*4)
 return st[4+start:4+end].decode('big5',errors='replace')

def tokens(name):
 b=read(name);out=[]
 for i in range(2,len(b)-4,5):
  ty=b[i];val=u(b,i+1)
  out.append((ty,string(val) if ty in [5,6,7,8,10] else val))
 return out
def parse(data):
 pos=0
 def take(fmt):
  nonlocal pos
  v=struct.unpack_from('<'+fmt,data,pos);pos+=struct.calcsize('<'+fmt);return v[0] if len(v)==1 else list(v)
 frames=take('H');paths=[]
 for _ in range(take('H')):
  n=take('I');paths.append(data[pos:pos+n].decode());pos+=n
 def prop():
  nonlocal pos
  ty=take('H')
  fmts={0:'B',1:'B',3:'H',7:'2f',8:'f',9:'4B',10:'B',11:'H',12:'i',13:'H',17:'',23:'I',24:'H',25:'',26:'I',27:'4h',28:'H'}
  if ty==16:
   n=take('I'); v=data[pos:pos+n].decode();pos+=n
  elif ty==18:
   v=take('B2i4BH')
  elif ty in fmts:
   v=take(fmts[ty]) if fmts[ty] else None
   if ty==11 and v==5:take('3B')
   if ty==11 and v==6:take('2h')
  else:raise ValueError((ty,pos))
  return ty,v
 overall=[prop() for _ in range(take('H'))];out=[]
 for i in range(frames):
  boxes=[]
  for _ in range(take('H')):boxes.append((take('H'),take('6i')))
  img=take('h');idx=take('H') if img!=-1 else None
  xy=take('2i');props=[prop() for _ in range(take('H'))]
  out.append({'frame':idx,'xy':xy,'props':props,'boxes':boxes})
 assert pos==len(data),(pos,len(data))
 return {'paths':paths,'overall':overall,'frames':out}

result={'client_pvf':{'file':'Script.pvf','bytes':p.stat().st_size,'version':version},'skills':[],'animations':{}}
for name in ['skill/swordman/hardattack.skl','skill/swordman/upperslash.skl','skill/swordman/normalwave.skl']:
 tok=tokens(name); record={'path':name}; section=None; in_dungeon=False
 for ty,val in tok:
  if ty==5:
   section=val
   if val=='[dungeon]':in_dungeon=True
   elif val=='[/dungeon]':in_dungeon=False
  elif section in ['[name]','[name2]','[icon]']:
   record.setdefault(section,[]).append(val)
  elif in_dungeon and section in ['[consume MP]','[cool time]']:
   record.setdefault(section,[]).append(val)
 result['skills'].append(record)
for name in ['character/swordman/animation/hardattack.ani','character/swordman/effect/animation/hardattack1.ani','character/swordman/effect/animation/hardattack2.ani']:
 decoded=parse(read(name))
 result['animations'][name]={'paths':decoded['paths'],'frames':[
  {'image':v['frame'],'position':v['xy'],'delay_ms':dict(v['props']).get(12),
   'graphic_effect':dict(v['props']).get(11)} for v in decoded['frames']]}
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f"Client skill identities and native animation timings -> {args.out}")
