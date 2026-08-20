<p align="center">
  <img src="assets/icon.png" width="96" alt="阅坛 Android icon" />
</p>

<h1 align="center">阅坛 Android</h1>

<p align="center">
  聚合中文社区的发现、搜索、阅读与互动。
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

阅坛 Android 是一个面向中文社区的多论坛第三方客户端。它把分散在不同论坛的发现、搜索、阅读、消息、用户资料和站内互动整合进一套一致体验，同时保留各社区自己的账号体系、权限规则和功能差异。

目前已接入 NodeSeek、linux.do、V2EX、妖火和小隐寺。这些站点是当前能力，不是产品边界；后续社区会作为独立来源接入，共享稳定的阅读与交互基础，同时隔离站点私有的登录、验证和接口逻辑。

## 核心能力

- 多来源发现：在“全部”中按自定义顺序聚合已启用社区，也可切换单站、分类和排序；支持刷新、分页及全部 / 未读 / 已读 / 收藏筛选。
- 内容源管理：在“更多”统一启停站点，并通过长按手柄拖拽全局排序；停用后首页、搜索、收藏、账号和消息入口同步隐藏，并停止 App 管理的该站读取与后台通知请求。
- 统一搜索：同时查看多站预览，或进入单站连续结果；按来源提供分类、标签、作者、时间、状态和排序等筛选，linux.do 登录后可选 AI 搜索，并保留搜索历史。
- 深度阅读：展示完整正文、回复、引用、代码、表格、图片、视频、附件、投票和站点特有格式；支持楼层定位、回复筛选、评论内查找、图片缩放预览与保存。
- 用户资料：从作者或正文链接进入用户页，查看资料、主题、回复和原站主页，并可在本机关注用户。
- 按站互动：根据原站能力和当前账号权限提供回复、楼层回复、编辑、删除、点赞或其他反应、原站收藏、投票、签到和图片上传。
- 消息与通知：统一查看 NodeSeek、linux.do、妖火和小隐寺的通知与私信，支持按站点、原站分类和未读状态筛选，并可选开启不含正文的 Android 摘要通知。
- 账号与授权：统一账号中心管理多站状态，按原站要求使用 Cookie 会话或 Device Code 授权，不把不同来源的登录态混在一起。
- 本机资料：保存收藏帖子、关注用户、阅读历史和已读状态，支持 JSON 备份与恢复，不依赖阅坛云端账号。
- 个性化与工具：支持浅色 / 深色主题、字号、字体、行距、正文宽度和列表密度，以及 HTTP/SOCKS5 代理、脱敏诊断和 App 内检查更新。

## 当前来源

以下仅概括主要差异，完整入口、权限和回归范围以 [产品地图](docs/product-map.md) 为准。

- NodeSeek：回复、楼层回复、编辑自己的回复、点赞、反对、加鸡腿、原站收藏、签到、投票和 NodeImage 图片上传。
- linux.do：回复、楼层回复、编辑/删除自己的回复、点赞、原站收藏、投票、图片上传和等级查看。
- 妖火：登录后浏览、搜索、回复、楼层回复、原站收藏、投票、删除自己的回复和图片上传。
- 小隐寺：公开浏览、搜索和用户主页；通过 Discourse Device Code 获取独立 App 授权，系统浏览器只承载一次性授权确认；授权后支持等级进度与活跃数据、回复、编辑/删除、点赞、原站书签、投票和图片上传。
- V2EX：公开内容浏览、搜索、用户主页和只读互动信息展示。

## 下载

从 GitHub Releases 下载最新版 APK：

**[下载阅坛 Android APK](https://github.com/everythink98/wz-android/releases/latest/download/app-arm64-v8a-release.apk)**

当前版本号和 Android `versionCode` 以 `package.json` 与 `app.json` 为准，发布包为 Android arm64-v8a APK。首次安装第三方 APK 时，Android 可能会要求允许“安装未知应用”。

## 隐私与数据

- Cookie 和本机资料不上传到阅坛自有服务；认证材料只用于对应原站、NodeImage 或用户配置代理的请求，不进入阅坛自有服务。
- NodeSeek、linux.do 和妖火 Cookie 由网站 WebView 与 Android `CookieManager` 持有，不复制到 SecureStore、ReaderData 或备份。
- 小隐寺 User API Key 与安装级 Client ID、保存的账号密码和服务器代理配置使用 Android SecureStore；小隐寺 RSA 私钥只存在 Android Keystore。
- 小隐寺授权材料不进入 Cookie、诊断日志或备份。
- 本机资料保存在 `AsyncStorage`，通过当前版本 JSON 备份 / 恢复。
- 备份 JSON 不保存 Cookie、token、password、session、sid、csrf、proxy 等敏感字段。

## 开发

```powershell
npm install
npm run verify
npm test
npm run typecheck
npm run android
npm run release:android
```

`npm run android` 需要 Expo development build，不能用 Expo Go 验证。需要 Android Studio 提供 Android SDK / 模拟器，或准备一台已开启 USB 调试的 Android 手机。

开发前先在 [产品地图](docs/product-map.md) 中选择受影响的能力 ID，并沿用户入口、代码 seam、自动测试和模拟器路径展开回归；已经逃逸过的问题及精确 oracle 见 [回归语料库](docs/regression-corpus.md)，代码 ownership 与质量门禁见 [代码与项目结构规范](docs/code-standards.md)，实现与数据边界见 [架构说明](docs/architecture.md)，具体验收规则见 [测试标准](docs/testing-standard.md)。

`npm run release:android` 会先读取本机 `.env.release.local`，生成并校验正式签名的 `app-arm64-v8a-release.apk`，再把同一份 x86_64 Release 代码生成开发签名的 `app-x86_64-smoke-dev.apk`，只在 `WZ_ANDROID_SMOKE_DEVICE` 指定的登录态模拟器上覆盖安装。覆盖安装后的第一次启动会从启动前 marker 起检查包级日志，但只形成 `APK_SANITY`；`tests/device/` 的只读 Replay 另行形成 `DEVICE_REPLAY_PASS`，两者都不等于全部功能通过。正式发布必须配置四个 `WZ_ANDROID_KEY*` 签名变量，以及 `WZ_ANDROID_SMOKE_DEVICE`、`WZ_ANDROID_SMOKE_ABI=x86_64`；正式 APK 禁止 debug 签名，Smoke APK 不得上传。还需要本机已有 `agent-device >= 0.19.0`。不要提交 keystore、`.env.release.local` 或明文密码。旧 debug 签名包用户切换到正式签名版本时，需要先备份数据再重装。

当前本机正式签名配置放在 `.env.release.local`，keystore 放在用户目录的 `.wz-android/` 下。发布前务必备份这两个文件；丢失 keystore 或密码后，同包名新版无法继续覆盖升级旧版。
