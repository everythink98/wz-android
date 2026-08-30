# 回归语料库

## 文档职责

本文件只记录已经逃逸的历史事故：当时的用户症状、根因 seam、处置状态，以及当前由谁承接证据。当前产品行为以 `docs/product-map.md` 为准，测试方法以 `docs/testing-standard.md` 为准；普通通过测试使用行为标题，不再携带 REG ID。

历史条目不会因为测试合并或产品演进而删除。多个 REG 可以指向同一个 canonical owner；当前 owner 被更强证据取代时更新本文件，不复制完整测试清单。

## 状态模型

| 状态 | 含义 |
| --- | --- |
| `OPEN` | 已确认且尚未修复；必须由一个携带 canonical REG 的 expected-failure 保存最小失败 oracle。 |
| `RESOLVED` | 当前契约已有 canonical owner，历史事故不再决定测试结构。 |
| `SUPERSEDED` | 原契约已被明确的新模型取代；通过 `superseded-by` 指向后继事故。 |
| `EVIDENCE_GAP` | 事故或当前 owner 的证据不足；不得伪造两套预期。 |


## `REG-PERF-001` Library 切换重建列表、集中加载头像及历史写入全量清洗

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`FEED-01`、`FEED-02`、`FEED-03`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 收藏帖子、关注用户和历史之间切换时明显卡顿；Debug 基线出现 17%–32% 掉帧，最慢帧约 69–82ms。1000 条历史的 x86_64 Release 基线两批最慢帧中位数为 55.45ms / 51.9ms，History 就绪中位数为 702.5ms / 708ms。Topic 旅程中 20 次历史同步提交有 8 次超过 8ms，最慢 22ms；根因：`src/features/library/LibraryScreen.tsx` 的列表 identity、筛选提交、滚顶、Library 专属 `drawDistance` 和 `maintainVisibleContentPosition` 契约；`src/ui/avatar/Avatar.tsx` 是 Feed、Search、Library、Topic、User 共用的头像加载 seam；`src/domain/reader/readerData.ts` 与 `src/app/useReaderRuntime.ts` 共同约束历史写入和持久化。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-002` Topic/User 返回重复恢复同一 Topic session

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`TOPIC-04`、`USER-01`、`USER-02` |
| 历史症状与根因 | 从 Topic 或 User 返回时偶发卡顿或状态回滚；returning native route 已保留自己的可视 presentation，返回链路却又恢复整份 fallback snapshot，User 路径还再次 `openTopic`；根因：旧实现由全局组合层重放 Topic/User 返回状态，并让多个 native route 共享一个 Topic session；native stack 已经保留 route 实例，却又叠加 snapshot restore。当前所有权位于 `src/features/topic/TopicRoute.tsx` 与 `src/features/user/UserRoute.tsx`。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-NAV-002` 列表主题快速连点压入两个相同详情页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`LIBRARY-01`、`LIBRARY-03`、`USER-01` |
| 历史症状与根因 | 在列表中快速点击同一主题后进入两层相同 Topic；第一次返回仍停在重复详情，必须再返回一次才能回到列表；根因：`src/ui/topic/TopicCard.tsx` 是 Feed、Search、Library 和 User 主题列表的共享打开入口；旧实现每次 press 都直接调用 `onOpenTopic`，没有同步的重复激活门禁。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-NAV-003` 内部 Topic deep link 丢失目标楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-03` |
| 历史症状与根因 | 从内部 deep link 打开带楼层的四站 Topic URL 时进入了正确主题，但停在默认位置，没有定位到链接指定的回复；冷启动 pending 路径同样丢失目标；根因：internal open-link parser、pending queue 与 native Topic push 之间没有共享同一个 `RootStackParamList['Topic']` destination，语义身份在进入导航前被截断。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-PERF-003` Feed 来源切换把列表工作压进 Pager 收尾帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 首页左右切换来源时有明显停顿，高刷新率场景尤其容易看出；网络即使异步，目标来源的 React 提交、FlashList/TopicCard 创建和布局仍会与 Pager 收尾帧重叠；根因：`src/features/feed/FeedScreen.tsx` 的视觉来源、Query 来源、Pager idle 结算和列表物化边界；`src/features/feed/useFeedController.ts` 的来源切换入口。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-PERF-004` 双温缓存 Feed 横滑触发过量 native 绘制（已被冷激活模型取代）

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 相邻来源都有数据且已经预布局时，左右横滑仍有明显顿挫；请求时序正确也不能消除卡顿；根因：历史 seam 是 `src/ui/topic/TopicCard.tsx` 的 rich 绘制成本与 `src/features/feed/FeedScreen.tsx` 同时移动两棵 populated FlashList；当前方案删除后一项，不削减 TopicCard、Query、Gateway、Feed transport 或身份屏障。 |
| 当前 owner | superseded-by: `REG-PERF-006` |


## `REG-PERF-005` Feed 性能优化不得删减列表信息或视觉层级

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 横滑优化后 Feed 条目省略头像、图标、徽章背景、标签层级和点击/已读效果，并把多类信息压成单行；内容虽仍在字符串里，实际列表已不是优化前的样式；根因：`src/features/feed/FeedScreen.tsx` 到 `src/ui/topic/TopicCard.tsx` 的 presentation 分叉，以及 `TopicCard` 自持的扁平列表样式。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-PERF-006` Feed 目标列表先出现但二级导航慢一步，温缓存阻止重读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 左右横滑时目标列表已经可见，顶部来源和二级导航却仍停在旧来源，稍后才一起变化；离开再返回已访问来源时还直接复用旧列表，没有重新请求；根因：`src/features/feed/FeedScreen.tsx` 把视觉来源与 Query 来源混为同一生命周期，并允许 inactive scene 展示缓存列表；`src/features/feed/useFeedController.ts` 在来源切换时没有清除目标来源全部 Feed Query 变体。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-PERF-008` 嵌套 Topic 共用 presentation 且大正文同步挂载阻塞返回

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 从评论里的跨主题链接进入大主题后，在“正在读取主题”期间点击顶栏或 Android 返回没有立即离开；加载完成后返回也可能先闪白/灰空页。超长 opening body 虽然被分块，进入和返回时仍有明显同步卡顿；根因：旧全局 Topic runtime、presentation cache 与共享 list ref 让多个 native route 同时消费当前主题；详情列表又曾在 FlashList header 同步挂载全部 opening body chunk。当前 seam 是 `src/features/topic/TopicRoute.tsx` 的 route-local controller 与 `src/features/topic/components/TopicContentList.tsx` 的 list item/memo 输入边界。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-FEED-001` 首次加载出现两套 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04` |
| 历史症状与根因 | 首页首次读取空列表时，页面 Loading 与 Android 下拉刷新指示器同时出现；Smoke 仍可继续并最终通过；根因：`src/features/feed/FeedScreen.tsx` 的空态与 `refreshControl` 渲染契约。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-FEED-002` 切换来源或排序后列表没有回到顶部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | NodeSeek 从“新帖子”切到“新评论”后已有主题却看不到新列表首项，Replay 曾被误判为动态 Feed 无结果；根因：`src/features/feed/FeedScreen.tsx` 的单 active 列表 ref 与显式滚顶契约，以及 `src/ui/list/performance.ts` 的 Feed FlashList 位置策略。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-FEED-004` 单站刷新失败清空可信列表

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | 单站首页已经显示主题，用户下拉刷新遇到来源错误后，旧列表和下一页 cursor 被空失败响应覆盖，只剩错误提示；根因：`src/features/feed/useFeedController.ts` 的 `validateFeedPage` 在 Infinite Query commit 前拒绝失败响应，避免覆盖已经提交的可信 pages。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SOURCE-001` 聚合读取被单站凭据存储失败整体阻断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 历史症状与根因 | 任一来源凭据存储临时读取失败时，“全部”首页或搜索可能在发起站点请求前整体失败；linux.do 还可能把读取失败伪装成无凭据，继续匿名请求并隐藏错误；根因：`src/sources/readGateway.ts` 的聚合凭据装配与来源错误合并边界。 |
| 当前 owner | `src/sources/readGatewayContract.test.ts` |


## `REG-SOURCE-002` HTTP 成功但解析为空被当成有效页面

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 历史症状与根因 | 来源返回 HTTP 200 但页面结构已经无法解析时，首页、搜索、详情或用户页仍显示为成功；分页还会丢掉失败页 cursor、跳到下一页或误判没有更多内容；根因：`sourceDiagnosticSummary` 与 Feed/Search/Topic/User controller 的结果应用和分页 cursor 提交边界。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SEARCH-001` linux.do 高级筛选接受任意文本或旧候选污染新查询

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-03`、`SEARCH-04` |
| 历史症状与根因 | linux.do 标签和发帖人原本是可任意手输的文本框，可能提交站点不存在的值；快速改词时旧候选或旧 AI 响应还可能覆盖当前查询；空作者输入可能永久显示 Loading；关闭标签选择、切换分类再重开时，上一分类的同词候选可能重新出现并可点击；分页或详情返回后筛选也可能退回浅拷贝中的旧数组；根因：`src/features/search/SearchScreen.tsx` 的候选草稿交互、`src/features/search/useSearchController.ts` 的普通/AI/候选结构化 Query key、`src/features/search/searchRun.ts` 的深快照和合并、`src/sources/linuxdo/search.ts` 的候选接口。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-002` 分页失败隐藏已有结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 搜索第一页已有可打开结果时，继续加载失败会把整个来源的旧结果隐藏，只留下来源错误；用户既无法继续阅读，也无法确认重试的是失败页；根因：`src/features/search/useSearchController.ts` 在分页异常时虽合并回旧 `items`，却把 `hasMore/nextPage` 覆盖为结束态，验证完成回调还会重跑整来源；`src/features/search/listItems.ts` 遇到任何 `group.error` 都提前 `continue`，`src/features/search/SearchScreen.tsx` 的错误按钮也统一重跑整来源。 |
| 当前 owner | `src/features/search/listItems.test.ts` |


## `REG-SEARCH-003` linux.do 首帖搜索作者和头像丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03` |
| 历史症状与根因 | 已登录 linux.do 搜索明确命中首帖时仍显示“未知作者”，头像也不展示；标题、摘要和详情可用；根因：`src/sources/linuxdo/search.ts` 的 `topicsFromLinuxDoSearchData` 已按 `topic_id` 找到首帖，却只读取其 `blurb`；作者仍调用列表页的 `originalPoster(topic, users)`，因此被归一化为空。普通搜索和 AI 语义搜索共用该转换层。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SEARCH-013` Discourse 回复命中被丢弃或冒充楼主

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | linux.do 有真实回复命中却显示“内容无法解析”，或把命中回复者、最后回复者显示成主题作者；根因：`src/sources/linuxdo/search.ts` 曾丢弃缺少可靠 OP 的回复命中，或把命中 post/`last_poster_username` 归一化成主题作者。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SEARCH-014` Google JavaScript capability gate 被当成外部跳转

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 真实未登录设备上，NodeSeek 或 linux.do 搜索很快提示“页面跳转到外部地址，已停止读取”；同一关键词在 Android Chrome 可正常显示结果；根因：`src/features/account/HiddenBrowserHost.tsx` 曾把 hidden WebView 的每一次顶层导航都套用最终结果 URL 白名单；NodeSeek 生产 `webViewFetcher` 又只接收论坛域，导致 scoped Google 请求根本不进入 hidden WebView。后续若用论坛域/Google 的并集白名单代替 initial-task binding，还会让搜索任务跨域并错误结算。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-015` Google SearchGuard 访问故障被误报为外部链接

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | NodeSeek 未登录搜索提示跳到外部链接；原地“重试”仍显示外部链接，切换来源后再回来却成功，看起来像只有切站才真正重发；根因：`src/features/account/HiddenBrowserHost.tsx` 把 `is*BrowserNavigationUrl=false` 的所有原因压成“外部地址”，混淆了真实外部导航、另一搜索任务与 Google 自己的 SearchGuard 环境验证失败；来源切换并没有特殊恢复语义。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-016` 自动化结算节点撑高搜索页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 历史症状与根因 | 聚合搜索完成后，账号状态提示与第一组结果之间突然多出一大块空白；来源越多，额外间距越明显；根因：自动化结算状态被实现成生产布局节点，而不是既有可访问元素的状态。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-017` 未结算判断吞掉真实搜索 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 正常聚合搜索期间，某来源显示“等待账号状态”且没有 Spinner，看起来像账号卡住，而实际网络请求正在进行；根因：`searchGroupMeta` 与 `buildSearchListItems` 把请求生命周期的 `settled` 当成身份 pending，并放在更具体的 `loading` 前。 |
| 当前 owner | `src/features/search/listItems.test.ts` |


## `REG-SEARCH-018` NodeSeek 空搜索被旧页面壳误报为无法解析

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | NodeSeek 单站搜索特定关键词时稳定显示“搜索结果返回内容无法解析，请重试”，而普通关键词可返回结果；原站搜索页实际可能只是明确的空结果；根因：`src/sources/nodeseek/feedParser.ts` 的搜索解析器以正式 `.post-list` 为结果面，诊断器却把全页 `post-*` 链接及 embedded candidates 一起计入候选，制造 `candidateCount>0 + validCount=0` 的假 `parse_empty`。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SEARCH-019` 单站空结果仍显示继续加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站搜索已经显示“没有匹配结果”，列表尾部仍同时显示“继续下滑加载更多”，继续滚动还可能发起无意义的下一页请求；根因：`src/features/search/listItems.ts` 分别生成空态和分页哨兵，分页条件没有要求当前累计结果非空。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-020` 搜索来源 Tab 比首页明显偏大

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | 搜索页四站来源 Tab 比首页同一组来源明显更高、更宽，切换底部导航后视觉尺度跳变；根因：`src/ui/controls/SelectionControls.tsx` 同时提供默认 48dp Tab 与来源栏 compact Tab；`src/features/search/SearchScreen.tsx` 漏传 compact 语义，形成同一来源导航的两套尺寸。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-021` linux.do 搜索会话途中失效后没有切到 Google

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 聚合搜索只有 linux.do 长时间停留在“搜索中”；重新登录后同一页面才完成。请求开始时 App 仍把旧会话投影为已登录，因此没有采用原本已有的匿名 Google 搜索；根因：`src/sources/linuxdo/search.ts` 只在发请求前按 `authenticated` 选择一次协议，authenticated search 响应明确失效后没有转入同一 Adapter 已有的 `searchLinuxDoGoogle`；`fetchLinuxDoJson` 还把 200 登录页误作普通格式错误。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-022` linux.do Google 结果被渲染成“无标题”

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | L站未登录 Google 搜索出现“无标题”卡片；页面结构变化时还可能被误报为合法空结果；根因：`src/sources/linuxdo/search.ts` 的 Google 候选/标题提取、`src/sources/searchRead.ts` 的统一读取边界和 `src/ui/topic/TopicCard.tsx` 的展示兜底共同放松了标题契约。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-023` Google 同任务会话跳转被拦截或误报为 linux.do 外链

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-04`、`SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | L站匿名搜索被 Google 导航到同一个 `/search?q=...&sei=...` 后，App 错误拦截并显示“linux.do 页面跳转到外部地址”或“Google 搜索流程已变化”；真正的验证、登录、consent 与未知流程也缺少准确原因；根因：当时的 searchFallback 模块把 Google 生成的惰性会话参数与 site/query/page 任务身份混为一谈，且 `src/features/account/HiddenBrowserHost.tsx` 没有对其余拒绝原因做局部分类；该模块现已由 `REG-SEARCH-028` 删除。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-028` 匿名 L/NS 搜索把 Google HTML 当成 App 数据协议

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 历史症状与根因 | 未登录模拟器提交 linux.do 或 NodeSeek 搜索后出现伪空结果、结构变化错误或永久 Loading；Google WebView 卡在 JS/SearchGuard 时重开仍可能复现。用户能在浏览器看到结果，却不能可靠回到 App 原生主题；根因：App 把 Google 页面当成内部数据协议，同时试图在不拥有 `linux.do`、`nodeseek.com` 域名的情况下依赖普通结果点击自动拉起 App。搜索协议、浏览器导航与原生 Topic 接回的 owner 混在 adapter 和隐藏 WebView 中。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-LINUXDO-001` linux.do Cloudflare 429 被降级且大响应被截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 历史症状与根因 | linux.do 实际要求 Cloudflare 验证时，直连已识别为 `verification-required`，隐藏 WebView 却把主文档 429 提前报成普通未知错误；偶尔挑战后已得到 200，又因正文固定截断为 12,000 字符而 JSON 解析失败；根因：`src/sources/linuxdo/browserFallback.ts` 的 CF 分类、`src/features/account/HiddenBrowserHost.tsx` 的主文档生命周期、`src/features/account/useHiddenBrowserFetchController.ts` 的 bridge 序列化，以及 `src/features/account/useSessionController.ts` 的最终 Response/typed error 结算。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-002` linux.do 验证关闭重开并无限循环

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 历史症状与根因 | 首页聚合的 linux.do child 命中 CF 后面板不拉起，或检测一次后自动循环重开；只剩 V2EX 的 partial 内容还可能被当成新的账号/ReadPlan 状态；根因：`src/features/feed/useFeedController.ts` 的聚合 partial error 投影，以及 `src/features/account/useVerificationController.ts` 对 read recovery 与登录 surface 的责任边界。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-LINUXDO-003` 验证后的原页面恢复失败却提示成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 验证 Cookie 已保存，但原 Feed/Search/Topic/User 请求随后遇到普通网络或解析失败时，overlay 仍提示“页面已恢复”并关闭；写成功后的回复刷新也会被诊断为完整成功；根因：`LinuxDoReadResumeOutcome`、四类 read controller、引用帖恢复以及 `useVerificationController`/`useTopicActionsController` 对恢复终态的消费边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-LINUXDO-004` 过期 Cookie 被误判为已登录并阻断搜索

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | linux.do 原站已经显示“登录”，App 账号中心仍显示已登录；搜索继续调用登录接口并报限流，匿名外部 Google 搜索入口没有启用，写入口也可能继续按旧 Cookie 展示；根因：canonical `getCurrentUserProfile` 的服务端身份 oracle、`LINUXDO_WEBVIEW_PROBE_SCRIPT` 的页面登录探针，以及 `useVerificationController` 的 generation-safe 过期态提交。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-LINUXDO-005` 冷启动丢弃已确认终态并重新按 Cookie 猜登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已确认 linux.do 账号在每次冷启动先变 unknown/public，首页和搜索短暂换 lane、重复请求；或首次升级仅凭残留 Cookie 直接伪造登录；根因：`src/platform/storage/accountSessionStore.ts` → `useAccountStatusController` 本机恢复/一次性迁移 → ReadPlan/Search Query key。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-LINUXDO-006` 页面退出后的后台 Query 串扰验证与等级恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 用户已经离开 Search/Feed 后，旧搜索、AI 或分类请求仍在 More 页后台重启并拉起 linux.do、NodeSeek 或妖火面板；linux.do 验证开始后 Search 从登录 key 漂移到匿名 key，旧 recovery 失活，面板随即关闭又重开；“查看等级”命中 CF 时没有精确 recovery，验证流程清掉 Level cache 后反复取消、弹出或无法落地等级；根因：`useAppRuntime` 当前页面与各 route 的 `active` / 验证 overlay → Feed、Search、Account controller 的 Query 执行权；Search 的稳定认证模式 → 结构化 Query key 与 Gateway 参数；Level 的 exact active Query → `LinuxDoReadRecovery` 与 session reset 保留边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-LINUXDO-007` Account 网络探测失败后前台读取永久 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`TOPIC-03`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`USER-01` |
| 历史症状与根因 | 打开 linux.do Topic 后页面一直 Loading，既不请求 Topic，也不出现验证窗口；用户手动进入 linux.do 验证、保存状态并再次打开后才正常加载；根因：exact `/session/current.json` 的 canonical Account reader → direct/hidden WebView transport → 结构化身份检查终态 → `useAccountRuntime` 前台单站 intent → Feed/Search/Topic/User Query barrier 与验证面板。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-VERIFICATION-001` WebView 页面事件取代用户检测

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | linux.do、NodeSeek 或妖火面板在页面加载/跳转时自动保存、恢复或关闭；用户随后点击“检测状态/登录”却复用已消费的内部结果，没有重新读取当前凭据，最终出现“暂未生效”、旧结果覆盖新结果或开关循环；根因：WebView 的候选观察边界 → 用户显式检测的提交边界 → generation/session 所有权 → 原读取 recovery 的完成证明。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-VERIFICATION-002` 业务响应关键词被误判为验证页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | linux.do 搜索返回正常结果后却打开 CF 面板；面板显示已登录的普通首页，没有 challenge。用户点击“检测状态”时 WebView Cookie 已重新读取并保存，但恢复搜索再次被误判，于是仍提示“验证未生效”。NodeSeek 或妖火的 API、帖子正文出现相同关键词时也可能错误拉起验证/登录面板；根因：来源 transport 响应元数据与正文 → Cloudflare/访问验证分类器 → direct/WebView fallback → session recovery 与验证面板。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-VERIFICATION-003` 验证 WebView 使用伪造或过期 User-Agent

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04`、`FEED-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | NodeSeek Cloudflare 页面可以显示复选框，但用户每次点击后又回到未勾选状态，始终停留在 `Just a moment...`；相同身份错配也可能让 linux.do、NodeImage 或妖火的 WebView 会话不能被后续请求一致复用；根因：Android WebView provider 的默认身份 → NodeSeek、NodeImage、linux.do、妖火可见 WebView → probe/原生桥取得的真实 UA → Cookie/access 持久化 → 隐藏 WebView、媒体、读取与写操作。 |
| 当前 owner | `src/platform/android/androidWebViewUserAgentValue.test.ts` |


## `REG-VERIFICATION-004` 登录 WebView 超时后仍持续运行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`、`MORE-02`、`RELEASE-02` |
| 历史症状与根因 | 登录面板已经显示“页面打开超时”，但第三方页面仍在后台刷新；Android accessibility 无法读取 App 自有错误、刷新按钮或 `nodeseek-login-webview-settled`，Release Replay 永久等到失败；根因：登录面板 terminal outcome 与原生 WebView renderer 生命周期分属不同 state owner；timeout 被当成展示状态，而不是当前 generation 的结束边界。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-ACCOUNT-001` 身份读取失败覆盖已确认账号状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 历史症状与根因 | NodeSeek、linux.do 或妖火网站登录仍可能有效，但刷新账号状态时身份接口暂时失败，账号中心却把上次已确认的用户名清空并显示成新的 Cookie 状态；根因：`useAccountStatusController` 的站点检查终态与 `SiteSessionState` 的可信身份保留契约。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-002` 单站凭据读取失败阻断全部账号刷新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 历史症状与根因 | NodeSeek、linux.do 或妖火任一 SecureStore 读取暂时失败时，“刷新账号状态”直接整体中止，其余站点状态全部停留在检查中；根因：`useAccountStatusController` 的多站凭据装配、站点隔离和诊断终态。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-003` 启动时单站凭据读取失败阻断其他会话恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | App 启动时只要 NodeSeek、linux.do 或妖火任一安全存储读取暂时失败，其他站已经保存的有效会话也不会恢复，账号中心可能一直显示初始匿名状态；根因：`useSessionController` 启动 effect 的多站凭据恢复、generation 所有权和最终状态汇总。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-004` 妖火明确登录失效被清理事件覆盖

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 妖火已明确返回登录失效时，账号中心最终却显示普通未登录，用户看不到凭据已过期这一可恢复原因；根因：`useAccountController.checkYaohuoCookie` 的失效确认、凭据清理和最终 UI 事件顺序。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-005` NodeSeek 登录桥接接受非站点页面消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-03`、`MORE-02` |
| 历史症状与根因 | NodeSeek 登录 WebView 加载允许的 Cloudflare challenge 页面时，该页面伪造或碰撞 `nodeseek-login` 消息即可污染 App 保存的用户 ID、User-Agent 或 Cookie 候选；根因：`useAccountController.handleLoginMessage` 的 WebView 消息来源信任边界。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-006` 单站凭据摘要失败隐藏其他已保存凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-03`、`MORE-02` |
| 历史症状与根因 | 账号中心首次读取保存凭据时，只要一站 SecureStore 暂时失败，其他站已保存的账号摘要也全部显示为未保存；根因：`accountCredentialDiagnostics` 的部分结果契约与 `useAccountCredentialController` 的状态合并边界。 |
| 当前 owner | `src/features/account/credentialDiagnostics.test.ts` |


## `REG-ACCOUNT-007` 登录凭据未清完却显示已清除或覆盖失效错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户明确清除 NodeSeek、linux.do 或妖火登录后，界面提示已清除，但 WebView Cookie 仍可能保留；反过来，账号检测、刷新或写操作误判失效时如果复用这条破坏性事务，会把原站会话一起删掉并造成重复登录；根因：`useSessionController` 的 multi-store 清理提交顺序、credential generation 返回契约，以及破坏性清理能力的调用权限边界。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-008` 单站刷新收尾失败阻断其他账号状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 账号公共刷新已完成各站网络检查后，妖火或 linux.do 的过期清理、NodeSeek 身份持久化任一步失败，其他站状态都不再应用；linux.do 明确过期还会最终显示成普通未登录/已验证；根因：`useAccountStatusController` 的站点检查结果与后续 multi-store 提交、最终 SiteSessionState 投影边界。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-009` 旧账号刷新覆盖刷新期间保存的新会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户点击刷新账号状态或发起写操作后在站点登录完成，先启动的旧请求仍可能把 NodeSeek、linux.do 或妖火的新会话覆盖成未登录、检查失败或登录已失效，并为新会话弹出错误登录入口；根因：`useAccountStatusController`、`useTopicActionsController` 与各站 action client 的 credential snapshot、异步请求、过期清理和 SiteSessionState/动作结果提交边界。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-PROXY-001` 代理配置读取失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-01`、`MORE-04` |
| 历史症状与根因 | 用户原本依赖服务器代理时，启动阶段 SecureStore 暂时读取失败，App 把代理状态当作“未启用”并让来源、登录 WebView 或更新请求直接联网；根因：`useNetworkProxyRuntime` 的安全存储加载终态、native apply effect 与 `ensureNetworkProxyReady` 门禁。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-UPDATE-001` 更新检查期间可下载旧版本信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | 已显示旧更新信息时，用户快速连续点击“检查更新”和“下载并安装”，旧 APK 下载可在新 manifest 检查尚未结束时启动；根因：`useAppUpdateRuntime` 的 check/download 并发所有权与同步 busy ref 门禁。 |
| 当前 owner | `src/platform/update/useAppUpdateRuntime.test.ts` |


## `REG-NODESEEK-001` NodeSeek WebView/会话状态被错误证明

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 代码或桌面浏览器看似能访问 NodeSeek，但不能证明 App 内 WebView、现有 Cookie、返回链和后续读取仍然可用；根因：App 内 login/session/verification controller、Cookie bridge、WebView readiness 和 navigation 返回。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 历史症状与根因 | NodeSeek 登录 WebView 已显示“页面打开超时”或加载失败，Replay 仍因 ready testID 可见而通过；根因：`src/features/account/components/NodeSeekLoginHost.tsx` 的 WebView readiness/error 状态和对应 RNTL/Live 等待 oracle。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-NODESEEK-003` NodeSeek 真实页面已可用但 Replay 内部 marker 超时

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 历史症状与根因 | App 内 WebView 已出现可操作内容，Replay 却依赖第三方标题、logo、“新帖子”或 success-only 内部 marker；DOM 变化或桥接时序会让正确流程超时；根因：NodeSeek WebView 的设备级 oracle 及 `tests/tooling/android-smoke-guard.test.ts` 的 Replay 守卫；不是 NodeSeek 页面加载产品逻辑。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-DATA-001` ReaderData 实验与代码回退不兼容

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 新实验写入了旧代码不能读取的本机数据；代码回退后收藏、历史和关注看似丢失；根因：`src/domain/reader/readerData.ts`、`src/platform/storage/readerDataStore.ts`、备份导入和保存队列。 |
| 当前 owner | `src/domain/reader/readerData.test.ts` |


## `REG-OPS-001` 验证当前代码后留下旧 APK

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 开发构建验收通过后又恢复旧 Smoke APK，用户实际看到的仍是旧 bug；根因：安装/验收操作协议，而不是业务代码。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-002` 设备侧录屏分片耗尽 Replay 空间

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | `APK_SANITY` 已通过，但 Replay 在第一个业务步骤前因 agent-device 无法写入录屏恢复清单而失败；设备 `/sdcard` 曾残留 471 个工具录屏分片并达到 92% 使用率；根因：`scripts/run-device-replay.mjs` 的 Replay session、设备端 durable recording manifest、`screenrecord` 与录屏 scratch 生命周期，而不是 App、Cookie 或业务存储。旧 runner 曾按进程名/路径批量终止并删除，无法证明目标属于当前 Replay。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-003` Replay 把设备 ID 当成设备名称

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | runner 已按 `emulator-5554` 找到唯一设备并验证 APK 身份，但第一条 Replay 在 `open` 步骤报 `No device named emulator-5554`，全部设备旅程无法开始；根因：`scripts/run-device-replay.mjs` 同时承担设备发现与 Replay 调用：设备发现接受 ID 或名称，但 agent-device 0.19.0 的 test runner 按显示名称绑定设备。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-004` AVD 名与设备显示名不一致导致 Replay 被拒绝

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 同一发布命令已经完成正式构建、签名校验和 `APK_SANITY`，随后 Replay 在身份行前报“无法唯一匹配 Android 设备”，发布闸门无法收尾；根因：Smoke 的 boot/install 接受 AVD 名，`scripts/run-device-replay.mjs` 的设备发现却只接受 ID 或完全相同的显示名，没有处理 agent-device 对下划线与空格的展示差异。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-005` 覆盖安装后的首次启动逃出日志窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 覆盖安装后的第一次启动发生崩溃，但脚本随后清空本机日志文件并执行第二次健康 relaunch，最终仍可能输出 `APK_SANITY`；根因：`scripts/smoke-android.mjs` 把建立 agent-device session 的第一次 `open` 放在受检查日志窗口之外；第二次启动证据不能证明新 APK 的首次启动没有失败。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-006` Replay 自行关闭 session 导致录屏复活并丢失 manifest

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | `agent-device test --record-video` 报告单条 Replay 通过，但设备录屏仍在运行；约 170 秒后旧 daemon 启动下一分片并覆盖唯一 active manifest，安全门禁随后停止整批 Replay；根因：`tests/device/*.ad` 与 agent-device test harness 的录屏收尾顺序，而不是 `scripts/run-device-replay.mjs` 的所有权门禁。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-007` 空 manifest 或原子写入临时文件绕过录屏门禁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 设备仍有 `agent-device-recording-active.json.tmp` 或零字节 active manifest，runner 却认为录屏基线为空并继续启动下一条 Replay；根因：`scripts/run-device-replay.mjs` 的设备 scratch basename 解析只识别时间戳 MP4，manifest 读取又把空内容视为不存在。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-008` 允许的 agent-device 版本不支持 Replay 参数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 版本门禁接受 agent-device 0.14.0，但第一条 Replay 因不认识 `--record-video` 或可重复 `--reporter` 参数而在业务步骤前失败；根因：`scripts/agent-device-runtime.mjs`、`scripts/run-device-replay.mjs` 与 README 的工具版本契约不一致。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-009` 未登录 Replay 与主设备套件混用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02`、`ACCOUNT-01`、`FEED-01`、`SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 未登录旅程若在已有账号/Cookie 的主设备或 Release Smoke 上运行，会得到登录态结果或要求清除主设备数据；反过来，主设备基线也可能被未登录测试破坏；根因：文件发现目录、设备选择和 APK 身份校验没有把“普通保留数据设备”与“从未登录论坛的隔离 AVD”建模为两个外部环境。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-010` agent-device 诊断污染设备清单 JSON

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | Replay 在任何旅程和 APK 身份行之前失败，报 `Unexpected non-whitespace character after JSON`；根因：`scripts/agent-device-runtime.mjs` 的 capture 路径把 stdout 与 stderr 拼接后作为机器可读结果返回。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-011` runner 覆盖 Replay 自有超时预算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 四来源 Feed 与 Search 已拿到结果并进入最后详情，却在目标加载成功前后报整条 `TIMEOUT after 180000ms`；根因：`scripts/run-device-replay.mjs` 的命令行 timeout 覆盖 tracked Replay 的 `context timeout`。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-012` 版本升级未递增 Android versionCode

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01` |
| 历史症状与根因 | 新版本已发布，但旧客户端因 manifest 的 versionCode 没有高于已安装版本而无法收到或安装更新；根因：`scripts/check-version.mjs` 的 Git release baseline 与 `scripts/release-android.mjs` 的 fail-closed 发布入口。 |
| 当前 owner | `tests/tooling/version-check.test.ts` |


## `REG-OPS-013` release keystore 路径延迟失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01` |
| 历史症状与根因 | keystore 路径错误时，完整测试和 clean prebuild 后才在 Gradle 报错，且相对路径可能按 `android/app` 而不是仓库根解析；根因：`scripts/release-android.mjs` 的签名环境预检与 Gradle 环境传递。 |
| 当前 owner | `tests/tooling/release-signing.test.ts` |


