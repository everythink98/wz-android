import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ NativeModules: {} }));

import {
  clearManagedLoginCookies,
  managedCookieSourceForUrl,
  readMediaCookieHeader,
  readManagedCookieHeader,
  type ManagedCookieNativeModule
} from './managedCookies';

describe('managed WebView Cookie boundary', () => {
  it('recognizes only exact managed HTTPS hosts', () => {
    expect(managedCookieSourceForUrl('https://www.nodeseek.com/private/image.png')).toBe('nodeseek');
    expect(managedCookieSourceForUrl('https://linux.do/session/current.json')).toBe('linuxdo');
    expect(managedCookieSourceForUrl('https://evil-linux.do.example/image.png')).toBeNull();
    expect(managedCookieSourceForUrl('http://linux.do/image.png')).toBeNull();
    expect(managedCookieSourceForUrl('https://user@linux.do/image.png')).toBeNull();
  });

  it('reads managed media exactly and leaves public media anonymous without touching native state', async () => {
    const module: ManagedCookieNativeModule = {
      readManagedCookieHeader: vi.fn(async () => ({
        status: 'ok',
        header: 'session=private'
      }))
    };

    await expect(readMediaCookieHeader(
      'https://www.nodeseek.com/uploads/video.webm?version=2',
      module
    )).resolves.toBe('session=private');
    await expect(readMediaCookieHeader(
      'https://cdn.example.com/video.webm',
      module
    )).resolves.toBe('');
    expect(module.readManagedCookieHeader).toHaveBeenCalledTimes(1);
    expect(module.readManagedCookieHeader).toHaveBeenCalledWith(
      'https://www.nodeseek.com/uploads/video.webm?version=2'
    );
  });
  it('[REG-ACCOUNT-031] preserves the difference between an empty exact-url result and an unsupported bridge', async () => {
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

  it('[REG-ACCOUNT-031] reports native read failures as unknown instead of anonymous', async () => {
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
