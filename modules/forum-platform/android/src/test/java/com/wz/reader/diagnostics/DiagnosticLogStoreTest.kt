package com.wz.reader

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Delayed
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class DiagnosticLogStoreTest {
  @Test
  fun nativeFatalSummarySurvivesWhenPreviousDiagnosticContextFillsTheByteBudget() {
    val latest = """{"operation":"native-crash"}""" + "\n"
    val previous = "中".repeat(87_380) + "\n"
    assertEquals(latest, DiagnosticJournal.nativeCrashWithContext(previous, latest))
    assertEquals("short\n" + latest, DiagnosticJournal.nativeCrashWithContext("short\n", latest))
  }

  @Test fun retainsTheOriginalImageSaveConsumerInTheJournal() {
    val fields = DiagnosticJournal.safeNetworkFields(mapOf("imageConsumer" to "save-image", "url" to "PRIVATE_URL"))
    assertEquals(mapOf("imageConsumer" to "save-image"), fields)
  }

  @Test fun retainsOnlyClosedSocketFailureCategoriesAndFiniteTimeouts() {
    val accepted = mapOf<String, Any>(
      "phase" to "request-config", "socketFailure" to "reset", "socketErrno" to "ECONNRESET",
      "connectTimeoutMs" to 0, "readTimeoutMs" to 15000, "writeTimeoutMs" to 20000, "callTimeoutMs" to 0
    )
    assertEquals(accepted, DiagnosticJournal.safeNetworkFields(accepted + mapOf(
      "exceptionMessage" to "PRIVATE_HOST", "host" to "PRIVATE_HOST", "ip" to "192.0.2.10"
    )))
    for (value in listOf("PRIVATE_HOST", "ECONNRESET PRIVATE_HOST")) {
      assertTrue(DiagnosticJournal.safeNetworkFields(mapOf("socketFailure" to value, "socketErrno" to value)).isEmpty())
    }
    for (key in listOf("connectTimeoutMs", "readTimeoutMs", "writeTimeoutMs", "callTimeoutMs")) {
      for (value in listOf(-1, 1.5, Double.NaN, 1_000_000_001L, "PRIVATE_TIMEOUT")) {
        assertTrue(DiagnosticJournal.safeNetworkFields(mapOf(key to value)).isEmpty())
      }
    }
  }
  @Test fun retainsOnlyValidSocketLocalPortsWithoutAddresses() {
    for (port in listOf(1, 49152, 65535)) {
      assertEquals(mapOf("socketLocalPort" to port), DiagnosticJournal.safeNetworkFields(mapOf(
        "socketLocalPort" to port, "localAddress" to "192.0.2.10", "ip" to "192.0.2.11"
      )))
    }
    for (value in listOf(-1, 0, 65536, 1.5, Double.NaN, "49152")) {
      assertTrue(DiagnosticJournal.safeNetworkFields(mapOf("socketLocalPort" to value)).isEmpty())
    }
  }

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
    assertTrue(DiagnosticJournal.recordStartupPhase("page-layout"))
    assertFalse(DiagnosticJournal.recordStartupPhase("page-layout"))
    assertTrue(DiagnosticJournal.recordStartupPhase("feed-terminal"))
    assertFalse(DiagnosticJournal.recordStartupPhase("feed-terminal"))
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
  @Test fun retainsQueuedDataAndSchedulingObligationAfterSchedulerRejection() {
    val directory = temporary.newFolder()
    val stores = RecordingDiagnosticStores(directory)
    val scheduler = CapturingJournalScheduler()
    val queue = PendingDiagnosticBatch(scheduler, Any(), { directory.isDirectory }, stores::drain)
    try {
      scheduler.rejectNext = true
      queue.enqueue("js", "before-rejection")
      queue.enqueue("native", "coalesced-after-rejection")
      assertEquals(1, scheduler.attempts)
      assertEquals(1L, queue.droppedCount)
      assertEquals("", stores.js.read())
      queue.flush()
      assertEquals(listOf("js" to "before-rejection", "native" to "coalesced-after-rejection"), stores.batches.single())
      assertEquals("before-rejection\n", stores.js.read())
      assertEquals("coalesced-after-rejection\n", stores.native.read())
      queue.enqueue("js", "rearmed")
      assertEquals(2, scheduler.attempts)
      scheduler.runScheduled(0)
      assertEquals("before-rejection\nrearmed\n", stores.js.read())
      assertEquals(1L, queue.droppedCount)
    } finally { scheduler.shutdownNow() }
  }

  @Test fun allowsAnOlderScheduledFlushToDrainTheCurrentNewBatch() {
    val directory = temporary.newFolder()
    val stores = RecordingDiagnosticStores(directory)
    val scheduler = CapturingJournalScheduler()
    val queue = PendingDiagnosticBatch(scheduler, Any(), { directory.isDirectory }, stores::drain)
    try {
      queue.enqueue("js", "first")
      queue.flush()
      queue.enqueue("js", "second")
      assertEquals(2, scheduler.attempts)
      scheduler.runScheduled(0)
      assertEquals("first\nsecond\n", stores.js.read())
      assertEquals(listOf("js" to "second"), stores.batches.last())
      scheduler.runScheduled(1)
      assertEquals(listOf(listOf("js" to "first"), listOf("js" to "second"), emptyList<Pair<String, String>>()), stores.batches)
      assertEquals("first\nsecond\n", stores.js.read())
      assertEquals(0L, queue.droppedCount)
    } finally { scheduler.shutdownNow() }
  }

  @Test fun detachesBeforeIoAndAdmitsReentrantAndConcurrentEntriesDuringDrain() {
    val directory = temporary.newFolder()
    val stores = RecordingDiagnosticStores(directory)
    val scheduler = CapturingJournalScheduler()
    val workerDone = CountDownLatch(1)
    val workerFailure = AtomicReference<Throwable>()
    var producer: Thread? = null
    var firstDrain = true
    lateinit var queue: PendingDiagnosticBatch
    queue = PendingDiagnosticBatch(scheduler, Any(), { directory.isDirectory }, { batch ->
      if (firstDrain) {
        firstDrain = false
        queue.enqueue("native", "from-callback")
        producer = Thread({
          try { queue.enqueue("js", "from-producer") }
          catch (failure: Throwable) { workerFailure.set(failure) }
          finally { workerDone.countDown() }
        }, "journal-drain-producer").apply { isDaemon = true; start() }
        // A timeout only fails the oracle; successful completion is the ordering proof.
        assertTrue("producer must finish while the old drain is still held", workerDone.await(5, TimeUnit.SECONDS))
        workerFailure.get()?.let { throw it }
      }
      stores.drain(batch)
    })
    try {
      queue.enqueue("js", "outer-js")
      queue.enqueue("native", "outer-native")
      queue.flush()
      assertEquals(listOf("js" to "outer-js", "native" to "outer-native"), stores.batches.single())
      assertEquals("outer-js\n", stores.js.read())
      assertEquals("outer-native\n", stores.native.read())
      assertEquals(2, scheduler.attempts)
      queue.flush()
      assertEquals(listOf("native" to "from-callback", "js" to "from-producer"), stores.batches.last())
      assertEquals("outer-js\nfrom-producer\n", stores.js.read())
      assertEquals("outer-native\nfrom-callback\n", stores.native.read())
      assertEquals(0L, queue.droppedCount)
    } finally {
      try { producer?.join(5_000) }
      finally { scheduler.shutdownNow() }
      assertFalse("own producer must terminate", producer?.isAlive == true)
    }
  }

  private class RecordingDiagnosticStores(directory: File) {
    val js = DiagnosticLogStore(directory, "js")
    val native = DiagnosticLogStore(directory, "native")
    val batches = mutableListOf<List<Pair<String, String>>>()
    fun drain(batch: List<Pair<String, String>>) {
      batches.add(batch.toList())
      js.append(batch.filter { it.first == "js" }.map { it.second })
      native.append(batch.filter { it.first == "native" }.map { it.second })
    }
  }

  private class CapturingJournalScheduler : ScheduledThreadPoolExecutor(1,
    ThreadFactory { throw AssertionError("captured scheduler must not start real workers") }) {
    var rejectNext = false
    var attempts = 0; private set
    private val accepted = mutableListOf<FutureTask<Unit>>()
    override fun schedule(command: Runnable, delay: Long, unit: TimeUnit): ScheduledFuture<*> {
      assertEquals(200L, delay)
      assertEquals(TimeUnit.MILLISECONDS, unit)
      attempts++
      if (rejectNext) { rejectNext = false; throw RejectedExecutionException("rejected by SDK boundary") }
      return object : FutureTask<Unit>(command, Unit), ScheduledFuture<Unit> {
        override fun getDelay(unit: TimeUnit): Long = error("unused future query")
        override fun compareTo(other: Delayed): Int = error("unused future query")
      }.also { accepted.add(it) }
    }
    fun runScheduled(index: Int) { accepted[index].run(); accepted[index].get() }
  }

}
