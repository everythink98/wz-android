# 维护手册

本手册只维护可执行操作。产品契约、能力 ID 和共享 seam 见 [产品地图](product-map.md)，历史 oracle 见 [回归语料库](regression-corpus.md)，证据层与授权规则见 [测试标准](testing-standard.md)，代码边界见 [代码规范](code-standards.md) 与 [架构说明](architecture.md)。当前版本始终从 `package.json` 和 `app.json` 读取。

## 开发与交付

1. 产品/runtime 改动在产品地图选择直接影响的能力 ID并展开共享 seam；纯测试、文档或治理改动记录 evidence owner。
2. 只有改动命中已知事故 seam 时才查回归语料库；当前必跑项以 product map 的 canonical evidence 与测试标准为准。
3. 记录 Git revision 与 dirty 状态，完成最小完整改动。
4. 按测试标准运行最低可靠证据；涉及设备、真实来源或写操作时遵守相应授权边界。
5. 交付时按能力 ID 报告证据层、恢复状态和未验证范围。

## 标准命令

```powershell
npm install
npm run verify
npm test
npm run test:ui
npm run test:docs
npm run check:docs
npm run typecheck
npm run check:architecture
npm run test:architecture
npm run visual:gallery
npm run check:react
npm run android
npm run test:device
npm run test:device:logged-out
npm run test:native:forum-selection
npm run test:instrumented:forum-selection
npm run smoke:android
npm run release:android
```

`npm run verify` 是随机顺序总门禁，具体组合始终以 `package.json` 为准。Vitest 与 Jest 会输出可重放 seed；局部开发可先运行受影响测试，交付前仍按改动风险补齐门禁。

### 可视状态语料库

使用当前 debug/dev-client 构建启动独立视觉入口：

```powershell
npm run visual:gallery -- --port 8081
```

启动后用输出的 Development client URL 打开 Visual Gallery。该命令不安装 APK；需要覆盖安装时先按下文校验包名、签名、版本和 `firstInstallTime`。Gallery 只挂生产组件与确定性 mock，JS 网络默认阻断；它可用于搜索能力、切换场景、浅/深主题、字号和密度，但不授权真实写操作，也不能代替真实来源、系统 UI、原生手势或生命周期的 Replay/Live 证据。

交付前运行 `npm run test:architecture` 和视觉 catalog 测试，确认全部 App capability 已分类、场景可双主题挂载，并且生产入口不含视觉工具。截图和人工走查报告只写入任务专用的 ignored evidence 目录，不提交账号、凭据、日志或真实内容。

## Android 覆盖安装、Replay 与 Smoke

主登录态 AVD 保存 App 数据、WebView Cookie、SecureStore 与 Quick Boot 状态。设备安全边界以仓库根目录 `AGENTS.md` 为准；下面只列操作入口。

### Forum selection Native 验证

纯 Native JVM 测试不连接设备；生成的 Android project 存在后执行：

```powershell
npm run test:native:forum-selection
```

真实长按、手柄、自动滚动、回收恢复、剪贴板与 `0px` 布局位移只在独立 verification AVD `WZ_ForumSelection_Test_API35` 执行：

```powershell
adb devices
npm run test:instrumented:forum-selection
```

runner 要求恰好一个已连接且名称精确匹配的 `WZ_ForumSelection_Test_API35`，并只用该 serial 设置 Gradle 的 `ANDROID_SERIAL`；不存在、重复或不匹配时立即失败。不得通过 `WZ_FORUM_SELECTION_TEST_AVD` 改指主登录态、Smoke、普通 Replay 或未登录 AVD，不得在这些保留数据设备上手工执行 `connectedDebugAndroidTest`。缺少独立 AVD 时报告 `BLOCKED_BY_ENV`，不卸载、不清数据、不重置主 AVD。instrumentation 结果只证明隔离 proof 场景；真实 RNRH/Fabric、FlashList、原站正文与 PSS 仍需下方匹配 APK 的只读 Live。

### 覆盖安装

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

### 证据含义

`npm run smoke:android` 在覆盖安装后的第一次启动前写入日志 marker，只检查有界启动窗口、前台包名、崩溃、ANR 与 RedBox，形成 `APK_SANITY`；随后 Replay 独立形成 `DEVICE_REPLAY_PASS`。二者都不等于真实来源当天数据或全部功能通过，也不授权任何远端写操作。

## Agent Live

`tests/live/agent-live.md` 是唯一流程。普通改动在 `verify` 与相关 Replay 后执行 `targeted`；集中修复、里程碑或发布前执行 `full`。启动时提供 Agent Profile、Git revision、App version、APK SHA、设备和能力 ID；最终按能力 ID 报告 `LIVE_PASS`、`NOT_VERIFIED`、`BLOCKED_BY_ENV` 或明确失败，以及恢复状态和残留。登录、账号授权、交互式 CAPTCHA 与远端写入仍需用户监督或另行授权。

Android 主楼正文连续选择的 targeted Live 固定展开 `TOPIC-01/02/03` 与 `NAV-02/03`，全程只读：

