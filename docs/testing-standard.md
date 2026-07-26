# 测试标准

## 结论

测试必须证明“功能没有被改坏”，不是证明 App 能打开。影响运行逻辑、类型或构建的改动至少执行相关自动测试和 `npm run typecheck`；纯文档或注释改动只核对内容、引用和一致性。涉及页面流程、登录态、真实来源结果或交互时，还必须做模拟器验收。

开发前先在 `docs/product-map.md` 选择直接受影响的能力 ID；触及共享 seam 时按地图展开关联 ID。交付时逐个 ID 报告自动测试、模拟器路径、真实写操作、已恢复状态和未验证范围。

当前确定性测试使用 `Vitest + jsdom` 覆盖数据规则、来源解析、请求构造和状态计算；少量 `Jest + React Native Testing Library` 测试负责用户可见渲染行为。agent-device MCP 用于探索真实 App 和执行 `tests/live/agent-live.md` 的受监督验收，tracked `.ad` Replay 用于重复关键旅程。没有覆盖率百分比基线，测试价值以能否拦住明确的用户行为回归判断。

## 判断原则

- 固定 fixture 中能确定的数据，用自动测试精确断言数量、字段、顺序、成功、空态、局部失败、鉴权、超时、解析失败和显式恢复；不新增录制框架，也不把真实认证响应提交进仓库。
- 真实网站结果每天会变，不能把实时结果条数、首条内容或第三方 DOM 写成永久固定 oracle。动态读取分别判断 App 是否让当前请求正确结算并可恢复，以及第三方数据当前是否可得；后一轴只由 Agent Live 记录。
- 搜索、首页、详情、回复、用户页和互动结果必须按对象检查实际存在且适用的关键字段和状态。正确显示错误态可以证明流程，但不能掩盖 App 的请求构造、鉴权、凭据路由或解析缺陷；来源波动也不能被误报为产品失败。
- 登录、Cookie、验证、备份、发布和安装属于高风险功能；只跑 UI 不算通过。
- 只打开 App、看首页显示、截图留存，都不算完整测试。
- 优化代码前只使用与当前 Git revision、App 版本和 APK 身份匹配的 `docs/emulator-baseline.md` 记录；优化后按同一功能、同一关键词、同一来源和同一登录态复测差异，不能以记录日期较新代替身份匹配。
- 登录和验证网页必须从 App 的 `更多 -> 账号中心` 入口打开；页面包名仍应是 `com.wz.reader`。用 Chrome 打开网页不能算登录 / 验证通过。
- 用户提供 NodeSeek、linux.do、V2EX、妖火或小隐寺主题链接用于查看、效果验证或排障时，必须按 `docs/operator-runbook.md` 的“直接打开主题链接”解析来源和主题 id，并直达模拟器 App 内详情页；搜索框、搜索结果、Chrome 或桌面浏览器都不能代替。该内部验证流程不代表产品需要支持外部 HTTPS 链接直达。
- 新增或修改依赖登录态的能力时，必须从 App 内原站同类页面核实字段、权限、入口和请求；未登录页面、桌面浏览器、第三方客户端、作者名或猜测的 API 不能作为依据。必要时可通过 WebView 调试查看 DOM、全局数据、已加载 JS 和 network，但不得输出 Cookie、token 或含敏感信息的截图、UI dump；临时取证文件只能保留在本机且不得提交。
- 单一账号、页面或当前已加载 JS/API 中没有对应入口或行为，不足以证明原站不支持。证据不足时不得猜测实现或新增入口，也不得据此移除或隐藏已有能力；应说明证据缺口。
- “全面测试”默认不授权真实发布、回复、编辑、删除、签到、上传、点赞、鸡腿、反对、投票、原站书签或收藏切换；这些写操作只用自动测试、请求构造、权限显示和只读入口检查覆盖。
- 确实需要真实写操作验收时，必须先得到用户明确同意。发帖、回复、编辑和删除只作用于本次新建、中文且贴合原帖主题的临时内容，完成后清理并刷新确认；点赞和收藏切换完成后恢复原状态；投票等不可逆操作，以及无法清理的上传，必须针对具体对象或残留风险单独取得同意。

## 证据分层与工具职责

| 结果 | 必须来自 | 不能证明 |
| --- | --- | --- |
| `STATIC_PASS` | 文档、TypeScript、unused、React Doctor changed-lines | 功能在设备上可用 |
| `UNIT_PASS` | Vitest 行为测试 | React Native 实际渲染或当天原站结果 |
| `UI_PASS` | Jest/RNTL 通过 role、label、text 或稳定 `testID` 验证的渲染行为 | Native/WebView 和真实网络行为 |
| `DEVICE_REPLAY_PASS` | `.ad` 在匹配的 App/APK/设备/会话执行成功 | 第三方当前健康、当天有数据、未包含的能力或真实写入 |
| `LIVE_PASS` | App 内真实来源或获授权写操作的可观察结果 | 其他 revision、APK、账号或日期 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR、RedBox | 业务功能完整正确 |
| `NOT_VERIFIED` | 已识别但缺少足够证据 | 不得改写为“应该可用” |
| `BLOCKED_BY_ENV` | 签名、设备、登录态或来源阻碍且不能安全改变环境 | 不等于代码失败 |

- MCP 是探索、诊断和录制入口；Replay 是经过审查后进入仓库的稳定旅程，二者不互相替代。
- tracked Replay 只能使用稳定 `testID`、accessibility label、role 和稳定文案；禁止坐标、临时引用、动态标题和固定实时数量。
- 动态读取的 Replay 只等待当前请求专属 outcome：Feed 使用 `data/empty/partial/error/auth`，Search 按来源使用同一结果词汇。Loading、未提交或旧请求不能暴露终态；永久 Loading、错误不可见、无恢复入口和来源串扰仍必须失败。一个来源或能力失败不得取消其他独立文件的取证。
- Replay 默认 retries 为 0；单个 `.ad` 首次失败即停止，普通执行失败由外层继续其他独立文件并在最后汇总，清理失败则立即中止后续文件以避免污染，只有全部通过才输出 `DEVICE_REPLAY_PASS`。带 `--record-video` 的 tracked Replay 不自行执行 `close`：test harness 必须先停止并拉回视频，再由 cleanup 关闭 session。诊断性重跑不能覆盖第一次失败。禁止在 CI 使用 `replay -u`：本机 0.19.0 仍可能重写脚本，而 0.19.1 起该参数已退役为 no-op；统一根据 divergence 建议人工修改并审查 diff。
- Agent Live 不是 CI。它只在 `npm run verify` 和相关 Replay 之后按 `targeted` 或 `full` Profile 执行；CF、动态目标、授权、恢复、不可逆写入和失败续跑规则以 `tests/live/agent-live.md` 为准。
- React Doctor 只扫描新增行并阻断新增 error；它是静态建议，不替代任何行为测试。
- 历史逃逸事故及负向控制见 `docs/regression-corpus.md`。

## 改动影响面回归

任何会被多个入口、流程或数据路径消费的改动，都不能只用当前复现入口代表完整影响面。修改前后必须按以下顺序执行：

1. 用户指定入口、路径或数据来源时，以该路径作为事实基准；不得用搜索结果、替代入口或近似数据代替。路径确实不可用时，记录阻碍和替代路径的差异。
2. 修改前用代码搜索、结构导航和必要的运行时检查枚举直接调用方、间接消费者、共享状态、配置、样式、数据结构及上下游转换，并记录各入口的输入、默认状态和结果。
3. 按行为而不是文件数量分组。数据约束、生命周期、权限、错误处理或交互结果不同的场景必须分别验收，并在实现上保持清晰边界。
4. 每类受影响行为都要有独立回归证据：优先用能在修复前失败的入口级自动测试；缺少自动化能力时，使用稳定定位和真实运行环境逐入口验收。
5. 局部模块单测只证明局部规则，不能证明所有入口接线正确；静态检查、程序可启动或单个入口截图也不能替代完整影响面回归。
6. 不得为了让新用例通过而删除或合并掉覆盖旧行为的测试。最终交付必须列出“影响面 / 验证方式 / 结果”，未验证项要明确说明原因和风险。

评论布局或间距改动还必须覆盖“正文最后一个可见内容”之后的行为差异，不能只按站点各抽一条普通文本评论：

| 来源 | 必查末尾分支 |
| --- | --- |
| NodeSeek | 普通正文、纯表情 / sticker、带用户留言或签名；可写时检查操作栏，不可写且有统计时检查统计栏 |
| linux.do | 有 / 无 reaction 统计、含投票的回复；可写时检查操作栏 |
| 小隐寺 | 有 / 无 reaction 图片统计、正文或评论 inline emoji、采纳 / 隐藏 / 折叠 / 系统回复；有逐条权限时检查操作栏，未授权时统计仍可见 |
| V2EX | 有 / 无回复目标、有 / 无感谢；本站没有评论操作栏，检查末块到分隔线及下一条评论的留白 |
| 妖火 | 普通正文、表情 / 图片；检查回复操作栏，出现删除入口时不得改变操作栏纵向几何 |

每个分支都要比较正文、表情、留言、统计或感谢中的最后一个实际可见元素到操作栏或分隔线的距离，以及操作栏到分隔线的距离；同时用真实截图做视觉复核。只量父容器、只看一张截图或只验证某站普通文本，均不能代表该改动已完整回归。

## 诊断日志完成标准

新增或修改用户可感知的功能时，诊断链是完成标准的一部分。每次公共操作至少写入 `intent`、一个能区分失败阶段的关键事件，以及唯一 `finish`；controller、gateway、传输和状态应用必须复用同一个 `traceId`。日志写入、轮转或导出失败不得改变产品行为。

