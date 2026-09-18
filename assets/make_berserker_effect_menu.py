#!/usr/bin/env python3
"""Render the Berserker (红眼) skill-effect inventory as pick sheets.

    pip install pydnfex pillow
    python3 assets/make_berserker_effect_menu.py [--client /mnt/c/dnf/地下城与勇士]

The kit's effects live in the client's `sprite_character_swordman_effect_at*`
packs, one pack per move. This walks those packs and writes working references
to review the art by eye:

  assets/dnf_effect_berserker_candidates.png - numbered overview: every family,
      four evenly spaced frames of its brightest entries
  assets/dnf_effect_berserker_<family>.png - one filmstrip sheet per family:
      every entry, every frame it ships, in order
  assets/dnf_effect_berserker_candidates.gif - the brightest entry of every
      family animated side by side, because a still cannot show how a hit reads
  assets/dnf_effect_berserker_candidates.txt - number -> pack/entry manifest

Numbers are stable: they are assigned once, in family order, and the same number
appears on the overview and on the family filmstrip. The owner reads a number and
it goes into the EFFECTS table of assets/import_dnf_effects.py.

All outputs are gitignored: they contain DNF artwork, which belongs to
Neople/Nexon.
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

# One family per move the Berserker kit actually learns, in the order the hotbar
# teaches them; the pack names are the client's own move names.
GROUPS = [
    ("崩山击 mountain-breaker", "mountain-breaker", ["_chargecrash", "_chagecrashex", "_atmountaincrash"]),
    ("十字斩 gore-cross", "gore-cross", ["_gorecross", "_atgorecross"]),
    ("血气之刃 blood-sword", "blood-sword", ["_bloodsword", "_atgreed"]),
    ("暴走 frenzy", "frenzy", ["_frenzy"]),
    ("抓头 / 噬魂之手 grab-head", "grab-head", ["_grabblastblood", "_grabblastbloodex"]),
    ("怒气爆发 rage-burst", "rage-burst", ["_rage", "_outragebreak"]),
    ("血气爆发 bloody-rave", "bloody-rave", ["_bloodyrave", "_blastblood", "_blastbloodex", "_bloodboom"]),
    ("血之狂暴血魔 blood-evil", "blood-evil", ["_bloodevil"]),
    ("狱血魔神 hell-benter", "hell-benter", ["_hellbenter"]),
    ("血之挽歌 blood-riven", "blood-riven", ["_bloodriven", "_atblooddance", "_bloodmarble"]),
    ("致命血殒 fatal-blood", "fatal-blood", ["_fatalblood", "_atbloodseal"]),
    ("献祭 give-blood", "give-blood", ["_giveblood", "_atimmolation"]),
    ("崩山裂地斩 hellfire", "hellfire", ["_athellfire", "_slashofhell", "_slashofboom"]),
    ("非血系同期特效 (剑/雷系, 供对照)", "other-weapon", ["_atblastsword", "_atmadness"]),
]

# The client keeps its Chinese glyphs in these; the default PIL bitmap font has
# none, so the sheets would print boxes without one of them.
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
)

# What the hotbar already uses (assets/import_dnf_effects.py EFFECTS), so the
# owner can see which rows are the current pick and which are new.
CURRENT = {
    "normalwave1": "normalwave1.img",
    "gorecross": "gorecross_cross.img",
    "bloodsword": "sword_normal.img",
    "frenzy": "sword_blood_upper.img",
    "bloodyrave": "lslash-normal.img",
    "bloodsnatch": "bloodwave.img",
    "bloodevil": "bloodevil_stand_dungeon_effect.img",
}

# Everything that draws anything gets a filmstrip row; only the overview is cut
# down, so the long tail stays reviewable.
MIN_DENSE = 200
OVERVIEW_ROWS = 4
OVERVIEW_CELL = 96
STRIP_CELL = 64
LABEL_W = 260


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


def load_pack(client: pathlib.Path, suffix: str):
    """Every entry of one client effect pack, as (name, image)."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    path = client / "ImagePacks2" / f"{PACK_PREFIX}{suffix}.NPK"
    if not path.exists():
        return
    with open(path, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            try:
                image = IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue
            yield name, image


def frames_of(img, indices=None):
    """The requested frames of one DNF entry (all of them by default)."""
    total = len(img.images)
    if indices is None:
        indices = range(total)
    out = []
    for index in indices:
        if index >= total:
            continue
        try:
            out.append(img.build(img.images[index]).convert("RGBA"))
        except Exception:
            continue
    return out


def sample_indices(total: int, count: int):
    if total <= count:
        return list(range(total))
    step = (total - 1) / (count - 1)
    return sorted({round(index * step) for index in range(count)})


def density(frame: Image.Image) -> int:
    alpha = frame.getchannel("A")
    return sum(1 for value in alpha.getdata() if value > 24)


def pack_rows(client: pathlib.Path, suffix: str):
    """Ranked entries of one pack, deduped, as dicts (no frames kept)."""
    ranked = {}
    for name, img in load_pack(client, suffix) or []:
        frames = frames_of(img, sample_indices(len(img.images), 4))
        if not frames:
            continue
        dense = max(density(frame) for frame in frames)
        # The (18)/(tn) re-releases are near-twins of the plain entry, and
        # EFFECTS references the plain one, so it wins the tie.
        prefixed = 1 if name != canonical(name) else 0
        key = (canonical(name), len(img.images))
        current = ranked.get(key)
        if current is None or (prefixed, -dense, name) < (
            current["prefixed"],
            -current["dense"],
            current["name"],
        ):
            ranked[key] = {
                "pack": suffix.lstrip("_"),
                "name": name,
                "total": len(img.images),
                "dense": dense,
                "prefixed": prefixed,
            }
    rows = [row for row in ranked.values() if row["dense"] >= MIN_DENSE]
    rows.sort(key=lambda row: (-row["dense"], row["prefixed"], row["name"]))
    return rows


def collect(client: pathlib.Path):
    """Number every candidate once: family order, brightest first."""
    families = []
    number = 0
    for label, slug, packs in GROUPS:
        rows = []
        for suffix in packs:
            found = pack_rows(client, suffix)
            if not found:
                print(f"  no entries in {suffix}", file=sys.stderr)
            rows.extend(found)
        rows.sort(key=lambda row: (-row["dense"], row["prefixed"], row["pack"], row["name"]))
        for row in rows:
            row["number"] = number
            number += 1
        families.append({"label": label, "slug": slug, "rows": rows})
    return families


def draw_row(sheet: Image.Image, draw, y: int, font, row, frames, cell: int) -> None:
    in_use = CURRENT.get(row["pack"]) == row["name"]
    draw.text(
        (8, y + 6),
        f"{row['number']} {row['pack']}/{row['name']}",
        fill=(150, 255, 170, 255) if in_use else (255, 215, 120, 255),
        font=font,
    )
    note = "当前使用 / in use" if in_use else f"{row['total']} frames · densest {row['dense']}"
    draw.text(
        (8, y + 24),
        note,
        fill=(150, 255, 170, 255) if in_use else (150, 168, 200, 255),
        font=font,
    )
    for column, frame in enumerate(frames):
        scale = min((cell - 6) / frame.width, (cell - 6) / frame.height, 1.0)
        size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
        sheet.alpha_composite(
            frame.resize(size, Image.LANCZOS),
            (
                LABEL_W + column * cell + (cell - size[0]) // 2,
                y + (cell - size[1]) // 2,
            ),
        )


def build_overview(families, client: pathlib.Path, out: pathlib.Path) -> None:
    """Every family, four frames of its brightest rows."""
    picks = []
    for family in families:
        rows = family["rows"]
        chosen = rows[:OVERVIEW_ROWS]
        for row in rows:
            if CURRENT.get(row["pack"]) == row["name"] and row not in chosen:
                chosen.append(row)
        for row in chosen:
            picks.append((family["label"], row))

    height = 0
    headers = []
    for family in families:
        family_picks = [row for label, row in picks if label == family["label"]]
        if not family_picks:
            continue
        headers.append((family["label"], height))
        height += OVERVIEW_CELL * (1 + len(family_picks))

    sheet = Image.new("RGBA", (LABEL_W + 4 * OVERVIEW_CELL, height), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    label_font = load_font(15)
    head_font = load_font(17)

    for label, top in headers:
        draw.rectangle([0, top, sheet.width, top + OVERVIEW_CELL - 1], fill=(34, 20, 30, 255))
        draw.text((8, top + OVERVIEW_CELL // 2 - 10), label, fill=(255, 235, 150, 255), font=head_font)
        y = top + OVERVIEW_CELL
        for picked_label, row in picks:
            if picked_label != label:
                continue
            img = entry_image(client, row)
            frames = frames_of(img, sample_indices(len(img.images), 4)) if img else []
            draw_row(sheet, draw, y, label_font, row, frames, OVERVIEW_CELL)
            y += OVERVIEW_CELL
    sheet.save(out)
    print(f"wrote {out} ({sheet.width}x{sheet.height}, {len(picks)} rows)")


def entry_image(client: pathlib.Path, row):
    for name, img in load_pack(client, f"_{row['pack']}") or []:
        if name == row["name"]:
            return img
    return None


def build_family_sheets(families, client: pathlib.Path) -> None:
    """One filmstrip sheet per family: every entry, every frame."""
    label_font = load_font(14)
    head_font = load_font(19)
    for family in families:
        rows = family["rows"]
        if not rows:
            continue
        widths = [len(range(row["total"])) * STRIP_CELL for row in rows]
        width = LABEL_W + max(widths) + 8
        height = 64 + STRIP_CELL * len(rows)
        sheet = Image.new("RGBA", (width, height), (20, 24, 38, 255))
        draw = ImageDraw.Draw(sheet)
        draw.rectangle([0, 0, width, 63], fill=(34, 20, 30, 255))
        draw.text(
            (8, 8),
            f"{family['label']} — {len(rows)} 条候选，每行是该特效的全部帧",
            fill=(255, 235, 150, 255),
            font=head_font,
        )
        y = 64
        for row in rows:
            img = entry_image(client, row)
            frames = frames_of(img) if img else []
            draw_row(sheet, draw, y, label_font, row, frames, STRIP_CELL)
            y += STRIP_CELL
        path = ROOT / f"dnf_effect_berserker_{family['slug']}.png"
        sheet.save(path)
        print(f"wrote {path.name} ({sheet.width}x{sheet.height}, {len(rows)} rows)")


def build_manifest(families, out: pathlib.Path) -> None:
    lines = []
    for family in families:
        lines.append(f"## {family['label']}")
        for row in family["rows"]:
            flag = "  <- 当前使用" if CURRENT.get(row["pack"]) == row["name"] else ""
            lines.append(
                f"{row['number']:>4}  {row['pack']}/{row['name']}"
                f"  frames={row['total']} densest={row['dense']}{flag}"
            )
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out} ({len(lines)} lines)")


def build_motion(families, client: pathlib.Path, out: pathlib.Path) -> None:
    """One animated cell per family: a still cannot show how a hit reads."""
    picks = [(family["label"], family["rows"][0]) for family in families if family["rows"]]
    columns = 4
    rows_count = -(-len(picks) // columns)
    cell = 96
    animations = []
    longest = 0
    for index, (label, row) in enumerate(picks):
        img = entry_image(client, row)
        frames = frames_of(img, sample_indices(len(img.images), 48)) if img else []
        longest = max(longest, len(frames))
        animations.append((index, label, frames))
    if longest == 0:
        return

    canvas = Image.new("RGBA", (columns * cell, rows_count * cell), (16, 18, 28, 255))
    font = load_font(13)
    out_frames = []
    for step in range(longest):
        frame = canvas.copy()
        draw = ImageDraw.Draw(frame)
        for index, label, frames in animations:
            if not frames:
                continue
            picture = frames[step % len(frames)]
            scale = min((cell - 8) / picture.width, (cell - 8) / picture.height, 1.0)
            size = (max(1, int(picture.width * scale)), max(1, int(picture.height * scale)))
            column, row_index = index % columns, index // columns
            frame.alpha_composite(
                picture.resize(size, Image.LANCZOS),
                (
                    column * cell + (cell - size[0]) // 2,
                    row_index * cell + (cell - size[1]) // 2,
                ),
            )
            draw.text(
                (column * cell + 4, row_index * cell + 2),
                label.split(" ")[0],
                fill=(255, 235, 160, 255),
                font=font,
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

    families = collect(args.client)
    build_overview(families, args.client, ROOT / "dnf_effect_berserker_candidates.png")
    build_family_sheets(families, args.client)
    build_motion(families, args.client, ROOT / "dnf_effect_berserker_candidates.gif")
    build_manifest(families, ROOT / "dnf_effect_berserker_candidates.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
