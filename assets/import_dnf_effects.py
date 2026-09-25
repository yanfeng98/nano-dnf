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

from PIL import Image, ImageChops

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
FLOOR_RAMP = [
    (0.00, (32, 8, 5)),
    (0.35, (120, 44, 30)),
    (0.70, (185, 74, 52)),
    (1.00, (235, 150, 120)),
]
# The rock the floor is made of, lifted off the pack's own near-black. The
# reference's plate field is plainly brighter than the room behind it, and the
# pack's copy (mean 57,48,44) is not: drawn as exported it disappears into the
# arena's own dark floor. This is a ramp on the *pack's* art, not new art - it
# keeps the plates and their speckle and only opens the levels up.
ROCK_RAMP = [
    (0.00, (72, 66, 60)),
    (0.40, (112, 102, 92)),
    (1.00, (190, 178, 158)),
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
    "mountainBreaker": {"length": 6, "pack": "_hopsmash", "anchor": (79, 242), "stages": [
        {"entry": "d-end.img", "frames": (0, 1), "scale": 1.4, "from": 0.0, "until": 0.30},
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
    # 怒气爆发: the pack's ground ring, the blood pillar and the hit flash.
    # Stacking the whole pack shrank everything - one layer is 355x387, so the
    # composite had to scale down to fit and the blood read as a smudge. The
    # dark streak fields (blood-d2, bloodreddodge) stay out for the same reason:
    # the client draws them additively, this sheet cannot.
    #
    # The eruption is the "(tn)" board: the client's own preview shows a
    # white-gold column coming out of a ring, and that board is exactly that art
    # (plain "blood-front" measures [204,28,0], "(tn)" [249,236,200]).
    #
    # The pack holds two clusters of layers, and only one of them is the caster:
    # blood / blood_floor_front / blood_floor_back / blood_back / bloodred all
    # sit within +-90px of the ring's middle, while b-01, blood-b, blood-front and
    # blastbloodhit sit 160-270px off to the left. Stacking both clusters made the
    # move look like two effects at once, so the left cluster stays out.
    #
    # The anchor is the middle of the pack's own floor ring (blood_floor.img, 251
    # wide at x=219, y=328): that is where the caster stands and where the ring
    # has to meet his feet. Without it the row was centred on its bounding box,
    # which put the eruption column a third of a screen to his left.
    "rageBurst": {"palette": "(tn)", "anchor": (344, 365), "stack": [
        ("_blastblood", "blood_floor_front.img"),
        ("_blastblood", "blood_floor_back.img"),
        ("_blastblood", "blood-back.img"),
        ("_blastblood", "bloodred.img"),
        ("_blastblood", "blood.img"),
        ("_blastblood", "blood-d1.img"),
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
                     "length": 45, "window": (120, -140, 960, 420), "stages": [
        # The pack ships the broken floor as three things, and the reference
        # wants all three: f0 is the dark plate field itself (mean 57,48,44 - it
        # keeps the pack's own grey), f1 is the seams through it, f2-f6 is the
        # molten ring blooming out of the split, and f8-f10 is the lit lattice
        # that stays glowing in the seams afterwards. The seams and the lattice
        # carry the reference's lava-line ramp; the rock does not.
        #
        # The floor is placed by the ring's own middle, (382, 281) before it is
        # scaled - at 1.30x about its bottom centre that point moves to
        # (381.9, 256.1) - so (170, 35) puts the ring 170px in front of him,
        # where the reference's blade lands, and drops it into the gash.
        {"entry": "outragebreak_floor.img", "ramp": ROCK_RAMP, "frames": (0, 0), "scale": 1.30, "offset": (170, 35), "from": 0.265, "until": 1.00},
        {"entry": "outragebreak_floor.img", "ramp": ROCK_RAMP, "frames": (1, 1), "scale": 1.30, "offset": (170, 35), "from": 0.275, "until": 1.00},
        {"entry": "outragebreak_floor.img", "frames": (2, 6), "scale": 1.30, "offset": (170, 35), "from": 0.265, "until": 0.35},
        # The ring stays lit on the floor through the quiet stretch (the
        # reference holds it from the landing to the second eruption), painted
        # last so it is the one thing on the ground that never dims.
        {"entry": "outragebreak_floor.img", "frames": (5, 5), "scale": 1.30, "offset": (170, 35), "from": 0.35, "until": 1.00},
        {"entry": "outragebreak_floor.img", "ramp": FLOOR_RAMP, "frames": (8, 10), "scale": 1.30, "offset": (170, 35), "from": 0.34, "until": 1.00},
        # Rock thrown up by the slam and by the second eruption. `part` has no
        # colour board of its own and its frames sit at the pack's origin (the
        # client scatters it as a particle), so it keeps the plain art and each
        # scatter names the place it lands.
        {"entry": "outragebreak_part.img", "board": "", "scale": 2.4, "offset": (533, 269), "from": 0.28, "until": 0.46},
        {"entry": "outragebreak_part.img", "board": "", "scale": 2.4, "offset": (330, 291), "from": 0.60, "until": 0.76},
        # The near end of the gash is where his own body is, so the two spires
        # that come up there are composited before he is drawn, not over him.
        # A place is (382 + u, 289 + 0.12u) and the spire's own bottom centre is
        # (474, 282), which is what its offset is measured from.
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.35,
         "offset": (-72, 9), "from": 0.56, "until": 0.90},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.20,
         "offset": (-137, 2), "from": 0.58, "until": 0.88},
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
                          "window": (120, -140, 960, 420), "stages": [
        # The blood sword 举剑 carries - the owner reads the move as 先举剑 and
        # points at the client's own body frames 123-124 for it, and the
        # reference shows a flame blade standing off the raised hands (its
        # #45-#51). The pack's blade is its own gesture in two parts: a wisp that
        # gathers where the point will fall (f0-f10), a sweep across (f11-f12),
        # and then the burst that is the blade going into the ground (f13-f19).
        #
        # Both halves of the move are baked to the same window, so both are drawn
        # at the same client-px-per-screen-px and this row lands on the rift.
        # This is the half that passes *in front* of the Slayer: on his own row
        # the blade lands on his feet and his body swallows it.
        #
        # The wisp gathers over his head (u 50, his own head line pulled up) and
        # the burst goes into the ring the floor row puts down at u 170 - the
        # beat the slam lands on, `activeFrom`. Offsets are measured from the
        # entry's own bottom centre: the wisp's is (174, 284) once it has grown,
        # the burst's (299, 284).
        {"entry": "outragebreak_bloodsword_none.img", "ramp": FIRE_RAMP, "scale": 1.84,
         "offset": (248, -130), "frames": (0, 12), "from": 0.00, "until": 0.28},
        {"entry": "outragebreak_bloodsword_none.img", "ramp": FIRE_RAMP, "scale": 2.00,
         "offset": (253, 16), "frames": (13, 19), "from": 0.28, "until": 0.37},
        # The pack's soft disc and its starburst, not a flame, so they stay a
        # light: one on the impact, then a bigger one left burning under the
        # first wave. Both are the pack's glow, whose bottom centre is (482, 353)
        # - the same place, so the flash and the core do not jump.
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (1, 1),
         "scale": 0.55, "offset": (70, -44), "from": 0.27, "until": 0.34},
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
        # fresh split, tall in the middle of the ring and dying away at the ends.
        # Sizes are read off the reference - its first wave is ~120px of screen,
        # a bush's tallest frame is 127px of client art drawn at 0.596, so ~1.55
        # at the middle and a step down either side.
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.85,
         "offset": (23, 21), "from": 0.29, "until": 0.43},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.57,
         "offset": (18, -28), "from": 0.30, "until": 0.42},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.35,
         "offset": (148, -13), "from": 0.31, "until": 0.42},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.20,
         "offset": (158, 37), "from": 0.32, "until": 0.41},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.10,
         "offset": (283, 3), "from": 0.33, "until": 0.40},
        # Molten drops land along the gash and spread.
        {"entry": "outragebreak_drops_1.img", "ramp": FIRE_RAMP, "scale": 3.0,
         "offset": (233, 40), "from": 0.32, "until": 0.44},
        {"entry": "outragebreak_drops_2.img", "ramp": FIRE_RAMP, "scale": 3.0,
         "offset": (150, 40), "from": 0.44, "until": 0.56},
        # Then the second wave - the reference's #84-#115, the shot everyone
        # remembers: a hedge of tongues running the whole length of the gash,
        # tallest just past the middle. Nine of them, and three bushes at their
        # feet so the bases are not separate candles. A spire's tallest frame is
        # 181px of client art and the reference's second wave is ~213px of
        # screen, so ~2.1 down the middle and a step down at the ends; the
        # highest tongue tops out at y -76 and the widest spans x 429-615, both
        # still inside the declared window.
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.62,
         "offset": (-12, 17), "from": 0.55, "until": 0.90},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 2.11,
         "offset": (48, 24), "from": 0.54, "until": 0.91},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.57,
         "offset": (108, 31), "from": 0.56, "until": 0.90},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 2.11,
         "offset": (168, 38), "from": 0.54, "until": 0.91},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.84,
         "offset": (228, 45), "from": 0.55, "until": 0.90},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 1.51,
         "offset": (288, 53), "from": 0.57, "until": 0.89},
        {"entry": "outragebreak_bloodsexp_2_none.img", "ramp": FIRE_RAMP, "scale": 0.92,
         "offset": (343, 59), "from": 0.59, "until": 0.88},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.15,
         "offset": (18, -28), "from": 0.56, "until": 0.89},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.25,
         "offset": (138, -14), "from": 0.55, "until": 0.90},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "scale": 1.20,
         "offset": (263, 1), "from": 0.57, "until": 0.89},
        # The two hot cores, drawn last so they read through the tongues the way
        # the reference's white-yellow base does.
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (0, 0),
         "scale": 0.45, "offset": (40, -47), "from": 0.56, "until": 0.82},
        {"entry": "outragebreak_bloodsexp_glow.img", "ramp": FIRE_RAMP, "frames": (0, 0),
         "scale": 0.45, "offset": (160, -33), "from": 0.57, "until": 0.82},
        # The flames die back onto the gash: the bush's own last frames are
        # embers rather than fire, so the row ends on the lit rift the way the
        # reference does (its last thirty frames are cracks and glow).
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 1.30, "offset": (48, -28), "from": 0.88, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 1.20, "offset": (168, -14), "from": 0.90, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "ramp": FIRE_RAMP, "frames": (5, 6),
         "scale": 1.15, "offset": (293, 1), "from": 0.91, "until": 1.00},
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
def rescale(decoded, scale: float):
    """Grow one layer about the point it lands on (its bottom centre).

    The client sizes some effect layers from the skill's animation data rather
    than from the .img, so an export can hand back a blade that is a tenth of the
    size the game draws it at. Scaling about the bottom centre keeps whatever the
    layer touches - the floor, usually - where the pack put it.
    """
    if scale == 1.0:
        return decoded
    grown = []
    for picture, x, y in decoded:
        width = max(1, int(round(picture.width * scale)))
        height = max(1, int(round(picture.height * scale)))
        grown.append((
            picture.resize((width, height), Image.LANCZOS),
            int(round(x + (picture.width - width) / 2)),
            int(round(y + picture.height - height)),
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
        decoded = dim(shift(rescale(decoded, scale), offset), stage.get("alpha", 1.0))
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
        counts[skill] = bake_frames(
            rows[skill], row, sheet, anchors[skill], origins[skill], window=windows.get(skill)
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
