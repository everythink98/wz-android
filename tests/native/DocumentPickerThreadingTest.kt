package com.wz.reader

import android.app.Activity
import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.facebook.react.bridge.BridgeReactContext
import expo.modules.documentpicker.DocumentPickerModule
import expo.modules.documentpicker.DocumentPickerOptions
import expo.modules.documentpicker.DocumentPickerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModuleHolder
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.events.EventName
import expo.modules.kotlin.events.OnActivityResultPayload
import expo.modules.kotlin.modules.Module
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowContentResolver
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises the installed Expo module's activity-result callback, resolver and cache copy. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class DocumentPickerThreadingTest {
    private lateinit var appContext: AppContext
    private lateinit var holder: ModuleHolder<DocumentPickerModule>
    private lateinit var provider: PickerDocumentProvider
    private lateinit var activity: Activity
    private lateinit var reactContext: BridgeReactContext

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        reactContext = object : BridgeReactContext(RuntimeEnvironment.getApplication()) {
            override fun getCurrentActivity(): Activity = activity
        }
        appContext = AppContext(
            object : ModulesProvider {
                override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
            },
            expo.modules.core.ModuleRegistry(emptyList(), emptyList()),
            WeakReference(reactContext)
        )
        val module = DocumentPickerModule()
        appContext.registry.register(module, null)
        holder = requireNotNull(appContext.registry.getModuleHolder(module))
        appContext.onCreate()
        provider = PickerDocumentProvider().apply {
            attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply { authority = AUTHORITY })
        }
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
    }

    @After
    fun tearDown() {
        if (::provider.isInitialized) provider.release.countDown()
        if (::appContext.isInitialized) {
            // Expo's Kotlin-internal lifecycle entry is name-mangled between build variants.
            AppContext::class.java.declaredMethods.single {
                it.name.startsWith("onDestroy") && it.parameterCount == 0
            }.apply { isAccessible = true }.invoke(appContext)
        }
        shadowOf(Looper.getMainLooper()).idle()
        if (::activity.isInitialized) activity.finish()
    }

    @Test
    fun cachedSingleImageUsesContentImportWithTheExistingMimeAndOpenableContract() {
        assertPickerIntent(Intent.ACTION_GET_CONTENT)
    }

    @Test
    fun cachedMultipleImagesUseContentImportWithoutAnAppSelectionLimit() {
        assertPickerIntent(Intent.ACTION_GET_CONTENT, multiple = true)
    }

    @Test
    fun imagesKeptAtTheirOriginalUriUseOpenDocument() {
        assertPickerIntent(Intent.ACTION_OPEN_DOCUMENT, copy = false)
    }

    @Test
    fun wildcardAttachmentsUseOpenDocumentAndKeepMultipleSelection() {
        assertPickerIntent(Intent.ACTION_OPEN_DOCUMENT, types = listOf("*/*"), multiple = true)
    }

    @Test
    fun mixedJsonBackupTypesUseOpenDocumentAndPreserveEveryMimeFilter() {
        assertPickerIntent(Intent.ACTION_OPEN_DOCUMENT, types = listOf("application/json", "text/json", "*/*"))
    }

    private fun assertPickerIntent(
        action: String,
        copy: Boolean = true,
        multiple: Boolean = false,
        types: List<String> = listOf("image/*"),
    ) {
        pick(copy = copy, multiple = multiple, types = types)
        val request = requireNotNull(shadowOf(activity).nextStartedActivityForResult)
        assertEquals(4137, request.requestCode)
        val intent = request.intent
        assertEquals(action, intent.action)
        assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
        assertEquals(multiple, intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertEquals(if (types.size == 1) types.single() else "*/*", intent.type)
        if (types.size > 1) assertArrayEquals(types.toTypedArray(), intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
        else assertNull(intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
        assertFalse("The importer must not add its own photo selection cap", intent.hasExtra("android.provider.extra.PICK_IMAGES_MAX"))
    }

    @Test
    fun slowMetadataProviderLeavesTheMainLooperAvailableUntilSelectionCompletes() {
        assertSlowProviderLeavesMainLooperAvailable(PickerDocumentProvider.BlockAt.QUERY)
    }

    @Test
    fun slowCacheCopyProviderLeavesTheMainLooperAvailableUntilSelectionCompletes() {
        assertSlowProviderLeavesMainLooperAvailable(PickerDocumentProvider.BlockAt.OPEN)
    }

    private fun assertSlowProviderLeavesMainLooperAvailable(blockAt: PickerDocumentProvider.BlockAt) {
        provider.blockAt = blockAt
        val promise = pick()
        result(Intent().setData(uri("first")))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("The real resolver must reach the blocking provider", provider.entered.await(2, TimeUnit.SECONDS))
        var heartbeat = false
        Handler(Looper.getMainLooper()).post { heartbeat = true }
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse("Activity-result delivery must not wait for provider I/O", provider.timedOut)
        assertNotSame("Provider I/O ran on the Android UI thread", Looper.getMainLooper().thread, provider.ioThread)
        assertTrue("The main looper must render/process work while the provider is blocked", heartbeat)
        assertEquals("Do not resolve before the cache copy completes", 0, promise.settlements)

        val overlapping = RecordingPromise()
        assertThrows(Exception::class.java) { pick(promise = overlapping) }
        assertEquals(0, overlapping.settlements)
        provider.release.countDown()
        awaitSettlement(promise)
        assertEquals(1, promise.settlements)
        assertNull(promise.error)
        assertSame(Looper.getMainLooper().thread, promise.settledOn)
        val asset = requireNotNull(promise.value?.assets).single()
        assertEquals("first.png", asset.name)
        assertEquals("image/png", asset.mimeType)
        assertEquals("file", asset.uri.scheme)
        assertArrayEquals(provider.bytes, File(requireNotNull(asset.uri.path)).readBytes())

        val next = pick(copy = false)
        result(Intent().setData(uri("second")))
        awaitSettlement(next)
        assertEquals(uri("second"), requireNotNull(next.value?.assets).single().uri)
        assertEquals(1, promise.settlements)
    }

    @Test
    fun multipleSelectionPreservesAssetOrderAndCopiesEveryFile() {
        val promise = pick(multiple = true)
        result(Intent().apply {
            clipData = ClipData.newUri(reactContext.contentResolver, "images", uri("first")).apply {
                addItem(ClipData.Item(uri("second")))
            }
        })
        awaitSettlement(promise)
        val assets = requireNotNull(promise.value?.assets)
        assertEquals(listOf("first.png", "second.png"), assets.map { it.name })
        assets.forEach { assertArrayEquals(provider.bytes, File(requireNotNull(it.uri.path)).readBytes()) }
    }

    @Test
    fun cancellationDoesNoProviderWorkAndImmediatelyAllowsAnotherPicker() {
        val first = pick()
        result(null, Activity.RESULT_CANCELED)
        assertEquals(true, first.value?.canceled)
        assertEquals(1, first.settlements)
        assertEquals(0, provider.reads)
        val next = pick(copy = false)
        result(Intent().setData(uri("next")))
        awaitSettlement(next)
        assertEquals(uri("next"), requireNotNull(next.value?.assets).single().uri)
    }

    @Test
    fun destroyRejectsThePendingRequestBeforeMainScopeCancellation() {
        val promise = pick()
        holder.post(EventName.MODULE_DESTROY)
        assertEquals("A waiting picker must not retain an unresolved promise after module destruction", 1, promise.settlements)
        assertNotNull(promise.error)
        result(Intent().setData(uri("late")))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, promise.settlements)
        assertEquals(0, provider.reads)
    }

    @Test
    fun cancellingTheScopeBeforeResultWorkStartsStillSettlesThePromise() {
        val promise = pick()
        result(Intent().setData(uri("queued")))
        appContext.mainQueue.cancel()
        awaitSettlement(promise)
        assertNotNull(promise.error)
        assertEquals(0, provider.reads)
    }

    @Test
    fun destroyWhileProviderIsBlockedRejectsOnceWithoutWaitingForIo() {
        provider.blockAt = PickerDocumentProvider.BlockAt.QUERY
        val promise = pick()
        result(Intent().setData(uri("in-flight")))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(provider.entered.await(2, TimeUnit.SECONDS))
        assertFalse(provider.timedOut)
        assertEquals(0, promise.settlements)
        val destruction = Thread { holder.post(EventName.MODULE_DESTROY) }.apply { start() }
        destruction.join(1000)
        assertFalse("Module destruction must not wait for provider I/O", destruction.isAlive)
        assertEquals(1, promise.settlements)
        assertNotNull(promise.error)
        assertThrows(Exception::class.java) { pick() }
        provider.release.countDown()
        awaitCondition("Cancelled I/O must finish without a second settlement") {
            appContext.mainQueue.coroutineContext[Job]!!.children.none()
        }
        assertEquals(1, promise.settlements)
    }

    @Test
    fun providerFailureRejectsOnceAndReleasesThePickerForTheNextRequest() {
        provider.failRead = true
        val first = pick()
        result(Intent().setData(uri("bad")))
        awaitSettlement(first)
        assertEquals(1, first.settlements)
        assertNotNull(first.error)
        provider.failRead = false
        val next = pick(copy = false)
        result(Intent().setData(uri("next")))
        awaitSettlement(next)
        assertNull(next.error)
        assertEquals(uri("next"), requireNotNull(next.value?.assets).single().uri)
    }

    private fun pick(
        copy: Boolean = true,
        multiple: Boolean = false,
        promise: RecordingPromise = RecordingPromise(),
        types: List<String> = listOf("image/*"),
    ): RecordingPromise {
        holder.call("getDocumentAsync", arrayOf(DocumentPickerOptions(copy, types, multiple)), promise)
        return promise
    }

    private fun result(intent: Intent?, code: Int = Activity.RESULT_OK) {
        holder.post(EventName.ON_ACTIVITY_RESULT, activity, OnActivityResultPayload(4137, code, intent))
    }

    private fun awaitSettlement(promise: RecordingPromise) {
        awaitCondition("The picker must settle") { promise.settlements != 0 }
        assertEquals("The picker must settle exactly once", 1, promise.settlements)
    }

    private fun awaitCondition(message: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!condition() && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        assertTrue(message, condition())
    }

    private class RecordingPromise : Promise {
        var settlements = 0
        var value: DocumentPickerResult? = null
        var error: String? = null
        var settledOn: Thread? = null
        override fun resolve(value: Any?) {
            settledOn = Thread.currentThread()
            settlements++
            this.value = value as DocumentPickerResult
        }
        override fun reject(code: String?, message: String?, cause: Throwable?) {
            settledOn = Thread.currentThread()
            settlements++
            error = code ?: message ?: "rejected"
        }
    }

    class PickerDocumentProvider : ContentProvider() {
        enum class BlockAt { QUERY, OPEN }
        var blockAt: BlockAt? = null
        var failRead = false
        var reads = 0
        val bytes = byteArrayOf(1, 2, 3, 4, 5)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        @Volatile var timedOut = false
        @Volatile var ioThread: Thread? = null

        private fun blockAt(point: BlockAt) {
            if (blockAt != point) return
            ioThread = Thread.currentThread()
            entered.countDown()
            if (!release.await(2, TimeUnit.SECONDS)) {
                timedOut = true
                throw IOException("Test provider remained blocked")
            }
        }

        override fun onCreate() = true
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
            reads++
            blockAt(BlockAt.QUERY)
            if (failRead) throw IOException("Provider failed to read metadata")
            return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)).apply {
                addRow(arrayOf<Any>("${uri.lastPathSegment}.png", bytes.size.toLong(), 123L))
            }
        }
        override fun getType(uri: Uri) = "image/png"
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
            blockAt(BlockAt.OPEN)
            val file = File(requireNotNull(context).cacheDir, "picker-provider-${uri.lastPathSegment}.png")
            file.writeBytes(bytes)
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    companion object {
        private const val AUTHORITY = "com.wz.reader.picker-test"
        private fun uri(name: String) = Uri.parse("content://$AUTHORITY/$name")
    }
}
