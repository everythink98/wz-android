import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '../appUrls';
import { errorMessage } from '../appUtils';
import { nodeImageApiKeyProbeScript, type NodeImageAuthPayload } from '../loginWebViewScripts';
import { clearNodeImageApiKey, loadNodeImageApiKey, saveNodeImageApiKey } from '../nodeimageCredentials';
import { nodeImageApiKeyFromResponse } from '../replyImageUpload';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import {
  createWebViewMessageSession,
  parseTrustedWebViewMessage,
  type WebViewMessageSession
} from '../webViewMessageGuard';
import { createNodeImageAuthRequestGate } from './nodeImageAuthRequestGate';
import { ensureNodeImageApiKeyForRequest } from './nodeImageAuthPolicy';
import { createNodeImageCredentialCoordinator } from './nodeImageCredentialCoordinator';

export type NodeImageAuthModalController = {
  close: () => void;
  error: string;
  handleMessage: (event: WebViewMessageEvent) => void;
  loading: boolean;
  probeScript: string;
  setError: (value: string) => void;
  setLoading: (value: boolean) => void;
  url: string;
  visible: boolean;
  webViewRef: RefObject<WebView | null>;
};

type ActiveNodeImageAuthorization = {
  apiKeyPersisting: boolean;
  baseline: Promise<string | null>;
  baselineValue?: string | null;
  baselineReady: boolean;
  owner: symbol;
  messageSession: WebViewMessageSession;
  writeRevision?: number;
  trace: DiagnosticTrace;
};

const NODEIMAGE_MESSAGE_ORIGINS = [
  'https://www.nodeseek.com',
  'https://nodeseek.com',
  'https://www.nodeimage.com',
  'https://nodeimage.com'
];
const NODEIMAGE_MESSAGE_TYPES = [
  'nodeimage-api-key',
  'nodeimage-auth-data',
  'nodeimage-auth-error'
] as const;

