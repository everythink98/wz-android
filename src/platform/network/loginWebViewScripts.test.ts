// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.nodeimage.com/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  LINUXDO_SESSION_INIT_OBSERVER_SCRIPT,
  LINUXDO_WEBVIEW_PROBE_SCRIPT,
  NODESEEK_LOGIN_PROBE_SCRIPT,
  nodeImageAuthPayloadScript,
  nodeImageSessionScript
} from './loginWebViewScripts';

const NODEIMAGE_AUTH_NONCE = '00112233445566778899aabbccddeeff';
const NODEIMAGE_AUTH_PAYLOAD = {
  data: 'auth-data',
  wtf: 'auth-wtf',
  sign: 'auth-sign'
};

const loginProbeDocuments: JSDOM[] = [];
function runNodeSeekLoginProbe(html: string, config?: unknown) {
  const dom = new JSDOM(html, {
    url: 'https://www.nodeseek.com/',
    runScripts: 'outside-only'
  });
  loginProbeDocuments.push(dom);
  const page = dom.window;
  Object.defineProperty(page.document.body, 'innerText', { get: () => page.document.body.textContent || '' });
  const postMessage = vi.fn();
  const fetch = vi.fn();
  Object.defineProperty(page, 'ReactNativeWebView', { value: { postMessage }, configurable: true });
  Object.defineProperty(page, '__config__', { value: config, configurable: true, writable: true });
  Object.defineProperty(page, 'fetch', { value: fetch, configurable: true });
  const readCookie = vi.spyOn(page.Document.prototype, 'cookie', 'get');
  const writeCookie = vi.spyOn(page.Document.prototype, 'cookie', 'set');
  const writeStorage = vi.spyOn(page.Storage.prototype, 'setItem');
  const xhr = vi.spyOn(page.XMLHttpRequest.prototype, 'open');
  const submit = vi.spyOn(page.HTMLFormElement.prototype, 'submit');
  const script = NODESEEK_LOGIN_PROBE_SCRIPT;
  const evaluate = () => page.eval(script);
  const messages = () => postMessage.mock.calls.map(([message]) => JSON.parse(message));
  evaluate();
  return { page, postMessage, fetch, script, evaluate, messages, readCookie, writeCookie, writeStorage, xhr, submit };
}

