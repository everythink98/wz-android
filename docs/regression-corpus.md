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
| 必须保持的行为 | 收藏、历史和关注用户各自稳定拥有一个 FlashList viewport；Library 聚焦时当前 viewport 同步挂载，其余 viewport 只在前一个 `onLoad` 后逐帧挂载，普通 tab 切换不重算数据、不重渲染已挂载 FlashList。离开 Library 或进入 Topic 后卸载两个非活动 viewport，只保留当前 viewport。目标 tab 首次可见状态已经是全部来源/全部分类，显示前无动画回到顶部且下一帧补偿，重复点击当前 tab 不重置筛选或滚动，Library 不锚定旧数据位置，并把预绘制距离限制为 250px；Feed、Search 等共享列表继续使用各自配置。正常头像先只走原生加载，保留一次原生 retry，第二次失败才走带 session identity 的 SVG fallback，旧 URI/session/unmount 的迟到结果不得显示。`recordHistory` 自身只保留最新 1000 条；只有可信 `history-recorded` 跳过全量 sanitize，加载、导入、合并和其他 mutation 仍完整校验，visitCount、收藏摘要、tombstone、保存队列与失败回滚不变。筛选、删除、清空和 `REG-FEED-002` 的 Feed 独立位置保护保持不变。 |
| 精确失败 oracle | `tests/ui/library/library-screen.test.tsx` 要求当前 viewport 先挂载，随后每个 `onLoad` 只在下一帧增加一个 viewport；三 tab 各自最多挂载一次，已挂载的两组 populated data 在普通 tab 切换中保持同一数组 identity 且 FlashList render 次数为 0；失焦后恰卸载两个非活动 viewport。History 第一次可见即得到未筛选数据；真实切换先调用一次 `animated=false` 滚顶、下一帧再补一次，重复点击当前 tab 不滚顶；Library 显式禁用可视位置锚定并固定 `drawDistance=250`。`tests/ui/shared/avatar.test.tsx` 要求正常位图零 SVG probe、第二次原生失败才显示 SVG、迟到结果丢弃且 fallback 失败显示文字头像。`src/domain/reader/readerData.test.ts`、`src/app/useReaderRuntime.test.ts` 与 `tests/ui/library/reader-data-controller.test.tsx` 要求 1001 条只留最新 1000 条，可信提交不重建快照且仍进入原保存队列；既有 `REG-DATA-002/003/004` 继续固定排队、失败回滚与恢复写。 |
| 最低可靠自动测试层 | `UI_PASS`：必须跨真实 React state 更新观察列表实例、目标首帧数据和滚动调用；源码字符串或单独测试筛选 helper 都不能证明没有 remount。ReaderData 以 helper `UNIT_PASS` 和 controller `UI_PASS` 共同固定快路径及数据行为，最终同步耗时仍由设备诊断 trace 复测。 |
| Replay 或真实验收路径 | 保留 App 数据执行 `tests/device/library-return.ad`；性能验收必须同时覆盖空收藏和至少 20 条真实收藏，在身份匹配构建上执行 Favorites ↔ History 20 次并用 FrameTimeline/`gfxinfo` 对照 missed-deadline、p95 和最慢帧；收藏和 History 各快速向下 20 次、向上 20 次，要求全程存在完整可见行且没有空白或抖动；最后从预热后的 Library 打开多图 Topic，确认两个非活动 viewport 已释放。 |
| 负向验证方式 | 恢复 tab 共用一个活动 viewport、让当前 viewport 同首帧批量挂载全部 sibling、用 `display:none` 使 FlashList 失去有效 viewport、重新创建稳定 data/render props、把筛选重置移回 `[libraryTab]` effect、移除切换前/下一帧滚顶、让已选 tab 也重置、重新启用位置锚定或让 Library 重新继承 900px 预绘制距离，Library oracle 或设备 View/帧门槛必须失败；恢复 mount 时 SVG probe 或接受旧身份结果，Avatar oracle 必须失败；移除 `recordHistory` 上限或让 `history-recorded` 重走全量 sanitize，数据上限或性能契约必须失败。 |
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
| Replay 或真实验收路径 | 在匹配构建上分别执行四站列表 → Topic → 返回、Topic → User → Topic、嵌套 Topic 返回；核对筛选、草稿、展开引用、滚动位置和逐层返回，并记录 20 次帧指标。 |
| 负向验证方式 | 把 Topic controller 提回全局组合层、用 `popTo(MainTabs)` 返回，或在 native pop 后重建/恢复 Topic state，编号测试必须丢失或回滚原 route 状态。 |
| 明确不覆盖范围 | 第三方请求当天延迟、随机目标是否存在和未经授权的论坛写操作不由该回归固定。 |

## `REG-NAV-002` 列表主题快速连点压入两个相同详情页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-02`、`NAV-03`；共享 `FEED-01/02`、`SEARCH-01/02`、`LIBRARY-01/03`、`USER-01` 的 TopicCard 入口 |
| 用户症状 | 在列表中快速点击同一主题后进入两层相同 Topic；第一次返回仍停在重复详情，必须再返回一次才能回到列表。 |
| 触发条件 | 第一次 `onPress` 已同步派发 native stack push，但来源页面尚未失焦或冻结时，同一卡片又收到一次 press。 |
| 根因 seam | `src/ui/topic/TopicCard.tsx` 是 Feed、Search、Library 和 User 主题列表的共享打开入口；旧实现每次 press 都直接调用 `onOpenTopic`，没有同步的重复激活门禁。 |
| 必须保持的行为 | 同一卡片在一次快速连点窗口内只调用一次打开回调；窗口结束后仍可再次打开。不同卡片、Topic 内链接、回复关系和返回栈保持原行为。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 的 `[REG-NAV-002]` 在同一共享 TopicCard 上连续 press 两次，要求回调只发生一次；推进 500ms 后再次 press 必须发生第二次，证明门禁会释放。修复前第一次断言稳定得到两次调用。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定共享入口的同步门禁；匹配 APK 才能证明真实 Android press 与 native stack 时序只产生一个详情 route。 |
| Replay 或真实验收路径 | 在身份匹配主 AVD 的 Feed、Search、Library 和 User 主题列表各选固定主题快速连点；每次只进入一层 Topic，单次 Android Back 返回原列表并保留位置。全程只读。 |
| 负向验证方式 | 删除共享 guard、把 guard 放到单个页面、在异步 push 后才置位或永久禁用卡片；编号 UI 测试或任一 sibling 入口必须失败。 |
| 明确不覆盖范围 | 不合并不同主题的明确点击，不改变 Topic 内链接、楼层重复定位、导航动画或 native stack 的 route identity。 |

## `REG-PERF-003` Feed 来源切换把列表工作压进 Pager 收尾帧

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 用户症状 | 首页左右切换来源时有明显停顿，高刷新率场景尤其容易看出；网络即使异步，目标来源的 React 提交、FlashList/TopicCard 创建和布局仍会与 Pager 收尾帧重叠。 |
| 触发条件 | native Pager 的 `onIndexChange` 在完全 idle 前同步提交 Query 来源，或 inactive scene 为温缓存挂载另一棵 populated FlashList；分类、排序或阅读筛选再通过组合 `key` 重建整棵列表。 |
| 根因 seam | `src/features/feed/FeedScreen.tsx` 的视觉来源、Query 来源、Pager idle 结算和列表物化边界；`src/features/feed/useFeedController.ts` 的来源切换入口。 |
| 必须保持的行为 | active scene 保留一棵完整 rich FlashList；所有 inactive scene 永远只渲染轻量 Loading，不读取缓存、不挂 TopicCard，也没有点击、刷新、分页、错误恢复、滚动或 accessibility 交互。`onIndexChange` 只更新视觉来源，完全 idle 后才提交最终 Query 来源；取消滑动零提交、零请求，未 idle 的连续选择只提交最终目标。idle 提交后才把目标 scene 从 Loading 物化成唯一真实列表。保留 `lazy` 与 `lazyPreloadDistance=1`；分类、排序和阅读筛选继续用稳定 active list 在提交前及下一帧滚顶，不 remount。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 要求相邻 Loading 预布局、idle 前零来源提交与零新增 FlashList mount、取消零副作用、连续选择只提交最终来源、远距离来源栏目标在 idle 前仍为 Loading，并要求任意时刻最多一棵 rich list；`REG-PERF-005` 固定 active Feed 的完整 TopicCard。`tests/ui/feed/feed-controller-session.test.tsx` 固定 Query 请求、identity barrier、迟到结果和当前来源隔离；`REG-FEED-002` 继续固定 active 稳定列表滚顶。 |
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
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 要求 `onIndexChange` 后顶部与二级导航同步指向目标，目标缓存分类与保存排序正确，pending 二级控件无回调且顶部来源仍可继续选择；inactive 与 lazy materialize 都显示既有 Loading，缓存标题不可见、idle 前零新 FlashList mount、idle 后只挂目标 active list，任意时刻最多一棵 rich list。`tests/ui/feed/feed-controller-session.test.tsx` 预置目标 Categories 及默认、分类和其他排序 Feed 缓存，要求 Categories 继续提供给视觉目标，同时切换时旧 topic 从未进入 active items、所有非 active 目标 Feed 变体被移除、transport 恰好一次；离开再返回请求次数再次增加，相同来源 no-op，identity barrier 与迟到结果仍隔离。 |
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
| 明确不覆盖范围 | 实时来源速度、分页数据正确性和四站解析由 `FEED-*` 其他测试与 Live 验收负责。 |

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
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 只确认四站入口和聚合 Feed outcome；真实 Android 上的来源/排序滚顶由 Agent Live 在找到非空目标时核对，缺少动态目标记该项 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除提交前或下一帧任一滚顶、恢复筛选组合 `key` 造成 remount，或移除 `maintainVisibleContentPosition: { disabled: true }`，对应 RNTL/Vitest 必须失败。 |
| 明确不覆盖范围 | 不固定动态主题标题、数量或来源当天可用性；这些仍按 Replay 动态结果规则与 Live 验收。 |

## `REG-FEED-004` 单站刷新失败清空可信列表

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | 单站首页已经显示主题，用户下拉刷新遇到来源错误后，旧列表和下一页 cursor 被空失败响应覆盖，只剩错误提示。 |
| 触发条件 | 首屏刷新返回 `items=[]` 与站点 `errors`；controller 在判断错误前无条件执行 response apply。分页已有失败门禁，但 `reset/nocache` 路径没有复用。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的 `validateFeedPage` 在 Infinite Query commit 前拒绝失败响应，避免覆盖已经提交的可信 pages。 |
| 必须保持的行为 | 单站首屏或刷新返回来源错误时不应用响应，保留原列表、页码和 cursor，并显示可重试错误。聚合首屏只有确有成功条目时才应用 partial；聚合分页继续禁止混入半页结果。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-004` 先加载带下一页 cursor 的 V2EX 列表，再让同站刷新返回空错误，要求主题和 cursor 均保持；修复前两者被清空。 |
| 最低可靠自动测试层 | `UI_PASS`：真实 hook state 必须跨两次请求验证旧列表和 cursor；只看错误 Toast 或 trace 终态不能证明可信内容未被覆盖。 |
| Replay 或真实验收路径 | 不主动制造来源故障；正常单站下拉刷新继续只读验收，自然失败时核对旧列表仍可见。 |
| 负向验证方式 | 让 `validateFeedPage` 接受带来源错误的单站刷新响应，编号测试会收到空列表和丢失 cursor。 |
| 明确不覆盖范围 | 不把不同来源、分类或排序的旧列表保留到新请求 key，也不缓存跨启动的远端 Feed。 |

## `REG-SOURCE-001` 聚合读取被单站凭据存储失败整体阻断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 用户症状 | 任一来源凭据存储临时读取失败时，“全部”首页或搜索可能在发起站点请求前整体失败；linux.do 还可能把读取失败伪装成无凭据，继续匿名请求并隐藏错误。 |
| 触发条件 | 读取进入 `readGateway`，某个单站 Cookie、User API 或 linux.do 凭据探针抛错；旧聚合实现让异常整体逃逸，而 linux.do 独立分支吞掉异常后匿名继续。 |
| 根因 seam | `src/sources/readGateway.ts` 的聚合凭据装配与来源错误合并边界。 |
| 必须保持的行为 | 单站读取的凭据失败仍明确失败；`all` 聚合读取只把失败记录到对应来源的 `errors`，其余来源继续使用已取得或匿名凭据读取，Query trace 终态提升为 `partial`。linux.do 存储未知不得被当成确定无凭据。 |
| 精确失败 oracle | `src/sources/readGatewayContract.test.ts` 同时让 linux.do、NodeSeek 和妖火凭据 loader 抛错，要求公开主题仍返回、三个错误各自归属且请求不携带失败凭据；linux.do 单源读取必须 rejection。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过 gateway 的真实凭据装配和结果合并；Adapter 夹具或 UI 空态不能证明请求前异常已隔离。 |
| Replay 或真实验收路径 | 不主动破坏设备 SecureStore；正常四站“全部”只读旅程继续覆盖成功路径，存储失败分支由确定性故障注入测试固定。 |
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
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 固定单站和聚合分页不进入 apply；`tests/ui/search/search-controller-ai.test.tsx` 固定搜索第 2 页解析为空后仍重试第 2 页，并固定整站重试解析为空时保留已有结果和 cursor；`tests/ui/topic/topic-session-controller.test.tsx` 与 `tests/ui/user/user-controller-session.test.tsx` 固定详情和用户资料解析为空不落地。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：controller 必须接收真实诊断元数据并验证用户可见状态、旧数据和 cursor；只测 parser 报告或 HTTP 状态无法证明结果未被应用。 |
| Replay 或真实验收路径 | 正常四站 Feed/Search/Topic/User 只读旅程继续证明成功路径；动态站点若自然出现解析空，必须看到可重试错误且返回后旧状态仍在，不得用当天真空列表冒充故障。 |
| 负向验证方式 | 移除任一 controller 的 `isParseEmpty` 门禁，编号测试必须观察到 success/apply、cursor 前进或旧状态被空结果覆盖。 |
| 明确不覆盖范围 | 不猜测新的站点 DOM/API 结构，也不把没有 `parse_empty` 证据的合法零结果改成失败；真实来源修复需另有可复现样本。 |

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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-SEARCH-003` 使用 `topics[]` 无 `posters`、`users[]` 为空且 `posts[]` 含 `post_number=1`、`username/avatar_template` 的标准响应，断言最终 Topic 保留作者和绝对头像 URL。 |
| 最低可靠自动测试层 | `UNIT_PASS` 直接覆盖真实 `searchTopics → searchLinuxDo → topicsFromLinuxDoSearchData` 链路；只测 `TopicCard` fallback、源码字符串或详情页作者都不能证明搜索字段已正确转换。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 只证明 linux.do 当前搜索请求能结算；Agent Live 只有在真实结果明确命中首帖时才核对作者、头像、详情和返回，否则按 `REG-SEARCH-013` 显示未知作者。 |
| 负向验证方式 | 临时移除明确首帖的作者 fallback，`REG-SEARCH-003` 必须精确失败，随后还原。 |
| 明确不覆盖范围 | 未登录 Google fallback 的结果本来不含可靠作者字段，本条不新增抓取或逐帖补全；不改变 Feed、Topic 或 User 页作者解析。 |

## `REG-SEARCH-013` Discourse 回复命中被丢弃或冒充楼主

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | linux.do 有真实回复命中却显示“内容无法解析”，或把命中回复者、最后回复者显示成主题作者。 |
| 触发条件 | Discourse 搜索返回合法 `topics[]` 和命中回复 `posts[]`，但 topic 没有可映射的 Original Poster，且命中帖的 `post_number>1`。 |
| 根因 seam | `src/sources/linuxdo/search.ts` 曾丢弃缺少可靠 OP 的回复命中，或把命中 post/`last_poster_username` 归一化成主题作者。 |
| 必须保持的行为 | 搜索命中本身足以保留结果。只有 `topics[].posters → users[]`、`details.created_by` 或明确的首帖才能填写主题作者；其余情况作者留空，由现有 TopicCard 显示“未知作者”。命中回复仍提供摘要，候选不得计入 dropped/parse_empty；不得新增逐主题请求。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定 linux.do 二楼命中同时提供回复者和最后回复者，要求结果保留、作者为空；可靠 `details.created_by` 仍投影为 OP。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须经过两站公开 search adapter 和诊断汇总；TopicCard 已有空作者降级，动态标题或单次页面成功不能固定作者语义。 |
| Replay 或真实验收路径 | 保留 linux.do 当前登录态，只在原站响应自然命中回复时核对 App 保留条目并显示未知作者，不清 Cookie 制造状态。 |
| 负向验证方式 | 恢复空作者即丢弃，或再次使用匹配回复/最后回复者作为主题作者，编号测试必须失败。 |
| 明确不覆盖范围 | 不猜测楼主、不逐条读取主题详情，也不新增“命中回复者”字段；若产品以后要展示命中者，应作为明确的独立语义。 |

## `REG-SEARCH-014` Google JavaScript capability gate 被当成外部跳转

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | 真实未登录设备上，NodeSeek 或 linux.do 搜索很快提示“页面跳转到外部地址，已停止读取”；同一关键词在 Android Chrome 可正常显示结果。 |
| 触发条件 | Google 对 Android WebView 搜索先返回 HTTP 200 的 JavaScript capability bootstrap，并在同一 Google origin 导航到 `/httpservice/retry/enablejs?sei=...`；响应没有 403/429、CAPTCHA 或 unusual-traffic 证据。 |
| 根因 seam | `src/features/account/HiddenBrowserHost.tsx` 曾把 hidden WebView 的每一次顶层导航都套用最终结果 URL 白名单；NodeSeek 生产 `webViewFetcher` 又只接收论坛域，导致 scoped Google 请求根本不进入 hidden WebView。后续若用论坛域/Google 的并集白名单代替 initial-task binding，还会让搜索任务跨域并错误结算。 |
| 必须保持的行为 | 四站搜索按真实协议分流：V2EX 使用 SoV2EX；NodeSeek 与 linux.do 使用各自 `site:` 约束的 Google fallback；妖火站内搜索需要会话并收口到登录提示。NodeSeek 与 linux.do 的生产 fetch port 都必须把自身 scoped Google URL排入对应 HiddenBrowserHost。Google capability gate 只在 initial 已是同一来源的受限 Google search、目标仍为 exact `https://www.google.com`、无 userinfo/非默认端口/hash、路径精确且只有一个合法 `sei` 时作为中间导航放行；普通 `/search` 导航和最终 bridge 结果必须保持 initial 的同一 `q/start`。Google flow 不得跨回论坛域，论坛 flow 不得转成 Google；任意子域、双 `site:` token、额外 query、另一搜索、gate 作为结果及外部 host 都拒绝。 |
| 精确失败 oracle | `tests/integration/security-boundaries.test.ts` 固定 NodeSeek/linux.do 的 exact origin、唯一同站 token、同一 `q/start`、精确 gate 正例及跨任务/跨类型负例；`tests/ui/account/hidden-browser-host.test.tsx` 通过真实 WebView props 固定两站 gate 导航不中断、论坛回跳/另一搜索/非精确 gate 立即失败；`tests/ui/account/session-controller-browser-flow.test.tsx` 固定生产 NodeSeek connector 必须排入 HiddenBrowserHost，并拒绝把论坛页结算成 Google 搜索结果。`tests/integration/source-read-contracts/` 与 `tests/device-logged-out/logged-out-readonly.ad` 分别固定四站 transport 矩阵和用户可见收口。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` 固定协议分流、connector 和 gate；匹配身份的 `DEVICE_REPLAY_PASS` 只证明当前 Android hidden WebView 能让请求进入可见 outcome，不证明 Google 或第三方当天返回数据。是否实际经过特定 `/enablejs` 中间 URL 只能由可观测 gate canary 证明。 |
| Replay 或真实验收路径 | 在不含论坛登录数据的独立 AVD 上，用同一身份 APK 执行 `tests/device-logged-out/logged-out-readonly.ad`；先确认三站 Account Query 均为权威未登录状态，再提交一次聚合搜索，逐来源接受当前请求的数据、空态、来源错误、Google/CF 阻碍或妖火登录限制，relaunch 后身份仍不变。各站真实结果由 Agent Live 报告；Cloudflare 只允许在 App 内完成访客验证，不登录论坛。 |
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
| 用户症状 | 聚合搜索完成后，账号状态提示与第一组结果之间突然多出一大块空白；来源越多，额外间距越明显。 |
| 触发条件 | Replay 为每个聚合来源创建一个无内容 `View`，并把它们放进带 `gap: 10` 的 Search Header `stack`。节点没有可见内容，却仍逐个参与 Flex 布局。 |
| 根因 seam | 自动化结算状态被实现成生产布局节点，而不是既有可访问元素的状态。 |
| 必须保持的行为 | Search Header 不包含只为自动化存在的空布局节点。聚合 Replay 只等待现有 FlashList 上的 `search-all-sources-settled`；该标记仅在 `aggregateSearchSources` 中每个来源都存在且结束 Loading 后出现。单站继续使用既有 `search-complete`。提交前已有的列表间距保持不变。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 计算 Header 中空 flow child 造成的 gap，修复前稳定得到 50、修复后必须为 0；同文件还要求缺任一 catalog 来源时没有聚合结算标记。`tests/tooling/android-smoke-guard.test.ts` 禁止 `search-outcome-*` 并要求两条 Replay 只等待聚合标记。420dpi 模拟器中最后一条账号提示到底部与 V2EX 标题顶部的间距由修复前 184px（70dp）恢复为 52px（约 20dp），与自动化提交前已有间距一致。 |
| 最低可靠自动测试层 | `UI_PASS` 固定真实 React Native 布局树和结算时序；`DEVICE_REPLAY_PASS` 复核 Android 实际间距与 accessibility marker。源码字符串或 Replay 单独变绿不能证明样式已恢复。 |
| Replay 或真实验收路径 | 在保留数据的匹配 APK 上进入 Search → 全部，提交一次查询并等待聚合结算；对照提交前基线检查最后一条账号状态与首个来源标题的间距，再执行 `tests/device/search-multi-source.ad`。 |
| 负向验证方式 | 恢复按来源生成的空 outcome `View` 后，UI 用例必须重新得到与来源数成比例的额外 gap；删除 catalog 完整性判断后，缺来源用例必须提前暴露结算标记。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的同名 fixture 经过真实 `searchTopics → searchNodeSeek` 链路，构造空 `.post-list`、3 个 footer `post-*` 链接和 1 个 stale embedded topic，要求空 `items` 且诊断为 `candidateCount=0`、`validCount=0`、`droppedCount=0`、`isExpectedEmpty=true`、`isParseEmpty=false`；修复前稳定得到 `3/0/3/false/true`。相邻用例继续固定只有搜索表单的未完成页面必须 reject。 |
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

## `REG-SEARCH-020` 搜索来源 Tab 比首页明显偏大

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 用户症状 | 搜索页四站来源 Tab 比首页同一组来源明显更高、更宽，切换底部导航后视觉尺度跳变。 |
| 触发条件 | `SearchScreen` 使用共享 `PillRail` 的默认 Tab 几何，而首页显式使用已有的 `compactTabs` 几何。 |
| 根因 seam | `src/ui/controls/SelectionControls.tsx` 同时提供默认 48dp Tab 与来源栏 compact Tab；`src/features/search/SearchScreen.tsx` 漏传 compact 语义，形成同一来源导航的两套尺寸。 |
| 必须保持的行为 | 首页与搜索顶部来源栏在 Reader 100% 时都使用 40dp 高度、自然宽度和 13 号字，并继续随 Reader 字号缩放；其他共享 Tab 保持默认 48dp 几何，触控 `hitSlop`、选中态和来源切换行为不变。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 通过真实 `SearchScreen → PillRail` 断言 `search-source-all` 为 `minHeight=40`、自然宽度和 13 号字；`tests/ui/feed/feed-screen.test.tsx` 的 `REG-FEED-016` 固定首页同一规则。修复前搜索稳定得到 48dp。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖真实页面传参和共享组件合成后的最终几何；只测试 `PillRail` 自身不能发现调用页漏传。 |
| Replay 或真实验收路径 | 在相同 Reader 字号下依次打开首页和搜索，对照四站来源栏的高度、自然宽度、文字和选中态；130% 字号下再次确认文字同步缩放且不拥挤。 |
| 负向验证方式 | 移除搜索页的 `compactTabs`，同名 UI 测试必须重新得到 48dp 并失败，首页既有用例仍通过。 |
| 明确不覆盖范围 | 不全局缩小 `PillRail` 默认 Tab，不改变搜索请求、结果、筛选状态或其他页面的 Tab 尺寸。 |

## `REG-SEARCH-021` linux.do 搜索会话途中失效后没有切到 Google

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 用户症状 | 聚合搜索只有 linux.do 长时间停留在“搜索中”；重新登录后同一页面才完成。请求开始时 App 仍把旧会话投影为已登录，因此没有采用原本已有的匿名 Google 搜索。 |
| 触发条件 | linux.do 身份在请求开始前已确认登录，但 Cookie 随后失效；`/search` 返回 HTTP 401，或响应正文明确表示需要登录（包括重定向后的 200 登录页）。 |
| 根因 seam | `src/sources/linuxdo/search.ts` 只在发请求前按 `authenticated` 选择一次协议，authenticated search 响应明确失效后没有转入同一 Adapter 已有的 `searchLinuxDoGoogle`；`fetchLinuxDoJson` 还把 200 登录页误作普通格式错误。 |
| 必须保持的行为 | 当前 authenticated search 遇到 HTTP 401 或明确 `accessRequirement.type=login` 时，只切换一次既有 Google site-search 并返回其结果；Google 请求不复用 Discourse 登录请求头。明确权限不足、Cloudflare、网络、解析和取消错误保持原分类，不自动重试，不给 Search Controller 增加 timeout、队列或会话恢复循环。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-SEARCH-021` 先固定匿名 Google 结果，再以已确认 access 分别让 linux.do 请求返回 401 与 200 登录页，要求同一 Adapter 链两次都返回相同 Google 结果；修复前分别稳定抛出 `HTTP 401` 与格式错误。 |
| 最低可靠自动测试层 | `UNIT_PASS`：来源契约 fixture 可确定性固定协议切换和结果解析；UI timeout 无法证明切换发生在正确 seam。 |
| Replay 或真实验收路径 | 匹配 APK 的聚合 Search 必须有限结算；若验收期间自然遇到 linux.do 会话失效，确认该来源改用 Google 并显示未登录搜索提示。不得主动清 Cookie、退出账号或破坏登录态制造条件。 |
| 负向验证方式 | 删除 authenticated search 的精确失效 catch，编号测试第二次调用必须重新抛出 401；把普通 403、网络错误或取消也纳入 fallback，应由相邻来源错误契约与完整测试拒绝。 |
| 明确不覆盖范围 | 不由搜索请求清除 Cookie或直接改写 canonical 会话；全局身份投影仍由账号 Query 更新。不保证 Google 当天有结果，也不把任意 HTML、权限错误或无限重试当作登录失效。 |

## `REG-SEARCH-022` linux.do Google 结果被渲染成“无标题”

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 用户症状 | L站未登录 Google 搜索出现“无标题”卡片；页面结构变化时还可能被误报为合法空结果。 |
| 触发条件 | Google 返回可映射到 linux.do Topic 的站内候选，但链接只有 URL、面包屑、slug、摘要或没有可确认标题；旧解析器在标题过滤后才计数，TopicCard 又用“无标题”掩盖空值。 |
| 根因 seam | `src/sources/linuxdo/search.ts` 的 Google 候选/标题提取、`src/sources/searchRead.ts` 的统一读取边界和 `src/ui/topic/TopicCard.tsx` 的展示兜底共同放松了标题契约。 |
| 必须保持的行为 | 先按 canonical Topic ID 聚合候选，再只接受结果块内 `h3`、`role=heading` 或可靠 `aria-label` 的非 URL、非面包屑、非 slug 标题。混合页面只保留有效项并记录 `candidateCount/validCount/missingTitleCount`；候选全部缺标题或零候选且不是明确空结果时返回 `parse_empty`，明确无结果才是空列表。`searchRead` 在写入 Query cache 前再次拒绝空白标题，TopicCard 不制造标题。NodeSeek Google parser 保持独立。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-SEARCH-022` 固定 URL/面包屑不可作标题、混合结果保留有效项及缺标题计数、明确空结果与未知结构分离；`src/sources/searchRead.title-contract.test.ts` 注入空白标题并要求读取边界 reject；`tests/ui/shared/topic-card.test.tsx` 要求空标题不会渲染“无标题”。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY`：adapter fixture 固定第三方标记解析，读取边界固定 cache 前契约，RNTL 固定 UI 不再掩盖；匹配 APK 才能证明当前移动端 Google 页面。 |
| Replay 或真实验收路径 | 在匹配 revision/APK 的未登录 Search → linux.do 查询普通关键词；只能出现带真实标题的结果、明确空态或可理解的解析/限制错误，不得出现“无标题”。不得清 Cookie、绕过 CAPTCHA 或提交原始 HTML。 |
| 负向验证方式 | 恢复整段链接文字兜底、把 URL/面包屑当标题、在标题校验后计候选、让未知零候选页面返回空态，或恢复 TopicCard 的“无标题”，对应编号测试必须失败。 |
| 明确不覆盖范围 | 不新增搜索后端、API key、共享 provider 或 selector 状态机；不改变 NodeSeek Google 解析，也不保证第三方 HTML 永久不变。 |

## `REG-SEARCH-023` Google 同任务会话跳转被拦截或误报为 linux.do 外链

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`；共享 `SEARCH-01`、`SEARCH-02` 的未登录 Google fallback |
| 用户症状 | L站匿名搜索被 Google 导航到同一个 `/search?q=...&sei=...` 后，App 错误拦截并显示“linux.do 页面跳转到外部地址”或“Google 搜索流程已变化”；真正的验证、登录、consent 与未知流程也缺少准确原因。 |
| 触发条件 | Google 在保持 site 查询和页码不变时附加单个 `sei` 会话参数；旧判断把最终 URL 必须严格落在初始 `q/start` 参数集合当作任务身份。其他受控 Google host/path 的拒绝又全部落入来源外链文案。 |
| 根因 seam | `src/sources/searchFallback.ts` 把 Google 生成的惰性会话参数与 site/query/page 任务身份混为一谈，且 `src/features/account/HiddenBrowserHost.tsx` 没有对其余拒绝原因做局部分类。 |
| 必须保持的行为 | Google 搜索任务身份由 HTTPS `www.google.com`、`/search`、site 查询和 `start` 页码共同确定。只允许身份完全不变的初始 URL，或只额外携带一个格式受限且不可重复的 `sei`；该语义同时用于 linux.do/NodeSeek 导航与结果 URL 识别。精确 JS capability gate继续允许。查询/页码变化、额外参数、redirect、`/sorry`/CAPTCHA、consent、login、未知 Google 路径和跨站继续拒绝，并显示准确原因。诊断仅记录受限 host、path、参数键名和分类，不记录参数值、完整 URL 或 Cookie。 |
| 精确失败 oracle | `tests/integration/security-boundaries.test.ts` 的 `REG-SEARCH-023` 固定同任务 `q/start + sei`、exact JS gate/`SG_REL`、重复或非法 `sei`、额外参数、查询/页码篡改、跨站、sorry、consent、login 和未知路径；`tests/ui/account/hidden-browser-host.test.tsx` 固定两站同任务跳转可继续及 linux.do 拒绝文案；`src/platform/diagnostics/diagnostics.test.ts` 固定只保留结构字段。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY`：URL fixture 与 RNTL 固定安全和文案边界；只有同 revision/APK 的未登录实际跳转才能支持新增良性 allowlist。 |
| Replay 或真实验收路径 | 在匹配 revision/APK 的未登录 Search → linux.do 发起 Google 查询；自然出现 `www.google.com/search` 的 `q,sei` 形态时必须继续读取，并最终显示带真实标题的结果、明确空态或准确限制错误。只核对脱敏 host/path/参数键名，不提交原始 URL 或 HTML。 |
| 负向验证方式 | 放宽任意 Google `/search`、接受 query/site/page 变化或 redirect 参数、允许 consent/login/sorry/CAPTCHA，或把未知 Google 流程恢复成 linux.do 外链，编号测试必须失败。 |
| 明确不覆盖范围 | 不接受尚无设备实证的其他 Google 参数或路径，不自动登录、同意 consent、重试或绕过 CAPTCHA，不记录原始导航 URL。 |

## `REG-LINUXDO-001` linux.do Cloudflare 429 被降级且大响应被截断

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | linux.do 实际要求 Cloudflare 验证时，直连已识别为 `verification-required`，隐藏 WebView 却把主文档 429 提前报成普通未知错误；偶尔挑战后已得到 200，又因正文固定截断为 12,000 字符而 JSON 解析失败。 |
| 触发条件 | 可信 CF header/body 触发隐藏 WebView fallback；Android WebView 先回调主文档 `onHttpError(429)`、随后仍完成页面或跳转到 200；成功 JSON 大于 12 KB。 |
| 根因 seam | `src/sources/linuxdo/browserFallback.ts` 的 CF 分类、`src/features/account/HiddenBrowserHost.tsx` 的主文档生命周期、`src/features/account/useHiddenBrowserFetchController.ts` 的 bridge 序列化，以及 `src/features/account/useSessionController.ts` 的最终 Response/typed error 结算。 |
| 必须保持的行为 | 只有可信 CF 特征才能触发验证，普通 429 原样返回；主文档 HTTP error 只记录并继续等待最终 DOM，子资源错误忽略，新导航清除旧状态。合法正文在 900 KB bridge 上限内完整往返，超限明确返回 `content-too-large` 且不得伪装成 CF；直连已确认 CF 而 renderer/脚本无法复核时保持 typed CF 结论。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-LINUXDO-001` 分别固定普通 429 不进入 WebView、已确认 CF 后 renderer 失败仍为 typed CF、挑战导航后的普通 429 保持 429；`tests/integration/hidden-browser-scripts.test.ts` 固定超过 12 KB JSON 精确往返和超 bridge 上限的非 CF 显式失败；`tests/ui/account/hidden-browser-host.test.tsx` 固定 429 不提前失败及新主文档清除旧状态；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定 challenge 无伪造 403 Response。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定分类、序列化、Response 与 typed error 契约；`UI_PASS` 固定 RNC WebView 事件顺序。只有源码字符串、普通页面成功或单次 Cookie 保存不能证明 Android 429 challenge 链路。 |
| Replay 或真实验收路径 | 只在 App 内自然出现 linux.do challenge 时，从单站 Feed/Search/Topic/User 读取进入 overlay，完成验证并观察原读取恢复；不得清 App 数据、Cookie 或登录态制造 challenge。无法自然触发时记 `NOT_VERIFIED` 或 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 临时恢复 LinuxDo 正文 `.slice(0, 12000)`、在 `onHttpError(429)` 直接 fail、把 bridge 超限标成 `challenge: true`，或让普通 429 触发 fallback；对应 `REG-LINUXDO-001` 用例必须精确失败，随后还原。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不保证原站当天出现 challenge，也不把普通 Rate Limiting 429 当作验证成功或失败；大于 bridge 上限的响应不做分片扩展。 |

## `REG-LINUXDO-002` linux.do 验证关闭重开并无限循环

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 用户症状 | 首页聚合的 linux.do child 命中 CF 后面板不拉起，或检测一次后自动循环重开；只剩 V2EX 的 partial 内容还可能被当成新的账号/ReadPlan 状态。 |
| 触发条件 | 聚合错误只为单站来源生成 recovery；read recovery 被错误接入 Account auth-surface lifecycle，检测时先改身份/epoch/query key，再重试已经失活的 Query。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的聚合 partial error 投影，以及 `src/features/account/useVerificationController.ts` 对 read recovery 与登录 surface 的责任边界。 |
| 必须保持的行为 | 聚合 Feed 仍服从每来源 5 秒预算；linux.do 返回 `verification-required` 时先显示其他来源内容并自动拉起现有验证页。这个面板是 read recovery：不改 Account snapshot、session epoch、ReadPlan 或 query key，也不进入登录 surface barrier。用户每次显式“检测状态”只调用 exact active Query 的 `resume()` 一次；成功后关闭，仍为 CF 或普通失败时保持面板可重试，不自动再次检测或递归拉起。用户关闭使 recovery stale；非幂等写操作绝不重放。Account 手动入口没有 read recovery 时仍按原账号协议核对。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 固定 aggregate partial 保留 V2EX/其他来源、验证页只拉起一次、query key/scope 不变，首次恢复仍为 CF、第二次显式恢复成功且无循环；`src/features/account/useVerificationController.test.ts` 固定 recovery 模式零 Account event/reconcile/auth-surface 回调，每次点击只 resume 一次，manual 模式仍走账号核对。Topic/Search/User 既有 exact-key recovery 用例保持。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：必须用真实 QueryClient/Controller 固定 partial 内容、恢复次数和身份零变化；拿到 `cf_clearance`、Modal 已关闭或 App 可启动都不能证明恢复成功。 |
| Replay 或真实验收路径 | challenge 自然出现时，在首页“全部”确认其他来源先可见、overlay 只出现一次、每次点击只恢复一次；成功后列表恢复且不换账号/来源筛选。无法自然触发时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 让聚合错误不拉起、检测前调用 Account reconcile、改变 epoch/query key、Cookie 保存即关闭，或将仍为 CF 当成功；编号测试必须失败。 |
| 明确不覆盖范围 | 不手工合并 linux.do child cache，不自动重放写操作，不新增持久化 schema、feature flag 或全局恢复调度器。 |

## `REG-LINUXDO-003` 验证后的原页面恢复失败却提示成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01` |
| 用户症状 | linux.do 验证 Cookie 已保存，但原 Feed/Search/Topic/User 请求随后遇到普通网络或解析失败时，overlay 仍提示“页面已恢复”并关闭；写成功后的回复刷新也会被诊断为完整成功。 |
| 触发条件 | read recovery 的返回值只有 completed/verification-required/stale，controller 在普通 catch 或来源错误分支默认返回 completed；引用帖和写后刷新还丢失了显式失败结果。 |
| 根因 seam | `LinuxDoReadResumeOutcome`、四类 read controller、引用帖恢复以及 `useVerificationController`/`useTopicActionsController` 对恢复终态的消费边界。 |
| 必须保持的行为 | `completed` 只表示原读取已经成功应用；普通网络、来源或解析失败必须返回 `failed`。read recovery 失败保持验证面板并提示用户显式重试，不补发账号事件、不撤销 confirmed，也不改 ReadPlan/query key。写请求本身已成功但跟随刷新失败时保持写成功结果，同时把诊断终态记为 `partial/refresh_failed`。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 固定 recovery failed 保持面板且零账号事件；`tests/ui/feed/feed-controller-session.test.tsx` 固定聚合/单站普通恢复失败返回 failed；`tests/ui/topic/topic-session-controller.test.tsx` 固定引用帖失败精确传播；`tests/ui/topic/topic-actions-controller.test.tsx` 固定写后 failed refresh 记录 partial；Search/User 既有 recovery 用例覆盖相同 union。 |
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
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定显式匿名、官方匿名 404、登录用户、畸形成功响应与非契约 401/403/429；`tests/integration/source-read-contracts/` 固定可信 CF 与 Account-only hidden WebView fallback；`src/platform/network/loginWebViewScripts.test.ts` 固定 logged-in/logged-out/unknown 三态；`src/features/account/useVerificationController.test.ts` 固定明确退出只发布失效、不调用清理，且 unknown 不改变可信状态。修复前匿名响应得到 `ok:true`，后续版本又曾把正确或错误的退出判断升级为原站 Cookie 删除权限。 |
| 最低可靠自动测试层 | `UNIT_PASS`：请求契约、页面脚本和 controller 状态提交必须一起通过；仅检查 `_t`、CSRF、搜索错误文案或 App 启动都不能证明真实登录。 |
| Replay 或真实验收路径 | 仅在当前设备自然处于失效态时验收：覆盖安装并冷启动；若服务端身份检查已有明确结论，账号中心直接显示失效，否则进入账号中心 → linux.do → 检测或重新登录，在 App 内原站明确显示登录按钮后点“检测状态”。随后账号中心应显示 linux.do 已失效，搜索不再进入登录专属路径。不得清 App 数据、Cookie 或重置模拟器制造状态；动态登录态不写入 Replay。 |
| 负向验证方式 | 把账号探针恢复为 `/session/csrf`、删除 WebView `status` 上报/过期分支，或在 `logged-out` 分支调用原站 Cookie 清理；编号测试必须分别恢复假登录、漏掉失效或触发未经用户授权的删除。 |
| 明确不覆盖范围 | 不自动重新登录，不输入或保存新凭据，不保证 Google 当天可达或有结果，也不以普通网络/限流/CF 错误推断退出。 |

## `REG-LINUXDO-005` 冷启动丢弃已确认终态并重新按 Cookie 猜登录

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 已确认 linux.do 账号在每次冷启动先变 unknown/public，首页和搜索短暂换 lane、重复请求；或首次升级仅凭残留 Cookie 直接伪造登录。 |
| 触发条件 | 启动只恢复 Cookie 候选而不持久化最后确认终态，或反过来把候选当成身份正证据。 |
| 根因 seam | `src/platform/storage/accountSessionStore.ts` → `useAccountStatusController` 本机恢复/一次性迁移 → ReadPlan/Search Query key。 |
| 必须保持的行为 | 已持久化的 authenticated/anonymous 终态在下次启动直接恢复并作为唯一 ReadPlan 输入，正常启动零 Account probe。首次升级只有 Cookie/SecureStore 候选决定“值得核对”，不能直接证明登录；候选来源有界核对一次并写全局 marker。无记录或损坏保持 unknown/public；429、网络、CF 和解析失败不改已有 confirmed。linux.do public/authenticated Search 仍使用不同 key/transport；明确失效更新 App 投影但保留 WebView Cookie。 |
| 精确失败 oracle | `src/platform/storage/accountSessionStore.test.ts` 固定版本/字段/损坏隔离；`tests/ui/account/account-status-controller.test.tsx` 固定三站终态恢复零 probe、迁移只核对候选且不重复；`tests/ui/app/app-runtime-startup.test.tsx` 固定恢复前无 transport、恢复后唯一 ReadPlan；Search/Gateway tests 固定 public/authenticated key 与 Cookie lane 隔离。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：启动状态、Account Query 合并、Search Controller、Query key 和真实来源 adapter 必须共同通过；只测 Cookie 解析、错误文案或单个搜索 fallback 不能证明整条状态链一致。 |
| Replay 或真实验收路径 | 主设备保留数据覆盖安装，连续 process-cold launch 应直接恢复上次终态且零 Account probe；独立未登录 AVD 继续验证未登录 Search/Feed。不得清主设备 App 数据或 Cookie 制造状态。 |
| 负向验证方式 | 删除持久终态恢复、让每次启动重 probe、把 Cookie 候选直接设 logged-in，或让 Search public/authenticated 共用 key/transport；对应测试必须失败。 |
| 明确不覆盖范围 | 不把 429、网络、CF 或普通来源错误当成失效，不自动清理或重新登录，不保证匿名 Google 当天可达或返回结果。 |

## `REG-LINUXDO-006` 页面退出后的后台 Query 串扰验证与等级恢复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`；共享 recovery 回归 `TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | 用户已经离开 Search/Feed 后，旧搜索、AI 或分类请求仍在 More 页后台重启并拉起 linux.do、NodeSeek 或妖火面板；linux.do 验证开始后 Search 从登录 key 漂移到匿名 key，旧 recovery 失活，面板随即关闭又重开；“查看等级”命中 CF 时没有精确 recovery，验证流程清掉 Level cache 后反复取消、弹出或无法落地等级。 |
| 触发条件 | App 级 controller 长期挂载，Query 只按提交数据或筛选条件 `enabled`，没有当前 `screen` 所有权；`enabled:false` 不会中止已经执行的 Query。`verification-started` 又把 canonical 会话暂时投影为未登录，使 Search key 和 transport 参数同时切换；Level 仅做 disabled Query 的一次 `refetch`，验证控制器却无条件重置 Level cache。 |
| 根因 seam | `useAppRuntime` 当前页面与各 route 的 `active` / 验证 overlay → Feed、Search、Account controller 的 Query 执行权；Search 的稳定认证模式 → 结构化 Query key 与 Gateway 参数；Level 的 exact active Query → `LinuxDoReadRecovery` 与 session reset 保留边界。 |
| 必须保持的行为 | `AppNavigator` 把根页面切换投影为长期挂载 route 的 `active`；离开页面立即 cancel，旧结果不得后台重启或拉起面板。linux.do read-recovery overlay 保留已加载内容，不改认证 key、session epoch、ReadPlan 或 query key；它可暂停页面自身的新 linux.do AI/候选/categories，但不形成全局身份 barrier，也不阻止其他来源。关闭只使 recovery stale；显式检测对 Feed/Search/Topic/User/Level exact Query 最多 resume 一次，仍为 CF 时可再次手动检测但不自动循环。真实登录失效、退出和换号仍只走 Account owner。 |
| 精确失败 oracle | Navigator、Feed/Search/Topic/User/Level controller 测试固定 active/cancel、exact key、一次 resume 和 sibling 来源不受阻断；`src/features/account/useVerificationController.test.ts` 固定 recovery 模式零 Account reconcile/event/epoch 变化，manual 登录模式仍走 Account；`tests/ui/feed/feed-controller-session.test.tsx` 固定 aggregate CF 时其他来源可见。 |
| 最低可靠自动测试层 | `UI_PASS` 通过真实 QueryClient 固定 observer active、AbortSignal、页面切换、恢复次数和面板回调；`UNIT_PASS` 固定 verification/session reset 对 exact key 的保留与终态。只检查 `enabled` 值、Modal 可见、Cookie 已保存或源码字符串不能证明后台请求已经停止。 |
| Replay 或真实验收路径 | 在不清 App 数据、Cookie 或登录态的前提下，仅于自然 challenge 出现时验收：Search 触发 CF 后只出现一次 overlay、原请求只恢复一次；保留搜索后进入 More 查看等级，诊断中不得出现后台 Search/Feed，Level 应落地且 overlay 关闭；验证期间手动关闭后 recovery 失效且不重开。无法自然触发 CF 时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 移除 `screen` 门禁/cancel，检测时改变 Account/epoch/query key，恢复 overlay 的全局 gate，删除 Level recovery 或 reset Level cache；对应测试必须出现后台调用、跨来源阻断、旧 key 或重复请求并失败。 |
| 明确不覆盖范围 | 不新增全局 WebView/Query 优先级调度器，不重构完整 session 状态机，不改变外部 API、持久化 schema、原生配置或写权限契约；不人为制造 Cloudflare challenge。 |

## `REG-LINUXDO-007` Account 网络探测失败后前台读取永久 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`TOPIC-03`；共享回归 `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`USER-01` |
| 用户症状 | 打开 linux.do Topic 后页面一直 Loading，既不请求 Topic，也不出现验证窗口；用户手动进入 linux.do 验证、保存状态并再次打开后才正常加载。 |
| 触发条件 | canonical Account probe 在收到 HTTP Response 前以 `network_error` 结束；旧实现把检查 activity 写进身份并长期阻断 Topic。现有 CF response 检测器没有运行，因此现场不能把底层 transport 错误直接认定为 Cloudflare。 |
| 根因 seam | exact `/session/current.json` 的 canonical Account reader → direct/hidden WebView transport → 结构化身份检查终态 → `useAccountRuntime` 前台单站 intent → Feed/Search/Topic/User Query barrier 与验证面板。 |
| 必须保持的行为 | linux.do Account 只走 canonical `getCurrentUserProfile`，当前用户为登录、404/明确匿名为退出，其余为 unknown。只有 exact background Account GET 的 direct `network_error` 可进入一次 hidden WebView；timeout、cancel、HTTP、其他 intent 和写操作不得进入。hidden 成功提交权威身份；普通失败在既有 5 秒 per-source 预算内结算本次检查，释放 `isVerifying` 并保留原 confirmed identity/ReadPlan；从未有终态时才保持 unknown。Feed/Search/Topic/User 公开 operation 不等待账号检查，strict 能力按当前事实 fail-closed并提供手动重试。可信 challenge 只属于触发它的 intent，每次最多自动打开一次。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定 direct network error→hidden success、challenge、普通失败及不合格 fallback 负例；Account controller 固定 5 秒结算、confirmed 不变和 single-flight；ReadPlan/Gateway/consumer tests 固定检查 activity 不冻结公开读取，true unknown 使用 no-cookie lane，strict blocked 不永久 Loading。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：Account fallback/终态、ReadPlan、实际 Gateway transport、Query 次数和用户可见恢复必须共同固定；App 能启动、源码字符串或只看到 Modal 都不足以证明公开读取未被账号状态冻结。 |
| Replay 或真实验收路径 | 基于当前 revision 构建 x86_64 Release 并覆盖安装，保留 App 数据、Cookie 和登录态；在自然账号核对或 ordinary unknown 期间打开 linux.do Feed/Search/Topic/User，公开内容必须继续结算且不误弹验证，账号中心自身显示可重试终态。只有自然出现 challenge 时才验对应严格 intent 的单次恢复；否则该轴记 `NOT_VERIFIED`，不得清数据制造 challenge。 |
| 负向验证方式 | 恢复 source-wide identity barrier、让普通 `network_error` 永久 pending、让 public lane 读取 Cookie 或 managed fallback、放宽 Account fallback URL/intent/reason、把 ordinary 失败升级成 challenge，或在公开页面自动打开面板；对应编号及 `REG-SOURCE-011/REG-ACCOUNT-041` 测试必须失败。 |
| 明确不覆盖范围 | 不证明现场 direct `network_error` 的底层原因就是 Cloudflare，不绕过验证、不自动登录、不清 Cookie、不增加全局状态平台，也不把 AI、候选、等级、写入或通知降级为公开能力。 |

## `REG-VERIFICATION-001` WebView 页面事件取代用户检测

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`；共享读取回归 `FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 用户症状 | linux.do、NodeSeek 或妖火面板在页面加载/跳转时自动保存、恢复或关闭；用户随后点击“检测状态/登录”却复用已消费的内部结果，没有重新读取当前凭据，最终出现“暂未生效”、旧结果覆盖新结果或开关循环。 |
| 触发条件 | WebView `onLoadEnd` 或 probe message 直接调用检测/保存/recovery，把页面观察当成用户提交；业务 recovery 另有永久 one-shot guard，导致第一次失败后后续按钮不再联网。 |
| 根因 seam | WebView 的候选观察边界 → 用户显式检测的提交边界 → generation/session 所有权 → 原读取 recovery 的完成证明。 |
| 必须保持的行为 | 验证/登录面板仍可因当前前台读取失败自动打开，但 WebView load、readiness、probe 和 message 只更新当前面板候选、User-Agent 与诊断，不得保存凭据、发布 canonical session transition、调用 recovery 或关闭面板。检测按钮单次只允许一个在途操作；每次已结算后再次点击都必须重新读取当前 Cookie/凭据并执行真实来源检查，不得返回永久缓存或 one-shot 结果，迟到结果必须由 panel session、credential generation 和 request owner 判 stale。linux.do 携带 exact recovery 时，只有同一原读取返回 `completed` 才关闭；仍为 CF 或普通失败时保留面板和 recovery，Account 手动入口成功后仍保持打开。NodeSeek 页面消息不得直接判 canonical 过期，检测按钮每次重新读 Cookie stores；妖火按钮每次 flush stores 并执行 direct 登录检查。NodeImage OAuth callback 是协议终态，不属于检测按钮，继续自动完成。 |
| 精确失败 oracle | `src/features/account/useVerificationController.test.ts` 固定 challenge/普通 WebView message 均不能在用户点击前消费 recovery，并固定连续两次已结算检测会执行两次 exact resume；`tests/ui/account/account-controller.test.tsx` 固定 Level 再次 CF 后下一次显式恢复产生第三次真实 source 调用、NodeSeek 每次手动检测重新读取 stores、妖火每次手动检测重新 flush 并 direct check；Account controller 不再接收可由 NodeSeek page message 发布 canonical transition 的接口；`tests/ui/account/account-site-panels.test.tsx` 固定 NodeSeek/妖火 `onLoadEnd` 不触发检测而按钮触发。既有 Feed/Search/Topic/User exact recovery、Session generation 与 NodeImage OAuth 测试继续通过。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：必须观察真实 Cookie/store/source 调用次数、exact recovery 结果与面板终态；仅证明 WebView 已进入首页、Cookie 字符串存在、提示变化或 Modal 可见不构成检测成功。 |
| Replay 或真实验收路径 | 不清 App 数据、Cookie 或登录态：分别打开 linux.do、NodeSeek、妖火面板，等待页面完成后确认没有自动成功/关闭；每次点击检测都应出现新的脱敏 credential/source trace。自然出现 CF 时，linux.do 原读取成功后才关闭，仍为 CF 时保持可再次点击；无法自然触发 CF 时该段记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一 `onLoadEnd`/message handler 中重新调用检测或保存，给 recovery 恢复永久 `resumed` guard，或让 NodeSeek 被动 logged-out message dispatch `login-expired`；对应编号测试必须出现点击前副作用、第二次无 source 调用或 canonical 状态污染并失败。 |
| 明确不覆盖范围 | 不绕过 Cloudflare、不伪造 clearance、不自动重放写操作；不把 OAuth redirect 错当成普通 WebView readiness，也不引入新的全局任务调度器。 |

## `REG-VERIFICATION-002` 业务响应关键词被误判为验证页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 用户症状 | linux.do 搜索返回正常结果后却打开 CF 面板；面板显示已登录的普通首页，没有 challenge。用户点击“检测状态”时 WebView Cookie 已重新读取并保存，但恢复搜索再次被误判，于是仍提示“验证未生效”。NodeSeek 或妖火的 API、帖子正文出现相同关键词时也可能错误拉起验证/登录面板。 |
| 触发条件 | linux.do/NodeSeek 的 transport 与隐藏 WebView 无条件扫描完整响应正文或页面文本中的 `cf-turnstile`、`challenge-platform` 等词，或仅凭普通 `403`、`429`、登录接口 `404` 推断 challenge；妖火把正文中的“访问验证”、`CAPTCHA_CONFIG` 或“请先登录网站”直接当作页面状态。正常 JSON、可读 HTML、限流或代码讨论因此取得了验证工作流执行权。 |
| 根因 seam | 来源 transport 响应元数据与正文 → Cloudflare/访问验证分类器 → direct/WebView fallback → session recovery 与验证面板。 |
| 必须保持的行为 | `cf-mitigated: challenge` 始终是 Cloudflare 权威信号，即使响应 MIME 异常也必须进入验证；缺少 header 时只检查 HTML challenge 的 title、表单、Turnstile/Challenge DOM 或 script。普通 `403`、`429` 或登录接口 `404` 本身均不是 challenge，只按各站现有业务/身份协议结算；明确非 HTML、JSON Content-Type、无 Content-Type 但正文为 JSON、普通 HTML 讨论文字也不得触发 CF。NodeSeek 已识别的列表、详情、受限提示、搜索或 JSON 必须优先作为业务页面；隐藏 WebView 也先返回 JSON/可读业务 DOM。妖火只有验证页 title、captcha script/元素等结构证据才进入访问验证；可读帖子里的验证、登录文案和代码示例仍是正文。真正 challenge、用户显式检测、exact recovery 和面板关闭语义继续由既有回归保持。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 用合法 Discourse 搜索 JSON 固定当前设备日志中的误判，并固定 NodeSeek JSON/普通 HTML、无 challenge header 的普通 403/429 不进入 WebView fallback；`src/sources/sourceErrors.test.ts` 固定 header 优先、严格 HTML 结构、无 header JSON、普通 HTML 文本与普通状态码均为非 challenge；`tests/integration/hidden-browser-scripts.test.ts` 固定两站隐藏 WebView 的 JSON 和可读 NodeSeek DOM 优先；`src/sources/yaohuo/reader.test.ts` 固定普通帖子可讨论“访问验证”“请先登录网站”和 `CAPTCHA_CONFIG`。这些用例修复前分别抛出 CF、调用 fallback、回传 `challenge:true` 或抛出妖火验证错误。 |
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
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 的 `REG-VERIFICATION-004` 分别用 12 秒 fake timer 驱动 NodeSeek、linux.do、妖火，要求 WebView 卸载且显式刷新后恰好 remount；旧实现三例都保留 `mock-login-webview`。`tests/tooling/android-smoke-guard.test.ts` 固定发布 Replay 不以动态 WebView 为前置。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定三站组件生命周期，匹配 Release APK 的 Agent Live 证明失败 WebView 不再阻断 Android hierarchy；截图只能辅助定位，不能替代可重复 oracle。 |
| Replay 或真实验收路径 | 用与 revision/version/SHA-256 匹配的 Release smoke APK 覆盖安装且保留登录态；tracked `nodeseek-session.ad` 只确认账号 terminal 与恢复入口。随后在 NodeSeek、linux.do、妖火 Agent Live 中打开 WebView，页面正常完成或 12 秒后进入 App 错误均应结算，刷新创建新页面，系统返回回到 More。 |
| 负向验证方式 | 删除 timeout 的卸载状态、让刷新前自动 remount，或在 timeout 后继续渲染旧 WebView；三个 UI oracle会看到旧 mount，匹配 APK 的 Live 路径会再次因 busy hierarchy 超时。 |
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
| Replay 或真实验收路径 | 不主动破坏真实身份接口；账号中心正常刷新继续核对三站状态。自然遇到单站失败时，旧身份应保留并显示检查失败，其他站照常更新。 |
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
| Replay 或真实验收路径 | 覆盖安装后正常启动并进入账号中心，核对现有三站状态；不破坏 SecureStore 制造失败。 |
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
| Replay 或真实验收路径 | 正常账号中心刷新三站；自然遇到单站失效或存储失败时核对该站错误且其他站照常更新，不破坏凭据制造状态。 |
| 负向验证方式 | 让任一收尾 rejection 回到公共 catch，或把 linux.do 过期恢复成 cookie-loaded，编号测试必须失败。 |
| 明确不覆盖范围 | 不主动篡改 Cookie、不清 SecureStore，也不把清理失败当成仍然登录成功。 |

## `REG-ACCOUNT-009` 旧账号刷新覆盖刷新期间保存的新会话

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | 用户点击刷新账号状态或发起写操作后在站点登录完成，先启动的旧请求仍可能把 NodeSeek、linux.do 或妖火的新会话覆盖成未登录、检查失败或登录已失效，并为新会话弹出错误登录入口。 |
| 触发条件 | 账号刷新和写操作只把 credential generation 传给条件清理/保存，没有在网络检查、action 响应和最终 session/UI 提交前再次核对同站 generation。 |
| 根因 seam | `useAccountStatusController`、`useTopicActionsController` 与 `discourseActionRuntime` 的站点 credential snapshot、异步请求、过期清理和 SiteSessionState/动作结果提交边界。 |
| 必须保持的行为 | 三站分别捕获请求开始时的 generation；检查、action、清理或身份持久化结束后只允许仍属当前 generation 的结果更新 UI、清理 SecureStore/WebView Cookie、更新 App 凭据候选或登录投影、弹登录入口或重置等级。媒体不存在独立 Cookie 状态；JS 只携带内容来源 marker 与 opaque identity，原生再按首跳与重定向链决定是否从 WebView CookieJar 实时读取，不从媒体目标 URL 推断身份。某站变 stale 不影响其他站或新会话继续完成。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 在旧刷新等待凭据读取时推进 generation，要求旧请求不执行远端身份读取、不写 Query data 或显示旧错误；`src/sources/readGatewayContract.test.ts` 固定 linux.do 等级等 managed read 在 transport 结算前换 generation 时拒绝且不落 cache；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 在 NodeSeek 删除进行中排队新登录保存，要求旧清理不再进入 WebView Cookie 和 `cleared` 提交；`tests/ui/topic/topic-actions-controller.test.tsx` 分别让三站旧 action 等待后推进 generation，要求不清新凭据、不改 session、不提示或打开登录。 |
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
| 根因 seam | `useNetworkProxyRuntime` 的安全存储加载终态、native apply effect 与 `ensureNetworkProxyReady` 门禁。 |
| 必须保持的行为 | 代理配置读取失败必须进入用户可见 failed 状态并阻断所有受代理保护请求，不能推断用户未启用代理；成功保存新的明确配置后才可退出加载失败门禁并重新应用。 |
| 精确失败 oracle | `tests/ui/more/network-proxy-controller.test.tsx` 注入 SecureStore load rejection 与 native disable rejection，分别要求 `ensureNetworkProxyReady` fail-closed、显示配置读取失败且不能静默转为直连；Account、HiddenBrowser、Topic media 与 App startup 的 RNTL 用例分别要求 block message 透传且不挂载 WebView。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：controller 的 ref、ready promise 和 guard 证明请求门禁，RNTL 证明各 WebView 消费者接线；只测 SecureStore loader 或错误文案不能证明没有直连。 |
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
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 固定当前 WebView attempt 的成功、明确错误和代理阻断都进入 App 自有 `nodeseek-login-webview-settled`，永久 Loading 不结算且始终保留“刷新页面”；`tests/device/nodeseek-session.ad` 只等待账号 terminal 与对应恢复入口。 |
| 最低可靠自动测试层 | `UI_PASS` 固定 App-owned settled 分支，`DEVICE_REPLAY_PASS` 证明 Android 账号入口，WebView surface、刷新和返回链需 `LIVE_PASS`；第三方正文或身份当前可用同样只能由 Live 证明。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad` 不发起动态 WebView；登录 WebView、刷新、返回和动态登录结论只接受 App 内同类页面，并由 Agent Live 形成独立证据。 |
| 负向验证方式 | 删除 settled、刷新或返回行为，或让 Loading 提前暴露 settled，UI oracle 必须失败；让 fixed Replay 再依赖 WebView 或第三方标题/logo/帖子文案，Replay 守卫必须失败。 |
| 明确不覆盖范围 | Replay 不清登录、不清 Cookie，也不声明当天原站 DOM 永久稳定。 |

## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | NodeSeek 登录 WebView 已显示“页面打开超时”或加载失败，Replay 仍因 ready testID 可见而通过。 |
| 触发条件 | readiness 脚本消息在超时或错误状态之后到达；旧 Replay 又固定等待 15 秒，只检查 ready testID，不检查错误是否存在。 |
| 根因 seam | `src/features/account/components/NodeSeekLoginHost.tsx` 的 WebView readiness/error 状态和对应 RNTL/Live 等待 oracle。 |
| 必须保持的行为 | 成功、明确错误或代理阻断都让当前 attempt 进入 App 自有 settled；错误必须可见并保留“刷新页面”，迟到成功消息不得覆盖错误。Loading 期间不暴露 settled。Replay 证明流程结算，不把错误分支叫作第三方成功。 |
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 分别固定成功与错误共享 `nodeseek-login-webview-settled`、错误文案与刷新入口，并让迟到/伪造消息不能把错误改成成功；`tests/tooling/android-smoke-guard.test.ts` 禁止固定 sleep 和 success-only oracle。 |
| 最低可靠自动测试层 | `UI_PASS` 固定分支互斥和共同 settled；匹配 APK 的 `LIVE_PASS` 再证明 Android surface 能结算、刷新和返回。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad` 只等待账号 terminal 和恢复入口；App-owned WebView settled、刷新、返回及数据/身份结果由 Agent Live 分轴报告，明确外部阻碍记数据 `BLOCKED_BY_ENV`。 |
| 负向验证方式 | 让 Loading 提前暴露 settled、错误后隐藏刷新、迟到成功覆盖错误，或把 Replay 改回只等成功，UI/Replay 守卫必须失败。 |
| 明确不覆盖范围 | 不保证 NodeSeek 当天必定可访问；正确错误流程不冒充第三方数据成功，也不掩盖 App 请求或会话缺陷。 |

## `REG-NODESEEK-003` NodeSeek 真实页面已可用但 Replay 内部 marker 超时

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | App 内 WebView 已出现可操作内容，Replay 却依赖第三方标题、logo、“新帖子”或 success-only 内部 marker；DOM 变化或桥接时序会让正确流程超时。 |
| 触发条件 | 设备测试把第三方 DOM 细节或 success-only bridge 当成固定发布 oracle；健康、错误和代理阻断没有统一的 App-owned 结算表面。 |
| 根因 seam | NodeSeek WebView 的设备级 oracle 及 `tests/tooling/android-smoke-guard.test.ts` 的 Replay 守卫；不是 NodeSeek 页面加载产品逻辑。 |
| 必须保持的行为 | RNTL/Live 只等待当前 attempt 的 `nodeseek-login-webview-settled`、App 自有“刷新页面”和系统返回；成功、明确错误或代理阻断均可结算，永久 Loading 失败。固定 Replay 只等待账号 terminal 和恢复入口，不读取第三方标题、logo、帖子文案，也不增加 sleep 或 retry。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 禁止 fixed Replay 进入动态 WebView、读取 `logo`、“新帖子”、第三方 DOM 或旧 `nodeseek-login-webview-ready`；`tests/ui/account/account-site-panels.test.tsx` 固定 marker 只属于当前已结算 attempt。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 Replay 判据，`UI_PASS` 固定 App-owned settled，匹配 APK 的 `LIVE_PASS` 证明 Android WebView surface 和返回路径。 |
| Replay 或真实验收路径 | 运行静态守卫与账号 WebView RNTL 后，在身份匹配的 APK 上执行 `tests/device/nodeseek-session.ad` 验账号入口；第三方 WebView、内容和登录态由 Agent Live 核实。 |
| 负向验证方式 | 向 fixed Replay 恢复动态 WebView、第三方 DOM、success-only marker 或固定 sleep，守卫必须失败；让 Loading 暴露 settled，UI 测试失败。 |
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
| 最低可靠自动测试层 | `UNIT_PASS` 固定 ID → 名称映射，`DEVICE_REPLAY_PASS` 证明 agent-device 实际接受该参数并走完七条普通旅程；隔离未登录旅程另行形成独立证据。二者缺一不能宣称对应设备闸门恢复。 |
| Replay 或真实验收路径 | `npm test -- tests/tooling/android-smoke-guard.test.ts`；随后在身份匹配的保留数据设备上执行 `npm run test:device`，七条普通 Replay 均须 `retries=0`；需要未登录证据时另在隔离 AVD 执行 `npm run test:device:logged-out`。 |
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
| Replay 或真实验收路径 | `.env.release.local` 保持 `WZ_ANDROID_SMOKE_DEVICE=WZ_Pixel_API_35`，执行 `npm run release:android`；身份行必须记录解析后的 display name/ID，七条普通 Replay 全部零重试通过；真实未登录另按 `REG-OPS-009` 在隔离 AVD 执行。 |
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
| 最低可靠自动测试层 | `UNIT_PASS` 固定七条普通与一条隔离未登录 Replay 的生命周期契约；`DEVICE_REPLAY_PASS` 证明真实 daemon、manifest 和 Android `screenrecord` 连续收口。 |
| Replay 或真实验收路径 | `npm run test:device` 在空录屏基线上连续执行七条 `--record-video` Replay；未登录套件另在隔离设备执行一条，并分别核对设备与本机任务进程基线。 |
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
| 触发条件 | 真实未登录 Replay 与普通七条 Replay 共用 `tests/device/`、同一个设备环境变量或自动设备选择。 |
| 根因 seam | 文件发现目录、设备选择和 APK 身份校验没有把“普通保留数据设备”与“从未登录论坛的隔离 AVD”建模为两个外部环境。 |
| 必须保持的行为 | `npm run test:device` 与 Release Smoke 只发现 `tests/device/` 七条普通旅程；`npm run test:device:logged-out` 只发现 `tests/device-logged-out/`，且必须显式设置与主测试/Smoke 设备不同的 `WZ_ANDROID_LOGGED_OUT_DEVICE`。两套都核对同一待测 APK 的 version/versionCode/SHA，均不得卸载、清数据或清 Cookie。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-009` 精确断言两个目录的文件集合、独立 runner、显式设备变量和 Smoke 不引用未登录目录；`logged-out-readonly.ad` 还要求三站 Account Query 在 relaunch 前后都结算为权威未登录状态，其中 NodeSeek 允许“未登录”或仅访客“已验证”，linux.do 显示“匿名可用”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定目录与设备门禁；七条普通 `DEVICE_REPLAY_PASS` 和一条独立未登录 `DEVICE_REPLAY_PASS` 分别证明两个真实环境，不能互相替代。 |
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
| Replay 或真实验收路径 | 当前开发包七条 `npm run test:device`，另在隔离 AVD 运行一条 `npm run test:device:logged-out`，随后执行 `npm run release:android` 的七条普通 Replay。 |
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
| 最低可靠自动测试层 | `UNIT_PASS` 固定配置边界；开发包七条普通、隔离 AVD 一条未登录与 Release 七条普通 `DEVICE_REPLAY_PASS` 分别证明真实 wall-clock 行为。 |
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
| 最低可靠自动测试层 | `UNIT_PASS` 固定 session 生命周期；完整 `npm run release:android` 的 `APK_SANITY` 与七条 `DEVICE_REPLAY_PASS` 证明真实 CLI/模拟器链路。 |
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
| 必须保持的行为 | “只看楼主”“只看带图”和评论内查找显示当前可见回复数；“全部”继续显示主题总回复数；可见列表、选中状态和数量必须同步。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 渲染真实 Topic 回复筛选控件：一条完整交互旅程同时断言全部、只看楼主、只看带图和评论查询后的列表、选中状态与标题数量；独立 debounce 用例固定输入已清空但结果尚未更新时的列表与数量一致。`src/features/topic/useTopicSessionController.test.ts` 固定确定性过滤结果。 |
| 最低可靠自动测试层 | `UI_PASS`：Vitest 可证明过滤数组，但只有 RNTL 能证明用户看到的标题数量跟随数组变化；完整交互旅程与 debounce 用例都必须真实通过。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 分别断言正文跨主题引用和评论同主题引用的简介/完整帖边界；`src/domain/forum/quotedPosts.test.ts` 固定跨主题同楼层缓存隔离，并要求同主题当前楼层优先于旧 quote cache；`tests/ui/topic/topic-reply-filters.test.tsx` 固定主楼引用展开后显示已编辑/刷新的同主题当前正文而非旧 cache；`tests/ui/topic/topic-components.test.tsx` 独立断言 `TopicBodyQuoteCard` 与 `ReplyItem` 默认只见简介、展开后才见匹配的完整帖且错误主题内容不可见；`tests/integration/style-ownership.test.ts` 固定评论外层无卡片圆角、保留分隔线，并固定签名、统计和操作栏的间距契约。 |
| 最低可靠自动测试层 | 数据边界和缓存键使用 `UNIT_PASS`；正文引用与评论引用的独立可见行为至少使用 `UI_PASS`。四站实际 HTML、字体和末尾内容造成的视觉间距仍需要 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 用用户给定的原站主题链接按内部直达方式打开 App 详情；对同时含正文引用和评论引用的 linux.do 主题分别检查默认简介、展开完整帖、收起与返回状态。再按 `docs/testing-standard.md` 的四站评论末尾分支矩阵检查普通文本、表情/图片、留言/签名、reaction/统计/感谢、操作栏和分隔线。全程只读。 |
| 负向验证方式 | 向缓存放入另一个主题的同楼层帖子，或让旧 quote cache 与当前同主题楼层同时存在时，UI 必须仍显示当前主题的完整帖；删除正文或评论任一独立 UI 用例、改回楼层号缓存、让评论外层获得卡片圆角，均必须使对应测试失败。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 模拟缺少签名即 403，固定未投/已投、多选/锁定、多个标记部分失败、成功标记删除与失败标记保留；`src/sources/nodeseek/actionRequest.test.ts`、`src/sources/nodeseek/actionClient.test.ts` 固定投票专用 header 和权威结果 GET；`tests/ui/topic/topic-actions-controller.test.tsx` 固定 `POST × 1 → GET × 1`、服务端快照与 GET 失败的单次 POST；`src/domain/forum/topicActionState.test.ts` 固定已知票数正常合并、未知票数不伪造成 `1`。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定 API 标记、渲染表单以及“相邻 `">` 块 + 重复标记”的真实形态只产出一个 NodeSeek 占位；`tests/ui/topic/topic-reply-filters.test.tsx` 固定重复占位输入下投票节点仍位于前后正文之间且只出现一次。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-WRITE-010` fixture 保留目标帖的“同一 `<p>` 内前文 + `">` + 块级投票 + 后文 + sticker”形态，要求无泄漏前缀、合法 `1 > 0` 仍在、前文/唯一占位/后文顺序不变且段落不被拆散；`tests/ui/topic/topic-reply-filters.test.tsx` 要求该输入只有一个正文渲染根，投票只出现一次并位于前后文之间。 |
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
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 注入linux.do 单站空错误结果，要求 notify 且不应用成功空态。 |
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
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `REG-SEARCH-007` 通过真实 Controller 同时让 linux.do、NodeSeek 和妖火要求动作，等待五个 Query 结算后断言聚合面板回调均为零；成对的妖火单站用例对同类 `login-required` 断言登录面板恰好打开一次。 |
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
| 根因 seam | `src/domain/forum/forumContentMedia.ts` 在 sticker/image regex 前的 quoted-tag normalization。 |
| 必须保持的行为 | 引号内 `>` 属于属性内容；sticker、前后正文和 inline 流顺序都保持，真正 tag 结束符才参与分片。 |
| 精确失败 oracle | `src/domain/forum/forumContentMedia.test.ts` 的 `REG-TOPIC-011` 固定 `title="1 > 0"` sticker 与前后正文均保留。 |
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
| Replay 或真实验收路径 | 四站含链接/mention 正文只读检查，点击后可返回。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-016` 用 quoted `>` 图标 fixture 要求正确 `thanksCount`。 |
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
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest` 固定两个内部头在发网前移除、同来源首跳可读 Cookie、跨来源/无效 marker 匿名继续、Cookie 读取异常 fail-closed，以及离源后跳回仍不恢复。`tests/tooling/release-packaging.test.ts` 与 `tests/tooling/network-proxy-plugin.test.ts` 固定 Expo Image/Video 使用 managed client 且视频不继承图片总时限；`src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/image-preview.test.tsx`、`tests/ui/topic/image-preview-controller.test.tsx` 与 `src/platform/media/imageSave.test.ts` 固定各入口只传内部来源与 identity 头、不在 JS 传输 Cookie 快照。 |
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
| 必须保持的行为 | 当前页原生失败后可启动受限 SVG artifact 恢复；静态 artifact 显示海报，动画 artifact 才显示单个隔离 document view。相邻页只允许低优先级原生请求和受预算 display underlay，原生失败时仅记住失败，不启动 fetch、海报或 WebView。该页成为当前页后才允许恢复；离开当前页取消其未结算的 UI 所有权。健康位图不额外 fetch，远页不挂载，图库不恢复缩略图栏。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-021` 固定 direct Response 已返回但 challenge body 尚未读取完成，模拟 35 秒后台后要求请求仍未失败，恢复时由原 direct 请求成功返回且不调用 WebView fallback。 |
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
| 精确失败 oracle | `src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定观察/身份变化分类、source + `all` 清理、其他来源隔离和结构化 recovery key；`tests/integration/query-session-contracts.test.ts` 固定 session epoch key；`tests/ui/feed/feed-controller-session.test.tsx`、`tests/ui/search/search-controller-ai.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx` 与 `tests/ui/user/user-controller-session.test.tsx` 固定 epoch 隔离、barrier、分页/回复/引用/双 cursor 恢复及聚合 Search 其他来源继续完成。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 Query 取消、事件分类和精确 cache 边界；`UI_PASS` 通过真实 `QueryClientProvider` 固定 observer、cursor、Loading、来源隔离及固定 Feed/Library 导航；四站动态读取仍需 `LIVE_PASS`。 |
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
| 用户症状 | linux.do的 `/u/alice/summary`、`/activity` 等公开 profile tab 被外部打开，尽管 App 已有同一用户页。 |
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
| 触发条件 | linux.do、NodeSeek、妖火或 V2EX adapter 用 truthy 判断数字，0 被转成 undefined。 |
| 根因 seam | `src/sources/linuxdo/account.ts`、`src/sources/nodeseek/protocol.ts`、`src/sources/yaohuo/normalization.ts` 与 `src/sources/v2ex/reader.ts` 的可选非负统计归一化。 |
| 必须保持的行为 | 来源明确返回的有限非负 0 必须保留；字段缺失仍为 undefined；负数拒绝。妖火两个组成统计均已定义时，包括 0，派生总数。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 与来源 parser tests 分别固定四站显式零统计。 |
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
| 用户症状 | 离开 linux.do 或妖火详情后从账号中心执行 NodeSeek 签到，操作可能按上一个 Topic 串行并取消其详情/回复 Query，签到的 mutation 诊断来源也错误。 |
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
| 用户症状 | 账号中心显示某站已登录，但详情没有应有写入口；或账号已进入验证/失效状态，详情却继续开放回复。 |
| 触发条件 | 账号刷新 Query 已得到新的远端会话状态，而 Topic action controller 仍直接读取授权 workflow 的旧 `SiteSessionStates`。两份投影可以同时给出相反的可写结论。 |
| 根因 seam | `src/features/account/useAccountRuntime.ts` 向 `src/features/topic/TopicRoute.tsx` / `actions/useTopicActionsController.ts` 投影 writable session 能力的边界。 |
| 必须保持的行为 | Topic 写入口只使用账户 Query 与当前验证 workflow 合并后的 `accountSessionViewModels`；验证中、失效或匿名必须撤销该站写入口，确认已登录则开放站点级写能力，再由主题 `can_create_post` 和逐条 `can_*` 权限 fail-closed 收窄。不得新增第三份登录状态或绕过对象权限。 |
| 精确失败 oracle | `src/features/topic/actions/topicActionDecision.test.ts` 固定 unsupported、login-required、identity-pending、object-forbidden、missing-target、already-complete、pending 与 allowed 的唯一判定；`tests/ui/topic/topic-actions-controller.test.tsx` 构造 workflow 与 Account 投影相反，要求只以当前 Account 投影进入唯一 mutation owner。 |
| 最低可靠自动测试层 | `UI_PASS`：用真实 Controller 与合并后的 view model 固定 Topic 可见权限；纯 parser 单测无法暴露跨 Controller 状态分叉。 |
| Replay 或真实验收路径 | 账号中心刷新后分别打开 NodeSeek、linux.do 与妖火详情；只读核对账号状态和写入口一致。主题或帖子本身不可写时必须继续隐藏对应入口，不发送回复。 |
| 负向验证方式 | 改回从 `effectiveSiteSessionStates` 派生 Topic actions，编号测试会再次得到与账户投影相反的两个布尔值。 |
| 明确不覆盖范围 | 不把“已登录”解释成所有主题都可回复或所有帖子都可点赞；不改变原站权限字段、授权 scope 或写请求协议。 |

## `REG-ACCOUNT-018` 等级刷新失败被保留的旧数据误报为成功

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04` |
| 用户症状 | linux.do 等级成功加载过一次后，再次刷新失败仍提示成功并继续展示旧等级，用户无法知道本次请求失败。 |
| 触发条件 | 同一 Query key 先成功、后 refetch reject；TanStack Query 同时保留可信 `data` 和本次 `error`。 |
| 根因 seam | `src/features/account/useAccountController.ts` 的刷新结果投影先判断 retained data，再判断当前 error。 |
| 必须保持的行为 | 旧等级可继续只读展示，但本次刷新必须返回失败并提示当前错误；不得发成功提示，也不得清除可信旧数据。 |
| 精确失败 oracle | `tests/ui/account/account-controller.test.tsx` 先成功建立可信 linux.do 等级，再让 refetch 失败；要求保留旧 profile、返回失败并只提示刷新错误。 |
| 最低可靠自动测试层 | `UI_PASS`：必须观察真实 Query 的 data/error 并存状态和 controller 通知结果。 |
| Replay 或真实验收路径 | 账号中心只读展开 linux.do 等级；自然网络失败时核对旧数据与错误并存。不得为制造失败而清登录。 |
| 负向验证方式 | 把刷新逻辑恢复为先依据 `query.data` 返回成功，两个编号测试都会因误报成功或缺失错误提示失败。 |
| 明确不覆盖范围 | 不固定动态等级数值，不把暂时失败解释为退出，也不自动重试或重新授权。 |

## `REG-ACCOUNT-019` 三站登录态投影不一致

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 用户症状 | NodeSeek 当前登录已经失效，搜索 transport 已回退 Google，但 More 与搜索状态灯仍显示已登录，Topic 写入口也可能继续开放；公开页里的业务文案或旧 Topic 身份又可能被误当当前用户；修复共享缓存 seam 时还可能把旧登录带进新 generation 或误清其他站身份。 |
| 触发条件 | NodeSeek 保存过 userId 且公开资料仍可读取，当前响应同时含明确游客与残留用户字段，真实游客页使用 `/signIn.html`、`/register.html` 而旧 probe 未识别，或弱设置/通知/UID 内容被当当前用户；linux.do 新文档仍收到旧 probe 消息；妖火公开卡片含“我的/欢迎”但没有可信 self-account 结构；站点协议明确返回匿名字段/结构，或成功响应缺少 current user；目标站旧 `account-status` Query 仍有活跃 disabled observer。 |
| 根因 seam | 当前凭据验证与按 ID 公开资料、Topic 身份或 Cookie 候选混用；WebView probe 缺少文档所有权；妖火把业务文字或“未识别为退出”当成功；Discourse reader 没有完整区分明确匿名与协议不确定；Account Query 与 session epoch 更新时序既可能擦掉刚提交的身份结果，也可能通过全局 previous data 保留旧登录。 |
| 必须保持的行为 | 三站 Credential、generation、Account Query 和验证协议继续按站隔离，但遵守同一证据边界：只有当前凭据端点返回当前用户，或站点专属可信账号容器给出明确 self-account 结构，才是 `logged-in`；只有该站协议明确约定的匿名字段、状态或准确游客结构才是 `logged-out`；其他 HTTP 状态、成功但缺字段、普通业务页、CF、超时、网络与解析不确定都是 `unknown`。Cookie、旧 ID、Topic 作者、公开资料和普通“我的/欢迎”文案不是登录证明；明确游客证据优先于同一响应残留 self 字段。NodeSeek 与 linux.do 手动 probe 使用当前文档私有 nonce/documentKey，新文档先作废旧结果；明确 `logged-out` 只更新 App 为失效，不删除原站 Cookie；三站 unknown 均不清理并保留上次可信身份。外部会话变化 reset 目标站 Account Query；查询自身确认失效则先提交 exact expired，再只 seed 该结果到新 scope，普通新 scope 不继承旧登录。其他两站 data/error/busy 不变。各站精确状态契约由 `REG-ACCOUNT-025/026` 固定。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/platform/network/loginWebViewScripts.test.ts` 与 `tests/ui/account/account-site-panels.test.tsx` 固定 NodeSeek 公开资料禁用、真实 `.html` 游客结构、明确游客优先级及两站 probe 文档所有权；`src/sources/yaohuo/reader.test.ts` 固定公开卡片/业务文案 unknown；`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定 current user、显式匿名与畸形 200 分界； 固定只读检查不发布 workflow；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/integration/query-session-contracts.test.ts` 固定 active disabled Query reset 与 exact expired 新 scope seed；`tests/ui/account/account-status-controller.test.tsx` 固定确认失效提交时序、普通新 scope 不继承旧登录、清理失败和三站 unknown 保留身份；`tests/integration/session-presentation-contracts.test.ts` 同时固定 More 非登录、Search 灯非绿色/Google 文案和 Topic 不可写。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Query observer reset、controller 异步结算和三个消费面的同一投影都必须被观察。 |
| Replay 或真实验收路径 | 保留当前 App 数据，在 NodeSeek 自然掉线时于账号中心刷新；确认 More 未登录/失效、NodeSeek 搜索使用 Google 且灯非绿色、Topic 写入口关闭。另三站只读核对状态不变；不得清 App 数据、主动退出、撤销授权或用写操作制造场景。 |
| 负向验证方式 | 恢复公开资料/Topic/Cookie 兜底、把业务文案或畸形 200 当登录、漏掉各站精确匿名契约、让残留 self/Cookie 覆盖明确游客、跨文档接受旧 probe、用全局 previous data 保留旧身份、移除精确 reset/seed 或把 reset 扩到全部来源时，对应编号测试分别失败。 |
| 明确不覆盖范围 | 不统一三站验证器，不增加第二套 session store，不后台自动刷新，不绕过 CF，也不人为撤销真实登录或授权。 |

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
| Replay 或真实验收路径 | 保留 App 数据，由用户在 App 内妖火页面手动登录并点击“检测登录”；确认 More 显示真实账号，强制结束并重启后仍显示同一账号。只读核对妖火搜索与 Topic 写入口的权限投影一致，另外两站账号状态不变；不得由 Agent 输入密码、输出 Cookie 或执行真实站内写入。 |
| 负向验证方式 | 恢复任一显式 Cookie header、让原生响应写回 CookieManager，或用持久化候选替代准确 URL 实时读取；编号测试会暴露双重传输链、原站会话被改写或旧 Cookie 回退。 |
| 明确不覆盖范围 | 不靠 `sidyaohuo` 存在推断登录，不统一三站验证器，不引入新 session store，不自动登录、退出或执行真实回复/收藏/投票。 |

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
| 必须保持的行为 | NodeSeek 专项清理只处理 `session`、`connect.sid`、`sid`，同时过期当前 host-only 与 `Domain=nodeseek.com; Path=/` 版本；`Domain=.nodeseek.com` 不作为另一种身份重复提交。等待所有 callback 和 `flush` 后从 `www` 与 apex 回读，目标名称仍存在即失败；`cf_clearance`、`pjwt`、其他业务 Cookie 和另外两站账号状态保持不变。NodeSeek 与妖火的 credential attempt 只关联 probe/fill 回执，通过已挂载 WebView ref 注入；只有 renderer 已退出后的显式恢复 key 才能 remount。 |
| 精确失败 oracle | `tests/tooling/release-packaging.test.ts` 与生成原生测试要求 host-only 与显式 parent Domain 的目标身份完整，callback 全部成功但回读仍有登录 Cookie 时必须失败；`src/platform/network/managedCookies.test.ts` 固定 JS 只暴露显式 clear port；`tests/ui/account/account-site-panels.test.tsx` 改变 NodeSeek/妖火 attempt，要求 mount 次数保持 1 且当前 ref 收到新 attempt probe。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：Cookie header 与删除回验用 Vitest，React key 对原生 WebView 生命周期的影响用 RNTL mount oracle；源码字符串不能替代。 |
| Replay 或真实验收路径 | 仅在用户授权后清除 NodeSeek 登录 Cookie，确认 `cf_clearance` 与其他三站状态不变；用户在 App 内手动提交账号并完成自然出现的 CF，随后确认原 WebView 不反复重建、原站首页显示登录身份，并用“检测登录”同步 More/Search/Topic。tracked `nodeseek-session.ad` 只核对账号 terminal 与恢复入口，不制造掉线或自动输入凭据；真实 WebView 与登录链路需单独报告 `LIVE_PASS` 或 `NOT_VERIFIED`。 |
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
| 精确失败 oracle | `src/domain/session/siteSessionState.test.ts` 的 `REG-ACCOUNT-023` 对三站先建立带 current user 的可信登录，再发送不带 `loggedIn` 的凭据观察，要求身份和确认时间不变；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 直接执行 NodeSeek/妖火普通 credential load 与 linux.do 隐藏 WebView Cookie 刷新，要求诊断 transition 为 `logged-in → logged-in`，且 NodeSeek userId 不被随后清空。修复前六个断言稳定失败。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须同时覆盖 reducer 证据优先级和真实凭据生产者；只测 UI 刷新、Cookie 名称或源码字符串不能替代。 |
| Replay 或真实验收路径 | 保留当前 App 数据；用户在原站自然登录并于 More 检测为已登录后，依次切到 Search、Feed 和一个只读 Topic，再返回 More。普通读取前后目标站必须保持同一登录投影，另外两站账号状态不变；不执行真实写操作。 |
| 负向验证方式 | 让被动 `cookie-loaded` 重新携带 `loggedIn: false`，或让 reducer 把缺失字段当 `false`，四站 reducer、NodeSeek/妖火读取和 linux.do 隐藏读取测试都会重新出现降级。 |
| 明确不覆盖范围 | 不用 Cookie 存在证明登录，不削弱明确登出，不合并三站验证器，不增加第二套 store 或全局状态机，也不自动刷新、绕过 CF 或执行站内写操作。 |

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
| 必须保持的行为 | 生产 endpoint 必须能追溯到官方源码/文档、当前站点实际调用或成熟客户端，测试 mock 不能作为接口存在的证据。NodeSeek 当前页只从 `__config__.user` 或专属 self-account 结构证明登录，不递归接受无关嵌入 profile；准确游客控件证明退出，普通 HTTP 状态 unknown。linux.do Cookie 会话只以 `/session/current.json` 的 current user 证明登录，以 Discourse `SessionController#current` 的匿名 404/显式匿名字段证明退出，401/403 unknown。妖火的已支持 Cookie 只作候选，不要求检测前必须存在 `sidyaohuo`；必须由成熟客户端使用的 `wapindex.aspx?sid=-2` 中 `div.top2` 本人导航及 `touserid` 证明登录，adapter 成功却无 current user 仍为 unknown；准确游客 DOM/登录重定向证明退出，401/403/404 unknown。公开资料只做可选补全，站点昵称替换数字 ID 占位，失败保留已证明的最小 current user、报告 partial，且不得调用登录清理。 |
| 来源证据 | Discourse 官方 [`routes.rb`](https://github.com/discourse/discourse/blob/main/config/routes.rb) 声明 `session/current`；[`SessionController#current`](https://github.com/discourse/discourse/blob/main/app/controllers/session_controller.rb) 在无 current user 时返回 404。妖火成熟 Android 客户端 [`Api.kt`](https://github.com/Townwang/yaohuo/blob/7cda306fb948ea7ba1bedccff0e5c516e4761991/yaohuoApi/src/main/java/com/townwang/yaohuoapi/Api.kt) 使用 `wapindex.aspx?sid=-2` 和 `bbs/userinfo.aspx`，[`LoginModel.kt`](https://github.com/Townwang/yaohuo/blob/7cda306fb948ea7ba1bedccff0e5c516e4761991/app/src/main/java/com/townwang/yaohuo/ui/fragment/login/LoginModel.kt) 从 `div.top2` 的本人链接读取 `touserid`。NodeSeek 当前静态前端 bundle 从 `__config__.user` 读取当前用户，带 ID 的 `getInfo` 只用于公开用户资料。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 用三站真实协议形状固定正向 current identity，拒绝 NodeSeek 无关嵌入 profile，并让 linux.do 官方匿名 404 与非契约 401/403 保持正确分界、妖火资料 503 时仍返回已证明用户；`src/sources/yaohuo/reader.test.ts` 固定妖火 401/403/404 不产生 `loginRequired`；`tests/ui/account/account-controller.test.tsx` 固定任一已支持妖火会话 Cookie 都进入当前账号验证、无 current user 不保存；`src/sources/yaohuo/parser.test.ts` 固定资料昵称替换数字 ID 占位； 固定 `invalid_access` JSON 403 才产生 typed expiry，原始 401/403/404、HTML 403 与其他 JSON 403 均 unknown， 固定 Controller 只信 typed expiry；`tests/ui/account/account-status-controller.test.tsx` 固定妖火资料补全失败仍为 logged-in、只提示单站 partial 且零清理调用。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：adapter 固定接口/响应分类，Controller 固定清理权限和可信身份保留。源码 URL 字符串、测试 mock 成功、Cookie 名称或 App 可启动均不能证明当前登录。 |
| Replay 或真实验收路径 | 保留当前 App 数据，在账号中心只读刷新三站：已登录站必须显示服务端/当前页证明的本人身份，普通失败保留上次可信身份并显示错误；More、Search 灯与 Topic 写权限使用同一按站投影。NodeSeek/妖火登录页若需要用户操作，由用户手动完成；不得清 Cookie、撤销授权或执行真实写入制造状态。 |
| 负向验证方式 | 给任一测试虚构 endpoint 并据此改生产实现、递归接受 NodeSeek 无关 profile、把三站状态码统一成 expiry、用 Cookie/公开资料补登录、用 `sidyaohuo` 名称阻止真实验证、允许无 current user 落盘，或让妖火 profile failure 推翻 current identity；对应编号测试必须分别暴露多余请求、错误 `loginRequired`、漏检、假登录或错误清理。 |
| 明确不覆盖范围 | 不统一三站验证器，不增加全局状态机，不自动登录或退出，不绕过 CF，不读取或输出 Cookie/Token，也不执行真实站内写操作。 |

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
| 明确不覆盖范围 | 不把 App 改成浏览器账号管理器，不同步跨应用 Cookie，不统一三站验证器，不新增全局状态机，不绕过 CF，也不执行真实站内写操作。 |

## `REG-ACCOUNT-027` React Native 请求隐式读写 WebView CookieJar

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 用户症状 | App 读取原站 Cookie 发起请求后，服务端响应的 `Set-Cookie` 又经 React Native 默认 CookieJar 改写 WebView 会话，导致账号状态、原站页面和后续请求相互污染。若为隔离 Cookie 另建 client，还可能绕过代理 fail-closed 与既有连接资源。 |
| 触发条件 | managed/authenticated React Native 请求使用 `credentials: include` 时会沿用 CookieJar；默认双向 `ForwardingCookieHandler` 既从 `CookieManager` 读取，也把响应 Cookie 写回。若把所有请求统一改为 `omit`，又会错误关闭受管请求按 URL 自动读取；public ReadPlan 则本来就要求独立的无 Cookie 最终 transport。 |
| 根因 seam | `src/platform/network/request.ts` 的受管 credentials 边界、`src/sources/readGateway.ts` 的 public `native-no-cookie` 最外层边界与 `plugins/withNetworkProxyModule.js` 生成的共享 OkHttp client 必须共同表达两条不同 lane。 |
| 必须保持的行为 | managed/authenticated lane 经过 `fetchWithTimeout` 时将交给受管 transport 的请求初始化为 `credentials: 'include'`；该 client 安装的 `ReadOnlyWebViewCookieHandler` 允许受管域按 URL 读取，但 `put`/`saveFromResponse` 永远 no-op。public ReadPlan 的最外层 `native-no-cookie` fetcher 在最终 transport 强制 `credentials: 'omit'`，credential loader、Cookie 和 managed WebView fallback 调用为 0。两条 lane 的 method、body、非 Cookie header、AbortSignal 和诊断 fetcher保持原样。WebView 页面内部站点脚本继续自行管理会话。请求仍经过配置的网络 fetcher 与代理 load/apply fail-closed 门禁，并复用原 `ProxySelector`、dispatcher 和 connection pool，不另建绕过代理的 client。 |
| 来源证据 | Android [`CookieManager.getCookie(url)`](https://developer.android.com/reference/android/webkit/CookieManager#getCookie(java.lang.String)) 按具体 URL 返回 Cookie；[`React Native 0.81.5 NetworkingModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt) 在关闭 credentials 时替换为 `CookieJar.NO_COOKIES`；默认 [`ForwardingCookieHandler`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/ForwardingCookieHandler.kt) 同时实现读写；OkHttp [`CookieJar`](https://square.github.io/okhttp/5.x/okhttp/okhttp3/-cookie-jar/) 将请求加载与响应保存分开。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 让调用方传入 `credentials: omit`、body、header 和父 signal，要求 `fetchWithTimeout` 交给其 fetcher 的初始化值覆盖为 `include` 且其余输入保持；`src/sources/readGatewayContract.test.ts` 要求 public ReadPlan 的最终 anonymous transport 仍为 `omit`，且 credential/Cookie/fallback 为 0。生成的 `NetworkProxyRuntimeTest` 把响应 `Set-Cookie` 交给只读 handler，要求零写入；`tests/ui/more/network-proxy-controller.test.tsx` 阻塞 native proxy apply，要求 apply 前零 transport、完成后仍由同一 `networkProxyFetcher` 发出。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生生成/编译：request 单测固定最终参数，Kotlin 行为测试固定响应 no-op 与同 client 资源，代理 controller 固定 apply 顺序；源码字符串不能单独证明 Cookie 不写回。 |
| Replay 或真实验收路径 | 保留 App 数据与原站会话，从 More 确认账号后依次只读进入 Search、Feed、Topic，再返回原站 WebView，原站身份不得改变。真实代理只在用户提供并明确授权配置时验证；否则代理 Live 记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复默认 `ForwardingCookieHandler`、实现非空 `put`、让 managed/authenticated lane 最终变成 `omit`、让 public lane 最终变成 `include` 或调用 credential/fallback，或改为平行 client/global fetch；Kotlin、request、Gateway 或代理组合测试必须分别观察到响应写入、受管 Cookie 自动读取丢失、公开请求携带会话或 apply 前 transport。 |
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
| 必须保持的行为 | WebView CookieJar 仍是三站请求 Cookie 的唯一事实来源。普通 source/action 请求由 `ReadOnlyWebViewCookieHandler` 调用 `CookieManager.getCookie(准确完整 URL)`；不按名称过滤、清洗、重组或缓存，由平台处理 Domain、Path、Secure 和重定向。只允许 HTTPS 且无 userinfo 的 `nodeseek.com`、`linux.do`、`yaohuo.me` 及子域；合法空值按无 Cookie 请求，读取异常明确失败且不得回退历史快照。响应保存为 no-op。RN source/action clients 不设置 `Cookie` header；CSRF、sid、touserid 等非 Cookie 协议字段保留。媒体延续本条“零 JS Cookie header/零快照”的历史保证，但具体授权已由 `REG-TOPIC-029` 取代旧 Expo Video bridge：HTTP(S) 受管媒体携带内部内容来源 marker 与 opaque identity，原生在发网前移除两个内部头；同来源首跳才可实时读 Cookie，跨来源、未受管、无效 marker 或媒体 Cookie 读取异常继续匿名加载，重定向离源后永久降权。RN Networking、Fresco、Expo Image 与 Expo Video 复用项目配置的 managed client。 |
| 来源证据 | Android [`CookieManager.getCookie(url)`](https://developer.android.com/reference/android/webkit/CookieManager#getCookie(java.lang.String)) 提供按 URL 的平台选择；React Native [`NetworkingModule`](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt) 只有在 credentials 开启时才沿用 client CookieJar；OkHttp [`JavaNetCookieJar`](https://square.github.io/okhttp/5.x/okhttp-java-net-cookiejar/okhttp3.java.net.cookie-jar/-java-net-cookie-jar/) 可把单向 `CookieHandler` 接入同一 client。 |
| 精确失败 oracle | 生成的 `NetworkProxyRuntimeTest` 传入带 path/query 的准确 URL 和未知 Cookie 名，要求完整返回；固定 HTTP、userinfo、相似域与非受管域不读取，普通请求的 reader 异常向请求传播，响应不写入，并证明 managed client 与代理共用 selector/dispatcher/pool。同一原生测试另固定媒体 marker 在发网前移除、跨来源/无效 marker/Cookie 读取异常时匿名继续、离源后跳回仍不恢复。`src/platform/network/request.test.ts` 要求最终 `credentials: include`；NodeSeek/linux.do/妖火 source/action 测试要求零手工 Cookie header；`tests/tooling/release-packaging.test.ts`、`tests/tooling/network-proxy-plugin.test.ts` 和 `tests/ui/topic/topic-image-loading.test.tsx` 固定 Expo Image/Video managed client 接线、内部 marker 与 JS 零 Cookie。修复前分别表现为 `credentials: omit`、白名单 header 或独立媒体 client。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生 Release JUnit/Kotlin compile + fresh prebuild；逐调用方源码搜索只作为补充门禁。 |
| Replay 或真实验收路径 | 保留三站现有登录与 App 数据，连续三次 force-stop 冷启动；不进入 More 即观察 Feed/Categories direct 请求，再只读进入 Search、Topic、More 与三站原站 WebView，确认身份一致且原站 Cookie 未被响应改写。记录 direct/fallback、状态码和 challenge 分类，不记录 Cookie 值。真实代理仅在用户提供并明确授权配置时验证。 |
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
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`FEED-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 用户症状 | 只要进入登录/验证页，原本有效的 WebView 登录态就被 App 清除或旧快照覆盖；反过来，用户在页面内退出或切换账号后直接关闭，账号中心、私有缓存和写入口仍继续信任旧账号，直到手动点击检测。 |
| 触发条件 | 打开 NodeSeek、linux.do、妖火或 NodeImage surface；通过关闭按钮、系统返回、离开 More、切换登录站点、NodeImage 取消/成功退出；linux.do 因 App inactive 暂时卸载 WebView；或旧 probe 在新 surface generation 之后迟到。 |
| 根因 seam | 登录 surface 生命周期、Account identity、WebView Cookie 所有权、Query cache scope 与写权限分别维护；打开页面被误当成登出事务，关闭页面又没有强制 identity reconciliation。 |
| 必须保持的行为 | 打开 surface 只建立含 source/surface/generation/打开时 identity 与 epoch 的 ticket，暂停该站新私有请求和写入，不清 Cookie、不改 identity、不删除可信缓存。只有 surface 确实可见时关闭才异步对账；UI 立即消失，不等待网络。重复关闭 no-op，linux.do inactive 不是关闭，权威检测后的自动关闭不重复 probe。NodeSeek、linux.do、妖火分别使用严格三态 verifier；unknown 保留旧可信账号和已加载内容只读并维持 barrier。A→A 仅解除 barrier；A→B、A→anonymous、anonymous→B 原子提交 Account Query、递增目标站 epoch，并清理该站及 `all` 私有 Query、Level/AI、Topic 服务端内容和媒体身份缓存；其他站不变。旧 probe 只能提交给自己的 generation。 |
| 来源证据 | Android [`CookieManager`](https://developer.android.com/reference/android/webkit/CookieManager) 明确 `getCookie(url)` 是按 URL 读取，而 `flush()` 是阻塞持久化操作；[RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265) 规定 user agent 负责 Domain、Path、Secure 与 Cookie 顺序。TanStack Query 官方 [Query Keys](https://tanstack.com/query/v5/docs/framework/react/guides/query-keys) 与 [Query Cancellation](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation) 要求响应依赖进入 key，取消由 queryFn 消费 `AbortSignal`。 |
| 精确失败 oracle | `src/domain/session/authSurfaceCoordinator.test.ts` 固定所有关闭原因、hidden/no-op、switch-surface、inactive 与 generation；`src/platform/network/managedCookies.test.ts` 固定 exact URL、空值/错误分离、只读与显式清除端口；`src/sources/nodeseek/session.test.ts`、`src/sources/linuxdo/session.test.ts`、`src/sources/yaohuo/session.test.ts` 固定三态证据，`src/platform/network/loginWebViewScripts.test.ts` 额外固定 login 路径的错误/半加载页仍为 unknown；`tests/ui/account/account-status-controller.test.tsx` 固定 A→A/A→B/A→anonymous/unknown、single-flight 与迟到 probe；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/integration/query-session-contracts.test.ts` 固定原子 seed、source/`all` 清理和 epoch key；Feed UI 固定其他来源完成刷新后仍合并同 epoch dirty 来源的旧可信条目、换 epoch 后停止合并；User UI 固定 route 只保留定位字段且不回显旧头像/简介/等级/活动；Search/Topic/Account UI 固定 barrier 下只读保留、其他来源继续与 epoch 后不复用旧服务端数据；`src/platform/media/mediaSessionEpoch.test.ts` 及媒体 UI 测试固定 cacheKey/player 随 epoch 重建。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS` + 原生 Release JUnit/Kotlin compile；reducer、Query transaction、surface RNTL 与生成原生边界必须组合覆盖。 |
| Replay 或真实验收路径 | 覆盖安装同 revision release APK 且不清 App 数据；在已登录 NodeSeek、linux.do、妖火分别验证打开不退出，关闭按钮、系统返回、离开 More 和切站均自动 A→A 对账。NodeImage 只验证取消和已有 Key 恢复。A→B、真实退出和清除 Cookie 需用户另行授权，未执行时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一 surface open 分支调用 clear/flush/写 Cookie，关闭时省略 reconciliation，把 unknown 提交成 anonymous，让 hidden close 重复 probe，或让旧 generation 覆盖新 Account key；编号测试必须分别观察到清理调用、错误身份、重复请求或跨 epoch 缓存。 |
| 明确不覆盖范围 | 不把账号密码自动填入当作 Cookie，不跨应用同步 Cookie，不自动退出/换号，也不执行真实论坛写入。 |

## `REG-ACCOUNT-032` 妖火已登录会话在身份核对时打开登录页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 账号中心仍显示妖火用户名和已登录状态，点入后却先打开登录页；点击“检测登录状态”后页面立即恢复为“我的地盘”。 |
| 触发条件 | 已确认的妖火账号打开登录 surface；auth-surface barrier 临时关闭写权限，但 canonical identity 仍为 confirmed。 |
| 根因 seam | `src/features/account/components/YaohuoLoginHost.tsx` 用 `canWrite` 选择登录页或会话页，把“身份核对期间禁止写入”误当成“已经退出”。 |
| 必须保持的行为 | surface 打开期间继续显示上次确认身份并打开妖火会话页，但写操作和新私有请求由 auth-surface barrier 暂停；明确 anonymous/expired 才打开登录页，用户选择账号密码填入时仍进入登录表单。 |
| 精确失败 oracle | `tests/ui/account/account-site-panels.test.tsx` 的 `REG-ACCOUNT-032` 构造 `isLoggedIn=true`、`canWrite=false`、`identityTrust=confirmed` 的开放 surface，要求首个 URL 为 `/wapindex.aspx?sid=-2`；旧实现得到 `/waplogin.aspx`。 |
| 最低可靠自动测试层 | `UI_PASS`：需要渲染真实 panel 并读取 WebView source，纯 view-model 测试不能证明页面选址。 |
| Replay 或真实验收路径 | 保留自然妖火登录态，从账号中心点入妖火；首屏应直接进入会话页，点击检测仍保持同一账号。不得为了验收清 Cookie。 |
| 负向验证方式 | 恢复用 `canWrite` 选择 URL，编号测试会在 barrier 打开时重新收到登录页 URL。 |
| 明确不覆盖范围 | 不放开 barrier 期间写权限，不把旧身份当作关闭后的远端核对结果，也不改变明确退出后的登录页。 |

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
| 根因 seam | 稳定 Account snapshot、auth surface registry 和恢复回调的提交顺序；若身份再镜像到 React ref/workflow，probe Promise 与请求时刻读取会观察不同 owner。UI 可见性被误当作事后清理而不是恢复前屏障。 |
| 必须保持的行为 | `SessionRuntimeSnapshot` 只是从稳定 Account snapshot、当前 epoch、来源启用和 auth surface 即时组合的请求视图，不保存身份。probe 开始及 canonical same/changed/anonymous commit 必须先原子替换 snapshot，再完成 Promise；verification workflow 只在 pending 时拥有可见状态，不复制账号事实。NodeSeek、linux.do 都必须先关闭并卸载面板，再恢复原 Query；关闭到 renderer 真正卸载之间继续保持短暂 recovery barrier。changed 只导航到新内容 epoch，不重放旧身份请求；unknown/stale 保持原错误与只读状态。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 要求 reconciliation Promise resolve 及内容 epoch 回调执行时稳定 snapshot 已是新 identity 且 `pending=false`，Account Center 与同步门禁从该 snapshot 得出同一结论；`tests/ui/account/account-controller.test.tsx` 返回完整 NodeSeek 对账结果；`src/features/account/useVerificationController.test.ts` 固定 linux.do close-first 恢复、barrier 和 original Query outcome；Feed/Search/Topic/User consumer 测试用新 epoch canary 要求零旧 scope 落地。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯状态 helper 固定恢复结果，RNTL 固定 Account/验证 hook 的 Promise、卸载和 Query 生命周期。 |
| Replay 或真实验收路径 | 保留现有登录态，自然遇到或手动打开登录/验证页后只执行账号检测与只读请求；确认面板先消失，随后原页面只恢复一次，A→A 不丢内容，换号/退出须另获授权。 |
| 负向验证方式 | 恢复身份 runtime/ref 镜像、让 Promise 先于 snapshot commit resolve，或恢复回调先于 surface close；编号测试必须观察到旧 identity/epoch、重复请求或面板仍挂载。 |
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
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定 NodeSeek 模糊 SSR 必须 direct×1→WebView×1、明确 direct 证据必须 WebView×0，并接受只由 bridge 生成的精确匿名标记；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 固定只传播 `owner` 不泄漏 queue internals；`tests/integration/hidden-browser-scripts.test.ts` 固定 Account 在帖子列表 ready 后继续等身份证据、精确 `user === null` 立即回传紧凑标记、同 request 重复执行只回传一次、`false/undefined/{}` 不结算；`tests/ui/account/hidden-browser-host.test.tsx` 固定仅 Account early injection，普通读取仍无该 prop，且 `onLoadEnd` fallback 保留。`src/sources/yaohuo/reader.test.ts` 固定公开页→带验证码资源的精确完整 form 为 expired，缺一个字段仍 unknown，已登录本人导航不发第二请求；`src/sources/yaohuo/actionClient.test.ts` 与 `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 固定其他登录消费者复用同一优先级。 |
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
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-006` 建立两页缓存，让多页 refetch 的后续页失败，再触发加载；要求请求序列重试同一页而不是前进。 |
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
| 精确失败 oracle | `src/sources/discourseRead.test.ts` 的 `REG-SOURCE-004` 传入 gateway-owned access，要求 linux.do adapter 精确收到同一对象；`src/sources/readGatewayContract.test.ts` 固定受管调用边界；`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts` 与 `tests/integration/source-read-contracts/` 的聚合/登录搜索、候选和语义搜索全部显式注入 access，并固定匿名请求不携带它。修复前 adapter 调用中该字段为 `undefined`，旧直调测试会因错误走 Google fallback 失败。 |
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
| 必须保持的行为 | 冷启动先恢复本机 ReaderData 与账号终态，随后 Feed/Categories 各发一次 direct request，Account 请求为 0。用户之后手动刷新账号时，NodeSeek 与 linux.do 各自稳定排队，优先级为 `write > foreground > background`，同优先级 FIFO；已开始任务不被后来任务抢占，队中任务不因新任务而拒绝或取消。每个任务只得到自己的结果；两站队列互不影响。 |
| 精确失败 oracle | `tests/ui/app/app-runtime-startup.test.tsx` 固定冷启动 Account=0、Feed=1、Categories=1；`tests/integration/source-read-contracts/` 固定真实 Feed/Categories 为 foreground、手动 Account 为 background；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 让三类请求同时进入同站 fallback，要求全部 resolve，并固定 `write > foreground > background` / 同级 FIFO。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：RNTL 固定启动请求次数，确定性 deferred Promise 固定真实队列顺序与来源调用类别。 |
| Replay 或真实验收路径 | 保留当前登录态，force-stop 后直接冷启动首页，不进入 More；连续五次确认 Feed/Categories 各一次且 Account 为 0。随后在 More 手动刷新账号，前台读取不得被取消。 |
| 负向验证方式 | 恢复 latest-wins、active preemption、队中新任务替换，或把 Account 标成 foreground；编号测试会看到前台任务 rejection、顺序错误或 background 抢占。 |
| 明确不覆盖范围 | 不新增自动 retry、冷却或熔断，不承诺第三方站永远成功；真实站点错误仍按自身请求展示，但不得由 App 调度制造取消。 |

## `REG-SOURCE-006` fallback 排队时间耗尽请求超时并跨任务取消

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 请求尚在等待隐藏 WebView 执行权就达到 15 秒超时；用户只取消一个页面请求，却连带使同站其他 fallback 失败或释放错误任务。 |
| 触发条件 | fallback 执行 timeout 在 enqueue 前启动，外层 direct request timeout 在 transport 已正式移交后仍继续计时，或调度器共用一个 Abort/取消所有任务。 |
| 根因 seam | `src/platform/network/request.ts` 的 timeout 所有权、`nodeseekFetchFallback` / `linuxdoFetchFallback` 的 handoff，以及隐藏 WebView 队列的 per-task Abort/执行时钟。 |
| 必须保持的行为 | 排队等待不消耗隐藏 WebView 的执行 timeout，任务出队获得执行权后才启动 15 秒；正式进入 fallback 时只停止该请求的外层 direct timeout。用户 AbortSignal 只取消自己的排队或执行任务，不影响队中/运行中的其他任务。direct request 默认只执行一次，符合既有明确条件时只进入一次 fallback；`REG-LINUXDO-008` 的 8 秒 watchdog 也只移交一次 WebView，不先轮换或重试 native transport。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 的 `REG-SOURCE-006` 固定 fallback handoff 只取消当前 outer timer；`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 用虚拟时间让第三个任务在前两项各执行 10 秒后排队超过 15 秒，仍从真正出队时获得完整 15 秒预算，并通过独立 `AbortSignal` 分别取消队中与执行中任务，要求其他 Promise 正常结算；`tests/integration/source-read-contracts/` 固定普通来源 direct 一次、fallback 一次，并单独固定 linux.do WebView 成功前零轮换、成功后一次轮换。 |
| 最低可靠自动测试层 | `UNIT_PASS`：需要虚拟时钟、独立 signals 与真实队列 Promise；只看最终错误文案不能区分排队耗时和执行超时。 |
| Replay 或真实验收路径 | 只在自然出现多个 fallback 时记录 enqueue/start/settle 脱敏诊断，确认较晚任务的执行预算从 start 计算；不为制造队列反复触发 Cloudflare。 |
| 负向验证方式 | 把执行 timer 移回 enqueue、保留 outer timer、共用 controller 或取消整队；编号测试会看到未开始任务超时或无关 Promise 被 reject。 |
| 明确不覆盖范围 | 不延长单个已执行 WebView 的 15 秒预算，不自动重试超时，不隐藏真实用户取消，也不改变 TanStack 相同 Query key 的去重。 |

## `REG-SOURCE-007` 身份核对中的四站被误报暂不可用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | App 偶发进入时三个可登录站点同时显示“暂不可用”，但 V2EX 等公开列表已经正常刷出；数秒后三个错误又自行消失。 |
| 触发条件 | 没有本机终态的来源进入 unknown，或用户手动核对来源时，聚合 Feed、Categories 或 Search 同时读取。 |
| 根因 seam | `ReadGateway` 曾把账号核对 activity 当成来源不可用；聚合 adapter 跳过请求后又生成与真实凭据故障相同的来源错误。 |
| 必须保持的行为 | 核对 activity 不改变 confirmed 身份；真正 unknown 只阻止该来源的 strict/private 请求，且 typed blocked 不显示为普通来源故障。公开 Feed/Categories/Search 按 `REG-SOURCE-011` 使用 public lane，旧 authenticated 条目、错误和 cursor 不得混入 public scope；妖火等严格远程读取保持零 transport并提供可恢复账号动作。 |
| 精确失败 oracle | `src/domain/forum/readPlan.test.ts` 与 `src/sources/readGatewayContract.test.ts` 让 NodeSeek 没有确认身份，要求 Feed/Categories/Search 仍使用显式 public child plan、`credentials: omit` 且 credential/Cookie/managed fallback 为 0；authenticated 陈旧项和错误不得投影到 public scope。对妖火执行同一操作必须得到 typed blocked、transport 为 0 且不冒充普通来源错误。`tests/integration/session-presentation-contracts.test.ts` 另固定 confirmed 身份检查中仍可用。 |
| 最低可靠自动测试层 | `UNIT_PASS`：共享 ReadPlan/Gateway 边界可确定性证明公开 transport、严格阻止、scope 过滤与错误投影同时成立。 |
| Replay 或真实验收路径 | 保留当前登录态，连续冷启动到“全部”，不得出现启动账号核对或“账号未知/暂停”。随后在 More 手动刷新并进入聚合搜索，confirmed 来源继续可用；不得清数据制造状态。 |
| 负向验证方式 | 恢复 source-wide `unavailableSources`、让 public lane 带 Cookie、把 strict blocked 投影成 ordinary error，或允许 authenticated 陈旧项进入 public scope；`REG-SOURCE-007/011` 相关测试必须出现暂停、凭据调用、错误提示或缓存泄漏。 |
| 明确不覆盖范围 | 不隐藏真实网络、解析、凭据存储或站点错误，不自动重试第三方站点，也不允许没有确认身份的来源读取私有数据。 |

## `REG-TOPIC-024` linux.do 回复页复用模块全局旧 stream

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | linux.do 主题的回复 stream 已在服务端变化后，后续分页仍按旧 post id 列表读取，可能缺少新回复或请求已不存在的楼层。 |
| 触发条件 | 同一 topic 在模块级缓存有效期内再次读取回复页，而服务端 `post_stream.stream` 已更新。 |
| 根因 seam | `src/sources/linuxdo/reader.ts` 的 `topicStreamCache` 成为 TanStack Query 之外、未按会话和请求生命周期约束的第二份服务端状态所有者。 |
| 必须保持的行为 | 每次回复页读取都从当前 topic stream 推导目标 post ids；TanStack Query 是唯一跨请求缓存所有者。取消、错误和会话边界仍由当前 Query 管理，不新增 adapter 全局缓存。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-024` 让同一 topic 的后续读取返回更新后的 stream，要求第二次 `/posts.json` 使用当前 ids；旧缓存实现稳定继续请求旧 ids。 |
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
| 用户症状 | linux.do 的关闭/重开事件被显示成空白普通楼层，带等级、楼层号和点赞等操作；主题正文后缺少原站的已采纳答案区，采纳回复本体也只有作者栏“已采纳”小标签，没有明确的解决状态。 |
| 触发条件 | 采纳回复和 `post_type != 1` 的系统帖子都直接进入共享 `ReplyItem` 普通回复模板，`actionCode` 没有可见语义分支。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx` 的主题正文尾部、`src/features/topic/components/ReplyItem.tsx` 的共享 Discourse 回复模板，以及 `src/features/topic/useTopicController.ts` 的精确楼层 Query。 |
| 必须保持的行为 | 主题正文后显示可折叠的“已解决”答案预览，包含采纳者、时间、楼层和答案片段，并可定位到下方完整回复；采纳楼层尚未进入当前分页时按精确楼层静默补取，可在预览内展开全文但不伪装进当前分页，也不产生引用展开状态、提示或验证弹层；受限主题不得补取。筛选或查找隐藏采纳回复时定位操作先恢复“全部”与空查询再滚动。采纳回复保留正文、楼层和合法操作，并显示顶部“已解决”及底部“解决方案”；系统帖子只显示 actor、时间和可读事件，`closed.enabled`/`closed.disabled` 分别显示关闭/重开，未知动作优先使用不含原始 action code 的可见正文、否则显示“更新了主题”，不显示普通楼层、等级、正文占位、reaction 或任何写入口。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 固定两站正文内采纳区的顺序、展开/收起、后分页静默精确补取及包含引用摘要和只读投票的就地全文、受限主题零补取、筛选恢复与第 2 楼精确索引；重复答案区的投票不得显示“未登录”或登录/提交入口。`tests/ui/topic/topic-session-controller.test.tsx` 固定后台补取成功或失败都不展开引用、不通知且不自动打开验证页，并固定失败后主动展开同一楼层会精确重试；该楼层已随分页载入时则复用本地对象且不再次请求；`tests/ui/topic/topic-components.test.tsx` 固定采纳回复模板、只读投票、关闭/重开映射、未知动作 fallback、原始 action code 即使嵌在正文中也不泄露、系统事件无障碍标签及写入口缺席；`src/sources/discourse/model.test.ts` 固定采纳回复与空 `cooked` 系统事件是两个独立对象并保留 `actionCode`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 parser 字段契约，`UI_PASS` 固定共享组件和 Query controller 行为。 |
| Replay 或真实验收路径 | 在 linux.do 当前可用的只读主题中核对采纳预览、完整答案与系统动作；没有满足条件的稳定对象时记 `NOT_VERIFIED`，不得以共享测试冒充 `LIVE_PASS`。 |
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
| 触发条件 | write mutation 成功后需要按新增楼层、编辑楼层或排除已删除楼层刷新特定回复页；当前 route 可能处于正序或倒序。 |
| 根因 seam | 请求改为 TanStack Query 唯一所有者时，旧 controller 的 targeted refresh seam 被删除，但 mutation success 没有等价的 Query-native 提交；顺序拆为独立 Query lane 后，写后刷新还必须保留真实服务端窗口语义。 |
| 必须保持的行为 | 服务器确认后在当前 `ReplyOrder` 的 Query key 中读取并原子合并/替换真实窗口；编辑/删除按实体所在 `pageParam`。新增回复先以 `order=newest, position=start` 由 adapter 确认服务端尾窗；当前为正序时，再以该尾窗返回的真实 `commentId/floor/pageHint` 读取正序目标窗，不按回复数猜 Discourse post number。成功后失效另一顺序 cache，保留仍连续的无关已加载页和 cursor。跟进刷新失败只报告 partial，不应用未确认窗口、不回滚已确认写入或重发非幂等请求。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-WRITE-017` 预置已加载回复页，提交后先返回 post number 有缺口的真实尾窗，再要求正序只以该实体定位；目标回复和总数更新且不能出现 `replyCount + 1` 猜测。`REG-TOPIC-067` 另固定倒序提交后以 `order=newest, position=start` 重新确认尾窗并失效相反顺序 cache。`tests/ui/topic/topic-actions-controller.test.tsx` 的 `REG-LINUXDO-003` 固定写已确认但跟进刷新失败为 partial。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖 mutation success、临时 Query、InfiniteData 合并和可见 controller 状态。 |
| Replay 或真实验收路径 | 默认只检查写入口，不提交真实内容；获得逐次写授权后记录原状态，提交一次并核对目标楼层、分页与 partial 提示，按可逆性清理。 |
| 负向验证方式 | 移除 `afterSuccess` 的 Query 定向刷新、按 `replyCount + 1` 猜 Discourse 尾楼、倒序写后继续猜尾页、复用另一顺序 cache，或改为无条件覆盖全部 pages，编号测试会缺少权威回复、显示旧顺序或丢失既有页。 |
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
| 用户症状 | 写 transport 明确返回 HTTP 401，用户只看到一次错误，但 Topic、Search 与通知仍按旧账号开放；或 adapter/fallback 吞掉 status 后又补发账号请求，造成限流和竞态。 |
| 触发条件 | 401 在站点 adapter 内才分类，真实 adapter 可能先 parse、redirect 或转换成无 status error；controller 再以 typed hint 猜测是否对账。 |
| 根因 seam | 原始 `Response` 与 adapter 之间缺少统一 401 边界，身份失效被分散到每站 client 和消费者。 |
| 必须保持的行为 | `rejectUnauthorizedResponse` 必须在 adapter 解析/fallback 前拦截原始 HTTP 401。ticket 仍属于当前 confirmed identity/epoch 时，第一次 401 直接通知唯一 Account owner，把 App 本地账号事实失效并推进该站 epoch；并发重复或旧 epoch 401 为 no-op。零 Account probe、零请求重放、零 WebView Cookie 清理。typed `login-required/login-expired/verification-required` hint、普通错误、权限失败和 stale ticket 不改变身份。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 固定 adapter 零调用；`tests/ui/topic/topic-actions-controller.test.tsx` 固定写 401 单次失效、非幂等 transport 一次且零 Account probe；Account controller/runtime tests 固定并发/旧 epoch 幂等与本地退出不清 Cookie。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：raw response wrapper、ticket/current epoch 与 action mutation 必须组合覆盖；只 mock `{status:401}` 给 controller 不能证明生产 adapter 前终止。 |
| Replay 或真实验收路径 | 默认不通过真实写操作制造过期。设备自然出现失效时，只读核对 More、Search 与 Topic 已同步关闭目标站写能力且原站 Cookie仍保留；妖火自然验证态只显示验证要求。否则动态证据记 `NOT_VERIFIED`。 |
| 负向验证方式 | 把 401 检查移到 adapter 后、用 typed hint 触发失效、跳过 ticket/epoch 校验、补发账号请求或清 Cookie；编号测试必须失败。 |
| 明确不覆盖范围 | 不把单主题权限失败升级为全局退出，不自动重试写操作，不清 Cookie，不执行真实回复/收藏/投票，也不新增统一 verifier 或第二套状态机。 |

## `REG-WRITE-023` 旧主题或账号在身份待确认、换号后继续写入

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-01`、`TOPIC-03` |
| 用户症状 | 用户从账号 A 打开旧 Topic 后在 WebView 切到账号 B、退出或身份无法确认，App 仍可能先显示 optimistic 成功、打开文件选择器或发送 A 页面上下文下的回复、编辑、删除、互动、投票、上传和签到；服务器已确认的操作还可能在写后刷新期间换号，随后对新账号弹出旧账号的成功提示。 |
| 触发条件 | 写入开始时登录 surface barrier 开放或身份 unknown；`ensureWritableSession` 返回后、Query cancellation、文件选择或 `afterSuccess` 刷新等待期间 epoch 变化；NodeImage Key 属于另一 NodeSeek identity；transport 返回 raw 401。 |
| 根因 seam | 各 action 自行读取 Cookie/SecureStore 判断登录，身份检查与 optimistic snapshot、文件选择、上传、transport 及成功结算之间没有一次性 identity/epoch 所有权；恢复逻辑把写请求当成可自动重试读取。 |
| 必须保持的行为 | 所有回复、编辑、删除、互动、投票、三站上传与 NodeSeek 签到统一先调用 `ensureWritableSession(source)`。已确认且无 surface barrier 的会话不增加网络请求；只有 identity unknown 才在执行前定向核对，surface barrier 直接阻止。同一 identity 可继续当前操作一次；换号、退出、unknown 或 ticket 过期都终止。门禁位于 Query snapshot、optimistic update、文件选择、上传和 transport 之前，所有 await 后复核。raw 401 按 `REG-WRITE-022` 失效但不重放；其余失败不对账。服务器确认后 ticket 失效只结算 `stale + serverConfirmed`，不提示成功、不写新 epoch、不回滚或重发。NodeImage Key 继续绑定当前 NodeSeek identity；Key 缺失/归属不符在 picker 前只提示，上传失败保持草稿且零重放。 |
| 来源证据 | OWASP [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) 建议集中授权并默认拒绝；[Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) 要求授权与具体操作绑定并在执行前校验。TanStack Query [Optimistic Updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) 把 cancel、snapshot 与 optimistic apply 的顺序视为 mutation 正确性边界。 |
| 精确失败 oracle | `src/domain/session/writableSessionGate.test.ts` 固定 confirmed fast-path、unknown 定向核对、surface barrier、same/changed/anonymous 与 ticket validation；`tests/ui/topic/topic-actions-controller.test.tsx` 固定 unknown/barrier 在 optimistic/picker/upload/transport 前阻断、等待期间换代仍为零本地修改/transport、raw 401 不重放；NodeImage Key 缺失要求零 picker/上传。四站与签到的 confirmed 结果在应用前或 `afterSuccess` 期间换代，要求零成功提示、新 epoch canary 不变且唯一 finish 为 `stale + serverConfirmed`。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯 gate 单测不足以证明门禁位于 optimistic、picker 和 transport 之前，必须执行真实 controller mutation 时序。 |
| Replay 或真实验收路径 | 默认只检查入口在登录 surface barrier/unknown 时关闭、旧内容保持只读及重试提示；真实写入需逐项授权。自然出现 401 时只读核对 More/Search/Topic 投影一致且没有第二次 transport。 |
| 负向验证方式 | 把 ticket 校验移到 optimistic/picker/transport 之后，删除 await 后复核，让 action 自己拼 Cookie，或在 401 后自动重放；编号测试必须观察到本地状态变化、额外 transport 或错误成功提示。 |
| 明确不覆盖范围 | 不保证账号 B 对旧主题拥有相同权限，不自动转换草稿归属，不执行真实写操作制造状态，也不把普通单主题权限不足升级为全局退出。 |

## `REG-WRITE-024` 普通写失败误触发身份 barrier

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`SEARCH-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-03` |
| 用户症状 | NodeSeek、妖火或 linux.do 的普通网络错误、服务端异常或对象权限不足被当成登录失效；一次局部写失败会让目标站进入长期 identity barrier，Topic、Search 和其他私有入口一起关闭。 |
| 触发条件 | action wrapper 对异常或站点 typed hint 调用账号核对，或把普通 403/429/CF/权限错误升级为身份失效。 |
| 根因 seam | adapter 级错误分类被错误赋予账号生命周期权限；没有把 raw HTTP status 与业务错误分开。 |
| 必须保持的行为 | 除当前 ticket 的原始 HTTP 401 外，403、429、Cloudflare、typed `login-required/login-expired/verification-required` hint、ordinary 和 permission 都只回滚本次 optimistic state、提示一次并结束；零 Account probe、零 epoch/Cookie 变化、零自动重放。linux.do 既有业务 recovery 只能结算本次操作，不能自动打开登录面板。 |
| 精确失败 oracle | `tests/ui/topic/topic-actions-controller.test.tsx` 对 NodeSeek、妖火、linux.do 分别注入 403/429/CF/typed hint/ordinary/permission，要求 Account probe/expiry 调用为零、transport 一次、提示一次；raw 401 正例只失效一次。删除/上传/签到复用相同矩阵。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 mutation rollback、raw wrapper、Account owner spy 和提示共同证明不会建立 barrier。 |
| Replay 或真实验收路径 | 默认不制造真实写失败；自然出现普通失败时只核对该动作收口且其他入口不进入 barrier。 |
| 负向验证方式 | 恢复任一 typed hint/403/429/CF 的对账或自动重放，编号测试必须失败。 |
| 明确不覆盖范围 | 若站点未来不用 HTTP 401 表达会话失效，先建立可验证协议证据再另立改造，不在本条猜测。 |

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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-002` 要求普通与未登录 Replay 各只提交一次聚合搜索、只等待 `search-all-sources-settled`，并禁止 `search-result-first`、`search-outcome-*` 和动态详情链；`tests/ui/search/search-screen.test.tsx` 固定 catalog 不完整、Loading 与来源请求未结算时不结算，并由 `REG-SEARCH-016` 固定自动化状态不污染布局。 |
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
| 必须保持的行为 | App 内没有匿名测试入口、override state、runtime mode、Account 特殊终态或 Native Cookie mask；Debug/Release 都只运行正常 session 逻辑。真实未登录使用同一 APK 和独立 AVD，三站 Account Query 必须给出权威未登录事实；NodeSeek 可显示“未登录”或仅访客“已验证”，linux.do 的 UI 文案为“匿名可用”。允许访客 Cloudflare Cookie 自然存在，但不得登录论坛或复制主设备数据。主设备登录态与 Cookie 不变。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx`、`tests/tooling/release-packaging.test.ts` 和 `tests/tooling/android-smoke-guard.test.ts` 固定无 App/Native 模拟入口；`tests/tooling/android-smoke-guard.test.ts` 还固定独立 runner、目录与设备变量，`logged-out-readonly.ad` 固定三站在 relaunch 前后均为权威未登录状态，以及一次聚合 Search 的 catalog-complete 结算和 Feed 的逐来源 outcome，并按 `REG-TEST-004` 区分 NodeSeek 账号身份与访客验证。 |
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
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 要求 `logged-out-readonly.ad` 在首次启动与 relaunch 后都使用同一个两分支 selector；旧单文案脚本使该守卫先失败。真实 AVD 上该 selector 已对“NodeSeek，已验证，已选择”命中，同时账号中心显示“网站登录 0/3”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 tracked Replay 的身份语义；`DEVICE_REPLAY_PASS` 证明真实 Android Account Query、访客 Cookie 与未登录搜索流程一致，不证明 Google 当天返回数据。 |
| Replay 或真实验收路径 | 保留隔离 AVD 的访客 Cookie，不登录 NodeSeek、不清数据，执行 `npm run test:device:logged-out`；NodeSeek 身份断言通过后提交一次聚合搜索并等待 catalog-complete 结算，relaunch 后重复同一身份断言。 |
| 负向验证方式 | 把 selector 改回只接受“未登录”，有 clearance 的隔离 AVD 必须复现失败；把“已登录”加入允许分支或让搜索走登录协议，守卫或后续 Google 提示断言必须失败。 |
| 明确不覆盖范围 | 不把“已验证”改名为“未登录”，不删除访客 clearance，不放宽账号 parser，也不新增产品运行模式。 |

## `REG-TEST-005` 动态 linux.do 等级被误作固定 Replay oracle

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`、`RELEASE-02`；共享 `MORE-01`、`MORE-02`、`MORE-03`、`MORE-04` |
| 用户症状 | 旧 `more-readonly` 或 `account-readonly` 在linux.do 等级读取处等待后失败，代理、诊断、备份、外观或整次 Release 随无关的第三方波动失去证据；等待原站冷却后从同一入口再次读取又能成功。 |
| 触发条件 | 固定 Replay 点击“查看等级”并发起真实 User API 请求；第三方动态端点的波动被错误纳入确定性发布门禁。 |
| 根因 seam | Device Replay 把“入口与错误状态是否正确投影”和“第三方身份、等级端点此刻是否可用”压成一个发布 pass/fail；固定 RNTL 已能确定性证明 transport、结算和恢复语义。 |
| 必须保持的行为 | `account-readonly.ad` 只确认 linux.do “查看等级”入口，不发起等级 transport；`more-readonly.ad` 独立覆盖代理、诊断、备份和外观。RNTL 固定错误可见、显式恢复和零自动重试。Agent Live 将应用流程和真实数据可得性分开报告；只有服务端明确给出可执行冷却时间时，才等待窗口结束再显式刷新一次。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 禁止 `account-readonly.ad` 点击“查看等级”、等待动态等级 marker 或加入 sleep/retry；Account/More RNTL 固定首次错误零自动重试，显式复试后总调用数为 2，并区分空态、错误与数据态。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 tracked Replay 的确定性边界，`UI_PASS` 固定标记只属于结果态、用户可见失败与显式恢复；Agent Live 分别报告应用流程和真实数据可得性。 |
| Replay 或真实验收路径 | 在身份匹配的设备运行 `npm run test:device`：`account-readonly.ad` 只验证账号 terminal 与等级入口；再执行 `LIVE-ACCOUNT-04`，点击、结算和动态数据分轴报告。 |
| 负向验证方式 | 在 `account-readonly.ad` 点击“查看等级”、等待结算 marker/成功数据、增加固定 sleep 或把 runner retries 改为非零，协议守卫必须失败；移除 RNTL 的结算 marker、用户可见错误或显式复试行为，同样必须失败。 |
| 明确不覆盖范围 | 不断言所有历史超时都是 HTTP 429，不修改产品请求去重、timeout、User API 调用顺序或自动重试策略；这些产品优化需要单独诊断证据和授权。 |

## `REG-TEST-006` 动态来源成功被错误作为唯一 Replay 终态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`RELEASE-02`；共享 `NAV-02`、`NAV-03` |
| 用户症状 | App 已正确显示空态、限流、验证、来源错误或空 Library，Replay 仍因没有动态首条、详情、用户主题、非空本机数据或第三方 DOM 而失败；同一路径稍后重跑又可能通过。 |
| 触发条件 | 固定 Replay 把第三方“此刻成功且有数据”当作唯一终态，并串联要求随机首条 Topic 的作者仍有主题、设备必须预存 Library 对象或 NodeSeek DOM 保持固定。 |
| 根因 seam | Device Replay 同时承担 App 流程、第三方数据可得性和动态对象前置条件，没有复用 controller/UI 的结果模型；稳定入口与实时内容被压成一个布尔值。 |
| 必须保持的行为 | Feed 和 Search 只在当前请求已结算时暴露 `data/empty/partial/error/auth`；Loading、未提交和旧请求无终态。固定 fixture/UI 严格覆盖每个分支、恢复和导航；Replay 证明 outcome、App-owned 恢复与返回，不读取动态标题、success-only 详情、可变 Library 非空或第三方 DOM。Agent Live 按来源分别证明当前数据可得，正确错误流程不能冒充数据成功。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-006` 先在旧脚本上因 `feed-topic-first`、`search-result-first`、`topic-detail-loaded`、`user-screen-loaded` 和第三方 DOM 失败，再固定七个当前脚本禁止这些无条件 oracle并要求动态 outcome；Feed/Search、Navigation、Library、NodeSeek 与通知 RNTL 分别固定合法分支、永久 Loading 失败与固定返回栈。 |
| 最低可靠自动测试层 | `UNIT_PASS` / `UI_PASS` 固定结果与导航语义，`DEVICE_REPLAY_PASS` 证明 Android App 流程，`LIVE_PASS` 或 `BLOCKED_BY_ENV` 单独描述第三方数据；三层不能互相替代。 |
| Replay 或真实验收路径 | 在身份匹配的 APK 上运行七条普通 Replay 和独立未登录 Replay；随后按 `tests/live/agent-live.md` 的唯一 probe owner 只请求受影响来源一次，分别报告 flow、data 和 infrastructure。 |
| 负向验证方式 | 在 tracked Replay 恢复任一动态首条/详情/User/非空 Library/第三方 DOM 成功条件，移除 outcome，或让 Loading 暴露终态，Android guard 或对应 UI 测试必须失败。 |
| 明确不覆盖范围 | 不降低固定数据断言，不把任意错误都算通过，也不增加 retry、固定 sleep、MockWebServer、录制系统或 fixture DSL。 |

## `REG-TEST-007` 所有旅程经聚合 Feed 启动并制造无关失败与请求突发

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-04`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04`、`RELEASE-02` |
| 用户症状 | Search、Library、账号、NodeSeek WebView 或本地 More 旅程尚未到目标入口，就因聚合 Feed 动态失败而停止；重复 relaunch 又在短时间触发多次无关来源和账号请求。 |
| 触发条件 | 每个 `.ad` 冷启动后统一等待 `feed-list-ready-all`，并把动态等级与多个本地 More 旅程放在同一 fail-fast 文件；普通套件累计八次 relaunch。 |
| 根因 seam | Replay 以一个网络首页作为所有能力的全局 setup，而不是从目标主 tab 建立最小前置；独立失败域和 probe 所有权没有体现在脚本拓扑中。 |
| 必须保持的行为 | 普通套件固定 `account-readonly.ad`、`four-source-feed.ad`、`library-return.ad`、`more-readonly.ad`、`nodeseek-session.ad`、`notifications-readonly.ad`、`search-multi-source.ad` 七个文件和七次 relaunch；非 Feed/Smoke 启动后直接等待目标 `main-tab-*`，账号终态、本地 More 与统一消息中心分开。未登录套件保持两次 relaunch。runner 仍为文件内 fail-fast、文件间继续、`retries=0`。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-007` 固定七文件集合、普通/未登录 relaunch 数、非 Feed/Smoke 禁止 `feed-list-ready-all`，并要求各旅程等待自己的主 tab；`scripts/smoke-android.mjs` 的 APK sanity 只等待 `main-tab-feed`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定脚本拓扑和 runner 语义；匹配身份的 `DEVICE_REPLAY_PASS` 才证明真实 Android 七个失败域能独立执行。 |
| Replay 或真实验收路径 | 在匹配 revision/version/APK SHA 的设备运行普通和未登录套件，确认某个普通文件失败时后续独立文件仍执行，cleanup/录屏隔离失败则立即停止。 |
| 负向验证方式 | 向任一非 Feed/Smoke Replay 加回 `feed-list-ready-all`，把等级步骤放回 `more-readonly.ad`，增加第七普通文件/额外 relaunch，或把 retry 改为非零，编号守卫必须失败。 |
| 明确不覆盖范围 | 不减少必要的身份前置，不合并独立来源请求，也不引入共享 session、全局 setup、nightly runner 或自动限流规避。 |

## `REG-TEST-008` 冷启动空节点让 Replay 在 selector timeout 前失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`MORE-01`、`RELEASE-02` |
| 用户症状 | exact-revision APK 已正常启动且稍后能显示 Feed，但 Replay 在任何旅程操作前报告 Android accessibility hierarchy 为 0 个节点；`more-readonly.ad` 等待 `main-tab-more` 时未用满 60 秒 selector timeout 就失败。 |
| 触发条件 | fresh build 或连续 relaunch 后，ReaderData 的本地读取尚未结算；`useAppRuntime` 因而尚未投影 routes。代理 SecureStore 是否完成不参与 route readiness。 |
| 根因 seam | `AppComposition` 在 `runtime.routes === null` 时返回空节点。snapshot helper 因前台 App 没有 meaningful accessibility node 转入 stock UIAutomator，后者等待 idle 超时，selector wait 无法继续轮询。 |
| 必须保持的行为 | routes 只等待 ReaderData 本轮结算，不等待 proxy。等待期间显示两个静态文本节点“阅坛 / 正在启动”，状态以 `role=status`、`busy=true`、polite live region 暴露且不使用无限动画；routes 放行后由真实导航树原位替换。ReaderSettings 缺失、损坏、reject 或 3 秒超时按 `REG-DATA-007` 使用四站全开默认值，不能形成第二个启动门。proxy 仍按 `REG-PROXY-011` 在 managed network/WebView transport 前 fail-closed。 |
| 精确失败 oracle | `tests/ui/app/app-composition.test.tsx` 在 `routes=null` 时要求 header、`阅坛正在启动` busy status 和零 `ActivityIndicator`；`tests/ui/app/app-runtime-startup.test.tsx` 固定 proxy 未完成时本地 routes 仍已发布；删除 fallback、恢复空节点、只留动画或重新把 proxy 加入 route gate 时失败。既有 `tests/tooling/android-smoke-guard.test.ts` 继续禁止 Replay 固定 sleep 与 retry。 |
| 最低可靠自动测试层 | `UI_PASS` 固定 bootstrap 可访问语义；匹配 revision/version/APK SHA 且零 retry 的七条普通 Replay 形成 `DEVICE_REPLAY_PASS`，两者不能互相替代。 |
| Replay 或真实验收路径 | 安装 exact-revision smoke APK，在保留数据设备运行 `npm run test:device`；每条文件独立 relaunch，直接等待自己的 `main-tab-*`，冷启动期间不得出现零节点 snapshot failure。 |
| 负向验证方式 | 把 fallback 改回 `null` 或仅含无限动画，UI 回归先失败；在 Replay 加固定 sleep、retry 或 Feed 全局前置，既有 tooling guard 必须失败。 |
| 明确不覆盖范围 | 不放宽 proxy transport 的 fail-closed，不把 ReaderData 真损坏伪装成首次安装，也不把 accessibility backend 异常误报为来源网络失败；proxy 的 3 秒 SecureStore load deadline 与原生 apply 语义由 `REG-PROXY-011` 单独固定。 |

## `REG-TEST-009` 账号外站探测波动阻断确定性 Release Replay

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`RELEASE-02`；共享 `MORE-05` |
| 用户症状 | 同一 APK、设备和登录数据下，正式 Release Replay 先在妖火“已登录”等待失败，单独重跑又在 NodeSeek 失败；随后手动同路径三站可恢复为 3/3，tab 切换立即成功。 |
| 触发条件 | 旧 Replay 强制依赖启动 Account probe 和三站实时成功；任一第三方波动都阻断 Release。 |
| 根因 seam | 持久化终态恢复与 `account-readonly.ad` / `nodeseek-session.ad` 的设备 oracle 失配；确定性 Replay 不应重新证明登录。 |
| 必须保持的行为 | 主设备账号 Replay读取已恢复终态，只接受已登录、明确未登录/失效或可重试 unknown 等已结算投影；不点击公共刷新、不自动重试，不发起 NodeSeek WebView或动态等级 transport。RNTL 固定终态恢复、手动刷新、WebView lifecycle和等级 transport；真实 WebView、身份与等级由 Agent Live 分轴报告。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-TEST-009` 要求两条 Replay 使用精确两分支 terminal selector，禁止公共刷新、NodeSeek WebView marker/刷新和动态等级 transport。修复前守卫在旧 exact-“已登录”与动态操作脚本上失败；修改后同一 APK 现场以妖火 unknown、其余两站 confirmed 通过两条 Replay。 |
| 最低可靠自动测试层 | `STATIC_PASS + UI_PASS + DEVICE_REPLAY_PASS`：静态守卫固定发布 oracle，Account/WebView/等级 RNTL 固定被移出的确定性行为，真实 APK Replay证明 Android 入口和 terminal 投影；第三方成功只属于 `LIVE_PASS` 或 `BLOCKED_BY_ENV`。 |
| Replay 或真实验收路径 | 保留登录数据和 `firstInstallTime`，以匹配 APK 零重试运行 `account-readonly.ad` 与 `nodeseek-session.ad`；任一站自然 unknown 时应显示可重试终态且其余站仍可选择。随后仅按授权的 Agent Live 检查 WebView或等级，不因 Live 阻碍否定确定性 Release。 |
| 负向验证方式 | 只接受“已登录”，加入固定 sleep、自动/显式刷新、WebView或等级 transport，tooling guard 必须失败；未结算状态同样失败。 |
| 明确不覆盖范围 | 不把 unknown 当登录成功，不保证第三方端点健康，不修改零自动重试或写入 fail-closed，也不清 Cookie、数据或登录态制造结果。 |

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
| 用户症状 | NodeSeek 一次普通超时、403 或 fallback 失败后，linux.do、妖火等本来无关的在飞请求一起被取消；随后刷新 More 或重新发请求才恢复。 |
| 触发条件 | NodeSeek 恢复分支调用共享 OkHttp `dispatcher.cancelAll()` 和 `connectionPool.evictAll()`，把站点级错误升级成进程级连接重置。 |
| 根因 seam | `nodeseekFetchFallback` 的推测性网络恢复与 `NetworkProxyRuntime` 共享 dispatcher/connection pool 的资源所有权冲突。 |
| 必须保持的行为 | 跨 generation 的全局 cancel 和两个 pool 的成对 evict 只属于代理配置 transition：应用、切换、关闭代理时先 fail-closed 再清理旧 transport。普通站点 403/429、Cloudflare、解析、账号或失败 fallback 只结算自己的请求；只有符合 `REG-PROXY-010` 的成功读取 fallback 才原子发布新的 App 读取 generation。只读 CookieJar、代理配置与 RN TLS/缓存语义跨代稳定；每代拥有独立的 ProxySelector wrapper、Dispatcher、forum/media pool、Expo Image client 与 Cronet generation。轮换只取消旧代中属于触发内容来源的论坛正文/媒体 `GET/HEAD`，无关健康请求和全部写请求自然 drain，不以绕过代理的 client 规避约束。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-PROXY-006` 先保持一个 linux.do shared-default transport pending，再触发不合格的 NodeSeek 失败；当前实现要求零轮换且 linux.do 仍成功。`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts` 另固定两站 hidden fallback 队列互不取消；`tests/tooling/release-packaging.test.ts` 固定生成源码中全局 `cancelAll()` 只属于代理 transition。生成的 Kotlin test 证明稳定 CookieJar/代理语义跨代不变，轮换前后的 selector wrapper、dispatcher、forum/media pool 与 image client 身份不同；触发内容来源的论坛正文/媒体 `GET/HEAD` 可取消，无关健康请求、其他来源、所有写请求不取消，旧 generation 待 OkHttp/Cronet/player lease 自然 drain。 |
| 最低可靠自动测试层 | `UNIT_PASS` + 原生生成/编译：跨站 Promise 固定用户可见误取消，Kotlin 行为固定稳定资源与每代 transport 的身份边界；字符串计数只作为调用点守卫。 |
| Replay 或真实验收路径 | 冷启动并行读取多个站点，只记录自然来源失败与其他站最终结果；不得主动断网、破坏账号或反复撞 Cloudflare。真实代理仅在用户提供并授权配置时验证，否则代理 Live 标记 `NOT_VERIFIED`。 |
| 负向验证方式 | 在任一站点 catch/超时恢复全局 cancel/evict，或给 Cookie bridge 另建独立 client；编号测试会观察到跨站取消、调用点增加或 managed client 资源身份不一致。 |
| 明确不覆盖范围 | 不取消代理 transition 必需的 fail-closed 清理，不修改系统级连接，不增加站点自动重试，也不把真实第三方故障伪装成成功。 |

## `REG-TOPIC-027` Discourse emoji 绕过统一 gateway 且切站迟到落地

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03`；共享 `MORE-01` 网络 seam |
| 用户症状 | linux.do 详情中的 reaction 图片目录直接读取 adapter，绕过 App 当前代理 fetcher、站点凭据、诊断和取消；卸载后旧目录可能迟到更新。 |
| 触发条件 | `TopicScreenBody` 直接调用 `getDiscourseSourceEmojiUrls(source)`，只以局部 boolean 忽略部分结果，没有向 transport 传 `AbortSignal`。 |
| 根因 seam | `src/features/topic/TopicRoute.tsx` → `src/sources/readGateway.ts` → `src/sources/discourseRead.ts` 的受管读取边界。 |
| 必须保持的行为 | emoji 目录通过 `ReadGateway.getEmojiUrls`，复用当前 proxy fetcher、同一次站点凭据读取和诊断 trace；Topic 切站、刷新替换或卸载时 abort 旧请求，迟到成功/失败都不得覆盖当前站点目录；继续复用 linux.do adapter 现有站点级 emoji cache。 |
| 精确失败 oracle | `src/sources/readGatewayContract.test.ts` 要求同一 credential、受管 fetcher、diagnostic operation 和 signal 到达 adapter；Topic RNTL 卸载旧 linux.do 请求后启动新请求，要求旧 signal aborted，新目录先落地后旧 Promise 再 resolve 也不能覆盖。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 Gateway 参数所有权；`UI_PASS` 固定 React effect 取消与可见目录隔离。 |
| Replay 或真实验收路径 | 获得只读网络验收授权后快速切换两站含 reaction 的主题，确认图片始终来自当前站点；本轮不访问论坛，标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 Topic 对 adapter 的直接 import、丢弃 gateway fetcher/auth/signal、移除 cleanup abort 或取消迟到结果门禁，编号测试必须失败。 |
| 明确不覆盖范围 | 不新增 Query 架构，不移除站点级 emoji cache，不执行写操作，也不通过真实账号请求制造竞态。 |

## `REG-TOPIC-028` V2EX 重复楼层被当作回复身份导致大片空白

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | App 内打开 V2EX 主题 `1229472` 并滚动到 67～68 楼时，两条正常回复之间出现超过一屏的空白，后续回复像被错误跳过。重启模拟器后仍稳定复现。 |
| 触发条件 | 历史 V2EX adapter 曾把 API 回复与 HTML 楼层元数据合并，网页端未展示的回复会让两个不同 `commentId` 得到相同展示楼层；更一般地，任何来源只要出现“实体不同但楼层相同”，其中一条高度较大时就更容易暴露。 |
| 根因 seam | `src/features/topic/components/TopicContentList.tsx` 通过 `src/features/topic/model/replyListModel.ts`、`src/features/topic/model/topicContentIdentity.ts`、`src/features/topic/model/topicHeaderModel.ts`、`src/features/topic/model/topicError.ts` 的 `getReplyKey` 把楼层作为 FlashList 稳定身份，导致不同回复复用同一 key 和历史布局高度；项目已有 `src/domain/forum/feed.ts` 的 `replyKey` 已按 `commentId` 优先表达正确身份。 |
| 必须保持的行为 | 回复存在 `commentId` 时以其作为稳定列表身份：不同 id 即使显示同一楼层也必须是不同列表项，同一 id 即使楼层变化仍保持身份；只有来源没有 `commentId` 时才回退楼层，再缺失时使用既有内容回退。本条只约束列表 identity；V2EX 回复集合的数据所有权与完整性由 `REG-TOPIC-069` 约束，不得为保留本条历史现场恢复跨端点 HTML/API 合并。 |
| 精确失败 oracle | `src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicContentIdentity.test.ts` 的 `REG-TOPIC-028` 使用现场对应的 `commentId=17900145` 与 `17900159`，让图片回复和文本回复同为 68 楼，要求 `getReplyKey` 不同；修复前二者都得到 `reply-floor-68`。同文件另固定同 id 换楼层 key 不变、无 id 时仍按楼层稳定。 |
| 最低可靠自动测试层 | `UNIT_PASS`：列表身份是确定性纯逻辑；普通 RNTL mock 不实现 FlashList 原生布局复用，不能替代本条 oracle。 |
| Replay 或真实验收路径 | 使用 App 内部直链直接打开 `https://www.v2ex.com/t/1229472`，不经搜索；滚动到 67～69 楼，确认原空白区域渲染为独立回复内容，后续回复没有消失、重叠或高度串用。全程只读。 |
| 负向验证方式 | 恢复楼层优先的 `getReplyKey`，或在 Topic 另建不含 `commentId` 的 key；编号测试必须重新得到重复 key，现场可再次出现大片空白。 |
| 明确不覆盖范围 | 不决定 API 独有回复是否应显示，不校准网页删除状态或楼层编号，不新增依赖动态原帖的 tracked Replay；V2EX 是否采用某一回复集合按 `REG-TOPIC-069` 判断。原帖内容变化导致现场不再具备重复楼层时记 `NOT_VERIFIED`。 |

## `REG-FEED-007` 返回 Feed 后重复提示缓存的局部错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-04` |
| 用户症状 | 从详情或其他页面返回 Feed 时没有新请求，却再次弹出上一页的来源错误；NodeSeek 错误还可能重复打开验证面板。 |
| 触发条件 | Infinite Query 以 `staleTime: Infinity` 保留 page data，页面重新 active 后 effect 再次消费同一个 `lastPage.errors` 对象。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的局部分页错误副作用。 |
| 必须保持的行为 | 同一个缓存 errors 对象只提示一次；真正的新请求产生新 errors 对象时仍可提示，成功来源和旧页面数据继续保留。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-007` 首次提示后切到 More 再返回 Feed，要求无新 transport、无第二次通知。 |
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
| 根因 seam | `src/features/feed/useFeedController.ts` 的 `mergeFeedPages` 必须只按页序追加并去重；旧实现曾把跨页数据重新按活跃度排序并按来源平衡。 |
| 必须保持的行为 | 加载下一页后，加载前的 `topicKey` 序列必须仍是新序列的完整前缀；新页唯一主题只追加到末尾，重复主题保持原位置；错误继续累积，分页元数据使用最新页。显式刷新仍可采用服务端最新顺序。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-008` 分别建立聚合 Feed 和 NodeSeek 两页数据，让第二页主题拥有更新的 `lastReplyAt`，要求第一页 key 顺序不变且第二页追加；修复前聚合结果变为“第三、第二、第一”，NodeSeek 结果变为“第三、第一、第二”。 |
| 最低可靠自动测试层 | `UI_PASS`：通过真实 `useFeedController`、Infinite Query 和 `loadFeed` 固定用户可见列表顺序；只测试纯合并函数或 FlashList 配置不能覆盖本次迁移 seam。 |
| Replay 或真实验收路径 | App 内首页“全部”和 NodeSeek“新帖子”持续单向下滑触发下一页；请求结算后，已滑过主题不得重新出现，静止时同一可见主题及纵向位置保持。再抽查 linux.do 和一个其他单站。全程只读。 |
| 负向验证方式 | 让 `mergeFeedPages` 对全部 pages 重新按活跃度排序或按来源平衡，编号测试两个参数用例都必须失败。 |
| 明确不覆盖范围 | 不修改 Search、User 或 Topic 列表，不处理 key 顺序保持时仍存在的动态高度位移；后者若能独立复现应建立新的 UI 回归。 |

## `REG-FEED-009` 身份屏障复用可信多页时再次重排

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04`、`ACCOUNT-02` |
| 用户症状 | “全部”已经加载多页后进入登录或验证对账，网络尚未返回，已浏览主题就会换位并带动当前阅读位置回跳。 |
| 触发条件 | 聚合 Feed 存在可信多页缓存且任一来源进入 identity barrier；第二页主题活跃时间晚于第一页。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的可信 identity barrier 合并曾全量重排；改为普通 stable append 后又只从旧页保留 pending 来源，安全响应若只返回第一页会截掉旧第二页的安全来源。解除 barrier 时再把完整展示快照压成一个合成页，真实第一页结算后仍会覆盖旧尾页。 |
| 必须保持的行为 | identity barrier 开始和安全来源刷新结算时都保持当前 topic key 顺序；本 runtime 可信快照中的安全来源与允许复用的 pending 来源都稳定去重保留，重复主题保持原位置。解除 barrier 时保留原页数供 Infinite Query 逐页重读，但迁移期间关闭旧 `hasMore`/cursor，后续页 cursor 只由新第一页响应重建；真实 epoch 变化后仍停止复用变化来源。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-009` 先加载两页，其中第二页同时含 V2EX 安全主题和 NodeSeek pending 主题；建立 barrier 后新请求只返回第一页 V2EX，要求旧第二页两项都保持。解除 barrier 后服务端按真实 page 1、page 2 分别结算，要求中途及最终完整 key 序列均不截断，且确实发起第二页读取。旧实现会先丢第二页 V2EX，再因合成单页只重读 page 1。 |
| 最低可靠自动测试层 | `UI_PASS`：必须通过真实 `useFeedController`、Infinite Query placeholder 和 identity barrier key 变化固定可见顺序。 |
| Replay 或真实验收路径 | 不在主登录设备制造身份 barrier 或换号；本回归以确定性 UI 测试为最低证据。若另获授权在一次性环境执行身份切换，barrier 前后同一可见主题与纵向位置必须保持。 |
| 负向验证方式 | 只保留旧 pending 条目，编号测试会在 barrier 安全响应结算后丢掉第二页 V2EX；把解除 barrier 的快照压成一个合成页，则不会发起 release page 2。 |
| 明确不覆盖范围 | 显式刷新仍可采用服务端最新顺序；不处理 topic key 不变但内容动态高度变化导致的位移。 |

## `REG-FEED-010` 启动身份对账让 Feed 旧列表闪现后退回 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 关闭并重新打开 App 时，首页偶尔先显示上次或首个请求的列表，随后退回全屏 Loading，再显示新列表；分类栏也可能同步闪空。 |
| 触发条件 | Feed/Categories 在本机账号终态恢复前启动，随后 Account bootstrap/probe 逐站改变 ReadPlan/query key；温缓存或首个结果因此先可见再失效。 |
| 根因 seam | 冷启动把“恢复已确认事实”和“重新证明身份”混成同一生命周期，`useAppRuntime` 没有在唯一 ReadPlan 创建前等待 account session hydration。 |
| 必须保持的行为 | 冷启动并行恢复 ReaderData 与每来源持久终态，两者结算前只显示骨架且 Feed/Categories transport 为 0。恢复后从唯一 snapshot 派生一次 ReadPlan，Feed 与 Categories 各启动一次；普通启动 Account probe 为 0。authenticated 温缓存、错误、验证动作和 cursor 不得投影到 public scope。真实 anonymous/A→B/当前 epoch 401 只隔离该来源，保留 sibling 的顺序与安全尾页，并拒绝迟到结果。 |
| 精确失败 oracle | `src/platform/storage/accountSessionStore.test.ts` 固定每来源终态和损坏隔离；`tests/ui/account/account-status-controller.test.tsx` 固定已保存三站启动零 probe；`tests/ui/app/app-runtime-startup.test.tsx` 固定 hydration 前零 Feed/Categories、完成后各一次；`tests/ui/feed/feed-controller-session.test.tsx` 固定列表序列无 V2EX-only、跨 scope 温缓存零帧泄漏。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：必须通过真实 Account/Feed controller、ReadGateway、TanStack Query key/placeholder 和逐次 render 固定启动竞态；源码字符串、App 能启动或单次 Smoke 不能证明无账号冻结或跨 scope 温缓存。 |
| Replay 或真实验收路径 | 匹配 APK 保留数据连续 5 次 process-cold launch；每次可见序列只能是“骨架 → 一次正常多来源列表”，诊断 Account probe=0、Feed=1、Categories=1，且无非空列表回退 Loading。 |
| 负向验证方式 | 在 account hydration 前启用 Feed/Categories、恢复启动 probe、允许 authenticated cache 投影到 public scope或暴露旧 cursor；编号测试必须观察到额外请求、V2EX-only、私有缓存泄漏或列表回退。 |
| 明确不覆盖范围 | 不增加全局 Splash、缓存持久化、FlashList offset/MVCP 补偿或新依赖；如果 topic key 序列无空档且未变化来源顺序稳定后设备仍位移，另立动态高度或布局回归。 |

## `REG-FEED-011` 整批身份对账逐站发布导致聚合请求风暴

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | v1.3.80 启动首页时 Loading 反复出现，站点可能提示操作过于频繁；一次启动日志在 3.536 秒内完成 3 次聚合 Feed、4 次聚合 Categories 和 4 个 Account probe，对应 28 个实际 HTTP，并在首批 30 条已可见后再次出现 2 个 busy 帧。 |
| 触发条件 | 普通冷启动仍执行全站 Account batch，或逐站核对中间态进入 Feed/Categories key；为隐藏闪动又增加 snapshot/epoch freeze，造成第二套生命周期。 |
| 根因 seam | 启动阶段没有信任上次终态，Account owner 被错误赋予首页启动编排职责。 |
| 必须保持的行为 | 删除普通启动 Account batch、Feed 专用 gateway/epoch freeze 和身份 pending 发布。首次升级只对有 Cookie/SecureStore 候选的已启用来源并行精确核对一次；无论成功、匿名或超时都写一个全局 migration marker，完成后才启动唯一 Feed/Categories。以后启动零 probe。更多页手动刷新仍并行检查已启用来源，同来源快速触发复用一个 Promise；检查开始/失败不改变身份或 ReadPlan，同身份不增加 Feed 请求。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 固定迁移只检查候选、失败后下次不重复、公共刷新 per-source single-flight 与 A→A 零 Feed reset；`tests/ui/app/app-runtime-startup.test.tsx` 固定迁移结算前 Feed=0、之后 Feed/Categories 各一次；源码/架构门禁拒绝旧 batch/freeze 标识。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：必须通过 canonical Account owner、Feed controller、ReadPlan scope、TanStack Query cache 与逐次 render 固定请求次数和 Loading 连续性。 |
| Replay 或真实验收路径 | 保留数据连续冷启动确认零 Account probe；更多页连续点两次刷新，诊断每来源最多一个 probe且同身份首页零新增 Feed。迁移只在一次性空白/确定性测试环境验证，不清主 AVD 数据。 |
| 负向验证方式 | 恢复启动 batch/freeze、让核对 activity 改身份、迁移失败后下次自动重试，或 A→A 重置 Feed；编号测试必须失败。 |
| 明确不覆盖范围 | 一个聚合 adapter 为完成单站协议而产生的多个不同 HTTP 不算重复聚合；本回归不改变站点协议、分页、列表排序或滚动位置，也不把妖火等 strict operation 降级公开。 |

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
| Replay 或真实验收路径 | 新接来源时按架构清单验证换号前后读取；本次现有四站行为由共享回归覆盖。 |
| 负向验证方式 | 恢复硬编码数组或让 `managedSession` 与派生列表脱钩，编号测试或 typecheck 失败。 |
| 明确不覆盖范围 | 不把 topic action 能力当成会话能力，不建设 runtime adapter plugin。 |

## `REG-SOURCE-009` WebView HTTP 成功在 source parser 前误触发读取 runtime 轮换

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01` |
| 用户症状 | direct timeout/network error 后隐藏 WebView 返回 200，但内容是临时 shell、错误 HTML 或畸形 JSON；页面最终仍解析失败，App 却把这次请求计为成功 fallback 并轮换读取 runtime。聚合读取还可能因另一站成功而确认失败站；详情的辅助 poll 失败被降级为 partial 时也可能误确认。 |
| 触发条件 | transport fetcher 在 `response.ok` 时立即调用 recovery，而 source parser 位于外层；一个 source operation 可有多个主/辅助 Response，错误可能被 adapter 有意收敛为 partial。旧 fallback 还可能晚于更新且已解析成功的 direct operation 才完成；Response 已通过 parser 后，辅助收尾尚未结束时，Gateway session epoch 或 `AbortSignal` 也可能已经失效。聚合读取中，一个 child 还可能已完成 parser，而 sibling 仍 pending；此时 outer aggregate 才被取消或 supersede。 |
| 根因 seam | transport 成功、Response 对应的 source parse proof、child typed result、最外层 aggregate result 与最终请求所有权没有统一 lifecycle；恢复计数器把 HTTP 状态误当成 source-readable 证据，并按 operation 一次性确认所有子请求，或让先完成的 child 在 aggregate/Gateway 最终 current/abort guard 前提前提交。 |
| 必须保持的行为 | NodeSeek/linux.do fallback 只登记绑定具体 Response 的候选。具体 parser 接受或拒绝该 Response 后，单站 `ReadGateway` 与 `accountRead` 只能在 typed operation 成功、Gateway generation 仍 current 且所属 signal 未 abort 时提交 accepted evidence；Feed/Categories/Search 的 child 成功只把自身 proven evidence 暂存到 aggregate attempt，所有 sibling 结算并形成最外层 typed result 后才统一提交，另一站成功不能证明失败站。无 scope、aggregate 失败或 lifecycle 失效都 fail-closed。多个 evidence 每次 commit 前重新检查所有权，首个 commit 期间发生失效时后续 evidence 不得提交。主 fallback 与辅助请求独立证明：辅助解析失败不得借主结果确认，主 fallback 不因同 attempt 后续辅助 direct 成功失效；另一条更新且已解析成功的 direct operation 必须阻止旧候选迟到复活。HTTP/Cloudflare、写请求、取消、失败 WebView 和 parse error 不触发；合法空列表与 `current_user:null` 等 source-readable 结果仍可触发。轮换失败不得覆盖或拒绝已经解析成功的业务结果，attempt 门禁本身也不得改写 Gateway 原有的返回或取消结果；evidence closure 继续使用 transport request-start generation，延迟提交不得重新捕获 current。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-SOURCE-009` 固定 NodeSeek generic topic HTML、linux.do Feed/Account malformed JSON、无 scope、聚合 child 隔离、更新 direct 迟到门禁、NodeSeek Account 首页无身份证据后设置页 direct 成功、poll parse error 被 partial 吞掉、primary fallback 后 auxiliary direct，以及 linux.do 合法匿名；`src/sources/readGatewayContract.test.ts`、`src/sources/forumSourceReadAttempt.test.ts`、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts` 与 `src/sources/accountRead.test.ts` 另固定 parser accept 后的 Gateway supersede/abort、Feed/Categories/Search child 完成而 sibling pending 时 outer abort、全部 child 成功后的延迟 commit、aggregate child 继承 owner eligibility、Account abort 和多 evidence 中途失效。并保留 `REG-NODESEEK-004`、`REG-LINUXDO-007/008` 的阈值、排除条件和 rotation failure 仍返回 parsed result。修复前 generic/malformed/partial、outer stale/canceled 路径会调用 recovery，主候选会被辅助 direct 错误清除，或第二份 evidence 在失效后继续提交。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须穿过真实 fallback fetcher、source parser、managed gateway/aggregate/account orchestrator；源码字符串和裸 Response 200 不能替代。 |
| Replay 或真实验收路径 | 在匹配 APK 中自然遇到 direct timeout/network error 时核对同一 source read 的 parser 成功后才出现 `rotate-read-runtime`；解析失败只显示可重试错误。无法稳定制造第三方畸形响应时记 `NOT_VERIFIED`，不清数据、不改 IPv6、不伪造网络故障。 |
| 负向验证方式 | 把 recovery 移回 `response.ok` 分支、让 child parser 完成后立即 commit、让顶层 source 成功一次性确认所有 child、删除 Response proof、aggregate transaction、Account scope、最终 eligibility 或逐 evidence 重检，或删除更新 direct ordinal；编号测试分别出现误轮换、跨站串证据、poll mask、旧候选复活、outer 取消后轮换、后续 evidence 越权提交或主候选被辅助 direct 清除。 |
| 明确不覆盖范围 | 不改变 fallback 触发条件、阈值、HTTP/CF/写入/取消排除语义，不新增重试，不用 diagnostics 取代业务控制流，也不把所有空结果一律视为 parse failure。 |

## `REG-SOURCE-010` 内容源已隐藏但账号、聚合、后台或旧路由仍出网

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-05`；共享 `FEED-01/02/04`、`SEARCH-01..04`、`LIBRARY-01..03`、`NAV-01/02`、`TOPIC-01`、`USER-01`、`ACCOUNT-01/02`、`NOTIFY-01..03`、`DATA-01..03` |
| 用户症状 | 用户在“更多”停用没有账号或不想看的站点后，页面虽然隐藏，该站仍被账号探测、“全部”聚合、搜索预览、后台消息或旧详情链接请求；重新启用还可能补报停用期间消息。 |
| 触发条件 | 只在某个页面过滤静态来源菜单，或把停用误写成 anonymous/unavailable；Query、Gateway、Account、headless worker 与 route controller 没有消费同一持久化 enabled set。 |
| 根因 seam | `sourceCatalog` 的静态能力边界、`ReaderSettings.contentSources` 的用户选择和 Account identity 被混成一个状态；请求层没有 fail-closed allowlist，排序也与请求集合共用不稳定 key。 |
| 必须保持的行为 | Catalog 始终保留四站能力；偏好清洗未知/重复并补齐新来源。用户顺序只控制展示，canonical enabled-set 控制 Query。停用后在 credential/fetch 前拒绝 direct read，只聚合 enabled snapshot，取消旧 source/aggregate Query 并拒绝迟到提交；Account 不 probe 且保留身份材料；本机收藏/历史/关注只隐藏不删除；Topic/User/NotificationDetail 外层拦截；通知保留 intent，撤摘要并清 baseline/delivered/unread。重新启用时恢复已有持久终态；没有终态则进入 unknown/public lane并等待用户手动刷新，不自动核对。消息首次扫描只建 baseline。 |
| 精确失败 oracle | `src/domain/reader/contentSourcePreferences.test.ts` 与 reader store/backup tests 固定默认、清洗、全关与兼容；`src/sources/readGatewayContract.test.ts`、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts` 固定 credential/fetch 前拒绝及 aggregate/cursor 子集；Account controller/runtime tests 固定冷启动、停用 stale 与重新启用零自动 probe；`tests/ui/app/content-source-query-cleanup.test.tsx`、Feed/Search/Library/More/Account tests 与 `tests/ui/app/content-source-route-gates.test.tsx` 固定 UI、选择回退、零 refetch/零 controller；NotificationGateway/worker/background/runtime/route/screen tests 固定 allowlist、竞态撤销、清水位、旧点击和不补报。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯投影/请求与 worker 用 Vitest，React 生命周期、route/controller 是否挂载和跨入口展示用 Jest/RNTL。源码字符串或只看菜单隐藏不能替代。 |
| Replay 或真实验收路径 | 按 `tests/live/agent-live.md` 的 `LIVE-LOCAL-04`，在匹配 revision/APK、保留登录态与本机数据的设备记录原偏好和 `firstInstallTime`；关闭妖火后重启并覆盖首页全部、搜索全部、收藏、账号、消息、前后台恢复和旧链接，以 host 级网络 oracle 确认妖火请求为 0。重新启用后已有终态直接恢复；无终态时保持 public/待核对且零自动账号请求，用户手动刷新后再恢复严格能力。最后恢复原偏好，禁止卸载或清数据/Cookie。 |
| 负向验证方式 | 分别移除 Gateway 前置检查、aggregate includedSources、Account enabled filter、headless 持久化 allowlist、route 外层 gate、notification cleanup 或 canonical key；对应测试必须观察到 credential/fetch/probe/controller/投递调用、隐藏数据回显、排序 refetch 或旧消息补报。 |
| 明确不覆盖范围 | “零请求”只约束 App 管理的论坛来源请求；检查更新、代理恢复及用户主动交给系统浏览器的普通外链不属于该来源 allowlist。已经进入网络层的 HTTP 字节只能尽力 abort，但其迟到结果仍必须被拒绝。 |

## `REG-ACCOUNT-039` linux.do 身份确认后 workflow 仍停在 verifying

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`SEARCH-04` |
| 用户症状 | canonical Account 已确认登录，但验证弹层 workflow 仍显示 verified/verifying、丢失 current user 或关闭写入；原页面恢复失败时还可能把可信身份一起降级。 |
| 触发条件 | 旧实现只在 recovery 成功分支补发不完整账号成功事件，no-recovery 与恢复异常分支没有一致提交。 |
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
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts` 与 `src/platform/media/mediaSessionEpoch.test.ts` 固定媒体来源标记/epoch；生成 Kotlin policy tests 固定同源、跨站、无效标记和真实 302 离源后跳回，并单独证明无标记普通 API 不进入媒体策略；视频 UI 测试要求 source 无 JS Cookie。 |
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
| 根因 seam | `src/domain/forum/forumContentMedia.ts` 的 source upgrade 与 `src/platform/media/imagePreviewCatalog.ts` 的 preview catalog/tapped URL 结算。 |
| 必须保持的行为 | 相对地址只可作为匹配 alias；正文、预览和保存只接受绝对 HTTP(S)、规范化 protocol-relative URL 或允许的 raster data URI，否则回退已清洗 `src` 或不发请求。 |
| 精确失败 oracle | `tests/integration/topic-content-rendering-contracts.test.ts` 的 `REG-TOPIC-030` 固定 sanitizer → canonical normalizer → preview catalog 完整链路不重新激活 unsafe lazy 候选；`src/platform/media/imageRequestSource.test.ts` 固定绝对 HTTP(S) 判定与 protocol-relative URL 规范化边界；`src/platform/media/imagePreviewCatalog.test.ts` 固定直接点击危险或相对 URL 不会产生 active preview item。 |
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

## `REG-TOPIC-032` 正文图片逐图总时限无法表达加载进展

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 服务器接受连接但正文图片长期没有字节进展时，图片可以无限转圈；若改成每图 30 秒完整 `callTimeout`，持续有进展的大图又会在总时长到点后被误杀，海量正文还会线性创建 Timer 和同步失败波次。全屏预览的独立 timeout 由 `REG-TOPIC-052` 管理，不属于本条。 |
| 触发条件 | Expo Image/Glide 的网络调用缺少 route 级进展所有者；OkHttp `callTimeout` 覆盖连接、响应头和完整 response body 总时长，不能区分“持续下载”和“30 秒没有进展”。每个 renderer 自建 JS Timer 还会把不可信图片数量直接转换成运行时资源。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 的 Expo Image client timeout 配置与 `src/features/topic/media/TopicBodyMediaCoordinator.tsx` 的正文 permit/deadline 生命周期必须共同定义终态；任一层单独承担完整语义都不够。 |
| 必须保持的行为 | Expo Image clone 固定 `connectTimeout=15 秒`、`readTimeout=30 秒`、`callTimeout=0`；RN 基础 client 保持零总时限，视频和全屏预览保留各自生命周期。focused Topic route 的 coordinator 只维护一个最近 deadline Timer：正文媒体获 permit 后 30 秒无进展才失败，每次 progress 只延后该请求 deadline，结算后立即释放 running slot。每个 request identity 的首次失败只在既有 4-request 门禁内自动重试一次；第二次失败后，同一 Topic session 内不因滚动、recycling、重复 renderer 或 runtime rotation 自动形成第三波，只允许用户显式重试一次。正文 timeout/cancel 不触发 `ReadNetworkRuntimeGeneration` 轮换。 |
| 精确失败 oracle | fresh prebuild 生成的 Kotlin test 与 `tests/tooling/release-packaging.test.ts` 固定 image clone `callTimeoutMillis == 0`、`connectTimeoutMillis == 15000`、`readTimeoutMillis == 30000`。`tests/ui/topic/topic-media-coordinator.test.tsx` 用 2000 个 eligible descriptors 固定 running `<=4` 且始终只有一个 Timer，并覆盖最近 deadline、progress 延期、slot 前进、一次受限自动重试、第二次失败后滚动 recycling 不再重试、一次显式重试、健康 duplicate 保持与迟到 callback。 |
| 最低可靠自动测试层 | `UI_PASS + STATIC_PASS`：RNTL fake timer 固定 route 级调度/终态，生成 Kotlin JUnit 与 fresh prebuild compile 固定真实 OkHttp client 配置；任一层不能替代另一层。 |
| Replay 或真实验收路径 | 可控 stalled 正文图在获 permit 后首个 30 秒无进展应只启动一次受门禁约束的自动重试；第二个 attempt 再连续 30 秒无进展才进入用户可见失败并让下一项获得许可。持续报告 progress 的大图不得因墙钟总时长被终止。没有安全可控端点时设备项标 `NOT_VERIFIED`，不能用断网、清数据或修改 IPv6 代替。 |
| 负向验证方式 | 恢复 image clone 的 30 秒 `callTimeout`、为每个 renderer 创建 Timer、让任意 progress 延长所有请求、取消首次自动重试或允许第二次失败后因滚动/rotation 再发、重建健康 duplicate、允许第二次显式重试，或把正文 timeout 接入 read-runtime rotation，对应 Kotlin/RNTL oracle 必须失败。 |
| 明确不覆盖范围 | 不改变 `REG-TOPIC-021` 的普通请求后台预算或 `REG-TOPIC-052` 的全屏预览状态机，不给长视频设置 30 秒总时限，也不以 coordinator 掩盖 HTTP、解码或 challenge 的真实错误。 |

## `REG-TOPIC-033` HTML 图片属性被重复解码

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 图片 URL 中本应保留的字面 `&lt;` 被再次变成 `<`，增补平面数字实体也可能被截断。 |
| 触发条件 | DOM parser 已解码属性，后续 helper 又按多趟替换；`&amp;lt;` 在一轮调用内被解两次。 |
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的 DOM 属性读取与 raw regex fallback 解码边界。 |
| 必须保持的行为 | DOM 属性直接使用 parser 结果；只有 raw fallback 调用现有单趟 `decodeHtml` 一次，并保持 `fromCodePoint` 语义。 |
| 精确失败 oracle | `src/platform/media/imagePreviewCatalog.test.ts` 的 `REG-TOPIC-033` 输入 `&amp;lt;`，公开提取结果必须是字面 `&lt;` 而非 `<`。 |
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
| 用户症状 | linux.do引用缺少 `data-username` 时，显示名、头像路径或标题回退被当成 username；点击作者会进入不存在或错误的用户页。 |
| 触发条件 | 回复模型用单个字符串同时表达引用作者的显示标签和站内路由身份，两套 Discourse adapter 的回退规则又各自漂移。 |
| 根因 seam | `src/sources/discourse/content.ts` 的共享 Discourse 引用解析、`Reply.quotedPosts[].author` 数据模型与 `ReplyItem` 导航门禁。 |
| 必须保持的行为 | 引用始终可显示最可靠的 `label`；只有原始 `data-username` 能产生可导航 `username`。display-name、头像 URL 和标题只作 label；linux.do 使用同一解析实现，本主题引用继续移出正文并保留摘要。 |
| 精确失败 oracle | `tests/ui/topic/topic-components.test.tsx` 的 `REG-TOPIC-035` 构造只有 label 的引用，要求显示标签且点击不调用 `onOpenUser`；`tests/integration/source-read-contracts/` 固定头像回退只有 label，显式 username 同时保留两字段； 固定同一结构。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：来源归一化与真实 ReplyItem 点击行为。 |
| Replay 或真实验收路径 | 在两站只读打开含本主题引用的回复；有 username 的引用可进入正确用户页，只有显示标签的引用不可点击。动态页面没有 display-only 样本时标 `NOT_VERIFIED`。 |
| 负向验证方式 | 把 quoted author 恢复为字符串，或用 label 构造用户对象，UI 编号测试会重新导航；删掉任一 adapter 的共享解析后来源测试失败。 |
| 明确不覆盖范围 | 不根据显示名猜用户名，不对跨主题引用建立本地楼层关系，也不统一四站非 Discourse 引用协议。 |

## `REG-TOPIC-036` NodeSeek 渲染分页缺楼层时从 1 重新编号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | NodeSeek 第 2 页缺少 `.floor-link` 和数字 id 时从 1 重新显示楼层，与首屏重复；点赞等 embedded 元数据还可能因错误楼层匹配而丢失。 |
| 触发条件 | 渲染解析层立即用页内 index 补楼层，使消费层无法判断字段缺失、无法应用 page/offset，也让 `missingFloorCount` 永远为 0。 |
| 根因 seam | `src/sources/nodeseek/topicParser.ts` 的渲染楼层解析，以及 `src/sources/nodeseek/reader.ts` 的 Topic 首屏与 replies 分页消费。 |
| 必须保持的行为 | 解析层保留 `floor: undefined`；首屏按 1 起补齐，后续页按当前 offset 补齐；在补齐前记录真实缺失数量，显式楼层和 commentId 优先级不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-036` 读取 offset=30 的第 2 页无标记渲染 HTML，要求楼层为 31、32 且诊断缺失数为 2；既有首屏测试固定从 1 开始。 |
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
| 精确失败 oracle | `tests/integration/forum-presentation-contracts.test.ts` 的 `REG-TOPIC-039` 固定 candidate hit 返回 UID，而 candidate miss/非法 hint 仍返回 username reference；`tests/integration/source-read-contracts/` 固定 exact 结果位于完整 50 条列表后部、Unicode、大小写唯一兼容、冲突、无匹配、非法 UID、失败响应、429 与未登录零 transport；Gateway/Query 测试固定 managed credential、UA、signal、trace、同 username+epoch 去重与换 epoch 重解；Topic/User UI 测试固定正文、回复正文、回复引用和签名共用内部入口，解析前零 Profile/零关注，成功后 Profile/分页/关注只使用 UID；`src/domain/reader/readerData.test.ts` 拒绝 `nodeseek:{username}`。 |
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
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的图片候选解析与预览 alias catalog、`src/domain/forum/forumContentMedia.ts` 的正文 source 选择，以及 `src/features/topic/rendering/previewRenderers.tsx` 的最终 native source。 |
| 必须保持的行为 | 每张 HTML 图片形成最小双层模型：`displayUri` 必须是正文首个请求，`originalUri` 用于全屏、保存及 `REG-TOPIC-048` 约束的第二阶段清晰升级。`w` 候选选择首个满足 `contentWidth × DPR` 的宽度，否则最大；`x` 候选选择首个不低于 DPR 的倍率，否则最大。安全且非占位的 `src` 在候选不完整时优先；灯箱原图不得覆盖正文首个请求。所有 alias 仍结算到同一预览项，主动 URL 继续遵守 `REG-TOPIC-030`。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/domain/forum/forumContentMedia.test.ts` 的 `REG-TOPIC-040` 固定 `w/x srcset` 临界点、DPR、无描述符回退、占位 src、非法候选、alias 去重和 display/original 分离；`tests/ui/topic/topic-image-loading.test.tsx` 用含小适屏图与大灯箱图的真实 renderer props 断言适屏图完成 `onLoad + onDisplay` 前 native source 只收到适屏 URL，点击后预览仍指向原图。 |
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
| 根因 seam | `src/platform/media/mediaSessionEpoch.tsx` 的媒体 session identity 与 Expo/Glide disk cache namespace。 |
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
| 必须保持的行为 | 静态 artifact 在正文、当前预览页和相邻预热页都只显示已经生成的 PNG poster，不再挂载第二个 Chromium renderer；当前静态页使用高优先级且仍按 View 尺寸下采样，`onDisplay` 才结算可见成功。只有 `animated` artifact 的当前页可挂载隔离 document view，并以同一 poster 保持首帧连续；相邻页仍不得启动 WebView。保存始终重新读取原始 SVG。 |
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
| 必须保持的行为 | 非循环三物理槽 ring 只给当前与相邻页挂媒体；每槽 ResumableZoom 的唯一媒体 child 只能包含 raster 或 SVG poster，动画 document view 必须是同一 slot 内、缩放树外的绝对定位 sibling，任何 scale 都不能传递给 Chromium。动画 SVG 在当前页使用平台默认合成层的隔离 document view；同尺寸 artifact poster 始终挂载并以 `onDisplay` 单独记录 native 像素 readiness。poster 未显示时，缩放 intent 继续保留固定 1 倍 document view；poster 已显示后把同一个 document view 透明隐藏，放大和平移只变换 poster。回到 1 倍直接显示同一个 document view，不能黑屏、闪空白、销毁 Chromium 或重新发网。两指或 scale 大于 1 时父级 manual Pan 必须在 UI thread 失败；回到 1 倍才恢复横滑和下拉关闭。静态 SVG、普通图片、原图保存、真实尺寸和相邻页零 Chromium 不改变。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-045` 首先断言 `CompatibleSvgDocumentView` 永远不是 `preview-zoom-*` 的后代；WebView mount token 与 mount/unmount 计数固定双击、平移和回到 1 倍全过程为同一实例且零卸载；`tests/ui/shared/compatible-svg-document-view.test.tsx` 固定不强制 Android layer。poster 尚未 `onDisplay` 时触发 ResumableZoom 的真实 double-tap start，document view 保持可见且父级分页/关闭 Pan 失败。poster `onDisplay` 后同一个 document view 只变为透明且 recycling identity 不变；scale 仍大于 1 的 gesture end 保持 poster/父级 Pan 失败，回到 1 后直接显示同一个 document view 并恢复父级手势，整个过程 SVG fetch 与 poster render 都只发生一次。 |
| 最低可靠自动测试层 | `UI_PASS` 固定挂载边界与连续帧；`DEVICE_REPLAY_PASS`/只读设备日志固定真实 Chromium 资源行为。 |
| Replay 或真实验收路径 | 只读打开 NodeSeek `post-841430-1` 的动画 SVG：1 倍静止时 CDP 只有一个 attached preview target 且不产生 tile memory 告警；双击放大或双指缩放后 target 仍是同一个固定尺寸 sibling、海报视觉连续，平移、停留期间也无新增告警或 renderer process 重启；回到 1 倍后动画立即继续，Android Back/下拉关闭仍有效，App 与设备存活。 |
| 负向验证方式 | 把 `CompatibleSvgDocumentView` 移回 ResumableZoom child；结构断言立即失败，设备重新出现 tile memory 告警。仅延迟 JS 回调或卸载不能通过该 oracle。 |
| 明确不覆盖范围 | 不把动画永久降级为静态图，不修改 zoom toolkit，不新增 renderer/图片库，不用海报作为保存来源，也不改变普通 raster 图片缩放。 |

## `REG-TOPIC-046` 多图预览被缩放手势截获后无法横滑

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 三图主题打开后稳定显示 `1/3`，但在图片上向左滑动仍停留在第一张，用户无法进入后两张。 |
| 触发条件 | 旧 PagerView 页面内同时挂载 ResumableZoom 的 tap/pinch 手势；原生 Pager 手势竞争失败，而既有 UI 用例直接调用 mock Pager 的“下一页”，没有经过真实横向手势。上游维护者也明确说明裸 ResumableZoom 与可滚动列表会发生手势冲突：[react-native-zoom-toolkit#59](https://github.com/Glazzes/react-native-zoom-toolkit/issues/59#issuecomment-2359494785)。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的单一 manual parent Pan 与 ResumableZoom 共享的 UI-thread zoom state。 |
| 必须保持的行为 | 1 倍缩放时，父级单指横向手势按距离或速度把 ring 推进一页；慢拖和快速甩动都可用，首尾不循环。纵向占优只负责下拉关闭；两指或放大后父级手势同步失败，图片 pinch/pan、双击、控制层、动态 SVG 固定 sibling 与 Android Back 均不回退。不得恢复依赖 React state 异步开关原生 Pager。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-046` 从第 2/3 张向左触发真实父级横向 `onEnd`，要求 `onSelect(2)` 且显示 `3/3`；在末页重复相同手势不得再次调用。修复前调用数为 `0`。`REG-TOPIC-095` 另固定多指所有权和转场身份。 |
| 最低可靠自动测试层 | `UI_PASS` 固定方向门禁、ring 推进和非循环边界；真实 Android 多图主题补充 native 手势竞争证据。 |
| Replay 或真实验收路径 | 使用当前可用的只读三图主题，点击首图后应立即显示 `1/3`，依次横滑到末页并返回；全程不保存图片。没有稳定对象时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除父级方向受限的 manual Pan，或让翻页依赖 React state 异步开关与 ResumableZoom 竞争，编号 UI 用例回到零次选页，设备重新停在 `1/3`。 |
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
| Replay 或真实验收路径 | Release APK 在四站 Topic 回复区按 `docs/testing-standard.md` 的评论末尾分支矩阵只读检查；同宽度截图比较普通正文左边界、签名/统计/操作栏与分隔线，确认横向缩进恢复且纵向留白未回退；从列表进入 Topic 并返回，确认原列表位置恢复。 |
| 负向验证方式 | 把左缩进恢复为 `0`、停止扣减 HTML 宽度，或误把主楼也缩窄，编号 unit/UI 用例必须失败；把纵向数值恢复到旧版本同样由同一 theme oracle 拦截。 |
| 明确不覆盖范围 | 不改变主楼、评论头部、系统事件、User 页回复卡片或 Reply composer，不重新设计响应式列宽，也不授权任何真实回复或互动写入。 |

## `REG-TOPIC-048` 适屏图显示后不渐进升级且全屏返回仍模糊

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享详情渲染 seam 回归 `TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 用户症状 | 详情与评论只能一直显示适屏图；即使全屏原图已经清晰显示，关闭预览后外层仍模糊。若直接把原图改成首个请求，长帖又会恢复慢加载、滚动期间整页抢带宽和图片尺寸跳动。 |
| 触发条件 | `displayUri/originalUri` 只在预览 catalog 中分层，块图 renderer 不消费安全原图；正文与全屏也没有按完整媒体请求 identity 共享“原图已显示”状态。 |
| 根因 seam | `src/platform/media/imagePreviewCatalog.ts` 的原图来源传递、`src/features/topic/rendering/previewRenderers.tsx` 的块图双层生命周期、`src/platform/media/originalImageLoading.tsx` 的附近门禁与进程内显示信号、`src/features/topic/components/TopicContentList.tsx` 的主楼分块范围，以及 `src/ui/media/ImagePreviewModal.tsx` 的全屏 `onDisplay` 结算。 |
| 必须保持的行为 | 适屏图仍是首个请求，并继续独占 4:3 占位、唯一 Spinner、`onLoad` 真实比例与 `onDisplay` 显示门槛。适屏图显示后，评论只依赖 FlashList 的 `720px` render window，主楼只允许同一 `720px` 范围内已测量分块以低优先级启动原图；点击图片立即使用高优先级。适屏图作为独立底层保持挂载，原图层不得接收远程 `placeholder`，只以 `150ms` 过渡绝对覆盖既有 frame；原图 `onDisplay` 后才卸载底层，失败继续保留底层，成功或分辨率差异不得改变外层几何。完整媒体 request identity（URL、cache key、headers/session）匹配的正文、评论或全屏原图只有在 `onDisplay` 后才能发布进程内 ready；全屏成功后外层复用同一 Glide 缓存或已有 SVG poster。相同 URL 不发第二次请求；后台失败没有第二错误态或循环重试，只有后续全屏成功 revision 可重新触发；复杂 SVG 后台失败不得启动 Chromium，现有全屏重试和 artifact 恢复保持不变。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/domain/forum/forumContentMedia.test.ts` 的 `REG-TOPIC-048` 固定安全灯箱/最大 `srcset` 原图传递；`src/platform/media/originalImageLoading.test.ts` 固定 `720px` 边界和完整 session identity 隔离；`tests/ui/topic/topic-image-loading.test.tsx` 固定原图不早启、低/高优先级、无远程 placeholder、`150ms`、独立底图生命周期、同 URL 去重、稳定几何、失败保留适屏图、ready 后重试与旧 epoch 隔离；`tests/ui/topic/image-preview.test.tsx` 固定全屏 `onLoad` 不发布、匹配 `onDisplay` 才发布。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：parser/纯函数固定来源与范围，RNTL 必须观察真实 Expo Image props、生命周期、几何和跨全屏信号；源码字符串、只检查 catalog 或只打开 App 都不足以证明请求顺序。 |
| Replay 或真实验收路径 | 在当前身份匹配的 App 中只读打开含主楼长图、远端评论图和 SVG 的详情：冷加载确认先适屏后附近原图；滚到长帖远段确认未到附近不启动；点开原图显示后关闭，外层应保持适屏像素且位置不跳，原图升级层可复用磁盘缓存；快速返回与原图自然失败时适屏图继续可用。不得为制造失败清 Cookie、断网或写入论坛。 |
| 负向验证方式 | 让原图在适屏图 `onDisplay` 前、主楼 `720px` 范围外或旧 session ready 后挂载，把远程适屏 URL 重新传入原图层 `placeholder`、过早卸载独立底图、移除绝对覆盖，原图失败时替换成错误态，或在后台 SVG 失败时调用 Chromium 恢复，编号 unit/UI 用例必须失败。 |
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
| 触发条件 | 旧实现让相邻栅格页以低优先级和允许下采样预热，升为当前页后切换高优先级并禁用下采样；`expo-image` 因 `allowDownscaling` 变化重新渲染同一原图，而全屏栅格分支同时配置了 `150ms` transition。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 普通栅格图分支把同一媒体的清晰度升级当成需要 cross-dissolve 的内容切换。`expo-image@3.0.11` Android 实现同时淡出旧 view、淡入新 view；在预览黑色背景上，两张相同图片的合成亮度中点约为 `75%`。 |
| 必须保持的行为 | 三槽 ring 继续只挂载当前页与相邻页；相邻页保持低优先级、允许下采样和受预算 display underlay，升为当前页后只切换高优先级，继续按显式 Native decode target 下采样。普通栅格页的初次显示及页间切换均不得配置 transition，资源就绪后原子替换；请求 source、cache/recycling identity、失败重试、缩放、控制层和关闭行为不变。远程图片不得进入 Expo placeholder decoder。正文原图覆盖层继续保留 `REG-TOPIC-048` 的 `150ms` 过渡；SVG poster/document 分支不进入本条。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `REG-TOPIC-050` 以不同 display/original URL 渲染 5 张图片，从第 3 张开始，要求当前与相邻的普通栅格 Expo Image 均没有 `transition`；推进一页后，新旧当前页仍没有 `transition`，且所有当前/相邻 raster 都保持 `allowDownscaling=true` 与 `cachePolicy=disk`。修复前收到 `transition: 150`。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 通过公开 `ImagePreviewModal` 渲染结果观察 Expo Image 系统边界 props 与真实切页状态；源码字符串测试不足以固定当前页/相邻页生命周期。 |
| Replay 或真实验收路径 | 使用当前可用的只读三图主题，以至少 `60fps` 录制 `1/3 ↔ 2/3` 往返；不得出现黑帧，并确认页码、原图、缩放、控制层和关闭。没有稳定对象时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 给普通栅格分支恢复任意正时长 transition，编号 UI 用例必须收到该值并失败；只对当前页关闭而让可见相邻页继续 cross-dissolve 也不满足 oracle。 |
| 明确不覆盖范围 | 不改变背景色、三槽预取数量、SVG 恢复、正文渐进升级或 Expo 依赖版本；不增加自定义双层图片淡入、配置项或仅能断言手势成功的固定 Replay。 |

## `REG-TOPIC-052` 全屏重复打开已显示图片仍闪 Spinner

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02` |
| 用户症状 | 同一张原图已经在全屏成功显示，关闭后再次点击，仍会短暂出现“图片加载中”并闪一下。 |
| 触发条件 | 全屏页关闭后重新挂载；共享层已经记录同一完整媒体 request identity 的 `onDisplay` 成功，但新页面仍把局部状态固定初始化为 `loading`，随后同一请求的 `onLoadStart` 又继续维持 Spinner。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 的普通栅格预览状态没有消费 `src/platform/media/originalImageLoading.tsx` 已有的进程内显示证明。 |
| 必须保持的行为 | 同一 URL、cache key、headers/session identity 已经 `onDisplay` 成功后，本进程内再次打开必须直接复用显示 revision 与现有 disk/underlay 像素，不恢复 Spinner；随后同一请求的 `onLoadStart` 也不得重新显示遮罩。内部状态、30 秒 timeout 与 diagnostics 仍保持 loading，超时必须进入失败，显式重试必须重新显示 Spinner。冷图、新 session identity 与 SVG poster 继续使用原有 loading/error 生命周期，静态 poster 仍须等本次 `onDisplay` 才撤下遮罩；显示证明受既有 512 项 LRU 限制。 |
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
| 根因 seam | `src/sources/discourse/content.ts` 的 Discourse reply quote 提取、`Reply.quotedPosts` 的完整身份、linux.do adapter、`ReplyItem` 的本地楼层复用与 `useTopicController` 的引用事件。2026-07-16 的 `REG-TOPIC-003` 只对正文构造跨主题 fixture，评论 fixture 仍是同主题；2026-07-26 抽公共 parser 时保留了该限制，因此文档承诺没有对应评论 oracle。 |
| 必须保持的行为 | 合法评论 quote 从 parser 到 Reply、UI event、Query 全程携带 `source + topicId + postNumber`，从普通 `contentHtml` 删除 aside 并显示作者、目标主题链接、简介和展开入口。只有 reference topic 等于当前 topic 时才能复用 `repliesByFloor`；跨主题只读 full-key Query cache/transport。目标标题链接仍按站内 Topic 导航，display-only 作者不得猜成 username。主楼正文 quote 继续使用独立 renderer，不与评论卡片合并。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 要求 cross-topic aside 产出 full reference 并从 HTML 移除；`tests/integration/source-read-contracts/` 与  固定 linux.do adapter；`tests/ui/topic/topic-components.test.tsx` 注入当前主题同楼层错误内容，要求默认只见跨主题简介、目标标题可内部跳转、展开只见 full-key 正确内容；`tests/ui/topic/topic-session-controller.test.tsx` 让两个引用实例指向同一跨主题 reference，要求 transport 一次、两个 instance 均展开。`REG-TOPIC-003/007/035` 继续通过。 |
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
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 在目标 Topic 已缓存时要求展开零 `getReply`，进入目标再 restore parent 后仍立即得到同一 cached reply、transport 总数不增加；`src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicContentIdentity.test.ts` 以两个不同 commentId 但相同 floor/reference 的回复要求 key 与 expanded 状态隔离，并要求重复 build 复用同一 content 对象；`tests/ui/topic/topic-reply-filters.test.tsx` 要求超长引用生成多个稳定父列表 rows、顺序不变、折叠只去除内容且分隔值为 0/8/10/12；`tests/ui/topic/topic-components.test.tsx` 固定头像 fallback、长作者/标题行数和携带 reply identity 的 callback；`src/platform/media/imageRequestSource.test.ts`、`src/platform/media/imagePreviewCatalog.test.ts`、`src/domain/forum/forumContentMedia.test.ts`、`src/platform/media/inlineMedia.test.ts`、`tests/integration/style-ownership.test.ts` 固定 inline 头像与触控/间距样式。修复前缓存二次展开仍出现约 433.6ms 最慢帧和约 2874 个 helper 节点。 |
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
| 明确不覆盖范围 | 不改变 ReaderData schema/version，不迁移 Cookie、代理、密码或 NodeImage API Key，也不保留远端展示 query。 |

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
| 触发条件 | 目标文件名包含版本身份，但新下载前未清理旧更新文件，或 catch 路径未清理已经准备的下载目标。 |
| 根因 seam | `useAppUpdateRuntime.downloadAppUpdate` 的 cache target 与失败清理。 |
| 必须保持的行为 | 当前 target 由可信 manifest 的 versionCode/SHA 唯一确定；新下载前只删除 legacy `wz-update.apk` 和旧的合法更新 target，不碰无关 cache 文件；失败或取消后删除当前 partial，成功后保留给系统安装器读取。 |
| 精确失败 oracle | `src/platform/update/useAppUpdateRuntime.test.ts` 的 `REG-UPDATE-005` 让目录同时包含 legacy、旧版更新 APK 和无关文件，要求只清前两者并保留成功 target；失败要求再次幂等删除当前 partial、零安装。 |
| 最低可靠自动测试层 | `UNIT_PASS`：mock FileSystem 与 installer 精确观察 target、删除次数和成功/失败顺序。 |
| Replay 或真实验收路径 | APK 下载与安装属于发布风险操作，本轮保持 `NOT_VERIFIED`；只有明确授权后检查 cache 与系统安装确认。 |
| 负向验证方式 | 移除旧文件筛选、误删无关文件或移除 catch 清理，编号测试必须看到遗留文件、越界删除或少一次 partial 删除。 |
| 明确不覆盖范围 | 不自动删除安装器正在读取的成功 APK，不下载真实 release，不改变签名/hash 校验。 |

## `REG-UPDATE-006` App 内新版仍打开上一版安装包

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-04` |
| 用户症状 | App 已检测并显示新版本，下载后 Android 安装确认仍提示上一版；同一 Release 由浏览器直接下载时正常。 |
| 触发条件 | 不同内容的连续 Release 都覆盖固定 `wz-update.apk`，使 FileProvider 对系统安装器暴露相同 URI。 |
| 根因 seam | `useAppUpdateRuntime.downloadAppUpdate` 的文件身份与 `ApkInstallerModule.installApk` 的 FileProvider URI。 |
| 必须保持的行为 | 不同 versionCode/SHA 的 APK 必须得到不同 cache 路径，从而得到不同安装器 URI；既有包名、版本、SHA 与 signer 校验顺序不变。 |
| 精确失败 oracle | `src/platform/update/useAppUpdateRuntime.test.ts` 的 `REG-UPDATE-006` 连续下载两个不同 Release，要求 `createDownloadResumable` 收到两个不同且由 versionCode/SHA 派生的 target；恢复固定文件名时集合大小从 2 退化为 1。 |
| 最低可靠自动测试层 | `UNIT_PASS`：真实 runtime hook 配合 FileSystem/installer mock，观察交给 Native 安装边界的文件 URI。 |
| Replay 或真实验收路径 | 新 Release 构建后，在受影响设备由 App 内更新入口下载，系统确认页必须显示目标 versionName/versionCode；发布前无法用当前最新版本自更新时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复固定 `wz-update.apk`，`REG-UPDATE-006` 必须失败；浏览器直下不能替代 App 内入口。 |
| 明确不覆盖范围 | 不清系统安装器数据，不卸载 App，不降低签名/hash 校验，也不假定所有 OEM 都以同样方式缓存 URI。 |

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
| 根因 seam | `src/sources/discourse/content.ts` 的 cooked-HTML 协议边界、`compileForumContent()` 的一次性 fold 解释，以及 `TopicSplitDisclosureStore` 的唯一展开状态 owner。 |
| 必须保持的行为 | 两站在 sanitizer 的同一次 DOM parse 中识别首段开头、大小写不敏感的 `[!type][+/-]`；支持 13 个主类型及 alias、未知类型 Note 回退、富文本标题、无正文、100 层 Callout 上限、嵌套和普通引用混排。转换前清除来源伪造的 `data-forum-callout-*` 与 `forum-callout-*` class，canonical 根仍为 `blockquote`。compiler 只从 source `fold` 产出一次 `defaultExpanded`；route-scoped split disclosure store 唯一持有展开状态并过滤 body rows，`ForumCallout` 是完全受控的 header renderer，不持有 body、fallback state 或第二份 fold。普通引用与非 Discourse 内容继续默认渲染。tone 只取 App theme，来源颜色/style/CSS/JS 不可信。`-` 初始收起、`+` 初始展开，隐藏正文不进入父列表；可折叠 header 至少 48dp、暴露 expanded 状态、100ms layout transition 遵循 Reduce Motion，标题链接阻止折叠冒泡。主题、回复、同/跨主题引用、采纳答案和超长分块使用同一 renderer；Topic/Search/UserActivity/引用简介不泄漏 marker。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 首个 tracer 用例在修复前得到原样 `<blockquote><p>[!warning] ...`，要求 marker 消失并生成 canonical title/content；其矩阵固定类型、alias、大小写、未知回退、富文本、折叠、嵌套、复杂正文、深度和伪造属性。`tests/integration/html-sanitization-contracts.test.ts` 固定两站单 parse 与普通 HTML fast path；`src/sources/discourse/model.test.ts`、两站 adapter 测试固定摘要清理。`tests/ui/shared/forum-callout.test.tsx` 固定完全受控的 light/dark header、48dp、expanded、Reduce Motion 与标题链接；`tests/ui/topic/topic-split-disclosure.test.tsx` 通过真实 typed header/store 固定收起时 body rows 卸载。`tests/ui/topic/topic-components.test.tsx` 固定 Callout/普通引用分流和非 Discourse 负例。`REG-TOPIC-003/053/054/055` 继续固定正文/评论引用、跨主题身份、分阶段长引用和返回链。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：DOM 协议矩阵与真实 Native component/共享 renderer 同时覆盖；只查输出字符串、单一 warning 颜色或 App 能启动不能证明完整入口与交互。 |
| Replay 或真实验收路径 | 按当前 revision/bundle 直达 `https://linux.do/t/topic/342888/1`，核对 warning、caution、tip、check、todo、danger、链接、图片、列表、嵌套、浅/深色和大字体；再直达 `https://linux.do/t/topic/2685882` 展开目标评论引用，Loading 时 Android Back 可立即返回，重进使用现有 Query cache。普通 blockquote 作负向对照；全程只读，不发帖、编辑、上传、投票或探测网络。动态第三方主题不进入 tracked Replay。 |
| 负向验证方式 | 删除 normalizer、恢复 Topic 局部 blockquote override、信任来源 canonical attr/style、只处理 warning、让非 Discourse 来源进入 renderer，或折叠时继续挂载正文，编号协议/UI 测试必须分别出现 marker、错误分流、伪造语义或隐藏内容。 |
| 明确不覆盖范围 | 不增加 Callout 创作工具栏、站点管理员动态类型、运行时 CSS/JS 抓取、来源配色、Query/cache/WebView 或新依赖。 |

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

## `REG-TOPIC-059` 无关 Topic 状态变化重挂载已显示富媒体

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 用户症状 | 正文图片加载完成后，打开全屏预览再返回会闪回灰色占位；评论引用或评论展开/收起时，已显示图片短暂出现 Spinner，inline emoji、贴纸和其他 HTML 富媒体也会消失后重现。 |
| 触发条件 | `TopicRoute` 的预览、导航、引用、筛选或其他本地状态变化产生新的动作回调身份；这些身份进入 `htmlRenderers` memo 依赖后创建新的自定义 renderer 函数组件。 |
| 根因 seam | `src/features/topic/rendering/useHtmlRenderingController.tsx` 的动作代理与 renderer registry 生命周期，以及 `react-native-render-html` 以 renderer 函数作为 React 组件类型的消费方式。 |
| 必须保持的行为 | renderer registry 只随 Topic/source、媒体 session identity、主题、字号、User-Agent、WebView 策略等真实渲染配置变化；预览、评论、引用、查找、筛选和动作状态只能更新稳定代理背后的最新 handler，不能改变已挂载的 block image、inline image/emoji、静态/视频贴纸、视频、链接卡片、iframe/WebView 或 Callout renderer 类型。点击图片、站内 Topic/User 和外链仍使用最新 Topic 基准 URL 与最新 handler。切换 Topic/source、媒体 epoch 或真实渲染配置时仍必须重建并拒绝旧请求迟到落地。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 的 `REG-TOPIC-059` 首先让正文图片完成 `onLoad + onDisplay`，只替换预览 action；修复前立即重新出现一个 `ActivityIndicator`，修复后加载态不回退且点击只调用最新 action。后续用例同时替换四类动作和 Topic 链接上下文，要求共享 renderer registry 保持同一引用，并使用最新 handler、相对链接基准 URL 与 User 候选；参数化反向用例要求 Topic/source、主题、字体、字号、行高、User-Agent 和 WebView 策略变化时 registry 重建。既有 `REG-ACCOUNT-029` 同文件用例继续要求媒体 epoch 变化时 image/video request identity 与 renderer 真正更新。 |
| 最低可靠自动测试层 | `UI_PASS` + `STATIC_PASS`：RNTL 必须完成真实 renderer 挂载、图片显示结算和父级 rerender；只断言 `useMemo` 依赖、缓存命中或 App 能启动不能证明用户可见媒体连续性。 |
| Replay 或真实验收路径 | 在匹配 revision/bundle 的 90Hz Android 设备直达 `https://linux.do/t/topic/2693802`，等待正文图和目标评论 emoji 显示后，图片打开/返回两次、评论引用展开/收起两次，并逐帧检查原区域；不得出现灰色占位、Spinner、图片或 emoji 消失。正文引用使用具备前置内容的当前样本或确定性 UI fixture；动态第三方 Topic 不写入 tracked Replay。全程只读，不清数据、Cookie 或登录态。 |
| 负向验证方式 | 把原始 `onOpenImagePreview` 或由 Topic/User/external handler 创建的非稳定 `openHtmlLink` 恢复到 renderer memo 依赖，编号测试必须在 rerender 后重新看到 Spinner或 registry 身份变化；把 registry 永久冻结到媒体 epoch 变化也不更新，则既有 session 测试必须失败。 |
| 明确不覆盖范围 | 不新增全局“已加载”缓存、淡入动画、延迟占位、Context 重写或测试专用产品钩子；图片冷加载、原图渐进升级、SVG fallback、列表虚拟化和全屏 Pager 生命周期仍由既有回归负责。 |

## `REG-TOPIC-060` NodeSeek 后续页首条回复被当作主楼过滤

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；共享 `NOTIFY-02` |
| 用户症状 | NodeSeek 后续分页会缺少该页第一楼；消息通知恰好指向这一楼时，主题内存在正文，但消息详情显示“消息不可见”。 |
| 触发条件 | 读取 NodeSeek 第 2 页及以后由 `.content-item` 回复组成的 rendered HTML，目标回复位于页面第一项。 |
| 根因 seam | `src/sources/nodeseek/topicParser.ts` 的 `parseRenderedNodeSeekTopicHtml` 无条件把首个 `.content-item` 当作主楼过滤，`src/sources/nodeseek/reader.ts` 未把当前页码传入 parser。 |
| 必须保持的行为 | 首屏仍排除主楼；后续页首项带真实楼层或 `commentId` 时必须作为回复保留，并保持楼层、稳定 `commentId` 与页面顺序。后续页首项无法识别时继续保守视为主楼。NodeSeek 消息详情以通知返回的 `comment_id` 精确命中；“查看完整主题”把同一稳定身份交给现有 Topic route，目标未加载时静默读取后续页并定位，同楼层实体不得抢占。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-060` 在 page 3 构造 `#21/#22`；修复前只返回 `#22`，修复后依次返回 `#21/#22`。既有 `REG-TOPIC-036` 必须继续排除后续页中未编号的重复主楼；`src/sources/nodeseek/notifications.test.ts` 固定通知按 origin page 读取且以 `comment_id` 命中，即使楼层元数据不一致也不得误取。 |
| 最低可靠自动测试层 | `UNIT_PASS`：共享 source contract 固定 parser 与 reader 页码契约，adapter 单测固定通知目标身份；源码字符串或只验证快捷跳转不能证明正文可见。 |
| Replay 或真实验收路径 | `tests/device/notifications-readonly.ad` 只固定 NodeSeek 列表合法结算；匹配 revision/APK 且当前账号有消息时，手动打开 NodeSeek 第一条已读消息，详情应显示目标正文和“查看完整主题”，不得出现“详情暂不可用”。普通主题后续页同时确认第一楼未丢失。全程只读，不清数据、Cookie 或登录态。 |
| 负向验证方式 | 恢复首项无条件过滤、停止传递页码、按楼层替代存在的 `comment_id`，或只隐藏失败态，编号测试必须失败或只读 Live 再现“消息不可见”。 |
| 明确不覆盖范围 | 不新增消息专用解析器或第二套主题页；定位复用既有 Topic route 和回复分页，不承诺原站不存在目标时伪造定位。真实标记已读属于原站写入，未获授权保持 `NOT_VERIFIED`。 |

## `REG-TOPIC-061` 妖火回复目标楼层和作者丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 妖火主题的回复正文正常显示，但原站“回复 88 楼”的关系被丢弃；例如 90 楼明确回复当前用户，App 内既看不到目标楼层，也看不到被回复人。 |
| 触发条件 | 妖火回复行通过 `.reother a[href*="tofloor="]` 指向另一楼层；目标楼可能位于当前响应，也可能位于其他页。 |
| 根因 seam | `src/sources/yaohuo/topicParser.ts` 只提取作者和正文，丢弃原站 `tofloor` 关系；共享 `Reply` 又只允许作者字符串，无法独立表达“只知道楼层”或“楼层与作者均已确认”。 |
| 必须保持的行为 | `Reply.replyTarget` 以 `{ floor, author }` 表达关系，`author` 只在协议明确提供或目标楼已存在于同一响应时补全；妖火同页目标显示“回复 @作者 · #楼层”，跨页目标显示“回复 #楼层”，不得为补作者增加请求。linux.do 保留 Discourse 的 `reply_to_post_number` 与明确 username，只有 display label 时可显示但不可猜测导航；V2EX mention 继续作为 author-only 目标。真实引用仍只进入 `quotedPosts`，不得把回复关系伪装成引用正文。 |
| 精确失败 oracle | `src/sources/yaohuo/parser.test.ts` 的 `REG-TOPIC-061` 固定 90 楼指向同页 88 楼并补全稳定妖火用户 ID，同时固定跨页 30 楼只保留 floor；`tests/ui/topic/topic-components.test.tsx` 要求渲染两种标签、稳定用户目标可进入 App User route、floor-only 不触发用户导航。`src/sources/discourse/model.test.ts` 与 `tests/integration/source-read-contracts/` 分别固定 Discourse/V2EX 的结构化迁移。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：parser 必须证明协议关系没有丢失，RNTL 必须证明用户可见标签和导航门禁；正文字符串包含楼层或源码存在 selector 不能替代。 |
| Replay 或真实验收路径 | 在匹配 revision/bundle 的已登录 App 中，从 More → 消息通知 → 妖火打开已读的“Clover 回复了你的回复”，点击“查看完整回复”进入目标主题；90 楼应显示“回复 @流金岁月 · #88”。全程只读，不清数据、Cookie 或登录态。 |
| 负向验证方式 | 删除 `.reother` 解析、恢复 author-only 平铺字段、把关系并入 `quotedPosts`，或为跨页作者线性抓取其他页，编号 parser/UI 测试必须失败。 |
| 明确不覆盖范围 | 不预取目标楼所在页、不线性遍历历史页、不新增楼层详情路由，也不执行回复、点赞等真实写入。 |

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

## `REG-OPS-017` Android Smoke 强制无窗口启动模拟器

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 执行 Android Smoke 时模拟器只在后台启动，操作者看不到设备画面，无法监督首次启动和后续 Replay。 |
| 触发条件 | 目标 AVD 尚未启动，`withSmokeSession` 调用 `agent-device boot` 时显式传入 `--headless`。 |
| 根因 seam | `scripts/smoke-android.mjs` 覆盖了 agent-device 默认的 GUI 启动行为。 |
| 必须保持的行为 | Smoke 继续使用显式设备和唯一 `wz-apk-sanity` session，但 boot 不得传入 `--headless`；由 Smoke 启动的本机 Android Emulator 必须创建可见窗口。不得为转换窗口模式重启已有设备、清 App 数据、Cookie 或登录态。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-017` 通过真实 `withSmokeSession` 记录 boot 参数，并断言其中不存在 `--headless`；`REG-OPS-014` 同时固定 boot、sanity 和 close 的既有顺序。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定真实 runner 参数；本机从关机态执行默认 `agent-device boot` 后，还需确认目标 AVD booted 且 Windows Emulator 窗口可见。该窗口证据不等于 `APK_SANITY` 或 `DEVICE_REPLAY_PASS`。 |
| Replay 或真实验收路径 | 在不关闭共享设备、不清数据的前提下，从关机态启动主 AVD，确认 Emulator GUI 可见且未最小化；正式 APK Smoke 仍只在明确发布验证中执行。 |
| 负向验证方式 | 给 Smoke boot 恢复 `--headless`，编号测试必须失败并输出包含该参数的实际命令。 |
| 明确不覆盖范围 | 不自动重启已经由外部流程以 headless 模式启动的 AVD，不改变 Replay、录屏、签名、APK 安装或 release 上传流程。 |

## `REG-OPS-018` 正常代码更新误用 agent-device reinstall 重置主 AVD App 数据

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02`；共享 `ACCOUNT-01/02/04` 与 `DATA-01/02/03` 的登录态、凭据和本机数据保留边界 |
| 用户症状 | 为查看最新构建而安装 APK 后，主模拟器账号中心从已有登录变成全部未登录，本机数据看似被重置；后续普通启动载入旧 Quick Boot 状态后登录又出现，造成“数据已永久丢失”和“Cookie 自己恢复”的相互矛盾判断。 |
| 触发条件 | 在已安装 `com.wz.reader` 的保留数据 AVD 上执行 `agent-device reinstall com.wz.reader <apk>`，随后在没有先冻结和复制 AVD 的情况下继续启停模拟器或操作快照。 |
| 根因 seam | `agent-device 0.20.6` 的 Android `reinstall` 会先执行不带 `-k` 的 `adb uninstall`，再安装 APK；帮助文案 “Replace installed app” 没有承诺保留数据。仓库 Smoke 本来使用安全的 `install`，但临时人工命令绕过了该边界；看到账号全部未登录后又把 UI 当成永久丢失证据，在证据不足时操作 Quick Boot，扩大了诊断风险。 |
| 必须保持的行为 | 主登录态 AVD 是日常更新代码和保留登录态验收的目标设备，必须支持反复就地覆盖安装；现有独立未登录 AVD 只服务未登录旅程，不能替代主 AVD 更新或作为安装失败后的清数据兜底。正常更新只允许仓库 `npm run smoke:android`、`agent-device install ...` 或带明确 serial 的 `adb install -r`，安全安装失败必须停止，禁止自动改用 reinstall/uninstall/pm clear。仓库 Smoke 的 boot、install、open 与 close 必须使用同一显式 session。`runApkSanity` 必须按 pre `dumpsys package com.wz.reader` → 单次 replacement install → post `dumpsys` 执行：pre 必须解析出唯一非空 `firstInstallTime`，否则 install 为 0；install 局部捕获错误且无论成功失败都执行 post；post 读取异常、值缺失/重复或与 pre 不同，必须优先归一为 `BLOCKED_BY_ENV`，不泄露原始 dumpsys 输出，并在首次 open、Replay 及 date/marker/logcat 采集前冻结；只有 post 与 pre 相同后才报告原安装错误。成功路径只读取两次 dumpsys，再继续既有首次启动流程。若账号、本机数据或安装时间异常，立即冻结现场，不再启停 AVD 或保存、加载、删除快照；先只读记录包时间、AVD/serial、进程启动参数、`quickbootChoice.ini` 与 `snapshot.trace`。UI 账号数量不能独立证明永久丢失或恢复；快照恢复需用户单独授权，并在修改前有已完成且校验过的离线 AVD 副本。只有会卸载 target App 的 instrumentation 等特殊流程才使用一次性空白 AVD。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-018` 经公开 `runApkSanity` 固定真实命令顺序与失败优先级：pre 为空、重复或读取抛错时 install=0；安装成功后的 post 缺失、重复、变化或读取抛错，以及安装失败后的 post 缺失、重复、变化或读取抛错时，包读取=2、install=1、date/marker/open/logcat=0，错误不含原始输出 marker；post 相同但安装失败时保留既有归一化安装错误；成功时 install 前后恰两次 dumpsys，随后才读取时间戳并首次 open。结构 guard 继续禁止 `uninstall`、`reinstall`、`pm clear`，并固定 boot、install、open、close 使用同一个 `wz-apk-sanity` session。项目 `AGENTS.md`、`docs/operator-runbook.md` 与 `docs/testing-standard.md` 列出一致的允许/禁止命令及现场冻结顺序。2026-08-08 事故的只读判据为：误操作后安装时间曾变化；下一次普通启动的 `snapshot.trace=load_succeeded`，且 `firstInstallTime` 与 `lastUpdateTime` 同时回到卸载前，因而证明是整机快照状态回滚，不是 Cookie 续签或重新登录。 |
| 最低可靠自动测试层 | `UNIT_PASS + STATIC_PASS`：Vitest 行为测试通过公开 seam 固定 pre/install/post 顺序、一次安装、两次读取和失败优先级；结构与文档 guard 固定破坏性命令、显式 session、编号和引用。任意人工 CLI 无法由仓库测试拦截，因此仍由项目级高风险命令边界约束。 |
| Replay 或真实验收路径 | 未来在保留数据 AVD 上执行 APK sanity 时，安装前后记录同一个包的 `firstInstallTime` 并要求不变，再进行只读账号与本机数据检查；不得通过真实 uninstall/reinstall 复现本事故。状态异常时本轮验收立即终止并按冻结流程报告。 |
| 负向验证方式 | 删除或移动 pre/post、接受空值或重复值、让 `runAdbCommand` 原始异常/输出外泄、在 post 前抛安装错误、把 post 移到首次 open/Replay 之后，或增加 install/dumpsys retry，编号行为测试必须失败；改用 `reinstall/uninstall/pm clear` 则结构 guard 必须失败。设备侧不执行破坏性负向测试；人工流程若建议在安全安装失败后改用 reinstall、只凭账号全部未登录定性或无离线副本操作快照，视为违反本条。 |
| 明确不覆盖范围 | 本条不提供任意 shell 命令的系统级拦截，不保证卸载后数据可恢复，也不把 Quick Boot 当备份系统；已存在但未完成校验的拷贝不能作为恢复依据。 |

## `REG-OPS-019` booted emulator ID 被当成 AVD 名导致 Smoke 无法启动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 主 AVD、APK SHA、版本和安装时间均已精确匹配，但设置 `WZ_ANDROID_SMOKE_DEVICE=emulator-5554` 后，Smoke 在安装前报不存在名为 `emulator-5554` 的 AVD，`APK_SANITY` 与七条 Replay 均未执行。 |
| 触发条件 | 使用已启动 Android emulator 的 agent-device ID 作为 Smoke selector。 |
| 根因 seam | `withSmokeSession` 把同一个原始 selector 同时用于不同契约：ADB/Replay 接受 booted device ID，`agent-device boot --device` 则需要 AVD 名。 |
| 必须保持的行为 | 只有形如 `emulator-<port>` 的 selector 在 boot 前执行一次只读 `adb -s <id> emu avd name`，取得 AVD 名后启动既有 `wz-apk-sanity` session；原 selector 继续用于安装后的设备身份解析和 Replay。AVD 名与显示名仍直接传给 boot，不能新增模糊匹配、重试、设备切换或持久状态。AVD 名无法读取时必须在 boot/install 前 `BLOCKED_BY_ENV`。 |
| 精确失败 oracle | `tests/tooling/android-smoke-guard.test.ts` 的 `REG-OPS-019` 经公开 `withSmokeSession` 输入 `emulator-5554`，ADB 返回 `WZ_Pixel_API_35`；修复前 boot 收到 raw serial，修复后事件顺序必须为一次 AVD 名读取 → 以 `WZ_Pixel_API_35` boot → sanity action → close。空输出、仅 `OK`、`KO:` 和 ADB 抛错四类反例必须得到同一不含原始 marker 的通用错误，且 boot/action/close 调用均为 0。 |
| 最低可靠自动测试层 | `UNIT_PASS + APK_SANITY + DEVICE_REPLAY_PASS`：Vitest 固定 selector 契约与 session 顺序；只有匹配 APK 的主 AVD 正向 Smoke 能证明真实 agent-device/ADB 链路继续完成。 |
| Replay 或真实验收路径 | 在身份、版本、APK SHA 和 `firstInstallTime` 精确匹配的主 AVD 上设置 booted emulator ID，运行一次 `npm run smoke:android`；安装时间必须不变，并依次得到 `APK_SANITY` 与七条 Replay 的 `DEVICE_REPLAY_PASS`。不得为负向验证改名、创建重复 AVD 或清数据。 |
| 负向验证方式 | 删除 emulator ID 到 AVD 名的转换，编号测试必须重新看到 boot 收到 `emulator-5554`；真实设备不执行失败重放。 |
| 明确不覆盖范围 | 不支持把物理设备 serial 当作可启动 AVD，不启动未知设备，不修改 AVD 名，不处理 agent-device daemon 生命周期，也不改变 Replay 的 ID/显示名/下划线空白等价规则。 |

## `REG-NOTIFY-001` 前台恢复旧未读被误报为新消息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享 More 底部消息圆点与消息入口 |
| 用户症状 | 打开 App 或进入 More 时，页面底部出现带 App 图标、厚胶囊背景和阴影的“有新的站内消息”；它与扁平列表和底部消息圆点重复，且已有未读也被误报成刚收到的新消息。 |
| 触发条件 | notification runtime 从本机恢复 `unreadCount > 0`，首次启用/重新启用建立 baseline，或消息中心可见时刷新已有未读。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 若只比较未读计数就无法区分旧未读与新稳定 ID，并可能把恢复值交给全局 `notify`。 |
| 必须保持的行为 | 本机恢复、首次/重新启用和换号 baseline 只更新 More 圆点、入口摘要与投递水位，不弹原生 Toast，也不补发旧系统通知；baseline 建立后发现的新稳定 ID 无论当前前台页面都按 `REG-NOTIFY-018/025` 发 Android 每站摘要。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 从存储恢复 NodeSeek `unreadCount=1`，要求 runtime 仍公开 `unreadTotal=1` 且 `ToastAndroid.show` 调用为 0；修复前精确收到一次“有新的站内消息”。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 执行真实 runtime effect 与持久化恢复；源码字符串或只看 More 文案不能证明原生 Toast 未出现。 |
| Replay 或真实验收路径 | 匹配 APK 覆盖安装且保留现有未读，冷启动后进入 More；入口继续显示“有未读”，底部只保留 More 消息圆点，不得出现原生 Toast。全程只读。 |
| 负向验证方式 | 恢复未读计数增量 effect、从持久化恢复路径调用全局 `notify`/系统通知，或改用另一条带装饰的悬浮提示，编号测试或设备验收必须失败。 |
| 明确不覆盖范围 | 不改变其他业务操作的短反馈，不新增自定义 Snackbar、动画、图标或依赖；新稳定 ID 的前后台 Android 系统摘要由 `REG-NOTIFY-018` 固定。 |

## `REG-NOTIFY-002` 消息与代理入口缺少分隔线

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享 More 工具列表 |
| 用户症状 | More 中“消息通知”和“服务器代理”连续显示且没有分隔线，两项在视觉上粘成一块。 |
| 触发条件 | More 同时渲染消息通知与服务器代理两个相邻入口。 |
| 根因 seam | `src/features/more/components/MoreUtilityPanels.tsx` 的工具组只有组末边框和行间距，没有组内分隔。 |
| 必须保持的行为 | 两项之间显示使用 `theme.line` 的 hairline；浅色与深色主题均可辨认，入口文案、点击区域、无障碍标签、导航和组间距保持不变。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 要求 `more-notifications-row` 的扁平化样式同时使用当前 `theme.line` 和 `StyleSheet.hairlineWidth`；修复前该行没有分隔容器，硬编码彩色线也会失败。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 固定真实 More 渲染中的组内分隔样式。 |
| Replay 或真实验收路径 | 匹配 APK 覆盖安装后打开 More，确认消息通知与服务器代理之间有一条细分隔线且两个入口仍可独立点击；全程只读。 |
| 负向验证方式 | 删除边框、改成仅浅色可见的硬编码颜色，或用卡片、pill 取代细分隔线，编号测试或设备验收必须失败。 |
| 明确不覆盖范围 | 不重排 More、不修改其他工具组，也不增加共享 divider 抽象、动画或新依赖。 |

## `REG-NOTIFY-003` 消息页原生顶栏出现悬浮阴影

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享 `NAV-01` native stack header |
| 用户症状 | 消息页标题栏底部出现明显灰黑渐变阴影，像悬浮层压在来源筛选上，与项目扁平列表不一致。 |
| 触发条件 | Android 打开消息列表、消息详情或消息通知设置等 `headerShown: true` 的 native stack route。 |
| 根因 seam | `src/app/AppNavigator.tsx` 依赖 native stack 默认 header elevation，根 `screenOptions` 未关闭 header shadow。 |
| 必须保持的行为 | 可见 native header 使用零阴影、零 elevation；安全区、返回、标题、设置入口、转场和列表工具栏原有 hairline 保持不变，深浅主题一致。 |
| 精确失败 oracle | `tests/ui/app/app-navigator.test.tsx` 打开真实 Notifications 和 NotificationSettings route，要求原生 header host config 的 `hideShadow=true`；修复前该属性为 `undefined`。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 固定共享 native-stack 配置；视觉结果另由匹配 APK 的设备验收确认。 |
| Replay 或真实验收路径 | 匹配 APK 覆盖安装后从 More 打开消息通知，再打开设置并返回；标题栏与来源筛选之间不得出现渐变或悬浮阴影。全程只读。 |
| 负向验证方式 | 删除或启用 header shadow，编号测试必须失败；用页面内遮罩覆盖阴影不能满足共享 header 配置。 |
| 明确不覆盖范围 | 不自定义 header，不改标题栏高度、字体、来源筛选、消息列表或主题色，也不新增依赖。 |

## `REG-NOTIFY-004` 消息栈硬件返回被 App 根处理器截获

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`；共享 `NOTIFY-01/02/03` |
| 用户症状 | 在消息列表、详情或设置按 Android 返回键时，没有按 native stack 返回上一层，而是被 App 根返回逻辑送回 Feed。 |
| 触发条件 | 当前 route 是 `Notifications`、`NotificationDetail` 或 `NotificationSettings`，App 级 `hardwareBackPress` 仍只识别旧的 Topic/User/ReadingSettings 例外。 |
| 根因 seam | `src/app/appNavigation.ts` 的 native-stack route 分类与 `src/app/useAppBackHandler.ts` 的返回所有权。 |
| 必须保持的行为 | 所有 native stack route 都把硬件返回交给 React Navigation；底部 tab 页面才允许 App 根逻辑返回 Feed。消息列表、详情、设置的物理返回顺序与标题栏返回一致。 |
| 精确失败 oracle | `src/app/AppNavigator.test.ts` 的 `REG-NOTIFY-004` 逐一把 Topic、User、Notifications、NotificationDetail、NotificationSettings 和 ReadingSettings 设为当前 route，要求 `isNativeStackScreen()` 为 true；More tab 必须为 false。修复前三个消息 route 被归为普通 tab。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯 route 分类固定 App handler 所有权，AppNavigator RNTL继续固定消息栈可达；只检查页面能打开不能证明硬件返回没有被截获。 |
| Replay 或真实验收路径 | 匹配 APK 从 More 依次进入消息列表、设置并返回，再从一条只读已读消息进入详情并按物理返回；每次只退一层且最终回到 More。未执行匹配 APK 路径时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 从 `isNativeStackScreen` 删除任一消息 route，或恢复按聚合 `screen` 判断，编号测试必须失败，设备上物理返回会跳离消息栈。 |
| 明确不覆盖范围 | 不改变手势返回、转场、标题栏按钮或底部 tab 历史；不为消息页创建第二套 BackHandler。 |

## `REG-NOTIFY-006` 非终态访问不可用被当作退出清除消息状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`NOTIFY-01/03` |
| 用户症状 | 登录 surface barrier、旧 unknown 记录或 Cloudflare challenge 期间，某站消息缓存、去重水位和通知摘要被当作退出清空；恢复同一账号后旧未读可能闪失或被重新投递。 |
| 触发条件 | runtime 把“当前不可读取”直接投影成 `identityKey=undefined`，混淆了 retained identity 与本轮 private access 资格。普通账号核对 activity 也曾错误关闭 active source。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 的可信 identity 投影、active source 门禁和身份变化清理 effect。 |
| 必须保持的行为 | confirmed 身份在 `isVerifying` 及临时检查失败时继续 active；检查不改变 identity、Query 或水位。若当前确为 unknown、auth-surface barrier 或 challenge，则可沿用上一份可信 `source:userId` 绑定 cache/watermark，但暂停新私有读取且不渲染 retained row。只有明确 anonymous/退出或已确认的新 identity 才按站撤销摘要并清 Query/水位；其他站不受影响。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-PERF-019` 固定 confirmed + `isVerifying` 仍可用；`tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-006` 从存储恢复 `nodeseek:42`、cache 和 watermark，再给 true unknown，要求 retained 状态不被清且零 fetch。相邻用例固定 confirmed 换号/明确退出才清理。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 执行真实 runtime/store/Query effect；只测试纯 identity helper 或只断言零请求不能证明缓存和水位未被删除。 |
| Replay 或真实验收路径 | 不人为制造 challenge、退出或换号。只在更多页手动刷新时确认同一 confirmed 账号消息入口不消失；true unknown/barrier 无自然前置时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 让 `isVerifying` 移除 active source、unknown 时删除 identity/cache/watermark、让 retained identity 继续发私有请求，或把不可用 UI 映射为明确退出，编号测试必须失败。 |
| 明确不覆盖范围 | true unknown/auth-surface barrier 不允许发私有请求或执行已读写入；headless worker 遇到 401 只停止本轮，不用 retained key 写 canonical Account。 |

## `REG-NOTIFY-007` 旧账号消息详情使用新账号读取和已读

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`NOTIFY-02` |
| 用户症状 | 从账号 A 的列表进入消息详情后切到账号 B，旧条目可能通过 B 的 session 加载正文或提交已读，造成串号读取和写入。 |
| 触发条件 | `NotificationDetail` route 只携带 notification item，或详情/全部已读开始后只沿用 runtime 当前 identity；账号在 gateway 等待 access 的窗口内变化或 route unmount 时，旧调用仍可能进入新账号 adapter。 |
| 根因 seam | `src/ui/navigation/appRouteTypes.ts` 的详情 route identity、`src/features/notifications/NotificationRoute.tsx` 的 Query/mutation `AbortController` 生命周期，以及 `src/sources/notificationGateway.ts` 在 adapter I/O 前的 expected identity 门禁。 |
| 必须保持的行为 | 点击列表时把当时的 `identityKey` 与条目一起绑定到 route，并把该 expected identity 与 route-owned `AbortSignal` 传给 `loadDetail`、`markRead` 和单站 `markAllRead`。gateway 完成 `readAccess` 后、调用 adapter 前必须再次检查 signal 与 exact identity；换号或 unmount 立即 abort 在途 access/详情/已读。mismatch 时隐藏旧详情、提示账号状态已变化、不提供重试，且三个 adapter 方法均为零调用。 |
| 精确失败 oracle | `src/sources/notificationGateway.test.ts` 分别让 `loadDetail`、`markRead`、`markAllRead` 的 expected identity 与刚读取身份不一致，要求抛“账号状态已变化”且 adapter 为零；延迟 `readAccess` 后 abort 的用例要求 `AbortError` 且 adapter 为零。`tests/ui/notifications/notifications-route.test.tsx` 的 `REG-NOTIFY-007` 固定初始 mismatch；相邻两个在途换号用例在 markRead/markAllRead 等待 access 时切到 next-account，要求旧 adapter 写入均为零。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：gateway 单测固定最后发网门禁与取消，Route/provider RNTL 固定 identity signature 变化、controller 生命周期和可见错误态；只给 Query key 加 identity 或只测 Screen 不能证明在途写入被阻断。 |
| Replay 或真实验收路径 | 换号属于外部身份变化，不在主登录设备为此测试。另获明确授权时用两个测试账号执行 A 列表→切 B→返回旧详情，确认零网络/零已读；否则记 `NOT_VERIFIED`。 |
| 负向验证方式 | 从 route params 删除 identity、以 runtime 当前 key 重建详情 Query、允许 mismatch 时 refetch、只在 React 层检查而让 gateway 接受当前账号，或换号/unmount 不 abort controller，编号及相邻 gateway/route 测试必须失败。 |
| 明确不覆盖范围 | 不迁移旧详情到新账号、不自动返回列表、不新增跨账号缓存，也不承诺撤销原站已经确认完成的写入；这里固定的是 adapter 发网前的最后可控门禁与合作式取消。 |

## `REG-NOTIFY-008` 系统通知失败仍消耗投递 ID

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03` |
| 用户症状 | 新消息已经写入 delivered IDs，但 Android 摘要创建失败；后续后台轮次把它当作已投递，用户永远收不到该条通知。 |
| 触发条件 | worker 在调用 native-acked `presentDigest` 前先持久化本轮新 IDs，系统通知调用 reject 后没有释放这些 ID。 |
| 根因 seam | `src/platform/notifications/notificationStore.ts` 的投递记录事务与 `src/platform/notifications/notificationWorker.ts` 的系统投递失败处理。 |
| 必须保持的行为 | worker 在 native ack 前只做纯预览，不写 delivered IDs 或 identifier；ack 后用一次 compound Store update 同时提交两者。native present reject、compound commit reject 或后续旧槽 exact dismiss reject 都使相同远端 ID 下一轮仍可投递；rollback 精确恢复提交前的 baseline、完整水位和 previous identifier，不得只过滤本轮 ID 而丢失 200-ID cap 截掉的旧尾部。 |
| 精确失败 oracle | `src/platform/notifications/notificationWorker.test.ts` 的 `REG-NOTIFY-008/024` 让首次 native present reject、第二次 Store commit reject、第三次成功，要求前两轮均未消耗远端 ID；deferred native ack 未结算时 Store 两字段保持原值，ack 后只有一次 compound write。`src/platform/notifications/notificationStore.test.ts` 固定 rollback 后同一 ID 可重试，并用 200 个旧 ID + 1 个新 ID 证明 rollback 逐项恢复完整旧水位。 |
| 最低可靠自动测试层 | `UNIT_PASS`：确定性 store/worker 测试固定两阶段投递；只检查最终 AsyncStorage 或一次成功通知不能证明失败可重试。 |
| Replay 或真实验收路径 | 不在真实设备故意破坏系统通知服务。一次性 AVD 可在可控 fake/native harness 补验，但本轮未执行时记 `NOT_VERIFIED`；无需真实站点消息。 |
| 负向验证方式 | 恢复 native ack 前先写 delivered IDs、把 identifier 拆成第二次写入、失败时保留本轮新 IDs，或 rollback 只做 `filter(newIds)`，编号测试必须失败。 |
| 明确不覆盖范围 | 不增加同轮重试、全局 retry、pending log 或云端队列；native ack 后、compound commit 前强杀允许下轮重复覆盖，但不能永久漏报。 |

## `REG-NOTIFY-009` 后台记录后关闭开关或换号仍发送摘要

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享账号隔离 |
| 用户症状 | 后台扫描或 native 展示期间，用户立即关闭全局/单站通知或切换账号，旧轮次仍可能把 delivered IDs 与旧 identifier 写回已关闭或新账号状态。 |
| 触发条件 | worker 只在轮次开始读取一次 state；native ack 与 Store commit 之间存在 TOCTOU，或 Store commit 没有同时绑定开关、identity、expected new IDs 与 previous identifier。 |
| 根因 seam | `src/platform/notifications/notificationWorker.ts` 的 ack 后 currentness 门禁，以及 `notificationStore.recordNotificationDelivery` 的 compound CAS。 |
| 必须保持的行为 | native present 前后都复核 canonical private access；ack 后 compound commit 只有全局/来源仍启用、identity、expected new IDs 与 previous identifier 全部匹配才原子提交 delivered IDs + identifier。任一不匹配都保持 Store 原值并 strict exact-dismiss staged 槽，不能复活被清除的状态。 |
| 精确失败 oracle | `src/platform/notifications/notificationWorker.test.ts` 的参数化 `REG-NOTIFY-009` 在 native ack 后、compound commit 前分别关闭全局、关闭来源和改为 `nodeseek:8`，要求 delivered=0、staged exact dismiss 一次且 Store 两字段不变；`src/platform/notifications/notificationStore.test.ts` 固定同三种状态下 compound commit 返回 `committed=false`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：可控依赖在精确竞态点改变 state；普通设备轮询或只测关闭按钮无法稳定覆盖该窗口。 |
| Replay 或真实验收路径 | 不用真实消息和主账号制造竞态。一次性 AVD 只补权限/摘要常规路径；该精确竞态以自动测试为最低证据，真实未执行记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 ack 后 currentness、使用轮次初始 state、拆开 delivered IDs 与 identifier 写入，或 compound mismatch 时不撤 staged 槽，任一编号测试必须失败。 |
| 明确不覆盖范围 | 不取消已经由 Android 成功显示的历史摘要，不承诺跨进程与 OS UI 绝对原子；以 Store current 和确定性双槽在下轮自愈。 |

## `REG-NOTIFY-010` 妖火消息列表与详情混入删除动作或聊天历史

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02` |
| 用户症状 | 妖火消息时间显示成“删除”，无方括号日期被拼进发送者；打开真实详情会提示“正文未找到”，或把回复、删除与聊天历史当成正文。 |
| 触发条件 | 原站 `.listmms` 列表行末同时含时间与删除链接，时间也可能不带方括号；官方 `messagelist_view.aspx` 把当前正文放在 `.content` 的“内容”标签之后，聊天 `.listmms` 气泡没有当前详情 ID 链接。 |
| 根因 seam | `src/sources/yaohuo/notifications.ts` 的 `parsePage` 时间/actor 边界、`loadDetail` 官方内容字段选择和列表复核。 |
| 必须保持的行为 | 时间候选排除删除 action，支持带/不带方括号的原站时间并从 actor 分离；详情按 exact URL 只返回官方“内容”字段并安全清洗，不包含回复/转发、删除或后续聊天历史。内容标签不存在时明确失败“妖火消息对应的正文未找到”，禁止回退任意 `.listmms` 或整页。markRead 重新读取原列表，只在该 ID 的 unread 图标消失时确认。 |
| 精确失败 oracle | `src/sources/yaohuo/notifications.test.ts` 的 `REG-NOTIFY-010` 固定“时间 + 删除”、无括号日期和官方详情结构：时间必须解析为正确 ISO、actor 为 `Clover`；detail 含点击正文但不含写操作与历史聊天，复核仍有 new.gif 时返回未确认；请求顺序为 list→detail→原 list。相邻缺失用例返回没有“内容”标签的错误页，要求明确 reject。 |
| 最低可靠自动测试层 | `UNIT_PASS`：脱敏 HTML fixture 固定 parser 与 read-after-detail 协议；消息列表能打开或仅检查标题不能证明时间、block 和已读对象一致。 |
| Replay 或真实验收路径 | 匹配 APK 可只打开已读妖火消息核对时间和正文；打开未读会触发原站已读写入，未获该来源明确授权保持 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复取最后一个方括号文本、actor 吞入日期、要求聊天气泡包含当前详情链接、返回整个详情页或不按原列表复核，编号与相邻内容缺失测试必须失败。 |
| 明确不覆盖范围 | 不实现妖火批量已读、删除或发送；相对时间无法可靠解析时保留原文，不伪造排序时间。 |

## `REG-NOTIFY-011` Discourse 顶层通知字段被忽略

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02` |
| 用户症状 | linux.do通知明明带有标题、发起者和头像，列表却显示“站内消息”、错误 actor 或缺失头像。 |
| 触发条件 | 官方 notification serializer 把 `fancy_title`、`acting_user_name` 和 `acting_user_avatar_template` 放在 row 顶层，而 parser 只从 `data` 取 fallback 字段。 |
| 根因 seam | `src/sources/discourseNotifications.ts` 的 `parseNotification` 顶层/嵌套字段优先级与头像绝对 URL 转换。 |
| 必须保持的行为 | 优先读取官方顶层 actor、title、avatar，再兼容 `data` fallback；linux.do 使用同一 Discourse 语义，未知类型仍显示“其他消息”，不得因字段缺失丢行。 |
| 精确失败 oracle | `src/sources/discourseNotifications.test.ts` 的 `REG-NOTIFY-011` 只提供顶层 serializer 字段，要求标题为“官方标题”、actor 为 Alice，头像模板按 96px 转成 linux.do 绝对 URL。修复前只能得到 fallback 文案和空头像。 |
| 最低可靠自动测试层 | `UNIT_PASS`：官方响应形状 fixture 直接执行 adapter；UI mock 自带 actor/title 不能证明 parser 使用真实字段。 |
| Replay 或真实验收路径 | 当前账号有 Discourse 通知时可在匹配 APK 对照 App 列表与原站；当天数据不是稳定前置，未对照时记 `NOT_VERIFIED`。全程只读，不点击未读条目。 |
| 负向验证方式 | 删除顶层字段读取、让嵌套 fallback 覆盖非空顶层值，或不绝对化 avatar template，编号测试必须失败。 |
| 明确不覆盖范围 | 不推断官方未返回的显示名或正文，不把头像/标题持久化；原站新 serializer 字段仍需新增脱敏 fixture 后接入。 |

## `REG-NOTIFY-012` NodeSeek 缺失远端 ID 的 fallback 泄露且不稳定

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/03`、`MORE-02` |
| 用户症状 | NodeSeek 某些消息行没有远端 row ID 时，列表重排或标题/预览编辑会产生新本地 ID，导致重复 Android 摘要；私信对方 UID 还可能进入持久化 delivered IDs。 |
| 触发条件 | adapter 用列表序号、counterpart ID 或可变 title/preview 构造 fallback，而这些 ID 会进入 Query key 与最多 200 条投递水位。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 的 `rowNotification` 远端 ID选择、`stableFallbackId` 输入和私信 target/持久化 identity 分离。 |
| 必须保持的行为 | 有真实 row/comment/message ID 时优先使用；缺失时只散列稳定且非敏感的原站位置/时间字段，不使用列表顺序、actor/counterpart、标题或预览。私信 counterpart 只留在内存 target 供会话读取，不进入持久化通知 ID；没有足够稳定输入时保守丢弃该行。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的四组 `REG-NOTIFY-012` 要求缺 ID 私信的 item ID 不含 counterpart，mention 列表反序后按标题映射的 ID 不变且不含 actor ID，标题/预览修改后 ID 仍相同；两个同 timestamp、不同会话且均无远端 ID 的行必须一起保守丢弃，不能碰撞成一个条目或改用 participant-derived hash。 |
| 最低可靠自动测试层 | `UNIT_PASS` + 隐私边界：adapter fixture 同时证明稳定性和不持久化敏感输入；只测去重 store 或日志脱敏不能发现 ID 自身泄露。 |
| Replay 或真实验收路径 | 原站缺 ID 行不可作为稳定 Live 前置，本回归以脱敏 fixture 为最低证据；真实出现时只观察两次只读刷新 ID/摘要行为，不输出 UID，未执行记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 index、counterpart/actor ID、title 或 preview 参与 fallback，编号测试必须因重排、编辑或隐私断言失败。 |
| 明确不覆盖范围 | 不持久化完整行来换取稳定，不对缺少任何稳定字段的消息伪造 ID；会话详情仍需要内存 counterpart target。 |

## `REG-NOTIFY-013` 消息条目读屏文案缺少动作

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享无障碍基线 |
| 用户症状 | TalkBack 聚焦消息条目时只听到来源、已读状态、参与者和标题，不知道对方是提到、回复、私信还是系统互动。 |
| 触发条件 | row 的 accessibility label 未复用可见 UI 已使用的 notification kind→action 映射。 |
| 根因 seam | `src/features/notifications/notificationPresentation.ts` 的 `notificationAccessibilityLabel` 与 `notificationActionText`。 |
| 必须保持的行为 | 单条读屏文案按来源、已读状态、actor、动作、标题顺序一次播报；未知类型使用“其他消息”动作，不丢失条目。可见文本、点击行为和 Android 摘要隐私不变。 |
| 精确失败 oracle | `src/features/notifications/notificationPresentation.test.ts` 的 `REG-NOTIFY-013` 对 NodeSeek 未读回复要求精确文案“NodeSeek，未读，张三，回复了你，回复了你的主题”；`tests/ui/notifications/notifications-screen.test.tsx` 通过同一 label 点击真实 row。 |
| 最低可靠自动测试层 | `UNIT_PASS` + `UI_PASS`：纯映射固定准确文案，RNTL固定 Pressable 实际采用该 label；只看可见 actor/action 两段文字不能证明读屏结果。 |
| Replay 或真实验收路径 | 匹配 APK 开启 TalkBack，聚焦不同类型的只读消息行，确认一次读完来源、状态、actor、动作和标题；本轮未执行时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 从 label 删除 action、另写与可见动作不一致的映射或把整行拆成多个可聚焦片段，编号测试或 TalkBack 验收必须失败。 |
| 明确不覆盖范围 | 不重写全 App 读屏顺序，不把正文/预览加入 label，也不改变系统通知朗读内容。 |

## `REG-NOTIFY-014` 短来源 Tab 可点击区域不足 48dp

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享 `NAV-01` 选择控件 |
| 用户症状 | 消息页“全部”“妖火”“linux.do”等短来源 Tab 点按区域过窄或过矮，视觉上能看到但单手难以稳定点击。 |
| 触发条件 | `PillRail variant="tabs"` 只按文字宽度布局，缺少双轴最小尺寸；短中文标签最明显。 |
| 根因 seam | `src/ui/controls/SelectionControls.tsx` 的共享 tab style，而不是消息页私有 padding。 |
| 必须保持的行为 | tabs 视觉与触控布局至少 48dp×48dp，继续保留现有间距、下划线、横向滚动、字体缩放和 `hitSlop`；pills/subtabs 的既有紧凑几何不被顺带放大。 |
| 精确失败 oracle | `tests/ui/shared/accessibility-basics.test.tsx` 的 `REG-NOTIFY-014` 渲染短“全部”tab并 flatten 实际 style，要求 `minWidth>=48`、`minHeight>=48`。修复前至少一个轴不足。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 固定真实共享控件布局；像素截图或只断言 `hitSlop` 不能证明布局双轴达到 48dp。 |
| Replay 或真实验收路径 | 匹配 APK 在默认/大字号、浅/深色下逐个点击“全部”与四个单站 Tab，确认无误触且横向滚动正常；未执行设备检查时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除任一最小轴、只给消息页外层加不可点击 padding，或把所有 pill/subtab 一并撑大，编号测试或相邻控件回归必须失败。 |
| 明确不覆盖范围 | 不重新设计来源栏、不增加第二排标签、不改变颜色或动画；其他小点击目标仍按各自回归处理。 |

## `REG-NOTIFY-015` 聚合消息页重试一个失败来源会重读或覆盖其他站

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01` |
| 用户症状 | “全部”消息页有多个站点失败时只显示一个笼统重试；点击后可能重新请求全部来源，导致其他站已显示的可信消息闪动、消失或被覆盖。 |
| 触发条件 | 聚合 infinite query 的任一页包含一个或多个来源错误，用户点击其中一个来源的重试。 |
| 根因 seam | `NotificationsScreen` 的来源错误投影与 `NotificationRoute.retrySource` 对聚合 infinite query 的定向 patch；不能把来源级恢复退化成整页 `refetch/listAllPage`。 |
| 必须保持的行为 | 每个失败来源各显示一条紧凑错误和自己的重试入口；点击只以该来源在失败页的 cursor、当前未读筛选调用一次 `listPage(source)`，并只替换该页中该来源的条目、cursor 和错误。其他来源、其他页及其可信数据保持原引用和内容；失败时也只更新该来源错误。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-015` 同时注入 linux.do 与妖火错误，要求分别显示两个错误，点击“重试 linux.do”只回调 `linuxdo` 且不存在笼统重试；`tests/ui/notifications/notifications-route.test.tsx` 的同编号用例预置 NodeSeek 可信页与 linux.do 错误，点击后要求只调用 `listPage('linuxdo', cursor/limit/unreadOnly)`、`listAllPage` 仍为首次的一次，并在原聚合 Query 中恢复 linux.do 结果。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL + 真实 QueryClient 固定屏幕投影、来源请求归属和 infinite query 局部更新；纯 adapter 单测不能证明聚合缓存未被重读。 |
| Replay 或真实验收路径 | 匹配 APK 的消息总览自然出现 `partial` 时，逐个核对来源级错误与重试；点击一个来源后确认其他站现有条目不闪退、不丢失。第三方失败状态不可稳定制造，条件不满足或未执行设备检查时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复单个笼统按钮、让点击调用 `refetch/listAllPage`、替换整个 infinite query，或清除其他来源/页，任一编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不增加自动重试、退避或全局“重试全部”；不改变下拉刷新、单站筛选页重试或来源 adapter 的协议。 |

## `REG-NOTIFY-016` 暂停私有访问的账号在消息设置中被误报为未登录

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`；共享 `NOTIFY-01/03` |
| 用户症状 | 同一时刻 More 账号中心显示某站“登录状态待确认”，消息通知设置却显示“未登录；开关意图会保留”，让已登录用户误以为账号丢失。 |
| 触发条件 | 来源为 true unknown 或 auth-surface barrier，当前不可发私有请求；UI 只看 `isLoggedIn` 而把“暂不可读取”降级为明确退出。 |
| 根因 seam | `NotificationScreens.sourceSettingStatus` 与 `NotificationsRoute.sourcePending` 没有区分 unavailable 与 anonymous。 |
| 必须保持的行为 | true unknown/barrier 显示“账号确认中；开关意图会保留”，暂停读取并保留意图；confirmed + `isVerifying` 继续正常显示和读取；只有 `identityTrust='none'` 或明确 anonymous 才显示未登录。 |
| 精确失败 oracle | Notifications Screen/Route tests 构造 unavailable source，要求确认中文案和零列表请求；另以 confirmed + `isVerifying` 固定正常可用，并固定三站未登录文案。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 固定实际设置页状态投影；session reducer 或 adapter 单测不能证明用户看到的文案。 |
| Replay 或真实验收路径 | 匹配 APK 在账号中心自然出现“登录状态待确认”时进入消息通知设置，要求同站显示“账号确认中”；状态依赖第三方 probe 时机，条件不满足不强制制造登录变化。 |
| 负向验证方式 | 把 unavailable 压成未登录、让 `isVerifying` 暂停 confirmed 来源或猜测 Cookie，编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不改变账号协议或自动重试；只修正不可用与退出在设置页的投影。 |

## `REG-NOTIFY-018` 前台新消息只亮圆点而不显示 Android 摘要

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享 Android 通知投递状态机 |
| 用户症状 | App 正在前台时，NodeSeek 等站已收到新回复，More 圆点和未读数会变化，但系统通知栏、横幅和声音均没有提醒。 |
| 触发条件 | 前台 unread snapshot 成功发现消息变化；旧实现只持久化计数，只有 WorkManager background worker 会读取稳定 ID 并调用 `expo-notifications`。即使前台主动 schedule，本地通知没有 foreground handler 时 Expo 也默认不展示。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 的前台刷新与 `src/platform/notifications/notificationWorker.ts` 投递状态机未连接，以及 `index.ts`/`src/platform/notifications/notificationSystem.ts` 缺少前台展示 handler。 |
| 必须保持的行为 | 前台成功刷新调用与后台相同的 identity、baseline、最多 60 条扫描、200-ID 去重和每站摘要状态机；只投递新 @我、回复和私信。消息中心可见时同样展示系统摘要，不能只推进水位；本机旧未读、首次/重新启用和换号继续静默。前台不调用 `ToastAndroid`，摘要不含标题、正文或私信内容。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-018` 用已授权、已建立 baseline 的 NodeSeek 前台 snapshot，要求调用共享 worker 且只传成功来源；修复前调用数为 0。`src/platform/notifications/notificationSystem.test.ts` 要求安装的 foreground handler 返回 show banner/list、播放默认声音且不设置 badge；修复前不存在 handler。worker 既有 baseline/重复运行测试继续固定旧消息不补发。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：RNTL 固定真实 runtime 刷新接线，Vitest 固定 Expo handler 和共享 worker 去重；仅观察 More 圆点或直接用 ADB 发测试通知不能证明业务链路。 |
| Replay 或真实验收路径 | 匹配 APK 先在前台完成静默 baseline，再由另一个账号产生一条新回复；普通页约五分钟窗口和消息中心约一分钟窗口都必须能出现 NodeSeek 摘要。随后保持 App 后台，用另一条新消息验证 WorkManager 路径。真实消息均需外部协作；本轮没有新消息时记 `LIVE_PASS NOT_VERIFIED`。 |
| 负向验证方式 | 删除 runtime→worker 接线、恢复未读计数猜测、移除 foreground handler、在消息中心可见时跳过 schedule，或让前后台使用两套 delivered IDs，任一编号测试或设备验收必须失败。 |
| 明确不覆盖范围 | 不承诺前台实时推送，不增加 FCM、云端中继、Toast/Snackbar、quiet hours 或消息类型开关；普通前台仍按约五分钟轮询。 |

## `REG-NOTIFY-019` 私有访问暂停或退出后旧聚合缓存仍暴露消息

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`NOTIFY-01`；共享私有 Query 边界 |
| 用户症状 | 某站因 true unknown/auth-surface barrier 暂停私有访问后，单站页仍显示上次账号消息；明确退出或换号后，单站 Query 已清除，但“全部”聚合 Query 仍保存旧账号条目。 |
| 触发条件 | unavailable source 的 query 被禁用但 React Query 保留 data，Screen 仍直接渲染 `items`；identity 清理只按 `['forum', source, 'notifications']` 删除，未覆盖 `['forum','all','notifications']`。 |
| 根因 seam | `NotificationScreens` 的 active-source 可见性门禁与 `useNotificationsRuntime` 的 canonical identity cache eviction。 |
| 必须保持的行为 | true unknown/auth-surface barrier/challenge 继续保留可信 cache 和投递水位，但 UI 只渲染当前 active 来源条目；confirmed + `isVerifying` 仍 active。明确退出或换号时清该站单站 Query，并删除可能含旧身份的聚合消息 Query。其他站单站 Query、水位和摘要不受影响。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-019` 给 inactive NodeSeek 注入旧 row，要求该 row 不存在；`REG-PERF-019` 反向固定 confirmed check 中仍 active。runtime 的明确退出用例预置单站与 aggregate key，要求两者均清除。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL + 真实 QueryClient 同时固定“保留但不可见”和“确认退出后删除”两种不同语义；只断言请求 disabled 或单站 key 清除不足。 |
| Replay 或真实验收路径 | 不在主登录模拟器人为退出、换号或制造 challenge；普通账号刷新时只确认列表不因 `isVerifying` 消失。退出/换号未获授权时记 `NOT_VERIFIED`。 |
| 负向验证方式 | Screen 使用未过滤 `items`、暂停访问时删除水位、`isVerifying` 隐藏 confirmed row、退出只删 source prefix 或误清 sibling，编号测试必须失败。 |
| 明确不覆盖范围 | 不允许 true unknown/barrier 发私有请求，也不迁移旧账号条目到新账号；聚合 cache 采用安全清除后按当前身份重取。 |

## `REG-NOTIFY-021` 聚合来源重试可串号并截断后续分页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享 canonical identity 与 infinite query |
| 用户症状 | “全部”列表重试失败来源时若恰好换号，返回的新账号消息可能被写进旧账号 Query；若其他来源已翻到后续页，重试恢复的来源即使还有下一页，“加载更多”也不会再请求它。 |
| 触发条件 | route 手工调用 `gateway.listPage`，没有 route-owned `AbortSignal`/expected identity；成功只修改失败页的 cursor，而 React Query 的 `getNextPageParam` 只读取最后一页。 |
| 根因 seam | `notificationGateway.listPage` 的 exact identity 门禁和 `NotificationRoute.retrySource` 对 aggregate infinite-data cursor 所有权。 |
| 必须保持的行为 | 每次来源重试捕获发起时 `identityKey`，创建并在 identity/source/unmount 时取消的 controller；gateway 在 adapter 发网前检查 signal 与 exact identity。成功仍只替换失败页的该来源数据/错误，但若失败页不是末页，恢复 cursor 同步传播到末页并重算 `hasMore`，使下一次聚合分页继续该来源。 |
| 精确失败 oracle | `src/sources/notificationGateway.test.ts` 的 `REG-NOTIFY-021` 让当前 NodeSeek 身份与 retry expected key 不同，要求 reject 且 adapter 零调用；修复前 promise 成功。`tests/ui/notifications/notifications-route.test.tsx` 要求 retry 传 expected key/signal，并在预置第二页后把 `linux-next` 传播到最后一页、`hasMore=true`；修复前参数缺失且末页仍为 null/false。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：gateway 单测固定最后发网门禁，真实 QueryClient RNTL 固定多页数据结构；只测首屏重试成功会遗漏分页断链。 |
| Replay 或真实验收路径 | 真实换号与稳定制造“首屏单站失败、其他站已翻页”都不在主登录设备执行；匹配 APK 自然出现 partial 时只读核对单站重试，完整竞态由自动测试作为最低证据。 |
| 负向验证方式 | 删除 expected identity/signal、让 retry 调用全局 refetch、只更新失败页 cursor、不重算末页 `hasMore`，编号测试必须失败。 |
| 明确不覆盖范围 | 不增加自动重试、全局 retry、跨来源 cursor 合并协议或后台分页变化；只修正现有定向 retry 的身份与 cursor 所有权。 |

## `REG-NOTIFY-022` 后台任务注册竞态让旧开关意图覆盖最新状态

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享 Android 后台调度生命周期 |
| 用户症状 | 快速开关消息通知后，设置显示已关闭但 WorkManager 仍注册，或显示已开启但后台任务已经被旧注销操作移除，后续后台新消息没有提醒。 |
| 触发条件 | 两次 `syncNotificationBackgroundRegistration` 同时读取旧 registration 状态，较早的 register/unregister 在较新的意图之后才完成。 |
| 根因 seam | `src/platform/notifications/notificationSystem.ts` 把“读取当前注册状态”和“应用目标状态”作为可并发的两段 native 操作。 |
| 必须保持的行为 | 注册同步按调用顺序串行；前一次失败不能卡死队列，最后一次调用的权限、全局意图和 eligible sources 决定最终 registration。worker 仍在执行时继续由自身状态门禁 fail-closed。 |
| 精确失败 oracle | `src/platform/notifications/notificationSystem.test.ts` 的 `REG-NOTIFY-022` 分别阻塞旧 register 与旧 unregister，再提交相反的新意图；最终 native registration 必须与最后一次调用一致。修复前两个交错分别遗留已注册和已注销状态。 |
| 最低可靠自动测试层 | `UNIT_PASS`：必须控制 native Promise 的完成顺序；顺序点击设置页或只断言调用参数无法稳定复现。 |
| Replay 或真实验收路径 | 一次性 AVD 可快速开关后用 JobScheduler 核对最终任务状态；主登录设备不靠竞态操作验收，未执行记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 registration queue，恢复每次独立 `isTaskRegisteredAsync → register/unregister`，编号测试必须失败。 |
| 明确不覆盖范围 | 不提高 WorkManager 调度频率、不承诺系统准点运行，也不把后台任务是否已被系统执行等价为注册状态。 |

## `REG-NOTIFY-023` 快速连续换号时旧身份 effect 覆盖最新水位

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`NOTIFY-03`；共享账号绑定水位 |
| 用户症状 | A→B→C 快速身份变化后，UI 已显示 C，但持久化通知身份又被较慢的 A→B 清理写成 B；后续 C 的 worker 因身份不一致持续跳过。 |
| 触发条件 | 旧 identity effect 的 `dismissSourceNotification` 较晚返回；React cleanup 只阻止最终 commit，没有阻止随后的 reset 与 Query 清理。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 的 identity reconciliation 缺少每个异步副作用后的当前 generation 门禁。 |
| 必须保持的行为 | 身份 effect 失效后不得再 reset 水位或删除 Query；每个可等待边界返回后先确认当前 effect，只有最新身份能够落盘、清缓存并同步后台资格。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-023` 阻塞 A→B 的摘要撤销，先让 A→C 完成再释放旧 Promise，最终重新读取的持久化 identity 必须仍为 C；修复前变回 B。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 Hook effect cleanup、AsyncStorage 队列和 deferred Promise；纯 store 单测不能覆盖 React 生命周期。 |
| Replay 或真实验收路径 | 不在主登录设备制造快速换号；另获授权的一次性账号环境可在最终 C 身份下等待新消息。未执行时由自动竞态测试作为最低证据。 |
| 负向验证方式 | 移除 dismiss/reset 后的 current guard，编号测试必须把 C 覆盖为 B。 |
| 明确不覆盖范围 | 不改变 Account canonical reconciliation、confirmed/unknown/none 语义或站点登录协议。 |

## `REG-NOTIFY-024` 发送期间关闭通知或换号后旧摘要复活

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享 Android 摘要与账号隐私 |
| 用户症状 | 用户关闭通知或切换账号后，已经清除的旧账号摘要又出现在通知栏；旧 worker 还可能消耗该条投递 ID，之后无法正确重试。 |
| 触发条件 | Expo `scheduleNotificationAsync()` 先 resolve，真正的 Android receive/present 后续才执行；worker 若把 schedule 当成展示完成，关闭、换号或 deadline cleanup 可能先撤一个尚不存在的 staged tag，迟到的 native `notify()` 随后把私有摘要复活。另一个漏报窗口是 worker 在 native ack 前持久化 delivered IDs：此时强杀会让消息永久被当作已投递。旧实现还让 native scope cancel 丢掉已经排队的 exact dismiss、transactional dismiss 复用 broad helper，且并发 worker 可对同一 A/B 槽发生 ABA rollback。 |
| 根因 seam | `src/platform/notifications/notificationWorker.ts` 的投递 owner、`notificationStore` 的 identifier CAS、`notificationSystem` 的 strict/broad 撤销边界，以及 config plugin 生成的 native exact present/dismiss bridge 共同组成一项本机事务。 |
| 必须保持的行为 | 每个 `source + identity` 只派生两个确定性 A/B identifier。worker 只纯预览非当前 staged identifier 与新 ID，不在 native ack 前写 Store；native bridge 复用 Expo notification builder 保留 click payload，只在 `NotificationManagerCompat.notify(identifier, 0, notification)` 返回后 resolve，并在权限或目标 channel 关闭时 reject。native present 与 exact dismiss 共用单线程 Executor，`invalidate()` graceful shutdown 并 drain 已接受任务，late notify 后的 cleanup 不会被取消或反向复活；shutdown 后新任务 reject。同身份 worker 使用进程内 single-flight。worker 在 probe 前以 Store current identifier 为真值清理 base/A/B/source-only 其他槽；notify ack 后复核 canonical private access，再以 expected new IDs、previous identifier、identity 与 intent 做一次 compound Store commit，成功后才 strict exact-dismiss 旧槽。明确 stale/撤销失败时 compound rollback 精确恢复 pre-commit baseline、完整水位和 previous identifier，rollback 成功后才只撤 staged 槽；deadline 不能启动可能失序的 rollback+dismiss：ack 后 commit pending 或已成功都保留 staged，late outcome 只有明确 false/reject 才 exact-dismiss，旧槽/orphan 交给下轮 Store-current reconcile。顶层 worker 对 settlements 做 deadline race 后 bounded 返回，但同身份 single-flight lane 继续持有到 pending commit outcome 和必要 exact dismiss 完成，下一轮不能按旧 Store 提前 reconcile。broad best-effort cleanup 不进入事务。强杀在 ack 与 commit 之间最多导致下轮重复覆盖，不能漏报；commit 后、旧槽 dismiss 前强杀由 Store current 自愈。启动/恢复只触发同一个 eligible worker，不另建 cleanup owner。 |
| 精确失败 oracle | `src/platform/notifications/notificationWorker.test.ts` 的 `REG-NOTIFY-024` 覆盖 ack pending Store 不变、ack 后单次 compound write、commit reject、deadline 后 late present、旧槽 dismiss reject rollback、同身份并发 single-flight 与 worker 入口 crash-orphan 对账；另固定 deadline 命中 pending commit 时 bounded return 且当下 rollback/dismiss 均为 0，late true 继续为 0、late false/reject 才 exact-dismiss，以及 commit success 后 post-check deadline 仍不 rollback/dismiss。W1 deadline 已返回后立即启动同身份 W2，pending commit settle 前 W2 reconcile/probe 必须为 0；late true 后 W2 才以 staged current 进入，late false/reject 则阻塞 staged dismiss 并证明 dismiss resolve 前 W2 仍为 0。`src/platform/notifications/notificationStore.test.ts` 固定 compound CAS、stale rollback 和 200-ID cap 后精确恢复；`src/platform/notifications/notificationSystem.test.ts` 固定 strict exact 不删 legacy 与 Store-current slot reconciliation；fresh prebuild 生成的 `NotificationDigestExecutorTest.kt` 阻塞 present、排入 dismiss、invalidate 后释放，要求 `notify → cancel` 且两个 Promise 等价物都结算，并固定 shutdown 后 execute reject。`tests/tooling/release-packaging.test.ts` 固定生成 bridge 与 native test 形态。 |
| 最低可靠自动测试层 | `UNIT_PASS` + native unit + native compile：行为测试必须让 ack 前 Store 写入、只过滤 newIds 的 rollback、取消 queued dismiss、Expo schedule completion、broad swallow-errors dismiss 或缺 single-flight 真正失败；fresh Expo prebuild 后运行 `:app:testReleaseUnitTest` 与 `:app:compileReleaseKotlin`，不能用源码门禁代替生成形态的编译和生命周期 oracle。 |
| Replay 或真实验收路径 | 一次性 AVD 可在 mock/development 注入的延迟窗口中关闭通知并检查通知栏；不要求朋友配合制造毫秒级竞态。未执行记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 Expo schedule 假 ack、ack 前记录 delivered IDs、把 delivered IDs 与 identifier 分两次写、deadline 后并行启动 Store rollback 与 staged dismiss、rollback 只过滤 new IDs、scope cancel/shutdownNow、同槽覆盖、展示前 dismiss old、让 present/exact dismiss 并发、transaction 调 broad helper，或删除 currentness/compound CAS/single-flight/Store-current 对账，任一编号测试必须失败。 |
| 明确不覆盖范围 | 不把 Android 本机通知变成云端事务，不新增 persisted transaction log 或 pending 状态；强杀后 orphan 只保证在下一次 eligible worker 运行时按已知槽自愈（启动/恢复会触发该 worker），允许极端窗口重复覆盖，不允许永久漏报，也不承诺系统 UI 零帧延迟。 |

## `REG-NOTIFY-025` 消息中心可见时跳过系统通知并永久吞掉投递

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享前台摘要展示策略 |
| 用户症状 | App 在前台且消息中心可见时收到新回复，列表会刷新但 Android 系统通知不出现；投递 ID 已被记录，离开页面或重启后也不会补发。 |
| 触发条件 | foreground worker 在消息中心可见时用伪 identifier 代替 native-acked `presentSourceNotification`，但仍提交水位与 identifier。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 提供给共享 worker 的 foreground notification sink。 |
| 必须保持的行为 | 用户已开启通知且权限有效时，前台所有页面（包括消息中心）发现新的 @我、回复或私信都必须调用 Android system sink；消息中心可见性只控制 60 秒刷新频率，不能改变投递提交。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-025` 在 worker 已启动后把消息中心设为可见，再调用该轮 system sink；`presentSourceNotification` 必须收到 exact source/digest/identity identifier 并调用一次。修复前调用次数为 0。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经过 Hook ref 与异步 worker dependency；静态检查 callback 或只测固定页面状态不足。 |
| Replay 或真实验收路径 | 匹配 APK 保持消息中心可见，由外部账号产生一条新消息，确认列表刷新且 Android 通知栏仍出现每站摘要；没有可控新消息时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复任何基于 `centerVisible` 返回伪 identifier 或跳过 system sink 的分支，编号测试必须失败。 |
| 明确不覆盖范围 | 不保证 OS 展示时延，不验证系统通知 UI 皮肤；普通页与消息中心仍保持既定约五分钟/一分钟刷新。 |

## `REG-NOTIFY-026` 单次 snapshot 写入失败阻断全部前台投递

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/03`；共享来源隔离与前台投递 |
| 用户症状 | 某次未读计数已成功读取，但一次 AsyncStorage 写入失败后，本轮所有成功来源都不进入 worker；用户至少再等一个轮询周期才能收到提醒。 |
| 触发条件 | runtime 用 `Promise.all(writes)` 作为启动 worker 的前置；任一 snapshot write reject 直接走统一 catch。 |
| 根因 seam | `src/features/notifications/useNotificationsRuntime.ts` 的 snapshot 持久化与成功来源投递编排。 |
| 必须保持的行为 | snapshot 写入按来源 all-settled，任何单次失败不阻止成功读取来源进入共享 worker；worker 自己仍通过 store record 决定是否能安全持久化和投递，持续存储故障继续 fail-closed。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-026` 让首次 snapshot `setItem` reject，仍要求已成功读取的 NodeSeek 进入 worker；修复前 worker 调用数为 0。 |
| 最低可靠自动测试层 | `UI_PASS`：需要真实 runtime 编排与存储 Promise；只测 worker 来源隔离无法发现 worker 根本没有被调用。 |
| Replay 或真实验收路径 | 不在主设备破坏 AsyncStorage；该故障由确定性自动测试覆盖，真实新消息验收只验证正常存储路径。 |
| 负向验证方式 | 把 `Promise.allSettled` 恢复为 `Promise.all(...).catch`，编号测试必须超时失败。 |
| 明确不覆盖范围 | 不把持续存储失败降级为无去重通知；worker record 失败时仍不得发送。 |

## `REG-NOTIFY-027` 消息列表失焦后隐藏页面仍每分钟读取站点

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/03`；共享消息 route 生命周期 |
| 用户症状 | 从消息列表进入详情或完整主题后，已隐藏但仍 mounted 的列表继续每分钟访问三站，造成无意义请求和与当前页面不一致的刷新。 |
| 触发条件 | `useFocusEffect` 只更新中心可见标志，Infinite Query 的 `enabled` 和 `refetchInterval` 不依赖 route focus；`refetchIntervalInBackground=false` 只识别 AppState。 |
| 根因 seam | `src/features/notifications/NotificationRoute.tsx` 的 native stack focus 与列表 Query 生命周期。 |
| 必须保持的行为 | 只有消息列表 route 当前 focused 时启用列表 Query 和 60 秒 interval；push 详情/Topic 后停止读取，返回列表时恢复并按 stale 规则刷新。runtime 普通页面 snapshot 仍独立保持约五分钟策略。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-route.test.tsx` 的 `REG-NOTIFY-027` 在真实 native stack 中先加载消息列表，再 push 到 Other 并触发该 Query refetch；调用数必须保持 1。修复前隐藏 route 再请求一次。 |
| 最低可靠自动测试层 | `UI_PASS`：必须保留 mounted route 并切换真实 focus；卸载组件或只断言 `setCenterVisible(false)`不能证明 Query 停止。 |
| Replay 或真实验收路径 | 匹配 APK 从消息列表进入详情/主题并停留超过一分钟，结合脱敏网络诊断确认没有列表轮询；未执行时由导航 Query 测试作为最低证据。 |
| 负向验证方式 | 从 Query `enabled/refetchInterval` 移除 `useIsFocused`，编号测试必须出现第二次 `listAllPage`。 |
| 明确不覆盖范围 | 不暂停详情页自身按用户动作发起的读取，也不改变 App 进入后台时的 WorkManager 调度。 |

## `REG-NOTIFY-028` NodeSeek 省略 `viewed` 的新消息被当成已读

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/03`；NodeSeek 列表解析与 Android 摘要投递 |
| 用户症状 | More 已显示“有未读 · 后台通知已开启”，Android 权限和 channel 正常，但朋友新发的 @我/回复没有系统通知。 |
| 触发条件 | NodeSeek 通知列表的新行省略 `viewed`；未读计数接口仍返回非零。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 把缺失的已读标记默认成 `true`，worker 因 `unread=false` 过滤该行。 |
| 必须保持的行为 | 只有原站明确返回 `viewed/is_read/read=true` 才按已读处理；字段省略按未读。读取列表和系统摘要均不得标记远端已读。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-028` 解析不含 `viewed` 的真实形态行，必须得到 `unread=true`；修复前稳定得到 `false`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：adapter fixture 固定字段省略语义；真实 Android 摘要另用安装后新消息验证。 |
| Replay 或真实验收路径 | 保持 App 在消息中心之外，外部账号产生一条新 @我/回复，触发恢复同步后只检查 Android NotificationManager；不点击消息行。 |
| 负向验证方式 | 把缺失标记默认值改回已读，编号测试必须失败。 |
| 明确不覆盖范围 | 不推断已明确返回 `viewed=true` 的行，不执行真实逐条/批量已读。 |

## `REG-NOTIFY-029` NodeSeek 同一通知记录的新回复被投递水位去重

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02/03`；NodeSeek 列表身份、详情定位与 Android 摘要去重 |
| 用户症状 | 朋友再次回复同一帖子后 More 能看到未读，但 Android 通知栏没有新的系统通知。 |
| 触发条件 | NodeSeek 对同一通知记录复用列表行 `id`，同时返回新的 `comment_id`；本机投递水位已经记录旧行 ID。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 优先用列表行 `id` 生成统一消息 ID，把远端 `markViewed` 记录 ID 与每条回复的稳定身份混为一体，worker 将新回复误判为已投递。 |
| 必须保持的行为 | NodeSeek @我/回复以 `comment_id`（兼容 `message_id`）作为列表、详情和投递身份；原始列表行 `id` 只保存为 `remoteReadId` 供真实 `markViewed` 使用。私信仍按其真实消息行 ID。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-029` 输入相同 `id=12`、不同 `comment_id=98/99`，必须得到不同的 `reply-to-me:98/99`，且两者 `remoteReadId` 均为 `12`；修复前两者都为 `reply-to-me:12`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：adapter fixture 固定两个身份字段的职责；匹配 APK 在消息中心外触发同步并由 Android NotificationManager 确认真实系统通知。 |
| Replay 或真实验收路径 | 不打开未读条目；保持 Feed 可见，覆盖安装修复 APK 后触发启动/恢复同步，只检查通知栏存在 `com.wz.reader` 通知。 |
| 负向验证方式 | 恢复原始列表行 ID 优先级，编号测试必须失败并把两条回复重新折叠为同一 ID。 |
| 明确不覆盖范围 | 不执行真实逐条/批量已读，不点击 Android 摘要，也不改变私信 ID 协议。 |

## `REG-NOTIFY-030` NodeSeek 自己发出的私信被误报为对方新私信

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/03`；NodeSeek 私信未读语义与 Android 摘要 |
| 用户症状 | 用户刚给对方发送私信后，App 却显示“对方发来私信”并触发一条新的 Android 系统通知。 |
| 触发条件 | NodeSeek 会话列表最后一条由当前账号发送，`viewed=false` 表示对方尚未查看。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 的列表解析只看 `viewed`，没有像详情未读 ID 逻辑一样同时校验 `sender_id !== ownUserId`。 |
| 必须保持的行为 | 私信会话行只有在发送者明确为对方且原站未读时才标记 `unread=true`；自己发送、发送者缺失或原站已读均不得进入系统投递，但仍可作为已读会话显示在消息中心。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-030` 输入 `sender_id=当前账号`、`viewed=false`，必须得到同一会话条目且 `unread=false`；修复前稳定得到 `true`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：adapter fixture 固定发送方向与 `viewed` 的组合语义；无需真实发送私信。 |
| Replay 或真实验收路径 | 不要求真实写入；若已有自己发出的未读回执会话，可只读确认消息中心显示为已读且 NotificationManager 无新增摘要，否则保持 fixture 证据。 |
| 负向验证方式 | 把私信 `unread` 恢复为仅取反 `viewed`，编号测试必须失败。 |
| 明确不覆盖范围 | 不改变私信会话 ID、详情加载或真实 markViewed 协议，不发送测试私信。 |

## `REG-NOTIFY-031` 单站通知被全局类型抹平且私信无法按原站协议回复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02/03`、`ACCOUNT-01/02`、`MORE-02`、`NAV-01`；三站分类、私信会话与回复安全边界 |
| 用户症状 | 进入某个站点后仍只能看到跨站“全部/未读”，无法选择原站的 @我、回复、个人信息、系统或聊天分类；私信详情只有一段正文，不能连续阅读双方消息，也不能在 App 内回复。 |
| 触发条件 | UI 把全局 `NotificationKind` 当成所有站点的筛选枚举，列表 Query key 不含站点 category；adapter 只暴露列表/详情/已读，没有现有会话回复能力与明确成功 oracle。 |
| 根因 seam | 展示类型与站点筛选语义被合并在全局 domain；会话读取、回复 transport、身份/scope/abort 门禁和草稿确认语义没有经过 `NotificationAdapter → notificationGateway → NotificationRoute` 同一链路。 |
| 必须保持的行为 | 聚合页不显示子分类；单站分类由 adapter 声明并进入 Query key，切站回默认分类。NodeSeek、Discourse 与妖火分别使用真实 endpoint/type/form；会话按时间正序显示左右气泡并定位最新。NodeSeek/Discourse 为 Markdown，妖火为纯文本且点击正文与最近 20 条聊天分离。空白、重复提交、换号、取消 均不得发网；失败或未确认保留内存草稿，明确确认才清空并刷新，正文不进入 diagnostics。 |
| 精确失败 oracle | 三站 adapter 的 `REG-NOTIFY-031` fixture 固定分类标签、query/body、PM topic 映射、Markdown/plain-text 与精确成功文本；`src/sources/notificationGateway.test.ts` 固定 category、identity/abort/scope、未确认和正文隐私；`tests/ui/notifications/notifications-route.test.tsx` 固定切站重置、草稿保留/清空，`tests/ui/notifications/notifications-screen.test.tsx` 固定无聚合分类、子分类无批量已读、气泡和两种 composer。修复前分别缺方法、缺分类栏或草稿在错误时丢失。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：adapter/gateway Vitest 与 Notifications RNTL；共享 Topic ReplyComposer 同时回归，Android 设备只读核对分类和已有已读会话。 |
| Replay 或真实验收路径 | 匹配 APK 从 More → 消息通知依次打开三站，只读切换每个原站分类并打开允许读取的既有已读会话；检查气泡方向、作者、时间、最新定位和 composer 格式，不点击发送。真实回复必须另获“站点、收件人、测试内容”授权后才执行一次并刷新确认。 |
| 负向验证方式 | 从 list key 删除 category、让 UI 使用全局类型枚举、把妖火任意 `.tip` 当成功、在未确认结果时清空草稿，或绕过 gateway 直接调用 adapter，任一编号测试必须失败。 |
| 明确不覆盖范围 | 不提供新建私信、搜索私信、妖火发件箱、分类级推送设置、书签/个人资料；自动测试与只读验收不真实发送、上传、逐条已读或批量已读。 |

## `REG-NOTIFY-032` 私信会话退化成顶部正文且丢失既有图片与表情能力

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`WRITE-01`、`ACCOUNT-01`；私信会话布局与共享 composer 写入门禁 |
| 用户症状 | 私信消息挤在页面顶部、正文下方留下大块空白，作者与时间反复塞进气泡，底部只有孤立的“回复私信”按钮；打开回复后，Topic 已有的图片上传、NodeSeek 贴纸和 Discourse emoji 全部消失。 |
| 触发条件 | 消息详情新建了只包含 Markdown 格式按钮的 `MessageReplyComposerSheet`，没有复用现有 ReplyComposer；会话列表未占满可用高度并靠底布局。 |
| 根因 seam | Topic-local composer 同时拥有共享编辑能力与 Topic 目标文案，通知功能因此复制了残缺实现；会话布局没有把 native header、消息流和固定 composer 入口分成明确层级。 |
| 必须保持的行为 | `src/ui/composer/ReplyComposer.tsx` 是 Topic 与私信共用的唯一格式/表情/图片 UI。NodeSeek 私信提供贴纸与 NodeImage 图片，linux.do 提供本站 emoji 与 `/uploads.json` 图片，妖火私信按已核实协议保持纯文本。图片选择前先取得 writable ticket，NodeSeek 先确认 API Key；每个 await 后复核 ticket/identity/abort，取消和重复点击零上传，上传成功只把 markup 插入内存草稿且绝不自动发送。会话消息靠底、时间与作者弱化并置于气泡外，底部整行入口至少 48dp；换号或离开立即取消。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 固定消息容器 `justifyContent=flex-end`、左右气泡、Markdown 图片/表情、linux.do emoji 与妖火纯文本边界；`tests/ui/notifications/notifications-route.test.tsx` 固定 writable gate 早于 picker、重复/取消零上传、成功只插入草稿；`src/sources/notificationGateway.test.ts` 固定 NodeImage、Discourse `/uploads.json` 与文件名/API Key 不进入 diagnostics；共享 `tests/ui/topic/reply-composer.test.tsx` 防止 Topic 退化。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：Gateway Vitest 与 Notification/Topic RNTL；真实图片上传和私信发送均不属于自动测试。 |
| Replay 或真实验收路径 | 匹配 APK 只读打开三站已有已读会话，核对靠底消息、固定回复入口和各站 toolbar；不得点击“图片”或“发送”。真实上传需先获得具体站点与测试文件授权，真实回复仍需“站点、收件人、测试内容”授权。 |
| 负向验证方式 | 改回通知专用简化 toolbar、删除 `onUploadImage`、让 picker 早于 writable gate、上传后直接调用发送、把妖火显示成 Markdown，或移除消息容器的靠底样式，任一编号测试必须失败。 |
| 明确不覆盖范围 | 不新增私信附件历史、相册管理、上传重试、新建私信或妖火私信图片；不以官方文档或测试 mock 冒充未经授权的真实站点写入。 |

## `REG-NOTIFY-033` NodeSeek 后续页通知详情错误显示不可用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`；NodeSeek 通知精确帖子定位 |
| 用户症状 | NodeSeek 的 @我/回复条目可正常进入完整主题并看到目标楼层，但消息详情却显示“NodeSeek 消息对应的帖子内容未找到”。 |
| 触发条件 | 通知同时携带稳定 `comment_id` 与位于后续页的 floor，目标 floor 指向第 3 页或更后，而详情没有可信总回复数。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 的通知详情分页曾固定从第 2 页开始并按 `replyCount` 推导末页，丢弃了通知 floor 已提供的可靠页提示和原站页拓扑。 |
| 必须保持的行为 | comment ID 始终是最终匹配身份；合法 floor 即使在 comment ID 存在时也必须作为首个分页提示。floor 错误时按响应 `postPageCount` / pager 的有界页集合继续匹配 comment ID，不能依赖 `replyCount`，也不能按相同楼层误命中另一条回复。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-033` fixture 给出 `commentId=31`、`floor=21`、`postPageCount=3` 且没有总数，目标只存在于第 3 页；修复后先请求第 3 页并返回 comment ID 31 的正文。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：adapter fixture 固定低估分页组合；匹配当前身份的 App 内原站只读打开同一已有通知，确认详情正文与完整主题目标楼层一致。 |
| Replay 或真实验收路径 | More → 消息通知 → NodeSeek → @我，打开已确认的 Monkeypox 通知；详情应显示 `@凡想世界 #5 佬能开源吗`。再打开完整主题，目标仍定位到同一条回复。该路径只读，不触发回复、上传或其他写操作。 |
| 负向验证方式 | 恢复“存在 comment ID 时忽略 floor、固定从第 2 页开始”的页序，编号测试必须以同一生产错误失败。 |
| 明确不覆盖范围 | 不放宽 comment ID 精确匹配，不猜测无限页数，不把完整主题能打开当作详情成功，也不授权真实回复或已读写入。 |

## `REG-NOTIFY-034` 通知详情底栏被系统手势区遮挡

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`；私信回复入口与普通通知主题操作栏的 Android 底部安全区 |
| 用户症状 | 私信详情底部输入入口贴到系统手势条上，视觉拥挤且底部点击区域可能被遮挡；普通通知的固定主题按钮存在同一风险。 |
| 触发条件 | 设备提供非零 bottom safe-area inset，详情页渲染固定 `replyDock` 或 `topicActionDock`。 |
| 根因 seam | `src/features/notifications/NotificationScreens.tsx` 的两个固定 dock 只使用固定垂直 padding，没有消费 `react-native-safe-area-context` 提供的 bottom inset；弹出的共享 Composer 已独立正确处理安全区。 |
| 必须保持的行为 | 两个详情页固定 dock 在原有 9dp 底部间距上追加设备 bottom inset；零 inset 设备保持原间距。Composer sheet 继续只处理自己的安全区，不能重复垫高。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-034` 把 bottom inset 设为 24，分别渲染私信回复 dock 和普通通知主题 dock，二者 `paddingBottom` 必须为 33；修复前均没有显式 bottom padding。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 固定真实组件样式组合；Android 匹配 APK 的截图只读复核手势条与入口没有重叠。 |
| Replay 或真实验收路径 | 在启用手势导航的匹配模拟器中打开已有已读私信，再打开一条可进入主题的普通通知；只读确认两个固定操作栏均完整位于手势区上方。不得点击发送、图片或其他写操作。 |
| 负向验证方式 | 移除任一 dock 的 safe-area 样式后，对应编号断言必须从 33 退回固定间距或未定义并失败。 |
| 明确不覆盖范围 | 不改变消息气泡、Composer 高度、系统导航模式或其他页面的安全区策略。 |

## `REG-NOTIFY-035` 消息一级 Tab 文字与选中线不同轴

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01`；共享 `PillRail` 的 tabs 视觉与点击区 |
| 用户症状 | 消息页一级来源 Tab 看起来歪斜：短中文标签靠在点击区左侧，蓝色选中线却铺满整个最小宽度；长英文标签接近占满宽度，导致同一排各项朝向不一致。 |
| 触发条件 | `tabs` variant 的标签文本短于 48dp 最小点击宽度，例如“全部”“妖火”。 |
| 根因 seam | `src/ui/controls/SelectionControls.tsx` 的 `tab` 保证了最小宽度，但 `tabText` 没有居中；React Native Text 拉伸到按钮宽度后沿默认起点绘制。 |
| 必须保持的行为 | 每个 tabs 标签在自己的点击区与选中线内水平居中；继续保留至少 48dp 双轴点击区、内容宽度、原顺序和横向滚动，不能为了五等分而截断大字号或长站名。共享 Feed、Search、Library、User tabs 使用同一规则。 |
| 精确失败 oracle | `tests/ui/shared/accessibility-basics.test.tsx` 的 `REG-NOTIFY-035` 渲染短标签“全部”，要求最终 `tabText.textAlign` 为 `center`；修复前稳定得到 `undefined`。 |
| 最低可靠自动测试层 | `UI_PASS`：共享 RNTL 固定真实 `PillRail` 样式；匹配 Android App 的截图复核短中文、长英文与选中线同轴。 |
| Replay 或真实验收路径 | More → 消息通知，在聚合页对照“全部 / NodeSeek / linux.do / 妖火”；切换一个来源后再次确认选中线和文字中心一致。只读切换不打开未读条目。 |
| 负向验证方式 | 移除 `tabText` 的居中后，编号测试回到 `undefined` 并失败，模拟器中的“全部”再次贴向选中线左端。 |
| 明确不覆盖范围 | 不把一级 Tab 强制等宽，不改变站点名称、字号、选中线宽度或二级分类协议。 |

## `REG-NOTIFY-036` 消息中心与共享回复器忽略 App 字号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02`、`WRITE-01`；消息中心与共享 ReplyComposer 的 Dynamic Type |
| 用户症状 | More 已显示“字号 130%”，消息列表、私信气泡和回复输入框却仍保持 100% 大小；页面间字号所有权不一致，大字号也无法改善可读性。 |
| 触发条件 | Reader settings 的 `fontScale` 非 1，进入消息列表、详情或 Topic/私信共用的回复面板。 |
| 根因 seam | `createNotificationStyles` 与迁移后的 `src/ui/composer/ReplyComposer.tsx` 仍写死 fontSize/lineHeight，没有消费 `ReaderStyleProvider` 的 `settings.fontScale`。 |
| 必须保持的行为 | 消息列表、空态、设置、详情、会话元信息/气泡、固定回复入口及共享 composer 的标题、工具、输入、状态与错误均按 Reader `fontScale` 成对缩放字号和行高；工具栏继续遵循 `REG-NOTIFY-055` 的单行横滑契约，不能靠截断恢复。 |
| 精确失败 oracle | `tests/integration/style-ownership.test.ts` 的 `REG-NOTIFY-036` 用 1.3 settings 创建真实消息样式，标题必须从 14 变为 18；`tests/ui/topic/reply-composer.test.tsx` 在真实 `ReaderStyleProvider` 下要求输入字号为 `round(14 × 1.3)`。修复前两者分别仍为 14。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：样式 ownership 集成测试固定消息全局 seam，RNTL 固定共享 composer；匹配 Android 再以 100%/130% 对照字号与末尾工具可达性。 |
| Replay 或真实验收路径 | More → 外观把字号从 100% 调到 130%，进入消息聚合、单站分类和已有已读会话，打开但不提交回复面板；确认字形、行高和点击区同步变化，结束后恢复 100%。 |
| 负向验证方式 | 任一消息或 composer 文本恢复固定 fontSize，编号测试必须得到未缩放值并失败；只放大单个标题不能通过全页设备对照。 |
| 明确不覆盖范围 | 不跟随 Android 系统字体倍率，不改变 App 已有 Reader 字号档位、字体族或密度设置；真实发送和上传仍不在字号验收内。 |

## `REG-NOTIFY-037` 妖火聊天泄露原始包装并重复、倒序或丢失时间

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`；妖火私信正文与最近聊天的协议隔离和会话呈现 |
| 用户症状 | 妖火会话气泡显示“回复时间/回复内容”等原站协议标签，原消息在聊天中重复；服务端倒序记录直接展示，日期甚至被当作作者，清理包装后气泡时间又消失。 |
| 触发条件 | 详情同时包含官方“内容”字段与 `.listmms.the_user/the_me` 聊天气泡；时间可能在 `.info`，也可能只在气泡的“回复时间”包装中。 |
| 根因 seam | `src/sources/yaohuo/notifications.ts` 把 `.con` 原 HTML直接当正文，没有先分离协议元数据、按内容去重和按解析时间排序；作者/时间只信任单一 `.info` 结构。 |
| 必须保持的行为 | 原消息正文独立显示一次；聊天只保留可渲染正文、图片和“查看主题帖/查看完整回复”导航链接，精确移除“回复时间/回复内容”协议标签。作者日期形态失效时回退通知对端；时间先从 `.info` 读取，再从“回复时间”提取，随后才清理包装；最终按时间正序，未知时间置后。 |
| 精确失败 oracle | `src/sources/yaohuo/notifications.test.ts` 的 `REG-NOTIFY-037` 使用真实形态 HTML：一条原消息重复项、倒序历史、日期作者、仅存在于“回复时间”的秒级时间、图片及两类导航链接；结果必须只剩两条正序气泡、作者均为 Clover、秒级时间可解析、正文不含协议标签且两个链接的绝对 href 均保留。修复前得到三条、顺序错误、作者为日期或时间为 null。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：adapter fixture 固定 DOM 协议；匹配 App 只读打开已有已读妖火聊天，核对正文、作者、图片、时间和顺序。 |
| Replay 或真实验收路径 | More → 消息通知 → 妖火 → 聊天，打开已有已读 Clover 会话；确认“原消息”与最近 20 条历史分区、包装文本不出现、气泡作者/时间可见。不得点击发送。 |
| 负向验证方式 | 恢复直接 sanitize `.con`、不去重、不排序、把日期 label 当作者，先删除“回复时间”再提取，或把导航链接当 footer 一并删除，编号 fixture 必须失败。 |
| 明确不覆盖范围 | 原站只提供最近 20 条时不补造更早历史；不新增妖火附件、发件箱或 Markdown，不执行真实回复。 |

## `REG-NOTIFY-038` 大字号回复工具与表情网格被截断或失去输入反馈

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`WRITE-01`；Topic/私信共享编辑器的工具可达性与视觉反馈 |
| 用户症状 | 130% 下工具栏末尾的引用、代码或列表无法通过横滑到达；输入光标仍是系统默认色；Discourse 表情同时显示英文名称，网格拥挤且不像可浏览的表情面板。 |
| 触发条件 | NodeSeek/linux.do Markdown composer 在窄屏或大字号下显示完整工具集合，或打开服务器返回的 Discourse emoji 目录。 |
| 根因 seam | ReplyComposer 的工具容器没有同时保证单行内容宽度、嵌套横向手势和末尾工具可达；TextInput 未声明主题 cursor/selection color；Discourse emoji 使用文字型可变宽单元，而不是图像优先等宽网格。工具栏具体布局由后续 `REG-NOTIFY-055` 收敛。 |
| 必须保持的行为 | 工具栏按 `REG-NOTIFY-055` 使用单行横向滑动，全部动作可达；输入光标和选区使用主题 primary。Discourse emoji 使用五列等宽图片网格，有图片时英文名只保留为 accessibility label，无图 fallback 才显示文字；图片上传、贴纸和所有原动作继续存在。 |
| 精确失败 oracle | `tests/ui/topic/reply-composer.test.tsx` 的 `REG-NOTIFY-038/055` 要求 toolbar `horizontal=true`、末尾“列表”可达、cursor/selection 为主题 primary；同文件表达式测试要求 Discourse list 为五列、`party parrot` 仍可通过无障碍找到但没有可见英文文本。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染真实共享 ReplyComposer；匹配 Android 以 130% + 键盘/表情开关确认布局和焦点反馈。 |
| Replay 或真实验收路径 | 在已有已读 NodeSeek 与 linux.do 私信中打开回复面板：NodeSeek 核对图片、贴纸和单行工具横滑；linux.do 核对五列表情图、无英文噪声和图片入口。只打开/取消，不选择图片、不发送。 |
| 负向验证方式 | 关闭横向手势、让工具换行或截断、删除末尾动作、移除 cursorColor/selectionColor，或恢复带图片表情的可见英文标签，编号测试必须失败。 |
| 明确不覆盖范围 | 不增加新格式动作、表情搜索/分类或附件能力；只恢复并重排既有能力。 |

## `REG-NOTIFY-039` 三站消息时间格式互相跳变

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02`；列表与会话时间呈现 |
| 用户症状 | 同一消息页同时出现“8/3 09:05”、`2026/7/3 13:46` 和 ISO 派生格式，跨年份或站点时难以快速比较；气泡时间与列表又使用不同 formatter。 |
| 触发条件 | 一部分 adapter 提供可解析 `createdAt`，另一部分只提供原站绝对 `displayTime`。 |
| 根因 seam | `notificationTimeText` 对两类时间分别调用通用相对格式和原字符串；会话气泡另直接使用 `formatDateTime`。 |
| 必须保持的行为 | 所有可确认的通知列表、详情头与会话气泡统一显示 `YYYY-MM-DD HH:mm` 的 24 小时绝对时间；站点 `/` 或 `-` 日期补零，无法确认时仍显示“时间未知”，不得猜测日期。 |
| 精确失败 oracle | `src/features/notifications/notificationPresentation.test.ts` 的 `REG-NOTIFY-039` 同时输入 ISO `createdAt` 与 `2026/7/3 13:46` fallback，必须得到 `2026-08-03 09:05` 和 `2026-07-03 13:46`；修复前前者为 `8/3 09:05`、后者保留斜杠。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：presentation 单测固定转换，Notifications RNTL/设备只读确认同一 formatter 被列表与气泡消费。 |
| Replay 或真实验收路径 | 聚合与三站单站列表对照多条已读记录，再打开已有已读私信；所有已知时间都应为完整年/月/日与分钟，未知值明确标记。 |
| 负向验证方式 | 列表恢复通用短日期、fallback 原样返回或气泡绕过 `formatNotificationTime`，编号单测或设备对照必须失败。 |
| 明确不覆盖范围 | 不显示秒、相对“几分钟前”、时区标签或推断缺年份的模糊时间。 |

## `REG-NOTIFY-040` 通知富文本链接脱离 App 主题色

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`；通知正文与会话气泡的链接 affordance |
| 用户症状 | 通知详情中的链接使用 `react-native-render-html` 默认蓝色，与 App primary、深浅主题和其他可点击文字不一致，看起来像未完成的网页片段。 |
| 触发条件 | 任一站点通知或聊天正文通过 `DetailHtml` 渲染 `<a href>`。 |
| 根因 seam | 共享 `DetailHtml` 只传 baseStyle，没有为 `a` 提供由 Reader theme 拥有的 `tagsStyles`。 |
| 必须保持的行为 | 消息详情、原消息和气泡内所有富文本链接统一使用当前主题 primary 且保持足够字重；HTML 解析、跳转协议和正文颜色不变。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-040` 渲染真实 `<a>` 并要求最终颜色等于 `createTheme(settings).primary`；修复前得到 renderer 默认 `#245dc1`。`tests/integration/style-ownership.test.ts` 同时固定 `detailLink` 由消息样式提供。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 必须经过真实 RenderHTML style 合并；设备以浅色/深色只读详情复核。 |
| Replay 或真实验收路径 | 打开包含链接的已有已读普通通知或妖火原消息，确认链接与 App accent 一致且正文仍可读；不需要点击外链。 |
| 负向验证方式 | 删除 `tagsStyles`、写死外部默认蓝或只改普通文本颜色，编号测试必须失败。 |
| 明确不覆盖范围 | 不改变链接目标、内外部导航策略、下划线或正文 HTML 内容。 |

## `REG-NOTIFY-041` 表情面板把回复操作压进 Android 导航栏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`WRITE-01`；共享 Composer Bottom Sheet 的大字号与安全区 |
| 用户症状 | 130% 下打开 NodeSeek 贴纸或 Discourse emoji 后，“取消/发送回复”被压到 Android 手势条后面；若简单放开高度，linux.do 表情面板又铺满整屏并留下过量空白。 |
| 触发条件 | Bottom Sheet 已到动态高度上限，同时 toolbar 换为两行并展开约 238dp 的 accessory panel，设备 bottom inset 非零。 |
| 根因 seam | `ComposerBottomSheet` 把最大动态内容高度固定为窗口 58%，子内容超过上限后仍继续布局；既有 bottom safe padding 因内容溢出而落到容器外。 |
| 必须保持的行为 | Topic 与三站私信共用的 Bottom Sheet 允许增长到 top-safe viewport 的 75%，并继续在内容底部追加 bottom inset；App 支持的 130% 最大字号下，标题、工具、表情/贴纸、输入和操作按钮均可见，操作按钮完整位于系统导航栏上方，同时不把空面板强制拉到全屏。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-041` 注入 top/bottom 24 与真实窗口高度，要求共享 sheet 的 `maxDynamicContentSize=round((height-top)×0.75)`；修复前固定 58% 得到 774 而不是 983。设备截图进一步固定 130% 展开 accessory 时两枚操作按钮不与手势条重叠。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定共享 sheet 边界，Android 真实布局固定动态测量、键盘和系统 inset；两者不可互相替代。 |
| Replay 或真实验收路径 | 130% 下分别打开 NodeSeek 贴纸与 linux.do emoji；确认底部操作完整、面板仍可滚动、键盘切换后不跳出屏幕。随后取消并恢复 100%，不选择图片或发送。 |
| 负向验证方式 | 恢复 58% 上限、移除 bottom padding，或改为全窗口上限导致表情列表把 sheet 顶满并产生大面积空白，设备验收必须失败。 |
| 明确不覆盖范围 | 不引入新 Bottom Sheet 库、不做可拖拽多档高度或横屏专项重排；只修共享现有面板的支持字号和安全区。 |

## `REG-NOTIFY-042` 妖火气泡外斜杠时间在 Android 丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`；妖火已读私信会话时间 |
| 用户症状 | 妖火聊天气泡能显示作者、图片和正文，但真实已读会话的气泡下没有时间。 |
| 触发条件 | 原站把“回复时间”放在同一 `.listmms` 行内、但不放在 `.info` 或 `.bubble .con` 中，并使用 `2026/7/3 13:45:52` 斜杠格式。Node/V8 会宽松解析该值，Android/Hermes 不保证接受。 |
| 根因 seam | `chatMessages` 只从 `.info` 与正文节点取时间；共享 `toIsoString` 又只规范化连字符日期，导致 Node 测试偶然通过而 Android 返回 null。 |
| 必须保持的行为 | 时间可以位于消息行内任意原站包装节点；parser 先从 `.info` 取标准时间，再从当前行的“回复时间”取后备。共享时间入口把斜杠或连字符日期补齐为标准 ISO 形态后再解析，随后仍清除包装并按真实时间排序。 |
| 精确失败 oracle | `src/sources/yaohuo/notifications.test.ts` 的 `REG-NOTIFY-042` 把秒级“回复时间”移到正文气泡外，并让 `Date.parse` 拒绝含斜杠输入以模拟严格运行时；修复前消息时间为 null、顺序错误，修复后为 `2026-07-03T05:45:52.000Z`。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：fixture 固定解析边界，身份匹配的已读妖火会话确认气泡时间实际可见。 |
| Replay 或真实验收路径 | 妖火 → 聊天 → 已读 Clover 会话，确认图片气泡下显示 `YYYY-MM-DD HH:mm`；不打开回复器、不发送。 |
| 负向验证方式 | 把 reply-time 提取恢复为只读取 `.bubble .con`，或把共享日期规范化恢复为仅支持连字符，编号测试会得到 null/顺序错误，真实会话再次缺时间。 |
| 明确不覆盖范围 | 不从消息列表时间猜测每条历史气泡时间；原站未提供时间时继续显式未知。 |

## `REG-NOTIFY-043` Discourse 私信从所有通知进入时退化为普通帖子

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02`、`WRITE-01`；Discourse 私信跨分类详情一致性 |
| 用户症状 | linux.do 同一条消息在“所有通知”列表已经显示“发来了私信”，点进去却是普通通知/帖子详情；从“个人信息”点进去才显示完整私信会话和回复入口。 |
| 触发条件 | `/notifications` 返回 private-message notification type，并同时携带 `topic_id` 与 `post_number`；“个人信息”菜单随后会做私信 target 转换，而“所有通知”直接使用通用 mapper 结果。 |
| 根因 seam | `parseNotification` 正确生成了 `kind=private-message`，但 target 仍无条件按 `topic_id/post_number` 生成 `topic-post`；详情 loader 按 target 分支，因此丢失会话与回复能力。 |
| 必须保持的行为 | Discourse notification 一旦识别为 `private-message` 且具有合法 `topic_id`，任何分类都生成 `private-conversation`；“所有通知”与“个人信息”必须指向同一 conversation ID，并加载完整正序会话与 Markdown reply。普通 mention/reply 继续使用精确 `topic-post`。 |
| 精确失败 oracle | `src/sources/discourseNotifications.test.ts` 的 `REG-NOTIFY-043` 让同一条 type 6 notification 同时经过 All 与 Personal Info；修复前两者分别为 `topic-post:202/2` 和 `private-conversation:202`，修复后 target 相同且 All 详情返回两条会话消息与 Markdown reply。 |
| 最低可靠自动测试层 | `UNIT_PASS`：共享 Discourse adapter fixture；linux.do 使用同一 mapper。 |
| Replay 或真实验收路径 | linux.do → 所有通知，只打开一条已经确认已读的私信，再从个人信息打开同一会话；两处都应显示相同聊天详情和回复入口。不得用未读条目验收，避免触发原站已读写入。 |
| 负向验证方式 | 恢复“所有带 topic_id 的 notification 一律生成 topic-post”，编号测试必须稳定看到两个分类 target 不相等。 |
| 明确不覆盖范围 | 不发送真实私信、不上传图片、不以点击未读条目代替只读验收；缺少 `topic_id` 的通知保持信息型详情，不猜 conversation ID。 |

## `REG-NOTIFY-044` 妖火会话主题链接跳出 App 打开浏览器

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`TOPIC-01/03`、`NAV-01/03`；妖火通知详情到现有主题页的站内导航 |
| 用户症状 | 妖火会话里的“查看主题帖”和“查看完整回复”点击后打开系统浏览器，离开 App；部分真实会话中“查看完整回复”还会被清理器直接删除。 |
| 触发条件 | 妖火详情 HTML 包含 `/bbs/book_view.aspx?id=…` 或 `/bbs/book_re.aspx?id=…` 链接，并由消息页的 `DetailHtml` 渲染。 |
| 根因 seam | 妖火 adapter 把“查看完整回复”误当作 footer 包装删除；消息 `DetailHtml` 又未复用 `parseForumTopicLink`，所有锚点都沿 renderer 默认行为交给 `Linking.openURL`，且 route callback 无法携带解析后的 Topic。 |
| 必须保持的行为 | 两个导航链接及 href 均保留；受信任的妖火主题/回复 URL 统一经过现有 `parseForumTopicLink`，携带解析后的 Topic 进入 App 现有 `Topic` route；“查看完整回复”的精确楼层另由 `REG-NOTIFY-045` 固定。无法识别的普通外链继续走系统外链行为，不能被错误吞掉。 |
| 精确失败 oracle | `src/sources/yaohuo/notifications.test.ts` 要求两个绝对 href 均保留；`tests/ui/notifications/notifications-screen.test.tsx` 的 `REG-NOTIFY-044` 点击两个链接后要求 `Linking.openURL` 零调用，`onOpenTopic` 两次收到 `{ source: 'yaohuo', id: '321' }`。修复前两个链接均调用外部浏览器，且 callback 零调用。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：adapter fixture 固定 HTML 清理边界，RNTL 固定链接分流，匹配 App 只读确认两个入口都停留在 App 内。 |
| Replay 或真实验收路径 | 妖火 → 聊天 → 已有已读会话；分别点击“查看主题帖”和“查看完整回复”，确认都进入 App 内 Topic，返回后仍回到同一会话。不得发送回复。 |
| 负向验证方式 | 删除任一链接、绕过共享 parser 或恢复 bare `RenderHTML` 链接处理，编号测试必须分别因 href 缺失、外链调用或 Topic callback 缺失而失败。 |
| 明确不覆盖范围 | 本条只固定两个原站 URL 都进入主题详情；`tofloor` 精确楼层定位由 `REG-NOTIFY-045` 覆盖。不开启真实回复、上传或已读写入。 |

## `REG-NOTIFY-045` 妖火“查看完整回复”进入主题后丢失具体楼层

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`NAV-03`；妖火私信完整回复的精确楼层定位 |
| 用户症状 | “查看完整回复”已经留在 App 内，但进入主题后仍停在主楼，用户还要手动寻找原站指向的具体回复。 |
| 触发条件 | 妖火已读聊天详情给出真实 `book_re.aspx?classid=…&id=…&tofloor=90&fromuserid=…` 链接；原站用 `tofloor` 返回包含该楼层的回复页。 |
| 根因 seam | `DetailHtml` 只调用 `parseForumTopicLink` 得到 canonical Topic，原始 query 被丢弃；`onOpenTopic` 与 Notification route 也没有继续传递链接级 `targetReply`。 |
| 必须保持的行为 | 仅对 `www.yaohuo.me`/`yaohuo.me` 的 `/bbs/book_re.aspx` 读取正安全整数 `tofloor`；携带 `{ floor }` 进入现有 Topic route，由共享目标回复加载与滚动逻辑定位。普通主题链接不附加目标；缺失、零值、小数或站外伪链接不得猜楼层。 |
| 精确失败 oracle | `src/domain/forum/links.test.ts` 要求真实形态链接解析为 `{ floor: 90 }` 并拒绝无效/站外值；`tests/ui/notifications/notifications-screen.test.tsx` 点击两个链接后要求只有“查看完整回复”的第二次 callback 带 `{ floor: 90 }`；`tests/ui/notifications/notifications-route.test.tsx` 继续要求 `navigation.navigate('Topic', { topic, targetReply: { floor: 90 } })`。修复前第二次 callback 只有 Topic。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：domain parser 固定协议与校验，Notifications Screen/Route RNTL 固定参数不丢失，匹配 App 只读确认最终滚到目标楼层。 |
| Replay 或真实验收路径 | 妖火 → 聊天 → 已有已读 Clover 会话 → 查看完整回复；确认仍在 App、主题自动加载需要的回复页并滚到原站 `tofloor` 指向的楼层。返回后仍回到会话，不发送回复。 |
| 负向验证方式 | 去掉 query parser、把 `tofloor` 当分页号、只传 Topic，或接受 `tofloor=0/1.5` 与站外同形 URL，编号测试必须失败。 |
| 明确不覆盖范围 | 不根据 `page`、`reply`、消息时间或正文猜目标；没有合法 `tofloor` 时只打开主题。不新增妖火专用主题页或真实写操作。 |

## `REG-NOTIFY-046` 妖火目标楼层线性追页且分页被同名用户劫持

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`USER-01`；妖火目标楼层与共享分页游标 |
| 用户症状 | “查看完整回复”进入主题后可能从第 2 页逐页请求到目标页；普通帖子或用户列表遇到昵称为“下一页”的用户时，还会提前停止分页或跳进用户主页。 |
| 触发条件 | 原站 `book_re.aspx?...&tofloor=90` 一次响应落到第 16 页，HTML 的 `page` 表单字段为 16；Android Native Fetch 的 `Response.url` 仍可能是无 `page` 的请求 URL。页面同时含第 17 页游标；第 10 页正文中又存在文本恰为“下一页”的用户链接。 |
| 根因 seam | Topic 目标回复加载只保留 `{ floor }`，沿通用“加载更多”从当前页线性追赶；初次直达实现又把可选的 `Response.url` 当成唯一当前页依据，缺失时回退为 1，下一次错误请求第 2 页。妖火 HTML parser 还把链接文本当成分页身份，未要求合法 `page` 游标和对应列表 endpoint。 |
| 必须保持的行为 | 妖火合法目标楼层只发送一次 `tofloor` 请求，以最终 URL 的正页码为首选、原站 HTML 的当前 `page` 字段为 Android 兜底，建立真实分页锚点；原站 page 1 最新且页码递增表示更早，因此正序定位到第 16 页后向下读取第 15 页、向上读取第 17 页，不保留第 1 页与第 16 页之间的假连续列表，也不得退回逐页扫描。目标响应不含该楼层时明确失败。帖子回复、Feed、用户帖子和用户回复都只能接受带正页码的真实分页链接；同名用户链接不能成为 cursor。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 固定任意锚点窗口只按 adapter 返回的双向 cursor 请求、目标页替换首屏且不补中间页；`src/sources/yaohuo/reader.test.ts` 的 `REG-NOTIFY-046` 模拟 Android 的无重定向 `Response.url`，要求从 HTML `page=16` 恢复 `currentPage`，并把正序 `previousPage=17`、`nextPage=15` 返回给 Controller；同名用户链接不能成为帖子回复、用户帖子或用户回复 cursor。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：parser/reader 固定原站协议，Topic controller 固定跨页状态机，匹配 App 只读确认目标楼层与继续下滚。 |
| Replay 或真实验收路径 | 妖火 → 聊天 → 已有已读会话 → 查看完整回复；确认一次定位到目标楼层，继续下滚加载紧邻下一页且没有回到页首。再打开包含同名用户的普通主题，确认仍可继续分页。不发送回复、不改变已读状态。 |
| 负向验证方式 | 恢复按 `topicReplies.length` 反复调用通用加载更多，或在 `Response.url` 无页码时直接回退 1，编号测试都会出现页 2；恢复“第一个文本为下一页的链接”，parser 测试会得到用户主页或 `nextPage=null`。 |
| 明确不覆盖范围 | 原站未提供可调 page-size，不能伪造批量页长；不并发抓取 2～16，不拼接有缺口的第 1/16 页，不用正文、时间或总回复数猜目标页。 |

## `REG-NOTIFY-047` NodeSeek 完整主题链路丢弃 comment ID

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`；NodeSeek 通知到目标回复的强身份传递 |
| 用户症状 | 通知详情能找到准确回复，但“查看完整主题”在缺少楼层时留在首屏；楼层提示错误时还可能定位到同楼层的其他回复。 |
| 触发条件 | NodeSeek 通知 target 带合法 `commentId`，但 floor 缺失或错误；目标不在当前 Topic 窗口。 |
| 根因 seam | Topic Controller 把 floor 当成必填目标，且共享读取接口只继续传 `targetFloor/pageHint`，路由已有的完整 `ReplyLocationTarget` 在到达 NodeSeek adapter 前被压扁。 |
| 必须保持的行为 | Route → Controller → ReadGateway → source adapter 必须传递完整 `ReplyLocationTarget`；`commentId` 存在时为强身份，floor/pageHint 只决定首个候选页。NodeSeek 先读提示页，再在响应 `postPageCount` / pager 给出的已知页界内查找精确 comment ID；只允许返回包含目标实体的来源确认窗口。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 的 `REG-NOTIFY-047` 只给 `{ commentId: 31 }`，要求 gateway 收到完整 target；`tests/integration/source-read-contracts/` 分别给缺 floor 和错误 floor，要求请求页为 `[1,2,3]` 与 `[2,1,3]`，最终均返回 comment 31 所在页且不依赖 `replyCount`。修复前 Controller 零请求或返回首屏同楼层 decoy。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：来源读取契约固定跨页强身份，Controller RNTL 固定接口不丢字段。 |
| Replay 或真实验收路径 | 从一条已有已读 NodeSeek @我/回复打开详情，再点“查看完整主题”；只读确认落到原消息对应回复。不得点击未读条目制造已读写入。 |
| 负向验证方式 | 恢复 floor 必填、在 gateway 拆成 `targetFloor`，或以 floor 命中代替 comment ID，两个编号测试必须稳定失败。 |
| 明确不覆盖范围 | 不按作者、正文或时间猜目标；原站没有可确认页拓扑且提示页不含目标时明确失败，不进行无界扫描。 |

## `REG-NOTIFY-048` NodeSeek `message_id` 兼容值只用于去重未进入导航目标

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02/03`；NodeSeek 旧字段兼容与统一消息身份 |
| 用户症状 | 某些 NodeSeek @我/回复行可以稳定显示和去重，但打开完整主题时没有精确 comment ID，只能退化到楼层。 |
| 触发条件 | 列表行省略 `comment_id`，只提供兼容字段 `message_id`。 |
| 根因 seam | mapper 用 `comment_id || message_id` 生成通知 ID，却只把 `comment_id` 写入 `target.postId`，同一个远端身份在投递和导航模型中分叉。 |
| 必须保持的行为 | 一次解析得到的 `commentId = comment_id || message_id` 同时用于稳定通知 ID 与 `topic-post.postId`；原始列表行 `id` 仍只供远端 mark-read。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-048` 输入只含 `message_id=98` 的回复行，要求 target 同时得到 `postId='98'`。修复前通知 ID 正确但 target 缺失 postId。 |
| 最低可靠自动测试层 | `UNIT_PASS`：NodeSeek adapter fixture。 |
| Replay 或真实验收路径 | 只有原站实际返回此旧字段形态时，才用已有已读通知只读确认完整主题定位；否则保留自动证据。 |
| 负向验证方式 | target 继续只读 `comment_id` 时编号断言必须失败。 |
| 明确不覆盖范围 | 不把列表行 `id`、作者或楼层猜成 comment ID，不改变 mark-read 协议。 |

## `REG-NOTIFY-049` 身份待确认被当成换号并清空私信草稿

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`NOTIFY-02`；私信草稿与身份屏障 |
| 用户症状 | App 短暂重新确认账号时，正在编辑但未发送的私信草稿被清空；确认仍为同一账号后无法恢复。 |
| 触发条件 | 当前来源暂时从 active 集合移除，但 route 捕获的 `identityKey` 与最近可信 `currentIdentityKey` 仍相同；随后同身份恢复。 |
| 根因 seam | Notification route 在任何 `canAccessSource=false` 时无条件清草稿，把真正 unknown 或登录 surface barrier 的暂停访问误当成已确认退出或换号。 |
| 必须保持的行为 | confirmed 身份核对中继续可用；真正 unknown 或登录 surface barrier 立即取消网络、关闭 composer 并隐藏私有内容，但保留内存草稿。只有确认 `currentIdentityKey !== route identityKey` 的退出或换号才清空。草稿仍不得持久化。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-route.test.tsx` 的 `REG-NOTIFY-049` 输入草稿后经历同身份 barrier → 恢复，要求正文仍在；再经历已确认身份切换 → 恢复，要求正文为空。修复前第一段即变空。 |
| 最低可靠自动测试层 | `UI_PASS`：route RNTL 固定用户可见草稿生命周期。 |
| Replay 或真实验收路径 | 不主动制造账号失效；匹配环境若自然出现登录 surface barrier，可确认 composer 暂停且同身份恢复后草稿仍在。 |
| 负向验证方式 | 恢复按 `canAccessSource` 无条件 `setReplyContent('')`，同身份恢复断言必须失败。 |
| 明确不覆盖范围 | 不跨 route、重启或确认换号保存草稿；不发送真实私信。 |

## `REG-NOTIFY-050` 消息共享 Tab 与按钮绕过 Reader 字号

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-03`、`FEED-02/03/04`、`SEARCH-02/03`、`LIBRARY-01/02/03`、`TOPIC-01/03`、`USER-01`、`ACCOUNT-01/02`、`NOTIFY-01/02`、`WRITE-01`；共享控件大字号一致性 |
| 用户症状 | 消息正文随 Reader 字号放大，但来源/分类 Tab 与详情、回复操作按钮仍保持小号，130% 档位下层级割裂且可读性下降。 |
| 触发条件 | Reader `fontScale=1.3`，消息页使用共享 `PillRail` 或 `AppButton/IconButton`。 |
| 根因 seam | 两个共享控件虽然读取 Reader font family/theme，却把 11/12/13/15 和 line-height 写成固定值。 |
| 必须保持的行为 | SelectionControls 与 ButtonControls 的所有文字字号和 tiny line-height 使用同一 Reader fontScale；点击区下限与横向滚动保持不变。 |
| 精确失败 oracle | `tests/ui/shared/accessibility-basics.test.tsx` 的 `REG-NOTIFY-050` 在 130% Provider 中要求 Tab 与 AppButton 的 13 号基准均为 17。修复前两者仍为 13。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY`：RNTL 固定数值，设备复核 100%/130% 布局。 |
| Replay 或真实验收路径 | 匹配 APK 在 Reader 100% 与 130% 分别打开消息总览、详情和 composer，确认 Tab/按钮随字号变化且文字不截断。 |
| 负向验证方式 | 任一共享控件恢复固定 fontSize，编号断言失败。 |
| 明确不覆盖范围 | 不改变图标尺寸、点击区、系统 fontScale 策略或新增字号档位。 |

## `REG-NOTIFY-051` 妖火已读复核丢失分类上下文

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-01/02`；妖火分类列表与逐条已读确认 |
| 用户症状 | 从“系统”或“聊天”分类打开消息后，原站已经标为已读，App 仍提示“原站仍显示为未读”。 |
| 触发条件 | 条目来自非默认分类或第 2 页以后；详情读取后 `markRead` 重新检查列表。 |
| 根因 seam | adapter 只把页码塞进 `remoteGroup`，复核时回到默认收件箱，丢失原分类；分类与 cursor 两种来源上下文被压成一个字段。 |
| 必须保持的行为 | adapter 分别保存 opaque `remoteGroup=categoryId` 与 `remoteCursor=page`；逐条已读复核必须读取原分类、原页，且仍只以原站列表 unread 状态确认。 |
| 精确失败 oracle | `src/sources/yaohuo/notifications.test.ts` 的 `REG-NOTIFY-051` 从 system 第 2 页建立条目，要求保存 `{ remoteGroup: 'system', remoteCursor: '2' }`，随后复核 URL 同时含 `issystem=1&page=2` 并确认已读。修复前 group 为 `2` 且复核默认收件箱。 |
| 最低可靠自动测试层 | `UNIT_PASS`：妖火 adapter fixture 固定分类、页码与明确已读 oracle。 |
| Replay 或真实验收路径 | 真实逐条已读属于远端写入；只有另获妖火测试对象授权后才可从系统/聊天非首分页执行 `LIVE_PASS`。 |
| 负向验证方式 | 删除任一上下文字段或复核默认 `all/page=1`，编号测试必须失败。 |
| 明确不覆盖范围 | 不以打开详情本身假定已读，不执行批量已读，不把旧错误字段形态做猜测兼容。 |

## `REG-NOTIFY-052` More 红点没有指向消息入口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`、`MORE-02`；共享 More 未读提示 |
| 用户症状 | 底部“更多”出现红点，但进入 More 后“消息通知”入口没有任何红点，用户无法判断提示来自消息还是版本更新。 |
| 触发条件 | notification runtime 的 `unreadTotal > 0` 点亮合并后的 More badge；用户进入 More 查找来源。 |
| 根因 seam | `useAppRuntime` 只把未读状态压成中文 summary 传给 `MoreUtilityPanels`，消息入口没有结构化未读字段，也没有渲染视觉标记。 |
| 必须保持的行为 | 未读消息同时点亮底栏 More 与“消息通知”入口的主题 danger 红点；未读清零时行内红点立即消失。可用更新可以独立点亮 More，但不得误亮消息入口；现有摘要、点击区域、分隔线和无障碍文案保持。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 的 `REG-NOTIFY-052` 以真实 More renderer 注入 `hasUnread=true`，要求出现 8dp theme-danger 行内圆点；改为 false 后必须消失。修复前组件树中不存在该圆点。`src/ui/navigation/moreBadge.test.ts` 继续固定 update 与 messages 的独立状态。 |
| 最低可靠自动测试层 | `UI_PASS + UNIT_PASS`：RNTL 固定 More 行内视觉归因，现有纯函数测试固定底栏状态不会混淆更新和消息。 |
| Replay 或真实验收路径 | 匹配 APK 保留一条现有未读，确认底栏 More 与 More 内“消息通知”同时有红点；未读清零属于远端写入，不额外执行。若只有可用更新，消息入口必须无红点。 |
| 负向验证方式 | 删除 `hasUnread`、从 summary 文案解析状态、把合并后的 `moreBadgeState !== none` 传给消息入口，编号测试或 update-only 对照必须失败。 |
| 明确不覆盖范围 | 不增加数字角标、动画、Toast、自动跳转或新的通知状态；不改变未读计算、Android 摘要或已读协议。 |

## `REG-NOTIFY-053` 主题级通知被强制定位到不存在的具体帖子

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`NAV-03`；共享通知目标语义 |
| 用户症状 | 点击主题提醒、系统通知或只有主题关系的消息时，详情提示“站内消息没有可定位的帖子”或进入主题后提示找不到对应回复。 |
| 触发条件 | Discourse 通知只有 `topic_id`/主题 URL，没有 `post_id` 或 `post_number`；NodeSeek @我/回复行只有主题 ID，没有 comment ID 或 floor。 |
| 根因 seam | 来源 mapper 把所有带主题身份的通知都生成 `topic-post`，详情 loader 因而强制查找具体帖子，route 又把不存在的定位信息传给 Topic。 |
| 必须保持的行为 | 只有原站显式提供 `postId`、`postNumber`、comment ID 或 floor 时才生成 `topic-post`；只有主题身份时生成 `topic`，详情直接使用通知正文或主题正文，不做精确帖子查找。“查看相关主题”只传 Topic 且不含 `targetReply`。私信与显式帖子通知的既有协议保持不变。 |
| 精确失败 oracle | `src/sources/discourseNotifications.test.ts` 的 `REG-NOTIFY-053` 用只有 `topic_id` 的 topic reminder 固定修复前“没有可定位的帖子”错误，并要求详情零额外 transport；`src/sources/nodeseek/notifications.test.ts` 固定无 comment ID/floor 的主题行；`tests/ui/notifications/notifications-route.test.tsx` 要求导航参数中的 `targetReply` 为 `undefined`。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：adapter fixture 固定来源目标语义，RNTL 固定 Topic 导航边界。 |
| Replay 或真实验收路径 | 在匹配 revision/APK 的消息中心选择一条已有已读主题提醒或系统通知；详情应显示通知内容，点击“查看相关主题”进入主题且不出现回复定位失败。不得点击未读条目或执行全部已读。若账号没有此类已读样本，设备项记 `NOT_VERIFIED`，以确定性 fixture 为主要 oracle。 |
| 负向验证方式 | 把 `topic` 合并回可选定位字段的 `topic-post`、按通知 kind/标题猜楼层，或 route 为主题级通知制造空 `ReplyLocationTarget`，编号测试必须失败。 |
| 明确不覆盖范围 | 不新增通知类型、服务端能力、消息专用主题页或导航状态机；不为缺失定位字段的通知扫描回复，也不改变原站已读协议。 |

## `REG-NOTIFY-054` Discourse 首帖通知被当作回复楼层定位

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`NAV-03`；共享 `TOPIC-03` |
| 用户症状 | 在消息详情点击“查看相关主题”后，主题正文已正常打开，却额外提示“目标楼层未找到”；现场样本为 linux.do 已读系统消息“LINUX DO 社区抽奖规则”。 |
| 触发条件 | Discourse 通知明确携带 opening post 的 `post_id` 与 `post_number=1`；详情需要按 `post_id` 读取完整通知正文，但主题导航不应把 opening post 当作回复。 |
| 根因 seam | `NotificationDetailRoute` 复用同一个 `topic-post` target 同时决定详情读取和 Topic 回复定位，把首帖的 post ID 与 post number 1 无条件转换成 `{ commentId, floor: 1 }`；Topic 回复集合不包含 opening post，因此定位必然失败。 |
| 必须保持的行为 | 来源 target 继续保留 `topic-post` 与 `postId`，保证详情能读取完整首帖；只有在导航到 Topic 时，Discourse `postNumber === 1` 视为主题 opening post并省略 `targetReply`。post number 大于 1 的显式帖子、NodeSeek comment ID/floor、妖火 `tofloor` 等既有精确定位必须保持。判断只依赖来源协议和 post number，不按通知 kind、标题或正文猜测。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-route.test.tsx` 的 `REG-NOTIFY-054` 构造 linux.do `topic-post { postId: 777, postNumber: 1 }`：修复前导航携带 `{ commentId: 777, floor: 1 }`，修复后 `targetReply` 必须为 `undefined`；同文件 `REG-NOTIFY-045/053` 与来源 adapter 测试继续固定普通主题和真实回复定位。 |
| 最低可靠自动测试层 | `UI_PASS`：错误发生在详情 target 到 Topic route 参数的投影，RNTL 是最低确定性层。 |
| Replay 或真实验收路径 | 在匹配开发包中打开已有已读 linux.do 系统消息“LINUX DO 社区抽奖规则”，确认详情正文完整；点击“查看相关主题”后主题正常结算且不出现楼层定位提示。全程只读，不打开未读消息、不回复或互动。 |
| 负向验证方式 | 删除 opening-post 判断、按 `kind === system` 粗略关闭所有定位，或把首帖 target 改成 `topic` 导致详情正文退化，编号测试或相邻精确帖子回归必须失败。 |
| 明确不覆盖范围 | 不改变 Discourse 通知 target 类型、详情 transport、已读协议或 Topic 回复窗口；`postNumber` 缺失时不根据 post ID 或正文猜 opening post。 |

## `REG-NOTIFY-055` 共享回复工具栏回归为两行换行

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`WRITE-01`；Topic 与私信共享 ReplyComposer |
| 用户症状 | 富文本输入框上方的格式工具从原有单行横向滑动变成两行，挤占正文与键盘之间的编辑空间；Topic 和私信入口同时受影响。 |
| 触发条件 | NodeSeek、linux.do显示完整格式工具，尤其在窄屏或 Reader 字号 130% 时打开 Topic/已有私信的 Bottom Sheet。 |
| 根因 seam | `src/ui/composer/ReplyComposer.tsx` 把 toolbar 从横向 `GestureScrollView` 改为普通 `View`，并在同一 style 加入 `flexWrap: 'wrap'`。历史 `REG-NOTIFY-038` 又把两行写成测试标准，导致回归被主动锁定。 |
| 必须保持的行为 | Topic 与私信共用同一个横向 `GestureScrollView`；toolbar `horizontal=true`、`nestedScrollEnabled=true`、禁止换行并隐藏系统滚动指示器。100%/130% 下末尾“列表”均可横滑到达，全部既有格式、图片、贴纸、五列表情、主题光标/选区和焦点恢复保持；Bottom Sheet 操作按钮仍位于 Android bottom safe-area 上方。不增加入口级布局参数。 |
| 精确失败 oracle | `tests/ui/topic/reply-composer.test.tsx` 在真实 `ReaderStyleProvider` 的 100%/130% 两档渲染共享组件，要求 toolbar `horizontal=true`、嵌套手势开启、系统指示器隐藏、content 为单行 `row` 且无 `flexWrap`，并能按 accessibility label 找到末尾“列表”。修复前两档都得到 `horizontal=undefined`。既有格式插入、主题光标和五列表情用例继续通过。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染真实共享 ReplyComposer；纯样式字符串或只检查工具存在不能证明横向容器与两档字号行为。 |
| Replay 或真实验收路径 | 匹配 revision/APK 在一个可回复 Topic 和一个已有已读私信分别以 100%/130% 打开编辑器，横滑至末尾“列表”，展开表情/贴纸并关闭；不选择图片、不发送，验收后恢复原字号。 |
| 负向验证方式 | 恢复普通 `View`、加入 `flexWrap`、只在 Topic 或私信入口单独包 ScrollView、显示两行，或隐藏末尾工具，编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不新增格式动作、滚动指示器、入口级布局开关、键盘方案或附件能力；不改变表情网格、草稿、上传、提交与 safe-area 所有权。 |

## `REG-NOTIFY-056` NodeSeek 私信把字符串会话 ID 直接作为 receiver UID 发送

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`、`WRITE-01`；NodeSeek 私信 adapter 的真实 wire contract |
| 用户症状 | App 原生 NodeSeek 私信回复后保留草稿并提示“NodeSeek 请求失败：HTTP 200”；刷新原生会话和 App 内 NodeSeek 原站同一会话都看不到该消息。 |
| 触发条件 | 通知领域 target 使用字符串 `conversationId`，NodeSeek 原站 `/api/notification/message/send` 却要求 JSON 中的 `receiverUid` 为 number；当前 App 内原站控制组使用 number 时发送成功。 |
| 根因 seam | `src/sources/nodeseek/notifications.ts` 把领域层字符串身份未经 adapter 转换直接泄漏到站点 JSON。旧测试又把字符串 receiver UID 与自造 `{ success: true }` 同时写进 Mock，只证明实现符合自身假设，没有固定真实协议。 |
| 必须保持的行为 | adapter 只接受十进制数字形式的会话 ID，转换后必须是大于零的 JavaScript 安全整数，并以 number `receiverUid` 发送；空值、非数字、`0` 和超出安全整数范围的值必须零请求，不能舍入成另一个 UID。内容继续 trim，`markdown: true`，复用现有 NodeSeek action client、当前身份与 route-owned `AbortSignal`；不乐观插入消息，只有精确 `success === true` 才确认发送。失败或未确认继续保留草稿，确认成功后沿既有 Query 失效链刷新会话、单站/聚合列表与未读快照。 |
| 精确失败 oracle | `src/sources/nodeseek/notifications.test.ts` 的 `REG-NOTIFY-056` 从公开 adapter 接口输入 `conversationId: '51153'`，Mock 对字符串 receiver UID 返回失败、对 number 返回 App 内原站捕获到的 `{ success: true }`；修复前精确拒绝为“NodeSeek 请求失败：HTTP 200”，修复后 body 必须等于 `{ receiverUid: 51153, content: trimmedContent, markdown: true }` 且只请求一次。参数化用例固定空值、非数字、`0` 和 `9007199254740992` 零请求，另一个用例固定模糊响应不得得到 `confirmed: true`。 |
| 最低可靠自动测试层 | `UNIT_PASS`：来源 adapter 的 Vitest 是 wire type、输入边界和确认语义的最低确定性层；gateway 与通知 route 既有测试继续固定身份/取消零请求、草稿保留、单次提交和 Query 失效。 |
| Replay 或真实验收路径 | 仅在用户明确授权的 NodeSeek 账号 `凡想世界（UID 54874）` 与 `KongB（UID 51153）` 之间测试。先从 App 内原站同一会话以 Markdown 发送唯一 `WZ-NS-ORIGIN-*` 标记并脱敏记录请求字段/类型，再从原生会话发送唯一 `WZ-NS-NATIVE-*` 标记；确认 App 明确成功、草稿清空、原生与 App 内原站均只出现一条相同消息，force-stop 重开后仍可由服务端读取。每次发送前同时核对当前账号、目标 UID 与 KongB 会话标题，任一不符立即停止。 |
| 负向验证方式 | 恢复字符串 `receiverUid`、仅调用 `Number()` 而不检查正安全整数、把任意 2xx/非 `success:false` 当成功、失败时清草稿或乐观插入消息，编号测试或既有 gateway/route 回归必须失败。 |
| 明确不覆盖范围 | 不改变公开 navigation、notification target 或 gateway API，不改 headers/Cookie/CSRF，不新增重试、新建/搜索/删除私信，不调整私信时间、气泡或问题诊断样式，也不修改 linux.do、妖火的回复协议；其他站点真实写入保持 `NOT_VERIFIED`。 |

## `REG-NOTIFY-057` NodeSeek 私信把表情码当作普通文字渲染

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02`；共享 `TOPIC-02` 的论坛 sticker 内容渲染 seam |
| 用户症状 | App 原生 NodeSeek 私信会话把 `:ac04:` 原样显示在气泡内；App 内 NodeSeek 原站的同一条消息显示粗体 Markdown 与 AC 娘图片，双方内容语义不一致。 |
| 触发条件 | NodeSeek 私信发送使用 `markdown: true`，详情 adapter 收到原始 Markdown 后只交给通用 Markdown parser；已知 NodeSeek shortcode 没有转换成原站的 `<img class="sticker">`，通知详情又只使用 bare `RenderHTML`，没有评论路径的 sticker element model 与媒体 renderer。 |
| 根因 seam | NodeSeek 已知表情目录只属于 composer UI，来源 adapter 无法复用；评论的 sticker element model、ExpoImage renderer 和图片尺寸 cache 又封装在 Topic feature 内，导致私信输入归一化与展示分别绕过同一套论坛内容能力。 |
| 必须保持的行为 | NodeSeek adapter 只把现有表情目录中的精确 shortcode 转成原站同语义的 sticker HTML，Markdown 强调继续由既有 parser 处理，行内/围栏代码中的 shortcode 和未知 shortcode 保持文字；sanitizer 继续作为最终 HTML 门禁。通知详情只对 sticker 执行评论已有的流式布局，复用同一个 custom element model、ExpoImage、来源媒体身份和 512 项尺寸 cache；普通 Markdown 图片继续走原 `img` 路径。首次进入会话时，sticker 异步取得自然尺寸并撑高内容后仍要定位最新消息；用户开始拖动后停止跟随，不能抢走其阅读位置。Topic 正文与评论的 sticker、行内媒体、视频和链接卡片行为不得变化，也不得新增私信专用 renderer。 |
| 精确失败 oracle | `src/sources/nodeseek/markdown.test.ts` 的 `REG-NOTIFY-057` 输入粗体、已知 shortcode、行内/围栏代码与未知 shortcode，要求只生成一张精确 NodeSeek sticker；`src/sources/nodeseek/notifications.test.ts` 再从公开 adapter 的私信详情入口固定同一结果；`src/domain/forum/forumContentMedia.test.ts` 固定 sticker 升级但普通图片不被接管；`tests/ui/notifications/notifications-screen.test.tsx` 从通知详情公开界面同时断言粗体语义与可访问的 `ac04` 图片；`src/features/notifications/conversationAutoScroll.test.ts` 固定同一会话连续内容扩展时保持跟随、用户拖动后停止、新会话恢复跟随。修复前 adapter 测试看到原始 `:ac04:`，UI 测试落入默认图片路径且无法稳定渲染 sticker，异步尺寸更新又会把最新 sticker 挤到固定回复栏下。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：Vitest 固定来源转换和共享媒体 HTML 变换，Jest/RNTL 固定通知详情实际使用共享 sticker renderer；Topic 既有媒体与 HTML rendering controller 回归固定抽取前后的评论行为。 |
| Replay 或真实验收路径 | 仅打开用户已授权的 NodeSeek `凡想世界（UID 54874）` 与 `KongB（UID 51153）` 会话。App 内原站已发送并确认唯一消息 `**WZ-NS-RENDER-20260808-172820** :ac04:`：原站 DOM 为 `<strong>` 加 `img.sticker`。覆盖安装后直接刷新原生同一会话，要求标记文字为粗体、`ac04` 显示为图片且不再出现原始 shortcode；无需再次发送写请求。任一账号、目标 UID 或会话标题不一致时立即停止。 |
| 负向验证方式 | 删除 shortcode 转换、让转换进入 code token、接受目录外 shortcode、让通知继续使用 bare `RenderHTML`、复制一份私信 sticker renderer、让 sticker-only 变换接管普通图片、恢复一次性 `scrollToEnd` 或在用户拖动后继续强制跟随，编号 adapter/媒体/UI/滚动控制器测试必须失败；恢复 Topic 私有缓存函数时 unused/架构检查必须暴露旧 seam。 |
| 明确不覆盖范围 | 不调整私信时间位置、气泡或问题诊断样式，不改变发送协议、Markdown 编辑器、图片上传、视频 sticker、新建/搜索/删除私信，也不修改 linux.do、妖火的通知正文协议；本次 Live 只验证既有 NodeSeek KongB 消息。 |

## `REG-TOPIC-062` 极大回复楼层被当作从首屏开始的连续前缀

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`、`NAV-02/03`、`NOTIFY-02`；四站回复关系导航、双向分页和写后刷新 |
| 用户症状 | 点击很远的被回复楼层会从当前页逐页追赶，长帖产生请求风暴；即使跳到目标，中间缺失页面也可能被拼成连续列表。关系标签整块点击又会打开用户名片，用户无法单独点楼层。定位到中段后只能向下加载，编辑、删除或新回复还可能按已加载数量刷新错误页面。 |
| 触发条件 | 四站主题包含远端楼层链接或通知携带目标，目标不在当前回复窗口；列表采用无限滚动且当前缓存可能只含首屏、锚点中段或双向相邻窗口。 |
| 根因 seam | Controller 把 Infinite Query 页组误认为“从第一页开始的完整前缀”，用 `loadMoreReplies` 反复追目标，并以 `topicReplies.length`、数组下标或扩大 page-size 推断绝对页面；route/parser 又使用零散的 reply Pick 类型并丢失 page/fragment。列表只支持 next cursor，写后刷新复用同一错误推断。 |
| 必须保持的行为 | 使用统一 `ReplyLocationTarget { commentId?, floor?, pageHint? }`；存在 `commentId` 时它是强身份，同楼层不同实体不得命中。已加载目标零请求；未加载目标只请求一次来源确认的目标窗口并原子替换当前页组，随后 `fetchPreviousPage`/`fetchNextPage` 只读取紧邻 cursor。target 是 replace-window 命令：取消当前 Reply Query，并只在 route、Query identity、order 与 generation 仍一致时应用；后发命令直接使旧结果 stale，不建立等待队列。目标实体及可信 current page/offset 缺一即失败并保留原窗口，不猜页、不补中间页。NodeSeek 固定 10 楼精确页且定位请求禁用 fill-pages；linux.do 使用 near-post window；妖火只接受响应 URL 或页码表单确认的 resolved page；V2EX 已加载目标本地定位，未加载目标由本次定位动作至多触发一次 `getReplies`，失败立即结算并保留当前评论，不等待后台全集。用户名与 `#楼层` 独立点击，定位前恢复全部/空搜索并保留当前顺序，成功滚动并短暂高亮。前插保持可见位置，指回任一已加载窗口的 cursor 立即停止。编辑/删除重读目标实体所在真实 `pageParam`，新回复按服务端权威尾窗重新锚定。 |
| 精确失败 oracle | `src/domain/forum/links.test.ts` 固定四站原生 anchor 到统一 `ReplyLocationTarget`；`tests/ui/topic/topic-session-controller.test.tsx` 输入 155 楼只允许请求序列 `[targetReply.floor=155, page=15, page=17]`，编辑目标随后只能重读真实 `page=16, offset=150`，不得出现 2～14；同文件固定后发 target 胜过先发整帖刷新、同楼层不同 `commentId` 失败、验证恢复、来源 epoch 前进后重试、旧 route 目标不重放、目标无法确认时原列表不变，以及 V2EX 已加载目标零请求、未加载目标恰一个 target Query。`tests/integration/source-read-contracts/` 固定 NodeSeek 目标页、linux.do near-post 与 V2EX 显式链接目标窗口；妖火 reader 测试固定独立凭据与 resolved-page falsifier。Topic 组件测试固定用户名/楼层双目标、前后边缘、每手势单次自动加载、按钮重试、前插保持和一次滚动高亮。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：adapter/unit 固定四站协议和 cursor，Controller/UI 固定窗口状态机与交互；匹配 APK 的四站只读主题验证真实布局、导航和相邻加载。 |
| Replay 或真实验收路径 | 从普通 Topic 和消息“查看完整回复”各进入一个已有远端目标；确认直接出现目标并高亮，向上/向下各触发一次相邻加载，点击作者进入用户页、返回后再点击楼层仍留在主题。linux.do 若出现验证，停在“更多 → 账号中心 → linux.do 原站”由用户手动处理后继续。全程不发回复、不清登录态。 |
| 负向验证方式 | 恢复递归 `loadMoreReplies`、`PageSize=400`、`1..N` 批量补抓、按已加载数量推页、目标请求继续 fill-pages、把用户名和楼层合成单个 Pressable，或在 adapter 未确认页面时应用窗口，任一编号测试都必须失败。 |
| 明确不覆盖范围 | 不引入 V2EX PAT/API 2.0 分页，不为只有 `@用户名` 的文本猜楼层，不并发预抓全部历史，不对妖火缺页码响应做近似定位。真实回复、编辑、删除仍需针对站点和对象另行授权。 |

## `REG-TOPIC-063` 回复窗口等到重试按钮可见才加载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；回复窗口展示顺序和向上预取体验 |
| 用户症状 | 从锚点窗口向上滚动时，先看到“加载更早回复”按钮，随后才开始请求和前插，操作感觉迟滞；本地倒序又只翻转已加载片段，并不能代表原站完整倒序结果。 |
| 触发条件 | 当前主题存在 previous cursor，用户从窗口中段向上滚动；列表同时把 `replyWindowStart` 渲染为重试按钮，并用该行进入可视区作为上一窗口请求条件；或 UI 把顺序切换实现为对当前数组执行 `reverse()`。 |
| 根因 seam | `TopicContentList` 把网络需求与重试 UI 绑定；旧实现又把 `newest` 混入 `ReplyFilter`，在展示层反转不完整集合。 |
| 必须保持的行为 | 回复区左侧提供全部、只看楼主、只看带图，右侧提供显示当前值的正序/倒序单选菜单；来源 adapter 返回什么顺序，UI 就按什么顺序展示，内容筛选和评论内查找只过滤内容。用户开始滚动后，最早可见回复距窗口起点不超过当前可视回复数时提前读取上一 cursor；同一手势最多自动读取一次，按钮只承担正在加载状态和手动重试。前插后必须清除旧预取命中并按新窗口起点重新计算；即使该次插入最后一个 previous cursor，也要保持当前可见位置。下一窗口加载不受影响。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 构造 10 条锚点窗口，只把第 4～6 条回复交给 viewability callback，且不包含 `replyWindowStart`；修复前 previous callback 为 0，修复后必须为 1，重复回调仍为 1；前插新窗口后，下一次手势在重新进入预取带前不得再次请求。另一用例固定最后一窗前插期间位置保持仍启用，随后才关闭；三种内容筛选与单一排序菜单必须并列，传入静态回复数组时切换倒序不得在 UI 层改变其顺序。真实倒序 transport 由 `REG-TOPIC-067` 固定。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY`：RNTL 固定提前触发、前插后预取重置、手势门禁、末窗位置保持、顺序栏、内容筛选和前后窗口按钮；匹配 APK 确认真实上滑没有按钮先出现再启动加载的停顿。 |
| Replay 或真实验收路径 | 从消息里的远端楼层或普通长主题进入中段锚点，缓慢向上滚动；确认接近窗口起点时上一窗口提前出现、当前位置不跳，并且回复区同时保留内容筛选与顺序栏。只读验收，不发送回复。 |
| 负向验证方式 | 恢复仅在 `replyWindowStart` 可见时加载，编号测试得到 previous callback 0；在 `TopicContentList`、筛选器或 Controller 展示投影中恢复局部 `reverse()`，静态数组顺序断言失败。 |
| 明确不覆盖范围 | 四站尾窗与倒序 cursor 协议由 `REG-TOPIC-067` 覆盖；本条不根据网络速度或滚动速度动态调参，也不自动连续补齐全部历史。 |

## `REG-TOPIC-067` 倒序只反转已加载片段而非服务端回复流

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；共享 `NAV-02/03`、`NOTIFY-02`、`WRITE-01` |
| 用户症状 | 多页主题切换倒序后仍先看到第一页的倒排片段，继续下滚又混入后续正序页；用户误以为看到最新回复，实际既不完整也不连续。 |
| 触发条件 | 正序只加载了部分窗口后切换倒序；主题有五页，或 Discourse stream 存在删除/拆帖造成的 post number 缺口；尾页计数或响应页码发生竞态。 |
| 根因 seam | `ReplyFilter.newest` 在 UI 对本地数组执行 `reverse()`，回复 Query key 不区分遍历方向；Controller 根据已加载数量猜页，来源 adapter 没有拥有尾窗算法、页内顺序和 cursor 转换。 |
| 必须保持的行为 | 使用独立 `ReplyOrder = oldest | newest` 和 `ReplyWindowPosition(start | cursor | target)`；`ReadGateway.getReplies` 同时接收两者，正倒序 Query key 永不混用。adapter 返回的 `items` 与 cursor 都按请求顺序解释，`next*` 始终是用户向下滚动的相邻窗口，`currentPage/currentOffset` 保留服务端真实位置。NodeSeek 以 `postPageCount`、严格 pager、响应页码和固定 10 楼页宽确认尾页，下一窗只读相邻前页；页外热门/置顶展示投影按 `REG-TOPIC-070` 在完整性证明前过滤。linux.do 按 `post_stream.stream` 真实 ID 取尾组，普通 hydration 漏回单条时按 `REG-TOPIC-073` 展示已验证子集；妖火从主题页真实 `reply` / `tofloor` 链接取最大楼层，原站 page 1 为最新且 page + 1 更早，倒序从末楼向 page + 1、正序从 `tofloor=1` 向 page - 1 遍历，不能把“更多回帖(N)”当总数；V2EX 正序复用 Topic 首页窗口并按显式 `p=N` cursor 向后读取，倒序 start 只沿显式链接定位末页并反转该窗口，下一窗指向显式前页。partial 窗口仍可见且不隐藏排序入口。来源计数竞态只降低窗口 completeness 或结算当前错误，不创建 typed 快照重试。Query 拥有 pages、cursor、取消和普通分页单飞；Controller 的 replace-window 命令只以 generation 实现 latest-command-wins，不保存 Promise 或恢复闭包。UI 保持左侧三种内容筛选和右侧顺序菜单；末窗结算当次显示弱化边界文字，最终回复和系统事件无多余底边。 |
| 精确失败 oracle | 来源测试固定 NodeSeek `[5, 4]` 且不出现 `[2, 3]`、Discourse 只请求 stream 尾部及相邻更早 IDs，漏回一条时保留可用子集，外来/重复/整窗空缺 hydration 失败、妖火区分总数文案与真实 `tofloor/reply`。V2EX fixture 固定正序 Topic 首页零 Reply transport、cursor `p=2` 只读第二页、倒序 start 返回末页窗口且下一 cursor 为前页、target 返回目标窗口；60 秒零自动追加由 `REG-TOPIC-076/077/083` 固定。Query/Gateway 测试固定 order key 隔离、`order + position` 转发和脱敏 diagnostics；Controller/RNTL 固定首次 Loading、尾窗/相邻窗、边缘失败、latest-command-wins及整帖/写后重建。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：adapter/gateway/Query 固定来源协议和 cache 隔离，Controller/RNTL 固定窗口状态机与交互；匹配 revision/APK 的四站只读 Live 才能证明真实尾窗。 |
| 自动重试边界 | previous/next 失败后，所属 start/end 边缘的自动入口保持关闭，只能显式重试原 cursor；对侧仍可扩窗且不得清掉旧错误。同一 Reply Query 有分页 pending 时，另一普通分页零 transport；结算后才可读取相邻窗口。replace-window 命令不等待分页队列，直接取消旧 Query 并以 generation 丢弃旧结果。V2EX 没有例外：partial、跨页数字变化和结构差异均不得创建 timer、轮询或后台重试。 |
| Replay 或真实验收路径 | 保留当前登录态，在 NodeSeek、linux.do、妖火各选一个多页主题，在 V2EX 选一个多回复主题；确认左侧三种筛选与右侧排序菜单，切换倒序后首条必须等于原站最新回复，向下只出现相邻更早窗口，末窗当次显示“已到最早回复”，再切回正序恢复头窗。不得发送回复、编辑、删除、互动或清理登录态。 |
| 负向验证方式 | NodeSeek 出现 `[2, 3]` 追页、部分集合在 UI/Controller 本地反转、正倒序共用 Query key、Discourse 猜尾页、因单条 hydration 漏回丢掉其他回复或接受外来/重复 ID、V2EX 正序 start 聚合全集或按总数猜未链接页、妖火未确认页码/末楼或仍有 newer cursor、计数竞态或重复 cursor 仍应用结果、相邻窗口失败只弹 toast、Controller 恢复 Promise/队列，或写后 invalidate 启动竞争 refetch，编号测试必须失败。 |
| 明确不覆盖范围 | 不引入 V2EX PAT 或 API 2.0 Token 分页，不新增全局顺序偏好或持久化迁移，不并发预抓全部历史，也不通过真实写操作制造尾楼。 |

## `REG-TOPIC-068` NodeSeek 真实下一页被旧回复总数否决

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 用户症状 | NodeSeek 主题明明存在下一页，窗口到达边缘却报错；同一页面实际已到 `#14`，主题头和“回复列表”仍显示 10，切到倒序又报“回复总数已变化，无法确认最新窗口”。真实样本是 `post-861053-1`。 |
| 触发条件 | 原站 page 1 payload 没有 `replyCount`，只有 `postPageCount=2` 和本页 10 条回复；旧 parser 把 `comments.length - 1` / rendered rows 当成总数。pager 已指向 page 2，page 2 也明确返回 `#11–#14`，但旧窗口仍用错误的 10 否决正序页和定位倒序尾窗。另一路径还会扫描正文内所有同帖链接，把引用楼层误当分页 cursor。 |
| 根因 seam | `src/sources/nodeseek/topicParser.ts` 把详情页 `comments[]` 的当前页长度暴露成总回复数，`src/sources/nodeseek/reader.ts` 又拿这个伪总数定位倒序尾页并否决真实相邻页。`src/domain/forum/models.ts` 原先强制每个 Topic 都有 `replyCount`，使来源不知道总数时只能制造数字；`src/sources/nodeseek/protocol.ts` 还没有把 pager 链接与普通内容链接分开。Controller 的刷新计数恢复只能延后症状，不能修复错误事实。 |
| 必须保持的行为 | `comments.length` 只表示当前页已加载数量；详情响应没有明确总数时 `replyCount` 缺失，Topic 读取不得额外请求末页只为计数，详情头和未筛选回复标题不显示伪总数。`postPageCount`、严格 `.nsk-pager` / pagination navigation / `rel=next`、响应 `postPage` 与显式连续楼层共同确认页拓扑；正文引用不产生 cursor。正序、倒序、双侧扩展和 commentId 目标扫描都不依赖调用方传入的 `replyCount`，倒序从页拓扑直达真实末页；错页、楼层缺口和无法确认的末页仍拒绝。linux.do 继续使用 `post_stream` 与 offset，妖火继续使用真实 page/tofloor cursor，V2EX 使用自身显式 `p=N` 页面窗口。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定真实数据形态：page 1 的 `postPageCount=2` 与 10 条页内回复、page 2 的 `#11–#14`；Topic 只请求 page 1、没有 `replyCount`，传入旧 `replyCount=10/45` 的正序相邻页和倒序尾窗仍按页拓扑成功。pager 新增末页时继续读取；错页、楼层缺口、局部推断末页仍失败，正文 `/post-861053-2#11` 引用不得生成下一页。中心窗口参数化覆盖 oldest/newest 两种顺序的两侧，通知 commentId 扫描由 `postPageCount` 有界。`tests/ui/topic/topic-reply-filters.test.tsx` 固定未知总数不显示已加载窗口大小；Controller 测试固定 linux.do/妖火两侧普通失败仍按原 cursor 重试，V2EX 按其显式 page cursor 加载与重试。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：adapter fixture 固定分页证据与 stale-count 竞态，Controller/RNTL 固定双侧窗口合并；匹配 APK 直达真实 NodeSeek 样本确认 page 2 可见。竞态本身以确定性测试为主要 oracle。 |
| Replay 或真实验收路径 | 用匹配 revision/APK 直达 `https://www.nodeseek.com/post-861053-1`：主题头和未筛选回复标题不显示总回复数；正序滑到底必须出现 `#11–#14` 和“已到最新回复”且无边缘错误；切倒序必须从 `#14` 建立尾窗，再向旧回复加载。另以多页主题检查窗口另一侧。linux.do、妖火、V2EX 各只读验证一次真实相邻翻页。不得发帖、删帖、清数据或破坏登录态制造竞态。 |
| 负向验证方式 | 恢复以 page 1 rows 作为总数、为计数预读末页、用任意旧 `replyCount` 定位或否决 NodeSeek 页面、重新扫描所有同帖链接作为 pager、接受错页/楼层缺口/推断末页，或在 Controller 增加 NodeSeek 刷新计数再重试状态，编号测试必须失败。给其他来源套用 NodeSeek 页宽或总数判断也应被各自 cursor 回归拒绝。 |
| 明确不覆盖范围 | 不新增统一 cursor/boundary 模型、分页状态机或自动重试，不重写四站协议；其他来源若出现不同根因只另行记录，不在本条猜测式修补。 |

## `REG-TOPIC-069` V2EX 独立缓存端点被拼成伪回复窗口错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03/04`；共享 `NAV-02/03` |
| 用户症状 | 活跃主题 `https://www.v2ex.com/t/1232497` 的原站 HTML 已完整包含全部回复，App 却报“回复总数已变化，无法确认完整集合”；正倒序、楼层定位和评论刷新因此都无法使用。 |
| 触发条件 | V2EX 的主题 API、公共回复 API 与主题 HTML 命中不同缓存时刻；现场曾同时出现回复 API 68 条、主题 API 71 条、HTML 声明并渲染 73 条。旧实现优先采用任意非空 API 回复，再用另一端点的数量否决它。超过 100 条时 HTML 还会通过同主题 `?p=N` 显式分页，详见 `REG-TOPIC-071`。 |
| 根因 seam | `src/sources/v2ex/reader.ts` 把独立缓存端点错误拼成一个快照，并让“能否证明全集”反向否决已经逐条解析成功的评论。完整性属于当前 HTML 页面窗口，不是评论可见性的总闸门；公共 API 只能在首页 HTML 不可用或没有可用回复时作为独立降级，不能补洞或参与投票。 |
| 必须保持的行为 | Topic 读取只并行请求主题 API 与第一页 HTML，不调用公共回复 API 或第二页；逐条保留能解析且位于当前 V2EX 页边界的唯一评论。第一页节点自洽且有同主题下一页链接时仍可声明 complete，同时保留可信总数、`replyHasMore` 和 `replyNextPage`；节点损坏、缺楼、跨页重复或计数冲突只丢无效项并返回 partial，不清空正文。Reply cursor 只读取对应显式页面；该页 partial 时返回所有有效行，整页读取失败才 reject 并保留已加载窗口的评论级重试。无声明或首页 HTML 不可用时才用主题 API 与公共回复 API 降级；API 非空可信子集同样可 partial，合法 0/0 才是 complete empty。HTML 元数据、`Pro` badge、总数可信度和 cursor 保持；诊断只记录安全 parser variant 与计数。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定单页 HTML 3/3 直接 complete；声明 3 条但只有 2 节点、额外 malformed 中间节点、声明冲突和短集合时，Topic/getReplies 均保留其他可信评论、标 partial，且零公共 API 掩盖。`commentCount`-only 自洽窗口、合法空主题、legacy HTML、`Pro`、感谢数和回复目标保持。HTML 不可用时 API 2/2 与 0/0 complete，2/3 返回两条 partial，0/1 才失败；显式后续页 transport 失败必须 reject。`REG-TOPIC-071/076/077/083` 固定单页窗口、显式 cursor 和零自动读取。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：来源 fixture 固定可信子集、单响应完整性和降级边界；Controller/RNTL 固定正文与可信评论不会被回复失败清空；匹配 revision/APK 的目标主题只读验收真实数据。 |
| Replay 或真实验收路径 | 使用匹配当前 revision、App 版本和 APK 身份的开发包直达 `https://www.v2ex.com/t/1232497` 与 `https://www.v2ex.com/t/1231874`；正文与第一页必须先可读，静置不得自动读取下一页。用户触底后只追加显式相邻页；再切换正序/倒序、定位楼层和仅刷新评论。全程只读，不发回复、不互动、不清 App 数据、Cookie 或登录态。 |
| 负向验证方式 | 恢复三端点并行投票、让非空回复 API 优先、用主题 API 否决自洽 HTML、在已声明 HTML 缺节点时用 API 掩盖、Topic 首读跨页、把 partial 子集标成完整、猜测未链接页码或增加 cache-buster，编号测试必须失败。 |
| 明确不覆盖范围 | 不修改 NodeSeek、linux.do和妖火的真实分页/stream 窗口，不增加 V2EX PAT/API 2.0、cache-buster、后台轮询或持久化迁移。 |

## `REG-TOPIC-070` NodeSeek 热门/置顶展示副本污染倒序窗口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03`、`NOTIFY-02` |
| 用户症状 | NodeSeek `post-832584-1` 正序可读，切换倒序却弹出回复窗口错误；最新回复和相邻更早窗口都无法显示。 |
| 触发条件 | 原站 page 1 在普通 `#1..#10` 回复之外混入 `#44/#83/#117` 等热门或置顶展示项；adapter 为确认末页先读取 page 1 页拓扑，再直达 page 44。 |
| 根因 seam | `src/sources/nodeseek/reader.ts` 把 HTML 中所有回复节点都当作当前固定 10 楼窗口的拓扑成员，并在页内投影前按 `limit` 截断。热门/置顶是展示副本，不证明其楼层属于当前页；把它纳入连续楼层校验会误报，把所有页外项都忽略又会掩盖真实错页。 |
| 必须保持的行为 | 只在 `start/cursor` 有序窗口按固定 10 楼计算当前页合法范围。范围外、来源楼层明确且标记为 `hot/pinned` 的展示副本先过滤；范围内唯一表示某楼层的热门项仍保留。随后按 comment ID、回退 floor 去重，普通项优先于同回复的展示副本，并按 floor 升序供 `items` 与完整性证明共同使用。只有来源楼层已完整覆盖当前固定窗口时，额外普通页外楼层才构成响应错页；稀疏页或缺 floor marker 的回退楼层继续展示，不能把证据缺失当成错页。已确认错页、楼层缺口和重复 cursor 继续失败。Topic 首屏现有热门/置顶展示、楼层 target、共享窗口类型和页宽不变。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-070` 用 page 1 热门 `#44/#9/#83/#117` 与普通 `#1..#8/#10` 混排：倒序必须请求 `[1, 44, 43]`，尾窗返回 `#434..#431`，相邻窗返回 `#430..#421`。修复前在 page 1 报“未确认请求的回复页”。另一负例在已完整确认普通 `#1..#10` 后加入未标记 `#44`，必须继续失败；既有稀疏明确楼层、缺 floor marker 回退楼层、缺楼与 cursor 回归保持。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：真实 adapter fixture 固定投影与负例；匹配 APK 的目标主题固定原站当次页拓扑及真实倒序体验。 |
| Replay 或真实验收路径 | 匹配 revision/APK 直达 `https://www.nodeseek.com/post-832584-1`，切换倒序后首条等于当时最高楼层，向下加载一个相邻窗口且楼层连续。只读，不回复、点赞、收藏、清数据、Cookie 或登录态。 |
| 负向验证方式 | 把所有解析节点直接送入页校验、在投影前截断、删除 `hot/pinned` 标记判断、过滤范围内唯一热门楼层、把稀疏/回退楼层一律当错页，或放宽到忽略已完整窗口后的普通页外回复，对应编号或既有兼容/缺楼测试必须失败。 |
| 明确不覆盖范围 | 不修改其他来源、不重写共享 Controller/Query、不扩大 10 楼页宽、不预抓全部历史，也不改变 Topic 首屏热门/置顶视觉呈现。 |

## `REG-TOPIC-071` V2EX 超过 100 条回复时只读取第一页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03/04`；共享 `NAV-02/03` |
| 用户症状 | V2EX `t/1231874` 声明 107 条回复，App 只显示第一页 100 条且没有下一页游标；`#101..#107` 永久不可达，或必须用“刷新评论”一次抓完整帖才能出现。 |
| 触发条件 | 主题 HTML 第 1 页只包含 `#1..#100`，并明确链接同主题 `?p=2`；旧 adapter 假定 V2EX HTML 永远单页全集。 |
| 根因 seam | `src/sources/v2ex/reader.ts` 把“页面窗口完整性”和“整帖是否全部载入”混成一个 boolean：第一页有 100 条有效行和明确 `p=2` 时仍被标成无 cursor 的 partial；旧 `getV2exReplies` 又把一次 Reply Query 实现成跨页全集同步。 |
| 必须保持的行为 | Topic 首读只解析第一页，不请求第二页；正文、可信总数、第一页全部有效评论及最小的同主题后续 `p=N` 游标立即返回。第一页节点自洽时 `replyCompleteness=complete`，`replyHasMore=true` 与 `replyNextPage=2` 表示集合仍可扩展，不能把 complete 解释成全集。正序静置零 Reply transport；触底或“加载更多回复”后，cursor Query 只访问精确 `p=2` 并追加该页。链接只接受同 origin、同 `/t/{topicId}`、唯一正整数 `p` 参数，query-relative `?p=N` 必须解析后再校验；不猜未链接页、不预取全集。倒序 start 可沿显式链接定位末页窗口，target 可沿显式链接寻找目标。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-TOPIC-071/076/077/083` 固定 Topic 首读 `#1..#100 + total=107 + nextPage=2` 且不请求 `?p=2`；cursor `p=2` 只访问第二页并返回 `#101..#107`，公共回复 API 零调用。倒序 start 返回 `#107..#101` 和下一 cursor `p=1`，target 返回目标所在第二页。缺楼、malformed、跨页重复和第二页数字变化只让该页 partial 并保留其他有效行；第二页整页失败 reject。Controller 固定普通打开 60 秒零 Reply transport、一次显式加载后合并到 147。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：adapter fixture 固定链接发现、精确单页读取和降级边界；Controller/RNTL 固定首屏 seed、触边加载与失败保留；匹配 APK 的目标主题固定真实 100 条分页阈值与最高楼。 |
| Replay 或真实验收路径 | 匹配 revision/APK 直达 `https://www.v2ex.com/t/1231874`；首屏正文与 `#1..#100` 可读，静置不自动出现 `#101+`；向下滚动后才追加到当次最高楼。倒序首条为当次最高楼，楼层定位和仅刷新评论不出现窗口错误。全程只读，不发送或互动。 |
| 负向验证方式 | Topic 首读请求第二页、恢复单页假设、按 100 条硬猜未链接页码、接受外站/他主题 `p`、静默跳过失败页、允许重复/缺楼后仍声明完整，或用公共回复 API 补洞，编号测试必须失败。 |
| 明确不覆盖范围 | 不引入 PAT/API 2.0、预抓未链接历史、后台补齐/重试或持久化迁移；100 只定义 V2EX 单页楼层边界，不是可信总评论上限。 |

## `REG-TOPIC-072` 妖火删除边缘楼层与新页码字段阻断整个评论区

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03` |
| 用户症状 | 妖火 `bbs-1570569.html` 的主题正文可读，但评论区正序或倒序弹出“妖火未确认目标楼层所在页”或目标楼层缺失错误，已经返回的回复也完全不展示。 |
| 触发条件 | 原站删除了边缘楼层（真实样本中 `#1` 已删除、可见楼层为 `#2..#8`），`tofloor=1` 仍正确路由到边缘页；新页面用 `input[name=replyPage]` 声明页码而不是旧 `input[name=page]`。并发新增或删帖也可能让主题页的最大楼层 hint 与窗口响应暂时不同。 |
| 根因 seam | `src/sources/yaohuo/reader.ts` 一方面只识别旧页码表单，另一方面把用于寻找正序/倒序边缘页的 `tofloor` hint 当成显式楼层 target，要求该楼层实体必须存在。页码证据与实体身份被错误合并成单一硬门禁，导致可解析、由服务器确认的整页回复被丢弃。 |
| 必须保持的行为 | 页码确认同时接受响应 URL、旧 `page` 和新 `replyPage` 表单。显式 `target` 仍必须精确命中；`start` 边缘请求只要服务器确认 resolved page 且返回非空可解析回复，就展示该窗口，即使 hint 楼层已删除或因并发变化过期。倒序最新窗口仍必须确认 page 1；正序最早窗口不生成更早 cursor。未确认页、空窗口、cursor 错页和重复 cursor 仍明确失败。共享 Query、公开窗口类型及其他来源不变。 |
| 精确失败 oracle | `src/sources/yaohuo/reader.test.ts` 的 `REG-TOPIC-072` 固定 `replyPage=1`、可见 `#2..#8` 且 `#1` 缺失：正序必须返回 `#2..#8`、无更早 cursor；另固定尾楼 hint 过期但确认 page 1，倒序必须返回 `#8..#2`。`REG-TOPIC-067/068/072` 同时固定未确认页仍失败、已确认且增长/过期的尾窗可展示、已确认空窗口以 `reply-count-refresh-required` 失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS + APK_SANITY`：adapter fixture 固定页码证据与边缘/target 分界；匹配 revision/APK 直达真实小帖和大帖验证正倒序与相邻窗口。 |
| Replay 或真实验收路径 | 匹配 revision/APK 直达 `https://www.yaohuo.me/bbs-1570569.html` 与小帖 `https://www.yaohuo.me/bbs-1540797.html`，两种顺序都必须展示现存回复；再直达 `https://www.yaohuo.me/bbs-1560939.html` 和 `https://www.yaohuo.me/bbs-1478784.html`，验证最新/最早窗口及至少一个相邻页连续可用。全程只读，不回复、互动、清数据、Cookie 或登录态。 |
| 负向验证方式 | 删除 `replyPage` selector、恢复边缘 hint 必须命中、让显式 target 缺失也通过、接受未确认页/空窗口、为缺失首楼伪造更早 cursor，或改动共享 Controller/窗口模型，对应编号测试必须失败。 |
| 明确不覆盖范围 | 不猜测妖火回复总数、不补抓缺失楼层、不压实楼层号、不放宽显式楼层定位，不修改 NodeSeek、linux.do、V2EX的 adapter。 |

## `REG-TOPIC-073` Discourse 单条 hydration 竞态阻断整个回复窗口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03` |
| 用户症状 | linux.do的主题和大部分回复已返回，但批量 hydration 因删帖或读竞态漏回一条，App 仍报“Discourse 回复窗口不完整”并丢弃其他可读回复。 |
| 触发条件 | `post_stream.stream` 已确认窗口 ID 和 offset，随后 `/posts.json?post_ids[]=...` 只返回其中的非空子集；典型原因是两次读之间的删帖或缓存竞态。 |
| 根因 seam | `src/sources/discourse/model.ts` 的 hydration 校验把“所有返回实体都属于请求窗口”与“每个请求 ID 必须同次返回”合并成一个硬门禁。前者防止串帖，后者只是对投影时序的过强假设。 |
| 必须保持的行为 | `post_stream.stream` 继续唯一决定窗口、顺序和 cursor。普通 `start/cursor` hydration 至少返回一条时，校验每条都是已请求且唯一的 ID，再按 stream 顺序展示可解析子集；cursor 仍使用原 stream offset，不按子集数量改写。未请求 ID、重复 ID、整窗 hydration 空缺与错误 cursor 继续失败。显式 `target`/near-post 路径继续要求目标实体存在。 |
| 精确失败 oracle | `src/sources/discourse/model.test.ts` 固定已请求 ID 子集按 stream 顺序保留，整窗空缺和外来 ID 失败。`tests/integration/source-read-contracts/` 固定 linux.do 两条窗口只 hydration 一条时返回该楼且保持原 offset/cursor。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：共享 model 与两站 adapter fixture 固定子集和负例；匹配 APK 在两站大/小帖分别验证正倒序和相邻窗口。 |
| Replay 或真实验收路径 | 保留当前登录态，直达 linux.do 一个小帖和一个多页帖；正序能读头窗，倒序从 stream 尾窗开始，大帖再向下读一个相邻旧窗。全程只读。 |
| 负向验证方式 | 恢复必须同次 hydration 所有 ID，漏回 fixture 必须失败；放宽到接受外来/重复 ID、全空响应，或以可见子集重算 cursor，其他负例和 offset 断言必须失败。 |
| 明确不覆盖范围 | 不预抓全部 stream、不重试 hydration、不伪造楼层或压实 post number，不放宽精确 target，不改动 NodeSeek、V2EX 或妖火协议。 |

## `REG-NODESEEK-004` NodeSeek 直连通道卡死只能靠重启 App 恢复

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`SEARCH-01/02/04`、`TOPIC-01/03`、`USER-01`、`ACCOUNT-01/02`、`MORE-02`、`DATA-02/03`；NodeSeek 幂等读取与自愈配置 |
| 用户症状 | NodeSeek 直连连续命中 8 秒，WebView 却能返回；同进程内后续读取继续卡顿，只有关闭重开 App 后恢复。 |
| 触发条件 | NodeSeek `GET/HEAD` 直连超时或 network error，且同次 WebView fallback 返回成功响应；合格次数达到设置阈值 1–5。 |
| 根因 seam | `src/sources/nodeseek/browserFallback.ts` 的直连/WebView 结算边界、`src/platform/network/networkProxy.ts` 的跨来源 generation single-flight 与原生 App 级读取 runtime 轮换；具体是哪一个 Native transport phase 最先污染仍由后续安全诊断证伪。 |
| 必须保持的行为 | 只累计“直连 timeout/network error + 同次 WebView `ok`”；直连成功清零。取消、写请求、Cloudflare、HTTP/解析失败、无效或失败的 WebView 响应不计数。原生轮换失败也必须返回已成功的 WebView 响应，并把计数保留在阈值以允许下一次合格 fallback 重试轮换。阈值默认 1，存储、备份和导入限制为 1–5，入口位于账号中心 → NodeSeek。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定阈值、直连成功清零、排除条件和恢复失败仍返回 fallback；`src/domain/reader/readerData.test.ts` 固定默认、取整、clamp 与 merge；Account/More UI 测试固定入口和更新。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：adapter 行为测试固定计数状态机，ReaderData/UI 固定可配置入口；真实 runtime 轮换由 `REG-PROXY-010` 的 Kotlin JUnit 与媒体 UI 测试证明。 |
| Replay 或真实验收路径 | 匹配 revision/APK 保留登录态运行 `nodeseek-session.ad`、`four-source-feed.ad`、`account-readonly.ad`；自然出现直连 fallback 时核对 recovery generation 与后续直连，不清 Cookie 制造故障。 |
| 负向验证方式 | 恢复每次 fallback 都恢复、让 challenge/失败 WebView 计数、让写请求进入 fallback，或在恢复失败时丢弃成功响应，编号测试必须失败。 |
| 明确不覆盖范围 | 不宣称已证明最初污染根因，不重放写请求，不引入 circuit breaker、无限重试、强制 IPv4/HTTP 1.1 或网络变化即自动重置。 |

## `REG-LINUXDO-008` linux.do 直连长期卡死且检查状态超时

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`SEARCH-01/02/04`、`TOPIC-01/03`、`USER-01`、`ACCOUNT-01/02`、`MORE-02`；linux.do 幂等读取 |
| 用户症状 | linux.do 列表突然无法加载，账号状态检查也长时间超时；关闭重开 App 后恢复。 |
| 触发条件 | `linux.do` 或受控子域的 `GET/HEAD` 直连在 active time 8 秒内不结算；父级仍未取消。 |
| 根因 seam | `src/sources/linuxdo/browserFallback.ts` 的直连 watchdog、WebView evidence gate 与 App 级读取 runtime 轮换；Cloudflare challenge 仍是独立且不触发轮换的 fallback 原因。 |
| 必须保持的行为 | 8 秒到期只取消本次直连并把同一幂等读取移交 WebView；只有 WebView 返回成功响应后，才以 `linuxdo` 为 trigger 轮换 App 当前读取 runtime，并直接返回这份内容。轮换失败也不得丢弃已成功内容。父级取消、写请求、HTTP 403/429/登录失效、Cloudflare、其他 network/解析错误或失败 WebView 不恢复，普通慢请求不伪装成 challenge。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 的 `REG-LINUXDO-008` 以 fake active-time 固定 8 秒后 native transport 仍只有一次、WebView success 前零轮换、success 后一次轮换并返回同一 Response；另固定轮换失败仍返回成功内容，以及取消、写入、HTTP、Cloudflare 和失败 WebView 零恢复。 |
| 最低可靠自动测试层 | `UNIT_PASS + APK_SANITY`：adapter 行为测试固定 evidence gate 与 transport 次数，匹配 APK 才能证明 RN/OkHttp 实际接线。 |
| Replay 或真实验收路径 | 匹配 revision/APK 运行 `four-source-feed.ad`、`account-readonly.ad` 及相关详情/搜索只读路径；自然超时时核对 generation 增加后的紧随直连，不主动破坏网络或登录态。 |
| 负向验证方式 | 在 WebView 成功前轮换、再发一次 native transport、丢弃轮换失败前已成功的内容、让写请求恢复或把普通 HTTP/Cloudflare 归类为通道超时，编号测试必须失败。 |
| 明确不覆盖范围 | 不自动重试非超时失败，不替换现有 Cloudflare 验证流程，不扩大到其他域名。 |

## `REG-LINUXDO-009` Connect 会话失效让官方等级退回本机估算

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-04`；共享 `ACCOUNT-02` 的隐藏 WebView、CookieManager 与显式清除边界 |
| 用户症状 | 同一账号在 App 内手动打开 Connect 官方页或在手机 App 可以看到官方等级进度，但模拟器直接点击“查看等级”偶发只显示“本级估算”；手动看过真实页面后又恢复。 |
| 触发条件 | linux.do 主站登录仍有效且等级为 LV2+，但 `connect.linux.do` 的会话已过期；等级直连返回登录页、不可解析 HTML 或非成功响应，而真实 Connect 页面可经 linux.do SSO 回到官方卡片。 |
| 根因 seam | `src/sources/linuxdo/level.ts` 在 Connect 直连/解析失败后直接吞错并降级估算，没有调用 `src/sources/linuxdo/browserFallback.ts` 已有隐藏 WebView；手动打开真实页之所以“治好”，是页面导航顺带完成了 SSO 和 Connect Cookie 续签。 |
| 必须保持的行为 | LV2+ 每次先直连 Connect；可解析官方卡片立即返回且不打开 WebView。只有该次直连原本会估算时，才以 JS 内部 intent 精确执行一次 `GET https://connect.linux.do/` 的既有隐藏 WebView读取，允许 linux.do SSO provider、Connect callback 和最终页，拒绝外域；成功直接解析最终页为 `source: connect`、`estimate: false`，失败才保留既有估算。取消、LV0/LV1、其他 URL/方法零恢复；单次点击不循环。普通原生请求继续只读 Cookie、响应不写回；只有用户显式清除登录时定向过期 Connect 的 `auth.session-token` host-only 与 `Domain=connect.linux.do`。 |
| 精确失败 oracle | `src/sources/linuxdo/level.test.ts` 的 `REG-LINUXDO-009` 先让直连返回登录 HTML、隐藏 WebView返回官方卡片，修复前结果为 `summary/estimate` 且 WebView 零调用，修复后必须为 `connect/false` 且 WebView 恰好一次；同文件固定直连成功零 WebView、恢复失败只一次后估算、Abort 与 LV0/LV1 零恢复。`tests/integration/source-read-contracts/` 固定 intent 只匹配精确 Connect GET、无特殊 header、禁用 fallback 时不二次直连；`tests/integration/security-boundaries.test.ts` 固定 SSO/callback 与外域边界；fresh prebuild 的 `NetworkProxyRuntimeTest.kt` 固定显式清除，并由既有 no-op 用例继续禁止响应 Cookie 写回。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + STATIC_PASS`：确定性 adapter/integration 测试固定恢复次数、结果和安全边界；隐藏 WebView UI 回归固定共享队列、Abort 与页面结算；release packaging、fresh prebuild、Kotlin JUnit/编译固定原生 Cookie 契约。 |
| Replay 或真实验收路径 | 在匹配 revision/APK 的当前可见模拟器上覆盖安装并保留 App 数据，不先手动打开 Connect；从“更多”点击 linux.do 查看等级，正常会话直接显示官方进度并可重复刷新。只在测试期间自然遇到过期会话时核对单次隐藏 SSO 后仍显示官方进度；不得清 App 数据、重置模拟器或人为删除 Cookie 制造状态。未自然命中过期时，真实恢复记 `NOT_VERIFIED`，不影响确定性自动测试作为修复 oracle。 |
| 负向验证方式 | 删除恢复 intent、让失败直接估算，或把恢复扩大到任意 URL/POST/循环重试，编号测试必须分别出现 `summary/estimate`、误用 WebView或超出一次。恢复普通原生响应 Cookie 写回、自动清 Cookie，既有 `REG-ACCOUNT-026/027/029` 与原生 no-op 测试必须失败。 |
| 明确不覆盖范围 | 不新增 Cookie overlay、受限 CookieJar 写回、私有 Cookie store 或新会话系统；不改 Connect DOM 解析选择器，不把估算删除，不主动制造第三方过期状态，也不改变 `REG-ACCOUNT-026/027/029` 的普通原生请求只读契约。 |

## `REG-PROXY-009` 单站通道恢复误伤其他请求或写操作

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01`；共享 `FEED-01/02/04`、`SEARCH-01/02/04`、`TOPIC-01/03`、`USER-01`、`ACCOUNT-01/02` 网络 seam |
| 用户症状 | 为恢复 NodeSeek 或 linux.do 读取而全局 `cancelAll` 或替换只有后续 client 才能看到的 pool，会连带取消其他站读取，或显示恢复成功但既有 client 仍复用故障连接。 |
| 触发条件 | 旧 generation 同时有 trigger 来源和无关来源、读取和写入，然后以四站任一合法来源调用 Native bridge；NodeSeek/linux.do 以成功且可解析的 WebView fallback 提交 trigger，V2EX/妖火以 `REG-PROXY-012` 的当前页面内容超时提交 trigger，四站都不构成底层专用 runtime。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 App 级 `ReadNetworkRuntimeGeneration`、受控来源/方法识别和旧代 drain；`src/platform/network/networkProxy.ts` 以 `expectedGeneration` 做跨来源 single-flight/CAS。 |
| 必须保持的行为 | 原生层只接受 source catalog 的五个受控来源，不接受任意 Host；全 App Native fetch 边界把已有 intent 映射为内部 `source + content/health/retained`，Native 在出网前移除 header 并以 request tag 保留归属。轮换只取消旧 generation 中 trigger 来源显式标记的 `content GET/HEAD` 与对应非视频媒体；未标记请求不再按同域猜成内容请求。同站后台 Account health、retained、带播放器 lease 的视频、无关来源和 `POST/PUT/PATCH/DELETE` 继续并自然 drain。CookieJar 与代理行为保持，新 generation 的 ProxySelector wrapper、Dispatcher、forum/media pool 和图片 client 身份必须全部变化。代理切换仍按已有安全边界全局取消并清所有 generation 的两个 pool。 |
| 精确失败 oracle | fresh prebuild 生成的 `NetworkProxyRuntimeTest.kt` 固定四站显式 `content GET/HEAD` 可取消，未标记请求、health、retained、视频、写请求和其他来源不可取消；并以真实 OkHttp Dispatcher 同时运行 forum 与 media 两条 lane，验证只取消目标读取、稳定 CookieJar 及新 generation 网络对象身份。`src/platform/network/networkProxy.test.ts` 固定同一 expected generation 的跨来源 single-flight/CAS、player lease bridge 与失败后可重试；tooling 测试固定生成接线。 |
| 最低可靠自动测试层 | `UNIT_PASS + STATIC_PASS`：Kotlin JUnit 执行真实 Dispatcher/Call 取消，JS 测试固定 bridge 协调；fresh prebuild 与 Kotlin 编译证明生成接线。 |
| Replay 或真实验收路径 | 在匹配 APK 上只读同时打开目标站与另一站读取，自然触发恢复后确认无关请求结算；不用真实写操作制造并发。 |
| 负向验证方式 | 改回 `dispatcher.cancelAll()`、放开任意 Host/写方法、按来源各建 runtime、重建 CookieJar，或让无关/写请求被取消，Kotlin/JS 编号测试必须失败。 |
| 明确不覆盖范围 | 不保证第三方服务可用，不为每站建立独立 Dispatcher/client，不自动重放写请求。 |

## `REG-PROXY-010` 兜底显示成功但下一次详情与图片仍卡在旧 Native runtime

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01/02`、`TOPIC-01/02`；共享 `FEED-01/02/04`、`SEARCH-01/02/04`、`TOPIC-03`、`USER-01`、`ACCOUNT-01/02` 读取 seam |
| 用户症状 | 阈值为 1 且 WebView fallback 已成功，下一次详情仍长期 Loading，正文图片也约 40 秒不显示；只有结束进程再进入才立即恢复。 |
| 触发条件 | fallback 后旧 OkHttp call 仍占用连接；恢复先 `cancel()` 并立即 `evictAll()`，call 在 bridge 返回后才 release，同时 Expo Image 仍持有独立 media pool/client。 |
| 根因 seam | OkHttp cancel/release 不是同步边界，旧实现在 release 前清池，且只清 forum pool；Dispatcher、两个 pool、ProxySelector wrapper、Glide client 与 Cronet generation 都未真实替换，JS 的 generation 只是计数。 |
| 必须保持的行为 | 先完整构建并原子发布新的 App 级 generation，使后续四站 fetch、图片和视频都读取新对象；在主线程完成 Glide publication 后，只取消旧代 trigger 来源中标记为 `content` 的非视频 `GET/HEAD` 与对应媒体，并立即返回而不等待 release。同站后台 Account health、retained、无关来源和写请求留在旧代自然结算。每条 NodeSeek/linux.do 合格 fallback 在 direct request 开始时捕获 `expectedGeneration`，parser proof 迟到也只能用该代调用显式 JS→Native CAS；另一来源已发布新代时返回同步 noop，不能按提交时 current 再轮一代。旧代在全部 queued/running call、健康播放器 lease 与仍持有 response body 的 Cronet call 自然结算并持续空闲 250ms 后才清两个 pool、封闭/退休 Cronet、关闭 Dispatcher executor；退休竞态不得取消已登记 Cronet call，迟到 release 不能重新成为 current。新播放器只能原子 retain Native current：JS snapshot 落后时先按 Native 返回的新 generation 重试，拿到 lease 前不得创建；拿到后须按该 generation 精确取得同代 client，不能因随后发生其他来源轮换而改抓 global current。并发来源只轮换一次，失败回滚且下一次合格 trigger 可重试。Topic 正文只由 `TopicBodyMediaCoordinator` 为 trigger 来源当前 `running` entries 换一个新 attempt，仍受四请求门禁与单 deadline 约束；`displayed`、`waiting`、`failed/exhausted` 不重放，renderer 不再保存 retry generation。当前预览页按独立三槽 owner 局部恢复；已显示正文图片与 healthy/playing/paused 视频保持实例并继续使用受 lease 保护的旧代。非 Topic unmanaged player 只有在不健康状态才切 current。SVG fallback 每次复取也必须抓 current image client；保存、上传和 mutation 零自动重放。 |
| 精确失败 oracle | fresh prebuild 的 `regProxy010PublishesFreshRuntimeBeforeCanceledOldCallReleases` 固定 bridge 返回前对象身份已变化、forum/media 两条 lane 同时取消、旧 call 晚释放及最终 drain；`regProxy010KeepsHealthyVideoRuntimeAliveUntilItsOwnerReleasesTheLease` 固定健康视频不取消、旧 lease generation 在新代发布后仍解析为同一 client、lease 释放前不关闭 executor；相邻 acquire 用例固定新 owner不能 retain retired generation，而会拿到 Native current 后重试。`regProxy010TreatsAnActiveCronetBodyAsOutstandingRuntimeWork` 通过可控 transport 走真实轮换/drain，固定 active body 释放前 runtime 与 transport 都不退休、释放后以 `cancelActive=false` 退休；apply-ack 用例固定 Native finish 必须晚于 JS apply acknowledgement 和 drain；输入负例固定非法 trace/generation 被原生校验拒绝；rollback 用例固定未发布代清理不产生第二个 finish。相邻 Kotlin 测试固定 generation CAS、intent 先于 publication 与 Glide publication barrier。`src/platform/network/networkProxy.test.ts` 固定跨来源 single-flight、expected-generation 输入校验、JS→Native→state apply→ack 同 trace、player lease bridge 与失败重试；`tests/integration/source-read-contracts/` 固定 gen0 同时开始的 NodeSeek/linux.do fallback 按 parser proof 先后仍都提交 gen0，第二条为 CAS noop 而非 gen2；`tests/ui/account/session-controller-browser-flow.test.tsx` 固定生产 hidden-browser 接线传递 request-start generation。`tests/ui/topic/topic-media-coordinator.test.tsx` 与 `tests/ui/topic/topic-image-loading.test.tsx` 固定 generation 只更换当前 running attempt、四请求门禁不突破、displayed/waiting/failed 不动、未完成媒体按 attempt 切换网络 source、图片稳定视觉 key 不含 attempt 且已显示实例不重建、player 在 lease 前不创建、publish→JS apply 窗口按 Native current 重新 acquire且同代拒绝不循环、lease generation 进入 DataSource及健康实例不变；`tests/ui/topic/image-preview.test.tsx` 固定当前三槽 owner 的局部恢复和相邻健康页不动。tooling 固定 Expo Video 必须从源码构建、generation registry 接线及 SVG 不缓存旧 client；`src/platform/diagnostics/diagnosticFileStore.test.ts` 固定 Native intent/唯一 finish/同 trace、旧到新导出与隐私白名单。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + STATIC_PASS + APK_SANITY`：JS/Kotlin/UI 固定对象、时序和展示行为；fresh prebuild、Release Kotlin compile 与覆盖安装证明真实接线。 |
| Replay 或真实验收路径 | 匹配 revision/APK 保留数据覆盖安装；自然命中 fallback 时核对诊断中的旧 generation → `publish/cancel/drain/finish` → 紧随直连成功及图片显示。不能自然复现初始污染时该项记 `NOT_VERIFIED`，不得清数据、重置模拟器、切 IPv6 或破坏网络制造故障。 |
| 负向验证方式 | 改回计数加一 + 原地 `cancel/evictAll`、漏换 media/image client、bridge 等待旧 call release、全局刷新 Query、remount 已显示媒体或自动重放写操作，编号测试必须失败。 |
| 明确不覆盖范围 | 本修复不升级 Expo/React Native/OkHttp，不改变 DNS/地址族顺序，不强制 IPv4、HTTP/1.1、`Connection: close` 或禁用连接池；Native phase 诊断用于定位最初污染，不把尚无证据的 IPv6 解释写成根因。 |

## `REG-PROXY-012` V2EX 或妖火当前读取超时后持续卡住

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`SEARCH-01/02/04`、`TOPIC-01/02/03`、`USER-01`；共享 `MORE-01/02`、`ACCOUNT-01/02` 与 `REG-PROXY-009/010` 的 App 级读取 runtime seam |
| 用户症状 | V2EX 或妖火的当前列表、搜索、帖子、回复或用户读取偶发一直转圈或报请求失败；完全退出 App 后重新进入却立即成功，说明故障可能留在进程内的 Native 读取 runtime，而不是该页面数据永久不可用。 |
| 触发条件 | 用户当前仍停留在该页面，属于该页面的显式 foreground `content GET/HEAD` 自身等待满生产默认 15 秒并抛出可判型 `RequestTimeoutError`；请求 signal、来源开关、ReadPlan、账号 generation 均未失效。这里“当前页面”是仍持有该 Query 的 route，不是泛指 App 曾经在前台。页面切换或 App 进后台会取消该 Query，因此不得触发恢复。 |
| 根因 seam | `fetchWithTimeout` 过去只抛同文案的普通 `Error`，`ReadGateway` 无法把“请求自身达到 deadline”与 HTTP、解析、登录、调用方取消区分；NodeSeek/linux.do 只有 parser-proof fallback 路径会调用 `recoverReadNetworkRuntime`，另外两站即使命中同一进程级故障也只把错误交回页面，App 重启才间接换掉 runtime。 |
| 必须保持的行为 | `fetchWithTimeout` 保留既有中文文案，但分别抛 `RequestTimeoutError` 和 `RequestCanceledError`。每次逻辑读取在 transport 前捕获 `expectedGeneration`；V2EX/妖火第一次合格超时调用既有 `recoverReadNetworkRuntime(source, expectedGeneration, { trace })`，复用全局 CAS/single-flight，成功后把整个 Feed/Search/Topic/Replies/User 读取从头重放一次。旧代被同来源轮换取消的其他当前页面读取，仅在 snapshot 的 generation 已前进、`triggerSource` 相同且自身仍有效时重放一次，不再发起恢复。第二次失败直接结算错误，Loading 必须结束。NodeSeek/linux.do 仍只在 Direct 失败、WebView fallback 成功且 parser 接受内容时恢复，并直接使用 fallback 结果。`all` 的单来源 5 秒聚合预算、普通网络/HTTP/解析/登录错误、页面或后台取消、后台任务、health、retained、写 intent、上传、收藏、投票、通知和视频均不触发或自动重放。 |
| 精确失败 oracle | `src/platform/network/request.test.ts` 固定 timeout/cancel 类型与中文文案；`src/sources/readGatewayContract.test.ts` 固定两站第一次内容超时均调用同一恢复函数、一次恢复后最多两次逻辑读取、多 HTTP Topic 从第一步整体重放、同来源旧代取消只重放一次、其他来源轮换不误重放，并固定 HTTP/解析/登录、caller abort、background/write intent、无 owned request、NodeSeek/linux.do 与 `all` 零 timeout recovery。诊断必须同时出现旧 generation 的 `reason=timeout` trigger 和新 generation 的 `state=retry/retryCount=1`。`src/platform/network/networkProxy.test.ts` 继续固定同 generation 只发布一次；fresh prebuild Kotlin JUnit 固定 `REG-PROXY-009` 的显式 ownership 与取消边界。`tests/ui/feed/feed-controller-session.test.tsx` 固定内部恢复期间仍为 Loading，成功后显示列表；重放失败后退出 Loading 并显示错误。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + STATIC_PASS + APK_SANITY`：Vitest 固定错误类型、逻辑重放、generation 与负例，RNTL 固定可见 Loading/数据/错误结算，fresh prebuild、Kotlin JUnit 与 Release Kotlin 编译固定 Native ownership。 |
| Replay 或真实验收路径 | 匹配 revision/APK 在主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；仅在 V2EX 或妖火自然出现 15 秒内容超时时核对诊断链 `timeout → rotate-read-runtime → retryCount=1 → data/error`，并确认切页与前后台切换不会启动新恢复。不得断网、清数据、删 Cookie、重置模拟器或破坏代理来制造故障；未自然命中则真实恢复记 `NOT_VERIFIED`。 |
| 负向验证方式 | 删除 typed error、移除 Gateway recovery、只重放失败的单个 HTTP call、允许第二轮再恢复、取消同来源 `triggerSource` 校验、把聚合 5 秒/普通错误/后台或写请求纳入触发，或恢复 Native 未标记同域 GET/HEAD fallback；对应编号测试必须失败。 |
| 明确不覆盖范围 | 不新增 recovery manager、Native bridge、每站恢复实现、第三方重试库、配置或存储；不把普通第三方服务失败解释成 runtime 损坏，不自动重放任何 mutation，也不人为制造线上网络故障做验收。 |

## `REG-FEED-014` 一个慢来源拖住聚合首页与分类

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04` |
| 用户症状 | 首页“全部”或分类一直 Loading，实际只有一个站不结算，其他站已可用。 |
| 触发条件 | Feed/Categories 的一个 child 在 active time 5 秒内不结算。 |
| 根因 seam | `src/sources/readAggregation.ts` 复用 `withAbortableTimeout` 的 `AGGREGATE_SOURCE_BUDGET_MS`，并拥有 Feed child 的 typed timeout/cancel 与 cursor 结算。 |
| 必须保持的行为 | Feed/Categories 每来源独立计时并发，严格等待所有 child 成功、失败、超时或取消后才一次发布；active-time 5 秒超时以 typed `aggregate_timeout` partial 结算并保留 page/opaque cursor，父取消整体使用统一取消文案，父 signal 预先取消时不得调用 child。聚合读取复用调用方现有 diagnostic trace，为每个 child 恰记录一次 `source + state + latencyMs + sanitized reason`，不得记录 URL、Cookie 或用户数据。 |
| 精确失败 oracle | `src/sources/feedRead.test.ts` 用 deferred Promise 固定最后一个 child 终态前聚合结果绝不发布，并固定五个 child 的 success/failure/timeout/canceled 终态各恰记录一次、latency 有界、reason 脱敏，同时覆盖 child abort、cursor 保留与父取消。`src/sources/readAggregation.test.ts` 固定 pre-aborted parent 的 child 调用数为 0。 |
| 最低可靠自动测试层 | `UNIT_PASS`：adapter 主动时钟、诊断与 cursor 必须覆盖。 |
| Replay 或真实验收路径 | 匹配 APK 运行 `four-source-feed.ad` 和 `logged-out-readonly.ad`，确认单站动态失败时其他来源可见。 |
| 负向验证方式 | 改回无界 `allSettled`、把父取消降级为 partial 或丢失 cursor，编号测试必须失败。 |
| 明确不覆盖范围 | 不对 Search 引入同样 barrier，不渐进重排列表，不把聚合超时当作通道损坏证据。 |

## `REG-FEED-015` 在途首页请求让手动刷新失效

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04` |
| 用户症状 | 列表请求卡住后下拉刷新只提示“列表正在更新”，无法替换旧请求；关闭重开 App 才恢复。 |
| 触发条件 | 同一 `feedQueryKey` 正在首屏读取，用户下拉刷新；旧 Query 可能有缓存也可能没有。 |
| 根因 seam | `src/features/feed/useFeedController.ts` 的手动刷新所有权，以 TanStack Query exact cancel + `refetch({ cancelRefetch: true })` 替换在途请求。 |
| 必须保持的行为 | 手动刷新先 exact `cancelQueries`，再替换同 key 请求；每次刷新增加 generation，旧结果和旧 toast 不落地。有/无缓存一致，分页继续 `fetchNextPage({ cancelRefetch: false })` 且 cursor/append 语义不变。 |
| 精确失败 oracle | `tests/ui/feed/feed-controller-session.test.tsx` 的 `REG-FEED-015` 分别从无缓存首请求和有缓存刷新创建在途请求，要求旧 signal abort、新结果成为最终列表且旧提示不落地；既有分页用例继续固定 append/cursor。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经真实 hook + QueryClient 观察 signal、缓存和可见列表，单测函数或源码字符不足以证明替换。 |
| Replay 或真实验收路径 | 匹配 APK 在首页冷加载期和已显示列表的刷新期各下拉一次，确认当前请求被替换并且仍可分页；不用断网制造超时。 |
| 负向验证方式 | 恢复 `isFetching` 早返、跳过 exact cancel、使用 `cancelRefetch:false` 刷新，或去掉 generation 检查，编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不改变切站、identity barrier 或分页的请求策略，不新增自动重试。 |

## `REG-FEED-016` 首页来源 Tab 在 100% 下过高过宽

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02/04`、`MORE-03`；共享 Tab 大字号与点击区 |
| 用户症状 | v1.3.95 后首页“全部 + 四站”一级 Tab 在 100% 字号下比二级导航大很多，每项过宽；130% 字号缩放本身仍应保留。 |
| 触发条件 | 首页来源栏使用共享 `PillRail variant="tabs"`，共享样式在 v1.3.95 加入 `minHeight:48` 和 `minWidth:48`。 |
| 根因 seam | `src/ui/controls/SelectionControls.tsx` 的共享 Tab 样式与 `compactTabs` 局部 override；`src/features/feed/FeedScreen.tsx` 只为顶部来源栏启用。 |
| 必须保持的行为 | 首页整个来源栏在 100% 时 `minHeight=40`、无 `minWidth`、13 号字，保留既有 `gap=22`、右 padding、自然宽度、role/label/hitSlop；130% 时字号为 17。其他共享一级 Tab 仍为 48×48 最小区域并满足 `REG-NOTIFY-050`。 |
| 精确失败 oracle | `tests/ui/feed/feed-screen.test.tsx` 的 `REG-FEED-016` 渲染真实首页并断言 40/自然宽/13；`tests/ui/shared/accessibility-basics.test.tsx` 在 130% 下固定 compact 字号 17，既有 `REG-NOTIFY-050` 继续固定默认 Tab 的 48 区域和大字号。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY`：RNTL 固定展平样式数值，匹配 APK 复核实际排版与横向滚动。 |
| Replay 或真实验收路径 | 匹配 APK 在 100%/130% 各打开首页与消息中心，核对来源栏高度、自然宽度、文字缩放和滚动；验收后恢复原字号。 |
| 负向验证方式 | 删除 `compactTabs`、全局回退到 40，或对 compact 固定 13 而不消费 Reader scale，对应 UI oracle 必须失败。 |
| 明确不覆盖范围 | 不改首页二级导航、其他页 Tab 或全局 accessibility 最小点击区策略。 |

## `REG-TOPIC-064` 论坛图片遭遇 Cloudflare Challenge 后原生详情无法显示

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-03`、`USER-01`、`ACCOUNT-01/02`、`MORE-02` 媒体 seam |
| 用户症状 | NodeSeek `post-857589-1` 的 `im.legend.moe` 1028×937 WebP 在原站 WebView 正常显示，原生详情只显示灰色占位。Expo Image 的 OkHttp 响应为 `403 + Cf-Mitigated: challenge`；复制完整浏览器头仍是 challenge，而匿名 WebView 与 Cronet 均能取得图片。 |
| 触发条件 | 论坛图片的幂等 `GET/HEAD` 已带通用浏览器请求画像，但服务端仍按 TLS/HTTP 网络指纹返回 Cloudflare Challenge Page。Cookie 不是该真实样本成功所必需。 |
| 根因 seam | `src/platform/media/imageRequestSource.ts` 的通用请求画像只负责 Accept、UA、语言、内部来源和 identity；`Referer` 由 `REG-TOPIC-078` 的文档/元素契约独立决定。传输恢复 seam 是 `plugins/withNetworkProxyModule.js` 生成的 Expo Image/SVG 专用 client。把补请求头或补图床 Host 当成浏览器等价无法解决网络栈指纹差异。 |
| 必须保持的行为 | 所有合法 HTTP(S) 图片继续携带 image Accept、UA、Accept-Language 和内部身份标记，不按目标 Host 分支；`contentSource` 不再隐式生成 canonical origin Referer，最终值按 `REG-TOPIC-078` 解析，视频覆盖为 video Accept。Expo Image 与 SVG 有界复取先走现有 OkHttp/Glide 快路径，只有响应精确包含 `Cf-Mitigated: challenge` 且方法为 `GET/HEAD` 才懒初始化当前 generation 的 bundled Cronet，并通过官方 OkHttp transport 流式重试一次。Cronet 不缓存 body、不自行跟随重定向；非 challenge 响应交回外层 OkHttp，二次 challenge、初始化或网络失败保留原始响应且不递归。JS 永不附加 Cookie；同来源 Cookie、跨站匿名、离源永久降级和内部头移除保持不变。App 代理启用或切换阻塞态时 Cronet 只走本地 relay 且 `DISALLOW_DIRECT`；generation 变化取消旧调用，响应体释放后关闭旧 engine。普通图片、普通 `403/429`、超时、写请求、API、视频和图片保存均不进入 Cronet。 |
| 精确失败 oracle | `src/platform/media/imageRequestSource.test.ts` 与 `tests/ui/topic/topic-image-loading.test.tsx` 固定未知 CDN 的通用画像、UA 隔离、零 JS Cookie及 video Accept。fresh prebuild 生成的 `NetworkProxyRuntimeTest.regTopic064OnlyCloudflareImageChallengesUseOneFallbackResponse` 用真实本地 OkHttp hop 证明只有 challenge GET 被替换为一次流式恢复，普通 403/429 与 POST 零恢复；`regTopic064FallbackFailureOrSecondChallengeKeepsTheOriginalResponse` 固定失败和二次 challenge 保留原响应。tooling 门禁固定 bundled 依赖、旧 OkHttp/Okio/Cronet API 排除、无重定向、`DISALLOW_DIRECT`、Expo Image network interceptor、SVG 共享 client，以及只允许 Cronet 500 缺失平台 API 的四条精确 R8 `-dontwarn`；既有 Kotlin 测试继续固定 Cookie、重定向和 session cache 边界，`assembleRelease` 必须通过 R8。修复前行为测试缺少恢复器并失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + STATIC_PASS`：Vitest/RNTL 固定 JS 和 renderer，生成 Kotlin JUnit 固定真实 OkHttp fallback 行为，fresh prebuild 与 Release Kotlin compile 固定原生依赖/API 接线。 |
| Replay 或真实验收路径 | 匹配 revision/APK 使用现有登录态从“更多 → 账号中心 → NodeSeek”打开 `https://www.nodeseek.com/post-857589-1` 作原站对照，再在原生 Topic 详情确认 1028×937 WebP 显示；另只读回归普通第三方图片、同来源私有附件与 `post-841430-1` 的复杂动态 SVG。确认普通图片日志没有 Cronet 初始化或主线程阻塞；不清 App 数据、Cookie 或登录态，不保存图片、不启用真实代理。 |
| 负向验证方式 | 恢复图床 Host 列表、把内容来源强制当成 Referer、把所有图片/API/视频直接改走 Cronet、按普通 403/429 或超时触发、递归重试、让 Cronet 自行跟随跨站重定向、代理失败回落直连、给第三方图床附加论坛 Cookie，或让 SVG 绕开同一图片 client，编号测试或原生编译必须失败。 |
| 明确不覆盖范围 | 不覆盖 JavaScript 生成图片、`blob:`、canvas、DRM、第三方登录 Cookie 或交互 CAPTCHA；不增加隐藏媒体 WebView、服务端代理、图床配置、curl impersonation 或无限重试。若锁定的 Cronet 在保留 TLS 校验和代理边界下仍让目标图片返回 challenge，停止合并并记录受控状态/协议证据，再单独评估其他隔离 transport。 |

## `REG-TOPIC-065` NodeSeek 透明动态贴纸出现黑底并在前后台切换时重载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02/03`；共享详情 renderer 生命周期 |
| 用户症状 | NodeSeek `post-859086-2#14` 的三个动态贴纸在原站为透明动画，原生详情中前两个出现黑色方块；App 切到后台再回来时贴纸重新加载。 |
| 触发条件 | NodeSeek 用 VP9 WebM/MOV 表达透明动画，正文 renderer 把它交给 Expo Video/Media3 `TextureView`；Android 通用媒体格式支持不等于该 native surface 保留 alpha，React 生命周期变化还会重建 player。 |
| 根因 seam | NodeSeek HTML 的 `video.sticker` 归一化 → `FORUM_VIDEO_STICKER_TAG` → `src/features/topic/rendering/contentMediaRenderers.tsx` 的透明媒体承载与 App 可见性生命周期。 |
| 必须保持的行为 | 普通正文视频继续走 Expo Video/Media3。只有合法 NodeSeek host、`/static/image/sticker/` 路径及 `webm/mp4/mov` 扩展名的贴纸使用透明、禁交互、禁文件/存储/第三方 Cookie且禁止跨顶层导航的 Chromium media island；同源 PNG fallback 在 ready 前和失败后持续可见。source document 按 URL memoize，普通 React 重渲染和前后台切换只暂停/恢复动画，不重建 player 或重新请求。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 的 `REG-TOPIC-065` 走真实 renderer，要求 native `useVideoPlayer` 零调用、WebView 初始透明隐藏、ready 后显示、第三方 Cookie 禁用且 rerender 后 source 对象不变。修复前 oracle 观察到一次 native player 调用。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 renderer/生命周期契约，匹配 APK 的真实主题固定 Android 合成结果和后台恢复。 |
| Replay 或真实验收路径 | 直达 `https://www.nodeseek.com/post-859086-2#14`，在“评论内查找”输入 `xhj003` 让第 14 楼进入可见窗口；确认三个动态贴纸透明且在连续截图间有帧变化。按 Home 后恢复 App，确认无黑底、无 Loading 重放且动画继续。不清数据、Cookie 或登录态。 |
| 负向验证方式 | 把透明贴纸重新交给 native VideoView、让 renderer 每次更新生成新 HTML source、ready 前移除 PNG fallback、开放任意 host/path 或前后台恢复时 remount WebView，编号 UI/Live oracle 必须失败。 |
| 明确不覆盖范围 | 不把普通视频、图片、SVG、API 或未知第三方动画改走 WebView；不承诺 DRM、交互式页面、canvas 或需脚本生成的媒体。 |

## `REG-TOPIC-066` 同一贴纸目录的不同图片被统一压成小尺寸

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02/03`；共享 inline sticker 布局 |
| 用户症状 | 同一楼层中的 `xhj/003.png` 与 `xhj/015.gif` 在原站分别按约 `57×48`、`82×82` 显示，App 却把两张都压成约 `48×48`；只有一个 HTML 尺寸轴时还会被画成正方形，阅读字号放大后又可能突破 100dp。过往按素材或目录修补后仍会在新贴纸上复发。 |
| 触发条件 | HTML 缺少一个或两个 `width/height`，`knownForumStickerSourceDimensions()` 把整个 `/sticker/xhj/` 目录假定为 `48×48`，或缺失轴没有使用解码比例；自然尺寸先限到 100dp、随后再乘阅读字号也会越界。同段后续出现大视频贴纸时，拆行逻辑还会让前面的图片贴纸回落为 textual inline image，最终被 Android TextView 行盒裁成约一行高。 |
| 根因 seam | `src/domain/forum/forumContentMedia.ts` 的混合段落分流 → `src/platform/media/inlineMedia.ts` 的占位尺寸推导 → `src/features/topic/rendering/htmlElementModels.ts` 的 block/textual content model → `src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Image `onLoad` → 已有 session-aware 有界自然尺寸缓存。 |
| 必须保持的行为 | HTML 显式宽高仍优先；缺失一个或两个尺寸轴时首帧可用保守占位，但图片解码成功后必须以完整 URL 的真实宽高和比例补齐缺失轴，并在应用阅读字号后的最终布局上保持 100dp 安全上限。同一媒体 session 再次渲染直接复用缓存尺寸，不能先回到小占位再跳变。混合段落拆出后续大贴纸时，前面的图片贴纸仍经专用 block renderer，不进入 TextView 行盒。目录 hint 只能优化首帧，不能覆盖真实尺寸；普通 inline emoji 继续按文本大小，双轴显式尺寸和 sticker row 的既有约束不变。 |
| 精确失败 oracle | `src/domain/forum/forumContentMedia.test.ts` 用第 14 楼同形结构固定图片贴纸在后续视频贴纸拆行时仍产出 `forum-sticker`；`src/platform/media/inlineMedia.test.ts` 固定未知 xhj 只使用中性占位，并要求 `57×48` 解码尺寸在仅有 width 或 height 时补齐另一轴、`82×82` 在 130% 阅读字号下最终仍不超过 100dp。`src/features/topic/rendering/htmlElementModels.test.ts` 固定 `forum-sticker` 为 block；`tests/ui/topic/topic-image-loading.test.tsx` 通过真实 Sticker renderer 依次提交 `57×48` PNG 与 `82×82` GIF 的 `onLoad`，要求最终 style 精确保持尺寸，并在卸载重建后首帧复用 `82×82`。三个任一回退都必须使编号测试失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：纯解析/布局测试固定路由与 fallback 边界，模型测试固定原生布局容器，RNTL 固定解码后和缓存重进，匹配 APK 固定真实 Expo Image 解码结果。 |
| Replay 或真实验收路径 | 直达 `https://www.nodeseek.com/post-859086-2#14`，定位第 14 楼并与同设备原站对照 `xhj003`、`xhj015` 的比例和相对大小；按 Home 后恢复，确认尺寸不退回 `48×48`，GIF 继续播放。 |
| 负向验证方式 | 恢复 `/sticker/xhj/ = 48×48`、按文件编号加表、忽略 `onLoad` 自然尺寸、只缺一个轴时强制正方形、在阅读字号缩放前而非最终布局后执行 100dp 限制、让无显式尺寸的贴纸仍受 64dp 上限、把 `forum-sticker` 改回 textual、让拆行前缀绕过专用贴纸转换或把普通 emoji 一并放大，编号测试必须失败。 |
| 明确不覆盖范围 | 不改变图片传输、Cronet、SVG、普通块图、预览或图片保存；不根据未知网页 CSS 猜任意缩放，只恢复素材固有比例并保留 100dp 安全边界。 |

## `REG-PERF-010` 海量正文图片把内容总量线性转换成 App 运行时工作集

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` |
| 用户症状 | NodeSeek `post-863650-1` 的正文请求先成功，但 1413 张图片集中在一个顶层 `<p>` 内；App 随后长时间失去响应、图片不显示，返回也卡顿，约 30 秒后出现 1390+ 个同步取消和多条 `ResponseBody` 泄漏，严重时进程卡死或退出。同进程后续详情的响应性也会被残留工作拖累；本条不把该现象归因为 `ReadNetworkRuntimeGeneration` 污染。 |
| 触发条件 | 旧“懒加载”只把顶层 HTML node 当作 FlashList row；一个巨型 `<p>` 仍在单个 RNRH cell 内一次性展开全部 TNode、React component、Native View、Expo Image、OkHttp Call 和 Timer。原图附近 gate 只限制升级层，适屏图片仍全部 mount；限制 Dispatcher 只会把调用移到无界 native waiting queue。全屏预览若为完整 catalog 逐项创建 Pager wrapper，会继续线性放大 Native View。 |
| 根因 seam | `src/domain/forum/topicContentSplit.ts` 的唯一公开 `compileForumContent()` 是不可信 HTML 到有界 typed UI rows 的编译边界；poll/quote 提升、视频分类、HTML 分片和 semantic continuation 都藏在该深 module 内，model/renderer 不再拥有第二套 DOM 规则。compiler 只产出 disclosure 的初始值，route-scoped `TopicSplitDisclosureStore` 唯一持有展开状态并在父 FlashList 前过滤 body rows，header renderer 不持有第二份状态或正文。`src/features/topic/media/TopicBodyMediaCoordinator.tsx` 是 Topic 正文媒体许可、timeout、retry 与 runtime-generation restart 的唯一 owner；`src/ui/media/ImagePreviewModal.tsx` 独立拥有预览 physical window，生成的 `CloseSafeGlideStreamFetcher` 拥有 Native body。 |
| 必须保持的行为 | `compileForumContent()` 固定执行 `normalize/sanitize → semantic blocks → budget packing → typed rows`，对普通/恶意正文单次 parse、单次 post-order 统计。物理预算只约束可安全切开的调度单元：每个媒体 row 最多 4 个网络媒体，普通合并 row 继续遵守 80 个 RNRH node、16,384 个序列化字符和 12,000 文本字符；64 层是安全边界。plain/terminal code 与无离散媒体的连续富文本 subtree 是单一语义 owner，不因物理预算从内部切开；table、details、callout、blockquote 与 list 只在完整行组、自然子块或 list item 边界分段。无法安全拆分的 malformed/depth/media/table 单元替换成有界提示。poll、opening quote、native video 与上述结构由同一 compiler 原位产出 typed row；每个 row 直接携带 scope-local `semanticId`、segment/part 与完整 `ancestorFrames`，不生成 HTML binding 或 sidecar。主楼、普通回复、签名、评论完整引用、主楼内嵌完整引用和已采纳答案展开正文全部进入父 FlashList data，不得在 RNRH cell 内嵌套全文 `.map()`；keys 使用 owner scope、semantic id 与 segment，view type 包含 payload kind。引用摘要、展开/折叠、定位、query highlight、poll、视频、terminal、link card、预览目录、保存和正文顺序保持。focused route 的 `TopicBodyMediaCoordinator` 固定未完成工作 warm `<=8`、running `<=4`、正文原图同时 `<=1`；未获 permit 的未完成媒体只显示稳定占位，不创建 Expo Image/player/OkHttp call，离开窗口或 route inactive 只释放 waiting/running。已显示图片在 cell 真正回收或媒体 identity 改变前保持像素实例，稳定视觉 key 不含 attempt。正文复杂 SVG 的 consumer subscription 还必须随未完成 permit attempt 更换、row unmount 和 inactive 同步释放：最后一个 consumer 释放后排队 work 永不启动、支持 `AbortSignal` 的 fetch 取消；不可取消 Native 读取只准完成当前有界阶段，返回后不再渲染 poster。同 identity 的另一个活跃 consumer 保持 single-flight 不受影响；全局 32 项 artifact cache 和有界 queue 仍由 `compatibleImageSources` 持有，不转交 coordinator。只保留一个最近 deadline Timer，首次失败只产生一次门禁内自动重试，第二次失败后零滚动/recycling/runtime 第三波且只允许一次显式重试。generation 变化只给当前 running 工作集换 attempt，displayed/waiting/failed 不动。逻辑预览 catalog 完整保序，physical ring 固定 previous/current/next 三槽；UI worklet 结算 role/offset 后只给离屏槽换 source，latest desired index 拒绝旧转场/外部事件。三槽 raster 与 SVG poster 均使用 disk-only cache 并按 View 尺寸下采样解码，升为当前只改变优先级；预览 timeout 也按真实字节无进展判断并卸载失败 load layer。内容不截断、不增加“继续加载”。route 只输出一次不含 URL、正文、IP 或 Cookie 的聚合诊断，并包含 planned/media、warm/running/timer 高水位与 `firstRowElapsedMs`。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 在一个 `<p>` 生成 2000 张图片，修复前只有一个巨型 row，修复后数量和顺序不变且每媒体 row 最多 4 张；同文件固定超旧字符预算的连续段落和 240 行代码仍各为一个 owner，并覆盖 compiler typed 顺序、普通/native-video parse-once、2000 图 attributes 线性解码、恶意深度、parser fallback、实体/grapheme、anchor、table、details/callout 与有序列表的自然边界 continuation；楼主 plan 转成被引用回复时必须按 reply 角色重编译，不能复用会抽走 nested quote 的 opening plan。`src/domain/forum/forumContentMedia.test.ts` 固定媒体归一化只做一次 selector 建索引，不再按图片段落或 V2EX 动态图片重扫子树。`src/sources/nodeseek/reader.test.ts` 固定完整页面 parse `=1`、embedded JSON decode `=1`、embedded-only 主楼只净化/parse `=1`、1413 图 rendered 候选从整页到最终 plan 总 parse `=2`，且被丢弃 embedded 候选 parse `=0`。`src/domain/forum/topicActionState.test.ts` 固定投票状态改变时同步替换过期 plan，并通过真实 TanStack Query 结构共享后仍能按值验证 plan 语义。`src/sources/readGateway.test.ts` 固定 Topic、Replies 与单条引用三个 cache 边界都公开返回 `Prepared*` 类型。`src/features/topic/model/replyListModel.test.ts`、`src/features/topic/model/topicOpeningPresentation.test.ts`、`tests/ui/topic/topic-reply-filters.test.tsx` 固定主楼、回复/签名、两类完整引用与采纳答案都是父列表 direct rows，且已准备的非空正文到达 UI 后 compile `=0`。`tests/ui/topic/topic-media-coordinator.test.tsx` 与 `tests/ui/topic/topic-image-loading.test.tsx` 用 2000 个 descriptor 和全部正文媒体种类固定 running `<=4`、warm `<=8`、Timer `=1`、单原图、释放/暂停/失败/retry/runtime attempt/Native generation acquire、迟到 callback、首 row 和单次隐私聚合；其中 SVG oracle 明确要求 unmount、inactive、media epoch 与 runtime attempt 释放后，迟到 Native document 不进入 poster。`src/platform/media/compatibleImageSources.test.ts` 固定取消最后一个 consumer 会移除 queued work/abort 可取消 fetch，取消一个共享 consumer 不影响另一个且仍只有一次 fetch/poster。`tests/ui/topic/image-preview.test.tsx` 固定 2000 项 catalog 只创建 3 个 physical ring slots、旧 logical event 不跳错新 item、inactive 异常页激活后恰重试一次、无进展失败卸载 load layer，所有 mounted raster/poster 保持 `cachePolicy=disk` 与 `allowDownscaling=true`，且仍可到首、中、末项。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：Vitest 固定内容编译硬预算，RNTL 固定父列表 shape、permit 生命周期与三槽 Pager；匹配 revision 的 x86_64 Release APK 才能证明帧、PSS、Back、ANR/OOM 和进程存活。Debug、源码字符串、只打开详情或等待工具 settle 均不足。 |
| Replay 或真实验收路径 | 保留 App 数据覆盖安装匹配 APK，通过 `exp+wz-android://open-topic?url=https%3A%2F%2Fwww.nodeseek.com%2Fpost-863650-1` 直达；同一 PID 连续两轮执行“目标帖 → 滚动 → Back → 普通详情”，中间不 relaunch。详情 response 到首个正文 row 可交互 `<=1s`、snapshot `<=3s`、Back `<=1s`；running 高水位 `<=4`、warm `<=8`、native queued body call `=0`、Timer 高水位 `=1`，无千 call burst、批量 cancel wave、ResponseBody leaked、ANR、OOM、FATAL 或 PID 变化。连续滚动 render P95 `<=50ms`、无单帧 `>700ms` 或超过 3 个连续 missed frames；PSS 峰值增量 `<=150MB`，Back 后 60 秒回到基线 `+80MB` 内。开头、代表性中段和末段图片都能自动加载；再回归普通 1/2/4/20 图主题。公网内容变化时该项记 `NOT_VERIFIED`，不得清数据、改 IPv6 或伪造网络故障。 |
| 负向验证方式 | 恢复按顶层 node 分块、重复 parse/sanitize 被丢弃的候选、只按 HTML 判断 plan 新鲜度、只用对象身份或 module `WeakMap` 保存 plan 语义、让 UI 为非空正文 fallback compile、让任一正文入口在单 cell 内 `.map()` 完整 plan、在 renderer 内才做 lazy、只限制 OkHttp Dispatcher、为每图建立 Timer、失败后滚动自动重发、让预览按 catalog 数量创建 physical slots，或让当前预览页禁用下采样并进入 decoded memory cache，编号 model/UI oracle 必须失败。 |
| 明确不覆盖范围 | 不升级 Expo、React Native、OkHttp、Glide 或 Feed TabView 使用的 PagerView，不引入 WebView/V8/JSI worker、站点专用规则、图库化、永久截断或每 N 张手动继续；如果硬预算已固定而 Release 设备仍超过帧/PSS 门槛，再以新证据评估离线程解析或 Native decode，不能预先扩大架构。 |

## `REG-TOPIC-074` Glide 取消竞态泄漏 ResponseBody

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-02/03` 的正文媒体生命周期 |
| 用户症状 | 海量正文退出或媒体 permit 被撤销后，log 出现多条 “A connection ... was leaked” 警告；在另一种回调顺序下，图片流也可能在 Glide 消费前被过早关闭。长帖的一次批量取消会放大泄漏并拖累后续详情。 |
| 触发条件 | upstream Glide OkHttp fetcher 的 call、已接收 `ResponseBody`、交给 Glide 的 `InputStream` 与 `cleanup()` 没有覆盖所有竞态：`onResponse(200) → cancel → cleanup 尚未发生`、`cancel/cleanup → late onResponse(200)`、cancel 后 failure、重复 cancel/cleanup 和非 2xx 都可能由不同路径争夺或遗漏 close；body transform、`byteStream()`、`contentLength()` 或 stream wrapper acquisition 自身抛错也会让 ownership 建立到一半。Expo `GlideUrlWrapper` 还有 progress listener，不能仅替换普通 `GlideUrl` loader。 |
| 根因 seam | `plugins/withNetworkProxyModule.js` 生成的 `CloseSafeGlideStreamFetcher` 统一拥有 call/body 状态；`CloseSafeGlideUrlLoader` 与 `CloseSafeGlideUrlWrapperLoader` 必须同时在 App Glide registry 覆盖对应 model，wrapper 继续包装读取进度。依赖升级不能替代本项目的明确资源所有权。 |
| 必须保持的行为 | 正常 2xx 响应把可读 stream 交给 Glide，body 在 `cleanup()` 前保持打开；`cancel()` 原子取消 call 并 close 当前已拥有 body；取消或 cleanup 后到达的 response 只 close 一次且不触发 ready/failure callback；cancel 后 transport failure 不回调；`cleanup()` 和 `cancel()` 任意顺序、任意重复都 close exactly once；非 2xx 及 body/stream acquisition 任一步异常都在 Glide 观察 failure 前关闭当前 owner且只回调一次；Expo wrapper 的 source key 与逐字节/完成 progress callback 保持。该 close 只释放当前媒体资源，不触发 read-runtime rotation、Query 刷新或媒体自动重放。 |
| 精确失败 oracle | fresh prebuild 生成的 8 个 `regTopic074*` Kotlin tests 固定 cancel-after-200、body acquisition 异常 close-once、cancel/cleanup 后 late-200、cancel 后 failure、cleanup/cancel 双顺序幂等、非 2xx close-before-failure，以及 Expo wrapper progress；`tests/tooling/network-proxy-plugin.test.ts` 与 `tests/tooling/release-packaging.test.ts` 固定两种 loader 的生成/注册和 timeout 配套。恢复 upstream fetcher 时 cancel-after-200 与 acquisition-exception 测试必须先红。 |
| 最低可靠自动测试层 | `STATIC_PASS + APK_SANITY + LIVE_PASS`：生成 Kotlin JUnit 固定真实 OkHttp/Glide 回调所有权，tooling 只固定持久化生成 seam，fresh prebuild 后 Release Kotlin compile 固定锁定依赖 API；匹配 APK 的 log 才能证明真实批量取消无泄漏。JS mock Image 或源码字符串不能替代 Kotlin 行为测试。 |
| Replay 或真实验收路径 | 沿 `REG-PERF-010` 在同一 PID 打开并滚动 `post-863650-1`，在仍有媒体运行时 Back，再打开普通图片主题；必须能立即交互且 log 中没有 `ResponseBody leaked`、ANR、OOM、FATAL 或进程重启，普通图片与 progress 诊断继续结算。全程只读，不清数据、Cookie 或登录态。 |
| 负向验证方式 | 恢复 upstream fetcher、只在 cleanup 关闭、cancel 只取消 call 不关闭已接收 body、让迟到 200 回调 Glide、重复 close、非 2xx 在 failure 后才关闭，或只覆盖普通 `GlideUrl` 而漏掉 Expo wrapper，对应 Kotlin oracle 必须失败。 |
| 明确不覆盖范围 | 不升级或 fork Glide/Expo，不改 RN fetch、视频、SVG artifact 的独立 response owner，不在既定“一次自动 + 一次显式”之外重试失败图片，也不把资源泄漏误判为整个 App 读取通道污染。 |

## `REG-TOPIC-075` 全屏原图翻页把已访问图片累积成 decoded Bitmap 工作集

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `NAV-03` 与 `REG-PERF-010` 的预览生命周期 |
| 用户症状 | 海量图片帖的正文已经可以滚动，但进入全屏预览并快速切过多张图片后，Native Heap/PSS 持续增长；关闭预览、返回 Feed 60 秒后仍不回落。极大原图还可能单张占用数百 MiB，使 App 再次卡顿或被系统杀死。 |
| 触发条件 | 第一层旧实现把每个新 current 页设为 `cachePolicy=memory-disk` 且 `allowDownscaling=false`，使 Expo Image 3.0.11 使用 Glide `DownsampleStrategy.NONE`。修正该参数后的首轮 Release 反证仍失败：Pager 虽只有三个 logical children，outer key 随 logical index 更换，而 PagerView Android adapter 的 non-recyclable holder 可继续持有旧 target；同时远程 `displaySource` 被作为 Expo placeholder，Android `PlaceholderDownsampleStrategy` 的 scale factor 固定为 `1`，当 display/original URL 相同时会额外完整解码同一原图。现场 9983×6000 图片的理论 ARGB Bitmap 约 228 MiB；修正参数后的第二候选翻 25 张仍达到 Native Heap 556 MiB，证明三槽数量与 `allowDownscaling` 本身都不是完整 Bitmap 上界。 |
| 根因 seam | `ImagePreviewModal` 拥有稳定的三个 physical slots，slot identity 不随 logical index 增删；`PreviewPageLoadLayer` 在每个 slot 内复用稳定 raster/underlay Native owner，以 `source/recyclingKey` 替换资源并统一拥有全屏 raster、连续显示 underlay、静态 SVG poster 和动画 continuity poster 的 decoded-resource policy；`src/platform/media/previewBitmapBudget.ts` 只把 viewport/DPR 转成固定 Native decode target。不得在关闭预览时调用全局 `Image.clearMemoryCache()` 误伤 App 其他健康图片。 |
| 必须保持的行为 | 逻辑 catalog、原图 URL、点击 index、保存原文件和 previous/current/next 三槽保持；三个 outer slot 与槽内 raster/underlay owner identity 稳定，logical page 变化只给已移出屏幕的槽替换 source/recycling key 并重置 logical load owner，目标/当前槽 owner 不变，旧图迟到回调不能结算新图，不可见 underlay 须以 `source=null` 清 target。所有 Expo Image 基础路径显式使用 `cachePolicy=disk` 与 `allowDownscaling=true`，source 长边 `<=2,048px` 且总像素 `<=4,194,304`；相同 display/original URL 不创建 underlay，不同 URL 只用普通受预算 Expo Image 作 underlay，远程 URL 零 Expo placeholder decoder。current 基础层只提升优先级，不能创建无像素预算的完整 Bitmap。缩放、双击、下拉关闭、Android Back 与无障碍翻页继续可用；像素级深度缩放只允许由 `REG-TOPIC-112` 的当前视口 quality owner 提供，不能恢复逐页 `DownsampleStrategy.NONE`。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `[REG-PERF-010][REG-TOPIC-075]` 用 2000 项 catalog 任意跳到中段并连续切页，要求三个 direct physical key 不变，10 次 shift 前后 main raster owner 仍为 3、异 URL underlay owner 仍为 3，且同一 owner 的 source/recycling key 确已推进；另用例固定旧 logical source 的迟到 `onDisplay` 不得结算新 source。全部 mounted raster 为 `cachePolicy=disk`、`allowDownscaling=true` 且 source 命中 2,048px/4,194,304 pixels 上限。同 URL要求零 underlay，异 URL 要求受预算 underlay且 main 的 `placeholder` 为空；`previewBitmapBudget` unit 固定正常与非法 viewport/DPR。`REG-TOPIC-050` 固定 current/adjacent 切页不改变策略，`REG-TOPIC-018/043` 同时固定 continuity/static poster。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY + LIVE_PASS`：RNTL 固定 Expo Image 系统边界 props 与三槽；只有身份匹配的 Release APK 连续翻页、关闭及 60 秒 PSS/Native Heap 采样才能证明 Glide cache/pool 没有按已访问页增长。 |
| Replay 或真实验收路径 | 保留数据覆盖安装后直达 `post-863650-1`，记录进入预览前 PSS；用正常 250–300ms 横滑连续翻页，不点击保存或系统权限提示，分别在 0/25/100 页及关闭后 60 秒采样同一 PID。峰值相对进入前 `<=150MB`，关闭后 `<=+80MB`，无 OOM/FATAL/PID 变化；同时核对原图显示、页码、缩放、Back 与正文返回位置。 |
| 负向验证方式 | 任一 current/adjacent/underlay/poster 恢复 `memory-disk`、省略显式 downscaling/decode target、把 logical index 放回 physical slot/native owner key、在 stable outer slot 内又按 logical index 重建 raster/underlay owner、翻页时更新目标槽 source、让旧 callback 结算新 source、把远程图片传给 Expo placeholder decoder、成为 current 后切到 `allowDownscaling=false`，或关闭时全局清图片内存缓存，对应 oracle 必须失败；设备 PSS 随已访问页近似线性增长也直接失败。 |
| 明确不覆盖范围 | 不引入图片服务端缩略规则、全局 cache 清理、完整原图 Bitmap 或多 tile cache；本条只保证三槽基础显示与原文件保存，当前视口 1:1 清晰度由独立 `REG-TOPIC-112` 负责。 |

## `REG-TOPIC-112` 全屏已下载原图仍按 2048px Bitmap 放大，长图当前视口模糊

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `REG-TOPIC-075/095/096` 的预览资源、手势与三槽生命周期 |
| 用户症状 | 图片在原站和原始 URL 上清晰，App 也已下载原图，但点进全屏后仍模糊；长图在适屏和深度放大时尤其明显，用户无法看到原图细节。 |
| 触发条件 | 全屏 original source 仍被 `previewBitmapDecodeTarget()` 限制为长边约 2,048px / 4,194,304 pixels，随后 `ResumableZoom` 只放大该有界 Bitmap；固定 8 倍 max scale 又可能在原图达到设备物理 1:1 前停止。文件字节是原图不代表已解码 Bitmap 仍有原图像素。 |
| 根因 seam | `ImagePreviewModal.PreviewPage.active` 是唯一高清所有权；基础原图 `onDisplay` 后由 Expo Image `getCachePathAsync(cacheKey)` 只读同一 Glide 磁盘文件，`ResumableZoom.getVisibleRect()/getState().scale` 只在静止点产出 viewport，`PreviewRegionImage` Native View 用 `BitmapRegionDecoder` 解码该区域并把 upright 尺寸回传给同一 resolution owner。三槽基础 owner、正文 `TopicBodyMediaCoordinator` 和网络链路不参与高清调度。 |
| 成熟项目证据 | [Subsampling Scale Image View](https://github.com/davemorrissey/subsampling-scale-image-view) 采用低清底图与可见区域 subsampling；[ZoomImage subsampling](https://github.com/panpf/zoomimage/blob/main/docs/subsampling.zh.md) 复用本地缓存并在手势期间暂停加载；[Telephoto RealSubSamplingImageState](https://github.com/saket/telephoto/blob/trunk/zoomable-image/sub-sampling-image/src/androidMain/kotlin/me/saket/telephoto/subsamplingimage/RealSubSamplingImageState.kt) 串行区域解码并处理方向映射。本项目只学习当前视口工作集，不引入它们的完整图库、tile cache 或预取框架。 |
| 必须保持的行为 | `REG-TOPIC-075` 的三个稳定基础 raster owner、disk-only cache、downscaling 和 2,048px/4MP budget 原样保留，全程负责连续显示。只有已提交 active index 的当前静态 raster 在基础原图显示后可挂一个高清 View；相邻/离屏/SVG/动画高清 owner 为零。高清只读缓存路径，不重复 HTTP；手势开始立刻 suspend、取消旧 generation 并回收区域 Bitmap，结束后只提交一次归一化 viewport/scale，失败透明回退基础图。区域 sample 必须让当前视口解码像素不低于最终屏幕物理像素，八种 EXIF orientation 的解码、绘制和 upright 尺寸一致；decoder 每个任务关闭，旧任务结果与卸载结果回收。最大缩放为 `max(3, 1 / (fitScale × PixelRatio))`，不得保留固定 8 倍上限。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的 `[REG-TOPIC-112]` 要求当前页基础 `onLoad + onDisplay` 后才出现唯一 `preview-region-*`，邻页基础图仍挂载但无高清 owner；pinch start 使其 `suspended=true`，gesture end 一次提交新 viewport/scale；横滑动画结算前 owner 不转移，结算后旧高清卸载、新 active 才解析缓存；Expo 报告 SVG/动画时缓存解析为零，缓存 miss 时高清 owner 为零且基础图保留。`src/platform/media/previewBitmapBudget.test.ts` 要求长图 1:1 max scale 可超过 8、随 DPR 改变且非法输入安全回退。fresh prebuild 生成的 `PreviewRegionImageMathTest` 固定八方向 upright→encoded 和 encoded→upright、5–8 尺寸交换、power-of-two sample 与 stale generation 拒绝；Release Kotlin compile 固定 ViewManager 接线。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：Vitest/Kotlin 固定数学与任务代次，RNTL 固定 owner/手势/切页；只有匹配 APK 的真实 raster、Glide cache、Canvas/EXIF 和计时才能证明清晰度、零新请求及 `<=300ms`。 |
| Replay 或真实验收路径 | 保留数据覆盖安装匹配 APK，用一张普通图、一张 `1080×10000` 长图和一张旋转 JPEG：首次静止后对照原站细节，放大到原图 1:1，拖动中允许基础质量，松手后 `<=300ms` 恢复；连续左右切图并观察当前最多一个高清 View、邻页为零、无新增图片 HTTP、无 OOM/FATAL/PID 变化及持续 PSS 增长。不得点击保存或清缓存制造状态。 |
| 负向验证方式 | 删除高清层、把整张原图交给 `allowDownscaling=false`、提高 2,048/4MP、恢复固定 8 倍、让邻页预解码、每帧跨 JS/Native 更新 viewport、缓存 miss 后重新下载、复用正文 coordinator、手势中保留旧区域、忽略 EXIF 或接受 stale generation；对应 JS/Kotlin oracle、网络或实机清晰度/内存验收必须失败。 |
| 明确不覆盖范围 | 首轮只处理 Android `BitmapRegionDecoder` 可读取的静态 raster；SVG、动画和不支持格式继续走现有行为。不增加多 tile cache、预加载、第二套可见性协调器、图库依赖或服务端图片规则。若代表性 JPEG/PNG/WebP 错位、方向错误或主设备不能稳定在 300ms 内恢复，停止扩展自研层并评估成熟 subsampling 库，不用整图解码上限掩盖。 |

## `REG-TOPIC-076` V2EX 完整性不确定时清空可信评论或进入后台轮询

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03/04`；共享 `NAV-02/03` |
| 用户症状 | 直达 `https://www.v2ex.com/t/1232881` 时首次出现整页“窗口错误”；重复进入数次后又能完整加载。故障期间主题正文和第一页已经解析成功的评论也全部不可见，旧修复还会在后台反复读取。 |
| 触发条件 | V2EX 第一页 HTML 声明并呈现 `#1..#100 / count=106`，显式第二页暂时仍是旧 `count`，或任意一条回复节点 malformed/重复/缺楼。页面稍后可能自行一致不是 App 等待或探测它的理由。 |
| 根因 seam | adapter 把集合完整性和单行可信性合成一个失败边界，Controller 又把来源不确定性扩成 typed error、timer 和重试状态；一个不可信节点或计数因此同时清空可信行并制造后台请求。 |
| 必须保持的行为 | Topic 首读只请求主题 API 与第一页 HTML，逐条保留可解析且位于第一页边界的唯一评论。有效第一页可在仍有 next cursor 时标为 complete 并显示可信总数；普通打开不再发 Reply Query。用户触边后只读取下一显式页：返回 partial 时仍追加所有有效行，例如第二页缺一条时从 100 增至 146；整页失败保留前 100 条、正文和同一 end cursor 的评论级重试。任何结算都不创建 timer、轮询、typed stale 或自动重试。partial 显示“部分评论未能读取，已显示 N 条”，筛选、查找和远端排序继续可用；只有无 next 且窗口无 partial 时显示末尾确认。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 固定 malformed 中间节点仍保留其他有效行，跨页声明变化、缺楼、重复和外站链接只影响对应窗口，API 非空数量不符也返回 partial。`tests/ui/topic/topic-session-controller.test.tsx` 固定首屏 100 条时 Reply transport 为 0；显式加载恰一次后得到 147 条；第二页缺一条时采用 46 条 partial 并合计 146；整页失败仍保留 100 条，60 秒零追加；route target 只发一个 target Query。`tests/ui/topic/topic-reply-filters.test.tsx` 固定 partial 标记与确认条数。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：fixture 固定可信子集与完整性边界；fake timers 只证明长时间零追加请求，不模拟收敛。匹配 revision/APK 的 Live 只证明真实站点当次 partial 或 complete 体验，不通过真实写回复制造竞态。 |
| Replay 或真实验收路径 | 保留主 AVD 数据覆盖安装匹配 APK，核对 `firstInstallTime` 不变后，从 App 内直达 `https://www.v2ex.com/t/1232881`。正文和第一页可信评论必须立即可见，静置不自动补齐；向下滚动后才读取并追加显式下一页。再只读确认正倒序、楼层定位与“仅刷新评论”；partial/失败时保留全部已解析行、显示受影响标记且结算后不继续请求。不得回复、点赞、清 App 数据、Cookie、登录态或重置模拟器。 |
| 负向验证方式 | Topic Query 自身请求第二页或公共回复 API、任一 malformed/计数差异让其他可信评论消失、普通打开启动 Reply Query、cursor Query 读取多页、partial 丢掉同页有效行、创建 timer/polling/typed stale、失败后自动追加请求、评论刷新重读正文、取消后仍写旧 cache，编号测试必须失败。 |
| 明确不覆盖范围 | 不判断不同步发生在 CDN 还是站内应用缓存，也不判断何时恢复一致；不增加后台探测、缓存参数、新 transport、依赖或持久状态，不把公共 API 与已声明 HTML 拼接。 |

## `REG-DATA-007` 内容源设置未读到就按全关处理或永久阻塞启动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `DATA-01/02/03`、`NAV-01`、`MORE-05`；共享 `FEED-01`、`SEARCH-01`、`LIBRARY-01`、`ACCOUNT-01`、`NOTIFY-03` |
| 用户症状 | 首次或冷启动先看到所有来源消失、搜索显示“未启用/暂停”，甚至一直停在启动页；同时已经存在的收藏、历史或关注可能被空设置覆盖。 |
| 触发条件 | `reader-settings` 缺失、损坏、非对象、AsyncStorage reject 或永不 settle；启动投影把“尚未读到”当成 deny-all，或无界等待独立设置 key。 |
| 根因 seam | `src/platform/storage/readerDataStore.ts` 的双 key 读取、`src/app/useReaderRuntime.ts` 的启动结算和 `src/domain/reader/contentSourcePreferences.ts` 的默认投影没有共同区分“配置缺失可默认”与“ReaderData 损坏需恢复”。 |
| 必须保持的行为 | `reader-data` 与 `reader-settings` 的本地读取均最多等待 3 秒。有效设置原样清洗；设置缺失、损坏、非对象、reject 或超时后，内容源以 Catalog 默认顺序四站全启用，且保留已经成功读取的 ReaderData 与其他有效设置。deadline 后迟到的设置不得二次发布。headless `loadReaderSettings()` 使用同一规则。routes 只在 ReaderData 本轮结算后发布；ReaderData 自身损坏、版本不支持或读取失败继续进入既有写入暂停的恢复模式，不用默认设置覆盖用户资料。storage key 和 ReaderData version 不变。 |
| 精确失败 oracle | `src/platform/storage/readerDataStore.test.ts` 固定 headless 与完整 ReaderData 路径的 missing/malformed/non-object/reject/never-settle/late-result，并要求有效 history 保留、`contentSources` 恢复四站全开；`src/domain/reader/contentSourcePreferences.test.ts` 固定默认顺序与清洗；`src/app/useReaderRuntime.test.ts` 固定 ReaderData 失败进入恢复模式而非可写空数据；`tests/ui/app/app-composition.test.tsx` 固定等待期有可访问启动状态。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：存储 fake timer 固定 3 秒与迟到拒绝，runtime/UI 固定恢复和启动可达；只断言 `createEmptyReaderData()` 不足以证明有效 ReaderData 未被丢弃。 |
| Replay 或真实验收路径 | 保留 App 数据覆盖安装并记录来源设置、收藏/历史摘要与 `firstInstallTime`，执行冷启动和 relaunch；确认本机数据、设置和入口保持。不得破坏 AsyncStorage 或清数据制造故障；超时分支由确定性测试固定。 |
| 负向验证方式 | 移除 local-read deadline、让未加载投影返回空 enabled set、从 `reader-data` 回退旧 disabled 配置、设置失败时替换整份 ReaderData，或接受 deadline 后迟到结果，编号测试必须分别出现永久 pending、全关、资料丢失或二次布局变化。 |
| 明确不覆盖范围 | 不把真实 ReaderData 损坏静默当成首次安装，不自动修复或覆盖损坏资料；恢复写仍只允许既有备份导入路径。 |

## `REG-PROXY-011` 代理初始化冻结本地页面或失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-01`、`NAV-01`、`LIBRARY-01`；共享 `FEED-01`、`SEARCH-01`、`TOPIC-01/02`、`USER-01`、`ACCOUNT-01/02`、`MORE-04` |
| 用户症状 | SecureStore 或原生代理初始化稍慢时，App 白屏/启动页停留数秒甚至卡死，收藏和更多等本地页面也进不去；另一种修补会在配置读取超时或 runtime 卸载后放行直连，泄露本应经代理的请求。 |
| 触发条件 | routes 与 proxy `loaded/applyStatus` 共用全局 startup gate；或给整个 load + native apply 套同一个 JS timeout，超时后把空配置当作“代理关闭且可直连”。 |
| 根因 seam | `src/app/useAppRuntime.tsx` 的 route readiness、`src/platform/network/useNetworkProxyRuntime.ts` 的 SecureStore owner/load/apply queue，以及 `networkProxyFetcher`/WebView 的请求前 readiness 没有分离本地导航可用性与网络安全性。 |
| 必须保持的行为 | routes 只等待 ReaderData，不等待代理。proxy SecureStore load 最多 3 秒；超时、reject 或 owner unmount 会把本 runtime 结算为 failed 并释放等待者，但 `networkProxyFetcher`、更新请求和 WebView 仍在 transport 前 fail-closed。saved state 成功后必须等待同一串行队列里的完整 native apply；native apply 自身不受 3 秒 load deadline，也不能被另一个短 JS deadline 误判为可直连。旧 owner 的迟到 load/apply 不能覆盖新 runtime。apply 状态进入媒体 transport identity，代理可用后温缓存 Avatar 等重新尝试。 |
| 精确失败 oracle | `tests/ui/app/app-runtime-startup.test.tsx` 固定 proxy `loaded=false` 时本地 routes 已发布；`tests/ui/more/network-proxy-controller.test.tsx` 固定 never-settling load、unmount、late failure、慢 native apply 与后续 reset 串行；`src/platform/network/networkProxy.test.ts` 和 tooling guards 固定 failed 状态不直连；`src/platform/media/mediaSessionEpoch.test.ts`、`tests/ui/shared/avatar.test.tsx` 固定 readiness 进入媒体 identity 并在可用后恢复。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：hook 测试必须观察本地 route 与 transport waiter 两条独立生命周期；只看启动页出现或 proxy modal 文案不能证明未直连。 |
| Replay 或真实验收路径 | 匹配 APK 冷启动后直接进入 Library 与 More，再核对服务器代理面板和正常来源 outcome；默认不启用真实代理、不损坏 SecureStore。真实 slow/failure 由 fake timers 固定，公网代理结果未经授权标 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 `routes = readerDataLoaded && proxyLoaded`、在 load timeout 后使用裸 `fetch`、把 native apply 放进 3 秒 race、unmount 时 resolve 为可直连，或移除 media identity 的 apply status，对应测试必须失败。 |
| 明确不覆盖范围 | 不放宽代理 transition、连接、DNS 或 relay 的既有 fail-closed 契约，不声明任意第三方代理可用，也不为缩短启动跳过 native apply。 |

## `REG-SOURCE-011` 账号未知被当成整站不可用并锁死公开读取

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`SEARCH-01..04`、`TOPIC-01/03`、`USER-01`、`ACCOUNT-01/02`、`MORE-05`；共享 `NAV-02`、`WRITE-01..04` |
| 用户症状 | App 启动或账号检查暂时失败后，公开可读的 Feed/Search/Topic/User 全部显示“账号状态未知/暂停”，任一来源核对 activity 还能让“全部”永久 Loading；反向降级时，妖火或私有操作又可能被误走匿名 transport。 |
| 触发条件 | source-wide identity barrier 同时代表账号核对 activity、公开读取和私有权限；Controller 先用检查状态决定整页，再由 Gateway 猜 anonymous/authenticated，Query key 没有区分实际读取 lane。 |
| 根因 seam | `src/domain/forum/readPlan.ts`、`src/sources/readGateway.ts`、聚合 child fetcher 与 Feed/Search/Topic/User Query key 是同一个 operation capability seam；账号事实不应拥有来源静态能力。 |
| 必须保持的行为 | ReadPlan 是 `Catalog + enabled set + current SessionRuntimeSnapshot + operation` 的纯派生，不持久化。结果只能是 ready `local/public/authenticated` 或 typed blocked `source-disabled/identity-pending/identity-unavailable/login-required/capability-unavailable`。public lane 只用 native no-cookie fetcher 并强制 `credentials: omit`，credential loader、Cookie 和 managed WebView fallback 为 0；authenticated lane 才使用受管会话。V2EX 公开，NodeSeek/linux.do的 Feed/Search/Topic/Replies/Reply/User Profile 公开；用户名解析、筛选候选、AI、等级等严格。妖火仅 Categories 为 local，所有远程读取严格。每个 direct/aggregate Query key 和写操作 cache target 绑定 plan scope；Gateway 发网前后复核 scope，计划改变使迟到结果 stale。聚合显式给每个 child 选择 plan/fetcher，不从 URL 猜来源，blocked child 不阻断公开 sibling。 |
| 精确失败 oracle | `src/domain/forum/readPlan.test.ts` 固定 operation 矩阵和 scope；`src/sources/readGatewayContract.test.ts` 固定没有确认身份时 public lane 零 Cookie/credential/fallback、妖火 strict/local、typed login action、聚合 V2EX 显式 child plan 和 scope 迟到拒绝；`tests/integration/query-session-contracts.test.ts` 固定 public/authenticated cache 隔离；Feed、Search、Topic、User controller UI tests 固定 true unknown 的公开读取、strict 终态与恢复，并固定 confirmed 核对 activity 不改变计划；Topic action test 固定 mutation 只改当前 plan scope。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：必须穿过实际 Gateway 与 Query owner 观察 fetcher/credential 调用和 cache identity；只测纯矩阵或页面文案不能证明匿名 lane 没带 Cookie、也不能证明迟到 authenticated data 未串入。 |
| Replay 或真实验收路径 | 保留账号与数据，在更多页单站刷新期间打开公开 Feed/Search/Topic/User，确认 confirmed 身份继续可用且不出现永久暂停；妖火没有确认身份时只显示可恢复登录/核对终态且零远程读。无法安全稳定制造 unknown 时，动态该分支标 `NOT_VERIFIED`，不清 Cookie、不人为断网。 |
| 负向验证方式 | 把核对 activity 重新作为整个来源的 barrier、让 public lane 使用 managed fetcher、从 URL 推断 aggregate child、删除 plan scope key/currentness，或把妖火远程操作列为 public；对应测试必须出现暂停、credential/fallback 调用、缓存串用或越权请求。 |
| 明确不覆盖范围 | 不改变各站真实匿名能力，不把写入、通知、AI、等级或 username resolution 降级公开；Google/站点当天可用性仍由 Live 证据判断。 |

## `REG-SOURCE-012` 旧详情的“管理内容源”只进入 More、面板仍折叠

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-05`；共享 `FEED-01`、`SEARCH-01`、`LIBRARY-01`、`TOPIC-01`、`USER-01`、`NOTIFY-02`、`NAV-01/02` |
| 用户症状 | 从已停用的 Topic、User 或旧 NotificationDetail 点击“管理内容源”后虽然返回 More，内容源面板仍折叠，用户还要再次寻找并展开入口。 |
| 触发条件 | native stack 只 `popTo(MainTabs, screen=more)`，没有表达目标面板；More 也没有可消费的一次性导航意图。 |
| 根因 seam | 所有内容源管理入口 → `MainTabs.more` route params → `MoreRoute` → `ContentSourcesPanel` 的导航意图边界。 |
| 必须保持的行为 | Feed、Search、Library 与 disabled Topic/User/NotificationDetail 共用同一个 `manage-content-sources` action。More 获得该意图后展开内容源面板，并在 nested navigation 结算后消费参数；普通点击 More 仍以既有折叠状态进入，用户之后的开合状态不因普通重渲染被重置。该意图不持久化、不修改 ReaderSettings，也不触发来源请求。 |
| 精确失败 oracle | `tests/ui/app/content-source-navigation.test.tsx` 挂载真实 Feed/Search/Library Route、Root Stack、Bottom Tabs 与 MoreRoute：三个入口均须到达已展开面板，当前 More route params 随后为空；用户收起、离开并普通返回 More 后仍保持收起。`tests/ui/app/content-source-route-gates.test.tsx` 继续真实渲染三个 disabled route 与 ContentSourcesPanel，固定其 action 和本地开合行为。 |
| 最低可靠自动测试层 | `UI_PASS`：必须由 RNTL 穿过真实 Stack/Tab router，观察实际 Route 的按钮、More 可访问展开状态、参数消费及离开返回后的状态；mock dispatch、源码字符串或只断言切到 More 均不足。 |
| Replay 或真实验收路径 | 保留数据并停用一个来源，从其 Topic/User/旧通知详情分别点击“管理内容源”，确认直接看到已展开的内容源面板；再普通切换到 More，确认不会无故强制展开。 |
| 负向验证方式 | 移除任一 Feed/Search/Library 入口的 shared action、删掉 nested intent、同步清参而被 nested 初始化覆盖、不消费 route param、清参时重置本地面板状态，或让普通 More 也携带意图；编号测试必须失败。 |
| 明确不覆盖范围 | 不滚动到具体来源行，不改变停用、排序、账号对账或请求门禁语义。 |

## `REG-SEARCH-024` 首次进入搜索被账号提示占据且来源不能独立结算

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01/02/03/04`；共享 `ACCOUNT-01/02` |
| 用户症状 | 用户尚未输入关键词时就看到“账号状态未知/暂停搜索”；提交后一个站没有确认身份会让整页一直忙碌，公开来源结果也不出现。 |
| 触发条件 | 未提交 Query 的 pending state、账号状态 chip 和已提交搜索共用一个页面 busy 模型；聚合搜索按全局 identity barrier 启停，而不是逐来源 ReadPlan。 |
| 根因 seam | `src/features/search/useSearchController.ts` 的提交快照/逐来源 `useQueries`、`SearchScreen` 的 idle/blocked presentation 和 `forumQueryKeys.search` 的 ReadPlan scope。 |
| 必须保持的行为 | 首次进入和清空关键词后不显示账号 unknown、核对中或暂停搜索提示，提交按钮仅由真实已提交请求控制。提交时只捕获当前 enabled 来源及用户顺序，每站按 ReadPlan 渐进结算；没有确认身份的公开 lane 继续运行，strict blocked 形成有界来源终态和“重试核对/登录”动作且零搜索 transport，不能阻断 sibling 或 `search-all-sources-settled`。AI、tags/users candidates 等 authenticated operation 保持关闭。身份随后 confirmed 时创建新的 authenticated scope/key，只由当前提交重新读取，旧 public 结果和迟到响应不得串用。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 固定 idle 首屏与来源级状态；`tests/ui/search/search-controller-ai.test.tsx` 固定 unknown public single/all、strict timeout 终态、核对重试、AI 仍 blocked 和 confirmed 后新 scope；`tests/integration/query-session-contracts.test.ts` 固定 public/authenticated search key 分离；`tests/integration/session-presentation-contracts.test.ts` 固定没有确认身份仍暴露公开 lane；`src/sources/readGatewayContract.test.ts` 固定 anonymous transport 与迟到 scope 拒绝。 |
| 最低可靠自动测试层 | `UI_PASS + UNIT_PASS`：RNTL 必须从未提交到提交、逐站结算和身份切换完整观察；静态文案检查或单测 fallback parser 不能证明页面不会永久 busy。 |
| Replay 或真实验收路径 | 打开 Search 首屏确认无暂停提示，提交同一关键词后观察所有已启用来源各自进入 data/empty/error/auth 等合法终态；账号自然核对期间公开来源继续，妖火单独提示登录/核对。Google/第三方受限可为来源错误，但不得永久 Loading。 |
| 负向验证方式 | 把账号核对 activity 恢复为 idle 页提示、用任一 strict source 控制全局 `enabled/busy`、从 key 删除 plan scope、允许 AI 在 public lane 启动，或 blocked source 不计入 settled；对应 UI/contract 测试必须失败。 |
| 明确不覆盖范围 | 不保证 Google、SoV2EX 或原站当天返回非空结果，不绕过 CAPTCHA/限流，也不把来源合法错误当成整页产品失败。 |

## `REG-SEARCH-025` 页面级账号状态重复来源级搜索结果

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01/02/04`；共享 `ACCOUNT-01/02` |
| 用户症状 | 一个站点需要登录或核对时，搜索页头先显示整页账号状态条，结果组又显示同一提示，用户会误以为整个搜索被暂停。 |
| 触发条件 | 页面维护一份固定站点账号状态列表，同时每个搜索结果组又按本次 operation 的 ReadPlan/error 投影状态。 |
| 根因 seam | `SearchScreen` 页头状态条与 `SearchGroup.authNotice` 重复拥有同一个来源操作状态。 |
| 必须保持的行为 | 搜索页只展示本次受影响结果组的登录、验证或错误提示；其他来源继续独立结算。未提交首屏没有账号状态条，妖火等 strict 来源仍在自己的结果组提供恢复提示。 |
| 精确失败 oracle | `tests/ui/search/search-screen.test.tsx` 的 `REG-SEARCH-025` 通过真实 `SearchRouteRuntimeProvider`、SearchRoute、Controller 和 Query 结算V2EX 公开结果与妖火 strict 结果，要求整个 route 只有妖火结果组的一份登录提示；恢复 Route 透传或 Screen 页头的页面级状态会出现第二份提示。 |
| 最低可靠自动测试层 | `UI_PASS`：必须运行真实 SearchRoute、Controller、Query effect 与来源结果组；只渲染 SearchScreen props、纯函数或字符串检查不能发现第二 owner。 |
| Replay 或真实验收路径 | 在保留账号的匹配 APK 中提交“全部”搜索；某站需登录或核对时只在该站结果区提示，其他站结果和页面输入仍可操作。 |
| 负向验证方式 | 恢复页头跨来源账号 chip、硬编码搜索账号来源列表，或在 result group 之外再投影同一状态；编号测试必须出现重复提示。 |
| 明确不覆盖范围 | 不隐藏来源真实错误，不移除结果组的登录/验证恢复动作，也不放宽妖火远程读取。 |

## `REG-SEARCH-026` 搜索筛选收起键盘后弹层持续上跳

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-03`；共享回归 `ACCOUNT-05`、`MORE-01` |
| 用户症状 | Android 搜索筛选中点开 V2EX 节点或 Discourse 标签、分类、作者输入，收起键盘后弹层仍向上偏移；已复现关闭按钮从 y=1327 移到 y=1128，连续操作可能重复出现。 |
| 触发条件 | 共享透明 `Modal` 内的 `KeyboardAvoidingView` 固定启用 `behavior="height"`；Android 键盘隐藏事件仍可携带非零末帧，React Native 内部 `state.bottom` 因而保留补偿。只把 `enabled` 改为 `false` 仍会因内部 `state.bottom > 0` 输出固定高度与 `flex: 0`，真实复测残留 136px。 |
| 根因 seam | `src/ui/controls/ModalSheetFrame.tsx` 对 Android 键盘可见状态与高度避让的统一 ownership。 |
| 必须保持的行为 | Android 只在收到 `keyboardDidShow` 后启用共享高度避让，`keyboardDidHide` 后禁用并重建该共享 KAV，弹层关闭同样使用干净实例；连续两轮打开/关闭键盘不累积偏移。键盘打开时输入和底部操作仍可见；iOS 行为、调用方 `keyboardAvoidingEnabled`、账号编辑器覆盖逻辑与代理表单的手动 inset 不变。 |
| 精确失败 oracle | `tests/ui/shared/modal-sheet-frame.test.tsx` 在 Android 连续发送两轮 `keyboardDidShow`/`keyboardDidHide`，要求 `KeyboardAvoidingView.enabled` 每轮依次为 `false → true → false`，show 不换实例而每次 hide 必须换成干净实例；第一版仅禁用的修复会在实例断言失败。真实 App 用 `search-filter-close` 边界对照，关闭键盘后与初始位置差不得超过 2px。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定共享状态机，匹配 revision/APK 的 Android 几何对照固定原生键盘与透明 Modal 组合；只看 App 可启动或最终关闭弹层不足。 |
| Replay 或真实验收路径 | `tests/device/search-multi-source.ad` 只读打开 V2EX 筛选，点入节点输入并执行 `keyboard dismiss` 收起输入态，再关闭弹层；不确认筛选、不提交论坛写入。Agent Live 再对 V2EX 节点及 Discourse 标签、分类、作者输入各连续两轮记录弹层边界。 |
| 负向验证方式 | 恢复 Android 始终启用高度避让，或 hide 后只禁用而不重建 KAV，编号 UI 测试必须失败；只在 V2EX 或某个调用方局部清偏移时，共享账号/代理回归与 Discourse Live 仍会暴露不一致。 |
| 明确不覆盖范围 | 不修改 `windowSoftInputMode`、代理表单 inset、候选请求协议、输入法实现或 iOS 键盘策略，不新增依赖。 |

## `REG-SEARCH-027` 聚合搜索结算后进入 V2EX 导致 App 退出

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01/02/04` |
| 用户症状 | “全部”搜索完成后点击 V2EX，App 立即退出到系统桌面；Release 日志为 JS `TypeError: Cannot read property 'length' of undefined`，栈位于 TanStack Infinite Query 的 `hasNextPage/getNextPageParam`。 |
| 触发条件 | 聚合 V2EX 预览与单站 V2EX 默认搜索具有相同来源、关键词、ReadPlan、session epoch、筛选和排序；普通 `useQueries` 先把单页 `RemoteSearchSourceResult` 写入 key，随后 `useInfiniteQuery` 以同一 key 把它当作 `{ pages, pageParams }` 读取。 |
| 根因 seam | `src/platform/query/serverState.ts` 的 Search Query key 数据形状身份，以及 `src/features/search/useSearchController.ts` 对聚合预览和单站分页的 key 选择。响应形状不同却缺少 lane，违反同一 Query key 只对应一种数据形状的约束。 |
| 必须保持的行为 | “全部”继续按来源渐进显示每站最多 2 条且不分页；单站继续从第一页读取完整连续列表并独立分页。两类 key 以 `preview/pages` lane 区分，同时保留 `forum → source → search` 前缀，使来源取消、账号 scope 清理和重试仍覆盖两者。切换来源保留关键词和筛选，不增加 shape guard、复制缓存或额外请求状态。 |
| 精确失败 oracle | `tests/ui/search/search-controller-ai.test.tsx` 的 `[REG-SEARCH-027]` 使用真实 `QueryClient` 先结算四站聚合预览，再切换相同默认条件的 V2EX；修复前稳定抛出 `pages.length` TypeError，修复后组件保持挂载、发起一次单站首屏请求、显示可分页结果，并同时存在含合法普通结果与 InfiniteData 的两个 lane。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY + LIVE_PASS`：RNTL 固定真实 Query observer 的状态转换与数据形状；匹配 Release APK 的首次覆盖启动日志和 App 内同路径确认 Native 进程未退出。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装且 `firstInstallTime` 不变；在搜索页提交 `codex` 的“全部”搜索，等待所有启用来源结算后进入 V2EX，确认当前关键词保留、单站列表结算、可继续分页，PID 不退出且无 JS Fatal、RedBox 或 ANR。第三方无结果或验证阻碍只影响数据轴，不得靠换关键词掩盖 App-owned 切换失败。 |
| 负向验证方式 | 删除 lane 或让 `preview/pages` 取同值，编号测试必须重新在来源切换时抛出 Infinite Query shape 异常；只在 `getNextPageParam` 加空值 guard 时，缓存形状断言与首屏请求仍必须失败。 |
| 明确不覆盖范围 | 不修改 TanStack Query、Search presentation、站点协议、ReadPlan、筛选默认值或持久化；Query cache 只在进程内存在，不增加迁移、兼容 key 或运行时数据修复。 |

## `REG-ACCOUNT-041` 账号刷新覆盖可信身份、重复 owner 或 unknown 被计为已登录

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`、`MORE-05`；共享 `FEED-01`、`SEARCH-01/04`、`TOPIC-01`、`USER-01`、`WRITE-01..04`、`NOTIFY-01..03` |
| 用户症状 | 更多页刷新账号时，已确认账号立即变成“待核对”，Feed/Search/通知换 lane；快速点两次又产生重复探测。网络、403、429 或 CF 后旧身份可能被永久降级，账号计数和私有入口闪动。 |
| 触发条件 | 把 probe lifecycle 写进 `identityTrust/status`，并让每次调用各建一个 transport；失败终态覆盖原账号事实。 |
| 根因 seam | `useAccountStatusController` 没有把核对 activity (`isVerifying`) 与 canonical identity 分开，也没有按来源 single-flight。 |
| 必须保持的行为 | 每来源只有一个 canonical identity owner和一个可复用进行中 Promise。核对开始只设 `isVerifying`；同来源快速调用复用 transport。A→A 只更新资料并持久化，不推进 epoch或刷新 Feed。超时、断网、403、429、Cloudflare、解析/普通失败只结束 busy、记录错误并保留原 identity/ReadPlan。只有协议明确 authenticated/anonymous/A→B 才提交新终态；unknown 只用于从未有可信终态或损坏记录，不计登录。后台 worker 在每次私有 transport/commit 前仍复核 allowlist、意图与 exact identity。 |
| 精确失败 oracle | `src/domain/session/siteSessionState.test.ts` 固定 trust 不含 pending；`tests/ui/account/account-status-controller.test.tsx` 固定并行公共刷新、同来源 single-flight、A→A 零 epoch/Feed、临时错误保留 confirmed；`tests/ui/account/account-center.test.tsx` 固定 confirmed-only 计数；notification tests 固定 `isVerifying` 不移除 active source及 identity/开关变化后零后续 commit。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：必须执行 deferred probe 与真实 Account/consumer 投影；只断言最终文案或 Promise dedupe 不足。 |
| Replay 或真实验收路径 | 保留三站登录态连续点击公共刷新两次，逐站只出现一个探测且同身份首页不重取；自然临时失败必须保留原账号并提供重试。不得断网或清 Cookie 制造状态。 |
| 负向验证方式 | 检查开始改 trust/status、每次点击新建 transport、A→A 推进 epoch、临时错误写 anonymous/unknown，或 `isVerifying` 暂停通知；对应测试必须失败。 |
| 明确不覆盖范围 | 不保证第三方身份端点健康，不自动重复 probe，不把 unknown 当退出或删除 Cookie/凭据；真实系统通知启用仍需独立授权。 |

## `REG-ACCOUNT-042` L 站验证成功后账号状态未自动同步

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`；共享 `FEED-01/02`、`SEARCH-01/03/04`、`TOPIC-01/03`、`USER-01`、`WRITE-01..04`、`NOTIFY-01..03` |
| 用户症状 | linux.do Cloudflare 验证通过并点击检查后面板退出，但账号中心与写权限仍显示旧状态；只有再点一次“刷新账号”才同步。 |
| 触发条件 | authoritative probe 先写入包含 `forumSessionEpoch` 的 Account Query，身份变化随即推进内容 epoch，使刚提交的账号结果换 key 或被 reset；workflow/runtime 另存的身份又与 Query 更新时机不同。 |
| 根因 seam | 稳定 Account key、`AccountSessionSnapshot` 唯一提交 seam、内容 epoch reset 与 `useVerificationController` 的成功/原页面恢复顺序。旧实现实际同时拥有 Query observation、workflow session 与 identity runtime 三份账号事实。 |
| 必须保持的行为 | 每来源只保存一份稳定 snapshot，Account key 不包含 `forumSessionEpoch`。成功 observation 必须先原子提交 confirmed snapshot，再推进目标站内容 epoch；Account Center 与同步权限门禁立即读取同一份数据。A→A 不推进 epoch；内容 reset 只处理 `forum` root，不迁移或 preserve Account。L 检查成功不补发第二次账号成功事件；其后原页面恢复失败只写 `lastError`，不撤销 confirmed。`confirmed` 必须有同来源有效 current user；`none` 不得暴露 logged-in，任何 malformed 成功结果结算 unknown。 |
| 精确失败 oracle | `src/domain/session/siteSessionState.test.ts` 固定 snapshot 规范化、矛盾组合 fail-closed 与 recovery error 保留 confirmed；`src/features/account/sessionQueryOwnership.test.ts` 和 `tests/integration/query-session-contracts.test.ts` 固定内容 epoch/reset 不影响稳定 Account key；`tests/ui/account/account-status-controller.test.tsx` 固定 L 成功后 snapshot、Account Center view 与同步 canWrite 在 reconcile Promise/epoch 回调前一致；`src/features/account/useVerificationController.test.ts` 固定零重复成功事件及 `recovery-failed` 语义；architecture guard 拒绝第二个 Account writer、epoch-scoped Account key、`AccountIdentityRuntime` 和 `setSiteSessionStates`。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + STATIC_PASS`：纯 snapshot、真实 QueryClient/controller、verification 顺序和 architecture guard 必须共同固定；只看到面板关闭、手动刷新后成功或源码字符串都不足。 |
| Replay 或真实验收路径 | 使用匹配当前 revision 的 APK 覆盖安装并保留 `firstInstallTime`、Cookie 与 App 数据。执行普通 linux.do A→A 检查，面板关闭时账号中心立即保持同步；若自然出现 Cloudflare，通过后点击检查并观察同一结果，禁止清 Cookie 强制制造。未自然出现时 CF 精确链路记 `NOT_VERIFIED`。 |
| 负向验证方式 | 把 Account key 重新放入内容 epoch、让 `resetForumSourceQueries` 清理 Account、恢复 Query→workflow→runtime 投影、在 L `onClose` 追加 reconcile/刷新或重复成功事件；对应测试或 guard 必须失败。 |
| 明确不覆盖范围 | 不证明 Cloudflare 能稳定自然出现，不清 Cookie、不退出或换号，不执行真实回复、编辑、删除、点赞或通知投递；Headless notification 继续在独立 JS 生命周期现场鉴权。 |

## `REG-TOPIC-077` 回复数或稀疏窗口不一致时整窗被丢弃

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03/04`；共享 `NAV-02/03`、`WRITE-01/02`、`NOTIFY-02` |
| 用户症状 | 原站回复数、页宽或返回行稍有不一致时，已经解析出的有效评论整块消失，详情显示空白/窗口错误；刷新又可能恢复。另一种路径把 partial Topic seed 当成 complete，错误开放权威计数、倒序或末尾确认。 |
| 触发条件 | adapter 把“窗口是否完整”和“单行是否有效”混为一个 boolean；Controller 用调用方旧 `replyCount`、名义页宽或 `initialData` 决定整窗成败。删除楼层、并发回复、重复展示行与稀疏 hydration 会放大。 |
| 根因 seam | `ReplyCompleteness`、各来源 reply-window validator、共享 page 投影、Topic target replacement 与写后精确 refresh target 共同定义完整性和身份；exact target/写后实体读取和普通浏览窗口需要不同严格度。 |
| 必须保持的行为 | `complete | partial` 只描述当前窗口完整性；共享层按 page 顺序连接并展示 adapter 已返回的 `items`，不得再用正文、作者、时间、旧回复数或跨站 identity 规则过滤、合并或覆盖。adapter 已确认的 target window 直接成为当前窗口，共享 matcher 只用于已加载集合查找/高亮，不承担 adapter 有效性判断。NodeSeek 保留 embedded comment collection 和 rendered reply row 的既有成员语义、location 投影及 adapter 实际 completeness，普通重复 comment ID 按原 location 投影折叠并标 partial；Discourse hydration 保留非空已请求 ID 子集并按 stream 排序，缺失单条标 partial，重复 ID 保持既有严格失败；妖火保留既有 reply selector 的每一行，空展示字段合法，完整 `deletePath` 是删除身份，`reid` 不生成通用 `Reply.commentId`，floor 继续驱动回复和导航；V2EX 在 adapter 内按 100 条单页边界移除跨页重复，并按当前页 DOM、声明和显式导航返回 complete 或 partial。写后 action key、目标页查找、乐观删除和刷新只使用精确 `comment-id` 或完整 `delete-path`，不得回退 floor。是否继续读取只由来源 cursor 或明确用户动作决定，各站原有错主题、错页、错误 cursor、空窗口及 exact/write 边界保持，不用共享 predicate 改写。 |
| 精确失败 oracle | `src/features/topic/model/replyPagination.test.ts` 固定两个通用字段相同但 adapter 已认可的行都按 page 顺序保留；`src/features/topic/actions/actionHelpers.test.ts` 固定同 floor 不同强 ID/delete path 不误删；`src/sources/yaohuo/parser.test.ts` 固定删除链接保留完整 `deletePath` 但不产生 `commentId`。`tests/integration/source-read-contracts/` 继续固定四站 adapter 协议，并要求 NodeSeek target 保留实际 partial、V2EX 跨页重复由 adapter 排除且缺楼/计数变化只降低当前页 completeness；各 provider reader tests 固定 adapter-specific completeness。`tests/ui/topic/topic-session-controller.test.tsx` 固定 adapter 已确认 target window 不被共享层二次否决、adapter 拒绝无效 target 时保留旧窗、V2EX 首屏零自动读取、partial 后续页保留全部有效行，以及失败后不自动重试；`topic-reply-filters` 固定受影响提示且评论仍可查看。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS`：来源 fixture 固定协议有效性，RNTL 固定 partial seed 不会因 Query cache 时序卡死；只测试回复数量文案或 parser 单行不足以证明窗口仍可继续。 |
| Replay 或真实验收路径 | 在匹配 APK 上只读打开自然有评论的四站主题，观察首屏评论、相邻窗口与刷新；V2EX 超过 100 条时先静置确认仍停在第一页，再触底读取相邻页。遇到自然稀疏/计数变化时有效行必须保留并显示受影响状态，结算后静置不得继续请求。不得通过发帖、删帖、清缓存或人为改响应制造竞态。 |
| 负向验证方式 | 恢复 `items.length === expectedCount` 的整窗硬失败、让 V2EX 或其他普通窗口自动请求/轮询、在共享层按正文或跨站 ID/floor 合并/过滤、二次否决 adapter target、让妖火 `reid` 进入通用 `commentId`，或让写后删除回退 floor；对应 adapter/controller/helper 测试必须失败。 |
| 明确不覆盖范围 | 不伪造权威总回复数、不自动补抓任意中间页、不把一站的 comment ID/floor/reid 语义外推给另一站，也不改变写操作与原站确认要求。 |

## `REG-TOPIC-078` Topic 媒体首跳忽略页面 Referrer Policy

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`ACCOUNT-01/02`、`MORE-02` 媒体 seam |
| 用户症状 | 妖火指定主题的外部图片与视频在原站可用，App 却因额外发送论坛来源而收到 403；V2EX、NodeSeek、linux.do的正文、预览或保存又可能使用与原页面不同的 Referer。随机素材偶尔返回 200 不能证明 Header 契约正确。 |
| 触发条件 | 共享媒体层把 `contentSource` 的 canonical origin 无条件写成 Referer，忽略元素 `referrerpolicy`、响应/文档策略、真实 Topic URL、同源关系和 HTTPS→HTTP 降级；同 URL 的不同契约还会被缓存或预览目录合并。 |
| 根因 seam | 四站 Topic adapter 产出的 `MediaReferrerContext` → Sanitizer 的元素策略保留 → `imageRequestSource` 的标准 policy resolver → 正文、原图升级、全屏预览、保存、贴纸、卡片和视频消费者；`contentSource` 只保留身份、Cookie 和重定向隔离职责。 |
| 必须保持的行为 | HTTP `Referrer-Policy` Header 解析逗号列表并采用最后一个有效 token；元素 `referrerpolicy` 只接受 ASCII case-insensitive、无首尾空格的单个标准 token，逗号列表或包裹空格均无效并回退文档策略。策略优先级固定为元素、文档、默认 `strict-origin-when-cross-origin`，支持八种标准值、同源/跨源与 HTTPS 降级，并从文档 URL 移除凭据和 fragment；禁止按站点或图床分支。妖火外部媒体和 V2EX `no-referrer` 图片首跳不发送 Referer，NodeSeek/linux.do 跨域媒体首跳发送来源 origin。正文、原图、预览、保存、普通/动态贴纸、卡片图和 native video 使用同一首跳契约；最终 Referer 或 `none` 进入图片、贴纸、预览、尺寸、inline 分类和视频 coordinator identity。内部来源/identity 头、原生 CookieJar 和重定向单调降权保持。 |
| 精确失败 oracle | `src/domain/forum/mediaReferrer.test.ts` 固定 Header/attribute parser 差异；`src/platform/media/imageRequestSource.test.ts` 固定四站真实形状和八种 policy；`src/domain/forum/contentSanitizer.test.ts`、`src/domain/forum/forumContentMedia.test.ts` 固定属性在普通及转换标签中保留；四站 reader tests 固定最终文档 URL/妖火响应 policy；`src/platform/media/imagePreviewCatalog.test.ts`、`src/platform/media/imageSave.test.ts`、`tests/ui/topic/image-preview-controller.test.tsx` 与 `tests/ui/topic/topic-image-loading.test.tsx` 固定正文、预览、保存、卡片、贴纸、尺寸、inline 分类和视频 Header 及 identity 隔离。修复前分别观察到妖火/V2EX 多发 Referer、目录误合并和保存回退来源 origin。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：确定性 resolver/转换用 Vitest，真实 renderer/预览链用 RNTL，匹配 APK 用原站对照与实际首跳 Header；仅断言素材返回 200 不合格。 |
| Replay 或真实验收路径 | 保留登录态覆盖安装后，从“更多 → 账号中心”进入原站对照；核对妖火 `bbs-1571096.html` 图片和 `bbs-1571173.html?lpage=11` 视频无 Referer/403，V2EX `t/1233346` 的 Imgur 无 Referer，NodeSeek `post-857589-1` 为 `https://www.nodeseek.com/`，linux.do `t/topic/847468` 为 `https://linux.do/`；正文和预览一致。不得清数据、Cookie 或登录态，不保存图片或执行互动写入。 |
| 负向验证方式 | 恢复 `contentSource → canonical origin`、全局删除 Referer、加入站点/CDN 例外、丢弃元素策略、只测随机 200，或让同 URL 不同最终 Referer 共用缓存/预览/video identity；任一编号测试必须失败。 |
| 明确不覆盖范围 | 非 Topic 旧调用暂保留既有画像且不据此宣称 Referer 正确；跨 origin 重定向后的 Referer 重算不在本次范围，也不改变原生插件、外部 API 或数据格式。 |

## `REG-TOPIC-079` Expo Video 重建或卸载释放竞态导致原生崩溃

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-03` native media 生命周期 |
| 用户症状 | 正文视频请求失败或超时后，App 立即自动创建第二个 Expo player；正在播放时离开 Topic，组件卸载清理又访问已由 Expo 释放的 player。两条路径均可触发 Android Fatal 或进程退出。 |
| 触发条件 | native video 按 `attemptId` 重挂整个 `ForumContentVideo`，或 `useVideoPlayer` 的内部卸载 Effect 先 `release()`，组件随后再写 `timeUpdateEventInterval=0`。 |
| 根因 seam | `TopicBodyMediaCoordinator` 的 per-lease retry policy → `ManagedTopicContentVideo` admission/identity → `ForumContentVideo` runtime lease、初始化与 Expo 独占的 shared-object 释放生命周期。 |
| 必须保持的行为 | 仅 native 正文视频关闭 coordinator 自动重试；错误或 30 秒无进展超时后释放 permit、稳定显示“视频加载失败，点按重试”，不得创建第二个 player。用户显式重试在本 Topic session 内最多一次，只创建一个新 attempt/player；移除外层按 attemptId 的重复 key。`timeUpdateEventInterval` 只在 `useVideoPlayer` setup 中初始化，卸载后不得再访问 player，释放由 Expo 独占。图片、原图、WebView 视频和贴纸继续保留既有一次自动重试。 |
| 精确失败 oracle | `tests/ui/topic/topic-media-coordinator.test.tsx` 固定 `automaticRetry=false` 后 attempt 不变、失败态稳定且后续排队媒体获得 permit，显式重试才改变一次；`tests/ui/topic/topic-image-loading.test.tsx` 模拟 Expo `statusChange=error`，要求显式重试前 player 调用数保持 1、点击后精确为 2，并模拟 Expo 先释放 shared object 后卸载组件，要求零次释放后访问。修复前分别观察到自动第二次 attempt/player，以及 `Cannot use shared object that was already released`。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 JS/React 生命周期；匹配 Android APK 必须连续播放妖火目标视频并检查无 Fatal、App PID 不变。 |
| Replay 或真实验收路径 | 保留主 AVD 登录态覆盖安装，打开妖火 `bbs-1571173.html?lpage=11` 连续播放，再直接进入另一个 Topic；两阶段均核对 logcat 无 Fatal 且 PID 不变。不得用卸载、清数据或退出登录制造状态。 |
| 负向验证方式 | 恢复 native video 自动重试、重新给整个组件加 `key={attemptId}`、在 error callback 内直接新建 player、在卸载 cleanup 中访问 player、让失败视频继续占 permit，或全局关闭图片/WebView 自动重试；编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不改变 DRM、格式支持、透明贴纸 WebView 或网络代理策略；不承诺服务端拒绝的视频一定播放，只保证错误路径稳定且由用户控制重试。 |

## `REG-TOPIC-080` 原生正文视频忽略固有比例

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03` 的正文媒体 seam |
| 用户症状 | 妖火 `bbs-1571173.html?lpage=11` 的原视频为 `576×1024`，原站按竖屏显示，App 却固定放进 `16:9` 横屏框。 |
| 触发条件 | 正文视频 frame 把所有素材写死为 `16:9`，播放器已经暴露的 `videoTrack.size` 与 `videoTrackChange` 未参与布局。 |
| 根因 seam | `ForumContentVideo` 对 Expo player 元数据的订阅与 frame `aspectRatio`；coordinator 只负责 admission/retry，不能决定媒体形状。 |
| 必须保持的行为 | 元数据未到或无效时使用 `16:9` 占位；有效尺寸到达后切换为固有宽高比，正文最窄限制 `1:2`，所以 `576×1024` 显示为 `9:16`，更窄素材在 `contain` 容器内留边。比例变化只更新 frame，不重建 player；全屏仍服从原始媒体比例。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 模拟 null、`576×1024`、`360×1000` 与无效 track size，分别断言 `16:9`、`9:16`、`1:2`、`16:9`，且整个变化过程中 `useVideoPlayer` 调用数保持 1。修复前 `576×1024` 仍为 `16:9`。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：Jest/RNTL 固定布局与 player identity；匹配 Android APK 固定真实 track 事件和竖屏视觉结果。 |
| Replay 或真实验收路径 | 保留主 AVD 登录态覆盖安装，从“更多 → 账号中心 → 妖火”对照原站，再打开原生 `bbs-1571173.html?lpage=11`；等待元数据后应为竖屏 frame，可连续播放，切换 Topic 后无 Fatal 且 PID 不变。 |
| 负向验证方式 | 恢复固定 `16:9`、按 URL/站点猜比例、让 `videoTrackChange` 改变 source/key 或创建新 player，或取消 `contain`/正文最窄约束；编号 UI 测试必须失败。 |
| 明确不覆盖范围 | 不增加播放器依赖、原生插件或媒体探测请求，不改变 DRM/codec 支持，也不保证服务端拒绝的媒体可播放。 |

## `REG-TOPIC-081` Topic 虚拟化 row 泄漏文章边界与妖火原站结构

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 opening article、sanitizer 与来源 adapter seam |
| 用户症状 | 妖火附件帖被拆成多段卡片，每段重复横线和顶部留白；连续 `<br>`、隐藏占位节点变成异常空洞，原站附件 class 直接泄漏到 App 后呈现松散或不可操作。 |
| 触发条件 | opening HTML 的虚拟化 row 被当作视觉段落；sanitizer 先删除 style 再识别 `display:none`；正文边界空节点未裁剪；renderer 直接依赖妖火 `.attachment` DOM 形状。 |
| 根因 seam | `contentSanitizer` 的隐藏节点删除 → 妖火 Topic adapter 的语义归一化 → `topicContentSplit/topicOpeningPresentation` → `TopicContentList` article continuation → 共享 HTML styles。 |
| 必须保持的行为 | 相邻 opening 正文、原生图片和视频 rows 属于一个 article scope，只有首个可见块有顶部边界/padding，列表 separator 不得暴露虚拟化接缝；quote、poll、accepted answer 与正文 `<hr>` 保留语义边界。`hidden` 与内联 `display:none` 节点在 style 清理前删除，正文首尾空 wrapper/连续 `<br>` 裁掉，内部单个换行不变。妖火正常附件结构归一为单个 `forum-attachment` 语义块，费用、标题、动作与次数可读。 |
| 精确失败 oracle | `src/domain/forum/contentSanitizer.test.ts` 固定隐藏节点删除；`src/sources/yaohuo/reader.test.ts` 用真实附件形状固定单一语义块、无隐藏/边界 `<br>`；`tests/ui/topic/topic-reply-filters.test.tsx` 固定相邻 opening rows 零 separator 且只有一个顶部边界；`src/features/topic/rendering/htmlStyles.test.ts` 固定共享 `strong`、`hr` 与附件卡片样式。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定 sanitizer/adapter，Jest/RNTL 固定虚拟化文章边界；匹配 APK 固定整体正文视觉结果。 |
| Replay 或真实验收路径 | 保留登录态覆盖安装，从“更多 → 账号中心 → 妖火”对照 `bbs-1540797.html`，再打开原生 Topic；整篇正文不得有重复横线或异常空洞，附件为一个紧凑卡片。只读检查，不点击下载。 |
| 负向验证方式 | 恢复每 row 的 border/padding/separator、清除 style 后再找 hidden、让边界 `<br>` 形成独立 row、在 renderer 中识别原站 class、或把 quote/poll/accepted 的边界一并抹掉；编号测试必须失败。 |
| 明确不覆盖范围 | 不复制妖火复古 CSS、不增加站点皮肤或新组件，不兼容原站任意畸形附件结构，不模拟附件扣费/下载脚本，也不执行真实下载。 |

## `REG-TOPIC-082` 原生正文视频丢失封面并在加载期黑屏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03` 的正文媒体与虚拟化 typed-row seam |
| 用户症状 | 原帖已有真实视频封面，App 在加载和待播放阶段却只显示纯色底或视频首帧；播放按钮笨重，暂停后还可能错误恢复封面。 |
| 触发条件 | sanitizer 已保留 `poster`，但 standalone video compiler、opening projection 或 HTML renderer 在转为 typed video 时丢弃；poster 若直接挂在视频请求上，还会绕过图片 permit、Referrer identity 和失败隔离。 |
| 根因 seam | `contentSanitizer` → `topicContentSplit` → `topicOpeningPresentation/TopicContentList` 与 HTML renderer → `ManagedTopicContentVideo` 的独立图片 lease → `ForumContentVideo` 的首次播放状态。 |
| 必须保持的行为 | 安全 poster 在普通与 parser-fallback standalone video 中完整传递，危险 poster 只移除自身且不删除可播放 source。poster 使用现有图片请求画像、Cookie/Referrer、disk cache 和独立 `poster` permit，最终 Referer 不同不得共享 identity；它按 `cover` 铺满且不进入无障碍树。加载期保留封面和 Spinner，ready 时显示 56dp 半透明播放按钮；首次 `playingChange=true` 后永久移除封面，暂停只在当前视频帧上恢复播放按钮。poster 失败不影响视频，视频失败仍保留显式重试且不自动重建 player。全屏按钮至少 48dp，使用 `fullscreenOptions`，视频继续 `contain`、textureView、无自动播放和既有比例。 |
| 精确失败 oracle | `src/domain/forum/contentSanitizer.test.ts` 固定安全/危险 poster；`src/domain/forum/topicContentSplit.test.ts` 与 `src/features/topic/model/topicOpeningPresentation.test.ts` 固定普通、fallback 和 opening typed seam；`tests/ui/topic/topic-image-loading.test.tsx` 固定 poster 请求隔离、加载/ready/首次播放/暂停/失败状态、按钮尺寸、当前 fullscreen API、比例与 poster 状态变化均不重建 player。修复前 sanitizer 后的 poster 在 compiled row 中消失。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定转换，Jest/RNTL 固定请求与播放器生命周期；匹配 Android APK 固定真实封面、按钮、播放/暂停和全屏。 |
| Replay 或真实验收路径 | 保留主 AVD 登录态覆盖安装，从“更多 → 账号中心 → 妖火”对照原站，再打开 `bbs-1571173.html?lpage=11`；首屏应出现真实竖向封面和新按钮，点击后封面退出并连续播放，暂停保留当前帧，全屏可用，PID 稳定且无 Fatal。 |
| 负向验证方式 | 在任一 typed seam 删除 poster、让 poster 与视频共用 permit/identity、按 ready 而非首次 playing 隐藏封面、暂停时重新挂封面、poster error 触发 player 重建、恢复 `allowsFullscreen` 或固定重型按钮；编号测试必须失败。 |
| 明确不覆盖范围 | 不增加进度条、音量控制、动画库、依赖或原生插件，不改变 WebView 视频/贴纸播放器、视频固有比例、codec/DRM 或服务端媒体可用性。 |

## `REG-TOPIC-083` V2EX 把 100 条单页误作无游标的评论全集

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03/04`；共享 `NAV-02/03` |
| 用户症状 | V2EX `t/1233404` 当次声明 147 条，原站第一页为 `#1..#100`、第二页为 `#101..#147`；App 普通打开正文可见但评论永久停在 `#100`，只有手动“刷新评论”后才能看到 `#147`。即使后页存在单条无效评论，也不应把其余成功解析行一并退回 100 条。 |
| 触发条件 | Topic 首页有 100 条有效回复、可信总数 147 和同主题 `?p=2` 链接；adapter 却把“没有拿到全部 147 条”解释成 partial，并丢弃 `replyNextPage`。Controller 又对 V2EX 增加“只有完整集合才能排序/定位”的特殊规则，导致既有 Infinite Query 无法按边缘继续。 |
| 根因 seam | `src/sources/v2ex/reader.ts` 把页面窗口与整帖全集混成同一结果；`getV2exReplies(start)` 还会遍历所有链接页并合并全集。`src/features/topic/useTopicController.ts` 随后围绕这一错误模型增加 V2EX-only 完整集合判定、刷新和定位分支。正确 seam 是现有通用 Reply window：Topic 提供 page 1 seed，明确 cursor 驱动相邻页，order/target 各自建立窗口。 |
| 必须保持的行为 | V2EX Topic 首读只访问主题 API 和第一页 HTML，返回正文、可信总数 147、`#1..#100`、`replyCompleteness=complete`、`replyHasMore=true`、`replyNextPage=2`；普通打开和静置 60 秒 Reply transport 为 0。用户触底或点击加载后只请求 cursor `p=2`，成功追加 `#101..#147`。第二页单条无效时追加其余 46 条并标 partial，合计显示 146；第二页整页失败保留前 100 条、正文和同游标 end retry。倒序 start 返回显式末页窗口，未加载楼层只发一个 target Query，已加载目标零请求；显式评论刷新重建 start 窗口，完整刷新复用新 Topic 首页窗口。其他三站、公共类型与 Query key 不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 固定：100 条首屏持续可见且初始 transport 为 0；调用 `loadMoreReplies` 后恰好一次 `position={cursor,page:2}` 并显示 147；返回 46 条 partial 时合计显示 146；请求失败仍显示 100 条、`replyEndError` 和同 cursor retry，fake timer 前进 60 秒调用数仍为 1；route target 只发一个 target Query。修复前首个用例观察到启动 transport，证明“自动补全集”同样违反窗口契约。`tests/integration/source-read-contracts/` 固定 exact `p=2` 单页读取、倒序尾窗、target、malformed、跨页重复、缺楼、计数变化和整页失败 reject。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + APK_SANITY + LIVE_PASS`：来源 Vitest 证明显式页窗口与可信 partial，Controller/RNTL 证明 seed、边缘加载、失败保留和零后台读取，匹配 APK 证明真实 100 条分页阈值体验。 |
| Replay 或真实验收路径 | 构建当前 revision APK，在主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；App 内直达 `https://www.v2ex.com/t/1233404`。首屏显示正文、总数与第一页，静置确认最高可见楼仍为 `#100`；向下滚动后才到当次最高楼。再只读核对倒序、楼层定位、仅刷新评论和返回恢复。真实数量由 targeted Agent Live 记录，不新增依赖动态回复数的 tracked Replay。 |
| 负向验证方式 | Topic 首读请求第二页、Controller 在首屏自动启动 Reply Query、cursor `p=2` 又读取第一页或遍历全集、丢失 page-based cursor 因其 offset 为 null、第二页 partial 退回 100 条、失败清空正文/第一页、恢复 V2EX-only 完整集合门禁，或创建 timer/polling/retry；`REG-TOPIC-083` 测试必须失败。 |
| 明确不覆盖范围 | 不猜未链接页数，不新增公共 API、类型、依赖、配置、缓存键或持久化迁移；不把 100 当可信总评论上限，也不预取未显示的后续评论。 |

## `REG-TOPIC-084` 固定单元格宽度与虚拟分片破坏逻辑表语义

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` 与 `REG-PERF-010` 的正文虚拟化 seam |
| 用户症状 | NodeSeek `post-652056-1` 的两张小表没有清晰间距且第二张不能自然铺满正文；V2EX `t/1233470` 的“时间 / 发生的事”长表跨虚拟 row 后列宽、边框和横向位置可能突变，像多张断开的表。 |
| 触发条件 | 所有 `th/td` 固定为 `118dp`；compiler 将一张 table 拆成多个独立 HTML row，却没有保留逻辑节点身份、continuation 和列模型；renderer 又按每个 row 独立创建水平容器。 |
| 根因 seam | `compileForumContent()` 在 budget packing 前建立完整 typed table、列模型与 rowspan 连通区域 → `topicTableRenderers` 的原生列几何、边框、间距和 route-local 横向 offset；父 FlashList 只负责回收 typed row，不能成为表语义 owner。 |
| 必须保持的行为 | 来源中的全部 `data-wz-*` 先移除，compiler 不生成 binding。可满足预算的 table 形成一个携带 `semanticId/columns/part` 的 typed row；超大 table 只在完整 `tr` 和 rowspan 连通区域之间分段，任一连通区域单独超预算则整表 fail-closed。列数取各行有效 `colspan` 总和最大值，无效按 1 且受 80-node上限约束。表格宽度为正文宽度与“列数 × `96dp × 阅读字号`”较大值：窄表铺满，宽表使用原生水平 ScrollView，文字正常换行，`colspan` 按列单位占宽。独立 table 之间为 `12dp`；同一 `semanticId` 的分段为零间距、单 hairline 接缝且只保留一次表头。同组已挂载分段无动画同步横向 offset，回收重挂恢复；route/detail identity 变化释放。主楼、回复、引用、签名和采纳答案按内容 scope 隔离。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 的 `REG-TOPIC-084` 固定 V2EX 18 行两列表为一个 typed row、统一 columns、唯一 thead、完整行序与硬预算；9 个媒体行按 `[4,4,1]` 完整行组分段，单个超预算 tr fail-closed，并证明伪造属性无效。`src/features/topic/rendering/htmlStyles.test.ts` 固定删除 `118dp`。`tests/ui/topic/topic-table-rendering.test.tsx` 固定 3/2 列铺满、`colspan`、`12dp` 间距、6 列横滑、分段零接缝、offset 同步和重挂恢复。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定编译身份和预算，Jest/RNTL 固定原生布局与同步，匹配 APK 固定真实父列表 recycling 和视觉连续性。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装且 `firstInstallTime` 不变；用 `exp+wz-android://open-topic?url=<encoded URL>` 分别直达 `https://www.nodeseek.com/post-652056-1` 与 `https://www.v2ex.com/t/1233470`。NodeSeek 两张独立表都铺满且间距明确；V2EX 表头只出现一次，18 行顺序完整，滚过内部分片边界时列宽、边框和横向位置连续。再只读核对字号、主题、返回重进和纵向滚动。`t/1233404` 只属于评论分页验收，不得混入本项。 |
| 负向验证方式 | 恢复 `118dp`、先切碎 HTML 再按 fragment 独立估列、给表写 compiler binding、切开 rowspan 连通区域、把超预算表合回巨型 cell、增加预加载或关闭虚拟化；任一编号测试必须失败。 |
| 明确不覆盖范围 | 不增加 WebView、依赖、公共 API、sticky header 或全屏表格，不修改媒体预算、来源 parser 或评论分页。 |

## `REG-TOPIC-085` 图片实体与回收占位几何不一致导致虚拟边界行高振荡

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` 与 `REG-PERF-010` 的正文媒体生命周期 |
| 用户症状 | linux.do `t/topic/2556285` 的长图滚到虚拟窗口边缘后反复闪现；附近文字、空白占位和相邻回复交替出现，即使滚动偏移未变化也无法 settle。 |
| 触发条件 | 第一条竞态是 Expo Image 已在 `onLoad(1000×5000)` 得到自然尺寸，但尺寸只在 passive effect 写入，同批次 lease revoke 会退回 4:3。第二条闭环是 coordinator 把已 displayed 图片在离开 warm window 后降回 waiting，`lease.admitted=false` 时 renderer 直接换成空白 idle View；重新进入又取得新 attempt，且 Expo Image 的 `recyclingKey` 包含 `attemptId`，native target 因此清空旧内容后重载。CDN 窄图的 mounted/idle 几何不一致会进一步反向改变 viewability。 |
| 根因 seam | `TopicBodyMediaCoordinator` 只拥有未完成加载调度；`previewRenderers` 分开维护 displayed 状态、稳定视觉 identity、网络 attempt、有效自然尺寸与 `imageDisplayDimensions` 512 项缓存；FlashList 只在 cell 真正复用给新媒体 identity 时清旧状态。 |
| 必须保持的行为 | 有效、当前且未结算的 `onLoad` 验证正自然尺寸后，先同步写入同一媒体 request/cache identity，再更新组件 state；只有首次未知尺寸允许 `4:3 → 真实比例` 并通知 FlashList 一次。自然尺寸已知后，mounted 与未完成占位都使用 `displayWidth = min(自然宽度, 正文宽度)` 和同一比例高度。Viewability 只取消、重排 waiting/running；成功 displayed 的图片在 cell 实际回收或媒体 identity 改变前保持显示。视觉/recycling key 包含 URL、session/Referrer identity 与 preview/original variant，但不包含 `attemptId`；attempt 只拒绝迟到事件并区分网络重试。尚未显示时撤销 lease 仍可取消；cell 换 URL 时旧 displayed/failed 状态立即清除。无效尺寸、迟到 attempt、旧 session 或不同 Referrer identity 不写缓存；失败重试、未完成 warm `<=8`、running `<=4` 和原图 `<=1` 不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 与 `tests/ui/topic/topic-media-coordinator.test.tsx` 的 `REG-TOPIC-085` 先固定 `onLoad(1000×5000) → 同批次未完成 lease revoke` 后仍为 `320×1600`；再让 displayed 图片连续 20 次移出/移入 viewport，要求始终 admitted、同一 visual/recycling identity、零 `topic-image-idle` 与零新增请求波。另固定未显示撤销仍取消、cell 换 URL 清旧状态、窄竖图 `109×500`、小横图 `160×90` 和超宽横图 `1600×900` 的适屏几何，以及迟到回调、失败重试、原图覆盖、session/Referrer 隔离与 coordinator 预算。旧实现至少会出现 idle、attempt key 变化或新请求，测试必须失败。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：需要真实 renderer/lease 批次证明先后顺序；纯缓存 unit 或源码字符串不能证明竞争窗口。 |
| Replay 或真实验收路径 | 主 AVD 只读直达 `https://linux.do/t/topic/2556285`，停在“对比一下5.5”及各张长图进入/离开边界无触摸观察 60 秒，可见性转换为 0；滚过主楼前三张长图和一张回复长图，scroll settle 可结束且已显示像素、比例和高度不坍缩、不重复闪现或形成请求波。滚离返回、图片预览返回及 App force-stop 重启后重复验收，并核对无 ANR、OOM、Fatal、非预期 PID 重启、媒体预算超限或两轮相同滚动后的 mounted media/PSS 持续增长。 |
| 负向验证方式 | 把尺寸写回 passive effect、让占位无条件使用正文宽度、让 displayed 离窗降回 waiting、把 `attemptId` 放入视觉 key、按组件实例或站点/URL 特判缓存、用扩大预加载/禁用虚拟化/固定长图高度掩盖，或让迟到 attempt 写入；编号测试和 targeted live 必须失败。 |
| 明确不覆盖范围 | 不实现长图裁剪、WebView 图片、持久化尺寸数据库、新 timer/轮询或自动重试；只由 `useLayoutState` 在冷图第一次取得新自然尺寸时通知父列表，已缓存重挂不追加 layout 波。 |

## `REG-TOPIC-086` 物理 Row 切割丢失嵌套逻辑节点身份

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` 与 `REG-PERF-010` 的正文虚拟化 seam |
| 用户症状 | linux.do `t/topic/2556285` 第 9 层原站的一个 52 行 `<pre>` 在 App 内变成两个独立横向滚动框；相同问题可让跨 row 的 table、details、callout 或 list 丢失边框、折叠状态、祖先容器和横向位置。 |
| 触发条件 | compiler 先把 HTML 按原始 DOM node/字符切成物理 row，再靠 `data-wz-node`、sidecar 或 tag-specific continuation 让 renderer 猜原结构。LinuxDo 第 9 层的完整 `<pre>` 虽只有 3,088 字符，却含约 191 个装饰元素，因此 80-node 预算会先把它错误拆成多个互不相识的 renderer 实例；嵌套结构还会丢失父级身份。 |
| 根因 seam | `compileForumContent()` 的顺序必须是 `semantic blocks → budget packing`：table、block pre/code、details/callout、blockquote 与 list 在物理切片前成为 typed payload；每个 row 直接携带 scope-local DOM path 产生的 `semanticId`、segment/part 和完整 `ancestorFrames`。renderer 只消费 typed row，不读取 HTML binding、TNode 或站点/坐标推断。 |
| 必须保持的行为 | 来源中的全部 `data-wz-*` 先清除，输出不生成任何 compiler binding。block pre 的后代先归一成保留空白、换行、顺序和允许样式的 text runs；短代码、52 行装饰代码、超旧字符预算代码和 terminal Tab 内代码都分别形成一个 `codeBlock` row，`part="only"`、`segmentIndex=0`，完整 `runs/text/copyText` 只属于该 owner。details、callout、blockquote、list/listItem 直接写入每个后代 row 的 `ancestorFrames`，只在自然子块或 item 边界分段；disclosure 折叠时在送入 FlashList 前移除全部子 rows，list marker 只在 item 首段显示。table 只在完整 `tr`/rowspan 连通区域之间分段；code 始终一个 frame，table segments 共享一个 frame 和横向位置。普通 rich text、poll、quote、video 与 terminal 能力保持。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 的 `REG-TOPIC-086/088/093` 固定 52 行装饰 pre 与 240 行代码都各为一个完整 `codeBlock`，嵌套 `details > callout > pre/table` 的每个 typed row 同时带 details 与 callout `ancestorFrames`，输出零 `data-wz-*`。`tests/ui/topic/topic-table-rendering.test.tsx` 固定代码只有一个 frame、一个复制入口且首尾文本完整，table segments 同步/重挂横向位置；`tests/ui/topic/topic-split-disclosure.test.tsx` 固定折叠直接过滤子 rows。结构内容及四站共享正文测试继续通过。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：compiler 证明统一身份和预算，真实 renderer 证明视觉连续性，匹配 APK 证明父 FlashList recycling 下仍成立。 |
| Replay 或真实验收路径 | 主 AVD 只读直达 `https://linux.do/t/topic/2556285`，通过“更多”进入原站对照第 9 层；App 内确认 52 行完整有序、视觉上只有一个代码框，跨物理 row 时边框与横向位置不跳。返回重进和 App force-stop 重启后重复核对。 |
| 负向验证方式 | 恢复 `data-wz-node/logicalSlices/TNode` 或 tag-specific continuation、先切碎 HTML 再猜结构、只给子节点或祖先节点身份、按 row key/内容 hash/全局计数生成 identity、放宽预算、合并巨型 cell、关闭虚拟化或按 linux.do/#9 特判；编号测试必须失败。 |
| 明确不覆盖范围 | 不新增 WebView、依赖、公共 API、持久化、sticky code header 或跨分片 `rowspan`；terminal report 的 typed 提升与最小 fail-close 由 `REG-TOPIC-090` 单独固定。 |

## `REG-TOPIC-087` 虚拟回复把 ReplyTarget 移到正文之后

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03` 与 `REG-TOPIC-086` 的 reply row 编排 |
| 用户症状 | linux.do `t/topic/2556285` 第 9 层的“回复 @… · #5”在 App 中出现在长代码正文下方，而原站和未切割回复都把回复关系放在正文之前。 |
| 触发条件 | 虚拟 reply 只在首 row 渲染 header，却把 reply target 放进只在末 row 出现的 `replyEnd`；正文一旦拆成多 row，关系标签必然被移动到全文末尾。 |
| 根因 seam | `ReplyItem` 的统一 Header/ReplyTarget/Body/Tail 组合顺序，以及 `replyListModel` 对 start/body/end 物理 rows 的职责划分；物理 row 不能重新定义回复文档顺序。 |
| 必须保持的行为 | 单 row 与多 row 回复都按 Header → ReplyTarget → Body → Tail。reply target 只在 `replyStart` 渲染并位于任何 quote/body 之前；`replyEnd` 只保留签名、统计和操作区。楼层定位、引用展开、签名、采纳答案、查询高亮和操作权限不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 的 `REG-TOPIC-087` 同时固定单 row 和虚拟多 row：start 中 target 的渲染顺序早于 body，end 中零 target；第 9 层式 52 行代码不缺失、不重复且全部位于 target 之后。修复前 target 只存在于 end，用例必须失败。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：必须挂载真实 ReplyItem 分片角色；纯模型或字符串搜索不能证明用户可见顺序。 |
| Replay 或真实验收路径 | 主 AVD 只读直达 `https://linux.do/t/topic/2556285`，通过“更多”对照原站第 9 层，确认楼层/header、回复目标、52 行代码、尾部操作依次出现；返回重进及 force-stop 重启后顺序不变。 |
| 负向验证方式 | 把 target 放回 `replyEnd`、首尾都重复 target、按楼层/站点特判、合并回复为巨型 cell 或关闭虚拟化；编号测试必须失败。 |
| 明确不覆盖范围 | 不改变 reply target 文案、点击目标、楼层算法、引用解析、回复分页或任何写操作。 |

## `REG-TOPIC-088` 局部连续性测试通过但真实 FlashList 链路仍丢失语义身份

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-084/086/087` |
| 用户症状 | compiler sidecar 与独立 renderer 测试均通过后，真实 APK 中 linux.do `t/topic/2556285` 第 9 层的 52 行代码仍显示成两个完整圆角框；这证明局部补丁没有贯穿 TopicContentList 和 FlashList recycling。 |
| 触发条件 | HTML 已先按 80-node 预算拆开，后续才尝试把 TNode 绑定回 sidecar；中间模型手工复制部分字段，或 FlashList 对单 Cell reply 始终返回通用 `reply` view type。任一环节丢失语义 payload，最终 renderer 都会重新得到独立物理块。 |
| 根因 seam | 唯一允许的链路是 `compileForumContent → topic/reply model → TopicContentList → FlashList → ReplyItem → TopicContentBlock`。完整 `CompiledForumContentRow` 必须逐层传递；key 使用 owner scope、semantic id 与 segment，view type 包含 payload kind，attempt/viewability 不参与语义身份。 |
| 必须保持的行为 | 第 9 层式 52 行装饰 `<pre>` 在 budget packing 前归一成一个 `codeBlock` owner，文本完整有序；普通空签名是中性预算，不得把单 Row 回复无故拆成 start/body/end。单 Cell code/table/richText reply 分别得到稳定 typed view type。最终真实列表只挂一个代码框，ReplyTarget 位于其前；产品代码中不得恢复 `ForumContentLogicalSlice`、`logicalSlices`、`bindingId`、`data-wz-node` 或 TopicContentPresentation 的 TNode 映射。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 固定 52 行装饰 pre 为一个 code owner；`src/features/topic/model/replyListModel.test.ts` 固定空签名不破坏单 Cell 路径；`src/features/topic/model/topicListModel.test.ts` 固定 `reply:codeBlock` view type；`tests/ui/topic/topic-reply-filters.test.tsx` 贯通真实 compiler/model/TopicContentList/FlashList/ReplyItem/TopicContentBlock，要求一个 `topic-code-frame`、完整首末行和 target 在前。独立 `topic-table-rendering` 测试只作补充，不能单独证明通过。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：必须同时有 compiler/model 和真实父列表贯通证据；源码字符串、局部 sidecar 或独立 renderer 绿灯均不足。 |
| Replay 或真实验收路径 | 与 `LIVE-READ-06` 共用主 AVD 只读直达 `https://linux.do/t/topic/2556285`：通过“更多”对照第 9 层，确认 reply target 在前、52 行完整且视觉只有一个代码框；返回重进、App force-stop 与 AVD 普通 reboot 后重复。 |
| 负向验证方式 | 恢复先切 HTML 后绑 sidecar、模型只复制 html/continuation、单 Cell reply 使用通用 view type、按站点/楼层特判、把代码合成超预算巨型 cell或关闭虚拟化；编号贯通测试必须失败。 |
| 明确不覆盖范围 | 不修改 V2EX 评论分页、cursor、倒序、楼层定位、Reply Query、`REG-TOPIC-083` 或 `LIVE-READ-05`。 |

## `REG-TOPIC-089` 普通代码块在 semantic compiler 前被降级为 terminal rich text

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-086/088` |
| 用户症状 | typed compiler、模型和 renderer 测试均通过后，linux.do `t/topic/2556285` 第 9 层在真实 APK 中仍显示为两个独立圆角代码框。 |
| 触发条件 | 来源 JSON 的单个 `<pre><code class="lang-auto">` 先进入共享 sanitizer；旧规则把所有普通 code 改写成 `forum-terminal-code`，将空格展开为大量 `&nbsp;`。semantic compiler 因此看不到 pre，只能把膨胀后的 div 按字符预算切成多个 richText row。 |
| 根因 seam | sanitizer 与 semantic compiler 的职责边界。普通 block pre/code 必须保持 DOM 语义直到 `compileForumContent()` 分类；只有明确的 ANSI code、NodeSeek magic tabs 与 terminal report 才进入 terminal 专用转换。 |
| 必须保持的行为 | 普通 `<pre><code>` 经 `sanitize → compile` 后仍是 typed `codeBlock`，空白、换行、顺序和允许样式完整；52 行/3,088 字样本得到一个 semantic owner。ANSI 颜色、NodeSeek terminal tab/report、普通 inline code、安全清洗和所有 row 硬预算保持。 |
| 精确失败 oracle | `tests/integration/discourse-content-contracts.test.ts` 固定来源形态的 52 行 plain code 在 sanitizer 后仍含一个 pre、compiler 后只有一个 code row；`tests/ui/topic/topic-reply-filters.test.tsx` 从 sanitizer 贯通模型、FlashList 和最终 renderer，固定一个 `topic-code-frame` 与正文前 ReplyTarget。修复前前者得到零 code row、多个 richText row，后者找不到 `reply:codeBlock`。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：必须同时覆盖 sanitizer 边界、父列表传递和匹配 APK；直接把 `<pre>` 喂给 compiler 的绿灯不足。 |
| Replay 或真实验收路径 | 与 `LIVE-READ-06` 共用主 AVD，只读直达 `https://linux.do/t/topic/2556285`；第 9 层必须只有一个连续代码框，返回重进、force-stop 与普通 guest reboot 后不变。 |
| 负向验证方式 | 恢复普通 code 的全局 terminal 改写、在 LinuxDo/#9 加特判、只缩短实体编码、放宽 row 字符预算、合并巨型 cell 或关闭虚拟化；编号测试必须失败。 |
| 明确不覆盖范围 | 不删除或降级明确 ANSI/NodeSeek terminal report 能力；不修改 V2EX 回复分页或任何来源数据模型。 |

## `REG-TOPIC-090` 超预算 terminal report 被整块删除并丢失 Tab/复制/滚动语义

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-084/086/088/089` |
| 用户症状 | NodeSeek 测评详情原有多个 Tab、ANSI 报告、复制按钮、文本选择、横向滚动条和图片内容；引入正文虚拟化后，小样本可能显示为单个 RNRH terminal，但 report 一旦超过 row 预算就整块变成“内容过于复杂”，Tab 与全部正文同时消失。把普通代码统一降级为 terminal 或恢复巨型 `<pre>` 又会破坏既有 table/code/媒体预算优化。 |
| 触发条件 | sanitizer 正确把 magic tabs/ANSI 转成 `<forum-terminal-report>/<forum-terminal-tab>`，但 compiler 把整个 report 登记为 opaque island；预算只在 report 外层判断，超限时用一个 fallback 替换整棵子树。旧 RNRH renderer 在单 cell 内维护 local active index 并渲染完整 tab body，因此 recycling/filtering 会重置状态，且 plain/terminal code 走不同交互实现。旧测试还把“整块消失”写成成功 oracle。 |
| 根因 seam | `compileForumContent()` 的 terminal 语义分类、`CompiledForumContentRow`/`ancestorFrames`、Topic list 的 route-scoped semantic state，以及共享原生 CodeFrame。report header、tab body 和 code/table/media 等内容必须先成为 typed semantic rows，再应用既有物理 row 预算。 |
| 必须保持的行为 | sanitizer 仍是唯一 ANSI/magic-tabs 归一入口，compiler 仍是唯一正文编译入口。每个 report 产生稳定、必要时按自然标题子项分段但共享 identity 的 `terminalReportHeader`；超长单个标题回退为对应默认标题，异常 child 只自身 fail-close。每个 tab body 递归复用现有 richText、code、table、details、callout、blockquote、list、media、poll、quote 与 video typed rows，并携带 `reportSemanticId/tabId/defaultTabId` ancestor；xterm/pre 与同 Tab 的说明、表格或媒体并存时不得吞掉后者。每个 terminal code 始终是一个完整 owner；不可拆的 malformed/depth/media/table body 只在该 tab 内 fail-close，其他 tab 和 header 保留。accepted-answer preview 至少呈现 header 与默认 Tab 的首个 body，full 保留全部 rows。plain code 与 terminal code 共用原生选择、查询高亮、完整复制、失败提示和按 `scope + semanticId` 持有的横向 offset；terminal 保留 ANSI 前景/背景色。active tab 由 route identity、opening/reply/signature/quote/accepted scope 和 report identity 共同持有，cell 回收、筛选隐藏/恢复及重挂不重置，Topic identity 改变时清空。header 与可见 body 不插入列表 separator。key 与 item type 不使用 active tab、列表 index、内容 hash或媒体 attempt。旧 terminal RNRH renderer、巨型 PRE/WebView、嵌套纵向列表和新增依赖不得恢复。 |
| 精确失败 oracle | `tests/integration/source-read-contracts/` 从真实 NodeSeek magic-tabs fixture 贯通 sanitizer→compiler，要求四个 tab、terminal code、`.terminal-container` 内与 xterm 同级的说明/表格、图片和 report 外链接全部保留且 ANSI 前/背景色进入 runs；`src/domain/forum/contentSanitizer.test.ts` 另固定同容器 `pre + rich text + table` 不互相吞噬。`src/domain/forum/topicContentSplit.test.ts` 固定总 report 超预算仍保留全部 tab、混合 code/table/details/media/poll typed body、240 行 terminal code 是一个完整复制 owner、13,000 字 terminal code 不因旧文本预算丢失，以及 90 个 Tab/超长标题/异常 child 只在最小单元降级。opening/quote/accepted 与 reply/signature/完整引用模型测试固定所有消费者，其中 accepted preview 必含默认 Tab body；`tests/ui/topic/topic-components.test.tsx` 贯通 reply model/filter/真实 ReplyItem/TopicContentBlock；`tests/ui/topic/topic-split-disclosure.test.tsx` 固定回收、隐藏恢复与 Topic 切换；`tests/ui/topic/topic-reply-filters.test.tsx` 固定 header/body 零 separator；`tests/ui/topic/topic-table-rendering.test.tsx` 固定 Tab 无障碍、ANSI 前/背景色、选择、高亮、复制成功/失败与共享横向位置。恢复 opaque island 或 local tab state 时编号测试必须失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：必须同时证明来源归一、compiler/model 完整性、真实列表状态与匹配 APK 交互；单一 2000 图片、compiler 局部测试或 App 能启动都不足。 |
| Replay 或真实验收路径 | 与 `LIVE-READ-06` 共用匹配主 AVD，保留数据覆盖安装后只读直达 `https://www.nodeseek.com/post-812712-1`；逐个切换四个 Tab，核对末行、ANSI 前/背景色、图片、原站链接、复制全文、文本选择、横向滚动条/位置、返回重进和评论查找隐藏/恢复。另与 NodeSeek 2000 图片、V2EX table 和 linux.do plain-code/长图目标在同一最终 APK 上回归，确认无 ANR/OOM/Fatal、PID 意外重启或持续 PSS/媒体增长。 |
| 负向验证方式 | 恢复 report 级 opaque island、旧 terminal RNRH local state、整块 fallback、所有 code 强制 terminal、巨型 PRE cell、放宽预算、WebView、嵌套纵向列表或按 NodeSeek 帖号特判；编号 source/unit/UI 测试必须失败。 |
| 明确不覆盖范围 | 不增加终端模拟器、命令执行、编辑、持久化 Tab 历史、新依赖或真实写操作；第三方页面动态内容变化只影响 Live 数据轴，不替代固定 fixture。 |

## `REG-TOPIC-091` terminal Tab 切回后长图 row 永久停在 idle

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010`、`REG-TOPIC-085/090` |
| 用户症状 | NodeSeek 测评页长图 Tab 首次可以显示；切到 code Tab 再切回后，原位置只剩保持正确长图高度的灰色空白，占位节点为 `topic-image-idle`，等待或再次切换也不发起图片加载。当前最终 APK 的同一真实页面还证明，在已有旧 Tab viewability 的情况下首次切入长图也可能直接 idle。 |
| 触发条件 | terminal active tab 通过 semantic filtering 替换父 FlashList 的 typed rows。旧 Tab 的 `onViewableItemsChanged` 已把 code row key 写入媒体窗口；切回长图时没有滚动，FlashList 不保证再次发 callback，于是新长图 row 已挂载且 `networkMediaCount=1`，coordinator 却仍只收到已不存在的旧 key。 |
| 根因 seam | `TopicContentList` 从 FlashList viewability 投影到 `TopicBodyMediaCoordinatorProvider.viewportRowKeys` 的边界只保存 row key，没有保存这个有界窗口在当前 data 中的位置；semantic filtering 改变 data 后无法把同一视口重投影到新 Tab rows。图片 renderer、请求 identity、网络和解码尚未获得 permit，不是根因。 |
| 必须保持的行为 | viewability 同时记录有界 nearby indexes 与稳定 row keys。当前 data 仍包含全部旧 key 时继续按 key，避免普通插入/重排改变实体；只有任一旧语义 key 因 Tab/details/callout 过滤消失时，才按已记录 indexes 映射当前 data，并等待后续真实 callback 校正。新 Tab 当前窗口媒体立即取得既有 permit，隐藏 Tab 不预热；`warm <= 8`、`running <= 4`、原图 `<= 1`、stable item key/type、route-scoped active tab 和 2000 图片预算不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 的 `REG-TOPIC-091` 贯通真实 compiler、Topic model、TopicContentList、FlashList viewability、terminal Tab 和真实 coordinator provider：长图 Tab 默认可见并进入 viewport，切到 code Tab并结算其 viewability，再不发 callback 切回长图；长图 typed row 必须再次出现在 provider 的有界 viewport。修复前收到的数组只含 terminal header、旧 code row、reply controls 和 empty replies，精确缺少长图 row。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：compiler 或 media renderer 单测无法证明父列表在 data 替换后重新发 permit；只看正确占位高度也不能证明像素恢复。 |
| Replay 或真实验收路径 | 匹配主 AVD 只读直达 `https://www.nodeseek.com/post-812712-1`。长图 Tab 首次显示后切到任一 code Tab，等待 UI settle 但不滚动，再切回长图；连续两轮均须直接恢复像素且零 `topic-image-idle`、手工重试、额外滚动或 route 重建，并核对 PID、ANR/OOM/Fatal 和媒体预算。 |
| 负向验证方式 | 删除 index 重投影、只保留旧 row keys、依赖用户滚动、切 Tab 时 remount 整个列表、把全部新 Tab rows 加入 viewport、扩大 render/warm/running 预算或自动重试；编号 UI 测试必须失败或既有 2000 图片预算测试必须失败。 |
| 明确不覆盖范围 | 不持久化已解码像素、不预取隐藏 Tab、不改变图片 URL/Referrer/session identity、网络重试、自然尺寸缓存、FlashList 库或 terminal compiler；远端图片不可用仍按数据轴单独结算。 |

## `REG-TOPIC-092` 同一回复关系目标再次点击不再定位

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；共享 `NAV-02/03` 与 `REG-TOPIC-062/067` 的楼层定位 seam |
| 用户症状 | NodeSeek 回复关系第一次点击可以跳到目标楼层；滚走后再次点击同一目标，有时完全不滚动也不重新高亮。切换到另一个目标后再点原目标也可能失效。 |
| 触发条件 | NodeSeek 可见的 `#3` 来自正文 HTML 的 `forum-floor-link`，走 `openHtmlLink → TopicRoute.setParams({targetReply})`；它不是 LinuxDo 结构化回复关系的直接列表定位入口。第二次点击写入相同目标身份，没有新的 route command，列表定位 effect 因而不重跑。 |
| 根因 seam | 稳定目标身份与一次性命令身份必须跨真实入口分开：同主题 HTML 楼层链接由 `TopicRoute` 递增 route-local `targetReplyRequestId`，结构化回复关系由 `TopicContentList` 的稳定 ref 生成本地 request command；列表统一消费二者。 |
| 必须保持的行为 | 每次显式点击都生成新命令并重新执行 `scrollToIndex` 与高亮；同一目标连续点击和切换目标后再点均有效。已加载目标始终零网络；未加载目标的每个新命令继续使用既有有界 target window。没有 request ID 的 route 初始 target 只自动消费一次，普通刷新和列表重算不得重复跳转。 |
| 精确失败 oracle | `tests/ui/app/content-source-route-gates.test.tsx` 的 `[REG-TOPIC-092]` 贯通同主题 `forum-floor-link`，并固定已有 request `7` 后连续点击得到 `8/9`；`tests/ui/topic/topic-session-controller.test.tsx` 固定同一未加载 target 收到新 request 后再次执行有界读取；`tests/ui/topic/topic-reply-filters.test.tsx` 固定两个相同 route target 搭配不同 request ID 产生两次 `scrollToIndex`，等待首轮高亮消失后第二次重新高亮，并固定结构化关系目标 A → A → B → A 每次新增命令。既有 target-window 测试继续固定加载目标零额外 transport 与初始 route target 一次性。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：只测列表内 Pressable 或状态对象不能证明 NodeSeek 的 HTML route 链第二次点击重新驱动 FlashList。 |
| Replay 或真实验收路径 | 匹配主 AVD 只读直达 `https://www.nodeseek.com/post-859086-2#14`；点击回复关系中的 `#3`，滚离目标，再次点击同一个 `#3`，连续重复均须定位并高亮且无新增网络请求。 |
| 负向验证方式 | 只重复写入 target identity、把 target 清空当作命令边沿、只修结构化 ReplyItem、每次点击强制重新请求、刷新时重放 route target 或按站点特判；编号 UI 测试或既有定位请求计数必须失败。 |
| 明确不覆盖范围 | 除新增可选的一次性 `targetReplyRequestId` 外，不改变楼层解析、目标窗口范围、回复顺序、筛选清理规则、跨主题路由或任何写操作。 |

## `REG-TOPIC-093` 物理预算从内部切坏不可分割语义 owner

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-084/086/090` 的正文 compiler seam |
| 用户症状 | 长代码或连续富文本超过旧 node/字符预算后被拆成多个独立 cell，出现多重代码框、多个复制入口、边框断裂和上下文断开；图片密集正文又确实需要物理分段。 |
| 触发条件 | compiler 把 12k 文本、16k 序列化字符或 80 node 的物理预算直接当作任意 DOM subtree 的切割线，没有先判断内容是否存在安全的自然子项边界。 |
| 根因 seam | `compileForumContent()` 的 semantic owner 分类必须先于 budget packing：预算只能决定可离散内容的调度粒度，不能创造新的代码或连续文本 owner。 |
| 必须保持的行为 | `pre`、独立块级 `code` 与 terminal Tab 内代码总是一个 `codeBlock` row，`part="only"`、`segmentIndex=0` 且保留完整 `runs/text/copyText`；inline `code` 仍属于所在富文本 owner。无离散媒体的连续段落、标题、链接及 inline 样式树也不从内部切开。details、callout、blockquote、list 只在自然子块或 list item 边界分段；table 只在完整 `tr`/rowspan 连通区域之间分段并共享列模型/frame/offset。图片、视频等离散媒体继续独立分段且每 row 最多 4 个网络媒体，2000 图片调度预算不降级。malformed HTML、深度越界或单个不可拆媒体/table row 超过安全边界时继续在最小单元 fail-close。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 的 `[REG-TOPIC-093]` 固定 240 行 `pre`/terminal code 与独立块级 `code` 都只有一个 typed row 且复制首尾完整，inline `code` 不脱离富文本，超过旧字符/node 预算的无媒体段落仍为一个 owner，长段落 + 图片 + 长标题只在媒体边界形成三 row；既有 2000 图片、table row group、list/details continuation、malformed 与深度测试继续通过。`tests/ui/topic/topic-table-rendering.test.tsx` 固定一个代码 frame 与一个复制入口。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：compiler 必须证明边界，真实 renderer 必须证明 owner 数量与完整复制，匹配 APK 证明 FlashList recycling 下仍连续。 |
| Replay 或真实验收路径 | 匹配主 AVD 只读直达 NodeSeek `https://www.nodeseek.com/post-812712-1`，确认 terminal code 是一个连续 frame、只有一个完整复制入口；同 APK 回归 linux.do `t/topic/2556285` 第 9 楼与 NodeSeek `post-863650-1` 的媒体预算。 |
| 负向验证方式 | 恢复按行/字符/node 切代码或连续文本、把整个 Topic 合并成巨型 cell、降低 2000 图片能力、增加预览截断/WebView/第二套 compiler 或按站点特判；编号 compiler/UI 测试必须失败。 |
| 明确不覆盖范围 | 不提供代码预览页、折叠截断、语法编辑、WebView 正文或新的虚拟化框架；单一语义 owner 的极端内存上限以后续真实设备证据另立问题。 |

## `REG-TOPIC-094` 嵌套 code/table 横滑被外层纵向列表抢走

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` 与 `REG-TOPIC-084/090/093` 的横向交互 seam |
| 用户症状 | linux.do 代码或表格区域慢速左右拖动几乎不动，必须多次尝试才偶尔识别；若直接让内层 ScrollView 抢手势，纵向阅读又会卡住。 |
| 触发条件 | `nestedScrollEnabled` 只允许嵌套滚动，不定义横纵意图判定；内层原生 horizontal ScrollView 与外层 FlashList 同时竞争 pointer，慢拖和斜向拖没有稳定 owner。 |
| 根因 seam | code/table 必须复用一个 RNGH Pan 方向仲裁器；被动 `Animated.ScrollView` 只负责裁剪、内容宽度和命令式 offset，不再拥有原生拖动手势。 |
| 必须保持的行为 | Pan 使用 `manualActivation(true)`、`4dp` 方向锁和单指；达到方向锁后仅 `|dx| > |dy|` 接管，纵向占优或相等、多指及无 overflow 立即失败并交还 FlashList。更新值按 `[0, contentWidth - viewportWidth]` clamp，松手以同范围 `withDecay`；route scope + `semanticId` 共享 offset，table segments 与重挂实例同步。code/table 保留文本选择、完整复制、查询高亮、terminal Tab 状态，并暴露无障碍增减滚动动作。 |
| 精确失败 oracle | `tests/ui/topic/topic-table-rendering.test.tsx` 的 `[REG-TOPIC-094/097]` 固定两种 renderer 使用相同 manual owner、被动 ScrollView、单指、clamp/decay 和无障碍动作；同表两个 segment 在一次 Pan 后都收到相同 offset，重挂后恢复。纵向、相等、多指和无 overflow 失败路径不得改变横向位置。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：源码配置或 unit shared value 不能证明真实嵌套手势的方向竞争。 |
| Replay 或真实验收路径 | 匹配主 AVD 只读直达 `https://linux.do/t/topic/2556285` 第 9 楼；慢速纯横拖必须稳定移动，从代码区域纵拖应滚动主题且横向位置不漂，快速 fling 继续可用。 |
| 负向验证方式 | 只设置 `nestedScrollEnabled`、同时开启内层原生拖动、无方向阈值、纵向拖动也更新 x、offset 不 clamp、按 segment 各存一份位置或升级框架；编号 RNTL 或设备路径必须失败。 |
| 明确不覆盖范围 | 不升级 Expo/RN/RNGH/Reanimated，不增加依赖、双指手势、缩放、sticky header 或站点专用实现。 |

## `REG-TOPIC-097` 代码慢横拖被 Android 原生文本选择抢占

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-A11Y-001` 与 `REG-TOPIC-084/090/093/094` 的 code/table 横向 owner seam |
| 用户症状 | NodeSeek terminal Tab 内左右拖动长代码时，慢拖很容易先出现文本放大镜、选择 handles 与 `Copy / Share / Select all / Translate` 菜单；代码没有横向移动，随后 Back 也只关闭选择菜单而不返回页面。快速横拖通常正常。 |
| 触发条件 | 共享 Pan 只有位移越过 `activeOffsetX([-10, 10])` 才激活；主 AVD 为 420dpi、Android 长按超时 400ms，`240px / 5s` 慢拖约 547ms 才越过 10dp，因此 selectable Text 的原生长按在 Pan 前取得所有权。React state 或更晚的 scroll 开关无法撤回该原生选择。 |
| 根因 seam | `TopicHorizontalScroll` 必须在 UI thread 内成为 code/table 唯一方向仲裁者；文本选择只能在手势仍未决且近似静止时保持资格，外层 FlashList 只在纵向意图时接管。Tab、Text、ScrollView 与 React state 不得各自建立第二套所有权。 |
| 成熟项目证据 | [RNGH #3866](https://github.com/software-mansion/react-native-gesture-handler/issues/3866) 在 RN 0.81.4/RNGH 2.28.0 记录同类 Android selectable Text 问题但没有已验证修复；[RNGH testing guide](https://github.com/software-mansion/react-native-gesture-handler/blob/main/packages/docs-gesture-handler/docs/guides/testing.mdx) 明确 Jest 不运行平台 recognizer；[Mattermost manual gesture](https://github.com/mattermost/mattermost-mobile/blob/main/app/hooks/use_input_accessory_view_gesture/index.ts) 与 [Expensify MultiGestureCanvas](https://github.com/Expensify/App/blob/main/src/components/MultiGestureCanvas/usePanGesture.ts) 都在 `onTouchesMove` 内用 StateManager 决定所有权。Mattermost 的独立代码页只作为无法兼容内联选择时的升级方向，本轮不照搬。 |
| 必须保持的行为 | 单指 touch down 记录 UI-thread 起点；最大位移 `<4dp` 保持未决，静止长按仍可选择。达到 `4dp` 后仅 `|dx| > |dy|` 激活一次；`|dy| >= |dx|`、多指、途中加指、仲裁前缺少 touch 或无横向 overflow 均失败让行。横向接管后不因后续轨迹重新判定；途中加指仍先由 pointer-count guard 取消。被动 ScrollView、clamp/decay、table segment offset、完整复制、查询高亮、ANSI、四个 Tab、无障碍动作与外层纵向滚动不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-table-rendering.test.tsx` 的 `[REG-TOPIC-097]` 从真实 table/code renderer 驱动 StateManager，固定 `<4dp` 未决、横向占优单次激活、后续轨迹不重新判定、纵向/相等/多指/途中加指/无 overflow 失败，并证明 240 行代码仍 selectable 且完整。最终 APK 的设备负向控制是慢拖后第一次 Back 仍停在 Topic；修复后必须直接返回首页。 |
| 最低可靠证据层 | `UI_PASS + LIVE_PASS`：RNTL 只能证明 worklet 决策，不能证明 Android TextView、RNGH 与 FlashList 的真实竞争；当前 agent-device 的 `gesture pan` 只接受坐标，不能违反 tracked Replay 的稳定 selector 规则来制造 `DEVICE_REPLAY_PASS`。只看源码配置、代码有移动或 App 能启动均不足。 |
| Replay 或真实验收路径 | 匹配最终 revision 的 Release APK 保留数据覆盖安装后，监督式 Agent Live 直达 `https://www.nodeseek.com/post-812712-1`，对可见 terminal code 执行 `240px / 5s` 慢横拖并用录屏/UI hierarchy 排除放大镜、handles 与 ActionMode；静止长按必须仍显示原生选择，Back 只关闭选择。随后回归快速/反向/斜向/纵向/途中加指、四 Tab、复制与返回，并在 linux.do `t/topic/2556285` 第 9 楼和 V2EX `t/1233470` 回归普通 code/table。该坐标手势只属于监督式 Live，不进入 tracked Replay。 |
| 负向验证方式 | 恢复 `activeOffsetX/failOffsetY` 的隐式阈值、仅把 10dp 改小、用 React state 异步关闭选择、删除 `selectable`、开启内层原生 ScrollView、按 NodeSeek/Tab 特判或只运行 Jest；编号测试或真实设备正/负控制必须失败。 |
| 明确不覆盖范围 | 不增加独立代码预览页、选择模式、语法编辑、缩放、依赖或原生模块。任意慢且在长按超时前始终未越过 4dp 的移动与静止长按物理上不可区分；若 UI-thread 激活后真实 TextView 仍取得选择，停止调阈值并另行决定是否采用独立代码页。 |

## `REG-TOPIC-098` 横滑已接管但 Android selectable Text 未收到取消事件

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-A11Y-001` 与 `REG-TOPIC-084/090/093/094/097` 的 code/table 横向 owner seam |
| 用户症状 | `REG-TOPIC-097` 后在 NodeSeek terminal code 空白处慢横拖，代码已经横向移动，仍会出现放大镜、选择 handles 或 ActionMode；说明 JS Pan 获胜并未终止 Android selectable Text 的原生长按链路。 |
| 触发条件 | RNGH 2.28 的外层 manual Pan 激活时只改变手势 handler 状态；未纳入 RNGH 关系的后代 `ReactTextView` 仍持有同一 Android touch stream，因此随后进入原生选择。用户提供的 386 帧录屏中，内容先于选择状态移动，约 1.73 秒后出现 handles/菜单。 |
| 根因 seam | `TopicHorizontalScroll` 必须同时拥有横纵方向仲裁与后代原生触摸取消边界。内容树挂在直接、不可折叠的 `Gesture.Native()` owner 下，横向 Pan 通过 `blocksExternalGesture()` 声明优先关系；Pan 激活取消 Native handler，由 RNGH 2.28 的 `NativeViewGestureHandler` 向 wrapper 子树派发 Android `ACTION_CANCEL`。 |
| 成熟项目证据 | [RNGH #3866](https://github.com/software-mansion/react-native-gesture-handler/issues/3866) 记录相同 RN 0.81/RNGH 2.28 selectable Text 横滑问题；上游 [RNGH #4273](https://github.com/software-mansion/react-native-gesture-handler/pull/4273) 的根修复同样在 RNGH root 开始截获时向原触摸路径派发 `ACTION_CANCEL`。本项目保持稳定依赖，复用 RNGH 2.28 已有的 `Gesture.Native()` 与 external-gesture relation，不引入平台升级或新依赖。 |
| 必须保持的行为 | 横向意图超过既有 `4dp` 且占优时只由共享 Pan 接管，Native owner 必须取消 selectable Text；阈值内未决或静止长按继续到达 Text，保留原生选择。纵向/相等、多指和无 overflow 继续失败让行；被动 ScrollView、clamp/decay、table segment offset、完整复制、查询高亮、ANSI、四个 Tab、无障碍动作与外层纵向滚动不变。不得同时叠加原生源码补丁。 |
| 精确失败 oracle | `tests/ui/topic/topic-table-rendering.test.tsx` 的 `[REG-TOPIC-098]` 从真实 code renderer 固定共享 Pan block 同一内容树的 Native gesture，并继续证明 240 行 Text selectable、完整复制和既有方向仲裁。匹配 APK 直达 NodeSeek `post-812712-1` 后，UI hierarchy 在手势前必须无 focused App TextView；对代码空白处执行 `240px / 5s` 横拖，内容必须移动且结束后仍无 focused TextView、放大镜、handles 或 ActionMode。修复前该 oracle 两次稳定得到 `focused-after=1`。 |
| 最低可靠证据层 | `UI_PASS + LIVE_PASS`：RNTL 只固定 Native/Pan 关系与未降级能力；只有匹配 APK 的真实 Android touch stream、录屏和 UI hierarchy 能证明 `ACTION_CANCEL` 到达 selectable Text。坐标 pan 不进入 tracked Replay。 |
| Replay 或真实验收路径 | 保留数据覆盖安装匹配 APK 后，监督式 Agent Live 直达 `https://www.nodeseek.com/post-812712-1`，执行 `gesture pan 675 1305 -240 0 5000` 并逐帧/UI hierarchy 排除原生选择，同时确认横向内容位移；静止长按必须仍可选择，第一次 Back 只关闭选择，第二次返回。再回归 linux.do plain code、V2EX table、外层纵向滚动、快速/反向/斜向拖和四个 terminal Tab。 |
| 负向验证方式 | 删除 Native owner、移除 `blocksExternalGesture`、改为 simultaneous、允许 wrapper 被折叠、仅继续缩短阈值、删除 selectable、恢复内层原生 ScrollView、叠加站点特判或只运行 Jest；编号测试或真实设备 focus/录屏 oracle 必须失败。 |
| 明确不覆盖范围 | 不升级 Expo/RN/RNGH，不新增依赖、原生模块、独立代码页、选择模式或语法编辑。若 Native bridge 在匹配 APK 上仍失败，撤销该桥接后才可单独回补上游 #4273；两种方案不得叠加。 |

## `REG-TOPIC-100` 未切割正文仍无法把选择范围拖入表格

| 字段 | 内容 |
| --- | --- |
| 当前状态 | `CONFIRMED / NOT_FIXED`；用户已明确“未发生正文切割时，选择应能从文本继续拖入表格”，实现路线仍需确认。 |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-084/093/094` 的正文 compiler、table 和选择 owner seam |
| 用户症状 | NodeSeek `post-877083-1` 长按表格前正文后，“全选”只选中当前段落；选择手柄不能越过“配置”标题继续进入表格和表后文字。 |
| 触发条件 | 目标正文没有触发物理预算切割，三个 compiler row 都是 `part="only"`；但 `richText → table → richText` 被分别渲染，首段、标题、两个表格单元和表后说明形成至少五个顶层 selectable Android Text owner。 |
| 根因 seam | compiler 的语义/调度 row 与 Android 原生选择 owner 被错误等同。React Native `selectable` 只作用于各自 `TextView`；table 又是独立 View 树，因此给每块都加 `selectable` 不能形成文档级连续选择。 |
| 必须保持的行为 | 没有真实预算切割的同一正文文档只有一个用户可见选择 owner；选择可从表格前文本跨标题、表格单元继续到表后文字，复制顺序与文档顺序一致。表格布局、链接、字号/主题、横向查看、外层纵向滚动和动态内容安全边界不得以“可复制”为由静默降级。 |
| 精确失败 oracle | `tests/ui/topic/topic-rich-text-selection.test.tsx` 的 `[REG-TOPIC-100]` 固定 `richText/table/richText` 全部 `part="only"`，并要求顶层 selectable owner 数为 1；当前真实 RNRH 树得到 5。用例暂为 `it.failing`，只证明已确认失败，不计 `UI_PASS`；修复时必须改为普通用例。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 compiler 到真实 renderer 的选择 owner 数；只有匹配 APK 的 Android ActionMode/handles 能证明可跨表格拖选和复制。 |
| Replay 或真实验收路径 | 匹配主 AVD 只读直达 `https://www.nodeseek.com/post-877083-1`；长按首段并拖动或“全选”，高亮必须覆盖“配置”、表格内容及表后文字，复制文本顺序正确。不得清 Cookie/App 数据或执行论坛写操作。 |
| 负向验证方式 | 只把 `p/h*` 改成嵌套 Text、只增加“复制全文”按钮、把 table 每个 cell 继续留作独立选择 owner、把表格静默拍平成普通文本，或未经性能/媒体/链接/安全回归就把所有 Topic/回复改成 WebView；编号用例或既有 table/media 回归必须失败。 |
| 明确不覆盖范围 | 本条先固定产品目标与反证；在用户确认“默认正文直接使用单一文档表面”或“保留 native 阅读、进入按需选择表面”前，不用局部补丁伪装完成。 |

## `REG-TOPIC-095` 三槽图片预览翻页闪回错误图片且 pinch 误改 index

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `REG-TOPIC-045/046/050/075` 与 `REG-PERF-010` 的分页、手势、SVG 和资源边界 |
| 用户症状 | 多图预览横滑到下一张时，目标图片已经到达中心却又瞬间闪成后一张或原图，随后再回到正确页；pinch、横向不对称 pinch 或单指拖动途中加入第二指时还可能意外翻页。 |
| 触发条件 | 旧实现把 previous/current/next 映射成三个 PagerView children。`onPageSelected` 先把 logical index 从 `i` 提交为 `i+1`，React 随即把 children 从 `[i-1,i,i+1]` 重映射成 `[i,i+1,i+2]`，但原生 Pager 此刻仍选中 physical slot 2；`setPageWithoutAnimation(1)` 生效前，中心因此可见 `i+2`。同时 `Gesture.Native()` 允许 ViewPager2 消费多指序列，`onPinchStart → React state → setScrollEnabled(false)` 晚于 UI thread 的手势竞争。 |
| 根因 seam | `src/ui/media/ImagePreviewModal.tsx` 同时拥有可见 slot 身份、分页状态权威、转场结算顺序与 ResumableZoom/分页/下拉关闭的手势所有权；这四者不能再分散到 Native Pager position、React index 和异步 scrollEnabled。 |
| 成熟项目证据 | [Expensify Pager](https://github.com/Expensify/App/blob/main/src/components/Attachments/AttachmentCarousel/Pager/index.tsx) 与 [MultiGestureCanvas](https://github.com/Expensify/App/blob/main/src/components/MultiGestureCanvas/index.tsx) 固定 item identity 并显式声明 native pager/pinch/pan 关系；[Mattermost Gallery Pager](https://github.com/mattermost/mattermost-mobile/blob/main/app/screens/gallery/pager/pager.tsx) 用 Reanimated 自管 active±1；[Bluesky ImagePager](https://github.com/bluesky-social/social-app/blob/main/src/components/Lightbox/pager/ImagePager.tsx) 及 [Android ImageItem](https://github.com/bluesky-social/social-app/blob/main/src/components/Lightbox/pager/ImageItem/ImageItem.android.tsx) 保持 children 身份并显式组合手势。它们共同证明稳定可见身份、单一分页权威和 UI-thread 手势仲裁；本项目因 `REG-TOPIC-075` 必须固定最多三槽，采用 Mattermost 式 ring，而不能把完整 catalog 交给 PagerView。 |
| 必须保持的行为 | 最多三个 physical slot 和每槽 Native media owner 的 key 永久稳定；转场中目标图始终由同一个 target slot/owner 显示。动画结算必须在同一个 UI worklet 内先旋转 `-1/0/+1` role、更新 UI active index 并把 `translateX` 归零，再让 React 提交 logical index；只更新已经移出屏幕的 recycle slot source。分页只有一个 desired index，动画中只保存最新目标，结算后一次推进相邻页；idle 的非相邻外部 index 才无动画重建。一个 manual parent Pan 只在单指、scale=1 时按方向接管：横向分页、向下关闭；两指、途中加指或 scale>1 时在激活前失败并交给 ResumableZoom。既有 `18%/800` 翻页阈值、`25%/1200` 关闭阈值、首末 0.25 阻尼、非循环、动态 SVG sibling、disk-only/decode ceiling、保存、控制层、无障碍和 Back 不变。 |
| 精确失败 oracle | `tests/ui/topic/image-preview.test.tsx` 的六组 `[REG-TOPIC-095]` 行为用例固定：`i→i+1` 与 `i→i-1` 结算前后中心 target owner 不变且只回收离屏 owner；两指、不对称 pinch、单指途中加第二指及 scale>1 拖动均零 `onSelect`；慢滑未过 `18%` 回弹、过线稳定只翻一页；转场中的第二次真实横滑只更新 latest desired index、不得打断当前动画，并在结算后推进下一相邻页；快速/反向无障碍请求遵守同一规则；动画中的非相邻外部 index 等当前结算后无动画重建且不发出 stale `onSelect`。修复前最小反证在 `i=2` 向后翻页的 pre-idle settlement 期要求中心 logical index `3`，实际收到 `4`；快速手势反证的第二次 Pan 则返回 `active=false, failed=true` 并被丢弃。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 worklet/React 两阶段可观察身份、手势 ownership 与 latest-command-wins；只有匹配 APK 的真实 Android 多指竞争和逐帧录屏能排除 Native/Fabric 闪帧。 |
| Replay 或真实验收路径 | 监督式 Agent Live 使用当前可用的只读三图主题执行慢/快横滑、两指 transform、放大平移、pinch 复位、首末边界、下拉关闭、Android Back、方向交替、半途加指、双击复位与尺寸变化；逐帧确认目标图之后没有 `i±2`，不保存图片。没有稳定对象时记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 PagerView 三槽 children 重映射后回中、让 logical index 在动画前驱动 target/current source、按 logical index 重建 outer/native owner、把多指交给 `Gesture.Native()`，或用 React state 异步开关分页；对应 `[REG-TOPIC-095]` owner/index/gesture oracle 必须失败，设备录屏重新出现错图或误翻页。 |
| 明确不覆盖范围 | 不打开或遍历 1000+ 图片帖子；三图 Live 不能代替 `REG-TOPIC-075` 的 2000 项 catalog 自动证据与 25/100 页 Release PSS/Native Heap 验收，后者本次继续记 `NOT_VERIFIED`。本条不新增图库依赖、缩略图栏或循环翻页；当前页 1:1 区域解码由独立 `REG-TOPIC-112` 负责，不改变分页所有权。 |

## `REG-TOPIC-096` 千图帖子首次点击预览需等待约三秒

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-030/075/078/095` 的 compiler、媒体 identity 和预览 catalog seam |
| 用户症状 | NodeSeek `post-863650-1` 已显示正文首图后，首次点击仍需约 3 秒才出现全屏 chrome；关闭后热重开仍约 2 秒。图片 decode 只占约 100–200ms，页面期间无反馈，千图正文时尤为明显。 |
| 触发条件 | `ImagePreviewController` 在点击后重新取得主楼、回复和已加载引用的整份 HTML，逐份调用 `markInlineSizedImages()` 再调用 `createImagePreviewCatalog()`；两者都 parse DOM。Topic rerender 还会因新的 HTML source closure 让 controller 内 catalog cache 失效。正文 compiler 已经解析过相同内容，因此这是第二套内容解释器和错误生命周期，不是 Modal 三槽或磁盘 decode 的问题。 |
| 根因 seam | 图片发现只归 `compileForumContent()` 的单次 DOM 遍历；Lightbox/controller 只能消费 Topic presentation 已产出的结构化 descriptors 和 ready catalog。preview 不拥有业务文档、HTML parser、全文标记器或后台预热任务。 |
| 成熟项目证据 | [Bluesky ImageEmbed/Lightbox](https://github.com/bluesky-social/social-app/blob/main/src/components/Post/Embed/ImageEmbed.tsx) 从结构化 embed 直接提交 images；[Mattermost openGalleryAtIndex](https://github.com/mattermost/mattermost-mobile/blob/main/app/utils/gallery/index.ts) 接收现成 `GalleryItemType[]`，Gallery 不解析来源内容；[Expensify extractAttachments](https://github.com/Expensify/App/blob/main/src/components/Attachments/AttachmentCarousel/extractAttachments.ts) 在不得不面对 HTML 时也使用单次 streaming extraction 并先显示 shell。前两者证明目标边界，Expensify 只作为 parser fallback 思路，不能照搬其完整 children。 |
| 必须保持的行为 | compiler 在 row 分片前按原始顺序产出 normalized source、srcset/lazy aliases、lightbox original、尺寸和 Referrer policy；presentation 按“主楼 → 回复 body/signature → 已加载引用 body/signature”聚合，筛选、排序、折叠和 FlashList 虚拟化不得改变目录。layout commit 注册 ready catalog；只有内容序列、inline identity、宽度/DPR、media session/Referrer 真正变化才投影，等价 rerender、打开、关闭和新空对象不失效。点击只规范化 tapped identity、查 index 和提交 state；三槽 ring、完整逻辑 catalog、SVG、保存、disk-only cache 与 decode ceiling 不变。 |
| 精确失败 oracle | `src/domain/forum/topicContentSplit.test.ts` 的 2000 图用例要求 compiler 输出 2000 descriptors 且 `parseHtml` 总计一次；`tests/integration/topic-content-rendering-contracts.test.ts` 从 compiler output 直接构建 catalog，固定原始顺序、inline 排除、lightbox、srcset/lazy aliases、尺寸、Referrer、去重与 index 1380，并要求带 Referrer 的 2000 图 catalog 构造最多调用 `URL` 2001 次，防止已准备 descriptor 又走通用 attributes 校验链。`tests/ui/topic/image-preview-controller.test.tsx` 不提供 HTML，只注册 2000 descriptors 后同步打开，并固定关闭重开/等价注册复用、宽度与 inline identity 失效；`tests/ui/topic/topic-reply-filters.test.tsx` 固定完整内容顺序且筛选/倒序零新 revision。旧实现分别因不存在 `previewImages/registerImagePreviewDescriptors`、点击依赖 `htmlParts` 或为每图重复构造约 14 个 `URL` 而失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定 compiler/descriptor/catalog 数据契约，RNTL 固定 ready 注册与 React 生命周期；Release 设备才固定 Hermes/Native Modal 的真实点击延迟和首帧。 |
| Replay 或真实验收路径 | 匹配最终 revision 的 Release APK 在主 AVD 保留数据覆盖安装并核对 `firstInstallTime`。直达 `post-863650-1`，只点击首图并执行首次及三次关闭重开；每次页码必须直接显示完整预览目录的 `1/<完整计数>`（2026-08-15 compiler 产出 1413 个 descriptors，按既有 inline 规则排除 32 个后实测 `1/1381`），点击到 chrome/页码 `<=500ms`，disk-cached 当前图 `<=800ms`，不得出现两秒空档、ANR/OOM/FATAL 或 PID 变化。随后用当前可用的三图只读 fixture 回归 `REG-TOPIC-095`；无稳定对象时该项记 `NOT_VERIFIED`。全程不保存或写入。 |
| 负向验证方式 | 恢复 `HtmlPartsSource/htmlPartsFromSource`，在 `openImagePreview()` 内调用 `markInlineSizedImages()`、`createImagePreviewCatalog(htmlParts)`，或在正文滚动期 idle/worker 再 parse 一份 HTML；2000 图 parse-once/无 HTML controller 契约必须失败，Release 首次或热重开重新超过 500ms。 |
| 明确不覆盖范围 | 本轮只打开千图帖并点击首图，不遍历 25/100 页；`REG-TOPIC-075` 的完整 Release PSS/Native Heap 仍记 `NOT_VERIFIED`。不新增 worker、全局 HTML cache、隐藏 Modal、全量预取、完整 Pager children 或图库依赖。若 ready catalog 后点击仍超过 500ms，下一步只调查 `bodyMediaPaused` 提交、Native Modal 创建和 React commit。 |

## `REG-ACCOUNT-043` 后台 More 重渲染关闭全局登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`；共享 `FEED-01/02`、`SEARCH-01/02/04`、`TOPIC-01/03`、`USER-01`、`NOTIFY-02`、`WRITE-01..04` |
| 用户症状 | 在 Topic、Feed、Search 或 User 中自然触发 linux.do Cloudflare 验证后，面板刚出现就消失并回落到“账号冻结中”；用户只能去 More 手动打开验证。NodeImage 等其他全局授权面板也可能被同一路径提前关闭。 |
| 触发条件 | Bottom Tabs 保持 MoreRoute 挂载但 inactive；任一账号 runtime 更新使 `closeAll` 回调引用变化，MoreRoute 的 inactive effect 再执行一次。自动面板通常在 WebView 挂载前数十毫秒被关闭，而 More 内手动打开时页面 active，所以表面正常。 |
| 根因 seam | `src/features/more/MoreRoute.tsx` 把“More 当前 inactive”误当成“More 刚从 focused 变为 blurred”，让后台 route 拥有了全局 auth surface 的关闭权。 |
| 必须保持的行为 | More 初始 inactive、后台重渲染或 `closeAll` 引用变化都不得关闭全局 surface；只有 More 曾经 focused 后真实 blur，才调用最新 `closeAll` 一次，并同时关闭 More 自己的代理和阅读设置面板。关闭按钮、系统返回、切换 surface、App 后台规则及 `REG-ACCOUNT-031` 的异步对账保持不变。 |
| 精确失败 oracle | `tests/ui/app/content-source-route-gates.test.tsx` 的 `REG-ACCOUNT-043` 依次覆盖 inactive 初挂载、inactive 回调换代、focused 回调换代和真实 blur；前三段关闭次数必须为 0，最后只调用最新回调一次。修复前首个 inactive 挂载已经调用一次。 |
| 最低可靠自动测试层 | `UI_PASS`：必须挂载真实 MoreRoute 并驱动 focus/blur cleanup；只测账号 controller 或源码字符串不能证明后台 route 生命周期。 |
| Replay 或真实验收路径 | 匹配 APK 从 More 手动打开任一 auth surface 后离开，确认仍关闭一次；另仅在 Topic/Feed/Search/User 自然出现 Cloudflare 时确认面板保持到 WebView 挂载、canonical 检查并只恢复原请求一次。未自然出现记 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复 `active === false` effect，或让 focus callback 随 `closeAll` 引用换代而重新订阅；编号测试必须观察到初挂载或重渲染时的额外关闭。 |
| 明确不覆盖范围 | 不修改 challenge 识别、WebView、Cookie、账号 snapshot、验证 controller、Query 恢复或错误文案；不清 Cookie、不退出账号、不人为制造 Cloudflare。 |

## `REG-ACCOUNT-044` 账号检测误用首页五秒预算并读取完整妖火活动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01/02`；共享 `MORE-02`、`SEARCH-04`、`ACCOUNT-04`、`WRITE-01/03` |
| 用户症状 | 已登录妖火且代理正常时，“检测登录”仍会在约 5 秒提示超时；偶尔成功时延迟和请求数也明显波动。更多页三站刷新、登录页关闭核对、Search 重试、写前核对和 NodeImage 核对共享同一风险。 |
| 触发条件 | 账号核对经代理超过 Feed 的 active time 5 秒预算；妖火已经从 `wapindex` 证明身份后，又复用完整 User reader 读取资料、回复和最多 10 页主题。 |
| 根因 seam | `src/features/account/useAccountStatusController.ts` 把正常 `reconcileAccountStatus` 包进 `readWithinAggregateSourceBudget`；`src/sources/yaohuo/accountStatus.ts` 又把“证明当前身份”和“读取完整用户活动”合成一次操作。Feed 公平预算、账号协议终态和 User 页面数据具有不同所有权。 |
| 必须保持的行为 | 正常账号核对直接等待各站协议终态，不设账号总预算；每个 HTTP 请求继续使用 active time 15 秒 watchdog。三站并发且各自终态立即提交，公共通知等待全部站点结算；同站 single-flight、generation、唯一 canonical snapshot 与 `isVerifying` 保持。只有首次历史迁移使用一个 active time 5 秒 deadline 约束全部候选 probe，超时后取消并等待 probe 清理，再写 migration marker 和开放 session route；后续手动检测必须创建新 probe。妖火身份证明最多读取 `wapindex` 和必要的精确登录页；已有非数字昵称立即结束。数字 ID 只补读一次资料，仍无昵称时至多读取资料给出的主题第一页；禁止回复和主题分页。补全失败保留已证明身份并标记 partial，身份内容只在协议终态提交一次。Feed/Categories 的每来源 5 秒预算不变。 |
| 精确失败 oracle | `tests/ui/account/account-status-controller.test.tsx` 固定单站和三站刷新超过 5 秒仍 verifying、快站独立提交、最终通知等待全部终态，以及首次迁移 5 秒取消、`statusBusy=false`、marker 后新 probe 不复用 stale Promise。`src/sources/yaohuo/accountStatus.test.ts` 固定：首页昵称 1 请求；数字占位加资料 2 请求；仍为 ID 时只加主题第一页；全路径零回复、零第二页；503/timeout 保留身份并 partial；明确登录 form、未知/验证文档、取消和单请求 15 秒 timeout 分别按协议投影。旧实现分别在 5 秒提前结算，或发出回复/第二页请求。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定 adapter 请求序列与协议结果，RNTL 固定 controller deadline/并发/唯一提交；匹配 APK 的主登录态 AVD 才能证明现有代理与真实妖火会话。 |
| Replay 或真实验收路径 | 主登录态 AVD 只做保留数据覆盖安装并核对 `firstInstallTime` 不变。开启既有代理，在已登录妖火页面连续执行 5 次“检测登录”，不得在 5 秒边界出现账号 aggregate timeout；诊断确认请求仍经代理且没有回复或主题分页。只读回归更多页账号刷新与“全部”首页，确认 Account 等协议终态而 Feed 仍保持每来源 5 秒预算。 |
| 负向验证方式 | 给正常账号核对重新套用 `readWithinAggregateSourceBudget`，让妖火账号检测调用完整 `getUserProfile`，读取 `book_re_my.aspx` 或主题 `page=2`，在补全前先提交数字 ID，或让迁移 timeout Promise 泄漏给后续手动检测；对应编号测试必须失败。 |
| 明确不覆盖范围 | 不提高或新增可配置 timeout，不改变完整 User 页的资料、回复和主题分页，不新增 service、公开 API、状态枚举、持久化字段、第二份账号状态或自动重试；不修改代理实现，也不清 Cookie、退出账号或执行真实写入。 |

## `REG-FEED-017` 来源重排后旧 Pager 会话卡在 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`；共享 `MORE-05` 与 `REG-SOURCE-010` 的来源顺序投影 |
| 用户症状 | 在 More 重排来源后返回首页，顶部仍像是原来源，但内容区一直显示“正在读取主题”；再切一次来源才恢复。 |
| 触发条件 | Feed 位于后台、原生 Pager 已 detach 时修改来源顺序；同一数字位置随后代表另一来源，旧物理页或迟到回调可能与新 routes 不一致。 |
| 根因 seam | PagerView 的页面适配是位置语义，而来源顺序是可变的；在同一 Feed 会话内热更新 children 后，旧数字位置不能稳定表示来源身份。inactive scene 又只允许 controller 当前来源渲染真实列表，因此错位物理页会永久显示 Loading。 |
| 必须保持的行为 | 来源顺序变化定义为新的 Feed 会话。`FeedRoute` 以最新有序 `FeedSource` key 列表作为 session key，使 controller 与 Pager 一起重建；新会话固定从 `全部` 开始，不继承旧来源、Pager 位置或滚动位置。Query key、缓存、存储和网络协议不变；`全部` 可命中已有缓存，也可执行一次正常且可结算的读取。普通来源栏点击和横滑行为不变。 |
| 精确失败 oracle | `tests/ui/app/content-source-navigation.test.tsx` 通过真实 Bottom Tabs 与 `FeedRoute`：Feed 第一次挂载后选中 V2EX，进入 More 改变来源顺序，再点首页必须看到 `全部` 且为第二次 Feed 挂载。移除 session key 时会保留 V2EX 和第一次挂载，测试必须失败。 |
| 最低可靠自动测试层 | `UI_PASS`：必须覆盖真实 FeedRoute 生命周期与 Bottom Tabs 往返；纯 index helper 或单独 FeedScreen 测试不足。 |
| Replay 或真实验收路径 | `LIVE-LOCAL-04` 在匹配 APK 选中非 `全部` 来源，进入 More 重排后点首页，确认立即回到 `全部`，最终显示列表或明确错误而不是永久 Loading；反向重排再验证一次，结束后恢复原顺序。 |
| 负向验证方式 | 移除 `FeedRouteSession` 的有序来源 key，或把 key 改成忽略顺序的集合；编号测试必须观察到旧 Feed 会话和旧来源仍被保留。只给 TabView 加 key 也不足，因为 controller 仍会保留旧来源。 |
| 明确不覆盖范围 | 不保留重排前的来源与滚动位置；不改变来源查询参数、Query key、缓存、分类/排序偏好或 TabView 依赖，也不把正常冷启动 Loading 改成旧列表回显。 |

## `REG-PERF-011` 内容源拖动逐帧跨入 JS 导致不跟手

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-05` |
| 用户症状 | 长按来源排序后上下移动明显滞后，快速跨过多行时活动行跟不上手指。 |
| 触发条件 | Gesture 整体配置 `.runOnJS(true)`，每个 `onUpdate` 都回到 JS，随后再写 React Native `Animated.Value`；JS 调度和 React 工作会直接进入逐帧路径。 |
| 根因 seam | `src/features/more/components/ContentSourcesPanel.tsx` 的活动行位移、边界限制和最近槽计算属于 UI-thread 动画，却被放在 JS gesture callback 中。 |
| 必须保持的行为 | 实测行中心、活动/目标索引和活动行位移保存在 Reanimated shared value；每帧 clamp、translateY 和最近槽计算在 worklet 完成。同一槽内任意帧零 JS bridge，只有开始、目标槽变化和结束/取消用 `scheduleOnRN` 同步现有 React preview/session。兄弟行越过阈值即进入目标槽，不留下跨过持久化提交的 timing animation。成功只持久化最终顺序一次，取消、非法布局或拖动中 preferences 变化零写；350ms、56dp 行、48dp 手柄、触觉、开关和 TalkBack 动作不变。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 的 `REG-PERF-011` 连续注入 20 个同槽 update 后跨槽，要求 Gesture 未启用整段 run-on-JS，bridge 只有 start、真实 slot change、finalize；另固定超界夹到末槽、成功单次写、取消零写、外部设置变化零写，并继续覆盖 Switch 与 TalkBack 排序。修复前 `.runOnJS(true)` 断言失败。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定线程/桥接与持久化契约；匹配 Android APK 用慢速和快速跨槽观察真实跟手性、滚动和边界。 |
| Replay 或真实验收路径 | `LIVE-LOCAL-04` 在保留设置的匹配 APK 上分别慢速、快速跨槽，确认活动行跟手、兄弟行只在跨槽时预览、首尾不越界；再检查普通纵向滚动、开关和无障碍动作，最后恢复原顺序。 |
| 负向验证方式 | 恢复 `.runOnJS(true)`、每帧 `scheduleOnRN`、硬编码行高、取消仍写入或 preferences 变化后提交旧 session；编号测试必须出现桥接次数、错误顺序或额外持久化。 |
| 明确不覆盖范围 | 不增加依赖、拖拽状态机或通用排序抽象；不修改同页字号 Slider，也不改变来源开关或存储格式。 |

## `REG-PERF-012` 内容源拖动抬手时回弹或闪空白

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `MORE-05` |
| 用户症状 | 来源已经拖到目标槽，抬手时却短暂弹回旧槽，出现行重叠、空白或整块闪动；即使缺行消失，相邻两个名字仍会在放下后的连续帧补换一次位置。 |
| 触发条件 | source-keyed 行按 preferences 顺序渲染时，提交会在 Fabric native child 数组中移动 host；改成 index-keyed 槽位后，提交又必须同时重绑槽内来源内容和清除预览 transform。两种方案都会让 native presentation 在提交边沿有可见中间态；若兄弟行还保留 120ms timing，快速松手会把该中间态进一步放大。 |
| 根因 seam | `Source` 是不会在一次拖动中改变的 native 内容身份，index 只是实测列表中的视觉槽位。host 和内容应归 `Source`，视觉位置由当前/预览顺序映射到槽位；不能让 source host 随数组重排，也不能让 index host 在提交时更换来源内容。 |
| 必须保持的行为 | 每个来源在一次可见展开期间始终使用同一 native host；Reanimated 根据实测槽位中心把该 host 映射到当前或预览 index。兄弟行越阈值即进入目标槽，抬手先在 UI thread 把活动行对齐目标槽，再提交已显示的顺序；新 preferences 到达后每个来源的 settled transform 与提交前 preview transform 相同，因此提交不换 host、换内容或续跑尾动画。成功仍只持久化一次，取消和外部设置变化零写；只有面板收起、列表不可见后才允许卸载并按最新顺序重基准，重新展开时所有对齐静止行零 transform。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 的 `REG-PERF-012` 延迟 finalize bridge并注入新持久化顺序；V2EX 与 linux.do 各自的 host instance 必须跨提交保持相同，最终分别映射到 `+56/-56` 的新视觉槽位，位置标签为第 2/1 项，跨槽不得调用 `withTiming`。收起时 row host 必须卸载，重新展开后按已持久化顺序挂载且静止行不再带 transform。index-keyed 槽位会因来源换 host 失败，恢复尾动画会因 `withTiming` 失败，缺少收起重基准则静止 transform 断言失败。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定跨 bridge 的提交契约；匹配 Android APK 必须录 raw 高质量视频，并按真实 presented frame 检查抬手窗口。 |
| Replay 或真实验收路径 | `LIVE-LOCAL-04` 记录原顺序，以 400ms 长按执行相邻与跨多槽拖动，目标到位后立即抬手；raw 高质量录屏逐个 presented frame 要求最后拖动态到最终静态顺序之间名字保持同一最终顺序，且无旧槽回弹、行重叠、空白、重复文字或整块闪动。正反向都通过后恢复原顺序并核对持久化。 |
| 负向验证方式 | 改回 source-keyed preferences render、index-keyed 槽内换内容或恢复跨提交的 sibling `withTiming`，编号测试必须出现 host identity 或 timing 失败；匹配旧 APK 在提交边沿会重新出现缺行、整块闪动或相邻名字补换位。只延后清理、增加 `collapsable={false}`、删除 `elevation/zIndex` 或给 index 槽做位移补偿都不能满足 raw-frame oracle。 |
| 明确不覆盖范围 | 不引入释放弹簧、LayoutAnimation、通用拖拽框架或额外状态机；不改变 350ms 长按、触觉、开关、TalkBack 和存储格式。可见展开期间不为清理 transform 重排或 remount source host。 |

## `REG-MORE-001` More 展开面板停住后点击无反应

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `ACCOUNT-01`、`MORE-02`、`MORE-03`、`MORE-05`、`DATA-03` |
| 用户症状 | 进入 More，展开账号中心后再点问题诊断、备份/恢复等标题，按钮有时没有反应；页面只在滚动的瞬间能点开，滚动一停又失效。用户没有点击生成、导出或分享动作。 |
| 触发条件 | 内容源面板虽然收起，其内部排序行仍挂在 More 的 `ScrollView`；每个 Reanimated host 在没有位移时仍长期提交 `transform: translateY(0)`，排序后的非零 transform 还会跨面板生命周期保留。Android Fabric 的 presentation 与 hit-test 在这个 animated-transform seam 上偶发错位，滚动提交会短暂刷新命中。 |
| 根因 seam | `src/features/more/components/ContentSourcesPanel.tsx` 同时拥有内容源排序行的挂载生命周期、稳定 source host 和 Reanimated transform。普通 ExpandablePanel、诊断导出逻辑与备份导出逻辑不是根因。 |
| 必须保持的行为 | 内容源收起时不挂载任何排序 row；展开后与 native 槽位对齐且没有拖动的 row 不写 transform。真实拖动、跨槽预览和同次可见展开内的持久化提交继续使用 `REG-PERF-011/012` 的 UI-thread shared value 与稳定 source host，不回弹、不闪行、不换名字；收起后才取消残留 drag、清槽位并按最新顺序重基准。账号中心、内容源、问题诊断、外观和备份/恢复的展开按钮在滚动停止后都必须立即响应；本回归不触发具体导出动作。 |
| 精确失败 oracle | `tests/ui/more/more-screen.test.tsx` 的 `REG-MORE-001` 先要求收起状态查不到 `content-source-row-v2ex`，再展开账号中心与内容源，要求四个静止 row 的扁平样式都没有 `transform`，最后直接展开问题诊断和备份/恢复并读取各自正文。修复前稳定得到 `transform: [{ translateY: 0 }]`；同文件 `REG-PERF-012` 另要求排序提交期间 host identity 和位移保持、收起后卸载、重开后零 transform。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定隐藏生命周期、静止 native 样式拓扑及展开正文；只有匹配 Android APK 的真实窗口输入才能证明停止滚动后的 presented frame 与 hit region 一致。ADB 坐标注入能稳定切换并会掩盖本故障，不能替代 Live。 |
| Replay 或真实验收路径 | 在保留数据的匹配主 AVD 上，用 Emulator 窗口鼠标进入 More，展开账号中心后不滚动直接依次展开/收起问题诊断、备份/恢复、外观和内容源；再滚动、完全停止后重复，至少 20 轮，每次都同时确认标题无障碍展开态和正文真实出现。另按 `REG-PERF-012` 记录原内容源顺序，执行一次相邻拖动、收起/重开并恢复原顺序；不得点击生成诊断日志、导出备份或导入。 |
| 负向验证方式 | 恢复收起时继续挂载排序 row，或让对齐静止行返回 `translateY(0)`；编号 UI 测试必须失败。用修复前匹配 APK 的 Emulator 窗口输入重复账号中心 → 其他面板，停止滚动后应能重新观察点击与展开呈现脱节；仅用 ADB 点击不得作为负向证据。 |
| 明确不覆盖范围 | 不修改 ScrollView 减速、面板受控状态、按钮水波纹、诊断/备份业务动作、系统分享或文件选择；真实手指、TalkBack 和厂商实体机差异仍需单独验收。 |

## `REG-PERF-013` 巨图编译对同一 URL 候选重复分析

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`；共享 `REG-PERF-010` |
| 用户症状 | 1000+ 图片正文的网络响应已经返回，详情页仍长时间占满 JS 主线程才出现；普通图片数量越多，等待近似按重复 URL 判断次数放大。 |
| 触发条件 | 媒体 normalizer 的 allowed、placeholder、inline、fallback、original、srcset、lightbox 和 preview descriptor 分别重新构造 `URL`；1413 张简单图片曾产生 16,956 次构造。 |
| 根因 seam | `src/domain/forum/forumContentMedia.ts` 在同一次编译内缺少候选级分析所有权，各 helper 从 attributes 重新解释相同字符串。 |
| 必须保持的行为 | 单次 `normalizeForumContentMediaNodes` 使用局部分析表；每个唯一非空候选最多构造一次 `URL`，空值零构造。descriptor 直接消费已解析候选；完整目录、顺序、Referrer、lightbox/srcset/lazy/data/placeholder/invalid URL、emoji、sticker 和动态 inline 行为不变。不得增加全局缓存、新 parser、Worker 或依赖。 |
| 精确失败 oracle | `src/domain/forum/forumContentMedia.test.ts` 的 `REG-PERF-013` 用 1413 个唯一普通图片和受控 `URL` constructor 固定构造次数 `<=1413` 且异常为 0，并固定 mixed-text sticker 重排时同一 URL 仍只构造一次；既有媒体矩阵固定输出等价。`REG-PERF-010` 另用 2000 张普通图固定该段落不读取 `innerHTML`，防止普通媒体重新进入 sticker HTML 扫描。 |
| 最低可靠自动测试层 | `UNIT_PASS`：Vitest 同时固定次数上界和媒体输出；时间门槛只由匹配 Release APK 证明。 |
| Replay 或真实验收路径 | 匹配 APK 直达 NodeSeek `post-863650-1`，记录 response-ready 到 opening row、compiler 中位耗时、完整目录计数和图片预览；不清数据、不遍历全部图片。 |
| 负向验证方式 | 移除局部 resolver，或让任一 descriptor/inline helper重新读取 attributes 并构造 `URL`；编号测试必须超过唯一候选数。 |
| 明确不覆盖范围 | 不缓存跨帖子结果，不截断、分页或延迟目录；若单次 compiler 仍占主导，另建 profile，不在此条猜测 parser/线程方案。 |

## `REG-PERF-014` 普通启动与站内详情重复请求

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01/02`、`FEED-01/02`、`TOPIC-01`、`ACCOUNT-01/02`、`NOTIFY-03` |
| 用户症状 | 普通冷启动时 Feed、Categories、账号、通知和更新并发争抢；账号逐站结算又让聚合请求反复切换。App 已运行后从列表进入 Topic，返回再进入仍可能重复 transport 和正文编译。 |
| 触发条件 | 本机账号终态尚未恢复就启动首页，或普通启动仍做 Account batch；后台工作与前台首屏并发。Topic route remount 绕过已有 Query cache。 |
| 根因 seam | `useInitialForegroundRuntime`、`useAppRuntime` 与 `useAccountRuntime` 之间缺少“本机事实已恢复”和 first-content 边界；Topic 重入必须服从唯一 `QueryClient`。 |
| 必须保持的行为 | ReaderData 与账号终态并行本机恢复；结算前只显示骨架，之后 Feed/Categories 各启动一次且普通启动 Account probe=0。Feed `onLoad` + Categories 终态后才启动自动更新与前台通知远端 snapshot，不等待或触发账号 batch。同进程从 Feed/Search/Library/Notifications 进入 Topic 后，返回并重入同一稳定 key 必须复用 QueryClient RAM 数据，detail transport 与正文 compile 均不增加；不增加第二套 cache。真实身份、ReadPlan、来源变化和显式刷新仍合法重算。 |
| 精确失败 oracle | `src/platform/storage/accountSessionStore.test.ts` 与 `tests/ui/app/app-runtime-startup.test.tsx` 固定本机恢复门禁、Feed/Categories 各一次、账号/更新/通知时序；`tests/ui/feed/feed-screen.test.tsx` 固定一次 Feed 终态回调；`tests/ui/topic/topic-session-controller.test.tsx` 固定同 QueryClient 重挂 `getTopic` 总计一次。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定时序和输入身份；只有匹配 APK 的请求诊断能证明真实 transport 次数。 |
| Replay 或真实验收路径 | 5 次 process-cold 普通启动，记录骨架、Feed/Categories request-start、Account probe=0、首次内容与后台任务时序；随后同一 Topic 进入→返回→重入，第二次零额外 detail request。 |
| 负向验证方式 | 在本机账号恢复前启动 Feed/Categories、首屏前启动更新/通知、恢复普通启动 batch，或同一 Topic 使用 `refetchOnMount`/第二套 cache；编号测试必须观察到后台抢跑、重复首页或 detail transport 增加。 |
| 明确不覆盖范围 | 不把进程冷启动直接落到 Topic 作为性能目标，不新增持久详情 cache、自建 RAM cache 或预取；不改变显式账号刷新或真实换号后的合法重算。 |

## `REG-PERF-015` ReaderData 重复建索引且四个 Tab 冷启动全挂载

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`FEED-03`、`SEARCH-01/02`、`LIBRARY-01/03`、`USER-01/02` |
| 用户症状 | 冷启动同时渲染未访问 Tab；同一份收藏、历史和密度数据在 Feed、Search、Library、User 各扫描一次，设置无关变化也重复派生。 |
| 触发条件 | Bottom Tabs 强制 `lazy:false`；四个 route 各自调用 `createTopicListItemStateIndex(readerData)` 且依赖整个 ReaderData 对象。 |
| 根因 seam | App composition 未拥有跨 route 的稳定 Reader 列表派生，route 生命周期也绕过 React Navigation 的默认 lazy/freeze 能力。 |
| 必须保持的行为 | `useAppRuntime` 只按 `favorites + history + listDensity` 建立一份 `TopicListItemStateIndex` 并传给四个 route；followedUsers 和无关设置零重建。冷启动只挂当前 Tab；其他 Tab 首访挂载一次，返回保留输入、筛选和滚动，失焦期间 freeze。真实 blur 仍执行 `REG-ACCOUNT-043` 的 auth surface 清理。 |
| 精确失败 oracle | `tests/ui/app/app-runtime-startup.test.tsx` 固定四 route 共用对象、相关 revision 每次只重建一次和无关变化零重建；`tests/ui/app/app-navigator.test.tsx` 固定初始只挂 Feed、Search 首访一次且状态保留。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经过真实 runtime projection 与 Bottom Tabs；单测 index helper 或检查配置字符串不足。 |
| Replay 或真实验收路径 | 匹配 APK 冷启动后依次访问 Feed/Search/Library/More，再返回各 Tab 核对输入、筛选和滚动；自然打开 auth surface 时另按授权回归 blur。 |
| 负向验证方式 | 恢复 `lazy:false`、删除 `freezeOnBlur` 或在任一 route 重建 index；编号测试必须观察到提前 mount、状态丢失或不同 index identity。 |
| 明确不覆盖范围 | 不缓存 Search 结果、不改变 ReaderData schema、持久化或列表筛选语义。 |

## `REG-PERF-016` LinuxDo 列表为探测下一条多翻页且分类重复读取

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02`、`SEARCH-01/02`；共享 `ACCOUNT-01/02` |
| 用户症状 | LinuxDo 首页或搜索首个页面已经足够显示 30 条，App 仍等待下一页；Catalog、Feed、Search 接近同时进入时又各读一次 `/site.json`，让“全部”更晚原子结算。 |
| 触发条件 | 客户端用 `limit + 1` 本地记录探测 `hasMore`，忽略响应已有的 `more_topics_url` / `more_full_page_results`；分类 hydration 没有按当前 ReadPlan identity 共享已完成结果和 in-flight。 |
| 根因 seam | `src/sources/linuxdo/reader.ts` 与 `src/sources/linuxdo/search.ts` 的分页循环拥有重复探测；LinuxDo adapter 没有一个受 `ReadGateway` scope 约束的 `/site.json` RAM owner。 |
| 必须保持的行为 | Feed/Search 收集到 `limit` 个有效主题后停止，并直接由服务器 cursor 决定 `hasMore/nextPage`；只有过滤后不足且服务器仍有下一页时继续。`/site.json` 按 `public:omit` 或 `authenticated:<sessionEpoch>` 保存一份进程 RAM 结果和一个 in-flight，Catalog、Feed、Search 同 scope 共用；真实 scope 变化清除旧值并恰发一次新请求，未带 scope 的 adapter 直调不缓存。主题顺序、去重、分类名、权限、错误、分页 cursor、取消和“全部”原子发布语义不变。 |
| 精确失败 oracle | `src/sources/linuxdo/reader.test.ts` 固定 30 条有效 Feed + server cursor 只调用一次列表 transport，并固定并发 Catalog/Feed 及完成后再次读取总计只请求一次 `/site.json`；切换 `authenticated:1 → authenticated:2` 必须两次且返回各自分类。`src/sources/linuxdo/search.test.ts` 固定已认证搜索只发生 CSRF + 第一页两次 transport，不探测第二页。`src/sources/readGatewayContract.test.ts` 固定 gateway 把 `authenticated:<sessionEpoch>` scope 送入 LinuxDo auth。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：Vitest 固定 cursor、scope 和调用次数；匹配 APK diagnostics 才能区分真实公网 transport 与本地结算。 |
| Replay 或真实验收路径 | 保留登录态正常启动，进入“全部”与 LinuxDo 单站，再执行一次 LinuxDo 搜索；只读核对 request-start 中首屏列表无 `limit + 1` 探测，Catalog/Feed/Search 同 identity 的 `/site.json` 最多一次。 |
| 负向验证方式 | 恢复 `limit + 1`、为确认 `hasMore` 请求下一页、让 Catalog/Feed/Search 各自读取 `/site.json`，或移除 scope 使分类跨身份复用；编号测试必须出现额外调用或错误分类。 |
| 明确不覆盖范围 | 不缓存 Feed/Search 响应，不改变“全部”的 5 秒来源预算；单次远端 transport 本身慢仍属于来源时延。 |

## `REG-PERF-017` 来源页面和最终正文被重复解释

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`SEARCH-01/02`、`TOPIC-01/02/03`、`USER-01/02`、`NOTIFY-02`；共享 `NAV-02/03`、`REG-PERF-010/013` |
| 用户症状 | 正常列表、搜索、用户页或通知详情等待本地重复 parse；1000+ 图片详情把同一最终正文反复 sanitize、扫描、序列化和编译，响应完成后仍长时间占用主线程。 |
| 触发条件 | source helper 继续以 HTML string 互相调用，各自 parse 正文、pager、身份或 access notice；source 只发布 raw HTML，ReadGateway 或 UI 再 fallback compile。 |
| 根因 seam | 页面 document/root 和最终 `PreparedForumContent` 没有成为各自阶段的唯一 owner，HTML string 被当作跨层工作接口。 |
| 必须保持的行为 | 每份正常来源响应只在最外层 parse 一次，所有同响应的内容、分页、身份和完整性判断复用 root；每条最终 fragment 的 source transform、sanitize、可见性、去重 key、quote metadata、序列化和 compile 共用一次 DOM parse。V2EX Atom fallback、排序和分页不变；妖火点击正文、聊天排序/作者/时间/链接/图片/原消息去重及 system/private-message 差异不变，且不触碰回复表单或已读协议。普通图片继续走唯一 richText 图片 renderer，正文与图库共用最终 descriptor；emoji、sticker、复杂链接、未知 wrapper、目录顺序、完整 `1/1381` 和所有交互不变；不得加全局 cache、Worker、parser、依赖或第二套 renderer。 |
| 精确失败 oracle | `src/sources/nodeseek/reader.test.ts`、`src/sources/yaohuo/parseOnce.test.ts`、`src/sources/linuxdo/reader.test.ts`、`src/sources/linuxdo/search.test.ts`、`src/sources/v2ex/parseOnce.test.ts` 固定每响应/fragment parse 次数；V2EX 用户主题与回复页 marker 各 `parseHtml=1` 并固定内容/cursor，妖火通知详情整页 `parseHtml=1`、每个最终 fragment sanitize parse `=1` 并固定点击正文、聊天排序/作者/时间/链接/图片/原消息去重和 system/private-message 差异；NodeSeek rendered poll 从页到最终正文总 parse `=2` 且三类投票输出等价。`src/domain/forum/topicContentSplit.test.ts` 固定纯 9/2000 图生成每 row 最多 4 个网络媒体、最终 root 只序列化一次、完整 preview 顺序和混合内容行为。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定边界和输出，RNTL 固定直出，只有匹配 Release APK 能证明 Hermes/React/Native layout 的实际收益。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装；执行 5 次正常启动及 Library/History → `post-863650-1`，记录同一 topic identity 的 body-ready、source-parsed、content-plan-ready、catalog ready、opening row、first media、janky frames、目录、预览、Back 与同 PID 重入；另只读检查 V2EX 用户主题/回复分页和一个已有已读妖火消息，若没有安全目标则 `NOT_VERIFIED`。 |
| 负向验证方式 | 恢复任一 helper 的 string reparse、让 ReadGateway/UI fallback compile 非空正文、增加模块级媒体缓存或第二套图片 renderer；对应 parse-count、序列化、descriptor 等价或架构测试必须失败。 |
| 实测取舍 | 曾实现纯图片 typed 直出；匹配 Release 对最终单流程的响应到首媒体只改善约 `6.4%`，响应到 loaded 约改善 `18.0%`，janky frames 约改善 `21.2%`，没有达到主要速度 `20%` 与掉帧 `50%` 保留门槛，因此删除该分支，避免后续图片 bug 双线维护。 |
| 明确不覆盖范围 | 不优化冷启动直达 Topic，不截断、分页或延迟图库；若 content plan 已达标而首行仍慢，只 profile React/RNRH/Native layout，不继续猜测 compiler。 |

## `REG-PERF-018` 稳定 Query 结果和局部图片状态触发全局重复渲染

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-01/02`、`TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010/013/017` |
| 用户症状 | 已结算的引用和“全部搜索”在父组件无关重渲染时重建 Map、分组与可见列表；任一 inline 图片状态变化让所有回复重新扫描 HTML 和渲染；同一 `srcset` 在目录状态变化时重复解释，NodeSeek reaction 同一 Topic render 计算两次。 |
| 触发条件 | `useQueries` 暴露每轮新建的完整结果数组，Search 来源投影依赖宽泛 runtime 对象；Reply comparator 用全局 inline map 扫描每条 raw HTML；图库 preparation 与当前 inline/session/Referrer 投影没有分开；reaction 的派生值没有成为单次 render owner。 |
| 根因 seam | Query 层没有输出结构稳定的最小投影，正文行失效边界没有落在 compiled row 的 `dynamicImages`，descriptor 解释与会话投影由同一个函数重复拥有。 |
| 必须保持的行为 | 引用与聚合搜索只投影实际消费字段并由 TanStack Query 结构共享保持 identity；来源真实变化仍重建，既有 Loading/error/refetch 与 transport 语义不变。`reply` 对象变化必须刷新；inline map 变化只检查当前正文/签名/引用 row 的最多 4 个 compiled dynamic image descriptors。descriptor/宽度/DPR 变化才重新 prepare，inline 排除、media session 或 Referrer 变化只 project；目录顺序、去重、索引、图片切换和旧兼容 API 不变。NodeSeek reaction UI 不变且每次 Topic render 只算一次。 |
| 精确失败 oracle | `tests/ui/topic/topic-session-controller.test.tsx` 固定空/已加载引用在无关 rerender 后 Map/回复/loading 投影同一引用且 `getReply` 不增加；`tests/ui/search/search-controller-ai.test.tsx` 与 `tests/ui/search/search-screen.test.tsx` 固定“全部搜索”结算后分组/列表同一引用且 transport 不增加；`tests/ui/topic/topic-components.test.tsx` 固定两条不同动态图片只重渲染变化行且 HTML 正确切换；`src/platform/media/imagePreviewCatalog.test.ts` 与 `tests/ui/topic/image-preview-controller.test.tsx` 固定同一 descriptor 的 `srcset` prepare 一次、inline 排除只重投影；`tests/ui/topic/topic-reply-filters.test.tsx` 固定 reaction 输出与每 render 单次计算。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest/RNTL 固定调用、identity 和渲染次数；匹配 Release APK 只记录真实 React/Native 表现，不用单次体感代替确定性 oracle。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装；四来源普通 Topic 核对正文、引用、签名、采纳、reaction、筛选、定位和返回；NodeSeek 巨图主题连续 5 次记录 diagnostics、首媒体、loaded、帧、完整目录、首/中/末预览和同 PID RAM 重入；Search“全部”只提交一次，核对来源顺序、渐进结果、局部错误/重试与无重复请求。 |
| 负向验证方式 | 移除 `combine`、让 Search 投影依赖无关 runtime、恢复全局 inline map × raw HTML 扫描、把 prepare/project 合回每次目录构造或再次直接计算 reaction；编号测试必须出现 identity 变化、额外 transport/渲染/解析或重复调用。 |
| 明确不覆盖范围 | 不承诺端到端提速比例，不新增全局 cache、HTML 变体缓存、Worker、依赖或第二套 renderer；未分离的 React commit 与 Native layout 只有 profile 后才能立新优化。 |

## `REG-PERF-019` 首页冷启动丢弃已确认会话并重复请求首页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01/02/04`、`ACCOUNT-01/02`；共享 `SEARCH-04`、`MORE-02`、`WRITE-01/03`、`NOTIFY-03`、`NAV-01/02` |
| 用户症状 | 冷启动第一瞬间先出现一份来源不明的列表，随后只剩 V2EX，再刷新成正常多来源列表；同一启动快速请求多次，浪费会话信任并增加站点限流风险。 |
| 触发条件 | 每次启动丢弃上次 confirmed 身份并进入全站核对；逐站结果改变 ReadPlan/query key，Feed/Categories 因而重复启动。 |
| 根因 seam | 账号终态没有独立持久化；Account probe lifecycle、首页请求和 CF/login recovery 被塞进同一分布式状态链。 |
| 必须保持的行为 | 每来源持久化 authenticated 的最小非敏感 identity 或 anonymous；冷启动与 ReaderData 并行恢复，完成前零网络，完成后唯一 ReadPlan、Feed 一次、Categories 一次、Account probe 零次。首次升级只核对有 Cookie/SecureStore 候选来源一次并写单个全局 marker；损坏来源独立 unknown。账号检查 activity 不改身份；A→A 零 epoch/Feed，明确 anonymous/A→B 或当前 epoch raw 401 才隔离该来源。401 不补账号请求或重放，403/429/CF/网络/解析不失效。登录 WebView 打开零 probe、关闭一次核对；本地退出不清 WebView Cookie。首页 linux.do CF 保留其他来源，拉起现有验证页，每次显式检测最多恢复 exact aggregate Query 一次且 identity/query key 不变。 |
| 精确失败 oracle | `src/platform/storage/accountSessionStore.test.ts`、`tests/ui/account/account-status-controller.test.tsx`、`tests/ui/app/app-runtime-startup.test.tsx` 固定恢复/迁移/损坏/single-flight/启动次数；`src/platform/network/request.test.ts`、Read/Notification Gateway 与 Topic action tests 固定 raw 401 和负例；`tests/ui/feed/feed-controller-session.test.tsx`、`src/features/account/useVerificationController.test.ts` 固定无 V2EX-only 与 aggregate CF 一次恢复。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：store/request 用 Vitest，启动/Account/Feed/CF 用 RNTL，真实次数只接受匹配 APK 的脱敏诊断。 |
| Replay 或真实验收路径 | 主登录 AVD 保留数据覆盖安装，前后 `firstInstallTime` 不变；连续 5 次 process-cold launch，每次只能“骨架 → 一次正常多来源列表”，Account=0、Feed=1、Categories=1。更多页连续刷新两次确认 per-source single-flight；自然 CF 才验 overlay，不清 Cookie 制造。 |
| 负向验证方式 | 删除 session store/hydration gate、恢复启动 batch/freeze、核对开始改 trust、让 typed hint/403/429 失效、或让 aggregate CF 走 Account reconcile；对应测试必须出现额外 probe/request、V2EX-only、身份变化或循环恢复。 |
| 明确不覆盖范围 | 不增加 authFlowDirty/TTL/后台核账/全局调度器，不手工合并单个 linux.do child cache，不自动重试写操作，不清 Cookie；若某站首页确需账号前置凭据，必须先用诊断证明并另立定向步骤。 |

## `REG-PERF-020` 正文原图重复解码适屏图并扩大重图工作集

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-03`、`REG-PERF-010` 与 `REG-TOPIC-048` 的正文图片生命周期 |
| 用户症状 | NodeSeek `post-863650-1` 滚动到重图片区域时 PSS 峰值比详情前增加约 `184MB`，超过 `REG-PERF-010` 的 `+150MB` 门槛；返回后约 `+48MB`，说明不是持续泄漏而是离屏图片 cell 与重复解码共同扩大峰值工作集。 |
| 触发条件 | 适屏图已经作为独立底层挂载，原图 Expo Image 又把同一个远程适屏 URL 传入 `placeholder` decoder；同时 FlashList 回收池可继续持有离屏重图片 owner。 |
| 根因 seam | `src/features/topic/rendering/previewRenderers.tsx` 的适屏底图/原图双层生命周期，以及 `src/features/topic/components/TopicContentList.tsx` 的详情 FlashList 回收池上限。请求并发由既有 coordinator 管理，不等于 decoded Bitmap 驻留预算。 |
| 必须保持的行为 | 原图层不得配置远程 `placeholder`；适屏图作为独立底层持续显示，原图沿既有许可、优先级和 `150ms` transition 渐显，只有匹配原图 `onDisplay` 后才卸载底层，失败继续保留。所有图片完整保序并自动加载，正文几何、点击预览、原图保存、SVG 和 session identity 不变。回收池取 `40 → 12 → 8` 中满足设备门槛的最大值；`0` 只用于根因证伪，若关闭回收池仍不能使峰值至少下降 `20%`，停止调常量并用可 profile 构建寻找其他 Native owner。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 的 `[REG-TOPIC-048]` 直接观察原图 Expo Image：`placeholder` 必须为空，升级前独立适屏底图仍挂载，匹配原图 `onDisplay` 后才卸载；失败用例继续保留适屏图。既有 Topic compiler、media coordinator 与 preview tests 固定完整目录、顺序、自动加载、稳定几何和请求预算。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定解码入口和底图生命周期；只有匹配 Release APK 的同 PID PSS、Native Heap、View、FrameTimeline 与日志能证明 decoded working set。源码字符串或强制 GC 不能代替。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装，沿 `REG-PERF-010` 用固定步数滚动 `post-863650-1`，记录进入前、峰值、Back 后 60 秒的 PSS/Native Heap/View/帧和 ANR/OOM。峰值 `<= baseline+150MB`、Back 60 秒 `<= baseline+80MB`、滚动 p95 `<=50ms`；快速反向滚动相对池 40 基线不得恶化超过 `10%`，不得出现空白或新请求波。另回归普通 1/4/20 图、完整预览目录和返回普通详情。 |
| 负向验证方式 | 把适屏 remote source 重新传给原图 `placeholder`、在原图成功前卸载底图、为过门槛截断图片或清全局 Glide cache，UI oracle 或设备完整性/内存门槛必须失败。 |
| 明确不覆盖范围 | 不截断图片、不增加手动继续加载、全局 cache clear、强制 GC、统一 RGB 解码、第二套图片缓存或依赖升级；远距离快速回滚允许从磁盘缓存重新解码。 |

## `REG-PERF-021` Library 动态筛选通过批量 Native 节点重建结算

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `LIBRARY-01/02/03`；共享 `NAV-01` 与 `REG-PERF-001` 的 Library 列表和筛选生命周期 |
| 用户症状 | 关注用户切回收藏的隔离样本 `20/20` 帧都 miss，p95 约 `48ms`；收藏与历史切换掉帧约 `43.6%`、p95 `32ms`。相同数量筛选项切换接近一帧，说明数据筛选本身不是主因。 |
| 触发条件 | `PillRail` 以动态 `value/label` 作 key，来源或 tab 改变时批量替换原生节点；关注用户无分类时 Library 又卸载整棵分类 rail，返回帖子 tab 时重建。首阶段改为位置 key 并只隐藏分类 rail 后，关注用户↔收藏已达标，但全部来源↔V2EX 三组仍为 p95 `34.59~35.06ms`，证明动态 taxonomy 整批更新仍超过预算。 |
| 根因 seam | `src/ui/controls/SelectionControls.tsx` 的 Pill 位置身份，以及 `src/features/library/LibraryScreen.tsx` 在普通来源切换中是否拥有动态分类 Native children。所有筛选语义状态由外部值驱动，节点自身无业务状态。 |
| 必须保持的行为 | 通用 Pill 以位置槽维持 React/Native identity，只更新文字、选中态和回调；Library 分类改为始终挂载的固定按钮，来源切换只更新按钮 props，动态 taxonomy 只在用户显式打开现有 `PopupMenu` 时创建。关注用户时固定槽保持几何、按钮以 `opacity:0` 隐藏并从无障碍树移除；没有可选分类时按钮保持挂载并禁用。三 tab、来源/分类筛选、首帧重置、两次无动画滚顶、`REG-PERF-001/022` 的 tab 稳定 viewport、`drawDistance=250` 和禁用位置锚定均保持。 |
| 精确失败 oracle | `tests/ui/library/library-screen.test.tsx` 的 `[REG-PERF-021]` 在同一槽切换两套 taxonomy 后要求 Pill React instance 不变；Library 来源 taxonomy 更换前后必须命中同一固定分类按钮，关注用户时普通查询与无障碍树都不可见，但 hidden query 必须命中切换前同一按钮，返回收藏后仍复用。分类选择只能在显式打开菜单后出现。既有 `[REG-PERF-001/022]` 用例继续固定 viewport owner、稳定 data/render、重置和滚顶契约。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定稳定 topology 和无障碍结果；匹配 Release APK 的 FrameTimeline 才能证明批量 Native create/delete 已消失。 |
| Replay 或真实验收路径 | 主 AVD 覆盖安装匹配 APK，分别执行关注用户↔收藏、全部来源↔V2EX 各三组 20 次；每组要求 p95 `<=25ms`、worst `<=35ms`、无连续两帧 miss，同时确认按钮、菜单、筛选、计数、隐藏分类和 TalkBack 结果不变。 |
| 负向验证方式 | 恢复语义 key、在来源切换期间渲染整批分类 Pill、条件卸载固定按钮、让隐藏按钮仍出现在无障碍树，或把选中状态移入节点内部，对应 UI 或设备 topology/帧门槛必须失败。 |
| 明确不覆盖范围 | 不处理动画、不新增通用选择框架、不改变本机数据或筛选语义；固定菜单只接受已测量触发的一次额外分类点击。 |

## `REG-PERF-022` Library 空收藏假绿与富内容 tab 复用所有权错误

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `LIBRARY-01/02/03`；共享 `NAV-01`、`REG-PERF-001/021` |
| 用户症状 | 空收藏返回 p95 `21.56ms`，看似达标；同设备进入 238 条 History 为 p95 `40.45ms`，旧实现三组真实收藏↔历史为 p95 `42.81–55.00ms`。空数组会清掉越界回收节点，下一次进入富内容数据集必须重建首屏 TopicCard，因此空收藏不是有效性能 oracle。 |
| 触发条件 | 一个 FlashList 在收藏、历史和关注用户三个语义数据集之间替换 data；从空或小数据集切到 238 条 History 时，当前 viewport 没有可复用的 tab-local Native owner。收藏和历史还在 tab 切换时重复派生、排序，renderer 闭包依赖整个 filtered array。 |
| 根因 seam | `LibraryRoute` 对收藏/历史数据的派生所有权，以及 `LibraryScreen` 的 tab viewport、FlashList props identity、分阶段挂载和失焦释放。每个数据集只允许在自身输入变化时派生一次；普通 tab 切换不得重算或重渲染已挂载列表。 |
| 必须保持的行为 | 性能样本同时包含空收藏与至少 20 条真实收藏；收藏和历史分别排序、过滤并建立稳定 list-item array。Library 聚焦时每个 tab 最多一个固定 viewport：当前同步挂载，另两个在前一个 `onLoad` 后逐帧挂载；隐藏 viewport 不可点击且不进入无障碍树。普通 tab 切换只更新可见性、选中态和两次无动画滚顶，已挂载 populated FlashList render 次数为 0。失焦或进入 Topic 后卸载两个非活动 viewport，只保留当前 viewport；不改变 TopicCard、密度、顺序、筛选、操作或视觉。 |
| 精确失败 oracle | `tests/ui/library/library-screen.test.tsx` 的 `[REG-PERF-022]` 固定当前 viewport 初始唯一挂载、每个 `onLoad` 后下一帧只增加一个 owner、三 tab 最多三个 owner；收藏/历史 array identity 跨 tab 切换不变，预热完成后的收藏↔历史导致 FlashList render 记录为 0；失焦恰卸载两个非活动 owner，隐藏 viewport 普通/无障碍查询不可见。空数据、20 收藏 fixture、1000 条 History、筛选重置、双滚顶与现有操作继续通过。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 owner、计算和 render 边界；只有身份匹配 Release APK 的真实 populated ReaderData、FrameTimeline、View 与 meminfo 能证明富内容切换和工作集收敛。空列表、源码字符串或 Debug 体感均不足。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装，以 App 自身保留至少 20 条本机收藏，执行收藏↔历史、关注用户↔收藏、全部来源↔V2EX 各三组 20 次；记录首次进入、预热后切换与纵向滚动。目标为 p95 `<=25ms`、worst `<=35ms`；真实 guest/SF cadence 必须单独记录，模拟器连续 deadline miss 不得自动外推为真机卡顿。预热后做 5 轮 Library→离开→返回，30 秒稳定 PSS/Native Heap 首末增长 `<=10MB`，离开后 View 数回到单活动页面基线 `±10%`；再从 Library 打开普通多图 Topic。 |
| 负向验证方式 | 只测空收藏、恢复单活动 FlashList、在 tab 切换时重建排序/过滤数组或 render props、同首帧挂全部 viewport、用 `display:none` 隐藏 FlashList、失焦仍保留全部 owner，编号 UI oracle或设备帧/View/内存门槛必须失败。真实 A/B 中 `display:none` 曾把 attached Views 从约 `705` 推到 `7,789`；同首帧挂载曾产生 `44–45ms` Library 入口帧，均不得恢复。 |
| 明确不覆盖范围 | 不改动画、TopicCard 信息和视觉、数据截断、图片缓存、依赖或原生配置。当前 90Hz 模拟器的 populated tab p95/worst 已进入 `25/35ms`，但连续 deadline miss 仍失败；这项只报告环境化证据，不冒充物理 90/120Hz 真机通过。 |

## `REG-PERF-023` 等价运行时投影重复提交新引用

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`SEARCH-01`、`NOTIFY-03` |
| 用户症状 | 通知刷新结果未变仍提交新的 errors state，App 无关重渲染仍重建 Navigator `onReady`，单来源搜索结算后无关重渲染仍重建列表 data；下游 memo 因引用变化失效。 |
| 触发条件 | 相同通知快照刷新或清理一个没有错误的来源；任意 App runtime 重渲染；单来源搜索结果结算后的无关重渲染。 |
| 根因 seam | 等价通知错误、导航 ready 回调和单来源 Search groups 没有在各自现有 owner 内保持引用稳定。 |
| 必须保持的行为 | 等价 `snapshotErrors` 返回旧对象，真实错误变化仍更新；`onReady` 引用稳定且始终按通知回调 → lifecycle 回调各一次执行；single/aggregate/empty Search projection 只在真实输入变化时重建。请求、持久化、worker、Query、分页和路由语义不变。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 固定相同刷新与无错误来源清理前后 `snapshotErrors` identity，并保持 fetch、持久化和 worker 次数；`tests/ui/app/app-runtime-startup.test.tsx` 固定无关重渲染前后 `routes.onReady` identity、次数和顺序；`tests/ui/search/search-controller-ai.test.tsx` 固定单来源 `searchGroups` identity 与一次请求。 |
| 最低可靠自动测试层 | `UI_PASS`：必须经过真实 Hook render/effect 和 Query 结算；源码字符串或纯函数相等不足。 |
| Replay 或真实验收路径 | 不新增独立 Replay；沿既有 Navigation、Search 和 Notifications 只读旅程确认行为不变，帧收益只在后续匹配 APK 的专项性能采样中归因。 |
| 负向验证方式 | 恢复无条件 errors state 写入、普通函数 `onReady` 或 render 内单来源数组字面量；编号测试必须出现新引用，既有次数或顺序断言仍必须保持。 |
| 明确不覆盖范围 | 不合并通知读取链路，不增加协调器、缓存、reducer、phase、pending ref、队列或 single-flight；不改 Account、Feed、Yaohuo、Library、Topic、图片 Native patch、依赖或公开 API。 |

## `REG-NOTIFY-058` 新增通知来源重读稳定 sibling snapshot

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-03`；共享 `ACCOUNT-01/02` |
| 用户症状 | 活跃通知来源从 A 扩到 A+B 或单站换号时，A 已成功的未读 snapshot 被再次读取、持久化和投递扫描。 |
| 触发条件 | 所有 active 来源共用一个聚合 Query key；来源集合或 identity signature 变化使整个 query 重跑，另有 enabled effect 立即 `refetch` 形成第二次请求。 |
| 根因 seam | `useNotificationsRuntime` 把 `source + identity` 独立生命周期聚合成一个 Query，并以 aggregate result 驱动副作用。 |
| 必须保持的行为 | 每个 `source + identityKey` 独立 Query；A→A+B 只新增 B，换号只重读目标 identity。每个成功 `dataUpdatedAt` 恰持久化一次并触发一次对应 foreground delivery。冷启动在本机账号恢复且首页首次内容 settled 前零远端 snapshot；显式刷新、前后台恢复和定时刷新仍对当前每来源各执行一次。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-runtime.test.tsx` 的 `REG-NOTIFY-058` 固定 A 后扩 B 的读取总数为 A=1/B=1；另固定 remote-ready 门禁、同 revision 零重复持久化，以及恢复和显式刷新每来源各 +1。 |
| 最低可靠自动测试层 | `UI_PASS`：必须使用 QueryClient 和 runtime effect；纯 query-key 单测不足。 |
| Replay 或真实验收路径 | 匹配 APK 只读启动与恢复，按 diagnostics 核对当前 active 来源各一次；不切换开关或账号制造状态。 |
| 负向验证方式 | 恢复聚合 snapshot key 或额外 mount-time `refetch` effect；编号测试必须看到 A 第二次读取或同 `dataUpdatedAt` 重复落盘。 |
| 明确不覆盖范围 | 不改变消息列表分页 Query、后台 WorkManager、持久化 schema、刷新周期或用户通知意图。 |

## `REG-NOTIFY-059` 通知详情外链打开失败没有任何反馈

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NOTIFY-02` |
| 用户症状 | 用户点击通知详情中的普通外链时，Android 没有可用处理器或打开失败会毫无反馈；`mailto:` 等非 HTTP(S) scheme 也被直接交给平台，没有明确支持边界。 |
| 触发条件 | 已加载的通知详情 HTML 含非论坛目标链接；HTTP(S) 的 `WebBrowser.openBrowserAsync` Promise rejection，或链接使用非 HTTP(S) scheme。 |
| 根因 seam | `DetailHtml` 直接执行裸 `void Linking.openURL(href)`，没有观察 rejection，也没有由 Route 持有协议校验和错误反馈 callback。 |
| 必须保持的行为 | 论坛主题链接继续解析并在 App 内导航；Screen 不持有 `Linking` fallback，`onOpenExternalUrl` 为必填并只转发语义事件。普通外链经 Route 内引用稳定的 `useCallback` 处理，复用既有 `isHttpOrHttpsUrl`、`errorMessage` 与 `runtime.notify`。仅 HTTP(S) 向 `WebBrowser.openBrowserAsync` 转发一次，rejection 必须通知；非 HTTP(S) 不调用 WebBrowser，并显示固定的不支持提示。不新增 state、retry 或抽象；两次失败操作期间 `loadDetail=1`、App navigation=0。callback 必须覆盖普通详情、会话原消息和消息气泡 HTML。 |
| 精确失败 oracle | `tests/ui/notifications/notifications-route.test.tsx` 的 `REG-NOTIFY-059` 第一条真实 Query/detail render 点击 HTTPS 与 `mailto:`：HTTPS rejection `browser unavailable` 必须传给 `runtime.notify`；`mailto:` 必须显示既定 scheme 提示且不增加 WebBrowser 调用。最终 `loadDetail=1`、`WebBrowser.openBrowserAsync=1`、`runtime.notify=2`、`navigation.navigate=0`。第二条会话用例分别点击原消息与消息气泡的公开 HTTPS 链接，必须按顺序向同一个 `WebBrowser.openBrowserAsync` owner 转发两次且零通知。修复前 HTTPS rejection 没有反馈、非 HTTP(S) 会进入 WebBrowser，或会话任一分支漏接 callback 时该矩阵失败。 |
| 最低可靠自动测试层 | `UI_PASS`：RNTL 必须经过真实 Query、详情渲染、链接点击与 Promise settlement；纯 URL helper 或源码字符串不能证明反馈、请求和导航次数。 |
| Replay 或真实验收路径 | 不新增 tracked Replay；动态内容和 OS handler 不适合作为确定性 oracle。仅当身份匹配 APK 的当前已读通知含安全、公开的 HTTP(S) 外链时，才可点击一次，确认默认浏览器 Custom Tab 或错误反馈后返回；没有安全样本则记 `NOT_VERIFIED`，不得为制造失败而禁用 handler，也不得点击 `mailto:` 或自定义 scheme。 |
| 负向验证方式 | 恢复裸 `void Linking.openURL`、删除 scheme guard/catch 或绕过 `runtime.notify`，编号 RNTL 必须在 notify、WebBrowser、`loadDetail` 或 navigation 次数上失败。 |
| 明确不覆盖范围 | 不扩展任意 scheme allowlist，不增加 `canOpenURL` preflight、Browser Service、重试、诊断或持久化；不改变论坛目标解析、已读、回复或 `MORE-02`。 |

## `REG-NAV-001` 底部导航只在图文附近响应点击

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`；保持 `NOTIFY-03`、`REG-NOTIFY-052` 的 More 红点 |
| 用户症状 | 首页、搜索、收藏、更多必须点得非常准；图标左右虽仍属于对应 tab 的视觉槽位，点击却没有跳转。 |
| 触发条件 | 在底栏同一 tab 的图标或文字中心之外、相邻 tab 中点边界之内点击。 |
| 根因 seam | `src/app/styles.ts` 把 App 级 `tabBarItemStyle.navItem.alignItems` 设为 `center`。React Navigation 的外层 item 虽然 `flex: 1`，其直接子 `PlatformPressable` 却在横向交叉轴收缩到图文固有宽度；`src/ui/navigation/NavBar.tsx` 的内部居中视觉样式不是根因。 |
| 成熟项目证据 | [React Navigation BottomTabItem](https://github.com/react-navigation/react-navigation/blob/main/packages/bottom-tabs/src/views/BottomTabItem.tsx) 让默认 `PlatformPressable` 消费整个 flex item；[Mattermost tab bar](https://github.com/mattermost/mattermost-mobile/blob/main/app/screens/home/tab_bar/index.tsx) 与 [Bluesky BottomBar](https://github.com/bluesky-social/social-app/blob/main/src/view/shell/bottom-bar/BottomBar.tsx) 同样让每个非重叠 flex item 整格响应，不给图标叠加相邻 `hitSlop`。 |
| 必须保持的行为 | App 级 tab item 在横轴 `stretch`，四个按钮铺满保留既有外层 padding 后的等宽内容 slot、首尾相接且互不重叠。底栏高度、安全区、padding、图标、文字、间距、颜色、选中态、触觉和 More 红点不变；点击区不进入页面内容或系统手势区。 |
| 精确失败 oracle | 匹配的 1080×2400 Android APK 修复前 UI hierarchy 显示四个按钮仅约 `107×126px`，相邻中心距约 `257px`；首页选中时点击 `(300,2280)` 仍为首页，搜索中心可切到搜索；搜索选中时点击 `(570,2280)` 仍为搜索，收藏中心才切到收藏。`tests/integration/style-ownership.test.ts` 的 `[REG-NAV-001]` 修复前精确得到 `alignItems=center`，要求 `stretch` 时失败。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：Vitest 固定 App 样式模块对 React Navigation item 的布局契约；只有匹配 Android 的 UI hierarchy 与真实坐标点击能证明 native hit bounds 已扩展。 |
| Replay 或真实验收路径 | `LIVE-NAV-01` 从当前 hierarchy 推导每格四边内侧和相邻边界两侧坐标，逐点确认只切到所属 tab，再恢复首页并对比底栏截图。现有 `.ad` 继续以稳定 `main-tab-*` selector 验证四个路由；固定坐标不得进入 tracked Replay。 |
| 负向验证方式 | 把 App 级 `alignItems` 恢复为 `center`，编号 Vitest 必须失败，匹配 APK 的按钮 bounds 再次缩到图文附近且格内空白点击无效。仅添加 `hitSlop`、`pressRetentionOffset`、透明 overlay 或自定义 TabBar 不满足该 oracle。 |
| 明确不覆盖范围 | 不改变视觉布局、底栏高度、外层 padding、安全区、路由状态、重复点击回顶、More badge 语义或页面底部内容；不向底栏外扩展点击区。 |

## `REG-TOPIC-099` 展开主楼引用被显示成上下两张卡片

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03`、`REG-TOPIC-003/054/055/093` |
| 用户症状 | linux.do 主题正文中的引用展开后，引用摘要和完整正文被父 FlashList 显示成上下两个隔离卡片；正文包含多个物理 row 时还会重复外框、圆角或间距。 |
| 触发条件 | 主楼引用 summary 被归到 opening scope，展开 body 被归到独立 topic-quote scope；separator 因 scope 不同插入普通间距，header 与每个 body row 又分别应用完整 quote box 样式。 |
| 根因 seam | `TopicContentList` 的逻辑内容 scope 与 quote frame 样式必须共同使用引用 `instanceKey`；语义身份不能只存在于 compiler row，而在父 FlashList presentation 层丢失。 |
| 必须保持的行为 | summary 与展开正文共享 `topic-quote:<instanceKey>` scope；summary→首个正文和同一 body continuation rows 的 separator 为 0。header 使用 top frame，正文使用 continuation/bottom frame，首个正文 row 只添加一次 body padding，最终显示为一张连续引用卡片。展开/收起、Loading/error、同主题当前楼层优先、跨主题缓存、定位和正文虚拟化不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-components.test.tsx` 的 `[REG-TOPIC-099]` 固定外置完整正文时 header 使用 open-bottom top frame；`tests/ui/topic/topic-reply-filters.test.tsx` 固定 summary→首个 body 和同一引用 body rows 的 separator 都为 0。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：helper 或 compiler 单测不能证明父 FlashList separator 与最终卡片边框连续。 |
| Replay 或真实验收路径 | 匹配 APK 在主 AVD 只读打开 `https://linux.do/t/topic/2756057`，展开目标引用，核对 summary、正文第一行和最后一行只有一个连续外框；再收起和二次展开，不发回复或互动。 |
| 负向验证方式 | 恢复 summary 的 opening scope、summary/body 普通 separator、让每个 body row 都使用完整 quote box，或增加 linux.do/URL 特判；编号 RNTL 或匹配 APK 必须重新出现断层。 |
| 明确不覆盖范围 | 不改变 Android 原生文本选择 owner。跨 FlashList/RNRH 多个 `TextView` 以及图片上下文本的系统选区仍是独立架构问题，不用复制全文、selection overlay 或站点特判伪装修复。 |

## `REG-TOPIC-108` 新进入屏幕的图片被旧 row 请求占满 permit

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-02`；共享 `REG-PERF-010` 的千图正文媒体调度 seam |
| 用户症状 | 千图正文继续滚动时，当前已经进入屏幕的图片保持等待；上一屏或预取 row 的图片仍占用全部四个请求位置，必须等旧请求完成或超时后当前图片才开始。 |
| 触发条件 | 四个 behind-row 媒体已经处于 running，viewport 顺序随后把新的 visible row 放到最前，但旧 row 仍留在 warm window。 |
| 根因 seam | Coordinator 用 warm capacity 决定是否取消旧请求，却用当前 running 数决定是否启动新请求；warm 上限大于并发 permit 上限，因此合法保温的旧请求可以永久占满全部 permit。 |
| 必须保持的行为 | 每次 viewport 重算先按既有 priority、row 顺序、request identity 去重和原图上限确定最多四个 scheduled owners；不在该集合内的 running 请求退回 waiting，新 visible row 同轮获得 permit。已显示像素、warm window、暂停、失败重试、同 identity 去重、四并发和最多一个原图语义不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-media-coordinator.test.tsx` 的 `[REG-TOPIC-108]` 先让四个 behind-row probe 全部 admitted，再把 visible row 排到前面；要求 visible probe 立即 admitted 且总 admitted 仍为四。旧实现得到 visible=`idle`、四个旧 probe 继续 admitted。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定 permit ownership；匹配 APK 连续滚动才能确认真实请求、FlashList viewport 与媒体显示协同。 |
| Replay 或真实验收路径 | 主 AVD 覆盖安装匹配 APK，从正常 History 入口进入 NodeSeek `post-877083-1`，连续滚动正文并回收前后 rows；当前 viewport 图片应持续取得请求位置，正文不得白屏、迟到或先出现回复。 |
| 负向验证方式 | 恢复只按 `warmKeys` 取消 running 的逻辑；编号测试必须看到新 visible probe 保持 idle。 |
| 明确不覆盖范围 | 不改变媒体尺寸、表情/贴图布局、图片 renderer、正文分块、请求并发上限、缓存或预览目录；远端本身慢仍可能显示加载状态。 |

## `REG-TOPIC-109` 展开同主题主楼引用导致 App 闪退

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03`；共享 `TOPIC-01/02`、`NAV-03`、`REG-TOPIC-003/054/099` 与 `REG-PERF-010` 的引用缓存和严格预编译 seam |
| 用户症状 | App 只读打开 linux.do `t/2768624` 后，点击评论中引用主楼的“展开”必定退出到系统桌面；Release 日志为 `FATAL EXCEPTION: mqt_v_native`，JS 异常是“论坛内容缺少匹配的预编译计划”。 |
| 触发条件 | 评论引用当前主题的 floor 1。详情列表为定位和回复目标解析把 `topicOpeningPostAsReply(topic)` 放入 `repliesByFloor`；该投影没有 compact 引用计划。控制器同时已经把 `prepareReplyContent(..., 'quoted-reply')` 的对象写入引用 Query 缓存。 |
| 根因 seam | `replyForQuotedPost` 用 `local || cached` 同时表达“当前数据优先”和“可渲染对象优先”，因此无计划的本地主楼投影覆盖了有计划的缓存对象；严格 renderer 随后按既定 fail-fast 契约抛错。 |
| 必须保持的行为 | 跨主题引用继续只使用目标缓存；普通同主题回复有 compact 计划时继续优先当前页，避免旧缓存覆盖新内容；只有本地对象无计划而缓存已有计划时使用缓存。floor 1 投影继续负责回复目标作者和用户解析，控制器仍是引用计划的唯一准备者，渲染阶段不得现场编译或吞错。 |
| 精确失败 oracle | `src/features/topic/model/replyListModel.test.ts` 的 `[REG-TOPIC-109]` 使用无计划 floor 1 投影、已准备缓存和 expanded 评论引用。旧 resolver 稳定在 `requirePreparedForumContent` 抛出相同异常；修复后必须生成指向缓存对象的 summary 和完整 `replyQuoteContent`。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定 resolver 到严格内容计划的完整模型链；既有 Topic controller/components RNTL 固定缓存提交顺序、普通同主题当前回复优先和跨主题缓存；只有匹配 Release APK 能证明未捕获 JS 异常不再杀死 Android 进程。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装匹配 APK 并确认 `firstInstallTime` 不变；通过 canonical deep link 直达 `https://linux.do/t/2768624`，执行“展开 → 收起 → 再展开”，核对完整引用正文、PID、限定日志窗口和 Android Back。目标依赖动态第三方内容，不新增 tracked `.ad`。 |
| 负向验证方式 | 恢复 `local || cached` 后编号测试必须重新抛出相同计划异常。删除 floor 1 投影会破坏回复目标解析；在组件加 `try/catch`、渲染期补编译或按站点/URL 特判均不满足本条。 |
| 明确不覆盖范围 | 不改变引用 UI、compiler、Query key、加载重试、站点 parser、导航结构或 Replay runner；不处理与本次计划选择无关的正文内容、网络失败和第三方页面变化。 |

## `REG-TOPIC-110` 普通代码块显示并复制字面 code 标签

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `REG-PERF-017`、`REG-TOPIC-088/089/093` 的 sanitizer→compiler 与 parse-once seam |
| 用户症状 | App 只读打开 NodeSeek `post-879597-1` 时，一个普通五行代码块在同一代码框中额外显示 `<code>` 与 `</code>`；复制结果也包含这两个标签。 |
| 触发条件 | 原站正文使用合法 `<pre><code>…</code></pre>`。完整页面抽取后，sanitizer 以 `blockTextElements.pre=true` 重新解析正文并把 `<code>` 包装保存在单个 TextNode 中；production compiler 直接复用该 root。 |
| 根因 seam | 通用整页 parser 的 raw-pre 性能策略泄漏进论坛正文 Module；direct compiler 另行打开 `parsePreContent`，导致同一正文存在两套 AST。重新编译序列化 HTML 的测试使用了正确 AST，因而掩盖 production prepared plan。 |
| 必须保持的行为 | 整页 `parseHtml` 继续保留 raw-pre 行为；`parseForumContentHtml` 固定解析 pre/code/span/br 子树，sanitizer 与 direct compiler 只使用该正文 Interface。普通和高亮代码保持单一 typed owner，`text/copyText/runs` 只含可见代码；合法实体仍显示为字面文本，真实 script/style/noscript 继续被 sanitizer 移除。正文 root 只 parse 一次，不改变 ANSI、NodeSeek magic tabs、table、引用、投票或 renderer。 |
| 精确失败 oracle | `src/sources/nodeseek/reader.test.ts` 的 `[REG-TOPIC-110]` 通过 `getNodeSeekTopic → preparedContent → requirePreparedForumContent` 输入目标五行结构。旧实现稳定得到带 `<code>` 的 `text/copyText/runs`；修复后只有一个 code row，三者精确等于五行文本，同时 `topic.contentHtml` 保留 `<pre><code>`。相关 source contract 直接读取 prepared plan，不再调用 `compileForumContent(topic.contentHtml)`。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定真实 reader/prepared seam 与 parse 次数；既有 code owner RNTL 固定单一代码框和复制入口；只有匹配 APK 的目标页能证明最终显示与剪贴板内容。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装匹配 APK 并确认 `firstInstallTime` 不变；canonical deep link 直达 `https://www.nodeseek.com/post-879597-1`，核对一个五行代码框、零字面标签和精确复制文本后返回。目标为动态第三方内容，不新增 tracked Replay，不执行发帖、回复或其他原站写操作。 |
| 负向验证方式 | 把 `pre: true` 放回正文 parser、让 sanitizer 改用整页 parser，或把 source contract 恢复为序列化后重新编译；编号测试必须重新出现字面标签或漏记 production parse。给 renderer/`normalizedCodeRuns` 加剥标签规则、按 NodeSeek 分支、设置 `code: true` 或引入第二次 parse 均不满足本条。 |
| 明确不覆盖范围 | 不迁移到 parse5/htmlparser2，不升级 `node-html-parser`，不改变完整页面解析、code row 数据结构、视觉样式、代码分块预算、终端报告或其他来源线上内容。其他三站共享 seam 由自动测试覆盖；没有对应真实线上样本时设备状态记 `NOT_VERIFIED`。 |

## `REG-TOPIC-111` 收起结构化正文后标题停止绘制

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 details、Callout、主楼与回复的 continuation Frame seam |
| 用户症状 | App 只读打开 linux.do `t/topic/2769371` 的“注册地址” details 或 `t/topic/2769388` 的“Quote” Callout，展开后再收起会留下圆角背景框，但标题、图标和箭头像素全部消失；accessibility tree 中对应标题仍存在。 |
| 触发条件 | Android rounded `overflow: hidden` Frame 从展开的 `first` 状态切换到收起的 `only` 状态；共享 helper 返回空样式，使前一帧存在的 `borderTopWidth` / `borderBottomWidth` 从 Native props 中移除。 |
| 根因 seam | `src/features/topic/components/TopicContentBlock.tsx` 的 `continuationFrameStyle`。`only` 状态没有输出完整边框几何，React Native Android 将被移除的 per-edge width 解析进 rounded clip path 后裁掉全部子节点。 |
| 必须保持的行为 | `only/first/middle/last` 都输出确定的 Frame 几何；收起只改变正文可见状态，标题、图标和箭头继续绘制。details 与 Callout 的正文过滤、展开状态、圆角、间距、裁剪和 accessibility state 不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-split-disclosure.test.tsx` 的 `[REG-TOPIC-111]` 通过真实 `TopicContentBlock` 分别渲染默认展开的 details 与 Callout：展开时 top=`hairline`、bottom=`0`；点击收起后 title 与 `expanded=false` 保留，且 top/bottom 都必须显式为 `hairline`。修复前收起 Frame 只有基础 `borderWidth`。设备验收动态读取标题 bounds，并要求同一区域收起截图中的非背景标题像素不为 `0`。 |
| 最低可靠自动测试层 | `UI_PASS + LIVE_PASS`：RNTL 固定共享 helper 到两个真实 header renderer 的 Native style contract；只有匹配 Android APK 的像素 oracle 能排除 accessibility 假绿并证明 rounded clip path 正常。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；直达 `https://linux.do/t/topic/2769371` 与 `https://linux.do/t/topic/2769388`，对“注册地址”和“Quote”各执行至少两轮展开→收起，对比动态 accessibility bounds 内的非背景像素，同时确认正文按状态挂载/卸载。不新增 Replay，不执行站点写操作。 |
| 负向验证方式 | 让 `only` 分支重新返回空样式，编号测试必须精确缺少两个 edge widths；匹配 APK 上收起后的标题区域重新变成零像素。若 edge widths 保留而像素仍为零，否定本方案并转查实际 Native props 与 clip geometry，不叠加 workaround。 |
| 明确不覆盖范围 | 不审计全 App 动态边框，不修改 parser、compiler、disclosure store、FlashList、`selectable`、React Native、依赖或原生目录；不增加 Android/URL/站点特判、重挂载 key、延时、透明度或 `overflow: visible` 补丁。 |

## `REG-TOPIC-113` linux.do 可读详情被分类策略替换成权限页

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01` |
| 用户症状 | App 原生详情打开 linux.do `t/topic/2777081` 时，标题、作者和回复数已经加载，却把真实正文替换成“需权限 / 暂无权限”；同一 App 内原站、同一账号和同一 URL 实际可读。 |
| 触发条件 | linux.do 返回 200，`post_stream.posts[0].cooked` 可解析为有效主楼正文，同时响应内分类带 `read_restricted=true`；共享 Topic 归一化把分类访问策略复制到详情的 `accessRequirement`。 |
| 根因 seam | `src/sources/linuxdo/reader.ts` 的 `getLinuxDoTopic` 成功详情边界。分类策略描述对象访问规则，真实拒绝只由请求错误分支表达；两者不能在已成功解析正文的 `TopicDetail` 中同时成立。 |
| 必须保持的行为 | linux.do 详情成功解析主楼后明确清除 `accessRequirement`，正文、回复、媒体和来源元数据照常返回；HTTP 403、权限错误文本和“受限帖子”失败分支继续生成权限页。共享 `accessRequirementFromObject`、Feed、搜索、分类、历史列表和公共类型不变。详情权限卡片只给内部“需权限”标签增加 `marginBottom: 4`，标签到标题为 `12dp`、标题到说明仍为 `8dp`，其余视觉不变。 |
| 精确失败 oracle | `tests/integration/source-access-requirements.test.ts` 的 `[REG-TOPIC-113]` 通过公开 `getLinuxDoTopic` 输入 200、`read_restricted=true` 分类、有效主楼与回复；旧实现保留正文却返回 `{ type: 'permission', label: '需权限' }`，修复后正文仍存在且 `accessRequirement` 为 `undefined`。既有“turns linux.do permission errors into restricted topic details”固定真实 403 分支。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Vitest 固定来源 adapter 成功/拒绝分流，既有 RNTL 固定权限提示仍可渲染；只有同账号的 App 内原站与原生详情对照能证明动态目标当前可读。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；canonical deep link 直达 `https://linux.do/t/2777081`，确认原生正文与 1 条回复出现且无“需权限/暂无权限”。随后严格经“更多 → 账号中心 → linux.do → 检测或重新登录”在 App 内 WebView 打开原网址 `https://linux.do/t/topic/2777081`，核对同一标题、主楼和第 2 楼。全程只读，不用 Chrome，不新增 tracked Replay。 |
| 负向验证方式 | 删除详情成功结果对 `accessRequirement` 的覆盖，或再次把分类 `read_restricted` 投影到成功详情，编号 Vitest 必须重新收到 permission；让 403 分支也被清除则既有拒绝测试必须失败。 |
| 明确不覆盖范围 | 不改变 Feed、搜索、分类、历史列表的权限标签，不拆分公共 `AccessPolicy` / `AccessDenial` 类型，不按帖子 ID、分类、用户名或等级特判，不隐藏权限组件，也不改变卡片 padding、外部间距、文案、颜色、字号、圆角或其他页面样式。 |

## `REG-TOPIC-114` Android 正文图片首载使用下采样尺寸

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-TOPIC-048/075/085` |
| 用户症状 | process-cold 打开含长图的主题时，图片先显示 `4:3` 占位，加载完成后错误缩到约 `342px` 高；退出再进入才按约 `898px` 的真实比例显示。多图片正文中的每张冷图都可能独立命中。 |
| 触发条件 | Android Expo Image 以目标 View 尺寸让 Glide 下采样解码；正文把 `onLoad.source.width/height` 当作自然尺寸并按完整媒体 identity 缓存。 |
| 根因 seam | `expo-image` `GlideRequestListener` 把下采样 Drawable 的 `intrinsicWidth/intrinsicHeight` 作为事件尺寸，忽略 `ImageViewWrapperTarget` 在同一次 Glide downsample 已记录的 EXIF-upright source width/height。自然尺寸的 owner 应是 Native 解码边界，不是 JS renderer 的比例猜测。 |
| 必须保持的行为 | source width/height 均有效时作为现有 `onLoad.source` 尺寸；任一无效时整体回退 decoded intrinsic。事件字段形状、正文 renderer 状态、媒体 request identity、下采样和 disk cache 不变；单图与多图各 identity 只更新自己的几何，冷图最多一次必要列表布局提交，重复回调、离窗重进和重挂载不增加提交、请求或 Native owner。真实窄图、小图、表情、SVG fallback、正文原图升级和全屏预览继续使用自身语义。 |
| 精确失败 oracle | `expo-image` Release Kotlin unit test 输入 source `1000×5000` 与 decoded `68×342`；旧实现返回 `68×342`，修复后返回 `1000×5000`，无效 source 尺寸继续返回 decoded。`tests/ui/topic/topic-image-loading.test.tsx` 的 `[REG-TOPIC-114]` 乱序结算四种比例并固定 identity 隔离和布局提交计数。 |
| 最低可靠自动测试层 | `UNIT_PASS + UI_PASS + LIVE_PASS`：Native unit 固定事件尺寸所有权，RNTL 固定多图消费者契约；只有匹配 APK 的 process-cold 当前主题与 linux.do 多长图目标能验证真实 Glide/Expo/FlashList 链路。 |
| Replay 或真实验收路径 | 用 `adb install -r` 或受允许的 agent-device install 在主 AVD 覆盖安装，安装前后 `firstInstallTime` 必须相同。process-cold 打开当前“今天是不是都有活动，帖子都少了”页面，加载完成后首次停留即达到与重进相同的最终宽高；再只读打开 `https://linux.do/t/topic/2556285`，核对前四张普通正文图首次加载、滚离返回和退出重进各自比例稳定，无第二轮请求波、空白或尺寸串用。 |
| 负向验证方式 | 恢复 listener 直接使用 decoded intrinsic，Native 编号测试必须重新得到 `68×342`。若匹配 APK 的 Native 事件仍不是原始 upright 尺寸，或同 identity 出现第二次列表布局提交/额外请求，否定当前实现并回查 Native target；不得添加 JS probe、宽高启发式、站点/URL/多图特判、timer、retry、强制 key 重挂或第二套缓存。 |
| 明确不覆盖范围 | 不升级 Expo/Glide，不关闭 downscale，不增加请求、解码、异步步骤或运行时状态；不修改图片事件字段、正文 renderer 状态结构、FlashList 调度、图片缓存模型、表情布局、SVG renderer 或全屏缩放实现。 |

## `REG-TOPIC-115` linux.do 已删除主楼被误判为解析失败

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01`；关联共享 Discourse 删除回复过滤 |
| 用户症状 | App 原生详情打开 linux.do `t/topic/2780439` 时显示“主题正文解析失败”，而 App 内原站同一 URL 已返回并展示“（话题已被作者删除）”。 |
| 触发条件 | linux.do 返回 200，`post_stream.posts[0]` 存在且 `user_deleted=true`、`deleted_at=null`、`cooked` 含可渲染删除占位。 |
| 根因 seam | `src/sources/discourse/model.ts` 的共享 `discoursePostFields` 把删除回复的可见性规则同时当作主楼字段解析有效性；放行后又用 `hasRenderableHtmlContent` 预检媒体-only `cooked`，使 linux.do reader 在正式 compiler 前多做一次 DOM parse。 |
| 必须保持的行为 | 仅 linux.do 主楼显式允许可渲染的作者删除占位并返回普通 `TopicDetail`；可渲染性由 `prepareLinuxDoContent` 已有 sanitizer root 判断，reader 复用同一 prepared result，标题、正文和 `preparedContent → TopicContentList` 单路径不变。`deleted_at` 非空或 `cooked` 不可渲染时仍失败，删除回复和其他默认调用方继续过滤；一次读取只有一次 fetch 和一次正文 DOM parse。 |
| 精确失败 oracle | `src/sources/linuxdo/reader.test.ts` 的 `[REG-PERF-017][REG-TOPIC-115]` 输入真实文本删除主楼结构，返回原标题与删除占位；media-only fixture 在旧实现稳定得到 marker DOM parse `=2`，修复后为 `=1` 且 prepared plan 含可见 row。空 `cooked` 反例继续抛出同一解析错误。`src/sources/discourse/model.test.ts` 固定默认调用拒绝、经已验证 caller 显式允许，以及允许时非空 `deleted_at` 仍拒绝；`tests/integration/source-read-contracts/discourse.test.ts` 继续固定删除回复不出现。 |
| 最低可靠自动测试层 | `UNIT_PASS + LIVE_PASS`：Vitest 固定来源 adapter 的接受边界、解析次数与默认回复过滤；只有匹配 APK 的 App 内真实来源能确认动态响应仍含可渲染占位并沿原详情 UI 显示。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；只恢复一次 canonical deep link `https://linux.do/t/topic/2780439`，应显示原标题和“（话题已被作者删除）”，不得出现解析失败或重试页。若自然出现普通 Cloudflare checkbox，仅按语义点击一次；动态帖子不新增 tracked Replay。验收后恢复 Feed 和账号 `3/3`。 |
| 负向验证方式 | 移除 linux.do 主楼显式选项，正例必须重新抛出解析错误；放宽可渲染约束，空 `cooked` 反例必须错误变绿；把选项传给回复归一化，既有删除回复 contract 必须失败。真实响应若不再含可渲染 `cooked`，或 parser 已返回合法详情但 UI 仍失败，则否定当前 seam 并重新定位，不预加 UI 状态。 |
| 明确不覆盖范围 | 不改变 `TopicDetail`、React state、Query key、controller、组件、网络或重试流程；不扩大到其他来源或删除回复，不伪造字段、不增加删除页面、状态机、第二次解析、第二个 render owner 或易失效 Replay。 |

## `REG-TOPIC-116` linux.do emoji 枚举被回收后重进先显示英文 ID

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/03`；关联 `NOTIFY-02`、`WRITE-01` |
| 用户症状 | linux.do 详情已显示贴图反应后，离开一段时间再进入会先显示 `heart 1` 等英文 ID，随后才替换成贴图，看起来像每次都重新请求。 |
| 触发条件 | emoji Query 的全部 observer 卸载并超过默认 inactive GC 窗口，随后再次进入详情、回复编辑器或私信编辑器。 |
| 根因 seam | Query 只有 `staleTime=Infinity`，但 inactive data 仍会被 GC；来源 adapter 的 module cache 虽能挡住第二次 HTTP，却仍通过异步 loader 返回，使 React 先消费空 map、再提交真实 map。 |
| 必须保持的行为 | linux.do 每个 App JS 进程内按 Query key 缓存；每个 App JS 进程首次成功结果由现有 TanStack Query 保留，普通页面卸载不回收，重进首帧直接复用同一 map 且 loader 总计一次。首次失败没有 data，后续挂载或详情刷新仍可重试；进程终止和既有账号/来源显式重置继续失效。不得新增 Context、store、状态机、持久化、预取或第二套缓存。 |
| 精确失败 oracle | `tests/ui/topic/topic-reply-filters.test.tsx` 将默认 GC 压缩至 `1ms`，首次成功后卸载并跨过 GC；旧实现重挂首帧为 `heart 1`，修复后首帧已包含原图片 URL 且 loader=1。该文件另固定首次失败后重挂 loader=2 并恢复；`tests/ui/notifications/notifications-route.test.tsx` 固定私信编辑器同类生命周期。 |
| 最低可靠自动测试层 | `UI_PASS + APK_SANITY + LIVE_PASS`：RNTL 精确固定 loader 次数和首帧映射；匹配 APK 只读确认真实详情视觉生命周期。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装并确认 `firstInstallTime` 不变；canonical deep link 直达 `https://linux.do/t/topic/2693802`，同一 PID 首次加载后离开详情超过旧默认 GC 窗口，再进入时不得闪英文 ID。随后只用 `force-stop` 制造新 PID，process-cold 允许重新获取一次；不新增依赖动态时序的 tracked Replay。 |
| 负向验证方式 | 移除任一生产消费端的 `gcTime=Infinity`，对应 RNTL 在压缩 GC 后必须重新出现空 map 首帧或额外 loader；若 Query data 仍在但真实 App 仍闪英文 ID，则否定当前 seam 并定位主动 remover 或 prop identity，不叠加缓存。 |
| 明确不覆盖范围 | 不修改 NodeSeek sticker、正文 `<img class="emoji">`、图片字节缓存、reaction 算法、全局 QueryClient 默认值或账号清理协议；不追求 React 内部绝对 render 次数，只消除本次空 map → 真实 map 导致的额外提交。 |

## `REG-TOPIC-117` 密集 inline Expo Image 子树造成停手补帧

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03`、`REG-PERF-010/020` 与 `REG-TOPIC-055/085/091` |
| 用户症状 | linux.do `t/topic/342888` 的大量 emoji 与文本混排区域在每次短滑停止后仍会细微补走最后一段，看起来像图片销毁后修正了列表位置；同页展开引用时还容易把既有两阶段完整挂载误判成同一问题。 |
| 触发条件 | 每个 inline emoji 都由独立 `ExpoImageViewWrapper` 加子 View 承载，父 FlashList 的 `40` 项回收池继续保留离屏富文本子树；90Hz 下 RenderThread 与 buffer queue 的迟帧会把最后一次输入位移延后呈现。Android trace 未观察到 `ACTION_UP` 后内容 offset 修正或图片高度坍缩。 |
| 根因 seam | `ManagedInlineForumImage` 是四站正文 inline 图片的唯一共享显示边界。当前 App 开启 New Architecture，`RCTTextInlineImage` 在 Fabric 映射到标准 `Image` attachment；旧 ReactAndroid Fresco text span 不是运行时 seam。RN `0.81.5` 的 `node_modules/react-native/Libraries/Image/Image.android.js` Text 分支又漏掉标准图片事件，若用 `getSizeWithHeaders` 结算 coordinator 就形成第二个不可取消的完成事实。修复后 App 直接声明一个 Fabric attachment，最小版本锁定 patch 只转发既有 `loadStart/progress/load/error/loadEnd`；请求、解码、GIF 与卸载取消继续由标准 Native Image owner 负责。Fresco cache key 不包含 headers，故显示 URI 仍以 opaque request identity 的稳定 hash fragment 分区；fragment 不进入 HTTP 请求，真实 URL 与凭据保持原协议。 |
| 必须保持的行为 | 所有来源、主楼、回复和已展开引用的 inline 图片统一使用同一实现，不按帖子、站点或图片数量特判。每个 inline token 始终占有同一个 Fabric attachment；未获 permit 时 source 为空、几何不变、零请求，获准后才建立唯一 Native Image owner，不得退回 Expo inline View。图片数量、顺序、比例、文本流、自动加载、animated GIF、失败重试及引用头像右侧留白不变；running `<=4`、warm window、runtime rotation、Referrer/header 与 session epoch 隔离继续生效。`attemptId` 只 remount attachment，不进入 URI；迟到事件不得结算新 attempt。FlashList `drawDistance=720`、回收池 `40` 和完整正文不变；块级图片、原图升级、预览、SVG、GIF sticker、视频与链接卡片继续走各自现有 renderer。引用同帖缓存、跨帖一次请求、收起重开复用缓存及 `REG-TOPIC-055` 的两阶段完整挂载不变。 |
| 精确失败 oracle | `tests/ui/topic/topic-image-loading.test.tsx` 的六个 `[REG-TOPIC-117]` 用例固定：inline emoji 零 Expo owner、零 `getSizeWithHeaders`，五个 token 中仅前四个有 source；progress 不释放 permit，前四个 attachment 的真实 load/error 发生前第五个不得获准请求；error 与首次 timeout 必须以相同 URI remount，旧 attempt 的迟到 load 无效，同值父 rerender 不 remount；media session identity 改变时 fragment 改变而 HTTP URL 保持。`tests/tooling/react-native-inline-image-events-patch.test.ts` 固定 RN Text 分支转发标准事件且 patch 不包含 `ReactAndroid/`；`src/ui/list/performance.test.ts` 继续固定回收池为 `40`。 |
| 最低可靠自动测试层 | `UI_PASS + UNIT_PASS + STATIC_PASS + APK_SANITY + LIVE_PASS`：RNTL 固定 owner、事件、预算与 identity，tooling unit 固定最小 RN JS patch；只有匹配 AAR Release APK 的真实事件到达、Android hierarchy、input timestamp、FrameTimeline 与 `gfxinfo` 能证明完整链路和停手末段不再因旧 Expo 子树迟帧。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装且 `firstInstallTime` 不变，只读直达 `https://linux.do/t/topic/342888`。同一 90Hz AVD、同一内容位置和同一短滑手势采集 Android input timestamp、FrameTimeline 与 `gfxinfo`；warm 连续短滑要求 p95 `<=25ms`、worst `<=35ms`、无连续两帧 miss，且 `ACTION_UP` 后无可见内容 offset 变化。hierarchy 中 inline 图片不得恢复 `ExpoImageViewWrapper` owner；真实块级媒体与头像等既有 Expo Image 不在此限制内。再只读核对普通多图帖 `https://linux.do/t/topic/2556285`、跨帖引用 `https://linux.do/t/topic/2685882` 与妖火 animated inline GIF；海量图片帖不因本项调整回收池，按既有 `REG-PERF-010/020` 自动与专项门槛独立验收。 |
| 负向验证方式 | 恢复 inline `ExpoImage`、恢复 `getSizeWithHeaders` 或其他完成探针、绕过四并发 coordinator、让两个 session 使用相同 Fresco URI、把 `attemptId` 写进 URI，或用缩小回收池、固定图片高度、关闭图片、缩短正文、降低 drawDistance、位置锚定、父层 hardware layer、删除引用两阶段渲染或帖子/站点特判掩盖症状；编号用例或对应设备门槛必须失败。 |
| 明确不覆盖范围 | 不承诺模拟器系统进程造成的绝对零掉帧，不修改引用 Controller/Model、产品公共类型、依赖、ReactAndroid、原生构建方式或数据迁移。引用只有在同帖零请求、跨帖一次请求或缓存重开行为出现具体失败时才另行修复。 |

## `REG-TOPIC-118` 独占一段的用户 mention 背景和边框被拉伸成整行

| 字段 | 内容 |
| --- | --- |
| 用户可见症状 | 正文中独占一段的 `@用户名` 显示为从正文左侧延伸到右侧的浅色圆角框；同屏 mention 后仍有正文时，框只包住文字。 |
| 触发条件 | 段落只有一个 `a.forum-user-mention` 子节点。RNRH 在匿名 TPhrasing 只有一个子节点时绕过该 wrapper，使 mention `Text` 直接成为 block renderer 的子节点。 |
| 根因 seam | Android/Yoga 默认会拉伸 block 容器中的直接子节点；mention 自带背景、边框和内边距，因此拉伸宽度被完整绘制。混排时 mention 嵌套在外层 `Text` 中，不进入该布局路径。共享 `forum-user-mention` 样式是全部正文入口的最小根因 seam。 |
| 必须保持的行为 | 主楼、回复和已展开引用继续共用同一 mention 样式；背景、边框、圆角、内边距、字重、颜色和链接跳转保持不变。混排 mention 继续贴合文字；RNRH 全局匿名 TPhrasing bypass 保持开启，不增加站点、帖子或内容数量分支。 |
| 精确失败 oracle | `src/features/topic/rendering/htmlStyles.test.ts` 的 `[REG-TOPIC-118]` 用例固定 mention 必须声明 `alignSelf: flex-start`，并同时固定背景存在、`borderWidth=1`、水平内边距 `5`、垂直内边距 `1`。修复前该用例因缺少 `alignSelf` 连续稳定失败，加入共享样式的一行约束后通过。 |
| 最低可靠自动测试层 | `UNIT_PASS + STATIC_PASS`：样式单测固定根因约束与既有视觉属性；完整 Android 布局仍需匹配 APK 的只读设备验收。 |
| Replay 或真实验收路径 | 在匹配 APK 中只读打开含两类 mention 的同一正文位置：一类是段落唯一内容，另一类后接普通文本。前者边框必须贴合文字宽度，后者外观不得变化；链接点按可在单独无写入旅程中核对。 |
| 负向验证方式 | 移除 `alignSelf: flex-start` 时编号单测必须失败，匹配 Android APK 中 standalone mention 必须重新出现整行框。不得以删除背景/边框、全局关闭 TPhrasing bypass、自定义 renderer 或站点特判隐藏症状。 |
| 明确不覆盖范围 | 不重设计普通链接、回复目标、用户名颜色或 mention 文案，不处理模拟器 Watchdog/系统进程卡死，也不把该布局问题归因于 inline 图片 span。 |

## `REG-TOPIC-119` Fabric inline emoji 明显高于同一行文字

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` 与 `REG-TOPIC-117` |
| 用户可见症状 | inline emoji 已加载且尺寸正确，但在同一行中明显偏上；linux.do `t/topic/342888` 的 `#110` 中，同一 mask 下表情彩色内容中心比“是这样嘛”文字中心高 `11.5px`，底边低差也不自然。 |
| 触发条件 | 从 Expo inline View 迁移后删除了旧的 `transform.translateY`，并把补偿错误地下沉到 legacy Fresco text span。当前 New Architecture 实际运行 Fabric Image attachment，旧 span patch 和自定义 `verticalOffset` 不会被消费；同一 APK 前后截图因此完全不变。小于正文行高的 `20dp` emoji 最明显。 |
| 根因 seam | 四站正文都由 `inlineForumImageAlignmentStyle` 得到同一正文 `lineHeight` 与图片显示高度，返回值直接进入 Fabric attachment style。恢复既有 `translateY=max(0, (lineHeight-imageHeight)/2)` 就能由真实运行时消费；大于行高的 sticker 返回零位移，避免裁切。不增加 Native patch，也不按素材、帖子或站点维护偏移常量。 |
| 必须保持的行为 | 主楼、回复和已展开引用的 inline emoji、引用头像及 inline sticker 继续共用同一 Fabric attachment；尺寸、比例、水平 margin、目标尺寸解码、GIF、标准加载事件、四并发 permit、失败重试、取消和 cache identity 不变。块级图片、预览、reaction 图标与列表回收池不受影响。 |
| 精确失败 oracle | `src/platform/media/inlineMedia.test.ts` 的 `[REG-TOPIC-119]` 要求 `26dp` 正文行内的 `20dp` emoji 产生 `transform: [{ translateY: 3 }]`，`48dp` sticker 不位移，`24dp` 引用头像继续保留 `marginRight: 6` 并下移 `1dp`。匹配 AAR Release APK 的 `#110` 同一 mask 对照中，修前 emoji/text center delta 为 `11.5px`、修后为 `4px`；较大 `#112` emoji 完整显示且未裁切。 |
| 最低可靠自动测试层 | `UNIT_PASS + APK_SANITY`：Vitest 固定共享对齐公式与大贴图边界；只有匹配 AAR Release APK 能证明 Fabric 实际消费 transform，以及字体、density、行高与素材共同作用后的视觉结果。 |
| Replay 或真实验收路径 | 主 AVD 保留数据覆盖安装且 `firstInstallTime` 不变，只读打开 `https://linux.do/t/topic/342888` 并定位 `#110`；表情底边需与“是这样嘛”的文字行自然对齐。再只读核对普通 inline emoji、引用头像、animated inline GIF 和至少一种较大 inline sticker，确认没有向下溢出、裁剪或行高跳变。 |
| 负向验证方式 | 删除 JS `transform` 计算、改回 Fabric 不消费的 `marginTop`，或再次把偏移下沉到 legacy span 时，编号测试或匹配 APK 中 `#110` 必须重新出现 `11.5px` 左右的明显上偏。不得增加素材偏移表、帖子特判或切回独立 Expo Image View。 |
| 明确不覆盖范围 | 不修正图片文件自身透明画布或站点素材设计，不改变 reaction emoji、系统字体、正文行高设置或块级 sticker 排版。 |

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
