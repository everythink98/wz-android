const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

function previewRegionImageSource(packageName) {
  return `package ${packageName}

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.media.ExifInterface
import android.os.Handler
import android.os.Looper
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

internal data class NormalizedViewport(
  val x: Double,
  val y: Double,
  val width: Double,
  val height: Double,
)

internal data class PixelPoint(val x: Double, val y: Double)

internal data class PixelRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val width: Int get() = right - left
  val height: Int get() = bottom - top
}

internal data class PixelSize(val width: Int, val height: Int)

internal object PreviewRegionMath {
  fun normalize(viewport: NormalizedViewport): NormalizedViewport {
    val x = unit(viewport.x)
    val y = unit(viewport.y)
    val right = unit(x + positive(viewport.width, 1.0))
    val bottom = unit(y + positive(viewport.height, 1.0))
    if (right <= x || bottom <= y) {
      return NormalizedViewport(0.0, 0.0, 1.0, 1.0)
    }
    return NormalizedViewport(x, y, right - x, bottom - y)
  }

  fun encodedPoint(u: Double, v: Double, orientation: Int): PixelPoint =
    when (validOrientation(orientation)) {
      2 -> PixelPoint(1.0 - u, v)
      3 -> PixelPoint(1.0 - u, 1.0 - v)
      4 -> PixelPoint(u, 1.0 - v)
      5 -> PixelPoint(v, u)
      6 -> PixelPoint(v, 1.0 - u)
      7 -> PixelPoint(1.0 - v, 1.0 - u)
      8 -> PixelPoint(1.0 - v, u)
      else -> PixelPoint(u, v)
    }

  fun uprightPoint(
    encodedX: Double,
    encodedY: Double,
    sourceWidth: Int,
    sourceHeight: Int,
    orientation: Int,
  ): PixelPoint {
    val x = encodedX / sourceWidth
    val y = encodedY / sourceHeight
    val normalized =
      when (validOrientation(orientation)) {
        2 -> PixelPoint(1.0 - x, y)
        3 -> PixelPoint(1.0 - x, 1.0 - y)
        4 -> PixelPoint(x, 1.0 - y)
        5 -> PixelPoint(y, x)
        6 -> PixelPoint(1.0 - y, x)
        7 -> PixelPoint(1.0 - y, 1.0 - x)
        8 -> PixelPoint(y, 1.0 - x)
        else -> PixelPoint(x, y)
      }
    val size = uprightSize(sourceWidth, sourceHeight, orientation)
    return PixelPoint(normalized.x * size.width, normalized.y * size.height)
  }

  fun encodedRect(
    sourceWidth: Int,
    sourceHeight: Int,
    orientation: Int,
    rawViewport: NormalizedViewport,
  ): PixelRect {
    val viewport = normalize(rawViewport)
    val right = viewport.x + viewport.width
    val bottom = viewport.y + viewport.height
    val points =
      arrayOf(
        encodedPoint(viewport.x, viewport.y, orientation),
        encodedPoint(right, viewport.y, orientation),
        encodedPoint(viewport.x, bottom, orientation),
        encodedPoint(right, bottom, orientation),
      )
    val left =
      floor(points.minOf { it.x } * sourceWidth + EDGE_EPSILON).toInt().coerceIn(0, sourceWidth - 1)
    val top =
      floor(points.minOf { it.y } * sourceHeight + EDGE_EPSILON).toInt().coerceIn(0, sourceHeight - 1)
    val encodedRight =
      ceil(points.maxOf { it.x } * sourceWidth - EDGE_EPSILON).toInt().coerceIn(left + 1, sourceWidth)
    val encodedBottom =
      ceil(points.maxOf { it.y } * sourceHeight - EDGE_EPSILON).toInt().coerceIn(top + 1, sourceHeight)
    return PixelRect(left, top, encodedRight, encodedBottom)
  }

  fun expand(rect: PixelRect, sourceWidth: Int, sourceHeight: Int): PixelRect =
    PixelRect(
      max(0, rect.left - 1),
      max(0, rect.top - 1),
      min(sourceWidth, rect.right + 1),
      min(sourceHeight, rect.bottom + 1),
    )

  fun uprightSize(sourceWidth: Int, sourceHeight: Int, orientation: Int): PixelSize =
    if (validOrientation(orientation) in 5..8) {
      PixelSize(sourceHeight, sourceWidth)
    } else {
      PixelSize(sourceWidth, sourceHeight)
    }

  fun sampleSize(
    region: PixelRect,
    orientation: Int,
    targetWidth: Double,
    targetHeight: Double,
  ): Int {
    if (targetWidth <= 0.0 || targetHeight <= 0.0) return 1
    val swapped = validOrientation(orientation) in 5..8
    val regionWidth = if (swapped) region.height else region.width
    val regionHeight = if (swapped) region.width else region.height
    var sample = 1
    while (sample <= (1 shl 29)) {
      val next = sample * 2
      if (regionWidth / next.toDouble() < targetWidth || regionHeight / next.toDouble() < targetHeight) {
        break
      }
      sample = next
    }
    return sample
  }

  fun validOrientation(orientation: Int): Int = if (orientation in 1..8) orientation else 1

  private const val EDGE_EPSILON = 0.000_000_1

  private fun unit(value: Double): Double = if (value.isFinite()) value.coerceIn(0.0, 1.0) else 0.0

  private fun positive(value: Double, fallback: Double): Double =
    if (value.isFinite() && value > 0.0) value else fallback
}

internal class PreviewRegionGeneration {
  private val value = AtomicInteger()

  fun current(): Int = value.get()

  fun invalidate(): Int = value.incrementAndGet()

  fun owns(ticket: Int): Boolean = ticket == value.get()
}

internal inline fun PreviewRegionGeneration.runIfCurrent(ticket: Int, block: () -> Unit) {
  if (owns(ticket)) block()
}

private data class DecodeRequest(
  val filePath: String,
  val viewport: NormalizedViewport,
  val scale: Double,
  val viewWidth: Int,
  val viewHeight: Int,
  val maxDecodeWidth: Int,
  val maxDecodeHeight: Int,
)

private data class DecodedRegion(
  val bitmap: Bitmap,
  val encodedRect: PixelRect,
  val orientation: Int,
  val sourceWidth: Int,
  val sourceHeight: Int,
  val uprightSize: PixelSize,
)

class PreviewRegionImageView(private val reactContext: ThemedReactContext) : View(reactContext) {
  private val generation = PreviewRegionGeneration()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.DITHER_FLAG or Paint.FILTER_BITMAP_FLAG)
  private var decodedRegion: DecodedRegion? = null
  private var decodePosted = false
  private var filePath: String? = null
  private var reportedSize: PixelSize? = null
  private var scale = 1.0
  private var suspended = false
  private var viewport = NormalizedViewport(0.0, 0.0, 1.0, 1.0)
  private val decodeRunnable =
    Runnable {
      decodePosted = false
      startDecode()
    }

  init {
    setWillNotDraw(false)
  }

  fun setFilePath(value: String?) {
    val next = value?.takeIf { it.isNotBlank() }
    if (filePath == next) return
    filePath = next
    reportedSize = null
    requestDecode(clear = true)
  }

  internal fun setViewport(value: NormalizedViewport) {
    val next = PreviewRegionMath.normalize(value)
    if (viewport == next) return
    viewport = next
    requestDecode(clear = true)
  }

  fun setScale(value: Double) {
    val next = if (value.isFinite() && value > 0.0) value else 1.0
    if (scale == next) return
    scale = next
    requestDecode(clear = true)
  }

  fun setSuspended(value: Boolean) {
    if (suspended == value) return
    suspended = value
    requestDecode(clear = value)
  }

  fun dispose() {
    generation.invalidate()
    removeCallbacks(decodeRunnable)
    decodePosted = false
    replaceDecodedRegion(null)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestDecode(clear = false)
  }

  override fun onDetachedFromWindow() {
    dispose()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    if (width != oldWidth || height != oldHeight) requestDecode(clear = true)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val region = decodedRegion ?: return
    val rect = region.encodedRect
    val source =
      floatArrayOf(
        0f,
        0f,
        region.bitmap.width.toFloat(),
        0f,
        0f,
        region.bitmap.height.toFloat(),
      )
    val topLeft = uprightDestination(rect.left, rect.top, region)
    val topRight = uprightDestination(rect.right, rect.top, region)
    val bottomLeft = uprightDestination(rect.left, rect.bottom, region)
    val destination =
      floatArrayOf(
        topLeft.x.toFloat(),
        topLeft.y.toFloat(),
        topRight.x.toFloat(),
        topRight.y.toFloat(),
        bottomLeft.x.toFloat(),
        bottomLeft.y.toFloat(),
      )
    val matrix = Matrix()
    if (matrix.setPolyToPoly(source, 0, destination, 0, 3)) {
      canvas.drawBitmap(region.bitmap, matrix, paint)
    }
  }

  private fun uprightDestination(x: Int, y: Int, region: DecodedRegion): PixelPoint {
    val point =
      PreviewRegionMath.uprightPoint(
        x.toDouble(),
        y.toDouble(),
        region.sourceWidth,
        region.sourceHeight,
        region.orientation,
      )
    return PixelPoint(
      point.x * width / region.uprightSize.width,
      point.y * height / region.uprightSize.height,
    )
  }

  private fun requestDecode(clear: Boolean) {
    generation.invalidate()
    if (clear || suspended) replaceDecodedRegion(null)
    if (suspended || decodePosted) return
    decodePosted = true
    post(decodeRunnable)
  }

  private fun startDecode() {
    val path = filePath ?: return
    if (!isAttachedToWindow || suspended || width <= 0 || height <= 0) return
    val ticket = generation.current()
    val metrics = resources.displayMetrics
    val request =
      DecodeRequest(
        path,
        viewport,
        scale,
        width,
        height,
        metrics.widthPixels,
        metrics.heightPixels,
    )
    decoderExecutor.execute {
      generation.runIfCurrent(ticket) {
        val result = decode(request)
        val posted =
          mainHandler.post {
            if (!generation.owns(ticket) || !isAttachedToWindow || suspended) {
              result?.bitmap?.recycle()
              return@post
            }
            replaceDecodedRegion(result)
            result?.uprightSize?.let { size ->
              if (reportedSize != size) {
                reportedSize = size
                emitSourceSize(size)
              }
            }
          }
        if (!posted) result?.bitmap?.recycle()
      }
    }
  }

  private fun replaceDecodedRegion(next: DecodedRegion?) {
    val previous = decodedRegion
    decodedRegion = next
    if (previous?.bitmap !== next?.bitmap) previous?.bitmap?.recycle()
    invalidate()
  }

  @Suppress("DEPRECATION")
  private fun emitSourceSize(size: PixelSize) {
    val event = Arguments.createMap().apply {
      putInt("width", size.width)
      putInt("height", size.height)
    }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, EVENT_SOURCE_SIZE, event)
  }

  companion object {
    private const val EVENT_SOURCE_SIZE = "topSourceSize"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val decoderExecutor =
      Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "WzPreviewRegionDecoder").apply { isDaemon = true }
      }

    private fun decode(request: DecodeRequest): DecodedRegion? {
      var decoder: BitmapRegionDecoder? = null
      return try {
        val orientation = readOrientation(request.filePath)
        decoder = BitmapRegionDecoder.newInstance(request.filePath, false) ?: return null
        val sourceWidth = decoder.width
        val sourceHeight = decoder.height
        if (sourceWidth <= 0 || sourceHeight <= 0) return null
        val uprightSize = PreviewRegionMath.uprightSize(sourceWidth, sourceHeight, orientation)
        val encodedRect =
          PreviewRegionMath.expand(
            PreviewRegionMath.encodedRect(sourceWidth, sourceHeight, orientation, request.viewport),
            sourceWidth,
            sourceHeight,
          )
        val swapped = orientation in 5..8
        val orientedRegionWidth = if (swapped) encodedRect.height else encodedRect.width
        val orientedRegionHeight = if (swapped) encodedRect.width else encodedRect.height
        val targetWidth =
          min(
            request.maxDecodeWidth.toDouble(),
            request.viewWidth * orientedRegionWidth.toDouble() / uprightSize.width * request.scale,
          ).coerceAtLeast(1.0)
        val targetHeight =
          min(
            request.maxDecodeHeight.toDouble(),
            request.viewHeight * orientedRegionHeight.toDouble() / uprightSize.height * request.scale,
          ).coerceAtLeast(1.0)
        val options =
          BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inSampleSize = PreviewRegionMath.sampleSize(encodedRect, orientation, targetWidth, targetHeight)
          }
        val bitmap =
          decoder.decodeRegion(
            Rect(encodedRect.left, encodedRect.top, encodedRect.right, encodedRect.bottom),
            options,
          ) ?: return null
        DecodedRegion(bitmap, encodedRect, orientation, sourceWidth, sourceHeight, uprightSize)
      } catch (_: Exception) {
        null
      } catch (_: OutOfMemoryError) {
        null
      } finally {
        decoder?.recycle()
      }
    }

    private fun readOrientation(filePath: String): Int =
      try {
        PreviewRegionMath.validOrientation(
          ExifInterface(filePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        )
      } catch (_: Exception) {
        ExifInterface.ORIENTATION_NORMAL
      }
  }
}

class PreviewRegionImageViewManager : SimpleViewManager<PreviewRegionImageView>() {
  override fun getName(): String = "WzPreviewRegionImage"

  override fun createViewInstance(reactContext: ThemedReactContext): PreviewRegionImageView =
    PreviewRegionImageView(reactContext)

  @ReactProp(name = "filePath")
  fun setFilePath(view: PreviewRegionImageView, filePath: String?) = view.setFilePath(filePath)

  @ReactProp(name = "viewport")
  fun setViewport(view: PreviewRegionImageView, viewport: ReadableMap?) {
    view.setViewport(
      NormalizedViewport(
        viewport?.number("x", 0.0) ?: 0.0,
        viewport?.number("y", 0.0) ?: 0.0,
        viewport?.number("width", 1.0) ?: 1.0,
        viewport?.number("height", 1.0) ?: 1.0,
      )
    )
  }

  @ReactProp(name = "scale", defaultDouble = 1.0)
  fun setScale(view: PreviewRegionImageView, scale: Double) = view.setScale(scale)

  @ReactProp(name = "suspended", defaultBoolean = false)
  fun setSuspended(view: PreviewRegionImageView, suspended: Boolean) = view.setSuspended(suspended)

  override fun onDropViewInstance(view: PreviewRegionImageView) {
    view.dispose()
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
      put("topSourceSize", mapOf("registrationName" to "onSourceSize"))
    }

  private fun ReadableMap.number(key: String, fallback: Double): Double =
    if (hasKey(key) && !isNull(key)) getDouble(key) else fallback
}

class PreviewRegionImagePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(PreviewRegionImageViewManager())
}
`;
}

