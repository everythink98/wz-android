const CREDIT_ORIGIN = 'https://credit.linux.do';
const CONNECT_ORIGIN = 'https://connect.linux.do';

export function isLinuxDoCreditAuthMessage(
  data: string,
  url: string,
  nonce: string
): 'complete' | 'interaction-required' | null {
  try {
    if (data.length > 1024) return null;
    const page = new URL(url);
    if (page.username || page.password || ![CREDIT_ORIGIN, CONNECT_ORIGIN, 'https://linux.do'].includes(page.origin))
      return null;
    const message: unknown = JSON.parse(data);
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'linuxdo-credit-auth' ||
      !('nonce' in message) ||
      message.nonce !== nonce ||
      !('status' in message)
    )
      return null;
    if (message.status === 'interaction-required') return message.status;
    // Android WebMessageListener supplies only the origin; the script confirms the session before posting.
    const originOnly = page.pathname === '/' && !page.search && !page.hash;
    return message.status === 'complete' &&
      page.origin === CREDIT_ORIGIN &&
      (originOnly || page.pathname === '/home' || page.pathname === '/login')
      ? 'complete'
      : null;
  } catch {
    return null;
  }
}

export function linuxDoCreditAuthScript(nonce: string) {
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid LDC authorization nonce');
  return `
(() => {
  if (window.top !== window || !window.ReactNativeWebView) return;
  const nonce = ${JSON.stringify(nonce)};
  if (window.__WZ_CREDIT_AUTH_NONCE__ === nonce) return;
  window.__WZ_CREDIT_AUTH_NONCE__ = nonce;
  let finished = false;
  let checking = false;
  const deadline = Date.now() + 25000;
  const send = (status) => {
    if (finished) return;
    finished = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'linuxdo-credit-auth', nonce, status }));
  };
  const secureUrl = (value, base) => {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid URL');
    return url;
  };
  const inspect = async () => {
    if (finished || checking) return;
    if (Date.now() >= deadline) {
      send('interaction-required');
      return;
    }
    try {
      const page = secureUrl(location.href);
      if (document.querySelector('#challenge-form, #cf-challenge-running, .cf-turnstile, iframe[src^="https://challenges.cloudflare.com/"]') ||
          /^(?:just a moment|checking your browser|verify you are human)[.!…\\s]*$/i.test(document.title || '')) {
        setTimeout(inspect, 1000);
        return;
      }
      if (page.origin === '${CREDIT_ORIGIN}') {
        if (page.pathname === '/api/v1/oauth/login') {
          const body = JSON.parse(document.body.textContent || '');
          if (body.error_msg || typeof body.data !== 'string') throw new Error('Invalid login response');
          const target = secureUrl(body.data);
          const callback = secureUrl(target.searchParams.get('redirect_uri') || '');
          if (target.origin !== '${CONNECT_ORIGIN}' || target.pathname !== '/oauth2/authorize' ||
              target.searchParams.get('response_type') !== 'code' || !target.searchParams.get('state') ||
              !target.searchParams.get('client_id') || callback.origin !== '${CREDIT_ORIGIN}' ||
              callback.pathname !== '/login') throw new Error('Unexpected authorization target');
          finished = true;
          location.assign(target.href);
          return;
        }
        const callback = page.pathname === '/login' && page.searchParams.get('code') && page.searchParams.get('state');
        if (page.pathname === '/home' || page.pathname === '/login') {
          checking = true;
          let response;
          let body;
          try {
            response = await fetch('/api/v1/oauth/user-info', { credentials: 'include', headers: { Accept: 'application/json' } });
            body = response.ok ? await response.json() : null;
          } catch {
            checking = false;
            setTimeout(inspect, 1000);
            return;
          }
          checking = false;
          if (body && !body.error_msg && body.data && body.data.id && body.data.username) {
            send('complete');
            return;
          }
          if (response.status === 401 && !callback) {
            finished = true;
            location.assign('${CREDIT_ORIGIN}/api/v1/oauth/login');
            return;
          }
          if (!callback && response.status !== 403) {
            send('interaction-required');
            return;
          }
        }
      } else if (page.origin === '${CONNECT_ORIGIN}') {
        // Existing grants may redirect immediately; a consent page still belongs to the user.
        if (document.querySelector('a[href*="/oauth2/approve/"], form[action*="/oauth2/approve"]')) {
          send('interaction-required');
          return;
        }
      } else if (page.origin === 'https://linux.do') {
        if (document.querySelector('input[type="password"], .login-button, form[action="/session"]')) {
          send('interaction-required');
          return;
        }
      } else {
        send('interaction-required');
        return;
      }
      if (Date.now() >= deadline) send('interaction-required');
      else setTimeout(inspect, 1000);
    } catch {
      send('interaction-required');
    }
  };
  void inspect();
})();
true;
`;
}
