import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    canUseBiometricAuthentication: vi.fn(() => true),
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store
  };
});

import * as SecureStore from 'expo-secure-store';
import { credentialVault } from './credentialVault';
import type { CredentialSite } from '@/domain/session/sessionContracts';

const secureStore = SecureStore as typeof SecureStore & { __store: Map<string, string> };

describe('credential vault', () => {
  beforeEach(() => {
    secureStore.__store.clear();
    vi.clearAllMocks();
    vi.mocked(SecureStore.canUseBiometricAuthentication).mockReturnValue(true);
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => secureStore.__store.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      secureStore.__store.set(key, value);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      secureStore.__store.delete(key);
    });
  });

  it('isolates all three sites and keeps summaries free of accounts and passwords', async () => {
    const sites: CredentialSite[] = ['nodeseek', 'linuxdo', 'yaohuo'];
    for (const site of sites) {
      await credentialVault.save(site, {
        account: `${site}-private-account`,
        password: `${site}-private-password`
      });
    }

    for (const site of sites) {
      await expect(credentialVault.readForFill(site)).resolves.toMatchObject({
        site,
        account: `${site}-private-account`,
        password: `${site}-private-password`
      });
      const summary = await credentialVault.getSummary(site);
      expect(summary).toEqual({
        site,
        state: 'saved',
        hasCredential: true,
        protection: 'biometric'
      });
      expect(JSON.stringify(summary)).not.toMatch(/private-account|private-password/);
    }

    const metadata = [...secureStore.__store.entries()]
      .filter(([key]) => key.endsWith('.summary'))
      .map(([, value]) => value)
      .join('');
    expect(metadata).not.toMatch(/private-account|private-password/);
  });

  it('uses biometric protection whenever it is available', async () => {
    await credentialVault.save('nodeseek', { account: 'alice', password: 'secret' });
    await credentialVault.readForFill('nodeseek');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'site-login-credential.nodeseek.value.0',
      expect.any(String),
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      'site-login-credential.nodeseek.value.0',
      expect.objectContaining({ requireAuthentication: true })
    );
  });

  it('continues to read credentials saved before value slots were introduced', async () => {
    secureStore.__store.set(
      'site-login-credential.nodeseek.summary',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        protection: 'biometric',
        state: 'saved'
      })
    );
    secureStore.__store.set(
      'site-login-credential.nodeseek.value',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        account: 'legacy-account',
        password: 'legacy-password',
        updatedAt: 1
      })
    );

    await expect(credentialVault.readForFill('nodeseek')).resolves.toMatchObject({
      account: 'legacy-account',
      password: 'legacy-password'
    });
  });

  it('requires explicit confirmation before falling back to device encryption', async () => {
    vi.mocked(SecureStore.canUseBiometricAuthentication).mockReturnValue(false);

    await expect(
      credentialVault.save('linuxdo', {
        account: 'alice',
        password: 'secret'
      })
    ).rejects.toMatchObject({
      code: 'biometric-unavailable',
      message: '当前设备无法使用用户身份认证，请确认后再使用本机加密保存'
    });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

    await expect(
      credentialVault.save('linuxdo', {
        account: 'alice',
        password: 'secret',
        allowUnprotected: true
      })
    ).resolves.toMatchObject({ protection: 'device' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'site-login-credential.linuxdo.value.0',
      expect.any(String),
      undefined
    );
  });

  it('keeps an explicit invalidated summary until the credential is saved again', async () => {
    await credentialVault.save('yaohuo', { account: 'alice', password: 'secret' });
    secureStore.__store.delete('site-login-credential.yaohuo.value.0');

    await expect(credentialVault.readForFill('yaohuo')).rejects.toMatchObject({
      code: 'invalidated'
    });
    await expect(credentialVault.getSummary('yaohuo')).resolves.toEqual({
      site: 'yaohuo',
      state: 'invalidated',
      hasCredential: false,
      protection: null
    });
    await expect(credentialVault.readForFill('yaohuo')).rejects.toMatchObject({ code: 'invalidated' });

    await credentialVault.save('yaohuo', { account: 'alice-2', password: 'secret-2' });
    await expect(credentialVault.getSummary('yaohuo')).resolves.toMatchObject({ state: 'saved' });
    await expect(credentialVault.readForFill('yaohuo')).resolves.toMatchObject({ account: 'alice-2' });
  });

  it('authenticates before deleting a biometric credential and preserves it on cancellation', async () => {
    await credentialVault.save('nodeseek', { account: 'alice', password: 'secret' });
    vi.mocked(SecureStore.getItemAsync)
      .mockImplementationOnce(async (key) => secureStore.__store.get(key) ?? null)
      .mockRejectedValueOnce(new Error('cancelled'));

    await expect(credentialVault.delete('nodeseek')).rejects.toThrow('cancelled');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      'site-login-credential.nodeseek.value.0',
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    await expect(credentialVault.getSummary('nodeseek')).resolves.toMatchObject({ state: 'saved' });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(true);

    await credentialVault.delete('nodeseek');
    await expect(credentialVault.getSummary('nodeseek')).resolves.toMatchObject({ state: 'missing' });
  });

  it('fully deletes metadata when a biometric credential is already missing', async () => {
    await credentialVault.save('nodeseek', { account: 'alice', password: 'secret' });
    secureStore.__store.delete('site-login-credential.nodeseek.value.0');

    await credentialVault.delete('nodeseek');

    await expect(credentialVault.getSummary('nodeseek')).resolves.toEqual({
      site: 'nodeseek',
      state: 'missing',
      hasCredential: false,
      protection: null
    });
  });

  it('removes a partially written secret when summary persistence fails', async () => {
    vi.mocked(SecureStore.setItemAsync)
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockRejectedValueOnce(new Error('summary write failed'));

    await expect(
      credentialVault.save('nodeseek', {
        account: 'private-account',
        password: 'private-password'
      })
    ).rejects.toThrow('summary write failed');

    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(false);
    expect(secureStore.__store.has('site-login-credential.nodeseek.summary')).toBe(false);
  });

  it('preserves the previous credential when an update fails before switching slots', async () => {
    await credentialVault.save('nodeseek', { account: 'old-account', password: 'old-password' });
    vi.mocked(SecureStore.setItemAsync)
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockRejectedValueOnce(new Error('summary write failed'));

    await expect(
      credentialVault.save('nodeseek', {
        account: 'new-account',
        password: 'new-password'
      })
    ).rejects.toThrow('summary write failed');

    await expect(credentialVault.readForFill('nodeseek')).resolves.toMatchObject({
      account: 'old-account',
      password: 'old-password'
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.1')).toBe(false);
  });

  it('commits an update and retries old-slot cleanup without reporting a false failure', async () => {
    await credentialVault.save('nodeseek', { account: 'old-account', password: 'old-password' });
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(
      credentialVault.save('nodeseek', {
        account: 'new-account',
        password: 'new-password'
      })
    ).resolves.toMatchObject({ state: 'saved' });

    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).toMatchObject({
      slot: 1,
      cleanupSlots: [0]
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(true);

    await expect(credentialVault.readForFill('nodeseek')).resolves.toMatchObject({
      account: 'new-account',
      password: 'new-password'
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(false);
    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).not.toHaveProperty(
      'cleanupSlots'
    );
  });

  it('retains every pending cleanup across consecutive updates', async () => {
    secureStore.__store.set(
      'site-login-credential.nodeseek.summary',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        protection: 'biometric',
        state: 'saved'
      })
    );
    secureStore.__store.set(
      'site-login-credential.nodeseek.value',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        account: 'legacy-account',
        password: 'legacy-password',
        updatedAt: 1
      })
    );
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === 'site-login-credential.nodeseek.value' || key === 'site-login-credential.nodeseek.value.0') {
        throw new Error('cleanup failed');
      }
      secureStore.__store.delete(key);
    });

    await credentialVault.save('nodeseek', { account: 'account-1', password: 'password-1' });
    await credentialVault.save('nodeseek', { account: 'account-2', password: 'password-2' });

    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).toMatchObject({
      slot: 1,
      cleanupSlots: ['legacy', 0]
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value')).toBe(true);
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(true);
  });

  it('retains pending cleanup when the active credential becomes invalidated', async () => {
    await credentialVault.save('nodeseek', { account: 'old-account', password: 'old-password' });
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('cleanup failed'));
    await credentialVault.save('nodeseek', { account: 'new-account', password: 'new-password' });
    secureStore.__store.delete('site-login-credential.nodeseek.value.1');
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === 'site-login-credential.nodeseek.value.0' || key === 'site-login-credential.nodeseek.value.1') {
        throw new Error('cleanup failed');
      }
      secureStore.__store.delete(key);
    });

    await expect(credentialVault.readForFill('nodeseek')).rejects.toMatchObject({ code: 'invalidated' });

    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).toMatchObject({
      state: 'invalidated',
      cleanupSlots: [0, 1]
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(true);

    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      secureStore.__store.delete(key);
    });
    await expect(credentialVault.getSummary('nodeseek')).resolves.toMatchObject({ state: 'invalidated' });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(false);
    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).not.toHaveProperty(
      'cleanupSlots'
    );
  });

  it('keeps invalidated metadata when rollback cannot delete the secret', async () => {
    vi.mocked(SecureStore.setItemAsync)
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockRejectedValueOnce(new Error('summary write failed'));
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(
      credentialVault.save('nodeseek', {
        account: 'private-account',
        password: 'private-password'
      })
    ).rejects.toThrow('清理未完成');

    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).toMatchObject({
      state: 'invalidated',
      cleanupSlots: [0]
    });
    await expect(credentialVault.getSummary('nodeseek')).resolves.toMatchObject({ state: 'invalidated' });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(false);
  });

  it('tracks a staged update when switching the summary and rollback cleanup both fail', async () => {
    await credentialVault.save('nodeseek', { account: 'old-account', password: 'old-password' });
    vi.mocked(SecureStore.setItemAsync)
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockImplementationOnce(async (key, value) => {
        secureStore.__store.set(key, value);
      })
      .mockRejectedValueOnce(new Error('summary switch failed'));
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('rollback cleanup failed'));

    await expect(
      credentialVault.save('nodeseek', {
        account: 'new-account',
        password: 'new-password'
      })
    ).rejects.toThrow('清理未完成');

    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).toMatchObject({
      slot: 0,
      cleanupSlots: [1]
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.1')).toBe(true);

    await expect(credentialVault.readForFill('nodeseek')).resolves.toMatchObject({
      account: 'old-account',
      password: 'old-password'
    });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.1')).toBe(false);
    expect(JSON.parse(secureStore.__store.get('site-login-credential.nodeseek.summary')!)).not.toHaveProperty(
      'cleanupSlots'
    );
  });

  it('serializes cleanup metadata writes with a concurrent save', async () => {
    secureStore.__store.set(
      'site-login-credential.nodeseek.summary',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        protection: 'biometric',
        state: 'saved',
        slot: 1,
        cleanupSlots: [0]
      })
    );
    secureStore.__store.set('site-login-credential.nodeseek.value.0', 'stale-value');
    secureStore.__store.set(
      'site-login-credential.nodeseek.value.1',
      JSON.stringify({
        version: 1,
        site: 'nodeseek',
        account: 'old-account',
        password: 'old-password',
        updatedAt: 1
      })
    );
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async (key) => {
      await cleanupGate;
      secureStore.__store.delete(key);
    });

    const loading = credentialVault.getSummary('nodeseek');
    await vi.waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1));
    const saving = credentialVault.save('nodeseek', { account: 'new-account', password: 'new-password' });
    await Promise.resolve();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

    releaseCleanup();
    await loading;
    await saving;

    await expect(credentialVault.readForFill('nodeseek')).resolves.toMatchObject({
      account: 'new-account',
      password: 'new-password'
    });
  });

  it('deletes an orphaned value even when its summary is missing', async () => {
    secureStore.__store.set('site-login-credential.nodeseek.value', 'orphaned-secret');

    await credentialVault.delete('nodeseek');

    expect(secureStore.__store.has('site-login-credential.nodeseek.value')).toBe(false);
  });

  it('keeps metadata and reports failure when an orphan cannot be deleted', async () => {
    await credentialVault.save('nodeseek', { account: 'alice', password: 'secret' });
    vi.mocked(SecureStore.getItemAsync)
      .mockImplementationOnce(async (key) => secureStore.__store.get(key) ?? null)
      .mockResolvedValueOnce(null);
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('delete failed'));

    await expect(credentialVault.delete('nodeseek')).rejects.toThrow('delete failed');

    await expect(credentialVault.getSummary('nodeseek')).resolves.toMatchObject({ state: 'saved' });
    expect(secureStore.__store.has('site-login-credential.nodeseek.value.0')).toBe(true);
  });

  it('rejects empty and oversized values before writing', async () => {
    await expect(
      credentialVault.save('nodeseek', {
        account: ' ',
        password: 'secret'
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      credentialVault.save('nodeseek', {
        account: 'alice',
        password: '密'.repeat(1000)
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
