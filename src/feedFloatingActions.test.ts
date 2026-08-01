import { describe, expect, it } from 'vitest';
import {
  shouldAllowFeedAutoLoadRequest,
  shouldLoadMoreFeedFromScroll,
  shouldShowFeedFloatingActions
} from '@/feedFloatingActions';

describe('Android feed floating actions', () => {
  it('shows the back-to-top action after meaningful scrolling', () => {
    expect(shouldShowFeedFloatingActions(0)).toBe(false);
    expect(shouldShowFeedFloatingActions(420)).toBe(false);
    expect(shouldShowFeedFloatingActions(421)).toBe(true);
  });

  it('detects when scrolling is close enough to request the next feed page', () => {
    expect(
      shouldLoadMoreFeedFromScroll({
        contentOffset: { y: 900 },
        contentSize: { height: 2000 },
        layoutMeasurement: { height: 600 }
      })
    ).toBe(false);
    expect(
      shouldLoadMoreFeedFromScroll({
        contentOffset: { y: 1120 },
        contentSize: { height: 2000 },
        layoutMeasurement: { height: 600 }
      })
    ).toBe(true);
  });

  it('pauses automatic load-more requests after a failed load until a new drag arms them again', () => {
    expect(
      shouldAllowFeedAutoLoadRequest({
        pausedAfterFailure: true,
        lastOffset: null,
        offsetY: 1200
      })
    ).toBe(false);
    expect(
      shouldAllowFeedAutoLoadRequest({
        pausedAfterFailure: false,
        lastOffset: 1200,
        offsetY: 1240
      })
    ).toBe(false);
    expect(
      shouldAllowFeedAutoLoadRequest({
        pausedAfterFailure: false,
        lastOffset: 1200,
        offsetY: 1281
      })
    ).toBe(true);
  });
});
