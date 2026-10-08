#!/usr/bin/env python3
"""Read-only measured match: a stage-select boss portrait vs a client sprite stack.

Usage:
  gf_match_score.py <slot frame png> <x0> <y0> <x1> <y1> <stack> [<stack>...]

<slot frame png> is one dumped frame of sprite/worldmap/selectdungeonslot/
granfloris.img (the 4x dump in probe/slots/granfloris-f<N>.png). The crop box
selects the portrait area.

For every stack (`NPK::entry[+NPK::entry...]`, same syntax as gf_boss_sheet.py)
this renders each frame on the stack's shared canvas, then searches
    scale x horizontal-flip x offset
for the placement that minimises the mean per-pixel colour error measured *only
where the sprite is opaque* - the portrait has a painted background and, for a
dressed boss, the body .img is only part of the figure, so scoring the sprite's
own pixels (rather than the portrait's) is the honest comparison.

Prints, per stack, the best 8 (frame, scale, flip, offset, error) rows sorted by
mean error (0-255 per channel). Lower is better; a true match lands well under
the pack's other frames.
"""
import io
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image as PILImage
from scipy.signal import fftconvolve

from pydnfex.npk import NPK
from pydnfex.img.version import IMGFactory

CLIENT = Path(os.environ.get("GF_CLIENT", "/mnt/c/dnf/地下城与勇士"))
def _scales():
    """Sprite scale relative to the portrait image. The slot frames are dumped
    at 4x (probe/slots/granfloris-f*.png), so a sprite drawn 1:1 in the native
    168x73 slot cell lands near 4.0 here."""
    if os.environ.get("GF_SCALES"):
        return [float(x) for x in os.environ["GF_SCALES"].split(",")]
    return [round(1.0 + 0.125 * i, 4) for i in range(41)]   # 1.00 .. 6.00


SCALES = _scales()
MAX_FRAMES = int(os.environ.get("GF_MATCH_FRAMES", "40"))


def resolve(spec):
    p = Path(spec)
    if p.is_file():
        return p
    for sub in ("ImagePacks2", "ImagePacks2_70"):
        cand = CLIENT / sub / spec
        if cand.is_file():
            return cand
    raise FileNotFoundError(spec)


def build_layers(stack):
    layers = []
    for item in stack.split("+"):
        npk_spec, _, needle = item.strip().partition("::")
        npk_path = resolve(npk_spec)
        with open(npk_path, "rb") as h:
            npk = NPK.open(h)
            hit = None
            for e in npk.files:
                if needle.lower() in e.name.lower():
                    hit = (e.name, bytes(e.data))
                    break
        if hit is None:
            raise LookupError(f"no entry matching {needle} in {npk_path.name}")
        layers.append((hit[0], IMGFactory.open(io.BytesIO(hit[1]))))
    return layers


def render(layers, index, box):
    base = layers[0][1].images[index]
    cw = max(getattr(base, "mw", base.w), base.w)
    ch = max(getattr(base, "mh", base.h), base.h)
    canvas = PILImage.new("RGBA", (cw, ch), (0, 0, 0, 0))
    for _, img in layers:
        if index >= len(img.images):
            continue
        fr = img.images[index]
        pil = img.build(fr).convert("RGBA")
        canvas.paste(pil, (getattr(fr, "x", 0), getattr(fr, "y", 0)), pil)
    return canvas.crop(box) if box else canvas


def masked_ssd(P, C, M):
    """best mean error over all offsets, C/M: candidate rgb+mask (float)."""
    P2 = (P ** 2).sum(axis=2)                     # (H,W)
    S1 = fftconvolve(P2, M[::-1, ::-1], mode="valid")          # sum M P^2
    S3 = sum(fftconvolve(P[:, :, c], (M * C[:, :, c])[::-1, ::-1], mode="valid")
             for c in range(3))                                # sum M P C
    S2 = float((M * (C ** 2).sum(axis=2)).sum())               # sum M C^2
    n = float(M.sum())
    if n <= 0:
        return 1e9
    return float(((S1 - 2 * S3 + S2) / n).min())


def main():
    slot = PILImage.open(sys.argv[1]).convert("RGBA")
    x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
    portrait = np.asarray(slot.crop((x0, y0, x1, y1)).convert("RGB"), dtype=np.float64)
    stacks = sys.argv[6:]
    for stack in stacks:
        try:
            layers = build_layers(stack)
        except Exception as e:  # noqa: BLE001
            print(f"!! {stack}: {e}")
            continue
        base = layers[0][1]
        # crop box = union bbox of real frames
        bx0 = by0 = 10 ** 9
        bx1 = by1 = -10 ** 9
        for _, img in layers:
            for fr in img.images:
                if getattr(fr, "w", 0) <= 1 or getattr(fr, "h", 0) <= 1:
                    continue
                bx0, by0 = min(bx0, fr.x), min(by0, fr.y)
                bx1, by1 = max(bx1, fr.x + fr.w), max(by1, fr.y + fr.h)
        box = None if bx0 > bx1 else (bx0, by0, bx1, by1)
        rows = []
        for i in range(min(len(base.images), MAX_FRAMES)):
            try:
                art = render(layers, i, box)
            except Exception:  # noqa: BLE001
                continue
            if art.getbbox() is None:
                continue
            for flip in (False, True):
                a = art.transpose(PILImage.FLIP_LEFT_RIGHT) if flip else art
                for s in SCALES:
                    w = max(1, int(a.width * s))
                    h = max(1, int(a.height * s))
                    if w >= portrait.shape[1] or h >= portrait.shape[0] or w < 8 or h < 8:
                        continue
                    small = a.resize((w, h), PILImage.LANCZOS)
                    arr = np.asarray(small, dtype=np.float64)
                    rgb = arr[:, :, :3]
                    mask = (arr[:, :, 3] > 128).astype(np.float64)
                    if mask.sum() < 50:
                        continue
                    err = masked_ssd(portrait, rgb, mask)
                    rows.append((err, i, s, flip))
        rows.sort()
        print(f"=== {stack}   frames={len(base.images)} canvas="
              f"{getattr(base.images[0], 'mw', '?')}x{getattr(base.images[0], 'mh', '?')} "
              f"anchor=({base.images[0].x},{base.images[0].y})")
        for err, i, s, flip in rows[:8]:
            print(f"    err={err:7.1f}  frame={i:<3d} scale={s:<5.2f} flip={flip}")


if __name__ == "__main__":
    main()
