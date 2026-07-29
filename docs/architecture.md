# 架构说明

## 文档职责

- `docs/product-charter.md` 定义产品目标、核心旅程和取舍标准。
- `docs/product-map.md` 定义现有能力、用户入口、能力 ID 和共享回归范围。
- `docs/regression-corpus.md` 记录历史逃逸问题、精确 oracle 和最低可靠测试层。
- `PRODUCT.md` 只维护品牌、视觉和 accessibility 约束，不作为产品范围或实现事实源。
- 本文只回答这些能力“怎么实现”：记录当前 module、interface、数据和原生配置边界，不重复完整功能清单，也不维护版本号或登录状态。
- `docs/testing-standard.md` 定义验收，`docs/operator-runbook.md` 定义开发与发布操作。
- `memory/` 与 `docs/emulator-baseline.md` 保存本机事实，不进入 Git，也不作为共享架构规范。

## 当前范围

本仓库是阅坛 Android App。App 面向 NodeSeek、linux.do、V2EX、妖火和小隐寺，提供本地优先的多网站发现、搜索、续读和必要互动能力。五站共享阅读主干，互动能力按原站真实支持范围提供，不要求对齐。

## 主要结构

| 路径 | 作用 |
| --- | --- |
| `App.tsx` | 应用入口，提供唯一 `QueryClientProvider` 并加载 `AppRoot` |
| `src/app/AppRoot.tsx` | App 根组件，组合控制器、主题、导航、Provider、全局弹层、隐藏 WebView 和页面参数 |
| `src/app/serverState.ts` | TanStack Query 的唯一 client，以及五站类型化 query/mutation key |
| `src/app/sessionControllerHelpers.ts` | 凭据 transaction、WebView 队列和会话 transition 的精确 Query 清理规则 |
| `src/app/useDeferredNavigationTask.ts` | AppRoot 的延迟导航时机，避免把 `InteractionManager` 细节留在根组件里 |
| `src/app/use*Controller.ts` | 首页、搜索、详情、用户、账号、会话、验证、备份等运行逻辑 |
| `src/sources/sourceGateway.ts` | App 统一来源读取入口，隐藏五站读取 adapter 差异 |
| `src/sourceCatalog.ts` | 来源身份、基础 URL、family、聚合范围、筛选、会话与写能力的编译期注册表 |
| `src/discourseSourceReaders.ts`、`src/forumApi.ts`、`src/yaohuoApi.ts` | 注册后的读取 adapter 与聚合实现，位于 `sourceGateway` 后面 |
| `src/discourseModel.ts`、`src/discourseContent.ts`、`src/discoursePermissions.ts`、`src/discourseReactions.ts` | 无站点偏向的 Discourse 标准模型、正文、权限和 reaction/emoji 语义 |
| `src/discourseActions.ts`、`src/discourseSourceActions.ts`、`src/app/discourseActionRuntime.ts`、站点 action client | 语义写操作、站点 override、鉴权 runtime 注册与各站 transport |
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
| `src/local*.ts` | 五站本机来源读取与解析；`localXiaoyinsi` 保持独立于 linux.do 的 Cookie / Cloudflare 逻辑 |
| `plugins/` | Expo config plugin，持久化 Android 原生配置；服务器代理与小隐寺 Keystore 原生模块分别由对应 plugin 生成 |
| `scripts/` | 文档检查、Android smoke、release 打包与版本检查脚本 |

## 来源边界

- App controller 通过 `src/sources/sourceGateway.ts` 的 `getFeed`、`searchTopics`、`getTopic`、`getReplies` 和用户资料 interface 读取五站数据；NodeSeek username 定位只通过 managed `resolveNodeSeekUser` 进入 adapter，Controller 不直接调用 `localNodeseek`。
- `src/sourceCatalog.ts` 是来源集合的唯一静态事实源；来源类型、聚合 Feed/Search、筛选状态、可登录站点、诊断枚举和页面 action capability 都从这里派生，不在页面中维护 LinuxDo/小隐寺成对名单。
- 五站的首页、搜索、主题、回复和用户资料读取均已进入 managed gateway：`createSourceGateway` 组装 WebView fallback fetcher、Cookie、User-Agent、凭据 generation、妖火失效清理和按来源键控的 `discourseAuth`；Query function 只传业务参数、TanStack `AbortSignal` 和诊断 trace。
- 用户链接先归一为轻量 `UserReference`，只承载 source、可选 id/username、原站 URL 和展示 hint；它不是完整远端资料，不能进入 ReaderData 或关注。NodeSeek `/space/{uid}` 直接形成 canonical reference；`/member?t=username` 始终形成内部 reference，当前 Topic/detail candidates 只提供有界数字 UID hint，miss 不改变内部导航判定。username-only reference 经 managed gateway、当前 session epoch 和 identity barrier 解析 canonical 数字 UID，Profile、主题、回复、分页与关注随后只消费完整 `UserProfile`。Discourse 只有明确 username 才形成 reference，display label 不参与身份推断。见 `REG-TOPIC-035/039`。
- linux.do 与小隐寺是两个独立 adapter，共同实现 `src/discourseSourceReaders.ts` 的标准读取 port；两者组合 `discourseModel` 等无站点偏向模块，不继承彼此，也不共享 Cookie、CSRF、Cloudflare、User API Key 或缓存状态。无站点偏向且语义相同的 cooked HTML 归一化（当前为安全头像与引用 label/username 分离）放在 `src/discourseContent.ts`，站点 transport 与鉴权仍独立。
- 标准 Discourse 回复、点赞、书签、编辑、删除、投票和上传先表达为 `DiscourseAction`，再由 `discourseSourceActions` 选择标准 request builder 或最小站点 override；小隐寺 Topic 无 bookmark id 的取消收藏是当前 override。`discourseActionRuntime` 按来源注册独立鉴权和 transport，Topic controller 只执行统一 action 生命周期。
- Feed、Search、Topic UI 只消费语义筛选、权限和 action capability；标准 Discourse emoji 目录由 Topic 通过 managed `sourceGateway.getEmojiUrls` 读取，复用代理 fetcher、站点凭据、诊断和 `AbortSignal`，各 adapter 只保留站点级目录缓存并把结果交给公共 presenter。linux.do boost、Cloudflare 验证、小隐寺 Device Code 等站点特性留在站点 presenter、鉴权或 transport 边界。
- App controller 使用不带 `Direct` 和站点前缀的通用读取入口；妖火的 `Direct` 命名只保留在 gateway 后的来源实现。
- `sourceGateway` 内部仍转发到 `src/forumApi.ts` 和 `src/yaohuoApi.ts`；Discourse adapter 注册集中在 `discourseSourceReaders` / `discourseSourceActions`。
- `src/forumApi.ts` 仍是现有读取实现的一部分，不应从文档中当作已删除文件处理。
- 新增读取调用方应使用 `sourceGateway`，不要在 `src/app/*Controller.ts` 里新增对旧读取来源文件的直接调用；新增写操作复用现有 action client，并按触及路径逐项收口。
- 来源静态 capability 只说明该站可能支持某项能力；当前主题或回复的 `canEdit`、`canDelete` 等权限仍以原站解析结果为准。

