package com.wz.reader

import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import expo.modules.video.FullscreenPlayerActivity
import expo.modules.video.listeners.VideoManagerListener
import expo.modules.video.managers.VideoManager
import java.lang.reflect.Proxy
import java.util.ArrayDeque
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class FullscreenPlayerActivityEarlyExitTest {
  @Test
  fun removingAListenerDuringForegroundDeliveryKeepsTheOtherListeners() {
    val observed = mutableListOf<String>()
    val first = object : VideoManagerListener {
      override fun onAppForegrounded() { observed.add("first"); VideoManager.unregisterListener(this) }
    }
    val second = object : VideoManagerListener {
      override fun onAppForegrounded() { observed.add("second") }
    }
    VideoManager.registerListener(first)
    VideoManager.registerListener(second)
    try {
      VideoManager.onAppForegrounded()
      assertEquals(listOf("first", "second"), observed)
    } finally {
      VideoManager.unregisterListener(first)
      VideoManager.unregisterListener(second)
    }
  }

  @Test
  fun missingTokenFinishesAndDestroysWithoutInitializedView() {
    val intent = Intent(RuntimeEnvironment.getApplication(), FullscreenPlayerActivity::class.java)
    val controller = Robolectric.buildActivity(FullscreenPlayerActivity::class.java, intent)
    try {
      val activity = controller.create().get()
      assertTrue(activity.isFinishing)
      activity.finish()
      assertTrue(activity.isFinishing)
    } finally {
      controller.destroy()
    }
  }

  @Test
  fun unclaimedTokenFinishesAndDestroysWithoutInitializedView() {
    val intent = Intent(RuntimeEnvironment.getApplication(), FullscreenPlayerActivity::class.java)
      .putExtra(VideoManager.INTENT_FULLSCREEN_HANDOFF_KEY, UUID.randomUUID().toString())
    val controller = Robolectric.buildActivity(FullscreenPlayerActivity::class.java, intent)
    try {
      val activity = controller.create().get()
      assertTrue(activity.isFinishing)
      activity.finish()
      assertTrue(activity.isFinishing)
    } finally {
      controller.destroy()
    }
  }

  @Test
  fun transitionFrameWaitsForTheDecoderAndBothCompositionCallbacks() {
    val fixture = TransitionFixture()
    val owner = fixture.install()
    try {
      assertSame(fixture.overlay, owner.image.parent)
      assertEquals(0, owner.image.pendingFrames)
      assertSame(owner.listener, fixture.added.single())

      owner.listener.onRenderedFirstFrame()
      owner.listener.onRenderedFirstFrame()
      assertEquals(1, owner.image.pendingFrames)
      assertSame(fixture.overlay, owner.image.parent)
      assertEquals(1, fixture.removals(owner))

      owner.image.advanceFrame()
      assertSame(fixture.overlay, owner.image.parent)
      assertEquals(0, owner.image.clears)
      assertEquals(1, owner.image.pendingFrames)

      owner.image.advanceFrame()
      assertNull(owner.image.parent)
      assertNull(owner.image.drawable)
      assertEquals(1, fixture.imageRemovals(owner.image))
      assertEquals(1, owner.image.clears)
      assertEquals(2, fixture.removals(owner)) // Decoder unsubscribe, then terminal cleanup.

      owner.listener.onRenderedFirstFrame()
      owner.listener.onPlayerError(frameError())
      owner.release()
      assertEquals(0, owner.image.pendingFrames)
      assertEquals(1, fixture.imageRemovals(owner.image))
      assertEquals(1, owner.image.clears)
      assertEquals(2, fixture.removals(owner))
    } finally {
      owner.release()
    }
  }

  @Test
  fun transitionFrameErrorsReleaseOnceWithoutLettingOldCallbacksClearAReplacement() {
    for (compositions in -1..1) {
      val fixture = TransitionFixture()
      val previous = fixture.install()
      var replacement: TransitionOwner? = null
      try {
        if (compositions >= 0) previous.listener.onRenderedFirstFrame()
        if (compositions == 1) previous.image.advanceFrame()
        previous.listener.onPlayerError(frameError())
        previous.listener.onPlayerError(frameError())
        previous.release()
        assertNull(previous.image.parent)
        assertNull(previous.image.drawable)
        assertEquals(1, fixture.imageRemovals(previous.image))
        assertEquals(1, previous.image.clears)
        assertEquals(if (compositions < 0) 1 else 2, fixture.removals(previous))

        val next = fixture.install().also { replacement = it }
        if (compositions >= 0) previous.image.advanceFrame()
        previous.listener.onRenderedFirstFrame()
        previous.listener.onPlayerError(frameError())
        previous.release()
        assertSame(fixture.overlay, next.image.parent)
        assertTrue(next.image.drawable != null)
        assertEquals(0, fixture.imageRemovals(next.image))
        assertEquals(0, next.image.clears)
        assertEquals(0, previous.image.pendingFrames)
        assertEquals(0, fixture.removals(next))
      } finally {
        previous.release()
        replacement?.release()
      }
    }
  }

  @Test
  fun activityDestroyReleasesTheWaitingFrameOnceAndRejectsLateCallbacks() {
    for (decoded in listOf(false, true)) {
      val fixture = TransitionFixture()
      val owner = fixture.install()
      val intent = Intent(RuntimeEnvironment.getApplication(), FullscreenPlayerActivity::class.java)
      val controller = Robolectric.buildActivity(FullscreenPlayerActivity::class.java, intent)
      val activity = controller.create().get()
      val field = FullscreenPlayerActivity::class.java.getDeclaredField("transitionFrame").apply { isAccessible = true }
      try {
        field.set(activity, owner.instance)
        if (decoded) owner.listener.onRenderedFirstFrame()
        controller.destroy()
        assertNull(field.get(activity))
        assertNull(owner.image.parent)
        assertNull(owner.image.drawable)

        if (decoded) owner.image.advanceFrame()
        owner.listener.onRenderedFirstFrame()
        owner.listener.onPlayerError(frameError())
        owner.release()
        owner.release()
        assertEquals(0, owner.image.pendingFrames)
        assertEquals(1, fixture.imageRemovals(owner.image))
        assertEquals(1, owner.image.clears)
        assertEquals(if (decoded) 2 else 1, fixture.removals(owner))
      } finally {
        owner.release()
        if (field.get(activity) != null) controller.destroy()
      }
    }
  }

  private fun frameError() = PlaybackException("controlled frame failure", null, PlaybackException.ERROR_CODE_UNSPECIFIED)

  private class TransitionFixture {
    // Media3 UI is an implementation dependency of expo-video. Exercise its actual target and overlay.
    private val context: Context = RuntimeEnvironment.getApplication()
    private val targetType = Class.forName("androidx.media3.ui.PlayerView").asSubclass(ViewGroup::class.java)
    private val target = targetType.getConstructor(Context::class.java).newInstance(context)
    val overlay = requireNotNull(targetType.getMethod("getOverlayFrameLayout").invoke(target) as? FrameLayout)
    private val removedImages = mutableListOf<View>()
    val added = mutableListOf<Player.Listener>()
    private val removed = mutableListOf<Player.Listener>()
    private val player = Player::class.java.cast(Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { proxy, method, arguments ->
      when (method.name) {
        "getPlaybackState" -> Player.STATE_READY
        "getPlayWhenReady", "isPlaying" -> true
        "addListener" -> { added.add(Player.Listener::class.java.cast(arguments!![0])); null }
        "removeListener" -> { removed.add(Player.Listener::class.java.cast(arguments!![0])); null }
        "hashCode" -> System.identityHashCode(proxy)
        "equals" -> proxy === arguments?.get(0)
        "toString" -> "TransitionPlayerBoundary"
        else -> error("Unexpected player call: ${method.name}")
      }
    })
    init {
      overlay.setOnHierarchyChangeListener(object : ViewGroup.OnHierarchyChangeListener {
        override fun onChildViewAdded(parent: View, child: View) = Unit
        override fun onChildViewRemoved(parent: View, child: View) { removedImages.add(child) }
      })
    }
    fun install(): TransitionOwner {
      val image = CompositionImage(context)
      image.setImageDrawable(ColorDrawable(Color.BLUE))
      val type = Class.forName("expo.modules.video.FullscreenTransitionFrame")
      val instance = type.getDeclaredConstructor(targetType, Player::class.java, ImageView::class.java)
        .apply { isAccessible = true }.newInstance(target, player, image)
      type.getDeclaredMethod("install").apply { isAccessible = true }.invoke(instance)
      return TransitionOwner(instance, Player.Listener::class.java.cast(instance), image) {
        type.getDeclaredMethod("release").apply { isAccessible = true }.invoke(instance)
      }
    }

    fun removals(owner: TransitionOwner) = removed.count { it === owner.listener }
    fun imageRemovals(image: View) = removedImages.count { it === image }
  }

  private class TransitionOwner(val instance: Any, val listener: Player.Listener, val image: CompositionImage, val release: () -> Unit)

  private class CompositionImage(context: Context) : ImageView(context) {
    private val posted = ArrayDeque<Runnable>()
    var clears = 0
      private set
    val pendingFrames get() = posted.size
    override fun postOnAnimation(action: Runnable) { posted.addLast(action) }
    override fun setImageDrawable(drawable: Drawable?) {
      if (drawable == null) clears += 1
      super.setImageDrawable(drawable)
    }
    fun advanceFrame() {
      assertEquals("Expected one outstanding composition callback", 1, posted.size)
      posted.removeFirst().run()
    }
  }
}
