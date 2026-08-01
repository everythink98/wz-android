import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from './appUrls';
import type { NodeImageAuthPayload } from './loginWebViewScripts';
import { nodeImageApiKeyFromResponse } from './replyImageUpload';

export type NodeImageAuthPhase = 'nodeimage-session' | 'nodeseek-cauth' | 'nodeimage-verify';

const NODEIMAGE_NONCE_BYTES = 16;

export function cancelNodeImageAuthOpening(slot: { current: Promise<string | null> | null }) {
  slot.current = null;
}

export function runNodeImageAuthSingleFlight(
  slot: { current: Promise<string | null> | null },
  initialize: (isCurrent: () => boolean) => Promise<string | null>
) {
  if (slot.current) {
    return slot.current;
  }
  let opening!: Promise<string | null>;
  opening = (async () => {
    try {
      return await initialize(() => slot.current === opening);
    } finally {
      if (slot.current === opening) {
        slot.current = null;
      }
    }
  })();
  slot.current = opening;
  return opening;
}

export function runNodeImageAuthOpening(
  slot: { current: Promise<string | null> | null },
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
  slot: { current: Promise<string | null> | null },
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
  flow: {
    credentialGeneration: number;
    ownerIdentityKey: string | null;
    ownerSessionEpoch: number | null;
    terminal: boolean;
  },
  runtime: {
    identityKey: string;
    identityTrust: string;
    sessionEpoch: number;
  },
  credentialGeneration: number
) {
  return (
    !flow.terminal &&
    Boolean(flow.ownerIdentityKey) &&
    flow.ownerSessionEpoch !== null &&
    runtime.identityTrust === 'confirmed' &&
    runtime.identityKey === flow.ownerIdentityKey &&
    runtime.sessionEpoch === flow.ownerSessionEpoch &&
    credentialGeneration === flow.credentialGeneration
  );
}

export function terminateNodeImageAuthFlow(flow: { terminal: boolean }) {
  if (flow.terminal) {
    return false;
  }
  flow.terminal = true;
  return true;
}

export function claimNodeImageConnectAttempt(flow: { connectStarted: boolean }) {
  if (flow.connectStarted) {
    return false;
  }
  flow.connectStarted = true;
  return true;
}

export async function processNodeImageAuthMessage(
  flow: {
    connectStarted: boolean;
    credentialGeneration: number;
    nonce: string;
    ownerIdentityKey: string | null;
    ownerSessionEpoch: number | null;
    payload: NodeImageAuthPayload | null;
    phase: NodeImageAuthPhase;
    terminal: boolean;
  },
  message: { data: string; sourceUrl: string },
  runtime: {
    identityKey: string;
    identityTrust: string;
    sessionEpoch: number;
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
  if (flow.terminal) {
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
  if (!nodeImageAuthBridgeEvidenceMatchesPhase(flow.phase, message.sourceUrl, String(data.documentUrl || ''))) {
    return;
  }
  const messageType = String(data.type || '');
  const expectedMessage =
    flow.phase === 'nodeimage-session'
      ? ['nodeimage-session-key', 'nodeimage-session-expired', 'nodeimage-session-error'].includes(messageType)
      : flow.phase === 'nodeseek-cauth'
        ? ['nodeimage-connect-ready', 'nodeimage-auth-data', 'nodeimage-auth-error'].includes(messageType)
        : messageType === 'nodeimage-api-key';
  if (!expectedMessage) {
    return;
  }
  if (!nodeImageAuthFlowCanAcceptMessage(flow, runtime, credentialGeneration)) {
    fail('NodeSeek 身份、会话或 NodeImage 凭据已变化，请关闭后重试。');
    return;
  }
  if (flow.phase === 'nodeimage-session') {
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
      const nextPhase = nextNodeImageAuthPhase(flow.phase, messageType);
      if (!nextPhase) {
        return;
      }
      effects.mark('session-expired');
      flow.phase = nextPhase;
      effects.mountCurrentPhase();
      return;
    }
    if (messageType === 'nodeimage-session-error') {
      fail('NodeImage 登录态暂时无法确认；请关闭后重试或手动粘贴 API Key。');
    }
    return;
  }
  if (flow.phase === 'nodeseek-cauth') {
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
    if (!flow.connectStarted) {
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
    const nextPhase = nextNodeImageAuthPhase(flow.phase, messageType);
    if (!nextPhase) {
      return;
    }
    flow.payload = payload;
    flow.phase = nextPhase;
    effects.mark('connect-finished');
    effects.mountCurrentPhase();
    return;
  }
  if (messageType !== 'nodeimage-api-key' || !flow.payload) {
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
