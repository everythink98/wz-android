# Android 性能提升实施计划

查阅与代码核对日期：2026-11-15。目标平台仅 Android。本轮交付调研、执行计划和已完成的冷启动改动记录；全 App 性能实施留给后续执行者。

用户随后授权按此计划执行，当前接入、实测、采用与跳过的候选见 [Android Perfetto 执行记录](android-perfetto-execution.md)。下文保留计划基线，不能将候选清单视为全部已修改。

优先缩短用户等待和减少实际掉帧。现有状态清单用于定位 owner、等待关系和取消边界，不把状态数量或删除行数当性能指标。281 项审查范围中的 192 个 KEEP、2 个 investigate 及其证据边界继续有效；这份清单不等于已经证明所有运行热点。

## 接手基线

继续使用 `codex/state-model-refactor` 的当前工作树，目录为 `C:\Users\ljx\.codex\worktrees\integrate-cleanups\wz-android`，代码基点 `9a92d686017fd7626a3093836aa24ec1846e8dd3`，另有本轮未提交修改。`C:\src\wz-android` 是另一份带用户修改的 checkout，不能直接将两份目录当作相同基线。执行时重新读 Git 状态，不恢复文件或自动套入旧 patch。

已经完成：妖火评论兼容、必要清理、原 92 个文件逐项核对后实际整合 89 个、状态审查门禁，以及冷启动部分内容提前展示。具体变更、完整启动 owner 表、测试和设备证据见[本轮实施记录](../state-model-refactor.md)。后续优化在这些修改上继续，不重做已交付的减法。

当前关键版本来自 `package.json`：React Native 0.86.3、Expo SDK 57、React 19.2.3、FlashList 2.3.2、Reanimated 4.5.1、Worklets 0.10.4；实际 Android OkHttp 为 4.12.0。主模拟器为 API 35，最终普通 APK buildId `3c8996c609214c44b56b313b307b71b2`。执行时必须重新绑定源码、APK、设备和进程，不能继承本文的旧包通过标签。

### 已有数据与剩余问题

| 观察 | 当前证据 | 下一步含义 |
| --- | --- | --- |
| 首批内容等待 | 旧包 3 次冷启中位数 3854 ms；本轮新包 5 次为 2678 ms，提前约 30.5% | 已减少等待慢来源的显示门槛；不是 DNS/TCP/TLS 提速，也不是严格长期稳定性证明。 |
| 本地启动 | `page-ready` 中位数 621→719 ms；两包分别 614–648、598–728 ms | 没有本机壳层提速结论，不能用内容提前掩盖该指标。 |
| 全量读取 | 从读取 intent 起算 3165→3047 ms，新包最大 3682 ms；各次首屏零来源错误 | 全量基本仍受来源响应影响；用户频繁 5 秒超时未在本轮现场复现。 |
| 建连 | 新包 DNS 251–913 ms、TCP 476–515 ms、TLS 154–534 ms；同进程共享 pool、IPv4/direct、TLS 1.3/h2，无 connect-failed | 继续区分解析、握手、宿主网络与调度。不能推断多建 client、IPv6 回退或证书 CPU 是根因。 |
| 暖请求 | 旧包复用连接只需 2–7 ms；新包一次暖刷新全量 1317 ms | 连接复用已有效，延长 keep-alive 不能让已结束进程保留 socket。 |
| 全 App 残余 | Search 冷绘制和暖切页仍有历史未结案项；重图、WebView/IME 有既定取证边界 | 按 [性能经验](README.md) 与 [待处理清单](../code-cleanup-map.md) 继续，不能把历史假设全部变成待改代码。 |

## 工具选择

优先组合是 Perfetto/Trace Processor、已有请求事件和 Simpleperf，再按疑点补 RN DevTools 或 Android Studio。它们全部用于本 Android App；不建立 iOS 工具链。

