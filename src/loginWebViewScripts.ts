import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from './appUrls';

export const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const probeId = Number(window.__WZ_NODESEEK_LOGIN_PROBE_ID__);
  delete window.__WZ_NODESEEK_LOGIN_PROBE_ID__;
  const documentKey = String(location.href || "") + ":" + String(performance.timeOrigin || 0);
  const numberFromValue = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  };
  const stringFromValue = (value) => String(value || "").trim();
  const body = document.body ? document.body.innerText : "";
  const uidMatch = body.match(/UID\\s*[:：]\\s*(\\d+)/i);
  const configUser = window.__config__ && typeof window.__config__ === "object"
    && window.__config__.user && typeof window.__config__.user === "object"
    ? window.__config__.user
    : null;
  const configUserId = numberFromValue(configUser && (
    configUser.member_id || configUser.uid || configUser.id || configUser.userId || configUser.user_id
  ));
  const configUsername = stringFromValue(configUser && (
    configUser.member_name || configUser.username || configUser.name || configUser.displayName
  ));
  const hasConfigUser = Boolean(configUserId && configUsername);
  const usernameLink = document.querySelector('a.Username[href*="/space/"], .Username a[href*="/space/"]');
  const usernameLinkId = stringFromValue(usernameLink?.getAttribute("href")).match(/\\/space\\/(\\d+)/i);
  const signOutLink = document.querySelector('a[href*="/api/account/signOut"]');
  const hasAccountMarker = hasConfigUser || Boolean(usernameLinkId) || Boolean(signOutLink);
  const userId = configUserId
    || numberFromValue(usernameLinkId && usernameLinkId[1])
    || (hasAccountMarker ? numberFromValue(uidMatch && uidMatch[1]) : null);
  const csrfToken = stringFromValue(document.querySelector('meta[name="csrf-token"]')?.getAttribute("content"));
  const guestKinds = new Set(Array.from(document.querySelectorAll('a.btn[href], header a[href], nav a[href], .header a[href], .navbar a[href], .topbar a[href]')).flatMap((link) => {
    try {
      const href = String(link.getAttribute("href") || "").trim();
      let pathname = "";
      if (href.startsWith("/")) {
        pathname = href.split(/[?#]/, 1)[0];
      } else {
        const target = new URL(href, location.href);
        const host = String(target.hostname || "").toLowerCase();
        if (target.protocol !== "https:" || (host !== "nodeseek.com" && !host.endsWith(".nodeseek.com"))) {
          return [];
        }
        pathname = target.pathname || "";
      }
      const label = String(link.textContent || "").trim();
      if (/^\\/(login|signin|sign-in)(?:\\.html?)?\\/?$/i.test(pathname) && /^(登录|sign in|log in)$/i.test(label)) {
        return ["login"];
      }
      if (/^\\/(register|signup|sign-up)(?:\\.html?)?\\/?$/i.test(pathname) && /^(注册|sign up|register)$/i.test(label)) {
        return ["register"];
      }
      return [];
    } catch {
      return [];
    }
  }));
  const hasGuestControls = guestKinds.has("login") && guestKinds.has("register");
  const status = hasConfigUser ? "logged-in" : hasGuestControls ? "logged-out" : hasAccountMarker ? "logged-in" : "unknown";
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    probeId: Number.isInteger(probeId) && probeId > 0 ? probeId : undefined,
    documentKey,
    status,
    loggedIn: status === "logged-in" ? true : status === "logged-out" ? false : undefined,
    userId: status === "logged-in" ? userId : null,
    username: "",
    csrfToken,
    userAgent: navigator.userAgent || ""
  }));
})();
true;
`;

export const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  const probeId = Number(window.__WZ_LINUXDO_LOGIN_PROBE_ID__);
  delete window.__WZ_LINUXDO_LOGIN_PROBE_ID__;
  const hasLoggedInMarker = Boolean(document.querySelector('.d-header .current-user, header .current-user, #current-user'));
  const hasLoggedOutMarker = Boolean(document.querySelector('.d-header .login-button, header .login-button, button.login-button'));
  const status = hasLoggedInMarker ? "logged-in" : hasLoggedOutMarker ? "logged-out" : "unknown";
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    probeId: Number.isInteger(probeId) && probeId > 0 ? probeId : undefined,
    documentKey: String(location.href || "") + ":" + String(performance.timeOrigin || 0),
    status,
    loggedIn: status === "logged-in" ? true : status === "logged-out" ? false : undefined,
    userAgent: navigator.userAgent || ""
  }));
})();
true;
`;

export function linuxDoWebViewProbeScript(probeId: number) {
  const safeProbeId = Number.isInteger(probeId) && probeId > 0 ? probeId : 0;
  return 'window.__WZ_LINUXDO_LOGIN_PROBE_ID__ = ' + safeProbeId + ';\n' + LINUXDO_WEBVIEW_PROBE_SCRIPT;
}

const NODEIMAGE_API_BASE_URL = 'https://api.nodeimage.com';
const NODEIMAGE_AUTH_NONCE_PATTERN = /^[0-9a-f]{32}$/;

export type NodeImageAuthPayload = {
  data: unknown;
  wtf: unknown;
  sign: unknown;
};

export function nodeImageSessionScript(nonce: string) {
  const safeNonce = requiredNodeImageAuthNonce(nonce);
  return `
(() => {
  const nonce = ${safeInjectedJson(safeNonce)};
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
    || pageUrl.href !== ${safeInjectedJson(NODEIMAGE_URL)}
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
    || pageUrl.href !== ${safeInjectedJson(NODEIMAGE_AUTH_URL)}
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
    || pageUrl.href !== ${safeInjectedJson(NODEIMAGE_URL)}
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
