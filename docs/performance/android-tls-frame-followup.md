# L 站 TLS 与切页慢帧继续核对

日期：2026-11-16。接续[官方技能执行记录](android-official-skills-execution.md)，基线 HEAD `9a92d686017fd7626a3093836aa24ec1846e8dd3`、142 个已有 dirty 条目均保留。只做 Android，不提交、推送或合并；登录、资料、代理节点、DNS、路由与 TUN 不变。原始证据留在 ignored `.codex-tmp/app-perf-root-20261116/`。

## 已落实的局部修复

`ACCOUNT-01/04`、`NAV-01`：收起但保留挂载的等级正文及失活 More header 仍向 Paper 传入运行动画状态。Native Animated.loop 不随高度或透明度隐藏自动结束。现在复用现有 active/expanded，将隐藏状态传给 animating/loading，不取消请求或卸载正文；保留 busy、禁用、资料、页签与重开恢复。可见忙态不额外叠加 disabled 的 0.45 透明度。Paper 停止前有约 200 ms 淡出，不能把短暂尾段判为循环泄漏。

修前隐藏动画数量的三个行为断言失败，修后四套既有 owner 121 项通过，seed `161203`。三个生产组件、两个测试文件与一个视觉调用方迁移已冻结，未新增业务状态或共享控件 API。完整 verify 通过：UNIT 274 文件 4665 项，seed `1794764164922`；UI 105 suites 3307 项，seed `204168760`。最终相关 typecheck、ESLint、Prettier 通过。首轮完整门禁运行期间有两行透明度收窄，最终四套 owner 与 typecheck 另在冻结源码上通过，不将旧 props 结果冒充最后源码验收。

## 同一帧的导航证据

相同旧 v4 APK、PID 11949 上做了一次有界诊断：95 秒 Perfetto、2 秒预录、256 MiB buffer；十次 Feed→Search→Feed，20 个方向各保留完整 3.3 秒，同时保存原始 gfxinfo。539/539 帧按 Vsync ID 与 FrameTimeline surface token 唯一对应，首尾覆盖完整，没有 error/data_loss/drop/lost/环形覆盖，保留 setup notice 36。

这次 p95 15.199 ms、最慢 25.822 ms，没有重现旧 43.8 ms。该进程已长期运行，缓存、内容和图像条件不同，源码没有改变，不能把差值算成修复收益。旧正式 FAIL 保留。

20 个方向约 1.6 秒晚段帧的 JS Running 都为零。最慢 Search 的 RT 为 22.42 ms，其中 glBufferDataSyncAEMU encode 为 19.51 ms；另一个 Feed 帧为 24.67 ms，其中 rcCreateSyncKHR encode 为 19.67 ms。全窗没有 shader_compile，Search/Feed 的 Blur 层数为 1/2，没有额外可见层。它们定位到当前模拟器的渲染提交路径，不能据此断言物理 Android、某个 Blur 或 JS 是原失败帧根因，也不支持删视觉、滚动条或增加 JS memo。

最终 v5 在不运行构建、测试、profiler 或其他 AVD 的情况下，同 PID 7234、空搜索与 Feed「全部」预热后，三批各十次往返、每方向完整 3.3 秒。527/528/522 个有效帧，三批全部 FAIL：p95 为 26.446/26.862/26.401 ms，worst 为 45.526/54.990/45.365 ms。没有 invalid 或缺失行；相邻 miss 仅指同一捕获内相邻有效行，不把约 1.6 秒间隔当作连续显示周期。原始失败样本保留，不缩短窗口、放宽门槛或重复挑选通过批次。More 的局部修复不等于切页性能改善。

随后只补一次同 PID 的 95 秒诊断，保留相同 20 个完整方向窗口。414/414 帧 token 唯一绑定，167 帧至少 35 ms，26 个重点帧的三线程状态完整覆盖，数据健康与首尾覆盖通过。该采样明显比无 profiler 的正式计时更慢，不能把它的帧时合并进正式门禁。

| 同次诊断帧 | gfx 总窗 | 绑定帧与排队证据 |
| --- | --- | --- |
| 最慢 Feed，b1-c9-feed / 2284818 | 88.804 ms | 主线程 Running 1.226 ms、JS 为零，RT 全窗 Running 87.017 ms；其中绑定 DrawFrames 37.611 ms，前两帧与窗口重叠 28.679/22.386 ms。绑定帧 glUniform2f encode 单段 13.970 ms。 |
| 最慢 Search，b1-c8-search / 2277142 | 46.109 ms | 绑定 DrawFrames 14.571 ms，前一帧 30.998 ms，主线程 postAndWait 28.413 ms。全窗耗时不能全部记到绑定帧的 CPU。 |

