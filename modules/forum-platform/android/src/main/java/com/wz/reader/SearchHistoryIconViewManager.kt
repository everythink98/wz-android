package com.wz.reader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.util.LruCache
import android.view.View
import android.widget.ImageView
import com.facebook.react.bridge.JSApplicationIllegalArgumentException
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.wz.reader.platform.R

internal data class SearchHistoryIconStyle(val resource: Int, val color: Int?, val densityDpi: Int)

class SearchHistoryIconView(context: Context) : ImageView(context) {
  internal var iconResource = 0
  internal var iconColor: Int? = null
  internal var displayedStyle: SearchHistoryIconStyle? = null
}

class SearchHistoryIconViewManager : SimpleViewManager<SearchHistoryIconView>() {
  private val tintedIcons by lazy { LruCache<SearchHistoryIconStyle, Bitmap>(4) }

  override fun getName(): String = "WzSearchHistoryIcon"

  override fun createViewInstance(reactContext: ThemedReactContext): SearchHistoryIconView =
    SearchHistoryIconView(reactContext).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

  @ReactProp(name = "icon")
  fun setIcon(view: SearchHistoryIconView, icon: String?) {
    view.iconResource = when (icon) {
      null, "" -> 0
      "history" -> R.drawable.wz_search_history
      "close" -> R.drawable.wz_search_close
      else -> throw JSApplicationIllegalArgumentException("Unknown search history icon: $icon")
    }
  }

  @ReactProp(name = "color", customType = "Color")
  fun setColor(view: SearchHistoryIconView, color: Int?) {
    view.iconColor = color
  }

  override fun onAfterUpdateTransaction(view: SearchHistoryIconView) {
    super.onAfterUpdateTransaction(view)
    val style = SearchHistoryIconStyle(view.iconResource, view.iconColor, view.resources.displayMetrics.densityDpi)
    if (view.displayedStyle == style) return
    view.displayedStyle = style
    val color = style.color
    if (style.resource == 0 || color == null) {
      view.setImageResource(style.resource)
      return
    }

    // All rows at this density and theme use the same pixels without a GPU color filter.
    val bitmap = tintedIcons[style] ?: run {
      val source = BitmapFactory.decodeResource(view.resources, style.resource)
      val colored = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888).apply {
        density = source.density
      }
      val paint = Paint().apply { colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN) }
      Canvas(colored).drawBitmap(source, 0f, 0f, paint)
      tintedIcons.put(style, colored)
      colored
    }
    view.setImageBitmap(bitmap)
  }
}
