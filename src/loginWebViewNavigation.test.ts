import { describe, expect, it } from 'vitest';
import { shouldOpenLoginWebViewUrl } from './loginWebViewNavigation';

describe('login WebView navigation guard', () => {
  it('allows only the expected login host and subdomains', () => {
    expect(shouldOpenLoginWebViewUrl('https://www.nodeseek.com/signin', ['nodeseek.com'])).toBe(true);
    expect(shouldOpenLoginWebViewUrl('https://login.nodeseek.com/path', ['nodeseek.com'])).toBe(true);
    expect(shouldOpenLoginWebViewUrl('http://www.nodeseek.com/signin', ['nodeseek.com'])).toBe(false);
    expect(shouldOpenLoginWebViewUrl('https://evil.example/signin', ['nodeseek.com'])).toBe(false);
    expect(shouldOpenLoginWebViewUrl('javascript:alert(1)', ['nodeseek.com'])).toBe(false);
  });
});
