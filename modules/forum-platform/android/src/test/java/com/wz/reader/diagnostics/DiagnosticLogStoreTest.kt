package com.wz.reader

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DiagnosticLogStoreTest {
  @Test fun retainsRequestWriteFailurePhasesForPostRestartDiagnostics() {
    val phases = listOf("request-headers-start", "request-headers-end", "request-failed", "connection-write-stalled")
    assertEquals(phases, phases.map { phase ->
      DiagnosticJournal.safeNetworkFields(mapOf("phase" to phase))["phase"]
    })
    assertFalse(DiagnosticJournal.safeNetworkFields(mapOf("phase" to "PRIVATE_PHASE")).containsKey("phase"))
  }

  @Test fun retainsClearanceDiagnosticsWithoutExportingCredentials() {
    val fields = DiagnosticJournal.safeNetworkFields(mapOf(
      "cookieKind" to "bot-management", "hasCfClearance" to true, "hasStoredCfClearance" to true,
      "isCfClearanceCurrent" to false, "didCfClearanceChange" to true, "userAgentHash" to "0123abcd",
      "cookieEndpoint" to "site-config", "loginCookieCount" to 2, "storedLoginCookieCount" to 1, "isLoginCookieCurrent" to false,
      "cfClearanceCount" to 3, "storedCfClearanceCount" to 2,
      "cfClearanceDistinctCount" to 2, "storedCfClearanceDistinctCount" to 1,
      "cfClearancePartitionedCount" to 1, "cfClearanceUnpartitionedCount" to 2, "cfClearanceInfoResult" to "success",
      "cookie" to "PRIVATE_COOKIE", "cookieHash" to "PRIVATE_HASH", "userAgent" to "PRIVATE_UA",
      "cfClearanceHash" to "1234abcd", "cfClearanceValues" to listOf("PRIVATE_CLEARANCE")
    ))
    assertEquals(17, fields.size)
    assertEquals("site-config", fields["cookieEndpoint"])
    assertEquals(2, fields["loginCookieCount"])
    assertEquals(1, fields["storedLoginCookieCount"])
    assertEquals(false, fields["isLoginCookieCurrent"])
    assertEquals("0123abcd", fields["userAgentHash"])
    assertEquals(false, fields["isCfClearanceCurrent"])
    assertEquals(3, fields["cfClearanceCount"])
    assertEquals(2, fields["storedCfClearanceCount"])
    assertEquals(2, fields["cfClearanceDistinctCount"])
    assertEquals(1, fields["storedCfClearanceDistinctCount"])
    assertEquals(1, fields["cfClearancePartitionedCount"])
    assertEquals(2, fields["cfClearanceUnpartitionedCount"])
    assertEquals("success", fields["cfClearanceInfoResult"])
    for (result in listOf("unsupported", "failed")) {
      assertEquals(result, DiagnosticJournal.safeNetworkFields(mapOf("cfClearanceInfoResult" to result))["cfClearanceInfoResult"])
    }
    assertTrue(DiagnosticJournal.safeNetworkFields(mapOf("cfClearanceInfoResult" to "PRIVATE_RESULT")).isEmpty())
    assertFalse(fields.containsKey("cfClearanceHash"))
    assertFalse(fields.toString().contains("PRIVATE"))
    for (key in listOf("cfClearanceCount", "storedCfClearanceCount", "cfClearanceDistinctCount", "storedCfClearanceDistinctCount",
      "cfClearancePartitionedCount", "cfClearanceUnpartitionedCount")) {
      for (value in listOf(-1, Double.NaN, 1_000_000_001L, "PRIVATE_COUNT")) {
        assertTrue(DiagnosticJournal.safeNetworkFields(mapOf(key to value)).isEmpty())
      }
    }
  }

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
