#!/usr/bin/env python3
"""Bake the pale stone pillar used in 幽暗密林深处.

The recording's pillars are pale green-gray.  Set 02's `02obj006` has the same
silhouette but is tinted dark blue; set 01's `01obj006` is the pale variant of
the same object.  Use that one directly - no runtime filter, no hand tint.
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from import_dnf_scene import decode_at

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = pathlib.Path("/home/luyanfeng/dnf-client/地下城与勇士")
pic, offset = decode_at(CLIENT, "sprite_map.NPK", "sprite/map/01obj006.img", 0)
pic.save(ROOT / "assets" / "pillar-pale.png")
print("pillarPale", pic.size, "offset", offset, "->", ROOT / "assets/pillar-pale.png")
