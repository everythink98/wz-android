import { cookieNamesFromHeader } from '@/platform/network/cookieHeaderNames';

export function summarizeLinuxDoCookieHeader(header?: string | null) {
  const names = cookieNamesFromHeader(header);
  return {
    names,
    hasClearance: names.includes('cf_clearance'),
    hasSessionCandidate: names.includes('_t') || names.includes('_forum_session')
  };
}
