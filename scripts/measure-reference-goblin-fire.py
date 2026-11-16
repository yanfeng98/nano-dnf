#!/usr/bin/env python3
"""Measure one visible V1 fire trail's front independently of stone motion.

Uses audit149's normalized extractor at58s/10s/stride3. The fixed ROI is
manually selected for this shot; colour segmentation is not sprite identity.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    base = cv2.imread(str(args.frames / "149-v1-60.7-second-room.png"))
    pillar = base[345:421, 408:434]
    images, samples = [], []
    for timestamp in [61.2, 61.3, 61.4, 61.5]:
        path = args.frames / f"149-v1-{timestamp:g}-second-room.png"
        image = cv2.imread(str(path))
        result = cv2.matchTemplate(image[310:470, 360:510], pillar, cv2.TM_CCOEFF_NORMED)
        _, score, _, (x, y) = cv2.minMaxLoc(result)
        assert score > .98, (timestamp, score)
        samples.append({"t": timestamp, "frame": path.name,
                        "frameSHA256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "pillarNCC": score, "pillarShift": [x + 360 - 408, y + 310 - 345]})
        images.append(image)

    def segment(image, r_min, g_min, gb_ratio):
        b, g, r = [image[:, :, i].astype(float) for i in range(3)]
        mask = (r > r_min) & (g > g_min) & (g < r * .91) & (g > b * gb_ratio) & (b < 110)
        selected = np.zeros(image.shape[:2], dtype=np.uint8)
        selected[295:330, 100:270] = mask[295:330, 100:270] * 255
        ys, xs = np.nonzero(selected)
        assert len(xs) > 0
        edge = int(xs.max())
        front_y = float(np.median(ys[xs >= edge - 3]))
        return selected, edge, front_y

    contact = Image.new("RGB", (620, 560), "#202020")
    draw = ImageDraw.Draw(contact)
    for i, (image, sample) in enumerate(zip(images, samples)):
        mask, edge, front_y = segment(image, 120, 70, 1.6)
        sample.update(frontX=edge, frontMedianY=front_y,
                      correctedFrontX=edge - sample["pillarShift"][0],
                      correctedFrontY=front_y - sample["pillarShift"][1])
        row = i * 140
        draw.text((4, row), f"V1 {sample['t']:g}s: front=({edge},{front_y:g})", fill="white")
        crop = Image.fromarray(cv2.cvtColor(image[285:345, 70:290], cv2.COLOR_BGR2RGB)).resize((440, 120))
        cd = ImageDraw.Draw(crop)
        cd.line(((edge - 70) * 2, 0, (edge - 70) * 2, 119), fill="red")
        contact.paste(crop, (0, row + 20))
        contact.paste(Image.fromarray(mask[285:345, 100:270]).resize((170, 120)), (450, row + 20))

    times = np.array([s["t"] - samples[0]["t"] for s in samples])
    xs = np.array([s["correctedFrontX"] for s in samples])
    fit = np.polyfit(times, xs, 1)
    residual = float(np.max(np.abs(xs - np.polyval(fit, times))))
    # Explicit per-point +/-2px sensitivity bound; not a statistical CI.
    lower, upper = -np.inf, np.inf
    for i, sample in enumerate(samples):
        for other in samples[i + 1:]:
            dt = other["t"] - sample["t"]
            dx = other["correctedFrontX"] - sample["correctedFrontX"]
            lower = max(lower, (dx - 4) / dt)
            upper = min(upper, (dx + 4) / dt)
    trials = []
    for r_min, g_min, ratio in itertools.product([100, 120, 140], [60, 70, 80], [1.4, 1.6, 1.8]):
        fronts = [segment(image, r_min, g_min, ratio)[1] - sample["pillarShift"][0]
                  for image, sample in zip(images, samples)]
        trials.append({"rMin": r_min, "gMin": g_min, "gToBRatio": ratio,
                       "correctedFrontX": fronts, "fitScreenPixelsPerSecond": float(np.polyfit(times, fronts, 1)[0])})
    report = {"video": "00001-幽暗密林.mp4", "samples": samples,
              "roiXYWH": [100, 295, 170, 35],
              "primaryMask": "R>120, G>70, G<R*.91, G>B*1.6, B<110 (decoded RGB)",
              "pillarTemplateXYWH": [408, 345, 26, 76], "pillarSearchXYWH": [360, 310, 150, 160],
              "fitScreenPixelsPerSecond": float(fit[0]), "maxResidualPixels": residual,
              "perPointAssumedErrorPixels": 2, "speedConstraintInterval": [lower, upper],
              "nativeDeclaredXSpeed": 300, "existingNativeProjection": 1.125,
              "nativeProjectedSpeed": 337.5, "thresholdSensitivityTrials": trials,
              "limits": ["Manually isolated orange trail is spatially distinct from the lower stone.",
                         "Colour front is not the physical missile origin, hitbox or sprite-template identity.",
                         "Four three-frame groups constrain horizontal speed only; no launch/lifetime/gravity formula inferred.",
                         "The +/-2px bound is an explicit assumption, not a statistical confidence interval.",
                         "No ANI particle transforms, emission cadence or blend equation are proved."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Path(str(args.out) + ".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    contact.save(str(args.out) + "-crops.png")
    print(json.dumps({"fit": float(fit[0]), "residual": residual, "interval": [lower, upper],
                      "thresholdSpeedRange": [min(t["fitScreenPixelsPerSecond"] for t in trials),
                                              max(t["fitScreenPixelsPerSecond"] for t in trials)]}))


if __name__ == "__main__":
    main()
