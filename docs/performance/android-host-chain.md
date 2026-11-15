# Android 宿主网络与图形提交链路核对

日期：2026-11-16。接续 [TLS 与切页继续核对](android-tls-frame-followup.md)。本轮先使用同一主 AVD 和普通 Release v5 诊断，再以 v6 复验，保持登录、资料、宿主代理节点、路由、DNS 与 TUN。没有提交、推送或合并。以下分别记录模拟器额外等待、App 自身取消请求，以及追踪工具对绘制的影响，不能把三种现象当成同一个根因。

## 默认网络后端增加了建连等待

主 AVD 的 App 停止后，三个无 TLS、无 HTTP 的独立 `nc` 连接仍分别在 SYN_SENT 中停留 496.954、512.028、494.487 ms，线程几乎全为 Sleeping。每个串行窗口只有一个新的 netsimd 宿主 443 endpoint；把跨时钟误差和读表耗时计入后，该唯一时间候选已经处于 Windows ESTABLISHED、guest 仍为 SYN_SENT 的余量至少为 435～454 ms。这里没有直接 NAT 映射，Windows ESTABLISHED 也不证明代理 Core 已完成远端拨号。

随后在同一 `WZ_Pixel_API_35`、同一 userdata 上做默认 Netsim → 官方 legacy → 默认 Netsim 的 A/B/A。每个条件运行三个独立 Android ART 进程，只使用系统 Conscrypt 建立 TLS，不发送 HTTP、Cookie，不使用 App、OkHttp 或连接池。探针、配置和工具逐文件 hash 一致，九次均确认 App 进程不存在，实际 provider 均为 AndroidOpenSSL，TLSv1.3/h2 握手成功。

| 条件 | 宿主 TCP owner | Java TCP API，三次，ms | 内核 SYN_SENT→ESTABLISHED，三次，ms | TLS 握手，三次，ms |
| --- | --- | --- | --- | --- |
| 默认 A1 | netsimd | 484.039 / 496.834 / 496.789 | 481.159 / 495.976 / 487.208 | 535.683 / 521.666 / 538.201 |
| legacy B | QEMU | 1.463 / 1.260 / 1.684 | 0.544 / 0.645 / 0.548 | 157.264 / 156.121 / 166.155 |
| 默认 A2 | netsimd | 94.141 / 133.883 / 510.419 | 92.976 / 133.329 / 499.903 | 527.108 / 520.134 / 514.567 |

九次 socket 均按实际 PID/TID 和单次生命周期唯一绑定，端口与探针输出一致，TLS 线程状态完整覆盖。三个 trace 无非零 error、data_loss、overrun、dropped 或 packet_loss。探针连接没有 reset 或 retransmit。后端切换也会重置进程、缓存和启动时序；结果支持默认网络路径造成额外等待，不足以点名某个 Rust 函数、`WSAPoll` 或包回送缺陷。

