# 官方 Android 技能接入与继续优化

日期：2026-11-15 至 16。接续 [上一轮实测](android-app-followup.md)，保留既有工作树、账号和资料，不提交、推送或合并。主 AVD 启动前处于关闭状态，本轮按维护手册保留数据启动；UID、首次安装时间、APK 与 Gboard 均匹配旧记录。

## 官方技能

已安装 Google [android/skills](https://github.com/android/skills) 的 android-profiler、anr-audit-and-fix、r8-analyzer，固定修订 `5815d27fda564aa9f07ebdcb5e57ed3e8d904e0d`。39 个原始资源逐文件匹配 Git blob，另附上游仓库根许可证；未修改技能原文。工具路径、版本及使用边界归 [维护手册](../operator-runbook.md#android-perfetto-分析)。本轮没有为 R8 分数升级工具或更改优化规则。

分析按同症状窗口检查 Running、Runnable、Sleeping 和阻塞链，并保留 SQL 事实、推断及缺口。已有 trace 的启动锚点、strace 干扰和后台预起口径分别处理，不能把旧连接窗口当成无干扰冷启 CPU 样本。宿主 GPU 驱动已由上一轮记录变化至 26.10.1，新的性能观察单独建基线。

## 模糊目标生命周期

真实 ExpoBlurView → Dimezis 3.1.0 AAR → ViewTreeObserver 反例确认：setupWith 更换 controller 时，旧 destroy 未移除 pre-draw callback；切换目标后旧页面仍被读取。修复只在现有 configure owner 中先停止旧回调，完成 setup 后通过外层 BlurView 恢复，保留重附着所需 flag。没有新增 JS 状态、timer 或目标缓存，也不改变画质、半径及正常绘制。

同 owner 的 SDK31-only 方法在 API28、target 迟到时仍会构造 RenderScript renderer。真实构造边界修前预期零次、实际两次；加入 SDK guard 后为零，通用旧版 DIMEZIS 方法仍按原规则构造。最终新 owner 九次、原 target 转场 owner 两次共 11/11，通过连续三十次切换、同目标、clear、detach/reattach、NONE、低 API 和真实硬件 Canvas 路径。测试并不证明物理 API28 的实际视觉。

完整补丁与官方 npm tarball 的 lock integrity 匹配，正反重放后五文件字节相同；Native 测试计划纳入新 owner，既有 tooling 77 项通过，seed `151171`。RenderEffect 每次 draw 的重复创建仍是候选，缺少最小源码修复落点与收益证明，没有为此复制 SDK 或增加字节码变换。

## APK 校验调度

恢复已下载包和安装前校验都经过 ApkInstallerModule。原 Promise Native 方法同步执行 PackageManager 解析与整个文件的 SHA256，会占用 RN Native 调用队列。真实串行调用队列反例在 PackageManager 阻塞时，后续 marker 无法执行；修复后原完整 body 交给共享 Dispatchers.IO，后续调用可以继续。

保留 SHA、签名、包名、版本、错误码和安装前再次校验；没有改变本地任务恢复时机或取消语义。现有 owner 与模块注册共六项通过，覆盖跨 64 KiB 文件的实际摘要、错误、Executor 拒收及已接受任务在 invalidate 后的一次结算。这证明队列隔离，不证明旧二十一次冷启恰好存在待校验包，也不将 Native 队列称为 UI 主线程。

## 网络诊断

经用户明确授权，临时将 FlClash 日志级别 error 改为 warning 并开启捕获，导出后已恢复两项。网络配置哈希、核心进程和采样中 TUN 身份核对；没有切换节点、路由、DNS、TUN 或清连接。原始 before JSON 没有 TUN 字段，不补造缺失基线，期间与恢复后的记录独立保存。

固定候选核心源码的出站拨号为五秒 context，失败后关闭入站，可以解释原现象，但实际二进制带 dirty 标记，不能冒充完全一致源码。原 error 级别还会过滤 dial warning。本轮十次冷启属于诊断窗口，不混入正式性能样本。导出按真实多行格式识别 308 条记录，其中 warning 31 条、多行 warning 8 条，未知记录为零；两个限定窗口没有可识别的 L/NS 域名拨号失败。部分记录只有 IP，缺少 DNS/NAT 映射，不能以零匹配排除代理关联，也不能指认其他 timeout 就是同次 App 连接。此前未取消的约 5,005 ms TLS reset 仍未归因。

最终包正式窗口再次重现独立 reset 后，按已有授权另开一个 150 秒 warning 窗口：额外十次诊断与一个独立 trace 进程均成功，44 次分类成功，没有 Native 失败或取消。一次 L 站 TLS 握手耗时 4864 ms 后成功，全部来源终态为 7219 ms，连接耗时仍不稳定。第二份导出完整识别 466 条记录、68 条 warning，窗口内只有一条非可识别 L/NS 的 warning，仍不能映射到同一 App socket；宿主与模拟器未做同时钟校准，不以跨钟秒值强行归因。两项日志设置再次恢复 error/false，网络配置哈希、Core PID 和 TUN 身份与该次启用前完全相同。后续需要同一失败连接的 socket/NAT 或远端证据，现有证据不支持改 App 重试、固定 IP、清连接池或放宽预算。

## L 站共享分类截止

同进程诊断将另一类慢启动定位到共享分类：帖子 HTTP 在约 1.6 秒完成，但分类等待者第 5 秒结束后，共享底层仍等到第 8 秒取消，Feed 因仍在使用该元数据而总共等待 8.31 秒。该连接尚未进入 TLS，最后的 closed 明确伴随取消，不能与上述未取消 TLS reset 合并。

共享分类原先移除调用方 signal 以保护其他读者，却没有独立总截止。现在复用既有 5 秒常量与 withAbortableTimeout，包住完整 fetchLinuxDoJson；直读、WebView fallback 和正文处理共用一份预算，不新增引用计数或状态机。单个等待者取消不影响幸存者，超时返回 RequestTimeoutError，Feed 保留既有普通分类失败降级、身份隔离与缓存规则。

真实 reader 与 fallback 的 direct/fallback 两个反例修前均因第 5 秒没有中止传输而失败，修后通过；另一个存活分类等待者得到超时而非取消，Feed 正常降级。相关 10 文件 358 项通过，seed `20261116`，覆盖 scope、缓存、重试、单等待者取消、Feed、Search、Reading、User、Notifications 与 gateway/recovery。源码结果不外推为真实网络稳定性已解决。

## 构建与最终验收

普通 Release/Hermes、`index.ts` 入口、x86_64、非 debug、minify 包已构建，buildId `fc9fc0d794954b6aa8b72332a59acc93`，APK SHA-256 `9f987277d56d5bd70e2fba95ef45fbcb5e20cfc0889e147e75ae1e6b973f0ae8`。640 个生产路径、786 个冻结输入和 24742 个 Hermes 文件前后核对；100 个工作树运行源中 96 个与 sourcemap 内容匹配，另四个未进入运行图。覆盖安装与同 AVD 保留数据冷启后，UID 10214、首次安装时间 `2026-07-26 16:51:37`、Gboard、三站登录及 APK 摘要匹配。没有卸载、清资料、清 Cookie 或重置。

`STATIC_PASS`、`UNIT_PASS`、`UI_PASS`：完整 `npm run verify` 通过，UNIT 274 文件 4665 项，seed `1794759368552`；UI 105 suites 3305 项，seed `69359258`。typecheck、架构 712 模块、文档 29 项、unused、版本门禁与 281 个状态模型核对通过。两处新增 Native owner 共 17 项及补丁重放结果见上述章节；不以源码测试代替设备性能门槛。

普通冷启三批各五次共 15 次，均为新的 COLD 进程并绑定最终 APK，采样不并发运行测试、构建或 profiler。各批首批内容中位数为 2156/2120/2143 ms；全部来源终态中位数为 3316/3370/3542 ms，最慢 6481 ms。精确关联这 15 个进程后，14 次完整成功，1 次 partial/1；后者为 L 站帖子连接在 TLS 阶段 reset，connect 到 reset 5017 ms，未发生主动取消，JS 接到失败约 7 ms 后结束聚合。四项 Native timeout 均为零，分类约 2 秒成功；全部 60 次分类均成功，本次设备窗口没有触发共享 owner 的 5 秒截止。不能用这些数据宣称该截止已在自然故障中直接验到，或旧 reset 已解决。

`NAV-01`、`SEARCH-01/02` 的正式预热 Feed→Search→Feed 各三批十次，保留每方向完整 3.3 秒窗口、所有有效帧及原门槛。两包均使用当前 26.10.1 GPU 驱动、同 AVD、90 Hz、空搜索框与隐藏键盘。结果如下；旧包 1594、新包 1619 条有效帧，均无缺失或无效记录。

| 包与批次 | p95 / ms | worst / ms | 相邻 missed 记录对数 | 原门槛 |
| --- | --- | --- | --- | --- |
| v3 / 1 | 23.32 | 44.17 | 4 | FAIL |
| v3 / 2 | 24.21 | 37.93 | 3 | FAIL |
| v3 / 3 | 25.56 | 43.03 | 2 | FAIL |
| v4 / 1 | 22.28 | 33.83 | 0 | PASS |
| v4 / 2 | 22.10 | 43.80 | 1 | FAIL |
| v4 / 3 | 21.83 | 23.75 | 0 | PASS |

新包仍有一批失败，Search/导航性能事故继续 OPEN。唯一相邻 missed 对的 IntendedVsync 相隔约 1.59 秒，不能写成连续显示周期掉帧。以上是同环境顺序观察，Feed 为动态真实内容，没有用局部机制修复推导通用提速百分比。原始证据只留 ignored `.codex-tmp/app-perf-official-20261115/`；安装与数据保留仍按维护手册执行。

有限 `LIVE_PASS`：`FEED-01/02` 全部与 L 站列表、下拉刷新后列表；`TOPIC-01/03` L 站主楼，以及妖火 1608683 的 22 条回复，正序 #1/#2/#3、倒序 #22/#21/#20 并恢复正序；`TOPIC-02` NodeSeek 863650 的 1381 图帖，预览前两张、关闭回正文再返回；`ACCOUNT-01` 三站已登录；`LIBRARY-03` 历史 626 条及返回。截图已人工检查。没有发帖、回复、点赞、收藏切换、保存图片、清历史或其他真实写操作；这些人工观察不冒充 tracked `DEVICE_REPLAY_PASS`，也不代替重图性能完整矩阵。

## Perfetto 归因与采样覆盖

首次独立导航 trace 的 Search 前段、冷启 trace 的 Native/JS 早段没有覆盖，已保留原数据并限制结论。补录在触发前预留 2 秒，导航延长至 20 秒、冷启保留 30 秒；新导航的 App atrace 早于首个动作，新冷启实际包含进程起点、android_startups 与 WZ 初始化。维护手册已记录该操作边界。各 trace 的 error/data_loss/drop/lost 无非零项，但保留 36 项 ftrace setup notice、频率与温控轨缺失等限制，不以健康计数为零代表所有数据源可用。

完整冷启的 android_startups 为 522.825 ms，与 `am start -W` 的 522 ms 一致；WZ.Diagnostics.Install 为 6.375 ms、其中 Fsync 为 2.065 ms。本地初始化没有解释此前秒级连接尾部。Native elapsed 的实际原点比内核 fork 晚约 25.33 ms，阶段分析使用 trace 时钟快照及同身份日志校准，未直接用 fork 加 elapsed。JS-entry 到 page-ready 的 193 ms 中 JS Running 为 157.819 ms；page-ready 到首批内容的 1559 ms 中，JS Running 为 123.062 ms、main 为 218.452 ms，其他时间大部等待。并发线程时间不相加成关键路径，也不把逻辑 page-ready 当作实际首帧。

完整 cold 中仍有 88.49 ms 初始 main 帧，包含 mount 31.856 ms、RT 39.025 ms；该 RT 的 11 次 shader_compile 合计 30.841 ms。另一次 RCTView 创建区间有 24.805 ms D 状态，却缺少 blocked_function，不能据此猜具体文件或把它一律归给数据库。首次 More 还观察到 mount 与驱动编译两个独立慢窗口；后续预热导航的最慢帧为 28.195 ms，另一个 Feed 晚帧下钻至 AtlasTextOp 的 glBufferDataSyncAEMU encode，而 JS 同窗睡眠。这些窗口说明渲染提交、编译与缓冲上传应分别检查，不能全部归给 Blur、JS 或 GPU 饱和。

正式失败帧另按实际 framestats 原行核对：b2-c4-search 的 43.801 ms 中，main 到 SyncQueued 仅 1.088 ms，IssueDrawCommands 到 Swap 为 31.067 ms；前一行 43.060 ms 主要等 GPU 完成 40.502 ms。没有该正式窗口的函数栈，不能将独立 More 的 shader 编译直接套在这两帧上。补录归因窗口不替代正式三批中的 FAIL；现证据不足以支持删除视觉效果、堆叠 JS memo、增加启动预热状态或复制 SDK。

## 保留边界

`APK_SANITY`：最终包、签名、入口、Hermes、非 debug 与设备身份核对通过；最终同进程的 JS/Native 日志读写失败与 dropped 计数均为零，所查范围没有运行时失败事件。自有测试、构建和 profiler 会话结束后保留主 AVD、ADB 及共享服务；未提交、推送或合并。

`NOT_VERIFIED`：物理 Android、120 Hz、真实 API28 视觉、多网络/弱网、真实更新安装和匹配基线的完整重图 160 动作。旧 TLS reset 的准确网络责任段、正式切页偶发慢帧及完整应用性能门槛仍未关闭。后续先取得失败连接的跨层映射及同帧渲染证据，再选择局部优化；不以本轮有限通过宣称整个 App 已全面达标。
