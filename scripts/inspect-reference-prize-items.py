#!/usr/bin/env python3
"""Read the observed prize identities/icon links from the local Script_70.pvf.

Does not infer a drop table from two outcomes. PNGs come from the referenced
local NPK frames, never from the audit video crops.
"""
import argparse, hashlib, json, struct
from pathlib import Path
import numpy as np

def uint(data, at=0): return struct.unpack_from('<I',data,at)[0]
def decrypt(data, crc):
    a=np.frombuffer(data,dtype='<u4') ^ np.uint32(crc ^ 0x81A79011)
    return ((a>>6)|(a<<26)).tobytes()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
    p.add_argument('--out',type=Path,default=Path('/tmp/nano-prize-item-metadata.json'))
    a=p.parse_args(); source=a.client/'Script_70.pvf'
    with source.open('rb') as f:
        size=uint(f.read(4));f.read(size)
        version,length,crc,count=struct.unpack('<4I',f.read(16));base=f.tell()+length
        tree=decrypt(f.read(length),crc);entries={};pos=0
        for _ in range(count):
            number,n=struct.unpack_from('<2I',tree,pos);pos+=8
            name=tree[pos:pos+n].decode('cp949',errors='replace').replace('\\','/').lower();pos+=n
            size,key,offset=struct.unpack_from('<3I',tree,pos);pos+=12;entries[name]=(size,key,offset)
        def read(name):
            size,key,offset=entries[name];f.seek(base+offset)
            return decrypt(f.read((size+3)&~3),key)[:size]
        strings=read('stringtable.bin')
        def string(index):
            start,end=struct.unpack_from('<2I',strings,4+index*4)
            return strings[4+start:4+end].decode('big5',errors='replace')
        results={}
        for id,name in [('ancientStaff','equipment/character/mage/weapon/staff/staff_beginmage.equ'),
                        ('kunicTotem','equipment/character/priest/weapon/totem/ttpole_ocunic.equ')]:
            raw=read(name);tokens=[]
            for i in range(2,len(raw)-4,5):
                kind=raw[i];value=uint(raw,i+1)
                tokens.append((kind,string(value) if kind in [5,6,7,8,10] else value))
            def field(key):
                at=next(i for i,t in enumerate(tokens) if t==(5,key))+1;values=[]
                while at<len(tokens) and tokens[at][0]!=5:
                    values.append(tokens[at][1]);at+=1
                return values
            icon=field('[icon]')
            results[id]=dict(entry=name,entry_sha256=hashlib.sha256(raw).hexdigest(),
                client_name=field('[name]')[0],minLevel=field('[minimum level]')[0],
                jobs=[v.strip('[]') for v in field('[usable job]')],price=field('[price]')[0],
                icon=dict(entry='sprite/'+icon[0].lower(),frame=icon[1]))
        f.seek(0);digest=hashlib.sha256()
        while chunk:=f.read(1024*1024):digest.update(chunk)
    output=dict(source=dict(file=source.name,sha256=digest.hexdigest(),header_version=version),items=results)
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
