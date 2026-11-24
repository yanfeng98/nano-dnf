#!/usr/bin/env python3
"""Bake the 2-zone Hendon Myre (赫顿玛尔) town atlas out of the DNF 70-era client.

Extracts authentic Hendon Myre assets from `ImagePacks2_70/sprite_map_hendonmyre.NPK`
matching Video 1 (`00001-幽暗密林.mp4` @ 12s, 18s, 46s, 50s) and Video 2 (@ 415s),
and localizes the two wooden directional signposts into Chinese per ADR 0074.

Usage:
    python3 assets/import_dnf_hendonmyre.py
    python3 assets/import_dnf_hendonmyre.py --client /mnt/c/dnf/地下城与勇士
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import shelf_pack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
NPK_NAME = "sprite_map_hendonmyre.NPK"
OUT = ROOT / "assets" / "hendonmyre.png"
META = ROOT / "assets" / "dnf_src" / "hendonmyre.json"

# (key, entry_filename, frame_index)
PIECES = [
    ("far", "hmfar01.img", 0),
    ("mid", "hmmid01.img", 0),
    ("wall", "hmwall.img", 0),
    ("tile", "hmtile.img", 0),
    ("tileEx", "hmtileex.img", 0),
    ("skybridge", "skybridge.img", 0),
    ("skywall", "skywall.img", 0),
    ("brtile01", "brtile01.img", 0),
    ("brtile02", "brtile02.img", 0),
    ("brtile03", "brtile03.img", 1),
    ("hmbrltile01", "hmbrltile01.img", 0),
    ("statueArch", "hmobj01.img", 17),
    ("eastArch", "hendonpath.img", 1),
    ("portalArch", "hendonpath.img", 0),
    ("archRunes", "hendonpath.img", 3),
    ("banner", "hmpoll.img", 3),
    ("treeTall", "hmobj04.img", 0),
    ("treeMed", "hmobj04.img", 1),
    ("treeWide", "hmtree00.img", 0),
    ("kannaHouse", "hmkannahouse.img", 0),
    ("sindaHouse", "hmsindahouse.img", 0),
    ("albertHouse", "hmalberthouse.img", 0),
    ("blueWindowHouse", "hmobj01.img", 15),
    ("seriaHouse", "hmseriahouse.img", 0),
]


def load_npk_entries(client: pathlib.Path) -> dict[str, bytes]:
    for folder in ("ImagePacks2_70", "ImagePacks2"):
        npk_path = client / folder / NPK_NAME
        if npk_path.exists():
            with open(npk_path, "rb") as f:
                npk = NPK.open(f)
                npk.load_all()
                return {e.name.replace("\\", "/").split("/")[-1]: e.data for e in npk.files}
    raise SystemExit(f"{NPK_NAME} not found under {client}")


def decode_piece(entries: dict[str, bytes], filename: str, frame_index: int) -> Image.Image:
    if filename not in entries:
        raise SystemExit(f"{filename} not found in {NPK_NAME}")
    img = IMGFactory.open(io.BytesIO(entries[filename]))
    frame = img.images[frame_index]
    pil = img.build(frame).convert("RGBA")
    bbox = pil.getbbox()
    return pil.crop(bbox) if bbox else pil


def load_cjk_font(client: pathlib.Path, size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        client / "Fonts" / "msjh.ttf",
        pathlib.Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def draw_arrow(draw: ImageDraw.ImageDraw, kind: str, cx: int, cy: int, fill: tuple[int, int, int, int]):
    outline = (24, 20, 14, 255)
    if kind == "up":
        pts = [(cx, cy - 5), (cx - 5, cy + 4), (cx + 5, cy + 4)]
    elif kind == "down":
        pts = [(cx, cy + 5), (cx - 5, cy - 4), (cx + 5, cy - 4)]
    elif kind == "left":
        pts = [(cx - 5, cy), (cx + 4, cy - 5), (cx + 4, cy + 5)]
    elif kind == "right":
        pts = [(cx + 5, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)]
    else:
        return
    draw.polygon(pts, fill=fill, outline=outline)


def build_localized_signpost(
    base_img: Image.Image,
    client: pathlib.Path,
    planks: list[tuple[str, str, tuple[int, int, int, int], str | None]],
    start_y: int,
    plank_h: int,
    gap_y: int,
) -> Image.Image:
    """Keep authentic client wooden signpost crest & legs, localize plank text to Chinese."""
    out = base_img.copy()
    draw = ImageDraw.Draw(out)
    w, _ = out.size
    font = load_cjk_font(client, 13)

    for i, (label, arrow_pos, text_color, icon_kind) in enumerate(planks):
        y0 = start_y + i * (plank_h + gap_y)
        y1 = y0 + plank_h - 1
        # Authentic weathered wooden plank matching client palette
        draw.rectangle([2, y0, w - 3, y1], fill=(124, 108, 79, 255), outline=(44, 36, 28, 255))
        draw.line([(3, y0 + 1), (w - 4, y0 + 1)], fill=(166, 144, 104, 255))
        draw.line([(3, y1 - 1), (w - 4, y1 - 1)], fill=(84, 72, 52, 255))

        cy = (y0 + y1) // 2
        if arrow_pos == "left_up":
            draw_arrow(draw, "up", 14, cy, (238, 206, 86, 255))
        elif arrow_pos == "left_left":
            draw_arrow(draw, "left", 14, cy, (186, 224, 72, 255))
        elif arrow_pos == "left_red":
            draw_arrow(draw, "left", 14, cy, (232, 68, 52, 255))
        elif arrow_pos == "left_down":
            draw_arrow(draw, "down", 14, cy, (238, 206, 86, 255))
        elif arrow_pos == "right_right":
            draw_arrow(draw, "right", w - 14, cy, (238, 206, 86, 255))
        elif arrow_pos == "right_green":
            draw_arrow(draw, "right", w - 14, cy, (186, 224, 72, 255))
        elif arrow_pos == "right_down":
            draw_arrow(draw, "down", w - 14, cy, (238, 206, 86, 255))

        # Small icon badge for Seria's Inn or Gran Floris crossed swords
        text_cx = w // 2
        if icon_kind == "seria":
            ix = 24
            draw.rectangle([ix, cy - 6, ix + 12, cy + 6], fill=(235, 224, 210, 255), outline=(40, 32, 24, 255))
            draw.ellipse([ix + 2, cy - 4, ix + 10, cy + 4], fill=(230, 148, 128, 255))
            text_cx = w // 2 + 4
        elif icon_kind == "swords":
            ix = 27
            draw.line([(ix - 4, cy - 4), (ix + 4, cy + 4)], fill=(238, 232, 215, 255), width=2)
            draw.line([(ix + 4, cy - 4), (ix - 4, cy + 4)], fill=(238, 232, 215, 255), width=2)
            text_cx = w // 2 + 6

        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = text_cx - tw // 2
        ty = cy - th // 2 - bbox[1]
        # Crisp 1px black pixel-art outline
        for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 1)):
            draw.text((tx + ox, ty + oy), label, font=font, fill=(14, 12, 10, 255))
        draw.text((tx, ty), label, font=font, fill=text_color)

    return out


def bake_hendonmyre(client: pathlib.Path) -> None:
    entries = load_npk_entries(client)
    art: list[tuple[str, Image.Image]] = []
    for key, filename, frame_idx in PIECES:
        art.append((key, decode_piece(entries, filename, frame_idx)))

    # West Square signpost (matches V1 @ 12s & 18s)
    west_base = decode_piece(entries, "asigns.img", 0)
    sign_west = build_localized_signpost(
        west_base,
        client,
        planks=[
            ("后街", "left_up", (245, 242, 232, 255), None),
            ("斯顿雪域", "left_left", (210, 238, 108, 255), None),
            ("赛丽亚旅馆", "right_right", (248, 244, 235, 255), "seria"),
            ("赫顿玛尔市区", "right_down", (245, 242, 232, 255), None),
        ],
        start_y=43,
        plank_h=24,
        gap_y=2,
    )
    art.append(("signWest", sign_west))

    # East Gate signpost (matches V1 @ 46s)
    east_base = decode_piece(entries, "signs.img", 3)
    sign_east = build_localized_signpost(
        east_base,
        client,
        planks=[
            ("格兰之森", "left_red", (250, 244, 234, 255), "swords"),
            ("赫顿玛尔小巷", "left_up", (245, 242, 232, 255), None),
            ("赛丽亚旅馆", "left_up", (248, 244, 235, 255), "seria"),
            ("西海岸", "right_green", (212, 238, 108, 255), None),
            ("赫顿玛尔市政厅", "left_down", (245, 242, 232, 255), None),
        ],
        start_y=36,
        plank_h=24,
        gap_y=2,
    )
    art.append(("signEast", sign_east))

    width = 2048
    spots, height = shelf_pack([(im.width, im.height) for _, im in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, im), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(im, (x, y))
        rects[name] = {"x": x, "y": y, "w": w, "h": h}

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(
        json.dumps({"sheet": {"w": sheet.width, "h": sheet.height}, "rects": rects}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"hendonmyre: {len(art)} pieces -> {OUT} ({sheet.width}x{sheet.height})")
    for name, r in rects.items():
        print(f"  {name:16s}: [{r['x']:4d}, {r['y']:4d}, {r['w']:4d}, {r['h']:4d}]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = ap.parse_args()
    bake_hendonmyre(args.client)


if __name__ == "__main__":
    main()
