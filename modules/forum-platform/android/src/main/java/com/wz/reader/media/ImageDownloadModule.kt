package com.wz.reader

import android.net.Uri
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

private data class SavedImageFormat(val extension: String, val contentType: String)
private const val IMAGE_PREFIX_BYTES = 1024
private val savedSvgFormat = SavedImageFormat("svg", "image/svg+xml")
private val svgRoot = Regex("""^<(?:[A-Za-z_][\w.-]*:)?svg(?=[\s/>])""")

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

private fun savedImageFormat(prefix: ByteArray): SavedImageFormat? {
  val extension = DefaultImageFormatChecker().determineFormat(prefix, prefix.size).fileExtension
  return when (extension) {
    "jpeg" -> SavedImageFormat("jpg", "image/jpeg")
    "png", "gif", "bmp", "webp", "heif", "avif" -> SavedImageFormat(extension, "image/$extension")
    else -> if (svgRoot.containsMatchIn(markupPrefix(prefix))) savedSvgFormat else null
  }
}

private fun downloadImageFormat(response: Response): SavedImageFormat {
  val declared = response.header("Content-Type").orEmpty().substringBefore(';').trim().lowercase()
  val declaredSvg = isSvgResponseContentType(declared)
  val declaredImage = declared.startsWith("image/") || declaredSvg
  if (!declaredImage && declared.isNotEmpty() && declared != "application/octet-stream" && declared != "binary/octet-stream") {
    throw IOException("下载内容不是图片")
  }
  // Peek without consuming the original body or decoding an unbounded bitmap.
  val prefix = response.peekBody(IMAGE_PREFIX_BYTES.toLong()).use { it.bytes() }
  savedImageFormat(prefix)?.let { return it }

  // A declared SVG can have a longer XML prolog. Apply the renderer's bounded XML policy.
  val body = response.body
  if (declaredSvg && body != null && body.contentLength() <= MAX_SVG_BYTES) {
    val svg = body.source().peek().use(::boundedSvgBytes)
    if (svg != null && isValidSvgDocument(svg)) return savedSvgFormat
  }
  throw IOException("下载内容不是图片")
}

internal fun validateInlineImage(file: File, expectedExtension: String) {
  val header = ByteArray(IMAGE_PREFIX_BYTES)
  val length = file.inputStream().use { it.read(header) }
  if (length <= 0 || expectedExtension == "svg" || savedImageFormat(header.copyOf(length))?.extension != expectedExtension) {
    throw IOException("下载内容不是图片")
  }
}

internal fun streamImageDownload(
  call: Call,
  directory: File,
  openOutput: (File) -> java.io.OutputStream = { it.outputStream() },
  checkActive: () -> Unit
): DownloadedImage {
  var byteCount = 0L
  lateinit var format: SavedImageFormat
  val file = writeTemporaryImage(directory, "image-", checkActive) { partial ->
    call.execute().use { response ->
      if (!response.isSuccessful) throw IOException("图片下载失败")
      val body = response.body ?: throw IOException("图片文件无效")
      checkActive()
      format = downloadImageFormat(response)
      openOutput(partial).use { output ->
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
      }
      checkActive()
      if (byteCount == 0L || body.contentLength().let { it >= 0 && it != byteCount }) throw IOException("图片文件无效")
      format.extension
    }
  }
  return DownloadedImage(file, format.contentType, byteCount)
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
    AsyncFunction("validateInlineImage") Coroutine { uri: String, extension: String ->
      withContext(Dispatchers.IO) {
        val parsed = Uri.parse(uri)
        val file = File(requireNotNull(parsed.path)).canonicalFile
        check(parsed.scheme == "file" && file.parentFile == appContext.cacheDirectory.canonicalFile) {
          "图片地址必须是本机临时文件。"
        }
        validateInlineImage(file, extension)
      }
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
          mapOf("uri" to Uri.fromFile(result.file).toString(), "contentType" to result.contentType, "byteCount" to result.byteCount)
        } catch (error: Throwable) {
          state.release()
          throw error
        }
      }
    }
  }
}
