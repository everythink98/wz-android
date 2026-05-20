import { describe, expect, it } from 'vitest';
import { shouldShowFeedFloatingActions } from './feedFloatingActions';

describe('Android feed floating actions', () => {
  it('only shows refresh and back-to-top actions after meaningful scrolling', () => {
    expect(shouldShowFeedFloatingActions(0)).toBe(false);
    expect(shouldShowFeedFloatingActions(420)).toBe(false);
    expect(shouldShowFeedFloatingActions(421)).toBe(true);
  });
});
