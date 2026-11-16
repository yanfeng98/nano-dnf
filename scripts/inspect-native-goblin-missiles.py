#!/usr/bin/env python3
"""Export native goblin missile references and untransformed image evidence.

The named particle candidates are not asserted to be engine-linked children.
No ANI scale, rotation, interpolation, blend or property inheritance is applied.
"""
import argparse
import hashlib
import io
import json
import posixpath
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK
from client_animation import parse_animation
from client_pvf import PvfArchive

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "assets"))
from import_dnf_monsters import offset_of


def sha(data):
    return hashlib.sha256(data).hexdigest()


def resolve(source, target):
    target = target.replace("\\", "/").lower()
    if target.startswith(("passiveobject/", "monster/")):
        return target
    return posixpath.normpath(posixpath.join(posixpath.dirname(source), target))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, required=True, help="Output filename prefix")
    args = parser.parse_args()
    report = {"archive": str(args.client / "Script_70.pvf"), "actors": {},
              "files": {}, "explicitReferences": [], "candidateSeeds": []}
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        listing = archive.tokens("passiveobject/passiveobject.lst")
        report["objectListSHA256"] = sha(archive.read("passiveobject/passiveobject.lst"))
        queue = []
        for kind, name, expected in [("goblinRed", "hillgab", 30047),
                                     ("goblinBlue", "seagab", 30057)]:
            mob = f"monster/goblin/{name}.mob"
            tokens = archive.tokens(mob)
            index = next(tokens[i + 1][1] for i, t in enumerate(tokens)
                         if t[1] == "[passive object index]")
            assert index == expected
            obj = "passiveobject/" + next(listing[i + 1][1].lower()
                                         for i, t in enumerate(listing) if t[1] == index)
            report["actors"][kind] = {"mob": mob, "objectId": index, "object": obj}
            queue.extend([mob, obj])
        # These names were located by archive inspection, not by an explicit
        # reference in the two primary missile objects. Preserve that boundary.
        for name in ["firemissileparticle", "firemissileparticlelight",
                     "icemissileparticletail", "icemissileparticlelight"]:
            path = f"passiveobject/common/particle/{name}.ptl"
            report["candidateSeeds"].append(path)
            queue.append(path)
        while queue:
            path = queue.pop(0)
            if path in report["files"]:
                continue
            raw = archive.read(path)
            record = {"sha256": sha(raw)}
            report["files"][path] = record
            if path.endswith(".ani"):
                record["animation"] = parse_animation(raw, include_image=True)
                continue
            tokens = archive.tokens(path)
            record["tokens"] = tokens
            # Follow only projectile-related file references. MOB body motions
            # are independently audited and would obscure this object graph.
            for i, (_, value) in enumerate(tokens):
                if not isinstance(value, str) or not value.lower().endswith((".ani", ".ptl", ".atk")):
                    continue
                if path.endswith(".mob") and not value.lower().endswith(".ptl"):
                    continue
                target = resolve(path, value)
                assert target in archive.entries, (path, value, target)
                report["explicitReferences"].append({"source": path, "tokenIndex": i,
                                                       "literal": value, "target": target})
                queue.append(target)

    pack = args.client / "ImagePacks2/sprite_common_commoneffect.NPK"
    with pack.open("rb") as handle:
        entries = {item.name.lower(): item.data for item in NPK.open(handle).files}
    images = {}
    pictures = []
    for path, record in report["files"].items():
        if "animation" not in record:
            continue
        ani = record["animation"]
        for sequence, frame in enumerate(ani["frames"]):
            if frame["image"] == -1:
                continue
            entry = "sprite/" + ani["paths"][frame["image"]].lower()
            if entry not in images:
                images[entry] = IMGFactory.open(io.BytesIO(entries[entry]))
            img = images[entry]
            native = img.images[frame["frame"]]
            picture = img.build(native).convert("RGBA")
            assert picture.width <= 112 and picture.height <= 100, (entry, picture.size)
            tile = len(pictures)
            pictures.append((picture, f"{tile}: {posixpath.basename(path)}", f"seq{sequence} img{frame['frame']}"))
            frame["bitmapEvidence"] = {"entry": entry, "imgSHA256": sha(entries[entry]),
                                       "size": list(picture.size), "offset": list(offset_of(native)),
                                       "rgbaSHA256": sha(picture.tobytes()), "tile": tile}
    columns, cell_w, cell_h = 8, 160, 144
    rows = (len(pictures) + columns - 1) // columns
    raw_atlas = Image.new("RGBA", (columns * cell_w, rows * cell_h))
    contact = Image.new("RGB", raw_atlas.size, (35, 35, 35))
    draw = ImageDraw.Draw(contact)
    for tile, (picture, label, detail) in enumerate(pictures):
        x, y = tile % columns * cell_w, tile // columns * cell_h
        paste = (x + (cell_w - picture.width) // 2, y + 10)
        raw_atlas.alpha_composite(picture, paste)
        contact.paste(picture, paste, picture)
        draw.text((x + 3, y + 114), label.replace("missile", "m.")[:25], fill="white")
        draw.text((x + 3, y + 128), detail, fill="white")
        # This is a raw-image review layout, never a runtime animation pivot.
        report.setdefault("tiles", []).append({"tile": tile, "pasteXY": list(paste)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    raw_atlas.save(str(args.out) + "-raw.png")
    contact.save(str(args.out) + "-contact.png")
    report.update(pack=str(pack), bitmapInstances=len(pictures),
                  rawAtlasRGBAsha256=sha(raw_atlas.tobytes()),
                  limits=["Contact layout applies no native ANI transforms or timing.",
                          "Original RGBA preserved; no colour key, recolouring or generated imagery.",
                          "Candidate seeds are not proved children of the primary missile objects.",
                          "Token values are raw reader output, including unsigned storage of signed values.",
                          "Engine scheduling, axes, blend and inheritance require separate evidence."])
    Path(str(args.out) + ".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"files": len(report["files"]), "bitmapInstances": len(pictures),
                      "explicitReferences": len(report["explicitReferences"]), "out": str(args.out)}))


if __name__ == "__main__":
    main()
