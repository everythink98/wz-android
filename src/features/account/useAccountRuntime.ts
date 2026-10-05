import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CancelledError, isCancelledError } from '@tanstack/react-query';
import type { WebView } from 'react-native-webview';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import type { Fetcher } from '@/platform/network/request';
import { accountQueryKeys, appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { errorMessage } from '@/platform/network/errors';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import {
  accountSessionAccess,
  createAccountSessionSnapshot,
  sessionSources,
  type AccountSessionSnapshot,
  type ScopedSiteSessionEvent,
  type SessionSite
} from '@/domain/session/siteSessionState';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import {
  beginAuthSurface,
  closeOtherAuthSurfaces,
  createAuthSurfaceRegistry,
  finishAuthSurface,
  hasAuthSurfaceBarrierForSource,
  isAuthSurfaceVisible,
  releaseAuthSurface,
  showAuthSurface,
  type AuthSurface,
  type AuthSurfaceCloseReason
} from '@/domain/session/authSurfaceCoordinator';
import type {
  AccountReconcileResult,
  CredentialSite,
  LinuxDoReadRecovery,
  LinuxDoReadingRecovery,
  RequestAccountRecheck
} from '@/domain/session/sessionContracts';
import type { Screen } from '@/ui/navigation/types';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import type { NodeSeekAccountOverview, NodeSeekAttendanceBoard } from '@/domain/forum/accountData';
import {
  assertWritableSessionReconciled,
  ensureWritableSessionTicket,
  validateWritableSessionTicket,
  type SessionRuntimeSnapshot,
  type WritableSessionSnapshot,
  type WritableSessionTicket
} from '@/domain/session/writableSessionGate';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { useAccountStatusController } from './useAccountStatusController';
import { useAccountController } from './useAccountController';
import { useAccountCredentialController } from './useAccountCredentialController';
import type { LoginWebViewFailureReason } from './credentialDiagnostics';
import { useNodeImageAuthController } from './useNodeImageAuthController';
import { useNodeSeekCheckInController } from './useNodeSeekCheckInController';
import { useSessionController } from './useSessionController';
import { useSessionReadGateway } from './useSessionReadGateway';
import { useLinuxDoReadingRuntime } from './useLinuxDoReadingRuntime';
import { useVerificationController } from './useVerificationController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import { AccountHosts, type AccountHostsProps } from './AccountHosts';

export function useAccountRuntime({
  appActive,
  enabledSources,
  fetcher,
  loginNavigation,
  notify,
  nodeSeekRecoveryThreshold,
  openUser,
  ready,
  screen,
  webViewBlockMessage
}: {
  appActive: boolean;
  enabledSources: readonly Source[];
  fetcher: Fetcher;
  loginNavigation: AccountHostsProps['loginNavigation'];
  notify: (message: string) => void;
  nodeSeekRecoveryThreshold: number;
  openUser: (
    user: Extract<AccountCenterCommand, { type: 'open-user' }>['user'],
    initialTab?: Extract<AccountCenterCommand, { type: 'open-user' }>['initialTab']
  ) => Promise<unknown>;
  ready: boolean;
  screen: Screen;
  webViewBlockMessage: string;
}) {
  const enabledSourceMembershipKey = sourceValues.filter((source) => enabledSources.includes(source)).join(',');
  const enabledSessionSources = useMemo(() => {
    const enabledSourceSet = new Set(enabledSourceMembershipKey ? enabledSourceMembershipKey.split(',') : []);
    return sessionSources.filter((source) => enabledSourceSet.has(source));
  }, [enabledSourceMembershipKey]);
  const enabledSessionSourceSet = useMemo(() => new Set(enabledSessionSources), [enabledSessionSources]);
  const enabledSourcesRef = useRef<readonly Source[]>(enabledSources);
  useCommitRefValue(enabledSourcesRef, enabledSources);
  const getEnabledSources = useCallback(() => enabledSourcesRef.current, []);
  const webViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
  const linuxDoWebViewRef = useRef<WebView>(null);
  const nodeSeekBrowserWebViewRef = useRef<WebView>(null);
  const linuxDoBrowserWebViewRef = useRef<WebView>(null);
  const nodeSeekLoginPanelRequestRef = useRef(0);
  const yaohuoLoginPanelRequestRef = useRef(0);
  const checkingRequestIdRef = useRef(0);
  const loginPanelCheckRef = useRef<{ source: 'nodeseek' | 'yaohuo'; requestId: number } | null>(null);
  const linuxDoWebViewSessionRef = useRef(0);
  const linuxDoPanelClosingSessionRef = useRef<number | null>(null);
  const linuxDoWebViewMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linuxDoPanelCloseSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const prepareAuthSurfaceOpenRef = useRef<(surface: AuthSurface) => void>(() => undefined);
  const credentialFailureHandlerRef = useRef<
    (site: CredentialSite, attempt: number, reason: LoginWebViewFailureReason) => void
  >(() => undefined);
  const credentialClearIntentHandlerRef = useRef<(site: CredentialSite) => void>(() => undefined);
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const [linuxDoWebViewUserAgent, setLinuxDoWebViewUserAgent] = useState(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const commitNodeSeekWebViewUserAgent = useCallback((userAgent: string) => {
    nodeSeekWebViewUserAgentRef.current = userAgent;
    setNodeSeekWebViewUserAgent(userAgent);
  }, []);
  const commitLinuxDoWebViewUserAgent = useCallback((userAgent: string) => {
    linuxDoWebViewUserAgentRef.current = userAgent;
    setLinuxDoWebViewUserAgent(userAgent);
  }, []);
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [loadingLinuxDoPage, setLoadingLinuxDoPage] = useState(true);
  const [linuxDoWebViewError, setLinuxDoWebViewError] = useState('');
  const [linuxDoWebViewKey, setLinuxDoWebViewKey] = useState(0);
  const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);
  const [recoveryPanel, setRecoveryPanel] = useState<import('./useVerificationController').LinuxDoRecoveryPanel>({
    phase: 'idle',
    dedicated: false,
    results: []
  });
  const mountedLinuxDoWebViewRef = useRef(false);
  const linuxDoUnmountWaitersRef = useRef<(() => void)[]>([]);
  const linuxDoCookieHandoffRef = useRef<Promise<void> | null>(null);
  const awaitLinuxDoWebViewUnmount = useCallback(
    () =>
      mountedLinuxDoWebViewRef.current
        ? new Promise<void>((resolve) => linuxDoUnmountWaitersRef.current.push(resolve))
        : Promise.resolve(),
    []
  );
  useLayoutEffect(() => {
    mountedLinuxDoWebViewRef.current = mountLinuxDoWebView;
    if (!mountLinuxDoWebView) linuxDoUnmountWaitersRef.current.splice(0).forEach((resolve) => resolve());
  }, [mountLinuxDoWebView]);
  useEffect(
    () => () => {
      loginPanelCheckRef.current = null;
      linuxDoCookieHandoffRef.current = null;
      linuxDoUnmountWaitersRef.current.splice(0).forEach((resolve) => resolve());
    },
    []
  );
  const [checking, setChecking] = useState(false);
  const [checkingLoginPanel, setCheckingLoginPanel] = useState(false);
  const [yaohuoLoginPrompt, setYaohuoLoginPrompt] = useState('');
  const handleCredentialLoginWebViewFailure = useCallback(
    (site: CredentialSite, attempt: number, reason: LoginWebViewFailureReason) =>
      credentialFailureHandlerRef.current(site, attempt, reason),
    []
  );
  const handleClearCredentialLoginIntent = useCallback((site: CredentialSite) => {
    credentialClearIntentHandlerRef.current(site);
  }, []);
  const forumSessionEpochsRef = useRef<ForumSessionEpochs>(initialForumSessionEpochs);
  const authSurfaceRegistryRef = useRef(createAuthSurfaceRegistry());
  const [, refreshAuthSurfaces] = useState(0);
  const visibleAuthSurface = authSurfaceRegistryRef.current.visible;
  const showLoginPanel = visibleAuthSurface === 'nodeseek-login';
  const showYaohuoLoginPanel = visibleAuthSurface === 'yaohuo-login';
  const showLinuxDoPanel = visibleAuthSurface === 'linuxdo-login';
  const linuxDoPanelVisible = showLinuxDoPanel || recoveryPanel.phase !== 'idle';
  const showNodeImagePanel = visibleAuthSurface === 'nodeimage-auth';
  const authSurfaceVisible = useCallback(
    (surface: AuthSurface) => isAuthSurfaceVisible(authSurfaceRegistryRef.current, surface),
    []
  );
  const pendingNodeSeekRecoveryRef = useRef<LinuxDoReadRecovery | null>(null);
  const [hasPendingNodeSeekRecovery, setHasPendingNodeSeekRecovery] = useState(false);
  const cancelLoginPanelCheck = useCallback((source?: 'nodeseek' | 'yaohuo') => {
    if (!loginPanelCheckRef.current || (source && loginPanelCheckRef.current.source !== source)) return;
    loginPanelCheckRef.current = null;
    ++checkingRequestIdRef.current;
    setCheckingLoginPanel(false);
    setChecking(false);
  }, []);
  const beginAccountIdentityCheckRef = useRef<(source: SessionSite, surfaceGeneration?: number) => void>(
    () => undefined
  );
  const reconcileAccountStatusRef = useRef<
    (
      source: SessionSite,
      options?: { surfaceGeneration?: number; parentTraceId?: string }
    ) => Promise<AccountReconcileResult>
  >(async () => ({ status: 'stale' }));
  const applyAccountSessionEventRef = useRef<(event: ScopedSiteSessionEvent) => boolean>(() => false);
  const readSessionRuntimeSnapshot = useCallback((source: SessionSite): SessionRuntimeSnapshot => {
    const sourceEnabled = enabledSourcesRef.current.includes(source);
    const account =
      appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
      createAccountSessionSnapshot(source);
    const access = accountSessionAccess(account);
    return {
      source,
      authenticated: access.authenticated,
      authSurfaceOpen: sourceEnabled && hasAuthSurfaceBarrierForSource(authSurfaceRegistryRef.current, source),
      identityKey: access.identityKey,
      identityTrust: access.identityTrust,
      sessionEpoch: forumSessionEpochsRef.current[source],
      sourceEnabled
    };
  }, []);
  const notificationPrivateAccessAllowed = useCallback(
    (source: SessionSite, identityKey: string) => {
      const snapshot = readSessionRuntimeSnapshot(source);
      return (
        snapshot.sourceEnabled !== false &&
        snapshot.authenticated &&
        !snapshot.authSurfaceOpen &&
        snapshot.identityTrust === 'confirmed' &&
        snapshot.identityKey === identityKey
      );
    },
    [readSessionRuntimeSnapshot]
  );
  const beginAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, source: SessionSite, checkIdentity = true) => {
      const account = readSessionRuntimeSnapshot(source);
      const ticket = beginAuthSurface(authSurfaceRegistryRef.current, {
        source,
        surface,
        identityKey: account.identityKey,
        sessionEpoch: forumSessionEpochsRef.current[source]
      });
      refreshAuthSurfaces((revision) => revision + 1);
      if (checkIdentity) beginAccountIdentityCheckRef.current(source, ticket.generation);
      return ticket;
    },
    [readSessionRuntimeSnapshot]
  );
  const handoffLinuxDoCookies = useCallback(
    (parentTraceId?: string): Promise<void> => {
      if (linuxDoCookieHandoffRef.current) return linuxDoCookieHandoffRef.current;
      const generation = authSurfaceRegistryRef.current.generation;
      const handoff = awaitLinuxDoWebViewUnmount().then(() => {
        // A refreshed/replaced WebView owns a new handoff; the old one must not unlock it.
        if (linuxDoCookieHandoffRef.current !== handoff) throw new CancelledError();
        return setLinuxDoCookieResponseBarrier(
          !enabledSourcesRef.current.includes('linuxdo'),
          'surface-close',
          generation,
          undefined,
          parentTraceId
        );
      });
      linuxDoCookieHandoffRef.current = handoff;
      void handoff.catch(() => {
        if (linuxDoCookieHandoffRef.current === handoff) linuxDoCookieHandoffRef.current = null;
      });
      return handoff;
    },
    [awaitLinuxDoWebViewUnmount]
  );
  const verificationAppActiveRef = useRef(appActive);
  useCommitRefValue(verificationAppActiveRef, appActive);
  const readingVerificationRef = useRef<(recovery: LinuxDoReadingRecovery) => void>(() => undefined);
  const finishAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, reason: AuthSurfaceCloseReason, parentTraceId?: string) => {
      const wasVisible = isAuthSurfaceVisible(authSurfaceRegistryRef.current, surface);
      const ticket = finishAuthSurface(authSurfaceRegistryRef.current, surface, reason, true);
      if (!ticket && !wasVisible) return null;
      refreshAuthSurfaces((revision) => revision + 1);
      if (!ticket?.shouldReconcile) {
        const handoff = surface === 'linuxdo-login' ? handoffLinuxDoCookies(parentTraceId) : Promise.resolve();
        void handoff.catch((error) => {
          if (!isCancelledError(error)) notify('登录会话交接未完成，请刷新账号页面重试。');
        });
        return null;
      }
      const reconciliation = Promise.resolve()
        .then(() =>
          authSurfaceRegistryRef.current.active[surface]?.generation === ticket.generation
            ? reconcileAccountStatusRef.current(ticket.source, { surfaceGeneration: ticket.generation })
            : ({ status: 'stale' } as const)
        )
        .catch((error): AccountReconcileResult =>
          isCancelledError(error)
            ? { status: 'stale' }
            : {
                status: 'unknown',
                error: errorMessage(error),
                errorInfo: sourceErrorFromUnknown(ticket.source, error)
              }
        );
      void reconciliation.then((result) => {
        if (result.status === 'changed') {
          const username =
            result.session?.currentUser?.displayName || result.session?.currentUser?.username || '新账号';
          notify(`已切换为 ${username}，正在刷新该站数据`);
        } else if (result.status === 'anonymous') {
          notify('已退出登录，已切换为匿名模式');
        } else if (result.status === 'unknown') {
          notify('登录状态暂时无法确认；写入已暂停，可稍后重试账号核对');
        }
      });
      return reconciliation;
    },
    [handoffLinuxDoCookies, notify]
  );
  const handleSiteSessionEvent = useCallback((event: ScopedSiteSessionEvent) => {
    applyAccountSessionEventRef.current(event);
  }, []);
  const handleSessionExpired = useCallback(
    (source: SessionSite, requestSessionEpoch: number) => {
      const current = readSessionRuntimeSnapshot(source);
      if (
        !current.authenticated ||
        current.authSurfaceOpen ||
        current.identityTrust !== 'confirmed' ||
        current.sessionEpoch !== requestSessionEpoch ||
        current.sourceEnabled === false
      ) {
        return;
      }
      applyAccountSessionEventRef.current({ site: source, type: 'login-expired', message: '登录状态已失效' });
    },
    [readSessionRuntimeSnapshot]
  );

  const requestAccountRecheck = useCallback<RequestAccountRecheck>(
    (source, requestSessionEpoch, parentTraceId) => {
      const current = readSessionRuntimeSnapshot(source);
      if (
        source !== 'linuxdo' ||
        !current.authenticated ||
        current.authSurfaceOpen ||
        current.identityTrust !== 'confirmed' ||
        current.sessionEpoch !== requestSessionEpoch ||
        current.sourceEnabled === false
      )
        return;
      void reconcileAccountStatusRef.current(source, { parentTraceId }).catch(() => {
        notify('linux.do 登录状态暂时无法确认，请稍后重试账号核对');
      });
    },
    [notify, readSessionRuntimeSnapshot]
  );

  const session = useSessionController({
    commitLinuxDoWebViewUserAgent,
    commitNodeSeekWebViewUserAgent,
    defaultFetcher: fetcher,
    forumSessionEpochsRef,
    linuxDoBrowserWebViewRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekRecoveryThreshold,
    notify,
    onSiteSessionEvent: handleSiteSessionEvent
  });
  const { handleLinuxDoBrowserFetchMessage, handleNodeSeekBrowserFetchMessage } = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch: session.completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch: session.completeNodeSeekBrowserFetch
  });
  const getLinuxDoUserAgent = useCallback(() => linuxDoWebViewUserAgentRef.current, []);
  const linuxDoReadingSnapshot = useCallback(() => readSessionRuntimeSnapshot('linuxdo'), [readSessionRuntimeSnapshot]);
  const linuxDoReadingExpired = useCallback(
    (epoch: number) => handleSessionExpired('linuxdo', epoch),
    [handleSessionExpired]
  );
  const reading = useLinuxDoReadingRuntime({
    appActive,
    verificationVisible: linuxDoPanelVisible,
    fetcher: session.forumFetchWithWebViewFallback,
    snapshot: linuxDoReadingSnapshot,
    userAgent: getLinuxDoUserAgent,
    onSessionExpired: linuxDoReadingExpired,
    requestAccountRecheck,
    requestVerification: (recovery) => readingVerificationRef.current(recovery)
  });
  const readGateway = useSessionReadGateway({
    reading,
    anonymousFetcher: fetcher,
    fetcher: session.forumFetchWithWebViewFallback,
    getEnabledSources,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    onSessionExpired: handleSessionExpired,
    requestAccountRecheck,
    readSessionRuntimeSnapshot
  });
  const commitAccountStatusChange = session.commitAccountStatusChange;
  const cancelLinuxDoBrowserHandoff = session.cancelLinuxDoBrowserHandoff;
  const handleAccountStatusChanged = useCallback(
    (source: SessionSite) => {
      commitAccountStatusChange(source);
      if (source === 'linuxdo') {
        cancelLinuxDoBrowserHandoff();
        const nativeOwnsCookies = linuxDoCookieHandoffRef.current !== null;
        linuxDoCookieHandoffRef.current = null;
        void setLinuxDoCookieResponseBarrier(
          !enabledSourcesRef.current.includes('linuxdo') ||
            (isAuthSurfaceVisible(authSurfaceRegistryRef.current, 'linuxdo-login') && !nativeOwnsCookies),
          'identity-change'
        ).catch(() => notify('登录会话交接未完成，请刷新账号页面重试。'));
      }
    },
    [notify, commitAccountStatusChange, cancelLinuxDoBrowserHandoff]
  );
  const status = useAccountStatusController({
    enabledSources: enabledSessionSources,
    enabledSourcesReady: ready,
    fetcher: session.forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onAccountStatusChanged: handleAccountStatusChanged
  });
  const reconcileAccountStatusBase = status.reconcileAccountStatus;
  const reconcileAccountStatus = useCallback(
    async (...args: Parameters<typeof reconcileAccountStatusBase>): Promise<AccountReconcileResult> => {
      const source = args[0];
      const tickets = Object.values(authSurfaceRegistryRef.current.active).filter(
        (ticket) => ticket?.source === source && ticket.phase === 'reconciling'
      );
      const needsHandoff = source === 'linuxdo' && tickets.length > 0;
      const isCurrent = () =>
        enabledSourcesRef.current.includes(source) &&
        tickets.every((ticket) => {
          const current = authSurfaceRegistryRef.current.active[ticket.surface];
          return !current || current.generation === ticket.generation;
        });
      let result: AccountReconcileResult;
      try {
        if (!isCurrent()) return { status: 'stale' };
        result = await reconcileAccountStatusBase(source, {
          ...args[1],
          ...(needsHandoff
            ? {
                beforeProbe: async () => {
                  await handoffLinuxDoCookies();
                  if (!isCurrent()) throw new CancelledError();
                }
              }
            : {})
        });
        if (needsHandoff && (result.status === 'same' || result.status === 'changed' || result.status === 'anonymous'))
          await handoffLinuxDoCookies();
        if (!isCurrent()) return { status: 'stale' };
      } catch (error) {
        return isCancelledError(error) || !isCurrent()
          ? { status: 'stale' }
          : { status: 'unknown', error: errorMessage(error), errorInfo: sourceErrorFromUnknown(source, error) };
      }
      if (result.status === 'same' || result.status === 'changed' || result.status === 'anonymous') {
        let released = false;
        for (const ticket of tickets) {
          released = releaseAuthSurface(authSurfaceRegistryRef.current, ticket.surface, ticket.generation) || released;
        }
        if (released) refreshAuthSurfaces((revision) => revision + 1);
      }
      return result;
    },
    [handoffLinuxDoCookies, reconcileAccountStatusBase]
  );
  const reconcileAuthSurfaceAccountStatus = useCallback(
    (source: SessionSite, options: { surfaceGeneration?: number; publishAnonymous?: boolean } = {}) =>
      reconcileAccountStatus(source, { publishAnonymous: false, ...options }),
    [reconcileAccountStatus]
  );
  useCommitRefValue(beginAccountIdentityCheckRef, status.beginAccountIdentityCheck);
  useCommitRefValue(reconcileAccountStatusRef, reconcileAccountStatus);
  useCommitRefValue(applyAccountSessionEventRef, status.applyAccountSessionEvent);

  const resetLinuxDoLevelState = useCallback(() => {
    void appQueryClient.cancelQueries({ queryKey: forumQueryKeys.level('linuxdo') });
    appQueryClient.removeQueries({ queryKey: forumQueryKeys.level('linuxdo') });
  }, []);
  const beginNodeImageSurface = useCallback(
    () => beginAuthSurfaceTicket('nodeimage-auth', 'nodeseek', false),
    [beginAuthSurfaceTicket]
  );
  const finishNodeImageSurface = useCallback(
    (reason: AuthSurfaceCloseReason) => finishAuthSurfaceTicket('nodeimage-auth', reason),
    [finishAuthSurfaceTicket]
  );
  const prepareNodeImageSurface = useCallback(() => prepareAuthSurfaceOpenRef.current('nodeimage-auth'), []);
  const readNodeImageRuntime = useCallback(() => readSessionRuntimeSnapshot('nodeseek'), [readSessionRuntimeSnapshot]);
  const reconcileNodeImageAccount = useCallback(
    (surfaceGeneration: number) => reconcileAuthSurfaceAccountStatus('nodeseek', { surfaceGeneration }),
    [reconcileAuthSurfaceAccountStatus]
  );
  const nodeImage = useNodeImageAuthController({
    beginSurface: beginNodeImageSurface,
    finishSurface: finishNodeImageSurface,
    notify,
    prepareSurfaceOpen: prepareNodeImageSurface,
    readRuntime: readNodeImageRuntime,
    reconcileAccountStatus: reconcileNodeImageAccount,
    surfaceVisible: showNodeImagePanel
  });
  const closeYaohuoLoginPanel = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button') => {
      if (!authSurfaceVisible('yaohuo-login')) return;
      cancelLoginPanelCheck('yaohuo');
      handleClearCredentialLoginIntent('yaohuo');
      yaohuoLoginPanelRequestRef.current += 1;
      yaohuoWebViewRef.current?.stopLoading();
      setYaohuoLoginPrompt('');
      setLoadingYaohuoLoginPage(false);
      finishAuthSurfaceTicket('yaohuo-login', reason);
    },
    [authSurfaceVisible, cancelLoginPanelCheck, finishAuthSurfaceTicket, handleClearCredentialLoginIntent]
  );
  const changeYaohuoLoginPanel = useCallback(
    (visible: boolean, closeReason: AuthSurfaceCloseReason = 'close-button') => {
      if (visible) {
        if (!enabledSessionSourceSet.has('yaohuo')) return;
        if (authSurfaceVisible('yaohuo-login')) return;
        prepareAuthSurfaceOpenRef.current('yaohuo-login');
        beginAuthSurfaceTicket('yaohuo-login', 'yaohuo');
        yaohuoLoginPanelRequestRef.current += 1;
        setLoadingYaohuoLoginPage(true);
        yaohuoWebViewRef.current?.reload();
        return;
      }
      closeYaohuoLoginPanel(closeReason);
    },
    [authSurfaceVisible, beginAuthSurfaceTicket, closeYaohuoLoginPanel, enabledSessionSourceSet]
  );
  const changeNodeSeekLoginPanel = useCallback(
    (visible: boolean, closeReason: AuthSurfaceCloseReason = 'close-button') => {
      const wasVisible = authSurfaceVisible('nodeseek-login');
      if (visible && !enabledSessionSourceSet.has('nodeseek')) return;
      if (visible === wasVisible) return;
      if (visible) prepareAuthSurfaceOpenRef.current('nodeseek-login');
      nodeSeekLoginPanelRequestRef.current += 1;
      if (visible) {
        beginAuthSurfaceTicket('nodeseek-login', 'nodeseek');
      } else {
        cancelLoginPanelCheck('nodeseek');
        pendingNodeSeekRecoveryRef.current = null;
        setHasPendingNodeSeekRecovery(false);
        handleClearCredentialLoginIntent('nodeseek');
      }
      webViewRef.current?.stopLoading();
      setLoadingLoginPage(visible);
      if (!visible) finishAuthSurfaceTicket('nodeseek-login', closeReason);
    },
    [
      authSurfaceVisible,
      beginAuthSurfaceTicket,
      cancelLoginPanelCheck,
      enabledSessionSourceSet,
      finishAuthSurfaceTicket,
      handleClearCredentialLoginIntent
    ]
  );
  const isLinuxDoPanelVisible = useCallback(() => authSurfaceVisible('linuxdo-login'), [authSurfaceVisible]);
  const getLinuxDoSurfaceGeneration = useCallback(
    () => authSurfaceRegistryRef.current.active['linuxdo-login']?.generation,
    []
  );
  const handleLinuxDoSurfaceOpened = useCallback(
    ({ accountBarrier }: { accountBarrier: boolean }) => {
      if (accountBarrier) {
        beginAuthSurfaceTicket('linuxdo-login', 'linuxdo');
        return;
      }
      showAuthSurface(authSurfaceRegistryRef.current, 'linuxdo-login');
      refreshAuthSurfaces((revision) => revision + 1);
    },
    [beginAuthSurfaceTicket]
  );
  const prepareLinuxDoCookieResponseBarrier = useCallback(() => {
    cancelLinuxDoBrowserHandoff();
    linuxDoCookieHandoffRef.current = null;
    return setLinuxDoCookieResponseBarrier(true, 'surface-open', authSurfaceRegistryRef.current.generation);
  }, [cancelLinuxDoBrowserHandoff]);
  const verification = useVerificationController({
    fetcher,
    getLinuxDoSurfaceGeneration,
    onRecoveryStateChanged: setRecoveryPanel,
    getRecoveryScope: () => {
      const snapshot = readSessionRuntimeSnapshot('linuxdo');
      return JSON.stringify([
        snapshot.identityKey,
        snapshot.identityTrust,
        snapshot.sessionEpoch,
        snapshot.sourceEnabled
      ]);
    },
    awaitLinuxDoWebViewUnmount,
    awaitLinuxDoCookieHandoff: () => linuxDoCookieHandoffRef.current || Promise.resolve(),
    handoffLinuxDoCookies,
    canOpenLinuxDoPanel: () => verificationAppActiveRef.current && enabledSourcesRef.current.includes('linuxdo'),
    changeNodeSeekLoginPanel,
    checkingRequestIdRef,
    closeYaohuoLoginPanel,
    commitLinuxDoWebViewUserAgent,
    linuxDoPanelClosingSessionRef,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    isLinuxDoSurfaceVisible: isLinuxDoPanelVisible,
    notify,
    onBeforeLinuxDoSurfaceOpened: () => prepareAuthSurfaceOpenRef.current('linuxdo-login'),
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    onLinuxDoSurfaceClosed: ({ authoritativeResult, reason, parentTraceId }) => {
      finishAuthSurfaceTicket('linuxdo-login', authoritativeResult ? 'authoritative-recovery' : reason, parentTraceId);
      if (authoritativeResult)
        void linuxDoCookieHandoffRef.current?.then(
          () => reading.verified(),
          () => undefined
        );
    },
    onLinuxDoSurfaceOpened: handleLinuxDoSurfaceOpened,
    prepareLinuxDoCookieResponseBarrier,
    reconcileAccountStatus: (source) =>
      reconcileAuthSurfaceAccountStatus(source, {
        surfaceGeneration: authSurfaceRegistryRef.current.active['linuxdo-login']?.generation
      }),
    setChecking,
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    updateLinuxDoSession: session.updateLinuxDoSession,
    updateNodeSeekSession: session.updateNodeSeekSession
  });
  useCommitRefValue(readingVerificationRef, (recovery: LinuxDoReadingRecovery) => {
    void verification.showLinuxDoVerification('阅读记录同步需要完成 Cloudflare 验证', recovery);
  });
  const closeLinuxDoPanel = verification.closeLinuxDoPanel;
  const recoveryIdentity = readSessionRuntimeSnapshot('linuxdo');
  const recoveryScope = JSON.stringify([
    recoveryIdentity.identityKey,
    recoveryIdentity.identityTrust,
    recoveryIdentity.sessionEpoch,
    recoveryIdentity.sourceEnabled
  ]);
  const previousRecoveryScopeRef = useRef(recoveryScope);
  useEffect(() => {
    if (previousRecoveryScopeRef.current !== recoveryScope && recoveryPanel.phase !== 'idle')
      closeLinuxDoPanel(true, 'navigation-away');
    previousRecoveryScopeRef.current = recoveryScope;
  }, [closeLinuxDoPanel, recoveryScope, recoveryPanel.phase]);
  const showNodeSeekVerification = verification.showNodeSeekVerification;
  const cancelLinuxDoCheckForInactiveApp = verification.cancelLinuxDoCheckForInactiveApp;
  const linuxDoSourceEnabled = enabledSessionSourceSet.has('linuxdo');
  const linuxDoCookieBarrierInitializedRef = useRef(false);
  useEffect(() => {
    if (!linuxDoSourceEnabled) cancelLinuxDoBrowserHandoff();
    linuxDoCookieHandoffRef.current = null;
    const reason = linuxDoCookieBarrierInitializedRef.current ? 'source-change' : 'startup';
    linuxDoCookieBarrierInitializedRef.current = true;
    void setLinuxDoCookieResponseBarrier(
      !linuxDoSourceEnabled || isAuthSurfaceVisible(authSurfaceRegistryRef.current, 'linuxdo-login'),
      reason
    ).catch(() => notify('登录会话交接未完成，请刷新账号页面重试。'));
  }, [linuxDoSourceEnabled, notify, cancelLinuxDoBrowserHandoff]);
  useEffect(() => {
    if (appActive) return;
    const check = loginPanelCheckRef.current;
    if (
      check?.source === 'nodeseek' &&
      authSurfaceVisible('nodeseek-login') &&
      !authSurfaceRegistryRef.current.active['nodeseek-login']
    )
      beginAuthSurfaceTicket('nodeseek-login', 'nodeseek', false);
    cancelLoginPanelCheck();
    cancelLinuxDoCheckForInactiveApp();
  }, [appActive, authSurfaceVisible, beginAuthSurfaceTicket, cancelLoginPanelCheck, cancelLinuxDoCheckForInactiveApp]);
  const closeNodeImageAuthPanel = nodeImage.panel.close;
  const closeAuthSurface = useCallback(
    (surface: AuthSurface, reason: AuthSurfaceCloseReason) => {
      if (surface === 'linuxdo-login') closeLinuxDoPanel(true, reason);
      else if (surface === 'nodeimage-auth') closeNodeImageAuthPanel(reason);
      else if (surface === 'nodeseek-login') changeNodeSeekLoginPanel(false, reason);
      else closeYaohuoLoginPanel(reason);
    },
    [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]
  );
  const prepareAuthSurfaceOpen = useCallback(
    (openingSurface: AuthSurface) => {
      closeOtherAuthSurfaces(openingSurface, closeAuthSurface);
    },
    [closeAuthSurface]
  );
  useCommitRefValue(prepareAuthSurfaceOpenRef, prepareAuthSurfaceOpen);
  useEffect(() => {
    if (!enabledSessionSourceSet.has('nodeseek')) {
      changeNodeSeekLoginPanel(false, 'source-disabled');
      closeNodeImageAuthPanel('source-disabled');
    }
    if (!enabledSessionSourceSet.has('yaohuo')) closeYaohuoLoginPanel('source-disabled');
    if (!enabledSessionSourceSet.has('linuxdo')) closeLinuxDoPanel(true, 'source-disabled');
  }, [
    changeNodeSeekLoginPanel,
    closeLinuxDoPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    enabledSessionSourceSet
  ]);
  const previousLinuxDoPanelVisibleRef = useRef(showLinuxDoPanel);
  useEffect(() => {
    if (previousLinuxDoPanelVisibleRef.current && !showLinuxDoPanel) {
      handleClearCredentialLoginIntent('linuxdo');
    }
    previousLinuxDoPanelVisibleRef.current = showLinuxDoPanel;
  }, [handleClearCredentialLoginIntent, showLinuxDoPanel]);

  const account = useAccountController({
    checkingRequestIdRef,
    clearLinuxDoLoginState: async () => {
      cancelLinuxDoBrowserHandoff();
      linuxDoWebViewRef.current?.stopLoading();
      setMountLinuxDoWebView(false);
      await setLinuxDoCookieResponseBarrier(true, 'explicit-clear');
      return session.clearLinuxDoLoginState();
    },
    clearNodeSeekLoginState: session.clearNodeSeekLoginState,
    clearYaohuoLoginState: session.clearYaohuoLoginState,
    commitNodeSeekWebViewUserAgent,
    sessionEpochs: session.forumSessionEpochs,
    nodeSeekLoginPanelRequestRef,
    notify,
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    linuxDoVerificationActive: linuxDoPanelVisible,
    linuxDoIdentityPending: readSessionRuntimeSnapshot('linuxdo').identityTrust !== 'confirmed',
    resetLinuxDoLevelState,
    resetLinuxDoWebView: verification.resetLinuxDoWebView,
    reconcileAccountStatus: reconcileAuthSurfaceAccountStatus,
    setChecking,
    screen,
    showLinuxDoVerification: verification.showLinuxDoVerification,
    readGateway,
    showLoginPanel,
    showYaohuoLoginPanel,
    webViewRef,
    yaohuoLoginPanelRequestRef,
    yaohuoWebViewRef
  });
  const credentials = useAccountCredentialController({
    changeLinuxDoPanel: verification.changeLinuxDoPanel,
    changeNodeSeekLoginPanel,
    changeYaohuoLoginPanel,
    linuxDoWebViewRef,
    notify,
    refreshAccountStatus: () => status.refreshAccountStatus({ reconcile: reconcileAccountStatus }),
    setYaohuoLoginPrompt,
    webViewRef,
    webViewBlockMessage,
    yaohuoWebViewRef
  });
  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'open-user') {
        await openUser(command.user, command.initialTab);
        return;
      }
      await credentials.handleAccountCenterCommand(command);
    },
    [credentials, openUser]
  );
  const showYaohuoLogin = useCallback(
    (message = '请先登录妖火。') => {
      setYaohuoLoginPrompt(message);
      changeYaohuoLoginPanel(true);
      notify(message);
    },
    [changeYaohuoLoginPanel, notify]
  );
  useCommitRefValue(credentialFailureHandlerRef, credentials.finishCredentialFillForLoginFailure);
  useCommitRefValue(credentialClearIntentHandlerRef, credentials.clearCredentialLoginIntent);
  const requestNodeSeekVerification = useCallback(
    (message = 'NodeSeek 需要完成 Cloudflare 验证', recovery?: LinuxDoReadRecovery) => {
      if (recovery) {
        pendingNodeSeekRecoveryRef.current = recovery;
        setHasPendingNodeSeekRecovery(true);
      }
      showNodeSeekVerification(message);
    },
    [showNodeSeekVerification]
  );
  const checkNodeSeekLoginAndRetry = useCallback(async () => {
    if (
      loginPanelCheckRef.current ||
      !verificationAppActiveRef.current ||
      !authSurfaceVisible('nodeseek-login') ||
      !enabledSourcesRef.current.includes('nodeseek')
    )
      return false;
    const check = { source: 'nodeseek' as const, requestId: nodeSeekLoginPanelRequestRef.current };
    loginPanelCheckRef.current = check;
    setCheckingLoginPanel(true);
    const recovery = pendingNodeSeekRecoveryRef.current;
    const identityBeforeCheck = readSessionRuntimeSnapshot('nodeseek').identityKey;
    const isCurrent = () =>
      loginPanelCheckRef.current === check &&
      nodeSeekLoginPanelRequestRef.current === check.requestId &&
      verificationAppActiveRef.current &&
      authSurfaceVisible('nodeseek-login') &&
      enabledSourcesRef.current.includes('nodeseek');
    try {
      const accountResult = await account.checkNodeSeekAccount(Boolean(recovery));
      if (!isCurrent() || pendingNodeSeekRecoveryRef.current !== recovery) return false;
      if (
        accountResult.status === 'changed' ||
        (recovery && readSessionRuntimeSnapshot('nodeseek').identityKey !== identityBeforeCheck)
      ) {
        changeNodeSeekLoginPanel(false, 'authoritative-recovery');
        return false;
      }
      if (accountResult.status !== 'same' && !(recovery && accountResult.status === 'anonymous')) return false;
      if (!recovery) {
        changeNodeSeekLoginPanel(false, 'authoritative-recovery');
        return true;
      }
      if (recovery.isCurrent && !recovery.isCurrent()) {
        changeNodeSeekLoginPanel(false, 'authoritative-recovery');
        return false;
      }

      // Release the account read barrier without replacing the visible verification document.
      finishAuthSurfaceTicket('nodeseek-login', 'authoritative-recovery');
      showAuthSurface(authSurfaceRegistryRef.current, 'nodeseek-login');
      refreshAuthSurfaces((revision) => revision + 1);
      const outcome = await recovery.resume();
      if (
        !isCurrent() ||
        pendingNodeSeekRecoveryRef.current !== recovery ||
        readSessionRuntimeSnapshot('nodeseek').identityKey !== identityBeforeCheck
      )
        return false;
      if (outcome === 'completed') {
        changeNodeSeekLoginPanel(false, 'authoritative-recovery');
        return true;
      }
      if (outcome === 'verification-required') {
        session.updateNodeSeekSession({
          type: 'verification-required',
          message: 'NodeSeek 验证仍未生效，请继续验证后再次检测。'
        });
        notify('NodeSeek 验证仍未生效，请继续验证后再次检测。');
      } else if (outcome === 'failed') {
        notify('NodeSeek 原页面恢复失败，请返回原页面重试。');
      }
      return false;
    } catch (error) {
      if (isCurrent()) notify('NodeSeek 原页面恢复失败：' + errorMessage(error));
      return false;
    } finally {
      if (loginPanelCheckRef.current === check) {
        if (authSurfaceVisible('nodeseek-login') && !authSurfaceRegistryRef.current.active['nodeseek-login'])
          beginAuthSurfaceTicket('nodeseek-login', 'nodeseek', false);
        loginPanelCheckRef.current = null;
        setCheckingLoginPanel(false);
      }
    }
  }, [
    account,
    authSurfaceVisible,
    beginAuthSurfaceTicket,
    changeNodeSeekLoginPanel,
    finishAuthSurfaceTicket,
    notify,
    readSessionRuntimeSnapshot,
    session
  ]);
  const checkYaohuoLoginAndClose = useCallback(async () => {
    if (
      loginPanelCheckRef.current ||
      !verificationAppActiveRef.current ||
      !authSurfaceVisible('yaohuo-login') ||
      !enabledSourcesRef.current.includes('yaohuo')
    )
      return false;
    const check = { source: 'yaohuo' as const, requestId: yaohuoLoginPanelRequestRef.current };
    loginPanelCheckRef.current = check;
    setCheckingLoginPanel(true);
    try {
      const confirmed = await account.checkYaohuoCookie();
      if (
        !confirmed ||
        loginPanelCheckRef.current !== check ||
        yaohuoLoginPanelRequestRef.current !== check.requestId ||
        !verificationAppActiveRef.current ||
        !authSurfaceVisible('yaohuo-login') ||
        !enabledSourcesRef.current.includes('yaohuo')
      )
        return false;
      closeYaohuoLoginPanel('authoritative-recovery');
      return true;
    } finally {
      if (loginPanelCheckRef.current === check) {
        loginPanelCheckRef.current = null;
        setCheckingLoginPanel(false);
      }
    }
  }, [account, authSurfaceVisible, closeYaohuoLoginPanel]);
  const closePanels = useCallback(() => {
    changeNodeSeekLoginPanel(false, 'navigation-away');
    closeNodeImageAuthPanel('navigation-away');
    closeYaohuoLoginPanel('navigation-away');
    closeLinuxDoPanel(true, 'navigation-away');
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]);
  const closeTopmostSurface = useCallback(() => {
    if (recoveryPanel.phase !== 'idle') {
      closeLinuxDoPanel(true, 'hardware-back');
      return 'linuxdo-panel-closed';
    }
    const surface = authSurfaceRegistryRef.current.visible;
    if (!surface) return null;
    closeAuthSurface(surface, 'hardware-back');
    if (surface === 'nodeseek-login') return 'login-panel-closed';
    if (surface === 'nodeimage-auth') return 'image-auth-panel-closed';
    if (surface === 'yaohuo-login') return 'yaohuo-panel-closed';
    return 'linuxdo-panel-closed';
  }, [closeAuthSurface, closeLinuxDoPanel, recoveryPanel.phase]);

  const readWritableSessionSnapshot = useCallback(
    (source: SessionSite): WritableSessionSnapshot => readSessionRuntimeSnapshot(source),
    [readSessionRuntimeSnapshot]
  );
  const reconcileWritableSession = useCallback((source: SessionSite) => reconcileAccountStatusRef.current(source), []);
  const ensureWritableSession = useCallback(
    async (source: SessionSite) => {
      const surfaces = Object.values(authSurfaceRegistryRef.current.active).filter(
        (surface) => surface?.source === source
      );
      if (surfaces.length && surfaces.every((surface) => surface.phase === 'reconciling')) {
        assertWritableSessionReconciled(await reconcileWritableSession(source));
      }
      return ensureWritableSessionTicket(
        () => readWritableSessionSnapshot(source),
        () => reconcileWritableSession(source)
      );
    },
    [readWritableSessionSnapshot, reconcileWritableSession]
  );
  const isWritableSessionTicketCurrent = useCallback(
    (ticket: WritableSessionTicket) =>
      validateWritableSessionTicket(ticket, readWritableSessionSnapshot(ticket.source)),
    [readWritableSessionSnapshot]
  );
  const getNodeSeekUserAgent = useCallback(() => nodeSeekWebViewUserAgentRef.current, []);
  const readAttendance = useCallback(
    async (ticket: WritableSessionTicket) => {
      if (!isWritableSessionTicketCurrent(ticket)) throw new CancelledError();
      const userId = ticket.identityKey.slice('nodeseek:'.length);
      const readPlanScope = `authenticated:${ticket.sessionEpoch}`;
      const board = await readGateway.getNodeSeekAttendanceBoard({ userId }, { readPlanScope });
      if (!isWritableSessionTicketCurrent(ticket)) throw new CancelledError();
      appQueryClient.setQueryData(
        forumQueryKeys.accountData({
          source: 'nodeseek',
          kind: 'attendance',
          userId,
          sessionEpoch: ticket.sessionEpoch,
          readPlanScope
        }),
        board
      );
      return board;
    },
    [isWritableSessionTicketCurrent, readGateway]
  );
  const onAttendanceConfirmed = useCallback(
    (ticket: WritableSessionTicket, current?: number) => {
      if (!isWritableSessionTicketCurrent(ticket)) return;
      const userId = ticket.identityKey.slice('nodeseek:'.length);
      const readPlanScope = `authenticated:${ticket.sessionEpoch}`;
      const overviewKey = forumQueryKeys.accountData({
        source: 'nodeseek',
        kind: 'overview',
        userId,
        sessionEpoch: ticket.sessionEpoch,
        readPlanScope
      });
      if (current !== undefined)
        appQueryClient.setQueryData<NodeSeekAccountOverview>(overviewKey, (previous) =>
          previous ? { ...previous, coin: current } : previous
        );
      void appQueryClient.invalidateQueries({ queryKey: overviewKey, exact: true });
      void appQueryClient.invalidateQueries({
        queryKey: forumQueryKeys.accountData({
          source: 'nodeseek',
          kind: 'credits',
          userId,
          sessionEpoch: ticket.sessionEpoch,
          readPlanScope
        }),
        exact: true
      });
    },
    [isWritableSessionTicketCurrent]
  );
  const nodeSeekSnapshot = readWritableSessionSnapshot('nodeseek');
  const currentSessionTicket: WritableSessionTicket | null =
    nodeSeekSnapshot.authenticated &&
    nodeSeekSnapshot.identityTrust === 'confirmed' &&
    !nodeSeekSnapshot.authSurfaceOpen &&
    nodeSeekSnapshot.sourceEnabled !== false
      ? { source: 'nodeseek', identityKey: nodeSeekSnapshot.identityKey, sessionEpoch: nodeSeekSnapshot.sessionEpoch }
      : null;
  const nodeSeekCheckIn = useNodeSeekCheckInController({
    currentSessionTicket,
    ensureWritableSession,
    fetcher,
    isWritableSessionTicketCurrent,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onConfirmed: onAttendanceConfirmed,
    readAttendance,
    onSessionExpired: handleSessionExpired
  });
  const { observeBoard: observeNodeSeekBoard } = nodeSeekCheckIn;
  const observeAttendance = useCallback(
    (board: NodeSeekAttendanceBoard) => {
      const snapshot = readWritableSessionSnapshot('nodeseek');
      if (
        !snapshot.authenticated ||
        snapshot.identityTrust !== 'confirmed' ||
        snapshot.authSurfaceOpen ||
        snapshot.sourceEnabled === false
      )
        return;
      observeNodeSeekBoard(board, {
        source: 'nodeseek',
        identityKey: snapshot.identityKey,
        sessionEpoch: snapshot.sessionEpoch
      });
    },
    [observeNodeSeekBoard, readWritableSessionSnapshot]
  );
  const hostElement = createElement(AccountHosts, {
    account,
    blockedMessage: webViewBlockMessage,
    credentials,
    loginNavigation,
    nodeImage,
    session,
    status,
    verification,
    view: {
      checking: checking || checkingLoginPanel,
      checkNodeSeekLoginAndRetry,
      checkYaohuoLoginAndClose,
      hasPendingNodeSeekRecovery,
      changeNodeSeekLoginPanel,
      changeYaohuoLoginPanel,
      handleLinuxDoBrowserFetchMessage,
      handleNodeSeekBrowserFetchMessage,
      linuxDoBrowserWebViewRef,
      linuxDoWebViewError,
      linuxDoWebViewKey,
      linuxDoWebViewRef,
      linuxDoWebViewUserAgent,
      loadingLinuxDoPage,
      loadingLoginPage,
      loadingYaohuoLoginPage,
      mountLinuxDoWebView,
      nodeSeekBrowserWebViewRef,
      nodeSeekWebViewUserAgent,
      setLoadingLoginPage,
      setLoadingYaohuoLoginPage,
      showLinuxDoPanel: linuxDoPanelVisible,
      recoveryPanel,
      showLoginPanel,
      showYaohuoLoginPanel,
      webViewRef,
      yaohuoLoginPrompt,
      yaohuoWebViewRef
    }
  });

  return {
    read: {
      accountSessionViewModels: status.accountSessionViewModels,
      forumSessionEpochs: session.forumSessionEpochs,
      getLinuxDoUserAgent,
      getNodeSeekUserAgent,
      notificationPrivateAccessAllowed,
      readGateway,
      reconcileAccountStatus,
      sessionsReady: status.hydrated,
      statusBusy: status.statusBusy
    },
    write: {
      ensureNodeImageApiKey: nodeImage.key.ensure,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      onSessionExpired: handleSessionExpired,
      requestAccountRecheck
    },
    center: {
      account: {
        linuxDoLevelBusy: account.linuxDoLevelBusy,
        linuxDoLevelError: account.linuxDoLevelError,
        linuxDoLevelProfile: account.linuxDoLevelProfile,
        refreshLinuxDoLevel: account.refreshLinuxDoLevel
      },
      nodeSeek: {
        busy: nodeSeekCheckIn.busy,
        state: nodeSeekCheckIn.state,
        checkIn: nodeSeekCheckIn.checkIn,
        observeBoard: observeAttendance
      },
      credentials: {
        credentialSummaries: credentials.credentialSummaries,
        pendingCredentialFillSite: credentials.pendingCredentialFillSite
      },
      handleAccountCenterCommand,
      nodeImage: {
        key: {
          authorize: nodeImage.key.authorize,
          busy: nodeImage.key.busy,
          clear: nodeImage.key.clear,
          save: nodeImage.key.save,
          saved: nodeImage.key.saved
        }
      }
    },
    hosts: {
      closePanels,
      closeTopmostSurface,
      element: hostElement,
      linuxDoVerificationVisible: linuxDoPanelVisible,
      showYaohuoLogin,
      requestNodeSeekVerification,
      showLinuxDoVerification: verification.showLinuxDoVerification,
      surfaces: {
        linuxdo: linuxDoPanelVisible,
        nodeseek: showLoginPanel,
        yaohuo: showYaohuoLoginPanel
      }
    }
  };
}
