#!/usr/bin/env python3
"""Show every swordman body variant animating, so the right motion can be found.

    pip install pydnfex pillow av
    python3 assets/make_body_variant_grids.py [--client DIR] [--per-sheet 24]

The class ships 121 body imgs (sm_body00NN.img). One of them is the look this
game bakes, the rest are other looks/classes, and a skill's own motion is only
in one of them. Reading them one by one is hopeless, so this renders each img's
whole animation into a cell of a labelled grid: 24 variants per sheet, the name
printed in the cell, everything moving at once.

Writes assets/dnf_body_variants/grid_NN.mp4 (DNF art, gitignored).
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
PACK = "sprite_character_swordman_equipment_avatar_skin.NPK"
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def decode(img, index):
    from pydnfex.img.image.format import FormatConvertor
    from pydnfex.util import image as image_util

    item = img.images[index]
    while type(item).__name__ == "ImageLink":
        item = img.images[item.index]
    if getattr(item, "data", None) is None and hasattr(item, "load"):
        item.load()
    data = getattr(item, "data", None)
    boards = getattr(img, "color_boards", None)
    colors = boards[0].colors if boards else getattr(getattr(img, "color_board", None), "colors", None)
    for attempt in (
        lambda: FormatConvertor.to_raw_indexes(data, colors) if colors else None,
        lambda: FormatConvertor.to_raw(data, item.format),
    ):
        try:
            pixels = attempt()
            if not pixels:
                continue
            return image_util.load_raw(pixels, item.w, item.h).convert("RGBA")
        except Exception:
            continue
    return None


def variant_frames(client: pathlib.Path, cap: int = 36, step: int = 6):
    """{name: [frames]} for every sm_body variant, thinned to `cap` steps."""
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    with open(client / "ImagePacks2" / PACK, "rb") as handle:
        npk = NPK.open(handle)
        for entry in npk.files:
            name = entry.name.replace("\\", "/").split("/")[-1]
            if not name.startswith("sm_body"):
                continue
            try:
                img = IMGFactory.open(io.BytesIO(entry.data))
            except Exception:
                continue
            total = len(img.images)
            if total == 0:
                continue
            frames = []
            for index in range(0, total, max(1, -(-total // cap))):
                picture = decode(img, index)
                if picture is not None and picture.getbbox():
                    frames.append(picture)
            if frames:
                yield name, frames


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--per-sheet", type=int, default=24)
    parser.add_argument("--only", help="comma-separated variant names to render (substring match)")
    parser.add_argument("--columns", type=int, default=6)
    parser.add_argument("--cell", type=int, default=150)
    parser.add_argument("--name", default="grid", help="output file prefix")
    args = parser.parse_args()

    variants = list(variant_frames(args.client))
    if args.only:
        wanted = [name.strip() for name in args.only.split(",") if name.strip()]
        variants = [item for item in variants if any(w in item[0] for w in wanted)]
    print(f"{len(variants)} variants with art")
    out_dir = ROOT / "dnf_body_variants"
    out_dir.mkdir(exist_ok=True)
    font = load_font(13)
    columns, cell = args.columns, args.cell
    import av

    sheet_index = 0
    for start in range(0, len(variants), args.per_sheet):
        chunk = variants[start:start + args.per_sheet]
        sheet_index += 1
        rows = -(-len(chunk) // columns)
        longest = min(40, max(len(frames) for _n, frames in chunk))
        canvases = []
        for step in range(longest):
            canvas = Image.new("RGB", (columns * cell, rows * cell), (16, 18, 28))
            draw = ImageDraw.Draw(canvas)
            for slot, (name, frames) in enumerate(chunk):
                picture = frames[min(step, len(frames) - 1)]
                scale = min((cell - 10) / picture.width, (cell - 24) / picture.height, 1.0)
                size = (max(1, int(picture.width * scale)), max(1, int(picture.height * scale)))
                column, row = slot % columns, slot // columns
                canvas.paste(
                    picture.convert("RGB").resize(size, Image.LANCZOS),
                    (column * cell + (cell - size[0]) // 2, row * cell + 20),
                )
                draw.text((column * cell + 4, row * cell + 3), name.replace(".img", ""),
                          fill=(255, 220, 120), font=font)
            canvases.append(canvas)
        path = out_dir / f"{args.name}_{sheet_index:02d}.mp4"
        container = av.open(str(path), mode="w")
        stream = container.add_stream("mpeg4", rate=10)
        stream.width, stream.height = canvases[0].size
        stream.pix_fmt = "yuv420p"
        for canvas in canvases:
            for packet in stream.encode(av.VideoFrame.from_image(canvas)):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        container.close()
        print(f"  {path.name}: {len(chunk)} variants ({start}-{start + len(chunk) - 1})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
