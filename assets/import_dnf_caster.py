#!/usr/bin/env python3
"""Compose goblinthrower MOB/ANI/EQU layers from the installed client.

Each pose gets its own cells: the attack has an extra layer400, so a body-frame
index alone is not a complete composite identity. Native offsets are preserved
with one shared integer translation, including the half-pixel foot centre.
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
from import_dnf_monsters import key_black, offset_of

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from client_animation import parse_animation
from client_pvf import PvfArchive

POSES = [("idle", "waiting"), ("walk", "move"), ("attack", "attack"),
         ("down", "down"), ("rise", "sit")]


def motion_links(tokens, owner, tag):
    layer = 0
    for index, token in enumerate(tokens):
        if token[1] == "[LAYER]":
            layer = tokens[index + 1][1]
            if layer >= 2**31:
                layer -= 2**32
        if token[1] == f"[{tag} motion]":
            # All selected MOB actions use attack index0; preserve each EQU layer block.
            relative = tokens[index + 1][1]
            if relative:
                yield layer, posixpath.normpath(posixpath.join(posixpath.dirname(owner), relative.lower()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, default=ROOT / "assets/caster-reference.png")
    args = parser.parse_args()
    images, sources = {}, {}
    for name in ["sprite_monster_goblin.NPK", "sprite_monster_goblin_equipment.NPK"]:
        with (args.client / "ImagePacks2" / name).open("rb") as handle:
            for item in NPK.open(handle).files:
                path = item.name.replace("\\", "/").lower().removeprefix("sprite/")
                if path.startswith("monster/goblin/") and path.endswith(".img"):
                    images[path] = item.data
                    sources[path] = {"pack": name, "imgSHA256": hashlib.sha256(item.data).hexdigest()}
    objects, pictures = {}, {}

    def picture(path, index):
        path = path.replace("\\", "/").lower().removeprefix("sprite/")
        key = (path, index)
        if key not in pictures:
            if path not in objects:
                objects[path] = IMGFactory.open(io.BytesIO(images[path]))
            obj = objects[path]
            frame = obj.images[index]
            while type(frame).__name__ == "ImageLink":
                frame = obj.images[frame.index]
            raw = obj.build(frame).convert("RGBA")
            keyed = key_black(raw.copy())
            pictures[key] = (keyed, offset_of(frame), {"image": path, "frame": index,
                **sources[path], "rawRGBAsha256": hashlib.sha256(raw.tobytes()).hexdigest(),
                "keyedRGBAsha256": hashlib.sha256(keyed.tobytes()).hexdigest()})
        return pictures[key]

    mob = "monster/goblin/goblinthrower.mob"
    frames, motions, equipment = [], {}, []
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        tokens = archive.tokens(mob)
        start = next(i for i, t in enumerate(tokens) if t[1] == "[equipment]")
        end = next(i for i in range(start, len(tokens)) if tokens[i][1] == "[/equipment]")
        for kind, value in tokens[start + 1:end]:
            if kind == 7:
                path = "equipment/" + value.lower()
                equipment.append((path, archive.tokens(path)))
        mob_hash = hashlib.sha256(archive.read(mob)).hexdigest()
        throw_frame = next(tokens[i + 1][1] for i, t in enumerate(tokens) if t[1] == "[throw frame]")
        idle_path = next(motion_links(tokens, mob, "waiting"))[1]
        idle = parse_animation(archive.read(idle_path), True)
        first = idle["frames"][0]
        body, offset, _ = picture(idle["paths"][first["image"]], first["frame"])
        bbox = body.getbbox()
        native_ground = [offset[0] + first["xy"][0] + (bbox[0] + bbox[2]) / 2,
                         offset[1] + first["xy"][1] + bbox[3]]
        shift = [round(180 - native_ground[0]), round(260 - native_ground[1])]
        anchor = [native_ground[i] + shift[i] for i in range(2)]
        for pose, tag in POSES:
            links = [(layer, path, mob) for layer, path in motion_links(tokens, mob, tag)]
            for path, equ_tokens in equipment:
                links.extend((layer, ani, path) for layer, ani in motion_links(equ_tokens, path, tag))
            layers = []
            for layer, path, owner in sorted(links, key=lambda link: link[0]):
                raw = archive.read(path)
                ani = parse_animation(raw, True)
                assert all(k == 0 and v == 1 for k, v in ani["overall"]), path
                times = [next(v for k, v in f["props"] if k == 12) for f in ani["frames"]]
                assert all(all(k == 12 for k, _ in f["props"]) for f in ani["frames"]), path
                layers.append((layer, path, owner, hashlib.sha256(raw).hexdigest(), ani, times))
            body_layer = next(record for record in layers if record[2] == mob)
            assert all(record[5] == body_layer[5] for record in layers), (pose, "layer timing mismatch")
            first_cell = len(frames)
            for ordinal in range(len(body_layer[4]["frames"])):
                cell = Image.new("RGBA", (360, 420))
                parts = []
                for layer, path, owner, sha, ani, _ in layers:
                    f = ani["frames"][ordinal]
                    pic, offset, source = picture(ani["paths"][f["image"]], f["frame"])
                    xy = [shift[i] + offset[i] + f["xy"][i] for i in range(2)]
                    box = pic.getbbox()
                    if box:
                        assert xy[0] + box[0] >= 0 and xy[1] + box[1] >= 0
                        assert xy[0] + box[2] <= 360 and xy[1] + box[3] <= 420
                    cell.alpha_composite(pic, tuple(xy))
                    parts.append({"layer": layer, "owner": owner, "ani": path, "aniSHA256": sha,
                                  **source, "offset": list(offset), "aniXY": f["xy"], "pasteXY": xy})
                frames.append((cell, {"cell": len(frames), "pose": pose, "ordinal": ordinal,
                                     "bbox": list(cell.getbbox()), "layers": parts,
                                     "rgbaSHA256": hashlib.sha256(cell.tobytes()).hexdigest()}))
            motions[pose] = {"range": [first_cell, len(frames) - 1], "milliseconds": body_layer[5],
                             "bodyFrames": [f["frame"] for f in body_layer[4]["frames"]]}
    sheet = Image.new("RGBA", (360 * len(frames), 420))
    for index, (cell, _) in enumerate(frames):
        sheet.alpha_composite(cell, (index * 360, 0))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    stand_box = frames[0][0].getbbox()
    report = {"mob": mob, "mobSHA256": mob_hash, "sheet": list(sheet.size), "cell": [360, 420],
              "anchor": anchor, "nativeGround": native_ground, "sharedTranslation": shift,
              "standHeight": stand_box[3] - stand_box[1], "throwFrameField": throw_frame,
              "equipment": [path for path, _ in equipment], "motions": motions,
              "frames": [record for _, record in frames],
              "transparency": "Existing monster importer black key, RGB all below26.",
              "limits": ["All declared EQU layer blocks are composited in ascending layer order; ties retain equipment order.",
                         "Native throw-frame field2 is source data, not a video absolute-timing measurement.",
                         "Attack duration, AI, world size and champion aura are not calibrated by this import."]}
    args.out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "anchor": anchor, "stand": report["standHeight"],
                      "motions": motions}, ensure_ascii=False))


if __name__ == "__main__":
    main()
