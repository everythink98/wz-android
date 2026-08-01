# 维护手册

## 事实源

- 品牌、视觉和 accessibility 约束以 `PRODUCT.md` 为准；产品取舍以 `docs/product-charter.md` 为准，现有能力与共享回归范围以 `docs/product-map.md` 为准，历史逃逸问题以 `docs/regression-corpus.md` 为准，结构和数据边界以 `docs/architecture.md` 为准，待处理债务以 `docs/code-cleanup-map.md` 为准。
- 功能验收以 `docs/testing-standard.md` 为准；本机模拟器的可变基线记录在 `docs/emulator-baseline.md`，不进入 Git。
- 当前版本从 `package.json` 与 `app.json` 读取，不在本手册重复维护。

## 开发与交付流程

1. 开发前从 `docs/product-map.md` 选择直接受影响的能力 ID；触及共享 seam 时展开关联 ID。
2. 检查 `docs/regression-corpus.md` 是否已有相同 seam 的逃逸事故；有则把精确 oracle 加入必跑项。
3. 沿地图确认用户入口、行为契约、代码入口、自动测试和模拟器路径，再做最小完整改动。
4. 按 `docs/testing-standard.md` 执行相关自动测试与模拟器验收；真实写操作单独判断授权和恢复方式。
5. 交付时逐个能力 ID 和证据层报告结果、最终恢复状态和未验证范围；用户可见能力或回归范围改变时同步更新产品地图。

## 标准命令

```powershell
npm install
npm run verify
npm test
npm run typecheck
npm run check:unused
npm run test:ui
npm run test:docs
npm run check:docs
npm run check:react
npm run android
npm run release:android
npm run smoke:android
npm run test:device
npm run test:device:logged-out
```

`npm run verify` 是确定性门禁，统一包含 Vitest、Jest/RNTL UI、文档测试与引用、typecheck、unused 和版本一致性。`npm run test:device` 要求可信安装为 `agent-device >= 0.19.0`，并通过 `WZ_ANDROID_TEST_DEVICE` 和 `WZ_ANDROID_TEST_APK` 明确设备及目标 APK，先比对设备上实际 `base.apk` 的版本与 SHA-256，再执行 `tests/device/` Replay。单个 Replay 使用唯一 session、零重试且不自行执行 `close`，由 test harness 先停止录屏再 cleanup session；普通执行失败由外层继续其他独立文件并最终统一返回，任何录屏隔离或恢复失败则立即停止后续文件。执行前发现既有 manifest、对应 `.tmp`、工具录屏进程或 orphan scratch 时只阻断并保留现场，正式 manifest 即使为空也按文件存在视为占用；执行后仅通过 manifest 中同时匹配本条 session/device 的 session 调用 `record stop`，不终止 daemon、不 wildcard 删除设备文件、不停止 MCP，也不触碰 App 数据或用户文件。只有全部通过才输出 `DEVICE_REPLAY_PASS`。`npm run smoke:android` 默认验证 `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`；也可以直接执行 `node scripts/smoke-android.mjs <apkPath>` 验证指定 APK。它通过 `WZ_ANDROID_SMOKE_DEVICE` 明确唯一登录态设备，覆盖安装后先读取设备 epoch，再在第一次启动前写入包级日志 marker；最终通过 logcat `-T` 只读取该时间之后的有界窗口，先形成 `APK_SANITY`，再把同一 APK 交给 Replay 形成独立的 `DEVICE_REPLAY_PASS`。脚本不会自动选择其他设备，也不会卸载、清数据或清空全局 logcat。`npm run release:android` 只生成并验证正式 arm64 APK、开发签名 Smoke APK 和 manifest，不执行 Git 或 GitHub 上传；Smoke 通过后再单独发布正式 APK 与 manifest，开发签名 Smoke APK 不上传。

