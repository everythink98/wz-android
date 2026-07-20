# 回归语料库

## 文档职责

本文件记录已经逃逸到用户侧、普通自动测试或发布 smoke 没有拦住的问题。它回答“为什么必须测、什么结果才算拦住”，产品现状与入口仍以 `docs/product-map.md` 为准。

每次开发先选择产品能力 ID；命中本文件事故 seam 时，必须执行该条目的最低可靠测试和验收路径。新的逃逸 bug 修复时，同一改动增加一个 `REG-*` 条目和一个能在修复前失败的最小测试。

## 证据名称

| 证据 | 只证明 |
| --- | --- |
| `STATIC_PASS` | 文档、类型、unused 和 React Doctor 增量静态检查通过 |
| `UNIT_PASS` | Vitest 固定的领域、controller、gateway、存储或请求契约通过 |
| `UI_PASS` | Jest/RNTL 固定的用户可见 React Native 渲染与交互通过 |
| `DEVICE_REPLAY_PASS` | `.ad` 脚本在身份匹配的 App、APK、设备和会话上通过 |
| `LIVE_PASS` | App 内真实来源、登录态或获授权写操作得到可观察结果 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR 或 RedBox |
| `NOT_VERIFIED` | 当前没有足够证据，不推断成功或失败 |
| `BLOCKED_BY_ENV` | 受签名、设备、来源或登录态阻碍，且不能安全改变环境 |

`APK_SANITY` 和 `DEVICE_REPLAY_PASS` 可以由同一个发布命令执行，但不得合并成“功能完整通过”。

Jest 的 `it.failing` 只用于保留已确认但本轮不获准修复的精确失败 oracle。Jest 对这类用例显示通过，含义只是“预期中的失败仍然发生”，不得计为该行为的 `UI_PASS`；修复后必须把它改成普通用例并确认真实通过。

## `REG-FEED-001` 首次加载出现两套 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04` |
| 用户症状 | 首页首次读取空列表时，页面 Loading 与 Android 下拉刷新指示器同时出现；Smoke 仍可继续并最终通过。 |
| 触发条件 | `busy=true`、`feedItems=[]`，列表已挂载且同时提供 `RefreshControl`。 |
| 根因 seam | `src/screens/FeedScreen.tsx` 的空态与 `refreshControl` 渲染契约。 |
| 必须保持的行为 | 空数据首次加载只显示页面 Loading；已有列表或主动刷新时保留 `RefreshControl`。 |
| 精确失败 oracle | `tests/ui/feed-screen.test.tsx` 同时断言 Loading 数量和 RefreshControl 是否存在。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染 React Native 组件；源码字符串或 `APK_SANITY` 都无法证明 Loading 唯一。 |
| Replay 或真实验收路径 | `tests/device/feed-topic-return.ad` 验证 Feed 可用与返回状态；它不能单独证明 Loading 唯一。 |
| 负向验证方式 | 临时让空列表 busy 状态也挂载 RefreshControl，UI 测试必须失败，随后还原。 |
| 明确不覆盖范围 | 实时来源速度、分页数据正确性和五站解析由 `FEED-*` 其他测试与 Live 验收负责。 |

## `REG-FEED-002` 切换来源或排序后列表没有回到顶部

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | NodeSeek 从“新帖子”切到“新评论”后已有主题却看不到新列表首项，Replay 曾被误判为动态 Feed 无结果。 |
| 触发条件 | 旧列表已离开顶部，来源、分类、排序或阅读筛选变化后替换数据；FlashList 的旧实例继续持有滚动位置，而筛选 effect 的即时 `scrollToOffset` 早于新数据布局完成。 |
| 根因 seam | `src/screens/FeedScreen.tsx` 的筛选列表 identity 与滚顶契约，以及 `src/components/listPerformance.ts` 的 Feed FlashList 位置策略。 |
| 必须保持的行为 | Feed 的来源、分类、排序或阅读筛选变化后从目标列表首项开始展示，不保留上一组合的可视锚点。 |
| 精确失败 oracle | `tests/ui/feed-screen.test.tsx` 复用同一份主题数组和全部 callback，模拟原生即时滚顶未生效时只改变筛选，要求列表 identity 随之改变且首项重新可见；`src/components/listPerformance.test.ts` 要求 Feed 禁用 `maintainVisibleContentPosition`；`tests/device/four-source-feed.ad` 先滚动到出现“回到顶部”，再切换 NodeSeek 排序并要求 `feed-topic-first` 恢复可见。 |
| 最低可靠自动测试层 | `UI_PASS` 固定筛选变化后的列表重建行为，`UNIT_PASS` 固定 FlashList 配置；`DEVICE_REPLAY_PASS` 证明 Android 原生列表实际回到首项。 |
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 覆盖四站及 NodeSeek“新帖子/新评论”；切换排序前必须确认“回到顶部”已出现，切换后再确认新首项可见，从而区分空数据、仍停在旧位置和真实滚顶。 |
| 负向验证方式 | 从 `renderFeedScene` 依赖中移除分类、排序或阅读筛选，或者移除 Feed FlashList 的筛选 identity `key`，RNTL 必须保留错误滚动位置并失败；移除 `maintainVisibleContentPosition: { disabled: true }`，Vitest 必须失败；设备 Replay 必须在真实列表未回顶时失败。 |
| 明确不覆盖范围 | 不固定动态主题标题、数量或来源当天可用性；这些仍按 Replay 动态结果规则与 Live 验收。 |

## `REG-FEED-003` 小隐寺排序菜单为空

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 小隐寺独立 Feed 可以读取，但点击“列表筛选”只出现空弹层，无法切换“热门”或“新内容”。 |
| 触发条件 | 当前来源为 `xiaoyinsi`，且 `shouldUseFeedFilter` 已允许显示按钮，但菜单分组白名单仍只包含原有三个排序来源。 |
| 根因 seam | `src/screens/FeedScreen.tsx` 的排序按钮可见条件与 `feedFilterMenuGroups` 取值条件没有使用同一来源集合。 |
| 必须保持的行为 | 小隐寺在全部分类和任一站内分类下都显示独立“最新/热门/新·所有/新·话题/新·回复”菜单；选择后关闭弹层、更新来源自己的排序状态并重新加载首项，不影响其他来源。 |
| 精确失败 oracle | `tests/ui/feed-screen.test.tsx` 切换到小隐寺，打开“列表筛选”并选择“新·回复”，再切分类确认菜单仍可用；`tests/ui/feed-controller-xiaoyinsi.test.tsx` 证明选择后真实请求使用 `new-replies`。 |
| 最低可靠自动测试层 | `UI_PASS` 固定菜单内容和分类组合，controller UI 测试固定实际请求；只测 `feedFilterMenuGroups` 常量或只看按钮存在会漏掉空弹层。 |
| Replay 或真实验收路径 | 当前 debug APK 在小隐寺独立 Feed 打开“列表筛选”，分别选择“热门”和一个“新”筛选，等待 `feed-list-ready-xiaoyinsi` 再出现并打开首条主题；全程只读，未授权时 `/new.json` 的登录提示也必须明确。 |
| 负向验证方式 | 从 `activeFeedFilterMenuGroups` 的来源集合移除 `xiaoyinsi`，UI 用例必须在找不到“新·回复”时失败；恢复后 controller 用例仍必须请求 `feedFilter=new-replies`。 |
| 明确不覆盖范围 | 原站热门排序当天的主题数量和标题仍属动态 Live 数据，不固定为测试夹具。 |

## `REG-FEED-004` 单站刷新失败清空可信列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 单站首页已经显示主题，用户下拉刷新遇到来源错误后，旧列表和下一页 cursor 被空失败响应覆盖，只剩错误提示。 |
| 触发条件 | 首屏刷新返回 `items=[]` 与站点 `errors`；controller 在判断错误前无条件执行 response apply。分页已有失败门禁，但 `reset/nocache` 路径没有复用。 |
| 根因 seam | `src/app/useFeedController.ts` 的错误响应应用边界，位于可信 `requestBaseState` 与 `nextFeedPageState` 提交之前。 |
| 必须保持的行为 | 单站首屏或刷新返回来源错误时不应用响应，保留原列表、页码和 cursor，并显示可重试错误。聚合首屏只有确有成功条目时才应用 partial；聚合分页继续禁止混入半页结果。 |
| 精确失败 oracle | `tests/ui/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-004` 先加载带下一页 cursor 的 V2EX 列表，再让同站刷新返回空错误，要求主题和 cursor 均保持；修复前两者被清空。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 hook state 必须跨两次请求验证旧列表和 cursor；只看错误 Toast 或 trace 终态不能证明可信内容未被覆盖。 |
| Replay 或真实验收路径 | 不主动制造来源故障；正常单站下拉刷新继续只读验收，自然失败时核对旧列表仍可见。 |
| 负向验证方式 | 恢复错误判断前的无条件 `applyFeedResponse(data)`，编号测试会收到空列表和丢失 cursor。 |
| 明确不覆盖范围 | 不把不同来源、分类或排序的旧列表保留到新请求 key，也不缓存跨启动的远端 Feed。 |

## `REG-SOURCE-001` 聚合读取被单站凭据存储失败整体阻断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 用户症状 | 任一来源凭据存储临时读取失败时，“全部”首页或搜索可能在发起站点请求前整体失败；linux.do 还可能把读取失败伪装成无凭据，继续匿名请求并隐藏错误。 |
| 触发条件 | 读取进入 `sourceGateway`，某个单站 Cookie、User API 或 linux.do 凭据探针抛错；旧聚合实现让异常整体逃逸，而 linux.do 独立分支吞掉异常后匿名继续。 |
| 根因 seam | `src/sources/sourceGateway.ts` 的聚合凭据装配与来源错误合并边界。 |
| 必须保持的行为 | 单站读取的凭据失败仍明确失败；`all` 聚合读取只把失败记录到对应来源的 `errors`，其余来源继续使用已取得或匿名凭据读取，caller-owned trace 终态提升为 `partial`。linux.do 存储未知不得被当成确定无凭据。 |
| 精确失败 oracle | `src/sources/sourceGatewayContract.test.ts` 同时让 linux.do、NodeSeek、妖火和小隐寺凭据 loader 抛错，要求公开主题仍返回、四个错误各自归属且请求不携带失败凭据；linux.do 单源读取必须 rejection。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过 gateway 的真实凭据装配和结果合并；Adapter 夹具或 UI 空态不能证明请求前异常已隔离。 |
| Replay 或真实验收路径 | 不主动破坏设备 SecureStore；正常五站“全部”只读旅程继续覆盖成功路径，存储失败分支由确定性故障注入测试固定。 |
| 负向验证方式 | 恢复任一聚合凭据 loader 的直接 `await`，编号测试必须在公开来源请求前收到 rejection。 |
| 明确不覆盖范围 | 不把单站存储损坏伪装成匿名成功，也不清理、重建或迁移真实设备凭据。 |

## `REG-SOURCE-002` HTTP 成功但解析为空被当成有效页面

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 用户症状 | 来源返回 HTTP 200 但页面结构已经无法解析时，首页、搜索、详情或用户页仍显示为成功；分页还会丢掉失败页 cursor、跳到下一页或误判没有更多内容。 |
| 触发条件 | Adapter 返回带 `parse_empty` 诊断的合法结果对象，controller 只检查 rejection 或 `errors`，未把 `diagnostic.isParseEmpty` 当成失败。 |
| 根因 seam | `sourceDiagnosticSummary` 与 Feed/Search/Topic/User controller 的结果应用和分页 cursor 提交边界。 |
| 必须保持的行为 | 预期中的真实空列表仍可成功；被明确标记为 `parse_empty` 的结果不得应用。首屏和刷新显示可重试错误并保留可信旧状态；分页保留旧列表与原失败 cursor，只重试同一页；聚合 Feed 分页任一来源解析为空时不得混入半页结果。 |
| 精确失败 oracle | `src/app/useFeedController.test.ts` 固定单站和聚合分页不进入 apply；`tests/ui/search-controller-ai.test.tsx` 固定搜索第 2 页解析为空后仍重试第 2 页，并固定整站重试解析为空时保留已有结果和 cursor；`src/app/useTopicController.test.ts` 与 `src/app/useUserController.test.ts` 固定详情和用户资料解析为空不落地。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：controller 必须接收真实诊断元数据并验证用户可见状态、旧数据和 cursor；只测 parser 报告或 HTTP 状态无法证明结果未被应用。 |
| Replay 或真实验收路径 | 正常五站 Feed/Search/Topic/User 只读旅程继续证明成功路径；动态站点若自然出现解析空，必须看到可重试错误且返回后旧状态仍在，不得用当天真空列表冒充故障。 |
| 负向验证方式 | 移除任一 controller 的 `isParseEmpty` 门禁，编号测试必须观察到 success/apply、cursor 前进或旧状态被空结果覆盖。 |
| 明确不覆盖范围 | 不猜测新的站点 DOM/API 结构，也不把没有 `parse_empty` 证据的合法零结果改成失败；真实来源修复需另有可复现样本。 |

## `REG-XIAOYINSI-001` 小隐寺分类全部显示为未分类

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`USER-01` |
| 用户症状 | 小隐寺主题已有有效 `category_id`，但首页、搜索、详情和用户主题仍全部显示“未分类”。 |
| 触发条件 | Discourse 列表、主题、搜索和用户响应只返回 `category_id`，分类字典只在 `/site.json` 中返回。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的共享分类映射；旧实现只从当前响应取字典，没有在 ID 缺失映射时回填小隐寺 `/site.json`。 |
| 必须保持的行为 | 当前响应未携带所需分类时，小隐寺 Adapter 独立读取 `/site.json` 并按字符串 ID 回填；分类请求失败不得抹掉已成功读取的主题。 |
| 精确失败 oracle | `src/localXiaoyinsi.test.ts` 的列表、详情、搜索和用户夹具只提供 `category_id`，分类名仅由 `/site.json` 提供；四条路径都必须得到“生活”。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过真实 Adapter 请求与映射路径；只渲染 UI 夹具或断言 `categoryId` 存在无法拦住。 |
| Replay 或真实验收路径 | 小隐寺“最新/热门”、一条主题详情、一次搜索和一个用户主题列表均做只读对照，确认有效分类不再被统一降级。 |
| 负向验证方式 | 移除缺失映射时的 `/site.json` 回填，Adapter 用例必须稳定恢复为“未分类”并失败。 |
| 明确不覆盖范围 | 原站日后新增、改名或删除分类仍属 Live 数据，自动测试不固定当天分类总数。 |

## `REG-XIAOYINSI-002` 小隐寺回复编辑器缺少格式栏和上传入口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01`、`WRITE-04` |
| 用户症状 | 小隐寺已经支持回复和 `/uploads.json`，但编辑器没有 Markdown 格式栏或图片入口，用户只能输入纯文本。 |
| 触发条件 | 回复来源为 `xiaoyinsi`；底层上传已实现，但编辑器的 Markdown 来源白名单和上传 UI 矩阵没有同步新增来源。 |
| 根因 seam | `src/screens/topic/replyComposerFormatting.ts` 的格式能力集合与 `ReplyComposerSheet` 的来源上传回调边界。 |
| 必须保持的行为 | 小隐寺显示与 NodeSeek/linux.do 一致的 Markdown 常用格式和图片入口；点击图片只调用上传回调，不提交回复；妖火仍使用 UBB，V2EX 仍只读。 |
| 精确失败 oracle | `src/screens/topic/replyComposerFormatting.test.ts` 的 `REG-XIAOYINSI-002` 固定 Markdown 工具栏；`tests/ui/reply-composer.test.tsx` 同编号用例固定四个可写来源的图片回调。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：领域测试固定来源能力，RNTL 固定真实入口和不误提交。 |
| Replay 或真实验收路径 | 打开小隐寺可回复主题的编辑器，检查格式栏和图片入口；可打开/关闭并保留草稿，真实上传仍需逐次授权。 |
| 负向验证方式 | 从 Markdown 来源集合或图片上传 UI 矩阵移除 `xiaoyinsi`，对应测试必须失败。 |
| 明确不覆盖范围 | 不授权真实回复；远端上传文件与残留按 Agent Live 的“四站图片上传草稿”场景单独验收。 |

## `REG-XIAOYINSI-003` 已收藏主题因缺少 bookmark id 无法取消

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 原站已显示主题收藏，但 App 点击取消时提示收藏记录不完整，不能恢复初始状态。 |
| 触发条件 | Discourse 主题详情返回 `bookmarked=true`，却未返回具体 `bookmark_id`；旧实现把 Topic 和 Post 都强制绑定记录 id。 |
| 根因 seam | `src/xiaoyinsiActions.ts` 的书签取消请求构造，以及 `src/app/useTopicActionsController.ts` 的前置门禁。 |
| 必须保持的行为 | Topic 缺少记录 id 时使用 Discourse 主题级 `PUT /t/{topicId}/remove_bookmarks`；Post 取消仍要求具体记录 id；主题收藏先显示目标 optimistic 状态，请求失败恢复原状态，服务端确认后同步当前 Topic 与活动 route snapshot，不整篇重载。 |
| 精确失败 oracle | `src/xiaoyinsiActions.test.ts` 与 `src/app/useTopicActionsController.test.ts` 的 `REG-XIAOYINSI-003` 分别固定请求、optimistic apply、失败 rollback 和真实 controller 路由。 |
| 最低可靠自动测试层 | `UNIT_PASS`：请求构造和 controller 门禁都必须覆盖，单独显示按钮不能证明可取消。 |
| Replay 或真实验收路径 | 在已获逐次授权的可恢复 Topic 上记录初始状态，收藏/取消各一次，刷新后与原站状态一致并恢复初态。 |
| 负向验证方式 | 恢复“缺少 bookmark id 直接返回”、改用 `/bookmarks/undefined`，或移除 optimistic rollback，编号测试必须失败。 |
| 明确不覆盖范围 | 不推断未返回 `bookmarked` 的主题状态；真实远端切换仍按授权和恢复门禁。 |

## `REG-XIAOYINSI-004` 用户页把互动过的主题当成用户发帖

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01`、`NAV-03` |
| 用户症状 | 小隐寺用户页“主题”列表混入用户只回复或互动过的帖子，作者和分页也可能错误。 |
| 触发条件 | `/u/{name}/summary.json` 的活动摘要被直接当作 authored topics，且没有使用 Discourse 专用发帖列表及 cursor。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的用户身份摘要与用户发帖列表生命周期被混为一个接口。 |
| 必须保持的行为 | 身份与计数继续读取 summary；主题独立读取 `/topics/created-by/{username}.json`，作者取该响应用户表，并保留 `more_topics_url` 分页。 |
| 精确失败 oracle | `src/localXiaoyinsi.test.ts` 的 `REG-XIAOYINSI-004` 给 summary 注入非本人主题，要求页面只返回 created-by 两页数据。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过两个真实 Adapter 端点和分页映射；UI 夹具无法区分数据来源。 |
| Replay 或真实验收路径 | 从小隐寺 Topic 进入作者页，打开主题列表和下一页，确认可见主题作者均为该用户并能返回原用户页。 |
| 负向验证方式 | 改回读取 summary 的 `topics`，测试必须出现错误主题 id 并失败。 |
| 明确不覆盖范围 | 原站实时主题数量、隐私主题和被删除主题不固定为自动测试数据。 |

## `REG-XIAOYINSI-005` Device Code 重授权、取消与撤销存在竞态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-06` |
| 用户症状 | 重授权进程恢复时可能退回旧 Token 状态；取消后迟到的 authorized、旧 session 复核，或取消进行中从后台返回才启动的新 poll 仍可能重新登录；服务端撤销成功而本机部分删除失败时，重启还可能恢复已撤销流程的 Device Code。 |
| 触发条件 | 待授权状态与旧凭据没有明确优先级；轮询和 session 复核缺少同步 generation/Abort/mutation 门禁；撤销后的 SecureStore 与 Keystore 清理没有可跨进程恢复的 tombstone。 |
| 根因 seam | `src/app/useXiaoyinsiAuthController.ts` 的授权生命周期所有权与 `src/xiaoyinsiAuth.ts` 的解密持久化、撤销提交边界。 |
| 必须保持的行为 | 有效 pending 优先恢复；开始重授权、取消、撤销或卸载 hook 时同步失效轮询与旧 session 复核，且 mutation 整个进行期间不得启动新 poll 或再打开已作废授权页，迟到结果不得改写新状态；服务端撤销失败保留本机 Token，成功后先留下清理 tombstone、尝试全部本机删除并明确报告 partial；重启必须先重试清理，绝不能恢复 tombstone 后的旧 Device Code。 |
| 精确失败 oracle | `src/xiaoyinsiAuth.test.ts` 与 `tests/ui/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-005` 覆盖迟到解密、迟到 session 复核、进程恢复、取消前已运行及取消中从后台返回才调度的 poll、取消中打开旧授权页、部分清理、tombstone 和重启时清理优先级。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：SecureStore/Keystore 提交边界和 React 生命周期竞态必须分别固定。 |
| Replay 或真实验收路径 | 账号中心检查等待、后台/前台、取消、过期和重启恢复；真实 Google/Discord 登录只由用户操作，撤销不在默认验收中执行。 |
| 负向验证方式 | 移除 poll/session generation、Abort、poll/open 的 authorization mutation 门禁、先验证旧 Token、在清理前恢复 pending、删除 tombstone，或改用 fail-fast 清理，编号测试必须失败。 |
| 明确不覆盖范围 | 不自动输入第三方凭据、不清 App 数据；浏览器 Cookie 不属于 App User API 会话模型。 |

## `REG-XIAOYINSI-006` 父分类搜索丢弃子分类结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-03` |
| 用户症状 | 选择小隐寺父分类后，原站已返回子分类命中，App 却把它们过滤掉，表现为少结果或空结果。 |
| 触发条件 | Discourse `category:` 查询按父分类语义包含子分类；共享本地过滤又按 `categoryId === selectedId` 做精确比较。 |
| 根因 seam | `src/searchFilters.ts` 在服务端筛选之后重复应用了语义不同的共享分类过滤。 |
| 必须保持的行为 | 小隐寺分类由原站查询决定，保留其父/子分类语义；其他来源已有本地过滤契约不变。 |
| 精确失败 oracle | `src/searchFilters.test.ts` 的 `REG-XIAOYINSI-006` 输入父分类 4 和服务端返回的子分类 15，要求结果保留。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性固定来源差异与过滤边界。 |
| Replay 或真实验收路径 | 在小隐寺选择有子分类的父分类搜索，确认子分类结果可见且打开/返回后筛选保持。 |
| 负向验证方式 | 对小隐寺恢复共享 `categoryId` 精确过滤，编号测试必须失败。 |
| 明确不覆盖范围 | 原站分类树当天内容与结果数量属于动态数据。 |

## `REG-XIAOYINSI-007` 登录态被错误当成所有写权限且读取失效不同步

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`ACCOUNT-01`、`ACCOUNT-06`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 用户症状 | 只要 App 已授权，小隐寺关闭或只读主题仍显示回复入口；反过来不能回复时，原站允许的编辑、删除或点赞也一起消失；读取遇到 Token 失效后账号中心仍可能显示已登录。 |
| 触发条件 | UI 和 controller 只检查站点登录态，没有读取 `details.can_create_post`；主题回复权限与逐条 Post 权限共用一个 boolean；Gateway 未复核已认证读取的 401/403。 |
| 根因 seam | `src/localXiaoyinsi.ts` 权限映射、Topic/Reply 操作栏、`topicActionControllerHelpers` 写门禁及 `src/sources/sourceGateway.ts` 会话复核。 |
| 必须保持的行为 | 新回复严格要求登录且 `can_create_post=true`；编辑/删除/点赞按逐条权限独立显示，已点赞仍可取消；已带 Token 的读取遇到 401/403 先用 `/session/current.json` 复核，单主题 403 不直接退出，确认失效才更新账号状态。浏览器 Cookie 不属于 App User API 会话，也不得进入 `cookieSummary` 或任何状态判断。 |
| 精确失败 oracle | `src/app/topicActionControllerHelpers.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`tests/ui/topic-components.test.tsx` 和 `tests/ui/topic-reply-filters.test.tsx` 的 `REG-XIAOYINSI-007` 分别固定数据门禁、单站/聚合复核和用户可见按钮矩阵。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Adapter/gateway/controller 与真实渲染都必须覆盖；只看登录成功或按钮存在会漏掉权限分离。 |
| Replay 或真实验收路径 | 已授权 App 分别打开可回复与只读主题，核对回复入口和逐条操作；验收不查看浏览器登录状态，账号中心身份只以 App `/session/current.json` 为准。 |
| 负向验证方式 | 把 `canWriteXiaoyinsi` 恢复为纯登录态、把逐条操作重新包在回复权限内或移除 Gateway 复核，编号测试必须失败。 |
| 明确不覆盖范围 | 自动测试不固定某个真实主题长期保持关闭或某账号永久拥有编辑/删除权限；真实写入仍需逐次授权。 |

## `REG-XIAOYINSI-008` 回复成功后数量按旧值加一而非服务端总数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`WRITE-01` |
| 用户症状 | 小隐寺回复写入后重新读取了服务器列表，但页面回复总数仍按旧值加一，在旧值过期或分页不完整时继续错误。 |
| 触发条件 | `RepliesResponse` 没有携带 Discourse `post_stream.stream` 的权威总数，controller 只能使用公共启发式。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的回复响应与 `src/app/useTopicController.ts` 的 after-submit 计数合并。 |
| 必须保持的行为 | 小隐寺回复响应返回不含首帖的 `totalCount`；写后刷新优先采用该权威值，其他来源没有该字段时保留既有启发式。 |
| 精确失败 oracle | `src/app/useTopicController.test.ts` 的 `REG-XIAOYINSI-008` 从旧值 100 刷新为服务端 7；`src/localXiaoyinsi.test.ts` 固定 stream 到 `totalCount` 映射。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Adapter 与 controller 两层共同固定，单次 UI 数字无法证明来源权威性。 |
| Replay 或真实验收路径 | 不发送真实回复；只读主题进入、分页与刷新检查服务端总数一致。真实回复永久排除 Agent 自动验收。 |
| 负向验证方式 | 删除 `totalCount` 或强制调用旧值加一，编号测试必须得到 101 并失败。 |
| 明确不覆盖范围 | 不授权真实评论；原站并发新增/删除回复造成的实时变化由下一次权威刷新处理。 |

## `REG-XIAOYINSI-009` 已点赞帖子显示取消入口但控制器拒绝取消

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 小隐寺已点赞帖子显示“取消赞”，点击后却提示当前帖子不能点赞，原站状态没有变化。 |
| 触发条件 | Discourse 对已执行的点赞返回 `acted=true`、`can_act=false`；UI 用 `liked` 正确保留取消入口，但 controller 只看 `canLike=false`。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 把“不能新增点赞”和“不能撤销已有点赞”合并成同一个前置门禁。 |
| 必须保持的行为 | 未点赞且 `can_act=false` 时继续禁止点赞；`liked=true` 时允许发送 DELETE 取消点赞，即使 `can_act=false`；点赞切换先显示目标 optimistic 状态，请求失败恢复原状态，服务端确认后同步目标帖子及活动 route snapshot，不整篇重载。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-XIAOYINSI-009` 使用 `liked=true`、`canLike=false`，要求先应用取消状态、发送一次 DELETE，并在失败路径恢复原点赞状态。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过 controller 门禁和真实请求构造，只验证按钮可见会漏掉点击后的拦截。 |
| Replay 或真实验收路径 | 仅在获得逐次写操作授权时记录初始点赞状态，取消后刷新核对原站，再恢复初始状态。 |
| 负向验证方式 | 把门禁恢复为无条件 `canLike === false`，或移除 optimistic rollback，编号测试必须失败。 |
| 明确不覆盖范围 | 不默认执行真实点赞或取消；没有已点赞对象时不为验收制造远端状态。 |

