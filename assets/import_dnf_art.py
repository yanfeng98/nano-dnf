#!/usr/bin/env python3
"""Import DNF (Dungeon & Fighter) sprite art into the game's sprite sheet.

Source art: the Slayer (鬼剑士) SD character frames and Slayer skill icons that
are mirrored on GitHub as raw `.img` files. Supply the files yourself (or let
this script download them) into ``assets/dnf_src/`` and rerun:

    pip install pydnfex pillow
    python3 assets/import_dnf_art.py

Outputs the same layout the renderer expects:
  assets/slayer.png  - 6 x 5 frames of 96x96 (idle / run / attack / skill / extras)
  assets/skills.png  - four 32x32 skill icons in SKILL_ORDER order

Note: DNF artwork belongs to Neople/Nexon. This project is a private experiment;
do not redistribute the generated sheets as your own work.
"""

from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dnf_src"

SOURCES = {
    # Slayer SD character animation frames (43 frames: stand / walk / attack).
    "c_swordman.img": "https://raw.githubusercontent.com/LoveOyy/sprite_creature_sdcharacter_swordman.NPK/master/c_swordman.img.js",
    # Slayer skill icon atlas (28x28 icons).
    "skillicon.img": "https://raw.githubusercontent.com/LoveOyy/sprite_character_swordman_effect.NPK/master/skillicon.img.js",
    # Second Slayer icon atlas (423 frames, 2nd-awakening / EX skills).
    "atskillicon.img": "https://raw.githubusercontent.com/LoveOyy/sprite_character_swordman_effect.NPK/master/atskillicon.img.js",
}

FRAME = 96
COLS = 6
ROWS = 5

# Frame picks inside c_swordman.img (verified by eye against the source sheet).
FRAMES = {
    "idle": [0, 1, 2, 3],
    "run": [8, 9, 10, 11, 12, 13],
    "attack": [24, 29, 33],
    "skill": [25, 31, 37, 41],
    "extras": [21, 17, 20],  # hurt, jump, fall (dead is synthesised below)
}

# One 32x32 icon per skill, in this order (must match SKILL_ORDER in src/core.js).
SKILL_IDS = [
    "upSlash",
    "mountainBreaker",
    "crossSlash",
    "bloodSword",
    "frenzy",
    "bloodyRave",
    "rageBurst",
    "bloodSnatch",
    "graspHead",
    "bloodEvil",
    "mountainRift",
]

# Official skill-icon frames the project owner picked from the labelled atlas
# (the file has no name table):
#   python3 assets/import_dnf_art.py --atlas          # labelled contact sheet
#   python3 assets/import_dnf_art.py --icons 3,5,7,9  # re-bake with chosen frames
# Skills without an entry fall back to a thumbnail of their own official effect
# art, so every hotbar slot shows art that belongs to that skill.
# All eleven frames were picked by the project owner from that sheet, so every
# hotbar slot shows the real DNF icon for its skill.
ICON_FRAMES = {
    "upSlash": 94,
    "mountainBreaker": 154,
    "crossSlash": 132,
    "rageBurst": 48,
    "graspHead": 98,
    "mountainRift": 172,
}
# 血气之刃 / 暴走 / 血气爆发 / 嗜血 / 血魔 are Berserker moves the owner picked no
# atlas frame for, and the frames that used to sit in those slots belonged to the
# 鬼泣/剑魂 skills they replaced. They keep the effect-thumbnail fallback below
# until the owner picks frames off dnf_skillicon_atlas.png with --icons.
ICON_FRAME_ORDER = SKILL_IDS

# Where the character's feet sit inside the source canvas.
SRC_CANVAS = (180, 176)
SRC_ANCHOR = (82.0, 148.0)
SCALE = 1.6  # 40px source character -> 64px in game, matching the hitbox height
ANCHOR_X = 46.0  # must match SPRITE.anchorX in src/render.js
ANCHOR_Y = 88.0  # must match SPRITE.anchorY in src/render.js


