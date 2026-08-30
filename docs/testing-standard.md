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

Android 主楼正文连续选择的 canonical evidence 分三层且互不替代：compiler Vitest 固定 UTF-16 logical tape、table row-major、媒体标签和 revision/recycle 逻辑；RNTL 固定 manifest 直接来自 visible opening collection，只有这些 opening row 根 View 获得 marker，全部 opening renderer 为 `selectable=false`，并让一个主楼逻辑 document 跨 `richText → heading → table → emoji/sticker → code → trailing text`，当前显示的展开引用/details、签名和 terminal Tab 进入该 document，回复、评论与已采纳答案零 marker 且原有整条长按复制可用。Native JVM 与独立 AVD instrumentation 固定 marker 是唯一 selection 身份，`isTextSelectable`、`isLaidOut` 或全 mounted window owner/fingerprint 完整匹配都不是入口门槛；Layout 只用于当前端点和 mounted `TextView` 的本地选区投影，每个可见高亮和两个端点手柄视觉分别由对应 `TextView.overlay` 持有，route surface 只保留触摸命中点，瞬态映射缺失只跳过当前帧而不取消逻辑选区。instrumentation 还必须固定无 row-wide double-tap detector/`TextView` long-click patch、普通链接 tap 不被吞、正反向手柄、静止长按唯一入口、双击零原生局部选区、活动选区上静止短按取消但越过 touch slop 的滚动保留、跨三个 viewport、至少一次 cell recycle、自动滚动和剪贴板顺序。主要 draw-time oracle 使用生产等价的 `ScrollView + absolute cells`，包含多个 `TextView`、嵌套横向 scroller 与 inline `ReplacementSpan`；纵向 offset 在 coordinator pre-draw 后的同一次 draw 内正反向改变时，本地高亮和手柄 hotspot 必须各自以 `<=2px` 误差出现在当前文字 Path/caret，旧位置至多残留 `2` 个差异像素，取消后 drawable 消失且全部文字 bounds/baseline 不变。端点 owner 仍 mounted 但离开 viewport 时还必须证明 route 命中点消失而本地 handle drawable 不解绑；不经过新 pre-draw 把该 owner 移回可见区的同一次 child draw 必须立即同时绘出文字与手柄。边界端点允许手柄圆形向 TextView 内侧收回，但 stem 必须连回未偏移的 caret hotspot。真实 RecyclerView proof 只辅助固定 cell recycle/rebind 后逻辑选区、手柄、复制顺序和本地投影恢复，不再作为同帧时序的主要证明；源码字符串、mock scroll call 或 mounted owner 计数不能替代这些 oracle。compiler 为其他 role 生成 tape 只是内容协议证据，不授权 UI marker 或回复 document。

### 可视状态语料库

`tests/ui/visual/` 是以 `docs/product-map.md` 为覆盖索引的可重复视觉证据 owner。每个能力族在自己的 `scenarios/<family>/manifest.tsx` 声明稳定场景 ID、能力 ID 与 `rendered`、`device-only` 或 `non-visual` 分类；根 catalog 只负责聚合和渲染，不复制生产控件。

`rendered` 场景必须直接挂载生产 Screen/组件，每次渲染新建确定性虚构对象，远端地址只用 `.invalid`，外部 I/O 与写操作回调保持无副作用；`device-only` 记录原生系统面、手势、键盘或真实生命周期边界；`non-visual` 记录没有独立 App 视觉面的能力及其用户可见承载面。双主题 RNTL 挂载只形成 `UI_PASS`，证明场景可渲染；样式问题必须在匹配 Android 构建上获得运行证据，mock 场景不能形成 `LIVE_PASS`。

视觉入口只存在于 `dev/visual-gallery/`，生产入口和 `src/` 不得导入它或 `tests/ui/visual/`。场景不得用真实点赞、收藏、投票、上传、登录或故障注入制造状态，设备走查仍遵守本文件的只读授权边界。

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
| Android 主楼正文连续选择 | compiler Vitest、`topic-rich-text-selection` 与 `topic-components` RNTL、`npm run test:native:forum-selection`、独立 `WZ_ForumSelection_Test_API35` 上的 `npm run test:instrumented:forum-selection`；RNTL 必须固定 visible opening→manifest→row marker、opening `selectable=false` 及回复/评论/采纳答案零 marker、整条长按复制，instrumentation 必须固定 marker-only 身份、瞬态映射不取消、普通链接 tap 不被吞、静止长按唯一入口、双击零原生选区、静止短按取消/滚动保留、生产等价 ScrollView 同 draw 的 TextView-local 高亮与手柄像素 oracle，以及 RecyclerView 回收重绑后的手柄/复制/投影恢复；真实来源再按 runbook 核对主楼复制顺序、跨回收窗口、快速往返逐帧贴合、负向 marker 边界、预算/PSS 和 `0px` bounds/baseline。 |
| WebView、登录态、真实来源或原生生命周期 | 静态/单元/UI owner 加 targeted build；按 runbook 做身份匹配的 APK sanity、Replay 或 Live，未授权分支明确 `NOT_VERIFIED`。 |
| 版本、签名或原生配置的普通开发改动 | 相关 tooling test、fresh prebuild/compile 或 targeted build；不运行要求 clean tree 的正式 release。 |
| 用户明确要求正式发布 | 按 runbook 运行 `npm run release:android` 及其完整门禁。 |

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
