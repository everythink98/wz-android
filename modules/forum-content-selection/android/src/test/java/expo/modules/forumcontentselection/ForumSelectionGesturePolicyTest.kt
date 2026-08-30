package expo.modules.forumcontentselection

import org.junit.Assert.assertEquals
import org.junit.Test

class ForumSelectionGesturePolicyTest {
  @Test
  fun `long press tolerance never exceeds locked four dp table pan threshold`() {
    assertEquals(12f, forumLongPressMotionTolerancePx(scaledTouchSlopPx = 30f, density = 3f), 0f)
    assertEquals(6f, forumLongPressMotionTolerancePx(scaledTouchSlopPx = 6f, density = 3f), 0f)
  }
}