def fetch(name: str, url: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    target = SRC / name
    if target.exists() and target.stat().st_size > 1024:
        return target
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        target.write_bytes(response.read())
    return target


def load_img_tools():
    try:
        from pydnfex.img.image.format import FormatConvertor
        from pydnfex.img.version import IMGFactory
        from pydnfex.util import image as image_util
    except ImportError:
        print("missing dependency: pip install pydnfex pillow", file=sys.stderr)
        raise SystemExit(2)
    return IMGFactory, image_util, FormatConvertor


def open_img(path: Path):
    IMGFactory, _, _ = load_img_tools()
    with open(path, "rb") as handle:
        return IMGFactory.open(io.BytesIO(handle.read()))


def frame_image(img, index: int) -> Image.Image:
    """Render one frame (following link frames) onto its full source canvas."""
    _, image_util, convertor = load_img_tools()
    frames = img.images
    seen = set()
    while type(frames[index]).__name__ == "ImageLink":
        if index in seen:
            raise RuntimeError("link loop")
        seen.add(index)
        index = frames[index].index
    item = frames[index]
    raw = item.data
    try:
        raw = convertor.to_raw(raw, item.format)
    except Exception:
        pass
    sprite = image_util.load_raw(raw, item.w, item.h).convert("RGBA")
    canvas = Image.new("RGBA", SRC_CANVAS, (0, 0, 0, 0))
    canvas.alpha_composite(sprite, (item.x, item.y))
    return canvas


def crop_character(canvas: Image.Image) -> Image.Image:
    """Crop a frame so the character lands on the renderer's anchor point."""
    size = FRAME / SCALE
    left = SRC_ANCHOR[0] - ANCHOR_X / SCALE
    top = SRC_ANCHOR[1] - ANCHOR_Y / SCALE
    window = canvas.crop((round(left), round(top), round(left + size), round(top + size)))
    return window.resize((FRAME, FRAME), Image.LANCZOS)


def build_sheet() -> None:
    swordman = open_img(fetch("c_swordman.img", SOURCES["c_swordman.img"]))
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))

    def place(row: int, col: int, frame_index: int, tint=None, rotate=0) -> None:
        tile = crop_character(frame_image(swordman, frame_index))
        offset = (0, 0)
        if rotate:
            tile = tile.rotate(rotate, resample=Image.BICUBIC, expand=False)
            offset = (0, 22)
        if tint:
            tile = ImageEnhance.Color(tile).enhance(0.5)
            overlay = Image.new("RGBA", tile.size, tint)
            overlay.putalpha(tile.getchannel("A").point(lambda a: int(a * 0.35)))
            tile = Image.alpha_composite(tile, overlay)
        sheet.alpha_composite(tile, (col * FRAME + offset[0], row * FRAME + offset[1]))

    for col, index in enumerate(FRAMES["idle"]):
        place(0, col, index)
    for col, index in enumerate(FRAMES["run"]):
        place(1, col, index)
    for col, index in enumerate(FRAMES["attack"]):
        place(2, col, index)
    for col, index in enumerate(FRAMES["skill"]):
        place(3, col, index)

    hurt, jump, fall = FRAMES["extras"]
    place(4, 0, hurt, tint=(255, 70, 70, 255))
    place(4, 1, hurt, tint=(60, 30, 40, 255), rotate=-90)
    place(4, 2, jump)
    place(4, 3, fall)

    sheet.save(ROOT / "slayer.png")
    print(f"wrote {ROOT / 'slayer.png'} ({sheet.width}x{sheet.height})")


def skill_icon(skill_id: str, icons, image_util, convertor) -> Image.Image:
    """Official icon frame when the owner picked one, else that skill's effect art."""
    if skill_id in ICON_FRAMES:
        item = icons.images[ICON_FRAMES[skill_id]]
        raw = item.data
        try:
            raw = convertor.to_raw(raw, item.format)
        except Exception:
            pass
        return image_util.load_raw(raw, item.w, item.h).convert("RGBA").resize((32, 32), Image.LANCZOS)
    return effect_thumbnail(skill_id)