26 个重点帧中 22 个的 JS Running 为零，其余最大 3.358 ms；414 帧均为 Search 一次、Feed 两次 Blur draw，没有额外隐藏层或 shader_compile。当前诊断长帧主要是 RT 排队与 GL 提交，尚未发现可安全删除的重复 App 工作。GL encode 叶子在不同帧变化，缺宿主调用栈，不能进一步点名某个 driver/SDK bug、某个 Blur 或实体机瓶颈。未为追求通过改视觉、并发或 JS memo，也不将这次诊断当作旧正式 43.8/54.99 ms 帧的同次证据。

## TLS 的下一层证据

当前 AVD Wi-Fi 外连由 netsimd.exe 持有，宿主只盯 QEMU 会漏掉这一层；旧导出实际也没有 netsimd/L 域名字面，不能把分类遗漏说成已经找到旧故障。现有 read-network logcat 自带 PID/TID，可将 Native call 关联到线程，无需改 App。失败 TLS 发生在 connection-acquired 之前，现有成功连接的 socketLocalPort 不能补造失败 socket。

现有 netsim 捕获 RPC 返回 UNIMPLEMENTED，PktMon 无管理员权限；未启用未知捕获接口、全局 ETW 或改配置。宿主读取官方源码的另一端点也出现约 5.2 秒 TLS 前 ECONNRESET；它不是同次 L 站连接，不能证明同因。

另做六次只握手探针：宿主现有 TUN 路径与显式本机 HTTP CONNECT 各三次，TLS 证书校验开启、ALPN h2/http1.1，不发送 HTTP 正文、Cookie 或凭据。六次均成功，约 150–170 ms，不能关闭偶发 reset。候选 Mihomo 源码先返回 CONNECT 200，再开始出站 Dial，因此 200 也不能证明远端已连接。Core 日志仅按宿主 PID/源端口配对，不凭不同进程或跨钟同秒强行归因。

已按授权临时开启 warning 与收集，实际探针窗口约 13 秒。导出日志 517 条、未知格式 0；窗口没有与这六个源端口对应的 warning。源码候选的 500 条上限与实际条数不一致，不能声称完全没有淘汰。取证后恢复 error、关闭收集，配置 hash、Core PID 与 TUN 核对一致；未切节点、改路由或 DNS。

## TCP、TLS 与线程的同次关联

最终普通 Release/Hermes v5，buildId `9e0d554bdcb94a6eb0919890c95c06ca`，APK SHA256 `eec3b94a583ebc984b73db04d5e4eeaa10b9234836991ec0b401b9e65fa5da31`。保留主 AVD 的 UID 10214、firstInstallTime `2026-07-26 16:51:37`、Gboard 及三站登录。版本仍为 1.3.158/code162，不执行正式发布流程。

250 秒 trace 使用 v59.1，采 sched、TCP state/reset/retransmit 与仅有的 WzStartup/WzNetworkProxy tag。先做 1 秒设备 smoke，再录制 15 个独立冷启进程。初次配置的 LID_MAIN 在开始前被 proto 拒绝，修正为 LID_DEFAULT 后通过；失败配置保留，不计作启动样本。完整 trace 24,460,980 字节，非零 error/data_loss/drop/lost/覆盖丢失为零，80 次 TLS 的线程状态全部覆盖，没有时间缺口。

15/15 Feed 终态成功，partialErrorCount 全部为零；Native failure/cancel 为零。按同进程、同 connect 线程和 connect→tls-start 窗口，80/80 次只匹配一个 SYN_SENT。该内核的 SYN_SENT 发生在 autobind 之前，sport 为零，因此用 socket 生命周期的后续状态解析端口；不跨 CLOSE 或下一次 SYN 复用指针。15 个成功 L 调用的 acquired 端口与新建 socket 不同，符合 h2 连接池竞争后共用另一个成功连接，不能判为绑定失败。

| 范围 | TCP 状态窗 p50 / p95 / max | TLS p50 / p95 / max |
| --- | --- | --- |
| L 站，30 次 | 495.688 / 509.683 / 510.545 ms | 129.598 / 538.736 / 653.731 ms |
| 全部来源，80 次 | 495.688 / 509.683 / 513.519 ms | 不合并来源解释握手 |

73/80 次 SYN_SENT→ESTABLISHED 至少 400 ms，App connect-start→SYN_SENT 仅 0.331–7.841 ms。L 站 TCP 窗口中线程约 99.952% 为 interruptible sleep；L TLS 窗口 Running 2.725%、Runnable 1.449%、sleep 95.823%。这不支持将该段约 500 ms 等待归为 App CPU 或发起前排队。状态事件不是线上 SYN/SYN-ACK 报文，仍包含内核、虚拟网络和转发等待，不能叫线上 RTT，也不能由 sleep 指定远端或某个 syscall。

全窗没有 tcp_receive_reset。可唯一关联的 60 次 tcp_send_reset 全发生在 TLS 成功后，L 站最早晚于 TLS end 6.557 秒，不能认作握手 reset；轮次间 force-stop 也必须与它们区分。唯一 guest retransmit 属于 anonymous 且在 TLS 后。未观察到 guest 重传不排除宿主 TUN 之后的问题。

