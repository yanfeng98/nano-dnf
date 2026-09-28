#!/usr/bin/env python3
"""Find which client shape a reference clip is actually playing - by silhouette.

    python3 assets/match_effect_shape.py 02_十字斩 44 55 762 725

**Why this exists.** Every rework in this repo until 2026-09-28 picked a layer by
comparing **bounding boxes**: "the clip measures 148x138 and this entry is
131x141, so it is that one". A box cannot tell two shapes apart - a diagonal
sliver drawn across a square has the same box as the square. 十字斩's third act
was picked that way, passed every box check for twenty rounds, and was a thin
ribbon on screen the whole time.

So this compares **silhouettes**: each candidate's ink is cropped to its own box
and scaled to the target's, which throws the box away and leaves only the shape.

**What it is good for, and what it is not.** Run on 十字斩's third act it ranks
`fullmoon.img` f2 first - a plain gold crescent, and not the move at all. It is a
**shortlist**, not a verdict: it puts a few dozen plausible shapes in front of you
so you look at those instead of at 1800. The owner's 十字斩 layer was found this
way and then confirmed by eye (`assets/dnf_effect_picks.md` 第二十一节).

**Do not read a bare IoU.** Two traps, both hit in this repo:

  * it means nothing without a **control** - a layer of the same move that has
    already been accepted. 十字斩's 十 is the standing one.
  * **two different scorings of the same question give two different answers.**
    Cropped-and-scaled (this file) puts `fullmoon` on top; a scale+offset search
    that lets the shape sit anywhere puts 十字斩's old ribbon at 0.52 and the
    layer that replaced it at 0.46, i.e. it prefers the wrong one. A thin diagonal
    shape can be laid across almost any target and score well, which is the whole
    reason the old layer survived twenty rounds of box checks.

The number that decides is the **end-to-end** one - bake the art into the row and
compare the row against the clip on one ruler - and even that only improved the
third act from 0.218 to 0.274 against a control of 0.42. The swap was made because
the shape reads as the clip's (a solid swept wing, not a ribbon) and because it is
the skill's own projectile; not because a score said so.

Needs the installed client (`--client`, or `/mnt/c/dnf/地下城与勇士`) and
`pydnfex`, the same as `import_dnf_effects.py`.
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import pathlib
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CLIENT = pathlib.Path("/mnt/c/dnf/地下城与勇士")
CLIPS = ROOT / "dnf_src" / "bilibili" / "skill-clips"
SLAYER_REF_HEIGHT = 218.0      # the clip's own Slayer, in the clip's own pixels
SLAYER_CLIENT_HEIGHT = 84.0    # ours, in client px  (see CONTEXT.md, 身位)


def load_bake():
    spec = importlib.util.spec_from_file_location("bake", ROOT / "import_dnf_effects.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["bake"] = module
    try:
        spec.loader.exec_module(module)
    except SystemExit:
        pass
    return module


def red_mask(path: pathlib.Path) -> np.ndarray:
    """The clip's red ink. The clips are black-background composites: no alpha,
    so "red" is a colour test, and the thresholds have to be the same on both
    sides of a comparison or it is comparing two different things."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mask = (r > 90) & (r > 1.7 * g) & (r > 1.7 * b)
    mask[:330] = False      # the clip's own HUD, top and bottom
    mask[840:] = False
    mask[:, :300] = False
    return mask


