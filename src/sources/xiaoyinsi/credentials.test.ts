import { describe, expect, it } from 'vitest';

import {
  parseStoredXiaoyinsiCredential,
  serializeXiaoyinsiCredential,
  xiaoyinsiCredentialsHaveScope
} from './credentials';

describe('Xiaoyinsi credential bundle', () => {
  it('treats a legacy raw token as read/write without claiming notification scope', () => {
    const credential = parseStoredXiaoyinsiCredential('legacy-secret');

    expect(credential).toEqual({ apiKey: 'legacy-secret', scopes: ['read', 'write'] });
    expect(xiaoyinsiCredentialsHaveScope(credential, 'notifications')).toBe(false);
  });

  it('round-trips a versioned token and its explicit scopes', () => {
    const stored = serializeXiaoyinsiCredential({
      apiKey: 'new-secret',
      scopes: ['read', 'write', 'notifications']
    });

    expect(JSON.parse(stored)).toEqual({
      version: 1,
      apiKey: 'new-secret',
      scopes: ['read', 'write', 'notifications']
    });
    expect(parseStoredXiaoyinsiCredential(stored)).toEqual({
      apiKey: 'new-secret',
      scopes: ['read', 'write', 'notifications']
    });
  });
});
