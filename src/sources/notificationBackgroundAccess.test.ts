import * as SecureStore from 'expo-secure-store';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUserProfile: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn()
}));
vi.mock('./sourceRead', () => ({
  getCurrentUserProfile: mocks.getCurrentUserProfile
}));
vi.mock('@/sources/xiaoyinsi/auth', () => ({
  loadXiaoyinsiCredentials: vi.fn()
}));

import { probeBackgroundNotificationAccess } from './notificationBackgroundAccess';

describe('background notification access', () => {
  it('does not start the profile request when the source is disabled during credential loading', async () => {
    let resolveCredential!: (value: string | null) => void;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCredential = resolve;
        })
    );
    mocks.getCurrentUserProfile.mockResolvedValue({ id: '7', username: 'user' });
    let allowed = true;
    const probe = probeBackgroundNotificationAccess('nodeseek', new AbortController().signal, async () => {
      if (allowed) return;
      throw Object.assign(new Error('内容源已停用'), { reason: 'source-disabled', source: 'nodeseek' });
    });
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1));

    allowed = false;
    resolveCredential(null);

    await expect(probe).rejects.toMatchObject({ reason: 'source-disabled', source: 'nodeseek' });
    expect(mocks.getCurrentUserProfile).not.toHaveBeenCalled();
  });
});
