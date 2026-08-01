import { describe, expect, it } from 'vitest';
import { isTrustedNodeImageAuthMessageSource, shouldOpenLoginWebViewUrl } from './loginWebViewNavigation';

describe('login WebView navigation guard', () => {
  it('allows only the expected login host and subdomains', () => {
    expect(shouldOpenLoginWebViewUrl('https://www.nodeseek.com/signin', ['nodeseek.com'])).toBe(true);
    expect(shouldOpenLoginWebViewUrl('https://login.nodeseek.com/path', ['nodeseek.com'])).toBe(true);
    expect(shouldOpenLoginWebViewUrl('http://www.nodeseek.com/signin', ['nodeseek.com'])).toBe(false);
    expect(shouldOpenLoginWebViewUrl('https://evil.example/signin', ['nodeseek.com'])).toBe(false);
    expect(shouldOpenLoginWebViewUrl('javascript:alert(1)', ['nodeseek.com'])).toBe(false);
  });

  it('REG-ACCOUNT-010 accepts NodeImage bridge messages only from the phase owner', () => {
    expect(
      isTrustedNodeImageAuthMessageSource('nodeimage-auth-data', 'https://www.nodeseek.com/connect?target=NodeImage')
    ).toBe(true);
    expect(isTrustedNodeImageAuthMessageSource('nodeimage-api-key', 'https://nodeimage.com/')).toBe(true);
    expect(
      isTrustedNodeImageAuthMessageSource('nodeimage-api-key', 'https://www.nodeseek.com/connect?target=NodeImage')
    ).toBe(false);
    expect(isTrustedNodeImageAuthMessageSource('nodeimage-auth-data', 'https://nodeimage.com/')).toBe(false);
    expect(isTrustedNodeImageAuthMessageSource('nodeimage-api-key', 'https://evil.example/')).toBe(false);
    expect(isTrustedNodeImageAuthMessageSource('nodeimage-api-key', 'http://nodeimage.com/')).toBe(false);
  });
});
