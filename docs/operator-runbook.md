# 维护手册

本手册只维护可执行操作。产品契约、能力 ID 和共享 seam 见 [产品地图](product-map.md)，历史 oracle 见 [回归语料库](regression-corpus.md)，证据层与授权规则见 [测试标准](testing-standard.md)，代码边界见 [代码规范](code-standards.md) 与 [架构说明](architecture.md)。当前版本始终从 `package.json` 和 `app.json` 读取。

## 开发与交付

1. 在产品地图选择直接影响的能力 ID；触及共享 seam 时展开关联 ID。
2. 按能力 ID 检索回归语料库，把命中的精确 oracle 纳入必跑项。
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
npm run check:react
npm run android
npm run test:device
npm run test:device:logged-out
npm run smoke:android
npm run release:android
```

`npm run verify` 是确定性总门禁，包含 lint、format check、架构检查与测试、Vitest、Jest/RNTL、文档检查、typecheck、unused 和版本一致性检查。局部开发可先运行受影响测试，交付前仍按改动风险补齐门禁。

## Android 覆盖安装、Replay 与 Smoke

主登录态 AVD 保存 App 数据、WebView Cookie、SecureStore 与 Quick Boot 状态。设备安全边界以仓库根目录 `AGENTS.md` 为准；下面只列操作入口。

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

禁止在保留数据的设备上执行 `agent-device reinstall`、`agent-device uninstall`、`adb uninstall`、`adb shell pm clear` 或 Gradle `connectedDebugAndroidTest`。覆盖安装失败就停止；不得自动改走卸载、清数据或重置模拟器。账号、本机数据或 `firstInstallTime` 异常时立即冻结设备变更，只读取证并报告。

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
