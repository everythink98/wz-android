package expo.modules.forumcontentselection

import android.annotation.TargetApi
import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import android.view.MenuItem
import android.view.View
import android.view.textclassifier.TextClassification
import android.view.textclassifier.TextClassificationManager
import android.view.textclassifier.TextClassifier
import java.util.concurrent.Executors
import java.util.concurrent.Future

internal data class ForumSelectionSystemAction(
  val key: String,
  val title: CharSequence,
  val contentDescription: CharSequence?,
  val icon: Drawable?,
  val enabled: Boolean,
  val order: Int = SYSTEM_ACTION_ORDER_PROCESS_TEXT,
  val showAsAction: Int = MenuItem.SHOW_AS_ACTION_NEVER,
  val finishSelectionOnSuccess: Boolean = false,
  val invoke: () -> Boolean
)

internal class ForumSelectionSystemActionOwner<T : AutoCloseable>(
  create: () -> T,
  private val cancelOwner: (T) -> Unit
) : AutoCloseable {
  private val owner = lazy(create)

  fun get(): T = owner.value

  fun cancelPendingClassification() {
    if (owner.isInitialized()) cancelOwner(owner.value)
  }

  override fun close() {
    if (owner.isInitialized()) owner.value.close()
  }
}

internal class ForumSelectionPlatformActions(
  private val hostView: View,
  private val activityProvider: () -> Activity?
) : AutoCloseable {
  private val context = hostView.context
  private val classifierExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ForumSelectionClassifier").apply { isDaemon = true }
  }
  private var classifierTask: Future<*>? = null

  fun load(
    selectedText: String,
    publishSmartActions: (List<ForumSelectionSystemAction>) -> Unit
  ): List<ForumSelectionSystemAction> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      cancelPendingClassification()
      classifierTask = classifierExecutor.submit {
        val actions = runCatching {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            TextClassifierApi28.classify(hostView, context, selectedText, ::startExternalActivity)
          } else {
            TextClassifierApi26.classify(hostView, context, selectedText, ::startExternalActivity)
          }
        }.onFailure {
          Log.w(LOG_TAG, "system text classification failed", it)
        }.getOrDefault(emptyList())
        publishSmartActions(actions)
      }
    }
    return queryProcessTextActions(selectedText)
  }

  fun cancelPendingClassification() {
    classifierTask?.cancel(true)
    classifierTask = null
  }

  override fun close() {
    cancelPendingClassification()
    classifierExecutor.shutdownNow()
  }

  fun share(selectedText: String): Boolean {
    val sendIntent = Intent(Intent.ACTION_SEND)
      .setType(TEXT_MIME_TYPE)
      .putExtra(Intent.EXTRA_TEXT, selectedText.trimToForumParcelableSize())
    return startExternalActivity(Intent.createChooser(sendIntent, null))
  }

  @Suppress("DEPRECATION")
  private fun queryProcessTextActions(selectedText: String): List<ForumSelectionSystemAction> {
    val packageManager = context.packageManager
    val baseIntent = Intent(Intent.ACTION_PROCESS_TEXT).setType(TEXT_MIME_TYPE)
    return packageManager.queryIntentActivities(baseIntent, 0)
      .asSequence()
      .mapNotNull { resolveInfo ->
        val activityInfo = resolveInfo.activityInfo ?: return@mapNotNull null
        val allowed = activityInfo.packageName == context.packageName ||
          activityInfo.exported && (activityInfo.permission == null ||
            context.checkSelfPermission(activityInfo.permission) == PackageManager.PERMISSION_GRANTED)
        if (!allowed) return@mapNotNull null
        val component = ComponentName(activityInfo.packageName, activityInfo.name)
        runCatching { component to resolveInfo.loadLabel(packageManager) }.getOrNull()
      }
      .distinctBy { it.first }
      .map { (component, label) ->
        ForumSelectionSystemAction(
          key = "process:${component.flattenToShortString()}",
          title = label,
          contentDescription = label,
          icon = null,
          enabled = true,
          showAsAction = MenuItem.SHOW_AS_ACTION_IF_ROOM,
          invoke = {
            startExternalActivity(
              Intent(Intent.ACTION_PROCESS_TEXT)
                .setType(TEXT_MIME_TYPE)
                .setComponent(component)
                .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
                .putExtra(Intent.EXTRA_PROCESS_TEXT, selectedText.trimToForumParcelableSize())
            )
          }
        )
      }
      .toList()
  }

  private fun startExternalActivity(intent: Intent): Boolean = try {
    val activity = activityProvider() ?: (context as? Activity)
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    true
  } catch (error: RuntimeException) {
    Log.w(LOG_TAG, "system text action could not start", error)
    false
  }
}

