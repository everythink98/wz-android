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
import { recordImageBudgetTimeout } from '@/platform/media/imageLoadDiagnostics';
import { recordMediaBudgetTimeout } from '@/platform/media/mediaPlaybackDiagnostics';
import { TopicAudioSessionProvider } from './TopicAudioSession';
import { MediaPlaybackSession, MediaPlaybackSessionContext } from '@/platform/media/mediaPlaybackSession';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

const MAX_WARM_BLOCK_MEDIA = 8;
const MAX_IN_FLIGHT_BODY_MEDIA = 4;
const MEDIA_NO_PROGRESS_TIMEOUT_MS = 30_000;

type TopicBodyMediaKind = 'audio' | 'base' | 'inline' | 'sticker' | 'poster' | 'video' | 'original';
type TopicBodyMediaPriority = 'visible' | 'prefetch' | 'upgrade' | 'user';
type TopicBodyMediaOutcome = 'displayed' | 'error';
type TopicBodyMediaFailure = 'error' | 'timeout' | null;
type TopicBodyMediaEntryState =
  | { phase: 'waiting' }
  | { phase: 'running'; deadline: number; lastProgressValue: number | null }
  | { phase: 'displayed' }
  | { phase: 'failed'; failure: Exclude<TopicBodyMediaFailure, null> };

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
  key: string;
  kind: TopicBodyMediaKind;
  listener: (snapshot: TopicBodyMediaSnapshot) => void;
  priority: TopicBodyMediaPriority;
  requestIdentity: string;
  rowKey: string;
  sequence: number;
  snapshot: TopicBodyMediaSnapshot;
  state: TopicBodyMediaEntryState;
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
  private displayedRows = new Set<string>();
  private displayedRowsListener: ((rows: ReadonlySet<string>) => void) | undefined;
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
  private recomputeScheduled = false;
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

  observeDisplayedRows(listener: ((rows: ReadonlySet<string>) => void) | undefined) {
    this.displayedRowsListener = listener;
    listener?.(this.displayedRows);
    return () => {
      if (this.displayedRowsListener === listener) this.displayedRowsListener = undefined;
    };
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
      key: options.key,
      kind: options.kind,
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
      state: { phase: 'waiting' }
    };
    const identityFailure = this.failedIdentities.get(entry.requestIdentity);
    if (identityFailure) {
      entry.state = { phase: 'failed', failure: identityFailure };
    }
    this.entries.set(entry.key, entry);
    this.scheduleRecompute();
    return () => {
      if (this.entries.get(entry.key) !== entry) return;
      if (entry.state.phase === 'running') this.cancelCount += 1;
      this.entries.delete(entry.key);
      this.warmKeys.delete(entry.key);
      this.scheduleRecompute();
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
      if (entry.state.phase !== 'running') continue;
      this.cancelCount += 1;
      entry.attempt += 1;
      entry.attachmentRevision += 1;
      entry.state = { phase: 'running', deadline, lastProgressValue: null };
      restarted = true;
    }
    if (restarted) this.recompute();
  }

  settle(key: string, attemptId: string, outcome: TopicBodyMediaOutcome) {
    const entry = this.entries.get(key);
    if (
      !entry ||
      (entry.state.phase !== 'running' && !(outcome === 'error' && entry.state.phase === 'displayed')) ||
      attemptId !== this.attemptIdFor(entry)
    ) {
      return;
    }
    if (outcome === 'error') {
      this.errorCount += 1;
      if (!entry.automaticRetry || !this.beginAutomaticRetry(entry.requestIdentity, entry.key)) {
        this.failIdentity(entry.requestIdentity, 'error', entry.key);
      }
    } else {
      this.displayCount += 1;
      entry.state = { phase: 'displayed' };
      this.failedIdentities.delete(entry.requestIdentity);
      for (const duplicate of this.entries.values()) {
        if (duplicate.requestIdentity === entry.requestIdentity && duplicate.state.phase === 'failed') {
          duplicate.state = { phase: 'waiting' };
        }
      }
    }
    this.recompute();
  }

  progress(key: string, attemptId: string, value: number) {
    const entry = this.entries.get(key);
    if (
      !entry ||
      entry.state.phase !== 'running' ||
      attemptId !== this.attemptIdFor(entry) ||
      !Number.isFinite(value) ||
      (entry.state.lastProgressValue !== null && value <= entry.state.lastProgressValue)
    ) {
      return;
    }
    entry.state.lastProgressValue = value;
    entry.state.deadline = Date.now() + MEDIA_NO_PROGRESS_TIMEOUT_MS;
    this.scheduleTimer();
  }

  markFirstRowElapsed(elapsedMs: number) {
    if (this.firstRowElapsedMs !== undefined || !Number.isFinite(elapsedMs)) return;
    this.firstRowElapsedMs = Math.max(0, Math.floor(elapsedMs));
  }

  retry(key: string, attemptId: string) {
    const entry = this.entries.get(key);
    if (
      !entry ||
      attemptId !== this.attemptIdFor(entry) ||
      entry.state.phase !== 'failed' ||
      this.explicitlyRetriedIdentities.has(entry.requestIdentity)
    )
      return;
    this.explicitlyRetriedIdentities.add(entry.requestIdentity);
    this.retryCount += 1;
    this.resetIdentityForRetry(entry.requestIdentity, entry.key);
    this.recompute();
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (entry.state.phase === 'running') this.cancelCount += 1;
    }
    this.captureHighWater();
    this.finishDiagnosticAggregate();
    this.disposed = true;
    this.recomputeScheduled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDeadline = null;
    this.entries.clear();
    this.automaticallyRetriedIdentities.clear();
    this.explicitlyRetriedIdentities.clear();
    this.failedIdentities.clear();
    this.warmKeys.clear();
  }

  isDisposed() {
    return this.disposed;
  }

  private captureHighWater(runningCount?: number) {
    if (runningCount === undefined) {
      runningCount = 0;
      for (const entry of this.entries.values()) {
        if (entry.state.phase === 'running') runningCount += 1;
      }
    }
    this.warmHighWater = Math.max(this.warmHighWater, this.warmKeys.size);
    this.runningHighWater = Math.max(this.runningHighWater, runningCount);
    this.timerHighWater = Math.max(this.timerHighWater, this.timer ? 1 : 0);
  }

  private failIdentity(
    requestIdentity: string,
    failure: Exclude<TopicBodyMediaFailure, null>,
    failedEntryKey?: string
  ) {
    this.failedIdentities.set(requestIdentity, failure);
    for (const entry of this.entries.values()) {
      if (
        entry.requestIdentity !== requestIdentity ||
        (entry.state.phase === 'displayed' && entry.key !== failedEntryKey)
      ) {
        continue;
      }
      entry.state = { phase: 'failed', failure };
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
      if (
        entry.requestIdentity !== requestIdentity ||
        (entry.state.phase === 'displayed' && entry.key !== retryEntryKey)
      ) {
        continue;
      }
      entry.attachmentRevision += 1;
      entry.state = { phase: 'waiting' };
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

  private attemptIdFor(entry: TopicBodyMediaEntry) {
    // An unstarted lease has no callbacks to accept and needs no idle-state commit.
    return entry.attempt === 0 && entry.state.phase === 'waiting'
      ? `${entry.key}:0`
      : `${entry.key}:${entry.sequence}:${entry.attempt}`;
  }

  private snapshotFor(entry: TopicBodyMediaEntry): TopicBodyMediaSnapshot {
    return {
      admitted: entry.state.phase === 'displayed' || (this.warmKeys.has(entry.key) && entry.state.phase === 'running'),
      attachmentKey: `${entry.key}:attachment:${entry.attachmentRevision}`,
      attemptId: this.attemptIdFor(entry),
      failure: entry.state.phase === 'failed' ? entry.state.failure : null
    };
  }

  private scheduleRecompute() {
    if (this.disposed || this.recomputeScheduled) return;
    this.recomputeScheduled = true;
    void Promise.resolve().then(() => {
      if (!this.recomputeScheduled || this.disposed) return;
      this.recompute();
    });
  }

  private recompute() {
    if (this.disposed) return;
    this.recomputeScheduled = false;
    const rowOrder = new Map(this.viewportRowKeys.map((rowKey, index) => [rowKey, index]));
    const visibleRows = new Set(this.visibleRowKeys);
    const eligible = [...this.entries.values()]
      .filter(
        (entry) =>
          rowOrder.has(entry.rowKey) &&
          (entry.kind !== 'audio' || visibleRows.has(entry.rowKey)) &&
          entry.state.phase !== 'failed' &&
          entry.state.phase !== 'displayed'
      )
      .sort((left, right) => {
        const leftRetained = left.state.phase === 'running' ? 0 : 1;
        const rightRetained = right.state.phase === 'running' ? 0 : 1;
        return (
          PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
          (rowOrder.get(left.rowKey) ?? 0) - (rowOrder.get(right.rowKey) ?? 0) ||
          leftRetained - rightRetained ||
          left.sequence - right.sequence
        );
      });
    const scheduledKeys = new Set<string>();
    if (this.active) {
      const scheduledIdentities = new Set<string>();
      let scheduledOriginalCount = 0;
      for (const entry of eligible) {
        if (scheduledKeys.size >= MAX_IN_FLIGHT_BODY_MEDIA) break;
        if (this.paused && entry.state.phase !== 'running') continue;
        if (scheduledIdentities.has(entry.requestIdentity)) continue;
        if (entry.kind === 'original' && scheduledOriginalCount >= 1) continue;
        scheduledKeys.add(entry.key);
        scheduledIdentities.add(entry.requestIdentity);
        if (entry.kind === 'original') scheduledOriginalCount += 1;
      }
    }
    // Every running request must also have a renderable warm instance, even after duplicates.
    this.warmKeys = new Set(scheduledKeys);
    for (const entry of eligible) {
      if (this.warmKeys.size >= MAX_WARM_BLOCK_MEDIA) break;
      this.warmKeys.add(entry.key);
    }

    let runningCount = 0;
    let runningOriginalCount = 0;
    const runningIdentities = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.state.phase === 'running' && !scheduledKeys.has(entry.key)) {
        this.cancelCount += 1;
        entry.state = { phase: 'waiting' };
      }
      if (entry.state.phase === 'running') {
        runningCount += 1;
        runningIdentities.add(entry.requestIdentity);
        if (entry.kind === 'original') runningOriginalCount += 1;
      }
    }

    if (this.active && !this.paused) {
      for (const entry of eligible) {
        if (runningCount >= MAX_IN_FLIGHT_BODY_MEDIA) break;
        if (!scheduledKeys.has(entry.key) || entry.state.phase !== 'waiting') continue;
        if (runningIdentities.has(entry.requestIdentity)) continue;
        if (entry.kind === 'original' && runningOriginalCount >= 1) continue;
        entry.attempt += 1;
        entry.state = {
          phase: 'running',
          deadline: Date.now() + MEDIA_NO_PROGRESS_TIMEOUT_MS,
          lastProgressValue: null
        };
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
    this.captureHighWater(runningCount);
    for (const entry of this.entries.values()) {
      const next = this.snapshotFor(entry);
      if (!sameSnapshot(entry.snapshot, next)) {
        entry.snapshot = next;
        entry.listener(next);
      }
    }
    const displayedRows = new Set(
      [...this.entries.values()].filter((entry) => entry.state.phase === 'displayed').map((entry) => entry.rowKey)
    );
    if (
      displayedRows.size !== this.displayedRows.size ||
      [...displayedRows].some((key) => !this.displayedRows.has(key))
    ) {
      this.displayedRows = displayedRows;
      this.displayedRowsListener?.(displayedRows);
    }
  }

  private scheduleTimer() {
    if (this.disposed) return;
    let nextDeadline: number | null = null;
    for (const entry of this.entries.values()) {
      if (entry.state.phase === 'running') {
        nextDeadline = nextDeadline === null ? entry.state.deadline : Math.min(nextDeadline, entry.state.deadline);
      }
    }
    if (nextDeadline === null) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.timerDeadline = null;
      return;
    }
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
          if (entry.state.phase === 'running' && entry.state.deadline <= now) {
            if (entry.kind !== 'audio' && entry.kind !== 'video') {
              recordImageBudgetTimeout(entry.requestIdentity, MEDIA_NO_PROGRESS_TIMEOUT_MS);
            } else recordMediaBudgetTimeout(entry.requestIdentity, entry.kind, MEDIA_NO_PROGRESS_TIMEOUT_MS);
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

export function monotonicNowMs() {
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
  onDisplayedRowsChange?: (rows: ReadonlySet<string>) => void;
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
  onDisplayedRowsChange,
  paused,
  runtimeGeneration,
  visibleRowKeys,
  viewportRowKeys
}: CoordinatorGate & {
  children: ReactNode;
  diagnosticSession?: TopicBodyMediaDiagnosticSession;
  onDiagnosticFinish?: TopicBodyMediaAggregateReporter;
  onDisplayedRowsChange?: (rows: ReadonlySet<string>) => void;
  runtimeGeneration: number;
}) {
  const createResources = useCallback(
    () => ({
      playback: new MediaPlaybackSession(),
      coordinator: new TopicBodyMediaCoordinator(
        { active, paused, visibleRowKeys, viewportRowKeys },
        diagnosticSession,
        undefined,
        runtimeGeneration
      )
    }),
    [active, diagnosticSession, paused, runtimeGeneration, visibleRowKeys, viewportRowKeys]
  );
  const createResourcesRef = useCommittedRef(createResources);
  const [{ playback, coordinator }, setResources] = useState(createResources);
  const currentCoordinatorRef = useCommittedRef(coordinator);
  const onDiagnosticFinishRef = useCommittedRef(onDiagnosticFinish);
  const reportCurrentDiagnostic = useCallback(
    (aggregate: TopicBodyMediaAggregate) => {
      const reporter = onDiagnosticFinishRef.current;
      // A replayed setup replaces the retired resource before its queued summary is observed.
      return Promise.resolve().then(() => {
        if (currentCoordinatorRef.current === coordinator) return reporter?.(aggregate);
      });
    },
    [coordinator, currentCoordinatorRef, onDiagnosticFinishRef]
  );
  useLayoutEffect(() => {
    if (coordinator.isDisposed()) {
      setResources(createResourcesRef.current());
      return;
    }
    return () => coordinator.dispose();
  }, [coordinator, createResourcesRef]);
  useLayoutEffect(() => playback.updateGate(active && !paused, !paused), [active, paused, playback]);
  useLayoutEffect(() => () => playback.dispose(), [playback]);
  useLayoutEffect(() => {
    coordinator.updateGate({ active, paused, visibleRowKeys, viewportRowKeys });
  }, [active, coordinator, paused, visibleRowKeys, viewportRowKeys]);
  useLayoutEffect(() => {
    coordinator.updateDiagnosticReporter(diagnosticSession, onDiagnosticFinish ? reportCurrentDiagnostic : undefined);
  }, [coordinator, diagnosticSession, onDiagnosticFinish, reportCurrentDiagnostic]);
  useLayoutEffect(() => coordinator.observeDisplayedRows(onDisplayedRowsChange), [coordinator, onDisplayedRowsChange]);
  useLayoutEffect(() => {
    coordinator.restartRunningForRuntimeGeneration(runtimeGeneration);
  }, [coordinator, runtimeGeneration]);
  return (
    <TopicBodyMediaCoordinatorContext.Provider value={coordinator}>
      <MediaPlaybackSessionContext.Provider value={playback}>
        <TopicAudioSessionProvider active={active} paused={paused} runtimeGeneration={runtimeGeneration}>
          {children}
        </TopicAudioSessionProvider>
      </MediaPlaybackSessionContext.Provider>
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
  const descriptor = useMemo(
    () => ({ automaticRetry, coordinator, enabled, key, kind, priority, requestIdentity, rowKey }),
    [automaticRetry, coordinator, enabled, key, kind, priority, requestIdentity, rowKey]
  );
  const [registeredSnapshot, setRegisteredSnapshot] = useState<{
    descriptor: typeof descriptor;
    registration: { active: boolean } | null;
    snapshot: TopicBodyMediaSnapshot;
  }>(() => ({ descriptor, registration: null, snapshot: idleSnapshot }));
  const snapshot =
    !enabled || (coordinator && !rowKey)
      ? idleSnapshot
      : registeredSnapshot.descriptor === descriptor && registeredSnapshot.registration?.active
        ? registeredSnapshot.snapshot
        : idleSnapshot;
  useEffect(() => {
    if (!coordinator || !rowKey || !enabled) return undefined;
    const registration = { active: true };
    const unregister = coordinator.register(descriptor, (nextSnapshot) => {
      if (registration.active) setRegisteredSnapshot({ descriptor, registration, snapshot: nextSnapshot });
    });
    return () => {
      registration.active = false;
      unregister();
    };
  }, [coordinator, descriptor, enabled, rowKey]);
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
  const retry = useCallback(() => coordinator?.retry(key, snapshot.attemptId), [coordinator, key, snapshot.attemptId]);
  return useMemo(
    () => (coordinator || !enabled ? { ...snapshot, progress, retry, settle } : UNMANAGED_MEDIA_LEASE),
    [coordinator, enabled, progress, retry, settle, snapshot]
  );
}