## 服务器状态与请求生命周期

- Feed、Search、Topic/回复/引用、User 和 Account/等级读取由 `src/app/serverState.ts` 的唯一 TanStack Query client 统一拥有。Query key 固定以 `forum -> source -> resource` 开头，只包含会改变响应身份的结构化业务参数和非敏感 `ForumSessionEpochs`；它表达按站身份世代，不承载 Cookie header。NodeSeek username resolution key 只含精确 username 与 session epoch；canonical Profile key 只含 source、数字 userId 与 session epoch，不含 username 分叉。Infinite Query 的页码与 cursor 只放在 `pageParam`，Cookie、token 和序列化 request key 不进入 key。各 `use*Controller` 只组合 Query result 与页面本地状态，不复制远端 data/loading/error，也不再拥有 transport request id、owner map、generation 或 Abort ref。
- Feed/Search/Topic/User/等级的 Query `queryFn` 只使用 TanStack 提供的 `AbortSignal`，并直接传给 managed `sourceGateway`；账号状态的四个 canonical Query 与独立 probe Query 同样只由 Query signal 驱动，probe key 包含 `source + sessionEpoch + surfaceGeneration`，结果经身份比较后才原子提交到 canonical key。相同 key 的并发读取共享一个 transport，NodeSeek username resolver 不另建缓存或持久映射。`sourceGateway` 只负责 epoch 校验、adapter、transport 和标准化错误，不承担 UI 请求归属。resolver 复用当前 CookieManager fetcher、User-Agent、代理、barrier、Cloudflare fallback、取消信号和脱敏诊断；已确认未登录与 identity barrier 均在 transport 前失败。来源返回失败、需要验证或 `parse_empty` 时不保存为可信数据；刷新或分页失败由 Query 保留此前可信 data/pages 和 cursor。
- 默认不自动 retry，不因 mount、重连或回到前台自动重发。App 级长期挂载的 Feed、Search、Account controller 必须接收当前 `screen` 和 linux.do 验证 overlay 状态：Feed 主列表只归 Feed，Search 主查询只归 Search，等级只在 More 且用户已请求时 active；共享 categories 只归 Feed/Search，验证 overlay 内暂停 AI、候选和 categories 等次要读取。离开所有者页面必须显式取消已在飞 Query，不能只依赖 `enabled:false`。Android Home 只更新 TanStack focus 和 `src/request.ts` 的 active-time timeout 时钟，不取消在飞详情请求；离开 Topic route 才取消对应读取。
- 四站整批 Account 对账是一个 identity reconciliation transaction。默认首页“全部”的 Feed/Categories 在事务结算前保持唯一 Loading，不执行聚合读取；四个 probe 仍并发且各站只执行一次。逐站 pending/settled、barrier 和 epoch 的中间快照不得成为聚合 Query key；事务结算后只发布最终身份快照并各执行一次 Feed/Categories 聚合读取。后续手动整批对账复用同一事务：身份未变时不重读 Feed/Categories，最终 scope 变化时最多按最终快照读取一次。事务期间聚合列表的按钮、滚动哨兵和验证恢复都不得命令式绕过门禁使用旧 cursor；单站切换、单站分页和单站登录/验证仍使用 source-scoped barrier，不等待无关来源。见 `REG-FEED-011`。
- 聚合 Query 的最终 barrier snapshot 同时绑定 query key 与 gateway read；普通单站身份迁移中的在途安全读取结算后才切换到最新 barrier，避免观察者换 key 时中止请求。Controller 只保留本 runtime 已成功展示且经当前 epoch/barrier 再投影的 Feed/Categories 快照；barrier 安全响应只刷新已返回条目，不能截掉旧安全尾页或另一个仍可信的 pending 来源。barrier 解除会以该安全快照保留原 Infinite Query 页数、关闭旧 cursor、标记目标 key stale，再从无 cursor 的第一页开始逐页读取完整结果；无 barrier 的直接 epoch 变化在 Feed 新 Query 追平已展示安全页数前、Categories 把稳定安全投影写入新 key 前，也不能覆盖该快照。显式 Feed 刷新失败继续保留快照，成功且 active/query/identity owner 未变化时才以本次新 epoch 原始结果结束该稳定态；在途离页或 scope 变化零提交、零成功通知。后续 cursor 只由新 epoch 已结算页面重建，不能命中 `staleTime: Infinity` 的旧快照、提交旧账号 cursor 或把多页压成一页。只有可信 Cloudflare challenge 或既有明确网络兜底条件才进入一次隐藏 WebView fallback。NodeSeek 与 linux.do 各自使用稳定队列，优先级为获授权写操作、前台可见读取、后台账号刷新，同优先级 FIFO；已开始任务不被后来任务抢占，单个 Abort 只取消自己的任务。排队时间不消耗隐藏 WebView 的执行超时，获得执行权时才开始计时。见 `REG-SOURCE-005/006`、`REG-FEED-009/010/011`。
- Account Query 是远端身份的唯一可信快照；WebView/授权 workflow 只表达弹层、检测、授权与对账生命周期，不以 Cookie 存在或页面打开状态复制第二份身份。登录 surface 打开或关闭待对账时，该站进入 identity barrier：取消已在飞私有读取但保留已加载内容只读，暂停新私有读取与写入；`unknown` 保留上次可信身份和缓存并继续保持 barrier。旧内容只允许被本 App runtime 已成功确认、随后再次 pending 的来源复用；启动期尚未确认的来源不得从温缓存投影条目、错误或验证动作。首次可信身份建立时只清除该来源尚未受信的服务端 Query，保留 Account canonical/probe、聚合安全投影和其他来源。A→B、A→anonymous 或 anonymous→B 才递增目标站 epoch，移除该站与 `all` 私有 Query、等级/AI、Topic 服务端数据及媒体身份缓存；Feed/Categories 在 key 切换期间只投影未变化来源，保持其顺序和可见性，变化来源立即删除且 placeholder 不沿用旧分页 cursor；其他来源不变。Feed“全部”和 Search“全部”只暂停 dirty 来源，其余来源继续结算，缺站结果不得写回无 barrier 的旧 key。见 `REG-ACCOUNT-023/031`、`REG-FEED-010`。
- `AppRoot` 用同步的 `SessionRuntimeSnapshot` 统一暴露 identity、epoch、pending 和 auth surface；Account probe 开始及 canonical identity commit 都先更新该 runtime，再让调用方 Promise 完成。SourceGateway、写入 ticket和 NodeImage owner 只读这一快照，不能等待 React effect 才看到新身份。身份 pending、登录 WebView 尚未卸载或 linux.do 恢复屏障未释放时，新私有读取和写入均暂停；恢复必须先关闭并卸载验证面板，再重试原 Query，见 `REG-ACCOUNT-035`。
- NodeSeek、linux.do、妖火与 NodeImage 共用 `authSurfaceCoordinator`。打开页面只创建带来源、surface、generation、打开时 identity/epoch 的 ticket 并建立 barrier，不清 Cookie、不改身份、不删 Query；关闭按钮、系统返回、离开 More、切换 surface、NodeImage 成功或取消都先立即收起 UI，再异步对账对应站点。隐藏 surface 的重复关闭是 no-op；linux.do 因 App inactive 暂时卸载 WebView 不算逻辑关闭；已有权威检测结果的自动关闭复用该结果，不重复 probe。迟到 probe 只能提交给自己的 generation。见 `REG-ACCOUNT-031`。
- 验证状态只能由协议或页面结构证据产生，不能由业务正文关键词产生。Cloudflare 的 `cf-mitigated: challenge` 是权威信号；缺少该 header 时只允许 HTML challenge 的 title、表单、Turnstile/Challenge DOM 或 script 作为 fallback。普通 `403`、`429` 或登录接口 `404` 本身不构成 challenge。明确非 HTML、JSON 形态正文、已识别的可读 NodeSeek 页面和妖火业务正文都先按业务数据处理；隐藏 WebView 同样先提交 JSON/可读页面，再判断 challenge。见 `REG-VERIFICATION-002`。
- Feed、单站 Search、Topic 回复和 User 两个 lane 使用 Infinite Query；服务端 next page/cursor 与本次 `pageParam` 相同即停止，失败页不追加。User controller 先保存 `UserReference` 并立即展示 User route：已有 canonical id 才启用 Profile；NodeSeek username-only 先启用 resolution Query，成功后才以 UID 启用 Profile 和两个 lane。分页复用同一 UID，不重复 resolve；切用户、返回和 epoch 变化取消旧 resolution/Profile，迟到结果只留在旧 key。刷新在未解析或错误时重试 resolver，已解析时只刷新 canonical Profile；解析成功前不显示关注。普通无匹配、非法响应、网络和 429 留在 App 且零自动重试/外开，只有用户显式“原站主页”才外开；可信 Cloudflare 验证只恢复原 resolution/Profile Query。User 的 Profile Query 刚显示 next cursor 时，分页命令先确保对应 lane 已用同一 profile seed，再从 Query cache 的最后 page/pageParam 发起准确下一页，不能因 observer 提交稍晚而静默早退，见 `REG-USER-006/REG-TOPIC-039`。Topic 回复下一页的验证恢复继续调用 `fetchNextPage()` 重试原 page/offset，首屏恢复才使用 `refetch()`。聚合 Search 使用五个独立 `useQueries` 渐进结算，单站失败不能阻断其他来源。
- Query 的内部状态只有在对应业务请求已经启用后才可投影为页面 busy；未提交 Search 的 disabled Infinite Query 即使 `isPending` 也不能禁用首次提交入口，见 `REG-SEARCH-006`。
- 动态读取 outcome 是 controller/query 状态的只读投影，不是第二套网络状态：Feed 由 `useFeedController` 按当前 items、来源错误和 fetch 状态给出 `data/empty/partial/error/auth`；Search 直接按每个 group 的 items/error/nextPage/loading 投影同一词汇。Screen 只暴露当前请求 marker，Loading、未提交和旧请求不暴露终态；该层不改变 timeout、去重或重试。
- Topic 写操作只通过 Topic `useMutation` 入口进入 MutationCache；`scope.id = forum:{source}:topic:{id}` 让同一 Topic 串行、不同 Topic 可并发。所有回复、编辑、删除、互动、投票、上传与 NodeSeek 签到先经 `ensureWritableSession(source)` 取得 `{ identityKey, sessionEpoch }` ticket；dirty 会话先复核，换号、退出或 unknown 均终止且不自动重放。门禁位于用户确认之后、Query snapshot/optimistic update/文件选择/transport 之前，等待取消 Query、文件选择或写后刷新后还要复核 ticket。乐观 apply、rollback 和成功结果只修改 ticket 所属的精确 Topic/Replies cache；未确认的 unknown/failure 即使使 ticket 进入 pending，也恢复仍存在的旧 scope snapshot，但不得重建已清除的旧 epoch Query。服务器已确认后 ticket 失效只记录 `stale + serverConfirmed`，不弹成功提示、不应用迟到结果、不回滚或重发，也不写新 epoch。站点 client/runtime 提供 `SourceErrorKind` 证据，只有 `login-required`、`login-expired`、`verification-required` 请求 Account Query 对账；`ordinary` 和 `permission-denied` 只结算本次 mutation，不建立身份 barrier。非幂等请求发出后不自动重试。见 `REG-WRITE-023/024/025`。
- Cloudflare/WebView 恢复、小隐寺 Device Code 轮询、凭据存储 transaction 和导航快照是多步 workflow，仍可使用受限 generation 防止过期恢复落地；不得用它们重新实现 Query 已有的 dedupe、cache 或取消所有权。

