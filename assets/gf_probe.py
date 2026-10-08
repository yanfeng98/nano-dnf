#!/usr/bin/env python3
"""Read-only probe of DNF client NPK packs (granfloris monster inventory).

Usage:
  gf_probe.py list <npk...>        # print entry paths only
  gf_probe.py detail <npk...>      # print entry path + frame count + sizes
"""
import io
import sys
from pathlib import Path

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory


def open_npk(path):
    with open(path, "rb") as h:
        npk = NPK.open(h)
        out = []
        for entry in npk.files:
            out.append((entry.name, bytes(entry.data)))
        return out


def frames(data):
    img = IMGFactory.open(io.BytesIO(data))
    return len(img.images), img


def main():
    mode = sys.argv[1]
    for p in sys.argv[2:]:
        path = Path(p)
        try:
            entries = open_npk(path)
        except Exception as e:  # noqa: BLE001
            print(f"!! FAILED {path}: {e}")
            continue
        print(f"### {path} ({len(entries)} entries)")
        for name, data in entries:
            if mode == "list":
                print(f"  {name}")
            else:
                try:
                    n, img = frames(data)
                    extra = f"frames={n}"
                    if n:
                        f0 = img.images[0]
                        extra += f" size={f0.w}x{f0.h} anchor=({f0.x},{f0.y})"
                except Exception as e:  # noqa: BLE001
                    extra = f"!! {e}"
                print(f"  {name}\t{extra}")


if __name__ == "__main__":
    main()
