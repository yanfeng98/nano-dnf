#!/usr/bin/env python3
"""Read target UI identity links; no server balance is inferred from this client."""
from pathlib import Path
import struct, numpy as np
import argparse,json,hashlib
a=argparse.ArgumentParser(description='Read native target-face links from local Script_70.pvf')
a.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a.add_argument('--out',type=Path,default=Path('/tmp/nano-target-faces.json'))
a=a.parse_args();p=a.client/'Script_70.pvf';f=p.open('rb')
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



links={'grunt':'goblin/goblin','coward':'goblin/cowardgoblin','caster':'goblin/goblinthrower',
 'goblinBlue':'goblin/seagab','goblinRed':'goblin/hillgab','elite':'goblin/kinol',
 'throwerElite':'goblin/goblintaskmaster','brute':'tau/tauarmy','cat':'lugaru/lugaru',
 'boss':'tau/taubeast','lugaruBoss':'lugaru/kurogaru'}
out={}
for key,short in links.items():
 name='monster/'+short+'.mob';raw=read(name);ts=tokens(name);record={'entry':name,'sha256':hashlib.sha256(raw).hexdigest()}
 for tag in ['[face image]','[waiting motion]']:
  pos=ts.index((5,tag))+1;values=[]
  while pos<len(ts) and ts[pos][0]!=5:values.append(ts[pos][1]);pos+=1
  record[tag]=values
 motion=name.rsplit('/',1)[0]+'/'+record['[waiting motion]'][0].lower()
 if motion in entries:
  data=read(motion);n,path_count=struct.unpack_from('<2H',data);pos=4;paths=[]
  for _ in range(path_count):
   length=u(data,pos);pos+=4;paths.append(data[pos:pos+length].decode());pos+=length
  record['waiting_animation']={'entry':motion,'frames':n,'paths':paths}
 out[key]=record
f.close();a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps({'source':p.name,'faces':out},ensure_ascii=False,indent=2)+'\n')
print('Native face identities ->',a.out)