### Discourse 字段规则

- 跨站身份、正文、时间、计数、标准权限和标准 action 状态进入公共模型；Feed、详情、回复或用户数据缺少其必需身份/正文时 adapter 必须报告解析失败，不能伪造。搜索命中缺少可靠主题作者时仍保留结果并让 UI 显示未知作者，不能把命中回复者或最后回复者冒充楼主。
- 头像、标签、展示计数等可选公共字段允许缺失，UI 按缺失状态降级；写权限缺失必须 fail-closed，不得因为字段没返回就显示操作。
- 站点新增但业务上重要的独有字段进入 `src/types.ts` 的 `SiteExtensionMap`，以 `siteExtension.source` 形成可穷尽的判别联合；当前 linux.do `boostCount` 与 `needsApproval` 即按此处理。它只能由对应 adapter 写入、对应 presenter/行为 adapter 消费，不能塞进公共顶层字段，也不能使用无类型 `Record<string, unknown>` 绕过边界。
- `reactions[]` 与 `/emojis.json` 是标准 Discourse 语义：`discourseReactions` 负责 id、计数、图片 URL 和未知 id 的文字回退；linux.do 与小隐寺的目录请求经 `sourceGateway` 和 `discourseSourceReaders` port 进入各自 adapter，由 adapter 绝对化并缓存。Topic 切站或卸载会取消旧请求，迟到结果不得落到当前站点；目录和缓存不得跨站复用，linux.do boost 不进入公共 reaction 模型。
- 仅用于 transport 或一次请求解析、UI 与业务都不消费的原始字段不进入领域模型。