| 链路 | 必须可判断 | 禁止记录 | 自动验证重点 |
| --- | --- | --- | --- |
| 首页 / 分类 / 搜索 / 详情 / 回复 / 用户页 | 用户触发或分页门禁、credential 是否存在、direct / WebView 通道、HTTP 元数据、解析数量、partial、合并前后数量、stale / cancel / apply | 搜索词、标题、作者、正文、真实 topic / user / cursor、URL path / query | 同一 `traceId` 的 start / 阶段 / 唯一终态；HTTP 200 解析为空、partial source failure、重复 cursor、旧请求丢弃 |
| 回复 / 编辑 / 删除 / 互动 / 投票 / 上传 | 权限门禁、credential / CSRF 来源枚举、请求阶段、乐观更新、rollback、本地 commit、成功后刷新是否失败 | Cookie、token、CSRF / API Key 值、正文、真实目标 ID、投票选项内容、上传文件名 / 路径 / URL | 重复写、缺 credential、乐观回滚、写成功但刷新失败、授权刷新；正文只断言长度，投票只断言选择数量 |
| Session / Cookie / WebView / 代理 | generation、store 空 / timeout / error、会话状态迁移、WebView 队列与 renderer gone、代理 load / apply / save 状态 | Cookie 名称和值、header、WebView HTML / message、代理地址 / 账号 / 密码 | stale generation、fallback / timeout、代理 apply 失败、日志中无伪造 secret |
| 本机资料 / 备份 / 更新 / 图片 / 导航 | save queue、superseded、persist、rollback、备份取消 / 解析 / 合并、更新检查 / 下载 / 校验、图片权限 / 下载 / MediaLibrary、route / snapshot / back 决策 | 任意对象序列化、备份内容、文件名 / 路径、图片 URL、页面内容 | 保存失败回滚、损坏 / 超限备份、分享取消、更新失败、权限失败、复杂返回链 |
| 导出与隐私 | 两份 1 MiB 轮转、旧到新 JSON Lines、固定元数据头、系统分享、临时文件删除 | 未列入白名单的任意字段 | 伪造 secret、ID、标题、正文、URL、路径贯穿写入和导出后均不存在；日志故障静默降级 |

诊断日志的合理目标是把多数业务问题定位到模块和失败阶段。纯视觉错位仍需截图，特定内容解析问题仍需原帖链接；native crash / ANR、GPU 和内存问题不以本地 JS 业务日志作为唯一证据。

## 有用测试标准

| 保留 | 删除或合并 |
| --- | --- |
| 能证明站点解析、请求目标、Cookie、登录态、安全边界、写操作、本地数据保存、备份恢复、请求归属或竞态回滚没有被改坏 | 只锁定 `padding`、`color`、`fontSize`、`borderRadius`、memo 比较、性能常量或内部 helper 形状 |
| 能防止用户能感知的回归，例如用户页顶部距离、回复按钮可点、mention 不像普通网页链接、隐藏 WebView 不可见 | 同一行为分支的重复样例，或只复述当前实现写法的断言 |

## 功能标准

