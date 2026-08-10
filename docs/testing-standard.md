# 测试标准

## 结论

测试必须证明“功能没有被改坏”，不是证明 App 能打开。影响运行逻辑、类型或构建的改动至少执行相关自动测试和 `npm run typecheck`；纯文档或注释改动只核对内容、引用和一致性。涉及页面流程、登录态、真实来源结果或交互时，还必须做模拟器验收。

开发前先在 `docs/product-map.md` 选择直接受影响的能力 ID；触及共享 seam 时按地图展开关联 ID。交付时逐个 ID 报告自动测试、模拟器路径、真实写操作、已恢复状态和未验证范围。

当前确定性测试使用 `Vitest + jsdom` 覆盖数据规则、来源解析、请求构造和状态计算；少量 `Jest + React Native Testing Library` 测试负责用户可见渲染行为。测试目录归属统一见 `docs/code-standards.md`。agent-device MCP 用于探索真实 App 和执行 `tests/live/agent-live.md` 的受监督验收，tracked `.ad` Replay 用于重复关键旅程。没有覆盖率百分比基线，测试价值以能否拦住明确的用户行为回归判断。

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
- 确实需要真实写操作验收时，必须先得到用户明确同意。发帖、回复、编辑和删除只作用于本次新建、中文且贴合原帖主题的临时内容，完成后清理并刷新确认；NodeSeek 获授权的上述测试优先使用 App 内原站当前标为“沙盒”的官方测试分区，执行前确认分区名称和用途，不硬编码可能变化的 category id；点赞和收藏切换完成后恢复原状态；投票等不可逆操作，以及无法清理的上传，必须针对具体对象或残留风险单独取得同意。沙盒只限定测试对象，不替代每次任务的写入授权。

## 证据分层与工具职责

| 结果 | 必须来自 | 不能证明 |
| --- | --- | --- |
| `STATIC_PASS` | lint、format、architecture、文档、TypeScript、unused、React Doctor 全仓 blocking error | 功能在设备上可用 |
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
- React Doctor 单独扫描全仓并阻断 blocking error；它依赖外部 CLI，不并入确定性的 `npm run verify`，也不替代任何行为测试。
- `npm run check:architecture` 检查真实源码的组合链、依赖方向、route ownership、Screen props 投影、Account raw session/host 能力逃逸、行为测试读取生产源码字符串、旧路径、barrel 和循环；`npm run test:architecture` 用合法/非法 fixture 证明规则本身会接受与拒绝预期输入。两者只提供 `STATIC_PASS`，route 草稿、滚动、inactive gate 和返回优先级仍必须由 RNTL/Replay 证明。
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
| V2EX | 有 / 无回复目标、有 / 无感谢；回复目标必须是紧凑关系标签，不得为了 48dp 触控区用 `minHeight` 撑成大按钮；本站没有评论操作栏，检查末块到分隔线及下一条评论的留白 |
| 妖火 | 普通正文、表情 / 图片；检查回复操作栏，出现删除入口时不得改变操作栏纵向几何 |

每个分支都要比较正文、表情、留言、统计或感谢中的最后一个实际可见元素到操作栏或分隔线的距离，以及操作栏到分隔线的距离；同时用真实截图做视觉复核。只量父容器、只看一张截图或只验证某站普通文本，均不能代表该改动已完整回归。

## 诊断日志完成标准

新增或修改用户可感知的功能时，诊断链是完成标准的一部分。每次公共操作至少写入 `intent`、一个能区分失败阶段的关键事件，以及唯一 `finish`；controller、gateway、传输和状态应用必须复用同一个 `traceId`。日志写入、轮转或导出失败不得改变产品行为。

