export const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const body = document.body ? document.body.innerText : "";
  const match = body.match(/UID\s*[:：]\s*(\d+)/i);
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    loggedIn: !/登录|注册|Sign in/i.test(body) || Boolean(match),
    userId: match ? Number(match[1]) : null,
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
