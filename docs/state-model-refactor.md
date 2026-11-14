# 状态模型重构执行记录

本轮以 `beff077fe712814b8d255ce1585a98c94698fce1` 为基线，在 `codex/state-model-refactor` 实施。原始盘点与上一轮十批记录保留在 [历史记录](state-machine-batches.md)。当前用户未提交的 `docs/code-cleanup-map.md` 改动不属于本轮提交范围。

目标是删除冗余状态，将多阶段流程交给明确的负责模块，并保持既有功能和数据。必要的独立时钟、身份版本、原生回执、同步防重和资源句柄保留。分类、移动或增加未接管流程的 phase 均不计为完整转换。

## 工作包

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| B01 | 复核全部 281 项与头像请求归属修复 | 已验收 |
| B02 | 账号恢复、认证与 Cookie 交接 | 已验收：2 项完整转换、7 项局部简化 |
| B03 | 请求队列、代理与 Native generation | 已验收：7 项完整转换、3 项局部简化 |
| B04 | 编辑器宿主与文档生命周期 | 已验收：8 项完整转换、5 项局部简化 |
| B05 | 草稿、提交与互动写操作 | 待实施 |
| B06 | 阅读入口、回复窗口与原生定位 | 待实施 |
| B07 | 列表、搜索、用户与消息读取 | 待实施 |
| B08 | 媒体、预览与原生资源归属 | 待实施 |
| B09 | 本地存储、更新、后台与诊断 | 待实施 |
| B10 | SDK 补丁、验证工具与整体验收 | 待实施 |

## B01

审查范围是原保留的 281 项：221 项自有产品代码、24 项 SDK 内部模型和 36 项工具。原 ID、owner 与完整 scope 不缩小，新的分类不等同于实现完成。每项审查记录实际消费者、行为约束、不能派生的原因、主要测试和证据缺口；测试路径存在不代表已经执行。

`FEED-01/USER-01` 共用的头像缓存存在旧请求删除同键新请求的问题。达到 200 项后，旧请求被逐出；同键新请求进入缓存后，旧请求的 HTTP 失败或网络异常会移除新记录，导致重复读取。修复只允许当前缓存仍由该 Promise 持有时删除，没有增加状态或修改缓存容量、请求头、超时及取消策略。

既有 `src/platform/media/avatarImages.test.ts` 新增两条参数化行为用例。修复前 seed `641101` 精确失败于同键 HEAD 次数实际 3、预期 2；修复后原 11 项与两条新用例共 13 项通过。

[当前逐项审查](state-model-review.json) 覆盖完整 281 项，无漏重：97 项安排具体重构、180 项保留（77 项已明确表达、103 项独立数据或资源）、4 项证据不足单列。每项有具体消费者及不可派生理由；这 97 项不是已完成数，180 项也不意味着今后不能改进。不修改原盘点的已验收或 pending 数量。

4 项待查分别为 Native 诊断日志的跨进程崩溃交接、视频贴纸实际 IIFE 执行、proof 中跨 async 的 operation 强引用，以及验收工具跨 await 的全局 descriptor 计量。均保留代码并记录缺口，不称为已确认产品 Bug。B01 初稿将第一项误写成 WebView 中断协议，此处按逐项审查数据纠正；原 ID、分类和数量均不变。

本批实际运行证据：

- `STATIC_PASS`：类型检查与完整 `npm run verify` 退出 0。1073 个冻结输入对应同一运行源码；后加入的审查数据、校验器及治理测试另做定向检查，不冒充已被早先门禁覆盖。
- `UNIT_PASS`：完整 Vitest 270 文件、4612 项，seed `1794627595631`；包含两条头像回归用例。后加入的治理用例不计入该数。
- `UI_PASS`：105 suites、3269 项，seed `-2053111336`；既有 act 告警保留。
- 补充治理检查：新增校验器及测试的定向 lint、当前类型检查、2 项治理用例（seed `641102`）、29 项文档测试及架构检查均退出 0。数据校验拒绝漏项、重复、owner 变更、没有消费者或缺口的结论；明确未知项必须有具体缺口。
- `APK_SANITY`：普通 Release 重建 4m49s，APK SHA-256 `82cf23adfffc8d404b1429515626efbf6cebd53c52d7ce7ec19c7f01a9ded267`。真实 sourcemap 绑定修改后的头像实现；普通入口、Hermes、签名、版本与实际 DEX buildId 均核对。首次失败发生在 ignored 诊断 observer 的输出目录检查，改为本任务目录后成功；没有修改产品或放宽构建要求，原失败保留。
- 限定的 `LIVE_PASS`：主模拟器同签名覆盖安装，UID 与首次安装时间保持，新 buildId 对应 22 条成功启动记录，真实首页正常。北京时间 2026-11-14 11:52 刷新后，妖火和 NodeSeek 仍已登录，最终返回可见首页。linux.do 身份未独立确认；没有读取凭据、清数据或真实业务写入。

