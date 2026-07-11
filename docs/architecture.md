# 架构说明

## 文档职责

- `docs/product-charter.md` 定义产品目标、核心旅程和取舍标准。
- 本文只记录当前 module、interface、数据和原生配置边界，不维护版本号或登录状态。
- `docs/testing-standard.md` 定义验收，`docs/operator-runbook.md` 定义开发与发布操作。
- `memory/` 与 `docs/emulator-baseline.md` 保存本机事实，不进入 Git，也不作为共享架构规范。

## 当前范围

本仓库是阅坛 Android App。App 面向 NodeSeek、linux.do、V2EX 和妖火，提供本地优先的多网站发现、搜索、续读和必要互动能力。四站共享阅读主干，互动能力按原站真实支持范围提供，不要求对齐。

## 主要结构

| 路径 | 作用 |
| --- | --- |
| `App.tsx` | 应用入口，只加载 `AppRoot` |
| `src/app/AppRoot.tsx` | App 根组件，组合控制器、主题、导航、Provider、全局弹层、隐藏 WebView 和页面参数 |
| `src/app/useDeferredNavigationTask.ts` | AppRoot 的延迟导航时机，避免把 `InteractionManager` 细节留在根组件里 |
| `src/app/use*Controller.ts` | 首页、搜索、详情、用户、账号、会话、验证、备份等运行逻辑 |
| `src/sources/sourceGateway.ts` | App 统一来源读取入口，隐藏四站读取 adapter 差异 |
| `src/forumApi.ts`、`src/yaohuoApi.ts` | 当前读取实现，位于 `sourceGateway` 后面 |
| 站点 action client | 当前写入实现，由 `useTopicActionsController` 按来源和 capability 调用 |
| `src/screens/` | 首页、搜索、收藏、更多、用户页和详情页导出入口 |
| `src/screens/topic/` | 详情页主体、详情页 helper 和详情页局部组件 |
| `src/screens/more/` | More 页账号中心、备份、外观、状态检查等局部面板 |
| `src/screens/library/` | 收藏页列表模型与列表 key helper |
| `src/components/` | 通用控件、主题卡片、图片预览和底部导航 |
| `src/feedCategoryRail.ts`、`src/feedLogic.ts` | 首页来源、分类、单站排序和列表缓存 key |
| `src/networkProxy.ts`、`src/app/useNetworkProxyController.ts` | 服务器代理配置、保存、启用和请求保护 |
| `src/theme.ts` | 主题兼容入口，继续保持原导出 |
| `src/themeCore.ts` | 主题类型、颜色、字号和样式辅助函数 |
| `src/themeStyles.ts`、`src/themeParts.ts` | `createStyles` 和拆分后的样式分组 |
| `src/local*.ts` | 四站本机来源读取与解析 |
| `plugins/` | Expo config plugin，持久化 Android 原生配置；服务器代理原生模块由 `plugins/withNetworkProxyModule.js` 生成 |
| `scripts/` | 文档检查、Android smoke、release 打包与版本检查脚本 |

## 来源边界

- App controller 通过 `src/sources/sourceGateway.ts` 的 `getFeed`、`searchTopics`、`getTopic`、`getReplies` 和用户资料 interface 读取四站数据。
- 四站的首页、搜索、主题、回复和用户资料读取均已进入 managed gateway：`createSourceGateway` 在 module 内组装 WebView fallback fetcher、Cookie、User-Agent、凭据 generation 和妖火失效清理；controller 只传业务参数和请求归属上下文，不再接触这些来源细节。
- NodeSeek、linux.do 和妖火的互动请求目前仍由 `useTopicActionsController` 按来源调用各站 action client；迁移写路径时再逐项进入 gateway，不用一次性改请求格式。
- App controller 使用不带 `Direct` 和站点前缀的通用读取入口；妖火的 `Direct` 命名只保留在 gateway 后的来源实现。
- `sourceGateway` 内部仍转发到 `src/forumApi.ts` 和 `src/yaohuoApi.ts`；各站 action client 暂时是独立写入边界。
- `src/forumApi.ts` 仍是现有读取实现的一部分，不应从文档中当作已删除文件处理。
- 新增读取调用方应使用 `sourceGateway`，不要在 `src/app/*Controller.ts` 里新增对旧读取来源文件的直接调用；新增写操作复用现有 action client，并按触及路径逐项收口。
- 来源静态 capability 只说明该站可能支持某项能力；当前主题或回复的 `canEdit`、`canDelete` 等权限仍以原站解析结果为准。

