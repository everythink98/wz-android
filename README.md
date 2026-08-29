<p align="center">
  <img src="assets/icon.png" width="112" alt="阅坛 Android 应用图标" />
</p>

<h1 align="center">阅坛 Android</h1>

<p align="center">
  <strong>把分散的中文社区，收进一套清爽、统一的 Android 阅读体验。</strong>
</p>

<p align="center">
  NodeSeek&nbsp;&nbsp;·&nbsp;&nbsp;linux.do&nbsp;&nbsp;·&nbsp;&nbsp;V2EX&nbsp;&nbsp;·&nbsp;&nbsp;妖火
</p>

<p align="center">
  <a href="https://github.com/everythink98/wz-android/releases/latest/download/app-arm64-v8a-release.apk">
    <img alt="下载最新版 APK" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD_APK-%E6%9C%80%E6%96%B0%E7%89%88-2ea44f?style=for-the-badge&logo=android&logoColor=white" />
  </a>
  <a href="https://github.com/everythink98/wz-android/releases/latest">
    <img alt="查看 Releases" src="https://img.shields.io/badge/GitHub_Releases-%E6%9F%A5%E7%9C%8B-0969da?style=for-the-badge&logo=github&logoColor=white" />
  </a>
</p>

<p align="center">
  <a href="#项目简介">项目简介</a> ·
  <a href="#核心能力">核心能力</a> ·
  <a href="#支持来源">支持来源</a> ·
  <a href="#下载">下载</a> ·
  <a href="#开发">开发</a>
</p>

---

## 项目简介

阅坛 Android 是一款面向中文社区的多论坛第三方客户端。它将内容发现、搜索、深度阅读、消息管理与站内互动收拢到一个 App 中，让跨站浏览更连贯、更专注。

> **统一的是体验，保留的是社区差异。** 每个来源继续使用自己的账号体系、权限和功能规则；登录、验证与接口逻辑按站隔离。

目前已接入 NodeSeek、linux.do、V2EX 和妖火。它们是当前支持的内容来源，而不是产品边界；后续社区可以继续作为独立来源接入，共享稳定的阅读与交互基础。

## 核心能力

| 能力 | 使用体验 |
| --- | --- |
| **跨站发现** | 在“全部”中按自定义顺序聚合已启用社区，也可切换单站、分类和排序；支持刷新、分页与阅读状态筛选。 |
| **来源管理** | 在“更多”统一启停、拖拽排序内容源；停用后，相关入口同步隐藏，并停止 App 管理的读取与后台通知请求。 |
| **统一搜索** | 查看多站结果预览，或进入单站连续结果；支持来源专属筛选、搜索历史，以及登录后的 linux.do AI 搜索。 |
| **深度阅读** | 完整呈现正文、回复、引用、代码、表格、图片、视频、附件和投票；支持楼层定位、回复筛选、评论查找与图片预览保存。 |
| **用户资料** | 查看作者资料、主题、回复和原站主页，并可在本机关注用户。 |
| **站内互动** | 根据原站能力和账号权限，提供回复、编辑、删除、点赞或其他反应、原站收藏、投票、签到和图片上传。 |
| **消息与账号** | 统一管理多站 Cookie 会话，以及 NodeSeek、linux.do 和妖火的通知与私信；支持消息筛选和可选的 Android 摘要通知。 |
| **本机资料** | 保存收藏帖子、关注用户、阅读历史和已读状态，支持 JSON 备份与恢复，不依赖阅坛云端账号。 |
| **个性化工具** | 支持浅色 / 深色主题、字号、字体、行距、正文宽度、列表密度、HTTP/SOCKS5 代理、脱敏诊断和 App 内检查更新。 |

## 支持来源

以下仅概括各站的主要差异。完整入口、权限和回归范围以 [产品地图](docs/product-map.md) 为准。

| 来源 | 主要能力 |
| --- | --- |
| **NodeSeek** | 回复、楼层回复、编辑自己的回复、点赞、反对、加鸡腿、原站收藏、签到、投票和 NodeImage 图片上传。 |
| **linux.do** | 回复、楼层回复、编辑或删除自己的回复、点赞、原站收藏、投票、图片上传和等级查看。 |
| **妖火** | 登录后浏览、搜索、回复、楼层回复、原站收藏、投票、删除自己的回复和图片上传。 |
| **V2EX** | 公开内容浏览、搜索、用户主页和只读互动信息展示。 |

## 下载

从 GitHub Releases 下载最新版 APK：

**[下载阅坛 Android APK](https://github.com/everythink98/wz-android/releases/latest/download/app-arm64-v8a-release.apk)**

当前版本号和 Android `versionCode` 以 `package.json` 与 `app.json` 为准，发布包为 Android arm64-v8a APK。首次安装第三方 APK 时，Android 可能会要求允许“安装未知应用”。

## 隐私与数据

- Cookie 和本机资料不上传到阅坛自有服务；认证材料只用于对应原站、NodeImage 或用户配置代理的请求，不进入阅坛自有服务。
- NodeSeek、linux.do 和妖火 Cookie 由网站 WebView 与 Android `CookieManager` 持有，不复制到 SecureStore、ReaderData 或备份。
- NodeImage API Key、保存的账号密码和服务器代理配置使用 Android SecureStore。
- 本机资料保存在 `AsyncStorage`，通过当前版本 JSON 备份 / 恢复。
- 备份 JSON 不保存 Cookie、token、password、session、sid、csrf、proxy 等敏感字段。

## 开发

```powershell
npm install
npm run verify
npm run android
```

`npm run android` 需要 Expo development build，不能使用 Expo Go。请准备 Android Studio 提供的 Android SDK / 模拟器，或一台已开启 USB 调试的 Android 手机。

### 项目文档

| 文档 | 用途 |
| --- | --- |
| [产品地图](docs/product-map.md) | 当前产品行为、入口、共享 seam 与能力 ID |
| [架构说明](docs/architecture.md) | 实现结构与数据边界 |
| [测试标准](docs/testing-standard.md) | 测试 owner、证据层、隔离和验证强度 |
| [代码与项目结构规范](docs/code-standards.md) | ownership、命名、结构和静态门禁 |
| [维护手册](docs/operator-runbook.md) | 构建、覆盖安装、Replay、Smoke 和发布步骤 |
| [回归语料库](docs/regression-corpus.md) | 已确认历史事故、根因与当前归属 |

产品或 runtime 改动请先在产品地图中选择受影响的能力 ID，并沿入口、代码 seam、自动测试和模拟器路径展开回归。不要提交 keystore、`.env.release.local` 或明文凭据。
