import { describe, expect, it } from 'vitest';

import { moreBadgeAccessibilityLabel, moreBadgeState } from './moreBadge';

describe('More badge', () => {
  it('distinguishes update and message badges for accessibility', () => {
    expect(moreBadgeState(false, false)).toBe('none');
    expect(moreBadgeState(true, false)).toBe('update');
    expect(moreBadgeState(false, true)).toBe('messages');
    expect(moreBadgeState(true, true)).toBe('both');
    expect(moreBadgeAccessibilityLabel('none')).toBe('更多');
    expect(moreBadgeAccessibilityLabel('update')).toBe('更多，有可用更新');
    expect(moreBadgeAccessibilityLabel('messages')).toBe('更多，有新消息');
    expect(moreBadgeAccessibilityLabel('both')).toBe('更多，有新消息和可用更新');
  });
});
