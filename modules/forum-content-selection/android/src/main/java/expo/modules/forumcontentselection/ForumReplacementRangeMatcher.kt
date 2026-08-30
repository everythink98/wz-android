package expo.modules.forumcontentselection

internal sealed interface ForumReplacementRangeMatch {
  data class Unique(val removedRanges: List<ForumRemovedTextRange>) : ForumReplacementRangeMatch
  data object NoMatch : ForumReplacementRangeMatch
  data object Ambiguous : ForumReplacementRangeMatch
}

private const val MAX_REPLACEMENT_RANGES = 512
private const val MAX_REPLACEMENT_STATES = 4_096

internal fun matchForumReplacementRanges(
  layoutText: String,
  replacementRanges: List<ForumRemovedTextRange>,
  expectedLogicalText: String
): ForumReplacementRangeMatch {
  val ranges = replacementRanges.distinct().sortedBy { it.start }
  if (ranges.size > MAX_REPLACEMENT_RANGES) return ForumReplacementRangeMatch.NoMatch
  var previousEnd = 0
  ranges.forEach { range ->
    if (range.start < previousEnd || range.start < 0 || range.end <= range.start || range.end > layoutText.length) {
      return ForumReplacementRangeMatch.NoMatch
    }
    previousEnd = range.end
  }

  var states = mapOf(0 to ReplacementMatchCandidate(1, emptyList()))
  var layoutCursor = 0
  ranges.forEach { range ->
    states = consumeRequiredText(
      states,
      layoutText.substring(layoutCursor, range.start),
      expectedLogicalText
    )
    if (states.isEmpty()) return ForumReplacementRangeMatch.NoMatch

    val spanText = layoutText.substring(range.start, range.end)
    val next = mutableMapOf<Int, ReplacementMatchCandidate>()
    states.forEach { (expectedOffset, candidate) ->
      if (expectedLogicalText.regionMatches(expectedOffset, spanText, 0, spanText.length)) {
        next.mergeCandidate(expectedOffset + spanText.length, candidate)
      }
      next.mergeCandidate(
        expectedOffset,
        candidate.copy(removedRanges = candidate.removedRanges + range)
      )
    }
    states = next
    if (states.size > MAX_REPLACEMENT_STATES) return ForumReplacementRangeMatch.NoMatch
    layoutCursor = range.end
  }

  states = consumeRequiredText(states, layoutText.substring(layoutCursor), expectedLogicalText)
  val result = states[expectedLogicalText.length] ?: return ForumReplacementRangeMatch.NoMatch
  return if (result.pathCount == 1) {
    ForumReplacementRangeMatch.Unique(result.removedRanges)
  } else {
    ForumReplacementRangeMatch.Ambiguous
  }
}

private data class ReplacementMatchCandidate(
  val pathCount: Int,
  val removedRanges: List<ForumRemovedTextRange>
)

private fun consumeRequiredText(
  states: Map<Int, ReplacementMatchCandidate>,
  required: String,
  expected: String
): Map<Int, ReplacementMatchCandidate> = buildMap {
  states.forEach { (expectedOffset, candidate) ->
    if (expected.regionMatches(expectedOffset, required, 0, required.length)) {
      mergeCandidate(expectedOffset + required.length, candidate)
    }
  }
}

private fun MutableMap<Int, ReplacementMatchCandidate>.mergeCandidate(
  expectedOffset: Int,
  candidate: ReplacementMatchCandidate
) {
  val existing = this[expectedOffset]
  this[expectedOffset] = if (existing == null) {
    candidate
  } else {
    ReplacementMatchCandidate(
      pathCount = minOf(2, existing.pathCount + candidate.pathCount),
      removedRanges = existing.removedRanges
    )
  }
}
