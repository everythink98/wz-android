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
  @Test fun aCompletedFileWithTheSameNameSurvivesANewWriter() {
    val directory = Files.createTempDirectory("image-name-test").toFile()
    try {
      lateinit var previous: File
      assertThrows(IOException::class.java) {
        writeTemporaryImage(directory, "image-", {}) { partial ->
          previous = File(directory, "${partial.nameWithoutExtension}.png").apply { writeText("previous") }
          partial.writeText("new")
          "png"
        }
      }
      assertEquals("previous", previous.readText())
      assertEquals(listOf(previous), directory.listFiles()!!.toList())
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test fun oneHandleOwnsOneFileUntilReleaseAndRejectsLateCompletion() {
    val directory = Files.createTempDirectory("image-operation-test").toFile()
    try {
      var interruptions = 0
      val operation = TemporaryImageOperation()
      operation.start { interruptions++ }
      assertThrows(IllegalStateException::class.java) { operation.start() }
      val completed = File(directory, "completed.png").apply { writeText("image") }
      operation.publish(completed)
      operation.cancel()
      assertTrue(completed.exists())
      operation.release()
      assertFalse(completed.exists())
      assertEquals(0, interruptions)

      val early = TemporaryImageOperation()
      early.start { interruptions++ }
      early.release()
      early.release()
      assertEquals(1, interruptions)
      val late = File(directory, "late.png").apply { writeText("image") }
      assertThrows(IOException::class.java) { early.publish(late) }
      assertFalse(late.exists())
      assertThrows(IOException::class.java) { early.start() }
    } finally {
      directory.deleteRecursively()
    }
  }

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

  @Test fun rejectsHtmlWithoutLeavingAPartialFileEvenWhenTheImageMimeIsWrong() {
    val html = "\uFEFF  <!-- origin error -->\n<!DOCTYPE html><html><body>missing image</body></html>"
    for (type in listOf("text/html", "image/png", "image/svg+xml")) {
      withDownload(MockResponse().setHeader("Content-Type", type).setBody(html)) { server, directory ->
        val call = OkHttpClient().newCall(Request.Builder().url(server.url("/image.png")).build())
        assertThrows(IOException::class.java) { streamImageDownload(call, directory) {} }
        assertEquals(0, directory.listFiles()!!.size)
      }
    }
  }

  @Test fun genericResponsesUseTheSvgRootWithinTheBoundedPrefix() {
    val svg = """<?xml version="1.0"?><!-- illustration --><svg xmlns="http://www.w3.org/2000/svg"/>"""
    withDownload(MockResponse().setHeader("Content-Type", "application/octet-stream").setBody(svg)) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/wrong.gif")).build())
      val result = streamImageDownload(call, directory) {}
      assertEquals("image/svg+xml", result.contentType)
      assertEquals("svg", result.file.extension)
      assertEquals(svg, result.file.readText())
    }
    for (text in listOf("<html>$svg</html>", " ".repeat(1024) + svg)) {
      withDownload(MockResponse().setBody(text)) { server, directory ->
        val call = OkHttpClient().newCall(Request.Builder().url(server.url("/false.svg")).build())
        assertThrows(IOException::class.java) { streamImageDownload(call, directory) {} }
        assertEquals(0, directory.listFiles()!!.size)
      }
    }
  }

  @Test fun declaredImageRejectsAnHtmlFragmentButKeepsAnSvgWithANamespacePrefix() {
    val fragment = """<meta charset="utf-8"><main>Image unavailable</main>"""
    withDownload(MockResponse().setHeader("Content-Type", "image/png").setBody(fragment)) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/original.png")).build())
      assertThrows(IOException::class.java) { streamImageDownload(call, directory) {} }
      assertEquals(0, directory.listFiles()!!.size)
    }
    val svg = """<s:svg xmlns:s="http://www.w3.org/2000/svg"/>"""
    withDownload(MockResponse().setHeader("Content-Type", "image/svg+xml").setBody(svg)) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/original.svg")).build())
      assertEquals(svg, streamImageDownload(call, directory) {}.file.readText())
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

  @Test fun cancellationAtFilePublicationDoesNotDeliverOrLeaveTheDownloadedImage() {
    withDownload(MockResponse().setHeader("Content-Type", "image/png").setBody("image content")) { server, directory ->
      val call = OkHttpClient().newCall(Request.Builder().url(server.url("/cover.png")).build())
      val unrelated = File(directory, "existing.png").apply { writeText("keep") }
      assertThrows(IOException::class.java) {
        streamImageDownload(call, directory) {
          if (directory.listFiles()!!.any { it != unrelated && it.extension == "png" }) throw IOException("canceled")
        }
      }
      assertEquals(listOf(unrelated), directory.listFiles()!!.toList())
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
