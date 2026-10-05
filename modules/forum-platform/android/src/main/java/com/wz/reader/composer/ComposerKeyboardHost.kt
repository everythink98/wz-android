package com.wz.reader.composer

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Insets
import android.os.Build
import android.os.CancellationSignal
import android.os.IBinder
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowInsetsAnimation
import android.view.WindowInsetsAnimationControlListener
import android.view.WindowInsetsAnimationController
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import kotlin.math.abs
import kotlin.math.roundToInt

private const val HIDDEN_EVENT = "topKeyboardHidden"
private const val INSETS_EVENT = "topImeInsets"

private class ImeInsetsEvent(surfaceId: Int, viewTag: Int, private val bottom: Double) :
  Event<ImeInsetsEvent>(surfaceId, viewTag) {
  override fun getEventName() = INSETS_EVENT
  override fun getEventData() = Arguments.createMap().apply { putDouble("bottom", bottom) }
}

private class KeyboardHiddenEvent(
  surfaceId: Int,
  viewTag: Int,
  private val requestId: Double,
  private val success: Boolean,
) : Event<KeyboardHiddenEvent>(surfaceId, viewTag) {
  override fun getEventName() = HIDDEN_EVENT
  override fun canCoalesce() = false
  override fun getEventData() = Arguments.createMap().apply {
    putDouble("requestId", requestId)
    putBoolean("success", success)
  }
}