| 链路 | 必须可判断 | 禁止记录 | 自动验证重点 |
| --- | --- | --- | --- |
| 首页 / 分类 / 搜索 / 详情 / 回复 / 用户页 | 用户触发或分页门禁、credential 是否存在、direct / WebView 通道、HTTP 元数据、解析数量、partial、合并前后数量、stale / cancel / apply | 搜索词、标题、作者、正文、真实 topic / user / cursor、URL path / query | 同一 `traceId` 的 start / 阶段 / 唯一终态；HTTP 200 解析为空、partial source failure、重复 cursor、旧请求丢弃 |
| 回复 / 编辑 / 删除 / 互动 / 投票 / 上传 | 权限门禁、credential / CSRF 来源枚举、请求阶段、乐观更新、rollback、本地 commit、成功后刷新是否失败 | Cookie、token、CSRF / API Key 值、正文、真实目标 ID、投票选项内容、上传文件名 / 路径 / URL | 重复写、缺 credential、乐观回滚、写成功但刷新失败、授权刷新；正文只断言长度，投票只断言选择数量 |
| Session / Cookie / WebView / 代理 | generation、store 空 / timeout / error、会话状态迁移、WebView 队列与 renderer gone、代理 load / apply / save 状态 | Cookie 名称和值、header、WebView HTML / message、代理地址 / 账号 / 密码 | stale generation、fallback / timeout、代理 apply 失败、日志中无伪造 secret |
| 本机资料 / 备份 / 更新 / 图片 / 导航 | save queue、superseded、persist、rollback、备份取消 / 解析 / 合并、更新检查 / 下载 / 校验、图片权限 / 下载 / MediaLibrary、route identity / native stack / back 优先级 | 任意对象序列化、备份内容、文件名 / 路径、图片 URL、页面内容 | 保存失败回滚、损坏 / 超限备份、分享取消、更新失败、权限失败、复杂返回链 |
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
| 入口 / 导航 | 冷启动进入首页；4 个底部入口可切换；从首页、搜索、收藏打开主题和用户页后可返回；详情页内再打开主题不会丢上一级状态。每个 native Topic route 的 session/list ref 独立，inactive route 非交互、不发 Query 且不复用旧 epoch 数据；图片预览、composer 和 native pop 的返回优先级固定 | `src/features/topic/useTopicSessionController.test.ts`、`src/domain/forum/userNavigation.test.ts`、`tests/ui/app/app-navigator.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx` |
| 首页 / 分类 / 分页 | 五站来源按当前支持范围返回；分类不串站；分页不重复、不漏掉下一页，已缓存页仍须追加到当前列表；同一结构化 key 的观察者共享一个 transport 和 Query result；聚合首页保留来源平衡，单站请求或凭据存储失败只形成该来源错误；单站刷新错误或带 `parse_empty` 诊断的首屏/分页不得应用，失败页保留旧列表和 cursor，聚合分页不混入半页；真实会话变化清该站和 `all` 聚合 Query、释放 Loading 并由当前 observer 读取新 credential key，其他站不变；linux.do、NodeSeek、V2EX、小隐寺单站排序参数和缓存 key 不串用；小隐寺 latest/hot/new-all/new-topics/new-replies 分别命中真实路径与 subset，非空列表切换也必须重新请求 | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx`、`tests/integration/query-session-contracts.test.ts`、`src/domain/forum/feed.test.ts`、`src/domain/forum/feedOptions.test.ts`、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/sources/readGatewayContract.test.ts`、`tests/integration/source-read-contracts.test.ts`、`src/sources/xiaoyinsi/reader.test.ts` |
| 搜索 | 空关键词或请求进行中不重复提交；未提交时 disabled Query 的 `isPending` 不得泄漏为页面 busy，首次有效输入必须可提交且只发一个 transport，见 `REG-SEARCH-006`；同一结构化 key 的观察者共享一个 transport 和 Query result；“全部”按 V2EX、linux.do、NodeSeek、妖火、小隐寺固定顺序显示每站最多 2 条预览且不分页；单站直接显示连续完整列表并可分页，已缓存下一页仍须展示；结果字段完整；错误按站点隔离；带 `parse_empty` 诊断的页面不得覆盖结果或推进 cursor，只重试原失败页；真实会话变化只移除对应来源普通/AI Query 并释放 Loading；筛选参数真实传给站点；小隐寺标准 Discourse 筛选必须使用本站分类/标签/作者候选和独立 User API 凭据，包含原站解决/未解决状态，不出现 linux.do 专属专家回应或 AI；登录态限制必须显示站点提示。未登录协议必须逐站验收：V2EX 使用 SoV2EX；NodeSeek、linux.do 使用各自 scoped Google fallback；小隐寺使用公开 `/search.json`；妖火要求会话。Google JS capability gate 只允许绑定原始同站 scoped search 的精确中间导航，普通搜索导航和最终结果必须绑定 initial 的同一 `q/start`，不能跨论坛/Google 任务类型或作为最终结果，见 `REG-SEARCH-014`；exact `SG_REL` 搜索访问故障必须拒绝结算、显示 Google 环境验证受限、只允许用户显式重试，其他 extra query 仍按外部/任务不匹配拒绝，见 `REG-SEARCH-015`；登录/未登录 Query key 分离，小隐寺公开搜索不被授权状态阻断 | `tests/integration/security-boundaries.test.ts`、`src/features/search/searchRun.test.ts`、`tests/integration/query-session-contracts.test.ts`、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`tests/integration/source-read-contracts.test.ts`、`src/sources/xiaoyinsi/reader.test.ts`、`src/domain/forum/searchFilters.test.ts`、`src/features/search/listItems.test.ts`、`src/sources/readGateway.test.ts`、`src/sources/readGatewayContract.test.ts`、`tests/ui/search/search-screen.test.tsx`、`tests/ui/search/search-controller-ai.test.tsx`、`tests/ui/account/hidden-browser-host.test.tsx`、`tests/ui/account/session-controller-browser-flow.test.tsx`、`src/sources/yaohuo/reader.test.ts` |
| 详情 / 回复 | 标题、正文、作者、时间、分类、回复数和权限提示正确；同一结构化 key 的观察者共享一个 transport 和 Query result；带 `parse_empty` 诊断的详情、回复页或引用帖不得应用；回复分页不丢楼层或推进失败 cursor，已缓存下一页仍须展示；下一页遇到 linux.do 验证时恢复必须重试相同 page/offset 并与旧页只合并一次，不得用 refetch 重取首屏；V2EX 评论刷新只 refetch 独立 Reply Query，完整刷新先 refetch Topic 再按 `REG-TOPIC-076` 重建回复；真实会话变化清除对应来源旧详情 Query，route-local state 不复制详情；释放 Loading 并保留可重试目标；正文引用和评论引用分别默认显示简介，展开后显示目标完整帖子，且两条渲染路径互不串样式、状态或缓存；同一 reference key 的多个引用实例共享 Query transport、Loading 和结果；离开 Topic 精确取消，linux.do 只恢复完全匹配的 Query key；块级正文图片冷加载只有一个全宽 4:3 占位和一个连续 Spinner，适屏 native 请求在 `onLoad` 取得真实尺寸并完成布局、`onDisplay` 后才撤下遮罩，不能先露小图再跳大；正文首个请求下载适屏候选，适屏图显示后仅由评论 FlashList `720px` render window 或主楼同距离分块低优先级启动原图覆盖层，点击升高优先级；原图复用适屏 placeholder、`150ms` 过渡和既有 frame，失败保留适屏图，全屏匹配完整媒体 identity 的 `onDisplay` 让外层同步复用 Glide 缓存或 SVG poster；预览/保存仍使用原图，热重进保持同会话真实比例，请求切换不泄漏旧图，inline 媒体不进入块图 loader；私有图片同进程同 epoch 可复用，但换 epoch 或重启后不得命中旧身份 namespace；图片预览只挂载当前与相邻页、无缩略图网络扇出；raster 与 SVG poster 都使用 disk-only cache 并按 View 尺寸下采样解码，升为当前页只改变优先级；横滑/缩放/下拉关闭可用且快速重复保存只写入一次；返回后上一层详情状态保留 | `src/features/topic/model/replyPagination.test.ts`、`src/features/topic/useTopicSessionController.test.ts`、`tests/integration/query-session-contracts.test.ts`、`src/domain/forum/quotedPosts.test.ts`、`src/features/topic/model/topicDerivedData.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`src/domain/forum/topicContentHtml.test.ts`、`src/domain/forum/topicListItemState.test.ts`、`src/platform/media/mediaSessionEpoch.test.ts`、`src/platform/media/originalImageLoading.test.ts`、`tests/integration/source-read-contracts.test.ts`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/image-preview-controller.test.tsx`、`tests/ui/topic/image-preview.test.tsx` |
| 回复编辑 / 图片上传 | 四个可写来源回复失败后输入框仍可点击；格式按钮按站点插入 Markdown / UBB；NodeImage 显式授权先复用现有 session，只有精确匿名契约才 Connect；NodeSeek 上传只读取当前账号已保存 Key，缺失、归属不符或 401/403 只提示，不打开授权、不清 Key、不重放上传；NodeSeek / linux.do / 妖火 / 小隐寺上传后只插入草稿，不自动发送 | `src/features/topic/shareTopic.test.ts`、`tests/integration/image-upload.test.ts`、`src/sources/discourse/actionRequest.test.ts`、`src/sources/discourseActions.test.ts`、`src/sources/discourse/imageUpload.test.ts`、`src/platform/network/loginWebViewScripts.test.ts`、`src/sources/nodeimage/authFlow.test.ts`、`src/platform/network/loginWebViewScripts.nodeimage.test.ts`、`tests/ui/account/account-host.test.tsx`、`tests/ui/topic/topic-actions-controller.test.tsx`、`src/ui/composer/replyFormatting.test.ts` |
| 回复删除 | NodeSeek、linux.do、妖火、小隐寺只在原站明确允许时显示删除；Discourse 权限缺失必须 fail-closed，不得靠作者名判断；删除前必须确认；小隐寺删除经服务器确认后先本地移除并定向静默刷新回复，不整篇重载，Live 验收再通过刷新或重进核对服务器状态；默认不真实发回复或删除回复，真实删除只在用户明确同意后使用本次新发的临时回复 | `src/sources/discourse/model.test.ts`、`src/sources/discourse/actionRequest.test.ts`、`src/sources/nodeseek/actionRequest.test.ts`、`src/sources/yaohuo/actionRequest.test.ts`、`src/sources/xiaoyinsi/actionRequest.test.ts`、`tests/integration/source-read-contracts.test.ts`、`src/sources/yaohuo/parser.test.ts`、`src/sources/xiaoyinsi/reader.test.ts` |
| 互动 / 写操作 | 未登录、identity pending、surface 开放或 ticket 过期时不发送；所有回复、编辑、删除、互动、投票、上传和签到统一经 `ensureWritableSession`，门禁在 Query snapshot、optimistic update、文件选择和 transport 之前，等待 Query cancellation、文件选择和写后刷新后再次校验，失败必须零 optimistic、零 upload、零 transport。原三站请求 Cookie 由原生只读 CookieJar 按准确 action URL 选择；JS 只构造 CSRF/sid 等协议字段，小隐寺只带独立 User API headers。只有站点 client/runtime 给出的 `login-required`、`login-expired`、`verification-required` 才请求一次 Account Query 对账；`ordinary` 与 `permission-denied` 只回滚本次 optimistic state、提示一次，零 barrier/epoch 变化。未确认失败即使令 ticket pending，也恢复仍存在的旧 scope snapshot；已经清除的旧 epoch Query 不得重建。任何失败都不自动重放非幂等操作，也不得删除原站 Cookie。服务器已确认后 ticket 失效时不再弹成功提示、应用迟到结果或写新 epoch cache，不回滚服务器已确认操作，诊断保留 `stale + serverConfirmed`。linux.do 与小隐寺的 Discourse 点赞/书签共享 MutationCache 与精确 Query cache：先局部显示，失败恢复原状态，确认后同步当前 route 的精确 Query cache；投票经服务器确认后局部更新且不整篇重载。NodeSeek 投票提交前确认，确认后严格 `POST × 1 → GET × 1`，GET 失败不重投、不伪造票数 | `src/domain/session/writableSessionGate.test.ts`、`src/sources/discourse/actionRequest.test.ts`、`src/sources/discourseActions.test.ts`、`src/sources/discourse/permissions.test.ts`、`tests/integration/source-read-contracts.test.ts`、`src/sources/xiaoyinsi/actionRequest.test.ts`、`src/sources/xiaoyinsi/actionClient.test.ts`、`src/sources/nodeseek/actionRequest.test.ts`、`src/sources/nodeseek/actionClient.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx`、`src/sources/linuxdo/actionClient.test.ts`、`src/sources/yaohuo/actionRequest.test.ts`、`src/sources/yaohuo/actionClient.test.ts`、`src/domain/forum/topicActionState.test.ts` |
| 用户页 | 五站用户资料、头像、发帖数 / 回帖数、主题列表、回复列表、分页游标正确，已缓存下一 cursor 仍须展示；Profile Query 刚显示 next cursor 时立即分页也必须先 seed 对应 Infinite Query lane，并只请求该 cursor 一次；同一结构化 key 的观察者共享一个 transport 和 Query result；带 `parse_empty` 诊断的资料或列表页不得覆盖旧状态或推进 cursor；真实会话变化只清除对应来源旧资料、释放 Loading 并保留 source/id/username/URL 定位字段，route 不得回退显示旧头像、显示名、简介、等级、统计或活动列表；主题和回复的来源、分类、标题、作者、时间、楼层、摘要按原站支持范围显示；用户名和用户 ID 不混用；每个 native User route 自持 controller、筛选、列表 ref 和滚动状态，inactive 时零 Query、刷新、分页或验证恢复，User A → B → A 与 User → Topic → User 返回原实例 | `src/features/user/UserRoute.tsx`、`src/features/user/useUserController.test.ts`、`tests/integration/query-session-contracts.test.ts`、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/sources/yaohuo/parser.test.ts`、`src/sources/xiaoyinsi/reader.test.ts`、`src/sources/yaohuo/reader.test.ts`、`src/features/user/userScreenItems.test.ts`、`tests/ui/shared/topic-card.test.tsx`、`src/domain/forum/userNavigation.test.ts`、`tests/ui/user/user-controller-session.test.tsx`、`tests/ui/app/app-navigator.test.tsx` |
| 收藏 / 历史 / 关注 | 本机数据保存失败能暴露；列表筛选、分组、去重、备份恢复后数据一致；备份不含敏感字段 | `src/domain/reader/readerData.test.ts`、`src/platform/storage/readerDataStore.test.ts`、`src/domain/reader/readerBackup.test.ts`、`src/platform/storage/backupImportFile.test.ts`、`src/platform/storage/backupOperation.test.ts`、`tests/integration/security-boundaries.test.ts`、`src/app/useReaderRuntime.test.ts` |
| 登录 / 验证 / Cookie / Device Code / 凭据 | Account canonical Query 是远端身份唯一来源；workflow state 只承载登录 surface、验证/授权与本地 transaction。打开 NodeSeek/linux.do/妖火/NodeImage surface 只建立 identity barrier，绝不清、写或覆盖 Cookie；关闭按钮、系统返回、离开 More、切站及 NodeImage 结束都立即收起 UI 并异步对账，hidden/no-op、linux.do inactive 与权威结果自动关闭必须走负向矩阵，见 `REG-ACCOUNT-031`。三站 Cookie 只由 Android `CookieManager` 按准确 URL 读取；空 Cookie 与 error 分离，读取不调用 `flush()`，响应 `Set-Cookie` 不回写，App 不持久化或回退传输 header。只有用户显式“清除登录”可调用窄化 clear port 并回读确认，NodeSeek/linux.do 保留 CF。四站 verifier 严格三态：current user/self-account 为登录、契约明确匿名/准确游客结构为退出，其余均 unknown；“内容可读”不是身份终态。NodeSeek 直连具证据时保持单请求，模糊 SSR 才进入 Account-only WebView 并等待 current user 或完整登录/注册游客控件；妖火公开 session 页 unknown 时补读精确登录 URL，只有完整 POST 登录 form 才是退出，缺字段仍 unknown；linux.do `_forum_session` 不得因缺 `_t` 被挡，NodeSeek 403/404 与妖火普通文字不得误判，见 `REG-ACCOUNT-037`。A→A 只解除 barrier；A→B/A→anonymous/anonymous→B 原子推进目标站 epoch 并清理目标站及 `all` 私有 Query、Level/AI、Topic 服务端数据和媒体身份缓存；unknown 保留可信内容只读。Feed/Search 聚合继续结算其他来源，所有 queryFn 消费 `AbortSignal`。小隐寺 Device Code、Key/Client ID、重授权与撤销保持独立。秘密不进日志/备份，当前身份协议必须有官方或成熟实现证据 | `src/domain/session/authSurfaceCoordinator.test.ts`、`src/platform/network/managedCookies.test.ts`、`src/platform/storage/legacyCookieSnapshotMigration.test.ts`、`src/sources/nodeseek/session.test.ts`、`src/sources/linuxdo/session.test.ts`、`src/sources/yaohuo/session.test.ts`、`tests/ui/account/account-status-controller.test.tsx`、`tests/ui/account/account-controller.test.tsx`、`src/features/account/useVerificationController.test.ts`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/integration/query-session-contracts.test.ts`、`src/platform/media/mediaSessionEpoch.test.ts`、`tests/integration/hidden-browser-scripts.test.ts`、`tests/integration/source-read-contracts.test.ts`、`src/sources/yaohuo/reader.test.ts`、`tests/ui/account/hidden-browser-host.test.tsx`、`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx`、`tests/ui/search/search-controller-ai.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/user/user-controller-session.test.tsx`、`tests/ui/account/account-controller.test.tsx`、`tests/ui/account/xiaoyinsi-auth-controller.test.tsx`、`src/sources/xiaoyinsi/auth.test.ts`、`src/platform/storage/credentialVault.test.ts`、`src/domain/session/loginFormAdapters.test.ts`、`tests/tooling/release-packaging.test.ts`、`tests/integration/security-boundaries.test.ts` |
| 真实未登录账号对账 | NodeSeek、妖火不得因公开内容可读而长期停在 unknown。NodeSeek 先走 direct 明确证据单请求快路径，只有模糊 SSR 才补一次 Account-only WebView；妖火先读公开 session 页，只有身份 unknown 才补读精确登录页。两站都必须以准确 current-user 或完整游客结构结算，缺字段、网络失败和有界超时保持 unknown；不得清 Cookie、重放写操作或循环重试。NodeSeek 保留访客 clearance 时可结算为 `verified`，但仍必须 `isLoggedIn=false`、网站登录计数不增加并走匿名搜索 | `tests/integration/source-read-contracts.test.ts`、`tests/integration/hidden-browser-scripts.test.ts`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`src/sources/yaohuo/reader.test.ts`、`tests/ui/account/hidden-browser-host.test.tsx`、`tests/device-logged-out/logged-out-readonly.ad` |
| 问题诊断 | Release 常驻入口可生成 UTF-8 JSON Lines 并打开系统分享；日志轮转和导出不阻塞业务；临时分享文件随后删除；所有字段经过白名单和脱敏；局部来源、凭据、解析和写后刷新失败提升为 `partial`，页面提示显示问题附截图、内容特例附原帖链接 | `src/platform/diagnostics/diagnostics.test.ts`、`src/platform/diagnostics/diagnosticFileStore.test.ts`、`src/sources/readGatewayContract.test.ts`、`tests/ui/account/account-status-controller.test.tsx`、`tests/ui/topic/topic-actions-controller.test.tsx`、`src/app/useReaderRuntime.test.ts`、`src/platform/media/imageSave.test.ts` |
| 更多页 / 外观 / 更新 | 单一账号中心按 NodeSeek、linux.do、妖火、小隐寺排列且只显示一站详情；顶部区分待处理、四站网站登录和原三站自动填入数量；原三站服务入口均保留，小隐寺显示本人主页、等级及独立授权管理；进入 More 页不自动刷新；App 内不提供伪匿名测试入口；代理密码遮蔽、完整连通性文案、备份、诊断、外观和更新行为保持独立 | `tests/ui/account/account-status-controller.test.tsx`、`src/features/more/accountCenter.test.ts`、`tests/ui/account/account-center.test.tsx`、`tests/ui/more/more-screen.test.tsx`、`tests/ui/account/xiaoyinsi-auth-controller.test.tsx`、`tests/ui/more/network-proxy-modal.test.tsx`、`src/sources/xiaoyinsi/reader.test.ts`、`src/domain/session/siteSessionState.test.ts`、`src/sources/xiaoyinsi/auth.test.ts`、`src/platform/storage/credentialVault.test.ts`、`src/domain/session/loginFormAdapters.test.ts`、`src/platform/network/networkProxy.test.ts`、`tests/tooling/webview-proxy-guard.test.ts`、`src/platform/update/appUpdate.test.ts`、`tests/tooling/release-packaging.test.ts` |
| 发布 / 安装 | 版本号一致；release 先跑测试、文档和无用代码检查；正式签名有效；按设备 ABI 覆盖安装签名 APK；`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 分别通过；敏感文件不提交 | `tests/tooling/release-packaging.test.ts`、`tests/tooling/android-smoke-guard.test.ts`、`npm run release:android` |

`REG-TOPIC-062/063/067/068/069/070/071/072/073` 补充详情/回复标准：远端楼层定位采用锚点双向窗口。极大目标只请求目标窗口，随后用户触边才各请求一个相邻 cursor；不得逐页追赶、扩大 page-size 或补齐中间页。显式 `target` 的目标实体以及所有请求的当前页/前后 cursor 无法确认时保留原列表并明确失败；来源 adapter 的边缘 `start` hint 不自动等同于必须存在的目标实体。用户名与楼层是独立点击目标；定位前恢复“全部、空搜索”但保留当前 `ReplyOrder`，成功后滚动并短暂高亮。三种内容筛选固定在左侧 rail，右侧单选菜单显示并切换正序/倒序；顺序使用独立状态和 Query key，可与内容筛选、评论内查找组合，排序入口、菜单与边界文案随阅读字号一致缩放。来源 adapter 返回的顺序就是展示顺序，UI 不得反转部分集合。切换部分集合到倒序时先显示回复级 Loading，再分别验证 NodeSeek `postPageCount` / 严格 pager 尾页、Discourse stream 尾部 IDs 或妖火 `tofloor` resolved page；NodeSeek 详情没有明确总数时保持缺失，不额外抓末页计数、不展示已加载窗口大小，正序/倒序/双侧扩展均忽略旧 `replyCount`。NodeSeek 当前页只在有序窗口路径过滤来源明确楼层范围外且明确标记为 `hot/pinned` 的展示副本，再按 comment ID、回退 floor 去重；范围内唯一热门回复保留。普通页外回复只有在来源楼层已完整覆盖当前固定 10 楼窗口时才证明错页；稀疏页或缺 floor marker 的回退楼层继续展示，已确认错页、缺楼和重复 cursor 仍失败。Discourse 普通 `start/cursor` hydration 允许非空的已请求 ID 子集，并按权威 stream 顺序展示可解析项；必须负向覆盖未请求 ID、重复 ID、整窗 hydration 空缺与错误 cursor，显式 target 仍精确。妖火必须从主题页真实 `reply` / `tofloor` 链接取最大楼层作为边缘路由 hint，禁止把每页“更多回帖(N)”当回复总数，并按原站 page 1 最新、page + 1 更早的方向转换 cursor。妖火同时识别 `page/replyPage` 页码字段；`start` 窗口在页码已确认、回复非空时不得因被删除或并发变化的 hint 楼层缺失而阻断，最新仍必须确认 page 1，最早不得生成更早 cursor，显式 target 仍须命中。V2EX 正常详情从同主题 HTML 页面集合自证：只接受已读取页面中的同主题正整数 `p` 链接并按未访问页升序读取，不猜页码；每页 `ReplyAction/commentCount` 声明一致且原始节点全部可解析，合并后的唯一楼层精确覆盖 `1..replyCount` 才能返回完整集合。声明冲突、节点不足、外站链接耗尽或 malformed 节点时失败且零回复 API；HTML 无声明但原始节点数、有效回复数与主题 API 一致时保留 HTML 降级；只有 HTML 不可用或无声明且无法自证时才延迟读取公共回复 API，并要求有效回复数严格等于主题 API 数量，合法空数组不得被非空启发式否决。未确认边缘窗口、空边缘窗口、`parse_empty`、重复 cursor 或来源明确报告的计数竞态必须报错且不应用结果；计数竞态的显式重试只执行一次“刷新权威计数后从当前顺序 start 重建”，NodeSeek 不进入该恢复，V2EX 不进入跨端点计数恢复。最后一个 `next` cursor 结算后当次显示当前顺序的回复边界，后续触底不得再请求；向前插入必须保持可见位置，最后一个 previous cursor 插入时也不能提前关闭位置保持。最低自动证据覆盖五站 adapter、顺序 Query contract、Controller latest-command-wins、RNTL 切换/筛选/重试/路由恢复、边界终态与边缘映射，以及编辑/删除真实 `pageParam` 和新回复服务端尾窗刷新；NodeSeek 另覆盖热门/置顶混排的 `[1, 44, 43]` 倒序请求、完整窗口外普通楼层负例，以及稀疏/回退楼层兼容路径；Discourse 另覆盖正倒序各漏回一条的可用子集、外来/重复/全缺负例；V2EX 另覆盖 `#1..#100 + p=2 + #101..#107`、正常路径零公共回复 API、页间声明/楼层/外站链接拒绝、API 0/0 与 2/2 降级、空主题、`Pro` 和回复元数据；妖火另覆盖新 `replyPage`、删除首楼、过期尾楼 hint、未确认页、空窗口和精确 target 失败。匹配 revision/APK 的五站设备验收只读执行，不得发送回复或改变登录态。

