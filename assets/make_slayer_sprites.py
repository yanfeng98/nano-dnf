#!/usr/bin/env python3
"""Author the original Slayer sprite sheet and skill icons for nano-dnf.

Every pixel is drawn here from primitives (no third-party or game assets), so
the public repository stays free of copyrighted material. Run:

    python3 assets/make_slayer_sprites.py

Outputs: assets/slayer.png (6 x 5 grid of 96x96 frames) and assets/skills.png
(four 32x32 skill icons).

Note: a working copy may ship assets/slayer.png baked from a local DNF client
instead (see assets/import_dnf_swordman.py). Running this script writes the
licence-clean 6 x 5 grid of 96x96 frames, which is the pre-DNF-art layout: point
src/render.js SPRITE at (frameW 96, frameH 96, cols 6) if you swap it back in.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
FRAME = 96
COLS = 6
SUPERSAMPLE = 4

OUTLINE = (12, 14, 24, 255)
HAIR = (20, 24, 38, 255)
HAIR_HI = (58, 74, 108, 255)
SKIN = (238, 190, 152, 255)
SKIN_SHADOW = (198, 142, 108, 255)
COAT = (30, 38, 66, 255)
COAT_LIGHT = (52, 64, 100, 255)
COAT_DARK = (18, 22, 40, 255)
TRIM = (188, 42, 62, 255)
GOLD = (222, 182, 96, 255)
PANTS = (42, 48, 74, 255)
BOOT = (24, 28, 42, 255)
BLADE = (214, 224, 240, 255)
EDGE = (150, 166, 192, 255)
HILT = (62, 42, 30, 255)
CLOAK = (118, 24, 40, 255)
CLOAK_HI = (162, 44, 62, 255)
GHOST = (172, 132, 255, 255)


def s(value: float) -> float:
    return value * SUPERSAMPLE


def at(origin, angle_deg: float, length: float):
    angle = math.radians(angle_deg)
    return (origin[0] + math.cos(angle) * length, origin[1] + math.sin(angle) * length)


class Brush:
    """Tiny drawing helper that can fatten everything for an outline pass."""

    def __init__(self, draw: ImageDraw.ImageDraw, color=None, grow: float = 0.0) -> None:
        self.draw = draw
        self.color = color
        self.grow = grow

    def paint(self, color):
        return self.color or color

    def limb(self, start, end, width: float, color) -> None:
        wide = int(s(width + self.grow * 2))
        self.draw.line([s(start[0]), s(start[1]), s(end[0]), s(end[1])], fill=self.paint(color), width=wide)
        radius = s(width + self.grow) / 2
        for cx, cy in (start, end):
            self.draw.ellipse(
                [s(cx) - radius, s(cy) - radius, s(cx) + radius, s(cy) + radius],
                fill=self.paint(color),
            )

    def poly(self, points, color) -> None:
        if self.grow:
            center = (
                sum(p[0] for p in points) / len(points),
                sum(p[1] for p in points) / len(points),
            )
            grown = []
            for px, py in points:
                dx, dy = px - center[0], py - center[1]
                length = math.hypot(dx, dy) or 1.0
                grown.append((px + dx / length * self.grow, py + dy / length * self.grow))
            points = grown
        self.draw.polygon([s(v) for pair in points for v in pair], fill=self.paint(color))

    def ellipse(self, cx, cy, rx, ry, color) -> None:
        self.draw.ellipse(
            [s(cx - rx - self.grow), s(cy - ry - self.grow), s(cx + rx + self.grow), s(cy + ry + self.grow)],
            fill=self.paint(color),
        )


def draw_sword(brush: Brush, hand, angle_deg: float, length: float) -> None:
    tip = at(hand, angle_deg, length)
    guard_a = at(hand, angle_deg + 90, 6)
    guard_b = at(hand, angle_deg - 90, 6)
    brush.limb(guard_a, guard_b, 2.4, GOLD)
    brush.limb(at(hand, angle_deg + 180, 7), hand, 3.0, HILT)
    brush.limb(hand, tip, 3.4, BLADE)
    brush.limb(at(hand, angle_deg, length * 0.25), tip, 1.3, EDGE)


def draw_body(pose: dict, brush: Brush) -> None:
    lean = pose.get("lean", 0.0)
    crouch = pose.get("crouch", 0.0)
    hip = (45 + lean, 57 + crouch)
    chest = (45 + lean * 1.2, 38 + crouch * 0.6)
    head = (45 + lean * 1.6, 24 + crouch * 0.8)

    cloak = pose.get("cloak", 0.0)
    swing = pose.get("cloak_swing", 0.0)
    brush.poly(
        [
            (chest[0] - 9, chest[1] - 3),
            (chest[0] + 8, chest[1] - 1),
            (hip[0] - 6 + swing, hip[1] + 20),
            (hip[0] - 26 - cloak + swing, hip[1] + 26),
            (hip[0] - 20 - cloak, hip[1] - 6),
        ],
        CLOAK,
    )
    brush.poly(
        [
            (chest[0] - 8, chest[1] - 2),
            (chest[0] - 2, chest[1] - 1),
            (hip[0] - 14 - cloak * 0.5, hip[1] + 18),
            (hip[0] - 22 - cloak, hip[1] + 20),
        ],
        CLOAK_HI,
    )

    leg_phase = pose.get("legs", 0.0)
    for sign in (-1, 1):
        knee = at(hip, 90 + leg_phase * 24 * sign, 15)
        ankle = at(knee, 90 + leg_phase * 14 * sign - 8, 14)
        brush.limb(hip, knee, 6.4, PANTS)
        brush.limb(knee, ankle, 5.2, PANTS if sign < 0 else BOOT)
        brush.limb(ankle, (ankle[0] + 7 * sign, ankle[1] + 1), 4.4, BOOT)

    brush.poly(
        [
            (chest[0] - 10, chest[1] - 4),
            (chest[0] + 10, chest[1] - 4),
            (hip[0] + 7, hip[1] + 3),
            (hip[0] - 7, hip[1] + 3),
        ],
        COAT,
    )
    brush.poly(
        [
            (chest[0] - 10, chest[1] - 4),
            (chest[0] - 2, chest[1] - 4),
            (hip[0] - 1, hip[1] + 3),
            (hip[0] - 7, hip[1] + 3),
        ],
        COAT_LIGHT,
    )
    brush.poly(
        [
            (chest[0] - 8, chest[1] - 4),
            (chest[0], chest[1] + 3),
            (chest[0] + 8, chest[1] - 4),
        ],
        TRIM,
    )
    brush.limb((hip[0] - 8, hip[1] - 1), (hip[0] + 8, hip[1]), 2.6, GOLD)

    for sign in (-1, 1):
        brush.ellipse(chest[0] + sign * 10, chest[1] - 4, 5.2, 3.6, COAT_DARK)
        brush.ellipse(chest[0] + sign * 10, chest[1] - 5, 3.0, 1.6, GOLD)

    back_arm = pose.get("back_arm", 34)
    back_elbow = at(chest, 90 + back_arm, 11)
    back_hand = at(back_elbow, 90 + back_arm + 22, 10)
    brush.limb(chest, back_elbow, 5.4, COAT_DARK)
    brush.limb(back_elbow, back_hand, 4.4, SKIN_SHADOW)

    front_arm = pose.get("front_arm", -30)
    front_elbow = at(chest, 90 + front_arm, 11)
    front_hand = at(front_elbow, 90 + front_arm + 20, 10)
    brush.limb(chest, front_elbow, 5.6, COAT)
    brush.limb(front_elbow, front_hand, 4.6, SKIN)
    draw_sword(brush, front_hand, pose.get("sword", 46), pose.get("sword_length", 42))

    brush.ellipse(head[0], head[1], 7.2, 8.0, SKIN)
    brush.poly(
        [
            (head[0] - 8, head[1] - 1),
            (head[0] - 7, head[1] - 8),
            (head[0] + 3, head[1] - 11),
            (head[0] + 8, head[1] - 6),
            (head[0] + 6, head[1] - 1),
        ],
        HAIR,
    )
    brush.poly(
        [
            (head[0] - 8, head[1] - 1),
            (head[0] - 14, head[1] + 6),
            (head[0] - 10, head[1] - 6),
        ],
        HAIR,
    )
    brush.poly(
        [
            (head[0] + 1, head[1] - 10),
            (head[0] + 8, head[1] - 6),
            (head[0] + 3, head[1] - 4),
        ],
        HAIR_HI,
    )
    brush.ellipse(head[0] + 3, head[1] + 1, 2.0, 1.4, (244, 248, 255, 255))
    brush.ellipse(head[0] + 3.6, head[1] + 1.2, 1.0, 1.0, (60, 136, 226, 255))
    brush.limb((head[0] - 1, head[1] - 3), (head[0] + 6, head[1] - 2), 1.0, HAIR)


def draw_slayer(pose: dict) -> Image.Image:
    size = int(s(FRAME))
    outline = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_body(pose, Brush(ImageDraw.Draw(outline), color=OUTLINE, grow=1.5))
    fill = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_body(pose, Brush(ImageDraw.Draw(fill)))
    image = Image.alpha_composite(outline, fill)

    if pose.get("ghost"):
        aura = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(aura).ellipse(
            [s(16), s(10), s(80), s(90)], outline=GHOST, width=int(s(2.6))
        )
        image = Image.alpha_composite(image, aura.filter(ImageFilter.GaussianBlur(s(1.4))))

    if pose.get("slash"):
        arc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset = pose.get("slash_offset", 0)
        ImageDraw.Draw(arc).arc(
            [s(14), s(6 + offset), s(94), s(74 + offset)],
            start=-72,
            end=68,
            fill=(228, 246, 255, 210),
            width=int(s(3.2)),
        )
        image = Image.alpha_composite(image, arc)

    return image.resize((FRAME, FRAME), Image.LANCZOS)


POSES = {
    "idle": [
        {"legs": 0.0, "front_arm": -34, "back_arm": 30, "sword": 52},
        {"legs": 0.02, "front_arm": -32, "back_arm": 28, "sword": 50, "crouch": 0.5},
        {"legs": 0.0, "front_arm": -34, "back_arm": 30, "sword": 52, "crouch": 0.7},
        {"legs": -0.02, "front_arm": -36, "back_arm": 32, "sword": 54, "crouch": 0.2},
    ],
    "run": [
        {"legs": 0.9, "lean": 3, "front_arm": -46, "back_arm": 58, "sword": 78, "cloak": 6, "cloak_swing": -4},
        {"legs": 0.25, "lean": 3, "front_arm": -38, "back_arm": 44, "sword": 70, "cloak": 4},
        {"legs": -0.85, "lean": 3, "front_arm": -26, "back_arm": 30, "sword": 62, "cloak": 8, "cloak_swing": -6},
        {"legs": -0.2, "lean": 3, "front_arm": -42, "back_arm": 50, "sword": 72, "cloak": 3},
        {"legs": 0.7, "lean": 4, "front_arm": -50, "back_arm": 62, "sword": 80, "cloak": 7},
        {"legs": 0.15, "lean": 3, "front_arm": -40, "back_arm": 46, "sword": 68, "cloak": 5},
    ],
    "attack": [
        {"legs": 0.2, "lean": -3, "front_arm": -78, "back_arm": 18, "sword": -34, "crouch": 2},
        {"legs": 0.35, "lean": 5, "front_arm": 26, "back_arm": -8, "sword": 26, "slash": True},
        {"legs": 0.1, "lean": 2, "front_arm": 6, "back_arm": 12, "sword": 62, "cloak": 4},
    ],
    "skill": [
        {"legs": 0.0, "lean": -4, "front_arm": -86, "back_arm": 38, "sword": -78, "crouch": 3, "ghost": True},
        {"legs": 0.0, "lean": 6, "front_arm": 18, "back_arm": -18, "sword": 16, "slash": True, "ghost": True},
        {"legs": 0.0, "lean": 4, "front_arm": 36, "back_arm": -26, "sword": 54, "slash": True, "slash_offset": 8, "ghost": True},
        {"legs": 0.0, "lean": 1, "front_arm": 0, "back_arm": 14, "sword": 64, "cloak": 4},
    ],
    "extras": [
        {"legs": -0.3, "lean": -5, "front_arm": -12, "back_arm": 66, "sword": 92, "crouch": 4},
        {"legs": 0.7, "lean": 0, "front_arm": -58, "back_arm": 76, "sword": 150, "cloak": 10},
        {"legs": 0.4, "lean": 2, "front_arm": -48, "back_arm": 52, "sword": 104, "cloak": 6},
        {"legs": 0.1, "lean": 1, "front_arm": -34, "back_arm": 34, "sword": 74, "cloak": 3},
    ],
}

ROW_NAMES = ["idle", "run", "attack", "skill", "extras"]


def build_sheet() -> None:
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * len(ROW_NAMES)), (0, 0, 0, 0))
    for row, name in enumerate(ROW_NAMES):
        poses = POSES[name]
        for col in range(COLS):
            sheet.alpha_composite(draw_slayer(poses[col % len(poses)]), (col * FRAME, row * FRAME))
    sheet.save(ROOT / "slayer.png")
    print(f"wrote {ROOT / 'slayer.png'} ({sheet.width}x{sheet.height})")


def build_icons() -> None:
    icons = Image.new("RGBA", (32 * 4, 32), (0, 0, 0, 0))
    for index, name in enumerate(("up", "mountain", "cross", "ghost")):
        icon = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        draw = ImageDraw.Draw(icon)
        draw.rounded_rectangle(
            [2, 2, 126, 126],
            radius=20,
            fill=(24, 30, 50, 255),
            outline=(132, 172, 232, 255),
            width=4,
        )
        if name == "up":
            draw.line([(64, 106), (64, 36)], fill=BLADE, width=11)
            draw.polygon([(64, 14), (48, 44), (80, 44)], fill=BLADE)
            draw.arc([18, 34, 120, 132], start=-142, end=-38, fill=(150, 224, 255, 255), width=7)
        elif name == "mountain":
            draw.line([(32, 106), (80, 30)], fill=BLADE, width=11)
            draw.line([(18, 110), (110, 110)], fill=(255, 172, 92, 255), width=8)
            draw.line([(50, 122), (76, 94), (98, 122)], fill=(255, 216, 142, 255), width=6)
        elif name == "cross":
            draw.line([(28, 28), (100, 100)], fill=BLADE, width=11)
            draw.line([(100, 28), (28, 100)], fill=(255, 158, 158, 255), width=11)
        else:
            draw.line([(88, 20), (38, 106)], fill=(200, 174, 255, 255), width=11)
            draw.ellipse([14, 38, 62, 90], outline=GHOST, width=8)
        icons.alpha_composite(icon.resize((32, 32), Image.LANCZOS), (index * 32, 0))
    icons.save(ROOT / "skills.png")
    print(f"wrote {ROOT / 'skills.png'} ({icons.width}x{icons.height})")


def main() -> None:
    build_sheet()
    build_icons()


if __name__ == "__main__":
    main()
