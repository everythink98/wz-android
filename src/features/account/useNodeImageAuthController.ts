import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '@/domain/forum/sourceUrls';
import { errorMessage } from '@/platform/network/errors';
import type { AuthSurfaceCloseReason } from '@/domain/session/authSurfaceCoordinator';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import {
  nodeImageAuthPayloadScript,
  nodeImageSessionScript,
  nodeSeekNodeImageAuthScript
} from '@/platform/network/loginWebViewScripts';
import {
  cancelNodeImageAuthOpening,
  createNodeImageAuthNonce,
  createNodeImageAuthResult,
  processNodeImageAuthMessage,
  runNodeImageAuthOpening,
  terminateNodeImageAuthFlow,
  type NodeImageAuthFlow,
  type NodeImageAuthOpeningState,
  type NodeImageAuthOwner,
  type NodeImageAuthPhase,
  type NodeImageAuthState
} from '@/sources/nodeimage/authFlow';
import {
  beginNodeImageApiKeyAuthorization,
  clearNodeImageApiKey,
  currentNodeImageApiKeyGeneration,
  invalidateNodeImageApiKeyAuthorization,
  loadNodeImageApiKey,
  loadNodeImageApiKeyCredential,
  nodeImageApiKeyUseStatus,
  saveNodeImageApiKeyForGeneration
} from '@/sources/nodeimage/credentials';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';

export type NodeImageAuthDocument = {
  injectedJavaScript: string;
  key: string;
  url: string;
};

type NodeImageAuthRequest = Pick<ReturnType<typeof createNodeImageAuthResult>, 'promise' | 'resolve'> & {
  credentialGeneration: number;
  lifetime: object;
  nonce: string;
  surfaceGeneration: number;
  trace: DiagnosticTrace;
};
type ActiveNodeImageAuthFlow = NodeImageAuthRequest & NodeImageAuthFlow;
type NodeImageHostState =
  | { phase: 'idle'; lifetime: object }
  | { phase: 'reconciling' | 'settling'; flow: NodeImageAuthRequest }
  | { phase: 'document'; flow: ActiveNodeImageAuthFlow; document: NodeImageAuthDocument; load: 'loading' | 'ready' }
  | { phase: 'failed'; flow: NodeImageAuthRequest; error: string }
  | { phase: 'disposed' };
type KeyOperation =
  | { phase: 'idle' }
  | { phase: 'saving'; generation: number; owner: NodeImageAuthOwner; lifetime: object }
  | { phase: 'clearing'; lifetime: object };
type NodeImageKeyState = { summary: 'unknown' | 'stored' | 'empty'; operation: KeyOperation };
type NodeImageAuthConclusion =
  { kind: 'success'; apiKey: string; owner: NodeImageAuthOwner } | { kind: 'canceled'; reason: AuthSurfaceCloseReason };

const NODEIMAGE_AUTH_PHASE_TIMEOUT_MS: Record<NodeImageAuthPhase, number> = {
  'nodeimage-session': 30_000,
  'nodeseek-cauth': 60_000,
  'nodeimage-verify': 30_000
};

function hostLifetime(host: NodeImageHostState) {
  return host.phase === 'disposed' ? null : host.phase === 'idle' ? host.lifetime : host.flow.lifetime;
}

function nodeImageAuthTimeoutMessage(state: Exclude<NodeImageAuthState, { phase: 'terminal' }>) {
  if (state.phase === 'nodeimage-session') {
    return 'NodeImage 登录态检查超时；本次未发起 NodeSeek Connect。请关闭后重试或手动粘贴 API Key。';
  }
  if (state.phase === 'nodeseek-cauth') {
    return state.connect === 'started'
      ? 'NodeSeek Connect 结果等待超时；结果未知，本次可能已占用一次连接额度。请勿自动重试。'
      : 'NodeSeek Connect 握手超时；本次未发起连接。请关闭后重试。';
  }
  return 'NodeImage 授权验证超时；Connect 已完成，但 API Key 结果未知。请关闭后稍后确认。';
}

