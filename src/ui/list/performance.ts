const DEFAULT_DRAW_DISTANCE = 900;

export const FEED_LIST_PERFORMANCE_PROPS = {
  drawDistance: DEFAULT_DRAW_DISTANCE,
  maintainVisibleContentPosition: { disabled: true },
  maxItemsInRecyclePool: 120
};

export const TOPIC_LIST_PERFORMANCE_PROPS = {
  drawDistance: DEFAULT_DRAW_DISTANCE,
  maxItemsInRecyclePool: 80
};

export const TOPIC_DETAIL_LIST_PERFORMANCE_PROPS = {
  disableScrollViewPanResponder: true,
  drawDistance: 720,
  maxItemsInRecyclePool: 40
};
