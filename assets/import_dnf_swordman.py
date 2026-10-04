#!/usr/bin/env python3
"""Bake the player sprite sheet (assets/slayer.png) from a local DNF client.

The sheet keeps the layout the renderer expects (COLS columns x 5 rows of
SPRITE.frameW x SPRITE.frameH cells, rows idle/run/attack/skill/extras) and
replaces the hand-drawn Slayer with the client's swordman art: skin + shoes +
pants + coat + face + hair (the "default look"), the katana he actually
holds (DNF keeps the weapon out of the body img), and the Berserker red-eye and
blood-aura overlays.

Local-only tool: it reads copyrighted game files from the client install
(default C:\\dnf via WSL) and writes derived art into the repo. Do not publish
the generated sheet. `make_slayer_sprites.py` regenerates the original
licence-clean art.

    python3 assets/import_dnf_swordman.py                 # bake the sheet
    python3 assets/import_dnf_swordman.py --preview       # labelled check sheet
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from pydnfex.img.image.format import FormatConvertor
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK
from pydnfex.util import image as image_util

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "assets" / "dnf_src" / "swordman"
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")

# Renderer contract (mirrors src/render.js SPRITE). The cell has to hold the
# whole DNF frame, sword and slash arc included: the attack's swings reach 115px
# right and 120px above the feet, the run and knockdown art 82px left of it, so
# the old 96x96 cell silently cropped blades and cut the white arcs in half.
# The anchor stays the character's ground point, which is what keeps every row,
# and both facings, lined up on the same spot.
FRAME_W = 208
FRAME_H = 176
# 64 rather than 57 when 血之狂暴's cast became its own seventeen-frame motion
# (2026-10-03). At 57 the four `clips` entries came to 51 columns and the stance
# needs 17, which overflows the row - and an overflowing clip is *truncated*, not
# spilled: the packer breaks out of that clip's frame loop the moment the column
# runs past COLS, so two of its frames would have gone missing with nothing said.
# **The packer walks CLIPS across both rows and the layout shifts when COLS
# does** - it prints where each clip landed, and src/render.js SPRITE.skillClips
# has to be re-read off that print, not hand-guessed.
#
# (57 was itself a raise, from 47, when 暴走's ten-frame cast went in. Same
# hazard, same fix, and the same note.)
COLS = 64
ANCHOR_X = 88
ANCHOR_Y = 156
ROWS = ["idle", "run", "attack", "skill", "extras", "clips", "clips2", "bloodblade", "flare",
        # 血之狂暴's own swing - see CELLS["rage"] - and, right below it, the
        # client's slash arc alone (`ragearc`). The order is what the renderer's
        # `SPRITE.rows` names: rage 9, ragearc 10, and a swap of the two draws the
        # graded copy of the whole Slayer as his swing (docs/adr/0019).
        "rage", "ragearc"]

# Per-move body animations, picked by the owner off the body sheet next to each
# skill's own client clip. Only the picked frames go in: widening them to their
# neighbours made the move look like it was doing extra swings it never had.
# The renderer paces the frames per beat instead (see src/render.js skillClips).
#   崩山击     raise the blade, hold it overhead through the hop, then drive it
#              down. The owner asked for the move to match the client's own
#              preview (assets/dnf_src/bilibili/skill-clips/01_崩山击.mp4, the
#              training-room clip) frame for frame, and the clip in that preview
#              starts on the lift, not on the pose the lift ends in: 187 (the
#              blade still down and forward, where the character already stands),
#              194 (both hands up, the blade over the head) and 203 (the same
#              raise on the client's own 举剑 frame), then the coil 204-205, the
#              crescent of the smash 206-207, the low lunge it lands in 208-209,
#              and then the client's own get-up: 210 (up off the back knee, the
#              blade across his chest) and 211 (nearly upright), back onto 187 -
#              the pose he is standing in - which is where the training-room clip
#              leaves him too (#51-56 rises and returns to the idle it started
#              from; without this the move held the lunge for the last third of
#              its cast, with the reference already standing).
#              The client's own hop frames (127-132) are out: they carry
#              no sword motion, which is what made the leap read as a second
#              wind-up in front of the smash (owner: 「举剑过头」is part of the
#              jump, so putting the raise back is the point of this cut).
#   怒气爆发   action 10 (8 frames)
#   十字斩     seven poses, one per act of the training-room clip
#              (02_十字斩.mp4): 5 the crouched ready the clip opens on and holds
#              to #25, 14 the standing forward sweep, 37 the sword coming up
#              (#33-36), **66 the stand he holds through the 十 (#37-44)**, 200
#              the low crouch he drops into as the blood fan bursts (#45-47),
#              200 the same crouch held while it burns (#48-52), and 187 the
#              plain stand he is left in (#53 on). The old cut ran the client's
#              own 5-18 thrust combo and then 198-203, which ended him on an
#              overhead crescent swing the clip never makes.
#
#              **66 replaced 38 and 199 when the owner had this move redone to
#              the clip.** 38 is the blade held straight overhead and 199 is the
#              low lunge; the clip's #39-#43 is neither - he *stands* with the
#              sword thrust out in front of him, and 66 is that pose. That beat
#              is half the cast, so getting it wrong put the character's whole
#              silhouette at odds with the reference for 0.25s. 200 now covers
#              the drop as well, because the clip drops him between #43 and #44
#              and keeps him there past #54 - there is no separate pose to name.
#   血之狂暴   action 22 (9 frames) - the stand that flings both arms out
#   崩山裂地斩 举剑, leap, land prone, get up. The owner's note is 「崩山裂地斩是
#              先举剑，参考 123-124」, and 123-124 on this sheet is the raise - both
#              hands up, the blade standing in front of him. The training-room
#              clip it is rebuilt against (10_崩山裂地斩) then does what the
#              client's own 100-frame preview does not: he holds that raise for
#              half a second, leaps 101px up and 47px forward (204-205 are the
#              airborne pair - the blade over his head, legs tucked), lands and
#              settles prone with the sword driven into the floor (208-209), and
#              only gets up a second later while the second eruption burns
#              (132, the stand he is left in). The move used to borrow 崩山击's
#              hop and a guard stance; the hop is back because the reference
#              jumps, but as this move's own beats.
#
#              What must not come back is 133: a leaning balance - the body tipped
#              over one raised leg with the blade up in front - which the older
#              cut held for over a second (owner: 「放完技能多了一个不正确的动作，
#              歪着身体举剑那个动作」). The clip ends on 132, a plain stand.
#   银光落刃   the dive the client turns Z into while airborne: the air slash plus
#              the landing (134-141). The owner did not give this one a frame
#              range, so these are picked from the same action as the jump attack.
#   跳跃       the plain hop (just C) is the client's own jump animation, 0048:126-131
#              = 127-132 here. Our hop used to draw 232/236, which are the *air
#              slash* frames - that white arc is the sword swing the owner says a
#              jump must not have.
#
# The same owner note fixes the up-slash: 上挑 is sm_body0048 frames 42-50, which
# is 43-51 here (the old bake started at 41, two frames early, and dropped 51).
# The game used to draw one generic skill animation for every move, which is why
# the character never seemed to perform the skill being cast.
CLIPS = [
    ("mountainBreaker", [187, 194, 203, 204, 205, 206, 207, 208, 209, 210, 211, 187]),
    ("rageBurst", list(range(76, 84)) + [176, 177]),
    # 十字斩 是对着参考片每一拍的**姿势**挑的（不是照客户端动作表顺序抄）——
    # 参考 #26-#32 那一拍（横扫，占全招四分之一）他**站着、剑向前平伸**，
    # 而这里原来是 **14 = 蹲姿**，屏幕上就是一整拍蹲着扫。66 才是那一拍
    # （站着、剑向右前方伸出去），它原来被分给第 4 拍（#37-#44），
    # 而参考第 4 拍也是站着、剑向前 —— 所以两拍都用 66。
    # **这一招用客户端自己的连续动画，不是挑出来的几个姿势。**
    # 上一片把它从 `range(5,19)+range(198,204)`（20 帧）换成了 7 个"每拍一帧"的姿势，
    # 理由是躲开 198-203 末尾那记过头上劈。代价是**整招只剩 7 个姿势**、
    # 每拍按住 0.1–0.3 秒，而参考片每一帧他的身体都在动（30fps）——业主 2026-09-27
    # 对着 `02_十字斩.png`（90 帧对照图）说「看看释放少帧了，以及动作少了」，
    # 指的就是这个。**帧数少和"末尾多一记"是两件事，不该拿前者去换后者。**
    # 末尾三帧（201-203）是他那记**过头上劈 + 白弧**，参考片里没有，所以不取；
    # 但**要凑满 20 格**——写完这一行时 `clips` 那一行是 42 格，山崩 12 + 怒气爆发 10 +
    # 这一招 20 正好排满，少一格后面的行就会从 `clips` 里被截掉。（2026-09-28 加
    # 嗜魂之手时 COLS 抬到 47，这条"正好排满"不再成立，但 20 格是这一招自己的数，
    # 不改。）腾出来的三格用 200（低身扑）按住，参考片 #48-#52 本来也就是**低身按住**。
    # 见 src/render.js 的 `skillClips.crossSlash`。
    ("crossSlash", list(range(5, 19)) + [198, 199, 200, 200, 200, 200]),
    # **血之狂暴's cast, and the owner named it: body 159-175.**
    #
    # This row has been wrong twice. It first baked 161-169, which is the opening
    # of 嗜魂之手's reach, and an audit found the two rows byte-identical - so it
    # was "fixed" to a still stand on the reading that the reference's transform
    # does not move his body. That reading was taken from the *first* beat only
    # (07_血之狂暴 f40-58 really is a still body), and it missed the second: at
    # f64-78 his arm goes out and the blood gathers in his hand. 159-175 is
    # exactly that - he stands, extends the arm, and holds it out.
    #
    # It **shares its frames with 嗜魂之手** (161-177) on purpose, the way
    # 怒气爆发 and 暴走 share 80-83: it is one motion in the client's sheet and
    # the owner put this move on it. What separates the two casts is the art over
    # them, not the body.
    ("frenzy", list(range(159, 176))),
    ("mountainRift", [123, 124, 204, 205, 208, 209, 132]),
    ("silverFall", list(range(134, 142))),
    ("jump", list(range(127, 133))),
    # 嗜魂之手: the client's own reach grab, body 161-177. Matched to the clip by
    # silhouette (beat counts 4/1/2 land on 161-164/165/166-167, and the hand's
    # reach-out per frame agrees to 1px), not picked by eye off a contact sheet:
    # the animation is one arm, so a whole-figure score barely separates the
    # candidates - what separates them is the *beat structure*.
    #
    # 17 frames is what the move needs and `clips2` had 12 columns left, so
    # COLS went 42 -> 47 rather than the move losing its four-frame tail. The
    # column space was not there to squeeze: 161-175 is the move and 176-177 is
    # the hand dropping, which the clip needs to play the burst over.
    ("graspHead", [161, 162, 163, 164, 165, 166, 167,
                   168, 169, 170, 171, 172, 173, 174, 175, 176, 177]),
    # 暴走: the owner's own pick off the labelled full-frame sheet (2026-10-02) -
    # body 80-89, the ten frames where he lifts his hand up over his head. He
    # looked at assets/dnf_src/full-frames/frames-061-121.png and named the
    # range himself; the earlier candidate strip was cut from the *other*
    # contact sheet (full-frames-sm_body0048, the 210-frame awakened skin) and
    # its frame numbers do not mean the same thing.
    #
    # 80-83 are also rageBurst's middle pose - the owner was told and kept
    # 80-89, so the two casts share four frames on purpose.
    ("berserk", list(range(80, 90))),
    # 嗜魂封魔斩. Two motions in one cast, because the cast is the game's only
    # channel (docs/adr/0023):
    #
    # - **起手 + 那 3 秒站桩** is 159-176, the client's own "he stands, extends the
    #   arm, and holds it out" - the same run 血之狂暴's cast uses, and the same
    #   shape the reference holds for three seconds (`09_嗜魂封魔斩` #059-#152 is a
    #   still body: compared frame by frame against #070, nothing moves but the
    #   vortex passing in front of him). It is one motion in the client's sheet
    #   and three casts sit on it now; what separates them is the art over them.
    # - **收招** is 189 / 194 / 195 / 197 / 198: he turns with the blade behind him,
    #   raises it over his head, coils, cuts through and finishes low. Those five
    #   are the owner's own pick off `guifeng-body-finish.png`. **190-193 are
    #   skipped on purpose**: they carry the client's own white slash arc, and the
    #   reference's own sweep is golden - the body row must not bring a white arc
    #   of its own into the move (the same call 十字斩 made about 201-203).
    ("bloodyRave", [176, 159, 160, 161, 168, 174, 175, 189, 194, 195, 197, 198]),
]
CLIP_ROWS = ("clips", "clips2")

# DNF frame coordinate space of the swordman body: idle frames put the feet at
# y=341 and the body centre at x=242. Everything maps through this point.
ORIGIN = (242.0, 341.0)
SCALE = 0.68

AVATAR = "sprite/character/swordman/equipment/avatar"
GROWTYPE = "sprite/character/swordman/equipment/growtype"
WEAPON = "sprite/character/swordman/equipment/weapon/katana"
# The owner's pick out of the sword menus (katana 5601, the serrated silver blade).
WEAPON_INDEX = "5601"
PACKS = {
    "body": ("sprite_character_swordman_equipment_avatar_skin.NPK", f"{AVATAR}/skin/sm_body0000.img"),
    "shoes": ("sprite_character_swordman_equipment_avatar_shoes.NPK", f"{AVATAR}/shoes/sm_shoes0000a.img"),
    "pants": ("sprite_character_swordman_equipment_avatar_pants.NPK", f"{AVATAR}/pants/sm_pants0000a.img"),
    "coat": ("sprite_character_swordman_equipment_avatar_coat.NPK", f"{AVATAR}/coat/sm_coat0000a.img"),
    "face": ("sprite_character_swordman_equipment_avatar_face.NPK", f"{AVATAR}/face/sm_face0000b.img"),
    "hair": ("sprite_character_swordman_equipment_avatar_hair.NPK", f"{AVATAR}/hair/sm_hair0000a.img"),
    "eye": ("sprite_character_swordman_equipment_growtype.NPK", f"{GROWTYPE}/berserker_eye.img"),
    "blood": ("sprite_character_swordman_equipment_growtype.NPK", f"{GROWTYPE}/berserker.img"),
    # The sword the Slayer actually holds; DNF keeps it out of the body img.
    # The pack splits one weapon across two complementary imgs (blade + slash),
    # so both go in: whichever one is drawn on a frame supplies the sword.
    "weapon_b": ("sprite_character_swordman_equipment_weapon_katana.NPK", f"{WEAPON}/katana{WEAPON_INDEX}b.img"),
    "weapon_c": ("sprite_character_swordman_equipment_weapon_katana.NPK", f"{WEAPON}/katana{WEAPON_INDEX}c.img"),
}
# bottom-to-top layer order for the character itself
LAYERS = ["body", "shoes", "pants", "coat", "face", "hair", "weapon_b", "weapon_c"]
# The Berserker red-eye and blood-aura overlays are indexed by their own
# animation list, which drifts out of step with the body animations, so they are
# pinned to the head: (layer, reference frame that is known to line up, max size).
# Anything larger than the size cap is a full move effect, not an aura, and lands
# detached once the indices drift, so it is skipped.
OVERLAYS = [("eye", 2, 24, 20), ("blood", 0, 32, 24)]

# Which DNF frames feed each cell of the sheet. The body img runs its animations
# back to back, so these come off the segment boundaries of the body layer. The
# owner picked the segments straight off the full-frame contact sheets
# (assets/dnf_src/full-frames):
#   still stand (the "静止" frames)  176-179  - feet planted, only the breath moves
#   basic attack, four cuts          0-41     - guard then the chain's four swings
#   up-slash (上挑)                  40-50    - the skill's own raise-and-lift
#   run cycle                        105-116  - the trailing repeats dropped
#   crescent slam and recovery       194-200
#   knockdown / airborne             100,102,232,236
# Frames 51-60 repeat the raise-and-cut cycle that 40-50 already covers, so they
# are left out. Cells past a row's frame count are spare art the renderer never
# reaches, so the still stand repeats to fill its row instead of leaving blanks.
CELLS = {
    "idle": [176, 177, 178, 179] * 3,
    "run": list(range(105, 117)),
    # The Slayer's real normal attack: four cuts, one per press. The client's
    # sheet holds six slash peaks (3, 13, 24, 36, 45, 54) but only *three*
    # directions: 13 and 24 are the same backward-low sweep (pixel-identical),
    # 36/45/54 are the same overhead sweep, and 3-4 are one circular cut. Playing
    # them in sheet order gave the owner "two backward flicks, then two upward
    # ones" - which is what it looked like, because presses two and three really
    # were the same frame.
    #
    # So the row is built from three *different* swings, one per press, each with
    # its own wind-up and settle and its slash on the fourth frame:
    #   0-6   the opening down cut      body 2,2,2,4,5,6,7 - the up-sweep on 3 is
    #                                   the wind-up of this very cut, and playing
    #                                   it read as a second flick, so it is skipped
    #   7-15  the backward low sweep    body 10-18 (slash 13)
    #   16-22 the overhead sweep        body 33-39 (slash 36)
    # The owner cut the chain to three: the overhead down slash on 132-138 was the
    # fourth press and he wants it gone, so the row stops after the up sweep.
    # Everything the sheet repeats (19-28, 40-54) and the second forward cut
    # (55-65, the same shape as the first) is skipped, as are the stands.
    "attack": [2, 2, 2, 4, 5, 6, 7] + list(range(10, 19)) + list(range(33, 40))
    # ... and the air slash the same key does off the ground: the client's jump
    # attack (0048:133-136 = 134-137 here), parked after the three ground cuts.
    + list(range(134, 138)),
    # Generic skill art first (the six frames the renderer plays), then the
    # up-slash clip that skill alone uses (columns 6-14 are body frames 43-51:
    # 上挑 is sm_body0048's 42-50, one frame earlier on that sheet).
    "skill": [194, 196, 197, 198, 199, 200] + list(range(43, 52)),
    "extras": [100, 102, 232, 236, 240, 241, 101, 103, 233, 237, 238, 239],
    # **血之狂暴's swing, and the owner named the frames himself (2026-10-03):
    # 「真正的角色动作帧在 frames-182-241.png 中的 188-209」.** Twenty-two frames
    # carrying **three swings** - 188-193 opens with the blade low and sweeps,
    # 194-200 raises and sweeps again, 201-209 lifts the blade over his head and
    # puts the last one through - which is why our three-hit combo plays one
    # segment per hit and not all 22 at once (src/render.js SPRITE.rageSwing).
    #
    # It matches the client's blood-sword rows frame for frame: that art is 22
    # frames and its blade is at the grip of body 188+k for sword frame k
    # (docs/adr/0019).
    "rage": list(range(188, 210)),
}


class Decoder:
    """Reads (and caches) .img files out of the client's NPK packs."""

    def __init__(self, client: pathlib.Path, force: bool = False):
        self.client = client
        self.force = force
        self._packs: dict[str, NPK] = {}

    def _pack(self, name: str) -> NPK:
        if name not in self._packs:
            path = self.client / "ImagePacks2" / name
            if not path.exists():
                raise SystemExit(f"missing client pack: {path}")
            handle = open(path, "rb")  # kept open: entries load lazily
            self._packs[name] = NPK.open(handle)
        return self._packs[name]

    def raw(self, key: str) -> bytes:
        pack, entry = PACKS[key]
        # Cache per source entry, not per layer key: one weapon pack holds
        # hundreds of katana, so a cache named after the layer ("weapon_b.img")
        # would keep serving the previous pick after WEAPON_INDEX changes.
        path = CACHE / entry.rsplit("/", 1)[-1]
        if path.exists() and not self.force:
            return path.read_bytes()
        npk = self._pack(pack)
        for f in npk.files:
            if f.name.replace("\\", "/") == entry:
                data = f.data
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                return data
        raise SystemExit(f"entry not found: {entry} in {pack}")

    def frames(self, key: str):
        """Return [(image, x, y)] for one layer, stubs already dropped."""
        img = IMGFactory.open(io.BytesIO(self.raw(key)))
        boards = getattr(img, "color_boards", None)
        colors = boards[0].colors if boards else getattr(getattr(img, "color_board", None), "colors", None)
        entries = getattr(img, "sprites", None) or img.images
        out = []
        for raw in entries:
            item = raw
            while type(item).__name__ == "ImageLink":
                item = img.images[item.index]
            if getattr(item, "data", None) is None and hasattr(item, "load"):
                item.load()
            data = getattr(item, "data", None)
            frame = None
            if data:
                if data[:4] == b"DDS ":
                    try:
                        frame = Image.open(io.BytesIO(data)).convert("RGBA")
                    except Exception:
                        frame = None
                if frame is None:
                    for attempt in (
                        lambda: FormatConvertor.to_raw_indexes(data, colors) if colors else None,
                        lambda: FormatConvertor.to_raw(data, item.format),
                    ):
                        try:
                            raw_pixels = attempt()
                            if not raw_pixels:
                                continue
                            frame = image_util.load_raw(raw_pixels, item.w, item.h).convert("RGBA")
                            break
                        except Exception:
                            frame = None
            out.append((frame, getattr(item, "x", 0), getattr(item, "y", 0)))
        return out


