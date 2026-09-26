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

from PIL import Image, ImageDraw

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
COLS = 42
ANCHOR_X = 88
ANCHOR_Y = 156
ROWS = ["idle", "run", "attack", "skill", "extras", "clips", "clips2", "bloodblade", "flare"]

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
#   十字斩     action 1 (14 frames) + action 25 (6 frames)
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
    ("rageBurst", list(range(76, 84))),
    ("crossSlash", list(range(5, 19)) + list(range(198, 204))),
    ("frenzy", list(range(161, 170))),
    ("mountainRift", [123, 124, 204, 205, 208, 209, 132]),
    ("silverFall", list(range(134, 142))),
    ("jump", list(range(127, 133))),
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


def composed_frame(layer_frames, overlay_frames, index: int) -> tuple[Image.Image, int, int]:
    parts = []
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
    return out, x0, y0


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


def foot_centre(frame: Image.Image) -> float:
    """Mean x of the lowest opaque pixels: the point the character stands on.

    DNF shifts whole animations sideways inside the img (dash, lunge, thrust),
    so aligning on the feet keeps every cell centred on the same spot.
    """
    alpha = frame.getchannel("A")
    width, height = frame.size
    bottom = None
    for row in range(height - 1, -1, -1):
        if any(alpha.getpixel((col, row)) > 24 for col in range(width)):
            bottom = row
            break
    if bottom is None:
        return width / 2
    cols = [col for col in range(width) if alpha.getpixel((col, bottom)) > 24]
    return sum(cols) / len(cols)


def place(cell: Image.Image, frame: Image.Image, x: int, y: int) -> tuple[int, int, int, int]:
    """Put a DNF frame into a sheet cell: feet centred, ground on the anchor.

    A frame that reaches past its cell is a bug, not a crop: `alpha_composite`
    would quietly slice the blade or the slash arc off and the renderer has no
    way to tell. Report the exact overflow instead so the next bake fails loudly.
    """
    scaled = frame.resize(
        (max(1, round(frame.width * SCALE)), max(1, round(frame.height * SCALE))),
        Image.LANCZOS,
    )
    px = round(ANCHOR_X - foot_centre(frame) * SCALE)
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
        if name in ("bloodblade", "flare"):
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
                    frame, x, y = composed_frame(layer_frames, overlay_frames, index)
                    cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
                    place(cell, frame, x, y)
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
            frame, x, y = composed_frame(layer_frames, overlay_frames, index)
            cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
            place(cell, frame, x, y)
            sheet.alpha_composite(cell, (col * FRAME_W, row * FRAME_H))
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
