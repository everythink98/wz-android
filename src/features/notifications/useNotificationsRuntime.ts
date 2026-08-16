import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { isNotificationSource, notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { Fetcher } from '@/platform/network/request';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { createNotificationGateway, type NotificationAccessReader } from '@/sources/notificationGateway';
import { readForegroundNotificationAccess } from '@/sources/notificationForegroundAccess';
import { loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';
import { xiaoyinsiCredentialsHaveScope } from '@/sources/xiaoyinsi/credentials';
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

export type NotificationPermissionState = 'checking' | 'granted' | 'denied';

function confirmedIdentity(source: NotificationSource, sessions: SiteSessionViewModels) {
  const session = sessions[source];
  const userId = String(session.currentUser?.id || '').trim();
  return session.isLoggedIn && session.identityTrust === 'confirmed' && userId ? `${source}:${userId}` : undefined;
}

function identityNeedsTrustedFallback(source: NotificationSource, sessions: SiteSessionViewModels) {
  const trust = sessions[source].identityTrust;
  return trust === 'pending' || trust === 'unknown';
}

export function useNotificationsRuntime({
  appActive,
  authorizationRevision,
  beginXiaoyinsiAuthorization,
  contentSourcesReady,
  enabledNotificationSources,
  fetcher,
  getLinuxDoUserAgent,
  getNodeSeekUserAgent,
  openSource,
  privateAccessAllowed,
  remoteReady,
  sessions
}: {
  appActive: boolean;
  authorizationRevision: string;
  beginXiaoyinsiAuthorization: () => void;
  contentSourcesReady: boolean;
  enabledNotificationSources: readonly NotificationSource[];
  fetcher: Fetcher;
  getLinuxDoUserAgent: () => string;
  getNodeSeekUserAgent: () => string;
  openSource: (source?: NotificationSource) => boolean;
  privateAccessAllowed: (source: NotificationSource, identityKey: string) => boolean;
  remoteReady: boolean;
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
  const operationalSourcesRef = useRef<readonly NotificationSource[]>([]);
  const previousEnabledSourcesRef = useRef<readonly NotificationSource[]>(notificationSources);
  const contentPreferenceChangedRef = useRef(false);
  const contentDisablePendingRef = useRef(new Set<NotificationSource>());
  const contentDisableOperationsRef = useRef<Partial<Record<NotificationSource, Promise<void>>>>({});
  const privateAccessAllowedRef = useRef(privateAccessAllowed);
  useCommitRefValue(privateAccessAllowedRef, privateAccessAllowed);
  const readAccess = useMemo<NotificationAccessReader>(
    () => (source) =>
      readForegroundNotificationAccess({
        fetcher,
        loadXiaoyinsiCredentials,
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
        privateAccessAllowed: (source, identityKey) => privateAccessAllowedRef.current(source, identityKey),
        readAccess,
        sourceAllowed: (source) => operationalSourcesRef.current.includes(source)
      }),
    [readAccess]
  );
  const readAccessRef = useRef(readAccess);
  useCommitRefValue(readAccessRef, readAccess);
  const stateRef = useRef<NotificationState>(defaultNotificationState());
  const permissionRef = useRef(false);
  const backgroundErrorRef = useRef('');
  const mountedRef = useRef(true);
  const foregroundDeliveryRef = useRef<Promise<void> | undefined>(undefined);
  const pendingForegroundDeliveryBatchesRef = useRef<NotificationSource[][]>([]);
  const snapshotResultRevisionRef = useRef(0);
  const pendingOpenSourceRef = useRef<NotificationSource | undefined>(undefined);
  const lastResponseRef = useRef('');
  const [state, setState] = useState(stateRef.current);
  const [ready, setReady] = useState(false);
  const [centerVisible, setCenterVisibleState] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>('checking');
  const [backgroundError, setBackgroundError] = useState('');
  const [snapshotErrors, setSnapshotErrors] = useState<Partial<Record<NotificationSource, string>>>({});
  const [xiaoyinsiNotificationsScope, setXiaoyinsiNotificationsScope] = useState<boolean | null>(null);
  const [operationalSources, setOperationalSources] = useState<readonly NotificationSource[]>([]);
  const runtimeReady = ready && contentSourcesReady;
  const xiaoyinsiContentEnabled = enabledSources.includes('xiaoyinsi');

  useLayoutEffect(() => {
    enabledSourcesRef.current = enabledSources;
    contentSourcesReadyRef.current = contentSourcesReady;
    runtimeReadyRef.current = runtimeReady;
    if (contentSourcesReady) {
      if (previousEnabledSourcesRef.current.join('|') !== enabledSources.join('|')) {
        contentPreferenceChangedRef.current = true;
      }
      const removedSources = previousEnabledSourcesRef.current.filter((source) => !enabledSources.includes(source));
      removedSources.forEach((source) => contentDisablePendingRef.current.add(source));
      if (pendingOpenSourceRef.current && removedSources.includes(pendingOpenSourceRef.current)) {
        pendingOpenSourceRef.current = undefined;
      }
      previousEnabledSourcesRef.current = enabledSources;
    }
    const next = runtimeReady
      ? enabledNetworkSources.filter((source) => !contentDisablePendingRef.current.has(source))
      : [];
    operationalSourcesRef.current = next;
    setOperationalSources((current) => (current.join('|') === next.join('|') ? current : next));
  }, [contentSourcesReady, enabledNetworkSources, enabledSources, runtimeReady]);

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
    };
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([loadNotificationState(), notificationPermissionGranted()]).then(([stored, granted]) => {
      if (!current) return;
      permissionRef.current = granted;
      commitState(stored);
      setPermission(granted ? 'granted' : 'denied');
      setReady(true);
    });
    return () => {
      current = false;
    };
  }, [commitState]);

  useEffect(() => {
    if (!runtimeReady || !xiaoyinsiContentEnabled) {
      if (runtimeReady) {
        setXiaoyinsiNotificationsScope(false);
      }
      return undefined;
    }
    let current = true;
    setXiaoyinsiNotificationsScope(null);
    void loadXiaoyinsiCredentials()
      .then((credentials) => {
        if (current) setXiaoyinsiNotificationsScope(xiaoyinsiCredentialsHaveScope(credentials, 'notifications'));
      })
      .catch(() => {
        if (current) setXiaoyinsiNotificationsScope(false);
      });
    return () => {
      current = false;
    };
  }, [appActive, authorizationRevision, runtimeReady, xiaoyinsiContentEnabled]);

  const nodeseekIdentity = identityNeedsTrustedFallback('nodeseek', sessions)
    ? state.sources.nodeseek.identityKey
    : confirmedIdentity('nodeseek', sessions);
  const linuxdoIdentity = identityNeedsTrustedFallback('linuxdo', sessions)
    ? state.sources.linuxdo.identityKey
    : confirmedIdentity('linuxdo', sessions);
  const yaohuoIdentity = identityNeedsTrustedFallback('yaohuo', sessions)
    ? state.sources.yaohuo.identityKey
    : confirmedIdentity('yaohuo', sessions);
  const xiaoyinsiIdentity = identityNeedsTrustedFallback('xiaoyinsi', sessions)
    ? state.sources.xiaoyinsi.identityKey
    : confirmedIdentity('xiaoyinsi', sessions);
  const identityKeys = useMemo<Partial<Record<NotificationSource, string>>>(
    () => ({
      nodeseek: nodeseekIdentity,
      linuxdo: linuxdoIdentity,
      yaohuo: yaohuoIdentity,
      xiaoyinsi: xiaoyinsiIdentity
    }),
    [linuxdoIdentity, nodeseekIdentity, xiaoyinsiIdentity, yaohuoIdentity]
  );
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
        (source !== 'xiaoyinsi' || xiaoyinsiNotificationsScope === true)
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
    disabledSources.forEach((source) => contentDisablePendingRef.current.add(source));
    const sourcesToClean = notificationSources.filter((source) => contentDisablePendingRef.current.has(source));
    if (!sourcesToClean.length) return;
    setSnapshotErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([source]) => !sourcesToClean.includes(source as NotificationSource))
      )
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
          const existing = contentDisableOperationsRef.current[source];
          if (existing) return existing;
          const previous = stateRef.current.sources[source];
          const operation = (async () => {
            try {
              await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
            } finally {
              await clearNotificationSourceForContentDisable(source);
            }
          })();
          contentDisableOperationsRef.current[source] = operation;
          void operation
            .then(() => {
              if (contentDisableOperationsRef.current[source] !== operation) return;
              delete contentDisableOperationsRef.current[source];
              contentDisablePendingRef.current.delete(source);
              const next = runtimeReadyRef.current
                ? notificationSources.filter(
                    (candidate) =>
                      enabledSourcesRef.current.includes(candidate) && !contentDisablePendingRef.current.has(candidate)
                  )
                : [];
              operationalSourcesRef.current = next;
              if (mountedRef.current) {
                setOperationalSources((current) => (current.join('|') === next.join('|') ? current : next));
              }
            })
            .catch((error) => {
              if (contentDisableOperationsRef.current[source] !== operation) return;
              delete contentDisableOperationsRef.current[source];
              if (mountedRef.current) {
                const message = error instanceof Error ? error.message : '内容源停用清理失败';
                setSnapshotErrors((current) => ({ ...current, [source]: message }));
              }
            });
          return operation;
        })
      );
      const next = await loadNotificationState();
      if (!mountedRef.current) return;
      commitState(next);
      await syncBackground(
        next,
        permissionRef.current,
        activeNetworkSources.filter((source) => next.sources[source].intentEnabled)
      );
    })().catch(() => undefined);
  }, [
    activeNetworkSources,
    commitState,
    enabledNetworkSources,
    enabledSourcesKey,
    enabledSources,
    identitySignature,
    runtimeReady,
    syncBackground
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
      await syncBackground(nextState, permissionRef.current, eligibleSources);
    })();
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
    syncBackground
  ]);

  useEffect(() => {
    if (runtimeReady) void syncBackground(stateRef.current, permissionRef.current, eligibleSources);
  }, [eligibleSources, runtimeReady, syncBackground]);
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
      refetchOnMount: 'always' as const,
      refetchInterval: centerVisible ? 60_000 : 300_000,
      refetchIntervalInBackground: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => ({
        revision: ++snapshotResultRevisionRef.current,
        snapshot: await gateway.readUnreadSnapshot(source, signal)
      })
    }))
  });
  const snapshotQueriesRef = useRef(snapshotQueries);
  const remoteQueryEnabledRef = useRef(remoteQueryEnabled);
  useCommitRefValue(snapshotQueriesRef, snapshotQueries);
  useCommitRefValue(remoteQueryEnabledRef, remoteQueryEnabled);
  const refetchSnapshots = useCallback(
    () =>
      remoteQueryEnabledRef.current
        ? Promise.all(snapshotQueriesRef.current.map((query) => query.refetch()))
        : Promise.resolve([]),
    []
  );

  const runForegroundDelivery = useCallback((sources: readonly NotificationSource[]) => {
    if (!sources.length || !stateRef.current.globalEnabled || !permissionRef.current) {
      return;
    }
    pendingForegroundDeliveryBatchesRef.current.push([...sources]);
    if (foregroundDeliveryRef.current) return;
    const operation = (async () => {
      while (pendingForegroundDeliveryBatchesRef.current.length) {
        const batch = pendingForegroundDeliveryBatchesRef.current.shift()!;
        await runNotificationBackgroundWorker({
          sources: batch,
          sourceAllowed: async (source) => operationalSourcesRef.current.includes(source),
          privateAccessAllowed: async (source, identityKey) => privateAccessAllowedRef.current(source, identityKey),
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
        }).catch(() => undefined);
      }
    })();
    foregroundDeliveryRef.current = operation;
    void operation.finally(() => {
      if (foregroundDeliveryRef.current === operation) foregroundDeliveryRef.current = undefined;
    });
  }, []);

  const handledSnapshotUpdateRef = useRef(new Map<string, number>());
  const snapshotRevision = snapshotQueries
    .map((query, index) => `${snapshotSources[index]}:${query.data?.revision || 0}:${query.errorUpdatedAt}`)
    .join('|');
  useEffect(() => {
    const errors: Partial<Record<NotificationSource, string>> = {};
    const refreshedSources: NotificationSource[] = [];
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
      refreshedSources.push(source);
      return [recordNotificationSnapshot(source, identityKey, snapshot.total, snapshot.checkedAt)];
    });
    setSnapshotErrors(errors);
    if (writes.length) void Promise.allSettled(writes).then(() => runForegroundDelivery(refreshedSources));
  }, [identityKeys, runForegroundDelivery, snapshotRevision, snapshotSources]);

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
    if (!appActive || !runtimeReady) return;
    let current = true;
    void notificationPermissionGranted().then((granted) => {
      if (!current) return;
      const changed = permissionRef.current !== granted;
      permissionRef.current = granted;
      if (changed) setPermission(granted ? 'granted' : 'denied');
      void syncBackground(stateRef.current, granted, eligibleSources);
    });
    return () => {
      current = false;
    };
  }, [appActive, eligibleSources, runtimeReady, syncBackground]);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const rawSource = response.notification.request.content.data?.source;
      const source = notificationSources.find((candidate) => candidate === rawSource);
      if (
        !contentSourcesReadyRef.current ||
        !source ||
        !isNotificationSource(source) ||
        !enabledSourcesRef.current.includes(source) ||
        !operationalSourcesRef.current.includes(source)
      ) {
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        return;
      }
      const key = `${response.notification.request.identifier}:${response.notification.date}`;
      if (lastResponseRef.current === key) return;
      lastResponseRef.current = key;
      if (!openSource(source)) pendingOpenSourceRef.current = source;
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    },
    [openSource]
  );

  useEffect(() => {
    if (!runtimeReady) return undefined;
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });
    return () => subscription.remove();
  }, [handleNotificationResponse, runtimeReady]);

  const onNavigationReady = useCallback(() => {
    const source = pendingOpenSourceRef.current;
    if (!source) return;
    if (!contentSourcesReadyRef.current || !operationalSourcesRef.current.includes(source)) {
      pendingOpenSourceRef.current = undefined;
      return;
    }
    if (openSource(source)) pendingOpenSourceRef.current = undefined;
  }, [openSource]);

  const setGlobalEnabled = useCallback(
    async (enabled: boolean) => {
      const firstOptIn = enabled && !stateRef.current.hasOptedIn;
      const next = await setGlobalNotificationIntent(enabled);
      commitState(next);
      let granted = permissionRef.current;
      if (firstOptIn && !granted) granted = await requestNotificationPermission();
      permissionRef.current = granted;
      setPermission(granted ? 'granted' : 'denied');
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
    [activeNetworkSources, commitState, refetchSnapshots, syncBackground]
  );

  const setSourceEnabled = useCallback(
    async (source: NotificationSource, enabled: boolean) => {
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
        permissionRef.current,
        activeNetworkSources.filter((candidate) => next.sources[candidate].intentEnabled)
      );
      if (enabled) void refetchSnapshots();
    },
    [activeNetworkSources, commitState, refetchSnapshots, syncBackground]
  );

  const backgroundEnabled = state.globalEnabled && permission === 'granted' && eligibleSources.length > 0;

  return {
    activeSources,
    backgroundEnabled,
    backgroundError,
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
    xiaoyinsiNeedsUpgrade: sessions.xiaoyinsi.isLoggedIn && xiaoyinsiNotificationsScope === false,
    beginXiaoyinsiAuthorization,
    openSystemSettings: openNotificationSystemSettings,
    onNavigationReady,
    refreshSnapshots: refetchSnapshots,
    setCenterVisible,
    setGlobalEnabled,
    setSourceEnabled
  };
}

export type NotificationsRuntimeValue = ReturnType<typeof useNotificationsRuntime>;
