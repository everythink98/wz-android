import { describe, expect, it } from 'vitest';
import { canUseLinuxDoLike } from './linuxdoPermissions';

describe('linux.do permissions', () => {
  it('uses list permissions before showing like actions', () => {
    expect(canUseLinuxDoLike({ canLike: false })).toBe(false);
    expect(canUseLinuxDoLike({ canLike: true })).toBe(true);
    expect(canUseLinuxDoLike({})).toBe(true);
  });
});
