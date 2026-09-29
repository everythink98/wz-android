import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '@/domain/forum/sourceUrls';

export const NODESEEK_LOGIN_PROBE_SCRIPT = String.raw`
(() => {
  if (window.top !== window || !window.ReactNativeWebView || !document.documentElement) return;
  const type = 'nodeseek-login';
  const documentKey = String(location.href || "") + ":" + String(performance.timeOrigin || 0);
  const current = window.__WZ_ACCOUNT_PAGE_OBSERVER__;
  if (current && current.documentKey === documentKey && current.type === type) {
    current.report();
    return;
  }
  current?.observer.disconnect();
  let previousState = '';
  const report = () => {
    if (String(location.href || "") + ":" + String(performance.timeOrigin || 0) !== documentKey) return;
    const configUser = window.__config__ && typeof window.__config__ === 'object'
      && window.__config__.user && typeof window.__config__.user === 'object'
      ? window.__config__.user : null;
    const configId = Number(configUser && (configUser.member_id || configUser.uid || configUser.id || configUser.userId || configUser.user_id));
    const configName = String(configUser && (configUser.member_name || configUser.username || configUser.name || configUser.displayName) || '').trim();
    const hasConfigUser = Number.isInteger(configId) && configId > 0 && Boolean(configName);
    const usernameLink = document.querySelector('a.Username[href*="/space/"], .Username a[href*="/space/"]');
    const hasAccountMarker = /\/space\/\d+/i.test(String(usernameLink?.getAttribute('href') || ''))
      || Boolean(document.querySelector('a[href*="/api/account/signOut"]'));
    const guestKinds = new Set(Array.from(document.querySelectorAll('a.btn[href], header a[href], nav a[href], .header a[href], .navbar a[href], .topbar a[href]')).flatMap((link) => {
      try {
        const target = new URL(String(link.getAttribute('href') || ''), location.href);
        const host = target.hostname.toLowerCase();
        if (target.protocol !== 'https:' || (host !== 'nodeseek.com' && !host.endsWith('.nodeseek.com'))) return [];
        const label = String(link.textContent || '').trim();
        if (/^\/(login|signin|sign-in)(?:\.html?)?\/?$/i.test(target.pathname) && /^(登录|sign in|log in)$/i.test(label)) return ['login'];
        if (/^\/(register|signup|sign-up)(?:\.html?)?\/?$/i.test(target.pathname) && /^(注册|sign up|register)$/i.test(label)) return ['register'];
        return [];
      } catch { return []; }
    }));
    const pageStatus = hasConfigUser ? 'logged-in' : guestKinds.has('login') && guestKinds.has('register') ? 'logged-out' : hasAccountMarker ? 'logged-in' : 'unknown';
    const hasChallengeMarker = Boolean(document.querySelector('#challenge-form, #cf-challenge-running, .cf-turnstile, iframe[src^="https://challenges.cloudflare.com/"]'));
    const status = hasChallengeMarker ? 'unknown' : pageStatus;
    const state = status + ':' + hasChallengeMarker;
    if (state === previousState) return;
    previousState = state;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type,
      documentKey,
      status,
      hasChallengeMarker,
      userAgent: navigator.userAgent || ''
    }));
  };
  const observer = new MutationObserver(report);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'id', 'src', 'href', 'name', 'method'] });
  window.__WZ_ACCOUNT_PAGE_OBSERVER__ = { documentKey, type, observer, report };
  report();
})();
true;
`;

export const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  const probeId = Number(window.__WZ_LINUXDO_LOGIN_PROBE_ID__);
  delete window.__WZ_LINUXDO_LOGIN_PROBE_ID__;
  window.__WZ_LINUXDO_PAGE_OBSERVER__?.disconnect();
  let previousState = '';
  const report = () => {
  const hasLoggedInMarker = Boolean(document.querySelector('.d-header .current-user, header .current-user, #current-user'));
  const hasLoggedOutMarker = Boolean(document.querySelector('.d-header .login-button, header .login-button, button.login-button'));
  const status = hasLoggedInMarker ? "logged-in" : hasLoggedOutMarker ? "logged-out" : "unknown";
  const hasChallengeMarker = Boolean(document.querySelector('#challenge-form, #cf-challenge-running, .cf-turnstile, iframe[src^="https://challenges.cloudflare.com/"]'));
  const state = status + ':' + hasChallengeMarker;
  if (state === previousState) return;
  previousState = state;
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    probeId: Number.isInteger(probeId) && probeId > 0 ? probeId : undefined,
    documentKey: String(location.href || "") + ":" + String(performance.timeOrigin || 0),
    status,
    hasChallengeMarker,
    loggedIn: status === "logged-in" ? true : status === "logged-out" ? false : undefined,
    userAgent: navigator.userAgent || ""
  }));
  };
  const observer = new MutationObserver(report);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'id', 'src'] });
  window.__WZ_LINUXDO_PAGE_OBSERVER__ = observer;
  report();
})();
true;
`;

const NODEIMAGE_API_BASE_URL = 'https://api.nodeimage.com';
const NODEIMAGE_AUTH_NONCE_PATTERN = /^[0-9a-f]{32}$/;

export type NodeImageAuthPayload = {
  data: unknown;
  wtf: unknown;
  sign: unknown;
};

function nodeImageDocumentGuardScript(expectedUrl: string) {
  return `
  if (window.top !== window) {
    return;
  }
  let pageUrl;
  try {
    pageUrl = new URL(String(location.href || ""));
  } catch {
    return;
  }
  if (
    pageUrl.protocol !== "https:"
    || pageUrl.username
    || pageUrl.password
    || pageUrl.port
    || pageUrl.href !== ${safeInjectedJson(expectedUrl)}
  ) {
    return;
  }
  const post = (payload) => {
    const documentUrl = String(location.href || "");
    if (documentUrl !== pageUrl.href) {
      return;
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      ...payload,
      documentUrl,
      nonce
    }));
  };
