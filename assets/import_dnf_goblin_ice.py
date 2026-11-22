#!/usr/bin/env python3
"""Extract seagab's explicit ice projectile animation without particle guesses."""
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
    parser.add_argument("--out", type=Path, default=ROOT / "assets/goblin-ice.png")
    args = parser.parse_args()
    mob = "monster/goblin/seagab.mob"
    obj = "passiveobject/monster/goblin/seagabicicle.obj"
    ani_path = "passiveobject/common/animation/icemissile1.ani"
    ptl = "passiveobject/common/particle/icemissile.ptl"
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        mob_tokens = archive.tokens(mob)
        assert next(mob_tokens[i + 1][1] for i, t in enumerate(mob_tokens)
                    if t[1] == "[passive object index]") == 30057
        listing = archive.tokens("passiveobject/passiveobject.lst")
        assert "passiveobject/" + next(listing[i + 1][1].lower() for i, t in enumerate(listing)
                                       if t[1] == 30057) == obj
        obj_tokens = archive.tokens(obj)
        assert next(obj_tokens[i + 1][1].lower() for i, t in enumerate(obj_tokens)
                    if t[1] == "[basic motion]") == "../../common/animation/icemissile1.ani"
        ani = parse_animation(archive.read(ani_path), True)
        aura_ani_path = "passiveobject/common/animation/icemissile2.ani"
        aura_ani = parse_animation(archive.read(aura_ani_path), True)
        proof = {"objectId": 30057, "mob": mob, "object": obj, "animation": ani_path,
                 "particle": ptl, "sourceSHA256": {p: sha(archive.read(p)) for p in [mob, obj, ani_path, ptl]},
                 "mobTokens": mob_tokens, "objectTokens": obj_tokens, "particleTokens": archive.tokens(ptl),
                 "animationData": ani, "cell": [64, 64], "anchor": [32, 32], "frames": []}
    pack = args.client / "ImagePacks2/sprite_common_commoneffect.NPK"
    entry = "sprite/common/commoneffect/icemissile1.img"
    with pack.open("rb") as handle:
        data = next(item.data for item in NPK.open(handle).files if item.name.lower() == entry)
    img = IMGFactory.open(io.BytesIO(data))
    atlas = Image.new("RGBA", (512, 64))
    assert len(ani["frames"]) == 8
    for ordinal, frame in enumerate(ani["frames"]):
        assert frame["frame"] == ordinal and frame["props"] == [(12, 50)]
        native = img.images[ordinal]
        picture = img.build(native).convert("RGBA")
        offset = list(offset_of(native))
        paste = [32 + offset[i] + frame["xy"][i] for i in range(2)]
        assert all(0 <= paste[i] and paste[i] + picture.size[i] <= 64 for i in range(2))
        cell = Image.new("RGBA", (64, 64))
        cell.alpha_composite(picture, tuple(paste))
        atlas.alpha_composite(cell, (ordinal * 64, 0))
        proof["frames"].append({"ordinal": ordinal, "offset": offset, "aniXY": frame["xy"],
                                "size": list(picture.size), "pasteXY": paste,
                                "sourceRGBAsha256": sha(picture.tobytes()), "cellRGBAsha256": sha(cell.tobytes())})
    proof.update(pack=str(pack), entry=entry, imgSHA256=sha(data), atlasRGBAsha256=sha(atlas.tobytes()),
                 limits=["Native primary motion only; IceMissile2 and particle children are not baked into this atlas.",
                         "No colour key or recolouring; original RGBA and native offset+ANI positioning preserved.",
                         "Vertical sine semantics, piercing-power interpretation, impact and AI timing remain open.",
                         "Native declarations are not independent video motion or appearance calibration."])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.out)
    args.out.with_suffix(".json").write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n")

    aura_entry = "sprite/common/commoneffect/icemissile2.img"
    with pack.open("rb") as handle:
        aura_data = next(item.data for item in NPK.open(handle).files if item.name.lower() == aura_entry)
    aura_img = IMGFactory.open(io.BytesIO(aura_data))
    aura_atlas = Image.new("RGBA", (15 * 192, 64))
    for ordinal, frame in enumerate(aura_ani["frames"]):
        native = aura_img.images[frame["frame"]]
        picture = aura_img.build(native).convert("RGBA")
        offset = offset_of(native)
        paste = (96 + offset[0] + frame["xy"][0], 32 + offset[1] + frame["xy"][1])
        cell = Image.new("RGBA", (192, 64))
        cell.alpha_composite(picture, paste)
        aura_atlas.alpha_composite(cell, (ordinal * 192, 0))
    aura_atlas.save(args.out.with_name("goblin-ice-aura.png"))

    print(json.dumps({"out": str(args.out), "frames": 8, "auraFrames": 15, "object": 30057}))


if __name__ == "__main__":
    main()
