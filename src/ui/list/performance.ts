const DEFAULT_DRAW_DISTANCE = 900;

export const FEED_LIST_PERFORMANCE_PROPS = {
  // Android edge stretch otherwise consumes the first part of a reverse drag.
  overScrollMode: 'never' as const,
  maintainVisibleContentPosition: { disabled: true },
  maxItemsInRecyclePool: 120
};

export const TOPIC_LIST_PERFORMANCE_PROPS = {
  overScrollMode: 'never' as const,
  drawDistance: DEFAULT_DRAW_DISTANCE,
  maxItemsInRecyclePool: 80
};

export const TOPIC_DETAIL_LIST_PERFORMANCE_PROPS = {
  overScrollMode: 'never' as const,
  disableScrollViewPanResponder: true,
  drawDistance: 720,
  maxItemsInRecyclePool: 40
};
