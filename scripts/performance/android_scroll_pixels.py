"""Measure visible mid-scroll pauses from Android screenrecord and matching Perfetto input."""

import argparse
from bisect import bisect_left, bisect_right
from collections import Counter
import json
from pathlib import Path
import subprocess

from android_fluidity import gesture_events, phase_boundaries, query, target_cadence
from android_return_pixels import frame_times_ns, gray_decode_command


def app_presentations(processor, trace, pid):
    rows = query(processor, trace, f"""
      WITH display AS (
        SELECT a.display_frame_token, count(*) n, min(a.ts+a.dur) shown, min(a.present_type) present_type
        FROM actual_frame_timeline_slice a JOIN process p USING(upid)
        WHERE p.name GLOB '*surfaceflinger' AND a.surface_frame_token IS NULL AND a.dur>0 GROUP BY a.display_frame_token
      )
      SELECT a.ts, a.dur, a.present_type app_type, d.n, d.shown, d.present_type display_type
      FROM actual_frame_timeline_slice a JOIN process p USING(upid) LEFT JOIN display d USING(display_frame_token)
      WHERE p.pid={int(pid)} AND p.name='com.wz.reader' AND a.layer_name GLOB '*MainActivity*'
      ORDER BY a.ts
    """)
    shown, unresolved = set(), []
    for row in rows:
        if "Dropped" in row["app_type"] or "Dropped" in row["display_type"]:
            continue
        if int(row["dur"]) <= 0 or row["n"] != "1":
            unresolved.append(int(row["ts"]))
        else:
            shown.add(int(row["shown"]))
    return sorted(shown), unresolved


def present_gaps(presented, unresolved, scroll, bounds, times, offsets, direction, period):
    if not bounds:
        return {"status": "unknown", "reason": "unmatchedInputOrScroll"}
    down, up, last = bounds
    observed = presented[bisect_left(presented, down):bisect_right(presented, last)]
    if len(observed) < 2 or any(down <= t <= last for t in unresolved):
        return {"status": "unknown", "reason": "incompletePresentations"}
    gaps = []
    longest = max(b - a for a, b in zip(observed, observed[1:]))
    sign = -1 if direction == "down" else 1
    for a, b in zip(observed, observed[1:]):
        if b - a < 50_000_000:
            continue
        callbacks = bisect_left(scroll, b) - bisect_right(scroll, a)
        phases = "touch" if b <= up else "inertia" if a >= up else "touchToInertia"
        def directional_pixel(left, right):
            for i in range(max(0, bisect_left(times, left)), min(len(offsets), bisect_right(times, right))):
                if times[i + 1] <= right and times[i + 1] - times[i] <= 2.5 * period:
                    if offsets[i] is not None and sign * offsets[i] >= 2:
                        return True
            return False
        before = directional_pixel(max(down, a - 75_000_000), a + period)
        after = directional_pixel(b - period, min(last, b + 75_000_000))
        gaps.append({"ms": round((b-a)/1e6, 3), "phase": phases, "scrollCallbacksInside": callbacks,
                     "directionalPixelsBothSides": before and after})
    return {"status": "observed", "distinctPresentations": len(observed), "maxMs": round(longest/1e6, 3), "gaps": gaps}


def display_counts(rows):
    known = [r["displayPacing"] for r in rows if r["displayPacing"]["status"] == "observed"]
    total = len(rows)
    with_gap = sum(bool(r["gaps"]) for r in known)
    with_callback = sum(any(g["scrollCallbacksInside"] for g in r["gaps"]) for r in known)
    with_pixels = sum(any(g["scrollCallbacksInside"] and g["directionalPixelsBothSides"] for g in r["gaps"]) for r in known)
    unknown = total - len(known)
    return {"gestures": total, "observed": len(known), "unknown": unknown, "with50msGap": with_gap,
            "withScrollInside50msGap": with_callback, "alsoBracedByDirectionalPixels": with_pixels,
            "per100GapWithScrollBounds": [round(x*100/total, 2) for x in (with_callback, with_callback + unknown)] if total else None}


