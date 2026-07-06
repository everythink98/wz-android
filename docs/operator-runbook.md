# 维护手册

## 标准命令

```powershell
npm install
npm test
npm run typecheck
npm run android
npm run release:android
```

## 检查重点

- 功能验证按 `docs/testing-standard.md` 执行；只打开 App 不算完整测试。
- 当前模拟器功能基线记录在 `docs/emulator-baseline.md`；优化代码前后按基线对照，不能用“能打开 App”代替验收。
- NodeSeek、linux.do 和妖火 Cookie 不进入备份 JSON。
- `android/` 是生成目录，不作为长期配置来源。
- 发布版本号以 `app.json` 和 `package*.json` 为准；每次发布递增 `expo.android.versionCode`。
- `npm run release:android` 会先执行测试、严格无用代码检查和版本一致性检查；严格检查已包含 TypeScript 编译检查。
- 当前 release APK 必须使用正式签名；本机 `.env.release.local` 需要提供 `WZ_ANDROID_KEYSTORE_PATH`、`WZ_ANDROID_KEYSTORE_PASSWORD`、`WZ_ANDROID_KEY_ALIAS`、`WZ_ANDROID_KEY_PASSWORD`。
- 正式发布不能使用 `androiddebugkey`、`debug.keystore` 或默认密码 `android`。
- 通过检查后，发布脚本会执行 `expo prebuild --platform android --clean`，再打包，确保 `app.json` 的版本号和原生配置进入 APK。
- release 包应为 `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`。
- release 脚本生成 APK 后会校验签名，并打印 APK SHA-256；发布说明只记录 APK SHA-256，不记录签名 SHA-256。
- GitHub Release 必须同时上传 `app-arm64-v8a-release.apk` 和 `release-manifest.json`；App 更新检查依赖 `release-manifest.json`。
- 首页、搜索、详情、回复、用户页和详情互动不应直接 import `forumApi`、`yaohuoApi`、`local*` 来源文件或站点 action client，应通过 `src/sources/sourceGateway.ts`。
- `App.tsx` 应保持入口职责，不承载 WebView、Cookie、来源读取和业务回调。
- `src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是兼容入口，不应重新塞回大段实现。
- More 页 `个人中心` 显示当前账号主页并提供 `刷新账号状态`；`账号与验证` 只保留登录、验证、清除登录、NodeImage 和 linux.do 等级相关入口。
- 账号状态刷新由 `src/app/useBackupStatusController.ts` 提供，启动后由 `src/app/AppRoot.tsx` 静默刷新一次；进入 More 页本身不应触发刷新。
- 模拟器验证最新代码时禁止使用 `adb uninstall`、`adb shell pm clear`、清空模拟器数据或重置 emulator。
- 默认使用覆盖安装、重启 Metro、`adb shell am force-stop com.wz.reader` 和重新启动 App；这样不会清掉既有登录态。

## Android 验证

- 改动前先在 `docs/testing-standard.md` 找到对应功能标准；交付时说明执行过的自动测试和模拟器验收，无法验证的范围必须写清楚。
- 需要模拟器验收时，对照 `docs/emulator-baseline.md` 记录同条件差异；登录 / 验证网页必须从 App 内账号入口打开，不用 Chrome 代替。
- 涉及首页、搜索、收藏和用户页长列表时，运行相关体验 / 性能测试和 `npm run typecheck`。
- 涉及登录、验证、Cookie、写操作、详情返回或来源解析时，运行相关来源 / 安全 / 体验测试和 `npm run typecheck`。
- 涉及来源 gateway 时，至少运行 `npm test -- src/forumApi.test.ts src/localSources.test.ts` 和 `npm run typecheck`。
- 涉及账号区时，至少运行相关账号、会话、来源测试和 `npm run typecheck`；当前账号 UI 位于 `src/screens/MoreScreen.tsx` 与 `src/screens/more/personalCenterItems.ts`，登录 / 验证 UI 位于 `src/screens/more/MorePanels.tsx`。
- 涉及主题或详情页拆分时，至少运行 `npm test -- src/theme.test.ts src/topicDerivedData.test.ts src/topicContentSplit.test.ts src/topicContentHtml.test.ts src/topicListItemState.test.ts src/topicSessionState.test.ts` 和 `npm run typecheck`，并在模拟器上验证外观设置与详情页打开 / 返回。
- 发布前运行 `npm run release:android`；它已经包含 `npm test`、`npm run check:unused`、版本一致性检查、APK 签名校验和 SHA-256 输出。

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