## 导航与状态边界

- `src/app/AppNavigator.tsx` 是唯一的路由事实源；`AppRoot` 的 `screen` 只由 NavigationContainer 的 route change 回调更新，页面跳转只能调用导航命令。
- 详情 session 由 `useTopicSessionController` 聚合，并通过 `src/topicSessionState.ts` 快照保存和恢复；互动 controller 使用回复成功收尾、草稿图片插入和 action 状态更新等领域命令，不直接修改详情 session 的 state。嵌套详情、Topic→User→Topic、Android 物理返回、草稿和滚动位置是必须保留的行为。
- 嵌套 Topic 快照按 React Navigation route key 保存；现有手动 back stack 只作为可回滚兼容路径。详情读取与 action controller 都只接收聚合后的 Topic session port，不再穿透内部 ref。

## 首页筛选

- 首页聚合页只显示阅读筛选：`全部`、`未读`、`已读`、`收藏`。
- linux.do 单站分类行右侧显示排序菜单，支持 `最新`、`热门`、`新·所有`、`新·话题`、`新·回复`；分类和排序同时进入请求 key，避免列表缓存串用。
- NodeSeek 单站在未选分类时支持 `新帖子`、`新评论`；V2EX 单站在未选分类时支持 `全部`、`最新`、`最热`。
- 新增首页筛选状态应先放进 `src/feedCategoryRail.ts`，再通过 `src/app/useFeedController.ts` 进入 `getFeed`。

## 账号中心

- More 页只有一个 `账号中心`，由 `src/screens/MoreScreen.tsx`、`src/screens/more/AccountCenterPanel.tsx` 和 `src/screens/more/accountCenter.ts` 承载；三站共用会话、身份、凭据摘要和主操作视图，同一时间只展开一个站点。
- 账号中心顶部只有一个公共 `刷新账号状态`，一次刷新三站；主页、登录 / 验证、检测、清除登录、刷新网页、NodeImage、签到和 linux.do 等级等原入口仍按站点进入。测试工具、代理、诊断、备份和外观保持独立。
- `src/credentialVault.ts` 使用现有 SecureStore 按站点隔离账号密码；`src/loginFormAdapters.ts` 只允许在三站声明的可信登录 URL 和字段上主动填入，触发输入事件但不提交。
- 网站 Cookie 与保存的账号密码是两套独立数据：清除网站登录不删除凭据，删除凭据也不退出当前网站登录。
- More 页 `服务器代理` 由 `src/screens/more/NetworkProxyModal.tsx` 承载，配置 HTTP / SOCKS5 代理并可测试延迟。
- `src/app/useAccountStatusController.ts` 负责 `refreshAccountStatus`；`src/app/useBackupStatusController.ts` 只负责备份导入导出。`AppRoot` 在本机资料加载完成后静默刷新一次，手动刷新才提示结果。
- `src/app/useAccountController.ts` 负责 NodeSeek、linux.do、妖火登录 / 验证页检测、Cookie 保存 / 清理和 linux.do 等级读取。
- `src/app/useSessionController.ts` 只负责加载 Cookie 和会话事实；NodeSeek Cookie 加载只返回本次凭据里的 userId，不顺带读取个人资料。
- `SiteSessionState` 是账号中心和登录弹层的唯一登录状态来源；NodeSeek 的 WebView userId 只在 session 已登录时补充身份，不能覆盖已失效、匿名或需要验证状态。
- NodeSeek 当前账号由账号刷新读取，普通请求优先，失败再 WebView 兜底；兜底 userId 只来自本次凭据，不使用旧页面状态。确定未登录的 session event 会清理运行时身份提示，普通 `check-failed` 不会误判退出。
- linux.do 验证弹层由 `src/app/LinuxDoVerifyModal.tsx` 和全局 modal host 承载。

