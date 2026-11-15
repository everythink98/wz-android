-- Perfetto v59.1. Run against a named warm session; all objects are rerunnable.
-- Attribution only. Inspect health and coverage before interpreting durations.
-- Requires android-tls.pftxt: two audited log tags, sched and TCP state events.
-- Outputs never include raw log messages, IPs, payloads or opaque socket pointers.
SELECT name, idx, value, severity FROM stats
WHERE value > 0 AND (severity IN ('error', 'data_loss')
  OR name GLOB '*overrun*' OR name GLOB '*dropped*'
  OR name GLOB '*packet_loss*' OR name = 'android_log_num_failed');
SELECT trace_start() AS start_ns, trace_end() AS end_ns;
SELECT tag, COUNT(*) AS log_count FROM android_logs
WHERE tag IN ('WzNetworkProxy', 'WzStartup') GROUP BY tag;

CREATE OR REPLACE PERFETTO FUNCTION wz_tls_token(msg STRING, field STRING)
RETURNS STRING AS
SELECT STR_SPLIT(STR_SPLIT(' ' || $msg || ' ', ' ' || $field || '=', 1), ' ', 0);

-- UPID/UTID identify actual processes/threads; no PID or worker name is assumed.
CREATE OR REPLACE PERFETTO TABLE wz_tls_scope AS
SELECT DISTINCT t.upid, p.pid,
  json_extract(al.msg, '$.buildId') AS build_id,
  json_extract(al.msg, '$.processSessionId') AS process_session_id
FROM android_logs al JOIN thread t USING (utid) JOIN process p USING (upid)
WHERE al.tag = 'WzStartup' AND p.name = 'com.wz.reader';
SELECT pid, build_id, process_session_id FROM wz_tls_scope ORDER BY pid;

CREATE OR REPLACE PERFETTO TABLE wz_tls_network AS
SELECT al.id, al.ts, al.utid, t.tid, t.upid, p.pid,
  wz_tls_token(al.msg, 'phase') AS phase,
  wz_tls_token(al.msg, 'source') AS source,
  wz_tls_token(al.msg, 'callId') AS call_id,
  CAST(wz_tls_token(al.msg, 'socketLocalPort') AS INT) AS acquired_port,
  wz_tls_token(al.msg, 'errorType') AS error_type,
  wz_tls_token(al.msg, 'socketErrno') AS socket_errno
FROM android_logs al JOIN thread t USING (utid) JOIN process p USING (upid)
WHERE al.tag = 'WzNetworkProxy' AND al.msg GLOB 'read-network operation=request *'
  AND t.upid IN (SELECT upid FROM wz_tls_scope);
SELECT source, phase, COUNT(*) AS event_count FROM wz_tls_network
GROUP BY source, phase ORDER BY source, phase;

CREATE OR REPLACE PERFETTO TABLE wz_tls_tcp AS
SELECT id, ts, utid, name,
  EXTRACT_ARG(arg_set_id, 'skaddr') AS socket_key,
  CAST(EXTRACT_ARG(arg_set_id, 'sport') AS INT) AS local_port,
  CAST(EXTRACT_ARG(arg_set_id, 'dport') AS INT) AS remote_port,
  CAST(EXTRACT_ARG(arg_set_id, 'protocol') AS INT) AS protocol,
  CAST(EXTRACT_ARG(arg_set_id, 'oldstate') AS INT) AS old_state,
  CAST(EXTRACT_ARG(arg_set_id, 'newstate') AS INT) AS new_state,
  CAST(EXTRACT_ARG(arg_set_id, 'state') AS INT) AS state
FROM ftrace_event WHERE name IN
  ('inet_sock_set_state', 'tcp_receive_reset', 'tcp_send_reset', 'tcp_retransmit_skb');
SELECT name AS phase, COUNT(*) AS event_count FROM wz_tls_tcp GROUP BY name;

CREATE OR REPLACE PERFETTO TABLE wz_tls_connect_start AS
SELECT *, LEAD(ts, 1, trace_end()) OVER
  (PARTITION BY upid, call_id ORDER BY ts, id) AS next_connect_ts
FROM wz_tls_network WHERE phase = 'connect-start';