### 新 Discourse 站点接入

标准 Discourse 站点的编译期接入清单是：在 `sourceCatalog` 显式声明 `managedSession` 与其他 capability；新增独立 `local*` adapter 与 transport；在 `discourseSourceReaders`、`discourseSourceActions` 和 `discourseActionRuntime` 注册；接入独立鉴权；增加匿名与登录 fixture/contract tests。`SessionSource`、Gateway epoch 与 identity barrier 都从 `managedSession` 派生，不维护第二份登录站点数组。若站点只使用现有语义，不应修改 Feed、Search、Topic 页面或公共领域模型；只有出现新的业务语义时才扩展公共语义，出现重要站点私有字段时按 `SiteExtensionMap` 增加 typed extension 和站点 presenter。这里不提供 runtime plugin、hook bag、adapter 继承或版本矩阵。

## 导航与状态边界

- `src/app/AppNavigator.tsx` 是唯一的路由事实源；`AppRoot` 的 `screen` 只由 NavigationContainer 的 route change 回调更新，页面跳转只能调用导航命令。
- 详情 session 由 `useTopicSessionController` 聚合，并通过 `src/topicSessionState.ts` 快照保存和恢复；互动 controller 使用回复成功收尾、草稿图片插入和 action 状态更新等领域命令，不直接修改详情 session 的 state。嵌套详情、Topic→User→Topic、Android 物理返回、草稿和滚动位置是必须保留的行为。
- 嵌套 Topic 快照按 React Navigation route key 保存；现有手动 back stack 只作为可回滚兼容路径。详情读取与 action controller 都只接收聚合后的 Topic session port，不再穿透内部 ref。

## 首页筛选

- 首页聚合页只显示阅读筛选：`全部`、`未读`、`已读`、`收藏`。
- linux.do 单站分类行右侧显示排序菜单，支持 `最新`、`热门`、`新·所有`、`新·话题`、`新·回复`；分类和排序同时进入请求 key，避免列表缓存串用。
- 小隐寺单站支持 `最新`、`热门`、`新·所有`、`新·话题`、`新·回复`，分类和排序状态与 linux.do 完全隔离；标准 Discourse 能力可以共享查询语义，但请求、凭据和资源仍走小隐寺 adapter。
- NodeSeek 单站在未选分类时支持 `新帖子`、`新评论`；V2EX 单站在未选分类时支持 `全部`、`最新`、`最热`。
- 新增首页筛选状态应先放进 `src/feedCategoryRail.ts`，再通过 `src/app/useFeedController.ts` 进入 `getFeed`。

## 账号中心

