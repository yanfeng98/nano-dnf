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
  嗜魂封魔斩  effect/bloodyrave#.img  (start-dodge 血球 / particle 漩涡 /
              finish-dodge+scrach+lslash-dodge 金叉 —— 2026-10-04 前错记成「血气爆发」)
  怒气爆发    effect/blast-back.img
  嗜血        effect/bloodsnatch/bloodwave.img
  抓头        effect/pinchhpregen.img
  血魔        effect/bloodevil/bloodevil_stand_dungeon_effect.img
  崩山裂地斩  effect/outragebreak#.img  (the move's own pack; the fire-front pair
              this used to name was rejected by the owner)

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

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

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
    ("frenzy", "sprite_character_swordman_effect_frenzy.NPK", "blood-start.img", f"{SLASH}/blood-start.img.js"),
    ("bloodyRave", "sprite_character_swordman_effect_bloodyrave.NPK", "lslash-normal.img", f"{SLASH}/grandwaveblade.img.js"),
    ("rageBurst", "sprite_character_swordman_effect.NPK", "blast-back.img", f"{SLASH}/blast-back.img.js"),
    ("bloodSnatch", "sprite_character_swordman_effect_bloodsnatch.NPK", "bloodwave.img", f"{SLASH}/fullmoon.img.js"),
    ("graspHead", "sprite_character_swordman_effect.NPK", "pinchhpregen.img", f"{SLASH}/pinchhpregen.img.js"),
    ("bloodEvil", "sprite_character_swordman_effect_bloodevil.NPK", "bloodevil_stand_dungeon_effect.img", f"{STEP}/01_sword_dodge.img.js"),
    ("mountainRift", "sprite_character_swordman_effect.NPK", "fire-front.img", f"{SLASH}/fire-front.img.js"),
    # 暴走. The row is the cast's own flash - a burst of 血气 off the client's
    # `frenzy` pack - and that is all it is: the move's real read is the icon over
    # his head and the threads round his body, both drawn live (see
    # drawBerserkCast / drawBerserkThreads in src/render.js). The reference clip
    # draws its flash cyan-white (05_暴走 #63-68) and no client board ships that;
    # the reference is measured, not copied (docs/adr/0005), so the row takes the
    # pack's own blood burst instead.
    ("berserk", "sprite_character_swordman_effect_frenzy.NPK", "blood-start.img", f"{SLASH}/blood-start.img.js")
]

FRAMES = 4
CELL = 128
PADDING = 6
# Where an anchored row's ground line sits in the cell (0 = top, 1 = bottom).
GROUND_LINE = 0.75

# 大蹦 is the one move whose art is drawn far bigger than a 128px cell can hold:
# its gash alone runs ~700 client px across and the fire that comes out of it
# stands three Slayers tall. Baked into the normal grid that was ~120x72 px of
# art stretched over ~470 px of screen - the owner's 「糊」. So the two rows of
# that move get a sheet of their own at RIFT_CELL, where a client pixel keeps
# its detail at the size the screen draws it, and the renderer reads them from
# there (EFFECT.riftRows / EFFECT.riftCell in src/render.js).
RIFT_CELL = 384
RIFT_ROWS = ("mountainRift", "mountainRiftFire", "hellbenterSlam")
RIFT_SHEET = "rift.png"
# How much of a screen pixel one client pixel of that sheet gets, at the size
# the renderer draws it: the number that puts the pack's 445px floor on the
# reference's 265px gash. `size` in src/render.js is `window width * this`.
RIFT_CLIENT_PX = 0.596


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def ref(frame: int, first: int = 22, last: int = 55) -> float:
    """A reference clip's own frame number as the row fraction `pick_frames` wants.

    A staged pick's `from`/`until` are fractions of the row, and `pick_frames`
    turns them into columns with `round(fraction * (length - 1))`. Reading and
    writing those fractions by hand is where this row kept going wrong: a stage
    that was meant to start on the clip's #33 came out on #31, and the fix was
    invisible because the number in the file (`0.29`) says nothing about frames.

    So a row that is **one column per reference frame** writes `ref(n)` and gets
    column `n - first`. That is the property `0008` asks for - *size a layer on
    the frame it actually plays* - made checkable by reading the line.

    Defaults are 十字斩's own cast: `02_十字斩.mp4` #22 is his press and #55 is
    the last frame of the merged qi, so the row is 34 columns and `ref(44)` is
    the third cut (0.6667).
    """
    return (frame - first) / (last - first)

# Moves the owner picked pack by pack (see assets/dnf_effect_picks.md) ship the
# move's real frames instead of a four-frame sample. A row is built from one or
# more client entries:
#   "stack"    - the layers play together (a whole pack, or the two layers of one
#                buff), which is what the owner watched and recognised
#   "sequence" - the layers play one after another (a sword that is then spent)
#   "stages"   - the layers play in windows of one shared timeline (大蹦: the
#                blade falls, the floor splits under it, the rift glows on, the
#                fire comes out in two waves). Each stage names the slice of the
#                row it owns, so a shape can come back later in the move and two
#                shapes can overlap without either one restarting. A stage entry
#                is {"pack", "entry", "from", "until"} plus optional "frames"
#                (which frames of the entry to use), "scale", "board", "offset"
#                "alpha" (draw this stage at part strength - the rift's
#                cracks are dimmed under the lit ring so the quiet part of the
#                move reads as a ring, not as a lake of lava).
#                and "ramp" (recolour the layer through the reference's own
#                measured colour, which is how 大蹦's fire comes out red when
#                every board the pack ships is red-orange or orange).
#                A pick may set "length" (how many cells the row bakes to).
#   "palette"  - which of the pack's colour boards to draw by default. The client
#                ships every shape several times - plain, "(tn)" and "(18)" - and
#                plays whichever board the skill names. 怒气爆发 erupts in
#                white-gold and 崩山裂地斩 in orange, so those two rows bake from
#                the "(tn)" board; a single layer can override it with its own
#                palette in the tuple.
#   "anchor"   - the point in the client's own coordinates that the caster stands
#                on, so the row can be baked with the effect rooted at his feet
#                instead of floating wherever the bounding box happens to sit
#   "core"     - an (inner, outer) radius pair: keep only what is inside `inner`
#                of the art's own centre and ramp the rest away by `outer`. For a
#                radial effect whose picture carries more than the move shows -
#                血球's ball and the lilac ring it does not wear in the reference
#   one layer  - a stack entry may carry, after its name, a scale factor, a
#                colour board of its own, and an (dx, dy) offset: the client
#                sizes and scatters some layers from the skill's animation data,
#                which the export does not carry.
#                Two more sit after the offset, and 血之狂暴's swings are why
#                they exist (docs/adr/0019): the **frames** to take from that
#                entry - a half-open slice `(first, last)`, `(first, None)` for
#                "to the end", or a list of frame numbers when the row wants the
#                fat ones and not the ones between them - and a **ramp**, the
#                same recolouring a stage can name, for a row whose colour is on
#                no board the pack ships (CRESCENT_RAMP). A seventh element
#                scales the layer's own alpha up instead of down (see solidify);
#                the swipe rows are baked with it because the reference draws
#                that brush solid and the pack draws it soft.
#   "*"        - every entry of that pack in the selected colour board
#
# Every DNF effect pack ships the same shapes several times: the plain entry plus
# "(tn)" and "(18)" copies drawn from a different colour board. They are the same
# art at the same coordinates, not extra layers, so a wildcard pick must take one
# board - stacking all three drew every ring and pillar two or three times over.
#
# 崩山裂地斩 is the one row whose colour is not on any of those boards. The
# training-room clip the owner points at (10_崩山裂地斩) draws its fire in deep
# blood red - the flame body measures (183,25,7) with a few white-hot cores, and
# the lava lines in the cracked floor (184,70,52) - while the pack only ships
# (140,2,1) plain red and (255,129,3) orange, and the client's own preview video
# is orange too. So a stage can hand its layer the colour the reference itself
# measures, by ramping the layer's own brightness through these stops: the art's
# shading survives (dull parts stay dark, the hot core still reads white-hot) and
# the mean lands where the reference's does.
# The reference's flame body measures (183,25,7) and its hottest cores are white
# -hot; the pack's own plain board is a flat deep red (140,2,0 mean) with no
# highlight to speak of, and its "(tn)" board is orange. So the fire is drawn
# through this ramp instead: a pixel's own level picks the stop, which keeps the
# dull body dark red and lets the few brightest pixels (the core of a tongue)
# come out white-hot the way the reference's do.
FIRE_RAMP = [
    (0.00, (45, 2, 1)),
    (0.32, (150, 12, 5)),
    (0.62, (198, 32, 12)),
    (0.86, (250, 88, 48)),
    (1.00, (255, 225, 195)),
]
# The lit seams that run through the broken floor. The reference draws them
# (184,70,52) - brighter and pinker than the rock around them - so the seam
# field is ramped too, while the dark rock field itself keeps the pack's own
# grey.
#
# The first cuts of this ramp were too timid, and the two dozen thin lines the
# pack calls "the cracks spreading along the ground" came out a dull brown: the
# whole lull in the reference is a *lit* field, and ours read as bare floor.
# Measured over the ground band of 10_崩山裂地斩 #73 (its quiet stretch), the
# reference's floor averages (117,49,38) with 41% of its lit pixels at a bright
# red; through this ramp the same band in ours lands at (121,60,43) / 37%.
FLOOR_RAMP = [
    (0.00, (70, 14, 8)),
    (0.30, (170, 50, 24)),
    (0.60, (240, 110, 60)),
    (1.00, (255, 215, 180)),
]
# The rock the floor is made of, lifted off the pack's own near-black. The
# reference's plate field is plainly brighter than the room behind it, and the
# pack's copy (mean 57,48,44) is not: drawn as exported it disappears into the
# arena's own dark floor. This is a ramp on the *pack's* art, not new art - it
# keeps the plates and their speckle and only opens the levels up. The plate
# points of the reference's own ground band measure (99,95,89) - it is a plain
# grey, not a warm one - and these stops put the pack's plates at (108,99,89).
ROCK_RAMP = [
    (0.00, (84, 78, 72)),
    (0.40, (126, 116, 104)),
    (1.00, (198, 186, 166)),
]
# The body of the blood the flames stand in - the glow's soft disc, used as
# light rather than as a flame. It deliberately **never gets bright**: through
# FIRE_RAMP the disc's own hot centre comes out white-hot and a few of them
# washed the whole eruption into one pale blob. What the reference has behind its
# tongues is a large dark-crimson mass, so this ramp stops at (170,32,20) and a
# filled disc reads as depth rather than as another flame.
BODY_RAMP = [
    (0.00, (28, 2, 2)),
    (0.45, (96, 11, 7)),
    (1.00, (170, 32, 20)),
]
# 血之狂暴's crescent, and this is the third time a row has needed a ramp for the
# same reason (大蹦's fire, 怒气爆发's blood): **the pack ships no board in the
# colour the reference draws.** The stance's swings come out of its own pack
# (rage/attack01-03, see docs/adr/0019) and that art is red, then gold - the red
# pass measures (166,0,0) and the gold one (184,126,87) at its very best. The
# reference's crescent is neither: sampled off the owner's contact sheet, over
# the three clearest panels (d037/d040/d066) and with his own body masked out,
# **66% of its mass is (242,241,181)** and what runs through it is olive - not
# red. Binned by each pixel's brightest channel:
#
#   level   70-119    120-159   160-189   190-214   215-234   235-255
#   mean  (91,75,55) (138,130,109) (174,169,144) (200,198,179) (224,222,181) (242,241,181)
#   share    11%        6%         5%         8%         5%         66%
#
# So the row is ramped through the reference's own numbers, exactly the way the
# fire is: the art's shading survives (its dull rim stays dark, its core lands
# on the reference's ivory) and every pixel's three channels come off one stop,
# which is what keeps the mass *neutral* - a per-channel tint would leave the
# red board's blue at zero and make a red crescent all over again.
#
# The stops are placed by the **art's own percentiles**, not by its levels: the
# two distributions are not the same shape (the reference is 66% ivory and
# almost nothing between, the pack's brush is a long gradient), so a ramp that
# put "level 0.9" on ivory left ours mid-grey and translucent. Read off the
# three swings' own ink - p5 40, p11 56, p20 80, p30 104, p50 160, p70 224 - and
# laid on the reference's bins:
#
#   art p5-11 (56)  -> (91,75,55)     the olive the reference's streaks measure
#   art p20   (80)  -> (150,140,112)
#   art p30   (104) -> (200,198,175)
#   art p50   (160) -> (242,241,181)  two thirds of the reference's mass
#   art p70+  (224) -> (248,247,190)
# **嗜魂封魔斩's vortex and the fog at his hand, in the reference's own red.**
# The pack's `particle.img` is a deep saturated crimson; the training-room clip's
# strands are a *lighter, more orange* red at every brightness. Measured per
# level (the pixel's own max channel) over the two:
#
#   level      0.20-0.35  0.35-0.50  0.50-0.65  0.65-0.80  0.80-0.90  0.90-1.0
#   参考       (74, 6, 3) (108,12, 7) (146,22,14) (184,37,23) (217,48,30) (244,60,36)
#   particle   (68, 1, 1) (108, 2, 3) (146, 4, 5) (185, 7, 8) (217,13,14) (247,29,30)
#
# The **red channel is the same ramp** (74/68, 108/108, 146/146, 184/185, 217/217,
# 244/247); what differs is green and blue - the reference's red is coral where
# the pack's is pure. The owner: 「我感觉色彩不对」.
VORTEX_RAMP = [
    (0.00, (26, 2, 1)),
    (0.20, (74, 6, 3)),
    (0.35, (108, 12, 7)),
    (0.50, (146, 22, 14)),
    (0.65, (184, 37, 23)),
    (0.80, (217, 48, 30)),
    (0.90, (244, 60, 36)),
    (1.00, (252, 68, 42)),
]
# 魔狱血刹's sword, gone white. The reference turns the *same* serrated blade
# white for the last seconds of the state (11_魔狱血刹 B 2:36.4), so this is the
# red art through a luminance ramp rather than a second drawing: the stop at 0
# keeps the guard and the outline dark, and everything bright - the blade, the
# edges the reference's own white sword shows off - comes out near white.
# 魔狱血刹's 火山, measured off the reference's own eruption rather than taken
# from the pack. The pack's lava is a muted brown-ochre - built, it read as wood
# - and the owner sent it back (「还是差很多」). Bucketing the clip's pixels by
# their own brightness (the column at 11_魔狱血刹 #7.5s, 376k pixels of it) gives
# this table directly, and the number that matters is the last line: **60% of the
# reference's eruption is at (248, 215, 30)** - a saturated yellow, not a brown.
LAVA_RAMP = [
    (0.000, (34, 22, 6)),
    (0.235, (74, 62, 13)),
    (0.353, (105, 82, 21)),
    (0.470, (135, 105, 27)),
    (0.588, (164, 125, 32)),
    (0.706, (194, 150, 37)),
    (0.824, (223, 170, 34)),
    (0.922, (248, 215, 30)),
    (1.000, (255, 236, 70)),
]
# 魔狱血刹's 火山: the column's colour, read straight off the reference.
#
# The pack's `new11` is the right *shape* (see PICKS.hellbenterSlam) and the
# wrong colour. Its own art is a red-orange ramp - measured over its opaque
# pixels, `G/R` runs 0.23 / 0.25 / 0.26 / 0.27 / 0.29 / 0.33 through the
# levels - where the reference's column is a **gold** one, `G/R` 0.60-0.68.
# Painted as exported, our column measured (207,128,8) against the reference's
# (234,165,23) inside the same band.
#
# So this is the reference's own curve, binned the way `tint` reads: `11_魔狱血刹`
# #250, inside the column's footprint (video x 380-880, y 250-700), pixels
# bucketed by their brightest channel.
#
# The green is taken down about a tenth from that raw table (painted at the
# reference's own numbers the column came out `G/R` **0.81** against its
# **0.76**), and then **the whole ramp is lifted**.
#
# That second part is the one that reads as "和参考不一样". The raw table above
# is the reference's *colour* at each level - and the reference simply does not
# spend many pixels down there: **66% of its column sits at level 240+** with a
# mean of (250,197,30), one big blown-out mass, where `new11`'s own art keeps
# about 40% of itself in dark veins and ours measured **7%**. Matching the hue
# while leaving two fifths of the column dark is what produced a gold slab with
# brown stripes. Lifting the low stops is what turns it into the bright mass the
# rocks float in; `EFFECT.draw.hellbenterSlam.glowBlur` (bloom) is the other half.
#
# **Note what is deliberately *not* here: a `level` (gamma).** `LAVA_RAMP` with
# `level: 0.4` was tried first and is what reads as "木纹": bending the level
# before the ramp pushes two thirds of the art - which is in shadow - into the
# ramp's bright end, and the dark veins that make the column read as fire come
# back as pale gold stripes. The ramp alone keeps them dark.
# **And the top of it is too pale, which is the same measurement seen from the
# other end.** Bucketing both columns by their *brightest channel* over the same
# footprint (`ref/t8.333.png` x348-922 y80-820 against the baked cell), the
# brightness curve is already right - lvl>=200 is 71.0% for us and 70.5% for the
# reference, lvl>=240 is 53.8% against 59.7% - and the green is right too
# (G/R 0.80 against 0.79). **The blue is what is left**: 48/61/73 ours against
# 23/27/29 the reference's, so our column reads as a pale gold slab where the
# reference's is a saturated one. The three upper stops lose about half their
# blue, which is where the 73 at lvl>=240 comes from.
VOLCANO_RAMP = [
    (0.000, (96, 32, 6)),
    (0.150, (170, 84, 12)),
    (0.320, (222, 140, 18)),
    (0.500, (246, 180, 24)),
    (0.700, (250, 196, 26)),
    (0.880, (253, 208, 32)),
    (1.000, (255, 220, 46)),
]
WHITE_RAMP = [
    (0.00, (26, 26, 34)),
    (0.22, (96, 100, 116)),
    (0.45, (168, 176, 196)),
    (0.70, (226, 232, 246)),
    (1.00, (255, 255, 255)),
]
# **裂盘的石头。** `split-n1`'s own board is a pale pink (its first frame measures
# (209,170,168) flat across the plate), which on our dark floor reads as a pink
# speckled rug rather than as rock. The reference's stone measures (95,78,72) in
# its shade and about (150,124,112) where the fire is on it, and it is the same
# grey-brown the rest of 崩山裂地斩's rubble uses - so this walks the pack's own
# luminance onto that, dark end first.
STONE_RAMP = [
    (0.00, (34, 24, 22)),
    (0.30, (74, 58, 54)),
    (0.60, (112, 92, 84)),
    (0.85, (146, 124, 112)),
    (1.00, (176, 152, 138)),
]
# 魔狱血刹's 血丝. The pack's `new13` is the right *shape* - a long thin thread -
# and the wrong colour: it ships on the pack's plain board, which is the orange
# its other `new*` entries use, and the reference's strands are red (「细红丝」,
# measured off `BV1U1v6B2EWt` at 2:01.9-2:03.5). So the thread keeps its own
# brightness and takes this ramp's colour, the way the vortex does.
STRAND_RAMP = [
    (0.00, (34, 2, 2)),
    (0.25, (118, 10, 7)),
    (0.50, (176, 26, 16)),
    (0.75, (226, 46, 30)),
    (1.00, (252, 84, 60)),
]
# 魔狱血刹's 血气之剑: **how tall the sword is drawn at each 铸剑 tier**, in client
# pixels **of `sword-normal` frame 0** - the one frame whose *shape* is the
# reference's (see the bake's note on PICKS.hellbenterSword).
#
# The reference measures 0.92-0.96 身位 while he holds it and 1.20-1.36 once it is
# white; frame 0 is 97 client px = 0.69 身位 at 1:1, so the ladder is that frame
# drawn at 1.33 -> 1.98 of its own size. One cell per tier, so this list and
# `Core.HELLBENTER.tiers` have to have the same length; a test pins that.
SWORD_TIERS = (129, 138, 147, 156, 165, 174, 182, 192)

# **血气汲取满了的那一把，是金的。** 业主 2026-10-07 指着参考里那把剑说
# 「血气汲取满了，剑应该变成这样」——参考里那把是**暗色刃身镶一道金边**，不是红的。
# 客户端里有这条线索：`sword-dodge` 的最后一帧（f9）就是一把**纯金的刃**，同一个包里，
# 同一个技能自己的金色版本。所以金剑不是新画的一张，是**同一张抠图过一道金 ramp**。
SWORD_GOLD_RAMP = [
    (0.00, (46, 24, 3)),
    (0.30, (128, 82, 10)),
    (0.55, (196, 146, 20)),
    (0.78, (238, 196, 44)),
    (1.00, (255, 238, 150)),
]

# 血气之剑's colour. The sword's own frame is a **faint outline** (it ships unlit),
# so the ramp is what makes it the red sword the reference shows - dark at the
# hilt end, bright along the blade.
BLADE_RAMP = [
    (0.00, (152, 22, 14)),
    (0.45, (198, 32, 20)),
    (0.75, (226, 48, 30)),
    (1.00, (250, 84, 56)),
]
CRESCENT_RAMP = [
    (0.00, (16, 12, 8)),
    (0.16, (91, 75, 55)),
    (0.31, (150, 140, 112)),
    (0.41, (200, 198, 175)),
    (0.55, (230, 229, 182)),
    (0.63, (242, 241, 181)),
    (1.00, (248, 247, 190)),
]
# **Do not add a correction for the arena.** The built frame reads about a fifth
# under these stops near the edge of the screen, and that is `drawVignette`: it
# lays up to rgba(0,0,0,0.55) over everything away from the arena's middle, so
# the character's own corner costs the brush a third of its brightness. The
# reference is a training room with a black floor and no vignette at all. A ×1.22
# was tried on these stops to make up for it and taken back out - the row is the
# reference's colour, and the difference between the picture and the reference is
# the arena's, which is `0008`'s lesson read from the other end: measure the
# baked cell, not the screenshot.

# 怒气爆发's blood, and the ramp exists because the pack's own plain board is a
# flat deep red with no highlight to speak of: drawn as exported its ring comes
# out (111,6,2) and its column (167,15,6) against the clip's (204,26,5) and
# (200,39,1) - about half as bright, and flat.
#
# The stops are the clip's own numbers read back through a pixel's level (see
# tint), and the two that matter are the levels the two acts actually sit at:
#
#   水平 0.37  the ring's lit pixels   -> (194,25,4)   clip #43 (204,26,5)
#   水平 0.87  the column's            -> (204,40,2)   clip #70 (200,39,1)
#   水平 0.98  the column's hot tail   -> (248,62,12)  clip p90 (254,61,12)
#
# Note what that says about the reference: its ring and its column sit at *the
# same* brightness, and all of the column's extra punch is in the tail. So this
# ramp is close to flat between 0.4 and 0.9 rather than a diagonal - a diagonal
# made the column come out (252,86,29), washed orange, where the clip is
# saturated red with blue at 1.
#
# The top is vermilion, not the white-hot FIRE_RAMP ends on: the clip's column
# core measures (255,61,1), fully saturated, with no white in it at all.
BURST_RAMP = [
    (0.00, (44, 3, 1)),
    (0.25, (150, 16, 2)),
    (0.40, (206, 27, 4)),
    (0.62, (198, 34, 2)),
    (0.88, (204, 40, 2)),
    (1.00, (255, 66, 14)),
]

