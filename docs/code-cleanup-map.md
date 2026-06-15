# 阅坛 Android 全项目无用代码地图

## 结论
这次清理不是 NS 专项。真正的范围是整个 App：列表 / 导航、详情 / 回复、来源 / 解析、账号 / Cookie / 验证、测试守卫和 Agent 规则。
NodeSeek 私密帖只是来源解析里的一个回归样例，不是清理中心。

## 候选分桶

| 桶 | 主要位置 | 典型残留 | 当前判断 |
| --- | --- | --- | --- |
| 列表 / 导航 | `src/screens/FeedScreen.tsx`、`src/screens/SearchScreen.tsx`、`src/screens/LibraryScreen.tsx`、`src/screens/MoreScreen.tsx`、`src/components/TopicCard.tsx`、`src/feedLogic.ts`、`src/searchListItems.ts`、`src/feedCategoryRail.ts` | 旧状态、旧筛选、旧展示位、重复分组 / 排序 / 标记 | 需要证明，优先清 |
| 详情 / 回复 | `src/screens/topic/TopicScreenBody.tsx`、`src/screens/topic/topicScreenHelpers.ts`、`src/screens/topic/ReplyItem.tsx`、`src/screens/topic/TopicActionBar.tsx`、`src/screens/topic/TopicMenu.tsx`、`src/screens/topic/TopicPolls.tsx`、`src/topicActionState.ts`、`src/topicDerivedData.ts`、`src/topicContentSplit.ts`、`src/topicListItemState.ts`、`src/topicSessionState.ts` | 历史 fallback、重复徽标 / 提示、旧操作状态、旧引用路径 | 需要证明，次优先清 |
| 来源 / 解析 | `src/localHtml.ts`、`src/localV2ex.ts`、`src/localLinuxdo.ts`、`src/localNodeseek.ts`、`src/localYaohuo.ts`、`src/forumApi.ts`、`src/sources/sourceGateway.ts` | 重复 access-requirement 识别、重复解析分支、旧兼容路径 | 需要证明，重点清 |
| 账号 / Cookie / 验证 | `src/app/useAccountController.ts`、`src/app/useSessionController.ts`、`src/linuxdoCookieBridge.ts`、`src/nodeseekCookieBridge.ts`、`src/yaohuoCookies.ts`、`src/verificationFlow.ts` | 旧登录标记、重复状态映射、旧错误路径、旧中间态 | 需要证明，重点清 |
| 测试守卫 | `src/appExperience.test.ts`、`src/appPerformance.test.ts`、`src/detailReadingLayout.test.ts`、`src/androidBestPracticeBoundaries.test.ts`、`src/androidArchitectureBoundaries.test.ts`、`src/localSources.test.ts`、`src/localAccessRequirement.test.ts` | 源码字符串断言、过度绑定旧结构、少量真正 boundary tests | 保留边界，收敛脆弱断言 |

## 继续观察的承接层

这些文件更像承接层，不是当前默认删除对象，但它们会影响后续清理是否会留下“看起来还在、其实没用”的代码：

- `src/app/AppNavigator.tsx`
- `src/app/AppRoot.tsx`
- `src/app/useFeedController.ts`
- `src/app/useSearchController.ts`
- `src/app/useUserController.ts`
- `src/app/useMainTabScrollToTop.ts`
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

这次的目标不是“围着最近修过的地方继续挖”，而是把全项目里那些没有真实用途、只靠历史惯性留下来的代码分批清掉。
