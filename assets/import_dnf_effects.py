#!/usr/bin/env python3
"""Bake the official DNF skill effects used by the Slayer hotbar.

Each skill pulls the effect the game itself uses for that move, out of the
local client when one is installed (C:\\dnf through WSL by default) and out of
the GitHub mirror otherwise:

  上挑        effect/upperslash.img
  崩山击      effect/normalwave1.img
  十字斩      effect/gorecross/gorecross_cross.img
  血气之刃    effect/bloodsword/sword_normal.img
  暴走        effect/frenzy/sword_blood_upper.img
  血气爆发    effect/bloodyrave/lslash-normal.img
  怒气爆发    effect/blast-back.img
  嗜血        effect/bloodsnatch/bloodwave.img
  抓头        effect/pinchhpregen.img
  血魔        effect/bloodevil/bloodevil_stand_dungeon_effect.img
  崩山裂地斩  effect/fire-front.img

The hotbar is the Berserker kit: every move above is one the red-eyed Slayer
actually learns, rather than the mixed 鬼泣/剑魂 skills it used to carry.

Two things make the baked rows read like the real move instead of a stray
spark: the four frames are taken from the densest window of the animation
(DNF effects start and end nearly invisible, so sampling the first and last
frame wastes half the row) and each row is cropped to the pixels that are
actually drawn before it is scaled into its cell.

    pip install pydnfex pillow
    python3 assets/import_dnf_effects.py [--client /mnt/c/dnf/地下城与勇士]

Writes assets/effects.png: one row per SKILL_ORDER entry of 128x128 frames. A
row is four frames by default; the moves in PICKS (the owner's per-pack picks,
see assets/dnf_effect_picks.md) ship every frame their effect has, and the sheet
is as wide as its longest row. As with the sprite sheet, DNF artwork belongs to
Neople/Nexon.
"""

from __future__ import annotations

import argparse
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dnf_src"
CDN = "https://cdn.jsdelivr.net/gh"
DEFAULT_CLIENT = Path("/mnt/c/dnf/地下城与勇士")

SLASH = f"{CDN}/LoveOyy/sprite_character_swordman_effect.NPK@master"
GORE = f"{CDN}/LoveOyy/sprite_character_swordman_effect_atgorecross.NPK@master"
STEP = f"{CDN}/LoveOyy/sprite_character_swordman_effect_ghoststep.NPK@master"

# One row per skill, in SKILL_ORDER: (skill, client NPK, entry, mirror url).
# The comment on each line is the move the effect belongs to.
EFFECTS = [
    ("upSlash", "sprite_character_swordman_effect.NPK", "upperslash.img", f"{SLASH}/upperslash.img.js"),
    ("mountainBreaker", "sprite_character_swordman_effect.NPK", "normalwave1.img", f"{SLASH}/normalwave1.img.js"),
    ("crossSlash", "sprite_character_swordman_effect_gorecross.NPK", "gorecross_cross.img", f"{GORE}/cross.img.js"),
    ("bloodSword", "sprite_character_swordman_effect_bloodsword.NPK", "sword_normal.img", f"{SLASH}/atghost.img.js"),
    ("frenzy", "sprite_character_swordman_effect_frenzy.NPK", "sword_blood_upper.img", f"{SLASH}/momentaryslashblade.img.js"),
    ("bloodyRave", "sprite_character_swordman_effect_bloodyrave.NPK", "lslash-normal.img", f"{SLASH}/grandwaveblade.img.js"),
    ("rageBurst", "sprite_character_swordman_effect.NPK", "blast-back.img", f"{SLASH}/blast-back.img.js"),
    ("bloodSnatch", "sprite_character_swordman_effect_bloodsnatch.NPK", "bloodwave.img", f"{SLASH}/fullmoon.img.js"),
    ("graspHead", "sprite_character_swordman_effect.NPK", "pinchhpregen.img", f"{SLASH}/pinchhpregen.img.js"),
    ("bloodEvil", "sprite_character_swordman_effect_bloodevil.NPK", "bloodevil_stand_dungeon_effect.img", f"{STEP}/01_sword_dodge.img.js"),
    ("mountainRift", "sprite_character_swordman_effect.NPK", "fire-front.img", f"{SLASH}/fire-front.img.js")
]

FRAMES = 4
CELL = 128
PADDING = 6

