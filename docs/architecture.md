# 架构说明

## 文档职责

- `docs/product-charter.md` 定义产品目标、核心旅程和取舍标准。
- `docs/product-map.md` 定义现有能力、用户入口、能力 ID 和共享回归范围。
- `docs/regression-corpus.md` 记录历史逃逸问题、精确 oracle 和最低可靠测试层。
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
| `src/app/serverState.ts` | TanStack Query 的唯一 client、五站 query/mutation key 和按来源清理边界 |
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

- App controller 通过 `src/sources/sourceGateway.ts` 的 `getFeed`、`searchTopics`、`getTopic`、`getReplies` 和用户资料 interface 读取五站数据。
- `src/sourceCatalog.ts` 是来源集合的唯一静态事实源；来源类型、聚合 Feed/Search、筛选状态、可登录站点、诊断枚举和页面 action capability 都从这里派生，不在页面中维护 LinuxDo/小隐寺成对名单。
- 五站的首页、搜索、主题、回复和用户资料读取均已进入 managed gateway：`createSourceGateway` 组装 WebView fallback fetcher、Cookie、User-Agent、凭据 generation、妖火失效清理和按来源键控的 `discourseAuth`；controller 只传业务参数和请求归属上下文。
- linux.do 与小隐寺是两个独立 adapter，共同实现 `src/discourseSourceReaders.ts` 的标准读取 port；两者组合 `discourseModel` 等无站点偏向模块，不继承彼此，也不共享 Cookie、CSRF、Cloudflare、User API Key 或缓存状态。
- 标准 Discourse 回复、点赞、书签、编辑、删除、投票和上传先表达为 `DiscourseAction`，再由 `discourseSourceActions` 选择标准 request builder 或最小站点 override；小隐寺 Topic 无 bookmark id 的取消收藏是当前 override。`discourseActionRuntime` 按来源注册独立鉴权和 transport，Topic controller 只执行统一 action 生命周期。
- Feed、Search、Topic UI 只消费语义筛选、权限和 action capability；标准 Discourse emoji 目录由各 adapter 独立读取后交给公共 presenter，linux.do boost、Cloudflare 验证、小隐寺 Device Code 等站点特性留在站点 presenter、鉴权或 transport 边界。
- App controller 使用不带 `Direct` 和站点前缀的通用读取入口；妖火的 `Direct` 命名只保留在 gateway 后的来源实现。
- `sourceGateway` 内部仍转发到 `src/forumApi.ts` 和 `src/yaohuoApi.ts`；Discourse adapter 注册集中在 `discourseSourceReaders` / `discourseSourceActions`。
- `src/forumApi.ts` 仍是现有读取实现的一部分，不应从文档中当作已删除文件处理。
- 新增读取调用方应使用 `sourceGateway`，不要在 `src/app/*Controller.ts` 里新增对旧读取来源文件的直接调用；新增写操作复用现有 action client，并按触及路径逐项收口。
- 来源静态 capability 只说明该站可能支持某项能力；当前主题或回复的 `canEdit`、`canDelete` 等权限仍以原站解析结果为准。

## 服务器状态与请求生命周期

- Feed、Search、Topic/回复/引用、User 和 Account/等级读取由 `src/app/serverState.ts` 的 TanStack Query client 统一拥有。key 固定以 `forum -> source -> resource` 开头，并包含会改变响应身份的筛选、排序、页码或 cursor；只有账号检查等按凭据快照执行的 workflow 才把 generation 放进 key。页面不得再新建 transport request id/owner map。
- Query `queryFn` 的有效性只由 TanStack 提供的 `AbortSignal` 决定，并把它直接传给 `sourceGateway`；相同 key 的并发读取共享一个 transport。页面 generation 只阻止较旧调用方应用共享结果或覆盖 Loading，不得反向取消仍被较新调用方需要的 Query。`sourceGateway` 仍只负责凭据 generation 校验、adapter、transport 和标准化错误，不承担 UI 请求归属。来源返回失败、需要验证或 `parse_empty` 时不保存为可信数据。
- 默认不自动 retry，不因 mount、重连或回到前台自动重发。Android Home 只更新 TanStack focus 和 `src/request.ts` 的 active-time timeout 时钟，不取消在飞详情请求；离开 Topic route 才取消对应读取。
- 读取已保存凭据和原站身份只发布 `cookie-loaded` 观察事件，不得取消当前 Query；小隐寺的被动授权复核也遵守这一语义。新凭据提交、Device Code 授权完成发布 `session-updated`，登录确认变化、凭据过期和明确清除也是会话 transition。`useSessionController` 对这些 transition 只取消并移除对应 source 以及可能混入它的 `all` 聚合 Query，并同步清除 Feed/Search/Topic/User 的该来源页面投影；其他来源保持不变，聚合 Search 中未受影响来源继续结算。
- linux.do 打开验证前先清理旧 clearance；该次 transition 无论落为 `session-updated` 还是 `cleared` 都携带 recovery key。新凭据保存后只在 recovery 仍 current 时再次携带同一个 key；stale recovery 不得借 session transition 保活。各 controller 只按 key、source、lane 完全相等保留触发验证的精确 Feed/Search/Topic/User 请求；首屏 lane 清旧投影后重读，分页、回复和引用 lane 保留已加载数据与 cursor 作为合并基线。恢复成功后的 `verification-succeeded` 只是状态观察，不得再次失效 Query 或擦除刚恢复的页面。见 `REG-LINUXDO-002`、`REG-TOPIC-022`。
- Query cache 里已经存在下一页，不代表页面已经展示了下一页；Feed、Search、Topic 和 User 只能比较服务端返回的 next cursor 与本次请求 cursor 来判断是否还有更多，缓存页仍须经过当前页面的追加与去重逻辑。
- Topic 非幂等写操作进入 MutationCache，以 source/topic/action key 防重、串行同 scope 并使该 Topic 读缓存失效。TanStack Mutation 不提供 transport cancel，所以 `src/app/topicActionRuns.ts` 只保留写请求的 `AbortController`、Topic 离开取消和 busy 收口；乐观切换队列仍是业务状态，不是另一层服务器缓存。
- Cloudflare/WebView 恢复、小隐寺 Device Code 轮询、凭据存储 transaction 和导航快照是多步 workflow，仍可使用受限 generation 防止过期恢复落地；不得用它们重新实现 Query 已有的 dedupe、cache 或取消所有权。

