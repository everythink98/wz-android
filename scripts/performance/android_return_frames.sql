/* The caller supplies validated integer action markers and process IDs. */
WITH markers(round, marker, pid) AS (VALUES {markers}),
input AS (
  SELECT m.*, COUNT(s.id) AS inputs, MIN(s.ts) AS back_ns
  FROM markers m LEFT JOIN slice s
    ON s.ts BETWEEN m.marker AND m.marker + 250000000
    AND s.name GLOB 'publishKeyEvent(inputChannel=*com.wz.reader.MainActivity (server), action=UP, keyCode=BACK)*'
  GROUP BY m.round
),
probe AS (
  SELECT i.round, COUNT(CASE WHEN s.name GLOB '*action=UP)' THEN 1 END) AS touch_ups,
    MIN(CASE WHEN s.name GLOB '*action=UP)' THEN s.ts END) AS touch_up_ns,
    MIN(CASE WHEN s.name GLOB '*action=DOWN)' THEN s.ts END) AS touch_down_ns
  FROM input i LEFT JOIN slice s ON s.ts>=i.back_ns AND s.ts<i.back_ns+1100000000
    AND s.name GLOB 'publishMotionEvent(inputChannel=*com.wz.reader.MainActivity (server), action=*)'
    AND (s.name GLOB '*action=UP)' OR s.name GLOB '*action=DOWN)')
  GROUP BY i.round
),
transition_events AS (
  SELECT t.tid AS pid, s.ts, s.name
  FROM slice s JOIN thread_track tr ON tr.id=s.track_id JOIN thread t USING (utid)
  JOIN process p USING (upid)
  WHERE p.name='com.wz.reader' AND t.tid=p.pid AND s.name IN (
    'WZ.TopicPopStart', 'WZ.TopicPopEnd', 'WZ.TopicPopClear',
    'FabricEventEmitter.receiveEvent(''topTransitionProgress'')',
    'FabricEventEmitter.receiveEvent(''topFinishTransitioning'')',
    'FabricEventEmitter.receiveEvent(''topDismissed'')'
  )
),
transition AS (
  SELECT i.round, COUNT(CASE WHEN a.name='WZ.TopicPopStart' THEN 1 END) AS starts,
    MIN(CASE WHEN a.name='WZ.TopicPopStart' THEN a.ts END) AS start_ns,
    COUNT(CASE WHEN a.name='WZ.TopicPopEnd' THEN 1 END) AS ends,
    MIN(CASE WHEN a.name='WZ.TopicPopEnd' THEN a.ts END) AS end_ns,
    COUNT(CASE WHEN a.name='WZ.TopicPopClear' THEN 1 END) AS clears,
    COUNT(CASE WHEN a.name LIKE '%topTransitionProgress%' THEN 1 END) AS progress_events,
    MIN(CASE WHEN a.name LIKE '%topTransitionProgress%' THEN a.ts END) AS first_progress_ns,
    COUNT(CASE WHEN a.name LIKE '%topFinishTransitioning%' THEN 1 END) AS finish_events,
    MAX(CASE WHEN a.name LIKE '%topFinishTransitioning%' THEN a.ts END) AS finish_ns,
    COUNT(CASE WHEN a.name LIKE '%topDismissed%' THEN 1 END) AS dismiss_events
  FROM input i LEFT JOIN transition_events a ON a.pid=i.pid AND a.ts>=i.back_ns AND a.ts<i.back_ns+1100000000
  GROUP BY i.round
),
app AS (
  SELECT a.*, p.pid
  FROM actual_frame_timeline_slice a JOIN process p USING (upid)
  WHERE p.name='com.wz.reader' AND a.layer_name GLOB '*MainActivity*'
),
display AS (
  SELECT a.display_frame_token, COUNT(*) AS matches, MIN(a.ts + a.dur) AS shown,
         MIN(a.present_type) AS display_type
  FROM actual_frame_timeline_slice a JOIN process p USING (upid)
  WHERE p.name GLOB '*surfaceflinger' AND a.dur > 0 AND a.surface_frame_token IS NULL
  GROUP BY a.display_frame_token
),
expected AS (
  SELECT upid, surface_frame_token, MIN(ts) AS vsync_ns
  FROM expected_frame_timeline_slice
  GROUP BY upid, surface_frame_token HAVING MIN(ts) = MAX(ts)
)
SELECT i.round, i.inputs, i.back_ns, probe.touch_ups, probe.touch_up_ns, probe.touch_down_ns, b.end_ts AS trace_end,
       transition.starts, transition.start_ns, transition.ends, transition.end_ns, transition.clears,
       transition.progress_events, transition.first_progress_ns, transition.finish_events, transition.finish_ns, transition.dismiss_events,
       a.surface_frame_token AS token, a.ts AS app_start, a.dur AS app_duration,
       e.vsync_ns, a.jank_type, a.present_type AS app_type,
       d.matches AS display_matches, d.shown, d.display_type
FROM input i JOIN probe USING (round) JOIN transition USING (round) CROSS JOIN trace_bounds b
LEFT JOIN app a ON a.pid=i.pid AND a.ts>=i.back_ns AND a.ts<i.back_ns+1100000000
LEFT JOIN expected e ON e.upid=a.upid AND e.surface_frame_token=a.surface_frame_token
LEFT JOIN display d ON d.display_frame_token=a.display_frame_token
ORDER BY i.round, d.shown, a.ts;
