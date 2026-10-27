#!/usr/bin/env python3
"""Bake the block-stone gate + iron bars used in 幽暗密林深处.

2026-10-25: the recording's gate is `granflorisupgate02` + `granflorisupdoor02`
(the stone-block arch and its barred leaf), not the ornate `sidegate02` family.
Both frames share the same 165x213 canvas; bake them side by side with their
own ink crops and keep the rect table in render.js.

2026-10-26: also bake `granflorisuplight01/02` - the glowing rune overlay the
client lays **on top of the same arch** once the room is cleared.  The recording
shows it at 147s (blue) on the open door; without it a cleared gate reads as a
bare arch with a hole in it.
"""
import pathlib, sys
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = pathlib.Path("/home/luyanfeng/dnf-client/地下城与勇士")
PACK = "sprite_map_pathgate.NPK"
gate, goff = decode_at(CLIENT, PACK, "sprite/map/pathgate/granflorisupgate02.img", 0)
door, doff = decode_at(CLIENT, PACK, "sprite/map/pathgate/granflorisupdoor02.img", 0)
light1, l1off = decode_at(CLIENT, PACK, "sprite/map/pathgate/granflorisuplight01.img", 0)
light2, l2off = decode_at(CLIENT, PACK, "sprite/map/pathgate/granflorisuplight02.img", 0)
width = gate.width + door.width + light1.width + light2.width
height = max(gate.height, door.height, light1.height, light2.height)
sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
sheet.alpha_composite(gate, (0, 0))
sheet.alpha_composite(door, (gate.width, 0))
sheet.alpha_composite(light1, (gate.width + door.width, 0))
sheet.alpha_composite(light2, (gate.width + door.width + light1.width, 0))
sheet.save(ROOT / "assets" / "gate-block.png")
print("gate", gate.size, goff, "door", door.size, doff,
      "light1", light1.size, l1off, "light2", light2.size, l2off,
      "->", sheet.size)
