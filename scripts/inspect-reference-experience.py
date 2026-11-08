#!/usr/bin/env python3
"""Inspect local experience tables and dungeon coefficients without adopting them.

Client tables are not proof of recording-server balance, cumulative-vs-per-level
semantics, or clear XP calculation. Runtime progression is deliberately untouched.
"""
import argparse,hashlib,json,struct
from pathlib import Path
import numpy as np

def uint(data,offset=0):return struct.unpack_from('<I',data,offset)[0]
def decrypt(data,key):
 words=np.frombuffer(data,dtype='<u4')^np.uint32(key^0x81A79011)
 return ((words>>6)|(words<<26)).tobytes()

def inspect(source):
 with source.open('rb') as f:
  length=uint(f.read(4));f.read(length)
  version,length,key,count=struct.unpack('<4I',f.read(16));base=f.tell()+length
  tree=decrypt(f.read(length),key);entries={};pos=0
  for _ in range(count):
   number,n=struct.unpack_from('<2I',tree,pos);pos+=8
   name=tree[pos:pos+n].decode('cp949',errors='replace').replace('\\','/').lower();pos+=n
   size,key,offset=struct.unpack_from('<3I',tree,pos);pos+=12;entries[name]=(size,key,offset)
  def read(name):
   size,key,offset=entries[name];f.seek(base+offset);return decrypt(f.read((size+3)&~3),key)[:size]
  strings=read('stringtable.bin')
  def string(index):
   start,end=struct.unpack_from('<2I',strings,4+index*4)
   return strings[4+start:4+end].decode('big5',errors='replace')
  def tokens(raw):
   result=[]
   for i in range(2,len(raw)-4,5):
    kind=raw[i];value=uint(raw,i+1)
    if kind in [5,6,7,8,10]:value=string(value)
    elif kind==4:value=struct.unpack_from('<f',raw,i+1)[0]
    result.append((kind,value))
   return result
  report={'file':source.name,'bytes':source.stat().st_size,'header_version':version,'entries':{}}
  for name in ['character/exptable.tbl','dungeon/act1/mirkwood.dgn','dungeon/act1/mirkwooddeep.dgn',
    'monster/goblin/goblin.mob','monster/tau/taubeast.mob','monster/lugaru/kurogaru.mob']:
   if name not in entries:
    report['entries'][name]={'missing':True};continue
   raw=read(name);ts=tokens(raw);record={'sha256':hashlib.sha256(raw).hexdigest()}
   if name.endswith('exptable.tbl'):
    record['raw_values']=[value for kind,value in ts if kind==2]
    record['interpretation']='Index/threshold semantics and recording-version agreement remain unverified.'
   else:
    fields={};section=None
    for kind,value in ts:
     if kind==5:
      section=value if value in ['[basis level]','[minimum required level]','[experience increasing point]'] or 'experience' in value or value.startswith('[exp]') else None
      if section:fields.setdefault(section,[])
     elif section:fields[section].append(value)
    record['experience_related_fields']=fields
   report['entries'][name]=record
 return report

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out',type=Path,default=Path('/tmp/nano-xp41/41-client-experience.json'))
a=p.parse_args();result={'limits':'Local client facts only; no runtime threshold or payout formula is inferred.','clients':[inspect(a.client/name) for name in ['Script_70.pvf','Script.pvf']]}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n')
for client in result['clients']:
 print(client['file'],client['entries']['character/exptable.tbl'].get('raw_values',[])[:10])
