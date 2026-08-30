package expo.modules.forumcontentselection

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.os.SystemClock
import android.text.Selection
import android.text.SpannableString
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.style.ReplacementSpan
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.CatalystInstance
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import com.facebook.soloader.SoLoader
import expo.modules.core.ModuleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

class ForumSelectionTestActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SoLoader.init(this, OpenSourceMergedSoMapping)
    super.onCreate(savedInstanceState)
  }
}

private fun resolveTestColor(context: Context, attribute: Int, fallback: Int): Int {
  val value = TypedValue()
  if (!context.theme.resolveAttribute(attribute, value, true)) return fallback
  if (value.type in TypedValue.TYPE_FIRST_COLOR_INT..TypedValue.TYPE_LAST_COLOR_INT) return value.data
  return value.resourceId.takeIf { it != 0 }
    ?.let { runCatching { context.getColor(it) }.getOrDefault(fallback) }
    ?: fallback
}

@RunWith(AndroidJUnit4::class)
class ForumContentSelectionViewTest {
  @Test
  fun nonSelectableOpeningTextDoesNotStartSelectionOnDoubleTap() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var target: Pair<Float, Float>
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.first.text.setTextIsSelectable(false)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        target = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.tap(target)
      }
      Thread.sleep(80L)
      scenario.onActivity { fixture.tap(target) }
      Thread.sleep(120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        assertEquals(
          Selection.getSelectionStart(fixture.first.text.text),
          Selection.getSelectionEnd(fixture.first.text.text)
        )
        assertFalse(fixture.first.text.hasSelection())
        assertFalse(fixture.surface.interactionStateForTest().active)
        fixture.close()
      }
    }
  }

  @Test
  fun localHandlesFollowTheirTextOwnerWithoutDrawingIntoTheRouteSurface() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var target: Pair<Float, Float>
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        target = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.gestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, target.first, target.second, fixture.gestureDownTime)
        val before = requireNotNull(fixture.surface.overlayHandlesForTest().first)
        val beforePixels = requireNotNull(fixture.localHandleColorBounds())
        val geometryBefore = fixture.geometry(fixture.first.text, 0, 1)
        assertEquals(0, fixture.routeOnlyHandleColorPixelCount())
        fixture.translateMountedWindow(40f)
        val translatedPixels = requireNotNull(fixture.localHandleColorBounds())
        assertTrue(abs(beforePixels.top + 40 - translatedPixels.top) <= 1)
        assertTrue(abs(beforePixels.bottom + 40 - translatedPixels.bottom) <= 1)
        val geometryAfter = fixture.geometry(fixture.first.text, 0, 1)
        assertEquals(geometryBefore.width, geometryAfter.width)
        assertEquals(geometryBefore.height, geometryAfter.height)
        assertEquals(geometryBefore.baseline, geometryAfter.baseline)
        assertEquals(geometryBefore.spanStartX, geometryAfter.spanStartX, 0f)
        assertEquals(geometryBefore.spanEndX, geometryAfter.spanEndX, 0f)

        fixture.surface.onScrollChanged()
        fixture.surface.onPreDraw()
        val after = requireNotNull(fixture.surface.overlayHandlesForTest().first)
        assertEquals(before.x, after.x, 0.5f)
        assertEquals(before.y + 40f, after.y, 0.5f)

        fixture.translateMountedWindow(-fixture.surface.height * 2f)
        fixture.surface.onPreDraw()
        assertEquals(null to null, fixture.surface.overlayHandlesForTest())
        assertTrue(fixture.localHandleColorPixelCount(fixture.first.text) > 0)
        fixture.translateMountedWindow(0f)
        assertTrue(fixture.localHandleColorBounds() != null)
        fixture.surface.onPreDraw()

        fixture.mountOnly(fixture.second)
        fixture.surface.onPreDraw()
        assertEquals(0, fixture.localHandleColorPixelCount(fixture.first.text))
        fixture.mountOnly(fixture.first)
        fixture.surface.onPreDraw()
        assertTrue(fixture.localHandleColorPixelCount(fixture.first.text) > 0)
        fixture.surface.cancelSelection()
        assertEquals(0, fixture.localHandleColorPixelCount(fixture.first.text))
        fixture.close()
      }
    }
  }

  @Test
  fun localHandlePixelsAreCompositedAtTheTextEndpoints() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: DrawTimeScrollFixture
      lateinit var target: Pair<Float, Float>
      var downTime = 0L
      scenario.onActivity { activity -> fixture = DrawTimeScrollFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        target = fixture.selectionTarget()
        downTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      lateinit var probes: Pair<HandlePixelProbe, HandlePixelProbe>
      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
        fixture.surface.onPreDraw()
        probes = fixture.handlePixelProbes()
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      val screenshot = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
      try {
        assertTrue(probes.first.failureDescription(), probes.first.matches(screenshot))
        assertTrue(probes.second.failureDescription(), probes.second.matches(screenshot))
      } finally {
        screenshot.recycle()
      }
      scenario.onActivity { fixture.close() }
    }
  }

  @Test
  fun activeSelectionCancelsOnStationaryTapButSurvivesScrollGesture() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var selectionTarget: Pair<Float, Float>
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.first.text.setTextIsSelectable(false)
        fixture.reply.text.setTextIsSelectable(false)
        fixture.mountTogether(fixture.first, fixture.reply)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        selectionTarget = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.gestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, selectionTarget.first, selectionTarget.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.send(
          MotionEvent.ACTION_UP,
          selectionTarget.first,
          selectionTarget.second,
          fixture.gestureDownTime
        )
        val selected = requireNotNull(fixture.surface.selectionSnapshotForTest())
        val interactionTarget = fixture.pointInText(fixture.reply.text, utf16Offset = 2)
        val x = interactionTarget.first
        val y = interactionTarget.second
        val scrollDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, x, y, scrollDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, x, y + 10f * fixture.activity.resources.displayMetrics.density, scrollDownTime)
        fixture.send(MotionEvent.ACTION_UP, x, y + 10f * fixture.activity.resources.displayMetrics.density, scrollDownTime)
        assertEquals(selected, fixture.surface.selectionSnapshotForTest())
        assertTrue(fixture.surface.interactionStateForTest().active)

        fixture.tap(x to y)
        assertNull(fixture.surface.selectionSnapshotForTest())
        assertFalse(fixture.surface.interactionStateForTest().active)
        fixture.close()
      }
    }
  }

  @Test
  fun ordinaryLinkClickRunsOnceBeforeActiveSelectionCancels() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var selectionTarget: Pair<Float, Float>
      var linkClickCount = 0
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.installSecondLink { linkClickCount += 1 }
        fixture.mountTogether(fixture.first, fixture.second)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.tap(fixture.pointInText(fixture.second.text, utf16Offset = 2))
        assertEquals(1, linkClickCount)
        linkClickCount = 0
        selectionTarget = fixture.pointInText(fixture.first.text, utf16Offset = 1)
        fixture.gestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, selectionTarget.first, selectionTarget.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.send(
          MotionEvent.ACTION_UP,
          selectionTarget.first,
          selectionTarget.second,
          fixture.gestureDownTime
        )
        assertTrue(fixture.surface.interactionStateForTest().active)

        fixture.tap(fixture.pointInText(fixture.second.text, utf16Offset = 2))
        assertEquals(1, linkClickCount)
        assertNull(fixture.surface.selectionSnapshotForTest())
        assertFalse(fixture.surface.interactionStateForTest().active)
        fixture.close()
      }
    }
  }

  @Test
  fun markedOpeningRowOwnsLongPressWithoutNativeSelectableTextWhileUnmarkedReplyDoesNot() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var openingTarget: Pair<Float, Float>
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.first.text.setTextIsSelectable(false)
        fixture.first.root.addView(
          TextView(activity).apply {
            text = "decorative"
            setTextIsSelectable(false)
          },
          0
        )
        fixture.mountTogether(fixture.first, fixture.reply)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        val replyTarget = fixture.pointInText(fixture.reply.text, utf16Offset = 2)
        val replyDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, replyTarget.first, replyTarget.second, replyDownTime)
        assertFalse(fixture.surface.hasSelectionGestureForTest())
        fixture.send(MotionEvent.ACTION_CANCEL, replyTarget.first, replyTarget.second, replyDownTime)

        openingTarget = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.gestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, openingTarget.first, openingTarget.second, fixture.gestureDownTime)
        assertTrue("marked opening row should arm the coordinator", fixture.surface.hasSelectionGestureForTest())
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        assertTrue("stationary long press should activate custom selection", fixture.surface.interactionStateForTest().active)
        assertTrue(fixture.surface.interactionStateForTest().hasActionMode)
        assertEquals("two", fixture.surface.copySelectionToClipboardForTest())
        fixture.send(MotionEvent.ACTION_UP, openingTarget.first, openingTarget.second, fixture.gestureDownTime)
        fixture.close()
      }
    }
  }

  @Test
  fun recycleAndAutoScrollPreserveLogicalRangeAndFixedCopy() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      scenario.onActivity { activity -> fixture = SurfaceFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        val target = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        val selected = requireNotNull(fixture.surface.selectionSnapshotForTest())
        assertEquals("first", selected.start.rowKey)
        assertEquals(4, selected.start.utf16Offset)
        assertEquals(7, selected.end.utf16Offset)
        assertTrue(fixture.surface.interactionStateForTest().active)
        assertTrue(fixture.surface.interactionStateForTest().hasActionMode)
      }

      scenario.onActivity { fixture.mountOnly(fixture.media) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        val event = fixture.surface.autoScrollFrameForTest(
          fixture.surface.width - 2f,
          fixture.surface.height - 1f
        )
        assertEquals(setOf("delta"), requireNotNull(event).keys)
        assertEquals("first", fixture.surface.selectionSnapshotForTest()?.end?.rowKey)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity { fixture.mountOnly(fixture.second) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        val event = fixture.surface.autoScrollFrameForTest(
          fixture.surface.width - 2f,
          fixture.surface.height - 1f
        )
        assertTrue((requireNotNull(event)["delta"] as Float) > 0f)
        assertEquals("second", fixture.surface.selectionSnapshotForTest()?.end?.rowKey)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity { fixture.mountOnly(fixture.last) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        fixture.surface.autoScrollFrameForTest(
          fixture.surface.width - 2f,
          fixture.surface.height - 1f
        )
        assertEquals("last", fixture.surface.selectionSnapshotForTest()?.end?.rowKey)
        fixture.send(
          MotionEvent.ACTION_UP,
          fixture.surface.width - 2f,
          fixture.surface.height - 1f,
          fixture.gestureDownTime
        )
        assertEquals("two\n[sticker]\nbeta\ngamma", fixture.surface.copySelectionToClipboardForTest())
        val clipboard = fixture.activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals("two\n[sticker]\nbeta\ngamma", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
      }

      scenario.onActivity { fixture.close() }
    }
  }

  @Test
  fun handleCrossingKeepsAnchorIdentityAndRevisionChangeCancels() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var target: Pair<Float, Float>
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.mountTogether(fixture.first, fixture.last)
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        target = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.gestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, target.first, target.second, fixture.gestureDownTime)
        fixture.surface.onPreDraw()
        val initialEnd = requireNotNull(fixture.surface.overlayHandlesForTest().second)
        val lastEnd = fixture.pointInText(fixture.last.text, utf16Offset = fixture.last.text.text.length)
        val extendDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, initialEnd.x, initialEnd.y, extendDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, lastEnd.first, lastEnd.second, extendDownTime)
        fixture.send(MotionEvent.ACTION_UP, lastEnd.first, lastEnd.second, extendDownTime)

        fixture.surface.onPreDraw()
        val visibleEnd = requireNotNull(fixture.surface.overlayHandlesForTest().second)
        val beforeStart = fixture.pointInText(fixture.first.text, utf16Offset = 0)
        val crossingDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, visibleEnd.x, visibleEnd.y, crossingDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, beforeStart.first, beforeStart.second, crossingDownTime)
        fixture.send(MotionEvent.ACTION_UP, beforeStart.first, beforeStart.second, crossingDownTime)

        val reversed = requireNotNull(fixture.surface.selectionSnapshotForTest())
        assertEquals("first", reversed.start.rowKey)
        assertEquals(4, reversed.start.utf16Offset)
        assertEquals("first", reversed.end.rowKey)
        assertEquals(0, reversed.end.utf16Offset)

        fixture.surface.onPreDraw()
        val visibleStart = requireNotNull(fixture.surface.overlayHandlesForTest().first)
        val regrabDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, visibleStart.x, visibleStart.y, regrabDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, lastEnd.first, lastEnd.second, regrabDownTime)
        fixture.send(MotionEvent.ACTION_UP, lastEnd.first, lastEnd.second, regrabDownTime)

        val restored = requireNotNull(fixture.surface.selectionSnapshotForTest())
        assertEquals("first", restored.start.rowKey)
        assertEquals(4, restored.start.utf16Offset)
        assertEquals("last", restored.end.rowKey)
        assertEquals(fixture.last.text.text.length, restored.end.utf16Offset)

        fixture.surface.pendingRevision = "revision-2"
        fixture.surface.commitProps()
        assertNull(fixture.surface.selectionSnapshotForTest())
        assertEquals(ForumSelectionInteractionState(false, false, false), fixture.surface.interactionStateForTest())
        assertEquals(null to null, fixture.surface.overlayHandlesForTest())
        fixture.close()
      }
    }
  }

  @Test
  fun replacementSpanBoundaryAffinityPreservesGeometry() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var geometryBeforeSelection: TextGeometry
      lateinit var inlineTarget: Pair<Float, Float>
      var inlineGestureDownTime = 0L
      scenario.onActivity { activity ->
        fixture = SurfaceFixture(activity)
        fixture.mountOnly(fixture.inline)
        fixture.surface.pendingRevision = "revision-inline"
        fixture.surface.commitProps()
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      scenario.onActivity {
        geometryBeforeSelection = fixture.geometry(fixture.inline.text, 1, 2)
        inlineTarget = fixture.pointInLayout(fixture.inline.text, 2, 4f)
        inlineGestureDownTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, inlineTarget.first, inlineTarget.second, inlineGestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, inlineTarget.first, inlineTarget.second, inlineGestureDownTime)
        fixture.surface.onPreDraw()
        val fullHandles = fixture.surface.overlayHandlesForTest()
        val beforeMedia = fixture.pointInLayout(fixture.inline.text, 1)
        val afterMedia = fixture.pointInLayout(fixture.inline.text, 2)

        val startDownTime = SystemClock.uptimeMillis()
        val fullStart = requireNotNull(fullHandles.first)
        fixture.send(MotionEvent.ACTION_DOWN, fullStart.x, fullStart.y, startDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, beforeMedia.first, beforeMedia.second, startDownTime)
        fixture.send(MotionEvent.ACTION_UP, beforeMedia.first, beforeMedia.second, startDownTime)

        fixture.surface.onPreDraw()
        val endDownTime = SystemClock.uptimeMillis()
        val fullEnd = requireNotNull(fixture.surface.overlayHandlesForTest().second)
        fixture.send(MotionEvent.ACTION_DOWN, fullEnd.x, fullEnd.y, endDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, afterMedia.first, afterMedia.second, endDownTime)
        fixture.send(MotionEvent.ACTION_UP, afterMedia.first, afterMedia.second, endDownTime)

        val mediaOnly = requireNotNull(fixture.surface.selectionSnapshotForTest())
        assertEquals(1, mediaOnly.start.utf16Offset)
        assertEquals(ForumSelectionAffinity.Upstream, mediaOnly.start.affinity)
        assertEquals(1, mediaOnly.end.utf16Offset)
        assertEquals(ForumSelectionAffinity.Downstream, mediaOnly.end.affinity)
        assertEquals("[inline]", fixture.surface.copySelectionToClipboardForTest())
        assertEquals(geometryBeforeSelection, fixture.geometry(fixture.inline.text, 1, 2))

        fixture.surface.onPreDraw()
        val stationaryAfterMedia = requireNotNull(fixture.surface.overlayHandlesForTest().second)
        val afterText = fixture.pointInLayout(fixture.inline.text, 3)
        val crossDownTime = SystemClock.uptimeMillis()
        val movingBeforeMedia = requireNotNull(fixture.surface.overlayHandlesForTest().first)
        fixture.send(MotionEvent.ACTION_DOWN, movingBeforeMedia.x, movingBeforeMedia.y, crossDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, afterText.first, afterText.second, crossDownTime)
        fixture.send(MotionEvent.ACTION_UP, afterText.first, afterText.second, crossDownTime)
        fixture.surface.onPreDraw()
        val stationaryNowVisibleStart = requireNotNull(fixture.surface.overlayHandlesForTest().first)
        assertEquals(stationaryAfterMedia.x, stationaryNowVisibleStart.x, 0.5f)
        assertEquals(stationaryAfterMedia.y, stationaryNowVisibleStart.y, 0.5f)

        val restoreDownTime = SystemClock.uptimeMillis()
        val movingAfterText = requireNotNull(fixture.surface.overlayHandlesForTest().second)
        fixture.send(MotionEvent.ACTION_DOWN, movingAfterText.x, movingAfterText.y, restoreDownTime)
        fixture.send(MotionEvent.ACTION_MOVE, beforeMedia.first, beforeMedia.second, restoreDownTime)
        fixture.send(MotionEvent.ACTION_UP, beforeMedia.first, beforeMedia.second, restoreDownTime)
        assertEquals("[inline]", fixture.surface.copySelectionToClipboardForTest())
        assertEquals(geometryBeforeSelection, fixture.geometry(fixture.inline.text, 1, 2))

        fixture.surface.cancelSelection()
        assertEquals(geometryBeforeSelection, fixture.geometry(fixture.inline.text, 1, 2))
        fixture.close()
      }
    }
  }

  @Test
  fun stablePreDrawReusesOwnerAlignmentUntilTheTextLayoutChanges() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: SurfaceFixture
      lateinit var target: Pair<Float, Float>
      scenario.onActivity { activity -> fixture = SurfaceFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        target = fixture.pointInText(fixture.first.text, utf16Offset = 5)
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, fixture.gestureDownTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      var stableBuildCount = 0
      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, target.first, target.second, fixture.gestureDownTime)
        stableBuildCount = fixture.surface.alignmentBuildCountForTest()
        fixture.surface.commitProps()
        assertEquals(stableBuildCount, fixture.surface.alignmentBuildCountForTest())
        repeat(120) { fixture.surface.onPreDraw() }
        assertEquals(stableBuildCount, fixture.surface.alignmentBuildCountForTest())
        fixture.first.text.text = SpannableString("one two")
      }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.surface.onPreDraw()
        val reboundBuildCount = fixture.surface.alignmentBuildCountForTest()
        assertEquals(stableBuildCount + 1, reboundBuildCount)
        repeat(120) { fixture.surface.onPreDraw() }
        assertEquals(reboundBuildCount, fixture.surface.alignmentBuildCountForTest())
        fixture.close()
      }
    }
  }

  @Test
  fun selectedHighlightUsesCurrentScrollViewGeometryInTheSameDraw() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: DrawTimeScrollFixture
      scenario.onActivity { activity -> fixture = DrawTimeScrollFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      val results = mutableListOf<DrawTimePixelResult>()
      listOf("forward" to 1, "reverse" to -1).forEach { (direction, sign) ->
        lateinit var target: Pair<Float, Float>
        var downTime = 0L
        scenario.onActivity {
          fixture.reset()
          target = fixture.selectionTarget()
          downTime = SystemClock.uptimeMillis()
          fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
        }
        Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        scenario.onActivity {
          fixture.send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
          assertTrue(fixture.surface.interactionStateForTest().active)
          results += fixture.captureDrawTimeScroll(direction, sign * fixture.scrollStepPx)
        }
      }

      assertTrue(
        results.joinToString(separator = "\n") { it.failureDescription() },
        results.all(DrawTimePixelResult::passed)
      )
      scenario.onActivity { fixture.close() }
    }
  }

  @Test
  fun selectedHighlightFollowsTextInsideNestedHorizontalScrollViewInTheSameDraw() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: DrawTimeScrollFixture
      scenario.onActivity { activity -> fixture = DrawTimeScrollFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      val results = mutableListOf<HorizontalDrawTimePixelResult>()
      listOf("forward" to 1, "reverse" to -1).forEach { (direction, sign) ->
        lateinit var target: Pair<Float, Float>
        var downTime = 0L
        scenario.onActivity {
          fixture.resetForHorizontalSelection()
          target = fixture.horizontalSelectionTarget()
          downTime = SystemClock.uptimeMillis()
          fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
        }
        Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        scenario.onActivity {
          fixture.send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
          assertEquals("code", fixture.surface.selectionSnapshotForTest()?.start?.rowKey)
          results += fixture.captureHorizontalDrawTimeScroll(direction, sign * fixture.scrollStepPx)
        }
      }

      assertTrue(
        results.joinToString(separator = "\n") { it.failureDescription() },
        results.all(HorizontalDrawTimePixelResult::passed)
      )
      scenario.onActivity { fixture.close() }
    }
  }

  @Test
  fun recycledTextViewUsesItsReboundSelectedRangeOnFirstDraw() {
    ActivityScenario.launch(ForumSelectionTestActivity::class.java).use { scenario ->
      lateinit var fixture: DrawTimeScrollFixture
      lateinit var target: Pair<Float, Float>
      var downTime = 0L
      scenario.onActivity { activity -> fixture = DrawTimeScrollFixture(activity) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      scenario.onActivity {
        fixture.reset()
        target = fixture.selectionTarget()
        downTime = SystemClock.uptimeMillis()
        fixture.send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
      }
      Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong() + 120L)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()

      lateinit var result: ReboundTextViewPixelResult
      scenario.onActivity {
        fixture.send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
        fixture.extendSelectionToInlineEnd()
        result = fixture.rebindSelectedTextAsInlineOwnerAndCaptureFirstDraw()
      }

      assertTrue(result.failureDescription(), result.passed())
      scenario.onActivity { fixture.close() }
    }
  }

  private class DrawTimeScrollFixture(val activity: Activity) {
    private val density = activity.resources.displayMetrics.density
    private val reactContext = FixtureReactContext(activity.applicationContext)
    private val handleColor = resolveTestColor(reactContext, android.R.attr.colorAccent, 0xFF1668DC.toInt())
    private val appContext = AppContext(
      object : ModulesProvider {
        override fun getModulesList(): List<Class<out Module>> = emptyList()
      },
      ModuleRegistry(emptyList(), emptyList()),
      WeakReference(reactContext)
    )
    val surface = ForumContentSelectionView(reactContext, appContext).apply {
      setBackgroundColor(Color.WHITE)
    }
    val scrollStepPx = (56f * density).roundToInt()
    private val initialScrollY = (160f * density).roundToInt()
    private val horizontalInitialScrollX = (140f * density).roundToInt()
    private val plainTop = (300f * density).roundToInt()
    private val inlineTop = (700f * density).roundToInt()
    private val codeTop = (1_100f * density).roundToInt()
    private val content = FrameLayout(reactContext).apply {
      setBackgroundColor(Color.WHITE)
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        max(activity.resources.displayMetrics.heightPixels * 4, (1_500f * density).roundToInt())
      )
    }
    private val scrollView = DrawTimeScrollView(reactContext).apply {
      setBackgroundColor(Color.WHITE)
      isVerticalScrollBarEnabled = false
      overScrollMode = View.OVER_SCROLL_NEVER
      isFillViewport = false
      addView(content)
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }
    private val selectedText = textView(DRAW_PLAIN_TEXT)
    private val inlineText = textView(inlineSpannable()).apply {
      minWidth = activity.resources.displayMetrics.widthPixels * 2
    }
    private val codeText = textView(DRAW_CODE_TEXT).apply {
      minWidth = activity.resources.displayMetrics.widthPixels * 2
      typeface = android.graphics.Typeface.MONOSPACE
    }
    private val inlineScroller = horizontalScroller(inlineText)
    private val codeScroller = DrawTimeHorizontalScrollView(reactContext).apply {
      configureHorizontalScroller(codeText)
    }
    private lateinit var plainRoot: FrameLayout
    private lateinit var inlineRoot: FrameLayout

    init {
      plainRoot = addAbsoluteRow("draw-native-plain", plainTop, selectedText)
      inlineRoot = addAbsoluteRow(
        "draw-native-inline",
        inlineTop,
        inlineScroller
      )
      addAbsoluteRow(
        "draw-native-code",
        codeTop,
        codeScroller
      )
      surface.addReactChild(scrollView, 0)
      surface.pendingRevision = "draw-time-scroll-v1"
      surface.pendingRows = listOf(
        ForumSelectionRowRecord(
          "draw-doc",
          "plain",
          "draw-native-plain",
          textToken(DRAW_PLAIN_TEXT, "\n")
        ),
        ForumSelectionRowRecord("draw-doc", "inline", "draw-native-inline", inlineToken()),
        ForumSelectionRowRecord(
          "draw-doc",
          "code",
          "draw-native-code",
          textToken(DRAW_CODE_TEXT, "")
        )
      )
      surface.commitProps()
      activity.setContentView(
        surface,
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      )
    }

    fun reset() {
      surface.cancelSelection()
      scrollView.scrollTo(0, initialScrollY)
    }

    fun selectionTarget(): Pair<Float, Float> = pointInText(selectedText, utf16Offset = 4)

    fun resetForHorizontalSelection() {
      surface.cancelSelection()
      scrollView.scrollTo(0, codeTop - initialScrollY)
      codeScroller.scrollTo(horizontalInitialScrollX, 0)
    }

    fun horizontalSelectionTarget(): Pair<Float, Float> =
      pointInText(codeText, utf16Offset = DRAW_CODE_TEXT.indexOf("mark") + 2)

    fun send(action: Int, x: Float, y: Float, downTime: Long) {
      val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
      try {
        surface.dispatchTouchEvent(event)
      } finally {
        event.recycle()
      }
    }

    fun handlePixelProbes(): Pair<HandlePixelProbe, HandlePixelProbe> {
      val (start, end) = surface.overlayHandlesForTest()
      val surfaceLocation = IntArray(2).also(surface::getLocationOnScreen)
      fun probe(point: PointF): HandlePixelProbe = HandlePixelProbe(
        x = surfaceLocation[0] + point.x,
        y = surfaceLocation[1] + point.y,
        color = handleColor,
        radius = (18f * density).roundToInt()
      )
      return probe(requireNotNull(start)) to probe(requireNotNull(end))
    }

    fun captureDrawTimeScroll(direction: String, deltaY: Int): DrawTimePixelResult {
      val selection = requireNotNull(surface.selectionSnapshotForTest())
      surface.onPreDraw()
      val beforeBounds = selectedInteriorBounds(selection)
      val geometryBefore = layoutGeometry()
      val scrollBefore = scrollView.scrollY

      scrollView.scrollDuringNextDrawBy(deltaY)
      val selectedFrame = drawFrame()
      val scrollDelta = scrollView.scrollY - scrollBefore
      val currentBounds = selectedInteriorBounds(selection)
      val geometryAfter = layoutGeometry()
      check(!Rect.intersects(beforeBounds, currentBounds))

      surface.cancelSelection()
      val cleanFrame = drawFrame()
      val cleanBounds = selectedInteriorBounds(selection)
      val currentChangedPixels = differenceCount(selectedFrame, cleanFrame, currentBounds)
      val staleChangedPixels = differenceCount(selectedFrame, cleanFrame, beforeBounds)
      val currentSample = pixelPair(selectedFrame, cleanFrame, currentBounds)
      val staleSample = pixelPair(selectedFrame, cleanFrame, beforeBounds)
      val requiredCurrentPixels = max(1, currentBounds.width() * currentBounds.height() / 3)
      selectedFrame.recycle()
      cleanFrame.recycle()

      return DrawTimePixelResult(
        direction = direction,
        expectedScrollDelta = deltaY,
        actualScrollDelta = scrollDelta,
        expectedHighlightTop = beforeBounds.top - deltaY,
        actualHighlightTop = currentBounds.top,
        currentChangedPixels = currentChangedPixels,
        requiredCurrentPixels = requiredCurrentPixels,
        staleChangedPixels = staleChangedPixels,
        currentSample = currentSample,
        staleSample = staleSample,
        layoutUnchanged = geometryBefore == geometryAfter,
        cleanReferenceUnchanged = cleanBounds == currentBounds
      )
    }

    fun captureHorizontalDrawTimeScroll(direction: String, deltaX: Int): HorizontalDrawTimePixelResult {
      val selection = requireNotNull(surface.selectionSnapshotForTest())
      check(selection.start.rowKey == "code" && selection.end.rowKey == "code")
      surface.onPreDraw()
      val beforeBounds = selectedInteriorBounds(codeText, selection.start.utf16Offset, selection.end.utf16Offset)
      val geometryBefore = layoutGeometry()
      val scrollBefore = codeScroller.scrollX

      codeScroller.scrollDuringNextDrawBy(deltaX)
      val selectedFrame = drawFrame()
      val scrollDelta = codeScroller.scrollX - scrollBefore
      val currentBounds = selectedInteriorBounds(codeText, selection.start.utf16Offset, selection.end.utf16Offset)
      val geometryAfter = layoutGeometry()
      check(!Rect.intersects(beforeBounds, currentBounds))

      surface.cancelSelection()
      val cleanFrame = drawFrame()
      val currentChangedPixels = differenceCount(selectedFrame, cleanFrame, currentBounds)
      val staleChangedPixels = differenceCount(selectedFrame, cleanFrame, beforeBounds)
      val requiredCurrentPixels = max(1, currentBounds.width() * currentBounds.height() / 3)
      selectedFrame.recycle()
      cleanFrame.recycle()

      return HorizontalDrawTimePixelResult(
        direction = direction,
        expectedScrollDelta = deltaX,
        actualScrollDelta = scrollDelta,
        expectedHighlightLeft = beforeBounds.left - deltaX,
        actualHighlightLeft = currentBounds.left,
        currentChangedPixels = currentChangedPixels,
        requiredCurrentPixels = requiredCurrentPixels,
        staleChangedPixels = staleChangedPixels,
        layoutUnchanged = geometryBefore == geometryAfter
      )
    }

    fun extendSelectionToInlineEnd() {
      surface.onPreDraw()
      val endHandle = requireNotNull(surface.overlayHandlesForTest().second)
      val target = pointInText(inlineText, utf16Offset = inlineText.text.length)
      val downTime = SystemClock.uptimeMillis()
      send(MotionEvent.ACTION_DOWN, endHandle.x, endHandle.y, downTime)
      send(MotionEvent.ACTION_MOVE, target.first, target.second, downTime)
      send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
      val selection = requireNotNull(surface.selectionSnapshotForTest())
      check(selection.start.rowKey == "plain" && selection.end.rowKey == "inline")
    }

    fun rebindSelectedTextAsInlineOwnerAndCaptureFirstDraw(): ReboundTextViewPixelResult {
      val selection = requireNotNull(surface.selectionSnapshotForTest())
      surface.onPreDraw()
      val oldLocalBounds = selectionPathBounds(
        selectedText,
        selection.start.utf16Offset,
        selectedText.text.length,
        includePadding = true
      )

      content.removeView(inlineRoot)
      content.removeView(plainRoot)
      selectedText.text = inlineSpannable()
      selectedText.minWidth = activity.resources.displayMetrics.widthPixels * 2
      plainRoot.setTag(R.id.view_tag_native_id, "draw-native-inline")
      content.addView(
        plainRoot,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (150f * density).roundToInt()).apply {
          topMargin = inlineTop
        }
      )
      measureAndLayoutSurface()
      surface.onPreDraw()

      val reboundSelection = requireNotNull(surface.selectionSnapshotForTest())
      check(reboundSelection.end.rowKey == "inline")
      val mapping = forumTextLayoutMapping(selectedText, "AB") as ForumTextLayoutMapping.Ready
      val currentStart = mapping.offsets.layoutOffset(0, ForumSelectionAffinity.Downstream)
      val currentEnd = mapping.offsets.layoutOffset(reboundSelection.end.utf16Offset, reboundSelection.end.affinity)
      val currentRawBounds = localBoundsInSurface(
        selectedText,
        selectionPathBounds(selectedText, currentStart, currentEnd, includePadding = true)
      )
      val currentBounds = selectedInteriorBounds(selectedText, currentStart, currentEnd)
      val oldBoundsAtNewOwner = localBoundsInSurface(selectedText, oldLocalBounds)
      val staleMargin = max(2, (8f * density).roundToInt())
      val staleProbe = Rect(
        currentRawBounds.right + staleMargin,
        max(currentRawBounds.top, oldBoundsAtNewOwner.top),
        oldBoundsAtNewOwner.right - staleMargin,
        minOf(currentRawBounds.bottom, oldBoundsAtNewOwner.bottom)
      )
      check(staleProbe.width() > 0 && staleProbe.height() > 0)

      val selectedFrame = drawFrame()
      surface.cancelSelection()
      val cleanFrame = drawFrame()
      val currentChangedPixels = differenceCount(selectedFrame, cleanFrame, currentBounds)
      val staleChangedPixels = differenceCount(selectedFrame, cleanFrame, staleProbe)
      val requiredCurrentPixels = max(1, currentBounds.width() * currentBounds.height() / 3)
      selectedFrame.recycle()
      cleanFrame.recycle()

      return ReboundTextViewPixelResult(
        currentChangedPixels = currentChangedPixels,
        requiredCurrentPixels = requiredCurrentPixels,
        staleChangedPixels = staleChangedPixels,
        reboundText = selectedText.text.toString(),
        reboundRowKey = reboundSelection.end.rowKey
      )
    }

    fun close() {
      surface.destroy()
      reactContext.destroy()
      activity.finish()
    }

    private fun addAbsoluteRow(nativeId: String, top: Int, child: View): FrameLayout {
      val height = (150f * density).roundToInt()
      val root = FrameLayout(reactContext).apply {
        setTag(R.id.view_tag_native_id, nativeId)
        setBackgroundColor(Color.WHITE)
        addView(
          child,
          FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )
        )
      }
      content.addView(
        root,
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply {
          topMargin = top
        }
      )
      return root
    }

    private fun horizontalScroller(child: TextView): HorizontalScrollView =
      HorizontalScrollView(reactContext).apply {
        configureHorizontalScroller(child)
      }

    private fun HorizontalScrollView.configureHorizontalScroller(child: TextView) {
      setBackgroundColor(Color.WHITE)
      isHorizontalScrollBarEnabled = false
      overScrollMode = View.OVER_SCROLL_NEVER
      addView(
        child,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      )
    }

    private fun textView(value: CharSequence): TextView = TextView(reactContext).apply {
      text = value
      setTextIsSelectable(false)
      setTextColor(Color.BLACK)
      setBackgroundColor(Color.WHITE)
      includeFontPadding = false
      textSize = 18f
      setPadding((16f * density).roundToInt(), (12f * density).roundToInt(), 16, 12)
    }

    private fun inlineSpannable(): SpannableString = SpannableString("A0B").also {
      it.setSpan(
        FixedReplacementSpan((24f * density).roundToInt()),
        1,
        2,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
      )
    }

    private fun pointInText(textView: TextView, utf16Offset: Int): Pair<Float, Float> {
      val layout = requireNotNull(textView.layout)
      val viewLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      textView.getLocationOnScreen(viewLocation)
      surface.getLocationOnScreen(surfaceLocation)
      val offset = utf16Offset.coerceIn(0, layout.text.length)
      val line = layout.getLineForOffset(offset)
      return (
        viewLocation[0] - surfaceLocation[0] + textView.totalPaddingLeft + layout.getPrimaryHorizontal(offset)
        ) to (
        viewLocation[1] - surfaceLocation[1] + textView.totalPaddingTop + layout.getLineBottom(line) / 2f
        )
    }

    private fun selectedInteriorBounds(selection: ForumSelectionRange): Rect {
      check(selection.start.rowKey == "plain" && selection.end.rowKey == "plain")
      val start = minOf(selection.start.utf16Offset, selection.end.utf16Offset)
      val end = maxOf(selection.start.utf16Offset, selection.end.utf16Offset)
      return selectedInteriorBounds(selectedText, start, end)
    }

    private fun selectedInteriorBounds(textView: TextView, start: Int, end: Int): Rect {
      val bounds = localBoundsInSurface(
        textView,
        selectionPathBounds(textView, start, end, includePadding = true)
      )
      bounds.inset(max(2, bounds.width() / 4), max(1, bounds.height() / 4))
      check(bounds.width() > 0 && bounds.height() > 0)
      return bounds
    }

    private fun selectionPathBounds(
      textView: TextView,
      start: Int,
      end: Int,
      includePadding: Boolean
    ): RectF {
      val layout = requireNotNull(textView.layout)
      val path = Path()
      layout.getSelectionPath(start.coerceIn(0, layout.text.length), end.coerceIn(0, layout.text.length), path)
      val pathBounds = RectF()
      path.computeBounds(pathBounds, true)
      if (includePadding) {
        pathBounds.offset(textView.totalPaddingLeft.toFloat(), textView.totalPaddingTop.toFloat())
      }
      return pathBounds
    }

    private fun localBoundsInSurface(textView: TextView, localBounds: RectF): Rect {
      val viewLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      textView.getLocationOnScreen(viewLocation)
      surface.getLocationOnScreen(surfaceLocation)
      val originX = viewLocation[0] - surfaceLocation[0] - textView.scrollX
      val originY = viewLocation[1] - surfaceLocation[1] - textView.scrollY
      return Rect(
        floor(originX + localBounds.left).toInt(),
        floor(originY + localBounds.top).toInt(),
        ceil(originX + localBounds.right).toInt(),
        ceil(originY + localBounds.bottom).toInt()
      )
    }

    private fun startHandlePoint(textView: TextView, layoutOffset: Int): Pair<Float, Float> {
      val layout = requireNotNull(textView.layout)
      val offset = layoutOffset.coerceIn(0, layout.text.length)
      val line = layout.getLineForOffset(offset)
      val viewLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      textView.getLocationOnScreen(viewLocation)
      surface.getLocationOnScreen(surfaceLocation)
      return (
        viewLocation[0] - surfaceLocation[0] + textView.totalPaddingLeft - textView.scrollX +
          layout.getPrimaryHorizontal(offset)
        ) to (
        viewLocation[1] - surfaceLocation[1] + textView.totalPaddingTop - textView.scrollY +
          layout.getLineBottom(line)
        ).toFloat()
    }

    private fun measureAndLayoutSurface() {
      val width = surface.width
      val height = surface.height
      check(width > 0 && height > 0)
      surface.measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
      )
      surface.layout(surface.left, surface.top, surface.left + width, surface.top + height)
    }

    private fun layoutGeometry(): List<TextLayoutGeometry> = listOf(
      selectedText.geometryAt(0, 1),
      inlineText.geometryAt(1, 2),
      codeText.geometryAt(0, 1)
    )

    private fun TextView.geometryAt(spanStart: Int, spanEnd: Int): TextLayoutGeometry {
      val layout = requireNotNull(layout)
      return TextLayoutGeometry(
        width = width,
        height = height,
        baseline = baseline,
        lineCount = layout.lineCount,
        spanStartX = layout.getPrimaryHorizontal(spanStart),
        spanEndX = layout.getPrimaryHorizontal(spanEnd)
      )
    }

    private fun drawFrame(): Bitmap {
      check(surface.width > 0 && surface.height > 0)
      return Bitmap.createBitmap(surface.width, surface.height, Bitmap.Config.ARGB_8888).also {
        surface.draw(Canvas(it))
      }
    }

    private fun differenceCount(firstBitmap: Bitmap, secondBitmap: Bitmap, bounds: Rect): Int {
      assertEquals(firstBitmap.width, secondBitmap.width)
      assertEquals(firstBitmap.height, secondBitmap.height)
      val clipped = Rect(bounds).apply {
        intersect(0, 0, firstBitmap.width, firstBitmap.height)
      }
      if (clipped.isEmpty) return 0
      val rowWidth = clipped.width()
      val first = IntArray(rowWidth)
      val second = IntArray(rowWidth)
      var count = 0
      for (y in clipped.top until clipped.bottom) {
        firstBitmap.getPixels(first, 0, rowWidth, clipped.left, y, rowWidth, 1)
        secondBitmap.getPixels(second, 0, rowWidth, clipped.left, y, rowWidth, 1)
        count += first.indices.count { first[it] != second[it] }
      }
      return count
    }

    private fun pixelPair(firstBitmap: Bitmap, secondBitmap: Bitmap, bounds: Rect): Pair<Int, Int> =
      firstBitmap.getPixel(bounds.centerX(), bounds.centerY()) to
        secondBitmap.getPixel(bounds.centerX(), bounds.centerY())
  }

  private class DrawTimeScrollView(context: Context) : ScrollView(context) {
    private var pendingDrawScrollY: Int? = null

    fun scrollDuringNextDrawBy(deltaY: Int) {
      pendingDrawScrollY = scrollY + deltaY
    }

    override fun computeScroll() {
      super.computeScroll()
      pendingDrawScrollY?.let {
        pendingDrawScrollY = null
        scrollTo(scrollX, it)
      }
    }
  }

  private class DrawTimeHorizontalScrollView(context: Context) : HorizontalScrollView(context) {
    private var pendingDrawScrollX: Int? = null

    fun scrollDuringNextDrawBy(deltaX: Int) {
      pendingDrawScrollX = scrollX + deltaX
    }

    override fun computeScroll() {
      super.computeScroll()
      pendingDrawScrollX?.let {
        pendingDrawScrollX = null
        scrollTo(it, scrollY)
      }
    }
  }

  private data class TextLayoutGeometry(
    val width: Int,
    val height: Int,
    val baseline: Int,
    val lineCount: Int,
    val spanStartX: Float,
    val spanEndX: Float
  )

  private data class DrawTimePixelResult(
    val direction: String,
    val expectedScrollDelta: Int,
    val actualScrollDelta: Int,
    val expectedHighlightTop: Int,
    val actualHighlightTop: Int,
    val currentChangedPixels: Int,
    val requiredCurrentPixels: Int,
    val staleChangedPixels: Int,
    val currentSample: Pair<Int, Int>,
    val staleSample: Pair<Int, Int>,
    val layoutUnchanged: Boolean,
    val cleanReferenceUnchanged: Boolean
  ) {
    fun passed(): Boolean =
      expectedScrollDelta == actualScrollDelta &&
        abs(expectedHighlightTop - actualHighlightTop) <= 2 &&
        currentChangedPixels >= requiredCurrentPixels &&
        currentSample.first != currentSample.second &&
        staleChangedPixels <= 2 &&
        staleSample.first == staleSample.second &&
        layoutUnchanged &&
        cleanReferenceUnchanged

    fun failureDescription(): String =
      "$direction: scroll=$actualScrollDelta/$expectedScrollDelta, " +
        "highlightTop=$actualHighlightTop/$expectedHighlightTop, " +
        "currentPixels=$currentChangedPixels/$requiredCurrentPixels, " +
        "stalePixels=$staleChangedPixels, currentSample=${currentSample.hex()}, " +
        "staleSample=${staleSample.hex()}, " +
        "layoutUnchanged=$layoutUnchanged, " +
        "cleanReferenceUnchanged=$cleanReferenceUnchanged"

    private fun Pair<Int, Int>.hex(): String =
      first.toUInt().toString(16) + "/" + second.toUInt().toString(16)

  }

  private data class HorizontalDrawTimePixelResult(
    val direction: String,
    val expectedScrollDelta: Int,
    val actualScrollDelta: Int,
    val expectedHighlightLeft: Int,
    val actualHighlightLeft: Int,
    val currentChangedPixels: Int,
    val requiredCurrentPixels: Int,
    val staleChangedPixels: Int,
    val layoutUnchanged: Boolean
  ) {
    fun passed(): Boolean =
      expectedScrollDelta == actualScrollDelta &&
        abs(expectedHighlightLeft - actualHighlightLeft) <= 2 &&
        currentChangedPixels >= requiredCurrentPixels &&
        staleChangedPixels <= 2 &&
        layoutUnchanged

    fun failureDescription(): String =
      "$direction: scroll=$actualScrollDelta/$expectedScrollDelta, " +
        "highlightLeft=$actualHighlightLeft/$expectedHighlightLeft, " +
        "currentPixels=$currentChangedPixels/$requiredCurrentPixels, " +
        "stalePixels=$staleChangedPixels, layoutUnchanged=$layoutUnchanged"
  }

  private data class ReboundTextViewPixelResult(
    val currentChangedPixels: Int,
    val requiredCurrentPixels: Int,
    val staleChangedPixels: Int,
    val reboundText: String,
    val reboundRowKey: String
  ) {
    fun passed(): Boolean =
      currentChangedPixels >= requiredCurrentPixels &&
        staleChangedPixels <= 2 &&
        reboundText == "A0B" &&
        reboundRowKey == "inline"

    fun failureDescription(): String =
      "reboundText=$reboundText, reboundRow=$reboundRowKey, " +
        "currentPixels=$currentChangedPixels/$requiredCurrentPixels, stalePixels=$staleChangedPixels"
  }

  private class SurfaceFixture(val activity: Activity) {
    private val reactContext = FixtureReactContext(activity.applicationContext)
    private val handleColor = resolveTestColor(reactContext, android.R.attr.colorAccent, 0xFF1668DC.toInt())
    private val appContext = AppContext(
      object : ModulesProvider {
        override fun getModulesList(): List<Class<out Module>> = emptyList()
      },
      ModuleRegistry(emptyList(), emptyList()),
      WeakReference(reactContext)
    )
    val surface = ForumContentSelectionView(reactContext, appContext)
    private val mountedWindow = LinearLayout(reactContext).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }
    val first = textCell("native-first", "one two")
    val media = mediaCell("native-media")
    val second = textCell("native-second", "beta")
    val last = textCell("native-last", "gamma")
    val inline = inlineCell("native-inline")
    val reply = textCell("unregistered-reply", "reply text")
    var gestureDownTime = SystemClock.uptimeMillis()

    init {
      mountOnly(first)
      surface.addReactChild(mountedWindow, 0)
      surface.pendingRevision = "revision-1"
      surface.pendingRows = listOf(
        ForumSelectionRowRecord("doc", "first", "native-first", textToken("one two", "\n")),
        ForumSelectionRowRecord("doc", "media", "native-media", mediaToken("[sticker]\n")),
        ForumSelectionRowRecord("doc", "second", "native-second", textToken("beta", "\n")),
        ForumSelectionRowRecord("doc", "last", "native-last", textToken("gamma", "")),
        ForumSelectionRowRecord("doc", "inline", "native-inline", inlineToken())
      )
      surface.commitProps()
      activity.setContentView(
        surface,
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      )
    }

    fun mountOnly(cell: Cell) {
      mountRoot(cell.root)
    }

    fun mountRoot(root: View) {
      mountedWindow.removeAllViews()
      root.layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      mountedWindow.addView(root)
    }

    fun mountTogether(firstCell: Cell, secondCell: Cell) {
      mountedWindow.removeAllViews()
      listOf(firstCell, secondCell).forEach { cell ->
        cell.root.layoutParams = LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          0,
          1f
        )
        mountedWindow.addView(cell.root)
      }
    }

    fun pointInText(textView: TextView, utf16Offset: Int): Pair<Float, Float> {
      val layout = requireNotNull(textView.layout)
      val viewLocation = IntArray(2)
      val surfaceLocation = IntArray(2)
      textView.getLocationOnScreen(viewLocation)
      surface.getLocationOnScreen(surfaceLocation)
      val offset = utf16Offset.coerceIn(0, layout.text.length)
      val line = layout.getLineForOffset(offset)
      return (
        viewLocation[0] - surfaceLocation[0] + textView.totalPaddingLeft + layout.getPrimaryHorizontal(offset)
        ) to (
        viewLocation[1] - surfaceLocation[1] + textView.totalPaddingTop + layout.getLineBottom(line) / 2f
        )
    }

    fun pointInLayout(textView: TextView, layoutOffset: Int, xNudge: Float = 0f): Pair<Float, Float> {
      val point = pointInText(textView, layoutOffset)
      return (point.first + xNudge) to point.second
    }

    fun geometry(textView: TextView, spanStart: Int, spanEnd: Int): TextGeometry {
      val layout = requireNotNull(textView.layout)
      val location = IntArray(2)
      textView.getLocationOnScreen(location)
      return TextGeometry(
        left = location[0],
        top = location[1],
        width = textView.width,
        height = textView.height,
        baseline = textView.baseline,
        spanStartX = layout.getPrimaryHorizontal(spanStart),
        spanEndX = layout.getPrimaryHorizontal(spanEnd)
      )
    }

    fun send(action: Int, x: Float, y: Float, downTime: Long) {
      val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
      try {
        surface.dispatchTouchEvent(event)
      } finally {
        event.recycle()
      }
    }

    fun tap(target: Pair<Float, Float>) {
      val downTime = SystemClock.uptimeMillis()
      send(MotionEvent.ACTION_DOWN, target.first, target.second, downTime)
      send(MotionEvent.ACTION_UP, target.first, target.second, downTime)
    }

    fun installSecondLink(onClick: () -> Unit) {
      second.text.text = SpannableString("beta").also { text ->
        text.setSpan(
          object : ClickableSpan() {
            override fun onClick(widget: View) = onClick()
          },
          0,
          4,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
      }
      second.text.setTextIsSelectable(false)
      second.text.movementMethod = LinkMovementMethod.getInstance()
    }

    fun translateMountedWindow(translationY: Float) {
      mountedWindow.translationY = translationY
    }

    fun localHandleColorBounds(): Rect? {
      val bitmap = Bitmap.createBitmap(surface.width, surface.height, Bitmap.Config.ARGB_8888)
      surface.draw(Canvas(bitmap))
      return try {
        colorBounds(bitmap, handleColor)
      } finally {
        bitmap.recycle()
      }
    }

    fun localHandleColorPixelCount(textView: TextView): Int {
      val bitmap = Bitmap.createBitmap(textView.width, textView.height, Bitmap.Config.ARGB_8888)
      textView.draw(Canvas(bitmap))
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      bitmap.recycle()
      return pixels.count { it == handleColor }
    }

    fun routeOnlyHandleColorPixelCount(): Int {
      val previousVisibility = mountedWindow.visibility
      mountedWindow.visibility = View.INVISIBLE
      val bitmap = Bitmap.createBitmap(surface.width, surface.height, Bitmap.Config.ARGB_8888)
      return try {
        surface.draw(Canvas(bitmap))
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        pixels.count { it == handleColor }
      } finally {
        bitmap.recycle()
        mountedWindow.visibility = previousVisibility
      }
    }

    private fun colorBounds(bitmap: Bitmap, color: Int): Rect? {
      var left = bitmap.width
      var top = bitmap.height
      var right = -1
      var bottom = -1
      val row = IntArray(bitmap.width)
      for (y in 0 until bitmap.height) {
        bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
        row.indices.forEach { x ->
          if (row[x] == color) {
            left = minOf(left, x)
            top = minOf(top, y)
            right = maxOf(right, x)
            bottom = maxOf(bottom, y)
          }
        }
      }
      return if (right < left || bottom < top) null else Rect(left, top, right + 1, bottom + 1)
    }

    fun close() {
      surface.destroy()
      reactContext.destroy()
      activity.finish()
    }

    private fun textCell(nativeId: String, value: String): Cell {
      val text = TextView(reactContext).apply {
        this.text = value
        setTextIsSelectable(true)
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }
      return Cell(
        FrameLayout(reactContext).apply {
          setTag(R.id.view_tag_native_id, nativeId)
          addView(text)
        },
        text
      )
    }

    private fun mediaCell(nativeId: String): Cell {
      val text = TextView(reactContext).apply {
        this.text = SpannableString("0").also {
          it.setSpan(FixedReplacementSpan(24), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        setTextIsSelectable(true)
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }
      return Cell(
        FrameLayout(reactContext).apply {
          setTag(R.id.view_tag_native_id, nativeId)
          addView(text)
        },
        text
      )
    }

    private fun inlineCell(nativeId: String): Cell {
      val text = TextView(reactContext).apply {
        this.text = SpannableString("A0B").also {
          it.setSpan(FixedReplacementSpan(24), 1, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        setTextIsSelectable(true)
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }
      return Cell(
        FrameLayout(reactContext).apply {
          setTag(R.id.view_tag_native_id, nativeId)
          addView(text)
        },
        text
      )
    }

  }

  private data class HandlePixelProbe(val x: Float, val y: Float, val color: Int, val radius: Int) {
    fun matches(bitmap: Bitmap): Boolean {
      val centerX = x.roundToInt()
      val centerY = y.roundToInt()
      for (sampleY in centerY - radius..centerY + radius) {
        for (sampleX in centerX - radius..centerX + radius) {
          if (sampleX in 0 until bitmap.width && sampleY in 0 until bitmap.height && bitmap.getPixel(sampleX, sampleY) == color) {
            return true
          }
        }
      }
      return false
    }

    fun failureDescription(): String = "missing handle color ${color.toUInt().toString(16)} within $radius px of ($x,$y)"
  }

  private data class Cell(val root: FrameLayout, val text: TextView)

  private data class TextGeometry(
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
    val baseline: Int,
    val spanStartX: Float,
    val spanEndX: Float
  )

  private class FixtureReactContext(context: Context) : ReactApplicationContext(context) {
    override fun <T : JavaScriptModule> getJSModule(jsInterface: Class<T>): T? = null

    override fun <T : NativeModule> hasNativeModule(nativeModuleInterface: Class<T>): Boolean = false

    override fun getNativeModules(): Collection<NativeModule> = emptyList()

    override fun <T : NativeModule> getNativeModule(nativeModuleInterface: Class<T>): T? = null

    override fun getNativeModule(moduleName: String): NativeModule? = null

    @Suppress("DEPRECATION")
    override fun getCatalystInstance(): CatalystInstance? = null

    @Suppress("DEPRECATION")
    override fun hasActiveCatalystInstance(): Boolean = false

    override fun hasActiveReactInstance(): Boolean = false

    @Suppress("DEPRECATION")
    override fun hasCatalystInstance(): Boolean = false

    override fun hasReactInstance(): Boolean = false

    override fun destroy() = Unit

    override fun handleException(exception: Exception) {
      throw exception
    }

    @Suppress("DEPRECATION")
    override fun isBridgeless(): Boolean = false

    override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = null

    override fun getJSCallInvokerHolder(): CallInvokerHolder? = null

    @Suppress("DEPRECATION")
    override fun getFabricUIManager(): UIManager? = null

    override fun getSourceURL(): String? = null

    override fun registerSegment(segmentId: Int, path: String?, callback: Callback?) = Unit
  }

  private class FixedReplacementSpan(private val width: Int) : ReplacementSpan() {
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

  private companion object {
    const val DRAW_PLAIN_TEXT = "highlight ownership follows text"
    const val DRAW_CODE_TEXT = "prefix prefix prefix prefix prefix mark follows text in horizontal code"

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

    fun mediaToken(copyText: String): String = JSONObject()
      .put("version", 1)
      .put(
        "prefix",
        JSONArray()
          .put(JSONObject().put("kind", "media").put("text", copyText))
      )
      .put("owners", JSONArray())
      .toString()

    fun inlineToken(): String = JSONObject()
      .put("version", 1)
      .put("prefix", JSONArray())
      .put(
        "owners",
        JSONArray().put(
          JSONObject()
            .put("text", "AB")
            .put("tape", JSONArray().put(JSONObject().put("at", 1).put("text", "[inline]")))
            .put("trailing", JSONArray())
        )
      )
      .toString()
  }
}
