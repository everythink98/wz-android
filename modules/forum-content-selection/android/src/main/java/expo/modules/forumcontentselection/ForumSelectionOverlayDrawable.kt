package expo.modules.forumcontentselection

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.view.View
import android.widget.TextView
import kotlin.math.roundToInt

internal class ForumSelectionHighlightDrawable(highlightColor: Int) : Drawable() {
  private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = highlightColor
    style = Paint.Style.FILL
  }
  private val highlightPath = Path()

  fun update(path: Path, width: Int, height: Int) {
    highlightPath.set(path)
    setBounds(0, 0, width, height)
    invalidateSelf()
  }

  override fun draw(canvas: Canvas) {
    canvas.drawPath(highlightPath, highlightPaint)
  }

  override fun setAlpha(alpha: Int) {
    highlightPaint.alpha = alpha
    invalidateSelf()
  }

  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
    highlightPaint.colorFilter = colorFilter
    invalidateSelf()
  }

  @Deprecated("Deprecated in the Android Drawable API")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

internal class ForumSelectionPlatformHandleDrawable(
  private val sourceView: TextView,
  private val overlayHost: View,
  private val platformDrawable: Drawable,
  private val hotspotQuarter: Int
) : Drawable() {
  private val sourceScreenLocation = IntArray(2)
  private val hostScreenLocation = IntArray(2)
  private val sourceVisibleRect = Rect()
  private val contentPoint = PointF()

  fun update(point: PointF) {
    contentPoint.set(point)
    setBounds(0, 0, overlayHost.width, overlayHost.height)
    invalidateSelf()
  }

  internal fun hotspotQuarterForTest(): Int = hotspotQuarter

  override fun draw(canvas: Canvas) {
    if (!sourceView.isAttachedToWindow || !sourceView.isShown || !overlayHost.isAttachedToWindow) return
    val width = platformDrawable.intrinsicWidth
    val height = platformDrawable.intrinsicHeight
    if (width <= 0 || height <= 0) return

    sourceView.getLocationOnScreen(sourceScreenLocation)
    val hotspotScreenX = sourceScreenLocation[0] + contentPoint.x - sourceView.scrollX
    val hotspotScreenY = sourceScreenLocation[1] + contentPoint.y - sourceView.scrollY
    if (
      !sourceView.getLocalVisibleRect(sourceVisibleRect) ||
      contentPoint.x < sourceVisibleRect.left || contentPoint.x > sourceVisibleRect.right ||
      contentPoint.y < sourceVisibleRect.top || contentPoint.y > sourceVisibleRect.bottom
    ) return
    overlayHost.getLocationOnScreen(hostScreenLocation)
    val hotspotX = hotspotScreenX - hostScreenLocation[0] + overlayHost.scrollX
    val hotspotY = hotspotScreenY - hostScreenLocation[1] + overlayHost.scrollY
    val left = (hotspotX - width * hotspotQuarter / 4f).roundToInt()
    val top = hotspotY.roundToInt()
    platformDrawable.setBounds(left, top, left + width, top + height)
    platformDrawable.draw(canvas)
  }

  override fun setAlpha(alpha: Int) {
    platformDrawable.alpha = alpha
    invalidateSelf()
  }

  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
    platformDrawable.colorFilter = colorFilter
    invalidateSelf()
  }

  @Deprecated("Deprecated in the Android Drawable API")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
