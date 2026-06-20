import { Platform } from 'react-native';

const DEFAULT_DRAW_DISTANCE = Platform.OS === 'android' ? 900 : 700;

export const FEED_LIST_PERFORMANCE_PROPS = {
  drawDistance: DEFAULT_DRAW_DISTANCE,
  maxItemsInRecyclePool: 120
};

export const TOPIC_LIST_PERFORMANCE_PROPS = {
  drawDistance: DEFAULT_DRAW_DISTANCE,
  maxItemsInRecyclePool: 80
};

export const REPLY_LIST_PERFORMANCE_PROPS = {
  drawDistance: Platform.OS === 'android' ? 800 : 600,
  maxItemsInRecyclePool: 80
};

export const TOPIC_DETAIL_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 6,
  maxToRenderPerBatch: 5,
  removeClippedSubviews: true,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};
