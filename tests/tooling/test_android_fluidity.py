"""Run with python -B tests/tooling/test_android_fluidity.py (no Android device required)."""

from collections import defaultdict
from importlib.util import find_spec
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "performance"))
from android_fluidity import analyze_scroll, deadline_windows, phase_boundaries, return_round, target_cadence
from android_return_pixels import first_feed_frame, frame_times_ns
from android_scroll_pixels import classify, counts, present_gaps, vertical_offset


def frame(token, start, expected, shown, app_type="Late Present"):
    return dict(inputs="1", back_ns="1000000000", trace_end="3000000000", token=str(token),
                app_start=1_000_000_000 + start, app_duration=5_000_000,
                vsync_ns=1_000_000_000 + expected, jank_type="App Deadline Missed",
                app_type=app_type, display_type="On-time Present", display_matches=1,
                shown=1_000_000_000 + shown)


class FluidityTests(unittest.TestCase):
    def test_long_scroll_frames_identify_the_gesture_even_with_a_later_deadline(self):
        ms = 1_000_000
        first = {"IntendedVsync": 100 * ms, "FrameDeadline": 210 * ms, "FrameCompleted": 150 * ms,
                 "CommandSubmissionCompleted": 104 * ms, "GpuCompleted": 149 * ms}
        shorter = {"IntendedVsync": 111 * ms, "FrameDeadline": 143 * ms, "FrameCompleted": 161 * ms - 1}
        actions = [{"leg": 1, "number": 9, "begin": 0, "end": 200 * ms, "frames": [first, shorter]},
                   {"leg": 1, "number": 10, "begin": 200 * ms, "end": 300 * ms, "frames": [first]}]
        visit = {"i": 2, "actions": actions, "before": {"pssKiB": 200}, "after": []}
        result = analyze_scroll({"records": [visit]}, 11.111 * ms, None, None)["visits"][0]
        self.assertEqual(result["duplicateFrames"], 1)
        self.assertEqual(result["directions"]["up"]["actionsWithFrameAtLeast50Ms"], 1)
        self.assertEqual(result["longAppFrames"], [{"cycle": 1, "direction": "up", "actionInVisit": 1,
            "actionInLeg": 9, "phase": "unknown", "intendedVsyncNs": 100 * ms, "durationMs": 50.0,
            "deadlineBudgetMs": 110.0, "stageMs": {"submissionToGpuComplete": 45.0}}])

    def test_long_scroll_frames_omit_unavailable_or_invalid_stage_timestamps(self):
        ms = 1_000_000
        slow = {"IntendedVsync": 100 * ms, "FrameCompleted": 165 * ms, "FrameDeadline": 0,
                "SyncQueued": 113 * ms, "SyncStart": 112 * ms, "IssueDrawCommandsStart": 128 * ms,
                "CommandSubmissionCompleted": 148 * ms, "GpuCompleted": 2**63 - 1}
        action = {"leg": 2, "begin": 0, "end": 200 * ms, "frames": [slow]}
        visit = {"i": 1, "actions": [action], "before": {"pssKiB": 200}, "after": []}
        row = analyze_scroll({"records": [visit]}, 11.111 * ms, None, None)["visits"][0]["longAppFrames"][0]
        self.assertIsNone(row["deadlineBudgetMs"])
        self.assertIsNone(row["actionInLeg"])
        self.assertEqual((row["cycle"], row["direction"], row["stageMs"]),
                         (2, "down", {"renderSyncToIssue": 16.0, "issueToSubmission": 20.0}))

    def test_pixel_pause_requires_the_same_direction_on_both_sides(self):
        ms = 1_000_000
        times = [i * 10 * ms for i in range(10)]
        window = (0, 60 * ms, 90 * ms)
        pause = classify(times, [-6] + [0] * 6 + [-5, -3], "down", window, 10 * ms)
        self.assertEqual((pause["status"], pause["longestConfirmedMs"]), ("confirmedStall", 60))
        self.assertIn("touchToInertia", pause["phases"])
        long_times = [i * 10 * ms for i in range(15)]
        long_window = (0, 60 * ms, 140 * ms)
        coast = classify(long_times, [-6] * 7 + [0] * 7, "down", long_window, 10 * ms)
        self.assertEqual(coast["status"], "noObservedStall")
        reverse = classify(long_times, [-6] * 7 + [0] * 6 + [4], "down", long_window, 10 * ms)
        self.assertEqual(reverse["status"], "noObservedStall")
        edge = classify(long_times, [None] * 6 + [-6] * 8, "down", long_window, 10 * ms)
        self.assertEqual(edge["status"], "unknown")

    @unittest.skipUnless(find_spec("cv2") and find_spec("numpy"), "install the optional pixel tracker dependencies")
    def test_position_match_requires_texture_at_two_heights(self):
        import cv2
        import numpy as np
        image = np.random.default_rng(42).integers(0, 256, size=(650, 68), dtype=np.uint8)
        self.assertEqual(vertical_offset(image, np.roll(image, 36, axis=0), cv2, np), 36)
        self.assertEqual(vertical_offset(image, image, cv2, np), 0)
        self.assertIsNone(vertical_offset(np.zeros_like(image), image, cv2, np))
        different = image.copy()
        different[:325] = np.roll(different[:325], 36, axis=0)
        self.assertIsNone(vertical_offset(image, different, cv2, np))

    def test_video_gap_and_indistinct_texture_remain_unknown(self):
        ms = 1_000_000
        times = [0, 10 * ms, 70 * ms, 80 * ms, 90 * ms]
        window = (0, 50 * ms, 90 * ms)
        gap = classify(times, [3, 0, 4, 8], "up", window, 10 * ms)
        flat = classify(times, [None] * 4, "up", window, 10 * ms)
        self.assertEqual((gap["status"], flat["status"]), ("unknown", "unknown"))
        self.assertEqual(counts([gap, flat, {"status": "confirmedStall"}, {"status": "noObservedStall"}])["per100Bounds"], [25, 75])

    def test_display_gap_counts_only_completed_presentations_during_real_scroll(self):
        ms = 1_000_000
        times = [i * 10 * ms for i in range(14)]
        presented = [10 * ms, 20 * ms, 80 * ms, 90 * ms, 130 * ms]
        pacing = present_gaps(presented, [], [21 * ms, 35 * ms, 110 * ms], (0, 45 * ms, 115 * ms),
                              times, [-3] * 13, "down", 10 * ms)
        self.assertEqual((pacing["distinctPresentations"], pacing["maxMs"]), (4, 60))
        self.assertEqual(pacing["gaps"], [{"ms": 60, "phase": "touchToInertia", "scrollCallbacksInside": 2,
                                            "directionalPixelsBothSides": True}])
        unknown = present_gaps(presented, [65 * ms], [], (0, 45 * ms, 115 * ms), times, [-3] * 13, "down", 10 * ms)
        self.assertEqual(unknown["status"], "unknown")

    def test_actual_start_is_not_expected_vsync_and_dropped_is_not_presented(self):
        period = 10_000_000
        samples = [frame(1, period, period, 5 * period), frame(2, 2 * period, 2 * period, 6 * period, "Dropped Frame"),
                   frame(3, 2 * period, 3 * period, 7 * period)]
        metrics = return_round(samples, period)
        self.assertEqual((metrics["firstMainActivityPresentMs"], metrics["droppedFrames"],
                          metrics["legacyAdjacentMissPairs"], metrics["expectedAdjacentPresentedMissPairs"],
                          metrics["expectedAdjacentAllAppMissPairs"], metrics["surfaceLatePairsAmongLegacyMisses"]),
                         (50, 1, 1, 0, 2, 0))
        self.assertEqual((metrics["firstAppStartAfterBackMs"], metrics["firstAppStartToPresentMs"],
                          metrics["firstAppTimelineDurationMs"]), (10, 40, 5))
        self.assertEqual((metrics["firstAppTargetAfterBackMs"], metrics["firstAppStartMinusTargetMs"]), (10, 0))

    def test_expected_cycle_order_survives_reordered_and_shared_presentation(self):
        ms = 1_000_000
        ordered = [frame(1, 10 * ms, 10 * ms, 20 * ms), frame(2, 20 * ms, 20 * ms, 43 * ms),
                   frame(3, 30 * ms, 30 * ms, 20 * ms)]
        round_metrics = return_round(ordered, 10 * ms)
        fixed = round_metrics["afterBackWindows"]["0-100ms"]
        self.assertEqual((round_metrics["legacyAdjacentMissPairs"], round_metrics["expectedAdjacentPresentedMissPairs"]), (0, 2))
        self.assertEqual((fixed["expectedAdjacentPresentedMissPairs"], fixed["distinctPresentations"], fixed["maxPresentedGapMs"]), (2, 2, 23))
        self.assertEqual(round_metrics["maxPresentedGapMsFullWindow"], 23)

    def test_missed_targets_report_the_actual_presentation_order_and_hide_dropped_buffers(self):
        ms = 1_000_000
        rows = [frame(1, 11 * ms, 10 * ms, 50 * ms), frame(2, 24 * ms, 20 * ms, 40 * ms),
                frame(3, 31 * ms, 30 * ms, 60 * ms), frame(4, 41 * ms, 40 * ms, 70 * ms, "Dropped Frame")]
        pairs = return_round(rows, 10 * ms)["missedTargetPairDetails"]
        self.assertEqual([p["signedPresentationDeltaMs"] for p in pairs], [-10, 20, None])
        self.assertEqual([p["adjacentInPresentationOrder"] for p in pairs], [False, False, None])
        self.assertEqual((pairs[0]["second"]["targetAfterBackMs"], pairs[0]["second"]["startAfterBackMs"],
                          pairs[0]["second"]["presentAfterBackMs"]), (20, 24, 40))
        self.assertIsNone(pairs[-1]["second"]["presentAfterBackMs"])
        self.assertIsNone(pairs[-1]["second"]["displayType"])
        rows[0]["shown"] = rows[1]["shown"]
        shared = return_round(rows, 10 * ms)["missedTargetPairDetails"]
        self.assertEqual((shared[0]["signedPresentationDeltaMs"], shared[0]["adjacentInPresentationOrder"]), (0, False))
        self.assertTrue(shared[1]["adjacentInPresentationOrder"])
        rows[2]["vsync_ns"] = "[NULL]"
        self.assertIsNone(return_round(rows, 10 * ms)["missedTargetPairDetails"])

    def test_a_different_or_mixed_target_cadence_cannot_pass_a_fixed_rate_gate(self):
        fps90, fps60 = 11_111_111, 16_666_667
        steady = [(fps90*i, 10_111_111) for i in (0, 1, 2, 3, 5, 6)]
        self.assertTrue(target_cadence(steady, fps90)["fixedPeriodVerified"])
        self.assertFalse(target_cadence(steady + [(6*fps90 + fps60, 15_666_667)], fps90)["fixedPeriodVerified"])
        self.assertFalse(target_cadence([(i*fps60, 15_666_667) for i in range(9)], fps90)["fixedPeriodVerified"])

    def test_open_late_frame_does_not_erase_the_first_presentation(self):
        samples = [frame(1, 10, 10, 20), dict(frame(2, 100, 100, 150), app_duration=-1)]
        metrics = return_round(samples, 10)
        self.assertTrue(metrics["valid"])
        self.assertEqual(metrics["unfinishedFrames"], 1)
        self.assertFalse(metrics["firstMayBeCensored"])
        self.assertFalse(return_round([dict(samples[0], inputs=2)], 10)["valid"])
        missing = return_round([dict(samples[0], vsync_ns="[NULL]"), frame(3, 110, 110, 130)], 10)
        self.assertIsNone(missing["expectedAdjacentAllAppMissPairs"])
        self.assertIsNone(missing["afterBackWindows"]["0-100ms"]["expectedAdjacentPresentedMissPairs"])
        self.assertEqual(missing["afterBackWindows"]["0-100ms"]["distinctPresentations"], 2)

    def test_phase_matching_requires_observed_pointer_and_scroll(self):
        events = defaultdict(list, down=[11, 300], up=[100, 360], scroll=[30, 84, 130, 150])
        self.assertEqual(phase_boundaries(events, 10, 220), (11, 100, 150))
        self.assertIsNone(phase_boundaries(events, 10, 360))
        self.assertIsNone(phase_boundaries(events, 270, 360))
        events["cancel"] = [84]
        self.assertIsNone(phase_boundaries(events, 10, 220))

    def test_deadlines_on_opposite_sides_of_a_tap_are_not_counted_as_animation_misses(self):
        before = frame(1, 100, 100, 120)
        after = frame(2, 110, 110, 130)
        windows = [("transition", 1_000_000_000, 1_000_000_105), ("afterTap", 1_000_000_105, 1_000_000_130)]
        result = deadline_windows([before, after], 10, windows)
        self.assertEqual(result["transition"]["expectedAdjacentPresentedMissPairs"], 0)
        self.assertEqual(result["afterTap"]["expectedAdjacentPresentedMissPairs"], 0)

    def test_pixels_use_android_elapsed_clock_and_require_a_stable_match(self):
        times = (1_000_000, 2_000_000, 3_000_000, 4_000_000)
        mp4 = b"mdat#VV1NSC0PET1ME2#" + struct.pack("<IqI4Q", 2, 0, len(times), *times)
        self.assertEqual(frame_times_ns(mp4), times)
        topic, feed = bytes(64), bytes([255]) * 64
        metrics = first_feed_frame(topic, feed, topic + topic + feed + feed, times, 1_800_000)
        self.assertEqual(metrics["firstRecognizableFeedMs"], 1.2)
        with self.assertRaises(ValueError):
            first_feed_frame(topic, feed, topic + feed + topic + feed, times, 1_800_000)
        with self.assertRaises(ValueError):
            frame_times_ns(mp4[:-1])


if __name__ == "__main__":
    unittest.main()
