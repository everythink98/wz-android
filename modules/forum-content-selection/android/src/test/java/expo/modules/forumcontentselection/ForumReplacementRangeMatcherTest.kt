package expo.modules.forumcontentselection

import org.junit.Assert.assertEquals
import org.junit.Test

class ForumReplacementRangeMatcherTest {
  @Test
  fun `keeps Unicode emoji ReplacementSpan while removing inline media placeholder`() {
    val emoji = "\uD83D\uDE00"
    assertEquals(
      ForumReplacementRangeMatch.Unique(listOf(ForumRemovedTextRange(3, 4))),
      matchForumReplacementRanges(
        layoutText = "A${emoji}0B",
        replacementRanges = listOf(ForumRemovedTextRange(1, 3), ForumRemovedTextRange(3, 4)),
        expectedLogicalText = "A${emoji}B"
      )
    )
  }

  @Test
  fun `fails closed when more than one ReplacementSpan subset matches compiler text`() {
    assertEquals(
      ForumReplacementRangeMatch.Ambiguous,
      matchForumReplacementRanges(
        layoutText = "00",
        replacementRanges = listOf(ForumRemovedTextRange(0, 1), ForumRemovedTextRange(1, 2)),
        expectedLogicalText = "0"
      )
    )
  }

  @Test
  fun `fails closed when no atomic ReplacementSpan subset matches compiler text`() {
    assertEquals(
      ForumReplacementRangeMatch.NoMatch,
      matchForumReplacementRanges(
        layoutText = "A0B",
        replacementRanges = listOf(ForumRemovedTextRange(1, 2)),
        expectedLogicalText = "AX"
      )
    )
  }
}
