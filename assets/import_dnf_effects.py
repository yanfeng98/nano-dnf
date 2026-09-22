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
# Where an anchored row's ground line sits in the cell (0 = top, 1 = bottom).
GROUND_LINE = 0.75


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
#                and "alpha" (draw this stage at part strength - the rift's
#                cracks are dimmed under the lit ring so the quiet part of the
#                move reads as a ring, not as a lake of lava).
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
PICKS = {
    "upSlash": {"stack": [("", "upperslash.img")]},
    "mountainBreaker": {"stack": [("_hopsmash", "b_bottom_01_d.img")]},
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
    # sword it summons comes down (bloodsword_none, 20 frames), the ground splits
    # under it (floor, 11), the flames come out of the split (bloodsexp_1/2), the
    # glow behind them, the sparks (drops_1/2) and the debris (part).
    #
    # The owner signed this set off on assets/dnf_effect_anim/rift-outrage-break.png
    # after two earlier attempts missed it: stacking the whole pack pulled all
    # three colour boards at once (nine shapes drawn three times over), and the
    # next attempt threw the pack away for the base pack's fire pair. The board
    # here is "(tn)", the orange one the client's own preview erupts in; the
    # plain board of the same shapes is dark blood red.
    #
    # Sizes: the client scales these layers from the skill's animation data,
    # which is not part of the export, so each layer carries the factor that
    # makes it read like the preview (the flames tower over the caster, the
    # sword is a blade taller than the rift is wide).
    #
    # Two layers carry an offset. The sword is nudged forward (240px) because
    # this game draws skill art behind the caster: at the pack's own coordinates
    # its point lands on his feet and the blade simply disappears behind him,
    # and its trailing sweep then crossed back over him.
    # The rock debris (part) has no "(tn)" twin and its own frames sit at the
    # pack's origin - the game scatters it as a particle - so it keeps the plain
    # board and is offset onto the impact point.
    #
    # The anchor is the middle of outragebreak_floor.img (444x166 at x=160,
    # y=198): the rift the caster stands in and the sword lands in.
    #
    # Staged, not stacked: the owner's second look at the client (「这个技能应该
    # 是多个技能特效组合的」) is that the pack is one move in four acts - the
    # blade comes down, the floor breaks open, the rift keeps glowing and the
    # magma erupts twice - and stacking all eight layers at once put every act on
    # screen in the same 0.34s. The windows below are that reading off the
    # client's own 100-frame preview (rift-outrage-break-layers.txt): the preview
    # lands at frame 23, erupts wide over 24-31, holds the ring over 32-59 and
    # erupts tall over 60-93.
    #
    # This row is what is drawn behind the Slayer (the ground and the blade); the
    # fire he throws is FRONT_ROWS below, baked to this same window so the two
    # halves land on the same pixels.
    "mountainRift": {"palette": "(tn)", "pack": "_outragebreak", "anchor": (382, 281),
                     "length": 45, "stages": [
        # The blade falls through the end of the leap and lands on touchdown;
        # the row starts 0.2s before he does, which is why the effect window
        # starts before activeFrom (see EFFECT.timing.mountainRift).
        # Pushed 320px forward: this game draws skill art behind the Slayer, and
        # at the pack's own coordinates the blade's point lands on his feet and
        # the whole swing disappears behind him. 240 was not enough - the strike
        # still read as landing on the left of the rift - so it now lands in the
        # middle of it, where the fire comes up.
        {"entry": "outragebreak_bloodsword_none.img", "scale": 1.4, "offset": (320, 0), "from": 0.00, "until": 0.14},
        # The floor: one frame of the ground coming apart, then the molten ring
        # blooming out of it with rocks thrown up, then the cracks that keep
        # glowing on the floor for the rest of the move.
        #
        # The whole ground is blown up 1.8x. The pack draws the rift at its own
        # scale - the biggest ring is 239px of client art - which came out at
        # 232px on screen, smaller than the 380px the move's own radius (190)
        # reaches and much smaller than the client's rift, which covers about
        # 60% of its screen. Everything else in the row keeps the size the owner
        # already signed off, because the draw size scales with the window (see
        # EFFECT.draw.mountainRift).
        {"entry": "outragebreak_floor.img", "scale": 1.8, "frames": (0, 1), "from": 0.12, "until": 0.18},
        {"entry": "outragebreak_floor.img", "scale": 1.8, "frames": (2, 7), "from": 0.13, "until": 0.30},
        # The crack field is drawn at half strength. Blown up 1.8x it covered the
        # floor as a lake of bright lava for the whole quiet stretch, where the
        # client shows a dark rift with a lit ring.
        {"entry": "outragebreak_floor.img", "scale": 1.8, "alpha": 0.5, "frames": (8, 10), "from": 0.22, "until": 1.00},
        # The ring itself stays on the floor while the cracks crawl out of it -
        # the client's preview (frames 32-59) has the ring lit the whole lull. It
        # is painted last, over the dimmed cracks, so it is the one thing on the
        # ground that stays bright.
        {"entry": "outragebreak_floor.img", "scale": 1.8, "frames": (5, 5), "from": 0.30, "until": 1.00},
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
# The row is baked to the same window as EFFECTS' row for the same skill, so the
# two halves share one anchor line and one scale: split them and the fire would
# sit somewhere else in the cell than the rift it comes out of.
FRONT_ROWS = [
    ("mountainRiftFire", {"palette": "(tn)", "pack": "_outragebreak",
                          "match": "mountainRift", "length": 45, "stages": [
        # The strike's own flash, on the landing. It is the pack's soft disc and
        # its starburst, not a flame, so it stays a light rather than a fire -
        # and it stays small, because over a low fire a big soft disc does not
        # read as a flash, it washes the flames out.
        {"entry": "outragebreak_bloodsexp_glow.img", "scale": 0.9, "offset": (-38, 0),
         "from": 0.11, "until": 0.19},
        # The fire is a *rank of pillars standing on the rift's ring*, not one
        # column beside it. The owner's note on the client's own preview is
        # 「它是多个火焰柱子，喷发」 - several pillars erupting - and the way the
        # game gets them is to stamp the pack's two flame shapes (bloodsexp_1,
        # the wide bush of tongues, and bloodsexp_2, the narrow spire) several
        # times along the ground. One copy read as a single spout.
        #
        # So both waves are ranks of five, and the rank is laid out along the
        # ring the rift itself draws (a place every 130px of client art, the
        # outermost at 260 - the pack's floor ring is 283x112 blown up 1.8x, so
        # it reaches ~254 either side of the caster). A place is measured from
        # the middle of the rift: the art's own centre is x=420 for the bush
        # (474 for the spire), the caster stands on x=382, so a place's offset
        # is (place + 382 - centre).
        #
        # The rank is not a picket fence: the middle pillar is the tallest, the
        # ones either side of it a size smaller and the outer pair smaller
        # again, and each pair erupts a little after the one inside it. Equal
        # flames on an equal beat read as a fence, not as ground breaking open.
        #
        # Height is deliberately kept inside the window the rift and the blade
        # already need (client y 26-373): the two halves share one window and
        # one scale, so a pillar that pokes out of it would shrink the ring the
        # fire is supposed to be growing out of. The bush's tallest frame is
        # 127px of client art and the spire's 179, drawn 1:1, so these read
        # 1.05-1.55 Slayers tall, which is what the client's own preview erupts
        # (its fire stands about one and a half casters high) and stays on the
        # low side of the height the owner has already sent back twice - the
        # old ×3.2 single column ran off the top of the arena, and this is not
        # that column made plural.
        #
        # They are also raised: 大蹦's ring lies on the floor as an ellipse, so
        # a fire rooted *under* the far edge of that ellipse is the one that
        # reads as coming out of it. -45px for the bush (its own art already
        # hangs ~37px below the anchor) and -15px for the spire (rooted on the
        # anchor) both put the base of a flame on the same band, ~10px above the
        # ground line.
        {"entry": "outragebreak_bloodsexp_1_none.img", "scale": 0.85, "offset": (-38, -45),
         "from": 0.12, "until": 0.35},
        {"entry": "outragebreak_bloodsexp_1_none.img", "scale": 0.75, "offset": (-168, -45),
         "from": 0.14, "until": 0.34},
        {"entry": "outragebreak_bloodsexp_1_none.img", "scale": 0.75, "offset": (92, -45),
         "from": 0.14, "until": 0.34},
        {"entry": "outragebreak_bloodsexp_1_none.img", "scale": 0.65, "offset": (-298, -45),
         "from": 0.16, "until": 0.32},
        {"entry": "outragebreak_bloodsexp_1_none.img", "scale": 0.65, "offset": (222, -45),
         "from": 0.16, "until": 0.32},
        # Molten drops land on the ring and spread, and the slam throws debris.
        {"entry": "outragebreak_drops_1.img", "scale": 1.3, "from": 0.20, "until": 0.46},
        # The debris has no "(tn)" twin of its own - it is plain art, and asking
        # for the orange board of it finds nothing and draws no rocks at all.
        {"entry": "outragebreak_part.img", "board": "", "scale": 1.0, "offset": (250, 190),
         "from": 0.14, "until": 0.36},
        # Then the second wave: the client's own second eruption (its preview
        # erupts at frame 60 and runs to the end of the clip) is where the pack
        # switches to bloodsexp_2, the narrow spire. The same rank of five, the
        # middle ones first, a size taller than the first wave and rooted a
        # little further out of the ring.
        {"entry": "outragebreak_drops_2.img", "scale": 1.3, "from": 0.36, "until": 0.62},
        {"entry": "outragebreak_part.img", "board": "", "scale": 1.0, "offset": (250, 190),
         "from": 0.58, "until": 0.86},
        {"entry": "outragebreak_bloodsexp_2_none.img", "scale": 0.70, "offset": (-91, -15),
         "from": 0.54, "until": 0.88},
        {"entry": "outragebreak_bloodsexp_2_none.img", "scale": 0.60, "offset": (-221, -15),
         "from": 0.56, "until": 0.87},
        {"entry": "outragebreak_bloodsexp_2_none.img", "scale": 0.60, "offset": (39, -15),
         "from": 0.56, "until": 0.87},
        {"entry": "outragebreak_bloodsexp_2_none.img", "scale": 0.50, "offset": (-351, -15),
         "from": 0.58, "until": 0.85},
        {"entry": "outragebreak_bloodsexp_2_none.img", "scale": 0.50, "offset": (169, -15),
         "from": 0.58, "until": 0.85},
        {"entry": "outragebreak_bloodsexp_glow.img", "scale": 0.9, "offset": (-38, 0),
         "from": 0.58, "until": 0.66},
        # The flames die back onto the ring: the bush's own last frames, which
        # are embers rather than fire, so the row ends on the lit rift the way
        # the client's preview does.
        {"entry": "outragebreak_bloodsexp_1_none.img", "frames": (5, 6), "scale": 0.75,
         "offset": (-38, -45), "from": 0.88, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "frames": (5, 6), "scale": 0.65,
         "offset": (-168, -45), "from": 0.90, "until": 1.00},
        {"entry": "outragebreak_bloodsexp_1_none.img", "frames": (5, 6), "scale": 0.65,
         "offset": (92, -45), "from": 0.90, "until": 1.00},
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


def union_window(*windows):
    """One window covering all of them, or None when there is nothing to cover."""
    live = [window for window in windows if window is not None]
    if not live:
        return None
    return (
        min(window[0] for window in live),
        min(window[1] for window in live),
        max(window[2] for window in live),
        max(window[3] for window in live),
    )


def bake_frames(frames, row: int, sheet: Image.Image, anchor=None, origin=(0, 0), window=None) -> int:
    """Draw one skill row from already-composited frames.

    `anchor` is the client-space point the move is rooted at (the caster's feet).
    `origin` is where the row's canvas sits in that same client space, so the
    anchor can be translated onto the frames before they are placed.
    Given one, the row is placed so that point sits at the bottom of the cell's
    middle, whatever shape the bounding box has; without one the row is centred
    as before.

    `window` is a slice of the client's own coordinates to draw from - the same
    thing the union of the frames would give, but chosen from outside so two rows
    that belong to one picture (大蹦's rift behind the Slayer and its fire in
    front) can share one window, one scale and one anchor line. A row drawn to an
    outside window keeps the columns it was given: nothing is trimmed off the
    front, because its timeline is another row's timeline.
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
    scale = min((CELL - 8) / span_w, (CELL - 8) / span_h)
    placed_w = max(1, int(span_w * scale))
    placed_h = max(1, int(span_h * scale))
    if anchor is None:
        offset_x = (CELL - placed_w) // 2
        offset_y = (CELL - placed_h) // 2
    else:
        across = clamp01((anchor[0] - window[0]) / max(1, span_w))
        down = clamp01((anchor[1] - window[1]) / max(1, span_h))
        offset_x = round(CELL / 2 - across * placed_w)
        offset_y = round(CELL * GROUND_LINE - down * placed_h)
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
        cell_image = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell_image.alpha_composite(layer, (offset_x, offset_y))
        sheet.alpha_composite(cell_image, (column * CELL, row * CELL))

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

    # A front row is the other half of a skill's own picture, so it is baked to
    # that skill's window: same slice of the client's coordinates, same scale,
    # same anchor line. Otherwise the two halves land in different places in
    # their cells and the fire comes out of the wrong part of the ground.
    shared = {}
    matched = {}
    for name, pick in FRONT_ROWS:
        base = pick.get("match")
        if not base or base not in rows:
            continue
        matched[name] = base
        shared[name] = union_window(
            ink_window(rows[base], origins[base]),
            ink_window(rows[name], origins[name]),
        )

    columns = max(FRAMES, max(len(frames) for frames in rows.values()))
    sheet = Image.new(
        "RGBA",
        (CELL * columns, CELL * (len(EFFECTS) + len(EXTRA_ROWS) + len(FRONT_ROWS))),
        (0, 0, 0, 0),
    )
    counts = {}
    for row, (skill, _npk, _entry, _url) in enumerate(EFFECTS):
        window = None
        for name, base in matched.items():
            if base == skill:
                window = shared[name]
        counts[skill] = bake_frames(rows[skill], row, sheet, anchors[skill], origins[skill], window)
    for offset, (name, _pick) in enumerate(EXTRA_ROWS):
        counts[name] = bake_frames(rows[name], len(EFFECTS) + offset, sheet)
    for offset, (name, _pick) in enumerate(FRONT_ROWS):
        counts[name] = bake_frames(
            rows[name],
            len(EFFECTS) + len(EXTRA_ROWS) + offset,
            sheet,
            PICKS.get(matched.get(name), {}).get("anchor"),
            origins[name],
            window=shared.get(name),
        )
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