- `src/app/useNodeImageAuthController.ts` 统一拥有 NodeImage Key 与授权 panel 两组状态/动作；`AppRoot` 只提供 auth-surface 协调、canonical Account 对账和同步 session runtime，导航与 hardware-back 仍由 `AppRoot` 统一处理。
- More 页只有一个 `账号中心`，由 `src/screens/MoreScreen.tsx`、`src/screens/more/AccountCenterPanel.tsx` 和 `src/screens/more/accountCenter.ts` 承载；NodeSeek、linux.do、妖火和小隐寺共用会话、身份和主操作视图，同一时间只展开一个站点。
- 账号中心顶部只有一个公共 `刷新账号状态`，一次刷新四个可登录来源；原三站主页、登录 / 验证、检测、清除登录、刷新网页、NodeImage、签到和 linux.do 等级入口保持不变。小隐寺已授权时显示本人主页、授权管理和底部独立的“查看等级”入口，未授权时显示 Device Code 授权。代理、诊断、备份和外观保持独立。
- `src/credentialVault.ts` 使用现有 SecureStore 按站点隔离原三站账号密码；`src/loginFormAdapters.ts` 只允许在这三站声明的可信登录 URL 和字段上主动填入，触发输入事件但不提交。小隐寺不保存或填入 Google / Discord 账号密码。
- 网站 Cookie 与保存的账号密码是两套独立数据：清除网站登录不删除凭据，删除凭据也不退出当前网站登录。
- More 页 `服务器代理` 由 `src/screens/more/NetworkProxyModal.tsx` 承载，配置 HTTP / SOCKS5 代理并执行完整 TLS、HTTPS hostname 与固定 204 HTTP 响应的连通性测试；显示耗时是整段往返时间，不是 TCP Ping。
- `src/app/useAccountStatusController.ts` 以四个按 source 命名的 canonical Query 负责 `refreshAccountStatus`，并直接从各 Query 的 data/error/fetchStatus 派生账号中心 view model；临时 probe 不先污染旧 canonical key，远端身份、错误或 Loading 也不复制回 workflow state。`src/app/useBackupStatusController.ts` 只负责备份导入导出。`AppRoot` 在本机资料加载完成后静默刷新一次，手动刷新才提示结果。
- `src/app/useAccountController.ts` 负责 NodeSeek、linux.do、妖火登录页内的显式检测、账号密码填入、用户明确触发的登录清理和 linux.do 等级读取；`authSurfaceCoordinator` 统一页面打开/关闭与自动对账。NodeSeek 与 linux.do 每次手动 probe 只接受当前 WebView 文档的私有 nonce 与 documentKey 三态结果，任何新文档 `onLoadStart` 都先作废旧 probe。
- 登录 WebView 的组件身份只由 surface ticket 和显式 renderer 恢复 generation 决定；凭据填入 attempt 只用于关联 probe / fill 回执，必须通过已挂载 WebView 的 `injectJavaScript` 发送，不能进入 React key 销毁当前页面。登录 Cookie 的删除只暴露为原生 `clearManagedLoginCookies(source)`，仅由用户明确“清除登录”调用并回读确认；NodeSeek/linux.do 保留 Cloudflare Cookie，其他站不受影响。普通读取不调用 `flush()`。见 `REG-ACCOUNT-022/031`。
- NodeSeek 登录 WebView 对每个当前 attempt 只暴露 App 自有 `nodeseek-login-webview-settled`：成功、明确错误或代理阻断均可结算，Loading 不结算，并始终保留“刷新页面”。这个 surface 供 Replay 验证 App 流程，不把第三方 DOM 或数据可得性写进产品状态。
- `src/app/useSessionController.ts` 负责 workflow、本地凭据 generation、按站 epoch 与显式清除事务，不再保存或回灌可传输的 Cookie header。旧版 `nodeseek-access`、`linuxdo-clearance`、`yaohuo-cookie-header` 只在准确原生读取成功后删除一次；迁移不写 WebView Cookie。
- `SiteSessionState` 只作为登录弹层、凭据 transaction 和验证/授权 workflow 的本地生命周期输入；Account canonical Query 持有远端身份，二者只在 `SiteSessionViewModel` 组合，`identityTrust=pending` 时统一关闭 `canWrite`。WebView userId、Cookie 摘要和授权回调都不能独立覆盖 canonical identity。
- `SiteSessionState` 不是小隐寺数据读取的授权投影。managed Gateway 直接读取 SecureStore 中的 User API Key / Client ID，并用 credential generation 拒绝迟到结果；不得因为 Account Query 不再回写 workflow session，就把仍有效的凭据当作不存在。
- NodeSeek 当前账号只由当前会话页面证明：优先只读取服务端注入的 `__config__.user`，不递归接受同一配置内的 `profile/detail/member` 等公开或无关对象；再读取当前首页或设置页的专属 self-account 结构。不存在的 `/api/account/getInfo?readme=1` 不得被当作当前账号端点；保存的 userId 和 `/api/account/getInfo/{id}` 公开资料只用于用户页与显示，不能证明登录。渲染完成后，配置对象自有 `user` 字段且精确为 `null`，或当前页同时准确呈现登录、注册游客控件，才提交 `login-expired`；缺字段、`undefined`、`false`、空对象、HTML 404、普通网络、CF、超时或解析不确定都只能产生 `check-failed`，不得授权清除登录 Cookie。Account transport 先保留具有明确身份证据的直连快路径；直连 SSR 只有帖子列表而无身份结论时才进入共享 WebView，active request 只暴露非敏感 `owner`。只有 `account` probe 在 document 建立后提前启动身份证据轮询，并保留 `onLoadEnd` fallback；幂等 request guard 防止双注入重复回传，普通 Feed/Topic/Search 仍在加载结束后注入。脚本必须等待 current user、精确匿名 runtime 或完整游客控件，不能以“内容可读”提前结算；精确匿名 runtime 只桥接紧凑内部标记，不回传整页。见 `REG-ACCOUNT-024/025/037`。
- 四站不共享验证器，但共享登录证据语义：`logged-in` 必须由当前凭据端点的 current user 或站点专属 self-account 结构证明，`logged-out` 必须由该站协议明确约定的匿名结果证明，其余均为 `unknown`。Cookie、旧 userId、Topic 作者、公开资料和普通业务文案不能证明身份。NodeSeek 先检查首页并按需回退设置页，以 `__config__.user` 对象 / self-account 结构证明登录，以渲染后配置对象自有 `user === null` 或同页准确登录与注册游客控件证明退出；直连已有明确证据时不启用 WebView，普通 403/404、CF、登录 URL、网络及解析失败均 unknown。linux.do 只用 `/session/current.json`，合法 current user 为登录、匿名 404 为退出，401/403/challenge/网络失败均 unknown，且不以 `_t` 存在作为前置条件。小隐寺在 User API Key 下以同一端点的 current user 为登录证据，只把 Discourse JSON `403` 且 `error_type=invalid_access` 或显式匿名字段视为退出证据。妖火先检查 `wapindex.aspx?sid=-2`，以 `div.top2` 本人导航及 `touserid` 证明登录；公开页无法证明身份时再读取精确 `waplogin.aspx?siteid=1000`，只有 `form[name=login][method=post]` 同时包含准确账号与密码字段才证明退出。完整登录 form 的退出证据优先于该页自带的 Gocaptcha/ImageCaptcha 资源；只有缺少完整登录 form 的独立验证页才是 `verification`。缺字段、错 URL、HTTP 错误与普通“我的/欢迎”文字均 unknown；写操作在准确 action URL 即时读取 SID。Cookie 名只形成非敏感摘要，传输由原生只读 CookieJar 按准确 URL 完成。`unknown` 不清凭据、不发布登录/退出，并保留 Account Query 的上次可信 data 只读。见 `REG-ACCOUNT-025/026/029/031/037`。
- 妖火写请求只接受 Cookie header 中唯一的有效 `sidyaohuo`：空值和 `-2` 忽略，重复的同值 scope 可合并，出现两个不同有效值则在本地失败且保持零 transport；回复 body 与删除 URL 必须使用同一个已确认 SID，见 `REG-ACCOUNT-036`。
- 原站 WebView 的 Cookie jar 由网站与 Android `CookieManager` 持有，是 NodeSeek、linux.do、妖火请求 Cookie 的唯一事实来源。普通 React Native API 请求继续由 `ReadOnlyWebViewCookieHandler` 按准确 URL 读取，响应 `Set-Cookie` 的保存入口为 no-op；调用方不得维护 Cookie 名白名单、拼接 header、缓存传输值或在实时读取为空时回退旧快照。媒体请求必须携带由正文/用户模型给出的 `ForumMediaRequestContext`，JS 只添加内部 `X-WZ-Forum-Media-Source` 与不含凭据的 `X-WZ-Forum-Media-Identity`，绝不读取 Cookie；私有 identity 由进程 nonce 与 session epoch 组成，留在 Expo/Glide request model 和 cache key 中，使同进程同 epoch 可复用、换 epoch 不合并、重启不复用旧私有磁盘条目。原生 application interceptor 在发网前同时移除两个内部头，并给有合法来源标记的请求设置 request `Cache-Control: no-store`，使其既不读取已有的未分区 OkHttp cache，也不写入新条目。孤立 identity 头同样必须移除但不得把普通请求升级为媒体 Cookie/no-store 策略。普通无标记 API 的 HTTP cache 与 public 媒体的稳定磁盘 namespace 不变。只有首跳目标与内容来源匹配时才允许 Cookie，任一重定向离开来源后 policy 永久降级匿名，跳回也不恢复；跨论坛、未知 CDN、无效/anonymous 标记继续请求但不读 Cookie，读取异常同样 fail-closed。头像、正文、贴纸、link card、视频、预览和保存共用这条边界；来源 epoch 只用于 request/cache identity，不从目标 URL 反推。账号检测、刷新、过期判定、fallback 和普通失败不得写入或删除原站 Cookie；只有用户明确点击该站“清除登录”时才允许定向过期并回读确认。Android 同进程的可见与隐藏 WebView 共用 `CookieManager`，原生桥只调用公开 API，不读取 WebView 私有数据库。见 `REG-ACCOUNT-026/027/029`、`REG-TOPIC-019/029/037/041/042`。
- 当前身份 endpoint 与失效语义必须有可追溯来源：优先官方源码/文档，其次当前站点实际调用，再次成熟客户端；测试 fixture 或 mock 不能自行创造生产接口及其状态码契约。任何原站登录清理都是破坏性权限，只有明确用户操作可以授予；回归语料必须记录目标 Cookie、保留项和精确完成条件。
- 对账确认 A→B、A→anonymous 或 anonymous→B 时，先取消旧请求，再递增目标站 session epoch，并把 probe 结果 seed 到新 epoch 的 canonical Account key；目标站及 `all` 私有 Query、Level/AI、Topic 服务端数据与 managed media 身份缓存一起失效，其他站不变。A→A 只更新确认时间并解除 barrier；unknown 保留旧 epoch、可信身份和已加载内容只读。Feed `all` 的 barrier key 可以刷新其他来源，但展示层仍合并同 epoch 旧聚合中 dirty 来源的可信条目；换 epoch 后不得再合并。Topic 的主题选择、滚动、筛选和草稿属于本地 route snapshot 可保留；User route 只保存 `UserReference` 定位字段，旧 resolution、Profile、正文、回复、头像、简介、等级与活动列表不得跨 epoch 复用。
- 未登录验收不在 App 内模拟身份或过滤 Cookie，而是在独立 AVD 上安装同一待测 APK，让 Account Query、CookieManager 和来源 adapter 走生产路径。该 AVD 不复制主设备数据、不登录论坛；Cloudflare 要求验证时可在 App 内原站 WebView 完成访客验证并保留 clearance。`verified` 只表示访客验证已通过，仍保持 `isLoggedIn=false` 并使用匿名来源协议，不能被 Replay 当作已登录或失败。默认/Release Replay 与未登录 Replay 分目录、分设备执行，见 `REG-TEST-003/004`、`REG-OPS-009`。
- 未登录搜索不是统一 Google 模式，而是五站 adapter 能力矩阵：V2EX 使用 SoV2EX；NodeSeek 与 linux.do 只有在身份已确认未登录时使用各自 `site:` 约束的 Google hidden WebView，身份 pending/unknown 仍由 identity barrier 暂停；小隐寺使用公开 `/search.json`，妖火搜索依赖原站会话。Google 的 `/httpservice/retry/enablejs` 只作为当前 scoped search 的同 origin、精确参数中间 capability gate；导航和最终结果都绑定初始任务类型及同一 `q/start`，不能跨到论坛原域、另一搜索或把 gate 当成成功。Google SearchGuard 随后给出的 exact `q/sca_esv/emsg=SG_REL/sei` 访问故障回路仍被拦截，但归类为环境验证受限而不是外部链接；不自动重试。见 `REG-SEARCH-014/015`。
- NodeImage 显式授权先对 NodeSeek 做 canonical Account preflight 并捕获 `{identityKey, sessionEpoch}`，随后以三个独立 WebView mount 执行 `nodeimage-session → nodeseek-cauth → nodeimage-verify`。每个 mount 只在精确顶层 URL 使用声明式 `injectedJavaScript + onMessage`：session 页已经渲染 `#apiKeyInput` 时直接读取这个 DOM 兜底，否则由现有 NodeImage Cookie 请求 `/api/user/api-key`；取得 Key 即保存并关闭，只有精确 `401 + application/json + 非空 error` 才进入 Connect。bridge 将 Native `onMessage.url` 只作为当前 phase 的 HTTPS source-origin 证据，兼容现代 origin-only 与旧 bridge 完整 URL；脚本每次发消息及接受 start 前都重读 `location.href`，并另报精确 `documentUrl`，并同时通过顶层窗口、固定页面、nonce、owner、epoch 与 credential generation 门禁。Connect 页每 500ms 重报 ready，合法 start 后立即停止；Native flow 只领取一次执行权，页面 lexical guard 继续保证 `/api/cAuth` 最多一次，ready 重试绝不等于网络重试。成功后自动切回 NodeImage 调用 `/api/auth/verify` 并取 Key。三个 phase 从各自文档挂载起分别有 30/60/30 秒 watchdog；超时立即终止并卸载 WebView，Connect 未开始时只明确本 flow 未发起连接，已开始时明确结果未知且可能占用一次，不自动重试。API 请求一旦得到 HTML 403、网络、5xx、解析失败或 200 缺 Key 就停止，不再读取 DOM 掩盖错误，也不推断 session 失效；页面以透明触摸层阻止按钮和刷新，不依赖 popup 或 `window.opener`。NodeSeek Cookie、NodeImage `session_id` 与 SecureStore Key 是三份独立状态，App 不复制或手写 Cookie。每次 flow 使用 128-bit 安全 nonce，异步初始化 single-flight；切换 surface 或关闭取消 pending opening。失败立即终止 flow，迟到消息不能继续推进；最终 reconcile 与 SecureStore 写入前后门禁仍全部生效，脱敏诊断只记录阶段名及 `state/reason=timeout`，见 `REG-ACCOUNT-010/038/040`。
- linux.do 验证弹层由 `src/app/LinuxDoVerifyModal.tsx` 和全局 modal host 承载。
- 小隐寺由 `src/app/useXiaoyinsiAuthController.ts` 驱动独立 Device Code 状态机：App 生成安装级 Client ID、单次 nonce 与 Android Keystore RSA 密钥；系统浏览器只承载一次性 Google / Discord 身份确认和站点授权页，不提供 Cookie 或 App 登录态。App 前台轮询并在解密后校验 nonce，之后只以 User API Key、Client ID 和 `/session/current.json` 维护身份。待授权状态可在十分钟内跨进程恢复，后台暂停轮询。Account Query 使用该 controller 的只读授权检查结果直接构造 Query session，不发布 `SiteSessionState` 事件；Device Code、撤销和被动失效流程才提交 workflow session event。
- 小隐寺 User API Key、Client ID 与短期待授权状态使用独立 SecureStore key；RSA 私钥不导出 Keystore。撤销先请求原站，成功后才删除本机授权材料；站点不支持 Device Code 时继续匿名读取，不降级到 WebView Cookie 登录。