@TargetApi(Build.VERSION_CODES.P)
internal object TextClassifierApi28 {
  fun classify(
    hostView: View,
    context: Context,
    selectedText: String,
    startExternalActivity: (Intent) -> Boolean
  ): List<ForumSelectionSystemAction> {
    val text = selectedText.trimToForumParcelableSize()
    if (text.isEmpty()) return emptyList()
    val manager = context.getSystemService(TextClassificationManager::class.java) ?: return emptyList()
    val request = TextClassification.Request.Builder(text, 0, text.length)
      .setDefaultLocales(context.resources.configuration.locales)
      .build()
    val classification = manager.textClassifier.classifyText(request)
    return fromClassification(hostView, context, classification, startExternalActivity)
  }

  fun fromClassification(
    hostView: View,
    context: Context,
    classification: TextClassification,
    startExternalActivity: (Intent) -> Boolean
  ): List<ForumSelectionSystemAction> {
    if (classification.actions.isEmpty()) {
      return TextClassifierApi26.fromClassification(
        hostView,
        classification,
        startExternalActivity
      )
    }
    return fromRemoteActions(context, classification.actions)
  }

  fun fromRemoteActions(
    context: Context,
    remoteActions: List<android.app.RemoteAction>
  ): List<ForumSelectionSystemAction> {
    val actions = remoteActions
      .filter { it.isEnabled }
      .distinctBy { it.actionIntent }
    return actions.mapIndexed { index, action ->
      ForumSelectionSystemAction(
        key = "smart:$index",
        title = action.title,
        contentDescription = action.contentDescription,
        icon = if (action.shouldShowIcon()) {
          runCatching { action.icon.loadDrawable(context) }.getOrNull()
        } else {
          null
        },
        enabled = true,
        order = if (index == 0) {
          SYSTEM_ACTION_ORDER_ASSIST
        } else {
          SYSTEM_ACTION_ORDER_SECONDARY_ASSIST + index - 1
        },
        showAsAction = if (index == 0) MenuItem.SHOW_AS_ACTION_ALWAYS else MenuItem.SHOW_AS_ACTION_NEVER,
        finishSelectionOnSuccess = true,
        invoke = {
          try {
            action.actionIntent.send()
            true
          } catch (error: PendingIntent.CanceledException) {
            Log.w(LOG_TAG, "system text action was cancelled", error)
            false
          }
        }
      )
    }
  }
}

@TargetApi(Build.VERSION_CODES.O)
internal object TextClassifierApi26 {
  @Suppress("DEPRECATION")
  fun classify(
    hostView: View,
    context: Context,
    selectedText: String,
    startExternalActivity: (Intent) -> Boolean
  ): List<ForumSelectionSystemAction> {
    val text = selectedText.trimToForumParcelableSize()
    if (text.isEmpty()) return emptyList()
    val manager = context.getSystemService(TextClassificationManager::class.java) ?: return emptyList()
    val classification = manager.textClassifier.classifyText(
      text,
      0,
      text.length,
      context.resources.configuration.locales
    )
    return fromClassification(hostView, classification, startExternalActivity)
  }

  @Suppress("DEPRECATION")
  fun fromClassification(
    hostView: View,
    classification: TextClassification,
    startExternalActivity: (Intent) -> Boolean
  ): List<ForumSelectionSystemAction> {
    val label = classification.label?.takeUnless { it.isEmpty() }
    if (label == null && classification.icon == null) return emptyList()
    val clickListener = classification.onClickListener
    val intent = classification.intent
    if (clickListener == null && intent == null) return emptyList()
    return listOf(
      ForumSelectionSystemAction(
        key = "smart:legacy",
        title = label ?: "",
        contentDescription = label,
        icon = classification.icon,
        enabled = true,
        order = SYSTEM_ACTION_ORDER_ASSIST,
        showAsAction = MenuItem.SHOW_AS_ACTION_ALWAYS,
        finishSelectionOnSuccess = true,
        invoke = {
          if (clickListener != null) {
            clickListener.onClick(hostView)
            true
          } else {
            intent?.let(startExternalActivity) == true
          }
        }
      )
    )
  }
}

internal fun String.trimToForumParcelableSize(maxLength: Int = MAX_PARCELABLE_TEXT_LENGTH): String {
  require(maxLength >= 0)
  if (length <= maxLength) return this
  val end = if (maxLength > 0 && this[maxLength - 1].isHighSurrogate() && this[maxLength].isLowSurrogate()) {
    maxLength - 1
  } else {
    maxLength
  }
  return substring(0, end)
}

internal inline fun forumSelectionSystemActionText(
  isDragging: Boolean,
  copySelection: () -> String?
): String? {
  if (isDragging) return null
  return copySelection()?.takeUnless { it.isEmpty() }
}

private const val LOG_TAG = "ForumSelection"
private const val TEXT_MIME_TYPE = "text/plain"
private const val MAX_PARCELABLE_TEXT_LENGTH = 100_000
internal const val SYSTEM_ACTION_ORDER_ASSIST = 0
internal const val SYSTEM_ACTION_ORDER_SECONDARY_ASSIST = 50
internal const val SYSTEM_ACTION_ORDER_PROCESS_TEXT = 100
