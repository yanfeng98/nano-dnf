#!/usr/bin/env python3
"""Put each skill's official clip next to every body action, for picking by eye.

    pip install pydnfex pillow av
    python3 assets/match_skill_motions.py [--client DIR] [--skin sm_body0000]

The character has one body sheet holding ~25 actions, but the game draws the
same generic skill animation for every move - which is why every skill's motion
looks wrong. The client's own preview clip shows what the motion should be, so
each sheet here carries:

  top row    the decrypted clip's key frames (assets/dnf_src/skill-videos)
  below      every body action, all frames, with its frame range and index

The owner reads an index off the bottom half and it becomes the skill's own
animation. Writes assets/dnf_src/skill-body-match/<Skill>.png (gitignored).
"""

from __future__ import annotations

import argparse
import io
import pathlib
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK = "sprite_character_swordman_equipment_avatar_skin.NPK"
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)

# game skill -> the client clip that shows it (from the owner's mapping)
SKILLS = {
    "upSlash": "UpperSlash",
    "mountainBreaker": "HopSmash",
    "crossSlash": "GoreCross",
    "bloodSword": "BloodSword",
    "frenzy": "Frenzy",
    "bloodyRave": "BloodyRave",
    "rageBurst": "BloodBlast",
    "bloodSnatch": "BloodSnatch",
    "graspHead": "GrabBlastBlood",
    "bloodEvil": "BloodRiven",
    "mountainRift": "OutRageBreak",
}
HEADER, CLEAR = 32, 1024
MAGIC = b"Neople Video Fil"


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def decrypt(data: bytes) -> bytes:
    if not data.startswith(MAGIC):
        raise ValueError("not a Neople Video File")
    size = struct.unpack_from("<I", data, 0x18)[0]
    out = bytearray(size)
    copy = min(CLEAR, size)
    out[:copy] = data[HEADER:HEADER + copy]
    for index in range(CLEAR, size):
        out[index] = data[index + HEADER] ^ out[index - CLEAR]
    return bytes(out)


def clip_frames(client: pathlib.Path, name: str, want: int = 8):
    """Key frames of one decrypted skill clip."""
    import av

    clip = client / "Video" / "Swordman" / f"{name}.avi"
    if not clip.exists():
        return []
    plain = pathlib.Path("/tmp") / f"{name}.match.avi"
    plain.write_bytes(decrypt(clip.read_bytes()))
    with av.open(str(plain)) as container:
        frames = [Image.fromarray(f.to_ndarray(format="rgb24")) for f in container.decode(container.streams.video[0])]
    if len(frames) <= want:
        return frames
    step = (len(frames) - 1) / (want - 1)
    return [frames[round(i * step)] for i in range(want)]


def body_actions(client: pathlib.Path, skin: str):
    """[(first, last, [frames])] from the body sheet, using the same cut rule."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory
    from pydnfex.img.image.format import FormatConvertor
    from pydnfex.util import image as image_util
    sys.path.insert(0, str(ROOT))
    from make_body_action_sheets import split_actions  # type: ignore

    with open(client / "ImagePacks2" / PACK, "rb") as handle:
        npk = NPK.open(handle)
        entry = next(item for item in npk.files if item.name.endswith(f"{skin}.img"))
        body = IMGFactory.open(io.BytesIO(entry.data))
    boards = getattr(body, "color_boards", None)
    colors = boards[0].colors if boards else getattr(getattr(body, "color_board", None), "colors", None)
    frames = {}
    for index in range(len(body.images)):
        item = body.images[index]
        while type(item).__name__ == "ImageLink":
            item = body.images[item.index]
        if getattr(item, "data", None) is None and hasattr(item, "load"):
            item.load()
        data = getattr(item, "data", None)
        picture = None
        for attempt in (
            lambda: FormatConvertor.to_raw_indexes(data, colors) if colors else None,
            lambda: FormatConvertor.to_raw(data, item.format),
        ):
            try:
                pixels = attempt()
                if not pixels:
                    continue
                picture = image_util.load_raw(pixels, item.w, item.h).convert("RGBA")
                break
            except Exception:
                picture = None
        if picture is not None and picture.getbbox():
            frames[index] = picture
    actions = split_actions(frames)
    return [(first, last, [frames[i] for i in range(first, last + 1) if i in frames]) for first, last in actions]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--skin", default="sm_body0000")
    parser.add_argument("--only", help="comma-separated game skill ids")
    args = parser.parse_args()

    out_dir = ROOT / "dnf_src" / "skill-body-match"
    out_dir.mkdir(parents=True, exist_ok=True)
    font = load_font(13)
    head = load_font(17)
    actions = body_actions(args.client, args.skin)
    print(f"{len(actions)} body actions")

    wanted = SKILLS
    if args.only:
        keep = {name.strip() for name in args.only.split(",")}
        wanted = {k: v for k, v in SKILLS.items() if k in keep}

    cell = 96
    for skill, clip in wanted.items():
        frames = clip_frames(args.client, clip)
        width = max(300 + max(len(a[2]) for a in actions) * cell, 8 * (frames[0].width * 2 if frames else cell))
        height = (frames[0].height * 2 + 40 if frames else 0) + 30 + len(actions) * (cell + 4)
        sheet = Image.new("RGB", (width, height), (18, 18, 26))
        draw = ImageDraw.Draw(sheet)
        y = 6
        draw.text((6, y), f"{skill}  ← 官方视频 {clip}（上）／身体动作（下）", fill=(255, 235, 150), font=head)
        y += 26
        for index, frame in enumerate(frames):
            big = frame.resize((frame.width * 2, frame.height * 2), Image.NEAREST)
            sheet.paste(big, (6 + index * (big.width + 4), y))
        if frames:
            y += frames[0].height * 2 + 8
        draw.text((6, y), f"{args.skin} 的 {len(actions)} 段动作（点段号）", fill=(255, 235, 150), font=head)
        y += 24
        for index, (first, last, pics) in enumerate(actions):
            draw.text((6, y + 10), f"{index}: {first}-{last} ({last - first + 1}帧)",
                      fill=(255, 220, 120), font=font)
            for column, picture in enumerate(pics):
                scale = min((cell - 6) / picture.width, (cell - 6) / picture.height, 1.0)
                size = (max(1, int(picture.width * scale)), max(1, int(picture.height * scale)))
                sheet.paste(
                    picture.convert("RGB").resize(size, Image.LANCZOS),
                    (300 + column * cell + (cell - size[0]) // 2, y + (cell - size[1]) // 2),
                )
            y += cell + 4
        path = out_dir / f"{skill}-{clip}.png"
        sheet.save(path)
        print(f"wrote {path.name} ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
