import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  nodeImageAuthFlowCanAcceptMessage,
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
  loadNodeImageApiKeyCredential,
  nodeImageApiKeyUseStatus,
  saveNodeImageApiKeyForGeneration,
  type NodeImageApiKeyCredential
} from '@/sources/nodeimage/credentials';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export type NodeImageAuthDocument = {
  injectedJavaScript: string;
  key: string;
  url: string;
};

type NodeImageAuthRevocationReason = 'source-disabled';
type NodeImageAuthRequest = Pick<ReturnType<typeof createNodeImageAuthResult>, 'promise' | 'resolve'> & {
  credentialGeneration: number;
  lifetime: object;
  nonce: string;
  revokedGeneration: number | null;
  revokedReason: NodeImageAuthRevocationReason | null;
  surfaceGeneration: number;
  trace: DiagnosticTrace;
};
type ActiveNodeImageAuthFlow = NodeImageAuthRequest & NodeImageAuthFlow;
type NodeImageHostState =
  | { phase: 'idle'; lifetime: object }
  | { phase: 'reconciling' | 'settling'; flow: NodeImageAuthRequest }
  | { phase: 'pending-mount'; flow: ActiveNodeImageAuthFlow; mountAttempt: number }
  | {
      phase: 'document';
      flow: ActiveNodeImageAuthFlow;
      document: NodeImageAuthDocument;
      load: 'loading' | 'ready';
      mountAttempt: number;
    }
  | { phase: 'failed'; flow: NodeImageAuthRequest; error: string }
  | { phase: 'disposed' };
type KeyOperation =
  | { phase: 'idle' }
  | {
      phase: 'saving';
      generation: number;
      owner: NodeImageAuthOwner;
      lifetime: object;
      revokedReason: NodeImageAuthRevocationReason | null;
    }
  | { phase: 'clearing'; lifetime: object };
type NodeImageKeyState = { summary: Pick<NodeImageApiKeyCredential, 'ownership'> | null; operation: KeyOperation };
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

function nodeImageAuthFlowHasUncertainOutcome(state: NodeImageAuthState) {
  return (state.phase === 'nodeseek-cauth' && state.connect === 'started') || state.phase === 'nodeimage-verify';
}

function nodeImageAuthInterruptedMessage(state: Exclude<NodeImageAuthState, { phase: 'terminal' }>) {
  if (state.phase === 'nodeseek-cauth' && state.connect === 'started') {
    return 'NodeSeek Connect 已发起，但授权页面被中断；结果未知，本次可能已占用一次连接额度。请勿自动重试。';
  }
  return 'NodeImage 授权验证被中断；Connect 已完成，但 API Key 结果未知。请关闭后稍后确认。';
}

function nodeImageAuthOwnerChangedMessage(
  hostPhase: 'pending-mount' | 'document',
  state: Exclude<NodeImageAuthState, { phase: 'terminal' }>
) {
  if (state.phase === 'nodeimage-verify' && hostPhase === 'pending-mount') {
    return 'NodeSeek 身份、会话或 NodeImage 凭据已变化；Connect 已完成，最终验证尚未发送。请关闭后确认账号状态，请勿直接重试。';
  }
  if (
    (state.phase === 'nodeseek-cauth' && state.connect === 'started') ||
    (hostPhase === 'document' && state.phase === 'nodeimage-verify')
  ) {
    return nodeImageAuthInterruptedMessage(state);
  }
  return 'NodeSeek 身份、会话或 NodeImage 凭据已变化，请关闭后重试。';
}

function nodeImageAuthOwnerIsCurrent(
  flow: ActiveNodeImageAuthFlow,
  runtime: SessionRuntimeSnapshot,
  credentialGeneration: number
) {
  return flow.revokedReason === null && nodeImageAuthFlowCanAcceptMessage(flow, runtime, credentialGeneration);
}

