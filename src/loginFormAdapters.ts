import type { SessionSite } from './siteSessionState';

export type LoginCredentials = {
  account: string;
  password: string;
};

export type LoginFormMessage = {
  type: 'login-form-probe' | 'login-form-fill';
  site: SessionSite;
  attempt: number;
  ok: boolean;
  url: string;
  reason?: LoginFormFailureReason;
};

export type LoginFormFailureReason =
  | 'untrusted-page'
  | 'missing-fields'
  | 'invalid-form'
  | 'native-setter-unavailable'
  | 'fill-failed';

export type LoginFormAdapter = {
  site: SessionSite;
  loginUrl: string;
  matchesUrl: (url: string) => boolean;
  probeScript: (attempt: number) => string;
  fillScript: (credentials: LoginCredentials, attempt: number) => string;
};

type LoginFormConfig = {
  site: SessionSite;
  loginUrl: string;
  accountSelector: string;
  passwordSelector: string;
  formName?: string;
  formMethod?: string;
};

const LOGIN_FORM_FAILURE_REASONS = new Set<LoginFormFailureReason>([
  'untrusted-page',
  'missing-fields',
  'invalid-form',
  'native-setter-unavailable',
  'fill-failed'
]);

const LOGIN_FORM_CONFIGS = {
  nodeseek: {
    site: 'nodeseek',
    loginUrl: 'https://www.nodeseek.com/signIn.html',
    accountSelector: '#stacked-email',
    passwordSelector: '#stacked-password'
  },
  linuxdo: {
    site: 'linuxdo',
    loginUrl: 'https://linux.do/login',
    accountSelector: '#login-account-name',
    passwordSelector: '#login-account-password'
  },
  yaohuo: {
    site: 'yaohuo',
    loginUrl: 'https://www.yaohuo.me/waplogin.aspx?siteid=1000',
    accountSelector: '#logname[name="logname"]',
    passwordSelector: '#password[name="logpass"]',
    formName: 'login',
    formMethod: 'post'
  }
} as const satisfies Record<SessionSite, LoginFormConfig>;

function matchesConfigUrl(config: LoginFormConfig, url: string) {
  try {
    const expected = new URL(config.loginUrl);
    const actual = new URL(url);
    return !actual.username
      && !actual.password
      && actual.origin === expected.origin
      && actual.pathname === expected.pathname
      && actual.search === expected.search;
  } catch {
    return false;
  }
}

export function safeInjectedJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createLoginFormScript(config: LoginFormConfig, attempt: number, credentials?: LoginCredentials) {
  const expectedUrl = new URL(config.loginUrl);
  const mode = credentials ? 'fill' : 'probe';
  const credentialsDeclaration = credentials
    ? `const credentials = ${safeInjectedJson(credentials)};`
    : '';
  return `
(() => {
  const site = ${safeInjectedJson(config.site)};
  const attempt = ${safeInjectedJson(attempt)};
  const type = ${safeInjectedJson(`login-form-${mode}`)};
  const url = String(location.href || "");
  const post = (ok, reason) => window.ReactNativeWebView.postMessage(JSON.stringify({
    type,
    site,
    attempt,
    ok,
    url,
    ...(reason ? { reason } : {})
  }));
  try {
    const pageUrl = new URL(url);
    const trustedPage = !pageUrl.username
      && !pageUrl.password
      && pageUrl.origin === ${safeInjectedJson(expectedUrl.origin)}
      && pageUrl.pathname === ${safeInjectedJson(expectedUrl.pathname)}
      && pageUrl.search === ${safeInjectedJson(expectedUrl.search)};
    if (!trustedPage) {
      post(false, "untrusted-page");
      return;
    }
    const account = document.querySelector(${safeInjectedJson(config.accountSelector)});
    const password = document.querySelector(${safeInjectedJson(config.passwordSelector)});
    if (!(account instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) {
      post(false, "missing-fields");
      return;
    }
    const form = account.form;
    const validForm = Boolean(form)
      && form === password.form
      && password.type.toLowerCase() === "password"
      ${config.formName ? `&& form.getAttribute("name") === ${safeInjectedJson(config.formName)}` : ''}
      ${config.formMethod ? `&& String(form.getAttribute("method") || "").toLowerCase() === ${safeInjectedJson(config.formMethod)}` : ''};
    if (!validForm) {
      post(false, "invalid-form");
      return;
    }
    ${credentialsDeclaration}
    ${credentials ? `const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) {
      post(false, "native-setter-unavailable");
      return;
    }
    valueSetter.call(account, credentials.account);
    account.dispatchEvent(new Event("input", { bubbles: true }));
    account.dispatchEvent(new Event("change", { bubbles: true }));
    valueSetter.call(password, credentials.password);
    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.dispatchEvent(new Event("change", { bubbles: true }));` : ''}
    post(true);
  } catch {
    post(false, "fill-failed");
  }
})();
true;
`;
}

function createAdapter(config: LoginFormConfig): LoginFormAdapter {
  return {
    site: config.site,
    loginUrl: config.loginUrl,
    matchesUrl: (url) => matchesConfigUrl(config, url),
    probeScript: (attempt) => createLoginFormScript(config, attempt),
    fillScript: (credentials, attempt) => createLoginFormScript(config, attempt, credentials)
  };
}

export const LOGIN_FORM_ADAPTERS: Record<SessionSite, LoginFormAdapter> = {
  nodeseek: createAdapter(LOGIN_FORM_CONFIGS.nodeseek),
  linuxdo: createAdapter(LOGIN_FORM_CONFIGS.linuxdo),
  yaohuo: createAdapter(LOGIN_FORM_CONFIGS.yaohuo)
};

export function isTrustedLoginFormMessageSource(message: LoginFormMessage, nativeUrl: string) {
  const adapter = LOGIN_FORM_ADAPTERS[message.site];
  if (!adapter.matchesUrl(message.url)) {
    return false;
  }
  if (adapter.matchesUrl(nativeUrl)) {
    return true;
  }
  try {
    // Android WebMessageListener reports only sourceOrigin, not the full page URL.
    const expected = new URL(adapter.loginUrl);
    const actual = new URL(nativeUrl);
    return !actual.username
      && !actual.password
      && actual.origin === expected.origin
      && actual.pathname === '/'
      && !actual.search
      && !actual.hash;
  } catch {
    return false;
  }
}

export function parseLoginFormMessage(data: unknown): LoginFormMessage | null {
  try {
    const value = typeof data === 'string' ? JSON.parse(data) : data;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const message = value as Record<string, unknown>;
    if ((message.type !== 'login-form-probe' && message.type !== 'login-form-fill')
      || (message.site !== 'nodeseek' && message.site !== 'linuxdo' && message.site !== 'yaohuo')
      || !Number.isSafeInteger(message.attempt)
      || Number(message.attempt) <= 0
      || typeof message.ok !== 'boolean'
      || typeof message.url !== 'string') {
      return null;
    }
    if (message.ok) {
      if (message.reason !== undefined || !LOGIN_FORM_ADAPTERS[message.site].matchesUrl(message.url)) {
        return null;
      }
    } else if (typeof message.reason !== 'string' || !LOGIN_FORM_FAILURE_REASONS.has(message.reason as LoginFormFailureReason)) {
      return null;
    }
    return {
      type: message.type,
      site: message.site,
      attempt: Number(message.attempt),
      ok: message.ok,
      url: message.url,
      ...(message.reason ? { reason: message.reason as LoginFormFailureReason } : {})
    };
  } catch {
    return null;
  }
}
