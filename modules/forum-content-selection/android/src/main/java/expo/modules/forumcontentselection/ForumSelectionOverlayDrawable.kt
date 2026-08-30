package expo.modules.forumcontentselection

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.drawable.Drawable
import kotlin.math.max
import kotlin.math.min

internal class ForumSelectionHandleDrawable(
  density: Float,
  handleColor: Int,
  private val prefersBelow: Boolean
) : Drawable() {
  private val radius = 6f * density
  private val stem = 10f * density
  private val stemWidth = 3f * density
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = handleColor
    style = Paint.Style.FILL
    strokeWidth = stemWidth
    strokeCap = Paint.Cap.ROUND
  }
  private var anchor = PointF()
  private var circle = PointF()
  private var drawableVisible = false

  fun update(point: PointF, width: Int, height: Int) {
    setBounds(0, 0, width, height)
    drawableVisible = width >= radius * 2f && height >= radius * 2f
    if (!drawableVisible) {
      invalidateSelf()
      return
    }

    val anchorY = point.y.coerceIn(0f, height.toFloat())
    val above = anchorY
    val below = height - anchorY
    val fullExtent = stem + radius
    val pointsBelow = when {
      prefersBelow && below >= fullExtent -> true
      !prefersBelow && above >= fullExtent -> false
      below >= fullExtent -> true
      above >= fullExtent -> false
      else -> below >= above
    }
    val available = if (pointsBelow) below else above
    if (available < radius) {
      drawableVisible = false
      invalidateSelf()
      return
    }

    val circleX = point.x.coerceIn(radius, width - radius)
    val stemLength = min(stem, max(0f, available - radius))
    val direction = if (pointsBelow) 1f else -1f
    anchor = PointF(point.x.coerceIn(0f, width.toFloat()), anchorY)
    circle = PointF(circleX, anchorY + direction * stemLength)
    invalidateSelf()
  }

  override fun draw(canvas: Canvas) {
    if (!drawableVisible) return
    canvas.drawLine(anchor.x, anchor.y, anchor.x, circle.y, paint)
    canvas.drawCircle(circle.x, circle.y, radius, paint)
  }

  internal fun anchorForTest(): PointF = PointF(anchor.x, anchor.y)

  override fun setAlpha(alpha: Int) {
    paint.alpha = alpha
    invalidateSelf()
  }

  override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
    paint.colorFilter = colorFilter
    invalidateSelf()
  }

  @Deprecated("Deprecated in the Android Drawable API")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

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
