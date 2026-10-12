package com.wz.reader

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.ScrollView
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.CRC32
import java.util.zip.Deflater
import kotlin.math.ceil
import kotlin.math.min

internal const val TOPIC_SHARE_STRIP_HEIGHT = 256

// PNG uses one zlib stream across all IDAT chunks, so no full image is retained.
internal class TopicSharePngWriter(output: OutputStream, private val width: Int, private val height: Int) : AutoCloseable {
  private val output = DataOutputStream(output)
  private val row = ByteArray(1 + width.also { require(it in 1..1080 && height > 0) { "分享图片尺寸无效。" } } * 4)
  private val deflater = Deflater()
  private val compressed = ByteArray(32 * 1024)
  private var rows = 0

  init {
    try {
      this.output.write(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))
      val header = ByteArrayOutputStream(13)
      DataOutputStream(header).use {
        it.writeInt(width)
        it.writeInt(height)
        it.write(byteArrayOf(8, 6, 0, 0, 0))
      }
      chunk("IHDR", header.toByteArray(), 13)
    } catch (error: Throwable) {
      deflater.end()
      throw error
    }
  }

  private fun chunk(type: String, bytes: ByteArray, count: Int) {
    val typeBytes = type.toByteArray(Charsets.US_ASCII)
    output.writeInt(count)
    output.write(typeBytes)
    output.write(bytes, 0, count)
    val crc = CRC32().apply { update(typeBytes); update(bytes, 0, count) }
    output.writeInt(crc.value.toInt())
  }

  fun row(pixels: IntArray) {
    check(rows < height && pixels.size == width) { "分享图片像素行无效。" }
    for (x in pixels.indices) {
      val pixel = pixels[x]
      val offset = 1 + x * 4
      row[offset] = (pixel ushr 16).toByte()
      row[offset + 1] = (pixel ushr 8).toByte()
      row[offset + 2] = pixel.toByte()
      row[offset + 3] = (pixel ushr 24).toByte()
    }
    deflater.setInput(row)
    while (!deflater.needsInput()) {
      val count = deflater.deflate(compressed)
      if (count > 0) chunk("IDAT", compressed, count)
    }
    rows++
  }

  fun finish() {
    check(rows == height) { "分享图片正文尚未完整绘制。" }
    deflater.finish()
    while (!deflater.finished()) {
      val count = deflater.deflate(compressed)
      check(count > 0) { "分享图片编码失败。" }
      chunk("IDAT", compressed, count)
    }
    chunk("IEND", ByteArray(0), 0)
    output.flush()
  }

  override fun close() { deflater.end() }
}

internal suspend fun writeTopicShareCapture(
  directory: File,
  width: Int,
  height: Int,
  checkActive: () -> Unit,
  openOutput: (File) -> OutputStream = { it.outputStream().buffered() },
  render: suspend (TopicSharePngWriter) -> Unit
): File {
  checkActive()
  check(directory.isDirectory || directory.mkdirs()) { "无法创建分享图片文件。" }
  val partial = File.createTempFile("capture-", ".part", directory)
  var completed: File? = null
  try {
    openOutput(partial).use { output ->
      TopicSharePngWriter(output, width, height).use { writer ->
        render(writer)
        checkActive()
        writer.finish()
      }
    }
    checkActive()
    val target = File(directory, "${partial.nameWithoutExtension}.png")
    if (!partial.renameTo(target)) throw IOException("无法完成分享图片文件。")
    completed = target
    checkActive()
    return target
  } catch (error: Throwable) {
    completed?.delete()
    throw error
  } finally {
    partial.delete()
  }
}

internal data class TopicShareCaptureResult(val file: File, val width: Int, val height: Int)

