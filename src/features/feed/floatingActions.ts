const feedFloatingActionsOffset = 420;
const feedLoadMoreThresholdRatio = 0.6;

interface FeedScrollMetrics {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
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

export function shouldShowFeedFloatingActions(scrollY: number) {
  return scrollY > feedFloatingActionsOffset;
}

export function shouldAllowFeedAutoLoadRequest({
  pausedAfterFailure,
  lastOffset,
  offsetY,
  minStep = 80
}: {
  pausedAfterFailure: boolean;
  lastOffset: number | null;
  offsetY: number;
  minStep?: number;
}) {
  if (pausedAfterFailure) {
    return false;
  }
  return lastOffset === null || offsetY > lastOffset + minStep;
}
