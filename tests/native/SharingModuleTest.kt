package com.wz.reader

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
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
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode
import java.io.File
import java.lang.ref.WeakReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, shadows = [SharingModuleTest.LocalFileProvider::class])
@LooperMode(LooperMode.Mode.PAUSED)
class SharingModuleTest {
    private lateinit var activity: ChooserActivity
    private lateinit var reactContext: BridgeReactContext
    private lateinit var appContext: AppContext
    private lateinit var holder: ModuleHolder<SharingModule>
    private lateinit var file: File

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ChooserActivity::class.java).setup().get()
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

    private fun share(promise: RecordingPromise) {
        holder.call("shareAsync", arrayOf(Uri.fromFile(file).toString(), SharingOptions("image/png", null, "PNG")), promise)
    }

    private fun deliverResult(requestCode: Int) {
        holder.post(EventName.ON_ACTIVITY_RESULT, activity, OnActivityResultPayload(requestCode, Activity.RESULT_CANCELED, null))
    }

    private class RecordingPromise : Promise {
        var resolutions = 0
            private set

        override fun resolve(value: Any?) {
            resolutions++
        }

        override fun reject(code: String?, message: String?, cause: Throwable?) {
            throw AssertionError("Unexpected direct rejection: $code $message", cause)
        }
    }

    class ChooserActivity : Activity() {
        var failNextLaunch = false

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
