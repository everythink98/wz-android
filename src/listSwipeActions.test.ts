import { describe, expect, it } from 'vitest';
import {
  LIST_SWIPE_ACTION_WIDTH,
  clampListSwipeTranslate,
  shouldCaptureListSwipe,
  shouldOpenListSwipeAction
} from './listSwipeActions';

describe('Android list swipe actions', () => {
  it('opens a row action only after a deliberate left swipe', () => {
    expect(shouldOpenListSwipeAction(-64, -0.35)).toBe(true);
    expect(shouldOpenListSwipeAction(-24, -0.35)).toBe(false);
    expect(shouldOpenListSwipeAction(64, 0.35)).toBe(false);
  });

  it('does not capture ordinary vertical scrolling', () => {
    expect(shouldCaptureListSwipe(-18, 44)).toBe(false);
    expect(shouldCaptureListSwipe(-18, 8)).toBe(true);
  });

  it('keeps the row translation within the revealed action width', () => {
    expect(clampListSwipeTranslate(-200)).toBe(-LIST_SWIPE_ACTION_WIDTH);
    expect(clampListSwipeTranslate(30)).toBe(0);
  });
});
