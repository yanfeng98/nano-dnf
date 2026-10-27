#!/usr/bin/env python3
"""Bake the goblin hut used in 幽暗密林深处 (rooms 33 / boss).

The client's `sprite_map_goblinkingdom.NPK :: house.img` is a small thatched
tribal hut - the closest client piece to the recording's hut. It is kept as its
own tiny sheet so the forest atlas and every generated rect stay untouched.
"""
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = pathlib.Path("/home/luyanfeng/dnf-client/地下城与勇士")
pic, offset = decode_at(CLIENT, "sprite_map_goblinkingdom.NPK",
                        "sprite/map/goblinkingdom/house.img", 0)
pic.save(ROOT / "assets" / "hut.png")
print("hut", pic.size, "offset", offset, "->", ROOT / "assets/hut.png")
