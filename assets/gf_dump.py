#!/usr/bin/env python3
"""Read-only dump of NPK .img entries to individual PNGs (all frames).

Usage:
  gf_dump.py <outdir> <npk> [substring ...]
      substring: only entries whose path contains it (case-insensitive).
"""
import io
import sys
from pathlib import Path

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory


def main():
    out_dir = Path(sys.argv[1])
    npk_path = Path(sys.argv[2])
    needles = [s.lower() for s in sys.argv[3:]]
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(npk_path, "rb") as h:
        npk = NPK.open(h)
        for entry in npk.files:
            name = entry.name
            if needles and not any(n in name.lower() for n in needles):
                continue
            base = name.split("/")[-1].replace(".img", "")
            try:
                img = IMGFactory.open(io.BytesIO(bytes(entry.data)))
            except Exception as e:  # noqa: BLE001
                print(f"  !! {name}: {e}", file=sys.stderr)
                continue
            for i, frame in enumerate(img.images):
                sprite = img.build(frame)
                suffix = f"-f{i}" if len(img.images) > 1 else ""
                out = out_dir / f"{base}{suffix}.png"
                sprite.save(out)
            print(f"  {name}  frames={len(img.images)}")


if __name__ == "__main__":
    main()
