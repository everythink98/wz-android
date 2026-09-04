import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
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

type RefreshAccountStatusOptions = { silent?: boolean };
type StatusSource = SessionSource;
type SnapshotUpdater = (current: AccountSessionSnapshot) => AccountSessionSnapshot;

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
  linuxDoUserAgentRef,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  onAccountStatusChanged,
  readManagedCookieHeader = readManagedCookieHeaderFromNative
}: {
  enabledSources?: readonly StatusSource[];
  enabledSourcesReady?: boolean;
  linuxDoUserAgentRef: { current: string };
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
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

  const nodeSeekStatus = useQuery(snapshotQueryDefinition('nodeseek'));
  const linuxDoStatus = useQuery(snapshotQueryDefinition('linuxdo'));
  const yaohuoStatus = useQuery(snapshotQueryDefinition('yaohuo'));
  const snapshots: Record<StatusSource, AccountSessionSnapshot> = {
    linuxdo: linuxDoStatus.data,
    nodeseek: nodeSeekStatus.data,
    yaohuo: yaohuoStatus.data
  };
  const accountSessionViewModels: SiteSessionViewModels = {
    linuxdo: createAccountSessionViewModel(snapshots.linuxdo),
    nodeseek: createAccountSessionViewModel(snapshots.nodeseek),
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

  const [hydrated, setHydrated] = useState(false);
  const hydrationStartedRef = useRef(false);

  const probeGenerationRef = useRef<Record<StatusSource, number>>({
    linuxdo: 0,
    nodeseek: 0,
    yaohuo: 0
  });
  const activeProbeRef = useRef<
    Partial<
      Record<
        StatusSource,
        {
          controller: AbortController;
          generation: number;
          promise: Promise<AccountReconcileResult>;
          surfaceGeneration: number;
        }
      >
    >
  >({});

  const supersedeProbe = useCallback((source: StatusSource) => {
    probeGenerationRef.current[source] += 1;
    const activeProbe = activeProbeRef.current[source];
    if (!activeProbe) return;
    activeProbe.controller.abort();
    delete activeProbeRef.current[source];
  }, []);

  const applyAccountSessionEvent = useCallback(
    (event: ScopedSiteSessionEvent) => {
      if (!enabledSourcesRef.current.has(event.site)) return false;
      const terminalEvent = eventConfirmsTerminalIdentity(event);
      if (terminalEvent) supersedeProbe(event.site);
      const { next, previous } = commitAccountSnapshot(event.site, (current) =>
        accountSessionSnapshotFromEvent(current, event)
      );
      if (accountSessionIdentityKey(previous) !== accountSessionIdentityKey(next)) {
        onAccountStatusChanged(event.site);
      }
      if (terminalEvent && (next.identityTrust === 'confirmed' || next.identityTrust === 'none')) {
        void saveAccountSessionSnapshot(next).catch(() => {
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
      if (!enabledSourcesRef.current.has(source)) return;
      if (surfaceGeneration !== undefined) {
        const activeProbe = activeProbeRef.current[source];
        if (activeProbe && activeProbe.surfaceGeneration < surfaceGeneration) {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source] + 1, surfaceGeneration);
          activeProbe.controller.abort();
          delete activeProbeRef.current[source];
        } else {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source], surfaceGeneration);
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
      } = {}
    ): Promise<AccountReconcileResult> => {
      if (!enabledSourcesRef.current.has(source)) return Promise.resolve({ status: 'stale' });
      const requestedSurfaceGeneration = options.surfaceGeneration || 0;
      const activeProbe = activeProbeRef.current[source];
      if (activeProbe && requestedSurfaceGeneration <= activeProbe.surfaceGeneration) return activeProbe.promise;
      activeProbe?.controller.abort();
      beginAccountIdentityCheck(source);
      const generation =
        options.surfaceGeneration === undefined
          ? probeGenerationRef.current[source] + 1
          : Math.max(probeGenerationRef.current[source] + 1, options.surfaceGeneration);
      probeGenerationRef.current[source] = generation;
      const controller = new AbortController();
      const abortProbe = () => controller.abort();
      options.signal?.addEventListener('abort', abortProbe, { once: true });
      const promise = (async (): Promise<AccountReconcileResult> => {
        try {
          const observation = await readAccountStatus(source, {
            fetcher: rejectUnauthorizedResponse(fetcher),
            linuxDoUserAgent: linuxDoUserAgentRef.current,
            nodeSeekUserAgent: nodeSeekUserAgentRef.current,
            readManagedCookieHeader,
            signal: controller.signal
          });
          if (probeGenerationRef.current[source] !== generation || !enabledSourcesRef.current.has(source)) {
            return { status: 'stale' };
          }
          const previous =
            appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
            createAccountSessionSnapshot(source);
          const observed = accountSessionSnapshotFromObservation(previous, observation);
          if (!observationConfirmsTerminalIdentity(source, observation) || observed.identityTrust === 'unknown') {
            const message = observed.lastError || `${sourceCatalog[source].label} 账号状态暂时无法确认。`;
            commitAccountSnapshot(source, (current) => ({ ...current, isVerifying: false, lastError: message }));
            return {
              status: 'unknown',
              error: message,
              errorInfo: { kind: 'ordinary', message, reason: 'invalid_account_observation', retryable: true }
            };
          }
          if (observed.identityTrust === 'none' && options.publishAnonymous === false) {
            return { status: 'anonymous', session: observed, partial: observation.failed };
          }
          const { next } = commitAccountSnapshot(source, () => observed);
          const previousIdentity = accountSessionIdentityKey(previous);
          const nextIdentity = accountSessionIdentityKey(next);
          const previousIdentityWasKnown =
            previous.identityTrust === 'none' || previousIdentity !== `${source}:anonymous`;
          if (previousIdentityWasKnown && previousIdentity !== nextIdentity) onAccountStatusChanged(source);
          if (!previousIdentityWasKnown) removeUnconfirmedForumSourceQueries(source);
          const persisted = await saveAccountSessionSnapshot(next).catch(() => false);
          if (!persisted) {
            commitAccountSnapshot(source, (current) => ({
              ...current,
              lastError: `${sourceCatalog[source].label} 账号状态已确认，但本机保存失败。`
            }));
          }
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
          if (
            probeGenerationRef.current[source] !== generation ||
            !enabledSourcesRef.current.has(source) ||
            controller.signal.aborted
          ) {
            return { status: 'stale' };
          }
          if (error instanceof CancelledError || isCanceledRequest(error)) return { status: 'stale' };
          const errorInfo = sourceErrorFromUnknown(source, error);
          commitAccountSnapshot(source, (current) => ({
            ...current,
            isVerifying: false,
            lastError: errorInfo.message
          }));
          return { status: 'unknown', error: errorInfo.message, errorInfo };
        } finally {
          options.signal?.removeEventListener('abort', abortProbe);
          if (activeProbeRef.current[source]?.generation === generation) {
            delete activeProbeRef.current[source];
            commitAccountSnapshot(source, (current) => ({ ...current, isVerifying: false }));
          }
        }
      })();
      activeProbeRef.current[source] = {
        controller,
        generation,
        promise,
        surfaceGeneration: requestedSurfaceGeneration
      };
      if (options.signal?.aborted) controller.abort();
      return promise;
    },
    [
      beginAccountIdentityCheck,
      commitAccountSnapshot,
      fetcher,
      linuxDoUserAgentRef,
      nodeSeekUserAgentRef,
      onAccountStatusChanged,
      readManagedCookieHeader
    ]
  );

  useEffect(() => {
    if (!enabledSourcesReady || hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    let active = true;
    void (async () => {
      const [migrationCompleted, stored] = await Promise.all([
        loadAccountSessionMigrationCompleted(),
        Promise.all(sessionSources.map(async (source) => [source, await loadAccountSessionSnapshot(source)] as const))
      ]);
      if (!active) return;
      for (const [source, snapshot] of stored) {
        if (snapshot) appQueryClient.setQueryData(accountQueryKeys.snapshot(source), snapshot);
      }
      if (migrationCompleted) {
        setHydrated(true);
        return;
      }
      const candidates = (
        await Promise.all(
          [...enabledSourcesRef.current].map(async (source) => {
            try {
              const url =
                source === 'nodeseek'
                  ? NODESEEK_ACCOUNT_STATUS_URL
                  : source === 'linuxdo'
                    ? LINUXDO_ACCOUNT_STATUS_URL
                    : YAOHUO_ACCOUNT_STATUS_URL;
              const result = await readManagedCookieHeader(url);
              return result.status === 'ok' && result.header.trim() ? source : null;
            } catch {
              return null;
            }
          })
        )
      ).filter((source): source is StatusSource => source !== null);
      let migrationProbes: Promise<AccountReconcileResult[]> = Promise.resolve([]);
      await withAbortableTimeout(
        (signal) => {
          migrationProbes = Promise.all(candidates.map((source) => reconcileAccountStatus(source, { signal })));
          return migrationProbes;
        },
        { timeoutMs: ACCOUNT_SESSION_MIGRATION_TIMEOUT_MS }
      ).catch(async () => {
        for (const source of candidates) {
          supersedeProbe(source);
        }
        await migrationProbes.catch(() => undefined);
        for (const source of candidates) {
          commitAccountSnapshot(source, (snapshot) => ({ ...snapshot, isVerifying: false }));
        }
      });
      await markAccountSessionMigrationCompleted().catch(() => undefined);
      if (active) setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, [commitAccountSnapshot, enabledSourcesReady, readManagedCookieHeader, reconcileAccountStatus, supersedeProbe]);

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
      if (sources.length === 0) return;
      const results = await Promise.all(
        sources.map(async (source) => ({ source, result: await reconcileAccountStatus(source) }))
      );
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
    hydrated,
    reconcileAccountStatus,
    refreshAccountStatus,
    statusBusy
  };
}
