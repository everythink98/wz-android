// @vitest-environment-options {"url":"https://www.nodeimage.com/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  linuxDoWebViewProbeScript,
  nodeImageApiKeyProbeScript,
  nodeSeekLoginProbeScript
} from './loginWebViewScripts';

const MESSAGE_SESSION = {
  sessionId: 'probe-test-session',
  nonce: '0123456789abcdef0123456789abcdef'
};

async function runNodeSeekLoginProbe(url: string, html: string, fetchMock: typeof fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch) {
  window.history.pushState(null, '', url);
  document.body.innerHTML = html;
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    value: document.body.textContent || ''
  });
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  vi.stubGlobal('fetch', fetchMock);

  window.eval(nodeSeekLoginProbeScript(MESSAGE_SESSION));

  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  return JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
}

describe('NodeSeek login WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the explicit NodeSeek UID without capturing page CSRF', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const payload = await runNodeSeekLoginProbe('/', `
      <meta name="csrf-token" content="page-csrf">
      <a href="/space/4706">topic author</a>
      <a href="/setting">设置</a>
      <a href="/api/account/signOut">退出登录</a>
      <main>UID: 54874</main>
      <article>claude code cli 登录掉了怎么处理</article>
    `, fetchMock);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      ...MESSAGE_SESSION,
      status: 'logged-in',
      loggedIn: true,
      userId: 54874
    });
    expect(payload).not.toHaveProperty('csrfToken');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not infer the current NodeSeek user from random space links', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const payload = await runNodeSeekLoginProbe('/', `
      <a href="/space/4706">topic author</a>
      <a href="/setting">设置</a>
      <a href="/api/account/signOut">退出登录</a>
    `, fetchMock);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'logged-in',
      loggedIn: true,
      userId: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the current NodeSeek user from the explicit Username link', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const payload = await runNodeSeekLoginProbe('/', `
      <a class="Username" href="/space/48872">凡想世界</a>
      <a href="/space/4706">topic author</a>
      <a href="/setting">设置</a>
      <a href="/api/account/signOut">退出登录</a>
    `, fetchMock);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'logged-in',
      loggedIn: true,
      userId: 48872
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks explicit NodeSeek guest pages as logged out', async () => {
    const payload = await runNodeSeekLoginProbe('/login', `
      <a href="/login">登录</a>
      <a href="/register">注册</a>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'logged-out',
      loggedIn: false,
      userId: null
    });
  });

  it('keeps ambiguous NodeSeek pages unknown instead of expired', async () => {
    const payload = await runNodeSeekLoginProbe('/', '<main>普通页面</main>');

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'unknown',
      userId: null
    });
    expect(payload.loggedIn).toBeUndefined();
  });
});

describe('linux.do WebView probe script', () => {
  it('binds every message to the active native panel session', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });

    window.eval(linuxDoWebViewProbeScript(MESSAGE_SESSION));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toMatchObject({
      type: 'linuxdo-webview',
      ...MESSAGE_SESSION
    });
  });
});

function runNodeImageApiKeyProbe(
  html: string,
  fetchMock: typeof fetch,
  script = nodeImageApiKeyProbeScript(null, MESSAGE_SESSION)
) {
  window.history.pushState(null, '', '/');
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  vi.stubGlobal('fetch', fetchMock);

  window.eval(script);

  return postMessage;
}

describe('NodeImage API key WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps JavaScript line separators escaped in injected auth data', () => {
    const script = nodeImageApiKeyProbeScript({
      data: `line${String.fromCodePoint(0x2028)}separator`,
      wtf: `paragraph${String.fromCodePoint(0x2029)}separator`,
      sign: '</script>'
    }, MESSAGE_SESSION);

    expect(script).toContain('line\\u2028separator');
    expect(script).toContain('paragraph\\u2029separator');
    expect(script).not.toContain(String.fromCodePoint(0x2028));
    expect(script).not.toContain(String.fromCodePoint(0x2029));
    expect(script).not.toContain('</script>');
  });

  it('posts the current NodeImage API key response from the authorized page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ api_key: ' secret ' }), { status: 200 })) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith('https://api.nodeimage.com/api/user/api-key', expect.objectContaining({
      credentials: 'include'
    }));
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      data: { api_key: ' secret ' },
      ...MESSAGE_SESSION
    });
  });

  it('falls back to the API key input already rendered by NodeImage', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('<input id="apiKeyInput" value="dom-secret">', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      apiKey: 'dom-secret',
      ...MESSAGE_SESSION
    });
  });

  it('verifies NodeSeek auth data on NodeImage before reading the API key', async () => {
    const fetchMock = vi.fn(async (input, init) => {
      if (input === 'https://api.nodeimage.com/api/auth/verify') {
        expect(init).toMatchObject({
          method: 'POST',
          credentials: 'include'
        });
        expect(JSON.parse(String(init?.body || '{}'))).toEqual({
          data: 'auth-data',
          wtf: 'auth-wtf',
          sign: 'auth-sign'
        });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (input === 'https://api.nodeimage.com/api/user/api-key') {
        return new Response(JSON.stringify({ api_key: ' verified-secret ' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch ${String(input)}`);
    }) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('', fetchMock, nodeImageApiKeyProbeScript({
      data: 'auth-data',
      wtf: 'auth-wtf',
      sign: 'auth-sign'
    }, MESSAGE_SESSION));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      data: { api_key: ' verified-secret ' },
      ...MESSAGE_SESSION
    });
  });
});
