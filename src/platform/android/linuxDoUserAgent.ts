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
/** Diagnostic comparison only; never use this non-cryptographic fingerprint for credentials. */
export function diagnosticUserAgentHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}
