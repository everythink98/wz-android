import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getXiaoyinsiCurrentUserProfile } from './account';
import {
  parseStoredXiaoyinsiCredential,
  serializeXiaoyinsiCredential,
  type XiaoyinsiApiCredentials,
  type XiaoyinsiApiScope
} from './credentials';
import { XIAOYINSI_BASE_URL } from './protocol';
import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import type { UserProfile } from '@/domain/forum/models';
import { xiaoyinsiKeystore, type XiaoyinsiKeystore } from '@/platform/android/xiaoyinsiKeystore';

const APPLICATION_NAME = '阅坛 Android';
const AUTH_API_VERSION = 4;
const DEVICE_CODE_PATH = '/user-api-key/device.json';
const DEVICE_POLL_PATH = '/user-api-key/device/poll.json';
const AUTH_CAPABILITY_PATH = '/user-api-key/new';
const REVOKE_PATH = '/user-api-key/revoke';
const AUTH_SCOPES: XiaoyinsiApiScope[] = ['read', 'write', 'notifications'];

let xiaoyinsiCredentialGeneration = 0;

function advanceXiaoyinsiCredentialGeneration() {
  xiaoyinsiCredentialGeneration += 1;
  return xiaoyinsiCredentialGeneration;
}

export function currentXiaoyinsiCredentialGeneration() {
  return xiaoyinsiCredentialGeneration;
}

export const XIAOYINSI_AUTH_STORAGE_KEYS = {
  apiKey: 'xiaoyinsi-auth.api-key',
  clientId: 'xiaoyinsi-auth.client-id',
  pending: 'xiaoyinsi-auth.pending',
  revokedCleanup: 'xiaoyinsi-auth.revoked-cleanup'
} as const;

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

export type XiaoyinsiPendingAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriWithRequest: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  intervalMs: number;
};

export type XiaoyinsiPollResult =
  | { status: 'idle' }
  | { status: 'authorization_pending' }
  | { status: 'authorized'; credentials: XiaoyinsiApiCredentials }
  | { status: 'access_denied' }
  | { status: 'expired_token' };

export type XiaoyinsiRevocationCleanupResult = {
  complete: boolean;
  apiKeyDeleted: boolean;
  pendingDeleted: boolean;
  pendingNeutralized: boolean;
  keystoreDeleted: boolean;
  cleanupMarkerPersisted: boolean;
};

export type XiaoyinsiAuthDependencies = {
  fetcher?: Fetcher;
  keystore?: XiaoyinsiKeystore;
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type XiaoyinsiAuthErrorCode =
  'unsupported' | 'invalid-response' | 'nonce-mismatch' | 'decrypt-failed' | 'missing-client-id';

export class XiaoyinsiAuthError extends Error {
  readonly code: XiaoyinsiAuthErrorCode;

  constructor(code: XiaoyinsiAuthErrorCode, message: string) {
    super(message);
    this.name = 'XiaoyinsiAuthError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nowFrom(dependencies: XiaoyinsiAuthDependencies) {
  return dependencies.now?.() ?? Date.now();
}

function assertNotCanceled(dependencies: XiaoyinsiAuthDependencies) {
  if (dependencies.signal?.aborted) {
    throw new Error(REQUEST_CANCELED_MESSAGE);
  }
}

async function restoreApiKey(value: string | null) {
  const previous = value?.trim();
  if (previous) {
    await SecureStore.setItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, previous, secureStoreOptions);
  } else {
    await SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, secureStoreOptions);
  }
}