function nodeImageAuthDocumentForFlow(flow: ActiveNodeImageAuthFlow, mountAttempt = 0): NodeImageAuthDocument | null {
  const state = flow.state;
  const keySuffix = mountAttempt > 0 ? `:${mountAttempt}` : '';
  switch (state.phase) {
    case 'nodeimage-session':
      return {
        injectedJavaScript: nodeImageSessionScript(flow.nonce),
        key: `${flow.surfaceGeneration}:${state.phase}${keySuffix}`,
        url: NODEIMAGE_URL
      };
    case 'nodeseek-cauth':
      return {
        injectedJavaScript: nodeSeekNodeImageAuthScript(flow.nonce),
        key: `${flow.surfaceGeneration}:${state.phase}${keySuffix}`,
        url: NODEIMAGE_AUTH_URL
      };
    case 'nodeimage-verify':
      return {
        injectedJavaScript: nodeImageAuthPayloadScript(flow.nonce, state.payload),
        key: `${flow.surfaceGeneration}:${state.phase}${keySuffix}`,
        url: NODEIMAGE_URL
      };
    case 'terminal':
      return null;
  }
}

export function useNodeImageAuthController({
  access,
  beginSurface,
  finishSurface,
  notify,
  prepareSurfaceOpen,
  readRuntime,
  reconcileAccountStatus,
  surfaceVisible,
  webViewBlocked = false
}: {
  access: SessionRuntimeSnapshot;
  beginSurface: () => { generation: number };
  finishSurface: (reason: AuthSurfaceCloseReason) => Promise<AccountReconcileResult> | null;
  notify: (message: string) => void;
  prepareSurfaceOpen: () => void;
  readRuntime: () => SessionRuntimeSnapshot;
  reconcileAccountStatus: (surfaceGeneration: number) => Promise<AccountReconcileResult>;
  surfaceVisible: boolean;
  webViewBlocked?: boolean;
}) {
  const webViewRef = useRef<WebView>(null);
  const openingRef = useRef<NodeImageAuthOpeningState>({ phase: 'idle' });
  const hostRef = useRef<NodeImageHostState>({ phase: 'idle', lifetime: {} });
  const [host, setHost] = useState(hostRef.current);
  const keyRef = useRef<NodeImageKeyState>({ summary: null, operation: { phase: 'idle' } });
  const [keyState, setKeyState] = useState(keyRef.current);
  const mountPermitted = surfaceVisible && !webViewBlocked;
  const mountPermittedRef = useCommittedRef(mountPermitted);

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
  const revokeFlowForSourceDisabled = useCallback((flow: NodeImageAuthRequest) => {
    if (flow.revokedReason === 'source-disabled') return;
    flow.revokedReason = 'source-disabled';
    if (currentNodeImageApiKeyGeneration() === flow.credentialGeneration) {
      invalidateNodeImageApiKeyAuthorization();
      flow.revokedGeneration = currentNodeImageApiKeyGeneration();
    }
  }, []);
  const canCommitAuthorization = useCallback(
    (flow: NodeImageAuthRequest, owner: NodeImageAuthOwner, settledIdentityKey: string) => {
      if (flow.revokedReason !== null) return false;
      if (!requestIsCurrent(flow) || hostLifetime(hostRef.current) !== flow.lifetime) return false;
      if (currentNodeImageApiKeyGeneration() !== flow.credentialGeneration) return false;
      const runtime = readRuntime();
      return (
        runtime.sourceEnabled !== false &&
        runtime.identityTrust === 'confirmed' &&
        runtime.identityKey === owner.identityKey &&
        settledIdentityKey === owner.identityKey &&
        runtime.sessionEpoch === owner.sessionEpoch
      );
    },
    [readRuntime, requestIsCurrent]
  );

  const failFlow = useCallback(
    (flow: NodeImageAuthRequest, message: string, reason?: 'timeout') => {
      const current = hostRef.current;
      if (!('flow' in current) || current.flow !== flow || current.phase === 'settling' || current.phase === 'failed')
        return;
      if (current.phase === 'document' || current.phase === 'pending-mount') terminateNodeImageAuthFlow(current.flow);
      webViewRef.current?.stopLoading();
      publishHost({ phase: 'failed', flow, error: message });
      markDiagnosticStage(flow.trace, 'guard', { state: reason === 'timeout' ? 'timeout' : 'failed' });
      finishDiagnosticTrace(flow.trace, 'failure', reason === 'timeout' ? { reason } : undefined);
    },
    [publishHost]
  );
  const mountDocument = useCallback(
    (flow: ActiveNodeImageAuthFlow) => {
      if (!requestIsCurrent(flow) || flow.state.phase === 'terminal') return;
      publishHost({ phase: 'pending-mount', flow, mountAttempt: 0 });
    },
    [publishHost, requestIsCurrent]
  );

  useLayoutEffect(() => {
    const runtime = readRuntime();
    const sourceDisabled = access.sourceEnabled === false || runtime.sourceEnabled === false;
    if (sourceDisabled) {
      cancelNodeImageAuthOpening(openingRef);
      const operation = keyRef.current.operation;
      if (operation.phase === 'saving' && operation.revokedReason !== 'source-disabled') {
        operation.revokedReason = 'source-disabled';
        if (currentNodeImageApiKeyGeneration() === operation.generation) {
          invalidateNodeImageApiKeyAuthorization();
        }
      }
    }
    const current = hostRef.current;
    if (sourceDisabled && 'flow' in current) {
      revokeFlowForSourceDisabled(current.flow);
      if (current.phase === 'settling') {
        publishHost({ phase: 'idle', lifetime: current.flow.lifetime });
        return;
      }
    }
    if (current.phase !== 'pending-mount' && current.phase !== 'document') return;
    if (current.flow.state.phase === 'terminal') return;
    if (sourceDisabled || !nodeImageAuthOwnerIsCurrent(current.flow, runtime, currentNodeImageApiKeyGeneration())) {
      failFlow(current.flow, nodeImageAuthOwnerChangedMessage(current.phase, current.flow.state));
      return;
    }
    if (current.phase === 'pending-mount') {
      if (!mountPermitted) return;
      const nextDocument = nodeImageAuthDocumentForFlow(current.flow, current.mountAttempt);
      if (nextDocument) {
        publishHost({
          phase: 'document',
          flow: current.flow,
          document: nextDocument,
          load: 'loading',
          mountAttempt: current.mountAttempt
        });
      }
      return;
    }
    if (!mountPermitted) {
      if (nodeImageAuthFlowHasUncertainOutcome(current.flow.state)) {
        failFlow(current.flow, nodeImageAuthInterruptedMessage(current.flow.state));
        return;
      }
      webViewRef.current?.stopLoading();
      publishHost({
        phase: 'pending-mount',
        flow: current.flow,
        mountAttempt: current.mountAttempt + 1
      });
    }
  }, [
    access.identityKey,
    access.identityTrust,
    access.sessionEpoch,
    access.sourceEnabled,
    failFlow,
    host,
    mountPermitted,
    publishHost,
    readRuntime,
    revokeFlowForSourceDisabled
  ]);

  const mountedDocument = mountPermitted && host.phase === 'document' ? host.document : null;
  useEffect(() => {
    const current = hostRef.current;
    if (!mountedDocument || current.phase !== 'document' || current.document !== mountedDocument) return;
    const { flow } = current;
    const phase = flow.state.phase;
    if (phase === 'terminal') return;
    const timeout = setTimeout(() => {
      const latest = hostRef.current;
      if (
        latest.phase === 'document' &&
        latest.document === mountedDocument &&
        flow.state.phase !== 'terminal' &&
        mountPermittedRef.current
      ) {
        failFlow(flow, nodeImageAuthTimeoutMessage(flow.state), 'timeout');
      }
    }, NODEIMAGE_AUTH_PHASE_TIMEOUT_MS[phase]);
    return () => clearTimeout(timeout);
  }, [failFlow, mountPermittedRef, mountedDocument]);

  useEffect(() => {
    const pending = new AbortController();
    const generation = currentNodeImageApiKeyGeneration();
    loadNodeImageApiKeyCredential()
      .then((credential) => {
        if (!pending.signal.aborted && generation === currentNodeImageApiKeyGeneration()) {
          publishKey({ ...keyRef.current, summary: credential ? { ownership: credential.ownership } : null });
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
      if (runtime.sourceEnabled === false) {
        notify('NodeImage API Key 未保存：NodeSeek 来源已停用');
        return;
      }
      if (runtime.identityTrust !== 'confirmed' || runtime.identityKey === 'nodeseek:anonymous') {
        notify('请先确认 NodeSeek 登录状态，再手动保存 NodeImage API Key');
        return;
      }
      const operation: KeyOperation = {
        phase: 'saving',
        generation: beginNodeImageApiKeyAuthorization(),
        owner: { identityKey: runtime.identityKey, sessionEpoch: runtime.sessionEpoch },
        lifetime,
        revokedReason: null
      };
      publishKey({ ...keyRef.current, operation });
      const canCommitSave = () => {
        if (operation.revokedReason !== null) return false;
        if (hostLifetime(hostRef.current) !== operation.lifetime) return false;
        if (!keyOperationIsCurrent(operation)) return false;
        if (currentNodeImageApiKeyGeneration() !== operation.generation) return false;
        const current = readRuntime();
        return (
          current.sourceEnabled !== false &&
          current.identityTrust === 'confirmed' &&
          current.identityKey === operation.owner.identityKey &&
          current.sessionEpoch === operation.owner.sessionEpoch
        );
      };
      let committedApiKey: string | null = null;
      const commitSaved = (apiKey: string) => {
        if (!canCommitSave()) return false;
        committedApiKey = apiKey;
        publishKey({
          ...keyRef.current,
          summary: { ownership: { kind: 'verified', identityKey: operation.owner.identityKey } }
        });
        notify('NodeImage API Key 已保存');
        return true;
      };
      try {
        const saved = canCommitSave()
          ? await saveNodeImageApiKeyForGeneration(
              operation.generation,
              value,
              operation.owner.identityKey,
              operation.owner.identityKey,
              canCommitSave,
              commitSaved
            )
          : undefined;
        if (!committedApiKey && saved) {
          commitSaved(saved);
        }
        if (!committedApiKey) {
          if (hostLifetime(hostRef.current) === operation.lifetime)
            notify(
              operation.revokedReason === 'source-disabled' || readRuntime().sourceEnabled === false
                ? 'NodeImage API Key 未保存：NodeSeek 来源已停用'
                : 'NodeImage API Key 未保存：NodeSeek 身份或会话已变化'
            );
          return;
        }
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
      publishKey({ ...keyRef.current, summary: null });
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
      if (current.phase === 'document' || current.phase === 'pending-mount') terminateNodeImageAuthFlow(current.flow);
      publishHost({ phase: 'settling', flow });
      webViewRef.current?.stopLoading();
      if (conclusion.kind === 'canceled' && flow.revokedReason === null) invalidateNodeImageApiKeyAuthorization();
      let usableApiKey: string | null = null;
      try {
        const reconciliation = finishSurface(conclusion.kind === 'success' ? 'success' : conclusion.reason);
        const result = reconciliation ? await reconciliation : { status: 'stale' as const };
        if (conclusion.kind === 'success' && (result.status === 'same' || result.status === 'changed')) {
          const { owner } = conclusion;
          const settledIdentityKey = siteSessionIdentityKey(result.session);
          const canCommit = () => canCommitAuthorization(flow, owner, settledIdentityKey);
          const commitSaved = (apiKey: string) => {
            if (!canCommit()) return false;
            usableApiKey = apiKey;
            publishKey({
              ...keyRef.current,
              summary: { ownership: { kind: 'verified', identityKey: settledIdentityKey } }
            });
            markDiagnosticStage(flow.trace, 'persist', { state: 'key-saved' });
            finishDiagnosticTrace(flow.trace, 'success');
            notify('NodeImage API Key 已保存');
            return true;
          };
          if (canCommit()) {
            const saved = await saveNodeImageApiKeyForGeneration(
              flow.credentialGeneration,
              conclusion.apiKey,
              owner.identityKey,
              settledIdentityKey,
              canCommit,
              commitSaved
            );
            if (!usableApiKey && saved) {
              commitSaved(saved);
            }
          }
        }
        if (!usableApiKey) {
          if (conclusion.kind === 'success') {
            const supersededByNewerAction =
              ('flow' in hostRef.current && hostRef.current.flow !== flow) ||
              (flow.revokedGeneration !== null && currentNodeImageApiKeyGeneration() !== flow.revokedGeneration);
            if (hostLifetime(hostRef.current) === flow.lifetime && !supersededByNewerAction)
              notify(
                flow.revokedReason === 'source-disabled' || readRuntime().sourceEnabled === false
                  ? 'NodeImage 授权结果未保存：NodeSeek 来源已停用'
                  : 'NodeImage 授权结果未保存：NodeSeek 身份或会话已变化'
              );
            markDiagnosticStage(flow.trace, 'guard', { state: 'failed' });
            finishDiagnosticTrace(flow.trace, 'failure');
          } else {
            finishDiagnosticTrace(flow.trace, 'canceled', { reason: 'canceled' });
          }
          const generation = currentNodeImageApiKeyGeneration();
          const credential = await loadNodeImageApiKeyCredential();
          if (hostLifetime(hostRef.current) === flow.lifetime && generation === currentNodeImageApiKeyGeneration())
            publishKey({ ...keyRef.current, summary: credential ? { ownership: credential.ownership } : null });
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
    [canCommitAuthorization, finishSurface, notify, publishHost, publishKey, readRuntime, requestIsCurrent]
  );

  const close = useCallback(
    (reason: AuthSurfaceCloseReason = 'close-button') => {
      cancelNodeImageAuthOpening(openingRef);
      const current = hostRef.current;
      if (!('flow' in current)) return;
      if (reason === 'source-disabled') {
        revokeFlowForSourceDisabled(current.flow);
        if (current.phase === 'settling') {
          publishHost({ phase: 'idle', lifetime: current.flow.lifetime });
          return;
        }
      }
      void finish(current.flow, { kind: 'canceled', reason });
    },
    [finish, publishHost, revokeFlowForSourceDisabled]
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
          revokedGeneration: null,
          revokedReason: null,
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
            const runtime = readRuntime();
            const active: ActiveNodeImageAuthFlow = {
              ...flow,
              owner: { identityKey: siteSessionIdentityKey(result.session), sessionEpoch: runtime.sessionEpoch },
              state: { phase: 'nodeimage-session' }
            };
            if (!nodeImageAuthOwnerIsCurrent(active, runtime, currentNodeImageApiKeyGeneration())) {
              failFlow(flow, 'NodeSeek 身份、会话或 NodeImage 凭据已变化，请关闭后重试。');
              return;
            }
            publishHost({ phase: 'pending-mount', flow: active, mountAttempt: 0 });
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
      publishKey({ ...keyRef.current, summary: { ownership: credential.ownership } });
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
      if (!mountPermittedRef.current || current.phase !== 'document' || current.document !== document) return;
      const { flow } = current;
      const runtime = readRuntime();
      const credentialGeneration = currentNodeImageApiKeyGeneration();
      const stateBeforeMessage = flow.state;
      const ownerCurrentBeforeMessage = nodeImageAuthOwnerIsCurrent(flow, runtime, credentialGeneration);
      void processNodeImageAuthMessage(
        flow,
        { data: event.nativeEvent.data, sourceUrl: event.nativeEvent.url },
        flow.revokedReason !== null ? { ...runtime, sourceEnabled: false } : runtime,
        credentialGeneration,
        {
          complete: async (apiKey) => {
            await finish(flow, { kind: 'success', apiKey, owner: flow.owner });
          },
          connectTarget: webViewRef.current,
          fail: (message) =>
            failFlow(
              flow,
              !ownerCurrentBeforeMessage && stateBeforeMessage.phase !== 'terminal'
                ? nodeImageAuthOwnerChangedMessage(current.phase, stateBeforeMessage)
                : message
            ),
          mark: (state) => {
            markDiagnosticStage(flow.trace, state.startsWith('connect-') ? 'transport' : 'credential', { state });
          },
          mountCurrentPhase: () => mountDocument(flow)
        }
      ).catch((messageError) => failFlow(flow, errorMessage(messageError)));
    },
    [failFlow, finish, mountDocument, mountPermittedRef, readRuntime]
  );

  useEffect(() => {
    if (hostRef.current.phase === 'disposed') publishHost({ phase: 'idle', lifetime: {} });
    return () => {
      const current = hostRef.current;
      hostRef.current = { phase: 'disposed' };
      cancelNodeImageAuthOpening(openingRef);
      if ('flow' in current) {
        if (current.phase === 'document' || current.phase === 'pending-mount') terminateNodeImageAuthFlow(current.flow);
        invalidateNodeImageApiKeyAuthorization();
        current.flow.resolve(null);
      }
    };
  }, [publishHost]);

  const documentCommands = useMemo(
    () => ({
      fail: (message: string) => {
        const current = hostRef.current;
        if (mountPermittedRef.current && current.phase === 'document' && current.document === mountedDocument) {
          failFlow(
            current.flow,
            current.flow.state.phase !== 'terminal' && nodeImageAuthFlowHasUncertainOutcome(current.flow.state)
              ? nodeImageAuthInterruptedMessage(current.flow.state)
              : message
          );
        }
      },
      handleMessage: (event: WebViewMessageEvent) => {
        if (mountedDocument) handleDocumentMessage(mountedDocument, event);
      },
      setLoading: (loading: boolean) => {
        const current = hostRef.current;
        if (mountPermittedRef.current && current.phase === 'document' && current.document === mountedDocument)
          publishHost({ ...current, load: loading ? 'loading' : 'ready' });
      }
    }),
    [failFlow, handleDocumentMessage, mountPermittedRef, mountedDocument, publishHost]
  );
  const apiKeyBusy = keyState.operation.phase !== 'idle';
  const apiKeySaved = keyState.summary !== null;
  const apiKeyAuthorized =
    access.authenticated &&
    access.identityTrust === 'confirmed' &&
    access.sourceEnabled !== false &&
    !access.authSurfaceOpen &&
    keyState.summary !== null &&
    nodeImageApiKeyUseStatus(keyState.summary, access.identityKey) === 'usable';
  const key = useMemo(
    () => ({
      authorize,
      authorized: apiKeyAuthorized,
      busy: apiKeyBusy,
      clear,
      save,
      saved: apiKeySaved
    }),
    [apiKeyAuthorized, apiKeyBusy, apiKeySaved, authorize, clear, save]
  );
  const panel = useMemo(
    () => ({
      close,
      document: mountedDocument,
      error: host.phase === 'failed' ? host.error : '',
      ...documentCommands,
      loading:
        host.phase === 'reconciling' ||
        (mountedDocument !== null && host.phase === 'document' && host.load === 'loading'),
      visible: surfaceVisible,
      webViewRef
    }),
    [close, documentCommands, host, mountedDocument, surfaceVisible]
  );
  return useMemo(() => ({ key, panel, ensureApiKey: ensure }), [ensure, key, panel]);
}
