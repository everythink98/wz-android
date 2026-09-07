# 测试标准

## 文档职责

本文件只定义测试 owner、证据层、隔离规则、授权边界和不同改动的验证强度。当前产品行为与 canonical evidence 在 `docs/product-map.md`；历史事故在 `docs/regression-corpus.md`；设备、Replay、Smoke 和发布命令在 `docs/operator-runbook.md`；真实 App 场景在 `tests/live/agent-live.md`。

测试证明当前契约，REG 记录历史，两者不再一一绑定。测试数量、覆盖率和历史事故数量都不是目标；目标是用最少且可靠的 owner 阻止当前行为倒退。

## 一、Canonical owner 模型

一个行为格由以下五项定义：

`capability + 前置状态 + 用户动作 + 可观察结果 + production seam`

同一行为格只保留一个最低可靠层 owner。只有跨层 wiring 可以独立损坏时，才额外保留一个 wiring test；不得因为一个 Bug 曾经过多个文件，就在每层永久复制同一预期。

审计测试时，每个既有用例必须归入一类：

| 处置 | 含义 |
| --- | --- |
| `KEEP_OWNER` | 当前行为唯一或最低可靠的证明。 |
| `MERGE_INTO` | 行为已被更强 owner 完整覆盖，迁入后删除重复用例。 |
| `REPLACE_AT_SEAM` | 依赖内部实现，改到稳定接口或真实 production seam。 |
| `DELETE` | 需求已取代、重复、无失败信号，或只锁无意义实现细节。 |
| `FIX_ISOLATION` | 共享 mock、cache、timer、DOM、module 或异步任务污染其他用例。 |
| `OPEN_BUG` | 当前产品确有缺陷；只保留最小 expected-failure，不修改未授权产品行为。 |

同一行为格出现不同预期时，按“用户最新要求 → 当前运行事实 → product map → 历史事故”裁决。仍不能裁决则在 corpus 标记 `EVIDENCE_GAP`，不得让两套相反预期同时通过。

删除或合并高风险 owner 前做一次临时负向控制：破坏其 production seam 后，canonical test 必须转红；若仍为绿，先补强 owner。负向控制只用于证明测试灵敏度，不进入长期产品代码。

账号 fixture 经真实 observation → Account snapshot → view model 投影，合法登录显式提供用户身份，不用测试工厂放行未知身份。选择 wiring 由 `tests/ui/topic/topic-rich-text-selection.test.tsx` 挂载真实 `TopicContentList → TopicSelectionSurface → TopicContentBlock`，保留该业务链，仅隔离平台与昂贵第三方边界；全树 marker 必须与 manifest 一一相等，并检查实际代码文字的 selectable。查询清理归 integration owner，Callout 初始化归真实 `forum-callout` UI owner；bootstrap 检查执行调用顺序，缺失或颠倒初始化都必须失败。

## 二、证据层

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

按“最低但可靠”选择证据：纯数据和确定性协议优先 Vitest；必须经过 React state、布局投影或用户交互才可观察的行为使用 RNTL；真实 Android 生命周期、登录态、WebView、原站动态数据或原生手势才进入设备/Live。源码字符串、App 能启动、snapshot 或 mock 调用本身不能替代用户可见 oracle。

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

ActionMode 菜单属于 Native canonical owner：全选后必须物理移除 Select all 并把可执行 Copy 留在一级菜单，端点缩回后 Select all 恢复；oracle 不得依赖系统是否提供浮动菜单返回箭头，也不得用菜单阶段状态机代替从逻辑范围直接派生。平台动作另以可控 Android seam 固定三类来源及顺序：首个 enabled classifier action、Copy、Share、Select all、其余 classifier actions、`PROCESS_TEXT` 依次使用 order 0/5/7/8/50+/100+，其中首个 classifier action 和 Copy 为 always，Share/Select all/`PROCESS_TEXT` 为 if-room，其余 classifier actions 为 overflow。标准 Share 必须验证 `ACTION_SEND`、`text/plain`、`EXTRA_TEXT` 与 chooser；超长选区按 100,000 UTF-16 字符 parcel-safe 裁剪且不劈 surrogate，成功 launch 结束选区，`ActivityNotFoundException`/`SecurityException` 保留选区。API 23+ `ACTION_PROCESS_TEXT` 必须按当前 query 结果和 AOSP same-package/exported/permission 规则生成显式 Component，验证 Manifest `<queries>`、resolver label、只读 extra 与点击时的当前 canonical 文本，不能断言设备一定存在“翻译”。classifier seam 必须分别证明 API 24–25 零 classifier 动作；API 26–27 fake legacy classification 只产生一个一级动作并复用 label/icon，点击优先调用 onClick listener、缺失时才启动 intent；API 28+ fake TextClassifier classification 不在主线程、只接收选区纯文本、首个/次级 enabled `RemoteAction` 排序正确。API 26+ 都必须证明选择变化、取消、destroy 或 generation 过期后不回填，点击只执行仍匹配 snapshot 的 legacy callback/intent 或 `PendingIntent`。测试还必须覆盖无 handler、重复 Component/PendingIntent identity、相同标题但不同身份、query/classifier/launch/send 失败；失败不得移除 Copy/Select all 或崩溃。Intent/classifier capture 还必须断言未携带 Cookie、凭据、来源 URL、HTML、marker、manifest、logical tape 或布局诊断；不以 JS mock、硬编码 Translate/第三方 Share 或真实外部数据披露代替该 owner。

