package com.wz.reader

import android.app.Activity
import android.graphics.Rect
import android.os.Looper
import android.view.View
import android.webkit.WebView
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup
import com.reactnativecommunity.webview.RNCWebView
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.android.controller.ActivityController
import java.lang.reflect.Proxy
import java.time.Duration

/** Real RNCWebView lifecycle owner; only GPU work and its asynchronous completion are controlled. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class ComposerWebViewPrewarmTest {
    private lateinit var activity: ActivityController<Activity>
    private lateinit var root: View
    private lateinit var content: ReactViewGroup
    private lateinit var web: ControlledWebView

    @Before
    fun setUp() {
        val application = RuntimeEnvironment.getApplication()
        activity = Robolectric.buildActivity(Activity::class.java).setup().visible()
        val react = object : BridgeReactContext(application) {
            override fun <T : JavaScriptModule> getJSModule(type: Class<T>): T =
                requireNotNull(type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, _, _ -> null }))
        }
        val themedContext = ThemedReactContext(react, activity.get(), "ComposerProof", 1)
        content = ReactViewGroup(themedContext).apply { overflow = "hidden" }
        web = ControlledWebView(themedContext)
        content.addView(web)
        activity.get().setContentView(content)
        content.layout(0, 0, 400, 600)
        // Robolectric's WebView provider does not implement WebView.setFrame delegation.
        // Set the real View bounds directly; the production owner still reads getWidth/getHeight.
        web.right = 400
        web.bottom = 600
        root = web.rootView
        assertTrue("The lifecycle oracle requires a real attached window", web.isAttachedToWindow)
        assertSame(activity.get().window.decorView, root)
        assertEquals(400, web.width)
        assertEquals(600, web.height)
        assertFalse("RN overflow must not be replaced with Android clipChildren", content.clipChildren)
        assertTrue(web.isShown)
        assertTrue(web.getGlobalVisibleRect(Rect()))
    }

    @After
    fun tearDown() {
        if (::web.isInitialized && !web.destroyed) web.destroy()
        if (::activity.isInitialized) activity.pause().stop().destroy()
    }

    private fun enable(value: Boolean = true) {
        web.setAndroidPrewarmOnWindowVisible(value)
    }

    private fun returnToWindow() {
        web.window(View.VISIBLE)
        web.window(View.GONE)
        web.window(View.VISIBLE)
    }

    private fun drawCanceled(): Boolean = root.viewTreeObserver.dispatchOnPreDraw()

    @Test
    fun defaultWebViewsAndFirstAttachmentDoNotDelayWindowDrawing() {
        returnToWindow()
        assertFalse(drawCanceled())
        assertTrue(web.warmedLayers.isEmpty())
        web.detach()
        enable()
        web.window(View.INVISIBLE)
        web.window(View.VISIBLE)
        assertFalse(drawCanceled())
        assertTrue(web.warmedLayers.isEmpty())
    }

    @Test
    fun returningEditorWarmsOnceBeforeAllowingTheWindowToDraw() {
        enable()
        returnToWindow()
        assertTrue(web.warmedLayers.isEmpty())
        assertTrue("The returning window must wait for its WebView's visual state", drawCanceled())
        assertEquals(listOf(View.LAYER_TYPE_HARDWARE), web.warmedLayers)
        assertEquals(View.LAYER_TYPE_HARDWARE, web.layerType)
        assertTrue(drawCanceled())
        assertEquals(1, web.callbacks.size)
        web.complete(0)
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
    }

    @Test
    fun aGoneReactAncestorDoesNotDelayTheReturningWindow() {
        enable()
        content.visibility = View.GONE
        returnToWindow()
        assertFalse(web.isShown)
        assertFalse(drawCanceled())
        assertTrue(web.warmedLayers.isEmpty())
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
    }

    @Test
    fun anEditorTranslatedOutsideTheWindowDoesNotWarmUntilItReturnsOnScreen() {
        enable()
        content.translationY = (root.height + web.height + 1).toFloat()
        returnToWindow()
        assertTrue(web.isShown)
        assertFalse(web.getGlobalVisibleRect(Rect()))
        assertFalse(drawCanceled())
        assertTrue(web.warmedLayers.isEmpty())
        content.translationY = 0f
        returnToWindow()
        assertTrue(web.getGlobalVisibleRect(Rect()))
        assertTrue(drawCanceled())
        assertEquals(listOf(View.LAYER_TYPE_HARDWARE), web.warmedLayers)
        web.complete(0)
        assertFalse(drawCanceled())
    }

    @Test
    fun disablingRestoresTheLayerAndOldCallbacksCannotReleaseTheNextReturn() {
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        enable(false)
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        web.complete(0)
        assertEquals(View.LAYER_TYPE_HARDWARE, web.layerType)
        assertTrue(drawCanceled())
        web.complete(1)
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
    }

    @Test
    fun hidingAgainReleasesTheOldGateAndKeepsItsCallbackOutOfTheNextReturn() {
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        web.window(View.GONE)
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
        web.window(View.VISIBLE)
        assertTrue(drawCanceled())
        web.complete(0)
        assertTrue(drawCanceled())
        web.complete(1)
        assertFalse(drawCanceled())
    }

    @Test
    fun detachingReleasesTheWindowAndTheNextAttachmentIsInitialAgain() {
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        web.detach()
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
        web.window(View.INVISIBLE)
        web.window(View.VISIBLE)
        web.complete(0)
        assertFalse(drawCanceled())
        assertEquals(1, web.warmedLayers.size)
    }

    @Test
    fun destroyingRestoresTheLayerAndCannotStartAnotherGate() {
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        web.destroy()
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
        web.complete(0)
        returnToWindow()
        assertFalse(drawCanceled())
        assertEquals(1, web.warmedLayers.size)
    }

    @Test
    fun missingVisualCompletionFailsOpenAfterTheBoundedDeadlineAndCanRetry() {
        enable()
        returnToWindow()
        assertTrue(drawCanceled())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1999))
        assertTrue(drawCanceled())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))
        assertEquals(View.LAYER_TYPE_NONE, web.layerType)
        assertFalse(drawCanceled())
        returnToWindow()
        assertTrue(drawCanceled())
        web.complete(0)
        assertTrue(drawCanceled())
        web.complete(1)
        assertFalse(drawCanceled())
    }

    @Test
    fun drawingFailureRestoresTheOriginalLayerAndDoesNotBlockTheWindow() {
        web.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        web.failBuild = true
        enable()
        returnToWindow()
        assertFalse(drawCanceled())
        assertEquals(listOf(View.LAYER_TYPE_HARDWARE), web.warmedLayers)
        assertEquals(View.LAYER_TYPE_SOFTWARE, web.layerType)
        assertTrue(web.callbacks.isEmpty())
    }

    private class ControlledWebView(context: ThemedReactContext) : RNCWebView(context) {
        val warmedLayers = mutableListOf<Int>()
        val callbacks = mutableListOf<Pair<Long, WebView.VisualStateCallback>>()
        var failBuild = false
        var destroyed = false
        private var windowState = View.INVISIBLE

        override fun isHardwareAccelerated() = true
        override fun getWindowVisibility() = windowState

        fun window(visibility: Int) {
            windowState = visibility
            super.onWindowVisibilityChanged(visibility)
        }

        fun detach() = super.onDetachedFromWindow()

        override fun buildLayer() {
            warmedLayers.add(layerType)
            if (failBuild) throw IllegalStateException("controlled GPU failure")
        }

        override fun postVisualStateCallback(requestId: Long, callback: WebView.VisualStateCallback) {
            callbacks.add(requestId to callback)
        }

        fun complete(index: Int) {
            val (id, callback) = callbacks[index]
            callback.onComplete(id)
        }

        override fun destroy() {
            super.destroy()
            destroyed = true
        }
    }
}
