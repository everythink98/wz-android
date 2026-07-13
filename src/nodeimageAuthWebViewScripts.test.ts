// @vitest-environment-options {"url":"https://www.nodeseek.com/connect?target=NodeImage"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeImageApiKeyProbeScript } from './loginWebViewScripts';

const MESSAGE_SESSION = {
  sessionId: 'nodeimage-auth-test',
  nonce: 'abcdef0123456789abcdef0123456789'
};

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

    window.eval(nodeImageApiKeyProbeScript(null, MESSAGE_SESSION));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith('/api/cAuth?target=NodeImage', expect.objectContaining({
      credentials: 'include'
    }));
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-auth-data',
      data: 'auth-data',
      wtf: 'auth-wtf',
      sign: 'auth-sign',
      ...MESSAGE_SESSION
    });
  });
});
