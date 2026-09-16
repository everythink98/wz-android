package com.wz.reader

import android.view.View
import android.view.WindowInsetsAnimation
import android.view.WindowInsets
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.reactnativecommunity.webview.RNCWebViewWrapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class ComposerWebViewInsetsTest {
    @Test
    fun nativeViewportOwnsImeButOtherWebViewsKeepTheirInsets() {
        val context = RuntimeEnvironment.getApplication()
        val wrapper = FrameLayout(context)
        val child = View(context)
        wrapper.addView(child)
        var received = WindowInsetsCompat.CONSUMED
        ViewCompat.setOnApplyWindowInsetsListener(child) { _, insets -> received = insets; insets }
        val original = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 336))
            .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 16))
            .build()
        child.setWindowInsetsAnimationCallback(object : WindowInsetsAnimation.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            override fun onProgress(insets: WindowInsets, runningAnimations: MutableList<WindowInsetsAnimation>): WindowInsets {
                received = WindowInsetsCompat.toWindowInsetsCompat(insets)
                return insets
            }
        })
        RNCWebViewWrapper.setAutomaticallyAdjustContentInsets(wrapper, false)
        wrapper.dispatchApplyWindowInsets(original.toWindowInsets()!!)
        assertEquals(0, received.getInsets(WindowInsetsCompat.Type.ime()).bottom)
        assertEquals(24, received.getInsets(WindowInsetsCompat.Type.statusBars()).top)
        assertFalse(received.isConsumed)
        assertEquals(336, original.getInsets(WindowInsetsCompat.Type.ime()).bottom)
        for (height in listOf(336, 240, 80, 0, 40, 336)) {
            val frame = WindowInsetsCompat.Builder(original)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, height)).build()
            wrapper.dispatchApplyWindowInsets(frame.toWindowInsets()!!)
            assertEquals(0, received.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            wrapper.dispatchWindowInsetsAnimationProgress(frame.toWindowInsets()!!, mutableListOf())
            assertEquals(0, received.getInsets(WindowInsetsCompat.Type.ime()).bottom)
        }
        RNCWebViewWrapper.setAutomaticallyAdjustContentInsets(wrapper, true)
        wrapper.dispatchApplyWindowInsets(original.toWindowInsets()!!)
        assertEquals(336, received.getInsets(WindowInsetsCompat.Type.ime()).bottom)
    }
}