function previewRegionImageTestSource(packageName) {
  return `package ${packageName}

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewRegionImageMathTest {
  @Test
  fun mapsTheUprightViewportThroughAllExifOrientations() {
    val viewport = NormalizedViewport(0.1, 0.2, 0.3, 0.4)
    val expected =
      mapOf(
        1 to PixelRect(10, 20, 40, 60),
        2 to PixelRect(60, 20, 90, 60),
        3 to PixelRect(60, 40, 90, 80),
        4 to PixelRect(10, 40, 40, 80),
        5 to PixelRect(20, 10, 60, 40),
        6 to PixelRect(20, 60, 60, 90),
        7 to PixelRect(40, 60, 80, 90),
        8 to PixelRect(40, 10, 80, 40),
      )

    expected.forEach { (orientation, rect) ->
      assertEquals(rect, PreviewRegionMath.encodedRect(100, 100, orientation, viewport))
    }
  }

  @Test
  fun mapsEncodedPixelsBackToTheSameUprightPoint() {
    for (orientation in 1..8) {
      val encoded = PreviewRegionMath.encodedPoint(0.23, 0.67, orientation)
      val upright = PreviewRegionMath.uprightPoint(encoded.x * 1_200, encoded.y * 800, 1_200, 800, orientation)
      val size = PreviewRegionMath.uprightSize(1_200, 800, orientation)
      assertEquals(0.23, upright.x / size.width, 0.000_001)
      assertEquals(0.67, upright.y / size.height, 0.000_001)
    }
  }

  @Test
  fun swapsTheReportedSourceSizeOnlyForQuarterTurnOrientations() {
    for (orientation in 1..4) {
      assertEquals(PixelSize(1_200, 800), PreviewRegionMath.uprightSize(1_200, 800, orientation))
    }
    for (orientation in 5..8) {
      assertEquals(PixelSize(800, 1_200), PreviewRegionMath.uprightSize(1_200, 800, orientation))
    }
  }

  @Test
  fun choosesTheLargestSampleThatStillCoversPhysicalPixels() {
    val region = PixelRect(0, 0, 8_000, 4_000)
    assertEquals(8, PreviewRegionMath.sampleSize(region, 1, 1_000.0, 500.0))
    assertEquals(4, PreviewRegionMath.sampleSize(region, 1, 2_000.0, 1_000.0))
  }

  @Test
  fun runsOnlyTheCurrentQueuedGeneration() {
    val generation = PreviewRegionGeneration()
    val first = generation.invalidate()
    var executed = false
    generation.runIfCurrent(first) { executed = true }
    assertTrue(executed)

    executed = false
    generation.invalidate()
    generation.runIfCurrent(first) { executed = true }
    assertFalse(executed)
  }
}
`;
}

