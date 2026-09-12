import type { QueryClient } from '@tanstack/react-query';
import {
  EMPTY_DISCOURSE_READING_STATE,
  mergeDiscourseReading,
  type DiscourseReadingState
} from '@/domain/forum/discourseReading';
import type { DiscourseTopicReading, ReadingAnchor } from '@/domain/forum/models';

export const discourseReadingQueryKey = (scope: string | null) => ['linuxdo-reading', scope] as const;
export interface ReadingBatch {
  topicId: string;
  topicTime: number;
  timings: Record<number, number>;
}
export interface ReadingRequest {
  scope: string | null;
  sequence: number;
  localVersion: number;
}
type PendingBatch = ReadingBatch & { scope: string; born: number; attempts: number; due: number };
export interface ReadingSession {
  visible: (floors: readonly number[], anchor?: ReadingAnchor) => void;
  active: (active: boolean) => void;
  interact: () => void;
  end: () => void;
}

/** Query owns observable facts; the bounded queue owns only unacknowledged increments. */
export function createDiscourseReadingRuntime({
  queryClient,
  scope,
  send,
  now = () => performance.now(),
  onError
}: {
  queryClient: QueryClient;
  scope: () => string | null;
  send: (batch: ReadingBatch, identity: string, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  onError?: (error: unknown) => void;
}) {
  let sequence = 0;
  let localVersion = 0;
  let foreground = true;
  let backgroundAllowance = 0;
  let disposed = false;
  let currentScope = scope();
  let queue: PendingBatch[] = [];
  let sendNotBefore = 0;
  let inFlight: { batch: PendingBatch; controller: AbortController } | undefined;
  let wake: ReturnType<typeof setTimeout> | undefined;
  const sessions = new Set<{
    topicId: string;
    totals: Map<number, number>;
    pending: () => boolean;
    tick: () => void;
    seal: () => void;
    stop: () => void;
    foreground: (active: boolean) => void;
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
    queue.some((batch) => batch.topicId === topicId) ||
    inFlight?.batch.topicId === topicId ||
    [...sessions].some((session) => session.topicId === topicId && session.pending());
  const startRequest = (): ReadingRequest => ({ scope: scope(), sequence: ++sequence, localVersion });
  const observe = (snapshot: DiscourseTopicReading, request: ReadingRequest) => {
    if (!request.scope || scope() !== request.scope || disposed) return;
    const previous = state()[snapshot.topicId];
    const next = mergeDiscourseReading(previous, snapshot, request, Boolean(pending(snapshot.topicId)));
    if (next !== previous) publish(snapshot.topicId, next);
  };
  const pump = () => {
    if (wake) clearTimeout(wake);
    wake = undefined;
    queue = queue.filter((batch) => now() - batch.born <= 100000 && batch.scope === scope());
    if (disposed || inFlight || (!foreground && backgroundAllowance <= 0) || !queue.length) return;
    const nextDue = Math.max(sendNotBefore, Math.min(...queue.map((batch) => batch.due)));
    if (nextDue > now()) {
      if (foreground) wake = setTimeout(pump, Math.max(1, nextDue - now()));
      return;
    }
    const index = queue.findIndex((batch) => batch.due <= now());
    const [batch] = queue.splice(index, 1);
    if (!foreground) backgroundAllowance--;
    const controller = new AbortController();
    const flight = { batch, controller };
    inFlight = flight;
    // The transport must not replay an ambiguous POST failure.
    void send(
      { topicId: batch.topicId, topicTime: batch.topicTime, timings: batch.timings },
      batch.scope,
      controller.signal
    )
      .then(
        () => {
          if (disposed || scope() !== batch.scope) return;
          const current = state()[batch.topicId];
          if (!current) return;
          const highest = Math.max(current.server.lastReadPostNumber || 0, ...Object.keys(batch.timings).map(Number));
          publish(batch.topicId, {
            ...current,
            visited: true,
            server: { ...current.server, lastReadPostNumber: highest },
            requestSequence: ++sequence
          });
        },
        (error: unknown) => {
          if (disposed || scope() !== batch.scope || controller.signal.aborted) return;
          onError?.(error);
          const failure = error as { safeToRetry?: boolean; retryAfterMs?: number } | null;
          if (failure?.safeToRetry && Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs! > 0)
            sendNotBefore = Math.max(sendNotBefore, now() + failure.retryAfterMs!);
          const delay = [5000, 10000, 20000, 40000][batch.attempts];
          if (failure?.safeToRetry && delay !== undefined && now() - batch.born < 100000) {
            queue.push({
              ...batch,
              attempts: batch.attempts + 1,
              due: now() + Math.max(delay, failure.retryAfterMs || 0)
            });
          }
        }
      )
      .finally(() => {
        if (inFlight === flight) inFlight = undefined;
        pump();
      });
  };
  const begin = (topicId: string): ReadingSession => {
    const identity = scope();
    let enabled = false;
    let ended = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastTick = now();
    let lastInteraction = now();
    let lastSeal = Number.NEGATIVE_INFINITY;
    let bufferStart = now();
    let topicTime = 0;
    let timings: Record<number, number> = {};
    let hasNew = false;
    let anchor: ReadingAnchor | undefined;
    let onscreen = new Map<number, number>();
    const totals = [...sessions].find((session) => session.topicId === topicId)?.totals || new Map<number, number>();
    const valid = () => !ended && Boolean(identity) && scope() === identity && !disposed;
    const seal = () => {
      if (!topicTime || !Object.keys(timings).length) return;
      if (valid())
        queue.push({ topicId, topicTime, timings, scope: identity!, born: bufferStart, attempts: 0, due: now() });
      timings = {};
      topicTime = 0;
      hasNew = false;
      lastSeal = now();
      bufferStart = now();
      pump();
    };
    const tick = () => {
      const time = now();
      const diff = time - lastTick;
      lastTick = time;
      if (!valid() || !enabled || !foreground || time - lastInteraction >= 180000 || diff <= 0 || diff > 2000) return;
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
          hasNew = true;
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
      if (lastSeal === Number.NEGATIVE_INFINITY || (hasNew && time - lastSeal >= 5000) || time - bufferStart >= 60000)
        seal();
      pump();
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      enabled = false;
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
      tick,
      seal,
      stop() {
        ended = true;
        stop();
      },
      foreground(active: boolean) {
        if (timer) clearInterval(timer);
        timer = undefined;
        lastTick = now();
        if (active && enabled && valid()) resume();
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
        if (enabled === active || ended) return;
        if (!active) {
          tick();
          seal();
          stop();
        } else if (valid()) {
          enabled = true;
          resume();
        }
      },
      interact() {
        if (now() - lastInteraction >= 180000) lastTick = now();
        lastInteraction = now();
      },
      end() {
        if (ended) return;
        tick();
        seal();
        stop();
        ended = true;
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
    foreground(active: boolean) {
      if (foreground === active) return;
      if (!active) {
        for (const session of sessions) {
          session.tick();
          session.seal();
        }
        backgroundAllowance = 1;
      }
      foreground = active;
      sessions.forEach((session) => session.foreground(active));
      pump();
    },
    sessionChanged() {
      if (scope() === currentScope) return;
      sessions.forEach((session) => session.stop());
      sessions.clear();
      inFlight?.controller.abort();
      queue = [];
      sendNotBefore = 0;
      if (wake) clearTimeout(wake);
      wake = undefined;
      if (currentScope) queryClient.removeQueries({ queryKey: discourseReadingQueryKey(currentScope), exact: true });
      currentScope = scope();
    },
    dispose() {
      disposed = true;
      sessions.forEach((session) => session.stop());
      sessions.clear();
      inFlight?.controller.abort();
      queue = [];
      if (wake) clearTimeout(wake);
    }
  };
}

export type DiscourseReadingRuntime = ReturnType<typeof createDiscourseReadingRuntime>;
