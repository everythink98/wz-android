package com.wz.reader

import android.app.Activity
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.views.view.ReactViewGroup
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class RetainedTabSceneTest {
  @Test
  fun hidingOnlyTheTabWithTheFocusedEditorDismissesItsKeyboard() {
    ReactNativeFeatureFlagsForTests.setUp()
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    try {
      val activity = controller.get()
      val root = FrameLayout(activity)
      val search = ReactViewGroup(activity)
      val messages = ReactViewGroup(activity)
      val editor = EditText(activity)
      search.addView(editor)
      root.addView(search)
      root.addView(messages)
      activity.setContentView(root)
      val input = activity.getSystemService(InputMethodManager::class.java)
      val manager = RetainedTabSceneManager()
      assertTrue(editor.requestFocus())
      input.showSoftInput(editor, 0)
      assertTrue(shadowOf(input).isSoftInputVisible)
      manager.setInactive(messages, true)
      assertTrue(shadowOf(input).isSoftInputVisible)
      manager.setInactive(search, true)
      assertFalse(shadowOf(input).isSoftInputVisible)
      manager.setInactive(search, false)
      assertTrue(editor.requestFocus())
      input.showSoftInput(editor, 0)
      assertTrue(shadowOf(input).isSoftInputVisible)
    } finally {
      controller.pause().stop().destroy()
    }
  }
}