已有回复时 previous/next 读取失败不能只弹瞬时通知：必须在对应 start/end 边缘保留错误和重试入口，现有回复与失败 cursor 不变，重试只请求该 cursor。同一 Reply Query 同时只允许一个普通分页 transport；replace-window 命令取消旧 Query，并以 route、Query identity、order 和 generation 复核保证 latest-command-wins，不建立 Controller 队列。回复、编辑或删除确认后，精确 Query 的 stale 标记必须使用 `refetchType: none`；权威尾窗/目标窗刷新是唯一跟进 transport。

结构收口不能只靠源码门禁：账号协议分发至少运行 `src/sources/sourceAccountRead.test.ts` 与 `tests/ui/account/account-status-controller.test.tsx`；Topic 权限/回滚至少运行 `src/features/topic/actions/topicActionDecision.test.ts` 与 `tests/ui/topic/topic-actions-controller.test.tsx`；Search picker 生命周期运行 `tests/ui/search/search-screen.test.tsx`；More capability 组合运行 `tests/ui/more/more-screen.test.tsx`；主题样式 owner 运行 `tests/integration/style-ownership.test.ts`。这些测试证明行为，architecture fixture 只证明边界规则会拒绝非法形状。

> `REG-PERF-009` 补充详情图片 cache 矩阵：正文尺寸、原图 revision 与 compatible SVG artifact 的 render/getSnapshot read 不得提升全局 LRU；只有已提交 effect/subscription、显示/recovery 或写入可以改变淘汰顺序。三个编号单测必须同时固定 speculative read 不提升与 committed activity 提升，既有容量、完整媒体 identity、active listener 和 recovery single-flight 不变。

`REG-PERF-010` 补充海量正文验收：最低逻辑证据必须用一个 `<p>` 中 2000 张普通图片固定 `compileForumContent()` 的保序与每 row 硬预算，并固定 poll/quote/video typed 顺序、普通/native-video parse-once、跨 typed row 的 ID/list/details/callout continuation 和 unsafe island fail-closed；模型与 renderer 不得保留旧 splitter、DOM quote extractor 或 video detector。主楼、回复/签名、评论完整引用、主楼内嵌完整引用和采纳答案展开正文都必须是父 FlashList direct rows；在 renderer 内 mock lazy 或只断言 Dispatcher 上限均不足。viewability RNTL 必须固定 warm `<=8`、running `<=4`、正文原图 `<=1`、未获 permit 零 source/Call、全 route 单 deadline Timer、每个失败 identity 只有一次受门禁约束的自动重试、第二次失败后零滚动/recycling/runtime 第三波及一次显式重试；runtime generation 只能由 coordinator 重启当前 running attempt，displayed/waiting/failed 不变，所有图片/贴纸/link-card/iframe/video 的 native 实例都随 attempt 精确切换。正文 SVG consumer 必须随 attempt、row 与 route lease 一起释放；最后一个 consumer 释放后 queued artifact work 不启动、可取消 fetch abort、不可取消 Native 读取返回后不进入 poster，而同 identity 的其他活跃 consumer 仍共享一次 fetch/poster。全局 bounded artifact service 不得错误归属到 coordinator。已显示的同 URL 健康副本保持实例，离窗再进入则重新取得 permit。聚合测试必须固定 planned/media 与 warm/running/timer session 高水位、response-ready 到首个 opening row layout 的 `firstRowElapsedMs`、Topic A→B 隔离和 exactly-one finish。预览用 2000 项 catalog 固定 physical Pager page `<=3`、所有 current/adjacent raster 与 poster 均为 `cachePolicy=disk` 且 `allowDownscaling=true`、stale physical event 不改变 logical item、inactive 异常页激活后恰重试一次、无进展失败卸载 load layer，且首、中、末 index 可达。匹配 x86_64 Release APK 用同一 PID 连续两轮执行“`post-863650-1` → 滚动 → Back → 普通详情”，不得 relaunch、清数据或改网络；记录首 row/Back、running/warm/queued/timer 高水位、gfxinfo/帧、PSS、ANR/OOM/FATAL/PID 和 ResponseBody leak。只有同时满足 `REG-PERF-010` 记录的时间、帧、内存和资源门槛才记 `LIVE_PASS`；公网不可用只记 `NOT_VERIFIED`。

`REG-TOPIC-075` 补充全屏 decoded working-set 验收：三槽限制 Native View 数量，但不能代替 Bitmap 预算。Pager 的三个 outer slots 和槽内三组 raster/underlay Native owner 必须保持稳定 identity；window shift 只能更换 `source/recyclingKey`并重置 logical load owner，旧 source 的迟到回调不得结算新图，离窗 underlay 须以 `source=null` 清 target。current/adjacent raster、display underlay、静态 SVG poster 与动画 continuity poster 必须显式使用 `cachePolicy=disk`、`allowDownscaling=true`，且每个 source 都携带长边 `<=2,048px`、总量 `<=4,194,304 pixels` 的 Native decode target。相同 display/original URL 零 underlay；不同 URL 用普通受预算 underlay，任何远程 URL 都不得进入 Expo placeholder decoder。成为 current 只改变 priority；不允许以全局 memory-cache clear 作为返回清理。RNTL 必须覆盖 2000 项任意中段、连续 window shift 后 raster/underlay owner 总数仍为 3、logical callback 隔离、remote placeholder 负例、decode target 无效输入和两种 poster。Release 设备用正常横滑连续翻页，按同一 PID 采样进入前、25/100 页、关闭和 60 秒后的 PSS/Native Heap；峰值 `<=+150MB`、关闭后 `<=+80MB`，并回归原图 URL、保存目标、缩放手势与 Back。若未来要求任意大图的 1:1 深度缩放，必须以独立有像素上限的 tiled/quality owner 另立回归，不得重开无界完整 Bitmap。

`REG-TOPIC-032/074` 补充正文媒体 transport 与资源所有权验收：Expo Image clone 必须由生成 Kotlin test 固定 `connectTimeout=15 秒`、`readTimeout=30 秒`、`callTimeout=0`，正文 30 秒无进展由 coordinator 的唯一最近 deadline Timer 管理；图片字节、WebView progress 与 Expo Video `bufferedPosition` 只有严格增长才延后对应请求。不得把全屏预览 `REG-TOPIC-052` 的独立三槽/timeout owner 与正文计时合并。close-safe fetcher 的原生红/绿测试必须覆盖 `200 → cancel → cleanup`、cancel/cleanup 后迟到 200、cancel 后 failure、cleanup/cancel 任意顺序、非 2xx、body transform/`byteStream()`/`contentLength()`/wrapper acquisition 异常及 Expo wrapper progress；正常 2xx 在 cleanup 前可读，其余所有权终态 close exactly once且最多一个 failure callback。fresh prebuild 后运行生成 Kotlin JUnit 与 Release Kotlin compile；tooling 源码门禁不能替代原生回调测试，设备侧在长帖 Back 后检查零 `ResponseBody leaked` 且普通图片继续加载。

> `REG-TOPIC-053/054/055` 补充详情/回复矩阵：评论跨主题引用必须保留 `source + topicId + postNumber` 和可用的内部目标链接，不得命中当前主题同楼层；parser、两站 adapter、ReplyItem 与 Query controller 四层共同固定。超长完整引用必须拆成父 FlashList 的稳定 data rows，由同一 render window 挂载；目标首帖已有同 epoch Topic cache 时零重复 transport，返回 route 从同 epoch reply cache 恢复 active observer；实例 key 绑定 reply entity，同楼层不同 commentId 必须隔离。冷引用先只进入 2 个正文 rows，首个实际 row layout 后下一帧才放开其余 rows；primed token 绑定实例和内容，折叠重开直接全量，内容或 route 变化重新测量。完整正文出现后不重复简介，loading/error 仍保留简介；同一 immutable Reply 的正文不得重复拆分，头像位、长作者/标题和连续卡片间距不得在加载或滚动时跳变。匹配模拟器需在精确主题上滚过文字、链接和图片，再收起并二次展开，以 gfxinfo 最慢帧和节点规模对照逃逸基线，工具 settle 时长不能代替帧证据；不得用缩小 `720px` 图片 render window 换取展开数字。`REG-PERF-008` 补充导航/长正文矩阵：A ready → B Loading 时，两个 native Topic route 必须各自绑定稳定的 `source + topicId` identity、当前 Query generation 与独立 list ref；返回只见 A，inactive B 非交互且暂停原图升级，epoch 失效后不复用。opening-body chunk 必须是 FlashList data；普通内容只保留必要的一次结构 parse，非正文状态变化不得重拆，解析前必须让已排队的取消胜出。route-local `beforeRemove` 的调用顺序只能固定控制流，不能代替可见 UI 和匹配 APK 的转场证据。