## `REG-XIAOYINSI-010` 可编辑回复缺少原始 Markdown

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`WRITE-02` |
| 用户症状 | 小隐寺自己的回复显示“编辑”，点击后却无法填入原内容或提示缺少可编辑正文。 |
| 触发条件 | 标准 Discourse `/t/{id}.json` 和 `/t/{id}/posts.json` 默认只返回 cooked HTML；只有已认证请求显式携带 `include_raw=1` 才返回 `raw`。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的 Topic/Posts 读取请求没有把独立 User API 会话与可编辑原文请求绑定，测试夹具又无条件提供 `raw`，掩盖了真实响应差异。 |
| 必须保持的行为 | 只有同时具备小隐寺 User API Key 与 Client ID 的 Topic/Posts 读取添加 `include_raw=1`，并把 `raw` 映射为回复 `contentMarkdown`；匿名公开阅读不请求编辑原文，仍完整显示 cooked HTML。 |
| 精确失败 oracle | `src/localXiaoyinsi.test.ts` 的 `REG-XIAOYINSI-010` 让测试服务端只在收到 `include_raw=1` 时返回 `raw`，要求认证详情、分页回复和楼层读取得到 Markdown，同时匿名请求不带该参数。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过 Adapter 请求构造和响应映射；UI 中只看见“编辑”按钮或给夹具硬编码 `raw` 都不能证明真实编辑链路可用。 |
| Replay 或真实验收路径 | 已授权 App 打开原站允许编辑的本人回复，确认编辑器预填原 Markdown 后取消，不提交任何修改；匿名主题继续只读可见。 |
| 负向验证方式 | 从认证 Topic 或 Posts 请求移除 `include_raw=1`，测试服务端将不返回 `raw`，认证回复的 `contentMarkdown` 断言必须失败。 |
| 明确不覆盖范围 | 不自动执行真实编辑或删除；原站是否长期授予某条回复编辑权限仍由动态权限字段决定。 |

## `REG-XIAOYINSI-012` 点赞、收藏等写操作导致整个主题闪烁重载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02`、`WRITE-03` |
| 用户症状 | 小隐寺点击点赞或收藏后，主题正文和回复整体进入重新加载；回复删除、投票等同类操作也会丢失当前可视上下文。 |
| 触发条件 | User API 写请求已经由服务器确认，但 controller 仍统一调用 `refreshWholeTopic`，而不是复用现有来源的 action-state 与定向回复刷新。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 的小隐寺写后处理绕过 `applyTopicActionUpdate`，把所有 action 都接到整篇 Topic 重读。 |
| 必须保持的行为 | 小隐寺身份与请求继续只走独立 User API Key；点赞/取消和主题书签/取消先显示 optimistic 状态、失败 rollback、确认后同步权威状态；投票在服务器确认后局部更新，删除先本地移除再静默刷新回复切片；均同步活动 route snapshot，不刷新整篇主题。回复与编辑仍沿用既有定向回复刷新。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-XIAOYINSI-012` 分别固定点赞、取消点赞、收藏取消的 optimistic/rollback、投票与删除的局部 action patch，删除还必须只调用 `refreshTopicReplies`；`tests/ui/topic-session-controller.test.tsx` 的 `REG-WRITE-006` 固定活动 route snapshot 同步。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：controller 固定写后路由，Topic session UI 测试固定返回路径不会恢复旧快照；只验证 HTTP 成功无法发现整页重载。 |
| Replay 或真实验收路径 | 获得逐次可恢复写操作授权后，记录初态并切换一次点赞或收藏，确认正文、回复列表和滚动上下文不进入整页 Loading，刷新核对原站后恢复初态。投票、编辑和删除不因本条默认获得真实写入授权。 |
| 负向验证方式 | 把任一小隐寺 action 恢复为 `refreshWholeTopic`、移除对应 `applyTopicActionUpdate`，或让点赞/书签失败后保留目标状态，编号 controller 测试必须失败。 |
| 明确不覆盖范围 | 不把小隐寺接入任何 Cookie/WebView 登录；只对可恢复的点赞/书签做可回滚 optimistic 展示，投票、删除和权限不得乐观推断或伪造。 |

## `REG-XIAOYINSI-013` 已授权小隐寺缺少等级入口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-06` |
| 用户症状 | 账号中心已能识别小隐寺用户并显示 `Lv`，但站点服务区没有“小隐寺 等级”，无法查看等级进度和活跃数据。 |
| 触发条件 | 新来源只向账号中心注入 Device Code 授权面板，没有接入项目已有的 Discourse 等级展示；个人主页的等级标签只能表达当前级别。 |
| 根因 seam | `src/screens/MoreScreen.tsx` 的小隐寺 `siteContent`、`src/app/useXiaoyinsiAuthController.ts` 的 User API 读取状态和 `src/localXiaoyinsi.ts` 的当前用户 summary 转换。 |
| 必须保持的行为 | 已授权小隐寺显示独立等级入口，通过保存的 User API Key 读取 `/session/current.json` 与当前用户 summary；只共享等级展示和纯转换，不读取 linux.do Cookie、Connect 或浏览器状态。未授权时明确引导 Device Code 授权。 |
| 精确失败 oracle | `tests/ui/more-screen.test.tsx` 固定已登录小隐寺站点服务区存在等级入口；`tests/ui/xiaoyinsi-auth-controller.test.tsx` 固定 SecureStore 凭据路由；`src/localXiaoyinsi.test.ts` 固定 User API headers、两个端点和等级/活跃数据映射。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Adapter 固定独立传输，controller 固定状态，RNTL 固定真实入口。 |
| Replay 或真实验收路径 | `tests/device/more-readonly.ad` 在保留小隐寺授权的设备选中站点，点击“查看等级”并等待“等级进度”；不得清数据或打开浏览器登录。 |
| 负向验证方式 | 移除小隐寺 `siteContent` 的等级菜单、改用无 User API headers 的 fetch，或把 controller 改读 linux.do Cookie，编号测试必须失败。 |
| 明确不覆盖范围 | 小隐寺没有 linux.do Connect 服务，因此展示基于当前站 summary 的 Discourse 参考进度；不伪装成原站官方晋级判定。 |

## `REG-XIAOYINSI-014` 小隐寺等级入口被授权管理淹没

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-06` |
| 用户症状 | 已授权小隐寺虽然存在等级入口，但它位于长授权说明之前，与重新授权和撤销授权挤在一起，主次不清，用户不容易识别。 |
| 触发条件 | 小隐寺账号卡片同时显示主页、授权原理、授权操作和等级服务；新增等级时只按接线顺序插入，没有按稳定使用频率和风险重新分组。 |
| 根因 seam | `src/screens/MoreScreen.tsx` 的小隐寺 `siteContent` 顺序，以及 `src/screens/more/XiaoyinsiAuthPanel.tsx` 在已授权状态仍展示完整授权引导。 |
| 必须保持的行为 | 已授权账号顶部保留身份与主页，中部以简短说明承载重新授权和撤销授权，底部用分隔线独立显示“查看等级”；展开后仍读取等级进度和活跃数据。未授权、授权中和清理状态继续显示完整 Device Code 或清理说明。 |
| 精确失败 oracle | `tests/ui/more-screen.test.tsx` 的 `REG-XIAOYINSI-014` 固定已授权文案、授权操作先于“查看等级”的渲染顺序，以及点击后仍调用等级刷新。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染真实账号中心并检查用户可见顺序；源码字符串或单独测试等级请求无法证明入口层级。 |
| Replay 或真实验收路径 | `tests/device/more-readonly.ad` 在保留授权的设备进入小隐寺账号卡片，从底部“查看等级”展开并等待“等级进度”；不得撤销或重建授权。 |
| 负向验证方式 | 把等级菜单移回授权面板之前，或在已授权状态恢复完整一次性授权引导，编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不改变 Device Code、User API Key、Keystore、会话失效或等级计算；未授权流程仍保留完整安全说明。 |

## `REG-XIAOYINSI-015` 小隐寺最新与热门复用同一非空列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 小隐寺“最新”已加载出主题后切换“热门”，页面继续显示最新列表且不发热门请求；反向切换也可能复用旧列表。 |
| 触发条件 | 同一小隐寺分类已有非空 Feed state，再切换 latest/hot 或其他来源筛选；控制器用请求 key 判断是否可复用。 |
| 根因 seam | `src/feedLogic.ts` 的 `feedRequestKey` 只把 linux.do、V2EX 和 NodeSeek 的筛选写入请求身份，漏掉已经拥有独立排序的小隐寺；后续 `shouldReuseFeedStateForRequest` 因而把两个筛选误判为同一请求。 |
| 必须保持的行为 | 小隐寺来源、分类或列表筛选任一变化都必须产生独立请求身份；切换后回到首项并读取目标筛选，旧请求不得覆盖；其他来源现有复用规则不变。 |
| 精确失败 oracle | `src/feedLogic.test.ts` 的 `REG-XIAOYINSI-015` 先建立同来源同分类但 latest/hot 不同的请求 key，修复前错误返回可复用；`tests/ui/feed-controller-xiaoyinsi.test.tsx` 使用非空响应，依次选择 hot 和 new-replies，要求 Gateway 收到各自真实筛选。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定请求 key 与状态复用规则，`UI_PASS` 固定非空真实 controller 生命周期；只测菜单常量或空列表会绕过复用分支，不能拦住本缺陷。 |
| Replay 或真实验收路径 | 在当前身份匹配的 debug App 中进入小隐寺，先等待“最新”首条可见，再切“热门”及一个“新”筛选，等待列表重新 ready 并打开首条；全程只读，不固定动态标题或数量。 |
| 负向验证方式 | 从 `feedRequestKey` 的筛选来源集合移除 `xiaoyinsi`，编号单元测试会得到相同 key，非空 controller 用例不会发出后续筛选请求。 |
| 明确不覆盖范围 | 不保证原站各筛选当天都有非空主题；未授权 `/new.json` 可能要求登录，该动态权限结果由 Live 验收记录，不用假数据降级成 latest。 |

## `REG-XIAOYINSI-016` 小隐寺标签候选携带 limit 后固定失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-03`、`SEARCH-04` |
| 用户症状 | 小隐寺高级搜索能打开分类候选，但进入“标签”只显示“标签候选加载失败”，点击重试仍失败。 |
| 触发条件 | App 请求小隐寺 `/tags/filter/search` 时沿用 linux.do 的 `limit=8` 参数；当前原站对任意 `limit` 返回 HTTP 400“Limit 无效”。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的 `searchXiaoyinsiTags` 复制了另一 Discourse 站点的候选请求参数，没有按本站真实端点契约分离传输差异。 |
| 必须保持的行为 | 小隐寺标签候选继续携带本站独立 User API 凭据、查询、分类和已选标签，但不发送原站拒绝的 `limit`；Adapter 在解析、去重后按调用方上限本地截断。linux.do 请求不变。 |
| 精确失败 oracle | `src/localXiaoyinsi.test.ts` 的 `REG-XIAOYINSI-016` 在请求含 `limit` 时返回同原站一致的 400，并返回多于调用方上限的成功样本；要求最终请求无 `limit` 且只保留指定数量。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定站点参数差异与本地上限；`DEVICE_REPLAY_PASS` 固定真实标签选择器至少出现一个 checkbox 候选。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 在小隐寺单站打开筛选与标签选择器，等待任一真实标签 checkbox 后关闭；不固定动态标签名、数量或搜索结果。 |
| 负向验证方式 | 给 `searchXiaoyinsiTags` 恢复 `limit` 查询参数，编号单元测试会收到 400，设备 Replay 会停在标签候选错误态。 |
| 明确不覆盖范围 | 不修改、创建或删除原站标签；当天候选名称与计数属于动态数据。 |

## `REG-XIAOYINSI-017` 小隐寺回应表情被渲染成英文文字

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`WRITE-01` |
| 用户症状 | 小隐寺主题和评论下方把回应显示成 `heart 49`、`+1 4`、`distorted face 2` 等英文文字，而原站显示对应 emoji 图片；回复编辑器也没有原站表情目录入口。 |
| 触发条件 | 小隐寺 Topic API 返回 `reactions[]`，或用户打开小隐寺回复编辑器；正文/评论 `cooked` 中的 `<img class="emoji">` 仍可能单独正常显示。 |
| 根因 seam | `src/linuxdoReactions.ts` 同时承担通用 Discourse reaction 和 linux.do 站点资源，通用分支刻意丢弃图片 URL；表情目录只由 `localLinuxdo` 读取，页面与编辑器因此无法取得小隐寺自己的 `/emojis.json`。 |
| 必须保持的行为 | 每个 Discourse adapter 独立读取并缓存本站 `/emojis.json`，公共 reaction presenter 只消费当前来源的 name→URL；主题和回复均显示本站 emoji 图片及计数，未知 id 才回退成可读文字。切换站点时旧目录不得短暂泄漏。小隐寺正文和评论里的 `cooked <img class="emoji">` 继续按 inline 图片渲染；编辑器插入原站接受的 `:name:`，不发送评论。linux.do 的 boost 仍是其站点特性。 |
| 精确失败 oracle | `src/discourseReactions.test.ts` 用原站 `heart/+1` URL 固定 reaction 图片映射；`src/localXiaoyinsi.test.ts` 固定 `/emojis.json` 与本站绝对 URL；`tests/ui/topic-components.test.tsx` 要求小隐寺只读回复实际渲染两张 reaction 图片；`tests/ui/reply-composer.test.tsx` 要求小隐寺表情入口插入 `:waving_hand:`；`src/htmlImages.test.ts` 固定真实评论 emoji 仍走 inline 图片。 |
| 最低可靠自动测试层 | 数据目录与映射使用 `UNIT_PASS`，reaction 图片与编辑器入口使用 `UI_PASS`；真实资源加载、主题与评论的视觉结果使用 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 直达 `https://forum.xiaoyinsi.com/t/topic/9`：首帖应以图片显示 heart、+1、distorted_face 及计数；回复 #2 同样显示多种图片；回复 #7 的 waving_hand 应在正文行内显示；只打开编辑器检查“表情”目录和插入草稿，不发送。 |
| 负向验证方式 | 让小隐寺继续调用无目录参数的 `discourseReactionStats`、把 emoji reader 只注册给 linux.do，或从小隐寺 toolbar 移除 `discourse-emoji`，对应编号测试必须失败。 |
| 明确不覆盖范围 | 不点赞、不发送真实评论；表情目录名称和数量可随原站变化，不固定完整列表或 CDN 版本。 |

## `REG-XIAOYINSI-018` 小隐寺搜索命中回复时把回复者显示为楼主

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 用户症状 | 小隐寺搜索卡片把命中回复的用户显示为主题作者；打开详情后才看到真实楼主是另一人。 |
| 触发条件 | `/search.json` 的 `posts[]` 返回命中的回复；`topics[].posters` 可能提供 Original Poster，也可能完全缺失作者身份。 |
| 根因 seam | `src/localXiaoyinsi.ts` 的 `topicsFromSearch` 优先把命中帖子传给主题归一化，覆盖了主题自己的 Original Poster。 |
| 必须保持的行为 | 搜索作者优先取主题 Original Poster；仅当命中帖明确为 `post_number=1` 时才可作为后备。命中帖继续提供摘要；缺少可靠 OP 时不得用回复者或最后回复者猜测。 |
| 精确失败 oracle | `src/localXiaoyinsi.test.ts` 的 `REG-XIAOYINSI-018` 同时提供两个二楼命中：bob 的主题有 alice 这个 Original Poster，要求结果显示 alice 且保留 bob 的命中摘要；另一个主题没有可靠 OP，要求整项丢弃而不是显示回复者或最后回复者。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Adapter 公开搜索接口可固定原站载荷与归一化结果；源码字符串、页面可打开或动态标题不能证明作者正确。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 保持小隐寺搜索入口可用；作者正确性需在 App 内打开一个命中回复的结果，对照详情或原站楼主，记录为 `LIVE_PASS`。 |
| 负向验证方式 | 恢复命中帖子优先级后，编号测试会把作者从 alice 错误改为 bob 并失败。 |
| 明确不覆盖范围 | 不根据作者名、最后回复者或回复顺序猜测 OP；动态搜索结果当天是否存在由 Live 验收记录。 |

## `REG-XIAOYINSI-019` Token 已保存但首次 session 复核失败后重复发起授权

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-06` |
| 用户症状 | Device Code 已授权且 Token 已安全保存，但紧接着的 `/session/current.json` 遇到一次普通网络失败后，用户点击重试却被要求重新生成验证码并再次授权。 |
| 触发条件 | poll 返回 authorized 并持久化凭据后，首次 session 复核发生非 401/403 的暂时错误；控制器进入 error，重试入口直接创建新的 Device Code。 |
| 根因 seam | `src/app/useXiaoyinsiAuthController.ts` 的授权完成复核与 error 状态重试路由。 |
| 必须保持的行为 | error 状态下开始授权时，先用已保存的 User API Key 和 Client ID 重试 session；成功则恢复现有授权，普通复核失败继续留在可重试错误态；凭据不存在或明确 401/403 失效时才进入新的 Device Code 流程。 |
| 精确失败 oracle | `tests/ui/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-019` 固定 poll 已授权、凭据已保存、首次 session 网络失败、用户重试后第二次 session 成功且没有再次调用 begin authorization。 |
| 最低可靠自动测试层 | `UI_PASS`：hook 生命周期测试同时固定持久化、重试入口和最终用户可见状态；仅测试底层 session client 不能证明不会重复授权。 |
| Replay 或真实验收路径 | 更多 → 账号中心 → 小隐寺；若授权完成后的 session 恰遇暂时网络错误，恢复网络后点重试，应直接显示现有账号，不打开新的授权页。 |
| 负向验证方式 | 删除 error 分支的现有凭据恢复后，编号测试会发现 begin authorization 被再次调用且 session 只复核一次。 |
| 明确不覆盖范围 | 不人为中断真实授权或网络制造该状态；真实 Google / Discord 登录仍只由用户操作。 |

## `REG-XIAOYINSI-020` 重授权终止后的暂时复核失败清空可信会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-06`、`MORE-02` |
| 用户症状 | 用户拒绝、取消或等待到重新授权过期后，旧授权复核恰遇普通网络失败，账号中心会把仍可能有效的旧会话清成“已拒绝/已取消/已过期”。 |
| 触发条件 | `restoreExistingAuthorization` 用 `null` 表示暂时检查失败，但重授权各终止分支把所有非 true 返回都当作已确认无有效旧授权。 |
| 根因 seam | `useXiaoyinsiAuthController` 的重授权终态与旧凭据 tri-state 复核边界。 |
| 必须保持的行为 | true 恢复旧授权，false 只在明确无凭据或 401/403 失效时进入拒绝/取消/过期终态，null 保留 `check-failed` 和上次可信会话并提供重试；不得随后 dispatch `cleared` 覆盖。 |
| 精确失败 oracle | `tests/ui/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-020` 固定重新授权被拒绝后旧 Token 复核普通失败，要求最终为 error/check-failed 且没有 cleared 覆盖。 |
| 最低可靠自动测试层 | `UI_PASS`：必须跨越 poll 终态、旧 session 复核和 SiteSessionState dispatch；单测 tri-state helper 不能证明消费方没有折叠 null。 |
| Replay 或真实验收路径 | 不主动拒绝真实授权或断网制造组合状态；正常重新授权、取消和返回路径保持可用，异常组合由确定性 UI 测试固定。 |
| 负向验证方式 | 把任一终止分支恢复为 `if (await restore...)` 的二值判断，编号测试应回退到 denied/cleared。 |
| 明确不覆盖范围 | 不把暂时失败声明成授权有效，也不阻止明确 401/403 后重新授权。 |

## `REG-XIAOYINSI-021` 写操作授权复核失败覆盖原始错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-06`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 小隐寺回复或互动收到需要复核授权的 403 后，如果 `/session/current.json` 复核本身又遇到普通失败，动作 Promise 直接抛出复核异常，原始“没有权限执行该操作”被覆盖，编辑器或 optimistic 队列只能看到错误的恢复原因。 |
| 触发条件 | Discourse action runtime 的 `recover()` 直接 await 授权刷新，controller catch 内没有第二层恢复失败边界。 |
| 根因 seam | `src/app/discourseActionRuntime.ts` 的授权复核与 `src/app/useTopicActionsController.ts` 的动作失败收口。 |
| 必须保持的行为 | 授权复核失败不得从动作 controller 逃逸，也不得替换原始写操作错误；用户仍看到原始错误并明确获知授权状态复核未完成，动作保持失败且 optimistic 状态回滚。明确 login-required 时仍走登录提示。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-XIAOYINSI-021` 让写操作返回需复核的 403、授权刷新再抛错，要求提交 Promise 正常收口，提示同时包含原始操作错误和“复核未完成”。 |
| 最低可靠自动测试层 | `UNIT_PASS`：controller 行为测试必须跨过 action client、runtime recovery 与最终提示；单测授权刷新函数不能证明原始错误未被覆盖。 |
| Replay 或真实验收路径 | 不通过真实写操作或断网制造组合失败；只读确认小隐寺写入口权限显示，组合异常由确定性测试固定。 |
| 负向验证方式 | 恢复 catch 内直接 `await runtime.recover(error)`，编号测试会收到 rejected Promise 或只看到复核异常。 |
| 明确不覆盖范围 | 不把 403 自动判定为全局退出，不伪造授权有效，也不授权任何真实回复、点赞、书签或投票。 |

## `REG-SEARCH-001` linux.do 高级筛选接受任意文本或旧候选污染新查询

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-03`、`SEARCH-04` |
| 用户症状 | linux.do 标签和发帖人原本是可任意手输的文本框，可能提交站点不存在的值；快速改词时旧候选或旧 AI 响应还可能覆盖当前查询，分页或详情返回后筛选也可能退回浅拷贝中的旧数组。 |
| 触发条件 | 标签/作者未经过原站候选接口；300ms 防抖请求先发后到；提交快照只浅拷贝数组；新查询、筛选、排序或来源变化时未取消并失效 AI 请求。 |
| 根因 seam | `src/screens/SearchScreen.tsx` 的候选草稿交互、`src/app/useSearchController.ts` 的普通/AI 请求归属、`src/searchControllerResults.ts` 的深快照和合并、`src/localLinuxdo.ts` 的候选接口。 |
| 必须保持的行为 | 分类、标签和发帖人只能从站点候选选择；双标签可选任意/全部；旧标签、作者或 AI 响应不得改变新查询。已应用数组在第一页、普通分页和详情返回中保持独立快照。AI 开关只读当前查询的缓存，普通顺序优先并按话题 ID 去重；关闭不重复请求。 |
| 精确失败 oracle | `tests/ui/search-screen.test.tsx` 断言页面没有自由标签/作者提交入口、只接受候选，并让旧标签 Promise 晚于新 Promise 完成后仍只显示新候选；`tests/ui/search-controller-ai.test.tsx` 让旧 AI Promise 晚到，断言新查询状态、去重顺序、开关缓存和普通分页不被污染；`src/app/useSearchController.test.ts` 修改原草稿数组后要求已提交快照不变。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 token、深快照、Gateway 和合并规则；`UI_PASS` 固定防抖、过期响应、草稿、并发和用户可见标识。只有源码字符串、App 可启动或单次 Live 成功都不能证明请求竞争安全。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 先检查 linux.do 候选筛选入口和 AI 入口，再执行真实查询、打开详情并返回；Live 在保留登录态的 App 内验证双标签、作者、状态、日期、范围、专家回应、普通分页和 AI 开关，不固定动态标题或数量。 |
| 负向验证方式 | 临时移除候选 request ID/Abort 保护、把标签恢复为文本输入、让快照复用原数组，或将 AI 结果直接替换普通结果；相应用例必须精确失败，随后还原。 |
| 明确不覆盖范围 | 原站“话题/帖子”与“类别/标签”结果类型切换仍不在当前话题结果模型范围；第三方客户端的 RRF 融合不属于本产品契约。 |

