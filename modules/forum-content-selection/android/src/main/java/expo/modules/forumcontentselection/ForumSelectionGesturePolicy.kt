package expo.modules.forumcontentselection

import kotlin.math.min

internal fun forumLongPressMotionTolerancePx(
  scaledTouchSlopPx: Float,
  density: Float
): Float = min(scaledTouchSlopPx, 4f * density)
