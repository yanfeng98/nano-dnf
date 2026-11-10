#!/usr/bin/env python3
"""Read action-tree identity and animations from local clients, without guessing int-data semantics."""
import argparse, hashlib, json, struct
from pathlib import Path
import numpy as np
from client_animation import parse_animation


def inspect(source):
    def decrypt(data, key):
        words = np.frombuffer(data, dtype='<u4') ^ np.uint32(key ^ 0x81A79011)
        return ((words >> 6) | (words << 26)).tobytes()

    with source.open('rb') as stream:
        length, = struct.unpack('<I', stream.read(4))
        stream.read(length)
        version, length, key, count = struct.unpack('<4I', stream.read(16))
        base = stream.tell() + length
        tree = decrypt(stream.read(length), key)
        entries, position = {}, 0
        for _ in range(count):
            _, size = struct.unpack_from('<2I', tree, position)
            position += 8
            name = tree[position:position + size].decode('cp949', errors='replace').replace('\\', '/').lower()
            position += size
            entries[name] = struct.unpack_from('<3I', tree, position)
            position += 12

        def read(name):
            size, key, offset = entries[name]
            stream.seek(base + offset)
            return decrypt(stream.read((size + 3) & ~3), key)[:size]

        strings = read('stringtable.bin')

        def tokens(raw):
            output = []
            for offset in range(2, len(raw) - 4, 5):
                kind = raw[offset]
                value, = struct.unpack_from('<I', raw, offset + 1)
                if kind in [5, 6, 7, 8, 10]:
                    start, end = struct.unpack_from('<2I', strings, 4 + value * 4)
                    value = strings[4 + start:4 + end].decode('big5', errors='replace')
                elif kind == 4:
                    value, = struct.unpack_from('<f', raw, offset + 1)
                output.append([kind, value])
            return output

        selected = [name for name in entries if 'actiontree' in name and
                    (name.startswith('passiveobject/mapobject/breakableobject/') or
                     name.startswith('map/mirkwooddeep/')) and name.endswith(('.obj', '.ani'))]
        report = {'file': source.name, 'header_version': version, 'entries': {}}
        for name in sorted(selected):
            raw = read(name)
            record = {'sha256': hashlib.sha256(raw).hexdigest()}
            if name.endswith('.obj'):
                record['tokens'] = tokens(raw)
            else:
                animation = parse_animation(raw)
                record['animation'] = animation
            report['entries'][name] = record
        listing = tokens(read('passiveobject/passiveobject.lst'))
        report['list_matches'] = [listing[max(0, i - 1):i + 1] for i, (_, value) in enumerate(listing)
                                  if isinstance(value, str) and 'actiontree' in value.lower()]
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=Path('/mnt/c/dnf/地下城与勇士'))
    parser.add_argument('--out', type=Path, default=Path('/tmp/nano57/tree-client.json'))
    args = parser.parse_args()
    report = {'limits': 'Local client identity evidence; int-data semantics, recording HP, collision and trigger rules remain unverified.',
              'clients': [inspect(args.client / name) for name in ['Script_70.pvf', 'Script.pvf']]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(args.out)