## 服务器代理

- 代理配置保存在 Android 安全存储，不进入备份 JSON。
- 原生 runtime 安装后立即 fail-closed；只有安全存储读取成功并完成一次完整 apply，才允许发布代理或直连。启用、切换和关闭期间，App 请求与 WebView 都保持阻止状态；即使 JS 已先把 `enabled` 更新为 false，WebView 也必须等原生 clear callback 成功后才能加载。代理应用失败时不能静默回退直连。
- 原生 server 拥有全部 client/upstream socket，连接与 copy executor 均有固定上限；停止或 bridge 销毁时先拒绝新的 probe、取消受管 OkHttp、关闭旧 server/tunnel，再释放 worker。旧 bridge 不能停止或覆盖新 bridge 的 server/WebView 状态。
- Android 原生代理模块由 `plugins/withNetworkProxyModule.js` 写入生成目录，并通过 `app.json` 的 plugin 列表持久化。它在 `OkHttpClientProvider` 的同一 client builder 上同时安装代理 `ProxySelector`、媒体来源 interceptor 与只读 WebView CookieJar；该 Jar 满足 RN `CookieJarContainer` 类型契约，但拒绝 Networking 生命周期把 delegate 换回可写 handler。Expo Image 使用该 client 的 clone，只增加 30 秒 `callTimeout`；RN 基础 client 保持零总时限。锁定版本的 Expo Video DataSource 由精确 sentinel 改用项目配置的 OkHttp provider，源码形状变化时 prebuild 失败；视频不继承图片总时限。所有 client 复用同一 selector、dispatcher、connection pool 和 Cookie policy，不创建绕开代理的平行 client。见 `REG-ACCOUNT-030`、`REG-TOPIC-029/032`。
- 复杂 SVG 保持 Expo Image/AndroidSVG 原生快路径；只有原生解码失败后，生成的 `SvgRendererModule` 才用项目配置过的 OkHttp client 复取，并按响应流读取至 1 MiB + 1 byte 即中止；React Native 不先物化无界响应。`src/compatibleImageSources.ts` 只为门禁内的明确 SVG 建立共享 document artifact，尺寸取自已验证 XML 的真实根元素。模块在同一排队批次内复用一个串行、禁网、禁脚本和禁文件访问的 Chromium WebView，把原始 SVG 数据 URI 栅格化为有界 PNG 海报；队列空闲后立即断开引用并销毁 WebView，不保留已 measure/layout 的空白 renderer。正文仍由 Expo Image 显示；全屏 PagerView 的每页由 ResumableZoom 只变换 raster 或 SVG 海报，`animated` artifact 的隔离 document view 是同一 page 内、缩放树外的绝对定位 sibling，只在当前项挂载，并始终保留同尺寸海报作为底层连续帧。poster 已 `onDisplay` 后，双指或双击缩放只把固定 1 倍的 document view 透明隐藏；poster 尚未显示则继续保留固定 1 倍动画，不能为了降载制造空白。放大和平移只变换海报，回到 1 倍后直接显示同一个 document view，不销毁 Chromium 或重新发网。固定 nonce 的本地 bootstrap 只回报内层 `<img>` 就绪/失败，原始 SVG 仍以不可执行脚本、不可导航、不可访问网络/文件的 data image 载入。Android 动态复杂 SVG 使用平台默认合成层；普通图片、静态 artifact 和相邻页都不创建全屏 WebView，相邻页失败不得预启动复取、海报或 Chromium，保存仍重新读取原始 SVG。海报与 artifact 都按完整媒体 request identity 有界缓存，session epoch 变化不得复用旧结果；原生文件 LRU 淘汰海报后只用 artifact 内的原始字节重建一次，不重新发网。不得把 WebView 插入正文树或任何 scale transform 子树，也不得把 SVG 变形后再次交给 AndroidSVG。见 `REG-TOPIC-020/038/043/044/045`。
- 全局 `dispatcher.cancelAll()` 与 `connectionPool.evictAll()` 只属于代理配置 transition 的 fail-closed 清理。普通站点超时、Cloudflare、解析或账号失败不得触发全局取消，也不得误伤其他站在飞请求。见 `REG-PROXY-006`。
- 本地开发地址 `localhost`、`127.*`、`10.0.2.2` 和 `::1` 不走代理。