def is_stub(image: Image.Image) -> bool:
    """DNF stores 'no sprite this frame' as a 1x1 or 2x2 transparent stub."""
    if image is None or (image.width <= 2 and image.height <= 2):
        return True
    return not image.getbbox()


def composed_frame(layer_frames, overlay_frames, index: int) -> tuple[Image.Image, int, int, Image.Image]:
    """One frame with every layer on it, plus the mask that says where his feet are.

    The mask is the **body layer alone**, cut to the composite's own box. It is
    what `place()` measures the cell centre on, and it has to be the body rather
    than the finished picture: a weapon hangs lower than the boots on 22 of these
    72 frames, and even when the blade only *ties* with the sole it joins the
    average. Measuring the finished frame hands the cell centre to the sword tip,
    which walks the character sideways off his own anchor wherever the blade
    swings - 57px on 银光落刃, 42px on 崩山击, 17px on the frames this skill uses.
    """
    parts = []
    body_part = None
    for key, frames in layer_frames:
        if index < len(frames):
            image, x, y = frames[index]
        else:
            # Shorter layer lists (the weapon imgs hold 210 frames, the body 242).
            near = nearest_frame(frames, parts[-1] if parts else None)
            if near is None:
                continue
            image, x, y = frames[near]
        if is_stub(image):
            continue
        if key == "body":
            body_part = (image, x, y)
        parts.append((image, x, y))
    # head anchor for the overlays: the hair sprite of this frame
    hair_frames = dict(layer_frames)["hair"]
    hair = hair_frames[index % len(hair_frames)]
    if is_stub(hair[0]):
        face_frames = dict(layer_frames)["face"]
        hair = face_frames[index % len(face_frames)]
    for frames, ref, max_w, max_h in overlay_frames:
        image, x, y = frames[index % len(frames)]
        if is_stub(image) or image.width > max_w or image.height > max_h:
            image = None
            for step in range(1, 9):
                for j in (index + step, index - step):
                    candidate = frames[j % len(frames)]
                    if not is_stub(candidate[0]) and candidate[0].width <= max_w and candidate[0].height <= max_h:
                        image, x, y = candidate
                        break
                if image is not None:
                    break
        if image is None:
            continue
        ref_image, ref_x, ref_y = frames[ref % len(frames)]
        if is_stub(ref_image):
            continue
        ref_hair = hair_frames[ref % len(hair_frames)]
        parts.append((image, hair[1] + (ref_x - ref_hair[1]), hair[2] + (ref_y - ref_hair[2])))
    if not parts:
        raise SystemExit(f"frame {index} is empty")
    x0 = min(x for _, x, _ in parts)
    y0 = min(y for _, _, y in parts)
    x1 = max(x + im.width for im, x, _ in parts)
    y1 = max(y + im.height for im, _, y in parts)
    out = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, x, y in parts:
        out.alpha_composite(im, (x - x0, y - y0))
    foot = Image.new("L", out.size, 0)
    if body_part is not None:
        foot.paste(body_part[0].getchannel("A"), (body_part[1] - x0, body_part[2] - y0))
    return out, x0, y0, foot


