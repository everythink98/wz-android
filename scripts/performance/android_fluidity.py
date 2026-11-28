"""Read-only Android return/scroll analysis. Pass a trace_processor executable or its Python launcher."""

import argparse
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
import csv
import io
import json
import math
from pathlib import Path
import shutil
import statistics
import subprocess
import sys


def integer(value):
    number = int(value)
    if str(number) != str(value) or number < 0:
        raise ValueError("Expected a nonnegative integer")
    return number


def optional_int(value):
    return None if value in (None, "", "[NULL]") else int(value)


def percentile(values, fraction):
    return round(sorted(values)[math.ceil(len(values) * fraction) - 1], 2) if values else None


def query(processor, trace, sql, *, full_sort=False):
    path = str(processor)
    with Path(path).open("rb") as header:
        is_script = header.read(2) == b"#!"
    if path.endswith(".py") or is_script:
        command = [sys.executable, path]
    else:
        command = [path]
    sorting = ["--full-sort"] if full_sort else []
    result = subprocess.run([*command, "query", *sorting, "--format", "csv", str(trace), sql],
                            capture_output=True, encoding="utf-8", check=True)
    return list(csv.DictReader(io.StringIO(result.stdout)))


def target_cadence(samples, period):
    targets = sorted({ts for ts, _ in samples})
    deltas = [b-a for a, b in zip(targets, targets[1:])]
    tolerance = min(500_000, .045 * period)
    singles = sum(abs(d - period) <= tolerance for d in deltas)
    off_grid = sum(abs(d - max(1, round(d / period)) * period) > tolerance for d in deltas if d < 50_000_000)
    budgets = Counter(round(d / 1e6, 3) for _, d in samples)
    counts = Counter(f"{d/1e6:.1f}" if d < 50_000_000 else ">=50" for d in deltas)
    verified = singles >= 3 and off_grid == 0 and len(budgets) == 1
    return {"intervals": len(deltas), "nominalSinglePeriods": singles, "shortOffGridPeriods": off_grid,
            "intervalMsCounts": dict(counts), "expectedBudgetMsCounts": dict(budgets), "fixedPeriodVerified": verified}


def measured_cadence(processor, trace, bounds, period):
    if not bounds:
        return {}
    values = ",".join(f"({integer(i)},{integer(back)},{integer(pid)})" for i, back, pid in bounds)
    rows = query(processor, trace, f"""
        WITH inputs(n,back,pid) AS (VALUES {values})
        SELECT DISTINCT i.n, CASE WHEN e.surface_frame_token IS NULL THEN 'display' ELSE 'app' END kind,e.ts,e.dur
        FROM inputs i JOIN expected_frame_timeline_slice e ON e.ts>=i.back AND e.ts<i.back+1100000000
        JOIN process p USING(upid)
        WHERE (p.name GLOB '*surfaceflinger' AND e.surface_frame_token IS NULL)
           OR (p.pid=i.pid AND p.name='com.wz.reader' AND e.layer_name GLOB '*MainActivity*')
        ORDER BY n,kind,ts
    """)
    samples = defaultdict(list)
    for row in rows:
        samples[int(row["n"]), row["kind"]].append((int(row["ts"]), int(row["dur"])))
    return {n: {k: target_cadence(samples[n, k], period) for k in ("display", "app")} for n, *_ in bounds}


def missed_target_pairs(ordered, period):
    return [(a, b) for a, b in zip(ordered, ordered[1:])
            if 0.5 * period < int(b['vsync_ns']) - int(a['vsync_ns']) < 1.5 * period
            and all('App Deadline Missed' in row['jank_type'] for row in (a, b))]


def presentation_pair_details(pairs, delivered, back):
    presented = {row['token']: int(row['shown']) for row in delivered}
    order = {at: index for index, at in enumerate(sorted(set(presented.values())))}

    def frame(row, at):
        return {'token': int(row['token']), 'targetAfterBackMs': round((int(row['vsync_ns']) - back) / 1e6, 3),
                'startAfterBackMs': round((int(row['app_start']) - back) / 1e6, 3),
                'appDurationMs': round(int(row['app_duration']) / 1e6, 3), 'appType': row['app_type'],
                'appJank': row['jank_type'], 'presentAfterBackMs': round((at - back) / 1e6, 3) if at is not None else None,
                'displayType': row['display_type'] if at is not None else None}

    details = []
    for first, second in pairs:
        a, b = presented.get(first['token']), presented.get(second['token'])
        both_presented = a is not None and b is not None
        details.append({'first': frame(first, a), 'second': frame(second, b),
                        'signedPresentationDeltaMs': round((b - a) / 1e6, 3) if both_presented else None,
                        'adjacentInPresentationOrder': order[b] == order[a] + 1 if both_presented else None})
    return details


