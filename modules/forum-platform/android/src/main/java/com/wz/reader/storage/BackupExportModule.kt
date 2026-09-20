package com.wz.reader

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicInteger

internal sealed interface BackupDocumentResult {
  data object Canceled : BackupDocumentResult
  data class Selected(val uri: Uri) : BackupDocumentResult
  data class Failed(val message: String) : BackupDocumentResult
}

internal class BackupDocumentContract : AppContextActivityResultContract<String, BackupDocumentResult> {
  override fun createIntent(context: Context, input: String) = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
    addCategory(Intent.CATEGORY_OPENABLE)
    type = "application/json"
    putExtra(Intent.EXTRA_TITLE, input)
  }

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): BackupDocumentResult {
    if (resultCode == Activity.RESULT_CANCELED) return BackupDocumentResult.Canceled
    if (resultCode != Activity.RESULT_OK) return BackupDocumentResult.Failed("保存备份未完成。")
    return intent?.data?.let { BackupDocumentResult.Selected(it) }
      ?: BackupDocumentResult.Failed("文件提供程序未返回保存位置。")
  }
}

internal fun openBackupDocumentOutput(resolver: ContentResolver, uri: Uri): OutputStream {
  val descriptor = requireNotNull(resolver.openFileDescriptor(uri, "wt")) { "无法打开所选保存位置。" }
  return object : ParcelFileDescriptor.AutoCloseOutputStream(descriptor) {
    override fun close() {
      try {
        // Surface an error already reported by a reliable provider; do not wait for remote sync.
        if (descriptor.canDetectErrors()) descriptor.checkError()
      } finally {
        super.close()
      }
    }
  }
}

// Success requires every write, flush, and local stream close to complete without an error.
internal fun writeBackupDocument(bytes: ByteArray, stream: OutputStream, checkActive: () -> Unit): Int {
  stream.use { output ->
    var offset = 0
    while (offset < bytes.size) {
      checkActive()
      val count = minOf(8192, bytes.size - offset)
      output.write(bytes, offset, count)
      offset += count
    }
    checkActive()
    output.flush()
  }
  return bytes.size
}

internal class BackupExportOwner {
  data class Operation(val requestCode: Int, val result: CompletableDeferred<BackupDocumentResult>)
  private var pending: Operation? = null
  private var destroyed = false
  companion object {
    // Expo's registry uses upper bits; each invocation owns a lower-16-bit code for this
    // process, including across module replacement. Never recycle a late result's code.
    private val nextRequestCode = AtomicInteger(0x8000)
  }

  @Synchronized fun begin(): Operation {
    ensureAlive()
    check(pending == null) { "已有备份正在保存，请先完成或取消。" }
    val requestCode = nextRequestCode.getAndIncrement()
    check(requestCode <= 0xffff) { "系统保存请求已用尽，请重启应用后重试。" }
    return Operation(requestCode, CompletableDeferred()).also { pending = it }
  }

  @Synchronized fun complete(requestCode: Int, result: BackupDocumentResult) {
    pending?.takeIf { it.requestCode == requestCode }?.result?.complete(result)
  }

  @Synchronized fun ensureAlive() { check(!destroyed) { "备份保存已中止。" } }

  @Synchronized fun finish(operation: Operation) { if (pending === operation) pending = null }

  @Synchronized fun destroy() {
    destroyed = true
    val abandoned = pending
    pending = null
    abandoned?.result?.completeExceptionally(IllegalStateException("备份保存已中止。"))
  }
}

class BackupExportModule : Module() {
  private val owner = BackupExportOwner()
  private val contract = BackupDocumentContract()

  override fun definition() = ModuleDefinition {
    Name("BackupExport")
    // The SDK's Activity-bound registry unregisters its suspended callback on recreation.
    // Follow ExpoDocumentPicker's AppContext-owned event path instead.
    OnActivityResult { _, (requestCode, resultCode, intent) ->
      owner.complete(requestCode, contract.parseResult("", resultCode, intent))
    }
    OnDestroy { owner.destroy() }
    AsyncFunction("saveBackupDocument") Coroutine { fileName: String, json: String ->
      val operation = owner.begin()
      try {
        // JSON stays with the invocation, never in an Activity Intent or saved Bundle.
        withContext(Dispatchers.Main) {
          owner.ensureAlive()
          val activity = requireNotNull(appContext.currentActivity) { "当前页面不可用。" }
          activity.startActivityForResult(contract.createIntent(activity, fileName), operation.requestCode)
        }
        // Decode without throwing on the Activity callback; reject in this invocation.
        val uri = when (val result = operation.result.await()) {
          BackupDocumentResult.Canceled -> return@Coroutine mapOf("status" to "canceled")
          is BackupDocumentResult.Failed -> throw IllegalStateException(result.message)
          is BackupDocumentResult.Selected -> result.uri
        }
        val resolver = requireNotNull(appContext.reactContext).contentResolver
        val count = withContext(Dispatchers.IO) {
          val context = currentCoroutineContext()
          context.ensureActive()
          owner.ensureAlive()
          val output = openBackupDocumentOutput(resolver, uri)
          writeBackupDocument(json.toByteArray(Charsets.UTF_8), output) {
            context.ensureActive()
            owner.ensureAlive()
          }
        }
        owner.ensureAlive()
        // This confirms provider acceptance, not completion of a cloud upload.
        mapOf("status" to "saved", "byteCount" to count)
      } finally {
        owner.finish(operation)
      }
    }
  }
}
