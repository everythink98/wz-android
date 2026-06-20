import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' }
}));

import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from './listPerformance';

describe('list performance props', () => {
  it('keeps long topic detail lists clipped and batched', () => {
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS.removeClippedSubviews).toBe(true);
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS.initialNumToRender).toBeLessThanOrEqual(6);
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS.windowSize).toBeLessThanOrEqual(7);
  });
});
