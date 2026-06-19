<p align="center">
  <img src="assets/icon.png" width="96" alt="阅坛 Android icon" />
</p>

<h1 align="center">阅坛 Android</h1>

<p align="center">
  一个面向多个网站的第三方 Android 客户端。
</p>

<p align="center">
  <a href="https://github.com/everythink98/wz-android/releases/latest/download/app-arm64-v8a-release.apk">
    <img alt="下载最新版 APK" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD_APK-%E6%9C%80%E6%96%B0%E7%89%88-2ea44f?style=for-the-badge&logo=android&logoColor=white" />
  </a>
  <a href="https://github.com/everythink98/wz-android/releases/latest">
    <img alt="查看 Releases" src="https://img.shields.io/badge/GitHub_Releases-%E6%9F%A5%E7%9C%8B-0969da?style=for-the-badge&logo=github&logoColor=white" />
  </a>
</p>

## 这是什么

阅坛 Android 是一个面向多个网站的第三方 Android 客户端，支持 NodeSeek、linux.do、V2EX 和妖火。

## 主要功能

- 多网站首页、分类、搜索、详情和用户主页。
- 主题详情、回复列表、楼层回复和图片预览。
- NodeSeek 点赞、反对、加鸡腿、原站收藏、签到和投票。
- linux.do 回复、点赞、原站收藏、投票和等级查看。
- 妖火登录后浏览、搜索、回复、楼层回复、原站收藏和投票。
- V2EX 公开内容浏览、搜索、用户主页和只读互动信息展示。
- 本机收藏、关注用户、历史和备份 / 恢复。

## 下载

从 GitHub Releases 下载最新版 APK：

**[下载阅坛 Android APK](https://github.com/everythink98/wz-android/releases/latest/download/app-arm64-v8a-release.apk)**

当前版本为 `1.3.10`，Android `versionCode` 为 `14`，发布包为 Android arm64-v8a APK。首次安装第三方 APK 时，Android 可能会要求允许“安装未知应用”。

## 隐私与数据

- App 不上传 Cookie 或本机资料。
- NodeSeek、linux.do 和妖火 Cookie 只保存在 Android 本机安全存储中。
- 本机资料保存在 `AsyncStorage`，通过当前版本 JSON 备份 / 恢复。
- 备份 JSON 不保存 Cookie、token、password、session、sid、csrf 等敏感字段。

## 开发

```powershell
npm install
npm test
npm run typecheck
npm run android
npm run release:android
```

`npm run android` 需要 Expo development build，不能用 Expo Go 验证。需要 Android Studio 提供 Android SDK / 模拟器，或准备一台已开启 USB 调试的 Android 手机。

`npm run release:android` 会在 `android/app/build/outputs/apk/release/` 生成 `app-arm64-v8a-release.apk`。当前发布包默认使用生成目录里的 Android debug key 签名；如需改用正式签名，只通过本机环境变量或 Gradle 属性提供，不提交 keystore 或明文密码。
