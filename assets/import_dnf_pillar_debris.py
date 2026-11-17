#!/usr/bin/env python3
"""Extract native stone pillar debris sprites (StonePillarParticle1..4) and PTL/ANI metadata."""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path
from PIL import Image
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from client_animation import parse_animation
from client_pvf import PvfArchive
sys.path.insert(0, str(ROOT / "assets"))
from import_dnf_monsters import offset_of


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, default=ROOT / "assets/pillar-debris.png")
    args = parser.parse_args()

    ptl_path = "passiveobject/mapobject/breakableobject/particle/stonepillardamage.ptl"
    ani_prefix = "passiveobject/mapobject/breakableobject/animation/stonepillar/"
    with PvfArchive(args.client / "Script.pvf") as archive:
        ptl_raw = archive.read(ptl_path)
        ptl_tokens = archive.tokens(ptl_path)
        animations = []
        for i in range(1, 5):
            ap = f"{ani_prefix}stonepillarparticle{i}.ani"
            raw = archive.read(ap)
            ani = parse_animation(raw, True)
            animations.append({"path": ap, "aniSHA256": hashlib.sha256(raw).hexdigest(), "data": ani})

    pack = args.client / "ImagePacks2/sprite_map_breakableobject_stonepillar.NPK"
    with pack.open("rb") as handle:
        entries = {item.name.lower(): item.data for item in NPK.open(handle).files}

    cell_size = 48
    anchor = [24, 24]
    atlas = Image.new("RGBA", (cell_size * 4, cell_size))
    pieces = []
    for idx, anim in enumerate(animations):
        first = anim["data"]["frames"][0]
        last = anim["data"]["frames"][1]
        entry = "sprite/" + anim["data"]["paths"][first["image"]].lower()
        img_data = entries[entry]
        img = IMGFactory.open(io.BytesIO(img_data))
        frame = img.images[first["frame"]]
        pic = img.build(frame).convert("RGBA")
        offset = offset_of(frame)
        paste = [anchor[0] + offset[0] + first["xy"][0], anchor[1] + offset[1] + first["xy"][1]]
        assert 0 <= paste[0] and paste[0] + pic.width <= cell_size
        assert 0 <= paste[1] and paste[1] + pic.height <= cell_size
        atlas.alpha_composite(pic, (idx * cell_size + paste[0], paste[1]))
        pieces.append({
            "index": idx,
            "entry": entry,
            "imgSHA256": hashlib.sha256(img_data).hexdigest(),
            "size": list(pic.size),
            "offset": list(offset),
            "xy": first["xy"],
            "pasteXY": paste,
            "periodMs": next(v for k, v in first["props"] if k == 12),
            "endAngleRad": next(v for k, v in last["props"] if k == 8),
            "sourceRGBAsha256": hashlib.sha256(pic.tobytes()).hexdigest(),
        })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.out)
    report = {
        "ptlPath": ptl_path,
        "ptlSHA256": hashlib.sha256(ptl_raw).hexdigest(),
        "ptlTokens": ptl_tokens,
        "pack": str(pack),
        "cell": [cell_size, cell_size],
        "anchor": anchor,
        "atlasRGBAsha256": hashlib.sha256(atlas.tobytes()).hexdigest(),
        "pieces": pieces,
    }
    args.out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "pieces": len(pieces), "size": list(atlas.size)}))


if __name__ == "__main__":
    main()
