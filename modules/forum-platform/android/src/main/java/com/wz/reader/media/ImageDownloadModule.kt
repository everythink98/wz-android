package com.wz.reader

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

internal data class DownloadedImage(val file: File, val contentType: String, val byteCount: Long)

internal fun streamImageDownload(
  call: Call,
  directory: File,
  openOutput: (File) -> java.io.OutputStream = { it.outputStream() },
  checkActive: () -> Unit
): DownloadedImage {
  check(directory.isDirectory || directory.mkdirs()) { "无法创建图片文件。" }
  val partial = File.createTempFile("image-", ".part", directory)
  var completed: File? = null
  try {
    return call.execute().use { response ->
      if (!response.isSuccessful) throw IOException("图片下载失败")
      val contentType = response.header("Content-Type").orEmpty().substringBefore(';').trim().lowercase()
      if (contentType.isNotEmpty() && !contentType.startsWith("image/") && contentType != "application/svg+xml") {
        throw IOException("下载内容不是图片")
      }
      val body = response.body ?: throw IOException("图片文件无效")
      var byteCount = 0L
      body.byteStream().use { input ->
        openOutput(partial).use { output ->
          val buffer = ByteArray(32 * 1024)
          while (true) {
            checkActive()
            val count = input.read(buffer)
            if (count == -1) break
            output.write(buffer, 0, count)
            byteCount += count
          }
          output.flush()
        }
      }
      checkActive()
      if (byteCount == 0L || body.contentLength().let { it >= 0 && it != byteCount }) throw IOException("图片文件无效")
      val extension = when (contentType) {
        "image/jpeg", "image/jpg", "image/pjpeg" -> "jpg"
        "image/x-png" -> "png"
        "image/x-ms-bmp" -> "bmp"
        "application/svg+xml", "image/svg+xml" -> "svg"
        else -> contentType.removePrefix("image/").takeIf { it in setOf("apng", "avif", "bmp", "gif", "heic", "heif", "png", "webp") }
          ?: call.request().url.pathSegments.lastOrNull()?.substringAfterLast('.', "")?.lowercase()
            ?.takeIf { it in setOf("apng", "avif", "bmp", "gif", "heic", "heif", "jpg", "jpeg", "png", "webp") }
          ?: "jpg"
      }
      val target = File(directory, "${partial.nameWithoutExtension}.$extension")
      if (!partial.renameTo(target)) throw IOException("无法完成图片文件。")
      completed = target
      DownloadedImage(target, contentType, byteCount)
    }
  } catch (error: Throwable) {
    completed?.delete()
    throw error
  } finally {
    partial.delete()
  }
}

private class ImageDownload {
  @Volatile var canceled = false
  @Volatile var call: Call? = null
  @Volatile var file: File? = null
  fun cancel() { canceled = true; call?.cancel() }
}

class ImageDownloadModule : Module() {
  private val downloads = ConcurrentHashMap<String, ImageDownload>()

  override fun definition() = ModuleDefinition {
    Name("ImageDownload")
    // Synchronous registration makes cancellation before the IO worker starts reliable.
    Function("createDownload") {
      UUID.randomUUID().toString().also { downloads[it] = ImageDownload() }
    }
    Function("cancelDownload") { id: String -> downloads[id]?.cancel() }
    Function("releaseDownload") { id: String ->
      downloads.remove(id)?.let { it.cancel(); it.file?.delete() }
    }
    OnDestroy {
      downloads.values.forEach { it.cancel(); it.file?.delete() }
      downloads.clear()
    }
    AsyncFunction("download") Coroutine { id: String, url: String, headers: Map<String, String> ->
      val state = requireNotNull(downloads[id]) { "图片下载已结束。" }
      val directory = File(requireNotNull(appContext.reactContext).cacheDir, "image-saves")
      withContext(Dispatchers.IO) {
        val context = currentCoroutineContext()
        val request = Request.Builder().url(url).apply { headers.forEach { (name, value) -> header(name, value) } }
          .tag(ImageRequestPurpose::class.java, ImageRequestPurpose.IMAGE_SAVE).build()
        val call = NetworkProxyRuntime.imageCallFactory.newCall(request)
        call.timeout().timeout(15, TimeUnit.SECONDS)
        state.call = call
        val checkActive = {
          context.ensureActive()
          if (state.canceled) { call.cancel(); throw IOException("图片保存已取消") }
        }
        try {
          checkActive()
          val result = streamImageDownload(call, directory, checkActive = checkActive)
          state.file = result.file
          checkActive()
          mapOf("uri" to android.net.Uri.fromFile(result.file).toString(), "contentType" to result.contentType, "byteCount" to result.byteCount)
        } catch (error: Throwable) {
          state.file?.delete()
          throw error
        }
      }
    }
  }
}
