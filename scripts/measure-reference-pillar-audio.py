#!/usr/bin/env python3
"""Compare the native break sample with mixed reference audio; do not infer fixed playback latency."""
import argparse
import json
import subprocess
from pathlib import Path
import numpy as np
from scipy.signal import correlate
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--video', type=Path, default=Path('../dnf-素材/00002-幽暗密林深处.mp4'))
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
rate = 22050

def pcm(path, start=None, duration=None):
    cmd = ['ffmpeg', '-v', 'error']
    if start is not None: cmd += ['-ss', str(start)]
    cmd += ['-i', str(path)]
    if duration is not None: cmd += ['-t', str(duration)]
    cmd += ['-vn', '-ac', '1', '-ar', str(rate), '-f', 'f32le', 'pipe:1']
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout, dtype='<f4')

source = pcm(Path(__file__).resolve().parents[1] / 'assets/sfx/tstone_break.ogg')
rows = []
for label, start in [('entry', 25), ('middle', 40), ('late', 62)]:
    recording = pcm(a.video, start, 6)
    sums = np.r_[0, np.cumsum(recording.astype(float))]
    squares = np.r_[0, np.cumsum(recording.astype(float) ** 2)]
    peaks = []
    for duration in [.2, .3, .4, .6, len(source) / rate]:
        sample = source[:round(duration * rate)].astype(float)
        sample -= sample.mean(); n = len(sample)
        numerator = correlate(recording, sample, mode='valid', method='fft')
        energy = squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
        scores = numerator / np.sqrt(np.maximum(energy, 1e-9) * np.sum(sample ** 2))
        index = int(scores.argmax())
        peaks.append({'prefixSeconds': duration, 'time': start + index / rate, 'correlation': float(scores[index])})
    rows.append({'interval': label, 'start': start, 'duration': 6, 'peaks': peaks})
report = {'sample': 'assets/sfx/tstone_break.ogg', 'sampleSecondsFfmpeg': len(source) / rate, 'sampleRate': rate,
          'intervals': rows, 'limits': 'Mixed audio has music, attacks and voices. Late/middle long-prefix peaks are consistent in location but correlations are partial; entry short-prefix peaks are unstable. This does not establish exact mix gain or a fixed game-side delay. No audio offset is added to runtime.'}
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(report, indent=2) + '\n')
print([(r['interval'], r['peaks'][-1]) for r in rows])
