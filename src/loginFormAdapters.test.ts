import { describe, expect, it, vi } from 'vitest';
import {
  LOGIN_FORM_ADAPTERS,
  isTrustedLoginFormMessageSource,
  parseLoginFormMessage,
  type LoginFormAdapter,
  type LoginFormMessage
} from '@/loginFormAdapters';

const siteCases = [
  {
    adapter: LOGIN_FORM_ADAPTERS.nodeseek,
    html: '<form><input id="stacked-email"><input id="stacked-password" type="password"></form>'
  },
  {
    adapter: LOGIN_FORM_ADAPTERS.linuxdo,
    html: '<form><input id="login-account-name"><input id="login-account-password" type="password"></form>'
  },
  {
    adapter: LOGIN_FORM_ADAPTERS.yaohuo,
    html: '<form name="login" method="post"><input id="logname" name="logname"><input id="password" name="logpass" type="password"></form>'
  }
] as const;

function createPage(adapter: LoginFormAdapter, html: string, url = adapter.loginUrl) {
  const pageDocument = document.implementation.createHTMLDocument();
  pageDocument.body.innerHTML = html;
  const postMessage = vi.fn();
  const pageWindow = { ReactNativeWebView: { postMessage } };
  return { pageDocument, pageWindow, postMessage, url };
}

function evaluateScript(page: ReturnType<typeof createPage>, script: string) {
  const run = new Function('window', 'document', 'location', 'HTMLInputElement', 'Event', 'URL', script);
  run(page.pageWindow, page.pageDocument, { href: page.url }, HTMLInputElement, Event, URL);
}

function runScript(adapter: LoginFormAdapter, html: string, script: string, url = adapter.loginUrl) {
  const page = createPage(adapter, html, url);
  evaluateScript(page, script);
  const raw = page.postMessage.mock.calls[0]?.[0];
  return {
    ...page,
    message: parseLoginFormMessage(raw) as LoginFormMessage
  };
}

