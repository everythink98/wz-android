import type { QueryClient } from '@tanstack/react-query';
import {
  EMPTY_DISCOURSE_READING_STATE,
  mergeDiscourseReading,
  type DiscourseReadingState
} from '@/domain/forum/discourseReading';
import type { DiscourseTopicReading, ReadingAnchor } from '@/domain/forum/models';
import type { LinuxDoReadingRecovery } from '@/domain/session/sessionContracts';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';

export const discourseReadingQueryKey = (scope: string | null) => ['linuxdo-reading', scope] as const;
let readingBatchSequence = 0;
export interface ReadingBatch {
  topicId: string;
  topicTime: number;
  timings: Record<number, number>;
}
interface ReadingRequest {
  scope: string | null;
  sequence: number;
  localVersion: number;
}
type PendingBatch = ReadingBatch & {
  id: number;
  scope: string;
  born: number;
  attempts: number;
  sends: number;
  due: number;
};
type ReadingSendContext = {
  batchId: number;
  attempt: number;
  batchAgeMs: number;
  recovery: boolean;
  beforePost: () => void;
};
export interface ReadingSession {
  visible: (floors: readonly number[], anchor?: ReadingAnchor) => void;
  active: (active: boolean) => void;
  interact: () => void;
  end: () => void;
}

type ReadingSealSchedule = { phase: 'first' } | { phase: 'paced'; at: number };
type ReadingFlight = { batch: PendingBatch; controller: AbortController };
type ReadingTransport =
  | { phase: 'idle' }
  | { phase: 'scheduled'; timer: ReturnType<typeof setTimeout> }
  | { phase: 'sending'; flight: ReadingFlight };
type RecoveryExecution = { phase: 'available' } | { phase: 'claimed' } | { phase: 'waiting'; cancel: () => void };
type ReadingRecoveryAttempt = { batch: PendingBatch; handle: LinuxDoReadingRecovery; execution: RecoveryExecution };
type ReadingRecoveryGate =
  { phase: 'open' } | { phase: 'paused' } | { phase: 'verification'; attempt: ReadingRecoveryAttempt };

