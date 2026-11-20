package com.wz.reader

import com.facebook.imageformat.DefaultImageFormatChecker
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

internal data class DownloadedImage(val file: File, val contentType: String, val byteCount: Long)

private val svgRoot = Regex("""^<(?:[A-Za-z_][\w.-]*:)?svg(?=[\s/>])""")
private val documentRoot = Regex("""^<(?:[a-z_][\w.:-]*|!doctype\s+html)(?=[\s/>])""", RegexOption.IGNORE_CASE)

private fun markupPrefix(header: ByteArray): String {
  var xml = header.toString(Charsets.UTF_8).removePrefix("\uFEFF").trimStart()
  while (xml.startsWith("<?") || xml.startsWith("<!--")) {
    val end = if (xml.startsWith("<!--")) "-->" else "?>"
    val index = xml.indexOf(end)
    if (index < 0) break
    xml = xml.substring(index + end.length).trimStart()
  }
  return xml
}

private fun downloadImageType(response: Response): String {
  val declared = response.header("Content-Type").orEmpty().substringBefore(';').trim().lowercase()
  val declaredImage = declared.startsWith("image/") || declared == "application/svg+xml"
  if (!declaredImage && declared.isNotEmpty() && declared != "application/octet-stream" && declared != "binary/octet-stream") {
    throw IOException("下载内容不是图片")
  }
  // Peek without consuming the original body or decoding an unbounded bitmap.
  val header = response.peekBody(1024).use { it.bytes() }
  if (declaredImage) {
    val prefix = markupPrefix(header)
    if (documentRoot.containsMatchIn(prefix) && !svgRoot.containsMatchIn(prefix)) throw IOException("下载内容不是图片")
    return declared
  }
  val extension = DefaultImageFormatChecker().determineFormat(header, header.size).fileExtension
  when (extension) {
    "jpeg", "png", "gif", "bmp", "webp", "heif", "avif" -> return "image/$extension"
  }
  if (svgRoot.containsMatchIn(markupPrefix(header))) return "image/svg+xml"
  throw IOException("下载内容不是图片")
}

internal fun streamImageDownload(
  call: Call,
  directory: File,
  openOutput: (File) -> java.io.OutputStream = { it.outputStream() },
  checkActive: () -> Unit
): DownloadedImage {
  var byteCount = 0L
  lateinit var contentType: String
  val file = writeTemporaryImage(directory, "image-", checkActive) { partial ->
    call.execute().use { response ->
      if (!response.isSuccessful) throw IOException("图片下载失败")
      val body = response.body ?: throw IOException("图片文件无效")
      contentType = openOutput(partial).use { output ->
        checkActive()
        val type = downloadImageType(response)
        body.byteStream().use { input ->
          val buffer = ByteArray(32 * 1024)
          while (true) {
            checkActive()
            val count = input.read(buffer)
            if (count == -1) break
            output.write(buffer, 0, count)
            byteCount += count
          }
        }
        output.flush()
        type
      }
      checkActive()
      if (byteCount == 0L || body.contentLength().let { it >= 0 && it != byteCount }) throw IOException("图片文件无效")
      when (contentType) {
        "image/jpeg", "image/jpg", "image/pjpeg" -> "jpg"
        "image/x-png" -> "png"
        "image/x-ms-bmp" -> "bmp"
        "application/svg+xml", "image/svg+xml" -> "svg"
        else -> contentType.removePrefix("image/").takeIf { it in setOf("apng", "avif", "bmp", "gif", "heic", "heif", "png", "webp") }
          ?: call.request().url.pathSegments.lastOrNull()?.substringAfterLast('.', "")?.lowercase()
            ?.takeIf { it in setOf("apng", "avif", "bmp", "gif", "heic", "heif", "jpg", "jpeg", "png", "webp") }
          ?: "jpg"
      }
    }
  }
  return DownloadedImage(file, contentType, byteCount)
}

class ImageDownloadModule : Module() {
  private val downloads = ConcurrentHashMap<String, TemporaryImageOperation>()

  override fun definition() = ModuleDefinition {
    Name("ImageDownload")
    // Synchronous registration makes cancellation before the IO worker starts reliable.
    Function("createDownload") {
      UUID.randomUUID().toString().also { downloads[it] = TemporaryImageOperation() }
    }
    Function("cancelDownload") { id: String -> downloads[id]?.cancel() }
    Function("releaseDownload") { id: String ->
      downloads.remove(id)?.release()
    }
    OnDestroy {
      downloads.values.forEach { it.release() }
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
        state.start(call::cancel)
        val checkActive = {
          context.ensureActive()
          state.checkActive()
        }
        try {
          checkActive()
          val result = streamImageDownload(call, directory, checkActive = checkActive)
          state.publish(result.file)
          checkActive()
          mapOf("uri" to android.net.Uri.fromFile(result.file).toString(), "contentType" to result.contentType, "byteCount" to result.byteCount)
        } catch (error: Throwable) {
          state.release()
          throw error
        }
      }
    }
  }
}
