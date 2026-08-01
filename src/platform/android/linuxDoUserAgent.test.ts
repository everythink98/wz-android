import { describe, expect, it } from 'vitest';
import { sanitizeLinuxDoUserAgent } from './linuxDoUserAgent';

describe('linux.do WebView user agent', () => {
  it('normalizes whitespace without inventing a user agent', () => {
    expect(sanitizeLinuxDoUserAgent('  Mozilla/5.0   ( Android )  ')).toBe('Mozilla/5.0 (Android)');
    expect(sanitizeLinuxDoUserAgent()).toBe('');
  });
});
