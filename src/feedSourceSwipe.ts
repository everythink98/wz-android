const SOURCE_SWIPE_DISTANCE = 72;
const SOURCE_SWIPE_CAPTURE_DISTANCE = 52;
const SOURCE_SWIPE_VELOCITY = 0.45;
const SOURCE_SWIPE_VERTICAL_RATIO = 1.8;

export function shouldCaptureFeedSourceSwipe(dx: number, dy: number) {
  return Math.abs(dx) >= SOURCE_SWIPE_CAPTURE_DISTANCE
    && Math.abs(dx) > Math.abs(dy) * SOURCE_SWIPE_VERTICAL_RATIO;
}

export function feedSourceSwipeDirection(dx: number, dy: number, vx: number): 1 | -1 | 0 {
  if (!shouldCaptureFeedSourceSwipe(dx, dy)) {
    return 0;
  }
  if (Math.abs(dx) < SOURCE_SWIPE_DISTANCE && Math.abs(vx) < SOURCE_SWIPE_VELOCITY) {
    return 0;
  }
  return dx < 0 ? 1 : -1;
}
