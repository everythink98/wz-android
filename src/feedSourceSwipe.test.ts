import { describe, expect, it } from 'vitest';
import { feedSourceSwipeDirection } from './feedSourceSwipe';

describe('Android feed source swipe', () => {
  it('switches sources only after a deliberate horizontal swipe', () => {
    expect(feedSourceSwipeDirection(-80, 0, -0.2)).toBe(1);
    expect(feedSourceSwipeDirection(80, 0, 0.2)).toBe(-1);
    expect(feedSourceSwipeDirection(-30, 0, -0.8)).toBe(0);
  });

  it('does not switch sources for vertical or diagonal scrolling', () => {
    expect(feedSourceSwipeDirection(-90, 60, -0.5)).toBe(0);
    expect(feedSourceSwipeDirection(-60, 80, -0.8)).toBe(0);
    expect(feedSourceSwipeDirection(20, 120, 0.1)).toBe(0);
  });
});
