import { describe, expect, it } from 'vitest';
import {
  sanitizeLinuxDoUserAgent,
  summarizeLinuxDoCookieHeader
} from './linuxdoSession';

describe('linux.do session metadata', () => {
  it('accepts _forum_session as a session candidate without requiring _t', () => {
    expect(summarizeLinuxDoCookieHeader(
      '_forum_session=session; unrelated=value; cf_clearance=clearance'
    )).toEqual({
      names: ['_forum_session', 'cf_clearance', 'unrelated'],
      hasClearance: true,
      hasSessionCandidate: true
    });
  });

  it('does not treat clearance alone as a session candidate', () => {
    expect(summarizeLinuxDoCookieHeader('cf_clearance=clearance')).toEqual({
      names: ['cf_clearance'],
      hasClearance: true,
      hasSessionCandidate: false
    });
  });

  it('normalizes the WebView user agent without inventing one', () => {
    expect(sanitizeLinuxDoUserAgent('  Mozilla/5.0   ( Android )  ')).toBe(
      'Mozilla/5.0 (Android)'
    );
    expect(sanitizeLinuxDoUserAgent()).toBe('');
  });
});
