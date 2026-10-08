#!/usr/bin/env python3
"""Read-only dump of the raw frame table of a .img inside an NPK.

Shows, per frame: class, format, extra, w, h, byte size, anchor (x,y),
canvas (mw,mh), and for link frames the link target index.

Usage:  gf_link_probe.py <npk> [entry-substring ...]
"""
import io
import sys
from pathlib import Path

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory
from pydnfex.img.image import ImageLink, Image, ZlibImage, SpriteZlibImage


def main():
    npk_path = Path(sys.argv[1])
    needles = [s.lower() for s in sys.argv[2:]]
    # NOTE: the NPK reads lazily off this handle - it must stay open for the
    # whole loop, or every entry.data raises "seek of closed file".
    with open(npk_path, "rb") as h:
        npk = NPK.open(h)
        for entry in npk.files:
            name = entry.name
            if needles and not any(n in name.lower() for n in needles):
                continue
            data = bytes(entry.data)
            try:
                img = IMGFactory.open(io.BytesIO(data))
            except Exception as e:  # noqa: BLE001
                print(f"!! {name}: {e}")
                continue
            print(f"### {name}  bytes={len(data)}  version={img.version}  frames={len(img.images)}")
            for i, fr in enumerate(img.images):
                if isinstance(fr, ImageLink):
                    print(f"  [{i:3d}] LINK -> images[{fr.index}]")
                    continue
                extra = getattr(fr, "extra", None)
                print(f"  [{i:3d}] {type(fr).__name__} fmt={fr.format} extra={extra} "
                      f"w={fr.w} h={fr.h} size={len(fr.data)} anchor=({fr.x},{fr.y}) "
                      f"canvas=({getattr(fr, 'mw', '-')},{getattr(fr, 'mh', '-')})")


if __name__ == "__main__":
    main()
