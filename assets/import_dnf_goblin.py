#!/usr/bin/env python3
"""Bake the club-wielding ordinary goblin linked by goblin.mob.

Keeps the existing monster atlas intact. Native ANI paths/frame identities are
recorded, but the game's attack duration/AI are not asserted to match the video.
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK
from import_dnf_monsters import ground_of, key_black, offset_of

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from client_animation import parse_animation
from client_pvf import PvfArchive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, default=ROOT / "assets/goblin-reference.png")
    args = parser.parse_args()
    pack = args.client / "ImagePacks2/sprite_monster_goblin_event.NPK"
    entry = "sprite/monster/goblin/event/goblin.img"
    with pack.open("rb") as handle:
        item = next(item for item in NPK.open(handle).files
                    if item.name.replace("\\", "/").lower() == entry)
        source = item.data
    obj = IMGFactory.open(io.BytesIO(source))
    frames, proof = [], []
    for index, frame in enumerate(obj.images):
        while type(frame).__name__ == "ImageLink":
            frame = obj.images[frame.index]
        raw = obj.build(frame).convert("RGBA")
        picture = key_black(raw.copy())
        x, y = offset_of(frame)
        frames.append((picture, x, y))
        proof.append({"frame": index, "nativeXY": [x, y],
                      "sourceSize": list(raw.size),
                      "rawRGBAsha256": hashlib.sha256(raw.tobytes()).hexdigest(),
                      "keyedRGBAsha256": hashlib.sha256(picture.tobytes()).hexdigest()})
    motions = {}
    with PvfArchive(args.client / "Script_70.pvf") as pvf:
        tokens = pvf.tokens("monster/goblin/goblin.mob")
        for pose, tag in [("idle", "waiting"), ("walk", "move"),
                          ("attack", "attack"), ("down", "down"), ("rise", "sit")]:
            start = next(i for i, token in enumerate(tokens) if token[1] == f"[{tag} motion]")
            path = "monster/goblin/" + tokens[start + 1][1].lower()
            ani = parse_animation(pvf.read(path), include_image=True)
            assert all(ani["paths"][frame["image"]].lower() == "monster/goblin/event/goblin.img"
                       and frame["xy"] == [-91, -152] for frame in ani["frames"])
            motions[pose] = {"path": path, "sha256": hashlib.sha256(pvf.read(path)).hexdigest(),
                             "frames": [frame["frame"] for frame in ani["frames"]],
                             "milliseconds": [next(value for kind, value in frame["props"] if kind == 12)
                                              for frame in ani["frames"]]}
    foot = ground_of(frames)
    cw, ch, ax, ay = 360, 420, 180, 260
    sheet = Image.new("RGBA", (cw * len(frames), ch))
    for index, (picture, x, y) in enumerate(frames):
        paste = (round(ax + x - foot[0]), round(ay + y - foot[1]))
        bbox = picture.getbbox()
        assert bbox and paste[0] + bbox[0] >= 0 and paste[1] + bbox[1] >= 0
        assert paste[0] + bbox[2] <= cw and paste[1] + bbox[3] <= ch
        cell = Image.new("RGBA", (cw, ch))
        cell.alpha_composite(picture, paste)
        sheet.alpha_composite(cell, (index * cw, 0))
        proof[index].update(pasteXY=list(paste), bbox=list(cell.getbbox()),
                            cellRGBAsha256=hashlib.sha256(cell.tobytes()).hexdigest())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    report = {"mob": "monster/goblin/goblin.mob", "pack": str(pack), "entry": entry,
              "imgSHA256": hashlib.sha256(source).hexdigest(), "sheet": list(sheet.size),
              "cell": [cw, ch], "anchor": [ax, ay], "nativeGround": list(foot),
              "standHeight": frames[0][0].getbbox()[3] - frames[0][0].getbbox()[1],
              "transparency": "existing monster importer: RGB components all below26 keyed transparent",
              "motions": motions, "frames": proof,
              "limits": ["Foot is normalized using the existing standing-frame convention.",
                         "Native frame identities do not establish video attack timing, AI or scale."]}
    args.out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "frames": len(frames), "stand": report["standHeight"],
                      "motions": motions}, ensure_ascii=False))


if __name__ == "__main__":
    main()