def deadline_windows(frames, period, windows):
    """Keep both ends inside the same window so a tap or a quiet gap cannot bridge phases."""
    timed = sorted(((int(row["vsync_ns"]), row) for row in frames if optional_int(row["vsync_ns"]) is not None),
                   key=lambda item: (item[0], int(item[1]["token"])))
    complete_targets = len(timed) == len(frames)
    pairs = missed_target_pairs([row for _, row in timed], period)
    presented = sorted({int(row["shown"]) for row in frames})
    result = {}
    for name, lo, hi in windows:
        if hi <= lo:
            continue
        selected = [row for at, row in timed if at is not None and lo <= at < hi]
        adjacent = sum(lo <= int(a['vsync_ns']) and int(b['vsync_ns']) < hi for a, b in pairs)
        observed = presented[bisect_left(presented, lo):bisect_left(presented, hi)]
        gaps = [b - a for a, b in zip(observed, observed[1:])]
        result[name] = {"presentedFramesWithExpectedVsync": len(selected), "expectedAdjacentPresentedMissPairs": adjacent if complete_targets else None,
                        "distinctPresentations": len(observed), "maxPresentedGapMs": round(max(gaps) / 1e6, 3) if gaps else None}
    return result


def return_round(frames, period, action=None):
    first = frames[0]
    back = optional_int(first["back_ns"])
    if int(first["inputs"]) != 1 or back is None:
        return {"valid": False, "reason": "Back input missing or ambiguous"}
    if int(first["trace_end"]) < back + 1_100_000_000:
        return {"valid": False, "reason": "Window truncated"}
    app_frames = [row for row in frames if optional_int(row["token"]) is not None]
    tokens = [row["token"] for row in app_frames]
    if len(tokens) != len(set(tokens)):
        return {"valid": False, "reason": "Ambiguous MainActivity surface token"}
    unfinished = [row for row in app_frames if (optional_int(row["app_duration"]) or 0) <= 0]
    app_frames = [row for row in app_frames if (optional_int(row["app_duration"]) or 0) > 0]
    dropped = [row for row in app_frames if "Dropped" in row["app_type"] or "Dropped" in str(row["display_type"])]
    delivered = [row for row in app_frames if row not in dropped]
    if not delivered or any(optional_int(row["display_matches"]) != 1 for row in delivered):
        return {"valid": False, "reason": "Missing or ambiguous SurfaceFlinger presentation"}
    delivered.sort(key=lambda row: (int(row["shown"]), int(row["app_start"])))
    pairs = [(a, b) for a, b in zip(delivered, delivered[1:])
             if all("App Deadline Missed" in row["jank_type"] for row in (a, b))]
    expected_complete = all(optional_int(row["vsync_ns"]) is not None for row in delivered)
    # Sort by target vsync and include intervening dropped frames for application cadence.
    # The historical comparison sorted only delivered records by presentation.
    legacy = sum(0 < int(b["app_start"]) - int(a["app_start"]) < 1.55 * period for a, b in pairs)
    shown = [int(row["shown"]) for row in delivered]
    all_expected = all(optional_int(row["vsync_ns"]) is not None for row in app_frames)
    def vsync_order(row):
        return int(row["vsync_ns"]), int(row["token"])
    by_vsync = sorted(app_frames, key=vsync_order) if all_expected else []
    delivered_by_vsync = sorted(delivered, key=vsync_order) if expected_complete else []
    boundaries = (0, 100, 400, 500, 1100)
    windows = [(f"{a}-{b}ms", back + a * 1_000_000, back + b * 1_000_000) for a, b in zip(boundaries, boundaries[1:])]
    fixed = deadline_windows(delivered, period, windows)
    phases = []
    end = back + 1_100_000_000
    tap = optional_int(first.get("touch_down_ns")) or optional_int(first.get("touch_up_ns"))
    phase_end = tap if tap is not None else end
    start_animation = end_animation = None
    boundary_evidence = "unobserved"
    if optional_int(first.get("starts")) == 1 and optional_int(first.get("ends")) == 1 and optional_int(first.get("clears")) == 0:
        start_animation, end_animation = optional_int(first["start_ns"]), optional_int(first["end_ns"])
        boundary_evidence = "nativeTopicPopAnimation"
    elif not optional_int(first.get("clears")) and (optional_int(first.get("progress_events")) or 0) > 1 and (
            optional_int(first.get("finish_events")) == 1 and optional_int(first.get("dismiss_events")) == 1):
        start_animation, end_animation = optional_int(first["first_progress_ns"]), optional_int(first["finish_ns"])
        boundary_evidence = "rnsFirstProgressToFinishCallback"
    elif (action or {}).get("observedChromeMotion"):
        projection = action["observedChromeMotion"]
        start_animation, end_animation = integer(projection["startNs"]), integer(projection["settledNs"])
        boundary_evidence = "winscopeObservedRegions"
    if start_animation is not None and end_animation is not None and back <= start_animation < end_animation <= end:
        if boundary_evidence == "winscopeObservedRegions":
            names = ("beforeObservedMotion", "observedRegionMotion", "afterRegionsSettledBeforeTap")
        else:
            names = ("beforeTransition", "transition", "afterTransitionBeforeTap")
        phases.extend([(names[0], back, min(start_animation, phase_end)),
                       (names[1], start_animation, min(end_animation, phase_end)),
                       (names[2], end_animation, phase_end)])
    else:
        boundary_evidence = "unobserved"
        start_animation = end_animation = None
        phases.append(("unresolvedTransitionBoundary", back, phase_end))
    if tap is not None:
        probe = isinstance((action or {}).get("searchVisibleAfterTap"), bool)
        phases.append(("afterProbeTap" if probe else "afterOtherTouch", tap, end))
    marked = deadline_windows(delivered, period, phases)
    # Report boundary/edge pairs separately, including a pre-input target dispatched after Back.
    total_pairs = len(missed_target_pairs(delivered_by_vsync, period)) if expected_complete else None
    all_missed_pairs = missed_target_pairs(by_vsync, period) if all_expected else None
    distinct_presentations = sorted({at for at in shown if back <= at < end})
    presentation_gaps = [b - a for a, b in zip(distinct_presentations, distinct_presentations[1:])]
    first_target = optional_int(delivered[0]["vsync_ns"])
    first_start = int(delivered[0]["app_start"])
    def outside(windows):
        return total_pairs - sum(item["expectedAdjacentPresentedMissPairs"] for item in windows.values()) if total_pairs is not None else None
    return {
        "valid": True, "backUpNs": back, "firstMainActivityDeltaNs": shown[0] - back,
        "firstMainActivityPresentMs": round((shown[0] - back) / 1e6, 3),
        "firstAppStartAfterBackMs": round((first_start - back) / 1e6, 3),
        "firstAppStartToPresentMs": round((shown[0] - first_start) / 1e6, 3),
        "firstAppTargetAfterBackMs": round((first_target-back)/1e6, 3) if first_target is not None else None,
        "firstAppStartMinusTargetMs": round((first_start-first_target)/1e6, 3) if first_target is not None else None,
        "firstAppTimelineDurationMs": round(int(delivered[0]["app_duration"]) / 1e6, 3),
        "maxPresentedGapMsFullWindow": round(max(presentation_gaps) / 1e6, 3) if presentation_gaps else None,
        "presentedFrames": len(shown), "droppedFrames": len(dropped), "unfinishedFrames": len(unfinished),
        "firstMayBeCensored": any(int(row["app_start"]) < shown[0] for row in unfinished),
        "legacyAdjacentMissPairs": legacy,
        "expectedAdjacentPresentedMissPairs": total_pairs,
        "expectedAdjacentAllAppMissPairs": len(all_missed_pairs) if all_missed_pairs is not None else None,
        "missedTargetPairDetails": presentation_pair_details(all_missed_pairs, delivered, back) if all_missed_pairs is not None else None,
        "surfaceLatePairsAmongLegacyMisses": sum(
            0 < int(b["app_start"]) - int(a["app_start"]) < 1.55 * period and
            all("Late" in str(row["display_type"]) for row in (a, b)) for a, b in pairs),
        "afterBackWindows": fixed, "fixedWindowBoundaryOrOutsidePairs": outside(fixed), "phaseBoundaryEvidence": boundary_evidence,
        "transitionStartAfterBackMs": round((start_animation - back) / 1e6, 3) if start_animation is not None else None,
        "transitionEndAfterBackMs": round((end_animation - back) / 1e6, 3) if end_animation is not None else None,
        "phaseWindows": marked, "phaseBoundaryOrOutsidePairs": outside(marked),
    }