CREATE OR REPLACE PERFETTO TABLE wz_tls_attempt AS
SELECT c.*,
  (SELECT MIN(n.ts) FROM wz_tls_network n
   WHERE n.upid = c.upid AND n.call_id = c.call_id AND n.ts >= c.ts
     AND n.ts < c.next_connect_ts AND n.phase IN
     ('tls-start', 'connect-end', 'connect-failed', 'call-failed', 'call-canceled')) AS bind_end_ts,
  (SELECT MIN(n.ts) FROM wz_tls_network n
   WHERE n.upid = c.upid AND n.call_id = c.call_id AND n.ts >= c.ts
     AND n.ts < c.next_connect_ts AND n.phase = 'tls-start') AS tls_start_ts,
  (SELECT n.utid FROM wz_tls_network n
   WHERE n.upid = c.upid AND n.call_id = c.call_id AND n.ts >= c.ts
     AND n.ts < c.next_connect_ts AND n.phase = 'tls-start'
   ORDER BY n.ts, n.id LIMIT 1) AS tls_utid,
  (SELECT MIN(n.ts) FROM wz_tls_network n
   WHERE n.upid = c.upid AND n.call_id = c.call_id AND n.ts >= c.ts
     AND n.ts < c.next_connect_ts AND n.phase IN
     ('tls-end', 'connect-failed', 'call-failed', 'call-canceled')) AS tls_end_ts,
  (SELECT n.acquired_port FROM wz_tls_network n
   WHERE n.upid = c.upid AND n.call_id = c.call_id AND n.ts >= c.ts
     AND n.ts < c.next_connect_ts AND n.phase = 'connection-acquired'
   ORDER BY n.ts, n.id LIMIT 1) AS acquired_port_check
FROM wz_tls_connect_start c;

-- Bind only the unique SYN_SENT on the connect-start thread before TLS/failure.
-- Missing or multiple candidates remain explicit; neither gets socket attribution.
CREATE OR REPLACE PERFETTO TABLE wz_tls_syn_candidate AS
SELECT a.id AS attempt_id, e.id AS syn_id, e.ts AS syn_ts,
  e.socket_key, e.local_port AS syn_port, e.remote_port
FROM wz_tls_attempt a JOIN wz_tls_tcp e ON e.utid = a.utid
  AND e.ts >= a.ts AND e.ts < COALESCE(a.bind_end_ts, a.next_connect_ts)
WHERE e.name = 'inet_sock_set_state' AND e.protocol = 6 AND e.new_state = 2;

CREATE OR REPLACE PERFETTO TABLE wz_tls_candidate_count AS
SELECT a.id AS attempt_id, COUNT(c.syn_id) AS syn_candidates
FROM wz_tls_attempt a LEFT JOIN wz_tls_syn_candidate c ON c.attempt_id = a.id
GROUP BY a.id;

-- Socket pointers can be reused. Bound every join by CLOSE or the next SYN_SENT.
CREATE OR REPLACE PERFETTO TABLE wz_tls_socket AS
SELECT a.*, n.syn_candidates, c.syn_id, c.syn_ts, c.socket_key, c.syn_port, c.remote_port,
  (SELECT MIN(e.ts) FROM wz_tls_tcp e
   WHERE e.socket_key = c.socket_key AND e.ts > c.syn_ts
     AND e.name = 'inet_sock_set_state' AND e.new_state IN (2, 7)) AS socket_end_ts
FROM wz_tls_attempt a JOIN wz_tls_candidate_count n ON n.attempt_id = a.id
LEFT JOIN wz_tls_syn_candidate c ON c.attempt_id = a.id AND n.syn_candidates = 1;

-- On the validated kernel SYN_SENT precedes autobind, with sport=0. Resolve the
-- port inside that lifetime. This is state timing, not captured SYN/SYNACK RTT.
CREATE OR REPLACE PERFETTO TABLE wz_tls_binding AS
SELECT a.*,
  (SELECT e.local_port FROM wz_tls_tcp e WHERE e.socket_key = a.socket_key
   AND e.ts >= a.syn_ts AND e.ts <= COALESCE(a.socket_end_ts, trace_end())
   AND (e.ts = a.syn_ts OR NOT(e.name = 'inet_sock_set_state' AND e.new_state = 2))
   AND e.local_port > 0 ORDER BY e.ts, e.id LIMIT 1) AS local_port,
  (SELECT MIN(e.ts) FROM wz_tls_tcp e WHERE e.socket_key = a.socket_key
   AND e.ts >= a.syn_ts AND e.ts < COALESCE(a.socket_end_ts, trace_end())
   AND e.name = 'inet_sock_set_state' AND e.new_state = 1) AS established_ts
FROM wz_tls_socket a;

-- Acquired port can differ after a successful h2 candidate is discarded in favor
-- of a pooled socket. Different ports alone do not invalidate the SYN binding.
SELECT source, call_id, pid, tid, local_port, syn_candidates,
  CASE WHEN syn_candidates = 0 THEN 'NO_SYN'
       WHEN syn_candidates > 1 THEN 'MULTIPLE_SYN'
       WHEN local_port IS NULL THEN 'PORT_UNOBSERVED'
       WHEN acquired_port_check = local_port THEN 'PORT_CONFIRMED'
       WHEN acquired_port_check IS NULL THEN 'SYN_ONLY'
       ELSE 'ACQUIRED_DIFFERENT_SOCKET' END AS binding,
  ROUND((syn_ts - ts) / 1e6, 3) AS app_to_syn_ms,
  ROUND((established_ts - syn_ts) / 1e6, 3) AS tcp_state_ms,
  ROUND((tls_start_ts - ts) / 1e6, 3) AS pre_tls_ms,
  ROUND((tls_end_ts - tls_start_ts) / 1e6, 3) AS tls_ms
