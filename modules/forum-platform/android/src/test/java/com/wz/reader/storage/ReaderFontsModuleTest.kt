package com.wz.reader

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ReaderFontsModuleTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun checksSignaturesAndHashesTheOriginalBytes() {
    val ttf = byteArrayOf(0, 1, 0, 0, -1, 42)
    val otf = "OTTO\u0000\u0001".toByteArray()
    for (source in listOf(ttf, otf)) {
      val output = ByteArrayOutputStream()
      val familyHash = copyReaderFont(ByteArrayInputStream(source), output) {}
      val expected = MessageDigest.getInstance("SHA-256").digest(source).joinToString("") { "%02x".format(it) }
      assertEquals(expected, familyHash)
      assertArrayEquals(source, output.toByteArray())
    }
  }

  @Test
  fun rejectsNonFontDocumentsBeforeCopyingTheirBytes() {
    for (source in listOf("ttcf", "wOFF", "%PDF", "O")) {
      val output = ByteArrayOutputStream()
      assertThrows(IllegalArgumentException::class.java) {
        copyReaderFont(source.byteInputStream(), output) {}
      }
      assertEquals(0, output.size())
    }
  }

  @Test
  fun acceptsOnlyThePinnedContentForAFontDownload() {
    val font = byteArrayOf(0, 1, 0, 0, 7, 14)
    val expected = MessageDigest.getInstance("SHA-256").digest(font).joinToString("") { "%02x".format(it) }
    val output = ByteArrayOutputStream()
    assertEquals(expected, copyReaderFont(font.inputStream(), output, expected) {})
    assertArrayEquals(font, output.toByteArray())

    val changed = font.copyOf().apply { this[lastIndex] = 15 }
    assertThrows(IllegalArgumentException::class.java) {
      copyReaderFont(changed.inputStream(), ByteArrayOutputStream(), expected) {}
    }
  }

  @Test
  fun reportsCopiedBytesAgainstThePinnedSizeAndRejectsIncompleteDownloads() {
    val font = byteArrayOf(0, 1, 0, 0, 7, 14)
    val copied = mutableListOf<Int>()
    copyReaderFont(font.inputStream(), ByteArrayOutputStream(), expectedBytes = font.size, onBytesCopied = { copied.add(it) }) {}
    assertEquals(listOf(font.size), copied)

    for (size in listOf(font.size - 1, font.size + 1)) {
      assertThrows(IllegalArgumentException::class.java) {
        copyReaderFont(font.inputStream(), ByteArrayOutputStream(), expectedBytes = size) {}
      }
    }
  }

  @Test
  fun replacesCorruptInstalledBytesWithoutChangingTheFontReference() {
    val hash = "a".repeat(64)
    val stored = folder.newFile("$hash-Inter").apply { writeBytes(byteArrayOf(0)) }
    val verifiedBytes = byteArrayOf(0, 1, 0, 0, 7, 14)
    val temporary = folder.newFile("new-font.tmp").apply { writeBytes(verifiedBytes) }
    val published = ReaderFontFiles.publish(temporary, hash, "Inter.ttf")

    assertEquals("WzLocalFont_$hash", published.family)
    assertEquals("Inter", published.name)
    assertEquals(stored, published.file)
    assertArrayEquals(verifiedBytes, stored.readBytes())
    assertEquals(listOf(stored), folder.root.listFiles()?.toList())
  }

  @Test
  fun acceptsGitHubAssetHostsAndRejectsOtherRedirects() {
    fun getFromRelease(location: String): String = runBlocking {
      val client = OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val redirect = request.url.host == "github.com"
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
          .code(if (redirect) 302 else 200).message("Font response")
          .header("Location", location).body(request.url.host.toResponseBody()).build()
      }.build()
      requestFontDownload(client, "https://github.com/example/fonts/releases/download/v1/Font.ttf".toHttpUrl()) {
        checkNotNull(it.body).string()
      }
    }

    for (host in listOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")) {
      assertEquals(host, getFromRelease("https://$host/font.ttf"))
    }
    for (url in listOf(
      "https://githubusercontent.example/font.ttf",
      "http://objects.githubusercontent.com/font.ttf",
      "https://example@objects.githubusercontent.com/font.ttf",
      "https://objects.githubusercontent.com:8443/font.ttf"
    )) {
      assertThrows(IllegalArgumentException::class.java) { getFromRelease(url) }
    }
  }

  @Test
  fun cancelsFontCallsWaitingForHeadersAndStreamingTheBody() = runBlocking {
    for (hasHeaders in listOf(false, true)) {
      supervisorScope {
        MockWebServer().use { server ->
          server.enqueue(if (hasHeaders) {
            MockResponse().setBody("font").setBodyDelay(3, TimeUnit.SECONDS)
          } else {
            MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
          })
          val cancelled = CompletableDeferred<Unit>()
          val reading = CompletableDeferred<Unit>()
          val client = OkHttpClient.Builder().eventListener(object : EventListener() {
            override fun canceled(call: Call) { cancelled.complete(Unit) }
          }).build()
          val download = async(Dispatchers.IO) {
            requestFontDownload(client, server.url("/font.ttf")) {
              reading.complete(Unit)
              checkNotNull(it.body).string()
            }
          }
          try {
            assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(5, TimeUnit.SECONDS) })
            if (hasHeaders) assertNotNull(withTimeoutOrNull(5000) { reading.await() })
            download.cancel()
            assertNotNull("Cancelling the coroutine must cancel the blocked call", withTimeoutOrNull(1500) { cancelled.await() })
          } finally {
            client.dispatcher.cancelAll()
            download.join()
          }
        }
      }
    }
  }

  @Test
  fun readsOnlyAWellFormedWeightAxis() {
    // sfnt header, one table record, fvar header and one axis record.
    val font = ByteBuffer.allocate(64)
    font.putInt(0x00010000).putShort(1).position(12)
    font.putInt(0x66766172).putInt(0).putInt(28).putInt(36)
    font.putShort(1).putShort(0).putShort(16).putShort(2).putShort(1).putShort(20).putInt(0)
    font.putInt(0x77676874).putInt(325 * 65536 + 32768).putInt(400 * 65536).putInt(650 * 65536 + 16384).putInt(0)

    val buffer = font.asReadOnlyBuffer().apply {
      position(7)
      order(ByteOrder.LITTLE_ENDIAN)
    }
    assertEquals(325.5f..650.25f, readerFontWeightAxis(buffer))
    assertEquals(7, buffer.position())
    assertEquals(ByteOrder.LITTLE_ENDIAN, buffer.order())
    assertNull(readerFontWeightAxis(font.duplicate().apply { limit(63) }))
    font.putInt(44, 0x77647468) // wdth with no wght axis.
    assertNull(readerFontWeightAxis(font))
    font.putInt(44, 0x77676874).putInt(20, -1) // Invalid fvar offset.
    assertNull(readerFontWeightAxis(font))
  }
}
