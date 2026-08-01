import { describe, expect, it } from 'vitest';
import { summarizeYaohuoCookieHeader } from '@/yaohuoSession';

describe('Yaohuo session metadata', () => {
  it('records Cookie names without treating sidyaohuo as identity proof', () => {
    expect(summarizeYaohuoCookieHeader('sidyaohuo=private; ASP.NET_SessionId=private-session; other=value')).toEqual({
      count: 3,
      names: ['ASP.NET_SessionId', 'other', 'sidyaohuo']
    });
  });
});