internal suspend fun captureTopicShareContent(
  scrollView: ScrollView,
  directory: File,
  checkActive: () -> Unit,
  createBitmap: (Int, Int) -> Bitmap = { width, height -> Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888) },
  openOutput: (File) -> OutputStream = { it.outputStream().buffered() }
): TopicShareCaptureResult {
  val content = withContext(Dispatchers.Main) {
    checkActive()
    check(scrollView.isAttachedToWindow && scrollView.childCount == 1) { "分享图片预览已关闭。" }
    scrollView.getChildAt(0)
  }
  val sourceSize = withContext(Dispatchers.Main) {
    check(content.width > 0 && content.height > 0) { "分享图片正文尚未排版完成。" }
    intArrayOf(content.width, content.height, scrollView.width, scrollView.height)
  }
  val width = min(sourceSize[0], 1080)
  val scale = width.toDouble() / sourceSize[0]
  val height = ceil(sourceSize[1] * scale).toInt()
  val pixels = IntArray(width)
  val bitmap = createBitmap(width, min(height, TOPIC_SHARE_STRIP_HEIGHT))
  try {
    val file = writeTopicShareCapture(directory, width, height, checkActive, openOutput) { writer ->
      var top = 0
      while (top < height) {
        checkActive()
        val rows = min(bitmap.height, height - top)
        withContext(Dispatchers.Main) {
          checkActive()
          check(scrollView.isAttachedToWindow && content.isAttachedToWindow && scrollView.getChildAt(0) === content &&
            content.width == sourceSize[0] && content.height == sourceSize[1] &&
            scrollView.width == sourceSize[2] && scrollView.height == sourceSize[3]) {
            "分享图片正文已变化，请重试。"
          }
          bitmap.eraseColor(Color.WHITE)
          val canvas = Canvas(bitmap)
          canvas.translate(0f, -top.toFloat())
          canvas.scale(scale.toFloat(), scale.toFloat())
          content.draw(canvas)
        }
        for (y in 0 until rows) {
          checkActive()
          bitmap.getPixels(pixels, 0, width, 0, y, width, 1)
          writer.row(pixels)
        }
        top += rows
      }
    }
    return TopicShareCaptureResult(file, width, height)
  } finally {
    bitmap.recycle()
  }
}

private class TopicShareCapture {
  val started = AtomicBoolean(false)
  @Volatile var canceled = false
  @Volatile var file: File? = null
  fun release() { canceled = true; file?.delete() }
}

class TopicShareCaptureModule : Module() {
  private val captures = ConcurrentHashMap<String, TopicShareCapture>()

  override fun definition() = ModuleDefinition {
    Name("TopicShareCapture")
    Function("createCapture") {
      UUID.randomUUID().toString().also { captures[it] = TopicShareCapture() }
    }
    Function("cancelCapture") { id: String -> captures[id]?.let { it.canceled = true } }
    Function("releaseCapture") { id: String -> captures.remove(id)?.release() }
    OnDestroy {
      captures.values.forEach { it.release() }
      captures.clear()
    }
    AsyncFunction("capture") Coroutine { id: String, tag: Int ->
      val state = requireNotNull(captures[id]) { "分享图片生成已结束。" }
      check(state.started.compareAndSet(false, true)) { "分享图片已开始生成。" }
      val directory = File(requireNotNull(appContext.reactContext).cacheDir, "topic-share-captures")
      withContext(Dispatchers.IO) {
        val context = currentCoroutineContext()
        val checkActive = {
          context.ensureActive()
          if (state.canceled) throw IOException("分享图片生成已取消。")
        }
        try {
          val scrollView = withContext(Dispatchers.Main) {
            checkActive()
            appContext.findView<View>(tag) as? ScrollView ?: throw IOException("分享图片预览不可用。")
          }
          val result = captureTopicShareContent(scrollView, directory, checkActive)
          state.file = result.file
          checkActive()
          mapOf("uri" to Uri.fromFile(result.file).toString(), "width" to result.width, "height" to result.height)
        } catch (error: Throwable) {
          state.file?.delete()
          throw error
        }
      }
    }
  }
}