### 可视状态语料库

`tests/ui/visual/` 是以 `docs/product-map.md` 为覆盖索引的可重复视觉证据 owner。每个能力族在自己的 `scenarios/<family>/manifest.tsx` 声明稳定场景 ID、能力 ID 与 `rendered`、`device-only` 或 `non-visual` 分类；根 catalog 只负责聚合和渲染，不复制生产控件。

`rendered` 场景必须直接挂载生产 Screen/组件，每次渲染新建确定性虚构对象，远端地址只用 `.invalid`，外部 I/O 与写操作回调保持无副作用；`device-only` 记录原生系统面、手势、键盘或真实生命周期边界；`non-visual` 记录没有独立 App 视觉面的能力及其用户可见承载面。双主题 RNTL 挂载只形成 `UI_PASS`，证明场景可渲染；样式问题必须在匹配 Android 构建上获得运行证据，mock 场景不能形成 `LIVE_PASS`。

视觉入口只存在于 `dev/visual-gallery/`，生产入口和 `src/` 不得导入它或 `tests/ui/visual/`。场景不得用真实点赞、收藏、投票、上传、登录或故障注入制造状态，设备走查仍遵守本文件的只读授权边界。

### 首页手势完整回归

修改首页分页、列表滚动、刷新接线，或升级/修改 Pager、RNGH、FlashList、React Native 相关原生补丁时，必须在匹配 APK 上执行完整手势回归，不以单个复现动作或 UI 单测代替。沿用 `docs/operator-runbook.md` 的固定命令和 `LIVE-FEED-01`，不每次另写临时脚本：运行 tracked 首页 Replay、`scripts/check-feed-gestures.mjs` 的 68 组连续手势、独立惯性与双向 CANCEL/UP oracle，以及 Feed/通知刷新取消与再次刷新；补齐首尾边界、点选、分类栏、刷新交叉和页面返回。

每项同时核对页面完整归位、来源与二级栏一致，以及应滚动时内容实际移动。完整横滑与短快滑必须断言来源实际切换，不能只查页面没有卡在半屏；短快滑分别在静止、惯性中和连续交接后执行，另测短慢拖自然结算与轻点停止惯性且不打开帖子。按用例保存结果、APK SHA-256、设备和输入方式；来源验证页、前置数据不足或并发触摸视为无效测试，不能计入通过。未执行的项目明确记 `NOT_VERIFIED`；模拟器自动注入不替代手机触感或实体鼠标操作。新的有效复现先补入现有 owner，再验证修复前失败、修复后通过。

## 三、测试设计

- 标题描述当前行为，不写 `[REG-*]`、修复过程、实现函数名或“should work”。
- 通过 public interface、可访问文案、role/label、稳定 `testID`、持久化结果或请求契约断言；除非内部 seam 本身就是安全、协议或性能合同，不读取私有状态。
- mock 只放在真实外部边界：网络、时间、随机数、文件系统、平台 API 和昂贵第三方组件。不要 mock 被测业务函数，也不要复制 production 算法计算 expected value。
- call count、精确样式、对象 identity 和时序只有在 single-flight、安全、无障碍、用户可见布局或协议本身要求时才是合同。
- 一个测试只拥有一个主要失败原因；参数化适合相同状态机的等价输入，不用一个 300 行场景绑定多个无关行为。
- 异步更新必须在测试生命周期内等待完成或显式取消；React 更新使用 `act`/`waitFor`，不得屏蔽 warning。fake timer、mock 实现、module cache、DOM/React root 和全局变量在每例结束后恢复。
- 普通用例的数据 identity 默认逐测试唯一；只有验证缓存复用、single-flight 或同会话连续行为时才显式共享。不得为测试向 production 暴露 reset API。
- 测试 fixture 使用最小语义数据，但必须保留被测边界需要的合法身份、权限、生命周期和错误形状；不要用类型断言掩盖无效 fixture。

