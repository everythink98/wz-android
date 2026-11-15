# Android Perfetto 接入与实测记录

本轮执行日期为 2026-11-15，仅覆盖 Android。接续 [Android 性能计划](android-optimization-plan.md)，保留当前工作树、主模拟器资料和三站登录；不提交、推送或合并。

## 工具与复用方式

已将 [Google 官方 Perfetto skill](https://github.com/google/perfetto/blob/ai-agents/plugins/perfetto/skills/perfetto/SKILL.md) 安装到本机 `C:\Users\ljx\.codex\skills\perfetto`，来源固定为 `google/perfetto` 的 `33f1de9084ba039d52b20b88de8b83654aa3cbb7`。使用其 Python wrapper 首次下载并校验 Windows Trace Processor 59.1，实际运行版本为 `v59.1-1e9c61e98`。设备内置采集器为 46.0，官方 recorder 固定为 59.1。不增加 App SDK 或生产依赖，也不上传 trace。

新的会话可以发现该 skill。本轮显式读取其录制与 SQL 工作流，并已用真实模拟器 trace 验证。可复用配置是 `scripts/performance/android-app.pftxt`，查询是 `scripts/performance/android-app.sql`；前者包含调度、App 固定标签、WebView、FrameTimeline 与进程统计，后者先查采集健康，再按进程和线程汇总。

具体命令见[维护手册](../operator-runbook.md#android-perfetto-分析)。原始 trace、SQL 输出、红绿测试、构建和安装回执保存在 ignored `.codex-tmp/android-perf-20261115/`，不能作为待提交文件。

## 实测与候选决策

基线为前轮已绑定源码的普通 Release/Hermes 包，buildId `3c8996c609214c44b56b313b307b71b2`。设备仍为主 API 35 AVD，实际 GLES 为 AMD Radeon RX 7900 XTX。采集、普通计时与构建测试分别进行，不把 profiler 轮次纳入正式启动计时。

| 计划项目 | 这次取得的证据与处置 |
| --- | --- |
| 启动与建连 | 冷启 trace 有约 238 ms 的主线程帧，布局更新约 115 ms；WebView provider 初始化约 49 ms。无法由此证明启动快路径有稳定收益，维持历史撤回结论。连接池和身份门禁保持；此前 DNS/TCP/TLS 与服务端等待仍按独立阶段解释。 |
| 首页与切页 | 内容已在约 2.65 秒出现，15 秒采集中却仍有 784 次 App draw、RenderThread Running 约 10.5 秒。Search 静置 trace 没有 App draw，表明持续绘制集中在 Feed。仅对非当前来源和失焦 Feed 的加载动画做最小候选，保留实际请求与占位布局。 |
| 详情解析 | 对既存妖火 HTML 做同输入、交换顺序的纯计算实验，共享提示检查的 DOM 可减少约 0.12–0.72 ms Host CPU。绝对收益不足以支持扩展 parser 接口，本轮不改；不能把它称为 Android 收益。 |
| 媒体与内存 | 本轮未发现重复 identity 解码或持续保留根的新证据，不改图片预算、画质、Glide、回收池或播放器生命周期。重图与耗电专项不继承通过标签。 |
| 编辑器与存储 | 当前已复用不可变 doc、EditorState 与索引，SQLite 启动不读完整记录 payload，分页与事务边界已存在。没有新热点证据，不加缓存、Worker 或放宽持久化保证。 |
| Native 编译 | 不增加 Baseline Profile 模块；当前证据没有指向 ART 编译为主因。 |

上述是本轮候选处置，不代表所有页面已完成性能验收，也不关闭已有 Search 主慢帧事故。

## 实际改动与断言

`LoadingState` 复用现有 `animating` 属性，默认行为保持；Feed 只允许活动页面的当前来源占位运行动画，失焦后的空态和部分结果 footer 也暂停。没有新增持久状态或请求协调器。UI 断言修前确认非当前来源仍动画，修后覆盖失焦、切源、内容到达与占位保留。

另补齐测量终态：首批 `feed-content` 可以早于完整请求；独立 `feed-terminal` 只在既有完整终态与布局条件满足后记录。Native 固定白名单按进程只记录一次。冷启动 runner 必须等待后者，最多 35 秒，分别汇总首次内容和终态；仅出现帖子但后续没有结算会失败。新 runner 会拒绝没有该标记的旧 APK，不能把旧包缺标记解释为旧包产品失败。

## 对照与验证

当前普通包 buildId `3fe5c190ae2444a78aa727f36176e840`，APK SHA-256 `6a4d04dc64b17ad2bea30d87817a95d2bf909f3e77976097f4b63da68b64bb3c`。构建 4m28s；640 个被构建工具归为生产的路径与 784 个输入冻结，95 个变更运行模块中的 91 个 SourceMap 内容匹配，其余四个为纯类型/仅类型消费路径。Native 新诊断白名单也在实际 DEX 中。保留数据覆盖后 UID 10214、首次安装时间与 Gboard 保持，按维护手册不加载快照冷启同 AVD，实际三站登录仍为 3/3。

收尾对所有原冻结输入再次核对，仅离线分析文件 `scripts/performance/android-app.sql` 变化，增加未闭合调度行的报告与过滤；它不参与 App 构建。原严格 whole-input freeze 因此按预期拒绝，未修改旧构建回执。补充回执确认其余 App、Native、依赖、编辑器生成物、构建工具及 APK 哈希均保持，SQL 已在实际 trace 上重新执行通过，不为离线查询改动重建 App。

普通包首页已完成加载、无交互、同一设备和相同来源，三次各约 5.1 秒的窗口：

| 指标 | 前包 | 当前包 |
| --- | --- | --- |
| `gfxinfo` 新绘制数 | 316 / 310 / 312 | 0 / 0 / 0 |
| 进程 CPU 时间 | 1300 / 1380 / 1810 ms | 170 / 130 / 90 ms |

CPU 中位数约减少 90.6%，是同等静置窗口内进程使用的 CPU 时间，不是加载提速百分比或电量。后包经过 AVD 冷启，与前包长驻系统的环境差异保留；动画门禁的 UI 反例与绘制归零共同支持省工结论，不据此宣称整体页面帧率提高。`REG-FEED-042` 在此范围重新解决。

`STATIC_PASS`：typecheck、完整 verify。`UNIT_PASS`：274 文件、4660 项，seed `1794692576621`；`UI_PASS`：105 suites、3303 项，seed `-1194917547`。既有 act/StrictMode 告警保留。Native 诊断 owner 10 项新鲜 JVM 报告均通过，零失败、错误或跳过。静态与组件测试不代替设备性能测量。

覆盖安装首开和 AVD 重启后首开单独保留。当时完整测试仍在运行，后者 `js-entry` 约 15.58 秒；没有同条件基线或栈，不将它归因到某项补丁，也不删除记录。正式冷启采样等待构建和测试退出，另记终态；此轮不以首开或 profiler 时长计算加载收益。

普通冷启为三批、每批七次，共 21 次，均保留数据并使用独立进程。整体统计：

| 指标 | 中位数 | p90 | 最慢 |
| --- | --- | --- | --- |
| 正常页面布局 `page-ready` | 544 ms | 609 ms | 637 ms |
| 首批内容 `feed-content` | 2139 ms | 2198 ms | 2507 ms |
| 完整首屏 `feed-terminal` | 3301 ms | 3692 ms | 6498 ms |

三批首内容中位数分别 2149/2144/2136 ms，完整终态分别 3295/3405/3280 ms。21 次均有内容与终态；联合同进程 Gateway 诊断确认 20 次全成功、1 次 partial，后者为 L 站连接阶段 IPv4 `SocketException`，不能称为所有来源成功。没有本轮聚合、准备或 request timeout 记录；也不能将 SocketException 归为已定位的 DNS、证书或服务器故障。另一次成功聚合进程中的 L 站连接失败属于其他 trace，不能重复算入首屏失败率。后续实际切到 L 站已取得已登录内容。保留网络不稳定的证据，不加入未经证明的自动重试、固定 IP 或预连接。

候选普通冷启比上一轮五次样本更快，但样本、网络和 AVD uptime 不同，本轮不再计算内容提速百分比。已确定的收益是消除无交互持续绘制。

新配置实际录制并以项目 SQL 查询通过，健康检查没有 error/data_loss 或未闭合调度行。独立冷启归因窗口中 draw 从 784 次降为 170 次，最后绘制在首个 App slice 后约 4 秒，约 14.4 秒 App 覆盖的后续区段不再绘制；RenderThread Running 约 2.92 秒，前轮为 10.52 秒。两次 profile 只作与普通静置结果相互印证，不用于正式启动比较。实际 process start_ts 仍缺失，因此使用明确的首 App slice 基点，不伪造进程创建时间。固定 SQL 及原始输出能重跑上述归因。

`APK_SANITY` 与有限 `LIVE_PASS`：21 次普通冷启均有真实首批和终态；实际 L 站切换显示登录权限内容、下拉刷新后仍可读，返回全部、Search 最近记录与我的页面正常，三站保持已登录 3/3，最后返回首页全部。未执行论坛写操作或修改账号/资料。完整冷启部分成功如上单列，不冒充四站全成功。

`NOT_VERIFIED`：物理 Android 设备、耗电、覆盖安装首开的长等待根因、自然 CF 与代理/多网络、Search 三批严格帧时门槛、重图 160 次动作矩阵、完整媒体和 IME/上传专项。本轮没有改这些实现，也不继承其旧包通过结论；没有新增 `DEVICE_REPLAY_PASS`。本轮保留动画省工修复和测量终态，其他未命中热点的候选停止，不追加新状态机、缓存或性能 SDK。

收尾文档测试 29 项、引用检查、281 项状态审查及 `git diff --check` 通过。自有构建、测试、采集与命名 Trace Processor 会话均已结束；保留共享 ADB、Codex 子进程及按规程冷启后的主 AVD。HEAD 仍为 `9a92d686017fd7626a3093836aa24ec1846e8dd3`，未提交、推送、合并或发布。
