import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));

import * as SecureStore from 'expo-secure-store';
import {
  beginNodeImageApiKeyAuthorization,
  clearNodeImageApiKey,
  loadNodeImageApiKey,
  NODEIMAGE_API_KEY_STORAGE_KEY,
  restoreNodeImageApiKeyAfterCanceledAuthorization,
  saveNodeImageApiKeyForGeneration,
  saveNodeImageApiKey
} from './nodeimageCredentials';

describe('NodeImage credential persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('REG-ACCOUNT-010 keeps a later clear authoritative over an older pending save', async () => {
    const values = new Map<string, string>();
    const saveStarted = Promise.withResolvers<void>();
    const allowSave = Promise.withResolvers<void>();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      saveStarted.resolve();
      await allowSave.promise;
      values.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      values.delete(key);
    });

    const saving = saveNodeImageApiKey('late-key');
    await saveStarted.promise;
    const clearing = clearNodeImageApiKey();
    allowSave.resolve();
    await Promise.all([saving, clearing]);

    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBeUndefined();
  });

  it('REG-ACCOUNT-010 restores the prior key when an authorization is canceled during its save', async () => {
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, 'previous-key']]);
    const authSaveStarted = Promise.withResolvers<void>();
    const allowAuthSave = Promise.withResolvers<void>();
    let writeCount = 0;
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      writeCount += 1;
      if (writeCount === 1) {
        authSaveStarted.resolve();
        await allowAuthSave.promise;
      }
      values.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      values.delete(key);
    });

    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(generation, 'late-authorized-key');
    await authSaveStarted.promise;
    const restoring = restoreNodeImageApiKeyAfterCanceledAuthorization('previous-key');
    allowAuthSave.resolve();
    await Promise.all([saving, restoring]);

    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe('previous-key');
  });

  it('REG-ACCOUNT-010 retries an old read after a newer key is saved', async () => {
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, 'old-key']]);
    const firstReadStarted = Promise.withResolvers<void>();
    const allowFirstRead = Promise.withResolvers<void>();
    let readCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      readCount += 1;
      const value = values.get(key) || null;
      if (readCount === 1) {
        firstReadStarted.resolve();
        await allowFirstRead.promise;
      }
      return value;
    });
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      values.set(key, value);
    });

    const loading = loadNodeImageApiKey();
    await firstReadStarted.promise;
    const saving = saveNodeImageApiKey('new-key');
    allowFirstRead.resolve();
    await saving;

    await expect(loading).resolves.toBe('new-key');
    expect(readCount).toBe(2);
  });
});