def nearest_frame(frames, reference, radius: float = 40.0):
    """Index of the closest drawn frame to the body, or None when nothing is near.

    The weapon imgs hold 210 frames where the body has 242, so the last few body
    poses have no weapon counterpart. Guessing far away lands a sword in mid air,
    so anything outside the radius is dropped instead.
    """
    if reference is None:
        return None
    ref_image, ref_x, ref_y = reference
    ref_cx = ref_x + ref_image.width / 2
    ref_cy = ref_y + ref_image.height / 2
    best, best_d = None, None
    for index, (image, x, y) in enumerate(frames):
        if is_stub(image):
            continue
        dx = x + image.width / 2 - ref_cx
        dy = y + image.height / 2 - ref_cy
        distance = dx * dx + dy * dy
        if best_d is None or distance < best_d:
            best, best_d = index, distance
    if best is None or best_d > radius * radius:
        return None
    return best


def foot_centre(foot: Image.Image) -> float:
    """Mean x of the lowest opaque pixel of the *body* mask: where he stands.

    DNF shifts whole animations sideways inside the img (dash, lunge, thrust),
    so aligning on the feet keeps every cell centred on the same spot.

    It takes the mask `composed_frame` hands back, not the finished picture, and
    that distinction is the whole point of the function: the body's own bottom
    row is always the boots (2-4 rows above the sole, which is covered by the
    shoes layer), while the finished picture's bottom row is the weapon as soon
    as the blade reaches past the heel.
    """
    alpha = foot
    width, height = alpha.size
    bottom = None
    for row in range(height - 1, -1, -1):
        if any(alpha.getpixel((col, row)) > 24 for col in range(width)):
            bottom = row
            break
    if bottom is None:
        return width / 2
    cols = [col for col in range(width) if alpha.getpixel((col, bottom)) > 24]
    return sum(cols) / len(cols)