def effect_thumbnail(skill_id: str) -> Image.Image:
    """Crop the fullest frame of the skill's own baked DNF effect.

    Sampling one fixed column made thin blood slashes read as smudges; the
    widest-drawn frame of the four is the one that looks like the move.
    """
    sheet = ROOT / "effects.png"
    if not sheet.exists():
        return Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    effects = Image.open(sheet).convert("RGBA")
    row = SKILL_IDS.index(skill_id)
    cell = effects.width // 4
    best, best_area = None, 0
    for column in range(4):
        frame = effects.crop((cell * column, row * cell, cell * (column + 1), (row + 1) * cell))
        box = frame.getbbox()
        if box is None:
            continue
        area = (box[2] - box[0]) * (box[3] - box[1])
        if area > best_area:
            best, best_area = frame.crop(box), area
    if best is None:
        return Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    frame = best
    scale = min(28 / frame.width, 28 / frame.height)
    return frame.resize((max(1, int(frame.width * scale)), max(1, int(frame.height * scale))), Image.LANCZOS)


def build_icons() -> None:
    _, image_util, convertor = load_img_tools()
    icons = open_img(fetch("skillicon.img", SOURCES["skillicon.img"]))
    sheet = Image.new("RGBA", (32 * len(SKILL_IDS), 32), (0, 0, 0, 0))

    for slot, skill_id in enumerate(SKILL_IDS):
        icon = skill_icon(skill_id, icons, image_util, convertor)
        backdrop = Image.new("RGBA", (32, 32), (18, 22, 36, 255))
        draw = ImageDraw.Draw(backdrop)
        draw.rounded_rectangle([0, 0, 31, 31], radius=6, outline=(226, 191, 114, 255), width=1)
        backdrop.alpha_composite(icon, ((32 - icon.width) // 2, (32 - icon.height) // 2))
        sheet.alpha_composite(backdrop, (slot * 32, 0))

    sheet.save(ROOT / "skills.png")
    print(f"wrote {ROOT / 'skills.png'} ({sheet.width}x{sheet.height})")


def build_favicon() -> None:
    sheet = Image.open(ROOT / "slayer.png")
    head = sheet.crop((28, 16, 72, 60)).resize((32, 32), Image.LANCZOS)
    canvas = Image.new("RGBA", (32, 32), (18, 22, 36, 255))
    canvas.alpha_composite(head)
    canvas.save(ROOT / "favicon.png")
    print(f"wrote {ROOT / 'favicon.png'} (32x32)")


def main() -> None:
    if "--atlas" in sys.argv:
        build_atlas()
        return
    if "--icons" in sys.argv:
        picks = sys.argv[sys.argv.index("--icons") + 1]
        values = [int(value) for value in picks.replace(" ", "").split(",") if value != ""]
        if len(values) != len(ICON_FRAME_ORDER):
            print(
                "--icons needs {0} frame indices ({1})".format(
                    len(ICON_FRAME_ORDER), ", ".join(ICON_FRAME_ORDER)
                ),
                file=sys.stderr,
            )
            raise SystemExit(2)
        ICON_FRAMES.update(dict(zip(ICON_FRAME_ORDER, values)))
    build_sheet()
    build_icons()
    build_favicon()


def build_atlas() -> None:
    """Write labelled contact sheets of both icon atlases so a human can pick."""
    for name, out_name in (("skillicon.img", "dnf_skillicon_atlas.png"), ("atskillicon.img", "dnf_atskillicon_atlas.png")):
        build_atlas_for(name, out_name)


def build_atlas_for(source_name: str, out_name: str) -> None:
    _, image_util, convertor = load_img_tools()
    icons = open_img(fetch(source_name, SOURCES[source_name]))
    cols, cell = 16, 52
    rows = (len(icons.images) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (18, 22, 34, 255))
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(icons.images):
        if type(item).__name__ == "ImageLink":
            continue
        raw = item.data
        try:
            raw = convertor.to_raw(raw, item.format)
        except Exception:
            pass
        icon = image_util.load_raw(raw, item.w, item.h).convert("RGBA")
        x = (index % cols) * cell
        y = (index // cols) * cell
        sheet.alpha_composite(icon.resize((cell - 18, cell - 18), Image.LANCZOS), (x + 9, y + 15))
        draw.text((x + 4, y + 3), str(index), fill=(255, 215, 120, 255))
    sheet.save(ROOT / out_name)
    print(f"wrote {ROOT / out_name} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
