// @vitest-environment jsdom
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLinuxDoCreditAuthMessage, linuxDoCreditAuthScript } from './linuxDoCreditAuthScript';

const nonce = '0123456789abcdef0123456789abcdef';
const origin = 'https://credit.linux.do';
const authorizationUrl =
  'https://connect.linux.do/oauth2/authorize?response_type=code&client_id=credit&state=opaque&redirect_uri=https%3A%2F%2Fcredit.linux.do%2Flogin';

function page(url: string, html = '', responses = [new Response('null', { status: 401 })]) {
  vi.useFakeTimers();
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  const location = { href: url, assign: vi.fn() };
  const fetch = vi.fn(async () => responses.shift() ?? new Response('null', { status: 401 }));
  const browser = { top: undefined as unknown, ReactNativeWebView: { postMessage } };
  browser.top = browser;
  const context = { window: browser, document, location, URL, Date, setTimeout, fetch };
  const run = () => runInNewContext(linuxDoCreditAuthScript(nonce), context);
  run();
  return { postMessage, location, fetch, run };
}

function authorizedUser() {
  return Response.json({ error_msg: '', data: { id: '7', username: 'alice', is_pay_key: false } });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Credit silent browser login', () => {
  it('accepts the origin-only URL supplied by Android WebMessageListener after the page confirms its session', () => {
    const complete = JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' });
    expect(isLinuxDoCreditAuthMessage(complete, origin, nonce)).toBe('complete');
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/`, nonce)).toBe('complete');
    expect(isLinuxDoCreditAuthMessage(complete, 'https://connect.linux.do', nonce)).toBeNull();
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/?untrusted=1`, nonce)).toBeNull();
  });

  it('uses the official authorization URL without sending OAuth credentials through the bridge', () => {
    const login = page(`${origin}/api/v1/oauth/login`, JSON.stringify({ error_msg: '', data: authorizationUrl }));
    expect(login.location.assign).toHaveBeenCalledWith(authorizationUrl);
    expect(login.postMessage).not.toHaveBeenCalled();
    expect(login.fetch).not.toHaveBeenCalled();
    login.run();
    expect(login.location.assign).toHaveBeenCalledTimes(1);
  });

  it.each([
    authorizationUrl.replace('connect.linux.do', 'connect.linux.do.evil.test'),
    authorizationUrl.replace('https://connect', 'http://connect'),
    authorizationUrl.replace('connect.linux.do', 'user:pass@connect.linux.do'),
    authorizationUrl.replace('credit.linux.do%2Flogin', 'other.test%2Flogin'),
    authorizationUrl.replace('response_type=code', 'response_type=token'),
    authorizationUrl.replace('&state=opaque', '')
  ])('rejects an unexpected authorization destination: %s', (url) => {
    const login = page(`${origin}/api/v1/oauth/login`, JSON.stringify({ error_msg: '', data: url }));
    expect(login.location.assign).not.toHaveBeenCalled();
    expect(login.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'interaction-required' })
    );
  });

  it('waits for the official callback to establish a session without requiring a payment password', async () => {
    const result = page(`${origin}/login?code=secret-code&state=opaque`, '', [
      new Response('null', { status: 401 }),
      authorizedUser()
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.fetch).toHaveBeenCalledTimes(2);
    expect(result.fetch).toHaveBeenLastCalledWith('/api/v1/oauth/user-info', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    expect(result.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' })
    );
    expect(result.postMessage.mock.calls.flat().join('')).not.toMatch(/secret-code|alice/);
  });

  it('requires a successful account response instead of treating the home URL as proof', async () => {
    const result = page(`${origin}/home`);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.postMessage).not.toHaveBeenCalled();
    expect(result.location.assign).toHaveBeenCalledWith(`${origin}/api/v1/oauth/login`);
  });

  it.each(['/home', '/login'])('reuses an existing Credit session from %s without starting OAuth', async (path) => {
    const result = page(`${origin}${path}`, '<input type="checkbox" />', [authorizedUser()]);
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(result.postMessage).toHaveBeenCalledWith(
        JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' })
      );
      expect(result.location.assign).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });

  it.each(['<form id="challenge-form"></form>', '<title>Just a moment...</title>'])(
    'waits for a passive challenge to disappear before checking the existing session: %s',
    async (html) => {
      const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
      const click = vi.spyOn(HTMLElement.prototype, 'click');
      try {
        const result = page(`${origin}/home`, html, [authorizedUser()]);
        await vi.advanceTimersByTimeAsync(4000);
        expect(result.fetch).not.toHaveBeenCalled();
        expect(result.postMessage).not.toHaveBeenCalled();
        document.body.innerHTML = '';
        await vi.advanceTimersByTimeAsync(1000);
        expect(result.postMessage).toHaveBeenCalledWith(
          JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' })
        );
        expect(result.location.assign).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
      } finally {
        submit.mockRestore();
        click.mockRestore();
      }
    }
  );

  it('bounds an unresolved challenge without interacting with it', async () => {
    const result = page(`${origin}/home`, '<form id="challenge-form"></form>');
    await vi.advanceTimersByTimeAsync(24000);
    expect(result.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'interaction-required' })
    );
    expect(result.fetch).not.toHaveBeenCalled();
    expect(result.location.assign).not.toHaveBeenCalled();
  });

  it('starts OAuth from a logged-out login page only after its account probe returns 401', async () => {
    const result = page(`${origin}/login`);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.fetch).toHaveBeenCalledTimes(1);
    expect(result.location.assign).toHaveBeenCalledWith(`${origin}/api/v1/oauth/login`);
    expect(result.postMessage).not.toHaveBeenCalled();
  });

  it('allows transient callback failures to settle before reporting the existing session', async () => {
    const result = page(`${origin}/login?code=secret-code&state=opaque`, '', [
      new Response('', { status: 403 }),
      new Response('', { status: 500 }),
      authorizedUser()
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(result.fetch).toHaveBeenCalledTimes(3);
    expect(result.location.assign).not.toHaveBeenCalled();
    expect(result.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' })
    );
  });

  it('does not restart OAuth while an official callback keeps returning 401', async () => {
    const result = page(`${origin}/login?code=secret-code&state=opaque`);
    await vi.advanceTimersByTimeAsync(25000);
    expect(result.location.assign).not.toHaveBeenCalled();
    expect(result.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'interaction-required' })
    );
  });

  it('waits through a challenged account probe instead of creating another OAuth session', async () => {
    const result = page(`${origin}/home`, '', [new Response('', { status: 403 }), authorizedUser()]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.location.assign).not.toHaveBeenCalled();
    expect(result.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' })
    );
  });

  it.each([
    ['https://connect.linux.do/oauth2/authorize', '<a href="/oauth2/approve/opaque">允许</a>'],
    ['https://linux.do/login', '<input type="password" />']
  ])('leaves consent, login and challenges to the user on %s', (url, html) => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    try {
      const result = page(url, html);
      expect(result.location.assign).not.toHaveBeenCalled();
      expect(result.fetch).not.toHaveBeenCalled();
      expect(result.postMessage).toHaveBeenCalledWith(
        JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'interaction-required' })
      );
      expect(submit).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
      click.mockRestore();
    }
  });

  it('stops waiting for an unrecognized page within the deadline', async () => {
    const result = page('https://connect.linux.do/oauth2/authorize');
    expect(result.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25000);
    expect(result.postMessage).toHaveBeenCalledTimes(1);
    expect(result.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(result.postMessage).toHaveBeenCalledTimes(1);
  });

  it('accepts only current, bounded messages from the appropriate official document', () => {
    const complete = JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status: 'complete' });
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/home`, nonce)).toBe('complete');
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/login`, nonce)).toBe('complete');
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/login?state=x&code=y`, nonce)).toBe('complete');
    for (const url of [
      'https://connect.linux.do/home',
      `${origin}.evil.test/home`,
      `${origin}/api/v1/oauth/login`,
      'invalid'
    ])
      expect(isLinuxDoCreditAuthMessage(complete, url, nonce)).toBeNull();
    expect(isLinuxDoCreditAuthMessage(complete, `${origin}/home`, 'stale')).toBeNull();
    expect(isLinuxDoCreditAuthMessage('x'.repeat(1025), `${origin}/home`, nonce)).toBeNull();
    expect(isLinuxDoCreditAuthMessage('null', `${origin}/home`, nonce)).toBeNull();
    expect(() => linuxDoCreditAuthScript('unsafe"nonce')).toThrow();
  });
});