def place(cell: Image.Image, frame: Image.Image, x: int, y: int, foot: Image.Image) -> tuple[int, int, int, int]:
    """Put a DNF frame into a sheet cell: feet centred, ground on the anchor.

    `foot` is the body mask from `composed_frame`, in this frame's own box - see
    `foot_centre` for why the finished picture is the wrong thing to measure.

    A frame that reaches past its cell is a bug, not a crop: `alpha_composite`
    would quietly slice the blade or the slash arc off and the renderer has no
    way to tell. Report the exact overflow instead so the next bake fails loudly.
    """
    scaled = frame.resize(
        (max(1, round(frame.width * SCALE)), max(1, round(frame.height * SCALE))),
        Image.LANCZOS,
    )
    px = round(ANCHOR_X - foot_centre(foot) * SCALE)
    py = round(ANCHOR_Y + (y - ORIGIN[1]) * SCALE)
    left, top = px, py
    right, bottom = px + scaled.width, py + scaled.height
    if left < 0 or top < 0 or right > cell.width or bottom > cell.height:
        raise SystemExit(
            f"frame {frame.width}x{frame.height} does not fit its cell: "
            f"needs [{left},{top},{right},{bottom}] inside {cell.width}x{cell.height}"
        )
    cell.alpha_composite(scaled, (px, py))
    return left, top, right, bottom