describe('NodeSeek login document hints', () => {
  afterEach(() => {
    for (const dom of loginProbeDocuments.splice(0)) dom.window.close();
    vi.restoreAllMocks();
  });

  it.each([
    ['explicit account controls', '<a href="/api/account/signOut">退出登录</a>', 'logged-in'],
    ['self Username link', '<a class="Username" href="/space/48872">PRIVATE_NAME</a>', 'logged-in'],
    [
      'complete guest controls',
      '<a class="btn" href="/signIn.html">登录</a><a class="btn" href="/register.html">注册</a>',
      'logged-out'
    ],
    [
      'guest controls with stale self marker',
      '<a class="Username" href="/space/48872">PRIVATE_NAME</a><a class="btn" href="/signIn.html">登录</a><a class="btn" href="/register.html">注册</a>',
      'logged-out'
    ],
    ['ordinary author and UID text', '<article>UID: 4706</article><a href="/space/4706">帖子作者</a>', 'unknown'],
    ['public navigation', '<a href="/setting">设置</a><a href="/notification">通知</a>', 'unknown'],
    [
      'login advice',
      '<article><a href="/signIn.html">登录教程</a><a href="/register.html">注册教程</a></article>',
      'unknown'
    ],
    ['partial login page', '<a class="btn" href="/signIn.html">登录</a><main>暂时无法完成</main>', 'unknown']
  ])('classifies NodeSeek %s without forwarding identity', (_label, html, status) => {
    const probe = runNodeSeekLoginProbe(html + '<meta name="csrf-token" content="PRIVATE_CSRF">');
    expect(probe.messages()).toEqual([
      {
        type: 'nodeseek-login',
        documentKey: expect.stringContaining('https://www.nodeseek.com/:'),
        status,
        hasChallengeMarker: false,
        userAgent: expect.any(String)
      }
    ]);
    expect(JSON.stringify(probe.messages())).not.toMatch(/PRIVATE_|csrfToken|userId|username|loggedIn|probeId/);
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it('uses the current NodeSeek config instead of public nested profiles or stale guest links', () => {
    const html = '<a class="btn" href="/signIn.html">登录</a><a class="btn" href="/register.html">注册</a>';
    const current = runNodeSeekLoginProbe(html, { user: { member_id: 48872, member_name: 'PRIVATE_NAME' } });
    expect(current.messages()[0]).toMatchObject({ status: 'logged-in' });
    const publicProfile = runNodeSeekLoginProbe('<main>普通页面</main>', {
      profile: { id: 48872, name: 'PRIVATE_NAME' }
    });
    expect(publicProfile.messages()[0]).toMatchObject({ status: 'unknown' });
    expect(JSON.stringify(current.messages())).not.toContain('PRIVATE_NAME');
  });

  it('observes challenge removal and keeps repeated injection bounded', async () => {
    const ready = '<a class="Username" href="/space/48872">PRIVATE_NAME</a>';
    const probe = runNodeSeekLoginProbe('<form id="challenge-form">PRIVATE_CHALLENGE</form>' + ready);
    expect(probe.messages()).toHaveLength(1);
    expect(probe.messages()[0]).toMatchObject({ status: 'unknown', hasChallengeMarker: true });
    const observed = vi.spyOn(probe.page.MutationObserver.prototype, 'observe');
    probe.evaluate();
    expect(observed).not.toHaveBeenCalled();
    expect(probe.messages()).toHaveLength(1);
    probe.page.document.head.replaceChildren();
    probe.page.document.body.innerHTML = ready;
    await vi.waitFor(() => expect(probe.messages()).toHaveLength(2));
    expect(probe.messages()[1]).toMatchObject({ status: 'logged-in', hasChallengeMarker: false });
    probe.page.document.body.appendChild(probe.page.document.createElement('div'));
    await Promise.resolve();
    expect(probe.messages()).toHaveLength(2);
    expect(JSON.stringify(probe.messages())).not.toContain('PRIVATE_');
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it('keeps probes passive and ignores child frames', async () => {
    const probe = runNodeSeekLoginProbe('<main>普通页面</main>');
    const { readCookie, writeCookie, writeStorage, xhr, submit } = probe;
    probe.evaluate();
    const frame = probe.page.document.createElement('iframe');
    probe.page.document.body.appendChild(frame);
    const frameMessage = vi.fn();
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('Expected the attached iframe to have its own window');
    Object.defineProperty(frameWindow, 'ReactNativeWebView', { value: { postMessage: frameMessage } });
    Reflect.get(frameWindow, 'eval')(probe.script);
    await Promise.resolve();
    expect(frameMessage).not.toHaveBeenCalled();
    expect(readCookie).not.toHaveBeenCalled();
    expect(writeCookie).not.toHaveBeenCalled();
    expect(writeStorage).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(probe.fetch).not.toHaveBeenCalled();
    expect(probe.messages()).toHaveLength(1);
  });

  it('replaces the observer after its document key changes', async () => {
    const probe = runNodeSeekLoginProbe('<main>普通页面</main>');
    const disconnect = vi.spyOn(probe.page.MutationObserver.prototype, 'disconnect');
    probe.page.history.pushState(null, '', '/changed');
    probe.page.document.body.innerHTML = '<form id="challenge-form"></form>';
    await Promise.resolve();
    expect(probe.messages()).toHaveLength(1);
    probe.evaluate();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(probe.messages()).toHaveLength(2);
    expect(probe.messages()[1]).toMatchObject({
      documentKey: expect.stringContaining('/changed:'),
      status: 'unknown',
      hasChallengeMarker: true
    });
    probe.evaluate();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(probe.messages()).toHaveLength(2);
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

function createLinuxDoSessionDocument(url = 'https://linux.do/latest') {
  const dom = new JSDOM('<header class="d-header"><li class="current-user"></li></header>', {
    url,
    runScripts: 'outside-only'
  });
  loginProbeDocuments.push(dom);
  const page = dom.window;
  const postMessage = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const open = vi.spyOn(page.XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
  const send = vi.spyOn(page.XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
  Object.defineProperty(page, 'ReactNativeWebView', { value: { postMessage } });
  Object.defineProperty(page, 'fetch', { value: fetch, writable: true });
  const inject = () => page.eval(LINUXDO_SESSION_INIT_OBSERVER_SCRIPT);
  const probe = () => page.eval(LINUXDO_WEBVIEW_PROBE_SCRIPT);
  const initialized = () => Reflect.get(page, '__WZ_LINUXDO_SESSION_INITIALIZED__');
  const messages = () => postMessage.mock.calls.map(([message]) => JSON.parse(message));
  const startXhr = (method = 'POST', target = '/dynamic-endpoint', body = 'visitor_id=PRIVATE_FINGERPRINT') => {
    const xhr = new page.XMLHttpRequest();
    xhr.open(method, target, true);
    xhr.send(body);
    return xhr;
  };
  const completeXhr = (xhr: XMLHttpRequest, status: number) => {
    Object.defineProperty(xhr, 'status', { value: status, configurable: true });
    xhr.dispatchEvent(new page.Event('loadend'));
  };
  return { page, fetch, open, send, inject, probe, initialized, messages, postMessage, startXhr, completeXhr };
}

describe('linux.do current-document session initialization', () => {
  afterEach(() => {
    for (const dom of loginProbeDocuments.splice(0)) {
      Reflect.get(dom.window, '__WZ_LINUXDO_PAGE_OBSERVER__')?.disconnect();
      dom.window.close();
    }
    vi.restoreAllMocks();
  });

  it('reports completion after the observed XHR succeeds without reading or forwarding private state', () => {
    const session = createLinuxDoSessionDocument();
    const readCookie = vi.spyOn(session.page.Document.prototype, 'cookie', 'get');
    const writeCookie = vi.spyOn(session.page.Document.prototype, 'cookie', 'set');
    const writeStorage = vi.spyOn(session.page.Storage.prototype, 'setItem');
    session.inject();
    session.probe();
    expect(session.initialized()).toBe(false);
    expect(session.messages().at(-1)).toMatchObject({ status: 'logged-in', hasSessionInitialization: false });
    const xhr = session.startXhr();
    expect(session.initialized()).toBe(false);
    session.completeXhr(xhr, 204);
    expect(session.initialized()).toBe(true);
    expect(session.messages().at(-1)).toMatchObject({ status: 'logged-in', hasSessionInitialization: true });
    expect(session.open).toHaveBeenCalledExactlyOnceWith('POST', '/dynamic-endpoint', true);
    expect(session.send).toHaveBeenCalledExactlyOnceWith('visitor_id=PRIVATE_FINGERPRINT');
    expect(session.fetch).not.toHaveBeenCalled();
    expect(readCookie).not.toHaveBeenCalled();
    expect(writeCookie).not.toHaveBeenCalled();
    expect(writeStorage).not.toHaveBeenCalled();
    expect(JSON.stringify(session.messages())).not.toContain('PRIVATE_FINGERPRINT');
  });

  it.each([0, 199, 300, 403, 500])('does not complete initialization after XHR status %s', (status) => {
    const session = createLinuxDoSessionDocument();
    session.inject();
    session.completeXhr(session.startXhr(), status);
    expect(session.initialized()).toBe(false);
  });

  it('observes fetch strings and URLSearchParams while preserving the original promise and arguments', async () => {
    const session = createLinuxDoSessionDocument();
    session.inject();
    for (const body of [
      'visitor_id=PRIVATE_STRING',
      new session.page.URLSearchParams({ visitor_id: 'PRIVATE_FORM' })
    ]) {
      const pending = Promise.withResolvers<Response>();
      session.fetch.mockReturnValueOnce(pending.promise);
      const init = { method: 'post', body };
      const returned = session.page.fetch('/new-endpoint', init);
      expect(returned).toBe(pending.promise);
      expect(session.initialized()).toBe(false);
      pending.resolve(new Response(null, { status: 200 }));
      await returned;
      expect(session.initialized()).toBe(true);
      expect(session.fetch).toHaveBeenLastCalledWith('/new-endpoint', init);
    }
    expect(session.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps failed fetch and synchronous transport exceptions unchanged', async () => {
    const session = createLinuxDoSessionDocument();
    session.inject();
    const failure = new Error('network failure');
    const pending = Promise.withResolvers<Response>();
    session.fetch.mockReturnValueOnce(pending.promise);
    const returned = session.page.fetch('/dynamic', { method: 'POST', body: 'visitor_id=PRIVATE' });
    const rejection = expect(returned).rejects.toBe(failure);
    pending.reject(failure);
    await rejection;
    expect(session.initialized()).toBe(false);
    session.fetch.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => session.page.fetch('/dynamic', { method: 'POST', body: 'visitor_id=PRIVATE' })).toThrow(failure);
    session.send.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => session.startXhr()).toThrow(failure);
    session.open.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => session.startXhr()).toThrow(failure);
    expect(session.initialized()).toBe(false);
  });

  it('ignores unrelated requests and does not inspect Request body streams', async () => {
    const session = createLinuxDoSessionDocument();
    session.inject();
    for (const [method, target, body] of [
      ['POST', 'https://other.example/dynamic', 'visitor_id=PRIVATE'],
      ['GET', '/dynamic', 'visitor_id=PRIVATE'],
      ['POST', '/dynamic', 'other_visitor_id=PRIVATE'],
      ['POST', '/dynamic', 'data=visitor_id=PRIVATE']
    ]) {
      session.completeXhr(session.startXhr(method, target, body), 200);
      session.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await session.page.fetch(target, { method, body });
      expect(session.initialized()).toBe(false);
    }
    const request = new Request('https://linux.do/dynamic', { method: 'POST', body: 'visitor_id=PRIVATE' });
    const clone = vi.spyOn(request, 'clone');
    const text = vi.spyOn(request, 'text');
    session.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await session.page.fetch(request);
    expect(session.initialized()).toBe(false);
    expect(clone).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it.each(['https://other.example/', 'http://linux.do/', 'https://www.linux.do/', 'https://linux.do:444/'])(
    'does not install the observer on %s',
    (url) => {
      const session = createLinuxDoSessionDocument(url);
      const send = session.page.XMLHttpRequest.prototype.send;
      session.inject();
      expect(session.page.XMLHttpRequest.prototype.send).toBe(send);
      expect(session.page.fetch).toBe(session.fetch);
      expect(session.initialized()).toBeUndefined();
    }
  );

  it('does not install in a child frame or wrap requests and probe listeners twice', () => {
    const session = createLinuxDoSessionDocument();
    const frame = session.page.document.createElement('iframe');
    session.page.document.body.appendChild(frame);
    const child = frame.contentWindow;
    if (!child) throw new Error('Expected the attached iframe to have a window');
    const childSend: unknown = Reflect.get(child, 'eval')('XMLHttpRequest.prototype.send');
    Reflect.get(child, 'eval')(LINUXDO_SESSION_INIT_OBSERVER_SCRIPT);
    expect(Reflect.get(child, 'eval')('XMLHttpRequest.prototype.send')).toBe(childSend);
    expect(Reflect.get(child, '__WZ_LINUXDO_SESSION_INITIALIZED__')).toBeUndefined();
    session.inject();
    const wrappedSend = session.page.XMLHttpRequest.prototype.send;
    const wrappedFetch = session.page.fetch;
    session.probe();
    session.inject();
    session.probe();
    expect(session.page.XMLHttpRequest.prototype.send).toBe(wrappedSend);
    expect(session.page.fetch).toBe(wrappedFetch);
    session.postMessage.mockClear();
    session.completeXhr(session.startXhr(), 200);
    expect(session.postMessage).toHaveBeenCalledOnce();
    expect(session.messages()[0]).toMatchObject({ hasSessionInitialization: true });
    session.inject();
    expect(session.initialized()).toBe(true);
  });

  it('does not let an older completion authorize a newer attempt or reset its success', async () => {
    const session = createLinuxDoSessionDocument();
    session.inject();
    const first = session.startXhr();
    const pending = Promise.withResolvers<Response>();
    session.fetch.mockReturnValueOnce(pending.promise);
    const second = session.page.fetch('/another-endpoint', { method: 'POST', body: 'visitor_id=PRIVATE' });
    session.completeXhr(first, 200);
    expect(session.initialized()).toBe(false);
    pending.resolve(new Response(null, { status: 403 }));
    await second;
    expect(session.initialized()).toBe(false);
    const older = session.startXhr();
    session.completeXhr(session.startXhr(), 201);
    expect(session.initialized()).toBe(true);
    session.completeXhr(older, 500);
    expect(session.initialized()).toBe(true);
    session.startXhr();
    expect(session.initialized()).toBe(false);
  });
});

describe('linux.do login WebView probe script', () => {
  afterEach(() => {
    const pageWindow = window as typeof window & {
      __WZ_LINUXDO_PAGE_OBSERVER__?: MutationObserver;
      __WZ_LINUXDO_SESSION_INIT_LISTENER__?: EventListener;
    };
    pageWindow.__WZ_LINUXDO_PAGE_OBSERVER__?.disconnect();
    delete pageWindow.__WZ_LINUXDO_PAGE_OBSERVER__;
    if (pageWindow.__WZ_LINUXDO_SESSION_INIT_LISTENER__) {
      window.removeEventListener('wz-linuxdo-session-initialization', pageWindow.__WZ_LINUXDO_SESSION_INIT_LISTENER__);
      delete pageWindow.__WZ_LINUXDO_SESSION_INIT_LISTENER__;
    }
    Reflect.deleteProperty(window, '__WZ_LINUXDO_SESSION_INITIALIZED__');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['hidden widget', '<div class="cf-turnstile" hidden></div>'],
    [
      'hidden ancestor',
      '<div style="display:none"><iframe src="https://challenges.cloudflare.com/widget"></iframe></div>'
    ],
    ['invisible widget', '<div class="cf-turnstile" style="visibility:hidden"></div>'],
    ['transparent ancestor', '<div style="opacity:0"><div class="cf-turnstile"></div></div>']
  ])('does not treat a %s as an unfinished challenge on a loaded forum page', (_label, widget) => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 65));
    Reflect.set(window, '__WZ_LINUXDO_SESSION_INITIALIZED__', true);
    expect(
      runLinuxDoLoginProbe('<header class="d-header"><li class="current-user"></li></header>' + widget)
    ).toMatchObject({ status: 'logged-in', hasSessionInitialization: true, hasChallengeMarker: false });
  });

  it('ignores a zero-area challenge frame and observes an interactive widget becoming hidden or visible', async () => {
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    expect(runLinuxDoLoginProbe('<iframe src="https://challenges.cloudflare.com/widget"></iframe>')).toMatchObject({
      hasChallengeMarker: false
    });
    bounds.mockReturnValue(new DOMRect(0, 0, 300, 65));
    const widget = document.createElement('div');
    widget.className = 'cf-turnstile';
    document.body.replaceChildren(widget);
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', { configurable: true, value: { postMessage } });
    window.eval(LINUXDO_WEBVIEW_PROBE_SCRIPT);
    expect(JSON.parse(postMessage.mock.lastCall?.[0] || '{}')).toMatchObject({ hasChallengeMarker: true });
    widget.style.display = 'none';
    await Promise.resolve();
    expect(JSON.parse(postMessage.mock.lastCall?.[0] || '{}')).toMatchObject({ hasChallengeMarker: false });
    widget.style.removeProperty('display');
    await Promise.resolve();
    expect(JSON.parse(postMessage.mock.lastCall?.[0] || '{}')).toMatchObject({ hasChallengeMarker: true });
    widget.hidden = true;
    await Promise.resolve();
    expect(JSON.parse(postMessage.mock.lastCall?.[0] || '{}')).toMatchObject({ hasChallengeMarker: false });
    widget.hidden = false;
    await Promise.resolve();
    expect(JSON.parse(postMessage.mock.lastCall?.[0] || '{}')).toMatchObject({ hasChallengeMarker: true });
  });

  it('reports changing challenge and login markers without forwarding page text or duplicating observers', async () => {
    const payload = runLinuxDoLoginProbe('<form id="challenge-form">PRIVATE_CHALLENGE_TEXT</form>');
    expect(payload).toMatchObject({ status: 'unknown', hasChallengeMarker: true });
    window.eval(LINUXDO_WEBVIEW_PROBE_SCRIPT);
    const postMessage = (window as typeof window & { ReactNativeWebView: { postMessage: ReturnType<typeof vi.fn> } })
      .ReactNativeWebView.postMessage;
    postMessage.mockClear();
    document.body.innerHTML = '<header class="d-header"><li class="current-user">PRIVATE_ACCOUNT_TEXT</li></header>';
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({ status: 'logged-in', hasChallengeMarker: false });
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('PRIVATE_');
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
});

function runNodeImageApiKeyProbe(html: string, fetchMock: typeof fetch) {
  window.history.pushState(null, '', '/');
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  vi.stubGlobal('fetch', fetchMock);

  window.eval(nodeImageAuthPayloadScript(NODEIMAGE_AUTH_NONCE, NODEIMAGE_AUTH_PAYLOAD));

  return postMessage;
}

function runNodeImageSessionProbe(html: string, fetchMock: typeof fetch) {
  window.history.pushState(null, '', '/');
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  vi.stubGlobal('fetch', fetchMock);

  window.eval(nodeImageSessionScript(NODEIMAGE_AUTH_NONCE));

  return postMessage;
}

describe('NodeImage existing-session probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses an authenticated NodeImage session without requesting NodeSeek Connect', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            api_key: ' existing-secret '
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    ) as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nodeimage.com/api/user/api-key',
      expect.objectContaining({
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/cAuth'), expect.anything());
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-session-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      data: { api_key: ' existing-secret ' }
    });
  });

  it('reports only the verified anonymous JSON contract as an expired session', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: '未认证，请先通过NodeSeek授权登录'
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        )
    ) as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-session-expired',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      status: 401
    });
  });

  it('keeps the rendered API key input as the existing-session fallback', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('<input id="apiKeyInput" value="dom-session-secret">', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-session-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      apiKey: 'dom-session-secret'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Cloudflare HTML 403',
      () =>
        new Response('<html>challenge</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' }
        }),
      403
    ],
    [
      'server JSON 500',
      () =>
        new Response(JSON.stringify({ error: 'temporary' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }),
      500
    ],
    [
      'successful JSON without a key',
      () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }),
      200
    ],
    [
      'invalid JSON 401',
      () =>
        new Response('{', {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }),
      401
    ]
  ] as const)('does not turn %s into a Connect attempt', async (_label, responseFactory, status) => {
    const fetchMock = vi.fn(async () => responseFactory()) as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-session-error',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      status
    });
  });

  it('stops on a session-probe network error without Connect', async () => {
    const fetchMock = vi.fn(async () => {
      document.body.innerHTML = '<input id="apiKeyInput" value="late-dom-key">';
      throw new Error('network unavailable');
    }) as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toMatchObject({
      type: 'nodeimage-session-error',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE
    });
  });

  it('does not report a session result after same-document navigation', async () => {
    const response = Promise.withResolvers<Response>();
    const json = vi.fn(async () => ({ api_key: 'late-secret' }));
    const fetchMock = vi.fn(() => response.promise) as unknown as typeof fetch;
    const postMessage = runNodeImageSessionProbe('', fetchMock);

    window.history.pushState(null, '', '/account');
    response.resolve({
      headers: { get: () => 'application/json' },
      json,
      ok: true,
      status: 200
    } as unknown as Response);
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('NodeImage API key WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the current NodeImage API key response from the authorized page', async () => {
    const fetchMock = vi.fn(
      async (input) =>
        new Response(
          JSON.stringify(String(input).endsWith('/api/auth/verify') ? { success: true } : { api_key: ' secret ' }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nodeimage.com/api/user/api-key',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      data: { api_key: ' secret ' }
    });
  });

  it('falls back to the API key input already rendered by NodeImage', async () => {
    const fetchMock = vi.fn(
      async (input) =>
        new Response('{}', {
          status: String(input).endsWith('/api/auth/verify') ? 200 : 401
        })
    ) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('<input id="apiKeyInput" value="dom-secret">', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
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
    const postMessage = runNodeImageApiKeyProbe('', fetchMock);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      type: 'nodeimage-api-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE,
      data: { api_key: ' verified-secret ' }
    });
  });

  it('does nothing outside the exact top-level NodeImage root URL', async () => {
    window.history.pushState(null, '', '/account');
    const fetchMock = vi.fn();
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeImageAuthPayloadScript(NODEIMAGE_AUTH_NONCE, NODEIMAGE_AUTH_PAYLOAD));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not report a verify result after same-document navigation', async () => {
    const verifyResponse = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => verifyResponse.promise)
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              api_key: 'late-secret'
            }),
            { status: 200 }
          )
      ) as unknown as typeof fetch;
    const postMessage = runNodeImageApiKeyProbe('', fetchMock);

    window.history.pushState(null, '', '/account');
    verifyResponse.resolve(new Response('{}', { status: 200 }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('keeps the authorization payload lexical and never writes browser storage', async () => {
    window.history.pushState(null, '', '/');
    const fetchMock = vi.fn(
      async (input) =>
        new Response('{}', {
          status: String(input).endsWith('/api/auth/verify') ? 200 : 401
        })
    ) as unknown as typeof fetch;
    const postMessage = vi.fn();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage }
    });
    for (const property of ['__wzNodeImageAuthPayload', '__wzNodeImageAuthVerified']) {
      Object.defineProperty(window, property, {
        configurable: true,
        set: () => {
          throw new Error('authorization payload must remain lexical');
        }
      });
    }
    vi.stubGlobal('fetch', fetchMock);

    window.eval(nodeImageAuthPayloadScript(NODEIMAGE_AUTH_NONCE, NODEIMAGE_AUTH_PAYLOAD));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

    expect(JSON.parse(postMessage.mock.calls[0]?.[0] || '{}')).toMatchObject({
      type: 'nodeimage-api-key',
      documentUrl: 'https://www.nodeimage.com/',
      nonce: NODEIMAGE_AUTH_NONCE
    });
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