def analyze_returns(data, period, trace, processor):
    records = data["records"]
    markers = ",".join(f"({n},{integer(row['commandMarkerNs'])},{integer(row['pid'])})"
                       for n, row in enumerate(records, 1))
    sql = Path(__file__).with_name("android_return_frames.sql").read_text(encoding="utf-8")
    grouped = defaultdict(list)
    for row in query(processor, trace, sql.format(markers=markers)):
        grouped[int(row["round"])].append(row)
    if set(grouped) != set(range(1, len(records) + 1)):
        raise ValueError("Incomplete action markers")
    bounds = [(n, int(frames[0]["back_ns"]), records[n - 1]["pid"]) for n, frames in grouped.items()
              if int(frames[0]["inputs"]) == 1]
    cadence = measured_cadence(processor, trace, bounds, period)
    rounds = []
    for n, record in enumerate(records, 1):
        frames = grouped[n]
        result = return_round(frames, period, record)
        if n in cadence:
            result["targetCadence"] = cadence[n]
            result["eligibleForFixedHzGate"] = result["valid"] and all(d["fixedPeriodVerified"] for d in cadence[n].values())
        if isinstance(record.get("searchVisibleAfterTap"), bool):
            first = frames[0]
            if int(first["inputs"]) != 1 or int(first["touch_ups"]) != 1:
                result["interaction"] = {"valid": False, "reason": "Expected unique Back-UP and Search tap-UP"}
            else:
                after = (int(first["touch_up_ns"]) - int(first["back_ns"])) / 1e6
                result["interaction"] = {"valid": True, "searchVisibleAfterTap": record["searchVisibleAfterTap"],
                                         "testedTapAfterBackMs": round(after, 3)}
        rounds.append(result)
    batches = []
    for offset in range(0, len(rounds), 10):
        batch = rounds[offset:offset + 10]
        valid = [row for row in batch if row["valid"]]
        firsts = [row["firstMainActivityDeltaNs"] / 1e6 for row in valid]
        result = {"rounds": len(batch), "valid": len(valid), "firstP50Ms": round(statistics.median(firsts), 2) if firsts else None,
                  "firstP95Ms": percentile(firsts, .95), "fixedHzVerifiedRounds": sum(r.get("eligibleForFixedHzGate", False) for r in batch)}
        for metric in ("legacyAdjacentMissPairs", "expectedAdjacentPresentedMissPairs", "expectedAdjacentAllAppMissPairs",
                       "droppedFrames", "unfinishedFrames", "firstMayBeCensored", "surfaceLatePairsAmongLegacyMisses"):
            result[metric] = sum(row[metric] for row in valid) if valid and all(row[metric] is not None for row in valid) else None
        if result["fixedHzVerifiedRounds"] != len(batch):
            # Do not publish a nominal-rate miss total as a verified gate on mixed/sparse clocks.
            result["expectedAdjacentPresentedMissPairs"] = None
            result["expectedAdjacentAllAppMissPairs"] = None
        batches.append(result)
    return {"batches": batches, "rounds": rounds}