# How 嗜魂之手's spray was measured off E01 #49-#56, kept because it is the ruler
# its size and place come from, and because the ramp that came out of it is what
# `blood.img` does *not* need. His own body box masked out of the sample, binned
# by each pixel's brightest channel:
#
#   level    64-95   96-127  128-159  160-191  192-223  224-255
#   mean   (89,16,11) (113,30,25) (144,41,34) (176,53,42) (208,67,46) (247,78,40)
#   share     3.7%     12.2%     17.5%     14.0%     14.8%     37.7%
#
# So the reference is a *bright* saturated blood red - over half of it sits above
# level 192 - and it is 2.45 x 1.63 Slayer-heights centred 53 client px in front
# of him (the 520px bounding box the row was first built to was the clipped one;
# the burst runs off the left edge of the screen in every frame). The row shipped
# a red ramp derived from those bins for a while, against a pack layer whose own
# board tops out around 156; `blood.img` carries the gold rim on its own board,
# so the ramp is gone and this table is what is left of it.

PICKS = {
    "upSlash": {"stack": [("", "upperslash.img")]},
    # 崩山击: the client preview lands the smash on an orange fire column with a
    # blue-white flash through it and the ground spitting red spikes, and the
    # pack splits exactly that way - d-end is the column and the flash, and
    # b_bottom_01 is the spikes spreading around the impact. The row used to be
    # the spikes alone, which is why the landing read as a ground tick with no
    # impact; both entries are 6 frames, so the row stays 6.
    #
    # The spikes are the "_n" entry, not the "_d" one. The pack ships both under
    # the same name with a different board: "_d" is a dark red (mean 149,1,0
    # over its opaque pixels) and "_n" a bright red-orange (232,40,0). The
    # training-room clip's spikes measure 229,59,14 - the "_n" board - so the
    # row was landing on the dark copy and reading as maroon (owner: 「技能特效
    # 颜色不对」).
    #
    # The two entries do not share a coordinate space in the pack - the game
    # places each one from the skill's animation data, which an export does not
    # carry - and the spikes are not a floor plate but a fan: every wedge points
    # back at one point, about (214, 102) in their own frames. That is the
    # impact, so it is what goes on the column's foot (dx -135, dy +140); the
    # older offset dropped the fan's *bottom edge* on the column's base instead,
    # which stood the whole fan a body height too high (owner: 「技能特效好像
    # 位置有点高」). The anchor is the column's own foot centre, so the impact
    # lands on the caster's feet rather than wherever the bounding box sits.
    #
    # The three parts are staged, not stacked, because they are not the same
    # size in the reference. Measured off 01 崩山击 (clip px / 2.67 = arena px):
    # the spike fan is ~230x107, the fire column ~150 tall, and the white-blue
    # flash that crosses it only ~100 wide. In the pack they arrive at 306, 140
    # and 169 wide respectively, so the column is grown 1.4x, the spikes 1.2x
    # and the flash left alone; stacked with one scale for the lot, growing the
    # column to its own height blew the flash up to nearly twice the clip's.
    #
    # Each stage also has its own window, which is the reference's order rather
    # than one flat row: the column is up before he lands (#34-41, touchdown is
    # #41), the flash crosses it on the way down, and the spikes open with the
    # landing and stay to the end.
    # 崩山击's fire column, measured against its own reference (01_崩山击.mp4,
    # the frame the column peaks at) after both sides were put in Slayer-heights:
    # the reference's column is **1.06 x 1.51**, ours was **1.08 x 0.86** - the
    # right width and two thirds of the height, so the move read as a burst
    # rather than a column. `stretch` is what the pack cannot say, and finding
    # the pair took three passes: the row's ink window is derived from the art,
    # so the drawn size is a *ratio* of the two axes rather than of either one -
    # widening the column alone shrank it, and the pair has to move together.
    # (1.36, 1.66) landed at 1.06 x 1.56 - and those are the numbers to hold,
    # because they are the pair the column was signed off at. The pair below is
    # the same shape one row-width smaller: see the note under it.
    #
    # The later frames are *not* stretched: they are the low ground fire the
    # column dies back into, which the reference keeps wide and short (measured
    # 1.11 x 0.79 there), and the test pins that they keep the pack's own size.
    #
    # **The spike fan's width is set by the row's `size`, not by its own scale.**
    # The fan is the widest thing in this row, so it is what the ink window is
    # measured across - every client pixel of fan it gains, the window gains too,
    # and `fit_scale` hands the gain straight back. Measured: taking the fan's
    # scale from 1.2 to 1.6 (a third more art) moved its cell from 109 to 116 px,
    # while the column lost a fifth of its own size to the shrunken fit. What the
    # fan *does* fill is the cell, so its drawn width is (cell - margin) / cell x
    # `size` and nothing else: 264 puts it at the reference's 2.80 Slayer-heights
    # (measured on 01 崩山击's burst frame, x 699..1308 of a 218px Slayer), where
    # 236 had it at 2.39. Raising `size` grows the column with it, so the pair
    # above is the one it was signed off at, scaled by 236/264.
    "mountainBreaker": {"length": 6, "pack": "_hopsmash", "anchor": (79, 242), "stages": [
        {"entry": "d-end.img", "frames": (0, 1), "scale": 1.4, "stretch": (1.15, 1.46), "from": 0.0, "until": 0.30},
        {"entry": "d-end.img", "frames": (2, 5), "from": 0.22, "until": 0.80},
        {"entry": "b_bottom_01_n.img", "scale": 1.2, "offset": (-86, 142),
         "from": 0.20, "until": 1.0},
    ]},
    # 十字斩 is **three cuts on one timeline**, and the pack ships one entry per
    # cut. The row used to be a plain stack of `gorecross_cross.img` alone - the
    # thin red 十 - so two thirds of the move was missing: the owner's clip
    # (assets/dnf_src/bilibili/skill-clips/02_十字斩.mp4) sweeps a **golden arc**
    # through the cut, the blood 十 forms, and only then does the big hatched
    # **blood fan** burst with a thin red line across it. See docs/adr/0007.
    #
    # Measured on that clip with the nameplate as the ruler (`Lv.51 麻子哥` ends
    # at row 508, hair from 514, boots at 731 -> 218 reference px = 84 of ours,
    # the same ratio 崩山击 was measured at):
    #
    #   #26-#31  0.13-0.30s  the horizontal sweep: a wide flat gold arc,
    #                        1.65 x 0.84 Slayer-heights
    #   #32-#35  0.33-0.43s  the vertical cut: a *tall narrow* gold arc, and the
    #                        十 slams in - 0.79 x 2.01, its top at +1.74 of a
    #                        height over his soles and its foot on them
    #   #36-#43  0.47-0.70s  the 十 **settles to 0.79 x 1.33 and hangs there.**
    #                        It does not move: the bar's centre sits on column 631
    #                        for f38 through f43, six frames without a pixel of
    #                        travel, and nothing in the clip ever goes forward but
    #                        the arm.
    #   #44-#53  0.73-1.03s  he drops low: a big gold arc 1.61 x 1.56, the
    #                        hatched fan 1.78 x 1.66, and a thin red line
    #
    # **The 十 does not fly, and it does not end up on him either.** Two things
    # this row used to get wrong, both corrected against the clip:
    #
    # 1. *Travel.* `dnf_effect_picks.md` pushed it forward 46 -> 154px on the
    #    owner's early description 「画十字，然后十字向前攻击」 plus the client's
    #    own GoreCross preview. The clip shows a cross that stands still, so the
    #    `travel` came off `EFFECT.draw.crossSlash` and the bake stopped faking a
    #    push. See `0005` (the clip is the judge) and `0007`'s 补记 + `0008`.
    # 2. *Where it stands.* `0007` measured "cx -0.07 Slayer-heights, on his
    #    midline" and put the ink on top of him. Re-measured, its bar is at x 631
    #    against his body's midline at 772, so it stands **0.65 of a height in
    #    front of him** - in front, not through. The old number was wrong, and so
    #    was the first correction of it: see the next paragraph.
    #
    # **The clip's character faces LEFT; ours faces right.** That is the whole of
    # `mirror` and it is why this row is the one row in the repo that turns its
    # art round. `02_十字斩.mp4` shows the client drawing a left-facing caster,
    # and the client mirrors the sprite *and every effect layer together* about
    # the point he stands on; our sheet is the pack's art unmirrored, so it faces
    # right. Measuring the clip's screen x and typing it straight into an `offset`
    # therefore puts each layer on the wrong side of him by twice its distance -
    # "0.65 of a height behind him" above is that error written down as if it were
    # a reading. A row that names `"mirror": True` is flipped once, about his own
    # axis, after every other transform; the numbers in `stages` stay the clip's
    # own numbers and `mirror_layer` is the single line that says which way the
    # clip's caster was looking. See `docs/adr/0011`.
    #
    # `gorecross_slash.img` is the key to the first two cuts: its nine frames are
    # **two** arcs, not one - f1-f4 is the wide flat sweep and f5-f8 the tall
    # narrow one, which is why one entry covers both. The third cut's arc comes
    # from `gorecross_3slash_dodge.img`, the only big fat crescent in the pack.
    # Each layer's `scale`/`stretch` and `offset` put the pack's own art where the
    # clip draws it, in his Slayer-heights about his soles. Measured off
    # 02_十字斩.mp4 with the nameplate as the ruler and **the top of the window
    # opened past his head** - a first pass measured into a window that started at
    # row 400 and so clipped every tall shape: the 十 is 1.99 high, not 1.76, and
    # its top reaches +1.74 of a height over his soles.
    #
    #   the 十     0.79 x 1.33  **0.65 behind him**, its foot on his soles
    #                          (2.01 with the slam, 0.79 wide throughout)
    #   arc 1      1.65 x 0.73  0.43 in front of him,   +1.05 over / 0.32 over
    #   arc 2      0.82 x 1.90  on him,                 +1.70 over / 0.20 under
    #   arc 3      1.61 x 1.48  0.21 behind him,        +1.32 over / 0.24 under
    #   the fan    1.78 x 1.66  0.30 behind him,        +1.42 over / 0.24 under
    #   the line   1.95 x 1.35  0.35 behind him
    #   `clip` / `firstFrame` are what `assets/measure_row_against_clip.py` reads:
    #   column `c` of this row is frame `#(firstFrame + c)` of that clip, so the
    #   two rulers can be laid on top of each other without anyone re-deriving
    #   the offset by hand. They live here rather than in the tool because the
    #   row is the thing that knows what it was cut from.
    "crossSlash": {"pack": "_gorecross", "length": 34, "mirror": True,
                  "clip": "02_十字斩", "firstFrame": 22,
                  # The window is this row's ruler (`0008`): it must contain
                  # every layer's ink or the bake clips it - `mirror_layer`
                  # negates the placement, so where the old x -200..140 held the
                  # whole move on his back, the mirrored one needs the box on
                  # the other side. Measured ink box after the flip is
                  # (-157, -146, 73, 31), so this window takes all of it and no
                  # more: span 240 x 220, `fit_scale` 0.5, `size` 256.
                  #
                  # **The row is now 34 columns and column `c` is the clip's own
                  # frame #(22 + c)** (`length` 32 -> 34 on 2026-09-27, when the
                  # cast turned out to run #22-#55: he is still shrinking on #54,
                  # and the old 32-column row stopped at #53). Every stage below
                  # is therefore written as `ref(...)` - see `ref()` - so its
                  # numbers can be read straight against the clip instead of
                  # against a fraction nobody can check.
                  #
                  # The window grew with the third act: it now flies 0.73 of a
                  # height forward, so the front edge had to move out past 240.
                  # Measured off the finished row (`pick_frames` with this spec):
                  # the ink is x -107..256, y -141..119, so this window is that
                  # box plus 8px of margin on the width side. Span 380 x 288 ->
                  # `fit_scale` 0.31579 -> `size` 405, and the renderer's
                  # `dx`/`dy` are the window's own centre (75, -12) - see
                  # `EFFECT.draw.crossSlash`.
                  "window": (-115, -180, 265, 132), "stages": [
        # **这一行的窗口就是尺子，1:1。** `window` 的跨度 = 参考上量到的框，`size` 取
        # `128 / fit_scale` 之后 k = fit * size / 128 = 1，即**一个客户端像素 = 一个屏幕
        # 像素**，而屏幕像素也正是参考那把尺（1 身位 = 84）。所以下面每一个 `stretch`/
        # `offset` 都可以直接拿去和 `02_十字斩.mp4` 上的框对照，不用再乘一个系数——
        # 上一版的窗口是 368 客户端px 摊进 128 的格子，k = 0.693，整招被画成参考的 69%，
        # 于是每一层都得反着放大 1.44 倍去找补，数是越改越不可读的。
        # 各层由 /tmp/xz/fit2.py 逐层解出来（一层一层单独合成、单独量），量法见 `0008`。
        #
        # The sweep's arc grows into place and only then dies: the clip's gold is
        # 0.61 x 0.13 Slayer-heights on #26 and 1.71 x 0.71 by #29, so it is held
        # on the art's one bright frame (f1 - f2-f4 have already lost their gold)
        # at two sizes rather than run through art frames that fade where the clip
        # is still climbing.
        {"entry": "gorecross_slash.img", "frames": (1, 4), "scale": 0.327, "stretch": (0.6156, 0.661),
         "offset": (-160, -202), "from": ref(26), "until": ref(28)},
        # **横扫是走过去的，不只是长大。** 参考里那道弧的框 #26 x −102..−15 → #28 x −65..+67
        # → #30 x −18..+80：重心从 −58 挪到 −2，宽从 87 长到 155 再 168。上一版只有两档、
        # 两档的框都在原地，所以它读起来是"亮了一下"而不是"扫过去"。三档各自的横位由
        # /tmp/xz/fit6.py 解出来。
        {"entry": "gorecross_slash.img", "frames": (1, 4), "scale": 0.683, "stretch": (0.5036, 0.919),
         "offset": (-167.5, -177), "from": ref(28), "until": ref(30)},
        # 到 col9 才收：参考 #30 与 #31 的红是同一个 147x42，到 #32 才缩。早收一格
        # 会在那一格上留出一段空白（合成 85x34 对参考 147x42）。**但金弧比红早收一格**：
        # 参考的金在 #30/#31 是 515/519、到 #32 就只剩 70（几乎没了），所以这一档只到 col9。
        {"entry": "gorecross_slash.img", "frames": (1, 4), "scale": 0.732, "stretch": (0.5418, 0.7883),
         "offset": (-168, -176), "from": ref(30), "until": ref(32)},
        # 十 是**两拍**，不是一拍：竖条甩上去（#36 量到 97 x 165，他脚下往上 1.16 身位）、
        # 再收回它该在的大小（#38 起 97 x 129）。收的那一下**在原地**：竖条重心 #38→#43
        # 六帧全落在 631 那一列。
        #
        # **它从 0.29 才开始**（#31 那一拍），不是从第一格：参考里横扫那两拍（#26-#32）
        # 画面上**只有那道金弧**，十要到 #33 才成形——早开一格，横扫还没走完就先冒出一个
        # 红十，横扫那道框也因此量歪（118x43 对参考的 87x28）。
        # **那 0.25 身位撤掉了**（2026-09-28，第二十三节）。它是**业主指定**、与量到的数
        # 不符的一条：参考里十钉死（竖杠峰值列 #38→#44 全是 632-633，左缘 554 七帧不动），
        # 而 2026-09-27 按「业主说参考的往前移了」把它摊成了整拍匀速前移 21px。
        # 撤它的依据不是"业主改主意了"，是**同一把尺量出来的两个数**：
        # 撤掉之后十对参考的 IoU 从 0.082 回到 0.417（对照口径见第二十二节），
        # 而 2026-09-28 重量的落位是：我们的十**前缘在身前 26px、参考在 8.6px**，
        # 而且**每播一列自己往前走 1.5px**（col16→21 量到 +19.6 → +28.6），
        # 参考七列一动不动。也就是说这条"指定"在屏幕上做出来的正是业主后来说的「差距」。
        {"entry": "gorecross_cross.img", "frames": (0, 6), "scale": 0.825, "stretch": (0.9878, 1.202),
         "offset": (-280, -203.8), "from": ref(33), "until": ref(36)},
        # 定下来之后它一直这么大：1.15 x 1.54 身位，**在他身前**（翻了，见 `0011`），
        # **到 0.71 就走了**——参考里 #46 起那一拍只剩那道金弧和细线。
        #
        # **定格必须用干净的那一帧，不能用 f10。** `gorecross_cross.img` 11 帧的形状是
        # f0-f4 一横长出来、**f5-f9 一个干净的「十」**、f10 **歪掉/化掉**——f10 的竖条
        # 顶上向左钩出去、整条斜着。业主 2026-09-27 说「「十」的形状反了」，屏幕上看到的
        # 就是这个 f10：不是镜像反了，是**定格定在了化掉的那一帧**。改 f7（f5-f9 同形，
        # 取中间那一帧）。**f10 的框比 f7 小一圈**（117x166 对 128x178），所以 `stretch`
        # 要跟着收：原来的 (1.0318, 0.9298) 是按 f10 解的，换 f7 之后同样的乘积仍是
        # 132 x 165——框没动，只是形状对了。
        # 这一拍原来还要"接上甩上去那一拍没走完的那 0.25 身位"：`offset` 补 7.64px、
        # 余下 13.36px 由 `travel` 摊到 #44。**两段一起撤了**（见上一段的注释）。
        # 撤掉 `travel` 之后位置由 `offset` 一处定：`offset` 加 (+17.6, -9.1)，
        # 就是把这一层从"身前 26..97、离地 102"搬到参考的"身前 8.6..75.2、离地 111.4"。
        # 这两个数是 `assets/measure_row_against_clip.py crossSlash --per-stage` 量出来的，
        # 不是试出来的：composed 的墨是 `offset` 的纯平移（`mirror_layer` 把 x 取反，
        # 所以两个轴都一一对应），一次就到位。
        {"entry": "gorecross_cross.img", "frames": (7, 9), "scale": 0.886, "stretch": (0.672, 0.708),
         "offset": (-279.0, -235.1), "from": ref(37), "until": ref(44)},
        # **只用最亮那一帧，分两档。** 包里的 f5→f6 宽度是 **54 → 17**，一刀砍掉三分之二；
        # 参考是 **#34 68 → #36 61 → #38 24**，先慢慢缩、最后才收。**播 f6/f7 就等于把
        # 参考的"慢慢缩"演成"一刀断"**，所以这两帧不用了：定住 f5，靠两档大小演它。
        # 起手也要对：原来从 col10 起，而参考 #32 那一刻画面上几乎什么都没有
        # （金弧 #33-#34 才起来），所以推到 **0.355 = col11 = 参考 #33** —— 它最宽的那两格。
        # **改这一行之前先量素材每一帧的宽度差多少**：这一行的列宽是三倍一档的。
        #
        # **两档的窗口都不许越过 col14。** 参考的白热金弧到 **#36 就没了**：#37/#38 的画面上
        # 只剩那个红「十」和他自己那把橙色的剑 —— 金掩膜在 #37/#38 读到的 48/49 像素就在
        # x 746-798，那是**他的剑**，上一版把它当成弧的尾巴、于是金一直拖到 col17，
        # 翻过来之后在屏幕上是「十都钉住了还有一道金在扫」。看一帧就知道：#35/#36 的金
        # 只剩头顶一个钩，#37 干净。
        {"entry": "gorecross_slash.img", "frames": (5, 8), "scale": 1.976, "stretch": (0.5733, 0.3254),
         "offset": (-203, -242), "from": ref(33), "until": ref(34)},
        {"entry": "gorecross_slash.img", "frames": (5, 8), "scale": 2.84, "stretch": (0.2051, 0.1746),
         "offset": (-211, -308), "from": ref(34), "until": ref(36)},
        # 第三刀的金弧，和血扇同一拍起（参考 #44 两样同时出现）。
        #
        # **只放它最亮的那一帧。** `gorecross_3slash_dodge.img` 那四帧**各自带一个不同的
        # 帧位**（x 167 / 195 / 218 / 223），所以照 f0→f3 播过去，那道月牙会自己**往右滑
        # 约 50px** —— 滑到血扇那一拍时它已经落在 x −57..**+52**，也就是**他身前半个身位**，
        # 那正是"绕着他扫的镰"另一半来处（另一半是血扇本身）。参考里这道弧 #44 x −102..16
        # → #48 x −117..14，是**往回**走一点，没有前滑。所以这里定住一帧、位置解到 #48 的
        # 金弧框上。
        # **取最细的那一帧。** 参考里这道金弧在 #48 是 **453 px 铺在 132x118 上 = 2.9%
        # 的实心度**——细得很。包里四帧的实心度是 f0 20.1% / f1 13.9% / f2 9.5% /
        # f3 **7.0%**，所以取 f3。f0 那一版（20%）在屏幕上读起来是一道**又粗又重的月牙**，
        # 加上血扇那几层就是业主说的「绕着他扫的镰」。
        # **光靠 `stretch` 到不了参考的细度。** 参考 2.9%、包里最细的一帧只有 7%，而
        # 要再细就得只压 x 不压 y —— 那会把框压窄，形状就散了。所以这一层用上了
        # 新加的 `rotate`：**先把它转到 15°，再分轴压**，两个自由度分开，于是框和细度
        # 可以各要各的（现在量到 **2.5%**，参考 2.9%）。`rotate` 的用法与理由见
        # `rotate_layer` 与 `docs/adr/0010`。
        {"entry": "gorecross_3slash_dodge.img", "frames": (3, 3), "scale": 1.054, "stretch": (0.5557, 0.7195),
         "rotate": 15, "offset": (-499, -290), "from": ref(44), "until": ref(45)},
        # **第三拍那一层换过三次素材，前两次都是拿包围盒挑的，两次都挑错。**
        # 先是照参考量到的一束羽丝**画**了一层（`0009`，业主两次说它像「爪」），再是换成
        # `gorecross_3cross.img` f1，理由是「131x141 与参考的 148x138 几乎一比一」。
        # **那个一比一是包围盒的一比一** —— 而这一层是一根斜跨整个方框的细丝，框被它撑到
        # 120x128，于是前二十轮每一次框对照都过了，屏幕上却一直是业主说的「一条红丝带」。
        # 换掉的依据见下面那一层自己的注释与 `assets/dnf_effect_picks.md` 第二十一节。
        # **第三拍那股气是 `_atgorecross/shoot.img` —— 十字斩自己打出去的那一件。**
        #
        # 上一版用的是 `gorecross_3cross.img` f1，理由是「131x141 与参考量到的 148x138 几乎一比一」。
        # **那个一比一是包围盒的一比一，而包围盒区分不了一条斜着走的细带和一只鸟**：这一层是一根
        # 斜跨整个方框的细丝，框被它撑到 120x128，于是前二十轮每一次框对照都过了，屏幕上却一直是
        # 业主说的「一条红丝带」。
        #
        # 换掉的依据不是眼看，是**按剪影找**：把 175 个 `sprite_character_swordman_effect*` 包
        # 每一帧的包围盒归一化掉、再对参考 #46-#50 的红掩膜做 scale+offset 搜索，全客户端最高
        # **`shoot.img` f0/f1，IoU 0.46**；同一把尺量「十」那一拍（业主认过的）是 **0.42**。
        # 也就是说它和对照组是同一档的吻合，而旧的那一层只有 0.15-0.31。
        # 量法与对照写在 `assets/dnf_effect_picks.md` 第二十一节。
        #
        # **两段，不是一段。** 参考里它从 #46 到 #50 几乎不缩（实心体 99x103 → 86x102），
        # 到 #51 才塌（→ 29x51）。包里这 8 帧自己就是「大、大、半、半、小、小、更小、更小」，
        # 一整段匀速播完会缩得太早，所以前 6 列只播 f0-f1、后 6 列播 f2-f7。
        {"pack": "_atgorecross", "entry": "shoot.img", "frames": (0, 1),
         "scale": 0.924, "stretch": (1.55, 0.8904), "about": 0, "offset": (-93.2, -139),
         "travel": (-41.25, -10), "from": ref(44), "until": ref(50)},
        # f4-f5 are **narrower** than f6-f7 (12px against 31), so playing the lot in order
        # makes the qi widen again on its last two columns. The clip's tail only ever gets
        # smaller, so f6-f7 are dropped and the last two columns are f4-f5.
        {"pack": "_atgorecross", "entry": "shoot.img", "frames": (2, 3),
         "scale": 0.924, "stretch": (1.55, 0.8904), "about": 0, "offset": (-108, -109.4),
         "travel": (-38.4, -7), "from": ref(50), "until": ref(52)},
        {"pack": "_atgorecross", "entry": "shoot.img", "frames": (4, 5),
         "scale": 0.924, "stretch": (1.55, 0.8904), "about": 0, "offset": (-124.5, -84),
         "travel": (-8, 5), "from": ref(52), "until": ref(55)},
        # **定住一帧。** `gcm_crossline.img` 的七帧**不是一条线的七个状态，是同一条线
        # 的七个大小**，而且每一帧自带一个不同的帧位：照 f0→f6 播过去，它在屏幕上从
        # 身前 8..128 **一路倒退回 −21..58**（量到每列退 4.9px），而这一拍里参考的每一样
        # 东西都在往前走。倒着走的还不只是难看：它退到 col31 时已经比那团气**更大**，
        # 于是量整行时它把气挤掉、读出一个"身后 79x27"，而参考那一格是身前 107..139。
        # 取 f0 是因为它的横位（身前 8..128）与参考 #52 上量到的细线（身前 7.3..134）对得上。
        # 它还是**斜的**：参考 #52 上那条线从「身前 134、离地 38」拉到「身前 7、离地 121」，
        # 是一条 **33 度**、约 131 客户端px 长的斜线，而包里画的是横的。横的摆在这儿
        # 就是业主最早说的那条红丝带。`stretch` 单独做不到（压细会把长度一起压掉），
        # 所以用 `rotate` 转、再用 `stretch` 压细 —— 两个自由度分开，理由见 `0010`。
        {"entry": "gcm_crossline.img", "frames": (0, 0), "scale": 0.75, "stretch": (0.686, 0.20),
         "rotate": 33, "offset": (-461, -373), "from": ref(44), "until": ref(53)},
    ]},
    # 血气之刃: the blood sword is thrust, then it bursts.
    "bloodSword": {"sequence": [("_bloodsword", "sword_normal.img"), ("_bloodsword", "exp_dodge.img")]},
    # 血之狂暴: the dual-blade glow that rides the normal attack.
    # 血之狂暴's cast, and only its cast: the burst of 血气 the reference opens
    # with (07_血之狂暴 #44-58, the spiked corona). The crescent that rides the
    # swings moved to its own extra row below, and so did the second blade.
    "frenzy": {"stack": [("_frenzy", "blood-start.img")]},
    # 嗜魂封魔斩's own pick is further down, next to 大蹦's, because its row is
    # declared with a `window` and the test that reads 大蹦's two windows counts
    # every `"window":` from 大蹦's block to the end of the file. It used to stand
    # here as `{"stack": [("_bloodyrave", "*")]}` - the whole pack at once, which
    # is the "all of it on screen in the same instant" mistake `0019` names.
    # 怒气爆发 is **two eruptions on one timeline**, a long beat apart, and the
    # pack is built that way: a ring bursts under him and is gone inside a fifth
    # of a second, nothing burns for seven tenths, and then a column of blood
    # comes up over him. Stacking the pack played all of it at once, which is the
    # same reading the owner gave 大蹦 (「这个技能应该是多个技能特效组合的」), so
    # this row is staged like that one.
    #
    # Measured off the training-room clip the owner points at
    # (assets/dnf_src/bilibili/skill-clips/08_怒气爆发.mp4, 97 frames at 30fps,
    # 32.900-36.133s) with his own press at #38:
    #
    #   #42  0.133s  the pool blooms at his feet, small and flat
    #   #43  0.167s  the ring bursts - the clip's brightest frame, 2.17 x 0.85
    #                 Slayer-heights of ground
    #   #49  0.367s  the ring is gone; he settles back to the idle he holds
    #   #69  1.033s  the column: 1.77 Slayer-heights across, 2.99 tall, its base
    #                 pool running 0.31 of a height below his soles
    #   #73  1.167s  the column has lost its footing and goes out
    #
    # So the row is 36 columns over the 1.2s cast, and the two windows sit where
    # the clip puts them. The pack's own frame counts are the clip's: seven ring
    # frames against the clip's seven (#43-#49), and the column's five.
    #
    # **The board is the plain one, and that reverses slices 38/39.** The client's
    # own BloodBlast preview shows a pale-gold plume, and those slices baked "(tn)"
    # to match it. The clip the owner names measures the opposite - saturated red
    # with blue at zero: ring (217,27,4), column (249,58,3) with a (255,61,1) core
    # - and the pack's own preview (assets/dnf_effect_anim/blastblood.mp4) is red
    # as well. 大蹦 sits in exactly this split (orange in its preview, red in its
    # clip, and the repo ships it red), so the clip wins here too. See
    # docs/adr/0006.
    #
    # The pack holds two clusters of layers, and only one of them is the caster:
    # blood / blood_floor_front / blood_floor_back / blood_back / bloodred all
    # sit within +-90px of the ring's middle, while b-01, blood-b, blood-front and
    # blastbloodhit sit 160-270px off to the left. That left cluster is a second,
    # smaller eruption drawn at the *hit* position - the clip has no such thing,
    # and stacking it made the move look like two effects at once, so it stays out.
    #
    # blood-d2 is out for a different reason: it is a fan of pale light shafts the
    # clip does not draw, and this sheet cannot do the additive blend it needs.
    #
    # The anchor is the middle of the pack's own floor ring (blood_floor.img, 251
    # wide at x=219, y=328): that is where the caster stands and where the ring
    # has to meet his feet. Without it the row was centred on its bounding box,
    # which put the eruption column a third of a screen to his left.
    #
    # `window` is declared rather than measured off the art, for 大蹦's reason: it
    # is the zoom, and the renderer's one `size` is `this window x fit_scale`.
    # 324 x 365 client px of window, so a client pixel lands on
    # 0.3288 x size / 128 of a screen pixel, and the ring's 307 client px come out
    # at the clip's 2.17 Slayer-heights.
    "rageBurst": {"palette": "", "pack": "_blastblood", "anchor": (344, 365),
                  "length": 36, "window": (182, -76, 513, 412), "stages": [
        # The pool blooms under him a frame before the burst (#42). The clip draws
        # it 0.70 x 0.32 Slayer-heights, so the pack's 238px ellipse comes down to
        # 0.42 rather than being blown up with everything else.
        {"entry": "blood_floor.img", "ramp": BURST_RAMP, "scale": 0.42,
         "from": 0.10, "until": 0.15},
        # The burst itself (#43-#49), back half first so the front half's flames
        # are not painted over by it. `about` is the caster's own ground point:
        # the two halves' bottoms are 38px apart, so squashing each about its own
        # would draw them apart and the ring would be flat at the front and round
        # at the back. See `rescale`.
        {"entry": "blood_floor_back.img", "ramp": BURST_RAMP, "scale": 0.99,
         "stretch": (1.0, 0.74), "about": 365, "from": 0.13, "until": 0.31},
        {"entry": "blood_floor_front.img", "ramp": BURST_RAMP, "scale": 0.99,
         "stretch": (1.0, 0.74), "about": 365, "from": 0.13, "until": 0.31},
        # ... and what the ring leaves behind. The clip does not go straight from
        # the ring to a clean floor: #49-#58 has a thin red crescent lying in the
        # same patch of floor, thinning out, and it is gone by #60. That is the
        # ring's own last frame - the pack draws the collapse as the crescent it
        # comes down to (blood_floor_front f4-f6 are all thin arcs) - held and
        # dimmed, so it is the same shape arriving at the same place rather than a
        # second effect parked under him.
        {"entry": "blood_floor_back.img", "ramp": BURST_RAMP, "scale": 0.93,
         "stretch": (1.0, 0.66), "about": 365, "frames": (6, 6), "alpha": 0.6,
         "from": 0.31, "until": 0.51},
        {"entry": "blood_floor_front.img", "ramp": BURST_RAMP, "scale": 0.93,
         "stretch": (1.0, 0.66), "about": 365, "frames": (6, 6), "alpha": 0.6,
         "from": 0.31, "until": 0.51},
        # The column (#69-#73): a fat mass of overlapping tongues standing on its
        # own pool, and the pack ships exactly one layer that is that shape -
        # blood-front, the tall 157x300 one. Slice 38 struck it off as one of the
        # four "hit position" layers because its centroid lands 214px to the
        # *left* of the ring's middle, and stacking it then really did read as two
        # effects at once. But that was a complaint about where it sits, not about
        # what it is, and where a layer sits is an `offset`: `blood.img` - the
        # layer this row shipped first - is a thin spiky fountain, and drawn at
        # the clip's size it reads as a firecracker rather than as blood.
        #
        # Two things about this layer that the pick has to work around. Its
        # centroid is 214px left of the ring's middle and its own base sits 17px
        # above the caster's ground line, so the offset is (214, 48) - that is
        # the whole of what slice 38 was objecting to. And **only its first frame
        # is a column**: f0 is the mass, f1 is the same mass with holes opening,
        # and f2-f6 are it shredding apart. So the mass is held (the clip holds
        # its own column for #69-#70, two of its five frames) and the one
        # dispersal frame carries the end, which is the clip's "loses its footing"
        # at #72-#73. Playing the whole entry - the first thing tried - scattered
        # disconnected fragments across the screen.
        #
        # 1.555 about its own base turns f0's 157px of art into the clip's 1.77
        # Slayer-heights across and 2.99 tall, measured 1.80 x 3.15.
        {"entry": "blood-front.img", "ramp": BURST_RAMP, "frames": (0, 0),
         "scale": 1.80, "stretch": (0.79, 0.78), "offset": (214, 48),
         "from": 0.85, "until": 0.93},
        {"entry": "blood-front.img", "ramp": BURST_RAMP, "frames": (1, 1),
         "scale": 1.80, "stretch": (0.79, 0.78), "offset": (214, 48),
         "from": 0.93, "until": 1.0},
    ]},
    "bloodSnatch": {"stack": [("_bloodsnatch", "*")]},
    # 嗜魂之手: the reach grab. Two references again - the *body* is the training
    # room's (skill-clips/04_嗜魂之手.mp4), which fires no VFX at all because
    # there is nothing to grab, and the *effect* is the one the owner pointed at
    # inside the source recording (「1分16秒和1分17秒就是嗜魂之手」, cut as
    # E01_嗜魂之手-实战 = source #26-#56, exactly the cast's 31 frames at 30fps).
    #
    # That makes this row's own frame of reference the *combat* clip, not a
    # training-room one: column `c` is its frame #(26+c), and every number below
    # is a measurement off it. The clip draws him 463px tall, ours is 84 client
    # px, so 1 combat px = 0.1814 client px; his ground point there is the boot
    # centre (858, 899) and he does not move during the move.
    #
    # What the clip shows, frame by frame:
    #
    #   #29-#45  the hold. Nothing but the arm and the chain he wears - the
    #            chain is *his*, it is baked into sm_body0000 with the rest of
    #            the skin, so no layer here draws it.
    #   #40-#48  a pond of pink blood in front of the palm - and it is *not*
    #            this skill's. It is 血之狂暴's heal orb, which pops on a monster
    #            that takes damage; the held target is taking damage right here.
    #   #49-#56  the burst, after the hand has already dropped. **This is the
    #            move's own blood spray** - the owner: 「半个屏幕的大爆就是喷血」.
    #
    # The gold ring (`blood.img` f0, 2954 gold px at (207,139,0)) is *not* in
    # this clip - it is the layer the owner picked for this skill on 2026-09-19,
    # and it is the pack's own "the grab lands" art. It is kept, at the grab,
    # because without it the first fourteen columns draw nothing at all.
    #
    # `anchor` is the korean-pack origin; the offsets are the clip's own screen
    # measurements (身前 is -x here, `mirror` turns them round - see 0011).
    "graspHead": {"palette": "", "pack": "_grabblastblood", "anchor": (0, 0),
                  "clip": "嗜魂之手-实战", "firstFrame": 26, "mirror": True,
                  "length": 31, "window": (-135, -160, 175, 53), "stages": [
        # The grab lands (hit 0, cast 0.1333 = column 4) and this clip does not
        # draw it - the ring is here because the owner picked `blood.img` for
        # this skill himself and it is the pack's own "the grab lands" art.
        # f0 is the gold ring, f1-f2 open it out, f3-f5 are it coming apart;
        # three frames is the impact, the rest is the splash. Sized to the palm
        # rather than to the clip's ball, because the clip has nothing here:
        # 50 client px across, centred on the hand the clip holds out at
        # (682,486) for #29-#45.
        {"entry": "blood.img", "frames": (0, 2), "scale": 0.119,
         "offset": (-138.5, -302.5), "from": 0.129, "until": 0.226},
        # **吸住**: a starburst of thin red spikes on the *held target*, from the
        # hand arriving to the spray. The owner's read of the move is
        # 「将怪物吸住，然后喷血」 and this is the first half of it - he picked this
        # entry by name on 2026-09-30 after I could not separate "the monster" from
        # "the red on the monster" in the reference video (the berserker is red all
        # over in it - 血之狂暴, which by 0003/0004 is the stance's red, not this
        # move's).
        #
        # It sits on the target, not on his palm: Core pulls a grabbed enemy to
        # `player.x + facing * 30`, so the centre is 身前 30 client px, and it is
        # 90 px across because the enemies are 56-96 px tall (grunt 58, brute 70).
        # Those two numbers are the *mechanic's*, not the clip's - the clip's own
        # red there is a different skill's and cannot size this.
        {"entry": "blood-dodge.img", "frames": (0, 15), "scale": 0.481,
         "offset": (-185.0, -190.0), "from": 0.19, "until": 0.742},
        # **The burst (#49-#56) is the move's own blood spray** - the owner:
        # 「半个屏幕的大爆就是喷血」. It is the only thing in either reference
        # that is this skill's: the pond of pink blood that floats in front of
        # the palm across #40-#48 is 血之狂暴's heal orb (it pops when the *held*
        # target takes damage - `dnf_effect_picks.md` has it as
        # `frenzy/blood-stone-0.img`「怪物身上吸的血球」), and the training-room
        # clip has no target to hit, so it fires no VFX at all. So the hold
        # columns draw nothing, and that is a measurement, not an omission.
        #
        # **And it is `blood.img`, not a fireball.** Three rounds of this row
        # drew the pack's bright fluid burst here and the owner kept saying
        # 「喷血不对」; the entry he named in the end is the one that is a red maw
        # opening and then coming apart into blood - which is the move: 吸住,
        # then 喷血. It is the *same entry* as the impact ring above, at the far
        # end of the cast and four times the size.
        #
        # Sized and placed off the clip's own burst, and the first number this
        # had was wrong: 520px was the *clipped* bounding box (the burst runs off
        # the left edge of the screen at x=0 in every frame of it). Masked out of
        # the frame his body sits in, it is 2.45 Slayer-heights across and 1.63
        # up, centred 53 client px in front of him and reaching the ground - so
        # 0.840 with y squashed to 0.678. The mask picture is in
        # assets/dnf_src/bilibili/skill-clips/graspHead-spray-mask.png.
        #
        # **No ramp on this one**, unlike the burst it replaces: the reference's
        # spray measures a bright blood red (37.7% of its pixels above level 192,
        # top bin (247,78,40)) so a ramp was right for a dull layer, but this
        # entry already carries the gold rim on its own board and a red ramp eats
        # it. 大红+金爆 is what the reference draws, and what this entry is.
        {"entry": "blood.img", "frames": (0, 5), "scale": 0.840,
         "stretch": (1.0, 0.678), "offset": (-179.5, -250.0),
         "from": 0.767, "until": 1.0},
    ]},
    "bloodEvil": {"stack": [("_bloodriven", "*")]},
    # 崩山裂地斩: the 45-level ultimate's own pack, layer by layer - the blood
    # sword it summons (bloodsword_none, 20 frames), the ground splitting under
    # it (floor, 11), the flames that come out of the split (bloodsexp_1/2), the
    # glow behind them, the sparks (drops_1/2) and the debris (part).
    #
    # The window is declared rather than measured off the art, and both halves of
    # the move are baked to it, because a window is a zoom: the renderer turns it
    # into `size` (EFFECT.draw.mountainRift), and the two rows only land on each
    # other if they are drawn at the same client-px-per-screen-px. With one
    # window for both, one `size` serves both, and `dy = -size / 4` puts the
    # anchor - the caster's own ground point, (382, 281) - on his feet.
    #
    # Zero margin, and a window wide enough that its width is the binding side,
    # so the zoom is exactly `size / 840`: 840 client px of window drawn at 501
    # screen px. One client pixel is 0.596 of a screen pixel, which is what makes
    # the pack's own 445px floor come out 265px wide - the reference's gash - and
    # the move's shapes land at the reference's sizes with the factors below.
    #
    # The layout is the reference's, measured frame by frame off 10_崩山裂地斩
    # (assets/dnf_effect_picks.md has the table). In client coordinates the
    # caster's ground point is (382, 281) and +x is *forward* (the rows are
    # mirrored by facing); a place is written as u px in front of him, and the
    # floor recedes, so a thing standing u px forward stands on y = 289 + 0.12u.
    # The gash runs from u -100 to u 440 (the reference's rock field measures
    # ~295px of screen from his feet forward), its ring is 170px out where the
    # blade lands, and every flame stands along its length.
    #
    # This row is what is drawn *behind* the Slayer: the broken floor he stands
    # in (held from the landing to the end of the move - the reference keeps it
    # under him for the whole lull), and the two spires of the second eruption
    # that come up at his own feet. The rest of the fire and the blood sword are
    # FRONT_ROWS below, baked to this same window.
    # 嗜魂封魔斩. **The row is a timeline in seconds, not in progress.**
    #
    # Every other skill's row is read by progress - a fraction of a cast whose
    # length is a constant. This one is the game's only channel: the player holds
    # it and lets go, so the total does not exist until they do, and a fraction of
    # it cannot name a moment. `EFFECT.channel` therefore splits the row in two
    # and reads each half off its own clock: **columns 0-ENTRANCE are the opening
    # seconds since the press, columns ENTRANCE- are the tail seconds since the
    # release.** `from`/`until` below are fractions of the row, as always, and
    # land on those two ranges.
    #
    # Measured off `skill-clips/09_嗜魂封魔斩.mp4` (176 frames at 30fps, #033 is
    # the press; the ruler and every number are in assets/dnf_effect_picks.md §25).
    # The pack is `sprite_character_swordman_effect_bloodyrave.NPK`, which the
    # repo had been calling 血气爆发 and using exactly one entry of (docs/adr/0022).
    # A client pixel is 1/123.5 of a Slayer-height; the offsets below are in those.
    "bloodyRave": {"palette": "", "pack": "_bloodyrave", "anchor": (0, 0),
                   # **窗口要装得下收尾那一叉。** 旧窗口 (-175,-215,360,265) 只到
                   # 客户端 x=185，而金叉（`lslash-dodge`）与红爆（`finish_normal`
                   # 在客户端里是 ×1.66 画的）伸到 x≈280 —— 右边一截是被**裁掉**的，
                   # 这也是那一版读起来"一坨"的一部分。加宽到 480 后 fit 由宽度说了算
                   # （0.25 cell px / 客户端px），渲染端 `size` 跟着 = 128/0.25 = 512
                   # （`EFFECT.draw.bloodyRave`），1 客户端px 仍然是 1 屏幕px。
                   "length": 24, "window": (-175, -215, 500, 265), "stages": [
        # 起手那颗血球 (#042-#052). The reference grows it to **0.87 Slayer-heights
        # across, centred 0.76 in front of his feet and 0.87 above them** - 73 px
        # at (+94, -107), which is where his outstretched hand is. `start-dodge` is
        # the client's own eight frames of exactly that ball, a red disc with a
        # white-hot core. Every `offset` below is solved, not eyeballed: the
        # client's frames each carry their own place inside the pack's canvas, so
        # the number is `target centre - the ink's own centre at that scale`,
        # measured off the decoded entry. `scale` is what makes 1 client effect px
        # land on 1 screen px, which is the size the rest of this sheet is drawn at.
        # **两段，因为包里那八帧自己会漂。** 客户端这八帧的 (x,y) 从 (0,0) 走到 (42,43)，
        # 于是"整体解一个 offset"只能让**并集**的中心落到参考的位置：实玩抓帧里那颗**球**
        # 落在身前 0.79 / 离地 1.14 身位（他本人才 1.0 高），而**盘**落在 0.86 / 0.87 ——
        # 球比盘高了 0.29 身位，参考里球长成盘是**原地**的（#042–#046 球心恒定）。
        # 拆成两段、各自解到参考自己的位置：球 (0.56, 0.85)、盘 (0.76, 0.87)。
        {"entry": "start-dodge.img", "frames": (0, 4), "scale": 0.52,
         "offset": (-25, -153), "from": 0.150, "until": 0.233},
        {"entry": "start-dodge.img", "frames": (5, 7), "scale": 0.52,
         "offset": (-14, -177), "from": 0.233, "until": 0.317},
        # The ball opening into the sweep (#053-#058): `line-dodge` is the pack's
        # own seventeen frames of thin red streaks fanning out.
        {"entry": "line-dodge.img", "frames": (0, 16), "scale": 1.00,
         "offset": (40, -120), "from": 0.300, "until": 0.435},
        # 收势 (#153-#156): the vortex collapsing back into the hand.
        {"entry": "casting_end_dodge.img", "frames": (0, 5), "scale": 0.55,
         "offset": (-5, -172), "from": 0.435, "until": 0.539},
        # **收尾那一下：两块金 + 两张红，全部按客户端像素 1:1 认下来的。**
        # 这一段的读法是模板匹配给的，不是看着像：把客户端条目镜像后按白芯掩膜做尺度+平移搜索，
        # #164 对 `lslash-dodge` f1 的白芯 IoU **0.92**、#166-#168 对 f2 的 **0.93**、#169 对 f3、
        # #171 对 f4；三帧独立解出的尺度都是 **×1.8**——正好是这个视频自己的放大比
        # （800x600 的游戏窗口放大到 1440x1080），**即游戏是拿包里的美术按客户端像素 1:1 画的**。
        # 于是本行的 scale = 客户端 scale × 0.457：1 客户端px 在本作是 84/123.5 = 0.68 屏幕px，
        # 而这一行把 1 客户端px 画成 1.487 屏幕px（窗口 fit 0.3333 × size/cell 4.46）。
        #
        # **红爆的尖芒**（#162-#164，客户端里 ×1.66）——第一版烘这一下时它整个没进来。
        {"entry": "finish_normal.img", "frames": (0, 2), "scale": 0.626,
         "offset": (-205, -313), "from": 0.652, "until": 0.722},
        #
        # **红雾的主体是 `light.img`**（客户端里 ×0.78，质心量在身前 1.70 / 离地 0.77）——
        # 我们原来只用它当 0.34 的小余晖。`alpha` 是因为包里那盏光是实心红球，
        # 参考的雾峰值亮度只有金的八成、且是低对比的一团。
        {"entry": "light.img", "frames": (0, 0), "scale": 0.292, "alpha": 0.6,
         "offset": (-134, -458), "from": 0.722, "until": 0.913},
        # 余晖 (#171-#176)：同一盏光，收小、压暗（参考 #171 之后金已退尽、只剩暗云）。
        {"entry": "light.img", "frames": (0, 0), "scale": 0.23, "alpha": 0.35,
         "offset": (-134, -458), "from": 0.913, "until": 1.00},
        #
        # **金叉（#162-#171）= `lslash-dodge` 的 f0..f4，一层。** 白芯是它自己带的
        # （勾上没有白芯、长劈上有），所以 `scrach` 与 `finish_dodge` 都不在这一下里——
        # 前者的白闪参考里没有，后者的白扇/细弧与参考的白芯对不上（最佳 IoU 0.05-0.44）。
        # 它是最后一条：参考里金压在红上面（把金笔内缩后，内部只有 0.6% 的像素落在红类里）。
        {"entry": "lslash-dodge.img", "frames": (0, 4), "scale": 0.68,
         "offset": (-62, -263), "from": 0.652, "until": 0.870},
    ]},

    # **魔狱血刹's 火山**, and it is one row because it is one event: the sword
    # goes into the ground, the floor cracks and lights, the column comes up and
    # then it is smoke. All five pieces are the client's own `hellbenter` pack -
    # the pack the whole move lives in - and each one is placed by where its own
    # art sits relative to the caster's feet, which is the anchor (0, 0) here.
    #
    # The window is not the art: it is the *space* the row is drawn in, and it
    # has to leave room **below** the anchor because `bake_frames` puts the
    # anchor on the cell's 0.75 line (the same convention 大蹦's rows use, so the
    # renderer's `dy = -size / 4` holds here too). The art itself hangs upward
    # from that line - a 806px column and a 335px crack, both standing on it.
    #
    # **The window is also the zoom**, and this one used to be 670x1150 for an
    # eruption 700 wide and ~1030 tall. Trimming it to what the art actually
    # covers takes `fit_scale` from 0.329 to 0.356, so the LANCZOS pass throws
    # away a quarter less detail on its way to the cell.
    "hellbenterSlam": {"palette": "", "pack": "_hellbenter", "anchor": (0, 0),
                       # **±540, not ±350: the crescent is wider than the window
                       # used to be.** `fit_scale` is `min(cell/w, cell/h)` and the
                       # window is 1080 tall, so a width of 1080 leaves the scale
                       # exactly where it was - every other layer keeps its own
                       # size and place - while giving 白红新月 the room it needs.
                       # At ±350 the arc was clipped at the window's edge and came
                       # out 3.63 身位 against the reference's 4.59.
                       "length": 60, "window": (-540, -880, 540, 200), "stages": [
        # **拍地那一瞬的主形状：`change-n` 的巨型爪。** 业主说的「真正崩坏的，请你去
        # 客户端里找」就是它：参考片第 146-153 帧他整个人被一团**白mass + 黑回钩 +
        # 红光晕**罩住（把参考帧和 `change-n` 的 f0/f1/f2 并排贴过，形状逐帧对上），
        # 而这一条在包里放了两年没人用——第一版终结只有 `slash-d`（一道白月牙）和
        # `impact-d`（一点金爆），所以那一拍读起来是"挥了一下"，不是"砸下去了"。
        #
        # 位置与大小是**量出来再校**的：参考里那团爪子的框约 168x177 客户端像素
        # （＝1.26 身位高）、中心在他**身后 0.24 身位、离地 0.57 身位**（第 148 帧量的：
        # 爪心离地 189 视频像素，他本人 195 视频像素高＝84 客户端像素）。`change-n`
        # 自己的 f1 是 215x214（＝1.52 身位），所以缩到 **0.9**、中心放到 (-15, -85)。
        # 第一版放在 -115（0.82 身位）——比参考高半个头，第一眼像顶在他头上而不是罩住他。
        # **拍地那一下落在他身上，只有地面开在他身前。** 这一行的锚点现在是"盘心"
        # （在 `caster.x` 前方 131 世界像素），所以属于**这一下**的三层（爪、两道新月、金爆）
        # 要各自往回拉 220 客户端像素（131 世界像素 ÷ 本行的 0.596 客户端像素/屏幕像素），
        # 才落在参考里那个位置：他整个人被爪罩住，而裂缝在他身前张开。
        # **0.83, 不是 0.9**：参考里那团爪子的框是 168x177 客户端像素，`change-n` 的 f1
        # 是 215x214，215x214 x 0.83 = 178x178 才正好是它。0.9 是"量到 1.52 身位、往 1.26
        # 缩一点"的年代里拍的，而那时整行还按 782 画（见 EFFECT.draw 里 `size` 那一段），
        # 所以实画出来是 1.56 身位。现在整行的倍率对了，这里也回到量出来的数。
        # `offset` 的 y 跟着缩了 8（缩放的定点是每帧的**底心**，不是墨心），x 不动。
        {"entry": "change-n.img", "frames": (0, 2), "scale": 0.83,
         "offset": (87, -211), "from": 0.00, "until": 0.07},
        # 白月牙扫进地面 + 落点金爆（参考里这一下是"白**和红**两道新月"；白的那道是
        # `slash-d`，红的那道 `slash-n` 是它的孪生条目，第一版漏了）。两道对齐到同一个
        # 中心：`slash-n` 的 f0 比 `slash-d` 的 f0 在包里偏 (26, 1) 像素，所以偏移补回去。
        {"entry": "slash-d.img", "frames": (0, 3), "scale": 2.5, "stretch": (1.0, 1.15),
         "offset": (70, -41), "from": 0.00, "until": 0.09},
        {"entry": "slash-n.img", "frames": (0, 1), "scale": 2.5, "stretch": (1.0, 1.15),
         "offset": (43, -42), "from": 0.00, "until": 0.09},
        {"entry": "impact-d.img", "frames": (0, 3), "scale": 1.1,
         "offset": (40, -55), "from": 0.00, "until": 0.07},
        # **主喷发的形状是 `new11`——包里那条 261x537 的火柱。** 这一条走过一大圈弯路，
        # 记在这里免得再绕回去：中间有几片把它换成了 `new17`（9 帧 266x160 的**穹顶**，
        # 亮黄裹着黑岩块），理由是我觉得"参考是一大团黄里翻着黑石头，不是一条带黑条纹
        # 的柱子"。**那个判断是错的**，错在拿穹顶的**包围盒**去比柱子：`new17` 高宽比
        # 0.6，参考里那根量出来 2.77 x ≥4.15 身位，于是只好把五朵穹顶叠起来凑高度——
        # 叠出来的是一摞**有横缝的饼**（业主看的就是这一版）。
        #
        # 真的量一遍就明白了。参考第 250 帧（`assets/dnf_src/bilibili/skill-clips/
        # 11_魔狱血刹.mp4`）从地面到屏幕顶，柱身 x 从 360 到 900 视频像素，**宽度沿高度
        # 基本不变**（527 / 527 / 540 / 555 / 564），不是收口的锥。195 视频像素 = 1 身位
        # = 141 客户端像素，所以那是 **390 客户端像素宽**；`new11` 是 261，**1.5 倍**。
        # 高度：柱身被屏幕顶切掉，可见 ≥810 视频像素 = 586 客户端像素；`new11` 1.5 倍
        # 之后是 806，正好长出一截去被切——参考里它也是切掉的。
        #
        # 颜色走 `VOLCANO_RAMP`——**从参考自己的像素量出来的那条曲线**，没有 gamma。
        # 原来挂的是 `LAVA_RAMP` ＋ `level 0.4`，那是"木纹柱"的真正来源：不是 ramp 错，
        # 是那个 **gamma** 把画面里三分之二处在暗部的板推到 ramp 的亮端，暗纹全变成
        # 淡金条纹。只上 ramp、不弯 level，纹路就还在。详见 `VOLCANO_RAMP` 上的注释。
        # 位置：`new11` f0 的底心在客户端坐标 (384.5, 1006)，本行的锚点 (0,0) 是**弹坑心
        # 在地面上**，所以 `offset` 是它的相反数再往下压 40：柱子自己的下沿是一条**平直
        # 的横线**，压在地面线上时它在扇面之上露出一条硬边。沉 40 px 让那条边落到地板
        # 下面，柱身照旧被屏幕顶切掉（上面还有 766 px，屏幕以上只放得下 430）。
        #
        # **五遍**：一行只画一遍的话，8 帧摊在 0.4→0.88 上是 2 张/秒，糊成一张静图。
        # 拆成五遍、每遍自己播完 8 帧，就是 16 张/秒的翻搅（列 24/30/35/41/47/52）。
        {"entry": "new11.img", "ramp": VOLCANO_RAMP, "frames": (0, 7), "scale": 1.5,
         "offset": (-384, -966), "from": 0.40, "until": 0.50},
        {"entry": "new11.img", "ramp": VOLCANO_RAMP, "frames": (0, 7), "scale": 1.5,
         "offset": (-384, -966), "from": 0.50, "until": 0.60},
        {"entry": "new11.img", "ramp": VOLCANO_RAMP, "frames": (0, 7), "scale": 1.5,
         "offset": (-384, -966), "from": 0.60, "until": 0.70},
        {"entry": "new11.img", "ramp": VOLCANO_RAMP, "frames": (0, 7), "scale": 1.5,
         "offset": (-384, -966), "from": 0.70, "until": 0.79},
        {"entry": "new11.img", "ramp": VOLCANO_RAMP, "frames": (0, 7), "scale": 1.5,
         "offset": (-384, -966), "from": 0.79, "until": 0.88},
        # **柱芯换成 `kaaa-d2`，压掉 `new11` 自己的竖纹。** 业主 2026-10-06 的实玩图里
        # 那根柱子读起来是"一块黄板上刷了几道深色竖纹"，而参考 `#250` 的柱身是
        # **一整片过曝的柠檬黄、往外平滑地转成橙色**，没有纹路。量下来：`new11` 自己
        # 只有 **35%** 的像素在 240+，`kaaa-d2` 是 **73%**、均值 (220,182,29)——就是参考
        # 那个亮度。**排在 `new11` 之后画**（后画的压上面），按参考柱芯的宽度铺开，
        # 把中段那几道纹盖掉，柱身外缘仍留 `new11` 的形状。
        {"entry": "kaaa-d2.img", "ramp": VOLCANO_RAMP, "frames": (0, 3), "scale": 2.60,
         "offset": (-384, -966), "from": 0.40, "until": 0.88, "probe": True},
        # **柱子底座那圈放射，是两件东西。** 参考的柱脚是：一团**肥厚发白的黄**
        # 贴在地上，外面再套一圈**细长的橙色射线**沿地面向外扫、末端往下垂。
        #
        # 那圈射线是 `new03`（3 帧，491x130，本来就是一圈细尖）——**压扁**到 0.5 才是
        # 参考那个比例：参考量出来射线环约 542 客户端像素宽、72 高（6.4:1），`new03`
        # 自己是 3.8:1，不压就是一圈立起来的刺。移回 `-163` 之前它整个在**地面以下**。
        # 用 **f0**：`new03` 的三帧里 f1 是一圈对着外圈的火焰、f2 是**一条光秃秃的
        # 椭圆线**（第一版就是拿 f2 画的，屏幕上是一个圈），只有 f0 是参考那种
        # **从中心射出去、末端在外面的细射线**。
        {"entry": "new03.img", "frames": (0, 0), "scale": 1.22, "stretch": (1.0, 0.50),
         "offset": (-300, -160), "from": 0.40, "until": 0.88},
        # 里面的那团黄是 `kaaa-d1`（357x245 的金色爆散，客户端自带）。它原来放在 `-170`，
        # 也就是说**连底沉到地面以下 251 客户端像素**——实玩里只看得见几根尖，业主那句
        # 「感觉最后崩的特效也不对」里少的那半圈就是这个。现在墨心落在地面线上。
        {"entry": "kaaa-d1.img", "frames": (0, 0), "scale": 0.95, "stretch": (1.0, 0.70),
         "offset": (-180, -316), "from": 0.40, "until": 0.88},
        # **里面翻着的那几块黑岩**：参考那根柱子不是纯光，是岩浆裹着石头在翻。
        # 包里的 `exi-particle` 就是石头（6 帧，27x42 到 53x47 的深褐块），五块都摆在
        # **参考量到的位置上**——把 #220/#235/#250/#265/#290 五帧里"暗、圆、面积>300 视频
        # 像素"的块挑出来（长宽比 >2.2 的一律不算，那些是柱身自己的暗纹），它们落在
        # 客户端 x -170…+130、离地 100…470、大小 22x30…35x28 的一段里。
        # 位置用每块自己的**墨心**对，不是框心：`exi-particle` 每帧都是 (0,0)、框和墨不等大。
        # `travel` 让它们在这一段里往上浮（y 负＝上）。
        # 尺寸再抬三成：参考里那些暗块是 22x30 到 35x28 客户端像素，`exi-particle`
        # 的 f0 本来就有 53x47，所以 1:1 就够大——**之前看不见不是小，是柱子本身太暗**，
        # 石头和柱身一片暗纹混在一起。柱子上了 bloom（`EFFECT.draw.glowBlur`）之后
        # 亮底出来了，石头才立得住；这里只再加一档保险。
        # **坐标的 y 是"往上为负"**——本行锚点 (0,0) 是弹坑心在地面上。第一版把量到的
        # **高度**（100…470）当成了 y 直接写进去，五块石头全跑到地板底下去，屏幕上
        # 一块也没有。`place.py` 按 -177 / -202 / -105 / -470 / -350 重算。
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.4, "travel": (0, -150),
         "offset": (-15, -202), "from": 0.42, "until": 0.88},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.8, "travel": (0, -170),
         "offset": (-19, -221), "from": 0.42, "until": 0.88},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.3, "travel": (0, -130),
         "offset": (-74, -132), "from": 0.43, "until": 0.88},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.0, "travel": (0, -90),
         "offset": (-196, -502), "from": 0.44, "until": 0.88},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.7, "travel": (0, -110),
         "offset": (48, -371), "from": 0.45, "until": 0.88},
        # **参考里是 12-16 块，不是 5 块。** 数出来的是「柱体内部、暗橄榄/黑、单块
        # 25-80 × 45-230 视频像素」，对上身位就是 0.11-0.36 宽 × 0.20-1.05 高，散布在
        # 柱身从脚到顶的整条高度上（含两块 0.35 × 1.05 的大块）。五块撑不满那根 3.99
        # 身位高的柱子，中段是空的——这就是"柱子里没有翻滚的石头"。下面八块补中段与
        # 上半段，尺寸取参考量到的区间，`travel` 各自往上浮，错开的 `from` 让它们不同
        # 时冒出来。
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.6, "travel": (0, -230),
         "offset": (-120, -300), "from": 0.44, "until": 0.90},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 2.0, "travel": (0, -260),
         "offset": (95, -430), "from": 0.46, "until": 0.90},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.2, "travel": (0, -200),
         "offset": (-45, -470), "from": 0.47, "until": 0.90},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.9, "travel": (0, -180),
         "offset": (-210, -500), "from": 0.48, "until": 0.92},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.4, "travel": (0, -300),
         "offset": (30, -520), "from": 0.49, "until": 0.92},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 2.3, "travel": (0, -210),
         "offset": (140, -460), "from": 0.50, "until": 0.92},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.1, "travel": (0, -340),
         "offset": (-140, -390), "from": 0.51, "until": 0.94},
        {"entry": "exi-particle.img", "frames": (0, 5), "scale": 1.7, "travel": (0, -160),
         "offset": (60, -340), "from": 0.52, "until": 0.94},
        # **那两块大的。** 参考里最大的一块量到 **0.35 × 1.05 身位**（＝50 × 148 客户端
        # 像素），我们最大的一块才 0.36 × 0.47——柱子里就少了这种"整块翻过来"的石头。
        # `exi-particle` 的 **f1 是 26×81**（长宽比 0.32，和参考那两块一样细长），
        # **锁在 f1 不换帧**、放大 1.9 / 2.2 倍就是 0.35 × 1.09 与 0.41 × 1.26 身位。
        # 上面那十三块都在换帧（(0,5) 循环），所以它们时大时小；这两块是定帧的大块。
        {"entry": "exi-particle.img", "frames": (1, 1), "scale": 1.9, "travel": (0, -240),
         "offset": (-95, -390), "from": 0.46, "until": 0.92},
        {"entry": "exi-particle.img", "frames": (1, 1), "scale": 2.2, "travel": (0, -300),
         "offset": (105, -560), "from": 0.50, "until": 0.94},
        # **裂盘是两件东西，不是一件。** 参考里那是**一块摊在地上的浅色石头盘**（灰褐、
        # 布满裂缝），盘心才有那道**橙黑熔岩口**——业主第二次给的参考帧（裂缝那一下）
        # 一眼能看出来：盘约 2.55 身位宽、熔岩口只有它三分之一。
        #
        # 客户端把这两件分开放：`split-n1.img`（5 帧，浅色盘，497x171）与 `split-d.img`
        # （12 帧，熔岩口，335x101）。**我们一直只画了后者，而且按盘的尺寸画**——
        # `docs/adr/0025` 补记三那句"参考量到 2.6 身位、我们 2.7"量的是**盘**，却把这
        # 个数落在了熔岩口的美术上，所以那口一直大了三倍、盘整个没有。
        #
        # 两个尺寸都是照参考帧量的：盘 2.55 身位（497 客户端像素 → 0.73 倍），
        # 熔岩口连它自己的黑岩一起 1.33 身位（335 → 0.55 倍）。
        # **盘是"开裂"那一下，不是烧着的那一段。** 它自己那 5 帧就是 浅盘 → 藕褐 →
        # 只剩一圈红环：客户端用它演"地面碎开"，碎完就没了。撑满整段的话，火已经
        # 烧了三秒地上还摊着一块黑饼（业主那张实玩图里就是这个）。参考也一样：
        # 拍地后约 0.3 秒是浅盘，柱子起来时地面上只剩裂缝。
        # **岩浆先画，盘盖在上面，盘自己的裂缝从 alpha 里挖掉。** 顺序是这一件的
        # 全部：把岩浆铺在盘上，得到的是"一块石头饼上摊着一小块亮"；把盘盖在岩浆上、
        # **按它自己的暗线把 alpha 挖开**，光才是从缝里透上来的——参考 #180 就是这个。
        # **盘底下那一整片过曝的岩浆：`new17`。** `split-d` 自己的形状是**一圈环**
        # （铺在盘下就是盘里一个金圈），参考 #180 的盘心是**一整片约 1.6 身位的亮黄**。
        # `new17.img` 是 266x160（墨 244x135＝1.73 x 0.96 身位）的一块熔岩，过 `LAVA_RAMP`
        # 就是那片亮黄，排在盘**下面**、缝里透上来。
        #
        # **offset 怎么算的（上一片在这里卡了两次）**：`stage_layers` 里每一条的顺序是
        # `rescale(按底心) → shift(offset)`，**不是**"锚点落在 offset 上"。所以
        # 客户端位置 = `rescale 后的 (x, y)`（`x + (w-w')/2`, `y + h - h'`）**再加 offset**。
        # 盘 0.73 倍后墨心落在客户端 (0, -63.5)；`new17` 0.95 倍后墨心在 (289+127.3,
        # 262+80.3)，要把它移到盘心上 → **offset = (-416, -406)**。
        # （按锚点去对的那两版都落在盘外面，就是漏了这一步。）
        {"entry": "new17.img", "ramp": LAVA_RAMP, "frames": (0, 3), "scale": 0.85,
         "offset": (-416, -428), "from": 0.02, "until": 0.95},
        {"entry": "split-d.img", "ramp": LAVA_RAMP, "level": 0.4, "frames": (0, 11), "scale": 0.72,
         "offset": (-168, -113), "from": 0.02, "until": 0.30},
        {"entry": "split-d.img", "ramp": LAVA_RAMP, "level": 0.4, "frames": (11, 11), "scale": 0.72,
         "offset": (-168, -113), "from": 0.30, "until": 0.95},
        # **盘只演 f0：它自己那 5 帧是 浅盘 → 藕褐 → 只剩一圈红环**，那是客户端用
        # 它演"碎开"的动画，而参考里盘在整个 1.4 秒里**都是那块浅盘**。所以锁在 f0，
        # 加 `punch: 120`（比这个亮的石头留着，暗的裂缝挖掉）。
        {"entry": "split-n1.img", "ramp": STONE_RAMP, "punch": 120,
         "frames": (0, 1), "scale": 0.92,
         "offset": (-336, -212), "from": 0.02, "until": 0.30},
        # **岩浆里那几块黑石头，这是盘上缺的那一件。** 参考 #180 的盘心不是一片均匀的
        # 黄：**亮岩浆里浮着好几块深橄榄/黑的石头**，石板被它们顶开、缝里才透出光。
        # `split-n2.img`（8 帧，365x94 客户端像素＝2.59 x 0.67 身位，实测均值 (52,37,31)）
        # 正是那一堆深色石块，**排在岩浆口之后画**，所以它们压在亮面上。
        # 这一条补上之后盘心才是"岩浆裹着石头"，而不是一块亮的斑点饼。
        {"entry": "split-n2.img", "frames": (0, 8), "scale": 0.72,
         "offset": (-215, -150), "from": 0.06, "until": 0.95},
        # **它自己烧的那一段才是参考的 1.5 秒。** 参考里拍地之后地面先裂开、烧
        # **1.3-1.5 秒**，柱子才起来（训练房 #168-#207 只有裂缝，喷发在第 208 帧），
        # 所以柱子的窗口排在 **0.40**：场地自己的时钟从 0.136 起（＝影子接过的那一列），
        # 0.40 落在它 5 秒的第 1.5 秒上。原先柱子排在 0.26，那是在场地从头播（没有
        # `from` 偏移、施法自己把整行快放一遍）的年代算的，改完两处之后就会早 0.8 秒。
        # 收尾的烟：参考塌成一团紫烟，包里只有红烟（`newsmoke01`，14 帧）。
        {"entry": "newsmoke01.img", "frames": (0, 13), "scale": 1.0,
         "offset": (-239, -258), "from": 0.88, "until": 1.00},
    ]},

    "mountainRift": {"palette": "", "pack": "_outragebreak", "anchor": (382, 281),
                     "length": 45, "window": (120, -200, 960, 480), "stages": [
        # The pack ships the broken floor as three things, and the reference
        # wants all three: f0 is the dark plate field itself (mean 57,48,44 - it
        # keeps the pack's own grey), f1 is the seams through it, f2-f6 is the
        # molten ring blooming out of the split, and f7-f10 is the lit lattice
        # that spreads along the ground and then stays lit. The seams and the
        # lattice carry the reference's lava-line ramp; the rock does not.
        #
        # The floor is placed by the ring's own middle, (382, 281) before it is
        # scaled - at 1.30x about its bottom centre that point moves to
        # (381.9, 256.1) - so (170, 35) puts the ring 170px in front of him,
        # where the reference's blade lands, and drops it into the gash. At the
        # 1.06x below that point moves to (382, 276) instead, which is a client
        # pixel and a half off the gash line - the offset still holds.
        #
        # 0.98x, not 1.30x: the plate field is *not* free to be as wide as the
        # art happens to be. Measured off the reference's quiet stretch (#61-83),
        # its lit ground spans 2.50 of the Slayer's own heights and all of it is
        # in front of him; at 1.30x ours measured 3.5 and reached behind his
        # back, and 1.06x still came out 2.85. See the ground numbers in
        # assets/dnf_effect_picks.md.
        {"entry": "outragebreak_floor.img", "ramp": ROCK_RAMP, "frames": (0, 0), "scale": 1.08, "offset": (170, 27), "from": 0.265, "until": 1.00},
        # The seams through the plates are *lit*, on the same ramp the lattice
        # that spreads along them uses. On ROCK_RAMP they came out grey like the
        # rock they run through, so the whole ground read as one flat slab with a
        # red scribble on it; the reference's ground is dark rock with glowing
        # orange seams, and the seam is the only bright thing in it.
        {"entry": "outragebreak_floor.img", "ramp": FLOOR_RAMP, "frames": (1, 1), "scale": 1.08, "offset": (170, 27), "from": 0.275, "until": 1.00},
        {"entry": "outragebreak_floor.img", "frames": (2, 6), "scale": 1.08, "offset": (170, 27), "from": 0.265, "until": 0.35},
        # The lattice spreads in the half second after the landing and is then
        # *held* at its full width for the rest of the move: that lit field is
        # what the reference's lull and its whole outro are made of (it is still
        # glowing at #133). Playing f7-f10 across the cast instead - which is
        # what this did - showed the first ninth of the web through the quiet
        # stretch and only reached the finished web on the cast's last frame.
        {"entry": "outragebreak_floor.img", "ramp": FLOOR_RAMP, "frames": (7, 10), "scale": 1.08, "offset": (170, 27), "from": 0.265, "until": 0.33},
        {"entry": "outragebreak_floor.img", "ramp": FLOOR_RAMP, "frames": (10, 10), "scale": 1.08, "offset": (170, 27), "from": 0.33, "until": 0.84},
        {"entry": "outragebreak_floor.img", "ramp": FLOOR_RAMP, "frames": (10, 10), "scale": 1.36, "offset": (170, 27), "from": 0.84, "until": 1.00},
        # Rock thrown up by the slam and by the second eruption. `part` has no
        # colour board of its own and its frames sit at the pack's origin (the
        # client scatters it as a particle), so it keeps the plain art and each
        # scatter names the place it lands.
        {"entry": "outragebreak_part.img", "board": "", "scale": 2.4, "offset": (533, 269), "from": 0.28, "until": 0.46},
        {"entry": "outragebreak_part.img", "board": "", "scale": 2.4, "offset": (330, 291), "from": 0.60, "until": 0.76},
        # **No tongue stands on him, so this row carries no flame at all.** It
        # used to: two spires at u 25 and u -20 were composited before he is
        # drawn, on the reading that "the near end of the gash is where his own
        # body is". The clip says the opposite for this wave. Masking out his own
        # red body (x 312-356 of the 720px frame) and cutting the fire off above
        # the glowing floor (y < 340), the second wave's tongues start at **+0.19
        # of a Slayer in front of him** and run to +2.65 - he stands clear, in
        # the open, with the fire burning away from him. The two spires put a
        # 1.4-Slayer column on his shoulders instead, which is the other half of
        # what the owner read as 「还是靠近角色」.
        #
        # The first wave is the one that hugs him - its tongues reach 0.38 of a
        # Slayer *behind* his feet - and that fire is a front-row bush whose own
        # art edge runs back over him, so nothing needs to be drawn behind the
        # Slayer to get it.
    ]},
    # 暴走's cast flash. The move's own read is the icon over his head and the
    # threads round his body, both of them drawn live in the renderer, so this
    # row is only the bloom that opens the cast - the client's own blood burst,
    # off the pack the game names Frenzy. The reference's flash is cyan-white
    # (05_暴走 #63-68) and no client board ships that; the reference is measured,
    # not copied (docs/adr/0005), so the row takes the pack's blood burst.
    "berserk": {"stack": [("_frenzy", "blood-start.img")]},
}

