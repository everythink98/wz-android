import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { CancelledError, useQuery } from '@tanstack/react-query';
import { isCanceledRequest } from '@/platform/network/errors';
import {
  accountSessionIdentityKey,
  accountSessionSnapshotFromEvent,
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel,
  type AccountSessionSnapshot,
  type AccountStatusObservation,
  type ScopedSiteSessionEvent,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import { rejectUnauthorizedResponse, withAbortableTimeout, type Fetcher } from '@/platform/network/request';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { readAccountStatus } from '@/sources/accountRead';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import {
  readManagedCookieHeader as readManagedCookieHeaderFromNative,
  type ManagedCookieReadResult
} from '@/platform/network/managedCookies';
import { cancelForumSourceQueries, removeUnconfirmedForumSourceQueries } from './sessionQueryOwnership';
import { sessionSources, sourceCatalog, type SessionSource } from '@/domain/forum/sourceCatalog';
import { useCommittedRef, useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import {
  loadAccountSessionMigrationCompleted,
  loadAccountSessionSnapshot,
  markAccountSessionMigrationCompleted,
  saveAccountSessionSnapshot
} from '@/platform/storage/accountSessionStore';
import { NODESEEK_ACCOUNT_STATUS_URL } from '@/sources/nodeseek/accountStatus';
import { LINUXDO_ACCOUNT_STATUS_URL } from '@/sources/linuxdo/accountStatus';
import { YAOHUO_ACCOUNT_STATUS_URL } from '@/sources/yaohuo/accountStatus';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';

type RefreshAccountStatusOptions = {
  silent?: boolean;
  reconcile?: (source: SessionSource) => Promise<AccountReconcileResult>;
};
type StatusSource = SessionSource;
type SnapshotUpdater = (current: AccountSessionSnapshot) => AccountSessionSnapshot;
type RestoredAccountRecords = {
  owner: AbortSignal;
  migrationCompleted: boolean;
  stored: readonly (readonly [SessionSource, AccountSessionSnapshot | null])[];
  trace: DiagnosticTrace;
};
type AccountRestoreRun = { owner: AbortSignal; promise: Promise<void>; cancel: () => void };
type AccountRestoreState =
  | { kind: 'reading'; records: RestoredAccountRecords | null }
  | { kind: 'failed'; records: null }
  | { kind: 'loaded'; records: RestoredAccountRecords }
  | { kind: 'restoring' | 'ready'; records: RestoredAccountRecords; run: AccountRestoreRun };

type AccountProbeState =
  | { kind: 'idle'; generation: number }
  | {
      kind: 'running';
      generation: number;
      controller: AbortController;
      promise: Promise<AccountReconcileResult>;
      policy: { publishAnonymous: boolean; afterHandoff: boolean };
      surfaceGeneration: number;
      trace: DiagnosticTrace;
    };

const ACCOUNT_SESSION_MIGRATION_TIMEOUT_MS = 5_000;

function eventConfirmsTerminalIdentity(event: ScopedSiteSessionEvent) {
  return (
    event.type === 'login-expired' ||
    event.type === 'cleared' ||
    ((event.type === 'cookie-loaded' || event.type === 'session-updated') && event.loggedIn !== undefined)
  );
}

function observationConfirmsTerminalIdentity(source: StatusSource, observation: AccountStatusObservation) {
  const session = observation.session;
  if (session.site !== source) return false;
  if (session.status === 'logged-in') return accountSessionIdentityKey(session) !== `${source}:anonymous`;
  if (source === 'linuxdo' && observation.failed) return false;
  return session.status === 'anonymous' || session.status === 'verified' || session.status === 'expired';
}

function snapshotQueryDefinition(source: StatusSource) {
  return {
    enabled: false,
    initialData: () => createAccountSessionSnapshot(source),
    queryFn: async () => createAccountSessionSnapshot(source),
    queryKey: accountQueryKeys.snapshot(source)
  };
}

export function useAccountStatusController({
  enabledSources = sessionSources,
  enabledSourcesReady = true,
  getLinuxDoUserAgent,
  fetcher,
  getNodeSeekUserAgent,
  notify,
  onAccountStatusChanged,
  readManagedCookieHeader = readManagedCookieHeaderFromNative
}: {
  enabledSources?: readonly StatusSource[];
  enabledSourcesReady?: boolean;
  getLinuxDoUserAgent: () => string;
  fetcher: Fetcher;
  getNodeSeekUserAgent: () => string;
  notify: (message: string) => void;
  onAccountStatusChanged: (source: StatusSource) => void;
  readManagedCookieHeader?: (exactUrl: string) => Promise<ManagedCookieReadResult>;
}) {
  const enabledMembershipKey = sessionSources.filter((source) => enabledSources.includes(source)).join(',');
  const enabledSourceSet = useMemo(
    () => new Set<StatusSource>(enabledMembershipKey ? (enabledMembershipKey.split(',') as StatusSource[]) : []),
    [enabledMembershipKey]
  );
  const enabledSourcesRef = useRef(enabledSourceSet);
  useCommitRefValue(enabledSourcesRef, enabledSourceSet);
  const lifetimeRef = useRef(new AbortController());

  const nodeSeekStatus = useQuery(snapshotQueryDefinition('nodeseek'));
  const linuxDoStatus = useQuery(snapshotQueryDefinition('linuxdo'));
  const yaohuoStatus = useQuery(snapshotQueryDefinition('yaohuo'));
  const snapshots: Record<StatusSource, AccountSessionSnapshot> = {
    linuxdo: linuxDoStatus.data,
    nodeseek: nodeSeekStatus.data,
    yaohuo: yaohuoStatus.data
  };
  const accountSessionViewModels = useMemo<SiteSessionViewModels>(
    () => ({
      linuxdo: createAccountSessionViewModel(linuxDoStatus.data),
      nodeseek: createAccountSessionViewModel(nodeSeekStatus.data),
      yaohuo: createAccountSessionViewModel(yaohuoStatus.data)
    }),
    [linuxDoStatus.data, nodeSeekStatus.data, yaohuoStatus.data]
  );

  const commitAccountSnapshot = useCallback((source: StatusSource, update: SnapshotUpdater) => {
    let previous = createAccountSessionSnapshot(source);
    let next = previous;
    appQueryClient.setQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source), (current) => {
      previous = current || createAccountSessionSnapshot(source);
      next = update(previous);
      return next;
    });
    return { next, previous };
  }, []);

  const restoreRef = useRef<AccountRestoreState>({ kind: 'reading', records: null });
  // React receives records and ready; synchronous admission stays with the owned restore.
  const [restoreState, setRestoreState] = useState(restoreRef.current);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retryStoredAccounts = useCallback(() => {
    if (restoreRef.current.kind !== 'failed') return;
    const reading: AccountRestoreState = { kind: 'reading', records: null };
    restoreRef.current = reading;
    setRestoreState(reading);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);
  const hydrated = restoreState.kind === 'ready';
  const settleAccountSessionHandoff = useCallback(
    (source: StatusSource, error?: string) => {
      if (lifetimeRef.current.signal.aborted) return;
      commitAccountSnapshot(source, (current) => ({
        ...current,
        handoffPending: error ? true : undefined,
        lastError: error || current.lastError
      }));
    },
    [commitAccountSnapshot]
  );
  const restoredAccounts = restoreState.records;
  const interruptedSources = useMemo(
    () => restoredAccounts?.stored.filter(([, snapshot]) => snapshot?.handoffPending).map(([source]) => source) || [],
    [restoredAccounts]
  );
  // Diagnostic aggregation must not change the public reconciliation result or identity rules.
  const persistenceFailedResultsRef = useRef(new WeakSet<AccountReconcileResult>());

  const probesRef = useRef<Record<StatusSource, AccountProbeState>>({
    linuxdo: { kind: 'idle', generation: 0 },
    nodeseek: { kind: 'idle', generation: 0 },
    yaohuo: { kind: 'idle', generation: 0 }
  });

  const supersedeProbe = useCallback((source: StatusSource, reason: DiagnosticFields['reason'] = 'superseded') => {
    const activeProbe = probesRef.current[source];
    probesRef.current[source] = { kind: 'idle', generation: activeProbe.generation + 1 };
    if (activeProbe.kind === 'idle') return;
    activeProbe.controller.abort();
    finishDiagnosticTrace(activeProbe.trace, 'stale', { source, reason });
  }, []);

  useEffect(() => {
    if (lifetimeRef.current.signal.aborted) {
      lifetimeRef.current = new AbortController();
      const reading: AccountRestoreState = { kind: 'reading', records: restoreRef.current.records };
      restoreRef.current = reading;
      setRestoreState((current) => (current.kind === 'ready' ? reading : current));
    }
    const owner = lifetimeRef.current;
    return () => {
      owner.abort();
      const restore = restoreRef.current;
      if ((restore.kind === 'restoring' || restore.kind === 'ready') && restore.run.owner === owner.signal)
        restore.run.cancel();
      for (const source of sessionSources) {
        const active = probesRef.current[source];
        supersedeProbe(source, 'canceled');
        if (active.kind === 'running')
          commitAccountSnapshot(source, (snapshot) => ({ ...snapshot, isVerifying: false }));
      }
    };
  }, [commitAccountSnapshot, supersedeProbe]);

  const beginAccountSessionClear = useCallback(
    (source: StatusSource) => {
      const owner = lifetimeRef.current.signal;
      supersedeProbe(source);
      const generation = probesRef.current[source].generation;
      return () =>
        !owner.aborted &&
        lifetimeRef.current.signal === owner &&
        probesRef.current[source].generation === generation &&
        enabledSourcesRef.current.has(source);
    },
    [supersedeProbe]
  );

  const applyAccountSessionEvent = useCallback(
    (event: ScopedSiteSessionEvent) => {
      const owner = lifetimeRef.current.signal;
      if (owner.aborted || !enabledSourcesRef.current.has(event.site)) return false;
      const terminalEvent = eventConfirmsTerminalIdentity(event);
      if (terminalEvent) supersedeProbe(event.site);
      const { next, previous } = commitAccountSnapshot(event.site, (current) =>
        accountSessionSnapshotFromEvent(current, event)
      );
      if (accountSessionIdentityKey(previous) !== accountSessionIdentityKey(next)) {
        onAccountStatusChanged(event.site);
      }
      if (terminalEvent && (next.identityTrust === 'confirmed' || next.identityTrust === 'none')) {
        const generation = probesRef.current[event.site].generation;
        void saveAccountSessionSnapshot(next).catch(() => {
          if (
            owner.aborted ||
            lifetimeRef.current.signal !== owner ||
            probesRef.current[event.site].generation !== generation ||
            !enabledSourcesRef.current.has(event.site)
          )
            return;
          commitAccountSnapshot(event.site, (current) => ({
            ...current,
            lastError: `${sourceCatalog[event.site].label} 账号状态已更新，但本机保存失败。`
          }));
        });
      }
      return true;
    },
    [commitAccountSnapshot, onAccountStatusChanged, supersedeProbe]
  );

  const beginAccountIdentityCheck = useCallback(
    (source: StatusSource, surfaceGeneration?: number) => {
      if (lifetimeRef.current.signal.aborted || !enabledSourcesRef.current.has(source)) return;
      if (surfaceGeneration !== undefined) {
        const activeProbe = probesRef.current[source];
        const generation = Math.max(activeProbe.generation + 1, surfaceGeneration);
        if (activeProbe.kind === 'running' && activeProbe.surfaceGeneration < surfaceGeneration) {
          probesRef.current[source] = { kind: 'idle', generation };
          activeProbe.controller.abort();
          finishDiagnosticTrace(activeProbe.trace, 'stale', { source, reason: 'superseded' });
        } else {
          probesRef.current[source] = { ...activeProbe, generation };
        }
      }
      commitAccountSnapshot(source, (current) => ({
        ...current,
        isVerifying: true,
        lastError: undefined
      }));
    },
    [commitAccountSnapshot]
  );

  const reconcileAccountStatus = useCallback(
    (
      source: StatusSource,
      options: {
        publishAnonymous?: boolean;
        signal?: AbortSignal;
        surfaceGeneration?: number;
        parentTraceId?: string;
        beforeProbe?: () => Promise<void>;
        prepareReadRecheck?: () => { ready: Promise<void>; release: () => Promise<void> };
      } = {}
    ): Promise<AccountReconcileResult> => {
      const owner = lifetimeRef.current.signal;
      if (owner.aborted) return Promise.resolve({ status: 'stale' });
      if (!enabledSourcesRef.current.has(source)) {
        const trace = beginDiagnosticTrace('session', 'account-reconcile', { source });
        finishDiagnosticTrace(trace, 'stale', { source, reason: 'source_disabled' });
        return Promise.resolve({ status: 'stale' });
      }
      const requestedSurfaceGeneration = options.surfaceGeneration || 0;
      const activeProbe = probesRef.current[source];
      if (
        activeProbe.kind === 'running' &&
        requestedSurfaceGeneration > 0 &&
        requestedSurfaceGeneration < activeProbe.surfaceGeneration
      )
        return Promise.resolve({ status: 'stale' });
      if (
        activeProbe.kind === 'running' &&
        requestedSurfaceGeneration <= activeProbe.surfaceGeneration &&
        (!options.beforeProbe || activeProbe.policy.afterHandoff)
      ) {
        if (options.publishAnonymous !== false) activeProbe.policy.publishAnonymous = true;
        markDiagnosticStage(activeProbe.trace, 'guard', {
          source,
          state: 'busy',
          reason: 'duplicate',
          parentTraceId: options.parentTraceId
        });
        return activeProbe.promise;
      }
      if (activeProbe.kind === 'running') {
        activeProbe.controller.abort();
        finishDiagnosticTrace(activeProbe.trace, 'stale', { source, reason: 'superseded' });
      }
      beginAccountIdentityCheck(source);
      const generation =
        options.surfaceGeneration === undefined
          ? probesRef.current[source].generation + 1
          : Math.max(probesRef.current[source].generation + 1, options.surfaceGeneration);
      probesRef.current[source] = { kind: 'idle', generation };
      const trace = beginDiagnosticTrace('session', 'account-reconcile', {
        source,
        generation,
        surfaceGeneration: requestedSurfaceGeneration,
        accountCheckTrigger: options.parentTraceId
          ? 'read-failure'
          : requestedSurfaceGeneration
            ? 'surface-close'
            : 'explicit-refresh',
        parentTraceId: options.parentTraceId
      });
      const settle = (result: AccountReconcileResult, outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
        if (fields.reason === 'storage_error') persistenceFailedResultsRef.current.add(result);
        finishDiagnosticTrace(trace, outcome, { source, generation, ...fields });
        return result;
      };
      const controller = new AbortController();
      const policy = {
        publishAnonymous: options.publishAnonymous !== false,
        afterHandoff: Boolean(options.beforeProbe)
      };
      const isCurrent = () =>
        !owner.aborted &&
        lifetimeRef.current.signal === owner &&
        probesRef.current[source].generation === generation &&
        enabledSourcesRef.current.has(source) &&
        !controller.signal.aborted;
      const stale = () =>
        settle({ status: 'stale' }, controller.signal.aborted || owner.aborted ? 'canceled' : 'stale', {
          reason: !enabledSourcesRef.current.has(source)
            ? 'source_disabled'
            : probesRef.current[source].generation !== generation
              ? 'superseded'
              : 'canceled'
        });
      const abortProbe = () => {
        controller.abort();
        finishDiagnosticTrace(trace, 'canceled', { source, generation, reason: 'canceled' });
      };
      if (options.signal?.aborted) abortProbe();
      else options.signal?.addEventListener('abort', abortProbe, { once: true });
      const promise = Promise.resolve().then(async (): Promise<AccountReconcileResult> => {
        let releaseReadRecheck: (() => Promise<void>) | undefined;
        try {
          if (!isCurrent()) return stale();
          if (options.beforeProbe) {
            await options.beforeProbe();
            if (!isCurrent()) return stale();
          }
          if (options.prepareReadRecheck) {
            const protection = options.prepareReadRecheck();
            releaseReadRecheck = protection.release;
            await protection.ready;
            if (!isCurrent()) return stale();
          }
          const observation = await withAbortableTimeout(
            (signal) =>
              readAccountStatus(source, {
                fetcher: withDiagnosticFetcher(
                  trace,
                  source === 'linuxdo' ? fetcher : rejectUnauthorizedResponse(source, fetcher)
                ),
                linuxDoUserAgent: getLinuxDoUserAgent(),
                nodeSeekUserAgent: getNodeSeekUserAgent(),
                readManagedCookieHeader,
                signal
              }),
            { signal: controller.signal }
          );
          if (!isCurrent()) return stale();
          markDiagnosticStage(trace, 'parse', { source, hasDegradation: observation.failed === true });
          const previous =
            appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
            createAccountSessionSnapshot(source);
          const observed = accountSessionSnapshotFromObservation(previous, observation);
          if (!observationConfirmsTerminalIdentity(source, observation) || observed.identityTrust === 'unknown') {
            const message = observed.lastError || `${sourceCatalog[source].label} 账号状态暂时无法确认。`;
            commitAccountSnapshot(source, (current) => ({ ...current, isVerifying: false, lastError: message }));
            return settle(
              {
                status: 'unknown',
                error: message,
                errorInfo: { kind: 'ordinary', message, reason: 'invalid_account_observation', retryable: true }
              },
              'failure',
              { state: 'unconfirmed', reason: 'invalid_response' }
            );
          }
          if (observed.identityTrust === 'none' && !policy.publishAnonymous) {
            return settle(
              { status: 'anonymous', session: observed, partial: observation.failed },
              observation.failed ? 'partial' : 'success',
              { state: 'anonymous' }
            );
          }
          const { next } = commitAccountSnapshot(source, () => observed);
          const previousIdentity = accountSessionIdentityKey(previous);
          const nextIdentity = accountSessionIdentityKey(next);
          const previousIdentityWasKnown =
            previous.identityTrust === 'none' || previousIdentity !== `${source}:anonymous`;
          if (previousIdentityWasKnown && previousIdentity !== nextIdentity) onAccountStatusChanged(source);
          if (!previousIdentityWasKnown) removeUnconfirmedForumSourceQueries(source);
          markDiagnosticStage(trace, 'apply', {
            source,
            state: 'applied',
            hasIdentityChanged: previousIdentity !== nextIdentity
          });
          markDiagnosticStage(trace, 'persist', { source, state: 'started' });
          const persisted = await saveAccountSessionSnapshot(next).catch(() => false);
          if (!isCurrent()) return stale();
          if (!persisted) {
            commitAccountSnapshot(source, (current) => ({
              ...current,
              lastError: `${sourceCatalog[source].label} 账号状态已确认，但本机保存失败。`
            }));
          }
          const completion: DiagnosticFields = {
            didPersist: persisted,
            ...(persisted ? {} : { reason: 'storage_error' })
          };
          const outcome = observation.failed || !persisted ? 'partial' : 'success';
          if (next.identityTrust === 'none') {
            return settle({ status: 'anonymous', session: next, partial: observation.failed }, outcome, {
              ...completion,
              state: 'anonymous'
            });
          }
          const knownIdentityChanged = previousIdentityWasKnown && previousIdentity !== nextIdentity;
          return settle(
            {
              status: knownIdentityChanged ? 'changed' : 'same',
              session: next,
              partial: observation.failed
            },
            outcome,
            { ...completion, state: 'confirmed', hasIdentityChanged: knownIdentityChanged }
          );
        } catch (error) {
          if (!isCurrent()) return stale();
          if (error instanceof CancelledError || isCanceledRequest(error))
            return settle({ status: 'stale' }, 'canceled', { reason: 'canceled' });
          const errorInfo = sourceErrorFromUnknown(source, error);
          commitAccountSnapshot(source, (current) => ({
            ...current,
            isVerifying: false,
            lastError: errorInfo.message
          }));
          return settle({ status: 'unknown', error: errorInfo.message, errorInfo }, 'failure', {
            state: 'unconfirmed',
            reason: normalizeDiagnosticReason(error)
          });
        } finally {
          if (releaseReadRecheck) await releaseReadRecheck();
          options.signal?.removeEventListener('abort', abortProbe);
          const current = probesRef.current[source];
          if (current.kind === 'running' && current.promise === promise) {
            probesRef.current[source] = { kind: 'idle', generation: current.generation };
            commitAccountSnapshot(source, (current) => ({ ...current, isVerifying: false }));
          }
        }
      });
      probesRef.current[source] = {
        kind: 'running',
        generation,
        controller,
        promise,
        policy,
        trace,
        surfaceGeneration: requestedSurfaceGeneration
      };
      return promise;
    },
    [
      beginAccountIdentityCheck,
      commitAccountSnapshot,
      fetcher,
      getLinuxDoUserAgent,
      getNodeSeekUserAgent,
      onAccountStatusChanged,
      readManagedCookieHeader
    ]
  );

  const restoreCommands = useCommittedRef({ readManagedCookieHeader, reconcileAccountStatus });
  useEffect(() => {
    const owner = lifetimeRef.current.signal;
    const trace = beginDiagnosticTrace('session', 'account-restore', { store: 'account-session' });
    recordStartupPhase('sessions-start');
    void Promise.all([
      loadAccountSessionMigrationCompleted(),
      Promise.all(sessionSources.map(async (source) => [source, await loadAccountSessionSnapshot(source)] as const))
    ])
      .then(([migrationCompleted, stored]) => {
        if (owner.aborted || lifetimeRef.current.signal !== owner) return;
        recordStartupPhase('sessions-read');
        const loaded: AccountRestoreState = { kind: 'loaded', records: { owner, migrationCompleted, stored, trace } };
        restoreRef.current = loaded;
        setRestoreState(loaded);
      })
      .catch(() => {
        if (owner.aborted || lifetimeRef.current.signal !== owner) return;
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        const failed: AccountRestoreState = { kind: 'failed', records: null };
        restoreRef.current = failed;
        setRestoreState(failed);
      });
    return () => {
      finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
    };
  }, [restoreAttempt]);

  useEffect(() => {
    const restore = restoreRef.current;
    if (
      !enabledSourcesReady ||
      restoreState.kind !== 'loaded' ||
      restore.kind !== 'loaded' ||
      restore.records !== restoredAccounts ||
      restore.records.owner !== lifetimeRef.current.signal ||
      restore.records.owner.aborted
    )
      return;
    const records = restore.records;
    const owner = records.owner;
    const restoreTrace = records.trace;
    let migrationTrace: DiagnosticTrace | undefined;
    const isCurrent = () => {
      const current = restoreRef.current;
      return (
        !owner.aborted &&
        lifetimeRef.current.signal === owner &&
        (current.kind === 'restoring' || current.kind === 'ready') &&
        current.run === run
      );
    };
    const degradeRestore = (fields: DiagnosticFields) => {
      hintDiagnosticOutcome(restoreTrace, 'partial', fields);
      if (migrationTrace) hintDiagnosticOutcome(migrationTrace, 'partial', fields);
    };
    const run: AccountRestoreRun = {
      owner,
      cancel: () => {
        if (migrationTrace) finishDiagnosticTrace(migrationTrace, 'canceled', { reason: 'canceled' });
        finishDiagnosticTrace(restoreTrace, 'canceled', { reason: 'canceled' });
      },
      promise: Promise.resolve().then(async () => {
        try {
          const { migrationCompleted, stored } = records;
          if (!isCurrent()) return;
          for (const [source, snapshot] of stored) {
            if (snapshot) appQueryClient.setQueryData(accountQueryKeys.snapshot(source), snapshot);
          }
          const restoredCount = stored.filter(([, snapshot]) => snapshot !== null).length;
          markDiagnosticStage(restoreTrace, 'apply', { state: 'restored', itemCount: restoredCount });
          if (migrationCompleted) {
            finishDiagnosticTrace(restoreTrace, 'success', { state: 'restored', itemCount: restoredCount });
            return;
          }
          migrationTrace = beginDiagnosticTrace('session', 'account-migration', {
            parentTraceId: restoreTrace.traceId
          });
          const trace = migrationTrace;
          let candidateCount = 0;
          const ownedProbes: { source: StatusSource; promise: Promise<AccountReconcileResult> }[] = [];
          await withAbortableTimeout(
            (signal) =>
              Promise.all(
                [...enabledSourcesRef.current].map(async (source) => {
                  const url =
                    source === 'nodeseek'
                      ? NODESEEK_ACCOUNT_STATUS_URL
                      : source === 'linuxdo'
                        ? LINUXDO_ACCOUNT_STATUS_URL
                        : YAOHUO_ACCOUNT_STATUS_URL;
                  try {
                    const result = await withAbortableTimeout(
                      () => restoreCommands.current.readManagedCookieHeader(url),
                      { signal }
                    );
                    if (!isCurrent() || signal.aborted) return null;
                    const hasCookie = result.status === 'ok' && !!result.header.trim();
                    markDiagnosticStage(trace, 'credential', {
                      source,
                      state: result.status === 'ok' ? 'complete' : 'failed',
                      hasCookie
                    });
                    if (result.status !== 'ok')
                      degradeRestore({ reason: result.status === 'unsupported' ? 'unsupported' : 'storage_error' });
                    if (!hasCookie) return null;
                  } catch (error) {
                    if (!isCurrent() || signal.aborted) return null;
                    const reason = normalizeDiagnosticReason(error);
                    markDiagnosticStage(trace, 'credential', { source, state: 'failed', reason });
                    degradeRestore({ reason });
                    return null;
                  }
                  candidateCount += 1;
                  const previous = probesRef.current[source];
                  const promise = restoreCommands.current.reconcileAccountStatus(source, { signal });
                  if (previous.kind === 'idle' || previous.promise !== promise) ownedProbes.push({ source, promise });
                  return promise;
                })
              ),
            { signal: owner, timeoutMs: ACCOUNT_SESSION_MIGRATION_TIMEOUT_MS }
          )
            .then((results) => {
              if (!isCurrent()) return;
              const failures = results.filter(
                (result): result is AccountReconcileResult =>
                  result !== null &&
                  (result.status === 'unknown' ||
                    result.status === 'stale' ||
                    ('partial' in result && result.partial) ||
                    persistenceFailedResultsRef.current.has(result))
              );
              if (failures.length)
                degradeRestore({
                  errorCount: failures.length,
                  ...(failures.some((result) => persistenceFailedResultsRef.current.has(result))
                    ? { reason: 'storage_error' }
                    : {})
                });
            })
            .catch(async (error) => {
              if (!isCurrent()) return;
              degradeRestore({ reason: normalizeDiagnosticReason(error) });
              for (const { source, promise } of ownedProbes) {
                const current = probesRef.current[source];
                if (current.kind === 'idle' || current.promise !== promise) continue;
                supersedeProbe(source);
                commitAccountSnapshot(source, (snapshot) => ({ ...snapshot, isVerifying: false }));
              }
              await Promise.allSettled(ownedProbes.map(({ promise }) => promise));
            });
          if (!isCurrent()) return;
          markDiagnosticStage(migrationTrace, 'persist', { state: 'started' });
          await markAccountSessionMigrationCompleted().catch(() => {
            if (isCurrent()) degradeRestore({ reason: 'storage_error' });
          });
          if (!isCurrent()) return;
          finishDiagnosticTrace(migrationTrace, 'success', { state: 'complete', candidateCount });
          finishDiagnosticTrace(restoreTrace, 'success', { state: 'restored', itemCount: restoredCount });
        } catch (error) {
          if (!isCurrent()) return;
          if (migrationTrace)
            finishDiagnosticTrace(migrationTrace, 'failure', { reason: normalizeDiagnosticReason(error) });
          finishDiagnosticTrace(restoreTrace, 'failure', { reason: 'storage_error' });
          throw error;
        }
      })
    };
    restoreRef.current = { kind: 'restoring', records, run };
    void run.promise.then(() => {
      if (!isCurrent()) return;
      const ready: AccountRestoreState = { kind: 'ready', records, run };
      restoreRef.current = ready;
      setRestoreState(ready);
      recordStartupPhase('sessions-ready');
    });
  }, [commitAccountSnapshot, enabledSourcesReady, restoreCommands, restoredAccounts, restoreState, supersedeProbe]);

  const previousEnabledSourcesRef = useRef(new Set<StatusSource>(enabledSources));
  useEffect(() => {
    const previous = previousEnabledSourcesRef.current;
    const current = enabledSourcesRef.current;
    for (const source of previous) {
      if (current.has(source)) continue;
      supersedeProbe(source, 'source_disabled');
      void cancelForumSourceQueries(source, appQueryClient, false);
      commitAccountSnapshot(source, (snapshot) => ({
        ...snapshot,
        isVerifying: false
      }));
    }
    previousEnabledSourcesRef.current = new Set(current);
  }, [commitAccountSnapshot, enabledMembershipKey, supersedeProbe]);

  const statusBusy = sessionSources.some(
    (source) => enabledSourcesRef.current.has(source) && snapshots[source].isVerifying
  );
  const refreshAccountStatus = useCallback(
    async (options: RefreshAccountStatusOptions = {}) => {
      const sources = sessionSources.filter((source) => enabledSourcesRef.current.has(source));
      const trace = beginDiagnosticTrace('session', 'account-refresh', {
        itemCount: sources.length,
        mode: options.silent ? 'silent' : 'manual'
      });
      if (sources.length === 0) {
        finishDiagnosticTrace(trace, 'noop', { state: 'no-enabled-sources', reason: 'source_disabled' });
        return;
      }
      const results = await Promise.all(
        sources.map(async (source) => ({ source, result: await (options.reconcile || reconcileAccountStatus)(source) }))
      );
      const persistenceFailures = results.filter(({ result }) => persistenceFailedResultsRef.current.has(result));
      const failures = results.filter(
        ({ result }) =>
          result.status === 'unknown' ||
          result.status === 'stale' ||
          ('partial' in result && result.partial) ||
          persistenceFailedResultsRef.current.has(result)
      );
      const allStale = results.every(({ result }) => result.status === 'stale');
      finishDiagnosticTrace(trace, allStale ? 'stale' : failures.length ? 'partial' : 'success', {
        itemCount: results.length,
        errorCount: failures.length,
        ...(persistenceFailures.length ? { reason: 'storage_error' } : allStale ? { reason: 'stale' } : {})
      });
      if (options.silent) return;
      const failedSites = results.flatMap(({ source, result }) =>
        result.status === 'unknown' || ('partial' in result && result.partial) ? [sourceCatalog[source].label] : []
      );
      notify(failedSites.length ? `账号状态部分刷新失败：${failedSites.join('、')}` : '账号状态已刷新');
    },
    [notify, reconcileAccountStatus]
  );

  return {
    accountSessionViewModels,
    applyAccountSessionEvent,
    beginAccountIdentityCheck,
    beginAccountSessionClear,
    hydrated,
    interruptedSources,
    reconcileAccountStatus,
    refreshAccountStatus,
    restoreFailed: restoreState.kind === 'failed',
    retryStoredAccounts,
    statusBusy,
    settleAccountSessionHandoff
  };
}
