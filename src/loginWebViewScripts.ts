export const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const body = document.body ? document.body.innerText : "";
  const uidMatch = body.match(/UID\\s*[:：]\\s*(\\d+)/i);
  const spaceHref = Array.from(document.querySelectorAll('a[href*="/space/"]'))
    .map((link) => link.getAttribute("href") || "")
    .find((href) => /\\/space\\/\\d+/i.test(href)) || "";
  const spaceMatch = spaceHref.match(/\\/space\\/(\\d+)/i);
  const userId = uidMatch ? Number(uidMatch[1]) : spaceMatch ? Number(spaceMatch[1]) : null;
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
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

export const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;
