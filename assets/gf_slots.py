#!/usr/bin/env python3
"""Read-only dump of one .img entry of an NPK, every frame, upscaled.

Usage:  gf_slots.py <npk> <entry-substring> <outdir> <scale>
Writes <outdir>/<basename>-f<N>.png and prints frame geometry.
"""
import io
import sys
from pathlib import Path

from PIL import Image as PILImage

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory


def main():
    npk_path = Path(sys.argv[1])
    needle = sys.argv[2].lower()
    out_dir = Path(sys.argv[3])
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(npk_path, "rb") as h:  # handle must outlive every entry.data read
        npk = NPK.open(h)
        for entry in npk.files:
            if needle not in entry.name.lower():
                continue
            img = IMGFactory.open(io.BytesIO(bytes(entry.data)))
            base = Path(entry.name).stem
            print(f"### {entry.name} version={img.version} frames={len(img.images)}")
            for i, fr in enumerate(img.images):
                pil = img.build(fr)
                cap = "" if fr is None else f" canvas={fr.mw}x{fr.mh} anchor=({fr.x},{fr.y})"
                if scale != 1.0 and pil is not None:
                    pil = pil.resize(
                        (max(1, int(pil.width * scale)), max(1, int(pil.height * scale))),
                        PILImage.NEAREST,
                    )
                out = out_dir / f"{base}-f{i}.png"
                pil.save(out)
                print(f"  [{i}] {pil.width}x{pil.height} -> {out}{cap}")


if __name__ == "__main__":
    main()
