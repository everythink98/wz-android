import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '@/domain/forum/sourceUrls';
import { errorMessage } from '@/platform/network/errors';
import type { AuthSurfaceCloseReason } from '@/domain/session/authSurfaceCoordinator';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnostics';
import {
  nodeImageAuthPayloadScript,
  nodeImageSessionScript,
  nodeSeekNodeImageAuthScript,
  type NodeImageAuthPayload
} from '@/platform/network/loginWebViewScripts';
import {
  closeNodeImageAuthOpening,
  createNodeImageAuthNonce,
  processNodeImageAuthMessage,
  runNodeImageAuthOpening,
  terminateNodeImageAuthFlow,
  type NodeImageAuthPhase
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
import type { UserProfile } from '@/domain/forum/models';
import { nativeSecureRandomHex } from '@/platform/android/xiaoyinsiKeystore';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';

export type NodeImageAuthDocument = {
  injectedJavaScript: string;
  key: string;
  url: string;
};

type ActiveNodeImageAuthFlow = {
  connectStarted: boolean;
  credentialGeneration: number;
  nonce: string;
  ownerIdentityKey: string | null;
  ownerSessionEpoch: number | null;
  payload: NodeImageAuthPayload | null;
  phase: NodeImageAuthPhase;
  promise: Promise<string | null>;
  resolve: (apiKey: string | null) => void;
  surfaceGeneration: number;
  terminal: boolean;
  trace: DiagnosticTrace;
};

const NODEIMAGE_AUTH_PHASE_TIMEOUT_MS: Record<NodeImageAuthPhase, number> = {
  'nodeimage-session': 30_000,
  'nodeseek-cauth': 60_000,
  'nodeimage-verify': 30_000
};

function nodeImageAuthTimeoutMessage(flow: ActiveNodeImageAuthFlow) {
  if (flow.phase === 'nodeimage-session') {
    return 'NodeImage 登录态检查超时；本次未发起 NodeSeek Connect。请关闭后重试或手动粘贴 API Key。';
  }
  if (flow.phase === 'nodeseek-cauth') {
    return flow.connectStarted
      ? 'NodeSeek Connect 结果等待超时；结果未知，本次可能已占用一次连接额度。请勿自动重试。'
      : 'NodeSeek Connect 握手超时；本次未发起连接。请关闭后重试。';
  }
  return 'NodeImage 授权验证超时；Connect 已完成，但 API Key 结果未知。请关闭后稍后确认。';
}

function nodeImageAuthDocumentForFlow(flow: ActiveNodeImageAuthFlow): NodeImageAuthDocument | null {
  if (flow.phase === 'nodeimage-session') {
    return {
      injectedJavaScript: nodeImageSessionScript(flow.nonce),
      key: `${flow.surfaceGeneration}:${flow.phase}`,
      url: NODEIMAGE_URL
    };
  }
  if (flow.phase === 'nodeseek-cauth') {
    return {
      injectedJavaScript: nodeSeekNodeImageAuthScript(flow.nonce),
      key: `${flow.surfaceGeneration}:${flow.phase}`,
      url: NODEIMAGE_AUTH_URL
    };
  }
  if (!flow.payload) {
    return null;
  }
  return {
    injectedJavaScript: nodeImageAuthPayloadScript(flow.nonce, flow.payload),
    key: `${flow.surfaceGeneration}:${flow.phase}`,
    url: NODEIMAGE_URL
  };
}

function accountIdentityKey(view: { site: string; status: string; currentUser?: UserProfile | null }) {
  return view.status === 'logged-in' && view.currentUser?.id
    ? `${view.site}:${view.currentUser.id}`
    : `${view.site}:anonymous`;
}

export function useNodeImageAuthController({
  beginSurface,
  finishSurface,
  notify,
  prepareSurfaceOpen,
  readRuntime,
  reconcileAccountStatus
}: {
  beginSurface: () => { generation: number };
  finishSurface: (reason: AuthSurfaceCloseReason) => Promise<AccountReconcileResult> | null;
  notify: (message: string) => void;
  prepareSurfaceOpen: () => void;
  readRuntime: () => SessionRuntimeSnapshot;
  reconcileAccountStatus: (surfaceGeneration: number) => Promise<AccountReconcileResult>;
}) {
  const webViewRef = useRef<WebView>(null);
  const activeFlowRef = useRef<ActiveNodeImageAuthFlow | null>(null);
  const openingRef = useRef<Promise<string | null> | null>(null);
  const apiKeyBusyRef = useRef(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<NodeImageAuthDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reportFailure = useCallback((message: string, reason?: 'timeout') => {
    const flow = activeFlowRef.current;
    if (flow) {
      terminateNodeImageAuthFlow(flow);
      webViewRef.current?.stopLoading();
      setDocument(null);
      markDiagnosticStage(flow.trace, 'guard', {
        state: reason === 'timeout' ? 'timeout' : 'failed'
      });
      finishDiagnosticTrace(flow.trace, 'failure', reason === 'timeout' ? { reason } : undefined);
    }
    setLoading(false);
    setError(String(message));
  }, []);

  useEffect(() => {
    const flow = activeFlowRef.current;
    if (!document || !flow || flow.terminal) {
      return;
    }
    const phase = flow.phase;
    const timeout = setTimeout(() => {
      if (activeFlowRef.current === flow && !flow.terminal && flow.phase === phase) {
        reportFailure(nodeImageAuthTimeoutMessage(flow), 'timeout');
      }
    }, NODEIMAGE_AUTH_PHASE_TIMEOUT_MS[phase]);
    return () => clearTimeout(timeout);
  }, [document, reportFailure]);

  useEffect(() => {
    let active = true;
    loadNodeImageApiKey()
      .then((apiKey) => {
        if (active) {
          setApiKeySaved(Boolean(apiKey));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(
    async (value: string) => {
      if (apiKeyBusyRef.current) {
        return;
      }
      apiKeyBusyRef.current = true;
      setApiKeyBusy(true);
      try {
        const runtime = readRuntime();
        if (runtime.identityTrust !== 'confirmed' || runtime.identityKey === 'nodeseek:anonymous') {
          notify('请先确认 NodeSeek 登录状态，再手动保存 NodeImage API Key');
          return;
        }
        const generation = beginNodeImageApiKeyAuthorization();
        const saved = await saveNodeImageApiKeyForGeneration(
          generation,
          value,
          runtime.identityKey,
          runtime.identityKey,
          () => {
            const current = readRuntime();
            return (
              current.identityTrust === 'confirmed' &&
              current.identityKey === runtime.identityKey &&
              current.sessionEpoch === runtime.sessionEpoch
            );
          }
        );
        if (!saved) {
          notify('NodeImage API Key 未保存：NodeSeek 身份或会话已变化');
          return;
        }
        setApiKeySaved(true);
        notify('NodeImage API Key 已保存');
      } catch (saveError) {
        notify(errorMessage(saveError));
      } finally {
        apiKeyBusyRef.current = false;
        setApiKeyBusy(false);
      }
    },
    [notify, readRuntime]
  );

  const clear = useCallback(async () => {
    if (apiKeyBusyRef.current) {
      return;
    }
    apiKeyBusyRef.current = true;
    setApiKeyBusy(true);
    try {
      const cleared = await clearNodeImageApiKey();
      if (!cleared) {
        return;
      }
      setApiKeySaved(false);
      notify('NodeImage API Key 已清除');
    } catch (clearError) {
      notify(errorMessage(clearError));
    } finally {
      apiKeyBusyRef.current = false;
      setApiKeyBusy(false);
    }
  }, [notify]);

  const finish = useCallback(
    async (apiKey: string | null, closeReason: AuthSurfaceCloseReason = 'cancel') => {
      const flow = activeFlowRef.current;
      if (!flow) {
        return;
      }
      activeFlowRef.current = null;
      webViewRef.current?.stopLoading();
      setDocument(null);
      setVisible(false);
      setLoading(false);
      if (apiKey) {
        setError('');
      } else {
        invalidateNodeImageApiKeyAuthorization();
      }
      const reconciliation = finishSurface(apiKey ? 'success' : closeReason);
      let usableApiKey: string | null = null;
      try {
        const result = reconciliation ? await reconciliation : { status: 'stale' as const };
        if (
          apiKey &&
          flow.ownerIdentityKey &&
          flow.ownerSessionEpoch !== null &&
          (result.status === 'same' || result.status === 'changed')
        ) {
          const settledIdentityKey = accountIdentityKey(result.session);
          if (readRuntime().sessionEpoch === flow.ownerSessionEpoch) {
            const saved = await saveNodeImageApiKeyForGeneration(
              flow.credentialGeneration,
              apiKey,
              flow.ownerIdentityKey,
              settledIdentityKey,
              () => {
                const runtime = readRuntime();
                return (
                  runtime.identityTrust === 'confirmed' &&
                  runtime.identityKey === flow.ownerIdentityKey &&
                  runtime.sessionEpoch === flow.ownerSessionEpoch
                );
              }
            );
            if (saved) {
              usableApiKey = saved;
              setApiKeySaved(true);
              markDiagnosticStage(flow.trace, 'persist', { state: 'key-saved' });
              finishDiagnosticTrace(flow.trace, 'success');
              notify('NodeImage API Key 已保存');
            }
          }
        }
        if (!usableApiKey) {
          if (apiKey) {
            notify('NodeImage 授权结果未保存：NodeSeek 身份或会话已变化');
            markDiagnosticStage(flow.trace, 'guard', { state: 'failed' });
            finishDiagnosticTrace(flow.trace, 'failure');
          } else {
            finishDiagnosticTrace(flow.trace, 'canceled', { reason: 'canceled' });
          }
          setApiKeySaved(Boolean(await loadNodeImageApiKey()));
        }
      } catch (finishError) {
        markDiagnosticStage(flow.trace, 'persist', { state: 'failed' });
        finishDiagnosticTrace(flow.trace, 'failure', { reason: 'storage_error' });
        notify(`NodeImage 授权结果未保存：${errorMessage(finishError)}`);
      } finally {
        flow.resolve(usableApiKey);
      }
    },
    [finishSurface, notify, readRuntime]
  );

  const close = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button') => {
      closeNodeImageAuthOpening(openingRef, () => finish(null, reason));
    },
    [finish]
  );

  const open = useCallback(() => {
    if (activeFlowRef.current) {
      return activeFlowRef.current.promise;
    }
    return runNodeImageAuthOpening(openingRef, {
      createNonce: () => createNodeImageAuthNonce(nativeSecureRandomHex),
      onError: (openError) => {
        notify(`NodeImage 授权无法启动：${errorMessage(openError)}`);
      },
      open: async (nonce) => {
        prepareSurfaceOpen();
        setDocument(null);
        setError('');
        setLoading(true);
        const surfaceTicket = beginSurface();
        const credentialGeneration = beginNodeImageApiKeyAuthorization();
        const trace = beginDiagnosticTrace('credential', 'auth', {
          credentialSource: 'nodeimage',
          state: 'session-check'
        });
        let resolveFlow!: (apiKey: string | null) => void;
        const promise = new Promise<string | null>((resolve) => {
          resolveFlow = resolve;
        });
        const flow: ActiveNodeImageAuthFlow = {
          connectStarted: false,
          credentialGeneration,
          nonce,
          ownerIdentityKey: null,
          ownerSessionEpoch: null,
          payload: null,
          phase: 'nodeimage-session',
          promise,
          resolve: resolveFlow,
          surfaceGeneration: surfaceTicket.generation,
          terminal: false,
          trace
        };
        activeFlowRef.current = flow;
        setVisible(true);
        void (async () => {
          try {
            const result = await reconcileAccountStatus(flow.surfaceGeneration);
            if (activeFlowRef.current !== flow) {
              return;
            }
            if (result.status === 'unknown') {
              reportFailure(`NodeSeek 身份暂时无法确认：${result.error}`);
              return;
            }
            if (
              result.status === 'stale' ||
              result.status === 'anonymous' ||
              result.session.status !== 'logged-in' ||
              !result.session.currentUser?.id
            ) {
              reportFailure('请先完成 NodeSeek 登录，再重新打开 NodeImage 授权。');
              return;
            }
            flow.ownerIdentityKey = accountIdentityKey(result.session);
            flow.ownerSessionEpoch = readRuntime().sessionEpoch;
            setError('');
            setDocument(nodeImageAuthDocumentForFlow(flow));
          } catch (reconcileError) {
            if (activeFlowRef.current === flow) {
              reportFailure(`NodeSeek 身份暂时无法确认：${errorMessage(reconcileError)}`);
            }
          }
        })();
        return promise;
      }
    });
  }, [beginSurface, notify, prepareSurfaceOpen, readRuntime, reconcileAccountStatus, reportFailure]);

  const ensure = useCallback(async () => {
    const identityKey = readRuntime().identityKey;
    const credential = await loadNodeImageApiKeyCredential();
    if (credential && nodeImageApiKeyUseStatus(credential, identityKey) === 'usable') {
      setApiKeySaved(true);
      return credential.apiKey;
    }
    return null;
  }, [readRuntime]);

  const authorize = useCallback(() => {
    void open();
  }, [open]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      void (async () => {
        const flow = activeFlowRef.current;
        if (!flow || flow.terminal) {
          return;
        }
        try {
          await processNodeImageAuthMessage(
            flow,
            {
              data: event.nativeEvent.data,
              sourceUrl: event.nativeEvent.url
            },
            readRuntime(),
            currentNodeImageApiKeyGeneration(),
            {
              complete: async (apiKey) => {
                if (activeFlowRef.current === flow) {
                  await finish(String(apiKey));
                }
              },
              connectTarget: webViewRef.current,
              fail: reportFailure,
              mark: (state) => {
                markDiagnosticStage(flow.trace, state.startsWith('connect-') ? 'transport' : 'credential', { state });
              },
              mountCurrentPhase: () => {
                if (activeFlowRef.current !== flow || flow.terminal) {
                  return;
                }
                setError('');
                setLoading(true);
                setDocument(nodeImageAuthDocumentForFlow(flow));
              }
            }
          );
        } catch (messageError) {
          if (activeFlowRef.current === flow) {
            reportFailure(errorMessage(messageError));
          }
        }
      })();
    },
    [finish, readRuntime, reportFailure]
  );

  useEffect(
    () => () => {
      openingRef.current = null;
      const flow = activeFlowRef.current;
      activeFlowRef.current = null;
      if (flow) {
        invalidateNodeImageApiKeyAuthorization();
      }
      flow?.resolve(null);
    },
    []
  );

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
      error,
      fail: reportFailure,
      handleMessage,
      loading,
      setLoading,
      visible,
      webViewRef
    }),
    [close, document, error, handleMessage, loading, reportFailure, visible]
  );

  return useMemo(() => ({ key, panel }), [key, panel]);
}