def vertical_offset(previous, current, cv2, np):
    """Return a signed translation in capture pixels when two textured areas agree."""
    height, width = previous.shape
    search = min(145, height // 4)
    tile = min(60, height // 9)
    matches = []
    for y in (height // 4, 3 * height // 4):
        start = max(0, y - search)
        stop = min(height, y + tile + search)
        for x in (0, width // 2):
            template = previous[y:y + tile, x:x + width // 2]
            if template.std() < 9 or np.abs(np.diff(template.astype('int16'), axis=0)).mean() < 2:
                continue
            stripe = current[start:stop, x:x + width // 2]
            scores = cv2.matchTemplate(stripe, template, cv2.TM_CCOEFF_NORMED).ravel()
            best = int(scores.argmax())
            score = float(scores[best])
            if score < .82:
                continue
            scores[max(0, best - 2):best + 3] = -1
            if score - float(scores.max()) >= .025:
                matches.append((start + best - y, y, x))
    # Require independent support in the upper and lower content. Fixed chrome, inline
    # movies and a single static image occupying only one band cannot establish motion.
    for offset, *_ in matches:
        support = [match for match in matches if abs(match[0] - offset) <= 1]
        if len({m[1] for m in support}) == 2 and len(support) > len(matches) / 2:
            offsets = sorted(m[0] for m in support)
            # A zero requires exact agreement across both vertical regions.
            if 0 in offsets and any(offsets):
                return None
            return offsets[len(offsets) // 2]
    return None


def clip_offsets(clip, ffmpeg, region, count, cv2, np):
    _, _, width, height = region
    byte_count = width * height
    previous = None
    offsets = []
    command = gray_decode_command(clip, ffmpeg, (540, 1200), region)
    with subprocess.Popen(command, stdout=subprocess.PIPE) as decoder:
        try:
            for _ in range(count):
                raw = decoder.stdout.read(byte_count)
                if len(raw) != byte_count:
                    raise ValueError("Decoded video ended before its Winscope timestamps")
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width))
                stripe = cv2.resize(frame, (68, height), interpolation=cv2.INTER_AREA)
                if previous is not None:
                    offsets.append(vertical_offset(previous, stripe, cv2, np))
                previous = stripe
            if decoder.stdout.read(1):
                raise ValueError("More decoded frames than Winscope timestamps")
            if decoder.wait() != 0:
                raise ValueError("Video decoder failed")
        finally:
            if decoder.poll() is None:
                decoder.kill()
    return offsets


def classify(times, offsets, direction, boundaries, period):
    """Identify a static run bounded by translations in the same requested direction."""
    if len(times) != len(offsets) + 1 or direction not in ('down', 'up'):
        raise ValueError("One offset per neighboring pair and a scroll direction required")
    if boundaries is None:
        return {"status": "unknown", "reason": "unmatchedInputOrScroll"}
    down, up, end = boundaries
    sign = -1 if direction == 'down' else 1
    phases = []
    intervals = []
    for i, offset in enumerate(offsets):
        left, right = times[i:i + 2]
        if not down <= left < right <= end:
            continue
        value = None if right - left > 2.5 * period or offset is None else sign * offset
        intervals.append((left, right, value))
    moving = [i for i, (_, _, value) in enumerate(intervals) if value is not None and value >= 2]
    if len(moving) < 2 or intervals[moving[-1]][1] - intervals[moving[0]][0] < 50_000_000:
        return {"status": "unknown", "reason": "insufficientDirectionalTexture", "sampledMovingPairs": len(moving)}
    uncertain = False
    spans = []
    for first, last in zip(moving, moving[1:]):
        between = intervals[first + 1:last]
        if not between:
            continue
        if any(v is not None and v < 0 for _, _, v in between):
            # A verified direction change ends this movement.
            continue
        quiet_start = possibly_quiet_start = None
        quiet_count = 0
        for left, right, value in between:
            if value is None or value == 0:
                if possibly_quiet_start is None:
                    possibly_quiet_start = left
                if right - possibly_quiet_start >= 50_000_000:
                    uncertain = True
            else:
                possibly_quiet_start = None
            if value != 0:
                quiet_start, quiet_count = None, 0
                continue
            if quiet_start is None:
                quiet_start = left
            quiet_count += 1
            if quiet_count >= 2 and right - quiet_start >= 50_000_000:
                phase = "touch" if right <= up else "inertia" if quiet_start >= up else "touchToInertia"
                phases.append(phase)
                spans.append((right - quiet_start) / 1e6)
    if spans:
        return {"status": "confirmedStall", "phases": sorted(set(phases)), "longestConfirmedMs": round(max(spans), 2)}
    # At either edge a contiguous unobserved stretch can hide a directional bracket.
    for edge in (intervals[:moving[0]], intervals[moving[-1] + 1:]):
        missing_start = None
        for left, right, value in edge:
            if value is None:
                if missing_start is None:
                    missing_start = left
                uncertain |= right - missing_start >= 50_000_000
            else:
                missing_start = None
    if uncertain:
        return {"status": "unknown", "reason": "captureGapOrAmbiguousTexture"}
    return {"status": "noObservedStall", "sampledMovingPairs": len(moving)}


def counts(rows):
    totals = Counter(r["status"] for r in rows)
    total = len(rows)
    known, unknown = totals["confirmedStall"], totals["unknown"]
    phases = Counter(p for row in rows for p in row.get("phases", ()))
    return {"gestures": total, "confirmed": known, "noObserved": totals["noObservedStall"], "unknown": unknown,
            "confirmedByPhase": dict(phases),
            "per100Bounds": [round(known * 100 / total, 2), round((known + unknown) * 100 / total, 2)] if total else None}


def analyze(manifest, processor, ffmpeg, region):
    import cv2
    import numpy as np
    cv2.setNumThreads(1)
    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
    rows, clips = [], []
    period = 1e9 / data["hz"]
    for entry in data["clips"]:
        clip = manifest.parent / entry["video"]
        trace = manifest.parent / entry["trace"]
        clock = query(processor, trace, "SELECT int_value FROM metadata WHERE name='trace_time_clock_id'")
        if len(clock) != 1 or int(clock[0]["int_value"]) != 6:
            raise ValueError("Perfetto and Winscope must both use BOOTTIME")
        errors = query(processor, trace, "SELECT name,value FROM stats WHERE value>0 AND severity IN ('data_loss','error')")
        cadence_samples = query(processor, trace, """
          SELECT DISTINCT e.ts,e.dur FROM expected_frame_timeline_slice e JOIN process p USING(upid)
          WHERE p.name GLOB '*surfaceflinger' AND e.surface_frame_token IS NULL ORDER BY e.ts
        """)
        cadence = target_cadence([(int(r["ts"]), int(r["dur"])) for r in cadence_samples], period)
        events = gesture_events(processor, trace, data["pid"])
        presented, unresolved = app_presentations(processor, trace, data["pid"])
        times = frame_times_ns(clip.read_bytes())
        clips.append({"clip": entry["video"], "frames": len(times), "displayTargetCadence": cadence, "traceErrors": errors})
        offsets = clip_offsets(clip, ffmpeg, region, len(times), cv2, np)
        actions = entry["actions"]
        for i, action in enumerate(actions):
            end = actions[i + 1]["commandMarkerNs"] - 1 if i + 1 < len(actions) else min(times[-1], events["coverage"][1])
            active = phase_boundaries(events, action["commandMarkerNs"], end)
            bounds = active
            if bounds:
                down, up, last = bounds
                if times[0] <= down and times[-1] >= up:
                    # Allow display latency after the final onScrollChanged callback, never
                    # extend into the next gesture. Motion on both sides is still required.
                    bounds = down, up, min(end, last + 80_000_000, times[-1])
                else:
                    bounds = None
            result = classify(times, offsets, action["direction"], bounds, period)
            pacing = present_gaps(presented, unresolved, events["scroll"], active, times, offsets, action["direction"], period)
            if not cadence["fixedPeriodVerified"]:
                result = {"status": "unknown", "reason": "unverifiedDisplayCadence"}
                for gap in pacing.get("gaps", ()):
                    gap["directionalPixelsBothSides"] = None
            rows.append({"clip": entry["video"], "gesture": i + 1, "direction": action["direction"], "displayPacing": pacing, **result})
    return {"apkSha256": data["apkSha256"], "roiAt540x1200": region, "total": counts(rows),
            "displayPacing": display_counts(rows), "directions": {d: counts([r for r in rows if r["direction"] == d]) for d in ("down", "up")},
            "clips": clips, "actions": rows}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("manifest", type=Path)
    cli.add_argument("--processor", required=True, type=Path)
    cli.add_argument("--ffmpeg", default="ffmpeg")
    cli.add_argument("--region", nargs=4, type=int, default=(70, 255, 400, 650))
    args = cli.parse_args()
    print(json.dumps(analyze(args.manifest, args.processor, args.ffmpeg, args.region), indent=2))


if __name__ == "__main__":
    main()
