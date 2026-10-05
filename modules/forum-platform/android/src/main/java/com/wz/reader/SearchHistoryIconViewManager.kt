package com.wz.reader

import android.content.res.ColorStateList
import android.view.View
import android.widget.ImageView
import com.facebook.react.bridge.JSApplicationIllegalArgumentException
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.wz.reader.platform.R

class SearchHistoryIconViewManager : SimpleViewManager<ImageView>() {
  override fun getName(): String = "WzSearchHistoryIcon"

  override fun createViewInstance(reactContext: ThemedReactContext): ImageView =
    ImageView(reactContext).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

  @ReactProp(name = "icon")
  fun setIcon(view: ImageView, icon: String?) {
    val resource = when (icon) {
      null, "" -> 0
      "history" -> R.drawable.wz_search_history
      "close" -> R.drawable.wz_search_close
      else -> throw JSApplicationIllegalArgumentException("Unknown search history icon: $icon")
    }
    view.setImageResource(resource)
  }

  @ReactProp(name = "color", customType = "Color")
  fun setColor(view: ImageView, color: Int?) {
    view.imageTintList = color?.let { ColorStateList.valueOf(it) }
  }
}
