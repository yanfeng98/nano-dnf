#!/usr/bin/env python3
"""Read native pillar PTL/ANI and audio.xml provenance without guessing emission semantics."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from pydnfex.npk import NPK
from client_pvf import PvfArchive
from client_animation import parse_animation
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'assets'))
from import_dnf_scene import decode_at

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
sha = lambda data: hashlib.sha256(data).hexdigest()
ptl = 'passiveobject/mapobject/breakableobject/particle/stonepillardamage.ptl'
prefix = 'passiveobject/mapobject/breakableobject/animation/stonepillar/'
clients = []
for name in ['Script.pvf', 'Script_70.pvf']:
    with PvfArchive(a.client / name) as pvf:
        clients.append({'file': name, 'particlePath': ptl, 'particleSha256': sha(pvf.read(ptl)),
                        'particleTokens': pvf.tokens(ptl), 'animations': {
                            f'stonepillarparticle{i}.ani': parse_animation(pvf.read(prefix + f'stonepillarparticle{i}.ani'))
                            for i in range(1, 5)}})
assert clients[0]['particleTokens'] == clients[1]['particleTokens']
assert clients[0]['animations'] == clients[1]['animations']
images = []
for i in range(1, 5):
    entry = f'sprite/map/breakableobject/stonepillar/stonepillarparticle{i}.img'
    pic, offset = decode_at(a.client, 'sprite_map_breakableobject_stonepillar.NPK', entry, 0)
    images.append({'entry': entry, 'frame': 0, 'size': list(pic.size), 'imgOffset': list(offset), 'rgbaSha256': sha(pic.tobytes())})
xml = (a.client / 'audio.xml').read_text(errors='replace')
match = re.search(r'<EFFECT ID="TRAP_STONE_BREAK" FILE="([^"]+)"\s*/>', xml)
assert match
entry = match.group(1).replace('\\', '/').lower()
sound = {'effectId': 'TRAP_STONE_BREAK', 'xmlElement': match.group(0), 'entry': entry, 'packs': []}
for folder in ['SoundPacks', 'SoundPacks_70']:
    pack = a.client / folder / 'sounds_effect_amb.npk'
    with pack.open('rb') as handle:
        data = next(bytes(e.data) for e in NPK.open(handle).files if e.name.lower() == entry)
    sound['packs'].append({'folder': folder, 'pack': pack.name, 'bytes': len(data), 'sha256': sha(data)})
asset = Path(__file__).resolve().parents[1] / 'assets/sfx/tstone_break.ogg'
sound['shippedSha256'] = sha(asset.read_bytes())
assert sound['shippedSha256'] == sound['packs'][0]['sha256']
report = {'clients': clients, 'particleImages': images, 'sound': sound,
          'limits': 'PTL maximum count8, life500ms, gravity1200 and four source images are named data. Emission-angle semantics, random-range interpretation and rotation pivot remain unresolved. Video texture tracks support rotating native fragments but do not prove those missing semantics. Audio sample identity is proven; exact reference mix and capture latency are not.'}
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ptlHashes': [c['particleSha256'] for c in clients], 'sound': sound}, ensure_ascii=False, indent=2))