- 纵滚绘制 owner 的 targeted proof 只复测当前 NodeSeek `https://www.nodeseek.com/post-832584-1`：在正文执行一次静止长按进入自定义选择，禁止用双击代替；把范围拖过首段、贴纸、标题、链接和多段正文后保持选区不取消，连续三次快速下滚再上滚。录制原始分辨率画面并逐帧独立核对可见高亮、起点手柄和终点手柄；端点可见但手柄缺失直接失败，只有真实 viewport/祖先裁剪或 ActionMode 遮挡可列为 excluded。每个实测样本相对当前文字 Path/caret 的 `L∞` 误差必须 `<=2px`，并报告 eligible、measured、missing、excluded 和最坏帧；低帧率肉眼观察、滚动结束截图或坐标回调断言不能替代该证据。
- 直达 NodeSeek `https://www.nodeseek.com/post-877083-1`，先记录主楼正文、标题、表格、表后文字、Emoji 与贴纸的 bounds/baseline；在带 opening marker 的主楼正文双击，确认不出现原生局部高亮、手柄或系统 ActionMode，再以静止长按进入自定义选择。跨至少三个 viewport 并触发至少一次 cell recycle；每次滚动后确认高亮和手柄仍贴合当前文字、旧屏幕位置无 overlay 残影，回收/layout commit 中即使某帧暂时没有可绘制映射也不得取消逻辑选区或 ActionMode，稳定帧必须恢复可见 overlay。再拖过“正文 → 标题 → 表格 → 表后文字”后复制，核对段落换行、table tab/newline 和媒体标签的原文顺序。如主楼存在展开引用/details、签名或 terminal Tab，还要确认当前实际显示的分支进入同一 manifest，折叠内容不进入。选择中与取消后重复记录，所有上述位置相对选择前必须为 `0px` 位移。
- 同帖慢横拖 table/code、纵向滚动、普通链接点击、Back 与取消选区保持既有行为；活动选区上普通短按正文或空白必须在原点击分发后取消，超过 touch slop 的纵滚必须保留选区且首个 draw frame 就让 overlay 贴住文字。普通链接 tap 必须直接进入既有目标并结束旧选区，不得被 coordinator 延迟或吞掉。横滑接管后不得残留放大镜、手柄或 ActionMode。
- 直达 NodeSeek `https://www.nodeseek.com/post-652056-1`，保持主楼与至少一条回复同时挂载：主楼表格必须仍能静止长按进入连续选择；回复 row 必须零 opening marker、不能进入主楼 manifest 或 Native 映射，长按回复只执行独立的原有整条复制并核对剪贴板，不出现主楼 coordinator 的手柄/ActionMode。对当前实际显示的评论和已采纳答案逐项重复该负向 marker 验收；当前真实对象不具备某一类型时该分支记 `NOT_VERIFIED`，不用普通回复冒充。
- 直达 NodeSeek `https://www.nodeseek.com/post-863650-1`，分别在选择前、选择中和取消后记录父 FlashList row、mounted media、warm/running/original 高水位、PID 与 PSS；选择不得增加 row/media 挂载，继续满足每 row `<=4`、warm `<=8`、running `<=4`、original `<=1` 及既有 `+150MB` PSS 峰值门槛，同一 PID 连续两轮相同滚动后 PSS 不得持续增长。

主楼双击出现任何局部选区、静止长按未进入自定义选择、滚动后 overlay 与当前文字错位或留下旧屏残影、可见端点缺少对应手柄、瞬态映射缺失取消逻辑选区、回复/评论/采纳答案出现 opening marker 或参与主楼 manifest，以及空白/重复 row 或 marker、无效 tape、revision 复用、稳定帧仍无法映射当前端点等结构性失败，连同整条长按复制退化、主楼复制顺序错误、位置变化、额外挂载、ANR/OOM/Fatal 或 PID 意外重启都记为明确失败。只有端点文字本身未挂载或被真实 viewport/祖先裁剪时，单个瞬态帧才可跳过当帧命中或绘制并等待稳定映射；文字端点已经可见却缺少手柄仍直接失败。外部内容变化或独立 AVD/主 AVD 不可用记 `BLOCKED_BY_ENV` 或 `NOT_VERIFIED`，不能用局部单测或 App 启动替代。`REG-TOPIC-100` 在上述主楼正向、回复/评论/采纳答案负向、回收、布局和性能 Live 分支全部取得 `LIVE_PASS` 前不得记为 `RESOLVED`。

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

发布前准备 Node 22、完整 Git history/tags、clean working tree、本机 `agent-device >= 0.19.0`，以及不进入 Git 的 `.env.release.local`。至少配置：

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

预期产物：

- `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`：正式上传包。
- `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`：仅用于本机 Smoke，不上传。
- `release-manifest.json`：与正式 APK 一同上传，供更新检查和 provenance 使用。

脚本不执行 Git commit、tag 或 GitHub 上传。Smoke 和 Replay 通过后，发布 `app-arm64-v8a-release.apk` 与 `release-manifest.json`；发布说明记录正式 APK SHA-256。不要提交或输出 keystore、`.env.release.local`、密码或 token。

## 工具进程收口

- 启动 Metro、watcher、Gradle、agent-device 或录屏前记录 PID 基线；结束时只处理本任务新增且可确认归属的进程。
- Replay 由 runner 清理自己的 session；手工探索只关闭本次 session。共享 MCP、模拟器与 ADB 不关闭，未知 scratch 不删除。
- 本任务启动了 Gradle daemon 且不再构建时，可执行 `android\gradlew.bat --stop`；有意保留服务时报告 PID、端口和原因。
- 无法确认归属的进程或文件不强制清理，交付时列为残留。
