package com.wz.reader

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.content.pm.SigningInfo
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import java.io.File
import java.lang.reflect.Proxy
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowSigningInfo
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, shadows = [ApkInstallerSignerTest.MapArguments::class])
class ApkInstallerSignerTest {
  @Before fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
  }

  @Test
  fun acceptsOnlyOneCurrentSigner() {
    assertEquals("current", singleCurrentApkSigner(arrayOf("current"), arrayOf("old", "current")))
    assertNull(singleCurrentApkSigner(emptyArray<String>(), arrayOf("old")))
    assertNull(singleCurrentApkSigner(arrayOf("current", "other"), arrayOf("old")))
  }

  @Test fun inspectionDoesNotHoldTheNativeCallQueueWhileReadingThePackage() {
    val directory = Files.createTempDirectory("apk-inspection").toFile()
    val file = File(directory, "candidate.apk").apply { writeBytes(ByteArray(65549) { (it % 251).toByte() }) }
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val nextCall = CountDownLatch(1)
    val inspectionThread = AtomicReference<String>()
    val context = object : BridgeReactContext(RuntimeEnvironment.getApplication()) {
      override fun getPackageManager(): PackageManager {
        inspectionThread.set(Thread.currentThread().name)
        entered.countDown()
        check(release.await(5, TimeUnit.SECONDS)) { "inspection was not released" }
        return super.getPackageManager()
      }
    }
    registerPackage(file)
    val module = ApkInstallerModule(context)
    val result = InspectionResult()
    val nativeQueue = Executors.newSingleThreadExecutor { Thread(it, "test-native-call-queue") }
    try {
      nativeQueue.execute { module.inspectApk(Uri.fromFile(file).toString(), result.promise) }
      nativeQueue.execute { nextCall.countDown() }
      assertTrue("package inspection must begin", entered.await(5, TimeUnit.SECONDS))
      assertTrue("the next Native call must run while package inspection is blocked", nextCall.await(2, TimeUnit.SECONDS))
      assertNotEquals("test-native-call-queue", inspectionThread.get())
      module.invalidate()
      result.assertPending()
    } finally {
      release.countDown()
      nativeQueue.shutdown()
      assertTrue(nativeQueue.awaitTermination(5, TimeUnit.SECONDS))
      result.await()
      module.invalidate()
      directory.deleteRecursively()
    }
    assertEquals("resolve", result.method)
    val payload = result.arguments.single() as ReadableMap
    assertEquals("33f9cba23051eac8d80d02211b374b52ba2e8ef6c59213e1b269e9b984411838", payload.getString("sha256"))
    assertEquals("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81", payload.getString("signerSha256"))
    assertEquals("com.wz.reader.fixture", payload.getString("packageName"))
    assertEquals("2.0.0", payload.getString("versionName"))
    assertEquals(456.0, payload.getDouble("versionCode"), 0.0)
  }

  @Test fun inspectionPreservesMissingInvalidSignerAndReadFailures() {
    val directory = Files.createTempDirectory("apk-errors").toFile()
    val module = ApkInstallerModule(BridgeReactContext(RuntimeEnvironment.getApplication()))
    fun rejected(file: File, code: String) {
      val result = InspectionResult()
      module.inspectApk(Uri.fromFile(file).toString(), result.promise)
      result.await()
      assertEquals("reject", result.method)
      assertEquals(code, result.arguments.first())
    }
    try {
      rejected(File(directory, "missing.apk"), "apk_missing")
      val invalid = File(directory, "invalid.apk").apply { writeText("not an APK") }
      rejected(invalid, "apk_invalid")
      registerPackage(invalid, emptyArray())
      rejected(invalid, "apk_signature_missing")
      val unreadable = File(directory, "directory.apk").apply { mkdir() }
      registerPackage(unreadable)
      rejected(unreadable, "apk_inspect_failed")
    } finally {
      module.invalidate()
      directory.deleteRecursively()
    }
  }

  @Test fun executorRejectionSettlesTheInspectionWithoutReadingThePackage() {
    val failure = RejectedExecutionException("inspection unavailable")
    val module = ApkInstallerModule(
      BridgeReactContext(RuntimeEnvironment.getApplication()),
      java.util.concurrent.Executor { throw failure }
    )
    val result = InspectionResult()
    try {
      module.inspectApk("file:///not-read.apk", result.promise)
      result.await()
      assertEquals("reject", result.method)
      assertEquals("apk_inspect_failed", result.arguments.first())
      assertEquals(failure, result.arguments.last())
    } finally {
      module.invalidate()
    }
  }

  private fun registerPackage(file: File, signatures: Array<Signature> = arrayOf(Signature(byteArrayOf(1, 2, 3)))) {
    val signing = ReflectionHelpers.callConstructor(SigningInfo::class.java)
    Shadow.extract<ShadowSigningInfo>(signing).setSignatures(signatures)
    val info = PackageInfo().apply {
      packageName = "com.wz.reader.fixture"
      versionName = "2.0.0"
      longVersionCode = 456
      signingInfo = signing
    }
    shadowOf(RuntimeEnvironment.getApplication().packageManager).setPackageArchiveInfo(file.absolutePath, info)
  }

  private class InspectionResult {
    private val done = CountDownLatch(1)
    private val calls = AtomicInteger()
    lateinit var method: String
    lateinit var arguments: List<Any?>
    val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, called, args ->
      if (called.name == "resolve" || called.name == "reject") {
        method = called.name
        arguments = args.orEmpty().toList()
        calls.incrementAndGet()
        done.countDown()
      }
      null
    } as Promise

    fun assertPending() {
      assertEquals(0, calls.get())
    }

    fun await() {
      assertTrue("inspection must settle", done.await(5, TimeUnit.SECONDS))
      assertEquals("inspection must settle exactly once", 1, calls.get())
    }
  }

  @Implements(Arguments::class)
  class MapArguments {
    companion object {
      @JvmStatic @Implementation fun createMap(): WritableMap = JavaOnlyMap()
    }
  }
}