function nodeImageAuthDocumentForFlow(flow: ActiveNodeImageAuthFlow): NodeImageAuthDocument | null {
  const state = flow.state;
  switch (state.phase) {
    case 'nodeimage-session':
      return {
        injectedJavaScript: nodeImageSessionScript(flow.nonce),
        key: `${flow.surfaceGeneration}:${state.phase}`,
        url: NODEIMAGE_URL
      };
    case 'nodeseek-cauth':
      return {
        injectedJavaScript: nodeSeekNodeImageAuthScript(flow.nonce),
        key: `${flow.surfaceGeneration}:${state.phase}`,
        url: NODEIMAGE_AUTH_URL
      };
    case 'nodeimage-verify':
      return {
        injectedJavaScript: nodeImageAuthPayloadScript(flow.nonce, state.payload),
        key: `${flow.surfaceGeneration}:${state.phase}`,
        url: NODEIMAGE_URL
      };
    case 'terminal':
      return null;
  }
}

export function useNodeImageAuthController({
  beginSurface,
  finishSurface,
  notify,
  prepareSurfaceOpen,
  readRuntime,
  reconcileAccountStatus,
  surfaceVisible
}: {
  beginSurface: () => { generation: number };
  finishSurface: (reason: AuthSurfaceCloseReason) => Promise<AccountReconcileResult> | null;
  notify: (message: string) => void;
  prepareSurfaceOpen: () => void;
  readRuntime: () => SessionRuntimeSnapshot;
  reconcileAccountStatus: (surfaceGeneration: number) => Promise<AccountReconcileResult>;
  surfaceVisible: boolean;
}) {
  const webViewRef = useRef<WebView>(null);
  const openingRef = useRef<NodeImageAuthOpeningState>({ phase: 'idle' });
  const hostRef = useRef<NodeImageHostState>({ phase: 'idle', lifetime: {} });
  const [host, setHost] = useState(hostRef.current);
  const keyRef = useRef<NodeImageKeyState>({ summary: 'unknown', operation: { phase: 'idle' } });
  const [keyState, setKeyState] = useState(keyRef.current);

  const publishHost = useCallback((next: NodeImageHostState) => {
    hostRef.current = next;
    setHost(next);
  }, []);
  const publishKey = useCallback((next: NodeImageKeyState) => {
    keyRef.current = next;
    if (hostRef.current.phase !== 'disposed') setKeyState(next);
  }, []);
  const keyOperationIsCurrent = useCallback(
    (operation: Exclude<KeyOperation, { phase: 'idle' }>) => keyRef.current.operation === operation,
    []
  );
  const requestIsCurrent = useCallback((flow: NodeImageAuthRequest) => {
    const current = hostRef.current;
    return 'flow' in current && current.flow === flow;
  }, []);

  const failFlow = useCallback(
    (flow: NodeImageAuthRequest, message: string, reason?: 'timeout') => {
      const current = hostRef.current;
      if (!('flow' in current) || current.flow !== flow || current.phase === 'settling' || current.phase === 'failed')
        return;
      if (current.phase === 'document') terminateNodeImageAuthFlow(current.flow);
      webViewRef.current?.stopLoading();
      publishHost({ phase: 'failed', flow, error: message });
      markDiagnosticStage(flow.trace, 'guard', { state: reason === 'timeout' ? 'timeout' : 'failed' });
      finishDiagnosticTrace(flow.trace, 'failure', reason === 'timeout' ? { reason } : undefined);
    },
    [publishHost]
  );
  const mountDocument = useCallback(
    (flow: ActiveNodeImageAuthFlow) => {
      if (!requestIsCurrent(flow)) return;
      const document = nodeImageAuthDocumentForFlow(flow);
      if (document) publishHost({ phase: 'document', flow, document, load: 'loading' });
    },
    [publishHost, requestIsCurrent]
  );

  const document = host.phase === 'document' ? host.document : null;
  useEffect(() => {
    const current = hostRef.current;
    if (!document || current.phase !== 'document' || current.document !== document) return;
    const { flow } = current;
    const phase = flow.state.phase;
    if (phase === 'terminal') return;
    const timeout = setTimeout(() => {
      const latest = hostRef.current;
      if (latest.phase === 'document' && latest.document === document && flow.state.phase !== 'terminal') {
        failFlow(flow, nodeImageAuthTimeoutMessage(flow.state), 'timeout');
      }
    }, NODEIMAGE_AUTH_PHASE_TIMEOUT_MS[phase]);
    return () => clearTimeout(timeout);
  }, [document, failFlow]);

  useEffect(() => {
    const pending = new AbortController();
    const generation = currentNodeImageApiKeyGeneration();
    loadNodeImageApiKey()
      .then((apiKey) => {
        if (!pending.signal.aborted && generation === currentNodeImageApiKeyGeneration()) {
          publishKey({ ...keyRef.current, summary: apiKey ? 'stored' : 'empty' });
        }
      })
      .catch(() => undefined);
    return () => pending.abort();
  }, [publishKey]);

  const save = useCallback(
    async (value: string) => {
      const lifetime = hostLifetime(hostRef.current);
      if (!lifetime || keyRef.current.operation.phase !== 'idle') return;
      const runtime = readRuntime();
      if (runtime.identityTrust !== 'confirmed' || runtime.identityKey === 'nodeseek:anonymous') {
        notify('请先确认 NodeSeek 登录状态，再手动保存 NodeImage API Key');
        return;
      }
      const operation: KeyOperation = {
        phase: 'saving',
        generation: beginNodeImageApiKeyAuthorization(),
        owner: { identityKey: runtime.identityKey, sessionEpoch: runtime.sessionEpoch },
        lifetime
      };
      publishKey({ ...keyRef.current, operation });
      try {
        const saved = await saveNodeImageApiKeyForGeneration(
          operation.generation,
          value,
          operation.owner.identityKey,
          operation.owner.identityKey,
          () => {
            const current = readRuntime();
            return (
              hostLifetime(hostRef.current) === operation.lifetime &&
              current.identityTrust === 'confirmed' &&
              current.identityKey === operation.owner.identityKey &&
              current.sessionEpoch === operation.owner.sessionEpoch
            );
          }
        );
        if (!saved) {
          if (hostLifetime(hostRef.current) === operation.lifetime)
            notify('NodeImage API Key 未保存：NodeSeek 身份或会话已变化');
          return;
        }
        publishKey({ ...keyRef.current, summary: 'stored' });
        if (hostLifetime(hostRef.current) === operation.lifetime) notify('NodeImage API Key 已保存');
      } catch (saveError) {
        if (hostLifetime(hostRef.current) === operation.lifetime) notify(errorMessage(saveError));
      } finally {
        if (keyOperationIsCurrent(operation)) publishKey({ ...keyRef.current, operation: { phase: 'idle' } });
      }
    },
    [keyOperationIsCurrent, notify, publishKey, readRuntime]
  );

  const clear = useCallback(async () => {
    const lifetime = hostLifetime(hostRef.current);
    if (!lifetime || keyRef.current.operation.phase !== 'idle') return;
    const operation: KeyOperation = { phase: 'clearing', lifetime };
    publishKey({ ...keyRef.current, operation });
    try {
      const cleared = await clearNodeImageApiKey();
      if (!cleared) return;
      publishKey({ ...keyRef.current, summary: 'empty' });
      if (hostLifetime(hostRef.current) === operation.lifetime) notify('NodeImage API Key 已清除');
    } catch (clearError) {
      if (hostLifetime(hostRef.current) === operation.lifetime) notify(errorMessage(clearError));
    } finally {
      if (keyOperationIsCurrent(operation)) publishKey({ ...keyRef.current, operation: { phase: 'idle' } });
    }
  }, [keyOperationIsCurrent, notify, publishKey]);

  const finish = useCallback(
    async (flow: NodeImageAuthRequest, conclusion: NodeImageAuthConclusion) => {
      const current = hostRef.current;
      if (!requestIsCurrent(flow) || current.phase === 'settling') return;
      publishHost({ phase: 'settling', flow });
      webViewRef.current?.stopLoading();
      if (conclusion.kind === 'canceled') invalidateNodeImageApiKeyAuthorization();
      let usableApiKey: string | null = null;
      try {
        const reconciliation = finishSurface(conclusion.kind === 'success' ? 'success' : conclusion.reason);
        const result = reconciliation ? await reconciliation : { status: 'stale' as const };
        if (conclusion.kind === 'success' && (result.status === 'same' || result.status === 'changed')) {
          const { owner } = conclusion;
          const settledIdentityKey = siteSessionIdentityKey(result.session);
          if (hostLifetime(hostRef.current) === flow.lifetime && readRuntime().sessionEpoch === owner.sessionEpoch) {
            const saved = await saveNodeImageApiKeyForGeneration(
              flow.credentialGeneration,
              conclusion.apiKey,
              owner.identityKey,
              settledIdentityKey,
              () => {
                const runtime = readRuntime();
                return (
                  hostLifetime(hostRef.current) === flow.lifetime &&
                  runtime.identityTrust === 'confirmed' &&
                  runtime.identityKey === owner.identityKey &&
                  runtime.sessionEpoch === owner.sessionEpoch
                );
              }
            );
            if (saved && hostLifetime(hostRef.current) === flow.lifetime) {
              usableApiKey = saved;
              publishKey({ ...keyRef.current, summary: 'stored' });
              markDiagnosticStage(flow.trace, 'persist', { state: 'key-saved' });
              finishDiagnosticTrace(flow.trace, 'success');
              notify('NodeImage API Key 已保存');
            }
          }
        }
        if (!usableApiKey) {
          if (conclusion.kind === 'success') {
            if (hostLifetime(hostRef.current) === flow.lifetime)
              notify('NodeImage 授权结果未保存：NodeSeek 身份或会话已变化');
            markDiagnosticStage(flow.trace, 'guard', { state: 'failed' });
            finishDiagnosticTrace(flow.trace, 'failure');
          } else {
            finishDiagnosticTrace(flow.trace, 'canceled', { reason: 'canceled' });
          }
          const apiKey = await loadNodeImageApiKey();
          if (hostLifetime(hostRef.current) === flow.lifetime)
            publishKey({ ...keyRef.current, summary: apiKey ? 'stored' : 'empty' });
        }
      } catch (finishError) {
        markDiagnosticStage(flow.trace, 'persist', { state: 'failed' });
        finishDiagnosticTrace(flow.trace, 'failure', { reason: 'storage_error' });
        if (hostLifetime(hostRef.current) === flow.lifetime)
          notify(`NodeImage 授权结果未保存：${errorMessage(finishError)}`);
      } finally {
        if (requestIsCurrent(flow)) publishHost({ phase: 'idle', lifetime: flow.lifetime });
        flow.resolve(usableApiKey);
      }
    },
    [finishSurface, notify, publishHost, publishKey, readRuntime, requestIsCurrent]
  );

  const close = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button') => {
      cancelNodeImageAuthOpening(openingRef);
      const current = hostRef.current;
      if ('flow' in current) void finish(current.flow, { kind: 'canceled', reason });
    },
    [finish]
  );

  const open = useCallback(() => {
    const current = hostRef.current;
    const lifetime = hostLifetime(current);
    if (!lifetime || readRuntime().sourceEnabled === false) return Promise.resolve(null);
    if ('flow' in current) return current.flow.promise;
    return runNodeImageAuthOpening(openingRef, {
      createNonce: () => createNodeImageAuthNonce(nativeSecureRandomHex),
      onError: (openError) => {
        if (hostLifetime(hostRef.current) === lifetime) notify(`NodeImage 授权无法启动：${errorMessage(openError)}`);
      },
      open: async (nonce) => {
        if (hostLifetime(hostRef.current) !== lifetime || readRuntime().sourceEnabled === false) return null;
        prepareSurfaceOpen();
        const surfaceTicket = beginSurface();
        const credentialGeneration = beginNodeImageApiKeyAuthorization();
        const trace = beginDiagnosticTrace('credential', 'auth', {
          credentialSource: 'nodeimage',
          state: 'session-check'
        });
        const { promise, resolve } = createNodeImageAuthResult();
        const flow: NodeImageAuthRequest = {
          credentialGeneration,
          lifetime,
          nonce,
          promise,
          resolve,
          surfaceGeneration: surfaceTicket.generation,
          trace
        };
        publishHost({ phase: 'reconciling', flow });
        void (async () => {
          try {
            const result = await reconcileAccountStatus(flow.surfaceGeneration);
            if (!requestIsCurrent(flow)) return;
            if (result.status === 'unknown') {
              failFlow(flow, `NodeSeek 身份暂时无法确认：${result.error}`);
              return;
            }
            if (
              result.status === 'stale' ||
              result.status === 'anonymous' ||
              result.session.status !== 'logged-in' ||
              !result.session.currentUser?.id
            ) {
              failFlow(flow, '请先完成 NodeSeek 登录，再重新打开 NodeImage 授权。');
              return;
            }
            const active: ActiveNodeImageAuthFlow = {
              ...flow,
              owner: { identityKey: siteSessionIdentityKey(result.session), sessionEpoch: readRuntime().sessionEpoch },
              state: { phase: 'nodeimage-session' }
            };
            const document = nodeImageAuthDocumentForFlow(active);
            if (document) publishHost({ phase: 'document', flow: active, document, load: 'loading' });
          } catch (reconcileError) {
            failFlow(flow, `NodeSeek 身份暂时无法确认：${errorMessage(reconcileError)}`);
          }
        })();
        return promise;
      }
    });
  }, [
    beginSurface,
    failFlow,
    notify,
    prepareSurfaceOpen,
    publishHost,
    readRuntime,
    reconcileAccountStatus,
    requestIsCurrent
  ]);

  const ensure = useCallback(async () => {
    const lifetime = hostLifetime(hostRef.current);
    const before = readRuntime();
    const generation = currentNodeImageApiKeyGeneration();
    if (!lifetime || before.identityTrust !== 'confirmed' || before.sourceEnabled === false) return null;
    const credential = await loadNodeImageApiKeyCredential();
    const current = readRuntime();
    if (
      hostLifetime(hostRef.current) !== lifetime ||
      current.identityKey !== before.identityKey ||
      current.sessionEpoch !== before.sessionEpoch ||
      current.identityTrust !== 'confirmed' ||
      current.sourceEnabled === false ||
      generation !== currentNodeImageApiKeyGeneration()
    )
      return null;
    if (credential && nodeImageApiKeyUseStatus(credential, current.identityKey) === 'usable') {
      publishKey({ ...keyRef.current, summary: 'stored' });
      return credential.apiKey;
    }
    return null;
  }, [publishKey, readRuntime]);

  const authorize = useCallback(() => {
    const lifetime = hostLifetime(hostRef.current);
    if (!lifetime) return;
    void open().catch((error) => {
      if (hostLifetime(hostRef.current) === lifetime) notify(`NodeImage 授权无法启动：${errorMessage(error)}`);
    });
  }, [notify, open]);

  const handleDocumentMessage = useCallback(
    (document: NodeImageAuthDocument, event: WebViewMessageEvent) => {
      const current = hostRef.current;
      if (current.phase !== 'document' || current.document !== document) return;
      const { flow } = current;
      void processNodeImageAuthMessage(
        flow,
        { data: event.nativeEvent.data, sourceUrl: event.nativeEvent.url },
        readRuntime(),
        currentNodeImageApiKeyGeneration(),
        {
          complete: async (apiKey) => {
            await finish(flow, { kind: 'success', apiKey, owner: flow.owner });
          },
          connectTarget: webViewRef.current,
          fail: (message) => failFlow(flow, message),
          mark: (state) => {
            markDiagnosticStage(flow.trace, state.startsWith('connect-') ? 'transport' : 'credential', { state });
          },
          mountCurrentPhase: () => mountDocument(flow)
        }
      ).catch((messageError) => failFlow(flow, errorMessage(messageError)));
    },
    [failFlow, finish, mountDocument, readRuntime]
  );

  useEffect(() => {
    if (hostRef.current.phase === 'disposed') publishHost({ phase: 'idle', lifetime: {} });
    return () => {
      const current = hostRef.current;
      hostRef.current = { phase: 'disposed' };
      cancelNodeImageAuthOpening(openingRef);
      if ('flow' in current) {
        invalidateNodeImageApiKeyAuthorization();
        current.flow.resolve(null);
      }
    };
  }, [publishHost]);

  const documentCommands = useMemo(
    () => ({
      fail: (message: string) => {
        const current = hostRef.current;
        if (current.phase === 'document' && current.document === document) failFlow(current.flow, message);
      },
      handleMessage: (event: WebViewMessageEvent) => {
        if (document) handleDocumentMessage(document, event);
      },
      setLoading: (loading: boolean) => {
        const current = hostRef.current;
        if (current.phase === 'document' && current.document === document)
          publishHost({ ...current, load: loading ? 'loading' : 'ready' });
      }
    }),
    [document, failFlow, handleDocumentMessage, publishHost]
  );
  const apiKeyBusy = keyState.operation.phase !== 'idle';
  const apiKeySaved = keyState.summary === 'stored';
  const key = useMemo(
    () => ({
      authorize,
      busy: apiKeyBusy,
      clear,
      ensure,
      save,
      saved: apiKeySaved
    }),
    [apiKeyBusy, apiKeySaved, authorize, clear, ensure, save]
  );
  const panel = useMemo(
    () => ({
      close,
      document,
      error: host.phase === 'failed' ? host.error : '',
      ...documentCommands,
      loading: host.phase === 'reconciling' || (host.phase === 'document' && host.load === 'loading'),
      visible: surfaceVisible,
      webViewRef
    }),
    [close, document, documentCommands, host, surfaceVisible]
  );
  return useMemo(() => ({ key, panel }), [key, panel]);
}