# 大蹦 turns the sword in his hands into a blood blade while the move is out, and
# it goes back to the plain katana when the cast ends. The owner's read of
# 10_崩山裂地斩 is exact about which part of that is the move's: the red *body* is
# 血之狂暴 and belongs to the stance (ADR 0003), but the **sword** going blood is
# the skill's own effect - the reference's character carries a red weapon anyway,
# so the sword changing is not the weapon's colour coming out.
#
# It is baked as a second copy of the clip's own cells rather than as a layer
# drawn over him, and that is the whole point: an overlay has to be aimed, and a
# copy cannot miss. The same four cells also feed 崩山击 (see CLIPS), so this is
# a *copy* on its own row - recolouring the shared cells would hand 崩山击 a
# blood blade it never asked for.
#
# The blade is found by the one thing that separates it from the body: the
# katana is silver, so its pixels are near-neutral and lit, while the Slayer's
# blue trousers, white coat and red hair are none of those. `BLOOD_BLADE` is the
# ramp they are pushed through - a deep red that keeps the blade's own shading,
# so the edge still reads lighter than the flat.
BLOOD_BLADE_FRAMES = (204, 205, 208, 209)
BLOOD_BLADE = [
    (0.00, (96, 8, 10)),
    (0.45, (176, 20, 20)),
    (1.00, (240, 74, 62)),
]


