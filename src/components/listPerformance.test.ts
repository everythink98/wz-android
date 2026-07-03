import { describe, expect, it } from 'vitest';
import { TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from './listPerformance';

describe('list performance props', () => {
  it('lets selectable topic detail text own long press without dropping FlashList', () => {
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS).toMatchObject({
      disableScrollViewPanResponder: true,
      drawDistance: 720,
      maxItemsInRecyclePool: 40
    });
  });
});