## 详情页

- `src/screens/TopicScreen.tsx` 是兼容入口，继续导出 `TopicScreen` 和 `TopicListItem`。
- `src/screens/topic/TopicScreenBody.tsx` 承载详情页主体，组合详情内容、回复列表、楼层搜索、操作菜单和回复框。
- `src/screens/topic/topicScreenHelpers.ts` 承载详情页纯辅助逻辑，例如回复 key、状态徽标和权限提示识别。
- `src/screens/topic/ReplyItem.tsx`、`src/screens/topic/TopicBodyQuoteCard.tsx`、`src/screens/topic/ReplyComposer.tsx`、`src/screens/topic/TopicActionBar.tsx`、`src/screens/topic/TopicContentBlock.tsx`、`src/screens/topic/TopicMenu.tsx`、`src/screens/topic/TopicPolls.tsx` 分别承载详情页局部 UI。正文引用卡片与评论引用卡片保持独立展示实现；`src/quotedPosts.ts` 只共享来源、主题 id、帖子号组成的引用标识和缓存键。

## 回复写操作

- `src/app/useTopicActionsController.ts` 负责回复、楼层回复、编辑、删除、图片上传和互动请求。
- linux.do 与小隐寺的标准 Discourse 请求由 `discourseActions` 共享；站点差异只通过 `discourseSourceActions` override 和独立 action client/鉴权处理。
- NodeSeek 编辑自己的回复使用原站真实评论 id；当前回复和编辑请求未传 token 时，由 `src/nodeseekActions.ts` 生成 16 位 `csrf-token`。
- NodeSeek 图片上传通过 NodeImage；上传链路只读取属于当前 NodeSeek 身份的已保存 API Key。Key 缺失、归属不符或上传返回 401/403 时只提示用户到账号中心“获取 / 恢复授权”或手动粘贴，不从上传动作打开授权、清 Key、重试上传或重开文件选择器。
- linux.do 图片上传走原站 `/uploads.json`；妖火图片上传走图床并插入 UBB 图片标签。
- 小隐寺图片上传走原站 `/uploads.json`；Discourse 点赞和书签统一先显示 optimistic 状态、失败时恢复原状态，投票经服务器确认后局部更新；删除先本地移除再定向静默刷新回复，回复与编辑只刷新对应回复数据。权限始终来自原站明确字段，不能乐观推断，Live 验收再通过刷新或重进核对服务器状态。
- 删除回复只在来源解析出明确权限时显示：Discourse 使用 `can_delete`，妖火使用原站删除链接；NodeSeek 未确认删除入口时不显示删除。

