import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type WebView, type WebViewMessageEvent } from 'react-native-webview';
import { sanitizeNodeSeekUserAgent } from '../nodeseekSession';
import { errorMessage, isLinuxDoCloudflareError } from '../appUtils';
import type { SourceGateway } from '../sources/sourceGateway';
import type { Screen } from '../appTypes';
import { sourceReadRecoveryOutcome } from '../sourceErrors';
import { shouldOpenLoginWebViewUrl } from '../loginWebViewNavigation';
import type { LoginWebViewFailureReason } from './accountCredentialDiagnostics';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import { forumQueryKeys, type ForumSessionEpochs } from './serverState';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import { useCommitRefValue } from './useCommittedRef';
import type { AccountReconcileResult } from './useAccountStatusController';

const NODESEEK_MESSAGE_HOSTS = ['nodeseek.com'];

type Ref<T> = MutableRefObject<T>;
export type LoginWebViewDiagnosticState = 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout';
type AccountSource = 'nodeseek' | 'yaohuo';

type LoginTraceState = {
  trace: DiagnosticTrace;
  panelRequestId: number;
};

function webViewFailureReason(state: LoginWebViewDiagnosticState): LoginWebViewFailureReason {
  return state === 'renderer-gone'
    ? 'renderer_gone'
    : state === 'timeout'
      ? 'timeout'
      : 'network_error';
}