`REG-SEARCH-018` 补充 NodeSeek 搜索验收：诊断候选必须与 adapter 当前选择的解析面同源；页面已有正式 `.post-list` 时，只统计列表内部候选，不能因页面其他区域的 `post-*` 链接或页面壳中的 stale embedded topics 生成 `parse_empty`。只有搜索表单而结果面尚未出现时仍必须报“结果没有加载完成”并允许重试。最低测试使用同一 fixture 同时固定空结果、诊断摘要及既有未完成页面负向路径；设备保留当前登录态分别查询问题词与普通词，不要求纯数字词直达帖子。

`REG-SEARCH-019` 补充单站空结果验收：累计 `items` 为 0 时，只显示“没有匹配结果”，不得同时生成“继续下滑加载更多”分页哨兵或触发自动续页，即使来源响应残留 `hasMore/nextPage`。最低 UI 测试直接注入该矛盾状态；非空结果仍按既有滚动门禁自动分页。

`REG-TOPIC-043` 补充图片预览验收：复杂静态 SVG 经过兼容恢复后，正文、当前预览与相邻页都只能显示已生成 poster，不得挂载第二个 Chromium renderer；当前页 poster 仍须等 `onDisplay` 才撤下加载遮罩。只有 `animated` artifact 的当前页可以挂载隔离 document view，并以 poster 保持首帧连续。最低 unit/UI 测试必须同时固定真实动画与静态 reset 分类、静态零 WebView、已显示 poster 淘汰后的本地重建与显式重试、动画 document 先 ready 或切页时仍吸收新 poster revision、相邻页零昂贵恢复；设备验收核对停留与缩放期间无新增 Chromium tile memory 告警、缺层或 App 进程退出。

`REG-TOPIC-048` 补充渐进图片验收：冷加载先观察适屏 URL 完成 `onLoad + onDisplay`，再允许当前评论 render window 或 FlashList 已挂载的主楼分块请求原图；远段和 inactive Topic route 不得继续升级。原图层必须是低优先级、适屏 placeholder、`150ms` 过渡且 frame 几何不变，点击后全屏与外层为高优先级；全屏原图 `onDisplay` 后关闭预览，外层必须复用清晰缓存或 SVG poster。后台原图自然失败时只保留适屏图，不出现第二 Spinner/错误态、不循环重试；快速返回、换 session epoch 和 SVG 路径不得接受迟到回调或启动后台 Chromium。最低 unit/UI 证据为 `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/domain/forum/forumContentMedia.test.ts`、`src/platform/media/originalImageLoading.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/image-preview.test.tsx`；设备仅做只读验收，不以断网、清 Cookie 或写入论坛制造失败。

`REG-TOPIC-052` 补充重复预览验收：完整媒体 request identity 已在全屏 `onDisplay` 成功后，本进程内关闭再打开必须直接复用显示 revision 与现有 disk/underlay 像素，不得恢复 Spinner；随后同一请求的 `onLoadStart` 也不能重新显示遮罩。内部 loading、30 秒 timeout 与 diagnostics 继续运行，超时必须失败，显式重试重新显示 Spinner。冷图、新 session identity、SVG poster 的本次 `onDisplay` 门槛和 512 项显示 revision LRU 保持原行为。最低 UI 证据通过公开 `ImagePreviewModal` 驱动真实关闭/重开、timeout/retry、Expo Image 回调及 `REG-TOPIC-043` 静态 poster 交叉场景；设备只读重复打开同一图片，不清缓存或登录态。

`REG-TOPIC-064` 补充论坛图片 Cloudflare challenge 验收：任意合法 HTTP(S) 图片仍按正文来源获得图片 `Accept`、Android WebView `User-Agent`、系统语言 `Accept-Language` 和来源 canonical origin `Referer`，不能依赖目标 Host 白名单；这些画像只解决热链与常规 UA 检查，不得宣称能绕过 challenge。Expo Image 与 SVG 有界复取先走受管 OkHttp，只有 `GET/HEAD` 的响应精确包含 `Cf-Mitigated: challenge` 才懒初始化 bundled Cronet 并流式重试一次；普通图片不得初始化 Cronet，普通 `403/429`、超时、写请求、二次 challenge、初始化或请求失败均保留原失败且不得递归。Cronet 不自行跟随重定向、不缓存 body；代理 relay 与切换阻塞态必须 `DISALLOW_DIRECT`，generation 变化取消旧请求并在释放后关闭旧 engine。匿名媒体无 Referer，跨站媒体继续匿名，同来源 Cookie 仍只由原生只读 CookieJar 读取，JS 头中不得出现 Cookie；视频覆盖为 video Accept 且不进入 Cronet，图片保存也不在本条范围。最低证据为图片画像 Vitest、真实 Topic/video RNTL、fresh prebuild 后生成的 `NetworkProxyRuntimeTest.regTopic064OnlyCloudflareImageChallengesUseOneFallbackResponse` 与 `regTopic064FallbackFailureOrSecondChallengeKeepsTheOriginalResponse`、SVG policy、依赖/排除项及四条精确 R8 规则的 tooling 门禁、Release Kotlin compile 和 `assembleRelease`。设备用匹配 APK 对照 NodeSeek `post-857589-1` 的原站 WebView与原生详情，并回归普通第三方图、同来源私有附件及 `post-841430-1` 的复杂动态 SVG；不清 Cookie、不保存图片、不启用真实代理。

`REG-TOPIC-065/066` 补充 NodeSeek 贴纸验收：精确 `/static/image/sticker/*.(webm|mp4|mov)` 的透明动态贴纸不得交给不保证 alpha 的 native video surface，必须用受限 Chromium media island 显示，并在 ready 前保留 PNG fallback；普通视频仍走 native，React 重渲染和 App 前后台切换不得重建当前动画。缺少一个或两个显式尺寸轴的 PNG/GIF 贴纸不得按目录名写死尺寸，首帧可用保守占位，Expo Image `onLoad` 后必须按真实比例补齐缺失轴，并在阅读字号缩放后的最终布局上保持最大 100dp；同 media session 的再次进入直接复用真实尺寸。双轴显式站点尺寸、普通 inline emoji 与 sticker row 规则保持。混合段落在后续视频贴纸拆行后，前面的图片贴纸仍须产出 `forum-sticker`，其 HTML content model 必须为 block，不能回落到 TextView 行盒。最低证据为 `src/domain/forum/forumContentMedia.test.ts`、`src/platform/media/inlineMedia.test.ts`、`src/features/topic/rendering/htmlElementModels.test.ts` 与 `tests/ui/topic/topic-image-loading.test.tsx`，分别固定混合解析、占位/最终尺寸、block 模型、native player 零调用、Chromium source identity 稳定及 `57×48`、`82×82` 两个真实逃逸尺寸。匹配 APK 直达 `post-859086-2#14`，核对三张透明动画、两张静态/GIF 贴纸尺寸及 Home→恢复，不清 App 数据或登录态。

`REG-TOPIC-044` 补充原生 SVG 海报 renderer 生命周期验收：多个已排队 cache-miss 可在同一批次复用一个离屏 WebView，但最后一个请求结算后必须立即 `destroy()` 且 runtime 不再持有它；cache hit 不创建 WebView。fresh prebuild 生成的 instrumentation test 必须同时断言 creation/destruction 计数与 idle retained 状态。设备打开真实动画 SVG 前，CDP 不得残留 `never_attached` 的海报 page target；关闭预览后 attached document target 也必须消失。

`REG-TOPIC-045` 补充动画 SVG 缩放验收：1 倍状态允许当前页唯一的隔离 document view 播放动画；同尺寸 poster 必须先以 `onDisplay` 证明 native 像素已就绪。双指起始回调或双击 scale 离开 1 后，只把缩放树外、固定 1 倍的 document view 透明隐藏；poster 未显示时必须继续显示 document view，不能黑屏。回到 1 倍直接显示同一个 document view，不销毁 Chromium、不复取 SVG。UI 测试固定 WebView 永远不是 ResumableZoom 后代、poster recycling identity 不变、隐藏与恢复不重建 document/poster；设备连续双击、平移并停留后不得新增 Chromium tile memory 告警，App 与设备保持存活。

`REG-ACCOUNT-021` 补充登录验收：linux.do 手动检测必须由当前 WebView session、唯一 probeId 与合法 linux.do documentKey 的回执驱动结算；React Native 事件 URL 与页面内 URL 不得因同站重定向/History 路径差异而互相否决。固定等待不得提前判定；无回执时有界超时为 `unknown`，导航、关闭或新检查必须取消旧 probe。

`REG-ACCOUNT-022` 补充登录验收：Cookie 删除不能只以 `setCookie` callback 为成功依据；NodeSeek 登录 Cookie 必须按 host-only 与明确 `Domain=nodeseek.com; Path=/` 身份过期，`flush` 后从 `www` 与 apex URL 回读，任一目标名称仍可见都必须失败且不得发布已清理。`Domain=nodeseek.com` 与前导点形式等价，不靠重复前导点调用掩盖身份错误。凭据 attempt 只做消息关联；RNTL 必须证明 attempt 变化时同一 WebView mount 保持且新 probe 注入，设备侧只有 renderer 退出的显式恢复允许 remount。动态 CF 与真实登录由用户手动完成，tracked `nodeseek-session.ad` 只证明当前 APK 的 App-owned settled、刷新和返回链，不证明原站可达，也不替代 Cookie 身份和 mount 生命周期测试。

`REG-ACCOUNT-023` 补充登录验收：四站必须区分被动凭据观察与当前身份验证。普通 Feed、Search、Topic、启动恢复或隐藏 WebView 只读取 Cookie/SecureStore 时，`cookie-loaded` 必须省略 `loggedIn`；它可以更新摘要和匿名候选态，但不得把已确认的 `logged-in`、`expired`、`verification-required`、`verifying` 或 `authorizing` 降级，也不得清除 current user 或改写最后确认时间。只有当前账号协议或可信 self-account probe 明确给出结论时才允许携带 `loggedIn: true/false`；明确 `false` 仍必须按站退出。最低测试同时覆盖四站 reducer、NodeSeek/妖火普通读取和 linux.do 隐藏 WebView 刷新，并在设备上从 More 已登录状态切到 Search/Feed/Topic，确认普通读链不会改变同站投影。

`REG-ACCOUNT-024` 补充 NodeSeek 身份验收：当前身份 reader 必须直接读取当前首页/设置页的 `__config__.user` 或专属 self-account 结构，不得请求不存在的 `/api/account/getInfo?readme=1`，也不得用 `/api/account/getInfo/{id}` 公开资料证明登录；页面准确游客控件结构只产生 typed `login-expired` 并更新 App 投影，不进入 Cookie 清理。HTML 404、CF、网络、超时和解析不确定都保留上次可信身份。最低测试既要断言 reader 只发当前页面请求，也要断言任何刷新结果都没有原站 Cookie 删除能力。

`REG-ACCOUNT-025` 补充接口来源与正向登录验收：任何新增 current-identity endpoint、DOM contract 或破坏性失效状态都必须在回归语料记录官方源码/文档、当前站点实际调用或成熟客户端来源；测试 mock 和猜测 URL 不构成来源。最低测试同时覆盖四站“可靠 current user → logged-in”正向路径、各站明确退出路径和非契约状态 → unknown 负向路径。NodeSeek 只认当前配置的 `user` 或明确本人控件，不递归接受无关嵌入 profile。妖火任一已支持会话 Cookie 都只能作为验证候选，必须经过当前账号页返回本人 `touserid` 后才保存；adapter 无 current user 即使报告成功也保持 unknown。公开 profile 只能补全已经证明的身份，真实昵称应替换数字 ID 占位，补全失败不得推翻登录或调用清理。模拟器只读刷新必须核对 More、Search 灯和 Topic 权限来自同一按站投影；动态登录由用户手动完成，不输出 Cookie/Token。

