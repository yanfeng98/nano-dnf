#!/usr/bin/env python3
"""Extract the classic 60/70 800x600 bottom HUD skin into `assets/hud-classic.png`.

Per ADR 0074, the local DNF client only contains round-orb HUD skins
(`hud.img` 800x91 / `mainhud.img` 640x88) and does not ship the 60/70
vertical-capsule + central circular hub HUD shown in the two reference
recordings (`00001-幽暗密林.mp4`, `00002-幽暗密林深处.mp4`).

This script samples diverse in-dungeon frames from both recordings (cropped to
the centered 1440x1080 4:3 viewport and Lanczos-downsampled to native 800x600)
to produce a pixel-accurate `800x200` RGBA sprite sheet:

- `(0, 0, 800, 100)`: Base 800x100 bottom HUD frame (`y = 500..600`) with
  transparent top silhouette, dark empty HP/MP capsule interiors, clean empty
  `Lv.` / XP track / fatigue box, and clean empty `1-6` & `A-H` sockets.
- `(0, 100, 42, 79)`: Full red HP capsule liquid (rounded capsule alpha mask).
- `(44, 100, 42, 79)`: Full blue MP capsule liquid (rounded capsule alpha mask).
- `(88, 100, 183, 10)`: Classic green XP fill bar texture.
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import tempfile
from collections import deque

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "hud-classic.png"

DEFAULT_VIDEOS = [
    (
        pathlib.Path("/home/luyanfeng/luyanfeng/dnf-素材/00001-幽暗密林.mp4"),
        [25, 40, 55, 62, 80, 105, 130, 160, 190, 220, 250, 290, 315],
    ),
    (
        pathlib.Path("/home/luyanfeng/luyanfeng/dnf-素材/00002-幽暗密林深处.mp4"),
        [20, 40, 60, 90, 120, 150, 180, 210, 240, 270, 310, 340],
    ),
]

# Native 800x600 coordinates relative to HUD top (y = 500)
HUD_TOP = 500
HUD_W = 800
HUD_H = 100

HP_BOX = (5, 14, 48, 83)     # x, y, w, h (native y = 514..597)
MP_BOX = (747, 14, 48, 83)   # x, y, w, h (native y = 514..597)
XP_BOX = (147, 39, 183, 10)  # x, y, w, h (native y = 539..549)
LV_BOX = (86, 33, 52, 14)    # x, y, w, h (native y = 533..547)
FATIGUE_BOX = (385, 84, 30, 11)  # x, y, w, h (native y = 584..595)

CONSUMABLE_SLOTS = [
    (95, 57, 35, 34),
    (133, 57, 36, 34),
    (172, 57, 36, 34),
    (211, 57, 35, 34),
    (249, 57, 36, 34),
    (288, 57, 36, 34),
]

SKILL_SLOTS = [
    (476, 57, 36, 34),
    (515, 57, 35, 34),
    (553, 57, 36, 34),
    (592, 57, 36, 34),
    (631, 57, 35, 34),
    (669, 57, 36, 34),
]


def sample_video_frames(cache_dir: pathlib.Path) -> tuple[np.ndarray, list[np.ndarray]]:
    """Return (all_hud_stack, full_hp_hud_list) of shape (N, 100, 800, 3)."""
    all_crops: list[np.ndarray] = []
    full_hp_crops: list[np.ndarray] = []

    for vid_path, timestamps in DEFAULT_VIDEOS:
        if not vid_path.exists():
            raise FileNotFoundError(f"Reference video not found: {vid_path}")
        stem = vid_path.stem[:5]
        for t in timestamps:
            frame_png = cache_dir / f"s_{stem}_{t}.png"
            if not frame_png.exists():
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-ss",
                        str(t),
                        "-i",
                        str(vid_path),
                        "-frames:v",
                        "1",
                        str(frame_png),
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                )
            im = (
                Image.open(frame_png)
                .convert("RGB")
                .crop((240, 0, 1680, 1080))
                .resize((800, 600), Image.Resampling.LANCZOS)
            )
            arr = np.array(im)[HUD_TOP : HUD_TOP + HUD_H, :, :]
            # Validate HUD presence (red HP capsule bottom & blue MP capsule bottom)
            if arr[60, 30, 0] > 120 and arr[60, 770, 2] > 100:
                all_crops.append(arr)
                # Full HP check near top of red capsule (y=522 -> local 22)
                if arr[22, 28, 0] > 140 and arr[22, 770, 2] > 140:
                    full_hp_crops.append(arr)

    if len(all_crops) < 8 or len(full_hp_crops) < 1:
        raise RuntimeError(
            f"Insufficient valid HUD frames: all={len(all_crops)}, full_hp={len(full_hp_crops)}"
        )
    return np.stack(all_crops, axis=0).astype(np.float32), full_hp_crops


def compute_top_silhouette_alpha(stack: np.ndarray) -> np.ndarray:
    """Compute a clean 100x800 uint8 alpha mask via top-down flood fill of high-variance world pixels."""
    med = np.median(stack, axis=0)
    mad = np.median(np.abs(stack - med[None, ...]), axis=0).mean(axis=2)  # 100x800

    # Pixels with MAD >= 8.0 are world background; flood-fill from top row (y=0)
    # so any interior varying pixels (XP bar, fatigue, skills) remain opaque!
    h, w = mad.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        if mad[0, x] >= 5.0:
            bg[0, x] = True
            q.append((0, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                if mad[ny, nx] >= 7.5:
                    bg[ny, nx] = True
                    q.append((ny, nx))

    # Smooth 1px anti-aliased edge on pixels bordering background
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not bg[y, x] and (bg[y - 1, x] or bg[y, x - 1] or bg[y, x + 1]):
                if mad[y, x] > 4.5:
                    # Soften anti-aliased fringe slightly
                    alpha[y, x] = int(np.clip((7.5 - mad[y, x]) / 3.0 * 255, 96, 255))
    return alpha


def capsule_interior_mask(w: int, h: int, inset: float = 1.5) -> np.ndarray:
    """Return a clean vertical-capsule mask of size (h, w) with rounded top & bottom semicircles."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = (w - 1) * 0.5
    rx = (w * 0.5) - inset
    ry = rx * 0.92  # slightly flattened top/bottom caps matching the 60/70 bezel
    top_cy = ry + inset
    bot_cy = h - 1 - ry - inset

    mask = np.zeros((h, w), dtype=np.float32)
    for y in range(h):
        for x in range(w):
            dx = (x - cx) / rx
            if y < top_cy:
                dy = (y - top_cy) / ry
                dist = (dx * dx + dy * dy) ** 0.5
            elif y > bot_cy:
                dy = (y - bot_cy) / ry
                dist = (dx * dx + dy * dy) ** 0.5
            else:
                dist = abs(dx)
            if dist <= 0.96:
                mask[y, x] = 1.0
            elif dist < 1.04:
                mask[y, x] = (1.04 - dist) / 0.08
    return mask


