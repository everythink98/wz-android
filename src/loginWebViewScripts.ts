import { safeInjectedJson } from './loginFormAdapters';
import type { WebViewMessageSession } from './webViewMessageGuard';

export function nodeSeekLoginProbeScript(session: WebViewMessageSession) {
  return `
(() => {
  const messageSession = ${safeInjectedJson(session)};
  const numberFromValue = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  };
  const stringFromValue = (value) => String(value || "").trim();
  const body = document.body ? document.body.innerText : "";
  const uidMatch = body.match(/UID\\s*[:：]\\s*(\\d+)/i);
  const usernameLink = document.querySelector('a.Username[href*="/space/"], .Username a[href*="/space/"]');
  const usernameLinkId = stringFromValue(usernameLink?.getAttribute("href")).match(/\\/space\\/(\\d+)/i);
  const userId = numberFromValue(uidMatch && uidMatch[1]) || numberFromValue(usernameLinkId && usernameLinkId[1]);
  const hasAccountMarker = Boolean(userId)
    || Boolean(document.querySelector('a[href*="/api/account/signOut"], a[href*="/setting"], a[href*="/notification"]'));
  const hasGuestPath = /\\/(login|signin|sign-in|register|signup|sign-up)\\/?$/i.test(location.pathname || "");
  const hasGuestLink = Boolean(document.querySelector('a[href*="/login"], a[href*="/signin"], a[href*="/sign-in"], a[href*="/register"], a[href*="/signup"], a[href*="/sign-up"]'));
  const hasGuestText = body.split(/\\n/).some((line) => /^\\s*(登录|注册|Sign in|Sign up)\\s*$/i.test(line));
  const status = hasAccountMarker ? "logged-in" : (hasGuestPath || hasGuestLink || hasGuestText) ? "logged-out" : "unknown";
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    status,
    loggedIn: status === "logged-in" ? true : status === "logged-out" ? false : undefined,
    userId,
    username: "",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || "",
    sessionId: messageSession.sessionId,
    nonce: messageSession.nonce
  }));
})();
true;
`;
}

export function linuxDoWebViewProbeScript(session: WebViewMessageSession) {
  return `
(() => {
  const messageSession = ${safeInjectedJson(session)};
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || "",
    sessionId: messageSession.sessionId,
    nonce: messageSession.nonce
  }));
})();
true;
`;
}

const NODEIMAGE_API_BASE_URL = 'https://api.nodeimage.com';

export type NodeImageAuthPayload = {
  data: unknown;
  wtf: unknown;
  sign: unknown;
};

export function nodeImageApiKeyProbeScript(
  authPayload: NodeImageAuthPayload | null | undefined,
  session: WebViewMessageSession
) {
  const payloadScript = authPayload
    ? `window.__wzNodeImageAuthPayload = ${safeInjectedJson(authPayload)};`
    : '';
  return `${payloadScript}\n${nodeImageApiKeyProbeBody(session)}`;
}

function nodeImageApiKeyProbeBody(session: WebViewMessageSession) {
  return `
(() => {
  const messageSession = ${safeInjectedJson(session)};
  const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({}, payload, messageSession)));
  const nodeImageApiBaseUrl = "${NODEIMAGE_API_BASE_URL}";
  const host = String(location.hostname || "").toLowerCase();
  const isNodeSeekConnectPage = () => {
    if (host !== "nodeseek.com" && host !== "www.nodeseek.com") {
      return false;
    }
    if (!/\\/connect\\b/i.test(location.pathname || "") || !/target=NodeImage/i.test(location.search || "")) {
      return false;
    }
    return true;
  };
  const requestNodeSeekAuthData = async () => {
    if (window.__wzNodeImageAuthDataRequested) {
      return;
    }
    window.__wzNodeImageAuthDataRequested = true;
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
      post({ type: "nodeimage-auth-error", error: String(error && error.message || error || "unknown") });
    }
  };
  if (isNodeSeekConnectPage()) {
    void requestNodeSeekAuthData();
    return;
  }
  if (host !== "nodeimage.com" && host !== "www.nodeimage.com") {
    return;
  }
  const readInputKey = () => String(document.querySelector("#apiKeyInput")?.value || "").trim();
  const verifyNodeImageAuth = async () => {
    const payload = window.__wzNodeImageAuthPayload;
    if (!payload || window.__wzNodeImageAuthVerified) {
      return true;
    }
    window.__wzNodeImageAuthVerified = true;
    const response = await fetch(nodeImageApiBaseUrl + "/api/auth/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: payload.data,
        wtf: payload.wtf,
        sign: payload.sign
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
