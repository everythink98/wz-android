package com.wz.reader

import android.content.ContentResolver
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.io.FilterOutputStream
import java.io.IOException
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

internal fun providerFaultStats(resolver: ContentResolver, uri: Uri, method: String = "stats"): Bundle =
  requireNotNull(resolver.call(uri, method, uri.pathSegments.first(), null))

internal fun awaitProviderFaultRelease(resolver: ContentResolver, uri: Uri): Bundle {
  val deadline = SystemClock.elapsedRealtime() + 10000
  while (true) {
    val stats = providerFaultStats(resolver, uri)
    if (stats.getBoolean("released")) return stats
    check(SystemClock.elapsedRealtime() < deadline) { "Provider descriptor was not released" }
    SystemClock.sleep(25)
  }
}

@RunWith(AndroidJUnit4::class)
class PlatformFileFaultInstrumentedTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val resolver = context.contentResolver

  private fun assertErrno(error: Throwable, expected: Int) {
    val errno = generateSequence(error) { it.cause }.filterIsInstance<ErrnoException>().firstOrNull()?.errno
    assertEquals("A real Android descriptor write must carry the provider errno: $error", expected, errno)
  }

  @Test fun backupWriterRejectsProviderIoAndQuotaErrorsAfterPartialWrites() {
    for ((mode, errno) in listOf("eio" to OsConstants.EIO, "enospc" to OsConstants.ENOSPC)) {
      val uri = PlatformFileFaultProvider.newUri(mode)
      try {
        val output = openBackupDocumentOutput(resolver, uri)
        val error = assertThrows(IOException::class.java) { writeBackupDocument(ByteArray(32768), output) {} }
        assertErrno(error, errno)
        val stats = awaitProviderFaultRelease(resolver, uri)
        assertEquals(PlatformFileFaultProvider.QUOTA_BYTES.toLong(), stats.getLong("bytes"))
        assertTrue(stats.getInt("writeErrors") > 0)
        instrumentation.sendStatus(0, Bundle().apply {
          putString("stream", "\nBACKUP_PROVIDER_FAILURE mode=$mode errno=$errno acceptedBytes=${stats.getLong("bytes")} released=true\n")
        })
      } finally { assertEquals(1, resolver.delete(uri, null, null)) }
    }
  }

  @Test fun managedImageDownloadPropagatesProviderEnospcAndRemovesItsPart() {
    val uri = PlatformFileFaultProvider.newUri("enospc")
    val directory = File(context.cacheDir, "owned-image-provider-fault-${System.nanoTime()}")
    var openedPart: File? = null
    try {
      MockWebServer().use { server ->
        server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
        server.enqueue(MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(ByteArray(65536))))
        val url = server.url("/quota.png").newBuilder().host("127.0.0.1").build()
        val call = NetworkProxyRuntime.imageCallFactory.newCall(Request.Builder().url(url)
          .tag(ImageRequestPurpose::class.java, ImageRequestPurpose.IMAGE_SAVE).build())
        val error = assertThrows(IOException::class.java) {
          streamImageDownload(call, directory, openOutput = { partial ->
            assertTrue("Production must create its owned part before opening output", partial.isFile)
            partial.writeBytes(byteArrayOf(1, 2, 3, 4))
            assertEquals(4L, partial.length())
            openedPart = partial
            requireNotNull(resolver.openOutputStream(uri, "wt"))
          }) {}
        }
        assertErrno(error, OsConstants.ENOSPC)
        val stats = awaitProviderFaultRelease(resolver, uri)
        assertEquals(PlatformFileFaultProvider.QUOTA_BYTES.toLong(), stats.getLong("bytes"))
        assertTrue(stats.getInt("writeErrors") > 0)
        assertNotNull("The failing output must have an existing nonempty owned part", openedPart)
        assertFalse("ENOSPC must remove that exact owned part", openedPart!!.exists())
        assertEquals(0, directory.listFiles()!!.size)
        instrumentation.sendStatus(0, Bundle().apply {
          putString("stream", "\nIMAGE_PROVIDER_ENOSPC errno=${OsConstants.ENOSPC} acceptedBytes=${stats.getLong("bytes")} released=true existingPartDeleted=true ownedParts=0 scope=controlled-provider-not-partition-exhaustion\n")
        })
      }
    } finally {
      resolver.delete(uri, null, null)
      directory.deleteRecursively()
    }
  }

  // The barrier only waits for a real remote PFD error; it never reads or throws it into the writer.
  @Test fun backupWriterRejectsAnAlreadyReportedReliableDescriptorErrorAtClose() {
    val uri = PlatformFileFaultProvider.newUri("close-error")
    try {
      val documentOutput = openBackupDocumentOutput(resolver, uri)
      val descriptor = (documentOutput as FileOutputStream).fd
      assertTrue(descriptor.valid())
      val output = object : FilterOutputStream(documentOutput) {
        override fun write(bytes: ByteArray, offset: Int, count: Int) = out.write(bytes, offset, count)
        override fun flush() {
          out.flush()
          val stats = providerFaultStats(resolver, uri, "await-close-error")
          assertEquals(PlatformFileFaultProvider.CLOSE_ERROR_BYTES.toLong(), stats.getLong("bytes"))
          assertNull(stats.getString("workerError"))
          assertTrue("Provider must report the remote error before local close", stats.getBoolean("remoteError"))
        }
      }
      val result = runCatching { writeBackupDocument(ByteArray(PlatformFileFaultProvider.CLOSE_ERROR_BYTES), output) {} }
      assertTrue("An already-reported provider close failure must not return a saved byte count; actual=$result", result.exceptionOrNull() is IOException)
      assertTrue(result.exceptionOrNull()?.message?.contains("provider-close-proof") == true)
      assertFalse("Error inspection must still close the local descriptor", descriptor.valid())
      instrumentation.sendStatus(0, Bundle().apply {
        putString("stream", "\nBACKUP_PROVIDER_CLOSE_FAILURE remoteError=provider-close-proof rejected=true localDescriptorClosed=true\n")
      })
    } finally { resolver.delete(uri, null, null) }
  }
}
