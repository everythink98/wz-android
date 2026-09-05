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

主登录态 AVD 保存 App 数据、WebView Cookie、SecureStore 与 Quick Boot 状态。设备安全边界以仓库根目录 `AGENTS.md` 为准；下面只列操作入口。

### 行内附件 Native 验证

行内附件的 Android 尺寸换算可独立验证，不连接设备：

```powershell
cd android
.\gradlew.bat :react-native:packages:react-native:ReactAndroid:testDebugUnitTest --tests com.facebook.react.views.text.TextLayoutManagerInlineViewSizeTest --no-daemon
```

真实 Fabric 换行另用独立开发入口 `dev/inline-layout-proof/index.tsx`。在已有 Metro 的端口上，用 development-client URL 打开 `http://127.0.0.1:<port>/dev/inline-layout-proof/index.bundle?platform=android&dev=true&minify=false`。页面直接测量 Text 和嵌入 View；五个结果都必须为 PASS，大图相对行首偏移及右侧越界均不得超过 `1px`，小图继续留在文字后面。它不依赖 HTML、网络图片或生产账号，不以 RNTL mock 代替原生排版。

尺寸矩阵使用同一保留数据 AVD：`1264×2780 / 560dpi`、`1265×2780 / 560dpi` 和设备原参数，并覆盖 `font_scale=0.9/1.0`。修改前读取 `wm size`、`wm density`、`settings get system font_scale`，结束恢复；用户明确要求保留可见验收画面时，保留对应窗口、参数和必要调试服务并在交付中列明。原帖最终验收仍需匹配 APK、自然尺寸加载、滚离回收后返回和预览返回证据。

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

用户当次明确授权特殊发布、并且受影响能力及共享 seam 的定向回归已完成时，可执行 `npm run release:android -- --skip-verify --replay-directory <专项目录>`。`--skip-verify` 跳过脚本内的全量 `npm run verify`；`--replay-directory` 将 Smoke 后的默认设备 Replay 批次替换为指定目录中的 `.ad` 文件，仍先执行覆盖安装、首次安装时间与 APK_SANITY 检查。版本、clean-tree、prebuild、原生测试/编译和签名校验仍执行；manifest 的 `verificationScope` 记为 `targeted`，默认发布记为 `full`。未指定 Replay 目录时仍使用 `tests/device`，不能假定 `--skip-verify` 同时跳过默认 Replay。本次 Feed 专项可用 `tests/live`，其中来源重排要求 V2EX、linux.do 已启用且排在前两项，并按脚本说明恢复偏好。发布说明必须列出实际通过的范围与未验证范围，不能沿用历史全量通过结论。GitHub push 仍按现有 CI 独立运行，不因本机特殊发布关闭 CI。

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
