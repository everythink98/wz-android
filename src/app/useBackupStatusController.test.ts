import { describe, expect, it } from 'vitest';
import { isLinuxDoLoginCheckUnknown } from './accountStatusHelpers';

describe('backup status controller helpers', () => {
  it('treats linux.do checks that are neither ok nor expired as unknown', () => {
    expect(isLinuxDoLoginCheckUnknown({ ok: false, loginRequired: false, message: 'network error' })).toBe(true);
    expect(isLinuxDoLoginCheckUnknown({ ok: true, message: 'ok' })).toBe(false);
    expect(isLinuxDoLoginCheckUnknown({ ok: false, loginRequired: true, message: 'expired' })).toBe(false);
    expect(isLinuxDoLoginCheckUnknown(undefined)).toBe(false);
  });
});
