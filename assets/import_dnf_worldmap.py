#!/usr/bin/env python3
"""Bake `assets/worldmap-arad.png` (800x720) for the classic 60/70 Gran Floris region map.

Per ADR 0074:
- Top 800x600: Clean 60/70 parchment 《阿拉德大陆》 map reconstructed from the
  reference video `00002-幽暗密林深处.mp4` (since `ImagePacks2_70/sprite_worldmap.NPK`
  only ships the newer 70-cap grey-brown `granfloris.img`).
- Bottom 800x120 (y=600..720): Native client buttons & difficulty arrows from
  `ImagePacks2_70/sprite_interface.NPK :: sprite/interface/selectdungeon.img`
  (`前往地下城` f17/f18/f19, `返回城镇` f20/f21/f22, `< >` arrows f10/f11/f13/f14),
  plus 30x30 crossed-sword node icons (normal & selected orange glow).

Usage:
    python3 assets/import_dnf_worldmap.py
"""

from __future__ import annotations

import argparse
import io
import pathlib
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
DEFAULT_VIDEO = pathlib.Path("/home/luyanfeng/luyanfeng/dnf-素材/00002-幽暗密林深处.mp4")
OUT = ROOT / "assets" / "worldmap-arad.png"


def extract_video_frame_800x600(video: pathlib.Path, timestamp: str) -> Image.Image:
    with tempfile.TemporaryDirectory() as td:
        out_png = pathlib.Path(td) / "frame.png"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                timestamp,
                "-i",
                str(video),
                "-frames:v",
                "1",
                str(out_png),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        im = Image.open(out_png).convert("RGB")
        # 1920x1080 video has centered 4:3 game viewport at x=240..1680, y=0..1080
        return im.crop((240, 0, 1680, 1080)).resize((800, 600), Image.LANCZOS)


