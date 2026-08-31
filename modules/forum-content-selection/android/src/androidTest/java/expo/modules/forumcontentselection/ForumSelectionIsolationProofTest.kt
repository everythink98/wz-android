package expo.modules.forumcontentselection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ReplacementSpan
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.roundToInt

@RunWith(AndroidJUnit4::class)
class ForumSelectionIsolationProofTest {
  @Test
  fun logicalSelectionRestoresAcrossReorderedMountedOwnersWithoutChangingInlineLayout() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    val first = selectableRow(context, "native-first", TextView(context).apply {
      text = "alpha"
      setTextIsSelectable(true)
    })
    val replacement = FixedReplacementSpan(width = 24)
    val tableText = TextView(context).apply {
      text = SpannableString("table0cell").also {
        it.setSpan(replacement, 5, 6, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      setTextIsSelectable(true)
      minWidth = 900
      layoutParams = FrameLayout.LayoutParams(900, ViewGroup.LayoutParams.WRAP_CONTENT)
    }
    val tableScroller = HorizontalScrollView(context).apply {
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
      addView(tableText)
    }
    val second = selectableRow(context, "native-table", tableScroller)
    val third = selectableRow(context, "native-last", TextView(context).apply {
      text = "omega"
      setTextIsSelectable(true)
    })
    root.addView(first)
    root.addView(second)
    root.addView(third)
    measureAndLayout(root, widthPx = 320)
    tableScroller.scrollTo(64, 0)
    assertEquals(64, tableScroller.scrollX)

    val document = ForumSelectionDocument()
    assertSame(
      ForumSelectionUpdate.Applied,
      document.replace(
        "revision-1",
        listOf(
          row("doc", "first", "native-first", token("alpha", trailing = "\n")),
          row("doc", "table", "native-table", token("tablecell", tapeAt = 5, tapeText = "[emoji]", trailing = "\n")),
          row("doc", "last", "native-last", token("omega"))
        )
      )
    )
    val start = requireNotNull(document.anchor("doc", "first", 0, 1, ForumSelectionAffinity.Downstream))
    val end = requireNotNull(document.anchor("doc", "last", 0, 4, ForumSelectionAffinity.Upstream))
    assertTrue(document.select(start, end))
    val expectedCopy = "lpha\ntable[emoji]cell\nomeg"
    assertEquals(expectedCopy, document.copySelection())

    val originalLayout = requireNotNull(tableText.layout)
    val originalBaseline = originalLayout.getLineBaseline(0)
    val originalInlineBounds = originalLayout.getPrimaryHorizontal(5) to originalLayout.getPrimaryHorizontal(6)
    val firstGeometry = selectionGeometry(root, document)
    assertEquals(listOf("first", "table", "last"), firstGeometry.map { it.rowKey })
    assertTrue(firstGeometry.all { !it.bounds.isEmpty })
    assertTrue(firstGeometry.single { it.rowKey == "table" }.hostOriginX < 0f)

    root.removeView(first)
    root.removeView(third)
    measureAndLayout(root, widthPx = 320)
    assertEquals(listOf("table"), selectionGeometry(root, document).map { it.rowKey })
    assertEquals(expectedCopy, document.copySelection())

    root.removeAllViews()
    root.addView(third)
    root.addView(second)
    root.addView(first)
    measureAndLayout(root, widthPx = 320)
    tableScroller.scrollTo(64, 0)
    assertEquals(setOf("first", "table", "last"), selectionGeometry(root, document).map { it.rowKey }.toSet())
    assertEquals(ForumSelectionRange(start, end), document.selection())
    assertEquals(expectedCopy, document.copySelection())
    assertEquals(originalBaseline, tableText.layout.getLineBaseline(0))
    assertEquals(originalInlineBounds.first, tableText.layout.getPrimaryHorizontal(5), 0f)
    assertEquals(originalInlineBounds.second, tableText.layout.getPrimaryHorizontal(6), 0f)

    assertTrue(document.select(end, start))
    assertEquals(expectedCopy, document.copySelection())
    assertEquals(setOf("first", "table", "last"), selectionGeometry(root, document).map { it.rowKey }.toSet())
  }

  @Test
  fun edgeAutoScrollReportsFlashListCompatibleDpDeltaForThreeScreenViewport() = onMainThread {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val density = context.resources.displayMetrics.density
    val viewportHeightPx = (200f * density).roundToInt().coerceAtLeast(1)
    val threeScreenContent = View(context).apply { minimumHeight = viewportHeightPx * 3 }
    assertEquals(viewportHeightPx * 3, threeScreenContent.minimumHeight)

    val event = requireNotNull(
      forumAutoScrollPayload(
        pointerYpx = viewportHeightPx.toFloat(),
        viewportHeightPx = viewportHeightPx,
        density = density
      )
    )
    val eventMap = event.asEventMap()
    assertEquals(28f, eventMap.getValue("delta") as Float, 0.01f)
    assertEquals(setOf("delta"), eventMap.keys)

    val topEvent = requireNotNull(
      forumAutoScrollPayload(
        pointerYpx = 0f,
        viewportHeightPx = viewportHeightPx,
        density = density
      )
    )
    assertEquals(-28f, topEvent.deltaDp, 0.01f)
    assertNull(
      forumAutoScrollPayload(
        pointerYpx = viewportHeightPx / 2f,
        viewportHeightPx = viewportHeightPx,
        density = density
      )
    )
  }

  @Test
  fun localHighlightUpdateInvalidatesItsTextOwner() = onMainThread {
    val highlight = ForumSelectionHighlightDrawable(0x440000FF)
    var invalidationCount = 0
    highlight.callback = object : Drawable.Callback {
      override fun invalidateDrawable(who: Drawable) {
        invalidationCount += 1
      }

      override fun scheduleDrawable(who: Drawable, what: Runnable, `when`: Long) = Unit

      override fun unscheduleDrawable(who: Drawable, what: Runnable) = Unit
    }

    highlight.update(Path(), 10, 10)
    assertEquals(1, invalidationCount)
    highlight.update(Path(), 10, 10)
    assertEquals(2, invalidationCount)
  }

  private fun selectionGeometry(
    root: ViewGroup,
    document: ForumSelectionDocument
  ): List<SelectionGeometry> {
    val output = mutableListOf<SelectionGeometry>()
    val ordinals = mutableMapOf<String, Int>()

    fun visit(view: View, inheritedRow: ForumSelectionRowDefinition?) {
      val nativeId = view.getTag(R.id.view_tag_native_id) as? String
      val row = nativeId?.let(document::rowForNativeId) ?: inheritedRow
      if (view is TextView && row != null && view.isTextSelectable) {
        val ordinal = ordinals.getOrDefault(row.rowKey, 0)
        ordinals[row.rowKey] = ordinal + 1
        val spanned = view.text as? Spanned
        val removed = spanned?.getSpans(0, spanned.length, ReplacementSpan::class.java)
          ?.map { ForumRemovedTextRange(spanned.getSpanStart(it), spanned.getSpanEnd(it)) }
          .orEmpty()
        val mapping = requireNotNull(ForumTextOffsetMap.create(view.text.toString(), removed))
        val selected = document.selectedOffsets(row.documentId, row.rowKey, ordinal)
        if (selected != null) {
          val layout = requireNotNull(view.layout)
          val path = Path()
          layout.getSelectionPath(
            mapping.logicalToLayoutBefore(selected.first),
            mapping.logicalToLayoutAfter(selected.last + 1),
            path
          )
          val origin = descendantContentOrigin(root, view)
          path.offset(origin.first, origin.second)
          val bounds = RectF()
          path.computeBounds(bounds, true)
          output += SelectionGeometry(row.rowKey, bounds, origin.first)
        }
      }
      if (view is ViewGroup) {
        for (index in 0 until view.childCount) visit(view.getChildAt(index), row)
      }
    }

    visit(root, null)
    return output
  }

  private fun onMainThread(block: () -> Unit) {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(Runnable(block))
  }

  private fun descendantContentOrigin(root: ViewGroup, textView: TextView): Pair<Float, Float> {
    var x = textView.totalPaddingLeft - textView.scrollX.toFloat()
    var y = textView.totalPaddingTop - textView.scrollY.toFloat()
    var current: View = textView
    while (current !== root) {
      val parent = current.parent as View
      x += current.left - parent.scrollX
      y += current.top - parent.scrollY
      current = parent
    }
    return x to y
  }

  private fun selectableRow(context: Context, nativeId: String, child: View): FrameLayout =
    FrameLayout(context).apply {
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
      setTag(R.id.view_tag_native_id, nativeId)
      addView(child)
    }

  private fun measureAndLayout(root: View, widthPx: Int) {
    root.measure(
      View.MeasureSpec.makeMeasureSpec(widthPx, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    )
    root.layout(0, 0, widthPx, root.measuredHeight)
  }

  private fun row(
    documentId: String,
    rowKey: String,
    nativeId: String,
    selectionToken: String
  ) = ForumSelectionRowDefinition(documentId, rowKey, nativeId, selectionToken)

  private fun token(
    text: String,
    tapeAt: Int? = null,
    tapeText: String = "",
    trailing: String = ""
  ): String {
    val tape = JSONArray()
    if (tapeAt != null) tape.put(JSONObject().put("at", tapeAt).put("text", tapeText))
    val trailingSegments = JSONArray()
    if (trailing.isNotEmpty()) {
      trailingSegments.put(JSONObject().put("kind", "separator").put("text", trailing))
    }
    val owner = JSONObject()
      .put("text", text)
      .put("tape", tape)
      .put("trailing", trailingSegments)
    return JSONObject()
      .put("version", 1)
      .put("prefix", JSONArray())
      .put("owners", JSONArray().put(owner))
      .toString()
  }

  private data class SelectionGeometry(
    val rowKey: String,
    val bounds: RectF,
    val hostOriginX: Float
  )

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