| 功能 | 对的标准 | 常用自动测试 |
| --- | --- | --- |
| 入口 / 导航 | 冷启动进入首页；4 个底部入口可切换；从首页、搜索、收藏打开主题和用户页后可返回；详情页内再打开主题不会丢上一级状态 | `src/topicSessionState.test.ts`、`src/userNavigation.test.ts`、`src/app/backHandlerHelpers.test.ts` |
| 首页 / 分类 / 分页 | 五站来源按当前支持范围返回；分类不串站；分页不重复、不漏掉下一页，已缓存页仍须追加到当前列表；同一结构化 key 的观察者共享一个 transport 和 Query result；聚合首页保留来源平衡，单站请求或凭据存储失败只形成该来源错误；单站刷新错误或带 `parse_empty` 诊断的首屏/分页不得应用，失败页保留旧列表和 cursor，聚合分页不混入半页；真实会话变化清该站和 `all` 聚合 Query、释放 Loading 并由当前 observer 读取新 credential key，其他站不变；linux.do、NodeSeek、V2EX、小隐寺单站排序参数和缓存 key 不串用；小隐寺 latest/hot/new-all/new-topics/new-replies 分别命中真实路径与 subset，非空列表切换也必须重新请求 | `tests/ui/feed-controller-xiaoyinsi.test.tsx`、`src/app/serverState.test.ts`、`src/feedLogic.test.ts`、`src/feedCategoryRail.test.ts`、`src/forumApi.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`src/localSources.test.ts`、`src/localXiaoyinsi.test.ts` |
| 搜索 | 空关键词或请求进行中不重复提交；未提交时 disabled Query 的 `isPending` 不得泄漏为页面 busy，首次有效输入必须可提交且只发一个 transport，见 `REG-SEARCH-006`；同一结构化 key 的观察者共享一个 transport 和 Query result；“全部”按 V2EX、linux.do、NodeSeek、妖火、小隐寺固定顺序显示每站最多 2 条预览且不分页；单站直接显示连续完整列表并可分页，已缓存下一页仍须展示；结果字段完整；错误按站点隔离；带 `parse_empty` 诊断的页面不得覆盖结果或推进 cursor，只重试原失败页；真实会话变化只移除对应来源普通/AI Query 并释放 Loading；筛选参数真实传给站点；小隐寺标准 Discourse 筛选必须使用本站分类/标签/作者候选和独立 User API 凭据，包含原站解决/未解决状态，不出现 linux.do 专属专家回应或 AI；登录态限制必须显示站点提示。未登录协议必须逐站验收：V2EX 使用 SoV2EX；NodeSeek、linux.do 使用各自 scoped Google fallback；小隐寺使用公开 `/search.json`；妖火要求会话。Google JS capability gate 只允许绑定原始同站 scoped search 的精确中间导航，普通搜索导航和最终结果必须绑定 initial 的同一 `q/start`，不能跨论坛/Google 任务类型或作为最终结果，见 `REG-SEARCH-014`；exact `SG_REL` 搜索访问故障必须拒绝结算、显示 Google 环境验证受限、只允许用户显式重试，其他 extra query 仍按外部/任务不匹配拒绝，见 `REG-SEARCH-015`；登录/未登录 Query key 分离，小隐寺公开搜索不被授权状态阻断 | `src/appSecurity.test.ts`、`src/app/useSearchController.test.ts`、`src/app/serverState.test.ts`、`src/forumApi.test.ts`、`src/localSources.test.ts`、`src/localXiaoyinsi.test.ts`、`src/searchFilters.test.ts`、`src/searchListItems.test.ts`、`src/sources/sourceGateway.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`tests/ui/search-screen.test.tsx`、`tests/ui/search-controller-ai.test.tsx`、`tests/ui/hidden-browser-host.test.tsx`、`tests/ui/session-controller-browser-flow.test.tsx`、`src/yaohuoApi.test.ts` |
| 详情 / 回复 | 标题、正文、作者、时间、分类、回复数和权限提示正确；同一结构化 key 的观察者共享一个 transport 和 Query result；带 `parse_empty` 诊断的详情、回复页或引用帖不得应用；回复分页不丢楼层或推进失败 cursor，已缓存下一页仍须展示；下一页遇到 linux.do 验证时恢复必须重试相同 page/offset 并与旧页只合并一次，不得用 refetch 重取首屏；V2EX 评论刷新委托整篇读取时，只有 Topic Query refetch 返回新详情才记录成功；真实会话变化清除对应来源旧详情 Query，route snapshot 不复制详情；释放 Loading 并保留可重试目标；正文引用和评论引用分别默认显示简介，展开后显示目标完整帖子，且两条渲染路径互不串样式、状态或缓存；同一 reference key 的多个引用实例共享 Query transport、Loading 和结果；离开 Topic 精确取消，linux.do 只恢复完全匹配的 Query key；块级正文图片冷加载只有一个全宽 4:3 占位和一个连续 Spinner，同一 ImageRef 就绪后直接显示，热重进保持真实比例，请求切换不泄漏旧图，inline 媒体不进入块图 loader；图片预览可用且快速重复保存只写入一次；返回后上一层详情状态保留 | `src/app/useTopicController.test.ts`、`src/app/serverState.test.ts`、`src/quotedPosts.test.ts`、`src/topicSessionState.test.ts`、`src/topicDerivedData.test.ts`、`src/topicContentSplit.test.ts`、`src/topicContentHtml.test.ts`、`src/topicListItemState.test.ts`、`src/localSources.test.ts`、`tests/ui/topic-session-controller.test.tsx`、`tests/ui/topic-image-loading.test.tsx`、`tests/ui/image-preview-controller.test.tsx` |
| 回复编辑 / 图片上传 | 四个可写来源回复失败后输入框仍可点击；格式按钮按站点插入 Markdown / UBB；NodeImage 显式授权先复用现有 session，只有精确匿名契约才 Connect；NodeSeek 上传只读取当前账号已保存 Key，缺失、归属不符或 401/403 只提示，不打开授权、不清 Key、不重放上传；NodeSeek / linux.do / 妖火 / 小隐寺上传后只插入草稿，不自动发送 | `src/app/topicActionHelpers.test.ts`、`src/replyImageUpload.test.ts`、`src/discourseActions.test.ts`、`src/discourseSourceActions.test.ts`、`src/linuxdoUpload.test.ts`、`src/loginWebViewScripts.test.ts`、`src/nodeimageAuthFlow.test.ts`、`src/nodeimageAuthWebViewScripts.test.ts`、`tests/ui/global-modal-host.test.tsx`、`tests/ui/topic-actions-controller.test.tsx`、`src/screens/topic/replyComposerFormatting.test.ts` |
| 回复删除 | NodeSeek、linux.do、妖火、小隐寺只在原站明确允许时显示删除；Discourse 权限缺失必须 fail-closed，不得靠作者名判断；删除前必须确认；小隐寺删除经服务器确认后先本地移除并定向静默刷新回复，不整篇重载，Live 验收再通过刷新或重进核对服务器状态；默认不真实发回复或删除回复，真实删除只在用户明确同意后使用本次新发的临时回复 | `src/discourseModel.test.ts`、`src/discourseActions.test.ts`、`src/nodeseekActions.test.ts`、`src/yaohuoActions.test.ts`、`src/xiaoyinsiActions.test.ts`、`src/localSources.test.ts`、`src/localYaohuo.test.ts`、`src/localXiaoyinsi.test.ts` |
| 互动 / 写操作 | 未登录、identity pending、surface 开放或 ticket 过期时不发送；所有回复、编辑、删除、互动、投票、上传和签到统一经 `ensureWritableSession`，门禁在 Query snapshot、optimistic update、文件选择和 transport 之前，等待 Query cancellation、文件选择和写后刷新后再次校验，失败必须零 optimistic、零 upload、零 transport。原三站请求 Cookie 由原生只读 CookieJar 按准确 action URL 选择；JS 只构造 CSRF/sid 等协议字段，小隐寺只带独立 User API headers。只有站点 client/runtime 给出的 `login-required`、`login-expired`、`verification-required` 才请求一次 Account Query 对账；`ordinary` 与 `permission-denied` 只回滚本次 optimistic state、提示一次，零 barrier/epoch 变化。未确认失败即使令 ticket pending，也恢复仍存在的旧 scope snapshot；已经清除的旧 epoch Query 不得重建。任何失败都不自动重放非幂等操作，也不得删除原站 Cookie。服务器已确认后 ticket 失效时不再弹成功提示、应用迟到结果或写新 epoch cache，不回滚服务器已确认操作，诊断保留 `stale + serverConfirmed`。linux.do 与小隐寺的 Discourse 点赞/书签共享 MutationCache 与精确 Query cache：先局部显示，失败恢复原状态，确认后同步活动 route snapshot；投票经服务器确认后局部更新且不整篇重载。NodeSeek 投票提交前确认，确认后严格 `POST × 1 → GET × 1`，GET 失败不重投、不伪造票数 | `src/writableSessionGate.test.ts`、`src/discourseActions.test.ts`、`src/discourseSourceActions.test.ts`、`src/discoursePermissions.test.ts`、`src/localSources.test.ts`、`src/xiaoyinsiActions.test.ts`、`src/xiaoyinsiActionClient.test.ts`、`src/nodeseekActions.test.ts`、`src/nodeseekActionClient.test.ts`、`tests/ui/topic-actions-controller.test.tsx`、`src/linuxdoActionClient.test.ts`、`src/yaohuoActions.test.ts`、`src/yaohuoActionClient.test.ts`、`src/topicActionState.test.ts` |
| 用户页 | 五站用户资料、头像、发帖数 / 回帖数、主题列表、回复列表、分页游标正确，已缓存下一 cursor 仍须展示；Profile Query 刚显示 next cursor 时立即分页也必须先 seed 对应 Infinite Query lane，并只请求该 cursor 一次；同一结构化 key 的观察者共享一个 transport 和 Query result；带 `parse_empty` 诊断的资料或列表页不得覆盖旧状态或推进 cursor；真实会话变化只清除对应来源旧资料、释放 Loading 并保留 source/id/username/URL 定位字段，route 不得回退显示旧头像、显示名、简介、等级、统计或活动列表；主题和回复的来源、分类、标题、作者、时间、楼层、摘要按原站支持范围显示；用户名和用户 ID 不混用 | `src/app/useUserController.test.ts`、`src/app/serverState.test.ts`、`src/forumApi.test.ts`、`src/localYaohuo.test.ts`、`src/localXiaoyinsi.test.ts`、`src/yaohuoApi.test.ts`、`src/screens/user/userScreenItems.test.ts`、`src/components/TopicCard.test.ts`、`src/userNavigation.test.ts`、`tests/ui/user-controller-session.test.tsx` |
| 收藏 / 历史 / 关注 | 本机数据保存失败能暴露；列表筛选、分组、去重、备份恢复后数据一致；备份不含敏感字段 | `src/readerData.test.ts`、`src/readerDataStore.test.ts`、`src/readerBackup.test.ts`、`src/backupImportFile.test.ts`、`src/backupOperation.test.ts`、`src/appSecurity.test.ts`、`src/app/useReaderDataController.test.ts` |
| 登录 / 验证 / Cookie / Device Code / 凭据 | Account canonical Query 是远端身份唯一来源；workflow state 只承载登录 surface、验证/授权与本地 transaction。打开 NodeSeek/linux.do/妖火/NodeImage surface 只建立 identity barrier，绝不清、写或覆盖 Cookie；关闭按钮、系统返回、离开 More、切站及 NodeImage 结束都立即收起 UI 并异步对账，hidden/no-op、linux.do inactive 与权威结果自动关闭必须走负向矩阵，见 `REG-ACCOUNT-031`。三站 Cookie 只由 Android `CookieManager` 按准确 URL 读取；空 Cookie 与 error 分离，读取不调用 `flush()`，响应 `Set-Cookie` 不回写，App 不持久化或回退传输 header。只有用户显式“清除登录”可调用窄化 clear port 并回读确认，NodeSeek/linux.do 保留 CF。四站 verifier 严格三态：current user/self-account 为登录、契约明确匿名/准确游客结构为退出，其余均 unknown；“内容可读”不是身份终态。NodeSeek 直连具证据时保持单请求，模糊 SSR 才进入 Account-only WebView 并等待 current user 或完整登录/注册游客控件；妖火公开 session 页 unknown 时补读精确登录 URL，只有完整 POST 登录 form 才是退出，缺字段仍 unknown；linux.do `_forum_session` 不得因缺 `_t` 被挡，NodeSeek 403/404 与妖火普通文字不得误判，见 `REG-ACCOUNT-037`。A→A 只解除 barrier；A→B/A→anonymous/anonymous→B 原子推进目标站 epoch 并清理目标站及 `all` 私有 Query、Level/AI、Topic 服务端数据和媒体身份缓存；unknown 保留可信内容只读。Feed/Search 聚合继续结算其他来源，所有 queryFn 消费 `AbortSignal`。小隐寺 Device Code、Key/Client ID、重授权与撤销保持独立。秘密不进日志/备份，当前身份协议必须有官方或成熟实现证据 | `src/authSurfaceCoordinator.test.ts`、`src/managedCookies.test.ts`、`src/legacyCookieSnapshotMigration.test.ts`、`src/nodeseekSession.test.ts`、`src/linuxdoSession.test.ts`、`src/yaohuoSession.test.ts`、`tests/ui/account-status-controller.test.tsx`、`tests/ui/account-controller.test.tsx`、`src/app/useVerificationController.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`src/app/serverState.test.ts`、`src/mediaSessionEpoch.test.ts`、`src/nodeseekBrowserFetchScript.test.ts`、`src/localSources.test.ts`、`src/yaohuoApi.test.ts`、`tests/ui/hidden-browser-host.test.tsx`、`tests/ui/feed-controller-xiaoyinsi.test.tsx`、`tests/ui/search-controller-ai.test.tsx`、`tests/ui/topic-session-controller.test.tsx`、`tests/ui/user-controller-session.test.tsx`、`tests/ui/account-controller.test.tsx`、`tests/ui/xiaoyinsi-auth-controller.test.tsx`、`src/xiaoyinsiAuth.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/releasePackaging.test.ts`、`src/appSecurity.test.ts` |
| 真实未登录账号对账 | NodeSeek、妖火不得因公开内容可读而长期停在 unknown。NodeSeek 先走 direct 明确证据单请求快路径，只有模糊 SSR 才补一次 Account-only WebView；妖火先读公开 session 页，只有身份 unknown 才补读精确登录页。两站都必须以准确 current-user 或完整游客结构结算，缺字段、网络失败和有界超时保持 unknown；不得清 Cookie、重放写操作或循环重试。NodeSeek 保留访客 clearance 时可结算为 `verified`，但仍必须 `isLoggedIn=false`、网站登录计数不增加并走匿名搜索 | `src/localSources.test.ts`、`src/nodeseekBrowserFetchScript.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`src/yaohuoApi.test.ts`、`tests/ui/hidden-browser-host.test.tsx`、`tests/device-logged-out/logged-out-readonly.ad` |
| 问题诊断 | Release 常驻入口可生成 UTF-8 JSON Lines 并打开系统分享；日志轮转和导出不阻塞业务；临时分享文件随后删除；所有字段经过白名单和脱敏；局部来源、凭据、解析和写后刷新失败提升为 `partial`，页面提示显示问题附截图、内容特例附原帖链接 | `src/diagnostics.test.ts`、`src/diagnosticFileStore.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`tests/ui/account-status-controller.test.tsx`、`tests/ui/topic-actions-controller.test.tsx`、`src/app/useReaderDataController.test.ts`、`src/imageSave.test.ts` |
| 更多页 / 外观 / 更新 | 单一账号中心按 NodeSeek、linux.do、妖火、小隐寺排列且只显示一站详情；顶部区分待处理、四站网站登录和原三站自动填入数量；原三站服务入口均保留，小隐寺显示本人主页、等级及独立授权管理；进入 More 页不自动刷新；App 内不提供伪匿名测试入口；代理密码遮蔽、完整连通性文案、备份、诊断、外观和更新行为保持独立 | `src/app/accountStatusHelpers.test.ts`、`src/screens/more/accountCenter.test.ts`、`tests/ui/account-center.test.tsx`、`tests/ui/more-screen.test.tsx`、`tests/ui/xiaoyinsi-auth-controller.test.tsx`、`tests/ui/network-proxy-modal.test.tsx`、`src/localXiaoyinsi.test.ts`、`src/siteSessionState.test.ts`、`src/xiaoyinsiAuth.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/networkProxy.test.ts`、`src/webViewProxyGuard.test.ts`、`src/appUpdate.test.ts`、`src/releasePackaging.test.ts` |
| 发布 / 安装 | 版本号一致；release 先跑测试、文档和无用代码检查；正式签名有效；按设备 ABI 覆盖安装签名 APK；`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 分别通过；敏感文件不提交 | `src/releasePackaging.test.ts`、`src/androidSmokeGuard.test.ts`、`npm run release:android` |

`REG-ACCOUNT-021` 补充登录验收：linux.do 手动检测必须由当前 WebView session、唯一 probeId 与合法 linux.do documentKey 的回执驱动结算；React Native 事件 URL 与页面内 URL 不得因同站重定向/History 路径差异而互相否决。固定等待不得提前判定；无回执时有界超时为 `unknown`，导航、关闭或新检查必须取消旧 probe。

`REG-ACCOUNT-022` 补充登录验收：Cookie 删除不能只以 `setCookie` callback 为成功依据；NodeSeek 登录 Cookie 必须按 host-only 与明确 `Domain=nodeseek.com; Path=/` 身份过期，`flush` 后从 `www` 与 apex URL 回读，任一目标名称仍可见都必须失败且不得发布已清理。`Domain=nodeseek.com` 与前导点形式等价，不靠重复前导点调用掩盖身份错误。凭据 attempt 只做消息关联；RNTL 必须证明 attempt 变化时同一 WebView mount 保持且新 probe 注入，设备侧只有 renderer 退出的显式恢复允许 remount。动态 CF 与真实登录由用户手动完成，tracked `nodeseek-session.ad` 只证明当前 APK 的 App-owned settled、刷新和返回链，不证明原站可达，也不替代 Cookie 身份和 mount 生命周期测试。