## `REG-SEARCH-002` 分页失败隐藏已有结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 搜索第一页已有可打开结果时，继续加载失败会把整个来源的旧结果隐藏，只留下来源错误；用户既无法继续阅读，也无法确认重试的是失败页。 |
| 触发条件 | 任一单站连续列表已持有非空 `items`、`hasMore=true` 和 `nextPage`，随后该页请求失败并写入 `group.error`。 |
| 根因 seam | `src/app/useSearchController.ts` 在分页异常时虽合并回旧 `items`，却把 `hasMore/nextPage` 覆盖为结束态，验证完成回调还会重跑整来源；`src/searchListItems.ts` 遇到任何 `group.error` 都提前 `continue`，`src/screens/SearchScreen.tsx` 的错误按钮也统一重跑整来源。 |
| 必须保持的行为 | 首屏错误继续显示来源级错误并重试整来源；已有结果后的分页错误保留全部旧结果，在单站列表尾部显示错误并只重试原 `nextPage`。自动分页只在单站用户滚动后触发，一次手势最多一页；“全部”只显示每来源最多 2 条预览且不生成分页入口；失败后不自动重试。 |
| 精确失败 oracle | `src/searchListItems.test.ts` 的 `REG-SEARCH-002` 断言单站分页错误依次生成旧 topic 和尾部 error、没有来源分组标题，同时首屏部分失败仍只走来源错误；`tests/ui/search-screen.test.tsx` 固定两类错误的可见结果和重试路由，并覆盖初始渲染、重复 viewability、忙碌、末页及查询/来源/滚顶变化；同文件另固定“全部”最多 2 条预览且无分页哨兵。`tests/ui/search-controller-ai.test.tsx` 让真实第二页请求失败，断言控制器保留失败页 cursor、普通重试和 NodeSeek 验证回调都再次请求原页。修复前控制器把 `nextPage` 清空，UI 注入的可重试状态无法由真实链路产生。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定概览/单站模式和首屏/分页错误的列表构建顺序；`UI_PASS` 固定真实控制器 cursor、用户可见旧结果、非点击哨兵、滚动触发和两类重试路由。源码字符串或单次 Live 成功不能证明 viewability 回调竞争安全。 |
| Replay 或真实验收路径 | `tests/device/search-topic-user-return.ad` 与 `tests/device/search-multi-source.ad` 固定“全部”预览进入单站、搜索、详情和返回链；单站自动分页由确定性 RNTL 固定成功、末页、重复可见和失败保留结果，Live 在保留 Cookie 的 App 内分别验证已登录 NodeSeek、临时匿名 fallback 和真实单站下滑续页。“全部”不得出现分页入口。动态来源不要求当天必须存在第二页，也不强制制造真实分页失败。 |
| 负向验证方式 | 临时恢复 `group.error` 的无条件提前返回，或让分页错误按钮调用 `onRetrySearchSource`，`REG-SEARCH-002` 的列表/UI 用例必须分别失败；临时移除 arm 或 pending 门禁，重复回调用例必须失败；给“全部”恢复分页哨兵时概览用例必须失败，随后还原。 |
| 明确不覆盖范围 | 不改四站搜索 API、Cookie Mock、SourceGateway、筛选快照、去重、重复页或 request ownership；不预取整站、不自动重试失败请求，也不固定动态第二页的标题或数量。 |

## `REG-SEARCH-003` linux.do 搜索作者和头像丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03` |
| 用户症状 | 已登录 linux.do 搜索的每条结果都显示“未知作者”，头像也不展示；标题、摘要和详情仍可用。 |
| 触发条件 | 标准 Discourse `/search.json` 返回 `topics[]` 与 `posts[]`，作者位于匹配 post 的 `username/avatar_template`，而 topic 没有列表页专属的 `posters`，`users[]` 为空。 |
| 根因 seam | `src/localLinuxdo.ts` 的 `topicsFromLinuxDoSearchData` 已按 `topic_id` 找到匹配 post，却只读取其 `blurb`；作者仍调用列表页的 `originalPoster(topic, users)`，因此被归一化为空。普通搜索和 AI 语义搜索共用该转换层。 |
| 必须保持的行为 | 搜索结果优先使用匹配 post 的用户名和头像；响应没有匹配 post 时继续使用原有 `topics[].posters → users[]` fallback。不得为每条结果新增用户请求，也不得改变搜索顺序、摘要、分页或登录态。 |
| 精确失败 oracle | `src/localSources.test.ts` 的 `REG-SEARCH-003` 使用 `topics[]` 无 `posters`、`users[]` 为空且 `posts[]` 含 `username/avatar_template` 的标准响应，断言最终 Topic 保留作者和绝对头像 URL。修复前同一用例得到空作者和 `undefined` 头像。 |
| 最低可靠自动测试层 | `UNIT_PASS` 直接覆盖真实 `searchTopics → searchLinuxDo → topicsFromLinuxDoSearchData` 链路；只测 `TopicCard` fallback、源码字符串或详情页作者都不能证明搜索字段已正确转换。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 固定已登录 linux.do 搜索、详情和返回链；Live 在 App 内已登录状态检查普通搜索首屏至少一条结果同时显示非“未知作者”的作者和头像，不导出或删除 Cookie。AI 当前有结果时沿同一标准检查，不把 AI 零结果当失败。 |
| 负向验证方式 | 临时把搜索作者数据恢复为只调用 `originalPoster(topic, users)`，`REG-SEARCH-003` 必须精确失败，随后还原。 |
| 明确不覆盖范围 | 临时匿名 Google fallback 的结果本来不含可靠作者字段，本条不新增抓取或逐帖补全；不改变 Feed、Topic 或 User 页作者解析。 |

## `REG-LINUXDO-001` linux.do Cloudflare 429 被降级且大响应被截断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | linux.do 实际要求 Cloudflare 验证时，直连已识别为 `verification-required`，隐藏 WebView 却把主文档 429 提前报成普通未知错误；偶尔挑战后已得到 200，又因正文固定截断为 12,000 字符而 JSON 解析失败。 |
| 触发条件 | 可信 CF header/body 触发隐藏 WebView fallback；Android WebView 先回调主文档 `onHttpError(429)`、随后仍完成页面或跳转到 200；成功 JSON 大于 12 KB。 |
| 根因 seam | `src/linuxdoFetchFallback.ts` 的 CF 分类、`src/app/HiddenBrowserHost.tsx` 的主文档生命周期、`src/app/useHiddenBrowserFetchController.ts` 的 bridge 序列化，以及 `src/app/useSessionController.ts` 的最终 Response/typed error 结算。 |
| 必须保持的行为 | 只有可信 CF 特征才能触发验证，普通 429 原样返回；主文档 HTTP error 只记录并继续等待最终 DOM，子资源错误忽略，新导航清除旧状态。合法正文在 900 KB bridge 上限内完整往返，超限明确返回 `content-too-large` 且不得伪装成 CF；直连已确认 CF 而 renderer/脚本无法复核时保持 typed CF 结论。 |
| 精确失败 oracle | `src/localSources.test.ts` 的 `REG-LINUXDO-001` 分别固定普通 429 不进入 WebView、已确认 CF 后 renderer 失败仍为 typed CF、挑战导航后的普通 429 保持 429；`src/nodeseekBrowserFetchScript.test.ts` 固定超过 12 KB JSON 精确往返和超 bridge 上限的非 CF 显式失败；`tests/ui/hidden-browser-host.test.tsx` 固定 429 不提前失败及新主文档清除旧状态；`src/app/sessionControllerHelpers.test.ts` 固定 challenge 无伪造 403 Response。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定分类、序列化、Response 与 typed error 契约；`UI_PASS` 固定 RNC WebView 事件顺序。只有源码字符串、普通页面成功或单次 Cookie 保存不能证明 Android 429 challenge 链路。 |
| Replay 或真实验收路径 | 只在 App 内自然出现 linux.do challenge 时，从单站 Feed/Search/Topic/User 读取进入 overlay，完成验证并观察原读取恢复；不得清 App 数据、Cookie 或登录态制造 challenge。无法自然触发时记 `NOT_VERIFIED` 或 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 临时恢复 LinuxDo 正文 `.slice(0, 12000)`、在 `onHttpError(429)` 直接 fail、把 bridge 超限标成 `challenge: true`，或让普通 429 触发 fallback；对应 `REG-LINUXDO-001` 用例必须精确失败，随后还原。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不保证原站当天出现 challenge，也不把普通 Rate Limiting 429 当作验证成功或失败；大于 bridge 上限的响应不做分片扩展。 |

## `REG-LINUXDO-002` linux.do 验证关闭重开并无限循环

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | 读取触发验证后，面板没有自动检测和保存新 Cookie；用户关闭后原 Topic 被重新打开，又立即命中 CF 并再次打开验证，形成 close/reopen 循环。 |
| 触发条件 | 可见 WebView 得到 clearance，但恢复逻辑由 pending Topic、dismissed key、verified retry 和 `InteractionManager` 关闭后导航共同驱动；Cookie 保存被误当成原读取成功，或旧 WebView 消息在关闭后回流。 |
| 根因 seam | `src/app/useVerificationController.ts` 的验证生命周期和 Cookie generation、各前台 read controller 的请求 snapshot/ownership、`src/app/useSessionController.ts` 的隐藏 Cookie 事件语义。 |
| 必须保持的行为 | 验证 overlay 覆盖当前页面；clearance 候选先持久化，再在 overlay 仍可见时精确 `resume()` 原 Feed/Search/Topic/User 首屏或分页。只有原读取不再返回 CF 才关闭；仍为 CF 时保持打开且不 remount、不递归弹窗、不自动二次重试，用户可点“检测状态”再次尝试。用户关闭取消 recovery 并忽略迟到事件，同一失败链路绝不自动重开；Account 手动入口只更新 Cookie 状态并保持打开。聚合、后台 AI/预取和写操作不自动弹出或重放。 |
| 精确失败 oracle | `src/app/useVerificationController.test.ts` 固定自动恢复仅一次、恢复期间面板可见、仍为 CF 时保持打开、显式检测可再试、same-value clearance 在已确认清除后可进入最终原读 oracle、成功后才发送 `verification-succeeded` 并关闭，以及用户关闭、closing latest-wins、迟到检查和 recovery supersede 隔离；`src/app/useFeedController.test.ts`、`tests/ui/search-controller-ai.test.tsx`、`src/app/useTopicController.test.ts`、`src/app/useUserController.test.ts` 固定首屏、Feed 页码/cursor、Topic 回复刷新/分页和 User 双 cursor 的原请求 recovery/suppress；`src/localSources.test.ts` 固定非 GET 写请求不得进入隐藏 WebView；`src/app/sessionControllerHelpers.test.ts` 固定隐藏读取只能发送 `cookie-loaded`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定状态机、request ownership、snapshot 和 Cookie 事件；`UI_PASS` 固定 Search 与隐藏 WebView 交互。源码字符串、拿到 `cf_clearance`、Modal 已关闭或 App 可启动都不能证明恢复成功。 |
| Replay 或真实验收路径 | challenge 自然出现时，在单站前台读取完成验证：原页面和已有列表保持，原请求只恢复一次，overlay 只关闭一次且不重开；Account 手动入口检测后保持打开。无法自然触发时明确记 `NOT_VERIFIED`，不得用普通页面冒充。 |
| 负向验证方式 | 临时让 Cookie 保存直接关闭面板、恢复旧 pending Topic/close settle 导航、移除 suppress，或把恢复仍为 CF 当成功；`REG-LINUXDO-002` 的状态机和 controller 用例必须失败，随后还原。 |
| 明确不覆盖范围 | 不自动重放发帖、回复、点赞、投票、收藏等写操作；不新增持久化 schema、feature flag 或外部 API；聚合来源和后台任务保持局部失败。 |

## `REG-LINUXDO-003` 验证后的原页面恢复失败却提示成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01` |
| 用户症状 | linux.do 验证 Cookie 已保存，但原 Feed/Search/Topic/User 请求随后遇到普通网络或解析失败时，overlay 仍提示“页面已恢复”并关闭；写成功后的回复刷新也会被诊断为完整成功。 |
| 触发条件 | read recovery 的返回值只有 completed/verification-required/stale，controller 在普通 catch 或来源错误分支默认返回 completed；引用帖和写后刷新还丢失了显式失败结果。 |
| 根因 seam | `LinuxDoReadResumeOutcome`、四类 read controller、引用帖恢复以及 `useVerificationController`/`useTopicActionsController` 对恢复终态的消费边界。 |
| 必须保持的行为 | `completed` 只表示原读取已经成功应用；普通网络、来源或解析失败必须返回 `failed`。验证面板在 failed 时保持打开并提示用户显式重试，不发送 verification-succeeded；写请求本身已成功但跟随刷新失败时保持写成功结果，同时把诊断终态记为 `partial/refresh_failed`。 |
| 精确失败 oracle | `src/app/useVerificationController.test.ts` 固定 failed recovery 不关闭面板；`src/app/useFeedController.test.ts` 固定普通恢复失败返回 failed；`src/app/useTopicController.test.ts` 固定引用帖失败精确传播；`src/app/useTopicActionsController.test.ts` 固定写后 failed refresh 记录 partial；Search/User 既有 recovery 用例覆盖相同 union。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：状态机、controller 返回值和写后诊断必须共同固定；仅保存到 `cf_clearance` 或看到请求结束不能证明原页面已恢复。 |
| Replay 或真实验收路径 | 只在自然 challenge 出现时完成验证；若原读取随后普通失败，overlay 应保留并允许“检测状态”重试，原列表/详情不被假成功覆盖。写操作不为制造该状态执行。 |
| 负向验证方式 | 把任一普通失败分支恢复为 completed，或让 verification controller 在 failed 时 dispatch success，编号测试必须关闭面板或错误记录 success 并失败。 |
| 明确不覆盖范围 | 不自动重放写操作，不人为断网或清 Cookie 制造 challenge；无法自然触发时设备证据记 `NOT_VERIFIED`。 |

## `REG-ACCOUNT-001` 身份读取失败覆盖已确认账号状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 用户症状 | NodeSeek、linux.do 或妖火网站登录仍可能有效，但刷新账号状态时身份接口暂时失败，账号中心却把上次已确认的用户名清空并显示成新的 Cookie 状态。 |
| 触发条件 | Cookie/登录检查成功后，当前用户资料读取 rejection 或返回未知；controller 先记录 failed site，随后仍 dispatch `cookie-loaded` 且 `currentUser=null`。 |
| 根因 seam | `useAccountStatusController` 的站点检查终态与 `SiteSessionState` 的可信身份保留契约。 |
| 必须保持的行为 | 身份检查失败必须 dispatch `check-failed`，保留上次可信状态和用户，仅更新错误提示；只有身份检查确实完成时才能发送 `cookie-loaded`。刷新整体以 partial 结束并准确列出失败站点。 |
| 精确失败 oracle | `src/app/useAccountStatusController.test.ts` 分别固定 NodeSeek、linux.do、妖火身份读取失败，要求出现 `check-failed`、禁止同站 `cookie-loaded`，并保持其他站点继续完成。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须覆盖 controller dispatch 序列；只测 reducer 的 `check-failed` 或 UI 最终文案无法证明失败事件没有被随后成功事件覆盖。 |
| Replay 或真实验收路径 | 不主动破坏真实身份接口；账号中心正常刷新继续核对四站状态。自然遇到单站失败时，旧身份应保留并显示检查失败，其他站照常更新。 |
| 负向验证方式 | 在身份失败分支重新 dispatch `cookie-loaded`，编号测试必须发现同站错误终态被成功事件覆盖。 |
| 明确不覆盖范围 | 不把旧身份当作本次网络已验证的身份，也不通过退出登录、清 Cookie 或改凭据制造失败。 |

## `REG-ACCOUNT-002` 单站凭据读取失败阻断全部账号刷新

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 用户症状 | NodeSeek、linux.do 或妖火任一 SecureStore 读取暂时失败时，“刷新账号状态”直接整体中止，其余站点状态全部停留在检查中。 |
| 触发条件 | 三个凭据 loader 在站点检查的 `Promise.allSettled` 之前顺序 await；任一 rejection 从公共刷新函数向外抛出。 |
| 根因 seam | `useAccountStatusController` 的多站凭据装配、站点隔离和诊断终态。 |
| 必须保持的行为 | 三站凭据读取相互隔离并与站点检查一起收敛；失败站 dispatch `check-failed` 且记录 store error，其余站仍完成状态和身份更新；公共刷新只报告失败站并以 partial 结束。 |
| 精确失败 oracle | `src/app/useAccountStatusController.test.ts` 让 NodeSeek 凭据 loader rejection，要求 linux.do 和妖火仍 dispatch `cookie-loaded`、NodeSeek dispatch `check-failed`，且提示只列 NodeSeek。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须故障注入真实 controller 的异步装配顺序；单独测 SecureStore helper 或 `Promise.allSettled` 无法证明页面不会卡在 checking。 |
| Replay 或真实验收路径 | 不破坏设备 SecureStore；正常账号中心刷新覆盖成功路径，存储故障只由确定性测试验证。 |
| 负向验证方式 | 把任一凭据 loader 恢复为站点任务外的直接 await，编号测试必须在其他站 dispatch 前收到 rejection。 |
| 明确不覆盖范围 | 不清理、迁移或重建真实凭据，也不把失败站当作未保存凭据继续匿名检查。 |

## `REG-ACCOUNT-003` 启动时单站凭据读取失败阻断其他会话恢复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | App 启动时只要 NodeSeek、linux.do 或妖火任一安全存储读取暂时失败，其他站已经保存的有效会话也不会恢复，账号中心可能一直显示初始匿名状态。 |
| 触发条件 | 启动恢复把三个独立凭据读取放进同一个 `Promise.all`；任一 rejection 直接跳到公共 catch。 |
| 根因 seam | `useSessionController` 启动 effect 的多站凭据恢复、generation 所有权和最终状态汇总。 |
| 必须保持的行为 | 各站安全存储读取独立收敛；失败站只进入 `check-failed` 并记录 store error，其他站继续恢复 Cookie 摘要和身份；启动诊断以 partial 结束并只提示失败站。 |
| 精确失败 oracle | `src/app/sessionControllerHelpers.test.ts` 的 `REG-ACCOUNT-003` 注入单站 SecureStore rejection，要求另外两站仍产生恢复事件，失败站产生 `check-failed`，且公共刷新不抛出。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须覆盖启动 effect 的真实异步编排；单测各 loader 不能证明一个 rejection 不会短路其他站。 |
| Replay 或真实验收路径 | 覆盖安装后正常启动并进入账号中心，核对现有四站状态；不破坏 SecureStore 制造失败。 |
| 负向验证方式 | 把三个 loader 恢复为单个 `Promise.all`，编号测试应在任何有效会话恢复前失败。 |
| 明确不覆盖范围 | 不清凭据、不迁移存储，也不把读取失败解释为已退出。 |

## `REG-ACCOUNT-004` 妖火明确登录失效被清理事件覆盖

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | 妖火已明确返回登录失效时，账号中心最终却显示普通未登录，用户看不到凭据已过期这一可恢复原因。 |
| 触发条件 | 检查流程先 dispatch `login-expired`，随后复用的本机清理函数又 dispatch `cleared`。 |
| 根因 seam | `useAccountController.checkYaohuoCookie` 的失效确认、凭据清理和最终 UI 事件顺序。 |
| 必须保持的行为 | 确认失效后仍清理本机妖火登录材料，但最终会话投影必须是 `login-expired`；普通退出登录仍保持 `cleared`。 |
| 精确失败 oracle | `src/app/useAccountController.test.ts` 的 `REG-ACCOUNT-004` 使用会发送 `cleared` 的真实形状清理回调，要求最后一个妖火事件仍为 `login-expired`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须固定完整事件顺序；只测清理 helper 或 reducer 单事件不能发现终态覆盖。 |
| Replay 或真实验收路径 | 不主动篡改 sid 制造失效；自然遇到失效时核对账号中心显示已失效而非普通未登录。 |
| 负向验证方式 | 删除清理后的失效事件，编号测试应看到最终事件回退为 `cleared`。 |
| 明确不覆盖范围 | 不改变妖火失效判定规则，不清真实登录态制造用例。 |

## `REG-ACCOUNT-005` NodeSeek 登录桥接接受非站点页面消息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-03`、`MORE-02` |
| 用户症状 | NodeSeek 登录 WebView 加载允许的 Cloudflare challenge 页面时，该页面伪造或碰撞 `nodeseek-login` 消息即可污染 App 保存的用户 ID、User-Agent 或 Cookie 候选。 |
| 触发条件 | WebView 为 challenge host 执行探针，消息处理器只校验 payload 类型，没有校验 `nativeEvent.url` 的 HTTPS host。 |
| 根因 seam | `useAccountController.handleLoginMessage` 的 WebView 消息来源信任边界。 |
| 必须保持的行为 | 只有 HTTPS `nodeseek.com` 及其子域消息可以更新 NodeSeek 登录候选；允许导航的 Cloudflare challenge host 只负责完成挑战，不能写入账号桥接状态。 |
| 精确失败 oracle | `src/app/useAccountController.test.ts` 的 `REG-ACCOUNT-005` 从允许的非 NodeSeek challenge URL 发送合法形状 payload，要求用户 ID、User-Agent 和 Cookie 状态均不改变。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：controller 固定 origin 门禁，设备路径再证明正常 NodeSeek 页面仍可完成桥接；仅校验导航 allowlist 不足。 |
| Replay 或真实验收路径 | App 内打开 NodeSeek 登录页，允许自然 challenge 后回到 NodeSeek 页面并正常识别状态；不在外部浏览器替代。 |
| 负向验证方式 | 移除消息 URL host 门禁，编号测试应观察到伪消息写入用户 ID。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不信任任意重定向 host，也不记录消息中的 Cookie 内容。 |

## `REG-ACCOUNT-006` 单站凭据摘要失败隐藏其他已保存凭据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-03`、`MORE-02` |
| 用户症状 | 账号中心首次读取保存凭据时，只要一站 SecureStore 暂时失败，其他站已保存的账号摘要也全部显示为未保存。 |
| 触发条件 | 凭据摘要 helper 虽分别捕获站点错误，但失败结果丢弃已成功读取的 summaries；controller 因整体失败不应用任何部分结果。 |
| 根因 seam | `accountCredentialDiagnostics` 的部分结果契约与 `useAccountCredentialController` 的状态合并边界。 |
| 必须保持的行为 | 单站读取失败仍返回并应用其他站成功摘要，诊断以 partial 结束且明确失败站；失败站保留旧可信摘要，不能被猜成未保存。 |
| 精确失败 oracle | `src/app/accountCredentialDiagnostics.test.ts` 的 `REG-ACCOUNT-006` 注入单站 rejection，要求结果仍携带另两站摘要；`src/app/useAccountCredentialController.test.ts` 固定部分摘要会合并进 UI 状态。 |
| 最低可靠自动测试层 | `UNIT_PASS`：helper 返回契约和 controller 应用都要覆盖；只证明错误被 catch 不能证明成功摘要没有丢失。 |
| Replay 或真实验收路径 | 正常进入账号中心核对原三站保存摘要；不读取或显示密码，不破坏 SecureStore 制造失败。 |
| 负向验证方式 | 让失败结果再次只返回 error，编号测试应发现成功站 summaries 缺失。 |
| 明确不覆盖范围 | 不自动填入或提交登录表单，不把凭据摘要等同于网站登录状态。 |

## `REG-ACCOUNT-007` 登录凭据未清完却显示已清除或覆盖失效错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户清除 NodeSeek 或妖火登录后，界面提示已清除，但 WebView Cookie 仍可能保留；妖火甚至会因把成功的 void 删除结果误判为 stale，稳定跳过整个 WebView Cookie 清理。自动读取或写操作确认 NodeSeek、linux.do、妖火已失效后，若本机清理再失败，还可能覆盖原始“登录已失效”错误或把清理异常抛给编辑器。 |
| 触发条件 | SecureStore 删除后先 dispatch `cleared` 再清 WebView Cookie；妖火 credential gate 用 `undefined` 表示 stale，但删除 task 成功也返回 `undefined`；gateway 或 action cleanup rejection 从原失败边界中逃逸。 |
| 根因 seam | `useSessionController` 的 multi-store 清理提交顺序、credential generation 返回契约，`sourceGateway` 的失效清理边界，以及 `useTopicActionsController`/`topicActionHelpers` 的写操作失败收口。 |
| 必须保持的行为 | SecureStore 与目标 WebView Cookie 都成功清理后才能发布 `cleared`；任一步失败保留此前可信/expired 状态并发布可重试错误。妖火成功删除必须返回明确 sentinel；自动清理失败不得替换原始 typed login-expired error。NodeSeek/linux.do 写操作后的清理失败必须保持最终 expired、提示清理未完成并正常收口动作 Promise。 |
| 精确失败 oracle | `src/app/sessionControllerHelpers.test.ts` 的 `REG-ACCOUNT-007` 分别让 NodeSeek/妖火 CookieManager rejection，禁止 cleared 并要求 check-failed；成功妖火清理必须实际读取并过期 WebView Cookie；NodeSeek login-only 清理失败仍发布 login-expired。`src/app/useAccountController.test.ts` 与 `src/sources/sourceGatewayContract.test.ts` 固定自动 cleanup failure 后仍保留 typed login-expired；`src/app/useTopicActionsController.test.ts` 固定 NodeSeek/linux.do/妖火动作清理失败不逃逸且保留失效提示。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须覆盖 SecureStore、CookieManager、session dispatch 和 gateway error 的完整顺序；只测 Cookie helper 或最终按钮文案无法证明两套存储一起提交。 |
| Replay 或真实验收路径 | 默认不点击真实“清除登录”；只有用户明确授权时，清除后重载 App 内站点并核对已退出且账号中心状态一致。 |
| 负向验证方式 | 恢复先 dispatch cleared、让妖火删除 task 返回 void，或不捕获 gateway/action cleanup rejection，编号测试必须分别失败。 |
| 明确不覆盖范围 | 不清 App 数据、不批量清其他站 Cookie，也不把保存的自动填入凭据与网站登录一起删除。 |

