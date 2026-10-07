# 测试标准

## 阅读导航

- 设计测试：[Canonical owner](#一canonical-owner-模型)、[证据层](#二证据层)、[测试设计](#三测试设计)。
- 修复与重放：[随机顺序](#四随机顺序与可重放性)、[TDD 与历史事故](#五tdd-与历史事故)。
- 执行与交付：[授权边界](#六范围与授权)、[按改动类型验证](#七按改动类型验证)、[交付记录](#八交付记录)。

## 文档职责

本文规定测试归属、证据层、隔离规则、授权边界和不同改动的验证强度。当前产品行为与主要验证证据见 `docs/product-map.md`；历史事故见 `docs/regression-corpus.md`；设备、Replay、Smoke 和发布命令见 `docs/operator-runbook.md`；真实 App 场景见 `tests/live/agent-live.md`。

测试证明当前行为契约，REG 记录历史事故，两者不一一绑定。测试应以尽量少且可靠的用例阻止行为回退，不以测试数量、覆盖率或事故数量为目标。

## 一、Canonical owner 模型

Canonical owner 指在最低可靠层负责证明某项行为的主要测试。下文的 oracle 指判断行为是否符合预期的可观察结果或断言；production seam 指测试实际经过的生产代码接口或实现边界；wiring 指模块之间的调用和连接关系。

一个行为格，也就是一项需要独立验证的行为，由以下五项定义：

`capability + 前置状态 + 用户动作 + 可观察结果 + production seam`

同一行为格只保留一个最低可靠层的主要测试。只有跨层连接可能独立出错时，才额外保留一个连接测试；不得因为一个 Bug 涉及多个文件，就在每层永久复制同一预期。

审计测试时，每个既有用例必须归入一类：

| 处置 | 含义 |
| --- | --- |
| `KEEP_OWNER` | 当前行为唯一或最低可靠的证明。 |
| `MERGE_INTO` | 行为已被更强 owner 完整覆盖，迁入后删除重复用例。 |
| `REPLACE_AT_SEAM` | 依赖内部实现，改到稳定接口或真实 production seam。 |
| `DELETE` | 需求已取代、重复、无失败信号，或只锁无意义实现细节。 |
| `FIX_ISOLATION` | 共享 mock、cache、timer、DOM、module 或异步任务污染其他用例。 |
| `OPEN_BUG` | 当前产品确有缺陷；只保留最小 expected-failure，不修改未授权产品行为。 |

同一行为格出现不同预期时，按「用户最新要求 → 当前运行事实 → product map → 历史事故」裁决。仍不能裁决则在 corpus 标记 `EVIDENCE_GAP`，不得让两套相反预期同时通过。

删除或合并高风险测试前，先做一次临时负向控制：故意破坏对应的生产实现，确认主要测试失败。测试若仍通过，必须先补强断言。负向控制只用于证明测试能识别缺陷，不进入长期产品代码。

账号 fixture 经真实 observation → Account snapshot → view model 投影，合法登录显式提供用户身份，不用测试工厂放行未知身份。选择 wiring 由 `tests/ui/topic/topic-rich-text-selection.test.tsx` 挂载真实 `TopicContentList → TopicSelectionSurface → TopicContentBlock`，保留该业务链，仅隔离平台与昂贵第三方边界；全树 marker 必须与 manifest 一一相等，并检查实际代码文字的 selectable。查询清理归 integration owner，Callout 初始化归真实 `forum-callout` UI owner；bootstrap 检查执行调用顺序，缺失或颠倒初始化都必须失败。

发送安全的 Topic 与签到 owner 必须使用真实 NodeSeek action client 和真实代理等待链，在 identity/epoch/来源/认证 surface 变化后证明零 POST，并有正常一次发送对照。通知详情 owner 保留同一导航实例验证取消后返回、显式重试、防重及旧回调隔离；所有受控 Promise 都响应 abort 或主动释放并等待结算。恢复模式由真实 ReaderRuntime 与来源消费者组合验证零业务请求及通知意图保留，不能只断言 loaded 布尔值。

隔离设备补充证据沿用 `dev/reader-storage-proof/deletionBoundaries.ts` 与 `dev/review-remediation-proof/acceptance.tsx`，只验证 Android SQLite、完整 App 的系统文件导入和原生导航接线。恢复/通知 `.ad` 与最终带 token 的业务 receipt 必须同时通过；Node runner 的独立 checkpoint 还原和来源请求统计不可省略，HTTP/adapter 故障注入不冒充原站写入。执行命令以 operator runbook 为准。

Native tooling owner `tests/tooling/native-test-plan.test.ts` 维护路径到既有 JVM 任务的映射及报告拒绝反例。静态任务表的预期类逐一核对新鲜、非跳过且零失败/错误报告；任务退出 0 或其他类通过不能作为目标 owner 的证据。设备 instrumentation 继续独立执行。

## 二、证据层

Composer 的 Mock 成功结算不等于原生面板关闭。UI owner 必须从生产发送按钮经过 snapshot、校验、controller/gateway、响应确认和草稿结算；只能在 HTTP/adapter 边界注入结果，不直接调用 `completeSubmission()`。

WebView mock 按 INIT/documentEpoch、READY、REQUEST_SNAPSHOT 和 SNAPSHOT 协议工作，初始模式存储与受控 Promise 按用例隔离。BottomSheet mock 隐藏时仍保留子组件，不能用卸载替代生产的关闭动画；关闭从真实按钮触发，不能把动画 onClose 当成用户手势。

RNTL 的动画 mock 不能证明实际几何：必须由带新 token、匹配源码/APK/buildId 的 Android replay 另外检查面板与可见屏幕无交集、遮罩消失、底层可点击、重开为空，以及包含生产根布局/状态栏的全屏背景与内部 Insets。立即/延迟成功、失败保稿、未确认、刷新失败、防重、快照超时/迟到、换主题/账号/会话、根 Portal 随路由隐藏分别取证；真实系统 IME、WebView、Insets 和物理设备边界独立报告。

| 证据 | 只证明 |
| --- | --- |
| `STATIC_PASS` | 文档引用、lint、格式、类型、unused、架构或生成结构检查通过。 |
| `UNIT_PASS` | Vitest 对确定性领域、controller、gateway、存储、请求或 tooling 契约通过。 |
| `UI_PASS` | Jest/RNTL 对 React Native 渲染、状态和交互通过。 |
| `DEVICE_REPLAY_PASS` | tracked `.ad` 在身份匹配的 App、APK、设备和会话上通过；不证明第三方当天健康或真实写入。 |
| `LIVE_PASS` | App 内真实来源、登录态或获授权写操作得到可观察结果。 |
| `APK_SANITY` | 覆盖安装、启动和日志窗口无崩溃、ANR 或 RedBox。 |
| `NOT_VERIFIED` | 当前证据不足，不推断成功或失败。 |
| `BLOCKED_BY_ENV` | 被签名、设备、来源或登录态阻碍，且不能安全改变环境。 |

选择能够可靠证明目标行为的最低证据层。纯数据和确定性协议优先使用 Vitest；必须经过 React 状态、布局投影或用户交互才能观察的行为使用 RNTL；真实 Android 生命周期、登录态、WebView、原站动态数据或原生手势使用设备或 Live 验收。源码字符串、App 启动、快照或 mock 调用本身不能替代用户可观察结果的断言。

Vitest 默认使用 Node 环境；真正执行编辑器 DOM 或 WebView 注入脚本的文件通过 `@vitest-environment jsdom` 单独声明浏览器环境。Library 排序/筛选由真实 SQLite store 与 Route 查询接线证明，不能用测试自建的内存筛选页面或已无生产调用的 helper 替代；版本与 Gradle 配置分别执行实际 CLI 和 Expo mod，不以源码包含某个常量作为成功条件。

备份 parse/export 的纯领域约束留在 `src/domain/reader/readerBackup.test.ts`；导入合并、拒绝后数据不变、事务回滚和重新打开后的安全字段必须通过 `src/platform/storage/readerDataStore.test.ts` 的真实 import/SQLite owner，不再通过测试专用的旧合并 wrapper 证明生产导入。

MCP 与 Replay 不互相替代：MCP 用于探索和定位；Replay 只保存经过审查的稳定入口、断言和返回路径。动态对象、当天首条、固定列表长度和固定网络耗时不得写入 Replay。

Topic 内容守恒由共享 compiler 的 Vitest 契约拥有：同一 fixture 跨主楼、回复、引用、采纳答案、签名和四个来源核对安全文字、链接、图片、表格、代码、DOM 顺序、selection tape 与 preview catalog；compiler 直接生成不可变的 `row.html`、`selectionToken` 与 `previewImages`，opaque 媒体必须有非空且完全转义的降级内容。实体解码后的恶意 `alt/title` 不得重新生成节点或扩大媒体预算；有界内联语义只接受 sanitizer 后由来源 adapter 写入的可信 marker，外部 `/face/` 仍是普通预览。Topic Presentation Contract 的 canonical wiring owner 还必须从 sanitizer → compiler 真实挂载 production renderer，覆盖 standalone/mixed/figure/table、waiting/displayed/SVG poster/original/error/retry/cache/recycle/inactive/epoch；含 `forum-inline-image` 的 row 不得以空 `View` 跳过。临时破坏共享 compatible artifact seam 必须使该用例转红。单次图片事故不新增一条同义 UI 用例；RNTL 只在 Native inline renderer、自然尺寸、预览、失败重试或媒体生命周期 wiring 可独立损坏时承担额外证据。

依赖补丁的 canonical 安装证据不是源码字符串：已执行 postinstall 的依赖树由 `tests/tooling/patch-artifacts.test.ts` 对全部 `patches/*.patch` 运行 `git apply --reverse --check --unsafe-paths`。补丁发生变化时，还必须先在 `npm ci --ignore-scripts` 的干净依赖上逐个执行 forward `git apply --check --unsafe-paths`，再运行真实 postinstall 与 reverse gate。

`package.json` 的 `expo.install.exclude` 只固定项目自行选择的版本，不构成兼容通过。每次升级下列包时必须按真实 consumer 取证；没有对应设备证据就记 `NOT_VERIFIED`，不能用 `expo-doctor` 通过代替。

| 排除包 | 产品 owner | 最低升级证据 |
| --- | --- | --- |
| `@react-native-async-storage/async-storage` | `DATA-01/02`、`ACCOUNT-01`、`NOTIFY-*` | Store 单测；保留数据覆盖安装后冷启，核对 ReaderData、设置、会话和通知水位。 |
| `@react-native-community/datetimepicker` | `SEARCH-03` | V2EX/Discourse 日期筛选 UI；匹配 APK 打开、取消和确认，核对筛选值与键盘/弹层几何。 |
| `@react-native-community/slider` | `MORE-03`、`TOPIC-02` | 字号与音频进度 UI；匹配 APK 连续拖动、无障碍值和返回恢复。 |
| `@shopify/flash-list` | `FEED-*`、`SEARCH-*`、`TOPIC-*`、`USER-*`、`LIBRARY-*`、`NOTIFY-*` | 各列表 canonical UI；匹配 APK 核对多列表回收、分页、滚动/返回和 rich cell 身份。 |
| `react-native-gesture-handler` | `FEED-02`、`NOTIFY-01`、`TOPIC-02`、`MORE-05`、`WRITE-01` | 首页完整手势回归和通知刷新取消；图片缩放/翻页、代码与表格横滑、内容源拖排和 composer 滚动；匹配 APK 核对手势仲裁。 |
| `react-native-pager-view` | `FEED-02` | `feed-navigation-motion` 挂载真实 TabView/TabBar，仅隔离 Native Pager，连续及反向进度必须改变蓝标与文字但不提交来源；`feed-screen` 固定按 route 投影的二级导航、非当前控件隔离、单列表和最终选择一次提交。恢复或升级上游 Pager 后，以匹配 APK 核对慢拖、快甩、回拖、取消、连续反向及跨页点击，二级栏随所属页面移动，结束无额外跳换；取消零读取、最终选择只读取一次，不拼接 idle 与 selected 协议。 |
| `react-native-safe-area-context` | `NAV-01`、`TOPIC-02`、`WRITE-01` | 导航、预览、Modal/Sheet UI；匹配 APK 核对状态栏、底部手势区和键盘边界。 |
| `react-native-screens` | `NAV-*`、`TOPIC-03`、`USER-02` | Native stack UI；匹配 APK 核对返回、嵌套路由、freeze 和原 route 状态恢复。 |
| `react-native-svg` | `TOPIC-02`、`USER-01` | SVG fallback、公式与头像 UI；匹配 APK 核对真实 SVG/Math 渲染和返回稳定性。 |
| `react-native-webview` | `ACCOUNT-*`、`WRITE-01`、`TOPIC-02` | Bridge/session/UI 测试；匹配 APK 核对登录页、结构化编辑器和 fallback，IME 无法自动区分时转物理设备并记 `BLOCKED_BY_ENV`。 |
| `react-native-worklets` | `TOPIC-02`、`MORE-05` | 图片/代码/表格与拖排的 worklet→RN 边界测试；匹配 APK 核对快速反向、取消和重挂。 |

Android 主楼正文连续选择的 canonical evidence 分三层且互不替代：compiler Vitest 固定 UTF-16 logical tape、table row-major、媒体标签和 revision/recycle 逻辑，其中 block/inline 公式以原始 TeX 进入 version 1 media tape，block 保留 boundary，inline 对应 `ReplacementSpan` 插入点，`forum-inline-media-line` 保持段落边界；RNTL 固定横向 Pan 只阻塞后代内容 Native gesture，且仅在确认横向接管后调用 route 级原生选择 owner 既有的 `cancelSelection`，纵向让行不得调用取消；同时固定 manifest 直接来自 visible opening collection，只有这些 opening row 根 View 获得 marker，全部 opening renderer 为 `selectable=false`，并让一个主楼逻辑 document 跨 `richText → heading → table → emoji/sticker → code → trailing text`，当前显示的展开引用/details、签名和 terminal Tab 进入该 document，回复、评论与已采纳答案零 marker 且原有整条长按复制可用。Native JVM 与独立 AVD instrumentation 固定 marker 是唯一 selection 身份，`isTextSelectable`、`isLaidOut` 或全 mounted window owner/fingerprint 完整匹配都不是入口门槛；Layout 只用于当前端点和 mounted `TextView` 的视觉投影，每个可见高亮由对应 `TextView.overlay` 持有，两个端点由同一 ViewRoot 内的列表 viewport overlay 或 fallback `TopicSelectionSurface.overlay` 持有平台 handle wrapper，瞬态映射缺失只跳过当前帧而不取消逻辑选区。TextView/marked-row host 的遮挡 falsifier 必须固定：零底部余量与相邻 row 仍能完整显示行底以下的手柄主体，且 production surface 不依赖关闭 `clipChildren/clipToPadding`。instrumentation 还必须固定无 row-wide double-tap detector/`TextView` long-click patch、普通链接 tap 不被吞、正反向手柄、静止长按唯一入口、双击零原生局部选区、活动选区上静止短按取消但越过选择意图阈值的滚动保留、跨三个 viewport、至少一次 cell recycle、自动滚动和剪贴板顺序；公式 `ReplacementSpan` 的复制顺序必须与 tape 一致，公式 fallback 保持 `selectable=false`，不得形成第二个选择 owner；多行、软换行、LTR/RTL 和 `TextView` 内部 scroll 场景必须证明 start/end 方向、`getLineBottom(line, false)`、primary/secondary horizontal 及平台 1/4、3/4 hotspot 规则，手柄主体不得进入端点字形行，触控目标至少 `48dp`，按下后的细微移动不得让端点跳到手指中心，且手柄拖动始终无放大镜。主要 draw-time oracle 使用生产等价的 `ScrollView + absolute cells`，包含多个 `TextView`、嵌套横向 scroller 与 inline `ReplacementSpan`；纵向或横向 offset 在 coordinator pre-draw 后的同一次 draw 内正反向改变时，TextView-local 高亮与 viewport/surface handle wrapper 必须各自以 `<=2px` 误差出现在当前文字 Path/caret，wrapper 必须在 draw 时读取 source/host 屏幕位置、host scroll 与 source scroll，不能消费缓存的最终 screen 坐标；旧位置至多残留 `2` 个差异像素，取消后实际 host 的 drawable 消失且全部文字 bounds/baseline 不变。端点 owner 仍 mounted 但离开 viewport 时还必须证明 route 命中点消失而 wrapper 不解绑；不经过新 pre-draw 把该 source 移回可见区的同一次 draw 必须立即同时绘出文字与手柄。JVM 必须固定重复选择为 no-op；Android 27+ instrumentation 必须证明只有逻辑端点实际变化才请求 `TEXT_HANDLE_MOVE`，重复 motion、自动滚动但端点未变和程序重绑均不请求。真实 RecyclerView proof 只辅助固定 cell recycle/rebind 后逻辑选区、手柄、复制顺序和视觉投影恢复，不再作为同帧时序的主要证明；源码字符串、mock scroll call 或 mounted owner 计数不能替代这些 oracle。模拟器事件日志只证明触感请求，实际手感与系统关闭触感后的静默必须在物理设备验证，缺少物理设备时记 `NOT_VERIFIED`。compiler 为其他 role 生成 tape 只是内容协议证据，不授权 UI marker 或回复 document。

ActionMode 菜单属于 Native canonical owner：全选后必须物理移除 Select all 并把可执行 Copy 留在一级菜单，端点缩回后 Select all 恢复；oracle 不得依赖系统是否提供浮动菜单返回箭头，也不得用菜单阶段状态机代替从逻辑范围直接派生。平台动作另以可控 Android seam 固定三类来源及顺序：首个 enabled classifier action、Copy、Share、Select all、其余 classifier actions、`PROCESS_TEXT` 依次使用 order 0/5/7/8/50+/100+，其中首个 classifier action 和 Copy 为 always，Share/Select all/`PROCESS_TEXT` 为 if-room，其余 classifier actions 为 overflow。标准 Share 必须验证 `ACTION_SEND`、`text/plain`、`EXTRA_TEXT` 与 chooser；超长选区按 100,000 UTF-16 字符 parcel-safe 裁剪且不劈 surrogate，成功 launch 结束选区，`ActivityNotFoundException`/`SecurityException` 保留选区。API 23+ `ACTION_PROCESS_TEXT` 必须按当前 query 结果和 AOSP same-package/exported/permission 规则生成显式 Component，验证 Manifest `<queries>`、resolver label、只读 extra 与点击时的当前 canonical 文本，不能断言设备一定存在「翻译」。classifier seam 必须分别证明 API 24–25 零 classifier 动作；API 26–27 fake legacy classification 只产生一个一级动作并复用 label/icon，点击优先调用 onClick listener、缺失时才启动 intent；API 28+ fake TextClassifier classification 不在主线程、只接收选区纯文本、首个/次级 enabled `RemoteAction` 排序正确。API 26+ 都必须证明选择变化、取消、destroy 或 generation 过期后不回填，点击只执行仍匹配 snapshot 的 legacy callback/intent 或 `PendingIntent`。测试还必须覆盖无 handler、重复 Component/PendingIntent identity、相同标题但不同身份、query/classifier/launch/send 失败；失败不得移除 Copy/Select all 或崩溃。Intent/classifier capture 还必须断言未携带 Cookie、凭据、来源 URL、HTML、marker、manifest、logical tape 或布局诊断；不以 JS mock、硬编码 Translate/第三方 Share 或真实外部数据披露代替该 owner。

### 发布版事后诊断

`MORE-02` 按可独立损坏的边界选择 owner：`src/platform/diagnostics/diagnostics.test.ts` 验证真实 schema、脱敏、Hermes 坐标、并发/复制 RequestInit 关联；gateway 与 `src/sources/forumSourceReadAttempt.test.ts` 验证真实 fallback/恢复门禁、证据结算和终态。不能只断言写入函数被调用；要读取序列化事件，确认阶段和值没有被变成 unknown/redacted、没有丢失关联，也没有泄露 fixture secret。

`src/platform/diagnostics/diagnosticFileStore.test.ts` 负责导出窗口、原 build/process 身份、超过旧 512 条 ring 的持久事件、损坏行、各来源覆盖状态/首尾时间、不可用/超时通道与临时分享文件清理；必须固定单个在写 batch、合并待写事件及合计 128 KiB 上限；超时只记录健康错误，底层调用未结算时不得启动下一批，导出仍按五秒 deadline 返回，并证明致命摘要保存尚未批量落盘的最后 JS 阶段。`src/platform/diagnostics/diagnosticRuntime.test.ts` 负责 RN listener、legacy ExceptionsManager/ErrorUtils 委派、重复安装和发布版 Promise 观察。模块内 `DiagnosticLogStoreTest` 用实际文件证明分段容量、过期、重启读取、健康计数跨进程保存和写失败；过期淘汰、读取失败和崩溃读取失败分别报告。`NetworkProxyRuntimeTest` 用真实 OkHttp/受控服务证明同一 session/trace 下多个 request 的关联与所有内部 header 出网前消失。mock Native module 不能证明真实进程退出后的存活，Native 致命路径最多等待 250 ms flush 仍需隔离真实进程证据。

`tests/tooling/diagnostic-symbols.test.ts` 固定 bootstrap 顺序、构建身份、exact source map/R8/APK 归档校验及 Hermes/RN parsed 坐标约定；Native 使用 SDK 官方 Retrace 的小型 fixture 验证类名、源码行、内联帧和错误 mapping 拒绝，CLI 另验证混合 build 只还原目标并准确报告跳过计数。真实 Retrace fixture 形成 tooling `UNIT_PASS`，对应源码文本检查只证明生成结构。`scripts/run-diagnostic-device-proof.mjs` 在唯一隔离 `WZ_ImageRuntime_Test_API35` 验证发布模式 Hermes 的 JS、renderer、Promise 和 Native 故障后重启读取、脱敏、前一进程归属及匹配 source map 还原。该 proof 使用开发签名、保留 R8/minify/resource shrink 和独立随机 buildId 的隔离构建，必须与恢复正常入口 APK 的 buildId 分离，并归档该 APK 实际生成的 source map/mapping；Java 栈用这份 mapping 经 SDK Retrace 还原。先前未混淆 proof 与 SDK fixture 的通过不能代表这条设备链；proof 仍不代替正式签名 APK、系统分享 UI、真实 ANR 或 OOM，故障注入不得在保留登录态设备运行。只有实际执行并取得相应产物才报告通过，未运行分支记 `NOT_VERIFIED`，缺少隔离环境记 `BLOCKED_BY_ENV`。

异常观察必须覆盖 Native listener 已存在但 `RN$useAlwaysAvailableJSErrorHandling` 不为 true 的真实 legacy 路径：`ExceptionsManager.handleException` 的直接 renderer 调用、该入口缺失时的 ErrorUtils fallback、重复安装和跨入口委托均保留原 this/参数/返回值/异常传播且不重复记录。四场景 proof 要求故障前尚未 finish 的 startup intent/apply 跨重启保留，JS appSessionId 与原会话对应，异常跨 JS/Native/crash 通道合并去重后恰好一份。JS/renderer proof 同时要求致命事件与归属于前一进程的有效系统退出记录；系统可能报告 `resource-limit` 等其他原因，不能把期望固定为 crash 或覆盖原始 exitReasonCode。Java 分支仍要求 crash，Promise 分支以三秒等待覆盖普通 Error 的两秒原生宽限并确认 rejection，再主动结束并要求 user-stopped；它证明 rejection 留存，不证明 Promise 会使 App 崩溃。

业务日志接线分别由已有 account/storage/update/notification/composer/selection/media/deep-link owner 验证失败后仍保留原产品状态、计数和最终 outcome；相同日志合同不再复制新测试树。新增 operation/枚举必须同时经过类型门禁与一个真实 producer 的序列化事件断言；保留运行时恶意输入测试，类型封闭不代替隐私白名单。

### 可视状态语料库

`tests/ui/visual/` 是以 `docs/product-map.md` 为覆盖索引的可重复视觉证据 owner。每个能力族在自己的 `scenarios/<family>/manifest.tsx` 声明稳定场景 ID、能力 ID 与 `rendered`、`device-only` 或 `non-visual` 分类；根 catalog 只负责聚合和渲染，不复制生产控件。

`rendered` 场景必须直接挂载生产 Screen/组件，每次渲染新建确定性虚构对象，远端地址只用 `.invalid`，外部 I/O 与写操作回调保持无副作用；`device-only` 记录原生系统面、手势、键盘或真实生命周期边界；`non-visual` 记录没有独立 App 视觉面的能力及其用户可见承载面。双主题 RNTL 挂载只形成 `UI_PASS`，证明场景可渲染；样式问题必须在匹配 Android 构建上获得运行证据，mock 场景不能形成 `LIVE_PASS`。

视觉入口只存在于 `dev/visual-gallery/`，生产入口和 `src/` 不得导入它或 `tests/ui/visual/`。场景不得用真实点赞、收藏、投票、上传、登录或故障注入制造状态，设备走查仍遵守本文件的只读授权边界。

### 首页手势完整回归

修改首页分页、列表滚动、刷新接线，或升级/修改 Pager、RNGH、FlashList、React Native 相关原生补丁时，必须在匹配 APK 上执行完整手势回归，不以单个复现动作或 UI 单测代替。沿用 `docs/operator-runbook.md` 的固定命令和 `LIVE-FEED-01`，不每次另写临时脚本：运行 tracked 首页 Replay、`scripts/check-feed-gestures.mjs` 的 72 组连续手势、独立惯性与双向 CANCEL/UP oracle，以及 Feed/通知刷新取消与再次刷新；补齐首尾边界、点选、分类栏、刷新交叉和页面返回。

每项同时核对页面完整归位、来源与二级栏一致，以及应滚动时内容实际移动。完整横滑与短快滑必须断言来源实际切换，不能只查页面没有卡在半屏；短快滑分别在静止、惯性中和连续交接后执行，交接后另测带上下偏移的短横滑仍能切页，并测短慢拖自然结算与轻点停止惯性且不打开帖子。按用例保存结果、APK SHA-256、设备和输入方式；来源验证页、前置数据不足或并发触摸视为无效测试，不能计入通过。未执行的项目明确记 `NOT_VERIFIED`；模拟器自动注入不替代手机触感或实体鼠标操作。新的有效复现先补入现有 owner，再验证修复前失败、修复后通过。

## 三、测试设计

- 标题描述当前行为，不写 `[REG-*]`、修复过程、实现函数名或「should work」。
- 通过 public interface、可访问文案、role/label、稳定 `testID`、持久化结果或请求契约断言；除非内部 seam 本身就是安全、协议或性能合同，不读取私有状态。
- mock 只放在真实外部边界：网络、时间、随机数、文件系统、平台 API 和昂贵第三方组件。不要 mock 被测业务函数，也不要复制 production 算法计算 expected value。
- call count、精确样式、对象 identity 和时序只有在 single-flight、安全、无障碍、用户可见布局或协议本身要求时才是合同。
- 一个测试只验证一个主要失败原因。相同状态机的等价输入适合参数化，不用一个 300 行场景绑定多个无关行为。
- 异步更新必须在测试生命周期内等待完成或显式取消；React 更新使用 `act`/`waitFor`，不得屏蔽 warning。fake timer、mock 实现、module cache、DOM/React root 和全局变量在每例结束后恢复。
- 普通用例的数据 identity 默认逐测试唯一；只有验证缓存复用、single-flight 或同会话连续行为时才显式共享。不得为测试向 production 暴露 reset API。
- 测试 fixture 使用最小语义数据，但必须保留被测边界需要的合法身份、权限、生命周期和错误形状；不要用类型断言掩盖无效 fixture。

### 阅读与性能专项 oracle

楼层导航的 canonical oracle 必须经过真实编译与 renderer 点击：普通 mention 进入 User，V2EX 明确楼层携带作者约束，代码/数学/已有链接和解析 fallback 不信任伪造内部属性。adapter 测同 ID 冲突不被去重掩盖，包括初始/cursor 的已加载捷径：正文可读但带冲突标记的回复不能精确定位，完全一致重复仍去重；作者与楼层反例分别只改变一个字段。controller 测未加载目标的错误作者、重复楼层、缺失与迟到结果不替换窗口，已加载可信目标零请求；列表测 NodeSeek 本人权限投影克隆后仍能定位。其他 adapter 已确认 partial target 的原契约保留，不能为统一谓词改写既有测试预期。

双向续读不能只检查 `maintainVisibleContentPosition` 配置值：`topic-reply-filters` 使用实际安装的 FlashList recycler controller，按线性非重叠布局、offset 与 viewport 派生实际可见范围，证明控制行与回复同屏时的最后一次前插、新插入行自身晚测高及多轮异步高度变化均保持内容的屏幕坐标。覆盖原生像素取整、超过旧 100 ms 窗口的迟到确认、拖动打断惯性、过期结束事件、显式/动画/零距离命令、底部 padding 与数据行上界不同；真实滚动接管后不能继续维护旧内容。正文优先、仅控制行可见时清旧锚点、默认选择策略与有界候选读取仍保留，不能直接让 mock 返回预设锚点。匹配 APK 的设备另测四站正/倒序、主动定位、上下续读及失败重试，记录同一回复坐标；JS hook 与桌面工作量证明不冒充设备像素或帧率证据。返回边界由 `app-navigator` 与真实 `TopicSelectionSurface` 分别证明优先级、旧 revision、停用/重建与正文零额外提交；Native instrumentation 证明活动事件只报告所属 document 且重复取消不重复发事件。宽度由实际 ancestor→HTML/code consumer 证明，不在 mock 中复算期待布局。共享 NS/linux.do 表情用真实 Runtime DOM 触发失败、重试、旧回调和重新进入，核对零误插入、成功节点与滚动位置保留。

自动续读独立于按钮测试：四站分别覆盖正/倒序的拖动、上一窗口预取、下端触边、重复 viewability 与同手势不重复请求，静置不凭空发起加载；还要先让主动定位消费一次下端通知，再仅发送真实拖动事件，证明无需新的触边回调仍能续读。设备必须实际执行不点按钮的上下滑动。楼层定位与排序后定位使用真实 Topic 产生的命令进入实际 FlashList controller，断言短行→暖态超高回复的 header 在 viewport 内，并覆盖首次布局未就绪、最终命令后晚测高、布局提交与 Native 确认的两种先后次序，不能仅检查 `viewPosition` 常量。异步投影必须真正排队到下一次 layout commit，验证新命令/拖动取消旧回调、惯性不能抢占，以及目标 key 移位/删除；同步 no-op manager 不替代这组 oracle。

`topic-image-loading` 使用实际安装的 FlashList `useRecyclingState/useLayoutState`，只 mock Native 列表布局通知边界，覆盖同 URL 双实例先后加载时各自需要的布局通知以及暖态零通知。`topic-reply-filters` 另覆盖拖动开始后、首个 `onScroll` 前的缓存前插；命令被旧 Native 上界截短与新内容尺寸两种事件顺序；动画命令重试不能提前交出目标。普通校正的几何 oracle 必须先提交对应内容尺寸，按 Android content `onLayoutChange` 夹紧已有 offset，再应用 Native MVCP 并再次处理边界，之后交付可迟到的 offset 确认；不能把两次夹紧简化成一次，也不得拆开同批 height/anchor 制造 idle 旧尺寸截断或直接写 manager offset 冒充 ACK。多轮测高、旧确认、零位移收缩后再次增高、像素取整与用户接管分别保留；零 offset 收缩不等于尾窗底部收缩，两者不能互作证据。尺寸回调不得额外投递 idle 滚动。自动贴底消费者在未确认校正期间不得启动动画。负向控制分别删除基线建立、旧确认保护、零位移判断或动画保护后必须转红；仅断言 props 接线不替代坐标与调用次数。

规模测量包含编辑器完整解析/重复快照、NS 页签派生、妖火空边界、候选评论查找和日期排序；算法工作量与运行时间分开报告。V2EX 引用按父节点线性重建，点击用户候选最多读取 32 条，不随回复总量增长；唯一目标单次扫描，不建立额外全局索引。NS 的 JS 派生、Native 选择文档更新和文本布局不是同一指标，桌面耗时不能证明手机帧率。缓存命中仍须覆盖身份和投票 sidecar 变化；连续代码单一 owner 与完整复制不得为通用行预算让步。

性能合同以语义输入、工作量和提交次数为 oracle：相同 viewability 不提交 state，离窗注册不提交无变化 idle，同一 pages 在 loading/error 变化时不重新合并，User 单 lane 更新不重算另一 lane，空 ReaderData 事务不持久化；媒体 callback 必须覆盖同 key 重注册、回收 A→B→A 与旧 attempt，通知覆盖慢 worker 下来源合并、一次补跑和身份/权限/停用/卸载失效。对比性能必须保留修改前源码基线，在同一 runtime、同一 workload 预热后多轮取中位数，分别记录计算与渲染提交；不加入墙钟阈值。Native、模拟器和 Release 性能证据各自独立，不能用耗时改善或局部绿灯代替缺失证据。

纯算法优化必须以固定输入对照原输出，包括顺序、重复项、权限、错误和删除保护；已授权的 Bug 修正单列，不能伪称等价。随机差分需保存 seed 与输入范围，不宣称穷尽证明。Search 覆盖较新/较旧预览都不截断已有分页，以及首屏重复项的权限合并；User 两 lane 必须并发并分别先完成，不能用顺序请求代替。通知调度组合 owner 运行真实 worker/store，只 mock 外部读取与 Native acknowledgement，证明两来源慢投递期间的重复触发有界合并，未读总数相同但消息 ID 替换仍会投递。NS 内容 owner 使用不同主楼/回复全文，覆盖空/部分/完整终端的 bridge/rendered 链路、两侧身份歧义与块数量不符；无源码的无 class xterm 行也须保持完整文本、ANSI 和邻接内容。

原生媒体循环由 `dev/media-pressure-proof` 与 `scripts/run-media-pressure-device-proof.mjs` 取证：本地合成音视频经过生产组件、共享播放器与 Native 解码；全屏首个 ownership 事件后立即回收内联行，必须仍能打开实际全屏 Activity、保持独立 player 并正常退出释放。首个事件不等于 Activity 已展示，须同时取得真实全屏控件和后续 Native 回执。fixture 保留生产页面的全屏播放例外；回收后持有至少 600 ms，起点须真实播放，同一 Native player 的位置前进至少 0.3 秒，并人工核对持有前后两张全屏图。退出生命周期允许正常暂停，不以退出事件时 playing=false 判失败。独立 Activity 暂停 RN timer 时，fixture 由 Native 事件和 React 提交唤醒，不用固定延时躲开回收竞态。系统 HOME 与恢复须由设备操作发生；播放器释放调用和 JS 注册归零只证明相应生命周期，不能替代 native heap、实际音频输出或每帧连续性证据。命令、构建和设备隔离见 operator runbook。

## 四、随机顺序与可重放性

`npm test` 使用 Vitest shuffled sequence；`npm run test:ui` 使用 Jest randomize 并输出 seed；`npm run verify` 自然继承两者。随机顺序是常规隔离门禁，不再称为「确定性门禁」。

失败时先复制输出 seed 重放同一文件或套件：Vitest 使用 `--sequence.shuffle --sequence.seed=<seed>`，Jest 使用 `--randomize --seed=<seed> --showSeed`。固定 seed 转绿后还必须运行一次默认随机 seed；只在固定顺序通过不能证明隔离完成。

顺序失败优先修复 owner 生命周期：每例重建或清空共享状态，等待异步任务，回收 root/DOM/timer/mock。不要通过固定排序、全局重试、扩大 timeout、吞 warning 或 production reset API 隐藏污染。

## 五、TDD 与历史事故

产品 Bug 修复遵循 Red → Green → Refactor：先让最低可靠行为测试在修复前因正确原因失败，再做最小根因改动，最后在全绿下合并重复 owner。测试如果在未修复代码上已经通过，不能证明该 Bug。

Jest 的 `it.failing`/`test.failing` 与 Vitest 的 `it.fails`/`test.fails` 只用于已确认、当前未获准修复的产品缺陷，并必须满足：

- 标题使用静态字符串，且只引用一个 canonical REG；
- 对应 corpus 条目存在且状态为 `OPEN`；
- 用例固定真实失败 oracle，不把 expected-failure 计为产品 `UNIT_PASS` / `UI_PASS`；
- 产品修复后改为行为标题的普通测试；达到该事故的关闭条件后再把 corpus 状态更新为 `RESOLVED`。条目要求的设备或 Live 验收尚未完成时，保留其未闭合状态与证据边界。

已修复事故不要求专属测试永久存在。若当前行为已由更强 owner 覆盖，可让多个历史 REG 指向该 owner；需求被取代则标记 `SUPERSEDED`。不得删除历史 ID，也不得把历史标题继续堆进通过测试。

## 六、范围与授权

产品/runtime 改动在开始前从 `docs/product-map.md` 选择受影响 capability ID，并沿共享 seam 展开 sibling 入口。纯测试、文档或治理改动记录 evidence owner，不强行选择产品 capability。

测试和验收默认只读，不授权真实发帖、回复、编辑、删除、点赞、投票、收藏切换、清 Cookie、清 App 数据、卸载或模拟器重置。需要真实写入时必须逐项取得用户明确授权，并绑定对象、动作和停止条件。

设备验证只使用与当前 revision、App version/versionCode、APK SHA、设备和会话匹配的证据。覆盖安装、`firstInstallTime`、主登录态 AVD、Replay scratch 与异常冻结步骤全部遵循 `docs/operator-runbook.md`；不得用桌面浏览器、未登录页面或相似对象冒充 App 内原站事实。

`npm run test:instrumented:forum-selection` 只允许在独立 `WZ_ForumSelection_Test_API35` AVD 执行；runner 必须解析唯一匹配 serial 并只用该值设置 Gradle 的 `ANDROID_SERIAL`。禁止把主登录态、Smoke 或普通 Replay AVD 作为替代，也禁止在这些保留数据设备上直接执行 `connectedDebugAndroidTest`。独立 AVD 不可用时记录 `BLOCKED_BY_ENV`，不得通过卸载、清数据或重置主 AVD 绕过隔离。

## 七、按改动类型验证

| 改动类型 | 最低要求 |
| --- | --- |
| 纯文档/注释 | 内容、引用、一致性检查，`npm run test:docs`、`npm run check:docs`、`git diff --check`；不强制无关 typecheck。 |
| 仅测试/harness | 受影响测试先按复现 seed，再按默认随机 seed；测试代码涉及类型时运行 `npm run typecheck`。 |
| 确定性 runtime 逻辑 | 最小 Red/Green owner、相关 Vitest、`npm run typecheck`；共享 seam 展开相关 sibling。 |
| React Native 渲染/交互 | 相关 Vitest/RNTL、`npm run typecheck`；用户流程或真实布局风险再做匹配 APK 的只读设备验收。 |
| Android 主楼正文连续选择 | compiler Vitest、`topic-rich-text-selection` 与 `topic-components` RNTL、`npm run test:native:forum-selection`、独立 `WZ_ForumSelection_Test_API35` 上的 `npm run test:instrumented:forum-selection`；RNTL 必须固定 visible opening→manifest→row marker、opening `selectable=false` 及回复/评论/采纳答案零 marker、整条长按复制，instrumentation 必须固定 marker-only 身份、瞬态映射不取消、普通链接 tap 不被吞、静止长按唯一入口、双击零原生选区、静止短按取消/滚动保留、生产等价 ScrollView 同 draw 的 TextView-local 高亮与同 ViewRoot viewport/surface handle wrapper 像素/AOSP 几何 oracle、TextView/marked-row 遮挡 falsifier、至少 `48dp` 命中与无跳变抓取、真实端点变化才请求 `TEXT_HANDLE_MOVE`、RecyclerView 回收重绑后的手柄/复制/投影恢复，以及 Copy/Select all 与 Share/`PROCESS_TEXT`/TextClassifier 三类平台动作的 API、排序、隐私和 snapshot/generation 异步 oracle；真实来源再按 runbook 核对同页原生标题对照、主楼复制顺序、跨回收窗口、快速往返逐帧贴合、负向 marker 边界、预算/PSS 和 `0px` bounds/baseline，物理设备缺失时实际触感标 `NOT_VERIFIED`，外部动作执行未经逐项授权时标 `NOT_VERIFIED`。 |
| WebView、登录态、真实来源或原生生命周期 | 静态/单元/UI owner 加 targeted build；按 runbook 做身份匹配的 APK sanity、Replay 或 Live，未授权分支明确 `NOT_VERIFIED`。 |
| 版本、签名或原生配置的普通开发改动 | 相关 tooling test、fresh prebuild/compile 或 targeted build；不运行要求 clean tree 的正式 release。 |
| 用户明确要求正式发布 | 默认按 runbook 运行 `npm run release:android` 及其完整门禁；当次明确授权特殊发布时，先完成受影响能力及共享 seam 的定向回归，再按 runbook 的显式选项发布并记录证据范围。 |

多个入口受影响时逐类报告，不能用一个局部绿灯代表全部。相关验证失败且仍有安全、可证伪、在授权范围内的修复路径时继续修复；计划外既有产品 Bug 则停在证据和授权边界。

Composer 键盘证据分层：`tests/native/ComposerWebViewInsetsTest.kt` 验证原生 Insets 分发；`tests/native/ComposerKeyboardTest.kt` 验证 IME 动画目标与当前帧，以及中断动画后退订/重订时归零旧计数、按真实窗口恢复隐藏或显示状态、旧 callback 不改新周期、漏 prepare 的运行中动画与无配对 end。`tests/tooling/reanimated-settled-props.test.ts` 仅拥有嵌套 host 的同步 GC 生命周期。新版 WebView、外部选图 Activity 暂停/恢复与 settledProps 的 C++ 应用结果必须用匹配构建同设备录屏确认，不能用上述局部测试代替。

共享底部原生工具栏的 canonical UI owner 为 `tests/ui/topic/composer-toolbar.test.tsx`，验证各站/模式/发帖与回复入口、当前选中状态、禁用与上传忙碌、结束后显式 busy=false、普通点击静默、可访问命中区及动作映射；菜单测量只断言当前 viewport 实例，覆盖旧测量、上下文变化及卸载，不以全局共享 View mock 的调用总数判断本组件；`src/ui/composer/structuredComposerBridge.test.ts` 固定 toolbar-action/TOOLBAR_STATE 的严格协议及文档 epoch。`src/ui/composer/editorRuntime.test.ts` 验证常用操作只由原生工具栏提供、runtime 不渲染重复的 HTML 底栏而继续保留格式 builder 工具，原生命令复用原选区和既有编辑/上传动作，拒绝旧 epoch、只读或重复上传动作；`tests/ui/topic/structured-reply-composer.test.tsx` 固定当前 epoch 状态接收、生命周期禁用和命令接线，继续拥有图片交接与迟到 ACK。原生工具栏不会把 runtime 的格式或上传责任迁到 UI mock。设备须分别验半屏/全屏收键盘、格式/链接等表单进出、有无键盘选图去返程、已有正文/图片保留，并核工具栏与原生 footer 是否分离；CSS 或 software 实验失败和旧包样本通过不能替代新共享入口的匹配 APK 证据。

固定 Composer 的直接几何 owner 为 `tests/ui/topic/composer-keyboard-viewport.test.tsx`：原始 IME SharedValue 变化后，在任何 reaction 或 JS layout 回调尚未运行时，drawing style 就须得到对应 viewport、面板位置与 safe-area padding；另模拟 transform 已更新而原生面板仍保留上一帧高度，核对半屏/全屏 footer 仍在 IME 与导航安全区之上，不能只用同一对象的新 height 与新 transform 自证原子性。半屏未受可用高度限制时，`height - paddingBottom` 保持不变，避免在 IME 退场尾部挤压 WebView 工具栏；半屏/全屏均须覆盖原始 IME 高度进入 safe inset 以下、输入法不再绘制导航区的尾段，面板仍保持完整 safe padding 与自己的背景，footer 坐标不变，原始高度未归零不能放行 picker。同时固定键盘订阅到关闭完成、正文跨订阅保持挂载、迟到关闭不影响重开、半屏/全屏与 Back 次序及交接等待。该 oracle 证明应用侧没有用上一轮 mapper 的几何，不证明原生输入到达时间、屏幕实际提交延迟或真实键盘每帧贴合；锚底的设备验收还须核 header/正文是否反向修正，底边不露灰不能覆盖顶部跳位。

共享工具面板交接沿用既有 owner：Bridge schema 接受 `prepare-panel`；runtime 在 rich/source 的待确认阶段不 blur 或展开，并在请求前同步发布包含 pending 的 `PANEL_CHANGED.open=true`，保持旧 `expanded` 状态；成功确认到实际面板之间没有 open=false 空档，失败或取消释放所属占用，旧回执不能释放新请求。原生工具栏和 HTML 面板内部工具共用该路径；`closeBuilder`、页面 blur、预览、模式切换、只读恢复及 INIT/DESTROY 取消旧请求。Structured UI 核对宿主实际等待键盘交接、拒绝或缺少能力不回成功，以及关闭/重开、只读后恢复不能放行迟到确认。Topic UI 核对交接间隙标题元数据保持折叠，沿用已有 `tests/ui/topic-composer/create-topic-screen.test.tsx` owner。匹配设备另验链接、格式、表情等入口的完整去返程，不能把图片八格通过视为工具表单也通过。

私信图片 proof fixture 的凭据与 HTTP 隔离由 `tests/ui/notifications/notifications-route.test.tsx` 沿真实 `MessageSubmissionFixture → NotificationDetailRoute` 验证：使用合成 NodeImage key，实际进入 picker，再由现有隔离 transport mock 上传并插入草稿；取消保留草稿，真实网络及私信发送均为零。因 fixture 缺少凭据而在 picker 前退出的录像不能计为选择器去返程通过；该 UI oracle 也不替代匹配 APK 的实际选择器和像素验收。

共享原生键盘交接由 `tests/native/ComposerKeyboardHostTest.kt` 验证：在真实 attached RN 容器和焦点子输入框上，驱动平台 Insets 控制回调，核对完整 Back 按键对、重复 Back 不重开 IME、当前 Insets 起点、控制完成回执、请求取消、焦点与窗口归属、disable/detach、零动画缩放及旧 Android 回退。该 owner 另固定 API 30+ Modal 本地 Insets：prepare 后的目标隐藏布局不得提前发布零高度，progress 与最后一个动画结束按实际高度更新；使用真实 root/Host 屏幕矩形扣除已完成的布局避让；普通 Host、关闭跟踪、禁用及 detach 不继续发送逐帧值，旧 API 不启用此事件。`tests/ui/topic/composer-keyboard-host.test.tsx` 拥有命令/回执、Abort 接线，以及本地 native event → UI worklet padding、提前 `keyboardDidHide` 不清 padding 或重挂输入、API 30 以下 KAV 回退；`tests/ui/topic/composer-keyboard-handoff.test.tsx` 拥有原生成功后才开始现有两帧 viewport 等待及后台/超时取消。`src/ui/composer/editorRuntime.test.ts` 用实际 MutationObserver 与 DOM Selection 写入观测，验证富文本/源码先保留不可见且可映射的上传锚点；交接前的图片请求动作只允许当前编辑根节点的 `virtualkeyboardpolicy` 属性变化，不改内容或 DOM Selection，不提前调用 focus/blur。原生 toolbar-action 经异步 Bridge 进入上传 owner，临时 manual 在 runtime 发送宿主请求前生效。激活时 blur 仍处于 manual，随后恢复原策略、安装占位并 ACK。源码通过 CodeMirror 的公开 contentAttributes 随事务持有该属性，不能放宽 DOM oracle 来容纳直接属性写入引发的额外 style 变更。取消保留正文/选区，原属性缺失或显式值均原样恢复；finish、INIT、DESTROY、unmount 释放策略，旧 `id/epoch` 回执不能激活新请求或恢复它的策略，直接 visible begin 不创建手势策略。`tests/ui/topic/structured-reply-composer.test.tsx` 拥有原生交接、激活 ACK、picker 的顺序，以及错误或迟到 ACK、超时清理和两个等待阶段的文档/生命周期失效；还须覆盖关闭、只读、忙碌及回复/新帖后台状态短暂变化后恢复同 intent/epoch，旧交接仍作废且新请求可成功。已启动 picker 的正常后台/上传忙碌须保留合法结果，Topic 的后台监听不接管草稿 snapshot owner。设备另核系统 Back 已收键盘但 DOM 仍有焦点时点图片，不以已由前次 picker blur 的无键盘样本代替；同时核实际系统手势 Back、原生标题、独立 Modal 窗口和快速重开。Modal 须分别核说明输入 Back 与选文件的完整去程，不能用 picker 返程保留内容证明面板未在 IME 退完前落底。这些 DOM/UI oracle 证明应用交接顺序，fake controller 的测试通过不能证明键盘 Surface 保留或 OEM 回退行为。

编辑器返回预热的 canonical owner 为 `tests/native/ComposerWebViewPrewarmTest.kt`：在真实 Activity 内、具有有效尺寸的实际 `RNCWebView` 上驱动窗口生命周期，只控制硬件层构建及 visual callback 的完成；覆盖默认关闭、首次可见、返回等待、关闭开关、再次隐藏、detach/destroy、迟到回调、失败释放、原 layer 恢复，以及真实 `ReactViewGroup` 下 GONE 祖先和整个屏幕外 translate 后回屏的可见范围。实际 GPU 资源重建、alpha 或其他视图遮挡不在这些 Robolectric 证据范围。`tests/ui/topic/structured-reply-composer.test.tsx` 固定编辑器恒定 opt-in，即使 `visible=false` 仍保留身份标记；`tests/tooling/native-test-plan.test.ts` 固定 native 报告 owner 和受影响编辑器的任务路由。同一有效 harness 的原行为 red 与修后 green 必须分开留存。设备须用最终无探针构建分别验证 Photos/Browse、有/无实际停靠键盘、取消/成功的八条路径，并独立检查 Topic 附件面板下仍可见的正文与私信入口；分别报告去程与返程，最终视觉验收不与构建或测试并行。返回无白帧不能覆盖收键盘末端的灰色间距，生命周期测试不能替代逐帧绘制或真机证据。

系统选图导入与 IO 的 canonical owner 为 `tests/native/DocumentPickerThreadingTest.kt`：通过实际安装的 Expo `ModuleHolder` 捕获真正启动的 Intent，固定缓存图片单/多选 `GET_CONTENT` 与保留原 URI 图片、通配附件、JSON 混合类型 `OPEN_DOCUMENT` 的分流，以及 Openable、MIME、多选和不另设数量上限；再发送 Activity result，分别阻塞真实 `ContentProvider` 元数据查询和缓存打开，验证主 Looper 心跳可继续执行、复制未完成不结算，以及取消、失败、多选和销毁后的单次结算。该 owner 经 `tests/native/composer-keyboard.gradle` 加入 App JVM 测试，`scripts/native-test-plan.mjs` 对应预期报告；它证明共享原生线程和结果契约，不替代新帖/编辑、回复、私信、备份导入四类入口的逐项设备验证，也不证明 WebView 返回无白帧；系统 Photos 与 Browse 文件路线须分开验收，临时直接 Photo Picker 探针不能替代正式 `GET_CONTENT` 构建。

## 八、交付记录

交付至少包含：

- 基线 revision/dirty 状态与本次 evidence owner 或 capability；
- 实际运行的命令、随机 seed、通过/失败/未验证结果；
- 多入口影响面和每类证据状态；
- expected-failure、warning、环境阻碍和未验证范围；
- 测试治理任务的前后文件数、实际用例数、测试 LOC、同 seed 时长，以及六类处置数量；
- 本任务进程与 scratch 是否回到基线。

不使用覆盖率、mutation、LOC、测试数量或文档长度作为门禁。只有测试证明不了关键行为时才增加工具，不为「治理」创建新的长期框架。


### 设备 proof 与视觉结果结算

`WRITE-07` 最低证据按 owner 拆分：domain/source Vitest 固定动态校验与三站真实请求构造、正负成功判据；SQLite 与附件测试固定身份/revision/未知 attempt/文件归属；`tests/ui/topic-composer/` 固定切站、快照、提交前门禁、单次发布与失败保稿。隔离 `dev/composer-proof` 的 `topic-*` 场景必须挂载真实 `TopicComposerRoute`、controller、editor 和 SQLite，仅在 Fetcher 边界返回合成 HTTP 响应。每次生成独立合成身份，未匹配网络禁止透传；receipt 同时验证 source、单次 dispatch、durable attempt、当前稿与另两站稿及 route，切站/重启场景必须零写请求。YH 五类检查实际表单路径与重复字段数量，文件只用隔离目录的小型合成文件。原生输入与重启证据不能由 RNTL 代替，Mock proof 不能标作原站 `LIVE_PASS`。

`tests/tooling/review-proof-checkpoint.test.ts` 是隔离备份/恢复的唯一 tooling owner。runner 在固定隔离 AVD 取得 OS 排他租约，安装后再次停止 App，备份 Reader、AsyncStorage 与 WAL/SHM 的六个固定文件；校验隔离 owner、安装身份、存在性、字节哈希及独立 SQLite 逻辑内容。业务失败、回放失败、超时或 App 中断仍由 runner 恢复，业务与恢复分别记录，双方通过才整体通过。旧 `running` 必须阻断新运行；只有 `restoring` 且当前文件匹配已记录的原始或待恢复哈希、安装身份一致时才允许显式续接。App 不以固定等待后自行还原作为完成证明。

无效导入必须是合法 JSON 的错误版本，回放观察生产代码实际发出的格式不兼容提示；proof 壳只把该短 Toast 留存为可观察文本，结束断言还要求该回调恰好一次。取消文件选择或漏掉回调不能通过。通知 proof 的计数称为「对账请求次数」，实际摘要读取与持久化仍归既有 runtime owner。

视觉 catalog 测试独自比较实际能力集合与 product map 的非 RELEASE 集合，另保留场景 ID 唯一、分类及双主题挂载。静态守卫扫描视觉目录全部非测试运行源码及 helper；它只是直接 I/O 守卫，不能宣称完整网络隔离。`NativeModules` 测试必须恢复原属性描述符，原来不存在则删除。图片尺寸、顺序与预览仍由原 owner 证明，不保留只重复编译同一输入的伪「动态加载」测试。`verify` 在 `check:unused` 执行一次严格类型检查，独立 `typecheck` 入口保留。

`tests/tooling/visual-device.test.ts` 拥有视觉结果判定合同，实际像素 oracle 由 `npm run test:visual:device` 调用 agent-device CLI。首批六场景双主题及两帧 140% 字号共 14 帧，标准密度；专用 API35、1080×2400、420dpi、系统字号 1、en-US，记录系统镜像/工具/APK/代码身份。基准须同构建连续三次像素一致并审阅后显式批准；缺基准、环境不符、尺寸变化、基准被改写或非零差异均失败。颜色阈值固定 0.1，不自动放宽；截图差异是待分析证据，不自动宣称产品 Bug。Gallery 仅证明模拟器上生产组件的固定视觉状态，不替代业务 E2E、真实来源或设备生命周期。


## 审查修复的行为 owner

详情跨后台的 deadline 证据分层：底层 fetch 测试保留；`tests/ui/topic/topic-route-verification.test.tsx` 负责真实 Route→Query→gateway 组合与验证恢复授权，`tests/ui/topic/topic-session-controller.test.tsx` 负责取消恢复/真实失败终态和冻结历史基线。缺失历史、有效 0 与未知 watermark 必须分开造样本，排序/过滤/窗口变化不改变 New 边界。

通知 parser 必须断言 complete/partial/invalid，worker 组合必须调用真实 notificationStore 并同时核对 ledger、摘要和 native sink；不得在测试 helper 复制生产提交算法。至少覆盖坏扫描→首次可信旧数据静默→真正新增三轮、第二页失败、合法空页、重复分页和单来源失败；前台另覆盖 partial 展示、invalid 旧可信缓存和切账号隔离。

投票 journal 的并发、重开、迁移中断、超过 32 条与已知结果单调性归数据库 owner；UI 只保留实际创建前 claim、已知复用、未知/损坏阻断、最终发送守卫及账号切换。SQLite Node 替身只替换驱动边界，Android expo-sqlite 重开仍需隔离设备证据。

图片补丁的行为由真实 Native View 时序与事件证明：A resize 排队后重绑 B/回收/销毁，再执行旧任务；同时检查请求次数、当前显示与迟到事件。移除关键 guard 后必须失败，字符串存在性不算行为证据。patch 适用性、原生测试新鲜非零 XML 和 Reanimated 实际状态测试继续保留。系统备份须读回并重新导入目标文档；诊断分享用延迟接收方核对完整字节；图片流式保存测 1/25/100 MiB 内容 hash、取消/磁盘失败清理与内存曲线。
