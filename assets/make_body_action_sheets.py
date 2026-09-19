#!/usr/bin/env python3
"""Cut the swordman's body sheet into its individual actions.

    pip install pydnfex pillow
    python3 assets/make_body_action_sheets.py [--client DIR]

The body img (sm_body0000.img, 242 frames) concatenates every animation the
class has back to back: stand, walk, run, the normal-attack chain, jumps,
damage, and a run of longer skill motions. Picking one skill's body animation
out of that by frame number is guesswork, so this splits the sheet wherever the
character returns to the still pose and writes:

  assets/dnf_body_actions.png    - one row per action, every frame in order with
                                   its frame number in the body sheet
  assets/dnf_body_actions.mp4    - every action animating side by side, so a row
                                   can be recognised by motion instead of a name
  assets/dnf_body_actions.txt    - action -> frame range

Both are working references (DNF art, gitignored).
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)
CELL = 78


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def baker():
    """The DNF swordman baker, reused for its layer decoding."""
    spec = importlib.util.spec_from_file_location("baker", ROOT / "import_dnf_swordman.py")
    module = importlib.util.module_from_spec(spec)
    sys.argv = ["baker"]
    spec.loader.exec_module(module)
    return module


def compose(module, client: pathlib.Path, indices):
    decoder = module.Decoder(client, force=False)
    layer_frames = [(key, decoder.frames(key)) for key in module.LAYERS]
    overlay_frames = [(decoder.frames(key), ref, w, h) for key, ref, w, h in module.OVERLAYS]
    out = []
    for index in indices:
        try:
            frame, x, y = module.composed_frame(layer_frames, overlay_frames, index)
        except SystemExit:
            continue
        out.append((index, frame, x, y))
    return out


def decode_frame(img, index):
    """(picture, x, y) for one frame of a DNF img, links and colour boards resolved."""
    from pydnfex.img.image.format import FormatConvertor
    from pydnfex.util import image as image_util

    if index >= len(img.images):
        return None
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
            picture = image_util.load_raw(pixels, item.w, item.h).convert("RGBA")
            return (picture, getattr(item, "x", 0), getattr(item, "y", 0))
        except Exception:
            continue
    return None


def render_skin(module, client: pathlib.Path, skin: str, per_sheet: int, columns: int, cell: int) -> int:
    """One body img (a whole costume look) as numbered frame sheets."""
    import io
    from pydnfex.npk import NPK
    from pydnfex.img.version import IMGFactory

    pack = client / "ImagePacks2" / "sprite_character_swordman_equipment_avatar_skin.NPK"
    with open(pack, "rb") as handle:
        npk = NPK.open(handle)
        entry = next((item for item in npk.files if item.name.endswith(f"{skin}.img")), None)
        if entry is None:
            raise SystemExit(f"{skin}.img not found")
        body = IMGFactory.open(io.BytesIO(entry.data))
    total = len(body.images)

    # The katana is what the look actually holds; its 210-frame set lines up with
    # the 210-frame body looks.
    decoder = module.Decoder(client, force=False)
    weapon = []
    for key in ("weapon_b", "weapon_c"):
        try:
            weapon.append(decoder.frames(key))
        except Exception:
            pass

    # One transform for every frame: a per-frame crop makes quiet frames blow up
    # and busy ones shrink, which makes the sheet useless for reading motion.
    placed = []
    for index in range(total):
        if index % 200 == 0:
            print(f"  decoding {index}/{total}…", file=sys.stderr)
        layers = []
        body_frame = decode_frame(body, index)
        if body_frame is not None and body_frame[0].getbbox():
            layers.append(body_frame)
        for frames in weapon:
            if index < len(frames):
                picture, x, y = frames[index]
                if picture is not None and picture.getbbox():
                    layers.append((picture, x, y))
        placed.append(layers)
    left = min(x for layers in placed for _p, x, _y in layers)
    top = min(y for layers in placed for _p, _x, y in layers)
    right = max(x + p.width for layers in placed for p, x, _y in layers)
    bottom = max(y + p.height for layers in placed for p, _x, y in layers)

    font = load_font(12)
    head = load_font(16)
    out_dir = ROOT / "dnf_src" / f"full-frames-{skin}"
    out_dir.mkdir(parents=True, exist_ok=True)
    sheets = 0
    for start in range(0, total, per_sheet):
        indices = list(range(start, min(total, start + per_sheet)))
        rows = -(-len(indices) // columns)
        sheet = Image.new("RGB", (columns * cell, rows * cell + 26), (18, 18, 26))
        draw = ImageDraw.Draw(sheet)
        draw.text((6, 5), f"{skin}.img 帧 {start}-{indices[-1]}（带太刀 5601）",
                  fill=(255, 235, 150), font=head)
        for slot, index in enumerate(indices):
            layers = placed[index]
            if not layers:
                continue
            canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
            for picture, x, y in layers:
                canvas.alpha_composite(picture, (x - left, y - top))
            scale = min((cell - 8) / canvas.width, (cell - 8) / canvas.height, 1.0)
            size = (max(1, int(canvas.width * scale)), max(1, int(canvas.height * scale)))
            column, row = slot % columns, slot // columns
            sheet.paste(
                canvas.convert("RGB").resize(size, Image.LANCZOS),
                (column * cell + (cell - size[0]) // 2, 26 + row * cell + (cell - size[1]) // 2),
            )
            draw.text((column * cell + 3, 26 + row * cell + 2), str(index), fill=(150, 200, 255), font=font)
        path = out_dir / f"frames-{start:03d}-{indices[-1]:03d}.png"
        sheet.save(path)
        sheets += 1
        print(f"wrote {path} ({sheet.width}x{sheet.height})")
    print(f"{skin}: {total} frames in {sheets} sheet(s)")
    return 0


def signature(frame: Image.Image) -> bytes:
    box = frame.getbbox()
    flat = Image.new("RGB", frame.size, (0, 0, 0))
    flat.paste(frame.convert("RGB"), (0, 0), frame)
    if box:
        flat = flat.crop(box)
    return flat.resize((24, 24), Image.LANCZOS).tobytes()


def distance(a: bytes, b: bytes) -> float:
    return sum((a[i] - b[i]) ** 2 for i in range(len(a))) / len(a)


def split_actions(frames, hold: int = 80, minimum: int = 3):
    """Split where the animation pauses: DNF holds a pose between actions.

    The body sheet has no markers, but every animation it concatenates stops on
    a pose for a frame or two before the next one starts, so the near-identical
    transitions between frames are the cut points.
    """
    indices = sorted(frames)
    signatures = {index: signature(frames[index]) for index in indices}
    cuts = []
    run = 0
    for previous, index in zip(indices, indices[1:]):
        if distance(signatures[previous], signatures[index]) < hold:
            run += 1
        else:
            if run:
                cuts.append(index - run)
            run = 0
    segments = []
    start = indices[0]
    for cut in cuts:
        if cut - start >= minimum:
            segments.append((start, cut))
        start = cut
    if indices[-1] - start >= minimum:
        segments.append((start, indices[-1]))
    return segments


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--skin", help="render one body img as numbered frame sheets (e.g. sm_body0048)")
    parser.add_argument("--per-sheet", type=int, default=60)
    parser.add_argument("--columns", type=int, default=10)
    parser.add_argument("--cell", type=int, default=132)
    args = parser.parse_args()

    module = baker()
    if args.skin:
        return render_skin(module, args.client, args.skin, args.per_sheet, args.columns, args.cell)

    drawn = compose(module, args.client, range(0, 242))
    frames = {index: frame for index, frame, _x, _y in drawn}
    actions = split_actions(frames)
    print(f"{len(actions)} actions: " + ", ".join(f"{a}-{b}" for a, b in actions))

    font = load_font(13)
    head = load_font(15)
    width = 250 + max(b - a + 1 for a, b in actions) * CELL
    sheet = Image.new("RGB", (width, 60 + CELL * len(actions)), (18, 18, 26))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 8), "身体图切出来的动作（帧号是身体图里的帧号）", fill=(255, 235, 150), font=head)
    for row, (first, last) in enumerate(actions):
        y = 60 + row * CELL
        draw.text((8, y + 12), f"{row}: {first}-{last} ({last - first + 1}帧)",
                  fill=(255, 220, 120), font=font)
        for column, index in enumerate(range(first, last + 1)):
            frame = frames.get(index)
            if frame is None:
                continue
            scale = min((CELL - 6) / frame.width, (CELL - 6) / frame.height, 1.0)
            size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
            sheet.paste(
                frame.convert("RGB").resize(size, Image.LANCZOS),
                (250 + column * CELL + (CELL - size[0]) // 2, y + (CELL - size[1]) // 2),
            )
            draw.text((250 + column * CELL + 2, y + 2), str(index), fill=(150, 200, 255), font=font)
    sheet.save(ROOT / "dnf_body_actions.png")
    print(f"wrote {ROOT / 'dnf_body_actions.png'} ({sheet.width}x{sheet.height})")

    lines = ["身体图（sm_body0000.img）切出来的动作：", ""]
    for row, (first, last) in enumerate(actions):
        lines.append(f"{row:>3}  帧 {first}-{last}  ({last - first + 1} 帧)")
    (ROOT / "dnf_body_actions.txt").write_text("\n".join(lines) + "\n")
    print(f"wrote {ROOT / 'dnf_body_actions.txt'}")

    # one animating cell per action, so motion can be recognised by eye
    import av
    columns, cell = 4, 200
    rows = -(-len(actions) // columns)
    canvases = []
    longest = min(48, max(b - a + 1 for a, b in actions))
    for step in range(longest):
        canvas = Image.new("RGB", (columns * cell, rows * cell), (16, 18, 28))
        cdraw = ImageDraw.Draw(canvas)
        for slot, (first, last) in enumerate(actions):
            index = min(first + step, last)
            frame = frames.get(index)
            if frame is None:
                continue
            scale = min((cell - 10) / frame.width, (cell - 30) / frame.height, 1.0)
            size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
            column, row = slot % columns, slot // columns
            canvas.paste(
                frame.convert("RGB").resize(size, Image.LANCZOS),
                (column * cell + (cell - size[0]) // 2, row * cell + 26),
            )
            cdraw.text((column * cell + 4, row * cell + 4), f"{slot}: {first}-{last}",
                       fill=(255, 220, 120), font=font)
        canvases.append(canvas)
    container = av.open(str(ROOT / "dnf_body_actions.mp4"), mode="w")
    stream = container.add_stream("mpeg4", rate=10)
    stream.width, stream.height = canvases[0].size
    stream.pix_fmt = "yuv420p"
    for canvas in canvases:
        for packet in stream.encode(av.VideoFrame.from_image(canvas)):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    print(f"wrote {ROOT / 'dnf_body_actions.mp4'} ({len(canvases)} frames)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
