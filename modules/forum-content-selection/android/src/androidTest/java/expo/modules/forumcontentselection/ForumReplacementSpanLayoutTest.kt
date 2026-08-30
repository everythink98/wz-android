package expo.modules.forumcontentselection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ReplacementSpan
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.views.text.ReactTextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ForumReplacementSpanLayoutTest {
  @Test
  fun readingPublicReplacementSpanRangesPreservesInlineBoundsAndBaseline() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val replacement = FixedReplacementSpan(width = 24)
    val text = SpannableString("A0B").apply {
      setSpan(replacement, 1, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val textView = TextView(context).apply {
      includeFontPadding = false
      setText(text, TextView.BufferType.SPANNABLE)
      measure(
        View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      )
      layout(0, 0, measuredWidth, measuredHeight)
    }
    val layout = requireNotNull(textView.layout)
    val baselineBefore = layout.getLineBaseline(0)
    val placeholderLeftBefore = layout.getPrimaryHorizontal(1)
    val placeholderRightBefore = layout.getPrimaryHorizontal(2)

    val mountedText = textView.text as Spanned
    val spans = mountedText.getSpans(0, mountedText.length, ReplacementSpan::class.java)
    val mapping = (forumTextLayoutMapping(textView, "AB") as ForumTextLayoutMapping.Ready).offsets

    assertEquals("AB", mapping.logicalText)
    assertSame(replacement, spans.single())
    assertSame(layout, textView.layout)
    assertEquals(baselineBefore, textView.layout.getLineBaseline(0))
    assertEquals(placeholderLeftBefore, textView.layout.getPrimaryHorizontal(1), 0f)
    assertEquals(placeholderRightBefore, textView.layout.getPrimaryHorizontal(2), 0f)
  }

  @Test
  fun reactTextViewKeepsUnicodeEmojiSpanAndRemovesOnlyInlineMediaSpan() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val emojiSpan = FixedReplacementSpan(width = 20)
    val inlineMediaSpan = FixedReplacementSpan(width = 24)
    val text = SpannableString("A\uD83D\uDE000B").apply {
      setSpan(emojiSpan, 1, 3, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(inlineMediaSpan, 3, 4, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val textView = FixtureReactTextView(context).apply {
      includeFontPadding = false
      setText(text, TextView.BufferType.SPANNABLE)
      measure(
        View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      )
      layout(0, 0, measuredWidth, measuredHeight)
    }
    val layout = requireNotNull(textView.layout)
    val baselineBefore = layout.getLineBaseline(0)
    val emojiBoundsBefore = layout.getPrimaryHorizontal(1) to layout.getPrimaryHorizontal(3)
    val mediaBoundsBefore = layout.getPrimaryHorizontal(3) to layout.getPrimaryHorizontal(4)

    val mapping = forumTextLayoutMapping(textView, "A\uD83D\uDE00B")
    require(mapping is ForumTextLayoutMapping.Ready)

    assertEquals("A\uD83D\uDE00B", mapping.offsets.logicalText)
    assertEquals(listOf(ForumRemovedTextRange(3, 4)), mapping.offsets.removedRanges)
    assertSame(layout, textView.layout)
    assertEquals(baselineBefore, textView.layout.getLineBaseline(0))
    assertEquals(emojiBoundsBefore.first, textView.layout.getPrimaryHorizontal(1), 0f)
    assertEquals(emojiBoundsBefore.second, textView.layout.getPrimaryHorizontal(3), 0f)
    assertEquals(mediaBoundsBefore.first, textView.layout.getPrimaryHorizontal(3), 0f)
    assertEquals(mediaBoundsBefore.second, textView.layout.getPrimaryHorizontal(4), 0f)
  }

  @Test
  fun matchingDisplayedReactLayoutRemainsReadableWhenRequestFlagIsSticky() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val textView = FixtureReactTextView(context).apply {
      layoutParams = ViewGroup.LayoutParams(320, ViewGroup.LayoutParams.WRAP_CONTENT)
      text = "old"
      measure(
        View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      )
      layout(0, 0, measuredWidth, measuredHeight)
      requestLayout()
    }
    val displayedLayout = requireNotNull(textView.layout)

    assertEquals(true, textView.isLayoutRequested)
    assertSame(displayedLayout, textView.layout)
    require(forumTextLayoutMapping(textView, "old") is ForumTextLayoutMapping.Ready)
  }

  @Test
  fun textViewWithoutDisplayedLayoutFailsClosed() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val textView = TextView(context).apply {
      text = "new"
    }

    assertNull(textView.layout)
    assertSame(ForumTextLayoutMapping.StaleLayout, forumTextLayoutMapping(textView, "new"))
  }

  private fun onMainThread(block: () -> Unit) {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(Runnable(block))
  }

  private class FixtureReactTextView(context: Context) : ReactTextView(context) {
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit
  }

  private class FixedReplacementSpan(
    private val width: Int
  ) : ReplacementSpan() {
    override fun getSize(
      paint: Paint,
      text: CharSequence,
      start: Int,
      end: Int,
      fontMetrics: Paint.FontMetricsInt?
    ): Int = width

    override fun draw(
      canvas: Canvas,
      text: CharSequence,
      start: Int,
      end: Int,
      x: Float,
      top: Int,
      y: Int,
      bottom: Int,
      paint: Paint
    ) = Unit
  }
}
