import { useCallback, useState } from 'react';
import type { ReplyWindowPosition, SourceErrorInfo } from '@/domain/forum/models';
import type { ReplyRefreshCommand } from './model/types';
import type { ReplyWindowEdge } from './model/replyPagination';

export type ReplyWindowErrorSlot = ReplyWindowEdge | 'refresh';
export type ReplyRetryMode = 'query' | 'whole' | 'none' | ReplyRefreshCommand;
export type ReplyFailure = { error: SourceErrorInfo; position: ReplyWindowPosition; retryMode: ReplyRetryMode };
type ReplyWindowFailures = Record<ReplyWindowErrorSlot, ReplyFailure | null>;
const EMPTY_FAILURES: ReplyWindowFailures = { start: null, end: null, refresh: null };
export type ReplyWindowRun = Readonly<{ isCurrent: () => boolean; ownsIntent: () => boolean }>;
type RouteRequest = Readonly<{ key: string; queryIdentity: string }>;
type RouteTarget =
  { phase: 'empty' } | { phase: 'pending'; request: RouteRequest } | { phase: 'settled'; request: RouteRequest };

function createWindowLifecycle(activeScope: () => string) {
  let currentRun: ReplyWindowRun | null = null;
  let location: { run: ReplyWindowRun; queryKey: readonly unknown[] } | null = null;
  let route: RouteTarget = { phase: 'empty' };
  const ownedCaches = new Map<string, readonly unknown[]>();
  const beginRead = (scope: string) => {
    const run: ReplyWindowRun = {
      isCurrent: () => run.ownsIntent() && activeScope() === scope,
      ownsIntent: () => currentRun === run
    };
    currentRun = run;
    return run;
  };
  return {
    beginRead,
    invalidate() {
      currentRun = null;
    },
    beginLocation(scope: string, queryKey: readonly unknown[]) {
      const run = beginRead(scope);
      location = { run, queryKey };
      return run;
    },
    cancelLocation() {
      const owned = location;
      location = null;
      if (owned?.run === currentRun) currentRun = null;
      return owned?.queryKey;
    },
    trackRouteQueries(queryKey: readonly unknown[]) {
      ownedCaches.set(JSON.stringify(queryKey), queryKey);
    },
    releaseRouteQueries(remove: (key: readonly unknown[]) => void) {
      ownedCaches.forEach(remove);
      ownedCaches.clear();
    },
    hasRoute(key: string) {
      return route.phase !== 'empty' && route.request.key === key;
    },
    routeQueryChanged(key: string, queryIdentity: string) {
      return route.phase !== 'empty' && route.request.key === key && route.request.queryIdentity !== queryIdentity;
    },
    abandonPendingRoute() {
      if (route.phase === 'pending') route = { phase: 'empty' };
    },
    forgetRouteWindow(queryIdentity: string) {
      if (route.phase === 'settled' && route.request.queryIdentity === queryIdentity) route = { phase: 'empty' };
    },
    beginRoute(key: string, queryIdentity: string) {
      const request = { key, queryIdentity };
      route = { phase: 'pending', request };
      return request;
    },
    settleRoute(request: RouteRequest) {
      if (route.phase !== 'pending' || route.request !== request) return false;
      route = { phase: 'settled', request };
      return true;
    }
  };
}

export function useTopicReplyWindow(orderScope: string, activeScope: () => string) {
  const [lifecycle] = useState(() => createWindowLifecycle(activeScope));
  const [failuresByKey, setFailures] = useState<Record<string, ReplyWindowFailures>>({});
  const recordFailure = useCallback(
    (slot: ReplyWindowErrorSlot, failure: ReplyFailure | null) => {
      setFailures((current) => ({
        ...current,
        [orderScope]: { ...(current[orderScope] || EMPTY_FAILURES), [slot]: failure }
      }));
    },
    [orderScope]
  );
  const clearErrors = useCallback(
    (edgesOnly = false) => {
      setFailures((current) => ({
        ...current,
        [orderScope]: edgesOnly
          ? { ...(current[orderScope] || EMPTY_FAILURES), start: null, end: null }
          : EMPTY_FAILURES
      }));
    },
    [orderScope]
  );
  const clearAllErrors = useCallback(() => setFailures({}), []);
  return {
    lifecycle,
    failures: failuresByKey[orderScope] || EMPTY_FAILURES,
    recordFailure,
    clearErrors,
    clearAllErrors
  };
}