真实未登录旅程不在 App 内模拟。另起一个不含论坛登录数据的 AVD，设置 `WZ_ANDROID_LOGGED_OUT_DEVICE` 和同一待测 `WZ_ANDROID_TEST_APK` 后运行 `npm run test:device:logged-out`；runner 拒绝与 `WZ_ANDROID_TEST_DEVICE` / `WZ_ANDROID_SMOKE_DEVICE` 同名的设备，只执行 `tests/device-logged-out/`。允许在 App 内原站 WebView 完成访客 Cloudflare 验证，但不得登录论坛、克隆主 AVD、卸载或清除主设备数据；因此 NodeSeek 可显示“未登录”或仅访客“已验证”，两者都必须保持网站登录计数为 0 并走未登录搜索。普通 `test:device` 与 Release Smoke 均只执行 `tests/device/` 的六条旅程。

## Agent Live

- `tests/live/agent-live.md` 是唯一 Agent Live 流程，不另建功能清单、DSL 或 runner。
- 普通改动在 `verify` 与相关 Replay 后执行 `targeted`；集中修复、里程碑或发布前执行 `full`。
- 启动任务时给 Agent Profile、Git revision、App version、APK SHA、设备和能力 ID；由现有 agent-device MCP 操作，用户监督。
- 场景不 fail-fast；每项从可确认的根状态开始，只有冷启动本身是 oracle 时才 relaunch。同一次真实请求已有可用证据时不得重复请求。CF 等待用户手动完成；恢复失败时停止该来源后续写入。
- 最终按能力 ID 报告 `LIVE_PASS`、`NOT_VERIFIED`、`BLOCKED_BY_ENV` 或明确失败，以及恢复状态和残留。

## 工具进程收口

- 启动 Metro、watcher、Gradle、agent-device 或录屏前先记录匹配进程 PID；命令正常结束、失败或中断后，只终止本次新增 PID。共享 MCP、模拟器和 ADB 保持运行，除非用户明确要求关闭。
- Replay 优先走 `npm run test:device`，runner 只恢复当前唯一 session/device manifest 归属的录屏，不负责终止 daemon 或清理未知 scratch。手工 agent-device 探索结束后只关闭本次明确 session，再核对没有本次新增的工具路径 `screenrecord` 和 `agent-device-recording-*` scratch；无法证明归属的 daemon、进程或文件不强制清理并记录为阻碍。
- 本次任务启动了 Gradle daemon 且后续不再构建时，执行 `android\gradlew.bat --stop`。有意保留 Metro 或其他服务时，交付必须说明 PID、端口和保留原因。
- 最终进程数必须回到任务开始基线；无法确认归属时不强杀，记录命令行、父 PID 和阻碍。

## 检查重点

