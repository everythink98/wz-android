// @vitest-environment-options {"url":"https://www.nodeimage.com/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT, NODEIMAGE_API_KEY_PROBE_SCRIPT, NODESEEK_LOGIN_PROBE_SCRIPT, nodeImageApiKeyProbeScript } from './loginWebViewScripts';

async function runNodeSeekLoginProbe(
  url: string,
  html: string,
  fetchMock: typeof fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch,
  probeId?: number
) {
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
  if (probeId) {
    (window as typeof window & { __WZ_NODESEEK_LOGIN_PROBE_ID__?: number }).__WZ_NODESEEK_LOGIN_PROBE_ID__ = probeId;
  }

  window.eval(NODESEEK_LOGIN_PROBE_SCRIPT);

  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  return JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
}

describe('NodeSeek login WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as typeof window & { __config__?: unknown }).__config__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads explicit NodeSeek UID and CSRF from the rendered page without fetch', async () => {
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
      status: 'logged-in',
      loggedIn: true,
      userId: 54874,
      csrfToken: 'page-csrf'
    });
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

  it('[REG-ACCOUNT-019] marks the real NodeSeek .html guest controls as logged out', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <a class="btn" href="/signIn.html">登录</a>
      <a class="btn" href="/register.html">注册</a>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'logged-out',
      loggedIn: false,
      userId: null
    });
  });

  it('[REG-ACCOUNT-019] gives explicit NodeSeek guest controls priority over stale self markers', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <a class="Username" href="/space/48872">旧账号</a>
      <a class="btn" href="/signIn.html">登录</a>
      <a class="btn" href="/register.html">注册</a>
    `);

    expect(payload).toMatchObject({
      status: 'logged-out',
      loggedIn: false,
      userId: null
    });
  });

  it('[REG-ACCOUNT-026] gives the proven NodeSeek current-user config priority over coexisting guest controls', async () => {
    (window as typeof window & { __config__?: unknown }).__config__ = {
      user: {
        member_id: 48872,
        member_name: '当前账号'
      }
    };
    const payload = await runNodeSeekLoginProbe('/', `
      <a class="btn" href="/signIn.html">登录</a>
      <a class="btn" href="/register.html">注册</a>
    `);

    expect(payload).toMatchObject({
      status: 'logged-in',
      loggedIn: true,
      userId: 48872
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

  it('[REG-ACCOUNT-019] does not treat login text or related content links as an explicit guest page', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <article>登录</article>
      <a href="/topics/login-help">登录问题讨论</a>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'unknown',
      userId: null
    });
    expect(payload.loggedIn).toBeUndefined();
  });

  it('[REG-ACCOUNT-019] does not treat exact NodeSeek login links inside ordinary content as guest controls', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <article>
        <a href="/signIn.html">登录教程</a>
        <a href="/register.html">注册教程</a>
      </article>
    `);

    expect(payload).toMatchObject({ status: 'unknown', userId: null });
    expect(payload.loggedIn).toBeUndefined();
  });

  it('[REG-ACCOUNT-019] does not treat public account-navigation links as current-user proof', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <a href="/setting">设置</a>
      <a href="/notification">通知</a>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'unknown',
      userId: null
    });
    expect(payload.loggedIn).toBeUndefined();
  });

  it('[REG-ACCOUNT-019] does not infer self identity from UID text beside an ordinary author link', async () => {
    const payload = await runNodeSeekLoginProbe('/', `
      <article>如何查看 UID: 4706</article>
      <a href="/space/4706">帖子作者</a>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'unknown'
    });
    expect(payload.loggedIn).toBeUndefined();
  });
});

function runLinuxDoLoginProbe(html: string) {
  window.history.pushState(null, '', '/latest');
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });

  window.eval(LINUXDO_WEBVIEW_PROBE_SCRIPT);

  return JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
}

describe('linux.do login WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['logged-in', '<header class="d-header"><li class="current-user"><button>头像</button></li></header>'],
    ['logged-out', '<header class="d-header"><button class="login-button">登录</button></header>'],
    ['unknown', '<main>普通页面</main>']
  ])('reports %s only from explicit linux.do header markers', (status, html) => {
    expect(runLinuxDoLoginProbe(html)).toMatchObject({
      type: 'linuxdo-webview',
      status,
      ...(status === 'unknown' ? {} : { loggedIn: status === 'logged-in' })
    });
  });

  it('[REG-ACCOUNT-019] returns one manual probe id with its document identity', async () => {
    const payload = await runNodeSeekLoginProbe('/login', '<a href="/login">登录</a>', undefined, 17);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      probeId: 17,
      documentKey: expect.stringContaining('https://www.nodeimage.com/login:'),
      status: 'logged-out'
    });
    expect((window as typeof window & { __WZ_NODESEEK_LOGIN_PROBE_ID__?: number }).__WZ_NODESEEK_LOGIN_PROBE_ID__).toBeUndefined();
  });
});

function runNodeImageApiKeyProbe(html: string, fetchMock: typeof fetch, script = NODEIMAGE_API_KEY_PROBE_SCRIPT) {
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

  it('posts the current NodeImage API key response from the authorized page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ api_key: ' secret ' }), { status: 200 })) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith('https://api.nodeimage.com/api/user/api-key', expect.objectContaining({
      credentials: 'include'
    }));
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      data: { api_key: ' secret ' }
    });
  });

  it('falls back to the API key input already rendered by NodeImage', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('<input id="apiKeyInput" value="dom-secret">', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      apiKey: 'dom-secret'
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
    }));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      data: { api_key: ' verified-secret ' }
    });
  });
});
