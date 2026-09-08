package com.wz.reader

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Process
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.Properties
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.Date
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One bounded channel. Called only by the journal's serial writer. */
internal class DiagnosticLogStore(
  private val directory: File,
  private val channel: String,
  private val now: () -> Long = System::currentTimeMillis,
  private val segmentBytes: Int = 2 * 1024 * 1024,
  private val segmentCount: Int = 4,
  private val retentionMs: Long = 7L * 24 * 60 * 60 * 1000
) {
  var droppedCount = 0L; private set
  var rotationCount = 0L; private set
  var expiredSegmentCount = 0L; private set
  var writeFailureCount = 0L; private set
  var readFailureCount = 0L; private set
  private var sequence = 0
  private val pattern = Regex("${Regex.escape(channel)}-([0-9]+)-([0-9]+)\\.jsonl")
  private val healthFile = File(directory, "$channel-health.properties")

  init {
    try {
      val saved = Properties().apply { healthFile.inputStream().use { load(it) } }
      fun count(key: String) = saved.getProperty(key)?.toLongOrNull()?.coerceAtLeast(0) ?: 0L
      droppedCount = count("droppedCount"); rotationCount = count("rotationCount")
      expiredSegmentCount = count("expiredSegmentCount")
      writeFailureCount = count("writeFailureCount"); readFailureCount = count("readFailureCount")
    } catch (_: Exception) { if (healthFile.exists()) readFailureCount++ }
  }

  private fun saveHealth() {
    try {
      val values = Properties().apply { health().forEach { (key, value) -> setProperty(key, value.toString()) } }
      healthFile.outputStream().use { values.store(it, null) }
    } catch (_: Exception) { writeFailureCount++ }
  }

  private fun files(): List<File> {
    val entries = directory.listFiles() ?: if (directory.exists()) error("diagnostic directory unavailable") else return emptyList()
    return entries.filter { pattern.matches(it.name) }
      .sortedWith(compareBy<File> { pattern.matchEntire(it.name)!!.groupValues[1].toLong() }
        .thenBy { pattern.matchEntire(it.name)!!.groupValues[2].toInt() })
  }

  private fun prune(reserve: Int = 0): List<File> {
    val cutoff = now() - retentionMs
    val all = files()
    for (file in all) {
      if (pattern.matchEntire(file.name)!!.groupValues[1].toLong() < cutoff) {
        if (file.delete()) expiredSegmentCount++ else readFailureCount++
      }
    }
    val retained = files()
    for (file in retained.take((retained.size - segmentCount + reserve).coerceAtLeast(0))) {
      if (file.delete()) rotationCount++ else readFailureCount++
    }
    return files()
  }

  fun append(lines: List<String>) {
    if (lines.isEmpty()) return
    var written = 0
    try {
      check(directory.isDirectory || directory.mkdirs())
      var current = prune().lastOrNull()
      var output: FileOutputStream? = null
      try {
        for (line in lines) {
          val bytes = (line.trimEnd('\n') + "\n").toByteArray(Charsets.UTF_8)
          if (bytes.size > segmentBytes) { droppedCount++; written++; continue }
          if (current == null || current.length() + bytes.size > segmentBytes) {
            output?.close(); output = null
            check(prune(1).size < segmentCount)
            do { current = File(directory, "$channel-${now()}-${sequence++}.jsonl") } while (current!!.exists())
            check(current!!.createNewFile())
          }
          if (output == null) output = FileOutputStream(current!!, true)
          output.write(bytes)
          written++
        }
      } finally { output?.close() }
    } catch (_: Exception) {
      writeFailureCount++
      droppedCount += lines.size - written
    } finally { saveHealth() }
  }

  fun read(): String = buildString {
    try {
      for (file in prune()) {
        if (pattern.matchEntire(file.name)!!.groupValues[1].toLong() < now() - retentionMs) continue
        try { append(file.readText()) } catch (_: Exception) { readFailureCount++ }
      }
    } catch (_: Exception) { readFailureCount++ }
    finally { saveHealth() }
  }

  fun health(): Map<String, Any> = mapOf(
    "droppedCount" to droppedCount, "rotationCount" to rotationCount, "expiredSegmentCount" to expiredSegmentCount,
    "writeFailureCount" to writeFailureCount, "readFailureCount" to readFailureCount
  )
}

