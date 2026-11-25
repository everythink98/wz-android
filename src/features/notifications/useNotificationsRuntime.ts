import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { isNotificationSource, notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { NotificationSessionAccess, RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { SourceErrorInfo } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { createNotificationGateway, type NotificationAccessReader } from '@/sources/notificationGateway';
import { readForegroundNotificationAccess } from '@/sources/notificationForegroundAccess';
import {
  clearNotificationSourceForContentDisable,
  confirmDisabledNotificationDismissal,
  defaultNotificationState,
  loadNotificationState,
  notificationDeliveryAllowed,
  readNotificationDeliveryScope,
  markAndroidNotificationPermissionRequestStarted,
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
  ensureMessageNotificationChannel,
  notificationPermissionGranted,
  openNotificationSystemSettings,
  presentSourceNotification,
  reconcileSourceNotificationSlots,
  requestNotificationPermission,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
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

export type NotificationOperationOutcome =
  { status: 'completed'; granted: boolean } | { status: 'permission-read-failed' } | { status: 'invalidated' };

const digestDismissals = createKeyedSerialRunner<NotificationSource>();
let activeNotificationsRuntimeOwner: symbol | null = null;

type AndroidPermissionRequest = {
  system: Promise<PromiseSettledResult<boolean>>;
  markerWrite?: Promise<boolean>;
};

let activeAndroidPermissionRequest: AndroidPermissionRequest | null = null;

function startAndroidPermissionRequest() {
  let native: Promise<boolean>;
  try {
    native = requestNotificationPermission({ prepareChannel: false });
  } catch (error) {
    native = Promise.reject(error);
  }
  const system = native.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  );
  const request: AndroidPermissionRequest = { system };
  activeAndroidPermissionRequest = request;
  return request;
}

function persistAndroidPermissionRequest(request: AndroidPermissionRequest) {
  request.markerWrite ??= Promise.resolve()
    .then(markAndroidNotificationPermissionRequestStarted)
    .then(
      () => true,
      (error: unknown) => {
        recordDiagnosticError('app', 'notification-permission', error);
        request.markerWrite = undefined;
        return false;
      }
    );
  return request.markerWrite;
}

async function settleAndroidPermissionRequest(request: AndroidPermissionRequest, marker: Promise<boolean>) {
  const [system, persisted] = await Promise.all([request.system, marker]);
  if (persisted && activeAndroidPermissionRequest === request) activeAndroidPermissionRequest = null;
  return system;
}

function confirmedIdentity(source: NotificationSource, sessions: SiteSessionViewModels) {
  const session = sessions[source];
  const userId = String(session.currentUser?.id || '').trim();
  return session.isLoggedIn && session.identityTrust === 'confirmed' && userId ? `${source}:${userId}` : undefined;
}

function identityNeedsTrustedFallback(source: NotificationSource, sessions: SiteSessionViewModels) {
  return sessions[source].identityTrust === 'unknown';
}

type NotificationIdentities = Partial<Record<NotificationSource, string>>;
type NotificationSnapshotTarget = Parameters<typeof forumQueryKeys.notificationSnapshot>[0];

function eligibleBackgroundSources(state: NotificationState, deliveryIdentities: NotificationIdentities) {
  return notificationSources.filter((source) => {
    const identity = deliveryIdentities[source];
    return identity && state.sources[source].intentEnabled && state.sources[source].identityKey === identity;
  });
}

function notificationQueryIdentity(queryKey: readonly unknown[]) {
  const scope = queryKey[4];
  return scope && typeof scope === 'object' && 'identityKey' in scope ? scope.identityKey : undefined;
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
  privateAccessAllowed: (source: NotificationSource, identityKey: string, access: NotificationSessionAccess) => boolean;
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
  const previousAppActiveRef = useRef(appActive);
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
  const readAccessRef = useRef(readAccess);
  useCommitRefValue(readAccessRef, readAccess);
  const gateway = useMemo(
    () =>
      createNotificationGateway({
        onSessionExpired,
        privateAccessAllowed: (source, identityKey) =>
          privateAccessAllowedRef.current(source, identityKey, 'foreground-read'),
        privateWriteAllowed: (source, identityKey) =>
          privateAccessAllowedRef.current(source, identityKey, 'settled-session'),
        readAccess: (source) => readAccessRef.current(source),
        requestAccountRecheck,
        requestSessionEpoch: (source) => sessionEpochsRef.current[source],
        sourceAllowed: sourceIsOperational
      }),
    [onSessionExpired, requestAccountRecheck, sourceIsOperational]
  );
  const stateRef = useRef<NotificationState>(defaultNotificationState());
  const identityWritesRef = useRef(new Map<NotificationSource, Promise<NotificationState>>());
  const [bootstrap] = useState(createNotificationBootstrap);
  const [bootstrapView, setBootstrapView] = useState(bootstrap.snapshot);
  const { ready, storageError, permissionError, permission } = bootstrapView;
  const publishBootstrap = useCallback(() => setBootstrapView(bootstrap.snapshot), [bootstrap]);
  const backgroundErrorRef = useRef('');
  const joinedAndroidPermissionRequest = useRef<AndroidPermissionRequest | null>(null);
  const mountedRef = useRef(true);
  const [runtimeOwner] = useState(() => Symbol('notifications-runtime'));
  const ownsRuntime = useCallback(
    () => mountedRef.current && activeNotificationsRuntimeOwner === runtimeOwner,
    [runtimeOwner]
  );
  const [foregroundDeliveries] = useState(createNotificationForegroundDeliveries);
  const snapshotResultRevisionRef = useRef(0);
  const [openIntent] = useState(createNotificationOpenIntent);
  const [state, setState] = useState(stateRef.current);
  const [centerVisible, setCenterVisibleState] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
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

  const dismissDisabledDigest = useCallback(
    (source: NotificationSource, sweep: boolean) =>
      digestDismissals.run(source, async () => {
        const current = await loadNotificationState();
        const { intentEnabled, identityKey, notificationIdentifier: identifier } = current.sources[source];
        if (current.globalEnabled && intentEnabled) return;
        if (sweep) await dismissSourceNotification(source, identifier, identityKey);
        else if (identifier) await dismissSourceNotificationExact(identifier);
        if (!identifier) return;
        const before = stateRef.current;
        const settled = await confirmDisabledNotificationDismissal(source, identityKey, identifier);
        const latest = stateRef.current;
        const previous = latest.sources[source];
        const persisted = settled.sources[source];
        if (
          mountedRef.current &&
          latest.globalEnabled === before.globalEnabled &&
          previous === before.sources[source] &&
          previous.identityKey === persisted.identityKey &&
          previous.intentEnabled === persisted.intentEnabled &&
          previous.notificationIdentifier === identifier &&
          persisted.notificationIdentifier !== identifier
        )
          commitState({ ...latest, sources: { ...latest.sources, [source]: persisted } });
      }),
    [commitState]
  );

  const retryDisabledDigests = useCallback(() => {
    const state = stateRef.current;
    for (const source of notificationSources) {
      const value = state.sources[source];
      if (value.notificationIdentifier && (!state.globalEnabled || !value.intentEnabled)) {
        void dismissDisabledDigest(source, false).catch((error) =>
          recordDiagnosticError('source', 'notification-cleanup', error, { source })
        );
      }
    }
  }, [dismissDisabledDigest]);

  const setCenterVisible = useCallback((visible: boolean) => {
    setCenterVisibleState(visible);
  }, []);

  const deliveryIdentitiesRef = useRef<NotificationIdentities>({});
  const syncBackground = useCallback(async () => {
    if (!ownsRuntime()) return;
    const next = stateRef.current;
    try {
      await syncNotificationBackgroundRegistration(
        next,
        bootstrap.granted,
        eligibleBackgroundSources(next, deliveryIdentitiesRef.current)
      );
      if (ownsRuntime() && backgroundErrorRef.current) {
        const trace = beginDiagnosticTrace('app', 'notification-runtime');
        finishDiagnosticTrace(trace, 'success', { state: 'recovered' });
        backgroundErrorRef.current = '';
        setBackgroundError('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '后台任务设置失败';
      if (ownsRuntime() && backgroundErrorRef.current !== message) {
        backgroundErrorRef.current = message;
        setBackgroundError(message);
      }
    }
  }, [bootstrap, ownsRuntime]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    activeNotificationsRuntimeOwner = runtimeOwner;
    return () => {
      mountedRef.current = false;
      if (activeNotificationsRuntimeOwner === runtimeOwner) activeNotificationsRuntimeOwner = null;
    };
  }, [runtimeOwner]);

  useEffect(() => {
    return () => {
      foregroundDeliveries.invalidate();
      const pending = openIntent.cancel();
      if (pending) {
        finishDiagnosticTrace(pending.trace, 'canceled', { reason: 'canceled' });
      }
    };
  }, [openIntent, foregroundDeliveries]);

  const probePermission = useCallback(
    async (visitIsCurrent?: () => boolean) => {
      try {
        const granted = await notificationPermissionGranted();
        if (!ownsRuntime() || visitIsCurrent?.() === false) return;
        bootstrap.observedPermission(granted);
        publishBootstrap();
      } catch (error) {
        if (!ownsRuntime() || visitIsCurrent?.() === false) return;
        bootstrap.failedPermission();
        publishBootstrap();
        recordDiagnosticError('app', 'notification-permission', error);
      }
    },
    [bootstrap, ownsRuntime, publishBootstrap]
  );

  const publishPermissionRequestStarted = useCallback(() => {
    if (ownsRuntime() && !stateRef.current.androidPermissionRequestStarted) {
      commitState({ ...stateRef.current, androidPermissionRequestStarted: true });
    }
  }, [commitState, ownsRuntime]);

  const retryInitialization = useCallback(() => {
    if (bootstrap.pending) return bootstrap.pending;
    if (!ownsRuntime()) return Promise.resolve();
    const restore = async () => {
      if (bootstrap.restored) return;
      const trace = beginDiagnosticTrace('app', 'notification-runtime', { state: 'state-load' });
      try {
        const stored = await loadNotificationState();
        if (!ownsRuntime()) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        bootstrap.restoredStorage();
        commitState(stored);
        publishBootstrap();
        finishDiagnosticTrace(trace, 'success', { isEnabled: stored.globalEnabled });
      } catch (error) {
        if (ownsRuntime()) {
          bootstrap.failedStorage();
          publishBootstrap();
        }
        finishDiagnosticTrace(trace, 'failure', { state: 'state-load', reason: normalizeDiagnosticReason(error) });
      }
    };
    return bootstrap.run(async () => {
      await Promise.all([restore(), probePermission()]);
    });
  }, [commitState, bootstrap, ownsRuntime, probePermission, publishBootstrap]);
  useEffect(() => {
    void retryInitialization();
  }, [retryInitialization]);

  useEffect(() => {
    const inherited = activeAndroidPermissionRequest;
    if (!inherited) return;
    let observing = true;
    const current = () => observing && ownsRuntime() && joinedAndroidPermissionRequest.current !== inherited;
    const initialized = bootstrap.pending;
    void (async () => {
      const marker = persistAndroidPermissionRequest(inherited);
      await settleAndroidPermissionRequest(inherited, marker);
      await initialized?.catch(() => undefined);
      if (!current() || !bootstrap.restored) return;
      if (await marker) publishPermissionRequestStarted();
      await probePermission(current);
    })();
    return () => {
      observing = false;
    };
  }, [bootstrap, ownsRuntime, probePermission, publishPermissionRequestStarted]);

  useEffect(() => {
    if (ready) retryDisabledDigests();
  }, [ready, retryDisabledDigests]);

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
  const observedSources: NotificationSource[] = [];
  const deliveryIdentities: NotificationIdentities = {};
  for (const source of operationalSources) {
    const identity = identityKeys[source];
    if (!identity || sessions[source].identityTrust !== 'confirmed') continue;
    const allowed = privateAccessAllowed(source, identity, 'foreground-read');
    const blocked = getReadBlock(source);
    // A paused Query must stay observed for the existing verification recovery.
    if (allowed || blocked) observedSources.push(source);
    if (allowed && !blocked && privateAccessAllowed(source, identity, 'settled-session'))
      deliveryIdentities[source] = identity;
  }
  const activeSourceSignature = observedSources.join('|');
  useCommitRefValue(deliveryIdentitiesRef, deliveryIdentities);
  const activeNetworkSources = useMemo(
    () => (activeSourceSignature ? (activeSourceSignature.split('|') as NotificationSource[]) : []),
    [activeSourceSignature]
  );
  const activeSources = useMemo(
    () => enabledSources.filter((source) => activeNetworkSources.includes(source)),
    [activeNetworkSources, enabledSources]
  );
  const eligibleSourcesKey = eligibleBackgroundSources(state, deliveryIdentities).join('|');
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
    void (async () => {
      const ownsPreviousAggregate = (query: { queryKey: readonly unknown[] }) =>
        Boolean(
          membershipChanged &&
          previousScope &&
          query.queryKey[0] === 'forum' &&
          query.queryKey[1] === 'all' &&
          query.queryKey[2] === 'notifications' &&
          notificationQueryIdentity(query.queryKey) === previousScope.identitySignature
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
              await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
              await clearNotificationSourceForContentDisable(source);
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
            });
          }
          return operation;
        })
      );
      const next = await loadNotificationState();
      if (!mountedRef.current) return;
      commitState(next);
      await syncBackground();
    })().catch((error) => recordDiagnosticError('app', 'notification-cleanup', error));
  }, [
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
    const writes = identityWritesRef.current;
    const reconcile = async (source: NotificationSource) => {
      const pending = writes.get(source);
      let previous = stateRef.current.sources[source];
      if (pending) {
        // A superseded native write can finish even though its render never published it.
        await pending.catch(() => undefined);
        if (!current) return;
        previous = (await loadNotificationState()).sources[source];
        if (!current) return;
      }
      const nextIdentity = identityKeys[source];
      let next = previous;
      if (previous.identityKey !== nextIdentity) {
        await dismissSourceNotification(source, previous.notificationIdentifier, previous.identityKey);
        if (!current) return;
        const write = resetNotificationSourceIdentity(source, nextIdentity);
        writes.set(source, write);
        next = (await write).sources[source];
        if (!current) return;
      } else if (!pending) {
        return;
      }

      const state = stateRef.current;
      commitState({ ...state, sources: { ...state.sources, [source]: next } });
      writes.delete(source);
      appQueryClient.removeQueries({
        queryKey: forumQueryKeys.notifications(source),
        predicate: ({ queryKey }) =>
          queryKey[3] !== 'snapshot' && (!nextIdentity || notificationQueryIdentity(queryKey) !== nextIdentity)
      });
      appQueryClient.removeQueries({
        queryKey: forumQueryKeys.notifications('all'),
        predicate: ({ queryKey }) => notificationQueryIdentity(queryKey) !== identitySignature
      });
      await syncBackground();
    };

    for (const source of enabledNetworkSources) {
      void reconcile(source).catch((error) =>
        recordDiagnosticError('source', 'notification-identity', error, { source })
      );
    }
    return () => {
      current = false;
    };
  }, [appActive, commitState, enabledNetworkSources, identityKeys, identitySignature, runtimeReady, syncBackground]);

  useEffect(() => {
    if (runtimeReady) void syncBackground();
  }, [eligibleSourcesKey, permission, runtimeReady, syncBackground]);
  const remoteQueryEnabled = runtimeReady && remoteReady && appActive;
  const snapshotSourcesKey = activeNetworkSources
    .filter((source) => state.sources[source].identityKey === identityKeys[source])
    .join('|');
  const snapshotSources = useMemo(
    () => (snapshotSourcesKey ? (snapshotSourcesKey.split('|') as NotificationSource[]) : []),
    [snapshotSourcesKey]
  );
  const snapshotQueries = useQueries({
    queries: snapshotSources.map((source) => {
      const identityKey = identityKeys[source]!;
      const epoch = sessionEpochs[source];
      return {
        queryKey: forumQueryKeys.notificationSnapshot({ source, identityKey, sessionEpoch: epoch }),
        enabled: remoteQueryEnabled,
        staleTime: 0,
        refetchOnMount: getReadBlock(source) ? false : ('always' as const),
        refetchInterval: getReadBlock(source) ? false : centerVisible ? 60_000 : 300_000,
        refetchIntervalInBackground: false,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const blocked = getReadBlock(source);
          if (blocked) throw blocked;
          try {
            return {
              revision: ++snapshotResultRevisionRef.current,
              identityKey,
              epoch,
              snapshot: await gateway.readUnreadSnapshot(source, {
                expectedIdentityKey: identityKey,
                expectedSessionEpoch: epoch,
                signal
              })
            };
          } catch (error) {
            reportReadError(source, sourceErrorFromUnknown(source, error), epoch);
            throw error;
          }
        }
      };
    })
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
  const refetchSnapshots = useCallback(
    async (target?: NotificationSnapshotTarget) => {
      if (!mountedRef.current || !remoteQueryEnabledRef.current) return [];
      const reads = snapshotSourcesRef.current.flatMap((source, index) => {
        const identityKey = identityKeysRef.current[source];
        const epoch = sessionEpochsRef.current[source];
        const query = snapshotQueriesRef.current[index];
        if (target && (source !== target.source || identityKey !== target.identityKey || epoch !== target.sessionEpoch))
          return [];
        return identityKey && query
          ? [
              {
                source,
                identityKey,
                epoch,
                lifecycle: sourceLifecyclesRef.current[source],
                query
              }
            ]
          : [];
      });
      // Initial loads otherwise share the pre-write promise, even with cancelRefetch.
      await Promise.all(
        reads.map(({ source, identityKey, epoch }) =>
          appQueryClient.cancelQueries({
            queryKey: forumQueryKeys.notificationSnapshot({ source, identityKey, sessionEpoch: epoch }),
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
    },
    [sourceIsOperational]
  );

  const runForegroundDelivery = useCallback(
    (jobs: readonly ForegroundDelivery[]): void => {
      const currentJob = (job: ForegroundDelivery) =>
        mountedRef.current &&
        remoteQueryEnabledRef.current &&
        foregroundDeliveries.generation === job.generation &&
        bootstrap.granted &&
        notificationDeliveryAllowed(stateRef.current, job.source, job) &&
        identityKeysRef.current[job.source] === job.identityKey &&
        sessionEpochsRef.current[job.source] === job.epoch &&
        sourceLifecyclesRef.current[job.source] === job.lifecycle &&
        !getReadBlock(job.source) &&
        sourceIsOperational(job.source) &&
        privateAccessAllowedRef.current(job.source, job.identityKey, 'settled-session');
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
            sourceAllowed: async (source) =>
              !contentSourcesReadyRef.current || enabledSourcesRef.current.includes(source),
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
  const snapshotCommitKey = snapshotQueries
    .map((query, index) => {
      const source = snapshotSources[index]!;
      return `${source}:${query.data?.revision || 0}:${deliveryIdentities[source] || ''}`;
    })
    .join('|');
  useEffect(() => {
    const deliveries: ForegroundDelivery[] = [];
    const writes = snapshotSources.flatMap((source, index) => {
      const result = snapshotQueriesRef.current[index]?.data;
      if (!result) return [];
      const { epoch, identityKey, revision, snapshot } = result;
      const canCommit = () =>
        mountedRef.current &&
        sourceIsOperational(source) &&
        identityKeysRef.current[source] === identityKey &&
        sessionEpochsRef.current[source] === epoch &&
        privateAccessAllowedRef.current(source, identityKey, 'settled-session');
      if (!canCommit()) return [];
      const handledKey = `${source}\u0000${identityKey}`;
      if (handledSnapshotUpdateRef.current.get(handledKey) === revision) return [];
      handledSnapshotUpdateRef.current.set(handledKey, revision);
      const scope = readNotificationDeliveryScope(stateRef.current, source);
      if (scope?.identityKey === identityKey) {
        deliveries.push({
          ...scope,
          source,
          epoch,
          generation: foregroundDeliveries.generation,
          lifecycle: sourceLifecyclesRef.current[source]
        });
      }
      return [
        recordNotificationSnapshot(source, identityKey, snapshot.total, snapshot.checkedAt, canCommit)
          .then((saved) => {
            const current = stateRef.current;
            const previous = current.sources[source];
            const persisted = saved.sources[source];
            if (
              canCommit() &&
              previous.identityKey === identityKey &&
              persisted.identityKey === identityKey &&
              persisted.unreadCount === snapshot.total &&
              previous.unreadCount !== snapshot.total
            ) {
              commitState({
                ...current,
                sources: { ...current.sources, [source]: { ...previous, unreadCount: snapshot.total } }
              });
            }
          })
          .catch((error) => {
            recordDiagnosticError('source', 'notification-snapshot', error, { source });
            throw error;
          })
      ];
    });
    if (writes.length) void Promise.allSettled(writes).then(() => runForegroundDelivery(deliveries));
  }, [
    commitState,
    runForegroundDelivery,
    snapshotCommitKey,
    snapshotSources,
    foregroundDeliveries,
    sourceIsOperational
  ]);

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
    const wasActive = previousAppActiveRef.current;
    previousAppActiveRef.current = appActive;
    if (!appActive || wasActive) return;
    retryDisabledDigests();
    let current = true;
    void (async () => {
      await bootstrap.pending?.catch(() => undefined);
      if (!current || !ownsRuntime() || !runtimeReadyRef.current) return;
      await bootstrap.run(() => probePermission(() => current && ownsRuntime()));
      if (current && ownsRuntime()) await syncBackground();
    })();
    return () => {
      current = false;
    };
  }, [appActive, syncBackground, bootstrap, ownsRuntime, probePermission, retryDisabledDigests]);

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

  const readPermissionState = useCallback(() => bootstrap.snapshot.permission, [bootstrap]);

  const runAndroidPermissionRequest = useCallback(async (): Promise<'completed' | 'failed' | 'invalidated'> => {
    while (bootstrap.pending) {
      await bootstrap.pending.catch(() => undefined);
      if (!ownsRuntime() || !stateRef.current.globalEnabled) return 'invalidated';
    }
    if (!ownsRuntime() || !stateRef.current.globalEnabled) return 'invalidated';
    if (!activeAndroidPermissionRequest && (bootstrap.granted || stateRef.current.androidPermissionRequestStarted)) {
      return 'completed';
    }
    let result: 'completed' | 'failed' | 'invalidated' = 'completed';
    await bootstrap.run(async () => {
      let request = activeAndroidPermissionRequest;
      if (!request) {
        try {
          await ensureMessageNotificationChannel();
          if (!ownsRuntime() || !stateRef.current.globalEnabled) {
            result = 'invalidated';
            return;
          }
          request = activeAndroidPermissionRequest;
          if (!request) {
            // A replacement may have loaded its snapshot before the previous request marked storage.
            const latest = await loadNotificationState();
            if (!ownsRuntime() || !stateRef.current.globalEnabled) {
              result = 'invalidated';
              return;
            }
            request = activeAndroidPermissionRequest;
            if (!request && latest.androidPermissionRequestStarted) {
              publishPermissionRequestStarted();
              await probePermission();
              return;
            }
            if (!request && !bootstrap.granted) request = startAndroidPermissionRequest();
          }
        } catch (error) {
          if (!ownsRuntime() || !stateRef.current.globalEnabled) {
            result = 'invalidated';
            return;
          }
          bootstrap.failedPermission();
          publishBootstrap();
          recordDiagnosticError('app', 'notification-permission', error);
          result = 'failed';
          return;
        }
      }
      if (!request) return;
      if (!ownsRuntime() || !stateRef.current.globalEnabled) {
        result = 'invalidated';
        return;
      }
      joinedAndroidPermissionRequest.current = request;
      const marker = persistAndroidPermissionRequest(request);
      void marker.then((saved) => {
        if (saved) publishPermissionRequestStarted();
      });
      const system = await settleAndroidPermissionRequest(request, marker);
      if (!ownsRuntime() || !stateRef.current.globalEnabled) {
        result = 'invalidated';
        return;
      }
      if (system.status === 'fulfilled') {
        bootstrap.observedPermission(system.value);
      } else {
        bootstrap.failedPermission();
        recordDiagnosticError('app', 'notification-permission', system.reason);
        result = 'failed';
      }
      publishBootstrap();
    });
    return ownsRuntime() && stateRef.current.globalEnabled ? result : 'invalidated';
  }, [bootstrap, ownsRuntime, probePermission, publishBootstrap, publishPermissionRequestStarted]);

  const requestPermission = useCallback(async (): Promise<NotificationOperationOutcome> => {
    if (!runtimeReadyRef.current) throw new Error('通知存储尚未恢复，请先重试初始化');
    if (!ownsRuntime() || !stateRef.current.globalEnabled) return { status: 'invalidated' };
    const permissionResult = await runAndroidPermissionRequest();
    if (permissionResult === 'invalidated' || !ownsRuntime() || !stateRef.current.globalEnabled) {
      return { status: 'invalidated' };
    }
    await syncBackground();
    if (!ownsRuntime() || !stateRef.current.globalEnabled) return { status: 'invalidated' };
    void refetchSnapshots();
    return permissionResult === 'failed' || bootstrap.snapshot.permission === 'unavailable'
      ? { status: 'permission-read-failed' }
      : { status: 'completed', granted: bootstrap.granted };
  }, [bootstrap, ownsRuntime, refetchSnapshots, runAndroidPermissionRequest, syncBackground]);

  const setGlobalEnabled = useCallback(
    async (enabled: boolean): Promise<NotificationOperationOutcome> => {
      if (!runtimeReadyRef.current) throw new Error('通知存储尚未恢复，请先重试初始化');
      if (!ownsRuntime()) return { status: 'invalidated' };
      const next = await setGlobalNotificationIntent(enabled);
      if (!ownsRuntime()) return { status: 'invalidated' };
      commitState(next);
      let permissionFailed = false;
      if (enabled && !next.androidPermissionRequestStarted && !bootstrap.granted) {
        const permissionResult = await runAndroidPermissionRequest();
        if (permissionResult === 'invalidated' || !ownsRuntime() || !stateRef.current.globalEnabled) {
          return { status: 'invalidated' };
        }
        permissionFailed = permissionResult === 'failed';
      }
      if (!ownsRuntime()) return { status: 'invalidated' };
      await syncBackground();
      if (!ownsRuntime()) return { status: 'invalidated' };
      if (!enabled) {
        const settled = await Promise.allSettled(
          notificationSources.map((source) => dismissDisabledDigest(source, true))
        );
        const failed = settled.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        if (!ownsRuntime()) return { status: 'invalidated' };
        return { status: 'completed', granted: bootstrap.granted };
      }
      if (!stateRef.current.globalEnabled) return { status: 'invalidated' };
      void refetchSnapshots();
      return permissionFailed || bootstrap.snapshot.permission === 'unavailable'
        ? { status: 'permission-read-failed' }
        : { status: 'completed', granted: bootstrap.granted };
    },
    [
      commitState,
      ownsRuntime,
      refetchSnapshots,
      runAndroidPermissionRequest,
      syncBackground,
      bootstrap,
      dismissDisabledDigest
    ]
  );

  const setSourceEnabled = useCallback(
    async (source: NotificationSource, enabled: boolean) => {
      if (!runtimeReadyRef.current) throw new Error('通知存储尚未恢复，请先重试初始化');
      if (!ownsRuntime()) return;
      const next = await setSourceNotificationIntent(source, enabled);
      if (!ownsRuntime()) return;
      commitState(next);
      await syncBackground();
      if (!ownsRuntime()) return;
      if (!enabled) {
        await dismissDisabledDigest(source, true);
      }
      if (enabled && ownsRuntime()) void refetchSnapshots();
    },
    [commitState, ownsRuntime, refetchSnapshots, syncBackground, dismissDisabledDigest]
  );

  const backgroundEnabled = state.globalEnabled && permission === 'granted' && eligibleSourcesKey.length > 0;

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
    permission,
    readPermissionState,
    ready: runtimeReady,
    sessions,
    state,
    unreadTotal,
    openSystemSettings: openNotificationSystemSettings,
    onNavigationReady,
    refreshSnapshots: refetchSnapshots,
    requestPermission,
    setCenterVisible,
    setGlobalEnabled,
    setSourceEnabled
  };
}

export type NotificationsRuntimeValue = ReturnType<typeof useNotificationsRuntime>;