# **Where the cream trail sits, column by column: on the *second* sword.**
# The owner read the reference apart frame by frame: 「奶油颜色的应该是第二把剑的剑影」 -
# the white arc is the *first* sword's (the client draws it in the weapon layer of its own
# 188-209), and the cream one is what the blood blade leaves. So these columns are laid on
# `frenzy/sword_blood_upper.img` - the second sword's own 22-frame position table - each
# one anchored by the arc's top edge at the blade's x, so the trail hangs off the second
# blade the way the reference's does. `draw.rageSwipe.dy` then carries the reference's
# height (its crescent sits 0.47 Slayer-heights over the feet). See docs/adr/0019.


# Rows after the skill rows, for art a move needs away from its own cast. The
# 血之狂暴 rows are the ones the borrow went wrong on: the stance's swings live
# in `sprite_character_swordman_effect_rage.NPK` (see `docs/adr/0019`), while the
# orbs, the blood blade and the gathering blood are taken from the frenzy board.
# The orbs used to ride along inside the dual-blade row, which put a slash arc on
# every drop of blood that flew into the character.
EXTRA_ROWS = [
    # 血球: the ball 血之狂暴 pulls out of a monster. The art is the client's own
    # (`frenzy/blood-stone-0.img`, the entry the owner pointed at) but **only its
    # core**: the picture is a red ball out to r16, a gap, then a pale lilac ring
    # at 1.6x the ball's radius, and the reference's own 血球 is red at every
    # radius (docs/adr/0020). `core` is the ramp that drops the ring. The
    # renderer draws the halo and the trail itself, both measured off the
    # reference - the row is the ball alone.
    ("bloodOrb", {"stack": [("_frenzy", "blood-stone-0.img")], "core": (14, 18.5)}),
    # 银光落刃: the up-slash arc, drawn rotated in the game so it reads as the
    # blade coming down with the dive.
    ("diveSlash", {"stack": [("", "upperslash.img")]}),
    # 血之狂暴's swings come out of **that skill's own pack** - the client keeps
    # them under `sprite_character_swordman_effect_rage.NPK`, next to the buff's
    # cast art, and it ships them as `attack01/02/03.img`. The rows below are
    # that pack; `docs/adr/0019` records what the two borrowed rows they replaced
    # (frenzy/blood-energy and atblooddance/blooddance_effect) were doing wrong.
    #
    # **The red fan under the swing.** `attack01` is eight frames of a dark red
    # brush fan that opens and fades - it is the swipe's own trail, and it is the
    # layer the reference's "slash1 red blood trail" is drawn with. It used to be
    # `frenzy/blood-energy.img`, borrowed from 暴走's pack and measured (122,1,1)
    # flat: that colour was never on the reference's swing.
    ("rageSlash", {"stack": [("_rage", "attack01.img")]}),
    # **The crescents, one swing each.** `attack02` is not one slash - it is the
    # combo's whole timeline, 65 frames carrying **eight separate swings**, each a
    # fat brush crescent that goes red first and then gold (see the three slices
    # below). The eye reads that pair as one thing: the red is the swipe, the gold
    # pass laid over it is what turns the crescent pale.
    #
    # The client plays all eight; our combo is three hits of 0.22s, so each hit
    # gets one swing. **A swing's frames are listed one by one, not sliced**:
    # each one is drawn fat, then thin (that is the brush fading), then fat again
    # in the gold board - so a slice carries the thin frames too, and stacking
    # them drew a closed ring round him where the reference draws one sweep. The
    # listed frames are the fat ones, red pass and gold pass.
    # **The three are the pack's wide swings** - a crescent is *horizontal*: their
    # art is 2.0-3.4 as wide as it is tall (334x137, 348x122, 300x91), and so is
    # every crescent on the reference (d037 1.45x0.60, d046 1.32x0.91, d066
    # 2.02x0.88 Slayer-heights). The pack's other swings are tall vertical hooks
    # (222x222, 241x265, 199x225), the same brush drawn for an over-the-head cut
    # our three-hit combo does not have.
    #
    # **And the *aspect* is what the owner kept seeing** (「剑的黄色剑影还是不太对」,
    # then 「好像还是有一点区别」). Measured off the built sheet, at their own size
    # these hooks draw 1.43 x **1.41** Slayer-heights - square - where the
    # reference's crescent is 1.43 x 0.60-0.91: a *thick wide* band. The pack's
    # other swings are the same brush drawn *flat* (1.16-1.47 x 0.25-0.62), which
    # is too flat. So the aspect comes from the draw: `stretchX` in
    # src/render.js's `draw.rageSwipe` flattens the hook to the reference's band
    # (the same knob `0017` reached for, rejected then because the row behind it
    # was a thin streak - on the fat brush it is the right one).
    # **All three carry CRESCENT_RAMP**: the client's own swing is red and gold,
    # and the reference's crescent is ivory, so the row is recoloured through the
    # colour the reference measures (the same move as 大蹦's fire, and for the same
    # reason - the pack has no board in it). The unramped red is the *fan* row
    # above, which is a different layer of the same swing.
    # The pack's `attack03` - a red-and-gold cross, 467px, ~3.8 Slayer-heights
    # across - is deliberately *not* here: neither the owner's reference nor our
    # 3-hit combo shows a cross on a normal attack, and at its own size it would
    # be twice the widest thing the reference does (docs/adr/0019).
    # **The second blade.** 血之狂暴's dual-wield is not a second weapon in the
    # body art - the client has no such animation, all 242 body frames carry one
    # katana - it is these two layers, one per swing direction, each a blood-red
    # redraw of equipped katana 5601 complete with its cyan guard. Owner's pick,
    # rows 50/51 of the frenzy candidate sheet (docs/adr/0017).
    #
    # **Anchored, and that is the whole of it.** These frames carry the *hand's*
    # own position in the client's coordinates - the blade is at (124,250) while
    # the body's frame is at (154,226), and it tracks the grip across the swing -
    # so the pair only lines up when the row is baked with the caster's ground
    # point ((208.8, 341), the mean of the attack poses' foot centres) named as
    # its anchor. Centred on its own ink instead, the sword lands wherever its
    # bounding box happens to be and the renderer has to be *told* where the hand
    # is: that is what the invented `dx`/`dy` on this row were, and why the
    # second blade sat on top of the katana and read as a red tint rather than as
    # a sword in the other hand (docs/adr/0019).
    # **Drawn on the weapon, which is where the pack puts it.** These rows are
    # the client's own blood-red redraw of equipped katana 5601 - the *same*
    # sword, in the same hand - so they are baked the plain way (centred on their
    # own ink) and the renderer places them on the katana's slot.
    #
    # This row has been dragged around twice and both ends were wrong. Baked
    # against the caster's ground point with a per-frame table measured off body
    # 188-209, the blade *floated in the air* - because that art is not drawn
    # against those frames at all: sword frame k sits in the grip of the **normal
    # attack's** frame k (0-22), which is what `assets/dnf_src/bilibili/
    # skill-clips/sword-pairing.png` shows and what the 22-frame count says. The
    # stance's own swing is 188-209 (the owner picked them), and nothing in this
    # pack carries a grip for that - so the second blade reads the way the owner's
    # own label for it reads: "sword + red after-image", on the sword (docs/adr/0019).
    ("rageBladeUnder", {"stack": [("_frenzy", "sword_blood_under.img")]}),
    ("rageBladeUpper", {"stack": [("_frenzy", "sword_blood_upper.img")]}),
    # The stance's **second beat**: ~0.7s after the burst the reference has a
    # compact mass of blood gathering in his free hand (07_血之狂暴 f68-74,
    # 36-42px across at 0.40 of his height in front of him and 0.80-1.27 up) and
    # a short flash over his head. It plays on over a character who can already
    # move, which is why it is its own row rather than part of the cast.
    ("rageGather", {"stack": [("_frenzy", "blood-stone-start.img")]}),
    # 嗜魂封魔斩's vortex, alone on its own row because it is the one thing in the
    # game that is *drawn live*: it is a spindle of nested loops that churns for as
    # long as the player holds the key, so its length is not knowable at bake time.
    # `particle.img`'s twelve frames are one loop each and the reference's churn
    # period is **9 frames at 30fps = 0.300s**, measured by autocorrelation over
    # the steady stretch (#059-#152, assets/dnf_effect_picks.md §25); the renderer
    # draws several of them along the caster's front and cycles the columns on that
    # beat. The pack draws one loop at 105x163 client px; the reference's whole
    # spindle is 2.9 x 1.68 Slayer-heights, so it is a *line* of these, not one.
    ("bloodyRaveVortex", {"stack": [("_bloodyrave", "particle.img", None, None, None, None, VORTEX_RAMP)]}),
    # **嗜魂封魔斩's blood fog at his hand.** The reference's vortex does not begin
    # as a thin loop: measured over the 94 steady frames (#059-#152) its near end
    # is a mass that starts 0.36 Slayer-heights in front of his feet - his *palm*
    # is at 0.46 - and wraps it (top 0.95, bottom 0.58, centre 0.78 against the
    # palm's 0.81). It is not the loop art drawn small: its pixels average 88
    # brightness against the loops' 159, and a thin stroke stays full-bright
    # however small it is. The client ships exactly one dim blood mass in this
    # skill's own pack and it had never been used: `loop-dodge.img`, twelve frames
    # of it, one per churn phase like `particle`. Drawn live like the vortex,
    # because it is there for as long as the player holds (assets/dnf_effect_picks.md
    # §26).
    ("bloodyRaveMist", {"stack": [("_bloodyrave", "loop-dodge.img", None, None, None, None, VORTEX_RAMP)]}),
    # 血气之剑: 魔狱血刹 (the Berserker's 一觉) carries a sword of its own behind
    # him for the whole of its 持剑期, and it is **not** the blade in his hand -
    # see CONTEXT.md's 血气之剑 (血剑 is the equipped blade turned red, 剑气 is a
    # shot). The art is the client's own: `sprite_character_swordman_effect_
    # hellbenter.NPK/sword-normal.img` is **the same sword at three lengths**
    # (43x97 unlit / 43x73 red short / 43x160 red long, all drawn tip-down), so
    # the move's growth was already in the pack.
    #
    # **The row is one cell per tier, and the cells are cuts of the long frame.**
    # The three client lengths are anchors - 73 at tier 1, 97 at tier 4, 160 at
    # tier 8 - and the four between them are the long frame cut at the
    # interpolated length. That is legitimate here because **the client's own
    # short frame is literally the long one cut short**: decoded, f1 (43x73) and
    # f2 (43x160) agree pixel for pixel in their top 73 rows, hilt, crossguard,
    # eye and all. So a cut is not an approximation of the art, it is the same
    # operation the client did.
    #
    # What must never happen is a **zoom**: scaling the long frame makes the hilt
    # small too, and a small *complete* sword is what the owner sent back
    # (「断剑好像不对」). Cutting keeps the hilt 1:1 and only shortens the blade -
    # and it is why the pommel can be pinned (see drawBloodSword).
    #
    # Two cells and one swap at tier 5 (what this was) held the sword at 0.52
    # 身位 for four tiers and then jumped to 1.13; the owner read that stretch as
    # wrong: 「血剑没成型前跟参考不一样」. The unlit frame (43x97) stays unused -
    # it is the same sword with no blood lit in it.
    # **一格一档，每个格子是 f2 按这一档的长度裁出来的。** 这一段被推翻过一次，
    # 记清楚免得再翻回去：
    #
    # 2026-10-05（补记十）我把这一行换成了 **f0＋`BLADE_RAMP`**，理由是"f0 的**剪影**才是
    # 参考那把剑"。**形状是看对了，颜色看漏了**——f0 是一张**没点亮**的灰线稿（137 个不透明
    # 像素，全是 (55,55,55) 的无彩灰），照它填实再上一道红的 ramp，出来是一根**纯红的棒**：
    # 参考里那个**黑色四角护手**和护心里那颗**金眼睛**，在这条路上根本画不出来。
    # 它们在 f1/f2 里本来就有，而 f1/f2 是**彩色帧**（黑刃、红刃芯、黑护手、金眼）。
    #
    # 业主 2026-10-06 把参考那把剑在帧上框出来给我看（黑护手＋金眼＋红刃），就是这一句
    # 「断剑不对吧」。
    #
    # 裁不是缩放：客户端自己那两帧就是**同一张画裁短**（f1 43x73 与 f2 43x160 的前 73 行
    # 逐像素相同），所以每一档的护手、金眼、柄都是同一张原图、1:1，只有刃的长短在变。
    #
    # **八个长度不是客户端那两个长度，是照参考量出来的两个端点之间的八等分。**
    # 2026-10-06 业主指出「1:06–1:16 是剑长大的过程」（`BV1oUDLBaEaK.mp4`），逐帧量下来：
    # 剑出现后先有 2.7 秒纹丝不动的**平台期**（185–208px，中位 198px），然后 68.7→73.0 秒
    # **连续**长到 382px——中间**没有台阶**。同一段里护手**全程不动**（星宽 85–90px、星心
    # 以上的刃恒为 ~100px），长的只有星心**以下**那一截：99px → 295px。
    # 拿角色站高（280px）当尺：**0.71 → 1.36 身位**。
    # 旧的 73/160 给出来是 0.53 → 1.14，两头都不对：下端太短、上端也短。端点改到 81/155、
    # 配合 `SWORD.size` 132.3，得到 0.71 / 1.36，星心以上恒 0.357 身位（参考量到 0.357）。
    # 仍然是**裁**：81 到 155 每一档都是 f2 从顶端数下来的行数，护手不动。
    ("hellbenterSword", {"growth": {"sprite": "awakening_sword.png",
                                    "massSprites": ["awakening_sword_mass_680.png",
                                                    "awakening_sword_mass_694.png",
                                                    "awakening_sword_mass_700.png",
                                                    "awakening_sword_mass_722.png"],
                                    "lengths": [141, 162, 183, 204, 224, 245, 266, 287]}}),
    # **白的那把，是同一张抠图上 `WHITE_RAMP`。** 参考最后几秒把同一把剑整个转白
    # （11_魔狱血刹 B 2:36.4），所以它不是第二张画。
    # **满了的那把。** 同一张抠图、同一批血团，只把颜色换成金——见 `SWORD_GOLD_RAMP`。
    ("hellbenterSwordGold", {"growth": {"sprite": "awakening_sword.png", "ramp": SWORD_GOLD_RAMP,
                                        "massSprites": ["awakening_sword_mass_680.png",
                                                        "awakening_sword_mass_694.png",
                                                        "awakening_sword_mass_700.png",
                                                        "awakening_sword_mass_722.png"],
                                        "lengths": [141, 162, 183, 204, 224, 245, 266, 287]}}),
    ("hellbenterSwordWhite", {"growth": {"sprite": "awakening_sword.png", "ramp": WHITE_RAMP,
                                         "massSprites": ["awakening_sword_mass_680.png",
                                                         "awakening_sword_mass_694.png",
                                                         "awakening_sword_mass_700.png",
                                                         "awakening_sword_mass_722.png"],
                                         "lengths": [141, 162, 183, 204, 224, 245, 266, 287]}}),
    # **血气被吸进来的那缕丝**: the client's own thin red thread, `new13` (30
    # frames of it, each one a streak that flickers out along its own length).
    # The reference's strands are what the owner pointed at - 「很多血丝很多血丝到
    # 红眼身上，就是一觉汲取血气的特效」 - and this is the pack's only long thin
    # blood thread; the renderer draws it live, rotated from the monster to the
    # Slayer (see drawBloodStrand).
    ("hellbenterStrand", {"stack": [("_hellbenter", "new13.img", None, None, None, None, STRAND_RAMP)]}),
    # **血气之剑 成形的那一下**, and it is the one beat of this whole move that had
    # never been drawn: the sword used to *pop in*, finished and red.
    #
    # **`sword-dodge.img`, not `sim1-dodge.img`.** 补记九 挑的是 `sim1-dodge`
    #（7 帧 60x70，一圈红盘里带魔狱血刹那个「獄」字），注释里写的是"一把剑走
    # 暗→白→金"——**那不是剑，是那个字**：放大看 f2-f4，盘里是一个戏字。业主
    # 2026-10-06 又说了第二次：**「开始的断剑样子和参考不一样」**。
    #
    # 包里真正的成形是这一条：`sword-dodge.img`，10 帧，把参考 `11_魔狱血刹`
    # #52-#72 那一串**一帧一帧走完**——
    #   f0 淡灰线稿 → f1 **纯白的剑** → f2/f3 红描边 → f4/f5 **白爆**（带星芒）
    #   → f6 红白带火星 → f7/f8 **红剑** → f9 金刃
    # 参考那一串就是：他胸前炸一下白（#52）→ 一圈辐条张开（#56）→ 左上角一把
    # **白剑**（#60）→ 变暗红（#64）→ 成红剑（#68-72）。`sim1-dodge` 是"技能进
    # 场的那个章"，`sword-dodge` 才是**剑本身在成形**。
    #
    # **加上扣在他身上的那圈放射。** 参考 #56 除了剑还有一圈东西：一个**圆盘**，
    # 中心亮、往外走金→橙→红，边上一圈细尖射出去，直径量到 1.26 身位、尖到 1.54，
    # 正扣在他胸口上（`ref_ring_56`）。就是 **`kaaa-d1`**——火山柱脚那一个金色爆散，
    # 它的径向剖面本来就是"亮心 → 金 → 橙 → 红边"，只是那一处只用它做柱脚。
    # 这里是同一张图、同一行的第二层：`offset` 把它从他**背后那把剑**的位置挪到他身上
    # （剑在行的局部坐标 -42 屏幕像素处，他在 0），`scale 0.60` 让它 199 客户端像素宽
    # ＝约 1.4 身位。两层都在同一格、同一段里，所以环和剑是一起出现的。
    ("hellbenterForm", {"stack": [("_hellbenter", "sword-dodge.img")]}),
    # **扣在他身上的那圈放射，单开一行。** 参考 #56 除了剑还有一圈：一个**圆盘**，中心亮、
    # 往外走金→橙→红，边上一圈细尖射出去，直径量到 1.26 身位、尖到 1.54，正扣在他胸口上。
    # 就是 **`kaaa-d1`**——火山柱脚那一个金色爆散，它的径向剖面本来就是"亮心 → 金 → 橙 → 红边"。
    #
    # **为什么不跟剑挤在一格**：`bake_frames` 的缩放是整格一起算的（`fit_scale` 取窗口
    # 宽高比里小的那个），环比剑宽一倍多，塞进去会把整格缩小——**剑跟着变成六成大小**，
    # 那是上一版试出来的。两件东西本来就不一样大，各占一行、各算各的缩放才对。
    #
    # 压扁那一下是必须的：`kaaa-d1` 是 357x245 的**椭圆**，而参考那圈是**正圆**，
    # 所以 `stretch` 的 y 因子取 1.46 把它拉圆（压 x 会把每一根射线都变细）。
    ("hellbenterFormRing", {"stack": [
        ("_hellbenter", "kaaa-d1.img", 0.60, None, None, None, None, None, None, (1.0, 1.46)),
    ]}),
]

