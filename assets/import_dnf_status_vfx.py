#!/usr/bin/env python3
"""Bake authentic DNF 70 freeze crystal & dark-purple boss death burst VFX.

Extracts:
- `sprite_common_activestatus.NPK`: `freeze.img` (frames 3, 7, 18, 19, 20)
- `sprite_common_commoneffect.NPK`: `darkfireexp.img` (purple/dark death burst frames)

Outputs `assets/status-vfx.png` and `assets/dnf_src/status-vfx.json`.
"""

from __future__ import annotations

import io
import json
import pathlib
import sys

from PIL import Image
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import shelf_pack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士/ImagePacks2_70")
OUT = ROOT / "assets" / "status-vfx.png"
META = ROOT / "assets" / "dnf_src" / "status-vfx.json"


def load_npk(name: str) -> dict[str, bytes]:
    with open(CLIENT / name, "rb") as f:
        npk = NPK.open(f)
        npk.load_all()
        return {e.name.replace("\\", "/").split("/")[-1]: e.data for e in npk.files}


def main() -> None:
    act = load_npk("sprite_common_activestatus.NPK")
    ce = load_npk("sprite_common_commoneffect.NPK")

    art: list[tuple[str, Image.Image]] = []
    frz = IMGFactory.open(io.BytesIO(act["freeze.img"]))
    for label, idx in [("freeze_back", 3), ("freeze_front", 7), ("freeze_shatter0", 18), ("freeze_shatter1", 19), ("freeze_shatter2", 20)]:
        im = frz.build(frz.images[idx]).convert("RGBA")
        bb = im.getbbox()
        art.append((label, im.crop(bb) if bb else im))

    # Extract darkfireexp.img (up to 8 frames) + shootingstarglow.img (3 frames) for authentic boss death burst
    dfe = IMGFactory.open(io.BytesIO(ce["darkfireexp.img"]))
    step = max(1, len(dfe.images) // 8)
    for i, idx in enumerate(range(0, len(dfe.images), step)[:8]):
        im = dfe.build(dfe.images[idx]).convert("RGBA")
        bb = im.getbbox()
        art.append((f"bossburst_{i}", im.crop(bb) if bb else im))

    sg = IMGFactory.open(io.BytesIO(ce["shootingstarglow.img"]))
    for i in range(min(3, len(sg.images))):
        im = sg.build(sg.images[i]).convert("RGBA")
        bb = im.getbbox()
        art.append((f"bossglow_{i}", im.crop(bb) if bb else im))

    width = 1024
    spots, height = shelf_pack([(im.width, im.height) for _, im in art], width)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rects = {}
    for (name, im), (x, y, w, h) in zip(art, spots):
        sheet.alpha_composite(im, (x, y))
        rects[name] = [x, y, w, h]

    sheet.save(OUT)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({"sheet": [sheet.width, sheet.height], "rects": rects}, indent=2))
    print(f"status-vfx: {len(art)} frames -> {OUT} ({sheet.width}x{sheet.height})")
    for k, r in rects.items():
        print(f"  {k:16s}: {r}")


if __name__ == "__main__":
    main()