async function responseJson(response: Response, invalidMessage: string) {
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new XiaoyinsiAuthError('invalid-response', invalidMessage);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!isRecord(data)) {
    throw new XiaoyinsiAuthError('invalid-response', invalidMessage);
  }
  return data;
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  dependencies: XiaoyinsiAuthDependencies,
  headers: Record<string, string> = {}
) {
  return fetchWithTimeout(
    `${XIAOYINSI_BASE_URL}${path}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    },
    dependencies
  );
}

function validVerificationUri(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'forum.xiaoyinsi.com' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeUserCode(value: unknown) {
  const code = String(value || '')
    .trim()
    .toUpperCase();
  const match = code.match(/^([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})$/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function parsePendingResponse(
  data: Record<string, unknown>,
  nonce: string,
  createdAt: number
): XiaoyinsiPendingAuthorization {
  const deviceCode = String(data.device_code || '').trim();
  const userCode = normalizeUserCode(data.user_code);
  const verificationUri = validVerificationUri(data.verification_uri);
  const verificationUriWithRequest = validVerificationUri(data.verification_uri_with_request);
  const expiresIn = Number(data.expires_in);
  const interval = Number(data.interval);
  if (
    !/^[a-f0-9]{64}$/i.test(deviceCode) ||
    !userCode ||
    !verificationUri ||
    !verificationUriWithRequest ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 600 ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    interval > 60
  ) {
    throw new XiaoyinsiAuthError('invalid-response', '小隐寺返回了无效的授权信息，请重试。');
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriWithRequest,
    nonce,
    createdAt,
    expiresAt: createdAt + Math.floor(expiresIn * 1_000),
    intervalMs: Math.floor(interval * 1_000)
  };
}

function parseStoredPending(value: string | null): XiaoyinsiPendingAuthorization | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const data = JSON.parse(value) as unknown;
    if (!isRecord(data)) {
      return undefined;
    }
    const pending = {
      deviceCode: String(data.deviceCode || ''),
      userCode: normalizeUserCode(data.userCode),
      verificationUri: validVerificationUri(data.verificationUri),
      verificationUriWithRequest: validVerificationUri(data.verificationUriWithRequest),
      nonce: String(data.nonce || ''),
      createdAt: Number(data.createdAt),
      expiresAt: Number(data.expiresAt),
      intervalMs: Number(data.intervalMs)
    };
    return /^[a-f0-9]{64}$/i.test(pending.deviceCode) &&
      Boolean(pending.userCode) &&
      pending.verificationUri &&
      pending.verificationUriWithRequest &&
      /^[a-f0-9]{32,256}$/i.test(pending.nonce) &&
      Number.isFinite(pending.createdAt) &&
      Number.isFinite(pending.expiresAt) &&
      pending.expiresAt > pending.createdAt &&
      Number.isFinite(pending.intervalMs) &&
      pending.intervalMs > 0
      ? pending
      : undefined;
  } catch {
    return undefined;
  }
}

export async function loadXiaoyinsiPendingAuthorization() {
  const value = await SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, secureStoreOptions);
  const pending = parseStoredPending(value);
  if (!pending && value) {
    await SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, secureStoreOptions);
  }
  return pending;
}

export async function loadXiaoyinsiCredentials(
  options: {
    captureGeneration?: (generation: number) => void;
  } = {}
): Promise<XiaoyinsiApiCredentials | undefined> {
  const generation = currentXiaoyinsiCredentialGeneration();
  options.captureGeneration?.(generation);
  let values: [string | null, string | null];
  try {
    values = await Promise.all([
      SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, secureStoreOptions),
      SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, secureStoreOptions)
    ]);
  } catch (error) {
    if (generation !== currentXiaoyinsiCredentialGeneration()) {
      return undefined;
    }
    throw error;
  }
  if (generation !== currentXiaoyinsiCredentialGeneration()) {
    return undefined;
  }
  const [apiKeyValue, clientIdValue] = values;
  const storedCredential = parseStoredXiaoyinsiCredential(apiKeyValue);
  const apiKey = storedCredential?.apiKey || '';
  const clientId = clientIdValue?.trim() || '';
  return apiKey && clientId ? { apiKey, clientId, scopes: storedCredential?.scopes || [] } : undefined;
}

async function stableClientId(keystore: XiaoyinsiKeystore) {
  const stored = (await SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, secureStoreOptions))?.trim();
  if (stored) {
    return stored;
  }
  const generated = (await keystore.randomHex(32)).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(generated)) {
    throw new XiaoyinsiAuthError('invalid-response', '无法生成小隐寺安装标识。');
  }
  await SecureStore.setItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, generated, secureStoreOptions);
  return generated;
}

export async function checkXiaoyinsiDeviceCodeCapability(dependencies: XiaoyinsiAuthDependencies = {}) {
  const response = await fetchWithTimeout(
    `${XIAOYINSI_BASE_URL}${AUTH_CAPABILITY_PATH}`,
    {
      method: 'HEAD',
      headers: { Accept: 'application/json' }
    },
    dependencies
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const version = Number(response.headers.get('Auth-Api-Version'));
  const enabled = response.headers.get('Auth-Api-Device-Code')?.toLowerCase() === 'true';
  if (!enabled || !Number.isFinite(version) || version < AUTH_API_VERSION) {
    throw new XiaoyinsiAuthError('unsupported', '站点暂不支持 App 授权');
  }
}

export async function beginXiaoyinsiDeviceAuth(dependencies: XiaoyinsiAuthDependencies = {}) {
  advanceXiaoyinsiCredentialGeneration();
  await checkXiaoyinsiDeviceCodeCapability(dependencies);
  const keystore = dependencies.keystore || xiaoyinsiKeystore;
  try {
    const clientId = await stableClientId(keystore);
    const nonce = (await keystore.randomHex(32)).trim().toLowerCase();
    const publicKey = (await keystore.getPublicKey()).trim();
    if (!/^[a-f0-9]{64}$/.test(nonce) || !publicKey.includes('BEGIN PUBLIC KEY')) {
      throw new XiaoyinsiAuthError('invalid-response', '无法创建小隐寺安全授权请求。');
    }
    const response = await postJson(
      DEVICE_CODE_PATH,
      {
        application_name: APPLICATION_NAME,
        scopes: AUTH_SCOPES.join(','),
        client_id: clientId,
        nonce,
        public_key: publicKey,
        padding: 'oaep'
      },
      dependencies
    );
    const data = await responseJson(response, '小隐寺授权请求返回内容格式不正确。');
    const pending = parsePendingResponse(data, nonce, nowFrom(dependencies));
    await SecureStore.setItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, JSON.stringify(pending), secureStoreOptions);
    return pending;
  } catch (error) {
    await clearPending(keystore, true).catch(() => undefined);
    throw error;
  }
}

async function clearPending(keystore: XiaoyinsiKeystore, deleteKey: boolean) {
  await SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, secureStoreOptions);
  if (deleteKey) {
    await keystore.deleteKey();
  }
}

async function persistRevocationCleanupMarker() {
  const results = await Promise.allSettled([
    SecureStore.setItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup, '1', secureStoreOptions),
    AsyncStorage.setItem(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup, '1')
  ]);
  return results.some((result) => result.status === 'fulfilled');
}

async function clearRevocationCleanupMarkers() {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup, secureStoreOptions),
    AsyncStorage.removeItem(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup)
  ]);
  return results.every((result) => result.status === 'fulfilled');
}

async function clearRevokedLocalAuthorization(
  keystore: XiaoyinsiKeystore,
  cleanupMarkerPersisted: boolean
): Promise<XiaoyinsiRevocationCleanupResult> {
  advanceXiaoyinsiCredentialGeneration();
  const [apiKeyDeletion, pendingDeletion, keyDeletion] = await Promise.allSettled([
    SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, secureStoreOptions),
    SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, secureStoreOptions),
    keystore.deleteKey()
  ]);
  const apiKeyDeleted = apiKeyDeletion.status === 'fulfilled';
  const pendingDeleted = pendingDeletion.status === 'fulfilled';
  const keystoreDeleted = keyDeletion.status === 'fulfilled' && keyDeletion.value;
  let pendingNeutralized = pendingDeleted;
  if (!pendingDeleted) {
    try {
      await SecureStore.setItemAsync(
        XIAOYINSI_AUTH_STORAGE_KEYS.pending,
        JSON.stringify({ revoked: true }),
        secureStoreOptions
      );
      pendingNeutralized = true;
    } catch {
      pendingNeutralized = false;
    }
  }
  let markerStillPersisted = cleanupMarkerPersisted;
  if ((!apiKeyDeleted || !pendingDeleted || !keystoreDeleted) && !markerStillPersisted) {
    markerStillPersisted = await persistRevocationCleanupMarker();
  }
  if (apiKeyDeleted && pendingDeleted && keystoreDeleted && cleanupMarkerPersisted) {
    markerStillPersisted = !(await clearRevocationCleanupMarkers());
  }
  return {
    complete: apiKeyDeleted && pendingDeleted && keystoreDeleted && !markerStillPersisted,
    apiKeyDeleted,
    pendingDeleted,
    pendingNeutralized,
    keystoreDeleted,
    cleanupMarkerPersisted: markerStillPersisted
  };
}

export async function hasXiaoyinsiRevocationCleanupPending() {
  const results = await Promise.allSettled([
    SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup, secureStoreOptions),
    AsyncStorage.getItem(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup)
  ]);
  if (results.some((result) => result.status === 'fulfilled' && Boolean(result.value?.trim()))) {
    return true;
  }
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  return false;
}

export async function retryXiaoyinsiRevocationCleanup(
  dependencies: Pick<XiaoyinsiAuthDependencies, 'keystore'> = {}
): Promise<XiaoyinsiRevocationCleanupResult> {
  const cleanupMarkerPersisted = await hasXiaoyinsiRevocationCleanupPending();
  return clearRevokedLocalAuthorization(dependencies.keystore || xiaoyinsiKeystore, cleanupMarkerPersisted);
}

function parseDecryptedPayload(value: string, expectedNonce: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new XiaoyinsiAuthError('decrypt-failed', '无法解密小隐寺授权结果，请重新授权。');
  }
  if (!isRecord(payload)) {
    throw new XiaoyinsiAuthError('decrypt-failed', '无法解密小隐寺授权结果，请重新授权。');
  }
  if (String(payload.nonce || '') !== expectedNonce) {
    throw new XiaoyinsiAuthError('nonce-mismatch', '小隐寺授权校验失败，请重新授权。');
  }
  const key = String(payload.key || '').trim();
  const api = Number(payload.api);
  if (!key || !Number.isFinite(api) || api < AUTH_API_VERSION) {
    throw new XiaoyinsiAuthError('decrypt-failed', '小隐寺授权结果不完整，请重新授权。');
  }
  return key;
}

export async function pollXiaoyinsiDeviceAuth(
  dependencies: XiaoyinsiAuthDependencies = {}
): Promise<XiaoyinsiPollResult> {
  const keystore = dependencies.keystore || xiaoyinsiKeystore;
  const pending = await loadXiaoyinsiPendingAuthorization();
  assertNotCanceled(dependencies);
  if (!pending) {
    return { status: 'idle' };
  }
  if (nowFrom(dependencies) >= pending.expiresAt) {
    await clearPending(keystore, true);
    return { status: 'expired_token' };
  }
  const response = await postJson(DEVICE_POLL_PATH, { device_code: pending.deviceCode }, dependencies);
  assertNotCanceled(dependencies);
  const data = await responseJson(response, '小隐寺授权轮询返回内容格式不正确。');
  assertNotCanceled(dependencies);
  const status = String(data.status || '');
  if (status === 'authorization_pending') {
    return { status };
  }
  if (status === 'access_denied' || status === 'expired_token') {
    await clearPending(keystore, true);
    return { status };
  }
  if (status !== 'authorized' || typeof data.payload !== 'string' || !data.payload.trim()) {
    throw new XiaoyinsiAuthError('invalid-response', '小隐寺返回了未知的授权状态，请重试。');
  }
  let apiKey: string;
  try {
    const decrypted = await keystore.decrypt(data.payload);
    apiKey = parseDecryptedPayload(decrypted, pending.nonce);
  } catch (error) {
    await clearPending(keystore, true);
    throw error instanceof XiaoyinsiAuthError
      ? error
      : new XiaoyinsiAuthError('decrypt-failed', '无法解密小隐寺授权结果，请重新授权。');
  }
  assertNotCanceled(dependencies);
  const [clientIdValue, previousApiKey] = await Promise.all([
    SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, secureStoreOptions),
    SecureStore.getItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, secureStoreOptions)
  ]);
  assertNotCanceled(dependencies);
  const clientId = clientIdValue?.trim();
  if (!clientId) {
    await clearPending(keystore, true);
    throw new XiaoyinsiAuthError('missing-client-id', '小隐寺安装标识已丢失，请重新授权。');
  }
  advanceXiaoyinsiCredentialGeneration();
  try {
    await SecureStore.setItemAsync(
      XIAOYINSI_AUTH_STORAGE_KEYS.apiKey,
      serializeXiaoyinsiCredential({ apiKey, scopes: AUTH_SCOPES }),
      secureStoreOptions
    );
    assertNotCanceled(dependencies);
    await SecureStore.deleteItemAsync(XIAOYINSI_AUTH_STORAGE_KEYS.pending, secureStoreOptions);
    assertNotCanceled(dependencies);
  } catch (error) {
    advanceXiaoyinsiCredentialGeneration();
    await restoreApiKey(previousApiKey);
    throw error;
  }
  return { status: 'authorized', credentials: { apiKey, clientId, scopes: [...AUTH_SCOPES] } };
}

export async function cancelXiaoyinsiDeviceAuth(dependencies: Pick<XiaoyinsiAuthDependencies, 'keystore'> = {}) {
  advanceXiaoyinsiCredentialGeneration();
  await clearPending(dependencies.keystore || xiaoyinsiKeystore, true);
}

export async function verifyXiaoyinsiCredentials(dependencies: XiaoyinsiAuthDependencies = {}): Promise<UserProfile> {
  const credentials = await loadXiaoyinsiCredentials();
  if (!credentials) {
    throw new Error('请先授权小隐寺');
  }
  return getXiaoyinsiCurrentUserProfile({
    credentials,
    fetcher: dependencies.fetcher,
    signal: dependencies.signal,
    timeoutMs: dependencies.timeoutMs
  });
}

export async function revokeXiaoyinsiAuthorization(dependencies: XiaoyinsiAuthDependencies = {}) {
  advanceXiaoyinsiCredentialGeneration();
  const credentials = await loadXiaoyinsiCredentials();
  if (!credentials) {
    throw new Error('请先授权小隐寺');
  }
  const response = await postJson(REVOKE_PATH, {}, dependencies, {
    'User-Api-Key': credentials.apiKey,
    'User-Api-Client-Id': credentials.clientId
  });
  await responseJson(response, '小隐寺撤销授权返回内容格式不正确。');
  const cleanupMarkerPersisted = await persistRevocationCleanupMarker();
  return clearRevokedLocalAuthorization(dependencies.keystore || xiaoyinsiKeystore, cleanupMarkerPersisted);
}

export function deviceAuthCountdown(expiresAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}

export function nextXiaoyinsiPollDelay(appState: string, now: number, lastPollAt: number | null, intervalMs: number) {
  if (appState !== 'active') {
    return null;
  }
  if (lastPollAt === null) {
    return 0;
  }
  return Math.max(0, lastPollAt + intervalMs - now);
}