最终保持官方 `-feature -WiFiPacketStream` legacy 启动参数，作为本机模拟器的缓解措施。每次正常关机与重启前后均核对安装 UID 10214、firstInstallTime `2026-07-26 16:51:37`、APK SHA 与 Gboard，不使用卸载、清数据、快照恢复或复制 userdata。这项变化没有进入 App 源码，不能计为 App 建连提速；其他设备不默认套用。操作入口见[维护手册](../operator-runbook.md#android-perfetto-分析)。

原来约 5 秒的 L 站 TLS reset 本轮未复现，继续归 `REG-NAV-010` 的 OPEN 范围。九次成功不能证明 reset 已消失，也不支持增加超时、自动重试、预热或降低 TLS 校验。

## 宿主代理日志已恢复

按用户授权临时开启 FlClash warning 与收集。导出含 716 个可解析时间记录，124,947 字节；三个 ART 窗口向外取整到日志秒后均无 warning/error，unknown 和 unsupported 均为零。日志没有 sequence/eviction counter，warning 也不记录成功连接，因此不能从空摘要证明全部连接映射或历史完整保留。

取证后已通过实际 UI 恢复 error 与关闭收集，并核对稳定后的配置、网络 hash、Core PID 和 TUN 与基线一致。没有按进程分流规则。磁盘原本的 error 值没有被当成采样时 runtime warning 生效的证明。原始日志只保存在 ignored 证据目录，不进入文档或提交范围。

## 重追踪会放大图形提交耗时

一次包含 raw syscall、gfx atrace 和 kernel CPU 采样的诊断抓到 368.163 ms 的 gfx 帧。按同进程、同窗口和 Vsync ID 绑定后，该窗口包含前序 RenderThread 排队和当前绘制，主线程 Running 仅 6.582 ms，JS 全程 Sleeping，不能把全部帧时归给当前帧业务计算。

独立 simpleperf 的 90 个 CPU 样本中，85 个位于 `read_hpet`，调用链来自 syscall enter/exit 或 atrace mark 写入 ftrace ring buffer 时读取时钟。最慢帧内 36 个样本中 35 个命中这些链；当前 RenderThread 绘制自身区间的 12 个样本全部命中。该窗口有 17,999 条 print 和 18,193 次 write。计数与调用链说明取证本身产生了大量成本，不把采样百分比换算成确定 wall 耗时。

该重 trace 有 `misplaced_end_event=411`，不能报告为无损。raw syscall 的 44,839 对 enter/exit 同号配对、同帧绑定与独立 CPU 采样可分别核对，但不能据此宣称完整 slice 树可信。CPU profile 另有 8/90 个用户态错误调用链，内核前缀仍可见。

guest 当前和可用 clocksource 均只有 hpet。实际 API 35 镜像输入含 `clocksource=pit`，并不等于运行时采用 pit；CPU flags 中存在 TSC 也不代表它可安全使用。本轮没有强制 TSC、改镜像或写 sysfs。宿主线程累计 CPU 与 guest Running 的差值不能直接命名为 host steal，少量 Windows 栈也没有给出物理 GPU 或驱动根因。

API 35 固定 [gfxstream Tracing.cpp](https://android.googlesource.com/platform/hardware/google/gfxstream/+/619aaace4560e151a48f3d79a91611ad934ce0f6/guest/android-emu/aemu/base/Tracing.cpp) 用 GRAPHICS tag 启用 guest GL marker；[HWUI Android.bp](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/libs/hwui/Android.bp) 与 [DrawFrameTask.cpp](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/libs/hwui/renderthread/DrawFrameTask.cpp) 表明 `DrawFrames <vsyncId>` 归 VIEW tag。由此准备了去掉 gfx、保留 view、App 自定义区段、sched 和 FrameTimeline 的轻量配置，并已与无 ftrace 的 CPU 采样做同包同 PID 对照。结果另按实际覆盖核对，不把减少追踪开销当成产品收益。

同一 v5、PID 4352/RenderThread 4376，各五轮十个方向、每方向完整 3.3 秒的实际对照如下。两组都使用 99 Hz、含 kernel、FP、MONOTONIC 的 45 秒 simpleperf，仅第二组另启用去掉 gfx 的 Perfetto。配置、实际命令、PID、安装身份与动作首尾覆盖均保存，不属于普通 Release 正式计时。

| 诊断条件 | gfx 帧数 | p95 / worst，ms | CPU 样本 |
| --- | ---: | --- | --- |
| 无 ftrace，仅 simpleperf | 269 | 22.591 / 33.780 | 90，read_hpet 31，tracing_mark_write 0 |
| 保留 view、去掉 gfx | 255 | 44.827 / 55.720 | 211 |

去 gfx 的 trace 无非零 error、data_loss、drop、lost 或 setup error，255/255 个 gfx token 唯一匹配同名 DrawFrames；FrameTimeline 只有 254/255，末段一个 token 的 SurfaceFlinger actual/expected 均缺失，保留为 `NOT_VERIFIED`。主线程与 RenderThread sched 记录、840 次 ReactTextView.onDraw、20 次 FabricEventEmitter 仍在，GL encode marker 为零，DrawLayer 仍有 435 次。显式 WZ.Diagnostics 区段在本暖窗口未触发，不声称已经观察到。

据此将默认配置只删除 gfx，详细 GL 采样改为 ignored 副本按需启用。view 仍明显放大绘制，HPET 也并非全来自追踪。无 ftrace 的最慢帧只有一个 `goldfish_pipe_read_write → write` CPU 样本，说明采到提交路径，不能单凭一个点确定该帧全部阻塞或宿主驱动根因。本轮未以此修改模糊效果、帧率或显示门槛。

普通 v5 Release 原有三组十轮切页仍分别为 p95 26.446 / 26.862 / 26.401 ms，worst 45.526 / 54.990 / 45.365 ms，三组均 FAIL。重追踪的 HPET 根因不能关闭这些普通慢帧，`REG-PERF-024` 保持 OPEN。

## App 重复恢复代理会取消首屏请求

最终 legacy 后端第一次自然启动还抓到独立的 App 问题。前台先应用「未启用代理」，随后正常首屏开始读取；后台通知任务再次恢复同一配置，Native 仍执行 beginTransition，调用 `blockNetworkRequests`、取消 dispatcher 请求并清连接池。该窗口四个前台请求在 339～343 ms 被取消，首屏出现两个来源错误和回退等待。同期 L 站 TCP 11 ms、TLS 152 ms 已完成，不能把这次取消命名为 TLS reset。

调用方是前台 `useNetworkProxyRuntime` 和后台 `notificationBackgroundTask`，共同进入 `NetworkProxyModule.applyProxy`。幂等判定必须由共享 Native owner 持有，JS 单个 runtime 的缓存不足以协调 headless 与前台。首次尚未确认的 WebView 清理、真正配置切换、失败隔离与迟到回调仍需保留；不得只比较一个 enabled 布尔值后跳过事务。

修复在原 registry 的 Ownership 中嵌入 `Unconfirmed / Confirmed(profile)`，复用既有 stateGeneration。相同已确认配置跳过 begin/block/cancel/WebView 写入；新 owner 原子接管原 relay，旧 owner 不再释放接管资源。首次应用、真实配置变化及失败仍执行隔离，迟到回调使凭据失效，过期 generation 不能确认。server 发布后立即把清理职责移交 registry，局部 catch 不再误停后来被接管的 relay。没有新增 JS 缓存、计数器或启动放行状态。

最低可靠层先运行真实 loopback 在途读取，direct 和实际 HTTP relay 两个修前测试均在「重复配置不得取消前台请求」断言失败，非编译或环境失败。修后 `NetworkProxyRuntimeTest` 115/115、`NetworkProxyProfileTest` 4/4，零失败、错误和跳过。新增七个行为测试覆盖完整 body 读回、relay/端口不重建、首次 null 确认、全字段比较、真实凭据变化仍取消、跨 owner 与 WebView 迟到确认前后交错。独立代码复核未发现阻挡构建的问题。

来源范围涉及 `MORE-01`、`NAV-01`、`FEED-01/02` 与通知后台共用网络。实际系统 provider、登录和普通 APK 结果由设备验收独立记录，不以 JVM 通过代替。

## 最终普通包与设备复验

`STATIC_PASS`：typecheck 和完整 verify。`UNIT_PASS`：274 文件、4,665 项，seed `1794777488691`；`UI_PASS`：105 suites、3,307 项，seed `709793350`。Native 119 项另计，不混入 Vitest。状态清单 281 项通过；确认凭据归已有 `PL-NET-webview-proxy-transition`，没有新建独立启动状态。

普通 Release/Hermes v6 的 buildId 为 `75bfc2b89d2a433ea2da54d99d46264c`，APK SHA-256 为 `bfaa5b37185e51e35fe9ca59845f034c93cd8da24f589ea94ca829121abf75cc`。642 个生产路径、788 个构建输入和 24,742 个 Hermes 文件冻结一致，103 个变更 runtime 中 99 个 SourceMap 内容匹配，其余四个为纯类型或仅类型消费路径。没有发布、改版本号或签名身份。

覆盖安装与同 AVD 正常冷重启均保持 UID、首次安装时间、APK 和 Gboard，继续使用 legacy 后端。无构建、测试、Perfetto 或 CPU profiler 并行的首组三次独立 COLD 如下；每次均等待完整 feed-terminal，逐进程 journal 的首屏 all load 全部 success、partialErrorCount=0，Native 无 call/connect failure。后续只读核对发现这组三次 L 站已为匿名、登录 Cookie 数为零，不能当作带登录的 L 站验收。这只是有限公开读取观察，不把差异全归为 App 源码收益。

| 普通 COLD | page-ready，ms | 首批内容，ms | 全部来源终态，ms |
| --- | ---: | ---: | ---: |
| 1 | 609 | 1435 | 2785 |
| 2 | 615 | 1091 | 2533 |
| 3 | 619 | 1109 | 2506 |

另做一次实际系统后台 worker 的功能诊断，不计入以上冷启或导航数据。首次在前台强制运行 JobScheduler job，系统返回 Running，但 JS task 没有执行，不能算通过；WorkManager 已换 job ID，查询旧 ID 返回 23，原失败回执保留。随后正常 HOME，再运行当时唯一的 App WorkManager job，实际 `notification-background-task` 完整成功；`notification-worker` 从 proxy-restore 进入 permission-check 为 8 ms，Native 全局 blocked 计数前后均为 1，没有再次 disabled 日志或 call/connect failure。已有前台请求 body 的守恒由 Native 真实 loopback oracle 证明；该设备窗口的 Feed intent 晚于 proxy restore，不冒充真实在途重叠。通知 worker 最终为 noop，恢复前台后仍为原 PID。

普通 v6/PID 3717 预访空 Search 后，三批各十次 Feed→Search→Feed，每个方向保留完整 3.3 秒，无构建、测试或 profiler 并行，共 1,576 个有效帧，无 invalid 或缺失。结果如下，严格门槛全部 FAIL。一个 miss 对的 IntendedVsync 相隔 11.111 ms，其余常见间隔约 1.57～1.59 秒，不能把所有相邻记录都叫作连续显示周期掉帧。场景内容与模拟器状态并非严格冻结的产品 A/B，不据此声称 v6 相对 v5 提速或回退。

| 正式 warm 批次 | 有效帧 | p95，ms | worst，ms | deadline miss | 原门槛 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 531 | 27.687 | 46.320 | 44 | FAIL |
| 2 | 512 | 30.640 | 42.712 | 48 | FAIL |
| 3 | 533 | 23.960 | 42.957 | 44 | FAIL |

## L 站登录验收的独立异常

More 验收时，NodeSeek、妖火仍显示已登录，L 站显示匿名。发现后按保留状态规则停止设备变更，只读 journal。旧 v5 的同一进程先在设备日志 UTC 20:46:59 得到 current-user 200；20:52:05.825 的请求仍发送与存储一致的一个登录 Cookie，20:52:06.113 的 HTTP 404 响应明确为 login/delete，随后平台应用删除、hasLoginCookie=false、loginCookieChanged=true，20:52:06.150 flush persisted；JS 之后才记录 session-404 并保存 anonymous。后续三个 v5 冷进程也已没有登录 Cookie，早于 v6 构建和覆盖安装。

`ManagedCookieResponses` 根据收到的响应 Set-Cookie 解析设置或过期删除，不凭 HTTP 404 生成删除指令。此处有服务器指令与落盘证据，不能归因到 v6 代理幂等修复、覆盖安装或主动清数据；也不能确定服务端为什么拒绝会话，或排除此前未观测的续签问题。`REG-ACCOUNT-048` 的旧客户端并发/取消修复与历史结案保留，不用同形症状假称旧根因复发。本轮没有自动登录、恢复旧 Cookie 或忽略服务端删除。

用户随后选择自行重新登录，再继续剩余 Live 验收。登录完成前不操作模拟器，首组三次冷启动的公开读取、功能后台任务和正式 warm 数据独立保留。

用户自行登录后，实际 More 界面显示三站已登录，L 站 current-user 200 且 confirmed 已保存。随后停止所有构建、测试和采样，重新运行三次独立 COLD，不与前一组匿名数据合并：

| 带登录普通 COLD | page-ready，ms | 首批内容，ms | 全部来源终态，ms |
| --- | ---: | ---: | ---: |
| 1 | 596 | 1216 | 2503 |
| 2 | 607 | 1104 | 2354 |
| 3 | 542 | 1099 | 2437 |

三个新进程的 L 站 feed/site-config 请求均发送一个登录 Cookie，全部来源首屏均 success、partialErrorCount=0，Native call/connect failure 为零。首批中位数 1104 ms、终态中位数 2437 ms，只是本机当前网络下的三次有限观察，不关闭旧 reset 或长期登录稳定性。

有限 `LIVE_PASS`：从已登录 L 站列表实际打开主题，正文图片、三条回复列表和回复内容可见，返回正常；妖火实际主题三条评论的作者、楼层 #1/#2/#3、正文和「已到最新回复」均可见，返回正常。随后 More 再次显示已登录 3/3，搜索历史仍保留，服务器代理仍未启用，最后回到首页全部来源。未操作发帖、回复、点赞、投票或收藏。没有新跑 `DEVICE_REPLAY_PASS`，深分页、真实代理切换/认证及平台迟到回调设备注入仍为 `NOT_VERIFIED`。

`APK_SANITY`：最终 UID 10214、firstInstallTime `2026-07-26 16:51:37`、versionCode 162、v6 SHA 与 Gboard 保持，当前 PID 6961 的 AndroidRuntime/ReactNativeJS 窗口未见 Fatal、ANR 或 JavascriptException。自有 TP、CPU profiler、host stack 和捕获进程均已退出，tracing/tags 为零；只删除六个与本机归档 hash 一致的自有设备探针/profile 文件及空目录，没有触及 App 存储。主 AVD 保持 legacy，宿主 Core、FlClash 与 ADB 原进程保留，FlClash 日志已恢复 error/off。HEAD 与分支保持，没有提交、推送或合并。

## 证据与未关闭范围

本轮原件、脱敏投影、SQL、离线重放和安全回执位于 ignored `.codex-tmp/host-chain-20261116/`；旧正式 v5 导航与安装绑定保留在 `.codex-tmp/app-perf-root-20261116/` 和 `.codex-tmp/implementation-20261115/build/runs/app-perf-v5/`。原始 trace、profile、日志、截图和 APK 不进入待提交文件。

已确认默认模拟器网络额外等待、重追踪 HPET 开销和 App 重复代理取消三条路径。尚未证明旧 5 秒 reset 的确切发起方、普通 Release 剩余慢帧的物理 GPU/宿主阻塞点，以及真机、多网络和真实代理认证的性能表现。未用诊断轮次替代正式门槛。
