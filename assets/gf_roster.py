#!/usr/bin/env python3
"""Dump the exact numbers for every Gran Floris asset we plan to use.

Writes a TSV: pack, entry, frames, canvas_w, canvas_h, anchor_x, anchor_y, inked_w, inked_h.
`canvas` is the .img's own frame canvas; `inked` is the bounding box of the
union of all frames (what the art actually draws). They differ a lot - some
monsters carry an anchor far outside the canvas - so the import pipeline needs
both.

**Hold the NPK handle open while reading entries.** pydnfex reads entry data
lazily off the file handle; closing it first raises "seek of closed file".

    python3 assets/gf_roster.py > assets/dnf_src/granfloris-probe/roster.tsv
"""

from __future__ import annotations

import io
import pathlib
import sys

from pydnfex.img.version import IMGFactory
from pydnfex.npk import NPK

CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士/ImagePacks2")

# pack -> entries to report. "" means every entry in the pack.
ROSTER = {
    "sprite_monster_goblin.NPK": [
        "body0", "body1", "body2", "body3", "body4", "body5", "body6", "body7",
        "body8", "body9", "whiteboss", "archer_gonlin", "rtrowgoblin",
        "goblinunderminer", "gligeat", "goblincannon",
    ],
    "sprite_monster_goblin_event.NPK": ["cowardgoblin", "kinol", "goblintaskmaster", "richgoblin"],
    "sprite_monster_trowgoblin.NPK": ["rthrowgoblin", "fthrowgoblin"],
    "sprite_monster_goblin_golgo.NPK": ["golgo", "golgo2", "wagon_front", "wagon_back"],
    "sprite_monster_goblin_equipment.NPK": [],
    "sprite_monster_goblin_effect.NPK": [],
    "sprite_monster_tau.NPK": [
        "body01", "body02", "body03", "body04", "body05", "body06", "body07",
        "event_cow", "shield", "metacowpiece", "firebreath",
    ],
    "sprite_monster_tau_equipment.NPK": [],
    "sprite_monster_lugaru.NPK": [
        "lugaru", "whitelugaru", "blacklugaru", "bloodlugaru", "penril",
        "ciel", "akaru", "heart", "ciel_tail", "enchant", "casting",
    ],
    "sprite_monster_lugaru_equipment.NPK": [],
    "sprite_monster_zombie.NPK": ["zombie", "holloweye", "ghoulgwish", "nicolzombie"],
    "sprite_monster_ghoul.NPK": [],
    "sprite_monster_soceress.NPK": [],
    "sprite_monster_icetiger.NPK": [],
    "sprite_monster_dendroid.NPK": [],
    "sprite_monster_monsterflower.NPK": [],
    "sprite_monster_darkelf.NPK": [],
    "sprite_monster_spider.NPK": [],
    "sprite_monster_dog.NPK": [],
    "sprite_monster_cyclops.NPK": [],
    "sprite_monster_advancealtar.NPK": [],
    "sprite_map.NPK": [],
    "sprite_map_pathgate.NPK": [],
    "sprite_map_breakableobject.NPK": [],
    "sprite_map_breakableobject_actiontreerenew.NPK": [],
    "sprite_map_title.NPK": [],
    "sprite_map_cutscene.NPK": [],
    "sprite_worldmap.NPK": [],
    "sprite_worldmap_selectdungeonslot.NPK": [],
    "sprite_map_trap_goblinbunker.NPK": [],
}

# Only these namespaces are worth listing whole; the rest of sprite_map.NPK is
# other regions' art and would drown the sheet.
KEEP_PREFIX = (
    "sprite/monster/lugaru", "sprite/monster/ghoul", "sprite/monster/soceress",
    "sprite/monster/icetiger", "sprite/monster/dendroid", "sprite/monster/monsterflower",
    "sprite/monster/darkelf", "sprite/monster/spider", "sprite/monster/dog",
    "sprite/monster/cyclops", "sprite/monster/advancealtar", "sprite/monster/trowgoblin",
    "sprite/monster/tau/equipment", "sprite/monster/goblin/equipment",
    "sprite/monster/goblin/effect", "sprite/monster/lugaru/equipment",
    "sprite/map/pathgate/granfloris", "sprite/map/breakableobject", "sprite/map/title",
    # The legacy numbered dungeon layers live at sprite/map/<set><layer>.img -
    # 00far1, 01mid1, 02obj401f, tile00 and friends. Five sets, 00 through 04.
    "sprite/map/0",
    "sprite/map/cutscene/granfloris", "sprite/worldmap/granfloris",
    "sprite/worldmap/selectdungeonslot/granfloris", "sprite/map/trap/goblinbunker",
)


def inked(img) -> tuple[int, int]:
    """Union bounding box over every frame that is not a 1x1 placeholder."""
    box = None
    for index in range(len(img.images)):
        try:
            picture = img.build(img.images[index]).convert("RGBA")
        except Exception:
            continue
        if picture.width <= 1 and picture.height <= 1:
            continue
        spot = picture.getbbox()
        if spot is None:
            continue
        box = spot if box is None else (
            min(box[0], spot[0]), min(box[1], spot[1]),
            max(box[2], spot[2]), max(box[3], spot[3]),
        )
    if box is None:
        return 0, 0
    return box[2] - box[0], box[3] - box[1]


def main() -> None:
    print("pack\tentry\tframes\tframe0_w\tframe0_h\tanchor_x\tanchor_y\tinked_w\tinked_h")
    for pack, wanted in ROSTER.items():
        path = CLIENT / pack
        if not path.exists():
            print(f"# MISSING {pack}", file=sys.stderr)
            continue
        handle = open(path, "rb")
        try:
            npk = NPK.open(handle)
            for entry in npk.files:
                short = entry.name.replace("\\", "/")
                base = short.rsplit("/", 1)[-1]
                stem = base[:-4] if base.endswith(".img") else base
                if wanted:
                    if stem not in wanted:
                        continue
                elif not short.startswith(KEEP_PREFIX):
                    continue
                try:
                    img = IMGFactory.open(io.BytesIO(entry.data))
                except Exception as error:
                    print(f"# UNREADABLE {pack}/{short}: {error}", file=sys.stderr)
                    continue
                first = img.images[0]
                iw, ih = inked(img)
                print("\t".join(str(x) for x in (
                    pack, short, len(img.images), first.w, first.h,
                    getattr(first, "x", 0), getattr(first, "y", 0), iw, ih,
                )))
        finally:
            handle.close()


if __name__ == "__main__":
    main()
