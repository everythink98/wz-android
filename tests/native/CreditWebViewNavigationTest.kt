package com.wz.reader

import android.app.Activity
import android.net.Uri
import android.webkit.WebResourceRequest
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.common.annotations.FrameworkAPI
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewClient
import com.reactnativecommunity.webview.RNCWebViewManagerImpl
import com.reactnativecommunity.webview.RNCWebViewWrapper
import java.lang.reflect.Proxy
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class CreditWebViewNavigationTest {
    private lateinit var activity: ActivityController<Activity>
    private lateinit var webView: NavigationWebView
    private lateinit var wrapper: RNCWebViewWrapper
    private val client = RNCWebViewClient()
    private var jsContext: JavaScriptContextHolder? = null

    @Before
    @OptIn(FrameworkAPI::class, UnstableReactNativeAPI::class)
    fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup()
        val react = object : BridgeReactContext(RuntimeEnvironment.getApplication()) {
            override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = jsContext

            override fun <T : JavaScriptModule> getJSModule(type: Class<T>): T =
                requireNotNull(type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, _, _ -> null }))
        }
        val context = ThemedReactContext(react, activity.get(), "CreditNavigationTest", 1)
        webView = NavigationWebView(context).apply { webViewClient = client }
        wrapper = RNCWebViewWrapper(context, webView)
        activity.get().setContentView(wrapper)
        RNCWebViewManagerImpl().setAndroidNavigationAllowedOrigins(
            wrapper, JavaOnlyArray.of("https://reader.example.test", "https://challenge.example.test")
        )
    }

    @After
    fun tearDown() {
        if (::webView.isInitialized) webView.destroy()
        if (::activity.isInitialized) activity.pause().stop().destroy()
    }

    @Test
    fun allowedSubframeAndMainFrameContinueTheirOriginalRequestsWithoutJsBridge() {
        assertFalse(client.shouldOverrideUrlLoading(webView, Request("https://challenge.example.test/frame", false)))
        assertFalse(client.shouldOverrideUrlLoading(webView, Request("https://reader.example.test/home", true)))
        assertTrue(webView.rootLoads.isEmpty())
    }

    @Test
    fun allowedSubframeAndLegacyRequestContinueDuringJsDebugging() {
        jsContext = JavaScriptContextHolder(0)
        assertFalse(client.shouldOverrideUrlLoading(webView, Request("HTTPS://Challenge.example.test:443/frame", false)))
        @Suppress("DEPRECATION")
        assertFalse(client.shouldOverrideUrlLoading(webView, "https://reader.example.test/home"))
        assertTrue(webView.rootLoads.isEmpty())
    }

    @Test
    fun rejectsNonMatchingOriginsWithoutUsingJsFallback() {
        val rejected = listOf(
            "http://reader.example.test/home",
            "https://other.example.test/home",
            "https://reader.example.test:9443/home"
        )
        for (url in rejected) {
            assertTrue(url, client.shouldOverrideUrlLoading(webView, Request(url, false)))
            assertTrue(url, client.shouldOverrideUrlLoading(webView, Request(url, true)))
        }
        assertTrue(webView.rootLoads.isEmpty())
    }

    @Test
    fun rejectsMainFrameStartBeforeInjectingEvenWithoutOverrideEvent() {
        client.onPageStarted(webView, "https://other.example.test/home", null)
        assertEquals(1, webView.stoppedLoads)
        assertEquals(0, webView.startInjections)
        client.onPageFinished(webView, "https://other.example.test/home")
        assertEquals(0, webView.finishInjections)
        assertEquals(403, client.shouldInterceptRequest(webView, Request("https://other.example.test/home", true))?.statusCode)
        assertEquals(null, client.shouldInterceptRequest(webView, Request("https://reader.example.test/home", true)))
    }

    private class NavigationWebView(context: ThemedReactContext) : RNCWebView(context) {
        val rootLoads = mutableListOf<String>()
        var stoppedLoads = 0
        var startInjections = 0
        var finishInjections = 0

        override fun stopLoading() { stoppedLoads += 1 }

        override fun callInjectedJavaScriptBeforeContentLoaded() { startInjections += 1 }

        override fun callInjectedJavaScript() { finishInjections += 1 }

        override fun loadUrl(url: String) {
            rootLoads.add(url)
        }
    }

    private class Request(private val rawUrl: String, private val mainFrame: Boolean) : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(rawUrl)
        override fun isForMainFrame(): Boolean = mainFrame
        override fun isRedirect(): Boolean = false
        override fun hasGesture(): Boolean = false
        override fun getMethod(): String = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }
}