### Discourse 字段规则

- 跨站身份、正文、时间、计数、标准权限和标准 action 状态进入公共模型；缺少身份或正文等必需字段时 adapter 必须报告解析失败，不能伪造。
- 头像、标签、展示计数等可选公共字段允许缺失，UI 按缺失状态降级；写权限缺失必须 fail-closed，不得因为字段没返回就显示操作。
- 站点新增但业务上重要的独有字段进入 `src/types.ts` 的 `SiteExtensionMap`，以 `siteExtension.source` 形成可穷尽的判别联合；当前 linux.do `boostCount` 与 `needsApproval` 即按此处理。它只能由对应 adapter 写入、对应 presenter/行为 adapter 消费，不能塞进公共顶层字段，也不能使用无类型 `Record<string, unknown>` 绕过边界。
- `reactions[]` 与 `/emojis.json` 是标准 Discourse 语义：`discourseReactions` 负责 id、计数、图片 URL 和未知 id 的文字回退；linux.do 与小隐寺分别在自己的 adapter 内请求、绝对化并缓存目录，经 `discourseSourceReaders` port 交给 UI。目录和缓存不得跨站复用，linux.do boost 不进入公共 reaction 模型。
- 仅用于 transport 或一次请求解析、UI 与业务都不消费的原始字段不进入领域模型。

### 新 Discourse 站点接入

标准 Discourse 站点的编译期接入清单是：在 `sourceCatalog` 注册身份/capability；新增独立 `local*` adapter 与 transport；在 `discourseSourceReaders`、`discourseSourceActions` 和 `discourseActionRuntime` 注册；接入独立鉴权；增加匿名与登录 fixture/contract tests。若站点只使用现有语义，不应修改 Feed、Search、Topic 页面或公共领域模型；只有出现新的业务语义时才扩展公共语义，出现重要站点私有字段时按 `SiteExtensionMap` 增加 typed extension 和站点 presenter。这里不提供 runtime plugin、hook bag、adapter 继承或版本矩阵。

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