# **血之狂暴's own slash arc, on its own row.** The arc the reference shows is drawn by the
# client *in the weapon layer* of its own 188-209: frames 190/196/202/206 carry the katana
# with a big crescent swept out of it, so it varies from swing to swing exactly like the
# reference's does. A row of ours built any other way is one arc repeating, which is what the
# owner saw: 「好像就两个剑影不停循环，不如参考的自然」 (docs/adr/0019).
#
# This row is that arc **alone**: the weapon layer's own frames, masked to its *bright
# neutral* pixels (the blade is silver, 110-190; the arc is white, above 190) and graded to
# the reference's cream. The renderer draws it over the body cell, a few pixels along the
# swing, and that is the second sword's trail.
# The floor separates the arc from the blade it was drawn beside: measured over
# these frames the blade's silver sits at 110-190 and the arc's body at
# (236,233,233), so 205 takes the arc and leaves the katana out of this row
# (at 190 the blade's highlights came along and the second copy doubled it).
RAGE_ARC_FLOOR = 205
RAGE_ARC_RAMP = [
    (0.00, (150, 138, 104)),
    (0.62, (200, 198, 175)),
    (0.80, (224, 222, 181)),
    (0.92, (242, 241, 181)),
    (1.00, (246, 245, 190)),
]


def rage_arc_layer(picture: Image.Image) -> Image.Image:
    """The weapon layer's arc alone, graded to the reference's cream."""
    out = picture.copy().convert("RGBA")
    pixels = out.load()
    tables = []
    for channel in range(3):
        table = []
        for value in range(256):
            level = value / 255.0
            if level <= RAGE_ARC_RAMP[0][0]:
                table.append(RAGE_ARC_RAMP[0][1][channel])
                continue
            for index in range(1, len(RAGE_ARC_RAMP)):
                low, high = RAGE_ARC_RAMP[index - 1], RAGE_ARC_RAMP[index]
                if level <= high[0]:
                    span = max(1e-6, high[0] - low[0])
                    blend = (level - low[0]) / span
                    table.append(round(low[1][channel] + (high[1][channel] - low[1][channel]) * blend))
                    break
            else:
                table.append(RAGE_ARC_RAMP[-1][1][channel])
        tables.append(table)
    # **The floor alone is not enough.** The katana is silver and its *highlights*
    # are as bright as the arc, so a plain flood of `high > FLOOR` takes slivers
    # of the blade with it - drawn over the body that is a **white sword on a red
    # Slayer**, and the cream arc underneath read as missing (「角色还不泛红了，
    # 变成白色了」). So the mask keeps only its **largest connected blob**: the arc
    # is one big sweep, the blade's highlights are thin slivers.
    array = np.asarray(out).copy()
    high = array[..., :3].max(2)
    low = array[..., :3].min(2)
    mask = (array[..., 3] > 60) & ((high - low) < 40) & (high > RAGE_ARC_FLOOR)
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count:
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        mask = labels == int(np.argmax(sizes)) + 1
    array[..., 3] = np.where(mask, array[..., 3], 0)
    levels = array[..., :3].max(2)
    for channel in range(3):
        array[..., channel] = np.where(mask, np.array(tables[channel], dtype="uint8")[levels], array[..., channel])
    return Image.fromarray(array.astype("uint8"), "RGBA")


