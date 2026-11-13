import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type WebView, type WebViewMessageEvent } from 'react-native-webview';
import { sanitizeWebViewUserAgent } from '@/platform/android/userAgent';
import { errorMessage } from '@/platform/network/errors';
import { isLinuxDoCloudflareError } from '@/sources/errors';
import type { ReadGateway } from '@/sources/readGateway';
import type { Screen } from '@/ui/navigation/types';
import { sourceReadRecoveryOutcome } from '@/sources/sourceErrors';
import { shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import type { LoginWebViewFailureReason } from './credentialDiagnostics';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type {
  LinuxDoReadRecovery,
  LinuxDoReadResumeOutcome,
  AccountReconcileResult
} from '@/domain/session/sessionContracts';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';

const NODESEEK_MESSAGE_HOSTS = ['nodeseek.com'];

type Ref<T> = RefObject<T>;
export type LoginWebViewDiagnosticState = 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout' | 'auto-check';
type AccountSource = 'nodeseek' | 'yaohuo';

type LoginTraceState = {
  trace: DiagnosticTrace;
  panelRequestId: number;
};
type LinuxDoLevelRequest =
  { kind: 'command'; resolve: (completed: boolean) => void } | { kind: 'verification'; recovery: LinuxDoReadRecovery };

function webViewFailureReason(state: LoginWebViewDiagnosticState): LoginWebViewFailureReason {
  return state === 'renderer-gone' ? 'renderer_gone' : state === 'timeout' ? 'timeout' : 'network_error';
}

export function useAccountController({
  checkingRequestIdRef,
  clearLinuxDoLoginState,
  clearNodeSeekLoginState,
  clearYaohuoLoginState,
  commitNodeSeekWebViewUserAgent,
  sessionEpochs,
  nodeSeekLoginPanelRequestRef,
  notify,
  onLoginWebViewFailure,
  linuxDoVerificationActive,
  linuxDoIdentityPending = false,
  resetLinuxDoLevelState,
  resetLinuxDoWebView,
  reconcileAccountStatus,
  setChecking,
  screen,
  showLinuxDoVerification,
  readGateway,
  showLoginPanel,
  showYaohuoLoginPanel,
  webViewRef,
  yaohuoLoginPanelRequestRef,
  yaohuoWebViewRef
}: {
  checkingRequestIdRef: Ref<number>;
  clearLinuxDoLoginState: () => Promise<boolean>;
  clearNodeSeekLoginState: () => Promise<boolean>;
  clearYaohuoLoginState: () => Promise<boolean>;
  commitNodeSeekWebViewUserAgent: (userAgent: string) => void;
  sessionEpochs: ForumSessionEpochs;
  nodeSeekLoginPanelRequestRef: Ref<number>;
  notify: (message: string) => void;
  onLoginWebViewFailure: (site: AccountSource, attempt: number, reason: LoginWebViewFailureReason) => void;
  linuxDoVerificationActive: boolean;
  linuxDoIdentityPending?: boolean;
  resetLinuxDoLevelState: () => void;
  resetLinuxDoWebView: () => void;
  reconcileAccountStatus: (
    source: AccountSource,
    options?: { publishAnonymous?: boolean }
  ) => Promise<AccountReconcileResult>;
  setChecking: Dispatch<SetStateAction<boolean>>;
  screen: Screen;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  readGateway: Pick<ReadGateway, 'getLinuxDoLevelProfile'>;
  showLoginPanel: boolean;
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
  const observedYaohuoLoginPanelRequestRef = useRef<number | null>(null);
  const [linuxDoLevelRequest, setLinuxDoLevelRequest] = useState<LinuxDoLevelRequest | null>(null);
  const linuxDoLevelRequestRef = useRef<LinuxDoLevelRequest | null>(null);
  const linuxDoLevelScreenRef = useRef(screen);
  const linuxDoVerificationWasActiveRef = useRef(linuxDoVerificationActive);
  useCommitRefValue(linuxDoLevelScreenRef, screen);

  const linuxDoLevelQueryKey = forumQueryKeys.levelProfile({
    sessionEpochs,
    source: 'linuxdo'
  });
  const linuxDoLevelQuery = useQuery({
    enabled: screen === 'more' && Boolean(linuxDoLevelRequest) && !linuxDoIdentityPending,
    queryKey: linuxDoLevelQueryKey,
    queryFn: ({ signal }) =>
      readGateway.getLinuxDoLevelProfile({
        source: 'linuxdo',
        signal
      }),
    retryOnMount: false
  });

  const finishLinuxDoLevelRequest = useCallback(() => {
    linuxDoLevelRequestRef.current = null;
    setLinuxDoLevelRequest(null);
  }, []);

  const cancelLinuxDoLevelRequest = useCallback(() => {
    const request = linuxDoLevelRequestRef.current;
    finishLinuxDoLevelRequest();
    if (request?.kind === 'command') request.resolve(false);
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === 'linuxdo' && queryKey[2] === 'level'
    });
  }, [finishLinuxDoLevelRequest, queryClient]);

  useEffect(() => () => cancelLinuxDoLevelRequest(), [cancelLinuxDoLevelRequest]);

  useEffect(() => {
    if (screen !== 'more') {
      cancelLinuxDoLevelRequest();
    }
  }, [cancelLinuxDoLevelRequest, screen]);

  useEffect(() => {
    const wasActive = linuxDoVerificationWasActiveRef.current;
    linuxDoVerificationWasActiveRef.current = linuxDoVerificationActive;
    if (wasActive && !linuxDoVerificationActive && linuxDoLevelRequestRef.current?.kind === 'verification') {
      cancelLinuxDoLevelRequest();
    }
  }, [cancelLinuxDoLevelRequest, linuxDoVerificationActive]);

  useEffect(() => {
    const command = linuxDoLevelRequestRef.current;
    if (command?.kind !== 'command' || linuxDoLevelQuery.isFetching || linuxDoLevelQuery.status === 'pending') {
      return;
    }
    if (linuxDoLevelScreenRef.current !== 'more') {
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

    const recovery: LinuxDoReadRecovery = {
      queryKey: linuxDoLevelQueryKey,
      resume: async (): Promise<LinuxDoReadResumeOutcome> => {
        if (
          linuxDoLevelRequestRef.current?.kind !== 'verification' ||
          linuxDoLevelRequestRef.current.recovery !== recovery ||
          linuxDoLevelScreenRef.current !== 'more'
        ) {
          return 'stale';
        }
        const result = await linuxDoLevelQuery.refetch({ cancelRefetch: false });
        if (
          linuxDoLevelRequestRef.current?.kind !== 'verification' ||
          linuxDoLevelRequestRef.current.recovery !== recovery ||
          linuxDoLevelScreenRef.current !== 'more'
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
    const request: LinuxDoLevelRequest = { kind: 'verification', recovery };
    linuxDoLevelRequestRef.current = request;
    setLinuxDoLevelRequest(request);
    let showing: ReturnType<typeof showLinuxDoVerification>;
    try {
      showing = showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证', recovery);
    } catch {
      cancelLinuxDoLevelRequest();
      return;
    }
    void Promise.resolve(showing).then(
      (accepted) => {
        if (accepted === false && linuxDoLevelRequestRef.current === request) {
          cancelLinuxDoLevelRequest();
        }
      },
      () => {
        if (linuxDoLevelRequestRef.current === request) {
          cancelLinuxDoLevelRequest();
        }
      }
    );
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

  const finishLoginTrace = useCallback(
    (
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
    },
    []
  );

  const currentLoginTrace = useCallback(
    (source: AccountSource, mode: 'open' | 'manual') => {
      const panelRequestId =
        source === 'nodeseek' ? nodeSeekLoginPanelRequestRef.current : yaohuoLoginPanelRequestRef.current;
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
    },
    [nodeSeekLoginPanelRequestRef, yaohuoLoginPanelRequestRef]
  );

  useEffect(() => {
    const visible = showLoginPanel;
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
  }, [currentLoginTrace, finishLoginTrace, showLoginPanel]);

  useEffect(() => {
    const panelRequestId = yaohuoLoginPanelRequestRef.current;
    const openedOrReplaced = showYaohuoLoginPanel && observedYaohuoLoginPanelRequestRef.current !== panelRequestId;
    if (openedOrReplaced) {
      markDiagnosticStage(currentLoginTrace('yaohuo', 'open'), 'guard', {
        source: 'yaohuo',
        state: 'open'
      });
    } else if (!showYaohuoLoginPanel && observedYaohuoLoginPanelRequestRef.current !== null) {
      const trace = yaohuoLoginTraceRef.current?.trace;
      if (trace) {
        finishLoginTrace('yaohuo', trace, 'canceled', { reason: 'canceled' });
      }
    }
    observedYaohuoLoginPanelRequestRef.current = showYaohuoLoginPanel ? panelRequestId : null;
  });

  const recordLoginWebViewState = useCallback(
    (source: AccountSource, state: LoginWebViewDiagnosticState, attempt: number) => {
      const requestId =
        source === 'nodeseek' ? nodeSeekLoginPanelRequestRef.current : yaohuoLoginPanelRequestRef.current;
      const terminalRef = source === 'nodeseek' ? nodeSeekTerminalRequestRef : yaohuoTerminalRequestRef;
      if (state === 'start' && terminalRef.current === requestId) {
        terminalRef.current = null;
      } else if (terminalRef.current === requestId) {
        return;
      }
      const trace = currentLoginTrace(source, 'open');
      if (state === 'auto-check') {
        markDiagnosticStage(trace, 'parse', { source, channel: 'webview', verificationAction: 'auto-check' });
        return;
      }
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
    },
    [
      currentLoginTrace,
      finishLoginTrace,
      nodeSeekLoginPanelRequestRef,
      onLoginWebViewFailure,
      yaohuoLoginPanelRequestRef
    ]
  );

  const recordNodeSeekLoginWebViewState = useCallback(
    (state: LoginWebViewDiagnosticState, attempt = 0) => recordLoginWebViewState('nodeseek', state, attempt),
    [recordLoginWebViewState]
  );

  const recordYaohuoLoginWebViewState = useCallback(
    (state: LoginWebViewDiagnosticState, attempt = 0) => recordLoginWebViewState('yaohuo', state, attempt),
    [recordLoginWebViewState]
  );

  const handleLoginMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          userAgent?: string;
        };
        if (
          data.type !== 'nodeseek-login' ||
          !shouldOpenLoginWebViewUrl(event.nativeEvent.url, NODESEEK_MESSAGE_HOSTS)
        ) {
          return;
        }
        const trace = currentLoginTrace('nodeseek', 'open');
        markDiagnosticStage(trace, 'parse', {
          source: 'nodeseek',
          messageRecognized: true,
          userAgentSource: typeof data.userAgent === 'string' ? 'webview' : 'default'
        });
        const userAgent = sanitizeWebViewUserAgent(data.userAgent);
        if (userAgent) {
          commitNodeSeekWebViewUserAgent(userAgent);
        }
      } catch {
        // Ignore unrelated page messages.
      }
    },
    [commitNodeSeekWebViewUserAgent, currentLoginTrace]
  );

  const checkAccount = useCallback(
    async (source: AccountSource, allowAnonymous = false) => {
      const trace = currentLoginTrace(source, 'manual');
      const requestId = ++checkingRequestIdRef.current;
      setChecking(true);
      try {
        const result = await (allowAnonymous
          ? reconcileAccountStatus(source, { publishAnonymous: true })
          : reconcileAccountStatus(source));
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
          if (!allowAnonymous) notify(`${source === 'nodeseek' ? 'NodeSeek' : '妖火'}当前未登录。`);
          finishLoginTrace(
            source,
            trace,
            allowAnonymous ? 'success' : 'blocked',
            allowAnonymous ? {} : { reason: 'login_required' }
          );
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
    },
    [checkingRequestIdRef, currentLoginTrace, finishLoginTrace, notify, reconcileAccountStatus, setChecking]
  );

  const checkNodeSeekAccount = useCallback(
    (allowAnonymous = false) => checkAccount('nodeseek', allowAnonymous),
    [checkAccount]
  );
  const checkYaohuoCookie = useCallback(async () => {
    const result = await checkAccount('yaohuo');
    return result.status === 'same' || result.status === 'changed';
  }, [checkAccount]);

  const clearLogin = useCallback(async () => {
    try {
      if (!(await clearNodeSeekLoginState())) {
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
      if (!(await clearYaohuoLoginState())) {
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
      if (!(await clearLinuxDoLoginState())) {
        return;
      }
      resetLinuxDoLevelState();
      resetLinuxDoWebView();
      notify('已清除 linux.do 登录 Cookie，访问验证 Cookie 保持不变。');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [clearLinuxDoLoginState, notify, resetLinuxDoLevelState, resetLinuxDoWebView]);

  const refreshLinuxDoLevel = useCallback(() => {
    if (linuxDoIdentityPending || linuxDoLevelScreenRef.current !== 'more' || linuxDoLevelRequestRef.current) {
      return Promise.resolve(false);
    }
    void queryClient.invalidateQueries({
      exact: true,
      queryKey: linuxDoLevelQueryKey,
      refetchType: 'none'
    });
    return new Promise<boolean>((resolve) => {
      const request: LinuxDoLevelRequest = { kind: 'command', resolve };
      linuxDoLevelRequestRef.current = request;
      setLinuxDoLevelRequest(request);
    });
  }, [linuxDoIdentityPending, linuxDoLevelQueryKey, queryClient]);

  return {
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
      ? isLinuxDoCloudflareError(linuxDoLevelQuery.error)
        ? 'linux.do 等级读取需要完成 Cloudflare 验证'
        : errorMessage(linuxDoLevelQuery.error)
      : '',
    linuxDoLevelProfile: linuxDoLevelQuery.data ?? null,
    refreshLinuxDoLevel
  };
}