## 四、随机顺序与可重放性

楼层导航的 canonical oracle 必须经过真实编译与 renderer 点击：普通 mention 进入 User，V2EX 明确楼层携带作者约束，代码/数学/已有链接和解析 fallback 不信任伪造内部属性。adapter 测同 ID 冲突不被去重掩盖，包括初始/cursor 的已加载捷径：正文可读但带冲突标记的回复不能精确定位，完全一致重复仍去重；作者与楼层反例分别只改变一个字段。controller 测未加载目标的错误作者、重复楼层、缺失与迟到结果不替换窗口，已加载可信目标零请求；列表测 NodeSeek 本人权限投影克隆后仍能定位。其他 adapter 已确认 partial target 的原契约保留，不能为统一谓词改写既有测试预期。

双向续读不能只检查 `maintainVisibleContentPosition` 配置值：`topic-reply-filters` 使用实际安装的 FlashList recycler controller，按线性非重叠布局、offset 与 viewport 派生实际可见范围，证明控制行与回复同屏时的最后一次前插、新插入行自身晚测高及多轮异步高度变化均保持内容的屏幕坐标。覆盖原生像素取整、超过旧 100ms 窗口的迟到确认、拖动打断惯性、过期结束事件、显式/动画/零距离命令、底部 padding 与数据行上界不同；真实滚动接管后不能继续维护旧内容。正文优先、仅控制行可见时清旧锚点、默认选择策略与有界候选读取仍保留，不能直接让 mock 返回预设锚点。匹配 APK 的设备另测四站正/倒序、主动定位、上下续读及失败重试，记录同一回复坐标；JS hook 与桌面工作量证明不冒充设备像素或帧率证据。返回边界由 `app-navigator` 与真实 `TopicSelectionSurface` 分别证明优先级、旧 revision、停用/重建与正文零额外提交；Native instrumentation 证明活动事件只报告所属 document 且重复取消不重复发事件。宽度由实际 ancestor→HTML/code consumer 证明，不在 mock 中复算期待布局。共享 NS/linux.do 表情用真实 Runtime DOM 触发失败、重试、旧回调和重新进入，核对零误插入、成功节点与滚动位置保留。

自动续读独立于按钮测试：四站分别覆盖正/倒序的拖动、上一窗口预取、下端触边、重复 viewability 与同手势不重复请求，静置不凭空发起加载；还要先让主动定位消费一次下端通知，再仅发送真实拖动事件，证明无需新的触边回调仍能续读。设备必须实际执行不点按钮的上下滑动。楼层定位与排序后定位使用真实 Topic 产生的命令进入实际 FlashList controller，断言短行→暖态超高回复的 header 在 viewport 内，并覆盖首次布局未就绪、最终命令后晚测高、布局提交与 Native 确认的两种先后次序，不能仅检查 `viewPosition` 常量。异步投影必须真正排队到下一次 layout commit，验证新命令/拖动取消旧回调、惯性不能抢占，以及目标 key 移位/删除；同步 no-op manager 不替代这组 oracle。

`topic-image-loading` 使用实际安装的 FlashList `useRecyclingState/useLayoutState`，只 mock Native 列表布局通知边界，覆盖同 URL 双实例先后加载时各自需要的布局通知以及暖态零通知。`topic-reply-filters` 另覆盖拖动开始后、首个 `onScroll` 前的缓存前插；命令被旧 Native 上界截短与新内容尺寸两种事件顺序；动画命令重试不能提前交出目标。普通校正的几何 oracle 必须先提交对应内容尺寸，按 Android content `onLayoutChange` 夹紧已有 offset，再应用 Native MVCP 并再次处理边界，之后交付可迟到的 offset 确认；不能把两次夹紧简化成一次，也不得拆开同批 height/anchor 制造 idle 旧尺寸截断或直接写 manager offset 冒充 ACK。多轮测高、旧确认、零位移收缩后再次增高、像素取整与用户接管分别保留；零 offset 收缩不等于尾窗底部收缩，两者不能互作证据。尺寸回调不得额外投递 idle 滚动。自动贴底消费者在未确认校正期间不得启动动画。负向控制分别删除基线建立、旧确认保护、零位移判断或动画保护后必须转红；仅断言 props 接线不替代坐标与调用次数。

