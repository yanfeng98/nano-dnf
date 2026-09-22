#!/usr/bin/env python3
"""Take 崩山裂地斩 apart into the entries its own pack is made of.

    python3 assets/make_rift_layer_plan.py [--client /mnt/c/dnf/地下城与勇士]

The owner looked at assets/dnf_effect_anim/rift-outrage-break.png and read it as
several skills stacked into one: a flaming blade coming down, a floor splitting,
a magma column, a flash, sparks and rock. He asked which of those pictures
actually make the move and in what order they play.

They are all one pack. `sprite_character_swordman_effect_outragebreak.NPK` holds
29 entries, which collapse to twelve shapes because DNF ships every shape on
three colour boards:

    plain        dark blood red      (the 血气 version of the shape)
    (tn)         orange / magma      (the board the client's own preview shows)
    (18)         pixel-identical to (tn)

and a handful of shapes also ship an `_ldodge` twin, which is the same drawing
dimmed - the copy the client paints *behind* the character.

The shapes are one event in four groups: the blade, the floor, the eruptions and
the trimmings. This script writes

    assets/dnf_effect_anim/rift-outrage-break-layers.png  the anatomy: every
        group with every frame it ships, where each sits relative to the point
        the caster stands on, the whole pack composited at its own coordinates,
        and the playback the client's preview shows as a timeline
    assets/dnf_effect_anim/rift-outrage-break-layers.txt  the same in words

`make_slayer_rift_candidates.py` wrote the menu the owner picked the pack from
and `rift-candidates.txt` the shortlist; this is the layer-by-layer reading of
that pick. Timings come from the client's own preview clip, Video/Swordman/
OutRageBreak.avi, which decodes to 100 frames at 30fps: it lands at frame 23,
erupts wide over 24-31, holds the glowing ring over 32-59 and erupts tall over
60-93. DNF artwork belongs to Neople/Nexon, so the outputs stay out of the
public repo.
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import make_berserker_effect_menu as menu  # noqa: E402

OUT = ROOT / "dnf_effect_anim"
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK = "_outragebreak"

BG = (16, 18, 32)
INK = (232, 236, 248)
DIM = (150, 158, 186)
HOT = (255, 168, 74)
COOL = (120, 210, 255)
PALE = (255, 232, 150)

# The caster's own ground point: the middle of the pack's floor ring.
ANCHOR = (382, 281)

# The four groups, in the order the client plays them. `board` is the colour
# board to draw; `frames` is what the entry ships; `role` is what it draws.
GROUPS = [
    ("血剑砸下 bloodsword_none", "outragebreak_bloodsword_none.img",
     "f0-15 火刃从左上斜劈下来，f16-17 砸进地面炸开，f18-19 收成贴地火焰",
     "落点在角色左脚边（x204-343），不是脚下正中央"),
    ("地裂 floor", "outragebreak_floor.img",
     "f0 岩土碎裂夹红熔纹，f1 黑色裂纹，f2-6 熔岩环由小到大，f7 碎石飞起，"
     "f8-10 橙红裂纹在贴地蔓延",
     "445x166 的环包住角色，环心就是站人点"),
    ("喷发 bloodsexp_1", "outragebreak_bloodsexp_1_none.img",
     "矮宽的火丛：f1-2 最盛，f3-5 碎成火块，f6 只剩火星",
     "铺在角色右侧（x371-467），贴地那一口"),
    ("喷发 bloodsexp_2", "outragebreak_bloodsexp_2_none.img",
     "细高的岩浆柱：f2-3 最高，f4-6 化成飞散火星",
     "同样在右侧但更高更细（x430-518），柱底只有 y282"),
    ("冲击光 bloodsexp_glow", "outragebreak_bloodsexp_glow.img",
     "f0 一团柔光，f1 星芒闪光", "盖住整片喷发，砸地那一下的补光"),
    ("岩浆滴 drops_1", "outragebreak_drops_1.img",
     "f0 一滴落下，f1-4 落地摊成熔岩洼，f5 裂开",
     "落在环上（x334-363），客户端的粒子"),
    ("岩浆滴 drops_2", "outragebreak_drops_2.img",
     "同上，另一种滴落节奏（7 帧）", "同上"),
    ("碎岩 part", "outragebreak_part.img",
     "f0-3 石块翻滚，f4 一颗火星",
     "帧坐标在包原点（0,0）：客户端把它当粒子撒，出包时得自己给落点"),
]

# The staging the game now plays, in seconds of its 2s cast: every window is the
# one written into assets/import_dnf_effects.py (the effect rows cover the whole
# cast, 0.00-1.98, because the move opens on 举剑 and the blood sword goes up with
# it). The order and the overlaps are the client's; only the length is
# compressed, because the client's own event runs 2.33s from its landing
# (preview frames 23-93) and this cast is 2s.
TIMELINE = [
    ("血剑 bloodsword 聚起", 0.00, 0.71, "f0-f12：举剑时火刃在头顶聚形，随跳跃压下来"),
    ("血剑 bloodsword 砸地", 0.71, 0.91, "f13-f19：砸进地面炸开，落在触地那一下"),
    ("冲击光 glow", 0.67, 0.79, "f0-f1"),
    ("地裂 floor", 0.69, 0.95, "f0-f7：碎裂 + 熔岩环铺开 + 碎石飞起"),
    ("第一波 bloodsexp_1（圈）", 0.69, 1.03, "矮宽火丛，六处绕环（客户端 f24-31）"),
    ("岩浆滴 drops_1/2", 0.85, 1.43, "两滴，错开落"),
    ("碎岩 part", 0.73, 1.78, "砸地那下与第二波各撒一次"),
    ("熔岩环留在地上 floor", 0.95, 1.98, "f5 撑住：空档期只剩环与裂纹（客户端 f32-59）"),
    ("第二波 bloodsexp_2（圈）+ glow", 1.31, 1.80, "细高岩浆柱，另六处绕环（客户端 f60-93）"),
    ("收尾 bloodsexp_2 火星", 1.80, 1.98, "火散成火星，环还亮着"),
]

# Cross-checks against the client preview on the same axis: where its landing
# (frame 23) and this cast's own end fall.
PREVIEW_MARKS = [
    (0.72, "客户端落地 = 预览 f23"),
    (1.98, "本作施法结束"),
]


def load_font(size: int):
    return menu.load_font(size)


def pack_frames(client: pathlib.Path):
    """Every entry of the pack, as {name: [(frame, x, y), ...]}.

    The coordinates matter: DNF packs draw every shape of one move into a single
    coordinate space around the caster, so a frame's (x, y) is where it belongs
    on screen and not just where its own bounding box starts.
    """
    out = {}
    for name, img in menu.load_pack(client, PACK) or []:
        frames = []
        for index, data in enumerate(img.images):
            try:
                frames.append((img.build(data).convert("RGBA"), data.x, data.y))
            except Exception:
                continue
        if frames:
            out[name] = frames
    return out


def board(name: str, palette: str) -> str:
    """The entry name on a given colour board."""
    wanted = palette + name
    return wanted


def scaled(im: Image.Image, height: int) -> Image.Image:
    factor = height / max(1, im.height)
    return im.resize((max(1, int(im.width * factor)), height), Image.LANCZOS)


def wrap(text: str, width: int) -> list:
    """Break a line on CJK width (every glyph is about one unit)."""
    lines, line = [], ""
    for char in text:
        if len(line) >= width and char not in "，。：、":
            lines.append(line)
            line = ""
        line += char
    if line:
        lines.append(line)
    return lines


def anatomy(entries, sheet, draw_sheet, y: int) -> int:
    """One row per group: its frames, and where the group sits under the caster."""
    row_h = 168
    text_x, strip_x, strip_w, thumb_h = 18, 470, 1060, 96
    map_w, map_h, map_x = 300, 180, 1560
    for label, name, role, place in GROUPS:
        frames = entries.get(board(name, "(tn)"))
        if frames is None:
            continue
        draw_sheet.text((18, y + 6), label, font=load_font(20), fill=HOT)
        line_y = y + 34
        for line in wrap(role, 30):
            draw_sheet.text((text_x, line_y), line, font=load_font(15), fill=INK)
            line_y += 22
        for line in wrap(place, 32):
            draw_sheet.text((text_x, line_y), line, font=load_font(14), fill=DIM)
            line_y += 20
        cell_w = max(24, strip_w // max(1, len(frames)))
        x = strip_x
        for index, (frame, _fx, _fy) in enumerate(frames):
            thumb = scaled(frame, thumb_h)
            if thumb.width > cell_w:
                thumb = thumb.resize((cell_w, max(1, int(thumb_h * cell_w / thumb.width))), Image.LANCZOS)
            sheet.paste(thumb, (x, y + 24 + (thumb_h - thumb.height)), thumb)
            draw_sheet.text((x + 2, y + 24 + thumb_h + 4), f"f{index}", font=load_font(12), fill=COOL)
            x += thumb.width + 4
        # Where it sits relative to the caster: the pack's own coordinates, with
        # the caster's ground point marked.
        spot = Image.new("RGBA", (660, 400), (0, 0, 0, 0))
        for index in sorted({min(2, len(frames) - 1), min(6, len(frames) - 1)}):
            frame, fx, fy = frames[index]
            spot.alpha_composite(frame, (fx, fy))
        mini = Image.new("RGB", (map_w, map_h), (10, 11, 20))
        inner = spot.resize((int(map_h * 660 / 400), map_h), Image.LANCZOS)
        inner = inner.crop((0, 0, min(map_w, inner.width), map_h))
        mini.paste(inner, (0, 0), inner)
        marker = ImageDraw.Draw(mini)
        ground = int(ANCHOR[1] * map_h / 400)
        upright = int(ANCHOR[0] * map_h / 400)
        marker.line((0, ground, map_w, ground), fill=(70, 90, 70))
        marker.line((upright, 0, upright, map_h), fill=(70, 90, 70))
        draw_sheet.text((map_x, y + 2), "整包坐标里的位置（绿线=站人点）", font=load_font(13), fill=DIM)
        sheet.paste(mini, (map_x, y + 20))
        y += row_h + 20
    return y


def composite(entries, sheet, draw_sheet, y: int) -> int:
    """The whole pack at its own coordinates, in the (tn) board."""
    layers = [
        ("outragebreak_floor.img", 4),
        ("outragebreak_bloodsexp_glow.img", 1),
        ("outragebreak_bloodsword_none.img", 17),
        ("outragebreak_bloodsexp_1_none.img", 2),
        ("outragebreak_bloodsexp_2_none.img", 3),
        ("outragebreak_drops_1.img", 3),
        ("outragebreak_drops_2.img", 3),
        ("outragebreak_part.img", 1),
    ]
    canvas = Image.new("RGBA", (660, 400), (10, 11, 20, 255))
    for name, index in layers:
        frames = entries.get(board(name, "(tn)"))
        if not frames or index >= len(frames):
            continue
        frame, fx, fy = frames[index]
        canvas.alpha_composite(frame, (fx, fy))
    marker = ImageDraw.Draw(canvas)
    marker.line((0, ANCHOR[1], 660, ANCHOR[1]), fill=(60, 200, 90))
    marker.line((ANCHOR[0], 0, ANCHOR[0], 400), fill=(60, 200, 90))
    marker.text((ANCHOR[0] + 6, ANCHOR[1] + 4), "站人点 / 环心", font=load_font(14), fill=(60, 200, 90))
    view = canvas.resize((660, 400), Image.LANCZOS)
    sheet.paste(view, (30, y), view)
    draw_sheet.text((720, y + 20), "整包按自己的坐标叠起来（(tn) 橙火板）", font=load_font(20), fill=HOT)
    notes = [
        "· 血剑炸开在环心左边，岩浆从环心右边喷出来——",
        "  客户端里人站在环心，所以火是往他身后窜的。",
        "· 三条色板只取一条：(tn) 橙火。plain 是血红版，",
        "  (18) 与 (tn) 逐像素相同。",
        "· 每条还有 _ldodge 孪生图，形状一样但压暗了，",
        "  总不透明度只有亮版的 1/4（实测），是弱化垫底的",
        "  那一份，出口里没用到。",
        "· part 的帧坐标在包原点，是粒子，不是在原地画。",
        "· 环心 (382,281) 就是出口里 anchor 用的那个点。",
        "· 客户端画的时候，压暗层在人后面、亮层在人前面；",
        "  这一包自己已经有前后两份，不用另外借别人的图。",
    ]
    ty = y + 50
    for line in notes:
        draw_sheet.text((720, ty), line, font=load_font(15), fill=INK)
        ty += 24
    return y + 420


def timeline(sheet, draw_sheet, y: int) -> int:
    """The playback the client shows, as bars."""
    axis_x, axis_w = 470, 980
    span = 2.0
    bar_h = 26
    draw_sheet.text(
        (30, y), "现在游戏里放的顺序（秒，0 = 施法开始，整段 2.0s）", font=load_font(20), fill=HOT)
    y += 34
    for second, label in PREVIEW_MARKS:
        x = axis_x + int(axis_w * second / span)
        draw_sheet.line((x, y, x, y + len(TIMELINE) * (bar_h + 6) + 16), fill=(70, 80, 110))
        draw_sheet.text((x + 4, y - 22), label, font=load_font(13), fill=COOL)
    for index, (label, start, until, note) in enumerate(TIMELINE):
        row_y = y + index * (bar_h + 6)
        draw_sheet.text((30, row_y + 4), label, font=load_font(15), fill=INK)
        x0 = axis_x + int(axis_w * start / span)
        x1 = axis_x + int(axis_w * until / span)
        draw_sheet.rounded_rectangle((x0, row_y, x1, row_y + bar_h), 6, fill=(196, 92, 40))
        for line_index, line in enumerate(wrap(note, 20)):
            draw_sheet.text((x1 + 10, row_y + 2 + line_index * 15), line, font=load_font(13), fill=DIM)
    return y + len(TIMELINE) * (bar_h + 6) + 30


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    args = parser.parse_args()

    entries = pack_frames(args.client)
    if not entries:
        raise SystemExit(f"no {PACK} pack under {args.client} (ImagePacks2)")
    art = sorted({menu.canonical(name) for name in entries})
    frames = sum(len(f) for f in entries.values())
    print(f"{PACK}: {len(entries)} entries, {len(art)} artworks, {frames} frames")

    sheet = Image.new("RGB", (1880, 2500), BG)
    draw_sheet = ImageDraw.Draw(sheet)
    draw_sheet.text((18, 14), "崩山裂地斩（大蹦）解剖 — 包 _outragebreak", font=load_font(30), fill=PALE)
    draw_sheet.text(
        (18, 54),
        f"{len(entries)} 条目 = 8 种图 × 3 条色板（plain 血红 / (tn) 橙火 / (18) 与 (tn) 逐像素相同）"
        f"，再减去 4 条没有重发的，共 {frames} 帧",
        font=load_font(17), fill=DIM)
    draw_sheet.text(
        (18, 78),
        "业主说的「多个技能特效组合」是这一包里的四组形状：血剑、地裂、喷发、点缀。"
        "它们共用一套坐标，环心 (382,281) 就是人站的地方。",
        font=load_font(17), fill=DIM)

    y = anatomy(entries, sheet, draw_sheet, 120)
    y = composite(entries, sheet, draw_sheet, y + 10)
    y = timeline(sheet, draw_sheet, y + 10)

    OUT.mkdir(exist_ok=True)
    sheet = sheet.crop((0, 0, sheet.width, min(sheet.height, y + 20)))
    sheet.save(OUT / "rift-outrage-break-layers.png")
    print(f"wrote {OUT / 'rift-outrage-break-layers.png'} {sheet.size}")

    lines = [
        "# 崩山裂地斩（大蹦）解剖 — 包 _outragebreak",
        "",
        f"客户端包 sprite_character_swordman_effect_outragebreak.NPK：{len(entries)} 个条目、"
        f"{len(art)} 条画法（8 种图，血剑与两处喷发各多一条压暗孪生）、{frames} 帧。",
        "",
        "## 三种图（业主说的「多个技能特效」就是这些图叠在一起）",
    ]
    for label, name, role, place in GROUPS:
        shown = entries.get(board(name, "(tn)")) or entries.get(name) or []
        lines += [f"- {label}  ·  {len(shown)} 帧", f"    {role}", f"    {place}"]
    lines += [
        "",
        "## 三条色板，只取一条",
        "- plain：血红版（bloodsexp_1 最盛帧均值 (99,1,1)）",
        "- (tn)：橙火版（同一帧 (180,101,3)）——客户端自己的预览就是这版",
        "- (18)：与 (tn) 逐像素相同，不是新图层；同时画三条等于每个形状画三遍",
        "- 血剑与两处喷发还各有一条 *_ldodge 孪生图：同一形状、总不透明度只有亮版的 1/4（实测），"
        "客户端拿它当弱化垫底的那一份，出口里没用到",
        "",
        "## 一套坐标，站人点在环心",
        "- floor 是 445x166 的环，环心 (382, 281) = 人站的地方 = 出口里的 anchor",
        "- 那圈光环放大 1.8 倍后是中心 (391.5, 241.5)、半轴 195x84 的椭圆（人站在椭圆中心下方 40px，",
        "  就是透视里「站在圈里」的位置）——出口里两波火柱的落点全部取在这条椭圆上",
        "- 血剑落在环心左边 x204-343，岩浆从环心右边喷出 x371-518（客户端里火往身后窜）",
        "- part 的帧坐标在包原点，客户端当粒子撒，需要在出口里给落点",
        "",
        "## 播放顺序（现在游戏里放的，0 = 施法开始；客户端预览 OutRageBreak.avi 100 帧 @30fps）",
        "客户端自己那一段从落地起算有 2.33s（预览 f23 落点 → f93 收尾），这里压到 1.31s 塞进",
        "2.0s 的施法；血剑的起手（举剑那一段）接在本作自己的起手式上，其余每组图的先后与重叠",
        "照客户端，只有长度是压过的。",
    ]
    for label, start, until, note in TIMELINE:
        lines.append(f"- {start:.2f}-{until:.2f}s  {label}  ({note})")
    lines += [
        "",
        "预览里的三个锚点：f23 落点、f60 第二波、f93 收尾（热像素计数 24-31 帧到 1500+，",
        "32-59 帧掉到 100-180 只剩环，60-93 帧冲到 7800+）。",
        "",
        "## 结论",
        "客户端这套不需要向别的技能包借图：砸地的血剑、地裂与熔岩环、两波岩浆喷发、",
        "砸地补光、岩浆滴、碎岩，全在 _outragebreak 一个包里，按阶段先后播放。",
        "实现拆成两条各 45 帧的 row：技能行（血剑 + 地裂）画在角色身后，FRONT_ROWS 的火焰行",
        "（补光、两波火、岩浆滴、碎岩）在 drawPlayer 之后画；两行共用同一个窗口、缩放与锚点",
        "（烘焙器的 match 字段把技能行的窗口传过去），所以火还是从裂口里出来。",
        "血剑从施法第一帧就在场上（业主：「崩山裂地斩是先举剑，参考 123-124」），所以两行覆盖",
        "整个施法 0.00-1.98s，而不是只覆盖落地之后。",
        "火是围着人一圈的柱子（业主：「不是一排柱子，应该是一个圈」）：包里每次喷发只有一张图，",
        "出口把它按包自己的环摆在椭圆上的六处（第二波转 30°，两波合起来整圈都喷一遍）。",
        "近侧与两侧的柱子画在人前面（FRONT_ROWS），远侧的柱子画在人身后（技能行）——",
        "圈才有近边和远边，画在同一边就不是圈了。",
        "施法 1.05s → 2.0s，伤害 2 段 → 3 段（剑落 / 地裂研磨 / 第二波），冲击波跟着第一下。",
        "",
        f"生成：python3 assets/{pathlib.Path(__file__).name}",
    ]
    (OUT / "rift-outrage-break-layers.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT / 'rift-outrage-break-layers.txt'} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
