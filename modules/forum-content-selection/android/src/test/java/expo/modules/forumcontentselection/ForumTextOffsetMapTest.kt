package expo.modules.forumcontentselection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForumTextOffsetMapTest {
  @Test
  fun `removes inline replacement characters without changing surrounding UTF-16 offsets`() {
    val layoutText = "A0\uD83D\uDE00B"
    val mapping = requireNotNull(
      ForumTextOffsetMap.create(layoutText, listOf(ForumRemovedTextRange(start = 1, end = 2)))
    )

    assertEquals("A\uD83D\uDE00B", mapping.logicalText)
    assertEquals(1, mapping.layoutToLogical(1))
    assertEquals(1, mapping.layoutToLogical(2))
    assertEquals(1, mapping.logicalToLayoutBefore(1))
    assertEquals(2, mapping.logicalToLayoutAfter(1))
    assertEquals(1, mapping.layoutOffset(1, ForumSelectionAffinity.Upstream))
    assertEquals(2, mapping.layoutOffset(1, ForumSelectionAffinity.Downstream))
    assertEquals(layoutText.length, mapping.logicalToLayoutAfter(mapping.logicalText.length))
  }

  @Test
  fun `maps consecutive inline replacements to one stable logical tape position`() {
    val mapping = requireNotNull(
      ForumTextOffsetMap.create("x00y", listOf(ForumRemovedTextRange(1, 2), ForumRemovedTextRange(2, 3)))
    )

    assertEquals("xy", mapping.logicalText)
    assertEquals(1, mapping.layoutToLogical(1))
    assertEquals(1, mapping.layoutToLogical(2))
    assertEquals(1, mapping.layoutToLogical(3))
    assertEquals(1, mapping.logicalToLayoutBefore(1))
    assertEquals(3, mapping.logicalToLayoutAfter(1))
  }

  @Test
  fun `rejects overlapping or out-of-bounds replacement ranges`() {
    assertNull(ForumTextOffsetMap.create("abc", listOf(ForumRemovedTextRange(1, 3), ForumRemovedTextRange(2, 3))))
    assertNull(ForumTextOffsetMap.create("abc", listOf(ForumRemovedTextRange(2, 4))))
  }
}