`REG-ACCOUNT-023` 补充登录验收：四站必须区分被动凭据观察与当前身份验证。普通 Feed、Search、Topic、启动恢复或隐藏 WebView 只读取 Cookie/SecureStore 时，`cookie-loaded` 必须省略 `loggedIn`；它可以更新摘要和匿名候选态，但不得把已确认的 `logged-in`、`expired`、`verification-required`、`verifying` 或 `authorizing` 降级，也不得清除 current user 或改写最后确认时间。只有当前账号协议或可信 self-account probe 明确给出结论时才允许携带 `loggedIn: true/false`；明确 `false` 仍必须按站退出。最低测试同时覆盖四站 reducer、NodeSeek/妖火普通读取和 linux.do 隐藏 WebView 刷新，并在设备上从 More 已登录状态切到 Search/Feed/Topic，确认普通读链不会改变同站投影。

`REG-ACCOUNT-024` 补充 NodeSeek 身份验收：当前身份 reader 必须直接读取当前首页/设置页的 `__config__.user` 或专属 self-account 结构，不得请求不存在的 `/api/account/getInfo?readme=1`，也不得用 `/api/account/getInfo/{id}` 公开资料证明登录；页面准确游客控件结构只产生 typed `login-expired` 并更新 App 投影，不进入 Cookie 清理。HTML 404、CF、网络、超时和解析不确定都保留上次可信身份。最低测试既要断言 reader 只发当前页面请求，也要断言任何刷新结果都没有原站 Cookie 删除能力。

`REG-ACCOUNT-025` 补充接口来源与正向登录验收：任何新增 current-identity endpoint、DOM contract 或破坏性失效状态都必须在回归语料记录官方源码/文档、当前站点实际调用或成熟客户端来源；测试 mock 和猜测 URL 不构成来源。最低测试同时覆盖四站“可靠 current user → logged-in”正向路径、各站明确退出路径和非契约状态 → unknown 负向路径。NodeSeek 只认当前配置的 `user` 或明确本人控件，不递归接受无关嵌入 profile。妖火任一已支持会话 Cookie 都只能作为验证候选，必须经过当前账号页返回本人 `touserid` 后才保存；adapter 无 current user 即使报告成功也保持 unknown。公开 profile 只能补全已经证明的身份，真实昵称应替换数字 ID 占位，补全失败不得推翻登录或调用清理。模拟器只读刷新必须核对 More、Search 灯和 Topic 权限来自同一按站投影；动态登录由用户手动完成，不输出 Cookie/Token。

`REG-ACCOUNT-026` 补充 Cookie 所有权验收：账号检测、公共刷新、明确过期、fallback 和普通读写失败都不得删除或覆盖原站 WebView Cookie；原三站只有用户明确点击“清除登录”才拥有定向删除权限。隐藏 NodeSeek/linux.do WebView 只传 URL并复用 Android 共享 CookieManager，不携带 App 快照 Cookie；普通读取前不得调用阻塞式 `flush()`，原生桥只使用公开 CookieManager API。Cookie 名只形成非敏感摘要，不得直接判登录，也不得用 `_t` 等写死名称阻止真实 current-session verifier。最低测试覆盖清理命令只从显式入口可达、隐藏 WebView props、私有数据库源码禁用以及 linux.do 仅 `_forum_session` 时的正向 current-user 响应。

`REG-ACCOUNT-027` 补充共享请求边界验收：所有经过 `fetchWithTimeout` 的 React Native 请求最终必须是 `credentials: 'include'`，即使调用方误传 `omit` 也不能绕过受管只读 CookieJar；method/body、非 Cookie header、AbortSignal 和诊断 fetcher 保持不变。Android 原生测试必须证明 `saveFromResponse`/`put` 为 no-op，响应 `Set-Cookie` 不能写回 WebView。代理组合测试必须阻塞 native apply，证明 apply 前零 transport、完成后同一请求仍经 `networkProxyFetcher` 与原 `ProxySelector` 发出；不得用直接 global fetch 或平行 OkHttp client 绕过 fail-closed。

`REG-ACCOUNT-028` 补充空 Cookie 验收：`readManagedCookieHeader(exactUrl)` 的 `ok(header='')` 是合法无 Cookie 输入，`unsupported/error` 是读取故障，两者不得混淆或回退旧 SecureStore header。空值仍交给三态 verifier，由协议响应决定 anonymous/unknown；读取故障保留上次可信身份并建立 barrier，不得发布 `cleared`。用户明确清除的原生事务只有回读确认后才发布 `cleared`。

`REG-ACCOUNT-029` 补充原生只读 Cookie 验收：NodeSeek、linux.do、妖火的普通 source/action 请求必须在发送时由 `CookieManager.getCookie(准确完整 URL)` 选择 Cookie，未知或未来新增 Cookie 不得被白名单过滤，Domain、Path、Secure 与重定向选择交给平台；非 HTTPS、带 userinfo 或非受管域不得读取。普通请求的合法空值按无 Cookie 发送，读取异常明确失败且不得回退 SecureStore 旧 header。媒体不再使用 JS Cookie bridge：所有 HTTP(S) 媒体只携带内部内容来源 marker，原生在发网前移除 marker 和任何 JS `Cookie` header；只有首跳目标属于内容来源时才可实时读取 Cookie，跨来源、未受管、无效 marker 或媒体 Cookie 读取异常都必须继续匿名加载；重定向一旦离开该来源就永久降权，跳回也不恢复 Cookie。CSRF、sid、touserid 等非 Cookie 协议字段继续显式携带。RN Networking、Fresco、Expo Image 与 Expo Video 必须复用项目配置的 managed client，Expo Video source 只带 marker，不等待或持久化 Cookie。这一媒体契约由 `REG-TOPIC-029` 取代旧的 JS Expo Video Cookie bridge 方案。fresh prebuild 后运行生成的 Kotlin 行为测试与 Release Kotlin compile，源码字符串测试只能固定生成接线，不能替代原生行为。

`REG-ACCOUNT-030` 补充 RN 容器兼容验收：安装到 `OkHttpClientProvider` 的共享 CookieJar 必须实现 `CookieJarContainer`，否则 Fresco 初始化会在 `MainActivity` 启动时 ClassCastException。容器的 `setCookieJar`/`removeCookieJar` 必须保持 App 只读 delegate，不得接受 RN/Fresco 提供的默认 `ForwardingCookieHandler`；生成 Kotlin 测试同时固定类型契约与拒绝替换行为，设备覆盖安装后必须无对应 RedBox。

`REG-ACCOUNT-031` 补充 surface 与 epoch 验收：NodeSeek、linux.do、妖火、NodeImage 的 open/close-button/hardware-back/navigation-away/switch-surface/success/cancel/authoritative-recovery 必须覆盖完整矩阵；open 只建立 barrier，零 clear/flush/身份覆盖，hidden close 与 linux.do inactive 是 no-op。登录/注册 URL 本身不能证明退出，错误页或半加载页必须保持 unknown。关闭后的 A→A/A→B/A→anonymous/unknown 必须通过临时 probe key 原子提交；迟到 generation 不得落地。A→B/anonymous 推进目标站 epoch 并清理 source/`all` 私有 Query、Level/AI、Topic 服务端 data 和 media identity，A→A 不清 cache，unknown 保留旧 data 只读。consumer RNTL 分别固定 Feed/Search 聚合继续其他来源；Feed 的其他来源结果结算后仍展示同 epoch dirty 来源的旧可信条目，但 epoch 变化后立即停止复用；Topic/User/Level/AI 暂停新私有请求；User route 只保留定位字段；媒体 cacheKey/player 随 epoch 重建。

`REG-ACCOUNT-037` 补充真实未登录验收：NodeSeek Account probe 必须先保留 direct 明确身份证据的单请求快路径，只有 direct HTML 为可读业务页但身份 unknown 时才 handoff 到共享 WebView；active request 的 `owner=account` 必须传到 injected script。仅 Account 脚本在 document 建立后提前启动轮询并保留 `onLoadEnd` fallback，同 request 双注入只能回传一次；普通 Feed/Topic/Search 不得提前注入。脚本不能因 `.post-list-item` ready 提前返回，必须等有效 `__config__.user` 对象、self-account、配置对象自有 `user === null` 或同时存在的准确登录与注册游客控件，有界超时仍为 unknown。精确 null 只回传紧凑内部标记，`false`、缺字段、`undefined` 和空对象不得结算。妖火 `wapindex.aspx?sid=-2` 有本人 `div.top2/touserid` 时单请求确认登录；公开页 unknown 时才补读 `waplogin.aspx?siteid=1000`，只有 `form[name=login][method=post]` 内同时存在 `#logname[name=logname]` 与 `#password[name=logpass]` 才确认退出；完整 form 优先于同页 Gocaptcha/ImageCaptcha 资源，只有无完整 form 的独立验证页才是 verification，URL、缺字段 form、HTTP/网络失败均不得猜测。最低测试必须覆盖 direct 快路径、模糊页 fallback、owner 传播、Account early + load-end fallback、双注入幂等、精确 null 与负向 runtime、完整/不完整/带验证码资源 form、共享 reason 消费者和零 Cookie 清理；隔离 AVD Replay 再证明 NodeSeek、妖火权威未登录后才进入搜索矩阵。`REG-TEST-004` 进一步要求 NodeSeek 的 `anonymous` 与访客 `verified` 都作为未登录终态验收，不能把 clearance 文案当成账号身份。

`REG-SOURCE-005` 补充冷启动 fallback 调度验收：Feed/Categories 进入页面立即执行 direct request，Account 刷新作为 background 并发，不增加登录预检。NodeSeek 与 linux.do 各自的隐藏 WebView 队列必须按 `write > foreground > background` 调度、同优先级 FIFO；已开始任务不被抢占，队中任务不因新任务而拒绝或取消。最低测试同时排队 Feed、Categories、Account，要求三者均得到自己的确定结果且后台请求不能取消前台请求。

`REG-SOURCE-006` 补充取消与超时验收：隐藏 WebView 的 15 秒执行 timeout 只能在任务获得执行权后开始，排队等待不消耗预算；外层 direct request timeout 在正式移交 fallback 时停止，避免排队阶段误取消。用户 AbortSignal 只取消自己的排队或执行任务，不能影响同站或跨站其他任务。direct request 只执行一次，符合既有明确条件时只进入一次 fallback，不新增自动重试、冷却或熔断。

