export const feedFloatingActionsOffset = 420;
export const feedLoadMoreThresholdRatio = 0.6;

interface FeedScrollMetrics {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
}

export function shouldShowFeedFloatingActions(scrollY: number) {
  return scrollY > feedFloatingActionsOffset;
}

export function shouldLoadMoreFeedFromScroll(metrics: FeedScrollMetrics, thresholdRatio = feedLoadMoreThresholdRatio) {
  const viewportHeight = metrics.layoutMeasurement.height;
  const contentHeight = metrics.contentSize.height;
  const offsetY = Math.max(0, metrics.contentOffset.y);

  if (!Number.isFinite(viewportHeight) || !Number.isFinite(contentHeight) || !Number.isFinite(offsetY)) {
    return false;
  }
  if (viewportHeight <= 0 || contentHeight <= viewportHeight) {
    return false;
  }

  const remainingDistance = contentHeight - (offsetY + viewportHeight);
  return remainingDistance <= viewportHeight * thresholdRatio;
}
