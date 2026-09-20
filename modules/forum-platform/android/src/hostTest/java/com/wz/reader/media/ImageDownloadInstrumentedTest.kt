package com.wz.reader

import android.content.Intent
import android.os.Bundle
import android.os.Debug
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ImageDownloadInstrumentedTest {
  @Test fun managedCancellationAndOutputFailureLeaveNoPartialFile() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val directory = File(context.cacheDir, "image-stream-failure-proof-${System.nanoTime()}")
    try {
      for (mode in listOf("cancel", "output-failure")) {
        okhttp3.mockwebserver.MockWebServer().use { server ->
          server.enqueue(okhttp3.mockwebserver.MockResponse().setHeader("Content-Type", "image/png").setBody(okio.Buffer().write(ByteArray(1024 * 1024))))
          val call = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(server.url("/failure.png"))
            .tag(ImageRequestPurpose::class.java, ImageRequestPurpose.IMAGE_SAVE).build())
          var chunks = 0
          var outputAttempted = false
          val failure = assertThrows(IOException::class.java) {
            streamImageDownload(call, directory,
              openOutput = {
                outputAttempted = true
                if (mode == "output-failure") java.io.FileOutputStream("/dev/full") else it.outputStream()
              }) {
              if (mode == "cancel" && ++chunks == 3) call.cancel()
            }
          }
          assertTrue("failure must occur after accepting the managed response", outputAttempted)
          if (mode == "cancel") assertTrue(call.isCanceled())
          assertEquals(0, directory.listFiles()!!.size)
          InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
            putString("stream", "\nIMAGE_STREAM_FAILURE mode=$mode cleanup=verified exception=${failure.javaClass.simpleName}:${failure.message}\n")
          })
        }
      }
    } finally { directory.deleteRecursively() }
  }

  @Test fun managedStreamingPreservesBytesWithoutAWholeBodyAllocation() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val directory = File(context.cacheDir, "image-stream-proof-${System.nanoTime()}")
    val block = ByteArray(32 * 1024) { (it % 251).toByte() }
    val worker = Executors.newSingleThreadExecutor()
    try {
      for (mib in listOf(1, 25, 100)) {
        val size = mib.toLong() * 1024 * 1024
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
          val expected = worker.submit<String> {
            val digest = MessageDigest.getInstance("SHA-256")
            server.accept().use { socket ->
              val reader = socket.getInputStream().bufferedReader()
              while (!reader.readLine().isNullOrEmpty()) Unit
              socket.getOutputStream().use { output ->
                output.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: $size\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
                repeat((size / block.size).toInt()) { output.write(block); digest.update(block) }
                output.flush()
              }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
          }
          val request = Request.Builder().url("http://127.0.0.1:${server.localPort}/$mib.png")
            .tag(ImageRequestPurpose::class.java, ImageRequestPurpose.IMAGE_SAVE).build()
          val call = NetworkProxyRuntime.imageCallFactory.newCall(request)
          call.timeout().timeout(15, TimeUnit.SECONDS)
          val runtime = Runtime.getRuntime()
          fun heap() = runtime.totalMemory() - runtime.freeMemory()
          val startHeap = heap()
          val startPss = Debug.getPss()
          var peakHeap = startHeap
          var peakPss = startPss
          var chunks = 0
          val result = streamImageDownload(call, directory) {
            peakHeap = maxOf(peakHeap, heap())
            if (++chunks % 64 == 0) peakPss = maxOf(peakPss, Debug.getPss())
          }
          val actualDigest = MessageDigest.getInstance("SHA-256")
          result.file.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) { val count = input.read(buffer); if (count == -1) break; actualDigest.update(buffer, 0, count) }
          }
          assertEquals(expected.get(20, TimeUnit.SECONDS), actualDigest.digest().joinToString("") { "%02x".format(it) })
          assertEquals(size, result.byteCount)
          assertEquals(size, result.file.length())
          assertTrue(result.file.delete())
          instrumentation.sendStatus(0, Bundle().apply {
            putString("stream", "\nIMAGE_STREAM mib=$mib bytes=$size hash=verified chunks=$chunks heapStart=$startHeap heapPeak=$peakHeap pssStartKb=$startPss pssPeakKb=$peakPss\n")
          })
        }
      }
      assertEquals(0, directory.listFiles()!!.size)
    } finally {
      worker.shutdownNow()
      directory.deleteRecursively()
      instrumentation.runOnMainSync { activity.finish() }
    }
  }
}
