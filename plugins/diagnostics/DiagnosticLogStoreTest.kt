package com.wz.reader

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DiagnosticLogStoreTest {
  @get:Rule val temporary = TemporaryFolder()

  @Test fun startupTimingRejectsUnknownPhasesAndRecordsEachPhaseOnce() {
    assertFalse(DiagnosticJournal.recordStartupPhase("PRIVATE_STARTUP_PAYLOAD"))
    assertTrue(DiagnosticJournal.recordStartupPhase("page-ready"))
    assertFalse(DiagnosticJournal.recordStartupPhase("page-ready"))
  }

  @Test fun keepsFourBoundedSegmentsAndReopensAfterRestart() {
    val directory = temporary.newFolder()
    val store = DiagnosticLogStore(directory, "js", { 1000L }, 16, 4)
    repeat(12) { store.append(listOf("event-$it")) }
    assertEquals(4, directory.listFiles()!!.count { it.extension == "jsonl" })
    assertTrue(directory.listFiles()!!.filter { it.extension == "jsonl" }.all { it.length() <= 16 })
    val restored = DiagnosticLogStore(directory, "js", { 1001L }, 16, 4)
    assertTrue(restored.read().contains("event-11"))
    assertFalse(restored.read().contains("event-0\n"))
    assertEquals(store.rotationCount, restored.rotationCount)
  }

  @Test fun expiresByCreationTimeEvenWhenTheLastWriteIsRecent() {
    val directory = temporary.newFolder()
    var now = 1000L
    val store = DiagnosticLogStore(directory, "native", { now }, 128, 4, 100)
    store.append(listOf("old"))
    now = 1050L; store.append(listOf("also-old"))
    now = 1101L
    assertEquals("", store.read())
    store.append(listOf("new"))
    assertEquals("new\n", store.read())
  }

  @Test fun rejectsOversizedEventsAndReportsDiskFailuresWithoutThrowing() {
    val store = DiagnosticLogStore(temporary.newFolder(), "js", { 1000L }, 16, 4)
    store.append(listOf("x".repeat(32)))
    assertEquals(1L, store.droppedCount)
    val file = temporary.newFile()
    val failed = DiagnosticLogStore(File(file, "not-a-directory"), "js")
    failed.append(listOf("event"))
    assertTrue(failed.writeFailureCount >= 1L)
    assertEquals("", failed.read())
  }
}
