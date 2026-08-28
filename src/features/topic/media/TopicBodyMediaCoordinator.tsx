import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState
} from 'react';
import { type Source } from '@/domain/forum/sourceCatalog';
import { useReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { TopicAudioSessionProvider } from './TopicAudioSession';

const MAX_WARM_BLOCK_MEDIA = 8;
const MAX_IN_FLIGHT_BODY_MEDIA = 4;
const MEDIA_NO_PROGRESS_TIMEOUT_MS = 30_000;

type TopicBodyMediaKind = 'audio' | 'base' | 'inline' | 'sticker' | 'poster' | 'video' | 'original';
type TopicBodyMediaPriority = 'visible' | 'prefetch' | 'upgrade' | 'user';
type TopicBodyMediaOutcome = 'displayed' | 'error';
type TopicBodyMediaFailure = 'error' | 'timeout' | null;
type TopicBodyMediaEntryStatus = 'waiting' | 'running' | 'displayed' | 'failed';

export type TopicBodyMediaDiagnosticSession = Readonly<{
  networkMediaCount: number;
  plannedRowCount: number;
  responseReadyAt?: number;
  source: Source;
  topicRef: string;
}>;

export type TopicBodyMediaAggregate = Readonly<
  Omit<TopicBodyMediaDiagnosticSession, 'responseReadyAt'> & {
    cancelCount: number;
    displayCount: number;
    errorCount: number;
    firstMediaElapsedMs?: number;
    firstRowElapsedMs?: number;
    operation: 'topic-body-media';
    phase: 'finish';
    retryCount: number;
    runningHighWater: number;
    timeoutCount: number;
    timerHighWater: number;
    warmHighWater: number;
  }
>;

type TopicBodyMediaAggregateReporter = (aggregate: TopicBodyMediaAggregate) => void | Promise<void>;

type TopicBodyMediaSnapshot = {
  admitted: boolean;
  attachmentKey: string;
  attemptId: string;
  failure: TopicBodyMediaFailure;
};

type TopicBodyMediaEntry = {
  automaticRetry: boolean;
  attempt: number;
  attachmentRevision: number;
  deadline: number | null;
  failure: TopicBodyMediaFailure;
  key: string;
  kind: TopicBodyMediaKind;
  lastProgressValue: number | null;
  listener: (snapshot: TopicBodyMediaSnapshot) => void;
  priority: TopicBodyMediaPriority;
  requestIdentity: string;
  rowKey: string;
  sequence: number;
  snapshot: TopicBodyMediaSnapshot;
  status: TopicBodyMediaEntryStatus;
};

const PRIORITY_ORDER: Record<TopicBodyMediaPriority, number> = {
  user: 0,
  visible: 1,
  prefetch: 2,
  upgrade: 3
};

function sameSnapshot(left: TopicBodyMediaSnapshot, right: TopicBodyMediaSnapshot) {
  return (
    left.admitted === right.admitted &&
    left.attachmentKey === right.attachmentKey &&
    left.attemptId === right.attemptId &&
    left.failure === right.failure
  );
}

class TopicBodyMediaCoordinator {
  private active: boolean;
  private automaticallyRetriedIdentities = new Set<string>();
  private cancelCount = 0;
  private diagnosticFinished = false;
  private diagnosticSession: TopicBodyMediaDiagnosticSession | undefined;
  private displayCount = 0;
  private disposed = false;
  private entries = new Map<string, TopicBodyMediaEntry>();
  private errorCount = 0;
  private explicitlyRetriedIdentities = new Set<string>();
  private failedIdentities = new Map<string, Exclude<TopicBodyMediaFailure, null>>();
  private firstMediaElapsedMs: number | undefined;
  private firstRowElapsedMs: number | undefined;
  private onDiagnosticFinish: TopicBodyMediaAggregateReporter | undefined;
  private paused: boolean;
  private retryCount = 0;
  private runtimeGeneration: number;
  private runningHighWater = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDeadline: number | null = null;
  private timeoutCount = 0;
  private timerHighWater = 0;
  private visibleRowKeys: readonly string[];
  private viewportRowKeys: readonly string[];
  private warmHighWater = 0;
  private warmKeys = new Set<string>();

  constructor(
    { active, paused, visibleRowKeys, viewportRowKeys }: CoordinatorGate,
    diagnosticSession?: TopicBodyMediaDiagnosticSession,
    onDiagnosticFinish?: TopicBodyMediaAggregateReporter,
    runtimeGeneration = 0
  ) {
    this.active = active;
    this.diagnosticSession = diagnosticSession;
    this.onDiagnosticFinish = onDiagnosticFinish;
    this.paused = paused;
    this.runtimeGeneration = runtimeGeneration;
    this.visibleRowKeys = visibleRowKeys;
    this.viewportRowKeys = viewportRowKeys;
  }

  register(
    options: {
      automaticRetry: boolean;
      key: string;
      kind: TopicBodyMediaKind;
      priority: TopicBodyMediaPriority;
      requestIdentity: string;
      rowKey: string;
    },
    listener: TopicBodyMediaEntry['listener']
  ) {
    const entry: TopicBodyMediaEntry = {
      automaticRetry: options.automaticRetry,
      attempt: 0,
      attachmentRevision: 0,
      deadline: null,
      failure: null,
      key: options.key,
      kind: options.kind,
      lastProgressValue: null,
      listener,
      priority: options.priority,
      requestIdentity: options.requestIdentity,
      rowKey: options.rowKey,
      sequence: this.sequence++,
      snapshot: {
        admitted: false,
        attachmentKey: `${options.key}:attachment:0`,
        attemptId: `${options.key}:0`,
        failure: null
      },
      status: 'waiting'
    };
    const identityFailure = this.failedIdentities.get(entry.requestIdentity);
    if (identityFailure) {
      entry.failure = identityFailure;
      entry.status = 'failed';
    }
    this.entries.set(entry.key, entry);
    this.recompute();
    return () => {
      if (this.entries.get(entry.key) !== entry) return;
      if (entry.status === 'running') this.cancelCount += 1;
      this.entries.delete(entry.key);
      this.warmKeys.delete(entry.key);
      this.recompute();
    };
  }

  updateGate({ active, paused, visibleRowKeys, viewportRowKeys }: CoordinatorGate) {
    this.active = active;
    this.paused = paused;
    this.visibleRowKeys = visibleRowKeys;
    this.viewportRowKeys = viewportRowKeys;
    this.recompute();
  }

  updateDiagnosticReporter(
    diagnosticSession?: TopicBodyMediaDiagnosticSession,
    onDiagnosticFinish?: TopicBodyMediaAggregateReporter
  ) {
    if (diagnosticSession) {
      const currentSession = this.diagnosticSession;
      this.diagnosticSession =
        currentSession &&
        currentSession.source === diagnosticSession.source &&
        currentSession.topicRef === diagnosticSession.topicRef
          ? {
              ...currentSession,
              networkMediaCount: Math.max(
                safeAggregateCount(currentSession.networkMediaCount),
                safeAggregateCount(diagnosticSession.networkMediaCount)
              ),
              plannedRowCount: Math.max(
                safeAggregateCount(currentSession.plannedRowCount),
                safeAggregateCount(diagnosticSession.plannedRowCount)
              ),
              responseReadyAt: currentSession.responseReadyAt ?? diagnosticSession.responseReadyAt
            }
          : diagnosticSession;
    }
    this.onDiagnosticFinish = onDiagnosticFinish;
  }

  restartRunningForRuntimeGeneration(generation: number) {
    if (!Number.isSafeInteger(generation) || generation <= this.runtimeGeneration) return;
    this.runtimeGeneration = generation;
    const deadline = Date.now() + MEDIA_NO_PROGRESS_TIMEOUT_MS;
    let restarted = false;
    for (const entry of this.entries.values()) {
      if (entry.status !== 'running') continue;
      this.cancelCount += 1;
      entry.attempt += 1;
      entry.attachmentRevision += 1;
      entry.deadline = deadline;
      entry.lastProgressValue = null;
      restarted = true;
    }
    if (restarted) this.recompute();
  }

  settle(key: string, attemptId: string, outcome: TopicBodyMediaOutcome) {
    const entry = this.entries.get(key);
    if (
      !entry ||
      (entry.status !== 'running' && !(outcome === 'error' && entry.status === 'displayed')) ||
      attemptId !== `${entry.key}:${entry.attempt}`
    ) {
      return;
    }
    entry.deadline = null;
    if (outcome === 'error') {
      this.errorCount += 1;
      if (!entry.automaticRetry || !this.beginAutomaticRetry(entry.requestIdentity, entry.key)) {
        this.failIdentity(entry.requestIdentity, 'error', entry.key);
      }
    } else {
      this.displayCount += 1;
      entry.failure = null;
      entry.status = 'displayed';
      this.failedIdentities.delete(entry.requestIdentity);
      for (const duplicate of this.entries.values()) {
        if (duplicate.requestIdentity === entry.requestIdentity && duplicate.status === 'failed') {
          duplicate.failure = null;
          duplicate.status = 'waiting';
        }
      }
    }
    this.recompute();
  }

  progress(key: string, attemptId: string, value: number) {
    const entry = this.entries.get(key);
    if (
      !entry ||
      entry.status !== 'running' ||
      attemptId !== `${entry.key}:${entry.attempt}` ||
      !Number.isFinite(value) ||
      (entry.lastProgressValue !== null && value <= entry.lastProgressValue)
    ) {
      return;
    }
    entry.lastProgressValue = value;
    entry.deadline = Date.now() + MEDIA_NO_PROGRESS_TIMEOUT_MS;
    this.scheduleTimer();
  }

  markFirstRowElapsed(elapsedMs: number) {
    if (this.firstRowElapsedMs !== undefined || !Number.isFinite(elapsedMs)) return;
    this.firstRowElapsedMs = Math.max(0, Math.floor(elapsedMs));
  }

  retry(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.status !== 'failed' || this.explicitlyRetriedIdentities.has(entry.requestIdentity)) return;
    this.explicitlyRetriedIdentities.add(entry.requestIdentity);
    this.retryCount += 1;
    this.resetIdentityForRetry(entry.requestIdentity, entry.key);
    this.recompute();
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (entry.status === 'running') this.cancelCount += 1;
    }
    this.captureHighWater();
    this.finishDiagnosticAggregate();
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDeadline = null;
    this.entries.clear();
    this.automaticallyRetriedIdentities.clear();
    this.explicitlyRetriedIdentities.clear();
    this.failedIdentities.clear();
    this.warmKeys.clear();
  }

  private captureHighWater() {
    this.warmHighWater = Math.max(this.warmHighWater, this.warmKeys.size);
    this.runningHighWater = Math.max(
      this.runningHighWater,
      [...this.entries.values()].filter((entry) => entry.status === 'running').length
    );
    this.timerHighWater = Math.max(this.timerHighWater, this.timer ? 1 : 0);
  }

  private failIdentity(
    requestIdentity: string,
    failure: Exclude<TopicBodyMediaFailure, null>,
    failedEntryKey?: string
  ) {
    this.failedIdentities.set(requestIdentity, failure);
    for (const entry of this.entries.values()) {
      if (entry.requestIdentity !== requestIdentity || (entry.status === 'displayed' && entry.key !== failedEntryKey)) {
        continue;
      }
      entry.deadline = null;
      entry.failure = failure;
      entry.lastProgressValue = null;
      entry.status = 'failed';
    }
  }

  private beginAutomaticRetry(requestIdentity: string, retryEntryKey?: string) {
    if (this.automaticallyRetriedIdentities.has(requestIdentity)) return false;
    this.automaticallyRetriedIdentities.add(requestIdentity);
    this.retryCount += 1;
    this.resetIdentityForRetry(requestIdentity, retryEntryKey);
    return true;
  }

  private resetIdentityForRetry(requestIdentity: string, retryEntryKey?: string) {
    this.failedIdentities.delete(requestIdentity);
    for (const entry of this.entries.values()) {
      if (entry.requestIdentity !== requestIdentity || (entry.status === 'displayed' && entry.key !== retryEntryKey)) {
        continue;
      }
      entry.deadline = null;
      entry.attachmentRevision += 1;
      entry.failure = null;
      entry.lastProgressValue = null;
      entry.status = 'waiting';
    }
  }

  private finishDiagnosticAggregate() {
    if (this.diagnosticFinished) return;
    this.diagnosticFinished = true;
    const session = this.diagnosticSession;
    const reporter = this.onDiagnosticFinish;
    if (!session || !reporter) return;
    const aggregate: TopicBodyMediaAggregate = {
      cancelCount: this.cancelCount,
      displayCount: this.displayCount,
      errorCount: this.errorCount,
      ...(this.firstMediaElapsedMs === undefined ? {} : { firstMediaElapsedMs: this.firstMediaElapsedMs }),
      ...(this.firstRowElapsedMs === undefined ? {} : { firstRowElapsedMs: this.firstRowElapsedMs }),
      networkMediaCount: safeAggregateCount(session.networkMediaCount),
      operation: 'topic-body-media',
      phase: 'finish',
      plannedRowCount: safeAggregateCount(session.plannedRowCount),
      retryCount: this.retryCount,
      runningHighWater: this.runningHighWater,
      source: session.source,
      timeoutCount: this.timeoutCount,
      timerHighWater: this.timerHighWater,
      topicRef: safeOpaqueTopicRef(session.topicRef),
      warmHighWater: this.warmHighWater
    };
    try {
      void Promise.resolve(reporter(aggregate)).catch(() => undefined);
    } catch {
      // Aggregate diagnostics must never change route lifecycle behavior.
    }
  }

  private snapshotFor(entry: TopicBodyMediaEntry): TopicBodyMediaSnapshot {
    return {
      admitted: entry.status === 'displayed' || (this.warmKeys.has(entry.key) && entry.status === 'running'),
      attachmentKey: `${entry.key}:attachment:${entry.attachmentRevision}`,
      attemptId: `${entry.key}:${entry.attempt}`,
      failure: entry.failure
    };
  }

  private recompute() {
    if (this.disposed) return;
    const rowOrder = new Map(this.viewportRowKeys.map((rowKey, index) => [rowKey, index]));
    const visibleRows = new Set(this.visibleRowKeys);
    const eligible = [...this.entries.values()]
      .filter(
        (entry) =>
          rowOrder.has(entry.rowKey) &&
          (entry.kind !== 'audio' || visibleRows.has(entry.rowKey)) &&
          entry.status !== 'failed' &&
          entry.status !== 'displayed'
      )
      .sort((left, right) => {
        const leftRetained = left.status === 'running' ? 0 : 1;
        const rightRetained = right.status === 'running' ? 0 : 1;
        return (
          PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
          (rowOrder.get(left.rowKey) ?? 0) - (rowOrder.get(right.rowKey) ?? 0) ||
          leftRetained - rightRetained ||
          left.sequence - right.sequence
        );
      });
    this.warmKeys = new Set(eligible.slice(0, MAX_WARM_BLOCK_MEDIA).map((entry) => entry.key));

    const scheduledKeys = new Set<string>();
    if (this.active && !this.paused) {
      const scheduledIdentities = new Set<string>();
      let scheduledOriginalCount = 0;
      for (const entry of eligible) {
        if (scheduledKeys.size >= MAX_IN_FLIGHT_BODY_MEDIA) break;
        if (scheduledIdentities.has(entry.requestIdentity)) continue;
        if (entry.kind === 'original' && scheduledOriginalCount >= 1) continue;
        scheduledKeys.add(entry.key);
        scheduledIdentities.add(entry.requestIdentity);
        if (entry.kind === 'original') scheduledOriginalCount += 1;
      }
    }

    for (const entry of this.entries.values()) {
      if (
        entry.status === 'running' &&
        (!this.active || !this.warmKeys.has(entry.key) || (!this.paused && !scheduledKeys.has(entry.key)))
      ) {
        this.cancelCount += 1;
        entry.deadline = null;
        entry.lastProgressValue = null;
        entry.status = 'waiting';
      }
    }

    let runningCount = [...this.entries.values()].filter((entry) => entry.status === 'running').length;
    const runningIdentities = new Set(
      [...this.entries.values()].filter((entry) => entry.status === 'running').map((entry) => entry.requestIdentity)
    );
    let runningOriginalCount = [...this.entries.values()].filter(
      (entry) => entry.status === 'running' && entry.kind === 'original'
    ).length;
    if (this.active && !this.paused) {
      for (const entry of eligible) {
        if (runningCount >= MAX_IN_FLIGHT_BODY_MEDIA) break;
        if (!scheduledKeys.has(entry.key) || entry.status !== 'waiting') continue;
        if (runningIdentities.has(entry.requestIdentity)) continue;
        if (entry.kind === 'original' && runningOriginalCount >= 1) continue;
        entry.attempt += 1;
        entry.deadline = Date.now() + MEDIA_NO_PROGRESS_TIMEOUT_MS;
        entry.failure = null;
        entry.lastProgressValue = null;
        entry.status = 'running';
        const responseReadyAt = this.diagnosticSession?.responseReadyAt;
        if (
          this.firstMediaElapsedMs === undefined &&
          typeof responseReadyAt === 'number' &&
          Number.isFinite(responseReadyAt)
        ) {
          this.firstMediaElapsedMs = Math.max(0, Math.floor(monotonicNowMs() - responseReadyAt));
        }
        runningCount += 1;
        if (entry.kind === 'original') runningOriginalCount += 1;
        runningIdentities.add(entry.requestIdentity);
      }
    }

    this.scheduleTimer();
    this.captureHighWater();
    for (const entry of this.entries.values()) {
      const next = this.snapshotFor(entry);
      if (!sameSnapshot(entry.snapshot, next)) {
        entry.snapshot = next;
        entry.listener(next);
      }
    }
  }

  private scheduleTimer() {
    if (this.disposed) return;
    const deadlines = [...this.entries.values()]
      .filter((entry) => entry.status === 'running' && entry.deadline !== null)
      .map((entry) => entry.deadline as number);
    if (!deadlines.length) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.timerDeadline = null;
      return;
    }
    const nextDeadline = Math.min(...deadlines);
    if (this.timer && this.timerDeadline === nextDeadline) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDeadline = nextDeadline;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.timerDeadline = null;
        const now = Date.now();
        const timedOutIdentities = new Map<string, boolean>();
        let timedOutCount = 0;
        for (const entry of this.entries.values()) {
          if (entry.status === 'running' && entry.deadline !== null && entry.deadline <= now) {
            timedOutIdentities.set(
              entry.requestIdentity,
              (timedOutIdentities.get(entry.requestIdentity) ?? true) && entry.automaticRetry
            );
            timedOutCount += 1;
          }
        }
        this.timeoutCount += timedOutCount;
        for (const [requestIdentity, automaticRetry] of timedOutIdentities) {
          if (!automaticRetry || !this.beginAutomaticRetry(requestIdentity)) {
            this.failIdentity(requestIdentity, 'timeout');
          }
        }
        this.recompute();
      },
      Math.max(0, nextDeadline - Date.now())
    );
  }
}

function monotonicNowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function safeAggregateCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeOpaqueTopicRef(value: string) {
  return /^topic-[A-Za-z0-9_-]{1,80}$/.test(value) ? value : 'topic-unknown';
}

type CoordinatorGate = {
  active: boolean;
  paused: boolean;
  visibleRowKeys: readonly string[];
  viewportRowKeys: readonly string[];
};

const TopicBodyMediaCoordinatorContext = createContext<TopicBodyMediaCoordinator | null>(null);
const TopicBodyMediaRowContext = createContext('');

export function TopicBodyMediaCoordinatorProvider({
  diagnosticSession,
  visibleRowKeys,
  viewportRowKeys,
  ...props
}: Omit<CoordinatorGate, 'visibleRowKeys'> & {
  children: ReactNode;
  diagnosticSession?: TopicBodyMediaDiagnosticSession;
  onDiagnosticFinish?: TopicBodyMediaAggregateReporter;
  visibleRowKeys?: readonly string[];
}) {
  const runtimeGeneration = useReadNetworkRuntimeGeneration(diagnosticSession?.source);
  const sessionIdentity = diagnosticSession
    ? JSON.stringify([diagnosticSession.source, diagnosticSession.topicRef])
    : 'pending-topic-session';
  return (
    <TopicBodyMediaCoordinatorSessionProvider
      key={sessionIdentity}
      diagnosticSession={diagnosticSession}
      runtimeGeneration={runtimeGeneration}
      visibleRowKeys={visibleRowKeys || viewportRowKeys}
      viewportRowKeys={viewportRowKeys}
      {...props}
    />
  );
}