function packagePath(packageName) {
  return packageName.replaceAll('.', path.sep);
}

function injectPreviewRegionImagePackage(contents) {
  if (contents.includes('add(PreviewRegionImagePackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 PreviewRegionImagePackage：MainApplication 模板不匹配。');
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              add(PreviewRegionImagePackage())`);
}

function injectPreviewRegionImageTestSupport(contents) {
  if (contents.includes('testImplementation("junit:junit:4.13.2")')) {
    return contents;
  }
  const dependenciesPattern = /dependencies\s*\{/;
  if (!dependenciesPattern.test(contents)) {
    throw new Error('无法注入 PreviewRegionImage 原生测试依赖：app build.gradle 模板不匹配。');
  }
  return contents.replace(dependenciesPattern, (match) => `${match}\n    testImplementation("junit:junit:4.13.2")`);
}

function withPreviewRegionImageNative(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectPreviewRegionImageTestSupport(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android?.package;
      if (!packageName) {
        return config;
      }
      const outputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath(packageName)
      );
      const testOutputDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'test',
        'java',
        packagePath(packageName)
      );
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(testOutputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'PreviewRegionImageView.kt'), previewRegionImageSource(packageName));
      fs.writeFileSync(
        path.join(testOutputDir, 'PreviewRegionImageMathTest.kt'),
        previewRegionImageTestSource(packageName)
      );
      return config;
    }
  ]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectPreviewRegionImagePackage(config.modResults.contents);
    return config;
  });
}

module.exports = withPreviewRegionImageNative;
