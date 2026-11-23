package com.wz.reader

import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

internal class PendingDiagnosticBatch(
  private val executor: ScheduledExecutorService,
  private val lock: Any,
  private val hasStorage: () -> Boolean,
  private val drain: (List<Pair<String, String>>) -> Unit
) {
  companion object { const val MAX_PENDING_BYTES = 256 * 1024 }
  private enum class FlushObligation { UNCLAIMED, CLAIMED }
  private class Batch {
    var obligation = FlushObligation.UNCLAIMED
    val entries = mutableListOf<Pair<String, String>>()
    var bytes = 0; private set
    fun append(channel: String, line: String, size: Int) {
      entries.add(channel to line); bytes += size
    }
  }
  private var pending = Batch()
  private var queueDroppedCount = 0L

  val droppedCount: Long get() = synchronized(lock) { queueDroppedCount }

  fun recordDrop() { synchronized(lock) { queueDroppedCount++ } }

  fun enqueue(channel: String, line: String) {
    try {
      synchronized(lock) {
        val bytes = line.toByteArray().size
        if (!hasStorage() || bytes + pending.bytes > MAX_PENDING_BYTES) { queueDroppedCount++; return }
        val batch = pending
        batch.append(channel, line, bytes)
        if (pending.obligation == FlushObligation.UNCLAIMED) {
          pending.obligation = FlushObligation.CLAIMED
          executor.schedule({ flush() }, 200, TimeUnit.MILLISECONDS)
        }
      }
    } catch (_: Exception) { synchronized(lock) { queueDroppedCount++ } }
  }

  fun flush() {
    val batch = synchronized(lock) {
      val batch = pending
      pending = Batch()
      batch.entries
    }
    drain(batch)
  }

}
