import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  recordNotificationSnapshot,
  resetNotificationSourceIdentity,
  setGlobalNotificationIntent,
  setNotificationIdentifier,
  setSourceNotificationIntent,
  type NotificationState
} from '@/platform/notifications/notificationStore';
import {
  dismissSourceNotification,
  notificationPermissionGranted,
  openNotificationSystemSettings,
  replaceSourceNotification,
  requestNotificationPermission,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { notificationAdapters } from '@/sources/notificationAdapters';

export type NotificationPermissionState = 'checking' | 'granted' | 'denied';

function confirmedIdentity(source: NotificationSource, sessions: SiteSessionViewModels) {
  const session = sessions[source];
  const userId = String(session.currentUser?.id || '').trim();
  return session.isLoggedIn && session.identityTrust === 'confirmed' && userId ? `${source}:${userId}` : undefined;
}

export function useNotificationsRuntime({
  appActive,
  authorizationRevision,
  beginXiaoyinsiAuthorization,
  fetcher,
  getLinuxDoUserAgent,
  getNodeSeekUserAgent,
  openSource,
  sessions
}: {
  appActive: boolean;
  authorizationRevision: string;
  beginXiaoyinsiAuthorization: () => void;
  fetcher: Fetcher;
  getLinuxDoUserAgent: () => string;
  getNodeSeekUserAgent: () => string;
  openSource: (source?: NotificationSource) => boolean;
  sessions: SiteSessionViewModels;
}) {
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
  const gateway = useMemo(() => createNotificationGateway({ readAccess }), [readAccess]);
  const readAccessRef = useRef(readAccess);
  readAccessRef.current = readAccess;
  const stateRef = useRef<NotificationState>(defaultNotificationState());
  const permissionRef = useRef(false);
  const backgroundErrorRef = useRef('');
  const mountedRef = useRef(true);
  const foregroundDeliveryRef = useRef<Promise<void> | undefined>(undefined);
  const pendingOpenSourceRef = useRef<NotificationSource | undefined>(undefined);
  const lastResponseRef = useRef('');
  const [state, setState] = useState(stateRef.current);
  const [ready, setReady] = useState(false);
  const [centerVisible, setCenterVisibleState] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>('checking');
  const [backgroundError, setBackgroundError] = useState('');
  const [snapshotErrors, setSnapshotErrors] = useState<Partial<Record<NotificationSource, string>>>({});
  const [xiaoyinsiScopeChecked, setXiaoyinsiScopeChecked] = useState(false);
  const [xiaoyinsiNotificationsScope, setXiaoyinsiNotificationsScope] = useState(false);

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
    let current = true;
    void loadXiaoyinsiCredentials()
      .then((credentials) => {
        if (current) setXiaoyinsiNotificationsScope(xiaoyinsiCredentialsHaveScope(credentials, 'notifications'));
      })
      .catch(() => {
        if (current) setXiaoyinsiNotificationsScope(false);
      })
      .finally(() => {
        if (current) setXiaoyinsiScopeChecked(true);
      });
    return () => {
      current = false;
    };
  }, [appActive, authorizationRevision]);

  const nodeseekIdentity =
    sessions.nodeseek.identityTrust === 'pending'
      ? state.sources.nodeseek.identityKey
      : confirmedIdentity('nodeseek', sessions);
  const linuxdoIdentity =
    sessions.linuxdo.identityTrust === 'pending'
      ? state.sources.linuxdo.identityKey
      : confirmedIdentity('linuxdo', sessions);
  const yaohuoIdentity =
    sessions.yaohuo.identityTrust === 'pending'
      ? state.sources.yaohuo.identityKey
      : confirmedIdentity('yaohuo', sessions);
  const xiaoyinsiIdentity =
    sessions.xiaoyinsi.identityTrust === 'pending'
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
  const identitySignature = notificationSources.map((source) => identityKeys[source] || `${source}:none`).join('|');
  const activeSourceSignature = notificationSources
    .filter(
      (source) =>
        Boolean(identityKeys[source]) &&
        sessions[source].identityTrust === 'confirmed' &&
        (source !== 'xiaoyinsi' || xiaoyinsiNotificationsScope)
    )
    .join('|');
  const activeSources = useMemo(
    () => (activeSourceSignature ? (activeSourceSignature.split('|') as NotificationSource[]) : []),
    [activeSourceSignature]
  );

  useEffect(() => {
    if (!ready) return;
    let current = true;
    void (async () => {
      let changed = false;
      for (const source of notificationSources) {
        if (!current) return;
        const previous = stateRef.current.sources[source];
        const nextIdentity = identityKeys[source];
        if (previous.identityKey === nextIdentity) continue;
        await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
        if (!current) return;
        await resetNotificationSourceIdentity(source, nextIdentity);
        if (!current) return;
        appQueryClient.removeQueries({ queryKey: forumQueryKeys.notifications(source) });
        changed = true;
      }
      if (changed) appQueryClient.removeQueries({ queryKey: forumQueryKeys.notifications('all') });
      if (!current || !changed) return;
      const next = await loadNotificationState();
      if (!current) return;
      commitState(next);
      await syncBackground(next, permissionRef.current, activeSources);
    })();
    return () => {
      current = false;
    };
  }, [activeSources, commitState, identityKeys, identitySignature, ready, syncBackground]);

  useEffect(() => {
    if (ready) void syncBackground(stateRef.current, permissionRef.current, activeSources);
  }, [activeSources, ready, syncBackground]);
  const snapshotQuery = useQuery({
    queryKey: forumQueryKeys.notificationSnapshots(identitySignature),
    enabled: ready && appActive && activeSources.length > 0,
    staleTime: 0,
    refetchInterval: centerVisible ? 60_000 : 300_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const settled = await Promise.allSettled(
        activeSources.map(async (source) => [source, await gateway.readUnreadSnapshot(source, signal)] as const)
      );
      const snapshots: Partial<Record<NotificationSource, { total: number; checkedAt: string }>> = {};
      const errors: Partial<Record<NotificationSource, string>> = {};
      settled.forEach((result, index) => {
        const source = activeSources[index]!;
        if (result.status === 'fulfilled') snapshots[source] = result.value[1];
        else errors[source] = sourceErrorFromUnknown(source, result.reason).message;
      });
      return { errors, snapshots };
    }
  });
  const refetchSnapshots = snapshotQuery.refetch;

  const runForegroundDelivery = useCallback((sources: readonly NotificationSource[]) => {
    if (!sources.length || foregroundDeliveryRef.current || !stateRef.current.globalEnabled || !permissionRef.current) {
      return;
    }
    const operation = runNotificationBackgroundWorker({
      sources,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async (source, signal) => ({ ...(await readAccessRef.current(source)), signal }),
        listPage: (source, access, signal, cursor) =>
          notificationAdapters[source].listPage({ ...access, signal, cursor, limit: 60 })
      },
      store: {
        load: loadNotificationState,
        record: recordNotificationDelivery,
        setIdentifier: setNotificationIdentifier
      },
      system: {
        permissionGranted: notificationPermissionGranted,
        replaceDigest: replaceSourceNotification,
        dismissDigest: (source, identifier) => dismissSourceNotification(source, identifier)
      }
    })
      .then(() => undefined)
      .catch(() => undefined);
    foregroundDeliveryRef.current = operation;
    void operation.finally(() => {
      if (foregroundDeliveryRef.current === operation) foregroundDeliveryRef.current = undefined;
    });
  }, []);

  useEffect(() => {
    if (appActive && ready && activeSources.length) void refetchSnapshots();
  }, [activeSources.length, appActive, ready, refetchSnapshots]);

  useEffect(() => {
    const data = snapshotQuery.data;
    if (!data) return;
    setSnapshotErrors(data.errors);
    const next: NotificationState = {
      ...stateRef.current,
      sources: { ...stateRef.current.sources }
    };
    const refreshedSources = activeSources.filter((source) => Boolean(data.snapshots[source]));
    const writes = notificationSources.flatMap((source) => {
      const snapshot = data.snapshots[source];
      const identityKey = identityKeys[source];
      if (!snapshot || !identityKey) return [];
      next.sources[source] = {
        ...next.sources[source],
        identityKey,
        unreadCount: snapshot.total,
        lastSuccessAt: snapshot.checkedAt
      };
      return [recordNotificationSnapshot(source, identityKey, snapshot.total, snapshot.checkedAt)];
    });
    commitState(next);
    void Promise.allSettled(writes).then(() => runForegroundDelivery(refreshedSources));
  }, [activeSources, commitState, identityKeys, runForegroundDelivery, snapshotQuery.data]);

  const unreadTotal = notificationSources.reduce(
    (total, source) => total + (state.sources[source].unreadCount || 0),
    0
  );

  useEffect(() => {
    if (!appActive || !ready) return;
    let current = true;
    void notificationPermissionGranted().then((granted) => {
      if (!current) return;
      const changed = permissionRef.current !== granted;
      permissionRef.current = granted;
      if (changed) setPermission(granted ? 'granted' : 'denied');
      void syncBackground(stateRef.current, granted, activeSources);
    });
    return () => {
      current = false;
    };
  }, [activeSources, appActive, ready, syncBackground]);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const rawSource = response.notification.request.content.data?.source;
      const source = notificationSources.find((candidate) => candidate === rawSource);
      if (!source || !isNotificationSource(source)) return;
      const key = `${response.notification.request.identifier}:${response.notification.date}`;
      if (lastResponseRef.current === key) return;
      lastResponseRef.current = key;
      if (!openSource(source)) pendingOpenSourceRef.current = source;
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    },
    [openSource]
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });
    return () => subscription.remove();
  }, [handleNotificationResponse]);

  const onNavigationReady = useCallback(() => {
    const source = pendingOpenSourceRef.current;
    if (source && openSource(source)) pendingOpenSourceRef.current = undefined;
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
      await syncBackground(next, granted, activeSources);
      if (enabled) void refetchSnapshots();
      return granted;
    },
    [activeSources, commitState, refetchSnapshots, syncBackground]
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
      await syncBackground(next, permissionRef.current, activeSources);
      if (enabled) void refetchSnapshots();
    },
    [activeSources, commitState, refetchSnapshots, syncBackground]
  );

  const backgroundEnabled =
    state.globalEnabled &&
    permission === 'granted' &&
    activeSources.some((source) => state.sources[source].intentEnabled);

  return {
    activeSources,
    backgroundEnabled,
    backgroundError,
    gateway,
    identityKeys,
    identitySignature,
    partialUnavailable: Object.keys(snapshotErrors).length > 0,
    permission,
    ready,
    sessions,
    snapshotErrors,
    state,
    unreadTotal,
    xiaoyinsiNeedsUpgrade: sessions.xiaoyinsi.isLoggedIn && xiaoyinsiScopeChecked && !xiaoyinsiNotificationsScope,
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
