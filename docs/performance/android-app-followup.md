# Android 全应用性能继续核对

日期：2026-11-15。接续 [Perfetto 首轮执行](android-perfetto-execution.md)，工作树及所有此前未提交修改保持；仅 Android，保留主 AVD 登录与资料，不提交、推送或合并。本文区分已确认的浪费、采用的修复与仍缺证据的网络和呈现问题。

## 连接异常与冷启动

旧 L 站两次失败均在 TCP 已建立、TLS 未完成时发生。从 connect-start 到失败分别 5004/5020 ms，期间无取消、代理 generation 或连接池轮换；不能将它们解释为五秒聚合预算。

Native 诊断现在补充最终请求实际 connect/read/write/call timeout，以及有限 socketFailure/socketErrno 分类。错误原文、地址、Cookie 均不进入新增字段；cause 最多检查八层，未知原因保持 other。配置从实际 Interceptor chain 读取，避免把 RN 后续覆盖前的 builder 当作运行值。新增字段通过 Native journal 与 JS 导出白名单，关联原 callId，不改变请求、预算、重试或账号行为。

带诊断的普通包先做了 10 次加 30 次冷启探测。它们用于取故障证据，部分与构建/测试并行，不作为正式性能收益对照。这四十次没有复现 L 站异常，另抓到 V2EX 同类异常：DNS 14–397 ms、TCP 397–902 ms、TLS 尚未结束，在 5402 ms connect-failed、5403 ms call-failed，socketFailure=reset。connect-start 到失败为 5005 ms，没有 call-canceled；实际 forum client 的四个 Native timeout 均为 0，JS 的外层读取预算仍独立有效。媒体 client 的 connect/read 则为既定 15000/30000 ms。

最终普通包在独立二十一次冷启中再次复现 L 站异常：同一 processSessionId/callId 的 connect-start 549 ms、TLS start 1041 ms、connect-failed 5554 ms，差值 5005 ms；另一次 NodeSeek 对应差值 5004 ms。两次均为 SocketException、socketFailure=reset，无 socketErrno，也没有 call-canceled。这里只确认 reset 分类，不能补写内核 ECONNRESET。两次聚合 Feed 均取得其他来源的首批内容并最终 success、partialErrorCount=0；这不等于其中每次请求成功，须保留来源内部恢复及分类等独立请求的失败记录。

这确认了连接重置这类网络故障存在，且不局限于 L 站。旧 L 样本缺少类别，不能事后补写 reset；这次也没有证明所有连接错误来自同一外部节点。