# Rows for art a move draws *over* the Slayer. DNF orders the layers of one
# effect around the character - the dim copies of a shape go behind him, the
# bright copies in front - and 大蹦's fire is the bright half: the rift and the
# blade are the ground he stands in (they stay behind him, on the skill's own
# row), the flames and the debris he throws pass over him.
#
# The row names the skill it belongs to ("match"), which pins it to that skill's
# anchor: both halves are baked with the caster's own ground point on the same
# spot of their cell, so they land on top of each other however each one is
# zoomed. The zoom is per row - the renderer draws this one at its own size, see
# EFFECT.frontDraw - because the rift needs the whole cell and the fire does not.
FRONT_ROWS = [
    ("mountainRiftFire", {"palette": "", "pack": "_outragebreak",
                          "match": "mountainRift", "length": 45,
                          "window": (120, -200, 960, 480), "stages": [
        # 大蹦 summons no blade of its own. The reference's long red blade is the
        # sword he is already holding, reddened all over by 血之狂暴 - see
        # docs/adr/0003. The pack's own blade (outragebreak_bloodsword_none.img)
        # was baked here in two windows and read as 「凭空多出来一把血剑」, so it
        # is gone; the art stays in the pack, unused, for a swing-trail later.
        #
        # The pack's soft disc and its starburst, not a flame, so they stay a
        # light: one on the impact, then a bigger one left burning under the
        # first wave. Both are the pack's glow, whose bottom centre is (482, 353)
        # - the same place, so the flash and the core do not jump.
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (1, 1),
         "scale": 0.14, "offset": (70, -44), "from": 0.27, "until": 0.34},
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (0, 0),
         "scale": 0.50, "offset": (70, -44), "from": 0.29, "until": 0.44},
        # The fire is *a rank of pillars standing along the gash*, not a ring
        # round the caster: the reference has every frame of its fire ahead of
        # his feet over a one-sided gash, while the client's own 100-frame
        # preview - which the two earlier passes were built from - erupts all
        # round him. The reference wins (assets/dnf_effect_picks.md).
        #
        # A place is (382 + u, 289 + 0.12u): u px in front of the caster, on the
        # line the gash recedes along. Offsets come off each shape's own bottom
        # centre - the wide bush (bloodsexp_1) is on x 419 with its foot at 324,
        # the narrow spire (bloodsexp_2) on x 474 with its foot at 282.
        #
        # The first wave is the reference's #54-#60: one eruption out of the
        # fresh split, tallest in the middle of the ring and dying away at the
        # ends. Its height is measured, not guessed: through its landing the
        # reference's fire tops out 1.0-1.13 of the Slayer's heights above his
        # feet (and settles to 0.70 once the split is done), so this is the
        # pack's wide bush - the shape that makes a low eruption - at ~1.0-1.15,
        # where its own tallest frame is 127px of client art = 1.16 of his
        # heights. The previous pass drew this wave at 1.1-1.85, which measured
        # 1.73 - half again as tall as the reference's.
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.00,
         "offset": (18, -28), "from": 0.31, "until": 0.43},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.15,
         "offset": (113, -17), "from": 0.29, "until": 0.44},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.05,
         "offset": (208, -6), "from": 0.30, "until": 0.43},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 0.90,
         "offset": (283, 3), "from": 0.32, "until": 0.42},
        # The quiet stretch is not empty: the reference's #61-#85 still shows the
        # rank burning low across the whole gash - its fire stands 0.70 of a
        # Slayer high for that whole second, and the previous pass let ours drop
        # to 0.37 with almost nothing left of it. The bush's middle frames burned
        # at 0.80 are that low fire; two of its frames over a fifth of the cast
        # is a fire that sits and burns rather than one that flickers out.
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 0.80,
         "offset": (33, -27), "frames": (2, 3), "from": 0.35, "until": 0.56},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 0.85,
         "offset": (158, -12), "frames": (2, 3), "from": 0.35, "until": 0.56},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 0.80,
         "offset": (273, 2), "frames": (2, 3), "from": 0.36, "until": 0.56},
        # Molten drops land along the gash and spread.
        {"entry": "outragebreak_drops_1.img", "ramp": FIRE_RAMP, "scale": 3.0,
         "offset": (233, 40), "from": 0.32, "until": 0.44},
        {"entry": "outragebreak_drops_2.img", "ramp": FIRE_RAMP, "scale": 3.0,
         "offset": (150, 40), "from": 0.44, "until": 0.56},
        # Then the second wave - the reference's #84-#115, the shot everyone
        # remembers. Its proportions are the reference's, and the one that
        # matters most is not its height: measured off #100/#105, **96% of its
        # bottom two fifths is lit**, in unbroken runs a Slayer wide, while only
        # its top fifth is separate tongues (21% lit). It is a slab of blood with
        # a ragged crest, not a rank of tongues with dark ground showing between
        # them - and the pass that drew the raggedness all the way to the floor
        # is what read as 「一排细丝」 however tall it was.
        #
        # So the wave is built in two parts that add up to that profile:
        #
        #  - a base of **four wide bushes, spaced closer than they are wide**, so
        #    they overlap into a slab. The previous pass had three, 110 client px
        #    apart and 225 wide, and its bottom scan lines broke every 8-13 *cell*
        #    px against the reference's body-wide ones - the bush is bushy, and
        #    the gaps in its own art survive the scaling. Four closer ones do not
        #    close them either on their own: that is what `fill` is for. What the
        #    count and the spacing fix is the *shape* - a slab rather than a row
        #    of three clumps.
        #  - **four tongues, not five, and wider**: at 0.55 of their own width the
        #    spires were needles, and five needles read as a comb. 0.72 and one
        #    fewer is what the reference's crest looks like.
        #
        # Where the rank stands is the clip's own stretch of gash, and it stands
        # **clear of the caster**: with his own red body masked out and the fire
        # cut off above the glowing floor, the second wave's tongues begin at
        # +0.19 of a Slayer in front of him and run to +2.65 (its first wave, by
        # the same ruler, runs -0.38 to +2.47 - that one hugs him). So the whole
        # rank sits 42 client px further out than it did, which is the half of
        # 「还是靠近角色」 that no width change was going to fix.
        #
        # **Heights scattered, not a slope.** The old comment here claimed the
        # tongues "die back as they run forward". The clip's crest, measured per
        # quarter-Slayer column over #86-#115 (median across frames, and the
        # tallest each column ever reaches), is 1.0-1.4 Slayers of low fire with
        # tongues of **2.0-2.6** poking out of it, and those stand all along the
        # rank - 2.5 near him, 2.4 at the far end, 1.9-2.05 in between - with no
        # side taller than the other (owner: 「火焰要高一下…没有一侧是显著高的」).
        # Ours was a monotone fall from 1.75 to 1.00: 2.2 Slayers at one end
        # against 1.1 at the other, which is the slope he read.
        #
        # The scales below are scattered (2.20 / 1.70 / 1.95 / 2.10) so each half
        # of the rank carries a tall one, and their `stretch` x came down from
        # 0.72 to **0.45** when the heights went up: the scale multiplies both
        # axes, so raising them had quietly widened each tongue to 1.9 Slayers -
        # wider than the clip's own runs (26-98 screen px, and ours measured
        # 85-99 before the narrowing). 0.45 puts the towers back at the width
        # they had and leaves the *height* as the only thing that changed.
        #
        # **They are also taller than they were**,
        # and that is measured rather than guessed: the spire is 179px of client
        # art, the row draws a client px at 0.596 of a screen one, and a flame's
        # own faint tip costs it about a tenth of its art in the alpha cut - so
        # 179 x 2.20 x 0.596 lands the tallest tongue at the 2.5 Slayers the clip
        # shows against the ruler (his drawn height there is 112px, which is what
        # that 0.596 is calibrated to).
        #
        # Under the rank, a soft red fill. This is not decoration: measured off
        # the reference, 96% of the fire's bottom two fifths is lit, and no
        # arrangement of the pack's flames gets there on its own - the bush is
        # bushy and its own gaps survive every scaling. What the reference has
        # there is the fire's *light* filling in behind it, and the pack ships
        # exactly that as the glow's f0, a soft disc. Two of them, dimmed and
        # overlapping, are what turns a rank you can see through into a mass.
        #
        # Round, not squashed flat. The obvious next move is to stretch these
        # wide and flat, since the reference's slab is one unbroken scan line and
        # a squashed disc is the only smooth thing in the pack. **Tried, and it
        # fails both ways**: the scan lines barely move (median run 7 -> 6 cell
        # px, against the reference's 70) and the picture is worse - a squashed
        # disc's own bottom edge is two round lumps sitting under the fire like
        # stones, where what the eye wants is fire coming down to the ground.
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": BODY_RAMP, "frames": (0, 0), "alpha": 0.55, "base": 16,
         "scale": 0.90, "offset": (33, -11), "from": 0.55, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": BODY_RAMP, "frames": (0, 0), "alpha": 0.55, "base": 16,
         "scale": 0.90, "offset": (73, -6), "from": 0.54, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": BODY_RAMP, "frames": (0, 0), "alpha": 0.55, "base": 16,
         "scale": 0.90, "offset": (218, 5), "from": 0.55, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.45, "stretch": (0.35, 1.0),
         "offset": (-22, 15), "from": 0.55, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.60, "stretch": (0.35, 1.0),
         "offset": (13, 20), "from": 0.55, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 2.20, "stretch": (0.45, 1.0),
         "offset": (25, 39), "from": 0.55, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.70, "stretch": (0.45, 1.0),
         "offset": (90, 14), "from": 0.54, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.95, "stretch": (0.45, 1.0),
         "offset": (205, 53), "from": 0.54, "until": 0.84},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 2.10, "stretch": (0.45, 1.0),
         "offset": (265, 44), "from": 0.56, "until": 0.84},
        # The slab they stand out of, and the two things the pack does not ship.
        #
        # **All four on one line** (one `dy`, client y 330 - just below the
        # farthest tongue's foot, which is the lowest thing the rank otherwise
        # has). That is not a depth choice: `base` straightens each layer's *own*
        # bottom, so unless the layers agree on where the bottom is, the
        # composite's lowest row is whichever one hangs lowest and the edge comes
        # out ragged again. The first attempt at this spread them along the gash
        # spine as before and the flat foot changed nothing at all.
        #
        # So they stay on that one line even now that the rank runs twice as far
        # down the band: `dy` does **not** follow the spine here the way the
        # spires' do, which leaves the near bush's foot 30px below the spine and
        # the far one's 1px below it. Both are inside the gash's band (the test
        # pins +/-34), and a straight foot is what the reference's slab has.
        #
        # **The first of the four stands back at u 60 as the base the near tongues
        # rise out of - 1.85, not the 2.50 it briefly was.** Four rounds of the
        # owner playing this end: 「还是靠近角色」 (a column stood on his
        # shoulders), 「有一个小小的空间没有岩浆…空了一块」 (the rank had been moved
        # out and left bare floor), 「好像还是缺一点」, and finally 「靠近角色部分
        # 现在像是一滩鲜红的血，没有区分开」 - the wedge had been closed with one
        # 2.5-scale bush, and a bush is a rounded dome, so it read as a pool.
        #
        # Measuring the fire's near edge **by height** (0.25/0.5/1.0/1.5/2.0 of a
        # Slayer off the ground) over #86-#115 is what pinned the wedge: the clip's
        # edge is a near-vertical wall at -0.10/-0.16/+0.28/+0.24/+0.25, while
        # ours came in at the floor and sloped away to +0.67/+0.74/+0.77, leaving
        # empty room beside his chest. But the fix for *that* has to be **tongues**:
        # the clip's near region over #90/#93/#96/#99 is a comb of 4-6 narrow
        # flames with dark ground between them standing out of a lit base (its top
        # fifth is 21% lit over a solid lower mass). A bush cannot do it - it is
        # round - so the two narrow spires above (1.45 and 1.60 at u 70 and 105)
        # carry the comb and this bush is only their base.
        #
        # And the band bound is what sets how near it may stand: the spine rises
        # 0.12px per px forward while the foot stays level, so u 60 is as near as
        # the straight foot can sit at all (+33.8 of the 34px band).
        #
        # **`fill` then `base`**: close the flames' own furry gaps, then cut the
        # foot straight. Measured row by row against #100, the rank already
        # matched the reference from 20% of its height upward and diverged *only*
        # in the bottom 15%, where the reference is 100% lit across its whole
        # width - a curtain of fire standing on a straight edge, and a shape no
        # rounded furry foot in this pack reads as at any scale. After the cut:
        # 10% up goes 39% lit -> 92%, 5% up 13-40% -> 22-87%.
        #
        # What is left of that gap is the rank's *outer* tongues being wider than
        # the slab, so the base cannot fill the whole silhouette: 5% up sits at
        # 79-88% against the reference's 98%. Widening the slab to cover it was
        # tried (`stretch` 0.85 -> 0.98, which measures better: 5% up 79 -> 88%)
        # and **looked worse** - it spreads the rank back out into the wide mound
        # that 「中间高，两边低」 was about, and the reference's fire is a narrow
        # wall, not a wide one. The silhouette is what the eye reads; the last
        # 2-10% of the base is not worth trading it for.
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.85, "stretch": (0.85, 0.80),
         "fill": 6, "base": 16, "offset": (23, 6), "from": 0.55, "until": 0.82},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.45, "stretch": (0.85, 0.80),
         "fill": 6, "base": 16, "offset": (145, 6), "from": 0.55, "until": 0.82},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.45, "stretch": (0.85, 0.80),
         "fill": 6, "base": 16, "offset": (215, 6), "from": 0.55, "until": 0.82},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.30, "stretch": (0.85, 0.80),
         "fill": 6, "base": 16, "offset": (285, 6), "from": 0.56, "until": 0.82},
        # The two hot cores, drawn last so they read through the tongues the way
        # the reference's white-yellow base does.
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (0, 0),
         "scale": 0.45, "offset": (58, -28), "from": 0.56, "until": 0.82},
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (0, 0),
         "scale": 0.45, "offset": (243, 1), "from": 0.57, "until": 0.82},
        # The flames die back onto the gash: the bush's own last frames are
        # embers rather than fire, so the row ends on the lit rift the way the
        # reference does (its last thirty frames are cracks and glow).
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 0.78, "offset": (60, -23), "from": 0.82, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 0.76, "offset": (180, -9), "from": 0.83, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 0.75, "offset": (305, 6), "from": 0.84, "until": 1.00},
    ]}),
]


