#!/usr/bin/env python3
"""Extract passive object30001's stone bitmap and native animation evidence.

This does not assign the throwing captain's unverified int-data object30021.
Native movement fields are recorded, not substituted for video measurements.
"""
import argparse
import hashlib
import io
import json
import posixpath
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
    parser.add_argument("--out", type=Path, default=ROOT / "assets/goblin-stone.png")
    parser.add_argument("--debris-out", type=Path, default=ROOT / "assets/goblin-stone-debris.png")
    args = parser.parse_args()
    mob = "monster/goblin/goblinthrower.mob"
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        tokens = archive.tokens(mob)
        object_id = next(tokens[i + 1][1] for i, t in enumerate(tokens) if t[1] == "[passive object index]")
        assert object_id == 30001
        entries = archive.tokens("passiveobject/passiveobject.lst")
        obj = "passiveobject/" + next(entries[i + 1][1].lower() for i, t in enumerate(entries) if t[1] == object_id)
        obj_tokens = archive.tokens(obj)
        relative = next(obj_tokens[i + 1][1] for i, t in enumerate(obj_tokens) if t[1] == "[basic motion]")
        ani_path = posixpath.join(posixpath.dirname(obj), relative.lower())
        raw = archive.read(ani_path)
        ani = parse_animation(raw, True)
        first, last = ani["frames"]
        assert first["frame"] == last["frame"] == 0
        duration = next(v for k, v in first["props"] if k == 12)
        angle = next(v for k, v in last["props"] if k == 8)
        particle = "monster/goblin/particle/throwstone.ptl"
        particle_tokens = archive.tokens(particle)
        origin = [next(tokens[i + 1][1] for i, t in enumerate(tokens)
                       if t[1] == f"[passive object start {axis} cood]") for axis in ["x", "y", "z"]]
        speed_index = next(i for i, t in enumerate(particle_tokens) if t[1] == "[move variable 1]")
        life = next(particle_tokens[i + 1][1] for i, t in enumerate(particle_tokens) if t[1] == "[life time]")
        report = {"objectId": object_id, "mob": mob, "mobSHA256": hashlib.sha256(archive.read(mob)).hexdigest(),
                  "object": obj, "objectSHA256": hashlib.sha256(archive.read(obj)).hexdigest(),
                  "objectTokens": obj_tokens, "animation": ani_path, "aniSHA256": hashlib.sha256(raw).hexdigest(),
                  "animationData": ani, "particle": particle, "particleTokens": particle_tokens,
                  "launchOriginNative": origin, "speedRangeNative": [particle_tokens[speed_index + 1][1], particle_tokens[speed_index + 2][1]],
                  "lifeTimeMilliseconds": life,
                  "periodMilliseconds": duration, "endAngleRadians": angle}
    entry = "sprite/" + ani["paths"][first["image"]].lower()
    pack = args.client / "ImagePacks2/sprite_monster_goblin_passiveobject.NPK"
    with pack.open("rb") as handle:
        item = next(item for item in NPK.open(handle).files if item.name.lower() == entry)
        image_data = item.data
    img = IMGFactory.open(io.BytesIO(image_data))
    frame = img.images[first["frame"]]
    picture = img.build(frame).convert("RGBA")
    offset = offset_of(frame)
    paste = [16 + offset[i] + first["xy"][i] for i in range(2)]
    cell = Image.new("RGBA", (32, 32))
    cell.alpha_composite(picture, tuple(paste))
    assert picture.size == (17, 17) and paste == [8, 8]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cell.save(args.out)
    report.update(pack=str(pack), entry=entry, imgSHA256=hashlib.sha256(image_data).hexdigest(),
                  sourceSize=list(picture.size), sourceOffset=list(offset), sourceRGBAsha256=hashlib.sha256(picture.tobytes()).hexdigest(),
                  cell=[32, 32], anchor=[16, 16], pasteXY=paste, cellRGBAsha256=hashlib.sha256(cell.tobytes()).hexdigest(),
                  transparency="Original native RGBA preserved; no colour key or recolouring.",
                  limits=["150ms/angle endpoint are native data; Canvas rotation direction must be calibrated against the recording.",
                          "Native world-plane projection follows existing scene scale; video size/phase are not independently measured.",
                          "Trajectory, impact/explosion, damage and absolute flight timing remain separate open work.",
                          "The throwing captain is not assigned this stone object."])
    args.out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    destroy_ptl = "passiveobject/monster/goblin/particle/throwstonedestroy.ptl"
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        destroy_tokens = archive.tokens(destroy_ptl)
    destroy_entry = "sprite/monster/goblin/passiveobject/throwstonedestroy.img"
    with pack.open("rb") as handle:
        destroy_item = next(f for f in NPK.open(handle).files if f.name.lower() == destroy_entry)
        destroy_data = destroy_item.data
    destroy_img = IMGFactory.open(io.BytesIO(destroy_data))
    debris_strip = Image.new("RGBA", (32, 16))
    for frame_idx in range(2):
        fr = destroy_img.images[frame_idx]
        pic = destroy_img.build(fr).convert("RGBA")
        debris_strip.alpha_composite(pic, (frame_idx * 16 + (16 - pic.width) // 2, (16 - pic.height) // 2))
    args.debris_out.parent.mkdir(parents=True, exist_ok=True)
    debris_strip.save(args.debris_out)

    print(json.dumps({"out": str(args.out), "debrisOut": str(args.debris_out), "object": object_id,
                      "sourceSize": list(picture.size), "period": duration, "angle": angle}))


if __name__ == "__main__":
    main()
