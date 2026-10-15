export const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';

export function sanitizeNodeSeekUserAgent(userAgent?: string) {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}
