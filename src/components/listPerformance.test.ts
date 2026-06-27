import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' }
}));

import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from './listPerformance';

describe('list performance props', () => {
  it('uses FlashList recycling props for long topic detail lists', () => {
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS.drawDistance).toBeGreaterThanOrEqual(700);
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS.maxItemsInRecyclePool).toBeLessThanOrEqual(80);
  });
});
