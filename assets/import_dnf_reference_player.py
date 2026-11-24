#!/usr/bin/env python3
"""Bake the 1:1 reference-video Male Slayer sprite sheets.

Outputs:
  - assets/slayer-reference.png (13312x2640, 64x15 cells of 208x176)
  - assets/normal-wave-body.png (3456x320, 9 cells of 384x320)

Per ADR 0074, this matches the protagonist in both reference videos
(00001-幽暗密林.mp4 and 00002-幽暗密林深处.mp4):
  - Clean un-subclassed Male Slayer body (sm_body0000.img, no face mask,
    no Berserker red-eye/blood overlays)
  - Classic DNF Slayer upward-and-back spiky ivory-white hair without blue
    headband (sm_hair0000a.img with headband & buckle seamlessly recolored to
    warm ivory-white hair roots, matching the pre-2012 60/70 Slayer silhouette
    in both reference videos)
  - Sleeveless cream-white open vest with slate-teal trim and no blue
    shoulder spikes (sm_coat0000a.img with protruding spikes masked against
    the body silhouette and blue trim shifted to slate-teal)
  - Baggy medium slate-grey pants with warm gold-yellow side stripes and
    silver-grey waist belt/sash (sm_pants0000a/b.img recolored)
  - Heavy warm grey-brown/taupe boots with light grey cuffs
    (sm_shoes0000a/b.img recolored)
  - Brown short sword (sswd0006b/c.img)
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import import_dnf_swordman as body

ROOT = Path(__file__).resolve().parents[1]

REFERENCE_LAYERS = [
    "body",
    "shoes_b",
    "shoes",
    "pants_b",
    "pants",
    "coat",
    "hair",
    "weapon_b",
    "weapon_c",
]


def reference_packs() -> dict[str, tuple[str, str]]:
    avatar = body.AVATAR
    return {
        "hair": (
            "sprite_character_swordman_equipment_avatar_hair.NPK",
            f"{avatar}/hair/sm_hair0000a.img",
        ),
        "weapon_b": (
            "sprite_character_swordman_equipment_weapon_sswd.NPK",
            "sprite/character/swordman/equipment/weapon/sswd/sswd0006b.img",
        ),
        "weapon_c": (
            "sprite_character_swordman_equipment_weapon_sswd.NPK",
            "sprite/character/swordman/equipment/weapon/sswd/sswd0006c.img",
        ),
    }


def recolor_hair_ivory_white(im: Image.Image | None) -> Image.Image | None:
    """Recolor classic sm_hair0000a (stripping blue headband into warm ivory hair roots)."""
    if body.is_stub(im):
        return im
    arr = np.asarray(im, dtype=np.float32).copy()
    mask = arr[..., 3] > 0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    # Classic pre-2012 Slayer in the reference videos has the exact sm_hair0000a
    # spiky silhouette without the 2012 revamp's blue headband & amber knot.
    # Lift headband/buckle and dark-blue band seam into matching ivory hair roots.
    is_blue_band = mask & ((b - r) > 14)
    is_amber_knot = mask & ((r - b) > 35) & (r > 110) & (g < 170)
    is_band_seam = mask & ((b - r) > 8) & (lum < 0.35)
    is_band = is_blue_band | is_amber_knot | is_band_seam
    lum2 = np.where(is_band, np.clip(lum * 1.45 + 0.22, 0.34, 0.90), lum)

    l2 = np.clip(lum2 ** 0.80, 0.0, 1.0)
    nr = np.clip(l2 * 255.0 + 6.0, 0, 255)
    ng = np.clip(l2 * 249.0 + 2.0, 0, 255)
    nb = np.clip(l2 * 230.0, 0, 255)
    dark = lum2 < 0.28
    nr = np.where(dark, lum2 * 255.0 * 1.18, nr)
    ng = np.where(dark, lum2 * 255.0 * 1.04, ng)
    nb = np.where(dark, lum2 * 255.0 * 0.84, nb)
    arr[..., 0] = np.where(mask, np.clip(nr, 0, 255), r)
    arr[..., 1] = np.where(mask, np.clip(ng, 0, 255), g)
    arr[..., 2] = np.where(mask, np.clip(nb, 0, 255), b)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def recolor_coat_vest(
    coat_im: Image.Image | None,
    cx: int,
    cy: int,
    body_im: Image.Image | None,
    bx: int,
    by: int,
) -> Image.Image | None:
    """Strip protruding blue shoulder spikes via body mask; recolor trim to slate-teal."""
    if body.is_stub(coat_im):
        return coat_im
    arr = np.asarray(coat_im, dtype=np.float32).copy()
    h, w = arr.shape[:2]
    body_mask = np.zeros((h, w), dtype=bool)
    if not body.is_stub(body_im):
        ba = np.asarray(body_im)[..., 3] > 24
        x0 = max(0, bx - cx)
        y0 = max(0, by - cy)
        x1 = min(w, bx + body_im.width - cx)
        y1 = min(h, by + body_im.height - cy)
        if x1 > x0 and y1 > y0:
            bx0 = x0 - (bx - cx)
            by0 = y0 - (by - cy)
            body_mask[y0:y1, x0:x1] = ba[by0 : by0 + (y1 - y0), bx0 : bx0 + (x1 - x0)]
        body_mask_dil = ndimage.binary_dilation(body_mask, iterations=1)
    else:
        body_mask_dil = np.ones((h, w), dtype=bool)

    a = arr[..., 3]
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    opaque = a > 0
    is_blue = opaque & ((b - r) > 16) & ((b - g) > 4)
    protruding_blue = is_blue & (~body_mask_dil)
    protruding_dil = ndimage.binary_dilation(protruding_blue, iterations=2)
    remove = protruding_blue | (opaque & (~body_mask_dil) & protruding_dil)
    arr[..., 3] = np.where(remove, 0, a)

    keep = arr[..., 3] > 0
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    rem_blue = keep & ((b - r) > 12)
    nr = np.where(rem_blue, lum * 170.0 + 10.0, np.clip(r * 1.03 + 6.0, 0, 255))
    ng = np.where(rem_blue, lum * 188.0 + 12.0, np.clip(g * 1.01 + 4.0, 0, 255))
    nb = np.where(rem_blue, lum * 182.0 + 10.0, np.clip(b * 0.94, 0, 255))
    arr[..., 0] = np.where(keep, np.clip(nr, 0, 255), r)
    arr[..., 1] = np.where(keep, np.clip(ng, 0, 255), g)
    arr[..., 2] = np.where(keep, np.clip(nb, 0, 255), b)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def recolor_pants_slate_gold(im: Image.Image | None) -> Image.Image | None:
    """Shift sm_pants0000 blue cloth -> medium slate-grey, leg stripes -> warm gold-yellow."""
    if body.is_stub(im):
        return im
    arr = np.asarray(im, dtype=np.float32).copy()
    h, _w = arr.shape[:2]
    mask = arr[..., 3] > 0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    is_blue = mask & ((b - r) > 18) & ((b - g) > 4)
    is_teal = mask & ((g - r) > 15) & ((b - r) > 10) & (~is_blue)
    is_brown = mask & ((r - b) > 18) & (r < 175)
    ys = np.where(mask)[0]
    y_min, y_max = (ys.min(), ys.max()) if len(ys) else (0, h)
    y_grid = np.arange(h)[:, None]
    below_waist = y_grid > (y_min + 0.24 * (y_max - y_min))
    is_bright_stripe = mask & (~is_blue) & (~is_teal) & (~is_brown) & (lum > 0.52) & below_waist
    is_waist_sash = mask & (~is_blue) & (~is_teal) & (~is_brown) & (lum > 0.45) & (~below_waist)

    nr, ng, nb = r.copy(), g.copy(), b.copy()

    l_cloth = np.clip(lum ** 0.88, 0.0, 1.0)
    nr = np.where(is_blue, l_cloth * 222.0 + 12.0, nr)
    ng = np.where(is_blue, l_cloth * 230.0 + 14.0, ng)
    nb = np.where(is_blue, l_cloth * 246.0 + 16.0, nb)

    nr = np.where(is_teal, lum * 215.0 + 12.0, nr)
    ng = np.where(is_teal, lum * 208.0 + 10.0, ng)
    nb = np.where(is_teal, lum * 198.0 + 8.0, nb)

    nr = np.where(is_brown, lum * 185.0, nr)
    ng = np.where(is_brown, lum * 185.0, ng)
    nb = np.where(is_brown, lum * 195.0, nb)

    nr = np.where(is_bright_stripe, np.clip(lum * 255.0 + 10.0, 0, 255), nr)
    ng = np.where(is_bright_stripe, np.clip(lum * 230.0, 0, 255), ng)
    nb = np.where(is_bright_stripe, np.clip(lum * 120.0, 0, 255), nb)

    nr = np.where(is_waist_sash, lum * 235.0, nr)
    ng = np.where(is_waist_sash, lum * 232.0, ng)
    nb = np.where(is_waist_sash, lum * 224.0, nb)

    arr[..., 0] = np.where(mask, np.clip(nr, 0, 255), r)
    arr[..., 1] = np.where(mask, np.clip(ng, 0, 255), g)
    arr[..., 2] = np.where(mask, np.clip(nb, 0, 255), b)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def recolor_shoes_taupe(im: Image.Image | None) -> Image.Image | None:
    """Shift sm_shoes0000 blue/teal boots -> warm grey-brown/taupe boots."""
    if body.is_stub(im):
        return im
    arr = np.asarray(im, dtype=np.float32).copy()
    mask = arr[..., 3] > 0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    is_blue = mask & ((b - r) > 12)
    is_teal = mask & ((g - r) > 12) & (~is_blue)
    nr = np.where(is_blue | is_teal, lum * 212.0 + 8.0, lum * 228.0 + 4.0)
    ng = np.where(is_blue | is_teal, lum * 200.0 + 6.0, lum * 220.0 + 4.0)
    nb = np.where(is_blue | is_teal, lum * 192.0 + 4.0, lum * 214.0 + 2.0)
    dark = lum < 0.22
    nr = np.where(dark, r * 0.9, nr)
    ng = np.where(dark, g * 0.9, ng)
    nb = np.where(dark, b * 0.9, nb)
    arr[..., 0] = np.where(mask, np.clip(nr, 0, 255), r)
    arr[..., 1] = np.where(mask, np.clip(ng, 0, 255), g)
    arr[..., 2] = np.where(mask, np.clip(nb, 0, 255), b)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


class ReferenceDecoder(body.Decoder):
    """Decoder that applies the reference-video avatar palette & silhouette cleanup."""

    def __init__(self, client: Path, force: bool = False):
        super().__init__(client, force)
        self._body_frames: list[tuple[Image.Image | None, int, int]] | None = None

    def frames(self, key: str):
        raw_frames = super().frames(key)
        if key == "body":
            self._body_frames = raw_frames
            return raw_frames
        if key == "hair":
            return [(recolor_hair_ivory_white(im), x, y) for im, x, y in raw_frames]
        if key in ("pants", "pants_b"):
            return [(recolor_pants_slate_gold(im), x, y) for im, x, y in raw_frames]
        if key in ("shoes", "shoes_b"):
            return [(recolor_shoes_taupe(im), x, y) for im, x, y in raw_frames]
        if key == "coat":
            if self._body_frames is None:
                self._body_frames = super().frames("body")
            out = []
            for idx, (im, x, y) in enumerate(raw_frames):
                if idx < len(self._body_frames):
                    bim, bx, by = self._body_frames[idx]
                else:
                    bim, bx, by = None, 0, 0
                out.append((recolor_coat_vest(im, x, y, bim, bx, by), x, y))
            return out
        return raw_frames


@contextmanager
def reference_avatar_profile():
    overrides = reference_packs()
    saved_packs = {k: body.PACKS[k] for k in overrides}
    saved_layers = list(body.LAYERS)
    saved_overlays = list(body.OVERLAYS)
    saved_decoder = body.Decoder
    body.PACKS.update(overrides)
    body.LAYERS[:] = REFERENCE_LAYERS
    body.OVERLAYS[:] = []
    body.Decoder = ReferenceDecoder
    try:
        yield
    finally:
        body.PACKS.update(saved_packs)
        body.LAYERS[:] = saved_layers
        body.OVERLAYS[:] = saved_overlays
        body.Decoder = saved_decoder


def native_wave_body(client: Path, force: bool = False) -> Image.Image:
    with reference_avatar_profile():
        decoder = ReferenceDecoder(client, force)
        layers = [(key, decoder.frames(key)) for key in body.LAYERS]
        overlays = []
        sheet = Image.new("RGBA", (9 * 384, 320))
        for col, index in enumerate(range(42, 51)):
            pic, x, y, _ = body.composed_frame(layers, overlays, index)
            px, py = x - 232 + 160, y - 333 + 240
            if px < 0 or py < 0 or px + pic.width > 384 or py + pic.height > 320:
                raise ValueError(f"Native reference wave body {index} would be clipped")
            sheet.alpha_composite(pic, (col * 384 + px, py))
        return sheet


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--force", action="store_true", help="re-extract .img files from client")
    args = parser.parse_args()
    with reference_avatar_profile():
        sheet = body.build(args.client, args.force)
    sheet.save(ROOT / "assets/slayer-reference.png")
    native_wave_body(args.client, args.force).save(ROOT / "assets/normal-wave-body.png")
    print(
        f"Baked reference player (white spiky hair, cream vest, slate-grey/gold pants, "
        f"taupe boots, sswd0006): slayer-reference.png ({sheet.width}x{sheet.height}) + normal-wave-body.png"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