def radial_core(image: Image.Image, inner: float, outer: float) -> Image.Image:
    """Keep only the middle of a radial effect and fade the rest out.

    `frenzy/blood-stone-0.img` is one picture in three rings: a red ball out to
    r16, a gap, then a pale lilac ring at 1.6x the ball's own radius. The
    reference's 血球 is the ball alone - measured, it is red at *every* radius
    (BV1W9Gx6LELk #836: `(246,76,113)` at the centre, `(249,114,162)` at r18,
    still red at r45) - so the row drops the ring rather than carrying it into
    the game, where it read as a lilac bead (docs/adr/0020).

    A ramp rather than a hard cut: the ball's own edge is soft, and a disc
    punched out of it would show as a ring of its own.
    """
    box = image.getbbox()
    if box is None:
        return image
    centre_x = (box[0] + box[2] - 1) / 2
    centre_y = (box[1] + box[3] - 1) / 2
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    # Outside in: each disc is smaller and brighter than the one before it, so
    # the last (innermost) fill is what the centre ends up with.
    steps = max(1, int((outer - inner) * 8))
    for step in range(steps + 1):
        radius = outer - (outer - inner) * step / steps
        value = int(255 * step / steps)
        draw.ellipse(
            [centre_x - radius, centre_y - radius, centre_x + radius, centre_y + radius],
            fill=value,
        )
    out = image.copy()
    out.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return out


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


