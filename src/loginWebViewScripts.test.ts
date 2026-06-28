import { afterEach, describe, expect, it, vi } from 'vitest';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from './loginWebViewScripts';

function runNodeSeekLoginProbe(url: string, html: string) {
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

  window.eval(NODESEEK_LOGIN_PROBE_SCRIPT);

  expect(postMessage).toHaveBeenCalledTimes(1);
  return JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
}

describe('NodeSeek login WebView probe script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not mark a logged-in home page expired because a topic title contains login text', () => {
    const payload = runNodeSeekLoginProbe('/', `
      <a href="/space/54874">me</a>
      <a href="/setting">设置</a>
      <a href="/api/account/signOut">退出登录</a>
      <article>claude code cli 登录掉了怎么处理</article>
    `);

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'logged-in',
      loggedIn: true,
      userId: 54874
    });
  });

  it('marks explicit NodeSeek guest pages as logged out', () => {
    const payload = runNodeSeekLoginProbe('/login', `
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

  it('keeps ambiguous NodeSeek pages unknown instead of expired', () => {
    const payload = runNodeSeekLoginProbe('/', '<main>普通页面</main>');

    expect(payload).toMatchObject({
      type: 'nodeseek-login',
      status: 'unknown',
      userId: null
    });
    expect(payload.loggedIn).toBeUndefined();
  });
});
