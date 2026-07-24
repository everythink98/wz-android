import { cookieNamesFromHeader } from './cookieHeaderNames';

export function summarizeYaohuoCookieHeader(header?: string | null) {
  const names = cookieNamesFromHeader(header);
  return {
    count: names.length,
    names
  };
}
