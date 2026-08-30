package expo.modules.forumcontentselection

internal data class ForumRemovedTextRange(
  val start: Int,
  val end: Int
)

/**
 * Maps the UTF-16 text owned by Android Layout to the compiler's logical text.
 * Removed ranges are read from public ReplacementSpan metadata; this class never mutates the Spanned text.
 */
internal class ForumTextOffsetMap private constructor(
  val logicalText: String,
  private val layoutToLogicalOffsets: IntArray,
  private val logicalToLayoutBeforeOffsets: IntArray,
  private val logicalToLayoutAfterOffsets: IntArray,
  val removedRanges: List<ForumRemovedTextRange>
) {
  fun layoutToLogical(offset: Int): Int = layoutToLogicalOffsets[offset.coerceIn(0, layoutToLogicalOffsets.lastIndex)]

  fun logicalToLayoutBefore(offset: Int): Int =
    logicalToLayoutBeforeOffsets[offset.coerceIn(0, logicalToLayoutBeforeOffsets.lastIndex)]

  fun logicalToLayoutAfter(offset: Int): Int =
    logicalToLayoutAfterOffsets[offset.coerceIn(0, logicalToLayoutAfterOffsets.lastIndex)]

  fun layoutOffset(offset: Int, affinity: ForumSelectionAffinity): Int = when (affinity) {
    ForumSelectionAffinity.Upstream -> logicalToLayoutBefore(offset)
    ForumSelectionAffinity.Downstream -> logicalToLayoutAfter(offset)
  }

  fun removedRangeAt(layoutOffset: Int): ForumRemovedTextRange? = removedRanges.firstOrNull {
    layoutOffset >= it.start && layoutOffset <= it.end
  }

  companion object {
    fun create(layoutText: String, removedRanges: List<ForumRemovedTextRange>): ForumTextOffsetMap? {
      val sorted = removedRanges.sortedBy { it.start }
      var previousEnd = 0
      sorted.forEach { range ->
        if (range.start < previousEnd || range.start < 0 || range.end <= range.start || range.end > layoutText.length) {
          return null
        }
        previousEnd = range.end
      }

      val removed = BooleanArray(layoutText.length)
      sorted.forEach { range ->
        for (index in range.start until range.end) removed[index] = true
      }
      val logicalText = buildString(layoutText.length) {
        layoutText.forEachIndexed { index, character -> if (!removed[index]) append(character) }
      }
      val layoutToLogical = IntArray(layoutText.length + 1)
      var logicalOffset = 0
      for (layoutOffset in 0..layoutText.length) {
        layoutToLogical[layoutOffset] = logicalOffset
        if (layoutOffset < layoutText.length && !removed[layoutOffset]) logicalOffset += 1
      }

      val before = IntArray(logicalText.length + 1) { Int.MAX_VALUE }
      val after = IntArray(logicalText.length + 1) { Int.MIN_VALUE }
      layoutToLogical.forEachIndexed { layoutOffset, mappedLogicalOffset ->
        before[mappedLogicalOffset] = minOf(before[mappedLogicalOffset], layoutOffset)
        after[mappedLogicalOffset] = maxOf(after[mappedLogicalOffset], layoutOffset)
      }
      if (before.any { it == Int.MAX_VALUE } || after.any { it == Int.MIN_VALUE }) return null
      return ForumTextOffsetMap(logicalText, layoutToLogical, before, after, sorted)
    }
  }
}
