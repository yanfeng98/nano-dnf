#!/usr/bin/env python3
"""Render the Berserker (红眼) skill-effect inventory as a numbered pick sheet.

    pip install pydnfex pillow
    python3 assets/make_berserker_effect_menu.py [--client /mnt/c/dnf/地下城与勇士]

The kit's effects live in the client's `sprite_character_swordman_effect_at*`
packs, one pack per move. This walks those packs, samples four frames of every
entry that actually draws something, and writes two working references:

  assets/dnf_effect_berserker_candidates.png - numbered contact sheet, grouped by
      the move the pack belongs to, four evenly spaced frames per candidate
  assets/dnf_effect_berserker_candidates.txt - number -> pack/entry manifest
  assets/dnf_effect_berserker_candidates.gif - the brightest candidate of every
      group, animated side by side, because a still cannot show how a hit reads

The owner reads a number off the sheet and it goes into the EFFECTS table of
assets/import_dnf_effects.py. Both outputs are gitignored: they contain DNF
artwork, which belongs to Neople/Nexon.
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK_PREFIX = "sprite_character_swordman_effect"

# One group per move the Berserker kit actually learns, in the order the hotbar
# teaches them; the pack names are the client's own move names.
GROUPS = [
    ("崩山击 mountain-breaker", ["_chargecrash", "_chagecrashex", "_atmountaincrash"]),
    ("十字斩 gore-cross", ["_gorecross", "_atgorecross"]),
    ("血气之刃 blood-sword", ["_bloodsword", "_atgreed"]),
    ("暴走 frenzy", ["_frenzy"]),
    ("抓头 / 噬魂之手 grab-head", ["_grabblastblood", "_grabblastbloodex"]),
    ("怒气爆发 rage-burst", ["_rage", "_outragebreak"]),
    ("血气爆发 bloody-rave", ["_bloodyrave", "_blastblood", "_blastbloodex", "_bloodboom"]),
    ("血之狂暴血魔 blood-evil", ["_bloodevil"]),
    ("狱血魔神 hell-benter", ["_hellbenter"]),
    ("血之挽歌 blood-riven", ["_bloodriven", "_atblooddance", "_bloodmarble"]),
    ("致命血殒 fatal-blood", ["_fatalblood", "_atbloodseal"]),
    ("献祭 give-blood", ["_giveblood", "_atimmolation"]),
    ("崩山裂地斩 hellfire", ["_athellfire", "_slashofhell", "_slashofboom"]),
    ("非血系同期特效 (剑/雷系, 供对照)", ["_atblastsword", "_atmadness"]),
]

# The client keeps its Chinese glyphs in these; the default PIL bitmap font has
# none, so the sheet would print boxes without one of them.
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
)

# A pack can ship dozens of layers; the ones that draw almost nothing are the
# near-invisible tails of an animation, so they are left out of the sheet (they
# stay in the manifest).
MIN_DENSE = 2000
MAX_PER_PACK = 3
FRAMES = 4
CELL = 96
LABEL_W = 260

# What the hotbar already uses (assets/import_dnf_effects.py EFFECTS), so the
# owner can see at a glance which rows are the current pick and which are new.
CURRENT = {
    "normalwave1": "normalwave1.img",
    "gorecross": "gorecross_cross.img",
    "bloodsword": "sword_normal.img",
    "frenzy": "sword_blood_upper.img",
    "bloodyrave": "lslash-normal.img",
    "bloodsnatch": "bloodwave.img",
    "bloodevil": "bloodevil_stand_dungeon_effect.img",
}


def load_pack(client: pathlib.Path, suffix: str):
    """Every entry of one client effect pack, as (name, image)."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    path = client / "ImagePacks2" / f"{PACK_PREFIX}{suffix}.NPK"
    if not path.exists():
        return None
    with open(path, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            try:
                image = IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue
            yield name, image


def sampled_frames(img, count: int = FRAMES):
    """Evenly spaced frames, so a four-cell row shows the whole animation."""
    total = len(img.images)
    if total <= count:
        indices = list(range(total))
    else:
        step = (total - 1) / (count - 1)
        indices = sorted({round(index * step) for index in range(count)})
    frames = []
    for index in indices:
        try:
            frames.append(img.build(img.images[index]).convert("RGBA"))
        except Exception:
            continue
    return frames


def density(frame: Image.Image) -> int:
    alpha = frame.getchannel("A")
    return sum(1 for value in alpha.getdata() if value > 24)


def load_font(size: int):
    """A CJK-capable font, or PIL's bitmap default when the host has none."""
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def canonical(name: str) -> str:
    """Drop the client's (18)/(tn) re-release prefixes so twins collapse."""
    for prefix in ("(18)", "(tn)"):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def candidates(client: pathlib.Path):
    """(group, pack, entry, frames, dense) for every entry worth showing."""
    rows = []
    for label, packs in GROUPS:
        for suffix in packs:
            entries = list(load_pack(client, suffix) or [])
            if not entries:
                print(f"  missing pack: {suffix}", file=sys.stderr)
                continue
            best_by_key = {}
            for name, img in entries:
                frames = sampled_frames(img)
                if not frames:
                    continue
                dense = max(density(frame) for frame in frames)
                # The (18)/(tn) re-releases are near-twins of the plain entry,
                # and EFFECTS references the plain one, so it wins the tie.
                prefixed = 1 if name != canonical(name) else 0
                key = (canonical(name), len(frames))
                current = best_by_key.get(key)
                better = current is None or (prefixed, -dense, name) < (
                    current[1],
                    -current[0],
                    current[2],
                )
                if better:
                    best_by_key[key] = (dense, prefixed, name, frames, len(img.images))
            ranked = sorted(best_by_key.values(), key=lambda row: (-row[0], row[1], row[2]))
            # The sheet shows the brightest entries; the rest stay in the manifest.
            kept = set()
            for dense, _prefixed, name, _frames, _total in ranked:
                if dense < MIN_DENSE or len(kept) >= MAX_PER_PACK:
                    break
                kept.add(name)
            pack = suffix.lstrip("_")
            for dense, _prefixed, name, frames, total in ranked:
                if name in kept:
                    rows.append((label, pack, name, frames, dense, total))
                else:
                    rows.append((label, pack, name, frames, dense, total, "manifest-only"))
    return rows


def build_sheet(rows, out: pathlib.Path) -> None:
    shown = [row for row in rows if len(row) == 6]
    headers = {row[0] for row in shown}
    height = CELL * (len(shown) + len(headers))
    sheet = Image.new("RGBA", (LABEL_W + FRAMES * CELL, height), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    label_font = load_font(15)
    head_font = load_font(17)
    y = 0
    number = 0
    for label, packs in GROUPS:
        if label not in headers:
            continue
        draw.rectangle([0, y, sheet.width, y + CELL - 1], fill=(34, 20, 30, 255))
        draw.text((8, y + CELL // 2 - 10), label, fill=(255, 235, 150, 255), font=head_font)
        y += CELL
        for row in shown:
            if row[0] != label:
                continue
            _, pack, name, frames, dense, total = row
            in_use = CURRENT.get(pack) == name
            draw.text(
                (8, y + 12),
                f"{number} {pack}/{name}",
                fill=(150, 255, 170, 255) if in_use else (255, 215, 120, 255),
                font=label_font,
            )
            note = "◀ 当前使用 / in use" if in_use else f"{total} frames, densest {dense}"
            draw.text(
                (8, y + 34),
                note,
                fill=(150, 255, 170, 255) if in_use else (150, 168, 200, 255),
                font=label_font,
            )
            for column, frame in enumerate(frames):
                scale = min((CELL - 8) / frame.width, (CELL - 8) / frame.height, 1.0)
                size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
                sheet.alpha_composite(
                    frame.resize(size, Image.LANCZOS),
                    (
                        LABEL_W + column * CELL + (CELL - size[0]) // 2,
                        y + (CELL - size[1]) // 2,
                    ),
                )
            number += 1
            y += CELL
    sheet.save(out)
    print(f"wrote {out} ({sheet.width}x{sheet.height}, {number} candidates)")


def build_manifest(rows, out: pathlib.Path) -> None:
    lines = []
    number = 0
    for label, packs in GROUPS:
        lines.append(f"## {label}")
        for row in rows:
            if row[0] != label:
                continue
            shown = len(row) == 6
            _, pack, name, frames, dense, total = row[:6]
            mark = f"{number}" if shown else "  -"
            flag = "  <- 当前使用" if CURRENT.get(pack) == name else ""
            lines.append(f"{mark:>4}  {pack}/{name}  frames={total} densest={dense}{flag}")
            if shown:
                number += 1
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out} ({len(lines)} lines)")


def animation_frames(img, cap: int = 48):
    """Consecutive frames of one entry, thinned to at most `cap` steps."""
    total = len(img.images)
    step = max(1, -(-total // cap))
    frames = []
    for index in range(0, total, step):
        try:
            frames.append(img.build(img.images[index]).convert("RGBA"))
        except Exception:
            continue
    return frames


def build_motion(rows, client: pathlib.Path, out: pathlib.Path) -> None:
    """One animated cell per family: a still cannot show how a hit reads."""
    picks = []
    for label, _packs in GROUPS:
        first = next((row for row in rows if row[0] == label and len(row) == 6), None)
        if first is not None:
            picks.append(first)
    columns = 4
    rows_count = -(-len(picks) // columns)
    sheet_frames = []
    longest = 0
    for index, (label, pack, name, _frames, _dense, _total) in enumerate(picks):
        entries = dict(load_pack(client, f"_{pack}") or [])
        img = entries.get(name)
        frames = animation_frames(img) if img is not None else []
        longest = max(longest, len(frames))
        sheet_frames.append((index, label, frames))
    if longest == 0:
        return

    canvas = Image.new("RGBA", (columns * CELL, rows_count * CELL), (16, 18, 28, 255))
    cell_font = load_font(13)
    out_frames = []
    for step in range(longest):
        frame = canvas.copy()
        draw = ImageDraw.Draw(frame)
        for index, label, frames in sheet_frames:
            if not frames:
                continue
            picture = frames[step % len(frames)]
            scale = min((CELL - 8) / picture.width, (CELL - 8) / picture.height, 1.0)
            size = (max(1, int(picture.width * scale)), max(1, int(picture.height * scale)))
            column, row = index % columns, index // columns
            frame.alpha_composite(
                picture.resize(size, Image.LANCZOS),
                (
                    column * CELL + (CELL - size[0]) // 2,
                    row * CELL + (CELL - size[1]) // 2,
                ),
            )
            draw.text(
                (column * CELL + 4, row * CELL + 2),
                label.split(" ")[0],
                fill=(255, 235, 160, 255),
                font=cell_font,
            )
        out_frames.append(frame.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=128))

    out_frames[0].save(
        out,
        save_all=True,
        append_images=out_frames[1:],
        duration=70,
        loop=0,
        optimize=True,
    )
    print(f"wrote {out} ({len(out_frames)} frames, {canvas.width}x{canvas.height})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()
    if not (args.client / "ImagePacks2").exists():
        raise SystemExit(f"no ImagePacks2 under {args.client}")

    rows = candidates(args.client)
    build_sheet(rows, ROOT / "dnf_effect_berserker_candidates.png")
    build_motion(rows, args.client, ROOT / "dnf_effect_berserker_candidates.gif")
    build_manifest(rows, ROOT / "dnf_effect_berserker_candidates.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
