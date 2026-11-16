#!/usr/bin/env python3
"""Reproduce a limited native flybomb template search; a miss proves no absence.

Input frames are the normalized720x540 half-second PNGs from audit138.
The candidate image is client-derived evidence, not an adopted runtime asset.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sprite", type=Path, default=ROOT / "docs/reference-evidence/155-bomb-native-candidate.png")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    source = Image.open(args.sprite).convert("RGBA")
    templates = []
    for scale in [1, 1.125]:
        for angle in range(0, 360, 30):
            pic = source.rotate(angle, Image.Resampling.BICUBIC, expand=True)
            pic = pic.resize((round(pic.width * scale), round(pic.height * scale)), Image.Resampling.BILINEAR)
            data = np.array(pic)
            mask = (data[:, :, 3] > 180).astype(np.uint8) * 255
            templates.append((scale, angle, data[:, :, :3][:, :, ::-1].copy(), mask))
    rows, sources = [], []
    started = time.time()
    for timestamp in np.arange(26, 46, .5):
        path = args.frames / f"{timestamp:g}.png"
        image = cv2.imread(str(path))
        assert image is not None and image.shape[:2] == (540, 720), path
        roi = image[180:460]
        sources.append({"t": float(timestamp), "file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for scale, angle, pic, mask in templates:
            scores = cv2.matchTemplate(roi, pic, cv2.TM_CCOEFF_NORMED, mask=mask)
            scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
            _, score, _, (x, y) = cv2.minMaxLoc(scores)
            h, w = pic.shape[:2]
            part = roi[y:y + h, x:x + w]
            rmse = float(np.sqrt(np.mean((part[mask > 0].astype(float) - pic[mask > 0])**2)))
            rows.append({"t": float(timestamp), "scale": scale, "angle": angle, "score": score,
                         "rmse": rmse, "xy": [x, y + 180], "wh": [w, h]})
    report = {"elapsed": time.time() - started, "spriteSHA256": hashlib.sha256(args.sprite.read_bytes()).hexdigest(),
              "frames": sources, "roi": [0, 180, 720, 280], "rows": rows,
              "limits": ["Only40 half-second frames, two scales and12 angles are searched.",
                         "Occlusion, sampling, rendering, colour or an incorrect candidate can cause a miss.",
                         "A score maximum alone does not establish actor identity or a temporal trajectory."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(sorted(rows, key=lambda row: -row["score"])[:12]))


if __name__ == "__main__":
    main()
