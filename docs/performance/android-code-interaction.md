# Android 交互中的代码重复工作

日期：2026-11-16。接续[宿主链路核对](android-host-chain.md)，本轮按用户要求停止首页加载和建连研究，只处理代码导致的交互成本。保留此前未提交修改、登录与数据，不提交、推送或合并。改动归属为 `SEARCH-01/02/03`、`NOTIFY-02`、`TOPIC-02/03`；生产修改不改变视觉效果、内容、协议、超时或资源预算。Gallery 安全区修复属于开发验收工具。

## 已确认并修复的路径

| 场景 | 修前实际工作 | 本轮修复与受控结果 |
| --- | --- | --- |
| 空 Search 焦点往返 | 即使未显示 AI 和筛选，active 与 requestsEnabled 改变仍重建表头；五次往返额外提交搜索输入控件十次。 | 仅以实际渲染的 AI/筛选门禁作为表头依赖；相同十次焦点变化的额外输入提交为零。关键词和当前回调变化仍更新，AI 失焦停转、筛选候选权限原样保留。 |
| 私信详情编辑草稿 | 父层每次更新都对全部 messages 生成 conversationKey、气泡 JSX 和时间文本，HTML 子树的 memo 挡不住这些工作。80 条消息、八次草稿/status 更新多格式化时间 640 次、读取消息 ID 1920 次。 | 按已有消息、宽度、主题、来源媒体身份及动作依赖复用派生结果，两项额外计数均为零；消息替换/追加、主题字号、宽度、session epoch 与最新回调均有行为断言。没有业务状态或全局缓存。 |
| 代码/终端评论查找 | 编译后的 52 行、104 个颜色 run 为同一个 query 显式构造 RegExp 104 次，并重复规范化 query。 | 将同次 codeRunNodes 调用不变的 pattern 与小写 query 提到循环外；显式构造为一次，新查询重新生成。逐 run 边界、String.split、gi、Unicode、颜色与完整复制内容保留。 |

三条路径均先运行修前失败的 canonical 断言，再修改共享实现并运行相关 owner。Search 复用已有输入图标的 layout commit 计数；私信调用真实 formatNotificationTime 并读取真实消息 getter；代码查找先经过真实 compiler，再统计目标 pattern 的显式构造。没有通过 mock 新增的 memo 或源码字符串宣称优化。

代码查找另做 Node 局部函数实验，六轮中位数由 0.037590 降为 0.012706 ms/call。该值不是 Android 或整页耗时；String.split 内部可能克隆正则，未计入显式构造次数。三条计数结论均不能直接换算成 FPS 或关闭切页事故。

## 已运行的验证

定向 `UI_PASS`：Search 62 项、通知 screen 与 Route 196 项、代码/表格 49 项；均包含真实变化继续更新的断言。独立复核未发现过期回调、媒体身份、查询切换或正则 lastIndex 问题。相关 typecheck、ESLint、Prettier 和 diff 检查通过。

这三项生产修改和原始合成 fixture 的 `npm run verify` 已退出 0：Vitest 274 个文件、4665 项通过，seed `1794781495069`；Jest 106 个 suite、3313 项通过，seed `-1363437567`；lint、format、架构、文档、unused 与版本检查均通过。后续 Gallery 安全区修复只影响 dev/tests，另跑对应 owner 与静态检查，不能沿用修复前 Gallery 的设备结果。

私信详情会在特定条件下自动向原站标记已读，不能用真实未读会话制造性能场景。本轮完善现有 `notifications.detail.conversation` Gallery scene，以稳定的 80 条纯合成消息和本地草稿状态提供打开、编辑、关闭、重开；不挂通知 Route，提交/上传均为无副作用回调，不请求真实消息或远端图片。原始 fixture 两项测试及三项 Gallery 隔离门禁通过。

