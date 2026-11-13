#include <jni.h>
#include <hermes/hermes.h>
#include <react/renderer/bridging/bridging.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/core/ShadowNodeFragment.h>
#include <react/utils/ContextContainer.h>
#include <reanimated/Fabric/updates/AnimatedPropsRegistry.h>
#include <reanimated/Fabric/updates/UpdatesRegistryManager.h>
#include <reanimated/Tools/FeatureFlags.h>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

extern "C" JNIEXPORT jstring JNICALL
Java_com_wz_reader_RegistrySettlementProof_run(JNIEnv *env, jclass) {
  try {
    using namespace facebook;
    using namespace facebook::react;
    auto require = [](bool ok, const char *caseName) {
      if (!ok) throw std::runtime_error(caseName); // Release defines NDEBUG: never use assert().
    };
    auto context = std::make_shared<const ContextContainer>();
    ViewComponentDescriptor descriptor({.eventDispatcher = {}, .contextContainer = context, .flavor = nullptr});
    auto runtime = facebook::hermes::makeHermesRuntime();
    auto &rt = *runtime;
    auto node = [&](Tag tag) -> std::shared_ptr<const ShadowNode> {
      auto family = descriptor.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr});
      Props::Shared props = ViewShadowNode::defaultSharedProps();
      return descriptor.createShadowNode(ShadowNodeFragment{.props = props}, family);
    };
    auto a = node(41), b = node(42);
    auto staticProps = std::make_shared<reanimated::css::StaticPropsRegistry>();
    reanimated::UpdatesRegistryManager manager(staticProps);
    require(reanimated::StaticFeatureFlags::getFlag("FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS") &&
      !reanimated::StaticFeatureFlags::getFlag("USE_ANIMATION_BACKEND"), "CASE_REQUIRED_STATIC_FLAGS");
    reanimated::AnimatedPropsRegistry registry;
    const auto lock = manager.lock(); // Real manager mutex/TLS, no stub lock implementation.
    auto update = [&](const std::shared_ptr<const ShadowNode> &n, double at, double opacity) {
      jsi::Array operations(rt, 1);
      jsi::Object entry(rt), props(rt);
      entry.setProperty(rt, "shadowNodeWrapper", Bridging<std::shared_ptr<const ShadowNode>>::toJs(rt, n));
      props.setProperty(rt, "opacity", opacity);
      entry.setProperty(rt, "updates", std::move(props));
      operations.setValueAtIndex(rt, 0, std::move(entry));
      registry.update(rt, jsi::Value(std::move(operations)), at);
    };
    auto flush = [&] { reanimated::UpdatesBatch batch; registry.flushUpdates(batch); };
    auto collect = [&](double cutoff) { return registry.collectSettledUpdates(rt, cutoff).asObject(rt).asArray(rt); };
    auto empty = [&](double cutoff, const char *name) { require(collect(cutoff).size(rt) == 0, name); };
    auto one = [&](double cutoff, Tag tag, double opacity, const char *name) {
      auto rows = collect(cutoff);
      require(rows.size(rt) == 1, name);
      auto row = rows.getValueAtIndex(rt, 0).asObject(rt);
      require(row.getProperty(rt, "viewTag").asNumber() == tag, name);
      require(std::abs(row.getProperty(rt, "styleProps").asObject(rt).getProperty(rt, "opacity").asNumber() - opacity) < 1e-9, name);
    };
    empty(0, "CASE_INITIAL_EMPTY");
    update(a, 10, .1);
    empty(11, "CASE_PENDING_NOT_FLUSHED");
    flush();
    empty(10, "CASE_STRICT_THRESHOLD");
    one(11, 41, .1, "CASE_SETTLED_FIRST_SYNC");
    empty(12, "CASE_SYNCED_EVICTED");
    require(registry.isEmpty(), "CASE_SYNCED_EVICTED_STORAGE");
    update(a, 100, .2);
    empty(20, "CASE_INVALIDATION_WAITING_FOR_FLUSH");
    flush();
    one(20, 41, .2, "CASE_REANIMATE_AFTER_EVICTION");
    empty(20, "CASE_INVALIDATION_CONSUMED_ONCE");
    update(a, 101, .3);
    flush();
    empty(20, "CASE_ACTIVE_UPDATE_NOT_RESYNCED_EVERY_TICK");
    one(102, 41, .3, "CASE_LATEST_VALUE_SETTLES");
    empty(103, "CASE_SECOND_EVICTION");
    registry.remove(41);
    update(a, 200, .4);
    flush();
    empty(20, "CASE_REMOVE_CLEARS_REANIMATION_HISTORY");
    registry.remove(41);
    update(a, 10, .5);
    update(b, 100, .6);
    flush();
    one(20, 41, .5, "CASE_TAGS_INDEPENDENT");
    empty(20, "CASE_ONLY_SYNCED_TAG_EVICTED");
    require(registry.get(41).isNull() && registry.get(42)["opacity"].asDouble() == .6, "CASE_OTHER_TAG_RETAINED");
    registry.remove(42);
    require(registry.isEmpty(), "CASE_REMOVE_PROP_ENTRY");
    registry.remove(41);
    // Existing prefix when old props have not yet been evicted: collection can
    // consume invalidation with those old props before the new batch flushes.
    update(a, 10, .7);
    flush();
    one(11, 41, .7, "CASE_BEFORE_FLUSH_INITIAL_SYNC");
    update(a, 100, .8);
    one(20, 41, .7, "CASE_BEFORE_FLUSH_RETURNS_EXISTING_PROPS");
    empty(20, "CASE_BEFORE_FLUSH_INVALIDATION_CONSUMED");
    flush();
    empty(20, "CASE_LATER_FLUSH_REMAINS_ANIMATING");
    one(101, 41, .8, "CASE_LATER_FLUSH_SETTLES_LATEST");
    empty(102, "CASE_BEFORE_FLUSH_LATER_EVICTION");
    registry.remove(41);
    // remove clears registry/settlement, not the inherited unflushed batch.
    update(a, 300, .4);
    registry.remove(41);
    flush();
    empty(400, "CASE_UNFLUSHED_REMOVE_HAS_NO_SETTLEMENT_RECORD");
    require(registry.get(41)["opacity"].asDouble() == .4, "CASE_UNFLUSHED_BATCH_PAYLOAD_RETAINED");
    registry.remove(41);
    update(a, 10, .9);
    flush();
    one(11, 41, .9, "CASE_GETTER_THROW_INITIAL_SYNC");
    empty(12, "CASE_GETTER_THROW_POST_EVICTION");
    jsi::Object badProps = rt.evaluateJavaScript(std::make_unique<jsi::StringBuffer>(
      "({get opacity(){throw new Error('EXPECTED_REGISTRY_GETTER_THROW')}})"), "registry-proof.js").asObject(rt);
    jsi::Array badOperations(rt, 1);
    jsi::Object badEntry(rt);
    badEntry.setProperty(rt, "shadowNodeWrapper", Bridging<std::shared_ptr<const ShadowNode>>::toJs(rt, a));
    badEntry.setProperty(rt, "updates", std::move(badProps));
    badOperations.setValueAtIndex(rt, 0, std::move(badEntry));
    bool getterThrew = false;
    try { registry.update(rt, jsi::Value(std::move(badOperations)), 400); }
    catch (const jsi::JSError &error) { getterThrew = std::string(error.what()).find("EXPECTED_REGISTRY_GETTER_THROW") != std::string::npos; }
    require(getterThrew, "CASE_REAL_HERMES_GETTER_THROW");
    flush();
    empty(401, "CASE_THROW_DID_NOT_PUBLISH_PROPS");
    require(registry.isEmpty(), "CASE_THROW_DID_NOT_CREATE_PROP_ENTRY");
    update(a, 500, .6);
    flush();
    one(20, 41, .6, "CASE_THROW_PRESERVED_POST_EVICTION_SYNC_HISTORY");
    registry.remove(41);
    update(a, 10, .1);
    flush();
    one(11, 41, .1, "CASE_COMBINED_INITIAL_SYNC");
    empty(12, "CASE_COMBINED_INITIAL_EVICTION");
    update(a, 100, .2);
    flush();
    one(101, 41, .2, "CASE_INVALIDATED_AND_SETTLED_SYNC");
    empty(102, "CASE_COMBINED_SYNC_EVICTS");
    require(registry.isEmpty(), "CASE_COMBINED_SYNC_EVICTS_STORAGE");
    update(a, 200, .3);
    flush();
    one(20, 41, .3, "CASE_COMBINED_SYNC_RETAINS_REANIMATION_HISTORY");
    return env->NewStringUTF("REGISTRY_SETTLEMENT_NATIVE_PASS");
  } catch (const std::exception &error) {
    if (env->ExceptionCheck()) return nullptr;
    auto errorClass = env->FindClass("java/lang/AssertionError");
    if (env->ExceptionCheck()) return nullptr;
    auto constructor = env->GetMethodID(errorClass, "<init>", "(Ljava/lang/Object;)V");
    if (env->ExceptionCheck()) return nullptr;
    auto message = env->NewStringUTF(error.what());
    if (!message) return nullptr;
    auto failure = static_cast<jthrowable>(env->NewObject(errorClass, constructor, message));
    if (failure) env->Throw(failure);
    return nullptr;
  }
}
