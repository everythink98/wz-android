import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import type { Fetcher } from '@/platform/network/request';
import { accountQueryKeys, appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { errorMessage } from '@/platform/network/errors';
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
  hasOpenAuthSurfaceForSource,
  releaseAuthSurface,
  type AuthSurface,
  type AuthSurfaceCloseReason
} from '@/domain/session/authSurfaceCoordinator';
import type {
  AccountReconcileResult,
  CredentialSite,
  LinuxDoReadRecovery,
  LinuxDoReadResumeOutcome
} from '@/domain/session/sessionContracts';
import type { Screen } from '@/ui/navigation/types';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import {
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
import { useVerificationController } from './useVerificationController';
import { useXiaoyinsiAuthController } from './useXiaoyinsiAuthController';
import { useXiaoyinsiLevelController } from './useXiaoyinsiLevelController';
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
  openUser: (user: Extract<AccountCenterCommand, { type: 'open-user' }>['user']) => Promise<unknown>;
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
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [loadingLinuxDoPage, setLoadingLinuxDoPage] = useState(true);
  const [linuxDoWebViewError, setLinuxDoWebViewError] = useState('');
  const [linuxDoWebViewKey, setLinuxDoWebViewKey] = useState(0);
  const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const showLoginPanelRef = useRef(showLoginPanel);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const showYaohuoLoginPanelRef = useRef(showYaohuoLoginPanel);
  const [yaohuoLoginPrompt, setYaohuoLoginPrompt] = useState('');
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const showLinuxDoPanelRef = useRef(showLinuxDoPanel);
  useCommitRefValue(showLoginPanelRef, showLoginPanel);
  useCommitRefValue(showYaohuoLoginPanelRef, showYaohuoLoginPanel);
  useCommitRefValue(showLinuxDoPanelRef, showLinuxDoPanel);
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
  const closingAuthSurfacesRef = useRef(new Set<AuthSurface>());
  const linuxDoRecoveryBarrierRef = useRef(false);
  const pendingNodeSeekRecoveryRef = useRef<LinuxDoReadRecovery | null>(null);
  const beginAccountIdentityCheckRef = useRef<(source: SessionSite, surfaceGeneration?: number) => void>(
    () => undefined
  );
  const reconcileAccountStatusRef = useRef<
    (source: SessionSite, options?: { surfaceGeneration?: number }) => Promise<AccountReconcileResult>
  >(async () => ({ status: 'stale' }));
  const applyAccountSessionEventRef = useRef<(event: ScopedSiteSessionEvent) => boolean>(() => false);
  const readSessionRuntimeSnapshot = useCallback(
    (source: SessionSite): SessionRuntimeSnapshot => {
      const sourceEnabled = enabledSessionSourceSet.has(source);
      const account =
        appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
        createAccountSessionSnapshot(source);
      const access = accountSessionAccess(account);
      return {
        source,
        authenticated: access.authenticated,
        authSurfaceOpen:
          sourceEnabled &&
          (hasOpenAuthSurfaceForSource(authSurfaceRegistryRef.current, source) ||
            (source === 'linuxdo' && linuxDoRecoveryBarrierRef.current)),
        identityKey: access.identityKey,
        identityTrust: access.identityTrust,
        sessionEpoch: forumSessionEpochsRef.current[source],
        sourceEnabled
      };
    },
    [enabledSessionSourceSet]
  );
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
  const updateLinuxDoRecoveryBarrier = useCallback((active: boolean) => {
    linuxDoRecoveryBarrierRef.current = active;
  }, []);
  const beginAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, source: SessionSite, checkIdentity = true) => {
      const closingTicket = authSurfaceRegistryRef.current.active[surface];
      if (closingTicket && closingAuthSurfacesRef.current.delete(surface)) {
        releaseAuthSurface(authSurfaceRegistryRef.current, surface, closingTicket.generation);
      }
      const account = readSessionRuntimeSnapshot(source);
      const ticket = beginAuthSurface(authSurfaceRegistryRef.current, {
        source,
        surface,
        identityKey: account.identityKey,
        sessionEpoch: forumSessionEpochsRef.current[source]
      });
      if (checkIdentity) beginAccountIdentityCheckRef.current(source, ticket.generation);
      return ticket;
    },
    [readSessionRuntimeSnapshot]
  );
  const finishAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, reason: AuthSurfaceCloseReason) => {
      const ticket = finishAuthSurface(authSurfaceRegistryRef.current, surface, reason, true);
      if (!ticket?.shouldReconcile) return null;
      closingAuthSurfacesRef.current.add(surface);
      const reconciliation = reconcileAccountStatusRef
        .current(ticket.source, { surfaceGeneration: ticket.generation })
        .catch((error): AccountReconcileResult => ({
          status: 'unknown',
          error: errorMessage(error),
          errorInfo: sourceErrorFromUnknown(ticket.source, error)
        }));
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
    [notify]
  );
  const handleSiteSessionEvent = useCallback((event: ScopedSiteSessionEvent) => {
    applyAccountSessionEventRef.current(event);
  }, []);

  const session = useSessionController({
    defaultFetcher: fetcher,
    forumSessionEpochsRef,
    linuxDoBrowserWebViewRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekRecoveryThreshold,
    nodeSeekWebViewUserAgentRef,
    notify,
    onSiteSessionEvent: handleSiteSessionEvent,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent
  });
  const { handleLinuxDoBrowserFetchMessage, handleNodeSeekBrowserFetchMessage } = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch: session.completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch: session.completeNodeSeekBrowserFetch
  });
  const xiaoyinsiAuth = useXiaoyinsiAuthController({
    dispatchSiteSessionEvent: session.dispatchSiteSessionEvent,
    enabled: enabledSessionSourceSet.has('xiaoyinsi'),
    fetcher,
    notify
  });
  const readGateway = useSessionReadGateway({
    anonymousFetcher: fetcher,
    fetcher: session.forumFetchWithWebViewFallback,
    getEnabledSources,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    readSessionRuntimeSnapshot,
    refreshXiaoyinsiAuthorization: xiaoyinsiAuth.refreshAuthorization
  });
  const status = useAccountStatusController({
    enabledSources: enabledSessionSources,
    enabledSourcesReady: ready,
    fetcher: session.forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onAccountStatusChanged: session.commitAccountStatusChange,
    readXiaoyinsiAuthorization: xiaoyinsiAuth.readAuthorization
  });
  const reconcileAccountStatus = useCallback(
    async (...args: Parameters<typeof status.reconcileAccountStatus>) => {
      const result = await status.reconcileAccountStatus(...args);
      if (result.status === 'same' || result.status === 'changed' || result.status === 'anonymous') {
        const source = args[0];
        for (const [surface, ticket] of Object.entries(authSurfaceRegistryRef.current.active)) {
          if (ticket?.source !== source || !closingAuthSurfacesRef.current.has(surface as AuthSurface)) continue;
          releaseAuthSurface(authSurfaceRegistryRef.current, surface as AuthSurface, ticket.generation);
          closingAuthSurfacesRef.current.delete(surface as AuthSurface);
        }
      }
      return result;
    },
    [status.reconcileAccountStatus]
  );
  const reconcileAuthSurfaceAccountStatus = useCallback(
    (source: SessionSite, options: { surfaceGeneration?: number } = {}) =>
      reconcileAccountStatus(source, { ...options, publishAnonymous: false }),
    [reconcileAccountStatus]
  );
  useCommitRefValue(beginAccountIdentityCheckRef, status.beginAccountIdentityCheck);
  useCommitRefValue(reconcileAccountStatusRef, reconcileAccountStatus);
  useCommitRefValue(applyAccountSessionEventRef, status.applyAccountSessionEvent);

  const xiaoyinsiLevel = useXiaoyinsiLevelController({
    authorizationPhase: xiaoyinsiAuth.phase,
    isIdentityPending: () => readSessionRuntimeSnapshot('xiaoyinsi').identityTrust !== 'confirmed',
    notify,
    readGateway,
    sessionEpochs: session.forumSessionEpochs
  });

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
    reconcileAccountStatus: reconcileNodeImageAccount
  });
  const closeYaohuoLoginPanel = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button') => {
      if (!showYaohuoLoginPanelRef.current) return;
      showYaohuoLoginPanelRef.current = false;
      handleClearCredentialLoginIntent('yaohuo');
      yaohuoLoginPanelRequestRef.current += 1;
      yaohuoWebViewRef.current?.stopLoading();
      setShowYaohuoLoginPanel(false);
      setYaohuoLoginPrompt('');
      setLoadingYaohuoLoginPage(false);
      finishAuthSurfaceTicket('yaohuo-login', reason);
    },
    [finishAuthSurfaceTicket, handleClearCredentialLoginIntent]
  );
  const changeYaohuoLoginPanel = useCallback(
    (visible: boolean, closeReason: AuthSurfaceCloseReason = 'close-button') => {
      if (visible) {
        if (!enabledSessionSourceSet.has('yaohuo')) return;
        if (showYaohuoLoginPanelRef.current) return;
        prepareAuthSurfaceOpenRef.current('yaohuo-login');
        showYaohuoLoginPanelRef.current = true;
        beginAuthSurfaceTicket('yaohuo-login', 'yaohuo');
        yaohuoLoginPanelRequestRef.current += 1;
        setLoadingYaohuoLoginPage(true);
        setShowYaohuoLoginPanel(true);
        yaohuoWebViewRef.current?.reload();
        return;
      }
      closeYaohuoLoginPanel(closeReason);
    },
    [beginAuthSurfaceTicket, closeYaohuoLoginPanel, enabledSessionSourceSet]
  );
  const changeNodeSeekLoginPanel = useCallback(
    (visible: boolean, closeReason: AuthSurfaceCloseReason = 'close-button') => {
      const wasVisible = showLoginPanelRef.current;
      if (visible && !enabledSessionSourceSet.has('nodeseek')) return;
      if (visible === wasVisible) return;
      if (visible) prepareAuthSurfaceOpenRef.current('nodeseek-login');
      showLoginPanelRef.current = visible;
      nodeSeekLoginPanelRequestRef.current += 1;
      if (visible) {
        beginAuthSurfaceTicket('nodeseek-login', 'nodeseek');
      } else {
        pendingNodeSeekRecoveryRef.current = null;
        handleClearCredentialLoginIntent('nodeseek');
      }
      webViewRef.current?.stopLoading();
      setLoadingLoginPage(visible);
      setShowLoginPanel(visible);
      if (!visible) finishAuthSurfaceTicket('nodeseek-login', closeReason);
    },
    [beginAuthSurfaceTicket, enabledSessionSourceSet, finishAuthSurfaceTicket, handleClearCredentialLoginIntent]
  );
  const verification = useVerificationController({
    canOpenLinuxDoPanel: () => enabledSessionSourceSet.has('linuxdo'),
    changeNodeSeekLoginPanel,
    checkingRequestIdRef,
    closeYaohuoLoginPanel,
    linuxDoPanelClosingSessionRef,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    notify,
    onBeforeLinuxDoSurfaceOpened: () => prepareAuthSurfaceOpenRef.current('linuxdo-login'),
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    onLinuxDoRecoveryBarrierChanged: updateLinuxDoRecoveryBarrier,
    onLinuxDoSurfaceClosed: ({ authoritativeResult, reason }) => {
      finishAuthSurfaceTicket('linuxdo-login', authoritativeResult ? 'authoritative-recovery' : reason);
    },
    onLinuxDoSurfaceOpened: () => beginAuthSurfaceTicket('linuxdo-login', 'linuxdo'),
    reconcileAccountStatus: reconcileAuthSurfaceAccountStatus,
    setChecking,
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey,
    setLinuxDoWebViewUserAgent,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    setShowLinuxDoPanel,
    showLinuxDoPanelRef,
    updateLinuxDoSession: session.updateLinuxDoSession,
    updateNodeSeekSession: session.updateNodeSeekSession
  });
  const closeLinuxDoPanel = verification.closeLinuxDoPanel;
  const showNodeSeekVerification = verification.showNodeSeekVerification;
  const stopLinuxDoVerificationForInactiveApp = verification.stopLinuxDoVerificationForInactiveApp;
  useEffect(() => {
    if (!appActive) stopLinuxDoVerificationForInactiveApp();
  }, [appActive, stopLinuxDoVerificationForInactiveApp]);
  const closeNodeImageAuthPanel = nodeImage.panel.close;
  const prepareAuthSurfaceOpen = useCallback(
    (openingSurface: AuthSurface) => {
      closeOtherAuthSurfaces(openingSurface, {
        'linuxdo-login': (reason) => closeLinuxDoPanel(true, reason),
        'nodeimage-auth': closeNodeImageAuthPanel,
        'nodeseek-login': (reason) => changeNodeSeekLoginPanel(false, reason),
        'yaohuo-login': closeYaohuoLoginPanel
      });
    },
    [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]
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
    clearLinuxDoLoginState: session.clearLinuxDoLoginState,
    clearNodeSeekLoginState: session.clearNodeSeekLoginState,
    clearYaohuoLoginState: session.clearYaohuoLoginState,
    sessionEpochs: session.forumSessionEpochs,
    nodeSeekLoginPanelRequestRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    linuxDoVerificationActive: showLinuxDoPanel,
    linuxDoIdentityPending: readSessionRuntimeSnapshot('linuxdo').identityTrust !== 'confirmed',
    resetLinuxDoLevelState,
    resetLinuxDoWebView: verification.resetLinuxDoWebView,
    reconcileAccountStatus: reconcileAuthSurfaceAccountStatus,
    setChecking,
    setNodeSeekWebViewUserAgent,
    screen,
    showLinuxDoVerification: verification.showLinuxDoVerification,
    readGateway,
    showLoginPanelRef,
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
    onOpenXiaoyinsiAuthorization: () => void xiaoyinsiAuth.beginAuthorization(),
    refreshAccountStatus: status.refreshAccountStatus,
    setYaohuoLoginPrompt,
    webViewRef,
    webViewBlockMessage,
    yaohuoWebViewRef
  });
  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'open-user') {
        await openUser(command.user);
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
      if (recovery) pendingNodeSeekRecoveryRef.current = recovery;
      showNodeSeekVerification(message);
    },
    [showNodeSeekVerification]
  );
  const checkNodeSeekLoginAndRetry = useCallback(async () => {
    const checkRequest = nodeSeekLoginPanelRequestRef.current;
    const accountResult = await account.checkNodeSeekAccount();
    if (nodeSeekLoginPanelRequestRef.current !== checkRequest) return false;
    if (accountResult.status === 'changed') {
      changeNodeSeekLoginPanel(false, 'authoritative-recovery');
      return false;
    }
    if (accountResult.status !== 'same') return false;

    const recovery = pendingNodeSeekRecoveryRef.current;
    pendingNodeSeekRecoveryRef.current = null;
    changeNodeSeekLoginPanel(false, 'authoritative-recovery');
    if (!recovery) return true;

    const recoveryRequest = nodeSeekLoginPanelRequestRef.current;
    setChecking(true);
    let outcome: LinuxDoReadResumeOutcome = 'failed';
    try {
      outcome = await recovery.resume();
    } catch (error) {
      if (nodeSeekLoginPanelRequestRef.current === recoveryRequest) {
        notify(`NodeSeek 身份已确认，但原页面恢复失败：${errorMessage(error)}`);
      }
    } finally {
      if (nodeSeekLoginPanelRequestRef.current === recoveryRequest) setChecking(false);
    }
    if (nodeSeekLoginPanelRequestRef.current !== recoveryRequest) return false;
    if (outcome === 'verification-required') {
      const queryIsActive =
        appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive() === true;
      if (queryIsActive && !pendingNodeSeekRecoveryRef.current) {
        requestNodeSeekVerification('NodeSeek 验证仍未生效，请继续验证后再次检测。', recovery);
      }
      session.updateNodeSeekSession({
        type: 'verification-required',
        message: 'NodeSeek 验证仍未生效，请继续验证后再次检测。'
      });
      return false;
    }
    if (outcome === 'failed') {
      notify('NodeSeek 身份已确认，但原页面恢复失败，请返回原页面重试。');
    }
    return outcome === 'completed';
  }, [account, changeNodeSeekLoginPanel, notify, requestNodeSeekVerification, session]);
  const closePanels = useCallback(() => {
    changeNodeSeekLoginPanel(false, 'navigation-away');
    closeNodeImageAuthPanel('navigation-away');
    closeYaohuoLoginPanel('navigation-away');
    closeLinuxDoPanel(true, 'navigation-away');
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]);
  const closeTopmostSurface = useCallback(() => {
    if (showLoginPanelRef.current) {
      changeNodeSeekLoginPanel(false, 'hardware-back');
      return 'login-panel-closed';
    }
    if (nodeImage.panel.visible) {
      closeNodeImageAuthPanel('hardware-back');
      return 'image-auth-panel-closed';
    }
    if (showYaohuoLoginPanelRef.current) {
      closeYaohuoLoginPanel('hardware-back');
      return 'yaohuo-panel-closed';
    }
    if (showLinuxDoPanelRef.current) {
      closeLinuxDoPanel(true, 'hardware-back');
      return 'linuxdo-panel-closed';
    }
    return null;
  }, [
    changeNodeSeekLoginPanel,
    closeLinuxDoPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    nodeImage.panel.visible
  ]);

  const readWritableSessionSnapshot = useCallback(
    (source: SessionSite): WritableSessionSnapshot => readSessionRuntimeSnapshot(source),
    [readSessionRuntimeSnapshot]
  );
  const reconcileWritableSession = useCallback((source: SessionSite) => reconcileAccountStatusRef.current(source), []);
  const ensureWritableSession = useCallback(
    (source: SessionSite) =>
      ensureWritableSessionTicket(
        () => readWritableSessionSnapshot(source),
        () => reconcileWritableSession(source)
      ),
    [readWritableSessionSnapshot, reconcileWritableSession]
  );
  const isWritableSessionTicketCurrent = useCallback(
    (ticket: WritableSessionTicket) =>
      validateWritableSessionTicket(ticket, readWritableSessionSnapshot(ticket.source)),
    [readWritableSessionSnapshot]
  );
  const getLinuxDoUserAgent = useCallback(() => linuxDoWebViewUserAgentRef.current, []);
  const getNodeSeekUserAgent = useCallback(() => nodeSeekWebViewUserAgentRef.current, []);
  const nodeSeekCheckIn = useNodeSeekCheckInController({
    ensureWritableSession,
    fetcher,
    isWritableSessionTicketCurrent,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    reconcileWritableSession
  });
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
      checking,
      checkNodeSeekLoginAndRetry,
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
      showLinuxDoPanel,
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
      reconcileWritableSession
    },
    center: {
      account: {
        linuxDoLevelBusy: account.linuxDoLevelBusy,
        linuxDoLevelError: account.linuxDoLevelError,
        linuxDoLevelProfile: account.linuxDoLevelProfile,
        refreshLinuxDoLevel: account.refreshLinuxDoLevel
      },
      checkIn: nodeSeekCheckIn.checkIn,
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
      },
      xiaoyinsiAuth: {
        beginAuthorization: xiaoyinsiAuth.beginAuthorization,
        cancelAuthorization: xiaoyinsiAuth.cancelAuthorization,
        message: xiaoyinsiAuth.message,
        openAuthorizationBrowser: xiaoyinsiAuth.openAuthorizationBrowser,
        pending: xiaoyinsiAuth.pending,
        phase: xiaoyinsiAuth.phase,
        refreshAuthorization: xiaoyinsiAuth.refreshAuthorization,
        revokeAuthorization: xiaoyinsiAuth.revokeAuthorization,
        secondsRemaining: xiaoyinsiAuth.secondsRemaining
      },
      xiaoyinsiLevel: {
        levelBusy: xiaoyinsiLevel.levelBusy,
        levelError: xiaoyinsiLevel.levelError,
        levelProfile: xiaoyinsiLevel.levelProfile,
        refreshLevel: xiaoyinsiLevel.refreshLevel
      }
    },
    hosts: {
      closePanels,
      closeTopmostSurface,
      element: hostElement,
      linuxDoVerificationVisible: showLinuxDoPanel,
      showYaohuoLogin,
      requestNodeSeekVerification,
      showLinuxDoVerification: verification.showLinuxDoVerification,
      surfaces: {
        linuxdo: showLinuxDoPanel,
        nodeseek: showLoginPanel,
        yaohuo: showYaohuoLoginPanel
      }
    }
  };
}
