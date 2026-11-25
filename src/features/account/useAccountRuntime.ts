import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { CancelledError, isCancelledError } from '@tanstack/react-query';
import type { WebView } from 'react-native-webview';
import { markAccountSessionHandoffPending, saveAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import type { Fetcher } from '@/platform/network/request';
import { accountQueryKeys, appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { nodeSeekAttendanceQuery } from '@/sources/nodeseek/attendanceQuery';
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
import { sourceCatalog, sourceValues, type Source } from '@/domain/forum/sourceCatalog';
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
  LinuxDoReadingRecovery,
  NotificationSessionAccess,
  RequestAccountRecheck
} from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import type { ForumReadSession } from '@/domain/forum/readPlan';
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
import { RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { useAccountStatusController } from './useAccountStatusController';
import { useLocalIdentityRestore } from './useLocalIdentityRestore';
import { createLinuxDoCookieHandoff } from './linuxDoCookieHandoff';
import { createAuthSurfacePreparation, type AuthSurfacePreparation } from './authSurfacePreparation';
import { useAccountController } from './useAccountController';
import { useAccountCredentialController } from './useAccountCredentialController';
import type { LoginWebViewFailureReason } from './credentialDiagnostics';
import { useNodeImageAuthController } from './useNodeImageAuthController';
import { useLinuxDoCreditAuthController } from './useLinuxDoCreditAuthController';
import { useNodeSeekCheckInController } from './useNodeSeekCheckInController';
import { useSessionController } from './useSessionController';
import { useSessionReadGateway } from './useSessionReadGateway';
import { useLinuxDoReadingRuntime } from './useLinuxDoReadingRuntime';
import { linuxDoRecoveryScopeKey, useVerificationController } from './useVerificationController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import { AccountHosts, type AccountHostsProps } from './AccountHosts';

type NodeSeekLoginCheck = { source: 'nodeseek'; requestId: number };
type LoginPanelCheck = NodeSeekLoginCheck | { source: 'yaohuo'; requestId: number };
type NodeSeekForegroundRead = Pick<SessionRuntimeSnapshot, 'identityKey' | 'sessionEpoch'> & {
  surfaceGeneration: number;
};
type NodeSeekRecoveryIntent =
  | { phase: 'consumed' }
  | { phase: 'pending'; recovery: ReadRecovery }
  | { phase: 'checking'; check: NodeSeekLoginCheck; recovery: ReadRecovery | null }
  | {
      phase: 'resuming';
      check: NodeSeekLoginCheck;
      recovery: ReadRecovery;
      scope: NodeSeekForegroundRead;
      controller: AbortController;
    };

function useNodeSeekRecoveryIntent() {
  const current = useRef<NodeSeekRecoveryIntent>({ phase: 'consumed' });
  const [snapshot, setSnapshot] = useState(current.current);
  const publish = useCallback((next: NodeSeekRecoveryIntent) => {
    const previous = current.current;
    current.current = next;
    if (previous.phase === 'resuming') previous.controller.abort();
    setSnapshot(next);
  }, []);
  useLayoutEffect(
    () => () => {
      const intent = current.current;
      if (intent.phase === 'resuming') intent.controller.abort();
    },
    []
  );
  const request = useCallback(
    (recovery: ReadRecovery) => {
      const intent = current.current;
      const previous = intent.phase === 'consumed' ? null : intent.recovery;
      if (previous && (previous === recovery || previous.isCurrent?.() !== false)) return false;
      publish({ phase: 'pending', recovery });
      previous?.cancel?.();
      return true;
    },
    [publish]
  );
  const begin = useCallback(
    (check: NodeSeekLoginCheck) => {
      const recovery = current.current.phase === 'consumed' ? null : current.current.recovery;
      publish({ phase: 'checking', check, recovery });
      return recovery;
    },
    [publish]
  );
  const owns = useCallback((check: NodeSeekLoginCheck) => {
    const intent = current.current;
    return 'check' in intent && intent.check === check;
  }, []);
  const beginResume = useCallback(
    (check: NodeSeekLoginCheck, scope: NodeSeekForegroundRead) => {
      const intent = current.current;
      if (intent.phase !== 'checking' || intent.check !== check || !intent.recovery) return null;
      const controller = new AbortController();
      publish({ phase: 'resuming', check, recovery: intent.recovery, scope, controller });
      return controller.signal;
    },
    [publish]
  );
  const resumeScope = useCallback((check: NodeSeekLoginCheck) => {
    const intent = current.current;
    return intent.phase === 'resuming' && intent.check === check && !intent.controller.signal.aborted
      ? intent.scope
      : undefined;
  }, []);
  const settle = useCallback(
    (check: NodeSeekLoginCheck) => {
      const intent = current.current;
      if (!('check' in intent) || intent.check !== check) return;
      publish(intent.recovery ? { phase: 'pending', recovery: intent.recovery } : { phase: 'consumed' });
    },
    [publish]
  );
  const clear = useCallback(
    (canceled: boolean) => {
      const intent = current.current;
      if (intent.phase === 'consumed') return;
      publish({ phase: 'consumed' });
      if (canceled) intent.recovery?.cancel?.();
    },
    [publish]
  );
  return {
    pending: snapshot.phase !== 'consumed' && snapshot.recovery !== null,
    request,
    begin,
    owns,
    beginResume,
    resumeScope,
    settle,
    clear
  };
}

export function useAccountRuntime({
  appActive,
  beforeRequest,
  enabledSources,
  fetcher,
  isAccountCenterFocused,
  loginNavigation,
  notify,
  nodeSeekRecoveryThreshold,
  openUser,
  ready,
  contentSourcesReady = ready,
  screen,
  webViewBlockMessage
}: {
  appActive: boolean;
  beforeRequest?: () => Promise<void>;
  contentSourcesReady?: boolean;
  enabledSources: readonly Source[];
  fetcher: Fetcher;
  isAccountCenterFocused?: () => boolean;
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
  const loginPanelCheckRef = useRef<LoginPanelCheck | null>(null);
  const [loginPanelCheck, setLoginPanelCheck] = useState<LoginPanelCheck | null>(null);
  const publishLoginPanelCheck = useCallback((check: LoginPanelCheck | null) => {
    loginPanelCheckRef.current = check;
    setLoginPanelCheck(check);
  }, []);
  const ownsLoginPanelCheck = useCallback((check: LoginPanelCheck) => loginPanelCheckRef.current === check, []);
  const verificationAppActiveRef = useRef(appActive);
  useCommitRefValue(verificationAppActiveRef, appActive);
  const linuxDoWebViewSessionRef = useRef(0);
  const linuxDoWebViewMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepareAuthSurfaceOpenRef = useRef<(surface: AuthSurface) => void>(() => undefined);
  const credentialFailureHandlerRef = useRef<
    (site: CredentialSite, attempt: number, reason: LoginWebViewFailureReason) => void
  >(() => undefined);
  const credentialClearIntentHandlerRef = useRef<(site: CredentialSite) => void>(() => undefined);
  const notifyRef = useRef(notify);
  useCommitRefValue(notifyRef, notify);
  const {
    userAgents: { nodeseek: nodeSeekWebViewUserAgent, linuxdo: linuxDoWebViewUserAgent },
    getUserAgent,
    commitUserAgent,
    isSourceIdentityReady,
    ready: sessionIdentityReady,
    error: sessionRestoreError,
    retry: retrySessionRestore
  } = useLocalIdentityRestore({ ready, enabledSources: enabledSessionSources, notify });
  const getNodeSeekUserAgent = useCallback(() => getUserAgent('nodeseek'), [getUserAgent]);
  const getLinuxDoUserAgent = useCallback(() => getUserAgent('linuxdo'), [getUserAgent]);
  const commitNodeSeekWebViewUserAgent = useCallback(
    (userAgent: string) => commitUserAgent('nodeseek', userAgent),
    [commitUserAgent]
  );
  const commitLinuxDoWebViewUserAgent = useCallback(
    (userAgent: string) => commitUserAgent('linuxdo', userAgent),
    [commitUserAgent]
  );
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
  const [linuxDoCookies] = useState(createLinuxDoCookieHandoff);
  useEffect(
    () => () => {
      loginPanelCheckRef.current = null;
      linuxDoCookies.release();
    },
    [linuxDoCookies]
  );
  const [checking, setChecking] = useState(false);
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
  const authSurfaceLifetimeRef = useRef(new AbortController());
  const authSurfacePreparationsRef = useRef<Partial<Record<SessionSite, AuthSurfacePreparation>>>({});
  const [authSurfaceRevision, refreshAuthSurfaces] = useState(0);
  const visibleAuthSurface = authSurfaceRegistryRef.current.visible;
  const showLoginPanel = visibleAuthSurface === 'nodeseek-login';
  const showYaohuoLoginPanel = visibleAuthSurface === 'yaohuo-login';
  const showLinuxDoPanel = visibleAuthSurface === 'linuxdo-login';
  const linuxDoPanelVisible = showLinuxDoPanel || recoveryPanel.phase !== 'idle';
  const showNodeImagePanel = visibleAuthSurface === 'nodeimage-auth';
  const showLinuxDoCreditPanel = visibleAuthSurface === 'linuxdo-credit';
  const loginUnmountWaiters = useRef({ nodeseek: new Set<() => void>(), yaohuo: new Set<() => void>() });
  const releaseLoginUnmountWaiters = useCallback((source: 'nodeseek' | 'yaohuo') => {
    const waiters = loginUnmountWaiters.current[source];
    waiters.forEach((resolve) => resolve());
    waiters.clear();
  }, []);
  useLayoutEffect(() => {
    if (!showLoginPanel || authSurfaceRegistryRef.current.active['nodeseek-login']?.phase === 'open')
      releaseLoginUnmountWaiters('nodeseek');
    if (!showYaohuoLoginPanel || authSurfaceRegistryRef.current.active['yaohuo-login']?.phase === 'open')
      releaseLoginUnmountWaiters('yaohuo');
  }, [authSurfaceRevision, releaseLoginUnmountWaiters, showLoginPanel, showYaohuoLoginPanel]);
  useEffect(
    () => () => {
      releaseLoginUnmountWaiters('nodeseek');
      releaseLoginUnmountWaiters('yaohuo');
    },
    [releaseLoginUnmountWaiters]
  );
  const awaitLoginUnmount = useCallback(
    (source: 'nodeseek' | 'yaohuo') =>
      (source === 'nodeseek' ? webViewRef : yaohuoWebViewRef).current
        ? new Promise<void>((resolve) => loginUnmountWaiters.current[source].add(resolve))
        : Promise.resolve(),
    [webViewRef, yaohuoWebViewRef]
  );
  const authSurfaceVisible = useCallback(
    (surface: AuthSurface) => isAuthSurfaceVisible(authSurfaceRegistryRef.current, surface),
    []
  );
  const {
    pending: hasPendingNodeSeekRecovery,
    request: requestNodeSeekRecovery,
    begin: beginNodeSeekRecoveryCheck,
    owns: ownsNodeSeekRecoveryCheck,
    beginResume: beginNodeSeekRecoveryResume,
    resumeScope: nodeSeekRecoveryResumeScope,
    settle: settleNodeSeekRecoveryCheck,
    clear: clearNodeSeekRecovery
  } = useNodeSeekRecoveryIntent();
  const cancelLoginPanelCheck = useCallback(
    (source?: 'nodeseek' | 'yaohuo') => {
      if (!loginPanelCheckRef.current || (source && loginPanelCheckRef.current.source !== source)) return;
      if (loginPanelCheckRef.current.source === 'nodeseek') settleNodeSeekRecoveryCheck(loginPanelCheckRef.current);
      publishLoginPanelCheck(null);
      ++checkingRequestIdRef.current;
      setChecking(false);
    },
    [publishLoginPanelCheck, settleNodeSeekRecoveryCheck]
  );
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
  const readSessionRuntimeSnapshot = useCallback(
    (source: SessionSite, sourceEnabled = enabledSourcesRef.current.includes(source)): SessionRuntimeSnapshot => {
      const account =
        appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source)) ||
        createAccountSessionSnapshot(source);
      const access = accountSessionAccess(account);
      return {
        source,
        authenticated: access.authenticated,
        authSurfaceOpen:
          sourceEnabled &&
          (account.handoffPending === true || hasAuthSurfaceBarrierForSource(authSurfaceRegistryRef.current, source)),
        identityKey: access.identityKey,
        identityTrust: isSourceIdentityReady(source) ? access.identityTrust : 'unknown',
        sessionEpoch: forumSessionEpochsRef.current[source],
        sourceEnabled
      };
    },
    [isSourceIdentityReady]
  );
  const canReadDuringHandoff = useCallback(
    (snapshot: SessionRuntimeSnapshot) => {
      if (snapshot.source !== 'nodeseek' || !snapshot.authSurfaceOpen) return false;
      const check = loginPanelCheckRef.current;
      if (check?.source !== 'nodeseek') return false;
      const foregroundRead = nodeSeekRecoveryResumeScope(check);
      if (!foregroundRead) return false;
      const surface = authSurfaceRegistryRef.current.active['nodeseek-login'];
      return (
        snapshot.sourceEnabled === true &&
        snapshot.identityTrust === 'confirmed' &&
        verificationAppActiveRef.current &&
        foregroundRead.identityKey === snapshot.identityKey &&
        foregroundRead.sessionEpoch === snapshot.sessionEpoch &&
        surface?.phase === 'open' &&
        surface.generation === foregroundRead.surfaceGeneration &&
        authSurfaceVisible('nodeseek-login')
      );
    },
    [authSurfaceVisible, nodeSeekRecoveryResumeScope]
  );
  const readForegroundSessionSnapshot = useCallback(
    (source: SessionSite): ForumReadSession => {
      const snapshot = readSessionRuntimeSnapshot(source);
      return canReadDuringHandoff(snapshot) ? { ...snapshot, foregroundReadDuringHandoff: true } : snapshot;
    },
    [canReadDuringHandoff, readSessionRuntimeSnapshot]
  );
  const notificationPrivateAccessAllowed = useCallback(
    (source: SessionSite, identityKey: string, access: NotificationSessionAccess) => {
      const snapshot = readSessionRuntimeSnapshot(source);
      return (
        snapshot.sourceEnabled !== false &&
        snapshot.authenticated &&
        snapshot.identityTrust === 'confirmed' &&
        snapshot.identityKey === identityKey &&
        (!snapshot.authSurfaceOpen || (access === 'foreground-read' && canReadDuringHandoff(snapshot)))
      );
    },
    [canReadDuringHandoff, readSessionRuntimeSnapshot]
  );
  const getLinuxDoRecoveryScope = useCallback(() => {
    const runtime = readSessionRuntimeSnapshot('linuxdo');
    const snapshot = appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot('linuxdo'));
    const surface = authSurfaceRegistryRef.current.active['linuxdo-login'];
    // Holding private access after a failed write does not retire a retry for the same identity.
    return linuxDoRecoveryScopeKey(
      surface?.phase === 'open' && surface.identityKey === runtime.identityKey && snapshot?.handoffPending
        ? { ...runtime, identityTrust: snapshot.identityTrust }
        : runtime
    );
  }, [readSessionRuntimeSnapshot]);
  const watchAuthSurfacePreparation = useCallback(
    (source: SessionSite, preparation: AuthSurfacePreparation, owner: AbortSignal) => {
      const isCurrent = () =>
        !owner.aborted &&
        authSurfaceLifetimeRef.current.signal === owner &&
        authSurfacePreparationsRef.current[source] === preparation;
      void preparation.promise.then(
        () => {
          if (!isCurrent()) return;
          preparation.prepared();
          refreshAuthSurfaces((revision) => revision + 1);
        },
        () => {
          if (!isCurrent() || preparation.error) return;
          preparation.failed('登录会话保存失败，请关闭后重试');
          refreshAuthSurfaces((revision) => revision + 1);
          notifyRef.current(preparation.error);
        }
      );
    },
    []
  );
  useLayoutEffect(() => {
    const previousOwner = authSurfaceLifetimeRef.current.signal;
    if (previousOwner.aborted) {
      authSurfaceLifetimeRef.current = new AbortController();
      const owner = authSurfaceLifetimeRef.current.signal;
      const registry = authSurfaceRegistryRef.current;
      for (const source of sessionSources) {
        const preparation = authSurfacePreparationsRef.current[source];
        if (
          preparation &&
          !preparation.ready &&
          !preparation.error &&
          enabledSourcesRef.current.includes(source) &&
          hasAuthSurfaceBarrierForSource(registry, source)
        )
          watchAuthSurfacePreparation(source, preparation, owner);
      }
      if (
        enabledSourcesRef.current.includes('linuxdo') &&
        (hasAuthSurfaceBarrierForSource(registry, 'linuxdo') ||
          registry.visible === 'linuxdo-login' ||
          registry.visible === 'linuxdo-credit')
      )
        linuxDoCookies.adoptPreparation(previousOwner, owner);
    }
    const owner = authSurfaceLifetimeRef.current;
    return () => owner.abort();
  }, [linuxDoCookies, watchAuthSurfacePreparation]);
  const beginAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, source: SessionSite, checkIdentity = true, visible = true) => {
      const account = readSessionRuntimeSnapshot(source);
      const wasVisible = isAuthSurfaceVisible(authSurfaceRegistryRef.current, surface);
      const ticket = beginAuthSurface(
        authSurfaceRegistryRef.current,
        {
          source,
          surface,
          identityKey: account.identityKey,
          sessionEpoch: forumSessionEpochsRef.current[source]
        },
        visible
      );
      const owner = authSurfaceLifetimeRef.current.signal;
      const preparation = createAuthSurfacePreparation(
        wasVisible && authSurfacePreparationsRef.current[source]?.ready === true,
        markAccountSessionHandoffPending(source)
      );
      authSurfacePreparationsRef.current[source] = preparation;
      watchAuthSurfacePreparation(source, preparation, owner);
      refreshAuthSurfaces((revision) => revision + 1);
      if (checkIdentity) beginAccountIdentityCheckRef.current(source, ticket.generation);
      return ticket;
    },
    [readSessionRuntimeSnapshot, watchAuthSurfacePreparation]
  );
  const handoffLinuxDoCookies = useCallback(
    (parentTraceId?: string): Promise<void> =>
      linuxDoCookies.close(authSurfaceRegistryRef.current.generation, (generation) =>
        setLinuxDoCookieResponseBarrier(
          !enabledSourcesRef.current.includes('linuxdo'),
          'surface-close',
          generation,
          undefined,
          parentTraceId
        )
      ),
    [linuxDoCookies]
  );
  const awaitLinuxDoCookieHandoff = useCallback(() => linuxDoCookies.settled(), [linuxDoCookies]);
  const readingVerificationRef = useRef<(recovery: LinuxDoReadingRecovery) => void>(() => undefined);
  const finishAuthSurfaceTicket = useCallback(
    (surface: AuthSurface, reason: AuthSurfaceCloseReason, parentTraceId?: string) => {
      const wasVisible = isAuthSurfaceVisible(authSurfaceRegistryRef.current, surface);
      const ticket = finishAuthSurface(authSurfaceRegistryRef.current, surface, reason, true);
      if (!ticket && !wasVisible) return null;
      refreshAuthSurfaces((revision) => revision + 1);
      if (!ticket?.shouldReconcile) {
        if (surface === 'linuxdo-login' || surface === 'linuxdo-credit')
          void handoffLinuxDoCookies(parentTraceId).catch((error) => {
            if (!isCancelledError(error)) notify('登录会话交接未完成，请刷新账号页面重试。');
          });
        return null;
      }
      const reconciliation = Promise.resolve()
        .then(() =>
          authSurfaceRegistryRef.current.active[surface]?.generation === ticket.generation &&
          !(ticket.source === 'linuxdo' && isAuthSurfaceVisible(authSurfaceRegistryRef.current, 'linuxdo-login')) &&
          !Object.values(authSurfaceRegistryRef.current.active).some(
            (active) => active?.source === ticket.source && active.phase === 'open'
          )
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
  const requestAccountRecheck = useCallback<RequestAccountRecheck>(
    async (source, requestSessionEpoch, parentTraceId) => {
      const current = readSessionRuntimeSnapshot(source);
      if (
        (source !== 'linuxdo' && source !== 'nodeseek') ||
        !current.authenticated ||
        current.authSurfaceOpen ||
        current.identityTrust !== 'confirmed' ||
        current.sessionEpoch !== requestSessionEpoch ||
        current.sourceEnabled === false
      )
        return false;
      try {
        const result = await reconcileAccountStatusRef.current(source, { parentTraceId });
        const confirmed = readSessionRuntimeSnapshot(source);
        return (
          result.status === 'same' &&
          confirmed.sessionEpoch === requestSessionEpoch &&
          confirmed.identityKey === current.identityKey &&
          !confirmed.authSurfaceOpen &&
          confirmed.sourceEnabled !== false
        );
      } catch {
        notify(`${sourceCatalog[source].label} 登录状态暂时无法确认，请稍后重试账号核对`);
        return false;
      }
    },
    [notify, readSessionRuntimeSnapshot]
  );

  const handleSessionExpired = useCallback(
    (source: SessionSite, requestSessionEpoch: number) => {
      if (source === 'linuxdo') {
        void requestAccountRecheck(source, requestSessionEpoch);
        return;
      }
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
    [readSessionRuntimeSnapshot, requestAccountRecheck]
  );
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('linuxDoLoginCookieDeleted', () => {
      void requestAccountRecheck('linuxdo', readSessionRuntimeSnapshot('linuxdo').sessionEpoch);
    });
    return () => subscription.remove();
  }, [readSessionRuntimeSnapshot, requestAccountRecheck]);

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
    beforeRequest,
    fetcher: session.forumFetchWithWebViewFallback,
    getEnabledSources,
    getLinuxDoUserAgent,
    getNodeSeekUserAgent,
    onSessionExpired: handleSessionExpired,
    requestAccountRecheck,
    readSessionRuntimeSnapshot: readForegroundSessionSnapshot
  });
  const commitAccountStatusChange = session.commitAccountStatusChange;
  const cancelLinuxDoBrowserHandoff = session.cancelLinuxDoBrowserHandoff;
  const handleAccountStatusChanged = useCallback(
    (source: SessionSite) => {
      commitAccountStatusChange(source);
      if (source === 'linuxdo') {
        cancelLinuxDoBrowserHandoff();
        const nativeOwnsCookies = linuxDoCookies.cancelHandoff();
        void setLinuxDoCookieResponseBarrier(
          !enabledSourcesRef.current.includes('linuxdo') ||
            ((isAuthSurfaceVisible(authSurfaceRegistryRef.current, 'linuxdo-login') ||
              authSurfaceRegistryRef.current.active['linuxdo-credit']?.phase === 'open') &&
              !nativeOwnsCookies),
          'identity-change'
        ).catch(() => notify('登录会话交接未完成，请刷新账号页面重试。'));
      }
    },
    [notify, commitAccountStatusChange, cancelLinuxDoBrowserHandoff, linuxDoCookies]
  );
  const status = useAccountStatusController({
    enabledSources: enabledSessionSources,
    enabledSourcesReady: sessionIdentityReady,
    fetcher: session.forumFetchWithWebViewFallback,
    getLinuxDoUserAgent,
    getNodeSeekUserAgent,
    notify,
    onAccountStatusChanged: handleAccountStatusChanged
  });
  const startupRestoreError = sessionRestoreError || (status.restoreFailed ? '本机账号记录读取失败，请重试' : '');
  const retryStoredAccounts = status.retryStoredAccounts;
  const retryStartupRestore = useCallback(() => {
    retrySessionRestore();
    retryStoredAccounts();
  }, [retrySessionRestore, retryStoredAccounts]);
  const reconcileAccountStatusBase = status.reconcileAccountStatus;
  const settleAccountSessionHandoff = status.settleAccountSessionHandoff;
  const reconcileAccountStatus = useCallback(
    async (
      ...args: [SessionSite, (Parameters<typeof reconcileAccountStatusBase>[1] & { completeOpenHandoff?: boolean })?]
    ): Promise<AccountReconcileResult> => {
      const source = args[0];
      if (!enabledSourcesRef.current.includes(source)) return { status: 'stale' };
      if (!isSourceIdentityReady(source) || !status.hydrated) {
        const error = new Error('本地登录身份尚未就绪，请稍后重试');
        return { status: 'unknown', error: error.message, errorInfo: sourceErrorFromUnknown(source, error) };
      }
      const tickets = Object.values(authSurfaceRegistryRef.current.active).filter(
        (ticket) => ticket?.source === source && ticket.phase === 'reconciling'
      );
      const openHandoff =
        source === 'linuxdo' && args[1]?.completeOpenHandoff
          ? Object.values(authSurfaceRegistryRef.current.active).find(
              (ticket) =>
                ticket?.source === source &&
                ticket.phase === 'open' &&
                (args[1]?.surfaceGeneration === undefined || ticket.generation === args[1].surfaceGeneration)
            )
          : undefined;
      const needsHandoff = source === 'linuxdo' && (tickets.length > 0 || Boolean(openHandoff));
      const needsLoginUnmount = source !== 'linuxdo' && tickets.some((ticket) => ticket.surface === source + '-login');
      const preparation = authSurfacePreparationsRef.current[source];
      const owner = authSurfaceLifetimeRef.current.signal;
      const hasOpenSurface = () =>
        Object.values(authSurfaceRegistryRef.current.active).some(
          (ticket) => ticket?.source === source && ticket.phase === 'open' && ticket !== openHandoff
        );
      const canCompleteHandoff = () => !hasOpenSurface();
      const isCurrent = () =>
        !owner.aborted &&
        enabledSourcesRef.current.includes(source) &&
        authSurfacePreparationsRef.current[source] === preparation &&
        (!openHandoff || authSurfaceRegistryRef.current.active[openHandoff.surface] === openHandoff) &&
        tickets.every((ticket) => {
          const current = authSurfaceRegistryRef.current.active[ticket.surface];
          return !current || current.generation === ticket.generation;
        });
      let result: AccountReconcileResult;
      try {
        if (!isCurrent()) return { status: 'stale' };
        result = await reconcileAccountStatusBase(source, {
          ...args[1],
          ...(needsHandoff || needsLoginUnmount
            ? {
                beforeProbe: async () => {
                  if (needsHandoff) await handoffLinuxDoCookies();
                  else if (needsLoginUnmount) await awaitLoginUnmount(source);
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
        if (
          canCompleteHandoff() &&
          !(result.status === 'anonymous' && args[1]?.publishAnonymous === false) &&
          (preparation?.pending ||
            appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source))?.handoffPending)
        ) {
          const snapshot = appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source));
          const ownsSnapshot = () =>
            isCurrent() &&
            canCompleteHandoff() &&
            appQueryClient.getQueryData(accountQueryKeys.snapshot(source)) === snapshot;
          const persisted = snapshot && (await saveAccountSessionSnapshot(snapshot, ownsSnapshot).catch(() => false));
          if (!isCurrent() || !canCompleteHandoff()) return { status: 'stale' };
          const committed = appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source));
          const alreadyCommitted =
            !!snapshot &&
            !!committed &&
            !committed.handoffPending &&
            !preparation?.pending &&
            accountSessionAccess(snapshot).identityKey === accountSessionAccess(committed).identityKey;
          if (committed !== snapshot && !alreadyCommitted) return { status: 'stale' };
          if (!persisted && !alreadyCommitted) {
            const error = new Error('登录会话交接未能保存，请刷新账号页面重试');
            settleAccountSessionHandoff(source, error.message);
            return {
              status: 'unknown',
              error: error.message,
              errorInfo: { ...sourceErrorFromUnknown(source, error), reason: 'account_handoff_storage' }
            };
          }
          if (!alreadyCommitted) {
            if (preparation) preparation.persisted();
            settleAccountSessionHandoff(source);
          }
        }
        let released = false;
        for (const ticket of tickets) {
          released = releaseAuthSurface(authSurfaceRegistryRef.current, ticket.surface, ticket.generation) || released;
        }
        if (released) refreshAuthSurfaces((revision) => revision + 1);
      }
      return result;
    },
    [
      awaitLoginUnmount,
      handoffLinuxDoCookies,
      isSourceIdentityReady,
      reconcileAccountStatusBase,
      settleAccountSessionHandoff,
      status.hydrated
    ]
  );
  const reconcileAuthSurfaceAccountStatus = useCallback(
    (source: SessionSite, options: { surfaceGeneration?: number; publishAnonymous?: boolean } = {}) =>
      reconcileAccountStatus(source, { publishAnonymous: false, completeOpenHandoff: true, ...options }),
    [reconcileAccountStatus]
  );
  useCommitRefValue(beginAccountIdentityCheckRef, status.beginAccountIdentityCheck);
  useCommitRefValue(reconcileAccountStatusRef, reconcileAccountStatus);
  useCommitRefValue(applyAccountSessionEventRef, status.applyAccountSessionEvent);
  const handledInterruptedSourcesRef = useRef(new Set<SessionSite>());
  useEffect(() => {
    if (!status.hydrated) return;
    for (const source of status.interruptedSources) {
      if (!enabledSessionSourceSet.has(source)) {
        // Re-enabling a source leaves its handoff pending for explicit confirmation.
        handledInterruptedSourcesRef.current.add(source);
        continue;
      }
      if (!appActive || !isSourceIdentityReady(source) || handledInterruptedSourcesRef.current.has(source)) continue;
      if (
        !appQueryClient.getQueryData<AccountSessionSnapshot>(accountQueryKeys.snapshot(source))?.handoffPending ||
        Object.values(authSurfaceRegistryRef.current.active).some(
          (ticket) => ticket?.source === source && ticket.phase === 'open'
        )
      )
        continue;
      handledInterruptedSourcesRef.current.add(source);
      void reconcileAccountStatus(source);
    }
  }, [
    appActive,
    authSurfaceRevision,
    enabledSessionSourceSet,
    isSourceIdentityReady,
    reconcileAccountStatus,
    status.hydrated,
    status.interruptedSources
  ]);

  const getWebViewPreparation = useCallback((source: SessionSite) => {
    const preparation = authSurfacePreparationsRef.current[source];
    if (
      preparation?.error &&
      !Object.values(authSurfaceRegistryRef.current.active).some(
        (ticket) => ticket?.source === source && ticket.phase === 'open'
      )
    )
      return undefined;
    return preparation;
  }, []);
  const authSurfaceBlockMessage = (source: SessionSite) => {
    const preparation = getWebViewPreparation(source);
    return preparation && !preparation.ready ? preparation.error || '正在保存登录交接状态…' : '';
  };
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
    (surfaceGeneration: number) => reconcileAccountStatus('nodeseek', { surfaceGeneration, publishAnonymous: false }),
    [reconcileAccountStatus]
  );
  const nodeImage = useNodeImageAuthController({
    access: readSessionRuntimeSnapshot('nodeseek', enabledSessionSourceSet.has('nodeseek')),
    beginSurface: beginNodeImageSurface,
    finishSurface: finishNodeImageSurface,
    notify,
    prepareSurfaceOpen: prepareNodeImageSurface,
    readRuntime: readNodeImageRuntime,
    reconcileAccountStatus: reconcileNodeImageAccount,
    surfaceVisible: showNodeImagePanel,
    webViewBlocked: Boolean(webViewBlockMessage || authSurfaceBlockMessage('nodeseek'))
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
        clearNodeSeekRecovery(closeReason !== 'success');
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
      clearNodeSeekRecovery,
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
    return linuxDoCookies.prepare({
      owner: authSurfaceLifetimeRef.current.signal,
      generation: authSurfaceRegistryRef.current.generation,
      marker: getWebViewPreparation('linuxdo')?.promise,
      ownerIsCurrent: (owner) => authSurfaceLifetimeRef.current.signal === owner,
      apply: (generation) => setLinuxDoCookieResponseBarrier(true, 'surface-open', generation)
    });
  }, [cancelLinuxDoBrowserHandoff, getWebViewPreparation, linuxDoCookies]);
  const beginLinuxDoCreditSurface = useCallback(
    (mode: 'manual' | 'silent') => beginAuthSurfaceTicket('linuxdo-credit', 'linuxdo', false, mode === 'manual'),
    [beginAuthSurfaceTicket]
  );
  const finishLinuxDoCreditSurface = useCallback(
    (reason: AuthSurfaceCloseReason) =>
      finishAuthSurfaceTicket('linuxdo-credit', reason) ??
      handoffLinuxDoCookies().then(() => ({ status: 'stale' }) as const),
    [finishAuthSurfaceTicket, handoffLinuxDoCookies]
  );
  const canStartLinuxDoCreditSilent = useCallback(() => authSurfaceRegistryRef.current.visible === null, []);
  const prepareLinuxDoCreditSurface = useCallback(() => prepareAuthSurfaceOpenRef.current('linuxdo-credit'), []);
  const readLinuxDoCreditRuntime = useCallback(
    () => readSessionRuntimeSnapshot('linuxdo'),
    [readSessionRuntimeSnapshot]
  );
  const linuxDoCredit = useLinuxDoCreditAuthController({
    appActive,
    beginSurface: beginLinuxDoCreditSurface,
    canStartSilent: canStartLinuxDoCreditSilent,
    finishSurface: finishLinuxDoCreditSurface,
    getUserAgent: getLinuxDoUserAgent,
    notify,
    prepareCookieBarrier: prepareLinuxDoCookieResponseBarrier,
    prepareSurfaceOpen: prepareLinuxDoCreditSurface,
    readRuntime: readLinuxDoCreditRuntime,
    screenActive: screen === 'more',
    surfaceVisible: showLinuxDoCreditPanel
  });
  const mountedLinuxDoCreditWebView = Boolean(linuxDoCredit.panel.document) && !webViewBlockMessage;
  useLayoutEffect(() => {
    linuxDoCookies.observeMount(mountLinuxDoWebView || mountedLinuxDoCreditWebView);
  }, [linuxDoCookies, mountLinuxDoWebView, mountedLinuxDoCreditWebView]);
  const verification = useVerificationController({
    fetcher,
    getLinuxDoSurfaceGeneration,
    onRecoveryStateChanged: setRecoveryPanel,
    getRecoveryScope: getLinuxDoRecoveryScope,
    awaitLinuxDoWebViewUnmount: linuxDoCookies.awaitUnmount,
    awaitLinuxDoCookieHandoff,
    handoffLinuxDoCookies,
    canOpenLinuxDoPanel: () => verificationAppActiveRef.current && enabledSourcesRef.current.includes('linuxdo'),
    changeNodeSeekLoginPanel,
    checkingRequestIdRef,
    closeYaohuoLoginPanel,
    commitLinuxDoWebViewUserAgent,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    isLinuxDoSurfaceVisible: isLinuxDoPanelVisible,
    notify,
    onQueuedLinuxDoLoginCanceled: () => handleClearCredentialLoginIntent('linuxdo'),
    onBeforeLinuxDoSurfaceOpened: () => prepareAuthSurfaceOpenRef.current('linuxdo-login'),
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    onLinuxDoSurfaceClosed: ({ authoritativeResult, reason, parentTraceId }) => {
      handleClearCredentialLoginIntent('linuxdo');
      const initializationIncomplete = !authoritativeResult && reason === 'initialization-incomplete';
      if (
        initializationIncomplete &&
        (authSurfaceRegistryRef.current.active['linuxdo-login'] ||
          authSurfaceRegistryRef.current.active['linuxdo-credit']?.phase === 'reconciling')
      ) {
        beginAccountIdentityCheckRef.current('linuxdo', ++authSurfaceRegistryRef.current.generation);
        applyAccountSessionEventRef.current({
          site: 'linuxdo',
          type: 'check-failed',
          message: '网站登录初始化尚未完成，请重新打开登录页后检测登录。'
        });
      }
      const reconciliation = finishAuthSurfaceTicket(
        'linuxdo-login',
        authoritativeResult ? 'authoritative-recovery' : reason,
        parentTraceId
      );
      const credit = authSurfaceRegistryRef.current.active['linuxdo-credit'];
      if (initializationIncomplete) {
        if (credit?.phase === 'reconciling')
          void handoffLinuxDoCookies(parentTraceId).then(
            () => {
              if (releaseAuthSurface(authSurfaceRegistryRef.current, 'linuxdo-credit', credit.generation))
                refreshAuthSurfaces((revision) => revision + 1);
            },
            () => undefined
          );
        return;
      }
      if (!reconciliation && credit?.phase === 'reconciling' && enabledSourcesRef.current.includes('linuxdo')) {
        // Reading recovery has no account ticket, so it settles the Credit ticket it replaced before resuming.
        linuxDoCookies.reconcileCredit(async () => {
          const registry = authSurfaceRegistryRef.current;
          if (
            registry.active['linuxdo-credit']?.generation !== credit.generation ||
            registry.active['linuxdo-credit']?.phase !== 'reconciling' ||
            isAuthSurfaceVisible(registry, 'linuxdo-login') ||
            Object.values(registry.active).some((active) => active?.source === 'linuxdo' && active.phase === 'open')
          )
            throw new CancelledError();
          const result = await reconcileAccountStatusRef.current('linuxdo', { surfaceGeneration: credit.generation });
          if (result.status === 'unknown') throw new Error(result.error);
          if (result.status === 'stale') throw new CancelledError();
        });
      }
      if (authoritativeResult)
        void awaitLinuxDoCookieHandoff().then(
          () => reading.verified(),
          () => undefined
        );
    },
    onLinuxDoSurfaceOpened: handleLinuxDoSurfaceOpened,
    prepareLinuxDoCookieResponseBarrier,
    reconcileAccountStatus: (source, options) =>
      reconcileAuthSurfaceAccountStatus(source, {
        ...options,
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
  const recoveryScope = getLinuxDoRecoveryScope();
  const previousRecoveryScopeRef = useRef(recoveryScope);
  useEffect(() => {
    if (previousRecoveryScopeRef.current !== recoveryScope && recoveryPanel.phase !== 'idle')
      closeLinuxDoPanel(true, 'navigation-away');
    previousRecoveryScopeRef.current = recoveryScope;
  }, [closeLinuxDoPanel, recoveryScope, recoveryPanel.phase]);
  const showNodeSeekVerification = verification.showNodeSeekVerification;
  const cancelLinuxDoCheckForInactiveApp = verification.cancelLinuxDoCheckForInactiveApp;
  const linuxDoSourceEnabled = enabledSessionSourceSet.has('linuxdo');
  const previousLinuxDoSource = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const owner = authSurfaceLifetimeRef.current.signal;
    const observation = new AbortController();
    if (!linuxDoSourceEnabled) cancelLinuxDoBrowserHandoff();
    linuxDoCookies.cancelHandoff();
    const previous = previousLinuxDoSource.current;
    const reason = previous !== undefined && previous !== linuxDoSourceEnabled ? 'source-change' : 'startup';
    if (contentSourcesReady || previous !== undefined) previousLinuxDoSource.current = linuxDoSourceEnabled;
    void setLinuxDoCookieResponseBarrier(
      !linuxDoSourceEnabled ||
        isAuthSurfaceVisible(authSurfaceRegistryRef.current, 'linuxdo-login') ||
        authSurfaceRegistryRef.current.active['linuxdo-credit']?.phase === 'open',
      reason
    ).catch(() => {
      if (observation.signal.aborted || owner.aborted || authSurfaceLifetimeRef.current.signal !== owner) return;
      notifyRef.current('登录会话交接未完成，请刷新账号页面重试。');
    });
    return () => observation.abort();
  }, [linuxDoSourceEnabled, contentSourcesReady, cancelLinuxDoBrowserHandoff, linuxDoCookies]);
  useEffect(() => {
    if (appActive) return;
    cancelLoginPanelCheck();
    cancelLinuxDoCheckForInactiveApp();
  }, [appActive, cancelLoginPanelCheck, cancelLinuxDoCheckForInactiveApp]);
  const closeNodeImageAuthPanel = nodeImage.panel.close;
  const closeLinuxDoCreditPanel = linuxDoCredit.panel.close;
  const closeAuthSurface = useCallback(
    (surface: AuthSurface, reason: AuthSurfaceCloseReason) => {
      if (surface === 'linuxdo-login') closeLinuxDoPanel(true, reason);
      else if (surface === 'linuxdo-credit') closeLinuxDoCreditPanel(reason);
      else if (surface === 'nodeimage-auth') closeNodeImageAuthPanel(reason);
      else if (surface === 'nodeseek-login') changeNodeSeekLoginPanel(false, reason);
      else closeYaohuoLoginPanel(reason);
    },
    [
      changeNodeSeekLoginPanel,
      closeLinuxDoPanel,
      closeLinuxDoCreditPanel,
      closeNodeImageAuthPanel,
      closeYaohuoLoginPanel
    ]
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
    if (!enabledSessionSourceSet.has('linuxdo')) {
      closeLinuxDoPanel(true, 'source-disabled');
      closeLinuxDoCreditPanel('source-disabled');
    }
  }, [
    changeNodeSeekLoginPanel,
    closeLinuxDoPanel,
    closeLinuxDoCreditPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    enabledSessionSourceSet
  ]);
  const clearLoginState = async (source: SessionSite) => {
    const surface = `${source}-login` as const;
    const preparation = authSurfacePreparationsRef.current[source];
    if (!preparation || !authSurfaceVisible(surface)) return false;
    const ownsClear = status.beginAccountSessionClear(source);
    const isCurrent = () =>
      ownsClear() && authSurfacePreparationsRef.current[source] === preparation && authSurfaceVisible(surface);
    try {
      await preparation.promise;
    } catch {
      if (!isCurrent()) return false;
      throw new Error(preparation.error || '登录会话保存失败，请关闭后重试');
    }
    if (!isCurrent()) return false;
    if (source === 'linuxdo') {
      cancelLinuxDoBrowserHandoff();
      const documentKey = verification.retireLinuxDoWebViewForClear();
      try {
        await Promise.all([linuxDoCookies.awaitUnmount(), setLinuxDoCookieResponseBarrier(true, 'explicit-clear')]);
        return await session.clearLinuxDoLoginState(isCurrent);
      } catch (error) {
        if (authSurfaceVisible(surface)) {
          verification.setLinuxDoWebViewErrorForSession('登录清理未完成，请重新打开登录页后重试。', documentKey);
        }
        throw error;
      }
    }
    return source === 'nodeseek'
      ? session.clearNodeSeekLoginState(isCurrent)
      : session.clearYaohuoLoginState(isCurrent);
  };
  const account = useAccountController({
    checkingRequestIdRef,
    clearLinuxDoLoginState: () => clearLoginState('linuxdo'),
    clearNodeSeekLoginState: () => clearLoginState('nodeseek'),
    clearYaohuoLoginState: () => clearLoginState('yaohuo'),
    commitNodeSeekWebViewUserAgent,
    isAccountCenterFocused,
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
    notify,
    refreshAccountStatus: () => status.refreshAccountStatus({ reconcile: reconcileAccountStatus }),
    setYaohuoLoginPrompt,
    webViewBlockMessage
  });
  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'open-user') {
        await openUser(command.user, command.initialTab);
        return;
      }
      if (command.type === 'refresh' && (!sessionIdentityReady || !status.hydrated)) {
        if (startupRestoreError) retryStartupRestore();
        return;
      }
      await credentials.handleAccountCenterCommand(command);
    },
    [credentials, openUser, retryStartupRestore, sessionIdentityReady, startupRestoreError, status.hydrated]
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
    (message = 'NodeSeek 需要完成 Cloudflare 验证', recovery?: ReadRecovery) => {
      if (recovery && !requestNodeSeekRecovery(recovery)) return;
      showNodeSeekVerification(message);
    },
    [requestNodeSeekRecovery, showNodeSeekVerification]
  );
  const checkNodeSeekLoginAndRetry = useCallback(async () => {
    if (
      loginPanelCheckRef.current ||
      !verificationAppActiveRef.current ||
      !authSurfaceVisible('nodeseek-login') ||
      !enabledSourcesRef.current.includes('nodeseek')
    )
      return false;
    const surface = authSurfaceRegistryRef.current.active['nodeseek-login'];
    if (surface?.phase !== 'open') return false;
    const check: NodeSeekLoginCheck = { source: 'nodeseek', requestId: nodeSeekLoginPanelRequestRef.current };
    publishLoginPanelCheck(check);
    const recovery = beginNodeSeekRecoveryCheck(check);
    const initial = readSessionRuntimeSnapshot('nodeseek');
    const isCurrent = () =>
      ownsLoginPanelCheck(check) &&
      nodeSeekLoginPanelRequestRef.current === check.requestId &&
      verificationAppActiveRef.current &&
      authSurfaceRegistryRef.current.active['nodeseek-login'] === surface &&
      authSurfaceVisible('nodeseek-login') &&
      enabledSourcesRef.current.includes('nodeseek');
    try {
      const accountResult = await account.checkNodeSeekAccount(Boolean(recovery));
      if (!isCurrent() || !ownsNodeSeekRecoveryCheck(check)) return false;
      if (
        accountResult.status === 'changed' ||
        (recovery && readSessionRuntimeSnapshot('nodeseek').identityKey !== initial.identityKey)
      ) {
        changeNodeSeekLoginPanel(false, 'success');
        return false;
      }
      if (accountResult.status !== 'same' && !(recovery && accountResult.status === 'anonymous')) return false;
      if (!recovery) {
        changeNodeSeekLoginPanel(false, 'success');
        return true;
      }
      if (recovery.isCurrent && !recovery.isCurrent()) {
        changeNodeSeekLoginPanel(false, 'success');
        return false;
      }

      // The retained login view can still change Cookies. Only foreground reads may use this observation.
      const signal = beginNodeSeekRecoveryResume(check, {
        identityKey: initial.identityKey,
        sessionEpoch: initial.sessionEpoch,
        surfaceGeneration: surface.generation
      });
      if (!signal) return false;
      const outcome = await recovery.resume(signal);
      if (
        signal.aborted ||
        !isCurrent() ||
        !ownsNodeSeekRecoveryCheck(check) ||
        readSessionRuntimeSnapshot('nodeseek').identityKey !== initial.identityKey ||
        readSessionRuntimeSnapshot('nodeseek').sessionEpoch !== initial.sessionEpoch
      )
        return false;
      if (outcome === 'completed') {
        changeNodeSeekLoginPanel(false, 'success');
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
      if (isCurrent() && ownsNodeSeekRecoveryCheck(check)) notify('NodeSeek 原页面恢复失败：' + errorMessage(error));
      return false;
    } finally {
      if (ownsLoginPanelCheck(check)) {
        publishLoginPanelCheck(null);
        settleNodeSeekRecoveryCheck(check);
      }
    }
  }, [
    account,
    beginNodeSeekRecoveryCheck,
    beginNodeSeekRecoveryResume,
    ownsLoginPanelCheck,
    ownsNodeSeekRecoveryCheck,
    publishLoginPanelCheck,
    settleNodeSeekRecoveryCheck,
    authSurfaceVisible,
    changeNodeSeekLoginPanel,
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
    publishLoginPanelCheck(check);
    try {
      const confirmed = await account.checkYaohuoCookie();
      if (
        !confirmed ||
        !ownsLoginPanelCheck(check) ||
        yaohuoLoginPanelRequestRef.current !== check.requestId ||
        !verificationAppActiveRef.current ||
        !authSurfaceVisible('yaohuo-login') ||
        !enabledSourcesRef.current.includes('yaohuo')
      )
        return false;
      closeYaohuoLoginPanel('success');
      return true;
    } finally {
      if (ownsLoginPanelCheck(check)) publishLoginPanelCheck(null);
    }
  }, [account, authSurfaceVisible, closeYaohuoLoginPanel, ownsLoginPanelCheck, publishLoginPanelCheck]);
  const closePanels = useCallback(() => {
    changeNodeSeekLoginPanel(false, 'navigation-away');
    closeNodeImageAuthPanel('navigation-away');
    closeYaohuoLoginPanel('navigation-away');
    closeLinuxDoPanel(true, 'navigation-away');
    closeLinuxDoCreditPanel('navigation-away');
  }, [
    changeNodeSeekLoginPanel,
    closeLinuxDoPanel,
    closeLinuxDoCreditPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel
  ]);
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
  const readAttendance = useCallback(
    async (ticket: WritableSessionTicket, signal: AbortSignal) => {
      if (signal.aborted || !isWritableSessionTicketCurrent(ticket)) throw new CancelledError();
      const options = nodeSeekAttendanceQuery({
        gateway: readGateway,
        userId: ticket.identityKey.slice('nodeseek:'.length),
        sessionEpoch: ticket.sessionEpoch,
        plan: readGateway.getReadPlan(ticket.source, 'account-data')
      });
      const cancel = () => appQueryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
      // The mutation needs a GET started after this check, even when the account page is already refreshing.
      await cancel();
      if (signal.aborted || !isWritableSessionTicketCurrent(ticket)) throw new CancelledError();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        return await appQueryClient.fetchQuery({ ...options, staleTime: 0 });
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    [isWritableSessionTicketCurrent, readGateway]
  );
  const onAttendanceConfirmed = useCallback(
    (ticket: WritableSessionTicket, current?: number) => {
      if (!isWritableSessionTicketCurrent(ticket)) return;
      const userId = ticket.identityKey.slice('nodeseek:'.length);
      const readPlanScope = readGateway.getReadPlan(ticket.source, 'account-data').cacheScope;
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
    [isWritableSessionTicketCurrent, readGateway]
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
    getNodeSeekUserAgent,
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
    authSurfaceBlockMessages: Object.fromEntries(
      sessionSources.map((source) => [source, authSurfaceBlockMessage(source)])
    ),
    credentials,
    loginNavigation,
    linuxDoCredit,
    nodeImage,
    session,
    status,
    verification,
    view: {
      checking: checking || loginPanelCheck !== null,
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
      notificationFetcher: session.nodeSeekFetchWithWebViewFallback,
      notificationPrivateAccessAllowed,
      readGateway,
      reconcileAccountStatus,
      sessionsReady: status.hydrated,
      statusBusy: status.statusBusy
    },
    write: {
      ensureNodeImageApiKey: nodeImage.ensureApiKey,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      onSessionExpired: handleSessionExpired,
      requestAccountRecheck
    },
    center: {
      linuxDoCredit: {
        open: linuxDoCredit.open,
        connectSilently: linuxDoCredit.connectSilently,
        busy: linuxDoCredit.busy
      },
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
      nodeImage: { key: nodeImage.key }
    },
    hosts: {
      startupRecovery: startupRestoreError
        ? createElement(RecoverableEmptyState, {
            message: startupRestoreError,
            actionLabel: '重试启动',
            onAction: retryStartupRestore
          })
        : null,
      closePanels,
      closeTopmostSurface,
      element: hostElement,
      linuxDoVerificationVisible: linuxDoPanelVisible,
      showYaohuoLogin,
      requestNodeSeekVerification,
      showLinuxDoVerification: verification.showLinuxDoVerification,
      surfaces: {
        linuxdo: linuxDoPanelVisible || showLinuxDoCreditPanel,
        linuxdoCredit: showLinuxDoCreditPanel,
        nodeseek: showLoginPanel,
        yaohuo: showYaohuoLoginPanel
      }
    }
  };
}