| 工具 | 适合回答的问题 | 本项目接入与限制 |
| --- | --- | --- |
| [Perfetto + Trace Processor](https://github.com/google/perfetto) | 冷启动等在哪里；JS、主线程、RenderThread 的运行/等待；FrameTimeline 掉帧；Binder、I/O、WebView 与内存关联 | 主 AVD 已确认 `Perfetto v46.0`。复用维护手册中的固定 trace 区段，SQL 关联同 PID/同帧；采样轮次独立于普通 Release 的正式性能比较。 |
| [Perfetto 官方 AI skill](https://github.com/google/perfetto/blob/main/docs/getting-started/using-ai.md) | 帮助 Codex 载入 trace、查询 PerfettoSQL、定位线程与对象保留路径 | 官方明确支持 Codex 和 Windows 安装入口。下一执行轮核对本机插件能力，固定版本并校验实际工具，先用一份已知 trace 验证查询；本轮未安装。AI 结论须附 SQL、时间窗与原始行，不能只交一段解释。 |
| Android Simpleperf / Android Studio Profiler | 哪个 Native/Java 函数消耗 CPU；哪些对象分配或保留；是否为 GC、解码、JNI 热点 | 设备 Simpleperf 已实际采过 5 秒、331 样本。APK 的 R8/Native 符号须匹配；CPU 样本不能解释所有网络或锁等待，heap 抓取不能混入自然内存对照。 |
| [Android Macrobenchmark 与 Baseline Profiles](https://github.com/android/performance-samples) | 自动重复进程冷启动、页面切换、滚动；比较编译模式与 profile 收益 | 复用现有场景和产物校验，不另建业务测试 App。初期继续用 `scripts/check-cold-start.mjs`；需要长期自动比较时才加 benchmark 模块。测试默认可能影响编译/进程状态，先在专用环境校准，主登录设备不清数据。 |
| [React Native DevTools](https://github.com/react/react-native-website/blob/main/docs/react-native-devtools.md) | Android App 内 JS 火焰图、React 提交、User Timing、请求发起关系 | 文档的 Network/Performance 从 RN 0.83 起提供；当前依赖版本满足这一基础要求，实际连接未验。用于定位 JS，最后以普通 Release 复测；不把主站新版本才有的面板当作 RN 0.86 已支持功能。 |
| [FlashList `useBenchmark`](https://github.com/Shopify/flash-list/blob/main/documentation/docs/guides/list-profiling.md) | 列表自动滚动下 JS 吞吐、cell 重渲染和回收疑点 | 当前 2.3.2 的本地声明已确认导出，无需新依赖。仅在隔离 proof/开发入口挂载；JS FPS 不等于 Android 呈现帧率，正式判据仍是 FrameTimeline/gfxinfo。 |
| [Flashlight](https://github.com/bamlab/flashlight) | 无需在业务 App 内接 SDK 的 Android CPU、帧率等对比报告 | 作为可选汇总工具，先测本机 Windows/API 35 兼容性。官方提供本地 CLI，不必使用云端；其评分不能替代线程归因。当前存在 [16 KB 页设备崩溃报告](https://github.com/bamlab/flashlight/issues/389)，不能外推所有 Android 环境已支持。 |
| [Reassure](https://github.com/callstack/reassure) | 在现有 Jest/RNTL 中比较组件渲染次数与耗时，阻止重复渲染回归 | 可选，不优先引入。当前 React 19 环境应先排除上游 [双峰耗时问题](https://github.com/callstack/reassure/issues/585)；既有行为/计数 oracle 足够时继续复用，不新增一套近似测试。 |

建议先打通一条可复用证据链：已有 agent-device/ADB 场景 → 普通包基准；单独再录 Perfetto → Trace Processor SQL → 源码热点 → 最小修复 → 同场景普通包比较。当前 agent-device 已提供 Android `perfetto`、`simpleperf`、frames 和 memory 接口，可作操作入口，不需要自建性能采集平台。网络继续使用现有脱敏 EventListener，不为查耗时导出 Cookie 或完整响应。

## 执行顺序与工作范围

以下为一次集成交付的依赖顺序，不要求每个项目单独询问批准或提交。先建立基线，再连续处理有证据的热点；没有收益或前置不成立的候选记录结论即可，不为完成清单强行增加代码。

### 1. 建立可重复的 Android 性能基线

**入口：** `scripts/check-cold-start.mjs`、`src/platform/diagnostics/startupTiming.ts`、已有请求诊断、`tests/integration/performance/` 及 [Release 性能规程](../operator-runbook.md#release-性能回归)。

- 分开记录覆盖安装首开、保留数据的进程冷启、同 PID 热恢复和手动刷新；分开记录页面框架、首批可读内容与完整请求终态。
- 在既有脚本补齐全量终态和每来源 DNS/TCP/TLS/响应/解析汇总，扩展现有工具，不另写启动协调器。测量脚本必须验证来源请求最终成功、错误或取消，不能在第一条帖子出现后把未结算请求算成成功。
- 固定普通 Release、同版本模拟器和系统配置；正式比较时不同时运行 Gradle、完整测试和 CPU profiler。先做小样本准入，正式冷启比较建议至少 20 次并报告中位数、p90、最差和失败率；随机/交错比较可用保存的同签名 APK，禁止卸载。
- Perfetto 只取能回答问题的短窗口，核对 trace 覆盖、丢失、时钟和 PID。每个结论能回到同次操作的原始事件；保留受控来源测试与真实网站观察的区别。

**完成判据：** 同一条命令可产生有构建身份、阶段耗时、终态及缺失说明的报告；没有数据时明确失败或未验证，不能制造零耗时。Android 真机可用后补一台目标 arm64 设备，模拟器结果不能代替真机。

### 2. 优先缩短启动到实际发出请求的路径

**能力与入口：** `NAV-01`、`FEED-01/02/04`；`src/app/useAppRuntime.tsx`、`src/app/useAppStartupRuntime.ts`、`src/app/useInitialForegroundRuntime.ts`、`src/platform/network/useNetworkProxyRuntime.ts`、`NetworkProxyModule.kt`、`src/sources/feedRead.ts`、`src/sources/readGateway.ts`。

**已有结论：** 本机账号/Reader 并行恢复、按需 UA、延后后台任务和部分首屏已经存在，不重复实施。启动 owner、阻塞对象和退出路径见 [本轮启动核对](../state-model-refactor.md)。

**优先实验：** 直连冷启仍经 Native 代理 apply/WebView 准备，先用同次 trace 定量确认。如果这段确实拖延所有来源，评估在现有 Native owner 能证明「没有已安装或在途 override」时让直连 apply 无需启动 WebView。必须覆盖 bridge 重建、前次代理切换、失败回调和新配置到达；不能只判断 JS `enabled=false` 就跳过。优先提前合法业务读取，而不是额外 HEAD 请求。没有足够收益或无法保持代理契约就不采用。

**保留边界：** 可信来源设置、账号 scope、Cookie 交接和代理生效不能被超时假成功绕过。首屏仅由现有 Query 与展示快照拥有；不再叠加 `coldStartReady`、`networkWarm`、`firstLoadDone` 等可相互矛盾的旗标。部分结果保持可读、顺序稳定、无提前 cursor，后台仍等终态。

**验收：** 相关 Account/代理/Feed 的真实调用链断言；普通包冷启、L 站已登录、切源、刷新、取消再进入；比较请求发起时刻与首批内容，而不是只比较 Splash 隐藏。

### 3. 连接与请求效率专项

**入口：** `src/platform/network/request.ts`、`src/platform/network/useNetworkProxyRuntime.ts`、`src/sources/readAggregation.ts`、`src/sources/forumSourceReadAttempt.ts`、Native `NetworkProxyRuntime.kt`。

按每个 call 拆开排队、DNS、TCP、TLS、首响应、body 与解析，分别取首次和复用请求。现有 [OkHttp 连接池机制](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/docs/connections.md) 与设备事件一致：不要为同一 generation 再建 pool，也不能把媒体与论坛 lane 的权限差异抹平。

优先核对同 scope 的元数据/列表是否重复读取、调用取消后底层是否及时结算、diagnostic 事件序列化或同步日志是否阻塞请求线程。只有 profile 命中时，才删重复读取、重复编码或不必要的同步输出；保留错误和关联证据。若 DNS 持续占主导，再做同设备同网络的解析对照，先排除代理和网络变化；固定 IP、进程外 DNS 缓存、改系统 DNS、全量抢跑预连接都不作为默认方案。

若随后证实多地址失败回退，再独立评估 OkHttp 升级与 fast fallback；本轮 IPv4 单路径样本没有这个前提。HTTP/3/Cronet 更换会涉及 Cookie、代理、取消、诊断及 RN/媒体共享实现，收益未证实前不进入实施。15 秒是失败上限，不是速度优化目标，也不应继续靠拉长上限交付。

**验收：** 相同输入请求数与字节数不增加、连接正常复用、失败有界、取消释放正确；代理/身份切换不串连接许可。网络自身波动、服务器耗时与 App 开销分别报告。

### 4. 首页、Search、Library、通知的列表与切页

**能力与入口：** `FEED-01/02/04`、`SEARCH-01/02`、`NAV-01` 及对应 Library/通知能力；`src/features/feed/FeedScreen.tsx`、`src/features/feed/useFeedController.ts`、`src/features/search/SearchScreen.tsx`、`src/features/search/useSearchController.ts`、`src/app/AppNavigator.tsx` 和各列表行。

先查同次 trace 的主线程/RenderThread，再用 RN Profiler 检查订阅扩散。Feed 的页合并和阅读筛选已使用 memo，Query 的 [结构共享与 select](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/render-optimizations.md) 也不是待新增框架；只处理被实际 props 或 Query 投影变化带动的无关行。按 [FlashList v2 建议](https://github.com/Shopify/flash-list/blob/main/documentation/docs/fundamentals/performant-components.md) 检查 renderItem、extraData、子树 key 和 getItemType，但保留正文/媒体要求重建的 identity，不全局删 key。

Search 的旧证据指向 Native mount/draw，不能靠全局 memo、预挂载或固定延时掩盖首次成本。沿现有 owner 只对已定位的宿主、图标/控件或绘制提交做单变量实验；隐藏页 opacity 方案与图标拆装候选曾未达到采用条件，按 [导航实验](navigation-and-startup.md) 的重开条件处理。

**验收：** 复用维护手册的 Search 三批往返及冷进入判据；列表追加不跳、回收不串内容、返回位置保持、横纵手势与刷新结束正常。FlashList JS FPS 和组件提交数仅用于归因，不能单独标为 Android 流畅度通过。

### 5. 详情解析、评论与长内容

**能力与入口：** `TOPIC-01/02/03`；各来源 `topicParser`、`src/domain/forum/topicContentHtml.ts`、`src/domain/forum/topicContentSplit.ts`、`src/features/topic/useTopicController.ts`、`src/features/topic/components/TopicContentList.tsx`。

分别测 HTTP、整页 DOM、正文清洗、权限/引用/投票、行规划、React 提交和首次 Native 绘制。优先删除同次输入中被 profile 证实的重复 parse、索引遍历和无消费者对象分配。已有 rawAttributes、NodeSeek 元素索引复用、编辑时评论命令稳定化继续保留。

Worker 不是默认方向：历史实验减少了 JS 阻塞，也增加了总完成时间与取消复杂度。只有当前大输入确实长时间独占 JS，且现有结构内减法仍不足时，再按 [Worker 历史边界](content-and-workers.md) 评估；必要时先尝试有取消点的分段纯计算，不能把安全清洗和权限确认跳过。编译结果复用必须跟随不可变内容与实际参数，不能扩成跨身份业务缓存。

**验收：** 完整输出、楼层/引用、权限、正倒序、查找、深层内容和取消保持；妖火本轮新旧评论结构仍通过。长帖变快必须给同输入耗时与实际帧证据，不能只报遍历次数减少。

### 6. 图片、音视频、内存与耗电

**能力与入口：** `TOPIC-02` 及头像共享入口；`src/features/topic/media/ManagedTopicMediaImage.tsx`、`src/platform/media/originalImageLoading.tsx`、`src/features/topic/media/useImagePreviewController.ts`、`src/platform/media/mediaPlaybackSession.tsx`、`src/ui/avatar/Avatar.tsx` 和 Native media runtime。

先确认是重复请求、重复解码、过大目标尺寸、GPU 上传，还是仍被业务持有的对象。网络冷/暖、解码冷/暖和内存驻留分别记量。只有目标 identity 重复解码被证实后，才在现有 viewport、lease 和预算中调整；不能用降低画质、清全局缓存、`largeHeap` 或新图片库交换数字。正文 base/原图/预览和账号 epoch 的不同职责保持。

用 Perfetto/Android Studio 分开看 Java、Native、graphics 与 mmap；重复进入/退出才出现的增长需找到保留根或稳定增长证据，PSS 没立即回落不等于泄漏。后台通知、隐藏媒体、取消下载和播放监听按现有生命周期验证，避免把每次资源状态传播成全 App React 更新。

**验收：** 严格复用维护手册指定重图帖子、设备、动作和内存采样协议；不换小图帖达标。播放、seek、全屏、回收、返回不自动续播与账号切换分别验收；耗电结论需真实 Android 设备，模拟器 CPU 下降不充当电量改善。

### 7. 编辑器、WebView 和 IME

**能力与入口：** `WRITE-01/02/04/05/06/07`；`src/ui/composer/editorRuntime.tsx`、`src/ui/composer/editorRuntimeDocument.ts`、`src/ui/composer/editorRuntimePanels.ts`、共享 Composer 与 Native IME 接线。

复用 Android App 内的 WebView 调试定位 DOM、布局、JS 和 bridge 消息，再与 Perfetto 的 IME、RenderThread、WebView 区段关联。相同 doc 的 Markdown、相同 EditorState 的工具栏派生已经缓存；后续查实际每键消息量、无变化的快照、布局读写交错和长文选区，不重复加缓存。程序替换、撤销重做、文档 epoch、附件与发送许可继续独立校验。

Reanimated 的成对提交修复已经存在。上游 [性能指南](https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-reanimated/versioned_docs/version-4.x/guides/performance.md) 另有快速 props 通道，但会影响变换后的触摸命中；没有当前 trace 与对应触摸反例，不全开 feature flags。模拟器 EGL 查询历史问题按 [编辑器实验](editor-and-tooling.md) 处理，不能算作生产 App 优化。

**验收：** 真实 Gboard、半屏/全屏、长文光标与选区、表情、选图取消及返回保稿；不通过减少文档字段、冻结旧权限或更改键盘行为取巧。真实发送/上传仍需各操作的授权。

### 8. SQLite、后台工作和 Native 编译优化

**入口：** `src/platform/storage/readerDataStore.ts`、`src/platform/storage/readerDatabase.ts`、`src/platform/storage/sqliteExecutor.ts`、`src/app/useReaderRuntime.ts`、通知和诊断 owner，以及 `plugins/`/构建配置。

SQLite 已启用 WAL、3 秒 busy timeout 与 `synchronous=FULL`，启动已有 bootstrap 与记录分页；不是先把数据库改成另一套缓存。用查询计数、`EXPLAIN QUERY PLAN` 和耗时找全表扫描、无效读取与重复序列化。只为实测热点加索引或复用 prepared statement，并关闭资源；保持串行事务、故障恢复和读写隔离，不能通过降低持久化保证提速。通知和更新已推迟到首屏终态，重点检查后台/前台交接中的实际重复任务。

Baseline/Startup Profiles 放在最后：若 Native 类加载、ART 编译或磁盘代码布局占主要成本，参考 [官方 profile generator](https://github.com/android/performance-samples/blob/main/MacrobenchmarkSample/macrobenchmark/src/main/kotlin/com/example/macrobenchmark/baselineprofile/SampleBaselineProfileGenerator.kt) 做有/无 profile 的同包类型对照。它不会减少网站 RTT，也不能把 Hermes JS 当作 ART 方法优化。长期配置只放 `plugins/`、`app.json` 或受管源码，不能只改生成的 `android/`。

**验收：** 先给出确切慢查询/编译证据，再验证读写正确性、崩溃恢复和资料保留；APK 必须含目标 profile，且普通启动比较有收益才保留。已有启动/存储时间很小时该项可不改。

## 交付与停止条件

每项保留「问题 → 同次证据 → 最小改动 → 行为测试 → 普通包对照 → 结论」。新分支至少有一个修复前失败的行为断言；局部门禁通过后才做匹配设备流程，不重复运行无关压力矩阵。最终按受影响能力运行相关测试、typecheck、完整 verify、文档检查与 `git diff --check`。

验收沿用项目既定门槛；没有既定门槛的指标，在基线后预先写下目标与自然波动区间，不能看完候选再挑指标。收益要超过同条件测量波动，不能通过裁剪晚帧、跳过慢来源、减少帖子信息或放宽失败判据达标。零崩溃与资料/登录/权限正确性是前置，性能中性且确实修复错误的变更可单独保留。

输出一份按能力的 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`、`APK_SANITY`、实际 Device/Live 结果和 `NOT_VERIFIED` 表，并附源码/APK/符号绑定。本计划不授权提交、push、合并或正式发布；保留主设备登录和所有既有工作区修改。原始 trace、截图、日志与产物只留 ignored 证据目录。

推荐交给执行者的任务说明：

> 按本计划连续完成 Android 性能优化，先核对当前分支未提交改动和已安装普通 APK，再建立可复用测量链。优先处理冷启动实际请求前的等待、网络重复工作和已知 Search 慢帧，随后按真实热点覆盖详情、媒体、编辑器和存储。复用 Perfetto/现有诊断，必要时接入官方 Perfetto AI skill；每个根因给原始证据和最小修复，无收益或缺少前提的候选记录后跳过。保持登录、资料、权限、内容完整性与既有测试门槛，最后一次集成交付，不提交、不推送、不合并。不要为减少状态数量重写生命周期，不做 iOS 工作。