FROM wz_tls_binding ORDER BY ts;
SELECT syn_candidates, COUNT(*) AS attempt_count FROM wz_tls_candidate_count
GROUP BY syn_candidates;

CREATE OR REPLACE PERFETTO TABLE wz_tls_socket_events AS
SELECT a.id AS attempt_id, e.* FROM wz_tls_binding a JOIN wz_tls_tcp e
ON e.socket_key = a.socket_key AND e.ts >= a.syn_ts
  AND e.ts <= COALESCE(a.socket_end_ts, trace_end())
  AND (e.ts = a.syn_ts OR NOT(e.name = 'inet_sock_set_state' AND e.new_state = 2))
WHERE a.syn_candidates = 1;

-- Reset may run on a softirq thread, so do not require its TID to be the worker.
-- Compare order with Native failure/cancel, TLS success and intentional force-stop.
-- A later send_reset does not establish a handshake failure. No guest retransmit
-- does not rule out loss behind a host TUN or on the remote path.
SELECT e.name AS phase, a.source, a.call_id, a.pid, a.tid, a.local_port,
  e.old_state, e.new_state, e.state,
  ROUND((e.ts - a.ts) / 1e6, 3) AS after_connect_start_ms,
  ROUND((e.ts - a.tls_end_ts) / 1e6, 3) AS after_tls_terminal_ms
FROM wz_tls_socket_events e JOIN wz_tls_binding a ON a.id = e.attempt_id
ORDER BY a.ts, e.ts, e.id;

-- Use actual tls-start UTID, independently of the socket candidate cardinality.
-- Clip every state interval; inclusive wall time is not CPU. S means sleeping,
-- not proof of a particular network wait without blocked-stack/syscall evidence.
CREATE OR REPLACE PERFETTO TABLE wz_tls_worker_state AS
SELECT a.id AS attempt_id, s.state,
  SUM(MIN(s.ts + IIF(s.dur = -1, trace_end() - s.ts, s.dur), a.tls_end_ts)
      - MAX(s.ts, a.tls_start_ts)) AS state_ns
FROM wz_tls_attempt a JOIN thread_state s ON s.utid = a.tls_utid
  AND s.ts < a.tls_end_ts
  AND s.ts + IIF(s.dur = -1, trace_end() - s.ts, s.dur) > a.tls_start_ts
WHERE a.tls_start_ts IS NOT NULL AND a.tls_end_ts > a.tls_start_ts
GROUP BY a.id, s.state;

SELECT 'tls-thread-state' AS phase, a.source, a.call_id, a.pid, t.tid,
  b.local_port, s.state, ROUND(s.state_ns / 1e6, 3) AS state_ms
FROM wz_tls_worker_state s JOIN wz_tls_attempt a ON a.id = s.attempt_id
JOIN thread t ON t.utid = a.tls_utid JOIN wz_tls_binding b ON b.id = a.id
ORDER BY a.ts, s.state;

-- Empty/missing state coverage is an evidence gap, never zero work.
SELECT COUNT(*) AS connect_attempts,
  SUM(tls_start_ts IS NOT NULL) AS tls_starts,
  SUM(tls_start_ts IS NOT NULL AND tls_end_ts > tls_start_ts) AS tls_terminals,
  SUM(tls_start_ts IS NOT NULL AND tls_end_ts IS NULL) AS unfinished_tls
FROM wz_tls_attempt;
SELECT COUNT(*) AS complete_tls_intervals,
  SUM(s.covered_ns IS NULL OR ABS(a.tls_end_ts - a.tls_start_ts - s.covered_ns) > 1000)
    AS state_coverage_gaps,
  ROUND(MAX(ABS(a.tls_end_ts - a.tls_start_ts - COALESCE(s.covered_ns, 0))) / 1e6, 6)
    AS max_state_gap_ms
FROM wz_tls_attempt a LEFT JOIN
  (SELECT attempt_id, SUM(state_ns) AS covered_ns FROM wz_tls_worker_state GROUP BY attempt_id) s
ON s.attempt_id = a.id
WHERE a.tls_start_ts IS NOT NULL AND a.tls_end_ts > a.tls_start_ts;

-- errorType is a native exception class; socketErrno is an allowlisted token.
SELECT phase, source, call_id, pid, tid, error_type, socket_errno
FROM wz_tls_network WHERE phase IN
  ('connect-failed', 'call-failed', 'call-canceled', 'request-failed', 'response-failed')
ORDER BY ts;
