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

export const NODESEEK_REPLAY_READY_MESSAGE = 'wz:nodeseek-webview-ready';

export const NODESEEK_REPLAY_READINESS_SCRIPT = `
(() => {
  const host = String(location.hostname || "").toLowerCase();
  const bodyText = document.body ? String(document.body.innerText || "").trim() : "";
  const onNodeSeek = host === "nodeseek.com" || host.endsWith(".nodeseek.com");
  if (onNodeSeek && document.readyState !== "loading" && bodyText.length > 0) {
    window.ReactNativeWebView.postMessage(${JSON.stringify(NODESEEK_REPLAY_READY_MESSAGE)});
  }
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
  return "window.__WZ_LINUXDO_LOGIN_PROBE_ID__ = " + safeProbeId + ";\n" + LINUXDO_WEBVIEW_PROBE_SCRIPT;
}

const NODEIMAGE_API_BASE_URL = 'https://api.nodeimage.com';

export type NodeImageAuthPayload = {
  data: unknown;
  wtf: unknown;
  sign: unknown;
};

export function nodeImageApiKeyProbeScript(authPayload?: NodeImageAuthPayload | null) {
  const payloadScript = authPayload
    ? `window.__wzNodeImageAuthPayload = ${safeInjectedJson(authPayload)};`
    : '';
  return `${payloadScript}\n${NODEIMAGE_API_KEY_PROBE_SCRIPT}`;
}

export const NODEIMAGE_API_KEY_PROBE_SCRIPT = `
(() => {
  const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
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

function safeInjectedJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
