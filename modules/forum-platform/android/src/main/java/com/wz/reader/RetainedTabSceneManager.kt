package com.wz.reader

import android.view.View
import android.view.inputmethod.InputMethodManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

class RetainedTabSceneManager : ReactViewManager() {
  override fun getName() = "WzRetainedTabScene"

  @ReactProp(name = "inactive", defaultBoolean = false)
  fun setInactive(view: ReactViewGroup, inactive: Boolean) {
    if (inactive) {
      val editor = view.findFocus()
      if (editor != null && editor.onCheckIsTextEditor() && view.rootView.findFocus() === editor) {
        // Cancel the editor's pending IME show before hiding the scene clears its focus.
        editor.windowToken?.let { token ->
          editor.context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(token, 0)
        }
        editor.clearFocus()
      }
    }
    view.visibility = if (inactive) View.INVISIBLE else View.VISIBLE
  }
}
