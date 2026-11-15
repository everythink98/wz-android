-- Inspect health before attributing any work. Missing rows are not zero cost.
SELECT name, value, severity FROM stats
WHERE value > 0 AND severity IN ('error', 'data_loss');
SELECT pid, upid, name, start_ts, end_ts FROM process
WHERE name = 'com.wz.reader';
SELECT trace_start() AS start_ns, trace_end() AS end_ns;

INCLUDE PERFETTO MODULE slices.with_context;
INCLUDE PERFETTO MODULE sched.with_context;
SELECT upid, COUNT(*) AS unfinished_sched_rows
FROM sched_with_thread_process WHERE process_name = 'com.wz.reader' AND dur < 0
GROUP BY upid;
SELECT upid, thread_name, ROUND(SUM(dur) / 1e6, 3) AS cpu_ms
FROM sched_with_thread_process WHERE process_name = 'com.wz.reader' AND dur >= 0
GROUP BY upid, utid ORDER BY cpu_ms DESC LIMIT 20;
SELECT pid, MIN(ts) AS first_slice_ns, MAX(ts + dur) AS last_slice_end_ns
FROM thread_slice WHERE process_name = 'com.wz.reader' AND dur >= 0
GROUP BY upid;
SELECT pid, name, thread_name, COUNT(*) AS count,
  ROUND(SUM(dur) / 1e6, 3) AS total_ms,
  ROUND(MAX(dur) / 1e6, 3) AS worst_ms
FROM thread_slice WHERE process_name = 'com.wz.reader' AND dur >= 0
  AND (name GLOB 'draw-VRI*' OR name GLOB 'WZ.*' OR name GLOB '*WebView*')
GROUP BY upid, utid, name ORDER BY total_ms DESC LIMIT 30;
-- Inclusive durations overlap. Do not add parent and child slices as CPU time.
SELECT pid, ts, name, thread_name, ROUND(dur / 1e6, 3) AS ms
FROM thread_slice WHERE process_name = 'com.wz.reader' AND dur > 2e7
ORDER BY dur DESC LIMIT 30;
SELECT pid, COUNT(*) AS frame_count, ROUND(MAX(dur) / 1e6, 3) AS longest_ms
FROM actual_frame_timeline_slice JOIN process USING (upid)
WHERE process.name = 'com.wz.reader' GROUP BY upid;
