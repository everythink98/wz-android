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

- NodeSeek、linux.do 和妖火 Cookie 不进入备份 JSON。
- `android/` 是生成目录，不作为长期配置来源。
- 发布版本号以 `app.json` 和 `package*.json` 为准；每次发布递增 `expo.android.versionCode`。
- `npm run release:android` 会先执行测试、类型检查、无用代码检查和版本一致性检查。
- 当前 release APK 必须使用正式签名；本机 `.env.release.local` 需要提供 `WZ_ANDROID_KEYSTORE_PATH`、`WZ_ANDROID_KEYSTORE_PASSWORD`、`WZ_ANDROID_KEY_ALIAS`、`WZ_ANDROID_KEY_PASSWORD`。
- 正式发布不能使用 `androiddebugkey`、`debug.keystore` 或默认密码 `android`。
- 通过检查后，发布脚本会执行 `expo prebuild --platform android --clean`，再打包，确保 `app.json` 的版本号和原生配置进入 APK。
- release 包应为 `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`。
- 首页、搜索、详情、回复、用户页和详情互动不应直接 import `forumApi`、`yaohuoApi`、`local*` 来源文件或站点 action client，应通过 `src/sources/sourceGateway.ts`。
- `App.tsx` 应保持入口职责，不承载 WebView、Cookie、来源读取和业务回调。
- `src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是兼容入口，不应重新塞回大段实现。
- More 页账号与验证区在 `src/screens/MoreScreen.tsx` 和 `src/screens/more/MorePanels.tsx`，账号行为由 `src/app/useAccountController.ts` 提供。
- 模拟器验证最新代码时禁止使用 `adb uninstall`、`adb shell pm clear`、清空模拟器数据或重置 emulator。
- 默认使用覆盖安装、重启 Metro、`adb shell am force-stop com.wz.reader` 和重新启动 App；这样不会清掉既有登录态。

## Android 验证

- 涉及首页、搜索、收藏和用户页长列表时，运行相关体验 / 性能测试和 `npm run typecheck`。
- 涉及登录、验证、Cookie、写操作、详情返回或来源解析时，运行相关来源 / 安全 / 体验测试和 `npm run typecheck`。
- 涉及来源 gateway 时，至少运行 `npm test -- src/sources/sourceGateway.test.ts src/forumApi.test.ts src/localSources.test.ts` 和 `npm run typecheck`。
- 涉及账号区时，至少运行相关账号、会话、来源测试和 `npm run typecheck`；当前账号 UI 位于 `src/screens/MoreScreen.tsx` 与 `src/screens/more/MorePanels.tsx`。
- 涉及主题或详情页拆分时，至少运行 `npm test -- src/theme.test.ts src/androidArchitectureBoundaries.test.ts src/androidMatureComponents.test.ts src/androidUxUpgrade.test.ts src/appPerformance.test.ts src/appExperience.test.ts src/detailReadingLayout.test.ts` 和 `npm run typecheck`，并在模拟器上验证外观设置与详情页打开 / 返回。
- 发布前运行 `npm run release:android`；它已经包含 `npm test`、`npm run typecheck`、`npm run check:unused` 和版本一致性检查。

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
