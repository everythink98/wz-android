package com.wz.reader

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class DiagnosticsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "DiagnosticsModule"
  override fun getConstants(): Map<String, Any> = DiagnosticJournal.context()

  @ReactMethod
  fun appendBatch(lines: String, promise: Promise) {
    try { DiagnosticJournal.appendJs(lines); promise.resolve(null) }
    catch (_: Exception) { promise.reject("diagnostic_write_failed", "Diagnostic storage unavailable") }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun persistCrashSync(lines: String): Boolean = DiagnosticJournal.persistJsCrash(lines)

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun recordStartupPhase(phase: String): Boolean = DiagnosticJournal.recordStartupPhase(phase)

  @ReactMethod
  fun snapshot(promise: Promise) {
    try { DiagnosticJournal.snapshot { promise.resolve(Arguments.makeNativeMap(it)) } }
    catch (_: Exception) { promise.reject("diagnostic_read_failed", "Diagnostic storage unavailable") }
  }
}

class DiagnosticsPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == "DiagnosticsModule") DiagnosticsModule(reactContext) else null
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf("DiagnosticsModule" to ReactModuleInfo("DiagnosticsModule", DiagnosticsModule::class.java.name, false, false, false, false))
  }
}
