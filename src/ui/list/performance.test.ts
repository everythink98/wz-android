import { describe, expect, it } from 'vitest';
import { FEED_LIST_PERFORMANCE_PROPS, TOPIC_DETAIL_LIST_PERFORMANCE_PROPS } from './performance';

describe('list performance props', () => {
  it('[REG-FEED-002] lets Feed filter changes reset the list to the first topic', () => {
    expect(FEED_LIST_PERFORMANCE_PROPS).toMatchObject({
      maintainVisibleContentPosition: { disabled: true }
    });
  });

  it('lets selectable topic detail text own long press without dropping FlashList', () => {
    expect(TOPIC_DETAIL_LIST_PERFORMANCE_PROPS).toMatchObject({
      disableScrollViewPanResponder: true,
      drawDistance: 720,
      maintainVisibleContentPosition: { disabled: true },
      maxItemsInRecyclePool: 40
    });
  });
});
