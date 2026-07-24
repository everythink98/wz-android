import { describe, expect, it } from 'vitest';
import { cookieNamesFromHeader } from './cookieHeaderNames';

describe('Cookie header diagnostics', () => {
  it('returns only unique names and never values', () => {
    const names = cookieNamesFromHeader(
      'session=private-value; cf_clearance=private-clearance; session=new-value; empty='
    );

    expect(names).toEqual(['cf_clearance', 'session']);
    expect(JSON.stringify(names)).not.toContain('private');
  });
});