`REG-ACCOUNT-026` 补充 Cookie 所有权验收：账号检测、公共刷新、明确过期、fallback 和普通读写失败都不得删除或覆盖原站 WebView Cookie；原三站只有用户明确点击“清除登录”才拥有定向删除权限。隐藏 NodeSeek/linux.do WebView 只传 URL并复用 Android 共享 CookieManager，不携带 App 快照 Cookie；普通读取前不得调用阻塞式 `flush()`，原生桥只使用公开 CookieManager API。Cookie 名只形成非敏感摘要，不得直接判登录，也不得用 `_t` 等写死名称阻止真实 current-session verifier。最低测试覆盖清理命令只从显式入口可达、隐藏 WebView props、私有数据库源码禁用以及 linux.do 仅 `_forum_session` 时的正向 current-user 响应。

`REG-ACCOUNT-027` 补充共享请求边界验收：所有经过 `fetchWithTimeout` 的 React Native 请求最终必须是 `credentials: 'include'`，即使调用方误传 `omit` 也不能绕过受管只读 CookieJar；method/body、非 Cookie header、AbortSignal 和诊断 fetcher 保持不变。Android 原生测试必须证明 `saveFromResponse`/`put` 为 no-op，响应 `Set-Cookie` 不能写回 WebView。代理组合测试必须阻塞 native apply，证明 apply 前零 transport、完成后同一请求仍经 `networkProxyFetcher` 与原 `ProxySelector` 发出；不得用直接 global fetch 或平行 OkHttp client 绕过 fail-closed。

`REG-ACCOUNT-028` 补充空 Cookie 验收：`readManagedCookieHeader(exactUrl)` 的 `ok(header='')` 是合法无 Cookie 输入，`unsupported/error` 是读取故障，两者不得混淆或回退旧 SecureStore header。空值仍交给三态 verifier，由协议响应决定 anonymous/unknown；读取故障保留上次可信身份并建立 barrier，不得发布 `cleared`。用户明确清除的原生事务只有回读确认后才发布 `cleared`。

`REG-ACCOUNT-029` 补充原生只读 Cookie 验收：NodeSeek、linux.do、妖火的普通 source/action 请求必须在发送时由 `CookieManager.getCookie(准确完整 URL)` 选择 Cookie，未知或未来新增 Cookie 不得被白名单过滤，Domain、Path、Secure 与重定向选择交给平台；非 HTTPS、带 userinfo 或非受管域不得读取。普通请求的合法空值按无 Cookie 发送，读取异常明确失败且不得回退 SecureStore 旧 header。媒体不再使用 JS Cookie bridge：所有 HTTP(S) 受管媒体携带内部内容来源 marker 和 opaque identity，原生在发网前移除两个内部头和任何 JS `Cookie` header。只有首跳目标属于内容来源时才可实时读取 Cookie，跨来源、未受管、无效 marker 或媒体 Cookie 读取异常都必须继续匿名加载；重定向一旦离开该来源就永久降权，跳回也不恢复 Cookie。CSRF、sid、touserid 等非 Cookie 协议字段继续显式携带。RN Networking、Fresco、Expo Image 与 Expo Video 必须复用项目配置的 managed client，Expo Video source 不等待或持久化 Cookie。这一媒体契约由 `REG-TOPIC-029` 取代旧的 JS Expo Video Cookie bridge 方案。fresh prebuild 后运行生成的 Kotlin 行为测试与 Release Kotlin compile，源码字符串测试只能固定生成接线，不能替代原生行为。

`REG-ACCOUNT-030` 补充 RN 容器兼容验收：安装到 `OkHttpClientProvider` 的共享 CookieJar 必须实现 `CookieJarContainer`，否则 Fresco 初始化会在 `MainActivity` 启动时 ClassCastException。容器的 `setCookieJar`/`removeCookieJar` 必须保持 App 只读 delegate，不得接受 RN/Fresco 提供的默认 `ForwardingCookieHandler`；生成 Kotlin 测试同时固定类型契约与拒绝替换行为，设备覆盖安装后必须无对应 RedBox。

`REG-ACCOUNT-031` 补充 surface 与 epoch 验收：NodeSeek、linux.do、妖火、NodeImage 的 open/close-button/hardware-back/navigation-away/switch-surface/success/cancel/authoritative-recovery 必须覆盖完整矩阵；open 只建立 barrier，零 clear/flush/身份覆盖，hidden close 与 linux.do inactive 是 no-op。登录/注册 URL 本身不能证明退出，错误页或半加载页必须保持 unknown。关闭后的 A→A/A→B/A→anonymous/unknown 必须通过临时 probe key 原子提交；迟到 generation 不得落地。A→B/anonymous 推进目标站 epoch 并清理 source/`all` 私有 Query、Level/AI、Topic 服务端 data 和 media identity，A→A 不清 cache，unknown 保留旧 data 只读。consumer RNTL 分别固定 Feed/Search 聚合继续其他来源；Feed 的其他来源结果结算后仍展示同 epoch dirty 来源的旧可信条目，但 epoch 变化后立即停止复用；Topic/User/Level/AI 暂停新私有请求；User route 只保留定位字段；媒体 cacheKey/player 随 epoch 重建。

`REG-ACCOUNT-037` 补充真实未登录验收：NodeSeek Account probe 必须先保留 direct 明确身份证据的单请求快路径，只有 direct HTML 为可读业务页但身份 unknown 时才 handoff 到共享 WebView；active request 的 `owner=account` 必须传到 injected script。仅 Account 脚本在 document 建立后提前启动轮询并保留 `onLoadEnd` fallback，同 request 双注入只能回传一次；普通 Feed/Topic/Search 不得提前注入。脚本不能因 `.post-list-item` ready 提前返回，必须等有效 `__config__.user` 对象、self-account、配置对象自有 `user === null` 或同时存在的准确登录与注册游客控件，有界超时仍为 unknown。精确 null 只回传紧凑内部标记，`false`、缺字段、`undefined` 和空对象不得结算。妖火 `wapindex.aspx?sid=-2` 有本人 `div.top2/touserid` 时单请求确认登录；公开页 unknown 时才补读 `waplogin.aspx?siteid=1000`，只有 `form[name=login][method=post]` 内同时存在 `#logname[name=logname]` 与 `#password[name=logpass]` 才确认退出；完整 form 优先于同页 Gocaptcha/ImageCaptcha 资源，只有无完整 form 的独立验证页才是 verification，URL、缺字段 form、HTTP/网络失败均不得猜测。最低测试必须覆盖 direct 快路径、模糊页 fallback、owner 传播、Account early + load-end fallback、双注入幂等、精确 null 与负向 runtime、完整/不完整/带验证码资源 form、共享 reason 消费者和零 Cookie 清理；隔离 AVD Replay 再证明 NodeSeek、妖火权威未登录后才进入搜索矩阵。`REG-TEST-004` 进一步要求 NodeSeek 的 `anonymous` 与访客 `verified` 都作为未登录终态验收，不能把 clearance 文案当成账号身份。

`REG-SOURCE-005` 补充冷启动 fallback 调度验收：Feed/Categories 进入页面立即执行 direct request，Account 刷新作为 background 并发，不增加登录预检。NodeSeek 与 linux.do 各自的隐藏 WebView 队列必须按 `write > foreground > background` 调度、同优先级 FIFO；已开始任务不被抢占，队中任务不因新任务而拒绝或取消。最低测试同时排队 Feed、Categories、Account，要求三者均得到自己的确定结果且后台请求不能取消前台请求。

`REG-SOURCE-006` 补充取消与超时验收：隐藏 WebView 的 15 秒执行 timeout 只能在任务获得执行权后开始，排队等待不消耗预算；外层 direct request timeout 在正式移交 fallback 时停止，避免排队阶段误取消。用户 AbortSignal 只取消自己的排队或执行任务，不能影响同站或跨站其他任务。direct request 默认只执行一次，符合既有明确条件时只进入一次 fallback，不新增冷却或熔断；`REG-LINUXDO-008` 的 8 秒 active-time watchdog 同样必须先由 WebView 成功取得内容，才允许轮换读取 runtime，取消、写请求、HTTP/解析失败、失败 WebView 与 Cloudflare 均不得触发。

`REG-SOURCE-009` 补充 fallback source-proof 验收：裸 `Response.ok` 不是恢复成功 oracle，候选必须绑定具体 Response，并由实际 source parser 接受；Feed/Categories/Search 的逐站 child 只能暂存 proven evidence，所有 sibling 结算并形成最外层 typed aggregate result 后才可提交。每次 evidence commit 前还必须确认 Gateway generation 仍 current 且所属 signal 未 abort。最低测试必须同时覆盖 NodeSeek generic HTML、linux.do malformed JSON、Account current-user、聚合逐站隔离、child 已完成但 sibling pending 时 outer abort/supersede、全部 child 成功后的延迟提交、被 partial 吞掉的辅助请求、主 fallback 后的辅助 direct、更新 direct 对旧迟到候选的门禁、aggregate child 继承 owner eligibility、Account abort、多 evidence 中途失效、无 scope fail-closed，以及合法空列表/明确匿名仍可提交。attempt 门禁不得改写业务成功值、rotation failure 或 Gateway 原有取消语义；不得以 diagnostics `parse_empty` 一刀切合法空结果，也不得用 endpoint URL heuristic 代替 parser proof。

`REG-PROXY-006/009/010` 补充连接资源所有权验收：跨 generation 的 `dispatcher.cancelAll()` 与 forum/media 两池全局 `evictAll()` 只允许出现在代理配置 transition 的 fail-closed 清理中。NodeSeek、linux.do、妖火的普通 403/429、Cloudflare、解析、账号或失败 fallback 都不得触发轮换或全局清理；只有“原生幂等读取 timeout/network error 且同次 WebView fallback 成功”可触发 App 读取 runtime generation 轮换。并发 NodeSeek/linux.do fallback 必须在各自 direct request 开始时捕获 `expectedGeneration`：第一条 parser proof 轮换后，第二条迟到 proof 仍以旧代执行 CAS noop，不能在提交时重读 current 并生成第三代；非法、未来代在进入 Native bridge 前拒绝。生成 Kotlin 测试必须证明稳定 CookieJar、代理配置和 RN TLS/缓存语义跨代保持，而 ProxySelector wrapper、Dispatcher、forum/media pool、Expo Image client 与 Cronet generation 都更换对象；发布后新请求只抓 current generation，旧代仅取消触发内容来源的论坛正文/媒体 `GET/HEAD`，无关健康请求与全部写请求自然 drain。打包守卫固定代理 transition 的全局取消调用点唯一，跨站 Controller 测试证明一个站点失败不取消另一个站点在飞请求。

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

`test:device` 要求可信安装为 `agent-device >= 0.19.0`，随后核对 App version/versionCode，并从明确设备只读拉取已安装 `base.apk` 计算 SHA-256；任何身份不匹配都直接失败。它只形成 `DEVICE_REPLAY_PASS`；JUnit、截图、视频和日志产物进入 ignored 的 `tmp/agent-device/`。每个 `.ad` 使用唯一 session、独立 relaunch且不自行 `close`，让 test harness 先完成录屏 stop，再执行 session cleanup；单文件内部零重试并在失败处停止。普通执行失败时外层继续其余文件并汇总为非零退出，任何录屏隔离或恢复失败都立即中止。执行前若明确设备存在 active manifest、对应 `.tmp`、工具录屏进程或 orphan scratch，流程按 `BLOCKED_BY_ENV` 停止并保留现场；正式 manifest 即使为空也按文件存在视为占用。执行后只对同时匹配本条唯一 session 与 device 的 manifest 调用 agent-device `record stop`，未知或畸形 manifest、录屏进程和 scratch 一律不终止、不删除。runner 不结束本机 daemon，不使用 wildcard 清设备文件，也不能停止 MCP、清 App 数据、Cookie、用户文件或本机首败证据。代理 startup gate 放行 routes 前必须渲染静态、可访问且无动画的启动状态，使 selector wait 能在冷启动期间继续等待而不是因零 accessibility node 提前失败，见 `REG-TEST-008`；不得以固定 sleep 或 retry 掩盖。普通套件固定七个独立失败域：账号与小隐寺等级、聚合 Feed、聚合 Search、Library、本地 More、NodeSeek WebView、统一消息中心；账号等级集中在 `account-readonly.ad`，本地 More 不发等级请求，消息中心 Replay 不执行真实已读。Feed/Search 只断言当前请求进入合法 outcome，不要求实时首条、固定列表长度或动态详情成功；Topic/User 嵌套和 Library 空/非空由固定 RNTL 严格覆盖，真实对象链由 Agent Live 在满足前置条件时核实。NodeSeek Replay 只使用 App 自有 `nodeseek-login-webview-settled` 及刷新/返回流程，不读取第三方 DOM；timeout 必须先卸载失败的 WebView generation，使 App 自有 marker、错误和刷新入口可被 Android accessibility 读取，显式刷新才 remount，见 `REG-VERIFICATION-004`。小隐寺等级点击恰好一次，等待 `xiaoyinsi-level-settled` 和成功/错误共有的“刷新等级”，不等待成功专属内容、不复试，见 `REG-TEST-005/006/007`。

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

