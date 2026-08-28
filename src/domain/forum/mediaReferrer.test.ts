import { describe, expect, it } from 'vitest';
import { normalizeMediaReferrerPolicy, normalizeMediaReferrerPolicyHeader } from './mediaReferrer';

describe('media referrer policy parsing', () => {
  it('separates response header lists from element attribute tokens', () => {
    expect(normalizeMediaReferrerPolicyHeader('origin, invalid, same-origin')).toBe('same-origin');
    expect(normalizeMediaReferrerPolicy('no-referrer,unsafe-url')).toBeUndefined();
    expect(normalizeMediaReferrerPolicy(' unsafe-url ')).toBeUndefined();
    expect(normalizeMediaReferrerPolicy('UNSAFE-URL')).toBe('unsafe-url');
    expect(normalizeMediaReferrerPolicy('invalid')).toBeUndefined();
  });
});
