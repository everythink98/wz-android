package com.wz.reader

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlatformExportInstrumentedTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private fun nodes(root: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> =
    if (root == null) emptyList() else listOf(root) + (0 until root.childCount).flatMap { nodes(root.getChild(it)) }
  private fun awaitNode(label: String, timeout: Long = 20000): AccessibilityNodeInfo {
    val end = SystemClock.elapsedRealtime() + timeout
    do {
      val node = nodes(instrumentation.uiAutomation.rootInActiveWindow).firstOrNull {
        it.text?.toString()?.equals(label, ignoreCase = true) == true || it.contentDescription?.toString()?.equals(label, ignoreCase = true) == true
      }
      if (node != null) return node
      SystemClock.sleep(100)
    } while (SystemClock.elapsedRealtime() < end)
    error("Missing '$label': " + nodes(instrumentation.uiAutomation.rootInActiveWindow).mapNotNull { it.text?.toString() }.joinToString(" | "))
  }
  private fun click(label: String) {
    var node: AccessibilityNodeInfo? = awaitNode(label)
    while (node != null && !node.isClickable) node = node.parent
    check(node?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) { "Cannot click $label" }
  }

  @Test fun realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation() {
    val context = instrumentation.targetContext
    val token = UUID.randomUUID().toString().replace("-", "")
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
      .setAction(Intent.ACTION_VIEW).setData(Uri.parse("wzreviewproof://exports/$token"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    val filter = android.content.IntentFilter(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      addDataType("application/json")
    }
    try {
      awaitNode("platform-ready", 40000)
      for (mode in listOf("eio", "enospc")) {
        val uri = PlatformFileFaultProvider.newUri(mode)
        val monitor = instrumentation.addMonitor(filter,
          android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK, Intent().setData(uri)), true)
        try {
          click("Platform save backup")
          val deadline = SystemClock.elapsedRealtime() + 15000
          while (nodes(instrumentation.uiAutomation.rootInActiveWindow).none { it.text?.toString()?.startsWith("backup-error:") == true }) {
            check(SystemClock.elapsedRealtime() < deadline) { "Provider write error did not reject the real backup Promise" }
            SystemClock.sleep(50)
          }
          assertEquals(1, monitor.hits)
          val stats = awaitProviderFaultRelease(context.contentResolver, uri)
          assertEquals(PlatformFileFaultProvider.QUOTA_BYTES.toLong(), stats.getLong("bytes"))
          assertTrue(stats.getInt("writeErrors") > 0)
        } finally {
          instrumentation.removeMonitor(monitor)
          context.contentResolver.delete(uri, null, null)
        }
        // A fresh canceled picker must complete after each failed write, proving finally released busy.
        val cancel = instrumentation.addMonitor(filter,
          android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED, null), true)
        try {
          click("Platform save backup")
          awaitNode("backup-canceled")
          assertEquals(1, cancel.hits)
        } finally { instrumentation.removeMonitor(cancel) }
      }
      instrumentation.sendStatus(0, android.os.Bundle().apply {
        putString("stream", "\nBACKUP_PROVIDER_BRIDGE errors=EIO,ENOSPC promise=rejected nextOperation=canceled scope=controlled-provider\n")
      })
    } finally {
      File(context.cacheDir, "platform-export-proof.json").delete()
      instrumentation.runOnMainSync { if (!activity.isDestroyed) activity.finish() }
    }
  }

  @Test fun safRoundTripCancellationRecreationAndDelayedSharingUseRealExpoBridges() {
    val context = instrumentation.targetContext
    val token = UUID.randomUUID().toString().replace("-", "")
    val filename = "备份🙂-forum-platform-proof-$token.json"
    val ownedBackupUris = java.util.concurrent.ConcurrentHashMap.newKeySet<Uri>()
    val receiverResult = java.util.concurrent.atomic.AtomicReference<String>()
    val receiver = object : android.content.BroadcastReceiver() {
      override fun onReceive(context: android.content.Context?, intent: Intent?) { receiverResult.set(intent?.getStringExtra("result")) }
    }
    context.registerReceiver(receiver, android.content.IntentFilter("com.wz.reader.PLATFORM_DIAGNOSTIC_RECEIVED"), android.content.Context.RECEIVER_EXPORTED)
    var ownedDiagnosticExport: File? = null
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
      .setAction(Intent.ACTION_VIEW).setData(Uri.parse("wzreviewproof://exports/$token"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    try {
      awaitNode("platform-ready", 40000)
      val reactContext = requireNotNull((context.applicationContext as com.facebook.react.ReactApplication).reactHost?.currentReactContext)
      // The legacy Expo proxy has no @ReactModule annotation; bridgeless class lookup
      // deliberately returns null for it, while the public name lookup supports it.
      val proxy = requireNotNull(reactContext.getNativeModule("NativeUnimoduleProxy") as? expo.modules.adapters.react.NativeModulesProxy)
      val expoRegistry = proxy.kotlinInteropModuleRegistry.appContext.registry
      instrumentation.runOnMainSync {
        expoRegistry.register(object : Module() {
          override fun definition() = ModuleDefinition {
            Name("BackupProofObserver")
            OnActivityResult { _, (requestCode, resultCode, resultIntent) ->
              if (requestCode in 0x8000..0xffff && resultCode == android.app.Activity.RESULT_OK)
                resultIntent?.data?.let { ownedBackupUris.add(it) }
            }
          }
        })
      }
      click("Platform save backup")
      awaitNode("Save")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitNode("backup-canceled")
      click("Platform concurrent backup")
      awaitNode("Save")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitNode("concurrent-canceled")
      click("Platform save backup")
      awaitNode("Save")
      instrumentation.runOnMainSync { activity.recreate() }
      SystemClock.sleep(500)
      click("Save")
      // Recreating the React surface remounts the proof component. The original invocation
      // writes its receipt outside component state, so this still proves its Promise resumed.
      val receiptFile = File(context.cacheDir, "platform-export-proof.json")
      val savedDeadline = SystemClock.elapsedRealtime() + 20000
      while (true) {
        val saved = runCatching { org.json.JSONObject(receiptFile.readText()) }.getOrNull()
        if (saved != null && saved.optString("token") == token && saved.optString("name") == "backup" && saved.optString("result") == "saved") break
        check(SystemClock.elapsedRealtime() < savedDeadline) { "Recreated backup invocation did not complete: $saved" }
        SystemClock.sleep(100)
      }
      click("Platform import backup")
      click(filename)
      awaitNode("import-passed")
      assertEquals(1, ownedBackupUris.size)
      val firstBackupUri = ownedBackupUris.single()
      fun backupDigest(uri: Uri): ByteArray {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        requireNotNull(context.contentResolver.openInputStream(uri)).use { input ->
          val buffer = ByteArray(32 * 1024)
          while (true) { val count = input.read(buffer); if (count == -1) break; digest.update(buffer, 0, count) }
        }
        return digest.digest()
      }
      val firstBackupDigest = backupDigest(firstBackupUri)
      // The proof asks for the same Unicode title again. Let ACTION_CREATE_DOCUMENT
      // resolve the collision; identify its result by URI and provider metadata, not a suffix.
      click("Platform save backup")
      awaitNode("Save")
      click("Save")
      awaitNode("backup-saved")
      assertEquals("A second create must preserve the existing document", 2, ownedBackupUris.size)
      val secondBackupUri = ownedBackupUris.single { it != firstBackupUri }
      assertArrayEquals("The existing document changed", firstBackupDigest, backupDigest(firstBackupUri))
      assertArrayEquals("The second backup bytes changed", firstBackupDigest, backupDigest(secondBackupUri))
      val secondBackupName = requireNotNull(context.contentResolver.query(secondBackupUri,
        arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)).use { cursor ->
        check(cursor.moveToFirst()) { "The created document has no metadata" }
        cursor.getString(0)
      }
      click("Platform import backup")
      click(secondBackupName)
      awaitNode("import-passed")
      val imagePermission = "android.permission.READ_MEDIA_IMAGES"
      val hadImagePermission = context.checkSelfPermission(imagePermission) == android.content.pm.PackageManager.PERMISSION_GRANTED
      check(hadImagePermission) { "Runner must temporarily grant and later restore the image permission" }
      fun imageIds(): Set<Long> = context.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        arrayOf(MediaStore.Images.Media._ID), null, null, null)!!.use { cursor ->
        buildSet { while (cursor.moveToNext()) add(cursor.getLong(0)) }
      }
      val beforeImages = imageIds()
      val imageFiles = File(context.cacheDir, "image-saves")
      val beforeImageFiles = imageFiles.listFiles()?.map { it.name }?.toSet() ?: emptySet()
      var newImage: Long? = null
      val worker = Executors.newSingleThreadExecutor()
      try {
        ServerSocket(42189, 1, InetAddress.getByName("127.0.0.1")).use { server ->
          val served = worker.submit {
            val png = java.io.ByteArrayOutputStream().also { output ->
              android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888).apply {
                eraseColor(android.graphics.Color.MAGENTA)
                compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
                recycle()
              }
            }.toByteArray()
            server.accept().use { socket ->
              val reader = socket.getInputStream().bufferedReader()
              while (!reader.readLine().isNullOrEmpty()) Unit
              socket.getOutputStream().use { output ->
                output.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${png.size}\r\nConnection: close\r\n\r\n".toByteArray())
                output.write(png)
              }
            }
          }
          click("Platform save image")
          awaitNode("image-passed")
          served.get(10, TimeUnit.SECONDS)
          val added = imageIds() - beforeImages
          assertEquals(1, added.size)
          newImage = added.single()
          val uri = android.content.ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, newImage!!)
          val bitmap = requireNotNull(context.contentResolver.openInputStream(uri).use { android.graphics.BitmapFactory.decodeStream(it) }) {
            "saved image must decode from MediaStore"
          }
          assertEquals(1, bitmap.width)
          bitmap.recycle()
          assertEquals(beforeImageFiles, imageFiles.listFiles()!!.map { it.name }.toSet())
        }
      } finally {
        newImage?.let { context.contentResolver.delete(android.content.ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, it), null, null) }
        worker.shutdownNow()
      }
      val exportDirectory = File(context.filesDir, "diagnostic-exports")
      val beforeExports = exportDirectory.listFiles()?.map { it.name }?.toSet() ?: emptySet()
      click("Platform share diagnostic")
      click("Delayed diagnostic proof")
      awaitNode("diagnostic-passed")
      val exported = exportDirectory.listFiles()!!.filter { it.name !in beforeExports }
      assertEquals(1, exported.size)
      ownedDiagnosticExport = exported.single()
      context.sendBroadcast(Intent("com.wz.reader.PLATFORM_DIAGNOSTIC_READ").setPackage("com.wz.reader.test"))
      val deadline = SystemClock.elapsedRealtime() + 10000
      while (receiverResult.get() == null && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100)
      assertTrue("delayed receiver must read the file: ${receiverResult.get()}", receiverResult.get()?.startsWith("READ_OK\n") == true)
      val digest = java.security.MessageDigest.getInstance("SHA-256")
      exported.single().inputStream().use { input ->
        val buffer = ByteArray(32 * 1024)
        while (true) { val count = input.read(buffer); if (count == -1) break; digest.update(buffer, 0, count) }
      }
      assertEquals("READ_OK\n${exported.single().length()}\n" + digest.digest().joinToString("") { "%02x".format(it) }, receiverResult.get())
      val receipt = File(context.cacheDir, "platform-export-proof.json").readText()
      assertEquals(InstrumentationRegistry.getArguments().getString("proofBuildId"), org.json.JSONObject(receipt).getString("buildId"))
      assertTrue(receipt.contains("\"isHermes\":true"))
      assertTrue(receipt.contains("\"isDev\":false"))
      instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "\nPLATFORM_EXPORT_RECEIPT $receipt\n") })
      click("Platform save backup")
      awaitNode("Save")
      val backupModule = requireNotNull(expoRegistry.getModuleHolder("BackupExport"))
      instrumentation.runOnMainSync { backupModule.post(expo.modules.kotlin.events.EventName.MODULE_DESTROY) }
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      val destroyedDeadline = SystemClock.elapsedRealtime() + 10000
      while (nodes(instrumentation.uiAutomation.rootInActiveWindow).none {
          it.text?.toString()?.let { text -> text.startsWith("backup-error:") && text.contains("备份保存已中止") } == true
        }) {
        check(SystemClock.elapsedRealtime() < destroyedDeadline) { "Destroyed owner did not reject its original Promise" }
        SystemClock.sleep(100)
      }
      instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "\nPLATFORM_EXPORT saf=roundtrip,same-name-preserves-existing,cancel,concurrent,recreate,owner-destroy image=managed-to-MediaStore diagnostic=delayed-receiver\n") })
    } finally {
      // Use the actual provider URI (Downloads may use a different authority), and only
      // documents returned to this case's private request-code range are eligible.
      ownedBackupUris.forEach { assertTrue("owned backup cleanup failed", DocumentsContract.deleteDocument(context.contentResolver, it)) }
      ownedDiagnosticExport?.delete()
      // Older failed runs of this new fixture identify their own exports in the header.
      File(context.filesDir, "diagnostic-exports").listFiles()?.forEach { file ->
        val header = runCatching { file.bufferedReader().use { it.readLine() }?.let { org.json.JSONObject(it) } }.getOrNull()
        if (header != null && header.optString("appVersion") == "isolated-proof" && header.optInt("versionCode") == 1) {
          assertTrue("owned diagnostic cleanup failed", file.delete())
        }
      }
      File(context.cacheDir, "platform-export-proof.json").delete()
      context.unregisterReceiver(receiver)
      instrumentation.runOnMainSync { if (!activity.isDestroyed) activity.finish() }
    }
  }
}
