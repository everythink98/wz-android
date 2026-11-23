package com.wz.reader

import android.content.ContentResolver
import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.fonts.FontVariationAxis
import android.net.Uri
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

private const val FAMILY_PREFIX = "WzLocalFont_"
private const val MAX_FONT_BYTES = 32 * 1024 * 1024
private const val TTF_SIGNATURE = 0x00010000
private const val OTF_SIGNATURE = 0x4f54544f
private const val FVAR_TAG = 0x66766172
private const val WGHT_TAG = 0x77676874
private const val FIXED_ONE = 65536
private val familyPattern = Regex("WzLocalFont_[a-f0-9]{64}")
private val storedFontPattern = Regex("([a-f0-9]{64})-(.+)")
private const val INVALID_FONT = "请选择有效的 TTF 或 OTF 字体文件。"
private const val DOWNLOAD_SIZE_MISMATCH = "字体文件大小与发布版本不符，请重试。"

private class ReaderFontImportError(val feedback: String) : IllegalArgumentException(feedback)

internal fun copyReaderFont(
  input: InputStream,
  output: OutputStream,
  expectedHash: String? = null,
  expectedBytes: Int? = null,
  onBytesCopied: ((Int) -> Unit)? = null,
  checkActive: () -> Unit
): String {
  val source = DataInputStream(input)
  val signature = try {
    source.readInt()
  } catch (_: EOFException) {
    throw ReaderFontImportError(INVALID_FONT)
  }
  if (signature != TTF_SIGNATURE && signature != OTF_SIGNATURE) throw ReaderFontImportError(INVALID_FONT)
  val header = byteArrayOf(
    (signature ushr 24).toByte(), (signature ushr 16).toByte(),
    (signature ushr 8).toByte(), signature.toByte()
  )
  val digest = MessageDigest.getInstance("SHA-256")
  digest.update(header)
  output.write(header)
  var size = header.size
  val limit = expectedBytes ?: MAX_FONT_BYTES
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
  while (true) {
    checkActive()
    val count = source.read(buffer, 0, minOf(buffer.size, limit - size + 1))
    if (count == -1) break
    if (count == 0) throw ReaderFontImportError("无法读取所选字体，请重新选择。")
    if (count > limit - size) {
      throw ReaderFontImportError(if (expectedBytes == null) "字体文件须在 32 MiB 以内。" else DOWNLOAD_SIZE_MISMATCH)
    }
    digest.update(buffer, 0, count)
    output.write(buffer, 0, count)
    size += count
    onBytesCopied?.invoke(size)
  }
  if (expectedBytes != null && size != expectedBytes) throw ReaderFontImportError(DOWNLOAD_SIZE_MISMATCH)
  val hash = digest.digest().joinToString("") { "%02x".format(it) }
  if (expectedHash != null && expectedHash != hash) {
    throw ReaderFontImportError("字体文件校验失败，请重新下载。")
  }
  return hash
}

private fun verifiedFontUrl(url: HttpUrl?, hosts: Set<String>): HttpUrl =
  url?.takeIf { it.isHttps && it.port == 443 && it.username.isEmpty() && it.password.isEmpty() && it.host in hosts }
    ?: throw ReaderFontImportError("字体下载地址无效。")

private suspend fun <T> Call.useFontResponse(consume: (Response) -> T): T =
  suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    // Keep the response inside this cancellation scope through the last body read.
    continuation.resumeWith(runCatching { execute().use(consume) })
  }

private sealed interface FontDownloadResponse<out T> {
  data class Content<T>(val value: T) : FontDownloadResponse<T>
  data class Redirect(val url: HttpUrl) : FontDownloadResponse<Nothing>
}

internal suspend fun <T> requestFontDownload(client: Call.Factory, url: HttpUrl, consume: (Response) -> T): T {
  fun request(address: HttpUrl) = Request.Builder().url(address).header("Accept-Encoding", "identity").build()
  val initial = client.newCall(request(url)).useFontResponse { response ->
    if (response.isRedirect && url.host == "github.com") {
      FontDownloadResponse.Redirect(verifiedFontUrl(
        response.header("Location")?.let(url::resolve),
        setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")
      ))
    } else {
      FontDownloadResponse.Content(consume(response))
    }
  }
  return when (initial) {
    is FontDownloadResponse.Content -> initial.value
    is FontDownloadResponse.Redirect -> client.newCall(request(initial.url)).useFontResponse(consume)
  }
}

