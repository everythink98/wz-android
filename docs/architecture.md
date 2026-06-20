# 架构说明

## 当前范围

本仓库是阅坛 Android App。App 面向 NodeSeek、linux.do、V2EX 和妖火，提供多网站浏览和轻量互动能力。

## 主要结构

| 路径 | 作用 |
| --- | --- |
| `App.tsx` | 应用入口，只加载 `AppRoot` |
| `src/app/AppRoot.tsx` | App 根组件，组合控制器、主题、导航、Provider、全局弹层、隐藏 WebView 和页面参数 |
| `src/app/useDeferredNavigationTask.ts` | AppRoot 的延迟导航时机，避免把 `InteractionManager` 细节留在根组件里 |
| `src/app/use*Controller.ts` | 首页、搜索、详情、用户、账号、会话、验证、备份等运行逻辑 |
| `src/sources/sourceGateway.ts` | App 统一来源入口，读取和互动请求先进入这里 |
| `src/forumApi.ts`、`src/yaohuoApi.ts`、站点 action client | 当前来源实现，位于 `sourceGateway` 后面 |
| `src/screens/` | 首页、搜索、收藏、更多、用户页和详情页导出入口 |
| `src/screens/topic/` | 详情页主体、详情页 helper 和详情页局部组件 |
| `src/screens/more/` | More 页账号、备份、外观、状态检查等局部面板 |
| `src/screens/library/` | 收藏页列表模型与列表 key helper |
| `src/components/` | 通用控件、主题卡片、图片预览和底部导航 |
| `src/theme.ts` | 主题兼容入口，继续保持原导出 |
| `src/themeCore.ts` | 主题类型、颜色、字号和样式辅助函数 |
| `src/themeStyles.ts`、`src/themeParts.ts` | `createStyles` 和拆分后的样式分组 |
| `src/local*.ts` | 四站本机来源读取与解析 |
| `plugins/` | Expo config plugin，持久化 Android 原生配置 |
| `scripts/` | release 打包辅助脚本 |

## 来源边界

- App controller 通过 `src/sources/sourceGateway.ts` 读取首页、搜索、详情、回复和用户资料。
- NodeSeek、linux.do 和妖火的回复、投票、收藏、签到等互动请求也通过 `sourceGateway` 进入。
- App controller 使用不带 `Direct` 的 gateway 语义入口；`Direct` 命名只保留在妖火来源实现和 gateway 转发测试里。
- `sourceGateway` 内部仍转发到 `forumApi.ts`、`yaohuoApi.ts`、`nodeseekActionClient.ts`、`linuxdoActionClient.ts` 和 `yaohuoActionClient.ts`。
- `forumApi.ts` 仍是现有读取实现的一部分，不应从文档中当作已删除文件处理。
- 新增 App 调用方应优先使用 `sourceGateway`，不要在 `src/app/*Controller.ts` 里新增对旧来源文件或站点 action client 的直接调用。

## 账号区

- More 页账号与验证区由 `src/screens/MoreScreen.tsx`、`src/screens/more/MorePanels.tsx` 和 `src/screens/more/LinuxDoLevelPanel.tsx` 承载。
- `src/app/useAccountController.ts` 负责 NodeSeek、linux.do、妖火登录态检查、Cookie 保存 / 清理和 linux.do 等级读取。
- NodeSeek 签到、linux.do 等级、妖火登录检查都通过账号区入口触发。
- linux.do 验证弹层由 `src/app/LinuxDoVerifyModal.tsx` 和全局 modal host 承载。

## 详情页

- `src/screens/TopicScreen.tsx` 是兼容入口，继续导出 `TopicScreen` 和 `TopicListItem`。
- `src/screens/topic/TopicScreenBody.tsx` 承载详情页主体，组合详情内容、回复列表、楼层搜索、操作菜单和回复框。
- `src/screens/topic/topicScreenHelpers.ts` 承载详情页纯辅助逻辑，例如回复 key、状态徽标和权限提示识别。
- `src/screens/topic/ReplyItem.tsx`、`ReplyComposer.tsx`、`TopicActionBar.tsx`、`TopicContentBlock.tsx`、`TopicMenu.tsx`、`TopicPolls.tsx` 分别承载详情页局部 UI。

## 收藏页

- `src/screens/LibraryScreen.tsx` 承载收藏、历史和关注用户页展示。
- `src/screens/library/libraryScreenItems.ts` 承载收藏页列表分组、列表 key、item type 和数量文案。

## 数据边界

- Cookie 只保存在 Android 本机安全存储。
- 搜索历史保存在 `AsyncStorage`，最多 20 条，单条最多 120 字符。
- 本机资料只通过当前版本 JSON 备份 / 恢复迁移；导入会限制 JSON 大小和嵌套深度。
- `android/`、`.expo/`、临时截图、日志和 Cookie 数据库都不进入仓库。