internal object DiagnosticJournal {
  private const val MAX_PENDING_BYTES = 256 * 1024
  private const val MAX_CRASH_BYTES = 256 * 1024
  private val processSessionId = "process-" + UUID.randomUUID().toString().replace("-", "")
  private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "diagnostic-writer").apply { isDaemon = true }
  }
  private val lock = Any()
  private var pending = mutableListOf<Pair<String, String>>()
  private var pendingBytes = 0
  private var flushScheduled = false
  private var queueDroppedCount = 0L
  private var storage: File? = null
  private var jsStore: DiagnosticLogStore? = null
  private var nativeStore: DiagnosticLogStore? = null
  private var crashWriteFailureCount = 0L
  private var crashReadFailureCount = 0L
  private var previous: JSONObject? = null

  val buildId: String get() = BuildConfig.DIAGNOSTIC_BUILD_ID

  fun context(): Map<String, Any> = mapOf(
    "buildId" to buildId, "processSessionId" to processSessionId,
    "appVersion" to BuildConfig.VERSION_NAME, "versionCode" to BuildConfig.VERSION_CODE
  )

  fun install(application: Application) {
    if (storage != null) return
    try {
      val directory = File(application.noBackupFilesDir, "diagnostics")
      check(directory.isDirectory || directory.mkdirs())
      storage = directory
      jsStore = DiagnosticLogStore(directory, "js")
      nativeStore = DiagnosticLogStore(directory, "native")
      val sessionFile = File(directory, "process.json")
      previous = try { JSONObject(sessionFile.readText()) } catch (_: Exception) { null }
      val session = JSONObject(context()).put("pid", Process.myPid()).put("startedAt", System.currentTimeMillis())
      try { atomicWrite(sessionFile, session.toString()) } catch (_: Exception) { crashWriteFailureCount++ }
      recordApp("startup", "success", mapOf("state" to "started"))
      executor.execute { collectPreviousExit(application) }
      val original = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        try { persistNativeCrash(error) } catch (_: Throwable) { /* Always delegate. */ }
        finally { original?.uncaughtException(thread, error) }
      }
      application.registerComponentCallbacks(object : ComponentCallbacks2 {
        override fun onConfigurationChanged(configuration: Configuration) = Unit
        override fun onLowMemory() = recordApp("lifecycle", "partial", mapOf("state" to "memory-pressure", "level" to 80))
        override fun onTrimMemory(level: Int) = recordApp("lifecycle", "partial", mapOf("state" to "memory-pressure", "level" to level))
      })
      var started = 0
      application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
          if (started++ == 0) recordApp("lifecycle", "success", mapOf("state" to "foreground"))
        }
        override fun onActivityStopped(activity: Activity) {
          started = (started - 1).coerceAtLeast(0)
          if (started == 0) recordApp("lifecycle", "success", mapOf("state" to "background"))
        }
        override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
      })
    } catch (_: Exception) { crashWriteFailureCount++ }
  }

  private fun atomicWrite(file: File, text: String) {
    val temporary = File(file.parentFile, file.name + ".pending")
    FileOutputStream(temporary).use { stream -> stream.write(text.toByteArray()); stream.fd.sync() }
    check(temporary.renameTo(file))
  }

  private fun event(operation: String, outcome: String, fields: Map<String, Any>): JSONObject =
    JSONObject(context()).put("schemaVersion", 1).put("time", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date()))
      .put("appSessionId", processSessionId).put("traceId", "native-" + UUID.randomUUID().toString().replace("-", ""))
      .put("area", "app").put("operation", operation).put("phase", "finish").put("outcome", outcome)
      .put("durationMs", 0).apply { fields.forEach { (key, value) -> put(key, value) } }

  private fun recordApp(operation: String, outcome: String, fields: Map<String, Any>) =
    enqueue("native", event(operation, outcome, fields).toString())

  private fun collectPreviousExit(application: Application) {
    if (Build.VERSION.SDK_INT < 30) {
      recordApp("previous-exit", "noop", mapOf("state" to "unsupported")); return
    }
    try {
      val prior = previous
      val records = application.getSystemService(ActivityManager::class.java)
        .getHistoricalProcessExitReasons(application.packageName, 0, 16)
      val exit = records.firstOrNull {
        prior != null && it.pid == prior.optInt("pid") && it.timestamp >= prior.optLong("startedAt")
      }
      if (exit == null) {
        recordApp("previous-exit", "noop", mapOf("state" to "unavailable")); return
      }
      val reason = when (exit.reason) {
        ApplicationExitInfo.REASON_CRASH -> "crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "native-crash"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "resource-limit"
        ApplicationExitInfo.REASON_USER_REQUESTED, ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
        ApplicationExitInfo.REASON_EXIT_SELF -> "self-exit"
        ApplicationExitInfo.REASON_SIGNALED -> "signal"
        else -> "other"
      }
      val fields = mutableMapOf<String, Any>(
        "state" to "available", "exitReason" to reason, "exitTimeMs" to exit.timestamp,
        "exitReasonCode" to exit.reason,
        "exitStatus" to exit.status, "pssKb" to exit.pss, "rssKb" to exit.rss
      )
      if (prior != null) {
        val id = prior.optString("processSessionId")
        if (id.matches(Regex("process-[a-f0-9]{32}"))) fields["previousProcessSessionId"] = id
        val build = prior.optString("buildId")
        if (build.matches(Regex("[a-f0-9]{32}"))) fields["previousBuildId"] = build
      }
      recordApp("previous-exit", if (reason in setOf("crash", "native-crash", "anr")) "failure" else "success", fields)
    } catch (_: Exception) { recordApp("previous-exit", "partial", mapOf("state" to "unavailable")) }
  }

  private fun persistNativeCrash(error: Throwable) {
    flushBeforeCrash()
    val symbol = Regex("[A-Za-z_$][A-Za-z0-9_.$]{0,199}")
    val causes = generateSequence(error) { it.cause }.take(8).toList()
    val stack = causes.flatMap { cause ->
      listOf(cause.javaClass.name.takeIf { symbol.matches(it) } ?: "Throwable") +
        cause.stackTrace.take(24).map { frame ->
          val owner = frame.className.takeIf { symbol.matches(it) } ?: "unknown"
          val method = frame.methodName.takeIf { symbol.matches(it) || it == "<init>" || it == "<clinit>" } ?: "unknown"
          "    at $owner.$method([source]:${frame.lineNumber.coerceAtLeast(0)})"
        }
    }.joinToString("\n")
    val line = event("native-crash", "failure", mapOf("isFatal" to true, "stack" to stack)).toString() + "\n"
    val crash = storage?.let { File(it, "crash.jsonl") } ?: return
    val previousJsCrash = try {
      crash.readText().takeIf { it.contains(processSessionId) && it.contains("\"operation\":\"js-error\"") } ?: ""
    } catch (_: Exception) { "" }
    writeCrash(previousJsCrash + line)
  }

  fun persistJsCrash(lines: String): Boolean = try {
    writeCrash(lines); flushBeforeCrash(); true
  } catch (_: Exception) { crashWriteFailureCount++; false }

  private fun flushBeforeCrash() {
    try { executor.submit { flush() }.get(250, TimeUnit.MILLISECONDS) }
    catch (_: Exception) { /* Retain the independent crash summary even when the ordinary writer is unavailable. */ }
  }

  @Synchronized private fun writeCrash(lines: String) {
    require(lines.toByteArray().size <= MAX_CRASH_BYTES)
    val directory = storage ?: error("diagnostic storage unavailable")
    atomicWrite(File(directory, "crash.jsonl"), lines)
  }

  fun appendJs(lines: String) {
    if (lines.toByteArray().size > MAX_PENDING_BYTES) {
      synchronized(lock) { queueDroppedCount++ }; return
    }
    lines.lineSequence().filter { it.isNotBlank() }.forEach { enqueue("js", it) }
  }

  fun recordNetwork(timeMs: Long, fields: Map<String, Any>) {
    try {
      val output = JSONObject(safeNetworkFields(fields)).put("diagnosticKind", "network").put("timeMs", timeMs)
      context().forEach { (key, value) -> output.put(key, value) }
      enqueue("native", output.toString())
    } catch (_: Exception) { synchronized(lock) { queueDroppedCount++ } }
  }

  private fun enqueue(channel: String, line: String) {
    try {
      synchronized(lock) {
        val bytes = line.toByteArray().size
        if (storage == null || bytes + pendingBytes > MAX_PENDING_BYTES) { queueDroppedCount++; return }
        pending.add(channel to line); pendingBytes += bytes
        if (!flushScheduled) {
          flushScheduled = true
          executor.schedule({ flush() }, 200, TimeUnit.MILLISECONDS)
        }
      }
    } catch (_: Exception) { synchronized(lock) { queueDroppedCount++ } }
  }

  private fun flush() {
    val batch = synchronized(lock) {
      val batch = pending; pending = mutableListOf(); pendingBytes = 0; flushScheduled = false; batch
    }
    jsStore?.append(batch.filter { it.first == "js" }.map { it.second })
    nativeStore?.append(batch.filter { it.first == "native" }.map { it.second })
  }

  fun snapshot(complete: (Map<String, Any>) -> Unit) {
    executor.execute {
      flush()
      val js = jsStore?.read() ?: ""
      val native = nativeStore?.read() ?: ""
      val crash = try {
        val file = storage?.let { File(it, "crash.jsonl") }
        if (file?.exists() == true) file.readText() else ""
      } catch (_: Exception) { crashReadFailureCount++; "" }
      complete(mapOf(
        "jsLines" to js, "nativeLines" to native, "crashLines" to crash,
        "health" to mapOf(
          "available" to (storage != null), "queueDroppedCount" to queueDroppedCount,
          "crashWriteFailureCount" to crashWriteFailureCount,
          "crashReadFailureCount" to crashReadFailureCount,
          "js" to (jsStore?.health() ?: emptyMap<String, Any>()),
          "native" to (nativeStore?.health() ?: emptyMap<String, Any>())
        )
      ))
    }
  }

  private val networkEnums = mapOf(
      "operation" to setOf("install", "request", "rotate-read-runtime"),
      "phase" to setOf("call-start", "image-lease-released", "image-call-failed", "response-body-end", "response-failed", "dns-start", "dns-end", "connect-start", "tls-start", "tls-end", "connect-end", "connect-failed", "connection-acquired", "connection-released", "response-start", "response-headers", "call-end", "call-failed", "call-canceled", "intent", "publish", "cancel", "drain", "finish"),
      "source" to setOf("v2ex", "nodeseek", "linuxdo", "yaohuo", "anonymous"),
      "lane" to setOf("forum", "media"), "method" to setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"),
      "addressFamily" to setOf("ipv4", "ipv6", "ipv4,ipv6", "unknown"),
      "protocol" to setOf("http/1.0", "http/1.1", "h2_prior_knowledge", "h2", "spdy/3.1", "quic", "unknown"),
      "proxyType" to setOf("direct", "http", "socks"),
      "tlsVersion" to setOf("TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1", "SSLv3", "unknown"),
      "outcome" to setOf("success", "failure", "canceled", "noop", "rollback", "retired"),
      "imageConsumer" to setOf("fresco", "glide", "svg-probe"),
      "imageFailure" to setOf("executor_rejected", "timeout", "canceled", "http_error", "read_error", "decode_error", "tls_error", "dns_error", "network_error", "unknown"),
      "imageContentType" to setOf("image", "svg", "html", "other", "unknown")
    )
  private val networkNumbers = setOf("generation", "previousGeneration", "elapsedMs", "queuedCount", "runningCount", "leaseCount", "cronetActiveCount", "status", "byteCount", "attempt")
  private val networkIdentities = setOf("callId", "clientId", "poolId", "dispatcherId", "connectionId", "forumPoolId", "mediaPoolId", "imageClientId")

  private fun safeNetworkFields(fields: Map<String, Any>): Map<String, Any> {
    val output = mutableMapOf<String, Any>()
    for ((key, value) in fields) {
      when {
        value is String && networkEnums[key]?.contains(value) == true -> output[key] = value
        value is Number && key in networkNumbers && value.toDouble().isFinite() && value.toDouble() in 0.0..1_000_000_000.0 -> output[key] = value
        value is String && key in networkIdentities && value.matches(Regex("[0-9a-f]{1,8}")) -> output[key] = value
        value is String && key in setOf("imageTraceId", "traceId", "traceIdentity") && value.matches(Regex("(?:trace-[1-9][0-9]{0,9}|[0-9a-f]{1,16})")) -> output[key] = value
        value is String && key in setOf("imageSessionId", "appSessionId") && value.matches(Regex("session-[a-z0-9]{1,16}-[a-z0-9]{1,16}")) -> output[key] = value
        value is String && key == "requestId" && value.matches(Regex("request-[1-9][0-9]{0,9}")) -> output[key] = value
        value is String && key == "mediaRef" && value.matches(Regex("media-[1-9][0-9]{0,9}")) -> output[key] = value
        value is String && key == "errorType" && value.matches(Regex("[A-Za-z][A-Za-z0-9_$]{0,79}")) -> output[key] = value
      }
    }
    return output
  }
}
