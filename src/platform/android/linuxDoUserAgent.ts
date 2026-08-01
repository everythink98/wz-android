import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from './androidWebViewUserAgent';

export const LINUXDO_USER_AGENT_STORAGE_KEY = 'linuxdo-user-agent';

export function sanitizeLinuxDoUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_LINUXDO_ANDROID_USER_AGENT = sanitizeLinuxDoUserAgent(DEFAULT_ANDROID_WEBVIEW_USER_AGENT);