- 功能验证按 `docs/testing-standard.md` 执行；只打开 App 不算完整测试。
- 当前模拟器功能基线记录在 `docs/emulator-baseline.md`；只使用 Git revision、App 版本和 APK 身份匹配的记录，不能按日期猜测，也不能用“能打开 App”代替验收。
- NodeSeek、linux.do 和妖火 Cookie，以及小隐寺 User API Key、Client ID、nonce 和待授权状态不进入备份 JSON。
- 服务器代理配置不进入备份 JSON，只保存在 Android 安全存储。
- `android/` 是生成目录，不作为长期配置来源。
- 发布版本号以 `app.json` 和 `package*.json` 为准；versionName 相对上一正式 tag 变化时必须递增 `expo.android.versionCode`。普通无 tag checkout 只 warning，正式发布缺少完整 history/tags 时失败。
- `npm run release:android` 起始即要求 Node 22 和 clean Git tree，再校验签名环境、上一正式版本并执行 `npm run verify`；后者包含 UI 测试、文档检查、TypeScript、严格无用代码检查和版本一致性检查。Node 或工作树不符时有意阻断，不允许带本地改动生成正式产物。
- 当前 release APK 必须使用 `app.json` 内置摘要对应的正式签名；本机 `.env.release.local` 需要提供 `WZ_ANDROID_KEYSTORE_PATH`、`WZ_ANDROID_KEYSTORE_PASSWORD`、`WZ_ANDROID_KEY_ALIAS`、`WZ_ANDROID_KEY_PASSWORD`、`WZ_ANDROID_SMOKE_DEVICE` 和 `WZ_ANDROID_SMOKE_ABI=x86_64`。keystore 相对路径按仓库根解析，且必须指向普通文件。文件只解析到脚本局部 allowlist；四个签名变量会从 verify、prebuild、native tests/compile、smoke 等普通子进程环境删除，只注入最终正式 `assembleRelease` 子进程。
- `WZ_ANDROID_SMOKE_DEVICE` 可以使用 agent-device 的设备 ID、显示名或 AVD 名；AVD 名与 booted device 显示名仅允许下划线/空白等价，并且归一化后仍必须唯一匹配，不能靠部分名称自动选择设备。
- 正式 APK 不能使用 `androiddebugkey`、`debug.keystore` 或默认密码 `android`；开发签名只用于不上传的 smoke APK。
- 通过检查后，发布脚本会执行 `expo prebuild --platform android --clean --no-install`；随后以无签名环境执行 `testReleaseUnitTest` 和 `compileReleaseKotlin`，最后才在单独的签名环境打包，确保 `app.json` 的版本号和原生配置进入 APK。
- release 包应为 `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`。
- release 脚本生成 APK 后会校验签名，并打印 APK SHA-256；manifest 在既有签名、版本与 APK SHA-256 外记录 `gitSha`、`packageLockSha256`、Node/npm/Java/Gradle 版本和 built ABIs。Java 版本只取 `java -version` 输出中唯一完整的 `openjdk version "…"` 或 `java version "…"` 行；`JAVA_TOOL_OPTIONS`/`JDK_JAVA_OPTIONS` 提示不进入 manifest，零匹配或多匹配时以不回显原始输出的通用 preflight 错误停止。这些字段用于 provenance，不代表字节级可复现。发布说明只记录 APK SHA-256，不记录签名 SHA-256。
- GitHub Release 必须同时上传 `app-arm64-v8a-release.apk` 和 `release-manifest.json`；App 更新检查依赖 `release-manifest.json`。
- 首页、搜索、详情、回复和用户页的读取不应直接 import `forumApi`、`yaohuoApi` 或 `local*` 来源文件，应通过 `src/sources/sourceGateway.ts`；已有互动 action client 按触及路径逐项迁移，不改变请求格式。
- `App.tsx` 应保持入口职责，不承载 WebView、Cookie、来源读取和业务回调。
- `src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是兼容入口，不应重新塞回大段实现。
- More 页只有一个 `账号中心`：统一显示四个可登录来源的状态和当前身份；自动填入仍只服务原三站，小隐寺只提供 Device Code 授权 / 重新授权 / 撤销授权，并提供公共 `刷新账号状态`；App 内没有伪匿名测试入口，代理、诊断、备份和外观保持独立。
- More 页 `服务器代理` 支持 HTTP / SOCKS5；启用失败时网络请求不应静默直连。
- WebView localhost relay 只允许 HTTP 80 与 HTTPS CONNECT 443，并固定连接、header 与共享双向 idle deadline 上限；任一方向读到字节都会续期，只有整个 tunnel 双向静默才超时。connection worker 必须用剩余 deadline 等待 copy task，阻塞写到期后由关闭双方 socket 解开；`Socket.soTimeout` 只唤醒读侧。非 CONNECT HTTP 必须只转发首个、由唯一 `Content-Length` 定长的 request body，拒绝 `Transfer-Encoding`、歧义长度、非标准 numeric IPv4 和 IPv4-compatible/mapped IPv6，且不得复用 client socket 透传后续请求。普通 `ServerSocket` 不能可靠证明 caller UID，因此同设备恶意 App 与 hostname DNS rebinding 仍是明确残余风险，不得把随机端口或 timeout 宣称为同-App认证。验证只连接测试进程内 fake upstream；禁止端口扫描、跨 App 探测与公网代理压测。
- 账号状态刷新由 `src/app/useAccountStatusController.ts` 提供，备份 I/O 由 `src/app/useBackupStatusController.ts` 提供；启动后由 `AppRoot` 静默刷新一次，进入 More 页本身不应触发刷新。
- 模拟器验证最新代码时禁止使用 `adb uninstall`、`adb shell pm clear`、清空模拟器数据或重置 emulator。
- 保留登录态的模拟器禁止运行 Gradle `connectedDebugAndroidTest`：该任务结束时会卸载 target Debug App。原生 instrumentation 只能在一次性空白 AVD 上运行，或手工覆盖安装 target/test APK 后执行 runner，并且只卸载 test package。
- 默认使用覆盖安装、重启 Metro、`adb shell am force-stop com.wz.reader` 和重新启动 App；这样不会清掉既有登录态。

## Android 验证

- 改动前先在 `docs/product-map.md` 选择能力 ID，再到 `docs/testing-standard.md` 找到对应功能标准；交付时按 ID 说明执行过的自动测试和模拟器验收，无法验证的范围必须写清楚。
- 需要模拟器验收时，只对照 Git revision、App 版本和 APK 身份匹配的 `docs/emulator-baseline.md` 记录；登录 / 验证网页必须从 App 内账号入口打开，不用 Chrome 代替。
- 涉及首页、搜索、收藏、用户页长列表或详情图片 cache 时，运行相关体验 / 性能测试和 `npm run typecheck`；图片 cache 另执行 `src/originalImageLoading.test.ts`、`src/compatibleImageSources.test.ts`、`src/app/useHtmlRenderingController.test.tsx` 与 `npm run check:react`。
- 涉及首页来源、分类、单站排序或分页缓存时，至少运行 `npm test -- src/feedLogic.test.ts src/feedCategoryRail.test.ts src/forumApi.test.ts src/localSources.test.ts` 和 `npm run typecheck`，并在模拟器检查对应单站筛选。
- 涉及登录、验证、Cookie、写操作、详情返回或来源解析时，运行相关来源 / 安全 / 体验测试和 `npm run typecheck`。
- 涉及来源 gateway 时，至少运行 `npm test -- src/forumApi.test.ts src/localSources.test.ts src/sources/sourceGateway.test.ts src/sources/sourceGatewayContract.test.ts` 和 `npm run typecheck`。
- 涉及账号区时，至少运行账号中心、会话、凭据仓库、登录表单 adapter、小隐寺 Device Code 和来源测试及 `npm run typecheck`；统一 UI 位于 `src/screens/more/AccountCenterPanel.tsx`，视图规则位于 `src/screens/more/accountCenter.ts`，原三站凭据和填入边界位于 `src/credentialVault.ts`、`src/loginFormAdapters.ts`，小隐寺授权边界位于 `src/xiaoyinsiAuth.ts`。
- 改 `plugins/withXiaoyinsiAuthModule.js` 或 `app.json` 的小隐寺 plugin / SecureStore 配置后，至少运行 Expo config、clean prebuild 和 Android debug 构建，确认生成的 Keystore module、MainApplication 注册和备份排除规则可编译；正式发布仍只在明确发布任务中运行 `npm run release:android`。
- 涉及服务器代理时，至少运行 `npm test -- src/networkProxy.test.ts src/networkProxyControllerGuard.test.ts src/networkProxyModalGuard.test.ts src/webViewProxyGuard.test.ts src/appUpdateProxyGuard.test.ts src/releasePackaging.test.ts`、`npm run test:ui -- tests/ui/network-proxy-modal.test.tsx` 和 `npm run typecheck`。改 `plugins/withNetworkProxyModule.js` 后必须 fresh `npx expo prebuild --platform android --clean --no-install`，再从 `android/` 运行 `gradlew :app:testReleaseUnitTest :app:compileReleaseKotlin --no-daemon`；正式发布仍运行 `npm run release:android`。
- 涉及主题或详情页拆分时，至少运行 `npm test -- src/theme.test.ts src/topicDerivedData.test.ts src/topicContentSplit.test.ts src/topicContentHtml.test.ts src/topicListItemState.test.ts src/topicSessionState.test.ts` 和 `npm run typecheck`，并在模拟器上验证外观设置与详情页打开 / 返回。
- 发布前运行 `npm run release:android`；它已经包含 `npm run verify`、APK 签名校验、只读设备 smoke 和 SHA-256 输出。

### 直接打开主题链接

用户给出 NodeSeek、linux.do、V2EX、妖火或小隐寺主题 URL 并要求查看、验证或排障时，URL 本身就是目标，不是搜索词：

1. 用 `src/appUtils.ts` 的 `parseForumTopicLink` 规则解析来源和主题 id，并使用解析结果中的规范化 URL。
2. 确认模拟器中的 `com.wz.reader` 已运行当前代码；优先调用 agent-device `open`，传入 `app=com.wz.reader` 和 `url=exp+wz-android://open-topic?url=<encoded canonical URL>`。
3. agent-device 不可用时使用以下 ADB 等价路径：