def build_clean_parchment_map(video: pathlib.Path) -> Image.Image:
    # Frame at 2.6s has clean parchment map with only the translucent Map Select bar + cursor.
    # Frame at 4.5s has cards/buttons but NO Map Select bar and NO cursor on the far right.
    clean_bar = np.array(extract_video_frame_800x600(video, "2.6"), dtype=np.float32)
    with_cards = np.array(extract_video_frame_800x600(video, "4.5"), dtype=np.float32)

    out = clean_bar.copy()

    # 1. Remove hand cursor on clean_bar (x=725..798, y=360..452) using with_cards
    out[360:452, 725:798] = with_cards[360:452, 725:798]

    # 2. Measure exact linear blend of the translucent Map Select bar (y=233..310)
    #    using the clean right strip x=620..770 where with_cards has no UI.
    ks = []
    cs = []
    for ch in range(3):
        xb = with_cards[236:308, 620:770, ch].ravel()
        xa = clean_bar[236:308, 620:770, ch].ravel()
        k, c = np.polyfit(xb, xa, 1)
        ks.append(k)
        cs.append(c)

    # Invert the inner uniform band (y=233..311) from clean_bar
    bar_y0, bar_y1 = 231, 313
    inverted = out[bar_y0:bar_y1].copy()
    for y_abs in range(bar_y0, bar_y1):
        # Softly ramp inversion at top/bottom 2px border of the translucent bar
        if y_abs == 231 or y_abs == 312:
            w = 0.25
        elif y_abs == 232 or y_abs == 311:
            w = 0.65
        else:
            w = 1.0
        for ch in range(3):
            inv_row = np.clip((clean_bar[y_abs, :, ch] - cs[ch]) / ks[ch], 0, 255)
            inverted[y_abs - bar_y0, :, ch] = (1.0 - w) * clean_bar[y_abs, :, ch] + w * inv_row

    # Start with inverted band, then copy ALL unoccluded parchment from with_cards!
    out[bar_y0:bar_y1] = inverted

    # Copy all clean parchment regions of with_cards inside y=231..313:
    # - Left margin x=0..46
    out[bar_y0:bar_y1, 0:46] = with_cards[bar_y0:bar_y1, 0:46]
    # - Center x=198..432 (has Gran Floris trees and zero Map Select text!)
    out[bar_y0:bar_y1, 198:432] = with_cards[bar_y0:bar_y1, 198:432]
    # - Right margin x=584..800
    out[bar_y0:bar_y1, 584:800] = with_cards[bar_y0:bar_y1, 584:800]
    # - Strip below sunderlandpoison card (y=293..313, x=432..584)
    out[293:bar_y1, 432:584] = with_cards[293:bar_y1, 432:584]
    # - Strip above mirkwooddeep card (y=231..255, x=46..198)
    out[bar_y0:255, 46:198] = with_cards[bar_y0:255, 46:198]

    # Cleanly remove the 4 crossed-sword icons & pointer inside x=198..432, y=231..313
    # by smoothly filling them from neighboring clean parchment, and also remove the
    # residual "ct" letters of "Map Select" at x=432..540, y=240..293.
    # For x=432..540, y=240..293: interpolate vertically between clean parchment at y=224..230
    # and clean parchment at y=294..304 (preserving horizontal gradient & grid lines!).
    top_ref = out[222:228, 432:584].mean(axis=0)
    bot_ref = out[295:301, 432:584].mean(axis=0)
    for y_abs in range(231, 294):
        t = (y_abs - 230.0) / (294.0 - 230.0)
        out[y_abs, 432:584] = (1.0 - t) * top_ref + t * bot_ref

    # Remove the black diagonal pointer at x=385..432, y=252..288 by interpolating vertically
    top_p = out[246:252, 385:432].mean(axis=0)
    bot_p = out[290:296, 385:432].mean(axis=0)
    for y_abs in range(252, 290):
        t = (y_abs - 251.0) / (290.0 - 251.0)
        out[y_abs, 385:432] = (1.0 - t) * top_p + t * bot_p

    # Remove the 4 small sword icons on with_cards inside y=220..315 using local vertical blend
    for sx0, sy0, sx1, sy1 in [
        (277, 224, 309, 254),  # grakkarakburning node
        (271, 283, 303, 313),  # sunderland node
        (359, 271, 391, 301),  # sunderlandpoison node
        (378, 220, 410, 248),  # grakkarak node
    ]:
        t_ref = out[sy0 - 4:sy0, sx0:sx1].mean(axis=0)
        b_ref = out[sy1:sy1 + 4, sx0:sx1].mean(axis=0)
        for y_abs in range(sy0, sy1):
            t = (y_abs - sy0) / float(sy1 - sy0)
            out[y_abs, sx0:sx1] = (1.0 - t) * t_ref + t * b_ref

    # 3. Cleanly remove top-left Bilibili watermark (x=0..56, y=30..56) by shifting clean
    #    parchment straight up from y=56..82 (preserves top brown border y=0..29 and grid line!).
    patch = out[56:82, 0:56].copy()
    for i in range(6):
        alpha = i / 6.0
        row = 20 + i
        patch[row] = (1.0 - alpha) * patch[row] + alpha * out[30 + row, 0:56]
    out[30:56, 0:56] = patch
    # Also clean the small watermark letters on the top brown border (x=0..56, y=18..29)
    # by copying clean brown border from x=56..112, y=18..29
    out[18:30, 0:56] = out[18:30, 56:112]

    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")


