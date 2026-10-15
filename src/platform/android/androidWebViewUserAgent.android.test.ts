import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ accesses: 0, read: vi.fn() }));
vi.mock('react-native', () => ({
  NativeModules: {
    get NetworkProxyModule() {
      boundary.accesses++;
      return { getDefaultWebViewUserAgent: boundary.read };
    }
  }
}));

beforeEach(() => {
  vi.resetModules();
  boundary.accesses = 0;
  boundary.read.mockReset().mockResolvedValue('provider-identity');
});

describe('on-demand Android WebView identity', () => {
  it('imports without native initialization and shares the first requested identity', async () => {
    const owner = await import('./androidWebViewUserAgent.android');
    expect(boundary.accesses).toBe(0);
    expect(boundary.read).not.toHaveBeenCalled();
    const first = owner.getDefaultAndroidWebViewUserAgent();
    const second = owner.getDefaultAndroidWebViewUserAgent();
    expect(first).toBe(second);
    await expect(first).resolves.toBe('provider-identity');
    await expect(owner.getDefaultAndroidWebViewUserAgent()).resolves.toBe('provider-identity');
    expect(boundary.read).toHaveBeenCalledTimes(1);
  });

  it('retries after failed, empty or invalid provider results', async () => {
    const owner = await import('./androidWebViewUserAgent.android');
    boundary.read
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce('  ')
      .mockResolvedValueOnce({});
    await expect(owner.getDefaultAndroidWebViewUserAgent()).rejects.toThrow('provider unavailable');
    await expect(owner.getDefaultAndroidWebViewUserAgent()).rejects.toThrow();
    await expect(owner.getDefaultAndroidWebViewUserAgent()).rejects.toThrow();
    await expect(owner.getDefaultAndroidWebViewUserAgent()).resolves.toBe('provider-identity');
    expect(boundary.read).toHaveBeenCalledTimes(4);
  });
});
