package com.wz.reader

import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationDigestExecutorTest {
  @Test
  fun shutdownDrainsQueuedDismissAfterBlockedPresent() {
    val queue = NotificationDigestExecutor()
    val firstStarted = CountDownLatch(1)
    val releaseFirst = CountDownLatch(1)
    val events = Collections.synchronizedList(mutableListOf<String>())
    val presentPromise = CompletableFuture<Unit>()
    val dismissPromise = CompletableFuture<Unit>()

    queue.execute({ presentPromise.completeExceptionally(it) }) {
      firstStarted.countDown()
      releaseFirst.await(5, TimeUnit.SECONDS)
      events.add("notify")
      presentPromise.complete(Unit)
    }
    assertTrue(firstStarted.await(5, TimeUnit.SECONDS))
    queue.execute({ dismissPromise.completeExceptionally(it) }) {
      events.add("cancel")
      dismissPromise.complete(Unit)
    }

    queue.shutdown()
    releaseFirst.countDown()

    assertEquals(Unit, presentPromise.get(5, TimeUnit.SECONDS))
    assertEquals(Unit, dismissPromise.get(5, TimeUnit.SECONDS))
    assertEquals(listOf("notify", "cancel"), events)
  }

  @Test
  fun executeAfterShutdownRejects() {
    val queue = NotificationDigestExecutor()
    val rejection = CompletableFuture<Exception>()
    queue.shutdown()

    queue.execute({ rejection.complete(it) }) { error("must not run") }

    assertTrue(rejection.get(5, TimeUnit.SECONDS) is RejectedExecutionException)
  }
}