## `REG-OPS-014` Android Smoke 自相冲突的设备 session

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | Release APK 已完成构建、签名与覆盖安装，首次打开却报 `DEVICE_IN_USE`，完整发布流程无法结算；根因：`scripts/smoke-android.mjs` 把一次 APK sanity 生命周期拆成了两个互斥的 agent-device session。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TOPIC-001` 回复已筛选但标题仍显示主题总数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 切换“只看楼主”或“只看带图”、或执行评论内查找后，可见回复已经减少，但“回复列表 N 条”仍显示主题原始总回复数；根因：`src/features/topic/components/TopicContentList.tsx` 的回复标题计数直接读取主题总数，没有区分当前可见结果与未筛选总数。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-002` 从阅读设置返回后主题详情丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04`、`NAV-03` |
| 历史症状与根因 | 从主题右上菜单进入“阅读设置”后切回首页，原主题详情已经被弹出，用户回到首页列表而不是继续阅读原主题；根因：旧全局导航入口曾复用 `changeScreen('more')`，导致 `popTo('MainTabs')` 移除 Topic；后续 snapshot 方案仍把 native stack 已拥有的 route state 复制到全局。当前 seam 是 `src/features/topic/TopicRoute.tsx` 与 `src/app/appNavigation.ts`。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-TOPIC-003` 评论引用改动误伤正文引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 调整评论引用卡片后，主题正文里的引用也跟着改变；默认简介和展开后的完整帖子混在一起，或展开后仍只看到简介。评论最外层还可能被误改成逐条卡片；根因：`src/features/topic/components/TopicContentList.tsx`、`src/features/topic/components/TopicBodyQuoteCard.tsx` 与 `src/features/topic/components/ReplyItem.tsx` 的两套展示入口；`src/domain/forum/quotedPosts.ts`、`src/features/topic/useTopicController.ts`、`src/features/topic/useTopicSessionController.ts` 的引用标识、加载和 session 缓存；`src/sources/linuxdo/reader.ts` 的简介/完整帖数据边界；`src/features/topic/styles.ts` 与 `TopicContentBlock` 的四站回复间距。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-004` 主题图片尺寸探测与显示各加载一次

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 完整刷新含块级正文图片的主题时，图片先在约 100×100 的小框里转圈，容器放大后又转一次圈，最后才显示图片；同一图片重进也会发生明显尺寸跳变；根因：`src/features/topic/rendering/contentMediaRenderers.tsx` 的旧实现曾同时使用 `react-native-render-html` 的 `useIMGElementState`（内部 `Image.getSize`）和按 URL 加载的 `ExpoImage`，把同一图片拆成“尺寸探测”和“最终显示”两个生命周期；RNRH 未知尺寸默认 100×100，因而产生小框、放大和第二个 Spinner。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-005` V2EX 评论刷新失败却记录成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04`、`MORE-02` |
| 历史症状与根因 | V2EX 详情中执行“仅刷新评论”遇到网络失败时，页面提示失败，但同一次评论刷新诊断仍以 `success` 结束，导出的诊断会误导排障；根因：`src/features/topic/useTopicController.ts` 的 V2EX `refreshTopicReplies` 委托分支只判断 Promise 已结束，没有核对 Topic Query 是否成功写入了新数据。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-006` 图片保存快速双击写入重复文件

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片预览中快速点击两次“保存图片”，App 并行下载并向系统媒体库写入两份相同图片，随后还弹出两次成功提示；根因：`src/features/topic/media/useImagePreviewController.ts` 的保存动作没有同步 busy gate，Modal 按钮的每次点击都会创建独立异步任务。 |
| 当前 owner | `tests/ui/topic/image-preview-controller.test.tsx` |


## `REG-TOPIC-007` 同一引用被多个实例加载时重复请求或串错状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 同一正文或评论引用出现在多个位置并同时展开时，会重复读取同一楼层，或让一个实例的 Loading、内容和错误串到另一个 reference。离开原 Topic 后，旧引用与 linux.do 验证恢复还可能继续结算；根因：`src/features/topic/useTopicController.ts` 的引用 instance 状态与 TanStack Query 远端状态边界，以及 `src/platform/query/serverState.ts` 的结构化 reply key。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-WRITE-001` 首次投票后参与人数未更新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在 linux.do 首次提交投票成功后，所选项和票数已经更新，但当前页面的参与人数仍保持提交前的数值；根因：`src/domain/forum/topicActionState.ts` 的 `applyPollVoteToPolls` 只更新 `voted`、选中项和选项票数，没有同步参与人数。 |
| 当前 owner | `src/domain/forum/topicActionState.test.ts` |


## `REG-WRITE-002` 妖火收藏成功被误报为结果不明

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在妖火主题点击“原站收藏”后，原站已经把主题加入收藏夹，但 App 丢失重定向证据并提示“操作结果无法确认”；根因：`src/sources/yaohuo/actionClient.ts` 的请求 helper 只返回 HTML、丢弃最终 `Response.url`；通用解析器正确地拒绝从长页面文本猜测成功，却也无法知道该请求已经同源跳到收藏夹。旧开源代码中的二次表单流程与当前线上行为不一致。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-WRITE-003` 妖火收藏无法取消且页面不显示已收藏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 妖火原站收藏成功后，App 详情页仍显示未收藏样式；再次点击仍执行添加，无法从 App 取消收藏；重新进入主题也不能恢复原站收藏状态。收藏列表暂时不可用时，主题正文和回复也会一起加载失败，或者未知状态被误显示成“未收藏”；根因：`src/sources/yaohuo/actionClient.ts` 只返回成功文案并丢弃收藏记录 id；`src/features/topic/actions/useTopicActionsController.ts` 始终构造添加请求且不应用状态；`src/sources/yaohuo/reader.ts` 未读取原站收藏状态，并曾把可选收藏查询放进主题加载的必需 `Promise.all`；旧全局 Topic runtime / 详情列表曾把 `undefined` 强制转换成 `false`，无法区分“未收藏”和“状态未知”。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-WRITE-004` 妖火收藏触发整页忙碌闪动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在妖火主题点击收藏或取消收藏时，整页操作区会短暂变灰并闪动，而不是只更新收藏按钮；根因：`src/features/topic/actions/useTopicActionsController.ts` 把所有 pending mutation 都计入全局 `actionBusy`，没有沿用 `MutationVariables.busy`；收藏请求因此无法选择非全局忙碌路径。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-005` 妖火收藏确认后正文被重新提交并闪烁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 点击妖火“原站收藏”或“取消原站收藏”后，最终滚动位置看似不变，但正文会在约 170 ms 内闪一下；含图正文会短暂退回灰色 loading 占位，单张操作前后截图容易漏掉；根因：`src/features/topic/rendering/useHtmlRenderingController.tsx` 的链接处理曾直接依赖原始 `topicDetail`，导致 HTML renderer registry 重建；同时旧全局 Topic runtime 传入 route 的多个 action callback 闭包随原始详情换引用，嵌在 route renderer 内的收藏 Context 又使整棵 Topic screen 被重新提交。为稳定这些引用而在 render 阶段写 ref 又会让被 React 丢弃的 render 泄漏未提交状态。FlashList/HTML 图片因此可能重新进入加载态或采用错误引用。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-WRITE-006` 阅读设置返回覆盖已确认的原站收藏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03`、`TOPIC-04`、`NAV-03` |
| 历史症状与根因 | 妖火原站已经确认收藏或取消，但用户在请求期间打开阅读设置，返回后按钮恢复成请求前状态，App 与服务器不一致；根因：复制 route state 产生了第二个所有权；action 更新当前 Query/route 后，snapshot restore 又写回旧值。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-WRITE-007` NodeSeek 投票读取失败且提交后伪造票数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 主题正文保留 `nsapp://vote` 原始标记而没有可用投票卡片；多个投票标记中一个读取失败时详情仍被误报为完整成功。提交成功后 App 又只做本地 `+1`，把原站未返回的未知票数显示成 `1`，与刷新后的服务端结果不一致；根因：`src/sources/nodeseek/polls.ts` 的 NodeSeek 投票协议、`src/sources/nodeseek/topicParser.ts` 的标记解析、`src/sources/nodeseek/reader.ts` 的投票读取/清理和 partial 诊断、`src/sources/nodeseek/actionRequest.ts` 与 `src/sources/nodeseek/actionClient.ts` 的投票专用请求、`src/features/topic/actions/useTopicActionsController.ts` 的写后同步，以及 `src/domain/forum/topicActionState.ts` 的服务端快照/未知计数合并。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-WRITE-008` NodeSeek 不可逆投票未经确认直接提交

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 用户在 NodeSeek 投票卡片点提交后立即产生不可逆远端写入，没有机会核对选项或取消；根因：`src/features/topic/actions/useTopicActionsController.ts` 的站点分流与 non-idempotent mutation task；确认边界属于 NodeSeek，不属于公共 `TopicPolls` 或其他站点协议。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-009` NodeSeek 投票脱离正文被追加到底部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原帖中的投票标记位于正文中间，但 App 删除标记后把投票卡片统一追加到整段正文末尾，改变了原帖阅读顺序；根因：`src/sources/nodeseek/polls.ts` 的成功标记替换和正文分片、`src/sources/nodeseek/topicParser.ts` 的渲染表单占位，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的逐来源正文渲染边界。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-WRITE-010` NodeSeek 投票替换破坏正文段落并导致内容重叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`WRITE-03`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek 投票帖在 App 中残留字面量 `">`，投票卡片前后各多出一条正文分隔线；投票后的文字与 sticker 在底部重叠，而原站同一正文没有这些问题；根因：`src/sources/nodeseek/topicParser.ts` 的原站渲染 HTML 提取/投票表单替换、`src/sources/nodeseek/polls.ts` 的残留 marker 清理，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的正文树与自定义投票 renderer 边界。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-ACCOUNT-010` NodeImage 旧授权与上传覆盖已清除凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | 用户取消授权或清除 NodeImage API Key 后，较早的保存、读取或上传仍可能迟到，重新写回旧 Key 或把旧上传结果插入当前草稿；根因：`src/sources/nodeimage/authFlow.ts` 的 phase/nonce、`src/features/account/useNodeImageAuthController.ts` 的 NodeSeek preflight/final reconcile、`src/platform/network/loginWebViewScripts.ts` 的注入边界、`src/sources/nodeimage/credentials.ts` 的 owner/generation，以及 `src/features/topic/actions/useTopicActionsController.ts` 的上传结果所有权。 |
| 当前 owner | `src/sources/nodeimage/authFlow.test.ts` |


## `REG-ACCOUNT-011` 隐藏 WebView 接受伪造来源的读取结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04` |
| 历史症状与根因 | 恶意或被跳转的页面可以发送一个声称来自 NodeSeek 或 linux.do URL 的完成消息，使 App 接受非目标页面的 HTML、Cookie 或状态；根因：`src/features/account/useHiddenBrowserFetchController.ts` 对原生 message event URL 与 payload URL 的双重来源校验。 |
| 当前 owner | `tests/ui/account/hidden-browser-fetch-controller.test.tsx` |


## `REG-ACCOUNT-012` document.cookie 覆盖并丢失完整会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 隐藏 WebView 只回传 JavaScript 可见 Cookie 时，App 用它替换完整已存候选，导致 HttpOnly Cookie 摘要丢失并让后续身份判断基于不完整候选；根因：`src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的候选 Cookie 合并，以及把身份候选误当成 transport Cookie 的旧边界。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-013` NodeSeek 缺失 Cookie 未归类为会话失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已进入 NodeSeek 写操作但本机 Cookie 缺失时，只收到泛化“缺少凭据”错误，UI 无法进入明确的重新登录流程；根因：`src/sources/nodeseek/actionClient.ts` 在发请求前对空凭据的 typed source/login-required 分类。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-ACCOUNT-014` 损坏的会话存储被当成匿名

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | NodeSeek 或 linux.do 保存的会话 JSON 损坏后，App 把读取结果当成“未登录”，可能覆盖现场并隐藏真正的数据损坏；根因：`src/platform/storage/legacyCookieSnapshotMigration.ts` 与 `src/platform/network/managedCookies.ts` 的旧快照迁移、准确原生读取和错误分类。 |
| 当前 owner | `src/platform/storage/legacyCookieSnapshotMigration.test.ts` |


## `REG-ACCOUNT-015` 单个 Cookie 故障中止其余清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 清除站点登录时，一个 URL 读取或一个 Cookie 删除失败会阻止其他可达 Cookie 清除；已成功删除的 Cookie 也可能未 flush，却被误报为清理完成；根因：`plugins/withNetworkProxyModule.js` 生成的 `clearManagedLoginCookies` 对全部目标 Cookie、主线程 callback、回读确认与错误聚合的顺序。 |
| 当前 owner | `src/platform/network/managedCookies.test.ts` |


## `REG-DATA-002` 旧保存失败后设置写入丢失资料快照

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02` |
| 历史症状与根因 | 一次收藏/历史保存失败后，紧接着只改阅读设置，后一次成功写入可能只带设置而漏掉最新 ReaderData；根因：`src/app/useReaderRuntime.ts` 的提交队列与完整快照基线。 |
| 当前 owner | `tests/ui/library/reader-data-controller.test.tsx` |


## `REG-DATA-003` 配对写入与回滚双失败后仍继续保存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | ReaderData 已写入但 settings 写失败，连旧快照回滚也失败后，磁盘状态未知；后续 queued 保存仍继续，可能永久覆盖可恢复现场；根因：`src/platform/storage/readerDataStore.ts` 的原子补偿和 `src/app/useReaderRuntime.ts` 的未知状态熔断。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts` |


## `REG-DATA-004` 未知磁盘状态下相同备份被跳过

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-03` |
| 历史症状与根因 | 配对写回滚失败后，用户导入内容恰好与内存相同的备份，JSON 相等优化会跳过物理写，损坏或未知的磁盘仍未恢复；根因：`src/app/useReaderRuntime.ts` 的 no-op 去重与恢复强制写边界。 |
| 当前 owner | `tests/ui/library/reader-data-controller.test.tsx` |


## `REG-DATA-005` 关注用户统计保留非法值并漏算零值

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`USER-02`、`LIBRARY-02` |
| 历史症状与根因 | 老备份或异常来源中的负数、小数统计直接出现在关注用户；妖火主题或回复数为 0 时，总贴数又被当成缺失；根因：`src/domain/reader/readerData.ts` 的 UserProfile 统计清洗和妖火派生字段。 |
| 当前 owner | `src/domain/reader/readerData.test.ts` |


## `REG-FEED-005` 单站分类错误被当成空分类

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | 进入单站时分类请求失败，筛选栏静默显示为空，用户无法区分“该站无分类”和“加载失败”；根因：`src/features/feed/useFeedController.ts` 的单站 category 结果应用和错误通知边界。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-PROXY-002` 快速代理操作应用未提交或过期配置

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 快速保存、切换、启用或关闭代理时，原生层可能应用尚未持久化的配置或较早 profile；保存未改动的启用 profile 还可能让可用代理变成错误状态；根因：`src/platform/network/useNetworkProxyRuntime.ts` 的持久化队列、native apply 队列与 committed state。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-PROXY-003` 代理状态损坏后无法恢复直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 安全存储中的代理配置无法读取时，App 正确 fail-closed，但 UI 没有恢复入口，所有网络能力永久被阻断；根因：`src/platform/network/useNetworkProxyRuntime.ts` 的 recovery command 与 `src/features/more/components/NetworkProxyModal.tsx` 的显式直连重置入口。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-SEARCH-004` 单站重试被其他站错误误判失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | “全部”搜索中重试一个失败来源，该来源已经成功返回，但其他来源保留的错误让这次重试仍提示失败；根因：`src/features/search/useSearchController.ts` 的来源级 retry completion 与聚合错误保留。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-005` 失败分页混入部分结果并推进 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站下一页返回部分条目同时带错误时，App 仍追加这些条目并推进 cursor；用户重试会跳过失败页或得到重复/缺口；根因：`src/features/search/useSearchController.ts` 的分页错误门禁、append 与 cursor commit 顺序。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-006` 未提交的 disabled Query 锁死首次搜索

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | 首次进入搜索页并输入关键词后，提交按钮仍是 disabled；点击没有网络请求，结果页永久停在“按键盘上的搜索键开始”；根因：`src/features/search/useSearchController.ts` 的 `searchBusy` 直接读取 disabled Query 的 `isPending`，没有先判断是否已经提交业务查询。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-007` 聚合搜索自动打开单站登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04`、`ACCOUNT-02` |
| 历史症状与根因 | 用户执行“全部”搜索时，某站需要登录或验证会突然打开该站 WebView/验证面板，打断其他站结果的渐进展示；根因：`src/features/search/useSearchController.ts` 的生产 effect 没有聚合门禁；旧单元测试只调用生产链路未使用的 action helper，因此在错误实现下仍通过。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-008` 聚合刷新失败隐藏错误并伪装旧结果成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | “全部”中某站已有预览时再次搜索或重试，该站刷新失败后仍只显示旧结果，没有错误或重试入口，看起来像本次刷新成功；根因：`src/features/search/useSearchController.ts` 的 aggregate group 投影先返回 `query.data`，导致 `SearchPageError.result` 永远不可见。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-TOPIC-008` linux.do 正文用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`NAV-02` |
| 历史症状与根因 | 点击 linux.do 正文中的 `/u/alice` 会离开 App 打开外部页面，无法进入现有用户详情和返回链；根因：`src/domain/forum/links.ts` 的 forum user link 解析、base URL 解析与受信来源映射。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-009` 评论查找把高亮插入 HTML 属性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 评论内查找的关键词出现在带引号且含 `>` 的属性时，App 把 `<mark>` 插进 attribute，破坏链接或正文 HTML；根因：`src/domain/forum/text.ts` 的 quote-aware HTML token scanning 与高亮边界。 |
| 当前 owner | `tests/integration/feature-helper-contracts.test.ts` |


## `REG-TOPIC-010` 长按复制泄漏 HTML 属性片段

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 长按复制含 `title="1 > 0"` 等属性的评论时，剪贴板混入属性后半段，而不是纯可见正文；根因：`src/domain/forum/text.ts` 的 `stripHtml` 可见文本提取。 |
| 当前 owner | `tests/integration/feature-helper-contracts.test.ts` |


## `REG-TOPIC-011` Sticker 属性中的大于号破坏正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek sticker 的 `title` 或其他引号属性包含 `>` 时，sticker 被切断、删除或把后续正文吞掉；根因：`src/domain/forum/forumContentMedia.ts` 在 sticker/image regex 前的 quoted-tag normalization。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-TOPIC-012` 通用 HTML 文本与 mention 解析误切属性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | HTML 属性含引号 `>` 时，可见文本提取泄漏属性碎片；同一标签上的用户 mention 也可能失去 App 内 mention 样式和导航；根因：`src/domain/forum/html.ts` 的共享 `textContentFromHtml` 与 `src/domain/forum/topicContentHtml.ts` 的 render normalization。 |
| 当前 owner | `tests/integration/html-sanitization-contracts.test.ts` |


## `REG-TOPIC-013` 妖火裸域主题链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-02` |
| 历史症状与根因 | `https://yaohuo.me/bbs-654.html` 被样式标为站内链接，却仍通过外部浏览器打开；根因：`src/domain/forum/links.ts` 的妖火 host allowlist 与 canonical topic URL。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-014` 图片下载无超时导致保存永久忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 远程图片下载永不 resolve 时，保存操作和忙碌状态永久悬挂，用户无法得到失败反馈或重试；根因：`src/platform/media/imageSave.ts` 对远程图片下载复用受控 `fetchWithTimeout` 的边界。 |
| 当前 owner | `src/platform/media/imageSave.test.ts` |


## `REG-TOPIC-015` 现代图片格式被错误保存为 JPG

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | AVIF、HEIC、APNG 或 BMP 图片下载后被命名为 `.jpg`；动态地址返回 SVG 等与 URL 后缀不同的图片时，又会沿用误导性后缀，导致扩展名与字节内容不一致，图库或分享应用可能无法识别；根因：`src/platform/media/imageSave.ts` 的 URL/Content-Type 图片扩展名归一化。 |
| 当前 owner | `src/platform/media/imageSave.test.ts` |


## `REG-TOPIC-016` V2EX 致谢数被图标属性截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | V2EX 回复致谢图标属性包含引号 `>` 时，致谢数缺失或解析错误；根因：`src/sources/v2ex/reader.ts` 的 thanks 文本提取改用共享 `textContentFromHtml`。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-017` 分享与剪贴板连续失败时异常逃逸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04` |
| 历史症状与根因 | 系统分享失败后，作为 fallback 的剪贴板复制也失败，点击事件 Promise 被拒绝且用户没有任何反馈；根因：`src/features/topic/shareTopic.ts` 的双层 fallback 收口与 `src/features/topic/TopicRoute.tsx` 的菜单调用。 |
| 当前 owner | `src/features/topic/shareTopic.test.ts` |


## `REG-TOPIC-018` Android 不兼容的动态 SVG 被当作图片加载失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 主题里的报告图片 URL 以 `.png` 结尾、实际返回 `image/svg+xml` 时，Android 正文显示“图片加载失败”；简单改成 data URI 仍使用同一 AndroidSVG decoder，全屏也可能空白；根因：`src/platform/media/compatibleImageSources.ts` 的 SVG document artifact、`src/features/topic/rendering/previewRenderers.tsx` 的海报 native view/几何、`src/ui/media/ImagePreviewModal.tsx` 的全屏 renderer 切换。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-019` NodeSeek 私有媒体在预览和保存时丢失实时会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek 受保护图片可在正文中显示，点开全屏、播放视频或保存时却重新发起匿名请求，或继续使用持久化旧 Cookie，得到登录页、403 或加载失败；根因：原生 managed OkHttp client、Expo Image loader、`src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Video source、图片预览与 `src/platform/media/imageSave.ts`。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-020` Android 不兼容 SVG 在非当前预览页抢占昂贵恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 多图预览会让当前原图与相邻复杂 SVG 同时启动 Chromium/海报兼容恢复，导致当前图片继续等待、手势掉帧或出现多份昂贵渲染；根因：`src/ui/media/ImagePreviewModal.tsx` 的页面 active 状态与 `src/platform/media/compatibleImageSources.ts` 的兼容恢复入口。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-022` 凭据观察事件取消正在执行的同站 Query

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`USER-01`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek 主题详情或关注用户页进入后长期停在“正在读取”；网络请求本可成功，但页面既不显示结果也不进入可重试失败态。真实登录切换、过期或清除时还可能继续显示旧会话的首页、搜索、详情或用户数据。妖火及其他复用同一会话事件边界的读取存在同类风险；根因：`src/features/account/useSessionController.ts` 的 workflow 事件分类与 session epoch、`src/platform/query/serverState.ts` 的 source/`all` Query cache 边界，以及 TanStack Query observer 的取消结算语义。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-TOPIC-023` 回复分页验证恢复重取旧页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`TOPIC-01`、`ACCOUNT-02` |
| 历史症状与根因 | linux.do 回复第二页遇到验证后完成验证，界面提示恢复完成，但新回复没有出现；再次加载仍可能重复进入验证或网络请求；根因：`src/features/topic/useTopicController.ts` 的 Infinite Query error 类型、精确验证恢复操作与 `ReplyPageParam`。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-UPDATE-002` 系统未打开安装确认却提示已开始

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | Android 原生安装请求返回 `false`、没有显示系统确认页时，App 仍提示安装已开始或成功；根因：`src/platform/update/appUpdate.ts` 的 APK 检查、安装请求返回值与 controller 成功提示契约。 |
| 当前 owner | `src/platform/update/appUpdate.test.ts` |


## `REG-UPDATE-003` Release manifest 接受任意自洽 signer

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 历史症状与根因 | Release 资产被替换后，攻击者可用另一把私钥生成 APK 和自洽 manifest，App 下载完成后才依赖系统安装器拒绝，不能在检查更新阶段指出 signer 不可信；根因：`src/platform/update/appUpdate.ts` 的 manifest trust root 与 `app.json` 的 `expo.extra.releaseSignerSha256`。 |
| 当前 owner | `src/platform/update/appUpdate.test.ts` |


## `REG-UPDATE-004` APK 检查把签名历史的最老证书当作当前 signer

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 历史症状与根因 | APK 存在签名历史时，检查器返回旧证书摘要；多 signer APK 还可能任选第一个，导致错误接受或拒绝；根因：`plugins/withApkInstaller.js` 生成的 `ApkInstallerModule.apkSignerSha256`。 |
| 当前 owner | `plugins/withApkInstaller.js` |


## `REG-USER-001` 用户页跨 Tab 分页留下永久忙碌 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 主题分页尚未完成时切到回复并加载更多，其中一个 tab 会接管共享请求状态；另一个 tab 的 cursor 永久 busy，切回后无法重试；根因：`src/features/user/useUserController.ts` 的 profile Query 与 topics/replies 两个 Infinite Query 的 key、`pageParam` 和派生状态边界。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-USER-003` 妖火裸域用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`NAV-02` |
| 历史症状与根因 | 妖火裸域 `userinfo.aspx` 链接无法进入 App User，而是外部打开；根因：`src/domain/forum/links.ts` 的妖火 user host 识别和参数提取。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-USER-004` Discourse 公开用户 Tab 被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`NAV-02` |
| 历史症状与根因 | linux.do的 `/u/alice/summary`、`/activity` 等公开 profile tab 被外部打开，尽管 App 已有同一用户页；根因：`src/domain/forum/links.ts` 的 Discourse public profile suffix allowlist。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-USER-005` 新用户的零统计被当成缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`LIBRARY-02` |
| 历史症状与根因 | 新用户明确有 0 主题、0 回复或 0 帖子时，App 隐藏统计，用户看到的状态与来源不一致；根因：`src/sources/linuxdo/account.ts`、`src/sources/nodeseek/protocol.ts`、`src/sources/yaohuo/normalization.ts` 与 `src/sources/v2ex/reader.ts` 的可选非负统计归一化。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-USER-006` Profile 已显示 cursor 但 Infinite Query 尚未接管分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 用户页已经显示首屏和“可继续加载”，此时立即加载更多却没有任何网络请求、错误或提示；稍后再试才可能生效；根因：`src/features/user/useUserController.ts` 的 Profile Query 首屏 seed、两个 Infinite Query observer 与分页命令提交边界。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-WRITE-011` 删除回复后本地详情仍保留楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 服务器已确认删除回复，但当前详情和回复分页仍显示该楼层、回复数不变；若编辑器正回复该楼层，还会继续指向不存在对象；根因：`src/features/topic/useTopicSessionController.ts` 的 `reply-deleted` action update、列表去重和 composer target 收口。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-012` 妖火缺少确认链接仍被报告删除成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02` |
| 历史症状与根因 | 妖火删除预备页只含“确认删除”等普通文案但没有可执行确认 URL 时，App 仍提示删除成功，实际回复尚在；根因：`src/sources/yaohuo/actionClient.ts` 的两阶段删除协议、same-origin confirmation link 与结果分类。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-WRITE-013` NodeSeek 暴露未确认的删除入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02` |
| 历史症状与根因 | NodeSeek 回复菜单显示“删除”，点击后只能进入不受支持或失败路径；原站当前没有已确认的删除协议；根因：`src/domain/forum/sourceCatalog.ts` 的逐来源、逐 action capability。 |
| 当前 owner | `src/domain/forum/sourceCatalog.test.ts` |


