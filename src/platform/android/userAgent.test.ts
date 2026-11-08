import { describe, expect, it } from 'vitest';
import { sanitizeWebViewUserAgent } from './userAgent';

describe('WebView user agent', () => {
  it('normalizes whitespace without inventing a user agent', () => {
    expect(sanitizeWebViewUserAgent('  Mozilla/5.0   ( Android )  ')).toBe('Mozilla/5.0 (Android)');
    expect(sanitizeWebViewUserAgent('  Mozilla/5.0   ( Linux )  ')).toBe('Mozilla/5.0 (Linux)');
    expect(sanitizeWebViewUserAgent()).toBe('');
  });
});
