import { describe, expect, it } from 'vitest';
import { sanitizeNodeSeekUserAgent } from '@/platform/android/nodeSeekUserAgent';
import { summarizeNodeSeekCookieHeader } from './session';

describe('NodeSeek session metadata', () => {
  it('keeps Cookie diagnostics name-only and does not infer identity', () => {
    expect(summarizeNodeSeekCookieHeader('unrecognized=value; session=private; cf_clearance=private')).toEqual({
      count: 3,
      names: ['cf_clearance', 'session', 'unrecognized']
    });
  });

  it('normalizes the WebView User-Agent independently from Cookie state', () => {
    expect(sanitizeNodeSeekUserAgent('  Mozilla/5.0   ( Linux )  ')).toBe('Mozilla/5.0 (Linux)');
  });
});