# Moves the owner picked pack by pack (see assets/dnf_effect_picks.md) ship the
# move's real frames instead of a four-frame sample. A row is built from one or
# more client entries:
#   "stack"    - the layers play together (a whole pack, or the two layers of one
#                buff), which is what the owner watched and recognised
#   "sequence" - the layers play one after another (a sword that is then spent)
# "*" means every entry of that pack, in file order, as the game draws them.
PICKS = {
    "upSlash": {"stack": [("", "upperslash.img")]},
    "mountainBreaker": {"stack": [("_hopsmash", "b_bottom_01_d.img")]},
    "crossSlash": {"stack": [("_gorecross", "gorecross_cross.img")]},
    # 血气之刃: the blood sword is thrust, then it bursts.
    "bloodSword": {"sequence": [("_bloodsword", "sword_normal.img"), ("_bloodsword", "exp_dodge.img")]},
    # 血之狂暴: the dual-blade glow plus the orbs drained out of a monster.
    "frenzy": {"stack": [("_frenzy", "blood-energy.img"), ("_frenzy", "blood-stone-0.img")]},
    "bloodyRave": {"stack": [("_bloodyrave", "*")]},
    "rageBurst": {"stack": [("_blastblood", "*")]},
    "bloodSnatch": {"stack": [("_bloodsnatch", "*")]},
    "graspHead": {"stack": [("_grabblastblood", "*")]},
    "bloodEvil": {"stack": [("_bloodriven", "*")]},
    "mountainRift": {"stack": [("_outragebreak", "*")]},
}


def key_black_background(image: Image.Image, low: int = 26, soft: int = 48) -> Image.Image:
    """Drop the opaque black backdrop some effect exports carry.

    A few DNF effect IMG files store their frames without alpha (the game uses
    additive blending / a colour board that is not part of this export), so the
    pixels arrive as RGB on solid black. Keying the black out keeps the bright
    slash/blast art and gives it a clean alpha ramp.

    The backdrop is detected rather than assumed: some exports carry a black
    background *and* a few transparent pixels, which an alpha-extrema test walks
    straight past, leaving a black box around the move.
    """
    pixels = image.load()
    total = image.width * image.height
    dark = 0
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 0 and max(red, green, blue) <= low:
                dark += 1
    if total == 0 or dark < total * 0.15:
        return image
    out = image.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            red, green, blue, alpha = pixels[x, y]
            luma = max(red, green, blue)
            if luma <= low:
                pixels[x, y] = (0, 0, 0, 0)
            elif luma < soft:
                pixels[x, y] = (red, green, blue, int(alpha * (luma - low) / (soft - low)))
    return out


def fetch(name: str, url: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    target = SRC / name
    if target.exists() and target.stat().st_size > 1024:
        return target
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=180) as response:
        target.write_bytes(response.read())
    return target


def load_img(path: Path):
    try:
        from pydnfex.img.version import IMGFactory
    except ImportError:
        print("missing dependency: pip install pydnfex pillow", file=sys.stderr)
        raise SystemExit(2)
    with open(path, "rb") as handle:
        return IMGFactory.open(io.BytesIO(handle.read()))


def from_client(client: Path, npk_name: str, entry: str, cache_name: str):
    """Pull one .img straight out of an installed client, caching it locally."""
    cached = SRC / cache_name
    if cached.exists():
        return cached
    pack = client / "ImagePacks2" / npk_name
    if not pack.exists():
        return None
    try:
        from pydnfex.npk import NPK
    except ImportError:
        return None
    handle = open(pack, "rb")
    try:
        npk = NPK.open(handle)
        for item in npk.files:
            if item.name.rsplit("/", 1)[-1] == entry:
                SRC.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(item.data)
                return cached
    finally:
        handle.close()
    return None


def drawn_area(frame: Image.Image) -> int:
    box = frame.getbbox()
    return 0 if box is None else (box[2] - box[0]) * (box[3] - box[1])


def active_window(frames: list[Image.Image], count: int) -> list[int]:
    """Indices of the densest run of frames: where the effect is really visible."""
    if len(frames) <= count:
        return list(range(len(frames)))
    areas = [drawn_area(frame) for frame in frames]
    best, best_score = 0, None
    for start in range(len(frames) - count + 1):
        score = sum(areas[start:start + count])
        if best_score is None or score > best_score:
            best, best_score = start, score
    return list(range(best, best + count))


def densest_run(frames: list[Image.Image], visible: list[int], count: int) -> list[int]:
    """The densest `count` frames that all have something to draw."""
    areas = {index: drawn_area(frames[index]) for index in visible}
    best, best_score = visible[:count], None
    for start in range(len(visible) - count + 1):
        run = visible[start:start + count]
        score = sum(areas[index] for index in run)
        if best_score is None or score > best_score:
            best, best_score = run, score
    return best