def gesture_events(processor, trace, pid):
    rows = query(processor, trace, f"""
      SELECT s.ts, CASE WHEN s.name GLOB '*action=DOWN)' THEN 'down'
                        WHEN s.name GLOB '*action=UP)' THEN 'up' ELSE 'cancel' END AS event
      FROM slice s WHERE s.name GLOB 'publishMotionEvent(inputChannel=*com.wz.reader.MainActivity (server), action=*)'
        AND (s.name GLOB '*action=DOWN)' OR s.name GLOB '*action=UP)' OR s.name GLOB '*action=CANCEL)')
      UNION ALL
      SELECT s.ts, 'scroll' FROM slice s JOIN thread_track tt ON tt.id=s.track_id
        JOIN thread t USING (utid) JOIN process p USING (upid)
      WHERE p.pid={integer(pid)} AND t.tid=p.pid AND s.name LIKE '%ReactScrollView.onScrollChanged%'
      ORDER BY ts
    """)
    events = defaultdict(list)
    for row in rows:
        events[row["event"]].append(int(row["ts"]))
    bounds = query(processor, trace, "SELECT start_ts,end_ts FROM trace_bounds")[0]
    events["coverage"] = (int(bounds["start_ts"]), int(bounds["end_ts"]))
    return events


def phase_boundaries(events, begin, end):
    # A shell uptime marker can round down by 10 ms. Require one complete app-delivered gesture.
    coverage = events.get("coverage")
    if coverage and not (coverage[0] <= begin < end <= coverage[1]):
        return None
    downs = events["down"]
    index = bisect_left(downs, begin)
    if index >= len(downs) or downs[index] > end or (index + 1 < len(downs) and downs[index + 1] <= end):
        return None
    down = downs[index]
    up_index = bisect_right(events["up"], down)
    if up_index == len(events["up"]) or events["up"][up_index] > end:
        return None
    up = events["up"][up_index]
    if any(down < ts < up for ts in events["cancel"]):
        return None
    changes = events["scroll"]
    if bisect_left(changes, down) == bisect_right(changes, end):
        return None
    after = changes[bisect_right(changes, up):bisect_right(changes, end)]
    return down, up, (after[-1] if after else up)


