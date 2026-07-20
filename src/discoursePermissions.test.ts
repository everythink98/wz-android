import { describe, expect, it } from 'vitest';

import { canToggleDiscourseLike } from './discoursePermissions';

describe('portable Discourse permissions', () => {
  it('fails closed when like permission is missing', () => {
    expect(canToggleDiscourseLike(undefined)).toBe(false);
    expect(canToggleDiscourseLike({})).toBe(false);
    expect(canToggleDiscourseLike({ canLike: false })).toBe(false);
    expect(canToggleDiscourseLike({ canLike: true })).toBe(true);
  });

  it('allows removing an observed current-user like', () => {
    expect(canToggleDiscourseLike({ liked: true, canLike: false })).toBe(true);
  });
});
