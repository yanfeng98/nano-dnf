#!/usr/bin/env python3
"""Cross-check room14's target/death logs with local native monster records.

Video captions and credits are manual readings, not OCR. Native records for
the other route rooms are catalogued as client facts, not adopted as runtime
rules without their own recording evidence.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from client_pvf import PvfArchive

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
p.add_argument('--video', type=Path, default=ROOT.parent / 'dnf-素材/00002-幽暗密林深处.mp4')
p.add_argument('--out', type=Path, default=Path('/tmp/nano137-room14'))
args = p.parse_args()
if args.out.resolve().is_relative_to(ROOT / 'assets'):
    p.error('recording images are evidence, not runtime art')
args.out.mkdir(parents=True, exist_ok=True)
maps = [dict(room='41', map_entry='map/mirkwooddeep/s419(0,3).map')]
maps += json.loads((ROOT / 'docs/reference-evidence/86-deep-mid-measurement.json').read_text())['rooms']
clients = []
for filename in ['Script_70.pvf', 'Script.pvf']:
    with PvfArchive(args.client / filename) as pvf:
        index = pvf.tokens('monster/monster.lst')
        paths = {index[i][1]: index[i + 1][1] for i in range(0, len(index), 2)}
        rooms = []
        for room in maps:
            name = room['map_entry']
            tokens = pvf.tokens(name)
            start = next(i for i, token in enumerate(tokens) if token[1] == '[monster]')
            end = next(i for i, token in enumerate(tokens) if token[1] == '[/monster]')
            body = tokens[start + 1:end]
            assert len(body) % 10 == 0
            records = []
            for i in range(0, len(body), 10):
                values = [token[1] for token in body[i:i + 10]]
                assert values[8] == '[fixed]'
                records.append(dict(monsterId=values[0], monsterPath=paths[values[0]],
                                    levelFields=values[1:3], nativeXYZ=values[3:6], tailFields=values[6:]))
            rooms.append(dict(room=room['room'], entry=name,
                              sha256=hashlib.sha256(pvf.read(name)).hexdigest(), records=records))
        clients.append(dict(file=filename, version=pvf.version,
                            monsterIndexSha256=hashlib.sha256(pvf.read('monster/monster.lst')).hexdigest(), rooms=rooms))
raw = subprocess.run([
    'ffmpeg', '-loglevel', 'error', '-threads', '1', '-ss', '236', '-i', str(args.video),
    '-t', '30', '-vf', "select='not(mod(n,15))',crop=1440:1080:240:0,scale=720:540",
    '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'
], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 540, 720, 3)
assert len(frames) == 60
selected = []
for page in range(3):
    target = Image.new('RGB', (1440, 1000), '#181818')
    logs = Image.new('RGB', (1200, 1600), '#181818')
    td, ld = ImageDraw.Draw(target), ImageDraw.Draw(logs)
    for index, rgb in enumerate(frames[page * 20:(page + 1) * 20]):
        time = 236 + (page * 20 + index) / 2
        image = Image.fromarray(rgb)
        name = f'137-v2-{time:g}-room14.png'
        image.save(args.out / name)
        x, y = index % 2 * 720, index // 2 * 100
        target.paste(image.crop((0, 43, 360, 85)).resize((720, 84)), (x, y + 16))
        td.text((x, y), f'V2 {time:g}s', fill='white')
        x, y = index % 4 * 300, index // 4 * 320
        logs.paste(image.crop((12, 95, 252, 345)), (x, y + 20))
        logs.paste(image.crop((75, 477, 300, 500)), (x, y + 280))
        ld.text((x, y), f'V2 {time:g}s', fill='white')
        if time in [237.5, 240.5, 241.5, 245.5, 248.5, 252.5, 254.5, 257.5, 259, 263]:
            selected.append(dict(time=time, frame=name,
                                 sha256=hashlib.sha256((args.out / name).read_bytes()).hexdigest()))
    target.save(args.out / f'137-room14-targets-{page}.png')
    logs.save(args.out / f'137-room14-logs-{page}.png')
report = dict(video=args.video.name, sourceFps=30, sampleStart=236, strideFrames=15, samples=60,
              selectedFrames=selected, clients=clients,
              manualRoster=[dict(type='grunt', level=4, count=5, creditEach=40),
                            dict(type='deepElite', level=6, count=2, creditEach=60),
                            dict(type='throwerElite', level=6, count=2, creditEach=60)],
              manualCreditSequence=[40] * 5 + [60] * 4, totalCredit=440,
              limits=['All three kinds are visible before the first death; the old staged type introduction is contradicted.',
                      'The monster counts agree with native402 records; other native rooms still need independent review.',
                      'Native X projection does not prove exact actor anchors, random jitter, floor depth, AI or activation rules.',
                      'Level mode and other raw record fields are retained without asserting a general server schema.',
                      'No global XP or level rule is inferred from these room-specific credits.'])
(args.out / '137-room14-roster-reference.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Room14: five Lv4 grunt40 + two Lv6 captain60 + two Lv6 thrower60 =440.')
print('Native route counts:', [(r['room'], len(r['records'])) for r in clients[0]['rooms']])
