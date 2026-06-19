# 交接说明

## 当前已存在

- `README.md`：Android App 启动、范围和 release 说明。
- `AGENTS.md`：本仓库工作规则。
- `docs/architecture.md`：结构说明。
- `docs/operator-runbook.md`：维护检查方法。
- `App.tsx`、`src/`、`plugins/`、`assets/`、`scripts/`：Android App 代码与资源。

## 接手顺序

1. 阅读 `AGENTS.md`。
2. 阅读 `README.md`。
3. 阅读 `docs/architecture.md` 和 `docs/operator-runbook.md`。
4. 运行 `npm install`、`npm test`、`npm run typecheck`。

## 当前边界

- 本仓库是阅坛 Android App。
- 当前下载入口在 `README.md`，指向 GitHub Releases 的 latest arm64-v8a APK。
- 正式发布使用 `.env.release.local` 中的 release signing 配置，keystore 和密码只保存在本机，不进入仓库。
- App 支持 NodeSeek、linux.do、V2EX 和妖火。
- 妖火属于四站来源层之一。
- `App.tsx` 只作为入口，`src/app/AppRoot.tsx` 组合控制器、页面参数、Provider、全局弹层、隐藏 WebView 和导航。
- 来源统一入口在 `src/sources/sourceGateway.ts`；`forumApi.ts`、`yaohuoApi.ts` 和站点 action client 仍存在，但作为 gateway 后面的实现。
- 首页、搜索、详情、回复、用户页和详情互动都通过 `sourceGateway` 进入来源层。
- More 页账号区在 `src/screens/MoreScreen.tsx`、`src/screens/more/MorePanels.tsx` 和 `src/screens/more/LinuxDoLevelPanel.tsx`，账号逻辑在 `src/app/useAccountController.ts`。
- `src/theme.ts` 是兼容 facade，主题核心在 `src/themeCore.ts`，`createStyles` 在 `src/themeStyles.ts`，样式分组在 `src/themeParts.ts`。
- `src/screens/TopicScreen.tsx` 是兼容 facade，详情页主体在 `src/screens/topic/TopicScreenBody.tsx`，纯辅助逻辑在 `src/screens/topic/topicScreenHelpers.ts`。
- 收藏页展示在 `src/screens/LibraryScreen.tsx`，列表模型在 `src/screens/library/libraryScreenItems.ts`。
- 模拟器验证最新代码不得清 App 数据；用覆盖安装、重启 Metro、force-stop 和重新启动保留登录态。

## 优先查看

1. 来源能力：`src/sources/sourceGateway.ts`、`src/forumApi.ts`、`src/yaohuoApi.ts`、站点 action client。
2. App 壳：`App.tsx`、`src/app/AppRoot.tsx`、`src/app/AppNavigator.tsx`。
3. App 运行逻辑：`src/app/useFeedController.ts`、`src/app/useSearchController.ts`、`src/app/useTopicController.ts`、`src/app/useTopicActionsController.ts`、`src/app/useUserController.ts`、`src/app/useAccountController.ts`。
4. 详情页 UI：`src/screens/TopicScreen.tsx`、`src/screens/topic/TopicScreenBody.tsx`、`src/screens/topic/topicScreenHelpers.ts` 和 `src/screens/topic/` 下的局部组件。
5. 收藏页 UI：`src/screens/LibraryScreen.tsx` 和 `src/screens/library/libraryScreenItems.ts`。
6. 样式：`src/theme.ts`、`src/themeCore.ts`、`src/themeStyles.ts`、`src/themeParts.ts`。