def bake_frames(frames, row: int, sheet: Image.Image) -> int:
    """Draw one skill row from already-composited frames."""
    while frames and not frames[0].getbbox():
        frames.pop(0)
    while frames and not frames[-1].getbbox():
        frames.pop()
    if not frames:
        print(f"  row {row}: nothing drawn, skipping")
        return 0

    union = None
    for frame in frames:
        box = frame.getbbox()
        if box is None:
            continue
        union = box if union is None else (
            min(union[0], box[0]),
            min(union[1], box[1]),
            max(union[2], box[2]),
            max(union[3], box[3]),
        )
    window = (
        union[0] - PADDING,
        union[1] - PADDING,
        union[2] + PADDING,
        union[3] + PADDING,
    )
    span_w = window[2] - window[0]
    span_h = window[3] - window[1]
    scale = min((CELL - 8) / span_w, (CELL - 8) / span_h)
    placed_w = max(1, int(span_w * scale))
    placed_h = max(1, int(span_h * scale))
    offset_x = (CELL - placed_w) // 2
    offset_y = (CELL - placed_h) // 2

    for column, frame in enumerate(frames):
        layer = Image.new("RGBA", (span_w, span_h), (0, 0, 0, 0))
        layer.alpha_composite(frame, (-window[0], -window[1]))
        layer = layer.resize((placed_w, placed_h), Image.LANCZOS)
        sheet.alpha_composite(layer, (column * CELL + offset_x, row * CELL + offset_y))

    return len(frames)


def decode_frames(img):
    """[(picture, x, y)] for one img, with the black backdrop keyed out."""
    out = []
    for index, image in enumerate(img.images):
        try:
            picture = key_black_background(img.build(image).convert("RGBA"))
        except Exception:
            continue
        out.append((picture, getattr(image, "x", 0), getattr(image, "y", 0)))
    return out


def pack_entries(client: Path, pack: str):
    """[(name, img)] for every entry of one effect pack ('' = the base pack)."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    path = client / "ImagePacks2" / f"sprite_character_swordman_effect{pack}.NPK"
    if not path.exists():
        return
    with open(path, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            try:
                yield name, IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue


def pick_frames(client: Path, mode: str, entries) -> list:
    """Composite/concatenate the client entries a row is made of."""
    layers = []
    for pack, entry in entries:
        if entry == "*":
            for _name, img in pack_entries(client, pack):
                decoded = decode_frames(img)
                if decoded:
                    layers.append(decoded)
            continue
        found = dict(pack_entries(client, pack)).get(entry)
        if found is None:
            print(f"  missing {pack}/{entry}", file=sys.stderr)
            continue
        decoded = decode_frames(found)
        if decoded:
            layers.append(decoded)
    if not layers:
        return []
    if mode == "sequence":
        frames = []
        for layer in layers:
            frames.extend(picture for picture, _x, _y in layer)
        return frames
    length = max(len(layer) for layer in layers)
    frames = []
    for index in range(length):
        parts = [layer[min(index, len(layer) - 1)] for layer in layers]
        left = min(x for _p, x, _y in parts)
        top = min(y for _p, _x, y in parts)
        right = max(x + p.width for p, x, _y in parts)
        bottom = max(y + p.height for p, _x, y in parts)
        canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
        for picture, x, y in parts:
            canvas.alpha_composite(picture, (x - left, y - top))
        frames.append(canvas)
    return frames


def sampled_row(frames, count: int = FRAMES) -> list:
    """Four evenly spaced frames of an ordinary effect, skipping blank ones."""
    visible = [frame for frame in frames if frame.getbbox()]
    if len(visible) <= count:
        return visible
    step = (len(visible) - 1) / (count - 1)
    return [visible[round(index * step)] for index in range(count)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=DEFAULT_CLIENT,
                        help="installed DNF client (ImagePacks2 lives inside it)")
    args = parser.parse_args()

    # Build every row first: the picked moves are composited from their client
    # entries, the rest keep the four-frame sample. Rows can differ in length, so
    # the sheet ends up as wide as its longest one.
    rows = {}
    for row, (skill, npk_name, entry, url) in enumerate(EFFECTS):
        print(f"{skill}:")
        if skill in PICKS:
            entries = list(PICKS[skill].get("stack") or PICKS[skill].get("sequence") or [])
            mode = "sequence" if PICKS[skill].get("sequence") else "stack"
            frames = pick_frames(args.client, mode, entries)
            print(f"  picked {mode} of {len(entries)} entrie(s): {len(frames)} frames")
        else:
            path = source(args, npk_name, entry, url, f"effect_{entry}")
            frames = sampled_row(decode_frames(load_img(path)))
        rows[skill] = frames

    columns = max(FRAMES, max(len(frames) for frames in rows.values()))
    sheet = Image.new("RGBA", (CELL * columns, CELL * len(EFFECTS)), (0, 0, 0, 0))
    counts = {}
    for row, (skill, _npk, _entry, _url) in enumerate(EFFECTS):
        counts[skill] = bake_frames(rows[skill], row, sheet)
    sheet.save(ROOT / "effects.png")
    print(f"wrote {ROOT / 'effects.png'} ({sheet.width}x{sheet.height})")
    print("row frames: " + ", ".join(f"{skill}={count}" for skill, count in counts.items()))


def source(args, npk_name: str, entry: str, url: str, cache_name: str) -> Path:
    """Read one entry out of the installed client, falling back to the mirror."""
    path = None
    if args.client.exists():
        path = from_client(args.client, npk_name, entry, cache_name)
    if path is None:
        path = fetch(cache_name, url)
    return path


if __name__ == "__main__":
    main()