function TopicBodyMediaCoordinatorSessionProvider({
  active,
  children,
  diagnosticSession,
  onDiagnosticFinish,
  paused,
  runtimeGeneration,
  visibleRowKeys,
  viewportRowKeys
}: CoordinatorGate & {
  children: ReactNode;
  diagnosticSession?: TopicBodyMediaDiagnosticSession;
  onDiagnosticFinish?: TopicBodyMediaAggregateReporter;
  runtimeGeneration: number;
}) {
  const [coordinator] = useState(
    () =>
      new TopicBodyMediaCoordinator(
        { active, paused, visibleRowKeys, viewportRowKeys },
        diagnosticSession,
        onDiagnosticFinish,
        runtimeGeneration
      )
  );
  useLayoutEffect(() => {
    coordinator.updateGate({ active, paused, visibleRowKeys, viewportRowKeys });
  }, [active, coordinator, paused, visibleRowKeys, viewportRowKeys]);
  useLayoutEffect(() => {
    coordinator.updateDiagnosticReporter(diagnosticSession, onDiagnosticFinish);
  }, [coordinator, diagnosticSession, onDiagnosticFinish]);
  useLayoutEffect(() => {
    coordinator.restartRunningForRuntimeGeneration(runtimeGeneration);
  }, [coordinator, runtimeGeneration]);
  useEffect(() => () => coordinator.dispose(), [coordinator]);
  return (
    <TopicBodyMediaCoordinatorContext.Provider value={coordinator}>
      <TopicAudioSessionProvider active={active} paused={paused} runtimeGeneration={runtimeGeneration}>
        {children}
      </TopicAudioSessionProvider>
    </TopicBodyMediaCoordinatorContext.Provider>
  );
}

