#!/usr/bin/env python3
"""Read-only index of every .NPK in the installed DNF client.

Emits one line per archive entry:  <npk basename>\t<entry path inside npk>
No image data is decoded. Nothing is written into the client directory.

Usage:  gf_index.py <out.txt> <client_root> [<client_root> ...]
"""
import sys
from pathlib import Path

from pydnfex.npk import NPK

IMAGE_PACK_DIRS = ("ImagePacks2", "ImagePacks2_70")


def main():
    out_path = Path(sys.argv[1])
    roots = [Path(p) for p in sys.argv[2:]]
    npks = []
    for root in roots:
        for sub in IMAGE_PACK_DIRS:
            d = root / sub
            if d.is_dir():
                npks.extend(sorted(d.glob("*.NPK")))
    print(f"indexing {len(npks)} npk", file=sys.stderr)
    done = 0
    fails = 0
    with out_path.open("w", encoding="utf-8") as out:
        for path in npks:
            try:
                with open(path, "rb") as h:
                    npk = NPK.open(h)
                    names = [e.name for e in npk.files]
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"!! {path.name}: {e}", file=sys.stderr)
                continue
            for name in names:
                out.write(f"{path.parent.name}/{path.name}\t{name}\n")
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(npks)}  ({fails} failed)", file=sys.stderr)
    print(f"done: {done} ok, {fails} failed", file=sys.stderr)


if __name__ == "__main__":
    main()