def summarize_frames(frames, period):
    ordered = sorted(frames.values(), key=lambda pair: pair[1]["IntendedVsync"])
    costs = [(f["FrameCompleted"] - f["IntendedVsync"]) / 1e6 for _, f in ordered]
    long_actions = {action for (action, _), cost in zip(ordered, costs) if cost >= 50}
    def missed(frame):
        return frame["IntendedVsync"] < frame["FrameDeadline"] < frame["FrameCompleted"]
    pairs = sum(i == j and 0.5 * period < b["IntendedVsync"] - a["IntendedVsync"] < 1.5 * period
                and missed(a) and missed(b) for (i, a), (j, b) in zip(ordered, ordered[1:]))
    return {"frames": len(costs), "p95Ms": percentile(costs, .95), "p99Ms": percentile(costs, .99),
            "worstMs": round(max(costs), 3) if costs else None,
            "over35": sum(cost > 35 for cost in costs), "over50": sum(cost > 50 for cost in costs),
            "intendedAdjacentMissPairs": pairs, "actionsWithFrameAtLeast50Ms": len(long_actions)}


def long_scroll_frame(frame, action, number, direction, phase):
    """Report wall time between recorded gfxinfo markers, in the clock of this frame."""
    target, completed = frame["IntendedVsync"], frame["FrameCompleted"]
    deadline = frame["FrameDeadline"]
    stages = {}
    for name, begin, end in (
        ("targetToInput", "IntendedVsync", "HandleInputStart"),
        ("inputToAnimation", "HandleInputStart", "AnimationStart"),
        ("animationToTraversal", "AnimationStart", "PerformTraversalsStart"),
        ("traversalToDraw", "PerformTraversalsStart", "DrawStart"),
        ("drawToSyncQueue", "DrawStart", "SyncQueued"),
        ("renderQueueWait", "SyncQueued", "SyncStart"),
        ("renderSyncToIssue", "SyncStart", "IssueDrawCommandsStart"),
        ("issueToSubmission", "IssueDrawCommandsStart", "CommandSubmissionCompleted"),
        ("submissionToGpuComplete", "CommandSubmissionCompleted", "GpuCompleted"),
    ):
        start, stop = frame.get(begin), frame.get(end)
        if start is not None and stop is not None and target <= start <= stop <= completed:
            stages[name] = round((stop - start) / 1e6, 3)
    return {"cycle": action["leg"] // 2 + 1, "direction": direction, "actionInVisit": number + 1,
            "actionInLeg": action.get("number"), "phase": phase, "intendedVsyncNs": target,
            "durationMs": round((completed - target) / 1e6, 3),
            "deadlineBudgetMs": round((deadline - target) / 1e6, 3) if target < deadline < 2**63 - 1 else None,
            "stageMs": stages}


