// @vitest-environment-options {"url":"https://www.nodeseek.com/connect?target=NodeImage"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeSeekNodeImageAuthScript } from './loginWebViewScripts';

const AUTH_NONCE = '00112233445566778899aabbccddeeff';

describe('NodeImage auth WebView script on NodeSeek Connect', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests official NodeSeek auth data for NodeImage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: 'auth-data',
      wtf: 'auth-wtf',
      sign: 'auth-sign'
    }), { status: 200 })) as unknown as typeof fetch;
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(AUTH_NONCE));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith('/api/cAuth?target=NodeImage', expect.objectContaining({
      credentials: 'include'
    }));
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-auth-data',
      nonce: AUTH_NONCE,
      data: 'auth-data',
      wtf: 'auth-wtf',
      sign: 'auth-sign'
    });
  });

  it('does nothing outside the exact top-level NodeSeek authorization URL', async () => {
    window.history.pushState(null, '', '/connect?target=NodeImage&next=/');
    const fetchMock = vi.fn();
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(AUTH_NONCE));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('keeps phase state lexical and never writes browser storage', async () => {
    window.history.pushState(null, '', '/connect?target=NodeImage');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      message: 'denied'
    }), { status: 403 })) as unknown as typeof fetch;
    const postMessage = vi.fn();
    const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem');
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    Object.defineProperty(window, '__wzNodeImageAuthDataRequested', {
      configurable: true,
      set: () => {
        throw new Error('phase state must not escape the script');
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(AUTH_NONCE));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toMatchObject({
      type: 'nodeimage-auth-error',
      nonce: AUTH_NONCE
    });
    expect(localStorageWrite).not.toHaveBeenCalled();
  });
});