`REG-PROXY-006` 补充全局连接资源所有权验收：`dispatcher.cancelAll()` 与 `connectionPool.evictAll()` 只允许出现在代理配置 transition 的 fail-closed 清理中。NodeSeek、linux.do、妖火的普通 403/429、Cloudflare、超时、解析、账号或 fallback 失败都不得触发全局清理。生成 Kotlin 测试必须证明只读 CookieJar 与代理使用同一 selector、dispatcher 和 connection pool；打包守卫固定全局取消调用点唯一，跨站 Controller 测试证明一个站点失败不取消另一个站点在飞请求。

`REG-WRITE-022` 补充写操作失效验收：NodeSeek、妖火及 linux.do 的 typed `login-required`、`login-expired` 或 `verification-required` 只在 ticket 仍有效时请求一次目标站 `reconcileWritableSession`；Account canonical Query 独占 anonymous/changed/same/unknown、barrier 与 epoch 结算。提示恰好一次且零 Cookie 清理、零自动重放；权限不足、普通失败和 stale ticket 不改变身份。默认设备验收不得发送真实写操作，只在自然出现失效/验证时只读核对跨入口投影。

`REG-WRITE-023` 补充执行前、失败回滚与成功结算门禁验收：每类写入至少有一个 controller 用例证明 dirty/unknown/mismatch 在 optimistic、Query snapshot、文件选择、上传与 transport 前终止；另用 deferred `cancelQueries` 固定等待期间换代仍为零本地修改、零 transport。typed identity 对账令 ticket pending 或 unknown 结果在 ticket 过期后到达时，必须恢复仍存在的旧 scope snapshot；旧 epoch Query 已清除时不得由 rollback 重建。NodeSeek、妖火、Discourse、签到在服务器确认后立即换代，或阻塞 `afterSuccess` 再换代时，必须零成功提示、新 epoch canary 不变且唯一终态为 `stale + serverConfirmed`。NodeImage Key 缺失或归属不符必须在文件选择前只提示；上传 401/403 同样只提示，不启动授权、不清 Key、不重开 picker、不重放已经选择的上传；所有非幂等 action 都禁止自动重试。

`REG-WRITE-024` 补充失败证据边界验收：NodeSeek、妖火、linux.do 各以 ordinary 和 typed `permission-denied` 证明零 Account 对账、一次提示、一次 transport 与零重放；linux.do 删除、上传与 NodeSeek 签到的独立生命周期使用同一矩阵。typed expiry/verification 才恰好对账一次；linux.do 必须先消费既有 runtime recovery，普通错误不得绕过它建立 barrier 或自动打开登录面板。

`REG-WRITE-025` 补充妖火结果协议验收：client 测试直接断言 `confirmed/unknown` status；空 200、任意未识别短文本和长普通页面必须 unknown，已有 fixture 的明确成功文本仍 confirmed。Controller 使用不同于生产默认文案的 unknown 结果仍必须回滚 optimistic state、提示 client message、零对账和零成功提示；ticket 已过期时恢复现存旧 scope 但抑制提示，证明展示文案不再承担控制协议。

## 文档、UI、Replay 与发布候选

稳定 Markdown 改动运行：

```powershell
npm run test:docs
npm run check:docs
git diff --check
```

检查器验证已跟踪 Markdown 与稳定文档中的相对链接、反引号仓库路径、`npm run` 脚本、能力 ID、REG ID 和用户身份认证术语；本机专用的 `docs/emulator-baseline.md` 不要求在干净 checkout 中存在，也不按当前目录检查绑定旧 revision 的历史路径。

在已安装当前目标构建、设备身份明确且不需要覆盖安装时运行只读 Replay；必须同时指定用来核对设备 `base.apk` SHA-256 的目标 APK：

```powershell
$env:WZ_ANDROID_TEST_DEVICE = 'WZ Pixel API 35'
$env:WZ_ANDROID_TEST_APK = 'C:\path\to\current.apk'
npm run test:device
```

`test:device` 要求可信安装为 `agent-device >= 0.19.0`，随后核对 App version/versionCode，并从明确设备只读拉取已安装 `base.apk` 计算 SHA-256；任何身份不匹配都直接失败。它只形成 `DEVICE_REPLAY_PASS`；JUnit、截图、视频和日志产物进入 ignored 的 `tmp/agent-device/`。每个 `.ad` 使用唯一 session、独立 relaunch且不自行 `close`，让 test harness 先完成录屏 stop，再执行 session cleanup；单文件内部零重试并在失败处停止。普通执行失败时外层继续其余文件并汇总为非零退出，任何录屏隔离或恢复失败都立即中止。执行前若明确设备存在 active manifest、对应 `.tmp`、工具录屏进程或 orphan scratch，流程按 `BLOCKED_BY_ENV` 停止并保留现场；正式 manifest 即使为空也按文件存在视为占用。执行后只对同时匹配本条唯一 session 与 device 的 manifest 调用 agent-device `record stop`，未知或畸形 manifest、录屏进程和 scratch 一律不终止、不删除。runner 不结束本机 daemon，不使用 wildcard 清设备文件，也不能停止 MCP、清 App 数据、Cookie、用户文件或本机首败证据。普通套件固定六个独立失败域：账号与小隐寺等级、聚合 Feed、聚合 Search、Library、本地 More、NodeSeek WebView；账号等级集中在 `account-readonly.ad`，本地 More 不发等级请求。Feed/Search 只断言当前请求进入合法 outcome，不要求实时首条、固定列表长度或动态详情成功；Topic/User 嵌套和 Library 空/非空由固定 RNTL 严格覆盖，真实对象链由 Agent Live 在满足前置条件时核实。NodeSeek Replay 只使用 App 自有 `nodeseek-login-webview-settled` 及刷新/返回流程，不读取第三方 DOM。小隐寺等级点击恰好一次，等待 `xiaoyinsi-level-settled` 和成功/错误共有的“刷新等级”，不等待成功专属内容、不复试，见 `REG-TEST-005/006/007`。

真实未登录验收使用 `tests/device-logged-out/logged-out-readonly.ad` 和独立 AVD：

```powershell
$env:WZ_ANDROID_LOGGED_OUT_DEVICE = 'WZ Logged Out API 35'
$env:WZ_ANDROID_TEST_APK = 'C:\path\to\current.apk'
npm run test:device:logged-out
```

该设备必须与 `WZ_ANDROID_TEST_DEVICE` / `WZ_ANDROID_SMOKE_DEVICE` 不同，不得从主 AVD 克隆用户数据，也不得登录四个论坛；使用与当前 revision、version/versionCode 和 SHA-256 匹配的同一 APK。脚本先要求四站 Account Query 都结算为权威未登录状态（NodeSeek 显示“未登录”或仅访客“已验证”，妖火、小隐寺显示“未登录”，linux.do 显示“匿名可用”），再各提交一次聚合 Search 和聚合 Feed；每个来源接受公开数据、合法空态、来源错误、Google/CF 阻碍或妖火登录限制等当前请求专属 outcome，但永久 Loading、旧 marker、错误无恢复入口或错误身份仍失败。NodeSeek 的两种允许文案都必须保持 `isLoggedIn=false` 并走 Google fallback；“已登录”、pending、unknown 或 expired 均不能通过。Google gate 的精确 origin、参数和 initial-task 仍由 Vitest 与 RNTL 固定；各站当天能否返回数据由 Agent Live 分别报告。遇到 Cloudflare 时允许在 App 内原站 WebView 完成访客验证而不登录论坛，并自然保留 clearance；不得绕过 Google CAPTCHA、`/sorry` 或 unusual-traffic，也不得自动重试。runner 不卸载、不清数据、不清 Cookie，也不触碰主设备。

发布脚本分别校验正式 APK 与开发签名 smoke APK 后运行：

```powershell
npm run smoke:android
```

通过标准：覆盖安装且不清 App 数据；确认 App 版本、versionCode、APK SHA、设备和登录来源；覆盖安装后先读取设备 epoch、再写唯一 logcat marker 并执行第一次启动，以 `logcat -T` 有界读取该时间之后的日志，按包名与该包 PID 裁剪 marker 后窗口。`APK_SANITY` 只要求 `main-tab-feed` 可见、目标包在前台且该窗口无崩溃、ANR 或 RedBox；marker 丢失同样失败，不得清空设备全局 logcat。随后执行 `tests/device/` 的六条普通 Replay，形成独立的 `DEVICE_REPLAY_PASS`；真实未登录旅程通过独立设备命令另行执行。动态搜索无结果、合法空 Library 或第三方阻碍不构成 APK 产品失败，只有 APK 身份错误、App 自有入口或当前请求无法结算、永久 Loading、错误不可见或无恢复入口才失败。全程只读，不创建或切换收藏，也不执行其他真实写操作；独立能力继续取证。

动态来源、真实账号和已授权写操作按 `tests/live/agent-live.md` 执行。普通改动只跑受影响能力的 `targeted`；集中修复、里程碑或发布前跑 `full`。场景相互独立，CF 由用户手动处理；无人处理记 `BLOCKED_BY_ENV`，不可逆结果不明确时不得重试。动态服务同时报告应用流程和数据读取结果：成功数据，或明确错误可见、可刷新且无自动请求突发，应用流程均可记 `LIVE_PASS`；数据真实出现记 `LIVE_PASS`，明确限流或有诊断证据的外部故障记 `BLOCKED_BY_ENV`，证据不足记 `NOT_VERIFIED`，诊断证明 App 的请求构造、凭据路由、鉴权头或解析契约错误时则记数据读取明确失败，即使错误 UI 流程本身正确。小隐寺等级首次失败时先保留错误和脱敏诊断；只有错误明确给出可执行的限流/冷却时间（时长或截止时刻），才等待至窗口结束再加 2 秒并显式刷新一次。复试成功仍记录首败，再次限流记数据 `BLOCKED_BY_ENV`；其他错误不猜成限流，也不得仅因 App 正确展示错误态就判产品失败。不得重跑整套或增加全局 retry。

## 搜索验收

搜索是最容易出现“看起来能搜，实际坏了”的功能。改搜索、来源解析、筛选、列表分组、请求归属，或改动会影响搜索路径的 Cookie、隐藏 WebView 时，必须执行下面两层。

### 自动测试

```powershell
npm test -- src/forumApi.test.ts src/localSources.test.ts src/localXiaoyinsi.test.ts src/searchFilters.test.ts src/searchListItems.test.ts src/sources/sourceGateway.test.ts src/sources/sourceGatewayContract.test.ts src/yaohuoApi.test.ts src/app/serverState.test.ts src/app/useSearchController.test.ts
npm run test:ui -- tests/ui/search-screen.test.tsx tests/ui/search-controller-ai.test.tsx tests/ui/account-status-controller.test.tsx
npm run typecheck
```

