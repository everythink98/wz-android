import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fallbackStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => fallbackStore.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      fallbackStore.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      fallbackStore.set(key, value);
    })
  }
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android' }
}));

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginXiaoyinsiDeviceAuth,
  cancelXiaoyinsiDeviceAuth,
  currentXiaoyinsiCredentialGeneration,
  deviceAuthCountdown,
  hasXiaoyinsiRevocationCleanupPending,
  loadXiaoyinsiCredentials,
  nextXiaoyinsiPollDelay,
  pollXiaoyinsiDeviceAuth,
  retryXiaoyinsiRevocationCleanup,
  revokeXiaoyinsiAuthorization,
  verifyXiaoyinsiCredentials,
  XIAOYINSI_AUTH_STORAGE_KEYS,
  XiaoyinsiAuthError
} from '@/xiaoyinsiAuth';
import type { XiaoyinsiKeystore } from '@/platform/android/xiaoyinsiKeystore';
import { readFileSync } from 'node:fs';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function memoryStore() {
  const values = new Map<string, string>();
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) ?? null);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    values.delete(key);
  });
  return values;
}

function keystore(): XiaoyinsiKeystore {
  return {
    getPublicKey: vi.fn(async () => '-----BEGIN PUBLIC KEY-----\nPUBLIC\n-----END PUBLIC KEY-----'),
    randomHex: vi.fn().mockResolvedValueOnce('c'.repeat(64)).mockResolvedValue('e'.repeat(64)),
    decrypt: vi.fn(async () => JSON.stringify({ key: 'user-api-secret', nonce: 'e'.repeat(64), push: false, api: 4 })),
    deleteKey: vi.fn(async () => true)
  };
}