export function useAccountController({
  checkingRequestIdRef,
  clearLinuxDoLoginState,
  clearNodeSeekLoginState,
  clearYaohuoLoginState,
  sessionEpochs,
  nodeSeekLoginPanelRequestRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  onLoginWebViewFailure,
  linuxDoVerificationActive,
  linuxDoIdentityPending = false,
  resetLinuxDoLevelState,
  resetLinuxDoWebView,
  reconcileAccountStatus,
  setChecking,
  setNodeSeekWebViewUserAgent,
  screen,
  showLinuxDoVerification,
  sourceGateway,
  showLoginPanelRef,
  showYaohuoLoginPanel,
  webViewRef,
  yaohuoLoginPanelRequestRef,
  yaohuoWebViewRef
}: {
  checkingRequestIdRef: Ref<number>;
  clearLinuxDoLoginState: () => Promise<boolean>;
  clearNodeSeekLoginState: () => Promise<boolean>;
  clearYaohuoLoginState: () => Promise<boolean>;
  sessionEpochs: ForumSessionEpochs;
  nodeSeekLoginPanelRequestRef: Ref<number>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (
    site: AccountSource,
    attempt: number,
    reason: LoginWebViewFailureReason
  ) => void;
  linuxDoVerificationActive: boolean;
  linuxDoIdentityPending?: boolean;
  resetLinuxDoLevelState: () => void;
  resetLinuxDoWebView: () => void;
  reconcileAccountStatus: (source: AccountSource) => Promise<AccountReconcileResult>;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  screen: Screen;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  sourceGateway: Pick<SourceGateway, 'getLinuxDoLevelProfile'>;
  showLoginPanelRef: Ref<boolean>;
  showYaohuoLoginPanel: boolean;
  webViewRef: Ref<WebView | null>;
  yaohuoLoginPanelRequestRef: Ref<number>;
  yaohuoWebViewRef: Ref<WebView | null>;
}) {
  const queryClient = useQueryClient();
  const nodeSeekLoginTraceRef = useRef<LoginTraceState | null>(null);
  const nodeSeekTerminalRequestRef = useRef<number | null>(null);
  const wasNodeSeekLoginPanelVisibleRef = useRef(false);
  const yaohuoLoginTraceRef = useRef<LoginTraceState | null>(null);
  const yaohuoTerminalRequestRef = useRef<number | null>(null);
  const wasYaohuoLoginPanelVisibleRef = useRef(false);
  const observedYaohuoLoginPanelRequestRef = useRef(yaohuoLoginPanelRequestRef.current);
  const [linuxDoLevelRequested, setLinuxDoLevelRequested] = useState(false);
  const linuxDoLevelCommandRef = useRef<{ resolve: (completed: boolean) => void } | null>(null);
  const linuxDoLevelRecoveryRef = useRef<LinuxDoReadRecovery | null>(null);
  const linuxDoLevelRequestedRef = useRef(false);
  const linuxDoLevelWaitingForVerificationRef = useRef(false);
  const linuxDoLevelScreenRef = useRef(screen);
  const linuxDoVerificationWasActiveRef = useRef(linuxDoVerificationActive);
  useCommitRefValue(linuxDoLevelScreenRef, screen);

  const linuxDoLevelQueryKey = forumQueryKeys.levelProfile({
    sessionEpochs,
    source: 'linuxdo'
  });
  const linuxDoLevelQuery = useQuery({
    enabled: screen === 'more' && linuxDoLevelRequested && !linuxDoIdentityPending,
    queryKey: linuxDoLevelQueryKey,
    queryFn: ({ signal }) => sourceGateway.getLinuxDoLevelProfile({
      source: 'linuxdo',
      signal
    }),
    retryOnMount: false
  });

  const finishLinuxDoLevelRequest = useCallback(() => {
    linuxDoLevelRecoveryRef.current = null;
    linuxDoLevelRequestedRef.current = false;
    linuxDoLevelWaitingForVerificationRef.current = false;
    setLinuxDoLevelRequested(false);
  }, []);

  const cancelLinuxDoLevelRequest = useCallback(() => {
    const command = linuxDoLevelCommandRef.current;
    linuxDoLevelCommandRef.current = null;
    command?.resolve(false);
    finishLinuxDoLevelRequest();
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum'
        && queryKey[1] === 'linuxdo'
        && queryKey[2] === 'level'
    });
  }, [finishLinuxDoLevelRequest, queryClient]);

  useEffect(() => {
    if (screen !== 'more') {
      cancelLinuxDoLevelRequest();
    }
  }, [cancelLinuxDoLevelRequest, screen]);

  useEffect(() => {
    const wasActive = linuxDoVerificationWasActiveRef.current;
    linuxDoVerificationWasActiveRef.current = linuxDoVerificationActive;
    if (
      wasActive
      && !linuxDoVerificationActive
      && linuxDoLevelRequestedRef.current
      && linuxDoLevelWaitingForVerificationRef.current
    ) {
      cancelLinuxDoLevelRequest();
    }
  }, [cancelLinuxDoLevelRequest, linuxDoVerificationActive]);

  useEffect(() => {
    const command = linuxDoLevelCommandRef.current;
    if (!command || linuxDoLevelQuery.isFetching || linuxDoLevelQuery.status === 'pending') {
      return;
    }
    linuxDoLevelCommandRef.current = null;
    if (linuxDoLevelScreenRef.current !== 'more' || !linuxDoLevelRequestedRef.current) {
      command.resolve(false);
      cancelLinuxDoLevelRequest();
      return;
    }
    if (!linuxDoLevelQuery.error) {
      const completed = Boolean(linuxDoLevelQuery.data);
      finishLinuxDoLevelRequest();
      if (completed) {
        notify('linux.do 等级已更新。');
      }
      command.resolve(completed);
      return;
    }
    command.resolve(false);
    if (!isLinuxDoCloudflareError(linuxDoLevelQuery.error)) {
      finishLinuxDoLevelRequest();
      return;
    }

    linuxDoLevelWaitingForVerificationRef.current = true;
    const recovery: LinuxDoReadRecovery = {
      queryKey: linuxDoLevelQueryKey,
      resume: async (): Promise<LinuxDoReadResumeOutcome> => {
        if (
          linuxDoLevelRecoveryRef.current !== recovery
          || !linuxDoLevelRequestedRef.current
          || linuxDoLevelScreenRef.current !== 'more'
        ) {
          return 'stale';
        }
        const result = await linuxDoLevelQuery.refetch({ cancelRefetch: false });
        if (
          linuxDoLevelRecoveryRef.current !== recovery
          || !linuxDoLevelRequestedRef.current
          || linuxDoLevelScreenRef.current !== 'more'
        ) {
          return 'stale';
        }
        if (result.error) {
          if (isLinuxDoCloudflareError(result.error)) {
            return 'verification-required';
          }
          finishLinuxDoLevelRequest();
          return sourceReadRecoveryOutcome('linuxdo', result.error);
        }
        const completed = Boolean(result.data);
        finishLinuxDoLevelRequest();
        if (completed) {
          notify('linux.do 等级已更新。');
          return 'completed';
        }
        return 'failed';
      }
    };
    linuxDoLevelRecoveryRef.current = recovery;
    let showing: ReturnType<typeof showLinuxDoVerification>;
    try {
      showing = showLinuxDoVerification(
        'linux.do 等级读取需要完成 Cloudflare 验证',
        recovery
      );
    } catch {
      cancelLinuxDoLevelRequest();
      return;
    }
    void Promise.resolve(showing).then((accepted) => {
      if (accepted === false && linuxDoLevelRecoveryRef.current === recovery) {
        cancelLinuxDoLevelRequest();
      }
    }, () => {
      if (linuxDoLevelRecoveryRef.current === recovery) {
        cancelLinuxDoLevelRequest();
      }
    });
  }, [
    cancelLinuxDoLevelRequest,
    finishLinuxDoLevelRequest,
    linuxDoLevelQuery.data,
    linuxDoLevelQuery.error,
    linuxDoLevelQuery.isFetching,
    linuxDoLevelQuery.refetch,
    linuxDoLevelQuery.status,
    linuxDoLevelQueryKey,
    notify,
    showLinuxDoVerification
  ]);

  const finishLoginTrace = useCallback((
    source: AccountSource,
    trace: DiagnosticTrace,
    outcome: Parameters<typeof finishDiagnosticTrace>[1],
    fields: Record<string, unknown> = {}
  ) => {
    const traceRef = source === 'nodeseek' ? nodeSeekLoginTraceRef : yaohuoLoginTraceRef;
    if (traceRef.current?.trace !== trace) {
      return;
    }
    finishDiagnosticTrace(trace, outcome, { source, ...fields });
    traceRef.current = null;
  }, []);

  const currentLoginTrace = useCallback((source: AccountSource, mode: 'open' | 'manual') => {
    const panelRequestId = source === 'nodeseek'
      ? nodeSeekLoginPanelRequestRef.current
      : yaohuoLoginPanelRequestRef.current;
    const traceRef = source === 'nodeseek' ? nodeSeekLoginTraceRef : yaohuoLoginTraceRef;
    if (traceRef.current?.panelRequestId === panelRequestId) {
      return traceRef.current.trace;
    }
    if (traceRef.current) {
      finishDiagnosticTrace(traceRef.current.trace, 'stale', {
        source,
        reason: 'superseded'
      });
    }
    const trace = beginDiagnosticTrace('credential', 'check', { source, mode });
    traceRef.current = { trace, panelRequestId };
    return trace;
  }, [nodeSeekLoginPanelRequestRef, yaohuoLoginPanelRequestRef]);

  useEffect(() => {
    const visible = showLoginPanelRef.current;
    if (visible && !wasNodeSeekLoginPanelVisibleRef.current) {
      markDiagnosticStage(currentLoginTrace('nodeseek', 'open'), 'guard', {
        source: 'nodeseek',
        state: 'open'
      });
    } else if (!visible && wasNodeSeekLoginPanelVisibleRef.current) {
      const trace = nodeSeekLoginTraceRef.current?.trace;
      if (trace) {
        finishLoginTrace('nodeseek', trace, 'canceled', { reason: 'canceled' });
      }
    }
    wasNodeSeekLoginPanelVisibleRef.current = visible;
  });

  useEffect(() => {
    const panelRequestId = yaohuoLoginPanelRequestRef.current;
    const openedOrReplaced = showYaohuoLoginPanel && (
      !wasYaohuoLoginPanelVisibleRef.current
      || observedYaohuoLoginPanelRequestRef.current !== panelRequestId
    );
    if (openedOrReplaced) {
      markDiagnosticStage(currentLoginTrace('yaohuo', 'open'), 'guard', {
        source: 'yaohuo',
        state: 'open'
      });
    } else if (!showYaohuoLoginPanel && wasYaohuoLoginPanelVisibleRef.current) {
      const trace = yaohuoLoginTraceRef.current?.trace;
      if (trace) {
        finishLoginTrace('yaohuo', trace, 'canceled', { reason: 'canceled' });
      }
    }
    observedYaohuoLoginPanelRequestRef.current = panelRequestId;
    wasYaohuoLoginPanelVisibleRef.current = showYaohuoLoginPanel;
  });

  const recordLoginWebViewState = useCallback((
    source: AccountSource,
    state: LoginWebViewDiagnosticState,
    attempt: number
  ) => {
    const requestId = source === 'nodeseek'
      ? nodeSeekLoginPanelRequestRef.current
      : yaohuoLoginPanelRequestRef.current;
    const terminalRef = source === 'nodeseek'
      ? nodeSeekTerminalRequestRef
      : yaohuoTerminalRequestRef;
    if (state === 'start' && terminalRef.current === requestId) {
      terminalRef.current = null;
    } else if (terminalRef.current === requestId) {
      return;
    }
    const trace = currentLoginTrace(source, 'open');
    if (state === 'error' || state === 'renderer-gone' || state === 'timeout') {
      terminalRef.current = requestId;
      const reason = webViewFailureReason(state);
      markDiagnosticStage(trace, 'transport', {
        source,
        channel: 'webview',
        state: 'failure',
        reason
      });
      finishLoginTrace(source, trace, 'failure', { reason });
      onLoginWebViewFailure(source, attempt, reason);
      return;
    }
    markDiagnosticStage(trace, 'transport', {
      source,
      channel: 'webview',
      state: state === 'start' ? 'started' : 'ready'
    });
  }, [
    currentLoginTrace,
    finishLoginTrace,
    nodeSeekLoginPanelRequestRef,
    onLoginWebViewFailure,
    yaohuoLoginPanelRequestRef
  ]);

  const recordNodeSeekLoginWebViewState = useCallback((
    state: LoginWebViewDiagnosticState,
    attempt = 0
  ) => recordLoginWebViewState('nodeseek', state, attempt), [recordLoginWebViewState]);

  const recordYaohuoLoginWebViewState = useCallback((
    state: LoginWebViewDiagnosticState,
    attempt = 0
  ) => recordLoginWebViewState('yaohuo', state, attempt), [recordLoginWebViewState]);

  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        userAgent?: string;
      };
      if (
        data.type !== 'nodeseek-login'
        || !shouldOpenLoginWebViewUrl(event.nativeEvent.url, NODESEEK_MESSAGE_HOSTS)
      ) {
        return;
      }
      const trace = currentLoginTrace('nodeseek', 'open');
      markDiagnosticStage(trace, 'parse', {
        source: 'nodeseek',
        messageRecognized: true,
        userAgentSource: typeof data.userAgent === 'string' ? 'webview' : 'default'
      });
      const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
      if (userAgent) {
        nodeSeekWebViewUserAgentRef.current = userAgent;
        setNodeSeekWebViewUserAgent(userAgent);
      }
    } catch {
      // Ignore unrelated page messages.
    }
  }, [
    currentLoginTrace,
    nodeSeekWebViewUserAgentRef,
    setNodeSeekWebViewUserAgent
  ]);

  const checkAccount = useCallback(async (source: AccountSource) => {
    const trace = currentLoginTrace(source, 'manual');
    const requestId = ++checkingRequestIdRef.current;
    setChecking(true);
    try {
      const result = await reconcileAccountStatus(source);
      if (requestId !== checkingRequestIdRef.current || result.status === 'stale') {
        finishLoginTrace(source, trace, 'stale', { reason: 'stale' });
        return { status: 'stale' } as const;
      }
      if (result.status === 'unknown') {
        notify(result.error || `${source === 'nodeseek' ? 'NodeSeek' : '妖火'}登录状态暂时无法确认，请重试。`);
        finishLoginTrace(source, trace, 'failure', { reason: 'unknown' });
        return result;
      }
      if (result.status === 'anonymous') {
        notify(`${source === 'nodeseek' ? 'NodeSeek' : '妖火'}当前未登录。`);
        finishLoginTrace(source, trace, 'blocked', { reason: 'login_required' });
        return result;
      }
      notify(`已确认${source === 'nodeseek' ? ' NodeSeek' : '妖火'}当前账号。`);
      finishLoginTrace(source, trace, 'success', {
        identityChanged: result.status === 'changed'
      });
      return result;
    } catch (error) {
      const message = errorMessage(error);
      if (requestId === checkingRequestIdRef.current) {
        notify(message);
        finishLoginTrace(source, trace, 'failure', {
          reason: normalizeDiagnosticReason(error)
        });
      } else {
        finishLoginTrace(source, trace, 'stale', { reason: 'stale' });
      }
      return { status: 'unknown', error: message } as const;
    } finally {
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [
    checkingRequestIdRef,
    currentLoginTrace,
    finishLoginTrace,
    notify,
    reconcileAccountStatus,
    setChecking
  ]);

  const checkLogin = useCallback(
    async () => {
      const result = await checkAccount('nodeseek');
      return result.status === 'same' || result.status === 'changed';
    },
    [checkAccount]
  );
  const checkNodeSeekAccount = useCallback(
    () => checkAccount('nodeseek'),
    [checkAccount]
  );
  const checkYaohuoCookie = useCallback(
    async () => {
      const result = await checkAccount('yaohuo');
      return result.status === 'same' || result.status === 'changed';
    },
    [checkAccount]
  );

  const clearLogin = useCallback(async () => {
    try {
      if (!await clearNodeSeekLoginState()) {
        return;
      }
      webViewRef.current?.reload();
      notify('已清除 NodeSeek 登录 Cookie，访问验证 Cookie 保持不变。');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [clearNodeSeekLoginState, notify, webViewRef]);

  const clearYaohuoLogin = useCallback(async () => {
    try {
      if (!await clearYaohuoLoginState()) {
        return;
      }
      yaohuoWebViewRef.current?.reload();
      notify('已清除妖火登录 Cookie。');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [clearYaohuoLoginState, notify, yaohuoWebViewRef]);

  const clearLinuxDoCookie = useCallback(async () => {
    try {
      if (!await clearLinuxDoLoginState()) {
        return;
      }
      resetLinuxDoLevelState();
      resetLinuxDoWebView();
      notify('已清除 linux.do 登录 Cookie，访问验证 Cookie 保持不变。');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [
    clearLinuxDoLoginState,
    notify,
    resetLinuxDoLevelState,
    resetLinuxDoWebView
  ]);

  const refreshLinuxDoLevel = useCallback(() => {
    if (
      linuxDoIdentityPending
      || linuxDoLevelScreenRef.current !== 'more'
      || linuxDoLevelRequestedRef.current
    ) {
      return Promise.resolve(false);
    }
    linuxDoLevelRequestedRef.current = true;
    linuxDoLevelWaitingForVerificationRef.current = false;
    linuxDoLevelRecoveryRef.current = null;
    void queryClient.invalidateQueries({
      exact: true,
      queryKey: linuxDoLevelQueryKey,
      refetchType: 'none'
    });
    setLinuxDoLevelRequested(true);
    return new Promise<boolean>((resolve) => {
      linuxDoLevelCommandRef.current = { resolve };
    });
  }, [linuxDoIdentityPending, linuxDoLevelQueryKey, queryClient]);

  return {
    checkLogin,
    checkNodeSeekAccount,
    checkYaohuoCookie,
    clearLinuxDoCookie,
    clearLogin,
    clearYaohuoLogin,
    handleLoginMessage,
    recordNodeSeekLoginWebViewState,
    recordYaohuoLoginWebViewState,
    linuxDoLevelBusy: linuxDoLevelQuery.isFetching,
    linuxDoLevelError: linuxDoLevelQuery.error
      ? (isLinuxDoCloudflareError(linuxDoLevelQuery.error)
        ? 'linux.do 等级读取需要完成 Cloudflare 验证'
        : errorMessage(linuxDoLevelQuery.error))
      : '',
    linuxDoLevelProfile: linuxDoLevelQuery.data ?? null,
    refreshLinuxDoLevel
  };
}
