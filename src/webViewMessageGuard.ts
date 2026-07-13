import * as Crypto from 'expo-crypto';

export type WebViewMessageNativeEvent = {
  data?: unknown;
  url?: unknown;
};

export type WebViewMessageGuardOptions<TType extends string> = {
  allowedTypes: readonly TType[];
  trustedOrigins: readonly string[];
  sessionId: string;
  nonce: string;
};

export type TrustedWebViewMessage<TType extends string> = Record<string, unknown> & {
  type: TType;
  sessionId: string;
  nonce: string;
};

export type WebViewMessageSession = Readonly<{
  sessionId: string;
  nonce: string;
}>;

const MIN_NONCE_LENGTH = 16;
let nextSessionId = 0;

function randomNonce() {
  const bytes = new Uint8Array(16);
  Crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function createWebViewMessageSession(scope: string): WebViewMessageSession {
  if (!/^[a-z][a-z0-9-]*$/.test(scope)) {
    throw new Error(`Invalid WebView message session scope: ${scope}`);
  }
  nextSessionId += 1;
  return Object.freeze({
    sessionId: `${scope}-${Date.now().toString(36)}-${nextSessionId.toString(36)}`,
    nonce: randomNonce()
  });
}

function exactTrustedOrigin(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid trusted origin: ${value}`);
  }
  const inputWithoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value;
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || inputWithoutTrailingSlash !== parsed.origin
  ) {
    throw new Error(`Invalid trusted origin: ${value}`);
  }
  return parsed.origin;
}

function validateOptions<TType extends string>(options: WebViewMessageGuardOptions<TType>) {
  if (!options.allowedTypes.length || options.allowedTypes.some((type) => !type)) {
    throw new Error('WebView message guard requires at least one allowed type.');
  }
  if (!options.sessionId) {
    throw new Error('WebView message guard requires a sessionId.');
  }
  if (options.nonce.length < MIN_NONCE_LENGTH) {
    throw new Error(`WebView message guard nonce must contain at least ${MIN_NONCE_LENGTH} characters.`);
  }
  if (!options.trustedOrigins.length) {
    throw new Error('WebView message guard requires at least one trusted origin.');
  }
  return new Set(options.trustedOrigins.map(exactTrustedOrigin));
}

function messageOrigin(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function parseTrustedWebViewMessage<TType extends string>(
  nativeEvent: WebViewMessageNativeEvent,
  options: WebViewMessageGuardOptions<TType>
): TrustedWebViewMessage<TType> | null {
  const trustedOrigins = validateOptions(options);
  const origin = messageOrigin(nativeEvent.url);
  if (!origin || !trustedOrigins.has(origin) || typeof nativeEvent.data !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(nativeEvent.data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as Record<string, unknown>;
  if (
    typeof message.type !== 'string'
    || !options.allowedTypes.includes(message.type as TType)
    || message.sessionId !== options.sessionId
    || message.nonce !== options.nonce
  ) {
    return null;
  }
  return message as TrustedWebViewMessage<TType>;
}