def ink_window(frames, origin=(0, 0), padding: int = PADDING):
    """The slice of the client's own coordinates a row's drawn pixels cover."""
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
    if union is None:
        return None
    return (
        union[0] + origin[0] - padding,
        union[1] + origin[1] - padding,
        union[2] + origin[0] + padding,
        union[3] + origin[1] + padding,
    )


def anchored_window(window, anchor):
    """A window that contains the point the row is anchored on.

    `bake_frames` places the anchor at a fixed spot in the cell, and it clamps
    that placement into the window - so a row whose ink stops short of its own
    anchor (大蹦's fire is drawn above the caster's ground line, and its row's
    lowest pixel is 16px short of it) would land up to that gap too high.
    Widening the window to take the anchor in is what keeps a front row and the
    ground row behind it on the same pixel.
    """
    if window is None or anchor is None:
        return window
    return (
        min(window[0], anchor[0]),
        min(window[1], anchor[1]),
        max(window[2], anchor[0]),
        max(window[3], anchor[1]),
    )


def fit_scale(window, cell: int = CELL, margin: int = 8) -> float:
    """How much one client pixel shrinks when a window is fitted into a cell.

    This is the whole zoom of a row, and the renderer has to agree with it: it
    draws the cell at `size` px, so a client pixel lands on `fit_scale(window) *
    size / cell` of the screen. `size` is chosen from this number (see
    EFFECT.draw in src/render.js), which is why an explicit window - rather than
    whatever the art happens to cover this week - is what a row that has to line
    up with another one is baked to.
    """
    span_w = window[2] - window[0]
    span_h = window[3] - window[1]
    return min((cell - margin) / max(1, span_w), (cell - margin) / max(1, span_h))


def bake_frames(frames, row: int, sheet: Image.Image, anchor=None, origin=(0, 0), window=None,
                cell: int = CELL, margin: int = 8) -> int:
    """Draw one skill row from already-composited frames.

    `anchor` is the client-space point the move is rooted at (the caster's feet).
    `origin` is where the row's canvas sits in that same client space, so the
    anchor can be translated onto the frames before they are placed.
    Given one, the row is placed so that point sits at the bottom of the cell's
    middle, whatever shape the bounding box has; without one the row is centred
    as before.

    `window` is a slice of the client's own coordinates to draw from, and it is
    also the zoom: the slice is what gets fitted into the cell. It is passed in
    rather than left to the frames so that a row keeps the columns it was given -
    a timeline that starts later than its first shape (大蹦's own row opens on the
    landing, because the blade it raises is baked onto the fire row) must not
    have its leading empty columns trimmed off and its timing shifted.
    """
    if window is None:
        while frames and not frames[0].getbbox():
            frames.pop(0)
        while frames and not frames[-1].getbbox():
            frames.pop()
    if not frames:
        print(f"  row {row}: nothing drawn, skipping")
        return 0

    if window is None:
        window = ink_window(frames, origin)
        if window is None:
            print(f"  row {row}: nothing drawn, skipping")
            return 0
    span_w = window[2] - window[0]
    span_h = window[3] - window[1]
    scale = fit_scale(window, cell, margin)
    placed_w = max(1, int(span_w * scale))
    placed_h = max(1, int(span_h * scale))
    if anchor is None:
        offset_x = (cell - placed_w) // 2
        offset_y = (cell - placed_h) // 2
    else:
        across = clamp01((anchor[0] - window[0]) / max(1, span_w))
        down = clamp01((anchor[1] - window[1]) / max(1, span_h))
        offset_x = round(cell / 2 - across * placed_w)
        offset_y = round(cell * GROUND_LINE - down * placed_h)
        # No clamping: the point of the anchor is that it lands where it belongs.
        # The slice of the effect that hangs below the ground line is dropped by
        # the cell, which is the part that would be under the floor anyway.

    for column, frame in enumerate(frames):
        layer = Image.new("RGBA", (span_w, span_h), (0, 0, 0, 0))
        layer.alpha_composite(frame, (origin[0] - window[0], origin[1] - window[1]))
        layer = layer.resize((placed_w, placed_h), Image.LANCZOS)
        # Into its own cell first: an anchored row is placed by its ground line,
        # so its frames can sit above or below the middle of the cell. Compositing
        # straight into the sheet let that spill into the row above or below.
        cell_image = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        cell_image.alpha_composite(layer, (offset_x, offset_y))
        sheet.alpha_composite(cell_image, (column * cell, row * cell))

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


def palette_name(name: str, palette: str) -> str:
    """The entry's name in one colour board.

    The client stores the same art once per colour board: "blood-front.img" is
    the plain one, "(tn)blood-front.img" and "(18)blood-front.img" are the same
    shape drawn with a different palette. Entries that already carry a board
    (the packs name some of them that way) are left alone.
    """
    if name.startswith("(") or not palette:
        return name
    return palette + name


