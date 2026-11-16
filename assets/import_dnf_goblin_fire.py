#!/usr/bin/env python3
"""Extract hillgab fire declarations and a separately identified particle candidate."""
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


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, default=ROOT / "assets/goblin-fire.png")
    args = parser.parse_args()
    mob = "monster/goblin/hillgab.mob"
    obj = "passiveobject/monster/goblin/hillgabsizzle.obj"
    ani_path = "passiveobject/common/animation/firemissileparticle1.ani"
    ptl = "passiveobject/common/particle/firemissilegerocenter.ptl"
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        mob_tokens = archive.tokens(mob)
        assert next(mob_tokens[i + 1][1] for i, t in enumerate(mob_tokens)
                    if t[1] == "[passive object index]") == 30047
        listing = archive.tokens("passiveobject/passiveobject.lst")
        assert "passiveobject/" + next(listing[i + 1][1].lower() for i, t in enumerate(listing)
                                       if t[1] == 30047) == obj
        obj_tokens = archive.tokens(obj)
        assert next(obj_tokens[i + 1][1].lower() for i, t in enumerate(obj_tokens)
                    if t[1] == "[basic motion]") == "../../common/animation/firemissile.ani"
        ani = parse_animation(archive.read(ani_path), True)
        proof = {"objectId": 30047, "mob": mob, "object": obj, "animation": ani_path,
                 "particle": ptl, "candidateParticle": "passiveobject/common/particle/firemissileparticle.ptl",
                 "candidateParticleTokens": archive.tokens("passiveobject/common/particle/firemissileparticle.ptl"), "sourceSHA256": {p: sha(archive.read(p)) for p in [mob, obj, ani_path, ptl, "passiveobject/common/particle/firemissileparticle.ptl"]},
                 "mobTokens": mob_tokens, "objectTokens": obj_tokens, "particleTokens": archive.tokens(ptl),
                 "primaryAnimation": "passiveobject/common/animation/firemissile.ani",
                 "primaryAnimationSHA256": sha(archive.read("passiveobject/common/animation/firemissile.ani")),
                 "primaryAnimationData": parse_animation(archive.read("passiveobject/common/animation/firemissile.ani"), True),
                 "animationData": ani, "cell": [128, 128], "anchor": [64, 64], "frames": []}
    pack = args.client / "ImagePacks2/sprite_common_commoneffect.NPK"
    entry = "sprite/common/commoneffect/fire.img"
    with pack.open("rb") as handle:
        data = next(item.data for item in NPK.open(handle).files if item.name.lower() == entry)
    img = IMGFactory.open(io.BytesIO(data))
    atlas = Image.new("RGBA", (1152, 128))
    assert len(ani["frames"]) == 9
    for ordinal, frame in enumerate(ani["frames"]):
        assert frame["frame"] == ordinal and next(v for k, v in frame["props"] if k == 12) == 230
        native = img.images[ordinal]
        picture = img.build(native).convert("RGBA")
        offset = list(offset_of(native))
        paste = [64 + offset[i] + frame["xy"][i] for i in range(2)]
        assert all(0 <= paste[i] and paste[i] + picture.size[i] <= 128 for i in range(2))
        cell = Image.new("RGBA", (128, 128))
        cell.alpha_composite(picture, tuple(paste))
        atlas.alpha_composite(cell, (ordinal * 128, 0))
        proof["frames"].append({"ordinal": ordinal, "offset": offset, "aniXY": frame["xy"],
                                "size": list(picture.size), "pasteXY": paste,
                                "sourceRGBAsha256": sha(picture.tobytes()), "cellRGBAsha256": sha(cell.tobytes())})
    proof.update(pack=str(pack), entry=entry, imgSHA256=sha(data), atlasRGBAsha256=sha(atlas.tobytes()),
                 limits=["FireMissile primary ANI has no bitmap; FireMissileParticle1 is a named candidate, not an explicit child reference.",
                         "Native source pixels and offset+ANI positions preserved without transforms or colour key.",
                         "Runtime candidate50Hz/lifetime350ms is supported by a limited orange-profile comparison, not proven engine scheduling.",
                         "Runtime presentation angle180deg follows one visible-template calibration; raw ANI40.0 and PTL axes remain uninterpreted.",
                         "Light particles, other variants, blend/interpolation/inheritance, landing and detached trails remain open."])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.out)
    args.out.with_suffix(".json").write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "frames": 9, "object": 30047}))


if __name__ == "__main__":
    main()
