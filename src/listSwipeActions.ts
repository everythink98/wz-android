export const LIST_SWIPE_ACTION_WIDTH = 82;
const OPEN_DISTANCE = 54;
const OPEN_VELOCITY = 0.28;
const CAPTURE_DISTANCE = 24;
const VERTICAL_SLOP_RATIO = 2.4;

export function shouldOpenListSwipeAction(dx: number, vx: number) {
  return dx <= -OPEN_DISTANCE || (dx <= -32 && vx <= -OPEN_VELOCITY);
}

export function shouldCaptureListSwipe(dx: number, dy: number) {
  if (dx >= 0) {
    return false;
  }
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  return absDx >= CAPTURE_DISTANCE && absDx > absDy * VERTICAL_SLOP_RATIO;
}

export function clampListSwipeTranslate(dx: number) {
  return Math.max(-LIST_SWIPE_ACTION_WIDTH, Math.min(0, dx));
}
