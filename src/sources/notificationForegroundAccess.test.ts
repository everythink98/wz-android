import { describe, expect, it, vi } from 'vitest';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { readForegroundNotificationAccess } from './notificationForegroundAccess';

function session(source: SiteSessionViewModel['site']): SiteSessionViewModel {
  return {
    site: source,
    status: 'logged-in',
    statusLabel: '已登录',
    summaryLabel: '已登录',
    cookieSummary: [],
    isVerified: true,
    isLoggedIn: true,
    isVerifying: false,
    canWrite: true,
    identityTrust: 'confirmed',
    currentUser: {
      source,
      id: '42',
      username: 'alice',
      displayName: 'Alice',
      topics: [],
      url: 'https://example.com/u/alice'
    }
  };
}

describe('foreground notification access', () => {
  it('binds requests to the confirmed session identity', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      readForegroundNotificationAccess({ source: 'nodeseek', session: session('nodeseek'), fetcher })
    ).resolves.toMatchObject({ identityKey: 'nodeseek:42', userId: '42', username: 'alice', fetcher });
  });

  it.each(['pending', 'unknown'] as const)('rejects a %s identity before transport', async (identityTrust) => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      readForegroundNotificationAccess({
        source: 'linuxdo',
        session: { ...session('linuxdo'), identityTrust },
        fetcher
      })
    ).rejects.toThrow('账号身份尚未确认');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a legacy Xiaoyinsi credential', async () => {
    await expect(
      readForegroundNotificationAccess({
        source: 'xiaoyinsi',
        session: session('xiaoyinsi'),
        fetcher: vi.fn<typeof fetch>(),
        loadXiaoyinsiCredentials: async () => ({ apiKey: 'key', clientId: 'client', scopes: ['read', 'write'] })
      })
    ).rejects.toThrow('升级授权');
  });
});
