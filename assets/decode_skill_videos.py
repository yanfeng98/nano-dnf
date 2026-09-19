#!/usr/bin/env python3
"""Decrypt the client's per-skill preview clips so they can actually be watched.

    pip install av pillow
    python3 assets/decode_skill_videos.py [--client DIR] [--set Swordman] [--all]

DNF ships one clip per skill (Video/<Class>/<SkillName>.avi) wrapped in a
"Neople Video File" container. The wrapper is NOT encryption-grade: the first
1024 bytes are plain and every later byte is its plaintext XOR the plaintext
1024 bytes before it, so the whole file falls out iteratively. The payload
inside is an ordinary AVI (MPEG-1, 160x90).

Writes per clip:
  assets/dnf_src/skill-videos/<Name>.mp4    playable clip
  assets/dnf_src/skill-videos/<Name>.png    numbered contact sheet of every frame
  assets/dnf_src/skill-videos/INDEX.txt     what is in the folder, and the frames

Outputs are working references (DNF art, gitignored).
"""

from __future__ import annotations

import argparse
import pathlib
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
MAGIC = b"Neople Video Fil"
HEADER = 32
CLEAR = 1024
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return None


def decrypt(data: bytes) -> bytes:
    """Neople wrapper: plain 1024-byte prefix, then delta against 1024 bytes back."""
    if not data.startswith(MAGIC):
        raise ValueError("not a Neople Video File")
    size = struct.unpack_from("<I", data, 0x18)[0]
    out = bytearray(size)
    copy = min(CLEAR, size)
    out[:copy] = data[HEADER:HEADER + copy]
    for index in range(CLEAR, size):
        out[index] = data[index + HEADER] ^ out[index - CLEAR]
    return bytes(out)


def frames_of(path: pathlib.Path):
    import av

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return [Image.fromarray(frame.to_ndarray(format="rgb24")) for frame in container.decode(stream)]


def contact_sheet(name: str, frames, out: pathlib.Path, columns: int = 10, cell: int = 110) -> None:
    font = load_font(11)
    head = load_font(15)
    rows = -(-len(frames) // columns)
    sheet = Image.new("RGB", (columns * cell, rows * (cell + 18) + 24), (18, 18, 26))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 4), f"{name} — {len(frames)} 帧", fill=(255, 235, 150), font=head)
    for index, frame in enumerate(frames):
        column, row = index % columns, index // columns
        x, y = column * cell, 24 + row * (cell + 18)
        scale = min((cell - 6) / frame.width, (cell - 6) / frame.height, 1.0)
        size = (max(1, int(frame.width * scale)), max(1, int(frame.height * scale)))
        sheet.paste(frame.resize(size, Image.LANCZOS), (x + (cell - size[0]) // 2, y + 16 + (cell - size[1]) // 2))
        draw.text((x + 3, y), str(index), fill=(150, 200, 255), font=font)
    sheet.save(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--set", default="Swordman", help="which Video/<set> folder to decode")
    parser.add_argument("--all", action="store_true", help="every Video/<set> folder")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    video_root = args.client / "Video"
    sets = sorted(p for p in video_root.iterdir() if p.is_dir()) if args.all else [video_root / args.set]
    out_dir = ROOT / "dnf_src" / "skill-videos"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_lines = []
    import av

    for folder in sets:
        if not folder.is_dir():
            print(f"missing {folder}", file=sys.stderr)
            continue
        clips = sorted(folder.glob("*.avi"))
        if args.limit:
            clips = clips[:args.limit]
        for clip in clips:
            name = f"{folder.name}-{clip.stem}"
            plain = decrypt(clip.read_bytes())
            plain_path = pathlib.Path("/tmp") / f"{clip.stem}.plain.avi"
            plain_path.write_bytes(plain)
            try:
                frames = frames_of(plain_path)
            except Exception as exc:
                print(f"  {name}: decode failed: {str(exc)[:60]}", file=sys.stderr)
                continue
            if not frames:
                continue
            out_mp4 = out_dir / f"{name}.mp4"
            container = av.open(str(out_mp4), mode="w")
            stream = container.add_stream("mpeg4", rate=30)
            stream.width, stream.height = frames[0].size
            stream.pix_fmt = "yuv420p"
            for frame in frames:
                for packet in stream.encode(av.VideoFrame.from_image(frame)):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
            container.close()
            contact_sheet(name, frames, out_dir / f"{name}.png")
            index_lines.append(f"{name}: {len(frames)} frames, {frames[0].width}x{frames[0].height}")
            print(f"  {name}: {len(frames)} frames")

    (out_dir / "INDEX.txt").write_text("\n".join(index_lines) + "\n")
    print(f"wrote {len(index_lines)} clips to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