## `REG-ACCOUNT-008` 单站刷新收尾失败阻断其他账号状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | 账号公共刷新已完成各站网络检查后，妖火或 linux.do 的过期清理、NodeSeek 身份持久化任一步失败，其他站状态都不再应用；linux.do 明确过期还会最终显示成普通未登录/已验证。 |
| 触发条件 | 多站 `Promise.allSettled` 之后的三个站点收尾动作仍由公共 try fail-fast 执行；linux.do 清理后统一走 `cookie-loaded` 分支。 |
| 根因 seam | `useAccountStatusController` 的站点检查结果与后续 multi-store 提交、最终 SiteSessionState 投影边界。 |
| 必须保持的行为 | 每个站的清理或持久化失败只把该站加入 partial，并允许其他站继续 dispatch；NodeSeek 保存失败保留刚确认的身份并追加 check-failed，妖火/linux.do 确认过期始终以 login-expired 结束，清理失败在过期提示中明确可重试。 |
| 精确失败 oracle | `src/app/useAccountStatusController.test.ts` 的 `REG-ACCOUNT-008` 分别注入妖火 cleanup rejection、NodeSeek save rejection，并固定其他站仍更新；linux.do 明确 loginRequired 后只允许最终 `login-expired`，禁止 `cookie-loaded`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须覆盖公共刷新从并行检查到逐站收尾和 dispatch 的完整顺序；单测各清理函数无法证明公共刷新不会中止。 |
| Replay 或真实验收路径 | 正常账号中心刷新四站；自然遇到单站失效或存储失败时核对该站错误且其他站照常更新，不破坏凭据制造状态。 |
| 负向验证方式 | 让任一收尾 rejection 回到公共 catch，或把 linux.do 过期恢复成 cookie-loaded，编号测试必须失败。 |
| 明确不覆盖范围 | 不主动篡改 Cookie、不清 SecureStore，也不把清理失败当成仍然登录成功。 |

## `REG-ACCOUNT-009` 旧账号刷新覆盖刷新期间保存的新会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户点击刷新账号状态或发起写操作后在站点登录完成，先启动的旧请求仍可能把 NodeSeek、linux.do 或妖火的新会话覆盖成未登录、检查失败或登录已失效，并为新会话弹出错误登录入口。 |
| 触发条件 | 账号刷新和写操作只把 credential generation 传给条件清理/保存，没有在网络检查、action 响应和最终 session/UI 提交前再次核对同站 generation。 |
| 根因 seam | `useAccountStatusController`、`useTopicActionsController` 与 `discourseActionRuntime` 的站点 credential snapshot、异步请求、过期清理和 SiteSessionState/动作结果提交边界。 |
| 必须保持的行为 | 三站分别捕获请求开始时的 generation；检查、action、清理或身份持久化结束后只允许仍属当前 generation 的结果更新 UI、清理 SecureStore/WebView Cookie、切换媒体 Cookie、弹登录入口或重置等级。某站变 stale 不影响其他站、小隐寺或新会话继续完成。 |
| 精确失败 oracle | `src/app/useAccountStatusController.test.ts` 的 `REG-ACCOUNT-009` 在旧刷新等待 linux.do 检查时同时推进三站 generation，要求旧请求不执行 linux.do/妖火清理、不保存 NodeSeek 身份，也不 dispatch 三站任何旧状态；`src/app/sessionControllerHelpers.test.ts` 在 NodeSeek 删除进行中排队新登录保存，要求旧清理不再进入 WebView Cookie 和 `cleared` 提交；`src/app/useTopicActionsController.test.ts` 分别让三站旧 action 等待后推进 generation，要求不清新凭据、不改 session、不提示或打开登录。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须用 pending Promise 穿过真实 controller 的读取、网络和提交阶段；只测 generation queue helper 不能证明最终 session dispatch 受保护。 |
| Replay 或真实验收路径 | 正常账号中心刷新、App 内登录与只读动作入口分别覆盖成功行为；不通过自动化真实提交登录、写操作，也不清现有 Cookie 制造竞态。 |
| 负向验证方式 | 移除任一站最终提交前的 generation 比较，或再次把 NodeSeek 成功/stale 删除都表示成 void，编号测试必须看到旧清理、旧身份保存或旧 session 事件。 |
| 明确不覆盖范围 | 不取消用户正在进行的登录，不跨站共享 generation，不重放已发出的写请求，也不把 stale 结果报告为站点失败。 |

## `REG-PROXY-001` 代理配置读取失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-01`、`MORE-04` |
| 用户症状 | 用户原本依赖服务器代理时，启动阶段 SecureStore 暂时读取失败，App 把代理状态当作“未启用”并让来源、登录 WebView 或更新请求直接联网。 |
| 触发条件 | 代理 load catch 用空状态继续完成启动，既没有设置 failed 门禁，也没有阻止随后对空 profile 执行 native disable。 |
| 根因 seam | `useNetworkProxyController` 的安全存储加载终态、native apply effect 与 `ensureNetworkProxyReady` 门禁。 |
| 必须保持的行为 | 代理配置读取失败必须进入用户可见 failed 状态并阻断所有受代理保护请求，不能推断用户未启用代理；成功保存新的明确配置后才可退出加载失败门禁并重新应用。 |
| 精确失败 oracle | `src/networkProxyControllerGuard.test.ts` 的 `REG-PROXY-001` 注入 load rejection，要求 `ensureNetworkProxyReady` rejection 且提示配置读取失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`：controller 的 ref、ready promise 和 guard 必须一起覆盖；只测 SecureStore loader 或 UI 错误文案不能证明请求没有直连。 |
| Replay 或真实验收路径 | 正常状态只读打开服务器代理面板，核对已保存状态；不破坏 SecureStore。获明确授权启用代理时，再通过真实页面和关闭恢复验收 native 通道。 |
| 负向验证方式 | 在 load catch 中恢复空状态后继续，编号测试应从 rejection 退化为成功 resolve。 |
| 明确不覆盖范围 | 不自动开启未知代理，不删除或重建现有代理配置，也不通过损坏真实安全存储制造故障。 |

## `REG-UPDATE-001` 更新检查期间可下载旧版本信息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04` |
| 用户症状 | 已显示旧更新信息时，用户快速连续点击“检查更新”和“下载并安装”，旧 APK 下载可在新 manifest 检查尚未结束时启动。 |
| 触发条件 | UI 要等下一次 React render 才禁用下载按钮；controller 的下载 guard 只检查 downloading，没有同步检查已经置位的 checking ref。 |
| 根因 seam | `useAppUpdateController` 的 check/download 并发所有权与同步 busy ref 门禁。 |
| 必须保持的行为 | 检查或下载任一操作正在进行时，另一个命令必须在 controller 层同步 blocked；只有当前已确认的 update info 才能创建下载任务。 |
| 精确失败 oracle | `src/app/useAppUpdateController.test.ts` 的 `REG-UPDATE-001` 保持检查 Promise pending 后立即调用下载，要求不创建 `DownloadResumable`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须模拟同一 render 内的连续命令；只断言按钮 disabled 无法覆盖状态提交前的点击窗口。 |
| Replay 或真实验收路径 | 默认只检查更新信息，不下载或安装；真实下载与 Android 安装器需明确发布/安装授权。 |
| 负向验证方式 | 从下载 guard 删除 `appUpdateBusyRef`，编号测试应开始创建旧版本下载。 |
| 明确不覆盖范围 | 不自动下载、不打开安装器，也不改变 manifest、签名或版本校验规则。 |

## `REG-NODESEEK-001` NodeSeek WebView/会话状态被错误证明

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 代码或桌面浏览器看似能访问 NodeSeek，但不能证明 App 内 WebView、现有 Cookie、返回链和后续读取仍然可用。 |
| 触发条件 | NodeSeek 登录受限、WebView fallback、会话刷新或验证页面路径发生变化。 |
| 根因 seam | App 内 login/session/verification controller、Cookie bridge、WebView readiness 和 navigation 返回。 |
| 必须保持的行为 | 从账号中心进入 App 内 NodeSeek 页面；包名保持 `com.wz.reader`；返回后账号中心和读取路径仍可使用；旧 generation 不覆盖新会话。 |
| 精确失败 oracle | `tests/device/nodeseek-session.ad` 必须等到正确 NodeSeek host、`document.readyState` 非 loading 且正文非空后才出现 readiness；错误 route/selector 必须在对应步骤失败。 |
| 最低可靠自动测试层 | `DEVICE_REPLAY_PASS`：session/Cookie Vitest 只提供确定性支撑，不能替代 Android WebView、App 内 Cookie 和返回链。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad`；动态登录结论只接受 App 内同类页面，必要时再形成 `LIVE_PASS`。 |
| 负向验证方式 | 临时改错 NodeSeek host/readiness 或 Replay selector，必须在精确步骤失败，随后还原。 |
| 明确不覆盖范围 | Replay 不清登录、不清 Cookie，也不声明当天原站 DOM 永久稳定。 |

## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | NodeSeek 登录 WebView 已显示“页面打开超时”或加载失败，Replay 仍因 ready testID 可见而通过。 |
| 触发条件 | readiness 脚本消息在超时或错误状态之后到达；旧 Replay 又固定等待 15 秒，只检查 ready testID，不检查错误是否存在。 |
| 根因 seam | `src/screens/more/MorePanels.tsx` 的 WebView readiness/error 状态和 `tests/device/nodeseek-session.ad` 的等待 oracle。 |
| 必须保持的行为 | 超时和错误立即清除 readiness；只要存在 WebView block/error 就不得暴露 ready testID。Replay 必须按 ready 状态等待，并明确确认超时错误不可见。 |
| 精确失败 oracle | `tests/ui/account-site-panels.test.tsx` 先触发 WebView 错误、再送达 readiness 消息，断言错误仍可见且 ready testID 不存在；`src/androidSmokeGuard.test.ts` 固定 Replay 使用状态等待并拒绝固定长等待。 |
| 最低可靠自动测试层 | `UI_PASS` 固定错误与 testID 不能同时出现；`DEVICE_REPLAY_PASS` 再证明真实 Android WebView readiness 和返回链。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad`；若原站在 15 秒内没有真实 ready，脚本必须失败而不是把超时页记为通过。 |
| 负向验证方式 | 恢复仅由 `webViewReadyForReplay` 控制 testID，错误后迟到的 readiness 消息会让 UI 测试精确失败；恢复 `wait 15000` 会让 Replay 守卫失败。 |
| 明确不覆盖范围 | 不保证 NodeSeek 当天必定可访问；网络或原站阻塞仍记 `BLOCKED_BY_ENV` 或 `NOT_VERIFIED`，不能伪造 ready。 |

## `REG-NODESEEK-003` NodeSeek 真实页面已可用但 Replay 内部 marker 超时

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | App 内 WebView 已显示完整 NodeSeek 首页，Android 可访问树也已有标题、logo 和帖子列表，发布 Replay 仍因内部 ready testID 迟迟不出现而超时。 |
| 触发条件 | 设备测试把真实 WebView DOM 经由 `postMessage → React Native 状态 → 动态 testID` 绕回原生树后再判断；该内部桥接状态晚于用户已经可见、可操作的页面内容。健康状态下错误提示节点不会挂载，`is hidden` 也不能表达“错误节点不存在”。 |
| 根因 seam | `tests/device/nodeseek-session.ad` 的设备级 oracle 及 `src/androidSmokeGuard.test.ts` 的 Replay 守卫；不是 NodeSeek 页面加载产品逻辑。 |
| 必须保持的行为 | 首次打开后 15 秒内直接看到真实 WebView 标题、logo 和“新帖子”正文入口即可继续并正常返回；不得增加刷新步骤、延长等待或用弹层存在代替正文。错误/ready 互斥继续由 `REG-NODESEEK-002` 的 RNTL 测试负责。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 要求 Replay 仅以带超时的 `wait` 断言三类真实页面节点，禁止在成功等待后追加无等待的重复 `is visible`，同时禁止重新依赖 `nodeseek-login-webview-ready`；`tests/device/nodeseek-session.ad` 必须在匹配当前 revision/APK/设备身份时一次通过。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 Replay 判据，`UI_PASS` 固定错误状态不会暴露 ready，`DEVICE_REPLAY_PASS` 证明 Android 首次 WebView 真实内容和返回路径。 |
| Replay 或真实验收路径 | 运行静态守卫与账号 WebView RNTL 后，在身份匹配的 release APK 上原样执行 `tests/device/nodeseek-session.ad`，不手动刷新。 |
| 负向验证方式 | 恢复内部 ready testID 等待，会在同一真实页面已经完整可见时仍超时；在成功 `wait` 后恢复无等待的重复 `is visible`，会因 WebView 可访问树的瞬时快照变化产生假失败；恢复 `is hidden` 检查，会因健康状态下错误节点不存在而产生假失败。 |
| 明确不覆盖范围 | 不声明 NodeSeek 原站永久可用；网络或原站不可达仍记 `BLOCKED_BY_ENV`，也不以正文可见代替账号状态和 Cookie 内容核对。 |

## `REG-DATA-001` ReaderData 实验与代码回退不兼容

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`、`DATA-02`、`DATA-03` |
| 用户症状 | 新实验写入了旧代码不能读取的本机数据；代码回退后收藏、历史和关注看似丢失。 |
| 触发条件 | 改动 `reader-data` key、version、schema、序列化、分块或保存顺序，却只验证新代码读取新格式。 |
| 根因 seam | `src/readerData.ts`、`src/readerDataStore.ts`、备份导入和保存队列。 |
| 必须保持的行为 | 当前 version 2 数据可读；失败写入不覆盖旧数据；新旧备份契约明确；改变格式时同时证明升级、失败回滚和代码回退结果。 |
| 精确失败 oracle | 无效 version 必须被拒绝，迟到写入不得覆盖最新状态，损坏/超限备份不得改变原数据。 |
| 最低可靠自动测试层 | `UNIT_PASS`：`src/readerData.test.ts`、`src/readerDataStore.test.ts`、`src/readerBackup.test.ts`、`src/backupOperation.test.ts`。 |
| Replay 或真实验收路径 | 覆盖安装和重启后核对 Library 数量及 Feed 已读/收藏状态；不得清 App 数据制造通过。 |
| 负向验证方式 | 使用无效 version 或迟到写入 fixture，Vitest 必须拒绝覆盖或保持最新状态，随后恢复正确 fixture。 |
| 明确不覆盖范围 | 本机真实数量和 APK 身份只记录在 `docs/emulator-baseline.md`。 |

## `REG-OPS-001` 验证当前代码后留下旧 APK

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 开发构建验收通过后又恢复旧 Smoke APK，用户实际看到的仍是旧 bug。 |
| 触发条件 | 验收流程把“恢复旧基线 APK”当作清理动作，却没有确认用户接下来要检查哪个构建。 |
| 根因 seam | 安装/验收操作协议，而不是业务代码。 |
| 必须保持的行为 | 每次设备结论绑定 commit、dirty 状态、App 版本、versionCode、APK 类型/SHA、设备和登录来源；交付时保留用户应检查的已测构建。 |
| 精确失败 oracle | 指定 APK 与设备 `base.apk` 的 SHA、versionName 或 versionCode 任一不匹配，`test:device` 必须在 Replay 前失败。 |
| 最低可靠自动测试层 | `DEVICE_REPLAY_PASS` 的身份前置门禁；`src/androidSmokeGuard.test.ts` 固定脚本契约。 |
| Replay 或真实验收路径 | `npm run smoke:android` 覆盖安装后执行 APK sanity 与 Replay；本机基线记录最终安装状态和登录来源。 |
| 负向验证方式 | 指向与设备已安装包不一致的 APK，必须拒绝宣称 Replay 通过且不得卸载/清数据。 |
| 明确不覆盖范围 | 未明确发布时不上传、push 或发布正式 APK。 |

## `REG-OPS-002` 设备侧录屏分片耗尽 Replay 空间

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | `APK_SANITY` 已通过，但 Replay 在第一个业务步骤前因 agent-device 无法写入录屏恢复清单而失败；设备 `/sdcard` 曾残留 471 个工具录屏分片并达到 92% 使用率。 |
| 触发条件 | 多次使用 `--record-video` 执行 Replay，设备侧 agent-device 录屏分片或 active manifest 没有在证据拉回本机后清理。 |
| 根因 seam | `scripts/run-device-replay.mjs` 的 Replay session、设备端 durable recording manifest、`screenrecord` 与录屏 scratch 生命周期，而不是 App、Cookie 或业务存储。旧 runner 曾按进程名/路径批量终止并删除，无法证明目标属于当前 Replay。 |
| 必须保持的行为 | JUnit、视频和失败日志保存在 ignored `tmp/agent-device/`；每条 Replay 使用唯一 base session。执行前若存在 manifest、工具录屏进程或 orphan scratch，只按 `BLOCKED_BY_ENV` 阻断并保留；执行后只有 manifest 同时匹配当前 session 前缀、device id、recording id 和安全录屏路径时，才对该精确 session 调用 agent-device `record stop`。不终止 daemon、不 wildcard 删除文件，也不触碰 MCP、App 数据、Cookie、用户文件或本机首败证据。 |
| 精确失败 oracle | `replayRecordingRecoverySession` 对当前 session/device 的合法 manifest 返回精确 recovery session，对其他 session/device、畸形 JSON 或异常路径返回 `undefined`；scratch parser 只接受两个受控根目录下的 active manifest、对应 `.tmp` 和 `agent-device-recording-<时间戳>.mp4` basename。完整 Replay 后 manifest、工具录屏进程和 scratch 均为 0；未知现场必须保留并阻断后续 Replay。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定所有权识别、受控根目录和禁止 wildcard/daemon 清理；`DEVICE_REPLAY_PASS` 证明实际设备录屏可连续收口；二者缺一不能宣称工具链稳定。 |
| Replay 或真实验收路径 | `src/androidSmokeGuard.test.ts`；`npm run test:device`；必要时只读检查显式设备的 `/sdcard/agent-device-recording-*` 数量和剩余空间。 |
| 负向验证方式 | 把 manifest 的 session/device 改成其他值、提供畸形 manifest 或把 scratch basename 改成非时间戳工具名，所有权识别必须拒绝；守卫测试同时禁止 raw `kill`、wildcard `rm` 和 daemon 终止。不通过填满用户设备存储制造负向条件。 |
| 明确不覆盖范围 | runner 不自动删除历史未知 scratch，也不终止无法证明归属的 recorder/daemon；这类现场按环境阻碍保留，需另行确认归属。不删除 App 数据、下载目录中的用户文件或本机 `tmp/agent-device/` 证据，也不承诺修复 agent-device 上游实现。 |

## `REG-OPS-003` Replay 把设备 ID 当成设备名称

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | runner 已按 `emulator-5554` 找到唯一设备并验证 APK 身份，但第一条 Replay 在 `open` 步骤报 `No device named emulator-5554`，全部设备旅程无法开始。 |
| 触发条件 | `WZ_ANDROID_TEST_DEVICE` 使用 agent-device 列表中的设备 ID，且 runner 把这个原始选择值继续传给 `agent-device test --device`。 |
| 根因 seam | `scripts/run-device-replay.mjs` 同时承担设备发现与 Replay 调用：设备发现接受 ID 或名称，但 agent-device 0.19.0 的 test runner 按显示名称绑定设备。 |
| 必须保持的行为 | 环境变量仍可显式填写设备 ID 或名称；runner 必须先唯一解析同一台已启动 Android 设备，ADB 身份校验使用 `device.id`，Replay test 使用解析后的 `device.name`，不得自动选择、启动或重置其他设备。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 用 `id=emulator-5554`、`name=WZ Pixel API 35` 的真实列表形状断言 Replay 参数为 `--device WZ Pixel API 35`；恢复传原始 ID 时测试先失败，真实 Replay 再精确失败在第一步 `open`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 ID → 名称映射，`DEVICE_REPLAY_PASS` 证明 agent-device 实际接受该参数并走完七条旅程；二者缺一不能宣称设备闸门恢复。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts`；随后在身份匹配的保留数据设备上执行 `npm run test:device`，七条 tracked Replay 均须 `retries=0`。 |
| 负向验证方式 | 在隔离测试中把 Replay 参数临时改回环境变量中的 `emulator-5554`，单元 oracle 必须失败，CLI 单步回放必须报 `No device named emulator-5554`；还原后重新跑完整 Replay。 |
| 明确不覆盖范围 | 不承诺修复 agent-device 上游的失联 daemon 生命周期，也不通过卸载、清数据、清 Cookie 或切换设备制造通过。 |

## `REG-OPS-004` AVD 名与设备显示名不一致导致 Replay 被拒绝

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 同一发布命令已经完成正式构建、签名校验和 `APK_SANITY`，随后 Replay 在身份行前报“无法唯一匹配 Android 设备”，发布闸门无法收尾。 |
| 触发条件 | `WZ_ANDROID_SMOKE_DEVICE` 使用 agent-device 可启动的 AVD 名 `WZ_Pixel_API_35`，但 booted device 清单把同一设备显示为 `WZ Pixel API 35`。 |
| 根因 seam | Smoke 的 boot/install 接受 AVD 名，`scripts/run-device-replay.mjs` 的设备发现却只接受 ID 或完全相同的显示名，没有处理 agent-device 对下划线与空格的展示差异。 |
| 必须保持的行为 | 设备 ID 和完全相同的显示名继续精确匹配；AVD 名只把连续下划线/空白视为等价并且仍须唯一匹配；不能模糊选择另一台设备。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 以清单设备 `emulator-5554 / WZ Pixel API 35` 断言配置值 `WZ_Pixel_API_35` 唯一映射到同一设备；修复前返回空数组。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定纯设备匹配，`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 证明 release 命令能在同一保留数据设备继续完成。 |
| Replay 或真实验收路径 | `.env.release.local` 保持 `WZ_ANDROID_SMOKE_DEVICE=WZ_Pixel_API_35`，执行 `npm run release:android`；身份行必须记录解析后的 display name/ID，七条 Replay 全部零重试通过。 |
| 负向验证方式 | 在隔离测试中恢复完全相等比较，AVD 名映射断言必须收到空数组；不改真实 AVD 名、不创建重复设备制造失败。 |
| 明确不覆盖范围 | 不把连字符、任意标点或部分字符串当成同一设备；归一化后出现多个候选仍必须拒绝，也不自动启动另一台设备。 |

## `REG-OPS-005` 覆盖安装后的首次启动逃出日志窗口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 覆盖安装后的第一次启动发生崩溃，但脚本随后清空本机日志文件并执行第二次健康 relaunch，最终仍可能输出 `APK_SANITY`。 |
| 触发条件 | Smoke 依次执行覆盖安装、第一次 `open`、`logs clear --restart`、第二次 `open --relaunch`；agent-device 又要求先有 app session 才能启动日志流。 |
| 根因 seam | `scripts/smoke-android.mjs` 把建立 agent-device session 的第一次 `open` 放在受检查日志窗口之外；第二次启动证据不能证明新 APK 的首次启动没有失败。 |
| 必须保持的行为 | 覆盖安装成功后先读取设备 epoch，再于第一次 `open` 前向设备 logcat 写入唯一 marker；流程结束后以 `logcat -T <epoch>` 有界读取日志，从 marker 起只保留目标包名行和由启动/崩溃记录确认的目标包 PID 行，再检查崩溃、ANR 与 RedBox。marker 丢失必须失败；日志读取不得受 Node 默认 1 MiB 缓冲限制，也不得清空全局 logcat。既有 agent-device session 日志继续检查第二次 relaunch 和 Feed readiness。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 注入一个“后续 appstate/Feed 都成功，但首次启动 PID 输出 `FATAL EXCEPTION`”的命令 runner，断言仍返回含“Android 崩溃”的 `AggregateError`，并固定 `install < device epoch < marker < first open < logcat -T dump`。修复前同一首次启动不在任何受检窗口；真实设备曾用完整 logcat 触发 Node `ENOBUFS`，故同一 oracle 也固定有界起点。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定命令顺序、包/PID 裁剪和首次崩溃 oracle；`APK_SANITY` 在明确设备上证明 marker 与真实 logcat 命令可用。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts`；在目标 APK 和保留数据设备上运行 `npm run smoke:android`，确认首次启动与 session relaunch 均无运行时失败。 |
| 负向验证方式 | 将 marker 调用移到第一次 `open` 之后，或只检查 agent-device 第二次 relaunch 的日志，`REG-OPS-005` 必须因顺序或漏报首次崩溃而失败；不向真实 App 注入崩溃。 |
| 明确不覆盖范围 | 包外其他进程的运行时失败不会归因于本 App；`APK_SANITY` 仍不证明搜索、详情、写操作或其他业务功能正确，这些由 Replay、UI 与 Live 分层验收。 |

