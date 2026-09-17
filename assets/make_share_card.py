#!/usr/bin/env python3
"""Render the link-preview card used by the share meta tags.

    pip install pillow
    python3 assets/make_share_card.py

Writes `assets/share-card.png` (1200x630, the Open Graph size) from art this
repo already ships: the Slayer sprite sheet and the skill icon strip, over a
procedural dungeon backdrop. No external assets, and re-running the script
reproduces the same card.

`index.html` points `og:image` / `twitter:image` at the published copy, so the
deploy smoke check can fetch the card from the live site and fail if the deploy
forgot to ship it.
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ASSETS / "share-card.png"

WIDTH, HEIGHT = 1200, 630
GROUND = 470
# Mirrors SPRITE.cols in src/render.js: the sheet is as wide as its widest row
# (the 61-frame normal attack), so one cell is width / SHEET_COLS.
SHEET_COLS = 61

GOLD = (227, 191, 114)
INK = (234, 241, 255)
DIM = (150, 168, 200)

# The card mixes Latin and Chinese, so prefer a font that covers both and fall
# back to what a machine is likely to have.
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if pathlib.Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


def vertical_gradient(top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (1, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        blend = y / (HEIGHT - 1)
        draw.point(
            (0, y),
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * blend) for i in range(3)),
        )
    return image.resize((WIDTH, HEIGHT))


def add_torch(image: Image.Image, x: int, y: int, radius: int) -> None:
    glow = Image.new("L", (radius * 2, radius * 2), 0)
    ImageDraw.Draw(glow).ellipse((0, 0, radius * 2 - 1, radius * 2 - 1), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.45))
    warm = Image.new("RGB", (radius * 2, radius * 2), (255, 176, 96))
    image.paste(warm, (x - radius, y - radius), glow)
    flame = Image.new("L", (26, 46), 0)
    ImageDraw.Draw(flame).ellipse((4, 0, 21, 45), fill=210)
    flame = flame.filter(ImageFilter.GaussianBlur(5))
    image.paste(Image.new("RGB", flame.size, (255, 226, 170)), (x - 13, y - 23), flame)


def vignette_mask() -> Image.Image:
    """A smooth radial falloff, built small and scaled up so it has no banding."""
    small_w, small_h = 120, 63
    mask = Image.new("L", (small_w, small_h), 0)
    pixels = mask.load()
    for y in range(small_h):
        for x in range(small_w):
            nx = (x / (small_w - 1)) * 2 - 1
            ny = (y / (small_h - 1)) * 2 - 1
            distance = min(1.0, (nx * nx * 0.75 + ny * ny * 1.15) ** 0.5)
            pixels[x, y] = round(255 * max(0.0, 1 - distance**2.2))
    return mask.resize((WIDTH, HEIGHT), Image.BICUBIC)


def draw_backdrop() -> Image.Image:
    image = vertical_gradient((10, 16, 32), (29, 36, 56))
    for x in (250, 600, 950):
        add_torch(image, x, 300, 190)
    draw = ImageDraw.Draw(image, "RGBA")
    # Floor and a couple of arches, so the card reads as the same dungeon.
    draw.rectangle((0, GROUND, WIDTH, HEIGHT), fill=(18, 14, 30, 255))
    draw.line((0, GROUND, WIDTH, GROUND), fill=GOLD + (90,), width=2)
    for x in (150, 430, 710, 990):
        draw.rounded_rectangle((x, 120, x + 190, GROUND), radius=95, outline=(70, 88, 132, 90), width=3)
    shade = Image.new("RGB", (WIDTH, HEIGHT), (4, 6, 12))
    return Image.composite(image, shade, vignette_mask())


def paste_sprite(image: Image.Image) -> None:
    sheet = Image.open(ASSETS / "slayer.png").convert("RGBA")
    cell_w, cell_h = sheet.width // SHEET_COLS, sheet.height // 5
    idle = sheet.crop((0, 0, cell_w, cell_h))
    scale = 5
    idle = idle.resize((cell_w * scale, cell_h * scale), Image.NEAREST)
    # Keep the boots on the floor line rather than sinking into it.
    top = GROUND - round(idle.height * 0.94)
    image.paste(idle, (860, top), idle)
    # A soft elliptical shadow so the sprite is not floating.
    shadow = Image.new("L", (idle.width, 70), 0)
    ImageDraw.Draw(shadow).ellipse((30, 18, idle.width - 30, 62), fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    image.paste(Image.new("RGB", shadow.size, (0, 0, 0)), (860, GROUND - 42), shadow)


def paste_skill_icons(image: Image.Image) -> None:
    strip = Image.open(ASSETS / "skills.png").convert("RGBA")
    count = max(1, strip.width // 32)
    scale = 2
    x = 96
    for index in range(count):
        icon = strip.crop((index * 32, 0, index * 32 + 32, 32))
        icon = icon.resize((32 * scale, 32 * scale), Image.NEAREST)
        image.paste(icon, (x, HEIGHT - 146), icon)
        x += 32 * scale + 10


def draw_text(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image)
    draw.text((92, 118), "NANO-DNF", font=load_font(104), fill=GOLD)
    draw.text((96, 246), "鬼剑士 · 地下城试炼", font=load_font(44), fill=INK)
    draw.text(
        (96, 316),
        "DNF 风格 2D 横版地下城 · 单页 HTML5 · 打开就能玩",
        font=load_font(28),
        fill=DIM,
    )
    draw.text(
        (96, 362),
        "种子化布局 · 强化三选一 · 通关记录 · 无第三方库",
        font=load_font(28),
        fill=DIM,
    )
    draw.text(
        (WIDTH - 96, HEIGHT - 30),
        "luyf-lemon-love.space/nano-dnf",
        font=load_font(26),
        fill=GOLD,
        anchor="rs",
    )


def main() -> None:
    image = draw_backdrop()
    paste_sprite(image)
    paste_skill_icons(image)
    draw_text(image)
    image.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({image.width}x{image.height})")


if __name__ == "__main__":
    main()
