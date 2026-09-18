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
  assets/dnf_effect_catalog_<n>.png - with --catalog: every swordman effect pack
      on one name-labelled contact sheet, four frames each, for picking a pack by
      name when the move's own pack is not known yet

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
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK_PREFIX = "sprite_character_swordman_effect"

# One family per move the Berserker kit actually learns, in the order the hotbar
# teaches them; the pack names are the client's own move names. The packs come
# from the client's per-skill preview videos (Video/Swordman/<SkillName>.avi,
# whose file names are the internal skill names), not from guessing at keywords:
# chargecrash is not 崩山击, hopsmash is.
GROUPS = [
    ("崩山击 hop-smash", "hop-smash", ["_hopsmash"]),
    ("十字斩 gore-cross ✓已定", "gore-cross", ["_gorecross", "_atgorecross"]),
    ("血气之刃 blood-sword ✓已定", "blood-sword", ["_bloodsword"]),
    ("血之狂暴 blood-rage ✓已定（取自 frenzy 包）", "blood-rage", ["_frenzy"]),
    ("抓头 / 噬魂之手 grab-head ✓已定", "grab-head", ["_grabblastblood", "_grabblastbloodex"]),
    ("怒气爆发 outrage-break（地上圆圈 → 喷血）", "outrage-break", ["_outragebreak"]),
    ("崩山裂地斩 mountain-crash（候选三包）", "mountain-crash", ["_chargecrash", "_chagecrashex", "_atmountaincrash"]),
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

# The owner's confirmed picks (assets/dnf_effect_picks.md), as pack -> entry
# names; these win the note line over the game's current pick.
CONFIRMED = {
    "hopsmash": {"b_bottom_01_d.img"},
    "gorecross": {"gorecross_cross.img"},
    "grabblastblood": {"blood.img"},
    "grabblastbloodex": {"exp_blood_normal.img"},
    "bloodsword": {"sword_normal.img", "exp_dodge.img"},
    "frenzy": {"blood-energy.img", "blood-stone-0.img"},
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
    settled = row["name"] in CONFIRMED.get(row["pack"], ())
    colour = (150, 255, 170, 255) if (in_use or settled) else (255, 215, 120, 255)
    draw.text(
        (8, y + 6),
        f"{row['number']} {row['pack']}/{row['name']}",
        fill=colour,
        font=font,
    )
    if settled:
        note = "✓ 业主已定 / confirmed"
    elif in_use:
        note = "当前使用 / in use"
    else:
        note = f"{row['total']} frames · densest {row['dense']}"
    draw.text(
        (8, y + 24),
        note,
        fill=(150, 255, 170, 255) if (in_use or settled) else (150, 168, 200, 255),
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


def dhash(frame: Image.Image, size: int = 8) -> int:
    """Difference hash of the drawn pixels: "find art that looks like this"."""
    box = frame.getbbox()
    flat = Image.new("RGB", frame.size, (0, 0, 0))
    flat.paste(frame.convert("RGB"), (0, 0), frame)
    if box:
        flat = flat.crop(box)
    small = flat.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(small.getdata())
    bits = 0
    for y in range(size):
        row = y * (size + 1)
        for x in range(size):
            bits = (bits << 1) | (1 if pixels[row + x] > pixels[row + x + 1] else 0)
    return bits


def hash_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


SIGNATURE = 32
SIGNATURE_CACHE = pathlib.Path("/tmp/nano-dnf-effect-signatures.json")


def signature(frame: Image.Image) -> bytes:
    """A 32x32 colour+alpha thumbnail: cheap to compare, keeps palette and shape."""
    box = frame.getbbox()
    flat = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    flat.paste(frame, (0, 0), frame)
    if box:
        flat = flat.crop(box)
    return flat.resize((SIGNATURE, SIGNATURE), Image.LANCZOS).tobytes()


def signature_distance(a: bytes, b: bytes) -> float:
    total = 0
    for index in range(0, len(a), 4):
        for channel in range(3):
            total += (a[index + channel] - b[index + channel]) ** 2
    return total / (SIGNATURE * SIGNATURE * 3)


def load_signatures(client: pathlib.Path) -> dict:
    """Signature of every entry's brightest frame, cached between searches.

    Building this means decoding a few frames of every effect the class ships
    (a couple of minutes); the cache keeps repeat searches instant.
    """
    import json

    stamp = f"{client}"
    cache = {}
    if SIGNATURE_CACHE.exists():
        try:
            raw = json.loads(SIGNATURE_CACHE.read_text())
            if raw.get("client") == stamp and raw.get("schema") == 2 and raw.get("entries"):
                return {
                    key: (
                        value[0],
                        value[1] if len(value) > 2 else None,
                        bytes.fromhex(value[-1]),
                    )
                    for key, value in raw["entries"].items()
                }
        except Exception:
            cache = {}
    entries = {}
    for pack_name, name, img in all_entries(client):
        found = brightest(img)
        if not found:
            continue
        dense, frame = found
        entries[f"{pack_name}/{name}"] = [dense, len(img.images), signature(frame).hex()]
        if len(entries) % 200 == 0:
            print(f"  hashed {len(entries)} entries…", file=sys.stderr)
    SIGNATURE_CACHE.write_text(json.dumps({"client": stamp, "schema": 2, "entries": entries}))
    return {
        key: (value[0], value[1], bytes.fromhex(value[2]))
        for key, value in entries.items()
    }


def all_entries(client: pathlib.Path):
    """Every (pack, entry, image) the swordman effect packs ship."""
    for path in sorted((client / "ImagePacks2").glob(f"{PACK_PREFIX}*.NPK")):
        pack = path.stem[len(PACK_PREFIX):].lstrip("_")
        for name, img in load_pack(client, f"_{pack}") or []:
            yield pack, name, img


def brightest(img):
    """The drawn frame with the most opaque pixels, plus that count."""
    best = None
    for frame in frames_of(img):
        dense = density(frame)
        if best is None or dense > best[0]:
            best = (dense, frame)
    return best


def paste_strip(sheet, img, cell: int, y: int, columns: int = 6) -> None:
    frames = frames_of(img, sample_indices(len(img.images), columns))
    for column, frame in enumerate(frames):
        scale = min((cell - 6) / frame.width, (cell - 6) / frame.height, 1.0)
        size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
        sheet.alpha_composite(
            frame.resize(size, Image.LANCZOS),
            (340 + column * cell + (cell - size[0]) // 2, y + (cell - size[1]) // 2),
        )


def build_similar(client: pathlib.Path, reference: str, out: pathlib.Path, top: int = 20) -> None:
    """Rank every effect entry by how much it looks like one reference frame."""
    pack, _, entry = reference.partition("/")
    target = dict((n, i) for n, i in load_pack(client, f"_{pack}") or []).get(entry)
    if target is None:
        raise SystemExit(f"reference not found: {reference}")
    target_dense, target_frame = brightest(target)
    target_signature = signature(target_frame)

    ranked = []
    signatures = load_signatures(client)
    for pack_name, name, img in all_entries(client):
        if pack_name == pack and name == entry:
            continue
        cached = signatures.get(f"{pack_name}/{name}")
        if cached is None:
            continue
        dense, total, payload = cached
        ranked.append((signature_distance(target_signature, payload), pack_name, name, dense, total))
    ranked.sort()

    rows = ranked[:top]
    font = load_font(14)
    cell = 72
    sheet = Image.new("RGBA", (340 + 6 * cell, cell * (len(rows) + 1)), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, sheet.width, cell - 1], fill=(34, 20, 30, 255))
    draw.text(
        (8, cell // 2 - 10),
        f"最像 {reference} 的 {len(rows)} 条（d 越小越像）",
        fill=(255, 235, 150, 255),
        font=load_font(16),
    )
    draw.text((8, cell + 6), f"参考 {reference}", fill=(150, 255, 170, 255), font=font)
    draw.text((8, cell + 24), f"{target_dense} px", fill=(150, 168, 200, 255), font=font)
    paste_strip(sheet, target, cell, cell)
    for index, (distance, pack_name, name, dense, total) in enumerate(rows):
        y = cell * (index + 1)
        if not total:
            img = entry_image(client, {"pack": pack_name, "name": name})
            total = len(img.images) if img is not None else 0
        draw.text((8, y + 6), f"{index + 1}. {pack_name}/{name}", fill=(255, 215, 120, 255), font=font)
        draw.text((8, y + 24), f"{total} frames · {dense} px · d={distance}", fill=(150, 168, 200, 255), font=font)
        img = entry_image(client, {"pack": pack_name, "name": name})
        if img is not None:
            paste_strip(sheet, img, cell, y)
    sheet.save(out)
    print(f"wrote {out} ({sheet.width}x{sheet.height})")


def entry_names(client: pathlib.Path):
    """(pack, entry) for every swordman effect entry, without decoding art."""
    from pydnfex.npk import NPK

    for path in sorted((client / "ImagePacks2").glob(f"{PACK_PREFIX}*.NPK")):
        pack = path.stem[len(PACK_PREFIX):].lstrip("_")
        with open(path, "rb") as handle:
            npk = NPK.open(handle)
            for entry in npk.files:
                name = entry.name.replace("\\", "/").split("/")[-1]
                yield pack, name


def build_found(client: pathlib.Path, pattern: str, out: pathlib.Path) -> None:
    """Every entry whose pack/entry name matches a regex, from every pack.

    Names are filtered before any art is decoded, so this stays quick even
    though it walks the whole class's effect archive.
    """
    matcher = re.compile(pattern, re.I)
    rows = []
    for pack_name, name in entry_names(client):
        if not matcher.search(f"{pack_name}/{name}"):
            continue
        img = entry_image(client, {"pack": pack_name, "name": name})
        if img is None:
            continue
        found = brightest(img)
        if not found:
            continue
        dense, _frame = found
        rows.append((pack_name, name, dense, len(img.images)))
    rows.sort(key=lambda row: (-row[2], row[0], row[1]))

    font = load_font(14)
    cell = 72
    sheet = Image.new("RGBA", (340 + 6 * cell, cell * (len(rows) + 1)), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, sheet.width, cell - 1], fill=(34, 20, 30, 255))
    draw.text(
        (8, cell // 2 - 10),
        f"名字匹配 /{pattern}/ 的 {len(rows)} 条（按覆盖像素排序）",
        fill=(255, 235, 150, 255),
        font=load_font(16),
    )
    for index, (pack_name, name, dense, total) in enumerate(rows):
        y = cell * (index + 1)
        img = entry_image(client, {"pack": pack_name, "name": name})
        if not total:
            total = len(img.images) if img is not None else 0
        draw.text((8, y + 6), f"{index} {pack_name}/{name}", fill=(255, 215, 120, 255), font=font)
        draw.text((8, y + 24), f"{total} frames · {dense} px", fill=(150, 168, 200, 255), font=font)
        if img is not None:
            paste_strip(sheet, img, cell, y)
    sheet.save(out)
    print(f"wrote {out} ({sheet.width}x{sheet.height}, {len(rows)} rows)")


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
            if row["name"] in CONFIRMED.get(row["pack"], ()):
                flag = "  <- 业主已定"
            elif CURRENT.get(row["pack"]) == row["name"]:
                flag = "  <- 当前使用"
            else:
                flag = ""
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


def build_catalog(client: pathlib.Path, per_sheet: int = 36) -> None:
    """Every swordman effect pack, named, so a move's pack can be pointed at.

    The per-move sheets only work once the move -> pack mapping is known, and
    guessing it from keywords is what produced the wrong families in the first
    place. This is the fallback: one labelled row per pack, brightest entry, so
    the owner can name the pack their skill actually uses.
    """
    packs = sorted(
        path.stem[len(PACK_PREFIX):]
        for path in (client / "ImagePacks2").glob(f"{PACK_PREFIX}*.NPK")
    )
    font = load_font(14)
    cell = 80
    width = 300 + 4 * cell
    sheet_index = 0
    row = 0
    sheet = None
    draw = None

    def new_sheet() -> None:
        nonlocal sheet, draw, row, sheet_index
        sheet_index += 1
        height = cell * min(per_sheet, len(packs) - (sheet_index - 1) * per_sheet)
        sheet = Image.new("RGBA", (width, height), (20, 24, 38, 255))
        draw = ImageDraw.Draw(sheet)
        row = 0

    new_sheet()
    for pack in packs:
        entries = pack_rows(client, pack)
        if entries:
            best = entries[0]
            img = entry_image(client, best)
            frames = frames_of(img, sample_indices(len(img.images), 4)) if img else []
            draw.text((8, row * cell + 22), pack.lstrip("_"), fill=(255, 215, 120, 255), font=font)
            draw.text(
                (8, row * cell + 42),
                f"{best['name']} · {best['total']}f · d={best['dense']}",
                fill=(150, 168, 200, 255),
                font=font,
            )
            for column, frame in enumerate(frames):
                scale = min((cell - 6) / frame.width, (cell - 6) / frame.height, 1.0)
                size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
                sheet.alpha_composite(
                    frame.resize(size, Image.LANCZOS),
                    (300 + column * cell + (cell - size[0]) // 2, row * cell + (cell - size[1]) // 2),
                )
        row += 1
        if row >= per_sheet and pack != packs[-1]:
            path = ROOT / f"dnf_effect_catalog_{sheet_index}.png"
            sheet.save(path)
            print(f"wrote {path.name} ({sheet.width}x{sheet.height})")
            new_sheet()
    path = ROOT / f"dnf_effect_catalog_{sheet_index}.png"
    sheet.save(path)
    print(f"wrote {path.name} ({sheet.width}x{sheet.height}) — {len(packs)} packs total")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--catalog", action="store_true", help="also write the all-packs catalog sheets")
    parser.add_argument("--similar", metavar="PACK/ENTRY", help="rank every effect by looks-like-this-one")
    parser.add_argument("--find", metavar="REGEX", help="list every entry whose pack/entry name matches")
    parser.add_argument("--out", type=pathlib.Path, help="output path for --similar / --find")
    args = parser.parse_args()
    if not (args.client / "ImagePacks2").exists():
        raise SystemExit(f"no ImagePacks2 under {args.client}")

    if args.similar:
        slug = args.similar.replace("/", "-").replace(".img", "")
        build_similar(args.client, args.similar, args.out or ROOT / f"dnf_effect_similar_{slug}.png")
        return 0

    if args.find:
        slug = re.sub(r"[^a-z0-9]+", "-", args.find.lower()).strip("-") or "found"
        build_found(args.client, args.find, args.out or ROOT / f"dnf_effect_found_{slug}.png")
        return 0

    if args.catalog:
        build_catalog(args.client)
        return 0

    families = collect(args.client)
    build_overview(families, args.client, ROOT / "dnf_effect_berserker_candidates.png")
    build_family_sheets(families, args.client)
    build_motion(families, args.client, ROOT / "dnf_effect_berserker_candidates.gif")
    build_manifest(families, ROOT / "dnf_effect_berserker_candidates.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
