import { describe, expect, it } from 'vitest';
import { shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from './feedFloatingActions';

describe('Android feed floating actions', () => {
  it('only shows refresh and back-to-top actions after meaningful scrolling', () => {
    expect(shouldShowFeedFloatingActions(0)).toBe(false);
    expect(shouldShowFeedFloatingActions(420)).toBe(false);
    expect(shouldShowFeedFloatingActions(421)).toBe(true);
  });

  it('detects when scrolling is close enough to request the next feed page', () => {
    expect(shouldLoadMoreFeedFromScroll({
      contentOffset: { y: 900 },
      contentSize: { height: 2000 },
      layoutMeasurement: { height: 600 }
    })).toBe(false);
    expect(shouldLoadMoreFeedFromScroll({
      contentOffset: { y: 1120 },
      contentSize: { height: 2000 },
      layoutMeasurement: { height: 600 }
    })).toBe(true);
  });
});