describe('xiaoyinsi Device Code auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fallbackStore.clear();
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => fallbackStore.get(key) ?? null);
    vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
      fallbackStore.delete(key);
    });
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      fallbackStore.set(key, value);
    });
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('[REG-XIAOYINSI-005] ignores a credential read superseded by a newer authorization mutation', async () => {
    const apiKey = Promise.withResolvers<string | null>();
    const clientId = Promise.withResolvers<string | null>();
    vi.mocked(SecureStore.getItemAsync).mockImplementation((key) =>
      key === XIAOYINSI_AUTH_STORAGE_KEYS.apiKey ? apiKey.promise : clientId.promise
    );
    let capturedGeneration = -1;
    const read = loadXiaoyinsiCredentials({
      captureGeneration: (generation) => {
        capturedGeneration = generation;
      }
    });
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(2));

    await cancelXiaoyinsiDeviceAuth({ keystore: keystore() });
    apiKey.resolve('old-key');
    clientId.resolve('old-client');

    await expect(read).resolves.toBeUndefined();
    expect(currentXiaoyinsiCredentialGeneration()).toBeGreaterThan(capturedGeneration);
  });

  it('checks capability and persists a ten-minute read/write device request without callback fields', async () => {
    const store = memoryStore();
    const crypto = keystore();
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === 'HEAD') {
        expect(url.pathname).toBe('/user-api-key/new');
        return new Response(null, { headers: { 'Auth-Api-Version': '4', 'Auth-Api-Device-Code': 'true' } });
      }
      expect(url.pathname).toBe('/user-api-key/device.json');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        application_name: '阅坛 Android',
        scopes: 'read,write',
        client_id: 'c'.repeat(64),
        nonce: 'e'.repeat(64),
        public_key: '-----BEGIN PUBLIC KEY-----\nPUBLIC\n-----END PUBLIC KEY-----',
        padding: 'oaep'
      });
      expect(body).not.toHaveProperty('auth_redirect');
      expect(body).not.toHaveProperty('push_url');
      return json({
        device_code: 'd'.repeat(64),
        user_code: 'ABCD-2345',
        verification_uri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verification_uri_with_request: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expires_in: 600,
        interval: 5
      });
    });

    const result = await beginXiaoyinsiDeviceAuth({ fetcher, keystore: crypto, now: () => 1_000 });

    expect(result).toMatchObject({ userCode: 'ABCD-2345', expiresAt: 601_000, intervalMs: 5_000 });
    expect(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.clientId)).toBe('c'.repeat(64));
    expect(JSON.parse(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.pending)!)).toMatchObject({
      deviceCode: 'd'.repeat(64),
      nonce: 'e'.repeat(64),
      userCode: 'ABCD-2345'
    });
    expect([...store.keys()]).not.toContain(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey);
  });

  it('keeps pending state for pending/network responses and saves only a nonce-matched decrypted key', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        nonce: 'e'.repeat(64),
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );
    const pendingFetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ device_code: 'd'.repeat(64) });
      return json({ status: 'authorization_pending' });
    });

    await expect(
      pollXiaoyinsiDeviceAuth({ fetcher: pendingFetcher, keystore: crypto, now: () => 2_000 })
    ).resolves.toEqual({ status: 'authorization_pending' });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(true);

    const networkFetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      pollXiaoyinsiDeviceAuth({ fetcher: networkFetcher, keystore: crypto, now: () => 3_000 })
    ).rejects.toThrow('offline');
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(true);

    const authorizedFetcher = vi.fn(async () => json({ status: 'authorized', payload: 'encrypted-payload' }));
    await expect(
      pollXiaoyinsiDeviceAuth({ fetcher: authorizedFetcher, keystore: crypto, now: () => 4_000 })
    ).resolves.toEqual({
      status: 'authorized',
      credentials: { apiKey: 'user-api-secret', clientId: 'client' }
    });
    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted-payload');
    expect(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe('user-api-secret');
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
    expect(await loadXiaoyinsiCredentials()).toEqual({ apiKey: 'user-api-secret', clientId: 'client' });

    await expect(
      pollXiaoyinsiDeviceAuth({ fetcher: authorizedFetcher, keystore: crypto, now: () => 5_000 })
    ).resolves.toEqual({ status: 'idle' });
    expect(authorizedFetcher).toHaveBeenCalledTimes(1);
    expect(crypto.decrypt).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-005] does not persist a late authorized payload after the poll is canceled', async () => {
    const store = memoryStore();
    const crypto = keystore();
    const abortController = new AbortController();
    let finishDecrypt!: (value: string) => void;
    vi.mocked(crypto.decrypt).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDecrypt = resolve;
        })
    );
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'old-key');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );
    const poll = pollXiaoyinsiDeviceAuth({
      fetcher: async () => json({ status: 'authorized', payload: 'cipher' }),
      keystore: crypto,
      now: () => 2_000,
      signal: abortController.signal
    });
    await vi.waitFor(() => expect(crypto.decrypt).toHaveBeenCalledTimes(1));

    abortController.abort();
    finishDecrypt(JSON.stringify({ key: 'late-key', nonce: 'e'.repeat(64), api: 4 }));

    await expect(poll).rejects.toThrow('请求已取消');
    expect(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe('old-key');
  });

  it('rejects a wrong nonce or malformed payload without storing a token', async () => {
    const store = memoryStore();
    const crypto = keystore();
    vi.mocked(crypto.decrypt).mockResolvedValue(JSON.stringify({ key: 'stolen', nonce: 'wrong', api: 4 }));
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );

    await expect(
      pollXiaoyinsiDeviceAuth({
        fetcher: async () => json({ status: 'authorized', payload: 'cipher' }),
        keystore: crypto,
        now: () => 2_000
      })
    ).rejects.toMatchObject({ code: 'nonce-mismatch' });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe(false);
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
  });

  it('rejects an undecryptable ciphertext and deletes pending key material without storing a token', async () => {
    const store = memoryStore();
    const crypto = keystore();
    vi.mocked(crypto.decrypt).mockRejectedValue(new Error('bad ciphertext'));
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );

    await expect(
      pollXiaoyinsiDeviceAuth({
        fetcher: async () => json({ status: 'authorized', payload: 'invalid-ciphertext' }),
        keystore: crypto,
        now: () => 2_000
      })
    ).rejects.toMatchObject({ code: 'decrypt-failed' });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe(false);
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
    expect(crypto.deleteKey).toHaveBeenCalledTimes(1);
  });

  it('redacts Device Code secrets and verification query parameters from diagnostic transport events', async () => {
    memoryStore();
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('session', 'request', { source: 'xiaoyinsi' });
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { headers: { 'Auth-Api-Version': '4', 'Auth-Api-Device-Code': 'true' } });
      }
      return json({
        device_code: 'd'.repeat(64),
        user_code: 'ABCD-2345',
        verification_uri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verification_uri_with_request: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expires_in: 600,
        interval: 5
      });
    });

    await beginXiaoyinsiDeviceAuth({
      fetcher: withDiagnosticFetcher(trace, fetcher),
      keystore: keystore(),
      now: () => 1_000
    });
    finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi' });

    expect(lines.map((line) => JSON.parse(line).endpoint).filter(Boolean)).toEqual(['auth', 'auth', 'auth', 'auth']);
    expect(lines.join('')).not.toMatch(
      /ABCD-2345|SAFE1234|request=|d{32,}|e{32,}|BEGIN PUBLIC KEY|user-api-key\/activate/i
    );
  });

  it.each([
    ['access_denied', 'access_denied'],
    ['expired_token', 'expired_token']
  ] as const)('handles %s as a terminal response', async (serverStatus, expectedStatus) => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );
    await expect(
      pollXiaoyinsiDeviceAuth({
        fetcher: async () => json({ status: serverStatus }),
        keystore: crypto,
        now: () => 2_000
      })
    ).resolves.toEqual({ status: expectedStatus });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
  });

  it('expires locally, cancels cleanly, and never polls while the app is in background', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 2_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );
    const fetcher = vi.fn();
    await expect(pollXiaoyinsiDeviceAuth({ fetcher, keystore: crypto, now: () => 2_001 })).resolves.toEqual({
      status: 'expired_token'
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(deviceAuthCountdown(5_900, 1_000)).toBe(5);
    expect(nextXiaoyinsiPollDelay('background', 10_000, 5_000, 4_000)).toBeNull();
    expect(nextXiaoyinsiPollDelay('active', 10_000, 5_000, 4_000)).toBe(0);
    expect(nextXiaoyinsiPollDelay('active', 6_000, 5_000, 4_000)).toBe(3_000);

    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.pending, '{}');
    await cancelXiaoyinsiDeviceAuth({ keystore: crypto });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
    expect(crypto.deleteKey).toHaveBeenCalled();
  });

  it('verifies the session and only clears local security material after server revocation succeeds', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'secret');
    const verifyFetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('User-Api-Key')).toBe('secret');
      expect(new Headers(init?.headers).get('User-Api-Client-Id')).toBe('client');
      return json({ current_user: { username: 'alice', name: 'Alice' } });
    });
    await expect(verifyXiaoyinsiCredentials({ fetcher: verifyFetcher })).resolves.toMatchObject({ username: 'alice' });

    await expect(
      revokeXiaoyinsiAuthorization({ fetcher: async () => json({ errors: ['no'] }, 500), keystore: crypto })
    ).rejects.toThrow('HTTP 500');
    expect(await loadXiaoyinsiCredentials()).toEqual({ apiKey: 'secret', clientId: 'client' });
    expect(crypto.deleteKey).not.toHaveBeenCalled();

    await expect(
      revokeXiaoyinsiAuthorization({
        fetcher: async (_input, init) => {
          expect(init?.method).toBe('POST');
          return json({ success: 'OK' });
        },
        keystore: crypto
      })
    ).resolves.toMatchObject({ complete: true });
    expect(await loadXiaoyinsiCredentials()).toBeUndefined();
    expect(crypto.deleteKey).toHaveBeenCalled();
  });

  it('[REG-XIAOYINSI-005] reports partial local cleanup after server revocation and still attempts every local deletion', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'secret');
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.apiKey) {
        throw new Error('secure store unavailable');
      }
      store.delete(key);
    });

    await expect(
      revokeXiaoyinsiAuthorization({
        fetcher: async () => json({ success: 'OK' }),
        keystore: crypto
      })
    ).resolves.toMatchObject({ complete: false, apiKeyDeleted: false });
    expect(crypto.deleteKey).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-005] persists revoked cleanup state before a failed pending deletion can be restored', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'secret');
    store.set(
      XIAOYINSI_AUTH_STORAGE_KEYS.pending,
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'ABCD2345',
        nonce: 'e'.repeat(64),
        verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
        verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=SAFE1234',
        expiresAt: 601_000,
        intervalMs: 5_000,
        createdAt: 1_000
      })
    );
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.pending) {
        throw new Error('pending delete unavailable');
      }
      store.delete(key);
    });

    await expect(
      revokeXiaoyinsiAuthorization({
        fetcher: async () => json({ success: 'OK' }),
        keystore: crypto
      })
    ).resolves.toMatchObject({ complete: false, pendingDeleted: false });
    expect(store.get('xiaoyinsi-auth.revoked-cleanup')).toBe('1');
    expect(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).not.toContain('deviceCode');
  });

  it('[REG-XIAOYINSI-005] retries persisted revocation cleanup before authorization recovery', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'revoked-secret');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.pending, JSON.stringify({ revoked: true }));
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup, '1');

    await expect(retryXiaoyinsiRevocationCleanup({ keystore: crypto })).resolves.toMatchObject({
      complete: true,
      cleanupMarkerPersisted: false
    });

    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe(false);
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup)).toBe(false);
    expect(crypto.deleteKey).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-005] retries durable tombstone persistence after both initial writes fail', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'revoked-secret');
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup) {
        throw new Error('cleanup marker unavailable');
      }
      store.set(key, value);
    });
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('fallback marker unavailable'));
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.apiKey) {
        throw new Error('secure store unavailable');
      }
      store.delete(key);
    });

    await expect(
      revokeXiaoyinsiAuthorization({
        fetcher: async () => json({ success: 'OK' }),
        keystore: crypto
      })
    ).resolves.toMatchObject({
      complete: false,
      apiKeyDeleted: false,
      cleanupMarkerPersisted: true
    });
    expect(store.get(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe('revoked-secret');
    await expect(hasXiaoyinsiRevocationCleanupPending()).resolves.toBe(true);

    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      store.delete(key);
    });
    await expect(retryXiaoyinsiRevocationCleanup({ keystore: crypto })).resolves.toMatchObject({
      complete: true,
      cleanupMarkerPersisted: false
    });
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey)).toBe(false);
    expect(crypto.deleteKey).toHaveBeenCalledTimes(2);
  });

  it('[REG-XIAOYINSI-005] persists a fallback tombstone when SecureStore cannot write it', async () => {
    const store = memoryStore();
    const crypto = keystore();
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.clientId, 'client');
    store.set(XIAOYINSI_AUTH_STORAGE_KEYS.apiKey, 'revoked-secret');
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.revokedCleanup) {
        throw new Error('cleanup marker unavailable');
      }
      store.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === XIAOYINSI_AUTH_STORAGE_KEYS.apiKey) {
        throw new Error('secure store unavailable');
      }
      store.delete(key);
    });

    await expect(
      revokeXiaoyinsiAuthorization({
        fetcher: async () => json({ success: 'OK' }),
        keystore: crypto
      })
    ).resolves.toMatchObject({
      complete: false,
      apiKeyDeleted: false,
      cleanupMarkerPersisted: true
    });
    await expect(hasXiaoyinsiRevocationCleanupPending()).resolves.toBe(true);

    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      store.delete(key);
    });
    await expect(retryXiaoyinsiRevocationCleanup({ keystore: crypto })).resolves.toMatchObject({
      complete: true,
      cleanupMarkerPersisted: false
    });
    await expect(hasXiaoyinsiRevocationCleanupPending()).resolves.toBe(false);
  });

  it('rejects unsupported Device Code capability without creating key material', async () => {
    memoryStore();
    const crypto = keystore();
    await expect(
      beginXiaoyinsiDeviceAuth({
        fetcher: async () => new Response(null, { headers: { 'Auth-Api-Version': '3' } }),
        keystore: crypto
      })
    ).rejects.toEqual(new XiaoyinsiAuthError('unsupported', '站点暂不支持 App 授权'));
    expect(crypto.getPublicKey).not.toHaveBeenCalled();
  });

  it('cleans pending Keystore material when creating the device request fails', async () => {
    const store = memoryStore();
    const crypto = keystore();
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { headers: { 'Auth-Api-Version': '4', 'Auth-Api-Device-Code': 'true' } });
      }
      throw new Error('network request failed');
    });

    await expect(beginXiaoyinsiDeviceAuth({ fetcher, keystore: crypto })).rejects.toThrow('network request failed');
    expect(store.has(XIAOYINSI_AUTH_STORAGE_KEYS.pending)).toBe(false);
    expect(crypto.deleteKey).toHaveBeenCalledTimes(1);
  });

  it('keeps RSA private keys in Android Keystore and excludes SecureStore from Android backup', () => {
    const plugin = readFileSync('plugins/withXiaoyinsiAuthModule.js', 'utf8');
    const appConfig = JSON.parse(readFileSync('app.json', 'utf8'));
    expect(plugin).toContain('KeyProperties.KEY_ALGORITHM_RSA');
    expect(plugin).toContain('.setKeySize(2048)');
    expect(plugin).toContain('RSA/ECB/OAEPWithSHA-1AndMGF1Padding');
    expect(plugin).not.toMatch(/privateKey\.encoded|promise\.resolve\(privateKey/);
    expect(appConfig.expo.plugins).toContain('./plugins/withXiaoyinsiAuthModule');
    expect(appConfig.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: true }]);
  });
});
