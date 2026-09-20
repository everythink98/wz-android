# 维护手册

本手册只维护可执行操作。产品契约、能力 ID 和共享 seam 见 [产品地图](product-map.md)，历史 oracle 见 [回归语料库](regression-corpus.md)，证据层与授权规则见 [测试标准](testing-standard.md)，代码边界见 [代码规范](code-standards.md) 与 [架构说明](architecture.md)。当前版本始终从 `package.json` 和 `app.json` 读取。

## 阅读导航

- 本地开发：[标准命令](#标准命令)、[依赖补丁](#依赖补丁可安装性)、[可视状态](#可视状态语料库)。
- 设备验证：[覆盖安装](#覆盖安装)、[Replay](#replay)、[首页手势](#首页手势完整回归)、[Release 性能](#release-性能回归)。
- 真实来源：[Agent Live](#agent-live)、[直达主题](#直接打开主题链接)。
- 交付收口：[正式发布](#正式发布)、[工具进程](#工具进程收口)。

## 开发与交付

1. 产品/runtime 改动在产品地图选择直接影响的能力 ID 并展开共享 seam；纯测试、文档或治理改动记录 evidence owner。
2. 只有改动命中已知事故 seam 时才查回归语料库；当前必跑项以 product map 的 canonical evidence 与测试标准为准。
3. 记录 Git revision 与 dirty 状态，完成最小完整改动。
4. 按测试标准运行最低可靠证据；涉及设备、真实来源或写操作时遵守相应授权边界。
5. 交付时按能力 ID 或 evidence owner 报告证据层、恢复状态和未验证范围。

## 标准命令

命令定义以 `package.json` 为准。首次开发使用 Node 22（`>=22.22.2 <23`），执行 `npm ci` 安装 lockfile 中的依赖；postinstall 会应用 source patch 并构建 Composer。启动 Android 前准备 SDK、Java 环境，并核对下文的安装身份。

Composer 专项使用 `npm run test:composer:device -- --serial emulator-5556 --build --output .codex-tmp/composer-<独立运行名>`。需先启动隔离 AVD `WZ_ComposerInsets_0916`，选择真实系统 IME，准备现有安装、Java/Android SDK/Windows C++ 工具链；runner 不自动创建、卸载、清数据或重置设备。它仅构建开发签名 Release Hermes 诊断入口，不走正式发布。复用时把 `--build` 换为 `--apk <composer-proof.apk>`，须同时保留紧邻的 `<APK>.json` 身份文件；`--cases <逗号分隔的场景 ID>` 可定向，例如 `nodeseek-rich-sheet-shown,nodeseek-rich-fullscreen-shown`。输出目录必须全新且位于 `.codex-tmp`，包含环境、每场景 token/receipt、原生节点和截图、结果清单。

专项只接受当前源码与 APK 哈希、buildId 匹配且 `isDev=false/isHermes=true` 的包；先比对已装 APK 签名，再覆盖安装并复核 `firstInstallTime`。默认 40 场景矩阵定义在 `scripts/run-composer-device-proof.mjs`，含两站 16 种编辑模式/面板/键盘组合、各独立写入口、失败保稿/重开、深浅全屏及竞态/选图取消。`stress-ime-fast/slow` 在隔离设备分别使用 0/5 倍 window animation scale，记录并最终恢复原值；这些压力条件不代替原生 IME 帧顺序单测。所有发送使用合成账号与 HTTP/adapter 响应，未匹配请求立即失败；不得将这些结果标为 `LIVE_PASS`。较大挖孔须在同一隔离 AVD 单独切换系统 cutout overlay、记录实际 Insets，并添加 `--require-cutout` 重跑深浅全屏，最后恢复原 overlay；overlay 已启用不等于生效，cutout Insets 仍为 0 时必须失败，工具栏按状态栏与 cutout 的较大值验收。可参考 [Android 官方挖孔测试说明](https://developer.android.com/develop/ui/compose/system/test-cutouts)。真实物理设备没有对应证据时仍为 `NOT_VERIFIED`。结束后 runner 释放自己的 agent-device session 并恢复 IME/动画设置；操作者只关闭本次启动的隔离模拟器。

| 任务 | 命令与前置条件 |
| --- | --- |
| 日常开发 | `npm run android` 编译并安装 development build；已安装匹配构建时用 `npm start` 启动 Metro。 |
| 完整自动检查 | `npm run verify`；组合以 package scripts 为准。 |
| 定向逻辑 / UI | `npm test`、`npm run test:ui`；按测试标准选择文件。 |
| 文档整理 | `npm run test:docs`、`npm run check:docs`、`git diff --check`。 |
| 类型 / 架构 | `npm run typecheck`、`npm run check:architecture`、`npm run test:architecture`。 |
| React 检查 | `npm run check:react`。 |
| 可视状态 | `npm run visual:gallery`；见下文开发入口。 |
| 主设备 / 未登录 Replay | `npm run test:device`、`npm run test:device:logged-out`；使用各自匹配设备。 |
| 正文选择 Native | `npm run test:native:forum-selection`；独立 AVD 具备条件后才运行 `npm run test:instrumented:forum-selection`。 |
| 覆盖安装与启动检查 | `npm run smoke:android`；先完成下文安装身份检查。 |
| 正式发布 | 仅在当次明确授权后，按[正式发布](#正式发布)执行。 |

Vitest 与 Jest 的默认随机顺序及 seed 重放规则见[测试标准](testing-standard.md#四随机顺序与可重放性)。局部开发先运行受影响测试，交付前按改动风险补齐门禁。

Composer 原生键盘补丁的定向回归使用实际 Reanimated Kotlin 类与 Robolectric Android 35：`android/gradlew.bat -p android :app:testReleaseUnitTest --tests com.wz.reader.ComposerKeyboardTest --tests com.wz.reader.ComposerWebViewInsetsTest -I ../tests/native/composer-keyboard.gradle -PreactNativeArchitectures=x86_64 --no-daemon`。该 init script 仅为测试增加 source set 与 JVM Android 环境，不改变产品 APK；没有安装或清理设备状态。之后仍须用匹配 APK 验证系统选图器返回和键盘连续开合，并记录 `adb shell dumpsys webviewupdate` 的实际 provider/version。WebView 124 的通过不能代替 139+ 的 IME visual viewport 行为；录屏要分别检查原生标题、HTML 工具栏、正文、底部发送栏。

直接调用 Gradle 构建开发/测试 APK 前先执行 `npm run build:composer`。生成的 `src/ui/composer/generated/editorDocument.js` 为懒加载 CommonJS 模块，保持在 ignored 生成目录中；其 JS 文件后缀使 Gradle `BundleHermesCTask` 能追踪编辑器载荷变化。修改编辑器后必须核对 APK 内实际载荷，不能把单测通过或 Gradle `UP-TO-DATE` 当成包内代码已更新。

### 依赖补丁可安装性

普通 `npm run verify` 会在已执行 postinstall 的依赖树上，对全部 `patches/*.patch` 做真实 reverse-apply dry check。修改补丁时还要从未打补丁的干净依赖证明 forward apply，再执行真实 postinstall：

```powershell
npm ci --ignore-scripts
Get-ChildItem -LiteralPath patches -Filter '*.patch' | ForEach-Object { git apply --check --unsafe-paths -- $_.FullName }
npm run postinstall
npx vitest run tests/tooling/patch-artifacts.test.ts
```

任一 patch forward/reverse check 或 postinstall 失败都必须停止；不得用 patch 文本搜索、snapshot 或手写 context 代替可安装性证据。

### 可视状态语料库

使用当前 debug/dev-client 构建启动独立视觉入口：

```powershell
npm run visual:gallery -- --port 8081
```

启动后用输出的 Development client URL 打开 Visual Gallery。该命令不安装 APK；需要覆盖安装时先按下文校验包名、签名、版本和 `firstInstallTime`。Gallery 只挂生产组件与确定性 mock，JS 网络默认阻断；它可用于搜索能力、切换场景、浅/深主题、字号和密度，但不授权真实写操作，也不能代替真实来源、系统 UI、原生手势或生命周期的 Replay/Live 证据。

交付前运行 `npm run test:architecture` 和视觉 catalog 测试，确认全部 App capability 已分类、场景可双主题挂载，并且生产入口不含视觉工具。截图和人工走查报告只写入任务专用的 ignored evidence 目录，不提交账号、凭据、日志或真实内容。

## Android 覆盖安装、Replay 与 Smoke

关联 Native 变更可在 fresh prebuild 后运行 `node scripts/run-related-native-tests.mjs`；本地读取相对 HEAD 的修改与未跟踪文件，CI 使用 `--base <revision>`。静态任务表覆盖 forum-platform、selection、App、ReactAndroid、Expo FileSystem 和 Expo Image 六类 JVM owner；App 通过 `tests/native/composer-keyboard.gradle` 挂入 Composer 测试。每个预期测试类必须有本次新鲜报告、非跳过用例且零失败/错误；邻近测试通过不能替代缺席 owner。runner 输出每项耗时；selection 不能只编译 App。CI 使用 Node `22.22.2` 验证最低支持版本。配置/补丁合同继续保留，instrumentation 按下文独立 AVD 规则执行。本次修复及证据边界见[取证记录](review-remediation.md)。

主登录态 AVD 保存 App 数据、WebView Cookie、SecureStore 与 Quick Boot 状态。设备安全边界以仓库根目录 `AGENTS.md` 为准；下面只列操作入口。

### 诊断导出与崩溃还原

用户设备上的事后排障先使用“更多 → 问题诊断”导出，不靠重现故障或结束进程取代已有证据。新 Android journal 在私有非备份目录保存 JS/Native 各四份 2 MiB、最长七天和独立最多 256 KiB 最近崩溃文件；旧两份 1 MiB cache 仍参与导出。高流量会提前轮转，操作系统强杀前的异步队列可能未写盘，不能承诺七天完整记录。

先读导出的 `diagnostic-metadata` 与 `diagnostic-coverage`：核对 buildId、versionCode、事件时间范围、journal/writer 状态和丢弃/损坏/读写失败计数；`sources` 分别声明 JS、Native、crash、两份旧 cache 和旧 Native ring 的状态、事件数、损坏行及首尾时间，没有事件时不凭空补时间。Native 的 JS/Native 分段健康计数跨进程保存，`expiredSegmentCount` 区分保留期淘汰，`crashReadFailureCount` 区分最近崩溃文件读取失败。再按事件自身 buildId/processSessionId 分组；普通请求用 `appSessionId + traceId + requestId` 串联 JS transport、Native DNS/connect/response 和 fallback，恢复事件用 `parentTraceId/requestId` 追溯证据与阈值，不能只看最后一次 `rotate-read-runtime`。`previous-exit` 只说明 Android 为对应前一进程提供的退出原因；无记录不证明没有崩溃，ANR/native-crash 原因不等于已有完整堆栈。

JS 同时只有一个 Native batch 在写，其余事件合并等待，在写与待写合计最多 128 KiB；单次写超时只记录健康错误，底层调用实际结算前不提交下一批，不能用超时释放并发占位。导出等待写队列最多五秒，超时仍尝试收集可用证据。致命异常摘要包含尚未批量落盘的最后 JS 阶段，Native 致命处理还会最多等待 250ms 刷出已排队事件，然后继续原异常处理；这个有界等待不能覆盖操作系统直接结束进程或磁盘不可写。

异常入口按真实 RN 管线判断，不能只看是否存在 `RN$registerExceptionListener`：当 `RN$useAlwaysAvailableJSErrorHandling` 不为 true 时，已就绪的 JS/renderer 异常仍走 legacy 入口。当前保留 Native listener，同时包装 `ExceptionsManager.handleException`（不可用才用 ErrorUtils），完整委托并去重。系统 `ApplicationExitInfo` 的 EXCESSIVE_RESOURCE_USAGE 记录为 `resource-limit`，保留 `exitReasonCode`；即使同一进程已有 JS 致命异常，也不把该退出原因猜成 crash。

鸿蒙详情触摸专项探针已在真机复测通过后撤除；不再采集逐次触摸、视图路径或每秒心跳。常规脱敏请求、Cookie 存在性、验证恢复与错误日志沿用现有有界 journal。历史专项日志按其原 buildId 使用已归档符号，不用新包覆盖旧符号；事故结论见 `REG-TOPIC-172`。

发布脚本把 exact combined source map、R8 mapping 和 APK SHA 归档到 ignored `diagnostic-symbols/<buildId>/`。保留对应目录，不用重建产物覆盖。JS、renderer、Promise 与 Java/Kotlin 未捕获异常统一使用以下脱敏堆栈还原命令：

```powershell
node scripts/symbolicate-diagnostic.mjs --log <导出的日志文件> --symbols diagnostic-symbols/<buildId>
```

工具自动处理 `js-error`、`unhandled-rejection` 与 `native-crash`。混合进程/版本日志无需预先切分，只还原符号目录 buildId 对应的事件，其余（含缺少合法 buildId）跳过，并在 stderr 输出 `symbolicated/skipped/skippedBuilds` JSON 计数；需要其他版本时更换对应符号目录再次执行。JS 校验 source map SHA，按 `stackFormat` 区分 RN 已解析坐标、Hermes bytecode offset 和普通 source column；Native 校验 mapping SHA 后使用 SDK 官方 Retrace 还原类名、源码行和内联帧。Retrace 自动从 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或 PATH 中的 SDK cmdline-tools 查找，要求 Java 17+；也可显式添加 `--retrace-jar <R8 jar>`。没有匹配符号或 Retrace 不可用时保留原始脱敏坐标并记 `NOT_VERIFIED`，不得把跳过数量当作还原成功。

验证存储/异常链时先运行 `diagnostics`、`diagnosticRuntime`、`diagnosticFileStore` 与 `diagnostic-symbols` 对应单测；fresh prebuild 后编译模块内的 `DiagnosticLogStoreTest` 和 `NetworkProxyRuntimeTest` 使用实际文件/OkHttp 验证存储与出网标记。真实故障 proof 仅在唯一已连接的 `WZ_ImageRuntime_Test_API35` 执行，前置匹配 fresh prebuild 产物与构建身份文件，且 App 进程已退出：

```powershell
node scripts/run-diagnostic-device-proof.mjs
```

runner 拒绝参数，不接受手工 serial 或其他 AVD。它临时使用开发签名的 Release Hermes entry，保留发布配置的 R8/minify 与 resource shrink；Gradle overlay 为本次 proof 分配独立随机 buildId，与恢复后的正常入口 APK 身份隔离，并按该 ID 归档本次 APK 的实际 combined source map、R8 mapping 和校验值。依次验证 JS/renderer/Promise/Native 故障、重启后的原进程与 build 归属、脱敏、退出原因、JS source map 与 Java SDK Retrace 还原；最后重新构建正常入口并仅覆盖恢复该隔离 AVD。它不创建或重置 AVD，身份异常立即冻结设备变更。stdout 只报告进度与结果路径；`.codex-tmp/diagnostic-device-proof-report-<UUID>.json` 保存 APK/符号校验值、场景、符号化结果和恢复状态，只有四场景及恢复覆盖安装全部完成才为 `PASS`。失败保留已取得的部分证据；未运行不能沿用 tooling 单测或先前未混淆 proof 的通过状态，缺少隔离 AVD 记 `BLOCKED_BY_ENV`。不得在保留登录态设备注入异常，正式签名 APK、真实 ANR/OOM 与系统分享 UI 仍分别验收。

proof 的 JS/renderer 分支要求异常记录、旧进程归属和系统退出记录均存在，但保留任一有效系统退出原因作为实际证据，不要求它一定叫 crash；Java 未捕获异常仍要求 `crash`。普通 Error 的 Hermes Promise tracker 有两秒原生宽限，proof 等待三秒取得 rejection 记录后才主动结束进程，因此该分支要求 `user-stopped`，不能把主动结束当作 Promise 导致崩溃。

四场景还必须核对故障前未 finish 的 startup intent/apply 在重启后仍存在，JS 事件属于原 appSessionId，且同一异常从 JS journal、Native journal 与 crash 合并去重后恰好一份；不能只验证最后的异常行。Java 结果必须由该 proof APK 的真实 mapping 经 SDK Retrace 还原，未混淆 Java 栈加独立 Retrace fixture 不代替这条设备证据。

### 图片运行时 Native 验证

排查图片失败时导出“更多 → 问题诊断”的现有日志。按 `appSessionId + traceId` 关联 JS `image-load` 与 Native request，以 `mediaRef` 找同图的后续重试；多个原生请求再以 `callId` 区分。`imageConsumer=svg-probe` 表示显示失败后的兼容探测，其 200 不能证明 Fresco/Glide 成功。JS `finish/success` 表示显示，`imageFailure` 为闭集错误分类，`unknown` 表示现有原生回调没有足够信息；Native `response-headers`、`response-body-end`、`image-call-failed` 和 `image-lease-released` 分别表示响应头、读取、失败与资源释放。缓存命中可能只有 JS 显示终态，没有网络 Call；不凭缺少 Call 单独断言缓存命中。Native 事件已进入跨进程 journal，512 条 ring 仅为旧桥接兼容窗口；先按上节 coverage 判断可用时间范围。

fresh prebuild 后，用 `android/gradlew.bat -p android :forum-platform:testDebugUnitTest --tests '*NetworkProxyRuntimeTest' --no-daemon` 执行模块内网络 canonical owner；RN 注入 wiring 使用 `:react-native:packages:react-native:ReactAndroid:testDebugUnitTest --tests '*ReactOkHttpNetworkFetcherTest'`。两份 XML 报告都必须包含非零用例。

HTTP/2 故障子集可用 `--tests '*NetworkProxyRuntimeTest.*Http2*'`。共享 `modules/forum-platform/android/src/testShared/java/com/wz/reader/network/Http2ImageFaultFixture.kt` 使用与实际 OkHttp 4.12.0 对齐的 test-only MockWebServer/TLS、loopback TCP relay 和可关闭的阻塞写 socket；不修改公网、系统网络或用户代理。报告中的 `HTTP2_RECOVERY/RESET/PROGRESS/OFFLINE` 记录实际建连数、请求数、耗时与终态；并发建连可能产生被 OkHttp 丢弃的候选，必须同时断言最终取得的连接身份和旧 runtime 释放。慢响应保留正常 PONG，连续响应体实际传输超过 30 秒。设备 `HTTP2_IMAGES` 必须由已初始化的 Fresco/Glide 实际解码并显示，HTTP 200 不能代替它。原生诊断新增 `request-headers-start/end`、`request-failed`、`connection-write-stalled`，只含脱敏连接标识和阶段。

设备链路先启动独立 `WZ_ImageRuntime_Test_API35`，执行 `node scripts/run-network-image-instrumented-tests.mjs`。runner 精确匹配该 AVD，以开发签名 Release 同时运行 `ManagedCookieResponsesInstrumentedTest` 的合成 HTTP 轮换、平台 Cookie 属性/定向过期验证，以及真实 RN/Fresco 初始化验证图片、Glide 两种 model、缓存、回收、取消、连续轮换及 SVG。仅该测试构建允许 `127.0.0.1/localhost` HTTP，其他地址仍禁止明文流量；测试后的 finally 移除临时 manifest/resources 并重新构建默认 Release，测试 APK 不用于保留数据设备验收。runner 不创建、清理或重置 AVD；保留数据设备仍按安装身份核对与只读 Live 流程单独验收。

`--svg-only` 只运行真实静态海报队列和动态 SVG，不重复 Cookie 重启分段；默认命令仍运行全部网络、Cookie 和 SVG owner。使用 `--help` 查看互斥选项，帮助命令不连接设备。每次 proof 独立分配 buildId，不能与正常构建共用身份。

### 备份、诊断分享与图片保存验证

同一隔离 AVD 上执行 `node scripts/run-network-image-instrumented-tests.mjs --platform-exports`，运行大文件流式下载和系统文件联合 owner；只重放系统保存、延迟接收和相册流程使用 `--platform-export-ui`。runner 恢复本次临时图片权限，owner 只删除本次创建的 provider、相册、诊断和缓存文件。

`node scripts/run-network-image-instrumented-tests.mjs --platform-file-faults` 只运行四项文件故障 owner：备份部分写入后的 EIO/ENOSPC、图片 ENOSPC 与已存在临时文件清理、可靠 descriptor 已报告的关闭错误，以及真实备份桥失败后释放操作锁。沿用 `WZ_ImageRuntime_Test_API35` 隔离检查、开发签名 Release proof 入口和安装身份检查；仅允许 `127.0.0.1` 明文，不授予 `READ_MEDIA_IMAGES`。故障 provider 只打包进测试 APK，校验调用方 UID 与签名；这些用例验证受控 provider 的真实 Android errno/错误协议传播，不代表实际 Android 分区耗尽。关闭检查只处理本地关闭前已经到达的远端错误，不等待或证明云端同步完成；失败不删除外部 provider 文档。

使用隔离测试安装验证系统文件和相册操作，不能把 provider 或原生单测当成真实交付证据。备份由系统保存文件对话框选择目标，固定 JSON MIME；逐项验证取消、Unicode/重名、接近 5 MiB 备份及读回重导入。provider 的打开、写入、flush/close 失败必须报失败；Activity 重建和重复发起不能交错两份 JSON，失败不删除外部文档。保存成功仅表示 provider 已接受并关闭。

诊断分享由延迟接收方在 chooser 返回后读取并核对完整字节；分享调用后拒绝仍保留文件。启动与下次导出只清理超过 24 小时的本功能文件，验证 32 份/128 MiB 满额拒绝，以及调用前失败清理。诊断存储的七天轮转和导出副本的 24 小时保留属于不同边界。

图片在受控 HTTP 来源使用 1、25、100 MiB 样本，记录完整 hash、实际字节和 JS/Native 内存曲线；验证同一托管网络的 Cookie/Referrer/代理/重定向、取消、身份变化、截断响应和磁盘失败。目标是消除 JS 全量二进制/Base64 副本，不能以普通 HTTP 成功或小图保存替代大图内存证据。相册写入完成后再核对本次临时文件清理。原生单元 owner 位于 `modules/forum-platform/android/src/test/java/com/wz/reader/storage/BackupExportTest.kt` 和 `modules/forum-platform/android/src/test/java/com/wz/reader/media/ImageDownloadTest.kt`，由 `:forum-platform:testDebugUnitTest` 执行。

### L 站续签与登录态诊断

沿用上面的隔离 runner；它分两个 instrumentation 进程执行持久型 Cookie 续签并 flush、停止进程、重启后真实 HTTP 认证，断言 PID 改变，并检查原 Native journal 的原因字段仍在且敏感字段已过滤。同一 runner 还分别驱动安装依赖的真实 WebView 正常完成、网络错误和加载提前取消，在独立进程重启后回读平台 Cookie；React 消息传输使用替身，平台 Cookie 与 HTTP 不替换。销毁入口的 flush 由既有 RN WebView patch 提供，不能把该原生探针算作 L 站成功登录或整个 React Host 的端到端验收。会话型 Cookie 只按 Android 实际语义观察，不能把内存接受当作重启持久化证据。多个 Domain/Path 的同名 Cookie、Secure/HttpOnly 与定向删除由同一个平台 owner 验证。

导出先看 `diagnostic-account-summary`：`localSnapshot` 是本地身份，`lastCheckResult/lastCheckAt/checkedInCurrentProcess` 才说明日志中的最近核对。按请求 trace/request/call 与账号隔离 epoch 关联 `cookie-request`（实际发送的登录 Cookie 是否存在）、`cookie-response`（类别、设置/删除/未知、平台逐项接受）、`cookie-persist`（persisted/flush_failed）和 `cookie-barrier`（闭集原因与开启/释放）。`settled/accepted` 不等于已落盘，`flush_failed` 不等于已清除。source_denied、redirect_denied、barrier_blocked、epoch_changed、callback_timeout、pending_write 和平台 rejected 各自处理；旧日志 canceled 表示旧版本丢弃已收到的响应，新版本消费者取消不再丢弃合格 Cookie 更新，旧日志 stale/baseline_changed 只作旧语义读取。`site-config` 单独标识 `/site.json`；`loginCookieCount/storedLoginCookieCount/isLoginCookieCurrent` 仅比较实际发送 Header 与当时准确 URL 的存储，缺字段表示未知；并发写入可能造成比较不一致，不能单凭 false 定性旧凭据。WebView 内部响应不可见；只记录可信页面交接和前后凭据存在、最终协议结果，不推测内部 Set-Cookie。

现场只在按安装身份步骤覆盖安装正常开发包后，用现有登录态进行只读浏览，等至少两次自然登录 Cookie 更新并看到落盘确认，再按保留数据方式结束/重启 App，核对 `/session/current.json` 与账号结果。不得清 Cookie、自动登录或重放写操作来制造条件。无真实登录或观察窗口内没有自然续签记 `NOT_VERIFIED`，缺隔离设备记 `BLOCKED_BY_ENV`。若服务端明确删除，继续追溯此前是否有客户端漏续签；不能只因 stale 消失就关闭 `REG-ACCOUNT-048`。

### 下拉刷新 Native 验证

取消、迟到 UP/nested-scroll stop、取消后的再次刷新与进行中刷新保留，使用真实 AndroidX 控件的 JVM 测试，不连接设备。测试同时覆盖控件直接持有触摸，以及内部 ScrollView 持有触摸时的完整 dispatch 路径；推进动画后确认取消不产生迟到刷新回调：

```powershell
cd android
.\gradlew.bat :react-native:packages:react-native:ReactAndroid:testDebugUnitTest --tests com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayoutTest --no-daemon
```

报告位于 `node_modules/react-native/ReactAndroid/build/test-results/testDebugUnitTest/`，必须有非零测试。匹配 APK 另验轻拉松手、长拉到底、回拉后松手、系统 CANCEL 后再次拉动与来源横滑；共享通知列表单独验证取消及下一次正常刷新，不打开未读项或执行已读操作。不得用 JS 装配测试替代 Native 手势证据。

### 行内附件 Native 验证

行内附件的 Android 尺寸换算可独立验证，不连接设备：

```powershell
cd android
.\gradlew.bat :react-native:packages:react-native:ReactAndroid:testDebugUnitTest --tests com.facebook.react.views.text.TextLayoutManagerInlineViewSizeTest --tests com.facebook.react.views.text.internal.span.CustomLineHeightSpanTest --no-daemon
```

真实 Fabric 换行另用独立开发入口 `dev/inline-layout-proof/index.tsx`。在已有 Metro 的端口上，用 development-client URL 打开 `http://127.0.0.1:<port>/dev/inline-layout-proof/index.bundle?platform=android&dev=true&minify=false`。页面直接测量 Text 和嵌入 View；五个结果都必须为 PASS，大图相对行首偏移及右侧越界均不得超过 `1px`，小图继续留在文字后面。它不依赖 HTML、网络图片或生产账号，不以 RNTL mock 代替原生排版。

尺寸矩阵使用同一保留数据 AVD：`1264×2780 / 560dpi`、`1265×2780 / 560dpi` 和设备原参数，并覆盖 `font_scale=0.9/1.0`。修改前读取 `wm size`、`wm density`、`settings get system font_scale`，结束恢复；用户明确要求保留可见验收画面时，保留对应窗口、参数和必要调试服务并在交付中列明。原帖最终验收仍需匹配 APK、自然尺寸加载、滚离回收后返回和预览返回证据。

### 审查修复的隔离设备故障验证

先按 Reader SQLite 设备流程准备已有的 `WZ_ReaderStorage_API35_20260910`，确认其 fixture ownership marker。使用 Node 22（`>=22.22.2 <23`）、当前 lockfile 和已完成 fresh prebuild 的生成目录：

```powershell
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --build --output .codex-tmp/<任务目录>/runtime.json
```

runner 精确拒绝其他 AVD，包括主登录设备；仅覆盖安装开发签名的 Release Hermes proof APK，保留安装身份。临时 Gradle overlay 选择 `dev/review-remediation-proof/index.tsx`，不修改生产入口或持久原生配置。HTTP 使用已有四站样本和明确故障注入；WebView 使用禁远端资源的内联页面，禁止测试入口未经隔离的 fetch。通知测试临时撤销再授予该测试 App 的系统权限，finally 恢复原权限；只清理本轮合成摘要，恢复原通知存储键。

receipt 核对 token、Release/Hermes、44 项结果和 APK hash。覆盖真实 WebView 脚本、User Query 竞态、Feed 原生宿主、Account 恢复核心、发送前校验、通知存储与系统投递事务；通知质量包含失败、恢复后静默基线和重复分页的真实 Store/Android sink。Account 探针隔离了面板和身份核对边界，不代表 TopicRoute 到原站 Cloudflare 的完整验证；受控 HTTP 也不代表真实写操作。失败保留部分结果，不计为全通过。proof APK 不装主设备；普通入口另行构建并做匹配 APK 只读验收，正式发布不用于开发验证。

保持上述 proof APK 安装在同一隔离设备，执行 `node scripts/run-notification-background-device-proof.mjs --serial <隔离serial> --output .codex-tmp/<任务目录>/background.json`。runner 先建立数据库 checkpoint，再在系统 HOME 下通过 JobScheduler 显式触发真实 WorkManager；合成读取验证正常完成和原 50 秒超时。receipt 必须同时证明全程 background、同一 PID、业务终态和原生 headless finish。结束注销自己的 task、恢复通知权限与数据库；不得用该结果声称自然唤醒通过。

自然调度另行观察：记录原 job、最早执行时间、设备时钟、PID 和安装身份后退到 HOME，不强制执行 job、不改时钟、充电状态或调度约束。冷进程分支使用 `am kill` 结束已在后台的进程，不能使用 `force-stop`；确认 PID 消失、包仍 `stopped=false`、原 job 保留。通过需要同一次 JobScheduler 自然 START/STOP、新 PID 的 Expo headless 开始/结束，以及业务诊断终态；单独 `Ready=true` 或 WorkManager 成功不能代替。15 分钟是最小延迟，不是交付截止时间；记录实际观察区间，系统未派发时不归为业务失败，也不计通过。隔离 proof 仍须 checkpoint、恢复权限、注销自己的 task 并清理本轮进程。

Android 15 的文本 `dumpsys jobscheduler` 会在输出 Ready 时重新评估 controller 状态，不是严格无副作用的观察器。自然等待期间只观察 PID、日志和业务 receipt，任务终结后再取调度历史；不要跨最早执行时刻反复查询文本 job 状态。相关时序见 [AOSP TimeController](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/apex/jobscheduler/service/java/com/android/server/job/controllers/TimeController.java)。

冷进程复验必须使用实际启用 R8 的 Release Hermes proof，并归档 APK hash、构建身份和 mapping；普通 Native instrumentation 为方便宿主测试而关闭压缩的包不能替代。复用同一 owner：

```powershell
node scripts/run-notification-background-device-proof.mjs --serial <隔离serial> --cold --output .codex-tmp/<任务目录>/background-cold.json
node scripts/run-notification-background-device-proof.mjs --serial <隔离serial> --cold --natural --output .codex-tmp/<任务目录>/background-cold-natural.json
```

第一条仍显式触发 job，覆盖正常完成和原 50 秒 deadline；可用 `--mode success` 或 `--mode deadline` 定向重放。第二条只执行自然 success，最长观察 45 分钟；必须从本轮新登记且最小延迟尚未到的 job 开始，无进程阶段之后取得不同 PID 和 JS process session，并关联本轮业务、headless 与 WorkManager 完成。超出观察窗口只说明未取得通过证据，不能修改约束或用强制结果替代。

同一 runner 的 `--acceptance boundaries|recovery|notification` 用于 Pro 修复的专项验收，可复用上一步 APK，输出必须为新的 ignored 路径：

```powershell
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance boundaries --output .codex-tmp/<任务目录>/boundaries.json
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance recovery --output .codex-tmp/<任务目录>/recovery.json
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance notification --output .codex-tmp/<任务目录>/notification.json
```

`boundaries` 经生产 storage 导入并用独立 Android SQLite 连接核对三类集合 × 999/1000/1001 删除标记 × 三种时间关系的 27 个组合，最后还原原 fixture。`recovery` 挂载完整 App，在读取边界注入一次失败，使用真实系统文件选择器分别导入无效与仅启用 V2EX 的有效备份；核对恢复前业务请求为零、原资料/通知意图不变、恢复后来源准确、收藏可见，结束由 runner 停止 App 后还原六个白名单数据库文件并独立重读。`notification` 使用真实 NotificationDetailRoute、gateway 和 native stack，隔离 adapter 响应；核对失焦取消、同一实例返回、失败/未确认重试、刷新不循环、防并发和确认后不重复。后两者执行 `dev/review-remediation-proof/recovery.ad`、`dev/review-remediation-proof/notification.ad`，零重试，最终还要核对包含当次 token 和构建身份的设备 receipt；UI 回放退出 0 不替代业务断言。picker 关闭后等待一次平台过渡动画，再操作 App；等待不作为导入成功 oracle。runner 只删除自己以当次 token 命名的 Download 文件。验收不连接原站，不证明真实写入或系统自然故障。

### Forum selection Native 验证

纯 Native JVM 测试不连接设备；生成的 Android project 存在后执行：

```powershell
npm run test:native:forum-selection
```

真实长按、平台手柄几何、端点变化触感事件、自动滚动、回收恢复、剪贴板与 `0px` 布局位移只在独立 verification AVD `WZ_ForumSelection_Test_API35` 执行：

```powershell
adb devices
npm run test:instrumented:forum-selection
```

runner 要求恰好一个已连接且名称精确匹配的 `WZ_ForumSelection_Test_API35`，并只用该 serial 设置 Gradle 的 `ANDROID_SERIAL`；不存在、重复或不匹配时立即失败。不得通过 `WZ_FORUM_SELECTION_TEST_AVD` 改指主登录态、Smoke、普通 Replay 或未登录 AVD，不得在这些保留数据设备上手工执行 `connectedDebugAndroidTest`。缺少独立 AVD 时报告 `BLOCKED_BY_ENV`，不卸载、不清数据、不重置主 AVD。instrumentation 与 `dumpsys vibrator_manager` 只证明隔离 proof 和系统触感请求；真实 RNRH/Fabric、FlashList、原站正文与 PSS 仍需下方匹配 APK 的只读 Live，实际触感和系统关闭触感后的静默只接受物理 Android 设备证据，缺少设备时记 `NOT_VERIFIED`。

真实横向事件链使用独立开发入口 `dev/forum-selection-proof/index.tsx`，只覆盖安装到上述独立 AVD；它复用生产 Native surface、Reanimated 横向 owner 和 FlashList。构建可在单独 PowerShell 进程设置 `$env:ENTRY_FILE='dev/forum-selection-proof/index.tsx'` 后执行 `android/gradlew.bat -p android :app:assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon`，不使用正式发布流程。普通入口构建必须不带该环境变量；proof APK 不装到保留登录态设备。instrumentation 与 agent-device 的 UiAutomation 会争用同一设备，必须先结束当前设备自动化会话再运行 instrumentation，不能并发。

入口第一行测试短文，后续两个宽片段共享一张表的位置，第三个独立；Measure 按钮读取实际 Fabric 文字坐标。拖选到右缘并持握后，前两个 x 必须相等且持续减小，第三个不变；松手后再次测量必须稳定，普通横滑必须从新位置接续。下方长文用 FlashList 验证至少三个 viewport、回收与反向拖回；短文微斜、跨行、菜单长时间隐藏及松手恢复同时检查。UI mock 的共享 offset 断言不替代此设备链；同帧像素与物理设备触感仍按原专项独立验收。

### 音视频 Native 验证

`patches/expo-video+57.0.3.patch` 内的 `ReaderPlaybackInstrumentedTest` 使用独立的 `expo.modules.video.test` 测试 APK；它不覆盖阅坛包，不读取真实账号，临时 WAV/MP4 在设备本地生成，只访问测试进程内的回环 Range 服务。

完成 fresh prebuild 后，先编译测试包与 Release Kotlin，再明确指定 serial 安装测试包：

```powershell
android/gradlew.bat -p android :expo-video:assembleDebugAndroidTest :expo-video:compileReleaseKotlin -PreactNativeArchitectures=x86_64 --no-daemon
adb -s <serial> install -r <node_modules/expo-video/android/build/outputs/apk/androidTest/debug/expo-video-debug-androidTest.apk>
adb -s <serial> shell am instrument -w -r -e class expo.modules.video.ReaderPlaybackInstrumentedTest expo.modules.video.test/androidx.test.runner.AndroidJUnitRunner
```

必须看到非零测试全部通过。覆盖真实缓存字节、Range 回源、epoch/Referer 隔离、LRU 淘汰、缺失文件回源、音视频真实 seek 与视频目标帧、40/48dp 图标和 56dp 点击范围；负向控制保留旧的不缓存路径。测试阶段以 `ReaderPlaybackProof` 输出仅含合成数据的请求计数与 seek 耗时，截图只写测试 APK 的 external files；任务证据复制到 ignored scratch，不进入 Git。完成后只停止本次测试进程，保留阅坛数据与设备状态。生产 App 中四站正文/回复/引用/采纳答案及实际全屏返回仍需匹配 APK 单独验收，这组 instrumentation 不能替代 Live。

### 更新下载证据

`MORE-04` 的原生测试使用真实 OkHttp、本机受控 HTTP 服务与 source patch 中的 `DownloadResponseTest`，不操作设备：

API 以已安装的 57.0.6 源码为准，升级时对照 [Expo DownloadTask 文档](https://docs.expo.dev/versions/latest/sdk/filesystem/#downloadtask) 与 [上游 NetworkTasks 实现](https://github.com/expo/expo/blob/main/packages/expo-file-system/src/NetworkTasks.ts)，重新验证 Android resumeData、暂停结算和响应写入契约。

```powershell
cd android
.\gradlew.bat :expo-file-system:testDebugUnitTest --tests expo.modules.filesystem.DownloadResponseTest --no-daemon
```

报告位于 `node_modules/expo-file-system/android/build/test-results/testDebugUnitTest/`，必须有非零测试。它覆盖 206/200/416、错误范围写入前拒绝、断流、暂停结算及当前受管 client，仍不替代真实 JS/Android 生命周期。该包必须保留在 `package.json` 的 `expo.autolinking.android.buildFromSource`；补丁升级按 testing standard 在独立干净依赖目录执行 forward check → postinstall → reverse check。临时目录若位于现有仓库下，先建立自己的空 Git 仓库，避免 `git apply` 因子目录 prefix 跳过全部 patch。

设备 proof 使用独立未登录 AVD，先按下节核对安装身份，仅覆盖安装匹配本次源码的开发 APK。普通开发构建在 android 目录执行 `gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon`，不运行正式 release。保留原 APK 以便同签名同版本覆盖恢复。

```powershell
node scripts/app-update-proof-server.mjs <fixture.apk> <Android-SDK/build-tools/36.0.0>
  node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 39082
adb -s <serial> reverse tcp:39081 tcp:39081
adb -s <serial> reverse tcp:39082 tcp:39082
```

开发客户端打开 `http://127.0.0.1:39082/dev/app-update-proof/index.bundle?platform=android&dev=true&minify=false` 对应的 development-client URL。该入口只写 document/wz-update-proof，读取本机服务的 fixture 元信息，调用真实 Expo DownloadTask 与 production APK 校验/打开安装器函数；不挂生产更新 runtime，不修改 AsyncStorage 更新任务。测试代理只在内存应用，下次正常 App bootstrap 恢复安全存储配置。服务只监听本机，不转发互联网请求；`/apk`、`/200`、`/416`、`/wrong-range`、`/disconnect` 提供可控响应，`/stats` 返回 Range、状态与服务端成功写出的 body 字节。中断时服务端缓冲可能略领先磁盘，只能用恢复请求本身的 `bodyBytes == fixture.size - diskOffset` 证明续传；安装重试前后 `/stats` 不增加 APK 请求才计 0 字节。

按 `tests/live/agent-live.md` 的 `LOCAL-UPDATE-01` 分开验证下载链与生产 More；fixture 的 package/version/signer 只用于 test entry 校验，不代表正式 manifest 合格。权限页、返回/取消、断网、进程重启、代理阻断分别记证据；生产完整链缺少合格新版 APK 时记 `NOT_VERIFIED`。结束仅清理本任务 fixture、reverse 映射和服务，必要时用原 APK 覆盖恢复并复核 firstInstallTime。不得卸载、清 App 数据、重置 AVD，或在保留数据设备上执行 connectedDebugAndroidTest。

L 站阅读同步诊断：按 `appSessionId + batchId` 关联 `reading-timings` 初次发送、补发与 `reading-recovery` 状态，再由每次 `traceId + requestId` 关联 Native 请求。`hasCfClearance` 表示实际请求携带通行 Cookie，`hasStoredCfClearance` 与 `isCfClearanceCurrent` 表示当时共享存储及一致性；字段缺失表示未知，不等于 false。面板交接的 `didCfClearanceChange` 只比较开关面板时的通行 Cookie；`cookieKind=clearance` 与 `bot-management` 分开记录。`userAgentHash` 是 Java String hashCode 对应的八位十六进制比较摘要，WebView、JS、Native 可对照；它不是凭据，也不能单独证明浏览器环境相同。网页消息 `userAgentSource=unknown` 不代表实际请求退回默认 UA。CF 响应记录识别依据、状态、Retry-After 和格式校验后的 Ray ID；服务端具体规则仍未知。检查覆盖时间范围和原生丢弃计数后再下结论，不导出 Cookie、Cookie 哈希、CSRF 或验证正文。

L 站 CSRF 请求经隐藏 WebView 接力失败时，保留原始 CF 响应的状态、Retry-After、Ray ID 与识别依据，阅读恢复继续遵守该等待时间。网络写入的 `request-headers-start/end`、`request-failed` 和 `connection-write-stalled` 同时进入 Native 持久 journal，重启后仍可追溯。写后回读用同一提交 trace 的 `hasTarget`、`isTargetMatched`、`itemCount` 与 `refresh-unconfirmed` 区分定位目标缺失、回读不匹配和请求失败；妖火表单阶段只记录 `hasReplyForm`、`hasCsrfToken`、`isSameOrigin`，不记录表单或 token 值。

### CF 验证循环：先核对实际出口

出现原生请求要求挑战、验证页却不出现挑战或验证后仍失败时，先按以下顺序排查。历史反例见[回归语料库的代理出口案例](regression-corpus.md#环境反例2026-09-20-cf-验证与上报出口不一致)。这是环境诊断步骤，不授权修改用户网络，也不把普通 403 一律归为 CF。

1. 留存原请求的状态与识别依据；`cf-mitigated: challenge` 是明确挑战证据。核对实际发送的 Cookie 是否与当前共享存储一致、UA 是否一致，不能只看存储中存在 Cookie。
2. 在同一时间窗口，分别经真实原生通道与验证 WebView 对同源 `/cdn-cgi/trace` 做不带凭据的只读探测，比较 CF 实际看到的公网 IP、地址族与协议。只保留地址族、协议和本轮出口是否相同的布尔值；若需跨进程比较，使用只驻内存的随机盐，不持久化公网 IP、盐或 Cookie。trace 的 200 只证明出口可观测，不证明业务上报成功。
3. Android 系统代理为空、App 标记 direct、处于同一模拟器、使用同一代理节点，都不证明公网出口相同。宿主 TUN、远端 DNS、双栈选址及 TCP/UDP 转发仍可能造成不同出口。先排除这一层，再试 TLS 指纹、Cookie 格式或替换网络库；H3 成功而 H2 失败时尤其要同时核对出口，不能直接归因为协议。
4. 需要调整网络时，只改变获准的最小范围并记录原配置。目标是验证与业务请求使用同一公网出口，不是全局关闭 IPv6。代理客户端的 IPv6 DNS 开关、连接节点的 `ip-version`，不等于节点访问原站的出口版本。对相关站点限制 QUIC/UDP、统一走 TCP 可作为待验证的客户端兼容办法；必须确认规则实际命中、WebView 实际回落，以及两边出口一致，不能只以配置保存成功结算。
5. 出口对齐后重新完成验证，以原 App 的真实业务请求与批次终态验收。协议/UA/Cookie 变化、trace 成功或验证页关闭都不能替代业务成功。实验上报仅可使用已明确遭 CF 拒绝、未超过 100 秒的真实阅读批次；接受或结果不明后不得换通道重放，更不能制造阅读时长来验证。结束恢复约定的用户配置和本任务资源。

[Cloudflare 官方限制](https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/#limitations)说明挑战与解题使用不同 IP 可导致循环；[Mihomo 的 ip-version 说明](https://wiki.metacubex.one/en/config/proxies/#ip-version)区分本地连接代理服务器与目标出口。读 journal 时检查轮转后的新文件，旧文件没有新终态不代表请求仍在阻塞。

Mihomo 客户端可试验以下定向规则，插在已有规则之前并保留其余规则；这是尚未完成 Live 验收的兼容候选，只限制两个主机的 UDP 443，不改变 IPv6 配置：

```yaml
- AND,((NETWORK,UDP),(DST-PORT,443),(DOMAIN,linux.do)),REJECT
- AND,((NETWORK,UDP),(DST-PORT,443),(DOMAIN,challenges.cloudflare.com)),REJECT
```

按[官方规则说明](https://wiki.metacubex.one/config/rules/)从上到下匹配；域名条件依赖 DNS 映射或嗅探提供域名，不能仅凭规则存在判断命中。使用客户端的持久覆写入口，不直接编辑自动生成的配置。验收新连接的规则命中、协议回退、实际出口和业务终态；若效果不符，移除这两条即可，不清登录态。

### L 站访问与等级入账验收

L 站访问活跃诊断：按原有 `traceId + requestId` 对照 JS 修饰后的 transport 事件和 Native `request-headers-end` 的 `hasDiscoursePresent`。true/false 表示该观察点的实际请求头，缺失表示未知；修饰前日志、HTTP 200、空响应及阅读时长增长均不能证明访问或等级已入账。不记录交互时间、账号或正文。

当天访问验收必须保留既有登录态，首次 App 访问之前用不携带 Present 的 XHR 读取最近访问、阅读和官方统计基线，不先开网页、Connect 或 SSO 链路。之后只在 App 阅读未读普通帖，分别记录最近访问时间、新帖子入账及官方等级结果；按服务器日期和统计窗口解释访问天数，旧一天可能同时移出，不能固定要求总数 +1。官方结果只能经 SSO 获取时，应先完成并留存 App 阅读后的访问与入账证据，另标明等级展示链路的影响；无法隔离则此项为 `NOT_VERIFIED`。标记正确且新帖成功上报但等级未更新时继续定位入账与展示差异，不追加猜测请求头、历史补报或请求。

等级的两组数据须分开判断：官方 Connect 要求与用户 summary 活跃数据不是同一响应。上游 [UsersController.summary](https://github.com/discourse/discourse/blob/main/app/controllers/users_controller.rb#L474) 将 JSON 缓存一小时；当前部署期限未知时只作可能原因，不把刷新时间当作统计入账时间，也不为追求立即变化添加绕缓存请求。

### 覆盖安装

本机 `WZ_Pixel_API_35` 已于 2026-09-14 经用户授权保留数据扩容到 16 GiB，完成文件系统离线校验和冷启动后 `/data` 约 16G、剩余约 10G，随后开发包覆盖安装及 `APK_SANITY` 通过，首次安装时间和登录态不变。该 AVD 的旧 QCOW2 带历史快照，单改 `disk.dataPartition.size` 不扩大已有磁盘；本次保留完整备份，以 `qemu-img convert/compare` 核对当前内容一致后扩副本，最后扩展 Android 加密映射中的 ext4。在线 resize 的保留块错误不可用反复重试或强制忽略绕过；离线扩容后须通过 e2fsck 并核对原数据。临时只读系统组件内存副本和 root ADB 已随重启退出；原磁盘及完整备份保留在本机，不提交到仓库。

安装前后都记录 `firstInstallTime`，并要求值不变：

```powershell
adb devices
adb -s <serial> shell dumpsys package com.wz.reader | Select-String 'firstInstallTime|lastUpdateTime'
agent-device install com.wz.reader <apk> --platform android --device <device>
adb -s <serial> install -r <apk>
adb -s <serial> shell dumpsys package com.wz.reader | Select-String 'firstInstallTime|lastUpdateTime'
```

仓库 Smoke 也使用覆盖安装：

```powershell
$env:WZ_ANDROID_SMOKE_DEVICE = '<device>'
npm run smoke:android
# 或验证指定 APK
node scripts/smoke-android.mjs <apkPath>
```

禁止在保留数据的设备上执行 `agent-device reinstall`、`agent-device uninstall`、`adb uninstall`、`adb shell pm clear` 或 Gradle `connectedDebugAndroidTest`。已验证的 `agent-device 0.20.6` 中，`reinstall` 会先执行不带 `-k` 的卸载，CLI 的 “Replace installed app” 文案不代表保留数据。覆盖安装失败就停止；不得自动改走卸载、清数据或重置模拟器。账号、本机数据或 `firstInstallTime` 异常时立即冻结设备变更，只读取证并报告。

### Replay

需要可信安装的 `agent-device >= 0.19.0`，并显式指定设备与目标 APK：

Windows runner 优先直接执行 PATH 中可信 npm 安装旁的 Node CLI，避免 PowerShell shim 启动停滞，并原样传递设备名和参数；其他安装布局仍沿用原 shim。

```powershell
$env:WZ_ANDROID_TEST_DEVICE = '<device>'
$env:WZ_ANDROID_TEST_APK = '<absolute-apk-path>'
npm run test:device
```

runner 会校验设备实际 `base.apk` 的版本和 SHA-256，再执行 `tests/device/`。每个 Replay 使用唯一 session、零重试；既有 manifest、对应 `.tmp`、录屏进程或 orphan scratch 会阻断并保留现场。runner 只清理自己 manifest 中同时匹配 session/device 的录屏，不停止 daemon、MCP 或未知进程。全部旅程通过才形成 `DEVICE_REPLAY_PASS`。

未登录旅程使用独立、无论坛登录数据的 AVD：

```powershell
$env:WZ_ANDROID_LOGGED_OUT_DEVICE = '<logged-out-device>'
$env:WZ_ANDROID_TEST_APK = '<absolute-apk-path>'
npm run test:device:logged-out
```

runner 会拒绝与 `WZ_ANDROID_TEST_DEVICE` 或 `WZ_ANDROID_SMOKE_DEVICE` 相同的设备。不要克隆、卸载或清除主 AVD 来制造未登录状态。

### 首页手势完整回归

相关改动按 `docs/testing-standard.md` 执行以下整套流程；各项共用已核对的 APK 和独占设备输入，不能把一项通过当成整套通过。

1. 核对安装身份、版本与 APK SHA-256；覆盖安装后执行 `APK_SANITY` 和 `tests/device/feed-gesture-priority.ad`。
2. 打开首页，顺序执行下方连续手势矩阵、双向 CANCEL/UP、独立惯性、首页刷新和边界交叉脚本。
3. 打开“更多 → 消息通知”，执行通知刷新取消脚本，然后返回首页。
4. 按 `tests/live/agent-live.md` 的 `LIVE-FEED-01` 补验首尾边界、点选、分类栏、刷新中切来源/底栏和返回。只读手势验收不改变来源启停/顺序或账号状态。
5. 保存每项通过或未验证范围及设备输入方式；实体手机与鼠标手动操作分别记录，不借用自动注入结论。回收本轮会话和专用临时文件。

首页中段横滑取消的 Native oracle 使用已打开首页、已核对版本与 SHA 的候选 APK；显式选择同一设备和当前 agent-device session：

```powershell
$env:ANDROID_SERIAL = '<serial>'
$env:AGENT_DEVICE_SESSION = '<active-session>'
node scripts/check-feed-pager-cancel.mjs
```

脚本只读取 V2EX 并滚动，在两个方向先证明短横拖确实移动页面，再分别注入系统 CANCEL 和正常 UP。CANCEL 必须完整归位且来源不变；正常 UP 可以按原生速度切至邻页，但最终必须显示一个完整页面。它不安装、不重置数据，也不代替快慢斜滑、刷新及共享正文触摸验收。运行期间不得对同一设备并发发送其他输入或 snapshot。

常见连续手势使用同一设备/session、JDK 和 Android SDK（API 35 platform、build-tools 36.0.0）：

```powershell
$env:ANDROID_HOME = '<Android-SDK>'
node scripts/check-feed-gestures.mjs '<ignored-evidence-directory>' yaohuo
```

来源参数默认 `v2ex`，也可选当前已能稳定读取的 `yaohuo`、`nodeseek` 或 `linuxdo`。脚本从真实列表中段执行 72 组手势：原有 8 类 × 3 种速度 × 2 个方向（横滑归位途中接纵滚、完整横滑、纵向斜滑、纵转横、横转纵、惯性中接横滑、同次回拖和系统取消），另加静止/惯性中/横纵交接后 20% 屏宽的短快滑（80/120ms、双向）、12% 屏宽短慢拖（800ms、双向）和惯性中轻点，再加横纵交接后的短斜滑（横移 20% 屏宽、纵移 8% 屏宽，80/120ms、双向）。每项检查完整页面几何，纵向意图/取消保持来源，短慢拖按原生规则自然结算，完整横滑和短快滑必须换来源；归位期间接纵滚还检查卡片实际位移，轻点必须停止惯性且不打开帖子。末尾可加已有动作名（如 `fling-short-horizontal`，多个用逗号分隔）作紧凑诊断，但最终验收仍运行默认全矩阵。每项先切至“全部”再切回目标来源，避免依赖可关闭的回顶按钮或上次滚动位置。`tests/device/TouchTrace.java` 在 adb shell 内按同一时间线注入连续触摸，不安装测试 App；jar 只写任务专用 `/data/local/tmp` 路径，结束移除。结果只保存动作、来源、bounds 与实际事件时间，不保存列表正文；实际时间漂移超过 50ms 时停止并报告输入无效，不能把延长后的慢拖当作短快滑。来源进入验证页、列表未加载或用户同时触摸设备均不能作为手势 verdict；测试期间独占设备输入。该矩阵仍须配合下面的惯性、刷新 oracle 和 `LIVE-FEED-01` 的首尾边界、点选、刷新交叉与页面返回。

首页惯性另从已打开的首页运行，沿用以上显式设备与 session：

判断慢拖手感时区分实际跟手位移与松手结算：短慢拖可以自然回弹，长慢拖超过原生阈值应换页。尤其检查“先纵滚再横拖”，不能沿用上一段被取消手势的按下位置。需要诊断时在本机记录 MotionEvent、页面进度和归位输入，临时日志不得进入补丁或最终 APK；完整矩阵仍是 canonical owner，自动注入不代表物理触感。

```powershell
node scripts/check-feed-fling.mjs '<ignored-evidence-directory>'
```

脚本重新选择 V2EX 首屏，执行 120ms 快甩并比较松手后两个时刻的列表内容，独立断言拖动确实发生、松手后仍继续移动。需使用有足够静态条目且无加载遮罩的页面；截图采样排除导航栏、滚动条和悬浮操作，不能用于有大面积动态图片的列表或证明所有速度、设备性能均正常。仅验证“甩动后还能横滑”不能代替该惯性 oracle。

首页刷新在浅色主题、已登录且可读取的妖火列表执行：

```powershell
node scripts/check-feed-refresh.mjs '<ignored-evidence-directory>'
```

检查 50/100px 短拉、长拉后系统 CANCEL、回拉、下拉中横移及下一次正常刷新。先确认指示器实际出现，再核对收起与完整页面；像素探针适用浅色静态列表，若中央正文有同色内容，需人工核对截图，不能放宽阈值冒充通过。

刷新尚未结算时的切站和底栏返回使用同一脚本的 `interruptions` 模式：

```powershell
node scripts/check-feed-refresh.mjs '<ignored-evidence-directory>' interruptions
```

该模式要求松手 1 秒后仍能确认刷新圆圈，快网络导致前置条件不成立不能计入通过。模拟器可临时使用受控的蜂窝延迟，操作前记录 Wi-Fi、移动数据与 latency，结束在 `finally` 恢复原值；不改账号或服务器代理。[Android Emulator 官方控制台说明](https://developer.android.com/studio/run/emulator-console) 指出 `network delay` 仅作用于 Ethernet/Cellular，36.5 起默认 Wi-Fi 走 netsim，不能只设置该参数就声称已模拟慢 Wi-Fi。

首页边界交叉从已加载的完整列表执行；要求所有一级来源标签可见，“全部 → 已读”中有既有阅读记录：

```powershell
node scripts/check-feed-boundaries.mjs '<ignored-evidence-directory>'
```

按当前来源顺序验证首尾页快慢向外滑；每次碰边界后，反向短滑 20% 屏宽、120ms 必须切至邻页，再向原方向短滑必须返回边界页。首屏向右、末屏向左本来就没有相邻页，向外不切页不能单独作为拦截 Bug。其余用例覆盖列表顶部和实际尾部双向斜滑、双指后恢复单指、快甩后点远端 Tab、二级栏横滑及切底栏返回。尾部固定选择“全部 → 已读”的有限列表，并确认“已经到底了”；不要在未筛选的来源中追逐自动追加的帖子，也不为准备数据打开未读帖子。已读为空时脚本明确停止，首尾斜滑记为 `NOT_VERIFIED`；末尾添加 `interactions` 可独立运行后四项交互，不代替完整边界验收。末尾添加 `rail` 只诊断四站分类栏：要求四站启用、存在溢出分类，逐站验证双向位移、两端继续拖动不换来源及点击隐藏分类，结束回到“全部”。分类不溢出或来源验证页遮挡时前置条件不成立，不计入通过。连续手势矩阵仍使用长列表验证中段。刷新尚未结算时切来源/底栏仍按 `LIVE-FEED-01` 单独取证，不能用正常切页结果代替。

`rail` 后可再指定 `v2ex`、`linuxdo`、`nodeseek` 或 `yaohuo`，用于独立重放中断来源。反向拖动先验证实际回移，再继续拖至起点检查边界，不假定两次等距输入必然抵消原生惯性。

通知刷新取消另在浅色主题、“消息通知 → 全部”、列表顶部运行，沿用以上显式设备与 session：

```powershell
node scripts/check-notification-refresh-cancel.mjs '<ignored-evidence-directory>'
```

脚本先等待聚合通知进入 data、empty 或 partial 终态，排除首次加载圆圈，再使用已安装的 `pngjs` 读取原生截图，证明下拉指示器出现，验证 CANCEL 后 1 秒内收起、下一次正常下拉在 60 秒内结算。证据目录必须 ignored；不打开消息、不标已读。当前像素探针适用于已验的 1080×2400 与 1264×2780 浅色 viewport；其他布局需先核对截图与探针范围，不能把“未拉出指示器”算作通过。

`npm run smoke:android` 在覆盖安装后的第一次启动前写入日志 marker，只检查有界启动窗口、前台包名、崩溃、ANR 与 RedBox，形成 `APK_SANITY`；随后 Replay 独立形成 `DEVICE_REPLAY_PASS`。二者都不等于真实来源当天数据或全部功能通过，也不授权任何远端写操作。

### 冷启动对照

启动图通过 `expo-splash-screen` 的 drawable 配置和 `plugins/withSharedAppIcon.js` 共用 `assets/icon.webp`；React 占位用原生资源名，不再 require 完整 PNG。WebP 是 `assets/icon.png` 的无损副本；更新图标时同步转换并核对解码后的 RGBA 像素一致（Pillow：`image.save(path, lossless=True, method=6, exact=True)`）。`assets/splashscreen.xml` 保持原生 288dp 画布内居中 200dp 图标；两种入口的显示尺寸同时核对。缩包验收比较同签名、同 ABI 的 release APK，并确认只保留一份 `reader_app_icon`，无 `assets_icon` 或五档 `splashscreen_logo` 位图。

使用相同配置的 Release Hermes 测试包，先按覆盖安装规则确认签名、APK SHA 与 firstInstallTime，再执行：

```powershell
node scripts/check-cold-start.mjs --serial <serial> --apk <匹配的本地APK路径> --output .codex-tmp/<任务目录>/startup-results.json
```

输出父目录须已存在，文件必须是 `.codex-tmp` 内的新路径。默认三批、每批十次；工具不安装或清数据，只 force-stop 指定 App 并通过 launcher 启动。每轮校验 COLD 启动、新进程身份和阶段所属 buildId，以进程启动以来的 Native 单调毫秒记录 `page-ready`、本机恢复及首批 Feed；`TotalTime` 单列为系统显示指标，不与 Native 毫秒相加。Feed 空态、失败和二十秒内缺少内容阶段不补零，不算帖子成功。各轮等本轮内容终态或采样截止后再间隔五秒，保持请求波顺序执行。工具不会清 logcat；仅读取当前 PID 的固定 `WzStartup` 阶段。

首次覆盖安装、旧版迁移和设备重启后的启动单独观察，不纳入普通冷启动。前后保持来源设置、资料规模、设备、电源状态和构建类型一致；计时期间不运行构建、测试、Hermes sampling 或其他设备操作。报告三批中位数、p90、最慢值，以及首次详情/公式/编辑器和通知/深链接的独立结果；页面就绪信号不能代替实际交互或首批帖子。退出、缺少页面就绪、构建或安装身份变化立即停止并保留结果。原生图标视觉必须使用 Release 包检查，开发客户端不作效果证据。

### ReaderData SQLite 升级验收

投票 journal 的独立设备验证复用同一隔离 runner：`node scripts/run-reader-storage-device-proof.mjs --serial <serial> --build --journal-only --output .codex-tmp/<新文件>.json`。也可传匹配源码的 `--apk` 替代 `--build`。该模式不 seed 或删除数据库，以唯一 token 隔离投票账号，验证并发/超过 32 条/严格迁移/损坏阻断/ReaderData 导入清空隔离，随后 force-stop 重开并核对已知和未知结果；恢复原 ReaderData 并删除本轮 fixture 后才通过。它仍只接受既有允许的 ReaderStorage 专用 AVD，不能改用于保留真实账号的主设备。

该模式同时经过真实 action/client/request：最终合成 transport 前用第二 SQLite 连接确认 claim，网络请求仍 pending 时 force-stop，重开必须保留未知并拒绝再次发送（transport 次数为 0）。终端不访问原站，不创建真实投票。

`--sidecar-only` 与 `--journal-only` 互斥，使用同一构建和输出参数。分别运行 settings read、cleanup remove、cleanup keys 挂起的 seed→启动→新进程验证，共九阶段；只 gate 对应 AsyncStorage 操作，SQLite 使用真实实现。该模式会写入专属 fixture，已有隔离状态须用 `scripts/review-proof-checkpoint.mjs` 的 `withProofCheckpoint` 包围，完成后核对六个白名单文件及独立逻辑快照还原。

只使用新建隔离 AVD `WZ_ReaderStorage_API30_20260910` / `WZ_ReaderStorage_API35_20260910`，分别安装 Google APIs x86_64 的 API 30 / 35 系统镜像。先完成 fresh prebuild；不在主登录设备运行 fixture，不卸载或清数据。使用同一测试包覆盖安装第二台隔离 AVD：

```powershell
npx expo prebuild --platform android --clean --no-install
node scripts/run-reader-storage-device-proof.mjs --serial <隔离serial> --build --output .codex-tmp/<任务目录>/sqlite-api30.json
node scripts/run-reader-storage-device-proof.mjs --serial <另一隔离serial> --apk <上一步保留的reader-storage-proof.apk> --output .codex-tmp/<任务目录>/sqlite-api35.json
```

Runner 在临时 Gradle overlay 中选择 `dev/reader-storage-proof/index.tsx`，编译 Release Hermes 并仅为隔离取证开启 run-as；生产入口没有故障开关。每轮 force-stop 后以唯一 token 启动，核对 buildId、processSessionId、PID 和安装身份，保留不含资料正文的 receipt。覆盖普通、6000 条收藏/历史组合、5002 条历史、大行及超 5 MiB 旧数据，逐字段和顺序核对；在提交前后、部分/全部删除旧 key 后暂停，由外部进程终止再恢复；清理失败后写入新设置再重启，验证不回退旧快照。真实 SQL trigger 验证历史/收藏原子回滚，第二连接持锁验证 3 秒等待，EXPLAIN QUERY PLAN 核对时间索引。

`--seed-only supported` 只重建 runner 自己标记的隔离资料，可用于旧版仍完整支持规模的性能对照。随后覆盖安装正常生产入口的 Release 测试包，再执行冷启动采样；proof 包的核对与故障开销不能作为产品性能样本。迁移和清理 trace 的 `elapsedMs` 使用单调时钟，旧 trace `durationMs` 不作为该阶段性能依据。输出必须是 ignored `.codex-tmp` 下的新文件；测试数据与 APK 不提交。

### Release 性能回归

正式门槛只使用与当前 revision、APK SHA、PID 和主登录态 AVD 匹配的 Release `FrameTimeline/gfxinfo` 与 `meminfo`。Perfetto、heapprofd 或 Hermes sampling 只用于独立归因，采样轮次不能混入通过数据。每个页面把首次挂载与预热路径分开统计；PSS 一律以同一 PID 的 Feed 静置基线计算增量。

Search 空态固定执行三批、每批 10 次 Feed → Search → Feed：每次转向前重置 `gfxinfo`，同时报告两个方向和整批的 p95、worst、missed deadline。门槛为每批 p95 `<=25ms`、worst `<=35ms`，且不得连续两帧 missed deadline。另取原始分辨率截图与 Native tree：最近记录仍须保持单张圆角分组面板、hairline 分隔和互不重叠的 `48dp` 点击区，最多 20 条记录不得作为 Header 子树整体常驻。节点减少但 traversal/draw 仍稳定在 21–26ms 时，只 profile Header 控件；不得叠加全局 memo、延时或预挂载 workaround。

重图 Topic 只使用主登录态 AVD `WZ_Pixel_API_35` 和 NodeSeek `https://www.nodeseek.com/post-863650-1`，不换未登录模拟器，也不再用其他图片帖代替或扩样。基线与新版必须使用相同构建类型、AVD、滚动动作和采样点：每次独立运行先在 Feed 静置并记录 PID/PSS，再以 deep link 打开目标，同一 PID 连续两轮各 40 次向下、40 次向上，返回 Feed 后再记录 0/30/60 秒 PSS；同时报告 FrameTimeline/gfxinfo、warm/running/original、重复 identity、cancel、Fatal、ANR、OOM 和模拟器响应。历史 `+150MB/+80MB/p95 50ms` 仅作为观察值，不再作为中止或撤销正确性修复的固定门槛；以基线三轮中位数及最大自然偏差判断非回退，首次同方向超出后补一轮复测，仍变差才定位并重做对应层。新增崩溃、空白、比例变化、较早卡死或 PID 退出直接记为回退；新旧都触发独立 `system_server` 故障时记 `BLOCKED_BY_ENV`。

Glide 5.0.5 与详情 FlashList 回收池 40 是当前固定基线，不再循环测试 5.0.9 或 32/24。已确认的 viewport、稳定 lease、尺寸元数据和 Native resize 竞争分别按自己的行为 oracle 修复；整体 PSS 改善不明显但行为正确且性能中性的修复继续保留。只有 Perfetto/heapprofd 证明同一 identity 重复解码、base 回滚解码或正文原图目标尺寸过大时，才分别增加有界 viewport 滞后、正文 base `memory-disk` 或受限 `useImage(maxWidth/maxHeight)` 原型；不提交清全局图片缓存、低色深、`largeHeap`、页面特判或新图片库。

每个正式候选完成构建并覆盖安装后，先核对包名、版本、签名、APK SHA 和未变化的 `firstInstallTime`，再等待 `cmd package wait-for-handler --timeout 60000`、执行 `adb shell sync` 并静置，随后关闭同一 `WZ_Pixel_API_35`，确认原 emulator/qemu 进程已退出，再用 `-no-snapshot-load -no-snapshot-save` 冷启动并等待系统稳定；禁止 Quick Boot/快照恢复、切换其他 AVD、wipe data、卸载或清 App 数据。恢复后重新核对 AVD 名称、包版本、APK SHA、`firstInstallTime` 与登录态，身份不一致就停止设备变更。模拟器卡死也只执行这一流程。

## Agent Live

`tests/live/agent-live.md` 是唯一流程。普通改动在 `verify` 与相关 Replay 后执行 `targeted`；集中修复、里程碑或发布前执行 `full`。启动时提供 Agent Profile、Git revision、App version、APK SHA、设备和能力 ID；最终按能力 ID 报告 `LIVE_PASS`、`NOT_VERIFIED`、`BLOCKED_BY_ENV` 或明确失败，以及恢复状态和残留。登录、账号授权、交互式 CAPTCHA 与远端写入仍需用户监督或另行授权。

Android 主楼正文连续选择的 targeted Live 固定展开 `TOPIC-01/02/03` 与 `NAV-02/03`，全程只读：

- 纵滚绘制 owner 的 targeted proof 只复测当前 NodeSeek `https://www.nodeseek.com/post-832584-1`：先长按同页原生标题记录平台 start/end 手柄的方向、hotspot、行底位置和拖动触感，再在正文执行一次静止长按进入自定义选择，禁止用双击代替；正文手柄必须使用同一平台主题形状，主体从行底向下展开且不压住端点文字。把端点放到 wrap-content TextView 底部和相邻 row 边界，确认平台手柄仍完整可见；这条 falsifier 必须由同一 ViewRoot 的列表 viewport/surface overlay handle wrapper 通过，TextView/marked-row overlay、关闭 `clipChildren/clipToPadding`、`PopupWindow` 或独立窗口均不合格。把范围拖过首段、贴纸、标题、链接和多段正文后保持选区不取消，连续三次快速下滚再上滚。录制原始分辨率画面并逐帧独立核对可见高亮、起点手柄和终点手柄；端点可见但手柄缺失直接失败，只有真实 viewport/祖先裁剪或 ActionMode 遮挡可列为 excluded。每个实测样本相对当前文字 Path/caret 的 `L∞` 误差必须 `<=2px`，并报告 eligible、measured、missing、excluded 和最坏帧；尤其核对 pre-draw 后仍发生滚动/translation 的同一 draw，低帧率肉眼观察、滚动结束截图或坐标回调断言不能替代该证据。
- 直达 NodeSeek `https://www.nodeseek.com/post-877083-1`，先记录主楼正文、标题、表格、表后文字、Emoji 与贴纸的 bounds/baseline；在带 opening marker 的主楼正文双击，确认不出现原生局部高亮、手柄或系统 ActionMode，再以静止长按进入自定义选择。跨至少三个 viewport 并触发至少一次 cell recycle；每次滚动后确认高亮和手柄仍贴合当前文字、旧屏幕位置无 overlay 残影，回收/layout commit 中即使某帧暂时没有可绘制映射也不得取消逻辑选区或 ActionMode，稳定帧必须恢复可见 overlay。再拖过“正文 → 标题 → 表格 → 表后文字”后复制，核对段落换行、table tab/newline 和媒体标签的原文顺序。如主楼存在展开引用/details、签名或 terminal Tab，还要确认当前实际显示的分支进入同一 manifest，折叠内容不进入。选择中与取消后重复记录，所有上述位置相对选择前必须为 `0px` 位移。
- 同帖慢横拖 table/code、纵向滚动、普通链接点击、Back 与取消选区保持既有行为；起止手柄都从可见命中区边缘按下并细微拖动，端点不得跳到手指中心，拖动合法选择手柄时始终不得出现放大镜，之后逐字符往返：Android 27+ 只有逻辑端点改变时出现 `TEXT_HANDLE_MOVE`，停在同一端点、自动滚动但端点未变、取消和重绑均无选择触感。活动选区上普通短按正文或空白必须在原点击分发后取消，形成纵向滚动意图的手势必须保留选区且首个 draw frame 就让 overlay 贴住文字。普通链接 tap 必须直接进入既有目标并结束旧选区，不得被 coordinator 延迟或吞掉。横滑接管后不得残留放大镜、手柄或 ActionMode。
- 直达 NodeSeek `https://www.nodeseek.com/post-652056-1`，保持主楼与至少一条回复同时挂载：主楼表格必须仍能静止长按进入连续选择；回复 row 必须零 opening marker、不能进入主楼 manifest 或 Native 映射，长按回复只执行独立的原有整条复制并核对剪贴板，不出现主楼 coordinator 的手柄/ActionMode。对当前实际显示的评论和已采纳答案逐项重复该负向 marker 验收；当前真实对象不具备某一类型时该分支记 `NOT_VERIFIED`，不用普通回复冒充。
- 直达 NodeSeek `https://www.nodeseek.com/post-863650-1`，分别在选择前、选择中和取消后记录父 FlashList row、mounted media、warm/running/original 高水位、PID 与 PSS；选择不得增加 row/media 挂载，继续满足每 row `<=4`、warm `<=8`、running `<=4`、original `<=1`，并以同条件基线的 PSS 曲线与自然偏差作非回退判断，同一 PID 连续两轮相同滚动后 PSS 不得持续增长。

主楼双击出现任何局部选区、静止长按未进入自定义选择、滚动后 overlay 与当前文字错位或留下旧屏残影、可见端点缺少对应手柄、手柄仍由 TextView/marked-row host 承载而在行底或相邻 row 被裁剪、viewport/surface wrapper 使用缓存的 screen 坐标而未在 draw 时重投影、生产 surface 依赖关闭 `clipChildren/clipToPadding`、创建 `PopupWindow`/独立 ViewRoot、手柄形状/方向不匹配同页原生标题、手柄主体压住端点文字、hotspot 误差 `>2px`、按下时端点跳变、端点未变仍请求触感或端点已变却无 `TEXT_HANDLE_MOVE`、瞬态映射缺失取消逻辑选区、回复/评论/采纳答案出现 opening marker 或参与主楼 manifest，以及空白/重复 row 或 marker、无效 tape、revision 复用、稳定帧仍无法映射当前端点等结构性失败，连同整条长按复制退化、主楼复制顺序错误、位置变化、额外挂载、ANR/OOM/Fatal 或 PID 意外重启都记为明确失败。只有端点文字本身未挂载或被真实 viewport/祖先裁剪时，单个瞬态帧才可跳过当帧命中或绘制并等待稳定映射；文字端点已经可见却缺少手柄仍直接失败。外部内容变化或独立 AVD/主 AVD 不可用记 `BLOCKED_BY_ENV`；缺少物理 Android 设备时仅实际触感记 `NOT_VERIFIED`，其余分支不能据此跳过，且都不能用局部单测或 App 启动替代。`REG-TOPIC-100` 在上述主楼正向、回复/评论/采纳答案负向、回收、布局、触感和性能 Live 分支全部取得 `LIVE_PASS` 前不得记为 `RESOLVED`。

- ActionMode targeted proof：任一主楼选区执行 Select all 后，浮动菜单必须立即物理移除 Select all，并把可执行 Copy 直接留在一级菜单；端点缩回后 Select all 恢复，整个流程不得依赖系统是否显示浮动菜单返回箭头。记录同页原生标题和主楼在当前设备上的平台动作：标准 Share 必须用 `ACTION_SEND` `text/plain` 进入 Android Sharesheet，不自行枚举分享目标；API 23+ 只显示设备当前可解析且满足 same-package/exported/permission 边界的 `PROCESS_TEXT` 动作，名称、数量和顺序允许随系统/OEM/已安装 App 变化，不要求固定出现“翻译”。classifier 按系统版本验收：API 24–25 无 classifier 动作；API 26–27 至多一个 legacy label/icon/onClick-or-intent 动作；API 28+ 为动态 `RemoteAction` 列表。API 26+ 动作都允许异步出现，但改变/取消选区后旧 snapshot 的晚到动作不得回填或执行。classifier 可能在菜单打开时就把选区纯文本交给系统/OEM 实现，因此该只读展示也只能使用不敏感测试文本；Share、`PROCESS_TEXT` 或 classifier 动作的外部执行则必须逐项取得用户明确授权。点击 Share 后核对 `EXTRA_TEXT` 在 100,000 UTF-16 字符 parcel-safe 上限内严格等于当下 canonical 选区、超限不劈 surrogate；点击 `PROCESS_TEXT` 后核对只读 extra 与未经裁剪的当下 canonical 文本；点击 classifier action 只核对仍匹配 snapshot 的 legacy listener/intent 或 `PendingIntent` 被执行，未授权分支记 `NOT_VERIFIED`。成功启动 Sharesheet 可结束选区；取消目标选择不产生正文写回，Share launch 失败必须保留选区，无 handler、query、分类、Intent 或 `PendingIntent` 失败都不得崩溃、修改正文或损坏 Copy/Select all；不得输出 Intent payload、选区正文或外部 App 数据到日志/交付物。

## 直接打开主题链接

用户给出 NodeSeek、linux.do、V2EX 或妖火主题 URL 时，URL 本身就是目标：

1. 按 `src/domain/forum/links.ts` 的 `parseForumTopicLink` 规则取得来源、主题 ID 与规范化 URL。
2. 确认设备运行当前目标构建，优先用 agent-device `open` 打开 `exp+wz-android://open-topic?url=<encoded canonical URL>`。
3. agent-device 不可用时使用 ADB：

```powershell
$topicUrl = [uri]::EscapeDataString('https://linux.do/t/123456')
adb shell am start -W -a android.intent.action.VIEW -d "exp+wz-android://open-topic?url=$topicUrl" com.wz.reader
```

4. 在 App 内确认来源、标题和正文。直达失败时检查当前 bundle、deep link 与详情请求并报告，不改走搜索。

## 正式发布

只有用户明确要求正式发布时才执行本节；版本、签名或原生配置的普通开发验证使用 targeted tooling test、fresh prebuild/compile 或构建检查。

### 打包基线

当前打包配置由 `app.json`、plugin 和 source patch 维护：保留 RN source build、release minify 与 resource shrink；启用 `useLegacyPackaging=true`，仅对原生库做 APK ZIP 压缩，并显式设置 `enableBundleCompression=false`，保持 Hermes bundle 为 ZIP stored，避免引入 bundle 冷启动解压。原生库由系统在安装时解压，运行时加载解压后的相同库文件；APK 下载更小，但安装时需要解压且安装占用可能增加。保留 `proguard-android.txt` 的 `-dontoptimize`，不恢复 `withAndroidReleaseOptimization`、`proguard-android-optimize.txt` 或额外的 `android.r8.optimizedResourceShrinking` 开关。候选必须与同源码、同签名、同 ABI 的未压缩包分别比较 APK 大小、安装占用和本节的 Release 性能，并核对 ZIP 条目、签名、对齐及正文复制、刷新手势、公式、媒体和编辑器的真实运行。图标使用包根入口导入，`react-native-render-html` 使用锁定原版，不恢复为缩包添加的 Ramda 导入补丁，也不启用实验性全局 tree shaking。版本递增、签名、覆盖安装和验证门禁沿用下述流程。

fresh prebuild 后核对生成的 `android/gradle.properties` 与 `android/app/build.gradle`：`expo.useLegacyPackaging=true`、`android.enableBundleCompression=false`，默认 ProGuard 文件为 `proguard-android.txt`。未压缩对照构建只用 Gradle 参数 `-Pexpo.useLegacyPackaging=false` 覆盖原生库打包方式；其余源码、配置和签名保持相同。长期配置只从 `app.json`、plugin 和 source patch 生成。`tests/tooling/release-packaging.test.ts` 固定打包配置边界。

涉及 Feed/Pager/RefreshControl 的候选，发布前执行本节前面的下拉刷新 Native 测试，并按 `tests/live/agent-live.md` 的 `LIVE-FEED-01` 验收 Tab 点击、双向滑动、回拖取消与刷新交叉操作。`npm run verify` 的 UI mock 和 app native tests 不代替这项 RN source test 或设备证据。正文长按复制按 `TOPIC-01/02/03` 的现有 owner 验收，不能以包体积下降或 App 启动成功替代。

### 执行发布

发布前准备 Node 22（`>=22.22.2 <23`）、完整 Git history/tags、clean working tree、本机 `agent-device >= 0.19.0`，以及不进入 Git 的 `.env.release.local`。至少配置：

```text
WZ_ANDROID_KEYSTORE_PATH
WZ_ANDROID_KEYSTORE_PASSWORD
WZ_ANDROID_KEY_ALIAS
WZ_ANDROID_KEY_PASSWORD
WZ_ANDROID_SMOKE_DEVICE
WZ_ANDROID_SMOKE_ABI=x86_64
```

执行：

```powershell
npm run release:android
```

脚本会执行 preflight、`npm run verify`、clean Expo prebuild、Release native 测试与编译、正式 arm64 签名构建、签名/版本校验、同代码开发签名 x86_64 Smoke 构建及 manifest 生成。签名变量只注入正式 `assembleRelease` 子进程；正式 APK 禁止 debug 签名。

用户当次明确授权特殊发布、并且受影响能力及共享 seam 的定向回归已完成时，可执行 `npm run release:android -- --skip-verify --replay-directory <专项目录>`。`--skip-verify` 跳过脚本内的全量 `npm run verify`；`--replay-directory` 将 Smoke 后的默认设备 Replay 批次替换为指定目录中的 `.ad` 文件，仍先执行覆盖安装、首次安装时间与 APK_SANITY 检查。版本、clean-tree、prebuild、原生测试/编译和签名校验仍执行；manifest 的 `verificationScope` 记为 `targeted`，默认发布记为 `full`。未指定 Replay 目录时仍使用 `tests/device`，不能假定 `--skip-verify` 同时跳过默认 Replay。专项目录只放本次实际需要的回放文件，并遵守各脚本的设备与偏好前置条件；例如 Feed 手势发布可单独选择 `tests/device/feed-gesture-priority.ad`，不能把含其他专项的整个目录当成最小回归。发布说明必须列出实际通过的范围与未验证范围，不能沿用历史全量通过结论。GitHub push 仍按现有 CI 独立运行，不因本机特殊发布关闭 CI。

预期产物：

- `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`：正式上传包。
- `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`：仅用于本机 Smoke，不上传。
- `release-manifest.json`：与正式 APK 一同上传，供更新检查和 provenance 使用。
- `diagnostic-symbols/<buildId>/`：本机 ignored 符号归档，含 combined source map、R8 mapping、Git SHA 与两个 APK 的 SHA-256；符号缺失或同 buildId 产物冲突使发布失败。该目录保留用于事后还原，不随 APK 上传，不进入 Git。

脚本不执行 Git commit、tag 或 GitHub 上传。Smoke 和 Replay 通过且当次明确获准远端上传后，发布 `app-arm64-v8a-release.apk` 与 `release-manifest.json`；发布说明记录正式 APK SHA-256。不要提交或输出 keystore、`.env.release.local`、密码或 token。

## 工具进程收口

- 启动 Metro、watcher、Gradle、agent-device 或录屏前记录 PID 基线；结束时只处理本任务新增且可确认归属的进程。
- Replay 由 runner 清理自己的 session；手工探索只关闭本次 session。共享 MCP、模拟器与 ADB 不关闭，未知 scratch 不删除。
- 本任务启动了 Gradle daemon 且不再构建时，可执行 `android\gradlew.bat --stop`；有意保留服务时报告 PID、端口和原因。
- 无法确认归属的进程或文件不强制清理，交付时列为残留。


### 自动视觉回归与 checkpoint 续接

使用已存在的 `WZ_ReaderStorage_API35_20260910` 专用 AVD；不得借用主登录设备或重置 AVD。两个 runner 共享本机127.0.0.1:42187的 OS 排他租约，进程退出后租约释放，checkpoint 状态继续约束下一次运行。端口被占用时先确认正在运行的 owner，不杀未知进程。

固定条件为 API 35、1080×2400、420 dpi、系统字号 100%、en-US；环境清单另记录镜像 fingerprint、时区、导航模式、系统主题及工具版本。14帧中的140%是应用字号，列表密度保持标准；搜索和用户主题样本使用固定展示日期，不能依赖当天相对时间。Gallery仅证明这些生产组件的设备视觉结果，不替代业务导航与原站链路。

```powershell
# 首次捕获候选：临时 overlay 构建独立 Release Gallery，14帧各捕获三次。
npm run test:visual:device -- --serial <隔离serial> --build --capture-baseline
# 审阅候选画面及变更后显式批准。不得自动批准。
npm run test:visual:device -- --approve-baseline .codex-tmp/visual-runs/<候选目录>
# 固定回归：指定 Gallery APK；模型无需逐步点击。
npm run test:visual:device -- --serial <隔离serial> --apk <gallery-apk>
# 仅恢复中断的 restoring checkpoint 可续接；不安装 APK。
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --resume-restore --output .codex-tmp/<任务目录>/restore.json
# 故意失败与 App 中断的还原验收：返回非零是预期，另核对 restoration.phase=restored。
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance recovery --exercise-failure after-replay --output .codex-tmp/<任务目录>/failure.json
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance recovery --exercise-failure app-stop --output .codex-tmp/<任务目录>/interrupted.json
# 取消系统文件选择必须失败，不能冒充格式校验成功；仍须完成数据库还原。
node scripts/run-review-remediation-device-proof.mjs --serial <隔离serial> --apk <proof-apk> --acceptance recovery --exercise-failure cancel-import --output .codex-tmp/<任务目录>/canceled.json
```

基准持久保存在 ignored `.codex-tmp/visual-baselines/<环境目录>/`；每轮画面、差异图、步骤、失败材料及环境清单在 `.codex-tmp/visual-runs/`。不提交截图、APK或数据库。只有 `DEVICE_REPLAY_PASS` 代表已有批准基准的比较与数据还原共同通过；`NEEDS_REVIEW` 只是三次稳定候选，须逐帧审阅关键操作区、遮挡和长文本再批准。后续更新仍须显式捕获与批准，并审阅相对旧基准的差异，不能在回归中自动修脚本或自动放宽阈值。该入口独立于普通 `verify`。

checkpoint 在 `.codex-tmp/review-remediation-checkpoints/<AVD>/`。恢复失败保留业务与恢复错误，阻止下一轮；旧 `running` 即使 runner 被杀也不能自动还原或覆盖，应先保留数据并人工检查。`restoring` 续接先核对安装身份及每个文件哈希，发现后来变化便拒绝。数据库还原不等同权限/通知业务成功，须同时查看两部分结果；安装身份变化时冻结设备变更。