/** Keeps IME content alive until the editor's controlled hide animation has completed. */
open class ComposerKeyboardHost(context: ThemedReactContext) : ReactViewGroup(context) {
  private var hostEnabled = false
  private var hiddenLayoutHeight = 0
  private var pending: HideRequest? = null
  private var backDownTime: Long? = null
  private var backFocus: View? = null
  private var backToken: IBinder? = null
  private var backCanStart = false
  private var focusObserver: ViewTreeObserver? = null
  private var imeAnimating = false
  private var imeProgressBottom: Int? = null
  private var trackImeInsets = false
  private var currentImeInsets: WindowInsets? = null
  private var lastImeOverlap: Int? = null
  private val rootPosition = IntArray(2)
  private val hostPosition = IntArray(2)
  private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, focus ->
    pending?.let { if (focus !== it.focus) cancelRequest(it) }
  }

  private class HideRequest(
    val focus: View,
    val token: IBinder,
    val fromBack: Boolean,
  ) {
    val commands = linkedSetOf<Double>()
    val signal = CancellationSignal()
    var animator: ValueAnimator? = null
    var fallback = false
    var hiddenLayoutReady = false
    var drawObserver: ViewTreeObserver? = null
    var drawListener: ViewTreeObserver.OnPreDrawListener? = null
    var commitObserver: ViewTreeObserver? = null
    var commitCallback: Runnable? = null
  }

  fun setHostEnabled(value: Boolean) {
    if (!value) resetImeInsets()
    hostEnabled = value
    if (!value) pending?.let(::cancelRequest)
    else syncImeInsets()
  }

  fun setHiddenLayoutHeight(value: Float) {
    require(value.isFinite() && value >= 0) { "hiddenLayoutHeight must be a non-negative DIP height" }
    val next = PixelUtil.toPixelFromDIP(value).roundToInt()
    if (hiddenLayoutHeight == next) return
    hiddenLayoutHeight = next
    pending?.takeIf { !it.fallback }?.let {
      clearFrameCommit(it)
      if (next == 0) cancelRequest(it) else postInvalidateOnAnimation()
    }
  }

  protected open fun registerFrameCommit(observer: ViewTreeObserver, callback: Runnable) {
    observer.registerFrameCommitCallback(callback)
  }

  fun setTrackImeInsets(value: Boolean) {
    if (trackImeInsets == value || Build.VERSION.SDK_INT < 30) return
    if (!value) resetImeInsets()
    trackImeInsets = value
    if (value) syncImeInsets()
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    val result = super.onApplyWindowInsets(insets)
    // The layout pass receives the animation target before the first progress frame.
    if (Build.VERSION.SDK_INT >= 30 && !imeAnimating) {
      currentImeInsets = insets
      publishImeInsets()
    }
    return result
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (changed) pending?.let(::clearFrameCommit)
    super.onLayout(changed, left, top, right, bottom)
    syncImeInsets()
  }

  override fun setTranslationY(value: Float) {
    if (translationY != value) pending?.let(::clearFrameCommit)
    super.setTranslationY(value)
  }

  private fun syncImeInsets() {
    if (Build.VERSION.SDK_INT < 30 || !trackImeInsets) return
    if (!imeAnimating) currentImeInsets = rootWindowInsets
    publishImeInsets()
  }

  private fun publishImeInsets() {
    if (Build.VERSION.SDK_INT < 30 || !trackImeInsets || !windowAvailable() || height <= 0) return
    val insets = currentImeInsets ?: return
    val imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom
    val root = rootView
    root.getLocationOnScreen(rootPosition)
    getLocationOnScreen(hostPosition)
    val alreadyAvoided = rootPosition[1] + root.height - hostPosition[1] - height
    val overlap = if (imeBottom == 0) 0 else maxOf(0, imeBottom - alreadyAvoided)
    if (lastImeOverlap == overlap) return
    lastImeOverlap = overlap
    emitImeInsets(PixelUtil.toDIPFromPixel(overlap.toFloat()).toDouble())
  }

  private fun resetImeInsets() {
    if (trackImeInsets && lastImeOverlap != null && lastImeOverlap != 0) emitImeInsets(0.0)
    lastImeOverlap = null
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    focusObserver = viewTreeObserver.also { it.addOnGlobalFocusChangeListener(focusListener) }
    if (Build.VERSION.SDK_INT >= 30) observeImeAnimation()
    syncImeInsets()
  }

  override fun onDetachedFromWindow() {
    pending?.let(::cancelRequest)
    resetImeInsets()
    focusObserver?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(focusListener)
    focusObserver = null
    if (Build.VERSION.SDK_INT >= 30) setWindowInsetsAnimationCallback(null)
    imeAnimating = false
    imeProgressBottom = null
    currentImeInsets = null
    backDownTime = null
    backFocus = null
    backToken = null
    super.onDetachedFromWindow()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) pending?.let(::cancelRequest)
    if (hasWindowFocus) syncImeInsets() else resetImeInsets()
  }

  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEventPreIme(event)
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      backDownTime = null
      backFocus = null
      backToken = null
      // A rejected control request must not trap later Back events in its fallback wait.
      pending?.takeIf { it.fallback }?.let {
        cancelRequest(it)
        return super.dispatchKeyEventPreIme(event)
      }
      val focus = findFocus()?.takeUnless { it === this }
      val running = pending?.let(::owns) == true
      if (windowAvailable() && focus != null && (running || canControlVisibleIme())) {
        backDownTime = event.downTime
        backFocus = focus
        backToken = windowToken
        // A pair consumed during another hide must never turn into a new USER show request.
        backCanStart = !running
      }
    }
    if (backDownTime != event.downTime) return super.dispatchKeyEventPreIme(event)
    if (event.action == KeyEvent.ACTION_UP) {
      val shouldStart = backCanStart && !event.isCanceled && windowAvailable() &&
        findFocus() === backFocus && windowToken == backToken && pending == null && canControlVisibleIme()
      backDownTime = null
      backFocus = null
      backToken = null
      if (shouldStart) startHide(null)
    }
    return true
  }

  private fun windowAvailable() = hostEnabled && isAttachedToWindow && hasWindowFocus() && windowToken != null

  private fun owns(request: HideRequest) = windowAvailable() &&
    windowToken == request.token && findFocus() === request.focus && request.focus.isAttachedToWindow

  private fun canControlVisibleIme(): Boolean {
    if (Build.VERSION.SDK_INT < 30) return false
    val insets = rootWindowInsets ?: return false
    return insets.isVisible(WindowInsets.Type.ime()) && insets.getInsets(WindowInsets.Type.ime()).bottom > 0
  }

  private fun observeImeAnimation() {
    setWindowInsetsAnimationCallback(object : WindowInsetsAnimation.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
      private val running = mutableSetOf<WindowInsetsAnimation>()

      override fun onPrepare(animation: WindowInsetsAnimation) {
        if (animation.typeMask and WindowInsets.Type.ime() != 0) {
          running.add(animation)
          imeAnimating = true
          pending?.hiddenLayoutReady = false
        }
      }

      override fun onProgress(insets: WindowInsets, runningAnimations: MutableList<WindowInsetsAnimation>): WindowInsets {
        runningAnimations.forEach { if (it.typeMask and WindowInsets.Type.ime() != 0) running.add(it) }
        imeAnimating = running.isNotEmpty()
        if (imeAnimating) {
          imeProgressBottom = insets.getInsets(WindowInsets.Type.ime()).bottom
        }
        currentImeInsets = insets
        publishImeInsets()
        return insets
      }

      override fun onEnd(animation: WindowInsetsAnimation) {
        if (animation.typeMask and WindowInsets.Type.ime() == 0) return
        running.remove(animation)
        imeAnimating = running.isNotEmpty()
        if (!imeAnimating) imeProgressBottom = null
        syncImeInsets()
        if (pending?.fallback == true) postInvalidateOnAnimation()
      }
    })
  }

  private fun hasHiddenImeLayout(): Boolean {
    if (imeAnimating || (imeProgressBottom ?: 0) > 0) return false
    val insets = ViewCompat.getRootWindowInsets(this) ?: return false
    return !insets.isVisible(WindowInsetsCompat.Type.ime()) && insets.getInsets(WindowInsetsCompat.Type.ime()).bottom == 0
  }

  fun hideKeyboard(requestId: Double) = startHide(requestId)

  fun cancelHide(requestId: Double) {
    val request = pending ?: return
    if (!request.commands.remove(requestId)) return
    emitKeyboardHidden(requestId, false)
    if (request.commands.isEmpty() && !request.fromBack) cancelRequest(request)
  }

  private fun startHide(requestId: Double?) {
    fun reply(success: Boolean) { requestId?.let { emitKeyboardHidden(it, success) } }
    if (!windowAvailable()) { reply(false); return }
    pending?.let {
      if (owns(it)) requestId?.let(it.commands::add)
      else { cancelRequest(it); reply(false) }
      return
    }
    // Check after pending: target Insets may already say hidden while a controlled hide runs.
    if (hasHiddenImeLayout()) {
      reply(true)
      return
    }
    val focus = findFocus()?.takeUnless { it === this }
    val token = windowToken
    if (focus == null || token == null) { reply(false); return }
    val request = HideRequest(focus, token, requestId == null)
    requestId?.let(request.commands::add)
    pending = request
    if (Build.VERSION.SDK_INT < 30 || !canControlVisibleIme() || windowInsetsController == null) {
      fallback(request)
      return
    }
    try {
      requireNotNull(windowInsetsController).controlWindowInsetsAnimation(
        WindowInsets.Type.ime(), 285, HIDE_INTERPOLATOR, request.signal,
        object : WindowInsetsAnimationControlListener {
          override fun onReady(controller: WindowInsetsAnimationController, types: Int) {
            if (pending !== request || request.fallback) { request.signal.cancel(); return }
            if (!owns(request)) { cancelRequest(request); return }
            if (types and WindowInsets.Type.ime() == 0) { fallback(request); return }
            try {
              val start = controller.currentInsets
              val hidden = controller.hiddenStateInsets
              if (start == hidden || !ValueAnimator.areAnimatorsEnabled()) {
                controller.setInsetsAndAlpha(hidden, 1f, 1f)
                finishAfterLayout(request, controller)
                return
              }
              val animator = ValueAnimator.ofFloat(0f, 1f)
              request.animator = animator
              animator.duration = 285
              animator.interpolator = LinearInterpolator()
              animator.addUpdateListener {
                if (pending !== request) return@addUpdateListener
                if (!owns(request)) { cancelRequest(request); return@addUpdateListener }
                if (!controller.isReady) return@addUpdateListener
                val raw = it.animatedValue as Float
                val fraction = HIDE_INTERPOLATOR.getInterpolation(raw)
                fun edge(from: Int, to: Int) = (from + (to - from) * fraction).roundToInt()
                try {
                  controller.setInsetsAndAlpha(Insets.of(
                    edge(start.left, hidden.left), edge(start.top, hidden.top),
                    edge(start.right, hidden.right), edge(start.bottom, hidden.bottom),
                  ), 1f, raw)
                } catch (_: RuntimeException) { fallback(request) }
              }
              animator.addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                  if (pending !== request) return
                  if (!owns(request)) { cancelRequest(request); return }
                  if (controller.isReady) {
                    finishAfterLayout(request, controller)
                  }
                }
              })
              animator.start()
            } catch (_: RuntimeException) { fallback(request) }
          }

          override fun onFinished(controller: WindowInsetsAnimationController) {
            if (pending === request && !request.fallback) complete(request, owns(request))
          }

          override fun onCancelled(controller: WindowInsetsAnimationController?) {
            if (pending === request && !request.fallback) fallback(request)
          }
        },
      )
    } catch (_: RuntimeException) { fallback(request) }
  }

  private fun finishAfterLayout(request: HideRequest, controller: WindowInsetsAnimationController) {
    if (hiddenLayoutHeight == 0) {
      try { controller.finish(false) } catch (_: RuntimeException) { fallback(request) }
      return
    }
    // FrameCommit is a hardware-renderer contract. An unsupported window uses
    // the existing system hide path, never a posted Runnable as a fake commit.
    if (!isHardwareAccelerated) { fallback(request); return }
    // Insets progress precedes Fabric's native layout. The controlled IME can
    // already be at zero while the submitted App buffer still has the old panel.
    // Wait for this panel's actual endpoint, then the buffer containing that draw.
    fun layoutReady() = imeProgressBottom == controller.hiddenStateInsets.bottom &&
      abs(height - hiddenLayoutHeight) <= 1 && abs(translationY) < 0.5f && !isLayoutRequested
    val listener = ViewTreeObserver.OnPreDrawListener {
      if (pending === request) {
        if (!owns(request)) cancelRequest(request)
        else if (!layoutReady()) clearFrameCommit(request)
        else if (controller.isReady && request.commitCallback == null) {
          val targetHeight = hiddenLayoutHeight
          val observer = viewTreeObserver
          val callback = object : Runnable {
            override fun run() {
              val committed = this
              post {
                if (pending !== request || request.commitCallback !== committed) return@post
                clearFrameCommit(request)
                if (!owns(request)) { cancelRequest(request); return@post }
                if (hiddenLayoutHeight != targetHeight || !layoutReady()) {
                  postInvalidateOnAnimation()
                  return@post
                }
                if (controller.isReady) {
                  try { controller.finish(false) } catch (_: RuntimeException) { fallback(request) }
                }
              }
            }
          }
          request.commitObserver = observer
          request.commitCallback = callback
          try { registerFrameCommit(observer, callback) } catch (_: RuntimeException) { fallback(request) }
        }
      }
      true
    }
    request.drawListener = listener
    request.drawObserver = viewTreeObserver.also { it.addOnPreDrawListener(listener) }
    postInvalidateOnAnimation()
  }

  private fun clearFrameCommit(request: HideRequest) {
    request.commitCallback?.let { callback ->
      if (Build.VERSION.SDK_INT >= 29) {
        request.commitObserver?.takeIf { it.isAlive }?.unregisterFrameCommitCallback(callback)
      }
      removeCallbacks(callback)
    }
    request.commitObserver = null
    request.commitCallback = null
  }

  private fun clearDrawWait(request: HideRequest) {
    clearFrameCommit(request)
    request.drawListener?.let { listener ->
      request.drawObserver?.takeIf { it.isAlive }?.removeOnPreDrawListener(listener)
    }
    request.drawObserver = null
    request.drawListener = null
  }

  private fun stopAnimator(request: HideRequest) {
    request.animator?.let {
      // cancel() also invokes onAnimationEnd; remove it before relinquishing the old owner.
      it.removeAllUpdateListeners()
      it.removeAllListeners()
      it.cancel()
    }
    request.animator = null
  }

  private fun complete(request: HideRequest, success: Boolean) {
    if (pending !== request) return
    pending = null
    stopAnimator(request)
    clearDrawWait(request)
    request.commands.forEach { emitKeyboardHidden(it, success) }
    request.commands.clear()
  }

  private fun cancelRequest(request: HideRequest) {
    if (pending !== request) return
    complete(request, false)
    request.signal.cancel()
  }

  private fun fallback(request: HideRequest) {
    if (pending !== request) return
    if (!owns(request)) { cancelRequest(request); return }
    request.fallback = true
    stopAnimator(request)
    clearDrawWait(request)
    request.signal.cancel()
    if (!standardHide(request.focus, request.token)) { complete(request, false); return }
    if (pending !== request) return
    val listener = ViewTreeObserver.OnPreDrawListener {
      if (pending === request) {
        if (!owns(request)) cancelRequest(request)
        else if (hasHiddenImeLayout()) {
          if (request.hiddenLayoutReady) complete(request, true)
          else {
            request.hiddenLayoutReady = true
            postInvalidateOnAnimation()
          }
        } else request.hiddenLayoutReady = false
      }
      true
    }
    request.drawListener = listener
    request.drawObserver = viewTreeObserver.also { it.addOnPreDrawListener(listener) }
    postInvalidateOnAnimation()
  }

  private fun standardHide(focus: View, token: IBinder): Boolean {
    if (!windowAvailable() || findFocus() !== focus || windowToken != token) return false
    return try {
      if (Build.VERSION.SDK_INT >= 30 && windowInsetsController != null) {
        windowInsetsController!!.hide(WindowInsets.Type.ime())
      } else {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(token, 0)
      }
      true
    } catch (_: RuntimeException) { false }
  }

  protected open fun emitKeyboardHidden(requestId: Double, success: Boolean) {
    val reactContext = context as ThemedReactContext
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(
      KeyboardHiddenEvent(UIManagerHelper.getSurfaceId(reactContext), id, requestId, success),
    )
  }

  protected open fun emitImeInsets(bottom: Double) {
    val reactContext = context as ThemedReactContext
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(
      ImeInsetsEvent(UIManagerHelper.getSurfaceId(reactContext), id, bottom),
    )
  }

  companion object {
    private val HIDE_INTERPOLATOR = PathInterpolator(0.2f, 0f, 0f, 1f)
  }
}

