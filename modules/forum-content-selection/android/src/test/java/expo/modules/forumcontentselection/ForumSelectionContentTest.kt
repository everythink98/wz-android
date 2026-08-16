package expo.modules.forumcontentselection

import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntRect
import org.junit.Assert.assertEquals
import org.junit.Test

class ForumSelectionContentTest {
  @Test
  fun regTopic103MeasuresDocumentAtItsRealWidthWithoutReusingTheStaleHostHeight() {
    val constraints = forumContentMeasurementConstraints(
      Constraints(minWidth = 975, maxWidth = 975, minHeight = 7939, maxHeight = 7939)
    )

    assertEquals(Constraints(minWidth = 975, maxWidth = 975, minHeight = 0, maxHeight = Constraints.Infinity), constraints)
  }

  @Test
  fun regTopic103MediaSlotUsesTheChildsCurrentSizeIncludingCollapseAtTheOrigin() {
    assertEquals(
      IntRect(0, 0, 975, 381),
      forumMediaSlotBounds(975, 381, fallbackWidth = 975, fallbackHeight = 731, hasMeasuredSize = true)
    )
    assertEquals(
      IntRect(0, 0, 975, 731),
      forumMediaSlotBounds(0, 0, fallbackWidth = 975, fallbackHeight = 731, hasMeasuredSize = false)
    )
    assertEquals(
      IntRect(0, 0, 1, 1),
      forumMediaSlotBounds(0, 0, fallbackWidth = 975, fallbackHeight = 731, hasMeasuredSize = true)
    )
  }

  @Test
  fun regTopic097TableClaimsOnlySingleFingerHorizontalIntentPastFourDp() {
    assertEquals(
      ForumTableGestureDecision.PENDING,
      forumTableGestureDecision(3f, 1f, pointerCount = 1, hasOverflow = true, directionLock = 4f)
    )
    assertEquals(
      ForumTableGestureDecision.CLAIM_HORIZONTAL,
      forumTableGestureDecision(5f, 2f, pointerCount = 1, hasOverflow = true, directionLock = 4f)
    )
    assertEquals(
      ForumTableGestureDecision.YIELD,
      forumTableGestureDecision(2f, 5f, pointerCount = 1, hasOverflow = true, directionLock = 4f)
    )
    assertEquals(
      ForumTableGestureDecision.YIELD,
      forumTableGestureDecision(5f, 5f, pointerCount = 1, hasOverflow = true, directionLock = 4f)
    )
    assertEquals(
      ForumTableGestureDecision.YIELD,
      forumTableGestureDecision(5f, 1f, pointerCount = 2, hasOverflow = true, directionLock = 4f)
    )
    assertEquals(
      ForumTableGestureDecision.YIELD,
      forumTableGestureDecision(5f, 1f, pointerCount = 1, hasOverflow = false, directionLock = 4f)
    )
  }

  @Test
  fun preservesRowMajorLayoutAndSpans() {
    val rows = listOf(
      ForumSelectionRow(
        listOf(
          ForumSelectionCell(emptyList(), 1, true, 2, ForumSelectionStyle(), "A"),
          ForumSelectionCell(emptyList(), 2, true, 1, ForumSelectionStyle(), "B")
        )
      ),
      ForumSelectionRow(listOf(ForumSelectionCell(emptyList(), 1, false, 1, ForumSelectionStyle(), "C")))
    )

    val placements = listOf(
        ForumTableCellPlacement(0, 1, 0, 0, 2),
        ForumTableCellPlacement(1, 2, 1, 0, 1),
        ForumTableCellPlacement(2, 1, 1, 1, 1)
      )
    assertEquals(placements, forumTableCellPlacements(rows, 3))
    val rowHeights = forumTableRowHeights(2, placements, listOf(70, 40, 30))
    assertEquals(listOf(40, 30), rowHeights.toList())
    assertEquals(70, forumTableCellHeight(placements[0], rowHeights))
    assertEquals(40, forumTableCellHeight(placements[1], rowHeights))
    assertEquals(30, forumTableCellHeight(placements[2], rowHeights))
  }

  @Test
  fun parsesTypedLayoutWithInlineMedia() {
    val document = parseForumSelectionDocument(
      """{"nodes":[{"type":"block","tag":"p","layout":"column","style":{"marginBottom":10},"children":[{"type":"text","style":{"fontSize":16},"parts":[{"type":"run","text":"before","style":{"fontWeight":"700"}},{"type":"media","slot":4,"width":20,"height":20},{"type":"run","text":"after","style":{}}]}]}]}""",
      "fallback"
    )

    val block = document.nodes.single() as ForumSelectionBlock
    assertEquals(10f, block.style.marginBottom)
    val parts = (block.children.single() as ForumSelectionText).parts
    assertEquals(
      listOf(
        ForumSelectionRun(null, ForumSelectionStyle(fontWeight = "700"), "before"),
        ForumSelectionInlineMedia(20f, 4, 20f),
        ForumSelectionRun(null, ForumSelectionStyle(), "after")
      ),
      parts
    )
  }
}
