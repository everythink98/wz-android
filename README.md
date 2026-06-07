# 阅坛 Android

无后端的多论坛第三方 Android 客户端。App 由手机本机直连 NodeSeek、linux.do、V2EX 和妖火，并在手机本机保存登录 Cookie、本机收藏、关注用户、历史、阅读进度和备份资料。

## 开发命令

```powershell
npm install
npm test
npm run typecheck
npm run android
npm run release:android
```

`npm run android` 需要 Expo development build，不能用 Expo Go 验证。需要 Android Studio 提供 Android SDK / 模拟器，或准备一台已开启 USB 调试的 Android 手机。

## 使用范围

- NodeSeek：阅读、搜索、用户主页、回复、楼层回复、点赞、反对、加鸡腿、原站收藏、签到和投票。
- linux.do：阅读、搜索、用户主页、回复、点赞、原站收藏、投票和等级查看。
- 妖火：登录后阅读、搜索、用户主页、回复、楼层回复、原站收藏和投票。
- V2EX：公开阅读、搜索、用户主页和只读互动信息展示。

App 不依赖本地 Web+Server 项目，不填写服务器地址或同步码，不做跨站平台、全网索引或跨站身份合并。

## 数据与安全

- NodeSeek、linux.do 和妖火 Cookie 只保存在 Android 本机安全存储中。
- 本机资料保存在 `AsyncStorage`，通过“备份 / 恢复”导出当前版本 JSON。
- 备份 JSON 不保存 Cookie、token、password、session、sid、csrf 等敏感字段。
- `android/` 是 Expo 生成目录，不作为长期配置来源；原生配置通过 `plugins/` 中的 config plugin 持久化。

## Release

```powershell
npm run release:android
```

该命令在 `android/app/build/outputs/apk/release/` 生成 `app-arm64-v8a-release.apk`。正式签名只通过本机环境变量或 Gradle 属性提供，不提交 keystore 或明文密码。
