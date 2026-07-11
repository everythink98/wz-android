# 维护手册

## 事实源

- 产品取舍以 `docs/product-charter.md` 为准，结构和数据边界以 `docs/architecture.md` 为准。
- 功能验收以 `docs/testing-standard.md` 为准；本机模拟器的可变基线记录在 `docs/emulator-baseline.md`，不进入 Git。
- 当前版本从 `package.json` 与 `app.json` 读取，不在本手册重复维护。

## 标准命令

```powershell
npm install
npm test
npm run typecheck
npm run check:unused
node scripts/check-docs.mjs
npm run android
npm run release:android
npm run smoke:android
```

`npm run smoke:android` 默认验证 `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`；也可以直接执行 `node scripts/smoke-android.mjs <apkPath>` 验证指定 APK。它要求本机已有 `agent-device >= 0.14.0`，并且必须通过 `WZ_ANDROID_SMOKE_DEVICE` 明确指定唯一的登录态设备；脚本不会自动选择其他设备。`npm run release:android` 先生成正式签名的 arm64 APK，再把同一份 x86_64 Release 代码另存为开发签名 smoke APK；正式上传仍只使用 arm64 APK 和 manifest，smoke APK 不上传。

## 检查重点

- 功能验证按 `docs/testing-standard.md` 执行；只打开 App 不算完整测试。
- 当前模拟器功能基线记录在 `docs/emulator-baseline.md`；优化代码前后按基线对照，不能用“能打开 App”代替验收。
- NodeSeek、linux.do 和妖火 Cookie 不进入备份 JSON。
- 服务器代理配置不进入备份 JSON，只保存在 Android 安全存储。
- `android/` 是生成目录，不作为长期配置来源。
- 发布版本号以 `app.json` 和 `package*.json` 为准；每次发布递增 `expo.android.versionCode`。
- `npm run release:android` 会先执行测试、严格无用代码检查和版本一致性检查；严格检查已包含 TypeScript 编译检查。
- 当前 release APK 必须使用正式签名；本机 `.env.release.local` 需要提供 `WZ_ANDROID_KEYSTORE_PATH`、`WZ_ANDROID_KEYSTORE_PASSWORD`、`WZ_ANDROID_KEY_ALIAS`、`WZ_ANDROID_KEY_PASSWORD`、`WZ_ANDROID_SMOKE_DEVICE` 和 `WZ_ANDROID_SMOKE_ABI=x86_64`。
- 正式 APK 不能使用 `androiddebugkey`、`debug.keystore` 或默认密码 `android`；开发签名只用于不上传的 smoke APK。
- 通过检查后，发布脚本会执行 `expo prebuild --platform android --clean`，再打包，确保 `app.json` 的版本号和原生配置进入 APK。
- release 包应为 `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`。
- release 脚本生成 APK 后会校验签名，并打印 APK SHA-256；发布说明只记录 APK SHA-256，不记录签名 SHA-256。
- GitHub Release 必须同时上传 `app-arm64-v8a-release.apk` 和 `release-manifest.json`；App 更新检查依赖 `release-manifest.json`。
- 首页、搜索、详情、回复和用户页的读取不应直接 import `forumApi`、`yaohuoApi` 或 `local*` 来源文件，应通过 `src/sources/sourceGateway.ts`；已有互动 action client 按触及路径逐项迁移，不改变请求格式。
- `App.tsx` 应保持入口职责，不承载 WebView、Cookie、来源读取和业务回调。
- `src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是兼容入口，不应重新塞回大段实现。
- More 页只有一个 `账号中心`：统一显示三站网站登录态、当前身份、自动填入状态（本机保存账号密码）和原有站点服务，并提供 `刷新账号状态`；测试工具、代理、诊断、备份和外观保持独立。
- More 页 `服务器代理` 支持 HTTP / SOCKS5；启用失败时网络请求不应静默直连。
- 账号状态刷新由 `src/app/useAccountStatusController.ts` 提供，备份 I/O 由 `src/app/useBackupStatusController.ts` 提供；启动后由 `AppRoot` 静默刷新一次，进入 More 页本身不应触发刷新。
- 模拟器验证最新代码时禁止使用 `adb uninstall`、`adb shell pm clear`、清空模拟器数据或重置 emulator。
- 默认使用覆盖安装、重启 Metro、`adb shell am force-stop com.wz.reader` 和重新启动 App；这样不会清掉既有登录态。

## Android 验证

- 改动前先在 `docs/testing-standard.md` 找到对应功能标准；交付时说明执行过的自动测试和模拟器验收，无法验证的范围必须写清楚。
- 需要模拟器验收时，对照 `docs/emulator-baseline.md` 记录同条件差异；登录 / 验证网页必须从 App 内账号入口打开，不用 Chrome 代替。
- 涉及首页、搜索、收藏和用户页长列表时，运行相关体验 / 性能测试和 `npm run typecheck`。
- 涉及首页来源、分类、单站排序或分页缓存时，至少运行 `npm test -- src/feedLogic.test.ts src/feedCategoryRail.test.ts src/forumApi.test.ts src/localSources.test.ts` 和 `npm run typecheck`，并在模拟器检查对应单站筛选。
- 涉及登录、验证、Cookie、写操作、详情返回或来源解析时，运行相关来源 / 安全 / 体验测试和 `npm run typecheck`。
- 涉及来源 gateway 时，至少运行 `npm test -- src/forumApi.test.ts src/localSources.test.ts src/sources/sourceGateway.test.ts src/sources/sourceGatewayContract.test.ts` 和 `npm run typecheck`。
- 涉及账号区时，至少运行账号中心、会话、凭据仓库、登录表单 adapter 和来源测试及 `npm run typecheck`；统一 UI 位于 `src/screens/more/AccountCenterPanel.tsx`，视图规则位于 `src/screens/more/accountCenter.ts`，凭据和填入边界位于 `src/credentialVault.ts`、`src/loginFormAdapters.ts`。
- 涉及服务器代理时，至少运行 `npm test -- src/networkProxy.test.ts src/networkProxyControllerGuard.test.ts src/networkProxyModalGuard.test.ts src/webViewProxyGuard.test.ts src/appUpdateProxyGuard.test.ts src/releasePackaging.test.ts` 和 `npm run typecheck`；改 `plugins/withNetworkProxyModule.js` 后发布前必须跑 `npm run release:android`。
- 涉及主题或详情页拆分时，至少运行 `npm test -- src/theme.test.ts src/topicDerivedData.test.ts src/topicContentSplit.test.ts src/topicContentHtml.test.ts src/topicListItemState.test.ts src/topicSessionState.test.ts` 和 `npm run typecheck`，并在模拟器上验证外观设置与详情页打开 / 返回。
- 发布前运行 `npm run release:android`；它已经包含 `npm test`、文档检查、`npm run check:unused`、版本一致性、APK 签名校验、只读设备 smoke 和 SHA-256 输出。

## 发布批次与闸门

- 普通版本聚合几个小功能或 bug 后发布；崩溃、数据或隐私风险、核心来源不可用才单独 hotfix。
- 发布候选依次通过文档引用检查、完整自动测试、typecheck、unused、版本一致性、正式签名构建与 signer 校验，再由同代码的开发签名 x86_64 APK 在唯一登录态设备上完成只读 smoke。
- `npm run smoke:android` 使用覆盖安装保留 App 数据，检查冷启动、四个底部 Tab、Tab 重选、首页和 More 页；严格完成 `搜索 → 详情 → 作者用户页 → 用户主题嵌套详情 → 原路返回搜索` 与 `收藏 → 详情 → 作者用户页 → 原路返回收藏`，并检查崩溃、ANR 和 RedBox 迹象。搜索无结果、用户页无可打开主题或本机没有预留收藏基线都会使 smoke 失败，不会降级为跳过。
- 实时来源只断言关键字段存在且结果可打开，不固定结果数量；本批次触及某个来源时，再按 `docs/testing-standard.md` 做该来源的登录态或原站专项验收。
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
