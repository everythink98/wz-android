package com.wz.reader

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Insets
import android.os.CancellationSignal
import android.os.Build
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowInsetsAnimationControlListener
import android.view.WindowInsetsAnimationController
import android.view.WindowInsetsAnimation
import android.view.WindowInsetsController
import android.view.animation.LinearInterpolator
import android.widget.EditText
import android.widget.FrameLayout
import android.view.inputmethod.InputMethodManager
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.wz.reader.composer.ComposerKeyboardHost
import com.wz.reader.composer.ComposerKeyboardHostManager
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.lang.reflect.Proxy
import java.time.Duration

/** Real attached RN container, child focus/key routing and animator; only platform IME control is driven. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class ComposerKeyboardHostTest {
  private lateinit var activity: ActivityController<Activity>
  private lateinit var container: FrameLayout
  private lateinit var host: ObservedHost
  private lateinit var input: EditText
  private lateinit var other: EditText
  private var backTime = 1000L

  @Before fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    if (Build.VERSION.SDK_INT < 30) return
    val app = RuntimeEnvironment.getApplication()
    DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(app)
    activity = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val react = object : BridgeReactContext(app) {
      override fun <T : JavaScriptModule> getJSModule(type: Class<T>): T =
        requireNotNull(type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, _, _ -> null }))
    }
    val themed = ThemedReactContext(react, activity.get(), "ComposerProof", 1)
    host = ObservedHost(themed)
    input = EditText(themed).apply { isFocusableInTouchMode = true }
    other = EditText(themed).apply { isFocusableInTouchMode = true }
    host.addView(input)
    container = FrameLayout(activity.get()).apply { addView(host); addView(other) }
    activity.get().setContentView(container)
    container.layout(0, 0, 400, 600)
    host.layout(0, 0, 400, 500)
    input.layout(0, 0, 400, 100)
    other.layout(0, 500, 400, 600)
    host.setHostEnabled(true)
    assertTrue(host.isAttachedToWindow)
    assertNotNull(host.windowToken)
    assertTrue(input.requestFocus())
    assertSame(input, host.findFocus())
    assertFalse(host.isFocused)
  }

  @After fun tearDown() {
    setAnimationScale(1f)
    if (::activity.isInitialized) activity.pause().stop().destroy()
  }

  private fun down(): Long = (++backTime).also {
    assertTrue(host.dispatchKeyEventPreIme(KeyEvent(it, it, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 0)))
  }

  private fun up(time: Long, flags: Int = 0) {
    assertTrue(host.dispatchKeyEventPreIme(KeyEvent(time, time + 1, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK, 0, 0, 0, 0, flags)))
  }

  private fun finishAnimation() { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400)) }
  private fun drawHiddenLayout() { host.viewTreeObserver.dispatchOnPreDraw(); host.viewTreeObserver.dispatchOnPreDraw() }

  @Test fun focusedDescendantBackControlsImeBeforeTheInputMethodSeesHide() {
    up(down())
    assertEquals(1, host.ime.requests.size)
    assertEquals(0, host.ime.ordinaryHides)
    host.ime.requests.single().ready()
    finishAnimation()
    assertEquals(listOf(false), host.ime.requests.single().finishes)
    assertTrue(host.events.isEmpty())
    assertSame(input, host.findFocus())
  }

  @Test fun commandPreservesInputFocusAndAcknowledgesOnlyItsCompletedHide() {
    host.hideKeyboard(7.0)
    assertEquals(1, host.ime.requests.size)
    assertTrue(host.events.isEmpty())
    assertEquals(0, host.ime.ordinaryHides)
    val request = host.ime.requests.single()
    request.current = Insets.of(0, 0, 0, 171)
    request.ready()
    assertEquals(171, request.frames.first().bottom)
    finishAnimation()
    assertEquals(0, request.frames.last().bottom)
    assertEquals(listOf(7.0 to true), host.events)
    assertSame(input, host.findFocus())
  }

  @Test fun panelKeepsImeControlUntilTheZeroInsetLayoutHasBeenSubmitted() {
    ComposerKeyboardHostManager().updateProperties(host, ReactStylesDiffMap(JavaOnlyMap.of(
      "hiddenLayoutHeight", PixelUtil.toDIPFromPixel(600f).toDouble(),
    )))
    host.hideKeyboard(81.0)
    val request = host.ime.requests.single()
    request.ready()
    finishAnimation()
    assertTrue("Elapsed animator time must not finish a stale panel", request.finishes.isEmpty())
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 285)
    host.dispatchWindowInsetsAnimationPrepare(animation)
    host.dispatchWindowInsetsAnimationProgress(imeFrame(0), listOf(animation))
    host.viewTreeObserver.dispatchOnPreDraw()
    assertTrue("A 500px panel is not the 600px hidden endpoint", host.frameCommits.isEmpty())
    host.layout(0, 0, 400, 600)
    host.translationY = -21f
    host.viewTreeObserver.dispatchOnPreDraw()
    assertTrue("The old keyboard translation must also be gone", host.frameCommits.isEmpty())
    host.translationY = 0f
    host.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(1, host.frameCommits.size)
    assertTrue("Pre-draw alone has not submitted the buffer", request.finishes.isEmpty())
    host.frameCommits.single().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), request.finishes)
    assertEquals(listOf(81.0 to true), host.events)
    assertSame(input, host.findFocus())
  }

  private fun preparePanelCommit(id: Double): Pair<ControlRequest, WindowInsetsAnimation> {
    host.setHiddenLayoutHeight(PixelUtil.toDIPFromPixel(600f))
    host.hideKeyboard(id)
    val request = host.ime.requests.last()
    request.ready()
    finishAnimation()
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 285)
    host.dispatchWindowInsetsAnimationPrepare(animation)
    host.dispatchWindowInsetsAnimationProgress(imeFrame(0), listOf(animation))
    host.layout(0, 0, 400, 600)
    host.viewTreeObserver.dispatchOnPreDraw()
    assertTrue(request.finishes.isEmpty())
    assertTrue(host.frameCommits.isNotEmpty())
    return request to animation
  }

  @Test fun aFrameForAnOldPanelHeightCannotFinishTheNewLayout() {
    val (request) = preparePanelCommit(82.0)
    val oldCommit = host.frameCommits.single()
    host.setHiddenLayoutHeight(PixelUtil.toDIPFromPixel(700f))
    oldCommit.run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(request.finishes.isEmpty())
    host.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(1, host.frameCommits.size)
    host.layout(0, 0, 400, 700)
    host.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(2, host.frameCommits.size)
    host.frameCommits.last().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), request.finishes)
    assertEquals(listOf(82.0 to true), host.events)
  }

  @Test fun aPanelThatMovesAfterDrawingMustSubmitItsNewEndpoint() {
    val (request) = preparePanelCommit(83.0)
    host.translationY = -21f
    host.frameCommits.single().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(request.finishes.isEmpty())
    host.translationY = 0f
    host.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(2, host.frameCommits.size)
    host.frameCommits.last().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), request.finishes)
  }

  @Test fun restoringGeometryDoesNotTurnAnObsoleteCommitIntoAFreshFrame() {
    val (request) = preparePanelCommit(89.0)
    val obsolete = host.frameCommits.single()
    host.layout(0, 0, 400, 579)
    host.viewTreeObserver.dispatchOnPreDraw()
    host.layout(0, 0, 400, 600)
    obsolete.run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(request.finishes.isEmpty())
    host.viewTreeObserver.dispatchOnPreDraw()
    host.frameCommits.last().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), request.finishes)
  }

  @Test fun removingThePanelTargetDuringAnimationCancelsItsHide() {
    host.setHiddenLayoutHeight(PixelUtil.toDIPFromPixel(600f))
    host.hideKeyboard(90.0)
    val request = host.ime.requests.single()
    request.ready()
    host.setHiddenLayoutHeight(0f)
    finishAnimation()
    assertTrue(request.signal.isCanceled)
    assertTrue(request.finishes.isEmpty())
    assertTrue(host.frameCommits.isEmpty())
    assertEquals(listOf(90.0 to false), host.events)
  }

  @Test fun aSoftwareWindowUsesSystemHideInsteadOfInventingAFrameCommit() {
    host.hardwareAccelerated = false
    host.setHiddenLayoutHeight(PixelUtil.toDIPFromPixel(600f))
    host.hideKeyboard(91.0)
    val request = host.ime.requests.single()
    request.ready()
    finishAnimation()
    assertTrue(request.signal.isCanceled)
    assertTrue(request.finishes.isEmpty())
    assertTrue(host.frameCommits.isEmpty())
    assertEquals(1, host.ime.ordinaryHides)
    assertTrue(host.events.isEmpty())
    drawHiddenLayout()
    assertEquals(listOf(91.0 to true), host.events)
  }

  @Test fun losingFocusBeforeTheFrameCommitReleasesOnlyTheOldHide() {
    val (request) = preparePanelCommit(84.0)
    assertTrue(other.requestFocus())
    host.frameCommits.single().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(request.signal.isCanceled)
    assertTrue(request.finishes.isEmpty())
    assertEquals(listOf(84.0 to false), host.events)
    assertSame(other, container.findFocus())
  }

  @Test fun cancelledFrameCallbacksCannotFinishTheNextRequest() {
    val (oldRequest) = preparePanelCommit(85.0)
    val oldCommit = host.frameCommits.single()
    host.cancelHide(85.0)
    val (newRequest) = preparePanelCommit(86.0)
    oldCommit.run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(oldRequest.finishes.isEmpty())
    assertTrue(newRequest.finishes.isEmpty())
    host.frameCommits.last().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), newRequest.finishes)
    assertEquals(listOf(85.0 to false, 86.0 to true), host.events)
  }

  @Test fun systemCancellationDuringTheFrameWaitUsesTheExistingHiddenLayoutFallback() {
    val (request, animation) = preparePanelCommit(87.0)
    request.cancelFromSystem()
    assertEquals(1, host.ime.ordinaryHides)
    host.dispatchWindowInsetsAnimationEnd(animation)
    drawHiddenLayout()
    host.frameCommits.single().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(request.finishes.isEmpty())
    assertEquals(listOf(87.0 to true), host.events)
  }

  @Test fun zeroScaleStillSubmitsThePanelEndpointWithoutATimerDelay() {
    // Finish Activity setup before starting the zero-duration user operation.
    shadowOf(Looper.getMainLooper()).idle()
    setAnimationScale(0f)
    host.setHiddenLayoutHeight(PixelUtil.toDIPFromPixel(600f))
    host.layout(0, 0, 400, 600)
    host.hideKeyboard(88.0)
    val request = host.ime.requests.single()
    request.ready()
    assertEquals(0, request.frames.last().bottom)
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 0)
    host.dispatchWindowInsetsAnimationPrepare(animation)
    host.dispatchWindowInsetsAnimationProgress(imeFrame(0), listOf(animation))
    host.viewTreeObserver.dispatchOnPreDraw()
    assertTrue(host.events.isEmpty())
    host.frameCommits.single().run()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(listOf(false), request.finishes)
    assertEquals(listOf(88.0 to true), host.events)
  }

  @Test fun aSecondBackReleasedAfterCompletionCannotStartAUserShowRequest() {
    up(down())
    val first = host.ime.requests.single()
    first.ready()
    val secondDown = down()
    assertTrue(host.dispatchKeyEventPreIme(KeyEvent(secondDown, secondDown + 1, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 1)))
    finishAnimation()
    up(secondDown)
    assertEquals(1, host.ime.requests.size)
    assertFalse(host.ime.visible)
  }

  @Test fun aCanceledBackPairDoesNotHideOrClaimTheNextPair() {
    up(down(), KeyEvent.FLAG_CANCELED)
    assertTrue(host.ime.requests.isEmpty())
    up(down())
    assertEquals(1, host.ime.requests.size)
  }

  @Test fun aCommandCanObserveBackHideAndCancelItsOwnWaitWithoutCancelingBack() {
    up(down())
    host.hideKeyboard(11.0)
    host.hideKeyboard(12.0)
    assertEquals(1, host.ime.requests.size)
    host.cancelHide(11.0)
    assertEquals(listOf(11.0 to false), host.events)
    val request = host.ime.requests.single()
    assertFalse(request.signal.isCanceled)
    request.ready()
    finishAnimation()
    assertEquals(listOf(11.0 to false, 12.0 to true), host.events)
  }

  @Test fun cancelingACommandCannotHideTheNewInputOrCompleteANewerRequest() {
    host.hideKeyboard(20.0)
    val old = host.ime.requests.single()
    old.ready()
    assertTrue(other.requestFocus())
    assertTrue(old.signal.isCanceled)
    assertEquals(listOf(20.0 to false), host.events)
    assertEquals(0, host.ime.ordinaryHides)
    assertTrue(old.finishes.isEmpty())
    assertTrue(input.requestFocus())
    host.hideKeyboard(21.0)
    old.listener.onCancelled(old.controller)
    assertEquals(0, host.ime.ordinaryHides)
    assertEquals(listOf(20.0 to false), host.events)
    host.ime.requests.last().ready()
    finishAnimation()
    assertEquals(listOf(20.0 to false, 21.0 to true), host.events)
  }

  @Test fun disablingReleasesPendingControlWithoutOrdinaryHideOrLateSuccess() {
    host.hideKeyboard(30.0)
    val request = host.ime.requests.single()
    host.setHostEnabled(false)
    assertTrue(request.signal.isCanceled)
    request.listener.onReady(request.controller, WindowInsets.Type.ime())
    finishAnimation()
    assertEquals(listOf(30.0 to false), host.events)
    assertEquals(0, host.ime.ordinaryHides)
    assertTrue(request.finishes.isEmpty())
  }

  @Test fun detachingStopsTheAnimatorWithoutFinishingOrHidingAnotherWindow() {
    host.hideKeyboard(31.0)
    val request = host.ime.requests.single()
    request.ready()
    container.removeView(host)
    finishAnimation()
    assertTrue(request.signal.isCanceled)
    assertEquals(listOf(31.0 to false), host.events)
    assertTrue(request.finishes.isEmpty())
    assertEquals(0, host.ime.ordinaryHides)
  }

  @Test fun losingWindowFocusWhileWaitingForControlDoesNotFallbackHide() {
    host.hideKeyboard(32.0)
    val request = host.ime.requests.single()
    host.windowFocused = false
    host.onWindowFocusChanged(false)
    request.listener.onCancelled(null)
    assertTrue(request.signal.isCanceled)
    assertEquals(listOf(32.0 to false), host.events)
    assertEquals(0, host.ime.ordinaryHides)
  }

  @Test fun platformControlCancellationFallsBackOnlyForTheOriginalFocusedInput() {
    host.hideKeyboard(40.0)
    host.ime.requests.single().cancelFromSystem()
    assertEquals(1, host.ime.ordinaryHides)
    assertTrue("Accepting ordinary hide does not complete its layout", host.events.isEmpty())
    host.viewTreeObserver.dispatchOnPreDraw()
    assertTrue(host.events.isEmpty())
    host.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(listOf(40.0 to true), host.events)
    assertSame(input, host.findFocus())
  }

  @Test fun targetHiddenInsetsCannotCompleteFallbackWhileImeProgressIsStillClosing() {
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 285)
    val received = mutableListOf<WindowInsets>()
    input.setWindowInsetsAnimationCallback(object : WindowInsetsAnimation.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
      override fun onProgress(insets: WindowInsets, runningAnimations: MutableList<WindowInsetsAnimation>): WindowInsets {
        received += insets
        return insets
      }
    })
    host.hideKeyboard(41.0)
    host.dispatchWindowInsetsAnimationPrepare(animation)
    host.ime.requests.single().cancelFromSystem()
    assertFalse(host.ime.visible)
    assertEquals(0, host.ime.height)
    assertTrue(host.events.isEmpty())
    val closing = WindowInsets.Builder().setVisible(WindowInsets.Type.ime(), true)
      .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 150)).build()
    assertSame(closing, host.dispatchWindowInsetsAnimationProgress(closing, listOf(animation)))
    assertEquals(listOf(closing), received)
    drawHiddenLayout()
    assertTrue(host.events.isEmpty())
    val hidden = WindowInsets.Builder().setVisible(WindowInsets.Type.ime(), false)
      .setInsets(WindowInsets.Type.ime(), Insets.NONE).build()
    host.dispatchWindowInsetsAnimationProgress(hidden, listOf(animation))
    drawHiddenLayout()
    assertTrue("Zero progress is not an animation end", host.events.isEmpty())
    host.dispatchWindowInsetsAnimationEnd(animation)
    drawHiddenLayout()
    assertEquals(listOf(41.0 to true), host.events)
  }

  @Test fun losingTheFallbackOwnerRemovesItsPendingLayoutAcknowledgement() {
    host.hideKeyboard(42.0)
    host.ime.requests.single().cancelFromSystem()
    assertTrue(host.events.isEmpty())
    assertTrue(other.requestFocus())
    drawHiddenLayout()
    assertEquals(listOf(42.0 to false), host.events)
    assertEquals(1, host.ime.ordinaryHides)
  }

  @Test fun anotherBackDuringFallbackReturnsControlToTheNormalKeyPath() {
    host.hideKeyboard(43.0)
    host.ime.requests.single().cancelFromSystem()
    val time = ++backTime
    host.dispatchKeyEventPreIme(KeyEvent(time, time, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 0))
    host.dispatchKeyEventPreIme(KeyEvent(time, time + 1, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK, 0))
    drawHiddenLayout()
    assertEquals(listOf(43.0 to false), host.events)
    assertEquals(1, host.ime.requests.size)
  }

  @Test fun floatingImeUsesOrdinaryHideAndAlreadyHiddenImeDoesNotGetShown() {
    host.ime.height = 0
    host.hideKeyboard(50.0)
    assertTrue(host.ime.requests.isEmpty())
    assertEquals(1, host.ime.ordinaryHides)
    assertTrue(host.events.isEmpty())
    drawHiddenLayout()
    host.ime.visible = false
    host.hideKeyboard(51.0)
    assertEquals(1, host.ime.ordinaryHides)
    assertEquals(listOf(50.0 to true, 51.0 to true), host.events)
  }

  @Test fun aHiddenImeAcknowledgesEvenWhenNoInputInTheHostHasFocus() {
    host.ime.visible = false
    host.ime.height = 0
    assertTrue(other.requestFocus())
    assertNull(host.findFocus())
    host.hideKeyboard(52.0)
    assertTrue(host.ime.requests.isEmpty())
    assertEquals(0, host.ime.ordinaryHides)
    assertEquals(listOf(52.0 to true), host.events)
  }

  @Test @Config(sdk = [28])
  fun oldAndroidLoadsTheHostAndUsesStandardHideWithoutBlurringTheInput() {
    val app = RuntimeEnvironment.getApplication()
    activity = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val react = BridgeReactContext(app)
    val themed = ThemedReactContext(react, activity.get(), "ComposerProof", 1)
    val events = mutableListOf<Pair<Double, Boolean>>()
    val insetsEvents = mutableListOf<Double>()
    val imm = app.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as InputMethodManager
    val legacyHost = object : ComposerKeyboardHost(themed) {
      override fun hasWindowFocus() = true
      override fun getRootWindowInsets(): WindowInsets = requireNotNull(WindowInsetsCompat.Builder()
        .setSystemWindowInsets(androidx.core.graphics.Insets.of(0, 0, 0, if (shadowOf(imm).isSoftInputVisible) 336 else 0))
        .setStableInsets(androidx.core.graphics.Insets.NONE).build().toWindowInsets())
      override fun emitKeyboardHidden(requestId: Double, success: Boolean) { events += requestId to success }
      override fun emitImeInsets(bottom: Double) { insetsEvents += bottom }
    }
    val editor = EditText(themed).apply { isFocusableInTouchMode = true }
    legacyHost.addView(editor)
    activity.get().setContentView(legacyHost)
    legacyHost.layout(0, 0, 400, 500)
    editor.layout(0, 0, 400, 100)
    assertTrue(editor.requestFocus())
    legacyHost.setHostEnabled(true)
    legacyHost.setTrackImeInsets(true)
    imm.showSoftInput(editor, 0)
    assertTrue(shadowOf(imm).isSoftInputVisible)
    legacyHost.hideKeyboard(53.0)
    assertFalse(shadowOf(imm).isSoftInputVisible)
    assertSame(editor, legacyHost.findFocus())
    assertTrue(events.isEmpty())
    legacyHost.viewTreeObserver.dispatchOnPreDraw()
    assertTrue(events.isEmpty())
    legacyHost.viewTreeObserver.dispatchOnPreDraw()
    assertEquals(listOf(53.0 to true), events)
    legacyHost.isFocusableInTouchMode = true
    assertTrue(legacyHost.requestFocus())
    assertSame(legacyHost, legacyHost.findFocus())
    legacyHost.hideKeyboard(54.0)
    assertEquals(listOf(53.0 to true, 54.0 to true), events)
    assertTrue(insetsEvents.isEmpty())
  }

  @Test fun systemZeroAnimationScaleCompletesWithoutAnArtificialDelay() {
    setAnimationScale(0f)
    host.hideKeyboard(60.0)
    host.ime.requests.single().ready()
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(40))
    assertEquals(listOf(60.0 to true), host.events)
    assertEquals(listOf(false), host.ime.requests.single().finishes)
  }

  @Test fun managerKeepsReactViewCommandsAndExposesTheHideAcknowledgement() {
    val manager = ComposerKeyboardHostManager()
    assertEquals("WzComposerKeyboardHost", manager.getName())
    assertTrue(manager.getCommandsMap().containsKey("setPressed"))
    assertEquals(mapOf("registrationName" to "onKeyboardHidden"), manager.getExportedCustomDirectEventTypeConstants()["topKeyboardHidden"])
    assertEquals(mapOf("registrationName" to "onImeInsets"), manager.getExportedCustomDirectEventTypeConstants()["topImeInsets"])
    manager.receiveCommand(host, "hideKeyboard", JavaOnlyArray.of(70.0))
    val request = host.ime.requests.single()
    manager.receiveCommand(host, manager.getCommandsMap().getValue("cancelHide"), JavaOnlyArray.of(70.0))
    assertTrue(request.signal.isCanceled)
    assertEquals(listOf(70.0 to false), host.events)
  }

  private fun layoutInsetsHost(height: Int = 600) {
    host.rootView.layout(0, 0, 400, 600)
    container.layout(0, 0, 400, 600)
    val rootPosition = IntArray(2)
    val parentPosition = IntArray(2)
    val hostPosition = IntArray(2)
    host.rootView.getLocationOnScreen(rootPosition)
    container.getLocationOnScreen(parentPosition)
    // Account for the Activity theme's content offset; test the Host's actual screen rectangle.
    val top = rootPosition[1] - parentPosition[1]
    host.layout(0, top, 400, top + height)
    host.getLocationOnScreen(hostPosition)
    assertEquals(600 - height, rootPosition[1] + host.rootView.height - hostPosition[1] - host.height)
  }

  private fun imeFrame(height: Int) = WindowInsets.Builder()
    .setVisible(WindowInsets.Type.ime(), height > 0)
    .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, height)).build()

  @Test fun localInsetsRetainTheirActualHeightThroughTargetLayoutAndTrackAnimationProgress() {
    layoutInsetsHost()
    host.setTrackImeInsets(true)
    assertEquals(listOf(PixelUtil.toDIPFromPixel(336f).toDouble()), host.insetsEvents)
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 285)
    host.dispatchWindowInsetsAnimationPrepare(animation)
    host.ime.height = 0
    host.ime.visible = false
    host.dispatchApplyWindowInsets(imeFrame(0))
    assertEquals(1, host.insetsEvents.size)
    val closing = imeFrame(180)
    assertSame(closing, host.dispatchWindowInsetsAnimationProgress(closing, listOf(animation)))
    assertEquals(PixelUtil.toDIPFromPixel(180f).toDouble(), host.insetsEvents.last(), 0.001)
    val overlapping = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 200)
    host.dispatchWindowInsetsAnimationPrepare(overlapping)
    host.dispatchWindowInsetsAnimationEnd(animation)
    assertEquals(PixelUtil.toDIPFromPixel(180f).toDouble(), host.insetsEvents.last(), 0.001)
    host.dispatchWindowInsetsAnimationEnd(overlapping)
    assertEquals(0.0, host.insetsEvents.last(), 0.001)
  }

  @Test fun localInsetsSubtractAvoidanceAlreadyAppliedToTheHostAndUpdateAfterLayout() {
    layoutInsetsHost(500)
    host.setTrackImeInsets(true)
    assertEquals(listOf(PixelUtil.toDIPFromPixel(236f).toDouble()), host.insetsEvents)
    layoutInsetsHost(400)
    assertEquals(PixelUtil.toDIPFromPixel(136f).toDouble(), host.insetsEvents.last(), 0.001)
    layoutInsetsHost(200)
    assertEquals(0.0, host.insetsEvents.last(), 0.001)
  }

  @Test fun ordinaryHostsAndDisabledOrDetachedObserversDoNotPublishImeFrames() {
    layoutInsetsHost()
    val animation = WindowInsetsAnimation(WindowInsets.Type.ime(), LinearInterpolator(), 285)
    host.dispatchWindowInsetsAnimationProgress(imeFrame(240), listOf(animation))
    assertTrue(host.insetsEvents.isEmpty())
    host.setTrackImeInsets(true)
    assertFalse(host.insetsEvents.isEmpty())
    host.setTrackImeInsets(false)
    host.insetsEvents.clear()
    host.dispatchWindowInsetsAnimationProgress(imeFrame(120), listOf(animation))
    assertTrue(host.insetsEvents.isEmpty())
    host.setTrackImeInsets(true)
    host.setHostEnabled(false)
    host.insetsEvents.clear()
    host.dispatchWindowInsetsAnimationProgress(imeFrame(80), listOf(animation))
    assertTrue(host.insetsEvents.isEmpty())
    host.setHostEnabled(true)
    container.removeView(host)
    host.insetsEvents.clear()
    host.dispatchWindowInsetsAnimationProgress(imeFrame(0), listOf(animation))
    assertTrue(host.insetsEvents.isEmpty())
  }

  private class ObservedHost(context: ThemedReactContext) : ComposerKeyboardHost(context) {
    val ime = PlatformIme()
    val events = mutableListOf<Pair<Double, Boolean>>()
    val insetsEvents = mutableListOf<Double>()
    val frameCommits = mutableListOf<Runnable>()
    var hardwareAccelerated = true
    var windowFocused = true
    override fun isHardwareAccelerated() = hardwareAccelerated
    override fun hasWindowFocus() = windowFocused
    override fun getWindowInsetsController() = ime.window
    override fun getRootWindowInsets(): WindowInsets = WindowInsets.Builder()
      .setVisible(WindowInsets.Type.ime(), ime.visible)
      .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, ime.height)).build()
    override fun emitKeyboardHidden(requestId: Double, success: Boolean) { events += requestId to success }
    override fun emitImeInsets(bottom: Double) { insetsEvents += bottom }
    override fun registerFrameCommit(observer: ViewTreeObserver, callback: Runnable) { frameCommits += callback }
  }

  private class PlatformIme {
    var height = 336
    var visible = true
    var ordinaryHides = 0
    val requests = mutableListOf<ControlRequest>()
    val window = proxy(WindowInsetsController::class.java) { name, args ->
      when (name) {
        "controlWindowInsetsAnimation" -> {
          requests += ControlRequest(this, args[3] as CancellationSignal, args[4] as WindowInsetsAnimationControlListener)
          null
        }
        "hide" -> { ordinaryHides++; visible = false; height = 0; null }
        else -> null
      }
    }
  }

  private class ControlRequest(
    private val ime: PlatformIme,
    val signal: CancellationSignal,
    val listener: WindowInsetsAnimationControlListener,
  ) {
    var current = Insets.of(0, 0, 0, ime.height)
    val frames = mutableListOf<Insets>()
    val finishes = mutableListOf<Boolean>()
    private var cancelled = false
    private var finished = false
    private var ready = false
    val controller: WindowInsetsAnimationController = proxy(WindowInsetsAnimationController::class.java) { name, args ->
      when (name) {
        "getShownStateInsets" -> Insets.of(0, 0, 0, ime.height)
        "getHiddenStateInsets" -> Insets.NONE
        "getCurrentInsets" -> current
        "getTypes", "getControllingTypes" -> WindowInsets.Type.ime()
        "isReady" -> !cancelled && !finished
        "isCancelled" -> cancelled
        "isFinished" -> finished
        "getCurrentAlpha" -> 1f
        "getCurrentFraction" -> 0f
        "setInsetsAndAlpha" -> { current = args[0] as Insets; frames += current; null }
        "finish" -> {
          val shown = args[0] as Boolean
          finishes += shown; finished = true; ime.visible = shown
          listener.onFinished(controllerReference())
          null
        }
        else -> null
      }
    }
    private fun controllerReference(): WindowInsetsAnimationController = controller
    init { signal.setOnCancelListener { cancelFromSystem() } }
    fun ready() { ready = true; listener.onReady(controller, WindowInsets.Type.ime()) }
    fun cancelFromSystem() { cancelled = true; listener.onCancelled(if (ready) controller else null) }
  }

  companion object {
    private fun setAnimationScale(scale: Float) {
      ValueAnimator::class.java.getDeclaredMethod("setDurationScale", Float::class.javaPrimitiveType).invoke(null, scale)
    }

    private fun <T> proxy(type: Class<T>, call: (String, Array<out Any?>) -> Any?): T =
      requireNotNull(type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, method, args ->
        call(method.name, args ?: emptyArray())
      }))
  }
}
