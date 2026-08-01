import { DEFAULT_ANDROID_WEBVIEW_USER_AGENT } from '@/platform/android/androidWebViewUserAgent';
import { cookieNamesFromHeader } from '@/platform/network/cookieHeaderNames';

export const LINUXDO_USER_AGENT_STORAGE_KEY = 'linuxdo-user-agent';

export function sanitizeLinuxDoUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export const DEFAULT_LINUXDO_ANDROID_USER_AGENT = sanitizeLinuxDoUserAgent(DEFAULT_ANDROID_WEBVIEW_USER_AGENT);

export function summarizeLinuxDoCookieHeader(header?: string | null) {
  const names = cookieNamesFromHeader(header);
  return {
    names,
    hasClearance: names.includes('cf_clearance'),
    hasSessionCandidate: names.includes('_t') || names.includes('_forum_session')
  };
}