def capsule_liquid_mask(
    full_med: np.ndarray, box: tuple[int, int, int, int], channel: str
) -> np.ndarray:
    """Return a clean (bh, bw) float32 mask covering the exact liquid interior inside the gold bezel."""
    bx, by, bw, bh = box
    patch = full_med[by : by + bh, bx : bx + bw, :3]
    r, g, b = patch[:, :, 0], patch[:, :, 1], patch[:, :, 2]
    if channel == "hp":
        # Red liquid or white specular highlight inside the red capsule
        is_liq = ((r - g > 25) & (r - b > 25) & (r > 40)) | (
            (r > 130) & (g > 100) & (b > 100) & (np.arange(bh)[:, None] < 24) & (np.arange(bw)[None, :] < 24)
        )
    else:
        # Blue liquid or white specular highlight inside the blue capsule
        is_liq = ((b - r > 25) & (b > 45)) | (
            (b > 130) & (g > 110) & (r > 90) & (np.arange(bh)[:, None] < 24) & (np.arange(bw)[None, :] < 24)
        )
    # Also intersect with a generous rounded-rectangle interior so no gold bezel pixels are ever touched
    cap = capsule_interior_mask(bw, bh, inset=1.0)
    # Fill any interior holes (e.g. specular highlight) via bounding-per-row fill
    filled = np.zeros_like(is_liq)
    for y in range(bh):
        xs = np.where(is_liq[y])[0]
        if len(xs) >= 2:
            filled[y, xs[0] : xs[-1] + 1] = True
    mask = np.where(filled, 1.0, 0.0).astype(np.float32) * (cap > 0.05)
    # Soft 1px feather at boundary
    out = mask.copy()
    for y in range(1, bh - 1):
        for x in range(1, bw - 1):
            if mask[y, x] > 0.5 and (
                mask[y - 1, x] < 0.5
                or mask[y + 1, x] < 0.5
                or mask[y, x - 1] < 0.5
                or mask[y, x + 1] < 0.5
            ):
                out[y, x] = 0.85
    return out


