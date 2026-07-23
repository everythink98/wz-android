import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from './androidWebViewUserAgent';
import { cookieNamesFromHeader } from './cookieHeaderNames';

export const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';

export function sanitizeNodeSeekUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_NODESEEK_ANDROID_USER_AGENT = sanitizeNodeSeekUserAgent(
  DEFAULT_ANDROID_WEBVIEW_USER_AGENT
);

export function summarizeNodeSeekCookieHeader(header?: string | null) {
  const names = cookieNamesFromHeader(header);
  return {
    count: names.length,
    names
  };
}