def blood_blade(cell: Image.Image) -> Image.Image:
    """One body cell with the sword's silver pixels pushed to blood red."""
    out = cell.copy()
    pixels = out.load()
    tables = []
    for channel in range(3):
        stops = BLOOD_BLADE
        table = []
        for value in range(256):
            level = value / 255.0
            if level <= stops[0][0]:
                table.append(stops[0][1][channel])
                continue
            for index in range(1, len(stops)):
                low, high = stops[index - 1], stops[index]
                if level <= high[0]:
                    span = max(1e-6, high[0] - low[0])
                    blend = (level - low[0]) / span
                    table.append(round(low[1][channel] + (high[1][channel] - low[1][channel]) * blend))
                    break
            else:
                table.append(stops[-1][1][channel])
        tables.append(table)
    for y in range(out.height):
        for x in range(out.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 60:
                continue
            high, low = max(red, green, blue), min(red, green, blue)
            if high - low < 30 and high > 110:      # silver: near-neutral and lit
                level = high
                pixels[x, y] = (tables[0][level], tables[1][level], tables[2][level], alpha)
    return out


# 崩山击's apex flash. One frame of the reference (01 崩山击 #34, the frame just
# past the top of the hop) paints him flat yellow, behind the pose he is holding
# and about 1.45x his size, his feet on its feet. The pack has no such layer -
# the seven candidates under _hopsmash are spike fans, fire and a blue finish -
# so this is the body's own art again, filled: the same *copy* the blood blade
# is, for the same reason (a copy cannot be aimed wrong), and it tells the eye
# nothing about which part of him changed because nothing did.
#
# Alpha does the shading: the silhouette's interior is opaque and its rim is
# anti-aliased, so grading the fill by alpha gives the reference's gold rim over
# its flat core without measuring anything.
FLARE = (255, 242, 105)
FLARE_RIM = (238, 176, 22)


def flare_cell(cell: Image.Image) -> Image.Image:
    """One body cell filled with the reference's yellow, alpha left alone."""
    out = cell.copy()
    pixels = out.load()
    for y in range(out.height):
        for x in range(out.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 60:
                continue
            level = min(1.0, alpha / 255.0)
            pixels[x, y] = (
                round(FLARE_RIM[0] + (FLARE[0] - FLARE_RIM[0]) * level),
                round(FLARE_RIM[1] + (FLARE[1] - FLARE_RIM[1]) * level),
                round(FLARE_RIM[2] + (FLARE[2] - FLARE_RIM[2]) * level),
                alpha,
            )
    return out


def build(client: pathlib.Path, force: bool) -> Image.Image:
    decoder = Decoder(client, force)
    layer_frames = [(key, decoder.frames(key)) for key in LAYERS]
    overlay_frames = [(decoder.frames(key), ref, max_w, max_h) for key, ref, max_w, max_h in OVERLAYS]
    sheet = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * len(ROWS)), (0, 0, 0, 0))
    clip_row = 0
    clip_column = 0
    placed_mountain_rift = []
    placed_mountain_breaker = []
    for row, name in enumerate(ROWS):
        if name in ("bloodblade", "flare", "ragearc"):
            continue                 # filled from their own clip's cells, after the loop
        if name in CLIP_ROWS:
            if clip_row >= len(CLIPS):
                continue
            while clip_row < len(CLIPS):
                skill, indices = CLIPS[clip_row]
                first = clip_column
                for index in indices:
                    if clip_column >= COLS:
                        break
                    frame, x, y, foot = composed_frame(layer_frames, overlay_frames, index)
                    cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
                    place(cell, frame, x, y, foot)
                    sheet.alpha_composite(cell, (clip_column * FRAME_W, row * FRAME_H))
                    if skill == "mountainRift":
                        placed_mountain_rift.append((row, clip_column, index))
                    if skill == "mountainBreaker":
                        placed_mountain_breaker.append((row, clip_column, index))
                    clip_column += 1
                if clip_column >= COLS:
                    print(f"  {name}: {skill} cols {first}-{clip_column - 1}")
                    clip_row += 1
                    clip_column = 0
                    break
                print(f"  {name}: {skill} cols {first}-{clip_column - 1} ({len(indices)} frames)")
                clip_row += 1
                if clip_column + (len(CLIPS[clip_row][1]) if clip_row < len(CLIPS) else 0) > COLS:
                    clip_column = 0
                    break
            continue
        for col, index in enumerate(CELLS[name][:COLS]):
            frame, x, y, foot = composed_frame(layer_frames, overlay_frames, index)
            cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
            place(cell, frame, x, y, foot)
            sheet.alpha_composite(cell, (col * FRAME_W, row * FRAME_H))
    # 血之狂暴's arc, alone on its own row (`ragearc`): the weapon layer's own frames 188-209,
    # masked to the arc and graded to the reference's cream. `place` needs the frame's own box
    # and the *body's* foot for that instant, which is what `composed_frame` hands back.
    arc_row = ROWS.index("ragearc")
    # **Both weapon layers.** The client draws the equipped sword twice - `_b`
    # behind the Slayer and `_c` in front - and it is `_c` that carries the arc on
    # these frames (at 190 `_b` is a 1x1 stub and `_c` is 133x94 of blade and
    # arc). Both are read and masked, so neither order of the layers is assumed.
    weapons = [dict(layer_frames)[key] for key in ("weapon_b", "weapon_c")]
    for col, index in enumerate(CELLS["rage"][:COLS]):
        _frame, _x, _y, foot = composed_frame(layer_frames, overlay_frames, index)
        cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        for weapon in weapons:
            if index >= len(weapon):
                continue
            picture, wx, wy = weapon[index]
            # A 1x1 stub means this layer has no blade in this frame; the composed
            # frame skips those too.
            if is_stub(picture):
                continue
            place(cell, rage_arc_layer(picture), wx, wy, foot)
        sheet.alpha_composite(cell, (col * FRAME_W, arc_row * FRAME_H))
    # 大蹦's blood blade: the same cells again, one row down, with the katana's
    # own pixels pushed red. Only the frames where the move has the sword out in
    # its blood form - the raise (123/124) and the stand he ends on (132) keep
    # the plain katana, which is the owner's 「释放完变成原来的剑」.
    blade_row = ROWS.index("bloodblade")
    for row, column, index in placed_mountain_rift:
        if index not in BLOOD_BLADE_FRAMES:
            continue
        cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        cell.alpha_composite(sheet.crop((column * FRAME_W, row * FRAME_H,
                                         (column + 1) * FRAME_W, (row + 1) * FRAME_H)))
        sheet.alpha_composite(blood_blade(cell), (column * FRAME_W, blade_row * FRAME_H))
        print(f"  bloodblade: col {column} from frame {index}")
    # 崩山击's apex flash: every one of its own cells again, one row down, filled
    # with the reference's yellow. All nine are copied rather than only the cell
    # the flash lands on, so this row stays column-for-column with the clip and
    # the renderer can hand it the column it is already drawing.
    flare_row = ROWS.index("flare")
    for row, column, index in placed_mountain_breaker:
        cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        cell.alpha_composite(sheet.crop((column * FRAME_W, row * FRAME_H,
                                         (column + 1) * FRAME_W, (row + 1) * FRAME_H)))
        sheet.alpha_composite(flare_cell(cell), (column * FRAME_W, flare_row * FRAME_H))
        print(f"  flare: col {column} from frame {index}")
    return sheet


