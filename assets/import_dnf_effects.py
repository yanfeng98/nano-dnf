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
  崩山裂地斩  effect/outragebreak/*.img  (the move's own pack; the fire-front pair
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

from PIL import Image, ImageChops, ImageFilter

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
RIFT_ROWS = ("mountainRift", "mountainRiftFire")
RIFT_SHEET = "rift.png"
# How much of a screen pixel one client pixel of that sheet gets, at the size
# the renderer draws it: the number that puts the pack's 445px floor on the
# reference's 265px gash. `size` in src/render.js is `window width * this`.
RIFT_CLIENT_PX = 0.596


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))

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
#   one layer  - a stack entry may carry, after its name, a scale factor, a
#                colour board of its own, and an (dx, dy) offset: the client
#                sizes and scatters some layers from the skill's animation data,
#                which the export does not carry
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
    "crossSlash": {"stack": [("_gorecross", "gorecross_cross.img")]},
    # 血气之刃: the blood sword is thrust, then it bursts.
    "bloodSword": {"sequence": [("_bloodsword", "sword_normal.img"), ("_bloodsword", "exp_dodge.img")]},
    # 血之狂暴: the dual-blade glow that rides the normal attack.
    "frenzy": {"stack": [("_frenzy", "blood-energy.img")]},
    "bloodyRave": {"stack": [("_bloodyrave", "*")]},
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
    "graspHead": {"stack": [("_grabblastblood", "*")]},
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
}

# Rows after the skill rows, for art a move needs away from its own cast: the
# owner picked these two entries out of the same 血之狂暴 pack and gave them
# different jobs. The orbs used to ride along inside the dual-blade row, which
# put a slash arc on every drop of blood that flew into the character.
EXTRA_ROWS = [
    ("bloodOrb", {"stack": [("_frenzy", "blood-stone-0.img")]}),
    # 银光落刃: the up-slash arc, drawn rotated in the game so it reads as the
    # blade coming down with the dive.
    ("diveSlash", {"stack": [("", "upperslash.img")]}),
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


def shift(decoded, offset):
    """Move one layer by (dx, dy) in the client's own coordinates.

    The game positions particle layers (the debris a slam kicks up) from the
    skill's animation data rather than from the .img, so an export leaves them
    stacked at the pack's origin; a pick can put them where the move throws them.
    """
    if not offset or offset == (0, 0):
        return decoded
    return [(picture, x + offset[0], y + offset[1]) for picture, x, y in decoded]


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


def tint(decoded, stops):
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
        recoloured = Image.merge(
            "RGB",
            (level.point(tables[0]), level.point(tables[1]), level.point(tables[2])),
        ).convert("RGBA")
        recoloured.putalpha(picture.convert("RGBA").getchannel("A"))
        out.append((recoloured, x, y))
    return out


def stage_layers(client: Path, pick: dict):
    """Every stage of a staged pick, as (frames, from, until) in row progress."""
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
        decoded = tint(decoded, stage.get("ramp"))
        decoded = dim(
            shift(
                rescale(
                    decoded,
                    scale,
                    tuple(stage.get("stretch", (1.0, 1.0))),
                    stage.get("about"),
                ),
                offset,
            ),
            stage.get("alpha", 1.0),
        )
        # Filling is a *scale* thing, so it runs after the shape has been grown:
        # the gaps a layer needs closed are the ones it has on screen, not the
        # ones it had at the pack's own size.
        decoded = fill_gaps(decoded, int(stage.get("fill", 0)))
        decoded = flatten_base(decoded, int(stage.get("base", 0)))
        first, last = stage.get("frames", (0, len(decoded) - 1))
        part = decoded[first:last + 1]
        if not part:
            print(f"  empty stage {pack}/{wanted} frames {first}-{last}", file=sys.stderr)
            continue
        out.append((part, float(stage["from"]), float(stage["until"])))
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
        parts = [part for layer, _from, _until in layers for part in layer]
        left = min(x for _p, x, _y in parts)
        top = min(y for _p, _x, y in parts)
        width = max(x + p.width for p, x, _y in parts) - left
        height = max(y + p.height for p, _x, y in parts) - top
        length = max(2, int((spec or {}).get("length", 45)))
        frames = [Image.new("RGBA", (width, height), (0, 0, 0, 0)) for _ in range(length)]
        for layer, start, until in layers:
            first = round(clamp01(start) * (length - 1))
            last = max(first, round(clamp01(until) * (length - 1)))
            for index in range(first, last + 1):
                at = (index - first) / max(1, last - first)
                picture, x, y = layer[round(at * (len(layer) - 1))]
                frames[index].alpha_composite(picture, (x - left, y - top))
        return frames, (left, top)

    layers = []
    for pick in entries:
        pack, entry = pick[0], pick[1]
        scale = float(pick[2]) if len(pick) > 2 and pick[2] is not None else 1.0
        # A layer can name its own board: the client draws 怒气爆发's pool of
        # blood in the plain (red) art and the eruption above it in white-gold.
        board = pick[3] if len(pick) > 3 and pick[3] is not None else palette
        offset = pick[4] if len(pick) > 4 and pick[4] is not None else (0, 0)
        if entry == "*":
            for _name, img in pack_entries(client, pack, board):
                decoded = decode_frames(img)
                if decoded:
                    layers.append(shift(rescale(decoded, scale), offset))
            continue
        wanted = palette_name(entry, board)
        found = dict(pack_entries(client, pack, board)).get(wanted)
        if found is None:
            print(f"  missing {pack}/{wanted}", file=sys.stderr)
            continue
        decoded = decode_frames(found)
        if decoded:
            layers.append(shift(rescale(decoded, scale), offset))
    if not layers:
        return [], (0, 0)
    # Every frame is composited onto one canvas covering the whole group, in the
    # client's own coordinates. Cropping each frame to what happens to be visible
    # at that instant (what this used to do) threw the coordinates away: a row
    # could not be anchored on the caster, and the effect jittered as layers came
    # and went.
    parts = [part for layer in layers for part in layer]
    left = min(x for _p, x, _y in parts)
    top = min(y for _p, _x, y in parts)
    width = max(x + p.width for p, x, _y in parts) - left
    height = max(y + p.height for p, _x, y in parts) - top

    def frame_of(chosen):
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for picture, x, y in chosen:
            canvas.alpha_composite(picture, (x - left, y - top))
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
            mode = "stages" if pick.get("stages") else ("sequence" if pick.get("sequence") else "stack")
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
        mode = "sequence" if pick.get("sequence") else "stack"
        rows[name], origins[name] = pick_frames(args.client, mode, entries, pick.get("palette", ""))
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

    columns = max(FRAMES, max(len(frames) for frames in rows.values()))
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
    for offset, (name, _pick) in enumerate(EXTRA_ROWS):
        counts[name] = bake_frames(rows[name], len(EFFECTS) + offset, sheet)
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
        rift = Image.new(
            "RGBA", (RIFT_CELL * columns, RIFT_CELL * len(RIFT_ROWS)), (0, 0, 0, 0)
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
