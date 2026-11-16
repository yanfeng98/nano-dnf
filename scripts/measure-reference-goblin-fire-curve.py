#!/usr/bin/env python3
"""Measure V1 fire-front curvature against displacement, not recording FPS.

Extract60.9s/1s/stride1 with inspect-reference-v1-second-room.py first.
The colour front is an observation proxy, not a physical missile center.
"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--pillar-frame", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    meta = json.loads((args.frames / "149-v1-second-room-extraction.json").read_text())
    base = cv2.imread(str(args.pillar_frame))
    pillar = base[345:421, 408:434]
    rows = []
    contact = Image.new("RGB", (840, 600), "#202020")
    draw = ImageDraw.Draw(contact)
    for sample in meta["samples"]:
        if not 61.2 - 1e-6 <= sample["time"] <= 61.5 + 1e-6:
            continue
        path = args.frames / sample["frame"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sample["sha256"]
        image = cv2.imread(str(path))
        scores = cv2.matchTemplate(image[310:470, 360:510], pillar, cv2.TM_CCOEFF_NORMED)
        _, ncc, _, (px, py) = cv2.minMaxLoc(scores)
        assert ncc > .98
        b, g, r = [image[:, :, i].astype(float) for i in range(3)]
        mask = ((r > 120) & (g > 70) & (g < r * .91) & (g > b * 1.6) & (b < 110))[295:330, 100:270]
        ys, xs = np.nonzero(mask)
        edge = int(xs.max())
        front_y = float(np.median(ys[xs >= edge - 3])) + 295
        dx, dy = px + 360 - 408, py + 310 - 345
        index = len(rows)
        rows.append({**sample, "frontX": edge + 100, "frontY": front_y,
                     "pillarShift": [dx, dy], "pillarNCC": ncc,
                     "correctedX": edge + 100 - dx, "correctedY": front_y - dy})
        x, y = index % 2 * 420, index // 2 * 120
        crop = Image.fromarray(cv2.cvtColor(image[285:335, 70:280], cv2.COLOR_BGR2RGB)).resize((420, 100))
        cd = ImageDraw.Draw(crop)
        cd.line(((edge + 30) * 2, 0, (edge + 30) * 2, 99), fill="red")
        contact.paste(crop, (x, y + 20))
        draw.text((x + 3, y), f"V1 {sample['time']:.4f}s: ({edge+100},{front_y:g})", fill="white")
    assert len(rows) == 10
    x = np.array([s["correctedX"] for s in rows], dtype=float)
    x -= x[0]
    y = np.array([s["correctedY"] for s in rows])
    fit = np.polyfit(x, y, 2)
    models = []
    for acceleration in [0, 225, 300]:
        a = acceleration / (2 * 337.5 ** 2)
        linear = np.polyfit(x, y - a * x * x, 1)
        residual = y - (a * x * x + np.polyval(linear, x))
        models.append({"screenAcceleration": acceleration, "curvature": a,
                       "fittedLinear": linear.tolist(), "residualPixels": residual.tolist(),
                       "maxResidualPixels": float(np.abs(residual).max())})
    report = {"video": meta["video"], "samples": rows,
              "pillarFrame": args.pillar_frame.name,
              "pillarFrameSHA256": hashlib.sha256(args.pillar_frame.read_bytes()).hexdigest(),
              "pillarTemplateXYWH": [408, 345, 26, 76], "pillarSearchXYWH": [360, 310, 150, 160],
              "colourROI": [100, 295, 170, 35],
              "mask": "R>120,G>70,G<R*.91,G>B*1.6,B<110; right edge, medianY of last4columns",
              "fitInDisplacement": fit.tolist(), "maxResidualPixels": float(np.abs(y - np.polyval(fit, x)).max()),
              "nativeCandidate": {"xSpeed": 300, "gravity": 200, "projection": 1.125,
                                  "screenSpeed": 337.5, "screenAcceleration": 225},
              "models": models,
              "limits": ["Visible colour front is not the physical missile center or hitbox.",
                         "Fits allow free origin and slope; launch angle and exact birth are not independently established.",
                         "Constant gravity200 with the existing projection is compatible, not a unique formula proof.",
                         "Displacement fits avoid the source recording's repeated/catch-up frames.",
                         "Particle scheduling, ANI transforms, light children and blending remain separate work."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Path(str(args.out) + ".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    contact.save(str(args.out) + "-crops.png")
    print(json.dumps({"points": 10, "curvature": float(fit[0]), "maxResidual": report["maxResidualPixels"],
                      "nativeModelResidual": models[1]["maxResidualPixels"]}))


if __name__ == "__main__":
    main()
