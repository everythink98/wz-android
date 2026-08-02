# 回归语料库

## 文档职责

本文件记录已经逃逸到用户侧、普通自动测试或发布 smoke 没有拦住的问题。它回答“为什么必须测、什么结果才算拦住”，产品现状与入口仍以 `docs/product-map.md` 为准。

每次开发先选择产品能力 ID；命中本文件事故 seam 时，必须执行该条目的最低可靠测试和验收路径。新的逃逸 bug 修复时，同一改动增加一个 `REG-*` 条目和一个能在修复前失败的最小测试。

## 证据名称

| 证据 | 只证明 |
| --- | --- |
| `STATIC_PASS` | 文档、类型、unused 和 React Doctor 全仓 blocking error 检查通过 |
| `UNIT_PASS` | Vitest 固定的领域、controller、gateway、存储或请求契约通过 |
| `UI_PASS` | Jest/RNTL 固定的用户可见 React Native 渲染与交互通过 |
| `DEVICE_REPLAY_PASS` | `.ad` 脚本在身份匹配的 App、APK、设备和会话上通过；不证明第三方当前健康或当天有数据 |
| `LIVE_PASS` | App 内真实来源、登录态或获授权写操作得到可观察结果 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR 或 RedBox |
| `NOT_VERIFIED` | 当前没有足够证据，不推断成功或失败 |
| `BLOCKED_BY_ENV` | 受签名、设备、来源或登录态阻碍，且不能安全改变环境 |

`APK_SANITY` 和 `DEVICE_REPLAY_PASS` 可以由同一个发布命令执行，但不得合并成“功能完整通过”。

Jest 的 `it.failing` 只用于保留已确认但本轮不获准修复的精确失败 oracle。Jest 对这类用例显示通过，含义只是“预期中的失败仍然发生”，不得计为该行为的 `UI_PASS`；修复后必须把它改成普通用例并确认真实通过。

## `REG-PERF-001` Library 切换重建列表、集中加载头像及历史写入全量清洗

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`FEED-01`、`FEED-02`、`FEED-03`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`DATA-01`、`DATA-02`、`DATA-03` |
| 用户症状 | 收藏帖子、关注用户和历史之间切换时明显卡顿；Debug 基线出现 17%–32% 掉帧，最慢帧约 69–82ms。1000 条历史的 x86_64 Release 基线两批最慢帧中位数为 55.45ms / 51.9ms，History 就绪中位数为 702.5ms / 708ms。Topic 旅程中 20 次历史同步提交有 8 次超过 8ms，最慢 22ms。 |
| 触发条件 | Library 已有数据，切换 tab 时 FlashList 的 `key` 改变；旧实例卸载、新实例挂载并集中创建可见行及头像，同时筛选在切换后的 effect 再重置。即使复用列表，继承共享列表的 900px 预绘制窗口仍会在 1000 条 History 数据切入时提前创建屏外行并触发头像解码与原生绘制。Topic 读取完成时 `history-recorded` 对已校验 ReaderData 再做一次全量 sanitize。 |
| 根因 seam | `src/features/library/LibraryScreen.tsx` 的列表 identity、筛选提交、滚顶、Library 专属 `drawDistance` 和 `maintainVisibleContentPosition` 契约；`src/ui/avatar/Avatar.tsx` 是 Feed、Search、Library、Topic、User 共用的头像加载 seam；`src/domain/reader/readerData.ts` 与 `src/app/useReaderRuntime.ts` 共同约束历史写入和持久化。 |
| 必须保持的行为 | 三个 tab 复用同一个 FlashList；目标 tab 首次可见状态已经是全部来源/全部分类，列表在数据替换前无动画回到顶部且下一帧补偿，重复点击当前 tab 不重置筛选或滚动，Library 不锚定旧数据位置，并把预绘制距离限制为 250px；Feed、Search 等共享列表继续使用各自配置。正常头像先只走原生加载，保留一次原生 retry，第二次失败才走带 session identity 的 SVG fallback，旧 URI/session/unmount 的迟到结果不得显示。`recordHistory` 自身只保留最新 1000 条；只有可信 `history-recorded` 跳过全量 sanitize，加载、导入、合并和其他 mutation 仍完整校验，visitCount、收藏摘要、tombstone、保存队列与失败回滚不变。筛选、删除、清空和 `REG-FEED-002` 的 Feed 独立位置保护保持不变。 |
| 精确失败 oracle | `tests/ui/library/library-screen.test.tsx` 依次切换三个 tab，要求列表只挂载一次；History 第一次 render 即得到未筛选数据；真实切换先调用一次 `animated=false` 滚顶、下一帧再补一次，重复点击当前 tab 不滚顶；Library 显式禁用可视位置锚定并固定 `drawDistance=250`。`tests/ui/shared/avatar.test.tsx` 要求正常位图零 SVG probe、第二次原生失败才显示 SVG、迟到结果丢弃且 fallback 失败显示文字头像。`src/domain/reader/readerData.test.ts`、`src/app/useReaderRuntime.test.ts` 与 `tests/ui/library/reader-data-controller.test.tsx` 要求 1001 条只留最新 1000 条，可信提交不重建快照且仍进入原保存队列；既有 `REG-DATA-002/003/004` 继续固定排队、失败回滚与恢复写。 |
| 最低可靠自动测试层 | `UI_PASS`：必须跨真实 React state 更新观察列表实例、目标首帧数据和滚动调用；源码字符串或单独测试筛选 helper 都不能证明没有 remount。ReaderData 以 helper `UNIT_PASS` 和 controller `UI_PASS` 共同固定快路径及数据行为，最终同步耗时仍由设备诊断 trace 复测。 |
| Replay 或真实验收路径 | 保留 App 数据执行 `tests/device/library-return.ad`；性能验收在身份匹配构建上执行 Favorites ↔ History 20 次并用 FrameTimeline/`gfxinfo` 对照 missed-deadline、p95 和最慢帧；在可精确恢复的 1000 条 History 数据上再执行快速向下 20 次、向上 20 次，要求全程存在完整可见行且没有空白或抖动；最后执行 20 次可落历史的 Topic 旅程，核对 `history-recorded` 同步阶段。 |
| 负向验证方式 | 恢复 `key={libraryTab}`、把筛选重置移回 `[libraryTab]` effect、移除切换前/下一帧滚顶、让已选 tab 也重置、重新启用位置锚定或让 Library 重新继承 900px 预绘制距离，Library oracle 必须失败；恢复 mount 时 SVG probe 或接受旧身份结果，Avatar oracle 必须失败；移除 `recordHistory` 上限或让 `history-recorded` 重走全量 sanitize，数据上限或性能契约必须失败。 |
| 明确不覆盖范围 | 动态头像服务可用性、原生图片解码/上传成本、正文列表滚动和 Release 帧指标分别由动态来源、设备 trace、对应页面回归与设备性能验收负责。 |

## `REG-PERF-002` Topic/User 返回重复恢复同一 Topic session

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`TOPIC-04`、`USER-01`、`USER-02` |
| 用户症状 | 从 Topic 或 User 返回时偶发卡顿或状态回滚；returning native route 已保留自己的可视 presentation，返回链路却又恢复整份 fallback snapshot，User 路径还再次 `openTopic`。 |
| 触发条件 | Topic → Topic → 返回，或 Topic → User → Topic；原生栈存在可返回的 Topic route，同时内存中也保留兼容 fallback snapshot。 |
| 根因 seam | 旧实现由全局组合层重放 Topic/User 返回状态，并让多个 native route 共享一个 Topic session；native stack 已经保留 route 实例，却又叠加 snapshot restore。当前所有权位于 `src/features/topic/TopicRoute.tsx` 与 `src/features/user/UserRoute.tsx`。 |
| 必须保持的行为 | Topic、User 和 ReadingSettings 只使用 native push/pop；returning Topic route 继续使用自己的 mounted controller、list ref、草稿、筛选和滚动状态，不执行 fallback restore 或再次 `openTopic`。离开 route 时请求取消和 inactive gate 仍立即发生。 |
| 精确失败 oracle | `tests/ui/app/app-navigator.test.tsx` 固定 Topic A → B → A、Topic → User/ReadingSettings → Topic 返回同一实例并保留 route-local 状态；`tests/ui/topic/topic-session-controller.test.tsx` 固定不同 route controller 互不修改。 |
| 最低可靠自动测试层 | `UI_PASS` 固定 session 状态没有二次提交，`UNIT_PASS` 固定返回分支；实际 native 转场和帧时序仍需设备验收。 |
| Replay 或真实验收路径 | 在匹配构建上分别执行五站列表 → Topic → 返回、Topic → User → Topic、嵌套 Topic 返回；核对筛选、草稿、展开引用、滚动位置和逐层返回，并记录 20 次帧指标。 |
| 负向验证方式 | 把 Topic controller 提回全局组合层、用 `popTo(MainTabs)` 返回，或在 native pop 后重建/恢复 Topic state，编号测试必须丢失或回滚原 route 状态。 |
| 明确不覆盖范围 | 第三方请求当天延迟、随机目标是否存在和未经授权的论坛写操作不由该回归固定。 |

## `REG-PERF-003` Feed 来源切换把列表工作压进 Pager 收尾帧

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 用户症状 | 首页左右切换来源时有明显停顿，高刷新率场景尤其容易看出；网络即使异步，目标来源的 React 提交、FlashList/TopicCard 创建和布局仍会与 Pager 收尾帧重叠。 |
| 触发条件 | native Pager 的 `onIndexChange` 在完全 idle 前同步提交 Query 来源，或 inactive scene 为温缓存挂载另一棵 populated FlashList；分类、排序或阅读筛选再通过组合 `key` 重建整棵列表。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 的视觉来源、Query 来源、Pager idle 结算和列表物化边界；`src/features/feed/useFeedController.ts` 的来源切换入口。 |
| 必须保持的行为 | active scene 保留一棵完整 rich FlashList；所有 inactive scene 永远只渲染轻量 Loading，不读取缓存、不挂 TopicCard，也没有点击、刷新、分页、错误恢复、滚动或 accessibility 交互。`onIndexChange` 只更新视觉来源，完全 idle 后才提交最终 Query 来源；取消滑动零提交、零请求，未 idle 的连续选择只提交最终目标。idle 提交后才把目标 scene 从 Loading 物化成唯一真实列表。保留 `lazy` 与 `lazyPreloadDistance=1`；分类、排序和阅读筛选继续用稳定 active list 在提交前及下一帧滚顶，不 remount。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 要求相邻 Loading 预布局、idle 前零来源提交与零新增 FlashList mount、取消零副作用、连续选择只提交最终来源、远距离来源栏目标在 idle 前仍为 Loading，并要求任意时刻最多一棵 rich list；`REG-PERF-005` 固定 active Feed 的完整 TopicCard。`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 固定 Query 请求、identity barrier、迟到结果和当前来源隔离；`REG-FEED-002` 继续固定 active 稳定列表滚顶。 |
| 最低可靠自动测试层 | `UI_PASS`：必须通过真实 React state 和 TabView/FlashList 边界观察 idle 前后提交、scene 内容、列表 mount 与滚动；controller RNTL 固定 Query cache 和 transport 契约。源码字符串、单测 Query key helper 或 Debug 主观体验均不足以证明该行为。 |
| Replay 或真实验收路径 | 在同 revision、版本、APK、登录态和刷新率的 Release 构建上，对曾访问来源、冷来源、取消、连续反向、来源栏点击和六来源正反向切换；每次成功切换都等待本次合法 outcome 后再继续，确认旧标题零帧可见且恰好发生一次新请求。用三组 Perfetto 分开统计 drag、settling 和请求返回后的 active list 挂载；90Hz 模拟器证据必须确认 guest/SF cadence、主机承载刷新率和 exact APK，物理 90/120Hz 仍需真机补测。 |
| 负向验证方式 | 恢复 `onIndexChange` 直接提交 Query 来源、让 inactive scene 使用 live/cache data 或挂 FlashList、移除 lazy preload，或重新引入多来源 list ref/settled-frame 重置，编号 UI/controller oracle至少一项必须失败。 |
| 明确不覆盖范围 | 不证明第三方当天响应速度，不调整 Gateway、adapter、Query key、依赖、原生配置或 Feed `drawDistance`；90Hz 模拟器通过不替代物理 90/120Hz 真机的 GPU、触控和主观证据。 |

## `REG-PERF-004` 双温缓存 Feed 横滑触发过量 native 绘制（已被冷激活模型取代）

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 用户症状 | 相邻来源都有数据且已经预布局时，左右横滑仍有明显顿挫；请求时序正确也不能消除卡顿。 |
| 当前状态 | `SUPERSEDED_BY_REG-PERF-006 / FUNCTIONAL_PASS / STEADY_CONSECUTIVE_MISS_FAIL / COLD_FRAME_FAIL`。双温列表已不再是产品约束；当前同 revision 90Hz Release 稳态的 miss、RT p95 和阶段内长帧门槛通过，但一次 settling 出现连续两帧 miss，冷态短窗也未达 miss/RT 门槛，详见 `docs/emulator-baseline.md`。历史 rich/flat 数据只保留为根因证据；物理 90/120Hz 真机仍为 `NOT_VERIFIED`。 |
| 触发条件 | Android Pager 同时移动两棵 populated FlashList；旧 Feed TopicCard 每帧叠加圆角 badge/tag、Avatar 圆形裁剪与纹理、统计 SVG、分散文字、整行 alpha 和 ripple，RenderThread 主要耗在 Skia command flush。网络、Query 激活和持续 JS 阻塞均不是该路径主因。clipping 没减少视口绘制 op，临时整页 hardware layer 又把成本转成 buffer dequeue 与 layer flush。 |
| 根因 seam | 历史 seam 是 `src/ui/topic/TopicCard.tsx` 的 rich 绘制成本与 `src/features/feed/FeedScreen.tsx` 同时移动两棵 populated FlashList；当前方案删除后一项，不削减 TopicCard、Query、Gateway、Feed transport 或身份屏障。 |
| 必须保持的行为 | Feed、Search、Library 和 User 使用同一个完整 rich TopicCard：来源/分类/访问徽章、彩色标签、标题、摘要、作者头像与等级、时间、收藏/已读、同链来源、回复/浏览图标和统计、整卡点击反馈均保留。Feed 任意时刻最多一棵 active rich list，inactive 永远 Loading；`REG-PERF-003/006` 的导航先行、idle 冷激活、每次成功切换一次新请求、取消零请求继续保持。筛选滚顶、Topic 返回位置、刷新、分页和错站防护不得降级。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 的 `REG-PERF-005` 固定 active Feed 内独立徽章/标签、Avatar、摘要、作者元数据、统计、已读样式和 Android ripple，`REG-PERF-003/006` 固定 inactive Loading、单 rich list 和 idle 激活。同 revision、同 APK 的 Release Perfetto 分开统计 drag、settling 与请求返回后的列表挂载。历史 final-structural rich 基线的 drag 中位 miss / FT p95 / RT p95 为 `10.24% / 36.07ms / 20.81ms`，settling 为 `5.42% / 32.53ms / 20.14ms`；旧基线中的 `9.62% / 35.65ms / 20.57ms` 是时间窗统计，两种口径不混算且 FAIL 结论一致。flat 实验曾显著降低绘制但违反 `REG-PERF-005`，只能作为根因证据。 |
| 最低可靠自动测试层 | `UI_PASS` 只能固定 React/native 边界行为；绝对帧门槛只能由匹配 revision、APK 和刷新模式的 Release trace 证明，Debug、源码检查或主观改善不能替代。 |
| Replay 或真实验收路径 | 固定 A↔B 成功切换并采集三组 Perfetto，每次等待本次请求 outcome 后再进行下一次；分别统计 drag、settling 与请求返回后的 active list 挂载。三组 drag/settling 中位 FrameTimeline miss 不高于 5%，任一组不高于 7.5%，每组 RenderThread `DrawFrames` p95 不高于 16.7ms，且无超过 50ms 帧或连续两帧 miss。另做冷页、取消、连续切换、六来源正反向和快速纵滑，要求零白屏、错站、旧列表回显或内存持续增长；每次完成切换的一次新请求属于预期。 |
| 负向验证方式 | 任何候选只要存在白屏、错站、额外请求、PSS/Graphics 增长超过 20MB、纵滑恶化超过 10%，或上述三组帧门槛任一失败，都必须回退；不能用相对改善掩盖绝对门槛失败。环境明确造成的 raw wall-clock 背压不得伪装成产品代码修复，需由用户决定是否改用排除 `dequeueBuffer` 等待的 CPU 绘制口径。 |
| 明确不覆盖范围 | 两次自动手势之间的 idle 长帧不能冒充横滑失败，也不能据无 CPU stack sample 的证据猜测式修改。flat-card 的 60/90Hz 数据不代表 rich 实现；物理 90/120Hz 真机 GPU、触控和主观验收仍为 `NOT_VERIFIED`。 |

## `REG-PERF-005` Feed 性能优化不得删减列表信息或视觉层级

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 用户症状 | 横滑优化后 Feed 条目省略头像、图标、徽章背景、标签层级和点击/已读效果，并把多类信息压成单行；内容虽仍在字符串里，实际列表已不是优化前的样式。 |
| 触发条件 | Feed 给共享 `TopicCard` 传入 `feedLayout`，走一棵专用 flat render tree；对应测试只验证合并文本，反而把产品回退固化为性能契约。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 到 `src/ui/topic/TopicCard.tsx` 的 presentation 分叉，以及 `TopicCard` 自持的扁平列表样式。 |
| 必须保持的行为 | Feed 与其他 Topic 列表复用同一完整 rich TopicCard；性能实现只能改变用户不可见的调度、缓存或绘制方式，不得合并、隐藏、截断或重排既有信息，也不得删除 Avatar、徽章/标签背景、统计 icon、整卡已读状态和 ripple。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 用真实 Feed scene 同时断言独立来源/分类/访问徽章、前三个标签与 `+N`、摘要、作者头像/等级/收藏/同链、回复/浏览统计及整卡已读样式。该测试在 flat 分支上必须失败，并在完整 TopicCard 上通过。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经过 FeedScreen 到 TopicCard 的真实渲染边界；TopicCard 单独通过或 DTO 字段仍存在都不能证明 Feed 没有选用另一套 presentation。 |
| Replay 或真实验收路径 | Release APK 在首页逐站检查普通、已读、收藏、带标签、带访问限制和有头像条目；与 v1.3.85 的同主题截图逐项对照，再执行 `REG-PERF-004` 横滑 trace。 |
| 负向验证方式 | 恢复 `feedLayout` 或任一 Feed 专用信息合并分支，`REG-PERF-005` UI oracle 必须失败。 |
| 明确不覆盖范围 | 该回归固定内容和视觉合同，不单独证明帧性能；性能仍由 `REG-PERF-004` 的 Release trace 判断。 |

## `REG-PERF-006` Feed 目标列表先出现但二级导航慢一步，温缓存阻止重读

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 用户症状 | 左右横滑时目标列表已经可见，顶部来源和二级导航却仍停在旧来源，稍后才一起变化；离开再返回已访问来源时还直接复用旧列表，没有重新请求。 |
| 触发条件 | incoming scene 命中目标 exact-key 温缓存，Pager 在 `onIndexChange` 后先显示该 preview，但导航继续由 idle 后的 active `feedSource` 驱动；全局 `staleTime: Infinity` 与 `refetchOnMount: false` 又让目标温缓存抑制新 transport。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 把视觉来源与 Query 来源混为同一生命周期，并允许 inactive scene 展示缓存列表；`src/features/feed/useFeedController.ts` 在来源切换时没有清除目标来源全部 Feed Query 变体。 |
| 必须保持的行为 | `onIndexChange` 后同一 render 内，顶部来源、二级导航类型、目标分类、该站已保存排序和二级栏 reset key 都立即属于视觉目标；Query 来源仍不变，目标 scene 仍为 Loading，来源提交与 transport 都为零。pending 期间二级控件只读、旧排序菜单关闭，顶部来源栏仍可连续选择；完全 idle 后只提交最终目标。每次真正完成的横滑或来源栏切换先删除目标来源所有 `forum → source → feed` 分类/排序 Query，再从空 active list 请求一次；点击当前来源、取消滑动为零请求。旧目标列表、旧错误、在途或迟到结果均不得回显；identity barrier 未解除时保持 Loading/auth，解除后只请求一次。Categories、阅读筛选和各站排序偏好继续保留；active 同 key 刷新失败仍保留可信列表与 cursor。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 要求 `onIndexChange` 后顶部与二级导航同步指向目标，目标缓存分类与保存排序正确，pending 二级控件无回调且顶部来源仍可继续选择；inactive 与 lazy materialize 都显示既有 Loading，缓存标题不可见、idle 前零新 FlashList mount、idle 后只挂目标 active list，任意时刻最多一棵 rich list。`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 预置目标 Categories 及默认、分类和其他排序 Feed 缓存，要求 Categories 继续提供给视觉目标，同时切换时旧 topic 从未进入 active items、所有非 active 目标 Feed 变体被移除、transport 恰好一次；离开再返回请求次数再次增加，相同来源 no-op，identity barrier 与迟到结果仍隔离。 |
| 最低可靠自动测试层 | `UI_PASS`：FeedScreen RNTL 固定单 render 导航、scene 与 mount 边界，controller RNTL 固定 Query cache、barrier、AbortSignal/迟到结果和 transport 次数；源码检查、Debug 主观体验或单独 Query key 测试均不足。 |
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 执行“全部 → V2EX → 全部”，每次等待目标 selected 与本次合法 outcome。匹配 revision 的 90Hz Release 模拟器再覆盖曾访问/冷来源、取消、连续反向、来源栏点击和六来源正反向，检查旧标题零帧可见、导航不慢一步、每次完成切换一次新请求；性能门槛沿用 `REG-PERF-004`。 |
| 负向验证方式 | 让二级导航继续读取 active `feedSource`、恢复 `feedScenePreviews`/Query cache subscription、取消目标 Feed cache 清理或让 inactive scene 挂 FlashList，编号 UI/controller oracle必须失败。 |
| 明确不覆盖范围 | 不改变 Gateway、Query key 结构、全局 `staleTime`、站点协议、依赖或原生配置；不证明第三方当天响应速度，也不以限流为由自动重试或恢复缓存。 |

## `REG-PERF-008` 嵌套 Topic 共用 presentation 且大正文同步挂载阻塞返回

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 用户症状 | 从评论里的跨主题链接进入大主题后，在“正在读取主题”期间点击顶栏或 Android 返回没有立即离开；加载完成后返回也可能先闪白/灰空页。超长 opening body 虽然被分块，进入和返回时仍有明显同步卡顿。 |
| 触发条件 | 多个 native Topic route 共用一个全局 renderer/session/list ref，使 A、B route 同时消费当前 B presentation；native-stack 保留上一 route 时，A 没有自己的可视内容可立即恢复。超长 opening body 又在 FlashList `ListHeaderComponent` 中同步挂载全部 chunk；读取端与展示端对同一正文重复 DOM parse，普通 chunk 还逐个解析“是否纯视频”，任意 topic 对象更新也会重跑整篇拆分。 |
| 根因 seam | 旧全局 Topic runtime、presentation cache 与共享 list ref 让多个 native route 同时消费当前主题；详情列表又曾在 FlashList header 同步挂载全部 opening body chunk。当前 seam 是 `src/features/topic/TopicRoute.tsx` 的 route-local controller 与 `src/features/topic/components/TopicContentList.tsx` 的 list item/memo 输入边界。 |
| 必须保持的行为 | 每个 Topic route 以完整 canonical `Topic` 参数创建独立 controller 和 list ref；只有 focused route 启动 Query、交互和原图升级，epoch 变化由 Query key 隔离旧数据。opening body chunk、正文后控件和回复作为同一 FlashList data 按 render window 挂载；正文/polls/source 未变时不得因点赞或收藏对象更新重拆正文。返回只 dispatch native pop，returning route 直接显示自身 mounted state；迟到 B 结果不得覆盖 A，A 的筛选、展开引用、草稿、回复页和滚动位置保持。 |
| 精确失败 oracle | `tests/ui/app/app-navigator.test.tsx` 固定 A/B route state、inactive 原图暂停、User/ReadingSettings 返回和 overlay 返回优先级；`tests/ui/topic/topic-session-controller.test.tsx` 固定 route controller、Query/epoch 隔离与取消；`tests/ui/topic/topic-reply-filters.test.tsx` 固定 opening-body item 位于 FlashList data、mounted-cell 原图 gate，以及正文未变时不重复 split。HTML 与来源集成测试继续固定单次 DOM parse 和取消边界。 |
| 最低可靠自动测试层 | `UI_PASS` 固定 route instance 隔离、非交互边界、真实 React state 和正文 list shape；native transition 的空白帧与超长正文实际挂载成本仍须匹配 APK 的模拟器/设备只读验收。 |
| Replay 或真实验收路径 | 保留 App 数据直达 `https://linux.do/t/topic/2685882`，点击首条跨主题引用标题，在目标仍显示 Loading 时立即返回；必须一次返回到原主题且旧内容、筛选与滚动可用。目标若已命中缓存，覆盖进入后立即返回和加载完成后返回；全程只读。 |
| 负向验证方式 | 恢复全局 Topic controller/shared list ref、允许 inactive route 请求或继续升级原图、跨 epoch 复用缓存，或把 opening-body chunk 移回 ListHeader 全量 `map`，编号 UI oracle 必须失败。恢复 LinuxDo 双重 sanitizer parse、普通 chunk 逐个 video parse、整 topic 对象 memo 依赖或取消前不让出事件循环，对应性能 oracle 必须失败。 |
| 明确不覆盖范围 | 不以关闭动画、延长 Loading、禁用链接、预取整篇大主题、额外 memo/cache 或 idle prewarm 掩盖问题；第三方响应速度和物理高刷绝对帧指标分别记录，不执行真实论坛写操作。 |

## `REG-FEED-001` 首次加载出现两套 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04` |
| 用户症状 | 首页首次读取空列表时，页面 Loading 与 Android 下拉刷新指示器同时出现；Smoke 仍可继续并最终通过。 |
| 触发条件 | `busy=true`、`feedItems=[]`，列表已挂载且同时提供 `RefreshControl`。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 的空态与 `refreshControl` 渲染契约。 |
| 必须保持的行为 | 空数据首次加载只显示页面 Loading；已有列表或主动刷新时保留 `RefreshControl`。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 同时断言 Loading 数量和 RefreshControl 是否存在。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染 React Native 组件；源码字符串或 `APK_SANITY` 都无法证明 Loading 唯一。 |
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 只证明聚合 Feed 当前请求能进入合法 outcome；Loading 唯一由 UI 测试证明，真实主题打开与返回由 Agent Live。 |
| 负向验证方式 | 临时让空列表 busy 状态也挂载 RefreshControl，UI 测试必须失败，随后还原。 |
| 明确不覆盖范围 | 实时来源速度、分页数据正确性和五站解析由 `FEED-*` 其他测试与 Live 验收负责。 |

## `REG-FEED-002` 切换来源或排序后列表没有回到顶部

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | NodeSeek 从“新帖子”切到“新评论”后已有主题却看不到新列表首项，Replay 曾被误判为动态 Feed 无结果。 |
| 触发条件 | 旧列表已离开顶部，来源、分类、排序或阅读筛选变化后替换数据；稳定 FlashList 继续持有滚动位置，单次 effect 滚顶可能早于新数据布局完成。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 的单 active 列表 ref 与显式滚顶契约，以及 `src/ui/list/performance.ts` 的 Feed FlashList 位置策略。 |
| 必须保持的行为 | 来源切换挂载空的目标 active list 并从首项开始；同一来源内分类、排序或阅读筛选变化时，稳定列表也必须回到首项，不保留上一组合的可视锚点。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 要求来源 idle 提交后只挂载目标 active list；再把同来源稳定列表滚离顶部后分别切换排序、分类和阅读筛选，要求提交 callback 前先执行一次 `animated=false` 滚顶、下一帧再补一次，首项重新可见且这些同来源筛选变化不增加 FlashList mount 数；`src/ui/list/performance.test.ts` 要求 Feed 禁用 `maintainVisibleContentPosition`。 |
| 最低可靠自动测试层 | `UI_PASS` 固定筛选变化前后的滚顶时序、首项和稳定列表实例，`UNIT_PASS` 固定 FlashList 配置；动态列表当天是否非空不能作为设备级固定前置。 |
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 只确认五站入口和聚合 Feed outcome；真实 Android 上的来源/排序滚顶由 Agent Live 在找到非空目标时核对，缺少动态目标记该项 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除提交前或下一帧任一滚顶、恢复筛选组合 `key` 造成 remount，或移除 `maintainVisibleContentPosition: { disabled: true }`，对应 RNTL/Vitest 必须失败。 |
| 明确不覆盖范围 | 不固定动态主题标题、数量或来源当天可用性；这些仍按 Replay 动态结果规则与 Live 验收。 |

## `REG-FEED-003` 小隐寺排序菜单为空

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 小隐寺独立 Feed 可以读取，但点击“列表筛选”只出现空弹层，无法切换“热门”或“新内容”。 |
| 触发条件 | 当前来源为 `xiaoyinsi`，且 `shouldUseFeedFilter` 已允许显示按钮，但菜单分组白名单仍只包含原有三个排序来源。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 的排序按钮可见条件与 `feedFilterMenuGroups` 取值条件没有使用同一来源集合。 |
| 必须保持的行为 | 小隐寺在全部分类和任一站内分类下都显示独立“最新/热门/新·所有/新·话题/新·回复”菜单；选择后关闭弹层、更新来源自己的排序状态并重新加载首项，不影响其他来源。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 切换到小隐寺，打开“列表筛选”并选择“新·回复”，再切分类确认菜单仍可用；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 证明选择后真实请求使用 `new-replies`。 |
| 最低可靠自动测试层 | `UI_PASS` 固定菜单内容和分类组合，controller UI 测试固定实际请求；只测 `feedFilterMenuGroups` 常量或只看按钮存在会漏掉空弹层。 |
| Replay 或真实验收路径 | Agent Live 在小隐寺独立 Feed 打开“列表筛选”，分别选择“热门”和一个“新”筛选，等待当前请求进入明确 outcome；有数据时打开首条主题，未授权时 `/new.json` 的登录提示也必须明确。 |
| 负向验证方式 | 从 `activeFeedFilterMenuGroups` 的来源集合移除 `xiaoyinsi`，UI 用例必须在找不到“新·回复”时失败；恢复后 controller 用例仍必须请求 `feedFilter=new-replies`。 |
| 明确不覆盖范围 | 原站热门排序当天的主题数量和标题仍属动态 Live 数据，不固定为测试夹具。 |

## `REG-FEED-004` 单站刷新失败清空可信列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 单站首页已经显示主题，用户下拉刷新遇到来源错误后，旧列表和下一页 cursor 被空失败响应覆盖，只剩错误提示。 |
| 触发条件 | 首屏刷新返回 `items=[]` 与站点 `errors`；controller 在判断错误前无条件执行 response apply。分页已有失败门禁，但 `reset/nocache` 路径没有复用。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的错误响应应用边界，位于可信 `requestBaseState` 与 `nextFeedPageState` 提交之前。 |
| 必须保持的行为 | 单站首屏或刷新返回来源错误时不应用响应，保留原列表、页码和 cursor，并显示可重试错误。聚合首屏只有确有成功条目时才应用 partial；聚合分页继续禁止混入半页结果。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-004` 先加载带下一页 cursor 的 V2EX 列表，再让同站刷新返回空错误，要求主题和 cursor 均保持；修复前两者被清空。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 hook state 必须跨两次请求验证旧列表和 cursor；只看错误 Toast 或 trace 终态不能证明可信内容未被覆盖。 |
| Replay 或真实验收路径 | 不主动制造来源故障；正常单站下拉刷新继续只读验收，自然失败时核对旧列表仍可见。 |
| 负向验证方式 | 恢复错误判断前的无条件 `applyFeedResponse(data)`，编号测试会收到空列表和丢失 cursor。 |
| 明确不覆盖范围 | 不把不同来源、分类或排序的旧列表保留到新请求 key，也不缓存跨启动的远端 Feed。 |

## `REG-SOURCE-001` 聚合读取被单站凭据存储失败整体阻断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 用户症状 | 任一来源凭据存储临时读取失败时，“全部”首页或搜索可能在发起站点请求前整体失败；linux.do 还可能把读取失败伪装成无凭据，继续匿名请求并隐藏错误。 |
| 触发条件 | 读取进入 `readGateway`，某个单站 Cookie、User API 或 linux.do 凭据探针抛错；旧聚合实现让异常整体逃逸，而 linux.do 独立分支吞掉异常后匿名继续。 |
| 根因 seam | `src/sources/readGateway.ts` 的聚合凭据装配与来源错误合并边界。 |
| 必须保持的行为 | 单站读取的凭据失败仍明确失败；`all` 聚合读取只把失败记录到对应来源的 `errors`，其余来源继续使用已取得或匿名凭据读取，Query trace 终态提升为 `partial`。linux.do 存储未知不得被当成确定无凭据。 |
| 精确失败 oracle | `src/sources/readGatewayContract.test.ts` 同时让 linux.do、NodeSeek、妖火和小隐寺凭据 loader 抛错，要求公开主题仍返回、四个错误各自归属且请求不携带失败凭据；linux.do 单源读取必须 rejection。 |
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
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 固定单站和聚合分页不进入 apply；`tests/ui/search/search-controller-ai.test.tsx` 固定搜索第 2 页解析为空后仍重试第 2 页，并固定整站重试解析为空时保留已有结果和 cursor；`tests/ui/topic/topic-session-controller.test.tsx` 与 `tests/ui/user/user-controller-session.test.tsx` 固定详情和用户资料解析为空不落地。 |
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
| 根因 seam | `src/sources/xiaoyinsi/reader.ts` 的共享分类映射；旧实现只从当前响应取字典，没有在 ID 缺失映射时回填小隐寺 `/site.json`。 |
| 必须保持的行为 | 当前响应未携带所需分类时，小隐寺 Adapter 独立读取 `/site.json` 并按字符串 ID 回填；分类请求失败不得抹掉已成功读取的主题。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 的列表、详情、搜索和用户夹具只提供 `category_id`，分类名仅由 `/site.json` 提供；四条路径都必须得到“生活”。 |
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
| 根因 seam | `src/features/topic/composer/formatting.ts` 的格式能力集合与 `ReplyComposerSheet` 的来源上传回调边界。 |
| 必须保持的行为 | 小隐寺显示与 NodeSeek/linux.do 一致的 Markdown 常用格式和图片入口；点击图片只调用上传回调，不提交回复；妖火仍使用 UBB，V2EX 仍只读。 |
| 精确失败 oracle | `src/features/topic/composer/formatting.test.ts` 的 `REG-XIAOYINSI-002` 固定 Markdown 工具栏；`tests/ui/topic/reply-composer.test.tsx` 同编号用例固定四个可写来源的图片回调。 |
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
| 根因 seam | `src/sources/xiaoyinsi/actionRequest.ts` 的书签取消请求构造，以及 `src/features/topic/actions/useTopicActionsController.ts` 的前置门禁。 |
| 必须保持的行为 | Topic 缺少记录 id 时使用 Discourse 主题级 `PUT /t/{topicId}/remove_bookmarks`；Post 取消仍要求具体记录 id；主题收藏先显示目标 optimistic 状态，请求失败恢复原状态，服务端确认后补丁精确 Topic Query cache 与当前 route state，不整篇重载。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/actionRequest.test.ts` 与 `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-XIAOYINSI-003` 分别固定请求、optimistic apply、失败 rollback 和真实 controller 路由。 |
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
| 根因 seam | `src/sources/xiaoyinsi/account.ts` 的用户身份摘要与用户发帖列表生命周期被混为一个接口。 |
| 必须保持的行为 | 身份与计数继续读取 summary；主题独立读取 `/topics/created-by/{username}.json`，作者取该响应用户表，并保留 `more_topics_url` 分页。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 的 `REG-XIAOYINSI-004` 给 summary 注入非本人主题，要求页面只返回 created-by 两页数据。 |
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
| 根因 seam | `src/features/account/useXiaoyinsiAuthController.ts` 的授权生命周期所有权与 `src/sources/xiaoyinsi/auth.ts` 的解密持久化、撤销提交边界。 |
| 必须保持的行为 | 有效 pending 优先恢复；开始重授权、取消、撤销或卸载 hook 时同步失效轮询与旧 session 复核，且 mutation 整个进行期间不得启动新 poll 或再打开已作废授权页，迟到结果不得改写新状态；服务端撤销失败保留本机 Token，成功后先留下清理 tombstone、尝试全部本机删除并明确报告 partial；重启必须先重试清理，绝不能恢复 tombstone 后的旧 Device Code。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/auth.test.ts` 与 `tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-005` 覆盖迟到解密、迟到 session 复核、进程恢复、取消前已运行及取消中从后台返回才调度的 poll、取消中打开旧授权页、部分清理、tombstone 和重启时清理优先级。 |
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
| 根因 seam | `src/domain/forum/searchFilters.ts` 在服务端筛选之后重复应用了语义不同的共享分类过滤。 |
| 必须保持的行为 | 小隐寺分类由原站查询决定，保留其父/子分类语义；其他来源已有本地过滤契约不变。 |
| 精确失败 oracle | `src/domain/forum/searchFilters.test.ts` 的 `REG-XIAOYINSI-006` 输入父分类 4 和服务端返回的子分类 15，要求结果保留。 |
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
| 根因 seam | `src/sources/xiaoyinsi/reader.ts` 权限映射、Topic/Reply 操作栏、`topicActionControllerHelpers` 写门禁及 `src/sources/readGateway.ts` 会话复核。 |
| 必须保持的行为 | 新回复严格要求登录且 `can_create_post=true`；编辑/删除/点赞按逐条权限独立显示，已点赞仍可取消；已带 Token 的读取遇到 401/403 先用 `/session/current.json` 复核，单主题 403 不直接退出，确认失效才更新账号状态。浏览器 Cookie 不属于 App User API 会话，也不得进入 `cookieSummary` 或任何状态判断。 |
| 精确失败 oracle | `src/features/topic/actions/actionHelpers.test.ts`、`src/sources/readGatewayContract.test.ts`、`tests/ui/topic/topic-components.test.tsx` 和 `tests/ui/topic/topic-reply-filters.test.tsx` 的 `REG-XIAOYINSI-007` 分别固定数据门禁、单站/聚合复核和用户可见按钮矩阵。 |
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
| 根因 seam | `src/sources/xiaoyinsi/reader.ts` 的回复响应与 `src/features/topic/useTopicController.ts` 的 after-submit 计数合并。 |
| 必须保持的行为 | 小隐寺回复响应返回不含首帖的 `totalCount`；写后刷新优先采用该权威值，其他来源没有该字段时保留既有启发式。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-XIAOYINSI-008` 通过真实 Replies Query 把旧值 100 更新为服务端 7；`src/sources/xiaoyinsi/reader.test.ts` 固定 stream 到 `totalCount` 映射。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Adapter 固定来源映射，真实 `QueryClientProvider` controller 测试固定权威值写入精确 Topic cache；单次 UI 数字无法证明来源权威性。 |
| Replay 或真实验收路径 | 不发送真实回复；只读主题进入、分页与刷新检查服务端总数一致。真实回复永久排除 Agent 自动验收。 |
| 负向验证方式 | 删除 `totalCount` 或强制调用旧值加一，编号测试必须得到 101 并失败。 |
| 明确不覆盖范围 | 不授权真实评论；原站并发新增/删除回复造成的实时变化由下一次权威刷新处理。 |

## `REG-XIAOYINSI-009` 已点赞帖子显示取消入口但控制器拒绝取消

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 小隐寺已点赞帖子显示“取消赞”，点击后却提示当前帖子不能点赞，原站状态没有变化。 |
| 触发条件 | Discourse 对已执行的点赞返回 `acted=true`、`can_act=false`；UI 用 `liked` 正确保留取消入口，但 controller 只看 `canLike=false`。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 把“不能新增点赞”和“不能撤销已有点赞”合并成同一个前置门禁。 |
| 必须保持的行为 | 未点赞且 `can_act=false` 时继续禁止点赞；`liked=true` 时允许发送 DELETE 取消点赞，即使 `can_act=false`；点赞切换先显示目标 optimistic 状态，请求失败恢复原状态，服务端确认后补丁目标帖子 Query cache，不整篇重载。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-XIAOYINSI-009` 使用 `liked=true`、`canLike=false`，要求先应用取消状态、发送一次 DELETE，并在失败路径恢复原点赞状态。 |
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
| 根因 seam | `src/sources/xiaoyinsi/reader.ts` 的 Topic/Posts 读取请求没有把独立 User API 会话与可编辑原文请求绑定，测试夹具又无条件提供 `raw`，掩盖了真实响应差异。 |
| 必须保持的行为 | 只有同时具备小隐寺 User API Key 与 Client ID 的 Topic/Posts 读取添加 `include_raw=1`，并把 `raw` 映射为回复 `contentMarkdown`；匿名公开阅读不请求编辑原文，仍完整显示 cooked HTML。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 的 `REG-XIAOYINSI-010` 让测试服务端只在收到 `include_raw=1` 时返回 `raw`，要求认证详情、分页回复和楼层读取得到 Markdown，同时匿名请求不带该参数。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过 Adapter 请求构造和响应映射；UI 中只看见“编辑”按钮或给夹具硬编码 `raw` 都不能证明真实编辑链路可用。 |
| Replay 或真实验收路径 | 已授权 App 打开原站允许编辑的本人回复，确认编辑器预填原 Markdown 后取消，不提交任何修改；匿名主题继续只读可见。 |
| 负向验证方式 | 从认证 Topic 或 Posts 请求移除 `include_raw=1`，测试服务端将不返回 `raw`，认证回复的 `contentMarkdown` 断言必须失败。 |
| 明确不覆盖范围 | 不自动执行真实编辑或删除；原站是否长期授予某条回复编辑权限仍由动态权限字段决定。 |

## `REG-XIAOYINSI-012` 点赞、收藏等写操作导致整个主题闪烁重载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02`、`WRITE-03` |
| 用户症状 | 小隐寺点击点赞或收藏后，主题正文和回复整体进入重新加载；回复删除、投票等同类操作也会丢失当前可视上下文。 |
| 触发条件 | User API 写请求已经由服务器确认，但 controller 仍统一调用 `refreshWholeTopic`，而不是只 patch 精确 Query cache 与定向刷新回复。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的小隐寺写后处理没有把 action 结果限定在精确 Topic/Replies Query cache，而是把所有 action 都接到整篇 Topic 重读。 |
| 必须保持的行为 | 小隐寺身份与请求继续只走独立 User API Key；点赞/取消和主题书签/取消先显示 optimistic 状态、失败 rollback、确认后同步权威状态；投票在服务器确认后局部更新，删除先本地移除再静默刷新回复切片；均补丁精确 Query cache，不刷新整篇主题。回复与编辑仍沿用既有定向回复刷新。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-XIAOYINSI-012` 分别固定点赞、取消点赞、收藏取消的 optimistic/rollback，以及投票与删除的精确 Query cache patch；删除、编辑只允许失效 Replies Query，不得失效 Topic detail。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：领域 helper 固定局部 patch，真实 `QueryClientProvider` controller 测试固定 mutation cache 与写后失效边界，Topic session UI 测试固定返回路径不会恢复旧快照；只验证 HTTP 成功无法发现整页重载。 |
| Replay 或真实验收路径 | 获得逐次可恢复写操作授权后，记录初态并切换一次点赞或收藏，确认正文、回复列表和滚动上下文不进入整页 Loading，刷新核对原站后恢复初态。投票、编辑和删除不因本条默认获得真实写入授权。 |
| 负向验证方式 | 把任一小隐寺 action 恢复为 `refreshWholeTopic`、移除对应精确 Query cache patch，或让点赞/书签失败后保留目标状态，编号 controller 测试必须失败。 |
| 明确不覆盖范围 | 不把小隐寺接入任何 Cookie/WebView 登录；只对可恢复的点赞/书签做可回滚 optimistic 展示，投票、删除和权限不得乐观推断或伪造。 |

## `REG-XIAOYINSI-013` 已授权小隐寺缺少等级入口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-06` |
| 用户症状 | 账号中心已能识别小隐寺用户并显示 `Lv`，但站点服务区没有“小隐寺 等级”，无法查看等级进度和活跃数据。 |
| 触发条件 | 新来源只向账号中心注入 Device Code 授权面板，没有接入项目已有的 Discourse 等级展示；或 Account Query 已识别授权，但 Gateway 仍用不再承载远端身份的 workflow `SiteSessionState` 拒绝加载 SecureStore 凭据。 |
| 根因 seam | `src/features/more/MoreScreen.tsx` 的小隐寺 `siteContent`、`src/features/account/useXiaoyinsiAuthController.ts` 的 User API 读取状态、`src/features/account/useAccountRuntime.ts` / `src/features/account/useSessionReadGateway.ts` 的 Gateway 凭据装配和 `src/sources/xiaoyinsi/account.ts` 的当前用户 summary 转换。 |
| 必须保持的行为 | 已授权小隐寺显示独立等级入口，通过保存的 User API Key 读取 `/session/current.json` 与当前用户 summary；Gateway 直接以 SecureStore 凭据和 credential generation 为准，不以 Account Query 之外的旧 session projection 阻断读取。只共享等级展示和纯转换，不读取 linux.do Cookie、Connect 或浏览器状态。未授权时明确引导 Device Code 授权。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 固定已登录小隐寺站点服务区存在等级入口；`tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 固定 SecureStore 凭据路由，并以 `REG-ACCOUNT-016` 证明 Account 只读检查返回事件但不发布 workflow state；`src/sources/xiaoyinsi/reader.test.ts` 固定 User API headers、两个端点和等级/活跃数据映射；`tests/tooling/android-smoke-guard.test.ts` 固定 `account-readonly.ad` 点击“查看等级”一次，先等待 profile/error 专用的 `xiaoyinsi-level-settled`，再确认成功/错误共有的“刷新等级”，同时要求 `more-readonly.ad` 不发起等级读取。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Adapter 固定独立传输，controller 固定状态，RNTL 固定真实入口。 |
| Replay 或真实验收路径 | `tests/device/account-readonly.ad` 在保留小隐寺授权的设备选中站点、点击“查看等级”一次，等待 `xiaoyinsi-level-settled` 后确认“刷新等级”；`more-readonly.ad` 只覆盖本地 More 旅程。真实等级与活跃数据按 `tests/live/agent-live.md` 的 `LIVE-ACCOUNT-04` 分轴核实。不得清数据或打开浏览器登录。 |
| 负向验证方式 | 移除小隐寺 `siteContent` 的等级菜单、用 workflow session 的登录投影拦截 Gateway 凭据、改用无 User API headers 的 fetch、把 controller 改读 linux.do Cookie，或让 tracked Replay 不发请求、等待成功专属数据或自动复试；对应自动测试必须失败。 |
| 明确不覆盖范围 | 小隐寺没有 linux.do Connect 服务，因此展示基于当前站 summary 的 Discourse 参考进度；不伪装成原站官方晋级判定。 |

## `REG-XIAOYINSI-014` 小隐寺等级入口被授权管理淹没

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-06` |
| 用户症状 | 已授权小隐寺虽然存在等级入口，但它位于长授权说明之前，与重新授权和撤销授权挤在一起，主次不清，用户不容易识别。 |
| 触发条件 | 小隐寺账号卡片同时显示主页、授权原理、授权操作和等级服务；新增等级时只按接线顺序插入，没有按稳定使用频率和风险重新分组。 |
| 根因 seam | `src/features/more/MoreScreen.tsx` 的小隐寺 `siteContent` 顺序，以及 `src/features/more/components/XiaoyinsiAuthPanel.tsx` 在已授权状态仍展示完整授权引导。 |
| 必须保持的行为 | 已授权账号顶部保留身份与主页，中部以简短说明承载重新授权和撤销授权，底部用分隔线独立显示“查看等级”；展开后仍读取等级进度和活跃数据。未授权、授权中和清理状态继续显示完整 Device Code 或清理说明。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 的 `REG-XIAOYINSI-014` 固定已授权文案、授权操作先于“查看等级”的渲染顺序，以及点击后仍调用等级刷新。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染真实账号中心并检查用户可见顺序；源码字符串或单独测试等级请求无法证明入口层级。 |
| Replay 或真实验收路径 | `tests/device/account-readonly.ad` 在保留授权的设备进入小隐寺账号卡片，点击底部“查看等级”一次，等待 profile/error 结算标记后确认“刷新等级”；展开后的动态等级数据按 `LIVE-ACCOUNT-04` 分轴核实。`more-readonly.ad` 不读取等级；不得撤销或重建授权。 |
| 负向验证方式 | 把等级菜单移回授权面板之前，或在已授权状态恢复完整一次性授权引导，编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不改变 Device Code、User API Key、Keystore、会话失效或等级计算；未授权流程仍保留完整安全说明。 |

## `REG-XIAOYINSI-015` 小隐寺最新与热门复用同一非空列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 小隐寺“最新”已加载出主题后切换“热门”，页面继续显示最新列表且不发热门请求；反向切换也可能复用旧列表。 |
| 触发条件 | 同一小隐寺分类已有非空 Feed state，再切换 latest/hot 或其他来源筛选；控制器用请求 key 判断是否可复用。 |
| 根因 seam | `src/domain/forum/feed.ts` 的 `feedRequestKey` 只把 linux.do、V2EX 和 NodeSeek 的筛选写入请求身份，漏掉已经拥有独立排序的小隐寺；后续 `shouldReuseFeedStateForRequest` 因而把两个筛选误判为同一请求。 |
| 必须保持的行为 | 小隐寺来源、分类或列表筛选任一变化都必须产生独立请求身份；切换后回到首项并读取目标筛选，旧请求不得覆盖；其他来源现有复用规则不变。 |
| 精确失败 oracle | `src/domain/forum/feed.test.ts` 的 `REG-XIAOYINSI-015` 先建立同来源同分类但 latest/hot 不同的请求 key，修复前错误返回可复用；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 使用非空响应，依次选择 hot 和 new-replies，要求 Gateway 收到各自真实筛选。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定请求 key 与状态复用规则，`UI_PASS` 固定非空真实 controller 生命周期；只测菜单常量或空列表会绕过复用分支，不能拦住本缺陷。 |
| Replay 或真实验收路径 | Agent Live 在身份匹配的 App 中进入小隐寺，先等待“最新”请求进入明确 outcome，再切“热门”及一个“新”筛选；有数据时打开首条，无数据或权限阻碍按数据轴报告。全程只读，不固定动态标题或数量。 |
| 负向验证方式 | 从 `feedRequestKey` 的筛选来源集合移除 `xiaoyinsi`，编号单元测试会得到相同 key，非空 controller 用例不会发出后续筛选请求。 |
| 明确不覆盖范围 | 不保证原站各筛选当天都有非空主题；未授权 `/new.json` 可能要求登录，该动态权限结果由 Live 验收记录，不用假数据降级成 latest。 |

## `REG-XIAOYINSI-016` 小隐寺标签候选携带 limit 后固定失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-03`、`SEARCH-04` |
| 用户症状 | 小隐寺高级搜索能打开分类候选，但进入“标签”只显示“标签候选加载失败”，点击重试仍失败。 |
| 触发条件 | App 请求小隐寺 `/tags/filter/search` 时沿用 linux.do 的 `limit=8` 参数；当前原站对任意 `limit` 返回 HTTP 400“Limit 无效”。 |
| 根因 seam | `src/sources/xiaoyinsi/search.ts` 的 `searchXiaoyinsiTags` 复制了另一 Discourse 站点的候选请求参数，没有按本站真实端点契约分离传输差异。 |
| 必须保持的行为 | 小隐寺标签候选继续携带本站独立 User API 凭据、查询、分类和已选标签，但不发送原站拒绝的 `limit`；Adapter 在解析、去重后按调用方上限本地截断。linux.do 请求不变。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 的 `REG-XIAOYINSI-016` 在请求含 `limit` 时返回同原站一致的 400，并返回多于调用方上限的成功样本；要求最终请求无 `limit` 且只保留指定数量。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定站点参数差异与本地上限；当天真实标签候选由 Agent Live 观察，不作为 Replay 前置。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 只证明筛选入口仍可达；Agent Live 在小隐寺单站打开标签选择器，有候选时核对 checkbox 与本地限量，无候选或外部错误按数据轴报告。 |
| 负向验证方式 | 给 `searchXiaoyinsiTags` 恢复 `limit` 查询参数，编号单元测试会收到 400。 |
| 明确不覆盖范围 | 不修改、创建或删除原站标签；当天候选名称与计数属于动态数据。 |

## `REG-XIAOYINSI-017` 小隐寺回应表情被渲染成英文文字

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`WRITE-01` |
| 用户症状 | 小隐寺主题和评论下方把回应显示成 `heart 49`、`+1 4`、`distorted face 2` 等英文文字，而原站显示对应 emoji 图片；回复编辑器也没有原站表情目录入口。 |
| 触发条件 | 小隐寺 Topic API 返回 `reactions[]`，或用户打开小隐寺回复编辑器；正文/评论 `cooked` 中的 `<img class="emoji">` 仍可能单独正常显示。 |
| 根因 seam | `src/sources/linuxdo/reactions.ts` 同时承担通用 Discourse reaction 和 linux.do 站点资源，通用分支刻意丢弃图片 URL；表情目录只由 linux.do adapter 读取，页面与编辑器因此无法取得小隐寺自己的 `/emojis.json`。 |
| 必须保持的行为 | 每个 Discourse adapter 独立读取并缓存本站 `/emojis.json`，公共 reaction presenter 只消费当前来源的 name→URL；主题和回复均显示本站 emoji 图片及计数，未知 id 才回退成可读文字。切换站点时旧目录不得短暂泄漏。小隐寺正文和评论里的 `cooked <img class="emoji">` 继续按 inline 图片渲染；编辑器插入原站接受的 `:name:`，不发送评论。linux.do 的 boost 仍是其站点特性。 |
| 精确失败 oracle | `src/sources/discourse/reactions.test.ts` 用原站 `heart/+1` URL 固定 reaction 图片映射；`src/sources/xiaoyinsi/reader.test.ts` 固定 `/emojis.json` 与本站绝对 URL；`tests/ui/topic/topic-components.test.tsx` 要求小隐寺只读回复实际渲染两张 reaction 图片；`tests/ui/topic/reply-composer.test.tsx` 要求小隐寺表情入口插入 `:waving_hand:`；`src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 固定真实评论 emoji 仍走 inline 图片。 |
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
| 根因 seam | `src/sources/xiaoyinsi/search.ts` 的 `topicsFromSearch` 优先把命中帖子传给主题归一化，覆盖了主题自己的 Original Poster。 |
| 必须保持的行为 | 搜索作者优先取主题 Original Poster；仅当命中帖明确为 `post_number=1` 时才可作为后备。命中帖继续提供摘要；缺少可靠 OP 时按 `REG-SEARCH-013` 保留结果并显示未知作者，不得用回复者或最后回复者猜测。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 的 `REG-XIAOYINSI-018` 同时提供两个二楼命中：bob 的主题有 alice 这个 Original Poster，要求结果显示 alice 且保留 bob 的命中摘要；另一个主题没有可靠 OP，要求结果仍保留、作者为空，并且两条候选都计为有效。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Adapter 公开搜索接口可固定原站载荷与归一化结果；源码字符串、页面可打开或动态标题不能证明作者正确。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 保持小隐寺搜索入口可用；作者正确性需在 App 内打开一个命中回复的结果，对照详情或原站楼主，记录为 `LIVE_PASS`。 |
| 负向验证方式 | 恢复命中帖子优先级会把作者从 alice 错误改为 bob；恢复空作者即丢弃会让第二条结果消失，编号测试都会失败。 |
| 明确不覆盖范围 | 不根据作者名、最后回复者或回复顺序猜测 OP；动态搜索结果当天是否存在由 Live 验收记录。 |

## `REG-XIAOYINSI-019` Token 已保存但首次 session 复核失败后重复发起授权

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-06` |
| 用户症状 | Device Code 已授权且 Token 已安全保存，但紧接着的 `/session/current.json` 遇到一次普通网络失败后，用户点击重试却被要求重新生成验证码并再次授权。 |
| 触发条件 | poll 返回 authorized 并持久化凭据后，首次 session 复核发生非 401/403 的暂时错误；控制器进入 error，重试入口直接创建新的 Device Code。 |
| 根因 seam | `src/features/account/useXiaoyinsiAuthController.ts` 的授权完成复核与 error 状态重试路由。 |
| 必须保持的行为 | error 状态下开始授权时，先用已保存的 User API Key 和 Client ID 重试 session；成功则恢复现有授权，普通复核失败继续留在可重试错误态；凭据不存在或明确 401/403 失效时才进入新的 Device Code 流程。 |
| 精确失败 oracle | `tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-019` 固定 poll 已授权、凭据已保存、首次 session 网络失败、用户重试后第二次 session 成功且没有再次调用 begin authorization。 |
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
| 精确失败 oracle | `tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 的 `REG-XIAOYINSI-020` 固定重新授权被拒绝后旧 Token 复核普通失败，要求最终为 error/check-failed 且没有 cleared 覆盖。 |
| 最低可靠自动测试层 | `UI_PASS`：必须跨越 poll 终态、旧 session 复核和 SiteSessionState dispatch；单测 tri-state helper 不能证明消费方没有折叠 null。 |
| Replay 或真实验收路径 | 不主动拒绝真实授权或断网制造组合状态；正常重新授权、取消和返回路径保持可用，异常组合由确定性 UI 测试固定。 |
| 负向验证方式 | 把任一终止分支恢复为 `if (await restore...)` 的二值判断，编号测试应回退到 denied/cleared。 |
| 明确不覆盖范围 | 不把暂时失败声明成授权有效，也不阻止明确 401/403 后重新授权。 |

## `REG-XIAOYINSI-021` 写操作授权复核失败覆盖原始错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-06`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 小隐寺回复或互动收到需要复核授权的 403 后，如果 `/session/current.json` 复核本身又遇到普通失败，动作 Promise 直接抛出复核异常，原始“没有权限执行该操作”被覆盖，编辑器或 optimistic Query cache 只能看到错误的恢复原因。 |
| 触发条件 | Discourse action runtime 的 `recover()` 直接 await 授权刷新，controller catch 内没有第二层恢复失败边界。 |
| 根因 seam | `src/features/topic/actions/discourseActionRuntime.ts` 的授权复核与 `src/features/topic/actions/useTopicActionsController.ts` 的动作失败收口。 |
| 必须保持的行为 | 授权复核失败不得从动作 controller 逃逸，也不得替换原始写操作错误；用户仍看到原始错误并明确获知授权状态复核未完成，动作保持失败且 optimistic 状态回滚。明确 login-required 时仍走登录提示。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-XIAOYINSI-021` 让写操作返回需复核的 403、授权刷新再抛错，要求提交 Promise 正常收口，提示同时包含原始操作错误和“复核未完成”。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：runtime 固定 recovery 结果，真实 `QueryClientProvider` controller 行为测试跨过 mutation rollback 与最终提示；单测授权刷新函数不能证明原始错误未被覆盖。 |
| Replay 或真实验收路径 | 不通过真实写操作或断网制造组合失败；只读确认小隐寺写入口权限显示，组合异常由确定性测试固定。 |
| 负向验证方式 | 恢复 catch 内直接 `await runtime.recover(error)`，编号测试会收到 rejected Promise 或只看到复核异常。 |
| 明确不覆盖范围 | 不把 403 自动判定为全局退出，不伪造授权有效，也不授权任何真实回复、点赞、书签或投票。 |

## `REG-SEARCH-001` linux.do 高级筛选接受任意文本或旧候选污染新查询

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-03`、`SEARCH-04` |
| 用户症状 | linux.do 标签和发帖人原本是可任意手输的文本框，可能提交站点不存在的值；快速改词时旧候选或旧 AI 响应还可能覆盖当前查询；空作者输入可能永久显示 Loading；关闭标签选择、切换分类再重开时，上一分类的同词候选可能重新出现并可点击；分页或详情返回后筛选也可能退回浅拷贝中的旧数组。 |
| 触发条件 | 标签/作者未经过原站候选接口；300ms 防抖请求先发后到；空 term 的 debounce sentinel 被当成进行中；Query placeholder 只核对输入文本而未核对来源和分类；提交快照只浅拷贝数组；新查询、筛选、排序或来源变化时未取消并失效 AI 请求。 |
| 根因 seam | `src/features/search/SearchScreen.tsx` 的候选草稿交互、`src/features/search/useSearchController.ts` 的普通/AI/候选结构化 Query key、`src/features/search/searchRun.ts` 的深快照和合并、`src/sources/linuxdo/search.ts` 的候选接口。 |
| 必须保持的行为 | 分类、标签和发帖人只能从站点候选选择；双标签可选任意/全部；空作者输入只显示输入提示且不请求；候选投影必须匹配当前来源、分类和输入，旧标签、作者或 AI 响应不得改变新查询。已应用数组在第一页、普通分页和详情返回中保持独立快照。AI 开关只读当前查询的缓存，普通顺序优先并按话题 ID 去重；关闭不重复请求。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 断言页面没有自由标签/作者提交入口、只接受候选，空作者不显示 Loading 或发请求，旧标签 Promise 晚于新 Promise 完成后仍只显示新候选，并在上一分类已有候选、下一分类请求悬空时断言旧候选立即不可见；`tests/ui/search/search-controller-ai.test.tsx` 让旧 AI Promise 晚到，断言新查询状态、去重顺序、开关缓存和普通分页不被污染；`src/features/search/searchRun.test.ts` 修改原草稿数组后要求已提交快照不变。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 token、深快照、Gateway 和合并规则；`UI_PASS` 固定防抖、过期响应、草稿、并发和用户可见标识。只有源码字符串、App 可启动或单次 Live 成功都不能证明请求竞争安全。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 只提交一次聚合搜索并在清空后检查来源/筛选入口；Agent Live 在保留登录态的 App 内验证 linux.do 双标签、作者、状态、日期、范围、专家回应、普通分页、AI 开关和有数据时的详情返回，不固定动态标题或数量。 |
| 负向验证方式 | 临时从候选 Query key 移除来源、分类或输入词，移除 Query 的取消 signal，把标签恢复为文本输入，让快照复用原数组，或将 AI 结果直接替换普通结果；相应用例必须精确失败，随后还原。 |
| 明确不覆盖范围 | 原站“话题/帖子”与“类别/标签”结果类型切换仍不在当前话题结果模型范围；第三方客户端的 RRF 融合不属于本产品契约。 |

## `REG-SEARCH-002` 分页失败隐藏已有结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 搜索第一页已有可打开结果时，继续加载失败会把整个来源的旧结果隐藏，只留下来源错误；用户既无法继续阅读，也无法确认重试的是失败页。 |
| 触发条件 | 任一单站连续列表已持有非空 `items`、`hasMore=true` 和 `nextPage`，随后该页请求失败并写入 `group.error`。 |
| 根因 seam | `src/features/search/useSearchController.ts` 在分页异常时虽合并回旧 `items`，却把 `hasMore/nextPage` 覆盖为结束态，验证完成回调还会重跑整来源；`src/features/search/listItems.ts` 遇到任何 `group.error` 都提前 `continue`，`src/features/search/SearchScreen.tsx` 的错误按钮也统一重跑整来源。 |
| 必须保持的行为 | 首屏错误继续显示来源级错误并重试整来源；已有结果后的分页错误保留全部旧结果，在单站列表尾部显示错误并只重试原 `nextPage`。自动分页只在单站用户滚动后触发，一次手势最多一页；“全部”只显示每来源最多 2 条预览且不生成分页入口；失败后不自动重试。 |
| 精确失败 oracle | `src/features/search/listItems.test.ts` 的 `REG-SEARCH-002` 断言单站分页错误依次生成旧 topic 和尾部 error、没有来源分组标题，同时首屏部分失败仍只走来源错误；`tests/ui/search/search-screen.test.tsx` 固定两类错误的可见结果和重试路由，并覆盖初始渲染、重复 viewability、忙碌、末页及查询/来源/滚顶变化；同文件另固定“全部”最多 2 条预览且无分页哨兵。`tests/ui/search/search-controller-ai.test.tsx` 让真实第二页请求失败，断言控制器保留失败页 cursor、普通重试和 NodeSeek 验证回调都再次请求原页。修复前控制器把 `nextPage` 清空，UI 注入的可重试状态无法由真实链路产生。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定概览/单站模式和首屏/分页错误的列表构建顺序；`UI_PASS` 固定真实控制器 cursor、用户可见旧结果、非点击哨兵、滚动触发和两类重试路由。源码字符串或单次 Live 成功不能证明 viewability 回调竞争安全。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 与未登录 Replay 各提交一次聚合搜索并等待 catalog-complete 结算，不要求动态详情；单站分页的成功、末页、重复可见和失败保留由确定性 RNTL 固定。Agent Live 逐来源记录 `data/empty/partial/error/auth`，有数据时再打开详情并返回，不强制制造真实分页失败。 |
| 负向验证方式 | 临时恢复 `group.error` 的无条件提前返回，或让分页错误按钮调用 `onRetrySearchSource`，`REG-SEARCH-002` 的列表/UI 用例必须分别失败；临时移除 arm 或 pending 门禁，重复回调用例必须失败；给“全部”恢复分页哨兵时概览用例必须失败，随后还原。 |
| 明确不覆盖范围 | 不改四站搜索 API、Cookie Mock、ReadGateway、筛选快照、去重、重复页或 server-state key 归属；不预取整站、不自动重试失败请求，也不固定动态第二页的标题或数量。 |

## `REG-SEARCH-003` linux.do 首帖搜索作者和头像丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03` |
| 用户症状 | 已登录 linux.do 搜索明确命中首帖时仍显示“未知作者”，头像也不展示；标题、摘要和详情可用。 |
| 触发条件 | 标准 Discourse `/search.json` 返回 `topics[]` 与 `posts[]`，命中 post 明确为 `post_number=1` 且含 `username/avatar_template`，而 topic 没有列表页专属的 `posters`，`users[]` 为空。 |
| 根因 seam | `src/sources/linuxdo/search.ts` 的 `topicsFromLinuxDoSearchData` 已按 `topic_id` 找到首帖，却只读取其 `blurb`；作者仍调用列表页的 `originalPoster(topic, users)`，因此被归一化为空。普通搜索和 AI 语义搜索共用该转换层。 |
| 必须保持的行为 | 优先使用 `topics[].posters → users[]` 或 `details.created_by` 的可靠 OP；缺失时仅允许明确的首帖提供主题作者和头像。回复命中按 `REG-SEARCH-013` 保留结果但不得冒充楼主。不得为每条结果新增用户请求，也不得改变搜索顺序、摘要、分页或登录态。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-SEARCH-003` 使用 `topics[]` 无 `posters`、`users[]` 为空且 `posts[]` 含 `post_number=1`、`username/avatar_template` 的标准响应，断言最终 Topic 保留作者和绝对头像 URL。 |
| 最低可靠自动测试层 | `UNIT_PASS` 直接覆盖真实 `searchTopics → searchLinuxDo → topicsFromLinuxDoSearchData` 链路；只测 `TopicCard` fallback、源码字符串或详情页作者都不能证明搜索字段已正确转换。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 只证明 linux.do 当前搜索请求能结算；Agent Live 只有在真实结果明确命中首帖时才核对作者、头像、详情和返回，否则按 `REG-SEARCH-013` 显示未知作者。 |
| 负向验证方式 | 临时移除明确首帖的作者 fallback，`REG-SEARCH-003` 必须精确失败，随后还原。 |
| 明确不覆盖范围 | 未登录 Google fallback 的结果本来不含可靠作者字段，本条不新增抓取或逐帖补全；不改变 Feed、Topic 或 User 页作者解析。 |

## `REG-SEARCH-013` Discourse 回复命中被丢弃或冒充楼主

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 小隐寺有真实搜索命中却显示“内容无法解析”；已登录 linux.do 则可能把命中回复者或最后回复者显示成主题作者。是否出现取决于查询命中首帖还是回复。 |
| 触发条件 | Discourse 搜索返回合法 `topics[]` 和命中回复 `posts[]`，但 topic 没有可映射的 Original Poster，且命中帖的 `post_number>1`。 |
| 根因 seam | `src/sources/xiaoyinsi/search.ts` 把缺少作者的 Topic 当作无效候选丢弃；`src/sources/linuxdo/search.ts` 优先把命中 post 或 `last_poster_username` 归一化成主题作者。 |
| 必须保持的行为 | 搜索命中本身足以保留结果。只有 `topics[].posters → users[]`、`details.created_by` 或明确的首帖才能填写主题作者；其余情况作者留空，由现有 TopicCard 显示“未知作者”。命中回复仍提供摘要，候选不得计入 dropped/parse_empty；不得新增逐主题请求。 |
| 精确失败 oracle | `src/sources/xiaoyinsi/reader.test.ts` 同时固定可靠 OP 与无 OP 的二楼命中，要求两条都保留且后者作者为空；`tests/integration/source-read-contracts.test.ts` 固定 linux.do 二楼命中且同时提供回复者和最后回复者，要求结果保留、作者为空，并另以 `details.created_by` 固定可靠 topic creator 不被误清空。两者都断言 `validCount=candidateCount`、`droppedCount=0`、`isParseEmpty=false`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过两站公开 search adapter 和诊断汇总；TopicCard 已有空作者降级，动态标题或单次页面成功不能固定作者语义。 |
| Replay 或真实验收路径 | 小隐寺搜索 `codex` 当前可命中仅含回复作者的结果，要求展示条目而非解析错误；linux.do 保留当前登录态，只在原站响应自然命中回复时核对 App 显示未知作者，不清 Cookie 制造状态。 |
| 负向验证方式 | 恢复小隐寺空作者即丢弃，或让 linux.do 再次使用匹配回复/最后回复者作为主题作者，编号测试必须分别失败。 |
| 明确不覆盖范围 | 不猜测楼主、不逐条读取主题详情，也不新增“命中回复者”字段；若产品以后要展示命中者，应作为明确的独立语义。 |

## `REG-SEARCH-014` Google JavaScript capability gate 被当成外部跳转

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 真实未登录设备上，NodeSeek 或 linux.do 搜索很快提示“页面跳转到外部地址，已停止读取”；同一关键词在 Android Chrome 可正常显示结果。 |
| 触发条件 | Google 对 Android WebView 搜索先返回 HTTP 200 的 JavaScript capability bootstrap，并在同一 Google origin 导航到 `/httpservice/retry/enablejs?sei=...`；响应没有 403/429、CAPTCHA 或 unusual-traffic 证据。 |
| 根因 seam | `src/features/account/HiddenBrowserHost.tsx` 曾把 hidden WebView 的每一次顶层导航都套用最终结果 URL 白名单；NodeSeek 生产 `webViewFetcher` 又只接收论坛域，导致 scoped Google 请求根本不进入 hidden WebView。后续若用论坛域/Google 的并集白名单代替 initial-task binding，还会让搜索任务跨域并错误结算。 |
| 必须保持的行为 | 五站匿名搜索按真实协议分流：V2EX 使用 SoV2EX；NodeSeek 与 linux.do 使用各自 `site:` 约束的 Google fallback；小隐寺使用公开 `/search.json`；妖火站内搜索需要会话并收口到登录提示。NodeSeek 与 linux.do 的生产 fetch port 都必须把自身 scoped Google URL排入对应 HiddenBrowserHost。Google capability gate 只在 initial 已是同一来源的受限 Google search、目标仍为 exact `https://www.google.com`、无 userinfo/非默认端口/hash、路径精确且只有一个合法 `sei` 时作为中间导航放行；普通 `/search` 导航和最终 bridge 结果必须保持 initial 的同一 `q/start`。Google flow 不得跨回论坛域，论坛 flow 不得转成 Google；任意子域、双 `site:` token、额外 query、另一搜索、gate 作为结果及外部 host 都拒绝。 |
| 精确失败 oracle | `tests/integration/security-boundaries.test.ts` 固定 NodeSeek/linux.do 的 exact origin、唯一同站 token、同一 `q/start`、精确 gate 正例及跨任务/跨类型负例；`tests/ui/account/hidden-browser-host.test.tsx` 通过真实 WebView props 固定两站 gate 导航不中断、论坛回跳/另一搜索/非精确 gate 立即失败；`tests/ui/account/session-controller-browser-flow.test.tsx` 固定生产 NodeSeek connector 必须排入 HiddenBrowserHost，并拒绝把论坛页结算成 Google 搜索结果。`tests/integration/source-read-contracts.test.ts`、`src/sources/xiaoyinsi/reader.test.ts` 与 `tests/device-logged-out/logged-out-readonly.ad` 分别固定五站 transport 矩阵和用户可见收口。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` 固定协议分流、connector 和 gate；匹配身份的 `DEVICE_REPLAY_PASS` 只证明当前 Android hidden WebView 能让请求进入可见 outcome，不证明 Google 或第三方当天返回数据。是否实际经过特定 `/enablejs` 中间 URL 只能由可观测 gate canary 证明。 |
| Replay 或真实验收路径 | 在不含论坛登录数据的独立 AVD 上，用同一身份 APK 执行 `tests/device-logged-out/logged-out-readonly.ad`；先确认四站 Account Query 均为权威未登录状态，再提交一次聚合搜索，逐来源接受当前请求的数据、空态、来源错误、Google/CF 阻碍或妖火登录限制，relaunch 后身份仍不变。各站真实结果由 Agent Live 报告；Cloudflare 只允许在 App 内完成访客验证，不登录论坛。 |
| 负向验证方式 | 删除生产 NodeSeek Google connector、initial-task binding 或 final result binding 时对应 UI/安全测试必须失败；把 gate 并入普通 result URL、放宽到论坛跨跳、另一搜索、任意 `/httpservice`、额外 query 或任意 Google origin 时安全负例必须失败。 |
| 明确不覆盖范围 | 不绕过 CAPTCHA、`/sorry`、unusual-traffic 或其他真实 Google 风控；一旦出现这些证据，应明确报告受限而不是扩白名单、自动重试或伪造结果。 |

## `REG-SEARCH-015` Google SearchGuard 访问故障被误报为外部链接

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | NodeSeek 未登录搜索提示跳到外部链接；原地“重试”仍显示外部链接，切换来源后再回来却成功，看起来像只有切站才真正重发。 |
| 触发条件 | 两次失败都建立了新的 hidden WebView transport；Google 对同一 Android WebView UA 返回 HTTP 200 SearchGuard bootstrap，先给出 exact `/httpservice/retry/enablejs?sei=...`，随后给出同一 `q/start` 且仅增加 `sca_esv`、`emsg=SG_REL`、`sei` 的访问故障 URL。第三次新请求在 Google 环境状态就绪后返回普通结果。 |
| 根因 seam | `src/features/account/HiddenBrowserHost.tsx` 把 `is*BrowserNavigationUrl=false` 的所有原因压成“外部地址”，混淆了真实外部导航、另一搜索任务与 Google 自己的 SearchGuard 环境验证失败；来源切换并没有特殊恢复语义。 |
| 必须保持的行为 | Retry 与切站回来都只建立一个新的当前来源 transport，不复用失败缓存，也不自动补发。`https://www.google.com/search` 只有在 exact host/origin、同一 `q/start`、参数恰为 `q`、可选 `start`、`sca_esv`、`emsg=SG_REL`、`sei`，且两个 flow token 合法时才归类为 Google 搜索环境验证受限；该 URL 仍返回 `false`、不得作为结果结算，诊断为 `verification_required`，用户看到“Google 搜索环境验证暂时未通过，请稍后重试”。另一关键词、错误 `emsg`、额外参数、重复参数、其他 host/path 仍按外部或任务不匹配 fail-closed。 |
| 精确失败 oracle | `tests/integration/security-boundaries.test.ts` 固定 NodeSeek/linux.do 的 exact `SG_REL` 形状正例及另一关键词、错误 `emsg`、额外参数负例，并要求导航/结果白名单继续拒绝；`tests/ui/account/hidden-browser-host.test.tsx` 通过两站真实 WebView props 固定该 URL 显示 Google 环境验证文案，而论坛回跳、另一搜索和畸形 gate 仍显示外部地址；`src/platform/diagnostics/diagnostics.test.ts` 固定该文案归一为 `verification_required`，`src/sources/sourceErrors.test.ts` 固定两站仍是 ordinary 来源错误且不会误开论坛验证面板。修复前两次真实 retry 日志已经证明每次都有独立 transport，因此不得以新增重试或切换状态机作为 oracle。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`；URL 形状和用户可见分类可确定性固定，Google 当天是否再次返回 SearchGuard 只能作 Live 环境证据，不能要求 Replay 制造。 |
| Replay 或真实验收路径 | 只在隔离未登录 AVD 自然出现该回路时确认文案不再声称外部链接，随后可由用户显式重试一次；若当天直接返回结果则只记录成功，不循环请求制造 SearchGuard。 |
| 负向验证方式 | 删除 access-trouble 分类时 UI 用例必须恢复“外部地址”；把 `SG_REL` URL 加入 navigation/result 成功白名单、允许额外参数或另一 `q/start` 时安全用例必须失败。 |
| 明确不覆盖范围 | 不绕过 Google SearchGuard、CAPTCHA、`/sorry` 或 unusual traffic，不保证显式重试成功，也不根据来源切换自动重发。 |

## `REG-SEARCH-016` 自动化结算节点撑高搜索页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 用户症状 | 聚合搜索完成后，账号状态提示与第一组结果之间突然多出一大块空白；五站时比原布局多约 50dp。 |
| 触发条件 | Replay 为五个来源各创建一个无内容 `View`，并把它们放进带 `gap: 10` 的 Search Header `stack`。节点没有可见内容，却仍逐个参与 Flex 布局。 |
| 根因 seam | 自动化结算状态被实现成生产布局节点，而不是既有可访问元素的状态。 |
| 必须保持的行为 | Search Header 不包含只为自动化存在的空布局节点。聚合 Replay 只等待现有 FlashList 上的 `search-all-sources-settled`；该标记仅在 `aggregateSearchSources` 中每个来源都存在且结束 Loading 后出现。单站继续使用既有 `search-complete`。提交前已有的列表间距保持不变。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 计算 Header 中空 flow child 造成的 gap，修复前稳定得到 50、修复后必须为 0；同文件还要求缺任一 catalog 来源时没有聚合结算标记。`tests/tooling/android-smoke-guard.test.ts` 禁止 `search-outcome-*` 并要求两条 Replay 只等待聚合标记。420dpi 模拟器中最后一条账号提示到底部与 V2EX 标题顶部的间距由修复前 184px（70dp）恢复为 52px（约 20dp），与自动化提交前已有间距一致。 |
| 最低可靠自动测试层 | `UI_PASS` 固定真实 React Native 布局树和结算时序；`DEVICE_REPLAY_PASS` 复核 Android 实际间距与 accessibility marker。源码字符串或 Replay 单独变绿不能证明样式已恢复。 |
| Replay 或真实验收路径 | 在保留数据的匹配 APK 上进入 Search → 全部，提交一次查询并等待聚合结算；对照提交前基线检查最后一条账号状态与首个来源标题的间距，再执行 `tests/device/search-multi-source.ad`。 |
| 负向验证方式 | 恢复五个空 outcome `View` 后，UI 用例必须重新得到 50dp 的额外 gap；删除 catalog 完整性判断后，缺来源用例必须提前暴露结算标记。 |
| 明确不覆盖范围 | 不重设计搜索页，也不改动自动化提交前已经存在的 FlashList 内容间距。 |

## `REG-SEARCH-017` 未结算判断吞掉真实搜索 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 用户症状 | 正常聚合搜索期间，某来源显示“等待账号状态”且没有 Spinner，看起来像账号卡住，而实际网络请求正在进行。 |
| 触发条件 | 一个已启用来源同时为 `settled:false`、`loading:true`；列表先判断未结算并直接跳过，永远到不了 Loading 分支。 |
| 根因 seam | `searchGroupMeta` 与 `buildSearchListItems` 把请求生命周期的 `settled` 当成身份 pending，并放在更具体的 `loading` 前。 |
| 必须保持的行为 | `loading:true` 必须显示“搜索中”和 Spinner，即使当前请求尚未结算；只有 `loading:false` 且 `settled:false` 的真实身份等待态才显示“等待账号状态”。Loading、身份等待、错误、空态彼此不冒充。 |
| 精确失败 oracle | `src/features/search/listItems.test.ts` 以 `settled:false + loading:true` 要求 `groupLoading` 与“搜索中”；`tests/ui/search/search-screen.test.tsx` 同时固定真实 Loading、身份等待、分页 Loading 和聚合 busy，修复前缺少 Spinner。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`；纯 controller 状态测试不能证明列表真正渲染了 Spinner。 |
| Replay 或真实验收路径 | 在模拟器提交一次聚合搜索，若能捕获进行中状态，来源应显示“搜索中”而非“等待账号状态”；请求最终仍须由聚合结算标记有限收口。 |
| 负向验证方式 | 把 `settled === false` 分支重新放到 `loading` 前，对应编号测试必须恢复无 Spinner和错误文案。 |
| 明确不覆盖范围 | 不改变来源错误、登录限制、分页重试或第三方数据可得性。 |

## `REG-SEARCH-018` NodeSeek 空搜索被旧页面壳误报为无法解析

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 用户症状 | NodeSeek 单站搜索特定关键词时稳定显示“搜索结果返回内容无法解析，请重试”，而普通关键词可返回结果；原站搜索页实际可能只是明确的空结果。 |
| 触发条件 | 已登录 NodeSeek `/search` 响应包含搜索表单和空 `.post-list`，但页面其他区域仍有 `post-*` 链接；同类页面还可能在 embedded payload 中保留首页旧主题。真实 `841430` 响应的脱敏结构为列表内候选 0、全页非结果链接 3、embedded candidates 0。 |
| 根因 seam | `src/sources/nodeseek/feedParser.ts` 的搜索解析器以正式 `.post-list` 为结果面，诊断器却把全页 `post-*` 链接及 embedded candidates 一起计入候选，制造 `candidateCount>0 + validCount=0` 的假 `parse_empty`。 |
| 必须保持的行为 | 候选数只来自当前实际选择的解析面：正式 `.post-list` 存在时只统计其内部 rows/links，并忽略页面其他区域链接及 embedded topics；空列表输出 `isExpectedEmpty=true`、`isParseEmpty=false`。只有表单而结果面未完成时仍报可重试错误；当前 `.post-list` 内存在无效候选时仍允许诊断为 `parse_empty`。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的同名 fixture 经过真实 `searchTopics → searchNodeSeek` 链路，构造空 `.post-list`、3 个 footer `post-*` 链接和 1 个 stale embedded topic，要求空 `items` 且诊断为 `candidateCount=0`、`validCount=0`、`droppedCount=0`、`isExpectedEmpty=true`、`isParseEmpty=false`；修复前稳定得到 `3/0/3/false/true`。相邻用例继续固定只有搜索表单的未完成页面必须 reject。 |
| 最低可靠自动测试层 | `UNIT_PASS`：adapter fixture 可确定性固定数据面选择与诊断摘要；只断言列表为空无法发现用户可见的错误分类。 |
| Replay 或真实验收路径 | 保留当前 NodeSeek 登录态，在 Search → NodeSeek 分别查询问题词 `841430` 与普通词 `codex`；前者允许随原站动态返回数据或正常空态，但不得再显示解析错误，后者仍须正常结算。不得清 Cookie 或要求数字词直达帖子。 |
| 负向验证方式 | 恢复全页链接或 embedded candidates 的全局计数，同名诊断断言必须重新得到 `parse_empty=true` 并失败。 |
| 明确不覆盖范围 | 不改变 NodeSeek 服务端搜索语义，不把纯数字查询改写为帖子 ID，不保证第三方当前一定返回结果，也不放宽未完成页面或畸形候选的解析失败。 |

## `REG-SEARCH-019` 单站空结果仍显示继续加载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 用户症状 | 单站搜索已经显示“没有匹配结果”，列表尾部仍同时显示“继续下滑加载更多”，继续滚动还可能发起无意义的下一页请求。 |
| 触发条件 | 来源第一页返回空 `items`，但响应或页面壳仍残留 `hasMore=true` 与 `nextPage`。 |
| 根因 seam | `src/features/search/listItems.ts` 分别生成空态和分页哨兵，分页条件没有要求当前累计结果非空。 |
| 必须保持的行为 | 单站累计结果为 0 时，空态即为终态，不生成分页哨兵；非空结果的用户滚动门禁、自动续页、末页收口及分页失败重试保持不变。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 注入 NodeSeek 单站 `items=[]`、`hasMore=true`、`nextPage=2`，要求显示空态且不存在“继续下滑加载更多 NodeSeek”；修复前两条文案稳定同时出现。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 SearchScreen 列表构建与渲染链路固定用户可见互斥状态；只校验 adapter cursor 不能覆盖其他来源或迟到状态。 |
| Replay 或真实验收路径 | 保留当前登录态，在 NodeSeek 单站查询无匹配词；结算后只显示空态，继续下滑不得出现分页提示或新请求。 |
| 负向验证方式 | 移除分页条件中的非空门禁，同名 UI 测试必须重新看到两条矛盾文案并失败。 |
| 明确不覆盖范围 | 不改变各来源如何判断服务端下一页，不改变已有结果后的分页行为，也不自动重试任何失败请求。 |

## `REG-LINUXDO-001` linux.do Cloudflare 429 被降级且大响应被截断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | linux.do 实际要求 Cloudflare 验证时，直连已识别为 `verification-required`，隐藏 WebView 却把主文档 429 提前报成普通未知错误；偶尔挑战后已得到 200，又因正文固定截断为 12,000 字符而 JSON 解析失败。 |
| 触发条件 | 可信 CF header/body 触发隐藏 WebView fallback；Android WebView 先回调主文档 `onHttpError(429)`、随后仍完成页面或跳转到 200；成功 JSON 大于 12 KB。 |
| 根因 seam | `src/sources/linuxdo/browserFallback.ts` 的 CF 分类、`src/features/account/HiddenBrowserHost.tsx` 的主文档生命周期、`src/features/account/useHiddenBrowserFetchController.ts` 的 bridge 序列化，以及 `src/features/account/useSessionController.ts` 的最终 Response/typed error 结算。 |
| 必须保持的行为 | 只有可信 CF 特征才能触发验证，普通 429 原样返回；主文档 HTTP error 只记录并继续等待最终 DOM，子资源错误忽略，新导航清除旧状态。合法正文在 900 KB bridge 上限内完整往返，超限明确返回 `content-too-large` 且不得伪装成 CF；直连已确认 CF 而 renderer/脚本无法复核时保持 typed CF 结论。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-LINUXDO-001` 分别固定普通 429 不进入 WebView、已确认 CF 后 renderer 失败仍为 typed CF、挑战导航后的普通 429 保持 429；`tests/integration/hidden-browser-scripts.test.ts` 固定超过 12 KB JSON 精确往返和超 bridge 上限的非 CF 显式失败；`tests/ui/account/hidden-browser-host.test.tsx` 固定 429 不提前失败及新主文档清除旧状态；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定 challenge 无伪造 403 Response。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定分类、序列化、Response 与 typed error 契约；`UI_PASS` 固定 RNC WebView 事件顺序。只有源码字符串、普通页面成功或单次 Cookie 保存不能证明 Android 429 challenge 链路。 |
| Replay 或真实验收路径 | 只在 App 内自然出现 linux.do challenge 时，从单站 Feed/Search/Topic/User 读取进入 overlay，完成验证并观察原读取恢复；不得清 App 数据、Cookie 或登录态制造 challenge。无法自然触发时记 `NOT_VERIFIED` 或 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 临时恢复 LinuxDo 正文 `.slice(0, 12000)`、在 `onHttpError(429)` 直接 fail、把 bridge 超限标成 `challenge: true`，或让普通 429 触发 fallback；对应 `REG-LINUXDO-001` 用例必须精确失败，随后还原。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不保证原站当天出现 challenge，也不把普通 Rate Limiting 429 当作验证成功或失败；大于 bridge 上限的响应不做分片扩展。 |

## `REG-LINUXDO-002` linux.do 验证关闭重开并无限循环

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | 读取触发验证后，面板在用户操作前自行检测、保存或关闭；用户关闭后原 Topic 又被重新打开并立即命中 CF，形成 close/reopen 循环。 |
| 触发条件 | 可见 WebView 的 load/message 直接驱动 pending Topic、dismissed key、verified retry 和 `InteractionManager` 关闭后导航；Cookie 保存被误当成原读取成功，或旧 WebView 消息在关闭后回流。 |
| 根因 seam | `src/features/account/useVerificationController.ts` 的验证生命周期和 Cookie generation、QueryClient 的结构化 key / exact active observer 边界、`src/features/account/useSessionController.ts` 的隐藏 Cookie 事件语义。 |
| 必须保持的行为 | 验证 overlay 覆盖当前页面；打开时只读取当前候选基线，不清理原站 Cookie。用户点击“检测状态”后保存当前 WebView 候选，并只在 recovery 引用未被替换且完全相同的结构化 Query key 仍有 active observer 时携带该 key、精确 `resume()` 原 Feed/Search/Topic/User/Level 首屏或分页；首屏重读，分页、Topic 回复/引用和 User 双 cursor 保留原页面基线再合并。只有原读取不再返回 CF 才关闭；仍为 CF 或普通失败时保持打开、不 remount、不递归弹窗、不自动二次重试。用户关闭取消 recovery 并忽略迟到事件；Account 手动入口没有 recovery，检测后保持打开。登录结论只来自当前文档 probe，不由 clearance 或 `_t` 名称单独推断；任何 baseline/检测失败都不删除原站 Cookie。聚合、后台 AI/预取和写操作不自动弹出或重放。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 固定 WebView message 不自动恢复、用户每次已结算的显式检测都可真实重试、恢复期间面板可见、仍为 CF 时保持打开、same-value clearance 也能进入最终原读 oracle、`session-updated` 只在事件发布瞬间 recovery 未被替换且 exact Query key 仍 active 时携带该 key、旧 baseline/检查迟到不能覆盖新结果、原读取成功后才发送观察型 `verification-succeeded` 并关闭，以及用户关闭、closing latest-wins、迟到检查和 recovery supersede 隔离；同文件的 `REG-ACCOUNT-026` 断言明确退出不调用清理。四类带 `QueryClientProvider` 的 read controller RNTL 固定 exact key 恢复后保留分页基线；`tests/integration/source-read-contracts.test.ts` 固定非 GET 写请求不得进入隐藏 WebView；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定隐藏读取只发送 `cookie-loaded`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定验证状态机、Query key / exact active 判定和 Cookie 事件；`UI_PASS` 通过真实 QueryClient 固定 Feed/Search/Topic/User 恢复与隐藏 WebView 交互。源码字符串、拿到 `cf_clearance`、Modal 已关闭或 App 可启动都不能证明恢复成功。 |
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
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 固定 failed recovery 不关闭面板；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 固定普通恢复失败返回 failed；`tests/ui/topic/topic-session-controller.test.tsx` 固定引用帖失败精确传播；`tests/ui/topic/topic-actions-controller.test.tsx` 固定写后 failed refresh 记录 partial；Search/User 既有 recovery 用例覆盖相同 union。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：状态机、controller 返回值和写后诊断必须共同固定；仅保存到 `cf_clearance` 或看到请求结束不能证明原页面已恢复。 |
| Replay 或真实验收路径 | 只在自然 challenge 出现时完成验证；若原读取随后普通失败，overlay 应保留并允许“检测状态”重试，原列表/详情不被假成功覆盖。写操作不为制造该状态执行。 |
| 负向验证方式 | 把任一普通失败分支恢复为 completed，或让 verification controller 在 failed 时 dispatch success，编号测试必须关闭面板或错误记录 success 并失败。 |
| 明确不覆盖范围 | 不自动重放写操作，不人为断网或清 Cookie 制造 challenge；无法自然触发时设备证据记 `NOT_VERIFIED`。 |

## `REG-LINUXDO-004` 过期 Cookie 被误判为已登录并阻断搜索

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | linux.do 原站已经显示“登录”，App 账号中心仍显示已登录；搜索继续调用登录接口并报限流，匿名 Google fallback 没有启用，写入口也可能继续按旧 Cookie 展示。 |
| 触发条件 | 服务端会话已失效，但本机仍保存 `_t`/`_forum_session`；账号刷新用匿名也可访问的 `/session/csrf` 判定登录，前台 WebView 只回传 Cookie、不回传明确登录标记。 |
| 根因 seam | canonical `getCurrentUserProfile` 的服务端身份 oracle、`LINUXDO_WEBVIEW_PROBE_SCRIPT` 的页面登录探针，以及 `useVerificationController` 的 generation-safe 过期态提交。 |
| 必须保持的行为 | 只有 `/session/current.json` 返回带用户名的当前用户才确认登录；官方 controller 的匿名 `404` 与显式匿名字段判定失效，非 CF 的 `401/403`、429、网络错误和 CF 保持 unknown。WebView 明确出现 Discourse 登录按钮时只提交 App 内 `login-expired`；模糊页面不得猜测。检测、刷新和写操作失败都不得删除原站 Cookie，只有用户明确点击“清除登录”才定向删除登录 Cookie并保留 clearance。搜索随后走既有匿名 fallback，写入口按 canonical session 关闭。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定显式匿名、官方匿名 404、登录用户、畸形成功响应与非契约 401/403/429；`tests/integration/source-read-contracts.test.ts` 固定可信 CF 与 Account-only hidden WebView fallback；`src/platform/network/loginWebViewScripts.test.ts` 固定 logged-in/logged-out/unknown 三态；`src/features/account/useVerificationController.test.ts` 固定明确退出只发布失效、不调用清理，且 unknown 不改变可信状态。修复前匿名响应得到 `ok:true`，后续版本又曾把正确或错误的退出判断升级为原站 Cookie 删除权限。 |
| 最低可靠自动测试层 | `UNIT_PASS`：请求契约、页面脚本和 controller 状态提交必须一起通过；仅检查 `_t`、CSRF、搜索错误文案或 App 启动都不能证明真实登录。 |
| Replay 或真实验收路径 | 仅在当前设备自然处于失效态时验收：覆盖安装并冷启动；若服务端身份检查已有明确结论，账号中心直接显示失效，否则进入账号中心 → linux.do → 检测或重新登录，在 App 内原站明确显示登录按钮后点“检测状态”。随后账号中心应显示 linux.do 已失效，搜索不再进入登录专属路径。不得清 App 数据、Cookie 或重置模拟器制造状态；动态登录态不写入 Replay。 |
| 负向验证方式 | 把账号探针恢复为 `/session/csrf`、删除 WebView `status` 上报/过期分支，或在 `logged-out` 分支调用原站 Cookie 清理；编号测试必须分别恢复假登录、漏掉失效或触发未经用户授权的删除。 |
| 明确不覆盖范围 | 不自动重新登录，不输入或保存新凭据，不保证 Google 当天可达或有结果，也不以普通网络/限流/CF 错误推断退出。 |

## `REG-LINUXDO-005` 冷启动残留 Cookie 被当作已确认登录并选择登录搜索

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | linux.do 会话已经不可用，冷启动后的账号中心仍显示“身份未识别 · 已登录”，搜索页仍显示已登录、开放 AI 搜索并选择登录专属搜索；真正请求时才要求登录或失败。 |
| 触发条件 | 本机仍保存 `_t`/`_forum_session`，启动恢复直接把 Cookie 存在等同于登录；随后 `/session/current.json` 因 429、网络或其他未知结果无法确认身份，账号视图保留了这个未经远端确认的猜测，搜索又独立按 Cookie 选择 transport。 |
| 根因 seam | `useSessionController` 冷启动凭据恢复 → `useAccountStatusController` 的 Query 会话视图 → `useAccountRuntime` 向 Search/Topic route 传递的 canonical view model → `useSearchController` 的模式与 Query key → `searchLinuxDo` transport 选择。 |
| 必须保持的行为 | 冷启动读到登录 Cookie 只建立凭据/clearance 候选，不确认登录。只有远端当前用户或本次 App 内原站明确登录结果才能开放写入口、AI 和登录搜索；未知/限流/网络失败不得猜测已过期，也不得把冷启动候选升级为已登录。账号页、搜索和 Topic 写权限共用同一合并会话视图。linux.do 匿名与已确认登录搜索使用不同结构化 Query key，匿名模式即使存有 `_t` 也不得发送 Cookie 或调用登录搜索。明确失效由 `REG-LINUXDO-004` 更新 App 投影，但保留原站 Cookie。 |
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定冷启动 `_t` 只进入候选态；`tests/ui/account/account-status-controller.test.tsx` 固定身份未知时仍非登录；`tests/ui/search/search-controller-ai.test.tsx` 固定 canonical view model 选择真实未登录路径并关闭 AI；`tests/integration/query-session-contracts.test.ts` 固定登录与未登录身份不共用缓存；`src/sources/readGatewayContract.test.ts` 与 `tests/integration/source-read-contracts.test.ts` 固定未登录决定贯穿 Gateway 且最终不调用 linux.do 登录搜索。`tests/device-logged-out/logged-out-readonly.ad` 在隔离 AVD 固定四站权威未登录状态、一次聚合 Search 的 catalog-complete 结算、Feed 的逐来源 outcome 和 relaunch 后身份不变，不要求当天存在实时结果。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：启动状态、Account Query 合并、Search Controller、Query key 和真实来源 adapter 必须共同通过；只测 Cookie 解析、错误文案或单个搜索 fallback 不能证明整条状态链一致。 |
| Replay 或真实验收路径 | `tests/device-logged-out/logged-out-readonly.ad` 在独立 AVD 通过生产 Account/ReadGateway 路径验证未登录搜索、首页和 relaunch；主设备继续保留自然形成的残留 Cookie 做 Live，若远端身份仍为 unknown 则不得显示 linux.do 已登录或 AI。不得清主设备 App 数据或 Cookie 制造状态。 |
| 负向验证方式 | 恢复冷启动 `loggedIn = linuxDoAccessSummary(...).loggedIn`，让 Search 读取 workflow view model，删除 `linuxDoAuthenticated` transport 决策或从 Query key 移除模式；对应编号测试必须恢复假登录、错误 transport 或缓存串用并失败。 |
| 明确不覆盖范围 | 不把 429、网络、CF 或普通来源错误当成失效，不自动清理或重新登录，不保证匿名 Google 当天可达或返回结果。 |

## `REG-LINUXDO-006` 页面退出后的后台 Query 串扰验证与等级恢复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`；共享 recovery 回归 `TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | 用户已经离开 Search/Feed 后，旧搜索、AI 或分类请求仍在 More 页后台重启并拉起 linux.do、NodeSeek 或妖火面板；linux.do 验证开始后 Search 从登录 key 漂移到匿名 key，旧 recovery 失活，面板随即关闭又重开；“查看等级”命中 CF 时没有精确 recovery，验证流程清掉 Level cache 后反复取消、弹出或无法落地等级。 |
| 触发条件 | App 级 controller 长期挂载，Query 只按提交数据或筛选条件 `enabled`，没有当前 `screen` 所有权；`enabled:false` 不会中止已经执行的 Query。`verification-started` 又把 canonical 会话暂时投影为未登录，使 Search key 和 transport 参数同时切换；Level 仅做 disabled Query 的一次 `refetch`，验证控制器却无条件重置 Level cache。 |
| 根因 seam | `useAppRuntime` 当前页面与各 route 的 `active` / 验证 overlay → Feed、Search、Account controller 的 Query 执行权；Search 的稳定认证模式 → 结构化 Query key 与 Gateway 参数；Level 的 exact active Query → `LinuxDoReadRecovery` 与 session reset 保留边界。 |
| 必须保持的行为 | `AppNavigator` 必须把每次根页面切换同步给 `useAppRuntime`，再投影到长期挂载 route 的 `active`；Feed 主列表只在 Feed 执行，Search 主查询只在 Search 执行；共享 `all categories` 只在 Feed/Search 执行，单站 categories 只归 Feed。离开所属页面立即 cancel 在途 Query，旧结果和后续 session epoch 变化不得后台重启或拉起任一站点面板；所有 action/error 回调先确认所属页面仍在前台。linux.do overlay 打开时保留已加载主内容只读，暂停新 Search AI、标签/作者候选和 Feed categories，关闭后先完成 Account 对账，再按当前前台页面恢复；身份 barrier 期间 `canWrite`/AI 均关闭。Level 只在 More 且用户已请求时 active；首次 CF 向验证控制器交付 exact Level key 和 recovery，一次用户显式检测成功时严格只有原请求一次、resume 一次，等级落地后关闭；离开 More、用户关闭或普通失败立即 cancel/stale，resume 再次遇到 CF 时保持 recovery 可供用户显式重试但不得自动循环。验证控制器不拥有或无条件重置 Level cache；真实登录失效、退出和换号统一走 Account reconciliation 与 epoch invalidation。 |
| 精确失败 oracle | `src/app/AppNavigator.test.ts` 固定每次根 Tab 切换都提交新的 reactive screen；`tests/ui/search/search-controller-ai.test.tsx` 固定验证中认证 key 不漂移、原 recovery Query 仍 active、离页 signal abort、scope 更新不重启、三站面板不回调，以及 AI/标签候选验证期 cancel、关闭后恢复；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 固定 Feed 离页 cancel、验证期只停 categories、不停主读取，并证明 Search 只共享 aggregate categories 而不启动 Feed；`tests/ui/account/account-controller.test.tsx` 固定 Level 首次成功为原请求 + resume 恰好两次、exact Query active、离开 More 中止、手动关闭 stale、再次 CF 不自动循环，并证明验证准备被拒绝后可再次请求；`src/features/account/useVerificationController.test.ts` 用真实 QueryClient 的 active Level observer 固定验证准备、用户显式检测、凭据保存、exact resume、等级 cache 落地和面板关闭全链路，同时证明 closing 期间排队的 Level 准备失败会回告 owner，并覆盖用户关闭、仍为 CF 和 Account 手动入口。`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/user/user-controller-session.test.tsx` 继续固定既有 exact recovery，不得因共享 seam 修改退化。 |
| 最低可靠自动测试层 | `UI_PASS` 通过真实 QueryClient 固定 observer active、AbortSignal、页面切换、恢复次数和面板回调；`UNIT_PASS` 固定 verification/session reset 对 exact key 的保留与终态。只检查 `enabled` 值、Modal 可见、Cookie 已保存或源码字符串不能证明后台请求已经停止。 |
| Replay 或真实验收路径 | 在不清 App 数据、Cookie 或登录态的前提下，仅于自然 challenge 出现时验收：Search 触发 CF 后只出现一次 overlay、原请求只恢复一次；保留搜索后进入 More 查看等级，诊断中不得出现后台 Search/Feed，Level 应落地且 overlay 关闭；验证期间手动关闭后 recovery 失效且不重开。无法自然触发 CF 时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 临时移除 controller 的 `screen` 门禁/显式 cancel，恢复 Search 直接读取实时 `isLoggedIn`，让 AI/categories 在 overlay 内继续执行，删除 Level recovery 或重新在 verification controller 中 reset Level cache；对应 `REG-LINUXDO-006` 用例必须出现后台调用、inactive key、第三次 Level 请求或面板回调并失败。 |
| 明确不覆盖范围 | 不新增全局 WebView/Query 优先级调度器，不重构完整 session 状态机，不改变外部 API、持久化 schema、原生配置或写权限契约；不人为制造 Cloudflare challenge。 |

## `REG-LINUXDO-007` Account 网络探测失败后前台读取永久 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`TOPIC-03`；共享回归 `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`USER-01` |
| 用户症状 | 打开 linux.do Topic 后页面一直 Loading，既不请求 Topic，也不出现验证窗口；用户手动进入 linux.do 验证、保存状态并再次打开后才正常加载。 |
| 触发条件 | canonical Account probe 在收到 HTTP Response 前以 `network_error` 结束；身份 barrier 长期保持 pending，Topic Query 被禁用，而 UI 把“无数据、无 Query 错误”误解释为 Loading。现有 CF response 检测器没有运行，因此现场不能把底层 transport 错误直接认定为 Cloudflare。 |
| 根因 seam | exact `/session/current.json` 的 canonical Account reader → direct/hidden WebView transport → 结构化身份检查终态 → `useAccountRuntime` 前台单站 intent → Feed/Search/Topic/User Query barrier 与验证面板。 |
| 必须保持的行为 | linux.do Account 只走 canonical `getCurrentUserProfile`，当前用户为登录、404 或明确匿名字段为退出，其余为 unknown。只有 exact GET、`owner=account`、`priority=background` 的 direct `network_error` 可进入一次 hidden WebView；timeout、cancel、HTTP、其他 URL/owner/priority 和写操作不得进入。hidden 成功提交权威身份，可信 challenge 保持 `verification-required`，普通失败保持 ordinary。身份 checking 显示“正在确认 L 站访问状态”；unknown 终态停止无限 Loading，在前台单站 Feed/Search/Topic/User 显示真实错误、重试 Account probe 和“检查 L 站状态”，旧可信内容保持只读。typed challenge 每个前台 intent 最多自动打开一次，用户关闭后同 intent 不重开；聚合、后台、AI、预取、Level 和写操作不自动弹窗。用户显式检测成功先提交 canonical identity 再关闭，barrier 释放后未启动的原 Query 自然启动一次；已启动 Query 的 exact recovery 协议不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 固定 direct network error 后 hidden success、可信 challenge、普通失败三终态以及 timeout/cancel/foreground Account/其他 owner/URL/POST 零 fallback；`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定 current user、404、明确匿名字段和普通 401/403/429 语义；`tests/ui/account/account-status-controller.test.tsx` 固定结构化 error、同 intent 单弹和 ordinary/无前台 intent 零弹；`tests/ui/topic/topic-session-controller.test.tsx` 固定 route 已激活而 Topic request=0、auto panel=0；`src/features/account/useVerificationController.test.ts` 固定 barrier 内状态入口只开面板、不重试未启动 Query；Feed/Search/Topic/User 组件测试固定 checking、terminal error、重试与检查入口。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：transport、canonical 身份语义、intent latch、Query 次数和用户可见终态必须共同固定；App 能启动、源码字符串或只看到 Modal 都不足以证明恢复链路。 |
| Replay 或真实验收路径 | 基于当前 revision 构建 x86_64 Release 并覆盖安装，保留 App 数据、Cookie 和登录态；正常 linux.do Topic 不误弹，返回和状态保持正确。只有自然再次出现 challenge 时才验自动弹一次、用户检测成功后原页自然加载；否则 CF 专项记 `NOT_VERIFIED`，不得清数据制造 challenge。 |
| 负向验证方式 | 恢复重复 Account client、让普通 `network_error` 直接保持永久 pending、放宽 fallback URL/intent/reason、把 hidden 普通失败升级成 CF、让 UI 在 terminal unknown 继续 Loading，或清空 intent latch 后同页重弹；对应编号测试必须失败。 |
| 明确不覆盖范围 | 不证明现场 direct `network_error` 的底层原因就是 Cloudflare，不绕过验证、不自动登录、不清 Cookie、不增加全局重试器或状态平台，也不改变持久化 schema、原生配置、外部 API 和写权限。 |

## `REG-VERIFICATION-001` WebView 页面事件取代用户检测

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`；共享读取回归 `FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | linux.do、NodeSeek 或妖火面板在页面加载/跳转时自动保存、恢复或关闭；用户随后点击“检测状态/登录”却复用已消费的内部结果，没有重新读取当前凭据，最终出现“暂未生效”、旧结果覆盖新结果或开关循环。 |
| 触发条件 | WebView `onLoadEnd` 或 probe message 直接调用检测/保存/recovery，把页面观察当成用户提交；业务 recovery 另有永久 one-shot guard，导致第一次失败后后续按钮不再联网。 |
| 根因 seam | WebView 的候选观察边界 → 用户显式检测的提交边界 → generation/session 所有权 → 原读取 recovery 的完成证明。 |
| 必须保持的行为 | 验证/登录面板仍可因当前前台读取失败自动打开，但 WebView load、readiness、probe 和 message 只更新当前面板候选、User-Agent 与诊断，不得保存凭据、发布 canonical session transition、调用 recovery 或关闭面板。检测按钮单次只允许一个在途操作；每次已结算后再次点击都必须重新读取当前 Cookie/凭据并执行真实来源检查，不得返回永久缓存或 one-shot 结果，迟到结果必须由 panel session、credential generation 和 request owner 判 stale。linux.do 携带 exact recovery 时，只有同一原读取返回 `completed` 才关闭；仍为 CF 或普通失败时保留面板和 recovery，Account 手动入口成功后仍保持打开。NodeSeek 页面消息不得直接判 canonical 过期，检测按钮每次重新读 Cookie stores；妖火按钮每次 flush stores 并执行 direct 登录检查。小隐寺 Device Code polling 与 NodeImage OAuth callback 是协议终态，不属于检测按钮，继续自动完成。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 固定 challenge/普通 WebView message 均不能在用户点击前消费 recovery，并固定连续两次已结算检测会执行两次 exact resume；`tests/ui/account/account-controller.test.tsx` 固定 Level 再次 CF 后下一次显式恢复产生第三次真实 source 调用、NodeSeek 每次手动检测重新读取 stores、妖火每次手动检测重新 flush 并 direct check；Account controller 不再接收可由 NodeSeek page message 发布 canonical transition 的接口；`tests/ui/account/account-site-panels.test.tsx` 固定 NodeSeek/妖火 `onLoadEnd` 不触发检测而按钮触发。既有 Feed/Search/Topic/User exact recovery、Session generation 与 OAuth/Device Code 测试继续通过。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：必须观察真实 Cookie/store/source 调用次数、exact recovery 结果与面板终态；仅证明 WebView 已进入首页、Cookie 字符串存在、提示变化或 Modal 可见不构成检测成功。 |
| Replay 或真实验收路径 | 不清 App 数据、Cookie 或登录态：分别打开 linux.do、NodeSeek、妖火面板，等待页面完成后确认没有自动成功/关闭；每次点击检测都应出现新的脱敏 credential/source trace。自然出现 CF 时，linux.do 原读取成功后才关闭，仍为 CF 时保持可再次点击；无法自然触发 CF 时该段记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一 `onLoadEnd`/message handler 中重新调用检测或保存，给 recovery 恢复永久 `resumed` guard，或让 NodeSeek 被动 logged-out message dispatch `login-expired`；对应编号测试必须出现点击前副作用、第二次无 source 调用或 canonical 状态污染并失败。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不伪造 clearance、不自动重放写操作；不把 OAuth redirect 或 Device Code server poll 错当成普通 WebView readiness，也不引入新的全局任务调度器。 |

## `REG-VERIFICATION-002` 业务响应关键词被误判为验证页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | linux.do 搜索返回正常结果后却打开 CF 面板；面板显示已登录的普通首页，没有 challenge。用户点击“检测状态”时 WebView Cookie 已重新读取并保存，但恢复搜索再次被误判，于是仍提示“验证未生效”。NodeSeek 或妖火的 API、帖子正文出现相同关键词时也可能错误拉起验证/登录面板。 |
| 触发条件 | linux.do/NodeSeek 的 transport 与隐藏 WebView 无条件扫描完整响应正文或页面文本中的 `cf-turnstile`、`challenge-platform` 等词，或仅凭普通 `403`、`429`、登录接口 `404` 推断 challenge；妖火把正文中的“访问验证”、`CAPTCHA_CONFIG` 或“请先登录网站”直接当作页面状态。正常 JSON、可读 HTML、限流或代码讨论因此取得了验证工作流执行权。 |
| 根因 seam | 来源 transport 响应元数据与正文 → Cloudflare/访问验证分类器 → direct/WebView fallback → session recovery 与验证面板。 |
| 必须保持的行为 | `cf-mitigated: challenge` 始终是 Cloudflare 权威信号，即使响应 MIME 异常也必须进入验证；缺少 header 时只检查 HTML challenge 的 title、表单、Turnstile/Challenge DOM 或 script。普通 `403`、`429` 或登录接口 `404` 本身均不是 challenge，只按各站现有业务/身份协议结算；明确非 HTML、JSON Content-Type、无 Content-Type 但正文为 JSON、普通 HTML 讨论文字也不得触发 CF。NodeSeek 已识别的列表、详情、受限提示、搜索或 JSON 必须优先作为业务页面；隐藏 WebView 也先返回 JSON/可读业务 DOM。妖火只有验证页 title、captcha script/元素等结构证据才进入访问验证；可读帖子里的验证、登录文案和代码示例仍是正文。真正 challenge、用户显式检测、exact recovery 和面板关闭语义继续由既有回归保持。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 用合法 Discourse 搜索 JSON 固定当前设备日志中的误判，并固定 NodeSeek JSON/普通 HTML、无 challenge header 的普通 403/429 不进入 WebView fallback；`src/sources/sourceErrors.test.ts` 固定 header 优先、严格 HTML 结构、无 header JSON、普通 HTML 文本与普通状态码均为非 challenge；`tests/integration/hidden-browser-scripts.test.ts` 固定两站隐藏 WebView 的 JSON 和可读 NodeSeek DOM 优先；`src/sources/yaohuo/reader.test.ts` 固定普通帖子可讨论“访问验证”“请先登录网站”和 `CAPTCHA_CONFIG`。这些用例修复前分别抛出 CF、调用 fallback、回传 `challenge:true` 或抛出妖火验证错误。 |
| 最低可靠自动测试层 | `UNIT_PASS`：需要走真实来源 adapter、fallback 与 WebView bridge script，而不是只断言一个正则。既有 verification controller UI 测试继续固定面板与 recovery 接线。 |
| Replay 或真实验收路径 | 在身份匹配的新 APK 中使用触发本事故的同一 linux.do 关键词：响应为正常 JSON 时直接展示结果，不打开面板；若自然收到真实 `cf-mitigated`/HTML challenge，则只打开一次面板，用户完成后原请求恢复一次。NodeSeek/妖火只读页面出现验证讨论文字时仍可读取。不得清 Cookie 或人为绕过 challenge。 |
| 负向验证方式 | 恢复正文 `includes` 正则、让隐藏 WebView 先扫描 challenge 词再识别 JSON/业务 DOM、删除 NodeSeek 可读页面优先级或让妖火重新扫描全部正文；对应编号测试必须再次出现 CF error、WebView fallback、`challenge:true` 或妖火验证错误。 |
| 明确不覆盖范围 | 不绕过或代做任何 challenge，不把 Cookie 存在当作验证成功，不改变 `REG-VERIFICATION-001` 的用户检测提交边界，也不保证第三方站点未来 HTML 结构永不变化；未知响应仍按普通来源错误处理，不能猜成验证成功。 |

## `REG-VERIFICATION-003` 验证 WebView 使用伪造或过期 User-Agent

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04`；共享读取回归 `FEED-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | NodeSeek Cloudflare 页面可以显示复选框，但用户每次点击后又回到未勾选状态，始终停留在 `Just a moment...`；相同身份错配也可能让 linux.do、NodeImage 或妖火的 WebView 会话不能被后续请求一致复用。 |
| 触发条件 | App 给 Android WebView 或同站 HTTP 请求强制设置固定 Chrome 版本的 User-Agent，手工发送与真实引擎不一致的 `sec-ch-ua*`，或保存前删除真实 WebView UA 的 `wv` 与 `Version/4.0` 标记。 |
| 根因 seam | Android WebView provider 的默认身份 → NodeSeek、NodeImage、linux.do、妖火可见 WebView → probe/原生桥取得的真实 UA → Cookie/access 持久化 → 隐藏 WebView、媒体、读取与写操作。 |
| 必须保持的行为 | 原生桥用 `WebSettings.getDefaultUserAgent()` 提供唯一当前平台默认值；NodeSeek、NodeImage、linux.do、妖火可见 WebView 不设置自定义 `userAgent`，由 provider 自己选择真实身份；probe 只规范空白并保留 `wv`、`Version/4.0`，后续请求使用同一 provider 身份，不伪造固定 Client Hints，旧 SecureStore UA 不得覆盖当前运行时值。该收敛不增加站点级 UA 状态机。修复和重新验证不得清除 App 数据、登录 Cookie、SecureStore、代理配置或其他站点会话；页面事件仍只更新候选，必须由用户显式点击“检测登录”提交。 |
| 精确失败 oracle | `src/platform/android/androidWebViewUserAgentValue.test.ts` 与 `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 要求原生桥输出并原样保留 provider UA，且旧存储 UA 不覆盖当前运行时身份；`tests/ui/account/account-site-panels.test.tsx` 要求 NodeSeek、linux.do 与妖火可见 WebView 的 `userAgent` prop 缺失；`src/sources/yaohuo/reader.test.ts` 与 `src/sources/yaohuo/actionClient.test.ts` 要求妖火读取/写入使用 provider UA 且不发送固定 `sec-ch-ua*`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` 固定 WebView adapter 与持久化行为；源码字符串、App 能启动或只看到 challenge 复选框都不能证明完整验证可通过。 |
| Replay 或真实验收路径 | 不清 App 数据和登录态，在 WebView provider 受支持的当前 Android 环境分别打开 NodeSeek、linux.do 与妖火登录/验证页；自然出现 challenge 时只由用户点击，成功后页面离开验证页，再点站内检测恢复原读取。模拟器环境仍被 Cloudflare 拒绝时记 `BLOCKED_BY_ENV`，使用真实 Android 设备复核，不自动代做或绕过 challenge。 |
| 负向验证方式 | 重新向任一可见验证 WebView 传入固定 UA、让旧存储 UA 覆盖当前 provider，或在 sanitizer 中删除 `wv`/`Version/4.0`，对应编号测试必须失败。 |
| 明确不覆盖范围 | 不自动解决 Cloudflare，不伪造 clearance，不通过切换 IP、代理或浏览器指纹规避站点策略；Android System WebView 更新属于验收环境维护，不由 App 静默安装。 |

## `REG-VERIFICATION-004` 登录 WebView 超时后仍持续运行

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`、`MORE-02`；共享 `RELEASE-02` |
| 用户症状 | 登录面板已经显示“页面打开超时”，但第三方页面仍在后台刷新；Android accessibility 无法读取 App 自有错误、刷新按钮或 `nodeseek-login-webview-settled`，Release Replay 永久等到失败。 |
| 触发条件 | NodeSeek、linux.do 或妖火页面主体已可见，但子资源、脚本或持续变化的 DOM 让 `onLoadEnd` 长期不触发；12 秒 watchdog 只关闭 Loading 并写错误文案，没有终止当前 WebView generation。 |
| 根因 seam | 登录面板 terminal outcome 与原生 WebView renderer 生命周期分属不同 state owner；timeout 被当成展示状态，而不是当前 generation 的结束边界。 |
| 必须保持的行为 | 当前 generation 在 timeout 或 renderer gone 后立即卸载，停止继续占用 renderer 并让 App 自有错误、关闭和刷新入口恢复可访问；NodeSeek timeout 仍暴露 settled marker。Cookie、凭据、账号状态和面板本身不清除，用户可关闭；只有显式点击“刷新页面”才创建新 WebView generation。正常 `onLoadEnd`、用户检测提交和凭据填入不因普通 rerender remount。三站使用各自既有 state，不新增 scheduler 或测试专用产品入口。 |
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 的 `REG-VERIFICATION-004` 分别用 12 秒 fake timer 驱动 NodeSeek、linux.do、妖火，要求 WebView 卸载且显式刷新后恰好 remount；旧实现三例都保留 `mock-login-webview`。`tests/device/nodeseek-session.ad` 在真实 Android 上等待 App 自有 settled marker、刷新和返回，不读取第三方 DOM。 |
| 最低可靠自动测试层 | `UI_PASS` + `DEVICE_REPLAY_PASS`：RNTL 固定三站组件生命周期，Release APK Replay 证明失败 WebView 不再阻断 Android hierarchy；截图只能辅助定位，不能替代可重复 oracle。 |
| Replay 或真实验收路径 | 用与 revision/version/SHA-256 匹配的 Release smoke APK 覆盖安装且保留登录态，运行零重试 `nodeseek-session.ad`；页面正常完成或 12 秒后进入 App 错误均应结算，刷新创建新页面，系统返回回到 More。linux.do、妖火由同一轮只读 Agent Live 检查 timeout/renderer gone 时的错误与刷新入口。 |
| 负向验证方式 | 删除 timeout 的卸载状态、让刷新前自动 remount，或在 timeout 后继续渲染旧 WebView；三个 UI oracle会看到旧 mount，NodeSeek Replay 会再次因 busy hierarchy 超时。 |
| 明确不覆盖范围 | 不保证第三方页面或 challenge 当天可达，不把 timeout 当作登录成功，不自动重试、清 Cookie、改变登录态、绕过验证或读取第三方 DOM。 |

## `REG-ACCOUNT-001` 身份读取失败覆盖已确认账号状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 用户症状 | NodeSeek、linux.do 或妖火网站登录仍可能有效，但刷新账号状态时身份接口暂时失败，账号中心却把上次已确认的用户名清空并显示成新的 Cookie 状态。 |
| 触发条件 | Cookie/登录检查成功后，当前用户资料读取 rejection 或返回未知；controller 先记录 failed site，随后仍 dispatch `cookie-loaded` 且 `currentUser=null`。 |
| 根因 seam | `useAccountStatusController` 的站点检查终态与 `SiteSessionState` 的可信身份保留契约。 |
| 必须保持的行为 | 身份检查失败必须 dispatch `check-failed`，保留上次可信状态和用户，仅更新错误提示；只有身份检查确实完成时才能发送 `cookie-loaded`。刷新整体以 partial 结束并准确列出失败站点。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 分别固定 NodeSeek、linux.do、妖火身份读取失败，要求出现 `check-failed`、禁止同站 `cookie-loaded`，并保持其他站点继续完成。 |
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
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 让 NodeSeek 凭据 loader rejection，要求 linux.do 和妖火仍 dispatch `cookie-loaded`、NodeSeek dispatch `check-failed`，且提示只列 NodeSeek。 |
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
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 的 `REG-ACCOUNT-003` 注入单站 SecureStore rejection，要求另外两站仍产生恢复事件，失败站产生 `check-failed`，且公共刷新不抛出。 |
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
| 必须保持的行为 | 确认失效后只发布 `login-expired` 并保留原站 WebView Cookie与 App 快照；普通检测、刷新和写失败都不调用清理。只有用户明确点击“清除登录”才执行删除并发布 `cleared`。 |
| 精确失败 oracle | `tests/ui/account/account-controller.test.tsx` 的 `REG-ACCOUNT-026` 注入可观察的妖火清理回调，让当前账号验证明确返回 expired，要求清理零调用且最后事件为 `login-expired`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须固定完整事件顺序；只测清理 helper 或 reducer 单事件不能发现终态覆盖。 |
| Replay 或真实验收路径 | 不主动篡改 sid 制造失效；自然遇到失效时核对账号中心显示已失效而非普通未登录。 |
| 负向验证方式 | 在妖火 expired 分支恢复任一 App 快照或原站 Cookie 清理调用，编号测试应观察到未经授权的删除。 |
| 明确不覆盖范围 | 不改变妖火失效判定规则，不清真实登录态制造用例。 |

## `REG-ACCOUNT-005` NodeSeek 登录桥接接受非站点页面消息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-03`、`MORE-02` |
| 用户症状 | NodeSeek 登录 WebView 加载允许的 Cloudflare challenge 页面时，该页面伪造或碰撞 `nodeseek-login` 消息即可污染 App 保存的用户 ID、User-Agent 或 Cookie 候选。 |
| 触发条件 | WebView 为 challenge host 执行探针，消息处理器只校验 payload 类型，没有校验 `nativeEvent.url` 的 HTTPS host。 |
| 根因 seam | `useAccountController.handleLoginMessage` 的 WebView 消息来源信任边界。 |
| 必须保持的行为 | 只有 HTTPS `nodeseek.com` 及其子域消息可以更新 NodeSeek 登录候选；允许导航的 Cloudflare challenge host 只负责完成挑战，不能写入账号桥接状态。 |
| 精确失败 oracle | `tests/ui/account/account-controller.test.tsx` 的 `REG-ACCOUNT-005` 从允许的非 NodeSeek challenge URL 发送合法形状 payload，要求用户 ID、User-Agent 和 Cookie 状态均不改变。 |
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
| 精确失败 oracle | `src/features/account/credentialDiagnostics.test.ts` 的 `REG-ACCOUNT-006` 注入单站 rejection，要求结果仍携带另两站摘要；`src/features/account/useAccountCredentialController.test.ts` 固定部分摘要会合并进 UI 状态。 |
| 最低可靠自动测试层 | `UNIT_PASS`：helper 返回契约和 controller 应用都要覆盖；只证明错误被 catch 不能证明成功摘要没有丢失。 |
| Replay 或真实验收路径 | 正常进入账号中心核对原三站保存摘要；不读取或显示密码，不破坏 SecureStore 制造失败。 |
| 负向验证方式 | 让失败结果再次只返回 error，编号测试应发现成功站 summaries 缺失。 |
| 明确不覆盖范围 | 不自动填入或提交登录表单，不把凭据摘要等同于网站登录状态。 |

## `REG-ACCOUNT-007` 登录凭据未清完却显示已清除或覆盖失效错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户明确清除 NodeSeek、linux.do 或妖火登录后，界面提示已清除，但 WebView Cookie 仍可能保留；反过来，账号检测、刷新或写操作误判失效时如果复用这条破坏性事务，会把原站会话一起删掉并造成重复登录。 |
| 触发条件 | 显式清除先 dispatch `cleared` 再完成 SecureStore/WebView 删除，或任意自动检测/请求错误获得了同一个原站 Cookie 清理回调。 |
| 根因 seam | `useSessionController` 的 multi-store 清理提交顺序、credential generation 返回契约，以及破坏性清理能力的调用权限边界。 |
| 必须保持的行为 | 只有用户明确点击该站“清除登录”才能启动原站 Cookie 删除；SecureStore 与目标 WebView Cookie 都成功后才发布 `cleared`，任一步失败发布可重试错误。NodeSeek 只删登录 Cookie并保留 CF。账号检测、公共刷新、明确过期和写操作失败只更新 App 投影或保留原错误，绝不调用这条事务。 |
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 的 `REG-ACCOUNT-007` 分别让 NodeSeek/妖火显式 CookieManager 清理失败，禁止 `cleared` 并要求 `check-failed`；成功妖火清理必须实际读取并过期 WebView Cookie。`tests/ui/account/account-controller.test.tsx`、`src/features/account/useVerificationController.test.ts` 与 `tests/ui/topic/topic-actions-controller.test.tsx` 固定检测/失效/写失败分支没有清理能力且保留 typed `login-expired` 或原动作错误。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须覆盖 SecureStore、CookieManager、session dispatch 和 gateway error 的完整顺序；只测 Cookie helper 或最终按钮文案无法证明两套存储一起提交。 |
| Replay 或真实验收路径 | 默认不点击真实“清除登录”；只有用户明确授权时，清除后重载 App 内站点并核对已退出且账号中心状态一致。 |
| 负向验证方式 | 恢复先 dispatch `cleared`、让妖火删除 task 返回 void，或把清理回调重新注入检测/刷新/写失败分支，编号测试必须分别失败。 |
| 明确不覆盖范围 | 不清 App 数据、不批量清其他站 Cookie，也不把保存的自动填入凭据与网站登录一起删除。 |

## `REG-ACCOUNT-008` 单站刷新收尾失败阻断其他账号状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | 账号公共刷新已完成各站网络检查后，妖火或 linux.do 的过期清理、NodeSeek 身份持久化任一步失败，其他站状态都不再应用；linux.do 明确过期还会最终显示成普通未登录/已验证。 |
| 触发条件 | 多站 `Promise.allSettled` 之后的三个站点收尾动作仍由公共 try fail-fast 执行；linux.do 清理后统一走 `cookie-loaded` 分支。 |
| 根因 seam | `useAccountStatusController` 的站点检查结果与后续 multi-store 提交、最终 SiteSessionState 投影边界。 |
| 必须保持的行为 | 每个站的验证或身份持久化失败只把该站加入 partial，并允许其他站完成；NodeSeek 保存失败保留刚确认的身份并追加 `check-failed`，妖火/linux.do 确认过期始终以 `login-expired` 结束。账号刷新不执行原站 Cookie 清理，因此不存在用清理结果覆盖失效结论的第二个终态。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 注入 NodeSeek 身份持久化失败并断言已确认用户仍保留、其他三站继续更新；妖火/linux.do 明确过期只允许 expired Query 快照，不得再由 `cookie-loaded` 镜像覆盖，也不得调用 Cookie 清理。 |
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
| 必须保持的行为 | 三站分别捕获请求开始时的 generation；检查、action、清理或身份持久化结束后只允许仍属当前 generation 的结果更新 UI、清理 SecureStore/WebView Cookie、更新 App 凭据候选或登录投影、弹登录入口或重置等级。媒体不存在独立 Cookie 状态；JS 只携带内容来源 marker 与 opaque identity，原生再按首跳与重定向链决定是否从 WebView CookieJar 实时读取，不从媒体目标 URL 推断身份。某站变 stale 不影响其他站、小隐寺或新会话继续完成。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 在旧刷新等待凭据读取时推进 generation，要求旧请求不执行远端身份读取、不写 Query data 或显示旧错误；`src/sources/readGatewayContract.test.ts` 固定 linux.do 等级等 managed read 在 transport 结算前换 generation 时拒绝且不落 cache；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 在 NodeSeek 删除进行中排队新登录保存，要求旧清理不再进入 WebView Cookie 和 `cleared` 提交；`tests/ui/topic/topic-actions-controller.test.tsx` 分别让三站旧 action 等待后推进 generation，要求不清新凭据、不改 session、不提示或打开登录。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须用 pending Promise 穿过真实 controller 的读取、网络和提交阶段；只测 generation queue helper 不能证明最终 session dispatch 受保护。 |
| Replay 或真实验收路径 | 正常账号中心刷新、App 内登录与只读动作入口分别覆盖成功行为；不通过自动化真实提交登录、写操作，也不清现有 Cookie 制造竞态。 |
| 负向验证方式 | 移除任一站最终提交前的 generation 比较，或再次把 NodeSeek 成功/stale 删除都表示成 void，编号测试必须看到旧清理、旧身份保存或旧 session 事件。 |
| 明确不覆盖范围 | 不取消用户正在进行的登录，不跨站共享 generation，不重放已发出的写请求，也不把 stale 结果报告为站点失败。 |

## `REG-ACCOUNT-016` 小隐寺账号 Query 回写授权 workflow

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 用户症状 | 账号中心刷新小隐寺后仍显示旧授权身份，或者 Query 已完成但界面实际依赖另一份 session 状态；后续只改 Query cache 时账号卡片不会同步。 |
| 触发条件 | 小隐寺 Account Query 只返回成功/失败布尔值，授权检查同时 dispatch 到 `SiteSessionState`，账号 view model 因 Query 没有 session data 而回退到 workflow projection。 |
| 根因 seam | `useXiaoyinsiAuthController` 的授权检查提交边界与 `useAccountStatusController` 的四站 Query data 投影。 |
| 必须保持的行为 | Account Query 使用不发布 workflow event 的只读授权检查，直接把检查产生的 session event 归约为该 Query 的 data；Device Code、撤销和被动失效流程仍可提交本地 workflow event。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 的 `REG-ACCOUNT-016` 预置与远端检查相反的旧小隐寺 workflow session，刷新后必须显示 Query 返回的匿名状态且清除旧身份；`tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 以仅提供 `aborted` 的 React Native 形态 `AbortSignal` 直接调用真实 `readAuthorization`，要求返回完整 session event、workflow dispatch 次数不增加，并且 `phase`、`pending`、`message` 全部保持不变。 |
| 最低可靠自动测试层 | `UI_PASS`：必须在真实 QueryClientProvider 下观察 controller 返回的账号 view model；只断言授权 helper 返回值或 session reducer 不足。 |
| Replay 或真实验收路径 | 更多 → 账号中心 → 刷新账号状态；核对小隐寺卡片与当前授权一致，再进入授权管理返回，状态不得回跳。 |
| 负向验证方式 | 让小隐寺 Query 再次只返回 `{ failed }` 并由授权检查 dispatch，编号测试应继续看到预置的旧登录身份。 |
| 明确不覆盖范围 | 不改变 Device Code、SecureStore、撤销授权或写操作被动复核的 workflow 事件语义。 |

## `REG-ACCOUNT-017` 小隐寺状态检查失败覆盖可信身份

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 账号中心已经确认小隐寺登录后，一次临时网络或服务错误会把账号立即显示成未登录，并同步撤掉依赖账户投影的写入口。 |
| 触发条件 | 小隐寺 Account Query 先成功得到身份，随后同一 Query key 的只读检查返回 `authenticated=null` 与 `check-failed`。 |
| 根因 seam | `src/features/account/useAccountStatusController.ts` 把检查失败包装成成功 Query data，并从初始匿名状态归约 `check-failed`，因此覆盖了 TanStack Query 原本应保留的最后可信 data。 |
| 必须保持的行为 | 明确 `authenticated=false` 仍可提交匿名状态；普通检查失败必须让 Query 进入 error，保留上一份成功 data/currentUser，仅在小隐寺卡片挂本次错误并把该站计入部分刷新失败。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 的 `REG-ACCOUNT-017` 先返回已登录的 `carol`，再返回 `authenticated=null/check-failed`，要求最终仍为 `logged-in`、保留同一用户、显示失败文案且通知只列出小隐寺。修复前稳定退成 `anonymous`。 |
| 最低可靠自动测试层 | `UI_PASS`：必须在真实 `QueryClientProvider` 下跨两次 refetch 观察 data/error 并存；单测 reducer 或只测一次请求不足。 |
| Replay 或真实验收路径 | 更多 → 账号中心 → 刷新；自然失败时核对旧身份和站点错误并存。不得断网、撤销授权或清凭据制造失败。 |
| 负向验证方式 | 把 `authenticated=null` 再次作为 `{ failed, session }` 成功返回，编号测试必须从预期 `logged-in` 精确失败为 `anonymous`。 |
| 明确不覆盖范围 | 不把服务端明确匿名或明确授权失效当成普通失败；不改变授权、撤销和 Device Code workflow。 |

## `REG-PROXY-001` 代理配置读取失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-01`、`MORE-04` |
| 用户症状 | 用户原本依赖服务器代理时，启动阶段 SecureStore 暂时读取失败，App 把代理状态当作“未启用”并让来源、登录 WebView 或更新请求直接联网。 |
| 触发条件 | 代理 load catch 用空状态继续完成启动，既没有设置 failed 门禁，也没有阻止随后对空 profile 执行 native disable。 |
| 根因 seam | `useNetworkProxyRuntime` 的安全存储加载终态、native apply effect 与 `ensureNetworkProxyReady` 门禁。 |
| 必须保持的行为 | 代理配置读取失败必须进入用户可见 failed 状态并阻断所有受代理保护请求，不能推断用户未启用代理；成功保存新的明确配置后才可退出加载失败门禁并重新应用。 |
| 精确失败 oracle | `tests/tooling/network-proxy-controller-guard.test.ts` 的 `REG-PROXY-001` 注入 load rejection，要求 `ensureNetworkProxyReady` rejection 且提示配置读取失败。 |
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
| 根因 seam | `useAppUpdateRuntime` 的 check/download 并发所有权与同步 busy ref 门禁。 |
| 必须保持的行为 | 检查或下载任一操作正在进行时，另一个命令必须在 controller 层同步 blocked；只有当前已确认的 update info 才能创建下载任务。 |
| 精确失败 oracle | `src/platform/update/useAppUpdateRuntime.test.ts` 的 `REG-UPDATE-001` 保持检查 Promise pending 后立即调用下载，要求不创建 `DownloadResumable`。 |
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
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 固定当前 WebView attempt 的成功、明确错误和代理阻断都进入 App 自有 `nodeseek-login-webview-settled`，永久 Loading 不结算且始终保留“刷新页面”；`tests/device/nodeseek-session.ad` 只等待该 marker、刷新入口和返回链。 |
| 最低可靠自动测试层 | `UI_PASS` 固定 App-owned settled 分支，`DEVICE_REPLAY_PASS` 证明 Android WebView surface、刷新和返回链；第三方正文或身份当前可用仍需 `LIVE_PASS`。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad` 不读取第三方 DOM；动态登录结论只接受 App 内同类页面，并由 Agent Live 形成独立数据证据。 |
| 负向验证方式 | 删除 settled、刷新或返回等待，恢复第三方标题/logo/帖子文案，或让 Loading 提前暴露 settled，UI/Replay 守卫必须失败。 |
| 明确不覆盖范围 | Replay 不清登录、不清 Cookie，也不声明当天原站 DOM 永久稳定。 |

## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | NodeSeek 登录 WebView 已显示“页面打开超时”或加载失败，Replay 仍因 ready testID 可见而通过。 |
| 触发条件 | readiness 脚本消息在超时或错误状态之后到达；旧 Replay 又固定等待 15 秒，只检查 ready testID，不检查错误是否存在。 |
| 根因 seam | `src/features/account/components/NodeSeekLoginHost.tsx` 的 WebView readiness/error 状态和 `tests/device/nodeseek-session.ad` 的等待 oracle。 |
| 必须保持的行为 | 成功、明确错误或代理阻断都让当前 attempt 进入 App 自有 settled；错误必须可见并保留“刷新页面”，迟到成功消息不得覆盖错误。Loading 期间不暴露 settled。Replay 证明流程结算，不把错误分支叫作第三方成功。 |
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 分别固定成功与错误共享 `nodeseek-login-webview-settled`、错误文案与刷新入口，并让迟到/伪造消息不能把错误改成成功；`tests/tooling/android-smoke-guard.test.ts` 禁止固定 sleep 和 success-only oracle。 |
| 最低可靠自动测试层 | `UI_PASS` 固定分支互斥和共同 settled；`DEVICE_REPLAY_PASS` 再证明 Android surface 能结算、刷新和返回。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad` 等待 App-owned settled 和刷新入口；数据/身份是否真实成功另由 Agent Live 报告，明确外部阻碍记数据 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 让 Loading 提前暴露 settled、错误后隐藏刷新、迟到成功覆盖错误，或把 Replay 改回只等成功，UI/Replay 守卫必须失败。 |
| 明确不覆盖范围 | 不保证 NodeSeek 当天必定可访问；正确错误流程不冒充第三方数据成功，也不掩盖 App 请求或会话缺陷。 |

## `REG-NODESEEK-003` NodeSeek 真实页面已可用但 Replay 内部 marker 超时

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | App 内 WebView 已出现可操作内容，Replay 却依赖第三方标题、logo、“新帖子”或 success-only 内部 marker；DOM 变化或桥接时序会让正确流程超时。 |
| 触发条件 | 设备测试把第三方 DOM 细节或 success-only bridge 当成固定发布 oracle；健康、错误和代理阻断没有统一的 App-owned 结算表面。 |
| 根因 seam | `tests/device/nodeseek-session.ad` 的设备级 oracle 及 `tests/tooling/android-smoke-guard.test.ts` 的 Replay 守卫；不是 NodeSeek 页面加载产品逻辑。 |
| 必须保持的行为 | Replay 只等待当前 attempt 的 `nodeseek-login-webview-settled`、App 自有“刷新页面”和系统返回；成功、明确错误或代理阻断均可结算，永久 Loading 失败。不得读取第三方标题、logo、帖子文案，也不得增加 sleep 或 retry。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 禁止 `logo`、“新帖子”、第三方 DOM 和旧 `nodeseek-login-webview-ready`，并要求 settled/刷新/返回；`tests/ui/account/account-site-panels.test.tsx` 固定 marker 只属于当前已结算 attempt。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 Replay 判据，`UI_PASS` 固定 App-owned settled，`DEVICE_REPLAY_PASS` 证明 Android WebView surface 和返回路径。 |
| Replay 或真实验收路径 | 运行静态守卫与账号 WebView RNTL 后，在身份匹配的 APK 上执行 `tests/device/nodeseek-session.ad`；第三方内容和登录态另由 Agent Live 核实。 |
| 负向验证方式 | 恢复第三方 DOM、success-only marker、固定 sleep 或无等待的重复可见性检查，守卫必须失败；让 Loading 暴露 settled，UI 测试失败。 |
| 明确不覆盖范围 | 不声明 NodeSeek 原站永久可用；数据/身份结果和 App 流程分开报告，也不以 settled 代替 Cookie 内容核对。 |

## `REG-DATA-001` ReaderData 实验与代码回退不兼容

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`、`DATA-02`、`DATA-03` |
| 用户症状 | 新实验写入了旧代码不能读取的本机数据；代码回退后收藏、历史和关注看似丢失。 |
| 触发条件 | 改动 `reader-data` key、version、schema、序列化、分块或保存顺序，却只验证新代码读取新格式。 |
| 根因 seam | `src/domain/reader/readerData.ts`、`src/platform/storage/readerDataStore.ts`、备份导入和保存队列。 |
| 必须保持的行为 | 当前 version 2 数据可读；失败写入不覆盖旧数据；新旧备份契约明确；改变格式时同时证明升级、失败回滚和代码回退结果。 |
| 精确失败 oracle | 无效 version 必须被拒绝，迟到写入不得覆盖最新状态，损坏/超限备份不得改变原数据。 |
| 最低可靠自动测试层 | `UNIT_PASS`：`src/domain/reader/readerData.test.ts`、`src/platform/storage/readerDataStore.test.ts`、`src/domain/reader/readerBackup.test.ts`、`src/platform/storage/backupOperation.test.ts`。 |
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
| 最低可靠自动测试层 | `DEVICE_REPLAY_PASS` 的身份前置门禁；`tests/tooling/android-smoke-guard.test.ts` 固定脚本契约。 |
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
| Replay 或真实验收路径 | `tests/tooling/android-smoke-guard.test.ts`；`npm run test:device`；必要时只读检查显式设备的 `/sdcard/agent-device-recording-*` 数量和剩余空间。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 用 `id=emulator-5554`、`name=WZ Pixel API 35` 的真实列表形状断言 Replay 参数为 `--device WZ Pixel API 35`；恢复传原始 ID 时测试先失败，真实 Replay 再精确失败在第一步 `open`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 ID → 名称映射，`DEVICE_REPLAY_PASS` 证明 agent-device 实际接受该参数并走完六条普通旅程；隔离未登录旅程另行形成独立证据。二者缺一不能宣称对应设备闸门恢复。 |
| Replay 或真实验收路径 | `npm test -- tests/tooling/android-smoke-guard.test.ts`；随后在身份匹配的保留数据设备上执行 `npm run test:device`，六条普通 Replay 均须 `retries=0`；需要未登录证据时另在隔离 AVD 执行 `npm run test:device:logged-out`。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 以清单设备 `emulator-5554 / WZ Pixel API 35` 断言配置值 `WZ_Pixel_API_35` 唯一映射到同一设备；修复前返回空数组。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定纯设备匹配，`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 证明 release 命令能在同一保留数据设备继续完成。 |
| Replay 或真实验收路径 | `.env.release.local` 保持 `WZ_ANDROID_SMOKE_DEVICE=WZ_Pixel_API_35`，执行 `npm run release:android`；身份行必须记录解析后的 display name/ID，六条普通 Replay 全部零重试通过；真实未登录另按 `REG-OPS-009` 在隔离 AVD 执行。 |
| 负向验证方式 | 在隔离测试中恢复完全相等比较，AVD 名映射断言必须收到空数组；不改真实 AVD 名、不创建重复设备制造失败。 |
| 明确不覆盖范围 | 不把连字符、任意标点或部分字符串当成同一设备；归一化后出现多个候选仍必须拒绝，也不自动启动另一台设备。 |

## `REG-OPS-005` 覆盖安装后的首次启动逃出日志窗口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 覆盖安装后的第一次启动发生崩溃，但脚本随后清空本机日志文件并执行第二次健康 relaunch，最终仍可能输出 `APK_SANITY`。 |
| 触发条件 | Smoke 依次执行覆盖安装、第一次 `open`、`logs clear --restart`、第二次 `open --relaunch`；agent-device 又要求先有 app session 才能启动日志流。 |
| 根因 seam | `scripts/smoke-android.mjs` 把建立 agent-device session 的第一次 `open` 放在受检查日志窗口之外；第二次启动证据不能证明新 APK 的首次启动没有失败。 |
| 必须保持的行为 | 覆盖安装成功后先读取设备 epoch，再于第一次 `open` 前向设备 logcat 写入唯一 marker；流程结束后以 `logcat -T <epoch>` 有界读取日志，从 marker 起只保留目标包名行和由启动/崩溃记录确认的目标包 PID 行，再检查崩溃、ANR 与 RedBox。marker 丢失必须失败；日志读取不得受 Node 默认 1 MiB 缓冲限制，也不得清空全局 logcat。既有 agent-device session 日志继续检查第二次 relaunch、`main-tab-feed` 和前台包名，不依赖第三方 Feed。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 注入一个“后续 appstate/Feed 都成功，但首次启动 PID 输出 `FATAL EXCEPTION`”的命令 runner，断言仍返回含“Android 崩溃”的 `AggregateError`，并固定 `install < device epoch < marker < first open < logcat -T dump`。修复前同一首次启动不在任何受检窗口；真实设备曾用完整 logcat 触发 Node `ENOBUFS`，故同一 oracle 也固定有界起点。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定命令顺序、包/PID 裁剪和首次崩溃 oracle；`APK_SANITY` 在明确设备上证明 marker 与真实 logcat 命令可用。 |
| Replay 或真实验收路径 | `npm test -- tests/tooling/android-smoke-guard.test.ts`；在目标 APK 和保留数据设备上运行 `npm run smoke:android`，确认首次启动与 session relaunch 均无运行时失败。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 拒绝任何 tracked Replay 中的独立 `close`；完整设备执行后每条 trace 都有成功的 `video_recording_stop`，且 manifest、工具 `screenrecord` 和录屏 scratch 均为 0。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定六条普通与一条隔离未登录 Replay 的生命周期契约；`DEVICE_REPLAY_PASS` 证明真实 daemon、manifest 和 Android `screenrecord` 连续收口。 |
| Replay 或真实验收路径 | `npm run test:device` 在空录屏基线上连续执行六条 `--record-video` Replay；未登录套件另在隔离设备执行一条，并分别核对设备与本机任务进程基线。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-007` fixture 同时包含 MP4、正式 manifest、`.tmp`、用户文件和畸形工具名，只接受前三类 agent-device 路径。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定文件存在性门禁；`DEVICE_REPLAY_PASS` 证明真实录屏结束后这些路径均归零。 |
| Replay 或真实验收路径 | `npm test -- tests/tooling/android-smoke-guard.test.ts` 后，在身份匹配设备执行 `npm run test:device`，执行前后只读核对 active manifest、`.tmp`、工具 MP4 与 recorder 进程。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-008` 断言最低版本为 0.19.0，拒绝 0.18.9 和 0.19.0 beta，接受 0.19.0 及更高稳定版本。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定版本比较；`DEVICE_REPLAY_PASS` 证明当前可信安装实际接受 runner 参数。 |
| Replay 或真实验收路径 | 先执行版本门禁，再在明确设备运行 `npm run test:device`；版本不满足时不得进入设备发现、录屏或 App 操作。 |
| 负向验证方式 | 把最低版本恢复为 0.14.0，`REG-OPS-008` 必须精确收到旧值并失败。 |
| 明确不覆盖范围 | 不自动安装或升级全局工具；未来版本若移除参数，需要单独更新兼容契约和测试。 |

## `REG-OPS-009` 未登录 Replay 与主设备套件混用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02`；关联 `ACCOUNT-01`、`FEED-01`、`SEARCH-01`、`SEARCH-04` |
| 用户症状 | 未登录旅程若在已有账号/Cookie 的主设备或 Release Smoke 上运行，会得到登录态结果或要求清除主设备数据；反过来，主设备基线也可能被未登录测试破坏。 |
| 触发条件 | 真实未登录 Replay 与普通六条 Replay 共用 `tests/device/`、同一个设备环境变量或自动设备选择。 |
| 根因 seam | 文件发现目录、设备选择和 APK 身份校验没有把“普通保留数据设备”与“从未登录论坛的隔离 AVD”建模为两个外部环境。 |
| 必须保持的行为 | `npm run test:device` 与 Release Smoke 只发现 `tests/device/` 六条普通旅程；`npm run test:device:logged-out` 只发现 `tests/device-logged-out/`，且必须显式设置与主测试/Smoke 设备不同的 `WZ_ANDROID_LOGGED_OUT_DEVICE`。两套都核对同一待测 APK 的 version/versionCode/SHA，均不得卸载、清数据或清 Cookie。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-009` 精确断言两个目录的文件集合、独立 runner、显式设备变量和 Smoke 不引用未登录目录；`logged-out-readonly.ad` 还要求四站 Account Query 在 relaunch 前后都结算为权威未登录状态，其中 NodeSeek 允许“未登录”或仅访客“已验证”，linux.do 显示“匿名可用”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定目录与设备门禁；六条普通 `DEVICE_REPLAY_PASS` 和一条独立未登录 `DEVICE_REPLAY_PASS` 分别证明两个真实环境，不能互相替代。 |
| Replay 或真实验收路径 | 主设备按原流程运行 `npm run test:device` / Release Smoke；独立 AVD 安装同一 APK 后设置 `WZ_ANDROID_LOGGED_OUT_DEVICE` 运行 `npm run test:device:logged-out`。Cloudflare 可在 App 内以访客身份验证，不登录论坛。 |
| 负向验证方式 | 把未登录文件放回 `tests/device/`、让独立 runner读取默认目录、删除显式设备门禁或配置成与主设备同名；`REG-OPS-009` 必须失败。 |
| 明确不覆盖范围 | 不自动创建、克隆、重置或删除 AVD；首次访客 Cloudflare 验证由用户监督，Google/CF 风控可形成 `BLOCKED_BY_ENV`。 |

## `REG-OPS-010` agent-device 诊断污染设备清单 JSON

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | Replay 在任何旅程和 APK 身份行之前失败，报 `Unexpected non-whitespace character after JSON`。 |
| 触发条件 | `agent-device devices --json` 成功返回 JSON，同时把 backend warning 写入 stderr。 |
| 根因 seam | `scripts/agent-device-runtime.mjs` 的 capture 路径把 stdout 与 stderr 拼接后作为机器可读结果返回。 |
| 必须保持的行为 | capture 只把 stdout 交给调用方解析；stderr 仍在 `echoCapture` 开启时显示，非零退出仍失败，不得吞掉工具错误。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 给成功 stdout 配一条 stderr warning，返回值仍能被 `parseAgentDeviceList` 解析。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定流分离；完整开发包与 Release Replay 证明真实 CLI 链路。 |
| Replay 或真实验收路径 | 当前开发包六条 `npm run test:device`，另在隔离 AVD 运行一条 `npm run test:device:logged-out`，随后执行 `npm run release:android` 的六条普通 Replay。 |
| 明确不覆盖范围 | 不屏蔽 stdout 中的非法内容，也不终止或替换无法证明归属的共享 daemon。 |

## `REG-OPS-011` runner 覆盖 Replay 自有超时预算

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 四来源 Feed 与 Search 已拿到结果并进入最后详情，却在目标加载成功前后报整条 `TIMEOUT after 180000ms`。 |
| 触发条件 | `.ad` 声明 240 秒预算，或长旅程实际需要超过 180 秒，而 runner 统一追加 `--timeout 180000`。 |
| 根因 seam | `scripts/run-device-replay.mjs` 的命令行 timeout 覆盖 tracked Replay 的 `context timeout`。 |
| 必须保持的行为 | 每条 Replay 自己声明 wall-clock budget；runner 继续固定 `retries=0`、`fail-fast`、录屏和报告器，不覆盖预算。`four-source-feed.ad` 继续声明 240 秒，不因当前步骤减少而建立第二套 runner 预算。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 断言 runner 不含统一 180 秒覆盖，且 `four-source-feed.ad` 声明 240 秒。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定配置边界；开发包六条普通、隔离 AVD 一条未登录与 Release 六条普通 `DEVICE_REPLAY_PASS` 分别证明真实 wall-clock 行为。 |
| Replay 或真实验收路径 | 在身份匹配且保留数据的指定设备上依次执行完整开发包 Replay 与 `npm run release:android`。 |
| 明确不覆盖范围 | 不增加重试，不延长单步 selector deadline，也不把真实请求、断言或 cleanup 失败改判为通过。 |

## `REG-OPS-012` 版本升级未递增 Android versionCode

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-01` |
| 用户症状 | 新版本已发布，但旧客户端因 manifest 的 versionCode 没有高于已安装版本而无法收到或安装更新。 |
| 触发条件 | 只检查 `package.json` 与 `app.json` 当前值一致，没有和上一可达正式 tag 比较。 |
| 根因 seam | `scripts/check-version.mjs` 的 Git release baseline 与 `scripts/release-android.mjs` 的 fail-closed 发布入口。 |
| 必须保持的行为 | versionName 相对上一正式版本变化时，versionCode 必须严格递增；普通无 tag checkout 明确 warning，正式发布缺少可读 baseline 必须在测试和 prebuild 前失败；CI 必须获取完整 history/tags。 |
| 精确失败 oracle | `tests/tooling/version-check.test.ts` 在临时 Git 仓库创建上一 tag：相同 versionCode 的新版本必须失败；无 tag 普通模式 warning 后成功，`--require-previous-release` 必须失败；另在只含当前提交但仍可达上一 tag 的真实 shallow clone 中，正式模式必须识别浅克隆并失败。`tests/tooling/release-workflow.test.ts` 固定严格门禁早于完整 verify 且 CI `fetch-depth: 0`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：通过真实 Git/Node CLI 验证退出码和诊断，不用源码字符串代替 versionCode 行为。 |
| Replay 或真实验收路径 | 只有明确发布任务才运行 `npm run release:android`；普通开发验证运行 `node scripts/check-version.mjs`。 |
| 负向验证方式 | 删除上一 tag 比较或把严格模式降为 warning，编号测试必须分别错误成功。 |
| 明确不覆盖范围 | 不创建、移动或推送 tag，也不自动修改版本号。 |

## `REG-OPS-013` release keystore 路径延迟失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-01` |
| 用户症状 | keystore 路径错误时，完整测试和 clean prebuild 后才在 Gradle 报错，且相对路径可能按 `android/app` 而不是仓库根解析。 |
| 触发条件 | Node 发布脚本只检查环境变量和 debug 文件名，不验证文件身份，也不统一路径基准。 |
| 根因 seam | `scripts/release-android.mjs` 的签名环境预检与 Gradle 环境传递。 |
| 必须保持的行为 | release 先完成 Node 22 与 clean checkout 门禁；随后 keystore 相对仓库根解析为绝对路径，必须存在且为普通文件，并在 version/verify/prebuild/Gradle 等昂贵工作前进入局部签名环境；密码和 alias 不得输出。 |
| 精确失败 oracle | `tests/tooling/release-signing.test.ts` 直接验证缺失相对路径按仓库根解析并报告、目录被拒绝；`tests/tooling/release-workflow.test.ts` 固定 Node/clean 之后、version/verify/prebuild 之前执行签名环境预检。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `STATIC_PASS`：纯路径 helper 固定文件身份，workflow guard 固定调用顺序；正式 Gradle 签名仍只在获授权的发布验证中执行。 |
| Replay 或真实验收路径 | 明确发布任务按 operator runbook 提供真实 keystore 后运行完整 release；本回归不读取或复制真实密钥。 |
| 负向验证方式 | 移除文件检查、改回 basename-only，或把签名预检移到 version/verify/prebuild 之后，编号测试或 workflow guard 必须失败。 |
| 明确不覆盖范围 | 不验证 keystore 密码、alias 或证书内容；这些继续由 apksigner 与固定 signer 门禁验证。 |

## `REG-OPS-014` Android Smoke 自相冲突的设备 session

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | Release APK 已完成构建、签名与覆盖安装，首次打开却报 `DEVICE_IN_USE`，完整发布流程无法结算。 |
| 触发条件 | boot 未指定 session 而隐式创建 `default`，后续 open 又显式使用 `wz-apk-sanity` 访问同一设备。 |
| 根因 seam | `scripts/smoke-android.mjs` 把一次 APK sanity 生命周期拆成了两个互斥的 agent-device session。 |
| 必须保持的行为 | boot、首次打开、日志和 appstate 统一使用 `wz-apk-sanity`；设备只在 boot/install 时显式选择；sanity 成功或失败后都先关闭该 session，再启动 Replay。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 记录 boot、sanity 失败和 close 的命令顺序，要求三者使用同一 session，并断言已绑定 session 的首次 open 不再重复传 device selector。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 session 生命周期；完整 `npm run release:android` 的 `APK_SANITY` 与六条 `DEVICE_REPLAY_PASS` 证明真实 CLI/模拟器链路。 |
| Replay 或真实验收路径 | 指定保留数据的 `WZ_ANDROID_SMOKE_DEVICE`，运行正式 release；不得卸载或清 App 数据。 |
| 负向验证方式 | 从 boot 删除显式 session，或在首次 open 恢复新的 session/device 选择，编号测试必须失败。 |
| 明确不覆盖范围 | 不接管其他 agent-device session，也不关闭无法证明由本次 release 创建的共享进程。 |

## `REG-TOPIC-001` 回复已筛选但标题仍显示主题总数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 切换“只看楼主”或“只看带图”、或执行评论内查找后，可见回复已经减少，但“回复列表 N 条”仍显示主题原始总回复数。 |
| 触发条件 | Topic detail 的 `replyCount` 大于筛选后的 `replies.length`，且回复筛选或评论查询处于生效状态。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx` 的回复标题计数直接读取主题总数，没有区分当前可见结果与未筛选总数。 |
| 必须保持的行为 | “只看楼主”“只看带图”和评论内查找显示当前可见回复数；“全部”与仅“倒序”继续显示主题总回复数；可见列表、选中状态和数量必须同步。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 渲染真实 Topic 回复筛选控件：普通用例断言四种筛选、评论查询和列表顺序，4 个带 `REG-TOPIC-001` 的普通测试分别钉住楼主/带图/查询后的标题数量，以及清空原始输入但 debounce 结果尚未更新时的列表与数量一致；`src/features/topic/useTopicSessionController.test.ts` 固定确定性过滤结果。 |
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
| 根因 seam | 旧全局导航入口曾复用 `changeScreen('more')`，导致 `popTo('MainTabs')` 移除 Topic；后续 snapshot 方案仍把 native stack 已拥有的 route state 复制到全局。当前 seam 是 `src/features/topic/TopicRoute.tsx` 与 `src/app/appNavigation.ts`。 |
| 必须保持的行为 | Topic route 直接 push `ReadingSettings`；关闭或离开设置后 native pop 返回同一个 mounted Topic 实例、回复筛选和滚动上下文。普通底部 tab 导航仍保持既有契约。 |
| 精确失败 oracle | `tests/ui/app/app-navigator.test.tsx` 固定进入 ReadingSettings 并返回后仍为同一个 Topic 组件，草稿、筛选、滚动和已提交 UI 均未丢失。 |
| 最低可靠自动测试层 | `UI_PASS` 证明用户经过可见入口返回后 Topic 组件及内部状态仍保留。 |
| Replay 或真实验收路径 | Feed → Topic → 更多操作 → 阅读设置 → 系统或顶栏返回；核对外观控件可见，并且返回后仍是原 Topic、原筛选和原阅读位置。 |
| 负向验证方式 | 临时恢复 `changeScreen('more')`、用 replace/popTo 打开设置或给 ReadingSettings 返回增加 snapshot restore 时，UI 用例必须失败。 |
| 明确不覆盖范围 | 外观各设置的切换、持久化与恢复由 `MORE-03` 验收；一般 tab 切换、Topic → User 嵌套返回仍由其他 NAV 测试负责。 |

## `REG-TOPIC-003` 评论引用改动误伤正文引用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 用户症状 | 调整评论引用卡片后，主题正文里的引用也跟着改变；默认简介和展开后的完整帖子混在一起，或展开后仍只看到简介。评论最外层还可能被误改成逐条卡片。 |
| 触发条件 | 正文引用与评论引用强行共用展示组件、只按楼层缓存被引内容，或修改共享 HTML/样式后只回归当前评论入口。不同主题存在相同楼层号时更容易串入错误帖子。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx`、`src/features/topic/components/TopicBodyQuoteCard.tsx` 与 `src/features/topic/components/ReplyItem.tsx` 的两套展示入口；`src/domain/forum/quotedPosts.ts`、`src/features/topic/useTopicController.ts`、`src/features/topic/useTopicSessionController.ts` 的引用标识、加载和 session 缓存；`src/sources/linuxdo/reader.ts` 的简介/完整帖数据边界；`src/features/topic/styles.ts` 与 `TopicContentBlock` 的四站回复间距。 |
| 必须保持的行为 | 正文引用和评论引用分别实现并分别验收：默认只展示原站简介，展开后追加真实完整帖子；已加载的同主题楼层可直接复用，未加载或跨主题 linux.do 引用按来源、主题 id、帖子号读取；缓存不能只按楼层。评论仍是透明平铺列表，仅引用区域是卡片；正文、签名/留言、reaction/统计/感谢、操作栏和分隔线的间距不能叠加失衡。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 分别断言正文跨主题引用和评论同主题引用的简介/完整帖边界；`src/domain/forum/quotedPosts.test.ts` 固定跨主题同楼层缓存隔离；`tests/ui/topic/topic-components.test.tsx` 独立断言 `TopicBodyQuoteCard` 与 `ReplyItem` 默认只见简介、展开后才见匹配的完整帖且错误主题内容不可见；`tests/integration/style-ownership.test.ts` 固定评论外层无卡片圆角、保留分隔线，并固定签名、统计和操作栏的间距契约。 |
| 最低可靠自动测试层 | 数据边界和缓存键使用 `UNIT_PASS`；正文引用与评论引用的独立可见行为至少使用 `UI_PASS`。四站实际 HTML、字体和末尾内容造成的视觉间距仍需要 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 用用户给定的原站主题链接按内部直达方式打开 App 详情；对同时含正文引用和评论引用的 linux.do 主题分别检查默认简介、展开完整帖、收起与返回状态。再按 `docs/testing-standard.md` 的四站评论末尾分支矩阵检查普通文本、表情/图片、留言/签名、reaction/统计/感谢、操作栏和分隔线。全程只读。 |
| 负向验证方式 | 向缓存放入另一个主题的同楼层帖子时，评论 UI 必须仍显示当前主题的完整帖；删除正文或评论任一独立 UI 用例、改回楼层号缓存、让评论外层获得卡片圆角，均必须使对应测试失败。 |
| 明确不覆盖范围 | 不固定原站当天主题内容，不绕过 Cloudflare，不证明写入互动；没有合适动态目标时记 `NOT_VERIFIED`，不能用搜索结果或普通无引用主题代替。 |

## `REG-TOPIC-004` 主题图片尺寸探测与显示各加载一次

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-03`、`NAV-03` |
| 用户症状 | 完整刷新含块级正文图片的主题时，图片先在约 100×100 的小框里转圈，容器放大后又转一次圈，最后才显示图片；同一图片重进也会发生明显尺寸跳变。 |
| 触发条件 | 正文 `<img>` 没有可直接使用的完整宽高，HTML renderer 先请求图片尺寸，尺寸就绪后最终图片组件再按 URL 发起自己的加载与解码；或块图携带缩略展示用 `width/height`，renderer 把它误当成真实尺寸上限。 |
| 根因 seam | `src/features/topic/rendering/contentMediaRenderers.tsx` 的旧实现曾同时使用 `react-native-render-html` 的 `useIMGElementState`（内部 `Image.getSize`）和按 URL 加载的 `ExpoImage`，把同一图片拆成“尺寸探测”和“最终显示”两个生命周期；RNRH 未知尺寸默认 100×100，因而产生小框、放大和第二个 Spinner。 |
| 必须保持的行为 | 块级正文图片只挂载一个直接接收适屏 URL 的 `ExpoImage` native view，保留既有媒体来源、会话身份、Referer 与 User-Agent。首次未知尺寸使用全正文宽度 4:3 灰底和一个连续 Spinner；同一次 native 请求的 `onLoad` 提供真实宽高并完成最终布局，Spinner 遮罩必须等 `onLoad` 与 `onDisplay` 都到达后才撤下，两者在 Android 上无论谁先到都不能先露出错误比例再跳大。块图在 inline 分类完成后不得让 HTML 缩略 `width/height` 覆盖这次请求返回的真实比例。当前进程按 session-scoped 规范化 URL 复用真实宽高，尺寸缓存不持久化也不包含 Cookie。URL、内容来源或 session epoch 变化时旧事件、失败状态与尺寸不能进入新页面；错误态停止 Spinner 并显示 alt/失败文案。inline 图片、emoji、sticker、图片预览、页面级读取状态、文本与投票正文树保持原行为。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 固定冷首帧 4:3 和唯一 Spinner、带小 `width/height` 的块图在 `onLoad` 后改用真实比例但仍保留 Spinner、常规 `onLoad → onDisplay` 和 Android `onDisplay → onLoad` 两种顺序都只在真实比例就绪后撤下遮罩、同 URL 同会话重进首帧复用真实比例、session epoch 变化期间不显示旧图、超时终态后的迟到 `onLoad` 不改变错误框或污染尺寸、卸载后旧 callback/artifact 不更新页面或新建终态诊断、错误态停止加载，以及 inline emoji 不进入块图 loader。 |
| 最低可靠自动测试层 | `UI_PASS`：只有渲染测试能同时证明占位几何、Spinner 数量、最终 source 身份、错误文案和 inline 分支隔离；`npm run typecheck` 固定 Expo/RNRH 图片源类型边界。动态缓存命中和真实帧序列再由只读 `LIVE_PASS` 核对。 |
| Replay 或真实验收路径 | 在当前妖火含图主题用右上菜单“完整刷新”分别观察冷、热路径：冷路径只能看到一个全宽 4:3 占位和一个连续 Spinner，热路径保持最终几何尺寸，不再出现“小圈 → 大圈 → 图片”。再直达 `https://www.nodeseek.com/post-819647-1` 核对投票位置、分隔线和后文/sticker；四站各打开一个含图主题和普通文本主题，并检查图片预览与返回。全程只读，不清 App 数据、Cookie 或图片缓存。 |
| 负向验证方式 | 恢复额外的 `Image.getSize`/`useImage` 尺寸请求、在 `onLoad` 前撤掉遮罩或等到 `onDisplay` 后才调整真实尺寸时，单次请求和“小图不露出”断言必须失败；删除进程内尺寸缓存时，同 URL 同会话重进首帧比例断言必须失败；让 inline 分支经过块图 loader 时隔离断言必须失败。 |
| 明确不覆盖范围 | 不改变页面级“正在读取主题”、inline 图片和 sticker 自身加载策略，不持久化图片尺寸，不制造最短 Loading 时长，不执行保存图片、投票或其他写操作。 |

## `REG-TOPIC-005` V2EX 评论刷新失败却记录成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04`、`MORE-02` |
| 用户症状 | V2EX 详情中执行“仅刷新评论”遇到网络失败时，页面提示失败，但同一次评论刷新诊断仍以 `success` 结束，导出的诊断会误导排障。 |
| 触发条件 | V2EX 评论刷新委托给整篇 Topic Query refetch；被委托请求失败后仍被转换成 `completed`，没有成功应用新详情。 |
| 根因 seam | `src/features/topic/useTopicController.ts` 的 V2EX `refreshTopicReplies` 委托分支只判断 Promise 已结束，没有核对 Topic Query 是否成功写入了新数据。 |
| 必须保持的行为 | 只有 Topic Query refetch 返回新详情才记录成功；`result.error`、stale 或 blocked 分别保留真实终态，同时保持 Query cache 中的可信旧详情可见。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-TOPIC-005` 让 V2EX `getTopic` 在 refetch 时抛错，要求旧详情保持可见且 `reply/refresh` trace 的唯一终态为 `failure`。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 `QueryClientProvider`、controller 与诊断 writer 共同固定委托、错误结果和可信 cache；只看错误 Toast 或 Topic 子 trace 会漏掉错误的父终态。 |
| Replay 或真实验收路径 | 不主动制造真实来源故障；正常 V2EX 详情“仅刷新评论”仍做只读成功路径，确定性失败由自动测试固定。 |
| 负向验证方式 | 忽略 Query refetch 的 `result.error` 并无条件 finish success，编号测试必须失败。 |
| 明确不覆盖范围 | 不改变 V2EX 回复获取协议、重试策略或页面错误文案，也不把普通网络失败自动重试。 |

## `REG-TOPIC-006` 图片保存快速双击写入重复文件

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片预览中快速点击两次“保存图片”，App 并行下载并向系统媒体库写入两份相同图片，随后还弹出两次成功提示。 |
| 触发条件 | 第一次保存仍在权限检查、代理等待、下载或媒体库写入期间再次点击保存。 |
| 根因 seam | `src/features/topic/media/useImagePreviewController.ts` 的保存动作没有同步 busy gate，Modal 按钮的每次点击都会创建独立异步任务。 |
| 必须保持的行为 | 同一时刻只允许一个图片保存任务；忙碌期间的重复点击不发起下载、不写媒体库也不重复提示。当前任务成功或失败后必须释放门禁，随后可再次保存。 |
| 精确失败 oracle | `tests/ui/topic/image-preview-controller.test.tsx` 的 `REG-TOPIC-006` 用 pending 保存 Promise 模拟快速双击，要求 `saveImageUriToLibrary` 与“图片已保存”提示都严格一次；修复前调用数为两次。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 hook 渲染测试固定 preview state、同步点击与异步完成的组合；单测 `imageSave` 不能证明 controller 没有重复调用。 |
| Replay 或真实验收路径 | 默认只检查图片预览与保存入口，不写系统媒体库；真实保存及重复点击只在用户明确授权后验收。 |
| 负向验证方式 | 删除 `saveBusyRef` 的进入检查或在 await 之后才置 busy，编号测试会观察到两次媒体库调用。 |
| 明确不覆盖范围 | 不改变图片格式、命名、相册位置、代理协议或权限申请语义，也不授权测试真实保存。 |

## `REG-TOPIC-007` 同一引用被多个实例加载时重复请求或串错状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | 同一正文或评论引用出现在多个位置并同时展开时，会重复读取同一楼层，或让一个实例的 Loading、内容和错误串到另一个 reference。离开原 Topic 后，旧引用与 linux.do 验证恢复还可能继续结算。 |
| 触发条件 | 引用展开状态按 UI instance 管理，但远端楼层内容也由各 instance 手写持有，没有用 source、topic、post number 与 session epoch 组成统一 Query key。 |
| 根因 seam | `src/features/topic/useTopicController.ts` 的引用 instance 状态与 TanStack Query 远端状态边界，以及 `src/platform/query/serverState.ts` 的结构化 reply key。 |
| 必须保持的行为 | 展开/收起只属于 Topic session 的 instance 状态；同一 reference key 的所有观察者共享一个 Query transport、缓存、Loading 和错误，不同 reference 可独立并发。linux.do 恢复只 refetch 完全匹配的结构化 key；离开 Topic 精确取消当前详情、回复和引用 Query，不影响其他 Topic。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-TOPIC-007` 用 pending Promise 同时展开同一 reference，要求 `getReply × 1` 且两个观察者读取同一 Query 结果；同文件的离开 route 用例要求详情、回复和引用 signal 全部 abort，另一个 Topic 的 Query 保持在飞。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经过真实 `QueryClientProvider`、并发观察者和 route 取消；只测 key builder 或最终引用文本无法证明 transport 去重与取消边界。 |
| Replay 或真实验收路径 | 只读打开含正文引用和评论引用的 linux.do Topic，分别展开、收起、再次展开并核对完整被引帖；不主动制造 Cloudflare 或依赖网络时序复现确定性竞态。 |
| 负向验证方式 | 把引用内容重新复制进 Topic session、给每个 instance 创建独立 request key，或在第二个观察者挂载前主动取消同 key Query；编号测试必须观察到两个 transport、串错状态或错误取消其他 Topic。 |
| 明确不覆盖范围 | 不改变引用内容解析或 Cloudflare 验证协议；不通过额外 request owner、generation、延迟或隐藏 Loading 掩盖竞态。 |

## `REG-WRITE-001` 首次投票后参与人数未更新

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在 linux.do 首次提交投票成功后，所选项和票数已经更新，但当前页面的参与人数仍保持提交前的数值。 |
| 触发条件 | 投票带有数值型 `participantCount`、当前尚未投票，并且成功响应进入统一的本地 `poll-vote` 补丁。 |
| 根因 seam | `src/domain/forum/topicActionState.ts` 的 `applyPollVoteToPolls` 只更新 `voted`、选中项和选项票数，没有同步参与人数。 |
| 必须保持的行为 | 首次成功投票使参与人数只增加 1；多选投票也只增加 1；每个新选中的选项票数增加 1；同一成功补丁即使被重复应用也不得重复计数。 |
| 精确失败 oracle | `src/domain/forum/topicActionState.test.ts` 的两个 `REG-WRITE-001` 用例分别固定单选与多选：单选从参与人数 4、选项票数 2 开始，首次应用后为 5 和 3；多选从参与人数 8 开始，两个所选项各加 1 但参与人数仅到 9；重复应用均不得再次增长。 |
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
| 根因 seam | `src/sources/yaohuo/actionClient.ts` 的请求 helper 只返回 HTML、丢弃最终 `Response.url`；通用解析器正确地拒绝从长页面文本猜测成功，却也无法知道该请求已经同源跳到收藏夹。旧开源代码中的二次表单流程与当前线上行为不一致。 |
| 必须保持的行为 | 收藏只发送一次既有 GET，不增加二次 POST；业务操作继续读取登录检测时全局保存的 Cookie，不在每次收藏时重读 WebView；只有当前收藏请求最终跳到妖火同源 `/bbs/favlist.aspx` 时补充“收藏成功”，登录、验证、HTTP 失败、明确失败提示和其他长页面继续阻断或保持不确定。 |
| 精确失败 oracle | `src/sources/yaohuo/actionClient.test.ts` 的 `REG-WRITE-002` 用例固定完整请求参数、恰好一次 GET、无 body、最终 URL 为同源收藏夹和结果文案“收藏成功”；修复前同一响应精确得到“操作结果无法确认，请刷新原帖核对”。 |
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
| 根因 seam | `src/sources/yaohuo/actionClient.ts` 只返回成功文案并丢弃收藏记录 id；`src/features/topic/actions/useTopicActionsController.ts` 始终构造添加请求且不应用状态；`src/sources/yaohuo/reader.ts` 未读取原站收藏状态，并曾把可选收藏查询放进主题加载的必需 `Promise.all`；旧全局 Topic runtime / 详情列表曾把 `undefined` 强制转换成 `false`，无法区分“未收藏”和“状态未知”。 |
| 必须保持的行为 | 主题加载使用已全局保存的登录态，对收藏列表做一次按标题过滤的只读查询，并按帖子 id 精确取得收藏记录 id；收藏查询失败时仍返回已成功取得的主题正文和回复，把 `bookmarked` 保持为 `undefined`，并把本次详情读取诊断标记为降级，使 Query trace 的成功终态提升为 `partial`；未知状态显示“状态未知”、按钮禁用且不得发起写请求。收藏仍只发送一次既有 GET，从同一次收藏夹响应取得记录 id，不增加第二次写请求；服务端确认后立即显示黄色“取消原站收藏”；取消只发送一次 `/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=<收藏记录id>` POST，并仅在 JSON `success: true` 后清除样式；不得在每次操作时重读 WebView Cookie。 |
| 精确失败 oracle | `src/sources/yaohuo/reader.test.ts` 固定按标题查询但按帖子 id 匹配记录，并固定收藏查询抛错时主题正文和回复仍可读、收藏字段缺省且 source summary 的 `partialErrorCount` 为 1、`hasDegradation` 为真；`src/sources/readGatewayContract.test.ts` 固定该降级进入 Topic Query trace 后只有一个 `partial` 终态且诊断不含主题、正文、URL 或 Cookie；`src/sources/yaohuo/actionClient.test.ts` 固定收藏响应返回记录 id、取消 POST 和失败 JSON 不误报；`tests/ui/topic/topic-actions-controller.test.tsx` 固定添加/取消后的 `bookmark` 补丁；`tests/ui/topic/topic-reply-filters.test.tsx` 固定已收藏时按钮为选中、`favorite` 色调并显示“取消原站收藏”，状态未知时显示对应文案、禁用且不调用操作回调。 |
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
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 把所有 pending mutation 都计入全局 `actionBusy`，没有沿用 `MutationVariables.busy`；收藏请求因此无法选择非全局忙碌路径。 |
| 必须保持的行为 | 妖火收藏和取消请求使用 `busy: false`，服务端确认后只通过既有 `bookmark` 补丁更新收藏按钮；不得刷新主题、切换全局 `actionBusy` 或改变滚动位置；其他需要全局门禁的妖火写操作继续保持默认 busy。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-004` 在收藏 transport pending 期间断言精确 `bookmark` optimistic patch 已应用，同时从 MutationCache 派生的 `actionBusy` 始终为 `false`，确认后只补入服务端 bookmark id。 |
| 最低可靠自动测试层 | `UI_PASS` 固定真实 MutationCache 与控制器状态边界；`LIVE_PASS` 再确认真实请求期间页面不整体变灰、内容和滚动位置不跳动，只有收藏按钮改变。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 记录初始状态后收藏或取消一次，观察请求期间页面其余内容和操作按钮，确认结果后核对收藏按钮及原站状态，最后恢复初始状态。 |
| 负向验证方式 | 移除收藏 mutation 的 `busy: false`，pending 期间测试必须精确观察到 `actionBusy=true`；收藏协议或结果不确认时仍不得误切按钮状态。 |
| 明确不覆盖范围 | Android 原生 ripple、网络耗时和成功提示自身的动画不属于整页 busy 闪动；服务端确认后正文被重新提交造成的独立闪烁由 `REG-WRITE-005` 覆盖。 |

## `REG-WRITE-005` 妖火收藏确认后正文被重新提交并闪烁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 点击妖火“原站收藏”或“取消原站收藏”后，最终滚动位置看似不变，但正文会在约 170 ms 内闪一下；含图正文会短暂退回灰色 loading 占位，单张操作前后截图容易漏掉。 |
| 触发条件 | 妖火服务端确认后，本地用新 `TopicDetail` 对象应用只包含 `bookmarked`/`bookmarkId` 的补丁。布局使用的主题对象已经稳定，但 HTML 渲染输入或 Topic screen action callback 仍跟随原始对象换引用。 |
| 根因 seam | `src/features/topic/rendering/useHtmlRenderingController.tsx` 的链接处理曾直接依赖原始 `topicDetail`，导致 HTML renderer registry 重建；同时旧全局 Topic runtime 传入 route 的多个 action callback 闭包随原始详情换引用，嵌在 route renderer 内的收藏 Context 又使整棵 Topic screen 被重新提交。为稳定这些引用而在 render 阶段写 ref 又会让被 React 丢弃的 render 泄漏未提交状态。FlashList/HTML 图片因此可能重新进入加载态或采用错误引用。 |
| 必须保持的行为 | 收藏确认只更新收藏按钮及成功提示；布局主题、筛选回复、HTML renderer 与 renderer props 在只改收藏字段时保持引用稳定；Topic screen 使用稳定 handler 转发到最新已提交实现，相关 ref 只在 layout effect 提交后更新，render 保持纯净；收藏 Context 位于 route renderer 外侧。正文、图片、回复列表和滚动位置都不得重新提交或重载。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 的 `REG-WRITE-005` 对收藏与取消两个方向连续换入只含收藏字段差异的详情，断言 `htmlRenderers` 和 `htmlRenderersProps` 始终保持同一引用；`npm run check:react` 要求本次相关变更不存在 `no-ref-current-in-render` 或 `no-prop-callback-in-render`。真实可见 oracle 使用 30 fps 录屏逐帧检查：修复前收藏/取消确认曾分别出现约 50.0%/55.5% 正文像素变化和灰色图片占位，修复后同路径正文变化最高约 0.315%，只剩按钮与 Toast 局部动画。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 React render purity，`UI_PASS` 固定 bookmark-only 更新不会重建 HTML 渲染输入；React Native 原生图片和 FlashList 的瞬时重新提交仍必须用 `LIVE_PASS` 的 30 fps 录屏确认，最终截图不能替代。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 在收藏按钮、正文图片和回复区同时可见的位置开始 30 fps 录屏，静置后只点击一次，持续到服务端确认后至少 1 秒；逐帧检查正文不得出现其他楼层、灰色占位或大面积明暗跳变。收藏和取消两个方向都验收，最后恢复初始状态。 |
| 负向验证方式 | 临时恢复 HTML controller 对原始详情的依赖时，`REG-WRITE-005` UI 用例必须因 renderer 引用变化失败；把 committed ref 更新移回 render 阶段时 React Doctor 必须失败；临时改回随详情变化的 Topic handler/route 内收藏 Provider 时，30 fps 设备 oracle 必须重新捕获正文或图片的大面积重绘。 |
| 明确不覆盖范围 | 收藏按钮 ripple、黄色选中样式和成功 Toast 的局部动画允许变化；首次进入主题时的正常图片加载、网络耗时、图片源自身更新和其他站点的互动状态由各自能力验收。 |

## `REG-WRITE-006` 阅读设置返回覆盖已确认的原站收藏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03`、`TOPIC-04`、`NAV-03` |
| 用户症状 | 妖火原站已经确认收藏或取消，但用户在请求期间打开阅读设置，返回后按钮恢复成请求前状态，App 与服务器不一致。 |
| 触发条件 | 非全局 busy 的收藏请求在 ReadingSettings 覆盖 Topic 期间完成；旧实现返回时用入口时刻的 snapshot 覆盖最新 `bookmarked`/`bookmarkId`。 |
| 根因 seam | 复制 route state 产生了第二个所有权；action 更新当前 Query/route 后，snapshot restore 又写回旧值。 |
| 必须保持的行为 | ReadingSettings 保留 mounted Topic route；action 确认后补丁精确 Topic Query cache 与当前 route state，返回时不执行恢复写入，因此已确认的收藏、互动、投票和回复删除结果与筛选、草稿、滚动上下文同时保留。 |
| 精确失败 oracle | `tests/ui/app/app-navigator.test.tsx` 固定 ReadingSettings 返回同一 route 实例和覆盖期间已提交 UI；`tests/ui/topic/topic-actions-controller.test.tsx` 固定 action 只补丁精确 Query cache。 |
| 最低可靠自动测试层 | `UI_PASS` 通过真实 native route 与 Query/action 生命周期固定竞态；真实原站最终一致性仍需获授权的 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 确定性测试模拟请求完成；真实验收仅在逐次授权后执行妖火收藏 → 立即打开阅读设置 → 等待确认 → 返回，并与原站收藏夹核对后恢复初始状态。 |
| 负向验证方式 | 让 ReadingSettings replace/unmount Topic、恢复旧 snapshot 层，或停止补丁精确 Query cache，编号测试必须丢失覆盖期间的已确认状态。 |
| 明确不覆盖范围 | 不替代服务端并发变更、失败响应和访问验证处理；只有已由 action client 确认的结果进入 cache。 |

## `REG-WRITE-007` NodeSeek 投票读取失败且提交后伪造票数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 用户症状 | NodeSeek 主题正文保留 `nsapp://vote` 原始标记而没有可用投票卡片；多个投票标记中一个读取失败时详情仍被误报为完整成功。提交成功后 App 又只做本地 `+1`，把原站未返回的未知票数显示成 `1`，与刷新后的服务端结果不一致。 |
| 触发条件 | `/api/vote/info/{id}` 缺少原站动态签名而返回 403；读取链路把投票 header 扩散到普通 JSON API，或成功/失败标记没有分别清理；写链路只根据 POST 返回做本地增量，没有调用原站提交后的结果 GET。 |
| 根因 seam | `src/sources/nodeseek/polls.ts` 的 NodeSeek 投票协议、`src/sources/nodeseek/topicParser.ts` 的标记解析、`src/sources/nodeseek/reader.ts` 的投票读取/清理和 partial 诊断、`src/sources/nodeseek/actionRequest.ts` 与 `src/sources/nodeseek/actionClient.ts` 的投票专用请求、`src/features/topic/actions/useTopicActionsController.ts` 的写后同步，以及 `src/domain/forum/topicActionState.ts` 的服务端快照/未知计数合并。 |
| 必须保持的行为 | 只有 NodeSeek 投票 GET/POST 携带 JSON `Accept` 和已验证 fallback `x-dynamic-sign`，继续复用现有 Cookie、User-Agent、Referer、超时与代理通道；未投票时不提前展示结果票数，已投票、多选和锁定状态按 API 归一化；只删除成功加载投票对应的原始标记，失败标记保留且详情诊断为 `partial`。POST 成功后固定只读 GET 一次并合并完整服务端快照到精确 Topic Query cache 与活动 route，不刷新整篇正文；GET 失败仍保留已投和所选项、未知票数保持未知、提示刷新失败并记 `partial`，绝不重发 POST。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 模拟缺少签名即 403，固定未投/已投、多选/锁定、多个标记部分失败、成功标记删除与失败标记保留；`src/sources/nodeseek/actionRequest.test.ts`、`src/sources/nodeseek/actionClient.test.ts` 固定投票专用 header 和权威结果 GET；`tests/ui/topic/topic-actions-controller.test.tsx` 固定 `POST × 1 → GET × 1`、服务端快照与 GET 失败的单次 POST；`src/domain/forum/topicActionState.test.ts` 固定已知票数正常合并、未知票数不伪造成 `1`。 |
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
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的站点分流与 non-idempotent mutation task；确认边界属于 NodeSeek，不属于公共 `TopicPolls` 或其他站点协议。 |
| 必须保持的行为 | NodeSeek 点击提交先显示“提交后不可修改”确认；取消时不创建写请求、不改变已选择的本地选项；确认按钮只进入一次现有 non-idempotent 提交流程。LinuxDo、妖火继续当前提交行为，V2EX 保持只读。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-008` 分别断言取消为零请求/零状态补丁、重复触发确认仍只有一次 NodeSeek POST，以及 LinuxDo/妖火不新增该确认；`src/sources/nodeseek/actionRequest.test.ts` 固定确认后才会使用的请求结构。 |
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
| 根因 seam | `src/sources/nodeseek/polls.ts` 的成功标记替换和正文分片、`src/sources/nodeseek/topicParser.ts` 的渲染表单占位，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的逐来源正文渲染边界。 |
| 必须保持的行为 | 成功解析的 NodeSeek 投票用站点专属占位保留原正文位置，UI 按“前文 → 投票 → 后文”只渲染一次；同一 id 的重复标记及其纯 `">` 前缀块必须清理，失败标记继续原样保留并记 `partial`。LinuxDo、妖火、V2EX 和公共 `TopicPolls` 行为不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 固定 API 标记、渲染表单以及“相邻 `">` 块 + 重复标记”的真实形态只产出一个 NodeSeek 占位；`tests/ui/topic/topic-reply-filters.test.tsx` 固定重复占位输入下投票节点仍位于前后正文之间且只出现一次。 |
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
| 根因 seam | `src/sources/nodeseek/topicParser.ts` 的原站渲染 HTML 提取/投票表单替换、`src/sources/nodeseek/polls.ts` 的残留 marker 清理，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的正文树与自定义投票 renderer 边界。 |
| 必须保持的行为 | 首轮 parser 只识别投票表单并取得其原始源码 range，不从已被自动修正结构的 AST 读取正文 `innerHTML`；在序列化前按原始 range 把成功解析的投票面板原位替换为一个 opaque block 占位。整篇 NodeSeek 正文只进入一个 HTML 渲染树，投票 renderer 在树内就地渲染。只清理与成功占位相邻且内容严格为可选引号加 `>` 的泄漏前缀，合法正文 `1 > 0` 必须保留；投票后的文字、图片和 sticker 继续走既有公共排版规则。其他来源、回复、详情返回和公共 `TopicPolls` 行为不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-WRITE-010` fixture 保留目标帖的“同一 `<p>` 内前文 + `">` + 块级投票 + 后文 + sticker”形态，要求无泄漏前缀、合法 `1 > 0` 仍在、前文/唯一占位/后文顺序不变且段落不被拆散；`tests/ui/topic/topic-reply-filters.test.tsx` 要求该输入只有一个正文渲染根，投票只出现一次并位于前后文之间。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定原始 HTML range 替换和负向文本边界；`UI_PASS` 固定单一正文树及用户可见顺序；Android 的分隔线和文字/sticker 几何关系由只读 `LIVE_PASS` 核对。 |
| Replay 或真实验收路径 | 直达 `https://www.nodeseek.com/post-819647-1`，再从主题菜单“原站打开”对照；只读确认无字面量 `">`、投票前后没有新增正文分隔线、卡片仍在原位、后文与 sticker 不重叠且正文底部无副本。另直达一个“投票独占段落”和一个“投票前有正文”的 NodeSeek 样本作负向对照，不选择选项或提交。 |
| 负向验证方式 | 恢复“先 parse/mutate 再取 innerHTML”时 Vitest 会收到提前闭合的段落和泄漏前缀；恢复按占位符切分正文时 RNTL 会收到多个正文根。把清理规则放宽到任意含 `>` 文本时，合法 `1 > 0` 断言必须失败。 |
| 明确不覆盖范围 | 不修正 NodeSeek 原站的无效 HTML，不改变 sticker 尺寸/公共图片流算法，不增加投票卡片自身分隔线或新样式，不执行任何真实投票。 |

## `REG-ACCOUNT-010` NodeImage 旧授权与上传覆盖已清除凭据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 用户症状 | 用户取消授权或清除 NodeImage API Key 后，较早的保存、读取或上传仍可能迟到，重新写回旧 Key 或把旧上传结果插入当前草稿。 |
| 触发条件 | SecureStore 操作或上传处于 pending，期间发生新授权、取消、身份/epoch 变化或清除；WebView bridge 还可能在错误授权阶段、iframe 或另一 host 接收消息。 |
| 根因 seam | `src/sources/nodeimage/authFlow.ts` 的 phase/nonce、`src/features/account/useNodeImageAuthController.ts` 的 NodeSeek preflight/final reconcile、`src/platform/network/loginWebViewScripts.ts` 的注入边界、`src/sources/nodeimage/credentials.ts` 的 owner/generation，以及 `src/features/topic/actions/useTopicActionsController.ts` 的上传结果所有权。 |
| 必须保持的行为 | 打开授权前优先以 Web Crypto 生成 128-bit flow nonce；当前 Hermes 没有该 API 时只允许复用现有 Android `SecureRandom` port，两个安全来源都不可用或输出无效即失败关闭，绝不降级 `Math.random`。异步 nonce 初始化必须 single-flight，并发入口共享同一终态；等待 nonce 期间切换 auth surface或关闭流程必须同步取消 pending opening，迟到 continuation 保持零 WebView/transport。完成后才能启动下一次。先做 NodeSeek canonical Account preflight并捕获 `{identityKey, sessionEpoch}`；`nodeimage-session`、`nodeseek-cauth`、`nodeimage-verify` 分别使用独立 WebView mount、精确顶层 URL 和声明式脚本，所有结果必须回显 nonce，当前 phase 之外的重复、iframe 和迟到消息不结算。最终 reconcile 仍为同一 owner、epoch 未变且 credential generation 当前时才保存；SecureStore 写入前后再次核对，写入期间换代必须恢复此前凭据。changed、anonymous、unknown、stale 或迟到 generation 均零写入。手工 Key 在保存时绑定当前已确认身份；上传 generation 变化不得插入 Markdown。 |
| 精确失败 oracle | `src/sources/nodeimage/authFlow.test.ts` 固定 Web Crypto 16 bytes、Hermes 缺失时只接受现有 Native `SecureRandom`、全部安全来源失败时 fail-closed、绝不调用 `Math.random`、异步初始化 single-flight，并固定 opening/close orchestration 的 deferred nonce 关闭后零 open、精确 phase URL 和单向 phase transition；`tests/ui/account/nodeimage-auth-controller.test.tsx` 固定 controller 只有 key/panel 两组接口，并从 preflight 打开到 close reconcile 完整结算；`src/domain/session/authSurfaceCoordinator.test.ts` 固定切换 surface 必定调用 NodeImage close handler；`src/platform/network/loginWebViewScripts.nodeimage.test.ts`、`src/platform/network/loginWebViewScripts.test.ts` 固定 nonce、顶层文档和局部 payload；`src/sources/nodeimage/credentials.test.ts` 固定 owner mismatch 零写入、旧保存/读取/取消竞态，以及 SecureStore 写入期间 epoch 变化后恢复此前凭据；`tests/ui/account/account-host.test.tsx` 固定每阶段声明式脚本、WebView remount 和透明触摸拦截；`tests/ui/topic/topic-actions-controller.test.tsx` 固定清除 Key 后迟到上传不落地。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须控制异步完成顺序并观察 SecureStore、草稿和 bridge 决策。 |
| Replay 或真实验收路径 | 保留现有 NodeImage session 时可只读验收 session 复用、自动保存/关闭和零 Connect；真实失效 Connect 与上传只在逐次授权且配额可用时验收。 |
| 负向验证方式 | 降级 `Math.random`、移除 Native 安全随机 fallback、nonce、精确顶层 URL、WebView remount、preflight owner/epoch、持久化前后校验、final reconcile 或 generation 任一门禁，或恢复 `onLoadEnd → injectJavaScript`，编号测试必须观察到授权无法安全启动、旧 Key/旧上传落地、脚本未执行或跨阶段消息被接受。 |
| 明确不覆盖范围 | 不清除真实 NodeImage 文件，不代表真实上传、删除或授权已获许可。 |

## `REG-ACCOUNT-011` 隐藏 WebView 接受伪造来源的读取结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04` |
| 用户症状 | 恶意或被跳转的页面可以发送一个声称来自 NodeSeek 或 linux.do URL 的完成消息，使 App 接受非目标页面的 HTML、Cookie 或状态。 |
| 触发条件 | WebView 当前 document 的 URL 与 bridge payload 内的 URL 不同，但 controller 只校验 payload。 |
| 根因 seam | `src/features/account/useHiddenBrowserFetchController.ts` 对原生 message event URL 与 payload URL 的双重来源校验。 |
| 必须保持的行为 | 只有 event document 与 payload 都是同一受信 HTTPS origin，且属于当前请求 owner，才允许完成隐藏读取。 |
| 精确失败 oracle | `tests/ui/account/hidden-browser-fetch-controller.test.tsx` 对 linux.do 和 NodeSeek 注入跨 origin document、可信 payload，均必须拒绝且不调用完成回调。 |
| 最低可靠自动测试层 | `UI_PASS`：需要经过 hook 的真实 message 生命周期和当前请求状态。 |
| Replay 或真实验收路径 | 正常 App 内隐藏读取继续只读验收；不导航到恶意站点制造现场。 |
| 负向验证方式 | 只保留 payload URL 校验时，两个编号用例都会接受伪造消息。 |
| 明确不覆盖范围 | 不证明目标站页面本身无 XSS，也不允许 HTTP、子域或相似域名。 |

## `REG-ACCOUNT-012` document.cookie 覆盖并丢失完整会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 隐藏 WebView 只回传 JavaScript 可见 Cookie 时，App 用它替换完整已存候选，导致 HttpOnly Cookie 摘要丢失并让后续身份判断基于不完整候选。 |
| 触发条件 | 当前 SecureStore 有完整 Cookie header，隐藏读取只包含 `document.cookie`，随后执行保存或清除。 |
| 根因 seam | `src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的候选 Cookie 合并，以及把身份候选误当成 transport Cookie 的旧边界。 |
| 必须保持的行为 | document Cookie 只按名称合并进当前完整候选，未回传的 HttpOnly Cookie 摘要保留；该候选只服务于 verifier/generation 等 App 协议状态，不得进入 RN、图片或视频请求 header。实际 transport 始终由原生只读 CookieJar 按准确 URL 读取。 |
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定 NodeSeek/linux.do 的 HttpOnly 候选合并；`REG-ACCOUNT-029` 的 source/action/media 测试固定 App 候选不再承担 Cookie 传输。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须同时比较候选合并结果与 transport 不携带快照的行为。 |
| Replay 或真实验收路径 | App 内登录态只读加载详情与图片；不得为复现而清 Cookie。 |
| 负向验证方式 | 恢复直接覆盖，或把合并候选重新传入任一 transport，编号测试会丢失 HttpOnly 摘要或观察到手工 Cookie header。 |
| 明确不覆盖范围 | 不从 JavaScript 推断不可见 Cookie 的新值，也不迁移其他站点 Cookie 格式。 |

## `REG-ACCOUNT-013` NodeSeek 缺失 Cookie 未归类为会话失效

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 已进入 NodeSeek 写操作但本机 Cookie 缺失时，只收到泛化“缺少凭据”错误，UI 无法进入明确的重新登录流程。 |
| 触发条件 | action client 被调用时 credential loader 返回空值。 |
| 根因 seam | `src/sources/nodeseek/actionClient.ts` 在发请求前对空凭据的 typed source/login-required 分类。 |
| 必须保持的行为 | 空 Cookie 必须在零网络请求下抛出 NodeSeek 会话失效错误，并携带可供 controller 打开登录入口的分类。 |
| 精确失败 oracle | `src/sources/nodeseek/actionClient.test.ts` 要求 fetch 为零次，错误包含 `source=nodeseek` 与登录失效语义。 |
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
| 根因 seam | `src/platform/storage/legacyCookieSnapshotMigration.ts` 与 `src/platform/network/managedCookies.ts` 的旧快照迁移、准确原生读取和错误分类。 |
| 必须保持的行为 | key 缺失可以表示匿名；key 存在但无法解码必须抛出可诊断错误、保留存储且不自动清理。 |
| 精确失败 oracle | `src/platform/storage/legacyCookieSnapshotMigration.test.ts` 注入损坏旧 JSON 与原生读取失败，要求保留旧快照并报告失败；`src/platform/network/managedCookies.test.ts` 固定空 Cookie 与读取错误不能混淆，均不得宣称匿名成功。 |
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
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 `clearManagedLoginCookies` 对全部目标 Cookie、主线程 callback、回读确认与错误聚合的顺序。 |
| 必须保持的行为 | 所有可达 URL/Cookie 都尝试清理；`false` 算失败；只要有成功删除就 flush，随后聚合报告全部失败，绝不宣称完全成功。 |
| 精确失败 oracle | `src/platform/network/managedCookies.test.ts` 固定窄化 clear port 的 unsupported/false/error 分类；`tests/tooling/release-packaging.test.ts` 与生成的原生测试固定全部删除 callback 完成、持久化及回读确认后才返回成功。 |
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
| 根因 seam | `src/app/useReaderRuntime.ts` 的提交队列与完整快照基线。 |
| 必须保持的行为 | 每个后续 mutation 都基于最后已提交完整快照；旧保存失败后，较晚设置修改仍要重写当前资料和设置。 |
| 精确失败 oracle | `tests/ui/library/reader-data-controller.test.tsx` 控制首个保存失败，再改设置，要求第二次保存包含最新完整 ReaderData。 |
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
| 根因 seam | `src/platform/storage/readerDataStore.ts` 的原子补偿和 `src/app/useReaderRuntime.ts` 的未知状态熔断。 |
| 必须保持的行为 | 配对写失败必须尝试恢复旧完整快照并用 `AggregateError` 保留原错与回滚错；回滚失败后取消已排队保存并暂停新 mutation，直到显式备份恢复成功。 |
| 精确失败 oracle | `src/platform/storage/readerDataStore.test.ts` 固定补偿；`tests/ui/library/reader-data-controller.test.tsx` 固定 queued 与未来 mutation 均不再落盘。 |
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
| 根因 seam | `src/app/useReaderRuntime.ts` 的 no-op 去重与恢复强制写边界。 |
| 必须保持的行为 | recovery-required 时备份导入必须强制完整物理写；只有写入成功才解除暂停。正常状态仍可跳过真正 no-op。 |
| 精确失败 oracle | `tests/ui/library/reader-data-controller.test.tsx` 先制造未知磁盘状态，再导入相同备份，要求发生物理写并恢复可修改状态。 |
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
| 根因 seam | `src/domain/reader/readerData.ts` 的 UserProfile 统计清洗和妖火派生字段。 |
| 必须保持的行为 | 已定义统计归一为有限、非负整数；缺失保持 undefined；两个组成值只要都已定义，包括 0，就派生总数。 |
| 精确失败 oracle | `src/domain/reader/readerData.test.ts` 注入负数、小数、非有限值和零值组合，固定清洗与派生结果。 |
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
| 根因 seam | `src/features/feed/useFeedController.ts` 的单站 category 结果应用和错误通知边界。 |
| 必须保持的行为 | 单站分类有来源错误时不把空结果当成功，保留可信旧分类并显示可重试提示；合法空分类仍可成功。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 注入小隐寺单站空错误结果，要求 notify 且不应用成功空态。 |
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
| 根因 seam | `src/platform/network/useNetworkProxyRuntime.ts` 的持久化队列、native apply 队列与 committed state。 |
| 必须保持的行为 | 所有命令按提交顺序串行；profile 先保存成功再 apply；后一次 edit 基于已提交状态；最终 enable/disable 与最后命令一致；未改动的启用 profile 保持可用。 |
| 精确失败 oracle | `tests/ui/more/network-proxy-controller.test.tsx` 固定并发保存、选择、保存失败、no-op 保存以及快速启停的完成顺序。 |
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
| 根因 seam | `src/platform/network/useNetworkProxyRuntime.ts` 的 recovery command 与 `src/features/more/components/NetworkProxyModal.tsx` 的显式直连重置入口。 |
| 必须保持的行为 | 错误态提供需确认的“重置为直连”；成功保存空代理状态并原生 apply `null` 后才解除门禁，失败继续保持错误态。 |
| 精确失败 oracle | `tests/ui/more/network-proxy-controller.test.tsx` 固定损坏读取后的空状态保存/apply；`tests/ui/more/network-proxy-modal.test.tsx` 固定错误态入口与确认行为。 |
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
| 根因 seam | `src/features/search/useSearchController.ts` 的来源级 retry completion 与聚合错误保留。 |
| 必须保持的行为 | 重试结果只由本次 active source 决定；其他来源错误继续显示但不影响该来源成功提交和提示。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 保留无关来源错误并让 NodeSeek 重试成功，要求 NodeSeek 结果落地且不误报失败。 |
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
| 根因 seam | `src/features/search/useSearchController.ts` 的分页错误门禁、append 与 cursor commit 顺序。 |
| 必须保持的行为 | 失败页任何 partial items 都不得落地；保留旧结果和原失败 cursor，尾部显示错误且只重试同一页。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 返回带一条 partial item 的失败页，要求列表、页码和 cursor 全部保持。 |
| 最低可靠自动测试层 | `UI_PASS`。 |
| Replay 或真实验收路径 | 单站滚动加载更多；自然失败时确认旧列表仍在并从尾部重试。 |
| 负向验证方式 | 恢复错误检查前 append，编号测试会出现 partial item 或 cursor 前进。 |
| 明确不覆盖范围 | 不禁止合法成功页包含零条数据，也不自动推断来源下一页。 |

## `REG-SEARCH-006` 未提交的 disabled Query 锁死首次搜索

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 用户症状 | 首次进入搜索页并输入关键词后，提交按钮仍是 disabled；点击没有网络请求，结果页永久停在“按键盘上的搜索键开始”。 |
| 触发条件 | 尚无 `submittedSearch`，单站 Infinite Query 因 `enabled=false` 没有 data，但 TanStack Query 的状态仍是 `isPending=true`。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的 `searchBusy` 直接读取 disabled Query 的 `isPending`，没有先判断是否已经提交业务查询。 |
| 必须保持的行为 | 未提交时 `searchBusy=false`；提交后才按当前“全部”或单站 Query 的初始 pending 状态显示忙碌。同一次首次提交只启动对应 Query transport，disabled Query 的内部状态不得禁用用户入口。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-006` 在真实 `QueryClientProvider` 下先断言首次提交前不忙，再提交单站搜索并要求恰好一次 Gateway 调用和最终收口；修复前第一条断言稳定收到 `true`。 |
| 最低可靠自动测试层 | `UI_PASS`：必须观察 TanStack hook 的 disabled Query 状态与 controller 对外 busy；纯 key 或 reducer 单测无法复现。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 从自己的 Search tab 完成首次聚合提交，等待 catalog-complete 结算；固定 RNTL 证明首次提交只发一次 transport，有数据时的打开/返回由 Agent Live。 |
| 负向验证方式 | 删除 `submittedSearch` 门禁并直接返回 `singleSearchQuery.isPending`，编号测试应在发出任何 transport 前失败。 |
| 明确不覆盖范围 | 不保证动态站点一定有结果，也不改变重复 refetch、分页或来源错误的既有语义。 |

## `REG-SEARCH-007` 聚合搜索自动打开单站登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-04`、`ACCOUNT-02` |
| 用户症状 | 用户执行“全部”搜索时，某站需要登录或验证会突然打开该站 WebView/验证面板，打断其他站结果的渐进展示。 |
| 触发条件 | 聚合 Query 中 NodeSeek、linux.do 或妖火返回 `action-required`，Search controller 的 effect 扫描全部来源结果。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的生产 effect 没有聚合门禁；旧单元测试只调用生产链路未使用的 action helper，因此在错误实现下仍通过。 |
| 必须保持的行为 | 聚合、后台 AI 和预取只在对应来源区块显示可理解且可重试的状态，不自动打开任何登录/验证面板；用户主动执行单站前台搜索时仍可打开并精确恢复。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-007` 通过真实 Controller 同时让 linux.do、NodeSeek 和妖火要求动作，等待五个 Query 结算后断言三个面板回调均为零。修复前 NodeSeek 回调稳定为一次。 |
| 最低可靠自动测试层 | `UI_PASS`：必须运行 effect 和 Query 状态；对脱离生产链路的纯 helper 断言不构成证据。 |
| Replay 或真实验收路径 | 搜索 → 全部；自然遇到受限来源时确认状态留在区块内且其他站继续完成。不清 Cookie 或主动制造 challenge。 |
| 负向验证方式 | 删除 effect 的 `source === 'all'` 门禁，编号测试必须看到 NodeSeek 验证回调。 |
| 明确不覆盖范围 | 不禁止用户主动进入单站后打开所需面板，也不自动重放后台失败请求。 |

## `REG-SEARCH-008` 聚合刷新失败隐藏错误并伪装旧结果成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 用户症状 | “全部”中某站已有预览时再次搜索或重试，该站刷新失败后仍只显示旧结果，没有错误或重试入口，看起来像本次刷新成功。 |
| 触发条件 | 同一聚合 Query key 先成功，随后普通错误或 `parse_empty`；TanStack Query 同时保留旧 `data` 并提供本次 `error`。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的 aggregate group 投影先返回 `query.data`，导致 `SearchPageError.result` 永远不可见。 |
| 必须保持的行为 | 旧预览继续可读；同一区块同时显示本次来源错误和重试入口，不落地失败响应中的 partial items，不自动重试，也不影响其他来源。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-008` 让 NodeSeek 聚合 Query 先返回一条可信结果，再刷新失败；要求原条目仍在且 `error/errorKind` 来自失败响应。修复前条目保留但两个错误字段均为 `undefined`。 |
| 最低可靠自动测试层 | `UI_PASS`：必须在真实 `QueryClientProvider` 下覆盖 refetch 后 data/error 并存状态。 |
| Replay 或真实验收路径 | “全部”重复搜索；自然失败时检查旧预览与来源错误并存。动态验收不强制制造站点失败。 |
| 负向验证方式 | 将 aggregate 投影恢复为先判断 `query.data`，编号测试必须因错误字段缺失失败。 |
| 明确不覆盖范围 | 不为“全部”增加分页，不改变来源顺序或每站最多两条预览，也不把失败响应的条目当作可信 data。 |

## `REG-TOPIC-008` linux.do 正文用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`USER-01`、`NAV-02` |
| 用户症状 | 点击 linux.do 正文中的 `/u/alice` 会离开 App 打开外部页面，无法进入现有用户详情和返回链。 |
| 触发条件 | 用户链接是相对 URL，router 只识别主题链接或绝对 profile URL。 |
| 根因 seam | `src/domain/forum/links.ts` 的 forum user link 解析、base URL 解析与受信来源映射。 |
| 必须保持的行为 | linux.do 相对及同源公开用户链接进入 App User；其他站、相似域名和非公开设置路径仍按各自规则处理。 |
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-TOPIC-008` 以 linux.do 主题为 base 解析 `/u/alice`，要求 `source=linuxdo` 和正确 username。 |
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
| 根因 seam | `src/domain/forum/text.ts` 的 quote-aware HTML token scanning 与高亮边界。 |
| 必须保持的行为 | 只高亮可见文本节点，绝不修改 tag 名、属性名或引号内属性值；用户可见同词仍正常高亮。 |
| 精确失败 oracle | `tests/integration/feature-helper-contracts.test.ts` 用 `title="VPS > private link"` 固定输出 HTML 未被属性内高亮破坏。 |
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
| 根因 seam | `src/domain/forum/text.ts` 的 `stripHtml` 可见文本提取。 |
| 必须保持的行为 | 复制内容只包含解码后的用户可见文本，属性值、标签与隐藏结构不得泄漏。 |
| 精确失败 oracle | `tests/integration/feature-helper-contracts.test.ts` 要求含引号 `>` 的链接只复制 `visible link`。 |
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
| 根因 seam | `src/platform/media/inlineMedia.ts` 在 sticker/image regex 前的 quoted-tag normalization。 |
| 必须保持的行为 | 引号内 `>` 属于属性内容；sticker、前后正文和 inline 流顺序都保持，真正 tag 结束符才参与分片。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 的 `REG-TOPIC-011` 固定 `title="1 > 0"` sticker 与前后正文均保留。 |
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
| 根因 seam | `src/domain/forum/html.ts` 的共享 `textContentFromHtml` 与 `src/domain/forum/topicContentHtml.ts` 的 render normalization。 |
| 必须保持的行为 | 所有调用方先按同一 quote-aware 规则识别完整 tag；可见文本不含属性，mention 链接仍加 class 且属性正确 escape。 |
| 精确失败 oracle | `tests/integration/html-sanitization-contracts.test.ts` 固定无属性泄漏；`src/domain/forum/topicContentHtml.test.ts` 固定含 `title="1 > 0"` 的 `@alice` 仍被识别。 |
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
| 根因 seam | `src/domain/forum/links.ts` 的妖火 host allowlist 与 canonical topic URL。 |
| 必须保持的行为 | 精确裸域和 `www` 域都进入 App Topic，并规范化到安全 canonical URL；相似域和其他协议仍拒绝。 |
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-TOPIC-013` 固定裸域主题 ID/source，同时保留 lookalike 负向用例。 |
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
| 根因 seam | `src/platform/media/imageSave.ts` 对远程图片下载复用受控 `fetchWithTimeout` 的边界。 |
| 必须保持的行为 | 下载在配置时限内完成或抛出明确超时；caller 必须由 rejection 收口并释放一次性保存门禁。 |
| 精确失败 oracle | `src/platform/media/imageSave.test.ts` 用永不完成的 fetch 和 fake timers 要求超时 rejection。 |
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
| 根因 seam | `src/platform/media/imageSave.ts` 的 URL/Content-Type 图片扩展名归一化。 |
| 必须保持的行为 | 已支持的现代格式保留正确扩展；查询和 hash 不参与扩展；`jpeg` 规范化为 `jpg`；成功响应给出已识别图片 `Content-Type` 时以响应类型为准，只有类型缺失或未知时才回退 URL；兼容预览接受的 `application/svg+xml` 保存时也必须按 SVG 处理。 |
| 精确失败 oracle | `src/platform/media/imageSave.test.ts` 固定 AVIF URL、“`.png` URL 返回 `image/svg+xml`”及 legacy `application/svg+xml` 三条文件名/字节契约。 |
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
| 根因 seam | `src/sources/v2ex/reader.ts` 的 thanks 文本提取改用共享 `textContentFromHtml`。 |
| 必须保持的行为 | 只从可见 thanks 文本读取非负数量；图标属性内容不得进入或截断数字。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-TOPIC-016` 用 quoted `>` 图标 fixture 要求正确 `thanksCount`。 |
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
| 根因 seam | `src/features/topic/shareTopic.ts` 的双层 fallback 收口与 `src/features/topic/TopicRoute.tsx` 的菜单调用。 |
| 必须保持的行为 | 分享成功返回成功；分享失败但复制成功明确提示已复制；两者都失败时消费异常、提示重试并返回失败。 |
| 精确失败 oracle | `src/features/topic/shareTopic.test.ts` 的 `REG-TOPIC-017` 让两层都 reject，要求 helper 不再 reject 且 notify 明确失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 系统分享只打开后取消；不读取剪贴板，不人为破坏系统服务。 |
| 负向验证方式 | 删除 clipboard catch，编号测试再次 rejection。 |
| 明确不覆盖范围 | 不保证第三方分享目标成功，也不自动重试或记录分享内容。 |

## `REG-TOPIC-018` Android 不兼容的动态 SVG 被当作图片加载失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 主题里的报告图片 URL 以 `.png` 结尾、实际返回 `image/svg+xml` 时，Android 正文显示“图片加载失败”；简单改成 data URI 仍使用同一 AndroidSVG decoder，全屏也可能空白。 |
| 触发条件 | SVG 使用 AndroidSVG 不支持或会崩溃的文档结构，或根 `<svg>` 使用相对尺寸配合非方形 `viewBox`。 |
| 根因 seam | `src/platform/media/compatibleImageSources.ts` 的 SVG document artifact、`src/features/topic/rendering/previewRenderers.tsx` 的海报 native view/几何、`src/ui/media/ImagePreviewModal.tsx` 的全屏 renderer 切换。 |
| 必须保持的行为 | 普通位图继续只走原生单次加载；只有原生解码失败后才在 10 秒、1 MiB、明确 SVG `Content-Type` 门禁下复取并保留原请求字节。共享 artifact 缓存原始 document data URI、原始固有比例、动画能力与 Chromium PNG 海报；正文与静态全屏使用海报，只有动画全屏当前页使用隔离 document view，迟到结果按 request identity 丢弃。数值/px 尺寸可直接使用，相对尺寸回退 `viewBox`。 |
| 精确失败 oracle | `src/platform/media/compatibleImageSources.test.ts` 固定原始字节、SVG 缓存、请求头、百分比尺寸与真实动画分类；`tests/ui/topic/topic-image-loading.test.tsx` 与 `tests/ui/topic/image-preview.test.tsx` 固定原生失败后正文切换海报、静态全屏保持海报、动画全屏当前页切换 document view且不显示失败态。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`。 |
| Replay 或真实验收路径 | 只读打开 NodeSeek `【TQ】Vmiss US.LA.TRI.Basic`，确认 tcpquality 三张动态报告在正文和全屏预览中保持完整比例；只打开预览，不保存。 |
| 负向验证方式 | 把 posterSource 改回 SVG data URI、把百分比解析为数字或不给 fallback 同时约束宽高，编号测试分别重新进入同一 decoder、得到 100×100 尺寸或错误几何。 |
| 明确不覆盖范围 | 不对普通非 SVG 失败伪造成功，不执行脚本/外部资源；复杂文档能力与安全边界由 `REG-TOPIC-038` 继续固定。 |

## `REG-TOPIC-019` NodeSeek 私有媒体在预览和保存时丢失实时会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 用户症状 | NodeSeek 受保护图片可在正文中显示，点开全屏、播放视频或保存时却重新发起匿名请求，或继续使用持久化旧 Cookie，得到登录页、403 或加载失败。 |
| 触发条件 | RN/Fresco、Expo Image、Expo Video 和保存下载分别拥有 transport；其中任一路没有接入准确 URL 的当前 WebView Cookie，或从 App 快照手工拼接旧 `Cookie` header。 |
| 根因 seam | 原生 managed OkHttp client、Expo Image loader、`src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Video source、图片预览与 `src/platform/media/imageSave.ts`。 |
| 必须保持的行为 | 本条保留“NodeSeek 同来源受保护媒体不丢当前会话、不使用 Cookie 快照、响应不回写”的历史语义；旧 JS Expo Video Cookie bridge 由 `REG-TOPIC-029` 的统一媒体契约取代。正文、全屏图、SVG fallback、保存下载和视频都在 JS 携带内部内容来源 marker 与 opaque session identity，原生在发网前移除两个内部头和任何 JS `Cookie` header。首跳目标属于内容来源时可按准确 URL 从 WebView CookieJar 实时读取；跨来源、未受管、无效 marker 或媒体 Cookie 读取失败都继续匿名加载，重定向一旦离开内容来源就永久降权。RN Networking、Fresco、Expo Image 与 Expo Video 使用项目配置的 managed OkHttp client；响应不得写回 WebView，Cookie 值不得进入 URL、持久化文件或诊断日志。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest` 固定两个内部头在发网前移除、同来源首跳可读 Cookie、跨来源/无效 marker 匿名继续、Cookie 读取异常 fail-closed，以及离源后跳回仍不恢复。`tests/tooling/release-packaging.test.ts` 与 `tests/tooling/network-proxy-plugin.test.ts` 固定 Expo Image/Video 使用 managed client 且视频不继承图片总时限；`src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/image-preview.test.tsx`、`tests/ui/topic/image-preview-controller.test.tsx` 与 `src/platform/media/imageSave.test.ts` 固定各入口只传内部来源与 identity 头、不在 JS 传输 Cookie 快照。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生生成/编译。 |
| Replay 或真实验收路径 | 只有当前登录态自然出现受保护媒体时做只读预览；真实保存会写系统媒体库，须另获授权。 |
| 负向验证方式 | 恢复媒体 Cookie state/参数、按媒体目标 host 推断身份、向 JS source 写入 `Cookie`、让重定向离源后重新获得 Cookie、让 Expo Image/Video 使用独立 client，或允许响应保存 Cookie；对应测试必须失败。 |
| 明确不覆盖范围 | 不清理或伪造登录态来制造私有对象，不把 Cookie 发往非 NodeSeek host，也不执行未经授权的相册写入。 |

## `REG-TOPIC-020` Android 不兼容 SVG 在非当前预览页抢占昂贵恢复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 多图预览会让当前原图与相邻复杂 SVG 同时启动 Chromium/海报兼容恢复，导致当前图片继续等待、手势掉帧或出现多份昂贵渲染。 |
| 触发条件 | 虚拟窗口会挂载相邻页；若相邻页的原生解码失败立即启动 SVG fallback，就把“低优先级占位预热”误升级成昂贵网络复取与 Chromium 工作。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的页面 active 状态与 `src/platform/media/compatibleImageSources.ts` 的兼容恢复入口。 |
| 必须保持的行为 | 当前页原生失败后可启动受限 SVG artifact 恢复；静态 artifact 显示海报，动画 artifact 才显示单个隔离 document view。相邻页只允许低优先级原生请求和 display placeholder，原生失败时仅记住失败，不启动 fetch、海报或 WebView。该页成为当前页后才允许恢复；离开当前页取消其未结算的 UI 所有权。健康位图不额外 fetch，远页不挂载，图库不恢复缩略图栏。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-020` 先让相邻页原生失败，要求 SVG fetch/renderer 与 WebView 均为零；切换该页为当前页后才允许一次共享恢复，并且只有动画 artifact 的当前页挂载 document view。 |
| 最低可靠自动测试层 | `UI_PASS`。 |
| Replay 或真实验收路径 | 在上述 NodeSeek 三图主题打开预览，保持第 2 张为当前页时确认只显示当前动态 SVG、滑动与缩放正常；再滑到第 3 张，届时才启动其兼容恢复并显示完整内容。 |
| 负向验证方式 | 让相邻页 `onError` 直接调用兼容恢复时，编号测试会在切页前观察到 fetch/renderer；禁用当前页恢复时，切页后的成功断言失败。 |
| 明确不覆盖范围 | 不预抓取图库外图片，不恢复原图缩略图栏，不为普通非 SVG 错误隐藏空态，也不执行保存。 |

## `REG-TOPIC-021` NodeSeek 短后台恢复被超时抢先判失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01` |
| 用户症状 | NodeSeek 详情请求发出后立即按 Home，App 进程仍存活且网络已在恢复瞬间返回 200，回到 App 却先显示“请求超时”，只能手动重试。 |
| 触发条件 | 请求进入 Android 短后台后 JavaScript timer 暂停；恢复前台时，已经超过墙钟时限的外层 timeout 与原请求完成回调一起恢复执行，timeout 先结算。 |
| 根因 seam | `src/platform/network/request.ts` 的共享请求 timeout 预算、`src/app/useAppRuntime.tsx` 的 `AppState` 生命周期桥接，以及 `src/sources/nodeseek/browserFallback.ts` 的 NodeSeek direct timeout。 |
| 必须保持的行为 | App 处于 `background` 或 `inactive` 时不消耗请求 timeout 预算；回到 `active` 后原请求继续使用剩余预算并可正常结算，不自动重复发起同一详情；真正卡住的请求仍在累计完剩余前台预算后超时。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-TOPIC-021` 固定 direct Response 已返回但 challenge body 尚未读取完成，模拟 35 秒后台后要求请求仍未失败，恢复时由原 direct 请求成功返回且不调用 WebView fallback。 |
| 最低可靠自动测试层 | `UNIT_PASS`；Android `AppState` 与真实 transport 时序仍需 `LIVE_PASS`。 |
| Replay 或真实验收路径 | NodeSeek 首页点入一个仍在请求的主题后立即按 Home，保持同一 PID 15 秒；开启飞行模式作为离线屏障后恢复 App，详情应无需重试完整显示，且恢复前台后不重新发起同一详情。 |
| 负向验证方式 | 将共享 timeout 恢复为连续墙钟 `setTimeout`，编号测试在 35 秒后台阶段先收到“请求超时”。 |
| 明确不覆盖范围 | 不保证进程被系统回收、锁屏、Doze 或持久后台任务；不新增 Service、WorkManager 或后台执行权限。 |

## `REG-TOPIC-022` 凭据观察事件取消正在执行的同站 Query

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`USER-01`；共享回归 `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`ACCOUNT-01` |
| 用户症状 | NodeSeek 主题详情或关注用户页进入后长期停在“正在读取”；网络请求本可成功，但页面既不显示结果也不进入可重试失败态。真实登录切换、过期或清除时还可能继续显示旧会话的首页、搜索、详情或用户数据。妖火及其他复用同一会话事件边界的读取存在同类风险。 |
| 触发条件 | 旧实现的 Query `queryFn` 读取 App Cookie 快照；被动 loader 在当前读取期间发送 `cookie-loaded`，Session controller 随即把观察事件误当成身份变化，取消并移除正在执行它的 Query。真实身份变化若只删旧 cache 却不推进非敏感 session epoch，仍可能重新观察旧 key。 |
| 根因 seam | `src/features/account/useSessionController.ts` 的 workflow 事件分类与 session epoch、`src/platform/query/serverState.ts` 的 source/`all` Query cache 边界，以及 TanStack Query observer 的取消结算语义。 |
| 必须保持的行为 | 被动 workflow 观察不能取消或移除当前 Query；Account canonical probe 明确 A→B/A→anonymous/anonymous→B 后才取消并移除对应 source 与 `all` 私有 Query并推进该站 session epoch，让 Feed/Search/Topic/User 直接从新 Query result 派生 Loading、data 和 error；其他来源不变。登录 surface open/unknown 只建立 barrier并保留旧内容只读，A→A 不推进 epoch。linux.do 权威 recovery 仅可保留与 source 和结构化 `recoveryQueryKey` 完全匹配且仍有 active observer 的 Query；前缀相似、其他 lane、其他来源和已失去 observer 的 key 都必须清除。 |
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定观察/身份变化分类、source + `all` 清理、其他来源隔离和结构化 recovery key；`tests/integration/query-session-contracts.test.ts` 固定 session epoch key；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx`、`tests/ui/search/search-controller-ai.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx` 与 `tests/ui/user/user-controller-session.test.tsx` 固定 epoch 隔离、barrier、分页/回复/引用/双 cursor 恢复及聚合 Search 其他来源继续完成。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 Query 取消、事件分类和精确 cache 边界；`UI_PASS` 通过真实 `QueryClientProvider` 固定 observer、cursor、Loading、来源隔离及固定 Feed/Library 导航；五站动态读取仍需 `LIVE_PASS`。 |
| Replay 或真实验收路径 | `four-source-feed.ad` 与 `library-return.ad` 只证明入口和设备无关 outcome；Agent Live 逐站打开满足前置条件的详情或用户页，确认请求完成且没有同站自取消或恢复后重复请求。 |
| 负向验证方式 | 让被动 workflow 事件失效 Query，观察用例必须无法提交详情；真实身份变化不推进 session epoch 时 UI 用例必须继续观察旧 key；只清 source、不清 `all`，或按前缀保留 recovery lane 时 cache 边界断言必须失败。 |
| 明确不覆盖范围 | 不跳过真实新凭据、登录、退出或明确凭据失效后的缓存隔离；不把账号状态事件改成缓存数据，也不新增另一套请求 owner。 |

## `REG-TOPIC-023` 回复分页验证恢复重取旧页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；关联 `TOPIC-01`、`ACCOUNT-02` |
| 用户症状 | linux.do 回复第二页遇到验证后完成验证，界面提示恢复完成，但新回复没有出现；再次加载仍可能重复进入验证或网络请求。 |
| 触发条件 | `useInfiniteQuery.fetchNextPage()` 失败后，恢复回调统一调用 `refetch()`；TanStack Query 只重取已经存在于 `pages` 的首屏，失败页尚未进入 cache。 |
| 根因 seam | `src/features/topic/useTopicController.ts` 的 Infinite Query error 类型、精确验证恢复操作与 `ReplyPageParam`。 |
| 必须保持的行为 | 首屏刷新失败恢复仍 refetch 已缓存 pages；下一页失败恢复必须再次执行 `fetchNextPage()`，沿缓存最后一页派生同一个 page/offset，成功后只合并一次且保留旧 replies。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-TOPIC-023` 让第 2 页先返回 Cloudflare 错误、恢复后成功，要求 transport page 顺序严格为 `[2, 2]`、结果为首屏与第二页合并且 `hasMore=false`；错误实现会得到 `[2, 1]`。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 `QueryClientProvider` 和 Infinite Query observer。 |
| Replay 或真实验收路径 | linux.do 有多页回复的主题滚动加载，若自然出现验证则完成后确认新页直接追加；不清 Cookie 制造验证。 |
| 负向验证方式 | 把分页恢复改回统一 `repliesQuery.refetch()`，编号测试精确收到第二次 page=1。 |
| 明确不覆盖范围 | 不自动绕过 Cloudflare，不把普通网络失败转成验证，也不重试非幂等写入。 |

## `REG-UPDATE-002` 系统未打开安装确认却提示已开始

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04` |
| 用户症状 | Android 原生安装请求返回 `false`、没有显示系统确认页时，App 仍提示安装已开始或成功。 |
| 触发条件 | installer API 的布尔确认值被忽略，只要 Promise resolve 就视为成功。 |
| 根因 seam | `src/platform/update/appUpdate.ts` 的 APK 检查、安装请求返回值与 controller 成功提示契约。 |
| 必须保持的行为 | 只有原生明确返回 `true` 才能宣称系统安装确认已打开；`false` 必须 reject 并由 UI 提示失败。 |
| 精确失败 oracle | `src/platform/update/appUpdate.test.ts` 的 `REG-UPDATE-002` 让 inspect 合法但 install 返回 false，要求 rejection。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | APK 下载/安装属于发布风险操作，未经授权不执行。 |
| 负向验证方式 | 忽略返回值，编号测试会错误 resolve。 |
| 明确不覆盖范围 | 不证明安装最终完成，也不替代签名、版本和 release 验证。 |

## `REG-UPDATE-003` Release manifest 接受任意自洽 signer

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 用户症状 | Release 资产被替换后，攻击者可用另一把私钥生成 APK 和自洽 manifest，App 下载完成后才依赖系统安装器拒绝，不能在检查更新阶段指出 signer 不可信。 |
| 触发条件 | manifest 只校验 signer 是 64 位 SHA，并在下载后与 APK 自洽，没有和 App 内置正式 signer 比较。 |
| 根因 seam | `src/platform/update/appUpdate.ts` 的 manifest trust root 与 `app.json` 的 `expo.extra.releaseSignerSha256`。 |
| 必须保持的行为 | 只有等于内置固定 signer 的 manifest 才能形成 update info；下载后继续校验文件 hash、包名、版本和同一 signer，Android PackageManager 仍是最终安装门禁。 |
| 精确失败 oracle | `src/platform/update/appUpdate.test.ts` 的 `REG-UPDATE-003` 提供格式合法但不同的 64 位 signer，必须在 manifest 解析阶段拒绝；成功 fixture 使用 `app.json` 的真实 pin。 |
| 最低可靠自动测试层 | `UNIT_PASS`：更新解析与安装前 inspection；真实安装只在发布授权中执行。 |
| Replay 或真实验收路径 | 更多 → 检查更新可只读验证无更新/可信更新信息；下载和安装需单独授权。 |
| 负向验证方式 | 删除 pin 比较，编号测试会错误返回 update info。 |
| 明确不覆盖范围 | 不实现 key rotation；轮换必须另行设计 bridge release 或显式允许 signer 集合。 |

## `REG-UPDATE-004` APK 检查把签名历史的最老证书当作当前 signer

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 用户症状 | APK 存在签名历史时，检查器返回旧证书摘要；多 signer APK 还可能任选第一个，导致错误接受或拒绝。 |
| 触发条件 | Android P+ 使用 `signingCertificateHistory.firstOrNull()`，没有表达“当前且唯一 signer”的契约。 |
| 根因 seam | `plugins/withApkInstaller.js` 生成的 `ApkInstallerModule.apkSignerSha256`。 |
| 必须保持的行为 | Android P+ 只接受 `apkContentsSigners.singleOrNull()`；旧系统同样只接受唯一 signature。签名缺失或多 signer 返回不可识别并阻止安装。 |
| 精确失败 oracle | `plugins/withApkInstaller.js` 生成并执行 Kotlin 行为测试：即使 history 同时含旧证书和当前证书，也只返回唯一 `apkContentsSigners`；当前 signer 为空或多个时返回 null。结构测试禁止 `firstOrNull()` 并固定 API 28+/旧系统调用边界；fresh prebuild 后必须通过 Android release unit test 与 Kotlin compile。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定生成契约，`STATIC_PASS`/原生 compile 证明目标 SDK API 可用；真实 APK inspection 需发布授权。 |
| Replay 或真实验收路径 | 获授权的发布候选通过 App 更新下载后检查；未经授权不打开系统安装器。 |
| 负向验证方式 | 恢复 history 或 `firstOrNull()`，编号测试必须失败。 |
| 明确不覆盖范围 | 当前不支持签名轮换，也不接受多个同时 signer。 |

## `REG-USER-001` 用户页跨 Tab 分页留下永久忙碌 cursor

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01` |
| 用户症状 | 主题分页尚未完成时切到回复并加载更多，其中一个 tab 会接管共享请求状态；另一个 tab 的 cursor 永久 busy，切回后无法重试。 |
| 触发条件 | 主题和回复两个远端列表共用手写 request owner、generation 或 Loading/cursor state。 |
| 根因 seam | `src/features/user/useUserController.ts` 的 profile Query 与 topics/replies 两个 Infinite Query 的 key、`pageParam` 和派生状态边界。 |
| 必须保持的行为 | 首屏 profile 只读取一次并分别 seed 两个 lane；topics 与 replies 使用独立结构化 Query key、pages、cursor 和 fetching 状态，可以同时分页且互不覆盖。切换 tab 只改变本地视图，不接管或取消另一个 lane。 |
| 精确失败 oracle | `tests/ui/user/user-controller-session.test.tsx` 的 `REG-USER-001` 在真实 `QueryClientProvider` 下同时完成 topics/replies 下一页，要求两个 cursor、列表和 Loading 独立结算，且首屏 transport 不重复。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 Infinite Query observer 并精确调度两个 Promise。 |
| Replay 或真实验收路径 | 用户页两个 tab 分别滚动加载并切回，确认没有永久 Spinner。 |
| 负向验证方式 | 把两个 lane 合并为同一 Query key，或重新用共享 latest id/Loading state 收口，编号测试必须观察到 cursor、列表或 busy 串线。 |
| 明确不覆盖范围 | 不并行合并两个 tab 的内容，也不保证来源存在下一页。 |

## `REG-USER-002` 小隐寺关注用户恢复到错误站点 URL

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-02`、`LIBRARY-02`、`DATA-01` |
| 用户症状 | 老备份中的小隐寺关注用户缺少 profile URL 时，恢复逻辑生成其他站点地址，点击后离开正确来源。 |
| 触发条件 | sanitize/migration 的 URL fallback 没有覆盖 `source=xiaoyinsi`。 |
| 根因 seam | `src/domain/reader/readerData.ts` 的 source-specific user profile URL 构建。 |
| 必须保持的行为 | 五站缺失 URL 都按各自 canonical user page 恢复；小隐寺必须指向 `xiaoyinsi.com/u/{username}`。 |
| 精确失败 oracle | `src/domain/reader/readerData.test.ts` 的 `REG-USER-002` 恢复缺 URL 的小隐寺 profile 并比较来源与 URL。 |
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
| 根因 seam | `src/domain/forum/links.ts` 的妖火 user host 识别和参数提取。 |
| 必须保持的行为 | 精确裸域与 `www` 用户链接都解析为妖火 User；相似域、缺用户 ID 或其他路径不内化。 |
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-USER-003` 固定裸域 `touserid` 解析及 lookalike 负向边界。 |
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
| 根因 seam | `src/domain/forum/links.ts` 的 Discourse public profile suffix allowlist。 |
| 必须保持的行为 | summary/activity 等公开 profile tab 归一到 App User；preferences、messages、admin 等私密/管理路径继续外部处理。 |
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-USER-004` 固定两个站点公开 tab，并对 preferences 保持拒绝。 |
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
| 根因 seam | `src/sources/linuxdo/account.ts`、`src/sources/xiaoyinsi/account.ts`、`src/sources/nodeseek/protocol.ts`、`src/sources/yaohuo/normalization.ts` 的可选非负统计归一化。 |
| 必须保持的行为 | 来源明确返回的有限非负 0 必须保留；字段缺失仍为 undefined；负数拒绝。妖火两个组成统计均已定义时，包括 0，派生总数。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts`、`src/sources/xiaoyinsi/reader.test.ts`、`src/sources/yaohuo/parser.test.ts` 分别固定四站显式零统计。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 只读打开确有零统计的新用户；动态目标不存在时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 truthy 判断，四站相应用例都会得到 undefined。 |
| 明确不覆盖范围 | V2EX 数量来自可能失败的分页数组，空数组不能据此证明真实为 0，因此本条不改变 V2EX。 |

## `REG-USER-006` Profile 已显示 cursor 但 Infinite Query 尚未接管分页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01` |
| 用户症状 | 用户页已经显示首屏和“可继续加载”，此时立即加载更多却没有任何网络请求、错误或提示；稍后再试才可能生效。 |
| 触发条件 | Profile Query 先完成并进入页面投影，topics/replies Infinite Query 仍等待 effect 把首屏写入对应 lane；分页命令读取 observer 的瞬时 `hasNextPage=false` 后静默返回。 |
| 根因 seam | `src/features/user/useUserController.ts` 的 Profile Query 首屏 seed、两个 Infinite Query observer 与分页命令提交边界。 |
| 必须保持的行为 | 页面一旦能从 Profile Query 看到 next cursor，两个 lane 的分页命令就必须先确保同一 Query key 已 seed；若该 lane 的本地首屏 Query 正在结算，先等待它，再从 Query cache 的最后 page/pageParam 判断并请求准确 cursor。不得重复首屏 transport，也不得用手写 busy/request owner 修补。 |
| 精确失败 oracle | `tests/ui/user/user-controller-session.test.tsx` 的 `REG-USER-006` 在首屏 cursor 刚可见时立即调用 topics 加载更多；必须进入第二页 transport，并在首次请求遇到 linux.do 验证后携带同一 lane key/cursor 恢复。旧实现稳定收到验证回调 `0` 次。 |
| 最低可靠自动测试层 | `UI_PASS`：必须用真实 `QueryClientProvider` 暴露 Profile 与 Infinite Query observer 的提交先后；纯 cursor helper 单测无法复现。 |
| Replay 或真实验收路径 | User 页首屏出现后立即滚到底部触发下一页；有动态下一页目标时核对 transport 与列表只追加一次。 |
| 负向验证方式 | 恢复只读取 `topicsQuery.hasNextPage` / `repliesQuery.hasNextPage` 的早退条件，单文件 RNTL 用例必须在等待验证回调时失败。 |
| 明确不覆盖范围 | 不增加自动预取，不改变来源 cursor 格式，也不把没有 next cursor 的用户强制请求第二页。 |

## `REG-WRITE-011` 删除回复后本地详情仍保留楼层

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-02`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 服务器已确认删除回复，但当前详情和回复分页仍显示该楼层、回复数不变；若编辑器正回复该楼层，还会继续指向不存在对象。 |
| 触发条件 | action controller 只提示成功或刷新部分数据，没有把 typed deletion update 应用到精确 Topic/Replies Query cache。 |
| 根因 seam | `src/features/topic/useTopicSessionController.ts` 的 `reply-deleted` action update、列表去重和 composer target 收口。 |
| 必须保持的行为 | 确认删除后从 detail replies 与分页缓存移除目标，回复数最多减一且不小于 0；只有 composer 正指向该楼层时才关闭。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-011` 断言服务器确认后精确 patch detail/replies cache，并仅刷新 Replies Query。 |
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
| 根因 seam | `src/sources/yaohuo/actionClient.ts` 的两阶段删除协议、same-origin confirmation link 与结果分类。 |
| 必须保持的行为 | 只有解析到允许的同源确认链接并完成确认请求后才可报告成功；链接缺失时结果不明/失败，且不得猜 URL 或多发请求。 |
| 精确失败 oracle | `src/sources/yaohuo/actionClient.test.ts` 的 `REG-WRITE-012` 返回含确认文案但无链接的 HTML，要求失败且 fetch 只有一次。 |
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
| 根因 seam | `src/domain/forum/sourceCatalog.ts` 的逐来源、逐 action capability。 |
| 必须保持的行为 | NodeSeek 继续提供已实现的编辑，但在存在可验证删除协议前 fail-closed 隐藏删除；其他来源按各自权限不变。 |
| 精确失败 oracle | `src/domain/forum/sourceCatalog.test.ts` 的 `REG-WRITE-013` 要求 NodeSeek edit=true、delete=false。 |
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
| 根因 seam | `src/sources/nodeimage/upload.ts` 的 asset filename normalization。 |
| 必须保持的行为 | 合法 URI 正常解码；非法 percent sequence 安全回退到原始 basename，并继续后续 MIME/上传校验。 |
| 精确失败 oracle | `tests/integration/image-upload.test.ts` 的 `REG-WRITE-014` 传入 `photo%broken.jpg`，要求不抛错且保留可用文件名。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 真实图片上传会产生远端文件，需单独授权；本轮不执行。 |
| 负向验证方式 | 恢复裸 `decodeURIComponent`，编号测试同步抛出 URIError。 |
| 明确不覆盖范围 | 不绕过文件大小、MIME、站点权限或上传失败处理。 |

## `REG-WRITE-015` NodeSeek 签到复用残留 Topic mutation 身份

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04` |
| 用户症状 | 离开 linux.do、妖火或小隐寺详情后从账号中心执行 NodeSeek 签到，操作可能按上一个 Topic 串行并取消其详情/回复 Query，签到的 mutation 诊断来源也错误。 |
| 触发条件 | 签到复用 Topic action mutation，且优先采用仍保留的 `detail` 作为 source/topic id。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的 TanStack Mutation key/scope 与 NodeSeek 全局账号动作边界。 |
| 必须保持的行为 | 签到始终使用 `forum/nodeseek/mutation/topic/global` key 和 `forum:nodeseek:topic:global` scope，不读取当前或残留 Topic 身份，不取消任何 Topic Query；同一签到串行，其他 Topic mutation 可独立结算。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-015` 在残留 linux.do detail 下执行签到，直接读取 MutationCache，要求固定 NodeSeek/global key 与 scope；旧实现精确收到 linuxdo/42。 |
| 最低可靠自动测试层 | `UI_PASS`：通过真实 QueryClient/MutationCache 固定 mutation 身份。 |
| Replay 或真实验收路径 | 只读离开非 NodeSeek 详情后查看账号中心签到入口；真实签到属于远端写操作，未经单独授权不点击。 |
| 负向验证方式 | 重新用 `detail || nodeseek/global` 选择 action topic，编号测试收到残留来源。 |
| 明确不覆盖范围 | 不执行真实签到，不更改签到协议、幂等性或站点登录规则。 |

## `REG-WRITE-016` 账号状态与 Topic 写入口读取相反的会话投影

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 账号中心显示小隐寺已登录且等级可读，但详情没有回复、点赞等入口；linux.do 已进入验证或失效状态时，详情却仍保留回复入口。 |
| 触发条件 | 账号刷新 Query 已得到新的远端会话状态，而 Topic action controller 仍直接读取授权 workflow 的旧 `SiteSessionStates`。两份投影可以同时给出相反的可写结论。 |
| 根因 seam | `src/features/account/useAccountRuntime.ts` 向 `src/features/topic/TopicRoute.tsx` / `actions/useTopicActionsController.ts` 投影 writable session 能力的边界。 |
| 必须保持的行为 | Topic 写入口只使用账户 Query 与当前验证 workflow 合并后的 `accountSessionViewModels`；验证中、失效或匿名必须撤销该站写入口，确认已登录则开放站点级写能力，再由主题 `can_create_post` 和逐条 `can_*` 权限 fail-closed 收窄。不得新增第三份登录状态或绕过对象权限。 |
| 精确失败 oracle | `src/features/topic/actions/topicActionDecision.test.ts` 固定 unsupported、login-required、identity-pending、object-forbidden、missing-target、already-complete、pending 与 allowed 的唯一判定；`tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-016` 同时构造 workflow 认为 linux.do 可写/小隐寺不可写、账户投影给出相反结果，并固定判定进入唯一 mutation owner。旧实现精确返回 linux.do=true、小隐寺=false。 |
| 最低可靠自动测试层 | `UI_PASS`：用真实 Controller 与合并后的 view model 固定 Topic 可见权限；纯 parser 单测无法暴露跨 Controller 状态分叉。 |
| Replay 或真实验收路径 | 账号中心刷新后分别打开 linux.do 与小隐寺详情；只读核对账号状态、回复入口和原站允许的点赞入口一致。主题或帖子本身不可写时必须继续隐藏对应入口，不发送回复。 |
| 负向验证方式 | 改回从 `effectiveSiteSessionStates` 派生 Topic actions，编号测试会再次得到与账户投影相反的两个布尔值。 |
| 明确不覆盖范围 | 不把“已登录”解释成所有主题都可回复或所有帖子都可点赞；不改变原站权限字段、授权 scope 或写请求协议。 |

## `REG-XIAOYINSI-022` 写操作确认授权失效后不打开重授权

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-06`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 小隐寺操作返回 401，随后 session 复核明确确认已保存授权失效，但 UI 只回滚操作并报错，没有打开重新授权入口。 |
| 触发条件 | action failure handler 能区分复核结果，却只在原错误或读取阶段处理授权 UI。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的小隐寺 action error、authorization recheck 与 auth panel 路由。 |
| 必须保持的行为 | 只有 401/403 且复核明确为未授权时打开授权面板，同时保留原始操作错误和 optimistic rollback；复核仍授权或暂时失败时不得擅自退出。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-XIAOYINSI-022` 固定 action 401 + recheck false 打开授权，并保留 403/recheck true 负向分支。 |
| 最低可靠自动测试层 | `UNIT_PASS`。 |
| Replay 或真实验收路径 | 自然失效时检查授权入口；不得撤销真实授权制造场景，真实写入仍需逐次授权。 |
| 负向验证方式 | 移除 recheck false 的 auth open，编号测试没有入口；把所有 403 都当退出则负向用例失败。 |
| 明确不覆盖范围 | 不自动撤销、删除或重新生成 Device Code，不重试可能非幂等的写请求。 |

## `REG-ACCOUNT-018` 等级刷新失败被保留的旧数据误报为成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04` |
| 用户症状 | linux.do 或小隐寺等级已经成功加载过一次后，再次刷新失败仍提示成功并继续展示旧等级，用户无法知道本次请求失败。 |
| 触发条件 | 同一 Query key 先成功、后 refetch reject；TanStack Query 同时保留可信 `data` 和本次 `error`。 |
| 根因 seam | `src/features/account/useAccountController.ts` 与 `src/features/account/useXiaoyinsiAuthController.ts` 的刷新结果投影先判断 retained data，再判断当前 error。 |
| 必须保持的行为 | 旧等级可继续只读展示，但本次刷新必须返回失败并提示当前错误；不得发成功提示，也不得清除可信旧数据。linux.do 与小隐寺必须保持相同 error-first 语义。 |
| 精确失败 oracle | `tests/ui/account/account-controller.test.tsx` 和 `tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 的 `REG-ACCOUNT-018` 都先成功建立可信等级，再让 refetch 失败；要求保留旧 profile、返回失败并只提示刷新错误。 |
| 最低可靠自动测试层 | `UI_PASS`：必须观察真实 Query 的 data/error 并存状态和 controller 通知结果。 |
| Replay 或真实验收路径 | 账号中心只读展开 linux.do 与小隐寺等级；自然网络失败时核对旧数据与错误并存。不得为制造失败而撤销授权或清登录。 |
| 负向验证方式 | 把刷新逻辑恢复为先依据 `query.data` 返回成功，两个编号测试都会因误报成功或缺失错误提示失败。 |
| 明确不覆盖范围 | 不固定动态等级数值，不把暂时失败解释为退出，也不自动重试或重新授权。 |

## `REG-ACCOUNT-019` 四站登录态投影不一致

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 当前登录已经失效，搜索 transport 已回退 Google，但 More 与搜索状态灯仍显示已登录，Topic 写入口也可能继续开放；公开页里的业务文案或旧 Topic 身份又可能被误当当前用户；修复共享缓存 seam 时还可能把旧登录带进新 generation、回写小隐寺授权 workflow 或误清其他站身份。 |
| 触发条件 | NodeSeek 保存过 userId 且公开资料仍可读取，当前响应同时含明确游客与残留用户字段，真实游客页使用 `/signIn.html`、`/register.html` 而旧 probe 未识别，或弱设置/通知/UID 内容被当当前用户；linux.do 新文档仍收到旧 probe 消息；妖火公开卡片含“我的/欢迎”但没有可信 self-account 结构；站点协议明确返回匿名字段/结构，或成功响应缺少 current user；目标站旧 `account-status` Query 仍有活跃 disabled observer。 |
| 根因 seam | 当前凭据验证与按 ID 公开资料、Topic 身份或 Cookie 候选混用；WebView probe 缺少文档所有权；妖火把业务文字或“未识别为退出”当成功；Discourse reader 没有完整区分明确匿名与协议不确定；Account Query 与 session epoch 更新时序既可能擦掉刚提交的身份结果，也可能通过全局 previous data 保留旧登录。 |
| 必须保持的行为 | 四站 Credential、generation、Account Query 和验证协议继续按站隔离，但遵守同一证据边界：只有当前凭据端点返回当前用户，或站点专属可信账号容器给出明确 self-account 结构，才是 `logged-in`；只有该站协议明确约定的匿名字段、状态或准确游客结构才是 `logged-out`；其他 HTTP 状态、成功但缺字段、普通业务页、CF、超时、网络与解析不确定都是 `unknown`。Cookie、旧 ID、Topic 作者、公开资料和普通“我的/欢迎”文案不是登录证明；明确游客证据优先于同一响应残留 self 字段。NodeSeek 与 linux.do 手动 probe 使用当前文档私有 nonce/documentKey，新文档先作废旧结果；明确 `logged-out` 只更新 App 为失效，不删除原站 Cookie；四站 unknown 均不清理并保留上次可信身份。外部会话变化 reset 目标站 Account Query；查询自身确认失效则先提交 exact expired，再只 seed 该结果到新 scope，普通新 scope 不继承旧登录；小隐寺只读 Account 失效不发布授权 workflow。其他三站 data/error/busy 不变。各站精确状态契约由 `REG-ACCOUNT-025/026` 固定。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/platform/network/loginWebViewScripts.test.ts` 与 `tests/ui/account/account-site-panels.test.tsx` 固定 NodeSeek 公开资料禁用、真实 `.html` 游客结构、明确游客优先级及两站 probe 文档所有权；`src/sources/yaohuo/reader.test.ts` 固定公开卡片/业务文案 unknown；`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/sources/xiaoyinsi/reader.test.ts` 固定 current user、显式匿名与畸形 200 分界；`tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 固定只读检查不发布 workflow；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/integration/query-session-contracts.test.ts` 固定 active disabled Query reset 与 exact expired 新 scope seed；`tests/ui/account/account-status-controller.test.tsx` 固定确认失效提交时序、普通新 scope 不继承旧登录、清理失败和四站 unknown 保留身份；`tests/integration/session-presentation-contracts.test.ts` 同时固定 More 非登录、Search 灯非绿色/Google 文案和 Topic 不可写。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Query observer reset、controller 异步结算和三个消费面的同一投影都必须被观察。 |
| Replay 或真实验收路径 | 保留当前 App 数据，在 NodeSeek 自然掉线时于账号中心刷新；确认 More 未登录/失效、NodeSeek 搜索使用 Google 且灯非绿色、Topic 写入口关闭。另三站只读核对状态不变；不得清 App 数据、主动退出、撤销授权或用写操作制造场景。 |
| 负向验证方式 | 恢复公开资料/Topic/Cookie 兜底、把业务文案或畸形 200 当登录、漏掉各站精确匿名契约、让残留 self/Cookie 覆盖明确游客、跨文档接受旧 probe、让 Account Query 回写小隐寺 workflow、用全局 previous data 保留旧身份、移除精确 reset/seed 或把 reset 扩到全部来源时，对应编号测试分别失败。 |
| 明确不覆盖范围 | 不统一四站验证器，不增加第二套 session store，不后台自动刷新，不绕过 CF，也不人为撤销真实登录或授权。 |

## `REG-ACCOUNT-020` 妖火检测成功但重启后登录丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户已在 App 内妖火页面登录，点击“检测登录”能立即显示真实账号；强制结束并重启 App 后却又变成未登录，后续每次进入都要求重新登录。 |
| 触发条件 | WebView Cookie store 中有当前有效会话，React Native 请求同时携带持久化显式 `Cookie` 和默认环境 CookieJar；检测完成后又从 Cookie store 读取另一份候选并保存。两条 Cookie 传输链可能互相覆盖，而最终持久化候选没有经过同一登录证明。 |
| 根因 seam | `src/sources/yaohuo/reader.ts`、`src/sources/yaohuo/actionClient.ts` 的显式 Cookie 与原生 CookieJar 双重所有权，以及 `src/features/account/useAccountController.ts` 的 verifier 候选与 transport 身份边界。 |
| 必须保持的行为 | 妖火 Cookie 传输只有 Android WebView Cookie store 一个事实来源；React Native 通过只读 CookieJar 在请求时按准确 URL 读取，不接收、保存或回退调用方显式 Cookie header，响应也不能写回。App 候选只用于决定是否运行 verifier、绑定 generation 以及保存 sid/touserid 等协议数据；current-session 响应中的可信 self-account 结构才证明登录，公开资料只补全显示。Cookie 存在本身仍不能证明登录；明确游客只更新 App 投影，unknown 保留可信状态。 |
| 精确失败 oracle | `src/sources/yaohuo/reader.test.ts` 与 `src/sources/yaohuo/actionClient.test.ts` 要求 `credentials: include` 且无显式 Cookie header；生成的 `NetworkProxyRuntimeTest` 固定只读 handler 的准确 URL 读取与响应 no-op；`tests/ui/account/account-controller.test.tsx` 固定 verifier 候选的 generation 所有权；`tests/ui/account/account-status-controller.test.tsx` 要求重启恢复仍调用 current-session verifier；`src/sources/yaohuo/reader.test.ts` 同时固定完整 self-account 导航为登录、部分或公开结构为 unknown。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：需要同时固定 React Native request init、Controller 的异步凭据所有权和重启恢复 Query；源码字符串或 Cookie 名称测试不能替代。 |
| Replay 或真实验收路径 | 保留 App 数据，由用户在 App 内妖火页面手动登录并点击“检测登录”；确认 More 显示真实账号，强制结束并重启后仍显示同一账号。只读核对妖火搜索与 Topic 写入口的权限投影一致，另外三站状态不变；不得由 Agent 输入密码、输出 Cookie 或执行真实站内写入。 |
| 负向验证方式 | 恢复任一显式 Cookie header、让原生响应写回 CookieManager，或用持久化候选替代准确 URL 实时读取；编号测试会暴露双重传输链、原站会话被改写或旧 Cookie 回退。 |
| 明确不覆盖范围 | 不靠 `sidyaohuo` 存在推断登录，不统一四站验证器，不引入新 session store，不自动登录、退出或执行真实回复/收藏/投票。 |

## `REG-ACCOUNT-021` linux.do 已登录但检测只保存验证信息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`MORE-02`、`SEARCH-04`、`WRITE-01` |
| 用户症状 | App 内 linux.do 页面已经显示当前账号，点击“检测状态”却只保存 Cloudflare 验证信息，弹层与其他入口没有同步成已登录；重启后读取账号接口又能显示真实账号。 |
| 触发条件 | WebView 执行当前用户 probe 后，匹配回执晚于固定 250ms 到达；或同站重定向/History 路由使 payload 的 `location.href` 与 React Native 事件 URL 路径不同。Controller 提前清空 active probe 或要求两个 URL 路径逐字一致，随后把残留 Cookie 保存为 verification-only。 |
| 根因 seam | `src/features/account/useVerificationController.ts` 的 WebView probe 发起、当前文档所有权和手动检测结算边界。 |
| 必须保持的行为 | 手动检测只由当前 WebView session、唯一 probeId 和带合法 linux.do origin/timeOrigin 的 documentKey 回执立即结算；React Native 事件 URL 仍须通过 linux.do HTTPS host 门禁，但不得要求它与页面内 `location.href` 路径逐字一致。不得用固定等待提前判定。没有匹配回执时在有界超时后保持 `unknown`，不宣称登录或退出；新文档、关闭面板或新检查必须取消旧 probe，迟到消息不得覆盖当前状态。Cookie 仍只是候选，不能单独证明登录。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 的 `REG-ACCOUNT-021` 让合法 `logged-in` 回执在旧 250ms 窗口之后到达，并让事件 URL 为站点根路径、documentKey 为当前 `/latest` 页面，要求最终 `session-updated.loggedIn === true`；`REG-ACCOUNT-019` 同时固定新文档取消旧 probe，其他无回执用例固定超时为 `unknown`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须观察真实 Controller 的异步 probe 生命周期与 session event；延长固定等待或源码字符串检查不能替代。 |
| Replay 或真实验收路径 | 保留 App 数据，在已自然登录的 linux.do App 内页面点击“检测状态”；确认弹层立即显示已登录，More、Search 灯和 Topic 权限使用同一账号投影。只读验收，不清 Cookie、不退出、不执行站内写入。 |
| 负向验证方式 | 恢复固定 250ms 清空 active probe，或要求 documentKey URL 与事件 URL 路径逐字一致，编号测试都会把有效回执丢弃并得到 `loggedIn: false`；移除 session/documentKey origin 门禁则旧文档或非法来源用例失败。 |
| 明确不覆盖范围 | 不延长任意 sleep，不新增全局状态机，不改变 linux.do 服务端身份协议，不绕过 Cloudflare，也不把 Cookie 存在视为登录。 |

## `REG-ACCOUNT-022` NodeSeek 登录成功后仍回到游客页并反复验证

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02` |
| 用户症状 | 用户在 App 内完成 NodeSeek 账号提交和 Cloudflare 验证，站点已签发新身份 Cookie，却跳回游客首页；再次填入或检测会重新加载 WebView、重新拉起验证，形成“登录成功但仍未登录”的循环。 |
| 触发条件 | WebView Cookie store 同时残留 `.nodeseek.com` 的旧 `session` 与 `www.nodeseek.com` 的新 `session`；专项清理只发送不带 Domain 的过期 Cookie并把 callback 当作完成。用户再次请求填入保存凭据时，递增的 credential attempt 又进入 React key，使当前 WebView 被销毁重建。 |
| 根因 seam | 原生 `clearManagedLoginCookies` 对 Cookie 身份与完成条件的建模，以及登录 WebView 把消息 attempt 错当组件身份。 |
| 必须保持的行为 | NodeSeek 专项清理只处理 `session`、`connect.sid`、`sid`，同时过期当前 host-only 与 `Domain=nodeseek.com; Path=/` 版本；`Domain=.nodeseek.com` 不作为另一种身份重复提交。等待所有 callback 和 `flush` 后从 `www` 与 apex 回读，目标名称仍存在即失败；`cf_clearance`、`pjwt`、其他业务 Cookie和另外三站状态保持不变。NodeSeek 与妖火的 credential attempt 只关联 probe/fill 回执，通过已挂载 WebView ref 注入；只有 renderer 已退出后的显式恢复 key 才能 remount。 |
| 精确失败 oracle | `tests/tooling/release-packaging.test.ts` 与生成原生测试要求 host-only 与显式 parent Domain 的目标身份完整，callback 全部成功但回读仍有登录 Cookie 时必须失败；`src/platform/network/managedCookies.test.ts` 固定 JS 只暴露显式 clear port；`tests/ui/account/account-site-panels.test.tsx` 改变 NodeSeek/妖火 attempt，要求 mount 次数保持 1 且当前 ref 收到新 attempt probe。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Cookie header 与删除回验用 Vitest，React key 对原生 WebView 生命周期的影响用 RNTL mount oracle；源码字符串不能替代。 |
| Replay 或真实验收路径 | 仅在用户授权后清除 NodeSeek 登录 Cookie，确认 `cf_clearance` 与其他三站状态不变；用户在 App 内手动提交账号并完成自然出现的 CF，随后确认原 WebView 不反复重建、原站首页显示登录身份，并用“检测登录”同步 More/Search/Topic。tracked `nodeseek-session.ad` 只核对 App-owned settled、刷新和返回链，不制造掉线或自动输入凭据；真实登录链路需单独报告 `LIVE_PASS` 或 `NOT_VERIFIED`。 |
| 负向验证方式 | 去掉 `Domain=nodeseek.com`、去掉 flush 后回读，或重新把 attempt 拼入 NodeSeek/妖火 WebView key，两个编号测试分别暴露残留 Cookie、假成功或 mount 次数增加；若清理 header 包含 `cf_clearance`，保留验证 Cookie 的断言失败。 |
| 明确不覆盖范围 | 不清 App 数据，不清 Cloudflare Cookie，不修改其他站登录，不自动提交密码，不绕过 Cloudflare，不新增全局登录状态机，也不把 NodeSeek 登录协议改成 VPN/代理或外部浏览器流程。 |

## `REG-ACCOUNT-023` 普通凭据读取把已确认登录降级

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 原站和 More 刚确认已登录，切到 Search 后却立即显示“未登录搜索使用 Google”且状态灯熄灭；Topic 写入口也可能随普通读取关闭。linux.do 隐藏读取和妖火 Cookie 恢复存在同类风险。 |
| 触发条件 | Feed、Search、Topic、categories、启动恢复或隐藏 WebView 为业务读取加载现有 Cookie/SecureStore；调用方没有执行当前账号验证，却把“没有身份结论”编码为 `cookie-loaded.loggedIn: false`。 |
| 根因 seam | `src/features/account/useSessionController.ts` 的被动凭据生产者与 `src/domain/session/siteSessionState.ts` 的身份 reducer 共用一个布尔字段，缺失证明和明确登出没有分开；低可信 Cookie 事实因此覆盖高可信 current-user 结论。 |
| 必须保持的行为 | 四站继续独立，但共享证据优先级：被动凭据观察省略 `loggedIn`，只更新 Cookie 摘要及匿名候选态；已确认的 `logged-in`、`expired`、`verification-required`、`verifying`、`authorizing`、current user 和最后确认时间保持不变。当前账号 API 或可信 self-account probe 明确返回 `true/false` 时仍可按站确认登录或退出；新凭据 `session-updated` 的 transition 语义不变，其他站状态不得受影响。 |
| 精确失败 oracle | `src/domain/session/siteSessionState.test.ts` 的 `REG-ACCOUNT-023` 对四站先建立带 current user 的可信登录，再发送不带 `loggedIn` 的凭据观察，要求身份和确认时间不变；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 直接执行 NodeSeek/妖火普通 credential load 与 linux.do 隐藏 WebView Cookie 刷新，要求诊断 transition 为 `logged-in → logged-in`，且 NodeSeek userId 不被随后清空。修复前六个断言稳定失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须同时覆盖 reducer 证据优先级和真实凭据生产者；只测 UI 刷新、Cookie 名称或源码字符串不能替代。 |
| Replay 或真实验收路径 | 保留当前 App 数据；用户在原站自然登录并于 More 检测为已登录后，依次切到 Search、Feed 和一个只读 Topic，再返回 More。普通读取前后目标站必须保持同一登录投影，另外三站不变；不执行真实写操作。 |
| 负向验证方式 | 让被动 `cookie-loaded` 重新携带 `loggedIn: false`，或让 reducer 把缺失字段当 `false`，四站 reducer、NodeSeek/妖火读取和 linux.do 隐藏读取测试都会重新出现降级。 |
| 明确不覆盖范围 | 不用 Cookie 存在证明登录，不削弱明确登出，不合并四站验证器，不增加第二套 store 或全局状态机，也不自动刷新、绕过 CF 或执行站内写操作。 |

## `REG-ACCOUNT-024` NodeSeek 不存在的当前账号端点触发登录 Cookie 清理

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 原站和账号中心已经显示登录，离开后刷新账号状态却变成失效；再次进入原站发现账号也被退出，用户必须重新登录。 |
| 触发条件 | 有效 NodeSeek 会话刷新账号状态时，代码先请求不存在的 `/api/account/getInfo?readme=1`，原站返回 `404 text/html`；Account refresh 又把该状态直接分类成 typed `login-expired`，随后自动执行 `clear-login-only`。 |
| 根因 seam | 个人中心初版把带 ID 的公开资料路由推测成了无 ID 的当前账号路由，又把未经验证的 HTTP 状态提升为明确游客证据；`src/features/account/useAccountStatusController.ts` 随后正确但破坏性地信任 typed expiry 并清理 Cookie。当前 NodeSeek 前端只用 `/api/account/getInfo/{id}` 读取公开资料，并从页面注入的 `__config__.user` 读取当前用户；日志中 `user GET 404 text/html → clear-login-only → login-cleared → login-expired` 构成完整事故链。 |
| 必须保持的行为 | 当前身份 reader 只读取当前首页/设置页的 `__config__.user` 或专属 self-account 结构，不再请求无 ID `getInfo`，也不使用旧 userId 的公开资料作为证明。只有当前页面准确同时呈现登录、注册游客控件时才抛 typed `login-expired`。页面可证明 current user 时保持登录；HTML 404、CF、网络、超时和解析不确定保持上次可信身份并显示普通错误。任何账号刷新结论都不得调用原站 Cookie 清理；明确游客只更新 App 投影，用户明确清除才执行 host/domain 定向删除。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 的 `REG-ACCOUNT-024` 让首页返回带 `__config__.user` 的可信 current-user 结构，要求只发一次首页请求且不探测任何用户资料路由；修复前稳定多发一次无 ID `getInfo` 请求。`tests/ui/account/account-status-controller.test.tsx` 让普通 404 落在已登录 Account Query 上，要求保留用户和错误，并通过 controller 接口证明刷新路径没有原站 Cookie 清理能力。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：reader 固定证据分类，Controller 固定破坏性调用的负向权限；源码状态码字符串检查不能替代。 |
| Replay 或真实验收路径 | 保留 App 数据和现有 CF Cookie；用户在原站自然登录并于 More 检测成功后执行只读账号刷新，再退出并重新进入 NodeSeek 原站。账号中心、Search、Topic 投影和原站会话都必须保持，不得由 Agent 清 Cookie、输入密码或执行写操作。 |
| 负向验证方式 | 恢复无 ID `getInfo` 探测，reader 的单请求断言会失败；让 Account controller 对普通 404 调用清理，UI 测试会失败。 |
| 明确不覆盖范围 | 不忽略页面明确游客，不用 NodeSeek 的页面规则推断其他三站，不增加额外状态机，不绕过 CF，也不自动登录、退出或提交账号密码。 |

## `REG-ACCOUNT-025` 臆造当前身份接口或失效语义导致误登录/误清理

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户在原站确实已登录，账号刷新却因一个推测接口或未经契约证明的 HTTP 状态变成失效并清掉登录；反向场景中，代码只因为 Cookie、公开资料或普通页面内容存在就显示已登录。妖火已登录时，手动检测还可能被写死的 `sidyaohuo` 名称门禁提前挡住，或只保存数字 ID；已经从当前页证明本人身份后，公开资料补全失败又会错误地把账号打回未登录。 |
| 触发条件 | 开发或测试先编造“当前账号” endpoint/响应，再让生产代码追随 fixture；把 NodeSeek 配置里的任意 `profile/detail/member` 递归当 current user；或把所有站的 401/403/404 统一解释为退出，没有核对站点协议。妖火用 Cookie 名代替服务端当前账号证明、允许 `ok` 无 current user 落盘，或把 current identity 与公开 profile enrichment 组成不可分割的串行成功条件。 |
| 根因 seam | 当前身份 endpoint 的来源门禁、每站登录/退出证据与破坏性清理权限，以及“验证当前凭据”和“读取公开资料”的边界。 |
| 必须保持的行为 | 生产 endpoint 必须能追溯到官方源码/文档、当前站点实际调用或成熟客户端，测试 mock 不能作为接口存在的证据。NodeSeek 当前页只从 `__config__.user` 或专属 self-account 结构证明登录，不递归接受无关嵌入 profile；准确游客控件证明退出，普通 HTTP 状态 unknown。linux.do Cookie 会话只以 `/session/current.json` 的 current user 证明登录，以 Discourse `SessionController#current` 的匿名 404/显式匿名字段证明退出，401/403 unknown。小隐寺 User API 会话以同一端点的 current user 证明登录，只以 Discourse JSON 403 且 `error_type=invalid_access` 或显式匿名字段证明退出；原始 401/403/404、非 JSON 和其他 JSON 错误 unknown，Controller 不能直接解释 transport status。妖火的已支持 Cookie 只作候选，不要求检测前必须存在 `sidyaohuo`；必须由成熟客户端使用的 `wapindex.aspx?sid=-2` 中 `div.top2` 本人导航及 `touserid` 证明登录，adapter 成功却无 current user 仍为 unknown；准确游客 DOM/登录重定向证明退出，401/403/404 unknown。公开资料只做可选补全，站点昵称替换数字 ID 占位，失败保留已证明的最小 current user、报告 partial，且不得调用登录清理。 |
| 来源证据 | Discourse 官方 [`routes.rb`](https://github.com/discourse/discourse/blob/main/config/routes.rb) 声明 `session/current` 与 User API Device Code 路由；[`SessionController#current`](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb) 在无 current user 时返回 404；[`DefaultCurrentUserProvider`](https://github.com/discourse/discourse/blob/main/lib/auth/default_current_user_provider.rb) 对无效 User API Key 抛 `InvalidAccess`；[`api_keys_spec.rb`](https://github.com/discourse/discourse/blob/main/spec/integration/api_keys_spec.rb) 证明 User API Key header 可读取当前 session。妖火成熟 Android 客户端 [`Api.kt`](https://github.com/Townwang/yaohuo/blob/7cda306fb948ea7ba1bedccff0e5c516e4761991/yaohuoApi/src/main/java/com/townwang/yaohuoapi/Api.kt) 使用 `wapindex.aspx?sid=-2` 和 `bbs/userinfo.aspx`，[`LoginModel.kt`](https://github.com/Townwang/yaohuo/blob/7cda306fb948ea7ba1bedccff0e5c516e4761991/app/src/main/java/com/townwang/yaohuo/ui/fragment/login/LoginModel.kt) 从 `div.top2` 的本人链接读取 `touserid`。NodeSeek 当前静态前端 bundle 从 `__config__.user` 读取当前用户，带 ID 的 `getInfo` 只用于公开用户资料。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 用四站真实协议形状固定正向 current identity，拒绝 NodeSeek 无关嵌入 profile，并让 linux.do 官方匿名 404 与非契约 401/403 保持正确分界、妖火资料 503 时仍返回已证明用户；`src/sources/yaohuo/reader.test.ts` 固定妖火 401/403/404 不产生 `loginRequired`；`tests/ui/account/account-controller.test.tsx` 固定任一已支持妖火会话 Cookie 都进入当前账号验证、无 current user 不保存；`src/sources/yaohuo/parser.test.ts` 固定资料昵称替换数字 ID 占位；`src/sources/xiaoyinsi/reader.test.ts` 固定 `invalid_access` JSON 403 才产生 typed expiry，原始 401/403/404、HTML 403 与其他 JSON 403 均 unknown，`tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 固定 Controller 只信 typed expiry；`tests/ui/account/account-status-controller.test.tsx` 固定妖火资料补全失败仍为 logged-in、只提示单站 partial 且零清理调用。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：adapter 固定接口/响应分类，Controller 固定清理权限和可信身份保留。源码 URL 字符串、测试 mock 成功、Cookie 名称或 App 可启动均不能证明当前登录。 |
| Replay 或真实验收路径 | 保留当前 App 数据，在账号中心只读刷新四站：已登录站必须显示服务端/当前页证明的本人身份，普通失败保留上次可信身份并显示错误；More、Search 灯与 Topic 写权限使用同一按站投影。NodeSeek/妖火登录页若需要用户操作，由用户手动完成；不得清 Cookie、撤销授权或执行真实写入制造状态。 |
| 负向验证方式 | 给任一测试虚构 endpoint 并据此改生产实现、递归接受 NodeSeek 无关 profile、把四站状态码统一成 expiry、用 Cookie/公开资料补登录、用 `sidyaohuo` 名称阻止真实验证、允许无 current user 落盘，或让妖火 profile failure 推翻 current identity；对应编号测试必须分别暴露多余请求、错误 `loginRequired`、漏检、假登录或错误清理。 |
| 明确不覆盖范围 | 不统一四站验证器，不增加全局状态机，不自动登录或退出，不绕过 CF，不读取或输出 Cookie/Token，也不执行真实站内写操作。 |

## `REG-ACCOUNT-026` App 快照回灌或自动清理破坏原站 WebView 会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户已经在原站 WebView 登录，账号检测或刷新偶发误判后，重新进入原站发现登录被清掉并被迫反复登录；另一种表现是隐藏 fallback 把 SecureStore 旧 Cookie 作为首跳 header 写回 WebView，使旧会话覆盖当前原站状态。某些账号虽然有可验证候选，却因为缺少一个写死的 Cookie 名而直接显示未登录。 |
| 触发条件 | 检测/刷新/明确过期/写失败调用与“清除登录”相同的原站 Cookie 删除事务；隐藏 NodeSeek/linux.do WebView 的 `source.headers.Cookie` 来自 App 快照；原生桥读取 WebView 私有 SQLite Cookie 数据库；Account Query 先用 `session`、`_t` 等名称门禁，再决定是否请求 current-session verifier。 |
| 根因 seam | 原站 Cookie jar、App 内请求快照和登录投影没有明确所有权；破坏性清理能力被当作身份判定的附带动作；隐藏 WebView transport 暴露 App 快照；Cookie 名摘要被提升为协议结论。 |
| 必须保持的行为 | 原站 WebView Cookie 由网站与 Android `CookieManager` 持有。App 可以只读当前 Cookie 并保存 verifier 候选或 sid/CSRF 等协议摘要，但该快照不承担请求传输。检测、公共刷新、明确过期、fallback 和普通读写失败都不得向原站 WebView 写入或删除 Cookie；只有用户明确点击该站“清除登录”才拥有定向删除权限。NodeSeek 显式清除只删登录 Cookie并保留 CF。NodeSeek/linux.do 隐藏 fallback 首跳只传 URL，不能携带 App 快照 Cookie；原生 RN 请求按准确 URL 实时读取，响应保存为 no-op。原生桥只用公开 CookieManager API，不读取私有数据库。四站 Cookie 名只作候选摘要：存在本站候选时必须交给该站真实 current-session verifier，由 current user/明确匿名/unknown 决定身份。 |
| 来源证据 | Android 官方 [`CookieManager`](https://developer.android.com/reference/android/webkit/CookieManager) 是应用 WebView 使用的单例 Cookie 管理器；React Native WebView 的 [`Managing Cookies`](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md#managing-cookies) 明确 `source.headers.Cookie` 只影响首个请求，不能作为持续 Cookie 同步方案。成熟客户端把验证当前凭据与显式登出/移除账号分开：Mastodon Android 的 [`GetOwnAccount`](https://github.com/mastodon/mastodon-android/blob/master/mastodon/src/main/java/org/joinmastodon/android/api/requests/accounts/GetOwnAccount.java) 与 [`GetAccountByID`](https://github.com/mastodon/mastodon-android/blob/master/mastodon/src/main/java/org/joinmastodon/android/api/requests/accounts/GetAccountByID.java) 分离，Tusky 的 [`MastodonApi`](https://github.com/tuskyapp/Tusky/blob/develop/app/src/main/java/com/keylesspalace/tusky/network/MastodonApi.kt) 也区分 verify credentials 与按 ID 公开资料。 |
| 精确失败 oracle | `tests/ui/account/hidden-browser-host.test.tsx` 断言 NodeSeek/linux.do WebView source 没有 App Cookie header；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 断言公开 request view 不暴露快照；`tests/tooling/release-packaging.test.ts` 固定原生桥只使用公开 `CookieManager` API并禁止 `SQLiteDatabase`/私有 WebView 路径；`tests/ui/account/account-controller.test.tsx`、`src/features/account/useVerificationController.test.ts` 固定明确 logged-out 只更新投影而不删除；`tests/ui/account/account-status-controller.test.tsx` 固定 linux.do `_forum_session` 即使没有 `_t` 也由 current-session 响应决定身份。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生生成/编译：需要同时观察 controller 权限、WebView props、共享 CookieManager barrier、生成 Kotlin API 边界和 current-session Query，源码字符串不能单独证明运行行为。 |
| Replay 或真实验收路径 | 保留当前 App 数据，用户在 App 内原站自然登录并手动检测；依次只读刷新 More、Search、Feed/Topic 后再次打开原站，登录不得被自动删除。隐藏 fallback 只有在来源自然触发时核对；不得清 App 数据、主动退出、撤销授权或为制造 challenge 反复登录。 |
| 负向验证方式 | 向隐藏 WebView 恢复 `headers.Cookie`、在检测/过期分支重新调用任一原站清理函数、恢复私有 SQLite Cookie 读取，或用 `summary.loggedIn` 阻止已有候选进入 verifier；对应编号测试必须失败。 |
| 明确不覆盖范围 | 不把 App 改成浏览器账号管理器，不同步跨应用 Cookie，不统一四站验证器，不新增全局状态机，不绕过 CF，也不执行真实站内写操作。 |

## `REG-ACCOUNT-027` React Native 请求隐式读写 WebView CookieJar

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | App 读取原站 Cookie 发起请求后，服务端响应的 `Set-Cookie` 又经 React Native 默认 CookieJar 改写 WebView 会话，导致账号状态、原站页面和后续请求相互污染。若为隔离 Cookie 另建 client，还可能绕过代理 fail-closed 与既有连接资源。 |
| 触发条件 | React Native 使用 `credentials: include` 时沿用默认双向 `ForwardingCookieHandler`；它既从 `CookieManager` 读取，也把响应 Cookie 写回。此前改为 `omit` 虽阻止写回，却同时关闭了官方按 URL 自动读取。 |
| 根因 seam | `src/platform/network/request.ts` 的 credentials 边界与 `plugins/withNetworkProxyModule.js` 生成的共享 OkHttp client 没有共同表达“只读 WebView CookieJar”。 |
| 必须保持的行为 | 所有经过 `fetchWithTimeout` 的 React Native 请求最终强制 `credentials: 'include'`，使 NetworkingModule 沿用受管 client；该 client 安装的 `ReadOnlyWebViewCookieHandler` 允许受管域按 URL 读取，但 `put`/`saveFromResponse` 永远 no-op。method、body、非 Cookie header、AbortSignal 和诊断 fetcher 保持原样。WebView 页面内部站点脚本继续自行管理会话。请求仍先经过 `networkProxyFetcher` 的 load/apply fail-closed 门禁，并复用原 `ProxySelector`、dispatcher 和 connection pool，不另建绕过代理的 client。 |
| 来源证据 | Android [`CookieManager.getCookie(url)`](https://developer.android.com/reference/android/webkit/CookieManager#getCookie(java.lang.String)) 按具体 URL 返回 Cookie；[`React Native 0.81.5 NetworkingModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt) 在关闭 credentials 时替换为 `CookieJar.NO_COOKIES`；默认 [`ForwardingCookieHandler`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/ForwardingCookieHandler.kt) 同时实现读写；OkHttp [`CookieJar`](https://square.github.io/okhttp/5.x/okhttp/okhttp3/-cookie-jar/) 将请求加载与响应保存分开。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 让调用方传入 `credentials: omit`、body、header 和父 signal，要求最终 fetcher 覆盖为 `include` 且其余输入保持；生成的 `NetworkProxyRuntimeTest` 把响应 `Set-Cookie` 交给只读 handler，要求零写入；`tests/ui/more/network-proxy-controller.test.tsx` 阻塞 native proxy apply，要求 apply 前零 transport、完成后仍由同一 `networkProxyFetcher` 发出。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生生成/编译：request 单测固定最终参数，Kotlin 行为测试固定响应 no-op 与同 client 资源，代理 controller 固定 apply 顺序；源码字符串不能单独证明 Cookie 不写回。 |
| Replay 或真实验收路径 | 保留 App 数据与原站会话，从 More 确认账号后依次只读进入 Search、Feed、Topic，再返回原站 WebView，原站身份不得改变。真实代理只在用户提供并明确授权配置时验证；否则代理 Live 记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复默认 `ForwardingCookieHandler`、实现非空 `put`、允许调用方 `omit` 关闭受管 jar，或改为平行 client/global fetch；Kotlin、request 或代理组合测试必须分别观察到响应写入、Cookie 自动读取丢失或 apply 前 transport。 |
| 明确不覆盖范围 | 不清 App 数据或 Cookie，不改 WebView 页面内 fetch，不新增代理实现，也不在没有授权配置时连接真实代理。 |

## `REG-ACCOUNT-028` 空凭据被动读取误清可信身份

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 已在 More 确认登录后，旧实现的普通读取恰好没有从 CookieManager/旧 SecureStore 快照取得值，账号状态会先变成需要验证、再变成未登录；current user、确认时间和私有 Query scope 一并丢失。 |
| 触发条件 | 被动 `loadNodeSeekCookieForSource` 得到空值后发布 `cleared`；保存空摘要的共用 helper 又把“没有可保存快照”发布成 `verification-required`，把观察不到凭据误当成身份结论。 |
| 根因 seam | `src/features/account/useSessionController.ts` 的 NodeSeek 凭据持久化、被动观察和身份投影共用同一副作用分支；`cleared` 没有限定为用户明确清除事务。 |
| 必须保持的行为 | 被动加载或保存空 NodeSeek 快照只返回 `undefined`/发布不带 `loggedIn` 的观察事件，不得发布 `verification-required`、`login-expired` 或 `cleared`；已有 `logged-in`、`expired`、`verification-required`、current user、最后确认时间和 Query scope保持不变。只有 current-page verifier 可以发布登录结论；`cleared` 只来自用户明确清除且 multi-store 事务成功。 |
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 的 `REG-ACCOUNT-028` 先建立带 current user 与确认时间的 NodeSeek 登录态，再让 SecureStore/CookieManager 都返回空并执行被动加载；要求唯一 transition 为 `cookie-loaded: logged-in → logged-in`、userId 不清空且没有 Query scope 失效。修复前稳定出现 `verification-required` 与 `cleared` 并降级到 anonymous。既有手动清除测试继续要求成功事务发布 `cleared`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须直接执行真实 controller 分支并观察 session transition、身份副作用和 Query scope；只测 reducer 或 Cookie parser 不足。 |
| Replay 或真实验收路径 | 保留当前 App 数据，在 More 已确认 NodeSeek 后依次进入 Search、Feed、Topic 并返回账号中心；自然发生空快照时仍保持同一可信身份。不得清 Cookie 或重新登录制造空值。 |
| 负向验证方式 | 在空快照分支恢复 `cleared`/`verification-required`，或让观察事件携带 `loggedIn:false`；编号测试必须再次看到身份、current user、确认时间或 scope 被降级。 |
| 明确不覆盖范围 | 不把空快照当登录成功，不削弱 current-page 明确游客结论，不改变用户显式清除的定向过期与回读确认，也不新增第二套 Session store。 |

## `REG-ACCOUNT-029` 手工 Cookie 白名单破坏原生请求身份完整性

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | App 冷启动后 Feed、Categories 或账号读取明明处于原站登录会话，却更频繁收到 403/Cloudflare 并进入缓慢 WebView fallback；去 More 刷新后表面恢复，但 direct request 仍可能失败。受保护图片、视频或保存下载也可能因另一份旧 Cookie header 表现不同。 |
| 触发条件 | React Native 关闭环境 CookieJar 后，由 JavaScript 根据已知名称手工拼接持久化 Cookie；新 Cookie、HttpOnly、Domain、Path、Secure、子域与重定向选择无法等价于 WebView 针对当前 URL 实际会发送的 header，实时为空时还可能回退旧值。 |
| 根因 seam | `fetchWithTimeout`、NodeSeek/linux.do/妖火 source/action clients、媒体 transport 与 Android `CookieManager` 之间存在多份 Cookie 传输所有者。 |
| 必须保持的行为 | WebView CookieJar 仍是三站请求 Cookie 的唯一事实来源。普通 source/action 请求由 `ReadOnlyWebViewCookieHandler` 调用 `CookieManager.getCookie(准确完整 URL)`；不按名称过滤、清洗、重组或缓存，由平台处理 Domain、Path、Secure 和重定向。只允许 HTTPS 且无 userinfo 的 `nodeseek.com`、`linux.do`、`yaohuo.me` 及子域；合法空值按无 Cookie 请求，读取异常明确失败且不得回退历史快照。响应保存为 no-op。RN source/action clients 不设置 `Cookie` header；CSRF、sid、touserid 等非 Cookie 协议字段保留。Xiaoyinsi 继续使用 API key/Auth，不注入 WebView Cookie。媒体延续本条“零 JS Cookie header/零快照”的历史保证，但具体授权已由 `REG-TOPIC-029` 取代旧 Expo Video bridge：HTTP(S) 受管媒体携带内部内容来源 marker 与 opaque identity，原生在发网前移除两个内部头；同来源首跳才可实时读 Cookie，跨来源、未受管、无效 marker 或媒体 Cookie 读取异常继续匿名加载，重定向离源后永久降权。RN Networking、Fresco、Expo Image 与 Expo Video 复用项目配置的 managed client。 |
| 来源证据 | Android [`CookieManager.getCookie(url)`](https://developer.android.com/reference/android/webkit/CookieManager#getCookie(java.lang.String)) 提供按 URL 的平台选择；React Native [`NetworkingModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt) 只有在 credentials 开启时才沿用 client CookieJar；OkHttp [`JavaNetCookieJar`](https://square.github.io/okhttp/5.x/okhttp-java-net-cookiejar/okhttp3.java.net.cookie-jar/-java-net-cookie-jar/) 可把单向 `CookieHandler` 接入同一 client。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest` 传入带 path/query 的准确 URL 和未知 Cookie 名，要求完整返回；固定 HTTP、userinfo、相似域与非受管域不读取，普通请求的 reader 异常向请求传播，响应不写入，并证明 managed client 与代理共用 selector/dispatcher/pool。同一原生测试另固定媒体 marker 在发网前移除、跨来源/无效 marker/Cookie 读取异常时匿名继续、离源后跳回仍不恢复。`src/platform/network/request.test.ts` 要求最终 `credentials: include`；NodeSeek/linux.do/妖火 source/action 测试要求零手工 Cookie header；`tests/tooling/release-packaging.test.ts`、`tests/tooling/network-proxy-plugin.test.ts` 和 `tests/ui/topic/topic-image-loading.test.tsx` 固定 Expo Image/Video managed client 接线、内部 marker 与 JS 零 Cookie。修复前分别表现为 `credentials: omit`、白名单 header 或独立媒体 client。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生 Release JUnit/Kotlin compile + fresh prebuild；逐调用方源码搜索只作为补充门禁。 |
| Replay 或真实验收路径 | 保留四站现有登录与 App 数据，连续三次 force-stop 冷启动；不进入 More 即观察 Feed/Categories direct 请求，再只读进入 Search、Topic、More 与三站原站 WebView，确认身份一致且原站 Cookie 未被响应改写。记录 direct/fallback、状态码和 challenge 分类，不记录 Cookie 值。真实代理仅在用户提供并明确授权配置时验证。 |
| 负向验证方式 | 恢复任一 source/action/media 的手工 Cookie header、按 Cookie 名白名单过滤、在空实时值时回退快照、让 handler 保存响应，或给媒体另建不受管 client；对应测试必须失败。 |
| 明确不覆盖范围 | 不保证完整 Cookie 一定绕过 Cloudflare；clearance 仍可能绑定 User-Agent、代理或动态风险。若准确 URL Cookie、当前 WebView UA 与相同代理下 challenge 频率仍相近，停止叠加重试/规则并重新评估 WebView-primary 或独立 App 会话。 |

## `REG-ACCOUNT-030` React Native/Fresco 替换只读 CookieJar

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-02`、`USER-01`、`ACCOUNT-01`、`MORE-01`、`WRITE-01` |
| 用户症状 | 当前 Android 包连接 Metro 后在 `MainActivity` 显示 “There was a problem loading the project”，堆栈为 `JavaNetCookieJar cannot be cast to CookieJarContainer`；若只换成默认可变容器规避崩溃，RN/Fresco 又会恢复可写 `ForwardingCookieHandler`。 |
| 触发条件 | App 把裸 `JavaNetCookieJar` 安装到 `OkHttpClientProvider` 的全局 client；Fresco 启动时强转 `CookieJarContainer` 并调用 `setCookieJar`，NetworkingModule 初始化/销毁时也会 set/remove。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的共享 OkHttp client 同时承担 RN Networking、Fresco、Expo Image、代理和 WebView Cookie 只读边界，却没有满足 RN 的容器生命周期契约。 |
| 必须保持的行为 | 全局 managed client 的 Jar 必须实现 `CookieJarContainer`，但 `setCookieJar` 与 `removeCookieJar` 不能替换或移除 App 的只读 delegate；请求加载与响应保存继续经过 `ReadOnlyWebViewCookieHandler`，因此响应保持 no-op。不得 fork React Native 或给 Fresco 建平行 client。 |
| 来源证据 | React Native 0.81.5 的 [`FrescoModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/fresco/FrescoModule.kt)、[`NetworkingModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt) 与 [`CookieJarContainer`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/CookieJarContainer.kt) 明确规定了该强转及 set/remove 生命周期。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest` 要求 managed client CookieJar 是 `CookieJarContainer`，再以 `CookieJar.NO_COOKIES` 调用 `setCookieJar` 并调用 `removeCookieJar`，准确 URL 仍必须加载原只读 delegate 的 `session`。修复前前一断言失败，设备启动出现同一 ClassCastException。 |
| 最低可靠自动测试层 | 原生 Release JUnit + Kotlin compile + fresh prebuild；覆盖安装后还要形成无 RedBox/ClassCastException 的 `APK_SANITY`。 |
| Replay 或真实验收路径 | 覆盖安装保留数据，连接 Metro 后启动到首页；随后 force-stop 冷启动并进入含远端图片的 Feed/Topic，确认 App 可用且原站 WebView 会话未被响应改写。 |
| 负向验证方式 | 恢复裸 `JavaNetCookieJar`，或让容器接受 RN/Fresco 传入的新 Jar；定向测试或设备启动必须再次失败。 |
| 明确不覆盖范围 | 不修改 React Native/Fresco 源码，不新增第二个网络 client，也不改变用户显式清除 Cookie 的事务。 |

## `REG-ACCOUNT-031` 登录页面打开即破坏会话，关闭后又继续信任旧账号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`ACCOUNT-06`、`FEED-01`、`FEED-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 用户症状 | 只要进入登录/验证页，原本有效的 WebView 登录态就被 App 清除或旧快照覆盖；反过来，用户在页面内退出或切换账号后直接关闭，账号中心、私有缓存和写入口仍继续信任旧账号，直到手动点击检测。 |
| 触发条件 | 打开 NodeSeek、linux.do、妖火或 NodeImage surface；通过关闭按钮、系统返回、离开 More、切换登录站点、NodeImage 取消/成功退出；linux.do 因 App inactive 暂时卸载 WebView；或旧 probe 在新 surface generation 之后迟到。 |
| 根因 seam | 登录 surface 生命周期、Account identity、WebView Cookie 所有权、Query cache scope 与写权限分别维护；打开页面被误当成登出事务，关闭页面又没有强制 identity reconciliation。 |
| 必须保持的行为 | 打开 surface 只建立含 source/surface/generation/打开时 identity 与 epoch 的 ticket，暂停该站新私有请求和写入，不清 Cookie、不改 identity、不删除可信缓存。只有 surface 确实可见时关闭才异步对账；UI 立即消失，不等待网络。重复关闭 no-op，linux.do inactive 不是关闭，权威检测后的自动关闭不重复 probe。NodeSeek、linux.do、妖火分别使用严格三态 verifier；unknown 保留旧可信账号和已加载内容只读并维持 barrier。A→A 仅解除 barrier；A→B、A→anonymous、anonymous→B 原子提交 Account Query、递增目标站 epoch，并清理该站及 `all` 私有 Query、Level/AI、Topic 服务端内容和媒体身份缓存；其他站不变。旧 probe 只能提交给自己的 generation。 |
| 来源证据 | Android [`CookieManager`](https://developer.android.com/reference/android/webkit/CookieManager) 明确 `getCookie(url)` 是按 URL 读取，而 `flush()` 是阻塞持久化操作；[RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265) 规定 user agent 负责 Domain、Path、Secure 与 Cookie 顺序。TanStack Query 官方 [Query Keys](https://tanstack.com/query/v5/docs/framework/react/guides/query-keys) 与 [Query Cancellation](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation) 要求响应依赖进入 key，取消由 queryFn 消费 `AbortSignal`。 |
| 精确失败 oracle | `src/domain/session/authSurfaceCoordinator.test.ts` 固定所有关闭原因、hidden/no-op、switch-surface、inactive 与 generation；`src/platform/network/managedCookies.test.ts` 固定 exact URL、空值/错误分离、只读与显式清除端口；`src/sources/nodeseek/session.test.ts`、`src/sources/linuxdo/session.test.ts`、`src/sources/yaohuo/session.test.ts` 固定三态证据，`src/platform/network/loginWebViewScripts.test.ts` 额外固定 login 路径的错误/半加载页仍为 unknown；`tests/ui/account/account-status-controller.test.tsx` 固定 A→A/A→B/A→anonymous/unknown、single-flight 与迟到 probe；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/integration/query-session-contracts.test.ts` 固定原子 seed、source/`all` 清理和 epoch key；Feed UI 固定其他来源完成刷新后仍合并同 epoch dirty 来源的旧可信条目、换 epoch 后停止合并；User UI 固定 route 只保留定位字段且不回显旧头像/简介/等级/活动；Search/Topic/Account UI 固定 barrier 下只读保留、其他来源继续与 epoch 后不复用旧服务端数据；`src/platform/media/mediaSessionEpoch.test.ts` 及媒体 UI 测试固定 cacheKey/player 随 epoch 重建。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生 Release JUnit/Kotlin compile；reducer、Query transaction、surface RNTL 与生成原生边界必须组合覆盖。 |
| Replay 或真实验收路径 | 覆盖安装同 revision release APK 且不清 App 数据；在已登录 NodeSeek、linux.do、妖火分别验证打开不退出，关闭按钮、系统返回、离开 More 和切站均自动 A→A 对账。NodeImage 只验证取消和已有 Key 恢复。A→B、真实退出和清除 Cookie 需用户另行授权，未执行时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一 surface open 分支调用 clear/flush/写 Cookie，关闭时省略 reconciliation，把 unknown 提交成 anonymous，让 hidden close 重复 probe，或让旧 generation 覆盖新 Account key；编号测试必须分别观察到清理调用、错误身份、重复请求或跨 epoch 缓存。 |
| 明确不覆盖范围 | 不改变小隐寺 Device Code 协议，不把账号密码自动填入当作 Cookie，不跨应用同步 Cookie，不自动退出/换号，也不执行真实论坛写入。 |

## `REG-ACCOUNT-032` 妖火已登录会话在身份核对时打开登录页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 账号中心仍显示妖火用户名和已登录状态，点入后却先打开登录页；点击“检测登录状态”后页面立即恢复为“我的地盘”。 |
| 触发条件 | 已确认的妖火账号打开登录 surface；surface ticket 将 `identityTrust` 置为 `pending` 并临时关闭写权限。 |
| 根因 seam | `src/features/account/components/YaohuoLoginHost.tsx` 用 `canWrite` 选择登录页或会话页，把“身份核对期间禁止写入”误当成“已经退出”。 |
| 必须保持的行为 | `pending` 期间继续显示上次确认身份并打开妖火会话页，但所有写操作和新的单站私有请求仍由 identity barrier 暂停；明确匿名或失效才打开登录页，用户选择账号密码填入时仍进入登录表单。 |
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 的 `REG-ACCOUNT-032` 构造 `isLoggedIn=true`、`canWrite=false`、`identityTrust=pending` 的妖火会话，要求 WebView 首个 URL 为 `/wapindex.aspx?sid=-2`；旧实现得到 `/waplogin.aspx`。 |
| 最低可靠自动测试层 | `UI_PASS`：需要渲染真实 panel 并读取 WebView source，纯 view-model 测试不能证明页面选址。 |
| Replay 或真实验收路径 | 保留自然妖火登录态，从账号中心点入妖火；首屏应直接进入会话页，点击检测仍保持同一账号。不得为了验收清 Cookie。 |
| 负向验证方式 | 恢复用 `canWrite` 选择 URL，编号测试会在 pending 时重新收到登录页 URL。 |
| 明确不覆盖范围 | 不放开 pending 期间的写权限，不把旧身份当作本次远端核对结果，也不改变明确退出后的登录页。 |

## `REG-ACCOUNT-033` 妖火匿名 Cookie 被误判为清理失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 用户点击“清除登录”后收到“登录 Cookie 删除未确认”，但妖火匿名页面会继续保留或重建会话辅助 Cookie。 |
| 触发条件 | 定向过期妖火 Cookie 后，`CookieManager.getCookie()` 仍返回 `ASP.NET_SessionId`、`GUID`，或匿名值 `sidyaohuo=-2`。 |
| 根因 seam | 原生清理事务把三个目标 Cookie 名“全部消失”当作退出 oracle，没有区分认证标记与匿名会话辅助 Cookie。 |
| 必须保持的行为 | 继续在 `www`/apex、host-only/domain、`Path=/` 上定向过期 `sidyaohuo`、`ASP.NET_SessionId`、`GUID`，等待异步回调并 `flush()`；回读时只有非空且不为 `-2` 的 `sidyaohuo` 仍存在才判定未清除。不得清理其他站点 Cookie，也不得使用 WebView 私有数据库。 |
| 来源证据 | Android [`CookieManager.setCookie`](https://developer.android.com/reference/android/webkit/CookieManager#setCookie(java.lang.String,java.lang.String,android.webkit.ValueCallback%3Cjava.lang.Boolean%3E))、[`getCookie`](https://developer.android.com/reference/android/webkit/CookieManager#getCookie(java.lang.String)) 与 [`flush`](https://developer.android.com/reference/android/webkit/CookieManager#flush()) 给出公开能力边界；[`react-native-cookies`](https://github.com/react-native-cookies/cookies/blob/a845ae2e8af8a0dbfed316562fd54b624ac4869a/android/src/main/java/com/reactnativecommunity/cookies/CookieManagerModule.java) 也明确 Android 不提供按名称删除单个 Cookie 的 API。妖火匿名响应实测会设置 `ASP.NET_SessionId`、`GUID`，`sid=-2` 会设置 `sidyaohuo=-2`。 |
| 精确失败 oracle | fresh prebuild 生成的 `NetworkProxyRuntimeTest.regAccount033YaohuoAnonymousCookiesDoNotBlockLoginCookieCleanup` 要求只有辅助 Cookie、或再带 `sidyaohuo=-2` 时均为未登录；非 `-2` 的 `sidyaohuo` 必须继续阻止成功。旧实现没有该认证标记判定，并会因任一辅助 Cookie 名存在而失败。 |
| 最低可靠自动测试层 | 原生 Debug JUnit/Kotlin compile + fresh prebuild；最终覆盖安装后另做用户授权的真实清理才是 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 仅在用户明确同意清除妖火登录态时点击“清除登录”，确认提示成功、账号投影转匿名、重新进入妖火显示登录页；NodeSeek 与 linux.do 登录保持不变。未授权时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 让 `ASP.NET_SessionId`、`GUID` 或 `sidyaohuo=-2` 任一名称阻止成功，原生编号测试或真实匿名回读会再次失败；让非 `-2` 的 `sidyaohuo` 通过则测试反向失败。 |
| 明确不覆盖范围 | 不保证网站未来永不更换认证协议；若非 `sidyaohuo` 也能独立证明当前账号，必须先取得原站协议证据并升级 verifier，不能继续按 Cookie 名猜测。 |

## `REG-ACCOUNT-034` 妖火旧版 www domain Cookie 未被清除

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 点击“清除登录”后提示删除未确认；随后点击“检测登录”，远端页面立即恢复为原登录账号。 |
| 触发条件 | WebView Cookie 库保留由旧页面写入的 `.www.yaohuo.me` domain Cookie；清理函数只写 host-only 过期 Cookie和 `Domain=yaohuo.me`。 |
| 根因 seam | `clearManagedLoginCookies` 没有为 `Domain=www.yaohuo.me` 写同名过期 Cookie，因此有效 `sidyaohuo` 继续随 `www.yaohuo.me` 请求发送。 |
| 必须保持的行为 | 妖火清理同时覆盖 `www`/apex 的 host-only Cookie、`Domain=yaohuo.me` 以及仅在 `www` URL 上合法的 `Domain=www.yaohuo.me`；仍然只清理妖火的登录 Cookie，不使用 `removeAllCookies()`，不影响其他站点。 |
| 来源证据 | 用户两份诊断中妖火清理共七次均失败；09:19:06 清理后本地会话先转 anonymous，09:19:10–11 远端检测成功，诊断最终状态仍为 logged-in。模拟器只读 Cookie 元数据显示 `sidyaohuo` 同时存在 `.www.yaohuo.me`、`.yaohuo.me`、`www.yaohuo.me`、`yaohuo.me` 四种作用域，旧清理计划唯一遗漏 `.www.yaohuo.me`；全程未读取或记录 Cookie 值。 |
| 精确失败 oracle | fresh prebuild 生成的 `NetworkProxyRuntimeTest.regAccount034YaohuoClearCoversLegacyWwwDomainCookies` 要求清理计划包含 `https://www.yaohuo.me/` + `Domain=www.yaohuo.me` 的 `sidyaohuo` 过期写入，同时不得从 apex URL 写入不合法的 `www` domain。旧实现测试失败。 |
| 最低可靠自动测试层 | 原生 Debug JUnit/Kotlin compile + fresh prebuild；真实手机清理仍需安装包含修复的 Debug 包后复现才是 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 在可复现手机安装修复包，点击一次“清除登录”，再点“检测登录”；必须保持匿名并打开登录页。该操作会真实退出妖火，需用户明确执行；不清其他站点。 |
| 负向验证方式 | 从清理计划移除 `www.yaohuo.me` domain，编号测试立即失败；若补齐后真机仍恢复登录，则转而验证是否有第二认证 Cookie 或站点存储重新签发，不得继续猜名称。 |
| 明确不覆盖范围 | 当前证据没有证明 `GET45245` 等其他 Cookie 是认证标记，因此不扩大删除名单；不操作 WebView 私有数据库，不全量清 Cookie。 |

## `REG-ACCOUNT-035` Account 已结算但请求仍读取旧身份，验证恢复先重试后关闭

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 用户症状 | 登录/验证已经确认同一账号或新账号，紧接着恢复的读取或写入仍看到旧 identity/epoch；linux.do/NodeSeek 面板还可能在原 Query 已恢复时继续挂载，使恢复请求再次落入登录 surface。 |
| 触发条件 | Account probe Promise 完成与 React effect/ref 提交之间发起恢复；或验证成功回调先调用 `refetch/fetchNextPage`，随后才关闭并卸载 WebView。 |
| 根因 seam | canonical Account Query、runtime identity ref、auth surface registry 和恢复回调分别结算，没有一个同步的请求时刻快照；UI 可见性被误当作事后清理而不是恢复前屏障。 |
| 必须保持的行为 | `SessionRuntimeSnapshot` 同步包含 identity、epoch、pending、auth surface 和 mode。probe 开始及 canonical same/changed/anonymous commit 必须先同步 runtime，再完成 Promise；verification workflow 只在 pending 时拥有可见状态，结算后 Account Query 恢复为唯一身份事实。NodeSeek、linux.do 都必须先关闭并卸载面板，再恢复原 Query；关闭到 renderer 真正卸载之间继续保持短暂 recovery barrier。changed 只导航到新 epoch，不重放旧身份请求；unknown/stale 保持原错误与只读状态。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 要求 reconciliation Promise resolve 时 runtime 已是新 identity 且 `pending=false`，并要求旧 verification 状态在 canonical settle 后释放；`tests/ui/account/account-controller.test.tsx` 返回完整 NodeSeek 对账结果；`src/features/account/useVerificationController.test.ts` 固定 linux.do close-first 恢复、barrier 和 original Query outcome；Feed/Search/Topic/User consumer 测试用新 epoch canary 要求零旧 scope 落地。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯状态 helper 固定恢复结果，RNTL 固定 Account/验证 hook 的 Promise、卸载和 Query 生命周期。 |
| Replay 或真实验收路径 | 保留现有登录态，自然遇到或手动打开登录/验证页后只执行账号检测与只读请求；确认面板先消失，随后原页面只恢复一次，A→A 不丢内容，换号/退出须另获授权。 |
| 负向验证方式 | 把 runtime 更新移回 effect、让 Promise 先 resolve，或恢复回调先于 surface close；编号测试必须观察到旧 identity/epoch、重复请求或面板仍挂载。 |
| 明确不覆盖范围 | 不自动处理 Cloudflare、不重试非幂等写入、不以关闭 UI 证明登录成功，也不授权换号、退出或真实写操作。 |

## `REG-ACCOUNT-036` 妖火多 scope SID 选择了匿名值或错误账号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`WRITE-01`、`WRITE-02` |
| 用户症状 | 妖火 Cookie header 同时含 host/domain scope 的多个 `sidyaohuo` 时，回复或删除可能拿到空值、匿名 `-2`，或任意选择一个冲突的有效 SID。 |
| 触发条件 | `CookieManager.getCookie(准确 action URL)` 返回重复同值、空值、`-2` 与有效值混合，或两个不同的有效 SID；旧 parser 只取第一个匹配项。 |
| 根因 seam | `extractYaohuoSid` 没有把匿名辅助值、重复 scope 和冲突身份分开，request builder 在未建立唯一 owner 时继续生成 transport。 |
| 必须保持的行为 | Cookie 名大小写不敏感；忽略空值和 `-2`，重复的同一有效 SID 合并。恰好一个有效值才可生成请求；两个不同有效值本地失败，回复与删除均保持零 transport。reply body 与 delete URL 使用同一个唯一 SID。 |
| 精确失败 oracle | `src/sources/yaohuo/actionRequest.test.ts` 的 `REG-ACCOUNT-036` 固定空/匿名混合、同值重复、冲突有效 SID，以及回复 body/删除 URL 的唯一 SID 传播；冲突时两个 action client 都不得被调用。 |
| 最低可靠自动测试层 | `UNIT_PASS`：这是确定性的 Cookie trust-boundary parser 与 request builder，fixture 必须直接覆盖无效输入和零 transport。 |
| Replay 或真实验收路径 | 默认不执行回复或删除。仅在用户逐次授权真实写入时，从原生准确 action URL 读取当前 Cookie 并记录成功/本地冲突，不输出 SID 值。 |
| 负向验证方式 | 恢复“取第一个”或接受 `-2`，编号测试会生成错误请求；把冲突降级为空 SID 则零 transport/错误断言失败。 |
| 明确不覆盖范围 | 不猜测多个不同有效 SID 中哪个更新，不清 Cookie、不自动登录，也不改变妖火服务端会话协议。 |

## `REG-ACCOUNT-037` 可读公开页让真实未登录账号长期停在 unknown

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 全新隔离 AVD 没有论坛登录数据，NodeSeek 与妖火公开页面都能正常打开，但账号中心长期显示“登录状态待确认”；未登录 Replay 在进入搜索前即失败，NodeSeek 的 Google fallback 和妖火的登录限制均无法按权威匿名态分流。 |
| 触发条件 | NodeSeek direct SSR 先返回可读帖子列表但不含 hydration 后的登录/注册控件；即使正确进入隐藏 WebView，若只在 `onLoadEnd` 注入身份证据脚本，慢子资源会让外层 15 秒 transport 上限先到，脚本从未开始。脚本开始后若仍复用普通 ready 条件，也可能在 `.post-list-item` 出现时早于身份证据回传，而移动侧栏游客控件的挂载时机不稳定。妖火 `wapindex.aspx?sid=-2` 对游客返回普通公开内容；精确登录页虽有完整 form，却同时加载 Gocaptcha/ImageCaptcha 资源。 |
| 根因 seam | 内容 transport 把“业务 DOM 已可读”“页面所有资源已结束”和“身份协议已结算”混成 ready 条件；NodeSeek 最初没有桥接渲染 runtime 的精确匿名值，后续虽能识别该值，Account script 仍被 `onLoadEnd` 阻塞。妖火最初没有在首页 unknown 后补读登录 form；补读后又让通用验证码特征覆盖了更强的完整登录 form 退出证据。 |
| 必须保持的行为 | NodeSeek direct 响应已有 current user 或完整游客控件时保持单请求快路径；只有 Account direct 为 identity unknown 才 handoff 一次 WebView。queue 只向渲染层暴露非敏感 owner；仅 `account` script 在 document 建立后提前轮询，并保留 `onLoadEnd` fallback 与同 request 幂等 guard，普通 Feed/Topic/Search 不改变注入时机。身份脚本等待 current user/self-account、配置对象自有 `user === null` 或准确登录+注册控件；精确 null 立即桥接紧凑标记，`false`、缺字段、空对象、普通内容 ready、超时或半结构页仍为 unknown。妖火首页 `div.top2/touserid` 继续单请求确认登录；首页 unknown 才补读精确 `waplogin.aspx?siteid=1000`，只有准确 POST form 与两个字段齐全才确认退出，即使同页带验证码资源也不得改成 verification；缺字段、错 URL、HTTP/网络错误保持 unknown，独立验证码页仍为 verification。账号检测、普通读取和写错误分类共用这一 reason 规则。两站检测都不得清、写或复制 Cookie。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 固定 NodeSeek 模糊 SSR 必须 direct×1→WebView×1、明确 direct 证据必须 WebView×0，并接受只由 bridge 生成的精确匿名标记；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定只传播 `owner` 不泄漏 queue internals；`tests/integration/hidden-browser-scripts.test.ts` 固定 Account 在帖子列表 ready 后继续等身份证据、精确 `user === null` 立即回传紧凑标记、同 request 重复执行只回传一次、`false/undefined/{}` 不结算；`tests/ui/account/hidden-browser-host.test.tsx` 固定仅 Account early injection，普通读取仍无该 prop，且 `onLoadEnd` fallback 保留。`src/sources/yaohuo/reader.test.ts` 固定公开页→带验证码资源的精确完整 form 为 expired，缺一个字段仍 unknown，已登录本人导航不发第二请求；`src/sources/yaohuo/actionClient.test.ts` 与 `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定其他登录消费者复用同一优先级。 |
| 来源证据 | 2026-07-25 与 revision `7fdcb94d580a` 匹配的隔离 AVD 中，NodeSeek 渲染完成后 `window.__config__` 自有 `user` 字段且精确为 `null`，刷新后相同；移动侧栏随后出现精确 `/signIn.html` 登录与 `/register.html` 注册按钮。当前 APK 脱敏 trace 进一步证明 direct 200 在约 2.1 秒 handoff WebView，但只等 `onLoadEnd` 时于约 17.1 秒以 `timeout` 结束。React Native WebView 官方 [Reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md#injectedjavascriptbeforecontentloaded) 将 `injectedJavaScriptBeforeContentLoaded` 定义为 document 建立后、子资源完成前执行，同时注明 Android 非 100% 可靠，因此必须保留 load-end fallback。妖火精确登录页出现 `form[name=login][method=post]`、`#logname[name=logname]` 与 `#password[name=logpass]`，同时加载 Gocaptcha/ImageCaptcha 资源；脱敏 transport trace 证明首页和登录页均为 200 HTML，旧终态却为 `verification_required`。成熟实现同样等待身份专属协议而非任意可读内容：Discourse [embed-auth-flow.js](https://github.com/discourse/discourse/blob/86282c50652371e84d2c5bc48c2a6817a1352289/frontend/discourse/app/services/embed-auth-flow.js) 轮询 `/session/current.json`，Forem [initializeBodyData.js](https://github.com/forem/forem/blob/0178bfe3d62984121c07921b3ed6c78d22003471/app/assets/javascripts/initializers/initializeBodyData.js) 等 `/async_info/base_data` 给出明确 user 后才向 React Native 发身份消息；妖火成熟 Android 客户端仍以 `wapindex.aspx?sid=-2` 与 `div.top2/touserid` 作为登录正证据。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯 parser/transport/script 固定三态与性能快路径，RNTL 固定 owner 真正到达 mounted WebView。 |
| Replay 或真实验收路径 | 在不复制主设备数据、不登录论坛的独立 AVD 上安装与当前 revision 匹配的 APK，执行 `tests/device-logged-out/logged-out-readonly.ad`：NodeSeek 先显示“未登录”或仅访客“已验证”、妖火显示“未登录”，随后用一次聚合 Search 验证 catalog-complete 结算、用一次聚合 Feed 验证逐来源当前请求 outcome，relaunch 后身份不变。各站数据可得性另由 Agent Live 报告；保留访客 Cookie，不绕过 Google/CF。 |
| 负向验证方式 | 恢复“Account 一律 WebView”会让 direct 快路径测试发现额外成本；恢复“任意可读 DOM ready”会让脚本提前回传；接受 NodeSeek `false`/缺字段会让负向 runtime fixture 误结算；删除 owner 传播会让 host/helper 测试失败；只看妖火登录 URL、放宽任一 form 字段或让验证码特征覆盖完整 form，会分别把不完整页错判退出或把真实游客错判 verification。 |
| 明确不覆盖范围 | 不证明动态登录、换号或真实写操作，不清 App 数据/Cookie，不承诺 Google/Cloudflare 当天可达，也不把第三方实现当作本站状态码契约。 |

## `REG-ACCOUNT-038` NodeImage 已有会话仍重复 Connect 且授权成功后不自动完成

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 用户症状 | 用户点击 NodeImage 授权后页面没有自动保存或关闭，只能继续点原站按钮；多次点击最终看到“每天只允许 20 次连接”。已有 NodeImage 登录态时仍可能每次消耗 Connect 配额，上传失败还会再次拉起授权。 |
| 触发条件 | v1.3.76 把可靠的声明式脚本改成 `onLoadEnd → 异步 NodeSeek 身份检查 → injectJavaScript`，页面 load 事件或文档世代先结束时脚本不会启动；用户随后点击原站 Connect 按钮，其 popup/`window.opener` 结果不受 App bridge 可靠控制。流程又把 `forceRefresh` 等同于重新 Connect，并以 Cookie 未到期猜测服务端 session。 |
| 根因 seam | NodeSeek canonical 身份、NodeImage 独立 session Cookie 与 SecureStore API Key 三份状态被压成一个“重新授权”动作；WebView 文档生命周期、Connect 配额和上传错误恢复缺少单向状态机与一次结算边界。 |
| 必须保持的行为 | 上传只读取已保存且属于当前 NodeSeek identity 的 Key。Key 缺失、归属不符或上传 401/403 时只提示“NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴”，不打开授权、不清 Key、不重试上传、不重新打开文件选择器，草稿保持不变。用户主动“获取 / 恢复授权”时先确认 NodeSeek owner/epoch，再挂载精确 NodeImage 根页；页面已经渲染 `#apiKeyInput` 时直接读取 DOM 兜底，否则以现有 NodeImage Cookie 请求 `/api/user/api-key`。返回 Key 即保存、关闭且 Connect 为零；API 请求一旦返回 HTML 403、网络错误、5xx、解析失败或 200 缺 Key，就显示失败并停止，不再读取 DOM 掩盖错误。只有当前已验证的匿名契约 `401 + application/json + 非空 error` 才切到 `nodeseek-cauth`；Connect 文档先报告 ready，再由原生 flow 领取一次执行权后调用 `/api/cAuth?target=NodeImage`，文档重载或重复 ready 不能获得第二次调用。成功后自动 remount NodeImage，执行 `/api/auth/verify`、取 Key、保存并关闭。三个阶段各用独立 WebView mount 和声明式 `injectedJavaScript + onMessage`，每条消息分别校验 Native HTTPS source origin、脚本精确 `documentUrl`、nonce、owner、epoch 与 credential generation；失败立即终止 flow 并卸载 WebView，透明层阻止网页按钮和刷新，之后只能关闭并重新点击 App 入口。重复入口 single-flight，跨阶段、重复和迟到消息只结算一次。NodeSeek Cookie、NodeImage `session_id` 与 SecureStore Key 不互相复制或手工写入。诊断只记录 `session-check`、`session-reused`、`session-expired`、`connect-started`、`connect-finished`、`key-saved`、`failed`，不记录 Cookie、Key、payload 或 nonce。 |
| 来源证据 | React Native WebView 官方 [Guide](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md) 规定 `injectedJavaScript` 配合 `onMessage` 在页面加载后桥接；[Rocket.Chat AuthenticationWebView](https://github.com/RocketChat/Rocket.Chat.ReactNative/blob/develop/app/views/AuthenticationWebView.tsx) 使用 bridge 与单次结算 guard；成熟 NodeImage 用户脚本 [nodeImage.js](https://github.com/dajie111/nodeseek-userscript/blob/9806663cc610cabd450bd5b406b8e2e4b6e6a3e5/nodeImage.js) 优先从现有 NodeImage 会话读取 Key。2026-07-26 对当前端点的只读检查确认：浏览器形态请求在未带 session 时 `/api/user/api-key` 返回 `401 application/json` 且含顶层 `error`；非浏览器形态可能返回 HTML 403，因此 403 不能代表 session 失效。事故诊断没有 NodeImage 阶段记录，只能证明用户看到配额提示，不能反推出精确 cAuth 次数。 |
| 精确失败 oracle | `src/platform/network/loginWebViewScripts.test.ts` 的 `REG-ACCOUNT-038` 固定有效 session 只请求 Key 且零 cAuth、页面已有 DOM Key 时不请求 API、精确 401 JSON 才报告 expired，HTML 403/网络/5xx/无效 JSON/缺 Key 均报告 error；`src/sources/nodeimage/authFlow.test.ts` 直接驱动生产消息编排，固定有效 session 调用一次完成回调且零 Connect、expired→ready→auth data→verify Key 完整链只调用一次 Connect 并完成一次、失败后迟到 expired 不推进，同时固定 owner/epoch/generation/terminal 门禁；`tests/ui/account/account-host.test.tsx` 固定三个阶段各自的声明式脚本、WebView remount、零刷新按钮和透明触摸拦截；`src/platform/network/loginWebViewScripts.nodeimage.test.ts` 固定 cAuth 必须等待含 nonce 的原生 start、同一文档重复 start 仍只请求一次且脚本文档 URL 必须精确；`src/sources/nodeimage/credentials.test.ts` 固定 owner/epoch/generation 安全保存；`src/platform/diagnostics/diagnostics.test.ts` 固定阶段白名单且秘密字段不落日志；`tests/ui/topic/topic-actions-controller.test.tsx` 与 `tests/integration/image-upload.test.ts` 固定 Key 缺失在 picker 前停止、401/403 恰好一次上传且零授权/重放、草稿不变。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：脚本 fixture 固定第三方响应分类与 fetch 次数，RNTL 固定实际 WebView props、remount、触摸边界和上传 controller 时序；源码字符串或只看到页面打开不能证明自动完成。 |
| Replay 或真实验收路径 | 不清 App 数据、Cookie 或 Key，在与 revision/APK 身份匹配的模拟器上用现有 NodeImage session 点击“获取 / 恢复授权”；应自动保存并关闭，诊断出现 `session-check → session-reused → key-saved` 且无 `connect-started`。当天 Connect 配额已耗尽时，真实失效兜底记 `NOT_VERIFIED`，不得重复点击、清 Cookie 制造失效或执行真实图片上传。 |
| 负向验证方式 | 恢复从 Connect 起步、`forceRefresh`、上传失败自动授权、`onLoadEnd` 命令式注入、网页刷新/点击、`window.opener`、把任意 401/403/异常视为失效，或复用同一个 WebView 实例跨阶段；编号测试必须观察到多次 cAuth、未知失败进入 Connect、脚本未启动、跨阶段消息结算或上传重放。 |
| 明确不覆盖范围 | 不保证第三方配额当天可恢复，不清 NodeImage/NodeSeek Cookie，不复制 session，不执行真实上传或 Connect 制造失效；服务端匿名契约变化时必须先取得新的真实证据再修改分类器。 |

## `REG-FEED-006` 多页 Feed 刷新失败后跳过失败页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-04` |
| 用户症状 | 已加载多页的单站 Feed 刷新时后续页失败，用户再次加载却直接请求更后面的页，失败页内容永久缺失。 |
| 触发条件 | Infinite Query 已有至少两页；同 key refetch 的第二页失败，随后用户触发分页。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 把任意 Query error 当成 load-more error，没有用 `isFetchNextPageError` 区分 refetch 与分页失败。 |
| 必须保持的行为 | refetch 后续页失败时保留原可信页和对应 cursor；下一次操作重试失败页，不能推进到更后 cursor、混入半页结果或误判没有更多。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-006` 建立两页缓存，让多页 refetch 的后续页失败，再触发加载；要求请求序列重试同一页而不是前进。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 Infinite Query 的 refetch/error/fetchNextPage 状态转换。 |
| Replay 或真实验收路径 | 单站 Feed 加载至少两页后刷新；若自然遇到后续页失败，旧列表仍可读且重试不得出现楼层缺口。动态站点不强制制造失败。 |
| 负向验证方式 | 将 controller 恢复为用通用 `isError` 判定分页失败，编号测试会观察到请求越过失败 cursor。 |
| 明确不覆盖范围 | 不增加后台自动重试，不固定动态主题数量，也不改变首屏刷新失败保留可信数据的既有语义。 |

## `REG-SEARCH-009` 搜索失败响应进入可信 Query data

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 某来源首次搜索失败或要求登录/验证时，页面可能把它当作成功空结果，错误状态不稳定，失败对象还会留在 Query cache。 |
| 触发条件 | Gateway 返回含来源 error 或 action-required 的 `SearchResponse`，但没有可提交的成功结果。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的聚合与单站 queryFn 直接 return 业务失败对象，而不是 reject `SearchPageError`。 |
| 必须保持的行为 | 初始失败和 action-required 必须使对应 Query 失败，`state.data` 不得建立；已有可信 data 的 refetch 失败仍由 Query 保留旧 data，同时暴露当前 error。失败响应中的 partial items 与 cursor 不落地。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-009` 让单站首次返回 ordinary error，要求可见错误、Query data 为 `undefined` 且 state.error 存在；`REG-SEARCH-007` 同时固定 action-required 不成为聚合可信 data。 |
| 最低可靠自动测试层 | `UI_PASS`：必须读取真实 QueryClient cache 与 controller 可见状态，纯 response helper 不足以证明缓存所有权。 |
| Replay 或真实验收路径 | 搜索页逐站提交；自然失败或受限时确认不是“无结果”成功态，并可从原来源重试。不得清 Cookie 制造 challenge。 |
| 负向验证方式 | 将任一 queryFn 改回直接 return 失败 `SearchResponse`，编号测试会看到 Query data 被写入或 error 为空。 |
| 明确不覆盖范围 | 不保证来源一定返回结果，不自动打开聚合面板，也不改变成功空结果的合法语义。 |

## `REG-SEARCH-010` 多页搜索刷新失败后跳到下一 cursor

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 用户症状 | 单站搜索已加载多页后刷新，后续页失败；用户继续滚动会跳过失败页请求下一 cursor，结果出现永久缺口。 |
| 触发条件 | Infinite Query 已缓存多页；同 key refetch 的第二页失败后再次触发分页。 |
| 根因 seam | `src/features/search/useSearchController.ts` 把 refetch error 误当成 `fetchNextPage` error，并从旧末页推导更后 cursor。 |
| 必须保持的行为 | 保留全部可信旧页和失败页 cursor；重试只请求同一失败 cursor，不能落地失败 response 的 partial items，也不能越过失败页。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-010` 建立多页搜索缓存，让 refetch 后续页失败，再加载更多；要求 transport cursor 序列重试失败 cursor 而不是请求下一值。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 Infinite Query 的多页 refetch 与 fetchNextPage error 分类。 |
| Replay 或真实验收路径 | 单站搜索滚动至少两页后刷新；自然失败时确认旧结果仍在、尾部可重试且无页缺口。 |
| 负向验证方式 | 将分页错误门禁从 `isFetchNextPageError` 改回通用 error，编号测试会观察到 cursor 前进。 |
| 明确不覆盖范围 | 不自动重试动态来源，不固定页大小，也不改变首次搜索失败或普通成功分页。 |

## `REG-SEARCH-011` 同 key 搜索刷新不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-02` |
| 用户症状 | 单站同条件重新搜索时旧结果仍在，但提交按钮和来源区块都不显示请求进行中，用户可能重复提交。 |
| 触发条件 | Query 已有可信 data；同一 key 执行 refetch，`isPending=false` 但 `isFetching=true`。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的 busy/loading 投影只读取初次 pending，没有覆盖 retained-data refetch。 |
| 必须保持的行为 | 初次请求与同 key refetch 都显示忙碌；旧结果可以继续可读，结算后 busy 收口。未提交的 disabled Query 仍按 `REG-SEARCH-006` 保持不忙。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-011` 先完成搜索，再用 pending Promise 阻塞同 key replacement；要求期间 `searchBusy` 和来源 loading 为真，结算后恢复为假。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖 TanStack Query 的 retained data + isFetching 状态。 |
| Replay 或真实验收路径 | 单站以同一关键词重复提交，观察请求期间忙碌提示和旧结果可读，完成后正常收口。 |
| 负向验证方式 | 将 busy 投影改回只使用 `isPending`，编号测试会在 replacement pending 时收到 false。 |
| 明确不覆盖范围 | 不增加全屏 Loading，不禁止合法的来源切换，也不改变 AI 后台预取的独立忙碌状态。 |

## `REG-SEARCH-012` 旧搜索结果为新输入打开动作面板

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04` |
| 用户症状 | 用户提交关键词 A 后立即把输入改成 B，A 的迟到登录/验证结果仍突然打开面板，看起来像 B 触发。 |
| 触发条件 | 单站前台请求 pending 时输入被替换，但已提交 Query 的 action-required 随后结算。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的 action effect 只看 Query 结果与来源，没有确认当前输入仍归属于该次 submitted search。 |
| 必须保持的行为 | 只有当前输入仍等于已提交查询时，单站 action-required 才能打开对应面板；输入变化、来源变化、聚合和后台 AI 都只保留可理解状态，不触发旧副作用。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-012` 提交 pending NodeSeek 搜索、替换输入后才结算验证要求；要求 verification 回调始终为零。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 effect、输入状态和迟到 Query 结算顺序。 |
| Replay 或真实验收路径 | 单站搜索请求中修改输入；若自然遇到登录/验证，只允许仍属当前提交的请求打开面板。不得主动破坏会话制造受限状态。 |
| 负向验证方式 | 删除 input/submitted query 所有权比较，编号测试会收到一次 NodeSeek verification 回调。 |
| 明确不覆盖范围 | 不取消用户仍在查看的合法当前请求，也不禁止主动进入单站后恢复当前验证。 |

## `REG-SOURCE-003` 主动取消被诊断为来源失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 切换来源、条件或离开页面取消请求后，诊断把 transport 的 abort rejection 记录成网络失败，污染问题定位并可能触发错误 UI。 |
| 触发条件 | Query signal 已 abort；底层 transport 以普通 reject 而非标准 AbortError 结算。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 与 `src/features/search/useSearchController.ts` 的 catch 只按 error 类型归类，没有优先读取请求 signal 的当前状态。 |
| 必须保持的行为 | signal 已 abort 的请求始终以 canceled 结算诊断，不落地数据或来源错误；未取消的真实 reject 仍是 failure，后续新请求可独立成功。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SOURCE-003` 让取消后的 semantic transport 以普通 Error reject，要求诊断 outcome 为 `canceled`；同组还固定未取消失败与后续成功不被吞掉。Feed 使用同一 signal-first catch 契约并由完整 UI 回归覆盖。 |
| 最低可靠自动测试层 | `UI_PASS`：需要 Query cancellation、transport rejection 和诊断 writer 的真实时序。 |
| Replay 或真实验收路径 | Feed/Search 快速切换来源或筛选，只读确认新请求结果归属正确；诊断中被替换请求为 canceled。动态验收不人为断网。 |
| 负向验证方式 | 移除 catch 中的 `signal.aborted` 优先判断，编号测试会把取消请求记录为 failure。 |
| 明确不覆盖范围 | 不把未取消的超时、解析失败或服务端错误降级成 canceled，也不隐藏当前请求的真实用户错误。 |

## `REG-SOURCE-004` linux.do 受管请求并行维护两条认证链

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | 同一次 linux.do 请求中 Gateway 已识别登录态，adapter 却再次读取 SecureStore；两次读取不一致或第二次失败时，请求可能匿名发送、误报存储错误，或与 Query key 的认证身份不一致。 |
| 触发条件 | 受管 `ReadGateway` 调用 `discourseRead`，后者进入 linux.do reader 后又自行加载 access。 |
| 根因 seam | `src/sources/readGateway.ts` → `src/sources/discourseRead.ts` → `src/sources/linuxdo/reader.ts` 的认证上下文没有显式贯穿，导致 Gateway 与 adapter 同时拥有 credential read。 |
| 必须保持的行为 | Gateway 是受管请求唯一的认证读取者；它加载的同一 `linuxDoAccess` 必须显式传到 Feed、Search、Topic、Replies、User、候选与语义搜索 adapter。adapter 不得隐式回读 SecureStore，也不得在缺失时猜测另一份身份。 |
| 精确失败 oracle | `src/sources/discourseRead.test.ts` 的 `REG-SOURCE-004` 传入 gateway-owned access，要求 linux.do adapter 精确收到同一对象；`src/sources/readGatewayContract.test.ts` 固定受管调用边界；`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 与 `tests/integration/source-read-contracts.test.ts` 的聚合/登录搜索、候选和语义搜索全部显式注入 access，并固定匿名请求不携带它。修复前 adapter 调用中该字段为 `undefined`，旧直调测试会因错误走 Google fallback 失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`：直接固定跨模块参数所有权；完整 Gateway/controller 回归负责消费者兼容。 |
| Replay 或真实验收路径 | 保留自然 linux.do 登录态，只读执行 Feed、Search、Topic 和用户页；各入口身份与账号中心一致。不得输出 Cookie，也不得清登录制造对照。 |
| 负向验证方式 | 删除 reader 的 `linuxDoAccess` 转发或恢复 linux.do adapter 内部 SecureStore 读取，编号测试必须因 adapter 缺少同一 access 失败。 |
| 明确不覆盖范围 | 不证明远端 Cookie 永久有效，不改变会话确认规则，也不允许调用方绕过 Gateway 伪造已登录身份。 |

## `REG-SOURCE-005` 冷启动 fallback 的后台账号请求取消前台列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 冷启动直接进入首页时 Feed 或 Categories 请求显示取消/失败；去 More 刷新账号后再回来却能加载，形成“账号刷新修好了网络”的假象。 |
| 触发条件 | direct request 进入隐藏 WebView fallback 时，Feed、Categories 与 Account 同站并发；旧 controller 使用 latest-wins 或抢占，后来任务拒绝/中断已排队或正在执行的前台任务。 |
| 根因 seam | `src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的隐藏 WebView 调度，以及 NodeSeek / linux.do reader 调用方没有标注用户可见优先级。 |
| 必须保持的行为 | 首页 Feed/Categories 立即发 direct request，冷启动账号刷新只作为 background。NodeSeek 与 linux.do 各自稳定排队，优先级为 `write > foreground > background`，同优先级 FIFO；已开始任务不被后来任务抢占，队中任务不因新任务而拒绝或取消。每个任务只得到自己的结果；两站队列互不影响。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-SOURCE-005` 固定真实 Feed/Categories 为 foreground、Account 为 background；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 再让这三类请求同时进入同站 fallback，逐个结算并要求三个 Promise 全部 resolve，同时固定已执行 foreground 不被后来任务抢占以及 `write > foreground > background` / 同级 FIFO。旧 latest-wins 实现会 reject 至少一个较早任务。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性 pending Promise 固定真实队列顺序与来源调用类别；Controller UI 回归继续固定首页进入即启用 Query。 |
| Replay 或真实验收路径 | 保留当前登录态，force-stop 后直接冷启动首页，不进入 More；观察 Feed/Categories 立即请求并得到确定结果，再进入 More 核对账号。连续三次，不能靠刷新账号预热作为成功条件。 |
| 负向验证方式 | 恢复 latest-wins、active preemption、队中新任务替换，或把 Account 标成 foreground；编号测试会看到前台任务 rejection、顺序错误或 background 抢占。 |
| 明确不覆盖范围 | 不新增自动 retry、冷却或熔断，不承诺第三方站永远成功；真实站点错误仍按自身请求展示，但不得由 App 调度制造取消。 |

## `REG-SOURCE-006` fallback 排队时间耗尽请求超时并跨任务取消

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 请求尚在等待隐藏 WebView 执行权就达到 15 秒超时；用户只取消一个页面请求，却连带使同站其他 fallback 失败或释放错误任务。 |
| 触发条件 | fallback 执行 timeout 在 enqueue 前启动，外层 direct request timeout 在 transport 已正式移交后仍继续计时，或调度器共用一个 Abort/取消所有任务。 |
| 根因 seam | `src/platform/network/request.ts` 的 timeout 所有权、`nodeseekFetchFallback` / `linuxdoFetchFallback` 的 handoff，以及隐藏 WebView 队列的 per-task Abort/执行时钟。 |
| 必须保持的行为 | 排队等待不消耗隐藏 WebView 的执行 timeout，任务出队获得执行权后才启动 15 秒；正式进入 fallback 时只停止该请求的外层 direct timeout。用户 AbortSignal 只取消自己的排队或执行任务，不影响队中/运行中的其他任务。direct request 只执行一次，符合既有明确条件时只进入一次 fallback。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 的 `REG-SOURCE-006` 固定 fallback handoff 只取消当前 outer timer；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 用虚拟时间让第三个任务在前两项各执行 10 秒后排队超过 15 秒，仍从真正出队时获得完整 15 秒预算，并通过独立 `AbortSignal` 分别取消队中与执行中任务，要求其他 Promise 正常结算；`tests/integration/source-read-contracts.test.ts` 固定 direct 一次、fallback 一次。 |
| 最低可靠自动测试层 | `UNIT_PASS`：需要虚拟时钟、独立 signals 与真实队列 Promise；只看最终错误文案不能区分排队耗时和执行超时。 |
| Replay 或真实验收路径 | 只在自然出现多个 fallback 时记录 enqueue/start/settle 脱敏诊断，确认较晚任务的执行预算从 start 计算；不为制造队列反复触发 Cloudflare。 |
| 负向验证方式 | 把执行 timer 移回 enqueue、保留 outer timer、共用 controller 或取消整队；编号测试会看到未开始任务超时或无关 Promise 被 reject。 |
| 明确不覆盖范围 | 不延长单个已执行 WebView 的 15 秒预算，不自动重试超时，不隐藏真实用户取消，也不改变 TanStack 相同 Query key 的去重。 |

## `REG-SOURCE-007` 身份核对中的四站被误报暂不可用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | App 偶发进入时四个可登录站点同时显示“暂不可用”，但 V2EX 等公开列表已经正常刷出；数秒后四个错误又自行消失。 |
| 触发条件 | 冷启动账号 Query 正在核对四站身份时，聚合 Feed、Categories 或 Search 同时开始读取。 |
| 根因 seam | `ReadGateway` 为了暂停 pending 来源把它们传入 `unavailableSources`；聚合 adapter 正确跳过请求，却生成与真实凭据故障相同的来源错误，Gateway 返回时没有移除这些内部 barrier 错误。 |
| 必须保持的行为 | 身份 pending 的来源不得发起新私有请求，旧私有条目也不得混入当前聚合结果，但 pending 本身不显示为来源故障；V2EX 等已成功来源立即可用。真实凭据存储错误仍按来源显示；单站 pending 读取仍明确被 barrier 拒绝。 |
| 精确失败 oracle | `src/sources/readGatewayContract.test.ts` 的 `REG-SOURCE-007` 让 NodeSeek pending，并让 Feed、Categories、Search adapter 同时返回公开项、NodeSeek 陈旧项和 NodeSeek error；三个聚合结果都必须只保留公开项且 `errors={}`，同时仍向 adapter 传入 `unavailableSources=['nodeseek']`。`REG-SOURCE-001` 继续证明真实凭据错误没有被吞掉。 |
| 最低可靠自动测试层 | `UNIT_PASS`：共享 Gateway 边界可确定性证明请求暂停、条目过滤与错误投影三者同时成立。 |
| Replay 或真实验收路径 | 保留当前登录态，连续三次 force-stop 冷启动到“全部”；列表可渐进出现，但身份核对期间不得闪现四站“暂不可用”。再进入聚合搜索确认同一行为；不得清数据制造状态。 |
| 负向验证方式 | 返回 adapter 的原始 `errors` 而不删除 pending source，编号测试会重新看到 NodeSeek 错误；删除 `unavailableSources` 则会看到 pending 站点被实际读取或陈旧条目泄漏。 |
| 明确不覆盖范围 | 不隐藏真实网络、解析、凭据存储或站点错误，不自动重试第三方站点，也不允许 pending 身份读取私有数据。 |

## `REG-TOPIC-024` linux.do 回复页复用模块全局旧 stream

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | linux.do 主题的回复 stream 已在服务端变化后，后续分页仍按旧 post id 列表读取，可能缺少新回复或请求已不存在的楼层。 |
| 触发条件 | 同一 topic 在模块级缓存有效期内再次读取回复页，而服务端 `post_stream.stream` 已更新。 |
| 根因 seam | `src/sources/linuxdo/reader.ts` 的 `topicStreamCache` 成为 TanStack Query 之外、未按会话和请求生命周期约束的第二份服务端状态所有者。 |
| 必须保持的行为 | 每次回复页读取都从当前 topic stream 推导目标 post ids；TanStack Query 是唯一跨请求缓存所有者。取消、错误和会话边界仍由当前 Query 管理，不新增 adapter 全局缓存。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-TOPIC-024` 让同一 topic 的后续读取返回更新后的 stream，要求第二次 `/posts.json` 使用当前 ids；旧缓存实现稳定继续请求旧 ids。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性 fixture 足以固定 stream 到 posts 请求的映射与调用次数。 |
| Replay 或真实验收路径 | linux.do 主题只读刷新回复并分页，确认楼层连续；动态 stream 变化不作为必造前提。 |
| 负向验证方式 | 恢复模块级 stream cache，编号测试会因第二次请求仍含旧 post ids 失败。 |
| 明确不覆盖范围 | 不改变远端 stream 格式、页大小或 Topic Query 自身缓存策略，也不自动制造新回复。 |

## `REG-TOPIC-025` 完整刷新拼接新首屏与旧回复页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04` |
| 用户症状 | 主题完整刷新后首屏是新内容，后续回复和 cursor 却来自刷新前快照，造成重复、缺楼或继续从错误位置分页。 |
| 触发条件 | 回复 Infinite Query 已加载多页；用户执行“完整刷新”，详情返回新的首屏回复。 |
| 根因 seam | `src/features/topic/useTopicController.ts` 只替换 replies cache 的第一页，保留旧 pages、pageParams 和 next cursor。 |
| 必须保持的行为 | 完整刷新必须把详情返回的首屏作为新的唯一回复快照，丢弃所有旧后续页与 cursor；之后分页从新首屏权威 cursor 继续。仅刷新评论和写后定向刷新保留各自独立语义。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-TOPIC-025` 预置旧第二页与 cursor，再让完整刷新返回新首屏；要求最终只有新首屏回复，旧第二页和旧 cursor 均消失。 |
| 最低可靠自动测试层 | `UI_PASS`：必须观察详情 Query 与回复 Infinite Query 的 cache 提交。 |
| Replay 或真实验收路径 | 已分页 Topic 打开菜单执行完整刷新，确认回复从新首屏开始且继续分页无重复。只读刷新，不产生原站写入。 |
| 负向验证方式 | 将完整刷新恢复为只替换 `pages[0]`，编号测试会继续看到旧第二页或 cursor。 |
| 明确不覆盖范围 | 不改变“仅刷新评论”的定位策略，不保证动态主题刷新前后内容相同，也不执行评论写入。 |

## `REG-TOPIC-026` Discourse 系统动作与解决方案沿用普通回复模板

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`WRITE-03` |
| 用户症状 | 小隐寺和 linux.do 的关闭/重开事件被显示成空白普通楼层，带等级、楼层号和点赞等操作；主题正文后缺少原站的已采纳答案区，采纳回复本体也只有作者栏“已采纳”小标签，没有明确的解决状态。 |
| 触发条件 | 采纳回复和 `post_type != 1` 的系统帖子都直接进入共享 `ReplyItem` 普通回复模板，`actionCode` 没有可见语义分支。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx` 的主题正文尾部、`src/features/topic/components/ReplyItem.tsx` 的共享 Discourse 回复模板，以及 `src/features/topic/useTopicController.ts` 的精确楼层 Query。 |
| 必须保持的行为 | 主题正文后显示可折叠的“已解决”答案预览，包含采纳者、时间、楼层和答案片段，并可定位到下方完整回复；采纳楼层尚未进入当前分页时按精确楼层静默补取，可在预览内展开全文但不伪装进当前分页，也不产生引用展开状态、提示或验证弹层；受限主题不得补取。筛选或查找隐藏采纳回复时定位操作先恢复“全部”与空查询再滚动。采纳回复保留正文、楼层和合法操作，并显示顶部“已解决”及底部“解决方案”；系统帖子只显示 actor、时间和可读事件，`closed.enabled`/`closed.disabled` 分别显示关闭/重开，未知动作优先使用不含原始 action code 的可见正文、否则显示“更新了主题”，不显示普通楼层、等级、正文占位、reaction 或任何写入口。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 固定两站正文内采纳区的顺序、展开/收起、后分页静默精确补取及包含引用摘要和只读投票的就地全文、受限主题零补取、筛选恢复与第 2 楼精确索引；重复答案区的投票不得显示“未登录”或登录/提交入口。`tests/ui/topic/topic-session-controller.test.tsx` 固定后台补取成功或失败都不展开引用、不通知且不自动打开验证页，并固定失败后主动展开同一楼层会精确重试；该楼层已随分页载入时则复用本地对象且不再次请求；`tests/ui/topic/topic-components.test.tsx` 固定采纳回复模板、只读投票、关闭/重开映射、未知动作 fallback、原始 action code 即使嵌在正文中也不泄露、系统事件无障碍标签及写入口缺席；`src/sources/discourse/model.test.ts` 固定采纳回复与空 `cooked` 系统事件是两个独立对象并保留 `actionCode`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 parser 字段契约，`UI_PASS` 固定共享组件和 Query controller 行为。 |
| Replay 或真实验收路径 | 只读直达小隐寺主题 `https://forum.xiaoyinsi.com/t/topic/206/1`，核对正文后的采纳预览、收起/展开和完整答案定位；再核对第 2 楼采纳回复及底部三条关闭/重开事件。linux.do 没有具体同模板 URL 时标 `NOT_VERIFIED`，不得以共享测试冒充 `LIVE_PASS`。 |
| 负向验证方式 | 删除正文内采纳区后，顺序与折叠/定位断言失败；取消按楼层补取、静默预取、访问门禁或筛选恢复后，后分页/受限主题/筛选用例失败；删除系统事件提前返回后，UI 测试会重新出现楼层和互动入口；恢复作者栏“已采纳”或删除解决提示后，采纳模板断言失败；允许未知动作正文携带 action code 后，对应泄露用例失败。 |
| 明确不覆盖范围 | 采纳预览复用主题回复或既有精确楼层读取通道，不新增 parser 对象、不把预览计入回复数，也不把后分页答案伪装为已进入当前回复分页；不执行真实点赞、回复、编辑、删除或投票，也不改变主题级状态标签。 |

## `REG-USER-007` 用户页刷新保留旧分页快照且不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `USER-01` |
| 用户症状 | 用户页已经加载多页后刷新，页面没有忙碌反馈；刷新完成仍混有旧后续页和旧 cursor，可能显示已删除内容或跳过新内容。 |
| 触发条件 | Profile/Infinite Query 已有多页数据；同一用户执行刷新。 |
| 根因 seam | `src/features/user/useUserController.ts` 的 refresh 只 invalidates 首屏 seed，并以 pending 而非 fetching 投影 busy，未用新 profile 替换完整分页快照。 |
| 必须保持的行为 | 刷新期间暴露 busy；新 profile 作为 topics/replies 两条 lane 的权威首屏，替换全部旧 pages 和 cursor。刷新失败保留可信旧快照并显示错误。 |
| 精确失败 oracle | `tests/ui/user/user-controller-session.test.tsx` 的 `REG-USER-007` 建立旧多页缓存，用 pending replacement 固定 busy，再结算新首屏；要求旧后续页消失且两个 lane 的 cursor 来自新快照。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 Profile Query、两条 Infinite Query seed 和 controller busy 的协同。 |
| Replay 或真实验收路径 | 用户页分别加载主题/回复后执行只读刷新，确认忙碌态、首屏归属和继续分页。 |
| 负向验证方式 | 恢复只更新第一页或 busy 只看 `isPending`，编号测试会看到旧页/cursor 或刷新期间 false。 |
| 明确不覆盖范围 | 不固定远端统计和列表数量，不改变关注本机状态，也不把刷新失败解释为用户不存在。 |

## `REG-WRITE-017` 写成功后定向回复刷新在 Query 重构中丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01`、`WRITE-02`、`TOPIC-03` |
| 用户症状 | 回复、编辑或删除已由服务器确认后，当前回复区不出现目标楼层或仍显示旧内容；如果简单整页刷新又会丢失已加载分页和当前位置。 |
| 触发条件 | write mutation 成功后需要按新增楼层、编辑楼层或排除已删除楼层刷新特定回复页。 |
| 根因 seam | 请求改为 TanStack Query 唯一所有者时，旧 controller 的 targeted refresh seam 被删除，但 mutation success 没有等价的 Query-native 提交。 |
| 必须保持的行为 | 服务器确认后通过独立 Query key 读取目标页，并原子合并/替换 replies InfiniteData；新增回复推导尾页，编辑/删除按 target 或 exclude 定位，保留无关已加载页和 cursor。跟进刷新失败只报告 partial，不回滚已确认写入或重发非幂等请求。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-WRITE-017` 预置已加载回复页，提交后返回权威尾页；要求目标回复和总数更新、既有页保留且无重复。`tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-LINUXDO-003` 另固定写已确认但跟进刷新失败为 partial。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖 mutation success、临时 Query、InfiniteData 合并和可见 controller 状态。 |
| Replay 或真实验收路径 | 默认只检查写入口，不提交真实内容；获得逐次写授权后记录原状态，提交一次并核对目标楼层、分页与 partial 提示，按可逆性清理。 |
| 负向验证方式 | 移除 `afterSuccess` 的 Query 定向刷新或改为覆盖全部 pages，编号测试会缺少权威回复或丢失既有页。 |
| 明确不覆盖范围 | 不自动重试非幂等写请求，不把跟进读取失败伪装成写失败，也不授权真实回复、编辑或删除。 |

## `REG-WRITE-018` 串行 mutation 在排队前共享同一 optimistic snapshot

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 用户快速执行同一 Topic 的两个互动，第一个成功、第二个失败时，第二个 rollback 可能恢复到两个操作之前，复活已经确认撤销的状态或覆盖已确认结果。 |
| 触发条件 | 相同 TanStack mutation scope 的两个操作连续入队；`onMutate` 在 scope 串行 transport 之前就执行 snapshot 和 optimistic patch。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 把 cancel/snapshot/optimistic/rollback 放在 Mutation scope 之外，两个 queued mutation 观察到重叠基线。 |
| 必须保持的行为 | 同 scope 的取消、snapshot、optimistic patch、transport 和 rollback 必须按顺序进入串行区；后一个操作只能基于前一个已结算状态建立 snapshot。不同 Topic scope 仍可独立结算。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-018` 阻塞第一个 transport 后排入第二个，要求第二个 optimistic patch 直到其 transport 启动才应用；第二个失败 rollback 不覆盖第一个已确认状态。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 MutationCache scope、Query cache patch 与两个 pending transport 的时序。 |
| Replay 或真实验收路径 | 默认不快速触发真实互动；若获逐次授权，只对可逆操作记录初态并逐个等待结算，最后恢复原态。并发边界由自动测试证明。 |
| 负向验证方式 | 把 snapshot/optimistic patch 移回 `onMutate`，编号测试会在第一个 transport 尚未结算时提前看到第二个 patch 或错误 rollback。 |
| 明确不覆盖范围 | 不让不同 Topic 全局串行，不重试非幂等操作，也不改变各站 optimistic 字段计算。 |

## `REG-WRITE-019` rerender 前重复提交进入两个非幂等队列

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01` |
| 用户症状 | 用户快速双击回复提交，在 React 来得及重渲染 busy 之前，两次相同回复都进入队列，可能在原站生成重复内容。 |
| 触发条件 | 第一次 reply mutation 已在 MutationCache pending，但当前 render 闭包中的 busy 仍是旧值；第二次调用紧接发生。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 只依赖渲染时派生的 busy 防重，没有在执行瞬间检查 exact mutation identity 的 pending 状态。 |
| 必须保持的行为 | 同 source/topic/action 的非幂等提交只允许一个 pending mutation；第二次在 transport 入队前明确拒绝。其他 action 或 Topic 不受误伤，确认写入不自动重试。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-019` 在同一 act 中连续调用两次 reply，阻塞首个 transport；要求 action client 只调用一次，第二次 promise 被拒绝且 MutationCache 没有第二个 queued transport。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖 render 闭包与 MutationCache 当前状态之间的竞态。 |
| Replay 或真实验收路径 | 不用真实双击写入验证；获授权后的单次回复只提交一次并等待终态，重复提交保护由自动测试证明。 |
| 负向验证方式 | 删除执行前的 exact pending mutation 检查，编号测试会观察到第二个 transport 入队。 |
| 明确不覆盖范围 | 不把所有不同 action 合并为一个锁，不提供服务端幂等键，也不授权真实内容提交。 |

## `REG-WRITE-020` mutation 前置错误无提示地消失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01`、`WRITE-03`、`WRITE-04` |
| 用户症状 | SecureStore 读取、凭据准备或其他 action wrapper 之前的异常发生时，操作没有成功也没有错误提示，用户只能看到按钮恢复。 |
| 触发条件 | 错误在站点 action client 及其 typed failure handler 之前抛出，因此既没有 wrapper 通知，也没有成功提示。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的 generic mutation `onError` 假定所有错误都已由内部 wrapper 处理。 |
| 必须保持的行为 | 未经处理的 raw Error 必须恰好提示一次；已转成 `HandledActionError` 的登录、授权、服务器或 partial 错误不重复提示。失败仍执行对应 rollback，成功提示绝不能出现。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-020` 让 SecureStore credential preparation reject，要求用户收到原错误、没有成功提示；既有 typed failure 用例固定不双重通知。 |
| 最低可靠自动测试层 | `UI_PASS`：需要 mutation lifecycle、wrapper 分类与 notify spy 一起证明“零次/一次/不重复”。 |
| Replay 或真实验收路径 | 只在自然凭据故障时核对可理解提示；不得破坏 SecureStore、删除登录或发真实写请求制造场景。 |
| 负向验证方式 | 移除 generic raw-error notify，编号测试会收到零次提示；对所有错误无条件 notify 会让既有 handled-error 用例重复。 |
| 明确不覆盖范围 | 不输出敏感凭据，不把登录失效降级为普通错误，也不自动重试非幂等操作。 |

## `REG-WRITE-021` 离开 Topic 后结算的写入保留旧 route cache

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01`、`NAV-03` |
| 用户症状 | 在 Topic A 提交回复后立即导航到 Topic B，A 的请求随后成功；以后返回 A 时，因为 `refetchOnMount=false`，旧详情和回复 cache 可能继续显示写入前状态。 |
| 触发条件 | mutation 归属 A，结算时活动 route 已切换；跟进刷新只操作当前 route 或因不匹配直接跳过。 |
| 根因 seam | `src/features/topic/actions/useTopicActionsController.ts` 的 after-success refresh 没有处理 mutation identity 与当前 Topic identity 分离后的 inactive cache。 |
| 必须保持的行为 | 同一 Topic 仍活动时执行定向刷新；已导航离开时精确移除旧 Topic 的 detail/replies cache，使下次进入重新读取。不得清除当前或其他 Topic，也不得回滚服务器已确认写入。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-021` 预置 Topic A cache，阻塞回复 transport，切换活动 detail 后才结算；要求 A 的 exact detail/replies key 被移除，当前 Topic cache 保持。 |
| 最低可靠自动测试层 | `UI_PASS`：需要 mutation identity、活动 route ref 与 Query cache 的真实结算时序。 |
| Replay 或真实验收路径 | 默认不提交真实回复；获授权时可在单次提交后导航离开再返回，核对权威内容并按可逆性清理。 |
| 负向验证方式 | 删除 route mismatch 时的 exact cache removal，编号测试会继续读取 Topic A 的旧 cache。 |
| 明确不覆盖范围 | 不预取已离开的 Topic，不清全站缓存，也不保证远端写入的即时索引延迟。 |

## `REG-WRITE-022` 写操作确认失效后未更新统一会话投影

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 或妖火写操作已经由站点协议确认登录失效，用户虽然看到一次错误提示，Topic 写入口和其他读取入口却仍按旧登录态开放；妖火验证页还可能被误报成已退出。 |
| 触发条件 | 站点 action client 抛出 typed `login-required`、`login-expired` 或 `verification-required`，但 `useTopicActionsController` 只提示并包装错误，没有请求 Account Query 对目标站身份对账。 |
| 根因 seam | 写操作 transport 的站点错误分类与 `reconcileWritableSession(source)`/Account canonical Query 之间缺少接线，导致动作提示和权威身份各自结算。 |
| 必须保持的行为 | ticket 仍有效时，只有 typed `login-required`、`login-expired` 或 `verification-required` 请求一次目标站 Account Query 对账；anonymous、changed、same 或 unknown 均由 Account Query 及 writable gate 统一结算 barrier、identity 和 epoch。普通网络错误、权限不足和 stale ticket 不对账、不改变身份。所有路径都不删除或覆盖原站 Cookie，不自动重放非幂等请求，提示恰好一次。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-022` 分别让 NodeSeek、妖火 action client 返回 typed expired/verification error，要求恰好调用一次目标站 `reconcileWritableSession`；stale ticket 要求零对账、零提示。`src/domain/session/writableSessionGate.test.ts` 与 Account controller 测试固定对账的 same/changed/anonymous/unknown、barrier 和 epoch 契约。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：writable gate、Account Query 对账与 action controller 必须组合覆盖；只测错误文案或 action client 分类会漏掉身份投影。 |
| Replay 或真实验收路径 | 默认不通过真实写操作制造过期。设备自然出现失效时，只读核对 More、Search 与 Topic 已同步关闭目标站写能力且原站 Cookie仍保留；妖火自然验证态只显示验证要求。否则动态证据记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除对账调用、在 ticket 校验前对账、把 verification 当作普通成功，或从错误分支调用 Cookie 清理；编号 UI 测试、stale ticket 测试或 Cookie 所有权测试必须失败。 |
| 明确不覆盖范围 | 不把单主题权限失败升级为全局退出，不自动重试写操作，不清 Cookie，不执行真实回复/收藏/投票，也不新增统一 verifier 或第二套状态机。 |

## `REG-WRITE-023` 旧主题或账号在身份待确认、换号后继续写入

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-01`、`TOPIC-03` |
| 用户症状 | 用户从账号 A 打开旧 Topic 后在 WebView 切到账号 B、退出或身份无法确认，App 仍可能先显示 optimistic 成功、打开文件选择器或发送 A 页面上下文下的回复、编辑、删除、互动、投票、上传和签到；服务器已确认的操作还可能在写后刷新期间换号，随后对新账号弹出旧账号的成功提示。 |
| 触发条件 | 写入开始时 surface 开放/刚关闭/unknown；`ensureWritableSession` 返回后、Query cancellation、文件选择或 `afterSuccess` 刷新等待期间 epoch 变化；NodeImage Key 属于另一 NodeSeek identity；action 返回 typed identity evidence。 |
| 根因 seam | 各 action 自行读取 Cookie/SecureStore 判断登录，身份检查与 optimistic snapshot、文件选择、上传、transport 及成功结算之间没有一次性 identity/epoch 所有权；恢复逻辑把写请求当成可自动重试读取。 |
| 必须保持的行为 | 所有回复、楼层回复、编辑、删除、点赞/鸡腿/反对、收藏/书签、投票、四站上传与 NodeSeek 签到统一先调用 `ensureWritableSession(source)`。已确认且干净的会话不增加网络请求；surface 开放、刚关闭或 unknown 时先走 verifier。同一 identity 可继续当前操作一次；换号、退出、unknown 或 ticket 过期都终止。门禁必须位于用户确认之后且在 Query snapshot、optimistic update、文件选择、上传和 transport 之前；等待 Query cancellation 或文件选择后再次校验，失败为零 optimistic、零上传、零 transport。只有 typed identity evidence 请求一次 Account Query 对账，不自动重放；普通和权限失败不对账。未确认的 unknown/failure 必须恢复仍存在的旧 scope optimistic snapshot，即使对账已让 ticket pending；已清除的旧 epoch Query 不得被 rollback 重建。服务器确认后在应用结果前及 `afterSuccess` 返回后再次校验 ticket；迟到结算不弹成功提示、不写新 epoch cache，诊断只产生一个 `stale` 终态并保留 `serverConfirmed: true`，不得回滚、撤销或重发服务器操作。NodeImage 自动取得或手动保存的 Key 在保存时绑定当前已确认 NodeSeek identity；上传只读取 `usable` Key，不在上传动作中确认、授权、清理或刷新凭据。Key 缺失/归属不符在 picker 前只提示，401/403 在一次上传后只提示，草稿不变且零重放。 |
| 来源证据 | OWASP [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) 建议集中授权并默认拒绝；[Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) 要求授权与具体操作绑定并在执行前校验。TanStack Query [Optimistic Updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) 把 cancel、snapshot 与 optimistic apply 的顺序视为 mutation 正确性边界。 |
| 精确失败 oracle | `src/domain/session/writableSessionGate.test.ts` 固定 clean fast-path、dirty 强制复核、same/changed/anonymous/unknown 与 ticket validation；`tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-023` 固定 unknown 在 optimistic/transport 前阻断、dirty 在文件选择/上传前阻断、Query cancellation 等待期间换代仍为零 optimistic/transport、typed identity failure 只 reconcile 一次且不重放；NodeImage Key 缺失要求零 picker/上传并只提示，rejected Key 要求一次读取、一次 picker、一次上传、零授权/重放且草稿不变。妖火验证对账进入 pending 仍须恢复现存旧 scope 收藏；unknown 在 ticket 过期后到达同样回滚，旧 epoch 已清除时不得重建。NodeSeek、妖火、Discourse 与签到的 confirmed 结果在应用前或 `afterSuccess` 期间换代，要求零成功提示、新 epoch canary 不变且唯一 finish 为 `stale + serverConfirmed`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯 gate 单测不足以证明门禁位于 optimistic、picker 和 transport 之前，必须执行真实 controller mutation 时序。 |
| Replay 或真实验收路径 | 默认只检查入口在 identity pending 时关闭、旧内容保持只读以及重试提示；真实回复、编辑、删除、互动、投票、上传和签到都需逐项授权。自然出现 typed identity failure 时只读核对 More、Search、Topic 投影一致且没有第二次 transport。 |
| 负向验证方式 | 把 ticket 校验移到 optimistic/picker/transport 之后，删除任一等待后的复核，让 action 自己拼 Cookie，或在 reconciliation 后自动重放 task；编号测试必须观察到本地状态变化、picker、upload、transport、错误成功提示或错误终态。 |
| 明确不覆盖范围 | 不保证账号 B 对旧主题拥有相同权限，不自动转换草稿归属，不执行真实写操作制造状态，也不把普通单主题权限不足升级为全局退出。 |

## `REG-WRITE-024` 普通写失败误触发身份 barrier

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`SEARCH-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-03` |
| 用户症状 | NodeSeek、妖火或 linux.do 的普通网络错误、服务端异常或对象权限不足被当成登录失效；一次局部写失败会让目标站进入长期 identity barrier，Topic、Search 和其他私有入口一起关闭。 |
| 触发条件 | action wrapper 对所有异常无条件调用 `reconcileWritableSession(source)`，或把普通 `403`/权限错误升级为身份失效证据。 |
| 根因 seam | `sourceErrorFromUnknown(...).kind` 已提供类型化证据，但 Topic action controller 没有在调用 Account Query 前消费该分类；linux.do 还曾绕过站点 runtime 的 recovery 结果。 |
| 必须保持的行为 | 只有 `login-required`、`login-expired`、`verification-required` 请求一次目标站对账。`ordinary` 和 `permission-denied` 只回滚本次 optimistic state、提示一次并结束；零对账、零 epoch 变化、零 Cookie 清理、零自动重放。linux.do 先由既有 runtime 分类，明确身份失效才对账，且不自动打开登录面板。小隐寺既有明确授权失效流程不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-024` 对 NodeSeek、妖火、linux.do 分别注入 ordinary 与 typed `permission-denied`，即使对账 mock 返回 unknown 也要求调用次数为零、transport 恰好一次、提示恰好一次；linux.do 仍调用 runtime recovery。独立的 linux.do 删除/上传与 NodeSeek 签到生命周期使用同一 ordinary/permission 矩阵，并分别保持回复、草稿和账号投影。typed linux.do expiry 与 Cloudflare verification 的同编号用例要求各对账恰好一次、零自动重放且不打开登录面板。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 mutation rollback、runtime recovery、Account reconciliation spy 和提示共同证明不会建立 barrier。 |
| Replay 或真实验收路径 | 默认不制造真实写失败；只读设备验收确认四站账号无 pending、正常 Topic 写入口仍按账号投影启用。自然出现普通失败时只核对该动作收口且其他入口不进入 barrier。 |
| 负向验证方式 | 恢复任一站无条件对账，或让 linux.do 在 runtime 之前直接对账，编号测试必须观察到对账调用；加入自动重放则 transport 次数失败。 |
| 明确不覆盖范围 | 不猜测某站是否用普通错误表达真实失效；若出现证据，先在对应 action client 按协议补充 typed kind，不恢复“所有失败都对账”。 |

## `REG-WRITE-025` 妖火结果文案被当作控制协议

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-03`、`TOPIC-03` |
| 用户症状 | 妖火返回的操作结果无法确认，但只要提示文案发生同义改写，或普通 200 页面只有空白/任意短文本，App 就把它当作已确认成功，保留 optimistic 状态并弹出成功提示，可能诱导用户重复或误判收藏、回复、删除和投票。 |
| 触发条件 | `yaohuoActionClient` 只返回 message，Controller 用完整中文字符串等值判断 unknown；parser 又把“没有失败词且不超过 80 字”当作成功，展示文案、长度与控制流被绑成协议。 |
| 根因 seam | 妖火 action response parser 到 Topic mutation wrapper 的结果类型缺少稳定判别字段和正向成功 oracle。 |
| 必须保持的行为 | client 只返回 `{ status: 'confirmed', message, favoriteId? }` 或 `{ status: 'unknown', message }`；Controller 只判断 `status`。收藏和取消仍使用各自结构化协议；通用 action 的空文本、任意未识别短文本和长普通页面都为 unknown，无 `.tip` 时只接受已有 fixture 证明的明确成功文案。unknown 必须回滚本次 optimistic state、展示 client message、零身份对账且不自动重试；confirmed 才能进入成功结算。 |
| 精确失败 oracle | `src/sources/yaohuo/actionClient.test.ts` 的 `REG-WRITE-025` 断言缺失删除确认链接、空 200 与任意未识别短文本都得到 `status: unknown`，既有无 `.tip`“评论成功”仍 confirmed；`tests/ui/topic/topic-actions-controller.test.tsx` 使用与生产默认文案不同的 unknown message，要求当前 ticket 下回滚收藏并只提示该文案，ticket 已过期仍回滚现存旧 scope 且零提示，两者都零对账和零成功提示。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：client 固定 parser 判别，Controller 固定 mutation rollback 和文案解耦。 |
| Replay 或真实验收路径 | 默认不执行真实妖火收藏、回复或删除；只读设备验收确认入口与当前收藏投影可见。只有获逐次授权后才在原帖/收藏页核对动态 unknown 或 confirmed。 |
| 负向验证方式 | 删除 `status`、恢复完整文案比较、让空/任意短响应 confirmed 或让 unknown 返回成功，编号 client/UI 测试必须失败；仅修改提示文字必须保持测试通过。 |
| 明确不覆盖范围 | 不扩大 HTML 成功判据、不猜测未知响应、不自动查询或重发可能已成功的非幂等动作。 |

## `REG-TEST-001` Smoke 绿灯被当成功能完整通过

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 用户症状 | Smoke 路径能走通，但 Feed 双 Loading 等用户可见 bug 仍然存在；多来源搜索 Replay 只等到请求结束，即使结果为空或结果打不开也会报绿。 |
| 触发条件 | 测试只验证元素最终出现、源码包含某段字符串、请求完成或 App 没崩溃，没有精确的用户可见 oracle。 |
| 根因 seam | 证据命名和交付报告把不同测试层混成一个 `SMOKE_PASS`；搜索旅程把 `search-complete` 当成搜索成功，没有验证结果存在并能进入详情。 |
| 必须保持的行为 | APK 启动、设备流程、组件行为、确定性逻辑、第三方数据与基础设施分别报告；缺少的层明确标记 `NOT_VERIFIED` 或 `BLOCKED_BY_ENV`。固定 fixture 严格证明成功与失败分支；Replay 证明当前请求结算、App-owned 恢复与返回；Agent Live 才证明第三方当前有数据。 |
| 精确失败 oracle | `npm run verify` 必须包含 `npm run test:ui`；`npm run test:device` 和 `npm run smoke:android` 输出不同证据名称，Smoke 不输出 `SMOKE_PASS` 或“功能完整通过”；`tests/tooling/android-smoke-guard.test.ts` 要求动态 Replay 使用当前请求 outcome，禁止动态首条、详情 loaded 或第三方 DOM 作为无条件成功 oracle。 |
| 最低可靠自动测试层 | 由具体事故决定；对 Feed 双 Loading 是 `UI_PASS`，不得用更低层的 `APK_SANITY` 替代。 |
| Replay 或真实验收路径 | Smoke 只汇总 `APK_SANITY` 与 `DEVICE_REPLAY_PASS`；第三方数据和获授权写入另报 `LIVE_PASS`。搜索 Replay 只提交一次聚合查询并等待 catalog-complete 结算，逐来源结果类型与真实详情链由 Agent Live。 |
| 负向验证方式 | 注入 `REG-FEED-001` 故障时 APK 仍可启动，但 UI 测试必须失败；让 Replay 等动态首条/详情，或用 `APK_SANITY` 代替 UI/Live，守卫或分层检查必须失败。 |
| 明确不覆盖范围 | 不设置覆盖率百分比；测试价值由能否拦住具体用户行为回归判断。 |

## `REG-TEST-002` 搜索完成标记残留导致 Replay 提前断言

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 用户症状 | 真实搜索仍显示“正在搜索...”，Replay 却已经越过等待并立即报告首条结果不存在；同一路径重跑又可能通过。 |
| 触发条件 | 新搜索发出后，Android accessibility snapshot 短暂保留上一状态的 `search-complete` 节点；另一版按当前可见 group 计算完成，缺少尚未注册的来源时也会提前结算。 |
| 根因 seam | `tests/device-logged-out/logged-out-readonly.ad` 与 `search-multi-source.ad` 曾把泛化请求生命周期 marker、上一请求残留节点或不完整来源集合当成当前聚合请求 oracle。后续逐来源空 marker 又进入生产布局，见 `REG-SEARCH-016`。 |
| 必须保持的行为 | 当前已提交的“全部”搜索只有在 `aggregateSearchSources` 中每个来源都有 group，且均非 Loading/LoadingMore、非未结算时，才在既有 FlashList 上暴露唯一 `search-all-sources-settled`。Loading、缺来源、未提交、已编辑但未重新提交或旧请求不得暴露该标记。Replay 零重试；永久 Loading、无恢复入口和来源串扰仍失败，固定数据 UI 测试才打开结果和验证返回。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-002` 要求普通与未登录 Replay 各只提交一次聚合搜索、只等待 `search-all-sources-settled`，并禁止 `search-result-first`、`search-outcome-*` 和动态详情链；`tests/ui/search/search-screen.test.tsx` 固定 catalog 不完整、Loading 与身份 pending 时不结算，并由 `REG-SEARCH-016` 固定自动化状态不污染布局。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 tracked Replay 的等待语义；`DEVICE_REPLAY_PASS` 在真实 Android accessibility 与动态请求时序下证明旅程完成。 |
| Replay 或真实验收路径 | 在身份匹配的当前包执行 `npm run test:device`；另在隔离 AVD 执行 `npm run test:device:logged-out`。两套都只证明当前聚合搜索已覆盖 catalog 全部来源并有限结算；第三方数据可得性与真实详情返回由 Agent Live 单独报告。 |
| 负向验证方式 | 恢复无 catalog 完整性门禁的 `search-complete`、逐来源空 marker、`search-result-first` 或无等待的即时断言，或让 Loading 暴露结算标记，对应 `REG-TEST-002`/`REG-SEARCH-016` 用例必须失败；不靠增加 retries 掩盖竞态。 |
| 明确不覆盖范围 | 不保证第三方来源永远有结果；正确空态、限流或外部错误只证明 App 流程，不能冒充数据成功。 |

## `REG-TEST-003` App 内伪匿名不能代表真实未登录环境

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`FEED-01`、`SEARCH-01/04`、`RELEASE-02` |
| 用户可见行为 | App 内切换一个“匿名”布尔值会创造第二套身份事实；要么真实 Cookie 仍参与网络，要么人为过滤全部 Cookie 并触发本不会出现的 Cloudflare 风控。两种结果都不能代表普通用户真实退出论坛但保留访客/clearance Cookie 的状态。 |
| 触发条件 | 在已有登录数据的主设备上，通过 Debug UI、JS runtime 或 Native Cookie mask 伪造未登录，再据此验收搜索、Feed、媒体或写入门禁。 |
| 根因 seam | 测试需求被实现成产品运行模式，导致 Account、Gateway、write ticket、媒体和 Native 网络层都要维护额外分支；测试环境事实与产品身份事实混在同一进程。 |
| 必须保持的行为 | App 内没有匿名测试入口、override state、runtime mode、Account 特殊终态或 Native Cookie mask；Debug/Release 都只运行正常 session 逻辑。真实未登录使用同一 APK 和独立 AVD，四站 Account Query 必须给出权威未登录事实；NodeSeek 可显示“未登录”或仅访客“已验证”，linux.do 的 UI 文案为“匿名可用”。允许访客 Cloudflare Cookie 自然存在，但不得登录论坛或复制主设备数据。主设备登录态与 Cookie 不变。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx`、`tests/tooling/release-packaging.test.ts` 和 `tests/tooling/android-smoke-guard.test.ts` 固定无 App/Native 模拟入口；`tests/tooling/android-smoke-guard.test.ts` 还固定独立 runner、目录与设备变量，`logged-out-readonly.ad` 固定四站在 relaunch 前后均为权威未登录状态，以及一次聚合 Search 的 catalog-complete 结算和 Feed 的逐来源 outcome，并按 `REG-TEST-004` 区分 NodeSeek 账号身份与访客验证。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` 固定代码和 runner 边界；真正未登录行为必须由隔离 AVD 的 `DEVICE_REPLAY_PASS` 证明，主设备普通 Replay 不能替代。 |
| Replay 或真实验收路径 | 安装同一身份 APK 到未登录论坛的独立 AVD，设置 `WZ_ANDROID_LOGGED_OUT_DEVICE` 后运行 `npm run test:device:logged-out`。如需 Cloudflare，在 App 内原站 WebView 只完成访客验证；Google/CF 风控阻断则记 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 恢复任一 in-app override、Native Cookie mask、特殊 Account 状态，或让未登录 runner回退主设备/默认目录；对应编号测试必须失败。 |
| 明确不覆盖范围 | 不自动创建、克隆或清理 AVD，不删除、导出或记录真实 Cookie/token/身份，不执行真实回复、删除、点赞、收藏、投票、上传或签到。 |

## `REG-TEST-004` 未登录 Replay 把访客已验证误判为账号登录

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-04`、`RELEASE-02` |
| 用户症状 | 独立未登录 AVD 已正确识别 NodeSeek 游客并可走 Google 搜索，但保留访客 clearance 后账号中心显示“已验证”，Replay 仍等待唯一“未登录”文案并在搜索前失败。 |
| 触发条件 | 设备没有 NodeSeek 账号会话，但曾完成访客 Cloudflare 验证；Account Query 因此产生 `status=verified`、`isLoggedIn=false`。 |
| 根因 seam | 设备 oracle 把展示文案当成账号身份谓词，遗漏了现有状态模型中 `verified` 与 `logged-in` 的明确边界。 |
| 必须保持的行为 | NodeSeek `anonymous` 与访客 `verified` 都是权威未登录终态，网站登录计数不增加、写入保持关闭、搜索走匿名 Google fallback；只有 `logged-in` 才能进入登录协议。Replay 只接受准确的“未登录”或“已验证”两种 NodeSeek 标签，不接受“已登录”、pending、unknown 或 expired。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 要求 `logged-out-readonly.ad` 在首次启动与 relaunch 后都使用同一个两分支 selector；旧单文案脚本使该守卫先失败。真实 AVD 上该 selector 已对“NodeSeek，已验证，已选择”命中，同时账号中心显示“网站登录 0/4”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 tracked Replay 的身份语义；`DEVICE_REPLAY_PASS` 证明真实 Android Account Query、访客 Cookie 与未登录搜索流程一致，不证明 Google 当天返回数据。 |
| Replay 或真实验收路径 | 保留隔离 AVD 的访客 Cookie，不登录 NodeSeek、不清数据，执行 `npm run test:device:logged-out`；NodeSeek 身份断言通过后提交一次聚合搜索并等待 catalog-complete 结算，relaunch 后重复同一身份断言。 |
| 负向验证方式 | 把 selector 改回只接受“未登录”，有 clearance 的隔离 AVD 必须复现失败；把“已登录”加入允许分支或让搜索走登录协议，守卫或后续 Google 提示断言必须失败。 |
| 明确不覆盖范围 | 不把“已验证”改名为“未登录”，不删除访客 clearance，不放宽账号 parser，也不新增产品运行模式。 |

## `REG-TEST-005` 动态小隐寺等级被误作固定 Replay oracle

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-06`、`RELEASE-02`；共享 `MORE-01`、`MORE-02`、`MORE-03`、`MORE-04` |
| 用户症状 | 旧 `more-readonly` 在小隐寺等级读取处等待 60 秒后失败，代理、诊断、备份和外观等无关本地旅程也随整条脚本失去证据；等待原站冷却后从同一入口再次读取又能成功。 |
| 触发条件 | 冷启动账号刷新后，固定 Replay 点击“查看等级”，却把第三方实时等级成功响应当作唯一确定性 oracle；历史设备记录曾明确显示“限制 10 秒后再试”，当时 App 已进入可见且可恢复的错误流程。 |
| 根因 seam | 旧 `tests/device/more-readonly.ad` 把“App 是否正确结算请求”和“第三方此刻是否返回数据”压成同一个 pass/fail；成功专属等待在合法错误态下只会空等，并让后续独立 More 旅程 fail-fast。 |
| 必须保持的行为 | `account-readonly.ad` 从已授权账号点击“查看等级”恰好一次，先等待只在 profile/error 时出现的结算标记，再确认成功数据或明确错误共有的“刷新等级”；`more-readonly.ad` 独立覆盖代理、诊断、备份和外观。永久 Loading、错误不可见、无恢复入口、自动请求突发仍是真实失败。产品保持零自动重试。Agent Live 将应用流程与数据读取结果分开报告；只有服务端明确给出可执行的限流/冷却时间时，才等待至窗口结束再加 2 秒并显式刷新一次，不重跑整套或增加全局 retry。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 要求 `account-readonly.ad` 等待等级入口、点击一次、等待 `xiaoyinsi-level-settled` 并确认“刷新等级”，禁止点击刷新和等待成功专属“等级进度”，同时要求 `more-readonly.ad` 不含等级请求；`tests/ui/account/xiaoyinsi-auth-controller.test.tsx` 首次返回明确限流错误，要求零自动重试，显式复试成功后总调用数为 2；`tests/ui/more/more-screen.test.tsx` 固定初始空态没有结算标记，错误与数据态才暴露标记。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 tracked Replay 的结算标记与共同恢复 oracle，`UI_PASS` 固定标记只属于结果态、用户可见失败与显式恢复；Agent Live 分别报告应用流程和真实数据可得性。 |
| Replay 或真实验收路径 | 在身份匹配的设备运行 `npm run test:device`：`account-readonly.ad` 发起一次等级读取并等待共同结算/恢复入口，runner 随后仍独立执行 More 旅程；再执行 `LIVE-ACCOUNT-04`，流程与数据分轴报告。 |
| 负向验证方式 | 在 `account-readonly.ad` 删除“查看等级”点击、结算标记或共同恢复等待，改等成功专属“等级进度”，点击“刷新等级”、增加固定 sleep，或把 runner retries 改为非零，协议守卫必须失败；把等级步骤放回 `more-readonly.ad`、让结算标记在初始空态或 busy 时出现、移除显式复试行为，也必须由守卫/UI 测试拦住。 |
| 明确不覆盖范围 | 不断言所有历史超时都是 HTTP 429，不修改产品请求去重、timeout、User API 调用顺序或自动重试策略；这些产品优化需要单独诊断证据和授权。 |

## `REG-TEST-006` 动态来源成功被错误作为唯一 Replay 终态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`RELEASE-02`；共享 `NAV-02`、`NAV-03` |
| 用户症状 | App 已正确显示空态、限流、验证、来源错误或空 Library，Replay 仍因没有动态首条、详情、用户主题、非空本机数据或第三方 DOM 而失败；同一路径稍后重跑又可能通过。 |
| 触发条件 | 固定 Replay 把第三方“此刻成功且有数据”当作唯一终态，并串联要求随机首条 Topic 的作者仍有主题、设备必须预存 Library 对象或 NodeSeek DOM 保持固定。 |
| 根因 seam | Device Replay 同时承担 App 流程、第三方数据可得性和动态对象前置条件，没有复用 controller/UI 的结果模型；稳定入口与实时内容被压成一个布尔值。 |
| 必须保持的行为 | Feed 和 Search 只在当前请求已结算时暴露 `data/empty/partial/error/auth`；Loading、未提交和旧请求无终态。固定 fixture/UI 严格覆盖每个分支、恢复和导航；Replay 证明 outcome、App-owned 恢复与返回，不读取动态标题、success-only 详情、可变 Library 非空或第三方 DOM。Agent Live 按来源分别证明当前数据可得，正确错误流程不能冒充数据成功。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-006` 先在旧脚本上因 `feed-topic-first`、`search-result-first`、`topic-detail-loaded`、`user-screen-loaded` 和第三方 DOM 失败，再固定六个当前脚本禁止这些无条件 oracle并要求动态 outcome；Feed/Search、Navigation、Library 和 NodeSeek RNTL 分别固定合法分支、永久 Loading 失败与固定返回栈。 |
| 最低可靠自动测试层 | `UNIT_PASS` / `UI_PASS` 固定结果与导航语义，`DEVICE_REPLAY_PASS` 证明 Android App 流程，`LIVE_PASS` 或 `BLOCKED_BY_ENV` 单独描述第三方数据；三层不能互相替代。 |
| Replay 或真实验收路径 | 在身份匹配的 APK 上运行六条普通 Replay 和独立未登录 Replay；随后按 `tests/live/agent-live.md` 的唯一 probe owner 只请求受影响来源一次，分别报告 flow、data 和 infrastructure。 |
| 负向验证方式 | 在 tracked Replay 恢复任一动态首条/详情/User/非空 Library/第三方 DOM 成功条件，移除 outcome，或让 Loading 暴露终态，Android guard 或对应 UI 测试必须失败。 |
| 明确不覆盖范围 | 不降低固定数据断言，不把任意错误都算通过，也不增加 retry、固定 sleep、MockWebServer、录制系统或 fixture DSL。 |

## `REG-TEST-007` 所有旅程经聚合 Feed 启动并制造无关失败与请求突发

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-04`、`ACCOUNT-06`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04`、`RELEASE-02` |
| 用户症状 | Search、Library、账号、NodeSeek WebView 或本地 More 旅程尚未到目标入口，就因聚合 Feed 动态失败而停止；重复 relaunch 又在短时间触发多次无关来源和账号请求。 |
| 触发条件 | 每个 `.ad` 冷启动后统一等待 `feed-list-ready-all`，并把小隐寺等级与多个本地 More 旅程放在同一 fail-fast 文件；普通套件累计八次 relaunch。 |
| 根因 seam | Replay 以一个网络首页作为所有能力的全局 setup，而不是从目标主 tab 建立最小前置；独立失败域和 probe 所有权没有体现在脚本拓扑中。 |
| 必须保持的行为 | 普通套件固定 `account-readonly.ad`、`four-source-feed.ad`、`library-return.ad`、`more-readonly.ad`、`nodeseek-session.ad`、`search-multi-source.ad` 六个文件和六次 relaunch；非 Feed/Smoke 启动后直接等待目标 `main-tab-*`，账号等级与本地 More 分开。未登录套件保持两次 relaunch。runner 仍为文件内 fail-fast、文件间继续、`retries=0`。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-007` 固定六文件集合、普通/未登录 relaunch 数、非 Feed/Smoke 禁止 `feed-list-ready-all`，并要求各旅程等待自己的主 tab；`scripts/smoke-android.mjs` 的 APK sanity 只等待 `main-tab-feed`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定脚本拓扑和 runner 语义；匹配身份的 `DEVICE_REPLAY_PASS` 才证明真实 Android 六个失败域能独立执行。 |
| Replay 或真实验收路径 | 在匹配 revision/version/APK SHA 的设备运行普通和未登录套件，确认某个普通文件失败时后续独立文件仍执行，cleanup/录屏隔离失败则立即停止。 |
| 负向验证方式 | 向任一非 Feed/Smoke Replay 加回 `feed-list-ready-all`，把等级步骤放回 `more-readonly.ad`，增加第七普通文件/额外 relaunch，或把 retry 改为非零，编号守卫必须失败。 |
| 明确不覆盖范围 | 不减少必要的身份前置，不合并独立来源请求，也不引入共享 session、全局 setup、nightly runner 或自动限流规避。 |

## `REG-PROXY-004` 原生代理切换与 bridge 销毁遗留旧连接

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01`；共享 `FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-04` 网络 seam |
| 用户症状 | App 冷启动读取代理配置前可能短暂直连；代理切换、关闭或 React Native bridge 销毁后，旧 tunnel、连通性 probe 和阻塞线程仍存活；并发连接持续创建新线程；WebView 清除回调超时仍提示关闭成功，或在关闭过渡期间提前开始加载。 |
| 触发条件 | 原生 runtime 默认 `localProxy=null`，server 不拥有已接受/上游 socket，handler 与 tunnel executor 无总量边界，切换先发布状态再关闭旧资源，`clearProxyOverride` 的等待结果被忽略，module 没有 owner generation 与原子化 probe invalidation；JS WebView 门禁只在 `enabled=true` 时检查 `applying`。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 `NetworkProxyRuntime`、`LocalNetworkProxyServer`、`NetworkProxyModule`，`src/platform/network/networkProxy.ts`、`src/app/useAppRuntime.tsx` 与 Account/More/Topic owner 的 WebView 门禁，以及 CI 原生编译门禁。 |
| 必须保持的行为 | 原生安装即 blocked；只有持久状态成功读取并完整 apply 后才发布代理或直连。切换顺序为阻断新请求并取消受管 OkHttp → 关闭旧 server 及全部 client/upstream socket（包括正在 connect 的 socket）→ 等待 WebView callback → 发布新状态 → 再等待一次按已发布 runtime 的 WebView 同步。JS 在 `loading`、启用或关闭的 `applying`、失败状态都阻止全部 WebView，只有已结算的直连或代理状态才放行。所有 bridge 的完整 apply transition、begin/commit/release 与 WebView 操作共用同一个串行边界，在边界内校验 owner 并读取 runtime，旧 bridge 的恢复或普通 set/clear 都不得在新 bridge 同步后覆盖状态。连接与 copy executor 有固定上限；新 bridge 注册后旧 bridge 不得提交或释放新 bridge server；`invalidate()` 必须先原子标记 probe slot 已失效并取得当前 probe，再中断 worker、关闭取得的 probe 和自己拥有的 server，期间迟到注册的 probe 必须立即关闭。WebView callback 超时或 bridge wait 被中断时立即排队按当前 runtime 恢复 fail-closed 状态，迟到恢复只有在代理 state generation 真正变化时才再次校正，不能形成无限任务链。日志不得包含目标站点或上游代理地址。 |
| 精确失败 oracle | fresh prebuild 生成的 `NetworkProxyRuntimeTest.kt` 固定启动 blocked、停止关闭 accepted/connecting/established upstream socket、握手失败立即释放、并发上限拒绝、invalidate 取得当前 probe 并拒绝/释放迟到注册、WebView callback 超时/中断与迟到补偿、跨 bridge WebView 串行顺序、旧 bridge 普通写入门禁、恢复重试有界性，以及 bridge owner generation；`src/platform/network/networkProxy.test.ts` 固定启用与关闭的完整 `applying` 期间都阻止 WebView；`tests/tooling/release-packaging.test.ts` 固定切换顺序、发布后 WebView 重同步、owner 校验、全局串行协调器、受管 OkHttp cancel/evict、原生测试生成与匿名生命周期日志。修复前启动断言为 `null`、accepted socket 读超时、connect 中 socket 不归 server 所有、关闭过渡的 WebView 门禁为空、probe 可在 invalidate 读取后迟到注册、旧 WebView restore/normal clear 可晚于新 sync 落地、迟到恢复可无限自排队、新 bridge 注册后旧 commit 仍成功，且 callback/owner helper 不存在。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Android/JVM Kotlin 行为测试；`STATIC_PASS`：fresh Expo prebuild 与 `:app:compileReleaseKotlin`。源码字符串测试只固定生成/接线和日志隐私，不作为原生正确性的唯一证据。 |
| Replay 或真实验收路径 | 仅在用户提供并明确授权代理时，保留 App 数据并启用已保存代理，运行内置固定目标连通性测试和正常只读来源旅程；随后关闭代理并验证直连恢复。全程不修改 Cookie、账号、SecureStore profile 或站点状态。 |
| 负向验证方式 | 恢复初始 `null`、在 connect 后才登记 socket、使用无界 executor、关闭期间按 `enabled=false` 提前放行 WebView、忽略 clear callback 或迟到补偿、只检查 active owner 而不检查最新 bridge，或用可竞态的单一 `activeProbe` 代替 invalidatable slot，对应 Kotlin/TypeScript 测试或打包守卫必须失败。 |
| 明确不覆盖范围 | 不提供 VPN 级全系统连接撤销，不扫描/压测外部目标，不跨 UID 验证，不改变系统代理，也不处理网络攻击或绕过安全措施。 |

## `REG-PROXY-005` CONNECT 成功被误报为完整连通且密码明文输入

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01` |
| 用户症状 | “测试代理延迟”只建立到固定 443 目标的 TCP tunnel 就提示成功，即使 TLS、证书 hostname 或 HTTP 已失败；代理密码在输入框和 Android 可访问性树中以普通文本暴露。 |
| 触发条件 | native `test()` 在 `connectToTarget()` 后立即关闭 socket，UI 把总耗时称为 Ping；密码 `TextInput` 未设置 secure/password 语义。 |
| 根因 seam | 生成的 `LocalNetworkProxyServer.test()`、`src/platform/network/networkProxy.ts` 的 native Promise 计时、`src/platform/network/useNetworkProxyRuntime.ts` 提示与 `src/features/more/components/NetworkProxyModal.tsx` 输入属性。 |
| 必须保持的行为 | CONNECT 后必须以 `HTTPS` endpoint identification 完成 TLS 握手，再请求固定 `/generate_204` 并只接受 204；显示耗时代表整段 TLS/HTTP 往返并统一称“连通性测试”。密码输入必须 `secureTextEntry`，并提供 `password` / `current-password` 语义，不新增显示密码按钮。 |
| 精确失败 oracle | `NetworkProxyRuntimeTest.successfulConnectTunnelStillPerformsTlsHostnameAndHttpVerification` 用本机 HTTP proxy 返回 CONNECT 200，并以 mock TLS transport 固定 read timeout、HTTPS hostname verification、TLS handshake、`GET /generate_204` 和 204 响应的完整调用顺序；`connectivityProbeRequiresTheExpectedHttpResponse` 对空响应和 200 均失败、204 通过；`tests/tooling/release-packaging.test.ts` 固定生产 `SSLSocket` adapter 接线；`tests/ui/more/network-proxy-modal.test.tsx` 固定连通性文案和三项 password 属性。修复前 CONNECT 后立即成功，UI 字段属性均为空。 |
| 最低可靠自动测试层 | `UNIT_PASS`：原生 CONNECT → TLS/hostname → HTTP 请求与响应行为；`UI_PASS`：RNTL 输入与文案；`:app:compileReleaseKotlin` 与生成接线守卫固定生产 TLS adapter 接线，源码字符串不单独作为正确性证据。 |
| Replay 或真实验收路径 | 先用无保存的哑值输入核对密码遮蔽与 Android 可访问性树不暴露明文，再取消草稿；仅在用户提供并明确授权代理时点击“连通性测试”，必须收到完整 TLS/HTTP 成功结果。验收后关闭代理且不改动已保存 profile、账号或 Cookie。 |
| 负向验证方式 | 删除 TLS handshake、hostname algorithm、204 校验或 `secureTextEntry` 任一项，对应原生/UI 测试或编译门禁必须失败。 |
| 明确不覆盖范围 | 不验证特定第三方代理 SLA，不访问论坛账号，不扫描、压测或绕过远端安全控制。 |

## `REG-PROXY-006` 普通站点失败清空全局连接并取消其他站请求

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01`；共享 `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` 网络 seam |
| 用户症状 | NodeSeek 一次普通超时、403 或 fallback 失败后，linux.do、妖火、小隐寺等本来无关的在飞请求一起被取消；随后刷新 More 或重新发请求才恢复。 |
| 触发条件 | NodeSeek 恢复分支调用共享 OkHttp `dispatcher.cancelAll()` 和 `connectionPool.evictAll()`，把站点级错误升级成进程级连接重置。 |
| 根因 seam | `nodeseekFetchFallback` 的推测性网络恢复与 `NetworkProxyRuntime` 共享 dispatcher/connection pool 的资源所有权冲突。 |
| 必须保持的行为 | 全局 cancel/evict 只属于代理配置 transition：应用、切换、关闭代理时先 fail-closed 再清理旧 transport。普通站点 403/429、Cloudflare、超时、解析、账号或 fallback 失败只结算自己的请求，不调用全局恢复。只读 CookieJar 与代理安装在同一 OkHttp client builder，并复用 selector、dispatcher、connection pool；不以另建 client 规避相互影响。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-PROXY-006` 先保持一个 linux.do shared-default transport pending，再连续触发两次 NodeSeek direct timeout/fallback；旧全局 recovery 会取消该 pending Promise，当前实现要求 recovery 零调用且 linux.do 仍成功。`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 另固定两站 hidden fallback 队列互不取消；`tests/tooling/release-packaging.test.ts` 固定生成源码中 `cancelAll()`/`evictAll()` 只剩代理 transition 的一个调用点；生成的 Kotlin test 证明 managed clients 复用同一 proxy selector、dispatcher、pool 与只读 jar。 |
| 最低可靠自动测试层 | `UNIT_PASS` + 原生生成/编译：跨站 Promise 固定用户可见误取消，Kotlin 行为固定共享资源身份；字符串计数只作为调用点守卫。 |
| Replay 或真实验收路径 | 冷启动并行读取多个站点，只记录自然来源失败与其他站最终结果；不得主动断网、破坏账号或反复撞 Cloudflare。真实代理仅在用户提供并授权配置时验证，否则代理 Live 标记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一站点 catch/超时恢复全局 cancel/evict，或给 Cookie bridge 另建独立 client；编号测试会观察到跨站取消、调用点增加或 managed client 资源身份不一致。 |
| 明确不覆盖范围 | 不取消代理 transition 必需的 fail-closed 清理，不修改系统级连接，不增加站点自动重试，也不把真实第三方故障伪装成成功。 |

## `REG-TOPIC-027` Discourse emoji 绕过统一 gateway 且切站迟到落地

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03`；共享 `MORE-01` 网络 seam |
| 用户症状 | linux.do / 小隐寺详情中的 reaction 图片目录直接读取 adapter，绕过 App 当前代理 fetcher、站点凭据、诊断和取消；快速切站时旧目录可能在新站点请求后迟到更新。 |
| 触发条件 | `TopicScreenBody` 直接调用 `getDiscourseSourceEmojiUrls(source)`，只以局部 boolean 忽略部分结果，没有向 transport 传 `AbortSignal`。 |
| 根因 seam | `src/features/topic/TopicRoute.tsx` → `src/sources/readGateway.ts` → `src/sources/discourseRead.ts` 的受管读取边界。 |
| 必须保持的行为 | emoji 目录通过 `ReadGateway.getEmojiUrls`，复用当前 proxy fetcher、同一次站点凭据读取和诊断 trace；Topic 切站、刷新替换或卸载时 abort 旧请求，迟到成功/失败都不得覆盖当前站点目录；继续复用 linux.do / 小隐寺 adapter 现有站点级 emoji cache。 |
| 精确失败 oracle | `src/sources/readGatewayContract.test.ts` 的 `REG-TOPIC-027` 要求同一 credential、受管 fetcher、diagnostic operation 和 signal 到达 adapter；`tests/ui/topic/topic-reply-filters.test.tsx` 切换小隐寺 → linux.do，要求旧 signal aborted，新目录先落地后旧 Promise 再 resolve 也不能覆盖。修复前 gateway 方法不存在，Topic 直接 import adapter。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 Gateway 参数所有权；`UI_PASS` 固定 React effect 取消与可见目录隔离。 |
| Replay 或真实验收路径 | 获得只读网络验收授权后快速切换两站含 reaction 的主题，确认图片始终来自当前站点；本轮不访问论坛，标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 Topic 对 adapter 的直接 import、丢弃 gateway fetcher/auth/signal、移除 cleanup abort 或取消迟到结果门禁，编号测试必须失败。 |
| 明确不覆盖范围 | 不新增 Query 架构，不移除站点级 emoji cache，不执行写操作，也不通过真实账号请求制造竞态。 |

## `REG-TOPIC-028` V2EX 重复楼层被当作回复身份导致大片空白

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | App 内打开 V2EX 主题 `1229472` 并滚动到 67～68 楼时，两条正常回复之间出现超过一屏的空白，后续回复像被错误跳过。重启模拟器后仍稳定复现。 |
| 触发条件 | V2EX API 仍返回网页端未展示的图片/文本回复，HTML 可见楼层压缩后与其合并，两个不同 `commentId` 可能得到相同楼层；其中一条高度较大时更容易暴露。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx` 通过 `src/features/topic/model/replyListModel.ts`、`src/features/topic/model/topicContentIdentity.ts`、`src/features/topic/model/topicHeaderModel.ts`、`src/features/topic/model/topicError.ts` 的 `getReplyKey` 把楼层作为 FlashList 稳定身份，导致不同回复复用同一 key 和历史布局高度；项目已有 `src/domain/forum/feed.ts` 的 `replyKey` 已按 `commentId` 优先表达正确身份。 |
| 必须保持的行为 | 回复存在 `commentId` 时以其作为稳定列表身份：不同 id 即使显示同一楼层也必须是不同列表项，同一 id 即使楼层变化仍保持身份；只有来源没有 `commentId` 时才回退楼层，再缺失时使用既有内容回退。修复不得过滤 API 回复、重编号楼层或改变 V2EX HTML/API 合并。 |
| 精确失败 oracle | `src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicContentIdentity.test.ts` 的 `REG-TOPIC-028` 使用现场对应的 `commentId=17900145` 与 `17900159`，让图片回复和文本回复同为 68 楼，要求 `getReplyKey` 不同；修复前二者都得到 `reply-floor-68`。同文件另固定同 id 换楼层 key 不变、无 id 时仍按楼层稳定。 |
| 最低可靠自动测试层 | `UNIT_PASS`：列表身份是确定性纯逻辑；普通 RNTL mock 不实现 FlashList 原生布局复用，不能替代本条 oracle。 |
| Replay 或真实验收路径 | 使用 App 内部直链直接打开 `https://www.v2ex.com/t/1229472`，不经搜索；滚动到 67～69 楼，确认原空白区域渲染为独立回复内容，后续回复没有消失、重叠或高度串用。全程只读。 |
| 负向验证方式 | 恢复楼层优先的 `getReplyKey`，或在 Topic 另建不含 `commentId` 的 key；编号测试必须重新得到重复 key，现场可再次出现大片空白。 |
| 明确不覆盖范围 | 不决定 API 独有回复是否应显示，不校准网页删除状态或楼层编号，不新增依赖动态原帖的 tracked Replay；原帖内容变化导致现场不再具备重复楼层时记 `NOT_VERIFIED`。 |

## `REG-FEED-007` 返回 Feed 后重复提示缓存的局部错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-04` |
| 用户症状 | 从详情或其他页面返回 Feed 时没有新请求，却再次弹出上一页的来源错误；NodeSeek 错误还可能重复打开验证面板。 |
| 触发条件 | Infinite Query 以 `staleTime: Infinity` 保留 page data，页面重新 active 后 effect 再次消费同一个 `lastPage.errors` 对象。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的局部分页错误副作用。 |
| 必须保持的行为 | 同一个缓存 errors 对象只提示一次；真正的新请求产生新 errors 对象时仍可提示，成功来源和旧页面数据继续保留。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-007` 首次提示后切到 More 再返回 Feed，要求无新 transport、无第二次通知。 |
| 最低可靠自动测试层 | `UI_PASS`：以真实 controller active/inactive 生命周期固定副作用次数。 |
| Replay 或真实验收路径 | Feed 出现自然局部错误后进入 Topic 并返回；若当次没有新刷新，不应再弹旧错误。动态来源无错误样本时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 `handledPartialErrorsRef` 引用门禁后，编号测试第二次进入 Feed 会再次通知。 |
| 明确不覆盖范围 | 不修改分类错误 effect；只有另有红测证明其重放时才处理。 |

## `REG-FEED-008` 分页加载后已浏览主题回跳

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 用户症状 | 首页或单站列表向下加载下一页后，已经滑过的主题重新出现在顶部，当前阅读位置产生明显回跳。 |
| 触发条件 | 新分页包含活跃时间晚于旧页的主题；聚合 Feed 还会在新页落地时重新执行跨来源平衡。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的 `mergeFeedPages` 把顺序分页交给 `mergeFeedResponses`，混淆了“单页内来源聚合”和“跨页追加”，每次分页都全量按活跃度排序并重新平衡来源。 |
| 必须保持的行为 | 加载下一页后，加载前的 `topicKey` 序列必须仍是新序列的完整前缀；新页唯一主题只追加到末尾，重复主题保持原位置；错误继续累积，分页元数据使用最新页。显式刷新仍可采用服务端最新顺序。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-008` 分别建立聚合 Feed 和 NodeSeek 两页数据，让第二页主题拥有更新的 `lastReplyAt`，要求第一页 key 顺序不变且第二页追加；修复前聚合结果变为“第三、第二、第一”，NodeSeek 结果变为“第三、第一、第二”。 |
| 最低可靠自动测试层 | `UI_PASS`：通过真实 `useFeedController`、Infinite Query 和 `loadFeed` 固定用户可见列表顺序；只测试纯合并函数或 FlashList 配置不能覆盖本次迁移 seam。 |
| Replay 或真实验收路径 | App 内首页“全部”和 NodeSeek“新帖子”持续单向下滑触发下一页；请求结算后，已滑过主题不得重新出现，静止时同一可见主题及纵向位置保持。再抽查 linux.do 和一个其他单站。全程只读。 |
| 负向验证方式 | 把 `mergeFeedPages` 恢复为通过 `mergeFeedResponses` 折叠全部页面，编号测试两个参数用例都必须失败。 |
| 明确不覆盖范围 | 不修改 Search、User 或 Topic 列表，不处理 key 顺序保持时仍存在的动态高度位移；后者若能独立复现应建立新的 UI 回归。 |

## `REG-FEED-009` 身份屏障复用可信多页时再次重排

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04`、`ACCOUNT-02` |
| 用户症状 | “全部”已经加载多页后进入登录或验证对账，网络尚未返回，已浏览主题就会换位并带动当前阅读位置回跳。 |
| 触发条件 | 聚合 Feed 存在可信多页缓存且任一来源进入 identity barrier；第二页主题活跃时间晚于第一页。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的可信 identity barrier 合并曾全量重排；改为普通 stable append 后又只从旧页保留 pending 来源，安全响应若只返回第一页会截掉旧第二页的安全来源。解除 barrier 时再把完整展示快照压成一个合成页，真实第一页结算后仍会覆盖旧尾页。 |
| 必须保持的行为 | identity barrier 开始和安全来源刷新结算时都保持当前 topic key 顺序；本 runtime 可信快照中的安全来源与允许复用的 pending 来源都稳定去重保留，重复主题保持原位置。解除 barrier 时保留原页数供 Infinite Query 逐页重读，但迁移期间关闭旧 `hasMore`/cursor，后续页 cursor 只由新第一页响应重建；真实 epoch 变化后仍停止复用变化来源。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 的 `REG-FEED-009` 先加载两页，其中第二页同时含 V2EX 安全主题和 NodeSeek pending 主题；建立 barrier 后新请求只返回第一页 V2EX，要求旧第二页两项都保持。解除 barrier 后服务端按真实 page 1、page 2 分别结算，要求中途及最终完整 key 序列均不截断，且确实发起第二页读取。旧实现会先丢第二页 V2EX，再因合成单页只重读 page 1。 |
| 最低可靠自动测试层 | `UI_PASS`：必须通过真实 `useFeedController`、Infinite Query placeholder 和 identity barrier key 变化固定可见顺序。 |
| Replay 或真实验收路径 | “全部”连续加载至少两页后，仅在自然出现验证或已有安全对账入口时观察 barrier 前后同一可见主题与纵向位置；不清 Cookie、不退出或切换账号制造状态。 |
| 负向验证方式 | 只保留旧 pending 条目，编号测试会在 barrier 安全响应结算后丢掉第二页 V2EX；把解除 barrier 的快照压成一个合成页，则不会发起 release page 2。 |
| 明确不覆盖范围 | 显式刷新仍可采用服务端最新顺序；不处理 topic key 不变但内容动态高度变化导致的位移。 |

## `REG-FEED-010` 启动身份对账让 Feed 旧列表闪现后退回 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 关闭并重新打开 App 时，首页偶尔先显示上次或首个请求的列表，随后退回全屏 Loading，再显示新列表；分类栏也可能同步闪空。 |
| 触发条件 | Feed/Categories 与四站 Account bootstrap 并发，旧 Feed 或温缓存先于身份 probe 结算；随后 barrier 或 session epoch 改变 Query key。 |
| 根因 seam | `useAccountRuntime` 与 `useAccountStatusController` 把“本 runtime 尚未确认身份”初始化成匿名且已结算；首次可信身份建立因而被误判为换号。`useFeedController` 又把所有 pending 来源都当成可复用旧可信数据；TanStack 的 disabled 单站 Query 仍返回温缓存及其错误状态，聚合 observer 在 barrier key 变化时会中止已消费 signal 的旧请求，解除或替换 barrier 后还会直接命中 `staleTime: Infinity` 的旧目标缓存。多个已确认来源同时 pending 时，单站换号清除 aggregate cache 还会连同 presentation-only 的另一站可信条目一起丢失；无 barrier 的直接 epoch 变化在新 Feed 只结算第一页或新 Categories 只返回部分来源后过早覆盖 runtime 可信快照，会在下一次 render 丢掉未变化来源的安全尾页或分类。单站 disabled Query 无数据时若把 `feedBusy` 关掉，会把身份等待误报成空列表。 |
| 必须保持的行为 | 所有 `managedSession` 来源从 App runtime 首帧起进入按来源身份屏障；默认“全部”启动读取还必须遵守 `REG-FEED-011` 的整批身份事务，只在最终快照上执行一次聚合。首次可信身份建立只提交 canonical identity，不触发换号 epoch/reset，并移除该来源尚未受信的服务端 Query；Account canonical/probe、聚合安全投影和其他来源必须保留。普通单站身份迁移中的在途安全读取必须按自己的 barrier snapshot 结算后再切 key。未在本 runtime 成功确认的来源不得从聚合或单站 Feed/Categories 温缓存回显，也不得投影旧 outcome、通知或验证动作；只有本 runtime 已确认后再次 pending 的来源才能只读复用。Feed/Categories 用本 controller runtime 的安全展示快照承接 Query cache reset，并按新旧 epoch 只过滤变化来源；多个来源同时 pending 时，A 换号不得删除仍可信的 B。barrier 变化但 epoch 不变时保留非空安全结果；解除 barrier 时不得回退旧目标缓存，并必须重新读取完整结果。已有非空安全列表时不得回到空列表或全屏 Loading；没有安全条目时正常显示 Loading，单站身份尚未确认也不得显示“当前筛选没有匹配主题”。占位或 barrier 迁移期间必须关闭 `hasMore`，不得使用旧 cursor 分页。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 要求四站初始均为 pending，首次身份建立不触发 change/reset、只清除该来源不可信缓存并保留聚合/其他已确认来源，而已确认来源后来再次 pending 必须取消私有读取；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 要求聚合与单站温缓存私有条目零帧可见，单站旧错误不产生 outcome、通知或验证弹层，无可信单站条目时保持 Loading，在途安全读取不因 barrier 缩小而 abort/restart，解除最后 barrier 后不命中旧 Feed/Categories 快照；两个 confirmed 来源同时 pending 时，NodeSeek epoch 变化并清除 aggregate cache 后，Feed 与 Categories 都必须移除 NodeSeek、继续保留 presentation-only 的 linux.do 和安全来源。该 Feed 场景先用 `old-account-cursor` 加载旧第二页，换号后新第一页返回 `new-account-cursor`，断言新第二页只收到新 cursor。另一个无 barrier 场景在旧第二页含 V2EX 条目时直接改变 NodeSeek epoch，要求新第一页结算和普通 rerender 后该安全尾页仍存在，继续分页只使用 `direct-new-cursor`；迁移期间显式刷新失败继续保留尾页，成功则立即采用该次新 epoch 原始结果并退出稳定占位；刷新尚未结算时离开 Feed 必须取消 owner，返回后仍保留尾页且不提示“列表已更新”。对称的 Categories 场景要求相同 rerender 后 NodeSeek 分类消失、linux.do 与 V2EX 分类仍保留。没有安全条目时回到 Loading，且全部迁移期间旧分页禁用。`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定首次确认缓存对目标来源、Account、aggregate 和其他来源的隔离边界；`src/sources/readGatewayContract.test.ts` 固定 query barrier snapshot 必须成为本次 aggregate read 的 unavailable sources。旧实现分别会触发 reset/abort、回显私有温缓存或旧错误、回退旧列表且不重读、误删未变化 managed 来源、制造空占位、提交旧账号 cursor 或暴露旧 `hasMore`。 |
| 最低可靠自动测试层 | `UI_PASS`：必须通过真实 Account/Feed controller、TanStack Query key/placeholder 和逐次 render 记录固定启动竞态；源码字符串、App 能启动或单次 Smoke 不能证明无中间空帧。 |
| Replay 或真实验收路径 | 在 revision、APK 和设备身份匹配且不清 App 数据/Cookie 的模拟器上连续 force-stop/relaunch 至少 10 次：默认“全部”只允许 `Loading → 最终安全列表`，禁止非空列表再次退回全屏 Loading，且未确认来源旧条目不得出现。再以同 PID 热恢复确认不重置身份或重复加载；Account unknown 时只屏障该站，其他来源继续可见。 |
| 负向验证方式 | 把初始 pending 恢复为 false、让首次身份建立走换号事务、保留首次确认前的单站 Query、直接用最新 barrier 更换在途 Query key、去掉单站条目/错误门禁、runtime 安全快照或解除 barrier 前的安全投影/stale 标记，把 disabled pending 单站视为非 busy，或在 placeholder 暴露 next cursor；编号测试必须分别观察到 reset/abort、私有缓存或旧错误泄露、旧列表回退、误报空列表、变化来源残留/未变化来源消失或额外分页。 |
| 明确不覆盖范围 | 不增加全局 Splash、缓存持久化、FlashList offset/MVCP 补偿或新依赖；如果 topic key 序列无空档且未变化来源顺序稳定后设备仍位移，另立动态高度或布局回归。 |

## `REG-FEED-011` 整批身份对账逐站发布导致聚合请求风暴

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | v1.3.80 启动首页时 Loading 反复出现，站点可能提示操作过于频繁；一次启动日志在 3.536 秒内完成 3 次聚合 Feed、4 次聚合 Categories 和 4 个 Account probe，对应 28 个实际 HTTP，并在首批 30 条已可见后再次出现 2 个 busy 帧。 |
| 触发条件 | 四站 Account probe 并发但依次结算；每移除一个 identity barrier，Feed/Categories 都把中间 barrier 集合发布成新 Query key。 |
| 根因 seam | `useAccountStatusController` 没有表达“整批身份对账事务”，`useFeedController` 又允许逐站 pending/settled 中间态成为聚合 Query 身份；为保护在途安全读取而增加的延迟 key 迁移，反而保证了多个中间请求逐个完整执行。分页的 stable append/去重只处理已返回数据，不参与发请求。 |
| 必须保持的行为 | 首次和后续手动四站对账都由同一个 identity reconciliation transaction 拥有。事务期间不得发起聚合 Feed/Categories，也不得创建中间 barrier Query key；启动保持一段 Loading，事务结算后以最终 barrier/epoch 快照各读取一次。后续对账若最终身份 scope 未变，Feed/Categories 零额外读取且既有列表不进入 Loading；若最终 scope 改变，变化来源立即从安全投影删除，并且最多只对最终快照读取一次。聚合列表的按钮、滚动哨兵和验证恢复都不得命令式绕过事务或沿用旧 cursor；四个 Account probe 仍各站一次，单站切换、登录/验证和分页只受自己的 source-scoped barrier 约束，分页顺序与 cursor 语义不变。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 的 `REG-FEED-011` 固定首次与后续整批刷新从开始到最后一个 probe 结算都保持 transaction pending；`tests/ui/feed/feed-controller-xiaoyinsi.test.tsx` 让四个 barrier 分四帧依次缩小，要求事务中 Feed/Categories 调用均为 0、Query cache 只有初始 barrier 快照，结算后调用各为 1 且使用最终 unknown barrier。随后再执行一次身份不变且旧聚合页仍有 cursor 的整批对账，要求调用数仍为 1、`loadFeed()` 返回 stale、没有中间 Query key，非空列表的所有 render 均 `busy=false`、`refreshing=false`；同时固定 V2EX 单站在无关来源 epoch 变化的整批事务中仍能用自己的 cursor 加载下一页，以及身份进入 pending 前保存的单站验证恢复在后续执行时返回 stale 且不触发 transport。 |
| 最低可靠自动测试层 | `UI_PASS`：必须通过真实 Account/Feed controller、TanStack Query cache 与逐次 render 记录固定请求次数和 Loading 连续性。 |
| Replay 或真实验收路径 | 在匹配 revision/APK/设备身份且不清 App 数据/Cookie 的设备上连续 force-stop/relaunch；每次默认“全部”只出现一段 Loading。导出诊断日志，确认一次启动只有 4 个 Account probe、1 个聚合 Feed 和 1 个聚合 Categories controller intent；再手动刷新账号状态，身份未变时聚合 intent 不增加。 |
| 负向验证方式 | 去掉 reconciliation transaction、允许事务中同步 barrier key、在最终 barrier 尚未写入 controller query snapshot 时提前启用 Query，或只依赖 `enabled:false` 而不关闭命令式聚合分页；编号测试必须观察到中间 Query key、第二次聚合调用、旧 cursor 请求、单站分页被误停或非空列表 busy 帧。 |
| 明确不覆盖范围 | 一个聚合 adapter 为完成单站协议而产生的多个不同 HTTP 不算重复聚合；本回归不改变站点协议、分页、列表排序、FlashList 或滚动位置。 |

## `REG-SOURCE-008` 会话来源清单与 source catalog 漂移

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01` |
| 用户症状 | 新增可登录来源后，普通读取可以工作，但 session epoch 或 identity barrier 未覆盖该站，换号后的旧请求可能落地。 |
| 触发条件 | Gateway 与旧账号组合层各自硬编码登录站点数组，并用断言绕过来源联合类型。 |
| 根因 seam | `src/domain/forum/sourceCatalog.ts` 的会话 capability、`readGateway` epoch snapshot 和 `useAccountRuntime` barrier。 |
| 必须保持的行为 | 每个来源显式声明 `managedSession`；`SessionSource`、`sessionSources` 与类型守卫全部由该字段派生，V2EX 保持非 managed；明确的账号状态 map 继续要求编译期补全。 |
| 精确失败 oracle | `src/domain/forum/sourceCatalog.test.ts` 的 `REG-SOURCE-008` 要求 catalog capability 与派生列表完全一致，且 V2EX 不进入；Gateway 类型只接受 `SessionSource`。 |
| 最低可靠自动测试层 | `STATIC_PASS` + `UNIT_PASS`：类型检查固定调用面，catalog 单测固定运行时派生。 |
| Replay 或真实验收路径 | 新接来源时按架构清单验证换号前后读取；本次现有五站行为由共享回归覆盖。 |
| 负向验证方式 | 恢复硬编码数组或让 `managedSession` 与派生列表脱钩，编号测试或 typecheck 失败。 |
| 明确不覆盖范围 | 不把 topic action 能力当成会话能力，不建设 runtime adapter plugin。 |

## `REG-ACCOUNT-039` linux.do 身份确认后 workflow 仍停在 verifying

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`SEARCH-04` |
| 用户症状 | canonical Account 已确认登录，但验证弹层 workflow 仍显示 verified/verifying、丢失 current user 或关闭写入；原页面恢复失败时还可能把可信身份一起降级。 |
| 触发条件 | `verification-succeeded` 在 recovery 成功分支才派发且缺少完整登录字段，no-recovery 与恢复异常分支没有一致提交。 |
| 根因 seam | `src/features/account/useVerificationController.ts` 的 authoritative reconcile 与 page recovery 顺序。 |
| 必须保持的行为 | canonical reconcile 一旦确认登录，先在所有分支提交 `loggedIn/currentUser/cookieSummary`，再尝试恢复原页；恢复失败只记录原读取错误，不否定身份。没有明确匿名证据时不得通用 `verifying → anonymous`。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 的 `REG-ACCOUNT-039` 覆盖无 recovery、recovery 成功和 recovery 抛错，最终 reducer 均保持完整 `logged-in`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：以 controller 事件顺序和真实 reducer 终态固定行为。 |
| Replay 或真实验收路径 | linux.do 登录态下从受限读取进入验证并检测；有/无恢复均应关闭面板并保持账号可写。真实写入不在默认验收。 |
| 负向验证方式 | 把成功事件移回 recovery 分支或删掉登录字段，编号测试的事件顺序/终态失败。 |
| 明确不覆盖范围 | 不把所有 verification 错误当退出，不修改 canonical Account 的身份判据。 |

## `REG-ACCOUNT-040` Android WebView source origin 被误当成完整页面 URL，Connect 永远不启动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 用户症状 | NodeImage session 已明确失效后，授权弹层进入 NodeSeek Connect 页面却一直 Loading；用户反复打开或触碰页面仍没有结果，并担心每天 20 次 Connect 额度已被消耗。 |
| 触发条件 | 现代 Android `react-native-webview` 的 `onMessage.nativeEvent.url` 只传 `sourceOrigin`（例如 `https://www.nodeseek.com`），旧校验却要求它等于带 `/connect?target=NodeImage` 的完整页面 URL，因此合法 ready 被静默丢弃。ready 又只发送一次且 flow 没有 phase watchdog，bridge 订阅竞态或第三方请求停滞都会留下永久 Loading。 |
| 根因 seam | Native 消息来源 origin、脚本运行 document URL 与 flow nonce/账号 epoch 是三份不同证据；可重试的 bridge ready 握手也不等于受每日配额约束的 `/api/cAuth` 网络调用。 |
| 必须保持的行为 | Native event URL 只按当前 phase 校验 HTTPS origin，兼容现代 origin-only 与旧 bridge 完整 URL；脚本只在顶层窗口且 `location.href` 精确匹配固定 phase 页面时发送，并在每次发送和接受 start 前重验当前地址，并在每条消息中携带 `documentUrl`。两份 URL 证据、nonce、owner、epoch、credential generation 必须同时成立，否则静默拒绝且零 Connect。Connect ready 每 500ms 重发，收到合法 start 后立即停表；Native flow 只领取一次执行权，页面 lexical guard 使 `/api/cAuth` 最多一次。session/Connect/verify 文档从挂载起分别在 30/60/30 秒内结算并卸载 WebView：session 超时不得进入 Connect；Connect 未开始时明确“本次未发起连接”，已开始时明确“结果未知、可能占用一次额度”，两者都不自动重试。透明触摸层、独立 remount、single-flight、owner/epoch/generation、迟到消息和 SecureStore 门禁保持不变。timeout 诊断只记录 `state/reason=timeout`，不记录 URL、nonce、Key 或 payload。 |
| 来源证据 | 本地锁定的 `react-native-webview 13.15.0` 与上游当前 [`RNCWebView.java`](https://github.com/react-native-webview/react-native-webview/blob/master/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java) 都在现代 bridge 路径把 `sourceOrigin.toString()` 传给 JS；升级依赖不能把它变成完整 document URL。现场脱敏 trace 只有 `session-check → session-expired`，没有 `connect-started/connect-finished` 或配额错误；CDP 同时证明 Connect 顶层文档已完成且脚本 bridge 存在，因此只能确认客户端在发网前丢弃 ready，不能从现有证据推断服务端额度已消耗。 |
| 精确失败 oracle | `src/sources/nodeimage/authFlow.test.ts` 的 `REG-ACCOUNT-040` 要求 origin-only source + 精确 document URL 能推进，缺 document、错误 origin/path/query、userinfo、HTTP、非默认端口或 fragment 均零 Connect；`src/platform/network/loginWebViewScripts.nodeimage.test.ts` 要求 500ms ready 可重复但 cAuth 仍一次，三套脚本消息都携带当前固定 document URL，same-document History 导航后停止发消息且零 cAuth；`tests/ui/account/nodeimage-auth-controller.test.tsx` 分别推进 session、Connect 未开始、Connect 已开始与 verify stall，要求 30/60/30 秒后卸载 WebView并显示准确额度语义；`src/platform/diagnostics/diagnostics.test.ts` 要求 timeout 只留下分类字段。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Vitest 执行真实脚本与 flow parser，RNTL 执行 controller phase/timer；源码字符串、App 能启动或只看到 Connect 页面都不能证明修复。 |
| Replay 或真实验收路径 | 只做覆盖安装以保留 App 数据，并核对只读账号状态。当前 NodeImage session 已失效时，未经用户单独授权不得打开修复后的授权入口；专项记 `NOT_VERIFIED`。额度重置并获授权后只执行一次，唯一允许的 trace 为 `session-check → session-expired → connect-started → connect-finished → key-saved`，不手点网页按钮、不上传图片。 |
| 负向验证方式 | 恢复完整 URL 单证据会拒绝 origin-only ready；删除 document URL 会把任意同 origin 页面放进 flow；停止 ready 重发会恢复订阅竞态；在 ready 时直接 fetch、移除两层 one-shot 或 timeout 后自动重试都会使 cAuth 次数测试失败；删除 watchdog 会让 RNTL 在预算后仍保留文档和 Loading。 |
| 明确不覆盖范围 | 不 patch 或升级 WebView，不放宽为同 origin 页面皆可信，不清 Cookie/登录态，不自动重试 cAuth，不执行真实 Connect、图片上传或未授权写操作。 |

## `REG-TOPIC-029` 媒体按目标 URL 猜身份并跨来源携带 Cookie

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | 一个论坛正文引用另一个受管论坛的图片、头像或视频时，App 可能把目标站登录 Cookie 带给作者可控请求；重定向离源后还可能重新获得 Cookie。 |
| 触发条件 | JS 按媒体目标 host 推断 session identity 并手工读取/拼接 Cookie，缺少内容来源和整条重定向链的授权上下文。 |
| 根因 seam | `ForumMediaRequestContext`、所有媒体 source/header 构造和生成的 Android OkHttp Cookie policy。 |
| 必须保持的行为 | 所有 HTTP(S) 媒体携带仅供进程内识别的内容来源标记；原生在发网前移除。只有首跳目标属于内容来源时可读取 Cookie；跨站/未知 CDN 继续匿名加载，任一跳离源后永久降权，跳回也不恢复。普通无标记 API 行为不变。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 与 `src/platform/media/mediaSessionEpoch.test.ts` 固定媒体来源标记/epoch；生成 Kotlin policy tests 固定同源、跨站、无效标记和真实 302 离源后跳回，并单独证明无标记普通 API 不进入媒体策略；视频 UI 测试要求 source 无 JS Cookie。 |
| 最低可靠自动测试层 | `UNIT_PASS` + 原生 Kotlin tests + fresh prebuild compile；JS 测试不能替代重定向与发网前移除证明。 |
| Replay 或真实验收路径 | 只读打开含同源与跨源媒体的 Topic，二者都能请求；诊断只显示来源分类。真实跨站受保护视频未获授权时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复目标 host 身份推断、删除 marker 移除或允许 policy 重新升级后，JS/Kotlin 编号测试失败。 |
| 明确不覆盖范围 | 不把跨论坛媒体拦截为失败，不记录 URL/query/header/Cookie，也不建立 signer/站点通用插件框架。 |

## `REG-TOPIC-030` lazy 图片候选越过主动请求 URL 边界

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 已清洗的安全 `src` 被相对或 `javascript:` lazy/srcset 候选覆盖，正文加载失败；同一候选还可进入全屏预览和保存。 |
| 触发条件 | 图片“发现候选”与“允许主动请求”共用宽松规则，扩展名判断把危险值重新激活。 |
| 根因 seam | `src/platform/media/inlineMedia.ts` 的 source upgrade 与 `src/platform/media/imagePreviewCatalog.ts` 的 preview catalog/tapped URL 结算。 |
| 必须保持的行为 | 相对地址只可作为匹配 alias；正文、预览和保存只接受绝对 HTTP(S)、规范化 protocol-relative URL 或允许的 raster data URI，否则回退已清洗 `src` 或不发请求。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 的 `REG-TOPIC-030` 覆盖 unsafe lazy、不安全 catalog 候选以及直接点击危险/相对 URL，三者都不能成为 active URL。 |
| 最低可靠自动测试层 | `UNIT_PASS`：从公开 HTML/preview 接口固定最终主动 URL。 |
| Replay 或真实验收路径 | 打开含 lazy/srcset 的只读 Topic，正文与预览显示同一安全图片；保存需单独授权。 |
| 负向验证方式 | 在 upgrade 或 tapped preview 处恢复宽松候选，编号测试会出现 `javascript:x.png` 或相对 URL。 |
| 明确不覆盖范围 | 不删除相对 alias 的匹配能力，不允许 SVG data URI，不改变公开图片加载。 |

## `REG-TOPIC-031` 全屏预览快速缓存命中后永久 Spinner

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片已经由缓存立即显示，但全屏预览仍永久显示“图片加载中”。 |
| 触发条件 | 子 Image 的同步/快速 `onLoad` 先结算，父组件随后执行的 passive reset 又把多个 loading/failed/resolution state 改回 loading。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的 request identity 与终态结算。 |
| 必须保持的行为 | 每个 request identity 只有一个 `{status,resolution}` 状态；identity 不匹配时派生 loading，不用 passive effect 或 `onLoadEnd` 重置；`onLoad` 直接 loaded，旧 identity 事件忽略。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-031` 让 mock Image 在 layout phase 立即 `onLoad`/`onError`，覆盖 StrictMode effect replay、A→B→A 重访与上一 activation 的迟到事件；当前 activation 必须独立结算，成功不得残留 Spinner，失败必须显示终态。 |
| 最低可靠自动测试层 | `UI_PASS`：必须真实覆盖 React layout/passive effect 顺序。 |
| Replay 或真实验收路径 | 同一图片先在正文加载，再立即打开全屏并重复退出/进入，缓存命中后 Spinner 应消失。 |
| 负向验证方式 | 恢复 identity-change passive reset 后，编号测试稳定停在 loading。 |
| 明确不覆盖范围 | 不用固定延时猜测成功，不改变缩放、切图或保存交互。 |

## `REG-TOPIC-032` 原生图片请求无总时限导致永久 pending

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 服务器接受连接但不完成响应时，正文或预览图片可以无限转圈且没有失败终态。 |
| 触发条件 | Expo Image/Glide 继承 React Native 全零 timeout OkHttp client，stalled call 永不回调。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 的 Expo Image client 安装。 |
| 必须保持的行为 | 只给 Glide clone 设置 30 秒 `callTimeout`；RN 基础 client 保持 0 以保留前后台请求预算，Expo Video 不继承图片总时限。超时后 Image 必须通过 error 路径结算 failed。 |
| 精确失败 oracle | 生成 Kotlin test 比较 base client `callTimeoutMillis == 0` 与 image clone `== 30000`；`tests/tooling/release-packaging.test.ts` 固定生成模板和 video patch 不含该 timeout。 |
| 最低可靠自动测试层 | 原生 Kotlin tests + fresh prebuild compile；JS timer mock 不足以证明 Glide 网络行为。 |
| Replay 或真实验收路径 | 使用可控 stalled 图片端点时 30 秒内进入失败；没有安全端点时只报原生自动证据，设备标 `NOT_VERIFIED`。 |
| 负向验证方式 | 让 Glide 直接复用 base client 或把 timeout 加到 base/video，生成测试失败。 |
| 明确不覆盖范围 | 不改变 `REG-TOPIC-021` 的普通请求后台预算，不给长视频设置 30 秒总时限。 |

## `REG-TOPIC-033` HTML 图片属性被重复解码

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片 URL 中本应保留的字面 `&lt;` 被再次变成 `<`，增补平面数字实体也可能被截断。 |
| 触发条件 | DOM parser 已解码属性，后续 helper 又按多趟替换；`&amp;lt;` 在一轮调用内被解两次。 |
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的 DOM 属性读取与 raw regex fallback 解码边界。 |
| 必须保持的行为 | DOM 属性直接使用 parser 结果；只有 raw fallback 调用现有单趟 `decodeHtml` 一次，并保持 `fromCodePoint` 语义。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 的 `REG-TOPIC-033` 输入 `&amp;lt;`，公开提取结果必须是字面 `&lt;` 而非 `<`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：固定 parser 与 fallback 的确定性输出。 |
| Replay 或真实验收路径 | 动态 Topic 无需特意构造实体；相关图片能正常请求即可，畸形实体主要由 fixture 验证。 |
| 负向验证方式 | 恢复 `&amp;` 后再逐类 replace 的多趟 decoder，编号测试失败。 |
| 明确不覆盖范围 | 不对 DOM parser 结果做第二次全局 decode，不改变正文文本解码。 |

## `REG-TOPIC-034` 大 SVG 兼容清洗退化为逐字符全尾扫描

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片解码失败后兼容读取接近 1 MiB 的 SVG 时，JS 线程长时间冻结，详情和全屏预览无法操作。 |
| 触发条件 | 旧兼容链为迁就 AndroidSVG 改写整个 SVG，并在扫描标签时反复复制剩余字符串，Hermes 中累计工作量接近 O(n²)。 |
| 根因 seam | `src/platform/media/compatibleImageSources.ts` 把“不可信 SVG 文档”错误建模为“清洗后继续交给 AndroidSVG 的图片字符串”。 |
| 必须保持的行为 | SVG artifact 保留原始字节，不在 JS 扫描、删除或重写任意元素；只执行大小/MIME/根元素/固有尺寸等有界判断，随后把 base64 文档交给隔离 Chromium renderer。接近 1 MiB 的输入处理保持 O(n)。 |
| 精确失败 oracle | `src/platform/media/compatibleImageSources.test.ts` 的 `REG-TOPIC-034` 输入接近上限且含 `<a>`、quoted `>`、动画和嵌套 data SVG，要求 artifact 解码后与输入逐字节相同并只调用一次 renderer；恢复 strip/rewrite 时字节相等断言失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性验证原始字节、输入上限与单次 renderer 调用，不使用机器相关的毫秒阈值。 |
| Replay 或真实验收路径 | 打开明确返回大 SVG 的只读主题并触发正文或全屏兼容恢复，确认页面可继续操作；没有稳定动态样本时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复任何 link strip/rewrite 后，编号测试的原始字节断言失败；恢复无界输入读取时超限 fixture 失败。 |
| 明确不覆盖范围 | 不放宽 1 MiB 响应上限，不执行脚本或外链，也不为一般位图新增转换；Chromium 安全策略见 `REG-TOPIC-038`。 |

## `REG-TOPIC-035` Discourse 引用显示名被当作可导航用户名

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`、`NAV-02` |
| 用户症状 | linux.do 或小隐寺引用缺少 `data-username` 时，显示名、头像路径或标题回退被当成 username；点击作者会进入不存在或错误的用户页。 |
| 触发条件 | 回复模型用单个字符串同时表达引用作者的显示标签和站内路由身份，两套 Discourse adapter 的回退规则又各自漂移。 |
| 根因 seam | `src/sources/discourse/content.ts` 的共享 Discourse 引用解析、`Reply.quotedPosts[].author` 数据模型与 `ReplyItem` 导航门禁。 |
| 必须保持的行为 | 引用始终可显示最可靠的 `label`；只有原始 `data-username` 能产生可导航 `username`。display-name、头像 URL 和标题只作 label；linux.do 与小隐寺使用同一解析实现，本主题引用继续移出正文并保留摘要。 |
| 精确失败 oracle | `tests/ui/topic/topic-components.test.tsx` 的 `REG-TOPIC-035` 构造只有 label 的引用，要求显示标签且点击不调用 `onOpenUser`；`tests/integration/source-read-contracts.test.ts` 固定头像回退只有 label，显式 username 同时保留两字段；`src/sources/xiaoyinsi/reader.test.ts` 固定同一结构。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：来源归一化与真实 ReplyItem 点击行为。 |
| Replay 或真实验收路径 | 在两站只读打开含本主题引用的回复；有 username 的引用可进入正确用户页，只有显示标签的引用不可点击。动态页面没有 display-only 样本时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 把 quoted author 恢复为字符串，或用 label 构造用户对象，UI 编号测试会重新导航；删掉任一 adapter 的共享解析后来源测试失败。 |
| 明确不覆盖范围 | 不根据显示名猜用户名，不对跨主题引用建立本地楼层关系，也不统一五站非 Discourse 引用协议。 |

## `REG-TOPIC-036` NodeSeek 渲染分页缺楼层时从 1 重新编号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | NodeSeek 第 2 页缺少 `.floor-link` 和数字 id 时从 1 重新显示楼层，与首屏重复；点赞等 embedded 元数据还可能因错误楼层匹配而丢失。 |
| 触发条件 | 渲染解析层立即用页内 index 补楼层，使消费层无法判断字段缺失、无法应用 page/offset，也让 `missingFloorCount` 永远为 0。 |
| 根因 seam | `src/sources/nodeseek/topicParser.ts` 的渲染楼层解析，以及 `src/sources/nodeseek/reader.ts` 的 Topic 首屏与 replies 分页消费。 |
| 必须保持的行为 | 解析层保留 `floor: undefined`；首屏按 1 起补齐，后续页按当前 offset 补齐；在补齐前记录真实缺失数量，显式楼层和 commentId 优先级不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts.test.ts` 的 `REG-TOPIC-036` 读取 offset=30 的第 2 页无标记渲染 HTML，要求楼层为 31、32 且诊断缺失数为 2；既有首屏测试固定从 1 开始。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性 HTML fixture 同时覆盖显示楼层和诊断。 |
| Replay 或真实验收路径 | NodeSeek 主题只读加载至少两页，若自然页面缺标记则确认楼层连续；动态页面不强制制造上游缺陷。 |
| 负向验证方式 | 在解析层恢复 `fallback=index+1`，编号测试会重新得到 1、2 且缺失数为 0。 |
| 明确不覆盖范围 | 不重编号原站显式楼层，不改变 commentId 身份、页大小或分页 cursor 协议。 |

## `REG-TOPIC-037` 带身份媒体被未分区 HTTP cache 跨会话复用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 用户症状 | 同一媒体 URL 在账号 A 下返回的私有内容可能被匿名状态或账号 B 直接从 OkHttp cache 复用，即使新请求已不携带 A 的 Cookie。 |
| 触发条件 | 上游返回可缓存响应但未声明 `Vary: Cookie`；OkHttp cache key 以 URL 为主，媒体请求虽按来源控制 Cookie，却仍进入与普通请求共享、未按身份分区的 transport cache。 |
| 根因 seam | 生成的 `ForumMediaRequestInterceptor` 与 OkHttp `CacheInterceptor` 之间的 request cache policy；Expo/Glide 的 session epoch 上层 cache 是独立边界。 |
| 必须保持的行为 | 所有带内部媒体标记的请求在移除标记和显式 Cookie 时同时设置 request `Cache-Control: no-store`，既绕过已有共享 HTTP cache，也不写入新条目；同源仍可实时读取当前 Cookie，跨源仍匿名请求，普通无标记 API cache 不变，上层 epoch 媒体 cache 保留。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest.kt` 用真实 OkHttp `Cache` 和本地服务器依次证明：无标记请求可种下旧私有 cache；跨源标记请求必须得到新的匿名网络响应而非旧条目；同源标记响应不得被随后无标记请求复用。修复前第二步预期 `network-2`、实际 `network-1`。 |
| 最低可靠自动测试层 | fresh prebuild 后的原生 Kotlin `UNIT_PASS`；JS 字符串守卫只确认生成模板包含策略，不能替代真实 cache 行为。 |
| Replay 或真实验收路径 | 在不清 Cookie、不写论坛的前提下，用两个已授权身份重复读取同一受保护媒体并核对内容与诊断；本轮未获真实换号授权时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 request `no-store` 后，编号测试会从已种下的共享 cache 得到 `network-1`；若全局禁用 RN cache 或误伤普通 API，模板/普通请求断言失败。 |
| 明确不覆盖范围 | 不建立按账号分区的 OkHttp client/cache，不要求服务端补 `Vary: Cookie`，不关闭普通 API cache，也不改变 Expo/Glide 上层媒体缓存。 |

## `REG-TOPIC-038` 复杂动态 SVG 被重复交给 AndroidSVG 后仍加载失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 用户症状 | NodeSeek `post-841430-1` 的正文图片持续 Spinner 或失败；响应实际是合法 SVG，切到 data URI 后仍无法显示，去掉链接包装也无效。 |
| 触发条件 | SVG 同时包含 `<tspan>` 的 objectBoundingBox 渐变、CSS 初始透明与 animation、SMIL、filter 和嵌套 data SVG；AndroidSVG 1.4 在渐变文字 bounding box 未建立时 NPE，且不具备完整 CSS/SMIL 语义。 |
| 根因 seam | `src/platform/media/compatibleImageSources.ts` 曾把失败 SVG 改写后再次交给 Expo Image 的同一个 AndroidSVG decoder；正文与全屏没有共享“SVG 文档 artifact”边界。 |
| 必须保持的行为 | 位图和 AndroidSVG 可解 SVG 继续走原生快路径。只有原生失败后才由项目受管 OkHttp client 复取；10 秒、明确 SVG MIME 与按流读取 1 MiB + 1 byte 的门禁必须发生在数据过桥前。门禁成功后保留原始 SVG 字节并 single-flight 生成 artifact，固有尺寸只读已验证的真实 XML 根元素；进程内单例 Chromium renderer 串行生成有界 PNG 海报，正文仍由 Expo Image 显示。静态 artifact 的全屏继续使用海报；只有当前动画 artifact 挂载一个禁网络、禁文件/content 访问且不可执行原始 SVG 脚本的 document view，并先按 artifact 固有尺寸显示正文海报。固定 nonce 的本地 readiness bridge 只能回报内层 data image 就绪/失败，Android 动态 document view 使用平台默认合成层，且按 `REG-TOPIC-045` 永不进入缩放树。相邻 Pager 页不得启动昂贵恢复；普通图片和静态 artifact 不创建全屏 WebView。session epoch 变化使用新 identity，旧海报、事件和 artifact 不得落地；海报文件被原生 LRU 淘汰时从 artifact 原始字节重建一次且不重新发网；海报队列等待也计入 30 秒终态。保存继续下载原 URL 并保留 `.svg` 原始字节。 |
| 精确失败 oracle | `tests/fixtures/complex-svg-document.svg` 固定本次结构；`src/platform/media/compatibleImageSources.test.ts` 要求原文档不改写、精确 1 MiB 门禁、海报单飞/缓存与淘汰重建、真实根元素比例，并证明接近 30 秒 deadline 才出队的下载只能使用剩余预算；`tests/ui/topic/topic-image-loading.test.tsx` 固定正文海报、十图正文无 WebView、迟到 epoch 丢弃，`tests/ui/topic/image-preview.test.tsx` 与 `tests/ui/shared/compatible-svg-document-view.test.tsx` 固定相邻页零兼容恢复、缓存 artifact 固有尺寸、正文海报首帧、当前页单 WebView、平台默认合成层、nonce readiness bridge 及其余安全 props。生成的 Kotlin policy test 固定原生流式 `MAX+1` 中止、输入/画布/cache 上限、根元素比例、队列有界和旧页面错误隔离；instrumentation test 用真实 AndroidSVG/Chromium 固定旧 decoder 失败、十张非空海报复用一个 WebView、动画两帧变化和恶意外链零请求。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + fresh prebuild 后原生 Kotlin JVM/instrumentation tests 与 compile；身份匹配 APK 仍需 `DEVICE_REPLAY_PASS` 固定真实 Topic 集成链。 |
| Replay 或真实验收路径 | 覆盖安装当前 APK 后用 `exp+wz-android://open-topic` 直达 `https://www.nodeseek.com/post-841430-1`；正文必须出现完整静态海报而非永久 Spinner，点击后当前全屏项播放动态 SVG，退出重进命中海报缓存。全程只读，不清 Cookie/App 数据；保存需单独授权。 |
| 负向验证方式 | 把 artifact.posterSource 改回 SVG data URI，真实 fixture 会再次进入 AndroidSVG 失败；允许每张正文图创建 WebView时，十图组件测试/原生实例计数失败；开启 JS/文件/网络或允许外部导航时安全 props 与原生策略测试失败。 |
| 明确不覆盖范围 | 不执行 SVG JavaScript、事件交互或外部子资源，不把整个 Topic 交给 WebView，不新增服务端代理，不用 Coil 或 `react-native-svg` 作为任意 SVG renderer，也不授权真实保存。 |

## `REG-TOPIC-039` NodeSeek 用户名 mention 被候选 UID 优化误作内部导航门禁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`USER-01`、`NAV-02`；共享回归 `USER-02`、`LIBRARY-02`、`NAV-03` |
| 用户症状 | 同一 NodeSeek Topic 中，有些正文或回复里的 `@用户` 能进入 App 用户页，有些却打开 Google/Chrome；能否内开取决于当前已加载 Topic 数据中是否碰巧带有该用户的数字 UID。 |
| 触发条件 | `/member?t=username` 点击解析把当前 Topic/detail candidates 中的数字 UID 命中当成内部导航前置条件；候选 miss 返回 `null`，随后被通用链接逻辑当成外部 URL。回复目标、引用作者和签名还可能用 `topics: []` 或 `id=username` 伪造 `UserProfile`，把导航定位与 canonical 用户身份混在一起。 |
| 根因 seam | `parseForumUserLink` 与 Topic 共享 HTML 点击入口、`UserReference`/`UserProfile` 边界、NodeSeek username resolver、`ReadGateway` 和 User controller 的 Query identity。 |
| 必须保持的行为 | NodeSeek `/member?t=username` 只要 host/path/query 精确合法就产生内部 `UserReference`；当前 Topic/detail candidates 只做有界数字 UID hint，命中时零 resolver 请求，miss 或非法 hint 仍保留 username reference。`/space/{uid}` 直接使用 canonical 数字 UID，零 resolver。username-only reference 立即进入 App User 页，并在受管 NodeSeek 会话下通过 `/api/account/find/{encodeURIComponent(username)}` 扫描完整 `memberList`：先接受 trim 后大小写敏感完全一致，否则只接受唯一的大小写不敏感完全一致；无匹配、多个冲突、非法 `member_id` 或失败响应均拒绝。已确认未登录和 identity barrier 零 transport。解析成功后 Profile、主题、回复、分页、Query key 和关注只使用 canonical 数字 UID；UserReference 不持久化、不关注。解析中显示 Loading，失败显示错误、刷新和显式原站主页，普通网络/429/登录要求不自动重试、不自动打开浏览器；可信 Cloudflare 验证只恢复原 User Query。切用户、返回或 epoch 变化取消旧请求，迟到结果不能覆盖当前 User。Discourse 继续只用明确 username 导航，不把 display label 猜成 username。诊断只记录脱敏引用，不记录 username、`memberList` 或完整 URL/query。 |
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-TOPIC-039` 固定 candidate hit 返回 UID，而 candidate miss/非法 hint 仍返回 username reference；`tests/integration/source-read-contracts.test.ts` 固定 exact 结果位于完整 50 条列表后部、Unicode、大小写唯一兼容、冲突、无匹配、非法 UID、失败响应、429 与未登录零 transport；Gateway/Query 测试固定 managed credential、UA、signal、trace、同 username+epoch 去重与换 epoch 重解；Topic/User UI 测试固定正文、回复正文、回复引用和签名共用内部入口，解析前零 Profile/零关注，成功后 Profile/分页/关注只使用 UID；`src/domain/reader/readerData.test.ts` 拒绝 `nodeseek:{username}`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：parser、adapter/Gateway、Query identity、Topic 点击与 User 两阶段渲染使用确定性 fixture；不以源码字符串或动态用户名替代行为 oracle。 |
| Replay 或真实验收路径 | 条件式 `LIVE-READ-04` 在 revision、版本和 APK 身份匹配且 NodeSeek 登录已确认的设备上，直达指定只读 Topic，逐个检查正文、回复和数字 `/space/{uid}` 用户链接；每个 username 最多一次真实 resolver probe，目标 User 加载后物理返回并保持原 Topic 与回复位置。不得执行真实写操作或用连点制造 429。 |
| 负向验证方式 | 删除当前 Topic 中该 username 的候选后，parser 仍必须返回内部 reference；让模糊结果排在 exact 前面不得选错；把 Profile key 恢复 username 分叉、解析前显示关注、或把普通 resolver 失败交给 external callback 时，对应编号测试失败。lookalike host、空参数、`/member?q=`、无 href 纯文本 mention 和 Discourse label-only 引用继续不可导航。 |
| 明确不覆盖范围 | 不解析没有可信 href 的纯文本 `@name`，不扫描分页回复建立全量候选表，不预取全文用户，不建立通用跨站身份服务或持久 username→UID 映射，不自动重试 429，也不改变 ReaderData schema。 |

## `REG-TOPIC-040` 正文误把预览原图当作适屏图片下载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 用户症状 | 浏览器中秒开的论坛图片在 App 正文等待十几秒甚至离页仍未完成；窄屏正文实际下载了灯箱原图或 `srcset` 最大候选，耗时和字节数远大于展示所需。 |
| 触发条件 | HTML 预处理把 `<a href>` 灯箱 URL 或最大 `srcset` 候选覆盖进正文 `src`，并让一个 URL 同时承担正文展示、全屏预览和保存。 |
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的图片候选解析与预览 alias catalog、`src/platform/media/inlineMedia.ts` 的正文 source 选择，以及 `src/features/topic/rendering/previewRenderers.tsx` 的最终 native source。 |
| 必须保持的行为 | 每张 HTML 图片形成最小双层模型：`displayUri` 必须是正文首个请求，`originalUri` 用于全屏、保存及 `REG-TOPIC-048` 约束的第二阶段清晰升级。`w` 候选选择首个满足 `contentWidth × DPR` 的宽度，否则最大；`x` 候选选择首个不低于 DPR 的倍率，否则最大。安全且非占位的 `src` 在候选不完整时优先；灯箱原图不得覆盖正文首个请求。所有 alias 仍结算到同一预览项，主动 URL 继续遵守 `REG-TOPIC-030`。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 的 `REG-TOPIC-040` 固定 `w/x srcset` 临界点、DPR、无描述符回退、占位 src、非法候选、alias 去重和 display/original 分离；`tests/ui/topic/topic-image-loading.test.tsx` 用含小适屏图与大灯箱图的真实 renderer props 断言适屏图完成 `onLoad + onDisplay` 前 native source 只收到适屏 URL，点击后预览仍指向原图。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：解析器固定候选算法，RNTL 固定最终 native source；源码字符串或仅验证 catalog 不足以证明正文没有下载原图。 |
| Replay 或真实验收路径 | 用“大原图 + 小适屏图 + 可暂停响应”的受控只读端点打开 Topic，核对正文命中的候选、最终字节数和预览原图。今日日志没有保存图片 URL；重新取得原帖/图片入口前，幺火该资源专项标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复灯箱 URL 覆盖正文首个请求、无条件先取最大候选或让原图早于适屏图 `onDisplay` 启动，编号测试会收到大图 URL；放宽危险候选会同时触发 `REG-TOPIC-030`。 |
| 明确不覆盖范围 | 不新增全局请求队列、ImageManager、OkHttp 响应缓存或后台全量预取，不猜测 CDN 变体，也不把原图降质后保存。 |

## `REG-TOPIC-041` 不同会话 epoch 的同 URL 图片请求被 Glide 合并

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | 账号切换、退出或登录更新时，新会话请求与旧会话尚未结束的同 URL 图片可能共用旧 Glide 在途结果，造成旧私有图片进入新页面或新请求无法独立结算；预览保持打开时还可能继承旧会话的放大状态，导致新页无法横滑或动画层继续隐藏。 |
| 触发条件 | session epoch 只进入 Expo `cacheKey`/`recyclingKey`，没有进入 Glide request model equality；Glide 会按模型相等性复用正在进行的 EngineJob。预览页虽然按 identity 重建，请求树外的缩放与 Pager state 若不跨 epoch 重置，仍会灌给新的 1 倍页面。 |
| 根因 seam | `src/platform/media/mediaRequestContext.ts` 的远程图片 source、`plugins/withNetworkProxyModule.js` 的出网拦截器、Expo `GlideUrlWithCustomCacheKey` 模型相等性，以及 `src/ui/media/ImagePreviewModal.tsx` 的 session identity 边界。 |
| 必须保持的行为 | 每个远程论坛图片 source 同时携带内容来源 marker 与 opaque `X-WZ-Forum-Media-Identity`；identity 使用不含账号凭据的现有 sessionIdentity，使同 epoch、同 URL、同尺寸模型仍相等，不同 epoch 模型必不相等。预览仍打开时，identity 变化必须重建内容状态，使新会话从 1 倍、Pager 可横滑且动画 document 可见开始。两个内部头和任何 JS Cookie 都必须在发网前移除；Cookie 同源/重定向策略与 request `Cache-Control: no-store` 不回退，孤立 identity 头也不得泄露到普通网络。 |
| 精确失败 oracle | `src/platform/media/mediaRequestContext.test.ts` 固定同 URL 不同 epoch 产生不同 identity header；`tests/ui/topic/image-preview.test.tsx` 先在 epoch 4 放大并锁住 Pager，再切到 epoch 5，要求 source/recycling key 更新、Pager/Zoom mount token 更换且交互状态立即回到 1 倍初始值，旧 Pager 排队的 `onPageSelected` 不能再调用新会话的 `onSelect`；fresh prebuild 生成的 `NetworkProxyRuntimeTest.kt` 用真实本地 HTTP 请求证明两个内部头均未出网、Cookie/no-store 保留，并直接断言 Expo `GlideUrlWithCustomCacheKey` 同 epoch 相等、不同 epoch 不相等。 |
| 最低可靠自动测试层 | `UNIT_PASS` + fresh prebuild 后原生 Kotlin `UNIT_PASS`/compile；JS cacheKey 断言或源码字符串不能证明 Glide EngineJob 不合并。 |
| Replay 或真实验收路径 | 用可暂停的同 URL 受控图片端点，在请求在途时推进同来源 epoch，要求新 native target 独立发起且旧页面不收到完成回调。没有安全端点或未获真实换号授权时设备专项标 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除 identity header、固定其值或让原生在模型构造前删掉它，会使不同 epoch 模型重新相等；停止出网前移除则本地服务器会收到内部头。 |
| 明确不覆盖范围 | 不清空全局图片缓存、不为每个账号创建 OkHttp client/cache、不把 Cookie、账号名或 token 放进 identity，也不改变普通无标记 API。 |

## `REG-TOPIC-042` App 重启后私有图片磁盘缓存命名空间复用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 用户症状 | App 重启后切到不同账号或匿名状态，同一 URL 可能直接显示上一进程写入的私有图片磁盘缓存。 |
| 触发条件 | 私有媒体 `cacheKey` 只包含来源和从 0 重新开始的 session epoch；新进程会重新生成相同 key。 |
| 根因 seam | `src/platform/media/mediaSessionEpoch.tsx` 的媒体 session identity 与 Expo/Glide `memory-disk` cache namespace。 |
| 必须保持的行为 | 私有来源 identity 同时包含不含凭据的进程 nonce 和当前 epoch：同进程同 epoch 可复用，换 epoch 或重启后不可命中旧私有磁盘条目；V2EX 等 public 媒体继续使用稳定公共 namespace。nonce 只参与内部 model/cache key，并随内部头在出网前移除。 |
| 精确失败 oracle | `src/platform/media/mediaSessionEpoch.test.ts` 以两个重新加载的模块实例模拟进程重启，固定同来源同 epoch，要求私有 identity 不同、公共 identity 不变；`tests/ui/topic/image-preview.test.tsx` 与 `tests/ui/shared/avatar.test.tsx` 固定生成 identity 进入 source/cache/recycling key。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`；仅验证 epoch 递增不能覆盖跨进程 key 重用。 |
| Replay 或真实验收路径 | 保留登录态 replace-install/force-stop 后重开同一含私有图页面，确认当前会话重新授权并加载；真实换账号/退出仍需用户授权，没有授权时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除进程 nonce 或固定其值，跨模块实例测试会重新得到同一私有 identity。 |
| 明确不覆盖范围 | 不清空全局图片缓存、不持久化账号标识、不把 Cookie/token 写进 key，也不牺牲公共图片跨进程磁盘复用。 |

## `REG-TOPIC-043` 复杂静态 SVG 全屏误启 Chromium 导致掉帧与缺层

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 复杂静态 SVG 在正文已完整显示，进入全屏后却出现掉帧、局部图层缺失；设备日志反复出现 Chromium tile memory 超限，严重时 App 进程退出。 |
| 触发条件 | 原生 SVG 解码失败后的兼容 artifact 无论是否包含动画，都在当前预览页挂载完整 Chromium document view。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 对 `CompatibleSvgArtifact.animated` 的消费边界。 |
| 必须保持的行为 | 静态 artifact 在正文、当前预览页和相邻预热页都只显示已经生成的 PNG poster，不再挂载第二个 Chromium renderer；当前静态页使用高优先级且禁用下采样，`onDisplay` 才结算可见成功。只有 `animated` artifact 的当前页可挂载隔离 document view，并以同一 poster 保持首帧连续；相邻页仍不得启动 WebView。保存始终重新读取原始 SVG。 |
| 精确失败 oracle | `src/platform/media/compatibleImageSources.test.ts` 固定 `<set>`、inline/CSS animation 为动态，而 `animation:none`、无动画名 shorthand/list、未使用 keyframes 与注释保持静态；`tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-043` 让带相对单位的静态 SVG 进入兼容恢复，要求当前页显示 artifact poster、无 `compatible-svg-document-view`、`onDisplay` 前 Spinner 保留；已显示的缓存 poster 失效后只从 artifact 重建且不复取 SVG，重建失败时显式重试仍可恢复。deferred 动画用例让 document 先 ready、页面切到邻页后才完成 poster 重建，要求回访使用新 revision；`REG-TOPIC-018/020` 同时固定动画当前页 document view 与相邻页零恢复。 |
| 最低可靠自动测试层 | `UI_PASS`：组件消费真实 artifact 分类；设备只读验收补充 Chromium 进程/日志与视觉稳定性。 |
| Replay 或真实验收路径 | 打开一个已确认不含 SMIL/CSS animation 的复杂静态 SVG：正文和点击后的全屏首帧均立即可见，CDP 只有海报生成期的离屏 renderer，预览本身不新增 document view。没有稳定受控端点时设备专项标 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 `artifact.animated` 门禁并让任意 active artifact 挂载 document view，编号 UI 测试立即发现静态 fixture 出现 WebView，设备重新出现 tile memory 告警。 |
| 明确不覆盖范围 | 不移除动画 SVG 的当前页 document view，不改变 poster 生成门禁和缓存，不把 poster 当保存源，也不新增渲染库。 |

## `REG-TOPIC-044` SVG 海报 renderer 空闲后仍占用 Chromium 内存

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 正文海报已经生成且可见，打开真实动画 SVG 预览并缩放后仍会持续掉帧、缺层；日志反复出现 Chromium tile memory 超限，严重时 App 或模拟器退出。 |
| 触发条件 | 离屏海报 renderer 已完成请求、加载 `about:blank`，但进程级 runtime 仍永久持有一个保持原 measure/layout 的可见 WebView；动画预览又挂载第二个 Chromium document view。 |
| 根因 seam | `plugins/withSvgRendererModule.js` 生成的 `SvgPosterRendererRuntime` 队列结算与 WebView 所有权。 |
| 必须保持的行为 | 同一批已排队的 cache-miss 共用一个串行离屏 WebView；队列最后一个请求成功、失败或 renderer gone 后必须先断开 runtime 引用并销毁该 WebView。队列仍有任务时只 blank 后继续复用；纯 cache hit 不创建 WebView。真正动画 SVG 的当前预览页仍可挂载自己的隔离 document view，正文海报、首帧连续、保存原始字节和相邻页零 Chromium 均不回退。 |
| 精确失败 oracle | fresh prebuild 生成的 `SvgRendererInstrumentedTest.kt` 预先排队十个 cache-miss，要求 creation delta 为 1、全部结算后的 destruction delta 为 1 且 retained=false；随后同 key cache hit 保持 creation/destruction 计数不变且 retained=false。`tests/tooling/release-packaging.test.ts` 固定生成模板包含 idle destroy 而不是永久 `about:blank`。 |
| 最低可靠自动测试层 | fresh prebuild 后 Android instrumentation/native policy tests + compile；JS mock、Promise 已 resolve 或页面可见不能证明 Chromium 资源已释放。 |
| Replay 或真实验收路径 | 只读打开 NodeSeek `post-841430-1` 的 “VPS Remaining Value”；CDP 确认原文档含 SMIL `<animate>` 与 CSS `animation`。正文海报生成后不得残留 `never_attached` 的 renderer target；点击预览必须立即显示海报并在 1 倍状态继续播放动画，CDP 仅有当前 attached document target，关闭后该 target 消失。缩放专项见 `REG-TOPIC-045`。 |
| 负向验证方式 | 恢复只 `stopLoading()+loadUrl("about:blank")` 的空闲处理，instrumentation retained/destruction 断言失败；设备 CDP 重新同时看到离屏空白 target 与动画预览 target。 |
| 明确不覆盖范围 | 不全局终止共享 WebView renderer process，不销毁仍有排队工作的 WebView，不移除动画预览、不新增图片库或 renderer manager，也不改变 Cookie、代理和保存链路。 |

## `REG-TOPIC-045` 动画 SVG document view 进入缩放树后耗尽 Chromium tile 内存

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 动画 SVG 正文和全屏首帧都能立即显示，但双击放大、平移或停留时日志持续出现 Chromium `tile memory limits exceeded`，严重时预览缺层、App 或模拟器退出。 |
| 触发条件 | 当前页唯一的隔离 WebView 是 Gallery/zoom child；UI thread 已把 scale 应用给 child 后才异步通知 JS，React state、Fabric commit 与原生 WebView destroy 必然更晚。早期强制的 software layer 在静止时也持续申请 tile，放大后更严重；即使离屏海报 renderer 已按 `REG-TOPIC-044` 销毁，单个预览 WebView 也会触发。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的分页、缩放树与动态 `CompatibleSvgDocumentView` 挂载边界。 |
| 必须保持的行为 | 非循环 PagerView 只给当前与相邻页挂媒体；每页 ResumableZoom 的唯一媒体 child 只能包含 raster 或 SVG poster，动画 document view 必须是同一 page 内、缩放树外的绝对定位 sibling，任何 scale 都不能传递给 Chromium。动画 SVG 在当前页使用平台默认合成层的隔离 document view；同尺寸 artifact poster 始终挂载并以 `onDisplay` 单独记录 native 像素 readiness。poster 未显示时，缩放 intent 继续保留固定 1 倍 document view；poster 已显示后把同一个 document view 透明隐藏，放大和平移只变换 poster。回到 1 倍直接显示同一个 document view，不能黑屏、闪空白、销毁 Chromium 或重新发网。缩放时 Pager 禁用，回到 1 倍才恢复横滑和下拉关闭。静态 SVG、普通图片、原图保存、真实尺寸和相邻页零 Chromium 不改变。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-045` 首先断言 `CompatibleSvgDocumentView` 永远不是 `preview-zoom-*` 的后代；WebView mount token 与 mount/unmount 计数固定双击、平移和回到 1 倍全过程为同一实例且零卸载；`tests/ui/shared/compatible-svg-document-view.test.tsx` 固定不强制 Android layer。poster 尚未 `onDisplay` 时触发 ResumableZoom 的真实 double-tap start，document view 保持可见但 Pager 禁用。poster `onDisplay` 后同一个 document view 只变为透明且 recycling identity 不变；scale 仍大于 1 的 gesture end 保持 poster/禁 Pager，回到 1 后直接显示同一个 document view 并恢复 Pager，整个过程 SVG fetch 与 poster render 都只发生一次。 |
| 最低可靠自动测试层 | `UI_PASS` 固定挂载边界与连续帧；`DEVICE_REPLAY_PASS`/只读设备日志固定真实 Chromium 资源行为。 |
| Replay 或真实验收路径 | 只读打开 NodeSeek `post-841430-1` 的动画 SVG：1 倍静止时 CDP 只有一个 attached preview target 且不产生 tile memory 告警；双击放大或双指缩放后 target 仍是同一个固定尺寸 sibling、海报视觉连续，平移、停留期间也无新增告警或 renderer process 重启；回到 1 倍后动画立即继续，Android Back/下拉关闭仍有效，App 与设备存活。 |
| 负向验证方式 | 把 `CompatibleSvgDocumentView` 移回 ResumableZoom child；结构断言立即失败，设备重新出现 tile memory 告警。仅延迟 JS 回调或卸载不能通过该 oracle。 |
| 明确不覆盖范围 | 不把动画永久降级为静态图，不修改 zoom toolkit，不新增 renderer/图片库，不用海报作为保存来源，也不改变普通 raster 图片缩放。 |

## `REG-TOPIC-046` 多图预览被缩放手势截获后无法横滑

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 三图主题打开后稳定显示 `1/3`，但在图片上向左滑动仍停留在第一张，用户无法进入后两张。 |
| 触发条件 | PagerView 页面内同时挂载 ResumableZoom 的 tap/pinch 手势；原生 Pager 手势竞争失败，而既有 UI 用例直接调用 mock Pager 的“下一页”，没有经过真实横向手势。上游维护者也明确说明裸 ResumableZoom 与可滚动列表会发生手势冲突：[react-native-zoom-toolkit#59](https://github.com/Glazzes/react-native-zoom-toolkit/issues/59#issuecomment-2359494785)。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的父级方向手势与 PagerView/ResumableZoom 协调。 |
| 必须保持的行为 | 1 倍缩放时，父级单指横向手势按距离或速度把 Pager 推进一页；慢拖和快速甩动都可用，首尾不循环。纵向手势继续只负责下拉关闭；放大后 Pager 和父级翻页保持禁用，图片平移、双击、控制层、动态 SVG 固定 sibling 与 Android Back 均不回退。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-046` 从第 2/3 张向左触发真实父级横向 `onEnd`，要求 `onSelect(2)` 且显示 `3/3`；在末页重复相同手势不得再次调用。修复前调用数为 `0`。 |
| 最低可靠自动测试层 | `UI_PASS` 固定方向门禁、Pager 推进和非循环边界；真实 Android 多图主题补充 native 手势竞争证据。 |
| Replay 或真实验收路径 | App 内小隐寺搜索 `SAAS`，打开“有关SAAS和储存的几张图”；点击首图后应立即显示 `1/3`，依次横滑至 `2/3`、`3/3`，末页继续左滑仍为 `3/3`，再右滑可返回。全程只读，不保存图片。 |
| 负向验证方式 | 删除父级方向受限的横向 Pan、让真实手势只依赖 PagerView 与 ResumableZoom 竞争，编号 UI 用例回到零次选页，设备重新停在 `1/3`。 |
| 明确不覆盖范围 | 不修改 zoom toolkit、不增加手势库、不恢复缩略图栏或左右箭头，也不改变保存、媒体请求和 SVG 恢复链路。 |

## `REG-TOPIC-047` 评论纵向间距调整误删正文横向缩进

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 只要求调整评论纵向留白后，评论正文却向左扩张到头像列下方，签名、引用、投票和操作区也随正文一起铺满；相邻评论之间的纵向节奏正确，但左右布局已不是原来的样式。 |
| 触发条件 | 同一提交把 `replyContentArea.paddingLeft` 从 `42` 改成 `0`，又把回复 HTML 宽度从 `contentWidth - 42` 改成完整 `contentWidth`；新增测试随后把“full column”错误地固化为契约。`v1.3.83` 尚未包含，`v1.3.84` 首次发布该回归。 |
| 根因 seam | `src/features/topic/components/ReplyItem.tsx` 的 `replyContentWidth` 与 `src/features/topic/styles.ts` 的 `replyContentArea`。普通回复的引用、回复目标、正文、投票、签名/留言、reaction/统计/感谢、采纳状态和操作栏都在该容器内；主楼、评论头部、系统事件、User 回复活动和 Reply composer 不经过该容器。 |
| 必须保持的行为 | 普通评论正文容器保留左侧 `42px`、右侧 `0` 的横向缩进，HTML 可用宽度同步为 `Math.max(220, contentWidth - 42)`；主楼继续使用完整列宽。`replyCard` 的顶部 `16`、底部 `8`、内部 `gap: 8`，以及签名、统计、感谢、采纳提示和操作栏的现有纵向几何均保持不变。 |
| 精确失败 oracle | `tests/integration/style-ownership.test.ts` 的 `REG-TOPIC-047` 同时固定 `paddingLeft: 42`、`paddingRight: 0` 和现有纵向数值；`tests/ui/topic/topic-components.test.tsx` 通过真实 `ReplyItem` 给出 `contentWidth: 360`，要求评论正文与签名 HTML 宽度均为 `318`，而独立主楼正文仍为 `360`。修复前两条用例分别收到 `paddingLeft: 0` 与 `width: 360`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：theme test 固定容器几何，RNTL 固定真实 ReplyItem 到 HTML renderer 的宽度；只检查源码数字或单独渲染 HTML 不能证明入口接线正确。 |
| Replay 或真实验收路径 | Release APK 在五站 Topic 回复区按 `docs/testing-standard.md` 的评论末尾分支矩阵只读检查；同宽度截图比较普通正文左边界、签名/统计/操作栏与分隔线，确认横向缩进恢复且纵向留白未回退；从列表进入 Topic 并返回，确认原列表位置恢复。 |
| 负向验证方式 | 把左缩进恢复为 `0`、停止扣减 HTML 宽度，或误把主楼也缩窄，编号 unit/UI 用例必须失败；把纵向数值恢复到旧版本同样由同一 theme oracle 拦截。 |
| 明确不覆盖范围 | 不改变主楼、评论头部、系统事件、User 页回复卡片或 Reply composer，不重新设计响应式列宽，也不授权任何真实回复或互动写入。 |

## `REG-TOPIC-048` 适屏图显示后不渐进升级且全屏返回仍模糊

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 用户症状 | 详情与评论只能一直显示适屏图；即使全屏原图已经清晰显示，关闭预览后外层仍模糊。若直接把原图改成首个请求，长帖又会恢复慢加载、滚动期间整页抢带宽和图片尺寸跳动。 |
| 触发条件 | `displayUri/originalUri` 只在预览 catalog 中分层，块图 renderer 不消费安全原图；正文与全屏也没有按完整媒体请求 identity 共享“原图已显示”状态。 |
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的原图来源传递、`src/features/topic/rendering/previewRenderers.tsx` 的块图双层生命周期、`src/platform/media/originalImageLoading.tsx` 的附近门禁与进程内显示信号、`src/features/topic/components/TopicContentList.tsx` 的主楼分块范围，以及 `src/ui/media/ImagePreviewModal.tsx` 的全屏 `onDisplay` 结算。 |
| 必须保持的行为 | 适屏图仍是首个请求，并继续独占 4:3 占位、唯一 Spinner、`onLoad` 真实比例与 `onDisplay` 显示门槛。适屏图显示后，评论只依赖 FlashList 的 `720px` render window，主楼只允许同一 `720px` 范围内已测量分块以低优先级启动原图；点击图片立即使用高优先级。原图层以适屏图为 placeholder、`150ms` 过渡并绝对覆盖既有 frame，成功或分辨率差异不得改变外层几何。完整媒体 request identity（URL、cache key、headers/session）匹配的正文、评论或全屏原图只有在 `onDisplay` 后才能发布进程内 ready；全屏成功后外层复用同一 Glide 缓存或已有 SVG poster。相同 URL 不发第二次请求；后台失败保留适屏图、没有第二错误态或循环重试，只有后续全屏成功 revision 可重新触发；复杂 SVG 后台失败不得启动 Chromium，现有全屏重试和 artifact 恢复保持不变。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts` 的 `REG-TOPIC-048` 固定安全灯箱/最大 `srcset` 原图传递；`src/platform/media/originalImageLoading.test.ts` 固定 `720px` 边界和完整 session identity 隔离；`tests/ui/topic/topic-image-loading.test.tsx` 固定原图不早启、低/高优先级、placeholder、`150ms`、同 URL 去重、稳定几何、失败保留适屏图、ready 后重试与旧 epoch 隔离；`tests/ui/topic/image-preview.test.tsx` 固定全屏 `onLoad` 不发布、匹配 `onDisplay` 才发布。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：parser/纯函数固定来源与范围，RNTL 必须观察真实 Expo Image props、生命周期、几何和跨全屏信号；源码字符串、只检查 catalog 或只打开 App 都不足以证明请求顺序。 |
| Replay 或真实验收路径 | 在当前身份匹配的 App 中只读打开含主楼长图、远端评论图和 SVG 的详情：冷加载确认先适屏后附近原图；滚到长帖远段确认未到附近不启动；点开原图等清晰显示后关闭，外层应同步清晰且位置不跳；快速返回与原图自然失败时适屏图继续可用。不得为制造失败清 Cookie、断网或写入论坛。 |
| 负向验证方式 | 让原图在适屏图 `onDisplay` 前、主楼 `720px` 范围外或旧 session ready 后挂载，移除绝对覆盖/placeholder，原图失败时替换成错误态，或在后台 SVG 失败时调用 Chromium 恢复，编号 unit/UI 用例必须失败。 |
| 明确不覆盖范围 | 不改变适屏图既有加载方式，不重构主楼为列表，不增加全局下载队列、设置或依赖；inline emoji、sticker、reaction、视频封面和保存原图链路不进入渐进升级。 |

## `REG-TOPIC-049` Bilibili 移动播放器跳转被导航白名单拦截

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | NodeSeek 主题已把 Bilibili 视频识别成 16:9 播放器区域，但评论里只显示空白卡片，没有封面、控制层或视频。 |
| 触发条件 | Bilibili 外链页在 Android WebView 的 Mobile UA 下用页面脚本跳转到 `https://www.bilibili.com/blackboard/webplayer/mbplayer.html`；App 的 `onShouldStartLoadWithRequest` 只允许 `player.bilibili.com/player.html`，因此拦截跳转，原文档只剩 `<head>` 且没有 `document.body`。 |
| 根因 seam | `src/domain/forum/videoEmbeds.ts` 的 Bilibili WebView 导航白名单，以及 `src/features/topic/rendering/contentMediaRenderers.tsx` 对该白名单的共享调用。 |
| 必须保持的行为 | 保留 `about:blank`；仅允许 HTTPS 的 `player.bilibili.com/player.html` 和 `www.bilibili.com/blackboard/webplayer/mbplayer.html`，且 URL 必须携带合法 `bvid` 或数字 `aid`。普通 Bilibili 页面、其他 host、其他 path 与危险协议继续拒绝；主楼和评论共用同一规则。 |
| 精确失败 oracle | `src/domain/forum/videoEmbeds.test.ts` 使用事故视频 `BV1TE411h7vY` 的真实移动播放器跳转 URL，要求导航判定为 `true`；修复前收到 `false`。同组负向用例继续要求普通 Bilibili 视频页、外站和 `javascript:` 为 `false`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定确定性的导航安全边界；真实 Android WebView 只读验收补充第三方页面实际跳转与像素显示证据。 |
| Replay 或真实验收路径 | App 内直达 `https://www.nodeseek.com/post-849411-1`，滚到第 `#6` 楼；Bilibili 播放器应显示封面或控制层而不是空白。CDP 应显示移动播放器 target 且文档存在正文；全程不播放、不登录、不执行论坛写操作。 |
| 负向验证方式 | 删除移动播放器端点白名单后，编号 unit 用例恢复为 `false`，设备页面再次停在只有 `<head>` 的桌面外链页并显示空白卡片。 |
| 明确不覆盖范围 | 不放开 Bilibili 全站导航，不增加通用 WebView allowlist、依赖或 fallback；不保证第三方视频在下架、地域限制、网络或解码失败时仍可播放。 |

## `REG-TOPIC-050` 全屏图片切换时高清升级闪黑

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 帖子详情的多图预览在 `1x` 横向切换时，新当前页会短暂整体变暗，视觉上像在黑色背景上闪了一下；页码、手势和最终图片均正常。 |
| 触发条件 | 相邻栅格页先以低优先级和允许下采样预热，升为当前页后切换高优先级并禁用下采样；`expo-image` 因 `allowDownscaling` 变化重新渲染同一原图，而全屏栅格分支同时配置了 `150ms` transition。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 普通栅格图分支把同一媒体的清晰度升级当成需要 cross-dissolve 的内容切换。`expo-image@3.0.11` Android 实现同时淡出旧 view、淡入新 view；在预览黑色背景上，两张相同图片的合成亮度中点约为 `75%`。 |
| 必须保持的行为 | Pager 继续只挂载当前页与相邻页；相邻页保持低优先级、允许下采样和 display placeholder，升为当前页后保持高优先级并禁用下采样。普通栅格页的初次显示及清晰度升级均不得配置 transition，资源就绪后原子替换；请求 source、cache/recycling identity、失败重试、缩放、控制层和关闭行为不变。正文原图覆盖层继续保留 `REG-TOPIC-048` 的 `150ms` 过渡；SVG poster/document 分支不进入本条。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-050` 以不同 display/original URL 渲染 5 张图片，从第 3 张开始，要求当前与相邻的普通栅格 Expo Image 均没有 `transition`；推进一页后，新旧当前页仍没有 `transition`，同时保持既有 `allowDownscaling` 切换。修复前收到 `transition: 150`。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 通过公开 `ImagePreviewModal` 渲染结果观察 Expo Image 系统边界 props 与真实切页状态；源码字符串测试不足以固定当前页/相邻页生命周期。 |
| Replay 或真实验收路径 | 在身份匹配的当前构建中只读进入小隐寺，搜索“SAAS”并打开“有关SAAS和储存的几张图”，打开第 1 张图后以至少 `60fps` 录制 `1/3 ↔ 2/3` 往返 4 次并重复两轮。不得出现黑帧；高清升级窗口的中部图像亮度不得低于相邻稳定帧较暗者的 `90%`，并同时确认页码、预热、高清显示、缩放、控制层和关闭。 |
| 负向验证方式 | 给普通栅格分支恢复任意正时长 transition，编号 UI 用例必须收到该值并失败；只对当前页关闭而让可见相邻页继续 cross-dissolve 也不满足 oracle。 |
| 明确不覆盖范围 | 不改变 PagerView、背景色、预取数量、下采样策略、SVG 恢复、正文渐进升级或 Expo 依赖版本；不增加自定义双层动画、配置项或仅能断言手势成功的 Replay。 |

## `REG-TOPIC-052` 全屏重复打开已显示图片仍闪 Spinner

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 同一张原图已经在全屏成功显示，关闭后再次点击，仍会短暂出现“图片加载中”并闪一下。 |
| 触发条件 | 全屏页关闭后重新挂载；共享层已经记录同一完整媒体 request identity 的 `onDisplay` 成功，但新页面仍把局部状态固定初始化为 `loading`，随后 memory-cache 的 `onLoadStart` 又继续维持 Spinner。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的普通栅格预览状态没有消费 `src/platform/media/originalImageLoading.tsx` 已有的进程内显示证明。 |
| 必须保持的行为 | 同一 URL、cache key、headers/session identity 已经 `onDisplay` 成功后，本进程内再次打开必须直接显示现有 placeholder/cache 像素，不恢复 Spinner；随后同一请求的 `onLoadStart` 也不得重新显示遮罩。内部状态、30 秒 timeout 与 diagnostics 仍保持 loading，超时必须进入失败，显式重试必须重新显示 Spinner。冷图、新 session identity 与 SVG poster 继续使用原有 loading/error 生命周期，静态 poster 仍须等本次 `onDisplay` 才撤下遮罩；显示证明受既有 512 项 LRU 限制。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-052` 先观察冷图 Spinner和 `onDisplay` 结算，再关闭并用相同 recycling/request identity 重开；共享 revision 必须已存在，重开前后及再次触发 `onLoadStart` 后均不得出现“图片加载中”，推进 30 秒仍须失败且显式重试重新显示 Spinner。`REG-TOPIC-043` 另让静态 poster 首次 `onDisplay` 后重开，要求新 poster 在本次 `onDisplay` 前仍保留 Spinner。修复前普通图重开立即收到 Spinner；把状态直接伪装为 loaded 又会使 timeout 与 SVG 门槛失败。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 通过公开 `ImagePreviewModal` 驱动真实关闭/重开与 Expo Image 回调；只测试 revision Map 或缓存 key 不足以证明用户可见遮罩。 |
| Replay 或真实验收路径 | 在身份与当前 APK 匹配的详情中只读打开同一张图片，等待清晰显示后关闭并重复打开三次；第一次允许冷加载，之后不得闪 Spinner。不得通过断网、清缓存、清 Cookie 或写入论坛制造状态。 |
| 负向验证方式 | 删除已显示 revision 的初始化读取，或让已显示请求的 `onLoadStart` 无条件写回 loading，编号 UI 用例必须重新看到 Spinner。 |
| 明确不覆盖范围 | 不增加图片预热、全局缓存、依赖或动画；App 重启、LRU 淘汰、URL/session identity 变化后仍按冷请求处理。 |

## `REG-TOPIC-053` 跨主题评论引用被当作普通 HTML

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 用户症状 | linux.do 评论中的跨主题引用没有显示为引用卡片，而是把头像、主题标题、分类和整段灰色 blockquote 当作普通评论 HTML 展开；同楼层还可能误取当前主题的帖子。 |
| 触发条件 | 评论 quote 的 `data-topic` 与当前主题不同。共享 parser 把 topic mismatch 判成“不是引用”，而 `Reply` 只保存 floor-only 的三组并行字段，UI 又用当前 topic + floor 重建引用身份。 |
| 根因 seam | `src/sources/discourse/content.ts` 的 Discourse reply quote 提取、`Reply.quotedPosts` 的完整身份、linux.do/小隐寺 adapter、`ReplyItem` 的本地楼层复用与 `useTopicController` 的引用事件。2026-07-16 的 `REG-TOPIC-003` 只对正文构造跨主题 fixture，评论 fixture 仍是同主题；2026-07-26 抽公共 parser 时保留了该限制，因此文档承诺没有对应评论 oracle。 |
| 必须保持的行为 | 合法评论 quote 从 parser 到 Reply、UI event、Query 全程携带 `source + topicId + postNumber`，从普通 `contentHtml` 删除 aside 并显示作者、目标主题链接、简介和展开入口。只有 reference topic 等于当前 topic 时才能复用 `repliesByFloor`；跨主题只读 full-key Query cache/transport。目标标题链接仍按站内 Topic 导航，display-only 作者不得猜成 username。主楼正文 quote 继续使用独立 renderer，不与评论卡片合并。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 要求 cross-topic aside 产出 full reference 并从 HTML 移除；`tests/integration/source-read-contracts.test.ts` 与 `src/sources/xiaoyinsi/reader.test.ts` 固定两站 adapter；`tests/ui/topic/topic-components.test.tsx` 注入当前主题同楼层错误内容，要求默认只见跨主题简介、目标标题可内部跳转、展开只见 full-key 正确内容；`tests/ui/topic/topic-session-controller.test.tsx` 让两个引用实例指向同一跨主题 reference，要求 transport 一次、两个 instance 均展开。`REG-TOPIC-003/007/035` 继续通过。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 parser/adapter/full key，`UI_PASS` 固定可见卡片、内部跳转、本地楼层门禁、Query 去重和作者导航边界。 |
| Replay 或真实验收路径 | 保留 App 数据直达 `https://linux.do/t/topic/2685882`，检查首条可见回复的跨主题内容为单个引用卡片而非原始灰色 HTML；点击“盘点L站的徽章…”进入目标，再按 `REG-PERF-008` 分别在 Loading 与加载完成后返回。不得扫描其他主题、绕过 Cloudflare或执行写操作。 |
| 负向验证方式 | 恢复 `data-topic !== currentTopicId` 跳过、恢复 floor-only 字段、无条件读取 `repliesByFloor.get(postNumber)`，或从 toggle event 删除 reference，编号 parser/adapter/UI/controller 至少一层必须失败。 |
| 明确不覆盖范围 | 不改变原站引用正文，不预取目标主题，不合并主楼与评论引用 UI；动态目标内容改变时只核对引用结构和身份，不固定实时文本或回复数。 |

## `REG-TOPIC-054` 超长评论引用展开时同步挂载整帖并挤压作者信息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | 已加载的超长跨主题引用再次展开仍会长时间卡顿；头像稍后出现会推挤姓名，长作者名和标题拥挤，引用分块之间还可能露出灰色空带。进入引用目标再返回时，还可能显示“收起”却没有正文；两条同展示楼层的回复可能一起展开或串位。 |
| 触发条件 | 一个 ReplyItem 在单个父列表 cell 中同步创建引用帖的全部 HTML/图片节点；目标为首帖时另走 reply Query 而没有复用同 epoch Topic cache；route 只恢复 expanded boolean、未从当前 epoch cache 重建 active request；实例 key 只绑定展示楼层；任一状态变化重复拆分所有已展开正文。头像节点只在 URL 存在时挂载，列表全局 gap 又被用于同一卡片的连续分块。 |
| 根因 seam | `useTopicController` 的引用 Query、`buildVirtualizedReplyItems`、`TopicScreenBody` 的唯一纵向 FlashList、`ReplyItem` 分段渲染与引用卡片样式。 |
| 必须保持的行为 | 目标首帖已在当前 session epoch 的 Topic Query cache 时直接转换并 seed 对应 reply Query，零重复 transport；route 恢复已展开评论引用时，从当前回复实体和同 epoch reply cache 重建 observer。引用实例绑定稳定 reply identity（优先 commentId），展示楼层只用于文案。评论、每个引用摘要、展开正文 chunk 和评论尾部按稳定顺序成为父 FlashList data，由同一个 render window 挂载，不创建嵌套纵向列表。折叠只移除正文 rows，二次展开复用 WeakMap 中同一 immutable Reply 的拆分结果和稳定 key。头像位始终保留 fallback，作者单行、标题最多两行；同一卡片分块无外部 gap，不同引用及普通列表项保留明确纵向间距，inline 引用头像保留 6dp 右间距，展开/收起及标题入口至少 48dp。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 在目标 Topic 已缓存时要求展开零 `getReply`，进入目标再 restore parent 后仍立即得到同一 cached reply、transport 总数不增加；`src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicContentIdentity.test.ts` 以两个不同 commentId 但相同 floor/reference 的回复要求 key 与 expanded 状态隔离，并要求重复 build 复用同一 content 对象；`tests/ui/topic/topic-reply-filters.test.tsx` 要求超长引用生成多个稳定父列表 rows、顺序不变、折叠只去除内容且分隔值为 0/8/10/12；`tests/ui/topic/topic-components.test.tsx` 固定头像 fallback、长作者/标题行数和携带 reply identity 的 callback；`src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/inlineMedia.test.ts`、`tests/integration/style-ownership.test.ts` 固定 inline 头像与触控/间距样式。修复前缓存二次展开仍出现约 433.6ms 最慢帧和约 2874 个 helper 节点。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Query 行为、列表 data、真实组件布局语义和样式共同固定；只测 fetch 去重或只看最终截图均不足。 |
| Replay 或真实验收路径 | 保留 App 数据直达 `https://linux.do/t/topic/2685882`，展开首条跨主题引用，连续滚过文字、链接和图片分块，再收起并二次展开；卡片必须连续、作者区不位移、返回可立即操作。匹配的 90Hz debug 模拟器记录二次展开帧分布并与逃逸基线对照，不以工具 settle 时长代替 App 帧耗时，不访问其他主题或执行写操作。 |
| 负向验证方式 | 把完整引用放回单个 ReplyItem、增加嵌套纵向列表、删除 Topic/reply cache 恢复、以 floor 生成实例 key、每次 build 重拆同一 Reply、恢复条件头像或全局列表 gap，编号 controller/helper/UI/theme 测试至少一层必须失败。 |
| 明确不覆盖范围 | 不预取引用、不增加缓存或列表依赖，不为未测量设备加入 idle prewarm；动态正文和图片内容不写死，Release 设备仍需独立性能验收。 |

## `REG-TOPIC-055` 超长引用首次展开让 FlashList 同帧预渲染过多富 HTML

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | `REG-TOPIC-054` 已把完整引用拆进父 FlashList 后，首次点击“展开”仍可能明显卡住；展开态还重复显示简介与完整正文，头像、姓名、标题和正文显得拥挤。 |
| 触发条件 | 一篇约 138 KiB 的引用首帖被拆成 57 个新 `replyQuoteContent` rows；FlashList 尚未测得该 item type 的真实高度，却按估算高度和既有 `720px` 图片 render window 同帧 engage 多个富 HTML/图片 row。WeakMap 只省重复拆分，不能省首次 RenderHTML/native subtree。 |
| 根因 seam | `buildVirtualizedReplyItems` 的冷引用 materialization、`TopicScreenBody` 的 row `onLayout`/下一帧放开、`ReplyItem` 的 content row 与引用简介显示条件。 |
| 必须保持的行为 | 冷引用保留全部稳定拆分结果，但首次只把前 2 个正文 row 放入父 FlashList；首个实际挂载 row 完成 `onLayout` 后，下一 animation frame 才放开同实例剩余 rows，使列表先取得真实高度。primed token 同时绑定引用实例与完整 content row keys；折叠后同内容二次展开立即全量，内容或 Topic route 改变后重新测量，两个引用实例互不解锁。首批与全量的前两项 key 不变。完整正文存在时隐藏重复简介；加载、失败或折叠态仍保留简介。不得降低全局 `720px` 图片窗口、缩小全局 chunk 或增加嵌套列表。 |
| 精确失败 oracle | `src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicContentIdentity.test.ts` 以两个实例各引用 6 个安全普通 chunks，要求冷态各仅 2 行、实例独立、primed 后一实例全量且前两 key 不变、内容改变重新回到 2 行；`tests/ui/topic/topic-reply-filters.test.tsx` 要求首个 staged row `onLayout` 前仍为 2 行，flush RAF 后才变成 6 行，折叠再展开立即全量；`tests/ui/topic/topic-components.test.tsx` 要求完整正文出现后简介消失，而 loading 无完整正文时简介仍存在。修复前精确主题首次展开观测到约 672 attached Views 与 150ms 峰值。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯列表 data 固定实例/token/key，RNTL 固定真实 layout→RAF→全量生命周期与可见简介；配置字符串或最终截图不足以证明分帧。 |
| Replay 或真实验收路径 | 保留 App 数据直达 `https://linux.do/t/topic/2685882`，从冷的折叠态展开首条跨主题引用，再收起/展开并快速滚过文字、链接和图片。作者区和卡片连续，展开后不重复简介，快速滚动不得出现页面灰色空洞。匹配 90Hz debug 模拟器分别记录冷展开与缓存展开的 gfxinfo；本次开发 bundle 冷展开为 323 attached Views、p95/max 32ms，缓存重复样本 p95/max 为 36–42ms，均不得拿工具 settle 时长替代。 |
| 负向验证方式 | 冷态直接放入全部 rows、在首个 layout 前放开、primed token 不含实例或内容身份、内容变化沿用旧 token、完整正文仍重复简介，编号 helper/UI 测试必须失败。把 drawDistance 降到 250 虽可减少首批 View，但快速滚动会推迟原图进入窗口，不满足本条。 |
| 明确不覆盖范围 | 不改变 Query、网络、原图加载窗口、全局 splitter 或 FlashList 依赖；不宣称 debug 模拟器达到 90Hz 零丢帧，Release 设备性能仍为 `NOT_VERIFIED`。 |

## `REG-XIAOYINSI-023` 畸形可选头像拒绝整页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01` |
| 用户症状 | 小隐寺一条记录返回 `http://` 等畸形 `avatar_template` 时，Feed、搜索、详情或用户页整次请求失败，而不是只缺少该头像。 |
| 触发条件 | adapter 在 `.map()` 归一化可选字段时直接调用会抛错的 `new URL()`，外层没有单字段隔离。 |
| 根因 seam | linux.do 与小隐寺共享的 Discourse 头像规范化。 |
| 必须保持的行为 | 空或非法头像返回 `undefined`，记录其他字段和整页继续生效；相对头像仍按站点 base URL 绝对化并替换 `{size}`。两站复用同一无异常 helper。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 固定错误类型、危险协议和畸形 URL 全部无异常返回 `undefined`，合法相对/HTTPS URL 保留；`src/sources/xiaoyinsi/reader.test.ts` 把 `avatar_template: "http://"` 注入 Feed、Search、Topic、Replies、User 和 Account 公开读取入口，要求每次请求 resolve、其他字段保留且头像缺失。 |
| 最低可靠自动测试层 | `UNIT_PASS`：共享归一化边界覆盖对抗输入，adapter 公开读取接口覆盖所有受影响入口的整页降级。 |
| Replay 或真实验收路径 | 动态来源自然出现缺头像时检查列表与详情仍可读；不向真实站点注入畸形数据，没有样本时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复直接 `new URL()` 后，编号测试必然 reject。 |
| 明确不覆盖范围 | 不替用户生成占位头像 URL，不吞掉必填主题身份或正文解析错误。 |

## `REG-WRITE-026` 回复编辑权限跨账号或 epoch 继续生效

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`TOPIC-03`、`NAV-03` |
| 用户症状 | A 账号进入回复编辑后切换到 B、恢复旧 route 或失去逐条权限，旧编辑仍可能提交、选图或上传。 |
| 触发条件 | 编辑目标只保存 `canEdit` 与回复 id，未绑定来源、账号 identity、session epoch 和 topic；提交前又提前读取旧 epoch Query key。 |
| 根因 seam | `ReplyEditTarget`、`useTopicSessionController` 与 `useTopicActionsController` 的写 ticket、Replies Query 和 composer 生命周期。 |
| 必须保持的行为 | 编辑目标绑定 `topicId + WritableSessionTicket`；编辑入口先取得 ticket，提交和上传按该 ticket epoch 生成 Query key，并在取消 Query 后、凭据/runtime 准备后、文件选择/上传/transport 前确认同 `commentId` 在缓存中恰好存在一条且 `canEdit=true`；跨页重复或权限冲突必须 fail closed。身份、epoch、route 或权限变化关闭编辑态并清除 target，但保留文本；旧 target 不得产生 picker、NodeImage Key、optimistic update、上传或 transport。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-WRITE-026` 固定 inactive route、epoch/identity 变化、reply missing、`canEdit=false`、跨页重复权限冲突、取消 Query 或 Discourse runtime 准备期间失效、NodeImage 前置零调用和 ticket epoch Query key；修复前旧 target 可进入写链路或读取旧 key。 |
| 最低可靠自动测试层 | `UI_PASS`：在真实 QueryClient/Controller 生命周期上观察编辑 target、草稿和所有副作用 mock；只测 ticket helper 或按钮隐藏不足以证明 transport 前门禁。 |
| Replay 或真实验收路径 | 未获真实写授权时只检查编辑入口、切号后 composer 收起和文本保留，提交、上传与真实 A→B 保持 `NOT_VERIFIED`；获授权后按 `tests/live/agent-live.md` 记录账号、恢复和残留。 |
| 负向验证方式 | 移除 target ticket/topic、在 `ensureWritableSession` 前生成 Query key，或跳过取消 Query 后复核，编号 UI 用例必须出现 transport、picker/Key 调用或旧 epoch cache 命中。 |
| 明确不覆盖范围 | 不自动把旧编辑文本提交为 B 账号的新回复，不迁移论坛账号数据，不执行真实编辑、上传或清登录。 |

## `REG-DATA-006` 备份 URL 携带未知 query 凭据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03`、`FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 用户症状 | 备份虽删除已知 token 名，未知签名参数、userinfo 或 fragment 仍可随 Topic、用户和头像 URL 导出并在导入后继续保存。 |
| 触发条件 | URL sanitizer 依赖敏感 query denylist，且直接信任远端 Topic/Profile URL。 |
| 根因 seam | `src/domain/reader/readerData.ts` 的 Topic/User summary 与 ReaderData v2 的 load/save/import/export 统一 sanitizer。 |
| 必须保持的行为 | Topic URL 只由 `source + id` 重建，用户主页只由 `source + id/username` 重建；avatar/media 只保留合法 HTTP(S) 的 origin 与 pathname，清空 userinfo、全部 query 和 hash。ReaderData 仍为 version 2，所有持久化与备份入口共用同一边界。 |
| 精确失败 oracle | `src/domain/reader/readerBackup.test.ts` 的 `REG-DATA-006` 使用假 token/signature 覆盖 export/import，要求 canonical Topic/Profile URL、干净头像 URL、version 2 且任何假凭据均不存在；`src/domain/reader/readerData.test.ts` 固定相对、危险 scheme 和未知 query。 |
| 最低可靠自动测试层 | `UNIT_PASS`：纯数据输入同时经过 sanitizer、export 与 import；源码 denylist 或单一路径断言不能证明完整边界。 |
| Replay 或真实验收路径 | 真实文件导入/导出涉及本机资料，未单独授权时保持 `NOT_VERIFIED`；只读 Library/Feed 使用现有数据确认链接仍可打开。 |
| 负向验证方式 | 恢复 query denylist、保留 supplied Topic/Profile URL 或 userinfo/hash，编号测试必须重新看到假凭据或非 canonical URL。 |
| 明确不覆盖范围 | 不改变 ReaderData schema/version，不迁移 Cookie、代理、密码或 User API Key，也不保留远端展示 query。 |

## `REG-TOPIC-051` NodeSeek Markdown 无输入预算

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 用户症状 | 异常大的 NodeSeek Markdown 可进入 Markdown/linkify 全流程，造成不必要的 CPU 与内存占用。 |
| 触发条件 | Markdown renderer 没有 UTF-8 字节预算和显式 nesting 上限。 |
| 根因 seam | `src/sources/nodeseek/markdown.ts` 的唯一 MarkdownIt 实例及进入 `sanitizeContentHtml` 前的输入门禁。 |
| 必须保持的行为 | `markdown-it@14.3.0` 与 `linkify-it>=5.0.2` 保留既有 linkify/breaks 行为，`maxNesting=100`；输入最多 256 KiB UTF-8，超限不调用 Markdown/linkify，只返回经过现有 sanitizer 的固定提示。 |
| 精确失败 oracle | `src/sources/nodeseek/markdown.test.ts` 的 `REG-TOPIC-051` 固定普通短 Markdown/linkify 和 256 KiB 安全边界字符串；超限 marker 不得进入 HTML。`npm ls markdown-it linkify-it` 固定实际安装版本。 |
| 最低可靠自动测试层 | `UNIT_PASS`：直接调用公开转换函数并检查安装依赖；不复制或执行大规模 DoS payload。 |
| Replay 或真实验收路径 | 自然出现超限内容时只读确认提示；没有样本则 `NOT_VERIFIED`，不得向真实站点注入构造内容。 |
| 负向验证方式 | 删除字节门禁、恢复旧依赖或让超限输入进入 `md.render`，编号测试必须看到 marker 或依赖版本不符。 |
| 明确不覆盖范围 | 不预热 Markdown、不改变普通正文语法、不增加远端内容探测或恶意 payload 压测。 |

## `REG-PROXY-007` localhost relay 接受危险目标并遗留空闲 tunnel

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01` |
| 用户症状 | WebView localhost relay 可接受任意端口、userinfo、畸形 request line、非标准 numeric IPv4、IPv4-compatible/mapped IPv6 或私网 IP literal；合法首请求后的流水线第二 target 还能绕过校验，空闲 tunnel 也可能长期占用连接与 copy worker，按方向独立计时又会误杀仍在持续单向传输的 tunnel；worker 结束与 relay 停止并发时还可能抛异常并跳过后续 socket/executor 清理；profile 只改名还会无意义重启。 |
| 触发条件 | relay 依赖随机本地端口和宽松 URI 解析，IPv4-compatible IPv6 绕过普通 `InetAddress` 私网判断，校验首个 HTTP header 后盲转整个 client stream，socket copy 没有由双向活动共同续期的 idle deadline，socket registry 的 snapshot 与 remove 不受同一 ownership lock 保护，apply key 包含展示字段。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 `LocalNetworkProxyServer` 与 `useNetworkProxyRuntime` apply key。 |
| 必须保持的行为 | relay 只绑定 `127.0.0.1`，并发与 backlog 均为 16、header 上限 64 KiB；只接受 HTTP absolute-form 80 和显式 HTTPS CONNECT 443，拒绝 userinfo、控制字符、空/不一致 Host、hex/octal/short/前导零 numeric IPv4、IPv4-compatible/mapped IPv6，以及 loopback/private/link-local/multicast/unspecified IP literal。非 CONNECT 只按唯一合法 `Content-Length` 转发首个 request body，拒绝 `Transfer-Encoding`、重复/歧义长度，剥离持久连接头并关闭连接，流水线第二 target 不得到达 upstream。共享双向 idle deadline 为 120 秒：任一方向读到字节都续期，只有整个 tunnel 双向静默才超时；所有 socket registry mutation 与停止 snapshot 使用同一 ownership lock，超时、停止和切换都不得抛出 cleanup 竞态，并关闭 client/upstream socket 与 copy task。apply key 只含 protocol/host/port/username/password。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest.kt` 的 `REG-PROXY-007` 只连接进程内 `127.0.0.1` socket pair/fake upstream，固定非法端口/目标、numeric IPv4、IPv4-compatible/mapped IPv6、合法公网 IPv6 的带方括号 upstream authority、流水线第二 target 零转发、唯一长度 framing、17th connection、64 KiB header、短注入共享 idle deadline、单向持续传输、copy executor reject；`regProxy007StopOverlapsConnectionWorkerCleanupWithoutBackgroundFailure` 用现有 `socketConnector` 与 latch 精确重叠 connection worker unwind 和 `stop()`，捕获并 join 实际 connection worker 后再断言后台零异常及 socket/worker 全部释放。`tests/tooling/network-proxy-plugin.test.ts` 与 `tests/ui/more/network-proxy-controller.test.tsx` 固定生成接线和改名不重启。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Kotlin JUnit 验证真实 socket/parser 生命周期，Jest 验证 controller apply；JS 字符串检查不能代替原生行为测试。 |
| Replay 或真实验收路径 | 代理启停、WebView 公网连通性与真实代理凭据保持 `NOT_VERIFIED`，除非另获授权；不得扫描端口、探测其他 App 或压测公网代理。 |
| 负向验证方式 | 放开 80/443、移除 IPv4-embedded/IP literal/Host/framing 校验、恢复 client stream 盲转、按读方向独立 timeout 或无 timeout，或把 profile name/id 放回 apply key，编号原生/UI 用例必须失败。 |
| 明确不覆盖范围 | 普通 `ServerSocket` 无可靠 caller UID，随机端口、端口限制和 timeout 只是 hardening；hostname DNS rebinding及同设备恶意 App 尝试连接仍是残余风险。若要求同-App认证，必须另行设计 `VpnService`。 |

## `REG-OPS-015` 发布 secret 进入所有子进程且缺少 provenance

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 用户症状 | `.env.release.local` 的签名变量进入全局 `process.env` 并穿透 verify/prebuild/native test/smoke；产物只能看到 APK hash，无法追踪源码、lockfile 与 toolchain。 |
| 触发条件 | release 脚本全局写 env，并让所有 `spawnSync` 继承；构建前没有 Node/dirty checkout 门禁或 unsigned native test 阶段。 |
| 根因 seam | `scripts/release-environment.mjs`、`scripts/release-android.mjs` 与 release manifest 生成顺序。 |
| 必须保持的行为 | 只解析签名与 smoke allowlist，不修改全局 env；普通子进程显式删除四个签名变量，只有最终 `assembleRelease` 注入。正式 release 要求 Node 22 与 clean checkout；prebuild 使用 `--no-install`，随后以无签名 env 执行 `testReleaseUnitTest` 和 `compileReleaseKotlin`。manifest 在原可信字段外记录 git/lockfile SHA、Node/npm/Java/Gradle 与 ABI provenance，更新检查仍只信任原签名、包名、版本和 APK hash。 |
| 精确失败 oracle | `tests/tooling/release-environment.test.ts` 的 `REG-OPS-015` 行为测试固定 allowlist、secret scope、Node/dirty gate、unsigned native validation → signed assemble 顺序及 provenance manifest，且不输出 secret 值；`tests/tooling/release-workflow.test.ts` 固定 prebuild 恢复后调用该受测 build stage，signing/packaging/Smoke guards 固定 keystore 和产物顺序。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `STATIC_PASS`：纯 env helper 行为测试加 release workflow/packaging guard；真实签名只在明确发布任务中验证。 |
| Replay 或真实验收路径 | 本轮不执行正式 release、签名、APK 安装或上传，均为 `NOT_VERIFIED`；当前 Node 非 22 时 release 会有意在起始门禁阻断。 |
| 负向验证方式 | 向 `process.env` 写入 release 文件、让 ordinary child 保留任一签名变量、移除 clean/Node gate或把签名 env 提前到 native tests，编号测试必须失败。 |
| 明确不覆盖范围 | 目标是来源可追踪，不宣称字节可复现；不引入 Docker、Fastlane、远端发布服务或 Signal 级 toolchain。 |

## `REG-FEED-012` TopicCard memo 忽略不可见 payload 变化

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04`、`SEARCH-02`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 用户症状 | 两个 Topic 展示文字相同但 `url/categoryId/authorId` 已变化时，卡片不重渲染，点击和 trailing action 继续使用旧对象。 |
| 触发条件 | `TopicCard` memo 只白名单比较部分可见字段，遗漏下游行为消费的 payload。 |
| 根因 seam | `TopicCard` 的 immutable Topic 输入和 memo comparator。 |
| 必须保持的行为 | 只有 `previous.topic === next.topic` 才复用 Topic；其余稳定 props 继续浅比较。任何新 Topic 对象都重渲染，点击和 trailing action 获得同一新对象。 |
| 精确失败 oracle | `tests/ui/shared/topic-card.test.tsx` 以展示文本相同但 url/categoryId/authorId 变化的新对象 rerender `MemoizedTopicCard`，要求点击与 trailing action 都收到新对象。修复前卡片仍调用旧 payload。 |
| 最低可靠自动测试层 | `UI_PASS`：在真实 memoized component 上观察用户动作；只断言 comparator 返回值不足以证明可见行为。 |
| Replay 或真实验收路径 | 只读 Feed/Search/User/Library 自然刷新后打开同一主题，确认跳转使用新对象；动态来源无法稳定制造同文 payload 时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复可见字段白名单或深比较后，编号测试必须错误返回 true 或失去 O(1) fast path。 |
| 明确不覆盖范围 | 不增加深比较、hash、clone 或额外 memo，不改变 TopicCard 视觉与列表库。 |

## `REG-FEED-013` Feed 请求期间先露空白再出现 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 用户症状 | 首次读取或切换来源后，顶部内容区可能先闪一帧空白，再出现灰色 Loading；请求最终仍能成功。 |
| 触发条件 | 目标来源已经由 Pager 预铺 Loading，idle 提交后 controller 短暂发布 `busy=true`、`items=[]`。 |
| 根因 seam | `FeedScreen.renderFeedScene` 在目标 route 成为 active 后立即用空 `FlashList` 替换预铺 Loading；原生列表布局和 `ListEmptyComponent` 建立前，透明 Pager 暴露页面背景。 |
| 必须保持的行为 | active 来源在无数据且读取或身份确认未完成时继续显示同一 Loading 场景，不挂载空 `FlashList`；取得数据或明确错误/空终态后才切换内容树。inactive scene、单 active rich list、冷请求、身份屏障、刷新和分页语义不变。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 的 `REG-FEED-013` 从已有 All 列表切到 V2EX，在目标 `busy + empty` 阶段要求 Loading 仍可见且 `FlashList` mount 数不增加；数据到达后才增加一次。首次空数据读取同样要求 Loading 期间不存在空列表，数据到达后恢复下拉刷新。修复前 mount 数会提前从 1 变成 2。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 Feed scene、Pager idle 与 rerender 共同固定组件树连续性；源码字符串、最终数据截图或 App 能启动都不能证明中间帧没有空列表。 |
| Replay 或真实验收路径 | 匹配 revision/APK 的 Release 模拟器执行“全部 → V2EX → 全部”，在来源提交后的请求窗口连续观察顶部内容区；只允许 Loading 或目标数据，不得出现空白、旧列表或先空后灰。 |
| 负向验证方式 | 恢复 `busy + empty` 时挂载 `FlashList`，编号测试必须因提前 mount 和 Loading 消失而失败。 |
| 明确不覆盖范围 | 不增加最短 Loading 时长、旧列表缓存、全局遮罩、背景色补丁或预请求；第三方响应速度与 `REG-PERF-004` 帧门槛独立验收。 |

## `REG-A11Y-001` Loading 与关键输入缺少稳定无障碍语义

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-03`、`ACCOUNT-04`、`TOPIC-03`、`MORE-03` |
| 用户症状 | Loading 的 Spinner 与文本可能重复播报；Search filter、NodeImage Key、评论搜索只靠 placeholder；外观和回复目标触控区域小于 48dp。 |
| 触发条件 | 共享 LoadingState 没有 status/live/busy 语义，输入缺显式 label，若干视觉尺寸同时承担 touch target。 |
| 根因 seam | `FeedbackStates.LoadingState`、三个输入入口和 `themeStyles` 的 appearance/reply 交互几何。 |
| 必须保持的行为 | Loading 作为单一 polite busy status 播报，Spinner/文本不再各自成为 accessibility element；筛选、Key 与评论搜索有明确 label；appearance segment、字号按钮/slider 与 reply head 的布局至少 48dp，紧凑 reply target 由 `hitSlop` 扩展触控区，图标尺寸和评论正文 42px 缩进不变。 |
| 精确失败 oracle | `tests/ui/shared/accessibility-basics.test.tsx` 的 `REG-A11Y-001` 固定单次 status 播报语义；Search/More/Topic UI 测试用 label 驱动真实输入；`tests/integration/style-ownership.test.ts` 固定布局尺寸与 `replyContentArea.paddingLeft=42`，`tests/ui/topic/topic-components.test.tsx` 固定 target `hitSlop`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：style 数值与真实 RNTL accessibility tree 同时覆盖；只查 placeholder 或源码字符串不足。 |
| Replay 或真实验收路径 | TalkBack 与大字体必须使用 revision/APK 匹配设备只读验收；本轮未执行时为 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除 role/live/busy、恢复 placeholder-only、缩小可点范围，或用视觉 `minHeight` 替代 target `hitSlop`，编号 UI/theme 测试必须失败；改变 42px 缩进由 `REG-TOPIC-047` 同时拦截。 |
| 明确不覆盖范围 | 不放大视觉图标、不重排评论几何、不替代完整 TalkBack/大字体设备验收。 |

## `REG-UPDATE-005` 连续版本下载累积历史 APK

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04` |
| 用户症状 | 每个更新版本使用不同 cache 文件名，连续下载会留下多个历史 APK；下载失败还可能保留 partial。 |
| 触发条件 | 目标文件名包含版本号，catch 路径未清理已经准备的下载目标。 |
| 根因 seam | `useAppUpdateRuntime.downloadAppUpdate` 的 cache target 与失败清理。 |
| 必须保持的行为 | 所有版本固定使用 `wz-update.apk`；新下载前删除旧文件，失败或取消后删除 partial，成功后保留给系统安装器读取。 |
| 精确失败 oracle | `src/platform/update/useAppUpdateRuntime.test.ts` 的 `REG-UPDATE-005` 连续下载两个版本要求同一 target 且成功只执行下载前清理；失败要求第二次幂等删除 partial、零安装。 |
| 最低可靠自动测试层 | `UNIT_PASS`：mock FileSystem 与 installer 精确观察 target、删除次数和成功/失败顺序。 |
| Replay 或真实验收路径 | APK 下载与安装属于发布风险操作，本轮保持 `NOT_VERIFIED`；只有明确授权后检查 cache 与系统安装确认。 |
| 负向验证方式 | 恢复版本化文件名或移除 catch 清理，编号测试必须看到两个路径或少一次删除。 |
| 明确不覆盖范围 | 不自动删除安装器正在读取的成功 APK，不下载真实 release，不改变签名/hash 校验。 |

## `REG-PERF-007` 进程级缓存与通知无容量或 identity 边界

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`DATA-01`、`MORE-02` |
| 用户症状 | 图片尺寸/revision 与诊断引用可随进程运行无界增长；任一原图显示会唤醒所有监听者；memo comparator 和 ReaderData render 反复做无谓扫描/序列化。 |
| 触发条件 | 进程级 Map/Set 无容量，revision 使用全局 listener Set，昂贵 signature 与 `JSON.stringify` 位于廉价 ref 检查或 lazy 初始化之前。 |
| 根因 seam | HTML 图片尺寸、原图 revision、诊断 reference、ReaderData controller 与 Topic/Reply memo comparator。 |
| 必须保持的行为 | 两个图片缓存使用现有 Map delete/reinsert 的 512 项 LRU；active revision listener 不淘汰，解除后收敛，通知只发给同 identity。诊断 raw ref 每 kind 4096、issued ref 8192，以单调 sequence 禁止 ID 重用且不记录原值。ReaderData 初始 JSON 只序列化一次；Reply/TopicContent 先比较 ref/标量，只有相同内容对象但不同 inline map 才扫描 signature。 |
| 精确失败 oracle | `src/platform/media/originalImageLoading.test.ts`、`src/features/topic/rendering/useHtmlRenderingController.test.tsx`、`src/platform/diagnostics/diagnostics.test.ts` 与 `src/features/topic/model/topicDerivedData.test.ts` 的 `REG-PERF-007` 固定容量、LRU promotion、epoch key 隔离、active listener、按 key 通知、单调引用和 signature 扫描次数；`typecheck` 固定 controller 接线。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性容量、通知和调用次数测试；未测量的帧预算不据此宣称改善。 |
| Replay 或真实验收路径 | 只读 Topic 长图/评论滚动可做后续 Release trace；若首次预览解析 p95 超过 90Hz 一帧约 11ms，再单独评估 idle prewarm。 |
| 负向验证方式 | 恢复无界 Map/全局 Set、用 `refs.size+1` 生成 ID、或把 signature 放回 ref 检查前，编号测试必须出现旧项不淘汰、跨 key 通知、ID 复用或扫描次数增加。 |
| 明确不覆盖范围 | 不增加 cache 依赖、预计算、idle prewarm 或广泛 memo；不以静态回归替代 Release 设备性能测量。 |

## `REG-PERF-009` 图片 cache getter 在 React render 阶段提升全局 LRU

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 用户症状 | 被 React 丢弃或重复执行的图片 render 也会改变进程级 cache 淘汰顺序；长帖、返回和预览切页期间，真正已提交的热尺寸、原图 revision 或 SVG artifact 可能被 speculative render 挤出。 |
| 触发条件 | preview dimensions、display revision 与 compatible SVG artifact 的 getter 在命中时直接执行 `Map.delete → Map.set`，同时这些 getter 被正文图片 render、全屏预览 render 和 `useSyncExternalStore.getSnapshot` 调用。 |
| 根因 seam | `src/features/topic/rendering/previewRenderers.tsx`、`src/platform/media/originalImageLoading.tsx` 与 `src/platform/media/compatibleImageSources.ts` 的 cache read/promotion ownership。 |
| 必须保持的行为 | 所有 render/getSnapshot cache read 都是无副作用 snapshot；尺寸只在已提交 effect 或新值写入时提升，原图 revision 只在显示事件或已提交订阅时提升，SVG artifact 只在已提交 effect、recovery 或写入时提升。既有 512/512/32 容量、完整媒体 identity、active listener pinning、按 identity 通知和异步 recovery single-flight 不变。 |
| 精确失败 oracle | `src/features/topic/rendering/useHtmlRenderingController.test.tsx`、`src/platform/media/originalImageLoading.test.ts` 与 `src/platform/media/compatibleImageSources.test.ts` 的 `REG-PERF-009` 先读取最旧项再施加容量压力，要求纯 snapshot 不改变淘汰顺序；随后通过 committed promotion/subscription/recovery 读取，要求热项保留而下一冷项淘汰。修复前三个 getter 都会让第一阶段错误保留旧项。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `STATIC_PASS`：确定性 Map 淘汰顺序固定 read/commit ownership，`npm run check:react` 固定相关 render purity；实际帧和 cache 命中率仍需匹配构建的 Release trace。 |
| Replay 或真实验收路径 | 在匹配 revision/APK 上打开含多张正文图和复杂 SVG 的长帖，滚动、进入预览、切换相邻页并返回；不得出现热图比例丢失、Spinner 回退或重复 SVG recovery。若要声明性能改善，另记录 cache hit 与 FrameTimeline，不以肉眼顺滑代替。 |
| 负向验证方式 | 把任一 getter 恢复为命中即 `delete/set`，编号测试必须因最旧项被 speculative read 错误保留而失败；删除 committed promotion 则热项保留阶段必须失败。 |
| 明确不覆盖范围 | 不改变 cache 容量、媒体协议、原图加载窗口、SVG worker 数量或预热策略；不新增 cache module、scheduler 或依赖。 |

## `REG-TOPIC-056` Discourse Callout marker 被当作普通灰色引用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 用户症状 | linux.do cooked HTML 中的 `[!warning]`、`[!caution]` 等 Callout marker 原样可见，整块按普通灰色引用渲染；评论引用展开后同样丢失黄色警告等语义，富文本标题、嵌套和折叠内容没有统一布局。 |
| 触发条件 | App 只把 Discourse `blockquote` 当通用 HTML，没有把站点 Callout 方言归一为内部语义；Topic 页面还局部持有 `blockquote` renderer，回复、引用和采纳答案无法共享同一解释。 |
| 根因 seam | `src/sources/discourse/content.ts` 的 cooked-HTML 协议边界、linux.do/小隐寺 sanitizer transform，以及 `useHtmlRenderingController` 的共享 blockquote renderer。 |
| 必须保持的行为 | 两站在 sanitizer 的同一次 DOM parse 中识别首段开头、大小写不敏感的 `[!type][+/-]`；支持 13 个主类型及 alias、未知类型 Note 回退、富文本标题、无正文、100 层 Callout 上限、嵌套和普通引用混排。转换前清除来源伪造的 `data-forum-callout-*` 与 `forum-callout-*` class，canonical 根仍为 `blockquote`。只有当前 Discourse 来源的完整 canonical 结构进入共享 `ForumCallout`；普通引用与非 Discourse 内容继续默认渲染。tone 只取 App theme，来源颜色/style/CSS/JS 不可信。`-` 初始收起、`+` 初始展开，隐藏正文不挂载；可折叠 header 至少 48dp、暴露 expanded 状态、100ms layout transition 遵循 Reduce Motion，标题链接阻止折叠冒泡。主题、回复、同/跨主题引用、采纳答案和超长分块使用同一 renderer；Topic/Search/UserActivity/引用简介不泄漏 marker。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 首个 tracer 用例在修复前得到原样 `<blockquote><p>[!warning] ...`，要求 marker 消失并生成 canonical title/content；其矩阵固定类型、alias、大小写、未知回退、富文本、折叠、嵌套、复杂正文、深度和伪造属性。`tests/integration/html-sanitization-contracts.test.ts` 固定两站单 parse 与普通 HTML fast path；`src/sources/discourse/model.test.ts`、两站 adapter 测试固定摘要清理。`tests/ui/shared/forum-callout.test.tsx` 固定 light/dark tone、48dp、expanded、未挂载正文与动画预算；`tests/ui/topic/topic-components.test.tsx` 固定 Callout/普通引用分流、非 Discourse 负例及标题链接冒泡。`REG-TOPIC-003/053/054/055` 继续固定正文/评论引用、跨主题身份、分阶段长引用和返回链。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：DOM 协议矩阵与真实 Native component/共享 renderer 同时覆盖；只查输出字符串、单一 warning 颜色或 App 能启动不能证明完整入口与交互。 |
| Replay 或真实验收路径 | 按当前 revision/bundle 直达 `https://linux.do/t/topic/342888/1`，核对 warning、caution、tip、check、todo、danger、链接、图片、列表、嵌套、浅/深色和大字体；再直达 `https://linux.do/t/topic/2685882` 展开目标评论引用，Loading 时 Android Back 可立即返回，重进使用现有 Query cache。普通 blockquote 作负向对照；全程只读，不发帖、编辑、上传、投票或探测网络。动态第三方主题不进入 tracked Replay。 |
| 负向验证方式 | 删除 normalizer、恢复 Topic 局部 blockquote override、信任来源 canonical attr/style、只处理 warning、让非 Discourse 来源进入 renderer，或折叠时继续挂载正文，编号协议/UI 测试必须分别出现 marker、错误分流、伪造语义或隐藏内容。 |
| 明确不覆盖范围 | 不增加 Callout 创作工具栏、站点管理员动态类型、运行时 CSS/JS 抓取、来源配色、Query/cache/WebView 或新依赖；若小隐寺真实内容明确把 `[!type]` 当普通文字，则保留共享协议并将来源范围改为明确 opt-in，不叠兼容规则。 |

## `REG-TOPIC-057` route epoch 被固化为 Topic 身份导致永久 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`NAV-03` |
| 用户症状 | Topic 在账号 generation 变化后会立即隐藏旧内容，但同一路由即使收到新 generation 内容仍永久停在 Loading；返回嵌套 Topic 时还可能复用已经失效的旧内容。 |
| 触发条件 | route identity 与账号 generation 混为一个不可变 seed，或 route-local controller 在 epoch 变化后继续投影旧 Query data / 拒绝接受新 generation。 |
| 根因 seam | `src/features/topic/TopicRoute.tsx` 的固定 `Topic` 参数、`src/features/topic/useTopicSessionController.ts` 的 session epoch 读取，以及 `src/platform/query/serverState.ts` 的 Topic Query key。 |
| 必须保持的行为 | route identity 只由固定 `Topic` 的 `source + id` 决定；当前 session epoch 只决定 Query scope。active route 发现 epoch 变化时立即停止投影旧远端详情并读取新 generation，同时保留 route-local 草稿、筛选、滚动与目标 Topic；inactive route 不发 Query、不恢复验证、不升级原图。嵌套 Topic 和返回只依赖 native route 实例，不使用 presentation cache、snapshot restore 或兼容入口。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-TOPIC-057` 先显示 epoch 0 详情并写入本地草稿、筛选和滚动，再切换到 epoch 1；旧详情必须立即清空、只发一次新 scope 读取，新详情到达后恢复同一 Topic 且本地状态不变。`tests/ui/app/app-navigator.test.tsx` 继续固定 Topic A → B → A、Topic → User/ReadingSettings → Topic 的 route 实例与 inactive gate。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 必须驱动 route-local controller、Query generation 和 native navigator 的真实 React state；源码字符串或单独 Query key 测试不能证明旧身份数据不可见。 |
| Replay 或真实验收路径 | 真实账号 epoch 变化会改变登录态，未单独授权时保持 `NOT_VERIFIED`；只读设备可验证普通 Topic 嵌套与返回，不得为制造 epoch 清 Cookie、切换账号或清 App 数据。 |
| 负向验证方式 | 从 Topic Query key 移除 epoch、在换代后继续投影旧详情、重置 route-local 草稿/筛选，或只拒绝旧 generation 而不接受新 generation，编号 UI 测试必须出现旧内容泄露或永久 Loading。 |
| 明确不覆盖范围 | 不新增路由层级、scheduler、测试专用产品钩子或登录态模拟；React Doctor 的其他非阻断 warning 不在此回归范围。 |

## `REG-TOPIC-058` 48dp 门禁把回复目标撑成大按钮

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；共享 `REG-A11Y-001` |
| 用户症状 | V2EX 等站点的楼层回复关系原本是紧凑标签，未发布改动后变成高大蓝色按钮，挤开正文并与内联 mention 抢层级；真实 V2EX 7 楼可稳定复现。 |
| 触发条件 | 为满足 48dp 触控门禁，直接给视觉 pill 增加 `minHeight: 48` 和居中布局。 |
| 根因 seam | `ReplyItem` 的 reply-target Pressable 与 `themeStyles.replyTargetPill` 把视觉几何误当成触控几何。 |
| 必须保持的行为 | reply target 保持原有的紧凑 padding、文字层级和 42px 正文缩进；Pressable 使用 `hitSlop=12` 扩展可点范围，仍可进入合法 User route。正文 mention 的可点语义与既有轻量背景不变。 |
| 精确失败 oracle | `tests/integration/style-ownership.test.ts` 在修复前看到 `replyTargetPill.justifyContent=center`/`minHeight=48`；既有 `tests/ui/topic/topic-components.test.tsx` 回复用例在修复前看不到 Pressable `hitSlop=12`。两个 oracle 先红后绿，不新建重复测试文件。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：style 数值阻止视觉回归，RNTL 阻止可点区和 User route 丢失。 |
| Replay 或真实验收路径 | 匹配 revision/APK 的 Release 设备打开包含 reply target 的真实楼层，以 V2EX 7 楼或等价当前样本截图比较；要求关系标签紧凑、正文不下移，点击标签进入 User 后返回原楼层。 |
| 负向验证方式 | 恢复 pill `minHeight/justifyContent`、删除 `hitSlop`、把整个正文行做成按钮，或去掉 User 导航，编号测试必须失败。 |
| 明确不覆盖范围 | 不重设所有 mention/引用视觉，不改回复解析、楼层语义、字体或其他 48dp 控件；大字体与 TalkBack 仍按 `REG-A11Y-001` 单独验收。 |

## `REG-PROXY-008` 阻塞写绕过共享 tunnel deadline

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01` |
| 用户症状 | relay 任一方向的 socket write 永不返回时，两个 copy task 和 connection worker 可永久占用并发槽；读侧 timeout 已到期也无法结束 tunnel。 |
| 触发条件 | `pipeBoth` 在启动 copy task 后无界 `latch.await()`；`Socket.soTimeout` 只影响阻塞 read，不能中断 `OutputStream.write`，tunnel 生命周期因此被误交给读循环。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 `LocalNetworkProxyServer.pipeBoth` 与既有 `TunnelIdleDeadline`。 |
| 必须保持的行为 | connection worker 按现有共享 deadline 的剩余时间循环执行有界 `latch.await(timeout)`；任一方向读取字节后重新计算剩余时间，真正过期时关闭双方 socket并退出。不创建额外线程或 scheduler，`Socket.soTimeout` 继续只作读侧唤醒。停止、切换、copy reject 和单向持续活动的既有语义不变。 |
| 精确失败 oracle | fresh prebuild 生成的 `NetworkProxyRuntimeTest.kt` 中 `regProxy008BlockedWritesCannotOutliveTheSharedIdleDeadline` 使用测试内 fake `Socket`/阻塞 `OutputStream`：双方 write 都进入且永不主动返回，短 deadline 后 `pipeBoth` 必须结算且双方 socket 都关闭；`tests/tooling/network-proxy-plugin.test.ts` 固定该测试被生成。既有单向活动续期测试继续证明活跃 tunnel 不被误杀。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Android JVM 测试直接执行真实 `pipeBoth`/executor/socket 关闭链；JS 模板字符串检查只证明生成接线，不能替代阻塞行为 oracle。 |
| Replay 或真实验收路径 | 真实代理启停、公网 tunnel 与代理凭据未获授权时保持 `NOT_VERIFIED`；不得通过公网压测或故意占用真实代理 worker 验证。 |
| 负向验证方式 | 恢复无界 `latch.await()`、只调 `Socket.soTimeout` 或为 deadline 新增不关闭 socket 的旁路线程，编号原生测试必须超时或看到未关闭 socket。 |
| 明确不覆盖范围 | 不新增线程、scheduler、代理协议、配置项或公网测试；普通 `ServerSocket` caller UID 与 DNS rebinding 风险仍归 `REG-PROXY-007`。 |

## `REG-OPS-016` Java 环境提示被写成 release provenance

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 用户症状 | 设置 `JAVA_TOOL_OPTIONS` 或 `JDK_JAVA_OPTIONS` 后，release manifest 的 `javaVersion` 可能记录提示行而非 JVM 版本；失败路径还可能把原始输出或 marker 带入日志。 |
| 触发条件 | release 脚本对 `java -version` 与 `npm --version` 共用任意首个非空行解析，而 Java 会在真正版本行前后输出环境提示。 |
| 根因 seam | `scripts/release-environment.mjs` 的 Java provenance parser 与 `scripts/release-android.mjs` 的 preflight 接线。 |
| 必须保持的行为 | Java 输出按行 trim 后只接受唯一完整匹配的 `openjdk version "…"` 或 `java version "…"` 行；stdout/stderr 合并顺序及周围 `JAVA_TOOL_OPTIONS`/`JDK_JAVA_OPTIONS` 提示不影响结果。零匹配或多匹配以固定通用错误中止，不回显原始输出或 marker。npm 继续使用既有首行解析；不改变 manifest schema、网络或存储。 |
| 精确失败 oracle | `tests/tooling/release-environment.test.ts` 的 `REG-OPS-016` 覆盖 OpenJDK、Oracle、提示位于版本行前后、零匹配和冲突多匹配；失败消息必须精确为 `无法读取可信的 Java 版本。` 且不含测试 marker。`tests/tooling/release-packaging.test.ts` 固定 release 脚本只通过 parser 接线 Java，并在命令启动失败或非零退出时选择不打印 stdout/stderr 的同一通用 preflight 错误。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `STATIC_PASS`：纯 parser 行为测试加发布脚本/打包 guard；不需要签名 APK 即可证明输入边界。 |
| Replay 或真实验收路径 | 本轮不执行正式 release、签名、APK 安装或上传，均为 `NOT_VERIFIED`；正式发布时由 clean Node 22 环境执行完整 `npm run release:android`。 |
| 负向验证方式 | 让 Java 重新使用 `firstOutputLine`、接受零/多个版本行或把原始输出拼进错误，编号测试必须记录提示行、错误接受冲突或泄露 marker。 |
| 明确不覆盖范围 | 不改变 npm/Gradle 版本解析、manifest schema、toolchain 选择、签名或发布流程，也不引入新依赖。 |

## 待确认观察

下表只保存本轮探索中出现过、但尚不足以认定为当前业务 bug 的线索。它们不等同于 `REG-*`，也不能据此增加猜测式 workaround。只有在身份匹配的当前 APK 上稳定复现并得到明确失败 oracle 后，才升级为回归条目和最低可靠测试。53 个失联 daemon、30 个工具录屏进程及设备录屏分片未清理已经有完整证据，归入 `REG-OPS-002`，不再作为“疑似”。

| 观察 ID | 能力 ID | 已看到的现象 | 当前判断 | 下一次可证伪检查 |
| --- | --- | --- | --- | --- |
| `OBS-APP-001` | `FEED-02`、`ACCOUNT-02` | 一次早期候选 APK 在四站来源切换期间出现 Chromium `NetworkService` `SIGSEGV`，随后 App 进程被系统终止；后续当前候选未稳定复现。 | `NOT_VERIFIED`：可能是 Android System WebView/模拟器瞬时故障，也可能是 App WebView 使用路径触发；单次日志不能定根因。 | 在 revision、APK SHA、设备和 System WebView 版本均记录的只读四站旅程中复现；只有再次出现相同 native crash 且能定位触发入口时才建 `REG-*`。 |
| `OBS-LIST-001` | `FEED-02`、`FEED-04` | 一次 V2EX 来源切换后，旧 Replay 的列表 readiness 断言早于稳定列表状态。后续同路径可以通过。 | `NOT_VERIFIED`：当前证据无法区分列表真实竞态与自动化 selector/等待时机问题。 | Agent Live 同时观察页面可见列表和当前 `feed-outcome-*`；若列表为空或串站且 outcome 不一致则按 Feed bug 处理，仅动态目标不足则保持 `NOT_VERIFIED`。 |
| `OBS-AUTO-001` | `ACCOUNT-02`、`RELEASE-02` | 旧 NodeSeek DOM readiness 已出现后，UIAutomator 曾因持续变化的 WebView 无法取得 idle accessibility hierarchy。 | 自动化限制，不作为 App 失败：旧 marker 已可见，冗余文案读取才阻塞。 | Replay 只依赖 App-owned settled、刷新和返回链；若 settled 本身不可达或用户无法操作页面，再升级为 NodeSeek 产品回归。 |
| `OBS-AUTO-002` | `RELEASE-02` | 本轮首次实际执行筛选 Replay 时，`npm run test:device` 在输出身份行前持续挂起；隔离执行 `agent-device devices --platform android --json` 随后报告旧 daemon PID 不可达并完成替换，启动阶段恢复。 | agent-device 生命周期异常，不作为 App 失败；恢复后另行发现并修复 `REG-OPS-003`，最终五条 Replay 全部通过。失联 daemon 为一次可观察证据，尚未形成稳定复现和独立根因。 | 给设备发现/daemon 启动增加可观察超时和首阶段日志；若相同失联状态可稳定复现，再单独建立 `REG-OPS-*`，不能与设备名称映射混为同一根因。 |
| `OBS-INPUT-001` | `SEARCH-02` | 一次 ADB 键盘提交搜索后前台回到系统桌面，随后用 App 内提交按钮复测通过。 | 自动输入路径异常，不作为搜索功能失败。 | 只在真实软键盘搜索键也能重复使 App 退出、且有对应 App/system 日志时升级；默认 Replay 使用稳定提交按钮。 |

## 新条目模板

新条目必须写明：能力 ID、用户症状、触发条件、根因 seam、必须保持的行为、精确失败 oracle、最低可靠自动测试层、Replay 或真实验收路径、负向验证方式和明确不覆盖范围。没有修复前失败证据的条目不能标记完成。
