import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ NativeModules: {} }));

import { clearManagedLoginCookies, readManagedCookieHeader, type ManagedCookieNativeModule } from './managedCookies';

describe('managed WebView Cookie boundary', () => {
  it('preserves the difference between an empty exact-url result and an unsupported bridge', async () => {
    const exactUrl = 'https://linux.do/session/current.json';
    const supported: ManagedCookieNativeModule = {
      readManagedCookieHeader: vi.fn(async () => ({ status: 'ok', header: '' }))
    };

    await expect(readManagedCookieHeader(exactUrl, supported)).resolves.toEqual({
      status: 'ok',
      header: ''
    });
    expect(supported.readManagedCookieHeader).toHaveBeenCalledWith(exactUrl);
    await expect(readManagedCookieHeader(exactUrl, {})).resolves.toEqual({
      status: 'unsupported'
    });
  });

  it('reports native read failures as unknown instead of anonymous', async () => {
    const module: ManagedCookieNativeModule = {
      readManagedCookieHeader: vi.fn(async () => {
        throw new Error('CookieManager unavailable');
      })
    };

    await expect(readManagedCookieHeader('https://www.nodeseek.com/', module)).resolves.toEqual({
      status: 'error',
      message: 'CookieManager unavailable'
    });
  });

  it('only exposes an explicit source-scoped login-cookie clear command', async () => {
    const module: ManagedCookieNativeModule = {
      clearManagedLoginCookies: vi.fn(async () => true)
    };

    await expect(clearManagedLoginCookies('yaohuo', module)).resolves.toBe(true);
    expect(module.clearManagedLoginCookies).toHaveBeenCalledWith('yaohuo');
  });
});
