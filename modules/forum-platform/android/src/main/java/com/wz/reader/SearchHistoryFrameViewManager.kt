package com.wz.reader

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class SearchHistoryFrameView(context: Context) : View(context) {
  internal var surfaceColor: Int = Color.TRANSPARENT
  internal var lineColor: Int = Color.TRANSPARENT
  internal var lineWidth: Float = 0f
  internal var cornerRadius: Float = 0f
  internal var roundTop: Boolean = false
  internal var roundBottom: Boolean = false
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  override fun onDraw(canvas: Canvas) {
    val density = resources.displayMetrics.density
    val line = lineWidth * density
    val radius = cornerRadius * density
    val bottom = height.toFloat()
    paint.color = lineColor
    drawArea(canvas, 0f, 0f, bottom, radius)
    paint.color = surfaceColor
    drawArea(canvas, line, line, if (roundBottom) bottom - line else bottom, radius - line)
  }

  private fun drawArea(canvas: Canvas, inset: Float, top: Float, bottom: Float, radius: Float) {
    val right = width - inset
    if ((!roundTop && !roundBottom) || radius <= 0f) {
      canvas.drawRect(inset, top, right, bottom, paint)
      return
    }

    // Clip only to a rectangle. Extending the joined edge preserves square joins without path clipping.
    val saved = canvas.save()
    canvas.clipRect(inset, top, right, bottom)
    val roundedTop = if (roundTop) top else top - radius
    val roundedBottom = if (roundBottom) bottom else bottom + radius
    canvas.drawRoundRect(inset, roundedTop, right, roundedBottom, radius, radius, paint)
    canvas.restoreToCount(saved)
  }
}

class SearchHistoryFrameViewManager : SimpleViewManager<SearchHistoryFrameView>() {
  override fun getName(): String = "WzSearchHistoryFrame"

  override fun createViewInstance(reactContext: ThemedReactContext): SearchHistoryFrameView =
    SearchHistoryFrameView(reactContext).apply {
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

  @ReactProp(name = "surfaceColor", customType = "Color")
  fun setSurfaceColor(view: SearchHistoryFrameView, color: Int) { view.surfaceColor = color }

  @ReactProp(name = "lineColor", customType = "Color")
  fun setLineColor(view: SearchHistoryFrameView, color: Int) { view.lineColor = color }

  @ReactProp(name = "lineWidth")
  fun setLineWidth(view: SearchHistoryFrameView, width: Float) { view.lineWidth = width }

  @ReactProp(name = "cornerRadius")
  fun setCornerRadius(view: SearchHistoryFrameView, radius: Float) { view.cornerRadius = radius }

  @ReactProp(name = "roundTop")
  fun setRoundTop(view: SearchHistoryFrameView, round: Boolean) { view.roundTop = round }

  @ReactProp(name = "roundBottom")
  fun setRoundBottom(view: SearchHistoryFrameView, round: Boolean) { view.roundBottom = round }

  override fun onAfterUpdateTransaction(view: SearchHistoryFrameView) {
    super.onAfterUpdateTransaction(view)
    view.invalidate()
  }
}