describe('login form adapters', () => {
  it.each(siteCases)('probes the trusted $adapter.site form without credentials', ({ adapter, html }) => {
    const { message } = runScript(adapter, html, adapter.probeScript(1));

    expect(message).toEqual({
      type: 'login-form-probe',
      site: adapter.site,
      attempt: 1,
      ok: true,
      url: adapter.loginUrl
    });
  });

  it.each(siteCases)('fills $adapter.site with native input events and never submits', ({ adapter, html }) => {
    const accountValue = 'a"b\\c</script>\u2028账号';
    const passwordValue = "p'\\\\n</script>\u2029密码";
    const page = createPage(adapter, html);
    const form = page.pageDocument.querySelector('form') as HTMLFormElement;
    const account = form.querySelector('input:not([type="password"])') as HTMLInputElement;
    const password = form.querySelector('input[type="password"]') as HTMLInputElement;
    const accountInput = vi.fn();
    const accountChange = vi.fn();
    const passwordInput = vi.fn();
    const passwordChange = vi.fn();
    const submit = vi.fn();
    account.addEventListener('input', accountInput);
    account.addEventListener('change', accountChange);
    password.addEventListener('input', passwordInput);
    password.addEventListener('change', passwordChange);
    form.addEventListener('submit', submit);
    Object.defineProperty(form, 'submit', { configurable: true, value: submit });
    Object.defineProperty(form, 'requestSubmit', { configurable: true, value: submit });

    const script = adapter.fillScript({ account: accountValue, password: passwordValue }, 1);
    expect(script).not.toContain('</script>');
    evaluateScript(page, script);

    expect(account.value).toBe(accountValue);
    expect(password.value).toBe(passwordValue);
    expect(accountInput).toHaveBeenCalledTimes(1);
    expect(accountChange).toHaveBeenCalledTimes(1);
    expect(passwordInput).toHaveBeenCalledTimes(1);
    expect(passwordChange).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(parseLoginFormMessage(page.postMessage.mock.calls[0]?.[0])).toEqual({
      type: 'login-form-fill',
      site: adapter.site,
      attempt: 1,
      ok: true,
      url: adapter.loginUrl
    });
  });

  it.each([
    ['wrong origin', 'https://evil.example/signIn.html'],
    ['wrong path', 'https://www.nodeseek.com/login'],
    ['unexpected query', 'https://www.nodeseek.com/signIn.html?next=%2F']
  ])('rejects NodeSeek on %s', (_label, url) => {
    const { message } = runScript(
      LOGIN_FORM_ADAPTERS.nodeseek,
      siteCases[0].html,
      LOGIN_FORM_ADAPTERS.nodeseek.probeScript(1),
      url
    );

    expect(message).toMatchObject({ ok: false, reason: 'untrusted-page', url });
    expect(LOGIN_FORM_ADAPTERS.nodeseek.matchesUrl(url)).toBe(false);
  });

  it.each([
    'https://www.yaohuo.me/waplogin.aspx',
    'https://www.yaohuo.me/waplogin.aspx?siteid=999',
    'https://www.yaohuo.me/waplogin.aspx?siteid=1000&next=home'
  ])('rejects a Yaohuo page without the exact site query: %s', (url) => {
    const { message } = runScript(
      LOGIN_FORM_ADAPTERS.yaohuo,
      siteCases[2].html,
      LOGIN_FORM_ADAPTERS.yaohuo.probeScript(1),
      url
    );

    expect(message).toMatchObject({ ok: false, reason: 'untrusted-page' });
  });

  it('fails closed when fields or form identity do not match', () => {
    const missing = runScript(
      LOGIN_FORM_ADAPTERS.linuxdo,
      '<form><input id="login-account-name"></form>',
      LOGIN_FORM_ADAPTERS.linuxdo.probeScript(1)
    );
    const splitForms = runScript(
      LOGIN_FORM_ADAPTERS.nodeseek,
      '<form><input id="stacked-email"></form><form><input id="stacked-password" type="password"></form>',
      LOGIN_FORM_ADAPTERS.nodeseek.probeScript(1)
    );
    const wrongYaohuoForm = runScript(
      LOGIN_FORM_ADAPTERS.yaohuo,
      '<form name="other" method="get"><input id="logname" name="logname"><input id="password" name="logpass" type="password"></form>',
      LOGIN_FORM_ADAPTERS.yaohuo.probeScript(1)
    );
    const visiblePassword = runScript(
      LOGIN_FORM_ADAPTERS.nodeseek,
      '<form><input id="stacked-email"><input id="stacked-password" type="text"></form>',
      LOGIN_FORM_ADAPTERS.nodeseek.probeScript(1)
    );

    expect(missing.message).toMatchObject({ ok: false, reason: 'missing-fields' });
    expect(splitForms.message).toMatchObject({ ok: false, reason: 'invalid-form' });
    expect(wrongYaohuoForm.message).toMatchObject({ ok: false, reason: 'invalid-form' });
    expect(visiblePassword.message).toMatchObject({ ok: false, reason: 'invalid-form' });
  });

  it('does not write credentials after navigation leaves the trusted page', () => {
    const adapter = LOGIN_FORM_ADAPTERS.nodeseek;
    const page = createPage(adapter, siteCases[0].html, 'https://evil.example/signIn.html');
    const inputs = page.pageDocument.querySelectorAll('input');

    evaluateScript(page, adapter.fillScript({ account: 'private-account', password: 'private-password' }, 1));

    expect(Array.from(inputs, (input) => input.value)).toEqual(['', '']);
    expect(parseLoginFormMessage(page.postMessage.mock.calls[0]?.[0])).toMatchObject({
      type: 'login-form-fill',
      site: 'nodeseek',
      ok: false,
      reason: 'untrusted-page'
    });
  });
});

describe('parseLoginFormMessage', () => {
  it('accepts only complete messages and trusted successful URLs', () => {
    expect(parseLoginFormMessage('{')).toBeNull();
    expect(parseLoginFormMessage({ type: 'login-form-probe', site: 'nodeseek', ok: true })).toBeNull();
    expect(
      parseLoginFormMessage({
        type: 'login-form-probe',
        site: 'nodeseek',
        ok: true,
        url: 'https://evil.example/signIn.html'
      })
    ).toBeNull();
    expect(
      parseLoginFormMessage({
        type: 'login-form-fill',
        site: 'linuxdo',
        ok: false,
        url: 'https://linux.do/login',
        reason: 'other'
      })
    ).toBeNull();
  });

  it('requires the native WebView source to match before trusting a successful probe', () => {
    const message = parseLoginFormMessage({
      type: 'login-form-probe',
      site: 'linuxdo',
      attempt: 1,
      ok: true,
      url: LOGIN_FORM_ADAPTERS.linuxdo.loginUrl
    }) as LoginFormMessage;

    expect(isTrustedLoginFormMessageSource(message, 'https://evil.example/login')).toBe(false);
    expect(isTrustedLoginFormMessageSource(message, LOGIN_FORM_ADAPTERS.linuxdo.loginUrl)).toBe(true);
    expect(isTrustedLoginFormMessageSource(message, 'https://linux.do')).toBe(true);
    expect(isTrustedLoginFormMessageSource(message, 'https://linux.do/')).toBe(true);
    expect(isTrustedLoginFormMessageSource(message, 'https://linux.do/latest')).toBe(false);
  });
});