def preview(sheet: Image.Image, out: pathlib.Path, scale: int = 2) -> None:
    check = Image.new("RGB", (sheet.width * scale, sheet.height * scale), (18, 18, 26))
    check.paste(sheet.convert("RGB").resize((sheet.width * scale, sheet.height * scale), Image.NEAREST), (0, 0))
    draw = ImageDraw.Draw(check)
    for row, name in enumerate(ROWS):
        for col in range(COLS):
            x, y = col * FRAME_W * scale, row * FRAME_H * scale
            draw.rectangle([x, y, x + FRAME_W * scale - 1, y + FRAME_H * scale - 1], outline=(70, 70, 92))
            draw.text((x + 4, y + 3), f"{name} {col}", fill=(255, 220, 120))
        draw.line([(0, (row + 1) * FRAME_H * scale), (check.width, (row + 1) * FRAME_H * scale)], fill=(120, 90, 60))
    out.parent.mkdir(parents=True, exist_ok=True)
    check.save(out)
    print(f"preview -> {out} {check.size}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--out", type=pathlib.Path, default=ROOT / "assets" / "slayer.png")
    parser.add_argument("--preview", action="store_true", help="also write a labelled 2x check sheet")
    parser.add_argument("--force", action="store_true", help="re-extract .img files from the client")
    args = parser.parse_args()

    sheet = build(args.client, args.force)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    print(f"baked {args.out} ({sheet.width}x{sheet.height})")
    if args.preview:
        preview(sheet, ROOT / "assets" / "dnf_src" / "swordman-sheet-preview.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
