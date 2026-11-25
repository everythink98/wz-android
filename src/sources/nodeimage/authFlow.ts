import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '@/domain/forum/sourceUrls';
import type { NodeImageAuthPayload } from '@/platform/network/loginWebViewScripts';
import { nodeImageApiKeyFromResponse } from './upload';

export type NodeImageAuthPhase = 'nodeimage-session' | 'nodeseek-cauth' | 'nodeimage-verify';
export type NodeImageAuthOwner = Readonly<{ identityKey: string; sessionEpoch: number }>;
export type NodeImageAuthState =
  | { phase: 'nodeimage-session' }
  | { phase: 'nodeseek-cauth'; connect: 'awaiting-ready' | 'started' }
  | { phase: 'nodeimage-verify'; payload: NodeImageAuthPayload }
  | { phase: 'terminal' };
export type NodeImageAuthFlow = {
  credentialGeneration: number;
  nonce: string;
  owner: NodeImageAuthOwner;
  state: NodeImageAuthState;
};

export function createNodeImageAuthResult() {
  let resolve: (apiKey: string | null) => void = () => {
    throw new Error('Authorization result is not initialized');
  };
  let reject: (error: unknown) => void = () => {
    throw new Error('Authorization result is not initialized');
  };
  const promise = new Promise<string | null>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export type NodeImageAuthOpeningState =
  { phase: 'idle' } | { phase: 'pending'; result: ReturnType<typeof createNodeImageAuthResult> };

const NODEIMAGE_NONCE_BYTES = 16;

export function cancelNodeImageAuthOpening(slot: { current: NodeImageAuthOpeningState }) {
  slot.current = { phase: 'idle' };
}

export function runNodeImageAuthSingleFlight(
  slot: { current: NodeImageAuthOpeningState },
  initialize: (isCurrent: () => boolean) => Promise<string | null>
) {
  if (slot.current.phase === 'pending') {
    return slot.current.result.promise;
  }
  const opening: NodeImageAuthOpeningState = { phase: 'pending', result: createNodeImageAuthResult() };
  slot.current = opening;
  void (async () => {
    try {
      opening.result.resolve(await initialize(() => slot.current === opening));
    } catch (error) {
      opening.result.reject(error);
    } finally {
      if (slot.current === opening) {
        slot.current = { phase: 'idle' };
      }
    }
  })();
  return opening.result.promise;
}

export function runNodeImageAuthOpening(
  slot: { current: NodeImageAuthOpeningState },
  {
    createNonce,
    onError,
    open
  }: {
    createNonce: () => Promise<string>;
    onError: (error: unknown) => void;
    open: (nonce: string) => Promise<string | null>;
  }
) {
  return runNodeImageAuthSingleFlight(slot, async (isCurrent) => {
    let nonce: string;
    try {
      nonce = await createNonce();
    } catch (error) {
      if (isCurrent()) {
        onError(error);
      }
      return null;
    }
    return isCurrent() ? open(nonce) : null;
  });
}

export function closeNodeImageAuthOpening(
  slot: { current: NodeImageAuthOpeningState },
  finish: () => void | Promise<void>
) {
  cancelNodeImageAuthOpening(slot);
  void finish();
}

export async function createNodeImageAuthNonce(secureRandomHex?: (byteCount: number) => Promise<string>) {
  const cryptoSource = globalThis.crypto;
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') {
    try {
      if (!secureRandomHex) {
        throw new Error('secure random provider unavailable');
      }
      const nonce = String(await secureRandomHex(NODEIMAGE_NONCE_BYTES)).trim();
      if (!/^[0-9a-f]{32}$/i.test(nonce)) {
        throw new Error('invalid secure random value');
      }
      return nonce.toLowerCase();
    } catch {
      throw new Error('A secure random provider is required for NodeImage authorization');
    }
  }
  const bytes = new Uint8Array(NODEIMAGE_NONCE_BYTES);
  try {
    cryptoSource.getRandomValues(bytes);
  } catch {
    throw new Error('Web Crypto getRandomValues failed for NodeImage authorization');
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function nodeImageAuthBridgeEvidenceMatchesPhase(
  phase: NodeImageAuthPhase,
  rawSourceUrl: string,
  rawDocumentUrl: string
): boolean {
  try {
    const expectedUrl = new URL(phase === 'nodeseek-cauth' ? NODEIMAGE_AUTH_URL : NODEIMAGE_URL);
    const sourceUrl = secureNodeImageAuthUrl(rawSourceUrl);
    const documentUrl = secureNodeImageAuthUrl(rawDocumentUrl);
    return sourceUrl.origin === expectedUrl.origin && documentUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
}

export function nodeImageAuthFlowCanAcceptMessage(
  flow: Pick<NodeImageAuthFlow, 'credentialGeneration' | 'owner' | 'state'>,
  runtime: {
    identityKey: string;
    identityTrust: string;
    sessionEpoch: number;
    sourceEnabled?: boolean;
  },
  credentialGeneration: number
) {
  return (
    flow.state.phase !== 'terminal' &&
    runtime.sourceEnabled !== false &&
    runtime.identityTrust === 'confirmed' &&
    runtime.identityKey === flow.owner.identityKey &&
    runtime.sessionEpoch === flow.owner.sessionEpoch &&
    credentialGeneration === flow.credentialGeneration
  );
}

export function terminateNodeImageAuthFlow(flow: Pick<NodeImageAuthFlow, 'state'>) {
  if (flow.state.phase === 'terminal') {
    return false;
  }
  flow.state = { phase: 'terminal' };
  return true;
}

export function claimNodeImageConnectAttempt(flow: Pick<NodeImageAuthFlow, 'state'>) {
  if (flow.state.phase !== 'nodeseek-cauth' || flow.state.connect !== 'awaiting-ready') {
    return false;
  }
  flow.state = { phase: 'nodeseek-cauth', connect: 'started' };
  return true;
}

export async function processNodeImageAuthMessage(
  flow: NodeImageAuthFlow,
  message: { data: string; sourceUrl: string },
  runtime: {
    identityKey: string;
    identityTrust: string;
    sessionEpoch: number;
    sourceEnabled?: boolean;
  },
  credentialGeneration: number,
  effects: {
    complete: (apiKey: string) => void | Promise<void>;
    connectTarget: { postMessage: (message: string) => void } | null;
    fail: (message: string) => void;
    mark: (state: 'connect-finished' | 'connect-started' | 'session-expired' | 'session-reused') => void;
    mountCurrentPhase: () => void;
  }
) {
  if (flow.state.phase === 'terminal') {
    return;
  }
  const fail = (error: string) => {
    if (terminateNodeImageAuthFlow(flow)) {
      effects.fail(error);
    }
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.data);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return;
  }
  const data = parsed as Record<string, unknown>;
  if (data.nonce !== flow.nonce) {
    return;
  }
  if (!nodeImageAuthBridgeEvidenceMatchesPhase(flow.state.phase, message.sourceUrl, String(data.documentUrl || ''))) {
    return;
  }
  const messageType = String(data.type || '');
  const expectedMessage =
    flow.state.phase === 'nodeimage-session'
      ? ['nodeimage-session-key', 'nodeimage-session-expired', 'nodeimage-session-error'].includes(messageType)
      : flow.state.phase === 'nodeseek-cauth'
        ? ['nodeimage-connect-ready', 'nodeimage-auth-data', 'nodeimage-auth-error'].includes(messageType)
        : messageType === 'nodeimage-api-key';
  if (!expectedMessage) {
    return;
  }
  if (!nodeImageAuthFlowCanAcceptMessage(flow, runtime, credentialGeneration)) {
    fail('NodeSeek 身份、会话或 NodeImage 凭据已变化，请关闭后重试。');
    return;
  }
  if (flow.state.phase === 'nodeimage-session') {
    if (messageType === 'nodeimage-session-key') {
      const apiKey = nodeImageApiKeyFromResponse(data);
      if (!apiKey) {
        fail('NodeImage 登录态已响应，但未返回 API Key；请关闭后重试或手动粘贴。');
        return;
      }
      effects.mark('session-reused');
      if (terminateNodeImageAuthFlow(flow)) {
        await effects.complete(apiKey);
      }
      return;
    }
    if (messageType === 'nodeimage-session-expired') {
      if (data.status !== 401) {
        fail('NodeImage 登录态返回了未识别的失效结果，请关闭后重试。');
        return;
      }
      const nextPhase = nextNodeImageAuthPhase(flow.state.phase, messageType);
      if (nextPhase !== 'nodeseek-cauth') {
        return;
      }
      effects.mark('session-expired');
      flow.state = { phase: nextPhase, connect: 'awaiting-ready' };
      effects.mountCurrentPhase();
      return;
    }
    if (messageType === 'nodeimage-session-error') {
      fail('NodeImage 登录态暂时无法确认；请关闭后重试或手动粘贴 API Key。');
    }
    return;
  }
  if (flow.state.phase === 'nodeseek-cauth') {
    if (messageType === 'nodeimage-connect-ready') {
      if (!effects.connectTarget || !claimNodeImageConnectAttempt(flow)) {
        return;
      }
      effects.mark('connect-started');
      effects.connectTarget.postMessage(
        JSON.stringify({
          nonce: flow.nonce,
          type: 'nodeimage-connect-start'
        })
      );
      return;
    }
    if (flow.state.connect !== 'started') {
      return;
    }
    if (messageType === 'nodeimage-auth-error') {
      fail(String(data.error || 'NodeSeek Connect 失败'));
      return;
    }
    if (messageType !== 'nodeimage-auth-data') {
      return;
    }
    const payload = {
      data: data.data,
      wtf: data.wtf,
      sign: data.sign
    };
    if (payload.data == null || !payload.wtf || !payload.sign) {
      fail('NodeSeek Connect 返回缺少必要信息。');
      return;
    }
    const nextPhase = nextNodeImageAuthPhase(flow.state.phase, messageType);
    if (nextPhase !== 'nodeimage-verify') {
      return;
    }
    flow.state = { phase: nextPhase, payload };
    effects.mark('connect-finished');
    effects.mountCurrentPhase();
    return;
  }
  if (messageType !== 'nodeimage-api-key') {
    return;
  }
  const apiKey = nodeImageApiKeyFromResponse(data);
  if (!apiKey) {
    fail(String(data.error || 'NodeImage 授权完成，但未返回 API Key。'));
    return;
  }
  if (terminateNodeImageAuthFlow(flow)) {
    await effects.complete(apiKey);
  }
}

export function nextNodeImageAuthPhase(phase: NodeImageAuthPhase, messageType: string): NodeImageAuthPhase | null {
  if (phase === 'nodeimage-session' && messageType === 'nodeimage-session-expired') {
    return 'nodeseek-cauth';
  }
  if (phase === 'nodeseek-cauth' && messageType === 'nodeimage-auth-data') {
    return 'nodeimage-verify';
  }
  return null;
}

function rawAuthorityHasUserinfo(rawUrl: string) {
  const authorityStart = rawUrl.indexOf('://') + 3;
  const authorityEnd = rawUrl.slice(authorityStart).search(/[/?#\\]/);
  const authority =
    authorityEnd < 0 ? rawUrl.slice(authorityStart) : rawUrl.slice(authorityStart, authorityStart + authorityEnd);
  return authority.includes('@');
}

function secureNodeImageAuthUrl(rawUrl: string) {
  const value = String(rawUrl || '');
  if (value !== value.trim() || !/^https:\/\//i.test(value) || rawAuthorityHasUserinfo(value) || value.includes('#')) {
    throw new Error('unsafe NodeImage authorization URL');
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('unsafe NodeImage authorization URL');
  }
  return url;
}
