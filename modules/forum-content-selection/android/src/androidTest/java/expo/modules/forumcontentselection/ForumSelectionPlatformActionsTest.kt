package expo.modules.forumcontentselection

import android.app.Activity
import android.app.PendingIntent
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.view.textclassifier.TextClassification
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ForumSelectionPlatformActionsTest {
  @Test
  fun productionProviderDiscoversAndInvokesTheExportedReadOnlyProcessTextHandler() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val targetContext = instrumentation.targetContext
    val testPackage = instrumentation.context.packageName
    val received = AtomicReference<ReceivedProcessText>()
    val receivedLatch = CountDownLatch(1)
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        received.set(
          ReceivedProcessText(
            action = intent.getStringExtra(EXTRA_RECEIVED_ACTION),
            type = intent.getStringExtra(EXTRA_RECEIVED_TYPE),
            text = intent.getStringExtra(EXTRA_RECEIVED_TEXT),
            readOnly = intent.getBooleanExtra(EXTRA_RECEIVED_READ_ONLY, false)
          )
        )
        receivedLatch.countDown()
      }
    }
    registerResultReceiver(targetContext, receiver)

    try {
      val action = AtomicReference<ForumSelectionSystemAction>()
      instrumentation.runOnMainSync {
        val expectedKey = "process:${ComponentName(
          testPackage,
          ForumSelectionProcessTextTestActivity::class.java.name
        ).flattenToShortString()}"
        action.set(
          ForumSelectionPlatformActions(View(targetContext)) { null }
            .load(EXACT_SELECTED_TEXT) { }
            .singleOrNull { it.key == expectedKey }
        )
      }

      assertNotNull("The production provider must discover the test APK through ACTION_PROCESS_TEXT", action.get())
      assertEquals("Test Process Text", action.get().title.toString())
      assertEquals(MenuItem.SHOW_AS_ACTION_IF_ROOM, action.get().showAsAction)
      instrumentation.runOnMainSync { assertTrue(action.get().invoke()) }

      assertTrue("The exported PROCESS_TEXT activity did not report its intent", receivedLatch.await(5, TimeUnit.SECONDS))
      assertEquals(
        ReceivedProcessText(
          action = Intent.ACTION_PROCESS_TEXT,
          type = "text/plain",
          text = EXACT_SELECTED_TEXT,
          readOnly = true
        ),
        received.get()
      )
    } finally {
      targetContext.unregisterReceiver(receiver)
    }
  }

  @Test
  fun remoteActionsPromoteTheFirstEnabledUniqueAction() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val icon = Icon.createWithResource(context, android.R.drawable.ic_menu_view)
    val sharedIntent = PendingIntent.getBroadcast(
      context,
      1,
      Intent("$ACTION_PROCESS_TEXT_RESULT.remote.shared").setPackage(context.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val secondaryIntent = PendingIntent.getBroadcast(
      context,
      2,
      Intent("$ACTION_PROCESS_TEXT_RESULT.remote.secondary").setPackage(context.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val disabled = RemoteAction(icon, "Disabled", "Disabled", sharedIntent).apply { setEnabled(false) }
    val enabled = RemoteAction(icon, "Enabled", "Enabled", sharedIntent)
    val secondary = RemoteAction(icon, "Secondary", "Secondary", secondaryIntent)

    val actions = TextClassifierApi28.fromRemoteActions(context, listOf(disabled, enabled, secondary))

    assertEquals(listOf("Enabled", "Secondary"), actions.map { it.title.toString() })
    assertEquals(listOf(0, 50), actions.map { it.order })
    assertEquals(
      listOf(MenuItem.SHOW_AS_ACTION_ALWAYS, MenuItem.SHOW_AS_ACTION_NEVER),
      actions.map { it.showAsAction }
    )
    assertTrue(actions.all { it.enabled && it.finishSelectionOnSuccess })
  }

  @Suppress("DEPRECATION")
  @Test
  fun api28FallsBackToAnIconOnlyLegacyAction() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val hostView = View(context)
    var clicked = false
    val classification = TextClassification.Builder()
      .setIcon(ColorDrawable(Color.RED))
      .setOnClickListener { clicked = true }
      .build()

    val action = TextClassifierApi28.fromClassification(hostView, context, classification) { false }.single()

    assertEquals("", action.title.toString())
    assertNotNull(action.icon)
    assertTrue(action.finishSelectionOnSuccess)
    assertTrue(action.invoke())
    assertTrue(clicked)
  }

  private fun registerResultReceiver(context: Context, receiver: BroadcastReceiver) {
    val filter = IntentFilter(ACTION_PROCESS_TEXT_RESULT)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(receiver, filter)
    }
  }
}

class ForumSelectionProcessTextTestActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    sendBroadcast(
      Intent(ACTION_PROCESS_TEXT_RESULT)
        .putExtra(EXTRA_RECEIVED_ACTION, intent.action)
        .putExtra(EXTRA_RECEIVED_TYPE, intent.type)
        .putExtra(EXTRA_RECEIVED_TEXT, intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString())
        .putExtra(
          EXTRA_RECEIVED_READ_ONLY,
          intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)
        )
    )
    finish()
  }
}

private data class ReceivedProcessText(
  val action: String?,
  val type: String?,
  val text: String?,
  val readOnly: Boolean
)

private const val EXACT_SELECTED_TEXT = "Alpha 中文 \uD83D\uDE00\nBeta"
private const val ACTION_PROCESS_TEXT_RESULT =
  "expo.modules.forumcontentselection.test.action.PROCESS_TEXT_RESULT"
private const val EXTRA_RECEIVED_ACTION = "receivedAction"
private const val EXTRA_RECEIVED_TYPE = "receivedType"
private const val EXTRA_RECEIVED_TEXT = "receivedText"
private const val EXTRA_RECEIVED_READ_ONLY = "receivedReadOnly"