## `REG-WRITE-014` 异常百分号文件 URI 使图片上传崩溃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04` |
| 历史症状与根因 | 系统图片选择器返回文件名含残缺 `%` 转义的 URI 时，上传前 `decodeURIComponent` 抛错，图片被丢弃或事件链异常退出；根因：`src/sources/nodeimage/upload.ts` 的 asset filename normalization。 |
| 当前 owner | `tests/integration/image-upload.test.ts` |


## `REG-WRITE-015` NodeSeek 签到复用残留 Topic mutation 身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04` |
| 历史症状与根因 | 离开 linux.do 或妖火详情后从账号中心执行 NodeSeek 签到，操作可能按上一个 Topic 串行并取消其详情/回复 Query，签到的 mutation 诊断来源也错误；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 TanStack Mutation key/scope 与 NodeSeek 全局账号动作边界。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-016` 账号状态与 Topic 写入口读取相反的会话投影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 账号中心显示某站已登录，但详情没有应有写入口；或账号已进入验证/失效状态，详情却继续开放回复；根因：`src/features/account/useAccountRuntime.ts` 向 `src/features/topic/TopicRoute.tsx` / `actions/useTopicActionsController.ts` 投影 writable session 能力的边界。 |
| 当前 owner | `src/features/topic/actions/topicActionDecision.test.ts` |


## `REG-ACCOUNT-018` 等级刷新失败被保留的旧数据误报为成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04` |
| 历史症状与根因 | linux.do 等级成功加载过一次后，再次刷新失败仍提示成功并继续展示旧等级，用户无法知道本次请求失败；根因：`src/features/account/useAccountController.ts` 的刷新结果投影先判断 retained data，再判断当前 error。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-019` 三站登录态投影不一致

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 当前登录已经失效，搜索 transport 已回退 Google，但 More 与搜索状态灯仍显示已登录，Topic 写入口也可能继续开放；公开页里的业务文案或旧 Topic 身份又可能被误当当前用户；修复共享缓存 seam 时还可能把旧登录带进新 generation 或误清其他站身份；根因：当前凭据验证与按 ID 公开资料、Topic 身份或 Cookie 候选混用；WebView probe 缺少文档所有权；妖火把业务文字或“未识别为退出”当成功；Discourse reader 没有完整区分明确匿名与协议不确定；Account Query 与 session epoch 更新时序既可能擦掉刚提交的身份结果，也可能通过全局 previous data 保留旧登录。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-020` 妖火检测成功但重启后登录丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户已在 App 内妖火页面登录，点击“检测登录”能立即显示真实账号；强制结束并重启 App 后却又变成未登录，后续每次进入都要求重新登录；根因：`src/sources/yaohuo/reader.ts`、`src/sources/yaohuo/actionClient.ts` 的显式 Cookie 与原生 CookieJar 双重所有权，以及 `src/features/account/useAccountController.ts` 的 verifier 候选与 transport 身份边界。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-ACCOUNT-021` linux.do 已登录但检测只保存验证信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`MORE-02`、`SEARCH-04`、`WRITE-01` |
| 历史症状与根因 | App 内 linux.do 页面已经显示当前账号，点击“检测状态”却只保存 Cloudflare 验证信息，弹层与其他入口没有同步成已登录；重启后读取账号接口又能显示真实账号；根因：`src/features/account/useVerificationController.ts` 的 WebView probe 发起、当前文档所有权和手动检测结算边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-ACCOUNT-022` NodeSeek 登录成功后仍回到游客页并反复验证

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02` |
| 历史症状与根因 | 用户在 App 内完成 NodeSeek 账号提交和 Cloudflare 验证，站点已签发新身份 Cookie，却跳回游客首页；再次填入或检测会重新加载 WebView、重新拉起验证，形成“登录成功但仍未登录”的循环；根因：原生 `clearManagedLoginCookies` 对 Cookie 身份与完成条件的建模，以及登录 WebView 把消息 attempt 错当组件身份。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-ACCOUNT-023` 普通凭据读取把已确认登录降级

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原站和 More 刚确认已登录，切到 Search 后却立即显示匿名外部 Google 搜索入口且状态灯熄灭；Topic 写入口也可能随普通读取关闭。linux.do 隐藏读取和妖火 Cookie 恢复存在同类风险；根因：`src/features/account/useSessionController.ts` 的被动凭据生产者与 `src/domain/session/siteSessionState.ts` 的身份 reducer 共用一个布尔字段，缺失证明和明确登出没有分开；低可信 Cookie 事实因此覆盖高可信 current-user 结论。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-ACCOUNT-024` NodeSeek 不存在的当前账号端点触发登录 Cookie 清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原站和账号中心已经显示登录，离开后刷新账号状态却变成失效；再次进入原站发现账号也被退出，用户必须重新登录；根因：个人中心初版把带 ID 的公开资料路由推测成了无 ID 的当前账号路由，又把未经验证的 HTTP 状态提升为明确游客证据；`src/features/account/useAccountStatusController.ts` 随后正确但破坏性地信任 typed expiry 并清理 Cookie。当前 NodeSeek 前端只用 `/api/account/getInfo/{id}` 读取公开资料，并从页面注入的 `__config__.user` 读取当前用户；日志中 `user GET 404 text/html → clear-login-only → login-cleared → login-expired` 构成完整事故链。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-025` 臆造当前身份接口或失效语义导致误登录/误清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户在原站确实已登录，账号刷新却因一个推测接口或未经契约证明的 HTTP 状态变成失效并清掉登录；反向场景中，代码只因为 Cookie、公开资料或普通页面内容存在就显示已登录。妖火已登录时，手动检测还可能被写死的 `sidyaohuo` 名称门禁提前挡住，或只保存数字 ID；已经从当前页证明本人身份后，公开资料补全失败又会错误地把账号打回未登录；根因：当前身份 endpoint 的来源门禁、每站登录/退出证据与破坏性清理权限，以及“验证当前凭据”和“读取公开资料”的边界。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-026` App 快照回灌或自动清理破坏原站 WebView 会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户已经在原站 WebView 登录，账号检测或刷新偶发误判后，重新进入原站发现登录被清掉并被迫反复登录；另一种表现是隐藏 fallback 把 SecureStore 旧 Cookie 作为首跳 header 写回 WebView，使旧会话覆盖当前原站状态。某些账号虽然有可验证候选，却因为缺少一个写死的 Cookie 名而直接显示未登录；根因：原站 Cookie jar、App 内请求快照和登录投影没有明确所有权；破坏性清理能力被当作身份判定的附带动作；隐藏 WebView transport 暴露 App 快照；Cookie 名摘要被提升为协议结论。 |
| 当前 owner | `tests/ui/account/hidden-browser-host.test.tsx` |


## `REG-ACCOUNT-027` React Native 请求隐式读写 WebView CookieJar

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | App 读取原站 Cookie 发起请求后，服务端响应的 `Set-Cookie` 又经 React Native 默认 CookieJar 改写 WebView 会话，导致账号状态、原站页面和后续请求相互污染。若为隔离 Cookie 另建 client，还可能绕过代理 fail-closed 与既有连接资源；根因：`src/platform/network/request.ts` 的受管 credentials 边界、`src/sources/readGateway.ts` 的 public `native-no-cookie` 最外层边界与 `plugins/withNetworkProxyModule.js` 生成的共享 OkHttp client 必须共同表达两条不同 lane。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-ACCOUNT-028` 空凭据被动读取误清可信身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 已在 More 确认登录后，旧实现的普通读取恰好没有从 CookieManager/旧 SecureStore 快照取得值，账号状态会先变成需要验证、再变成未登录；current user、确认时间和私有 Query scope 一并丢失；根因：`src/features/account/useSessionController.ts` 的 NodeSeek 凭据持久化、被动观察和身份投影共用同一副作用分支；`cleared` 没有限定为用户明确清除事务。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-029` 手工 Cookie 白名单破坏原生请求身份完整性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | App 冷启动后 Feed、Categories 或账号读取明明处于原站登录会话，却更频繁收到 403/Cloudflare 并进入缓慢 WebView fallback；去 More 刷新后表面恢复，但 direct request 仍可能失败。受保护图片、视频或保存下载也可能因另一份旧 Cookie header 表现不同；根因：`fetchWithTimeout`、NodeSeek/linux.do/妖火 source/action clients、媒体 transport 与 Android `CookieManager` 之间存在多份 Cookie 传输所有者。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-ACCOUNT-030` React Native/Fresco 替换只读 CookieJar

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-02`、`USER-01`、`ACCOUNT-01`、`MORE-01`、`WRITE-01` |
| 历史症状与根因 | 当前 Android 包连接 Metro 后在 `MainActivity` 显示 “There was a problem loading the project”，堆栈为 `JavaNetCookieJar cannot be cast to CookieJarContainer`；若只换成默认可变容器规避崩溃，RN/Fresco 又会恢复可写 `ForwardingCookieHandler`；根因：`plugins/withNetworkProxyModule.js` 生成的共享 OkHttp client 同时承担 RN Networking、Fresco、Expo Image、代理和 WebView Cookie 只读边界，却没有满足 RN 的容器生命周期契约。 |
| 当前 owner | `plugins/withNetworkProxyModule.js` |


## `REG-ACCOUNT-031` 登录页面打开即破坏会话，关闭后又继续信任旧账号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`FEED-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | 只要进入登录/验证页，原本有效的 WebView 登录态就被 App 清除或旧快照覆盖；反过来，用户在页面内退出或切换账号后直接关闭，账号中心、私有缓存和写入口仍继续信任旧账号，直到手动点击检测；根因：登录 surface 生命周期、Account identity、WebView Cookie 所有权、Query cache scope 与写权限分别维护；打开页面被误当成登出事务，关闭页面又没有强制 identity reconciliation。 |
| 当前 owner | `src/domain/session/authSurfaceCoordinator.test.ts` |


## `REG-ACCOUNT-032` 妖火已登录会话在身份核对时打开登录页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 账号中心仍显示妖火用户名和已登录状态，点入后却先打开登录页；点击“检测登录状态”后页面立即恢复为“我的地盘”；根因：`src/features/account/components/YaohuoLoginHost.tsx` 用 `canWrite` 选择登录页或会话页，把“身份核对期间禁止写入”误当成“已经退出”。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-ACCOUNT-033` 妖火匿名 Cookie 被误判为清理失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 用户点击“清除登录”后收到“登录 Cookie 删除未确认”，但妖火匿名页面会继续保留或重建会话辅助 Cookie；根因：原生清理事务把三个目标 Cookie 名“全部消失”当作退出 oracle，没有区分认证标记与匿名会话辅助 Cookie。 |
| 当前 owner | `plugins/withNetworkProxyModule.js` |


## `REG-ACCOUNT-034` 妖火旧版 www domain Cookie 未被清除

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 点击“清除登录”后提示删除未确认；随后点击“检测登录”，远端页面立即恢复为原登录账号；根因：`clearManagedLoginCookies` 没有为 `Domain=www.yaohuo.me` 写同名过期 Cookie，因此有效 `sidyaohuo` 继续随 `www.yaohuo.me` 请求发送。 |
| 当前 owner | `plugins/withNetworkProxyModule.js` |


## `REG-ACCOUNT-035` Account 已结算但请求仍读取旧身份，验证恢复先重试后关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | 登录/验证已经确认同一账号或新账号，紧接着恢复的读取或写入仍看到旧 identity/epoch；linux.do/NodeSeek 面板还可能在原 Query 已恢复时继续挂载，使恢复请求再次落入登录 surface；根因：稳定 Account snapshot、auth surface registry 和恢复回调的提交顺序；若身份再镜像到 React ref/workflow，probe Promise 与请求时刻读取会观察不同 owner。UI 可见性被误当作事后清理而不是恢复前屏障。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-036` 妖火多 scope SID 选择了匿名值或错误账号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`WRITE-01`、`WRITE-02` |
| 历史症状与根因 | 妖火 Cookie header 同时含 host/domain scope 的多个 `sidyaohuo` 时，回复或删除可能拿到空值、匿名 `-2`，或任意选择一个冲突的有效 SID；根因：`extractYaohuoSid` 没有把匿名辅助值、重复 scope 和冲突身份分开，request builder 在未建立唯一 owner 时继续生成 transport。 |
| 当前 owner | `src/sources/yaohuo/actionRequest.test.ts` |


## `REG-ACCOUNT-037` 可读公开页让真实未登录账号长期停在 unknown

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 全新隔离 AVD 没有论坛登录数据，NodeSeek 与妖火公开页面都能正常打开，但账号中心长期显示“登录状态待确认”；未登录 Replay 在进入搜索前即失败，NodeSeek 的外部 Google 入口和妖火的登录限制均无法按权威匿名态分流；根因：内容 transport 把“业务 DOM 已可读”“页面所有资源已结束”和“身份协议已结算”混成 ready 条件；NodeSeek 最初没有桥接渲染 runtime 的精确匿名值，后续虽能识别该值，Account script 仍被 `onLoadEnd` 阻塞。妖火最初没有在首页 unknown 后补读登录 form；补读后又让通用验证码特征覆盖了更强的完整登录 form 退出证据。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-ACCOUNT-038` NodeImage 已有会话仍重复 Connect 且授权成功后不自动完成

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | 用户点击 NodeImage 授权后页面没有自动保存或关闭，只能继续点原站按钮；多次点击最终看到“每天只允许 20 次连接”。已有 NodeImage 登录态时仍可能每次消耗 Connect 配额，上传失败还会再次拉起授权；根因：NodeSeek canonical 身份、NodeImage 独立 session Cookie 与 SecureStore API Key 三份状态被压成一个“重新授权”动作；WebView 文档生命周期、Connect 配额和上传错误恢复缺少单向状态机与一次结算边界。 |
| 当前 owner | `src/platform/network/loginWebViewScripts.test.ts` |


## `REG-FEED-006` 多页 Feed 刷新失败后跳过失败页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-04` |
| 历史症状与根因 | 已加载多页的单站 Feed 刷新时后续页失败，用户再次加载却直接请求更后面的页，失败页内容永久缺失；根因：`src/features/feed/useFeedController.ts` 把任意 Query error 当成 load-more error，没有用 `isFetchNextPageError` 区分 refetch 与分页失败。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SEARCH-009` 搜索失败响应进入可信 Query data

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 某来源首次搜索失败或要求登录/验证时，页面可能把它当作成功空结果，错误状态不稳定，失败对象还会留在 Query cache；根因：`src/features/search/useSearchController.ts` 的聚合与单站 queryFn 直接 return 业务失败对象，而不是 reject `SearchPageError`。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-010` 多页搜索刷新失败后跳到下一 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站搜索已加载多页后刷新，后续页失败；用户继续滚动会跳过失败页请求下一 cursor，结果出现永久缺口；根因：`src/features/search/useSearchController.ts` 把 refetch error 误当成 `fetchNextPage` error，并从旧末页推导更后 cursor。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-011` 同 key 搜索刷新不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02` |
| 历史症状与根因 | 单站同条件重新搜索时旧结果仍在，但提交按钮和来源区块都不显示请求进行中，用户可能重复提交；根因：`src/features/search/useSearchController.ts` 的 busy/loading 投影只读取初次 pending，没有覆盖 retained-data refetch。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-012` 旧搜索结果为新输入打开动作面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04` |
| 历史症状与根因 | 用户提交关键词 A 后立即把输入改成 B，A 的迟到登录/验证结果仍突然打开面板，看起来像 B 触发；根因：`src/features/search/useSearchController.ts` 的 action effect 只看 Query 结果与来源，没有确认当前输入仍归属于该次 submitted search。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SOURCE-003` 主动取消被诊断为来源失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 切换来源、条件或离开页面取消请求后，诊断把 transport 的 abort rejection 记录成网络失败，污染问题定位并可能触发错误 UI；根因：`src/features/feed/useFeedController.ts` 与 `src/features/search/useSearchController.ts` 的 catch 只按 error 类型归类，没有优先读取请求 signal 的当前状态。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SOURCE-004` linux.do 受管请求并行维护两条认证链

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 同一次 linux.do 请求中 Gateway 已识别登录态，adapter 却再次读取 SecureStore；两次读取不一致或第二次失败时，请求可能匿名发送、误报存储错误，或与 Query key 的认证身份不一致；根因：`src/sources/readGateway.ts` → `src/sources/discourseRead.ts` → `src/sources/linuxdo/reader.ts` 的认证上下文没有显式贯穿，导致 Gateway 与 adapter 同时拥有 credential read。 |
| 当前 owner | `src/sources/discourseRead.test.ts` |


## `REG-SOURCE-005` 冷启动 fallback 的后台账号请求取消前台列表

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 冷启动直接进入首页时 Feed 或 Categories 请求显示取消/失败；去 More 刷新账号后再回来却能加载，形成“账号刷新修好了网络”的假象；根因：`src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的隐藏 WebView 调度，以及 NodeSeek / linux.do reader 调用方没有标注用户可见优先级。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-SOURCE-006` fallback 排队时间耗尽请求超时并跨任务取消

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 请求尚在等待隐藏 WebView 执行权就达到 15 秒超时；用户只取消一个页面请求，却连带使同站其他 fallback 失败或释放错误任务；根因：`src/platform/network/request.ts` 的 timeout 所有权、`nodeseekFetchFallback` / `linuxdoFetchFallback` 的 handoff，以及隐藏 WebView 队列的 per-task Abort/执行时钟。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-SOURCE-007` 身份核对中的四站被误报暂不可用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | App 偶发进入时三个可登录站点同时显示“暂不可用”，但 V2EX 等公开列表已经正常刷出；数秒后三个错误又自行消失；根因：`ReadGateway` 曾把账号核对 activity 当成来源不可用；聚合 adapter 跳过请求后又生成与真实凭据故障相同的来源错误。 |
| 当前 owner | `src/domain/forum/readPlan.test.ts` |


## `REG-TOPIC-024` linux.do 回复页复用模块全局旧 stream

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | linux.do 主题的回复 stream 已在服务端变化后，后续分页仍按旧 post id 列表读取，可能缺少新回复或请求已不存在的楼层；根因：`src/sources/linuxdo/reader.ts` 的 `topicStreamCache` 成为 TanStack Query 之外、未按会话和请求生命周期约束的第二份服务端状态所有者。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-025` 完整刷新拼接新首屏与旧回复页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04` |
| 历史症状与根因 | 主题完整刷新后首屏是新内容，后续回复和 cursor 却来自刷新前快照，造成重复、缺楼或继续从错误位置分页；根因：`src/features/topic/useTopicController.ts` 只替换 replies cache 的第一页，保留旧 pages、pageParams 和 next cursor。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-026` Discourse 系统动作与解决方案沿用普通回复模板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`WRITE-03` |
| 历史症状与根因 | linux.do 的关闭/重开事件被显示成空白普通楼层，带等级、楼层号和点赞等操作；主题正文后缺少原站的已采纳答案区，采纳回复本体也只有作者栏“已采纳”小标签，没有明确的解决状态；根因：`src/features/topic/components/TopicContentList.tsx` 的主题正文尾部、`src/features/topic/components/ReplyItem.tsx` 的共享 Discourse 回复模板，以及 `src/features/topic/useTopicController.ts` 的精确楼层 Query。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-USER-007` 用户页刷新保留旧分页快照且不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 用户页已经加载多页后刷新，页面没有忙碌反馈；刷新完成仍混有旧后续页和旧 cursor，可能显示已删除内容或跳过新内容；根因：`src/features/user/useUserController.ts` 的 refresh 只 invalidates 首屏 seed，并以 pending 而非 fetching 投影 busy，未用新 profile 替换完整分页快照。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-WRITE-017` 写成功后定向回复刷新在 Query 重构中丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`TOPIC-03` |
| 历史症状与根因 | 回复、编辑或删除已由服务器确认后，当前回复区不出现目标楼层或仍显示旧内容；如果简单整页刷新又会丢失已加载分页和当前位置；根因：请求改为 TanStack Query 唯一所有者时，旧 controller 的 targeted refresh seam 被删除，但 mutation success 没有等价的 Query-native 提交；顺序拆为独立 Query lane 后，写后刷新还必须保留真实服务端窗口语义。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-WRITE-018` 串行 mutation 在排队前共享同一 optimistic snapshot

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 用户快速执行同一 Topic 的两个互动，第一个成功、第二个失败时，第二个 rollback 可能恢复到两个操作之前，复活已经确认撤销的状态或覆盖已确认结果；根因：`src/features/topic/actions/useTopicActionsController.ts` 把 cancel/snapshot/optimistic/rollback 放在 Mutation scope 之外，两个 queued mutation 观察到重叠基线。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-019` rerender 前重复提交进入两个非幂等队列

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01` |
| 历史症状与根因 | 用户快速双击回复提交，在 React 来得及重渲染 busy 之前，两次相同回复都进入队列，可能在原站生成重复内容；根因：`src/features/topic/actions/useTopicActionsController.ts` 只依赖渲染时派生的 busy 防重，没有在执行瞬间检查 exact mutation identity 的 pending 状态。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-020` mutation 前置错误无提示地消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | SecureStore 读取、凭据准备或其他 action wrapper 之前的异常发生时，操作没有成功也没有错误提示，用户只能看到按钮恢复；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 generic mutation `onError` 假定所有错误都已由内部 wrapper 处理。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-021` 离开 Topic 后结算的写入保留旧 route cache

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`NAV-03` |
| 历史症状与根因 | 在 Topic A 提交回复后立即导航到 Topic B，A 的请求随后成功；以后返回 A 时，因为 `refetchOnMount=false`，旧详情和回复 cache 可能继续显示写入前状态；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 after-success refresh 没有处理 mutation identity 与当前 Topic identity 分离后的 inactive cache。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-022` 写操作确认失效后未更新统一会话投影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 写 transport 明确返回 HTTP 401，用户只看到一次错误，但 Topic、Search 与通知仍按旧账号开放；或 adapter/fallback 吞掉 status 后又补发账号请求，造成限流和竞态；根因：原始 `Response` 与 adapter 之间缺少统一 401 边界，身份失效被分散到每站 client 和消费者。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-WRITE-023` 旧主题或账号在身份待确认、换号后继续写入

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 用户从账号 A 打开旧 Topic 后在 WebView 切到账号 B、退出或身份无法确认，App 仍可能先显示 optimistic 成功、打开文件选择器或发送 A 页面上下文下的回复、编辑、删除、互动、投票、上传和签到；服务器已确认的操作还可能在写后刷新期间换号，随后对新账号弹出旧账号的成功提示；根因：各 action 自行读取 Cookie/SecureStore 判断登录，身份检查与 optimistic snapshot、文件选择、上传、transport 及成功结算之间没有一次性 identity/epoch 所有权；恢复逻辑把写请求当成可自动重试读取。 |
| 当前 owner | `src/domain/session/writableSessionGate.test.ts` |


## `REG-WRITE-024` 普通写失败误触发身份 barrier

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`SEARCH-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek、妖火或 linux.do 的普通网络错误、服务端异常或对象权限不足被当成登录失效；一次局部写失败会让目标站进入长期 identity barrier，Topic、Search 和其他私有入口一起关闭；根因：adapter 级错误分类被错误赋予账号生命周期权限；没有把 raw HTTP status 与业务错误分开。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-025` 妖火结果文案被当作控制协议

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-03`、`TOPIC-03` |
| 历史症状与根因 | 妖火返回的操作结果无法确认，但只要提示文案发生同义改写，或普通 200 页面只有空白/任意短文本，App 就把它当作已确认成功，保留 optimistic 状态并弹出成功提示，可能诱导用户重复或误判收藏、回复、删除和投票；根因：妖火 action response parser 到 Topic mutation wrapper 的结果类型缺少稳定判别字段和正向成功 oracle。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-TEST-001` Smoke 绿灯被当成功能完整通过

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 历史症状与根因 | Smoke 路径能走通，但 Feed 双 Loading 等用户可见 bug 仍然存在；多来源搜索 Replay 只等到请求结束，即使结果为空或结果打不开也会报绿；根因：证据命名和交付报告把不同测试层混成一个 `SMOKE_PASS`；搜索旅程把 `search-complete` 当成搜索成功，没有验证结果存在并能进入详情。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-002` 搜索完成标记残留导致 Replay 提前断言

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 历史症状与根因 | 真实搜索仍显示“正在搜索...”，Replay 却已经越过等待并立即报告首条结果不存在；同一路径重跑又可能通过；根因：`tests/device-logged-out/logged-out-readonly.ad` 与 `search-multi-source.ad` 曾把泛化请求生命周期 marker、上一请求残留节点或不完整来源集合当成当前聚合请求 oracle。后续逐来源空 marker 又进入生产布局，见 `REG-SEARCH-016`。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-003` App 内伪匿名不能代表真实未登录环境

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`SEARCH-01`、`SEARCH-04`、`RELEASE-02` |
| 历史症状与根因 | App 内切换一个“匿名”布尔值会创造第二套身份事实；要么真实 Cookie 仍参与网络，要么人为过滤全部 Cookie 并触发本不会出现的 Cloudflare 风控。两种结果都不能代表普通用户真实退出论坛但保留访客/clearance Cookie 的状态；根因：测试需求被实现成产品运行模式，导致 Account、Gateway、write ticket、媒体和 Native 网络层都要维护额外分支；测试环境事实与产品身份事实混在同一进程。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-TEST-004` 未登录 Replay 把访客已验证误判为账号登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-04`、`RELEASE-02` |
| 历史症状与根因 | 独立未登录 AVD 已正确识别 NodeSeek 游客并应显示外部 Google 搜索入口，但保留访客 clearance 后账号中心显示“已验证”，Replay 仍等待唯一“未登录”文案并在搜索前失败；根因：设备 oracle 把展示文案当成账号身份谓词，遗漏了现有状态模型中 `verified` 与 `logged-in` 的明确边界。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-005` 动态 linux.do 等级被误作固定 Replay oracle

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`RELEASE-02`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04` |
| 历史症状与根因 | 旧 `more-readonly` 或 `account-readonly` 在linux.do 等级读取处等待后失败，代理、诊断、备份、外观或整次 Release 随无关的第三方波动失去证据；等待原站冷却后从同一入口再次读取又能成功；根因：Device Replay 把“入口与错误状态是否正确投影”和“第三方身份、等级端点此刻是否可用”压成一个发布 pass/fail；固定 RNTL 已能确定性证明 transport、结算和恢复语义。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-006` 动态来源成功被错误作为唯一 Replay 终态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`RELEASE-02`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | App 已正确显示空态、限流、验证、来源错误或空 Library，Replay 仍因没有动态首条、详情、用户主题、非空本机数据或第三方 DOM 而失败；同一路径稍后重跑又可能通过；根因：Device Replay 同时承担 App 流程、第三方数据可得性和动态对象前置条件，没有复用 controller/UI 的结果模型；稳定入口与实时内容被压成一个布尔值。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-007` 所有旅程经聚合 Feed 启动并制造无关失败与请求突发

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-04`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04`、`RELEASE-02` |
| 历史症状与根因 | Search、Library、账号、NodeSeek WebView 或本地 More 旅程尚未到目标入口，就因聚合 Feed 动态失败而停止；重复 relaunch 又在短时间触发多次无关来源和账号请求；根因：Replay 以一个网络首页作为所有能力的全局 setup，而不是从目标主 tab 建立最小前置；独立失败域和 probe 所有权没有体现在脚本拓扑中。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-008` 冷启动空节点让 Replay 在 selector timeout 前失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`MORE-01`、`RELEASE-02` |
| 历史症状与根因 | exact-revision APK 已正常启动且稍后能显示 Feed，但 Replay 在任何旅程操作前报告 Android accessibility hierarchy 为 0 个节点；`more-readonly.ad` 等待 `main-tab-more` 时未用满 60 秒 selector timeout 就失败；根因：`AppComposition` 在 `runtime.routes === null` 时返回空节点。snapshot helper 因前台 App 没有 meaningful accessibility node 转入 stock UIAutomator，后者等待 idle 超时，selector wait 无法继续轮询。 |
| 当前 owner | `tests/ui/app/app-composition.test.tsx` |