def draw_crossed_swords_icon(selected: bool) -> Image.Image:
    """Draw a crisp 30x30 classic DNF crossed-swords dungeon node icon."""
    im = Image.new("RGBA", (30, 30), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    if selected:
        # Warm fiery orange-red halo behind the crossed swords
        for r, col in [
            (14, (255, 80, 10, 90)),
            (12, (255, 110, 20, 150)),
            (10, (255, 165, 45, 200)),
            (7, (255, 230, 120, 220)),
        ]:
            d.ellipse((15 - r, 15 - r, 15 + r, 15 + r), fill=col)

    outline = (38, 14, 6, 255) if selected else (28, 24, 20, 255)
    blade_hi = (255, 252, 238, 255) if selected else (240, 242, 248, 255)
    blade_mid = (255, 215, 145, 255) if selected else (182, 188, 198, 255)
    guard_col = (224, 128, 42, 255) if selected else (150, 118, 72, 255)
    hilt_col = (145, 58, 22, 255) if selected else (96, 68, 42, 255)

    # Two diagonal swords: top-left -> bottom-right and top-right -> bottom-left
    # Draw outlines first, then blade & hilt fills
    for flip in (False, True):
        def pt(x: int, y: int) -> tuple[int, int]:
            return (29 - x, y) if flip else (x, y)

        # Blade polygon (tip at (4,4), base at (20,20))
        blade_out = [pt(3, 3), pt(9, 4), pt(22, 17), pt(17, 22), pt(4, 9)]
        blade_in = [pt(5, 5), pt(9, 6), pt(20, 17), pt(17, 20), pt(6, 9)]
        d.polygon(blade_out, fill=outline)
        d.polygon(blade_in, fill=blade_mid)
        # Bright edge highlight
        d.line([pt(5, 5), pt(18, 18)], fill=blade_hi, width=2)

        # Crossguard perpendicular at (19,19)
        d.line([pt(15, 23), pt(23, 15)], fill=outline, width=5)
        d.line([pt(16, 22), pt(22, 16)], fill=guard_col, width=3)

        # Hilt + pommel
        d.line([pt(20, 20), pt(25, 25)], fill=outline, width=5)
        d.line([pt(20, 20), pt(24, 24)], fill=hilt_col, width=3)
        px, py = pt(25, 25)
        d.ellipse((px - 2, py - 2, px + 2, py + 2), fill=guard_col, outline=outline)

    return im


def load_selectdungeon_frames(client: pathlib.Path) -> list[Image.Image]:
    npk_path = client / "ImagePacks2_70" / "sprite_interface.NPK"
    with open(npk_path, "rb") as f:
        npk = NPK.open(f)
        for item in npk.files:
            if item.name.replace("\\", "/").endswith("/selectdungeon.img"):
                img = IMGFactory.open(io.BytesIO(item.data))
                return [img.build(fr).convert("RGBA") for fr in img.images]
    raise SystemExit(f"selectdungeon.img not found in {npk_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    ap.add_argument("--video", type=pathlib.Path, default=DEFAULT_VIDEO)
    args = ap.parse_args()

    sheet = Image.new("RGBA", (800, 720), (0, 0, 0, 0))

    # 1. Parchment map (0, 0, 800, 600)
    parchment = build_clean_parchment_map(args.video)
    sheet.alpha_composite(parchment, (0, 0))

    # 2. Native buttons & arrows from selectdungeon.img
    sd = load_selectdungeon_frames(args.client)
    # Row y=600: enter dungeon buttons & return town buttons
    sheet.alpha_composite(sd[17], (0, 600))    # 前往地下城 normal (162x30)
    sheet.alpha_composite(sd[18], (164, 600))  # 前往地下城 hover  (162x30)
    sheet.alpha_composite(sd[19], (328, 600))  # 前往地下城 glow   (178x41)
    sheet.alpha_composite(sd[20], (508, 600))  # 返回城镇 normal   (108x28)
    sheet.alpha_composite(sd[21], (618, 600))  # 返回城镇 hover    (108x28)
    # Row y=644: return town glow, difficulty arrows, crossed-sword icons
    sheet.alpha_composite(sd[22], (0, 644))    # 返回城镇 glow     (121x38)
    sheet.alpha_composite(sd[10], (128, 644))  # '<' normal        (22x14)
    sheet.alpha_composite(sd[11], (152, 644))  # '<' hover         (22x14)
    sheet.alpha_composite(sd[13], (176, 644))  # '>' normal        (22x14)
    sheet.alpha_composite(sd[14], (200, 644))  # '>' hover         (22x14)

    # Crossed-sword node icons (30x30)
    sheet.alpha_composite(draw_crossed_swords_icon(False), (228, 644))
    sheet.alpha_composite(draw_crossed_swords_icon(True), (262, 644))

    sheet.save(OUT)
    print(f"wrote {OUT} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
