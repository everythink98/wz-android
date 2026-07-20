export function shouldOpenLoginWebViewUrl(url: string, allowedHosts: string[]) {
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

export function isTrustedNodeImageAuthMessageSource(type: unknown, url: string) {
  if (type === 'nodeimage-auth-data' || type === 'nodeimage-auth-error') {
    return shouldOpenLoginWebViewUrl(url, ['nodeseek.com']);
  }
  if (type === 'nodeimage-api-key') {
    return shouldOpenLoginWebViewUrl(url, ['nodeimage.com']);
  }
  return false;
}
