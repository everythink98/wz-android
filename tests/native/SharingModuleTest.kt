package com.wz.reader

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Looper
import androidx.core.content.FileProvider
import com.facebook.react.bridge.BridgeReactContext
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModuleHolder
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.events.EventName
import expo.modules.kotlin.events.OnActivityResultPayload
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.sharing.SharingModule
import expo.modules.sharing.SharingOptions
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, shadows = [SharingModuleTest.LocalFileProvider::class])
@LooperMode(LooperMode.Mode.PAUSED)
class SharingModuleTest {
    private lateinit var controller: ActivityController<ChooserActivity>
    private lateinit var activity: ChooserActivity
    private lateinit var reactContext: BridgeReactContext
    private lateinit var appContext: AppContext
    private lateinit var holder: ModuleHolder<SharingModule>
    private lateinit var file: File

    @Before
    fun setUp() {
        controller = Robolectric.buildActivity(ChooserActivity::class.java).setup()
        activity = controller.get()
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
        val module = SharingModule()
        appContext.registry.register(module, null)
        holder = requireNotNull(appContext.registry.getModuleHolder(module))
        appContext.onCreate()
        file = File(reactContext.cacheDir, "share-test.png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    }

    @After
    fun tearDown() {
        if (::file.isInitialized) file.delete()
        if (::appContext.isInitialized) {
            AppContext::class.java.declaredMethods.single {
                it.name.startsWith("onDestroy") && it.parameterCount == 0
            }.apply { isAccessible = true }.invoke(appContext)
        }
        shadowOf(Looper.getMainLooper()).idle()
        if (::activity.isInitialized) activity.finish()
    }

    @Test
    fun failedChooserLaunchAllowsRetryAndOnlyTheActiveShareReceivesItsResult() {
        activity.failNextLaunch = true
        val rejected = RecordingPromise()
        val failure = assertThrows(CodedException::class.java) { share(rejected) }
        assertEquals("ERR_SHARING_NOT_STARTED", failure.code)
        assertTrue(generateSequence<Throwable>(failure) { it.cause }.any {
            it.message?.contains("No chooser for the first request") == true
        })
        assertEquals(0, rejected.resolutions)

        val retry = RecordingPromise()
        share(retry)
        val request = requireNotNull(shadowOf(activity).nextStartedActivityForResult)
        assertEquals(Intent.ACTION_CHOOSER, request.intent.action)
        assertEquals(0, retry.resolutions)
        val overlapping = RecordingPromise()
        val busy = assertThrows(CodedException::class.java) { share(overlapping) }
        assertEquals("ERR_SHARING_NOT_STARTED", busy.code)
        deliverResult(request.requestCode + 1)
        assertEquals(0, retry.resolutions)

        deliverResult(request.requestCode)
        deliverResult(request.requestCode)
        assertEquals(1, retry.resolutions)
        assertEquals(0, rejected.resolutions)
        assertEquals(0, overlapping.resolutions)
        val next = RecordingPromise()
        share(next)
        deliverResult(requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode)
        assertEquals(1, next.resolutions)
    }

    @Test
    fun rotatingTheHostKeepsTheChooserAndItsLateDuplicateCannotSettleTheNextShare() {
        val original = RecordingPromise()
        share(original)
        val firstCode = requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode
        val previousActivity = activity
        activity.notifyHostDestroyed = {
            assertTrue(previousActivity.isChangingConfigurations)
            holder.post(EventName.ACTIVITY_DESTROYS)
        }
        val rotated = Configuration(activity.resources.configuration).apply {
            orientation = if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
                Configuration.ORIENTATION_PORTRAIT
            } else Configuration.ORIENTATION_LANDSCAPE
        }
        activity = controller.configurationChange(rotated).get()
        assertNotSame(previousActivity, activity)

        assertTrue(original.rejections.isEmpty())
        assertEquals(0, original.resolutions)
        assertEquals("ERR_SHARING_NOT_STARTED", assertThrows(CodedException::class.java) {
            share(RecordingPromise())
        }.code)
        deliverResult(firstCode)
        assertEquals(1, original.resolutions)

        val next = RecordingPromise()
        share(next)
        val secondCode = requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode
        deliverResult(firstCode)
        assertEquals(0, next.resolutions)
        deliverResult(secondCode)
        assertEquals(1, next.resolutions)
    }

    @Test
    fun finishingTheHostReleasesTheOpenedChooserWithoutMarkingItSafeToRetry() {
        val first = RecordingPromise()
        share(first)
        val staleCode = requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode
        activity.finish()
        holder.post(EventName.ACTIVITY_DESTROYS)
        assertEquals(listOf("ERR_SHARING_RESULT_UNKNOWN"), first.rejections)
        assertEquals(0, first.resolutions)

        activity = Robolectric.buildActivity(ChooserActivity::class.java).setup().get()
        val next = RecordingPromise()
        share(next)
        val nextCode = requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode
        deliverResult(staleCode)
        assertEquals(0, next.resolutions)
        deliverResult(nextCode)
        assertEquals(1, next.resolutions)
        assertTrue(next.rejections.isEmpty())
    }

    @Test
    fun destroyingTheModuleAfterLaunchSettlesTheCallerOnceWithAnUnknownOutcome() {
        val promise = RecordingPromise()
        share(promise)
        val code = requireNotNull(shadowOf(activity).nextStartedActivityForResult).requestCode
        holder.post(EventName.MODULE_DESTROY)
        deliverResult(code)
        assertEquals(listOf("ERR_SHARING_RESULT_UNKNOWN"), promise.rejections)
        assertEquals(0, promise.resolutions)
    }

    @Test
    fun destructionBeforeTheMainThreadOpensTheChooserAllowsSafeRecovery() {
        val promise = RecordingPromise()
        val prepare = FutureTask { share(promise) }
        Thread(prepare).start()
        prepare.get(10, TimeUnit.SECONDS)
        holder.post(EventName.MODULE_DESTROY)
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(listOf("ERR_SHARING_NOT_STARTED"), promise.rejections)
        assertEquals(0, promise.resolutions)
        assertNull(shadowOf(activity).nextStartedActivityForResult)
    }

    private fun share(promise: RecordingPromise) {
        holder.call("shareAsync", arrayOf(Uri.fromFile(file).toString(), SharingOptions("image/png", null, "PNG")), promise)
    }

    private fun deliverResult(requestCode: Int) {
        holder.post(EventName.ON_ACTIVITY_RESULT, activity, OnActivityResultPayload(requestCode, Activity.RESULT_CANCELED, null))
    }

    private class RecordingPromise : Promise {
        var resolutions = 0
            private set
        val rejections = mutableListOf<String?>()

        override fun resolve(value: Any?) {
            resolutions++
        }

        override fun reject(code: String?, message: String?, cause: Throwable?) {
            rejections.add(code)
        }
    }

    class ChooserActivity : Activity() {
        var failNextLaunch = false
        var notifyHostDestroyed: (() -> Unit)? = null

        override fun onDestroy() {
            notifyHostDestroyed?.invoke()
            super.onDestroy()
        }

        override fun startActivityForResult(intent: Intent, requestCode: Int) {
            if (failNextLaunch) {
                failNextLaunch = false
                throw ActivityNotFoundException("No chooser for the first request")
            }
            super.startActivityForResult(intent, requestCode)
        }
    }

    // Isolate provider lookup so the host test can exercise the real launch and result handling.
    @Implements(FileProvider::class)
    class LocalFileProvider {
        companion object {
            @JvmStatic
            @Implementation
            fun getUriForFile(context: Context, authority: String, file: File): Uri =
                Uri.parse("content://$authority/${file.name}")
        }
    }
}