def fill_dark_capsule_interior(
    base: np.ndarray,
    full_med: np.ndarray,
    box: tuple[int, int, int, int],
    channel: str,
) -> None:
    """Replace the liquid pixels inside a capsule with the classic dark empty glass interior."""
    bx, by, bw, bh = box
    cap = capsule_liquid_mask(full_med, box, channel)
    # Horizontal cylindrical shading of empty dark capsule (matches drained top of HP in video)
    xs = np.linspace(-1.0, 1.0, bw)[None, :]
    shade = 1.0 - 0.35 * (xs * xs)
    empty_r = np.clip(26.0 * shade, 10, 42)
    empty_g = np.clip(24.0 * shade, 10, 38)
    empty_b = np.clip(22.0 * shade, 10, 36)
    empty_rgb = np.stack(
        [
            np.broadcast_to(empty_r, (bh, bw)),
            np.broadcast_to(empty_g, (bh, bw)),
            np.broadcast_to(empty_b, (bh, bw)),
        ],
        axis=2,
    )
    region = base[by : by + bh, bx : bx + bw, :3].astype(np.float32)
    blended = region * (1.0 - cap[:, :, None]) + empty_rgb * cap[:, :, None]
    base[by : by + bh, bx : bx + bw, :3] = np.clip(blended, 0, 255).astype(np.uint8)


