package expo.modules.forumcontentselection

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import expo.modules.core.ModuleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.lang.ref.WeakReference
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

@RunWith(AndroidJUnit4::class)
class ForumSelectionRecyclerViewProofTest {
  @Test
  fun productionSurfaceKeepsSelectionHighlightAndClipboardBridgeThroughRealRecyclerViewRecycle() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: RecyclerSelectionFixture
      scenario.onActivity { activity -> fixture = RecyclerSelectionFixture(activity) }
      idle()

      lateinit var geometryBefore: Map<Int, TextGeometry>
      lateinit var pixelsBefore: PixelSample
      var initialLastVisible = 0
      var downTime = 0L
      scenario.onActivity {
        assertTrue(fixture.adapter.rowHeightPx * fixture.rows.size >= fixture.recycler.height * 3)
        geometryBefore = fixture.visibleGeometry()
        assertTrue(geometryBefore.containsKey(0))
        pixelsBefore = fixture.rowPixels(0)
        initialLastVisible = fixture.layoutManager.findLastVisibleItemPosition()
        assertTrue(initialLastVisible > 0)

        val target = fixture.pointInRow(position = 0, utf16Offset = 1)
        downTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      idle()

      scenario.onActivity {
        val selection = requireNotNull(fixture.surface.selectionSnapshotForTest())
        assertEquals("row-0", selection.start.rowKey)
        assertEquals(0, selection.start.utf16Offset)
        assertTrue(fixture.surface.interactionStateForTest().active)
        fixture.assertGeometryEquals(geometryBefore)
      }

      scenario.onActivity {
        val targetFirstVisible = minOf(fixture.rows.lastIndex - 1, (initialLastVisible + 1) * 2)
        var frames = 0
        while (fixture.layoutManager.findFirstVisibleItemPosition() < targetFirstVisible && frames < 240) {
          val payload = requireNotNull(
            fixture.surface.autoScrollFrameForTest(
              fixture.surface.width - 4f,
              fixture.surface.height - 2f
            )
          )
          assertEquals(setOf("delta"), payload.keys)
          val deltaPx = ((payload.getValue("delta") as Float) * fixture.density).roundToInt()
          fixture.recycler.scrollBy(0, deltaPx)
          frames += 1
        }
        assertTrue(frames < 240)
        assertTrue(fixture.layoutManager.findFirstVisibleItemPosition() >= targetFirstVisible)

        fixture.surface.autoScrollFrameForTest(
          fixture.surface.width - 4f,
          fixture.surface.height - 2f
        )
        fixture.surface.onPreDraw()
        assertNull(fixture.recycler.findViewHolderForAdapterPosition(0))
        assertTrue(fixture.adapter.recycledPositions.contains(0))
        assertNull(fixture.surface.overlayHandlesForTest().first)

        fixture.send(
          MotionEvent.ACTION_UP,
          fixture.surface.width - 4f,
          fixture.surface.height - 2f,
          downTime
        )
        val selection = requireNotNull(fixture.surface.selectionSnapshotForTest())
        val endRow = fixture.rowIndex(selection.end.rowKey)
        assertTrue(endRow >= targetFirstVisible)
        val copied = requireNotNull(fixture.surface.copySelectionToClipboardForTest())
        assertTrue(copied.startsWith("row-00 content\nrow-01 content\n"))
        val clipboard = fixture.activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals(copied, clipboard.primaryClip?.getItemAt(0)?.text?.toString())

        fixture.layoutManager.scrollToPositionWithOffset(0, 0)
      }
      idle()

      scenario.onActivity {
        fixture.surface.onPreDraw()
        assertNotNull(fixture.recycler.findViewHolderForAdapterPosition(0))
        assertTrue(fixture.adapter.bindCounts.getValue(0) >= 2)
        assertNotNull(fixture.surface.overlayHandlesForTest().first)
        fixture.assertGeometryEquals(geometryBefore)
        val pixelsWithRestoredHighlight = fixture.rowPixels(0)
        assertTrue(pixelsBefore.diffCount(pixelsWithRestoredHighlight) > 0)

        fixture.surface.cancelSelection()
      }
      idle()

      scenario.onActivity {
        assertFalse(fixture.surface.interactionStateForTest().active)
        assertEquals(null to null, fixture.surface.overlayHandlesForTest())
        fixture.assertGeometryEquals(geometryBefore)
        assertArrayEquals(pixelsBefore.pixels, fixture.rowPixels(0).pixels)
        fixture.close()
      }
    }
  }

  private fun idle() = InstrumentationRegistry.getInstrumentation().waitForIdleSync()

  private class RecyclerSelectionFixture(val activity: Activity) {
    val density = activity.resources.displayMetrics.density
    val rows = List(16) { index -> "row-${index.toString().padStart(2, '0')} content" }
    private val reactContext = RecyclerProofReactContext(activity.applicationContext)
    private val appContext = AppContext(
      object : ModulesProvider {
        override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
      },
      ModuleRegistry(emptyList(), emptyList()),
      WeakReference(reactContext)
    )
    val surface = ForumContentSelectionView(reactContext, appContext)
    val layoutManager = LinearLayoutManager(reactContext).apply { isItemPrefetchEnabled = false }
    val adapter = RowAdapter(
      reactContext,
      rows,
      max((96f * density).roundToInt(), activity.resources.displayMetrics.heightPixels / 4)
    )
    val recycler = RecyclerView(reactContext).apply {
      layoutManager = this@RecyclerSelectionFixture.layoutManager
      adapter = this@RecyclerSelectionFixture.adapter
      itemAnimator = null
      overScrollMode = View.OVER_SCROLL_NEVER
      isVerticalScrollBarEnabled = false
      setItemViewCacheSize(0)
      recycledViewPool.setMaxRecycledViews(0, 1)
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        0,
        1f
      )
    }

    init {
      surface.addReactChild(recycler, 0)
      surface.pendingRevision = "recycler-proof-v1"
      surface.pendingRows = rows.indices.map { index ->
        ForumSelectionRowRecord(
          documentId = "floor",
          rowKey = "row-$index",
          nativeId = nativeId(index),
          selectionToken = textToken(rows[index], if (index == rows.lastIndex) "" else "\n")
        )
      }
      surface.commitProps()
      activity.setContentView(
        surface,
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      )
    }

    fun pointInRow(position: Int, utf16Offset: Int): Pair<Float, Float> {
      val text = textAt(position)
      val layout = requireNotNull(text.layout)
      val textLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      text.getLocationOnScreen(textLocation)
      surface.getLocationOnScreen(surfaceLocation)
      val offset = utf16Offset.coerceIn(0, layout.text.length)
      val line = layout.getLineForOffset(offset)
      return (
        textLocation[0] - surfaceLocation[0] + text.totalPaddingLeft + layout.getPrimaryHorizontal(offset)
        ) to (
        textLocation[1] - surfaceLocation[1] + text.totalPaddingTop + layout.getLineBottom(line) / 2f
        )
    }

    fun visibleGeometry(): Map<Int, TextGeometry> {
      val first = layoutManager.findFirstVisibleItemPosition()
      val last = layoutManager.findLastVisibleItemPosition()
      if (first == RecyclerView.NO_POSITION || last == RecyclerView.NO_POSITION) return emptyMap()
      return (first..last).associateWith(::geometryAt)
    }

    fun assertGeometryEquals(expected: Map<Int, TextGeometry>) {
      expected.forEach { (position, geometry) -> assertEquals(geometry, geometryAt(position)) }
    }

    fun rowPixels(position: Int): PixelSample {
      val text = textAt(position)
      val layout = requireNotNull(text.layout)
      val textLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      text.getLocationOnScreen(textLocation)
      surface.getLocationOnScreen(surfaceLocation)
      val left = (
        textLocation[0] - surfaceLocation[0] + text.totalPaddingLeft + floor(layout.getLineLeft(0)).toInt()
        ).coerceIn(0, surface.width - 1)
      val top = (
        textLocation[1] - surfaceLocation[1] + text.totalPaddingTop + layout.getLineTop(0)
        ).coerceIn(0, surface.height - 1)
      val right = (
        textLocation[0] - surfaceLocation[0] + text.totalPaddingLeft + ceil(layout.getLineRight(0).toDouble()).toInt()
        ).coerceIn(left + 1, surface.width)
      val bottom = (
        textLocation[1] - surfaceLocation[1] + text.totalPaddingTop + layout.getLineBottom(0)
        ).coerceIn(top + 1, surface.height)
      val bitmap = Bitmap.createBitmap(right - left, bottom - top, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      canvas.translate(-left.toFloat(), -top.toFloat())
      surface.draw(canvas)
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      bitmap.recycle()
      return PixelSample(bitmapWidth = right - left, bitmapHeight = bottom - top, pixels = pixels)
    }

    fun rowIndex(rowKey: String): Int = rowKey.removePrefix("row-").toInt()

    fun send(action: Int, x: Float, y: Float, downTime: Long) {
      val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
      try {
        surface.dispatchTouchEvent(event)
      } finally {
        event.recycle()
      }
    }

    fun close() {
      surface.destroy()
      reactContext.destroy()
      activity.finish()
    }

    private fun textAt(position: Int): TextView {
      val holder = requireNotNull(recycler.findViewHolderForAdapterPosition(position)) as RowHolder
      return holder.text
    }

    private fun geometryAt(position: Int): TextGeometry {
      val text = textAt(position)
      val layout = requireNotNull(text.layout)
      val viewBounds = Rect()
      assertTrue(text.getGlobalVisibleRect(viewBounds))
      val location = IntArray(2)
      text.getLocationOnScreen(location)
      val lineBounds = Rect()
      layout.getLineBounds(0, lineBounds)
      lineBounds.offset(location[0] + text.totalPaddingLeft, location[1] + text.totalPaddingTop)
      return TextGeometry(
        viewBounds = viewBounds,
        textBounds = lineBounds,
        baselineY = location[1] + text.baseline
      )
    }
  }

  private class RowAdapter(
    private val context: Context,
    private val rows: List<String>,
    val rowHeightPx: Int
  ) : RecyclerView.Adapter<RowHolder>() {
    val recycledPositions = mutableSetOf<Int>()
    val bindCounts = mutableMapOf<Int, Int>().withDefault { 0 }

    init {
      setHasStableIds(true)
    }

    override fun getItemCount(): Int = rows.size

    override fun getItemId(position: Int): Long = position.toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowHolder {
      val text = TextView(context).apply {
        setTextIsSelectable(true)
        setTextColor(Color.BLACK)
        setBackgroundColor(Color.WHITE)
        includeFontPadding = false
        setPadding((16f * resources.displayMetrics.density).roundToInt(), 12, 16, 12)
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }
      val root = FrameLayout(context).apply {
        layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, rowHeightPx)
        addView(text)
      }
      return RowHolder(root, text)
    }

    override fun onBindViewHolder(holder: RowHolder, position: Int) {
      holder.boundPosition = position
      holder.itemView.setTag(R.id.view_tag_native_id, nativeId(position))
      holder.text.text = rows[position]
      bindCounts[position] = bindCounts.getValue(position) + 1
    }

    override fun onViewRecycled(holder: RowHolder) {
      recycledPositions += holder.boundPosition
      super.onViewRecycled(holder)
    }
  }

  private class RowHolder(root: FrameLayout, val text: TextView) : RecyclerView.ViewHolder(root) {
    var boundPosition = RecyclerView.NO_POSITION
  }

  private data class TextGeometry(
    val viewBounds: Rect,
    val textBounds: Rect,
    val baselineY: Int
  )

  private data class PixelSample(
    val bitmapWidth: Int,
    val bitmapHeight: Int,
    val pixels: IntArray
  ) {
    fun diffCount(other: PixelSample): Int {
      assertEquals(bitmapWidth, other.bitmapWidth)
      assertEquals(bitmapHeight, other.bitmapHeight)
      return pixels.indices.count { pixels[it] != other.pixels[it] }
    }
  }

  private class RecyclerProofReactContext(context: Context) : ReactApplicationContext(context) {
    override fun <T : JavaScriptModule> getJSModule(jsInterface: Class<T>): T? = null

    override fun <T : NativeModule> hasNativeModule(nativeModuleInterface: Class<T>): Boolean = false

    override fun getNativeModules(): Collection<NativeModule> = emptyList()

    override fun <T : NativeModule> getNativeModule(nativeModuleInterface: Class<T>): T? = null

    override fun getNativeModule(moduleName: String): NativeModule? = null

    @Suppress("DEPRECATION")
    override fun getCatalystInstance(): com.facebook.react.bridge.CatalystInstance? = null

    @Deprecated("Required by ReactContext; use hasActiveReactInstance in production code.")
    override fun hasActiveCatalystInstance(): Boolean = false

    override fun hasActiveReactInstance(): Boolean = false

    @Deprecated("Required by ReactContext; use hasReactInstance in production code.")
    override fun hasCatalystInstance(): Boolean = false

    override fun hasReactInstance(): Boolean = false

    override fun destroy() = Unit

    override fun handleException(exception: Exception) {
      throw exception
    }

    @Deprecated("Required by the ReactContext compatibility contract.")
    override fun isBridgeless(): Boolean = false

    override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = null

    override fun getJSCallInvokerHolder(): CallInvokerHolder? = null

    @Deprecated("Required by the ReactContext compatibility contract.")
    override fun getFabricUIManager(): UIManager? = null

    override fun getSourceURL(): String? = null

    override fun registerSegment(segmentId: Int, path: String?, callback: Callback?) = Unit
  }

  private companion object {
    fun nativeId(position: Int): String = "recycler-native-$position"

    fun textToken(text: String, trailing: String): String {
      val trailingSegments = JSONArray()
      if (trailing.isNotEmpty()) {
        trailingSegments.put(JSONObject().put("kind", "separator").put("text", trailing))
      }
      return JSONObject()
        .put("version", 1)
        .put("prefix", JSONArray())
        .put(
          "owners",
          JSONArray().put(
            JSONObject()
              .put("text", text)
              .put("tape", JSONArray())
              .put("trailing", trailingSegments)
          )
        )
        .toString()
    }
  }
}