规模测量包含编辑器完整解析/重复快照、NS 页签派生、妖火空边界、候选评论查找和日期排序；算法工作量与运行时间分开报告。V2EX 引用按父节点线性重建，点击用户候选最多读取 32 条，不随回复总量增长；唯一目标单次扫描，不建立额外全局索引。NS 的 JS 派生、Native 选择文档更新和文本布局不是同一指标，桌面耗时不能证明手机帧率。缓存命中仍须覆盖身份和投票 sidecar 变化；连续代码单一 owner 与完整复制不得为通用行预算让步。

性能合同以语义输入、工作量和提交次数为 oracle：相同 viewability 不提交 state，离窗注册不提交无变化 idle，同一 pages 在 loading/error 变化时不重新合并，User 单 lane 更新不重算另一 lane，空 ReaderData 事务不持久化；媒体 callback 必须覆盖同 key 重注册、回收 A→B→A 与旧 attempt，通知覆盖慢 worker 下来源合并、一次补跑和身份/权限/停用/卸载失效。对比性能必须保留修改前源码基线，在同一 runtime、同一 workload 预热后多轮取中位数，分别记录计算与渲染提交；不加入墙钟阈值。Native、模拟器和 Release 性能证据各自独立，不能用耗时改善或局部绿灯代替缺失证据。

纯算法优化必须以固定输入对照原输出，包括顺序、重复项、权限、错误和删除保护；已授权的 Bug 修正单列，不能伪称等价。随机差分需保存 seed 与输入范围，不宣称穷尽证明。Search 覆盖较新/较旧预览都不截断已有分页，以及首屏重复项的权限合并；User 两 lane 必须并发并分别先完成，不能用顺序请求代替。通知调度组合 owner 运行真实 worker/store，只 mock 外部读取与 Native acknowledgement，证明两来源慢投递期间的重复触发有界合并，未读总数相同但消息 ID 替换仍会投递。NS 内容 owner 使用不同主楼/回复全文，覆盖空/部分/完整终端的 bridge/rendered 链路、两侧身份歧义与块数量不符；无源码的无 class xterm 行也须保持完整文本、ANSI 和邻接内容。

`npm test` 使用 Vitest shuffled sequence；`npm run test:ui` 使用 Jest randomize 并输出 seed；`npm run verify` 自然继承两者。随机顺序是常规隔离门禁，不再称为“确定性门禁”。

失败时先复制输出 seed 重放同一文件或套件：Vitest 使用 `--sequence.shuffle --sequence.seed=<seed>`，Jest 使用 `--randomize --seed=<seed> --showSeed`。固定 seed 转绿后还必须运行一次默认随机 seed；只在固定顺序通过不能证明隔离完成。

顺序失败优先修复 owner 生命周期：每例重建或清空共享状态，等待异步任务，回收 root/DOM/timer/mock。不要通过固定排序、全局重试、扩大 timeout、吞 warning 或 production reset API 隐藏污染。

## 五、TDD 与历史事故

产品 Bug 修复遵循 Red → Green → Refactor：先让最低可靠行为测试在修复前因正确原因失败，再做最小根因改动，最后在全绿下合并重复 owner。测试如果在未修复代码上已经通过，不能证明该 Bug。

`it.failing`/`test.failing` 只用于已确认、当前未获准修复的产品缺陷，并必须满足：

- 标题使用静态字符串，且只引用一个 canonical REG；
- 对应 corpus 条目存在且状态为 `OPEN`；
- 用例固定真实失败 oracle，不把 expected-failure 计为 `UI_PASS`；
- 产品修复后改为行为标题的普通测试，并把 corpus 状态更新为 `RESOLVED`。

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

## 八、交付记录

交付至少包含：

- 基线 revision/dirty 状态与本次 evidence owner 或 capability；
- 实际运行的命令、随机 seed、通过/失败/未验证结果；
- 多入口影响面和每类证据状态；
- expected-failure、warning、环境阻碍和未验证范围；
- 测试治理任务的前后文件数、实际用例数、测试 LOC、同 seed 时长，以及六类处置数量；
- 本任务进程与 scratch 是否回到基线。

不使用覆盖率、mutation、LOC、测试数量或文档长度作为门禁。只有测试证明不了关键行为时才增加工具，不为“治理”创建新的长期框架。
