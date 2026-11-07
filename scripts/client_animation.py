"""Small reader for the local client's binary ANI properties (audit tools)."""
import struct

def parse_animation(data):
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