class ComposerKeyboardHostManager : ReactViewManager() {
  override fun getName() = "WzComposerKeyboardHost"
  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup = ComposerKeyboardHost(context)

  @ReactProp(name = "enabled", defaultBoolean = false)
  fun setEnabled(view: ReactViewGroup, enabled: Boolean) = (view as ComposerKeyboardHost).setHostEnabled(enabled)

  @ReactProp(name = "trackImeInsets", defaultBoolean = false)
  fun setTrackImeInsets(view: ReactViewGroup, value: Boolean) = (view as ComposerKeyboardHost).setTrackImeInsets(value)

  @ReactProp(name = "hiddenLayoutHeight", defaultFloat = 0f)
  fun setHiddenLayoutHeight(view: ReactViewGroup, value: Float) = (view as ComposerKeyboardHost).setHiddenLayoutHeight(value)

  override fun onDropViewInstance(view: ReactViewGroup) {
    (view as ComposerKeyboardHost).setHostEnabled(false)
    super.onDropViewInstance(view)
  }

  override fun getCommandsMap(): MutableMap<String, Int> = super.getCommandsMap().apply {
    put("hideKeyboard", 1001)
    put("cancelHide", 1002)
  }

  override fun receiveCommand(view: ReactViewGroup, commandId: String, args: ReadableArray?) {
    if (commandId != "hideKeyboard" && commandId != "cancelHide") {
      super.receiveCommand(view, commandId, args)
      return
    }
    require(args != null && args.size() == 1 && args.getType(0) == ReadableType.Number) {
      "$commandId requires one numeric requestId"
    }
    val requestId = args.getDouble(0)
    require(requestId.isFinite() && requestId >= 0 && requestId <= 9007199254740991.0 && requestId % 1.0 == 0.0)
    if (commandId == "hideKeyboard") (view as ComposerKeyboardHost).hideKeyboard(requestId)
    else (view as ComposerKeyboardHost).cancelHide(requestId)
  }

  @Suppress("DEPRECATION")
  override fun receiveCommand(view: ReactViewGroup, commandId: Int, args: ReadableArray?) {
    when (commandId) {
      1001 -> receiveCommand(view, "hideKeyboard", args)
      1002 -> receiveCommand(view, "cancelHide", args)
      else -> super.receiveCommand(view, commandId, args)
    }
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
      put(HIDDEN_EVENT, mapOf("registrationName" to "onKeyboardHidden"))
      put(INSETS_EVENT, mapOf("registrationName" to "onImeInsets"))
    }
}