internal fun readerFontWeightAxis(buffer: ByteBuffer): ClosedFloatingPointRange<Float>? {
  val data = buffer.duplicate().order(ByteOrder.BIG_ENDIAN)
  val limit = data.limit()
  if (limit < 12 || (data.getInt(0) != TTF_SIGNATURE && data.getInt(0) != OTF_SIGNATURE)) return null
  fun unsignedShort(offset: Int) = data.getShort(offset).toInt() and 0xffff
  val tableCount = unsignedShort(4)
  if (tableCount > (limit - 12) / 16) return null
  val fvar = (0 until tableCount).asSequence().map { 12 + it * 16 }.firstOrNull { data.getInt(it) == FVAR_TAG }
    ?: return null
  val tableStart = data.getInt(fvar + 8)
  val tableSize = data.getInt(fvar + 12)
  if (tableSize !in 16..limit || tableStart !in 0..(limit - tableSize) || unsignedShort(tableStart) != 1) return null

  val axesOffset = unsignedShort(tableStart + 4)
  val axisCount = unsignedShort(tableStart + 8)
  val axisSize = unsignedShort(tableStart + 10)
  if (axesOffset !in 16..tableSize || axisSize < 20 || axisCount > (tableSize - axesOffset) / axisSize) return null
  for (index in 0 until axisCount) {
    val axis = tableStart + axesOffset + index * axisSize
    if (data.getInt(axis) != WGHT_TAG) continue
    val minimum = data.getInt(axis + 4)
    val default = data.getInt(axis + 8)
    val maximum = data.getInt(axis + 12)
    if (minimum < FIXED_ONE || maximum > 1000 * FIXED_ONE || minimum >= maximum || default !in minimum..maximum) return null
    return (minimum.toFloat() / FIXED_ONE)..(maximum.toFloat() / FIXED_ONE)
  }
  return null
}

internal object ReaderFontFiles {
  data class Entry(val file: File, val family: String, val name: String) {
    fun descriptor() = mapOf("family" to family, "name" to name)
  }

  private fun directory(context: Context) = File(context.noBackupFilesDir, "reader-fonts")

  fun entries(context: Context): List<Entry> = entries(directory(context))

  private fun entries(folder: File): List<Entry> =
    folder.listFiles().orEmpty().mapNotNull { file ->
      val (hash, name) = storedFontPattern.matchEntire(file.name)?.destructured ?: return@mapNotNull null
      if (file.isFile) Entry(file, FAMILY_PREFIX + hash, name) else null
    }

  fun readTypeface(file: File): Typeface? = try {
    val font = Font.Builder(file).build()
    val buffer = font.buffer
    val axis = readerFontWeightAxis(buffer)
    fun instance(weight: Int, range: ClosedFloatingPointRange<Float>): Font = Font.Builder(buffer)
      .setWeight(weight)
      .setSlant(font.style.slant)
      .setFontVariationSettings(arrayOf(FontVariationAxis("wght", weight.toFloat().coerceIn(range))))
      .build()
    // Keep style slots distinct even when a restricted axis clamps two requests to the same outline.
    val regular = if (axis != null) instance(400, axis) else font
    val family = FontFamily.Builder(regular)
    if (axis != null) {
      for (weight in intArrayOf(500, 600, 700)) family.addFont(instance(weight, axis))
    }
    Typeface.CustomFallbackBuilder(family.build())
      .setStyle(regular.style)
      .setSystemFallback("sans-serif")
      .build()
  } catch (_: IOException) {
    null
  } catch (_: IllegalArgumentException) {
    null
  }

