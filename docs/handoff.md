# 交接说明

## 当前已存在

- `README.md`：Android App 启动、范围和 release 说明。
- `AGENTS.md`：本仓库工作规则。
- `docs/architecture.md`：结构说明。
- `docs/operator-runbook.md`：维护检查方法。
- `docs/testing-standard.md`：按功能判断测试是否真的覆盖现有行为。
- `docs/emulator-baseline.md`：当前模拟器只读功能基线。
- `App.tsx`、`src/`、`plugins/`、`assets/`、`scripts/`：Android App 代码与资源。

## 接手顺序

1. 阅读 `AGENTS.md`。
2. 阅读 `README.md`。
3. 阅读 `docs/architecture.md` 和 `docs/operator-runbook.md`。
4. 阅读 `docs/testing-standard.md` 和 `docs/emulator-baseline.md`。
5. 运行 `npm install`、`npm test`、`npm run typecheck`。

## 当前边界

- 本仓库是阅坛 Android App。
- 当前下载入口在 `README.md`，指向 GitHub Releases 的 latest arm64-v8a APK。
- 正式发布使用 `.env.release.local` 中的 release signing 配置，keystore 和密码只保存在本机，不进入仓库。
- release 脚本生成 APK 后会校验签名并输出 APK SHA-256。
- App 支持 NodeSeek、linux.do、V2EX 和妖火。
- 妖火属于四站来源层之一。
- `App.tsx` 只作为入口，`src/app/AppRoot.tsx` 组合控制器、页面参数、Provider、全局弹层、隐藏 WebView 和导航，延迟导航时机在 `src/app/useDeferredNavigationTask.ts`。
- 来源统一入口在 `src/sources/sourceGateway.ts`；App 层使用不带 `Direct` 的 gateway 方法，`Direct` 命名只保留在妖火来源实现和 gateway 转发测试里。
- `forumApi.ts`、`yaohuoApi.ts` 和站点 action client 仍存在，但作为 gateway 后面的实现。
- 首页、搜索、详情、回复、用户页和详情互动都通过 `sourceGateway` 进入来源层。
- 详情页支持三站回复框格式工具栏和图片上传；NodeSeek / linux.do 插入 Markdown 图片，妖火插入 `[img]...[/img]`。
- NodeSeek 支持编辑自己的回复；请求必须使用 App 内登录态取得的真实 token。
- linux.do 和妖火仅在原站数据明确允许时显示删除自己的回复；NodeSeek 当前不显示删除回复入口。
- More 页账号区在 `src/screens/MoreScreen.tsx`、`src/screens/more/MorePanels.tsx` 和 `src/screens/more/LinuxDoLevelPanel.tsx`，账号逻辑在 `src/app/useAccountController.ts`。
- More 页提供 NodeImage API Key 状态、自动授权获取和手动粘贴备用入口。
- `src/theme.ts` 是兼容 facade，主题核心在 `src/themeCore.ts`，`createStyles` 在 `src/themeStyles.ts`，样式分组在 `src/themeParts.ts`。
- `src/screens/TopicScreen.tsx` 是兼容 facade，详情页主体在 `src/screens/topic/TopicScreenBody.tsx`，纯辅助逻辑在 `src/screens/topic/topicScreenHelpers.ts`。
- 收藏页展示在 `src/screens/LibraryScreen.tsx`，列表模型在 `src/screens/library/libraryScreenItems.ts`。
- 模拟器验证最新代码不得清 App 数据；用覆盖安装、重启 Metro、force-stop 和重新启动保留登录态。
- 任何优化或清理都必须按 `docs/testing-standard.md` 选择对应功能验证，并对照 `docs/emulator-baseline.md` 做模拟器验收；只打开 App 不算完成。

## 优先查看

1. 来源能力：`src/sources/sourceGateway.ts`、`src/forumApi.ts`、`src/yaohuoApi.ts`、站点 action client。
2. App 壳：`App.tsx`、`src/app/AppRoot.tsx`、`src/app/AppNavigator.tsx`、`src/app/useDeferredNavigationTask.ts`。
3. App 运行逻辑：`src/app/useFeedController.ts`、`src/app/useSearchController.ts`、`src/app/useTopicController.ts`、`src/app/useTopicActionsController.ts`、`src/app/useUserController.ts`、`src/app/useAccountController.ts`。
4. 详情页 UI：`src/screens/TopicScreen.tsx`、`src/screens/topic/TopicScreenBody.tsx`、`src/screens/topic/topicScreenHelpers.ts` 和 `src/screens/topic/` 下的局部组件。
5. 回复上传 / 授权：`src/replyImageUpload.ts`、`src/nodeimageCredentials.ts`、`src/loginWebViewScripts.ts`、`src/linuxdoActions.ts`、`src/yaohuoActionClient.ts`。
6. 收藏页 UI：`src/screens/LibraryScreen.tsx` 和 `src/screens/library/libraryScreenItems.ts`。
7. 样式：`src/theme.ts`、`src/themeCore.ts`、`src/themeStyles.ts`、`src/themeParts.ts`。