def largest_blob(mask: np.ndarray) -> np.ndarray:
    """The move, not the sword and not the thin line across it."""
    labels, count = ndimage.label(mask, np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == int(np.argmax(sizes)) + 1


def normalise(mask: np.ndarray, size: int = 96) -> np.ndarray | None:
    """Crop to the ink's own box and scale to `size` - this is what throws the
    bounding box away."""
    ys, xs = np.nonzero(mask)
    if len(ys) < 30:
        return None
    box = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    small = Image.fromarray((box * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    return np.asarray(small) > 100


def clip_targets(folder: str, first: int, last: int, anchor_x: int, anchor_y: int,
                 erode: int = 0) -> list[np.ndarray]:
    """The clip's own shapes, in its own frame.

    The clip's frames are decoded on the spot (they are gitignored, and every
    round that reused a stale directory measured the wrong video at least once).

    `anchor_x` / `anchor_y` are the caster's axis and his sole in the clip's
    screen px. They are not used to place the target - the target is cropped to
    its own ink like every candidate - but they are the two numbers you have to
    measure the clip with in the first place, so they are arguments rather than
    something the caller remembers: `assets/dnf_effect_picks.md` has the
    boots-on-the-ground-band procedure that reads them off.
    """
    del anchor_x, anchor_y
    clips = sorted(CLIPS.glob(f"*{folder}*.mp4"))
    if not clips:
        raise SystemExit(f"no clip matching {folder!r} in {CLIPS}")
    work = pathlib.Path(tempfile.mkdtemp(prefix="match-shape-"))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(clips[0]), "-vsync", "0", str(work / "f%03d.png")],
        check=True,
    )
    out = []
    for n in range(first, last + 1):
        path = work / f"f{n:03d}.png"
        if not path.exists():
            continue
        mask = largest_blob(red_mask(path))
        if erode:
            mask = ndimage.binary_erosion(mask, np.ones((erode, erode)))
        norm = normalise(mask)
        if norm is not None:
            out.append(norm)
    shutil.rmtree(work, ignore_errors=True)
    return out


def candidates(client: pathlib.Path):
    """Every shape in every 鬼剑士 effect pack, ink-cropped."""
    from pydnfex.img.version import IMGFactory
    from pydnfex.npk import NPK

    for path in sorted((client / "ImagePacks2").glob("sprite_character_swordman_effect*.NPK")):
        try:
            with open(path, "rb") as handle:
                npk = NPK.open(handle)
                for entry in npk.files:
                    name = entry.name.replace("\\", "/").split("/")[-1]
                    try:
                        frames = load_bake().decode_frames(
                            IMGFactory.open(io.BytesIO(entry.data))
                        )
                    except Exception:
                        continue
                    if len(frames) > 30:
                        continue
                    for index, (picture, _x, _y) in enumerate(frames[:4]):
                        alpha = np.asarray(picture)[:, :, 3] > 60
                        if not 2500 <= alpha.sum() <= 40000:
                            continue
                        ys, xs = np.nonzero(alpha)
                        ratio = (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)
                        if not 0.55 <= ratio <= 1.6:
                            continue
                        norm = normalise(alpha)
                        if norm is not None:
                            yield path.name, name, index, norm
        except Exception as error:  # a pack that will not open is not a result
            print(f"  {path.name}: {type(error).__name__}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("clip", help="substring of the reference clip, e.g. 02_十字斩")
    parser.add_argument("first", type=int, help="first frame of the act, in the clip's own numbers")
    parser.add_argument("last", type=int, help="last frame of the act")
    parser.add_argument("anchor_x", type=int, help="the caster's axis, clip screen px")
    parser.add_argument("anchor_y", type=int, help="the caster's sole, clip screen px")
    parser.add_argument("--client", type=pathlib.Path, default=DEFAULT_CLIENT)
    parser.add_argument("--erode", type=int, default=0,
                        help="erode the target first, to ask about the solid body only")
    parser.add_argument("--top", type=int, default=25)
    args = parser.parse_args()

    targets = clip_targets(args.clip, args.first, args.last, args.anchor_x, args.anchor_y,
                           args.erode)
    if not targets:
        raise SystemExit(f"no frames found for {args.clip} in {CLIPS}")
    print(f"{len(targets)} reference frames (#{args.first}-{args.last})")
    print("compare every score against the control - a layer of the same move the "
          "owner has already accepted\n")

    scored = []
    for i, (pack, name, index, norm) in enumerate(candidates(args.client)):
        best = max(
            (int((norm & t).sum()) / int((norm | t).sum())) for t in targets
        )
        pack = pack.replace("sprite_character_swordman_effect", "").replace(".NPK", "")
        scored.append((best, pack, name, index))
        if i % 200 == 0:
            print(f"  ...{i} shapes, best {max(s[0] for s in scored):.3f}", flush=True)

    scored.sort(reverse=True)
    print(f"\n{'IoU':>6}  {'pack':<22} {'entry':<34} frame")
    for score, pack, name, index in scored[:args.top]:
        print(f"{score:>6.3f}  {pack:<22} {name:<34} f{index}")


if __name__ == "__main__":
    main()