隔离验收使用新建 `WZ_CodePerf_API35_20261116`，没有复制主 AVD 的 App、Cookie 或资料。Gallery 是 debuggable 的功能 proof，不能作为普通 Release 性能通过数据；普通包、安装身份和帧时另行核对。初次准备 proof 时，错误的本机 pinned 文件路径在构建前被断言拒绝，未安装或变更 App；失败回执保留，修正实际路径后重新准备。

## Gallery 弹层安全区

隔离设备上真实 Gboard 打开后，首次 Gallery 包出现上下缝隙：1080×2400 窗口中，backdrop 从 y=128 才开始，底边为 2337；编辑面板可见底边 1455，IME 从 1517 开始，间隙 62px。底部系统安全区为 63px，顶部为 128px。

根因在开发 Gallery：外层默认消费四边安全区，使 Portal 宿主先被纵向内缩，而生产面板按窗口坐标避让键盘；通知 fixture 还嵌套了固定 24dp 的 SafeAreaProvider。生产 App 的外层只消费 left/right，没有这个宿主组合。

修复只改 dev/tests：全屏 Gallery 的 Portal 宿主保持窗口大小，普通内容在 PortalProvider 内独立消费 top/bottom；控制台模式保留外层安全区。通知 fixture 继承真实窗口 insets。生产 FixedComposerPanel 的键盘公式和导航 padding 保持不变。

两条修前失败断言已转绿，catalog 与 notification visual family 217 项通过，seed `161606`；三项 Gallery 隔离门禁、typecheck、相关 lint/format 与 diff 检查通过。断言同时覆盖全屏边界、bottom34 实际传入面板、普通内容不重挂载，以及草稿编辑、关闭和重开。设备复验单独核对可见页脚与 IME 的边界，不能将可能延伸到键盘下方的面板宿主 bottom 当成页脚 bottom。

修后独立 Gallery 包 buildId `73bbb6f83d6a4e02a335a5e5f275858c`、APK SHA-256 `dac9b9b1b70f238d148645347dc9c11ff1281a6395f743c6fd95a12bd80d862d`，七个关键源码逐项与 source map 内容匹配、签名匹配，再向隔离设备覆盖安装；UID10209 与首次安装时间保持。模拟器窗口复验中 backdrop 为 `(0,0,1080,2400)`，半屏 footer 底边与 IME 顶边均为 1517，缝隙为 0px；全屏 footer 底边为 1518，1px 舍入重叠。收起真实 Gboard 后 footer 底边为 2337，与导航区顶边一致，全屏 header 从状态栏底边 128 开始。

输入 `performance draft 123` 后显示 21 字符，取消、重开保留全文，末条合成消息 80 仍在。普通消息列表保持 y=128 的安全区。没有发送、上传或标记真实消息已读。自动化 helper 曾短暂失联，原模拟器自行重新连接；没有重置、清数据或以重装系统绕过。完成后已正常关闭本轮专用隔离设备，主登录态设备保持开启。这是 `NOTIFY-02` 合成场景的功能设备证据，不是实际私信 Live 或性能帧时通过。

## 普通包与真实入口

普通 v7 buildId 为 `56b58bb1710743e481ecf77013990f5a`，APK SHA-256 为 `8927d7dcb76360889a956d2bdd5f684ce0b00b24514374b3bf1ec742732f4671`。642 个生产文件、788 个冻结输入与本机 Hermes 源码身份核验通过；APK 是普通 Release、非 debuggable，不包含 Gallery 入口。Gallery 修改完成后再次核对生产 freeze，保持匹配。覆盖安装主设备后，UID10214、首次安装时间 `2026-07-26 16:51:37`、版本和真实 Gboard 保持不变，Account 仍为三站全部登录。