通过标准：覆盖安装且不清 App 数据；确认 App 版本、versionCode、APK SHA、设备和登录来源；覆盖安装后先读取设备 epoch、再写唯一 logcat marker 并执行第一次启动，以 `logcat -T` 有界读取该时间之后的日志，按包名与该包 PID 裁剪 marker 后窗口。`APK_SANITY` 只要求 `main-tab-feed` 可见、目标包在前台且该窗口无崩溃、ANR 或 RedBox；marker 丢失同样失败，不得清空设备全局 logcat。随后执行 `tests/device/` 的七条普通 Replay，形成独立的 `DEVICE_REPLAY_PASS`；真实未登录旅程通过独立设备命令另行执行。动态搜索无结果、合法空 Library 或第三方阻碍不构成 APK 产品失败，只有 APK 身份错误、App 自有入口或当前请求无法结算、永久 Loading、错误不可见或无恢复入口才失败。全程只读，不创建或切换收藏，也不执行其他真实写操作；独立能力继续取证。

动态来源、真实账号和已授权写操作按 `tests/live/agent-live.md` 执行。普通改动只跑受影响能力的 `targeted`；集中修复、里程碑或发布前跑 `full`。非远端写入场景可无人值守且相互独立：App 内原站 WebView 的普通 CF checkbox 只在 Cloudflare 上下文、唯一 checkbox role 和语义 label 同时成立时按新 snapshot ref 点击一次，随后必须通过 App-owned canonical 检测并只恢复原 Query 一次；禁止坐标、DOM 注入、Cookie 导出、独立浏览器旁路、整套重跑或写请求自动重放。登录、账号授权、一次性验证码、题目式 CAPTCHA、无法语义定位、30 秒未通过或 canonical 检测失败只将对应来源记 `BLOCKED_BY_ENV`，不在运行中等待用户，继续其他独立场景；不可逆结果不明确时不得重试。动态服务同时报告应用流程和数据读取结果：成功数据，或明确错误可见、可刷新且无自动请求突发，应用流程均可记 `LIVE_PASS`；数据真实出现记 `LIVE_PASS`，明确限流或有诊断证据的外部故障记 `BLOCKED_BY_ENV`，证据不足记 `NOT_VERIFIED`，诊断证明 App 的请求构造、凭据路由、鉴权头或解析契约错误时则记数据读取明确失败，即使错误 UI 流程本身正确。小隐寺等级首次失败时先保留错误和脱敏诊断；只有错误明确给出可执行的限流/冷却时间（时长或截止时刻），才等待至窗口结束再加 2 秒并显式刷新一次。复试成功仍记录首败，再次限流记数据 `BLOCKED_BY_ENV`；其他错误不猜成限流，也不得仅因 App 正确展示错误态就判产品失败。不得重跑整套或增加全局 retry。

## 消息通知验收

消息中心同时跨四站、账号身份、后台调度和 Android 权限，必须分层验收，不能用“列表能打开”代替协议、隐私或后台证据。

### 自动测试

1. 四站脱敏 fixture 固定分页、稳定 ID、未知类型、未读、auth/CF/畸形响应和来源隔离；NodeSeek 的 CF challenge 与畸形 JSON、Discourse 的 401 与畸形 JSON、妖火的失效登录与损坏详情 target 都必须明确失败，不能结算为空页。NodeSeek 另固定三类 `markViewed` body、列表省略 `viewed` 时仍为未读、缺远端 ID 的非敏感稳定 fallback、同 timestamp 无 ID 多会话保守丢弃，以及 `commentId` 在 floor 缺失/无效/错误时仍为主身份并在 `postPageCount` / pager 确认的页界内逐页命中；Discourse 固定单条/批量 PUT 与顶层 serializer 字段；妖火固定时间/删除动作分离、目标详情 block、目标 ID 缺失明确失败和详情后重读列表复核；小隐寺固定新旧 credential 迁移与失败回滚。
   - NodeSeek @我/回复 fixture 必须同时给出可复用的列表行 `id` 和变化的 `comment_id`，证明投递身份跟随 `comment_id`，而 `markViewed` 仍只使用原始行 ID。
   - `REG-NOTIFY-031` 另固定四站 adapter-owned 分类、category endpoint/type/query、Discourse PM topic 与 Chat 声明、NodeSeek Markdown 标志、妖火 hidden fields/最近 20 条气泡/精确成功文本，以及原消息正文与聊天历史隔离。
   - `REG-NOTIFY-043` 固定同一条 Discourse 私信从“所有通知”和“个人信息”进入时生成相同 `private-conversation` target；必须继续加载完整会话与 Markdown reply，不能按普通 `topic-post` 读取单帖。
   - `REG-NOTIFY-053` 固定 Discourse 只有 `topic_id`/URL 的主题提醒及 NodeSeek 没有 comment ID/floor 的主题行生成 `topic` target；详情不得发起精确帖子读取，“查看相关主题”必须只传 Topic 且 `targetReply` 缺失。显式 `post_id`/`post_number`/comment ID/floor 继续生成 `topic-post` 并保持精确定位。
   - `REG-NOTIFY-054` 固定 Discourse opening post 的 `topic-post { postId, postNumber: 1 }` 继续用于读取完整通知详情，但进入 Topic 时 `targetReply` 必须缺失；不得按系统消息 kind 或标题关闭其他真实回复定位。匹配开发包用已有已读“LINUX DO 社区抽奖规则”只读验收正文和“查看相关主题”，不得出现楼层定位提示。
   - `REG-NOTIFY-032` 固定私信消息靠底、元信息置于气泡外、整行 composer 入口，以及共享 ReplyComposer 的 NodeSeek 贴纸/NodeImage、linux.do/小隐寺 emoji 与 `/uploads.json`、妖火纯文本边界；上传测试必须证明 writable gate/NodeImage Key 早于 picker、重复或取消零上传、成功只插入草稿且文件名/API Key 不进入 diagnostics。
   - `REG-NOTIFY-033` 固定 NodeSeek 通知携带精确 comment ID、远端 floor 位于后续页且主题没有总回复数的组合；详情必须先读 floor 提示页并仍以 comment ID 精确匹配，页界来自 `postPageCount` / pager。
   - `REG-NOTIFY-034` 固定私信回复 dock 与普通通知主题操作 dock 都追加 bottom safe-area inset；共享 Composer 已自行消费安全区，不得重复垫高。
   - `REG-NOTIFY-035` 固定 tabs 短标签在至少 48dp 点击区与选中线内水平居中；保留内容宽度与横向滚动，不以强制等宽破坏大字号或长标签。
   - `REG-NOTIFY-036/038/041/050/055` 固定消息、共享 Tab/按钮与 ReplyComposer 消费 Reader 字号、工具栏单行横滑且末尾工具可达、主题光标、Discourse 五列表情及 Bottom Sheet 的 top-safe 75% 高度与 bottom inset；设备必须在 100%/130%、键盘开关和 accessory 展开三种状态复核，不得只看默认字号静态截图。
   - `REG-NOTIFY-037/042` 的妖火 fixture 同时包含原消息重复项、倒序历史、日期作者、位于正文内或气泡外包装的斜杠“回复时间”、图片和导航链接；测试必须模拟 Android 严格日期解析，真实只读验收必须确认协议标签消失，但作者、图片、时间和导航链接仍保留。
   - `REG-NOTIFY-044` 固定妖火主题链接（`/bbs-*.html` 或 `book_view.aspx`）与 `book_re.aspx` 都保留 href；Notifications RNTL 必须证明点击后经过共享 `parseForumTopicLink` 进入 App 内 Topic，而不是调用 `Linking.openURL`。
   - `REG-NOTIFY-045` 使用原站真实 `book_re.aspx?...&tofloor=90&...` 形态固定精确楼层；`src/domain/forum/links.test.ts` 拒绝无效/站外参数，Notifications Screen/Route RNTL 必须把 `{ floor: 90 }` 传入现有 Topic target，而普通主题链接不得伪造目标。
   - `REG-NOTIFY-047/048` 固定 NodeSeek 完整主题链路原样传递 `ReplyLocationTarget`，缺失/错误 floor 时仍以 comment ID 在响应页拓扑的已知页界内精确命中且不依赖 `replyCount`；只含 `message_id` 的兼容行也必须把同一 ID 写入 target，不能只用于通知去重。
   - `REG-NOTIFY-049` 固定同身份 pending/unknown 只暂停私信访问并保留内存草稿，确认退出或换号才清空；不得为测试持久化草稿。
   - `REG-NOTIFY-051` 固定妖火条目分别保存来源分类和页码，详情后的已读复核必须回到原分类、原页；真实逐条已读仍需单独写授权。
   - `REG-NOTIFY-039/040` 分别固定列表/气泡统一 `YYYY-MM-DD HH:mm` 与富文本链接使用 Reader theme primary；未知时间继续显式未知，不能为视觉统一猜值。
2. Store/worker/system 固定首次 baseline 静默、首发四站 opt-in allowlist、每站摘要、200-ID 上限、重复运行不重复、全局/单站开关重启恢复、换号/退出清理、代理失败零请求、墙钟 deadline 和单站失败不阻断其他站；至少用两页 fixture 证明 worker 沿 opaque cursor 请求 `[undefined, next]` 并只记录最新 60 条，同时固定重复 cursor/无下一页停止。系统通知或 identifier 保存失败必须回滚本轮投递 ID；记录后及 Android 返回后关闭全局/来源开关或换号，都必须复核、撤销账号级 exact identifier 并释放 ID，旧 identifier 不得复活或误删新账号摘要。registration 测试必须阻塞 register/unregister 并交错提交相反意图，最终状态只服从最后一次调用；空 eligible-source 集合不得注册后台任务，foreground handler 必须展示 banner/list 且不设置 badge。
3. 隐私断言必须证明标题、正文、预览、会话、Cookie 和 token 不进入持久化、诊断或系统通知 payload；参与者只允许进入当次 Android 摘要正文，不进入持久化或诊断。摘要除此之外只含来源、动作和新增数量。
4. Gateway/RNTL/导航测试固定 More 入口和 `none/update/messages/both` 无障碍文案、总览/单站/未读筛选、合法 outcome marker、分页/刷新/局部错误、详情、已读失败提示、首次 opt-in、权限拒绝/撤销意图及四站开关；聚合局部错误必须为每个失败来源显示独立重试，并证明点击只调用目标来源 `listPage`、携带发起时 expected identity 与 cancel signal、只 patch 对应失败页；失败页不是末页时恢复 cursor 必须传播到末页，其他来源数据和 `listAllPage` 不变。还必须覆盖消息 native route 的 Android 硬件返回、旧 `read,write` 小隐寺授权显示升级而非登录且不能维持空后台任务、其 scope 读取不阻塞其他来源身份、pending/unknown 保留可信身份/cache 但不参与读取也不渲染旧私有 row、确认退出清 aggregate Query、前台 snapshot 调用共用投递 worker、snapshot 存储失败不阻断成功来源、消息中心可见时仍调用 Android system sink、隐藏但 mounted 的列表停止读取、快速连续身份变化只允许最新 effect 落盘、详情 route 绑定条目身份，以及 adapter I/O 前的 expected identity/abort；主题级 target 打开 Topic 时不得携带 `targetReply`，精确帖子 target 必须保留完整定位字段；条目 label 包含动作，短来源 Tab 双轴至少 48dp。
   - `REG-NOTIFY-052` 固定未读消息同时点亮底栏 More 和 More 内“消息通知”入口；入口使用结构化未读布尔值显示主题 danger 红点，清零立即消失，只有版本更新时不得误亮消息入口。
   - 分类/私信 RNTL 必须覆盖聚合页无分类、单站分类切换与切站重置、category Query key、子分类无批量已读、靠底左右气泡/作者/时间/最新定位、Markdown/纯文本 composer、图片/表情站点边界、空白/发送中防重复、未确认保留草稿、确认后清空及失效详情/单站/聚合/snapshot；Gateway 还固定图片上传的 exact identity/abort、小隐寺 `write` scope 和敏感正文/文件/凭据不进入 diagnostics。