- More 页只有一个 `账号中心`，由 `src/screens/MoreScreen.tsx`、`src/screens/more/AccountCenterPanel.tsx` 和 `src/screens/more/accountCenter.ts` 承载；NodeSeek、linux.do、妖火和小隐寺共用会话、身份和主操作视图，同一时间只展开一个站点。
- 账号中心顶部只有一个公共 `刷新账号状态`，一次刷新四个可登录来源；原三站主页、登录 / 验证、检测、清除登录、刷新网页、NodeImage、签到和 linux.do 等级入口保持不变。小隐寺已授权时显示本人主页、授权管理和底部独立的“查看等级”入口，未授权时显示 Device Code 授权。测试工具、代理、诊断、备份和外观保持独立。
- `src/credentialVault.ts` 使用现有 SecureStore 按站点隔离原三站账号密码；`src/loginFormAdapters.ts` 只允许在这三站声明的可信登录 URL 和字段上主动填入，触发输入事件但不提交。小隐寺不保存或填入 Google / Discord 账号密码。
- 网站 Cookie 与保存的账号密码是两套独立数据：清除网站登录不删除凭据，删除凭据也不退出当前网站登录。
- More 页 `服务器代理` 由 `src/screens/more/NetworkProxyModal.tsx` 承载，配置 HTTP / SOCKS5 代理并可测试延迟。
- `src/app/useAccountStatusController.ts` 负责 `refreshAccountStatus`；`src/app/useBackupStatusController.ts` 只负责备份导入导出。`AppRoot` 在本机资料加载完成后静默刷新一次，手动刷新才提示结果。
- `src/app/useAccountController.ts` 负责 NodeSeek、linux.do、妖火登录 / 验证页检测、Cookie 保存 / 清理和 linux.do 等级读取。
- `src/app/useSessionController.ts` 只负责加载 Cookie 和会话事实；NodeSeek Cookie 加载只返回本次凭据里的 userId，不顺带读取个人资料。
- `SiteSessionState` 是账号中心和登录弹层的唯一登录状态来源；NodeSeek 的 WebView userId 只在 session 已登录时补充身份，不能覆盖已失效、匿名或需要验证状态。
- NodeSeek 当前账号由账号刷新读取，普通请求优先，失败再 WebView 兜底；兜底 userId 只来自本次凭据，不使用旧页面状态。确定未登录的 session event 会清理运行时身份提示，普通 `check-failed` 不会误判退出。
- linux.do 验证弹层由 `src/app/LinuxDoVerifyModal.tsx` 和全局 modal host 承载。
- 小隐寺由 `src/app/useXiaoyinsiAuthController.ts` 驱动独立 Device Code 状态机：App 生成安装级 Client ID、单次 nonce 与 Android Keystore RSA 密钥；系统浏览器只承载一次性 Google / Discord 身份确认和站点授权页，不提供 Cookie 或 App 登录态。App 前台轮询并在解密后校验 nonce，之后只以 User API Key、Client ID 和 `/session/current.json` 维护身份。待授权状态可在十分钟内跨进程恢复，后台暂停轮询。
- 小隐寺 User API Key、Client ID 与短期待授权状态使用独立 SecureStore key；RSA 私钥不导出 Keystore。撤销先请求原站，成功后才删除本机授权材料；站点不支持 Device Code 时继续匿名读取，不降级到 WebView Cookie 登录。

## 服务器代理

- 代理配置保存在 Android 安全存储，不进入备份 JSON。
- 启用代理后，App 请求和 WebView 都必须等代理成功应用；代理应用失败时阻止相关网络请求，不能静默回退直连。
- Android 原生代理模块由 `plugins/withNetworkProxyModule.js` 写入生成目录，并通过 `app.json` 的 plugin 列表持久化。
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
- NodeSeek 图片上传通过 NodeImage；App 可从 NodeImage 授权页获取并缓存当前用户自己的 API Key，也保留手动粘贴备用入口。
- linux.do 图片上传走原站 `/uploads.json`；妖火图片上传走图床并插入 UBB 图片标签。
- 小隐寺图片上传走原站 `/uploads.json`；Discourse 点赞和书签统一先显示 optimistic 状态、失败时恢复原状态，投票经服务器确认后局部更新；删除先本地移除再定向静默刷新回复，回复与编辑只刷新对应回复数据。权限始终来自原站明确字段，不能乐观推断，Live 验收再通过刷新或重进核对服务器状态。
- 删除回复只在来源解析出明确权限时显示：Discourse 使用 `can_delete`，妖火使用原站删除链接；NodeSeek 未确认删除入口时不显示删除。

## 收藏页

- `src/screens/LibraryScreen.tsx` 承载收藏、历史和关注用户页展示。
- `src/screens/library/libraryScreenItems.ts` 承载收藏页列表分组、列表 key、item type 和数量文案。

## 数据边界

- Cookie 和小隐寺 User API 凭据只保存在 Android 本机安全存储；小隐寺 RSA 私钥只存在 Android Keystore。
- 服务器代理地址、用户名和密码只保存在 Android 本机安全存储。
- 搜索历史保存在 `AsyncStorage`，最多 20 条，单条最多 120 字符。
- 本机资料只通过当前版本 JSON 备份 / 恢复迁移；导入会限制 JSON 大小和嵌套深度。
- `android/`、`.expo/`、临时截图、日志和 Cookie 数据库都不进入仓库。

## 稳定入口与生成边界

- `App.tsx`、`src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是稳定入口或兼容 facade；保持现有导出，不把实现重新堆回入口文件。
- `android/` 是生成目录；Android 长期配置通过 `app.json` 与 `plugins/` 持久化。
- 不改变备份 JSON、安全存储键、Cookie、User API Key、代理、签名或更新 manifest 格式，除非有单独迁移方案和兼容验证。
- 技术债务按 [用户旅程技术债务清单](code-cleanup-map.md) 分批处理，不以目录、文件大小或代码行数作为清理优先级。
