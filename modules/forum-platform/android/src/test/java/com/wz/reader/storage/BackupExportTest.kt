package com.wz.reader

import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class BackupExportTest {
  @Test fun destroyedOwnerRejectsItsPendingResultAndReplacementIgnoresLateResults() {
    val original = BackupExportOwner()
    val abandoned = original.begin()
    original.destroy()
    assertThrows(IllegalStateException::class.java) { runBlocking { abandoned.result.await() } }
    assertThrows(IllegalStateException::class.java) { original.begin() }

    val replacement = BackupExportOwner()
    val current = replacement.begin()
    assertNotEquals(abandoned.requestCode, current.requestCode)
    replacement.complete(abandoned.requestCode, BackupDocumentResult.Canceled)
    assertFalse("old Activity result cannot settle a replacement invocation", current.result.isCompleted)
    replacement.complete(current.requestCode, BackupDocumentResult.Canceled)
    assertEquals(BackupDocumentResult.Canceled, runBlocking { current.result.await() })
    replacement.finish(current)
    replacement.begin()
  }

  @Test fun providerResultDoesNotReleaseBusyUntilWritingFinishes() {
    val owner = BackupExportOwner()
    val first = owner.begin()
    owner.complete(first.requestCode, BackupDocumentResult.Failed("provider result missing"))
    assertThrows(IllegalStateException::class.java) { owner.begin() }
    owner.finish(first)
    val next = owner.begin()
    owner.finish(first)
    assertThrows(IllegalStateException::class.java) { owner.begin() }
    owner.complete(next.requestCode, BackupDocumentResult.Canceled)
    assertEquals(BackupDocumentResult.Canceled, runBlocking { next.result.await() })
    owner.finish(next)
  }

  @Test fun malformedActivityResultsReturnToTheCoroutineWithoutThrowingOnTheMainThread() {
    val contract = BackupDocumentContract()
    assertTrue(contract.parseResult("backup.json", android.app.Activity.RESULT_OK, null) is BackupDocumentResult.Failed)
    assertTrue(contract.parseResult("backup.json", 42, null) is BackupDocumentResult.Failed)
    assertEquals(BackupDocumentResult.Canceled, contract.parseResult("backup.json", android.app.Activity.RESULT_CANCELED, null))
  }

  @Test fun writesAllUtf8BytesAndClosesBeforeSuccess() {
    var closed = false
    val output = object : ByteArrayOutputStream() { override fun close() { closed = true } }
    val bytes = "汉字🙂".repeat(5000).toByteArray()
    assertEquals(bytes.size, writeBackupDocument(bytes, output) {})
    assertArrayEquals(bytes, output.toByteArray())
    assertTrue(closed)
  }

  @Test fun providerCloseFailureIsNotReportedAsSaved() {
    val output = object : ByteArrayOutputStream() { override fun close() { throw IOException("close failed") } }
    assertThrows(IOException::class.java) { writeBackupDocument(byteArrayOf(1), output) {} }
  }

  @Test fun cancellationClosesTheStreamWithoutContinuingToWrite() {
    var closed = false
    var checks = 0
    val output = object : ByteArrayOutputStream() { override fun close() { closed = true } }
    assertThrows(IOException::class.java) {
      writeBackupDocument(ByteArray(24000), output) { if (++checks == 2) throw IOException("canceled") }
    }
    assertEquals(8192, output.size())
    assertTrue(closed)
  }
}