```powershell
$topicUrl = [uri]::EscapeDataString('https://linux.do/t/123456')
adb shell am start -W -a android.intent.action.VIEW -d "exp+wz-android://open-topic?url=$topicUrl" com.wz.reader
```

4. 在 App 内确认详情页的来源、标题和正文已加载。直达失败时检查当前 bundle、deep link 和详情请求并报告阻碍；不得静默改走站内或网页搜索。

## 发布批次与闸门

- 普通版本聚合几个小功能或 bug 后发布；崩溃、数据或隐私风险、核心来源不可用才单独 hotfix。
- 发布候选先用当前开发包在主设备跑六条普通 Replay，并在隔离 AVD 跑一条真实未登录 Replay；再依次通过 `npm run verify`、正式签名构建与 signer 校验，并由同代码的开发签名 x86_64 Release APK 在唯一登录态设备上完成 APK sanity 与六条普通 Replay；最后按授权执行 `full` Agent Live。
- `npm run smoke:android` 使用覆盖安装保留 App 数据；其 Smoke 部分在覆盖安装后先读取设备 epoch、再于第一次启动前写入唯一 logcat marker，通过 `logcat -T` 有界读取该时间之后的日志并以包名/PID 裁剪首次启动窗口，只检查 `main-tab-feed`、前台包名及崩溃、ANR、RedBox，输出 `APK_SANITY`。它不清空全局 logcat。Feed/Search/Library/账号与 tracked 来源旅程由 `.ad` 执行并单独输出 `DEVICE_REPLAY_PASS`；任一证据失败都不能宣称完整通过。
- Replay 只证明当前请求 outcome 和 App-owned 流程，不证明实时来源当天有数据；本批次触及某个来源时，再按 `docs/testing-standard.md` 由唯一 Agent Live probe owner 核实数据与关键字段。
- smoke 不执行回复、编辑、删除、上传、点赞、投票、收藏切换、清除登录或其他真实写操作。
- smoke 通过后才上传 `app-arm64-v8a-release.apk` 与 `release-manifest.json`；发布说明记录 APK SHA-256，不记录签名 SHA-256。

## 模拟器最新代码验证

允许命令：

```powershell
adb devices
npx expo start --dev-client --clear --port 8081
npx expo run:android --no-bundler --app-id com.wz.reader --no-build-cache
adb shell am force-stop com.wz.reader
adb shell monkey -p com.wz.reader -c android.intent.category.LAUNCHER 1
```

禁止命令：

```powershell
adb uninstall com.wz.reader
adb shell pm clear com.wz.reader
```
