import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from './appUrls';

export type NodeImageAuthPhase = 'nodeseek-cauth' | 'nodeimage-payload';

const NODEIMAGE_NONCE_BYTES = 16;

export function cancelNodeImageAuthOpening(
  slot: { current: Promise<string | null> | null }
) {
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

export async function createNodeImageAuthNonce(
  secureRandomHex?: (byteCount: number) => Promise<string>
) {
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

export function nodeImageAuthPhaseForTopLevelUrl(
  rawUrl: string
): NodeImageAuthPhase | null {
  try {
    const value = String(rawUrl || '');
    if (
      value !== value.trim()
      || !/^https:\/\//i.test(value)
      || rawAuthorityHasUserinfo(value)
    ) {
      return null;
    }
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return null;
    }
    if (
      url.href === NODEIMAGE_AUTH_URL
    ) {
      return 'nodeseek-cauth';
    }
    if (
      url.href === NODEIMAGE_URL
    ) {
      return 'nodeimage-payload';
    }
  } catch {
    return null;
  }
  return null;
}

function rawAuthorityHasUserinfo(rawUrl: string) {
  const authorityStart = rawUrl.indexOf('://') + 3;
  const authorityEnd = rawUrl
    .slice(authorityStart)
    .search(/[/?#\\]/);
  const authority = authorityEnd < 0
    ? rawUrl.slice(authorityStart)
    : rawUrl.slice(authorityStart, authorityStart + authorityEnd);
  return authority.includes('@');
}