## `REG-OPS-006` Replay 自行关闭 session 导致录屏复活并丢失 manifest

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | `agent-device test --record-video` 报告单条 Replay 通过，但设备录屏仍在运行；约 170 秒后旧 daemon 启动下一分片并覆盖唯一 active manifest，安全门禁随后停止整批 Replay。 |
| 触发条件 | tracked `.ad` 在结尾执行 `close`；agent-device 0.19.0 删除 session 后，测试收尾找不到 recording，跳过 `record stop`，但原 daemon 的分片定时器仍存活。 |
| 根因 seam | `tests/device/*.ad` 与 agent-device test harness 的录屏收尾顺序，而不是 `scripts/run-device-replay.mjs` 的所有权门禁。 |
| 必须保持的行为 | tracked Replay 不自行执行 `close`；test harness 先成功停止并拉回视频，再由自身 cleanup 关闭 session。异常路径仍只能按当前 session/device manifest 精确恢复，不能扩大删除或终止范围。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 拒绝任何 tracked Replay 中的独立 `close`；完整设备执行后每条 trace 都有成功的 `video_recording_stop`，且 manifest、工具 `screenrecord` 和录屏 scratch 均为 0。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定七条 Replay 的生命周期契约；`DEVICE_REPLAY_PASS` 证明真实 daemon、manifest 和 Android `screenrecord` 连续收口。 |
| Replay 或真实验收路径 | `npm run test:device` 在空录屏基线上连续执行七条 `--record-video` Replay，并在结束后核对设备与本机任务进程基线。 |
| 负向验证方式 | 给任一 Replay 恢复末尾 `close`，守卫测试必须失败；隔离设备运行会只有录屏 start/preroll、没有成功 stop。 |
| 明确不覆盖范围 | 不承诺修复 agent-device 其他 daemon 生命周期问题，也不删除未知历史 scratch；现有所有权安全门禁必须保留。 |

## `REG-OPS-007` 空 manifest 或原子写入临时文件绕过录屏门禁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 设备仍有 `agent-device-recording-active.json.tmp` 或零字节 active manifest，runner 却认为录屏基线为空并继续启动下一条 Replay。 |
| 触发条件 | agent-device 0.19.0 原子写 manifest 时在 `.tmp` 写入或移动阶段中断，或者正式 manifest 已创建但内容尚为空。 |
| 根因 seam | `scripts/run-device-replay.mjs` 的设备 scratch basename 解析只识别时间戳 MP4，manifest 读取又把空内容视为不存在。 |
| 必须保持的行为 | 两个受控根目录中的 active manifest、对应 `.tmp` 和时间戳 MP4 只要文件存在都视为录屏占用；未知现场只阻断并保留，不删除、不终止。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 的 `REG-OPS-007` fixture 同时包含 MP4、正式 manifest、`.tmp`、用户文件和畸形工具名，只接受前三类 agent-device 路径。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定文件存在性门禁；`DEVICE_REPLAY_PASS` 证明真实录屏结束后这些路径均归零。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts` 后，在身份匹配设备执行 `npm run test:device`，执行前后只读核对 active manifest、`.tmp`、工具 MP4 与 recorder 进程。 |
| 负向验证方式 | 从 parser 移除正式 manifest 或 `.tmp` 分支，`REG-OPS-007` 必须分别缺少对应路径而失败；不在真实设备制造未知残留。 |
| 明确不覆盖范围 | 不修复 agent-device 上游原子写入，也不自动清理历史未知文件；无法证明归属时仍按 `BLOCKED_BY_ENV` 停止。 |

## `REG-OPS-008` 允许的 agent-device 版本不支持 Replay 参数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 版本门禁接受 agent-device 0.14.0，但第一条 Replay 因不认识 `--record-video` 或可重复 `--reporter` 参数而在业务步骤前失败。 |
| 触发条件 | `MIN_AGENT_DEVICE_VERSION` 与 README 仍声明 0.14.0，而新增 runner 使用 0.19.0 已验证支持的 test flags。 |
| 根因 seam | `scripts/agent-device-runtime.mjs`、`scripts/run-device-replay.mjs` 与 README 的工具版本契约不一致。 |
| 必须保持的行为 | Replay 入口拒绝低于 0.19.0 和 0.19.0 prerelease 的安装；README 与运行时使用同一最低版本。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 的 `REG-OPS-008` 断言最低版本为 0.19.0，拒绝 0.18.9 和 0.19.0 beta，接受 0.19.0 及更高稳定版本。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定版本比较；`DEVICE_REPLAY_PASS` 证明当前可信安装实际接受 runner 参数。 |
| Replay 或真实验收路径 | 先执行版本门禁，再在明确设备运行 `npm run test:device`；版本不满足时不得进入设备发现、录屏或 App 操作。 |
| 负向验证方式 | 把最低版本恢复为 0.14.0，`REG-OPS-008` 必须精确收到旧值并失败。 |
| 明确不覆盖范围 | 不自动安装或升级全局工具；未来版本若移除参数，需要单独更新兼容契约和测试。 |

## `REG-TOPIC-001` 回复已筛选但标题仍显示主题总数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 切换“只看楼主”或“只看带图”、或执行评论内查找后，可见回复已经减少，但“回复列表 N 条”仍显示主题原始总回复数。 |
| 触发条件 | Topic detail 的 `replyCount` 大于筛选后的 `replies.length`，且回复筛选或评论查询处于生效状态。 |
| 根因 seam | `src/screens/topic/TopicScreenBody.tsx` 的回复标题计数直接读取主题总数，没有区分当前可见结果与未筛选总数。 |
| 必须保持的行为 | “只看楼主”“只看带图”和评论内查找显示当前可见回复数；“全部”与仅“倒序”继续显示主题总回复数；可见列表、选中状态和数量必须同步。 |
| 精确失败 oracle | `tests/ui/topic-reply-filters.test.tsx` 渲染真实 Topic 回复筛选控件：普通用例断言四种筛选、评论查询和列表顺序，4 个带 `REG-TOPIC-001` 的普通测试分别钉住楼主/带图/查询后的标题数量，以及清空原始输入但 debounce 结果尚未更新时的列表与数量一致；`src/app/useTopicSessionController.test.ts` 固定确定性过滤结果。 |
| 最低可靠自动测试层 | `UI_PASS`：Vitest 可证明过滤数组，但只有 RNTL 能证明用户看到的标题数量跟随数组变化。4 个回归用例必须作为普通测试真实通过。 |
| Replay 或真实验收路径 | 从 Feed/Search/Library 打开有多位回复者且含图片的 Topic，逐项切换筛选并执行一次评论内查找；作者页返回后复核筛选与数量仍保留。 |
| 负向验证方式 | 修复前同一 UI 测试在“只看楼主”步骤精确失败：可见回复为 2 条而标题仍为 3 条；恢复直接读取 `replyCount` 时该断言必须再次失败。 |
| 明确不覆盖范围 | 动态来源返回的原始 `replyCount`、回复分页完整性和图片解析正确性仍由 gateway/controller 测试及 App 内 Live 验收负责。 |

## `REG-TOPIC-002` 从阅读设置返回后主题详情丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04`、`NAV-03` |
| 用户症状 | 从主题右上菜单进入“阅读设置”后切回首页，原主题详情已经被弹出，用户回到首页列表而不是继续阅读原主题。 |
| 触发条件 | 当前位于 Topic route，执行“阅读设置”，完成查看或调整后返回。修复前该入口展开 More 的外观面板并切换到 More tab，随后返回首页。 |
| 根因 seam | `src/app/AppRoot.tsx` 的入口曾复用 `changeScreen('more')`，导致 `popTo('MainTabs')` 移除 Topic；改为临时 `ReadingSettings` route 后，又曾先 dispatch `push`、再依赖下一次 render 保存 Topic，navigation state 变化可能先触发旧闭包，得到滞后一帧 snapshot。 |
| 必须保持的行为 | 阅读设置入口先按当前 Topic route key 同步保存最新 Topic snapshot，再 push 既有外观控件；关闭或离开设置后返回同一个主题详情、同一回复筛选和滚动上下文。普通底部 tab 导航仍保持既有契约。 |
| 精确失败 oracle | `src/app/AppNavigator.test.ts` 的 `REG-TOPIC-002` 断言当前 Topic route 先执行 `saveTopicRoute`、后 dispatch `push`；`tests/ui/app-navigator.test.tsx` 再固定用户进入阅读设置并返回后仍为同一个 Topic 组件且内部状态未丢失。旧顺序精确失败为 `push` 先发生或返回旧 snapshot。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定保存与导航的同步顺序；`UI_PASS` 证明用户经过可见入口返回后 Topic 组件及内部状态仍保留。 |
| Replay 或真实验收路径 | Feed → Topic → 更多操作 → 阅读设置 → 系统或顶栏返回；核对外观控件可见，并且返回后仍是原 Topic、原筛选和原阅读位置。 |
| 负向验证方式 | 临时恢复 `changeScreen('more')` 时 UI 用例必须失败；保留临时 route 但把 `saveTopicRoute` 移回 dispatch 之后时，单元顺序 oracle 必须失败。 |
| 明确不覆盖范围 | 外观各设置的切换、持久化与恢复由 `MORE-03` 验收；一般 tab 切换、Topic → User 嵌套返回仍由其他 NAV 测试负责。 |

## `REG-TOPIC-003` 评论引用改动误伤正文引用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 用户症状 | 调整评论引用卡片后，主题正文里的引用也跟着改变；默认简介和展开后的完整帖子混在一起，或展开后仍只看到简介。评论最外层还可能被误改成逐条卡片。 |
| 触发条件 | 正文引用与评论引用强行共用展示组件、只按楼层缓存被引内容，或修改共享 HTML/样式后只回归当前评论入口。不同主题存在相同楼层号时更容易串入错误帖子。 |
| 根因 seam | `src/screens/topic/TopicScreenBody.tsx`、`src/screens/topic/TopicBodyQuoteCard.tsx` 与 `src/screens/topic/ReplyItem.tsx` 的两套展示入口；`src/quotedPosts.ts`、`src/app/useTopicController.ts`、`src/app/useTopicSessionController.ts` 的引用标识、加载和 session 缓存；`src/localLinuxdo.ts` 的简介/完整帖数据边界；`src/themeStyles.ts` 与 `TopicContentBlock` 的四站回复间距。 |
| 必须保持的行为 | 正文引用和评论引用分别实现并分别验收：默认只展示原站简介，展开后追加真实完整帖子；已加载的同主题楼层可直接复用，未加载或跨主题 linux.do 引用按来源、主题 id、帖子号读取；缓存不能只按楼层。评论仍是透明平铺列表，仅引用区域是卡片；正文、签名/留言、reaction/统计/感谢、操作栏和分隔线的间距不能叠加失衡。 |
| 精确失败 oracle | `src/localSources.test.ts` 分别断言正文跨主题引用和评论同主题引用的简介/完整帖边界；`src/quotedPosts.test.ts` 固定跨主题同楼层缓存隔离；`tests/ui/topic-components.test.tsx` 独立断言 `TopicBodyQuoteCard` 与 `ReplyItem` 默认只见简介、展开后才见匹配的完整帖且错误主题内容不可见；`src/theme.test.ts` 固定评论外层无卡片圆角、保留分隔线，并固定签名、统计和操作栏的间距契约。 |
| 最低可靠自动测试层 | 数据边界和缓存键使用 `UNIT_PASS`；正文引用与评论引用的独立可见行为至少使用 `UI_PASS`。四站实际 HTML、字体和末尾内容造成的视觉间距仍需要 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 用用户给定的原站主题链接按内部直达方式打开 App 详情；对同时含正文引用和评论引用的 linux.do 主题分别检查默认简介、展开完整帖、收起与返回状态。再按 `docs/testing-standard.md` 的四站评论末尾分支矩阵检查普通文本、表情/图片、留言/签名、reaction/统计/感谢、操作栏和分隔线。全程只读。 |
| 负向验证方式 | 向缓存放入另一个主题的同楼层帖子时，评论 UI 必须仍显示当前主题的完整帖；删除正文或评论任一独立 UI 用例、改回楼层号缓存、让评论外层获得卡片圆角，均必须使对应测试失败。 |
| 明确不覆盖范围 | 不固定原站当天主题内容，不绕过 Cloudflare，不证明写入互动；没有合适动态目标时记 `NOT_VERIFIED`，不能用搜索结果或普通无引用主题代替。 |

## `REG-TOPIC-004` 主题图片尺寸探测与显示各加载一次

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-03`、`NAV-03` |
| 用户症状 | 完整刷新含块级正文图片的主题时，图片先在约 100×100 的小框里转圈，容器放大后又转一次圈，最后才显示图片；同一图片重进也会发生明显尺寸跳变。 |
| 触发条件 | 正文 `<img>` 没有可直接使用的完整宽高，HTML renderer 先请求图片尺寸，尺寸就绪后最终图片组件再按 URL 发起自己的加载与解码。 |
| 根因 seam | `src/app/useHtmlRenderingController.tsx` 曾同时使用 `react-native-render-html` 的 `useIMGElementState`（内部 `Image.getSize`）和按 URL 加载的 `ExpoImage`，把同一图片拆成“尺寸探测”和“最终显示”两个生命周期；RNRH 未知尺寸默认 100×100，因而产生小框、放大和第二个 Spinner。 |
| 必须保持的行为 | 块级正文图片只由 `expo-image` 的 `useImage` 下载并解码一次，保留既有 Cookie、Referer、User-Agent，并把解码宽度限制到正文物理像素宽度；同一个 `ImageRef` 同时提供自然宽高并直接交给最终 `ExpoImage`。首次未知尺寸使用全正文宽度 4:3 灰底和一个连续 Spinner，最多按真实比例校正一次；当前进程按规范化 URL 复用真实宽高，尺寸缓存不持久化也不包含 Cookie。URL 或请求头变化时旧 ImageRef/失败状态立即失效；错误态停止 Spinner 并显示 alt/失败文案。inline 图片、emoji、sticker、图片预览、页面级读取状态、文本与投票正文树保持原行为。 |
| 精确失败 oracle | `tests/ui/topic-image-loading.test.tsx` 固定冷首帧 4:3 和唯一 Spinner、物理像素解码上限、ImageRef 就绪后零 Spinner且最终 source 为同一引用、同 URL 重进首帧复用真实比例、请求头变化期间不显示旧图、错误态停止加载，以及 inline emoji 不调用块图 loader。 |
| 最低可靠自动测试层 | `UI_PASS`：只有渲染测试能同时证明占位几何、Spinner 数量、最终 source 身份、错误文案和 inline 分支隔离；`npm run typecheck` 固定 Expo/RNRH 图片源类型边界。动态缓存命中和真实帧序列再由只读 `LIVE_PASS` 核对。 |
| Replay 或真实验收路径 | 在当前妖火含图主题用右上菜单“完整刷新”分别观察冷、热路径：冷路径只能看到一个全宽 4:3 占位和一个连续 Spinner，热路径保持最终几何尺寸，不再出现“小圈 → 大圈 → 图片”。再直达 `https://www.nodeseek.com/post-819647-1` 核对投票位置、分隔线和后文/sticker；四站各打开一个含图主题和普通文本主题，并检查图片预览与返回。全程只读，不清 App 数据、Cookie 或图片缓存。 |
| 负向验证方式 | 恢复 `useIMGElementState` 尺寸请求或让最终 `ExpoImage` 重新接收 URL 时，ImageRef source 身份和唯一 Spinner 断言必须失败；删除进程内尺寸缓存时，同 URL 重进首帧比例断言必须失败；让 inline 分支经过 `useImage` 时隔离断言必须失败。 |
| 明确不覆盖范围 | 不改变页面级“正在读取主题”、inline 图片和 sticker 自身加载策略，不持久化图片尺寸，不制造最短 Loading 时长，不执行保存图片、投票或其他写操作。 |

## `REG-TOPIC-005` V2EX 评论刷新失败却记录成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04`、`MORE-02` |
| 用户症状 | V2EX 详情中执行“仅刷新评论”遇到网络失败时，页面提示失败，但同一次评论刷新诊断仍以 `success` 结束，导出的诊断会误导排障。 |
| 触发条件 | V2EX 评论刷新委托给整篇 Topic 刷新；被委托请求返回已处理的 `completed`，但没有成功应用新详情。 |
| 根因 seam | `src/app/useTopicController.ts` 的 V2EX `refreshTopicReplies` 委托分支只判断 Promise 已结束，没有核对成功请求 generation 是否推进。 |
| 必须保持的行为 | 委托前后用已成功应用的 Topic request id 判定结果；只有新详情实际落地才记录成功，失败、stale 或 blocked 分别保留真实终态，同时保持旧详情可见。 |
| 精确失败 oracle | `src/app/useTopicController.test.ts` 让 V2EX `getTopic` 抛错，要求 `reply/refresh` trace 的唯一终态为 `failure`；修复前同一测试收到 `success`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：controller 与诊断 writer 足以固定委托和成功 generation；只看错误 Toast 或 Topic 子 trace 会漏掉错误的父终态。 |
| Replay 或真实验收路径 | 不主动制造真实来源故障；正常 V2EX 详情“仅刷新评论”仍做只读成功路径，确定性失败由自动测试固定。 |
| 负向验证方式 | 移除委托前后的成功 request id 对照并无条件 finish success，编号测试必须失败。 |
| 明确不覆盖范围 | 不改变 V2EX 回复获取协议、重试策略或页面错误文案，也不把普通网络失败自动重试。 |

## `REG-TOPIC-006` 图片保存快速双击写入重复文件

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片预览中快速点击两次“保存图片”，App 并行下载并向系统媒体库写入两份相同图片，随后还弹出两次成功提示。 |
| 触发条件 | 第一次保存仍在权限检查、代理等待、下载或媒体库写入期间再次点击保存。 |
| 根因 seam | `src/app/useImagePreviewController.ts` 的保存动作没有同步 busy gate，Modal 按钮的每次点击都会创建独立异步任务。 |
| 必须保持的行为 | 同一时刻只允许一个图片保存任务；忙碌期间的重复点击不发起下载、不写媒体库也不重复提示。当前任务成功或失败后必须释放门禁，随后可再次保存。 |
| 精确失败 oracle | `tests/ui/image-preview-controller.test.tsx` 的 `REG-TOPIC-006` 用 pending 保存 Promise 模拟快速双击，要求 `saveImageUriToLibrary` 与“图片已保存”提示都严格一次；修复前调用数为两次。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 hook 渲染测试固定 preview state、同步点击与异步完成的组合；单测 `imageSave` 不能证明 controller 没有重复调用。 |
| Replay 或真实验收路径 | 默认只检查图片预览与保存入口，不写系统媒体库；真实保存及重复点击只在用户明确授权后验收。 |
| 负向验证方式 | 删除 `saveBusyRef` 的进入检查或在 await 之后才置 busy，编号测试会观察到两次媒体库调用。 |
| 明确不覆盖范围 | 不改变图片格式、命名、相册位置、代理协议或权限申请语义，也不授权测试真实保存。 |

## `REG-TOPIC-007` 被取消的旧引用请求仍展开并覆盖新请求

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | 同一正文或评论引用快速触发两次加载时，后一次已经接管并取消前一次，但前一次迟到响应仍会展开并缓存旧内容；旧请求还可能提前关闭新请求的 Loading，或让已被替代的 linux.do 验证恢复继续执行。 |
| 触发条件 | 底层请求在收到 AbortSignal 后仍以成功或验证错误结束，同时用户仍停留在同一 Topic，并对同一个引用实例发起了更新请求。 |
| 根因 seam | `src/app/useTopicController.ts` 的引用读取只用当前 Topic key 判断结果归属，没有同时核对引用实例 generation、当前 AbortController 身份和 aborted 状态；验证恢复沿用了同一个过宽判断。 |
| 必须保持的行为 | 同一引用实例只有最新请求可缓存、展开、提示和结束 Loading；被替代请求无论迟到成功或失败都返回 stale。正文与评论的不同引用实例仍可独立并发。linux.do 验证恢复在同一逻辑链内可重复精确重试，但该引用被新的用户请求接管或离开原 Topic 后必须失效。 |
| 精确失败 oracle | `src/app/useTopicController.test.ts` 的两个 `REG-TOPIC-007` 用 pending Promise 固定竞态：第二个请求 abort 并接管后，先返回的旧响应必须得到 `stale` 且不得调用 `remember`/展开；已有验证恢复在新请求开始后 `isCurrent()` 必须变为 false。修复前分别收到 `completed` 和 true。 |
| 最低可靠自动测试层 | `UNIT_PASS`：controller 测试必须同时经过真实 quote request registry、AbortController 和恢复回调；只测 fetch abort 或最终展开内容无法证明迟到提交与 Loading 归属。 |
| Replay 或真实验收路径 | 只读打开含正文引用和评论引用的 linux.do Topic，分别展开、收起、再次展开并核对完整被引帖；不主动制造 Cloudflare 或依赖网络时序复现确定性竞态。 |
| 负向验证方式 | 把结果、catch、gateway `isCurrent` 或 Loading 收尾任一处恢复成只比较 Topic key，或让验证恢复不比较引用 generation，对应编号测试必须失败。 |
| 明确不覆盖范围 | 不改变引用内容解析、缓存键、Cloudflare 验证协议或跨引用并发策略；不通过延迟、重试或隐藏 Loading 掩盖竞态。 |

## `REG-WRITE-001` 首次投票后参与人数未更新

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在 linux.do 首次提交投票成功后，所选项和票数已经更新，但当前页面的参与人数仍保持提交前的数值。 |
| 触发条件 | 投票带有数值型 `participantCount`、当前尚未投票，并且成功响应进入统一的本地 `poll-vote` 补丁。 |
| 根因 seam | `src/topicActionState.ts` 的 `applyPollVoteToPolls` 只更新 `voted`、选中项和选项票数，没有同步参与人数。 |
| 必须保持的行为 | 首次成功投票使参与人数只增加 1；多选投票也只增加 1；每个新选中的选项票数增加 1；同一成功补丁即使被重复应用也不得重复计数。 |
| 精确失败 oracle | `src/topicActionState.test.ts` 的两个 `REG-WRITE-001` 用例分别固定单选与多选：单选从参与人数 4、选项票数 2 开始，首次应用后为 5 和 3；多选从参与人数 8 开始，两个所选项各加 1 但参与人数仅到 9；重复应用均不得再次增长。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定统一投票状态补丁的确定性计数；`LIVE_PASS` 再证明 App 内首次投票后的显示与原站最终结果一致。 |
| Replay 或真实验收路径 | 按 `tests/live/agent-live.md` 搜索精确关键词“投票”，打开真实 linux.do 投票 Topic；提交一次已授权投票后核对当前页面，再刷新或重新进入并与原站结果对照，不得为重试而再次投票。 |
| 负向验证方式 | 临时移除参与人数增量，`REG-WRITE-001` 单元用例必须从期望 5 精确失败为收到 4；恢复后重跑。 |
| 明确不覆盖范围 | 原站并发投票导致的动态总数变化、匿名或隐藏结果策略以及网络成功语义仍由 action client 与 App 内 Live 验收负责。 |

## `REG-WRITE-002` 妖火收藏成功被误报为结果不明

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在妖火主题点击“原站收藏”后，原站已经把主题加入收藏夹，但 App 丢失重定向证据并提示“操作结果无法确认”。 |
| 触发条件 | 使用 App 内已检测并全局保存的妖火登录态，对尚未原站收藏的主题请求一次 `/bbs/Share.aspx?action=fav&siteid=1000&classid=...&id=...`；妖火完成写入后跳转到 `/bbs/favlist.aspx` 并返回完整收藏夹页面。 |
| 根因 seam | `src/yaohuoActionClient.ts` 的请求 helper 只返回 HTML、丢弃最终 `Response.url`；通用解析器正确地拒绝从长页面文本猜测成功，却也无法知道该请求已经同源跳到收藏夹。旧开源代码中的二次表单流程与当前线上行为不一致。 |
| 必须保持的行为 | 收藏只发送一次既有 GET，不增加二次 POST；业务操作继续读取登录检测时全局保存的 Cookie，不在每次收藏时重读 WebView；只有当前收藏请求最终跳到妖火同源 `/bbs/favlist.aspx` 时补充“收藏成功”，登录、验证、HTTP 失败、明确失败提示和其他长页面继续阻断或保持不确定。 |
| 精确失败 oracle | `src/yaohuoActionClient.test.ts` 的 `REG-WRITE-002` 用例固定完整请求参数、恰好一次 GET、无 body、最终 URL 为同源收藏夹和结果文案“收藏成功”；修复前同一响应精确得到“操作结果无法确认，请刷新原帖核对”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定单次请求、最终 URL 和保守解析；`LIVE_PASS` 使用全局保存的登录态证明未收藏主题经 App 操作一次后真实进入妖火收藏夹。 |
| Replay 或真实验收路径 | App 内妖火 Topic → 原站收藏一次 → 更多 → 账号中心 → 妖火原站主页 → 我的 → 我的收藏；按标题或主题 id 核对目标存在。结果不明确时不得重投。 |
| 负向验证方式 | 把最终 URL 改为原帖、普通列表或其他主机时不得返回“收藏成功”；登录页、访问验证页和明确失败提示仍必须失败；若增加第二次 fetch，单次请求断言必须失败。 |
| 明确不覆盖范围 | 妖火投票、本机收藏、原站收藏分类管理、Cloudflare/访问验证和原站未来路由变更仍按各自能力与 Live 结果验收。 |