## `REG-TEST-009` 账号外站探测波动阻断确定性 Release Replay

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`RELEASE-02`、`MORE-05` |
| 历史症状与根因 | 同一 APK、设备和登录数据下，正式 Release Replay 先在妖火“已登录”等待失败，单独重跑又在 NodeSeek 失败；随后手动同路径三站可恢复为 3/3，tab 切换立即成功；根因：持久化终态恢复与 `account-readonly.ad` / `nodeseek-session.ad` 的设备 oracle 失配；确定性 Replay 不应重新证明登录。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-PROXY-004` 原生代理切换与 bridge 销毁遗留旧连接

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-04` |
| 历史症状与根因 | App 冷启动读取代理配置前可能短暂直连；代理切换、关闭或 React Native bridge 销毁后，旧 tunnel、连通性 probe 和阻塞线程仍存活；并发连接持续创建新线程；WebView 清除回调超时仍提示关闭成功，或在关闭过渡期间提前开始加载；根因：`plugins/withNetworkProxyModule.js` 生成的 `NetworkProxyRuntime`、`LocalNetworkProxyServer`、`NetworkProxyModule`，`src/platform/network/networkProxy.ts`、`src/app/useAppRuntime.tsx` 与 Account/More/Topic owner 的 WebView 门禁，以及 CI 原生编译门禁。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-005` CONNECT 成功被误报为完整连通且密码明文输入

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | “测试代理延迟”只建立到固定 443 目标的 TCP tunnel 就提示成功，即使 TLS、证书 hostname 或 HTTP 已失败；代理密码在输入框和 Android 可访问性树中以普通文本暴露；根因：生成的 `LocalNetworkProxyServer.test()`、`src/platform/network/networkProxy.ts` 的 native Promise 计时、`src/platform/network/useNetworkProxyRuntime.ts` 提示与 `src/features/more/components/NetworkProxyModal.tsx` 输入属性。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-PROXY-006` 普通站点失败清空全局连接并取消其他站请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | NodeSeek 一次普通超时、403 或 fallback 失败后，linux.do、妖火等本来无关的在飞请求一起被取消；随后刷新 More 或重新发请求才恢复；根因：`nodeseekFetchFallback` 的推测性网络恢复与 `NetworkProxyRuntime` 共享 dispatcher/connection pool 的资源所有权冲突。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-027` Discourse emoji 绕过统一 gateway 且切站迟到落地

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`MORE-01` |
| 历史症状与根因 | linux.do 详情中的 reaction 图片目录直接读取 adapter，绕过 App 当前代理 fetcher、站点凭据、诊断和取消；卸载后旧目录可能迟到更新；根因：`src/features/topic/TopicRoute.tsx` → `src/sources/readGateway.ts` → `src/sources/discourseRead.ts` 的受管读取边界。 |
| 当前 owner | `src/sources/readGatewayContract.test.ts` |


## `REG-TOPIC-028` V2EX 重复楼层被当作回复身份导致大片空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | App 内打开 V2EX 主题 `1229472` 并滚动到 67～68 楼时，两条正常回复之间出现超过一屏的空白，后续回复像被错误跳过。重启模拟器后仍稳定复现；根因：`src/features/topic/components/TopicContentList.tsx` 通过 `src/features/topic/model/replyListModel.ts`、`src/features/topic/model/topicContentIdentity.ts`、`src/features/topic/model/topicHeaderModel.ts`、`src/features/topic/model/topicError.ts` 的 `getReplyKey` 把楼层作为 FlashList 稳定身份，导致不同回复复用同一 key 和历史布局高度；项目已有 `src/domain/forum/feed.ts` 的 `replyKey` 已按 `commentId` 优先表达正确身份。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-FEED-007` 返回 Feed 后重复提示缓存的局部错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-04` |
| 历史症状与根因 | 从详情或其他页面返回 Feed 时没有新请求，却再次弹出上一页的来源错误；NodeSeek 错误还可能重复打开验证面板；根因：`src/features/feed/useFeedController.ts` 的局部分页错误副作用。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-008` 分页加载后已浏览主题回跳

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首页或单站列表向下加载下一页后，已经滑过的主题重新出现在顶部，当前阅读位置产生明显回跳；根因：`src/features/feed/useFeedController.ts` 的 `mergeFeedPages` 必须只按页序追加并去重；旧实现曾把跨页数据重新按活跃度排序并按来源平衡。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-009` 身份屏障复用可信多页时再次重排

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`ACCOUNT-02` |
| 历史症状与根因 | “全部”已经加载多页后进入登录或验证对账，网络尚未返回，已浏览主题就会换位并带动当前阅读位置回跳；根因：`src/features/feed/useFeedController.ts` 的可信 identity barrier 合并曾全量重排；改为普通 stable append 后又只从旧页保留 pending 来源，安全响应若只返回第一页会截掉旧第二页的安全来源。解除 barrier 时再把完整展示快照压成一个合成页，真实第一页结算后仍会覆盖旧尾页。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-010` 启动身份对账让 Feed 旧列表闪现后退回 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 关闭并重新打开 App 时，首页偶尔先显示上次或首个请求的列表，随后退回全屏 Loading，再显示新列表；分类栏也可能同步闪空；根因：冷启动把“恢复已确认事实”和“重新证明身份”混成同一生命周期，`useAppRuntime` 没有在唯一 ReadPlan 创建前等待 account session hydration。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-FEED-011` 整批身份对账逐站发布导致聚合请求风暴

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | v1.3.80 启动首页时 Loading 反复出现，站点可能提示操作过于频繁；一次启动日志在 3.536 秒内完成 3 次聚合 Feed、4 次聚合 Categories 和 4 个 Account probe，对应 28 个实际 HTTP，并在首批 30 条已可见后再次出现 2 个 busy 帧；根因：启动阶段没有信任上次终态，Account owner 被错误赋予首页启动编排职责。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-SOURCE-008` 会话来源清单与 source catalog 漂移

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01` |
| 历史症状与根因 | 新增可登录来源后，普通读取可以工作，但 session epoch 或 identity barrier 未覆盖该站，换号后的旧请求可能落地；根因：`src/domain/forum/sourceCatalog.ts` 的会话 capability、`readGateway` epoch snapshot 和 `useAccountRuntime` barrier。 |
| 当前 owner | `src/domain/forum/sourceCatalog.test.ts` |


## `REG-SOURCE-009` WebView HTTP 成功在 source parser 前误触发读取 runtime 轮换

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01` |
| 历史症状与根因 | direct timeout/network error 后隐藏 WebView 返回 200，但内容是临时 shell、错误 HTML 或畸形 JSON；页面最终仍解析失败，App 却把这次请求计为成功 fallback 并轮换读取 runtime。聚合读取还可能因另一站成功而确认失败站；详情的辅助 poll 失败被降级为 partial 时也可能误确认；根因：transport 成功、Response 对应的 source parse proof、child typed result、最外层 aggregate result 与最终请求所有权没有统一 lifecycle；恢复计数器把 HTTP 状态误当成 source-readable 证据，并按 operation 一次性确认所有子请求，或让先完成的 child 在 aggregate/Gateway 最终 current/abort guard 前提前提交。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SOURCE-010` 内容源已隐藏但账号、聚合、后台或旧路由仍出网

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`LIBRARY-01`、`NAV-01`、`NAV-02`、`TOPIC-01`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`DATA-01` |
| 历史症状与根因 | 用户在“更多”停用没有账号或不想看的站点后，页面虽然隐藏，该站仍被账号探测、“全部”聚合、搜索预览、后台消息或旧详情链接请求；重新启用还可能补报停用期间消息；根因：`sourceCatalog` 的静态能力边界、`ReaderSettings.contentSources` 的用户选择和 Account identity 被混成一个状态；请求层没有 fail-closed allowlist，排序也与请求集合共用不稳定 key。 |
| 当前 owner | `src/domain/reader/contentSourcePreferences.test.ts` |


## `REG-ACCOUNT-039` linux.do 身份确认后 workflow 仍停在 verifying

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`SEARCH-04` |
| 历史症状与根因 | canonical Account 已确认登录，但验证弹层 workflow 仍显示 verified/verifying、丢失 current user 或关闭写入；原页面恢复失败时还可能把可信身份一起降级；根因：`src/features/account/useVerificationController.ts` 的 authoritative reconcile 与 page recovery 顺序。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-ACCOUNT-040` Android WebView source origin 被误当成完整页面 URL，Connect 永远不启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | NodeImage session 已明确失效后，授权弹层进入 NodeSeek Connect 页面却一直 Loading；用户反复打开或触碰页面仍没有结果，并担心每天 20 次 Connect 额度已被消耗；根因：Native 消息来源 origin、脚本运行 document URL 与 flow nonce/账号 epoch 是三份不同证据；可重试的 bridge ready 握手也不等于受每日配额约束的 `/api/cAuth` 网络调用。 |
| 当前 owner | `src/sources/nodeimage/authFlow.test.ts` |


## `REG-TOPIC-029` 媒体按目标 URL 猜身份并跨来源携带 Cookie

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 一个论坛正文引用另一个受管论坛的图片、头像或视频时，App 可能把目标站登录 Cookie 带给作者可控请求；重定向离源后还可能重新获得 Cookie；根因：`ForumMediaRequestContext`、所有媒体 source/header 构造和生成的 Android OkHttp Cookie policy。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-030` lazy 图片候选越过主动请求 URL 边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 已清洗的安全 `src` 被相对或 `javascript:` lazy/srcset 候选覆盖，正文加载失败；同一候选还可进入全屏预览和保存；根因：`src/domain/forum/forumContentMedia.ts` 的 source upgrade 与 `src/platform/media/imagePreviewCatalog.ts` 的 preview catalog/tapped URL 结算。 |
| 当前 owner | `tests/integration/topic-content-rendering-contracts.test.ts` |


## `REG-TOPIC-031` 全屏预览快速缓存命中后永久 Spinner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片已经由缓存立即显示，但全屏预览仍永久显示“图片加载中”；根因：`src/ui/media/ImagePreviewModal.tsx` 的 request identity 与终态结算。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-032` 正文图片逐图总时限无法表达加载进展

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 服务器接受连接但正文图片长期没有字节进展时，图片可以无限转圈；若改成每图 30 秒完整 `callTimeout`，持续有进展的大图又会在总时长到点后被误杀，海量正文还会线性创建 Timer 和同步失败波次。全屏预览的独立 timeout 由 `REG-TOPIC-052` 管理，不属于本条；根因：`plugins/withNetworkProxyModule.js` 的 Expo Image client timeout 配置与 `src/features/topic/media/TopicBodyMediaCoordinator.tsx` 的正文 permit/deadline 生命周期必须共同定义终态；任一层单独承担完整语义都不够。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-033` HTML 图片属性被重复解码

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片 URL 中本应保留的字面 `&lt;` 被再次变成 `<`，增补平面数字实体也可能被截断；根因：`src/platform/media/imagePreviewCatalog.ts` 的 DOM 属性读取与 raw regex fallback 解码边界。 |
| 当前 owner | `src/platform/media/imagePreviewCatalog.test.ts` |


## `REG-TOPIC-034` 大 SVG 兼容清洗退化为逐字符全尾扫描

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片解码失败后兼容读取接近 1 MiB 的 SVG 时，JS 线程长时间冻结，详情和全屏预览无法操作；根因：`src/platform/media/compatibleImageSources.ts` 把“不可信 SVG 文档”错误建模为“清洗后继续交给 AndroidSVG 的图片字符串”。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-035` Discourse 引用显示名被当作可导航用户名

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02` |
| 历史症状与根因 | linux.do引用缺少 `data-username` 时，显示名、头像路径或标题回退被当成 username；点击作者会进入不存在或错误的用户页；根因：`src/sources/discourse/content.ts` 的共享 Discourse 引用解析、`Reply.quotedPosts[].author` 数据模型与 `ReplyItem` 导航门禁。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-TOPIC-036` NodeSeek 渲染分页缺楼层时从 1 重新编号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | NodeSeek 第 2 页缺少 `.floor-link` 和数字 id 时从 1 重新显示楼层，与首屏重复；点赞等 embedded 元数据还可能因错误楼层匹配而丢失；根因：`src/sources/nodeseek/topicParser.ts` 的渲染楼层解析，以及 `src/sources/nodeseek/reader.ts` 的 Topic 首屏与 replies 分页消费。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-037` 带身份媒体被未分区 HTTP cache 跨会话复用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 历史症状与根因 | 同一媒体 URL 在账号 A 下返回的私有内容可能被匿名状态或账号 B 直接从 OkHttp cache 复用，即使新请求已不携带 A 的 Cookie；根因：生成的 `ForumMediaRequestInterceptor` 与 OkHttp `CacheInterceptor` 之间的 request cache policy；Expo/Glide 的 session epoch 上层 cache 是独立边界。 |
| 当前 owner | `plugins/withNetworkProxyModule.js` |


## `REG-TOPIC-038` 复杂动态 SVG 被重复交给 AndroidSVG 后仍加载失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek `post-841430-1` 的正文图片持续 Spinner 或失败；响应实际是合法 SVG，切到 data URI 后仍无法显示，去掉链接包装也无效；根因：`src/platform/media/compatibleImageSources.ts` 曾把失败 SVG 改写后再次交给 Expo Image 的同一个 AndroidSVG decoder；正文与全屏没有共享“SVG 文档 artifact”边界。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-039` NodeSeek 用户名 mention 被候选 UID 优化误作内部导航门禁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`USER-01`、`NAV-02`、`USER-02`、`LIBRARY-02`、`NAV-03` |
| 历史症状与根因 | 同一 NodeSeek Topic 中，有些正文或回复里的 `@用户` 能进入 App 用户页，有些却打开 Google/Chrome；能否内开取决于当前已加载 Topic 数据中是否碰巧带有该用户的数字 UID；根因：`parseForumUserLink` 与 Topic 共享 HTML 点击入口、`UserReference`/`UserProfile` 边界、NodeSeek username resolver、`ReadGateway` 和 User controller 的 Query identity。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-040` 正文误把预览原图当作适屏图片下载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | 浏览器中秒开的论坛图片在 App 正文等待十几秒甚至离页仍未完成；窄屏正文实际下载了灯箱原图或 `srcset` 最大候选，耗时和字节数远大于展示所需；根因：`src/platform/media/imagePreviewCatalog.ts` 的图片候选解析与预览 alias catalog、`src/domain/forum/forumContentMedia.ts` 的正文 source 选择，以及 `src/features/topic/rendering/previewRenderers.tsx` 的最终 native source。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-041` 不同会话 epoch 的同 URL 图片请求被 Glide 合并

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 账号切换、退出或登录更新时，新会话请求与旧会话尚未结束的同 URL 图片可能共用旧 Glide 在途结果，造成旧私有图片进入新页面或新请求无法独立结算；预览保持打开时还可能继承旧会话的放大状态，导致新页无法横滑或动画层继续隐藏；根因：`src/platform/media/mediaRequestContext.ts` 的远程图片 source、`plugins/withNetworkProxyModule.js` 的出网拦截器、Expo `GlideUrlWithCustomCacheKey` 模型相等性，以及 `src/ui/media/ImagePreviewModal.tsx` 的 session identity 边界。 |
| 当前 owner | `src/platform/media/mediaRequestContext.test.ts` |


## `REG-TOPIC-042` App 重启后私有图片磁盘缓存命名空间复用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | App 重启后切到不同账号或匿名状态，同一 URL 可能直接显示上一进程写入的私有图片磁盘缓存；根因：`src/platform/media/mediaSessionEpoch.tsx` 的媒体 session identity 与 Expo/Glide disk cache namespace。 |
| 当前 owner | `src/platform/media/mediaSessionEpoch.test.ts` |


