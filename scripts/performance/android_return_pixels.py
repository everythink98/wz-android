"""Time the first identifiable Feed region in a separate Android screenrecord run."""

import argparse
import json
from pathlib import Path
import struct
import subprocess


def frame_times_ns(mp4):
    # Android 15 screenrecord's Winscope v2 track stores elapsedRealtime nanoseconds.
    # The byte layout is defined by AOSP frameworks/av/cmds/screenrecord/screenrecord.cpp.
    magic = b"#VV1NSC0PET1ME2#"
    at = mp4.find(magic)
    if at < 0 or mp4.find(magic, at + 1) >= 0:
        raise ValueError("Expected one Winscope v2 clock table")
    header = at + len(magic)
    version, _, count = struct.unpack_from("<IqI", mp4, header)
    start = header + struct.calcsize("<IqI")
    if version != 2 or count < 3 or start + count * 8 > len(mp4):
        raise ValueError("Invalid Winscope frame table")
    times = struct.unpack_from(f"<{count}Q", mp4, start)
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("Duplicate or reordered video times")
    return times


def gray_decode_command(path, ffmpeg, size, region):
    width, height = size
    left, top, w, h = region
    if not (w > 0 and h > 0 and 0 <= left <= width - w and 0 <= top <= height - h):
        raise ValueError("Region outside analysis image")
    return [
        str(ffmpeg), "-v", "error", "-i", str(path), "-map", "0:v:0", "-an", "-vf",
        f"scale={width}:{height},format=gray,crop={w}:{h}:{left}:{top}",
        "-fps_mode", "passthrough", "-enc_time_base", "1:1000000", "-pix_fmt", "gray", "-f", "rawvideo", "-"
    ]


def decode(path, ffmpeg, size, region):
    return subprocess.check_output(gray_decode_command(path, ffmpeg, size, region))


def first_feed_frame(topic, feed, video, times, back_ns):
    size = len(feed)
    if not size or len(topic) != size or len(video) != size * len(times):
        raise ValueError("Video frame count does not match its clocks or reference images")
    if not times[0] < back_ns < times[-1]:
        raise ValueError("Video does not bracket the Back input")
    indexes = [i for i in range(size) if abs(topic[i] - feed[i]) >= 52]
    indexes = indexes[::max(1, len(indexes) // 4096)]
    if len(indexes) < 48:
        raise ValueError("Insufficient discriminating pixels")
    scores = [sum(abs(video[k * size + i] - feed[i]) < 32 for i in indexes) / len(indexes)
              for k in range(len(times))]
    if max(s for t, s in zip(times, scores) if t < back_ns) >= .75 or scores[-1] < .80:
        raise ValueError("Clip does not bracket a distinct Topic-to-Feed transition")
    topic_scores = [sum(abs(video[k * size + i] - topic[i]) < 32 for i in indexes) / len(indexes)
                    for k in range(len(times))]
    start = next((i for i in range(1, len(times)) if times[i] >= back_ns and topic_scores[i] < .85), None)
    stable = next((i for i in range(1, len(times) - 1) if times[i] >= back_ns and
                   times[-1] - times[i] >= 35_000_000 and min(scores[i:]) >= .90), None)
    for k in range(1, len(times) - 1):
        if times[k] >= back_ns and scores[k] >= .80 and scores[k + 1] >= .75:
            return {"firstRecognizableFeedMs": round((times[k] - back_ns) / 1e6, 3),
                    "previousVideoFrameMs": round((times[k - 1] - back_ns) / 1e6, 3),
                    "regionScore": round(scores[k], 3), "supportingPixels": len(indexes),
                    "videoFrames": len(times),
                    "regionMotionObservedNs": times[start] if start is not None else None,
                    "regionStableObservedNs": times[stable] if stable is not None else None}
    raise ValueError("No confirmed identifiable Feed pixels")


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--clip", required=True, type=Path)
    cli.add_argument("--topic", required=True, type=Path, help="Reference screenshot immediately before Back")
    cli.add_argument("--feed", required=True, type=Path, help="Settled reference screenshot after Back")
    cli.add_argument("--back-ns", type=int, required=True, help="Unique delivered Back-UP in the same trace")
    cli.add_argument("--size", nargs=2, type=int, required=True, metavar=("WIDTH", "HEIGHT"))
    cli.add_argument("--region", nargs=4, type=int, required=True, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    cli.add_argument("--ffmpeg", default="ffmpeg")
    args = cli.parse_args()
    times = frame_times_ns(args.clip.read_bytes())
    topic, feed, video = [decode(p, args.ffmpeg, args.size, args.region) for p in (args.topic, args.feed, args.clip)]
    print(json.dumps(first_feed_frame(topic, feed, video, times, args.back_ns), indent=2))


if __name__ == "__main__":
    main()