5. 运行相关 Vitest/Jest、`npm run typecheck` 和 `npm run verify`；`app.json`、TaskManager 或原生依赖变化还要 fresh Expo prebuild，检查生成 manifest/permission/icon/plugin，运行生成的 Kotlin 单测和 `:app:compileReleaseKotlin`。正式 release 脚本仍受 Node 22、clean tree、签名和设备前置门禁约束。

### 设备与 Live 边界

1. `tests/device/notifications-readonly.ad` 从 More 进入消息中心，依次检查总览与四站 `data/empty/partial/error/auth` 合法结算，切换“只看未读”开/关，打开设置确认四站都存在，再用系统返回依次回到消息列表和 More。Replay 不要求当天有数据，不点击消息行、不下拉刷新、不改变字号或启用 TalkBack；详情、刷新、默认/大字号布局和 TalkBack 动作朗读由匹配 APK 手动/只读 Live 补验，未执行记 `NOT_VERIFIED`。全程不执行真实已读、全部已读或主设备 Android 通知设置变更。
2. Android 13+ 权限 grant/deny/revoke、前台普通页/消息中心与后台的每站摘要替换、锁屏 `PRIVATE`、warm/cold 点击只进来源列表及约 15 分钟 WorkManager 调度，在一次性 AVD 上验证；不得清除或卸载主登录模拟器 App。前台/后台真实新消息需要外部账号产生一条 baseline 之后的 @我、回复或私信；缺少该前置时分别记 `LIVE_PASS NOT_VERIFIED`，不能用恢复旧未读冒充。
3. 原站当天有无消息不作为 Replay 前置。逐条和批量已读属于真实写入，只有用户对具体来源另行明确授权后才执行 `LIVE_PASS`；否则统一记 `NOT_VERIFIED`，不得用 Fixture 通过冒充线上写入通过。
4. 匹配 APK 的只读 Live 可切换四站原生分类并打开已有已读私信会话，检查会话气泡与 composer，但不得点击图片或发送。真实上传必须另获“站点、测试文件”授权；每个站点的真实回复必须另外取得“站点、收件人、测试内容”三项明确授权。未授权统一记 `NOT_VERIFIED`，未确认响应不可自动重试。

## 搜索验收

搜索是最容易出现“看起来能搜，实际坏了”的功能。改搜索、来源解析、筛选、列表分组、请求归属，或改动会影响搜索路径的 Cookie、隐藏 WebView 时，必须执行下面两层。

### 自动测试