通过标准：

- 固定样本的搜索结果数量、顺序、分页和字段断言通过。
- NodeSeek、linux.do、V2EX、妖火、小隐寺的搜索请求没有回到本地项目服务。
- 单站失败不会让全部搜索整体失败。
- 筛选参数和分页参数进入真实站点请求。
- linux.do 冷启动残留 Cookie 只形成候选态；身份未知时账号与搜索保持非登录、AI 关闭，匿名/已确认登录搜索的 Query key 和 transport 不串用，见 `REG-LINUXDO-005`。

### Agent Live / 受监督模拟器验收

在不清 App 数据的前提下执行。推荐关键词：

若设备自然存在 linux.do 残留 `_t` 且远端身份检查为未知，必须保留该现场冷启动验收：账号中心不显示已登录，搜索不开放 AI 或登录专属路径，Topic 不显示依赖登录的写入口；不得清 Cookie 制造或消除该状态。若身份被远端重新确认，则三个入口应同时恢复登录能力。

| 关键词 | 目的 |
| --- | --- |
| `codex` | 英文技术词，检查五站普通搜索、“全部”来源预览和 NodeSeek 登录 / 未登录搜索路径；模拟器当前登录态下的 NodeSeek 数量只能作为站内搜索基准 |
| `AI` | 高频词，检查分页、去重和 V2EX / linux.do 结果 |
| `安卓手机免` | 中文长词，检查妖火官方搜索不被本地错误过滤 |

每个关键词记录：

| 项 | 记录内容 |
| --- | --- |
| 环境 | 日期、版本号、是否登录 NodeSeek / linux.do / 妖火 / 小隐寺 |
| 条件 | 搜索来源、筛选、关键词 |
| 数量 | NodeSeek、linux.do、V2EX、妖火、小隐寺各自可见数量；有错误时记录错误文案 |
| 首条 | 每站首条标题、来源、作者、时间、链接是否能打开 |
| 结果 | 新代码相对同条件基线是否少结果、空结果、字段缺失或打不开 |

失败标准：

- 原本有结果的站点变成空结果，且不是网站验证、登录失效或网络错误。
- 同条件下结果数量明显下降，且首条结果或分页状态异常。
- 标题、来源、链接、作者、时间任一关键字段缺失。
- 搜索结果能显示但打不开详情。
- NodeSeek 搜索只剩少量静态首屏结果，或验证通过后没有重试。
- NodeSeek 未登录时跳到 Google 搜索页但 App 直接判读取失败。

固定操作：

1. 点底部 `搜索`，确保回到搜索页顶部。
2. 手动输入关键词后点击 App 内提交按钮；清空输入后点击最近搜索词必须立即发起同一关键词请求，不得要求再次提交。
3. 在 `全部` 检查五站固定预览和“查看全部”，再分别检查 `V2EX`、`linux.do`、`NodeSeek`、`妖火`、`小隐寺` 的连续单站列表。
4. 每个来源记录结果数、首条标题、错误文案和是否可继续加载；`全部` 每站最多显示 2 条且不得出现分页入口。
5. tracked Replay 只提交一次聚合搜索，等待由 `aggregateSearchSources` 全部结算后挂在既有列表上的 `search-all-sources-settled`，并在清空关键词后检查来源和筛选 UI；不得为自动化向布局插入空节点，也不打开动态首条。Agent Live 才逐来源记录 `data/empty/partial/error/auth` 并尝试打开有真实结果的来源，再返回搜索页确认关键词、来源和筛选仍保留；没有结果或外部阻碍只影响该来源的数据轴。
6. 打开搜索筛选，确认筛选项存在；非必要不改变筛选。
7. 若点到 `linux.do 老帖` 的外部搜索入口，记录为外部跳转检查，不作为登录 / 验证检查。

NodeSeek 单源搜索有两种通过状态：

- 已登录：站内搜索结果正常显示，结果可打开详情；模拟器基准要标注为“已登录”。
- 未登录 / 仅验证：允许读取 `google.com/search` 中限定 `nodeseek.com` 的结果，结果仍必须显示为 NodeSeek 来源，并可打开详情；不能为了制造该状态清除 App 数据，自动化测试必须覆盖这个路径。

当前可对照的模拟器结果见 `docs/emulator-baseline.md`。

## 小隐寺 Device Code 授权验收

改 `xiaoyinsiAuth`、账号中心授权 UI、SecureStore/Keystore、User API headers 或授权失效判断时必须执行。小隐寺的系统浏览器仅是一次性授权页载体：Google / Discord 身份确认不得放进 WebView，浏览器 Cookie 不得参与 App 会话，Agent 不读取、不输入账号凭据。

### 自动测试

```powershell
npm test -- src/xiaoyinsiAuth.test.ts src/xiaoyinsiActionClient.test.ts src/xiaoyinsiActions.test.ts src/localXiaoyinsi.test.ts src/siteSessionState.test.ts src/screens/more/accountCenter.test.ts src/releasePackaging.test.ts
npm run test:ui -- tests/ui/xiaoyinsi-auth-controller.test.tsx tests/ui/more-screen.test.tsx tests/ui/account-center.test.tsx
npm run typecheck
```

通过标准：能力探测、RSA/OAEP 请求、八位 `XXXX-XXXX` 验证码、服务端 interval、十分钟过期、前后台暂停/恢复、进程恢复、取消、拒绝、重复 payload、错误 nonce/密文、网络错误和 session 复核均有确定性断言；Token、验证码、nonce、授权 URL 查询参数不进入日志/备份；撤销失败不删除本机授权；普通主题 403 不直接标记全局失效。

### 设备验收

1. 覆盖安装当前 debug APK，不卸载、不清 App 数据、Cookie 或现有授权。
2. 更多 → 账号中心 → 小隐寺，确认“未登录/授权中/已登录/已失效”和原三站自动填入边界正确。
3. 用户亲自点击复制并打开系统浏览器，在原站使用 Google 或 Discord 登录、粘贴验证码并确认授权；Agent 只等待 App 返回，不读取或输入凭据。
4. 回到 App 后确认 `/session/current.json` 返回的身份、账号主页和写入口；force-stop 后重启，确认授权仍在且私钥/Token 没有可见输出。
5. 若用户授权撤销，必须先确认原站 revoke 成功，再确认本机状态清除；未授权时不点击。若站点关闭 Device Code，只接受明确“不支持 App 授权”并继续匿名读取，不允许回退 WebView。

## 用户主页验收

改 NodeSeek、linux.do、V2EX、妖火的用户资料、主题、回复、分页、用户页 tab 或用户页列表渲染时，必须执行。

### 自动测试

```powershell
npm test -- src/forumApi.test.ts src/localYaohuo.test.ts src/yaohuoApi.test.ts src/components/TopicCard.test.ts src/screens/user/userScreenItems.test.ts
npm run typecheck
```

通过标准：

- 五站主题和回复的来源、标题、链接、作者、头像、分类、时间、楼层、摘要、分页游标按原站支持范围显示；原站没有的字段不得伪造。
- 妖火主题和回复时间必须保留原站文本，不得把历史日期统一显示成“几分钟前”。
- 用户名和用户 ID 不混用；妖火只拿到数字 ID 时，要用原站可确认的昵称修正展示。
- 用户资料不放进虚拟列表；列表 key 不重复；主题和回复 tab 切换后不串数据。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. 从 App 内登录态入口打开 NodeSeek、linux.do、妖火、小隐寺当前账号主页；V2EX 用 App 内真实主题作者进入用户主页。
2. 五站分别检查 `主题` 和 `回复` tab；记录首屏可见字段，至少包含来源、分类、标题、作者、时间、回复数或楼层、摘要。
3. 有 `加载更多主题` 或 `加载更多回复` 时点一次，确认不会重复首屏、不会串到另一个 tab。
4. 打开一条用户主题或回复对应的原帖，再返回用户主页，确认 tab、列表和用户资料仍正确。
5. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 投票验收

修改投票标记解析、投票卡片数据、公共投票 UI、action builder/client/controller、写后状态或 Topic snapshot 时必须执行。先沿真实依赖关系列出五站消费者；只有语义、数据约束、生命周期和错误处理一致时才允许共享。即使代码只改一个分支，也要证明 NodeSeek、LinuxDo、妖火、小隐寺的提交行为和 V2EX 只读行为没有回归。

### 自动测试

```powershell
npm test -- src/localSources.test.ts src/localXiaoyinsi.test.ts src/nodeseekActions.test.ts src/nodeseekActionClient.test.ts src/xiaoyinsiActions.test.ts src/xiaoyinsiActionClient.test.ts src/topicActionState.test.ts src/nodeseekBrowserFetchScript.test.ts src/yaohuoApi.test.ts
npm run test:ui -- tests/ui/topic-actions-controller.test.tsx tests/ui/topic-components.test.tsx tests/ui/topic-reply-filters.test.tsx
npm run typecheck
```

通过标准：

- NodeSeek `/api/vote/info/{id}` 缺少动态签名的 403 必须能被测试复现；fallback header 只进入投票读取和提交，不能扩散到其他 NodeSeek JSON 或写操作。隐藏 WebView 不等待投票 DOM。
- 未投、已投、多选、锁定和多个标记部分失败分别有 oracle。未投时不提前展示结果票数；成功标记替换为正文内投票占位，渲染表单与相邻 `">` 原始标记并存时也只能保留一张卡，且严格位于标记前后正文之间；整篇 NodeSeek 正文保持一个 HTML 渲染树，不因投票新增正文分隔线，投票后的文本、图片和 sticker 不重叠；失败标记保留且详情诊断为 `partial`。
- NodeSeek 取消确认时保留当前选择且零请求；确认后只有一次 POST，随后只有一次结果 GET。服务端快照替换当前投票数据并经 action update 同步活动 route snapshot，不刷新整篇正文。
- 结果 GET 失败仍显示已投和所选项，未知票数保持未知，诊断为 `partial` 并提示刷新失败；不得重发 POST 或把未知票数写成 `1`。
- LinuxDo 保留 `REG-WRITE-001` 的已知计数/参与人数单次增量，妖火仍可提交投票，V2EX 仍只显示原站可读票数；公共 `TopicPolls` 的样式和交互未因 NodeSeek 专项协议改变。

### 模拟器与 Agent Live 验收

