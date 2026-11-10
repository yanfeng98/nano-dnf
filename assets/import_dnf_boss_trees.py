#!/usr/bin/env python3
"""Import the observed initial fruit tree without transforms or recolouring."""
import argparse,hashlib,json
from pathlib import Path
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();pack='sprite_map_breakableobject_actiontreerenew.NPK'
entry='sprite/map/breakableobject/actiontreerenew/actiontree1-sunderland.img'
im,offset=decode_at(a.client,pack,entry,0)
assert im.size==(153,203)
im.save(Path(__file__).resolve().parent.parent/'assets/tree-fruit-reference.png')
print(json.dumps({'pack':pack,'entry':entry,'frame':0,'offset':list(offset),'size':list(im.size),'transform':'none; unchanged native RGBA','rgba_sha256':hashlib.sha256(im.tobytes()).hexdigest()},indent=2))
