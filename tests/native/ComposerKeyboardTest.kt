package com.wz.reader

import android.util.DisplayMetrics
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.swmansion.reanimated.keyboard.Keyboard
import com.swmansion.reanimated.keyboard.KeyboardAnimationCallback
import com.swmansion.reanimated.keyboard.KeyboardState
import com.swmansion.reanimated.keyboard.NotifyAboutKeyboardChangeFunction
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class ComposerKeyboardTest {
    private fun insets(height: Int) = object : WindowInsetsCompat(null as WindowInsetsCompat?) {
        override fun getInsets(typeMask: Int): Insets = Insets.of(0, 0, 0, height)
    }

    @Test
    fun prepareOwnsTheTransitionBeforeAndroidAppliesItsTargetInsets() {
        DisplayMetricsHolder.setWindowDisplayMetrics(DisplayMetrics().apply { density = 1f })
        DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply { density = 1f })
        val keyboard = Keyboard()
        keyboard.onAnimationStart()
        keyboard.updateHeight(insets(336), true)
        keyboard.onAnimationEnd()
        assertEquals(KeyboardState.OPEN, keyboard.getState())
        val callback = KeyboardAnimationCallback(keyboard, NotifyAboutKeyboardChangeFunction {}, true) { insets(0) }
        callback.onPrepare(WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 250))
        assertEquals(336, keyboard.getHeight())
        assertEquals(KeyboardState.CLOSING, keyboard.getState())
    }

    @Test
    fun interruptedPickerHideReconcilesToTheWindowBeforeReopening() {
        DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply { density = 1f })
        val keyboard = Keyboard()
        keyboard.updateHeight(insets(336), true)
        var restingInsets = insets(0)
        val observations = mutableListOf<Pair<KeyboardState, Int>>()
        val callback = KeyboardAnimationCallback(keyboard, NotifyAboutKeyboardChangeFunction {
            observations.add(keyboard.getState() to keyboard.getHeight())
        }, true) { restingInsets }
        val hide = WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 250)
        callback.onPrepare(hide)
        callback.onProgress(insets(142), listOf(hide))
        callback.onEnd(hide)
        assertEquals(KeyboardState.CLOSED to 0, observations.last())
        val show = WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 250)
        callback.onPrepare(show)
        assertEquals(KeyboardState.OPENING, keyboard.getState())
        assertEquals(0, keyboard.getHeight())
        callback.onProgress(insets(30), listOf(show))
        assertEquals(KeyboardState.OPENING to 30, observations.last())
        restingInsets = insets(336)
        callback.onEnd(show)
        assertEquals(KeyboardState.OPEN to 336, observations.last())
    }

    @Test
    fun interruptedAnimationDoesNotApplyTheNextAnimationsTargetEarly() {
        DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics().apply { density = 1f })
        val keyboard = Keyboard()
        keyboard.updateHeight(insets(336), true)
        val callback = KeyboardAnimationCallback(keyboard, NotifyAboutKeyboardChangeFunction {}, true) { insets(336) }
        val hide = WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 250)
        val show = WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 250)
        callback.onPrepare(hide)
        callback.onProgress(insets(142), listOf(hide))
        callback.onPrepare(show)
        callback.onEnd(hide)
        assertEquals(142, keyboard.getHeight())
        assertEquals(KeyboardState.OPENING, keyboard.getState())
        callback.onProgress(insets(200), listOf(show))
        callback.onEnd(show)
        assertEquals(336, keyboard.getHeight())
        assertEquals(KeyboardState.OPEN, keyboard.getState())
    }
}
