package expo.modules.forumcontentselection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ForumSelectionSystemActionsTest {
  @Test
  fun parcelSafeTrimDoesNotSplitASurrogatePair() {
    assertEquals("a", "a\uD83D\uDE00b".trimToForumParcelableSize(maxLength = 2))
    assertEquals("ab", "abc".trimToForumParcelableSize(maxLength = 2))
  }

  @Test
  fun draggingDoesNotCopyOrClassifyTheSelection() {
    var copyCalls = 0
    var classifyCalls = 0

    val text = forumSelectionSystemActionText(isDragging = true) {
      copyCalls += 1
      "selected text"
    }
    if (text != null) classifyCalls += 1

    assertNull(text)
    assertEquals(0, copyCalls)
    assertEquals(0, classifyCalls)
  }

  @Test
  fun cancelDoesNotCreatePlatformActions() {
    var creations = 0
    var created: TestPlatformActions? = null
    val owner = platformActionsOwner {
      creations += 1
      TestPlatformActions().also { created = it }
    }

    try {
      owner.cancelPendingClassification()

      assertEquals(0, creations)
    } finally {
      created?.close()
    }
  }

  @Test
  fun destroyDoesNotCreatePlatformActions() {
    var creations = 0
    var created: TestPlatformActions? = null
    val owner = platformActionsOwner {
      creations += 1
      TestPlatformActions().also { created = it }
    }

    try {
      owner.close()

      assertEquals(0, creations)
    } finally {
      created?.close()
    }
  }

  @Test
  fun destroyShutsDownCreatedPlatformActions() {
    val owner = platformActionsOwner(::TestPlatformActions)
    val actions = owner.get()
    assertFalse(actions.executor.isShutdown)

    try {
      owner.close()

      assertTrue(actions.executor.isShutdown)
    } finally {
      actions.close()
    }
  }

  private fun platformActionsOwner(
    create: () -> TestPlatformActions
  ): ForumSelectionSystemActionOwner<TestPlatformActions> = ForumSelectionSystemActionOwner(
    create = create,
    cancelOwner = TestPlatformActions::cancelPendingClassification
  )

  private class TestPlatformActions(
    val executor: ExecutorService = Executors.newSingleThreadExecutor()
  ) : AutoCloseable {
    fun cancelPendingClassification() = Unit

    override fun close() {
      executor.shutdownNow()
    }
  }
}