`SEARCH-01` 普通设备流程确认空输入可聚焦真实 Gboard、收起后切页；最终可见的 14 条最近记录与验收前按序相同，输入仍为空。`TOPIC-02/03` 实际打开 L 站 `2556285/9`，确认第 9 楼代码块；评论内查找 `HTML` 后出现四条匹配，代码中的 HTML 可见高亮；改为 `Tailwind` 后两条匹配，原 HTML 高亮取消，Tailwind 更新高亮。随后清空查找、退出详情并回到 Account。未点击回复、赞、加电、收藏或发送。实际原帖的颜色 run 数与 Android 分配次数没有测量，不能拿合成 fixture 的 104 次结果冒充 Live 数值。

普通包在隔离设备退出、构建和测试均结束后运行三批各十次 Search↔Feed 往返，没有同时采集 Perfetto 或启动 profiler：

| 批次 | 有效帧 | p95 / ms | 最坏 / ms | 严格门禁 |
| --- | --- | --- | --- | --- |
| 1 | 527 | 30.579 | 46.522 | FAIL |
| 2 | 527 | 25.679 | 38.232 | FAIL |
| 3 | 528 | 27.826 | 44.964 | FAIL |

60 个切换样本均无 invalid 或 missing rows，普通包身份保持。该结果没有证明切页达标，也不是与 v6 同内容、同登录身份的受控 A/B，不据此宣称三项 CPU 修改改善了整页帧时。`REG-PERF-024` 继续 `OPEN`。

当前最坏 Search 帧的 DrawStart→SyncQueued 为 0.080ms，SwapBuffers→FrameCompleted 为 43.694ms；另一个 41.063ms 帧在 IssueDrawCommandsStart→SwapBuffers 为 38.086ms。最坏 Feed 帧还包含 SyncQueued→SyncStart 等待 10.964ms。提交后耗时仍占多个尾帧的大头，不能据此猜测新的 JS 缓存、隐藏预挂载或某个 GPU 驱动修复。

## 绘制慢帧的边界

前轮普通 v6 的原始 framestats 中，两个最长 Feed 帧的 DrawStart→SyncQueued 仅 0.440/0.068 ms，SwapBuffers→FrameCompleted 为 26.967/37.756 ms。另一个帧在 IssueDrawCommandsStart→SwapBuffers 约 27.118 ms。阶段包含提交、等待和系统工作，不能直接命名为 GPU 忙碌或某个驱动缺陷；这些数据不支持将所有剩余慢帧归给 JS。

因此本轮先消除有修前反例的代码浪费，不恢复此前未完成验证的透明隐藏、提前挂载、图标替换或视觉降级。Account/More 的稳定事件与隐藏动画、Library 的分页和列表派生、Topic 状态索引也已核对，未发现足够强的新反例，不为增加修改数量继续添加 memo。

本轮原始日志、修前快照和可重放实验保存在 ignored `.codex-tmp/code-perf-20261116/`；通知修复的前期日志位于 `.codex-tmp/host-chain-20261116/conversation-derived-*`。它们不进入提交范围。真实 Android 的输入与滚动、普通切页尾部、物理设备及未执行流程分别报告，不用低层计数替代设备验收。

切页原始记录位于 ignored `.codex-tmp/app-perf-root-20261116/navigation/search-runs/v7-code-interaction-unprofiled-3x10/`；阶段复核工具为本轮 `summarize-navigation.cjs`。临时 AVD 已停止；清理其本轮独有数据文件的命令被自动审批以“策略阻止”拒绝，因此保留目录与 ini，不改用其他删除方式。

最终 `STATIC_PASS`：typecheck、相关 ESLint/Prettier、712 modules 架构检查、文档引用与 diff 检查；`APK_SANITY`：普通包当前 UID、首次安装时间、SHA、非 debuggable 与真实 Gboard 复核通过，当前 PID crash buffer 没有崩溃事件。宿主未残留本轮新增 Node、Java、模拟器或 profiler 进程；原主模拟器、ADB、FlClash 与 core 保持。`LIVE_PASS` 仅限上述 Search 空输入和实际 Topic 查找路径；真实私信、物理设备、完整设备 Replay 矩阵及切页性能达标仍为 `NOT_VERIFIED`，不能由合成场景或局部计数替代。
