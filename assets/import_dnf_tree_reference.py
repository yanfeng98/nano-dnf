#!/usr/bin/env python3
"""Import the observed mirrored green tree; no recolouring or video pixels."""
import argparse,hashlib,json
from pathlib import Path
from PIL import Image
from import_dnf_scene import decode_at
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--client',type=Path,default=Path('/mnt/c/dnf/地下城与勇士'))
a=p.parse_args();entry='sprite/map/03obj300.img'
im,offset=decode_at(a.client,'sprite_map.NPK',entry,0)
proof={'pack':'sprite_map.NPK','entry':entry,'frame':0,'offset':list(offset),'size':list(im.size),'original_rgba_sha256':hashlib.sha256(im.tobytes()).hexdigest(),'transform':'horizontal mirror only'}
im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);proof['rgba_sha256']=hashlib.sha256(im.tobytes()).hexdigest()
im.save(Path(__file__).resolve().parent.parent/'assets/tree-reference.png');print(json.dumps(proof,indent=2))
