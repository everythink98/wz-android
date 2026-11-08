package expo.modules.forumcontentselection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.text.style.ReplacementSpan
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import expo.modules.core.ModuleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

internal class FixedReplacementSpan(private val width: Int) : ReplacementSpan() {
  override fun getSize(
    paint: Paint,
    text: CharSequence,
    start: Int,
    end: Int,
    fontMetrics: Paint.FontMetricsInt?
  ): Int = width

  override fun draw(
    canvas: Canvas,
    text: CharSequence,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint
  ) = Unit
}

internal fun textToken(text: String, trailing: String): String {
  val trailingSegments = JSONArray()
  if (trailing.isNotEmpty()) {
    trailingSegments.put(JSONObject().put("kind", "separator").put("text", trailing))
  }
  return JSONObject()
    .put("version", 1)
    .put("prefix", JSONArray())
    .put(
      "owners",
      JSONArray().put(
        JSONObject()
          .put("text", text)
          .put("tape", JSONArray())
          .put("trailing", trailingSegments)
      )
    )
    .toString()
}

internal class SelectionTestReactContext(context: Context) : ReactApplicationContext(context) {
  override fun <T : JavaScriptModule> getJSModule(jsInterface: Class<T>): T? = null

  override fun <T : NativeModule> hasNativeModule(nativeModuleInterface: Class<T>): Boolean = false

  override fun getNativeModules(): Collection<NativeModule> = emptyList()

  override fun <T : NativeModule> getNativeModule(nativeModuleInterface: Class<T>): T? = null

  override fun getNativeModule(moduleName: String): NativeModule? = null

  @Suppress("DEPRECATION")
  override fun getCatalystInstance(): com.facebook.react.bridge.CatalystInstance? = null

  @Deprecated("Required by ReactContext; use hasActiveReactInstance in production code.")
  override fun hasActiveCatalystInstance(): Boolean = false

  override fun hasActiveReactInstance(): Boolean = false

  @Deprecated("Required by ReactContext; use hasReactInstance in production code.")
  override fun hasCatalystInstance(): Boolean = false

  override fun hasReactInstance(): Boolean = false

  override fun destroy() = Unit

  override fun handleException(exception: Exception) {
    throw exception
  }

  @Deprecated("Required by the ReactContext compatibility contract.")
  override fun isBridgeless(): Boolean = false

  override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = null

  override fun getJSCallInvokerHolder(): CallInvokerHolder? = null

  @Deprecated("Required by the ReactContext compatibility contract.")
  override fun getFabricUIManager(): UIManager? = null

  override fun getSourceURL(): String? = null

  override fun registerSegment(segmentId: Int, path: String?, callback: Callback?) = Unit
}

internal fun selectionTestAppContext(reactContext: ReactApplicationContext) = AppContext(
  object : ModulesProvider {
    override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
  },
  ModuleRegistry(emptyList(), emptyList()),
  WeakReference(reactContext)
)
