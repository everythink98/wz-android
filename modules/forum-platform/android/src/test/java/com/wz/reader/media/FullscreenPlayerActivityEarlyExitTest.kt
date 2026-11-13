package com.wz.reader

import android.app.Application
import android.content.Intent
import expo.modules.video.FullscreenPlayerActivity
import expo.modules.video.managers.VideoManager
import java.util.UUID
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
class FullscreenPlayerActivityEarlyExitTest {
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
}