## 收藏页

- `src/screens/LibraryScreen.tsx` 承载收藏、历史和关注用户页展示。
- `src/screens/library/libraryScreenItems.ts` 承载收藏页列表分组、列表 key、item type 和数量文案。

## 数据边界

- NodeSeek、linux.do、妖火网站 Cookie 只存在 Android WebView `CookieManager`；App 不持久化可传输 header。自动填入账号密码、NodeImage API Key、小隐寺 User API Key / Client ID 等 App 私有凭据使用各自 SecureStore key；小隐寺 RSA 私钥只存在 Android Keystore。
- 服务器代理地址、用户名和密码只保存在 Android 本机安全存储。
- 搜索历史保存在 `AsyncStorage`，最多 20 条，单条最多 120 字符。
- 本机资料只通过当前版本 JSON 备份 / 恢复迁移；导入会限制 JSON 大小和嵌套深度。
- `android/`、`.expo/`、临时截图、日志和 Cookie 数据库都不进入仓库。

## 稳定入口与生成边界

- `App.tsx`、`src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是稳定入口或兼容 facade；保持现有导出，不把实现重新堆回入口文件。
- `android/` 是生成目录；Android 长期配置通过 `app.json` 与 `plugins/` 持久化。
- 不改变备份 JSON、安全存储键、Cookie、User API Key、代理、签名或更新 manifest 格式，除非有单独迁移方案和兼容验证。
- 技术债务按 [用户旅程技术债务清单](code-cleanup-map.md) 分批处理，不以目录、文件大小或代码行数作为清理优先级。