/** Query owns observable facts; the bounded queue owns only unacknowledged increments. */
export function createDiscourseReadingRuntime({
  queryClient,
  scope,
  send,
  now = () => performance.now(),
  onError,
  onVerificationRequired
}: {
  queryClient: QueryClient;
  scope: () => string | null;
  send: (batch: ReadingBatch, identity: string, signal: AbortSignal, context: ReadingSendContext) => Promise<void>;
  now?: () => number;
  onError?: (error: unknown) => void;
  onVerificationRequired?: (recovery: LinuxDoReadingRecovery) => void;
}) {
  let sequence = 0;
  let localVersion = 0;
  let foreground = true;
  let backgroundAllowance = 0;
  let disposed = false;
  let appActive = true;
  let recoveryGate: ReadingRecoveryGate = { phase: 'open' };
  const deferredRecovery = Object.assign(new Error('阅读恢复等待前台或批次已过期'), { reason: 'canceled' });
  let currentScope = scope();
  let queue: PendingBatch[] = [];
  let sendNotBefore = 0;
  let transport: ReadingTransport = { phase: 'idle' };
  const activeFlight = () => (transport.phase === 'sending' ? transport.flight : undefined);
  const paused = () => recoveryGate.phase !== 'open';
  const recoveryAttempt = () => (recoveryGate.phase === 'verification' ? recoveryGate.attempt : undefined);
  const cancelRecoveryWait = () => {
    const current = recoveryAttempt();
    if (current?.execution.phase === 'waiting') current.execution.cancel();
  };
  const clearWake = () => {
    if (transport.phase !== 'scheduled') return;
    clearTimeout(transport.timer);
    transport = { phase: 'idle' };
  };
  const finishFlight = (flight: ReadingFlight) => {
    if (transport.phase === 'sending' && transport.flight === flight) transport = { phase: 'idle' };
  };
  const sessions = new Set<{
    topicId: string;
    totals: Map<number, number>;
    pending: () => boolean;
    tick: () => void;
    seal: () => void;
    stop: () => void;
    foreground: (active: boolean) => void;
    discard: () => void;
  }>();
  const state = (): DiscourseReadingState =>
    queryClient.getQueryData(discourseReadingQueryKey(scope())) || EMPTY_DISCOURSE_READING_STATE;
  const publish = (topicId: string, entry: DiscourseReadingState[string]) => {
    queryClient.setQueryData<DiscourseReadingState>(discourseReadingQueryKey(scope()), (previous) => ({
      ...previous,
      [topicId]: entry
    }));
  };
  const pending = (topicId: string) =>
    recoveryAttempt()?.batch.topicId === topicId ||
    queue.some((batch) => batch.topicId === topicId) ||
    activeFlight()?.batch.topicId === topicId ||
    [...sessions].some((session) => session.topicId === topicId && session.pending());
  const startRequest = (): ReadingRequest => ({ scope: scope(), sequence: ++sequence, localVersion });
  const observe = (snapshots: readonly DiscourseTopicReading[], request: ReadingRequest) => {
    if (!snapshots.length || !request.scope || scope() !== request.scope || disposed) return;
    const key = discourseReadingQueryKey(request.scope);
    const current = queryClient.getQueryData<DiscourseReadingState>(key) || EMPTY_DISCOURSE_READING_STATE;
    let updated: Record<string, DiscourseReadingState[string]> | undefined;
    for (const snapshot of snapshots) {
      const previous = (updated ?? current)[snapshot.topicId];
      const next = mergeDiscourseReading(previous, snapshot, request, Boolean(pending(snapshot.topicId)));
      if (next === previous) continue;
      updated ??= { ...current };
      updated[snapshot.topicId] = next;
    }
    if (updated) queryClient.setQueryData(key, updated);
  };
  const record = (batch: PendingBatch, state: DiagnosticFields['readingRecoveryState']) => {
    const trace = beginDiagnosticTrace('source', 'reading-recovery', {
      source: 'linuxdo',
      batchId: batch.id,
      attempt: batch.sends,
      batchAgeMs: Math.max(0, now() - batch.born),
      readingRecoveryState: state,
      count: Object.keys(batch.timings).length
    });
    finishDiagnosticTrace(
      trace,
      state === 'blocked' || state === 'paused'
        ? 'blocked'
        : state === 'failed'
          ? 'failure'
          : state === 'canceled'
            ? 'canceled'
            : state === 'stale' || state === 'expired'
              ? 'stale'
              : 'success'
    );
  };
  const unpause = () => {
    cancelRecoveryWait();
    recoveryGate = { phase: 'open' };
    sessions.forEach((session) => session.foreground(foreground));
  };
  const deliver = async (batch: PendingBatch, controller: AbortController, recovering: boolean) => {
    await send(
      { topicId: batch.topicId, topicTime: batch.topicTime, timings: batch.timings },
      batch.scope,
      controller.signal,
      {
        batchId: batch.id,
        attempt: ++batch.sends,
        batchAgeMs: Math.max(0, now() - batch.born),
        recovery: recovering,
        beforePost: () => {
          if (recovering && (!appActive || now() - batch.born > 100000)) throw deferredRecovery;
        }
      }
    );
    if (disposed || scope() !== batch.scope || controller.signal.aborted) return;
    const current = state()[batch.topicId];
    if (!current) return;
    const highest = Math.max(current.server.lastReadPostNumber || 0, ...Object.keys(batch.timings).map(Number));
    publish(batch.topicId, {
      ...current,
      visited: true,
      server: { ...current.server, lastReadPostNumber: highest },
      requestSequence: ++sequence
    });
  };
  const retry = (batch: PendingBatch, error: unknown) => {
    const failure = error as { safeToRetry?: boolean; retryAfterMs?: number } | null;
    if (failure?.safeToRetry && Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs! > 0)
      sendNotBefore = Math.max(sendNotBefore, now() + failure.retryAfterMs!);
    const delay = [5000, 10000, 20000, 40000][batch.attempts];
    if (failure?.safeToRetry && delay !== undefined && now() - batch.born < 100000)
      queue.push({ ...batch, attempts: batch.attempts + 1, due: now() + Math.max(delay, failure.retryAfterMs || 0) });
  };
  const requireVerification = (batch: PendingBatch, error: unknown) => {
    const ownRecovery: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: batch.id,
      isCurrent: () => !disposed && scope() === batch.scope && recoveryAttempt() === attempt,
      isExpired: () => now() - batch.born > 100000,
      cancel: () => {
        if (!ownRecovery.isCurrent()) return;
        record(batch, 'canceled');
        cancelRecoveryWait();
        activeFlight()?.controller.abort();
        queue = [];
        sessions.forEach((session) => session.discard());
        recoveryGate = { phase: 'paused' };
        // Keep this reading session paused until a new entry or explicit verification.
      },
      resume: async () => {
        if (!ownRecovery.isCurrent() || !appActive || activeFlight() || attempt.execution.phase !== 'available')
          return 'stale';
        attempt.execution = { phase: 'claimed' };
        try {
          const remaining = sendNotBefore - now();
          if (remaining > 0)
            await new Promise<void>((resolve) => {
              const complete = () => {
                clearTimeout(timer);
                if (attempt.execution === waiting) attempt.execution = { phase: 'claimed' };
                resolve();
              };
              const timer = setTimeout(complete, Math.min(remaining, Math.max(0, 100001 - (now() - batch.born))));
              const waiting: RecoveryExecution = { phase: 'waiting', cancel: complete };
              attempt.execution = waiting;
            });
          if (!ownRecovery.isCurrent() || !appActive) return 'stale';
          if (now() - batch.born > 100000) {
            record(batch, 'expired');
            unpause();
            pump();
            return 'stale';
          }
          const controller = new AbortController();
          const flight = { batch, controller };
          transport = { phase: 'sending', flight };
          record(batch, 'resuming');
          try {
            await deliver(batch, controller, true);
            if (!ownRecovery.isCurrent() || controller.signal.aborted) return 'stale';
            record(batch, 'completed');
            unpause();
            return 'completed';
          } catch (error) {
            if (!ownRecovery.isCurrent() || controller.signal.aborted) return 'stale';
            if (error === deferredRecovery) {
              const expired = now() - batch.born > 100000;
              record(batch, expired ? 'expired' : 'paused');
              if (expired) unpause();
              return 'stale';
            }
            if ((error as { reason?: string }).reason === 'cloudflare') {
              const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
              if (Number.isFinite(retryAfter) && retryAfter! > 0)
                sendNotBefore = Math.max(sendNotBefore, now() + retryAfter!);
              record(batch, 'blocked');
              return 'verification-required';
            }
            record(batch, 'failed');
            ownRecovery.failureMessage = error instanceof Error ? error.message : '阅读同步请求失败';
            unpause();
            return 'failed';
          } finally {
            finishFlight(flight);
            pump();
          }
        } finally {
          attempt.execution = { phase: 'available' };
        }
      }
    };
    const attempt: ReadingRecoveryAttempt = { batch, handle: ownRecovery, execution: { phase: 'available' } };
    recoveryGate = { phase: 'verification', attempt };
    sessions.forEach((session) => session.foreground(false));
    const delay = (error as { retryAfterMs?: number }).retryAfterMs;
    if (Number.isFinite(delay) && delay! > 0) sendNotBefore = Math.max(sendNotBefore, now() + delay!);
    record(batch, 'paused');
    if (appActive) onVerificationRequired?.(ownRecovery);
  };
  const pump = () => {
    clearWake();
    queue = queue.filter((batch) => {
      const current = now() - batch.born <= 100000 && batch.scope === scope();
      if (!current) record(batch, scope() !== batch.scope ? 'stale' : 'expired');
      return current;
    });
    if (disposed || paused() || activeFlight() || (!foreground && backgroundAllowance <= 0) || !queue.length) return;
    const nextDue = Math.max(sendNotBefore, Math.min(...queue.map((batch) => batch.due)));
    if (nextDue > now()) {
      if (foreground) transport = { phase: 'scheduled', timer: setTimeout(pump, Math.max(1, nextDue - now())) };
      return;
    }
    const index = queue.findIndex((batch) => batch.due <= now());
    const [batch] = queue.splice(index, 1);
    if (!foreground) backgroundAllowance--;
    const controller = new AbortController();
    const flight = { batch, controller };
    transport = { phase: 'sending', flight };
    // The transport must not replay an ambiguous POST failure.
    void deliver(batch, controller, false)
      .then(
        () => undefined,
        (error: unknown) => {
          if (disposed || scope() !== batch.scope || controller.signal.aborted) return;
          if ((error as { reason?: string }).reason === 'cloudflare') {
            requireVerification(batch, error);
            return;
          }
          onError?.(error);
          retry(batch, error);
        }
      )
      .finally(() => {
        finishFlight(flight);
        pump();
      });
  };
  const begin = (topicId: string): ReadingSession => {
    if (recoveryGate.phase === 'paused') unpause();
    const identity = scope();
    let phase: 'inactive' | 'active' | 'ended' = 'inactive';
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastTick = now();
    let lastInteraction = now();
    let sealSchedule: ReadingSealSchedule = { phase: 'first' };
    let bufferStart = now();
    let topicTime = 0;
    let timings: Record<number, number> = {};
    let bufferContent: 'known' | 'new' = 'known';
    let anchor: ReadingAnchor | undefined;
    let onscreen = new Map<number, number>();
    const totals = [...sessions].find((session) => session.topicId === topicId)?.totals || new Map<number, number>();
    const valid = () => phase !== 'ended' && Boolean(identity) && scope() === identity && !disposed;
    const seal = () => {
      if (!topicTime || !Object.keys(timings).length) return;
      if (valid())
        queue.push({
          topicId,
          topicTime,
          timings,
          id: ++readingBatchSequence,
          scope: identity!,
          born: bufferStart,
          attempts: 0,
          sends: 0,
          due: now()
        });
      timings = {};
      topicTime = 0;
      bufferContent = 'known';
      const sealedAt = now();
      sealSchedule = sealedAt === Number.NEGATIVE_INFINITY ? { phase: 'first' } : { phase: 'paced', at: sealedAt };
      bufferStart = now();
      pump();
    };
    const tick = () => {
      const time = now();
      const diff = time - lastTick;
      lastTick = time;
      if (
        !valid() ||
        paused() ||
        phase !== 'active' ||
        !foreground ||
        time - lastInteraction >= 180000 ||
        diff <= 0 ||
        diff > 2000
      )
        return;
      if (topicTime && (topicTime + diff > 60000 || time - bufferStart > 60000)) seal();
      const eligible = [...onscreen].filter(
        ([floor, since]) => time - since >= 1000 && (totals.get(floor) || 0) < 360000
      );
      if (!eligible.length) return;
      if (!topicTime) bufferStart = time - diff;
      let current = state()[topicId] || mergeDiscourseReading(undefined, { topicId }, startRequest(), false);
      let readPosts = current.readPosts;
      let changed = false;
      for (const [floor, since] of eligible) {
        const increment = Math.min(diff, time - since, 360000 - (totals.get(floor) || 0));
        totals.set(floor, (totals.get(floor) || 0) + increment);
        timings[floor] = (timings[floor] || 0) + increment;
        if (!readPosts[floor]) {
          if (readPosts === current.readPosts) readPosts = { ...readPosts };
          readPosts[floor] = true;
          changed = true;
          bufferContent = 'new';
        }
      }
      topicTime += diff;
      const nextAnchor =
        anchor && eligible.some(([floor]) => floor === anchor!.floor) ? anchor : { floor: eligible[0][0] };
      if (JSON.stringify(current.anchor) !== JSON.stringify(nextAnchor)) changed = true;
      if (changed) {
        current = {
          ...current,
          readPosts,
          anchor: nextAnchor,
          highestKnown: Math.max(current.highestKnown, ...eligible.map(([floor]) => floor)),
          localVersion: ++localVersion
        };
        publish(topicId, current);
      }
      if (
        sealSchedule.phase === 'first' ||
        (bufferContent === 'new' && time - sealSchedule.at >= 5000) ||
        time - bufferStart >= 60000
      )
        seal();
      pump();
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (phase !== 'ended') phase = 'inactive';
      lastTick = now();
    };
    const resume = () => {
      lastTick = lastInteraction = now();
      onscreen = new Map([...onscreen.keys()].map((floor) => [floor, now()]));
      if (foreground && !timer) timer = setInterval(tick, 1000);
    };
    const owner = {
      topicId,
      totals,
      pending: () => topicTime > 0,
      discard() {
        topicTime = 0;
        timings = {};
        bufferContent = 'known';
        bufferStart = now();
      },
      tick,
      seal,
      stop() {
        phase = 'ended';
        stop();
      },
      foreground(active: boolean) {
        if (timer) clearInterval(timer);
        timer = undefined;
        lastTick = now();
        if (active && phase === 'active' && valid()) resume();
      }
    };
    sessions.add(owner);
    return {
      visible(floors, nextAnchor) {
        const changed =
          floors.some((floor) => !onscreen.has(floor)) || [...onscreen.keys()].some((floor) => !floors.includes(floor));
        if (changed) tick();
        const time = now();
        const next = new Map<number, number>();
        for (const floor of floors)
          if (Number.isSafeInteger(floor) && floor > 0) next.set(floor, onscreen.get(floor) ?? time);
        onscreen = next;
        anchor = nextAnchor;
      },
      active(active) {
        const previousPhase = phase;
        if ((previousPhase === 'active') === active || previousPhase === 'ended') return;
        if (!active) {
          tick();
          seal();
          stop();
        } else if (valid()) {
          // A scope callback can end this session while valid() is being checked.
          if (phase !== 'ended') phase = 'active';
          resume();
        }
      },
      interact() {
        if (now() - lastInteraction >= 180000) lastTick = now();
        lastInteraction = now();
      },
      end() {
        if (phase === 'ended') return;
        tick();
        seal();
        stop();
        phase = 'ended';
        sessions.delete(owner);
      }
    };
  };
  return {
    state,
    startRequest,
    observe,
    begin,
    scope,
    setAppActive(active: boolean) {
      appActive = active;
      if (!active) cancelRecoveryWait();
      const recovery = recoveryAttempt();
      if (active && recovery) onVerificationRequired?.(recovery.handle);
    },
    verified() {
      if (recoveryGate.phase === 'paused') {
        unpause();
        pump();
      }
    },
    foreground(active: boolean) {
      if (foreground === active) return;
      if (!active) {
        for (const session of sessions) {
          session.tick();
          session.seal();
        }
        backgroundAllowance = paused() ? 0 : 1;
      }
      foreground = active;
      sessions.forEach((session) => session.foreground(active && !paused()));
      pump();
    },
    sessionChanged() {
      if (scope() === currentScope) return;
      cancelRecoveryWait();
      const recovery = recoveryAttempt();
      if (recovery) record(recovery.batch, 'stale');
      recoveryGate = { phase: 'open' };
      sessions.forEach((session) => session.stop());
      sessions.clear();
      activeFlight()?.controller.abort();
      queue = [];
      sendNotBefore = 0;
      clearWake();
      if (currentScope) queryClient.removeQueries({ queryKey: discourseReadingQueryKey(currentScope), exact: true });
      currentScope = scope();
    },
    dispose() {
      disposed = true;
      cancelRecoveryWait();
      const recovery = recoveryAttempt();
      if (recovery) record(recovery.batch, 'stale');
      recoveryGate = { phase: 'open' };
      sessions.forEach((session) => session.stop());
      sessions.clear();
      activeFlight()?.controller.abort();
      queue = [];
      clearWake();
    }
  };
}

export type DiscourseReadingRuntime = ReturnType<typeof createDiscourseReadingRuntime>;