Native 没有改动或新增执行结果，不记本批 Native/Replay 通过。物理设备、高基数头像请求的设备现场、私有数据库字节一致性及历史黑图/妖火异常原因未验证；头像并发问题由最低可靠层的真实缓存测试证明。本批只保存本地提交，不 push、不合并、不发布。

## B02

本批覆盖账号恢复、交接、探针、填入、登录诊断、验证页面及恢复意图的协同变化。旧恢复节点在成功后仍能重开 UA 读取、失败重试未决时可再次重启迁移，均先通过真实 Runtime 建立修复前失败断言；独立错误反馈继续保留，不以清空错误改变启动 UI。

深入核对 `auth.session-clear` 后确认，其单入口 async 协议已经唯一拥有 Native 清除、旧键清理和最终发布顺序；credential generation、会话 epoch、账号核对 owner 是三个独立失效事实，调用方只等待布尔结果，没有阶段消费者。保留现有实现与全部守卫，补充旧键部分失败的受控行为断言，不额外增加无消费者的 phase。这是审查修正，不算实现或消除成果；当前计划重构项由 97 调整为 96，保留项由 180 调整为 181，4 项待补证和 281 项分母保持。

完整转换为 `auth.local-identity` 和 `auth.credential-fill`：恢复 owner 绑定 UA 读取、各来源迁移和同步重试许可；填入 session 绑定站点、attempt、表单消费与 trace。实际调用方改用语义命令和只读快照，原写入接口已删除。写入 gate、实际 Promise、错误反馈和单调身份分配器是独立事实，继续保留。

其余七项按原完整 scope 记为局部简化，不冒充整个流程替换：probe 收拢活动槽但账号终态与落盘发布仍独立；Cookie owner 接管 mount/waiters/preparation/close，但 Native generation 策略仍在 Runtime；preparation 接管 marker、核对与落盘结果，但跨进程中断恢复仍在 Runtime；验证页接管文档回执但保留 hook 的当前 key 和计时器；验证 controller 绑定当前检查 owner，但文档自动检测、初始化与关闭调度仍独立；登录诊断统一 trace/terminal，但手工核对 admission 未整体迁走；NodeSeek 恢复 intent 已统一，两个站点的面板检查仍各有身份守卫。逐项收益与剩余控制点写入审查清单，不为凑完整转换数量添加无用 phase。

本批实际运行证据：

- 修复前行为断言：seed `642021` 的旧恢复节点在成功后错误触发 2 次 UA 读取（预期 0）；seed `642023` 的未决 legacy 重试重复执行产生 3 次 Native 读取（预期 2）。修复后原 seed 通过。一次新增用例误以为已打开窗口还能触发重开，改为加强现有真实恢复重试场景；没有改变产品来迁就无效触发。
- `STATIC_PASS`：类型检查与完整 `npm run verify` 退出 0；冻结 1084 个输入。文档和审查数据最终补充另做内容、引用与治理检查。
- `UNIT_PASS`：273 文件、4620 项，seed `1794631737307`。
- `UI_PASS`：105 suites、3272 项，seed `-1168289976`；现有 act 告警保留。
- `APK_SANITY`：普通 Release 构建 3m49s；APK SHA-256 `b278a589f6269a85881cc3734710305b774e50cd39d107537bedc763b5a37cc9`，buildId `84ad83bc944246e692f760cc8a5fd041`。实际 sourcemap 逐一绑定 14 个修改或新增运行模块；普通入口、Hermes、签名、版本与 DEX 身份核对通过。
- 限定的 `LIVE_PASS`：主模拟器同签名覆盖安装后 UID、首次安装时间不变；真实首页与 22 条当前 buildId 启动记录正常。北京时间 2026-11-14 13:01 刷新后妖火、NodeSeek 仍已登录；linux.do 的「已验证」标签与安装前一致，该标签不证明登录身份。最终返回可见首页，构建和测试进程已退出，共享 MCP、ADB 与模拟器保留。

Native 未改，不新增 Native/Replay 通过结论。真实凭据填入、所有认证失败及关闭帧组合、物理设备、私有数据库字节一致性和历史异常原因均未验证；受控错误、并发与身份替换由对应 Runtime/UI 测试证明。本批只本地提交，不 push、不合并、不发布。

