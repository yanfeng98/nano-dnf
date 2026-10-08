#!/usr/bin/env python3
"""Read-only: dump one frame of one .img entry, scaled, on its own canvas.

Usage:  gf_frame.py <npk> <entry-substring> <frame-index> <out.png> [scale]
Also accepts extra `NPK::entry` layers joined by `+` after the first, to render
a layered monster (body + clothes + hair) the way the client draws it.
"""
import io
import os
import sys
from pathlib import Path

from PIL import Image as PILImage

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

CLIENT = Path(os.environ.get("GF_CLIENT", "/mnt/c/dnf/地下城与勇士"))


def resolve(spec):
    p = Path(spec)
    if p.is_file():
        return p
    for sub in ("ImagePacks2", "ImagePacks2_70"):
        cand = CLIENT / sub / spec
        if cand.is_file():
            return cand
    raise FileNotFoundError(spec)


def main():
    layers = []
    for item in sys.argv[1].split("+"):
        npk_spec, _, needle = item.partition("::")
        npk_path = resolve(npk_spec)
        with open(npk_path, "rb") as h:
            npk = NPK.open(h)
            for e in npk.files:
                if needle.lower() in e.name.lower():
                    layers.append((e.name, IMGFactory.open(io.BytesIO(bytes(e.data)))))
                    break
            else:
                raise SystemExit(f"no entry matching {needle} in {npk_path.name}")
    index = int(sys.argv[2])
    out_path = Path(sys.argv[3])
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0

    base = layers[0][1].images[index]
    cw = max(getattr(base, "mw", base.w), base.w)
    ch = max(getattr(base, "mh", base.h), base.h)
    canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
    for name, img in layers:
        fr = img.images[index]
        pil = img.build(fr).convert("RGBA")
        canvas.paste(pil, (getattr(fr, "x", 0), getattr(fr, "y", 0)), pil)
    if scale != 1.0:
        canvas = canvas.resize((max(1, int(canvas.width * scale)),
                                max(1, int(canvas.height * scale))), PILImage.NEAREST)
    canvas.save(out_path)
    print(f"{out_path} {canvas.width}x{canvas.height} "
          f"layers={[n for n, _ in layers]} frame={index} "
          f"canvas={cw}x{ch} anchor=({base.x},{base.y})")


if __name__ == "__main__":
    main()
