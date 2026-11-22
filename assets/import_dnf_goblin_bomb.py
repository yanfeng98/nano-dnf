#!/usr/bin/env python3
"""Extract passive object 30021's FlyBomb bitmap and native animation evidence.

GoblinThrowerTaskmaster.mob explicitly declares [int data] 30021 (GobFlyBomb.obj ->
Animation/FlyBomb.ani -> Item/ThrowItem/FlyBomb.img).
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
    parser.add_argument("--out", type=Path, default=ROOT / "assets/goblin-bomb.png")
    args = parser.parse_args()
    mob = "monster/goblin/goblinthrowertaskmaster.mob"
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        tokens = archive.tokens(mob)
        object_id = next(tokens[i + 1][1] for i, t in enumerate(tokens) if t[1] == "[int data]")
        assert object_id == 30021
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

        sub_id = next(obj_tokens[i + 1][1] for i, t in enumerate(obj_tokens) if t[1] == "[int data]")
        assert sub_id == 30022
        sub_obj = "passiveobject/" + next(entries[i + 1][1].lower() for i, t in enumerate(entries) if t[1] == sub_id)
        sub_tokens = archive.tokens(sub_obj)
        flash_ani_path = "passiveobject/monster/goblin/animation/flybombflash.ani"
        flash_raw = archive.read(flash_ani_path)
        flash_ani = parse_animation(flash_raw, True)

        report = {
            "objectId": object_id,
            "subObjectId": sub_id,
            "mob": mob,
            "mobSHA256": hashlib.sha256(archive.read(mob)).hexdigest(),
            "object": obj,
            "objectSHA256": hashlib.sha256(archive.read(obj)).hexdigest(),
            "objectTokens": obj_tokens,
            "subObject": sub_obj,
            "subObjectSHA256": hashlib.sha256(archive.read(sub_obj)).hexdigest(),
            "subObjectTokens": sub_tokens,
            "animation": ani_path,
            "aniSHA256": hashlib.sha256(raw).hexdigest(),
            "animationData": ani,
            "flashAnimation": flash_ani_path,
            "flashAniSHA256": hashlib.sha256(flash_raw).hexdigest(),
            "flashAnimationData": flash_ani,
            "periodMilliseconds": duration,
            "endAngleRadians": angle,
        }
    entry = "sprite/" + ani["paths"][first["image"]].lower()
    pack = args.client / "ImagePacks2/sprite_item_throwitem.NPK"
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

    flash_first = flash_ani["frames"][0]
    flash_entry = "sprite/" + flash_ani["paths"][flash_first["image"]].lower()
    flash_pack = args.client / "ImagePacks2/sprite_monster_common.NPK"
    with flash_pack.open("rb") as handle:
        flash_item = next(item for item in NPK.open(handle).files if item.name.lower() == flash_entry)
        flash_data = flash_item.data
    flash_img = IMGFactory.open(io.BytesIO(flash_data))
    flash_frame = flash_img.images[flash_first["frame"]]
    flash_pic = flash_img.build(flash_frame).convert("RGBA")
    flash_out = args.out.with_name("goblin-bomb-flash.png")
    flash_pic.save(flash_out)

    pieces_entry = "sprite/monster/common/m0001.img"
    with flash_pack.open("rb") as handle:
        pieces_item = next(item for item in NPK.open(handle).files if item.name.lower() == pieces_entry)
        pieces_data = pieces_item.data
    pieces_img = IMGFactory.open(io.BytesIO(pieces_data))
    pieces_strip = Image.new("RGBA", (160, 40))
    for frame_idx in range(4):
        fr = pieces_img.images[frame_idx]
        pic = pieces_img.build(fr).convert("RGBA")
        pieces_strip.alpha_composite(pic, (frame_idx * 40 + (40 - pic.width) // 2, (40 - pic.height) // 2))
    pieces_out = args.out.with_name("goblin-bomb-pieces.png")
    pieces_strip.save(pieces_out)

    report.update(
        pack=str(pack),
        entry=entry,
        imgSHA256=hashlib.sha256(image_data).hexdigest(),
        sourceSize=list(picture.size),
        sourceOffset=list(offset),
        sourceRGBAsha256=hashlib.sha256(picture.tobytes()).hexdigest(),
        cell=[32, 32],
        anchor=[16, 16],
        pasteXY=paste,
        cellRGBAsha256=hashlib.sha256(cell.tobytes()).hexdigest(),
        flashEntry=flash_entry,
        flashImgSHA256=hashlib.sha256(flash_data).hexdigest(),
        flashSize=list(flash_pic.size),
        flashRGBAsha256=hashlib.sha256(flash_pic.tobytes()).hexdigest(),
        transparency="Original native RGBA preserved; no colour key or recolouring.",
        limits=[
            "150ms/angle endpoint are native data from FlyBomb.ani.",
            "Recording 30fps scans of V2 rooms 14/42/43 did not isolate a clear in-flight FlyBomb match.",
            "Trajectory, sub-explosion (30022), damage and absolute flight timing remain open.",
        ],
    )
    args.out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "object": object_id, "sourceSize": list(picture.size),
                      "period": duration, "angle": angle}))


if __name__ == "__main__":
    main()