1. 记录当前 revision、dirty 状态、App version/versionCode、安装 APK SHA、设备和 Metro 身份；安装包或 bundle 不匹配时不能沿用旧基线。
2. 用户给出主题 URL 时，解析来源与 id 后直达 App 内详情页。该 URL 是目标，不得先走搜索；只有没有目标，或需要额外寻找一个未投只读样本时，才可搜索准确关键词“投票”。
3. 对已投 NodeSeek 目标只读核对：准确所选项、动态票数、禁用/已投状态、投票卡片位于原始正文标记位置且正文底部没有重复卡片，并确认原始 `nsapp://vote` 标记和相邻泄漏前缀消失；对投票前后含正文/媒体的目标，再与“原站打开”对照，确认没有额外正文分隔线，后文、图片和 sticker 不重叠。动态票数只记录当次结果，不写成固定基线；不得再次投票。
4. 对未投 NodeSeek 目标，先记录准确选项和未投状态，只打开“提交后不可修改”确认框并取消，确认本地选择仍在且没有远端写入。没有合格目标记 `NOT_VERIFIED`，不能拿搜索结果页或普通主题冒充。
5. 只读打开 LinuxDo、妖火各一个真实投票和 V2EX 一个可见票数主题，分别核对卡片/选项/状态；某站没有合格动态目标时只记该站 `NOT_VERIFIED`，不能用另一站通过代替。
6. 真正投票属于不可逆写入：必须先报告主题、准确选项和残留风险，再取得针对该对象和本次提交的逐次授权。确认后只提交一次；结果不明时停止且不得重试。刷新/重进 App 后，再从 App 内原站同类页面核对所选项和结果，桌面浏览器或第三方客户端不能替代。
7. fallback 未来返回 403、原站字段改变或真实结果与测试不一致时，先登记新 bug、影响面和证据缺口并汇报；不得自动引入加密依赖、改走投票 DOM、隐藏失败或猜测式修复。动态投票目标不进入 tracked Replay。

## 回复图片上传验收

改回复、楼层回复、格式工具栏、图片上传、NodeImage 授权或写操作锁时，必须执行。

### 自动测试

```powershell
npm test -- src/app/topicActionHelpers.test.ts src/app/topicActionControllerHelpers.test.ts src/app/useTopicSessionController.test.ts src/replyImageUpload.test.ts src/linuxdoUpload.test.ts src/loginWebViewScripts.test.ts src/nodeimageAuthFlow.test.ts src/nodeimageAuthWebViewScripts.test.ts src/nodeimageCredentials.test.ts src/diagnostics.test.ts src/nodeseekActions.test.ts src/managedCookies.test.ts src/nodeseekSession.test.ts src/nodeseekBrowserFetchScript.test.ts src/screens/topic/replyComposerFormatting.test.ts
npx jest --config jest.config.cjs --runInBand tests/ui/global-modal-host.test.tsx tests/ui/topic-actions-controller.test.tsx
npm run typecheck
```

通过标准：

- 发送失败或上传失败后，同一个回复框还能继续点击和编辑。
- NodeSeek 图片上传使用用户自己的 NodeImage Key；无 Key、Key 归属不符或 401/403 时只提示到账号中心“获取 / 恢复授权”或手动粘贴，授权入口调用为零，文件选择/上传都不重放，草稿保持不变。
- 用户主动“获取 / 恢复授权”时先探测现有 NodeImage session：有效 session 自动保存并关闭且 Connect 为零；只有精确 `401 + JSON error` 才恰好 Connect 一次。HTML 403、网络、5xx、无效 JSON、200 缺 Key、WebView 重载、重复/迟到消息都不得进入额外 Connect 或多次结算。
- NodeSeek 回复 / 编辑必须使用真实 post/comment id；当前请求未传 token 时由 `src/nodeseekActions.ts` 生成 16 位 `csrf-token`，自动测试必须固定该请求契约。
- NodeSeek 自己的回复只有同时有评论 id 和原始正文时才显示编辑；只隐藏自己的点赞 / 鸡腿 / 反对，不展示点了会失败的编辑入口。
- 取消编辑或系统返回关闭编辑框后，编辑正文不能残留成普通回复草稿。
- NodeSeek 详情必须保留原站渲染后的 at、楼层链接、表情 / sticker 和签名显示，不得因为编辑源数据回退成纯文本。
- NodeSeek 楼层回复的草稿请求包含 `@用户` 和楼层链接；测试只构造请求，不发送真实回复。
- linux.do 上传走 `/uploads.json` 且保留 FormData；妖火上传走图床后插入 `[img]...[/img]`。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. `更多 -> 账号中心` 确认 NodeSeek、linux.do、妖火、小隐寺是可写登录态；NodeImage 显示已保存或可“获取 / 恢复授权”。
2. 在保留现有 NodeImage session 的前提下主动点击“获取 / 恢复授权”；弹层应先打开 NodeImage，自动保存并关闭，脱敏诊断只出现 `session-check → session-reused → key-saved`，不得出现 `connect-started`。不得点击网页、清 Cookie 或使用 Connect 配额制造失效。
3. force-stop 后重新打开 App，再进 NodeSeek 回复框点图片，已有且属于当前账号的 Key 应直接打开文件选择器，不弹授权；取消选择后草稿不变。
4. 默认只打开四个可写来源的文件选择器并取消，确认回复框和草稿状态没有损坏；上传请求、响应解析和草稿插入由自动测试覆盖。
5. 只有用户明确同意真实图片上传时，才各选一张小图并确认草稿中分别出现对应 Markdown、`upload://` 或 UBB 图片；等待 UI 稳定后用 accessibility 状态确认“发送回复”和格式按钮不再是 `disabled`，按钮颜色不作为可用性证据，也不点击真实发送。若上传文件无法清理，必须在操作前说明残留风险并单独取得同意。
6. 发送失败状态默认由自动测试覆盖；模拟器只在自然遇到失败或能安全拦截请求、不产生真实写入时复测，不得为了制造失败发送真实回复。失败后回复框必须仍可点击和编辑，不允许靠收起再展开恢复。
7. 结束前清空草稿或收起回复框，检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 回复删除验收

改回复、楼层回复、写操作、权限解析或删除按钮时，必须执行。默认不在真实站点新发回复或删除回复；删除成功后的列表变化由自动测试固定。用户明确同意真实写操作验收时，只删除本次测试新发的临时回复，不删除已有历史内容。

### 自动测试

```powershell
npm test -- src/discourseActions.test.ts src/discourseModel.test.ts src/nodeseekActions.test.ts src/yaohuoActions.test.ts src/localSources.test.ts src/localYaohuo.test.ts src/localXiaoyinsi.test.ts
npm run typecheck
```

通过标准：

- linux.do 只读取 Discourse `can_delete`，删除请求为 `DELETE /posts/{id}.json`。
- 妖火只读取原站回复里的 `Book_re_del.aspx` 删除链接，普通回复没有删除入口。
- NodeSeek 只读取原站数据中的可删字段或删除入口，不靠作者名推断。
- 删除请求缺少评论 id、删除链接或必要参数时必须拒绝。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. 确认 NodeSeek、linux.do、妖火、小隐寺均为各自协议下的可写登录态；小隐寺必须已完成 Device Code 授权，删除入口仍以逐条 `can_delete` 为准。如 NodeSeek 触发 Cloudflare，先在 App 内完成验证，无法自动完成时停止并交给用户。
2. 默认只检查已有页面上的删除入口是否只出现在原站允许的回复上；不得为了验收主动发布临时回复，也不得点击已有历史内容的删除入口。
3. 确认框和取消行为默认由自动测试覆盖；只有用户明确授权并使用本次新建的临时回复时，才在模拟器点击删除入口。
4. 删除请求、删除后列表立即消失、刷新后不残留，默认通过自动测试覆盖。
5. 只有用户明确同意真实写操作验收时，才新发中文且贴合主题的临时回复，再确认删除后刷新检查。
6. 回复框在失败、取消和删除后仍可点击、可编辑，不需要收起再展开。
7. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 模拟器验收清单

| 区域 | 必查 | 不默认点击 |
| --- | --- | --- |
| 首页 | 五个来源、分类、阅读筛选、单站排序及当前请求的合法 outcome；仅在存在数据前置时打开详情并返回 | 无 |
| 详情 | 来源、标题、作者、时间、正文、回复数、附件、图片预览、返回；正文引用与评论引用分别检查简介常显、展开完整帖、收起恢复简介，并确认修改一处后另一处样式和交互不变 | 保存图片、回复、点赞、收藏切换 |
| 搜索 | 关键词、逐来源合法 outcome、筛选、清空和错误/空态；仅在存在数据前置时打开详情并返回 | 外部网页、写操作 |
| 收藏 | ready/empty、来源筛选、分类筛选；有前置数据时检查已收藏 / 已读状态 | 取消收藏 |
| 历史 | ready/empty；有前置数据时检查最近阅读和已读状态 | 删除、清空历史 |
| 关注用户 | ready/empty；有前置数据时检查用户页、用户主题列表和返回 | 取消关注 |
| 账号中心 | 四个可登录来源顺序、单站详情、真实状态、身份、主操作、顶部唯一公共 `刷新账号状态` 和全部原服务入口；原三站显示凭据摘要并从 App 内打开登录 / 验证页，小隐寺只显示 Device Code 授权且打开系统浏览器；测试凭据填入但不提交并在结束前删除 | 清除网站登录、撤销授权、退出登录、手工改 Cookie、提交测试登录、真实签到 |
| 回复编辑 / 图片上传 | 四个可写来源回复框、失败后可继续编辑、格式按钮、文件选择器打开和取消；只用现有 NodeImage session 验证自动保存、关闭和零 Connect；失效兜底流程由自动测试固定，真实 Connect / 上传只按 Agent Live 逐次授权 | 真实 Connect、真实上传、真实发送回复、清除 NodeImage Key/Cookie |
| 回复删除 | 删除入口和权限显示；确认框取消及删除后消失默认由自动测试覆盖 | 点击已有内容的删除入口、真实新发回复、真实删除回复、删除旧回复、删除他人回复、清数据制造状态 |
| 未登录设备 | 只在独立 AVD 上使用同一 APK，四站结算为权威未登录状态（NodeSeek 可为“未登录”或仅访客“已验证”，linux.do 为“匿名可用”）；可完成访客 CF 验证但不登录论坛；主设备数据、Cookie 和登录态不变 | 克隆主 AVD 数据、登录论坛、清主设备数据或 Cookie |
| 更多页 | 版本、检查更新、账号中心、linux.do 等级、小隐寺“查看等级”读取、profile/error 结算标记及成功/错误共有的恢复入口、服务器代理入口、问题诊断入口、备份入口、外观入口；小隐寺动态等级数据按 Agent Live 分轴核实；诊断日志验收时打开分享面板后取消，确认 App 可继续使用 | 小隐寺等级复试、备份导出、导入、安装更新、切换外观、启用未知代理 |

