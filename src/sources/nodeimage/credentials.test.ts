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
  invalidateNodeImageApiKeyAuthorization,
  loadNodeImageApiKeyCredential,
  nodeImageApiKeyUseStatus,
  NODEIMAGE_API_KEY_STORAGE_KEY,
  saveNodeImageApiKeyForGeneration
} from './credentials';

describe('NodeImage credential persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a later clear authoritative over an older pending save', async () => {
    const values = new Map<string, string>();
    const saveStarted = Promise.withResolvers<void>();
    const allowSave = Promise.withResolvers<void>();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      saveStarted.resolve();
      await allowSave.promise;
      values.set(key, value);
    });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      values.delete(key);
    });

    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(generation, 'late-key', 'nodeseek:alice', 'nodeseek:alice');
    await saveStarted.promise;
    const clearing = clearNodeImageApiKey();
    allowSave.resolve();
    await Promise.all([saving, clearing]);

    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBeUndefined();
  });

  it('restores the prior key when an authorization is canceled during its save', async () => {
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
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      values.delete(key);
    });

    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(
      generation,
      'late-authorized-key',
      'nodeseek:alice',
      'nodeseek:alice'
    );
    await authSaveStarted.promise;
    invalidateNodeImageApiKeyAuthorization();
    allowAuthSave.resolve();
    await saving;

    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe('previous-key');
  });

  it('waits for cancellation compensation before returning a stored credential', async () => {
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, 'previous-key']]);
    const candidateWritten = Promise.withResolvers<void>();
    const finishCandidateWrite = Promise.withResolvers<void>();
    let writeCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      values.set(key, value);
      if (++writeCount === 1) {
        candidateWritten.resolve();
        await finishCandidateWrite.promise;
      }
    });
    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(generation, 'canceled-key', 'nodeseek:alice', 'nodeseek:alice');
    await candidateWritten.promise;
    invalidateNodeImageApiKeyAuthorization();

    const loading = loadNodeImageApiKeyCredential();
    finishCandidateWrite.resolve();
    await expect(saving).resolves.toBeUndefined();

    await expect(loading).resolves.toMatchObject({ apiKey: 'previous-key' });
    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe('previous-key');
  });

  it('repairs a failed cancellation compensation before returning a stored credential', async () => {
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, 'previous-key']]);
    const candidateWritten = Promise.withResolvers<void>();
    const finishCandidateWrite = Promise.withResolvers<void>();
    const recoveryError = new Error('restore failed');
    let writeCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      writeCount += 1;
      if (writeCount === 2) throw recoveryError;
      values.set(key, value);
      if (writeCount === 1) {
        candidateWritten.resolve();
        await finishCandidateWrite.promise;
      }
    });
    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(generation, 'canceled-key', 'nodeseek:alice', 'nodeseek:alice');
    await candidateWritten.promise;
    invalidateNodeImageApiKeyAuthorization();
    finishCandidateWrite.resolve();
    await expect(saving).rejects.toBe(recoveryError);

    await expect(loadNodeImageApiKeyCredential()).resolves.toMatchObject({ apiKey: 'previous-key' });
    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe('previous-key');
  });

  it('rejects a failed repair and lets an explicit clear settle the credential', async () => {
    const values = new Map<string, string>();
    const candidateWritten = Promise.withResolvers<void>();
    const finishCandidateWrite = Promise.withResolvers<void>();
    const recoveryError = new Error('delete failed');
    let deleteCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      values.set(key, value);
      candidateWritten.resolve();
      await finishCandidateWrite.promise;
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (++deleteCount <= 2) throw recoveryError;
      values.delete(key);
    });
    const generation = beginNodeImageApiKeyAuthorization();
    const saving = saveNodeImageApiKeyForGeneration(generation, 'canceled-key', 'nodeseek:alice', 'nodeseek:alice');
    await candidateWritten.promise;
    invalidateNodeImageApiKeyAuthorization();
    finishCandidateWrite.resolve();
    await expect(saving).rejects.toBe(recoveryError);

    await expect(loadNodeImageApiKeyCredential()).rejects.toBe(recoveryError);
    await expect(clearNodeImageApiKey()).resolves.toBe(true);

    await expect(loadNodeImageApiKeyCredential()).resolves.toBeNull();
    expect(values.has(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe(false);
  });

  it('repairs the stable baseline before a later authorization can save and roll back', async () => {
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, 'previous-key']]);
    const firstCandidateWritten = Promise.withResolvers<void>();
    const finishFirstCandidate = Promise.withResolvers<void>();
    const nextCandidateWritten = Promise.withResolvers<void>();
    const finishNextCandidate = Promise.withResolvers<void>();
    const recoveryError = new Error('restore failed');
    let writeCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      writeCount += 1;
      if (writeCount === 2) throw recoveryError;
      values.set(key, value);
      if (writeCount === 1) {
        firstCandidateWritten.resolve();
        await finishFirstCandidate.promise;
      } else if (value.includes('next-canceled-key')) {
        nextCandidateWritten.resolve();
        await finishNextCandidate.promise;
      }
    });
    const firstGeneration = beginNodeImageApiKeyAuthorization();
    const firstSaving = saveNodeImageApiKeyForGeneration(
      firstGeneration,
      'first-canceled-key',
      'nodeseek:alice',
      'nodeseek:alice'
    );
    await firstCandidateWritten.promise;
    invalidateNodeImageApiKeyAuthorization();
    finishFirstCandidate.resolve();
    await expect(firstSaving).rejects.toBe(recoveryError);

    const nextGeneration = beginNodeImageApiKeyAuthorization();
    const nextSaving = saveNodeImageApiKeyForGeneration(
      nextGeneration,
      'next-canceled-key',
      'nodeseek:alice',
      'nodeseek:alice'
    );
    await nextCandidateWritten.promise;
    invalidateNodeImageApiKeyAuthorization();
    finishNextCandidate.resolve();
    await expect(nextSaving).resolves.toBeUndefined();

    await expect(loadNodeImageApiKeyCredential()).resolves.toMatchObject({ apiKey: 'previous-key' });
    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe('previous-key');
  });

  it('restores the prior key when the NodeSeek epoch changes during persistence', async () => {
    const previousCredential = JSON.stringify({
      apiKey: 'previous-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:bob' },
      version: 1
    });
    const values = new Map<string, string>([[NODEIMAGE_API_KEY_STORAGE_KEY, previousCredential]]);
    const authSaveStarted = Promise.withResolvers<void>();
    const allowAuthSave = Promise.withResolvers<void>();
    let authorizationCurrent = true;
    let writeCount = 0;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
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
    const saving = saveNodeImageApiKeyForGeneration(
      generation,
      'stale-authorized-key',
      'nodeseek:alice',
      'nodeseek:alice',
      () => authorizationCurrent
    );
    await authSaveStarted.promise;
    authorizationCurrent = false;
    allowAuthSave.resolve();

    await expect(saving).resolves.toBeUndefined();
    expect(values.get(NODEIMAGE_API_KEY_STORAGE_KEY)).toBe(previousCredential);
  });

  it.each(['same authorization', 'new authorization'])(
    'retries an old read after a newer key is saved in the %s',
    async (authorization) => {
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

      const initialGeneration = beginNodeImageApiKeyAuthorization();
      const loading = loadNodeImageApiKeyCredential();
      await firstReadStarted.promise;
      const generation =
        authorization === 'new authorization' ? beginNodeImageApiKeyAuthorization() : initialGeneration;
      const saving = saveNodeImageApiKeyForGeneration(generation, 'new-key', 'nodeseek:alice', 'nodeseek:alice');
      await saving;
      allowFirstRead.resolve();

      await expect(loading).resolves.toMatchObject({ apiKey: 'new-key' });
      expect(readCount).toBe(3);
    }
  );

  it('keeps a legacy plain-text key unverified until the user saves it again', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('legacy-key');

    const credential = await loadNodeImageApiKeyCredential();

    expect(credential).toEqual({
      apiKey: 'legacy-key',
      ownership: { kind: 'unverified' },
      version: 1
    });
    expect(nodeImageApiKeyUseStatus(credential, 'nodeseek:alice')).toBe('confirmation-required');
  });

  it('binds an automatically authorized key to the confirmed NodeSeek identity', async () => {
    const values = new Map<string, string>();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      values.set(key, value);
    });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) || null);
    const generation = beginNodeImageApiKeyAuthorization();

    await saveNodeImageApiKeyForGeneration(generation, 'owned-key', 'nodeseek:alice', 'nodeseek:alice');
    const credential = await loadNodeImageApiKeyCredential();

    expect(nodeImageApiKeyUseStatus(credential, 'nodeseek:alice')).toBe('usable');
    expect(nodeImageApiKeyUseStatus(credential, 'nodeseek:bob')).toBe('identity-mismatch');
  });

  it.each([
    ['nodeseek:alice', 'nodeseek:bob'],
    ['nodeseek:anonymous', 'nodeseek:anonymous'],
    ['nodeseek:alice', 'nodeseek:anonymous'],
    ['nodeseek:alice', undefined as unknown as string]
  ])(
    'writes nothing unless authorization and settled owners are the same confirmed identity',
    async (authorizationOwner, settledOwner) => {
      const generation = beginNodeImageApiKeyAuthorization();

      await expect(
        saveNodeImageApiKeyForGeneration(generation, 'must-not-be-written', authorizationOwner, settledOwner)
      ).resolves.toBeUndefined();

      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    }
  );
});
