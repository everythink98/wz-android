import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from './androidWebViewUserAgent';

export const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';

export function sanitizeNodeSeekUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_NODESEEK_ANDROID_USER_AGENT = sanitizeNodeSeekUserAgent(DEFAULT_ANDROID_WEBVIEW_USER_AGENT);