function nodeImageMessageOriginMatchesType(type: typeof NODEIMAGE_MESSAGE_TYPES[number], url: unknown) {
  if (typeof url !== 'string') {
    return false;
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return type === 'nodeimage-api-key'
    ? origin === 'https://www.nodeimage.com' || origin === 'https://nodeimage.com'
    : origin === 'https://www.nodeseek.com' || origin === 'https://nodeseek.com';
}

export function useNodeImageAuthController({ notify }: { notify: (message: string) => void }) {
  const webViewRef = useRef<WebView>(null);
  const requestGateRef = useRef(createNodeImageAuthRequestGate());
  const credentialCoordinatorRef = useRef(createNodeImageCredentialCoordinator({
    clear: clearNodeImageApiKey,
    read: loadNodeImageApiKey,
    save: saveNodeImageApiKey
  }));
  const activeAuthorizationRef = useRef<ActiveNodeImageAuthorization | null>(null);
  const apiKeyBusyRef = useRef(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState(NODEIMAGE_AUTH_URL);
  const [payload, setPayload] = useState<NodeImageAuthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [messageSession, setMessageSession] = useState(() => createWebViewMessageSession('nodeimage-auth'));

  useEffect(() => {
    let active = true;
    credentialCoordinatorRef.current.read()
      .then((apiKey) => {
        if (active) {
          setApiKeySaved(Boolean(apiKey));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      webViewRef.current?.stopLoading();
      const authorization = activeAuthorizationRef.current;
      activeAuthorizationRef.current = null;
      if (authorization) {
        if (authorization.baselineReady && authorization.writeRevision !== undefined) {
          void credentialCoordinatorRef.current
            .replaceIfCurrent(authorization.writeRevision, authorization.baselineValue ?? null)
            ?.promise.catch(() => undefined);
        }
        requestGateRef.current.finish(authorization.owner, null);
        finishDiagnosticTrace(authorization.trace, 'canceled', {
          source: 'nodeseek',
          credentialSource: 'nodeimage',
          reason: 'canceled'
        });
      }
    };
  }, []);

  const saveApiKey = useCallback(async (value: string) => {
    const trace = beginDiagnosticTrace('credential', 'save', {
      source: 'nodeseek',
      credentialSource: 'nodeimage',
      mode: 'manual'
    });
    if (apiKeyBusyRef.current) {
      finishDiagnosticTrace(trace, 'blocked', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        reason: 'busy'
      });
      return;
    }
    apiKeyBusyRef.current = true;
    setApiKeyBusy(true);
    try {
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        store: 'secure-store',
        state: 'started'
      });
      await credentialCoordinatorRef.current.replace(value).promise;
      setApiKeySaved(true);
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        store: 'secure-store',
        state: 'persisted'
      });
      finishDiagnosticTrace(trace, 'success', {
        source: 'nodeseek',
        credentialSource: 'nodeimage'
      });
      notify('NodeImage API Key 已保存');
    } catch (saveError) {
      finishDiagnosticTrace(trace, 'failure', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        reason: normalizeDiagnosticReason(saveError)
      });
      notify(errorMessage(saveError));
    } finally {
      apiKeyBusyRef.current = false;
      setApiKeyBusy(false);
    }
  }, [notify]);

  const clearApiKey = useCallback(async () => {
    const trace = beginDiagnosticTrace('credential', 'clear', {
      source: 'nodeseek',
      credentialSource: 'nodeimage',
      mode: 'manual'
    });
    if (apiKeyBusyRef.current) {
      finishDiagnosticTrace(trace, 'blocked', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        reason: 'busy'
      });
      return;
    }
    apiKeyBusyRef.current = true;
    setApiKeyBusy(true);
    try {
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        store: 'secure-store',
        state: 'started'
      });
      await credentialCoordinatorRef.current.replace(null).promise;
      setApiKeySaved(false);
      markDiagnosticStage(trace, 'persist', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        store: 'secure-store',
        state: 'persisted'
      });
      finishDiagnosticTrace(trace, 'success', {
        source: 'nodeseek',
        credentialSource: 'nodeimage'
      });
      notify('NodeImage API Key 已清除');
    } catch (clearError) {
      finishDiagnosticTrace(trace, 'failure', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        reason: normalizeDiagnosticReason(clearError)
      });
      notify(errorMessage(clearError));
    } finally {
      apiKeyBusyRef.current = false;
      setApiKeyBusy(false);
    }
  }, [notify]);

  const finish = useCallback((owner: symbol, apiKey: string | null) => {
    const authorization = activeAuthorizationRef.current;
    if (authorization?.owner !== owner
      || !requestGateRef.current.finish(owner, apiKey)) {
      return false;
    }
    if (!apiKey && authorization.baselineReady && authorization.writeRevision !== undefined) {
      void credentialCoordinatorRef.current
        .replaceIfCurrent(authorization.writeRevision, authorization.baselineValue ?? null)
        ?.promise.catch(() => undefined);
    }
    finishDiagnosticTrace(authorization.trace, apiKey ? 'success' : 'canceled', {
      source: 'nodeseek',
      credentialSource: 'nodeimage',
      ...(apiKey ? {} : { reason: 'canceled' })
    });
    activeAuthorizationRef.current = null;
    webViewRef.current?.stopLoading();
    setVisible(false);
    setPayload(null);
    setLoading(false);
    if (apiKey) {
      setError('');
    }
    return true;
  }, []);
  const close = useCallback(() => {
    const authorization = activeAuthorizationRef.current;
    if (authorization) {
      finish(authorization.owner, null);
    }
  }, [finish]);

  const open = useCallback(() => {
    const request = requestGateRef.current.begin();
    if (request.created) {
      const nextMessageSession = createWebViewMessageSession('nodeimage-auth');
      const trace = beginDiagnosticTrace('credential', 'check', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        mode: 'open'
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        credentialSource: 'nodeimage',
        store: 'secure-store',
        state: 'loading'
      });
      activeAuthorizationRef.current = {
        apiKeyPersisting: false,
        baseline: credentialCoordinatorRef.current.read(),
        baselineReady: false,
        owner: request.owner,
        messageSession: nextMessageSession,
        trace
      };
      setMessageSession(nextMessageSession);
      setUrl(NODEIMAGE_AUTH_URL);
      setPayload(null);
      setError('');
      setLoading(true);
      setVisible(true);
    }
    return request.promise;
  }, []);

  const ensureApiKey = useCallback(async (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => {
    return ensureNodeImageApiKeyForRequest(options, {
      clearApiKey: async () => credentialCoordinatorRef.current.replace(null).promise,
      loadApiKey: () => credentialCoordinatorRef.current.read(),
      openAuthorization: open,
      setSaved: setApiKeySaved
    });
  }, [open]);

  const authorize = useCallback(() => {
    void ensureApiKey({ forceRefresh: true });
  }, [ensureApiKey]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const authorization = activeAuthorizationRef.current;
    if (!authorization) {
      return;
    }
    const data = parseTrustedWebViewMessage(event.nativeEvent, {
      allowedTypes: NODEIMAGE_MESSAGE_TYPES,
      trustedOrigins: NODEIMAGE_MESSAGE_ORIGINS,
      ...authorization.messageSession
    });
    if (!data) {
      return;
    }
    if (!nodeImageMessageOriginMatchesType(data.type, event.nativeEvent.url)) {
      return;
    }
    markDiagnosticStage(authorization.trace, 'transport', {
      source: 'nodeseek',
      credentialSource: 'nodeimage',
      channel: 'webview',
      state: 'ready'
    });
    void (async () => {
      try {
        if (data.type !== 'nodeimage-api-key') {
          if (data.type === 'nodeimage-auth-data') {
            const nextPayload = {
              data: data.data,
              wtf: data.wtf,
              sign: data.sign
            };
            if (nextPayload.data == null || !nextPayload.wtf || !nextPayload.sign) {
              markDiagnosticStage(authorization.trace, 'parse', {
                source: 'nodeseek',
                credentialSource: 'nodeimage',
                state: 'failure',
                reason: 'invalid_response'
              });
              setError('NodeSeek 授权返回缺少必要信息。');
              return;
            }
            markDiagnosticStage(authorization.trace, 'parse', {
              source: 'nodeseek',
              credentialSource: 'nodeimage',
              state: 'success'
            });
            setPayload(nextPayload);
            setError('');
            setLoading(true);
            setUrl(NODEIMAGE_URL);
            return;
          }
          if (data.type === 'nodeimage-auth-error') {
            markDiagnosticStage(authorization.trace, 'parse', {
              source: 'nodeseek',
              credentialSource: 'nodeimage',
              state: 'failure',
              reason: 'invalid_response'
            });
            setError(String(data.error || 'NodeSeek 授权失败'));
          }
          return;
        }
        const apiKey = nodeImageApiKeyFromResponse(data);
        if (!apiKey) {
          markDiagnosticStage(authorization.trace, 'parse', {
            source: 'nodeseek',
            credentialSource: 'nodeimage',
            state: 'failure',
            reason: 'missing_credential'
          });
          setError(String(data.error || '需要完成 NodeSeek 授权后才能自动获取 NodeImage Key。'));
          return;
        }
        if (authorization.apiKeyPersisting) {
          return;
        }
        authorization.apiKeyPersisting = true;
        const baselineValue = await authorization.baseline;
        if (activeAuthorizationRef.current?.owner !== authorization.owner) {
          return;
        }
        authorization.baselineValue = baselineValue;
        authorization.baselineReady = true;
        markDiagnosticStage(authorization.trace, 'persist', {
          source: 'nodeseek',
          credentialSource: 'nodeimage',
          store: 'secure-store',
          state: 'started'
        });
        const write = credentialCoordinatorRef.current.replace(apiKey);
        authorization.writeRevision = write.revision;
        await write.promise;
        if (activeAuthorizationRef.current?.owner !== authorization.owner) {
          return;
        }
        markDiagnosticStage(authorization.trace, 'persist', {
          source: 'nodeseek',
          credentialSource: 'nodeimage',
          store: 'secure-store',
          state: 'persisted'
        });
        setApiKeySaved(true);
        notify('NodeImage API Key 已保存');
        finish(authorization.owner, apiKey);
      } catch (messageError) {
        if (activeAuthorizationRef.current?.owner === authorization.owner) {
          authorization.apiKeyPersisting = false;
          markDiagnosticStage(authorization.trace, 'persist', {
            source: 'nodeseek',
            credentialSource: 'nodeimage',
            store: 'secure-store',
            state: 'failure',
            reason: normalizeDiagnosticReason(messageError)
          });
          setError(errorMessage(messageError));
        }
      }
    })();
  }, [finish, notify]);

  const probeScript = useMemo(
    () => nodeImageApiKeyProbeScript(payload, messageSession),
    [messageSession, payload]
  );

  const modal = useMemo<NodeImageAuthModalController>(() => ({
    close,
    error,
    handleMessage,
    loading,
    probeScript,
    setError,
    setLoading,
    url,
    visible,
    webViewRef
  }), [close, error, handleMessage, loading, probeScript, url, visible]);

  return {
    apiKeyBusy,
    apiKeySaved,
    authorize,
    clearApiKey,
    ensureApiKey,
    modal,
    saveApiKey
  };
}
