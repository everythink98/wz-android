import { cookieNamesFromHeader } from '@/platform/network/cookieHeaderNames';

export function summarizeNodeSeekCookieHeader(header?: string | null) {
  const names = cookieNamesFromHeader(header);
  return {
    count: names.length,
    names
  };
}
