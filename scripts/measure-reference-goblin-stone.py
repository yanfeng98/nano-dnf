#!/usr/bin/env python3
"""Measure the V1 entry stone against a fixed pillar and native bitmap.

Use audit149's extractor at58s/10s/stride3 and60.6s/.6s/stride1.
Three-frame groups avoid the recording's uneven per-frame pacing (ADR0039).
Fine frames establish rotation direction against distance, not wall-clock FPS.
"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--coarse", type=Path, required=True)
    parser.add_argument("--fine", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sprite", type=Path, default=ROOT / "assets/goblin-stone.png")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    source = Image.open(args.sprite).crop((8, 8, 25, 25))
    base = cv2.imread(str(args.coarse / "149-v1-60.7-second-room.png"))
    fine_base = cv2.imread(str(args.fine / "149-v1-60.7-second-room.png"))
    assert np.array_equal(base, fine_base), "same timestamp must have identical decoded RGB"
    pillar = base[345:421, 408:434]
    templates = []
    for scale in [.9, 1, 1.1, 1.125, 1.2]:
        for angle in range(0, 360, 10):
            pic = source.rotate(angle, Image.Resampling.BICUBIC, expand=True)
            pic = pic.resize((round(pic.width * scale), round(pic.height * scale)), Image.Resampling.BILINEAR)
            rgba = np.array(pic)
            templates.append((scale, angle, rgba[:, :, :3][:, :, ::-1].copy(), (rgba[:, :, 3] > 190).astype(np.uint8) * 255))

    def measure(folder, times):
        rows = []
        for timestamp in times:
            path = folder / f"149-v1-{timestamp:g}-second-room.png"
            image = cv2.imread(str(path))
            result = cv2.matchTemplate(image[310:470, 360:510], pillar, cv2.TM_CCOEFF_NORMED)
            _, score, _, (x, y) = cv2.minMaxLoc(result)
            dx, dy = x + 360 - 408, y + 310 - 345
            assert score >= .98, (timestamp, "pillar", score)
            roi = image[355 + dy:395 + dy, :500]
            candidates = []
            for scale, angle, pic, mask in templates:
                scores = cv2.matchTemplate(roi, pic, cv2.TM_CCOEFF_NORMED, mask=mask)
                scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
                _, value, _, (mx, my) = cv2.minMaxLoc(scores)
                h, w = pic.shape[:2]
                candidates.append({"score": value, "xy": [mx + w / 2, my + h / 2 + 355 + dy],
                                   "wh": [w, h], "scale": scale, "anglePILccw": angle,
                                   "topLeft": [mx, my + 355 + dy]})
            best = max(candidates, key=lambda item: item["score"])
            assert best["score"] >= .90, (timestamp, "stone", best)
            rows.append({"t": timestamp, "frame": path.name, "frameSHA256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "pillarNCC": score, "pillarShift": [dx, dy], **best,
                         "correctedXY": [best["xy"][0] - dx, best["xy"][1] - dy]})
        return rows

    coarse = measure(args.coarse, [60.6, 60.7, 60.8, 60.9, 61, 61.1])
    times = [row["time"] for row in json.loads((args.fine / "149-v1-second-room-extraction.json").read_text())["samples"][:16]]
    fine = measure(args.fine, times)
    xy = np.array([row["correctedXY"] for row in coarse])
    ts = np.array([row["t"] - coarse[0]["t"] for row in coarse])
    fit_x, fit_y = np.polyfit(ts, xy[:, 0], 1), np.polyfit(ts, xy[:, 1], 1)
    lo, hi = -np.inf, np.inf
    for i, row in enumerate(coarse):
        for other in coarse[i + 1:]:
            dt = other["t"] - row["t"]
            dx = other["correctedXY"][0] - row["correctedXY"][0]
            lo, hi = max(lo, (dx - 4) / dt), min(hi, (dx + 4) / dt)
    # Before the repeated61s frames/catch-up: every adjacent measured angle
    # advances by less than180degrees, so fine sampling resolves direction.
    phase_rows = fine[:13]
    phase_x = np.array([row["correctedXY"][0] for row in phase_rows])
    phase = np.rad2deg(np.unwrap(np.deg2rad([row["anglePILccw"] for row in phase_rows])))
    rotation = np.polyfit(phase_x, phase, 1)
    report = {"video": "00001-幽暗密林.mp4", "sourceFPS": 30,
              "pillarTemplate": [408, 345, 26, 76], "pillarSearch": [360, 310, 150, 160],
              "stoneSearch": [0, "355+pillarDy", 500, 40],
              "spriteSHA256": hashlib.sha256(args.sprite.read_bytes()).hexdigest(),
              "coarse": coarse, "fine": fine,
              "velocityScreenPxPerSecond": float(fit_x[0]),
              "velocityIntervalAssuming2pxPerPoint": [float(lo), float(hi)],
              "maxResidualX": float(max(abs(np.polyval(fit_x, ts) - xy[:, 0]))),
              "verticalSlopeScreenPxPerSecond": float(fit_y[0]),
              "verticalRangePx": float(np.ptp(xy[:, 1])),
              "phaseFitIndices": list(range(13)), "unwrappedPILccwDegrees": phase.tolist(),
              "rotationDegreesPerScreenPx": float(rotation[0]),
              "rotationMaxResidualDegrees": float(max(abs(np.polyval(rotation, phase_x) - phase))),
              "estimatedPeriodSeconds": float(360 / (rotation[0] * fit_x[0])),
              "canvasRotationSign": -int(np.sign(rotation[0])),
              "limits": ["The speed interval is an assumed pixel-error bound, not a statistical confidence interval.",
                         "Uneven/held frames invalidate fitting every frame's wall-clock displacement directly; coarse groups measure mean speed.",
                         "Scale/phase template search does not uniquely establish all bitmap sizing or the birth time.",
                         "Launch origin/lifetime, collision and damage are not independently measured here."]}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "156-stone-measurement.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    sheet = Image.new("RGB", (960, 720), "#202020")
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(fine):
        image = Image.open(args.fine / row["frame"])
        x, y = row["xy"]
        crop = image.crop((round(x) - 24, round(y) - 24, round(x) + 24, round(y) + 24)).resize((144, 144), Image.Resampling.NEAREST)
        cx, cy = i % 4 * 240, i // 4 * 180
        sheet.paste(crop, (cx, cy + 30))
        draw.text((cx, cy), f'{row["t"]:.4f}s NCC{row["score"]:.3f}', fill="white")
        draw.text((cx, cy + 15), f'PILccw {row["anglePILccw"]}deg', fill="white")
        dx, dy = row["pillarShift"]
        sheet.paste(image.crop((408 + dx, 345 + dy, 434 + dx, 421 + dy)), (cx + 170, cy + 40))
    sheet.save(args.out / "156-stone-source-crops.png")
    print(json.dumps({key: report[key] for key in ["velocityScreenPxPerSecond", "velocityIntervalAssuming2pxPerPoint",
          "rotationDegreesPerScreenPx", "estimatedPeriodSeconds", "canvasRotationSign"]}))


if __name__ == "__main__":
    main()