```powershell
npm test -- src/sources/feedRead.test.ts src/sources/searchRead.test.ts src/sources/sourceTopicRead.test.ts src/sources/sourceUserRead.test.ts src/sources/sourceAccountRead.test.ts tests/integration/source-read-contracts.test.ts src/sources/xiaoyinsi/reader.test.ts src/domain/forum/searchFilters.test.ts src/features/search/listItems.test.ts src/sources/readGateway.test.ts src/sources/readGatewayContract.test.ts src/sources/yaohuo/reader.test.ts tests/integration/query-session-contracts.test.ts src/features/search/searchRun.test.ts
npm run test:ui -- tests/ui/search/search-screen.test.tsx tests/ui/search/search-controller-ai.test.tsx tests/ui/account/account-status-controller.test.tsx
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
npm test -- src/sources/xiaoyinsi/auth.test.ts src/sources/xiaoyinsi/actionClient.test.ts src/sources/xiaoyinsi/actionRequest.test.ts src/sources/xiaoyinsi/reader.test.ts src/domain/session/siteSessionState.test.ts src/features/more/accountCenter.test.ts tests/tooling/release-packaging.test.ts
npm run test:ui -- tests/ui/account/xiaoyinsi-auth-controller.test.tsx tests/ui/more/more-screen.test.tsx tests/ui/account/account-center.test.tsx
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
npm test -- src/sources/sourceUserRead.test.ts src/sources/yaohuo/parser.test.ts src/sources/yaohuo/reader.test.ts src/features/user/userScreenItems.test.ts
npm run test:ui -- tests/ui/shared/topic-card.test.tsx
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

修改投票标记解析、投票卡片数据、公共投票 UI、action builder/client/controller、写后状态或 Topic Query cache 时必须执行。先沿真实依赖关系列出五站消费者；只有语义、数据约束、生命周期和错误处理一致时才允许共享。即使代码只改一个分支，也要证明 NodeSeek、LinuxDo、妖火、小隐寺的提交行为和 V2EX 只读行为没有回归。

### 自动测试

```powershell
npm test -- tests/integration/source-read-contracts.test.ts src/sources/xiaoyinsi/reader.test.ts src/sources/nodeseek/actionRequest.test.ts src/sources/nodeseek/actionClient.test.ts src/sources/xiaoyinsi/actionRequest.test.ts src/sources/xiaoyinsi/actionClient.test.ts src/domain/forum/topicActionState.test.ts tests/integration/hidden-browser-scripts.test.ts src/sources/yaohuo/reader.test.ts
npm run test:ui -- tests/ui/topic/topic-actions-controller.test.tsx tests/ui/topic/topic-components.test.tsx tests/ui/topic/topic-reply-filters.test.tsx
npm run typecheck
```

通过标准：

- NodeSeek `/api/vote/info/{id}` 缺少动态签名的 403 必须能被测试复现；fallback header 只进入投票读取和提交，不能扩散到其他 NodeSeek JSON 或写操作。隐藏 WebView 不等待投票 DOM。
- 未投、已投、多选、锁定和多个标记部分失败分别有 oracle。未投时不提前展示结果票数；成功标记替换为正文内投票占位，渲染表单与相邻 `">` 原始标记并存时也只能保留一张卡，且严格位于标记前后正文之间；整篇 NodeSeek 正文保持一个 HTML 渲染树，不因投票新增正文分隔线，投票后的文本、图片和 sticker 不重叠；失败标记保留且详情诊断为 `partial`。
- NodeSeek 取消确认时保留当前选择且零请求；确认后只有一次 POST，随后只有一次结果 GET。服务端快照替换精确 Topic Query cache 中的投票数据，不刷新整篇正文。
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
npm test -- src/features/topic/shareTopic.test.ts src/features/topic/actions/actionHelpers.test.ts src/features/topic/useTopicSessionController.test.ts tests/integration/image-upload.test.ts src/sources/discourse/imageUpload.test.ts src/platform/network/loginWebViewScripts.test.ts src/sources/nodeimage/authFlow.test.ts src/platform/network/loginWebViewScripts.nodeimage.test.ts src/sources/nodeimage/credentials.test.ts src/platform/diagnostics/diagnostics.test.ts src/sources/nodeseek/actionRequest.test.ts src/platform/network/managedCookies.test.ts src/sources/nodeseek/session.test.ts tests/integration/hidden-browser-scripts.test.ts src/ui/composer/replyFormatting.test.ts
npx jest --config jest.config.cjs --runInBand tests/ui/account/account-host.test.tsx tests/ui/topic/topic-actions-controller.test.tsx
npm run typecheck
```

通过标准：

- 发送失败或上传失败后，同一个回复框还能继续点击和编辑。
- NodeSeek 图片上传使用用户自己的 NodeImage Key；无 Key、Key 归属不符或 401/403 时只提示到账号中心“获取 / 恢复授权”或手动粘贴，授权入口调用为零，文件选择/上传都不重放，草稿保持不变。
- 用户主动“获取 / 恢复授权”时先探测现有 NodeImage session：有效 session 自动保存并关闭且 Connect 为零；只有精确 `401 + JSON error` 才恰好 Connect 一次。HTML 403、网络、5xx、无效 JSON、200 缺 Key、WebView 重载、重复/迟到消息都不得进入额外 Connect 或多次结算。
- NodeSeek 回复 / 编辑必须使用真实 post/comment id；当前请求未传 token 时由 `src/sources/nodeseek/actionRequest.ts` 生成 16 位 `csrf-token`，自动测试必须固定该请求契约。
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
npm test -- src/sources/discourse/actionRequest.test.ts src/sources/discourse/model.test.ts src/sources/nodeseek/actionRequest.test.ts src/sources/yaohuo/actionRequest.test.ts tests/integration/source-read-contracts.test.ts src/sources/yaohuo/parser.test.ts src/sources/xiaoyinsi/reader.test.ts
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
| 详情 | 来源、标题、作者、时间、正文、回复数、附件、图片预览、返回；含图长帖按 `REG-TOPIC-048` 检查适屏先显、附近渐进清晰、远段不抢加载、全屏返回外层保持适屏像素且不跳位，并可从磁盘缓存恢复原图升级层、原图失败保留适屏图；超长 opening body 按 `REG-PERF-008` 检查 chunk 随列表 viewport 挂载，不在 header 一次性渲染；正文引用与评论引用分别检查简介常显、展开完整帖、收起恢复简介，跨主题评论引用检查目标链接和错误同楼层隔离；进入目标后分别在 Loading 与完成态返回，确认一次恢复原详情、转场无 B 内容/白灰空页且两类引用互不串样式和状态 | 保存图片、回复、点赞、收藏切换 |
| 搜索 | 关键词、逐来源合法 outcome、筛选、清空和错误/空态；仅在存在数据前置时打开详情并返回 | 外部网页、写操作 |
| 收藏 | ready/empty、来源筛选、分类筛选；有前置数据时检查已收藏 / 已读状态 | 取消收藏 |
| 历史 | ready/empty；有前置数据时检查最近阅读和已读状态 | 删除、清空历史 |
| 关注用户 | ready/empty；有前置数据时检查用户页、用户主题列表和返回 | 取消关注 |
| 账号中心 | 四个可登录来源顺序、单站详情、真实状态、身份、主操作、顶部唯一公共 `刷新账号状态` 和全部原服务入口；原三站显示凭据摘要并从 App 内打开登录 / 验证页，小隐寺只显示 Device Code 授权且打开系统浏览器；测试凭据填入但不提交并在结束前删除 | 清除网站登录、撤销授权、退出登录、手工改 Cookie、提交测试登录、真实签到 |
| 消息通知 | More 入口、总览/四站来源、各站原生分类、只看未读、当前请求合法 outcome、空态/局部错误、已有已读会话气泡与 composer、设置文案与默认关闭；一次性 AVD 另验权限、摘要隐私和 warm/cold 跳转 | 打开具体未读条目、点击发送私信回复、全部已读、启用主设备后台通知、真实逐条/批量已读 |
| 回复编辑 / 图片上传 | 四个可写来源回复框、失败后可继续编辑、格式按钮、文件选择器打开和取消；只用现有 NodeImage session 验证自动保存、关闭和零 Connect；失效兜底流程由自动测试固定，真实 Connect / 上传只按 Agent Live 逐次授权 | 真实 Connect、真实上传、真实发送回复、清除 NodeImage Key/Cookie |
| 回复删除 | 删除入口和权限显示；确认框取消及删除后消失默认由自动测试覆盖 | 点击已有内容的删除入口、真实新发回复、真实删除回复、删除旧回复、删除他人回复、清数据制造状态 |
| 未登录设备 | 只在独立 AVD 上使用同一 APK，四站结算为权威未登录状态（NodeSeek 可为“未登录”或仅访客“已验证”，linux.do 为“匿名可用”）；可完成访客 CF 验证但不登录论坛；主设备数据、Cookie 和登录态不变 | 克隆主 AVD 数据、登录论坛、清主设备数据或 Cookie |
| 更多页 | 版本、检查更新、账号中心、linux.do 等级、小隐寺“查看等级”读取、profile/error 结算标记及成功/错误共有的恢复入口、服务器代理入口、问题诊断入口、备份入口、外观入口；小隐寺动态等级数据按 Agent Live 分轴核实；诊断日志验收时打开分享面板后取消，确认 App 可继续使用 | 小隐寺等级复试、备份导出、导入、安装更新、切换外观、启用未知代理 |

## 改动类型对应验证

| 改动类型 | 必跑 |
| --- | --- |
| 来源解析、搜索、详情、用户页 | 对应来源测试、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`tests/integration/source-read-contracts.test.ts`、`npm run typecheck`、模拟器验收 |
| App controller、server state key、取消请求 | 对应 controller 测试、`tests/integration/query-session-contracts.test.ts`、`src/sources/readGatewayContract.test.ts`、`npm run typecheck`、模拟器验收 |
| 登录、验证、Cookie、Device Code、写操作 | `src/domain/session/authSurfaceCoordinator.test.ts`、`src/platform/network/managedCookies.test.ts`、`src/domain/session/writableSessionGate.test.ts`、相关 verifier / action / session 测试、`tests/tooling/release-packaging.test.ts`、`tests/integration/security-boundaries.test.ts`、`npm run typecheck`、模拟器验收；小隐寺另跑 Device Code 验收 |
| 投票解析、卡片数据、提交或写后状态 | 完整执行“投票验收”；按五站展开影响面，NodeSeek 真实提交必须逐次授权且结果不明不得重试 |
| 账号中心、凭据保存 / 填入、NodeSeek 当前会话证明与显式清理、小隐寺授权 | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/sources/nodeseek/session.test.ts`、`src/platform/network/managedCookies.test.ts`、`src/domain/session/authSurfaceCoordinator.test.ts`、`src/platform/network/loginWebViewScripts.test.ts`、`src/sources/xiaoyinsi/auth.test.ts`、`tests/ui/account/xiaoyinsi-auth-controller.test.tsx`、`src/features/more/accountCenter.test.ts`、`src/platform/storage/credentialVault.test.ts`、`src/domain/session/loginFormAdapters.test.ts`、`src/domain/session/siteSessionState.test.ts`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/tooling/release-packaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 回复编辑、楼层回复、图片上传、NodeImage Key | 回复图片上传验收、相关 action / WebView script 测试、`npm run typecheck`、模拟器验收 |
| 回复删除、删除权限、评论 id / 删除链接解析 | 回复删除验收、相关 action / 来源解析测试、`npm run typecheck`、模拟器验收 |
| 收藏、历史、备份 / 恢复 | reader data / backup 测试、`tests/integration/security-boundaries.test.ts`、`npm run typecheck` |
| 服务器代理 | `src/platform/network/networkProxy.test.ts`、`tests/tooling/network-proxy-controller-guard.test.ts`、`tests/tooling/network-proxy-modal-guard.test.ts`、`tests/tooling/webview-proxy-guard.test.ts`、`src/platform/update/appUpdateProxyGuard.test.ts`、`tests/tooling/release-packaging.test.ts`、`tests/ui/more/network-proxy-modal.test.tsx`、fresh Expo prebuild、生成 Kotlin JUnit（含 `REG-PROXY-007/008` 的 stop/worker overlap 与阻塞写 deadline）、`:app:compileReleaseKotlin`、`npm run typecheck`；模拟器默认只做离线 UI 验收，不启用真实代理 |
| 消息中心、私信回复、Android 通知、后台任务 | 四站 notification adapter/gateway/store/worker 测试、notification UI/AppNavigator/More 与共享 ReplyComposer 测试、账号与小隐寺 credential 测试、代理 fail-closed 测试、`tests/tooling/release-packaging.test.ts`、fresh Expo prebuild、生成 Kotlin JUnit、`:app:compileReleaseKotlin`、`npm run typecheck`、`tests/device/notifications-readonly.ad`；真实已读与每站私信回复另行授权 |
| UI 样式、主题 | 只保留事故级 UI helper 测试、`tests/integration/style-ownership.test.ts`、`npm run typecheck`、模拟器验收 |
| App 内更新检查、安装入口 | `src/platform/update/appUpdate.test.ts`、`src/platform/update/appUpdateProxyGuard.test.ts`、`tests/tooling/release-packaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 签名、版本、原生构建配置、发布脚本、正式发布 | `npm run release:android` |

## Review 修复回归基线

| 修复点 | 必跑自动测试 | 必做模拟器验收 |
| --- | --- | --- |
| NodeSeek 未登录 Google 兜底与旧 Cookie header 不落盘 | `src/sources/nodeseek/session.test.ts`、`src/platform/storage/legacyCookieSnapshotMigration.test.ts`、`tests/integration/security-boundaries.test.ts` | 已登录态下复测 NodeSeek 搜索和详情；不得为制造未登录态清数据或清 Cookie |
| 首页 `全部` + 妖火拆分分页失败不混入半页结果 | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` | 首页 `全部` 下滑加载下一页，确认五站来源仍可见，且没有加载失败后混入半页结果或错误状态残留 |
| HTTP 成功但解析为空不落地 | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx`、`tests/ui/search/search-controller-ai.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/user/user-controller-session.test.tsx` | 五站只读 Feed/Search/Topic/User 正常路径继续可用；自然解析失败时保留旧状态、显示重试且不跳页 |
| linux.do 验证后普通恢复失败不误报成功 | `src/features/account/useVerificationController.test.ts`、四类带 `QueryClientProvider` 的 read controller RNTL、`tests/ui/topic/topic-actions-controller.test.tsx` | 只在自然 challenge 出现时确认面板保持可重试；不清 Cookie、不人为断网、不执行写操作制造失败 |
| 账号状态、启动恢复、刷新收尾、动作失效投影或凭据摘要的单站失败隔离 | `tests/ui/account/account-status-controller.test.tsx`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/ui/account/account-controller.test.tsx`、`tests/ui/topic/topic-actions-controller.test.tsx`、`src/features/account/credentialDiagnostics.test.ts`、`src/features/account/useAccountCredentialController.test.ts`、`src/domain/session/siteSessionState.test.ts` | 账号中心正常刷新四站；自然单站失败时旧可信身份或摘要保留、明确失效保持 expired，刷新期间的新 credential generation 不被旧检查覆盖，且其他站完成；任何检测/失效分支都不得删除原站 Cookie，不破坏 SecureStore、清登录或执行真实写操作制造状态 |
| 小隐寺重授权终止后的旧会话复核、写操作复核二次失败 | `tests/ui/account/xiaoyinsi-auth-controller.test.tsx`、`src/sources/xiaoyinsi/auth.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx` | 正常授权、取消和返回路径保持可用；不主动拒绝授权、断网或执行真实写操作制造组合失败 |
| 代理配置读取失败不直连 | `tests/tooling/network-proxy-controller-guard.test.ts`、`src/platform/network/networkProxy.test.ts`、`tests/tooling/webview-proxy-guard.test.ts`、`src/platform/update/appUpdateProxyGuard.test.ts` | 正常只读核对服务器代理面板；不损坏 SecureStore，真实启停需用户授权并确认恢复关闭 |
| 原生代理切换、停止、阻塞写与 bridge 销毁泄漏连接 | 生成的 `NetworkProxyRuntimeTest.kt` 的 `regProxy007StopOverlapsConnectionWorkerCleanupWithoutBackgroundFailure`、`regProxy008BlockedWritesCannotOutliveTheSharedIdleDeadline`，以及 `tests/tooling/release-packaging.test.ts`、fresh prebuild、`:app:testReleaseUnitTest :app:compileReleaseKotlin` | 默认不启用真实代理；只核对代理保持关闭、配置与账号状态不变 |
| 发布 manifest 的 Java provenance | `tests/tooling/release-environment.test.ts` 的 `REG-OPS-016`、`tests/tooling/release-packaging.test.ts`、`npm run typecheck`；同时固定 Java 命令启动失败/非零退出不回显 stdout/stderr | 未获正式发布授权时不签名、不生成或上传 release；自动测试只证明 parser、脱敏失败路径与脚本接线 |
| 代理 TCP tunnel 误报连通且密码明文输入 | 生成的 `NetworkProxyRuntimeTest.kt`、`tests/ui/more/network-proxy-modal.test.tsx`、`tests/tooling/network-proxy-modal-guard.test.ts` | 只离线核对“连通性测试”文案和密码遮蔽；公网 TLS/HTTP 结果未经授权标 `NOT_VERIFIED` |
| 更新检查与下载互斥 | `src/platform/update/useAppUpdateRuntime.test.ts`、`src/platform/update/appUpdate.test.ts`、`src/platform/update/appUpdateProxyGuard.test.ts` | 默认只检查更新；未经明确授权不下载 APK、不打开安装器 |
| V2EX 默认 `all` 页分页起点 | `tests/integration/source-read-contracts.test.ts` | 切到 V2EX 单站，下滑加载更多，确认出现新的 V2EX 主题且无重复首屏 |
| V2EX 超过 100 条的 query-relative 主题分页 | `tests/integration/source-read-contracts.test.ts` 的 `REG-TOPIC-071` | 直达已知超过 100 条的主题；正序可到第二页楼层，倒序首条为最高楼且无窗口错误；只读、不回复或互动 |
| 备份敏感字段过滤 | `tests/integration/security-boundaries.test.ts`、`src/domain/reader/readerBackup.test.ts` | 只检查备份入口；未经用户同意不得点击导出或导入 |
| 详情页返回、用户页返回、回复弹层返回 | `src/features/topic/useTopicSessionController.test.ts`、`tests/ui/app/app-navigator.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`、`src/domain/forum/userNavigation.test.ts` | 打开详情、切换回复筛选、进入作者用户页，再用系统返回，确认回到原详情状态；Topic A → B → A 保留草稿、筛选、滚动与已提交 UI；图片预览和 composer 各拦截一次返回后才 pop route；超长正文检查滚动与返回 |
| NodeSeek 清除登录后 WebView 刷新 | 账号 controller 相关测试、`src/platform/network/managedCookies.test.ts`、`tests/tooling/release-packaging.test.ts` | 只打开 App 内 NodeSeek 登录 / 验证页并确认包名为 `com.wz.reader`；未经用户同意不得点击 `清除登录` |
| 登录 WebView UA 与后续请求身份不一致 | `src/platform/android/androidWebViewUserAgentValue.test.ts`、`src/sources/nodeseek/session.test.ts`、`src/sources/sourceErrors.test.ts`、`src/sources/yaohuo/reader.test.ts`、`src/sources/yaohuo/actionClient.test.ts`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/ui/account/account-site-panels.test.tsx` | 保留 App 数据分别打开 NodeSeek、linux.do 与妖火登录 / 验证页；确认 WebView 和后续请求使用 provider 原生 UA，自然 challenge 只由用户点击，成功后再检测站点状态；模拟器被站点拒绝时记 `BLOCKED_BY_ENV`，不绕过验证 |
| linux.do 跨主题评论引用 | `tests/integration/discourse-content-contracts.test.ts`、`tests/integration/source-read-contracts.test.ts`、`tests/ui/topic/topic-components.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx` | 用给定精确主题直达；引用必须显示卡片、简介和目标内部链接，展开不得读取当前主题同楼层；不得随机扫描其他帖子 |
| 详情回复数跟随筛选结果 | `src/features/topic/model/topicDerivedData.test.ts`、详情 UI 相关测试 | 打开有回复的详情页，切换 `只看楼主` / `只看带图` 等筛选，确认 `回复列表 N 条` 随筛选变化 |
| release 签名摘要固定 | `tests/tooling/release-packaging.test.ts` | 修改签名、版本、原生构建配置、release manifest 或发布脚本时必须跑 `npm run release:android`；确认签名摘要和 manifest 生成成功 |

## 模拟器规则

主登录态 AVD 正是日常更新代码和保留真实登录态/本机数据验收的目标设备，必须支持反复就地覆盖安装。现有独立未登录 AVD 只服务未登录旅程，不替代主 AVD 更新，也不能作为安装失败后的清数据兜底；只有会卸载 target App 的 instrumentation 等特殊流程才使用明确的一次性空白 AVD。

允许：

```powershell
adb -s <serial> shell dumpsys package com.wz.reader | Select-String 'firstInstallTime|lastUpdateTime'
npm run smoke:android
agent-device install com.wz.reader <apk> --platform android --device <device>
adb -s <serial> install -r <apk>
npx expo start --dev-client --clear --port 8081
npx expo run:android --no-bundler --app-id com.wz.reader --no-build-cache
adb shell am force-stop com.wz.reader
adb shell monkey -p com.wz.reader -c android.intent.category.LAUNCHER 1
```

禁止：

```powershell
agent-device reinstall com.wz.reader <apk> --platform android
agent-device uninstall com.wz.reader --platform android
adb uninstall com.wz.reader
adb shell pm clear com.wz.reader
.\android\gradlew.bat :app:connectedDebugAndroidTest # 保留登录态的模拟器
```

`agent-device 0.20.6 reinstall` 会先执行不带 `-k` 的 `adb uninstall`；“Replace installed app” 不是数据保留承诺。保留数据的安装必须在前后只读比对 `firstInstallTime`，值不变才算通过；安全安装失败时停止，不得切换到 reinstall。账号、本机数据或安装时间异常时立即冻结现场，不再启动/退出 AVD 或保存、加载、删除快照，只读采集包时间、启动参数、`quickbootChoice.ini` 与 `snapshot.trace` 后报告；UI 账号数量不是永久丢失或恢复的充分证据。快照恢复必须另行取得用户授权，并先完成可校验的离线 AVD 副本。

确实需要清数据时，必须先得到用户明确同意。`connectedDebugAndroidTest` 只可在一次性空白 AVD 上运行；主模拟器如需原生 instrumentation，覆盖安装 target/test APK 后直接执行 runner，结束时只卸载 test package。
