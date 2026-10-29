#!/usr/bin/env python3
"""Extract exact, normalized source frames; never use a preview's coordinates.

python3 scripts/extract-reference-evidence.py --video-dir ~/luyanfeng/dnf-素材
Outputs JPEG evidence and a manifest, without embedding the videos in git.
"""
import argparse
import json
import subprocess
from pathlib import Path

SAMPLES = {
    '00001-幽暗密林.mp4': [5, 20, 32, 48, 60, 76, 105, 150, 180, 225, 300, 333, 340, 346, 352, 358],
    '00002-幽暗密林深处.mp4': [2, 12, 30, 74.25, 76, 90, 104, 106, 150, 192, 244, 279, 316, 330, 381, 385, 393, 410],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video-dir', type=Path, default=Path.home() / 'luyanfeng/dnf-素材')
    parser.add_argument('--out', type=Path, default=Path('docs/reference-evidence/frames'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {'normalization': '1920x1080 -> crop 1440x1080 at x240,y0 -> 720x540; seconds are exact seek positions', 'sources': []}
    for name, times in SAMPLES.items():
        video = args.video_dir / name
        meta = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate', '-of', 'json', str(video)]))
        source = {'name': name, 'bytes': video.stat().st_size, 'metadata': meta, 'frames': []}
        for seconds in times:
            filename = f'{name[:5]}-{seconds:07.2f}.jpg'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-ss', str(seconds), '-i', str(video), '-frames:v', '1', '-vf', 'crop=1440:1080:240:0,scale=720:540', '-q:v', '2', '-y', str(args.out / filename)], check=True)
            source['frames'].append({'seconds': seconds, 'file': filename})
        manifest['sources'].append(source)
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
