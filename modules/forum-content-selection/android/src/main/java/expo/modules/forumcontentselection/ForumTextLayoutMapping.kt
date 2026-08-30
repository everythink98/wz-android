package expo.modules.forumcontentselection

import android.text.Spanned
import android.text.style.ReplacementSpan
import android.widget.TextView

internal sealed interface ForumTextLayoutMapping {
  data class Ready(val offsets: ForumTextOffsetMap) : ForumTextLayoutMapping
  data object StaleLayout : ForumTextLayoutMapping
  data object NotOwner : ForumTextLayoutMapping
  data object AmbiguousReplacementRanges : ForumTextLayoutMapping
}

internal fun forumTextLayoutMapping(view: TextView, expectedLogicalText: String): ForumTextLayoutMapping {
  val layout = view.layout ?: return ForumTextLayoutMapping.StaleLayout
  val layoutText = layout.text
  if (layoutText.toString() != view.text.toString()) {
    return ForumTextLayoutMapping.StaleLayout
  }
  val replacementRanges = if (layoutText is Spanned) {
    layoutText.getSpans(0, layoutText.length, ReplacementSpan::class.java)
      .mapNotNull { span ->
        val start = layoutText.getSpanStart(span)
        val end = layoutText.getSpanEnd(span)
        if (start >= 0 && end > start) ForumRemovedTextRange(start, end) else null
      }
  } else {
    emptyList()
  }
  val removedRanges = when (
    val match = matchForumReplacementRanges(layoutText.toString(), replacementRanges, expectedLogicalText)
  ) {
    is ForumReplacementRangeMatch.Unique -> match.removedRanges
    ForumReplacementRangeMatch.NoMatch -> return ForumTextLayoutMapping.NotOwner
    ForumReplacementRangeMatch.Ambiguous -> return ForumTextLayoutMapping.AmbiguousReplacementRanges
  }
  val offsets = ForumTextOffsetMap.create(layoutText.toString(), removedRanges)
    ?: return ForumTextLayoutMapping.AmbiguousReplacementRanges
  return ForumTextLayoutMapping.Ready(offsets)
}