def analyze_scroll(data, period, trace, processor):
    events = gesture_events(processor, trace, data["pid"]) if trace else None
    visits = []
    for visit in data["records"]:
        directions, phases, cycles = defaultdict(dict), defaultdict(dict), defaultdict(lambda: defaultdict(dict))
        long_frames = []
        duplicates = matched = quiet_windows = quiet_ns = 0
        for number, action in enumerate(visit["actions"]):
            begin, end = action["begin"], action["end"]
            bounds = phase_boundaries(events, begin, end) if events else None
            matched += bounds is not None
            if bounds and end >= bounds[2] + 100_000_000:
                quiet_windows += 1
                quiet_ns += end - bounds[2] - 100_000_000
            direction = "up" if action["leg"] % 2 else "down"
            for frame in action["frames"]:
                at = frame["IntendedVsync"]
                if at in directions[direction]:
                    duplicates += 1
                    continue
                directions[direction][at] = (number, frame)
                cycles[action["leg"] // 2 + 1][direction][at] = (number, frame)
                phase = "unknown"
                if bounds:
                    down, up, last_scroll = bounds
                    if down <= at <= up:
                        phase = "touch"
                    elif up < at <= last_scroll:
                        phase = "inertia"
                    elif at >= last_scroll + 100_000_000 and at <= end:
                        phase = "observedQuiet"
                phases[(direction, phase)][at] = (number, frame)
                if frame["FrameCompleted"] - at >= 50_000_000:
                    long_frames.append(long_scroll_frame(frame, action, number, direction, phase))
        visits.append({"visit": visit["i"], "actions": len(visit["actions"]), "phaseMatchedActions": matched,
                       "observedQuietWindows": quiet_windows, "observedQuietMs": round(quiet_ns / 1e6, 2),
                       "duplicateFrames": duplicates, "longAppFrames": long_frames,
                       "directions": {name: summarize_frames(entries, period) for name, entries in directions.items()},
                       "cycles": {cycle: {direction: summarize_frames(entries, period) for direction, entries in entries_by_direction.items()}
                                  for cycle, entries_by_direction in cycles.items()},
                       "phases": {f"{direction}.{phase}": summarize_frames(entries, period)
                                  for (direction, phase), entries in phases.items()},
                       "pssBeforeKiB": visit["before"]["pssKiB"],
                       "pssAfter": [{"seconds": r["seconds"], "pssKiB": r["pssKiB"],
                                     "deltaKiB": r["pssKiB"] - visit["before"]["pssKiB"]} for r in visit["after"]]})
    return {"visits": visits}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("scenario", choices=["returns", "scroll"])
    cli.add_argument("actions", type=Path, help="Capture JSON containing APK SHA, Hz, PID and action markers")
    cli.add_argument("--trace", type=Path, help="Matching Perfetto trace. Required for returns and scroll phase attribution")
    cli.add_argument("--processor", type=Path, help="Perfetto trace_processor executable or Python launcher")
    args = cli.parse_args()
    processor = args.processor or shutil.which("trace_processor")
    if args.scenario == "returns" and not args.trace:
        cli.error("returns requires --trace")
    if args.trace and not processor:
        cli.error("pass --processor or provide trace_processor on PATH")
    if args.trace:
        clock = query(processor, args.trace, "SELECT int_value FROM metadata WHERE name='trace_time_clock_id'")
        if [row["int_value"] for row in clock] != ["6"]:
            cli.error("Device input and screenrecord require a confirmed BOOTTIME trace clock")
    data = json.loads(args.actions.read_text(encoding="utf-8-sig"))
    if not (math.isfinite(data["hz"]) and data["hz"] > 0 and data["records"]):
        cli.error("missing refresh rate or action records")
    period = 1e9 / data["hz"]
    report = analyze_returns(data, period, args.trace, processor) if args.scenario == "returns" else analyze_scroll(data, period, args.trace, processor)
    if args.trace:
        report["traceErrors"] = query(processor, args.trace, "SELECT name,value FROM stats WHERE value>0 AND severity IN ('data_loss','error')")
    print(json.dumps({"apkSha256": data["apkSha256"], "refreshHz": data["hz"], **report}, indent=2))


if __name__ == "__main__":
    main()