## 改动类型对应验证

| 改动类型 | 必跑 |
| --- | --- |
| 来源解析、搜索、详情、用户页 | 对应来源测试、`src/forumApi.test.ts`、`src/localSources.test.ts`、`npm run typecheck`、模拟器验收 |
| App controller、server state key、取消请求 | 对应 controller 测试、`src/app/serverState.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`npm run typecheck`、模拟器验收 |
| 登录、验证、Cookie、Device Code、写操作 | `src/authSurfaceCoordinator.test.ts`、`src/managedCookies.test.ts`、`src/writableSessionGate.test.ts`、相关 verifier / action / session 测试、`src/releasePackaging.test.ts`、`src/appSecurity.test.ts`、`npm run typecheck`、模拟器验收；小隐寺另跑 Device Code 验收 |
| 投票解析、卡片数据、提交或写后状态 | 完整执行“投票验收”；按五站展开影响面，NodeSeek 真实提交必须逐次授权且结果不明不得重试 |
| 账号中心、凭据保存 / 填入、NodeSeek 当前会话证明与显式清理、小隐寺授权 | `src/forumApi.test.ts`、`src/nodeseekSession.test.ts`、`src/managedCookies.test.ts`、`src/authSurfaceCoordinator.test.ts`、`src/loginWebViewScripts.test.ts`、`src/xiaoyinsiAuth.test.ts`、`tests/ui/xiaoyinsi-auth-controller.test.tsx`、`src/screens/more/accountCenter.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/siteSessionState.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`src/releasePackaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 回复编辑、楼层回复、图片上传、NodeImage Key | 回复图片上传验收、相关 action / WebView script 测试、`npm run typecheck`、模拟器验收 |
| 回复删除、删除权限、评论 id / 删除链接解析 | 回复删除验收、相关 action / 来源解析测试、`npm run typecheck`、模拟器验收 |
| 收藏、历史、备份 / 恢复 | reader data / backup 测试、`src/appSecurity.test.ts`、`npm run typecheck` |
| 服务器代理 | `src/networkProxy.test.ts`、`src/networkProxyControllerGuard.test.ts`、`src/networkProxyModalGuard.test.ts`、`src/webViewProxyGuard.test.ts`、`src/appUpdateProxyGuard.test.ts`、`src/releasePackaging.test.ts`、`tests/ui/network-proxy-modal.test.tsx`、fresh Expo prebuild、生成 Kotlin JUnit、`:app:compileReleaseKotlin`、`npm run typecheck`；模拟器默认只做离线 UI 验收，不启用真实代理 |
| UI 样式、主题 | 只保留事故级 UI helper 测试、`src/theme.test.ts`、`npm run typecheck`、模拟器验收 |
| App 内更新检查、安装入口 | `src/appUpdate.test.ts`、`src/appUpdateProxyGuard.test.ts`、`src/releasePackaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 签名、版本、原生构建配置、发布脚本、正式发布 | `npm run release:android` |

## Review 修复回归基线

| 修复点 | 必跑自动测试 | 必做模拟器验收 |
| --- | --- | --- |
| NodeSeek 未登录 Google 兜底与旧 Cookie header 不落盘 | `src/nodeseekSession.test.ts`、`src/legacyCookieSnapshotMigration.test.ts`、`src/appSecurity.test.ts` | 已登录态下复测 NodeSeek 搜索和详情；不得为制造未登录态清数据或清 Cookie |
| 首页 `全部` + 妖火拆分分页失败不混入半页结果 | `tests/ui/feed-controller-xiaoyinsi.test.tsx` | 首页 `全部` 下滑加载下一页，确认五站来源仍可见，且没有加载失败后混入半页结果或错误状态残留 |
| HTTP 成功但解析为空不落地 | `tests/ui/feed-controller-xiaoyinsi.test.tsx`、`tests/ui/search-controller-ai.test.tsx`、`tests/ui/topic-session-controller.test.tsx`、`tests/ui/user-controller-session.test.tsx` | 五站只读 Feed/Search/Topic/User 正常路径继续可用；自然解析失败时保留旧状态、显示重试且不跳页 |
| linux.do 验证后普通恢复失败不误报成功 | `src/app/useVerificationController.test.ts`、四类带 `QueryClientProvider` 的 read controller RNTL、`tests/ui/topic-actions-controller.test.tsx` | 只在自然 challenge 出现时确认面板保持可重试；不清 Cookie、不人为断网、不执行写操作制造失败 |
| 账号状态、启动恢复、刷新收尾、动作失效投影或凭据摘要的单站失败隔离 | `tests/ui/account-status-controller.test.tsx`、`src/app/sessionControllerHelpers.test.ts`、`tests/ui/account-controller.test.tsx`、`tests/ui/topic-actions-controller.test.tsx`、`src/app/accountCredentialDiagnostics.test.ts`、`src/app/useAccountCredentialController.test.ts`、`src/siteSessionState.test.ts` | 账号中心正常刷新四站；自然单站失败时旧可信身份或摘要保留、明确失效保持 expired，刷新期间的新 credential generation 不被旧检查覆盖，且其他站完成；任何检测/失效分支都不得删除原站 Cookie，不破坏 SecureStore、清登录或执行真实写操作制造状态 |
| 小隐寺重授权终止后的旧会话复核、写操作复核二次失败 | `tests/ui/xiaoyinsi-auth-controller.test.tsx`、`src/xiaoyinsiAuth.test.ts`、`tests/ui/topic-actions-controller.test.tsx` | 正常授权、取消和返回路径保持可用；不主动拒绝授权、断网或执行真实写操作制造组合失败 |
| 代理配置读取失败不直连 | `src/networkProxyControllerGuard.test.ts`、`src/networkProxy.test.ts`、`src/webViewProxyGuard.test.ts`、`src/appUpdateProxyGuard.test.ts` | 正常只读核对服务器代理面板；不损坏 SecureStore，真实启停需用户授权并确认恢复关闭 |
| 原生代理切换、停止与 bridge 销毁泄漏连接 | 生成的 `NetworkProxyRuntimeTest.kt`、`src/releasePackaging.test.ts`、fresh prebuild、`:app:testReleaseUnitTest :app:compileReleaseKotlin` | 默认不启用真实代理；只核对代理保持关闭、配置与账号状态不变 |
| 代理 TCP tunnel 误报连通且密码明文输入 | 生成的 `NetworkProxyRuntimeTest.kt`、`tests/ui/network-proxy-modal.test.tsx`、`src/networkProxyModalGuard.test.ts` | 只离线核对“连通性测试”文案和密码遮蔽；公网 TLS/HTTP 结果未经授权标 `NOT_VERIFIED` |
| 更新检查与下载互斥 | `src/app/useAppUpdateController.test.ts`、`src/appUpdate.test.ts`、`src/appUpdateProxyGuard.test.ts` | 默认只检查更新；未经明确授权不下载 APK、不打开安装器 |
| V2EX 默认 `all` 页分页起点 | `src/localSources.test.ts` | 切到 V2EX 单站，下滑加载更多，确认出现新的 V2EX 主题且无重复首屏 |
| 备份敏感字段过滤 | `src/appSecurity.test.ts`、`src/readerBackup.test.ts` | 只检查备份入口；未经用户同意不得点击导出或导入 |
| 详情页返回、用户页返回、回复弹层返回 | `src/app/backHandlerHelpers.test.ts`、`src/topicSessionState.test.ts`、`src/userNavigation.test.ts` | 打开详情、切换回复筛选、进入作者用户页，再用系统返回，确认回到原详情状态；能安全复现时再测回复弹层关闭 |
| NodeSeek 清除登录后 WebView 刷新 | 账号 controller 相关测试、`src/managedCookies.test.ts`、`src/releasePackaging.test.ts` | 只打开 App 内 NodeSeek 登录 / 验证页并确认包名为 `com.wz.reader`；未经用户同意不得点击 `清除登录` |
| 登录 WebView UA 与后续请求身份不一致 | `src/androidWebViewUserAgentValue.test.ts`、`src/nodeseekSession.test.ts`、`src/sourceErrors.test.ts`、`src/yaohuoApi.test.ts`、`src/yaohuoActionClient.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`tests/ui/account-site-panels.test.tsx` | 保留 App 数据分别打开 NodeSeek、linux.do 与妖火登录 / 验证页；确认 WebView 和后续请求使用 provider 原生 UA，自然 challenge 只由用户点击，成功后再检测站点状态；模拟器被站点拒绝时记 `BLOCKED_BY_ENV`，不绕过验证 |
| linux.do 缺失引用楼层 | `src/forumApi.test.ts` | 有具体 linux.do 主题链接时再用 App 内详情页复测；没有链接时不靠随机帖子判断 |
| 详情回复数跟随筛选结果 | `src/topicDerivedData.test.ts`、详情 UI 相关测试 | 打开有回复的详情页，切换 `只看楼主` / `只看带图` 等筛选，确认 `回复列表 N 条` 随筛选变化 |
| release 签名摘要固定 | `src/releasePackaging.test.ts` | 修改签名、版本、原生构建配置、release manifest 或发布脚本时必须跑 `npm run release:android`；确认签名摘要和 manifest 生成成功 |

## 模拟器规则

允许：

```powershell
npx expo start --dev-client --clear --port 8081
npx expo run:android --no-bundler --app-id com.wz.reader --no-build-cache
adb shell am force-stop com.wz.reader
adb shell monkey -p com.wz.reader -c android.intent.category.LAUNCHER 1
```

禁止：

```powershell
adb uninstall com.wz.reader
adb shell pm clear com.wz.reader
.\android\gradlew.bat :app:connectedDebugAndroidTest # 保留登录态的模拟器
```

确实需要清数据时，必须先得到用户明确同意。`connectedDebugAndroidTest` 只可在一次性空白 AVD 上运行；主模拟器如需原生 instrumentation，覆盖安装 target/test APK 后直接执行 runner，结束时只卸载 test package。