## `REG-TOPIC-043` 复杂静态 SVG 全屏误启 Chromium 导致掉帧与缺层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 复杂静态 SVG 在正文已完整显示，进入全屏后却出现掉帧、局部图层缺失；设备日志反复出现 Chromium tile memory 超限，严重时 App 进程退出；根因：`src/ui/media/ImagePreviewModal.tsx` 对 `CompatibleSvgArtifact.animated` 的消费边界。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-044` SVG 海报 renderer 空闲后仍占用 Chromium 内存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 正文海报已经生成且可见，打开真实动画 SVG 预览并缩放后仍会持续掉帧、缺层；日志反复出现 Chromium tile memory 超限，严重时 App 或模拟器退出；根因：`plugins/withSvgRendererModule.js` 生成的 `SvgPosterRendererRuntime` 队列结算与 WebView 所有权。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-045` 动画 SVG document view 进入缩放树后耗尽 Chromium tile 内存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 动画 SVG 正文和全屏首帧都能立即显示，但双击放大、平移或停留时日志持续出现 Chromium `tile memory limits exceeded`，严重时预览缺层、App 或模拟器退出；根因：`src/ui/media/ImagePreviewModal.tsx` 的分页、缩放树与动态 `CompatibleSvgDocumentView` 挂载边界。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-046` 多图预览被缩放手势截获后无法横滑

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 三图主题打开后稳定显示 `1/3`，但在图片上向左滑动仍停留在第一张，用户无法进入后两张；根因：`src/ui/media/ImagePreviewModal.tsx` 的单一 manual parent Pan 与 ResumableZoom 共享的 UI-thread zoom state。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-047` 评论纵向间距调整误删正文横向缩进

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 只要求调整评论纵向留白后，评论正文却向左扩张到头像列下方，签名、引用、投票和操作区也随正文一起铺满；相邻评论之间的纵向节奏正确，但左右布局已不是原来的样式；根因：`src/features/topic/components/ReplyItem.tsx` 的 `replyContentWidth` 与 `src/features/topic/styles.ts` 的 `replyContentArea`。普通回复的引用、回复目标、正文、投票、签名/留言、reaction/统计/感谢、采纳状态和操作栏都在该容器内；主楼、评论头部、系统事件、User 回复活动和 Reply composer 不经过该容器。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-048` 适屏图显示后不渐进升级且全屏返回仍模糊

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | 详情与评论只能一直显示适屏图；即使全屏原图已经清晰显示，关闭预览后外层仍模糊。若直接把原图改成首个请求，长帖又会恢复慢加载、滚动期间整页抢带宽和图片尺寸跳动；根因：`src/platform/media/imagePreviewCatalog.ts` 的原图来源传递、`src/features/topic/rendering/previewRenderers.tsx` 的块图双层生命周期、`src/platform/media/originalImageLoading.tsx` 的附近门禁与进程内显示信号、`src/features/topic/components/TopicContentList.tsx` 的主楼分块范围，以及 `src/ui/media/ImagePreviewModal.tsx` 的全屏 `onDisplay` 结算。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-049` Bilibili 移动播放器跳转被导航白名单拦截

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 主题已把 Bilibili 视频识别成 16:9 播放器区域，但评论里只显示空白卡片，没有封面、控制层或视频；根因：`src/domain/forum/videoEmbeds.ts` 的 Bilibili WebView 导航白名单，以及 `src/features/topic/rendering/contentMediaRenderers.tsx` 对该白名单的共享调用。 |
| 当前 owner | `src/domain/forum/videoEmbeds.test.ts` |


## `REG-TOPIC-050` 全屏图片切换时高清升级闪黑

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 帖子详情的多图预览在 `1x` 横向切换时，新当前页会短暂整体变暗，视觉上像在黑色背景上闪了一下；页码、手势和最终图片均正常；根因：`src/ui/media/ImagePreviewModal.tsx` 普通栅格图分支把同一媒体的清晰度升级当成需要 cross-dissolve 的内容切换。`expo-image@3.0.11` Android 实现同时淡出旧 view、淡入新 view；在预览黑色背景上，两张相同图片的合成亮度中点约为 `75%`。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-052` 全屏重复打开已显示图片仍闪 Spinner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 同一张原图已经在全屏成功显示，关闭后再次点击，仍会短暂出现“图片加载中”并闪一下；根因：`src/ui/media/ImagePreviewModal.tsx` 的普通栅格预览状态没有消费 `src/platform/media/originalImageLoading.tsx` 已有的进程内显示证明。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-053` 跨主题评论引用被当作普通 HTML

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 评论中的跨主题引用没有显示为引用卡片，而是把头像、主题标题、分类和整段灰色 blockquote 当作普通评论 HTML 展开；同楼层还可能误取当前主题的帖子；根因：`src/sources/discourse/content.ts` 的 Discourse reply quote 提取、`Reply.quotedPosts` 的完整身份、linux.do adapter、`ReplyItem` 的本地楼层复用与 `useTopicController` 的引用事件。2026-07-16 的 `REG-TOPIC-003` 只对正文构造跨主题 fixture，评论 fixture 仍是同主题；2026-07-26 抽公共 parser 时保留了该限制，因此文档承诺没有对应评论 oracle。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-054` 超长评论引用展开时同步挂载整帖并挤压作者信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 已加载的超长跨主题引用再次展开仍会长时间卡顿；头像稍后出现会推挤姓名，长作者名和标题拥挤，引用分块之间还可能露出灰色空带。进入引用目标再返回时，还可能显示“收起”却没有正文；两条同展示楼层的回复可能一起展开或串位；根因：`useTopicController` 的引用 Query、`buildVirtualizedReplyItems`、`TopicScreenBody` 的唯一纵向 FlashList、`ReplyItem` 分段渲染与引用卡片样式。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-055` 超长引用首次展开让 FlashList 同帧预渲染过多富 HTML

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | `REG-TOPIC-054` 已把完整引用拆进父 FlashList 后，首次点击“展开”仍可能明显卡住；展开态还重复显示简介与完整正文，头像、姓名、标题和正文显得拥挤；根因：`buildVirtualizedReplyItems` 的冷引用 materialization、`TopicScreenBody` 的 row `onLayout`/下一帧放开、`ReplyItem` 的 content row 与引用简介显示条件。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-WRITE-026` 回复编辑权限跨账号或 epoch 继续生效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | A 账号进入回复编辑后切换到 B、恢复旧 route 或失去逐条权限，旧编辑仍可能提交、选图或上传；根因：`ReplyEditTarget`、`useTopicSessionController` 与 `useTopicActionsController` 的写 ticket、Replies Query 和 composer 生命周期。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-027` 结构化回复切换模式或展示状态后丢失正文与私有语法

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`TOPIC-02`、`TOPIC-03`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | linux.do/NodeSeek 回复只能看见原始 Markdown，表格是假文本；切换富文本/源码或 Sheet/全屏后可能丢正文、撤销栈、选区，私有块还会被普通 Markdown 规范化破坏。源码异步图片上传期间继续编辑时还可能插错位置或被模式切换覆盖；代码里的 `[poll` 等示例会被误判为待发布语法；根因：`StructuredReplyComposer`、本地 Tiptap/CodeMirror runtime、严格 Bridge、`ComposerBottomSheet` 与 Topic/私信入口。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-028` NodeSeek Stardust marker 可注入付款按钮或脱离正文位置

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 非法收款人/金额 marker、代码示例或恶意参数可能变成可付款卡片；合法卡片被移动到正文底部或重复显示；根因：`stardustMarkup` 的 DOM 原位归一、typed HTML model、`NodeSeekStardustCard` 和付款 controller 信任边界。 |
| 当前 owner | `src/sources/nodeseek/stardust.test.ts` |


## `REG-WRITE-029` NodeSeek 回复失败后手动重试重复创建投票

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05` |
| 历史症状与根因 | 投票已创建但评论发送失败后，用户点重试会留下第二个远端投票和孤立资源；根因：`materializeNodeSeekPolls` 与按 identity 保存的 `nodeSeekPollJournal`。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-030` NodeSeek 投票创建结果不明后再次发起创建

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`ACCOUNT-01` |
| 历史症状与根因 | create 超时或响应不可解析时，当前页面或 App 重启后的下一次提交再次创建投票；根因：`materializeNodeSeekPolls` 的 unknown outcome 与持久化 poll journal。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-031` NodeSeek 投票明确拒绝后被永久锁死

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | 服务端明确拒绝无副作用后，用户修正或手动重试仍被“结果未知”门禁永久阻止；根因：NodeSeek action error 的 `serverRejected` 语义与 poll materialization catch。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-WRITE-032` Stardust 付款确认取消后仍发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | 用户在“不可退回”确认框取消，仍发生 Stardust 扣款；根因：`payNodeSeekStardust` 的 writable ticket、prepare、native confirmation 和 send 分段。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-033` Stardust 付款乐观标记成功或重复发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | send 返回即本地标为已支付，或渲染/重复点击造成两次扣款；根因：`payNodeSeekStardust`、Topic mutation scope 与 `fetchNodeSeekStardustStatus`。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-034` Stardust send 结果不明时自动重发

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | send timeout 后客户端直接重试，可能重复扣款；或把未确认状态显示为失败诱导再次付款；根因：`payNodeSeekStardust` 的 send error、权威 status refresh 和 outcome 分类。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-035` 结构化 Composer 把旧回复工具藏到不可发现的长工具栏末尾

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 切换到结构化 Composer 后，首屏只看到撤销、标题和少量格式；NodeSeek 贴纸、LinuxDo Emoji、图片上传、投票及站点工具看似全部消失；根因：Editor Runtime 的移动端工具信息架构，不是写事务、上传 API 或目录加载本身。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-036` 结构化 Composer 的表达式、Sheet 和键盘只保留了源码层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 点击 NodeSeek 贴纸或 LinuxDo Emoji 后富文本只出现灰色 `:token:`；非空文档仍叠着“输入回复内容”；半屏正文留出大片无意义空白，全屏越过导航安全区，Gboard 打开后编辑区与发送栏仍被键盘覆盖；根因：`ForumExpressionNode` 的站点目录到视图属性映射、Editor 的显式空状态，以及 `StructuredReplyComposer → ComposerBottomSheet` 的唯一剩余空间/IME 布局合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-037` Composer 关闭冻结或正文滚动误触关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | Composer 全屏时点击收起只剩幽灵 Header；或在投票/Stardust 表单内纵向滚动时整张 Composer 被意外关闭；根因：`ComposerBottomSheet` 对可见高度、公开 `close()` 生命周期，以及“谁有权关闭 Composer”的唯一所有权合同。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-WRITE-038` Composer 底部露缝、表达式可连点且输入热路径重复整篇计算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 半屏和全屏底部都露出一条非 Sheet 背景；半屏打开后键盘不出现；全屏带键盘关闭后 Gboard 仍覆盖 Topic；选择贴纸或 Emoji 后选择面板不消失，同一项可被连续插入；长正文输入和移动光标时有明显卡顿；根因：`ComposerBottomSheet` 对背景、内容安全区和打开完成事件的所有权，`react-native-webview requestFocus → InputMethodManager.showSoftInput → Editor focus` 的唯一焦点链，Editor Runtime 的 `insertExpression/postState/useEditorState`，以及 Native Bridge 的相同状态去重。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-WRITE-039` 结构化 Composer 工具栏有真实溢出但横向手势被 Sheet 截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 常用工具栏最右侧只露出半个图标，但左右拖动没有任何移动，链接、引用、代码和列表不可达；根因：`StructuredReplyComposer` 唯一 WebView 的 Android 嵌套滚动合同；Editor Runtime 已形成真实横向 overflow，不属于 CSS 宽度或工具项布局问题。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-040` 空表格仍显示整篇占位符

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在空回复中插入表格后，“输入回复内容…”仍压在第一个表头单元格上并横跨单元格边界；根因：Editor Runtime 对“默认空文档”占位符的唯一判定；它必须判断 ProseMirror 文档形状，不能把“没有文本”当成“没有结构”。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-041` 表头可被切掉并在 Markdown 中凭空增加一行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 点击表格工具栏的“表头”后，首行只是不再加粗，但源码会在正文最前凭空增加一行空表头；删除首行也会产生同类数据变化；根因：ProseMirror 表格文档的 GFM 不变量：每个 table 的第一行必须全部是 `tableHeader`，不能等到序列化时补救。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-042` 插入表格后第二排工具栏压住正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 插入表格后编辑器突然增加一整排中文操作按钮，正文视口被向下挤压，新表格末行像被 Footer 截断；窄屏右侧操作只露出一半；根因：Editor Runtime 的主工具栏布局与 Tiptap table selection 上下文；表格动作不能作为文档流中的第二排，也不能替换主工具栏。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-043` 表格对齐只改当前单元格且发送时丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在表格第三列点“居中”后，富文本只可能改变当前单元格；切到源码仍显示 `---`，发送后的 Markdown 不保留对齐；根因：GFM 只表达整列对齐，但 Runtime 直接调用 Tiptap `setCellAttribute`，该命令只更新当前单元格；编辑态文档与发布格式的语义边界不一致。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-044` 工具栏触摸焦点修复反而截断横向滚动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 为避免点工具后丢失选区而统一拦截 `pointerdown` 后，工具栏最右侧只露半个按钮且手指无法横向滚动；触摸手势在按钮命中阶段就被取消；根因：共享 Tiptap `EditorButton` 与 Popover trigger 对指针类型的默认行为所有权；触摸必须交给 WebView 的原生滚动，鼠标点击才需要阻止浏览器抢走编辑选区。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-045` 表格操作以遮罩或第二层菜单盖住正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 点表格后出现不透明弹窗或第二排按钮，用户完全看不到正在编辑的单元格；行列动作含糊，蓝色对齐选中项还可能被横向边界裁掉；根因：Editor Runtime 的 Tiptap table selection 与 BubbleMenu；菜单可见性、命令可用性和锚点都必须直接来自当前 Editor 状态，不能由共享 builder 或返回按钮维护另一套生命周期。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-046` 源码模式出现黄色焦点框且编辑区缩成小块

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | CodeMirror 周围出现浏览器默认黄色/高亮焦点线，源码只占正文区域的一小块，下面留下大片无法输入的空白；根因：Editor Runtime 创建 CodeMirror theme 时的 CSP nonce，以及 source pane 唯一 flex 高度和焦点样式合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-047` Footer 字符数停留在初始草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 编辑已有回复或恢复草稿后正文已经变化，Footer 仍显示 `0 字符` 或旧长度；收到 autosave snapshot 后也不刷新；根因：`StructuredReplyComposer` 的 `editorState.markdownLength`；外部草稿和带 revision 的确认 snapshot 是仅有两个可更新来源，逐键状态消息不携带正文长度。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-048` Builder 校验错误在用户修正后仍不消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06` |
| 历史症状与根因 | NodeSeek 投票点击插入后提示“请输入投票标题”；用户随后填写标题，旧错误仍挂在表单上，视觉上像输入无效或按钮卡死；根因：Editor Runtime Builder 内唯一 `builderError`；它只描述上一次提交的输入，不是独立状态机或服务端错误。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-049` NodeSeek 私有 marker 往返后退化或消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06`、`NOTIFY-02` |
| 历史症状与根因 | 本地生成的 Stardust 收款卡片切到 Markdown 源码后，再切回富文本只剩裸 URL；源码以 GFM 表格结尾时继续插入 poll 和 Stardust，两者会粘到表格末行并在模式往返后消失；根因：Stardust 协议解析只处理已验证前缀后的 query；source-mode poll/Stardust 统一走现有 `insertSourceBlock`。编辑器、阅读 renderer 与发送校验共享 marker 语义，不依赖浏览器自定义 scheme，也不各自补换行。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-050` 表格操作栏滚到末端仍裁掉“删除表格”

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | NodeSeek 表格二级操作栏可以横向滑动，但滚到最右后“删除表格”仍只露出一部分，无法得到完整可读、可点的末端动作；根因：表格 BubbleMenu 的视口边界和横向滚动合同；菜单必须以整表为锚点，同时把自身宽度限制在当前 WebView 可用区域。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-051` 选择贴纸后焦点和 Gboard 没有回到正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02`、`WRITE-05` |
| 历史症状与根因 | NodeSeek 贴纸插入成功并关闭选择器后，Gboard 同时收起；用户必须再次点击正文才能继续输入，看起来像贴纸后不能写文字；根因：Editor Runtime 的表达式插入命令及共享 `insertAtSelection`：成功写入必须由 Tiptap/CodeMirror 自己恢复原选区和 focus，取消或显式关闭 Builder 仍保持不抢焦点。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-052` 贴纸后的光标显示在下一行但文字写到右侧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | 终端贴纸后的蓝色 caret 和选择手柄显示在贴纸左下方的新行；实际按键后文字却出现在贴纸右侧，视觉反馈与真实插入位置不一致；根因：Tiptap `useEditor` 的 `injectNonce` 必须与本地 HTML 的 `style-src nonce-wz-composer-runtime` 保持同一值，使 ProseMirror 自有 separator、gap cursor 和 selection 基础样式成为实际渲染合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-053` 两站通用富文本 UI 分叉且表格交互由隐藏 Builder 驱动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 标题点击后出现整页遮罩、链接占满正文、表格操作替换主工具栏并要求“返回”；LinuxDo 与 NodeSeek 对同一格式呈现两套不同交互，修一站会留下另一站旧实现。源码光标处插入列表或表格还可能与前后正文粘成无效 Markdown；根因：L/NS 唯一 `StructuredReplyComposer` 的通用 UI ownership：Tiptap 文档/selection 是格式状态唯一来源，站点 Adapter 只拥有业务能力；CodeMirror 选择替换必须区分行内与块级 Markdown。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-054` LinuxDo 大 Emoji 目录使编辑器 INIT 整体失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek Composer 正常，切到已加载完整 Emoji 目录的 linux.do 后只显示“正在初始化编辑器”，随后变成启动超时；Emoji、图片和全部正文工具都无法使用；根因：`StructuredReplyComposer` 发出 `INIT` 前的目录结算与 `structuredComposerBridge` 的同一数量上限；站点目录不能把编辑器生命周期变成部分有效消息。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-055` 业务表单泄漏浏览器样式且表格菜单覆盖主工具栏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`WRITE-06`、`NOTIFY-02` |
| 历史症状与根因 | 链接输入框同时出现三层蓝色边线，投票和 Stardust checkbox 是突兀的浏览器方框；表格靠近正文顶部时，BubbleMenu 与 sticky 主工具栏叠在同一位置，对齐二级菜单继续堆叠，遮住操作和表格；根因：`editorRuntime.css` 的共享 Tiptap 表单 primitive，以及 `TableContextMenu` 从真实 `.toolbar-stack` rect 派生的 Floating UI collision padding；两站 Builder 和每张表必须共用同一规则。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-056` LinuxDo Emoji 目录晚于编辑器 READY 时仍为空

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | linux.do 回复编辑器已经可输入，但 Emoji 面板只显示少量旧数据或一直显示“正在读取表情目录”；目录稍后加载完成也不会更新；根因：RN→Editor Bridge 的 `set-discourse-emoji` 文档命令：目录是可替换的展示资源，不是文档初始化状态。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-057` 表情面板重开反复请求、分类叠图且缩略图过小

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 贴纸或 linux.do Emoji 面板关闭后再打开会重新空白加载；NodeSeek 切到“洋葱头”等分类时仍显示 AC 娘，多个分类实际叠在同一区域；缩略图辨识困难；根因：单个 Editor Runtime 内的表达式图片节点 ownership 与 `.expression-grid[hidden]` 可见性规则。面板和 NodeSeek 各分类只挂载一份真实 `<img>`，打开/关闭和分类切换只使用原生 `hidden`；隐藏图片保留 `loading=lazy`。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-058` LinuxDo 硬换行显示反斜杠且行首 date 被私有块吞掉

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 富文本点“硬换行”会在正文显示反斜杠字符；行首插入 date/time 后显示成通用“站点私有块”，完整 marker 挤满一行；根因：富文本命令应调用 Tiptap `setHardBreak()`；未知块 tokenizer 必须把 `date=` 留给 `LinuxDoDateNode`，专用节点负责紧凑展示并保留原始 Markdown。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-059` 半屏误判横屏导致 Emoji 网格拥挤且搜索割裂

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 竖屏手机的半屏 Composer 把 linux.do Emoji 排成八个拥挤列，缩略图与名称难以辨认；搜索又显示为独立的“搜索”文字和原始输入框，与同一 Builder 的控件风格割裂；根因：表达式网格应由 CSS intrinsic sizing 直接消费当前容器宽度；搜索应复用 Editor Input 的单一 focus perimeter。设备方向、Sheet 展示状态和图片加载不应进入 JS 布局状态。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-060` 投票选项退化为“每行一个”文本域

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 与 linux.do 的投票 Builder 要求用户在一个文本域中手工换行输入全部选项，无法直接看出如何新增、删除或编辑单项；交互比原站倒退；根因：两站 Builder 共用一个无状态的选项列表视图，直接读写领域数组；每项一个受控 Input，增删只做数组的 map/filter/append，不引入 option ID、选区备份或菜单状态机。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-061` 源码模式仍悬浮富文本表格菜单

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在富文本中选中表格后切换 Markdown 源码，表格的“行/列/对齐/删除表格”BubbleMenu 仍浮在 CodeMirror 上方，遮挡源码并暴露会操作隐藏富文本的控件；根因：表格菜单的渲染 owner 同时需要“当前是 rich mode”和“当前 selection 在表格内”；模式已经是 Runtime 的唯一真值，无需再创建菜单状态或清空 selection。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-DATA-006` 备份 URL 携带未知 query 凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03`、`FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 历史症状与根因 | 备份虽删除已知 token 名，未知签名参数、userinfo 或 fragment 仍可随 Topic、用户和头像 URL 导出并在导入后继续保存；根因：`src/domain/reader/readerData.ts` 的 Topic/User summary 与 ReaderData v2 的 load/save/import/export 统一 sanitizer。 |
| 当前 owner | `src/domain/reader/readerBackup.test.ts` |


## `REG-TOPIC-051` NodeSeek Markdown 无输入预算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 异常大的 NodeSeek Markdown 可进入 Markdown/linkify 全流程，造成不必要的 CPU 与内存占用；根因：`src/sources/nodeseek/markdown.ts` 的唯一 MarkdownIt 实例及进入 `sanitizeContentHtml` 前的输入门禁。 |
| 当前 owner | `src/sources/nodeseek/markdown.test.ts` |


## `REG-PROXY-007` localhost relay 接受危险目标并遗留空闲 tunnel

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | WebView localhost relay 可接受任意端口、userinfo、畸形 request line、非标准 numeric IPv4、IPv4-compatible/mapped IPv6 或私网 IP literal；合法首请求后的流水线第二 target 还能绕过校验，空闲 tunnel 也可能长期占用连接与 copy worker，按方向独立计时又会误杀仍在持续单向传输的 tunnel；worker 结束与 relay 停止并发时还可能抛异常并跳过后续 socket/executor 清理；profile 只改名还会无意义重启；根因：`plugins/withNetworkProxyModule.js` 生成的 `LocalNetworkProxyServer` 与 `useNetworkProxyRuntime` apply key。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-OPS-015` 发布 secret 进入所有子进程且缺少 provenance

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 历史症状与根因 | `.env.release.local` 的签名变量进入全局 `process.env` 并穿透 verify/prebuild/native test/smoke；产物只能看到 APK hash，无法追踪源码、lockfile 与 toolchain；根因：`scripts/release-environment.mjs`、`scripts/release-android.mjs` 与 release manifest 生成顺序。 |
| 当前 owner | `tests/tooling/release-environment.test.ts` |


## `REG-FEED-012` TopicCard memo 忽略不可见 payload 变化

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04`、`SEARCH-02`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 历史症状与根因 | 两个 Topic 展示文字相同但 `url/categoryId/authorId` 已变化时，卡片不重渲染，点击和 trailing action 继续使用旧对象；根因：`TopicCard` 的 immutable Topic 输入和 memo comparator。 |
| 当前 owner | `tests/ui/shared/topic-card.test.tsx` |


## `REG-FEED-013` Feed 请求期间先露空白再出现 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首次读取或切换来源后，顶部内容区可能先闪一帧空白，再出现灰色 Loading；请求最终仍能成功；根因：`FeedScreen.renderFeedScene` 在目标 route 成为 active 后立即用空 `FlashList` 替换预铺 Loading；原生列表布局和 `ListEmptyComponent` 建立前，透明 Pager 暴露页面背景。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-UPDATE-005` 连续版本下载累积历史 APK

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | 每个更新版本使用不同 cache 文件名，连续下载会留下多个历史 APK；下载失败还可能保留 partial；根因：`useAppUpdateRuntime.downloadAppUpdate` 的 cache target 与失败清理。 |
| 当前 owner | `src/platform/update/useAppUpdateRuntime.test.ts` |


## `REG-UPDATE-006` App 内新版仍打开上一版安装包

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | App 已检测并显示新版本，下载后 Android 安装确认仍提示上一版；同一 Release 由浏览器直接下载时正常；根因：`useAppUpdateRuntime.downloadAppUpdate` 的文件身份与 `ApkInstallerModule.installApk` 的 FileProvider URI。 |
| 当前 owner | `src/platform/update/useAppUpdateRuntime.test.ts` |


## `REG-PERF-007` 进程级缓存与通知无容量或 identity 边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`DATA-01`、`MORE-02` |
| 历史症状与根因 | 图片尺寸/revision 与诊断引用可随进程运行无界增长；任一原图显示会唤醒所有监听者；memo comparator 和 ReaderData render 反复做无谓扫描/序列化；根因：HTML 图片尺寸、原图 revision、诊断 reference、ReaderData controller 与 Topic/Reply memo comparator。 |
| 当前 owner | `src/platform/media/originalImageLoading.test.ts` |


## `REG-PERF-009` 图片 cache getter 在 React render 阶段提升全局 LRU

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 被 React 丢弃或重复执行的图片 render 也会改变进程级 cache 淘汰顺序；长帖、返回和预览切页期间，真正已提交的热尺寸、原图 revision 或 SVG artifact 可能被 speculative render 挤出；根因：`src/features/topic/rendering/previewRenderers.tsx`、`src/platform/media/originalImageLoading.tsx` 与 `src/platform/media/compatibleImageSources.ts` 的 cache read/promotion ownership。 |
| 当前 owner | `src/features/topic/rendering/useHtmlRenderingController.test.tsx` |


## `REG-TOPIC-056` Discourse Callout marker 被当作普通灰色引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do cooked HTML 中的 `[!warning]`、`[!caution]` 等 Callout marker 原样可见，整块按普通灰色引用渲染；评论引用展开后同样丢失黄色警告等语义，富文本标题、嵌套和折叠内容没有统一布局；根因：`src/sources/discourse/content.ts` 的 cooked-HTML 协议边界、`compileForumContent()` 的一次性 fold 解释，以及 `TopicSplitDisclosureStore` 的唯一展开状态 owner。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-057` route epoch 被固化为 Topic 身份导致永久 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`NAV-03` |
| 历史症状与根因 | Topic 在账号 generation 变化后会立即隐藏旧内容，但同一路由即使收到新 generation 内容仍永久停在 Loading；返回嵌套 Topic 时还可能复用已经失效的旧内容；根因：`src/features/topic/TopicRoute.tsx` 的固定 `Topic` 参数、`src/features/topic/useTopicSessionController.ts` 的 session epoch 读取，以及 `src/platform/query/serverState.ts` 的 Topic Query key。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-058` 48dp 门禁把回复目标撑成大按钮

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | V2EX 等站点的楼层回复关系原本是紧凑标签，未发布改动后变成高大蓝色按钮，挤开正文并与内联 mention 抢层级；真实 V2EX 7 楼可稳定复现；根因：`ReplyItem` 的 reply-target Pressable 与 `themeStyles.replyTargetPill` 把视觉几何误当成触控几何。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-059` 无关 Topic 状态变化重挂载已显示富媒体

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 正文图片加载完成后，打开全屏预览再返回会闪回灰色占位；评论引用或评论展开/收起时，已显示图片短暂出现 Spinner，inline emoji、贴纸和其他 HTML 富媒体也会消失后重现；根因：`src/features/topic/rendering/useHtmlRenderingController.tsx` 的动作代理与 renderer registry 生命周期，以及 `react-native-render-html` 以 renderer 函数作为 React 组件类型的消费方式。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-060` NodeSeek 后续页首条回复被当作主楼过滤

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 后续分页会缺少该页第一楼；消息通知恰好指向这一楼时，主题内存在正文，但消息详情显示“消息不可见”；根因：`src/sources/nodeseek/topicParser.ts` 的 `parseRenderedNodeSeekTopicHtml` 无条件把首个 `.content-item` 当作主楼过滤，`src/sources/nodeseek/reader.ts` 未把当前页码传入 parser。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-061` 妖火回复目标楼层和作者丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 妖火主题的回复正文正常显示，但原站“回复 88 楼”的关系被丢弃；例如 90 楼明确回复当前用户，App 内既看不到目标楼层，也看不到被回复人；根因：`src/sources/yaohuo/topicParser.ts` 只提取作者和正文，丢弃原站 `tofloor` 关系；共享 `Reply` 又只允许作者字符串，无法独立表达“只知道楼层”或“楼层与作者均已确认”。 |
| 当前 owner | `src/sources/yaohuo/parser.test.ts` |


## `REG-PROXY-008` 阻塞写绕过共享 tunnel deadline

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | relay 任一方向的 socket write 永不返回时，两个 copy task 和 connection worker 可永久占用并发槽；读侧 timeout 已到期也无法结束 tunnel；根因：`plugins/withNetworkProxyModule.js` 生成的 `LocalNetworkProxyServer.pipeBoth` 与既有 `TunnelIdleDeadline`。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-OPS-016` Java 环境提示被写成 release provenance

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 历史症状与根因 | 设置 `JAVA_TOOL_OPTIONS` 或 `JDK_JAVA_OPTIONS` 后，release manifest 的 `javaVersion` 可能记录提示行而非 JVM 版本；失败路径还可能把原始输出或 marker 带入日志；根因：`scripts/release-environment.mjs` 的 Java provenance parser 与 `scripts/release-android.mjs` 的 preflight 接线。 |
| 当前 owner | `tests/tooling/release-environment.test.ts` |


## `REG-OPS-017` Android Smoke 强制无窗口启动模拟器

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 执行 Android Smoke 时模拟器只在后台启动，操作者看不到设备画面，无法监督首次启动和后续 Replay；根因：`scripts/smoke-android.mjs` 覆盖了 agent-device 默认的 GUI 启动行为。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-018` 正常代码更新误用 agent-device reinstall 重置主 AVD App 数据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 为查看最新构建而安装 APK 后，主模拟器账号中心从已有登录变成全部未登录，本机数据看似被重置；后续普通启动载入旧 Quick Boot 状态后登录又出现，造成“数据已永久丢失”和“Cookie 自己恢复”的相互矛盾判断；根因：`agent-device 0.20.6` 的 Android `reinstall` 会先执行不带 `-k` 的 `adb uninstall`，再安装 APK；帮助文案 “Replace installed app” 没有承诺保留数据。仓库 Smoke 本来使用安全的 `install`，但临时人工命令绕过了该边界；看到账号全部未登录后又把 UI 当成永久丢失证据，在证据不足时操作 Quick Boot，扩大了诊断风险。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-019` booted emulator ID 被当成 AVD 名导致 Smoke 无法启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 主 AVD、APK SHA、版本和安装时间均已精确匹配，但设置 `WZ_ANDROID_SMOKE_DEVICE=emulator-5554` 后，Smoke 在安装前报不存在名为 `emulator-5554` 的 AVD，`APK_SANITY` 与七条 Replay 均未执行；根因：`withSmokeSession` 把同一个原始 selector 同时用于不同契约：ADB/Replay 接受 booted device ID，`agent-device boot --device` 则需要 AVD 名。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-020` 多台已启动设备使 Smoke 首次启动与前台校验串到主 AVD

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 主 AVD 被另一个 agent-device 会话占用时，即使 Smoke 明确选择独立验证 AVD，覆盖安装仍成功但首次 `open` 会误选主 AVD 并报 `DEVICE_IN_USE`；补上设备选择后，`appstate` 又可能读取第一台已启动设备并误判 App 不在前台。根因：`boot` 和 `install` 不保证为后续命令建立可靠的设备绑定，而首次 `open` 未携带所选设备、`appstate` 未携带已解析的 emulator serial。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-NOTIFY-001` 前台恢复旧未读被误报为新消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 打开 App 或进入 More 时，页面底部出现带 App 图标、厚胶囊背景和阴影的“有新的站内消息”；它与扁平列表和底部消息圆点重复，且已有未读也被误报成刚收到的新消息；根因：`src/features/notifications/useNotificationsRuntime.ts` 若只比较未读计数就无法区分旧未读与新稳定 ID，并可能把恢复值交给全局 `notify`。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-002` 消息与代理入口缺少分隔线

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | More 中“消息通知”和“服务器代理”连续显示且没有分隔线，两项在视觉上粘成一块；根因：`src/features/more/components/MoreUtilityPanels.tsx` 的工具组只有组末边框和行间距，没有组内分隔。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-NOTIFY-003` 消息页原生顶栏出现悬浮阴影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NAV-01` |
| 历史症状与根因 | 消息页标题栏底部出现明显灰黑渐变阴影，像悬浮层压在来源筛选上，与项目扁平列表不一致；根因：`src/app/AppNavigator.tsx` 依赖 native stack 默认 header elevation，根 `screenOptions` 未关闭 header shadow。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-NOTIFY-004` 消息栈硬件返回被 App 根处理器截获

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 在消息列表、详情或设置按 Android 返回键时，没有按 native stack 返回上一层，而是被 App 根返回逻辑送回 Feed；根因：`src/app/appNavigation.ts` 的 native-stack route 分类与 `src/app/useAppBackHandler.ts` 的返回所有权。 |
| 当前 owner | `src/app/AppNavigator.test.ts` |


## `REG-NOTIFY-006` 非终态访问不可用被当作退出清除消息状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 登录 surface barrier、旧 unknown 记录或 Cloudflare challenge 期间，某站消息缓存、去重水位和通知摘要被当作退出清空；恢复同一账号后旧未读可能闪失或被重新投递；根因：`src/features/notifications/useNotificationsRuntime.ts` 的可信 identity 投影、active source 门禁和身份变化清理 effect。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-007` 旧账号消息详情使用新账号读取和已读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-02` |
| 历史症状与根因 | 从账号 A 的列表进入消息详情后切到账号 B，旧条目可能通过 B 的 session 加载正文或提交已读，造成串号读取和写入；根因：`src/ui/navigation/appRouteTypes.ts` 的详情 route identity、`src/features/notifications/NotificationRoute.tsx` 的 Query/mutation `AbortController` 生命周期，以及 `src/sources/notificationGateway.ts` 在 adapter I/O 前的 expected identity 门禁。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-008` 系统通知失败仍消耗投递 ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 新消息已经写入 delivered IDs，但 Android 摘要创建失败；后续后台轮次把它当作已投递，用户永远收不到该条通知；根因：`src/platform/notifications/notificationStore.ts` 的投递记录事务与 `src/platform/notifications/notificationWorker.ts` 的系统投递失败处理。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-009` 后台记录后关闭开关或换号仍发送摘要

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 后台扫描或 native 展示期间，用户立即关闭全局/单站通知或切换账号，旧轮次仍可能把 delivered IDs 与旧 identifier 写回已关闭或新账号状态；根因：`src/platform/notifications/notificationWorker.ts` 的 ack 后 currentness 门禁，以及 `notificationStore.recordNotificationDelivery` 的 compound CAS。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-010` 妖火消息列表与详情混入删除动作或聊天历史

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 妖火消息时间显示成“删除”，无方括号日期被拼进发送者；打开真实详情会提示“正文未找到”，或把回复、删除与聊天历史当成正文；根因：`src/sources/yaohuo/notifications.ts` 的 `parsePage` 时间/actor 边界、`loadDetail` 官方内容字段选择和列表复核。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-011` Discourse 顶层通知字段被忽略

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | linux.do通知明明带有标题、发起者和头像，列表却显示“站内消息”、错误 actor 或缺失头像；根因：`src/sources/discourseNotifications.ts` 的 `parseNotification` 顶层/嵌套字段优先级与头像绝对 URL 转换。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-012` NodeSeek 缺失远端 ID 的 fallback 泄露且不稳定

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03`、`MORE-02` |
| 历史症状与根因 | NodeSeek 某些消息行没有远端 row ID 时，列表重排或标题/预览编辑会产生新本地 ID，导致重复 Android 摘要；私信对方 UID 还可能进入持久化 delivered IDs；根因：`src/sources/nodeseek/notifications.ts` 的 `rowNotification` 远端 ID选择、`stableFallbackId` 输入和私信 target/持久化 identity 分离。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-013` 消息条目读屏文案缺少动作

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | TalkBack 聚焦消息条目时只听到来源、已读状态、参与者和标题，不知道对方是提到、回复、私信还是系统互动；根因：`src/features/notifications/notificationPresentation.ts` 的 `notificationAccessibilityLabel` 与 `notificationActionText`。 |
| 当前 owner | `src/features/notifications/notificationPresentation.test.ts` |


## `REG-NOTIFY-014` 短来源 Tab 可点击区域不足 48dp

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NAV-01` |
| 历史症状与根因 | 消息页“全部”“妖火”“linux.do”等短来源 Tab 点按区域过窄或过矮，视觉上能看到但单手难以稳定点击；根因：`src/ui/controls/SelectionControls.tsx` 的共享 tab style，而不是消息页私有 padding。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-015` 聚合消息页重试一个失败来源会重读或覆盖其他站

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | “全部”消息页有多个站点失败时只显示一个笼统重试；点击后可能重新请求全部来源，导致其他站已显示的可信消息闪动、消失或被覆盖；根因：`NotificationsScreen` 的来源错误投影与 `NotificationRoute.retrySource` 对聚合 infinite query 的定向 patch；不能把来源级恢复退化成整页 `refetch/listAllPage`。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-016` 暂停私有访问的账号在消息设置中被误报为未登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 同一时刻 More 账号中心显示某站“登录状态待确认”，消息通知设置却显示“未登录；开关意图会保留”，让已登录用户误以为账号丢失；根因：`NotificationScreens.sourceSettingStatus` 与 `NotificationsRoute.sourcePending` 没有区分 unavailable 与 anonymous。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-018` 前台新消息只亮圆点而不显示 Android 摘要

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | App 正在前台时，NodeSeek 等站已收到新回复，More 圆点和未读数会变化，但系统通知栏、横幅和声音均没有提醒；根因：`src/features/notifications/useNotificationsRuntime.ts` 的前台刷新与 `src/platform/notifications/notificationWorker.ts` 投递状态机未连接，以及 `index.ts`/`src/platform/notifications/notificationSystem.ts` 缺少前台展示 handler。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-019` 私有访问暂停或退出后旧聚合缓存仍暴露消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01` |
| 历史症状与根因 | 某站因 true unknown/auth-surface barrier 暂停私有访问后，单站页仍显示上次账号消息；明确退出或换号后，单站 Query 已清除，但“全部”聚合 Query 仍保存旧账号条目；根因：`NotificationScreens` 的 active-source 可见性门禁与 `useNotificationsRuntime` 的 canonical identity cache eviction。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-021` 聚合来源重试可串号并截断后续分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | “全部”列表重试失败来源时若恰好换号，返回的新账号消息可能被写进旧账号 Query；若其他来源已翻到后续页，重试恢复的来源即使还有下一页，“加载更多”也不会再请求它；根因：`notificationGateway.listPage` 的 exact identity 门禁和 `NotificationRoute.retrySource` 对 aggregate infinite-data cursor 所有权。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-022` 后台任务注册竞态让旧开关意图覆盖最新状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 快速开关消息通知后，设置显示已关闭但 WorkManager 仍注册，或显示已开启但后台任务已经被旧注销操作移除，后续后台新消息没有提醒；根因：`src/platform/notifications/notificationSystem.ts` 把“读取当前注册状态”和“应用目标状态”作为可并发的两段 native 操作。 |
| 当前 owner | `src/platform/notifications/notificationSystem.test.ts` |


## `REG-NOTIFY-023` 快速连续换号时旧身份 effect 覆盖最新水位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-03` |
| 历史症状与根因 | A→B→C 快速身份变化后，UI 已显示 C，但持久化通知身份又被较慢的 A→B 清理写成 B；后续 C 的 worker 因身份不一致持续跳过；根因：`src/features/notifications/useNotificationsRuntime.ts` 的 identity reconciliation 缺少每个异步副作用后的当前 generation 门禁。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-024` 发送期间关闭通知或换号后旧摘要复活

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 用户关闭通知或切换账号后，已经清除的旧账号摘要又出现在通知栏；旧 worker 还可能消耗该条投递 ID，之后无法正确重试；根因：`src/platform/notifications/notificationWorker.ts` 的投递 owner、`notificationStore` 的 identifier CAS、`notificationSystem` 的 strict/broad 撤销边界，以及 config plugin 生成的 native exact present/dismiss bridge 共同组成一项本机事务。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-025` 消息中心可见时跳过系统通知并永久吞掉投递

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | App 在前台且消息中心可见时收到新回复，列表会刷新但 Android 系统通知不出现；投递 ID 已被记录，离开页面或重启后也不会补发；根因：`src/features/notifications/useNotificationsRuntime.ts` 提供给共享 worker 的 foreground notification sink。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-026` 单次 snapshot 写入失败阻断全部前台投递

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 某次未读计数已成功读取，但一次 AsyncStorage 写入失败后，本轮所有成功来源都不进入 worker；用户至少再等一个轮询周期才能收到提醒；根因：`src/features/notifications/useNotificationsRuntime.ts` 的 snapshot 持久化与成功来源投递编排。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-027` 消息列表失焦后隐藏页面仍每分钟读取站点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 从消息列表进入详情或完整主题后，已隐藏但仍 mounted 的列表继续每分钟访问三站，造成无意义请求和与当前页面不一致的刷新；根因：`src/features/notifications/NotificationRoute.tsx` 的 native stack focus 与列表 Query 生命周期。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-028` NodeSeek 省略 `viewed` 的新消息被当成已读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | More 已显示“有未读 · 后台通知已开启”，Android 权限和 channel 正常，但朋友新发的 @我/回复没有系统通知；根因：`src/sources/nodeseek/notifications.ts` 把缺失的已读标记默认成 `true`，worker 因 `unread=false` 过滤该行。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-029` NodeSeek 同一通知记录的新回复被投递水位去重

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 朋友再次回复同一帖子后 More 能看到未读，但 Android 通知栏没有新的系统通知；根因：`src/sources/nodeseek/notifications.ts` 优先用列表行 `id` 生成统一消息 ID，把远端 `markViewed` 记录 ID 与每条回复的稳定身份混为一体，worker 将新回复误判为已投递。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-030` NodeSeek 自己发出的私信被误报为对方新私信

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 用户刚给对方发送私信后，App 却显示“对方发来私信”并触发一条新的 Android 系统通知；根因：`src/sources/nodeseek/notifications.ts` 的列表解析只看 `viewed`，没有像详情未读 ID 逻辑一样同时校验 `sender_id !== ownUserId`。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-031` 单站通知被全局类型抹平且私信无法按原站协议回复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`NAV-01` |
| 历史症状与根因 | 进入某个站点后仍只能看到跨站“全部/未读”，无法选择原站的 @我、回复、个人信息、系统或聊天分类；私信详情只有一段正文，不能连续阅读双方消息，也不能在 App 内回复；根因：展示类型与站点筛选语义被合并在全局 domain；会话读取、回复 transport、身份/scope/abort 门禁和草稿确认语义没有经过 `NotificationAdapter → notificationGateway → NotificationRoute` 同一链路。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-032` 私信会话退化成顶部正文且丢失既有图片与表情能力

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01`、`ACCOUNT-01` |
| 历史症状与根因 | 私信消息挤在页面顶部、正文下方留下大块空白，作者与时间反复塞进气泡，底部只有孤立的“回复私信”按钮；打开回复后，Topic 已有的图片上传、NodeSeek 贴纸和 Discourse emoji 全部消失；根因：Topic-local composer 同时拥有共享编辑能力与 Topic 目标文案，通知功能因此复制了残缺实现；会话布局没有把 native header、消息流和固定 composer 入口分成明确层级。App runtime 又直接实现 LinuxDo 模板、计数和投票能力协议，绕过 notification gateway 的 route identity 生命周期。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-033` NodeSeek 后续页通知详情错误显示不可用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 的 @我/回复条目可正常进入完整主题并看到目标楼层，但消息详情却显示“NodeSeek 消息对应的帖子内容未找到”；根因：`src/sources/nodeseek/notifications.ts` 的通知详情分页曾固定从第 2 页开始并按 `replyCount` 推导末页，丢弃了通知 floor 已提供的可靠页提示和原站页拓扑。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-034` 通知详情底栏被系统手势区遮挡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 私信详情底部输入入口贴到系统手势条上，视觉拥挤且底部点击区域可能被遮挡；普通通知的固定主题按钮存在同一风险；根因：`src/features/notifications/NotificationScreens.tsx` 的两个固定 dock 只使用固定垂直 padding，没有消费 `react-native-safe-area-context` 提供的 bottom inset；弹出的共享 Composer 已独立正确处理安全区。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-035` 消息一级 Tab 文字与选中线不同轴

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | 消息页一级来源 Tab 看起来歪斜：短中文标签靠在点击区左侧，蓝色选中线却铺满整个最小宽度；长英文标签接近占满宽度，导致同一排各项朝向不一致；根因：`src/ui/controls/SelectionControls.tsx` 的 `tab` 保证了最小宽度，但 `tabText` 没有居中；React Native Text 拉伸到按钮宽度后沿默认起点绘制。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-036` 消息中心与共享回复器忽略 App 字号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | More 已显示“字号 130%”，消息列表、私信气泡和回复输入框却仍保持 100% 大小；页面间字号所有权不一致，大字号也无法改善可读性；根因：`createNotificationStyles`、原生 Composer chrome 与 Yaohuo 输入器没有一致消费 `ReaderStyleProvider` 的 `settings.fontScale`。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-NOTIFY-037` 妖火聊天泄露原始包装并重复、倒序或丢失时间

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 妖火会话气泡显示“回复时间/回复内容”等原站协议标签，原消息在聊天中重复；服务端倒序记录直接展示，日期甚至被当作作者，清理包装后气泡时间又消失；根因：`src/sources/yaohuo/notifications.ts` 把 `.con` 原 HTML直接当正文，没有先分离协议元数据、按内容去重和按解析时间排序；作者/时间只信任单一 `.info` 结构。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-038` 大字号回复工具与表情网格被截断或失去输入反馈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 130% 下工具栏末尾的引用、代码或列表无法通过横滑到达；输入光标仍是系统默认色；Discourse 表情同时显示英文名称，网格拥挤且不像可浏览的表情面板；根因：结构化 Composer 的工具容器没有同时保证单行内容宽度、嵌套横向手势和末尾工具可达；TextInput 未声明主题 cursor/selection color；Discourse emoji 使用文字型可变宽单元，而不是图像优先等宽网格。工具栏具体布局由后续 `REG-NOTIFY-055` 收敛。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-039` 三站消息时间格式互相跳变

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 同一消息页同时出现“8/3 09:05”、`2026/7/3 13:46` 和 ISO 派生格式，跨年份或站点时难以快速比较；气泡时间与列表又使用不同 formatter；根因：`notificationTimeText` 对两类时间分别调用通用相对格式和原字符串；会话气泡另直接使用 `formatDateTime`。 |
| 当前 owner | `src/features/notifications/notificationPresentation.test.ts` |


## `REG-NOTIFY-040` 通知富文本链接脱离 App 主题色

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 通知详情中的链接使用 `react-native-render-html` 默认蓝色，与 App primary、深浅主题和其他可点击文字不一致，看起来像未完成的网页片段；根因：共享 `DetailHtml` 只传 baseStyle，没有为 `a` 提供由 Reader theme 拥有的 `tagsStyles`。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-041` 表情面板把回复操作压进 Android 导航栏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 130% 下打开 NodeSeek 贴纸或 Discourse emoji 后，“取消/发送回复”被压到 Android 手势条后面；若简单放开高度，linux.do 表情面板又铺满整屏并留下过量空白；根因：`ComposerBottomSheet` 把最大动态内容高度固定为窗口 58%，子内容超过上限后仍继续布局；既有 bottom safe padding 因内容溢出而落到容器外。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-042` 妖火气泡外斜杠时间在 Android 丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 妖火聊天气泡能显示作者、图片和正文，但真实已读会话的气泡下没有时间；根因：`chatMessages` 只从 `.info` 与正文节点取时间；共享 `toIsoString` 又只规范化连字符日期，导致 Node 测试偶然通过而 Android 返回 null。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-043` Discourse 私信从所有通知进入时退化为普通帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 同一条消息在“所有通知”列表已经显示“发来了私信”，点进去却是普通通知/帖子详情；从“个人信息”点进去才显示完整私信会话和回复入口；根因：`parseNotification` 正确生成了 `kind=private-message`，但 target 仍无条件按 `topic_id/post_number` 生成 `topic-post`；详情 loader 按 target 分支，因此丢失会话与回复能力。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-044` 妖火会话主题链接跳出 App 打开浏览器

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-01`、`TOPIC-03`、`NAV-01`、`NAV-03` |
| 历史症状与根因 | 妖火会话里的“查看主题帖”和“查看完整回复”点击后打开系统浏览器，离开 App；部分真实会话中“查看完整回复”还会被清理器直接删除；根因：妖火 adapter 把“查看完整回复”误当作 footer 包装删除；消息 `DetailHtml` 又未复用 `parseForumTopicLink`，所有锚点都沿 renderer 默认行为交给 `Linking.openURL`，且 route callback 无法携带解析后的 Topic。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-045` 妖火“查看完整回复”进入主题后丢失具体楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | “查看完整回复”已经留在 App 内，但进入主题后仍停在主楼，用户还要手动寻找原站指向的具体回复；根因：`DetailHtml` 只调用 `parseForumTopicLink` 得到 canonical Topic，原始 query 被丢弃；`onOpenTopic` 与 Notification route 也没有继续传递链接级 `targetReply`。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-NOTIFY-046` 妖火目标楼层线性追页且分页被同名用户劫持

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | “查看完整回复”进入主题后可能从第 2 页逐页请求到目标页；普通帖子或用户列表遇到昵称为“下一页”的用户时，还会提前停止分页或跳进用户主页；根因：Topic 目标回复加载只保留 `{ floor }`，沿通用“加载更多”从当前页线性追赶；初次直达实现又把可选的 `Response.url` 当成唯一当前页依据，缺失时回退为 1，下一次错误请求第 2 页。妖火 HTML parser 还把链接文本当成分页身份，未要求合法 `page` 游标和对应列表 endpoint。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-NOTIFY-047` NodeSeek 完整主题链路丢弃 comment ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03` |
| 历史症状与根因 | 通知详情能找到准确回复，但“查看完整主题”在缺少楼层时留在首屏；楼层提示错误时还可能定位到同楼层的其他回复；根因：Topic Controller 把 floor 当成必填目标，且共享读取接口只继续传 `targetFloor/pageHint`，路由已有的完整 `ReplyLocationTarget` 在到达 NodeSeek adapter 前被压扁。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-NOTIFY-048` NodeSeek `message_id` 兼容值只用于去重未进入导航目标

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 某些 NodeSeek @我/回复行可以稳定显示和去重，但打开完整主题时没有精确 comment ID，只能退化到楼层；根因：mapper 用 `comment_id || message_id` 生成通知 ID，却只把 `comment_id` 写入 `target.postId`，同一个远端身份在投递和导航模型中分叉。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-049` 身份待确认被当成换号并清空私信草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-02` |
| 历史症状与根因 | App 短暂重新确认账号时，正在编辑但未发送的私信草稿被清空；确认仍为同一账号后无法恢复；根因：Notification route 在任何 `canAccessSource=false` 时无条件清草稿，把真正 unknown 或登录 surface barrier 的暂停访问误当成已确认退出或换号。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-050` 消息共享 Tab 与按钮绕过 Reader 字号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-03`、`FEED-02`、`FEED-03`、`FEED-04`、`SEARCH-02`、`SEARCH-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 消息正文随 Reader 字号放大，但来源/分类 Tab 与详情、回复操作按钮仍保持小号，130% 档位下层级割裂且可读性下降；根因：两个共享控件虽然读取 Reader font family/theme，却把 11/12/13/15 和 line-height 写成固定值。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-051` 妖火已读复核丢失分类上下文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 从“系统”或“聊天”分类打开消息后，原站已经标为已读，App 仍提示“原站仍显示为未读”；根因：adapter 只把页码塞进 `remoteGroup`，复核时回到默认收件箱，丢失原分类；分类与 cursor 两种来源上下文被压成一个字段。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-052` More 红点没有指向消息入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03`、`MORE-02` |
| 历史症状与根因 | 底部“更多”出现红点，但进入 More 后“消息通知”入口没有任何红点，用户无法判断提示来自消息还是版本更新；根因：`useAppRuntime` 只把未读状态压成中文 summary 传给 `MoreUtilityPanels`，消息入口没有结构化未读字段，也没有渲染视觉标记。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-NOTIFY-053` 主题级通知被强制定位到不存在的具体帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 点击主题提醒、系统通知或只有主题关系的消息时，详情提示“站内消息没有可定位的帖子”或进入主题后提示找不到对应回复；根因：来源 mapper 把所有带主题身份的通知都生成 `topic-post`，详情 loader 因而强制查找具体帖子，route 又把不存在的定位信息传给 Topic。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-054` Discourse 首帖通知被当作回复楼层定位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NAV-03`、`TOPIC-03` |
| 历史症状与根因 | 在消息详情点击“查看相关主题”后，主题正文已正常打开，却额外提示“目标楼层未找到”；现场样本为 linux.do 已读系统消息“LINUX DO 社区抽奖规则”；根因：`NotificationDetailRoute` 复用同一个 `topic-post` target 同时决定详情读取和 Topic 回复定位，把首帖的 post ID 与 post number 1 无条件转换成 `{ commentId, floor: 1 }`；Topic 回复集合不包含 opening post，因此定位必然失败。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-055` 共享回复工具栏回归为两行换行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 富文本输入框上方的格式工具从原有单行横向滑动变成两行，挤占正文与键盘之间的编辑空间；Topic 和私信入口同时受影响；根因：历史通用 ReplyComposer 把 toolbar 从横向容器改为普通换行 View，并把错误布局固化进测试。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-056` NodeSeek 私信把字符串会话 ID 直接作为 receiver UID 发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | App 原生 NodeSeek 私信回复后保留草稿并提示“NodeSeek 请求失败：HTTP 200”；刷新原生会话和 App 内 NodeSeek 原站同一会话都看不到该消息；根因：`src/sources/nodeseek/notifications.ts` 把领域层字符串身份未经 adapter 转换直接泄漏到站点 JSON。旧测试又把字符串 receiver UID 与自造 `{ success: true }` 同时写进 Mock，只证明实现符合自身假设，没有固定真实协议。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-057` NodeSeek 私信把表情码当作普通文字渲染

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-02` |
| 历史症状与根因 | App 原生 NodeSeek 私信会话把 `:ac04:` 原样显示在气泡内；App 内 NodeSeek 原站的同一条消息显示粗体 Markdown 与 AC 娘图片，双方内容语义不一致；根因：NodeSeek 已知表情目录只属于 composer UI，来源 adapter 无法复用；评论的 sticker element model、ExpoImage renderer 和图片尺寸 cache 又封装在 Topic feature 内，导致私信输入归一化与展示分别绕过同一套论坛内容能力。 |
| 当前 owner | `src/sources/nodeseek/markdown.test.ts` |


## `REG-TOPIC-062` 极大回复楼层被当作从首屏开始的连续前缀

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02` |
| 历史症状与根因 | 点击很远的被回复楼层会从当前页逐页追赶，长帖产生请求风暴；即使跳到目标，中间缺失页面也可能被拼成连续列表。关系标签整块点击又会打开用户名片，用户无法单独点楼层。定位到中段后只能向下加载，编辑、删除或新回复还可能按已加载数量刷新错误页面；根因：Controller 把 Infinite Query 页组误认为“从第一页开始的完整前缀”，用 `loadMoreReplies` 反复追目标，并以 `topicReplies.length`、数组下标或扩大 page-size 推断绝对页面；route/parser 又使用零散的 reply Pick 类型并丢失 page/fragment。列表只支持 next cursor，写后刷新复用同一错误推断。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-TOPIC-063` 回复窗口等到重试按钮可见才加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 从锚点窗口向上滚动时，先看到“加载更早回复”按钮，随后才开始请求和前插，操作感觉迟滞；本地倒序又只翻转已加载片段，并不能代表原站完整倒序结果；根因：`TopicContentList` 把网络需求与重试 UI 绑定；旧实现又把 `newest` 混入 `ReplyFilter`，在展示层反转不完整集合。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-067` 倒序只反转已加载片段而非服务端回复流

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 多页主题切换倒序后仍先看到第一页的倒排片段，继续下滚又混入后续正序页；用户误以为看到最新回复，实际既不完整也不连续；根因：`ReplyFilter.newest` 在 UI 对本地数组执行 `reverse()`，回复 Query key 不区分遍历方向；Controller 根据已加载数量猜页，来源 adapter 没有拥有尾窗算法、页内顺序和 cursor 转换。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-068` NodeSeek 真实下一页被旧回复总数否决

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 主题明明存在下一页，窗口到达边缘却报错；同一页面实际已到 `#14`，主题头和“回复列表”仍显示 10，切到倒序又报“回复总数已变化，无法确认最新窗口”。真实样本是 `post-861053-1`；根因：`src/sources/nodeseek/topicParser.ts` 把详情页 `comments[]` 的当前页长度暴露成总回复数，`src/sources/nodeseek/reader.ts` 又拿这个伪总数定位倒序尾页并否决真实相邻页。`src/domain/forum/models.ts` 原先强制每个 Topic 都有 `replyCount`，使来源不知道总数时只能制造数字；`src/sources/nodeseek/protocol.ts` 还没有把 pager 链接与普通内容链接分开。Controller 的刷新计数恢复只能延后症状，不能修复错误事实。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-069` V2EX 独立缓存端点被拼成伪回复窗口错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 活跃主题 `https://www.v2ex.com/t/1232497` 的原站 HTML 已完整包含全部回复，App 却报“回复总数已变化，无法确认完整集合”；正倒序、楼层定位和评论刷新因此都无法使用；根因：`src/sources/v2ex/reader.ts` 把独立缓存端点错误拼成一个快照，并让“能否证明全集”反向否决已经逐条解析成功的评论。完整性属于当前 HTML 页面窗口，不是评论可见性的总闸门；公共 API 只能在首页 HTML 不可用或没有可用回复时作为独立降级，不能补洞或参与投票。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-070` NodeSeek 热门/置顶展示副本污染倒序窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek `post-832584-1` 正序可读，切换倒序却弹出回复窗口错误；最新回复和相邻更早窗口都无法显示；根因：`src/sources/nodeseek/reader.ts` 把 HTML 中所有回复节点都当作当前固定 10 楼窗口的拓扑成员，并在页内投影前按 `limit` 截断。热门/置顶是展示副本，不证明其楼层属于当前页；把它纳入连续楼层校验会误报，把所有页外项都忽略又会掩盖真实错页。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-071` V2EX 超过 100 条回复时只读取第一页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | V2EX `t/1231874` 声明 107 条回复，App 只显示第一页 100 条且没有下一页游标；`#101..#107` 永久不可达，或必须用“刷新评论”一次抓完整帖才能出现；根因：`src/sources/v2ex/reader.ts` 把“页面窗口完整性”和“整帖是否全部载入”混成一个 boolean：第一页有 100 条有效行和明确 `p=2` 时仍被标成无 cursor 的 partial；旧 `getV2exReplies` 又把一次 Reply Query 实现成跨页全集同步。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-072` 妖火删除边缘楼层与新页码字段阻断整个评论区

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 妖火 `bbs-1570569.html` 的主题正文可读，但评论区正序或倒序弹出“妖火未确认目标楼层所在页”或目标楼层缺失错误，已经返回的回复也完全不展示；根因：`src/sources/yaohuo/reader.ts` 一方面只识别旧页码表单，另一方面把用于寻找正序/倒序边缘页的 `tofloor` hint 当成显式楼层 target，要求该楼层实体必须存在。页码证据与实体身份被错误合并成单一硬门禁，导致可解析、由服务器确认的整页回复被丢弃。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-TOPIC-073` Discourse 单条 hydration 竞态阻断整个回复窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do的主题和大部分回复已返回，但批量 hydration 因删帖或读竞态漏回一条，App 仍报“Discourse 回复窗口不完整”并丢弃其他可读回复；根因：`src/sources/discourse/model.ts` 的 hydration 校验把“所有返回实体都属于请求窗口”与“每个请求 ID 必须同次返回”合并成一个硬门禁。前者防止串帖，后者只是对投影时序的过强假设。 |
| 当前 owner | `src/sources/discourse/model.test.ts` |


## `REG-NODESEEK-004` NodeSeek 直连通道卡死只能靠重启 App 恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | NodeSeek 直连连续命中 8 秒，WebView 却能返回；同进程内后续读取继续卡顿，只有关闭重开 App 后恢复；根因：`src/sources/nodeseek/browserFallback.ts` 的直连/WebView 结算边界、`src/platform/network/networkProxy.ts` 的跨来源 generation single-flight 与原生 App 级读取 runtime 轮换；具体是哪一个 Native transport phase 最先污染仍由后续安全诊断证伪。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-008` linux.do 直连长期卡死且检查状态超时

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | linux.do 列表突然无法加载，账号状态检查也长时间超时；关闭重开 App 后恢复；根因：`src/sources/linuxdo/browserFallback.ts` 的直连 watchdog、WebView evidence gate 与 App 级读取 runtime 轮换；Cloudflare challenge 仍是独立且不触发轮换的 fallback 原因。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-009` Connect 会话失效让官方等级退回本机估算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-02` |
| 历史症状与根因 | 同一账号在 App 内手动打开 Connect 官方页或在手机 App 可以看到官方等级进度，但模拟器直接点击“查看等级”偶发只显示“本级估算”；手动看过真实页面后又恢复；根因：`src/sources/linuxdo/level.ts` 在 Connect 直连/解析失败后直接吞错并降级估算，没有调用 `src/sources/linuxdo/browserFallback.ts` 已有隐藏 WebView；手动打开真实页之所以“治好”，是页面导航顺带完成了 SSO 和 Connect Cookie 续签。 |
| 当前 owner | `src/sources/linuxdo/level.test.ts` |


## `REG-PROXY-009` 单站通道恢复误伤其他请求或写操作

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 为恢复 NodeSeek 或 linux.do 读取而全局 `cancelAll` 或替换只有后续 client 才能看到的 pool，会连带取消其他站读取，或显示恢复成功但既有 client 仍复用故障连接；根因：`plugins/withNetworkProxyModule.js` 生成的 App 级 `ReadNetworkRuntimeGeneration`、受控来源/方法识别和旧代 drain；`src/platform/network/networkProxy.ts` 以 `expectedGeneration` 做跨来源 single-flight/CAS。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-010` 兜底显示成功但下一次详情与图片仍卡在旧 Native runtime

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`MORE-02`、`TOPIC-01`、`TOPIC-02`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 阈值为 1 且 WebView fallback 已成功，下一次详情仍长期 Loading，正文图片也约 40 秒不显示；只有结束进程再进入才立即恢复；根因：OkHttp cancel/release 不是同步边界，旧实现在 release 前清池，且只清 forum pool；Dispatcher、两个 pool、ProxySelector wrapper、Glide client 与 Cronet generation 都未真实替换，JS 的 generation 只是计数。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-012` V2EX 或妖火当前读取超时后持续卡住

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`MORE-01`、`MORE-02`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | V2EX 或妖火的当前列表、搜索、帖子、回复或用户读取偶发一直转圈或报请求失败；完全退出 App 后重新进入却立即成功，说明故障可能留在进程内的 Native 读取 runtime，而不是该页面数据永久不可用；根因：`fetchWithTimeout` 过去只抛同文案的普通 `Error`，`ReadGateway` 无法把“请求自身达到 deadline”与 HTTP、解析、登录、调用方取消区分；NodeSeek/linux.do 只有 parser-proof fallback 路径会调用 `recoverReadNetworkRuntime`，另外两站即使命中同一进程级故障也只把错误交回页面，App 重启才间接换掉 runtime。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-PROXY-013` App 后台不暂停共享请求 deadline

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 页面请求进入后台一段时间后，回到 App 仍继续 Loading；它要再等待一轮剩余的 8/15 秒预算，之后既有 fallback 或读取 runtime 恢复才会生效；根因：`src/platform/network/request.ts` 用全局 active flag、listener 和剩余预算重算暂停 timeout；`src/app/useAppLifecycleRuntime.ts` 又把 AppState 接入该状态，使 React Native Android 已保留的绝对 Timer deadline 被应用层改写。 |
| 当前 owner | `tests/ui/app/app-lifecycle-request-timeout.test.tsx` |


## `REG-FEED-014` 一个慢来源拖住聚合首页与分类

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首页“全部”或分类一直 Loading，实际只有一个站不结算，其他站已可用；根因：`src/sources/readAggregation.ts` 复用 `withAbortableTimeout` 的 `AGGREGATE_SOURCE_BUDGET_MS`，并拥有 Feed child 的 typed timeout/cancel 与 cursor 结算。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-FEED-015` 在途首页请求让手动刷新失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 列表请求卡住后下拉刷新只提示“列表正在更新”，无法替换旧请求；关闭重开 App 才恢复；根因：`src/features/feed/useFeedController.ts` 的手动刷新所有权，以 TanStack Query exact cancel + `refetch({ cancelRefetch: true })` 替换在途请求。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-016` 首页来源 Tab 在 100% 下过高过宽

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04`、`MORE-03` |
| 历史症状与根因 | v1.3.95 后首页“全部 + 四站”一级 Tab 在 100% 字号下比二级导航大很多，每项过宽；130% 字号缩放本身仍应保留；根因：`src/ui/controls/SelectionControls.tsx` 的共享 Tab 样式与 `compactTabs` 局部 override；`src/features/feed/FeedScreen.tsx` 只为顶部来源栏启用。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-TOPIC-064` 论坛图片遭遇 Cloudflare Challenge 后原生详情无法显示

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | NodeSeek `post-857589-1` 的 `im.legend.moe` 1028×937 WebP 在原站 WebView 正常显示，原生详情只显示灰色占位。Expo Image 的 OkHttp 响应为 `403 + Cf-Mitigated: challenge`；复制完整浏览器头仍是 challenge，而匿名 WebView 与 Cronet 均能取得图片；根因：`src/platform/media/imageRequestSource.ts` 的通用请求画像只负责 Accept、UA、语言、内部来源和 identity；`Referer` 由 `REG-TOPIC-078` 的文档/元素契约独立决定。传输恢复 seam 是 `plugins/withNetworkProxyModule.js` 生成的 Expo Image/SVG 专用 client。把补请求头或补图床 Host 当成浏览器等价无法解决网络栈指纹差异。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-065` NodeSeek 透明动态贴纸出现黑底并在前后台切换时重载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek `post-859086-2#14` 的三个动态贴纸在原站为透明动画，原生详情中前两个出现黑色方块；App 切到后台再回来时贴纸重新加载；根因：NodeSeek HTML 的 `video.sticker` 归一化 → `FORUM_VIDEO_STICKER_TAG` → `src/features/topic/rendering/contentMediaRenderers.tsx` 的透明媒体承载与 App 可见性生命周期。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-066` 同一贴纸目录的不同图片被统一压成小尺寸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 同一楼层中的 `xhj/003.png` 与 `xhj/015.gif` 在原站分别按约 `57×48`、`82×82` 显示，App 却把两张都压成约 `48×48`；只有一个 HTML 尺寸轴时还会被画成正方形，阅读字号放大后又可能突破 100dp。过往按素材或目录修补后仍会在新贴纸上复发；根因：`src/domain/forum/forumContentMedia.ts` 的混合段落分流 → `src/platform/media/inlineMedia.ts` 的占位尺寸推导 → `src/features/topic/rendering/htmlElementModels.ts` 的 block/textual content model → `src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Image `onLoad` → 已有 session-aware 有界自然尺寸缓存。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-PERF-010` 海量正文图片把内容总量线性转换成 App 运行时工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 的正文请求先成功，但 1413 张图片集中在一个顶层 `<p>` 内；App 随后长时间失去响应、图片不显示，返回也卡顿，约 30 秒后出现 1390+ 个同步取消和多条 `ResponseBody` 泄漏，严重时进程卡死或退出。同进程后续详情的响应性也会被残留工作拖累；本条不把该现象归因为 `ReadNetworkRuntimeGeneration` 污染；根因：`src/domain/forum/topicContentSplit.ts` 的唯一公开 `compileForumContent()` 是不可信 HTML 到有界 typed UI rows 的编译边界；poll/quote 提升、视频分类、HTML 分片和 semantic continuation 都藏在该深 module 内，model/renderer 不再拥有第二套 DOM 规则。compiler 只产出 disclosure 的初始值，route-scoped `TopicSplitDisclosureStore` 唯一持有展开状态并在父 FlashList 前过滤 body rows，header renderer 不持有第二份状态或正文。`src/features/topic/media/TopicBodyMediaCoordinator.tsx` 是 Topic 正文媒体许可、timeout、retry 与 runtime-generation restart 的唯一 owner；`src/ui/media/ImagePreviewModal.tsx` 独立拥有预览 physical window，生成的 `CloseSafeGlideStreamFetcher` 拥有 Native body。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-074` Glide 取消竞态泄漏 ResponseBody

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 海量正文退出或媒体 permit 被撤销后，log 出现多条 “A connection ... was leaked” 警告；在另一种回调顺序下，图片流也可能在 Glide 消费前被过早关闭。长帖的一次批量取消会放大泄漏并拖累后续详情；根因：`plugins/withNetworkProxyModule.js` 生成的 `CloseSafeGlideStreamFetcher` 统一拥有 call/body 状态；`CloseSafeGlideUrlLoader` 与 `CloseSafeGlideUrlWrapperLoader` 必须同时在 App Glide registry 覆盖对应 model，wrapper 继续包装读取进度。依赖升级不能替代本项目的明确资源所有权。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-TOPIC-075` 全屏原图翻页把已访问图片累积成 decoded Bitmap 工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-03` |
| 历史症状与根因 | 海量图片帖的正文已经可以滚动，但进入全屏预览并快速切过多张图片后，Native Heap/PSS 持续增长；关闭预览、返回 Feed 60 秒后仍不回落。极大原图还可能单张占用数百 MiB，使 App 再次卡顿或被系统杀死；根因：`ImagePreviewModal` 拥有稳定的三个 physical slots，slot identity 不随 logical index 增删；`PreviewPageLoadLayer` 在每个 slot 内复用稳定 raster/underlay Native owner，以 `source/recyclingKey` 替换资源并统一拥有全屏 raster、连续显示 underlay、静态 SVG poster 和动画 continuity poster 的 decoded-resource policy；`src/platform/media/previewBitmapBudget.ts` 只把 viewport/DPR 转成固定 Native decode target。不得在关闭预览时调用全局 `Image.clearMemoryCache()` 误伤 App 其他健康图片。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-112` 全屏已下载原图仍按 2048px Bitmap 放大，长图当前视口模糊

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片在原站和原始 URL 上清晰，App 也已下载原图，但点进全屏后仍模糊；长图在适屏和深度放大时尤其明显，用户无法看到原图细节；根因：`ImagePreviewModal.PreviewPage.active` 是唯一高清所有权；基础原图 `onDisplay` 后由 Expo Image `getCachePathAsync(cacheKey)` 只读同一 Glide 磁盘文件，`ResumableZoom.getVisibleRect()/getState().scale` 只在静止点产出 viewport，`PreviewRegionImage` Native View 用 `BitmapRegionDecoder` 解码该区域并把 upright 尺寸回传给同一 resolution owner。三槽基础 owner、正文 `TopicBodyMediaCoordinator` 和网络链路不参与高清调度。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-076` V2EX 完整性不确定时清空可信评论或进入后台轮询

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 直达 `https://www.v2ex.com/t/1232881` 时首次出现整页“窗口错误”；重复进入数次后又能完整加载。故障期间主题正文和第一页已经解析成功的评论也全部不可见，旧修复还会在后台反复读取；根因：adapter 把集合完整性和单行可信性合成一个失败边界，Controller 又把来源不确定性扩成 typed error、timer 和重试状态；一个不可信节点或计数因此同时清空可信行并制造后台请求。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-DATA-007` 内容源设置未读到就按全关处理或永久阻塞启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03`、`NAV-01`、`MORE-05`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`ACCOUNT-01`、`NOTIFY-03` |
| 历史症状与根因 | 首次或冷启动先看到所有来源消失、搜索显示“未启用/暂停”，甚至一直停在启动页；同时已经存在的收藏、历史或关注可能被空设置覆盖；根因：`src/platform/storage/readerDataStore.ts` 的双 key 读取、`src/app/useReaderRuntime.ts` 的启动结算和 `src/domain/reader/contentSourcePreferences.ts` 的默认投影没有共同区分“配置缺失可默认”与“ReaderData 损坏需恢复”。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts` |


## `REG-PROXY-011` 代理初始化冻结本地页面或失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`NAV-01`、`LIBRARY-01`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-04` |
| 历史症状与根因 | SecureStore 或原生代理初始化稍慢时，App 白屏/启动页停留数秒甚至卡死，收藏和更多等本地页面也进不去；另一种修补会在配置读取超时或 runtime 卸载后放行直连，泄露本应经代理的请求；根因：`src/app/useAppRuntime.tsx` 的 route readiness、`src/platform/network/useNetworkProxyRuntime.ts` 的 SecureStore owner/load/apply queue，以及 `networkProxyFetcher`/WebView 的请求前 readiness 没有分离本地导航可用性与网络安全性。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-SOURCE-011` 账号未知被当成整站不可用并锁死公开读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-05`、`NAV-02`、`WRITE-01` |
| 历史症状与根因 | App 启动或账号检查暂时失败后，公开可读的 Feed/Search/Topic/User 全部显示“账号状态未知/暂停”，任一来源核对 activity 还能让“全部”永久 Loading；反向降级时，妖火或私有操作又可能被误走匿名 transport；根因：`src/domain/forum/readPlan.ts`、`src/sources/readGateway.ts`、聚合 child fetcher 与 Feed/Search/Topic/User Query key 是同一个 operation capability seam；账号事实不应拥有来源静态能力。 |
| 当前 owner | `src/domain/forum/readPlan.test.ts` |


## `REG-SOURCE-012` 旧详情的“管理内容源”只进入 More、面板仍折叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`TOPIC-01`、`USER-01`、`NOTIFY-02`、`NAV-01`、`NAV-02` |
| 历史症状与根因 | 从已停用的 Topic、User 或旧 NotificationDetail 点击“管理内容源”后虽然返回 More，内容源面板仍折叠，用户还要再次寻找并展开入口；根因：所有内容源管理入口 → `MainTabs.more` route params → `MoreRoute` → `ContentSourcesPanel` 的导航意图边界。 |
| 当前 owner | `tests/ui/app/content-source-navigation.test.tsx` |


## `REG-SEARCH-024` 首次进入搜索被账号提示占据且来源不能独立结算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 用户尚未输入关键词时就看到“账号状态未知/暂停搜索”；提交后一个站没有确认身份会让整页一直忙碌，公开来源结果也不出现；根因：`src/features/search/useSearchController.ts` 的提交快照/逐来源 `useQueries`、`SearchScreen` 的 idle/blocked presentation 和 `forumQueryKeys.search` 的 ReadPlan scope。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-025` 页面级账号状态重复来源级搜索结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 一个站点需要登录或核对时，搜索页头先显示整页账号状态条，结果组又显示同一提示，用户会误以为整个搜索被暂停；根因：`SearchScreen` 页头状态条与 `SearchGroup.authNotice` 重复拥有同一个来源操作状态。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-026` 搜索筛选收起键盘后弹层持续上跳

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03`、`ACCOUNT-05`、`MORE-01` |
| 历史症状与根因 | Android 搜索筛选中点开 V2EX 节点或 Discourse 标签、分类、作者输入，收起键盘后弹层仍向上偏移；已复现关闭按钮从 y=1327 移到 y=1128，连续操作可能重复出现；根因：`src/ui/controls/ModalSheetFrame.tsx` 对 Android 键盘可见状态与高度避让的统一 ownership。 |
| 当前 owner | `tests/ui/shared/modal-sheet-frame.test.tsx` |


## `REG-SEARCH-027` 聚合搜索结算后进入 V2EX 导致 App 退出

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | “全部”搜索完成后点击 V2EX，App 立即退出到系统桌面；Release 日志为 JS `TypeError: Cannot read property 'length' of undefined`，栈位于 TanStack Infinite Query 的 `hasNextPage/getNextPageParam`；根因：`src/platform/query/serverState.ts` 的 Search Query key 数据形状身份，以及 `src/features/search/useSearchController.ts` 对聚合预览和单站分页的 key 选择。响应形状不同却缺少 lane，违反同一 Query key 只对应一种数据形状的约束。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-ACCOUNT-041` 账号刷新覆盖可信身份、重复 owner 或 unknown 被计为已登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-05`、`FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`WRITE-01`、`NOTIFY-01` |
| 历史症状与根因 | 更多页刷新账号时，已确认账号立即变成“待核对”，Feed/Search/通知换 lane；快速点两次又产生重复探测。网络、403、429 或 CF 后旧身份可能被永久降级，账号计数和私有入口闪动；根因：`useAccountStatusController` 没有把核对 activity (`isVerifying`) 与 canonical identity 分开，也没有按来源 single-flight。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-ACCOUNT-042` L 站验证成功后账号状态未自动同步

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`NOTIFY-01` |
| 历史症状与根因 | linux.do Cloudflare 验证通过并点击检查后面板退出，但账号中心与写权限仍显示旧状态；只有再点一次“刷新账号”才同步；根因：稳定 Account key、`AccountSessionSnapshot` 唯一提交 seam、内容 epoch reset 与 `useVerificationController` 的成功/原页面恢复顺序。旧实现实际同时拥有 Query observation、workflow session 与 identity runtime 三份账号事实。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-TOPIC-077` 回复数或稀疏窗口不一致时整窗被丢弃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03`、`WRITE-01`、`WRITE-02`、`NOTIFY-02` |
| 历史症状与根因 | 原站回复数、页宽或返回行稍有不一致时，已经解析出的有效评论整块消失，详情显示空白/窗口错误；刷新又可能恢复。另一种路径把 partial Topic seed 当成 complete，错误开放权威计数、倒序或末尾确认；根因：`ReplyCompleteness`、各来源 reply-window validator、共享 page 投影、Topic target replacement 与写后精确 refresh target 共同定义完整性和身份；exact target/写后实体读取和普通浏览窗口需要不同严格度。 |
| 当前 owner | `src/features/topic/model/replyPagination.test.ts` |


## `REG-TOPIC-078` Topic 媒体首跳忽略页面 Referrer Policy

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 妖火指定主题的外部图片与视频在原站可用，App 却因额外发送论坛来源而收到 403；V2EX、NodeSeek、linux.do的正文、预览或保存又可能使用与原页面不同的 Referer。随机素材偶尔返回 200 不能证明 Header 契约正确；根因：四站 Topic adapter 产出的 `MediaReferrerContext` → Sanitizer 的元素策略保留 → `imageRequestSource` 的标准 policy resolver → 正文、原图升级、全屏预览、保存、贴纸、卡片和视频消费者；`contentSource` 只保留身份、Cookie 和重定向隔离职责。 |
| 当前 owner | `src/domain/forum/mediaReferrer.test.ts` |


## `REG-TOPIC-079` Expo Video 重建或卸载释放竞态导致原生崩溃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 正文视频请求失败或超时后，App 立即自动创建第二个 Expo player；正在播放时离开 Topic，组件卸载清理又访问已由 Expo 释放的 player。两条路径均可触发 Android Fatal 或进程退出；根因：`TopicBodyMediaCoordinator` 的 per-lease retry policy → `ManagedTopicContentVideo` admission/identity → `ForumContentVideo` runtime lease、初始化与 Expo 独占的 shared-object 释放生命周期。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-080` 原生正文视频忽略固有比例

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 妖火 `bbs-1571173.html?lpage=11` 的原视频为 `576×1024`，原站按竖屏显示，App 却固定放进 `16:9` 横屏框；根因：`ForumContentVideo` 对 Expo player 元数据的订阅与 frame `aspectRatio`；coordinator 只负责 admission/retry，不能决定媒体形状。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-081` Topic 虚拟化 row 泄漏文章边界与妖火原站结构

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 妖火附件帖被拆成多段卡片，每段重复横线和顶部留白；连续 `<br>`、隐藏占位节点变成异常空洞，原站附件 class 直接泄漏到 App 后呈现松散或不可操作；根因：`contentSanitizer` 的隐藏节点删除 → 妖火 Topic adapter 的语义归一化 → `topicContentSplit/topicOpeningPresentation` → `TopicContentList` article continuation → 共享 HTML styles。 |
| 当前 owner | `src/domain/forum/contentSanitizer.test.ts` |


## `REG-TOPIC-082` 原生正文视频丢失封面并在加载期黑屏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 原帖已有真实视频封面，App 在加载和待播放阶段却只显示纯色底或视频首帧；播放按钮笨重，暂停后还可能错误恢复封面；根因：`contentSanitizer` → `topicContentSplit` → `topicOpeningPresentation/TopicContentList` 与 HTML renderer → `ManagedTopicContentVideo` 的独立图片 lease → `ForumContentVideo` 的首次播放状态。 |
| 当前 owner | `src/domain/forum/contentSanitizer.test.ts` |


## `REG-TOPIC-083` V2EX 把 100 条单页误作无游标的评论全集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | V2EX `t/1233404` 当次声明 147 条，原站第一页为 `#1..#100`、第二页为 `#101..#147`；App 普通打开正文可见但评论永久停在 `#100`，只有手动“刷新评论”后才能看到 `#147`。即使后页存在单条无效评论，也不应把其余成功解析行一并退回 100 条；根因：`src/sources/v2ex/reader.ts` 把页面窗口与整帖全集混成同一结果；`getV2exReplies(start)` 还会遍历所有链接页并合并全集。`src/features/topic/useTopicController.ts` 随后围绕这一错误模型增加 V2EX-only 完整集合判定、刷新和定位分支。正确 seam 是现有通用 Reply window：Topic 提供 page 1 seed，明确 cursor 驱动相邻页，order/target 各自建立窗口。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-084` 固定单元格宽度与虚拟分片破坏逻辑表语义

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-652056-1` 的两张小表没有清晰间距且第二张不能自然铺满正文；V2EX `t/1233470` 的“时间 / 发生的事”长表跨虚拟 row 后列宽、边框和横向位置可能突变，像多张断开的表；根因：`compileForumContent()` 在 budget packing 前建立完整 typed table、列模型与 rowspan 连通区域 → `topicTableRenderers` 的原生列几何、边框、间距和 route-local 横向 offset；父 FlashList 只负责回收 typed row，不能成为表语义 owner。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-085` 图片实体与回收占位几何不一致导致虚拟边界行高振荡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 的长图滚到虚拟窗口边缘后反复闪现；附近文字、空白占位和相邻回复交替出现，即使滚动偏移未变化也无法 settle；根因：`TopicBodyMediaCoordinator` 只拥有未完成加载调度；`previewRenderers` 分开维护 displayed 状态、稳定视觉 identity、网络 attempt、有效自然尺寸与 `imageDisplayDimensions` 512 项缓存；FlashList 只在 cell 真正复用给新媒体 identity 时清旧状态。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-086` 物理 Row 切割丢失嵌套逻辑节点身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 第 9 层原站的一个 52 行 `<pre>` 在 App 内变成两个独立横向滚动框；相同问题可让跨 row 的 table、details、callout 或 list 丢失边框、折叠状态、祖先容器和横向位置；根因：`compileForumContent()` 的顺序必须是 `semantic blocks → budget packing`：table、block pre/code、details/callout、blockquote 与 list 在物理切片前成为 typed payload；每个 row 直接携带 scope-local DOM path 产生的 `semanticId`、segment/part 和完整 `ancestorFrames`。renderer 只消费 typed row，不读取 HTML binding、TNode 或站点/坐标推断。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-087` 虚拟回复把 ReplyTarget 移到正文之后

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 第 9 层的“回复 @… · #5”在 App 中出现在长代码正文下方，而原站和未切割回复都把回复关系放在正文之前；根因：`ReplyItem` 的统一 Header/ReplyTarget/Body/Tail 组合顺序，以及 `replyListModel` 对 start/body/end 物理 rows 的职责划分；物理 row 不能重新定义回复文档顺序。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-088` 局部连续性测试通过但真实 FlashList 链路仍丢失语义身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | compiler sidecar 与独立 renderer 测试均通过后，真实 APK 中 linux.do `t/topic/2556285` 第 9 层的 52 行代码仍显示成两个完整圆角框；这证明局部补丁没有贯穿 TopicContentList 和 FlashList recycling；根因：唯一允许的链路是 `compileForumContent → topic/reply model → TopicContentList → FlashList → ReplyItem → TopicContentBlock`。完整 `CompiledForumContentRow` 必须逐层传递；key 使用 owner scope、semantic id 与 segment，view type 包含 payload kind，attempt/viewability 不参与语义身份。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-089` 普通代码块在 semantic compiler 前被降级为 terminal rich text

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | typed compiler、模型和 renderer 测试均通过后，linux.do `t/topic/2556285` 第 9 层在真实 APK 中仍显示为两个独立圆角代码框；根因：sanitizer 与 semantic compiler 的职责边界。普通 block pre/code 必须保持 DOM 语义直到 `compileForumContent()` 分类；只有明确的 ANSI code、NodeSeek magic tabs 与 terminal report 才进入 terminal 专用转换。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-090` 超预算 terminal report 被整块删除并丢失 Tab/复制/滚动语义

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 测评详情原有多个 Tab、ANSI 报告、复制按钮、文本选择、横向滚动条和图片内容；引入正文虚拟化后，小样本可能显示为单个 RNRH terminal，但 report 一旦超过 row 预算就整块变成“内容过于复杂”，Tab 与全部正文同时消失。把普通代码统一降级为 terminal 或恢复巨型 `<pre>` 又会破坏既有 table/code/媒体预算优化；根因：`compileForumContent()` 的 terminal 语义分类、`CompiledForumContentRow`/`ancestorFrames`、Topic list 的 route-scoped semantic state，以及共享原生 CodeFrame。report header、tab body 和 code/table/media 等内容必须先成为 typed semantic rows，再应用既有物理 row 预算。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-091` terminal Tab 切回后长图 row 永久停在 idle

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 测评页长图 Tab 首次可以显示；切到 code Tab 再切回后，原位置只剩保持正确长图高度的灰色空白，占位节点为 `topic-image-idle`，等待或再次切换也不发起图片加载。当前最终 APK 的同一真实页面还证明，在已有旧 Tab viewability 的情况下首次切入长图也可能直接 idle；根因：`TopicContentList` 从 FlashList viewability 投影到 `TopicBodyMediaCoordinatorProvider.viewportRowKeys` 的边界只保存 row key，没有保存这个有界窗口在当前 data 中的位置；semantic filtering 改变 data 后无法把同一视口重投影到新 Tab rows。图片 renderer、请求 identity、网络和解码尚未获得 permit，不是根因。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-092` 同一回复关系目标再次点击不再定位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 回复关系第一次点击可以跳到目标楼层；滚走后再次点击同一目标，有时完全不滚动也不重新高亮。切换到另一个目标后再点原目标也可能失效；根因：稳定目标身份与一次性命令身份必须跨真实入口分开：同主题 HTML 楼层链接由 `TopicRoute` 递增 route-local `targetReplyRequestId`，结构化回复关系由 `TopicContentList` 的稳定 ref 生成本地 request command；列表统一消费二者。 |
| 当前 owner | `tests/ui/app/content-source-route-gates.test.tsx` |


## `REG-TOPIC-093` 物理预算从内部切坏不可分割语义 owner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 长代码或连续富文本超过旧 node/字符预算后被拆成多个独立 cell，出现多重代码框、多个复制入口、边框断裂和上下文断开；图片密集正文又确实需要物理分段；根因：`compileForumContent()` 的 semantic owner 分类必须先于 budget packing：预算只能决定可离散内容的调度粒度，不能创造新的代码或连续文本 owner。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-094` 嵌套 code/table 横滑被外层纵向列表抢走

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 代码或表格区域慢速左右拖动几乎不动，必须多次尝试才偶尔识别；若直接让内层 ScrollView 抢手势，纵向阅读又会卡住；根因：code/table 必须复用一个 RNGH Pan 方向仲裁器；被动 `Animated.ScrollView` 只负责裁剪、内容宽度和命令式 offset，不再拥有原生拖动手势。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-097` 代码慢横拖被 Android 原生文本选择抢占

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek terminal Tab 内左右拖动长代码时，慢拖很容易先出现文本放大镜、选择 handles 与 `Copy / Share / Select all / Translate` 菜单；代码没有横向移动，随后 Back 也只关闭选择菜单而不返回页面。快速横拖通常正常；根因：`TopicHorizontalScroll` 必须在 UI thread 内成为 code/table 唯一方向仲裁者；文本选择只能在手势仍未决且近似静止时保持资格，外层 FlashList 只在纵向意图时接管。Tab、Text、ScrollView 与 React state 不得各自建立第二套所有权。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-098` 横滑已接管但 Android selectable Text 未收到取消事件

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | `REG-TOPIC-097` 后在 NodeSeek terminal code 空白处慢横拖，代码已经横向移动，仍会出现放大镜、选择 handles 或 ActionMode；说明 JS Pan 获胜并未终止 Android selectable Text 的原生长按链路；根因：`TopicHorizontalScroll` 必须同时拥有横纵方向仲裁与后代原生触摸取消边界。内容树挂在直接、不可折叠的 `Gesture.Native()` owner 下，横向 Pan 通过 `blocksExternalGesture()` 声明优先关系；Pan 激活取消 Native handler，由 RNGH 2.28 的 `NativeViewGestureHandler` 向 wrapper 子树派发 Android `ACTION_CANCEL`。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-100` 未切割正文仍无法把选择范围拖入表格

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-877083-1` 长按表格前正文后，“全选”只选中当前段落；选择手柄不能越过“配置”标题继续进入表格和表后文字；根因：compiler 的语义/调度 row 与 Android 原生选择 owner 被错误等同。React Native `selectable` 只作用于各自 `TextView`，table 又是独立 View 树，因此逐块 selectable 不能形成文档级连续选择。后续 `post-652056-1` 又因 route 把回复注册进 coordinator，让无关回复的 span 映射失败阻断主楼。边界收窄后仍把 logical tape 当成 Native tree schema：协调器用 `isTextSelectable`、`isLaidOut`、owner/fingerprint 和全 mounted window 完整匹配决定是否允许选择；RN/Fabric 的 sticky `requestLayout`、回收和 layout commit 瞬态都会因此误取消整个 document。selection 身份的根因 seam 是当前实际显示的 opening row 根 marker 才是唯一身份，manifest 直接来自同一 visible opening collection；`selectionToken` 只保存逻辑 copy tape，`TextView.Layout` 只服务当前端点和可见投影，瞬态映射缺失只跳过当前帧而不取消逻辑选区。回复、评论和已采纳答案保持零 marker，并独立整条长按复制。同一链路还暴露 opening renderer 仍为 selectable 时双击会进入原生局部选区、active selection 没有普通短按取消转移；中间的 row-wide double-tap detector 虽能吞第二次 `DOWN`，也会误吞同 row 链接的正常 tap，因此最终删除 detector 与 `TextView` long-click patch，统一设置 opening renderer `selectable=false`，只由自定义 selector 接管静止长按。活动选区上的普通短按先完成既有点击再取消，越过 touch slop 的滚动保持选区。随后逐帧证据确认 route-surface 中央高亮仍是错误绘制 owner：高亮 Path 被转换为祖先坐标并缓存进 surface RenderNode，而文字可随内部 ScrollView/child RenderNode 独立移动，出现峰值 `156px`、持续约 `590–720ms` 的错位；增加 scroll/pre-draw 刷新只能追赶时序，不能修复 owner。把高亮迁到 `TextView.overlay` 后，真实录屏的 1,294 个实测样本达到 `<=2px`，但尝试用独立 `PopupWindow` 承载手柄又引入第二个 ViewRoot 时钟：完整可见的起点/终点手柄分别出现 `279px`/`278px` 峰值并有可见端点缺手柄，故该路线按 falsifier 删除。最终绘制 owner 是每个 mounted `TextView.overlay`：可见 slice 用本地 `Layout.getSelectionPath()`，两个端点各持一个本地 handle drawable；route 只保存逻辑状态、ActionMode 和触摸命中点。caret hotspot 不移动，边界处仅把圆形收回 View 内并用 stem 连回热点；滚动不再重建第二套视觉坐标。第一版本地手柄仍把 viewport 裁剪错误地当成 drawable 生命周期：端点离屏时先移除 overlay，RenderThread 让 child 回流后只能等下一次 UI pre-draw 重绑；`post-832584-1` 的 204 帧严格审计因此在 f49、f159 各捕获一次可见起点整帧缺柄。修复将本地投影与 route 命中可见性解耦：owner 仍 mounted 时保留 drawable 并交给祖先裁剪，只有真实卸载/回收重绑、取消或 revision 失效才移除；instrumentation 先以该行为红灯，再达到 18/18。修复后同帖一次 900ms 静止长按、大选区和三轮快速往返的 181 帧审计中，三次起点回流首个完整可见帧 f46/f75/f134 均已有 circle、stem 与 hotspot；高亮 1,301、起点 83、终点 98 个可判定样本的最大 `L∞` 均为 `2px`，真实缺失和确认的 `>2px` 均为 0。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx`、`tests/ui/topic/topic-components.test.tsx`、`npm run test:native:forum-selection`、独立 AVD 的 `npm run test:instrumented:forum-selection` 与 `docs/operator-runbook.md` 主楼选择 targeted Live |
| 失败 oracle | 自动 owner 必须以普通行为用例证明 visible opening collection 直接生成唯一 manifest 和 row markers、opening renderer 全部 `selectable=false`，主楼 document 跨 rich text/table/code/media 连续复制，回复、评论和已采纳答案零 marker、整条长按复制不退化；Native oracle 必须证明 selection 不依赖 `isTextSelectable`、`isLaidOut` 或全 mounted window 完整匹配，瞬态映射缺失只跳过当前帧并在稳定帧恢复，且不存在 row-wide double-tap detector/long-click patch 吞普通链接 tap。主要绘制时序 proof 必须用生产等价 `ScrollView + absolute cells` 在 pre-draw 后同一次 draw 内正反向改变 offset，以截图像素证明 TextView-local 高亮和手柄 hotspot 相对当前文字 Path/caret 误差各自 `<=2px`、旧位置残影 `<=2` 个差异像素、取消/回收重绑后旧 drawable 清空且布局几何不变；端点 owner 仍 mounted 但离屏时，本地手柄必须保持绑定、route 命中点必须隐藏，并在无需下一次 pre-draw 的回流首帧随文字出现。RecyclerView proof 只辅助固定 recycle/rebind 后的逻辑选区、复制顺序与本地投影恢复。新构建还必须按 runbook 完成静止长按唯一入口、双击无选区、活动选区上静止短按取消而滚动保留、`post-832584-1` 大选区三轮快速往返的逐帧高亮/手柄贴合、`post-877083-1` 主楼复制顺序、`post-863650-1` 回收/预算/PSS/`0px` 位移及回复/评论/采纳答案负向 marker 的全部 Live 分支。任一分支未取得 `LIVE_PASS` 时仍保持 `OPEN`；局部 UI/native green 不计 `RESOLVED`。 |


## `REG-TOPIC-095` 三槽图片预览翻页闪回错误图片且 pinch 误改 index

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 多图预览横滑到下一张时，目标图片已经到达中心却又瞬间闪成后一张或原图，随后再回到正确页；pinch、横向不对称 pinch 或单指拖动途中加入第二指时还可能意外翻页；根因：`src/ui/media/ImagePreviewModal.tsx` 同时拥有可见 slot 身份、分页状态权威、转场结算顺序与 ResumableZoom/分页/下拉关闭的手势所有权；这四者不能再分散到 Native Pager position、React index 和异步 scrollEnabled。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-096` 千图帖子首次点击预览需等待约三秒

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 已显示正文首图后，首次点击仍需约 3 秒才出现全屏 chrome；关闭后热重开仍约 2 秒。图片 decode 只占约 100–200ms，页面期间无反馈，千图正文时尤为明显；根因：图片发现只归 `compileForumContent()` 的单次 DOM 遍历；Lightbox/controller 只能消费 Topic presentation 已产出的结构化 descriptors 和 ready catalog。preview 不拥有业务文档、HTML parser、全文标记器或后台预热任务。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-ACCOUNT-043` 后台 More 重渲染关闭全局登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 在 Topic、Feed、Search 或 User 中自然触发 linux.do Cloudflare 验证后，面板刚出现就消失并回落到“账号冻结中”；用户只能去 More 手动打开验证。NodeImage 等其他全局授权面板也可能被同一路径提前关闭；根因：`src/features/more/MoreRoute.tsx` 把“More 当前 inactive”误当成“More 刚从 focused 变为 blurred”，让后台 route 拥有了全局 auth surface 的关闭权。 |
| 当前 owner | `tests/ui/app/content-source-route-gates.test.tsx` |


## `REG-ACCOUNT-044` 账号检测误用首页五秒预算并读取完整妖火活动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`SEARCH-04`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已登录妖火且代理正常时，“检测登录”仍会在约 5 秒提示超时；偶尔成功时延迟和请求数也明显波动。更多页三站刷新、登录页关闭核对、Search 重试、写前核对和 NodeImage 核对共享同一风险；根因：`src/features/account/useAccountStatusController.ts` 把正常 `reconcileAccountStatus` 包进 `readWithinAggregateSourceBudget`；`src/sources/yaohuo/accountStatus.ts` 又把“证明当前身份”和“读取完整用户活动”合成一次操作。Feed 公平预算、账号协议终态和 User 页面数据具有不同所有权。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-045` 功能 WebView 挂载清空全站登录态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-05`、`RELEASE-02` |
| 历史症状与根因 | 进入 linux.do 或 NodeSeek 详情、打开回复器，或覆盖安装/重启后，三个站点会突然全部退出；账号中心仍可能显示持久化的“网站登录 3/3”，但该快照不能证明 WebView Cookie 仍存在；根因：功能私有编辑器获得了修改 App 全局 WebView profile 的能力，资源所有权从 Account Runtime 逃逸；既有规则只约束显式账号清理事务，没有检查第三方 WebView 属性、生产 TypeScript 清理调用和 tracked Android plugin。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-FEED-017` 来源重排后旧 Pager 会话卡在 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`MORE-05` |
| 历史症状与根因 | 在 More 重排来源后返回首页，顶部仍像是原来源，但内容区一直显示“正在读取主题”；再切一次来源才恢复；根因：PagerView 的页面适配是位置语义，而来源顺序是可变的；在同一 Feed 会话内热更新 children 后，旧数字位置不能稳定表示来源身份。inactive scene 又只允许 controller 当前来源渲染真实列表，因此错位物理页会永久显示 Loading。 |
| 当前 owner | `tests/ui/app/content-source-navigation.test.tsx` |


## `REG-FEED-018` 未登录妖火关闭登录页后无限重开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04`、`SEARCH-02`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 未登录用户在首页选择妖火后会打开登录页；点击“关闭”后同一个登录页立即再次出现，继续关闭仍会无限循环。搜索页的妖火单站搜索存在相同问题；根因：Feed 仅按 `Error` 对象身份、Search 仅按 `RemoteSearchSourceResult` 对象身份消费登录 action；ReadPlan scope 切换和 refetch 会创建新对象，使同一用户意图被误判为新动作。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-PERF-011` 内容源拖动逐帧跨入 JS 导致不跟手

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 长按来源排序后上下移动明显滞后，快速跨过多行时活动行跟不上手指；根因：`src/features/more/components/ContentSourcesPanel.tsx` 的活动行位移、边界限制和最近槽计算属于 UI-thread 动画，却被放在 JS gesture callback 中。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-PERF-012` 内容源拖动抬手时回弹或闪空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 来源已经拖到目标槽，抬手时却短暂弹回旧槽，出现行重叠、空白或整块闪动；即使缺行消失，相邻两个名字仍会在放下后的连续帧补换一次位置；根因：`Source` 是不会在一次拖动中改变的 native 内容身份，index 只是实测列表中的视觉槽位。host 和内容应归 `Source`，视觉位置由当前/预览顺序映射到槽位；不能让 source host 随数组重排，也不能让 index host 在提交时更换来源内容。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-001` More 展开面板停住后点击无反应

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02`、`MORE-03`、`MORE-05`、`DATA-03` |
| 历史症状与根因 | 进入 More，展开账号中心后再点问题诊断、备份/恢复等标题，按钮有时没有反应；页面只在滚动的瞬间能点开，滚动一停又失效。用户没有点击生成、导出或分享动作；根因：`src/features/more/components/ContentSourcesPanel.tsx` 同时拥有内容源排序行的挂载生命周期、稳定 source host 和 Reanimated transform。普通 ExpandablePanel、诊断导出逻辑与备份导出逻辑不是根因。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-002` 内容源连续拖回原位后两行重叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 内容源保持展开时先把一项拖到相邻槽，再把同一项拖回原位，两个来源会叠在同一行；界面声明共四项，但只能命中三个独立 row；根因：`src/features/more/components/ContentSourcesPanel.tsx` 的 `SortableRow.useAnimatedStyle` 零位移分支必须负责撤销旧 native transform。空对象没有清除指令；`undefined` 会被当前 React Native Fabric 的 JSI→dynamic 转换跳过；`null` 又违反 Reanimated Android 同步 transform 操作要求的数组契约。空数组既保留明确的 transform 更新，又由 React Native 重置为 identity。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-003` 内容源多次换位后收起 App 闪退

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 内容源连续换位数次后收起面板，整个 App 立即退出到 Launcher；这是修复 `REG-MORE-001/002` 后引入的发布回归；根因：`SortableRow.useAnimatedStyle` 为撤销旧位移返回 `transform: null`；锁文件实际安装的 Reanimated 4.1.7 Android 在 `NativeProxy.performNonLayoutOperations` 刷新或卸载该 host 时把 transform 按数组处理，收到 dynamic `null` 后在主线程抛出类型异常。React Native 接受 null 作为普通 View transform reset，不代表 Reanimated 的同步 transform 命令也接受 null。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-004` TalkBack 按旧来源顺序遍历已重排内容源

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 视觉排序已经变为 linux.do、NodeSeek、妖火、V2EX，但 TalkBack 仍先聚焦视觉末尾的 V2EX，再按初始 source host 顺序遍历；手柄同时朗读“第 4 项”，造成遍历顺序与位置语义互相矛盾；根因：`ContentSourcesPanel` 把视觉拖动的稳定 host 策略同时用于 screen-reader 语义顺序。两种模式需要共享 preferences，但不能共享 Native child order。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-PERF-013` 巨图编译对同一 URL 候选重复分析

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 1000+ 图片正文的网络响应已经返回，详情页仍长时间占满 JS 主线程才出现；普通图片数量越多，等待近似按重复 URL 判断次数放大；根因：`src/domain/forum/forumContentMedia.ts` 在同一次编译内缺少候选级分析所有权，各 helper 从 attributes 重新解释相同字符串。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-PERF-014` 普通启动与站内详情重复请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NAV-02`、`FEED-01`、`FEED-02`、`TOPIC-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-03` |
| 历史症状与根因 | 普通冷启动时 Feed、Categories、账号、通知和更新并发争抢；账号逐站结算又让聚合请求反复切换。App 已运行后从列表进入 Topic，返回再进入仍可能重复 transport 和正文编译；根因：`useInitialForegroundRuntime`、`useAppRuntime` 与 `useAccountRuntime` 之间缺少“本机事实已恢复”和 first-content 边界；Topic 重入必须服从唯一 `QueryClient`。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-PERF-015` ReaderData 重复建索引且四个 Tab 冷启动全挂载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-03`、`SEARCH-01`、`SEARCH-02`、`LIBRARY-01`、`LIBRARY-03`、`USER-01`、`USER-02` |
| 历史症状与根因 | 冷启动同时渲染未访问 Tab；同一份收藏、历史和密度数据在 Feed、Search、Library、User 各扫描一次，设置无关变化也重复派生；根因：App composition 未拥有跨 route 的稳定 Reader 列表派生，route 生命周期也绕过 React Navigation 的默认 lazy/freeze 能力。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-PERF-016` LinuxDo 列表为探测下一条多翻页且分类重复读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | LinuxDo 首页或搜索首个页面已经足够显示 30 条，App 仍等待下一页；Catalog、Feed、Search 接近同时进入时又各读一次 `/site.json`，让“全部”更晚原子结算；根因：`src/sources/linuxdo/reader.ts` 与 `src/sources/linuxdo/search.ts` 的分页循环拥有重复探测；LinuxDo adapter 没有一个受 `ReadGateway` scope 约束的 `/site.json` RAM owner。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts` |


## `REG-PERF-017` 来源页面和最终正文被重复解释

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`USER-02`、`NOTIFY-02`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 正常列表、搜索、用户页或通知详情等待本地重复 parse；1000+ 图片详情把同一最终正文反复 sanitize、扫描、序列化和编译，响应完成后仍长时间占用主线程；根因：页面 document/root 和最终 `PreparedForumContent` 没有成为各自阶段的唯一 owner，HTML string 被当作跨层工作接口。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-PERF-018` 稳定 Query 结果和局部图片状态触发全局重复渲染

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 已结算的引用和“全部搜索”在父组件无关重渲染时重建 Map、分组与可见列表；任一 inline 图片状态变化让所有回复重新扫描 HTML 和渲染；同一 `srcset` 在目录状态变化时重复解释，NodeSeek reaction 同一 Topic render 计算两次；根因：Query 层没有输出结构稳定的最小投影，正文行失效边界没有落在 compiled row 的 `dynamicImages`，descriptor 解释与会话投影由同一个函数重复拥有。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-PERF-019` 首页冷启动丢弃已确认会话并重复请求首页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03`、`NOTIFY-03`、`NAV-01`、`NAV-02` |
| 历史症状与根因 | 冷启动第一瞬间先出现一份来源不明的列表，随后只剩 V2EX，再刷新成正常多来源列表；同一启动快速请求多次，浪费会话信任并增加站点限流风险；根因：账号终态没有独立持久化；Account probe lifecycle、首页请求和 CF/login recovery 被塞进同一分布式状态链。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-PERF-020` 正文原图重复解码适屏图并扩大重图工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 滚动到重图片区域时 PSS 峰值比详情前增加约 `184MB`，超过 `REG-PERF-010` 的 `+150MB` 门槛；返回后约 `+48MB`，说明不是持续泄漏而是离屏图片 cell 与重复解码共同扩大峰值工作集；根因：`src/features/topic/rendering/previewRenderers.tsx` 的适屏底图/原图双层生命周期，以及 `src/features/topic/components/TopicContentList.tsx` 的详情 FlashList 回收池上限。请求并发由既有 coordinator 管理，不等于 decoded Bitmap 驻留预算。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-PERF-021` Library 动态筛选通过批量 Native 节点重建结算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`NAV-01` |
| 历史症状与根因 | 关注用户切回收藏的隔离样本 `20/20` 帧都 miss，p95 约 `48ms`；收藏与历史切换掉帧约 `43.6%`、p95 `32ms`。相同数量筛选项切换接近一帧，说明数据筛选本身不是主因；根因：`src/ui/controls/SelectionControls.tsx` 的 Pill 位置身份，以及 `src/features/library/LibraryScreen.tsx` 在普通来源切换中是否拥有动态分类 Native children。所有筛选语义状态由外部值驱动，节点自身无业务状态。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-022` Library 空收藏假绿与富内容 tab 复用所有权错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`NAV-01` |
| 历史症状与根因 | 空收藏返回 p95 `21.56ms`，看似达标；同设备进入 238 条 History 为 p95 `40.45ms`，旧实现三组真实收藏↔历史为 p95 `42.81–55.00ms`。空数组会清掉越界回收节点，下一次进入富内容数据集必须重建首屏 TopicCard，因此空收藏不是有效性能 oracle；根因：`LibraryRoute` 对收藏/历史数据的派生所有权，以及 `LibraryScreen` 的 tab viewport、FlashList props identity、分阶段挂载和失焦释放。每个数据集只允许在自身输入变化时派生一次；普通 tab 切换不得重算或重渲染已挂载列表。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-023` 等价运行时投影重复提交新引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`SEARCH-01`、`NOTIFY-03` |
| 历史症状与根因 | 通知刷新结果未变仍提交新的 errors state，App 无关重渲染仍重建 Navigator `onReady`，单来源搜索结算后无关重渲染仍重建列表 data；下游 memo 因引用变化失效；根因：等价通知错误、导航 ready 回调和单来源 Search groups 没有在各自现有 owner 内保持引用稳定。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-058` 新增通知来源重读稳定 sibling snapshot

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 活跃通知来源从 A 扩到 A+B 或单站换号时，A 已成功的未读 snapshot 被再次读取、持久化和投递扫描；根因：`useNotificationsRuntime` 把 `source + identity` 独立生命周期聚合成一个 Query，并以 aggregate result 驱动副作用。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-059` 通知详情外链打开失败没有任何反馈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 用户点击通知详情中的普通外链时，Android 没有可用处理器或打开失败会毫无反馈；`mailto:` 等非 HTTP(S) scheme 也被直接交给平台，没有明确支持边界；根因：`DetailHtml` 直接执行裸 `void Linking.openURL(href)`，没有观察 rejection，也没有由 Route 持有协议校验和错误反馈 callback。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NAV-001` 底部导航只在图文附近响应点击

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NOTIFY-03` |
| 历史症状与根因 | 首页、搜索、收藏、更多必须点得非常准；图标左右虽仍属于对应 tab 的视觉槽位，点击却没有跳转；根因：`src/app/styles.ts` 把 App 级 `tabBarItemStyle.navItem.alignItems` 设为 `center`。React Navigation 的外层 item 虽然 `flex: 1`，其直接子 `PlatformPressable` 却在横向交叉轴收缩到图文固有宽度；`src/ui/navigation/NavBar.tsx` 的内部居中视觉样式不是根因。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-099` 展开主楼引用被显示成上下两张卡片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 主题正文中的引用展开后，引用摘要和完整正文被父 FlashList 显示成上下两个隔离卡片；正文包含多个物理 row 时还会重复外框、圆角或间距；根因：`TopicContentList` 的逻辑内容 scope 与 quote frame 样式必须共同使用引用 `instanceKey`；语义身份不能只存在于 compiler row，而在父 FlashList presentation 层丢失。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-TOPIC-108` 新进入屏幕的图片被旧 row 请求占满 permit

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 千图正文继续滚动时，当前已经进入屏幕的图片保持等待；上一屏或预取 row 的图片仍占用全部四个请求位置，必须等旧请求完成或超时后当前图片才开始；根因：Coordinator 用 warm capacity 决定是否取消旧请求，却用当前 running 数决定是否启动新请求；warm 上限大于并发 permit 上限，因此合法保温的旧请求可以永久占满全部 permit。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-109` 展开同主题主楼引用导致 App 闪退

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`TOPIC-01`、`TOPIC-02`、`NAV-03` |
| 历史症状与根因 | App 只读打开 linux.do `t/2768624` 后，点击评论中引用主楼的“展开”必定退出到系统桌面；Release 日志为 `FATAL EXCEPTION: mqt_v_native`，JS 异常是“论坛内容缺少匹配的预编译计划”；根因：`replyForQuotedPost` 用 `local || cached` 同时表达“当前数据优先”和“可渲染对象优先”，因此无计划的本地主楼投影覆盖了有计划的缓存对象；严格 renderer 随后按既定 fail-fast 契约抛错。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-TOPIC-110` 普通代码块显示并复制字面 code 标签

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | App 只读打开 NodeSeek `post-879597-1` 时，一个普通五行代码块在同一代码框中额外显示 `<code>` 与 `</code>`；复制结果也包含这两个标签；根因：通用整页 parser 的 raw-pre 性能策略泄漏进论坛正文 Module；direct compiler 另行打开 `parsePreContent`，导致同一正文存在两套 AST。重新编译序列化 HTML 的测试使用了正确 AST，因而掩盖 production prepared plan。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-TOPIC-111` 收起结构化正文后标题停止绘制

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | App 只读打开 linux.do `t/topic/2769371` 的“注册地址” details 或 `t/topic/2769388` 的“Quote” Callout，展开后再收起会留下圆角背景框，但标题、图标和箭头像素全部消失；accessibility tree 中对应标题仍存在；根因：`src/features/topic/components/TopicContentBlock.tsx` 的 `continuationFrameStyle`。`only` 状态没有输出完整边框几何，React Native Android 将被移除的 per-edge width 解析进 rounded clip path 后裁掉全部子节点。 |
| 当前 owner | `tests/ui/topic/topic-split-disclosure.test.tsx` |


## `REG-TOPIC-113` linux.do 可读详情被分类策略替换成权限页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01` |
| 历史症状与根因 | App 原生详情打开 linux.do `t/topic/2777081` 时，标题、作者和回复数已经加载，却把真实正文替换成“需权限 / 暂无权限”；同一 App 内原站、同一账号和同一 URL 实际可读；根因：`src/sources/linuxdo/reader.ts` 的 `getLinuxDoTopic` 成功详情边界。分类策略描述对象访问规则，真实拒绝只由请求错误分支表达；两者不能在已成功解析正文的 `TopicDetail` 中同时成立。 |
| 当前 owner | `tests/integration/source-access-requirements.test.ts` |


## `REG-TOPIC-114` Android 正文图片首载使用下采样尺寸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | process-cold 打开含长图的主题时，图片先显示 `4:3` 占位，加载完成后错误缩到约 `342px` 高；退出再进入才按约 `898px` 的真实比例显示。多图片正文中的每张冷图都可能独立命中；根因：`expo-image` `GlideRequestListener` 把下采样 Drawable 的 `intrinsicWidth/intrinsicHeight` 作为事件尺寸，忽略 `ImageViewWrapperTarget` 在同一次 Glide downsample 已记录的 EXIF-upright source width/height。自然尺寸的 owner 应是 Native 解码边界，不是 JS renderer 的比例猜测。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-115` linux.do 已删除主楼被误判为解析失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01` |
| 历史症状与根因 | App 原生详情打开 linux.do `t/topic/2780439` 时显示“主题正文解析失败”，而 App 内原站同一 URL 已返回并展示“（话题已被作者删除）”；根因：`src/sources/discourse/model.ts` 的共享 `discoursePostFields` 把删除回复的可见性规则同时当作主楼字段解析有效性；放行后又用 `hasRenderableHtmlContent` 预检媒体-only `cooked`，使 linux.do reader 在正式 compiler 前多做一次 DOM parse。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts` |


## `REG-TOPIC-116` linux.do emoji 枚举被回收后重进先显示英文 ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 详情已显示贴图反应后，离开一段时间再进入会先显示 `heart 1` 等英文 ID，随后才替换成贴图，看起来像每次都重新请求；根因：Query 只有 `staleTime=Infinity`，但 inactive data 仍会被 GC；来源 adapter 的 module cache 虽能挡住第二次 HTTP，却仍通过异步 loader 返回，使 React 先消费空 map、再提交真实 map。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-117` 密集 inline Expo Image 子树造成停手补帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/342888` 的大量 emoji 与文本混排区域在每次短滑停止后仍会细微补走最后一段，看起来像图片销毁后修正了列表位置；同页展开引用时还容易把既有两阶段完整挂载误判成同一问题；根因：`ManagedInlineForumImage` 是四站正文 inline 图片的唯一共享显示边界。当前 App 开启 New Architecture，`RCTTextInlineImage` 在 Fabric 映射到标准 `Image` attachment；旧 Fresco text span 不是运行时 seam。RN `0.81.5` 的 `node_modules/react-native/Libraries/Image/Image.android.js` Text 分支漏掉标准图片事件；此外 Fabric direct event 最终从 attachment 的 current props 取 listener，旧 controller 已排队的事件可能因此调用新 attempt handler。修复后 App 仍只声明一个 Fabric attachment；锁定 patch 转发 `loadStart/progress/load/error/loadEnd`，并让标准 `ReactImageView` 在每次 controller build 捕获当次 request generation、随事件回传。请求、解码、GIF 与卸载取消继续由标准 Native Image owner 负责。Fresco cache key 不包含 headers，故显示 URI 仍以 opaque request identity 的稳定 hash fragment 分区；fragment 不进入 HTTP 请求，真实 URL 与凭据保持原协议。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-118` 独占一段的用户 mention 背景和边框被拉伸成整行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 正文中独占一段的 `@用户名` 显示为从正文左侧延伸到右侧的浅色圆角框；同屏 mention 后仍有正文时，框只包住文字；根因：Android/Yoga 默认会拉伸 block 容器中的直接子节点；mention 自带背景、边框和内边距，因此拉伸宽度被完整绘制。混排时 mention 嵌套在外层 `Text` 中，不进入该布局路径。共享 `forum-user-mention` 样式是全部正文入口的最小根因 seam。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-119` Fabric inline emoji 明显高于同一行文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | inline emoji 已加载且尺寸正确，但在同一行中明显偏上；linux.do `t/topic/342888` 的 `#110` 中，同一 mask 下表情彩色内容中心比“是这样嘛”文字中心高 `11.5px`，底边低差也不自然；根因：四站正文都由 `inlineForumImageAlignmentStyle` 得到同一正文 `lineHeight` 与图片显示高度，返回值直接进入 Fabric attachment style。恢复既有 `translateY=max(0, (lineHeight-imageHeight)/2)` 就能由真实运行时消费；大于行高的 sticker 返回零位移，避免裁切。不增加 Native patch，也不按素材、帖子或站点维护偏移常量。 |
| 当前 owner | `src/platform/media/inlineMedia.test.ts` |


## `REG-TOPIC-120` NodeSeek 折叠正文首次展开时图片不加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-889473-1` 第 12 楼的“哼”处于折叠态时，第一次展开正文图片没有加载；需要后续 viewability 变化才可能恢复；根因：`TopicContentList` 的旧 viewport 状态只保存 key/index，并用 presentation continuity 猜测动态内容归属；它既漏掉 opening/reply quote、accepted answer 等替换，也可能让普通 insert/reorder 因共享 ancestor 冒领 permit。根因位于 FlashList observation 到 Coordinator 的 semantic projection，不在 renderer、URL、网络、缓存或解码。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-121` Fabric attachment 被 permit wave 反复 remount

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | inline 图片首次取得 permit，或普通滚离后恢复 permit 时，虽然还是同一图片与 Native owner，却因 React key 改变被 remount；这会丢失已有 attachment 状态并扩大闪烁、重复解码与迟到事件竞态；根因：`TopicBodyMediaLease` 只暴露一个 identity，同时承担 attempt 结算与 attachment 物理生命周期；拆分后若只保存旧 JS handler，仍漏掉 Fabric direct event 经 current props 分发的 Native queue 竞态。修复须同时分离 `attemptId` 与 `attachmentKey`，让 Native controller/request 捕获可回传的 generation，并禁止不同 generation 进入同一 coalescing bucket；`onDraw` error 也必须从 request-bound listener 取 generation，再由当前 handler fail closed 比对。不改变公共媒体 identity 或其他 renderer。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-122` 块级图片上下间距被排版改动放大

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 普通块级正文图片与上下文字的留白由既有 `6/8` 变为 `8/12`，正文节奏明显变松；同批次其他 paragraph、heading、blockquote、table 与 mention 排版并不要求回退；根因：四站主楼、回复和展开引用共用 `forumTagStyles.img`；只需恢复该共享样式的两个数值，不应回滚同提交其他排版。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-123` 物理语义 row 泄漏文章边界且共享正文尺度粗糙

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`MORE-03` |
| 历史症状与根因 | NodeSeek 等包含 blockquote、重复 `hr`、标题和代码块的详情页出现重复文章顶部 hairline、`16dp` 内边距与 row 间 `10dp` 空带；App-owned 行高、分隔线和块级节奏叠加后显得松散、粗糙；根因：`TopicContentList` 把每个物理 opening row 都当作视觉文章起点并重复应用 `articleBody`，同时为相邻普通语义 row 插入通用 separator；共享 `forumTagStyles` 与 typed block 样式仍使用旧的宽松尺度。来源 CSS 本就不会进入 App。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-124` Topic Header 与首个正文 row 零间距

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2801664` 中标题区末尾标签与紧随其后的“展开”/引用正文直接相接，没有纵向留白；同类普通首段也可能贴住 Header；根因：Header 与正文的边界归 `ListHeaderComponent` 自身所有；把既有 `20dp` 从无效 `gap` 改为 Header 容器 `paddingBottom`，由所有 Topic 共用一次。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-125` Fabric inline 表情右侧贴住文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2803759` 的哭脸表情与紧随其后的 `OpenCode` 文案在右侧相碰；表情向下靠的基线本身正确；根因：Fabric attachment 必须真实拥有绘制占位：可见 `w × h` 图片使用 `(w + 4) × h` attachment，Native Image 继续 `contain`，从而在两侧各留 `2dp`；inline renderer 不再套用含外部 margin 的共享块样式。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-126` 原图 display revision 改变视觉 recycling identity

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-03` |
| 历史症状与根因 | 进入图片预览后返回正文会闪一次，适屏图升级到清晰原图时还可能再闪；逐帧可见原图层被短暂清空；根因：Native 视觉 owner identity 只由当前原图或兼容 poster 的 `compatibleImageRequestIdentity(source)` 定义；revision 继续驱动失败恢复、跨预览通知、lease 和迟到事件保护，但不再参与 `recyclingKey`。适屏底图由正文图片 frame 持续持有，原图只负责覆盖。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-127` 表格内线重叠且周界过薄

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 回复中的 GFM 表格内部分隔线显得重叠、抢眼，四周轮廓却只有一层很薄的 hairline；底边还会因末行和外框同时绘制而比顶边更重；根因：共享 HTML 表格的描边权分散在 `htmlTagsStyles.th/td`、`htmlTableFrame` 与 Cell renderer。正确模型是 Frame 独占周界、Cell 独占内部右/下分隔，每条物理边只有一个 owner。 |
| 当前 owner | `src/features/topic/styles.test.ts` |


## `REG-TOPIC-128` NodeSeek 评论未识别投票与 Stardust，投票归属串入主楼

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`WRITE-03`、`WRITE-05`、`WRITE-06`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 评论中的 `nsapp://vote` 与 `nsapp://stardust-receive` 直接显示原文；测试帖 #10 明明存在收款链接，App 却不生成卡片；主楼能显示投票时，评论投票仍可能缺失或串到主楼；同一回复同时包含独立 Stardust 段和投票时，收款卡片还会被整段删除；根因：NodeSeek marker 归一、投票读取归属和正文编排各有重复 owner。当前模型固定为：`prepareNodeSeekForumContent` 独占 marker 安全归一及 typed placeholder 保留，NodeSeek reader 按每段正文 ID 集合临时绑定远端 poll，`compileForumContent` 独占原位置 row 编排。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-TOPIC-129` 表格媒体使用整页宽度且 cooked 语义样式缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do `t/topic/2817831` 的两列表格中，右列大图按整页正文宽度绘制并越过单元格分隔线；`bbcode-b/i/u/s`、键帽、增删高亮、固定大小文字和群组 mention 等 cooked 语义在 App 中还会退化成普通文字或弱化样式；根因：`td/th` 是单元格实际内容宽度的唯一 owner，应把扣除自身 padding 与 border 后的数值向后代 renderer 传递；表外继续回退到 RNRH 正文宽度。静态 cooked 语义只由现有 HTML style builder 统一映射，不复制来源 CSS。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-130` NodeSeek 原生删除线在 App 中退化为普通文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 沙盒主题 `post-856117` 第 18 楼在原站显示删除线，App 同一楼层却显示为普通文字；NodeSeek Composer 也缺少原站已有的删除线入口；根因：阅读端缺失的是现有 `tagsStyles` 中的 `<s>` 语义；编辑端缺失的是共享 Runtime 的站点能力投影。Markdown codec 已原生支持 `~~...~~ → <s>`，不需要新增转换、配置或状态。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-131` linux.do MP3 在原生详情中被当作空正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do `t/topic/2825663` 的有效 `<audio><source src="…mp3">` 在原站可播放约 4:18，但 App 原生 Topic 详情没有播放器；同帖空 `source` 又不能据 fallback 文字猜造媒体地址。根因：共享 sanitizer、内容 compiler 与 Topic 原生媒体 renderer 只把图片和视频视为离散媒体。修复后安全 HTTP(S) 音频归一为原子 `forum-audio`，主楼、回复、完整引用和采纳答案复用 Topic 级唯一 Expo Video runtime；空源保留 fallback，通知只保留 fallback。 |
| 当前 owner | `tests/integration/html-sanitization-contracts.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-132` 音频随虚拟列表行回收而中断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | Topic 音频开始播放后向下滚动，只要对应 FlashList 行被回收，Expo player 与 Native generation lease 就随行卸载，声音中断；重新滚回还会重新建 player 和请求。根因：播放器真相错误地放在 `ForumContentAudio` 行组件，`TopicBodyMediaCoordinator` 又把离开可见区的 settled audio 降回 waiting。修复后 `TopicAudioSession` 在 Topic provider 内唯一持有 player、lease、活动音频和各段位置；虚拟行只订阅自身快照，行回收不再改变播放生命周期，离开 Topic 才释放一次。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-133` 妖火内联视频无法连续拖动进度

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 妖火正文视频在非全屏状态只有整面点击播放和独立全屏按钮，没有可连续拖动的进度控件；整面 Pressable 还覆盖了播放器手势区域。根因：`ForumContentVideo` 关闭 `VideoView.nativeControls` 后自行维护播放、覆盖层和全屏状态，却没有实现成熟播放器已有的进度、手势和无障碍能力。修复后继续使用既有 Expo Video/Media3 内核，但直接启用平台 native controls，poster 只覆盖 loading 阶段。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-WRITE-062` LinuxDo Emoji 源码往返卡死

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 含 `:wink:` 等 LinuxDo Emoji 的草稿从源码切回富文本时 WebView/GPU 可卡死，编辑器失去响应；根因：资源预览被错误写入规范文档；一次模式同步又触发第二次 ProseMirror 文档 transaction，造成无意义的整篇改写与渲染。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-063` 连续插入私有原子节点替换前一个节点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 插入 Details 后立即插入 Spoiler，后者会覆盖前者；NS poll、Stardust、L poll 等相邻节点存在同类风险，插入后也不能稳定继续输入；根因：block 插入与同类型编辑分散在各站点分支，缺少一个拥有 atom selection 语义和尾随文本选区的共享入口。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-064` CodeMirror 首次撤销清空同步正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 从富文本切到源码后第一次点击撤销，整篇同步过来的正文被清空；根因：程序同步与用户编辑共用 undo 所有权。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-065` LinuxDo 投票配置与原站交互偏离

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 用户组要求手输逗号文本，无法搜索/多选；Staff、ranked/number 图表条件错误；卡片丢标题和配置，排序投票仍显示单选圆点；根因：LinuxDo 站点能力目录未进入现有 host-action seam，UI 与 codec/账号权限各自猜测配置。 |
| 当前 owner | `src/sources/linuxdo/pollCapabilities.test.ts` |


## `REG-WRITE-066` LinuxDo Emoji 目录固定截断为 120 项

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | LinuxDo Emoji 明显少于原站，第 121 项之后无法浏览，也无法被搜索命中；根因：首屏渲染批量与目录数据边界混为一体。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-067` 终止块只能显示横向 GapCursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 回复或编辑正文以表格、投票、Stardust 或其他 block 结尾时，键盘已显示但表格下方只有一条横线，无法得到正常竖向文字光标；刚加载正文时撤销还可能清空整篇内容；根因：共享 Editor Runtime 显式关闭了 StarterKit 已内置的 TrailingNode，使合法的 GapCursor 被迫承担终止输入位置；两处程序化富文本替换又没有声明 `addToHistory=false`。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-068` NodeSeek 错误移除原站支持的删除线

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 旧能力审计把 NodeSeek 的删除线与下划线一起判为不支持，导致 Composer 移除了原站实际存在的删除线；第 18 楼原站已有删除线，App 工具栏却无法继续创作同类内容；根因：共享 Tiptap UI 与站点发布能力被错误捆绑判断。两站可共享同一个删除线命令，只有下划线需要按 site 投影；NodeSeek Markdown 仍是发布边界。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-069` LinuxDo 模板计数故障阻止内容进入草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 选择动态模板后正文迟迟不出现，usage POST 延迟或失败时模板内容完全丢失，用户会误以为选择无效；根因：本地草稿编辑与原站 usage accounting 被错误合并成一个远端写事务；计数接口不拥有正文插入。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-070` NodeSeek 作者无法锁定自己的投票

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03`、`TOPIC-02`、`TOPIC-03`、`ACCOUNT-01` |
| 历史症状与根因 | App 中自己发布的 NodeSeek 投票没有锁定入口；锁定后的投票也沿用通用“已关闭”文案，无法与原站管理语义对齐；根因：来源 adapter 没有保留原站提供的管理权，UI 被迫把“能否管理”当成未知；锁定写入也没有进入现有 writable ticket、mutation scope 与权威 poll snapshot cache owner。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-WRITE-071` Stardust Ref、状态查询与付款生命周期使用错误 owner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`TOPIC-02`、`TOPIC-03`、`ACCOUNT-01` |
| 历史症状与根因 | Composer 新建卡片固定写出 `ref_id=1`，原帖和回复均无法付款；真实 #10 收款链接漏识别；每日状态查询限额后 App 曾把原站静默处理的“每天最多进行500次星辰记录查询”直接显示在卡片并附加重试控件。即使 send 明确成功，刷新失败也曾被降级为 unknown；非一次性卡片付过一次后被错误关闭；根因：Ref 读取兼容与写入合法性没有分层，marker canonical 来源遗漏，状态展示与非幂等 send 共同拥有付款生命周期。正确模型是：Parser 可读旧卡，serializer/send builder 独占 Ref 写边界，Topic controller 独占 `prepare → confirm → send`；status 成功只补充统计，失败只进入诊断且不拥有卡片 UI。 |
| 当前 owner | `src/domain/forum/structuredComposer.test.ts` |


## `REG-WRITE-072` 新回复成功后丢失定位且完整目标窗被误报为部分失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 新回复已由原站确认并读回，但 Topic 停在目标页第一条而不是新楼层，顶部同时误报“部分评论未能读取，已显示 N 条”；根因：权威回复窗口 owner 必须同时保留页面完整性和写后定位交接；Composer 只拥有草稿与提交，不能猜楼层或拥有列表滚动。 |
| 当前 owner | `tests/integration/source-read-contracts/nodeseek.test.ts` |


## `REG-USER-008` 用户活动末页仍显示加载更多

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | NodeSeek 用户只有一条主题时仍显示“加载更多主题”，回复末页也会继续暴露下一页；linux.do 回复存在同类误报，主题则无条件终止而漏掉后续页。根因：来源 adapter 把“当前解析列表非空”当成“还有下一页”，或没有使用原站可分页主题入口；UI 与 controller 只是忠实投影该来源结果。 |
| 当前 owner | `tests/integration/source-read-contracts/` |