## `REG-WRITE-003` 妖火收藏无法取消且页面不显示已收藏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 妖火原站收藏成功后，App 详情页仍显示未收藏样式；再次点击仍执行添加，无法从 App 取消收藏；重新进入主题也不能恢复原站收藏状态。收藏列表暂时不可用时，主题正文和回复也会一起加载失败，或者未知状态被误显示成“未收藏”。 |
| 触发条件 | 已登录妖火并打开可收藏主题；原站收藏夹把帖子链接和独立的 `data-fav-id` 收藏记录 id 放在同一条目中，取消接口要求该记录 id，而不是帖子 id；或者主题正文与回复请求成功，但 `/bbs/favlist.aspx` 查询失败。 |
| 根因 seam | `src/yaohuoActionClient.ts` 只返回成功文案并丢弃收藏记录 id；`src/app/useTopicActionsController.ts` 始终构造添加请求且不应用状态；`src/yaohuoApi.ts` 未读取原站收藏状态，并曾把可选收藏查询放进主题加载的必需 `Promise.all`；`AppRoot`/`TopicScreenBody` 曾把 `undefined` 强制转换成 `false`，无法区分“未收藏”和“状态未知”。 |
| 必须保持的行为 | 主题加载使用已全局保存的登录态，对收藏列表做一次按标题过滤的只读查询，并按帖子 id 精确取得收藏记录 id；收藏查询失败时仍返回已成功取得的主题正文和回复，把 `bookmarked` 保持为 `undefined`，并把本次详情读取诊断标记为降级，使 caller-owned trace 的成功终态提升为 `partial`；未知状态显示“状态未知”、按钮禁用且不得发起写请求。收藏仍只发送一次既有 GET，从同一次收藏夹响应取得记录 id，不增加第二次写请求；服务端确认后立即显示黄色“取消原站收藏”；取消只发送一次 `/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=<收藏记录id>` POST，并仅在 JSON `success: true` 后清除样式；不得在每次操作时重读 WebView Cookie。 |
| 精确失败 oracle | `src/yaohuoApi.test.ts` 固定按标题查询但按帖子 id 匹配记录，并固定收藏查询抛错时主题正文和回复仍可读、收藏字段缺省且 source summary 的 `partialErrorCount` 为 1、`hasDegradation` 为真；`src/sources/sourceGatewayContract.test.ts` 固定该降级进入 caller-owned Topic trace 后只有一个 `partial` 终态且诊断不含主题、正文、URL 或 Cookie；`src/yaohuoActionClient.test.ts` 固定收藏响应返回记录 id、取消 POST 和失败 JSON 不误报；`src/app/useTopicActionsController.test.ts` 固定添加/取消后的 `bookmark` 补丁；`tests/ui/topic-reply-filters.test.tsx` 固定已收藏时按钮为选中、`favorite` 色调并显示“取消原站收藏”，状态未知时显示对应文案、禁用且不调用操作回调。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定请求、解析和状态补丁；`UI_PASS` 固定用户可见按钮状态与既有黄色样式接线；`LIVE_PASS` 证明 App 按钮、重新进入后的状态和妖火原站收藏夹一致。 |
| Replay 或真实验收路径 | 选择可重新找到的妖火主题并记录初始状态；若已收藏，先在 App 取消并核对按钮与原站收藏夹均消失，再重新收藏恢复；若未收藏则反向操作。每一步只操作一次，重新进入主题核对，最终恢复初始状态。 |
| 负向验证方式 | 把收藏条目的帖子 id 改为其他值时不得采用其记录 id；让收藏查询抛错时不得阻断正文、把未知状态变成可点击的未收藏按钮，或把整体详情读取误记为 `success`；取消 JSON 为 `success: false` 或非 JSON 时不得清除激活状态；移除控制器状态补丁或 UI 的 `active`/`favorite` 接线时对应测试必须失败。 |
| 明确不覆盖范围 | 妖火收藏分类管理、批量清空、原站未来 HTML/接口变更和访问验证仍按各自能力验收；状态未知不会自动重试或猜测收藏结果。 |

## `REG-WRITE-004` 妖火收藏触发整页忙碌闪动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在妖火主题点击收藏或取消收藏时，整页操作区会短暂变灰并闪动，而不是只更新收藏按钮。 |
| 触发条件 | 妖火收藏进入统一请求 helper；请求开始和结束分别切换全局 `actionBusy`，该状态同时进入 Topic 列表 `extraData` 和所有操作按钮的禁用样式。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 的 `runYaohuoRequest` 把 busy 写死为全局 `true`，没有沿用 `ActionRunOptions.busy`；收藏请求因此无法选择已有的非全局忙碌路径。 |
| 必须保持的行为 | 妖火收藏和取消请求使用 `busy: false`，服务端确认后只通过既有 `bookmark` 补丁更新收藏按钮；不得刷新主题、切换全局 `actionBusy` 或改变滚动位置；其他需要全局门禁的妖火写操作继续保持默认 busy。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-WRITE-004` 断言收藏成功仍应用精确 `bookmark` 补丁，同时 `setActionBusy` 零调用；修复前精确收到 `true`、`false` 两次调用。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定控制器状态边界；`LIVE_PASS` 再确认真实请求期间页面不整体变灰、内容和滚动位置不跳动，只有收藏按钮在确认后改变。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 记录初始状态后收藏或取消一次，观察请求期间页面其余内容和操作按钮，确认结果后核对收藏按钮及原站状态，最后恢复初始状态。 |
| 负向验证方式 | 移除收藏调用的 `busy: false`，测试必须精确失败并记录全局 busy 的 `true`、`false` 调用；收藏协议或结果不确认时仍不得误切按钮状态。 |
| 明确不覆盖范围 | Android 原生 ripple、网络耗时和成功提示自身的动画不属于整页 busy 闪动；服务端确认后正文被重新提交造成的独立闪烁由 `REG-WRITE-005` 覆盖。 |

## `REG-WRITE-005` 妖火收藏确认后正文被重新提交并闪烁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 点击妖火“原站收藏”或“取消原站收藏”后，最终滚动位置看似不变，但正文会在约 170 ms 内闪一下；含图正文会短暂退回灰色 loading 占位，单张操作前后截图容易漏掉。 |
| 触发条件 | 妖火服务端确认后，本地用新 `TopicDetail` 对象应用只包含 `bookmarked`/`bookmarkId` 的补丁。布局使用的主题对象已经稳定，但 HTML 渲染输入或 Topic screen action callback 仍跟随原始对象换引用。 |
| 根因 seam | `src/app/useHtmlRenderingController.tsx` 的链接处理曾直接依赖原始 `topicDetail`，导致 HTML renderer registry 重建；同时 `src/app/AppRoot.tsx` 传入 Topic screen 的多个 action callback 闭包随原始详情换引用，嵌在 route renderer 内的收藏 Context 又使整棵 Topic screen 被重新提交。为稳定这些引用而在 render 阶段写 ref 又会让被 React 丢弃的 render 泄漏未提交状态。FlashList/HTML 图片因此可能重新进入加载态或采用错误引用。 |
| 必须保持的行为 | 收藏确认只更新收藏按钮及成功提示；布局主题、筛选回复、HTML renderer 与 renderer props 在只改收藏字段时保持引用稳定；Topic screen 使用稳定 handler 转发到最新已提交实现，相关 ref 只在 layout effect 提交后更新，render 保持纯净；收藏 Context 位于 route renderer 外侧。正文、图片、回复列表和滚动位置都不得重新提交或重载。 |
| 精确失败 oracle | `tests/ui/topic-reply-filters.test.tsx` 的 `REG-WRITE-005` 对收藏与取消两个方向连续换入只含收藏字段差异的详情，断言 `htmlRenderers` 和 `htmlRenderersProps` 始终保持同一引用；`npm run check:react` 要求本次相关变更不存在 `no-ref-current-in-render` 或 `no-prop-callback-in-render`。真实可见 oracle 使用 30 fps 录屏逐帧检查：修复前收藏/取消确认曾分别出现约 50.0%/55.5% 正文像素变化和灰色图片占位，修复后同路径正文变化最高约 0.315%，只剩按钮与 Toast 局部动画。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 React render purity，`UI_PASS` 固定 bookmark-only 更新不会重建 HTML 渲染输入；React Native 原生图片和 FlashList 的瞬时重新提交仍必须用 `LIVE_PASS` 的 30 fps 录屏确认，最终截图不能替代。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 在收藏按钮、正文图片和回复区同时可见的位置开始 30 fps 录屏，静置后只点击一次，持续到服务端确认后至少 1 秒；逐帧检查正文不得出现其他楼层、灰色占位或大面积明暗跳变。收藏和取消两个方向都验收，最后恢复初始状态。 |
| 负向验证方式 | 临时恢复 HTML controller 对原始详情的依赖时，`REG-WRITE-005` UI 用例必须因 renderer 引用变化失败；把 committed ref 更新移回 render 阶段时 React Doctor 必须失败；临时改回随详情变化的 Topic handler/route 内收藏 Provider 时，30 fps 设备 oracle 必须重新捕获正文或图片的大面积重绘。 |
| 明确不覆盖范围 | 收藏按钮 ripple、黄色选中样式和成功 Toast 的局部动画允许变化；首次进入主题时的正常图片加载、网络耗时、图片源自身更新和其他站点的互动状态由各自能力验收。 |

## `REG-WRITE-006` 阅读设置返回覆盖已确认的原站收藏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03`、`TOPIC-04`、`NAV-03` |
| 用户症状 | 妖火原站已经确认收藏或取消，但用户在请求期间打开阅读设置，返回后按钮恢复成请求前状态，App 与服务器不一致。 |
| 触发条件 | 进入阅读设置时保存 Topic route snapshot；非全局 busy 的收藏请求随后完成并更新当前 Topic；返回时旧 snapshot 覆盖最新 `bookmarked`/`bookmarkId`。 |
| 根因 seam | `src/app/useTopicSessionController.ts` 的 action update 只更新当前 React state，没有同步当前活动 route 已保存的 snapshot。 |
| 必须保持的行为 | action 确认后同时补丁当前 Topic state 和当前活动 route snapshot；从阅读设置或覆盖层返回时保留已确认的收藏、互动、投票和回复删除结果，同时继续恢复筛选、草稿和滚动上下文。 |
| 精确失败 oracle | `tests/ui/topic-session-controller.test.tsx` 保存未收藏 Topic route，应用收藏成功补丁后恢复同一路由，最终仍必须为 `bookmarked=true` 且保留 `bookmarkId`；修复前恢复为未收藏。 |
| 最低可靠自动测试层 | `UI_PASS` 通过真实 hook state/update/restore 生命周期固定竞态；真实原站最终一致性仍需获授权的 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 确定性测试模拟请求完成；真实验收仅在逐次授权后执行妖火收藏 → 立即打开阅读设置 → 等待确认 → 返回，并与原站收藏夹核对后恢复初始状态。 |
| 负向验证方式 | 移除 action update 对活动 route snapshot 的补丁，测试会在 restore 后精确收到 `bookmarked=false`。 |
| 明确不覆盖范围 | 不替代服务端并发变更、失败响应和访问验证处理；只有已由 action client 确认的结果进入 snapshot。 |

## `REG-WRITE-007` NodeSeek 投票读取失败且提交后伪造票数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 用户症状 | NodeSeek 主题正文保留 `nsapp://vote` 原始标记而没有可用投票卡片；多个投票标记中一个读取失败时详情仍被误报为完整成功。提交成功后 App 又只做本地 `+1`，把原站未返回的未知票数显示成 `1`，与刷新后的服务端结果不一致。 |
| 触发条件 | `/api/vote/info/{id}` 缺少原站动态签名而返回 403；读取链路把投票 header 扩散到普通 JSON API，或成功/失败标记没有分别清理；写链路只根据 POST 返回做本地增量，没有调用原站提交后的结果 GET。 |
| 根因 seam | `src/nodeseekPolls.ts` 的 NodeSeek 投票协议、`src/localNodeseek.ts` 的标记读取/清理和 partial 诊断、`src/nodeseekActions.ts` 与 `src/nodeseekActionClient.ts` 的投票专用请求、`src/app/useTopicActionsController.ts` 的写后同步，以及 `src/topicActionState.ts` 的服务端快照/未知计数合并。 |
| 必须保持的行为 | 只有 NodeSeek 投票 GET/POST 携带 JSON `Accept` 和已验证 fallback `x-dynamic-sign`，继续复用现有 Cookie、User-Agent、Referer、超时与代理通道；未投票时不提前展示结果票数，已投票、多选和锁定状态按 API 归一化；只删除成功加载投票对应的原始标记，失败标记保留且详情诊断为 `partial`。POST 成功后固定只读 GET 一次并合并完整服务端快照到 Topic/action snapshot，不刷新整篇正文；GET 失败仍保留已投和所选项、未知票数保持未知、提示刷新失败并记 `partial`，绝不重发 POST。 |
| 精确失败 oracle | `src/localSources.test.ts` 模拟缺少签名即 403，固定未投/已投、多选/锁定、多个标记部分失败、成功标记删除与失败标记保留；`src/nodeseekActions.test.ts`、`src/nodeseekActionClient.test.ts` 固定投票专用 header 和权威结果 GET；`src/app/useTopicActionsController.test.ts` 固定 `POST × 1 → GET × 1`、服务端快照与 GET 失败的单次 POST；`src/topicActionState.test.ts` 固定已知票数正常合并、未知票数不伪造成 `1`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定来源协议、controller 顺序和状态合并；当天原站签名是否仍接受、App 内登录态 API 与刷新后显示必须由 `LIVE_PASS` 核实。公共 `TopicPolls` 没有改变，既有四站 UI 用例继续作为共享回归。 |
| Replay 或真实验收路径 | 给定 NodeSeek URL 时必须直达 App 内详情，不得用搜索替代。已投目标只读核对所选项、动态票数、禁用状态和原始标记消失；另找未投目标只能在逐次授权后提交一次，记录准确选项，并刷新/重进 App 与 App 内原站核对。结果不明立即停止且不得重试；没有合格目标记 `NOT_VERIFIED`，不新增动态 Replay。 |
| 负向验证方式 | 去掉任一投票请求的动态签名，来源测试必须收到 403；恢复“全部标记一起删除”或忽略部分失败时 partial/标记测试必须失败；跳过写后 GET、重复 POST 或把未知票数增量成 `1` 时 controller/state 测试必须失败。 |
| 明确不覆盖范围 | 不读取投票者名单，不新增加密依赖，不等待或抓取隐藏 WebView 投票 DOM，不改变 LinuxDo/妖火投票协议和 V2EX 只读行为。未来 fallback 返回 403 时先记录新 bug 和原站证据，不自动改走 DOM 或猜测新签名。 |

## `REG-WRITE-008` NodeSeek 不可逆投票未经确认直接提交

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 用户在 NodeSeek 投票卡片点提交后立即产生不可逆远端写入，没有机会核对选项或取消。 |
| 触发条件 | 三站共用投票 controller 路径直接创建并发送请求，没有保留 NodeSeek 原站“提交后不可修改”的确认语义。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 的站点分流与 non-idempotent action key；确认边界属于 NodeSeek，不属于公共 `TopicPolls` 或其他站点协议。 |
| 必须保持的行为 | NodeSeek 点击提交先显示“提交后不可修改”确认；取消时不创建写请求、不改变已选择的本地选项；确认按钮只进入一次现有 non-idempotent 提交流程。LinuxDo、妖火继续当前提交行为，V2EX 保持只读。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-WRITE-008` 分别断言取消为零请求/零状态补丁、重复触发确认仍只有一次 NodeSeek POST，以及 LinuxDo/妖火不新增该确认；`src/nodeseekActions.test.ts` 固定确认后才会使用的请求结构。 |
| 最低可靠自动测试层 | `UNIT_PASS` 的 controller 行为测试足以固定确认门禁和请求次数；系统 Alert 在真实 App 的文案、取消和返回行为由只读 `LIVE_PASS` 核实。 |
| Replay 或真实验收路径 | 在未投 NodeSeek 主题选择准确选项，打开确认框后只点击取消，确认选项仍保留且刷新前服务端状态未变化。真正提交必须对该具体主题和选项重新逐次授权；一次授权只允许一次提交。 |
| 负向验证方式 | 把 NodeSeek 分支移回确认前的 `submitVote()`，取消测试会观察到一次请求；移除确认闭包的一次性门禁，重复确认测试会观察到多个 POST；把确认放入公共组件时 LinuxDo/妖火回归会失败。 |
| 明确不覆盖范围 | 不给 LinuxDo 或妖火增加二次确认，不改变公共投票卡片样式，不授权任何真实投票，也不把确认弹窗录成依赖动态目标的 tracked Replay。 |

## `REG-WRITE-009` NodeSeek 投票脱离正文被追加到底部

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 用户症状 | NodeSeek 原帖中的投票标记位于正文中间，但 App 删除标记后把投票卡片统一追加到整段正文末尾，改变了原帖阅读顺序。 |
| 触发条件 | NodeSeek 投票 API 或渲染表单成功解析后只保留 `Topic.polls`，正文没有留下位置占位；`TopicScreenBody` 又把所有非 LinuxDo 投票走底部 fallback。真实页面还可能同时出现渲染表单、相邻的 `">` 前缀块和同一 `nsapp://vote` 标记，若按出现次数渲染会重复卡片并触发重复 key。 |
| 根因 seam | `src/nodeseekPolls.ts` 的成功标记替换和正文分片、`src/localNodeseek.ts` 的渲染表单占位，以及 `src/screens/topic/TopicScreenBody.tsx` 的逐来源正文渲染边界。 |
| 必须保持的行为 | 成功解析的 NodeSeek 投票用站点专属占位保留原正文位置，UI 按“前文 → 投票 → 后文”只渲染一次；同一 id 的重复标记及其纯 `">` 前缀块必须清理，失败标记继续原样保留并记 `partial`。LinuxDo、妖火、V2EX 和公共 `TopicPolls` 行为不变。 |
| 精确失败 oracle | `src/localSources.test.ts` 固定 API 标记、渲染表单以及“相邻 `">` 块 + 重复标记”的真实形态只产出一个 NodeSeek 占位；`tests/ui/topic-reply-filters.test.tsx` 固定重复占位输入下投票节点仍位于前后正文之间且只出现一次。 |
| 最低可靠自动测试层 | 来源 Vitest 固定占位数据，RNTL 固定用户可见顺序；真实 NodeSeek 主题由只读 `LIVE_PASS` 核对位置。 |
| Replay 或真实验收路径 | 直达包含投票且投票前后都有正文的 NodeSeek 主题，只读确认卡片位于原标记位置、没有底部副本且原始 `nsapp://vote` 不可见；不得再次投票。 |
| 负向验证方式 | 删除正文占位或恢复非 LinuxDo 底部追加后，RNTL 会观察到“后文 → 投票”的错误顺序；重复保留底部卡片会使唯一性断言失败。 |
| 明确不覆盖范围 | 不调整投票卡片视觉样式，不改变评论内投票或其他站点位置规则，不新增公共占位协议。 |

## `REG-WRITE-010` NodeSeek 投票替换破坏正文段落并导致内容重叠

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`WRITE-03`；共享详情渲染 seam 回归 `TOPIC-03`、`NAV-03` |
| 用户症状 | NodeSeek 投票帖在 App 中残留字面量 `">`，投票卡片前后各多出一条正文分隔线；投票后的文字与 sticker 在底部重叠，而原站同一正文没有这些问题。 |
| 触发条件 | 原站 hydrated DOM 把块级 `.vote-panel` 放在 `<p>` 内，且投票前后仍有 `<br>`、文本或 sticker；HTML parser 会按规范提前闭合无效段落。若先解析再替换投票，或把占位符前后拆成多个正文块，原始流式上下文会丢失。 |
| 根因 seam | `src/localNodeseek.ts` 的原站渲染 HTML 提取/投票表单替换、`src/nodeseekPolls.ts` 的残留 marker 清理，以及 `src/screens/topic/TopicScreenBody.tsx` 的正文树与自定义投票 renderer 边界。 |
| 必须保持的行为 | 首轮 parser 只识别投票表单并取得其原始源码 range，不从已被自动修正结构的 AST 读取正文 `innerHTML`；在序列化前按原始 range 把成功解析的投票面板原位替换为一个 opaque block 占位。整篇 NodeSeek 正文只进入一个 HTML 渲染树，投票 renderer 在树内就地渲染。只清理与成功占位相邻且内容严格为可选引号加 `>` 的泄漏前缀，合法正文 `1 > 0` 必须保留；投票后的文字、图片和 sticker 继续走既有公共排版规则。其他来源、回复、详情返回和公共 `TopicPolls` 行为不变。 |
| 精确失败 oracle | `src/localSources.test.ts` 的 `REG-WRITE-010` fixture 保留目标帖的“同一 `<p>` 内前文 + `">` + 块级投票 + 后文 + sticker”形态，要求无泄漏前缀、合法 `1 > 0` 仍在、前文/唯一占位/后文顺序不变且段落不被拆散；`tests/ui/topic-reply-filters.test.tsx` 要求该输入只有一个正文渲染根，投票只出现一次并位于前后文之间。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定原始 HTML range 替换和负向文本边界；`UI_PASS` 固定单一正文树及用户可见顺序；Android 的分隔线和文字/sticker 几何关系由只读 `LIVE_PASS` 核对。 |
| Replay 或真实验收路径 | 直达 `https://www.nodeseek.com/post-819647-1`，再从主题菜单“原站打开”对照；只读确认无字面量 `">`、投票前后没有新增正文分隔线、卡片仍在原位、后文与 sticker 不重叠且正文底部无副本。另直达一个“投票独占段落”和一个“投票前有正文”的 NodeSeek 样本作负向对照，不选择选项或提交。 |
| 负向验证方式 | 恢复“先 parse/mutate 再取 innerHTML”时 Vitest 会收到提前闭合的段落和泄漏前缀；恢复按占位符切分正文时 RNTL 会收到多个正文根。把清理规则放宽到任意含 `>` 文本时，合法 `1 > 0` 断言必须失败。 |
| 明确不覆盖范围 | 不修正 NodeSeek 原站的无效 HTML，不改变 sticker 尺寸/公共图片流算法，不增加投票卡片自身分隔线或新样式，不执行任何真实投票。 |

## `REG-ACCOUNT-010` NodeImage 旧授权与上传覆盖已清除凭据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 用户症状 | 用户取消授权或清除 NodeImage API Key 后，较早的保存、读取或上传仍可能迟到，重新写回旧 Key 或把旧上传结果插入当前草稿。 |
| 触发条件 | SecureStore 操作或上传处于 pending，期间发生新授权、取消或清除；WebView bridge 还可能在错误授权阶段接收另一 host 的消息。 |
| 根因 seam | `src/nodeimageCredentials.ts` 的凭据 generation、`src/loginWebViewNavigation.ts` 的阶段来源门禁，以及 `src/app/useTopicActionsController.ts` 的上传结果所有权。 |
| 必须保持的行为 | 每次保存/清除都推进 generation，旧读取需重读当前值，取消中的保存恢复先前 Key；bridge 消息必须来自其阶段 owner；上传完成时 generation 已变化则不得插入 Markdown。 |
| 精确失败 oracle | `src/nodeimageCredentials.test.ts` 固定旧保存、旧读取和取消恢复竞态；`src/loginWebViewNavigation.test.ts` 固定阶段 host；`src/app/useTopicActionsController.test.ts` 固定清除 Key 后迟到上传不落地。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须控制异步完成顺序并观察 SecureStore、草稿和 bridge 决策。 |
| Replay 或真实验收路径 | NodeImage 授权和真实上传会产生外部状态，只在逐次授权后验收；只读设备验收仅检查入口和取消。 |
| 负向验证方式 | 移除任一 generation 或阶段来源检查，编号测试必须观察到旧 Key/旧上传落地或跨阶段消息被接受。 |
| 明确不覆盖范围 | 不清除真实 NodeImage 文件，不代表真实上传、删除或授权已获许可。 |

## `REG-ACCOUNT-011` 隐藏 WebView 接受伪造来源的读取结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04` |
| 用户症状 | 恶意或被跳转的页面可以发送一个声称来自 NodeSeek 或 linux.do URL 的完成消息，使 App 接受非目标页面的 HTML、Cookie 或状态。 |
| 触发条件 | WebView 当前 document 的 URL 与 bridge payload 内的 URL 不同，但 controller 只校验 payload。 |
| 根因 seam | `src/app/useHiddenBrowserFetchController.ts` 对原生 message event URL 与 payload URL 的双重来源校验。 |
| 必须保持的行为 | 只有 event document 与 payload 都是同一受信 HTTPS origin，且属于当前请求 owner，才允许完成隐藏读取。 |
| 精确失败 oracle | `tests/ui/hidden-browser-fetch-controller.test.tsx` 对 linux.do 和 NodeSeek 注入跨 origin document、可信 payload，均必须拒绝且不调用完成回调。 |
| 最低可靠自动测试层 | `UI_PASS`：需要经过 hook 的真实 message 生命周期和当前请求状态。 |
| Replay 或真实验收路径 | 正常 App 内隐藏读取继续只读验收；不导航到恶意站点制造现场。 |
| 负向验证方式 | 只保留 payload URL 校验时，两个编号用例都会接受伪造消息。 |
| 明确不覆盖范围 | 不证明目标站页面本身无 XSS，也不允许 HTTP、子域或相似域名。 |

