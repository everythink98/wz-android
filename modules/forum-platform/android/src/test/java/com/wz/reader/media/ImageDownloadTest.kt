package com.wz.reader

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class ImageDownloadTest {
  private fun withDownload(response: MockResponse, test: (MockWebServer, File) -> Unit) {
    val directory = Files.createTempDirectory("image-download-test").toFile()
    MockWebServer().use { server ->
      server.enqueue(response)
      try { test(server, directory) } finally { directory.deleteRecursively() }
    }
  }

  @Test fun streamsAllBytesAndUsesTheResponseExtension() {
    val bytes = ByteArray(1024 * 1024 + 13) { (it % 251).toByte() }
    withDownload(MockResponse().setHeader("Content-Type", "image/avif").setBody(Buffer().write(bytes))) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/wrong.jpg")).build())
      val result = streamImageDownload(call, directory) {}
      assertEquals(bytes.size.toLong(), result.byteCount)
      assertEquals("avif", result.file.extension)
      assertArrayEquals(bytes, result.file.readBytes())
      assertEquals(listOf(result.file), directory.listFiles()!!.toList())
    }
  }

  @Test fun rejectsHtmlWithoutLeavingAPartialFile() {
    withDownload(MockResponse().setHeader("Content-Type", "text/html").setBody("challenge")) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/image.png")).build())
      assertThrows(IOException::class.java) { streamImageDownload(call, directory) {} }
      assertEquals(0, directory.listFiles()!!.size)
    }
  }

  @Test fun cancellationBetweenChunksClosesResponseAndDeletesPartialFile() {
    withDownload(MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(ByteArray(100000)))) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/image.png")).build())
      var chunks = 0
      assertThrows(IOException::class.java) {
        streamImageDownload(call, directory) { if (++chunks == 3) throw IOException("canceled") }
      }
      assertEquals(3, chunks)
      assertEquals(0, directory.listFiles()!!.size)
    }
  }

  @Test fun interruptedAndTimedOutBodiesRemoveTheAlreadyOpenedOutput() {
    for (timeout in listOf(false, true)) {
      val response = MockResponse().setHeader("Content-Type", "image/png")
        .setBody(Buffer().write(ByteArray(64 * 1024)))
      if (timeout) response.setBodyDelay(2, TimeUnit.SECONDS)
      else response.setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
      withDownload(response) { server, directory ->
        val call = OkHttpClient().newCall(Request.Builder().url(server.url("/body.png")).build())
        if (timeout) call.timeout().timeout(750, TimeUnit.MILLISECONDS)
        var outputOpened = false
        assertThrows(IOException::class.java) {
          streamImageDownload(call, directory, openOutput = { file ->
            outputOpened = true
            file.outputStream()
          }) {}
        }
        assertTrue("failure must occur during body transfer, not while waiting for headers", outputOpened)
        assertEquals(0, directory.listFiles()!!.size)
      }
    }
  }
}
