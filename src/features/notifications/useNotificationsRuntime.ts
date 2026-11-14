import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { isNotificationSource, notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { SourceErrorInfo } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { createNotificationGateway, type NotificationAccessReader } from '@/sources/notificationGateway';
import { readForegroundNotificationAccess } from '@/sources/notificationForegroundAccess';
import {
  clearNotificationSourceForContentDisable,
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  recordNotificationSnapshot,
  resetNotificationSourceIdentity,
  setGlobalNotificationIntent,
  setSourceNotificationIntent,
  type NotificationState
} from '@/platform/notifications/notificationStore';
import {
  dismissSourceNotification,
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  openNotificationSystemSettings,
  presentSourceNotification,
  reconcileSourceNotificationSlots,
  requestNotificationPermission,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { notificationAdapters } from '@/sources/notificationAdapters';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  recordDiagnosticError
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { notificationErrorAction } from './notificationPresentation';
import { createNotificationOpenIntent } from './notificationOpenIntent';
import { createNotificationBootstrap } from './notificationBootstrap';
import { createNotificationForegroundDeliveries, type ForegroundDelivery } from './notificationForegroundDeliveries';
import {
  createNotificationSourceLifecycleRegistry,
  markNotificationSourcesCleaning,
  notificationSourceIsOperational,
  operationalNotificationSources,
  runNotificationSourceCleanup
} from './notificationSourceLifecycle';

export type { NotificationPermissionState } from './notificationBootstrap';

function confirmedIdentity(source: NotificationSource, sessions: SiteSessionViewModels) {
  const session = sessions[source];
  const userId = String(session.currentUser?.id || '').trim();
  return session.isLoggedIn && session.identityTrust === 'confirmed' && userId ? `${source}:${userId}` : undefined;
}

function identityNeedsTrustedFallback(source: NotificationSource, sessions: SiteSessionViewModels) {
  return sessions[source].identityTrust === 'unknown';
}

function clearLastNotificationResponse() {
  try {
    Notifications.clearLastNotificationResponse();
  } catch (error) {
    recordDiagnosticError('app', 'notification-response', error);
  }
}

export function useNotificationsRuntime({
  appActive,
  contentSourcesReady,
  enabledNotificationSources,
  fetcher,
  getLinuxDoUserAgent,
  getNodeSeekUserAgent,
  onSessionExpired,
  openSource,
  privateAccessAllowed,
  requestAccountRecheck,
  remoteReady,
  sessionEpochs,
  sessions
}: {
  appActive: boolean;
  contentSourcesReady: boolean;
  enabledNotificationSources: readonly NotificationSource[];
  fetcher: Fetcher;
  getLinuxDoUserAgent: () => string;
  getNodeSeekUserAgent: () => string;
  onSessionExpired: (source: NotificationSource, requestSessionEpoch: number) => void;
  openSource: (source?: NotificationSource) => boolean;
  privateAccessAllowed: (source: NotificationSource, identityKey: string) => boolean;
  requestAccountRecheck: RequestAccountRecheck;
  remoteReady: boolean;
  sessionEpochs: ForumSessionEpochs;
  sessions: SiteSessionViewModels;
}) {
  const enabledSourceOrder = enabledNotificationSources.join('|');
  const enabledSources = useMemo(
    () => (enabledSourceOrder ? (enabledSourceOrder.split('|') as NotificationSource[]) : []),
    [enabledSourceOrder]
  );
  const enabledSourcesKey = notificationSources.filter((source) => enabledSources.includes(source)).join('|');
  const enabledNetworkSources = useMemo(
    () => (enabledSourcesKey ? (enabledSourcesKey.split('|') as NotificationSource[]) : []),
    [enabledSourcesKey]
  );
  const enabledSourcesRef = useRef<readonly NotificationSource[]>(enabledSources);
  const contentSourcesReadyRef = useRef(contentSourcesReady);
  const runtimeReadyRef = useRef(false);
  const previousEnabledSourcesRef = useRef<readonly NotificationSource[]>(notificationSources);
  const contentPreferenceChangedRef = useRef(false);
  const sourceLifecyclesRef = useRef(createNotificationSourceLifecycleRegistry());
  const privateAccessAllowedRef = useRef(privateAccessAllowed);
  useCommitRefValue(privateAccessAllowedRef, privateAccessAllowed);
  const sessionEpochsRef = useRef(sessionEpochs);
  useCommitRefValue(sessionEpochsRef, sessionEpochs);
  const readBlocksRef = useRef(
    new Map<NotificationSource, { epoch: number; error: SourceErrorInfo; verifiedAt?: string }>()
  );
  const [, setReadBlockRevision] = useState(0);
  const sessionsRef = useRef(sessions);
  useCommitRefValue(sessionsRef, sessions);
  const getReadBlock = useCallback((source: NotificationSource) => {
    const block = readBlocksRef.current.get(source);
    return enabledSourcesRef.current.includes(source) && block?.epoch === sessionEpochsRef.current[source]
      ? block.error
      : undefined;
  }, []);
  const clearReadBlock = useCallback((source: NotificationSource, epoch: number) => {
    if (readBlocksRef.current.get(source)?.epoch !== epoch) return;
    readBlocksRef.current.delete(source);
    const trace = beginDiagnosticTrace('source', 'notification-runtime', { source });
    finishDiagnosticTrace(trace, 'success', { source, state: 'read-resumed' });
    setReadBlockRevision((revision) => revision + 1);
  }, []);
  const reportReadError = useCallback((source: NotificationSource, error: SourceErrorInfo, epoch: number) => {
    if (
      epoch !== sessionEpochsRef.current[source] ||
      !enabledSourcesRef.current.includes(source) ||
      notificationErrorAction(error) === '重试' ||
      error.reason === 'private-access-stale'
    )
      return;
    const previous = readBlocksRef.current.get(source);
    if (previous?.epoch === epoch && previous.error.kind === error.kind && previous.error.message === error.message)
      return;
    readBlocksRef.current.set(source, { epoch, error, verifiedAt: sessionsRef.current[source].lastVerifiedAt });
    const trace = beginDiagnosticTrace('source', 'notification-runtime', { source });
    finishDiagnosticTrace(trace, 'blocked', {
      source,
      state: 'read-blocked',
      kind: error.kind,
      reason: normalizeDiagnosticReason(error.reason ?? error.message)
    });
    setReadBlockRevision((revision) => revision + 1);
  }, []);
  useEffect(() => {
    for (const [source, block] of readBlocksRef.current) {
      const session = sessions[source];
      const reconciledLogin =
        notificationErrorAction(block.error) === '去登录' &&
        session.isLoggedIn &&
        !session.isVerifying &&
        !session.lastError &&
        session.lastVerifiedAt !== block.verifiedAt;
      if (!enabledSources.includes(source) || sessionEpochs[source] !== block.epoch || reconciledLogin) {
        clearReadBlock(source, block.epoch);
      }
    }
  }, [clearReadBlock, enabledSources, sessionEpochs, sessions]);
  const sourceIsOperational = useCallback(
    (source: NotificationSource) =>
      notificationSourceIsOperational(
        sourceLifecyclesRef.current,
        source,
        runtimeReadyRef.current,
        enabledSourcesRef.current
      ),
    []
  );
  const readAccess = useMemo<NotificationAccessReader>(
    () => (source) =>
      readForegroundNotificationAccess({
        fetcher,
        session: sessions[source],
        source,
        userAgent:
          source === 'nodeseek' ? getNodeSeekUserAgent() : source === 'linuxdo' ? getLinuxDoUserAgent() : undefined
      }),
    [fetcher, getLinuxDoUserAgent, getNodeSeekUserAgent, sessions]
  );
  const gateway = useMemo(
    () =>
      createNotificationGateway({
        onSessionExpired,
        privateAccessAllowed: (source, identityKey) => privateAccessAllowedRef.current(source, identityKey),
        readAccess,
        requestAccountRecheck,
        requestSessionEpoch: (source) => sessionEpochsRef.current[source],
        sourceAllowed: sourceIsOperational
      }),
    [onSessionExpired, readAccess, requestAccountRecheck, sourceIsOperational]
  );
  const readAccessRef = useRef(readAccess);
  useCommitRefValue(readAccessRef, readAccess);
  const stateRef = useRef<NotificationState>(defaultNotificationState());
  const [bootstrap] = useState(createNotificationBootstrap);
  const [bootstrapView, setBootstrapView] = useState(bootstrap.snapshot);
  const { ready, storageError, permissionError, permission } = bootstrapView;
  const publishBootstrap = useCallback(() => setBootstrapView(bootstrap.snapshot), [bootstrap]);
  const backgroundErrorRef = useRef('');
  const mountedRef = useRef(true);
  const [foregroundDeliveries] = useState(createNotificationForegroundDeliveries);
  const snapshotResultRevisionRef = useRef(0);
  const [openIntent] = useState(createNotificationOpenIntent);
  const [state, setState] = useState(stateRef.current);
  const [centerVisible, setCenterVisibleState] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  const [snapshotErrors, setSnapshotErrors] = useState<Partial<Record<NotificationSource, string>>>({});
  const [sourceLifecycleSnapshot, setSourceLifecycleSnapshot] = useState(() => ({ ...sourceLifecyclesRef.current }));
  const runtimeReady = ready && contentSourcesReady;
  const operationalSources = useMemo(
    () => operationalNotificationSources(sourceLifecycleSnapshot, enabledNetworkSources, runtimeReady),
    [enabledNetworkSources, runtimeReady, sourceLifecycleSnapshot]
  );

  useLayoutEffect(() => {
    enabledSourcesRef.current = enabledSources;
    contentSourcesReadyRef.current = contentSourcesReady;
    runtimeReadyRef.current = runtimeReady;
    if (contentSourcesReady) {
      if (previousEnabledSourcesRef.current.join('|') !== enabledSources.join('|')) {
        contentPreferenceChangedRef.current = true;
      }
      const removedSources = previousEnabledSourcesRef.current.filter((source) => !enabledSources.includes(source));
      if (markNotificationSourcesCleaning(sourceLifecyclesRef.current, removedSources)) {
        setSourceLifecycleSnapshot({ ...sourceLifecyclesRef.current });
      }
      const removedOpen = openIntent.removedSources(removedSources);
      if (removedOpen) finishDiagnosticTrace(removedOpen.trace, 'canceled', { reason: 'source_disabled' });
      previousEnabledSourcesRef.current = enabledSources;
    }
  }, [contentSourcesReady, enabledSources, runtimeReady, openIntent]);

  const commitState = useCallback((next: NotificationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setCenterVisible = useCallback((visible: boolean) => {
    setCenterVisibleState(visible);
  }, []);

  const syncBackground = useCallback(
    async (next: NotificationState, granted: boolean, eligibleSources: readonly NotificationSource[]) => {
      try {
        await syncNotificationBackgroundRegistration(next, granted, eligibleSources);
        if (mountedRef.current && backgroundErrorRef.current) {
          const trace = beginDiagnosticTrace('app', 'notification-runtime');
          finishDiagnosticTrace(trace, 'success', { state: 'recovered' });
          backgroundErrorRef.current = '';
          setBackgroundError('');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '后台任务设置失败';
        if (mountedRef.current && backgroundErrorRef.current !== message) {
          backgroundErrorRef.current = message;
          setBackgroundError(message);
        }
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      foregroundDeliveries.invalidate();
      const pending = openIntent.cancel();
      if (pending) {
        finishDiagnosticTrace(pending.trace, 'canceled', { reason: 'canceled' });
      }
    };
  }, [openIntent, foregroundDeliveries]);

  const retryInitialization = useCallback(() => {
    if (bootstrap.pending) return bootstrap.pending;
    if (!mountedRef.current) return Promise.resolve();
    const restore = async () => {
      if (bootstrap.restored) return;
      const trace = beginDiagnosticTrace('app', 'notification-runtime', { state: 'state-load' });
      try {
        const stored = await loadNotificationState();
        if (!mountedRef.current) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        bootstrap.restoredStorage();
        commitState(stored);
        publishBootstrap();
        finishDiagnosticTrace(trace, 'success', { isEnabled: stored.globalEnabled });
      } catch (error) {
        if (mountedRef.current) {
          bootstrap.failedStorage();
          publishBootstrap();
        }
        finishDiagnosticTrace(trace, 'failure', { state: 'state-load', reason: normalizeDiagnosticReason(error) });
      }
    };
    const probePermission = async () => {
      try {
        const granted = await notificationPermissionGranted();
        if (!mountedRef.current) return;
        bootstrap.observedPermission(granted);
        publishBootstrap();
      } catch (error) {
        if (!mountedRef.current) return;
        bootstrap.failedPermission();
        publishBootstrap();
        recordDiagnosticError('app', 'notification-permission', error);
      }
    };
    return bootstrap.run(async () => {
      await Promise.all([restore(), probePermission()]);
    });
  }, [commitState, bootstrap, publishBootstrap]);
  useEffect(() => {
    void retryInitialization();
  }, [retryInitialization]);

  const nodeseekIdentity = identityNeedsTrustedFallback('nodeseek', sessions)
    ? state.sources.nodeseek.identityKey
    : confirmedIdentity('nodeseek', sessions);
  const linuxdoIdentity = identityNeedsTrustedFallback('linuxdo', sessions)
    ? state.sources.linuxdo.identityKey
    : confirmedIdentity('linuxdo', sessions);
  const yaohuoIdentity = identityNeedsTrustedFallback('yaohuo', sessions)
    ? state.sources.yaohuo.identityKey
    : confirmedIdentity('yaohuo', sessions);
  const identityKeys = useMemo<Partial<Record<NotificationSource, string>>>(
    () => ({
      nodeseek: nodeseekIdentity,
      linuxdo: linuxdoIdentity,
      yaohuo: yaohuoIdentity
    }),
    [linuxdoIdentity, nodeseekIdentity, yaohuoIdentity]
  );
  const identityKeysRef = useRef(identityKeys);
  useCommitRefValue(identityKeysRef, identityKeys);
  const identitySignature = `${enabledSourcesKey}:${enabledNetworkSources
    .map((source) => identityKeys[source] || `${source}:none`)
    .join('|')}`;
  const activeSourceSignature = notificationSources
    .filter(
      (source) =>
        enabledSources.includes(source) &&
        operationalSources.includes(source) &&
        Boolean(identityKeys[source]) &&
        sessions[source].identityTrust === 'confirmed' &&
        // A paused Query must stay observed for the existing verification recovery.
        (privateAccessAllowed(source, identityKeys[source]!) || Boolean(getReadBlock(source)))
    )
    .join('|');
  const activeNetworkSources = useMemo(
    () => (activeSourceSignature ? (activeSourceSignature.split('|') as NotificationSource[]) : []),
    [activeSourceSignature]
  );
  const activeSources = useMemo(
    () => enabledSources.filter((source) => activeNetworkSources.includes(source)),
    [activeNetworkSources, enabledSources]
  );
  const eligibleSources = useMemo(
    () => activeNetworkSources.filter((source) => state.sources[source].intentEnabled),
    [activeNetworkSources, state]
  );
  const previousContentScopeRef = useRef<{
    identitySignature: string;
    sources: readonly NotificationSource[];
    sourcesKey: string;
  }>(undefined);

  useEffect(() => {
    if (!runtimeReady) return;
    const previousScope = previousContentScopeRef.current;
    const membershipChanged = previousScope?.sourcesKey !== enabledSourcesKey;
    const preferenceChanged = contentPreferenceChangedRef.current;
    contentPreferenceChangedRef.current = false;
    previousContentScopeRef.current = {
      identitySignature,
      sources: enabledNetworkSources,
      sourcesKey: enabledSourcesKey
    };
    if (!membershipChanged && !preferenceChanged) return;
    const previousSources = membershipChanged ? previousScope?.sources || notificationSources : enabledNetworkSources;
    const disabledSources = previousSources.filter((source) => !enabledSources.includes(source));
    if (markNotificationSourcesCleaning(sourceLifecyclesRef.current, disabledSources)) {
      setSourceLifecycleSnapshot({ ...sourceLifecyclesRef.current });
    }
    const sourcesToClean = notificationSources.filter(
      (source) => sourceLifecyclesRef.current[source].phase !== 'clean'
    );
    if (!sourcesToClean.length) return;
    setSnapshotErrors((current) =>
      sourcesToClean.some((source) => current[source] !== undefined)
        ? Object.fromEntries(
            Object.entries(current).filter(([source]) => !sourcesToClean.includes(source as NotificationSource))
          )
        : current
    );
    void (async () => {
      const ownsPreviousAggregate = (query: { queryKey: readonly unknown[] }) =>
        Boolean(
          membershipChanged &&
          previousScope &&
          query.queryKey[0] === 'forum' &&
          query.queryKey[1] === 'all' &&
          query.queryKey[2] === 'notifications' &&
          query.queryKey.some(
            (part) =>
              part !== null &&
              typeof part === 'object' &&
              (part as Record<string, unknown>).identityKey === previousScope.identitySignature
          )
        );
      await Promise.all([
        ...sourcesToClean.map((source) =>
          appQueryClient.cancelQueries({ queryKey: forumQueryKeys.notifications(source) })
        ),
        ...(membershipChanged && previousScope
          ? [appQueryClient.cancelQueries({ predicate: ownsPreviousAggregate })]
          : [])
      ]);
      sourcesToClean.forEach((source) =>
        appQueryClient.removeQueries({ queryKey: forumQueryKeys.notifications(source) })
      );
      if (membershipChanged && previousScope) appQueryClient.removeQueries({ predicate: ownsPreviousAggregate });
      await Promise.allSettled(
        sourcesToClean.map((source) => {
          const previous = stateRef.current.sources[source];
          const { operation, started } = runNotificationSourceCleanup(
            sourceLifecyclesRef.current,
            source,
            async () => {
              try {
                await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
              } finally {
                await clearNotificationSourceForContentDisable(source);
              }
            },
            () => {
              if (mountedRef.current) {
                setSourceLifecycleSnapshot({ ...sourceLifecyclesRef.current });
              }
            }
          );
          if (started) {
            void operation.catch((error) => {
              recordDiagnosticError('source', 'notification-cleanup', error, { source });
              if (!mountedRef.current) return;
              const message = error instanceof Error ? error.message : '内容源停用清理失败';
              setSnapshotErrors((current) => ({ ...current, [source]: message }));
            });
          }
          return operation;
        })
      );
      const next = await loadNotificationState();
      if (!mountedRef.current) return;
      commitState(next);
      await syncBackground(
        next,
        bootstrap.granted,
        activeNetworkSources.filter((source) => next.sources[source].intentEnabled)
      );
    })().catch((error) => recordDiagnosticError('app', 'notification-cleanup', error));
  }, [
    activeNetworkSources,
    commitState,
    enabledNetworkSources,
    enabledSourcesKey,
    enabledSources,
    identitySignature,
    runtimeReady,
    syncBackground,
    bootstrap
  ]);

  useEffect(() => {
    if (!runtimeReady) return;
    let current = true;
    void (async () => {
      let changed = false;
      let nextState: NotificationState | undefined;
      for (const source of enabledNetworkSources) {
        if (!current) return;
        const previous = stateRef.current.sources[source];
        const nextIdentity = identityKeys[source];
        if (previous.identityKey === nextIdentity) continue;
        await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
        if (!current) return;
        nextState = await resetNotificationSourceIdentity(source, nextIdentity);
        if (!current) return;
        appQueryClient.removeQueries({
          queryKey: forumQueryKeys.notifications(source),
          predicate: ({ queryKey }) =>
            queryKey[3] !== 'snapshot' &&
            !queryKey.some(
              (part) =>
                part !== null &&
                typeof part === 'object' &&
                (part as Record<string, unknown>).identityKey === nextIdentity
            )
        });
        changed = true;
      }
      if (changed) appQueryClient.removeQueries({ queryKey: forumQueryKeys.notifications('all') });
      if (!current || !nextState) return;
      commitState(nextState);
      await syncBackground(nextState, bootstrap.granted, eligibleSources);
    })().catch((error) => recordDiagnosticError('app', 'notification-identity', error));
    return () => {
      current = false;
    };
  }, [
    commitState,
    eligibleSources,
    enabledNetworkSources,
    identityKeys,
    identitySignature,
    runtimeReady,
    syncBackground,
    bootstrap
  ]);

  useEffect(() => {
    if (runtimeReady) void syncBackground(stateRef.current, bootstrap.granted, eligibleSources);
  }, [eligibleSources, runtimeReady, syncBackground, bootstrap]);
  const remoteQueryEnabled = runtimeReady && remoteReady && appActive;
  const snapshotSourcesKey = activeNetworkSources
    .filter((source) => state.sources[source].identityKey === identityKeys[source])
    .join('|');
  const snapshotSources = useMemo(
    () => (snapshotSourcesKey ? (snapshotSourcesKey.split('|') as NotificationSource[]) : []),
    [snapshotSourcesKey]
  );
  const snapshotQueries = useQueries({
    queries: snapshotSources.map((source) => ({
      queryKey: forumQueryKeys.notificationSnapshot({ source, identityKey: identityKeys[source]! }),
      enabled: remoteQueryEnabled,
      staleTime: 0,
      refetchOnMount: getReadBlock(source) ? false : ('always' as const),
      refetchInterval: getReadBlock(source) ? false : centerVisible ? 60_000 : 300_000,
      refetchIntervalInBackground: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const blocked = getReadBlock(source);
        if (blocked) throw blocked;
        const epoch = sessionEpochs[source];
        try {
          return {
            revision: ++snapshotResultRevisionRef.current,
            snapshot: await gateway.readUnreadSnapshot(source, signal)
          };
        } catch (error) {
          reportReadError(source, sourceErrorFromUnknown(source, error), epoch);
          throw error;
        }
      }
    }))
  });
  const snapshotQueriesRef = useRef(snapshotQueries);
  const snapshotSourcesRef = useRef(snapshotSources);
  const remoteQueryEnabledRef = useRef(remoteQueryEnabled);
  useCommitRefValue(snapshotQueriesRef, snapshotQueries);
  useCommitRefValue(snapshotSourcesRef, snapshotSources);
  useCommitRefValue(remoteQueryEnabledRef, remoteQueryEnabled);
  useLayoutEffect(() => {
    foregroundDeliveries.invalidate();
  }, [remoteQueryEnabled, foregroundDeliveries]);
  const refetchSnapshots = useCallback(async () => {
    if (!mountedRef.current || !remoteQueryEnabledRef.current) return [];
    const reads = snapshotSourcesRef.current.flatMap((source, index) => {
      const identityKey = identityKeysRef.current[source];
      const query = snapshotQueriesRef.current[index];
      return identityKey && query
        ? [
            {
              source,
              identityKey,
              epoch: sessionEpochsRef.current[source],
              lifecycle: sourceLifecyclesRef.current[source],
              query
            }
          ]
        : [];
    });
    // Initial loads otherwise share the pre-write promise, even with cancelRefetch.
    await Promise.all(
      reads.map(({ source, identityKey }) =>
        appQueryClient.cancelQueries({
          queryKey: forumQueryKeys.notificationSnapshot({ source, identityKey }),
          exact: true
        })
      )
    );
    return Promise.all(
      reads.flatMap(({ source, identityKey, epoch, lifecycle, query }) =>
        mountedRef.current &&
        remoteQueryEnabledRef.current &&
        sourceIsOperational(source) &&
        sourceLifecyclesRef.current[source] === lifecycle &&
        identityKeysRef.current[source] === identityKey &&
        sessionEpochsRef.current[source] === epoch
          ? [query.refetch()]
          : []
      )
    );
  }, [sourceIsOperational]);

  const runForegroundDelivery = useCallback(
    (jobs: readonly ForegroundDelivery[]): void => {
      const currentJob = (job: ForegroundDelivery) =>
        mountedRef.current &&
        remoteQueryEnabledRef.current &&
        foregroundDeliveries.generation === job.generation &&
        bootstrap.granted &&
        stateRef.current.globalEnabled &&
        stateRef.current.sources[job.source].intentEnabled &&
        stateRef.current.sources[job.source].identityKey === job.identityKey &&
        identityKeysRef.current[job.source] === job.identityKey &&
        sessionEpochsRef.current[job.source] === job.epoch &&
        sourceLifecyclesRef.current[job.source] === job.lifecycle &&
        !getReadBlock(job.source) &&
        sourceIsOperational(job.source) &&
        privateAccessAllowedRef.current(job.source, job.identityKey);
      for (const job of jobs) if (currentJob(job)) foregroundDeliveries.enqueue(job);
      foregroundDeliveries.drain(
        async (batch) => {
          const sources = [...batch.values()].filter(currentJob).map((job) => job.source);
          if (!sources.length) return;
          let deliverySettlement: Promise<void> | undefined;
          await runNotificationBackgroundWorker({
            sources,
            flow: 'foreground',
            captureDeliverySettlement: (settlement) => {
              deliverySettlement = settlement;
            },
            sourceAllowed: async (source) => sourceIsOperational(source),
            privateAccessAllowed: async (source, identityKey) => {
              const job = batch.get(source);
              return Boolean(job && job.identityKey === identityKey && currentJob(job));
            },
            network: {
              restoreProxy: async () => undefined,
              probeAccess: async (source, signal) => ({ ...(await readAccessRef.current(source)), signal }),
              listPage: (source, access, signal, cursor) =>
                notificationAdapters[source].listPage({ ...access, signal, cursor, limit: 60 })
            },
            store: {
              clearForContentDisable: clearNotificationSourceForContentDisable,
              load: loadNotificationState,
              record: recordNotificationDelivery
            },
            system: {
              permissionGranted: notificationPermissionGranted,
              reconcileDigests: reconcileSourceNotificationSlots,
              presentDigest: presentSourceNotification,
              dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
            }
          }).catch((error) => recordDiagnosticError('app', 'notification-worker', error));
          await deliverySettlement;
        },
        (error) => recordDiagnosticError('app', 'notification-worker', error)
      );
    },
    [getReadBlock, sourceIsOperational, bootstrap, foregroundDeliveries]
  );

  const handledSnapshotUpdateRef = useRef(new Map<string, number>());
  const snapshotRevision = snapshotQueries
    .map((query, index) => `${snapshotSources[index]}:${query.data?.revision || 0}:${query.errorUpdatedAt}`)
    .join('|');
  useEffect(() => {
    const errors: Partial<Record<NotificationSource, string>> = {};
    const deliveries: ForegroundDelivery[] = [];
    const writes = snapshotSources.flatMap((source, index) => {
      const query = snapshotQueriesRef.current[index];
      if (!query) return [];
      if (query.isError) errors[source] = sourceErrorFromUnknown(source, query.error).message;
      const result = query.data;
      const snapshot = result?.snapshot;
      const identityKey = identityKeys[source];
      const revision = result?.revision || 0;
      if (!snapshot || !identityKey) return [];
      const handledKey = `${source}\u0000${identityKey}`;
      if (handledSnapshotUpdateRef.current.get(handledKey) === revision) return [];
      handledSnapshotUpdateRef.current.set(handledKey, revision);
      deliveries.push({
        source,
        identityKey,
        epoch: sessionEpochsRef.current[source],
        generation: foregroundDeliveries.generation,
        lifecycle: sourceLifecyclesRef.current[source]
      });
      return [
        recordNotificationSnapshot(source, identityKey, snapshot.total, snapshot.checkedAt).catch((error) => {
          recordDiagnosticError('source', 'notification-snapshot', error, { source });
          throw error;
        })
      ];
    });
    setSnapshotErrors((current) =>
      notificationSources.every((source) => current[source] === errors[source]) ? current : errors
    );
    if (writes.length) void Promise.allSettled(writes).then(() => runForegroundDelivery(deliveries));
  }, [identityKeys, runForegroundDelivery, snapshotRevision, snapshotSources, foregroundDeliveries]);

  const currentSnapshots: Partial<Record<NotificationSource, { checkedAt: string; total: number }>> = {};
  snapshotSources.forEach((source, index) => {
    const snapshot = snapshotQueries[index]?.data?.snapshot;
    if (snapshot) currentSnapshots[source] = snapshot;
  });

  const unreadTotal = enabledSources.reduce((total, source) => {
    const snapshot = currentSnapshots[source];
    if (snapshot) return total + snapshot.total;
    const persisted = state.sources[source];
    return total + (persisted.identityKey === identityKeys[source] ? persisted.unreadCount || 0 : 0);
  }, 0);

  useEffect(() => {
    if (!appActive || !runtimeReady || permission === 'checking' || permission === 'unavailable') return;
    let current = true;
    void notificationPermissionGranted()
      .then((granted) => {
        if (!current) return;
        bootstrap.observedPermission(granted);
        publishBootstrap();
        void syncBackground(stateRef.current, granted, eligibleSources);
      })
      .catch((error) => {
        if (!current) return;
        bootstrap.failedPermission();
        publishBootstrap();
        void syncBackground(stateRef.current, false, eligibleSources);
        recordDiagnosticError('app', 'notification-permission', error);
      });
    return () => {
      current = false;
    };
  }, [appActive, eligibleSources, permission, runtimeReady, syncBackground, bootstrap, publishBootstrap]);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const rawSource = response.notification.request.content.data?.source;
      const source = notificationSources.find((candidate) => candidate === rawSource);
      const trace = beginDiagnosticTrace('app', 'notification-response', { ...(source ? { source } : {}) });
      if (
        !contentSourcesReadyRef.current ||
        !source ||
        !isNotificationSource(source) ||
        !enabledSourcesRef.current.includes(source) ||
        !sourceIsOperational(source)
      ) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        clearLastNotificationResponse();
        return;
      }
      const key = `${response.notification.request.identifier}:${response.notification.date}`;
      const request = { source, trace };
      const received = openIntent.receive(key, request);
      if (received.kind === 'duplicate') {
        finishDiagnosticTrace(trace, 'noop', { reason: 'duplicate' });
        return;
      }
      const previous = received.previous;
      if (previous) {
        finishDiagnosticTrace(previous.trace, 'canceled', { reason: 'superseded' });
      }
      try {
        if (!openSource(source)) {
          if (openIntent.waiting(request)) markDiagnosticStage(trace, 'apply', { source, state: 'queued' });
        } else if (openIntent.opened(request)) {
          finishDiagnosticTrace(trace, 'success', { source, state: 'open' });
        }
      } catch (error) {
        openIntent.cancel(request);
        finishDiagnosticTrace(trace, 'failure', { source, reason: normalizeDiagnosticReason(error) });
        throw error;
      }
      clearLastNotificationResponse();
    },
    [openSource, sourceIsOperational, openIntent]
  );

  useEffect(() => {
    if (!runtimeReady) return undefined;
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    try {
      const response = Notifications.getLastNotificationResponse();
      if (response) handleNotificationResponse(response);
    } catch (error) {
      recordDiagnosticError('app', 'notification-response', error);
    }
    return () => subscription.remove();
  }, [handleNotificationResponse, runtimeReady]);

  const onNavigationReady = useCallback(() => {
    if (!mountedRef.current) return;
    const pending = openIntent.dispatchPending();
    if (!pending) return;
    const { source, trace } = pending;
    if (!contentSourcesReadyRef.current || !sourceIsOperational(source)) {
      finishDiagnosticTrace(trace, 'canceled', { source, reason: 'not_ready' });
      openIntent.cancel(pending);
      return;
    }
    try {
      if (openSource(source)) {
        if (openIntent.opened(pending)) finishDiagnosticTrace(trace, 'success', { source, state: 'open' });
      } else openIntent.waiting(pending);
    } catch (error) {
      openIntent.cancel(pending);
      finishDiagnosticTrace(trace, 'failure', { source, reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [openSource, sourceIsOperational, openIntent]);

  const setGlobalEnabled = useCallback(
    async (enabled: boolean) => {
      if (!runtimeReadyRef.current) throw new Error('通知存储尚未恢复，请先重试初始化');
      const firstOptIn = enabled && !stateRef.current.hasOptedIn;
      const next = await setGlobalNotificationIntent(enabled);
      commitState(next);
      let granted = bootstrap.granted;
      if (firstOptIn && !granted) granted = await requestNotificationPermission();
      bootstrap.requestedPermission(granted);
      publishBootstrap();
      if (!enabled) {
        await Promise.all(
          notificationSources.map((source) =>
            dismissSourceNotification(
              source,
              next.sources[source].notificationIdentifier,
              next.sources[source].identityKey
            )
          )
        );
      }
      await syncBackground(
        next,
        granted,
        activeNetworkSources.filter((source) => next.sources[source].intentEnabled)
      );
      if (enabled) void refetchSnapshots();
      return granted;
    },
    [activeNetworkSources, commitState, refetchSnapshots, syncBackground, bootstrap, publishBootstrap]
  );

  const setSourceEnabled = useCallback(
    async (source: NotificationSource, enabled: boolean) => {
      if (!runtimeReadyRef.current) throw new Error('通知存储尚未恢复，请先重试初始化');
      const next = await setSourceNotificationIntent(source, enabled);
      commitState(next);
      if (!enabled) {
        await dismissSourceNotification(
          source,
          next.sources[source].notificationIdentifier,
          next.sources[source].identityKey
        );
      }
      await syncBackground(
        next,
        bootstrap.granted,
        activeNetworkSources.filter((candidate) => next.sources[candidate].intentEnabled)
      );
      if (enabled) void refetchSnapshots();
    },
    [activeNetworkSources, commitState, refetchSnapshots, syncBackground, bootstrap]
  );

  const backgroundEnabled = state.globalEnabled && permission === 'granted' && eligibleSources.length > 0;

  return {
    clearReadBlock,
    getReadBlock,
    reportReadError,
    sessionEpochs,
    activeSources,
    backgroundEnabled,
    backgroundError,
    initializationError: storageError || permissionError,
    retryInitialization,
    gateway,
    identityKeys,
    identitySignature,
    enabledNotificationSources: enabledSources,
    partialUnavailable: enabledSources.some((source) => Boolean(snapshotErrors[source])),
    permission,
    ready: runtimeReady,
    sessions,
    snapshotErrors,
    state,
    unreadTotal,
    openSystemSettings: openNotificationSystemSettings,
    onNavigationReady,
    refreshSnapshots: refetchSnapshots,
    setCenterVisible,
    setGlobalEnabled,
    setSourceEnabled
  };
}

export type NotificationsRuntimeValue = ReturnType<typeof useNotificationsRuntime>;