def pack_entries(client: Path, pack: str, palette: str = ""):
    """[(name, img)] for one colour board of one effect pack ('' = base pack)."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    path = client / "ImagePacks2" / f"sprite_character_swordman_effect{pack}.NPK"
    if not path.exists():
        return
    with open(path, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            if name != palette_name(name, palette):
                continue
            try:
                yield name, IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue


# One client layer, ready to composite: its frames, the offset of the first
# one, and the size of the largest.
def rescale(decoded, scale: float, stretch=(1.0, 1.0), about: float | None = None):
    """Grow one layer about the point it lands on (its bottom centre).

    The client sizes some effect layers from the skill's animation data rather
    than from the .img, so an export can hand back a blade that is a tenth of the
    size the game draws it at. Scaling about the bottom centre keeps whatever the
    layer touches - the floor, usually - where the pack put it.

    `stretch` is a second, separate factor per axis, because one thing a layer's
    own art cannot say is how *thin* the reference draws it. 大蹦's second wave
    is a rank of narrow tongues: measured off 10_崩山裂地斩 #105 they are 0.2-0.4
    of the Slayer's heights across and 2.2 up, and the pack's spire - the shape
    that makes them - is a flame twice as wide as that at any size that also
    reaches 2.2 tall. Squeezing x is what turns one spire into a tongue; it is
    still the pack's own flame, only drawn at the proportions the reference has.

    `about` is a y in the client's own coordinates to scale about instead of each
    frame's own bottom, and it exists because **one shape can be more than one
    layer**: 怒气爆发's burst ring is a front half and a back half, and their
    bottoms are 38px apart (the back half sits further from the camera). Squashed
    about their own bottoms they move apart by that much, so the ring came out
    flat at the front and round at the back. Naming the line they share - the
    caster's ground point, in that case - flattens the pair by the same amount at
    the same place. Same lesson as `flatten_base`'s: 平底要求各层先说好在哪儿平.
    """
    if scale == 1.0 and stretch == (1.0, 1.0):
        return decoded
    grown = []
    for picture, x, y in decoded:
        width = max(1, int(round(picture.width * scale * stretch[0])))
        height = max(1, int(round(picture.height * scale * stretch[1])))
        if about is None:
            grown_y = int(round(y + picture.height - height))
        else:
            grown_y = int(round(about + (y - about) * scale * stretch[1]))
        grown.append((
            picture.resize((width, height), Image.LANCZOS),
            int(round(x + (picture.width - width) / 2)),
            grown_y,
        ))
    return grown


def rotate_layer(decoded, degrees, pivot=None):
    """Turn one layer about a point, keeping that point where it was.

    A stage's `stretch` is the only shape control the bake had, and two of the
    things the references ask for cannot be said with it: a crescent that has to
    be **steep** (the clip's third-cut arc runs at ~47 degrees, the pack draws it
    at ~18) and a set of quills that has to leave the base at an angle. Stretching
    one axis turns the shape *and* thins it - the 十字斩 thin red line came out
    19px thick that way, where the clip's is 4-6. Rotating first and stretching
    after separates the two.

    `pivot` is a client point to spin about (default: the frame's own centre), and
    it is named separately from `rescale`'s `about` because those two want
    different points: `about` is the line a layer is squashed against (the floor),
    `pivot` is the point that must not move while it turns.
    """
    if not degrees:
        return decoded
    out = []
    for picture, x, y in decoded:
        width, height = picture.width, picture.height
        if pivot is None:
            ax, ay = x + width / 2.0, y + height / 2.0
            px, py = width / 2.0, height / 2.0
        else:
            ax, ay = pivot
            px, py = ax - x, ay - y
        turned = picture.rotate(degrees, expand=True, resample=Image.BICUBIC)
        # keep the pivot at the same *fraction* of the picture, which is where
        # PIL's own rotation puts it
        out.append((
            turned,
            int(round(ax - px * turned.width / max(1, width))),
            int(round(ay - py * turned.height / max(1, height))),
        ))
    return out


def shift(decoded, offset):
    """Move one layer by (dx, dy) in the client's own coordinates.

    The game positions particle layers (the debris a slam kicks up) from the
    skill's animation data rather than from the .img, so an export leaves them
    stacked at the pack's origin; a pick can put them where the move throws them.
    """
    if not offset or offset == (0, 0):
        return decoded
    return [(picture, x + offset[0], y + offset[1]) for picture, x, y in decoded]


def mirror_layer(decoded):
    """Put a layer on the caster's **front** side, from offsets measured off a
    left-facing clip.

    A reference clip can show the client drawing a character **facing left**. We
    measure such a clip in its own screen x, and the caster's *forward* is then
    the direction of **decreasing** x - while in our own client space forward is
    **increasing** x, because `assets/slayer.png` is the pack's art unmirrored
    and therefore faces right. Taking the clip's screen offsets straight into an
    `offset` puts the whole move on his **back**, which is what
    「绕着他扫的镰」 was; see `docs/adr/0011`.

    So this negates the placement about client x = 0: a picture covering
    [x, x + w) comes back at [-(x + w), -x).

    **It does not turn the art round, and that is deliberate.** The first cut of
    this did (`FLIP_LEFT_RIGHT`), and it is wrong for the same reason the
    offsets were: our caster is drawn from the pack's own unmirrored art facing
    right, so the pack's art is *already* the right way round for him - the
    reference only looks mirrored because its caster is the one facing left.
    Flipping it made 十字斩's 十 land with the fat end of every brush stroke on
    the **far** side, where the clip has it on the near side - and no mirror
    about his own axis can fix that, because near/far of a stroke is exactly
    what a mirror about that axis preserves. The owner said 「反的」 twice for
    it. `drawRight`-style reasoning: **positions flip, pictures do not.**
    """
    return [
        (picture, -x - picture.width, y)
        for picture, x, y in decoded
    ]


def dim(decoded, factor):
    """Draw a layer at part strength, by scaling down its alpha.

    DNF draws some of these layers additively and the export cannot say so; a
    stage that reads too bright once it is blown up (the rift's crack field,
    which covers a lake of lava's worth of floor under the ring the client shows)
    can be pulled back here without touching the art itself.
    """
    factor = max(0.0, min(1.0, float(factor)))
    if factor >= 1.0:
        return decoded
    out = []
    for picture, x, y in decoded:
        faded = picture.copy()
        faded.putalpha(faded.getchannel("A").point(lambda value: int(value * factor)))
        out.append((faded, x, y))
    return out


def fill_outline(decoded):
    """Fill what a line drawing's own outline encloses, so it reads solid.

    `sword-normal` frame 0 is **the sword as a silhouette** - a faint outline of
    the hilt, the crossguard and a **rounded blade**, and it is the frame whose
    shape matches the reference (see PICKS.hellbenterSword). It is drawn unlit, so
    what the reference shows as a red sword is this outline filled.
    """
    from collections import deque

    filled = []
    for picture, x, y in decoded:
        picture = picture.convert("RGBA")
        #
        # The outline is drawn as a broken line - without closing it first the
        # flood fill walks straight out through the gaps and nothing is filled. A
        # dilate-then-erode (the same morphological closing `fill_gaps` uses) joins
        # the strokes; the shape itself is unchanged.
        closed = picture.getchannel("A").filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
        picture.putalpha(closed)
        array = np.asarray(picture).copy()
        solid = array[..., 3] > 60
        height, width = solid.shape
        reachable = np.zeros_like(solid)
        queue = deque()
        for column in range(width):
            for row in (0, height - 1):
                if not solid[row, column] and not reachable[row, column]:
                    reachable[row, column] = True
                    queue.append((row, column))
        for row in range(height):
            for column in (0, width - 1):
                if not solid[row, column] and not reachable[row, column]:
                    reachable[row, column] = True
                    queue.append((row, column))
        while queue:
            row, column = queue.popleft()
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = row + dr, column + dc
                if 0 <= nr < height and 0 <= nc < width and not solid[nr, nc] and not reachable[nr, nc]:
                    reachable[nr, nc] = True
                    queue.append((nr, nc))
        inside = (~solid) & (~reachable)
        stroke = array[solid]
        colour = np.median(stroke[:, :3], axis=0) if len(stroke) else np.array([150, 20, 12])
        # **Darker than the stroke**, so the drawing keeps its own lines: filling
        # the whole silhouette with one flat colour turned the sword into a red
        # blob with no hilt and no crossguard in it (the owner: 「这个也不对吧」).
        colour = colour * 0.55
        array[inside, 0] = colour[0]
        array[inside, 1] = colour[1]
        array[inside, 2] = colour[2]
        array[inside, 3] = 225
        filled.append((Image.fromarray(array), x, y))
    return filled


def fill_gaps(decoded, radius: int = 5, soften: float = 1.2, floor: int = 96):
    """Thicken a shape's own gaps shut, so a furry mass reads as one body.

    The pack's flames are furry: a bush is a few dozen little tongues, and the
    dark notches between them survive every scale and every arrangement. Measured
    off 10_崩山裂地斩 #100 the reference's fire has a *solid* lower body - its
    scan lines run a Slayer wide unbroken - and no ordering of the pack's own
    shapes gets there, because the notches are in the art, not in the layout.

    So close them, on the alpha channel only: a **dilate then erode** (PIL's
    MaxFilter then MinFilter, which is the morphological closing) merges the
    tongues wherever they are less than `radius` apart and then pulls the
    silhouette back to roughly where it was, so the shape grows a body without
    growing an outline. `soften` blurs the result so the new edges are not the
    filter's own staircase, and `floor` cuts off the far tail of that blur, which
    is what would otherwise leave a grey haze over the whole cell.

    Only ever used under the flames, never on them: a tongue's whole job is to
    have a silhouette.
    """
    if radius < 1:
        return decoded
    size = radius * 2 + 1
    out = []
    for picture, x, y in decoded:
        image = picture.convert("RGBA")
        alpha = image.getchannel("A").filter(ImageFilter.MaxFilter(size))
        alpha = alpha.filter(ImageFilter.MinFilter(size))
        if soften > 0:
            alpha = alpha.filter(ImageFilter.GaussianBlur(soften))
        alpha = alpha.point(lambda value: 0 if value < floor else value)
        image.putalpha(alpha)
        out.append((image, x, y))
    return out


def _mass_width(source):
    """How wide the blood mass is drawn, in the head sprite's own pixels.

    The crossguard's own span - the mass hangs off it and the reference draws the
    two at the same width, at every stage of the growth.
    """
    row = _widest_row(source)
    alpha = source.getchannel("A")
    pixels = alpha.load()
    left = right = None
    for column in range(source.width):
        if pixels[column, row] > 24:
            if left is None:
                left = column
            right = column
    return (right - left + 1) if left is not None else source.width


def _rescale_sprite(picture, factor: float):
    """One sprite, scaled about its own bottom centre, in one line."""
    width = max(1, int(round(picture.width * factor)))
    height = max(1, int(round(picture.height * factor)))
    return picture.resize((width, height), Image.LANCZOS)


def punch_dark(decoded, threshold: int = 0):
    """Open a layer's own dark lines, so whatever is under it shows through them.

    The counterpart of `fill_gaps`, and it exists for the same reason: the pack
    draws a thing in one piece where the reference draws it in layers. 裂盘 is
    the case - `split-n1` is a pale stone plate with its cracks *painted* on as
    dark lines, and the reference instead shows **lava coming up between slabs**
    (11_魔狱血刹 #180). Laying the岩浆 over the plate gives a disc with a bright
    patch on it; laying the plate over the lava and **cutting its own dark lines
    out of the alpha** is what puts the light in the cracks.

    Multiplied onto the existing alpha rather than replacing it, so the layer's
    own silhouette - the plate's rim, which is also dark - keeps its edge.
    """
    if threshold <= 0:
        return decoded
    out = []
    for picture, x, y in decoded:
        image = picture.convert("RGBA")
        keep = image.convert("L").point(lambda value: 255 if value >= threshold else 0)
        image.putalpha(ImageChops.multiply(image.getchannel("A"), keep))
        out.append((image, x, y))
    return out


def _narrow_after(picture, row: int, threshold: int = 24, share: float = 0.78) -> int:
    """How many rows below `row` the ink stays as wide as it is there.

    **0.78, not 0.55.** The blood mass under the crossguard is 44-49 px wide
    against the guard's 72, so a 55% gate never fires - it walked the whole way
    down the sword and called the mass a 14-row sliver, which is what the tiers
    were then stretching into stripes. The guard's arms are 60-72 px and the drop
    is 47, so the line is around three quarters of the widest row.

    The crossguard is the widest thing on the blood sword and the blade below it
    is a third as wide, so "keep going while it is still guard-wide" lands on the
    guard's bottom edge without needing a row number written down.
    """
    alpha = picture.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()

    def span(at):
        left, right = None, None
        for column in range(width):
            if pixels[column, at] > threshold:
                if left is None:
                    left = column
                right = column
        return 0 if left is None else right - left + 1

    wide = span(row)
    if not wide:
        return 0
    cut = wide * share
    step = 0
    while row + step + 1 < height and span(row + step + 1) >= cut:
        step += 1
    return step


def _widest_row(picture, threshold: int = 24) -> int:
    """The row of a sprite's widest ink - its crossguard, on the blood sword.

    Used to hang the 血气之剑's blood mass off the guard without listing a row
    number: the mass starts where the guard ends, and if the art is re-cut or a
    different frame is picked, both move together.
    """
    alpha = picture.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    best, best_row = -1, 0
    for row in range(height):
        left, right = None, None
        for column in range(width):
            if pixels[column, row] > threshold:
                if left is None:
                    left = column
                right = column
        if left is None:
            continue
        span = right - left + 1
        if span > best:
            best, best_row = span, row
    return best_row


def flatten_base(decoded, rows: int):
    """Give a shape a straight bottom edge, `rows` tall.

    Every shape in this pack ends in a rounded or furry foot, and 大蹦's fire
    needs one that does not: measured row by row against #100, ours already
    matches the reference from 20% of its height upward (95% lit, runs over a
    Slayer long) and diverges *only* in the bottom 15%, where the reference is
    100% lit across its whole width and ours tapers to a point. That is a curtain
    of fire standing on a straight base, and no rounded foot from the pack will
    read as one however it is scaled.

    Taking the union of the lowest `rows` rows and painting it back over them
    does it: the bottom edge becomes straight and keeps its widest reach, and
    nothing above it moves. It is a cut, and it is meant to look like one - this
    is the ground the fire stands on.
    """
    if rows < 1:
        return decoded
    out = []
    for picture, x, y in decoded:
        image = picture.convert("RGBA")
        alpha = image.getchannel("A")
        height = alpha.height
        count = min(rows, height)
        box = alpha.crop((0, height - count, alpha.width, height))
        # Per *column*, the tallest reach of the bottom rows - so the edge goes
        # straight without smearing sideways the way a square max-filter would.
        source = box.load()
        flat = Image.new("L", box.size, 0)
        target = flat.load()
        for column in range(box.width):
            reach = 0
            for row in range(count):
                reach = max(reach, source[column, row])
            for row in range(count):
                target[column, row] = reach
        alpha.paste(flat, (0, height - count))
        image.putalpha(alpha)
        out.append((image, x, y))
    return out


def ramp_tables(stops):
    """Per-channel 256-entry lookup tables for a (level, (r, g, b)) ramp."""
    levels = [stop[0] for stop in stops]
    tables = []
    for index in range(3):
        colours = [stop[1][index] for stop in stops]
        table = []
        for value in range(256):
            level = value / 255.0
            if level <= levels[0]:
                table.append(int(round(colours[0])))
                continue
            if level >= levels[-1]:
                table.append(int(round(colours[-1])))
                continue
            for step in range(1, len(levels)):
                if level > levels[step]:
                    continue
                span = levels[step] - levels[step - 1]
                at = (level - levels[step - 1]) / span if span else 0.0
                table.append(int(round(colours[step - 1] + at * (colours[step] - colours[step - 1]))))
                break
        tables.append(table)
    return tables


def select_frames(decoded, frames):
    """The frames a layer names, either a half-open slice or a list of indices.

    A slice is what a row wants when it plays a *run* of the client's timeline.
    A list is what it wants when the client's run alternates: 血之狂暴's swings
    are drawn fat, then thin, then fat again in the gold board, and a row that is
    the *crescent* (not the thinning) has to say which of them it is made of -
    stacking the thin frames in as well is what drew a closed ring round him
    instead of one sweep (docs/adr/0019).
    """
    if frames is None:
        return decoded
    if len(frames) == 2 and frames[1] is None:
        return decoded[frames[0]:]
    if len(frames) == 2:
        return decoded[frames[0]:frames[1]]
    return [decoded[index] for index in frames]


def solidify(decoded, factor):
    """Raise a layer's alpha, for a stroke the reference draws *solid*.

    The opposite of `dim`, and 血之狂暴's crescent is why it exists: the pack's
    brush is drawn soft - its body carries about half its alpha, which is right
    for a glow and wrong for a stroke - and the reference's crescent is a flat
    ivory mass (242,241,181) with no translucency in it at all. Laid down once,
    ours measured (202,202,177): the source was already saturated and the
    coverage was the limit, which is not something a colour ramp can fix.

    A layer that names it says how many times over the stroke should be laid
    down; the soft rim scales with it instead of being cut off, so the brush
    keeps its furry edge.
    """
    factor = float(factor or 1.0)
    if factor <= 1.0:
        return decoded
    out = []
    for picture, x, y in decoded:
        solid = picture.copy()
        solid.putalpha(
            solid.getchannel("A").point(lambda value: min(255, int(round(value * factor))))
        )
        out.append((solid, x, y))
    return out


def tint(decoded, stops, gamma=None):
    """Recolour one layer through a ramp of (level, (r, g, b)) stops.

    The pack's own colour boards are all or nothing - 大蹦's fire is deep blood
    red on one and orange on the other, and the training-room reference is
    neither - so a pick can name the ramp the reference measures instead (see
    FIRE_RAMP). A pixel's level is its own brightest channel, so the shape of the
    art is what drives the colour and every pixel's channel comes off the same
    stop; that is what keeps a flame's dull body dark and its core white-hot
    rather than tinting each channel on its own.
    """
    if not stops:
        return decoded
    tables = ramp_tables(stops)
    out = []
    for picture, x, y in decoded:
        red, green, blue = picture.convert("RGBA").split()[:3]
        level = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        # `gamma` bends the level before the ramp reads it. A ramp can only move
        # colour *along* a shape's own brightness, so a lane whose art is mostly
        # dark - 魔狱血刹's lava column, two thirds of it in shadow - stays dark
        # however bright the ramp's top stop is. Bending the level first is how a
        # row says "the reference's version of this shape is lit, not shaded".
        if gamma:
            level = level.point(lambda v: int(round(255.0 * (v / 255.0) ** gamma)))
        recoloured = Image.merge(
            "RGB",
            (level.point(tables[0]), level.point(tables[1]), level.point(tables[2])),
        ).convert("RGBA")
        recoloured.putalpha(picture.convert("RGBA").getchannel("A"))
        out.append((recoloured, x, y))
    return out


def place_frame(picture, x, y, travel, grow, at):
    """One frame of a stage, `at` of the way through that stage's own span.

    **`grow` scales about the frame's own middle, and that is not the same
    choice `rescale` makes by default.** `rescale`'s default is the bottom, which
    is right for a shape that has to stay standing on a line. A qi that is
    *shrinking away* is not standing on anything: scaled about its bottom it
    sinks - 十字斩's merged qi started 117px over the clip's ground line and the
    last cell of it was being drawn 70px **under** the floor, where nobody would
    ever see the 「缩小消失」 the owner kept asking for. Mid-frame it only
    shrinks, and the `travel` that the clip also asks for is said separately.
    """
    scale = 1.0 + (grow - 1.0) * at
    if scale != 1.0:
        picture, x, y = rescale(
            [(picture, x, y)], scale, about=y + picture.height / 2.0
        )[0]
    return (
        picture,
        x + int(round(travel[0] * at)),
        y + int(round(travel[1] * at)),
    )


def stage_layers(client: Path, pick: dict):
    """Every stage of a staged pick, as (frames, from, until, travel, grow)."""
    out = []
    default_pack = pick.get("pack", "")
    default_board = pick.get("palette", "")
    for stage in pick.get("stages", []):
        pack = stage.get("pack", default_pack)
        board = stage.get("board", default_board)
        wanted = palette_name(stage["entry"], board)
        found = dict(pack_entries(client, pack, board)).get(wanted)
        if found is None:
            print(f"  missing {pack}/{wanted}", file=sys.stderr)
            continue
        decoded = decode_frames(found)
        if not decoded:
            continue
        scale = float(stage.get("scale", 1.0))
        offset = tuple(stage.get("offset", (0, 0)))
        decoded = tint(decoded, stage.get("ramp"), stage.get("level"))
        decoded = dim(
            shift(
                rotate_layer(
                    rescale(
                        decoded,
                        scale,
                        tuple(stage.get("stretch", (1.0, 1.0))),
                        stage.get("about"),
                    ),
                    float(stage.get("rotate", 0.0)),
                    tuple(stage["pivot"]) if stage.get("pivot") else None,
                ),
                offset,
            ),
            stage.get("alpha", 1.0),
        )
        # Filling is a *scale* thing, so it runs after the shape has been grown:
        # the gaps a layer needs closed are the ones it has on screen, not the
        # ones it had at the pack's own size.
        decoded = fill_gaps(decoded, int(stage.get("fill", 0)))
        decoded = punch_dark(decoded, int(stage.get("punch", 0)))
        decoded = flatten_base(decoded, int(stage.get("base", 0)))
        # **`flip` turns the picture round, which is the one thing `mirror` never
        # does.** `mirror_layer` moves a layer to the caster's front side and
        # leaves the art alone - that is `0011`, and it is right for a shape that
        # has no facing: 十字斩's 十 is a brush stroke either way. A shape that
        # *does* have a facing needs the art flipped as well, or the placement
        # says "in front" while the drawing says "behind".
        #
        # `shoot.img` is that shape: its mass is at the art's own left and its
        # thin tips at its right, so placed in front of our right-facing caster
        # the qi read as a bird flying **backwards** - the owner: 「我感觉你实现
        # 有的剑气都到身后了，参考的没有」.
        if stage.get("flip"):
            decoded = [
                (picture.transpose(Image.FLIP_LEFT_RIGHT), x, y)
                for picture, x, y in decoded
            ]
        # Last, so that every number in `stage` stays the clip's own number and
        # only the finished placement is turned round. See `mirror_layer`.
        if pick.get("mirror"):
            decoded = mirror_layer(decoded)
        first, last = stage.get("frames", (0, len(decoded) - 1))
        part = decoded[first:last + 1]
        if not part:
            print(f"  empty stage {pack}/{wanted} frames {first}-{last}", file=sys.stderr)
            continue
        # **一笔的"动"和它的"形"是两件事。** `scale`/`stretch`/`offset` 说的是一层长什么样、
        # 站在哪，一整段里都不变；而参考里有的层**在同一段里一直在走、一直在缩**——第三拍
        # 那团合体剑气就是：它的重心从身前 0.61 身位走到 1.29，框从 121x140 缩到 32x40 再到
        # 没有。这没法用一个静止的 `offset` 说，也不该拆成二十段（2026-09-27 那一轮的
        # 「八级飞出」就是这么拆的，两轮后被业主推翻）。
        #
        # `travel` 是这段里**从第一格走到最后一格**多走的位移，`grow` 是它到头时相对
        # `scale` 的倍数，两者都按列线性插值（见 `pick_frames`）。数写在**参考自己的坐标系**
        # 里，所以 `mirror` 会连它们一起翻——见 `mirror_layer`。
        travel = tuple(stage.get("travel", (0, 0)))
        grow = float(stage.get("grow", 1.0))
        if pick.get("mirror"):
            travel = (-travel[0], travel[1])
        out.append((part, float(stage["from"]), float(stage["until"]), travel, grow))
    return out


def pick_frames(client: Path, mode: str, entries, palette: str = "", spec: dict | None = None):
    """Composite/concatenate the client entries a row is made of.

    Returns (frames, origin): the frames share one canvas, and `origin` is where
    that canvas' top-left sits in the client's own coordinates, so a pick's
    `anchor` can be translated onto it.
    """
    if mode == "stages":
        layers = stage_layers(client, spec or {})
        if not layers:
            return [], (0, 0)
        # The canvas has to hold every layer **at every column it plays on**. A
        # stage that walks forward or grows would otherwise be clipped at exactly
        # the frame it is moving on - `0008`'s failure, on a slower fuse.
        parts = []
        for layer, _start, _until, travel, grow in layers:
            for picture, x, y in layer:
                parts.append((picture, x, y))
                parts.append(place_frame(picture, x, y, travel, grow, 1.0))
        # A stage's `offset` is allowed to be fractional (a layer solved to a
        # tenth of a pixel), so the canvas is rounded once, here, rather than at
        # every use of it.
        left = int(round(min(x for _p, x, _y in parts)))
        top = int(round(min(y for _p, _x, y in parts)))
        width = int(round(max(x + p.width for p, x, _y in parts))) - left
        height = int(round(max(y + p.height for p, _x, y in parts))) - top
        length = max(2, int((spec or {}).get("length", 45)))
        frames = [Image.new("RGBA", (width, height), (0, 0, 0, 0)) for _ in range(length)]
        for layer, start, until, travel, grow in layers:
            first = round(clamp01(start) * (length - 1))
            last = max(first, round(clamp01(until) * (length - 1)))
            for index in range(first, last + 1):
                at = (index - first) / max(1, last - first)
                picture, x, y = layer[round(at * (len(layer) - 1))]
                picture, x, y = place_frame(picture, x, y, travel, grow, at)
                frames[index].alpha_composite(
                    picture, (int(round(x - left)), int(round(y - top)))
                )
        return frames, (left, top)

    if mode == "growth":
        # **One entry, one frame, cut to each of a list of lengths.** 血气之剑 is
        # the case: the client draws its own sword at three lengths and the move
        # needs one cell per 铸剑 tier, so the longest frame is cut at each tier's
        # length. The cuts are honest because the client's *own* short frame is
        # the long one cut - decoded, 43x73 and the top 73 rows of 43x160 agree in
        # 3101 of their 3139 pixels (the 38 that differ are the cut edge itself).
        #
        # Nothing here rescales: every cell is the same art at 1:1, so the hilt,
        # the crossguard and the gold eye are identical from the first tier to the
        # last and only the blade changes length. See PICKS.hellbenterSword.
        spec = spec or {}
        # The pick's `growth` block, or the pick itself when it is passed bare.
        grow = spec.get("growth", spec)
        # **`sprite`: the sword cut straight out of the reference clip.**
        # `assets/import_dnf_awakening_sword.py` takes it off
        # `11_魔狱血刹.mp4` (the training room's backdrop is pure black, which is
        # what makes the key possible). Six rounds of assembling this sword out of
        # the client's own entries never matched, and the owner asked for the
        # cut-out by name: 「要不你通过抠图来吧」.
        #
        # **Only the drop grows; the guard does not move.** That is what the
        # reference itself does - `BV1oUDLBaEaK` 1:08.7-1:13.0, measured frame by
        # frame: the crossguard and the blade above it are identical for the whole
        # stretch while everything below it grows, 99 px to 295 px. So a tier is
        # the head, untouched, with the drop resized to that tier's own height.
        if grow.get("sprite"):
            source = Image.open(ROOT / grow["sprite"]).convert("RGBA")
            guard_row = _widest_row(source)
            guard_row = guard_row + _narrow_after(source, guard_row)
            head = source.crop((0, 0, source.width, guard_row))
            # **The mass comes from a second cut-out, off the growth clip.**
            # `awakening_sword.png` is the *training* room's sword, which the clip
            # caught already grown - its drop is the short one. The grown sword's
            # drop is a different shape (a long lumpy mass, not the short one
            # stretched), and it only exists in `BV1oUDLBaEaK.mp4` - the dungeon,
            # where the key has to be by colour instead of by black. So the head
            # is the clean black-keyed one and the mass is the colour-keyed one.
            # `massSprites` names one mass *per tier*: the reference's own drop is
            # a different shape at each stage (a compact lobe low down, a long
            # lumpy mass when it is full), so the tiers take the nearest cut-out
            # instead of one shape stretched six ways over. Ours would band - a
            # 290 px mass squeezed into 70 px is stripes, not lobes.
            mass_paths = grow.get("massSprites")
            if not mass_paths and grow.get("massSprite"):
                mass_paths = [grow["massSprite"]]
            # **The two clips are not at the same scale.** A Slayer is 220 px in
            # the training room and 280 px in the dungeon, so a mass cut from the
            # dungeon has to be shrunk by 220/280 before it can sit under a head
            # cut from the training room - otherwise the drop is a fifth too long
            # for its own crossguard and every tier is squeezed to match.
            MASS_SCALE = 220.0 / 280.0
            masses = [
                _rescale_sprite(Image.open(ROOT / name).convert("RGBA"), MASS_SCALE)
                for name in mass_paths
            ] if mass_paths else None
            frames = []
            tiers = [int(value) for value in grow["lengths"]]
            for index, height in enumerate(tiers):
                band = max(1, height - guard_row)
                frame = Image.new("RGBA", (source.width, max(height, guard_row)), (0, 0, 0, 0))
                if masses:
                    # **Blend the stages, do not pick one.** Two cuts of the same
                    # mass at two stages, each resized to this tier's band, cross
                    # faded by how far along the ladder the tier is: the shape
                    # walks from the short lobe to the long mass the way the
                    # reference's own does, and neither cut is ever stretched far
                    # enough to band.
                    at = index / max(1, len(tiers) - 1)
                    # Each cut keeps its **own aspect** - that is the growth (a
                    # round lobe becomes a long drop) - so they are laid into a
                    # common canvas bottom-aligned before blending, because
                    # `Image.blend` needs two images the same size and these are
                    # 0.86, 0.94, 0.68 and 0.35 wide-to-tall.
                    # **Every stage is drawn to the *same* width and only the
                    # height changes.** That is what the reference does - over the
                    # whole growth the mass stays 0.32-0.36 of a Slayer across
                    # while it goes 0.35 to 1.05 tall - and keeping each cut's own
                    # aspect instead is what the owner caught: 「短剑越来越粗」.
                    # Blending a round lobe into a long drop at their own aspects
                    # makes the mixture wider than either, so the middle tiers
                    # bulged to 0.41 身位.
                    wide = max(1, int(round(_mass_width(source)))) if masses else 1
                    scaled = []
                    for m in masses:
                        canvas = Image.new("RGBA", (wide, band), (0, 0, 0, 0))
                        canvas.alpha_composite(m.resize((wide, band), Image.LANCZOS), (0, 0))
                        scaled.append(canvas)
                    near = at * (len(scaled) - 1)
                    low = min(int(near), len(scaled) - 1)
                    high = min(low + 1, len(scaled) - 1)
                    mix = near - low
                    layer = scaled[low]
                    if high != low and mix > 0:
                        layer = Image.blend(layer, scaled[high], mix)
                    left = int(round((source.width - layer.width) / 2))
                    frame.alpha_composite(layer, (left, guard_row - 6))
                else:
                    drop = source.crop((0, guard_row, source.width, source.height))
                    frame.alpha_composite(drop.resize((drop.width, band), Image.LANCZOS), (0, guard_row))
                # The head goes on **last**: the mass cuts carry a sliver of the
                # crossguard's own dark arms along their top edge, and drawing the
                # head over them is what hides the seam.
                frame.alpha_composite(head, (0, 0))
                if grow.get("ramp"):
                    frame = tint([(frame, 0, 0)], grow["ramp"])[0][0]
                frames.append(frame)
            return frames, (0, 0)
        pack = grow.get("pack", "")
        board = grow.get("palette", palette)
        found = dict(pack_entries(client, pack, board)).get(palette_name(grow["entry"], board))
        if found is None:
            print(f"  missing {pack}/{grow['entry']}", file=sys.stderr)
            return [], (0, 0)
        decoded = decode_frames(found)
        if not decoded:
            return [], (0, 0)
        at = int(grow.get("frame", 0))
        picture, x, y = tint([decoded[at]], grow.get("ramp"))[0]
        # **`fill` closes the blade's own saw notches.** The client's blade is red
        # with dark serrations bitten out of its edge; the reference draws it as
        # one smooth red mass tapering to a point (measured off the owner's own
        # frame: 30 px at the middle, 4 px at three quarters, 1 px at the tip).
        # Same morphological closing the flames use - see fill_gaps.
        if not grow.get("bladeRamp") and grow.get("fill"):
            picture = fill_gaps([(picture, x, y)], int(grow["fill"]))[0][0]
        # **`bladeRamp`: the blade below the guard takes the blood red, and
        # nothing else does.** The client's blade is a *dark* serrated body with a
        # thin red edge; the reference draws it as one solid red mass (the
        # owner's own frame, measured: 0.13 身位 wide at the middle tapering to
        # 0.02 at the tip, all of it red). A ramp over the *whole* sword was tried
        # before and is what loses the black crossguard and the gold eye - they
        # are dark too, and a luminance ramp cannot tell them from the blade. The
        # guard is at a known row (the widest one), so the ramp starts under it.
        if grow.get("bladeRamp"):
            # **Split under the guard, not through it.** The gold eye sits on the
            # guard's own middle - splitting at the widest row ramps over it and
            # the owner's「暗色四角星加金眼」loses the eye. `_narrow_after` walks
            # down to where the guard becomes blade.
            guard = _widest_row(picture)
            guard = guard + _narrow_after(picture, guard)
            head = picture.crop((0, 0, picture.width, guard))
            tail = picture.crop((0, guard, picture.width, picture.height))
            # **The closing runs on the blade only, and it is what smooths the
            # saw.** f2's teeth are in the *alpha* - look at the silhouette and
            # the left edge is a staircase - so `bladeRamp` alone turns them from
            # black teeth into red teeth. The reference's blade is one smooth
            # mass, so the tail gets `fill_gaps` at a radius wide enough to merge
            # teeth that are 8-12 px apart. It is applied here rather than to the
            # whole sword because **the crossguard's four points must survive** -
            # they are the same scale as the teeth and a closing over the whole
            # picture would round them off.
            tail = fill_gaps([(tail, x, y)], int(grow.get("fill", 0)))[0][0]
            tail = tint([(tail, x, y)], grow["bladeRamp"])[0][0]
            picture = Image.new("RGBA", picture.size, (0, 0, 0, 0))
            picture.alpha_composite(head, (0, 0))
            picture.alpha_composite(tail, (0, guard))
        lengths = [int(value) for value in grow["lengths"]]
        cuts = [(picture.crop((0, 0, picture.width, length)), x, y) for length in lengths]
        # **`mass`: what hangs under the guard, and it is not the pack's blade.**
        # See PICKS.hellbenterSword - the reference grows a *blood mass* below
        # the crossguard while `sword-normal` f2's own lower half is a serrated
        # steel blade. So the cut keeps only the hilt, the blade and the guard,
        # and a second entry is stretched in below the guard to the cut's own
        # bottom. The ball is `woong-dodge`, the pack's own blood - the same
        # entry 补记九 reached for, and this time it is not a decal on a blade
        # but the thing itself.
        mass_spec = grow.get("mass")
        mass = None
        guard_bottom = 0
        if mass_spec:
            found_mass = dict(pack_entries(client, mass_spec.get("pack", pack),
                                           mass_spec.get("palette", board))).get(
                palette_name(mass_spec["entry"], mass_spec.get("palette", board)))
            decoded_mass = decode_frames(found_mass) if found_mass else []
            if decoded_mass:
                ball = tint([decoded_mass[int(mass_spec.get("frame", 0))]],
                            mass_spec.get("ramp"))[0][0]
                # **`flat`: keep the shape, throw the picture away.** Several of
                # the pack's entries are a red *drop* with a bright glyph painted
                # inside it (`sim1-dodge` f2-f4 are the 魔狱血刹 emblem). The
                # silhouette is exactly the blood mass the reference hangs under
                # the crossguard; the glyph is not. Filling the alpha with one
                # colour keeps the first and drops the second.
                if mass_spec.get("flat"):
                    paint = mass_spec["flat"]
                    shaped = ball.convert("RGBA")
                    flat = Image.new("RGBA", shaped.size, (paint[0], paint[1], paint[2], 255))
                    flat.putalpha(shaped.getchannel("A"))
                    ball = flat
                # Where the guard ends, in the cut's own pixels: the widest row
                # of the top `probe` rows is the crossguard, and the mass starts
                # under it. Measured off the art rather than listed, so a
                # different frame or a re-cut tier moves both together.
                probe = int(mass_spec.get("probe", 90))
                ink = picture.crop((0, 0, picture.width, min(probe, picture.height)))
                # **The guard's *bottom*, not its widest row.** `_widest_row`
                # returns the middle of the crossguard, and hanging the mass from
                # there draws it over the guard and hides the black star and the
                # gold eye - which are the two things the owner named. Walk down
                # from the widest row while the ink is still guard-wide and stop
                # where it narrows into the blade.
                guard_row = int(mass_spec.get("guardBottom", 0)) or _widest_row(ink)
                guard_bottom = guard_row + _narrow_after(ink, guard_row)
                guard_bottom = max(0, guard_bottom - int(mass_spec.get("overlap", 0)))
                mass = ball
        width = max(part.width for part, _x, _y in cuts)
        height = max(part.height for part, _x, _y in cuts)
        frames = []
        for part, _x, _y in cuts:
            canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            if mass is not None:
                # **The client's own cut goes down whole, and the drop is laid
                # over the blade below the guard.** Cropping the blade away and
                # replacing it was tried and is what cost the black star and the
                # gold eye: the split lands somewhere in the crossguard and takes
                # them with it. Drawn this way nothing above the drop's top edge
                # is touched - the hilt, the guard and the eye are the client's
                # own pixels, at 1:1, in every tier, which is the whole point.
                canvas.alpha_composite(part, (0, 0))
                band = part.height - guard_bottom
                across = int(mass_spec.get("width", mass.width))
                grown = mass.resize((across, band), Image.LANCZOS)
                # Centred on the guard, which is what the reference shows: the
                # mass hangs off the crossguard's own axis, not the cell's.
                left = int(round((width - across) / 2))
                canvas.alpha_composite(grown, (left, guard_bottom))
            else:
                canvas.alpha_composite(part, (0, 0))
            frames.append(canvas)
        return frames, (x, y)


    layers = []
    for pick in entries:
        pack, entry = pick[0], pick[1]
        scale = float(pick[2]) if len(pick) > 2 and pick[2] is not None else 1.0
        # A layer can name its own board: the client draws 怒气爆发's pool of
        # blood in the plain (red) art and the eruption above it in white-gold.
        board = pick[3] if len(pick) > 3 and pick[3] is not None else palette
        offset = pick[4] if len(pick) > 4 and pick[4] is not None else (0, 0)
        # A layer can take a *slice* of its entry: one client row can carry a
        # whole combo (rage/attack02 is eight separate swings over one timeline),
        # and a row that plays one swing at a time has to say which. Half-open,
        # like a Python slice. And it can name a ramp, the same way a stage does:
        # a *stack* row needs one when the pack's own boards are the wrong colour
        # (see CRESCENT_RAMP).
        frames = pick[5] if len(pick) > 5 and pick[5] is not None else (0, None)
        ramp = pick[6] if len(pick) > 6 else None
        # How many times over this layer's own alpha should be laid down - see
        # solidify. It is a layer's property and not the row's: one row can carry
        # a soft glow and a solid stroke.
        solid = pick[7] if len(pick) > 7 else None
        # A layer that is line art says so, and gets filled before its ramp: the
        # sword's own silhouette frame is the one case (see fill_outline).
        fill = pick[8] if len(pick) > 8 else None
        # A third, separate factor per axis, the same one a *stage* can name (see
        # rescale). 魔狱血刹's 成形 ring is the case: `kaaa-d1` is a 357x245 burst
        # and the reference's ring is a **circle**, so it is stretched on y until
        # the oval is round. Squeezing x instead would thin every ray.
        stretch = pick[9] if len(pick) > 9 and pick[9] is not None else (1.0, 1.0)
        if entry == "*":
            for _name, img in pack_entries(client, pack, board):
                decoded = decode_frames(img)
                if decoded:
                    layers.append(shift(rescale(decoded, scale, stretch), offset))
            continue
        wanted = palette_name(entry, board)
        found = dict(pack_entries(client, pack, board)).get(wanted)
        if found is None:
            print(f"  missing {pack}/{wanted}", file=sys.stderr)
            continue
        decoded = decode_frames(found)
        if decoded:
            decoded = select_frames(decoded, frames)
            if fill:
                decoded = fill_outline(decoded)
            decoded = tint(solidify(decoded, solid), ramp)
            layers.append(shift(rescale(decoded, scale, stretch), offset))
    if not layers:
        return [], (0, 0)
    # Every frame is composited onto one canvas covering the whole group, in the
    # client's own coordinates. Cropping each frame to what happens to be visible
    # at that instant (what this used to do) threw the coordinates away: a row
    # could not be anchored on the caster, and the effect jittered as layers came
    # and went.
    parts = [part for layer in layers for part in layer]
    # Rounded once, here: a layer's `offset` may be fractional (血之狂暴's blood
    # sword carries a per-frame one, measured to the tenth of a client pixel), and
    # a canvas is whole pixels - the same rule the staged path above follows.
    left = int(round(min(x for _p, x, _y in parts)))
    top = int(round(min(y for _p, _x, y in parts)))
    width = int(round(max(x + p.width for p, x, _y in parts))) - left
    height = int(round(max(y + p.height for p, _x, y in parts))) - top

    def frame_of(chosen):
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for picture, x, y in chosen:
            canvas.alpha_composite(picture, (int(round(x)) - left, int(round(y)) - top))
        return canvas

    if mode == "sequence":
        return [frame_of([part]) for part in parts], (left, top)
    length = max(len(layer) for layer in layers)
    frames = []
    for index in range(length):
        # Every layer is sampled at the same point of its own timeline. Wrapping
        # the shorter ones (what this used to do) restarted a six-frame ring two
        # or three times inside one cast, so the composited frame was a moment no
        # version of the move ever shows.
        at = index / max(1, length - 1)
        frames.append(frame_of([layer[round(at * (len(layer) - 1))] for layer in layers]))
    return frames, (left, top)


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
    anchors = {}
    origins = {}
    modes = {}
    for row, (skill, npk_name, entry, url) in enumerate(EFFECTS):
        print(f"{skill}:")
        if skill in PICKS:
            pick = PICKS[skill]
            entries = list(pick.get("stack") or pick.get("sequence") or [])
            mode = (
                "stages" if pick.get("stages")
                else "growth" if pick.get("growth")
                else "sequence" if pick.get("sequence")
                else "stack"
            )
            frames, origin = pick_frames(args.client, mode, entries, pick.get("palette", ""), pick)
            modes[skill] = mode
            described = (
                f"{len(pick['stages'])} stage(s) over {pick.get('length')} frames"
                if mode == "stages" else f"{len(entries)} entrie(s)"
            )
            print(
                f"  picked {mode} of {described}"
                f"{' ' + pick['palette'] if pick.get('palette') else ''}: {len(frames)} frames"
            )
        else:
            path = source(args, npk_name, entry, url, f"effect_{entry}")
            frames = sampled_row(decode_frames(load_img(path)))
            origin = (0, 0)
        rows[skill] = frames
        origins[skill] = origin
        anchors[skill] = PICKS.get(skill, {}).get("anchor")
    for name, pick in EXTRA_ROWS:
        entries = list(pick.get("stack") or pick.get("sequence") or [])
        mode = (
            "growth" if pick.get("growth")
            else "sequence" if pick.get("sequence")
            else "stack"
        )
        rows[name], origins[name] = pick_frames(
            args.client, mode, entries, pick.get("palette", ""), pick
        )
        print(f"{name}: picked {mode} of {len(entries)} entrie(s): {len(rows[name])} frames")
    for name, pick in FRONT_ROWS:
        rows[name], origins[name] = pick_frames(args.client, "stages", [], pick.get("palette", ""), pick)
        print(f"{name}: picked stages of {len(pick['stages'])} stages: {len(rows[name])} frames")

    # A front row is the other half of a skill's own picture, so it names the
    # skill it belongs to: both halves are anchored on the same client point, at
    # the same spot of their own cell, and the renderer is told what to draw each
    # one at (EFFECT.draw / EFFECT.frontDraw). Otherwise the two halves land in
    # different places and the fire comes out of the wrong part of the ground.
    matched = {}
    windows = {}
    for name, pick in FRONT_ROWS:
        base = pick.get("match")
        if not base or base not in rows:
            continue
        matched[name] = base
        # Each half of the picture gets its own window, and the renderer is told
        # what to draw each one at (EFFECT.draw / EFFECT.frontDraw). Two rows
        # sharing one window sounds tidier, but a window is a zoom: 大蹦's rift
        # is 800px of client art that needs the whole cell, and holding the fire
        # to that same zoom drew a 240px flame out of 35 cell pixels - which the
        # screen then blew up into mush. Anchoring both rows to the same client
        # point is what keeps them on top of each other; the window only decides
        # how much of the cell each one is allowed to use.
        #
        # A pick may declare its window instead of leaving it to whatever the
        # art happens to cover: both halves of 大蹦 are baked to one declared
        # window so the renderer needs one draw size for the pair, and so the
        # zoom does not drift when a layer is retuned.
        declared = pick.get("window") or PICKS[base].get("window")
        for row_name in (base, name):
            windows[row_name] = tuple(declared) if declared else anchored_window(
                ink_window(rows[row_name], origins[row_name]), PICKS[base].get("anchor")
            )
            # A declared window is a promise about the art: bake_frames draws
            # only the slice it names, so art outside it is silently dropped - a
            # spire with its top cut off, which reads as a bug in the game
            # rather than in the window. Say so here instead.
            ink = ink_window(rows[row_name], origins[row_name], padding=0)
            if ink and (
                ink[0] < windows[row_name][0] or ink[1] < windows[row_name][1]
                or ink[2] > windows[row_name][2] or ink[3] > windows[row_name][3]
            ):
                print(
                    f"  WARNING {row_name}: ink {ink} runs outside the declared "
                    f"window {windows[row_name]} and will be clipped",
                    file=sys.stderr,
                )
        print(f"  {base}: window {windows[base]}")
        print(f"  {name}: window {windows[name]} (anchor {PICKS[base]['anchor']})")

    # A rift row that is nobody's front half - 魔狱血刹's 火山 - is not in EFFECTS,
    # so it is picked here rather than in the loop above. It carries its own
    # window like 大蹦's rows do, for the same reason: its art is drawn far
    # bigger than a cell.
    for name in RIFT_ROWS:
        if name in rows:
            continue
        pick = PICKS[name]
        frames, origin = pick_frames(args.client, "stages", [], pick.get("palette", ""), pick)
        rows[name] = frames
        origins[name] = origin
        anchors[name] = pick.get("anchor")
        windows[name] = tuple(pick["window"])
        print(f"{name}: picked stages of {len(pick['stages'])} stage(s): {len(frames)} frames")

    # **The big-cell rows that are not skills must not widen this sheet.** 大蹦's
    # two rows are skills: their slots are kept here (empty) and their length is
    # part of the sheet's own width, which the renderer's `maxFrames` names.
    # 魔狱血刹's volcano is nobody's skill row - it lives on the big sheet only -
    # so its 60 columns are counted there and not here.
    effect_names = {skill for skill, _npk, _entry, _url in EFFECTS}
    columns = max(
        FRAMES,
        max(
            len(frames)
            for name, frames in rows.items()
            if name not in RIFT_ROWS or name in effect_names
        ),
    )
    sheet = Image.new(
        "RGBA",
        (CELL * columns, CELL * (len(EFFECTS) + len(EXTRA_ROWS) + len(FRONT_ROWS))),
        (0, 0, 0, 0),
    )
    counts = {}
    for row, (skill, _npk, _entry, _url) in enumerate(EFFECTS):
        # 大蹦's two rows are big art: they are baked to their own sheet, at
        # RIFT_CELL, further down. Their place in the grid is kept (and stays
        # empty here) so every other row keeps the number it is addressed by.
        if skill in RIFT_ROWS:
            continue
        # A row that is not the other half of some front row can still declare
        # its own window, and then that window is the zoom - the same promise
        # 大蹦's two rows make to each other. 怒气爆发 needs it for the other
        # reason a window is worth declaring: its art is drawn at two scales at
        # once (a ring on the floor and a column three Slayers tall), so an ink
        # window measured off the union would zoom the row to fit the tallest
        # thing in it and leave the ring a smudge. The clip says what both come
        # out at, so the window is stated rather than derived.
        declared = PICKS.get(skill, {}).get("window")
        window = tuple(declared) if declared else windows.get(skill)
        if declared:
            ink = ink_window(rows[skill], origins[skill], padding=0)
            if ink and (
                ink[0] < window[0] or ink[1] < window[1]
                or ink[2] > window[2] or ink[3] > window[3]
            ):
                print(
                    f"  WARNING {skill}: ink {ink} runs outside the declared "
                    f"window {window} and will be clipped",
                    file=sys.stderr,
                )
            print(
                f"  {skill}: window {window}, one client px is {fit_scale(window):.4f} "
                f"of a cell px, so `size` = {CELL / fit_scale(window):.2f} draws it 1:1"
            )
        # One call only: `bake_frames` pops leading and trailing empty frames off
        # the list it is given when no window is declared, so calling it twice
        # would time the row a second time from a list that had already lost its
        # head.
        counts[skill] = bake_frames(
            rows[skill], row, sheet, anchors[skill], origins[skill], window=window
        )
    for offset, (name, pick) in enumerate(EXTRA_ROWS):
        # An extra row can name a `core` (inner, outer): keep only what is inside
        # it, ramped out, and bake from there. 血球 needs it because the client's
        # picture is a ball *and* a ring it does not wear in the reference.
        core = pick.get("core")
        frames = [radial_core(frame, core[0], core[1]) for frame in rows[name]] if core else rows[name]
        counts[name] = bake_frames(frames, len(EFFECTS) + offset, sheet)
        if core:
            # What the shape left in the cell, as a fraction of it: `bake_frames`
            # pads its window, so this is *not* the same number as the window's
            # zoom and the renderer needs this one to size the draw.
            scale = fit_scale(ink_window(frames, origins[name]))
            ink = ink_window(frames, origins[name], padding=0)
            fill = (ink[2] - ink[0]) * scale / CELL
            print(
                f"  {name}: core {core}, the ball's ink is {ink[2] - ink[0]} client px "
                f"and fills {fill:.3f} of its cell"
            )
    for offset, (name, _pick) in enumerate(FRONT_ROWS):
        if name in RIFT_ROWS:
            continue
        counts[name] = bake_frames(
            rows[name],
            len(EFFECTS) + len(EXTRA_ROWS) + offset,
            sheet,
            PICKS.get(matched.get(name), {}).get("anchor"),
            origins[name],
            window=windows.get(name),
        )
    sheet.save(ROOT / "effects.png")
    print(f"wrote {ROOT / 'effects.png'} ({sheet.width}x{sheet.height})")

    # The two 大蹦 rows, on their own sheet at RIFT_CELL. Both are fitted to the
    # one window they declare, so one draw size in the renderer places both of
    # them: `size` is `window width * the move's client-px-per-screen-px`, and
    # the anchor lands on the caster's feet at `dy = -size / 4` (see
    # EFFECT.draw.mountainRift). This prints the size the windows come to, so a
    # retuned window can be carried across in one step.
    if any(name in rows for name in RIFT_ROWS):
        # The sheet is as wide as its own longest row (the volcano is 60 columns
        # where 大蹦's two are 45), and every row is drawn from column 0.
        rift_columns = max(
            columns, max(len(rows[name]) for name in RIFT_ROWS if name in rows)
        )
        rift = Image.new(
            "RGBA", (RIFT_CELL * rift_columns, RIFT_CELL * len(RIFT_ROWS)), (0, 0, 0, 0)
        )
        for index, name in enumerate(RIFT_ROWS):
            counts[name] = bake_frames(
                rows[name],
                index,
                rift,
                PICKS[matched.get(name, name)]["anchor"],
                origins[name],
                window=windows[name],
                cell=RIFT_CELL,
                margin=0,
            )
        rift.save(ROOT / RIFT_SHEET)
        print(f"wrote {ROOT / RIFT_SHEET} ({rift.width}x{rift.height})")
        print(
            "  draw size for the rift rows: "
            + ", ".join(
                f"{name}={RIFT_CLIENT_PX * RIFT_CELL / fit_scale(windows[name], RIFT_CELL, 0):.1f}"
                for name in RIFT_ROWS
            )
            + f" (window {windows[RIFT_ROWS[0]]}, a client px is {RIFT_CLIENT_PX:g} of a screen px)"
        )
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
