import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isCancelledError, useQuery, type QueryFunctionContext } from '@tanstack/react-query';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
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
import { scheduleRequestTimeout, type Fetcher } from '@/platform/network/request';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { readWithinAggregateSourceBudget } from '@/sources/readAggregation';
import { readAccountStatus } from '@/sources/accountRead';
import type { XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import {
  readManagedCookieHeader as readManagedCookieHeaderFromNative,
  type ManagedCookieReadResult
} from '@/platform/network/managedCookies';
import { cancelForumSourceQueries, removeUnconfirmedForumSourceQueries } from './sessionQueryOwnership';
import { sessionSources, sourceCatalog, type SessionSource } from '@/domain/forum/sourceCatalog';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import type { SourceErrorInfo } from '@/domain/forum/models';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';

type RefreshAccountStatusOptions = { silent?: boolean };
type StatusSource = SessionSource;
type SnapshotUpdater = (current: AccountSessionSnapshot) => AccountSessionSnapshot;

const STATUS_DESCRIPTORS = {
  nodeseek: { source: 'nodeseek', label: 'NodeSeek' },
  linuxdo: { source: 'linuxdo', label: 'linux.do' },
  yaohuo: { source: 'yaohuo', label: '妖火' },
  xiaoyinsi: { source: 'xiaoyinsi', label: '小隐寺' }
} as const satisfies Record<StatusSource, { source: StatusSource; label: string }>;

const ACCOUNT_PROBE_TIMEOUT_MS = 25_000;

function isCanceledStatusQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

function accountBatchError(source: StatusSource, error: unknown) {
  const sourceError = sourceErrorFromUnknown(source, error);
  const reason = error && typeof error === 'object' ? (error as { reason?: unknown }).reason : undefined;
  return reason === 'aggregate_timeout'
    ? {
        ...sourceError,
        message: `${sourceCatalog[source].label} 账号状态检查超时，请重试。`,
        reason: 'aggregate_timeout',
        retryable: true
      }
    : sourceError;
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
  linuxDoUserAgentRef,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  onAccountStatusChanged,
  readManagedCookieHeader = readManagedCookieHeaderFromNative,
  readXiaoyinsiAuthorization,
  reconcileNewlyEnabledSources = true
}: {
  enabledSources?: readonly StatusSource[];
  linuxDoUserAgentRef: { current: string };
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onAccountStatusChanged: (source: StatusSource, recoveryQueryKey?: readonly unknown[]) => void;
  readManagedCookieHeader?: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  readXiaoyinsiAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<XiaoyinsiAuthorizationReadResult>;
  reconcileNewlyEnabledSources?: boolean;
}) {
  const enabledMembershipKey = sessionSources.filter((source) => enabledSources.includes(source)).join(',');
  const enabledSourceSet = useMemo(
    () => new Set<StatusSource>(enabledMembershipKey ? (enabledMembershipKey.split(',') as StatusSource[]) : []),
    [enabledMembershipKey]
  );
  const enabledSourcesRef = useRef(enabledSourceSet);
  useCommitRefValue(enabledSourcesRef, enabledSourceSet);

  const probeDefinitions = useMemo(() => {
    const definition = (source: StatusSource) => ({
      queryFn: ({ signal }: QueryFunctionContext) =>
        readAccountStatus(source, {
          fetcher,
          linuxDoUserAgent: linuxDoUserAgentRef.current,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          readManagedCookieHeader,
          readXiaoyinsiAuthorization,
          signal
        })
    });
    return {
      linuxdo: definition('linuxdo'),
      nodeseek: definition('nodeseek'),
      xiaoyinsi: definition('xiaoyinsi'),
      yaohuo: definition('yaohuo')
    };
  }, [fetcher, linuxDoUserAgentRef, nodeSeekUserAgentRef, readManagedCookieHeader, readXiaoyinsiAuthorization]);

  const nodeSeekStatus = useQuery(snapshotQueryDefinition('nodeseek'));
  const linuxDoStatus = useQuery(snapshotQueryDefinition('linuxdo'));
  const yaohuoStatus = useQuery(snapshotQueryDefinition('yaohuo'));
  const xiaoyinsiStatus = useQuery(snapshotQueryDefinition('xiaoyinsi'));
  const snapshots: Record<StatusSource, AccountSessionSnapshot> = {
    linuxdo: linuxDoStatus.data,
    nodeseek: nodeSeekStatus.data,
    xiaoyinsi: xiaoyinsiStatus.data,
    yaohuo: yaohuoStatus.data
  };
  const accountSessionViewModels: SiteSessionViewModels = {
    linuxdo: createAccountSessionViewModel(snapshots.linuxdo),
    nodeseek: createAccountSessionViewModel(snapshots.nodeseek),
    xiaoyinsi: createAccountSessionViewModel(snapshots.xiaoyinsi),
    yaohuo: createAccountSessionViewModel(snapshots.yaohuo)
  };

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

  const probeGenerationRef = useRef<Record<StatusSource, number>>({
    linuxdo: 0,
    nodeseek: 0,
    xiaoyinsi: 0,
    yaohuo: 0
  });
  const activeProbeRef = useRef<
    Partial<
      Record<
        StatusSource,
        {
          generation: number;
          promise: Promise<AccountReconcileResult>;
          queryKey: readonly unknown[];
          releaseBudgetCancellation: () => void;
          retainedBeyondBudget: boolean;
          surfaceGeneration: number;
        }
      >
    >
  >({});

  const supersedeProbe = useCallback((source: StatusSource) => {
    probeGenerationRef.current[source] += 1;
    const activeProbe = activeProbeRef.current[source];
    if (!activeProbe) return;
    activeProbe.releaseBudgetCancellation();
    delete activeProbeRef.current[source];
    void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
  }, []);

  const applyAccountSessionEvent = useCallback(
    (event: ScopedSiteSessionEvent) => {
      if (!enabledSourcesRef.current.has(event.site)) return false;
      supersedeProbe(event.site);
      const { next, previous } = commitAccountSnapshot(event.site, (current) =>
        accountSessionSnapshotFromEvent(current, event)
      );
      if (accountSessionIdentityKey(previous) !== accountSessionIdentityKey(next)) {
        onAccountStatusChanged(event.site, 'recoveryQueryKey' in event ? event.recoveryQueryKey : undefined);
      }
      return true;
    },
    [commitAccountSnapshot, onAccountStatusChanged, supersedeProbe]
  );

  const beginAccountIdentityCheck = useCallback(
    (source: StatusSource, surfaceGeneration?: number, includeAggregateCancellation = true) => {
      if (!enabledSourcesRef.current.has(source)) return;
      const previous =
        appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
        createAccountSessionSnapshot(source);
      if (includeAggregateCancellation === false || previous.status === 'logged-in') {
        void cancelForumSourceQueries(source, appQueryClient, includeAggregateCancellation);
      }
      if (surfaceGeneration !== undefined) {
        const activeProbe = activeProbeRef.current[source];
        if (activeProbe && activeProbe.surfaceGeneration < surfaceGeneration) {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source] + 1, surfaceGeneration);
          void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
        } else {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source], surfaceGeneration);
        }
      }
      commitAccountSnapshot(source, (current) => ({
        ...current,
        isVerifying: true,
        identityTrust: 'pending',
        lastError: undefined
      }));
    },
    [commitAccountSnapshot]
  );

  const reconcileAccountStatus = useCallback(
    (
      source: StatusSource,
      options: {
        includeAggregateCancellation?: boolean;
        signal?: AbortSignal;
        surfaceGeneration?: number;
      } = {}
    ): Promise<AccountReconcileResult> => {
      if (!enabledSourcesRef.current.has(source)) return Promise.resolve({ status: 'stale' });
      const requestedSurfaceGeneration = options.surfaceGeneration || 0;
      const activeProbe = activeProbeRef.current[source];
      if (activeProbe && requestedSurfaceGeneration <= activeProbe.surfaceGeneration) {
        if (!options.signal) {
          activeProbe.retainedBeyondBudget = true;
          activeProbe.releaseBudgetCancellation();
        }
        return activeProbe.promise;
      }
      if (activeProbe) void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
      beginAccountIdentityCheck(source, undefined, options.includeAggregateCancellation);
      const generation =
        options.surfaceGeneration === undefined
          ? probeGenerationRef.current[source] + 1
          : Math.max(probeGenerationRef.current[source] + 1, options.surfaceGeneration);
      probeGenerationRef.current[source] = generation;
      const probeQueryKey = accountQueryKeys.probe(source, generation);
      const abortProbe = () => {
        if (activeProbeRef.current[source]?.generation !== generation) return;
        void appQueryClient.cancelQueries({ queryKey: probeQueryKey, exact: true });
      };
      const releaseBudgetCancellation = () => options.signal?.removeEventListener('abort', abortProbe);
      options.signal?.addEventListener('abort', abortProbe, { once: true });
      let cancelProbeTimeout: () => void = () => undefined;
      const timeoutPromise = new Promise<AccountReconcileResult>((resolve) => {
        cancelProbeTimeout = scheduleRequestTimeout(() => {
          if (probeGenerationRef.current[source] !== generation || !enabledSourcesRef.current.has(source)) {
            resolve({ status: 'stale' });
            return;
          }
          const message = `${sourceCatalog[source].label} 账号状态核对超时，请重试。`;
          const errorInfo: SourceErrorInfo = {
            kind: 'ordinary',
            message,
            reason: 'account_probe_timeout',
            retryable: true
          };
          probeGenerationRef.current[source] = generation + 1;
          commitAccountSnapshot(source, (current) => ({
            ...current,
            isVerifying: false,
            identityTrust: 'unknown',
            lastError: message
          }));
          releaseBudgetCancellation();
          if (activeProbeRef.current[source]?.generation === generation) delete activeProbeRef.current[source];
          void appQueryClient.cancelQueries({ queryKey: probeQueryKey, exact: true });
          appQueryClient.removeQueries({ queryKey: probeQueryKey, exact: true });
          resolve({ status: 'unknown', error: message, errorInfo });
        }, ACCOUNT_PROBE_TIMEOUT_MS);
      });
      const queryPromise = (async (): Promise<AccountReconcileResult> => {
        try {
          const observation = await appQueryClient.fetchQuery<AccountStatusObservation>({
            queryKey: probeQueryKey,
            queryFn: probeDefinitions[source].queryFn,
            staleTime: 0
          });
          if (probeGenerationRef.current[source] !== generation || !enabledSourcesRef.current.has(source)) {
            return { status: 'stale' };
          }
          const { next, previous } = commitAccountSnapshot(source, (current) =>
            accountSessionSnapshotFromObservation(current, observation)
          );
          if (next.identityTrust === 'unknown') {
            const message = next.lastError || `${sourceCatalog[source].label} 账号状态暂时无法确认。`;
            return {
              status: 'unknown',
              error: message,
              errorInfo: { kind: 'ordinary', message, reason: 'invalid_account_observation', retryable: true }
            };
          }
          const previousIdentity = accountSessionIdentityKey(previous);
          const nextIdentity = accountSessionIdentityKey(next);
          const previousIdentityWasKnown =
            previous.identityTrust === 'none' || previousIdentity !== `${source}:anonymous`;
          if (previousIdentityWasKnown && previousIdentity !== nextIdentity) onAccountStatusChanged(source);
          if (!previousIdentityWasKnown) removeUnconfirmedForumSourceQueries(source);
          if (next.identityTrust === 'none') {
            return { status: 'anonymous', session: next, partial: observation.failed };
          }
          const knownIdentityChanged = previousIdentityWasKnown && previousIdentity !== nextIdentity;
          return {
            status: knownIdentityChanged ? 'changed' : 'same',
            session: next,
            partial: observation.failed
          };
        } catch (error) {
          if (probeGenerationRef.current[source] !== generation) return { status: 'stale' };
          if (isCanceledStatusQuery(error)) return { status: 'stale' };
          const message = errorMessage(error);
          const errorInfo = sourceErrorFromUnknown(source, error);
          commitAccountSnapshot(source, (current) => ({
            ...current,
            isVerifying: false,
            identityTrust: 'unknown',
            lastError: message
          }));
          return { status: 'unknown', error: message, errorInfo: { ...errorInfo, message } };
        } finally {
          cancelProbeTimeout();
          releaseBudgetCancellation();
          if (activeProbeRef.current[source]?.generation === generation) delete activeProbeRef.current[source];
          appQueryClient.removeQueries({ queryKey: probeQueryKey, exact: true });
        }
      })();
      const promise = Promise.race([queryPromise, timeoutPromise]);
      activeProbeRef.current[source] = {
        generation,
        promise,
        queryKey: probeQueryKey,
        releaseBudgetCancellation,
        retainedBeyondBudget: options.signal === undefined,
        surfaceGeneration: requestedSurfaceGeneration
      };
      if (options.signal?.aborted) abortProbe();
      return promise;
    },
    [beginAccountIdentityCheck, commitAccountSnapshot, onAccountStatusChanged, probeDefinitions]
  );

  const previousEnabledSourcesRef = useRef(new Set<StatusSource>(enabledSources));
  useEffect(() => {
    const previous = previousEnabledSourcesRef.current;
    const current = enabledSourcesRef.current;
    for (const source of previous) {
      if (current.has(source)) continue;
      supersedeProbe(source);
      void cancelForumSourceQueries(source, appQueryClient, false);
      commitAccountSnapshot(source, (snapshot) => ({
        ...snapshot,
        isVerifying: false,
        identityTrust: 'unknown'
      }));
    }
    for (const source of current) {
      if (previous.has(source)) continue;
      if (reconcileNewlyEnabledSources) {
        void reconcileAccountStatus(source, { includeAggregateCancellation: false });
      }
    }
    previousEnabledSourcesRef.current = new Set(current);
  }, [
    commitAccountSnapshot,
    enabledMembershipKey,
    reconcileAccountStatus,
    reconcileNewlyEnabledSources,
    supersedeProbe
  ]);

  const statusBusy = sessionSources.some(
    (source) => enabledSourcesRef.current.has(source) && snapshots[source].identityTrust === 'pending'
  );
  const refreshAccountStatus = useCallback(
    async (options: RefreshAccountStatusOptions = {}) => {
      const sources = Object.values(STATUS_DESCRIPTORS).filter(({ source }) => enabledSourcesRef.current.has(source));
      if (sources.length === 0) return;
      const results = await Promise.all(
        sources.map(async (descriptor) => {
          try {
            return {
              descriptor,
              result: await readWithinAggregateSourceBudget(descriptor.source, undefined, (signal) =>
                reconcileAccountStatus(descriptor.source, { signal })
              )
            };
          } catch (error) {
            const errorInfo = accountBatchError(descriptor.source, error);
            const activeProbe = activeProbeRef.current[descriptor.source];
            if (!activeProbe?.retainedBeyondBudget) {
              commitAccountSnapshot(descriptor.source, (current) => ({
                ...current,
                isVerifying: false,
                identityTrust: 'unknown',
                lastError: errorInfo.message
              }));
            }
            return {
              descriptor,
              result: { status: 'unknown' as const, error: errorMessage(error), errorInfo }
            };
          }
        })
      );
      if (options.silent) return;
      const failedSites = results.flatMap(({ descriptor, result }) =>
        result.status === 'unknown' || ('partial' in result && result.partial) ? [descriptor.label] : []
      );
      notify(failedSites.length ? `账号状态部分刷新失败：${failedSites.join('、')}` : '账号状态已刷新');
    },
    [commitAccountSnapshot, notify, reconcileAccountStatus]
  );

  return {
    accountSessionViewModels,
    applyAccountSessionEvent,
    beginAccountIdentityCheck,
    reconcileAccountStatus,
    refreshAccountStatus,
    statusBusy
  };
}
