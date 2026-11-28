"""Record a paired Android scroll video and Perfetto trace from an already open Topic."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import time
import uuid


def capture_clip(adb, video, trace, screen=(1080, 2400)):
    if video.exists() or trace.exists():
        raise FileExistsError("Output clip or trace already exists")
    tag = "wz-scroll-pixels-" + uuid.uuid4().hex
    remote_trace = "/data/misc/perfetto-traces/" + tag + ".pftrace"
    remote_video = "/data/local/tmp/" + tag + ".mp4"
    config = '''buffers { size_kb: 49152 fill_policy: RING_BUFFER }
duration_ms: 15500
data_sources { config { name: "linux.ftrace" ftrace_config { atrace_categories: "view" atrace_categories: "input" atrace_apps: "com.wz.reader" } } }
data_sources { config { name: "linux.process_stats" process_stats_config { scan_all_processes_on_start: true } } }
data_sources { config { name: "android.surfaceflinger.frametimeline" } }'''
    adb("shell", "perfetto", "--background-wait", "--txt", "-c", "-", "-o", remote_trace, input=config)
    start = time.monotonic()
    x = round(screen[0] * 535 / 1080)
    high, low = (round(screen[1] * y / 2400) for y in (670, 1890))
    actions = []
    try:
        with ThreadPoolExecutor(1) as worker:
            recording = worker.submit(adb, "shell", "screenrecord", "--size", "540x1200", "--bit-rate",
                                      "10000000", "--time-limit", "14", "--bugreport", remote_video)
            time.sleep(2.1)
            for direction in ["down"] * 4 + ["up"] * 4:
                y1, y2 = (low, high) if direction == "down" else (high, low)
                timestamp = adb("shell", f"cat /proc/uptime; input swipe {x} {y1} {x} {y2} 170")
                actions.append({"direction": direction, "commandMarkerNs": round(float(timestamp.split()[0]) * 1e9)})
                time.sleep(.98)
            recording.result()
        time.sleep(max(.1, start + 16.1 - time.monotonic()))
        adb("pull", remote_video, str(video))
        adb("pull", remote_trace, str(trace))
    finally:
        adb("shell", "rm", "-f", remote_video, remote_trace)
    return {"video": video.name, "trace": trace.name, "actions": actions}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("manifest", type=Path, help="New local JSON file. The .mp4 and .pftrace are stored alongside.")
    cli.add_argument("--serial", required=True)
    cli.add_argument("--apk-sha256", required=True)
    cli.add_argument("--hz", type=float, required=True)
    args = cli.parse_args()
    if args.manifest.exists() or args.manifest.suffix != ".json":
        cli.error("Choose a new .json manifest")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", args.apk_sha256) or not 0 < args.hz <= 1000:
        cli.error("Provide the installed APK's SHA-256 and measured display rate")
    def adb(*command, **kwargs):
        return subprocess.check_output(["adb", "-s", args.serial, *command], text=True, encoding="utf-8",
                                       errors="replace", timeout=40, **kwargs).strip()
    def identity():
        path = adb("shell", "pm", "path", "com.wz.reader")
        if not re.fullmatch(r"package:/data/app/[^\s]+/base\.apk", path):
            raise ValueError("Expected a single installed com.wz.reader base APK")
        digest = adb("shell", "sha256sum", path.removeprefix("package:")).split()[0]
        pid = adb("shell", "pidof", "com.wz.reader")
        if digest != args.apk_sha256.lower() or not pid.isdigit():
            raise ValueError("Installed APK or foreground app process does not match the requested capture")
        return digest, pid
    digest, pid = identity()
    activity = adb("shell", "dumpsys", "activity", "activities")
    if not re.search(r"(?:topResumedActivity|mResumedActivity)[^\n]+com\.wz\.reader/\.MainActivity", activity):
        raise ValueError("Open the intended Topic in com.wz.reader before running this capture")
    sizes = re.findall(r"(?:Physical|Override) size: (\d+)x(\d+)", adb("shell", "wm", "size"))
    if not sizes:
        raise ValueError("Cannot read the active screen size")
    screen = tuple(map(int, sizes[-1]))
    if screen[0] * 1200 != screen[1] * 540:
        raise ValueError("The compared portrait content ROI requires the 540:1200 aspect ratio")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    clip = capture_clip(adb, args.manifest.with_suffix(".mp4"), args.manifest.with_suffix(".pftrace"), screen)
    if identity() != (digest, pid):
        raise ValueError("App identity or process changed during capture")
    with args.manifest.open("x", encoding="utf-8") as output:
        json.dump({"apkSha256": digest, "pid": pid, "hz": args.hz, "clips": [clip]}, output, indent=2)


if __name__ == "__main__":
    main()