`;
}

export function nodeImageSessionScript(nonce: string) {
  const safeNonce = requiredNodeImageAuthNonce(nonce);
  return `
(() => {
  const nonce = ${safeInjectedJson(safeNonce)};
${nodeImageDocumentGuardScript(NODEIMAGE_URL)}
  const readInputKey = () => String(document.querySelector("#apiKeyInput")?.value || "").trim();
  const readResponseKey = (data) => {
    if (!data || typeof data !== "object") {
      return "";
    }
    const nested = data.data && typeof data.data === "object" ? data.data : {};
    return String(data.api_key || data.apiKey || nested.api_key || nested.apiKey || "").trim();
  };
  const renderedApiKey = readInputKey();
  if (renderedApiKey) {
    post({ type: "nodeimage-session-key", apiKey: renderedApiKey });
    return;
  }
  (async () => {
    try {
      const response = await fetch("${NODEIMAGE_API_BASE_URL}/api/user/api-key", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => null);
      if (response.ok && readResponseKey(data)) {
        post({ type: "nodeimage-session-key", data });
        return;
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (
        response.status === 401
        && contentType.includes("application/json")
        && data
        && typeof data.error === "string"
        && data.error.trim()
      ) {
        post({ type: "nodeimage-session-expired", status: response.status });
        return;
      }
      post({ type: "nodeimage-session-error", status: response.status });
    } catch (error) {
      post({
        type: "nodeimage-session-error",
        error: String(error && error.message || error || "unknown")
      });
    }
  })();
})();
true;
`;
}

export function nodeSeekNodeImageAuthScript(nonce: string) {
  const safeNonce = requiredNodeImageAuthNonce(nonce);
  return `
(() => {
  const nonce = ${safeInjectedJson(safeNonce)};
${nodeImageDocumentGuardScript(NODEIMAGE_AUTH_URL)}
  let requested = false;
  const removeStartListeners = () => {
    window.removeEventListener("message", handleStart);
    document.removeEventListener("message", handleStart);
  };
  const requestAuthData = async () => {
    if (requested) {
      return;
    }
    requested = true;
    removeStartListeners();
    try {
      const response = await fetch("/api/cAuth?target=NodeImage", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success === false) {
        post({
          type: "nodeimage-auth-error",
          error: data && (data.message || data.error) || "NodeSeek 授权失败"
        });
        return;
      }
      post({
        type: "nodeimage-auth-data",
        data: data.data,
        wtf: data.wtf,
        sign: data.sign
      });
    } catch (error) {
      post({
        type: "nodeimage-auth-error",
        error: String(error && error.message || error || "unknown")
      });
    }
  };
  function handleStart(event) {
    let message = event && event.data;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (
      !message
      || message.type !== "nodeimage-connect-start"
      || message.nonce !== nonce
      || String(location.href || "") !== pageUrl.href
    ) {
      return;
    }
    clearInterval(readyTimer);
    void requestAuthData();
  }
  window.addEventListener("message", handleStart);
  document.addEventListener("message", handleStart);
  const readyTimer = setInterval(() => {
    post({ type: "nodeimage-connect-ready" });
  }, 500);
  post({ type: "nodeimage-connect-ready" });
})();
true;
`;
}

export function nodeImageAuthPayloadScript(nonce: string, authPayload: NodeImageAuthPayload) {
  const safeNonce = requiredNodeImageAuthNonce(nonce);
  return `
(() => {
  const nonce = ${safeInjectedJson(safeNonce)};
  const authPayload = ${safeInjectedJson(authPayload)};
  const nodeImageApiBaseUrl = "${NODEIMAGE_API_BASE_URL}";
${nodeImageDocumentGuardScript(NODEIMAGE_URL)}
  const readInputKey = () => String(document.querySelector("#apiKeyInput")?.value || "").trim();
  let verified = false;
  const verifyNodeImageAuth = async () => {
    if (verified) {
      return true;
    }
    verified = true;
    const response = await fetch(nodeImageApiBaseUrl + "/api/auth/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: authPayload.data,
        wtf: authPayload.wtf,
        sign: authPayload.sign
      })
    });
    if (response.ok) {
      return true;
    }
    const data = await response.json().catch(() => null);
    post({
      type: "nodeimage-api-key",
      error: data && (data.message || data.error) || "NodeImage 授权验证失败",
      status: response.status
    });
    return false;
  };
  (async () => {
    try {
      const verified = await verifyNodeImageAuth();
      if (!verified) {
        return;
      }
      const response = await fetch(nodeImageApiBaseUrl + "/api/user/api-key", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        post({ type: "nodeimage-api-key", data });
        return;
      }
      const apiKey = readInputKey();
      if (apiKey) {
        post({ type: "nodeimage-api-key", apiKey });
        return;
      }
      post({ type: "nodeimage-api-key", error: "not-authorized", status: response.status });
    } catch (error) {
      const apiKey = readInputKey();
      if (apiKey) {
        post({ type: "nodeimage-api-key", apiKey });
        return;
      }
      post({ type: "nodeimage-api-key", error: String(error && error.message || error || "unknown") });
    }
  })();
})();
true;
`;
}

function safeInjectedJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function requiredNodeImageAuthNonce(nonce: string) {
  const value = String(nonce || '').trim();
  if (!NODEIMAGE_AUTH_NONCE_PATTERN.test(value)) {
    throw new Error('NodeImage authorization nonce must contain 128 bits');
  }
  return value;
}