## B03

两站各自拥有浏览器队列实例，实例接管当前请求、等待队列、timer、取消监听与一次结算。同步 starting/settling 认领防止重入时旧 renderer 停止新请求；调用方保留单调 ID、来源 generation 与物理 WebView 回执。原 5 个外部 ref 操作 API 删除后，全 Git 文件的 9、7、8、13、10 处匹配分别归零，调用与主要测试共同迁移，没有兼容壳。`stopLoading` 抛错原会跳过结算，受控红绿后仍能结算并启动下一项，20 项队列测试 seed `643031` 通过。

脚本文档各自拥有唯一轮询和终态，维持 NodeSeek 15 秒、linux.do 8 秒及 500 ms 策略。重复注入不延长截止或残留第二条 timer；linux.do 的缺口由真实脚本 jsdom 实验确认，不宣称线上 provider 已频繁触发。代理 apply 绑定 owner 和实际 Promise，保存完成到调用方恢复之间仍关闭 admission。图片调用以 `Created → Claimed → Starting → Started → Released` 接管认领、generation、delegate 与释放，取消和一次失败回执独立。初版在全局锁内认领会延迟 `isExecuted`，独立复核后先补真实双工厂失败断言，再把 CAS 放回锁前，generation 仍在锁内取得。

按原完整 scope：7 项完整转换、3 项局部简化、20 项保留。egress 的注入子协议、代理表单 bulk 操作、rotation 的 publication/退休集合/异常前缀仍独立，不能用局部 owner 冒充整项完成。Native `applyProxy` 已有单一串行 async 和 registry，物理 server 与 transition 成功回执各有用途，复核保留。初始实施候选由 96 调整为 95，合理保留由 181 调整为 182；4 项待补证和原 281 项分母不变，分类与实施信用分开。

本批实际运行证据：

- `STATIC_PASS`：最终类型检查及完整 `npm run verify` 退出 0，绑定 1140 个冻结输入；lint、格式、架构、文档、unused 和版本检查通过。
- `UNIT_PASS`：273 文件、4626 项，seed `1794637565781`。
- `UI_PASS`：105 suites、3276 项，seed `-603255351`，现有 act 告警保留。首轮 3272 项通过后，设备暴露旧 fixture 的初始化前置缺口，最终补的是同一设备 case 的四项主要断言。
- Native `UNIT_PASS`：`NetworkProxyRuntimeTest` 新鲜 XML 107 项零失败，含 Image/Fresco 争锁断言；最初 106 项结果不冒充最终源码验证。
- `DEVICE_REPLAY_PASS`：专用 ReaderStorage AVD 的私有 Release/Hermes 入口 64/64；真实 WebView 执行生产脚本，重复注入截止实际为 15112 ms / 8066 ms。三类数据库及 WAL/SHM 共九个白名单文件、通知权限均恢复。首次 60/64 的失败记录保留：fixture 没提供初始化回执，而基线早已有真实 initializer；修复仅补受控页面与 Cookie 输入、当前 session 接线和 finally 恢复，生产门禁未改。旧流程 seed `643037` 失败于 handoff/resume 均为 0，同 seed 四场景修复后通过；另断言原 Cookie reader 从未调用、方法精确恢复。
- `APK_SANITY`：普通 Release 构建 4m50s，APK SHA-256 `6d314af79afbd3b6a776fb2d6b8cb92f77cef7a39f56652aefcb0abb17650e12`，buildId `3f954c86a6bb4e86819bf566b0999047`。实际 map 绑定 6 个运行模块，Native Kotlin producer 的两份输入与 class 核对。fixture 修正不在普通依赖图，生产和 Native 源码未变，按精确 hash 继承普通构建及 Native 证据。
- 限定的 `LIVE_PASS`：主模拟器同签名覆盖，UID 10214、首次安装时间保持；当前包 22 条成功启动记录及真实首页正常。北京时间 2026-11-14 14:35 刷新后妖火、NodeSeek 仍已登录，linux.do「已验证」标签未变，不能据此证明其登录身份。最终保留可见首页。

隔离设备原装包不可 run-as，私有 overlay 保留其 158 版本码同版本覆盖，JS 源版本仍是本仓库的 162。验收后精确覆盖恢复原 APK，核对 SHA、UID、首次安装时间，再关闭仅由本任务启动的隔离 AVD。主模拟器从未安装私有入口。自有测试与构建进程已退出，后来启动的共享 MCP 按精确归属保留。

