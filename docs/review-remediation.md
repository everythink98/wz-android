# 2026-09-16 代码审查修复取证记录

本文记录本次修复与验证，不替代产品地图、架构说明和维护手册。原始基线为 `c89787f13e2c0862179edbd1694b87c750a99dfd`，叠加开工时 15 个未提交文件；保留原修改，不提交、发布或上传。日志、原送审包和设备资料仅在本机 ignored 目录保存。

## 2026-09-20 持续复审与性能核对

基线仍为 revision `69cdedf94392ba2570459492cb7dfdad33f27545` 叠加完整已有 WIP。沿用全仓906个文件清点，按来源/领域、平台/Native、页面/生命周期三个独立方向检查真实调用链，再交叉复核本轮修改。860个代码、测试、脚本、补丁及 CI/Replay 文件中，本轮只改变6个生产文件、6个既有测试文件和1个既有设备 proof，其余847个文件与开工哈希一致。文件清点不等同所有分支、来源和设备的穷尽证明。

本轮新确认并修复6项，最后交叉复核没有新增可确认问题；既有 OPEN 事故不因此关闭。格局判断落实为减少重复工作、明确数据和异步结果的归属，保留完整数据语义，不引入新的缓存层、依赖、框架或通用抽象。

| 能力 / 事故 | 根因与实际改动 | 修复前失败与修复后证据 |
| --- | --- | --- |
| `DATA-02`、`LIBRARY-01/02/03` / `REG-PERF-026` | SQLite 清理逐条跨 JS/native 边界读写。复用已读 key/bytes，按50条批量读写，仍按原命令顺序分配 ordinal、维护字节数和 tombstone。 | 清5000条历史的 SQL 调用从28008降至488（减少98.26%）；50/500条分别从207/2007降至11/47。复杂度仍为 O(n)，收益是边界调用和 SQL 数量下降。现有 owner 普通红转绿，旧/新真实 SQLite 对三个 collection 的逐指令差分一致。 |
| `TOPIC-02` / `REG-PERF-027` | 正文图片提取对每层 block 再遍历其所有后代。祖先扫描在已有独立 owner 的嵌套 block 处停止。 | 深度30/60/120/240的 tag 访问由1485/5670/22140/87480降至209/419/839/1679，退化路径由 O(n²) 收敛为 O(n)。500个固定 seed 混合树的 HTML/preview 输出逐值相同；240层桌面交错采样中位6.366→0.927ms，不冒充设备帧耗时。 |
| `WRITE-01/04/05`、`NOTIFY-02` / `REG-WRITE-093` | 旧编辑文档的上传或模板异步结果在新稿 INIT 后仍可修改内容、错误和 busy 状态。统一取消 host action，并用文档 generation 丢弃旧结果。 | rich/source 模式均先复现旧图污染新稿。交叉复核又发现相同 upload:// 图片复用旧 NodeView 的 sibling；新稿同步替换节点且抑制中间事件，同稿切换保持图片节点。真实 Tiptap/CodeMirror owner 62项通过，关闭/重开宿主链64项通过。 |
| `USER-01` / `REG-USER-016` | V2EX 活动链接的 replyN 是主题回复数量，被误当单条回复身份和楼层，controller 会吞掉不同活动。 | 使用对应完整正文、主题、页码、日期与同身份 occurrence 形成短指纹，取消伪造楼层；补齐原站相邻正文结构。已保存匿名原站样本的12行活动全部保留，当前最终 parser 回放通过。原站无永久 reply ID，跨页移动的完全相同回复仍受协议限制。 |
| `TOPIC-02` / `REG-TOPIC-182` | 表格拆分只重建 tr，合法 caption 被丢弃。caption 内容复用现有 semantic row 编译。 | 文字、链接、媒体、selection 顺序和分表均有普通行为断言；交叉复核修复 caption/cell 内 typed poll 触发重复编译的 sibling，确保内容、预览与 poll 各一次。 |
| `USER-01` / `REG-USER-017` | Discourse summary 不保证带目标 profile，关联 users 又可包含颁发徽章者；取 users[0] 会改错后续查询身份，无 profile 的合法响应会被拒绝。 | 移除任意用户 fallback；合法 summary 使用请求身份，缺失 profile 字段保持未知，空坏响应仍失败。真实 reader→topics/replies 链始终查询原用户。协议依据为官方 [UserSummarySerializer](https://raw.githubusercontent.com/discourse/discourse/main/app/serializers/user_summary_serializer.rb) 和 [UserBadgeSerializer](https://raw.githubusercontent.com/discourse/discourse/main/app/serializers/user_badge_serializer.rb)。 |

测试继续并入原 canonical owner，没有新增测试文件或框架。工作量计数约束真实 SQLite 调用和 parser 遍历，不以不稳定的毫秒阈值作为普通单测门禁；独立旧/新实现差分与性能探针仅留在 ignored 目录。编辑器沿用原宿主关闭/重开测试增加 busy 条件，没有复制页面算法；两个临时 undo 探针通过后不另立重复 owner。本轮没有证据支持继续整批删除现有测试，已有真实编排/产物/UI owner 尚未完全替代的源码断言继续保留。

定向验证包括来源/内容6个 owner 共260项固定与随机顺序通过（seed `20260920` / `1789874522616`），ReaderStore 32项固定及组合76项随机通过（seed `1789873564739`）。编辑器62项固定与随机通过（seed `20260920` / `1789889912741`）；一次与 Gradle 并发的随机运行触发既有500-details用例5秒超时并造成 act 连锁，保存失败日志，停止并发构建后按同一 seed 完整重放通过，没有提高 timeout 或缩小样本。caption 的一次中间 oracle 曾错误地把 src 和 metadata 中相同 URL 当成重复节点，改为实际节点、预览和 selection 断言；该失败日志不算通过证据。

最终源码冻结后的验证：

| 证据层 | 本轮实际范围 |
| --- | --- |
| `STATIC_PASS` | Node22.23.2 下 `npm run typecheck` 和单次最终 `npm run verify` 均退出0；lint、格式、架构、文档、unused、版本全部通过，架构工具25项、文档工具29项。文档收口后另核对引用和 `git diff --check`。 |
| `UNIT_PASS` | Vitest 211文件、2771项，seed `1789874587336`；另有 `npm run test:native:forum-selection` 的27项 JVM 测试通过。 |
| `UI_PASS` | Jest 79套件、1652项，seed `-885599725`。12条既有 act 告警保留，没有屏蔽 console。 |
| `DEVICE_REPLAY_PASS` | 隔离 API35 Release Hermes 的真实 SQLite seed/迁移/新进程核对/exercise 完成，清5002条旧超额历史约795.073ms，其他 collection、删除标记与字节数保持正确；无旧版同设备耗时对照，不宣称设备提速倍数。checkpoint 六文件 hash 与逻辑快照恢复。最终普通 APK 的 account-readonly、search-multi-source 各一次通过，零自动修复；允许错误分支的 Replay 不代表所有原站读取成功。 |
| `APK_SANITY` | 普通 index.ts 入口、开发签名 Release Hermes x86_64 构建成功（2m18s），版本仍 `1.3.147/151`。SHA-256 `93dc6c74a5f0e7f976920183598f6818450a588e153eeb9421b609b97e9e0746`；同签名覆盖安装，`firstInstallTime=2026-07-26 16:51:37` 不变。当前 PID 的最终错误日志时间窗未见 Fatal、ANR、OOM 或 InvariantViolation，不延伸为全设备全时段保证。 |
| `BLOCKED_BY_ENV` | LinuxDo 用户页原站验证被 Cloudflare 阻挡；按 runbook 在 App 自有 WebView 中只点一次唯一验证 checkbox，再检测状态，仍未恢复可信读取。关闭验证页，不循环重试、不清 Cookie、不旁路取凭据；本轮没有该路径的 `LIVE_PASS`。 |
| `NOT_VERIFIED` | 真实远端上传与 picker 延迟完成、所有来源动态用户样本、Native instrumentation 完整矩阵、物理触感及冷挂 Search 性能未验证。系统文件/云端备份和其他历史 OPEN 分支不借本轮结果关闭。 |

### Search 重复渲染、帧耗时与闪空

`REG-PERF-024` 继续保持 `OPEN`。在主登录态 AVD、相同最终 APK 和同一进程内，预热后执行三批各10次 Feed→Search→Feed，转向前 reset gfxinfo。原始 dump 的 reset 命令输出仍带旧窗口时间，最终按每个 post-dump 的新 Stats since 过滤，基线/候选分别剔除6/4个旧帧；连续 miss 只在单次转向内统计，不拼接不同操作。最终汇总以本轮 ignored 取证文件 frame-summary.json 为准。

| 最终候选批次 | 有效帧 | p95 / worst（ms） | 单次转向最长连续 missed deadline |
| --- | --- | --- | --- |
| 1 | 981 | 23.184 / 33.985 | 35 |
| 2 | 991 | 23.106 / 33.385 | 34 |
| 3 | 968 | 23.220 / 26.268 | 34 |

候选合计2940帧、p95 23.190ms、worst 33.985ms，数值门槛通过，连续两帧不得 miss 的门槛未通过。基线4333帧、p95 23.392ms、worst 44.491ms、最长连续7帧；前后 Feed 内容有变化，样本也包含 Native 动画，不能把这组数据当严格同内容提速对照，尤其不能以较低 p95 掩盖候选更长的连续 miss。

独立20秒 Perfetto 归因样本不混入上述门禁：候选456帧中440为 Prediction Error/Early，1为 Prediction Error + App Deadline Missed/Late，1为 Prediction Error + Buffer Stuffing/Late，12为 Unknown/Early，2为 None/On-time。候选 gfx CPU command submission p95约6.171ms；这些数据不足以将连续 miss 归因于 React，也不足以直接认定只是模拟器问题。

受控 React Profiler 使用真实 AppNavigator、生命周期、SearchRoute/controller，在 Native 边界使用既有替身。10次切换每次4次 Search commit（含2次 nested update）、2次 header update/2次 list render，输入框实例稳定、无重复挂载、无请求、次数不随切换累积。这只能排除该接线下的重复挂载和累积更新，不代表真实 FlashList/GPU；没有据此添加无因果证据的 memo。引用回复路径也已有无限 stale time 和 WeakMap 编译缓存，没有证明新增的昂贵热路。

另一次5次往返录屏独立于性能采样：780帧逐帧检测未出现整块内容闪白，抽样接触表未发现页面闪空。该 oracle 只覆盖整块白屏，不证明没有局部闪烁或全部跳帧。Native selection 复核确认只在 selection active 时订阅 preDraw、按可见/已挂载行投影并复用路径和 offset 缓存；27项 JVM 测试不能替代尚未运行的设备专项。

本轮没有远端写入、卸载、清 App 数据、退出账号或更改版本。搜索恢复空关键词与全部来源，既有历史保留。末尾补读 More 摘要时 agent-device snapshot helper 两次超时，未取得新的账号摘要证据；普通 ADB 读取正常，App 仍为 PID10579，版本与首次安装时间不变，没有按工具提示重启共享 ADB 或模拟器。该末尾工具障碍不抹去此前 Replay/录屏证据，也不能将上轮3/3摘要算成本轮新证据。

本任务 agent-device 会话已关闭，session list 为空；独立存储 proof 模拟器完成 checkpoint 恢复后已关闭。测试、Gradle、FFmpeg、录屏和 Perfetto 进程均结束，设备临时 trace 已取回后移除。保留主模拟器、App、ADB 和共享 MCP；新增的 agent-device daemon PID34968 按 runbook 作为共享服务保留，不强杀。最后代码哈希核对仍仅13个路径变化，文档引用和 `git diff --check` 通过。日志、开工哈希、差分探针、APK、原站样本、trace 和录屏均仅保存在 `.codex-tmp/converge-audit-20260920/`，不提交、发布或上传。

## 2026-09-20 再次全仓审查与修复

范围是 revision `69cdedf94392ba2570459492cb7dfdad33f27545` 叠加全部既有 WIP，重新盘点 906 个受管或未跟踪文件，其中 860 个为代码、测试、脚本、补丁及 CI/Replay 文件。覆盖来源与领域、页面与生命周期、平台、Native 模块、plugins、patches、开发 proof、构建发布及测试治理；排除依赖安装目录、生成目录和 ignored 产物。完整清点后按真实调用链和风险深审，不将文件清点等同逐行、逐分支或所有设备上的穷尽证明。

本轮新确认并修复 5 项，保留此前改动，不提交、发布或递增版本：

| 优先级 / 能力 | 根因与影响 | 修复和最低可靠证据 |
| --- | --- | --- |
| P1 / `DATA-01/02/03` | 来源允许未知发布日期，存储可以保存，但备份 schema 把它当坏记录。导出漏收藏，导入合法空备份还会删除本机记录。 | topic 日期只增加明确未知值，本机操作时间继续严格校验。来源 parser 契约、领域四站矩阵、真实 store/SQLite 导出合并和旧迁移 owner，另有 Android 真实 SQLite proof；`REG-DATA-013`。 |
| P2 / `USER-01` | V2EX 全页链接扫描及从完整 href 取首个数字，导致正文外链或数字用户名制造错误 cursor。 | 只认当前用户/活动路径的分页区和唯一正整数 p，两条真实 reader 入口；`REG-USER-014`。 |
| P2 / `USER-01` | 妖火把同主题同分钟当成同一回复，丢不同正文，controller 合并还会再次丢弃同 id。 | 缺楼层时用完整正文参与身份，无内容重复块单独折叠；保留楼层、跨页重复与摘要截断对照；`REG-USER-015`。 |
| P2 / `SEARCH-02/04` | V2EX 第34页请求 990+30，超过 SOV2EX 1000 条深度窗口，最后10条返回400。 | 稳定偏移、末窗10条、到边界终止、越界零请求；真实搜索链的 HTTP 替身执行[官方限制](https://raw.githubusercontent.com/gexiao/sov2ex/v2/pkg/server/handler.go)；`REG-SEARCH-031`。 |
| P2 / `RELEASE-01` | 正式发布继承开发 ENTRY_FILE，真实 Gradle bundle task 可选中 proof 入口。 | 现有环境净化函数移除开发覆盖，两阶段实际环境断言和真实 Gradle 配置；`REG-OPS-021`。 |

格局判断仍采用“删除错误概念”：未知发布时间不是无效本机记录，分钟时间不是回复身份，总命中数不是可访问深度，开发环境不是发布入口的权威。保留的数据格式、操作时间、账号隔离和去重语义都是真实契约，不为小 diff 放弃它们。没有新增依赖、框架、迁移版本、状态层或通用 parser 抽象。

测试与复杂度收口：

- 新反例全部先以普通行为断言确认失败，再并入既有 canonical owner；不把只在 mock 中可安排的时序算作产品缺陷。DATA canonical 7 红、source canonical 9 红、发布编排 3 红均转绿，原独立审查反例保留在本机 ignored 目录。
- Reader 的旧迁移 owner 参数化已知/未知日期，发布编排 owner 参数化开发路径/空值/Windows 名称大小写；复用原 setup 与有效断言。Android proof 只替换一条样本并增加导出/合并后的数据断言，不新增模式或 runner。
- 第一次完整门禁发现存储测试反向导入 sources，按现有依赖边界改为合法 Topic/UserDetails 输入；真实 parser 未知日期仍由原来源 owner 负责，跨 parser→store 的审查探针保留取证。不新增豁免、重复 SQLite harness 或动态 import 绕过。
- 本轮没有新证据支持安全删除生产模块。原 Release/Smoke 的源码文字断言仍应逐项迁至真实编排/产物/UI owner，不能整批删去尚未替代的合同；media identity 的透传断言可在真正请求输出 owner 补齐后再合并，本轮未以行数或测试数为目标强删。

已经完成的定向证据：DATA 相关 92 项（seed `20260920`），随机 71 项（seed `1789871633921`）；测试归属调整后 storage 30 项再次通过。来源 canonical 93 项（seed `20260920`），五个相关 owner 109 项（seed `1789871928355`），独立探针及真实响应回放 7 项。发布 tooling 70 项（seed `20260920`）。14 个 source patch 的反向适用性检查全部通过，这只证明当前安装匹配补丁，不替代 Native 行为验证。

Android `DATA-01/02/03` 补充在唯一指定的 `WZ_ReaderStorage_API35_20260910` 执行。匹配当前 ReaderData 与 proof 源码的开发签名 Release Hermes 包完成 seed、迁移、新进程完整核对、exercise 导出/合并；未知日期保留，正常日期对照不变。安装签名一致，首次安装时间保持 `2026-09-10 04:04:05`；结束后 checkpoint 的六文件 hash 和独立 SQL 逻辑快照均恢复原值。APK SHA-256 为 `cecee6b0816123407883c689a140dfd098528c467b004b6d78653b0f2115b685`。第一次本机编排因只识别一种 apksigner 输出而停在安装前，改为复用现有 `scripts/apk-signing.cjs` 后复用同一已构建 APK 完成；这不是产品红例，也没有跳过签名核对。

V2EX 仅做两次匿名只读 GET，Livid 的 topics/replies 均 HTTP 200，真实分页区确为 ps_container；将保存响应交给真实 reader 均产生非空活动和下一 cursor 2。这是当前协议样本佐证，不等同数字用户名、同分钟回复或第34页的设备 Live。

通知 pending 的新旧目标交错探针虽红，但模拟完整顺序缺乏实际导航 effect 可达证据；通知 snapshot 倒灌、LinuxDo summary 用户身份也缺实际调用时序或原站样本，均未登记为确认 Bug。既有 OPEN 事故保持原状态，本轮五项已修复不表示仓库此后不会有 Bug，也不代表历史未闭合项已经全部通过。

最终源码对应的集成结果：

| 证据层 | 实际范围 |
| --- | --- |
| `STATIC_PASS` | `npm run typecheck`；lint、格式、架构、unused、版本及文档引用门禁。架构工具25项、文档工具29项通过。完整 verify 首次止于新增测试的依赖方向，修正后重跑；第二次完成所有测试后，文档 checker 要求精确的“当前 owner”字段名，修正四个标签后重跑 check:docs、check:unused 和版本检查，未无故重复已通过的全部测试。因此不声称单次 verify 命令退出0。 |
| `UNIT_PASS` | Vitest 211 文件、2757 项，seed `1789872244148`。新增反例均为普通通过测试；六个既有 canonical test 文件获得边界覆盖，没有新增常驻测试套件。 |
| `UI_PASS` | Jest 79 套件、1652 项，seed `1039619248`。沿用真实 Query/controller 接线，未为 parser/schema 修复复制页面算法。 |
| `DEVICE_REPLAY_PASS` | ReaderStorage 的真实 SQLite seed/迁移/新进程核对/exercise 和 checkpoint 恢复通过；普通入口匹配 APK 的 `tests/device/account-readonly.ad`、`tests/device/search-multi-source.ad` 各一次、零自动修复通过。允许错误分支的脚本不代表原站全成功。 |
| `APK_SANITY` | 普通 index.ts 入口开发签名 Release Hermes x86_64 构建退出0（2m28s），版本仍 `1.3.147/151`，SHA-256 `af9e9189ecb114722ae502db1fc70226fb20c1075471cbee27d6f5cd8edc3554`。同签名覆盖安装至 WZ_Pixel_API_35，首次安装时间保持 `2026-07-26 16:51:37`，网站登录/自动填入仍3/3，普通 App 根入口可用。未执行正式 release。 |
| `LIVE_PASS` | 仅当前匹配 APK 的 V2EX 查询 `AI -zzreaudit20260920` 返回真实结果、进入主题与数字用户名 atreus1891832889 的用户页、显示主题/四条回复、打开条目后返回保留回复页，再返回原查询；另有上文两个匿名原站响应的 reader 回放。 |
| `NOT_VERIFIED` | USER 设备真正跨到第二页、妖火同分钟不同正文的当前原站样本、搜索第34页现场、系统文件选择器/云端备份、物理设备与 Native 专项，以及历史 OPEN 事故未覆盖分支。原站协议边界由普通行为测试证明，不借浅页 Live 关闭全部矩阵。 |

定向打开 Livid 另一主题的 ADB 操作被自动审批拦截，仅返回 `blocked by policy`；未重试或改用另一种直接启动方式。后续沿 App 内已有返回/搜索路径完成只读核对；通用 scroll 没有给出可观察的续页变化，因此不算设备分页通过。本次唯一明确新建的长查询记录已移除，恢复空关键词/全部来源；已有历史不清空。没有原站写入、退出账号或清理 Cookie。

与开工860个代码文件哈希逐项比较，本轮只改5个生产文件、6个既有测试文件和1个既有设备 proof；其余原有代码状态保留。三个事实/取证文档同步本轮契约与证据，未改版本或依赖。本任务两处 agent-device 会话已关闭且列表为空，任务启动的 ReaderStorage 模拟器已关闭；主模拟器、ADB 与共享 MCP 保留。日志、起点哈希、受控反例、原站响应与 APK 只保存在 ignored `.codex-tmp/re-audit-20260920/`。

## 2026-09-20 格局修复：统一请求、分页与导航的最终归属

用户在本轮审查后明确授权修复四项 Bug。基线仍为 `69cdedf94392ba2570459492cb7dfdad33f27545` 叠加完整已有工作区；保留上轮测试治理和用户 WIP，不提交、发布或修改版本。下方审查章节保存修复前事实，四项问题当前状态及关闭证据以 `docs/regression-corpus.md` 为准。

格局判断采用“先定义不可违反的原则，再删除错误概念”：授权归真正发送边界，分页游标归已交付结果，导航归最新有效意图。旧实现的异步授权类型、消费后裁剪、不可推进来源的重试页，以及旧启动目标的覆盖权都不是外部兼容承诺；账号隔离、来源协议、有效重试和完整定位目标则必须保留。

| 改动 | 当前代价 | 消除的问题与证据 |
| --- | --- | --- |
| 通知共享 gateway 复用最终发送守卫 | 前台两种授权 predicate 收紧为同步；后台异步持久化 owner 保持独立。 | 代理准备后已失效的私信、已读和上传零写入；原真实代理反例及六个 adapter sibling 红→绿。 |
| 搜索删除三倍过取和消费后的二次截断 | 概览仍裁两条；空中间页复用既有 cursor 提供手动继续，不自动扫描后页。 | 遵守上游批量限制，不丢合法结果，也不让被排除词筛空的首批结果堵死后续内容；无新结果缓存或跨层状态。 |
| Feed 只让当前可读来源参与 cursor | 计划阻止的来源丢弃旧 buffer，凭据变化通过既有 scope 从新首屏恢复。 | 匿名末页真正终止；真实 controller 验证登录恢复、退出移除，暂时网络失败仍可原页重试。 |
| 深链在同一订阅内接受最新有效目标 | 迟到 cold URL 被明确判 stale；新目标先清除旧 pending。 | 未就绪/已就绪交错及旧队列重放三个红例转绿，无效链接仍保留有效启动目标，无额外全局状态。 |

生产根因改动位于 `src/sources/notificationGateway.ts`、`src/sources/searchRead.ts`、`src/sources/feedRead.ts`、`src/app/useAppDeepLinkNavigation.ts`；搜索空页的可继续状态在既有 Search UI owner 展开，没有新增框架、兼容层或依赖。四个 expected-failure 已转成普通行为测试；共享入口和真实页面接线在既有 owner 内补齐。Search 新接线测试首次类型检查发现缺少 gateway 必需的会话快照，已补显式匿名快照；最后 unused 检查发现一个多余的测试 callback 参数，已删除，没有类型断言绕过。

匹配 APK 的首次只读 Live 发现了只靠合成数据无法揭示的协议缺口：V2EX 同一关键词普通搜索成功，带排除词时因 size 从 30 放大到 90 返回 HTTP 400。[SOV2EX 官方 API](https://github.com/gexiao/sov2ex/blob/v2/API.md) 限制 size 为 0–50，官方 handler 同样校验上限。因此进一步删除三倍过取，保留调用方批量；测试 HTTP 边界加入真实上限拒绝。随后展开首批结果全被排除的真实 Screen 点击链：无自动分页，但可手动读取有效下一页，不增加 filteredEmpty 等跨层字段。

首轮定向证据：通知 Vitest 143 / UI 132，搜索 Vitest 219 / UI 104 均固定和随机顺序通过；Feed 固定 Vitest 112 / UI 49、扩展随机 Vitest 121；导航固定 16、连同导航组合随机 31。通知六个 sibling 及 Feed gateway/controller 的负向控制均能在撤去修复后转红，生产已逐字恢复。独立只读复核确认调用链、取消/401、分页重试/身份恢复、导航清理与最终搜索按钮语义，没有阻断项。搜索协议与空页补齐后，定向 Vitest 219 项（seed `1789869626079`）、UI 106 项（seed `1955610949`）通过；真实 HTTP 两种首批过滤模式分别保留 94、69 条，缓存复用与每次手动继续恰好一次请求均有断言。HTTP 400 和两处 Screen 的修复前普通红仅保存于工具 stdout，没有另存本机日志。

最终源码冻结后，使用 Node 22.23.2 重新运行 `npm run typecheck` 和 `npm run verify`，均退出 0；另重新构建普通 `index.ts` 入口的开发签名 Release Hermes x86_64 APK，没有执行正式发布。

| 证据层 | 最终结果与范围 |
| --- | --- |
| `STATIC_PASS` | lint、格式、架构、类型、unused、版本和文档检查通过；架构工具 25 项、文档工具 29 项通过。最后文档收口再运行引用检查及 `git diff --check`。 |
| `UNIT_PASS` | Vitest 211 文件、2738 项，seed `1789869877993`；包含 `NOTIFY-02` 最终授权、`SEARCH-01/02/03/04` 结果与协议边界、`FEED-01` 计划与游标。四个本轮 Bug 的原 expected-failure 已全部改为普通行为测试。 |
| `UI_PASS` | Jest 79 套件、1652 项，seed `-249183338`；包含真实代理等待、搜索 controller/Screen、Feed 会话恢复和 `NAV-02/03` 交错时序。 |
| `APK_SANITY` | 构建退出 0（2m19s）；包名 `com.wz.reader`、版本 `1.3.147/151`，SHA-256 `ad8cae8aaffca1d514fc414c8b4c150c60c3c6de4a30254219e0467bf473bdd0`。签名与原包一致后覆盖安装到 `WZ_Pixel_API_35`；首次安装时间仍为 `2026-07-26 16:51:37`，网站登录/自动填入仍 3/3。最终验收日志时间窗未检测到崩溃、ANR 或 JS 错误。 |
| `DEVICE_REPLAY_PASS` | 最终 APK 的 `tests/device/feed-source-controls.ad` 14 步、`tests/device/notifications-readonly.ad` 28 步通过，零自动修复；分别证明 `FEED-01/02` 和 `NOTIFY-01` 来源切换、明确 outcome 与只读设置返回，不将允许错误分支的 Replay 当作四站真实数据均成功。 |
| `LIVE_PASS` | `SEARCH-01/02/04`：同一个 `AI -zzgejuexclude20260920` 查询从 HTTP 400 恢复为 V2EX 真实结果，滚动分页看到“已载入 150 条”；不声称读尽原站全部结果。`NAV-02/03`：V2EX 普通无楼层主题 `1229472`，warm 与 process-cold 均显示正确主题，一次 Android Back 回到首页。 |
| `NOT_VERIFIED` | 通知真实发送、已读和上传；主设备匿名 Feed/退出登录；搜索空中间页的原站样本、其他搜索来源；四站真实楼层完整矩阵与设备上精确交错竞态；物理设备和原生专项。相应确定性边界由上述 owner 验证，不把受控 HTTP 或普通主题打开记成这些分支的 Live。 |

最终 UI 输出仍有 13 条既有 act 告警（通知 Route 1、通知 runtime 3、Topic session 5、Topic reply filters 4），以及 Reanimated/SQLite 的测试环境提示；没有屏蔽 console。通知/导航本次新增 owner 与搜索新按钮没有新增告警。两次完整门禁之间没有通过重试或改变隔离掩盖断言失败。

本任务搜索记录已逐项移除，搜索恢复空关键词/全部来源，通知“只看未读”恢复原值；没有发送、标记已读、上传、清账号或改版本。两处本任务 agent-device session 已关闭且列表为空，测试和 Gradle 进程均已结束；未停止共享 MCP、ADB 或模拟器。最终门禁、构建和导航普通红日志留在本机 ignored `.codex-tmp/geju-bugfix-20260920/`，最终 APK 也仅保存在该目录；不提交、发布或上传。

## 2026-09-20 全仓审查与测试治理

本轮审查以开工 revision `69cdedf94392ba2570459492cb7dfdad33f27545` 叠加已有未提交改动的整个工作区为准，保留已有改动；范围包括来源/domain、页面与生命周期、存储/通知/更新/代理及原生边界、依赖和测试工具。审查结合调用链、既有契约和受控反例，不等同逐条穷尽全部来源 HTML、Android 生命周期或真实站点协议。

确认的新产品问题仅保存失败证据，没有修改其生产行为：

| 优先级 | 问题 | 证据与后续入口 |
| --- | --- | --- |
| P1 | 私信发送等待代理时，认证屏障已打开但取消 effect 尚未执行，仍能发出一次 POST，随后才报身份失效。 | `REG-NOTIFY-075`，真实 notification gateway / NodeSeek adapter / proxy runtime，HTTP 替身；共享发送边界优先修复。 |
| P2 | 带排除词搜索放大上游页再截断结果，丢失已消费页的合法命中。 | `REG-SEARCH-030`，真实 V2EX reader，从首屏读取到终页核对结果守恒。 |
| P2 | 匿名妖火保留不可推进 cursor，使其他来源读完后聚合页仍不断返回空下一页。 | `REG-FEED-033`，真实 read plan / gateway / 聚合读取；不推断为真实网络请求风暴。 |
| P2 | 迟到的 cold initial URL 覆盖较新 warm URL，最终跳错主题与楼层。 | `REG-NAV-006`，真实导航 hook / parser 的交错时序。 |

四个 owner 都先以普通测试确认因目标行为失败，再保留静态 REG 标题的 expected-failure。它们不计为产品 `UNIT_PASS` / `UI_PASS`；完整根因、触发边界和关闭条件只维护在[回归语料库](regression-corpus.md)。全部写入反例使用假 HTTP，没有对原站执行写操作。

已落实的冗余与测试改进：

- 删除 Library 的四个零生产消费者函数及旧筛选类型；移除孤立的排序单测。Screen 测试只验证展示，筛选从真实控件经过 Route 到 queryReaderPage；SQL 排序/筛选仍由数据库 owner 负责。
- 删除只供测试调用的 importReaderBackupJson。保留 parse/export 领域边界，把导入净化、合并、身份删除标记和非法输入保护放到真实 Store → SQLite → 重新打开读回的 owner。
- 删除两条重复的版本/JVM 源码文字检查；执行版本 CLI 的拒绝分支和实际 Expo Gradle mod，检查真实输出及幂等性。
- Vitest 默认 Node，仅六个实际 DOM/WebView 脚本文件显式使用 jsdom；保留双 worker、文件隔离及随机顺序，不通过关闭隔离或重试缩短时间。文件级环境声明采用 [Vitest 官方机制](https://vitest.dev/guide/environment.html)。
- 文档门禁统一识别 Jest 与 Vitest 的预期失败语法，仍强制静态标题、唯一且处于 OPEN 状态的 REG。真实临时仓库反例先红后绿，覆盖缺失/未知/已关闭 REG、动态标题及参数化绕行。
- Topic 两个 UI owner 只改四处异步事件等待，使关闭屏障与 sheet 回调在 act 内结算；既有断言、真实计时和生产代码保留，没有增加 fake timer 夹具或屏蔽 console。

负向控制临时破坏版本一致性/正整数门禁、Gradle mod/JVM 值、Library 来源/分类/集合参数，以及备份净化/本机合并/事务回滚/版本门。对应 owner 均产生断言失败，随后生产文件逐字恢复；只检查任务 exit 0 或字符串存在无法提供这份证据。

剩余审计候选不混入已完成项：Smoke 中搜索 TSX testID/状态文字的检查仍应逐项迁至 UI owner；Release manifest/签名编排的源码断言还缺最终产物值与执行顺序 owner，暂不能安全整批删除。linux.do 用户摘要 fixture 与上游 Discourse serializer 的字段差异缺少当前原站样本，只记协议证据缺口，不宣称产品 Bug。没有证据支持按文件大小重写原生选择模块、删除身份/事务防线或新增测试框架。

治理统计采用每批修改前的定向基线，参数化按实际执行用例计；全仓测试文件包含 Vitest、Jest 与 Node tooling：

| 范围 | 文件数：前→后 | 实际用例：前→后 | 行数：前→后 |
| --- | --- | --- | --- |
| Library 六个相关文件 | 6→5（测试 4→3） | 34→32 | 1177→1058 |
| Backup 四个相关文件 | 4→4（测试 3→3） | 49→48 | 1051→1042 |
| 版本/JVM 三个 tooling owner | 3→3 | 40→42 | 715→715 |

三批既有测试合计 123→122，另外新增四个产品 expected-failure 与一个文档门禁行为用例；Topic 隔离收尾不增减用例。全仓测试文件 294→293，物理测试行数 124873→124978；新增失败证据使测试总行数略增，不把删用例或缩短代码本身作为成功标准。五个无生产消费者函数及相关死类型合计删除 57 行生产源码；没有新增依赖。

六类处置按已分类的既有逻辑测试组计（it.each 算一组）：三个批次加 Topic 收尾的 `KEEP_OWNER=62`、`MERGE_INTO=6`、`REPLACE_AT_SEAM=12`、`DELETE=2`、`FIX_ISOLATION=3`，另有 `OPEN_BUG=4` 新组。Library 的原生滚动替身调整属于套件隔离，不另冒充一条业务测试；环境声明也不计新用例。

定向验证均先 seed `20260920` 再默认随机顺序。Library 重放了 RNGH 滚动替身的非 act 提示，改为隔离原生 ScrollView 边界后，复现 seed `1860431069` 及新 seed `1925422243` 均为 23 项 UI 通过、零提示；真实 Route、Screen、控件与 Query 保留。Backup 的同 seed 单次时间 2.31→2.42 秒、tooling 3.34→3.41 秒，仅作记录，不宣称这两批提速。最终全量和环境对照数据见本节收尾记录。设备、Live、APK 构建与物理设备本轮均为 `NOT_VERIFIED`。

环境成本对照使用 Node 22.23.2、同一最终工作区的 211 个 Vitest 文件/2730 个实际用例、两个 worker、seed `20260920`；已有热身后，交替运行 Node/jsdom 各三轮，保留相同文件隔离及 DOM 六文件声明。以 JSON reporter 的整轮 start→最后 test end 计时：jsdom 为 95.97/96.40/97.01 秒，Node 为 32.86/32.31/32.78 秒；中位数 96.40→32.78 秒，减少约 66%。六轮均通过，其中各包含两个已确认 expected-failure；这仅证明本机测试环境开销改善，不代表 App 性能提升。报告位于本机 ignored `.codex-tmp/project-audit-20260920/`，另外保留工具/备份负向控制的命令与摘要，后者不是完整原始 stdout 日志。

本轮收尾验证使用 Node 22.23.2：`npm run typecheck` 与最终 `npm run verify` 均退出 0。首轮 verify 曾在文档门禁停下，原因是本次新增文档用了两处短路径，以及门禁未识别 Vitest 的 expected-failure；修正路径并补齐真实 fixture 后，完整重跑通过。

| 证据层 | 本轮实际结果 |
| --- | --- |
| `STATIC_PASS` | lint、格式、架构、文档引用、类型、unused、版本与 diff 检查通过；架构工具 25 项、文档工具 29 项通过。 |
| `UNIT_PASS` | Vitest 211 文件，2728 项正常通过；另有两个 OPEN expected-failure，不计产品通过。最终 seed `1789867517662`。 |
| `UI_PASS` | Jest 79 套件，1642 项正常通过；另有两个 OPEN expected-failure，不计产品通过。最终 seed `-894790754`。Topic 两个收尾 owner 共 58 项另以 seed `20260920` 与 `-194083624` 通过，act 警告 55→0。 |
| `NOT_VERIFIED` | 本轮未运行设备 Replay、原站 Live、APK 构建或原生专项；没有真实发送或修改远端状态。 |

最终全量仍有 17 条 act 告警：通知 Route 5、通知 runtime 2、Topic session controller 4、Topic reply filters 的 RNGH ScrollView 6；这些 owner 的异步收尾留作后续隔离治理。另保留 Reanimated 在 Jest 中不提供 animated keyboard 的环境提示。没有吞掉 console，也不把断言通过等同零告警。Library、深链、代理和本轮修正的两个 Topic owner 没有 act 告警。

本轮测试进程均已结束，未启动长驻服务或改变设备状态；已有用户改动保留，未提交、发布或上传。可复现命令、随机 seed 和日志保存在上述 ignored 目录，待修产品问题统一由四个 OPEN 条目承接。

## 批次与根因

| 项目 | capability / evidence owner | 实际处理与事实依据 | 修复前行为 oracle |
| --- | --- | --- | --- |
| 01 发送安全 | `WRITE-01/02/03/04`，阅读 sender | 普通 action 获取 CSRF 后和代理准备期间缺少最后发送校验。模板、上传、妖火同类入口及阅读上报共用无状态发送前守卫；保留成功确认和未知结果不重发规则。 | action 4 项、proxy 1 项失败；追加 reading 3 项失败，分别命中 CSRF/POST 代理等待和成功响应后的身份变化。 |
| 02 完整 JSON | `ACCOUNT-02`、`USER-01` | NodeSeek 注入脚本复用 12k 挑战采样作为 JSON 正文，长合法 JSON 被截断。正文完整读取，bridge envelope 仍限 900,000；超限明确失败。 | 真实注入脚本 3 项失败，包含长 JSON/Unicode；同 owner 回归 linux.do。 |
| 03 Topic 验证 | `TOPIC-01/04`、`ACCOUNT-02` | 删除固定 `identityPending:false` 的死分支；手动动作直达 Account，恢复回调使用已有活跃性/身份/请求归属。 | 5 项 Topic/Account owner 失败；另补真实 Route、Account、Query 与导航组合，覆盖取消重开、成功一次及失效。 |
| 04 通知初始化 | `NOTIFY-01/03` | Store 与权限探测独立结算；存储失败保护原数据，权限未知禁止系统投递，显式重试复用在途 Promise。 | runtime 2 项失败；补真实 Route 的重试按钮、原水位保留和非登录错误展示。 |
| 05 User 接口与错误 | `USER-01/02`、`ACCOUNT-01`、`NOTIFY-03` | 去掉聚合资料 getter；身份、资料、活动分页分别按既有字段读取。Query 独立持有活动成功/错误，失败不播种假空列表。 | 四站活动失败 4 项红例；妖火轻量身份 1 项红例；四站真实 gateway/controller 验证独立重试、真空与失败刷新。 |
| 06 重叠回复 | `TOPIC-03`、`WRITE-02/04` | 一致重复观察不再因数量大于 1 拒绝；每条明确允许编辑，身份/作者/已有内容/日期冲突或未知权限仍拒绝。 | 一致重叠可编辑红例；同一矩阵验证提交和上传前核验。 |
| 07 未读 owner | `NOTIFY-01/03` | 投递 Store 输入删除样本 unreadCount，snapshot 独占权威总数；60 条扫描和 A/B 事务不变。 | 真实 worker + Store 两项红例：80/60 与 1/0；另补重挂载且 snapshot 失败保持可信提示。 |
| 08 资料旧 API | `LIBRARY-01/02/03`，SQLite/备份 owner | 引用检索后删除 7 个无生产消费者的整对象 mutation 及 helper；有效断言迁入真实 Store，保留备份、迁移、净化、事务和 pending command 投影。README 改为 SQLite。 | 删除的 15 项专属旧实现测试不是生产证据；现有真实 Store owner 覆盖历史上限、收藏时间、关注、清空、回滚。 |
| 09 列表归属 | `FEED-02/04`、`LIBRARY-01/02/03` | Feed 同来源冷筛选保留列表宿主；Library 每个已访问集合观察自己的 Query，分页绑定所属 tab。 | 3 项红例；后续组合 owner 使用真实 controller/gateway/Screen 或 Route/Screen，覆盖成功/失败、旧条目隐藏和隐藏回调。 |
| 10 Native 检查 | CI、Native runners、patch tooling | 静态路径表选择现有 module/App JVM 任务，校验新鲜非零 XML 报告。保留配置/补丁合同；未找到需要替换的重复生命周期字符串 oracle，不凭空删除。 | 路径正反例与报告边界；隔离 module 副本破坏取消逻辑，真实 27 项 JVM 中 `cancelDoesNotCreatePlatformActions` 失败。配置失败的首次尝试不算行为证据。 |
| 11 Kotlin 外置 | Network/SVG plugin | 8 份固定 Kotlin runtime/test 从 JS 字符串移入受版本管理文件；按既有方式读取与替换 package。 | 原 builder 与新 builder 对 `com.wz.reader` 和替代 package 逐字节相同；fresh prebuild、JVM 和 Kotlin compile 验证生成链。 |

## 字段与请求证据

本次没有新增原站 endpoint 或推断权限字段。依据是基线已有 parser、adapter 及固定样本；这些证据证明仓库支持的协议结构，不代表已完成当天原站 Live 验收。合成空列表、503、平台异常和挂起 Promise 仅用于边界/故障注入。

| 来源 | 身份 / 资料入口 | 活动入口与游标 | 原始字段和 canonical 来源 |
| --- | --- | --- | --- |
| linux.do | `/session/current.json`；`/u/{username}/summary.json` | `/topics/created-by/{username}.json`：既有 30 条 page；`/user_actions.json`：既有 `filter=5`、offset、31 条 lookahead。分类信息必要时仍读既有分类来源。 | `current_user`；summary 的 `user_summary`、`user`、`users`、明确的 topic/reply/post count；活动 `topic_list.topics`、`user_actions`。`src/sources/linuxdo/account.ts`、`tests/integration/source-read-contracts/discourse.test.ts`。不把失败活动替换为 summary 片段。 |
| NodeSeek | 既有 `/`、必要时 `/setting` 身份解析；数字 UID 的 `/api/account/getInfo/{uid}?readme=1`；username-only 先走已有 `/api/account/find/{username}` | `/api/content/list-discussions?uid=…&page=…`；`/api/content/list-comments?uid=…&page=…`；沿用 15 条和已知计数的分页语义。 | `detail.member_id/member_name`、`nPost/nComment`、`discussions`、`comments`；身份仅使用已有配置/明确自身链接。缺少实际列表字段抛错。`src/sources/nodeseek/userParser.ts`、`src/sources/sourceUserRead.test.ts`、`tests/integration/source-read-contracts/nodeseek.test.ts`。 |
| V2EX | 无登录身份能力；`/api/members/show.json?username=…` | `/member/{username}/topics`、`/replies`，只使用现有 HTML 下一页解析；主题首屏保留 `/feed/member/{username}.xml` fallback。HTML 与 feed 都失败则抛错。 | `id/username/name/avatar_*/tagline/pro` 与已有 HTML/ATOM parser；不把首屏已读数量当总计。`src/sources/v2ex/account.ts`、`src/sources/sourceUserRead.test.ts`。 |
| 妖火 | 既有 session 检查的 `currentUser`；资料 `/bbs/userinfo.aspx?touserid=…&siteid=1000` | 首次活动链接从资料 HTML 的真实 href 提取；后续 cursor 继续使用已有安全 URL、next-page parser。主题首屏最多 10 页/30 条，后续每次一页，保留原顺序。 | `src/sources/yaohuo/sessionParser.ts` 与 `src/sources/yaohuo/protocol.ts` 的既有身份、昵称、统计、帖子/回复链接解析。未知且缺活动链接时报不支持；只有已知 0 或实际解析结果可显示空。后台直接消费已确认身份；Account 为展示名保留必要资料读取。 |

四站非空固定样本的首屏请求数由 `tests/ui/user/user-activity-reads.test.tsx` 验证：linux.do、NodeSeek、V2EX 各为资料 1 + 主题 1 + 回复 1；妖火为资料 3 + 活动 2，其中两次资料读取分别解析主题与回复入口。单活动重试前三站 1 请求、妖火 2 请求，不重读另一活动。V2EX 首屏 feed fallback、linux.do 分类补全、NodeSeek username resolution 和妖火多页聚合按各自实际条件增加请求；这些数字不代表耗电或延迟收益。

### 明确新增的本地接口

- `UserIdentity`、`UserDetails`、`UserTopicsPage`、`UserRepliesPage` 与 `UserProfileView`：从已存在 canonical 字段收窄，分别供 Account/后台、User Query 与视图消费；旧备份格式仍由 ReaderData owner 维护。
- gateway 的 `getUserDetails/getUserTopics/getUserReplies` 以及 activity options 的 `profile/cursor`：本地参数和返回边界，复用现有鉴权、取消、scope 和诊断 operation；没有新增服务器字段。
- `withRequestBeforeSend/prepareRequestToSend`：本地 Symbol 回调元数据，代理准备后同步执行并剥离。没有 HTTP header/body 字段。
- recovery 的可选 `isCurrent`、通知的局部错误与 `retryInitialization`、Library 的所属 tab 分页回调：连接已有 owner，无新增状态机、全局容器或通用恢复框架。
- Native `clipboardWriterForTest`：已有 selection View 的剪贴板边界故障注入 seam，仅测试使用；`copy-denied` 为本地 bridge 事件，不是原站协议。

## 两项待证实假设的结论

- **User 刷新/分页竞态已复现。** 真实 controller/Query 在旧分页晚于刷新完成时覆盖新首屏，seed `91605` 命中；已改为先 cancel/await 活动 Query，刷新期间禁止新分页。相反完成顺序与失败刷新保留旧数据均覆盖，没有 generation/锁。
- **Copy 平台异常逃逸已在受控注入下复现。** 独立 `WZ_ForumSelection_Test_API35` 注入剪贴板 `SecurityException`，修复前 48 项 instrumentation 中 1 项失败。局部捕获该明确异常，保留选择并提示，成功才结束 ActionMode；修复后 48 项通过，包括拒绝后重试和长 Unicode 正文完整复制读回。不能把注入证明说成历史设备已发生崩溃，也没有验证所有平台异常或物理手机触感。

## 验证记录与边界

- 使用已核对官方 SHA-256 的 Node `22.23.2` 和当前 lockfile；Node 25 不作为正式结果。
- 已有阶段证据：action/proxy 134 项、hidden scripts 40 项、Topic/Account 133 项；User adapter/contracts 292 项；额外通知/编辑上传/Library 219 项；阅读 sender/runtime 44 项；四站 User + Account 51 项。不同批次有重叠，不相加为总用例数。
- 首轮 UI 的旧身份形状和 NodeSeek recovery 预期失败，已按原 seed `-1127183982` 重放对应 85 项通过。最终 `npm run verify` 完整退出 0：Vitest 207 文件、2539 项，seed `1789498850110`；UI 77 文件、1503 项，seed `1309460043`。lint、格式、架构、文档、类型、未使用代码和版本门禁均通过，取得 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`。
- Native 已取得 8 模板双 package 字节一致、fresh prebuild、selection JVM 27 项、App JVM 131 项、Release Kotlin compile、独立 selection instrumentation 48 项的成功证据。新关联检查脚本实际运行两组任务并核验新鲜非零 XML；隔离 module 只重命名私有变量后仍为 27 项通过。App 编译不替代 module 测试。
- 普通入口的开发签名 `assembleRelease` 构建通过，未执行正式发布流程。前几次构建被本次调用方式留下的空 `ENTRY_FILE` 干扰：当前 PowerShell 的 .NET 环境变量 API 将 null 转为空字符串，RN 将它优先解析为仓库目录。改用 `Remove-Item Env:ENTRY_FILE` 真正删除变量后，正常 `index.ts` 打包和构建通过；没有保留临时 Gradle 绕行配置。
- APK SHA-256 为 `be9401dc9e8606f6463c5178a681dcc4a4e9a177015292252eda602f57977646`，版本 `1.3.144` / `148`，签名与主设备原安装一致。仅覆盖安装到 `WZ_Pixel_API_35`，`firstInstallTime` 保持 `2026-07-26 16:51:37`，三个账号仍已登录，取得 `APK_SANITY`。
- 同一 APK 的 `tests/device/account-readonly.ad`、`tests/device/feed-gesture-priority.ad`、`tests/device/feed-source-controls.ad`、`tests/device/library-return.ad`、`tests/device/notifications-readonly.ad` 五份回放全部通过，取得对应入口的 `DEVICE_REPLAY_PASS`。回放包含账号切换查看、Feed 手势和 Topic 返回、Library 集合/来源切换及通知只读操作；其中允许 error outcome 的断言仅证明页面能正确结算，不证明所有远端请求成功。
- 补充 App 内只读 `LIVE_PASS`：四站 User 资料、主题与回复正常展示；linux.do 当前账户的主题计数为 0，空态与其一致，其余样本活动非空。V2EX 回复追加分页出现更早条目，显式刷新回到首屏；NodeSeek、linux.do 活动进入 Topic 后返回正常。V2EX Feed 选择“深圳”分类后正确显示对应内容。只读手动验收记录在本机，不保存正文或身份到本文。
- 受控 HTTP 不代表真实发帖、编辑、上传、标记已读或通知投递；本轮不执行这些真实写操作。未测量性能、耗电或时延收益。

| 批次 | 已取得证据 | 未在主设备强制制造的分支 |
| --- | --- | --- |
| 01–02 发送与正文 | `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`、`APK_SANITY`；账号只读回放及 NodeSeek User 实际读取通过。 | `NOT_VERIFIED`：真实写入、真实超长 bridge envelope / CF 挑战页面。发送时序和完整 JSON 由隔离 HTTP、真实注入脚本证明。 |
| 03–07 恢复与业务结果 | `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`、`APK_SANITY`；账号/通知 `DEVICE_REPLAY_PASS`，四站 User 正常只读 `LIVE_PASS`。 | `NOT_VERIFIED`：主设备换号/停用期间的挑战完成、存储/权限故障、编辑写入和系统摘要投递。对应失效、错误及事务分支有受控 owner 测试。 |
| 08–09 资料与列表 | `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`、`APK_SANITY`、Feed/Library `DEVICE_REPLAY_PASS`；真实分类读取通过。 | `NOT_VERIFIED`：设备上人为制造冷筛选失败、隐藏旧分页回调、导入/清空故障；这些由真实 controller/Store/Screen 测试证明，未清理用户资料制造条件。 |
| 10–11 Native / 模板 | `STATIC_PASS`、`UNIT_PASS`（JVM 27 + 131）、fresh prebuild / compile / APK 构建、8 模板字节等价；独立 AVD instrumentation 48 项通过。 | `NOT_VERIFIED`：物理设备厂商差异与全部剪贴板异常类型；本次只对可识别的 SecurityException 修复。 |

## 2026-09-16 隔离设备补验

本轮使用已有的 `WZ_ReaderStorage_API35_20260910`（API 35），只覆盖安装开发签名 Release Hermes，安装时间保持 `2026-09-10 04:04:05`。主设备不运行故障入口。可重跑入口为 `scripts/run-reader-storage-device-proof.mjs` 和 `scripts/run-review-remediation-device-proof.mjs`，命令与隔离约束以 operator runbook 为准。

| 范围 | 实际设备证据 | 边界 |
| --- | --- | --- |
| ReaderData / SQLite | 31 个阶段符合预期：27 个 passed 和 4 个等待外部终止进程的 paused，后者分别接续重启恢复验证；覆盖真实数据库迁移、大数据、COMMIT/清理前后终止、清理失败恢复、SQL trigger 回滚、锁等待、索引与导入/排队修改顺序。 | 使用既有隔离资料，不在主设备导入或清空。没有覆盖系统文件选择器的完整导入 UI。 |
| hidden WebView | 10 项通过：NodeSeek / linux.do 各自短 JSON、长 Unicode JSON、含 CF 字样的正常 JSON、超 envelope 明确失败、结构化挑战页面。实际 Android WebView 执行生产注入脚本和 bridge handler。 | 页面内联、远端资源禁止；不代表当天原站 Cloudflare 通关。NodeSeek 验证重复注入只结算一次，linux.do 按生产接线注入一次。 |
| User | 10 项通过：四站各自主题/回复失败、独立重试、失败刷新保留；NodeSeek 分页先完成与刷新先完成两种实际 Query 竞态。 | 真实 gateway/parser/controller/Hermes，HTTP 只使用现有固定样本；不声称新字段或原站故障复现。 |
| Feed | 2 项通过：同来源冷筛选 pending 到成功/失败，旧条目隐藏且实际 FlashList 底层原生 scroll handle 不变。 | 普通入口的手势另做匹配 APK 验收，不把 host 断言作为性能或触感测量。 |
| 验证恢复核心 | 4 项通过：取消重开后只恢复一次；目标失活、scope 变化、卸载期间 Cookie 交接迟到不恢复。 | 真实 verification controller；面板、Cookie 交接和身份核对为受控边界。没有把它称为完整 TopicRoute / Account / 原站挑战设备链。 |
| 发送前校验 | 6 项通过：挂起 CSRF 后身份、epoch、来源、surface 失效均零 POST；实际 Native proxy 准备挂起后守卫阻止底层发送；确认成功后的失效不重发、不反向抛取消。 | HTTP 写请求完全隔离；没有真实编辑、上传或其他远端写入。 |
| 通知 | 9 项通过：存储失败后重试、权限探测异常、真实 Android 权限拒绝、卸载迟到；实际 worker/Store/Android 摘要投递成功、投递边界拒绝、投递后存储失败撤回、换身份撤回，以及 80/1 权威未读数保留。 | 存储/Native 拒绝为故障注入，权限拒绝和系统摘要显示/撤回为实际平台行为；不代表 OS 自然故障或后台调度器唤醒。 |

取得上述范围的 `DEVICE_REPLAY_PASS`（受控设备入口）。SQLite APK SHA-256：`19bd486bd32674fb379e3aeaf02944e32339e2f0155a863239f6900887f7088a`；41 项运行时 APK：`32ca3319ea9de5a9017023f4d0ad5c29fe7028456b09ef6b8a80a5dd548d8052`，独立 buildId `457da8d1964b400584436b45f58ae4f8`。完整 receipt 当时保存在本机 ignored 的 device-fault-validation-20260916 目录（位于 .codex-tmp 下，当前 checkout 未保留），不提交正文、日志或 APK。

### 补验发现与最小修复

第二轮运行时检查为 39/41：Feed 两个原生宿主断言失败。当前 RN `node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js` 在 Android 上将有 RefreshControl 的 ScrollView 包在刷新容器内，移除 RefreshControl 会改变层级；原修复仅保留 FlashList 组件，未保住底层原生视图。现在在既有 Feed owner 内保留 RNGH RefreshControl，冷筛选时只设 `enabled=false`。相同设备检查转为 41/41，相关 Feed/User 三个 UI owner 108 项通过（seed `1048951387`）。没有新增状态机或生产接口。

首轮试验还暴露两处测试接线错误：linux.do 脚本被测试重复注入、NodeSeek 下一页错用了 1 而非生产 cursor 2。按真实实现纠正后通过；这些不记录为产品缺陷。四站样本从既有 UI owner 原样提取为 `tests/fixtures/userActivityEvidence.ts`，该 UI owner 的 24 项独立回归通过（seed `-1583372232`）。新增 HookProbe / recovery probe 都是隔离测试的本地接口，不代表服务器协议。

runner 在主 AVD 上的负向检查明确拒绝，未安装或改权限；隔离设备通知权限在 finally 恢复，合成摘要被撤回，原通知存储键恢复。Feed 补修前的普通 APK 上，主设备历史列表离开底栏再返回，六个可见条目的文字及屏幕边界一致；进入已读 Topic 后可正常返回。历史会按访问时间重排，未据此声称具体条目锚点位置完全不变。

本轮最终 `npm run verify` 使用 Node `22.23.2` 完整退出 0：Vitest 207 文件、2539 项（seed `1789521187257`），UI 77 文件、1503 项（seed `44282459`）；静态、架构、文档、类型、未使用代码和版本门禁通过，取得 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`。这份脱敏修复记录加入文档跟踪白名单，防止其他文档的链接在新 checkout 中失效；本机 receipt、原始日志、截图与 APK 继续 ignored。

Feed 补修后的普通入口也使用 Node 22 构建成功，APK SHA-256 为 `4f5443c2c1c4251c312682aae00039c264203819ba64468962f98c8769a4f78a`，版本仍为 `1.3.144` / `148`，签名与原安装一致。仅覆盖安装主 AVD，`APK_SANITY` 及 `account-readonly.ad`、`feed-gesture-priority.ad`、`feed-source-controls.ad` 三份匹配 APK 回放通过；主设备安装时间仍为 `2026-07-26 16:51:37`，最终账号中心显示网站登录 `3/3`。本轮任务创建的隔离模拟器、Gradle 和设备自动化会话均已结束，主模拟器及共享工具保留。没有发帖、编辑、上传、清用户数据、提交或发布。

## 后续验收归属

上方初轮表格中的设备故障缺口，已按本轮补验表缩小。仍为 `NOT_VERIFIED`：原站挑战经 TopicRoute / Account 完成并恢复详情的完整设备链；换号/停用与该完整链交叉；真实编辑/上传及一致重叠回复在写入 UI 的设备流程；Library 隐藏旧分页回调的设备注入、系统文件选择器导入/清空故障；真实后台调度器唤醒、OS 自然异常及物理手机差异。现有真实 Route/Screen 单测不替代这些设备结果，受控设备证据也不等于 `LIVE_PASS`。不通过清理用户登录态、远端写入或清空数据制造条件。

## 工作区与资源收口

保留原送审快照和原 15 个修改文件中的已有业务改动；身份测试中已失效的 `topics:[]` 随接口收窄删除。未提交、发布、上传或增加依赖。任务自建的独立测试 AVD 已关闭，设备自动化会话已关闭，Gradle 与回放子进程已结束；主设备和共享工具服务保留。

原生成目录已保留在本机 ignored 目录供追溯；当前 `android/` 来自 fresh prebuild。取证日志、原 APK、模板字节样本和 Node 22 验证运行时留在本机。自动审批以 `blocked by policy` 拒绝删除临时 Native 副本和三个 Gradle 探针文件，未提供更具体理由；这些临时文件保留在 ignored 目录，属于清理受阻，不属于代码或验收失败。


## 2026-09-17 Pro 复核后的补齐

本批基线 `9304443206fe0d39db52aead39a80a88233d490c`，开工工作区干净。实现四项产品修复与 Native CI / Node 契约修正，不提交、发布或执行真实远端写入。产品契约和历史根因分别归 product map 与 `REG-WRITE-082`、`REG-DATA-009/010`、`REG-NOTIFY-068`；`REG-NOTIFY-065` 的已有取消后对账修复继续保留。

| 范围 | 本批证据 | 未验证范围 |
| --- | --- | --- |
| `ACCOUNT-04`、共享 `WRITE` | `UI_PASS`：真实 NodeSeek client 经真实代理等待，身份/epoch/来源/认证界面失效 × Topic/签到两入口零 POST；正常恰好一次，已确认与未知结果规则保持。8 个反例修复前均失败。 | `NOT_VERIFIED`：真实发帖、签到等远端写入及 JS→Native 最后间隙假设。 |
| `DATA-03` | `UNIT_PASS`：三类集合 × 999/1000/1001 × 时间冲突矩阵；SQLite 实际导入、重开三类记录均不复活，事务失败回滚 owner 保留。提前裁剪反例修复前失败。 | `DEVICE_REPLAY_PASS`：Android SQLite 实际导入、独立连接重读 27 个边界组合通过；原 fixture 还原。 |
| `DATA-02`、`MORE-05` | `UI_PASS`：真实 ReaderRuntime、Feed、通知运行时组合，失败导入不放行/不落盘清理；成功恢复准确放行；回滚失败保护；首次安装对照与恢复面板导入入口。 | `DEVICE_REPLAY_PASS`：完整 App 恢复入口、系统选择器无效/有效导入、零业务请求及准确来源恢复通过，见专项补验。 |
| `NOTIFY-02` | `UI_PASS`：同一详情失焦返回、身份恢复、来源停用、显式重试先读详情、防并发、普通刷新不取消、迟到旧结果隔离、确认不因对账失败降级。原有服务端已生效后响应取消对账矩阵保留。 | `DEVICE_REPLAY_PASS`：匹配 APK 的受控详情导航、取消与重试；实际远端已读写入仍为 `NOT_VERIFIED`。 |
| Native / Node | `UNIT_PASS`：planner 路径映射、缺目标类/旧报告/零用例/全跳过/失败报告拒绝；Node 22.22.1 拒绝、22.22.2 与较新 22 接受、其他大版本拒绝。CI 最低版本改为 22.22.2。 | 设备 instrumentation 与 JVM 独立，既有设备缺口不自动关闭。 |

重新生成 Android 工程后，五类 JVM 任务实际完成并逐一核对目标类报告：selection 27 项 / 166.5 秒，App（含 Composer）138 项 / 261.7 秒，ReactAndroid 12 项 / 50.1 秒，Expo FileSystem 7 项 / 58.1 秒，Expo Image 2 项 / 50.4 秒，共 186 项。耗时是本机本轮结果，暂不据此增加 CI job；云端耗时仍需其自身运行证据。

初次隔离设备只读取证：启动已有 `WZ_ReaderStorage_API35_20260910` 后，PackageManager 仍报告 `installed=true`、versionCode 148、首次安装时间 `2026-09-10 04:04:05`，但 `pm path com.wz.reader` 返回空且 `run-as` 报 unknown package。依安装身份异常规则冻结变更；未安装、卸载、清数据或重置设备，结束仅关闭本任务启动的隔离模拟器，原两个模拟器保持运行。不能把 JVM 或 UI 通过写作设备恢复已通过。

用户要求继续排障后，确认上述 AVD 已完成冷启动，PackageManager 保存的 `codePath` 目录实际不存在（`pkg=null`），但应用数据仍在，磁盘剩余 4.4 GiB。先读取隔离资料所有权标记并保存本地数据副本，核对原包记录与已有同版本 APK 的证书 SHA-256 一致，再以 `adb install -r` 覆盖安装；APK 路径、`run-as` 均恢复，UID 10209 与首次安装时间不变。覆盖前后 62 个原有非缓存文件内容 hash 全部一致。已确认直接原因是 APK 文件与安装记录不一致，现有日志不能确定文件最初为何丢失；没有卸载、清数据或恢复快照。

修复后用当前代码和 Node `22.22.2` 构建开发签名 Release Hermes，已有运行时设备入口 41/41 通过（`DEVICE_REPLAY_PASS`，受控 WebView/User/Feed/验证恢复核心/发送守卫/通知平台范围沿用上方定义）。APK SHA-256 为 `9dc4679a442d822395cf95463c55967b457e01d83cf9d5d7b357e3f050854f63`。随后重启 Android，启动完成后 APK 路径、`run-as`、UID 和首次安装时间仍正常；通知权限恢复为原来的拒绝状态。receipt 保存于本机 `.codex-tmp/avd-recovery-0917/runtime.json`。这次 41 项复跑本身不替代新增 recovery 页面、详情导航和备份边界；三项专门设备验收见下一节。


本批最终 `STATIC_PASS`：Node `22.22.2` 上完整 `npm run verify` 退出 0，包含 lint、格式、架构/文档门禁、typecheck、unused 和版本一致性；`git diff --check` 通过。全量 `UNIT_PASS` 为 Vitest 209 个文件 / 2587 项，seed `1789630695452`；全量 `UI_PASS` 为 Jest 78 个套件 / 1537 项，seed `-1760791271`。首轮全量后的两处新增测试类型夹具问题已修正，再次完整 verify 通过；修复前反例及定向验证 seed 为 `917146`。测试数量只记录本次执行事实，不替代上表的能力与设备边界。


## 2026-09-17 三项专项设备验收

用户授权继续验收后，在原隔离 API 35 AVD 上覆盖安装当前工作区的开发签名 Release Hermes。没有修改产品逻辑、提交、发布或连接原站写入；新增证据沿既有 dev proof owner 和 runner 维护。

| 能力 | 设备观察和最终断言 |
| --- | --- |
| `DATA-03` | 三类集合 × 999/1000/1001 × 删除较新/相同/记录较新，共 27 个组合经真实 storage 导入、独立 SQLite 连接重读通过；同时间删除优先、较新记录保留、删除标记不超过 1000。 |
| `DATA-02`、`MORE-05` | 在真实 SQLite 读取边界注入一次失败，完整 App 能进入更多；导出禁用、系统文件导入可用。导入无效 JSON 后仍零来源业务请求、原库与通知意图不变。成功导入后导出恢复，首页仅 V2EX，新增收藏可见；受控业务请求只来自 V2EX。恢复 `.ad` 与最终业务 receipt 均通过。 |
| `NOTIFY-02` | 真实 NotificationDetailRoute、gateway 和 native stack，NodeSeek adapter 响应受控。首次挂起后覆盖详情并返回，route key 不变、取消一次；失败与未确认均由真实重试按钮继续，重试先读详情。普通刷新和重复点击不新增在途写入；四次尝试、一次确认、四次对账，最大并发 1；确认后再覆盖/返回不重复。通知 `.ad` 与最终业务 receipt 均通过。 |

验收入口曾因静态导入完整 App 而保持启动图，已收窄为仅恢复模式加载完整 App。自动回放修正了模拟器显示名、带空格 selector 和 picker 关闭动画的等待；未完成业务断言的尝试均保留为失败，未据此修改产品代码。系统文件选择器为真实平台 UI；全局 fetch 或 notification adapter 为受控响应，因此这些结果不构成 `LIVE_PASS`，也不证明原站自然故障、真实写入或其他既有设备缺口。

本轮原资料单独留存本机副本；恢复回放中断产生的 fixture 变化在结束时仅还原本轮涉及的 Reader SQLite 与 AsyncStorage 数据库，再用独立 SQLite 读取核对 ReaderData 和全部 AsyncStorage 键值与验收前一致。没有清 App 数据、Cookie、重置 AVD 或恢复模拟器快照。安装 UID 和首次安装时间保持原值；原两个模拟器不受影响。所有 JSON receipt、日志、截图及 APK 保存在本机 ignored `.codex-tmp/acceptance-0917/`。


专项构建身份：SQLite/恢复 APK SHA-256 `62cc7de78ae0252dbdcbb133178191cefc8aba78837f764c4d1548b1b276c549`；通知最终夹具的账号展示也经真实 observation → snapshot → view model 投影为已确认身份，最终 APK SHA-256 `61f48a3ebab1861443c17dff29aefcd828dec72ff1dcd3764f122d8addc9f775`。两者产品代码相同，区别只在验收入口；receipt 分别为 `.codex-tmp/acceptance-0917/boundaries-final.json`、`.codex-tmp/acceptance-0917/recovery-replay7.json`、`.codex-tmp/acceptance-0917/notification-complete.json`。独立回放耗时为恢复约 19 秒、通知约 9 秒。本轮先复跑既有 41 项设备入口并全部通过，新增三项按自己的 receipt 和回放报告结算，不混算为 41 项的新覆盖。

专项收尾再次使用 Node `22.22.2` 执行完整 `npm run verify`，退出 0：`UNIT_PASS` 为 Vitest 209 文件 / 2587 项（seed `1789635469887`），`UI_PASS` 为 Jest 78 套件 / 1537 项（seed `-1010810920`）；lint、格式、架构、文档、类型、unused 与版本检查取得 `STATIC_PASS`。最终通知构建及回放通过后，全部 AsyncStorage 键值再次与验收前一致。任务自建的隔离模拟器、Gradle 和设备自动化会话均已结束，原两个模拟器保持运行；收尾文档引用检查与 `git diff --check` 通过。


## 2026-09-17 测试审查实施

本轮沿用 revision `9304443206fe0d39db52aead39a80a88233d490c`，保留开工时61项已有工作区改动；未提交、发布或推送。新增产品历史归 `REG-SEARCH-029`、`REG-TOPIC-173`、`REG-USER-012/013`，产品行为见 product map，测试/设备操作归原有权威文档。

| 范围 | 实际证据 |
| --- | --- |
| `SEARCH-02` | 真实 controller、写入队列与存储重挂载；延迟添加→删除、A→B→A 修复前失败，排队目标去重后通过；包含最新失败重试与旧失败不污染新目标。 |
| `TOPIC-01/03` | 真实 NodeSeek 注入桥接与最终 parser；缺行、乱序、重复 DOM/embedded ID、重复楼层、交叉冲突、数字楼层0与签名。独立复核补出的交叉匹配反例同样先红后绿。 |
| `USER-01` | 妖火真实适配器全 cursor 遍历，14+15+15+2等不完整页与59条上界不漏；同名跨来源、数字UID、新/同实例、用户名/epoch/卸载和迟到恢复只归当前解析作用域。 |
| 测试治理 | helper内违规I/O、catalog缺能力/多能力和倒置图片预览顺序均做过负向控制。保留真实加载事件的图片 owner，定向运行7项通过；删除仅重复编译同一输入的伪动态测试。NativeModules恢复原描述符，verify只保留一次严格类型检查。 |
| 工具可靠性 | checkpoint与视觉判定23项通过，Node22.22.2，seed917146；包含备份/owner拒绝零业务写入、并发拒绝、进程被杀后释放OS租约、恢复失败/冲突/续接、字节及独立逻辑重读、缺批准与基准被修改、传输与清理错误独立保留。实际agent-device0.20.6比较相同PNG通过，受控布局改变、尺寸变化、缺基准均失败。 |

产品与相关治理 owner 的补充组合：Vitest6文件221项、UI4文件112项，seed917231；原固定seed917146保留红绿和重放记录。最终完整 `npm run verify` 以 Node22.22.2 退出0：`UNIT_PASS` 为211个Vitest文件2625项（seed1789647227838），`UI_PASS` 为78个UI文件1553项（seed453138200），静态、架构、文档、严格类型及版本门禁取得 `STATIC_PASS`。另行 `npm run typecheck` 通过；这些结果不扩大为原站证据。

本机路径 `.codex-tmp/pro-test-followup-20260917/` 保留原始回执，视觉目录由 runbook 定义。专项 proof APK SHA-256 为 `d90676276fd516105b2f59d52e859f2fd6cdbbe2019365fd11dfc15bc38cf5ba`，安装 UID 10209、首次安装时间 `2026-09-10 04:04:05` 保持不变。

| 设备 owner | 实际结果 |
| --- | --- |
| recovery | `DEVICE_REPLAY_PASS`：系统选择器实际导入合法 JSON、错误版本，观察到明确格式不兼容提示；两次保护核对、零来源业务请求和成功恢复后仅 V2EX 放行通过，`invalidImports=1`。 |
| notification | `DEVICE_REPLAY_PASS`：同一详情实例，4 次尝试、1 次取消、1 次确认、4 次对账请求，最大并发 1；计数不冒充实际摘要读取或持久化。 |
| boundaries | `DEVICE_REPLAY_PASS`：实际 Android SQLite 导入与独立重读的 27 个删除时间/容量边界组合通过。 |
| checkpoint 故障 | 故意业务失败、App 中断和取消文件选择均按预期返回非零；取消选择的 `invalidImports=0`，不能冒充无效导入验收。以上三轮及正常验收均以六个白名单文件哈希和独立逻辑重读证明 `restoration.phase=restored`。 |

ADB 曾短暂不可用，失败发生于边界验收备份前，没有业务写入；连接恢复后重新执行取得通过证据。Windows 传输改用临时文件 push、run-as staging、校验再替换；实际恢复中断续接也已完成。独立复核发现的“远端临时文件清理错误覆盖原传输错误”以反例先红后绿修正，本机 scratch 始终进入清理，多错误分别保留。

视觉 `DEVICE_REPLAY_PASS`：最终 Gallery APK SHA-256 为 `3711d70535bc0c2608c8834949869c9b3f2b81cba805a916f2ee387f95dfbb0f`。14个固定画面各连续捕获三次，耗时405秒，尺寸一致、阈值0.1下差异像素为零；逐帧审阅后显式登记本机基准。随后普通比较入口再次14/14通过，耗时149秒，并完成数据库还原。候选为 `capture-xAsv1f`，普通比较为 `capture-vO91XU`；均在 ignored `.codex-tmp/visual-runs/`。

固定样本改用已有 `displayTimeText` 避免相对日期随日历漂移，两项跨日期 oracle 先红后绿；生产时间格式未改变。真实 CLI 检出两次 Gallery 构建中5个画面的预期日期变化，其余9个画面完全一致。结合画面和布局定义核对最近搜索的独立48dp点击/删除区、长资料及140%应用字号下的换行、关注/展开按钮和错误恢复入口；未发现关键操作遮挡或文字重叠。Gallery不构成完整 App E2E 或完整网络隔离证明。

本轮结束时六个白名单数据库文件及全部存储键值均恢复原基线，App停止；仅关闭本任务启动的专用隔离模拟器，原两个模拟器和共享工具保持运行。真实远端写入、物理设备差异、原有未验收设备缺口，以及性能实验、测试框架迁移、Node24支持扩展均未纳入本轮通过声明。

## 2026-09-19：全仓复核方案落实

本轮从干净的 `69cdedf94392ba2570459492cb7dfdad33f27545` 开始，按 [Pro 报告](https://chatgpt.com/c/6aad46cc-a6e0-83e9-abb0-8faa5f07ca1c) 的复核方案实施。使用 Node `22.22.2`，便携运行时已核对官方 SHA-256，依赖仍以现有 lockfile 为准；没有升级框架、增加 ORM/outbox/状态机库，没有执行提交、推送或正式发布。当前契约以 product map/architecture/testing standard 为准，本节只记录修复与运行证据。

| 范围 | 交付及失败 oracle |
| --- | --- |
| F1 / `TOPIC-01/03` | 拆开路由焦点、App 前台与请求身份；真实 Route→Query→gateway 组合与四来源 controller 矩阵分别验证原请求跨后台继续及取消恢复，保留真实失败显式重试和验证恢复授权失效。 |
| F7 / `WRITE-05` | 独立 SQLite journal，发送前原子 claim、最终发送标记、原账号保存已知结果、未知阻断、严格迁移与无 32 条淘汰；旧存储并发丢行已确认红灯，数据库/真实 action→transport 测试验证修复。 |
| F2 / `TOPIC-03`、`DATA-01/03` | 零计数、无历史与无可信水位独立；水位固定于本次进入，来源只提供已证明的楼号边界。旧备份兼容，没有额外抓取整帖。 |
| F3/F4 / `TOPIC-01/02/03` | DOM 连续终端分组保留中间正文/图片；真实正文 renderer 核对顺序和图片打开地址。linux.do 由目标楼号窗口唯一匹配引用；稀疏 stream 的旧实现反例失败。 |
| F5/F6 / `NOTIFY-01/03` | 质量进入业务结果；坏来源整轮不推进、首次可信扫描静默、先去重再摘要、前台保留可信旧数据。复核另补聚合游标第三页复活、妖火末页跨扫描上限伪总数两个反例；worker 测试改用真实 store。 |
| R1 / `DATA-02` | 旧 sidecar 读取及清理分别有 3 秒 I/O 预算；保留成功 ReaderData，清理挂起留下 pending，SQLite 事务不超时返回空。 |
| R2 / `DATA-03`、`MORE-02` | 备份使用系统保存协议，取消独立；诊断私有随机导出文件保留 24 小时并执行 32 份/128 MiB 上限。复核修复清理失败跳过诊断 writer，以及坏 Activity result 从主线程抛错绕过 Promise 的问题。 |
| R3 / 原生模块、`TOPIC-02` | 原生源码和测试直接归 `modules/forum-platform`；先机械迁移编译，再改文件功能。图片经既有 imageCallFactory 流式写文件，JS 不再中转远程图片全量二进制/Base64。 |
| G1/G2 / 治理与原生图片 owner | 全部 REG 标题检测唯一性并报告两处位置，含不同标题级别/格式；四处后续冲突已重新编号。真实 View/主队列发现销毁、换 recyclingKey 和实际 source 改变未更新 generation；修复后移除关键保护能再次准确失败。 |

测试去留已落实：保留底层 deadline、真实错误不自动重试、magic-tab/删除占位、Reanimated 执行、patch 适用性与 Native 新鲜结果检查；删除两份图片补丁字符串断言，journal 单调性归数据库 owner，UI 保留复用/未知/损坏及真实发送行为。REG 历史留在 corpus，不建立第二份手工索引。

原 `four-source-feed.ad` 收窄名称为 `tests/device/feed-source-controls.ad`，明确只拥有来源控件和 All/V2EX 请求结算；它接受 error outcome，不能证明四站真实数据或详情加载。对应 43 项 tooling 检查通过；真实读取仍由 Agent Live 独立结算。

原生机械迁移阶段已取得首次 fresh prebuild、`:forum-platform:testDebugUnitTest` 和 `:app:compileReleaseKotlin` 成功证据；G2 五个 Native owner 共 17 项通过（0 failure/error/skip），移除 generation、请求绑定事件和禁合并保护时共 6 项准确失败；同 key 的真实 A→B 换绑另有 [A,B,B] 请求数红灯。修复后同/不同 key 都恰有 2 次请求与 onLoadStart/onDisplay，旧队列不 clear B，实际 Drawable/source 保持 B；重新包装同 model 不妨碍合法 resize。两份 patch 的适用性检查 13 项通过。这些是受控 Native `UNIT_PASS`，不冒充设备显示或物理触感。

首轮全仓检查的两个失败均为旧引用路径 fixture：仍拦截 `/t/id.json`，而引用已改为 `/t/id/floor.json?include_raw=true`。两处更新后分别用原 seed `1789788414327` 重放 3 项和 65 项通过；未放宽生产主题/楼层身份校验。

最终 `npm run verify` 在 Node 22.22.2 下退出 0：211 个 Vitest 文件、2699 项通过，seed `1789788633960`；79 个 UI 套件、1639 项通过，seed `-251246342`；28 项文档 checker 测试、架构/格式/Lint/严格类型/未使用代码/版本检查通过。独立 `npm run typecheck` 与 `git diff --check` 也通过，取得对应 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`。不同阶段用例有重叠，不累计为新增测试总数。

`WRITE-05` 取得隔离 Android `DEVICE_REPLAY_PASS`：`WZ_ReaderStorage_API35_20260910` 的 API 35 Release/Hermes/真实 expo-sqlite，在 PID `4132 → 4419` 两进程验证 8 并发 claim 唯一胜者、独立原生连接竞争、已知 ID 单调和冲突拒绝、38 条记录不淘汰、旧 known/unknown 迁移、损坏旧数据跨重启阻断、ReaderData 导入清空不影响 journal。逻辑 ReaderData 原样恢复，本次 token 对应测试记录已删除；`firstInstallTime=2026-09-10 04:04:05` 不变。proof APK SHA-256 为 `1b6ea63a3e84720dcea59d7f3eb77dd597e605dd87cfb7fdeb1d89b70a41641b`，回执位于 ignored `.codex-tmp/poll-journal-proof-20260919/receipt.json`，专用模拟器已关闭。

原生迁移、文件与图片行为六组 owner 分别为 forum-platform 137、selection 27、App 13、ReactAndroid 16、Expo FileSystem 7、Expo Image 8，共 208 项通过；Expo 组在真实 source 换绑补强后单独取得新鲜 8/8 XML，forum-platform 在备份回调归属及响应体中断补强后完整取得 137/137。固定 buildId 的两次 clean fresh prebuild 生成 63 个文件的 SHA-256 完全一致，三个迁移能力均只注册一次，诊断→网络→React Native 启动顺序不变。

`ImageDownloadTest` 补响应体中途断连和原 Call deadline 在读 body 时到期的同一参数化 owner，要求已打开输出文件后失败且目录无残留。定向 ImageDownload 4 项与 BackupExport 6 项也全部通过，与以上 208 项重叠，不重复相加。

最终两份图片补丁另在独立 pristine 依赖目录验证安装性：官方 tarball SHA-512 与 lockfile 一致；实际 forward apply、reverse/check、逐字节恢复后运行真实 npm postinstall/patch-package 8.0.1 均通过，两种应用产物的完整包目录哈希一致。验证未改动正在构建的工作区依赖；25 个涉及源码前后哈希一致。证据为 ignored `.codex-tmp/patch-forward-proof-20260919/verified/receipt.json`。

普通入口候选 `1.3.147/151`（SHA-256 `6adff0764e4b99c8329946d9a7e824748678623f6099db90ee9e1e3a3f3c15d3`）在主 AVD `WZ_Pixel_API_35` 完成 `APK_SANITY`，`feed-source-controls.ad`、`library-return.ad`、`notifications-readonly.ad` 三条 `DEVICE_REPLAY_PASS`。签名与原安装一致，首次安装时间保持 `2026-07-26 16:51:37`。这个候选在后续备份 Activity 重建和 SVG 复用修复之前构建，不能代表这两项修复的主设备验收。

同一候选取得四站 `LIVE-READ-01` 的 Feed→Topic 数据及返回流程 `LIVE_PASS`。NodeSeek 看到详情加载中后切后台，返回时正文已加载；其多页样本倒序先显示读取最新回复，再出现 #590 起的下降序列，继续滚动截图为 #579–575。linux.do 短主题回复数 3、楼号 2–4，倒序 4→2 后恢复；妖火短主题 1–4 同样正确往返。完整四站多页原站对照仍为 `NOT_VERIFIED`：NodeSeek 后续滚动出现 agent-device accessibility helper 无法取得前台内容，实际截图正常、PID 不变且 Back 后 helper 恢复；尚未证明是产品无障碍缺陷，未通过替换采集引擎伪造通过。

通知 Live 中 NodeSeek 的部分解析结果保留有效条目并显示不完整提示；linux.do 返回需要登录。随后只读取账号状态标签并执行既有刷新，确认 linux.do 为“已验证”但非登录，其余两站已登录；安装前 3/3 来自当时 UI 投影，且原包已经显示部分站点不可用，现有证据不足以确定登录失效时间或归因本次迁移。按 AGENTS/runbook 冻结主设备后续安装、配置和凭据变更，没有清 Cookie、自动登录或恢复旧快照；主设备保留该候选与当前现场，Agent 会话已释放。linux.do 认证通知与最终备份修复的主设备覆盖验收记 `BLOCKED_BY_ENV`，原生文件验收在隔离 AVD 独立结算。只读回执在 ignored `.codex-tmp/implementation-main-device-20260919/`。

用户随后反馈主模拟器窗口黑屏：只读检查时，Android 内部截图为正常“更多”，主 App PID 未变化，Display=ON 且 Windows 窗口进程响应正常；电脑端漏绘制的根因未确认。按用户随后明确要求，关闭两台 AVD 并以可见窗口重新启动，未使用快照、清数据或更换 APK；两个首次安装时间分别保持 `2026-07-26 16:51:37` 和 `2026-09-07 17:29:25`。这次授权仅覆盖重启与显示窗口，主设备后续安装和凭据变更继续冻结。两台可见窗口按用户要求保留，属于进程基线的明确例外。

系统备份的首个实现经真实 Activity.recreate 反例发现原 Promise 不结算：锁定 Expo activity-result registry 在 Activity 销毁时 unregister 其主回调，默认 fallback 不负责完成原调用。现改为模块自身的 OnActivityResult 与每次调用的请求码，JSON 保留在原调用内存；Activity 重建后完成原保存，真正模块销毁明确拒绝并停止写入。受控验证中的 malformed result 同样不能在主线程直接抛错。

备份的 6 项 JVM 测试覆盖完整 UTF-8 写入与关闭、关闭失败、取消中断、无效返回，以及模块销毁/替换后迟到回调和写入期间的并发拒绝。移除请求码匹配后，“旧 Activity 结果不能结算新调用”准确失败；还原后完整模块 136 项通过。打开 provider 前、写入循环内和完成后均检查调用有效性，不能在已经销毁的调用上开始截断目标文件。

设备 proof 与 runner 的相关改动另跑 85 项 tooling（seed `919207`）全部通过；收尾 Lint、全仓格式检查、TypeScript noEmit、28 项文档 checker、14 份文档引用与 555 个模块的架构检查通过。这轮定向复核与前述完整 verify 有覆盖重叠，不相加。

`TOPIC-02` 原生下载取得独立设备证据：同一 imageCallFactory 在隔离 API 35 AVD 下载 1/25/100 MiB 固定缓冲样本，字节数与 SHA-256 全部一致，Java 堆峰值增量分别为 286768/401472/315424 字节（约 0.27/0.38/0.30 MiB），采样 PSS 增量 534/615/264 KiB。此处测量包含同进程固定缓冲 HTTP fixture，不是物理设备或所有图片格式的内存上限保证；结合 JS→Native 接口只返回文件元数据，证明该路径没有随文件大小增长的 JS 全量二进制/Base64 中转。取消产生 Socket closed，真实输出打开失败产生 EACCES，两者均清理本次临时目录；EACCES 不能冒充 ENOSPC，实际磁盘耗尽仍为 `NOT_VERIFIED`。原始数据在 ignored `.codex-tmp/platform-export-instrumented-retry.log`，该轮后续系统文件联合用例失败不覆盖这两项独立通过的下载用例。

`DATA-03`、`MORE-02`、`TOPIC-02` 的真实文件联合 owner 最终取得 `DEVICE_REPLAY_PASS`：Release/Hermes、正常 Expo 桥接、系统文件界面完成 5 MiB/Unicode JSON 保存和逐字节重新导入；取消与并发拒绝、Activity 重建后原 Promise 结算、真正 MODULE_DESTROY 后原调用拒绝均通过。远程小 PNG 经原生下载和 MediaLibrary 写入 MediaStore，重新解码后清理本次相册条目和临时文件。

诊断接收方是测试 APK 的独立 UID：真实 Sharesheet 将内容 URI 交给接收 Activity，再由带 READ flag 的 Intent 转交其短命 Service；原分享 Promise 返回后才触发延迟 3 秒读取，长度和 SHA-256 与导出文件完全一致。临时授权由 Android 维持至 Service 停止，采用 [Android Service 的标准 URI 权限机制](https://developer.android.com/reference/android/app/Service#Permissions)，没有改生产 Sharing 授权或添加永久 grant。通过回执为 ignored `.codex-tmp/platform-export-service-device.log`，App proof buildId 为 `e3223b0bf51e4b21a23967875d6b3bf7`，SHA-256 为 `8bd99d970ded49c723586f889a09607c713165f70a06dd71117d2c3f851762b6`；测试结束恢复临时图片权限、停止接收 Service，并只删除本次 provider/诊断/缓存文件。

旧 SVG 设备 owner 首轮十请求队列触发 30 秒总期限，随后独立二请求重放仍失败，故已撤回“批量压力导致”的初步归因。二请求保留 WebView 复用、排空释放、缓存命中与真实像素的全部断言，32 容量边界另由既有 JVM owner 负责。排查时生产 `SvgRendererModule.kt` 与基线旧路径内容去除换行差异后完全相同；动态 SVG 同设备通过。5 秒时的测试侧取证确认第一张已完成，复用后的第二张 prepared=true，但 WebView.url 为 data:、expectedPageUrl 为请求专属 https URL，visualStateRequested=false。原始失败见 ignored `.codex-tmp/platform-legacy-host-final.log` 和 `.codex-tmp/platform-legacy-targeted-device.log`。

用户授权纳入 `REG-TOPIC-180` 后，单补 historyUrl 的 proof 仍失败，记录在 ignored `.codex-tmp/platform-svg-fixed-final.log`。设备实际 WebView 为 124.0.6367.219；对应 [AwContents 源码](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.219/android_webview/java/src/org/chromium/android_webview/AwContents.java) 将与已提交 URL 相同的加载标为 RELOAD，而 [LoadUrlParams 源码](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.219/content/public/android/java/src/org/chromium/content_public/browser/LoadUrlParams.java) 为不同 HTML 使用相同的内部 data URL。结合实测，修复定位于复用前清空导航尚未完成：现在等待当前 View 的 about:blank 完成且 URL 一致后再开始下一张，销毁、队列全部超时和渲染进程退出时释放相应状态，historyUrl 显式使用 pageUrl，原精确身份 guard 与 30 秒总期限保留。

同一 SVG owner 最终 2/2 实际执行通过、无跳过，耗时 5.395 秒，取得 `TOPIC-02 DEVICE_REPLAY_PASS`：静态二请求队列、缓存命中、单 View 创建与排空销毁、真实位图尺寸和非透明像素，以及动态 SVG 帧推进且不访问外网。proof buildId 为 `f1f4d59ebf1e4eddaf1088a358edb0fe`，SHA-256 为 `0bcd84cce4e69a703a0c0601d57d3289c8141da69a792a690bffd77890d62485`，回执在 ignored `.codex-tmp/platform-svg-barrier-final.log`；测试仅清理本次海报文件。`REG-TOPIC-180` 已关闭，其他 WebView 版本的设备行为仍未逐一验证。

Cookie 的八次独立进程阶段均实际执行并通过，无 Assumption 跳过：HTTP 更新持久化的退出前/重启后两次，以及 WebView complete/error/cancel 三种终态各退出前/重启后两次。证据为 ignored `.codex-tmp/platform-cookie-restarts-final.log`。默认 host 测试内等待阶段参数的四个 Assumption 用例不计通过数量。

SVG 修复后的最终源码重新编译并通过 SvgRendererPolicy 13 项与 App 13 项，全部零失败/错误/跳过；与前述 208 项重叠。日志为 ignored `.codex-tmp/platform-final-svg-policy-app-jvm.log`。普通开发签名 Release/Hermes APK 的 buildId 为 `5d899195d6b34f9081bec1783797d289`，版本仍为 `1.3.147/151`，SHA-256 为 `03c09ee1d7e06615f9cc4bff8a1161daeb2d2e74b425ea864b671cc982bfde28`；文件为 ignored `.codex-tmp/review-remediation-final-apk/wz-reader-1.3.147-151-5d899195-x86_64.apk`。它仅含 x86_64，非 debuggable，签名与原安装一致，不含 proof 入口和 loopback 网络配置；未执行正式发布或版本递增。

该最终普通包在隔离 `WZ_ImageRuntime_Test_API35` 取得 `APK_SANITY`，首次安装时间保持 `2026-09-07 17:29:25`，临时图片权限已恢复，验收会话已关闭；日志为 ignored `.codex-tmp/platform-final-apk-sanity.log`。该阶段主设备仍保留此前候选与登录现场，两台可见模拟器均运行，其余本任务测试进程按归属清理。后续主设备安装与登录条件变化见以下补验记录。

### 主模拟器最终包与登录后补验

用户随后明确要求只保留主模拟器并安装最新代码：已关闭验收 AVD，只对 `WZ_Pixel_API_35` 执行覆盖安装。重新读取的最终包 SHA-256 与上述 `03c09ee1…de28` 一致，签名一致，`firstInstallTime=2026-07-26 16:51:37` 不变；普通入口启动正常，取得主设备 `APK_SANITY`。用户亲自登录并通知继续后，账号中心 canonical 刷新确认三站均已登录，原认证通知与最终包覆盖的阻碍解除。安装回执在 ignored `.codex-tmp/main-final-install-20260919/`，本次只读回执在 `.codex-tmp/main-live-final-20260919/`。

| 入口 | 最终包上的实际 Live 证据 |
| --- | --- |
| `ACCOUNT-01/04`、`NOTIFY-01/03` | 三站账号刷新保持登录；实际重启 App（PID `4100→9890`）后再次 canonical 刷新仍为三站已登录，取得此登录保持分支 `LIVE_PASS`。linux.do、妖火通知读到真实数据；linux.do 未读筛选显示合法空态，切回恢复原列表，取得对应读取流程 `LIVE_PASS`。NodeSeek 保留有效条目并显示部分解析提示；提示流程通过，通知完整性 `NOT_VERIFIED`。未打开或标记任何消息已读。 |
| `TOPIC-01/03`：V2EX | `1233404` 当前显示 174 条；正序跨 #100→101 读到 #174，倒序跨 #101→100 回到 #1，两端提示及重复触底稳定，取得该分页流程 `LIVE_PASS`。恢复正序、全部内容与空查找。历史 147 条不再当作当前总数。 |
| `TOPIC-01/03`：NodeSeek | `861053` 当前端点为 #1、#16；倒序先显示读取最新回复，再显示 #16，正序确认 #10→11 跨窗，两端提示成立，取得该分页流程 `LIVE_PASS`。采集中的引用楼号另行排除，不把所有 `#数字` 当成回复行。 |
| `TOPIC-01/03`：linux.do | 从热门列表前五项选择“智谱修复了 zcode 代码上传的问题”；显示 67 条，首尾 #2、#68。倒序先读取真实尾窗，两方向逐窗抵达端点并显示对应末端提示，取得该分页流程 `LIVE_PASS`。恢复正序和来源列表的“最新”筛选。 |
| `TOPIC-01/03`：妖火 | `1560939` 倒序先读取最新窗口，再显示 #558；续读回 #1，重新进入恢复正序并续读至 #558，两端再次触底可见内容稳定。全程存在部分内容提示，初始 12 条、后续 90 条是已加载数量，不能当作全帖总数；部分页使末端完成提示保持隐藏。两个方向的序列与续读已观察，完整性和完整末端 oracle 为 `NOT_VERIFIED`，没有依据将缺失楼号归因为删除或解析丢失。 |

本次只结算观察到的读取与分页流程，不宣称逐条正文无缺失或全量去重已验证。`LIVE-READ-05` 的同账号原站对照与实际 cursor/请求预算仍为 `NOT_VERIFIED`：“原站打开”实际调用外部浏览器，不能假设共享 App 登录态；可见末端稳定也不能证明零额外 transport。linux.do 旧长文 `342888` 的回顶曾触及 agent-device 滚动安全上限，随后返回与其他目标正常；这是采集限制，不记为产品失败。实际 ENOSPC、物理设备与其他 WebView 版本继续保留既有验证边界。

收尾恢复首页“全部”、来源筛选及通知“全部/关闭只看未读”，账号中心收起；只保留响应正常的主模拟器可见窗口，App 位于前台。自动化会话关闭，仅停止通过 PID、创建时间、路径和父进程核对的本任务 daemon，保留共享工具与 ADB。本次补验只更新证据记录和待验收索引，`npm run check:docs` 与 `git diff --check` 通过，取得文档 `STATIC_PASS`，未以此扩大此前运行测试的结论。

### 同账号原站对照与追加验收

用户要求继续后，通过 App 自有 WebView 的现有认证会话执行只读 GET，只导出响应结构、页码、楼号和数量，没有读取 Cookie、凭据或输出私信正文。独立 CDP 转发端口仅用于本次取证，随后移除。证据在 ignored `.codex-tmp/main-acceptance-extra-20260919/`。

- `NOTIFY-01/03`：NodeSeek 私信列表四行均没有 id、均有唯一正安全整数 max_id，原站前端明确用它作 latestMsg.id。实际 adapter 因只认 id 而退回不可信时间身份；已修复并保留非法数据的质量防线。升级复核又证实旧 worker 曾将 fallback 存入可信 ledger，直接换 ID 会误投递旧未读。共享推进函数现在仅对可确认含旧私信 fallback 的 NodeSeek 基线，在整轮可信扫描后静默重建，partial 不写状态，下一条新消息只投递一次。`REG-NOTIFY-072` 保留全部事故与边界。
- `TOPIC-01/03`：妖火 `1560939` 原站第 19 页有 12 行且本身缺 #10，第 1 页有 30 行且缺 #528/#529，第 2 页 #497–526 连续。生产 parser 全部正常读取；基线既有 hasFloorGap 误把稀疏页标为 partial，连带改变数量提示并隐藏末端。隔离复现器在生产 reader 上 5 红/14 绿，仅 ignored 候选去掉连续性要求后 19/19 绿，解析丢行、缺明确楼号、错误分页与边缘防线仍在。此计划外既有问题登记为 `REG-TOPIC-181 OPEN`，待用户确认纳入；未将候选写入产品或 APK，也不猜测缺号来自删除。
- `TOPIC-01/03`：同账号 linux.do 原站确认上轮“智谱修复了 zcode 代码上传的问题”为 `2922301`，本轮已增长至 posts_count/highest_post_number=72，目标窗口实际为 #1–20 与 #53–72。此处请求没有 track_view/track_visit/timings 写入；原站窗口和请求耗时只证明这两次诊断读取，不能代替 App 的 cursor 或预算证据。
- `TOPIC-02`：当前生产 `streamImageDownload` 编译产物直接向 Linux `/dev/full` 写入，系统调用实证为 `write(..., 8192) = -1 ENOSPC`，异常为 No space left on device；输出流关闭、responseBodyEnd/callEnd 各 1、本次 part 文件 0。生产类及源码 hash 前后一致，取得此 host owner 的 `UNIT_PASS`；没有填满宿主磁盘、挂载设备、操作主模拟器数据。Android 文件系统实际耗尽、MediaStore/SAF ENOSPC 仍 `NOT_VERIFIED`。回执位于 ignored `.codex-tmp/host-enospc-6d641b2efc9943a5b900f0e90a491ac1/`；临时启用的 WSL 恢复为 Stopped。

NodeSeek parser 新行为修前 3 项失败，升级组合 oracle 修前错误投递 1 条；Node 22.22.2、seed `19092026` 下，修后 adapter/gateway/store/worker/delivery 五 owner 共 168 项通过，另两组通知 UI 110 项通过。最新完整 `npm run verify` exit 0：Vitest 2718 项/211 文件（seed `1789822804246`），UI 1639 项/79 suites（seed `-983596622`），其余静态、架构、文档、unused/type 和版本检查通过；定向数量与全量重叠，不相加。`npm run typecheck` 及补修后的 noEmit 也通过。

最终普通包 buildId `cf99814e46cc45e18d019affb7ffade1`，SHA-256 `caceeb4941b35f8c8e23b42e79505616ac30b0580de458500d9ed668fd12f04d`，仍为 `1.3.147/151`、开发签名 Release/Hermes/x86_64、非 debuggable，无 proof 入口和测试网络配置。归档 source map 同时确认 maxMessageId 与 legacyNodeSeekMessages 进入本次 bundle。只对主设备保留数据覆盖安装，签名及 `firstInstallTime=2026-07-26 16:51:37` 均不变；中间候选 `335f86fa…` 未安装。主设备普通启动通过 `APK_SANITY`，账号 canonical 刷新后三站仍已登录；NodeSeek 全部与私信两种列表均实际到达 `notification-outcome-data-nodeseek`，不完整提示消失，取得对应读取分支 `LIVE_PASS`。没有打开消息详情、标已读或发送站点消息；升级投递去重是受控真实 store 证据，没有伪装成真实站点新消息推送。

`TOPIC-01/03` 与 `NAV-02/03` 追加四源页面恢复 `LIVE_PASS`：分别直达 V2EX `1233404`、NodeSeek `861053`、linux.do `2922301`、妖火 `1560939`，启动命令后约 0.08 秒执行 HOME，并从系统 resumed Activity 确认 App 已退后台；24–78 秒后返回均到达真实 `topic-detail-loaded`，核对来源/内容，PID 始终 `11881`。linux.do 恢复至新增 #70 附近。此处没有观测 transport 开始/完成，不能证明网络当时仍在途、跨后台沿用原 deadline 或请求超时路径；妖火能恢复主楼也不关闭上述稀疏回复问题。独立回执为 `background-<source>.json`。

主设备诊断分享文件已成功生成，但系统 Sharesheet 的 Save 提示不能保存文本，未交给远端目标。已准备无网络权限的独立本地接收工具，安装与移除例外待用户确认；当前未安装。精确 App 请求开始/结束、重复触底 transport 次数和完整四源截止时间矩阵暂不能从导出日志结算。物理设备、其他 WebView 版本、真实 provider 写入/关闭故障与 Android ENOSPC 继续明确保留未验证边界。

本轮收尾回到首页全部来源，通知恢复全部来源/全部分类且未切换未读设置，账号与诊断面板收起。只连接 `emulator-5554`，可见窗口 `WZ_Pixel_API_35` 响应正常，App 为 topResumedActivity；临时接收器未安装。自动化 session 关闭，核对基线及 PID/创建时间/路径/父进程后仅停止本任务 daemon；共享工具、ADB 和主模拟器保留。最终文档 checker 28/28、文档引用与 `git diff --check` 通过。

### 妖火稀疏回复误报修复

用户随后明确要求“修复”，将 `REG-TOPIC-181` 纳入范围。实际产品变更只在 `getYaohuoRepliesDirect` 删除楼号连续性推断，完整性继续由解析质量与已确认窗口决定；没有修改分页算法、楼号、UI 分支、计数口径或缺首楼的边缘策略。正式 `src/sources/yaohuo/reader.test.ts` 纳入五个稀疏窗口场景，修复前 5 失败/83 通过；既有 inferred/truncated 用例补强 partial 与 watermark 断言，并添加可读稀疏响应落入错误 cursor 页的拒绝用例。修复后 reader/gateway 三 owner 161 项通过（seed `691905`），保留既有 UI owner，不另复制一套末端判断测试。

Node 22.22.2 下 `npm run typecheck` 和最新全量 `npm run verify` exit 0：Vitest 2724 项/211 文件（seed `1789824285971`），UI 1639 项/79 suites（seed `235436373`），静态、架构、文档、unused/type、版本检查均通过；上述定向测试与全量重叠，不相加。普通开发签名 Release/Hermes 包 buildId `887fe3669fc343f689cca4908478c96f`、SHA-256 `65d594064959292b5a7b4488bf56967773148d1d4cde464ad3ccc1e22159364c`，仍为 `1.3.147/151`、x86_64、非 debuggable。APK 内 buildId、Hermes、无 proof 配置及归档 source map 的新判断均已核对；主设备同签名覆盖安装后，实际安装 hash 一致且 `firstInstallTime=2026-07-26 16:51:37` 不变。证据与构建产物在 ignored `.codex-tmp/yaohuo-gap-fix-20260919/`。

该普通包完成 `TOPIC-01/03 LIVE_PASS`：原帖 `1560939` 正序从首窗沿真实相邻页续读，缺号 #9→11 正常显示，最终 #558 下出现“已到最新回复”；重新进入后回复标题显示 558 且无 partial 提示，切倒序从 #558 沿相邻页读到 #1，显示“已到最早回复”。两端各再触底一次仍稳定，真实截图与楼层/状态观察已归档；没有把引用中的楼号当成真实回复头，也不将视口观察扩张为逐条全文比对或精确 transport 次数证明。错误分页、真正缺楼号和截断的防线由正式 owner 证明，保持 `UNIT_PASS`；既有末端及 partial UI owner 随本次全量取得 `UI_PASS`，本包普通启动取得 `APK_SANITY`。`REG-TOPIC-181` 关闭。

收尾账号 canonical 刷新后三站仍已登录，账号面板收起并恢复首页全部来源，退出主题即释放本路由的倒序选择。未提交、发布、执行站点写入或安装临时日志接收器；后一项授权仍不属于本次“修复”。原计划中精确请求时序、设备 ENOSPC、物理设备与其他 WebView 等未验证范围继续保留，不能由此项通过一并关闭。

### 全量验收继续：后台、持久化与干净安装

用户明确授权临时开启可见隔离设备，完成后关闭；主 `WZ_Pixel_API_35` 及登录保持不动。后续证据保存在 ignored `.codex-tmp/acceptance-complete-20260919/`。以下是本轮新增分支，不将旧项目全部未验收项一并关闭。

- `NOTIFY-01/03 DEVICE_REPLAY_PASS`：真实 Store 与 Android system sink 的运行时入口扩充至 44 项，两次匹配源码构建均通过。新增 partial、invalid、旧 fallback 三类流程都核对失败不提交、首次可信扫描静默、第二页失败不提交、重复分页只投递一次及保留可信未读数。最终 proof buildId `cc4f5b2caa6d492490a61a296332e39a`，SHA-256 `bcaff58c349a2fb6bb34c00c1664b5dca25a7ff96671ee2bc2e473dbcedf9581`，数据库 checkpoint 独立还原核对通过。
- `NOTIFY-03` 新事故 `REG-NOTIFY-073` 已获用户授权并修复。普通包后台任务在 156.9 秒后返回前台才超时；真实 RN AppRegistry 与 Expo TaskManager 源码/发布入口均复现空 headless 提前 resolve。补丁把完成权保留给原生 TaskService。隔离 API 35、Release Hermes、真实 JobScheduler→WorkManager→Expo 链中，正常轮 528 ms 完成，故意挂起轮 50034 ms 按原 50 秒 deadline 失败且账本不变；两轮 App 始终 background、PID 稳定，原生 headless 均结束。取得这一受控后台执行分支 `DEVICE_REPLAY_PASS`；自然唤醒和厂商省电行为未由强制 job 证明。结束注销测试 task，恢复通知权限和数据库。
- `DATA-02 DEVICE_REPLAY_PASS`：settings read、cleanup remove、cleanup keys 三种挂起，在真实 Android SQLite/AsyncStorage 上分别经 seed→挂起→新进程 verify 共 9 阶段通过，约 3.2 秒启动。已读 ReaderData 保留、迟到 sidecar 不覆盖、cleanup_pending 下一进程重试成立。
- `WRITE-05 DEVICE_REPLAY_PASS`：真实 action builder/client/request/journal 链在最终合成 transport 前，从另一 SQLite 连接看到已提交 claim；已知结果、明确未发/拒绝释放、不明响应保留、跨账号隔离及网络等待不占事务均通过。真实请求 Promise 尚 pending 时由 runner force-stop，PID `8443→8557`；重开保留未知/已知记录，重试 transport 次数为 0。仍使用合成终端，没有创建真实投票。与上条共享 proof buildId `207a3015451343a0941f35d0928c8803`、SHA-256 `52991ed0a9f9e32c62cdb0c305c2cb269c49f89dc1c3f627ea2efc98fb8852f9`，全部结束后六个白名单数据库及逻辑快照回到基线。
- Node 22.22.2 / npm 10.9.7 的干净 `npm ci --ignore-scripts` 首次发现锁文件缺少 `@emnapi/core`、`@emnapi/runtime` 可选 peer 记录；只补这两项，不升级已锁包。修后干净安装 1321 个包、14 个补丁逐一 forward check、真实 postinstall 和 reverse check 全部通过；Composer 构建成功，headless 实际源码与工作区一致。此项是依赖安装 `STATIC_PASS`，不是设备运行证据。
- ARM64 普通开发签名 Release 包完成编译和 ABI/非 debuggable 检查：buildId `df954e4f605b4250b12e7ce30d80d302`、SHA-256 `3f9253ffae00db95644e51dfd785c7ccaa2d2c20a6b9b69ee4e5ce6d53d02b15`。该构建早于本轮 headless 补丁，且未安装真机，只记此前源码的 ARM64 compile 证据。

后台 runner 的首两次失败分别来自 ADB date 参数和 logcat tag 采集配置，均在业务测试后安全还原数据库；修正采集后取得上述完整回执。干净安装后字节比较还发现工作区编辑工具补上的末尾换行，已按真实 patch-package 产物校准，不将换行差异归为运行行为。

### 最后边界复验：请求时序与文件失败

`TOPIC-01/03 UI_PASS`：在真实 Route、Account、Query、gateway 上补两条组合用例，只隔离外部 Fetcher/WebView。第 4 秒切后台，LinuxDo direct 仍在原第 8 秒到期，后续 hidden-browser 在总第 23 秒到期，返回前台不重新请求；首次冷请求经真实导航失焦取消，返回同一保留页面能恢复。该 owner 8/8 通过（seed `691919`），类型与定向 lint/format 通过；四源差异继续由已有 controller 矩阵负责。

按本轮继续验收授权，主设备已临时安装无网络权限、独立 UID 的本地诊断接收器；先前“未安装／尚无 transport 证据”是前轮状态。两份实际分享文件分别完整接收 16508007、16796679 字节并核对 SHA-256。`.codex-tmp/acceptance-complete-20260919/request-assertions.json` 验证四源请求都是开始→切后台→成功结束→回前台，耗时 V2EX 645、NodeSeek 634、linux.do 646、妖火 1961 ms。妖火同帖双向各 19 页的每个原生调用均成功；两段末端重复触底观察区间内新增调用为 0。当前 writer 无丢弃／损坏／写失败，但历史累计丢弃及写失败计数非零，因此结论限于已匹配事件与这些观察区间，不扩张为四源所有 cursor 或全历史零丢失证明。

`DATA-03` 关闭错误反例纳入原方案已明确授权的 provider 失败范围，登记 `REG-DATA-012`。独立 UID provider 已 closeWithError 后，旧生产输出工厂仍误返回 32768 字节成功；测试屏障只等远端报告完成，不注入抛错或替代生产检查。改为可靠描述符检查后，同一 owner 验证 Promise 拒绝、原错误文本及本地 FD 关闭；EIO/ENOSPC 与真实非空图片 part 的清理也通过。使用 Android [ParcelFileDescriptor 的错误检测协议](https://developer.android.com/reference/android/os/ParcelFileDescriptor)，不等待未来云端同步，不删除用户目标文档。

最终文件 proof buildId `45216987f0e440a9ba147ee2f0513316`、APK SHA-256 `64447fc696583150bc251730b1a45234121add901b850197e9cd9e6f273dca4f`，test APK SHA-256 `18b3fc9ec738096e4ab8e4c859908cf6e70b803b156b676ac66ca4abc67c9db5`。4 项故障检查全部 `DEVICE_REPLAY_PASS`；既有真实 SAF 保存／重新导入、取消／并发、Activity 重建／模块销毁、相册写入、跨 UID 延迟分享联合 owner 再次 1/1 通过，BackupExport JVM 6/6 通过。原始红灯和最终绿灯分别保留于 `provider-close-red.log`、`provider-faults-green.log`、`platform-exports-final.log`。图片权限及六个数据库文件恢复，独立逻辑 hash 回到 `930e0e95ef14ab7eb9f3a74ea9099a02e6f9f2c2b6d159dbd89565a17b7a4acf`。

此处 ENOSPC 是实际 Android provider 在部分写入后返回的受控错误，涵盖错误传播、操作释放和临时文件清理；没有填满整个分区。物理设备／OEM 省电、其他 WebView 版本、自然后台唤醒与未授权原站写入仍不由这些 replay 证明。

最终普通入口开发签名 Release/Hermes 包保留版本 `1.3.147/151`，同时包含 ARM64 与 x86_64：buildId `63ada67c8c5c454aa7cd6ed717c62aa1`，SHA-256 `91ed4241ac5c6bb8a972766b0b6f9ec13cd0da65443959710ffb390aeb14b3b9`。重新 prebuild/编译成功，APK 无 proof 深链或测试网络配置、非 debuggable，归档 source map 包含 headless 修复。主 `WZ_Pixel_API_35` 同签名覆盖安装后实际 APK hash 相同，首次安装时间仍为 `2026-07-26 16:51:37`；正常启动进入首页，安装前后三站 canonical 账号刷新均已登录，取得 `APK_SANITY`。这些证据不等于 ARM64 真机运行。

同一最终普通包额外取得后台 `DEVICE_REPLAY_PASS`：强制现有 WorkManager job 后一直停留系统 Launcher，App PID `17260` 不变；本机诊断确认 `notification-background-task` 在 2429 ms 成功结束，真实 worker 在 2424 ms 完成且本轮无新投递，原生 headless 在 2430 ms 收尾，早于返回前台。第三份实际分享日志完整接收 16344007 字节，SHA-256 `44f948b17af41ef1f95d742a15331f432b4da3e56265740eb2894a93ca223a2c`；回执为 `.codex-tmp/acceptance-complete-20260919/main-final-background-receipt.json` 与 `.codex-tmp/acceptance-complete-20260919/main-final-background-events.json`。独立只读复核确认原生 TaskService 拥有最后 eventId 的结束权；桥失效、冷启动与自然调度不因此获得通过声明。

隔离 `WZ_ReaderStorage_API35_20260910` 全部验证结束后恢复原六个文件、逻辑快照和临时权限，核对首次安装时间不变，再关闭本轮开启的可见模拟器。两处已知归属的干净安装临时目录清理被自动审批以 `blocked by policy` 拦截，未换用其他工具绕过；目录保留，运行证据已归档。

最终门禁使用 Node 22.22.2：212 个 Vitest 文件 2729 项通过（seed `1789831834909`），79 个 UI suite 1641 项通过（seed `-138724389`），包含新增两条 Route 组合用例。此前与原生编译并行的一轮仅视觉样本两主题渲染超过 5 秒，原 seed `751418400` 定向 5/5 重放通过，其中该用例 2393 ms；没有提高超时或修改测试，随后无原生编译并行的整轮 UI 全通过。第二轮 verify 在文档阶段检出一处省略 ignored 目录的回执路径；修正路径后重跑文档与剩余静态门禁，不重跑已通过且代码未变的逻辑/UI owner。`npm run typecheck` 也通过。上述各轮覆盖有重叠，不累计相加。

收尾主设备保留最终普通包和三站登录，恢复首页全部来源，账号及诊断面板收起。临时本地接收器已卸载，主 App 未卸载或清数据；生产导出文件继续遵守 24 小时保留期。Agent 设备会话已关闭，核对无活跃会话及 PID/创建时间/路径后停止本任务启动的 daemon，只保留主模拟器可见窗口，未提交、推送、发布或执行真实站点写入。

### 异 WebView 与 SAF 重名补验（2026-09-19～20）

`TOPIC-02` 的旧证据为 `WZ_ImageRuntime_Test_API35`、WebView `124.0.6367.219` 上 SVG 两项通过，耗时 5.395 秒，proof buildId `f1f4d59ebf1e4eddaf1088a358edb0fe`，记录在 ignored `.codex-tmp/platform-svg-barrier-final.log`。本轮按用户授权可见启动独立 `WZ_ComposerInsets_0916`（Android 35），直接使用其已有 `com.android.webview 156.0.8062.0`，没有下载、安装或切换 WebView。该组件安装时间为 `2026-09-16 09:31:00`、发起方为 `com.android.shell`，原下载来源未知，不能宣称是官方稳定发行版；本轮没有操作主 `emulator-5554`。设备与组件原始信息保存在 ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/webview-before.txt` 和 `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/webview-package-before.txt`。

为等版本恢复该隔离设备原包，临时 Gradle overlay 只把本轮 Android proof 包版本设为 `1.3.146/150`；`app.json`、`package.json` 与生产版本未改。proof buildId 为 `02711558e9004bff8210198ba7f1a852`，App APK SHA-256 为 `c7374597b84ffb6e2a04340bf0cc4b85e73dcf77eee93f413a20db543d4504aa`，test APK SHA-256 为 `9d13924005b6bea3b2f2dd0b71d0d2110ddaa83479c5d5f4a4b69adcc564fdac`；实际为开发签名 Release/Hermes/x86_64、`BuildConfig.DEBUG=false`，manifest 仅为取证设为 debuggable。JS 诊断常量仍来自当前源码 `1.3.147/151`，因此设备 receipt 中的版本字段为 151，buildId 与本轮 APK 一致；它不是普通 150 发布包。身份、source map、测试源码 hash 与 overlay 见 ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/proof-build/metadata.json`。

| evidence owner | 本轮实际结果与边界 |
| --- | --- |
| `TOPIC-02` / `SvgRendererInstrumentedTest` | `DEVICE_REPLAY_PASS`，2/2、6.011 秒，零失败/跳过。静态二请求复用一个 WebView、缓存命中不重建、排空后销毁、位图尺寸与有效像素均成立；动态 SVG 帧推进且阻断外部资源。日志：ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/svg-webview156.log`。 |
| `ManagedCookieResponsesInstrumentedTest` 的两项平台用例 | `DEVICE_REPLAY_PASS`，2/2、0.2 秒，零失败/跳过；真实 HTTP 更新/删除、取消后的合格响应及平台 Cookie 属性/定向过期。只使用随机合成 Cookie 名，不读取或删除账号 Cookie，不包含跨进程重启阶段。日志：ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/cookie-platform-webview156.log`。 |
| `DATA-03` / 系统文件联合 owner | `DEVICE_REPLAY_PASS`，1/1、14.587 秒，零失败/跳过。对接近 5 MiB、含中文和 emoji 的同一文件名连续发起系统保存，捕获两个不同 URI；旧文件 SHA-256 不变、新文件摘要相同，并从 provider 实际显示名选择第二份文件完成真实读回与精确字节核对，不猜 `(1)` 后缀。取消、并发拒绝、Activity 重建、模块销毁、托管下载到相册及跨 UID 延迟分享同时通过。日志：ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/saf-collision-webview156.log`。 |

结束后仅删除本次捕获的文档 URI、合成相册项和测试导出/缓存，原六个白名单数据库文件 hash 前后完全一致，临时 `READ_MEDIA_IMAGES` 恢复为原来的未授权；本轮新装的测试 APK 按实际 hash 确认归属后移除。原 App 以同版本覆盖恢复，恢复后 APK SHA-256 与安装前均为 `45a45f21ff1d177e5a6c967daba39c603ccab10056b3ab5d9d5b22086c31688e`，签名一致、`firstInstallTime=2026-09-16 09:31:10` 不变，未卸载主 App 或清数据。恢复回执为 ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/restoration.json`。已关闭本轮启动的隔离模拟器并核对所属 launcher/qemu PID 均退出；仅在生成 APK hash 精确等于本轮 proof 后删除该生成文件，未用旧普通包替换 Gradle 输出，也未重新构建主设备包。清理记录为 ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/cleanup.json` 与 `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/process-restored.json`。

汇总回执位于 ignored `.codex-tmp/emulator-remaining-20260919/topic-svg-3fed6ff143e34c8d9728f70d45b50a77/receipt.json`。上述五次实际执行与既有 owner 重叠，不累计为新增测试数；结论限于已测 124 和此已有 156 版本，不覆盖全部 WebView、十请求突发压力、物理设备/OEM 省电、自然后台调度或真实站点写入。

`TOPIC-02 UI_PASS`：`tests/ui/topic/image-preview-controller.test.tsx` 增加实际 controller、`ForumSessionEpochProvider` 与生产图片保存流程的组合用例，只替换原生下载、文件系统和相册边界。下载期间推进同站 session epoch 后，旧 signal 中止且原生 cancel 仅一次；迟到文件不能写入相册或显示成功，临时文件仍释放。新 epoch 随后保存成功，证明旧操作不会封死后续保存。该 owner 10/10 通过，固定 seed `691920` 与随机 seed `-1532878991` 均通过；typecheck、定向 lint/format 与 diff 检查通过。此用例新增 UI 证据，不代表真实 Account 换账号入口或原站图片写入。

### 自然调度观察方式校正（2026-09-20）

主设备 job `4878` 的第一轮观察反复执行文本 `dumpsys jobscheduler`，跨过最早执行时刻后显示 Ready 却没有 START，后续 `am kill` 也未出现自动启动。这轮不结算为应用失败或自然调度通过：AOSP Android 15 的输出路径会主动调用 `TimeController.evaluateStateLocked`，到时且没有 deadline 的任务可被移出计时跟踪，而此分支没有发送 changedJobs 通知。设备约束置位时间与采样时间在约一秒精度内吻合，证实取证设计有干扰风险；没有证明它是未派发的唯一原因。没有发现明确时钟异常或随后进程崩溃。源码与分析见 ignored `.codex-tmp/emulator-remaining-20260919/cold-observer-contamination-analysis.json`，不把 31 分钟批处理配置当 ACTIVE job 的调度期限。

停止该观察器后，通过正常 App 入口恢复主设备，实际 PID 为 `19999`；三站 canonical 刷新仍已登录，首页全部来源到达数据态，首次安装时间不变。新观察只在注册后、距离最早执行尚有足够时间时保存一次基线；等待期间只读 PID、Activity、日志与业务 receipt，原生任务完成后再取调度历史。主设备普通包观察暖进程，隔离设备观察进程结束后的自然启动，分别结算。

主普通包 `63ada67c8c5c454aa7cd6ed717c62aa1` 的新 job `4879` 已取得暖进程自然调度 `DEVICE_REPLAY_PASS`：PID `19999` 保持不变，headless task `2` 在设备 UTC `16:35:52.796–16:35:59.644` 执行 6848 ms；带设备时钟前后锚点的 JobScheduler 历史确认同一 job 自然 START、正常 jobFinished。实际诊断中同一 process session 的 task `trace-78` → worker `trace-79` → 三来源 delivery 均完整闭合；task success、worker noop、`delivered=0`、`failedSources=0`，后台 `16:23:26.963` 到恢复前台 `16:37:28.063` 包住全部执行。文件 14786316 字节、SHA-256 `64ad5d0e7a60a902231a1f67b0e1e1172117343a58231340e8b91eb31aa42d19`；离线回执为 ignored `.codex-tmp/emulator-remaining-20260919/main-passive-offline-verification.json`。历史累计 JS drop/write `60/4`、Native `50/4` 与已校验旧文件完全相同，本轮区间零增量、当前队列丢弃与损坏行为零；不宣称历史全零。临时无网络权限本地接收器在核对已安装 hash 后移除，主 App 保留，导出文件继续按 24 小时策略留存。

隔离设备第二轮自然冷启动得到真实红灯：注册时仅 TIMING_DELAY 未满足，退到 HOME 后进程 `4445` 消失且 stopped=false；系统于 UTC `16:38:58.382` 自然拉起 `5498`，WorkManager 恢复唯一任务，但 `ClassNotFoundException` 表明 `RNHeadlessAppLoader` 已被 Release R8 移除，JS 回执始终为 ready。这与已经通过的暖进程不是同一入口。红灯回执为 ignored `.codex-tmp/emulator-remaining-20260919/natural-cold-v2-e4d217ea67e24aa6b7db430f69ed8cd3/confirmed-cold-failure.json`；结束观察后原 APK、六个数据库文件、通知权限及安装身份已恢复。按本轮后台修复与冷进程验收范围纳入 `REG-NOTIFY-074`，在现有 app.json 中加精确保留规则，继续以启用 R8 的实际 Release 验证，不关闭压缩绕过。

### R8 冷启动修复复验（2026-09-20）

修复后的隔离 proof buildId `53ec9646770d41af86df36f376af5af3`、APK SHA-256 `180122b1734353b953c3c13eca5a1bb079ccdaaa2619114386e763e2ec99c05e` 保持 R8、Release/Hermes/x86_64，仅为隔离数据库取证设为 debuggable。实际 dex 保留加载器原名和 public 无参构造。强制调度的冷进程两分支取得 `DEVICE_REPLAY_PASS`：成功轮 PID `9512→9668`、真实 timer 537 ms；超时轮 `10006→10164`、50015 ms 按原 deadline 结束且通知账本不变。两轮 JS、同一 headless task、WorkManager SUCCESS 和同轮正常 jobFinished 均闭合；checkpoint 恢复的逻辑 hash 为 `930e0e95ef14ab7eb9f3a74ea9099a02e6f9f2c2b6d159dbd89565a17b7a4acf`。回执为 ignored `.codex-tmp/emulator-remaining-20260919/cold-fixed-6ebed14ebdb04d2dbee6c9ba7b723816/forced-1789837818352.json`。

系统首次绑定曾出现 `cancelled while waiting for bind`，尚未进入 worker。受控 runner 仅在该原因、仍为 ready 且没有 doWork 的联合条件下允许一次强制重触发，保留两轮历史并只关联最终完整执行；自然模式没有此操作。冷切换只使用 HOME 和 am kill，不用 force-stop 改变 stopped 标志。自然模式等待中不读取 JobScheduler 文本输出。

最终普通双 ABI Release/Hermes 包 buildId `ed3ffb8a9b5d4df9abb6ea9309b565ca`、SHA-256 `5b96237d2ad2d3f47c4117a6355c5400235a5725725721736a2881992a15d521`，仍为 `1.3.147/151`、开发签名、非 debuggable。重新 prebuild 和 arm64-v8a/x86_64 编译成功，实际 APK 中加载器及构造存在、无 proof 深链和测试网络配置。主设备同签名覆盖安装后的 APK hash 一致，`firstInstallTime=2026-07-26 16:51:37` 不变，canonical 刷新后三站仍已登录。普通包安装与启动取得 `APK_SANITY`；自然冷启动另按下述实际回执结算。

隔离设备同一 R8 proof 的自然冷进程取得 `DEVICE_REPLAY_PASS`：job `21` 注册的最早时间为 UTC `17:26:36.547–.656`，65 次空 PID 观察后系统自动启动 `12898`，原 PID 为 `11913`。唯一 doWork 在 `17:27:54.808`，headless 在 `55.021`，JS 在 `56.361–56.901`，业务 539 ms，原生结束及 WorkManager SUCCESS 在 `56.903/56.913`；全部观察为 Launcher 前台、stopped=false，未强制触发。实际历史是两次 START、一次 `cancelled while waiting for bind`、一次正常 STOP，原相邻配对规则保守拒绝。依据 [AOSP pre-bind 取消分支](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/apex/jobscheduler/service/java/com/android/server/job/JobServiceContext.java#L1137-L1148)，失败尝试在 service.startJob 前返回；最终 verifier 仅接受同一 fresh epoch 内所有非最终 STOP 均为此原因、计数不为负且归零、唯一正常结束及唯一完整 worker 链。独立提取真实函数运行 11 个正反例和原始记录均通过，原 `passed:false` 采集回执不改写，另存 ignored `.codex-tmp/emulator-remaining-20260919/cold-fixed-6ebed14ebdb04d2dbee6c9ba7b723816/natural-1789837893724.json.independent-review.json`。`REG-NOTIFY-074` 据此关闭。

自然轮后 checkpoint、六个数据库文件逐项 hash、原 APK `64447fc6…dca4f`、UID、首次安装时间和通知权限全部恢复，测试 task 注销且没有遗留 owned job。主机检查点锁已释放。第一次并行全量验证的 11 个失败均来自同一锁端口 `42187` 的 EADDRINUSE，保留该失败日志；最终全量检查在设备 checkpoint 完成后重新运行，不将环境冲突当作通过。

主设备最终普通包自然冷进程也取得 `NOTIFY-03 DEVICE_REPLAY_PASS`：job `4883` 最早 UTC `17:31:38.147–.209`，旧 PID `21961` 退出后由系统自然启动 `23241`；native startup `17:33:39.934`，doWork `39.957`，headless `40.005–43.694` 共 3.689 秒，WorkManager SUCCESS `43.697`，首次 foreground 为 `17:35:03.134`。同 process session 的 task `trace-2` → worker `trace-3` → NodeSeek/linux.do/妖火 delivery 全部 success，task success、worker noop、delivered=0、failedSources=0。不是触发真实新消息的写入测试。该轮同样出现 pre-bind 重叠，原 watcher 的 NOTPASS 原样保留；独立核验原始调度、日志、生命周期和业务链通过，回执为 ignored `.codex-tmp/emulator-remaining-20260919/main-final-cold-offline-verification.json`。

本轮实际分享文件 16281346 字节、SHA-256 `5d528ff3450f3a51a591c5bb64137621003d236a9281f9f7758527441a8e6672`，接收端长度与摘要均匹配。相对 UTC `16:37:55.849` 已验证旧报告，持久化累计 JS drop/write `60/4`、Native `50/4` 没有增加或重置，read 均为 0；当前队列丢弃、损坏、写入和崩溃读写失败均为 0。导出及再次 canonical 刷新后 PID 仍为 `23241`，三站保持登录，实际 APK hash 和首次安装时间不变，首页全部来源正常，账号与诊断面板收起。

本轮模拟器验收范围已闭合：自然冷/暖后台、受控超时、WebView 124/156、真实系统文件与延迟分享、持久化中断和图片保存身份边界均由上述对应 owner 结算。物理设备、OEM 省电、其他未测 WebView、整个 Android 分区实际耗尽、未授权站点写入及前轮无关历史分支继续 `NOT_VERIFIED`，不将这些边界包装成模拟器通过。未提交、推送或正式发布。

最终 Node 22.22.2 全量 `npm run verify` 在 UTC `17:42:56` exit 0：Vitest 2729 项/212 文件（seed `1789839543001`），UI 1642 项/79 suites（seed `-549774681`），lint、format、架构与文档检查、unused/type、版本检查全部通过，取得对应 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`；定向 typecheck 已通过。本轮定向测试与全量重叠，不累加。最终日志为 ignored `.codex-tmp/emulator-remaining-20260919/final-verify-complete.log`，保留之前端口冲突和文档引用错误的失败日志，未覆写成成功。

收尾仅保留可见 `WZ_Pixel_API_35:5554`，主 App 位于首页全部来源，三站 canonical 登录确认完成。临时本地接收器核对安装 hash 后移除，App 私有诊断文件继续按 24 小时保留策略留存。全部本任务设备观察器已退出，自动化 session 为空，仅停止经过 PID、创建时间、命令路径和父进程核对的新建 daemon；独立设备及其所属进程已关闭。先前自动审批拒绝删除的两处干净安装临时目录继续保留，未绕过限制。最终文档引用与 `git diff --check` 再次通过。

### 完整草稿投票预检复核（2026-09-20）

本轮从 revision `69cdedf94392ba2570459492cb7dfdad33f27545` 的已有 dirty 工作区审查，保留原有改动。确认并修复 `WRITE-05`（共享 `WRITE-01/02`）的 NS 多投票预检缺口：后一项已有创建结果未知的 journal，或用户取消替换后一项投票时，旧流程会先创建前一项远端投票再阻止回复／编辑。共享 `materializeNodeSeekPolls` 现在先检查完整草稿的 journal 与替换确认，再逐项持锁重查和创建；保留 durable claim、已有 ID 复用和账号身份守卫。

canonical owner `tests/ui/topic/topic-actions-controller.test.tsx` 新增回复／编辑 × 后项 unknown／取消替换四个反例，旧代码四项均因已产生一次 `/api/vote/info` 而失败，修复后全部断言零远端请求、首项无 claim；补充成功替换只确认一次。整个 owner 130/130 通过，固定 seed `260920` 与随机 seed `1916506954` 均通过。另修复 `tests/ui/search/search-controller-ai.test.tsx` 的等待条件：等待真实 `nextPage` 更新，避免把尚未重渲染的 `searchBusy=false` 当完成。原失败 seed `1424957546` 与随机 seed `747147965` 均为 60/60；未修改 Search 产品行为。

此前怀疑的偏好迁移三秒边界与现有明确产品契约一致，撤回该发现，未改变该行为。用户明确指定主模拟器与 NS 沙盒测试帖 `https://www.nodeseek.com/post-856117-1`；本轮不使用隔离模拟器制造登录态，也不执行原站投票选项提交。

主 `WZ_Pixel_API_35:5554` 按用户要求改为可见窗口。首轮普通 Release/Hermes/x86_64 包 buildId `e4dd12d60a15495aaee87b639b3930c9` 在测试帖成功发布第 37 楼，创建投票 3199/3200；App 刷新／重新打开与原站第 4 页均确认两个标题、选项和位置，取得 `WRITE-01/05 LIVE_PASS`。编辑清理时现场发现旧卡片残留，按 `REG-WRITE-094` 修复共享 `applyEditedReplyContent`；helper 三个反例和真实 controller 的双排序缓存反例修前均红，修后 helper 15/15、action/session UI 253/253，类型检查通过。

最终普通开发签名 Release/Hermes/x86_64 包 buildId `3b9b891326164779be4e04064cbac738`，APK SHA-256 `08d74c7b9c3767298cc1d949ec47f3c0b2155c907fa103f244e9fd84d6991ff7`。主设备同签名覆盖安装后实际 hash 一致，版本仍为 `1.3.147/151`、`firstInstallTime=2026-07-26 16:51:37` 不变，取得 `APK_SANITY`。同一第 37 楼复用已有 3199/3200：删掉第一项后立即只显示位于中间／结束正文之间的第二项，删掉全部后立即无卡片，均无需手动刷新；随后主动刷新读回一致，取得 `WRITE-02/05`、`TOPIC-03 LIVE_PASS`，关闭 `REG-WRITE-094`。第 37 楼最终仅保留“阅坛投票预检回归 20260920：验证完成，双投票发布、读回及编辑清理均正常。”。没有删除回复或远端投票实体，也未提交投票选项。

最终 Node 22.22.2 `npm run verify` exit 0：211 个 Vitest 文件 2774 项（seed `1789879064584`），79 个 UI suite 1658 项（seed `-1264077501`），lint、format、架构、文档、unused/type 与版本检查均通过，取得 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`。原始日志与设备截图保存在 ignored `.codex-tmp/review-fixes-20260920/`，两个普通包的匹配 source map／R8 mapping 保存在 ignored `diagnostic-symbols/` 对应 buildId 下。未知创建结果与取消替换的零创建分支由真实 controller／HTTP 边界回归证明；主设备未人为制造这些故障，故该故障分支设备证据为 `NOT_VERIFIED`，不把正常 Live 提交扩大成全部故障通过。

收尾主 App 回到首页全部来源，账号中心摘要仍为网站登录 3/3、待处理 0；NS 登录由实际发布／编辑进一步确认。自动化会话关闭，输入法恢复原 Google LatinIME，构建与验证进程均退出；按用户要求保留可见主模拟器，不停止共享 ADB 或 MCP。未提交、推送或正式发布。