## `REG-ACCOUNT-012` document.cookie 覆盖并丢失完整会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-02` |
| 用户症状 | 隐藏 WebView 只回传 JavaScript 可见 Cookie 时，App 用它替换完整已存会话，导致 HttpOnly Cookie 丢失；NodeSeek 媒体请求还可能继续使用旧 Cookie。 |
| 触发条件 | 当前 SecureStore 有完整 Cookie header，隐藏读取只包含 `document.cookie`，随后执行保存或清除。 |
| 根因 seam | `src/app/sessionControllerHelpers.ts` 的 Cookie 合并以及 NodeSeek 媒体凭据同步/清除边界。 |
| 必须保持的行为 | document Cookie 只按名称合并进当前完整 header，未回传的 HttpOnly Cookie保留；保存、失效和清除时媒体 header 与主会话保持一致。 |
| 精确失败 oracle | `src/app/sessionControllerHelpers.test.ts` 分别固定 NodeSeek/linux.do 的 HttpOnly 保留，以及 NodeSeek 主会话清除时媒体凭据同步清除。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须直接比较合并后的完整 Cookie 和媒体凭据副作用。 |
| Replay 或真实验收路径 | App 内登录态只读加载详情与图片；不得为复现而清 Cookie。 |
| 负向验证方式 | 恢复直接覆盖或漏掉媒体清除，编号测试会丢失 HttpOnly 值或保留旧媒体 header。 |
| 明确不覆盖范围 | 不从 JavaScript 推断不可见 Cookie 的新值，也不迁移其他站点 Cookie 格式。 |

## `REG-ACCOUNT-013` NodeSeek 缺失 Cookie 未归类为会话失效

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 已进入 NodeSeek 写操作但本机 Cookie 缺失时，只收到泛化“缺少凭据”错误，UI 无法进入明确的重新登录流程。 |
| 触发条件 | action client 被调用时 credential loader 返回空值。 |
| 根因 seam | `src/nodeseekActionClient.ts` 在发请求前对空凭据的 typed source/login-required 分类。 |
| 必须保持的行为 | 空 Cookie 必须在零网络请求下抛出 NodeSeek 会话失效错误，并携带可供 controller 打开登录入口的分类。 |
| 精确失败 oracle | `src/nodeseekActionClient.test.ts` 要求 fetch 为零次，错误包含 `source=nodeseek` 与登录失效语义。 |
| 最低可靠自动测试层 | `UNIT_PASS`：请求次数与 typed error 都必须固定。 |
| Replay 或真实验收路径 | 自然失效时检查登录提示；不得主动清登录态制造状态。 |
| 负向验证方式 | 改回通用 Error 或继续发请求，编号测试必须失败。 |
| 明确不覆盖范围 | 不判定服务器返回的所有 4xx 都是退出，也不自动删除 Cookie。 |

## `REG-ACCOUNT-014` 损坏的会话存储被当成匿名

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | NodeSeek 或 linux.do 保存的会话 JSON 损坏后，App 把读取结果当成“未登录”，可能覆盖现场并隐藏真正的数据损坏。 |
| 触发条件 | SecureStore key 存在但 JSON 无法解析或结构无效。 |
| 根因 seam | `src/app/sessionControllerHelpers.ts` 与 `src/linuxdoCookieBridge.ts` 的持久化读取错误分类。 |
| 必须保持的行为 | key 缺失可以表示匿名；key 存在但无法解码必须抛出可诊断错误、保留存储且不自动清理。 |
| 精确失败 oracle | `src/app/sessionControllerHelpers.test.ts` 与 `src/linuxdoCookieBridge.test.ts` 注入损坏 JSON，要求 rejection 且诊断不宣称匿名成功。 |
| 最低可靠自动测试层 | `UNIT_PASS`：SecureStore 故障注入足以固定解码边界。 |
| Replay 或真实验收路径 | 不破坏设备 SecureStore；真实损坏只能报告为 `BLOCKED_BY_ENV` 后由用户决定恢复。 |
| 负向验证方式 | 再次吞掉 JSON 解析异常，编号测试会得到空会话而非 rejection。 |
| 明确不覆盖范围 | 不自动修复、删除或猜测损坏会话内容。 |

## `REG-ACCOUNT-015` 单个 Cookie 故障中止其余清理

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 清除站点登录时，一个 URL 读取或一个 Cookie 删除失败会阻止其他可达 Cookie 清除；已成功删除的 Cookie 也可能未 flush，却被误报为清理完成。 |
| 触发条件 | 多 URL Cookie store 中部分 `get`/`remove` reject，或原生 `remove` 返回 `false`。 |
| 根因 seam | `src/cookieCleanup.ts` 的全目标遍历、删除确认、flush 与聚合错误顺序。 |
| 必须保持的行为 | 所有可达 URL/Cookie 都尝试清理；`false` 算失败；只要有成功删除就 flush，随后聚合报告全部失败，绝不宣称完全成功。 |
| 精确失败 oracle | `src/cookieCleanup.test.ts` 分别固定读取失败隔离、删除失败后仍 flush 和 `false` 返回值分类。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须精确断言每个 native 调用及最终错误。 |
| Replay 或真实验收路径 | 清除真实登录需明确授权，本轮仅执行确定性测试。 |
| 负向验证方式 | 恢复串行 fail-fast 或忽略 `false`，相应用例会漏删、漏 flush 或错误成功。 |
| 明确不覆盖范围 | 不清 App 数据，不清其他站点，也不保证第三方 CookieStore 实现能删除 HttpOnly Cookie。 |

## `REG-DATA-002` 旧保存失败后设置写入丢失资料快照

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01`、`DATA-02` |
| 用户症状 | 一次收藏/历史保存失败后，紧接着只改阅读设置，后一次成功写入可能只带设置而漏掉最新 ReaderData。 |
| 触发条件 | 较早的 record save 在较晚 settings mutation 入队前失败，controller 以乐观而非最后已提交快照构建后续保存。 |
| 根因 seam | `src/app/useReaderDataController.ts` 的提交队列与完整快照基线。 |
| 必须保持的行为 | 每个后续 mutation 都基于最后已提交完整快照；旧保存失败后，较晚设置修改仍要重写当前资料和设置。 |
| 精确失败 oracle | `tests/ui/reader-data-controller.test.tsx` 控制首个保存失败，再改设置，要求第二次保存包含最新完整 ReaderData。 |
| 最低可靠自动测试层 | `UI_PASS`：需要 hook 跨 mutation 的排队与已提交状态。 |
| Replay 或真实验收路径 | 可逆本机设置/收藏仅在获授权时做重启验收；自动测试固定故障分支。 |
| 负向验证方式 | 让后续保存继续基于失败前的乐观快照，编号测试会观察到资料字段丢失。 |
| 明确不覆盖范围 | 不改变备份格式，也不把远端收藏写入 ReaderData。 |

## `REG-DATA-003` 配对写入与回滚双失败后仍继续保存

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03` |
| 用户症状 | ReaderData 已写入但 settings 写失败，连旧快照回滚也失败后，磁盘状态未知；后续 queued 保存仍继续，可能永久覆盖可恢复现场。 |
| 触发条件 | 两个 AsyncStorage key 的配对写部分成功，补偿回滚再次失败。 |
| 根因 seam | `src/readerDataStore.ts` 的原子补偿和 `src/app/useReaderDataController.ts` 的未知状态熔断。 |
| 必须保持的行为 | 配对写失败必须尝试恢复旧完整快照并用 `AggregateError` 保留原错与回滚错；回滚失败后取消已排队保存并暂停新 mutation，直到显式备份恢复成功。 |
| 精确失败 oracle | `src/readerDataStore.test.ts` 固定补偿；`tests/ui/reader-data-controller.test.tsx` 固定 queued 与未来 mutation 均不再落盘。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：store 原子语义和 controller 熔断都必须覆盖。 |
| Replay 或真实验收路径 | 不主动破坏设备存储；真实未知状态只允许用户选择备份恢复。 |
| 负向验证方式 | 去掉补偿或熔断，测试会只收到单错、继续执行 queued save 或接受新 mutation。 |
| 明确不覆盖范围 | 不声称 AsyncStorage 提供事务，也不自动选择丢弃哪一侧数据。 |

## `REG-DATA-004` 未知磁盘状态下相同备份被跳过

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01`、`DATA-03` |
| 用户症状 | 配对写回滚失败后，用户导入内容恰好与内存相同的备份，JSON 相等优化会跳过物理写，损坏或未知的磁盘仍未恢复。 |
| 触发条件 | controller 处于 recovery-required，导入快照与最后已知内存值深相等。 |
| 根因 seam | `src/app/useReaderDataController.ts` 的 no-op 去重与恢复强制写边界。 |
| 必须保持的行为 | recovery-required 时备份导入必须强制完整物理写；只有写入成功才解除暂停。正常状态仍可跳过真正 no-op。 |
| 精确失败 oracle | `tests/ui/reader-data-controller.test.tsx` 先制造未知磁盘状态，再导入相同备份，要求发生物理写并恢复可修改状态。 |
| 最低可靠自动测试层 | `UI_PASS`：需要完整 recovery 生命周期而非单个序列化函数。 |
| Replay 或真实验收路径 | 真实导入有数据风险，必须按具体备份获授权。 |
| 负向验证方式 | 在恢复路径复用普通 JSON 相等短路，编号测试的物理写次数为零。 |
| 明确不覆盖范围 | 不验证用户备份内容真实性，也不自动导入任何文件。 |

## `REG-DATA-005` 关注用户统计保留非法值并漏算零值

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01`、`USER-02`、`LIBRARY-02` |
| 用户症状 | 老备份或异常来源中的负数、小数统计直接出现在关注用户；妖火主题或回复数为 0 时，总贴数又被当成缺失。 |
| 触发条件 | 恢复 followedUsers 时统计未做统一约束，派生总数使用 truthy 判断。 |
| 根因 seam | `src/readerData.ts` 的 UserProfile 统计清洗和妖火派生字段。 |
| 必须保持的行为 | 已定义统计归一为有限、非负整数；缺失保持 undefined；两个组成值只要都已定义，包括 0，就派生总数。 |
| 精确失败 oracle | `src/readerData.test.ts` 注入负数、小数、非有限值和零值组合，固定清洗与派生结果。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | Library → 关注用户只读核对显示；不修改真实关注状态。 |
| 负向验证方式 | 恢复 truthy/原值直通，编号测试会保留非法值或漏掉 0 的总数。 |
| 明确不覆盖范围 | 不伪造来源没有返回的统计，也不反推 V2EX 等分页数组总量。 |

## `REG-FEED-005` 单站分类错误被当成空分类

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 进入单站时分类请求失败，筛选栏静默显示为空，用户无法区分“该站无分类”和“加载失败”。 |
| 触发条件 | gateway 返回 `items=[]` 同时携带当前来源 error，controller 仍应用空数组。 |
| 根因 seam | `src/app/useFeedController.ts` 的单站 category 结果应用和错误通知边界。 |
| 必须保持的行为 | 单站分类有来源错误时不把空结果当成功，保留可信旧分类并显示可重试提示；合法空分类仍可成功。 |
| 精确失败 oracle | `tests/ui/feed-controller-xiaoyinsi.test.tsx` 注入小隐寺单站空错误结果，要求 notify 且不应用成功空态。 |
| 最低可靠自动测试层 | `UI_PASS`：必须观察 hook 的分类状态和用户提示。 |
| Replay 或真实验收路径 | 逐站打开分类筛选；自然故障时确认错误可见，不人为阻断网络。 |
| 负向验证方式 | 在检查 errors 前应用 `items=[]`，编号测试会静默得到空分类。 |
| 明确不覆盖范围 | 不保证来源当天一定返回分类，也不把聚合分类策略改成单站策略。 |

## `REG-PROXY-002` 快速代理操作应用未提交或过期配置

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01` |
| 用户症状 | 快速保存、切换、启用或关闭代理时，原生层可能应用尚未持久化的配置或较早 profile；保存未改动的启用 profile 还可能让可用代理变成错误状态。 |
| 触发条件 | 多个异步持久化和 native apply 并发完成，后一次操作从乐观 state 而非已提交 state 构建。 |
| 根因 seam | `src/app/useNetworkProxyController.ts` 的持久化队列、native apply 队列与 committed state。 |
| 必须保持的行为 | 所有命令按提交顺序串行；profile 先保存成功再 apply；后一次 edit 基于已提交状态；最终 enable/disable 与最后命令一致；未改动的启用 profile 保持可用。 |
| 精确失败 oracle | `tests/ui/network-proxy-controller.test.tsx` 固定并发保存、选择、保存失败、no-op 保存以及快速启停的完成顺序。 |
| 最低可靠自动测试层 | `UI_PASS`：需要 hook 与两个异步副作用队列。 |
| Replay 或真实验收路径 | 真实启用/关闭会改变网络路径，需获授权并最终恢复；本轮不改设备代理。 |
| 负向验证方式 | 恢复直接并发 save/apply，任一编号用例会观察到提前 apply、旧配置或错误最终状态。 |
| 明确不覆盖范围 | 不验证特定代理服务器可用性，也不绕过 fail-closed 网络门禁。 |

## `REG-PROXY-003` 代理状态损坏后无法恢复直连

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01` |
| 用户症状 | 安全存储中的代理配置无法读取时，App 正确 fail-closed，但 UI 没有恢复入口，所有网络能力永久被阻断。 |
| 触发条件 | `loadNetworkProxyState` 抛错，普通编辑又依赖已加载 state。 |
| 根因 seam | `src/app/useNetworkProxyController.ts` 的 recovery command 与 `src/screens/more/NetworkProxyModal.tsx` 的显式直连重置入口。 |
| 必须保持的行为 | 错误态提供需确认的“重置为直连”；成功保存空代理状态并原生 apply `null` 后才解除门禁，失败继续保持错误态。 |
| 精确失败 oracle | `tests/ui/network-proxy-controller.test.tsx` 固定损坏读取后的空状态保存/apply；`tests/ui/network-proxy-modal.test.tsx` 固定错误态入口与确认行为。 |
| 最低可靠自动测试层 | `UI_PASS`。 |
| Replay 或真实验收路径 | 真实重置会删除用户代理配置，必须明确授权；自动测试使用 mock 存储。 |
| 负向验证方式 | 移除 reset command 或只改 React state 不持久化/apply，编号测试失败。 |
| 明确不覆盖范围 | 不自动重置，不恢复损坏 profile 内容，不在 reset 失败时静默直连。 |

## `REG-SEARCH-004` 单站重试被其他站错误误判失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 用户症状 | “全部”搜索中重试一个失败来源，该来源已经成功返回，但其他来源保留的错误让这次重试仍提示失败。 |
| 触发条件 | whole-source retry 用完整 aggregate `errors` 判断当前请求成功，而不是只判断 active source。 |
| 根因 seam | `src/app/useSearchController.ts` 的来源级 retry completion 与聚合错误保留。 |
| 必须保持的行为 | 重试结果只由本次 active source 决定；其他来源错误继续显示但不影响该来源成功提交和提示。 |
| 精确失败 oracle | `tests/ui/search-controller-ai.test.tsx` 保留无关来源错误并让 NodeSeek 重试成功，要求 NodeSeek 结果落地且不误报失败。 |
| 最低可靠自动测试层 | `UI_PASS`：需要聚合分组和来源级请求状态。 |
| Replay 或真实验收路径 | 多来源搜索自然局部失败时可点该来源重试；动态结果不固定。 |
| 负向验证方式 | 再以全局 errors 判断，编号测试会收到失败通知或丢失成功结果。 |
| 明确不覆盖范围 | 不清除未重试来源的错误，也不自动重试其他来源。 |

## `REG-SEARCH-005` 失败分页混入部分结果并推进 cursor

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 用户症状 | 单站下一页返回部分条目同时带错误时，App 仍追加这些条目并推进 cursor；用户重试会跳过失败页或得到重复/缺口。 |
| 触发条件 | controller 在检查来源 errors 前执行分页 append。 |
| 根因 seam | `src/app/useSearchController.ts` 的分页错误门禁、append 与 cursor commit 顺序。 |
| 必须保持的行为 | 失败页任何 partial items 都不得落地；保留旧结果和原失败 cursor，尾部显示错误且只重试同一页。 |
| 精确失败 oracle | `tests/ui/search-controller-ai.test.tsx` 返回带一条 partial item 的失败页，要求列表、页码和 cursor 全部保持。 |
| 最低可靠自动测试层 | `UI_PASS`。 |
| Replay 或真实验收路径 | 单站滚动加载更多；自然失败时确认旧列表仍在并从尾部重试。 |
| 负向验证方式 | 恢复错误检查前 append，编号测试会出现 partial item 或 cursor 前进。 |
| 明确不覆盖范围 | 不禁止合法成功页包含零条数据，也不自动推断来源下一页。 |

## `REG-TOPIC-008` linux.do 正文用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`USER-01`、`NAV-02` |
| 用户症状 | 点击 linux.do 正文中的 `/u/alice` 会离开 App 打开外部页面，无法进入现有用户详情和返回链。 |
| 触发条件 | 用户链接是相对 URL，router 只识别主题链接或绝对 profile URL。 |
| 根因 seam | `src/appUtils.ts` 的 forum user link 解析、base URL 解析与受信来源映射。 |
| 必须保持的行为 | linux.do 相对及同源公开用户链接进入 App User；其他站、相似域名和非公开设置路径仍按各自规则处理。 |
| 精确失败 oracle | `src/appUtils.test.ts` 的 `REG-TOPIC-008` 以 linux.do 主题为 base 解析 `/u/alice`，要求 `source=linuxdo` 和正确 username。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开含作者链接的主题，进入 User 后物理返回原主题。 |
| 负向验证方式 | 移除相对 user route 分支，编号测试返回 null。 |
| 明确不覆盖范围 | 不把偏好设置、管理页或外站同名路径内化。 |

## `REG-TOPIC-009` 评论查找把高亮插入 HTML 属性

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 评论内查找的关键词出现在带引号且含 `>` 的属性时，App 把 `<mark>` 插进 attribute，破坏链接或正文 HTML。 |
| 触发条件 | 可见文本扫描用 `<[^>]*>`，把引号内 `>` 误判为 tag 结束。 |
| 根因 seam | `src/androidFeatureHelpers.ts` 的 quote-aware HTML token scanning 与高亮边界。 |
| 必须保持的行为 | 只高亮可见文本节点，绝不修改 tag 名、属性名或引号内属性值；用户可见同词仍正常高亮。 |
| 精确失败 oracle | `src/androidFeatureHelpers.test.ts` 用 `title="VPS > private link"` 固定输出 HTML 未被属性内高亮破坏。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 含链接评论中执行查找并检查链接仍可点；只读。 |
| 负向验证方式 | 恢复简单 tag regex，编号测试会在 title 中插入 `<mark>`。 |
| 明确不覆盖范围 | 不实现完整浏览器 DOM 搜索，也不高亮 script/style 内容。 |

## `REG-TOPIC-010` 长按复制泄漏 HTML 属性片段

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 长按复制含 `title="1 > 0"` 等属性的评论时，剪贴板混入属性后半段，而不是纯可见正文。 |
| 触发条件 | HTML stripping 用非 quote-aware tag regex。 |
| 根因 seam | `src/androidFeatureHelpers.ts` 的 `stripHtml` 可见文本提取。 |
| 必须保持的行为 | 复制内容只包含解码后的用户可见文本，属性值、标签与隐藏结构不得泄漏。 |
| 精确失败 oracle | `src/androidFeatureHelpers.test.ts` 要求含引号 `>` 的链接只复制 `visible link`。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 长按评论并在系统复制入口取消；读取剪贴板需另按隐私授权。 |
| 负向验证方式 | 恢复 `<[^>]*>` stripping，编号测试会得到属性碎片。 |
| 明确不覆盖范围 | 不改变用户明确选择复制链接 URL 的独立操作。 |

## `REG-TOPIC-011` Sticker 属性中的大于号破坏正文

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | NodeSeek sticker 的 `title` 或其他引号属性包含 `>` 时，sticker 被切断、删除或把后续正文吞掉。 |
| 触发条件 | mixed-paragraph 图片/sticker 处理用非 quote-aware tag 正则。 |
| 根因 seam | `src/htmlImages.ts` 在 sticker/image regex 前的 quoted-tag normalization。 |
| 必须保持的行为 | 引号内 `>` 属于属性内容；sticker、前后正文和 inline 流顺序都保持，真正 tag 结束符才参与分片。 |
| 精确失败 oracle | `src/htmlImages.test.ts` 的 `REG-TOPIC-011` 固定 `title="1 > 0"` sticker 与前后正文均保留。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开含 sticker 的 NodeSeek 主题，对照前后文字。 |
| 负向验证方式 | 去掉 quote normalization，测试会缺 sticker 或丢尾文。 |
| 明确不覆盖范围 | 不改变 sticker 尺寸、资源 URL 或图片下载策略。 |

## `REG-TOPIC-012` 通用 HTML 文本与 mention 解析误切属性

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | HTML 属性含引号 `>` 时，可见文本提取泄漏属性碎片；同一标签上的用户 mention 也可能失去 App 内 mention 样式和导航。 |
| 触发条件 | 多个公共解析 helper 各自用 `<[^>]*>`，对 quoted delimiter 语义不一致。 |
| 根因 seam | `src/localHtml.ts` 的共享 `textContentFromHtml` 与 `src/topicContentHtml.ts` 的 render normalization。 |
| 必须保持的行为 | 所有调用方先按同一 quote-aware 规则识别完整 tag；可见文本不含属性，mention 链接仍加 class 且属性正确 escape。 |
| 精确失败 oracle | `src/localHtml.test.ts` 固定无属性泄漏；`src/topicContentHtml.test.ts` 固定含 `title="1 > 0"` 的 `@alice` 仍被识别。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 五站含链接/mention 正文只读检查，点击后可返回。 |
| 负向验证方式 | 恢复任一非 quote-aware scanner，相应测试收到属性碎片或缺少 mention class。 |
| 明确不覆盖范围 | 不把 sanitizer 扩展为浏览器级 HTML 修复器，也不允许不可信 scheme。 |

## `REG-TOPIC-013` 妖火裸域主题链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`NAV-02` |
| 用户症状 | `https://yaohuo.me/bbs-654.html` 被样式标为站内链接，却仍通过外部浏览器打开。 |
| 触发条件 | URL parser 只接受 `www.yaohuo.me`，而原站正文可能使用裸域。 |
| 根因 seam | `src/appUtils.ts` 的妖火 host allowlist 与 canonical topic URL。 |
| 必须保持的行为 | 精确裸域和 `www` 域都进入 App Topic，并规范化到安全 canonical URL；相似域和其他协议仍拒绝。 |
| 精确失败 oracle | `src/appUtils.test.ts` 的 `REG-TOPIC-013` 固定裸域主题 ID/source，同时保留 lookalike 负向用例。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读点击妖火正文裸域主题链接并返回。 |
| 负向验证方式 | allowlist 只留 `www`，编号测试返回 null。 |
| 明确不覆盖范围 | 不把任意妖火路径都当主题，也不放宽到子域通配。 |

## `REG-TOPIC-014` 图片下载无超时导致保存永久忙碌

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 远程图片下载永不 resolve 时，保存操作和忙碌状态永久悬挂，用户无法得到失败反馈或重试。 |
| 触发条件 | native/global fetch 卡住且图片保存链没有超时。 |
| 根因 seam | `src/imageSave.ts` 对远程图片下载复用受控 `fetchWithTimeout` 的边界。 |
| 必须保持的行为 | 下载在配置时限内完成或抛出明确超时；caller 必须由 rejection 收口并释放一次性保存门禁。 |
| 精确失败 oracle | `src/imageSave.test.ts` 用永不完成的 fetch 和 fake timers 要求超时 rejection。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 图片写入相册需权限和文件副作用授权；本轮不执行。 |
| 负向验证方式 | 改回裸 fetch，编号测试在 timer 推进后仍不 settle。 |
| 明确不覆盖范围 | 不保证远端服务器速度，也不绕过代理或媒体权限。 |

## `REG-TOPIC-015` 现代图片格式被错误保存为 JPG

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | AVIF、HEIC、APNG 或 BMP 图片下载后被命名为 `.jpg`；动态地址返回 SVG 等与 URL 后缀不同的图片时，又会沿用误导性后缀，导致扩展名与字节内容不一致，图库或分享应用可能无法识别。 |
| 触发条件 | extension allowlist 仅覆盖 jpg/png/gif/webp，未知格式无条件 fallback 为 jpg；或远程保存只根据 URL 命名，没有让成功响应的明确 `Content-Type` 覆盖 URL 后缀。 |
| 根因 seam | `src/imageSave.ts` 的 URL/Content-Type 图片扩展名归一化。 |
| 必须保持的行为 | 已支持的现代格式保留正确扩展；查询和 hash 不参与扩展；`jpeg` 规范化为 `jpg`；成功响应给出已识别图片 `Content-Type` 时以响应类型为准，只有类型缺失或未知时才回退 URL；兼容预览接受的 `application/svg+xml` 保存时也必须按 SVG 处理。 |
| 精确失败 oracle | `src/imageSave.test.ts` 固定 AVIF URL、“`.png` URL 返回 `image/svg+xml`”及 legacy `application/svg+xml` 三条文件名/字节契约。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 真实相册写入需授权；自动测试固定文件名与字节契约。 |
| 负向验证方式 | 缩回旧 allowlist，现代格式收到 `.jpg`；删除响应类型优先级，SVG fixture 被写成 `.png`。 |
| 明确不覆盖范围 | 不做图片转码，也不声称 Android 图库支持所有编码。 |

