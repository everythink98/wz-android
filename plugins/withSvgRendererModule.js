const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function packagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function svgRendererModuleSource(packageName) {
  return String.raw`package ${packageName}

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.system.Os
import android.util.Base64
import android.view.View
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.uimanager.ViewManager
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.StringReader
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.TimeUnit
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import okio.Buffer
import okio.BufferedSource

internal const val MAX_SVG_BYTES = 1024 * 1024
internal const val MAX_POSTER_EDGE = 4096
internal const val MAX_POSTER_PIXELS = 4_194_304L
internal const val MAX_SVG_CACHE_KEY_CHARS = 512
internal const val MAX_POSTER_CACHE_FILES = 32
internal const val MAX_POSTER_CACHE_BYTES = 64L * 1024L * 1024L
internal const val MAX_RENDER_REQUESTS = 32
private const val TOTAL_RENDER_TIMEOUT_MS = 30_000L
private const val DOCUMENT_FETCH_TIMEOUT_MS = 10_000L
private const val VISUAL_STATE_CALLBACK_TIMEOUT_MS = 2_000L
private const val VISUAL_SETTLE_DELAY_MS = 2_000L
private const val POSTER_CACHE_DIR = "svg-posters"

internal const val SVG_POSTER_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; " +
    "connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; " +
    "frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; " +
    "base-uri 'none'; form-action 'none'; navigate-to 'none'"

internal data class PosterDimensions(val width: Int, val height: Int)
internal data class SvgDocumentDimensions(val width: Double, val height: Double)

internal data class SvgPosterCacheEntry(
  val name: String,
  val size: Long,
  val lastModified: Long
)

internal fun hasSvgPosterQueueCapacity(active: Boolean, queued: Int): Boolean {
  require(queued >= 0)
  return queued + (if (active) 1 else 0) < MAX_RENDER_REQUESTS
}

internal fun boundedSvgFetchTimeoutMs(requestedMs: Double): Long =
  requestedMs.toLong().coerceIn(1L, DOCUMENT_FETCH_TIMEOUT_MS)

internal fun isCurrentSvgPageError(
  expectedPageUrl: String?,
  errorUrl: String,
  isForMainFrame: Boolean
): Boolean = isForMainFrame && expectedPageUrl != null && expectedPageUrl == errorUrl

private data class CanonicalSvg(
  val bytes: ByteArray,
  val base64: String,
  val rootAttributes: SvgRootAttributes
)

internal data class SvgRootAttributes(
  val height: String?,
  val viewBox: String?,
  val width: String?
)

private data class PreparedPoster(
  val dimensions: PosterDimensions,
  val documentDimensions: SvgDocumentDimensions,
  val outputFile: File,
  val html: String,
  val cacheHit: Boolean
)

private class SvgPosterException(
  val code: String,
  message: String,
  cause: Throwable? = null
) : Exception(message, cause)

private class RenderRequest(
  val id: Long,
  val context: Context,
  val svgBase64: String,
  val cacheKey: String,
  val totalTimeoutMs: Long,
  val promise: Promise
) {
  val deadlineUptimeMs = SystemClock.uptimeMillis() + totalTimeoutMs
  var settled = false
  var expectedPageUrl: String? = null
  var prepared: PreparedPoster? = null
  var visualStateRequested = false
  var captureStarted = false
  var totalTimeout: Runnable? = null
  var visualTimeout: Runnable? = null
}

internal fun validateDecodedSvgSize(bytes: ByteArray) {
  if (bytes.isEmpty()) {
    throw SvgPosterException("svg_invalid_input", "SVG 内容为空。")
  }
  if (bytes.size > MAX_SVG_BYTES) {
    throw SvgPosterException("svg_too_large", "SVG 超过 1 MiB 解码上限。")
  }
}

internal fun validateSvgCacheKey(cacheKey: String) {
  if (
    cacheKey.isBlank() ||
    cacheKey.length > MAX_SVG_CACHE_KEY_CHARS ||
    cacheKey.any { it.code < 0x20 || it.code == 0x7f }
  ) {
    throw SvgPosterException("svg_invalid_cache_key", "SVG 缓存标识无效。")
  }
}

private fun validateBase64Envelope(value: String) {
  val maxEncodedLength = ((MAX_SVG_BYTES + 2) / 3) * 4
  if (value.isEmpty() || value.length > maxEncodedLength || value.length % 4 == 1) {
    throw SvgPosterException("svg_invalid_input", "SVG Base64 输入无效。")
  }
  var padding = 0
  for (index in value.indices) {
    val char = value[index]
    val allowed = char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '+' || char == '/'
    if (allowed) {
      if (padding != 0) {
        throw SvgPosterException("svg_invalid_input", "SVG Base64 输入无效。")
      }
    } else if (char == '=') {
      padding += 1
      if (padding > 2 || index < value.length - 2 || value.length % 4 != 0) {
        throw SvgPosterException("svg_invalid_input", "SVG Base64 输入无效。")
      }
    } else {
      throw SvgPosterException("svg_invalid_input", "SVG Base64 输入无效。")
    }
  }
}

private fun canonicalSvg(svgBase64: String): CanonicalSvg {
  validateBase64Envelope(svgBase64)
  val bytes = try {
    Base64.decode(svgBase64, Base64.NO_WRAP)
  } catch (error: IllegalArgumentException) {
    throw SvgPosterException("svg_invalid_input", "SVG Base64 输入无效。", error)
  }
  validateDecodedSvgSize(bytes)
  val text = try {
    Charsets.UTF_8
      .newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(bytes))
      .toString()
  } catch (error: Exception) {
    throw SvgPosterException("svg_invalid_input", "SVG 不是有效的 UTF-8 文本。", error)
  }
  val rootAttributes = validatedSvgRootAttributes(text)
  return CanonicalSvg(bytes, Base64.encodeToString(bytes, Base64.NO_WRAP), rootAttributes)
}

private fun validatedSvgRootAttributes(svg: String): SvgRootAttributes {
  if (svg.contains("<!DOCTYPE", ignoreCase = true) || svg.contains("<!ENTITY", ignoreCase = true)) {
    throw SvgPosterException("svg_invalid_input", "SVG 不允许 DTD 或实体声明。")
  }
  val document = try {
    DocumentBuilderFactory.newInstance().apply {
      isNamespaceAware = true
      isExpandEntityReferences = false
    }.newDocumentBuilder().apply {
      setEntityResolver { _, _ -> throw org.xml.sax.SAXException("external entity blocked") }
    }.parse(org.xml.sax.InputSource(StringReader(svg)))
  } catch (error: Exception) {
    throw SvgPosterException("svg_invalid_input", "SVG XML 结构无效。", error)
  }
  val root = document.documentElement
  val rootName = root?.localName ?: root?.nodeName
  if (!rootName.equals("svg", ignoreCase = true)) {
    throw SvgPosterException("svg_invalid_input", "SVG 根元素无效。")
  }
  return SvgRootAttributes(
    height = root.getAttribute("height").takeIf { root.hasAttribute("height") },
    viewBox = root.getAttribute("viewBox").takeIf { root.hasAttribute("viewBox") },
    width = root.getAttribute("width").takeIf { root.hasAttribute("width") }
  )
}

internal fun validateSvgDocument(svg: String) {
  validatedSvgRootAttributes(svg)
}

private fun positiveFinite(value: Double?): Double? =
  value?.takeIf { it.isFinite() && it > 0.0 }

private fun parseViewBox(value: String?): Pair<Double, Double>? {
  val values = value
    ?.split(Regex("[\\s,]+"))
    ?.filter { it.isNotEmpty() }
    ?.mapNotNull { it.toDoubleOrNull() }
    ?: return null
  if (values.size != 4) {
    return null
  }
  val width = positiveFinite(values[2]) ?: return null
  val height = positiveFinite(values[3]) ?: return null
  return width to height
}

private fun parseSvgLength(value: String?): Double? {
  val match = value?.let {
    Regex("^\\s*([+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s*([a-zA-Z%]*)\\s*$")
      .matchEntire(it)
  } ?: return null
  val number = positiveFinite(match.groupValues[1].toDoubleOrNull()) ?: return null
  val pixels = when (match.groupValues[2].lowercase(Locale.US)) {
    "", "px" -> number
    "in" -> number * 96.0
    "cm" -> number * 96.0 / 2.54
    "mm" -> number * 96.0 / 25.4
    "q" -> number * 96.0 / 101.6
    "pt" -> number * 96.0 / 72.0
    "pc" -> number * 16.0
    else -> return null
  }
  return positiveFinite(pixels)
}

internal fun computeSvgPosterDimensions(screenWidthPx: Int, svg: String): PosterDimensions =
  computeSvgPosterDimensions(screenWidthPx, validatedSvgRootAttributes(svg))

internal fun svgDocumentDimensions(svg: String): SvgDocumentDimensions? =
  svgDocumentDimensions(validatedSvgRootAttributes(svg))

private fun svgDocumentDimensions(attributes: SvgRootAttributes): SvgDocumentDimensions? {
  val explicitWidth = parseSvgLength(attributes.width)
  val explicitHeight = parseSvgLength(attributes.height)
  val viewBox = parseViewBox(attributes.viewBox)
  val intrinsic = when {
    explicitWidth != null && explicitHeight != null -> explicitWidth to explicitHeight
    explicitWidth != null && viewBox != null ->
      explicitWidth to (explicitWidth * viewBox.second / viewBox.first)
    explicitHeight != null && viewBox != null ->
      (explicitHeight * viewBox.first / viewBox.second) to explicitHeight
    viewBox != null -> viewBox
    else -> return null
  }
  val width = positiveFinite(intrinsic.first) ?: return null
  val height = positiveFinite(intrinsic.second) ?: return null
  return SvgDocumentDimensions(width, height)
}

private fun computeSvgPosterDimensions(
  screenWidthPx: Int,
  attributes: SvgRootAttributes
): PosterDimensions {
  val intrinsic = svgDocumentDimensions(attributes) ?: SvgDocumentDimensions(300.0, 150.0)
  val ratio = (intrinsic.height / intrinsic.width)
    .coerceIn(1.0 / MAX_POSTER_EDGE.toDouble(), MAX_POSTER_EDGE.toDouble())
  var width = screenWidthPx.coerceIn(1, MAX_POSTER_EDGE).toDouble()
  var height = width * ratio
  val pixelScale = sqrt(MAX_POSTER_PIXELS.toDouble() / (width * height))
  val scale = min(
    1.0,
    min(
      MAX_POSTER_EDGE.toDouble() / max(width, height),
      pixelScale
    )
  )
  width *= scale
  height *= scale
  var outputWidth = width.roundToInt().coerceIn(1, MAX_POSTER_EDGE)
  var outputHeight = height.roundToInt().coerceIn(1, MAX_POSTER_EDGE)
  val roundedPixels = outputWidth.toLong() * outputHeight.toLong()
  if (roundedPixels > MAX_POSTER_PIXELS) {
    val correction = sqrt(MAX_POSTER_PIXELS.toDouble() / roundedPixels.toDouble())
    outputWidth = (outputWidth * correction).toInt().coerceAtLeast(1)
    outputHeight = (outputHeight * correction).toInt().coerceAtLeast(1)
  }
  return PosterDimensions(outputWidth, outputHeight)
}

internal fun buildSvgPosterHtml(svgBase64: String, width: Int, height: Int): String {
  validateBase64Envelope(svgBase64)
  require(width in 1..MAX_POSTER_EDGE && height in 1..MAX_POSTER_EDGE)
  require(width.toLong() * height.toLong() <= MAX_POSTER_PIXELS)
  return """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="$SVG_POSTER_CSP">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}img{display:block;width:100%;height:100%;object-fit:contain}</style>
</head>
<body><img alt="" width="$width" height="$height" src="data:image/svg+xml;base64,$svgBase64"></body>
</html>"""
}

internal fun svgPosterCacheEntriesToEvict(
  entries: List<SvgPosterCacheEntry>,
  protectedName: String?,
  maxFiles: Int = MAX_POSTER_CACHE_FILES,
  maxBytes: Long = MAX_POSTER_CACHE_BYTES
): Set<String> {
  require(maxFiles >= 0 && maxBytes >= 0)
  val protectedEntries = entries.filter { it.name == protectedName }
  var keptFiles = protectedEntries.size
  var keptBytes = protectedEntries.sumOf { it.size.coerceAtLeast(0L) }
  val evictions = linkedSetOf<String>()
  entries
    .asSequence()
    .filter { it.name != protectedName }
    .sortedWith(compareByDescending<SvgPosterCacheEntry> { it.lastModified }.thenBy { it.name })
    .forEach { entry ->
      val size = entry.size.coerceAtLeast(0L)
      if (keptFiles < maxFiles && keptBytes + size <= maxBytes) {
        keptFiles += 1
        keptBytes += size
      } else {
        evictions.add(entry.name)
      }
    }
  return evictions
}

internal fun sha256PosterFileName(
  cacheKey: String,
  svgBytes: ByteArray,
  dimensions: PosterDimensions
): String {
  val keyBytes = cacheKey.toByteArray(Charsets.UTF_8)
  val digest = MessageDigest.getInstance("SHA-256")
  digest.update("wz-svg-poster-v1".toByteArray(Charsets.UTF_8))
  digest.update(keyBytes)
  digest.update(byteArrayOf(0))
  digest.update(svgBytes)
  digest.update(ByteBuffer.allocate(4).putInt(dimensions.width).array())
  digest.update(ByteBuffer.allocate(4).putInt(dimensions.height).array())
  val hex = buildString(64) {
    for (byte in digest.digest()) {
      append(String.format(Locale.US, "%02x", byte.toInt() and 0xff))
    }
  }
  return hex + ".png"
}

internal fun validCachedPosterBounds(
  width: Int,
  height: Int,
  expected: PosterDimensions
): Boolean =
  width == expected.width &&
    height == expected.height &&
    width in 1..MAX_POSTER_EDGE &&
    height in 1..MAX_POSTER_EDGE &&
    width.toLong() * height.toLong() <= MAX_POSTER_PIXELS

private fun validCachedPoster(file: File, expected: PosterDimensions): Boolean {
  if (!file.isFile || file.length() <= 0L || file.length() > MAX_POSTER_CACHE_BYTES) {
    return false
  }
  val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeFile(file.absolutePath, options)
  return options.outMimeType.equals("image/png", ignoreCase = true) &&
    validCachedPosterBounds(options.outWidth, options.outHeight, expected)
}

private fun pruneSvgPosterCache(cacheDir: File, protectedName: String?) {
  val files = cacheDir.listFiles()?.toList().orEmpty()
  files.filter { it.isFile && it.name.endsWith(".tmp") }.forEach { it.delete() }
  val pngFiles = files.filter { it.isFile && it.name.endsWith(".png") }
  val entries = pngFiles.map { SvgPosterCacheEntry(it.name, it.length(), it.lastModified()) }
  val evictions = svgPosterCacheEntriesToEvict(entries, protectedName)
  pngFiles.filter { it.name in evictions }.forEach { it.delete() }
}

private fun preparePoster(request: RenderRequest): PreparedPoster {
  validateSvgCacheKey(request.cacheKey)
  val svg = canonicalSvg(request.svgBase64)
  val dimensions = computeSvgPosterDimensions(
    request.context.resources.displayMetrics.widthPixels,
    svg.rootAttributes
  )
  val documentDimensions = svgDocumentDimensions(svg.rootAttributes)
    ?: SvgDocumentDimensions(dimensions.width.toDouble(), dimensions.height.toDouble())
  val cacheDir = File(request.context.cacheDir, POSTER_CACHE_DIR)
  if (!cacheDir.exists() && !cacheDir.mkdirs()) {
    throw SvgPosterException("svg_cache_failed", "无法创建 SVG 海报缓存目录。")
  }
  if (!cacheDir.isDirectory) {
    throw SvgPosterException("svg_cache_failed", "SVG 海报缓存路径无效。")
  }
  pruneSvgPosterCache(cacheDir, null)
  val outputFile = File(cacheDir, sha256PosterFileName(request.cacheKey, svg.bytes, dimensions))
  if (validCachedPoster(outputFile, dimensions)) {
    outputFile.setLastModified(System.currentTimeMillis())
    pruneSvgPosterCache(cacheDir, outputFile.name)
    return PreparedPoster(dimensions, documentDimensions, outputFile, "", true)
  }
  if (outputFile.exists()) {
    outputFile.delete()
  }
  return PreparedPoster(
    dimensions,
    documentDimensions,
    outputFile,
    buildSvgPosterHtml(svg.base64, dimensions.width, dimensions.height),
    false
  )
}

private fun writePosterBitmap(bitmap: Bitmap, outputFile: File) {
  val tempFile = File(outputFile.parentFile, "." + outputFile.nameWithoutExtension + ".tmp")
  if (tempFile.exists()) {
    tempFile.delete()
  }
  try {
    FileOutputStream(tempFile).use { output ->
      if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
        throw SvgPosterException("svg_render_failed", "SVG 海报 PNG 编码失败。")
      }
      output.flush()
      output.fd.sync()
    }
    Os.rename(tempFile.absolutePath, outputFile.absolutePath)
    outputFile.setLastModified(System.currentTimeMillis())
    pruneSvgPosterCache(outputFile.parentFile!!, outputFile.name)
  } finally {
    tempFile.delete()
  }
}

internal fun boundedSvgBytes(source: BufferedSource): ByteArray? {
  val buffer = Buffer()
  var total = 0L
  while (total <= MAX_SVG_BYTES.toLong()) {
    val read = source.read(
      buffer,
      min(8192L, MAX_SVG_BYTES.toLong() + 1L - total)
    )
    if (read == -1L) {
      return buffer.readByteArray()
    }
    total += read
  }
  return null
}

private fun isSvgResponseContentType(value: String?): Boolean {
  val mime = value?.substringBefore(';')?.trim()?.lowercase(Locale.US)
  return mime == "image/svg+xml" || mime == "application/svg+xml"
}

private object SvgDocumentFetcherRuntime {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val client by lazy {
    OkHttpClientProvider.getOkHttpClient().newBuilder()
      .build()
  }

  fun fetch(url: String, headers: ReadableMap, timeoutMs: Double, promise: Promise) {
    val parsed = Uri.parse(url)
    if (parsed.scheme != "http" && parsed.scheme != "https") {
      promise.reject("svg_invalid_url", "SVG 地址无效。")
      return
    }
    val request = try {
      Request.Builder()
        .url(url)
        .cacheControl(CacheControl.Builder().noCache().noStore().build())
        .apply {
          val iterator = headers.keySetIterator()
          while (iterator.hasNextKey()) {
            val name = iterator.nextKey()
            headers.getString(name)?.let { value -> header(name, value) }
          }
        }
        .build()
    } catch (error: Exception) {
      promise.reject("svg_invalid_request", "SVG 请求无效。", error)
      return
    }
    val call = client.newCall(request)
    call.timeout().timeout(boundedSvgFetchTimeoutMs(timeoutMs), TimeUnit.MILLISECONDS)
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        mainHandler.post { promise.reject("svg_fetch_failed", "SVG 读取失败。", error) }
      }

      override fun onResponse(call: Call, response: Response) {
        response.use {
          if (!response.isSuccessful || !isSvgResponseContentType(response.header("Content-Type"))) {
            mainHandler.post { promise.resolve(null) }
            return
          }
          val body = response.body ?: run {
            mainHandler.post { promise.resolve(null) }
            return
          }
          if (body.contentLength() > MAX_SVG_BYTES) {
            mainHandler.post { promise.resolve(null) }
            return
          }
          val bytes = try {
            boundedSvgBytes(body.source())
          } catch (error: IOException) {
            mainHandler.post { promise.reject("svg_fetch_failed", "SVG 读取失败。", error) }
            return
          }
          if (bytes == null) {
            mainHandler.post { promise.resolve(null) }
            return
          }
          val result = Arguments.createMap().apply {
            putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
          }
          mainHandler.post { promise.resolve(result) }
        }
      }
    })
  }
}

private object SvgPosterRendererRuntime {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val workExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "wz-svg-poster").apply { isDaemon = true }
  }
  private val ids = AtomicLong(1L)
  private val admittedRequests = AtomicInteger(0)
  private val queue = ArrayDeque<RenderRequest>()
  private var active: RenderRequest? = null
  private var webView: WebView? = null
  private val webViewCreations = AtomicInteger(0)

  fun webViewCreationCount(): Int = webViewCreations.get()

  fun enqueue(
    context: Context,
    svgBase64: String,
    cacheKey: String,
    timeoutMs: Long,
    promise: Promise
  ) {
    if (!tryAdmit()) {
      promise.reject("svg_queue_full", "SVG 海报渲染队列已满。")
      return
    }
    val request = RenderRequest(
      ids.getAndIncrement(),
      context,
      svgBase64,
      cacheKey,
      timeoutMs.coerceIn(1L, TOTAL_RENDER_TIMEOUT_MS),
      promise
    )
    mainHandler.post {
      if (request.settled) {
        return@post
      }
      if (!hasSvgPosterQueueCapacity(active != null, queue.size)) {
        fail(request, "svg_queue_full", "SVG 海报渲染队列已满。", null)
        return@post
      }
      val timeout = Runnable { timeout(request) }
      request.totalTimeout = timeout
      val remainingMs = request.deadlineUptimeMs - SystemClock.uptimeMillis()
      if (remainingMs <= 0L) {
        fail(request, "svg_render_timeout", "SVG 海报渲染总超时。", null)
        return@post
      }
      mainHandler.postDelayed(timeout, remainingMs)
      queue.addLast(request)
      startNext()
    }
  }

  private fun tryAdmit(): Boolean {
    while (true) {
      val current = admittedRequests.get()
      if (current >= MAX_RENDER_REQUESTS) {
        return false
      }
      if (admittedRequests.compareAndSet(current, current + 1)) {
        return true
      }
    }
  }

  private fun startNext() {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (active != null) {
      return
    }
    while (queue.isNotEmpty()) {
      val request = queue.removeFirst()
      if (request.settled) {
        continue
      }
      active = request
      workExecutor.execute {
        try {
          val prepared = preparePoster(request)
          mainHandler.post {
            if (!isCurrent(request)) {
              return@post
            }
            request.prepared = prepared
            if (prepared.cacheHit) {
              succeed(request, prepared)
            } else {
              loadPoster(request, prepared)
            }
          }
        } catch (error: SvgPosterException) {
          mainHandler.post { fail(request, error.code, error.message ?: "SVG 海报准备失败。", error) }
        } catch (error: Exception) {
          mainHandler.post { fail(request, "svg_render_failed", error.message ?: "SVG 海报准备失败。", error) }
        }
      }
      return
    }
  }

  private fun isCurrent(request: RenderRequest): Boolean =
    !request.settled && active === request

  @SuppressLint("SetJavaScriptEnabled")
  private fun rendererWebView(context: Context): WebView {
    webView?.let { return it }
    check(Looper.myLooper() == Looper.getMainLooper())
    val created = WebView(context.applicationContext)
    webViewCreations.incrementAndGet()
    created.setBackgroundColor(Color.TRANSPARENT)
    created.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    created.isFocusable = false
    created.isFocusableInTouchMode = false
    created.isLongClickable = false
    created.setDownloadListener { _, _, _, _, _ -> Unit }
    created.settings.apply {
      javaScriptEnabled = false
      javaScriptCanOpenWindowsAutomatically = false
      allowFileAccess = false
      allowContentAccess = false
      @Suppress("DEPRECATION")
      allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION")
      allowUniversalAccessFromFileURLs = false
      blockNetworkLoads = true
      blockNetworkImage = true
      loadsImagesAutomatically = true
      domStorageEnabled = false
      databaseEnabled = false
      setGeolocationEnabled(false)
      setSupportMultipleWindows(false)
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = false
      mediaPlaybackRequiresUserGesture = true
      cacheMode = WebSettings.LOAD_NO_CACHE
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(created, false)
    created.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

      @Suppress("DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = true

      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.url.scheme.equals("data", ignoreCase = true)) {
          return null
        }
        return blockedWebResource()
      }

      override fun onPageFinished(view: WebView, url: String) {
        pageFinished(view, url)
      }

      override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
      ) {
        val current = active ?: return
        if (isCurrentSvgPageError(current.expectedPageUrl, request.url.toString(), request.isForMainFrame)) {
          fail(current, "svg_page_failed", "Chromium 无法加载 SVG 海报页面。", null)
        }
      }

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        if (webView !== view) {
          view.destroy()
          return true
        }
        webView = null
        view.destroy()
        active?.let {
          fail(it, "svg_renderer_gone", "Chromium SVG 渲染进程已退出。", null)
        }
        return true
      }
    }
    webView = created
    return created
  }

  private fun blockedWebResource(): WebResourceResponse = WebResourceResponse(
    "text/plain",
    "UTF-8",
    403,
    "Blocked",
    mapOf("Cache-Control" to "no-store"),
    ByteArrayInputStream(ByteArray(0))
  )

  private fun loadPoster(request: RenderRequest, prepared: PreparedPoster) {
    if (!isCurrent(request)) {
      return
    }
    try {
      val view = rendererWebView(request.context)
      val widthSpec = View.MeasureSpec.makeMeasureSpec(prepared.dimensions.width, View.MeasureSpec.EXACTLY)
      val heightSpec = View.MeasureSpec.makeMeasureSpec(prepared.dimensions.height, View.MeasureSpec.EXACTLY)
      view.measure(widthSpec, heightSpec)
      view.layout(0, 0, prepared.dimensions.width, prepared.dimensions.height)
      view.scrollTo(0, 0)
      val pageUrl = "https://svg-renderer.invalid/render/" + request.id + "/"
      request.expectedPageUrl = pageUrl
      view.loadDataWithBaseURL(pageUrl, prepared.html, "text/html", "UTF-8", null)
    } catch (error: Exception) {
      fail(request, "svg_render_failed", error.message ?: "Chromium SVG 渲染启动失败。", error)
    }
  }

  private fun pageFinished(view: WebView, url: String) {
    val request = active ?: return
    if (!isCurrent(request) || request.expectedPageUrl != url || request.visualStateRequested) {
      return
    }
    request.visualStateRequested = true
    val visualTimeout = Runnable {
      fail(request, "svg_visual_timeout", "Chromium SVG 稳定帧等待超时。", null)
    }
    request.visualTimeout = visualTimeout
    mainHandler.postDelayed(visualTimeout, VISUAL_STATE_CALLBACK_TIMEOUT_MS)
    try {
      view.postVisualStateCallback(request.id, object : WebView.VisualStateCallback() {
        override fun onComplete(requestId: Long) {
          if (requestId != request.id || !isCurrent(request)) {
            return
          }
          request.visualTimeout?.let(mainHandler::removeCallbacks)
          val stableCapture = Runnable { capturePoster(request, view) }
          request.visualTimeout = stableCapture
          mainHandler.postDelayed(stableCapture, VISUAL_SETTLE_DELAY_MS)
        }
      })
    } catch (error: Exception) {
      fail(request, "svg_render_failed", error.message ?: "Chromium SVG 稳定帧请求失败。", error)
    }
  }

  private fun capturePoster(request: RenderRequest, view: WebView) {
    val prepared = request.prepared ?: run {
      fail(request, "svg_render_failed", "SVG 海报渲染状态无效。", null)
      return
    }
    if (!isCurrent(request) || request.captureStarted) {
      return
    }
    request.captureStarted = true
    val bitmap = try {
      Bitmap.createBitmap(
        prepared.dimensions.width,
        prepared.dimensions.height,
        Bitmap.Config.ARGB_8888
      ).also { target ->
        val canvas = Canvas(target)
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        view.draw(canvas)
      }
    } catch (error: OutOfMemoryError) {
      fail(request, "svg_render_oom", "SVG 海报渲染内存不足。", error)
      return
    } catch (error: Exception) {
      fail(request, "svg_render_failed", error.message ?: "SVG 海报取帧失败。", error)
      return
    }
    workExecutor.execute {
      try {
        writePosterBitmap(bitmap, prepared.outputFile)
        mainHandler.post { succeed(request, prepared) }
      } catch (error: SvgPosterException) {
        mainHandler.post { fail(request, error.code, error.message ?: "SVG 海报写入失败。", error) }
      } catch (error: Exception) {
        mainHandler.post { fail(request, "svg_cache_failed", error.message ?: "SVG 海报写入失败。", error) }
      } finally {
        bitmap.recycle()
      }
    }
  }

  private fun timeout(request: RenderRequest) {
    if (request.settled) {
      return
    }
    fail(request, "svg_render_timeout", "SVG 海报渲染总超时。", null)
  }

  private fun succeed(request: RenderRequest, prepared: PreparedPoster) {
    if (!settle(request)) {
      return
    }
    stopAndBlankRenderer()
    val result = Arguments.createMap()
    result.putString("uri", Uri.fromFile(prepared.outputFile).toString())
    result.putDouble("documentWidth", prepared.documentDimensions.width)
    result.putDouble("documentHeight", prepared.documentDimensions.height)
    result.putInt("width", prepared.dimensions.width)
    result.putInt("height", prepared.dimensions.height)
    request.promise.resolve(result)
    startNext()
  }

  private fun fail(request: RenderRequest, code: String, message: String, error: Throwable?) {
    val wasActive = active === request
    if (!settle(request)) {
      return
    }
    if (wasActive) {
      stopAndBlankRenderer()
    }
    if (error == null) {
      request.promise.reject(code, message)
    } else {
      request.promise.reject(code, message, error)
    }
    startNext()
  }

  private fun stopAndBlankRenderer() {
    try {
      webView?.let { view ->
        view.stopLoading()
        view.loadUrl("about:blank")
      }
    } catch (_: Exception) {
      // The request has already reached a terminal state. A dead renderer is recreated on demand.
    }
  }

  private fun settle(request: RenderRequest): Boolean {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (request.settled) {
      return false
    }
    request.settled = true
    request.totalTimeout?.let(mainHandler::removeCallbacks)
    request.visualTimeout?.let(mainHandler::removeCallbacks)
    request.totalTimeout = null
    request.visualTimeout = null
    queue.remove(request)
    if (active === request) {
      active = null
    }
    admittedRequests.decrementAndGet()
    return true
  }
}

internal fun svgPosterWebViewCreationCount(): Int =
  SvgPosterRendererRuntime.webViewCreationCount()

internal fun enqueueSvgPosterForTest(
  context: Context,
  svgBase64: String,
  cacheKey: String,
  promise: Promise
) {
  SvgPosterRendererRuntime.enqueue(
    context.applicationContext,
    svgBase64,
    cacheKey,
    TOTAL_RENDER_TIMEOUT_MS,
    promise
  )
}

class SvgRendererModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SvgRendererModule"

  @ReactMethod
  fun fetchSvgDocument(url: String, headers: ReadableMap, timeoutMs: Double, promise: Promise) {
    SvgDocumentFetcherRuntime.fetch(url, headers, timeoutMs, promise)
  }

  @ReactMethod
  fun renderPoster(svgBase64: String, cacheKey: String, timeoutMs: Double, promise: Promise) {
    SvgPosterRendererRuntime.enqueue(
      reactContext.applicationContext,
      svgBase64,
      cacheKey,
      timeoutMs.toLong(),
      promise
    )
  }
}

class SvgRendererPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(SvgRendererModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function svgRendererInstrumentedTestSource(packageName) {
  return String.raw`package ${packageName}

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import com.caverock.androidsvg.SVG
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SvgRendererInstrumentedTest {
  private val instrumentation
    get() = InstrumentationRegistry.getInstrumentation()

  private fun fixture(): String =
    instrumentation.context.assets.open("svg_renderer/complex-svg-document.svg")
      .bufferedReader()
      .use { it.readText() }

  private fun renderPoster(svg: String, cacheKey: String): ReadableMap {
    val settled = CountDownLatch(1)
    var result: ReadableMap? = null
    var failure: AssertionError? = null
    val promise = PromiseImpl(
      { arguments ->
        result = arguments.firstOrNull() as? ReadableMap
        settled.countDown()
      },
      { arguments ->
        failure = AssertionError("SVG poster rejected: " + arguments.joinToString())
        settled.countDown()
      }
    )
    enqueueSvgPosterForTest(
      instrumentation.targetContext,
      Base64.encodeToString(svg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
      cacheKey,
      promise
    )
    assertTrue("SVG poster did not settle", settled.await(35, TimeUnit.SECONDS))
    failure?.let { throw it }
    return checkNotNull(result)
  }

  private fun draw(view: WebView, width: Int, height: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    instrumentation.runOnMainSync { view.draw(Canvas(bitmap)) }
    return bitmap
  }

  @Test
  fun currentAndroidSvgFailsButChromiumPosterIsNonEmptyAndSingleton() {
    val svg = fixture()
    val legacyBitmap = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888)
    var legacyFailure: Throwable? = null
    try {
      SVG.getFromString(svg).renderToCanvas(Canvas(legacyBitmap))
    } catch (error: Throwable) {
      legacyFailure = error
    } finally {
      legacyBitmap.recycle()
    }
    assertTrue("fixture must preserve the AndroidSVG 1.4 failure", legacyFailure is NullPointerException)

    val before = svgPosterWebViewCreationCount()
    val nonce = System.nanoTime().toString()
    val posters = (0 until 10).map { index ->
      renderPoster(svg, "instrumented-" + nonce + "-" + index)
    }
    val after = svgPosterWebViewCreationCount()
    assertEquals("poster queue must reuse one WebView", 1, after - before)
    posters.forEach { poster ->
      val bitmap = checkNotNull(BitmapFactory.decodeFile(checkNotNull(Uri.parse(poster.getString("uri")).path)))
      try {
        assertEquals(poster.getInt("width"), bitmap.width)
        assertEquals(poster.getInt("height"), bitmap.height)
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        assertTrue("Chromium poster must contain visible pixels", pixels.any { Color.alpha(it) != 0 })
      } finally {
        bitmap.recycle()
      }
    }
  }

  @Test
  fun dynamicSvgAdvancesFramesWithoutExternalNetwork() {
    ServerSocket(0).use { server ->
      server.soTimeout = 500
      val externalUrl = "http://127.0.0.1:" + server.localPort + "/blocked.png"
      val svg = fixture().replace(
        "</svg>",
        "<image href=\"" + externalUrl + "\" width=\"1\" height=\"1\" />" +
          "<script>fetch('" + externalUrl + "')</script></svg>"
      )
      val html = buildSvgPosterHtml(
        Base64.encodeToString(svg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
        320,
        180
      )
      val ready = CountDownLatch(1)
      lateinit var view: WebView
      instrumentation.runOnMainSync {
        view = WebView(instrumentation.targetContext).apply {
          settings.javaScriptEnabled = false
          settings.allowFileAccess = false
          settings.allowContentAccess = false
          settings.blockNetworkLoads = true
          settings.blockNetworkImage = true
          webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
              view.postVisualStateCallback(1L, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                  ready.countDown()
                }
              })
            }
          }
          val widthSpec = View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY)
          val heightSpec = View.MeasureSpec.makeMeasureSpec(180, View.MeasureSpec.EXACTLY)
          measure(widthSpec, heightSpec)
          layout(0, 0, 320, 180)
          loadDataWithBaseURL("https://svg-renderer.invalid/test/", html, "text/html", "UTF-8", null)
        }
      }
      assertTrue("dynamic SVG did not reach a visual state", ready.await(10, TimeUnit.SECONDS))
      Thread.sleep(180)
      val first = draw(view, 320, 180)
      Thread.sleep(300)
      val second = draw(view, 320, 180)
      try {
        val firstPixels = IntArray(320 * 180)
        val secondPixels = IntArray(320 * 180)
        first.getPixels(firstPixels, 0, 320, 0, 0, 320, 180)
        second.getPixels(secondPixels, 0, 320, 0, 0, 320, 180)
        assertTrue("SMIL animation must change pixels", firstPixels.indices.any { firstPixels[it] != secondPixels[it] })
      } finally {
        first.recycle()
        second.recycle()
        instrumentation.runOnMainSync { view.destroy() }
      }
      try {
        server.accept().close()
        fail("untrusted SVG made an external request")
      } catch (_: SocketTimeoutException) {
        Unit
      }
    }
  }
}
`;
}

function svgRendererTestSource(packageName) {
  return String.raw`package ${packageName}

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SvgRendererPolicyTest {
  @Test
  fun enforcesDecodedInputAndCacheKeyLimits() {
    validateDecodedSvgSize(ByteArray(MAX_SVG_BYTES))
    assertThrows(Exception::class.java) {
      validateDecodedSvgSize(ByteArray(MAX_SVG_BYTES + 1))
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("")
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("x".repeat(MAX_SVG_CACHE_KEY_CHARS + 1))
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("svg-invalid\u0000key")
    }
  }

  @Test
  fun sizesAtScreenPixelsAndUsesExplicitViewportBeforeViewBox() {
    val explicitSquare = """<svg width="400" height="400" viewBox="0 0 16 9"></svg>"""
    assertEquals(PosterDimensions(1080, 1080), computeSvgPosterDimensions(1080, explicitSquare))

    val singleExplicitSide = """<svg width="320" viewBox="0 0 320 180"></svg>"""
    assertEquals(PosterDimensions(1080, 608), computeSvgPosterDimensions(1080, singleExplicitSide))

    val physicalUnits = """<svg width="2in" height="1in"></svg>"""
    assertEquals(PosterDimensions(1200, 600), computeSvgPosterDimensions(1200, physicalUnits))

    val commentDecoy = """<!-- <svg viewBox="0 0 1 100"> --><svg viewBox="0 0 2 1"></svg>"""
    assertEquals(PosterDimensions(1200, 600), computeSvgPosterDimensions(1200, commentDecoy))
  }

  @Test
  fun documentDimensionsComeFromTheValidatedDecodedRoot() {
    val encodedHeight = """<svg width="100" height="&#50;00" viewBox="0 0 1 1"></svg>"""
    assertEquals(SvgDocumentDimensions(100.0, 200.0), svgDocumentDimensions(encodedHeight))

    val commentDecoy = """<!-- <svg viewBox="0 0 1 100"> --><svg viewBox="0 0 2 1"></svg>"""
    assertEquals(SvgDocumentDimensions(2.0, 1.0), svgDocumentDimensions(commentDecoy))
  }

  @Test
  fun boundedReaderStopsAfterOneMiBPlusOneByte() {
    val exact = okio.Buffer().write(ByteArray(MAX_SVG_BYTES))
    assertEquals(MAX_SVG_BYTES, boundedSvgBytes(exact)?.size)

    val oversized = okio.Buffer().write(ByteArray(MAX_SVG_BYTES + 1024))
    assertNull(boundedSvgBytes(oversized))
    assertEquals(1023L, oversized.size)
  }

  @Test
  fun fetchTimeoutCannotOutliveTheRemainingRecoveryBudget() {
    assertEquals(250L, boundedSvgFetchTimeoutMs(250.9))
    assertEquals(10_000L, boundedSvgFetchTimeoutMs(15_000.0))
  }

  @Test
  fun posterDimensionsNeverExceedEdgeOrPixelBudgets() {
    val square = computeSvgPosterDimensions(4096, """<svg viewBox="0 0 1 1"></svg>""")
    assertTrue(square.width <= MAX_POSTER_EDGE)
    assertTrue(square.height <= MAX_POSTER_EDGE)
    assertTrue(square.width.toLong() * square.height.toLong() <= MAX_POSTER_PIXELS)

    val tall = computeSvgPosterDimensions(4096, """<svg viewBox="0 0 1 1000000"></svg>""")
    assertTrue(tall.width >= 1)
    assertTrue(tall.height <= MAX_POSTER_EDGE)
    assertTrue(tall.width.toLong() * tall.height.toLong() <= MAX_POSTER_PIXELS)
  }

  @Test
  fun generatedHtmlCarriesOnlyBase64SvgAndFailClosedPolicy() {
    val base64 = "PHN2ZyB2aWV3Qm94PVwiMCAwIDEgMVwiPjwvc3ZnPg=="
    val html = buildSvgPosterHtml(base64, 100, 100)
    assertTrue(html.contains("Content-Security-Policy"))
    assertTrue(html.contains("default-src 'none'"))
    assertTrue(html.contains("img-src data:"))
    assertTrue(html.contains("script-src 'none'"))
    assertTrue(html.contains("connect-src 'none'"))
    assertTrue(html.contains("object-src 'none'"))
    assertTrue(html.contains("data:image/svg+xml;base64," + base64))
    assertFalse(html.contains("<script"))
    assertFalse(html.contains("http://"))
    assertFalse(html.contains("https://"))
  }

  @Test
  fun rejectsMalformedXmlAndNonSvgRootsBeforeChromiumCanCacheABrokenImage() {
    validateSvgDocument("""<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>""")
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<svg><g></svg>""")
    }
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<html><svg /></html>""")
    }
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<!DOCTYPE svg SYSTEM "https://example.com/evil.dtd"><svg />""")
    }
  }

  @Test
  fun cachePolicyIsBoundedLruAndAlwaysProtectsReturnedFile() {
    val entries = listOf(
      SvgPosterCacheEntry("new.png", 40, 30),
      SvgPosterCacheEntry("middle.png", 40, 20),
      SvgPosterCacheEntry("old.png", 40, 10)
    )
    assertEquals(
      setOf("old.png"),
      svgPosterCacheEntriesToEvict(entries, null, maxFiles = 2, maxBytes = 100)
    )
    assertEquals(
      setOf("middle.png"),
      svgPosterCacheEntriesToEvict(entries, "old.png", maxFiles = 2, maxBytes = 100)
    )
  }

  @Test
  fun rendererQueueIsBoundedAndCountsTheActiveDocument() {
    assertTrue(hasSvgPosterQueueCapacity(active = false, queued = MAX_RENDER_REQUESTS - 1))
    assertFalse(hasSvgPosterQueueCapacity(active = false, queued = MAX_RENDER_REQUESTS))
    assertFalse(hasSvgPosterQueueCapacity(active = true, queued = MAX_RENDER_REQUESTS - 1))
  }

  @Test
  fun stalePageErrorsCannotFailTheCurrentRenderRequest() {
    val current = "https://svg-renderer.invalid/render/2/"
    assertTrue(isCurrentSvgPageError(current, current, isForMainFrame = true))
    assertFalse(isCurrentSvgPageError(current, "https://svg-renderer.invalid/render/1/", isForMainFrame = true))
    assertFalse(isCurrentSvgPageError(current, current, isForMainFrame = false))
  }

  @Test
  fun cacheIdentityIncludesSvgBytesAndCachedPngMustMatchExpectedBounds() {
    val dimensions = PosterDimensions(320, 180)
    val first = sha256PosterFileName("svg-0123456789abcdef", "first".toByteArray(), dimensions)
    val same = sha256PosterFileName("svg-0123456789abcdef", "first".toByteArray(), dimensions)
    val changed = sha256PosterFileName("svg-0123456789abcdef", "second".toByteArray(), dimensions)
    assertEquals(first, same)
    assertTrue(first.matches(Regex("[0-9a-f]{64}\\.png")))
    assertFalse(first == changed)

    assertTrue(validCachedPosterBounds(320, 180, dimensions))
    assertFalse(validCachedPosterBounds(321, 180, dimensions))
    assertFalse(validCachedPosterBounds(MAX_POSTER_EDGE + 1, 180, PosterDimensions(MAX_POSTER_EDGE + 1, 180)))
  }

  @Test
  fun sharedComplexSvgFixtureUsesItsViewBoxWithoutEmbeddingRawMarkupInHtml() {
    val fixture = checkNotNull(javaClass.classLoader?.getResource("svg_renderer/complex-svg-document.svg"))
      .readText()
    assertTrue(fixture.contains("<animate"))
    assertTrue(fixture.contains("<filter"))
    assertEquals(PosterDimensions(1080, 608), computeSvgPosterDimensions(1080, fixture))
  }
}
`;
}

function injectSvgRendererPackage(contents) {
  if (contents.includes('add(SvgRendererPackage())')) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error('无法注入 SvgRendererPackage：MainApplication 模板不匹配。');
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              add(SvgRendererPackage())`);
}

function injectSvgRendererTestSupport(contents) {
  let next = contents;
  if (!next.includes('testImplementation("junit:junit:4.13.2")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入 SVG renderer 原生测试依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(dependenciesPattern, (match) => `${match}\n    testImplementation("junit:junit:4.13.2")`);
  }
  if (!next.includes('androidTestImplementation("androidx.test:runner:1.6.2")')) {
    const dependenciesPattern = /dependencies\s*\{/;
    if (!dependenciesPattern.test(next)) {
      throw new Error('无法注入 SVG renderer instrumentation 依赖：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      dependenciesPattern,
      (match) => `${match}\n    androidTestImplementation("androidx.test:runner:1.6.2")\n    androidTestImplementation("androidx.test.ext:junit:1.2.1")`
    );
  }
  if (!next.includes('unitTests.returnDefaultValues = true')) {
    const androidPattern = /android\s*\{/;
    if (!androidPattern.test(next)) {
      throw new Error('无法配置 SVG renderer 原生测试：app build.gradle 模板不匹配。');
    }
    next = next.replace(androidPattern, (match) => `${match}\n    testOptions { unitTests.returnDefaultValues = true }`);
  }
  if (!next.includes('testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"')) {
    const defaultConfigPattern = /defaultConfig\s*\{/;
    if (!defaultConfigPattern.test(next)) {
      throw new Error('无法配置 SVG renderer instrumentation runner：app build.gradle 模板不匹配。');
    }
    next = next.replace(
      defaultConfigPattern,
      (match) => `${match}\n        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"`
    );
  }
  return next;
}

module.exports = function withSvgRendererModule(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = injectSvgRendererTestSupport(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, ['android', async (config) => {
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
    const testResourceDir = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'test',
      'resources',
      'svg_renderer'
    );
    const instrumentedTestOutputDir = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'androidTest',
      'java',
      packagePath(packageName)
    );
    const instrumentedTestAssetDir = path.join(
      config.modRequest.platformProjectRoot,
      'app',
      'src',
      'androidTest',
      'assets',
      'svg_renderer'
    );
    const fixturePath = path.join(
      config.modRequest.projectRoot,
      'tests',
      'fixtures',
      'complex-svg-document.svg'
    );
    if (!fs.existsSync(fixturePath)) {
      throw new Error('缺少 SVG renderer 共享 fixture，拒绝生成 Android 工程。');
    }
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.mkdirSync(testResourceDir, { recursive: true });
    fs.mkdirSync(instrumentedTestOutputDir, { recursive: true });
    fs.mkdirSync(instrumentedTestAssetDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'SvgRendererModule.kt'),
      svgRendererModuleSource(packageName)
    );
    fs.writeFileSync(
      path.join(testOutputDir, 'SvgRendererPolicyTest.kt'),
      svgRendererTestSource(packageName)
    );
    fs.writeFileSync(
      path.join(instrumentedTestOutputDir, 'SvgRendererInstrumentedTest.kt'),
      svgRendererInstrumentedTestSource(packageName)
    );
    fs.copyFileSync(
      fixturePath,
      path.join(testResourceDir, 'complex-svg-document.svg')
    );
    fs.copyFileSync(
      fixturePath,
      path.join(instrumentedTestAssetDir, 'complex-svg-document.svg')
    );
    return config;
  }]);

  return withMainApplication(config, (config) => {
    config.modResults.contents = injectSvgRendererPackage(config.modResults.contents);
    return config;
  });
};
