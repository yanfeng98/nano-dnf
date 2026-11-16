#!/usr/bin/env python3
"""Read MOB -> ANI frame identities for the verified basic goblin bodies.

This is source evidence, not a video timing calibration. Caster equipment and
the legacy whiteboss body require separate inspections.
"""
import argparse
import hashlib
import json
import posixpath
import sys
from pathlib import Path
from PIL import Image
from client_animation import parse_animation
from client_pvf import PvfArchive

MOBS = {"grunt": "goblin", "coward": "cowardgoblin",
        "goblinBlue": "seagab", "goblinRed": "hillgab"}
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "assets"))
from import_dnf_monsters import decode, ground_of


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path("/mnt/c/dnf/地下城与勇士"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    records = {}
    with PvfArchive(args.client / "Script_70.pvf") as archive:
        for kind, name in MOBS.items():
            mob = f"monster/goblin/{name}.mob"
            tokens = archive.tokens(mob)
            motions = {}
            for pose, tag in [("idle", "waiting"), ("walk", "move"), ("attack", "attack"),
                              ("down", "down"), ("sit", "sit")]:
                start = next(i for i, token in enumerate(tokens) if token[1] == f"[{tag} motion]")
                ani = posixpath.normpath(posixpath.join(posixpath.dirname(mob), tokens[start + 1][1].lower()))
                raw = archive.read(ani)
                data = parse_animation(raw, include_image=True)
                motions[pose] = {"ani": ani, "sha256": hashlib.sha256(raw).hexdigest(),
                                 "paths": data["paths"],
                                 "frames": [frame["frame"] for frame in data["frames"]],
                                 "milliseconds": [next(v for k, v in frame["props"] if k == 12)
                                                  for frame in data["frames"]]}
            records[kind] = {"mob": mob, "mobSHA256": hashlib.sha256(archive.read(mob)).hexdigest(),
                             "motions": motions}
    # Independently compare the already-shipped rows with the client bitmaps.
    # No atlas mutation: preserve source pixels, existing black key and ground convention.
    atlas = Image.open(ROOT / "assets/monsters.png").convert("RGBA")
    cells = {}
    for kind, row, pack, entry in [
            ("coward", 1, "sprite_monster_goblin_event.NPK", "goblin/event/cowardgoblin.img"),
            ("goblinBlue", 6, "sprite_monster_goblin.NPK", "goblin/body7.img"),
            ("goblinRed", 7, "sprite_monster_goblin.NPK", "goblin/body8.img")]:
        frames = decode(args.client, pack, entry)
        foot = ground_of(frames)
        hashes = []
        for index, (picture, x, y) in enumerate(frames):
            cell = Image.new("RGBA", (360, 420))
            cell.alpha_composite(picture, (round(180 + x - foot[0]), round(260 + y - foot[1])))
            existing = atlas.crop((index * 360, row * 420, (index + 1) * 360, (row + 1) * 420))
            source_hash = hashlib.sha256(cell.tobytes()).hexdigest()
            existing_hash = hashlib.sha256(existing.tobytes()).hexdigest()
            assert source_hash == existing_hash, (kind, index, "shipped atlas differs from native cell")
            hashes.append(source_hash)
        cells[kind] = {"row": row, "pack": pack, "entry": entry, "cell": [360, 420],
                       "anchor": [180, 260], "frameRGBAsha256": hashes}
    report = {"archive": str(args.client / "Script_70.pvf"), "types": records,
              "existingAtlasCells": cells,
              "championAlias": {"cursedRed": "goblinRed"},
              "aliasBasis": "Existing Core champion/body definition and ADR0046; not a new MOB identity claim.",
              "limits": ["Native durations do not establish video/server animation speed.",
                         "Attack hit timing, HP and AI are outside this frame-identity inspection.",
                         "Caster equipment, burningThrower and legacy whiteboss are not covered."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({kind: {pose: value["frames"] for pose, value in row["motions"].items()}
                      for kind, row in records.items()}))


if __name__ == "__main__":
    main()