上述轮次带 trace、journal 读取和轮次间隔，仅用于归因。Feed duration 中位数 2963 ms、最慢 3495 ms 不与无 profiler 的旧冷启计时计算收益。原约 5 秒 TLS reset 未复现，继续 OPEN；没有证据支持增加隐藏重试、串行化 L 首请求或修改连接超时。

## 隔离网络后端对照

使用独立空白 API 35 AVD，未安装 App、复制登录或主设备数据。Emulator 36.5.11/build15261927、2 核/2 GiB，同一临时 userdata 依次运行默认 Netsim Wi-Fi 与官方 `-feature -WiFiPacketStream`。仅 TCP nc，不发 TLS 或 HTTP。

默认三次 guest wall time 为 71.134/344.215/54.624 ms，legacy 为 15.869/13.874/13.113 ms，六次均成功；相邻宿主 TCP 为约 1–12 ms。guest 数值包含 DNS 和调度。默认条件没有重现主设备高频约 500 ms，样本少、固定顺序，AVD 配置和启动状态不同；仅记 DIAGNOSTIC_ONLY，不计算 App 提速、不认定 Netsim poll 或 TLS reset 根因。

当前 netsimd 0.3.98 二进制含 signal pipe/Notify 字符串，不能套用旧 Windows 无唤醒 FD 的源码推断。主设备到宿主 loopback 的一次控制未满足可达前提，nc 非零退出，未用它解释 500 ms。隔离 AVD、唯一 ini、userdata 和自有进程均已清理，主 AVD 后端及代理保持。

## More 的有限设备验收

匹配 v5 的账号三站仍已登录；实际展开 L 等级时出现读取中，收起后重开成功显示等级和 12/12 需求，保留资料与读取时间；两次账号刷新后可正常返回 Feed，原选站恢复。它们是有限 LIVE_PASS，不包含真实写入。

同包后续只读核对：L 最新列表与首帖详情加载、妖火 `1608683` 的 22 条评论及首三条正文、More 历史 627 条及返回均正常，最终恢复 Feed「全部」。再次核对三站已登录、UID、firstInstallTime、APK SHA 与 Gboard，当前 PID 7234 无 AndroidRuntime fatal 日志。读取可能正常更新浏览历史，不将数据保护表述为数据库字节完全不变。

该进程的另一窗口有四次 NodeSeek 通知 direct 约 8 秒后主动取消，分别是未读计数与 at-me/reply-to-me/message 三个不同列表，随后既有 WebView 回退成功，累计约 11.354/28.769 秒。请求头已发而未收到响应，不是本轮复现了 TLS reset；双层 transport finish 也不是重复请求。现有单站 WebView 队列按既定优先级/FIFO 串行，尚无依据合并端点、跳过通知组或扩大并发。发送后等待的下层原因继续未定位。

另录制同 PID 的忙态离开窗口，BOOTTIME 与动作覆盖已核对。离开后稳定 10 秒 DrawFrames 为零，但通用 animation bucket 为 865 次、doFrame 为 892 次，独立 NativeAnimated start/stop/update marker 为零。RN NativeAnimatedModule 本身也会无条件重排通用帧回调。不能凭通用回调判断特定 Paper loop 是否继续，也不能由无绘制推定节点停止。请求 pending 是否跨过实际 blur 提交尚未闭合，Native 精确停止时刻为 NOT_VERIFIED；不扩大框架补丁来制造通过。

## 当前验收与剩余问题

- STATIC_PASS、UNIT_PASS、UI_PASS：完整 verify 与最终相关 121 项结果如上；收尾文档 29 项、引用与状态模型 281 项检查通过。TLS SQL 在同一 trace 重放两次，输出相同，80 次关联与线程覆盖无缺口；真实失败及零/多候选分支仍未动态覆盖。
- APK_SANITY：普通非 debug x86_64 Release/Hermes，与当前运行源码冻结及签名匹配；仅同签名覆盖安装，安装身份不变。
- LIVE_PASS：仅本节明确列出的账号、等级读取与返回，以及 15 次诊断冷启的来源终态；不代表长期稳定性。
- NOT_VERIFIED：原 TLS reset 的故障 socket、旧正式慢帧的同次原因、Native 节点精确停止时刻、实体机、120 Hz 与弱网。无已证因果的候选不进入产品代码。

构建时冻结的 786 项输入与 24,742 项 Hermes 源均保持。最终 inventory 检查如实拒绝两个新加的离线 TLS 工具；只给这两个非 runtime 文件列明 hash 的附录后，复用原检查重新核对全部旧输入通过，未改旧 config 或用重建掩盖差异。没有因文档和离线 SQL 新增而重装 App。

剩余连接问题优先在故障同次采内核 TCP 与 Native 日志，区分收到 reset、主动关闭和宿主路径；切页继续按相同 token 绑定真正失败帧，不能拿诊断未复现覆盖旧失败。通用配置与 SQL 归 `scripts/performance/android-tls.*`，录制、覆盖检查与清理方式归维护手册，不把 ignored 文件当唯一知识来源。