  fun import(context: Context, rawUri: String, displayName: String, checkActive: () -> Unit): Pair<Entry, Typeface> {
    val uri = Uri.parse(rawUri)
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) throw ReaderFontImportError("请从系统文件选择器选择字体。")
    val source = context.contentResolver.openInputStream(uri)
      ?: throw ReaderFontImportError("无法打开所选字体。")
    return source.use { install(context, it, displayName, checkActive = checkActive) }
  }

  fun install(
    context: Context,
    source: InputStream,
    displayName: String,
    expectedHash: String? = null,
    expectedBytes: Int? = null,
    onBytesCopied: ((Int) -> Unit)? = null,
    onInstalling: (() -> Unit)? = null,
    checkActive: () -> Unit
  ): Pair<Entry, Typeface> {
    val folder = directory(context)
    if (!folder.isDirectory && !folder.mkdirs() && !folder.isDirectory) {
      throw ReaderFontImportError("无法保存字体，请检查存储空间。")
    }
    val temporary = File.createTempFile("import-", ".tmp", folder)
    try {
      val hash = temporary.outputStream().use { output ->
        copyReaderFont(source, output, expectedHash, expectedBytes, onBytesCopied, checkActive)
      }
      checkActive()
      onInstalling?.invoke()
      val typeface = readTypeface(temporary) ?: throw ReaderFontImportError(INVALID_FONT)
      checkActive()
      return publish(temporary, hash, displayName) to typeface
    } finally {
      temporary.delete()
    }
  }

  @Synchronized
  fun publish(temporary: File, hash: String, displayName: String): Entry {
    val family = FAMILY_PREFIX + hash
    val folder = checkNotNull(temporary.parentFile)
    val existing = entries(folder)
    val entry = existing.firstOrNull { it.family == family } ?: run {
      val title = displayName
        .replace(Regex("\\.(ttf|otf)$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("[\\p{C}\\p{Zl}\\p{Zp}/\\\\]"), " ")
        .trim()
        .ifEmpty { "本地字体" }
      val baseName = title.substring(0, title.offsetByCodePoints(0, minOf(40, title.codePointCount(0, title.length))))
      val names = existing.mapTo(HashSet()) { it.name }
      val name = generateSequence(2) { it + 1 }.map { "$baseName ($it)" }
        .let { sequenceOf(baseName).plus(it).first { candidate -> candidate !in names } }
      Entry(File(folder, "$hash-$name"), family, name)
    }
    // A verified copy can repair the file for an existing family without changing its reference.
    try {
      Files.move(temporary.toPath(), entry.file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } catch (_: IOException) {
      throw ReaderFontImportError("无法保存字体，请检查存储空间。")
    }
    return entry
  }
}

class ReaderFontsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext).applicationContext

  override fun definition() = ModuleDefinition {
    Name("ReaderFonts")
    Events("downloadProgress")

    AsyncFunction("list") Coroutine { ->
      withContext(Dispatchers.IO) {
        ReaderFontFiles.entries(context).sortedBy { it.name }.map { it.descriptor() }
      }
    }

    AsyncFunction("prepare") Coroutine { family: String ->
      if (!familyPattern.matches(family)) return@Coroutine false
      if (withContext(Dispatchers.Main) { family in registered }) return@Coroutine true
      val typeface = withContext(Dispatchers.IO) {
        val entry = ReaderFontFiles.entries(context).firstOrNull { it.family == family }
        entry?.let { ReaderFontFiles.readTypeface(it.file) }
      } ?: return@Coroutine false
      register(family, typeface)
      true
    }

    AsyncFunction("add") Coroutine { uri: String, name: String ->
      val (entry, typeface) = try {
        withContext(Dispatchers.IO) {
          val operation = currentCoroutineContext()
          ReaderFontFiles.import(context, uri, name) { operation.ensureActive() }
        }
      } catch (error: ReaderFontImportError) {
        return@Coroutine mapOf("error" to error.feedback)
      } catch (_: IOException) {
        return@Coroutine mapOf("error" to "无法导入字体，请检查文件和存储空间。")
      } catch (_: SecurityException) {
        return@Coroutine mapOf("error" to "无法读取所选文件，请重新选择。")
      }
      register(entry.family, typeface)
      mapOf("font" to entry.descriptor())
    }

    AsyncFunction("download") Coroutine { rawUrl: String, family: String, name: String, byteCount: Int ->
      val (entry, typeface) = try {
        withContext(Dispatchers.IO) {
          if (!familyPattern.matches(family) || byteCount !in 4..MAX_FONT_BYTES) {
            throw ReaderFontImportError("字体版本无效。")
          }
          ReaderFontFiles.entries(context).firstOrNull { it.family == family }?.let { existing ->
            val typeface = ReaderFontFiles.readTypeface(existing.file)
            if (typeface != null) {
              reportProgress(family, "installing")
              return@withContext existing to typeface
            }
          }
          val url = verifiedFontUrl(rawUrl.toHttpUrlOrNull(), setOf("raw.githubusercontent.com", "github.com"))
          val operation = currentCoroutineContext()
          val client = NetworkProxyRuntime.configureManagedClient(OkHttpClient.Builder())
            .cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.MINUTES)
            .build()
          requestFontDownload(client, url) { response ->
            val body = response.body
            if (!response.isSuccessful || body == null) throw IOException("Font response unavailable")
            var reportedPercent = 0
            // Some proxies omit Content-Length. The catalog pins the actual file size alongside its hash.
            reportProgress(family, "downloading", reportedPercent)
            ReaderFontFiles.install(
              context, body.byteStream(), name, family.removePrefix(FAMILY_PREFIX),
              expectedBytes = byteCount,
              onBytesCopied = { size ->
                val percent = (size * 100L / byteCount).toInt().coerceAtMost(99)
                if (percent > reportedPercent) {
                  reportedPercent = percent
                  reportProgress(family, "downloading", percent)
                }
              },
              onInstalling = { reportProgress(family, "installing") }
            ) { operation.ensureActive() }
          }
        }
      } catch (error: ReaderFontImportError) {
        return@Coroutine mapOf("error" to error.feedback)
      } catch (_: IOException) {
        return@Coroutine mapOf("error" to "字体下载失败，请检查网络或存储空间后重试。")
      }
      register(entry.family, typeface)
      mapOf("font" to entry.descriptor())
    }
  }

  private fun reportProgress(family: String, phase: String, percent: Int? = null) {
    val progress = buildMap {
      put("phase", phase)
      if (percent != null) put("percent", percent)
    }
    sendEvent("downloadProgress", mapOf("family" to family, "progress" to progress))
  }

  private suspend fun register(family: String, typeface: Typeface) = withContext(Dispatchers.Main) {
    if (registered.add(family)) ReactFontManager.getInstance().addCustomFont(family, typeface)
  }

  private companion object {
    // ReactFontManager persists across React instances. All registrations are published on Main.
    val registered = HashSet<String>()
  }
}