def extract_capsule_liquid(
    full_med: np.ndarray, box: tuple[int, int, int, int], channel: str
) -> np.ndarray:
    """Extract an RGBA (bh, bw, 4) liquid sprite masked cleanly to the capsule interior."""
    bx, by, bw, bh = box
    cap = capsule_liquid_mask(full_med, box, channel)
    rgba = np.zeros((bh, bw, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(full_med[by : by + bh, bx : bx + bw, :3], 0, 255).astype(
        np.uint8
    )
    rgba[:, :, 3] = np.clip(cap * 255.0, 0, 255).astype(np.uint8)
    return rgba


def build_classic_hud(cache_dir: pathlib.Path, out_path: pathlib.Path) -> None:
    stack, full_hp_crops = sample_video_frames(cache_dir)
    med = np.median(stack, axis=0)
    full_med = np.median(np.stack(full_hp_crops, axis=0).astype(np.float32), axis=0)
    alpha = compute_top_silhouette_alpha(stack)

    # Start with the 800x100 base frame
    base = np.zeros((HUD_H, HUD_W, 4), dtype=np.uint8)
    base[:, :, :3] = np.clip(med, 0, 255).astype(np.uint8)
    base[:, :, 3] = alpha

    # Extract full HP & MP liquid textures BEFORE clearing the base frame interiors
    hp_liquid = extract_capsule_liquid(full_med, HP_BOX, "hp")
    mp_liquid = extract_capsule_liquid(full_med, MP_BOX, "mp")

    # Extract green XP fill bar texture from the bright green portion (x=152..196, y=39..49)
    # and stretch smoothly to full 183x10 width
    xp_x, xp_y, xp_w, xp_h = XP_BOX
    xp_sample = med[xp_y : xp_y + xp_h, 152:196, :3]
    xp_col = np.median(xp_sample, axis=1)  # (10, 3) vertical green gradient profile
    xp_fill = np.zeros((xp_h, xp_w, 4), dtype=np.uint8)
    for row in range(xp_h):
        xp_fill[row, :, :3] = np.clip(xp_col[row], 0, 255).astype(np.uint8)
        xp_fill[row, :, 3] = 255
    # Subtle 1px darker left/right caps on XP fill
    xp_fill[:, 0, :3] = (xp_fill[:, 0, :3].astype(np.float32) * 0.72).astype(np.uint8)
    xp_fill[:, -1, :3] = (xp_fill[:, -1, :3].astype(np.float32) * 0.72).astype(np.uint8)

    # Clear dynamic regions in the base frame:
    # 1. Empty dark interiors for HP & MP capsules
    fill_dark_capsule_interior(base, full_med, HP_BOX, "hp")
    fill_dark_capsule_interior(base, full_med, MP_BOX, "mp")

    # 2. Clean Lv. text area using the dark background immediately to the right of 'Lv. 6'
    lx, ly, lw, lh = LV_BOX
    lv_bg = np.median(med[ly : ly + lh, 125:142, :3], axis=(0, 1))
    base[ly : ly + lh, lx : lx + lw, :3] = np.clip(lv_bg, 0, 255).astype(np.uint8)

    # 3. Clean empty XP track (+1px top/bottom border to remove any green bleed)
    xp_empty_col = np.median(med[xp_y - 1 : xp_y + xp_h + 1, 285:324, :3], axis=1)
    for idx, row in enumerate(range(xp_y - 1, xp_y + xp_h + 1)):
        base[row, xp_x : xp_x + xp_w, :3] = np.clip(
            xp_empty_col[idx], 0, 255
        ).astype(np.uint8)

    # 4. Clean fatigue number box using the dark blue border pixels inside the box
    fx, fy, fw, fh = FATIGUE_BOX
    # Sample top/bottom inner edges of the fatigue blue box (free of cyan digits)
    fat_bg = np.median(med[fy : fy + 2, fx : fx + fw, :3], axis=(0, 1))
    base[fy : fy + fh, fx : fx + fw, :3] = np.clip(fat_bg, 0, 255).astype(np.uint8)

    # 5. Clean empty sockets for all 6 consumable slots (1..6) and 6 skill slots (A..H)
    # Clone the pristine empty dark socket interior from slot G (index 4: x=631, y=57, w=35, h=34)
    gx, gy, gw, gh = SKILL_SLOTS[4]
    empty_socket = Image.fromarray(
        np.clip(med[gy : gy + gh, gx : gx + gw, :3], 0, 255).astype(np.uint8)
    )
    for sx, sy, sw, sh in CONSUMABLE_SLOTS + SKILL_SLOTS:
        patch = empty_socket if (sw == gw and sh == gh) else empty_socket.resize((sw, sh), Image.Resampling.BILINEAR)
        base[sy : sy + sh, sx : sx + sw, :3] = np.array(patch)

    # Assemble final 800x200 sprite sheet
    sheet = np.zeros((200, 800, 4), dtype=np.uint8)
    sheet[0:HUD_H, 0:HUD_W, :] = base
    sheet[100 : 100 + HP_BOX[3], 0 : HP_BOX[2], :] = hp_liquid
    sheet[100 : 100 + MP_BOX[3], 50 : 50 + MP_BOX[2], :] = mp_liquid
    sheet[100 : 100 + XP_BOX[3], 100 : 100 + XP_BOX[2], :] = xp_fill

    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, mode="RGBA").save(out_path)
    print(f"Wrote {out_path} ({sheet.shape[1]}x{sheet.shape[0]} RGBA)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache", type=pathlib.Path, default=None)
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    args = ap.parse_args()

    if args.cache is not None:
        args.cache.mkdir(parents=True, exist_ok=True)
        build_classic_hud(args.cache, args.out)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            build_classic_hud(pathlib.Path(tmp), args.out)


if __name__ == "__main__":
    main()
