// @vitest-environment-options {"url":"https://www.nodeseek.com/connect?target=NodeImage"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeSeekNodeImageAuthScript } from './loginWebViewScripts';

const AUTH_NONCE = '00112233445566778899aabbccddeeff';
const RETRY_NONCE = 'ffeeddccbbaa99887766554433221100';
const NAVIGATION_NONCE = '0123456789abcdef0123456789abcdef';

describe('NodeImage auth WebView script on NodeSeek Connect', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/connect?target=NodeImage');
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries only the ready handshake and still calls cAuth once', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: 'auth-data',
            wtf: 'auth-wtf',
            sign: 'auth-sign'
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(RETRY_NONCE));
    expect(postMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls.map(([message]) => JSON.parse(message))).toEqual(
      Array.from({ length: 3 }, () => ({
        documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
        nonce: RETRY_NONCE,
        type: 'nodeimage-connect-ready'
      }))
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const start = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'nodeimage-connect-start',
        nonce: RETRY_NONCE
      })
    });
    window.dispatchEvent(start);
    document.dispatchEvent(start);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(4);
    expect(JSON.parse(postMessage.mock.calls[3]?.[0] || '{}')).toMatchObject({
      documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
      nonce: RETRY_NONCE,
      type: 'nodeimage-auth-data'
    });
  });

  it('rechecks the live document before ready or cAuth', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(NAVIGATION_NONCE));
    expect(postMessage).toHaveBeenCalledTimes(1);

    window.history.pushState(null, '', '/connect?target=Other');
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'nodeimage-connect-start',
          nonce: NAVIGATION_NONCE
        })
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests official NodeSeek auth data only after the native one-shot grant', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: 'auth-data',
            wtf: 'auth-wtf',
            sign: 'auth-sign'
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeSeekNodeImageAuthScript(AUTH_NONCE));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
      type: 'nodeimage-connect-ready',
      nonce: AUTH_NONCE
    });
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'nodeimage-connect-start',
          nonce: 'ffeeddccbbaa99887766554433221100'
        })
      })
    );
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'nodeimage-connect-start',
          nonce: AUTH_NONCE
        })
      })
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cAuth?target=NodeImage',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(JSON.parse(postMessage.mock.calls[1]?.[0] || '{}')).toEqual({
      documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
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
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            message: 'denied'
          }),
          { status: 403 }
        )
    ) as unknown as typeof fetch;
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

    const startMessage = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'nodeimage-connect-start',
        nonce: AUTH_NONCE
      })
    });
    window.dispatchEvent(startMessage);
    document.dispatchEvent(startMessage);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[1]?.[0] || '{}')).toMatchObject({
      type: 'nodeimage-auth-error',
      nonce: AUTH_NONCE
    });
    expect(localStorageWrite).not.toHaveBeenCalled();
  });
});
