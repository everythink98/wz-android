import { describe, expect, it } from 'vitest';
import { cookieNamesFromHeader, summarizeCookieHeader } from './cookieHeaderNames';

describe('Cookie header diagnostics', () => {
  it('returns only unique names and never values', () => {
    const names = cookieNamesFromHeader(
      'session=private-value; cf_clearance=private-clearance; session=new-value; empty='
    );

    expect(names).toEqual(['cf_clearance', 'session']);
    expect(JSON.stringify(names)).not.toContain('private');
  });

  it('keeps Cookie diagnostics name-only and does not infer identity', () => {
    expect(summarizeCookieHeader('unrecognized=value; session=private; cf_clearance=private')).toEqual({
      count: 3,
      names: ['cf_clearance', 'session', 'unrecognized']
    });
  });

  it('records Cookie names without treating sidyaohuo as identity proof', () => {
    expect(summarizeCookieHeader('sidyaohuo=private; ASP.NET_SessionId=private-session; other=value')).toEqual({
      count: 3,
      names: ['ASP.NET_SessionId', 'other', 'sidyaohuo']
    });
  });
});