构建失败记录保留：ignored observer 的 included-build 判断、私有 overlay 的 AGP 配置时机已修；Hermes 旧下载 URL 404 后，使用官方支持的源码路径，核对现有 12371 文件及既有嵌套副本均与官方 commit `3477757eb2475555cf8d8df24bfb1deb0613880d` 的 Git blob 一致，未换版本或改 SDK 源码。干净 SDK 下载及补丁重放仍归 B10，不能由本机缓存证明。

真实代理故障、全部 provider 时序、Native instrumentation、物理设备、主设备数据库字节一致性和历史异常原因未验证。受控 Cookie 输入不等于真实登录全部通过。本批只本地提交，不 push、不合并、不发布。

## B04

编辑器宿主、DOM 文档、面板交接、私信关闭与 WebView 预热按原完整 scope 复核 29 项：**8 项完整转换、5 项局部简化、1 项重新判为保留，另 15 项原保留项维持原结论**。代码重审、最终门禁、匹配私有包的 25 项设备流程与主模拟器普通包只读复验均已通过。

完整转换的 8 项为 `UI-NEW-038`、`ui.editor-doc`、`ui.editor-panel`、`ui.editor-poll-rules`、`ui.web-host-ime`、`ui.yaohuo-panel`、`ui.message-close`、`PL-PATCH-webview-visible-prewarm`。实际 NodeView、文档、面板、规则与关闭调用方都已接入负责模块，旧 ref/setter 和重复结算路径同步删除。Host 的同步认领与 React 展示快照保持职责区别；已可编辑页面在重新初始化时可保留展示，原 epoch、intentKey、revision 和请求实例仍拒绝陈旧结果。同文档迟到 READY 可以恢复初始化超时，后台暂停 watchdog；不把错误提示当作文档已经退出。

完整转换仍保留必要的独立资源：模板或图片成功结果缓存、CodeMirror 实例与 source handoff、原生键盘回执、物理图片操作及窗口可见性。失效图片请求仍占有物理槽，直到它自己的 finally 释放；旧回调不能释放新请求。预热 lease 在借用硬件层之前认领恢复责任，结束时先消费 lease 再恢复原层。

5 项局部收益与剩余控制点分别为：

| 原项 | 本批实际收益 | 仍由原调用方负责 |
| --- | --- | --- |
| `ui.topic-panel` | 面板 open/pick/insert/rebase 的同步请求身份与语义命令 | 编辑器聚焦意图、工具面板展示、预览和 focusSignal |
| `ui.toolbar-menu` | anchor 随具体 Menu 保存，删除独立 anchor ref | 测量 generation、两阶段原生测量与关闭协议 |
| `ui.editor-templates` | 模板读取 Promise、列表与 busy 统一归属 | 共用 builderError 和模板使用计数回执 |
| `ui.web-host-document` | 加载、初始化许可、超时恢复与 renderer 状态明确 | documentEpoch、initKey、watchdog timer 与 trace |
| `ui.web-host-mode` | 偏好准备门禁迁入文档 owner | 初始模式选择及 content/theme/emoji 已发送协议样本 |

`ui.composer-sheet-focus` 经完整调用重审保留：首次聚焦只由 visible layout effect 认领，再由实际 index=0 回执消费；访问历史、窗口资格与动画 generation 有各自消费者。增加没有独立消费者的 phase 不改善该协议。这是分类修正，不算转换收益；当前重构分类由 95 调为 94，合理保留由 182 调为 183，4 项待补证和 281 项分母不变。分类数不是未完成项计数，原 375 项 CSV 与 ledger 不修改。

设备和门禁发现的两处必要缺陷另列，不额外增加原清单的完整转换数量：

- Paper 按钮禁用透明度变化会使直接子层在实体 View 与折叠之间切换。真实发帖退出时，Fabric 将 SVG 58 或文字 92 重新插入另一父节点，而 Screens 的退场 transition 仍保留旧父节点，导致进程崩溃。实际原生层级与 Android transition 原语均已取证；四类共享 Paper 分支使用 `collapsableChildren=false`，既有 Paper 补丁的 source/dist 同值转发到实际 TouchableRipple。没有吞异常或强行移除旧 parent。真实 Paper→Native host 接线先 RED，再以 seed `644043` 的 93 项相关 UI 转绿；最终 25 项设备重验、Native 父子拓扑与主模拟器普通包只读复验通过。
- User 错误消费原只比较 wall-clock 时间。两个不同 Query 已结算为 error/idle，却可能在同一毫秒被误判为同一错误，漏掉应有登录提示。原 seed `2092716656` 的 5/4 失败保留；受控时钟复现后，四个 lane 按实际 Query 实例与 errorUpdateCount 消费，惰性 WeakMap 不强留旧 Query，显式重试只重臂当前结果。原主要用例同时覆盖同 Query、同 Error 实例、同毫秒与新增错误次数，重复 render 不重放；最终 50 项通过。`ui.user-resolution` 仍属 B07 的合理保留，只更新其消费收据事实，不给本批额外转换信用。

