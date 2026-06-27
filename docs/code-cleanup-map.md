# 阅坛 Android 全项目无用代码地图

## 结论
这次清理不是 NS 专项。真正的范围是整个 App：列表 / 导航、详情 / 回复、来源 / 解析、账号 / Cookie / 验证、测试守卫和 Agent 规则。
NodeSeek 私密帖只是来源解析里的一个回归样例，不是清理中心。

## 本轮已完成收口

- 阅读数据恢复不再通过清空本机数据来兜底。
- 带 Cookie 的来源请求会先校验目标站点和 URL，再发送请求。
- 安装、CI 和 release 路径已固定到可重复命令；release APK 会校验签名并输出 SHA-256。
- 搜索历史限制为 20 条、单条 120 字符；备份导入限制大小和嵌套深度。
- App controller 使用 `sourceGateway` 的语义入口；`Direct` 命名只保留在妖火来源实现中。
- `AppRoot` 的延迟导航时机已拆到 `src/app/useDeferredNavigationTask.ts`。
- NodeSeek 和 linux.do WebView Cookie 读取已并发读取 Android 安全存储和 CookieManager。

## 候选分桶

| 桶 | 主要位置 | 典型残留 | 当前判断 |
| --- | --- | --- | --- |
| 列表 / 导航 | `src/screens/FeedScreen.tsx`、`src/screens/SearchScreen.tsx`、`src/screens/LibraryScreen.tsx`、`src/screens/MoreScreen.tsx`、`src/components/TopicCard.tsx`、`src/feedLogic.ts`、`src/searchListItems.ts`、`src/feedCategoryRail.ts` | 旧状态、旧筛选、旧展示位、重复分组 / 排序 / 标记 | 需要证明，优先清 |
| 详情 / 回复 | `src/screens/topic/TopicScreenBody.tsx`、`src/screens/topic/topicScreenHelpers.ts`、`src/screens/topic/ReplyItem.tsx`、`src/screens/topic/TopicActionBar.tsx`、`src/screens/topic/TopicMenu.tsx`、`src/screens/topic/TopicPolls.tsx`、`src/topicActionState.ts`、`src/topicDerivedData.ts`、`src/topicContentSplit.ts`、`src/topicListItemState.ts`、`src/topicSessionState.ts` | 历史 fallback、重复徽标 / 提示、旧操作状态、旧引用路径 | 需要证明，次优先清 |
| 来源 / 解析 | `src/localHtml.ts`、`src/localV2ex.ts`、`src/localLinuxdo.ts`、`src/localNodeseek.ts`、`src/localYaohuo.ts`、`src/forumApi.ts`、`src/sources/sourceGateway.ts` | 重复 access-requirement 识别、重复解析分支、旧兼容路径 | 需要证明，重点清 |
| 账号 / Cookie / 验证 | `src/app/useAccountController.ts`、`src/app/useSessionController.ts`、`src/linuxdoCookieBridge.ts`、`src/nodeseekCookieBridge.ts`、`src/yaohuoCookies.ts`、`src/verificationFlow.ts` | 旧登录标记、重复状态映射、旧错误路径、旧中间态 | 需要证明，重点清 |
| 测试守卫 | `src/theme.test.ts`、`src/htmlRenderingStyles.test.ts`、`src/localSources.test.ts`、`src/localAccessRequirement.test.ts`、`src/appSecurity.test.ts` | 解析回归、数据安全、少量真正 boundary tests | 已删主要源码字符串断言和纯性能常量测试 |

## 继续观察的承接层

这些文件更像承接层，不是当前默认删除对象，但它们会影响后续清理是否会留下“看起来还在、其实没用”的代码：

- `src/app/AppNavigator.tsx`
- `src/app/AppRoot.tsx`
- `src/app/useFeedController.ts`
- `src/app/useSearchController.ts`
- `src/app/useUserController.ts`
- `src/app/useMainTabScrollToTop.ts`
- `src/app/useDeferredNavigationTask.ts`
- `src/screens/library/libraryScreenItems.ts`
- `src/feedFloatingActions.ts`

## 明确保留

- `src/sources/sourceGateway.ts`
- `src/theme.ts`
- `src/screens/TopicScreen.tsx`
- `android/`
- `.expo/`
- 截图、log、生成目录

## 后续顺序

1. 列表 / 导航
2. 详情 / 回复
3. 来源 / 解析
4. 账号 / Cookie / 验证
5. 测试守卫
6. `AGENTS.md`

## 备注

这次的目标不是“围着前一阶段修过的地方继续挖”，而是把全项目里那些没有真实用途、只靠历史惯性留下来的代码分批清掉。
