#!/usr/bin/env python3
"""Render each client effect pack as a layered animation, so it can be watched.

    pip install pydnfex pillow av
    python3 assets/make_effect_animations.py [--client DIR] [--packs a,b,c] [--all]

The client's own skill preview clips (Video/Swordman/<SkillName>.avi) are
encrypted by Neople and only the first frame is plain, so they cannot be handed
to a normal player. This does the next best thing with art we *can* read: every
layer of one effect pack (front/back, normal/dodge, dust, shockwave...) is
decoded with its own frame offsets and composited over a black stage, frame by
frame, into a short mp4 plus a looping gif.

That is the thing to watch when picking an effect: a still row of one layer
cannot show what the skill looks like, but the stack can.

Writes assets/dnf_effect_anim/<pack>.mp4 and .gif (both gitignored: DNF art).
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK_PREFIX = "sprite_character_swordman_effect"
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)
STAGE = 320
FPS = 12


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def decode_layers(client: pathlib.Path, pack: str):
    """[(frames with offsets)] for every entry of one pack."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory
    from pydnfex.img.image.format import FormatConvertor
    from pydnfex.util import image as image_util

    path = client / "ImagePacks2" / f"{PACK_PREFIX}_{pack}.NPK"
    if not path.exists():
        return []
    layers = []
    with open(path, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            try:
                img = IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue
            boards = getattr(img, "color_boards", None)
            colors = boards[0].colors if boards else getattr(getattr(img, "color_board", None), "colors", None)
            frames = []
            for raw in getattr(img, "sprites", None) or img.images:
                # A pack can ship one truncated or stub entry; skip those instead
                # of losing the whole animation.
                try:
                    item = raw
                    while type(item).__name__ == "ImageLink":
                        item = img.images[item.index]
                    if getattr(item, "data", None) is None and hasattr(item, "load"):
                        item.load()
                    data = getattr(item, "data", None)
                    picture = None
                    if data:
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
                except Exception:
                    continue
                if picture is None or picture.width <= 2 or picture.height <= 2 or not picture.getbbox():
                    continue
                frames.append((picture, getattr(item, "x", 0), getattr(item, "y", 0)))
            if frames:
                layers.append((name, frames))
    return layers


def stage_frames(layers, min_frames: int = 8):
    """Composite every layer onto one stage, frame by frame."""
    left = min(x for _n, frames in layers for _p, x, _y in frames)
    top = min(y for _n, frames in layers for _p, _x, y in frames)
    right = max(x + p.width for _n, frames in layers for p, x, _y in frames)
    bottom = max(y + p.height for _n, frames in layers for p, _x, y in frames)
    width, height = right - left, bottom - top
    scale = min(1.0, STAGE / max(width, height))
    size = (max(2, int(width * scale)), max(2, int(height * scale)))
    # yuv420p wants even dimensions
    size = (size[0] + size[0] % 2, size[1] + size[1] % 2)

    total = max(min_frames, max(len(frames) for _n, frames in layers))
    out = []
    for index in range(total):
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 255))
        for _name, frames in layers:
            picture, x, y = frames[min(index, len(frames) - 1)]
            canvas.alpha_composite(picture, (x - left, y - top))
        out.append(canvas.resize(size, Image.LANCZOS).convert("RGB"))
    return out


def write_mp4(frames, path: pathlib.Path) -> bool:
    try:
        import av
    except ImportError:
        return False
    container = av.open(str(path), mode="w")
    stream = container.add_stream("mpeg4", rate=FPS)
    stream.width, stream.height = frames[0].size
    stream.pix_fmt = "yuv420p"
    for picture in frames:
        for packet in stream.encode(av.VideoFrame.from_image(picture)):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    return True


def write_gif(frames, path: pathlib.Path) -> None:
    paletted = [frame.convert("P", palette=Image.ADAPTIVE, colors=128) for frame in frames]
    paletted[0].save(
        path,
        save_all=True,
        append_images=paletted[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
    )


def build_grid(client: pathlib.Path, packs, out_path: pathlib.Path, columns: int = 6, rows: int = 4,
               cell: int = 150, cap: int = 40) -> None:
    """One mp4 per sheet: every pack in the sheet animating side by side, named."""
    staged = []
    for pack in packs:
        layers = decode_layers(client, pack)
        if not layers:
            continue
        staged.append((pack, stage_frames(layers)))
    if not staged:
        return
    total = min(cap, max(len(frames) for _p, frames in staged))
    font = load_font(13)
    width, height = columns * cell, rows * cell
    out = []
    for index in range(total):
        sheet = Image.new("RGB", (width, height), (16, 18, 28))
        draw = ImageDraw.Draw(sheet)
        for slot, (pack, frames) in enumerate(staged):
            column, row = slot % columns, slot // columns
            picture = frames[min(index, len(frames) - 1)]
            scale = min((cell - 8) / picture.width, (cell - 8) / picture.height, 1.0)
            size = (max(1, int(picture.width * scale)), max(1, int(picture.height * scale)))
            sheet.paste(
                picture.resize(size, Image.LANCZOS),
                (
                    column * cell + (cell - size[0]) // 2,
                    row * cell + (cell - size[1]) // 2,
                ),
            )
            draw.text((column * cell + 4, row * cell + 2), pack, fill=(255, 220, 120), font=font)
        out.append(sheet)
    write_mp4(out, out_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--packs", help="comma-separated pack names (without the leading underscore)")
    parser.add_argument("--all", action="store_true", help="every swordman effect pack")
    parser.add_argument("--gif", action="store_true", help="also write a looping gif")
    parser.add_argument("--grid", action="store_true", help="write browsable grid sheets instead of one file per pack")
    parser.add_argument("--per-sheet", type=int, default=24)
    args = parser.parse_args()

    if args.all:
        packs = sorted(
            path.stem[len(PACK_PREFIX):].lstrip("_")
            for path in (args.client / "ImagePacks2").glob(f"{PACK_PREFIX}*.NPK")
        )
    elif args.packs:
        packs = [name.strip().lstrip("_") for name in args.packs.split(",") if name.strip()]
    else:
        raise SystemExit("pass --packs a,b,c or --all")

    out_dir = ROOT / "dnf_effect_anim"
    out_dir.mkdir(exist_ok=True)
    font = load_font(14)

    if args.grid:
        sheets = 0
        for start in range(0, len(packs), args.per_sheet):
            chunk = packs[start:start + args.per_sheet]
            sheets += 1
            path = out_dir / f"grid_{sheets:02d}.mp4"
            build_grid(args.client, chunk, path)
            print(f"  {path.name}: {len(chunk)} packs")
        print(f"wrote {sheets} grid sheets to {out_dir}")
        return 0

    made = 0
    for pack in packs:
        layers = decode_layers(args.client, pack)
        if not layers:
            print(f"  skip {pack}: nothing decodable", file=sys.stderr)
            continue
        frames = stage_frames(layers)
        draw = ImageDraw.Draw(frames[0])
        draw.text((6, 4), pack, fill=(255, 220, 120), font=font)
        if write_mp4(frames, out_dir / f"{pack}.mp4"):
            made += 1
        if args.gif:
            write_gif(frames, out_dir / f"{pack}.gif")
        print(f"  {pack}: {len(layers)} layers, {len(frames)} frames")
    print(f"wrote {made} animations to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
