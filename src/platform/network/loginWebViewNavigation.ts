export const LOGIN_WEBVIEW_ALLOWED_HOSTS = {
  linuxdo: ['linux.do', 'challenges.cloudflare.com'],
  nodeimage: ['nodeimage.com', 'nodeseek.com', 'challenges.cloudflare.com'],
  nodeseek: ['nodeseek.com', 'challenges.cloudflare.com'],
  yaohuo: ['www.yaohuo.me']
} as const;

export function shouldOpenLoginWebViewUrl(url: string, allowedHosts: readonly string[]) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return allowedHosts.some((host) => {
      const normalized = host.toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}
