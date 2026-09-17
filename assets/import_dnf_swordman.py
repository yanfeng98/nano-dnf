#!/usr/bin/env python3
"""Bake the player sprite sheet (assets/slayer.png) from a local DNF client.

The sheet keeps the layout the renderer expects (6 columns x 5 rows of
SPRITE.frameW x SPRITE.frameH cells, rows idle/run/attack/skill/extras) and
replaces the hand-drawn Slayer with the client's swordman art: skin + shoes +
pants + coat + face + hair (the "default look"), the greatsword he actually
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

# Renderer contract (mirrors src/render.js SPRITE).
FRAME_W = 96
FRAME_H = 96
ANCHOR_X = 46
ANCHOR_Y = 88
COLS = 6
ROWS = ["idle", "run", "attack", "skill", "extras"]

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

# Which DNF frames feed each cell of the sheet. The body img runs its
# animations back to back, so these are read off the segment boundaries of the
# body layer rather than guessed: stand is only frames 0-2, attack starts at 3,
# the run cycle is 105-122, the big crescent slam is 196-199 and the knockdown
# sits at 100-104.
CELLS = {
    "idle": [0, 1, 2, 1, 124, 127],
    "run": [105, 106, 108, 109, 111, 112],
    "attack": [2, 3, 4, 5, 6, 12],
    "skill": [196, 197, 198, 199, 201, 205],
    "extras": [100, 102, 232, 236, 240, 241],  # hurt, dead, jump, fall, +2 spares
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
        path = CACHE / (key + ".img")
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


def place(cell: Image.Image, frame: Image.Image, x: int, y: int) -> None:
    """Put a DNF frame into a sheet cell: feet centred, ground on the anchor."""
    scaled = frame.resize(
        (max(1, round(frame.width * SCALE)), max(1, round(frame.height * SCALE))),
        Image.LANCZOS,
    )
    px = round(ANCHOR_X - foot_centre(frame) * SCALE)
    py = round(ANCHOR_Y + (y - ORIGIN[1]) * SCALE)
    cell.alpha_composite(scaled, (px, py))


def build(client: pathlib.Path, force: bool) -> Image.Image:
    decoder = Decoder(client, force)
    layer_frames = [(key, decoder.frames(key)) for key in LAYERS]
    overlay_frames = [(decoder.frames(key), ref, max_w, max_h) for key, ref, max_w, max_h in OVERLAYS]
    sheet = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * len(ROWS)), (0, 0, 0, 0))
    for row, name in enumerate(ROWS):
        for col, index in enumerate(CELLS[name][:COLS]):
            frame, x, y = composed_frame(layer_frames, overlay_frames, index)
            cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
            place(cell, frame, x, y)
            sheet.alpha_composite(cell, (col * FRAME_W, row * FRAME_H))
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
