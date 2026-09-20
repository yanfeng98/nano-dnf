#!/usr/bin/env python3
"""Find every 鬼剑士 skill whose effect reads like 崩山裂地斩, with all its frames.

    pip install av pydnfex pillow
    python3 assets/make_slayer_rift_candidates.py [--client /mnt/c/dnf/地下城与勇士]

The owner pointed at 崩山裂地斩 ("跳起后猛砸地面，地面裂开并喷出红色的血气岩浆")
and asked for every Slayer move that looks like it, every frame included, so the
call on which art belongs to the move is theirs. Two sources are joined here:

  * the client's own per-skill preview clips, `Video/Swordman/<SkillName>.avi`
    (84 of them, already decrypted into assets/dnf_src/skill-videos), which say
    what each move looks like in game, and
  * the effect packs, one per move, where the frames actually live.

Writes, under the gitignored assets/dnf_effect_anim/:

  rift-candidates.png   the menu: one numbered row per candidate skill, eight
                        frames of its own preview clip, so a number is enough to
                        answer with
  rift-<slug>.png       one sheet per candidate: its preview strip on top, then
                        every entry of its pack with every frame it ships
  rift-candidates.txt   number -> skill / pack / entries / frames

Rows are per colour board (plain, "(tn)", "(18)") but a board that is pixel
identical to the plain one is folded into it, because the packs ship the same
shapes up to three times. DNF artwork belongs to Neople/Nexon, so these outputs
stay out of the public repo.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import make_berserker_effect_menu as menu  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent
CLIPS = ROOT / "dnf_src" / "skill-videos"
OUT = ROOT / "dnf_effect_anim"
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")

# (number+label, slug, pack suffix, entries prefix, preview clip, why it is here)
CANDIDATES = [
    ("崩山击 HopSmash（已在用）", "hop-smash", "_hopsmash", None, "HopSmash",
     "跳起砸地 + 血色裂地环，同型基准"),
    ("大蹦候选 OutRageBreak", "outrage-break", "_outragebreak", None, "OutRageBreak",
     "客户端预览就是跳起蓄力后地面喷橙火岩浆"),
    ("崩山撞击 ATMountainCrash", "at-mountain-crash", "_atmountaincrash", None, None,
     "包名即「山崩」，图形是砸地爆点 + 地面冲击环"),
    ("地压 ATEarthPressure", "at-earth-pressure", "_atearthpressure", None, None,
     "floor 那几条画的就是地面裂纹 + 尘土"),
    ("崩山突刺 ChargeCrash", "charge-crash", "_chargecrash", None, "ChargeCrash",
     "冲刺落点砸地，地面火环 + 下劈"),
    ("崩山突刺 EX ChargeCrashEx", "charge-crash-ex", "_chagecrashex", None, "ChargeCrashEx",
     "同族 EX 包（客户端包名拼作 chagecrashex）"),
    ("流星落 MeteorSword", "meteor-sword", "_meteorsword", None, "MeteorSword",
     "剑砸进地面，crack + 地火 + 碎岩"),
    ("地狱火 Hellbenter", "hellbenter", "_hellbenter", None, "Hellbenter",
     "地面喷出巨大火柱，岩浆感最强的一套"),
    ("火焰波动 FireWave / FireWaveEx", "fire-wave", "_firewave", None, "FireWave",
     "火在贴地铺开，EX 的 entries 也在这一包里"),
    ("地狱火拳 ATFistOfHellfire", "at-fist-of-hellfire", "_atfistofhellfire", None, None,
     "砸地后红色火焰成柱爆开"),
    ("火焰斩 Flame", "flame", "_flame", None, None,
     "flame_ground 是贴地火焰，flame_line 是从上劈下的那道"),
    ("通用波动 NormalWave", "normal-wave", "", ("normalwave",), "NormalWave",
     "崩山击早先用过的通用波动行，供对照"),
    ("怒气爆发 BloodBlast（对照）", "blood-blast", "_blastblood", None, "BloodBlast",
     "对照：地面喷白金火柱，已经归给怒气爆发"),
    ("浴血之怒 BloodBoom（对照）", "blood-boom", "_bloodboom", None, "BloodBoom",
     "对照：地面血爆"),
    ("墓碑雨 TombStoneRain（对照）", "tomb-stone-rain", "_tombstone", None, "TombStoneRain",
     "对照：石柱从地面砸出来"),
]

CLIP_CELL = 150
CELL = 60
LABELS = 300

# Skills whose preview does erupt low in the frame but that are not this move's
# shape: the owner asked for 崩山裂地斩 lookalikes, so a ground ring you stand in
# or a full-body burst is listed as a near miss instead of a candidate.
NEAR_MISSES = {
    "BloodMarble": "血球从天上坠下来炸开（魔煞血陨），没有「人/剑砸地」那一下",
    "WaveSpinArea": "贴地粉色光环一圈圈扩散，没有砸地与喷发",
    "BloodRiven": "二觉血魔的变身与扑咬（已归血魔），贴地部分只是血泊",
    "HundredSword": "剑魂连斩 + 光柱，落点在身前而不是砸进地面",
    "BloodyRave": "血气爆发的血柱横扫，属于怒气/血气爆发那一系",
    "Khazan": "鬼泣的地面红圈（人站圈里），业主给的「地上圆圈」描述更像怒气爆发",
    "Necromantic": "同上，鬼泣地面红圈",
    "Vajra": "阿修罗的贴地光阵，无砸地动作",
    "BloodSword": "血气之刃：巨剑刺入后爆开（已归血气之刃）",
    "WaveEye": "波动眼：地面光纹 + 光柱",
}


def clip_frames(name: str, count: int = 8):
    """Evenly spaced frames of one client preview clip (None when unavailable)."""
    path = CLIPS / f"Swordman-{name}.mp4"
    if not path.exists():
        return None
    import av

    with av.open(str(path)) as container:
        raw = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    if not raw:
        return None
    index = menu.sample_indices(len(raw), count)
    return [Image.fromarray(raw[i]).convert("RGBA") for i in index], len(raw)


def clip_scores():
    """Every Slayer preview clip, ranked by fire erupting low in the frame.

    This is the evidence that nothing was skipped: the owner asked for *all*
    Slayer skills, so the manifest carries the score of all 84 clips, not just
    the ones that made the cut. "low" counts blood/fire pixels in the bottom
    half of the frame, averaged over the clip's hottest five-frame window.
    """
    import av
    import numpy as np

    rows = []
    for path in sorted(CLIPS.glob("Swordman-*.mp4")):
        name = path.stem.split("-", 1)[1]
        with av.open(str(path)) as container:
            frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
        if not frames:
            continue
        scores = []
        for array in frames:
            band = array[int(array.shape[0] * 0.55):]
            red = band[:, :, 0].astype(np.int16)
            green = band[:, :, 1].astype(np.int16)
            blue = band[:, :, 2].astype(np.int16)
            warm = (red > 140) & (red - green > 40) & (red - blue > 60)
            scores.append(int(warm.sum()))
        window = max((sum(scores[i:i + 5]) / 5 for i in range(max(1, len(scores) - 4))), default=0)
        rows.append((window, name, len(frames)))
    rows.sort(reverse=True)
    return rows


BOARD_ORDER = {"": 0, "(tn)": 1, "(18)": 2}


def boards(client: pathlib.Path, pack: str, prefixes):
    """Every entry of a pack, grouped by shape with every colour board it ships.

    The packs ship the same shapes once per board (plain, "(tn)", "(18)"), and
    which board the owner wants is half the decision, so a board is only dropped
    when its art is pixel identical to a board already drawn above it.
    """
    grouped: dict[str, dict[str, object]] = {}
    for name, img in menu.load_pack(client, pack) or []:
        if prefixes and not name.startswith(tuple(prefixes)):
            continue
        base = menu.canonical(name)
        board = name[: len(name) - len(base)] if base != name else ""
        entry = grouped.setdefault(base, {"name": base, "boards": []})
        entry["boards"].append((board, img))
    rows = []
    for key in sorted(grouped):
        entry = grouped[key]
        seen: dict[bytes, str] = {}
        boards_out = []
        for board, img in sorted(entry["boards"], key=lambda pair: (BOARD_ORDER.get(pair[0], 9), pair[0])):
            here = menu.brightest(img)
            if not here:
                continue
            label = board or "素色板"
            mark = menu.signature(here[1])
            twin_of = seen.get(mark)
            seen.setdefault(mark, label)
            boards_out.append({"board": board, "img": img, "twin": twin_of is not None, "twin_of": twin_of})
        rows.append({"name": key, "boards": boards_out})
    return rows


def paste(sheet, frame, x, y, cell):
    scale = min((cell - 4) / frame.width, (cell - 4) / frame.height, 1.0)
    size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
    small = frame.resize(size, Image.LANCZOS)
    sheet.alpha_composite(small, (x + (cell - size[0]) // 2, y + (cell - size[1]) // 2))


def build_skill(client: pathlib.Path, number: int, label, slug, pack, prefixes, clip, why):
    """One candidate: the preview strip, then every entry with every frame."""
    rows = boards(client, pack, prefixes)
    drawn = [(row, board) for row in rows for board in row["boards"] if not board["twin"]]
    if not drawn:
        print(f"  no entries for {pack}", file=sys.stderr)
        return None
    widest = max(len(board["img"].images) for _, board in drawn)
    clip_row = clip_frames(clip) if clip else None
    head = 58
    strip = CLIP_CELL + 8 if clip_row else 0
    width = LABELS + max(widest * CELL, 8 * CLIP_CELL if clip_row else 0) + 8
    height = head + strip + CELL * len(drawn) + 6
    sheet = Image.new("RGBA", (width, height), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, width, head - 1], fill=(34, 20, 30, 255))
    draw.text((8, 6), f"#{number:02d} {label}  ·  {why}", fill=(255, 235, 150, 255),
              font=menu.load_font(15))
    frames = sum(len(row["img"].images) for _, row in drawn)
    draw.text((8, 30), f"包 {pack or '(base)'} · {len(rows)} 组形状 / {len(drawn)} 行 / {frames} 帧",
              fill=(150, 200, 255, 255), font=menu.load_font(14))
    y = head
    if clip_row:
        frames_in_clip, total = clip_row
        draw.text((8, y + 6), f"客户端预览 {clip}.avi", fill=(150, 255, 170, 255), font=menu.load_font(14))
        draw.text((8, y + 26), f"{total} 帧", fill=(150, 168, 200, 255), font=menu.load_font(13))
        for column, frame in enumerate(frames_in_clip):
            paste(sheet, frame, LABELS + column * CLIP_CELL, y, CLIP_CELL)
        y += strip
    for row, board in drawn:
        board_name = board["board"] or "素色板"
        draw.text((8, y + 6), f"{board_name}  {row['name']}", fill=(255, 215, 120, 255),
                  font=menu.load_font(13))
        note = f"{len(board['img'].images)} 帧"
        folded = [other["board"] or "素色板" for other in row["boards"]
                  if other["twin"] and other["twin_of"] == board_name]
        if folded:
            note += " · 与 " + "/".join(folded) + " 同图"
        draw.text((8, y + 24), note, fill=(150, 168, 200, 255), font=menu.load_font(13))
        for column, frame in enumerate(menu.frames_of(board["img"])):
            paste(sheet, frame, LABELS + column * CELL, y, CELL)
        y += CELL
    path = OUT / f"rift-{slug}.png"
    sheet.save(path)
    print(f"wrote {path.name} ({sheet.width}x{sheet.height})")
    return {"label": label, "slug": slug, "pack": pack or "(base)", "why": why,
            "shapes": len(rows), "rows": len(drawn), "frames": frames,
            "clip": clip, "clip_frames": clip_row[1] if clip_row else 0}


def build_menu(items, out: pathlib.Path):
    """The numbered menu: one row per candidate, eight frames of its own clip."""
    row_h = CLIP_CELL + 10
    height = 34 + row_h * len(items)
    width = LABELS + 8 * CLIP_CELL + 8
    sheet = Image.new("RGBA", (width, height), (20, 24, 38, 255))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([0, 0, width, 33], fill=(34, 20, 30, 255))
    draw.text((8, 8), "鬼剑士里跟 崩山裂地斩 同型的技能（每格 = 客户端预览，细则见 rift-<编号>.png）",
              fill=(255, 235, 150, 255), font=menu.load_font(16))
    for index, item in enumerate(items):
        y = 34 + index * row_h
        draw.text((8, y + 8), f"#{index:02d} {item['label']}", fill=(255, 215, 120, 255), font=menu.load_font(15))
        draw.text((8, y + 30), f"包 {item['pack']} · {item['rows']} 行 / {item['frames']} 帧",
                  fill=(150, 200, 255, 255), font=menu.load_font(13))
        draw.text((8, y + 50), item["why"], fill=(160, 176, 200, 255), font=menu.load_font(12))
        found = clip_frames(item["clip"]) if item["clip"] else None
        if found:
            frames, _ = found
            for column, frame in enumerate(frames):
                paste(sheet, frame, LABELS + column * CLIP_CELL, y, CLIP_CELL)
        else:
            draw.text((LABELS + 8, y + 60), "（该包不在 Video/Swordman 的 84 个预览里）",
                      fill=(160, 176, 200, 255), font=menu.load_font(13))
    sheet.save(out)
    print(f"wrote {out.name} ({sheet.width}x{sheet.height}, {len(items)} rows)")


def check(client: pathlib.Path) -> int:
    """Fail loudly when a sheet is missing, empty, or off the client."""
    problems = []
    slugs = []
    for number, (label, slug, pack, prefixes, clip, _why) in enumerate(CANDIDATES):
        slugs.append(slug)
        rows = boards(client, pack, prefixes)
        drawn = [(row, board) for row in rows for board in row["boards"] if not board["twin"]]
        frames = sum(len(board["img"].images) for _, board in drawn)
        if not drawn:
            problems.append(f"#{number:02d} {label}: {pack or '(base)'} has no entries")
            continue
        board_names = {board["board"] for _, board in drawn}
        if len(rows) and "" not in board_names:
            problems.append(f"#{number:02d} {label}: the plain board was folded away")
        path = OUT / f"rift-{slug}.png"
        if not path.exists():
            problems.append(f"#{number:02d} {label}: {path.name} missing")
        if clip and clip_frames(clip) is None:
            problems.append(f"#{number:02d} {label}: preview {clip} not decrypted")
        if not clip:
            print(f"  #{number:02d} {label}: no client preview (documented)")
        print(f"  #{number:02d} {label}: {pack or '(base)'} {len(rows)} shapes / {len(drawn)} rows / {frames} frames")
    manifest = OUT / "rift-candidates.txt"
    if not manifest.exists():
        problems.append("rift-candidates.txt missing")
    else:
        listed = [line for line in manifest.read_text().splitlines() if line.startswith("    ") and "帧" in line
                  and "← 已在候选里" in line]
        if len(listed) != len([c for c in CANDIDATES if c[4]]):
            problems.append(f"manifest marks {len(listed)} scored clips, expected {len([c for c in CANDIDATES if c[4]])}")
        scanned = sum(1 for line in manifest.read_text().splitlines() if line.startswith("    ") and "帧" in line
                      and line.strip()[0].isdigit())
        if scanned < 84:
            problems.append(f"manifest lists {scanned} scored clips, expected all 84")
    if len(set(slugs)) != len(slugs):
        problems.append("candidate slugs are not unique")
    for problem in problems:
        print(f"FAIL {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"OK {len(CANDIDATES)} candidates, {len(set(slugs))} unique sheets, manifest covers all 84 clips")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--check", action="store_true",
                        help="verify the sheets and the manifest against the client instead of writing them")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    if args.check:
        return check(args.client)

    items = []
    for number, (label, slug, pack, prefixes, clip, why) in enumerate(CANDIDATES):
        built = build_skill(args.client, number, label, slug, pack, prefixes, clip, why)
        if built:
            items.append(built)
    build_menu(items, OUT / "rift-candidates.png")

    lines = ["# 崩山裂地斩 同型候选（鬼剑士全技能扫描）", "",
             "扫的是客户端 `Video/Swordman` 的 84 个鬼剑士技能预览，加上特效包本身。",
             "每条的 `rift-<slug>.png` 里是：预览条 + 该包每一条的**全部帧**。", ""]
    for index, item in enumerate(items):
        lines.append(f"#{index:02d} {item['label']}")
        lines.append(f"    包 {item['pack']} · {item['shapes']} 组形状 / {item['rows']} 行 / {item['frames']} 帧"
                     + (f" · 预览 {item['clip']}（{item['clip_frames']} 帧）" if item["clip"] else " · 无预览"))
        lines.append(f"    收入原因：{item['why']}")
        lines.append(f"    细图：assets/dnf_effect_anim/rift-{item['slug']}.png")
    scores = clip_scores()
    lines += ["", "# 全部 84 个鬼剑士预览的地面喷发分（供核对没漏）", "",
              "low = 画面下半部的血气/火焰像素数，取该片段最旺的连续 5 帧平均；",
              "分数低不等于不像，只是说明它不在“贴地喷发”这一型上。", ""]
    chosen = {item["clip"] for item in items if item["clip"]}
    for window, name, total in scores:
        mark = " ← 已在候选里" if name in chosen else ""
        lines.append(f"    {window:8.1f}  {name:22s} {total:4d} 帧{mark}")
    lines += ["", "# 分数高但没有入选的（附原因，供业主核对）", ""]
    for window, name, total in scores:
        if name in chosen or name not in NEAR_MISSES:
            continue
        lines.append(f"    {window:8.1f}  {name:22s} {NEAR_MISSES[name]}")
    (OUT / "rift-candidates.txt").write_text("\n".join(lines) + "\n")
    print(f"wrote rift-candidates.txt ({len(items)} candidates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