本批已运行证据：

- `STATIC_PASS`：最终 typecheck 与完整 `npm run verify` 均退出 0，绑定 final-v5 的 1140 个冻结输入，SHA-256 `47ececfd43b2d8f9eab196b99001be5e0ffb901966557bf5b8c4df723eeb56b8`。lint、格式、架构、文档、unused 与版本检查通过；文档与审查数据收尾另做治理及文档检查，不冒充早先源码冻结的一部分。
- `UNIT_PASS`：273 文件、4626 项，seed `1794645328676`。实际 DOM owner 的 190 项包含在相应测试层，不与总数重复累加。
- `UI_PASS`：105 suites、3284 项，seed `2067285867`；原 act 告警保留。面板竞争和旧私信关闭先以 seed `-1800449909` 取得 4 个预期失败与 1 个控制通过，原 seed 修后四个主要 owner 共 237 项通过；初版设备崩溃、后续 User 门禁失败均保留。
- Native `UNIT_PASS`：键盘、IME、WebView insets/prewarm 与 picker 共 66 项。final-v5 逐项核对原测试输入及 RNCWebView 源码 SHA 完全不变，明确继承这份结果，不冒充重跑；Paper JS 接线及真实 Native 拓扑不能由这 66 项代验。
- SDK 干净重放：官方 npm WebView 14.0.1 与 Paper 6.0.0-alpha.0 tarball 均校验 lock integrity，完整解包后执行正向检查、真实 patch-package 与反向检查；各自 11/8 个补丁文件与安装树逐字一致。只证明这两套补丁，本轮其余补丁的最终干净树重放仍归 B10。
- `APK_SANITY`：普通 final-v5 Release 构建 4m30s；APK SHA-256 `a108713eccbdf20ec0386ef526a36292541c6628b37a4b4ef2d13510a99a6dc9`，buildId `4da801f5bb7d4c75a1c9532fbad5a9c6`。真实 map 绑定 16 个运行模块、实际 Paper dist 模块与生成编辑器 HTML；WebView producer、编译 class、R8/DEX、Hermes、普通入口、版本和签名分别核对。私有 composer-v5 也完成同冻结输入的 source/DEX/Hermes 绑定，APK SHA-256 `b293afa07423311d22df01501aa75b887a8aebb3396909c729fcce27c799b200`，buildId `19bff4150db74b5b9f2776a34329d512`；私有入口与普通入口的证据分开。
- `DEVICE_REPLAY_PASS`：最终匹配私有包在专用 AVD 完成原 23 项与两个既有 130% 字号场景，共 25/25；7m44s，退出 0。实际 Native 层级确认 SVG 58 的父节点保留为 60、文字 92 的父节点保留为 94，修前后返回/发布按钮的无障碍矩形逐项一致。原 58→62 与 92→96 两次崩溃均保留，不由同 APK 偶然重跑通过替代根因证据。
- 限定的 `LIVE_PASS`：普通 final-v5 在可见主模拟器覆盖安装，UID 10214、首次安装时间 `2026-07-26 16:51:37` 与签名保持；PID 21752 对应新 buildId 的 22 条成功启动记录，真实首页有数据。安装前后刷新均确认妖火、NodeSeek 已登录，linux.do 维持「已验证」标签，身份仍未独立确认。主设备使用 WebView 156，专用设备使用 124；25 项流程属于专用设备，不外推为主设备编辑器或真实写入验收。最终返回可见首页。

完整 82-case 编辑器矩阵、注入 renderer 退出与所有前后台帧交错、物理设备、真实论坛上传及写入仍为 `NOT_VERIFIED`；历史长会话黑图、妖火掉线和空回复未由本批关闭。原日志、媒体、APK 与设备回执只在 ignored 目录保存。本批保存本地验收提交，不 push、不合并、不正式发布。构建和测试进程已退出；本任务新建的专用 AVD 保留给后续 B05 连续验证，主模拟器、共享 MCP 与 ADB 保留。