宿主只读核对确认 FlClash TUN、mixed stack、fake-ip 及自动路由启用；App UID 当前四条 IPv4-mapped TCP socket 的目标全部在 fake-IP 范围。App 的 direct 只表示没有显式 Java 代理，不表示绕过宿主。上游 [Mihomo dialer](https://github.com/MetaCubeX/mihomo/blob/Meta/component/dialer/dialer.go) 的默认 TCP 拨号为五秒，与当前时间特征相符；缺少本机精确 core 版本及同次核心错误日志，不把这条线索写成已证明的 FlClash 根因。没有修改宿主路由、DNS、代理节点或账号。

另录八组短 Perfetto/系统调用窗口，系统调用不采集读缓冲正文；第七组被本轮另一只读深链操作打断，明确排除启动对照。其余短窗口没有重现 L 站故障。地址专项捕获五次 443 connect，均为 AF_INET6 socket 携带 IPv4-mapped fake-IP；这不代表走原生 IPv6。初次只匹配 inet_addr 的离线解析返回零行，不能据此声称没有 TCP，后经原始格式核对与 UID 过滤的内核表确认，报告只保留匿名范围汇总。

本轮还取得了明确的预启动口径证据。最终包 PID 2957 在 22:53:35.613 因 TaskBroadcastReceiver 广播创建，Native network-ready 为进程年龄 231 ms；22:54:11.054 才由 CLI uid 2000 启动 MainActivity。JS entry 的进程年龄为 35931 ms，但相对 Activity START 只有 501 ms；page-ready 为 813 ms，Displayed 为 1017 ms。中间约 35 秒是 Activity 尚未发起的后台时间，不能解释为 App 启动执行阻塞。

同进程 Expo receiver 允许在 BOOT_COMPLETED/MY_PACKAGE_REPLACED 恢复任务；项目没有 boot 自动打开 MainActivity 的路径，Native 计时器则按进程年龄、每阶段一次记录。修正测量必须将「后台预起进程后的首次 Activity」单列，保留非 COLD 启动回执后拒绝它进入普通冷启统计；不需要禁用 receiver 或新增启动状态。旧 15.58 秒记录没有同次 ActivityManager，保留未归因，仅提示可能有相同口径影响。

在构建和测试退出后再次保留数据冷启同 AVD，单独记录 Perfetto 与启动回执，成功复现同进程 WARM 首次界面：Native js-entry/page-ready 显示进程年龄 83.217/83.646 秒，但以同次 `launching: com.wz.reader` 为基点分别只有 569.265/997.593 ms，系统 warm launch 为 1127.596 ms。Native ReactInstance.initialize 约 199 ms，未出现所谓 83 秒初始化区段。Trace 健康检查无 error/data_loss，查询与结果保存在 ignored 的 prestarted-analysis.sql/.csv。工具现在保留拒绝回执，随后停止，不将预启动样本改名为冷启动。

真正进程冷启与网络波动继续独立核对，`REG-NAV-010` 整体仍 OPEN。没有恢复此前已撤回的 WebView 快路径、inlineRequires 或预挂载，也没有靠放宽失败条件宣称稳定。

## 页面、列表与内容

| 范围 | 这次处理 |
| --- | --- |
| Feed 占位 | 停止动画后仍挂载完整 Paper 指示器树。现在非活动占位只保留相同 24×24 空间、文字及骨架；活动来源正常挂载动画，不增加页面状态。 |
| Search | 真实 Query 在取消后可继续 pending，失焦的 AI 控件因此仍动画。沿 Route 的已有 active 传到控件，仅暂停动画，保留 pending、普通结果及恢复焦点后的行为。 |
| 共享正文编译 | selected 为空时 transformForumElements 直接返回，不再遍历 DOM。真实 owner 证明零 DOM 读取、内容及引用保持，父子选中和替换仍走原路径；Host 的绝对收益较小，不称为 Android 帧率提升。 |
| Library、通知与编辑器 | 已有分页、索引、稳定投影、doc/EditorState 缓存及取消 owner。没有新的实测热点支持重写；不把此前已有的优化重复列为本轮收益。 |
| 首次/暖切页 | 独立 trace 覆盖 Feed→Search→Feed→More→Feed，最慢呈现 97.8 ms 含首次与 profiler 开销。暖切页正式门槛独立采集，不能用这一混合窗口关闭历史慢帧。 |

## 图片进度事件

主 AVD 的指定 NodeSeek 千图帖在十二次真实滑动窗口里有 3045 次 topProgress Native 发射，发射 inclusive 总量约 89.5 ms，JS Running 约 1.65 秒。没有 JS 函数栈，不能把其全部时间算给进度。最慢实际帧约 34.60 ms，包含主线程等待 RenderThread、GPU 提交和调度等待；63 次后台 decode 不足以证明同 identity 重复解码，继续保持图片预算、Glide、画质与回收池。

已定位的路径为 Native ProgressResponseBody 逐 read → Expo Image progress → 无合并的 Fabric 事件 → 图片 lease.progress → 扫描全部 entry 的下一 deadline。采用两个局部改动：

1. Expo Image 的 onProgress 使用既有 EventDispatcher 合并能力。RN 队列只替换同 target 的连续同类 unique 事件；onLoadStart/onLoad/onDisplay/onError 等非合并事件构成顺序屏障。Native 发射和下载本身没有限速，也没有新增 flush timer。正文、头像、预览的 identity 及原生加载生命周期保持。
2. JS coordinator 使用现有 timerDeadline，只有本次进度可能改变最早 deadline 时才重新扫描；同毫秒 deadline 未变、非最早且不会提前的进度不扫描。时钟回退、最早/并列 entry、取消、身份变化与结算继续由既有 owner 管理，30 秒无进展规则保持。

Native 合并能力的真实 delegate/UIEvent 红绿测试、原样 RN 队列函数的边界自检，以及 JS 的 2000 描述符工作量反例均通过。原实现四次同毫秒进度触发四次全表扫描，修后为零；随后一百次非最早进度也没有额外扫描。该结果证明减少重复工作，尚不代表整页耗时或 CPU 下降某个百分比。

## 验证与设备结果

最终为普通 Release/Hermes、`index.ts` 入口、x86_64、非 debug、minify 包，buildId `e97a83ce61994f1ba1b1dc7ca3654c75`，APK SHA-256 `9c21b7f2d8f9fd1d3735205d0882c5694ef54d5f735941cb64238a9fbe846eb3`。640 个生产路径、784 个冻结输入及 24742 个 Hermes 文件在构建时核对，99 个改动运行源中 95 个与 source map 对应，另外四个只有类型。构建后仅冷启离线采样工具增加拒绝回执；它不进入 App bundle，补验通过，不改写原冻结回执。

完整 `npm run verify` 通过：UNIT 274 文件、4662 项，seed `1794696530836`；UI 105 suites、3305 项，seed `881879918`。typecheck、lint、格式、架构、文档 29 项、unused 与版本检查通过。Native 网络与诊断 owner 120 项、图片 wrapper/Glide owner 9 项通过；冷启工具后补 13 项红绿及 typecheck、lint、格式通过。上述为 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`，不是性能门槛全部通过。

同签名覆盖安装主 `WZ_Pixel_API_35`，UID 10214、firstInstallTime `2026-07-26 16:51:37`、Gboard 和三站登录保持。模拟器按维护手册保留数据冷启，实际 GPU 为 RX 7900 XTX、90 Hz；没有卸载、清数据、清 Cookie 或重置。构建、测试和 profiler 退出后，普通冷启三批各七次，21 次均为新的 COLD 进程，绑定最终 APK。首批非空内容中位数 2134 ms、p90 2582 ms、最慢 2649 ms；全部来源终态中位数 3379 ms、p90 3778 ms、最慢 9639 ms。聚合 finish 均 success、partialErrorCount=0，网络阶段仍有上述 reset。它们证明当前环境下的启动观察，不是配对 A/B 收益或跨网络稳定性证明。

`SEARCH-01/02`、`NAV-01` 的预热 Feed→Search→Feed 三批各十次、60 个方向、1602 条有效帧全部保留。每批整体 p95 为 26.07/22.89/22.56 ms，worst 为 44.30/44.18/37.28 ms；按既有 p95≤25、worst≤35 及相邻有效记录门槛，三批均失败。七对相邻 missed 记录的 IntendedVsync 相隔约 1.58 秒，不能描述为连续显示周期掉帧。每批最差帧出现在首个点击帧之后约 1.6–1.87 秒，主要成本在 SyncStart 后，不能据此重写 Header 或添加 JS memo。历史 Search/导航性能条目继续 OPEN。

独立最终导航 Perfetto 的末次 Feed 晚帧中，main postAndWait 为 34.39 ms、Sleeping 为 34.31 ms，JS 同窗 Sleeping，RenderThread Running 为 34.11 ms；主线程由 RenderThread 唤醒。RenderThread 前帧 Drawing 34.14 ms，含嵌套的 flush layers 21.48 ms 与 flush commands 10.65 ms，不能相加。另一个首次 Feed 帧确有约 20 ms mount，不能把全部慢帧混成同一原因。Trace 首个 Search 点击初段未完整覆盖，只用于其后窗口归因。

BlurView 也已核对：129 次 drawLayer 分布为 Search 每帧一层，其余可用页面每帧两层，没有超出可见控件数的额外层。实际 BlurView 3.1.0 AAR 为每个控件以 target 的全屏尺寸创建同名 RenderNode；因此 1080×2400 标签不能证明全屏隐藏目标重复画。Trace 没有逐 View tag，不能将全部 flush 唯一归因到模糊，也不支持拆掉失焦目标或关闭视觉效果。

`TOPIC-02` 的最终普通包在 NodeSeek 指定 1381 图帖完成十二次正文滑动、预览第一张、切到第二张并关闭返回，实际图片与位置正常。独立十五秒 Perfetto 无 error/data_loss：JS Running 约 1.60 秒，RenderThread 约 6.49 秒，最慢帧约 38.83 ms，主要等待 RenderThread；原窗口分别约 1.65/6.18 秒。两边图片下载分块、解码波形不同，不据此判断整体提速或回退。Native 进度发射 2809/3045 次也不能作为 JS 队列合并收益。没有同 identity 重复解码证据，不修改画质、图片预算、回收池或全局缓存。

原始 trace、SQL、系统调用、红绿回执及包只在 ignored `.codex-tmp/app-perf-followup-20261115/` 和构建证据目录保存，不提交日志或产物。设备只读操作的最终状态另由本轮验收回执记录。

本轮有限 `LIVE_PASS`：`FEED-01/02` 全部及 L 站来源、下拉刷新后列表、L 站主题读取；`TOPIC-01/03` 妖火 1608683 当前 22 条回复的主楼与 #1/#2/#3 正文；`TOPIC-02` 上述重图正文与预览；`WRITE-01` 妖火回复框打开、Gboard 自动出现、发送按钮空内容禁用、未输入直接收起；`ACCOUNT-01` 三站显示已登录；`LIBRARY-03` 历史页正常显示 625 条并返回。没有点击发送、删除、清历史、收藏、点赞或投票。此为真实来源的有限人工验收，不冒充 tracked `DEVICE_REPLAY_PASS` 或全部入口矩阵。

## 后续优化的证据顺序

优先取得同次 L 站失败的宿主核心日志，区分本机 TUN 拨号、代理远端和源站；当前没有证据支持改 App 重试、固定 IP 或继续放宽预算。暖切页继续沿晚帧的 RenderThread、离屏层与 GPU 提交归因，保留现有视觉、滚动条和完整采样窗口。图片继续采集实际 JS 消费/函数栈及同身份尺寸证据，再决定是否需要下一步优化。

物理 Android、120 Hz、弱网/多网络、三轮匹配基线的重图 160 动作及全部功能矩阵为 `NOT_VERIFIED`。本轮覆盖启动、共享页面与内容/媒体热点；Library、通知和编辑器未发现足以支持重写的实测证据，不用局部通过关闭全应用性能问题。