export function TopicBodyMediaRowBoundary({ children, rowKey }: { children: ReactNode; rowKey: string }) {
  return <TopicBodyMediaRowContext.Provider value={rowKey}>{children}</TopicBodyMediaRowContext.Provider>;
}

export function useTopicBodyMediaFirstRowMarker() {
  const coordinator = useContext(TopicBodyMediaCoordinatorContext);
  return useCallback((elapsedMs: number) => coordinator?.markFirstRowElapsed(elapsedMs), [coordinator]);
}

const UNMANAGED_MEDIA_LEASE = {
  admitted: true,
  attachmentKey: 'unmanaged',
  attemptId: 'unmanaged',
  failure: null,
  progress: (_value: number) => undefined,
  retry: () => undefined,
  settle: (_outcome: TopicBodyMediaOutcome) => undefined
} as const;

export function useTopicBodyMediaLease({
  automaticRetry = true,
  enabled = true,
  kind,
  priority = 'visible',
  requestIdentity
}: {
  automaticRetry?: boolean;
  enabled?: boolean;
  kind: TopicBodyMediaKind;
  priority?: TopicBodyMediaPriority;
  requestIdentity: string;
}) {
  const coordinator = useContext(TopicBodyMediaCoordinatorContext);
  const rowKey = useContext(TopicBodyMediaRowContext);
  const registrationId = useId();
  const key = useMemo(
    () => `${rowKey}\u0000${kind}\u0000${requestIdentity}\u0000${registrationId}`,
    [kind, registrationId, requestIdentity, rowKey]
  );
  const idleSnapshot = useMemo<TopicBodyMediaSnapshot>(
    () => ({ admitted: false, attachmentKey: `${key}:attachment:0`, attemptId: `${key}:0`, failure: null }),
    [key]
  );
  const [registeredSnapshot, setRegisteredSnapshot] = useState<{
    key: string;
    snapshot: TopicBodyMediaSnapshot;
  }>(() => ({ key, snapshot: coordinator || !enabled ? idleSnapshot : UNMANAGED_MEDIA_LEASE }));
  const snapshot =
    !enabled || (coordinator && !rowKey)
      ? idleSnapshot
      : registeredSnapshot.key === key
        ? registeredSnapshot.snapshot
        : idleSnapshot;
  useEffect(() => {
    if (!coordinator || !rowKey || !enabled) return undefined;
    setRegisteredSnapshot({ key, snapshot: idleSnapshot });
    return coordinator.register({ automaticRetry, key, kind, priority, requestIdentity, rowKey }, (nextSnapshot) => {
      setRegisteredSnapshot({ key, snapshot: nextSnapshot });
    });
  }, [automaticRetry, coordinator, enabled, idleSnapshot, key, kind, priority, requestIdentity, rowKey]);
  const settle = useCallback(
    (outcome: TopicBodyMediaOutcome) => {
      coordinator?.settle(key, snapshot.attemptId, outcome);
    },
    [coordinator, key, snapshot.attemptId]
  );
  const progress = useCallback(
    (value: number) => coordinator?.progress(key, snapshot.attemptId, value),
    [coordinator, key, snapshot.attemptId]
  );
  const retry = useCallback(() => coordinator?.retry(key), [coordinator, key]);
  return useMemo(
    () => (coordinator || !enabled ? { ...snapshot, progress, retry, settle } : UNMANAGED_MEDIA_LEASE),
    [coordinator, enabled, progress, retry, settle, snapshot]
  );
}
