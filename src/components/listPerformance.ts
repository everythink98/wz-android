import { Platform } from 'react-native';

const ANDROID_REMOVE_CLIPPED_SUBVIEWS = Platform.OS === 'android';

export const FEED_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 8,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};

export const TOPIC_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 8,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};

export const REPLY_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 6,
  maxToRenderPerBatch: 5,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};

export const TOPIC_DETAIL_LIST_PERFORMANCE_PROPS = {
  ...REPLY_LIST_PERFORMANCE_PROPS,
  removeClippedSubviews: false
};
