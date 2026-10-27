#!/usr/bin/env python3
"""Deep-forest colour grade on the client's set 02 atlas.

The recording is more saturated and has more contrast than the raw client art;
this keeps the same pixels and writes a second sheet used only by 幽暗密林深处.
"""
import pathlib
from PIL import Image, ImageEnhance

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = Image.open(ROOT / "assets" / "forest.png").convert("RGBA")
alpha = src.getchannel("A")
rgb = src.convert("RGB")
rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
rgb = ImageEnhance.Contrast(rgb).enhance(1.12)
rgb = ImageEnhance.Color(rgb).enhance(1.18)
out = Image.merge("RGBA", (*rgb.split(), alpha))
out.save(ROOT / "assets" / "forest-deep.png")
print("forest-deep", out.size)