## 服务器代理

- 代理配置保存在 Android 安全存储，不进入备份 JSON。
- 启用代理后，App 请求和 WebView 都必须等代理成功应用；代理应用失败时阻止相关网络请求，不能静默回退直连。
- Android 原生代理模块由 `plugins/withNetworkProxyModule.js` 写入生成目录，并通过 `app.json` 的 plugin 列表持久化。
- 本地开发地址 `localhost`、`127.*`、`10.0.2.2` 和 `::1` 不走代理。

## 详情页

- `src/screens/TopicScreen.tsx` 是兼容入口，继续导出 `TopicScreen` 和 `TopicListItem`。
- `src/screens/topic/TopicScreenBody.tsx` 承载详情页主体，组合详情内容、回复列表、楼层搜索、操作菜单和回复框。
- `src/screens/topic/topicScreenHelpers.ts` 承载详情页纯辅助逻辑，例如回复 key、状态徽标和权限提示识别。
- `src/screens/topic/ReplyItem.tsx`、`src/screens/topic/ReplyComposer.tsx`、`src/screens/topic/TopicActionBar.tsx`、`src/screens/topic/TopicContentBlock.tsx`、`src/screens/topic/TopicMenu.tsx`、`src/screens/topic/TopicPolls.tsx` 分别承载详情页局部 UI。

## 回复写操作

- `src/app/useTopicActionsController.ts` 负责回复、楼层回复、编辑、删除、图片上传和互动请求。
- NodeSeek 编辑自己的回复使用原站真实评论 id 和真实 token；没有 token 时拒绝发送，不使用随机值。
- NodeSeek 图片上传通过 NodeImage；App 可从 NodeImage 授权页获取并缓存当前用户自己的 API Key，也保留手动粘贴备用入口。
- linux.do 图片上传走原站 `/uploads.json`；妖火图片上传走图床并插入 UBB 图片标签。
- 删除回复只在来源解析出明确权限时显示：linux.do 使用 `can_delete`，妖火使用原站删除链接；NodeSeek 未确认删除入口时不显示删除。

## 收藏页

- `src/screens/LibraryScreen.tsx` 承载收藏、历史和关注用户页展示。
- `src/screens/library/libraryScreenItems.ts` 承载收藏页列表分组、列表 key、item type 和数量文案。

## 数据边界

- Cookie 只保存在 Android 本机安全存储。
- 服务器代理地址、用户名和密码只保存在 Android 本机安全存储。
- 搜索历史保存在 `AsyncStorage`，最多 20 条，单条最多 120 字符。
- 本机资料只通过当前版本 JSON 备份 / 恢复迁移；导入会限制 JSON 大小和嵌套深度。
- `android/`、`.expo/`、临时截图、日志和 Cookie 数据库都不进入仓库。

## 稳定入口与生成边界

- `App.tsx`、`src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是稳定入口或兼容 facade；保持现有导出，不把实现重新堆回入口文件。
- `android/` 是生成目录；Android 长期配置通过 `app.json` 与 `plugins/` 持久化。
- 不改变备份 JSON、安全存储键、Cookie、代理、签名或更新 manifest 格式，除非有单独迁移方案和兼容验证。
- 技术债务按 [用户旅程技术债务清单](code-cleanup-map.md) 分批处理，不以目录、文件大小或代码行数作为清理优先级。