## `REG-TOPIC-016` V2EX 致谢数被图标属性截断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 用户症状 | V2EX 回复致谢图标属性包含引号 `>` 时，致谢数缺失或解析错误。 |
| 触发条件 | thanks 区域先用 `<[^>]*>` 去标签，再读取数字。 |
| 根因 seam | `src/localV2ex.ts` 的 thanks 文本提取改用共享 `textContentFromHtml`。 |
| 必须保持的行为 | 只从可见 thanks 文本读取非负数量；图标属性内容不得进入或截断数字。 |
| 精确失败 oracle | `src/localSources.test.ts` 的 `REG-TOPIC-016` 用 quoted `>` 图标 fixture 要求正确 `thanksCount`。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开有致谢的 V2EX 主题并核对楼层统计。 |
| 负向验证方式 | 恢复 raw tag regex，编号测试得到 undefined 或错误值。 |
| 明确不覆盖范围 | 不执行真实致谢，也不推断页面未展示的数量。 |

## `REG-TOPIC-017` 分享与剪贴板连续失败时异常逃逸

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04` |
| 用户症状 | 系统分享失败后，作为 fallback 的剪贴板复制也失败，点击事件 Promise 被拒绝且用户没有任何反馈。 |
| 触发条件 | `Share.share` reject，随后 `Clipboard.setStringAsync` 也 reject。 |
| 根因 seam | `src/app/topicActionHelpers.ts` 的双层 fallback 收口与 `src/app/AppRoot.tsx` 的菜单调用。 |
| 必须保持的行为 | 分享成功返回成功；分享失败但复制成功明确提示已复制；两者都失败时消费异常、提示重试并返回失败。 |
| 精确失败 oracle | `src/app/topicActionHelpers.test.ts` 的 `REG-TOPIC-017` 让两层都 reject，要求 helper 不再 reject 且 notify 明确失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 系统分享只打开后取消；不读取剪贴板，不人为破坏系统服务。 |
| 负向验证方式 | 删除 clipboard catch，编号测试再次 rejection。 |
| 明确不覆盖范围 | 不保证第三方分享目标成功，也不自动重试或记录分享内容。 |

## `REG-TOPIC-018` Android 不兼容的动态 SVG 被当作图片加载失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 主题里的报告图片 URL 以 `.png` 结尾、实际返回 `image/svg+xml` 时，Android 正文先显示“图片加载失败”；即使改成 data URI，缺少可靠固有比例还会把图片压成零高或方形，全屏预览也可能空白。 |
| 触发条件 | SVG 的 `<text>` 内含 `<a>` 包装，AndroidSVG 拒绝“text content 中的 group element”；或根 `<svg>` 使用 `width="100%" height="100%"` 配合非方形 `viewBox`。 |
| 根因 seam | `src/compatibleImageSources.ts` 的受限 SVG 兼容转换和尺寸解析、`src/app/useHtmlRenderingController.tsx` 的块图 ImageRef/几何、`src/components/ImagePreviewModal.tsx` 的全屏来源切换。 |
| 必须保持的行为 | 普通位图继续只走原生单次加载；只有原生解码失败后才在 10 秒、1 MiB、明确 SVG `Content-Type` 门禁下复取，保留原请求头并 quote-aware 去除 `<a>` 包装；数值/px 尺寸可直接使用，相对尺寸回退 `viewBox`；按 URL+请求头有界缓存并忽略过期响应，正文和全屏预览都使用正确比例。 |
| 精确失败 oracle | `src/compatibleImageSources.test.ts` 固定 quoted `>`、SVG 缓存、请求头和百分比尺寸；`tests/ui/topic-image-loading.test.tsx` 与 `tests/ui/image-preview.test.tsx` 固定原生失败后切换兼容来源且不显示失败态。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`。 |
| Replay 或真实验收路径 | 只读打开 NodeSeek `【TQ】Vmiss US.LA.TRI.Basic`，确认 tcpquality 三张动态报告在正文和全屏预览中保持完整比例；只打开预览，不保存。 |
| 负向验证方式 | 恢复裸 SVG、把百分比解析为数字或不给 fallback 同时约束宽高，编号测试分别得到不可解码 SVG、100×100 尺寸或错误几何。 |
| 明确不覆盖范围 | 不对普通非 SVG 失败伪造成功，不执行脚本/外部资源，也不承诺任意 SVG 特性均受 Android 解码器支持。 |

## `REG-TOPIC-019` NodeSeek 私有图片在预览和保存时丢失会话凭据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 用户症状 | NodeSeek 受保护图片可在正文中显示，点开全屏或保存时却重新发起无 Cookie/错误 User-Agent 的请求，得到登录页、403 或加载失败。 |
| 触发条件 | 正文 renderer 使用实时 NodeSeek 媒体凭据，但图片预览、尺寸探测、缩略图或保存 controller 从 URL 重新构造匿名请求。 |
| 根因 seam | `src/app/AppRoot.tsx`、`src/app/GlobalModalHost.tsx`、`src/components/ImagePreviewModal.tsx`、`src/app/useImagePreviewController.ts` 与 `src/imageSave.ts` 的媒体请求参数传递。 |
| 必须保持的行为 | 正文、全屏图、尺寸探测、缩略图、SVG fallback 和保存下载共用当前 NodeSeek Cookie/User-Agent；凭据只存在于请求内存，不进入 URL、持久化文件或诊断日志；非 NodeSeek URL 不附加 Cookie。 |
| 精确失败 oracle | `tests/ui/image-preview.test.tsx` 固定全屏/尺寸请求头，`tests/ui/image-preview-controller.test.tsx` 固定保存参数透传，`src/imageSave.test.ts` 固定最终 fetch 请求头。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`。 |
| Replay 或真实验收路径 | 只有当前登录态自然出现受保护媒体时做只读预览；真实保存会写系统媒体库，须另获授权。 |
| 负向验证方式 | 从 Modal、controller 或 save helper 任一层删除凭据参数，对应编号测试立即观察到缺失 Cookie/User-Agent。 |
| 明确不覆盖范围 | 不清理或伪造登录态来制造私有对象，不把 Cookie 发往非 NodeSeek host，也不执行未经授权的相册写入。 |

## `REG-TOPIC-020` Android 不兼容 SVG 的未选中缩略图保持空白

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 多图预览中当前 SVG 经兼容恢复后可以显示，但其他同类图片的缩略图一直是黑色空框；只有逐张点选、触发主图恢复后才出现缩略图。 |
| 触发条件 | 全屏主图有原生失败 fallback，缩略图只读取已有兼容缓存，自己的 `onError` 没有启动恢复。 |
| 根因 seam | `src/components/ImagePreviewModal.tsx` 的每个缩略图加载生命周期与 `src/compatibleImageSources.ts` 的去重缓存。 |
| 必须保持的行为 | 每个已渲染缩略图在原生解码失败后独立请求同一受限 SVG fallback；并发请求由共享 helper 去重，NodeSeek 请求头保持不变；健康位图不额外 fetch，未渲染图片不主动预取。 |
| 精确失败 oracle | `tests/ui/image-preview.test.tsx` 的 `REG-TOPIC-020` 在未选择第 2 张图时触发其缩略图错误，要求来源切换为兼容 SVG data URI。 |
| 最低可靠自动测试层 | `UI_PASS`。 |
| Replay 或真实验收路径 | 在上述 NodeSeek 三图主题打开预览，保持第 2 张为当前图时确认尚未选择的第 3 张缩略图也自动出现，再打开第 3 张核对完整内容。 |
| 负向验证方式 | 删除缩略图 `onError` 恢复，编号测试保持原 URL，真机对应缩略图为空框。 |
| 明确不覆盖范围 | 不预抓取图库外图片，不为普通非 SVG 错误隐藏空态，也不执行保存。 |

## `REG-UPDATE-002` 系统未打开安装确认却提示已开始

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04` |
| 用户症状 | Android 原生安装请求返回 `false`、没有显示系统确认页时，App 仍提示安装已开始或成功。 |
| 触发条件 | installer API 的布尔确认值被忽略，只要 Promise resolve 就视为成功。 |
| 根因 seam | `src/appUpdate.ts` 的 APK 检查、安装请求返回值与 controller 成功提示契约。 |
| 必须保持的行为 | 只有原生明确返回 `true` 才能宣称系统安装确认已打开；`false` 必须 reject 并由 UI 提示失败。 |
| 精确失败 oracle | `src/appUpdate.test.ts` 的 `REG-UPDATE-002` 让 inspect 合法但 install 返回 false，要求 rejection。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | APK 下载/安装属于发布风险操作，未经授权不执行。 |
| 负向验证方式 | 忽略返回值，编号测试会错误 resolve。 |
| 明确不覆盖范围 | 不证明安装最终完成，也不替代签名、版本和 release 验证。 |

## `REG-USER-001` 用户页跨 Tab 分页留下永久忙碌 cursor

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01` |
| 用户症状 | 主题分页尚未完成时切到回复并加载更多，回复请求接管共享 owner；旧主题 cursor 一直标记 busy，切回后无法重试。 |
| 触发条件 | 两个 tab 共用请求 generation，但 busy/cursor 清理由“仍是全局最新请求”决定。 |
| 根因 seam | `src/app/useUserController.ts` 的 topic/reply 独立分页 ownership 与 finally 收口。 |
| 必须保持的行为 | 两个 tab 可以互相 supersede 数据提交，但每个请求始终清理自己持有的 busy/cursor；旧结果不得覆盖新 tab。 |
| 精确失败 oracle | `src/app/useUserController.test.ts` 控制 topic 分页后启动 reply 分页，要求 topic cursor 最终释放且可再次加载。 |
| 最低可靠自动测试层 | `UNIT_PASS`：需要精确调度两个 Promise。 |
| Replay 或真实验收路径 | 用户页两个 tab 分别滚动加载并切回，确认没有永久 Spinner。 |
| 负向验证方式 | 让 finally 继续依赖共享 latest id，编号测试观察到 topic cursor 卡住。 |
| 明确不覆盖范围 | 不并行合并两个 tab 的内容，也不保证来源存在下一页。 |

## `REG-USER-002` 小隐寺关注用户恢复到错误站点 URL

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-02`、`LIBRARY-02`、`DATA-01` |
| 用户症状 | 老备份中的小隐寺关注用户缺少 profile URL 时，恢复逻辑生成其他站点地址，点击后离开正确来源。 |
| 触发条件 | sanitize/migration 的 URL fallback 没有覆盖 `source=xiaoyinsi`。 |
| 根因 seam | `src/readerData.ts` 的 source-specific user profile URL 构建。 |
| 必须保持的行为 | 五站缺失 URL 都按各自 canonical user page 恢复；小隐寺必须指向 `xiaoyinsi.com/u/{username}`。 |
| 精确失败 oracle | `src/readerData.test.ts` 的 `REG-USER-002` 恢复缺 URL 的小隐寺 profile 并比较来源与 URL。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | Library → 小隐寺关注用户 → User，只读返回。 |
| 负向验证方式 | 删除小隐寺分支，编号测试收到错误 host。 |
| 明确不覆盖范围 | 不修补无法识别来源或 username 缺失的记录。 |

## `REG-USER-003` 妖火裸域用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01`、`NAV-02` |
| 用户症状 | 妖火裸域 `userinfo.aspx` 链接无法进入 App User，而是外部打开。 |
| 触发条件 | user link host allowlist 只包含 `www.yaohuo.me`。 |
| 根因 seam | `src/appUtils.ts` 的妖火 user host 识别和参数提取。 |
| 必须保持的行为 | 精确裸域与 `www` 用户链接都解析为妖火 User；相似域、缺用户 ID 或其他路径不内化。 |
| 精确失败 oracle | `src/appUtils.test.ts` 的 `REG-USER-003` 固定裸域 `touserid` 解析及 lookalike 负向边界。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读点击妖火作者链接进入 User 并返回。 |
| 负向验证方式 | allowlist 只留 `www`，编号测试返回 null。 |
| 明确不覆盖范围 | 不接受任意妖火 query 作为用户 ID。 |

## `REG-USER-004` Discourse 公开用户 Tab 被外部打开

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01`、`NAV-02` |
| 用户症状 | linux.do 或小隐寺的 `/u/alice/summary`、`/activity` 等公开 profile tab 被外部打开，尽管 App 已有同一用户页。 |
| 触发条件 | router 只接受严格 `/u/{username}` 末尾。 |
| 根因 seam | `src/appUtils.ts` 的 Discourse public profile suffix allowlist。 |
| 必须保持的行为 | summary/activity 等公开 profile tab 归一到 App User；preferences、messages、admin 等私密/管理路径继续外部处理。 |
| 精确失败 oracle | `src/appUtils.test.ts` 的 `REG-USER-004` 固定两个站点公开 tab，并对 preferences 保持拒绝。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读点击公开 profile tab，进入 User 后返回。 |
| 负向验证方式 | 恢复严格末尾规则，编号测试返回 null；过度放宽则 preferences 负向用例失败。 |
| 明确不覆盖范围 | 不把私信、偏好或管理入口映射到公开 User。 |

## `REG-USER-005` 新用户的零统计被当成缺失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01`、`LIBRARY-02` |
| 用户症状 | 新用户明确有 0 主题、0 回复或 0 帖子时，App 隐藏统计，用户看到的状态与来源不一致。 |
| 触发条件 | linux.do、小隐寺、NodeSeek 或妖火 adapter 用 truthy 判断数字，0 被转成 undefined。 |
| 根因 seam | `src/localLinuxdo.ts`、`src/localXiaoyinsi.ts`、`src/localNodeseek.ts`、`src/localYaohuo.ts` 的可选非负统计归一化。 |
| 必须保持的行为 | 来源明确返回的有限非负 0 必须保留；字段缺失仍为 undefined；负数拒绝。妖火两个组成统计均已定义时，包括 0，派生总数。 |
| 精确失败 oracle | `src/localSources.test.ts`、`src/localXiaoyinsi.test.ts`、`src/localYaohuo.test.ts` 分别固定四站显式零统计。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开确有零统计的新用户；动态目标不存在时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 truthy 判断，四站相应用例都会得到 undefined。 |
| 明确不覆盖范围 | V2EX 数量来自可能失败的分页数组，空数组不能据此证明真实为 0，因此本条不改变 V2EX。 |

## `REG-WRITE-011` 删除回复后本地详情仍保留楼层

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 服务器已确认删除回复，但当前详情和回复分页仍显示该楼层、回复数不变；若编辑器正回复该楼层，还会继续指向不存在对象。 |
| 触发条件 | action controller 只提示成功或刷新部分数据，没有把 typed deletion update 应用到当前 Topic 与活动 route snapshot。 |
| 根因 seam | `src/app/useTopicSessionController.ts` 的 `reply-deleted` action update、列表去重和 composer target 收口。 |
| 必须保持的行为 | 确认删除后从 detail replies 与分页缓存移除目标，回复数最多减一且不小于 0，同步活动 snapshot；只有 composer 正指向该楼层时才关闭。 |
| 精确失败 oracle | `src/app/useTopicSessionController.test.ts` 的 `REG-WRITE-011` 同时断言详情/分页移除、计数、snapshot 和 composer 匹配边界。 |
| 最低可靠自动测试层 | `UNIT_PASS`：controller state update 足以固定，无需真实删除。 |
| Replay 或真实验收路径 | 真实删除不可逆，必须对具体回复逐次授权；本轮不执行。 |
| 负向验证方式 | 忽略 `reply-deleted` 或只改一份数组，编号测试会保留楼层、错误计数或错误 composer。 |
| 明确不覆盖范围 | 不猜测服务端未确认的删除，不自动整篇刷新，也不删除本机历史记录。 |

## `REG-WRITE-012` 妖火缺少确认链接仍被报告删除成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02` |
| 用户症状 | 妖火删除预备页只含“确认删除”等普通文案但没有可执行确认 URL 时，App 仍提示删除成功，实际回复尚在。 |
| 触发条件 | action client 用页面关键词作为成功 oracle，而未解析和执行原站确认链接。 |
| 根因 seam | `src/yaohuoActionClient.ts` 的两阶段删除协议、same-origin confirmation link 与结果分类。 |
| 必须保持的行为 | 只有解析到允许的同源确认链接并完成确认请求后才可报告成功；链接缺失时结果不明/失败，且不得猜 URL 或多发请求。 |
| 精确失败 oracle | `src/yaohuoActionClient.test.ts` 的 `REG-WRITE-012` 返回含确认文案但无链接的 HTML，要求失败且 fetch 只有一次。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 真实删除不可逆，未经逐次授权不执行。 |
| 负向验证方式 | 恢复关键词成功判断，编号测试错误 resolve。 |
| 明确不覆盖范围 | 不尝试推断隐藏表单或构造未观察到的确认接口。 |

## `REG-WRITE-013` NodeSeek 暴露未确认的删除入口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02` |
| 用户症状 | NodeSeek 回复菜单显示“删除”，点击后只能进入不受支持或失败路径；原站当前没有已确认的删除协议。 |
| 触发条件 | source catalog 把 NodeSeek edit/delete 共用一个粗粒度写能力布尔值。 |
| 根因 seam | `src/sourceCatalog.ts` 的逐来源、逐 action capability。 |
| 必须保持的行为 | NodeSeek 继续提供已实现的编辑，但在存在可验证删除协议前 fail-closed 隐藏删除；其他来源按各自权限不变。 |
| 精确失败 oracle | `src/sourceCatalog.test.ts` 的 `REG-WRITE-013` 要求 NodeSeek edit=true、delete=false。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开本人 NodeSeek 回复菜单，检查无删除入口；不得创建或删除真实回复。 |
| 负向验证方式 | 恢复共用 capability，编号测试收到 delete=true。 |
| 明确不覆盖范围 | 不宣称 NodeSeek 永远不支持删除；有原站协议证据后需新设计和测试。 |

## `REG-WRITE-014` 异常百分号文件 URI 使图片上传崩溃

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-04` |
| 用户症状 | 系统图片选择器返回文件名含残缺 `%` 转义的 URI 时，上传前 `decodeURIComponent` 抛错，图片被丢弃或事件链异常退出。 |
| 触发条件 | 从 URI 推断 filename 时无条件解码不合法 percent sequence。 |
| 根因 seam | `src/replyImageUpload.ts` 的 asset filename normalization。 |
| 必须保持的行为 | 合法 URI 正常解码；非法 percent sequence 安全回退到原始 basename，并继续后续 MIME/上传校验。 |
| 精确失败 oracle | `src/replyImageUpload.test.ts` 的 `REG-WRITE-014` 传入 `photo%broken.jpg`，要求不抛错且保留可用文件名。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 真实图片上传会产生远端文件，需单独授权；本轮不执行。 |
| 负向验证方式 | 恢复裸 `decodeURIComponent`，编号测试同步抛出 URIError。 |
| 明确不覆盖范围 | 不绕过文件大小、MIME、站点权限或上传失败处理。 |

## `REG-XIAOYINSI-022` 写操作确认授权失效后不打开重授权

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-06`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 小隐寺操作返回 401，随后 session 复核明确确认已保存授权失效，但 UI 只回滚操作并报错，没有打开重新授权入口。 |
| 触发条件 | action failure handler 能区分复核结果，却只在原错误或读取阶段处理授权 UI。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 的小隐寺 action error、authorization recheck 与 auth panel 路由。 |
| 必须保持的行为 | 只有 401/403 且复核明确为未授权时打开授权面板，同时保留原始操作错误和 optimistic rollback；复核仍授权或暂时失败时不得擅自退出。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-XIAOYINSI-022` 固定 action 401 + recheck false 打开授权，并保留 403/recheck true 负向分支。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 自然失效时检查授权入口；不得撤销真实授权制造场景，真实写入仍需逐次授权。 |
| 负向验证方式 | 移除 recheck false 的 auth open，编号测试没有入口；把所有 403 都当退出则负向用例失败。 |
| 明确不覆盖范围 | 不自动撤销、删除或重新生成 Device Code，不重试可能非幂等的写请求。 |

## `REG-TEST-001` Smoke 绿灯被当成功能完整通过

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 用户症状 | Smoke 路径能走通，但 Feed 双 Loading 等用户可见 bug 仍然存在；多来源搜索 Replay 只等到请求结束，即使结果为空或结果打不开也会报绿。 |
| 触发条件 | 测试只验证元素最终出现、源码包含某段字符串、请求完成或 App 没崩溃，没有精确的用户可见 oracle。 |
| 根因 seam | 证据命名和交付报告把不同测试层混成一个 `SMOKE_PASS`；搜索旅程把 `search-complete` 当成搜索成功，没有验证结果存在并能进入详情。 |
| 必须保持的行为 | APK 启动、设备旅程、组件行为、确定性逻辑和真实来源分别报告；缺少的层明确标记 `NOT_VERIFIED`。多来源搜索 Replay 对 Linux.do、NodeSeek、妖火分别完成查询后，必须看到第一条结果、打开详情、等待详情加载并返回搜索页。 |
| 精确失败 oracle | `npm run verify` 必须包含 `npm run test:ui`；`npm run test:device` 和 `npm run smoke:android` 输出不同证据名称，Smoke 不输出 `SMOKE_PASS` 或“功能完整通过”；`src/androidSmokeGuard.test.ts` 精确要求搜索 Replay 中三个来源各有一次结果可见、点击、详情加载和系统返回。 |
| 最低可靠自动测试层 | 由具体事故决定；对 Feed 双 Loading 是 `UI_PASS`，不得用更低层的 `APK_SANITY` 替代。 |
| Replay 或真实验收路径 | Smoke 只汇总 `APK_SANITY` 与 `DEVICE_REPLAY_PASS`；动态来源和获授权写入另报 `LIVE_PASS`。搜索 Replay 必须逐个来源查询、打开第一条结果、等待主题详情并返回。 |
| 负向验证方式 | 注入 `REG-FEED-001` 故障时 APK 仍可启动，但 UI 测试必须失败，证明两个证据层互不替代；从任一搜索来源删除结果可见、点击、详情等待或返回步骤时，守卫测试必须失败。 |
| 明确不覆盖范围 | 不设置覆盖率百分比；测试价值由能否拦住具体用户行为回归判断。 |

## 待确认观察

下表只保存本轮探索中出现过、但尚不足以认定为当前业务 bug 的线索。它们不等同于 `REG-*`，也不能据此增加猜测式 workaround。只有在身份匹配的当前 APK 上稳定复现并得到明确失败 oracle 后，才升级为回归条目和最低可靠测试。53 个失联 daemon、30 个工具录屏进程及设备录屏分片未清理已经有完整证据，归入 `REG-OPS-002`，不再作为“疑似”。

| 观察 ID | 能力 ID | 已看到的现象 | 当前判断 | 下一次可证伪检查 |
| --- | --- | --- | --- | --- |
| `OBS-APP-001` | `FEED-02`、`ACCOUNT-02` | 一次早期候选 APK 在四站来源切换期间出现 Chromium `NetworkService` `SIGSEGV`，随后 App 进程被系统终止；后续当前候选未稳定复现。 | `NOT_VERIFIED`：可能是 Android System WebView/模拟器瞬时故障，也可能是 App WebView 使用路径触发；单次日志不能定根因。 | 在 revision、APK SHA、设备和 System WebView 版本均记录的只读四站旅程中复现；只有再次出现相同 native crash 且能定位触发入口时才建 `REG-*`。 |
| `OBS-LIST-001` | `FEED-02`、`FEED-04` | 一次 V2EX 来源切换后，Replay 的列表 readiness 断言早于稳定列表状态。后续同路径可以通过。 | `NOT_VERIFIED`：当前证据无法区分列表真实竞态与自动化 selector/等待时机问题。 | 同时观察页面可见列表、`feed-list-ready-v2ex` 和请求终态；若用户可见列表为空或串站则按 Feed bug 处理，仅 selector 迟到则修 Replay。 |
| `OBS-AUTO-001` | `ACCOUNT-02`、`RELEASE-02` | NodeSeek DOM readiness 已出现后，UIAutomator 曾因持续变化的 WebView 无法取得 idle accessibility hierarchy。 | 自动化限制，不作为 App 失败：marker 已可见，冗余文案读取才阻塞。 | Replay 只依赖稳定 readiness marker 和返回链；若 marker 本身不可达或用户无法操作页面，再升级为 NodeSeek 产品回归。 |
| `OBS-AUTO-002` | `RELEASE-02` | 本轮首次实际执行筛选 Replay 时，`npm run test:device` 在输出身份行前持续挂起；隔离执行 `agent-device devices --platform android --json` 随后报告旧 daemon PID 不可达并完成替换，启动阶段恢复。 | agent-device 生命周期异常，不作为 App 失败；恢复后另行发现并修复 `REG-OPS-003`，最终五条 Replay 全部通过。失联 daemon 为一次可观察证据，尚未形成稳定复现和独立根因。 | 给设备发现/daemon 启动增加可观察超时和首阶段日志；若相同失联状态可稳定复现，再单独建立 `REG-OPS-*`，不能与设备名称映射混为同一根因。 |
| `OBS-INPUT-001` | `SEARCH-02` | 一次 ADB 键盘提交搜索后前台回到系统桌面，随后用 App 内提交按钮复测通过。 | 自动输入路径异常，不作为搜索功能失败。 | 只在真实软键盘搜索键也能重复使 App 退出、且有对应 App/system 日志时升级；默认 Replay 使用稳定提交按钮。 |

## 新条目模板

新条目必须写明：能力 ID、用户症状、触发条件、根因 seam、必须保持的行为、精确失败 oracle、最低可靠自动测试层、Replay 或真实验收路径、负向验证方式和明确不覆盖范围。没有修复前失败证据的条目不能标记完成。
