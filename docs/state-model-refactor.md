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
| B05 | 草稿、提交与互动写操作 | 已验收：11 项完整转换、2 项局部简化 |
| B06 | 阅读入口、回复窗口与原生定位 | 已验收：7 项完整转换、4 项局部简化 |
| B07 | 列表、搜索、用户与消息读取 | 已验收：5 项完整转换、6 项局部简化 |
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

## B05

草稿、发帖与编辑、回复与投票、私信、政策确认、反应及 Stardust 按原完整 scope 复核 25 项：**11 项完整转换、2 项局部简化、12 项合理保留**。代码、完整门禁、两个匹配 APK、专用设备的 16 项隔离流程与主模拟器普通包只读复验均已通过。

完整转换的 11 项为 `PL-JS-topic-submit-attempt`、`ui.draft-autosave`、`ui.draft-context`、`ui.draft-hydrate`、`ui.notify-message-write`、`ui.notify-policy`、`ui.post-policy`、`ui.reaction-picker`、`ui.stardust-payment`、`ui.web-host-submit`、`ui.web-host-upload`。实际调用方已迁入草稿持久化、恢复、规则读取、私信及编辑器写操作负责模块；政策 owner 在 Topic 与消息中共同使用。旧的并行 ref/setter、可选但不一致的提交结果袋和重复收尾写入已删除，未保留一层只转发旧 setter 的包装。

草稿保存的串行 tail、已落盘版本与 retired fence 是独立事实。取消意图不表示 I/O 已经停止，内存 retired 也不能替代 SQLite 的 tombstone/CAS。磁盘 schema v2、JSON 协议与实际 SQL 保持；posted receipt 仍只要求原有 `id/source/title`，不伪造完整 Topic。同步申请、发送结果与本地应用各有归属；主请求和子投票的 `mayHaveSent` 独立，可能已发送而未确认时保留 unknown，不能退回普通失败后自动重发。旧账号可以完成自身持久结算，但不能覆盖新账号的错误、正文或导航。

两项局部收益与剩余控制点分别为：

| 原项 | 本批实际收益 | 保留的控制职责 |
| --- | --- | --- |
| `ui.topic-mutation` | 14 个真实任务使用 typed completion，结果随闭包交给成功路径；回复、编辑、删除与投票改用局部语义命令，移除内部 raw result 强转 | 既有 executor 继续负责权限、同步防重、发送前票据检查及 mutation 结算 |
| `ui.topic-submit-journal` | travel／create／edit 的同步 admission 与具体提交 run 集中归属，attempt/result 关联用于真实异常分类；旧 busy/travel 写入删除 | 持久 journal 的认领、结算与事务仍由存储负责；prepared/claimed 对现有消费者同义，不能按阶段名算整个模型消除 |

12 项保留的是实际资源或独立收据：附件文件与已提交引用、草稿 tombstone/CAS、子投票事务 claim、验证等待的一次性结算、删除 Alert 的消费许可、多帖 Boost 草稿、DOM 投票数据、文档写锁、真实上传锚点、Native entered／exitAction、并行元数据请求集合及按帖 single-flight 核对。每项的消费者、不可派生原因和剩余证据缺口仍在逐项清单；不为字段数量添加 phase。原 281 项分类保持 94 项计划重构、183 项保留、4 项待补证；这些分类数不是未完成数，本批不改原 375 项 CSV 或 ledger。

三个旧缺陷先在已验收 B04 代码上运行实际 canonical 测试，仅安装测试 hunk，seed `644051` 得到 3 个预期失败及 2 个上传 ACK 控制通过；修后同 5 项通过，完整门禁继续覆盖。历史分别记录为 `REG-WRITE-140/141/142`，不额外增加原清单转换数量：

- 同一 document epoch 和 revision 内，旧 submission settlement 仍能清空或解锁后续提交。现在提交实例参与快照前、快照后和 finally 资格检查，旧回调不能接管新提交。
- 第一账号保留的 retryDraft 在新账号已经恢复 ready 后仍重新读取、flush 新稿。现在重试同时绑定捕获 key 与 request；旧动作零 read／snapshot，当前显式重试仍可工作。
- 旧发布日志已经结算 posted，adapter 返回却被延迟并抛错，旧错误污染新账号页面。现在只限制错误展示归属，保留旧账号的真实持久结果。此 oracle 不冒充 SQLite 事务失败或 unknown 落盘测试。

批内集成验证还暴露两处必要接线问题，均在本批修复并保留失败：私信调用方原返回 void，使宿主提前释放新提交身份；改为返回实际发送、文档结算和确认弹窗的完整 Promise。取消、核对会话、仍要重发、dismiss、失焦及 scope 退出各有明确结算，旧 dismiss 不能提前解锁已开始的重发。原主要用例和五个退出用例都核对真实 route＋host 的 busy、正文与零额外 POST；没有为测试删除 owner 守卫。

另一处是隐藏路由 effect 每 render 带入新 query key，空闲 cancel 又发布新的 idle 对象，形成可达反馈回路。现在空闲取消不再发布操作快照，确认清理仍执行。两次实际 V8 OOM／Jest SIGTERM 记录保留；修复后通知原 139 项全部通过，但没有将零已完成用例的 OOM 伪称为某个 inactive 断言 RED，也不宣称已证明两次 OOM 的唯一分配根因。新增退出测试首轮的字符数和空新稿前置错误已按实际正文及合法新稿纠正，没有放宽 busy 或零写入断言。

本批已运行证据：

- `STATIC_PASS`：完整 typecheck 与 `npm run verify` 退出 0，绑定 1147 个冻结输入，SHA-256 `b443577614088e4b63e44f307ceff013c18dd0b461c682076589d9409a77f1fe`。verify 于 UTC 09:46:31.839–09:54:48.002 执行，日志 SHA-256 `b9b5d8ee475179bd49d7f0b13e422ea86da1975d82afd36fa343a0d13ffb22f2`。文档与审查数据收尾另做治理及文档检查，不冒充源码冻结的一部分。
- `UNIT_PASS`：273 文件、4626 项，seed `1794649657774`；包含原 journal、tombstone/CAS、事务失败、附件归属与实际 DOM 协议主要用例。
- `UI_PASS`：105 suites、3292 项，seed `635439265`；原 act 告警保留。局部私信与通知复验为 67/67、139/139，确认退出五项包含在主要 owner 内，不与完整总数重复累加。
- Native `UNIT_PASS` 明确继承 B04 的 66 项：原测试和 RNCWebView 的 6 个输入 SHA 逐项完全相同。本批没有 SDK 或 Native 代码修改，不称为新增运行，也不以原生通过替代 JS 写操作验证。
- `APK_SANITY`：普通 Release 构建 3m59s，APK SHA-256 `2043e20c388c44a1894ae3ddf3bb24d5e63ea9af0c2b765087300ef340d18843`，buildId `e8ff43ee740f48bd95d836776a68a90c`；真实 map 绑定 15 个生产运行模块、实际 Paper dist 与 4 个 DOM 输入，classes、R8/DEX 和 Hermes 分别核对。私有隔离入口构建 3m32s，APK SHA-256 `c5bb03cf9eaf368eca3f65217880ca66405c3b8c845281fb9d1a7fcfc6bae11d`，buildId `cf61fb7772304ce2ac15ba7781ba1753`；同冻结输入的生产模块、6 个 proof 模块、Paper dist、DOM 与实际 Native 产物另行绑定，普通包 sanity 不替代设备流程。
- `DEVICE_REPLAY_PASS`：匹配私有包在专用 AVD 完成 16/16 个既有隔离用例，退出 0，耗时 3m57s；三站发帖、编辑、enqueued／unknown、换站和进程恢复、富文本／源码提交后新稿、楼层回复及三站私信通过。UID 10209、首次安装时间 `2026-11-14 07:25:01` 与 versionCode 162 保持，安装 APK 与上述私有包 SHA 相同；Gboard 与动画设置恢复，运行窗口新增 AndroidRuntime fatal 为 0。专用设备为 API 35／WebView 124，主设备为 WebView 156，证据分开。业务写入由严格 Mock transport 接管，未匹配端点直接拒绝，没有真实论坛 POST 兜底。实际设备上传 begin／finish ACK 仍未验证，不外推真实远端写入或完整 82-case 矩阵。
- 限定的 `LIVE_PASS`：普通包在可见主模拟器同签名覆盖安装，UID 10214、首次安装时间 `2026-07-26 16:51:37`、versionCode 162 保持；新 PID 22888 对应 22 条成功启动记录，真实首页有数据。安装前后实际刷新均确认妖火、NodeSeek 已登录，linux.do 保持「已验证」标签，身份仍为 `NOT_VERIFIED`。最终回到可见首页；主设备未安装私有入口，未运行真实编辑器提交或远端写入。

相对已验收 B04 提交，按 Git numstat 统计生产代码 **+3110／−1937 行**，测试 **+266／−8 行**，整文件删除 **0**；新文件已包含，ignored 产物不计。局部代码增加换取实际归属和类型约束，不把移动、改名或增加阶段名计为删除或消除收益；文档另计。

实际设备上传 begin／finish ACK、全部 Native 转场交错、真实论坛写入、物理设备及数据库断电／跨进程持久性仍为 `NOT_VERIFIED`。现有 stress-image 只取消选择器，不能冒充完整上传；原协议／DOM／宿主跨层用例继续保留。Reaction、Stardust 与政策写入没有现成隔离设备场景，本批按原 UI／gateway／source 层证据验收，不追加真实远端写入。历史黑图、妖火掉线与空回复等异常未由本批关闭。日志、媒体、APK 与回执仅保留于 ignored 目录；本批不 push、不合并、不正式发布。设备与自有进程收尾按最终回执单列；不停止保留的模拟器、共享 MCP 或 ADB。

## B06

阅读入口、回复窗口、列表定位与相关 SDK 归属按原完整 scope 复核 30 项：**7 项完整转换、4 项局部简化、1 项重新判为保留，另 18 项原保留项维持原结论**。代码、完整门禁、普通包绑定继承、匹配私有包的 66 项设备验收和主模拟器只读流程均已通过；最终恢复及进程收尾按独立回执列明。

完整转换的 7 项为 `PL-JS-reading-batch-transport`、`PL-JS-reading-verification-recovery`、`UI-NEW-011`、`ui.floor-position`、`ui.reply-edge`、`ui.reply-window`、`PL-PATCH-flash-follow-bottom`。真实调用方使用窗口、位置、边缘读取、排序菜单与阅读恢复的负责模块；原并行 ref、generation、缓存写入资格及分散 setter 已删除，未留下旧写入旁路。Query 仍负责远端数据、错误和请求生命周期，不复制网络状态。

同一楼层的新命令有独立 command 身份。回复窗口读完只完成 windowReady，不能完成 positionReady；定位 owner 继续等待匹配主题与命令、实际 viewport 和列表 layout 的可见像素。已在视口内、原点或短页边界可直接确认，不强行要求额外滚动事件。计算 offset、scroll Promise 完成或目标数据存在都不能冒充到位。实际 Native 滚动事件没有应用 command ticket；本批不以 JS phase 声称能区分所有相同坐标的旧事件。

边缘读取将原 phase 与 momentum 标志收敛为 idle／drag／awaiting-momentum／momentum，真实 begin/end/advance/stop 都经过 owner。物理 I/O 许可继续独立，停止手势不表示请求结束。窗口 run 与 Query key、路由命令、按排序保存的缓存资格及错误格各有明确消费者。阅读批次的 queue、Retry-After 截止、前后台许可、session 时钟及 disposed 保留独立含义；unknown POST 不自动重放，恢复仍复核 scope、batch 年龄与 beforePost。

4 项局部收益与剩余职责分别为：

| 原项 | 本批实际收益 | 保留的控制职责 |
| --- | --- | --- |
| `UI-NEW-013` | 排序菜单、选择与后续滚动命令集中到局部 owner | pending order scroll 仍是一位独立历史意图；排序、采纳答案与楼层命令未合并为统一优先级流程 |
| `ui.accepted-answer` | 展开／全文展示收敛为当前 view 快照 | lastRequested 是已发 I/O 收据，等待采纳答案滚动仍是独立意图 |
| `ui.topic-entry` | cached／started／settled 由同一 visit 实例拥有，保留合法重叠 | unreadBaseline 与 recordedTopicUpdate 去重仍在原 controller，已尝试但取消的 visit 不自动重放 |
| `ui.reading-entry` | 选择续读目标、窗口就绪和位置就绪分别通过 reducer 表达 | 本地 visit 去重、异步 registration、AbortController 与 1 秒 fallback 仍有独立协议 |

`ui.reply-prime` 经完整重审保留：现有 per-token pending-frame／primed 联合、具体 RAF owner、替换取消和 topic 清理已经明确；React token Map 是真实已提交渲染投影。这里没有待另造的「所有必需行完成」总流程，移动 Map 或增加 phase 不产生收益。只修正其当前分类与事实，不计实施信用；原 281 项分类从 94／183／4 调整为 **93 项计划重构、184 项保留、4 项待补证**。这些不是未完成数，原 375 项 CSV 与 ledger 保持。

唯一新增产品缺陷是 FlashList 已排队的底部跟随帧越过新意图，记录为 `REG-TOPIC-222`。原代码只在排队前检查 command／projection；帧执行前若出现新命令、投影关闭或用户离开底部，旧回调仍 scrollToEnd。真实安装 dist hook 的受控 RAF oracle 在 seed `646061` 下精确 3 个失败，correction 控制通过；新 ready／queued 请求身份在执行前重核，旧帧失效，合法跟随仍恢复，correction 保持无动画。该断言证明 SDK 逻辑，不冒充真实设备已经注入三种帧竞争，也不替代既有保位、长回复对齐或旧楼层回调事故。

首次官方干净重放还发现 patch 容器的 dist EOF marker 与 blob index 失配。官方 2.3.2 原文件没有末尾换行；只恢复缺失 marker 的隔离控制令 forward check 从 1 变为 0，随后修正真实 blob index。没有修改运行源码。最终 patch SHA-256 `38dd1b7fcbecc925fc89574e115a5887610a26ac0a2092768fddc811268dd402` 再经完整官方包重放通过，原失败与控制保留。

设备 v1 是真实 **64/66**，两个新增阅读场景失败，不能写成通过。它们的 controller 已决定自动续读，但私有 ReadingProbe 给列表传原始 command.location（初始为空），没有像真实 TopicRoute 一样透传 readingEntry.location，导致零物理滚动命令。失败 receipt 的 entry 是窗口释放前快照，不能据此误判产品 windowReady 死锁。沿同一 ReadingProbe、真实 controller/List 和既有 Native mock 的 cold／cached canonical，seed `646063` 先证 windowReady=true 后 scroll 应 1 实 0，再将仅该 List prop 接对，2 项转绿、完整 filters 268 项通过。失败 live 标量回执补齐；未改产品、SDK、controller 输入或 command id，也未放宽 Native 像素和到位断言。既有私有类型工厂的静态校验失败与修正只记批内工具记录，均不申报产品 REG。

设备 v2 后续已到达真实排序，但外部 `.ad` 缺少 session，随后核查出旧选择器把 menuitem 当 button、引用仅 mock 存在的 testID，并错误等待排序后已滚出视口的标题。最终驱动只补 plain open 复用当前 App，并按真实无障碍标签选择菜单和楼层；不 relaunch、不合成 Native 回执，也不修改生产逻辑。保留原失败和驱动契约红绿证据。v3 只改 `.ad` 与一项工具契约测试，均不在普通或私有实际 sourcemap 中；其余 1155 输入和全部编译逻辑不变，明确继承 v2 全量门禁与两份实际 APK绑定。当前 typecheck 和该工具文件 63/63（seed `646064`）补验通过，随后以新驱动真实重跑 66 项；没有虚报第三轮完整 verify、全量新增总数或重新构建。最终外部冻结 SHA-256 `02269d8ac9f73229629d2683afb1bb954db4e39cb96b626e6da10b78e0606454`。

最终 v2 与 v1 源码仅差私有 helper 和该 canonical 两项输入。普通包的实际 sourcemap 不包含它们，其余 1155 个输入、10 个生产运行模块、2 个 SDK dist 与 4 个 DOM 输入及生成模块均不变，因此明确继承普通 v1 的实际构建；不宣称整个旧冻结或私有入口也未变化。

本批已运行证据：

- `STATIC_PASS`：最终 v2 typecheck 与完整 `npm run verify` 退出 0，绑定 1157 个输入，冻结 SHA-256 `535dc934f8bd0a6aa877f7d1851aadee780d68e21580649519ec66f037adb4fa`。verify 于 UTC 11:26:03.077–11:34:28.607 执行，日志 SHA-256 `3c4c184d4135b8685bd01be56a7eeabfeae48a6215ea2e20c6230415e661e3b8`。文档与审查数据收尾另做治理及文档检查，不冒充早先运行源码冻结的一部分。
- `UNIT_PASS`：273 文件、4627 项，seed `1794655628410`；阅读恢复旧句柄与 receipt 负控沿原主要 owner 扩充。
- `UI_PASS`：105 suites、3298 项，seed `-1763710769`；原 act 告警保留。最初主要 owner 428 项、fixture 接线 2 项及完整 filters 268 项按各自阶段保留证据，不与完整总数重复累加。
- Native `UNIT_PASS`：原 SDK／键盘／WebView／picker 的 66 项按完全相同输入继承，不称为本批重跑。实际 APK 仍单独核对编译 class、R8/DEX 与 Hermes；这 66 项不能替代阅读设备流程。
- SDK 干净重放：官方 npm FlashList 2.3.2 tarball 校验 lock integrity，完整解包 300 个文件，forward check →真实 patch-package 8.0.1→reverse check 全部退出 0；20 个补丁文件与安装树逐字相同，包含 source/dist。证据 SHA-256 `1a648728fb93cb96cc1f2f494a989746026eccffc8a58e5b30a3b1e0d3609061`。只证明这一包；17 套最终重放仍归 B10。
- `APK_SANITY`：普通 v1 构建 4m03s，APK SHA-256 `215bee6f47d77f92a5c5f8edf177649654b13d5169ef373d5cbe9eb74a238dca`，buildId `271ba9aa4c7f4f52bdcc209ff0cd684a`；按上述实际 map 和输入复核继承。私有 v2 构建 3m43s，APK SHA-256 `668a7e0309d47a41ca0587fe26fd13f02b980c37bb1e6758cf74eea3cf56c5c5`，buildId `48a4c7c5e49f403ea04218817b33d7db`，17 个直接模块、4 个 DOM 输入、RNC 编译产物及 Hermes 另行绑定；专用设备保持其 158 版本码，不改源码 162 或主设备身份。
- `DEVICE_REPLAY_PASS`：匹配私有 v2 APK 由最终外部 v3 驱动完成 66/66，退出 0，UTC 11:58:27.855–12:02:36.173（4m08s），日志 SHA-256 `d6a2c5b9e8ee1b82434b0d9c5ea63c4ba84f6b38746b957c2f82147d0faef3c1`。真实 controller→窗口→FlashList→Native 的 cold／cached 场景分别暂存物理命令，验证窗口完成不能结束定位，再放行并检查实际像素、同目标新命令和旧布局坐标负控。实际排序菜单的八张前后截图已逐张目视核对：冷／缓存均由正序首条 #2 切倒序首条 #40，再切回正序首条 #2。UID 10209、首次安装时间 `2026-09-10 04:04:05` 保持；Native 无 command ticket 的协议限制仍保留。
- 设备 v1 恢复证据：失败后原九文件逻辑恢复完成，独立只读逐项核对 SHA 和实际 mode 666 均为 9/9。通知权限 v1 未保存前态，恢复前后相等为 `NOT_VERIFIED`；不能用期望配置或当前单次状态冒充 equality。v2 及最终 v3 均保存原始前后 POST_NOTIFICATIONS 行与 flags，逐字一致（granted=false），permissionRestored=true；它们不补写缺失的 v1 前态。
- 限定的 `LIVE_PASS`：普通 215 包在可见主模拟器覆盖启动，UID 10214、首次安装时间 `2026-07-26 16:51:37`、versionCode 162 与 WebView 156 保持，PID 23908 对应 22 条成功启动记录。真实 NodeSeek 列表已加载，原生菜单切倒序首条 #6、切正序首条 #1，Back 返回原首页，缓存重开显示主题头部后再返回。安装前后实际刷新妖火、NodeSeek 均已登录，linux.do 标签保持「已验证」，身份仍未独立确认；最终可见首页。该段不宣称主设备验证了保存楼层续读、floor16 定位或真实写入。

相对已验收 B05，按 Git numstat 分开统计：生产代码 **+1086／−727 行**（净增 359），测试 **+275／−3**，私有 fixture **+676／−2**，验证工具 **+93／−1**，patch 文本 **+69／−13**，整文件删除 **0**。安装 SDK 副本不重复计数，文档另计；不把移动或阶段名算作消除成果。B05 行数说明同时按 Git numstat 更正为生产 +3110／−1937，净增仍为 1173，原 difflib 回执保留。

真实远端 reading POST、真实论坛写入、全部来源的动态导航／排序／缓存矩阵、所有 Native 帧交错和物理设备仍为 `NOT_VERIFIED`；当前 66 项受控设备场景也不代表这些范围全部覆盖。历史黑图、妖火掉线、空回复及其它定位事故未由本批关闭。日志、媒体、APK、数据库与权限回执仅在 ignored 目录保存；最终九文件恢复后由独立只读审计逐项核对 SHA 与实际 mode，9/9 一致；随后同版本覆盖回装原 C8 APK（SHA-256 `c8c60cf669254c81802c93bdeee8dfcab65beedf9847739a55b5946f46f8624c`），UID、首次安装时间、158／1.3.154 与原签名保持。任务拥有的 ReaderStorage 模拟器按 PID、父进程、出生时间和 AVD 核验后正常关闭，数据保留。中断后收尾发现主模拟器旧 PID 61344 已不存在，原因未建立；Reader 关闭命令已成功，收尾脚本在随后 Main 断言退出 1，不能据此把 Reader 关闭写成失败，也不能宣称 Main 原进程始终保留。未停止未知进程、共享 MCP 或 ADB。本批不 push、不合并、不正式发布。

主模拟器按既有 AVD、无 snapshot load/save 重新可见打开，没有重装或清数据。重新核对仍为普通 215 包、UID 10214、首次安装时间 `2026-07-26 16:51:37`、162／1.3.158，当前 App PID 3043。重开初始 linux.do 标签为「匿名可用」，显式刷新后妖火与 NodeSeek 已登录、linux.do「已验证」；该标签仍不证明 linux.do 身份，也没有给初始变化归因。最终实际返回有数据首页，主窗口可见；未执行论坛写入。

## B07

列表、搜索、用户与消息读取按原完整 scope 复核 28 项：**5 项完整转换、6 项局部简化、17 项合理保留**。本批完整门禁、匹配 APK 与受影响设备流程按下列实际证据验收。

完整转换的 5 项为 `ui.feed-page`、`ui.search-filters`、`ui.notify-detail-read`、`ui.notify-history`、`ui.notify-list-refresh`。实际 Screen、Route 与 runtime 改用分页申请、筛选编辑、消息已读收据、会话历史和列表读取 owner；被替代的可变 ref、独立 setter 与旧收尾写入均已删除。Query 继续独占远端数据、错误和 cursor，首页保留快照只用于展示，不能用旧快照 cursor 发起新分页。

消息历史区分 owner 当前数据与已由 layout 提交的历史。earlier 结果按当前历史合并，保持 awaiting-commit，直到实际 layout 消费对应 cursor 才释放；晚到结果不能覆盖后来读取。已读请求实例、同次访问尝试许可、逐消息 attempted／confirmed 收据分别保留，发送前继续由真实 gateway 检查来源及身份。`readReceipt.owns + focus` 保留原 passive cleanup 时机，不把本次提取描述为新增 commit 边界的同步取消。

6 项局部收益与保留职责如下：

| 原项 | 本批实际收益 | 保留的职责 |
| --- | --- | --- |
| `ui.feed-refresh` | 同步刷新 owner 贯穿取消与 refetch，React spinner 只有一个发布入口 | 原妖火登录提示与消费回执仍在 controller |
| `ui.search-candidates` | tags／users 的 opening、输入与 debounce ticket 集中归属，相同文字的新输入不复用旧票据 | Query 取消键、category picker 和 source／sheet 的原 passive 清理时机 |
| `ui.search-run` | 当前搜索恢复按 committed scope 与实际 intent 认领，旧 resume 在查询替换后失效 | 原始输入、SubmittedSearch、source／filters、AI 选择与串行搜索历史 |
| `ui.user-page` | reset-pending 与 auto-page-armed 明确互斥，一次 drag 只消费一次分页 | userTab、initialTab／身份的原 passive 更新以及 Native list／RAF |
| `ui.notify-detail-recover` | preparing／settled 恢复票据同步认领、防重和替换收尾 | detail trace、epoch、committed runtime／focus 与 Query detail |
| `ui.notify-open` | 实际 response receive／dispatch／waiting／opened／cancel 收敛到请求 owner | runtimeReady、source operational／cleaning 门禁与实际导航回调 |

`ui.search-ai` 与 `ui.notify-snapshot` 经完整重审保留，不给实施信用。AI 结果由 Query 持有，visible 为派生条件，enabled 是用户选择，semantic read plan 为独立输入；恢复 helper 属于 search-run 的局部收益。通知 Query 结果、发送前分配的 revision、持久化消费收据和 source lifecycle 有不同用途，当前结果不能证明副作用已经落盘。本结论不把所有本地错误投影永久必要化：`snapshotErrors/partialUnavailable` 的无消费者删除候选留待 B10 集中处理。

原始 B07 清单是 **13 项计划重构、15 项保留**；准备文件的 `rows.action` 含候选处置，不能当作原始分类。实际更新 11 项实施与 2 项重审，共 13 行；原 15 个保留项对象不变。当前 281 项分类由 93／184／4 调整为 **91 项计划重构、186 项保留、4 项待补证**，不等同于未完成或未修复问题数量，原 375 项历史文件保持。

实际修前断言在原共享搜索 canonical 建立：seed `647071`，替换已提交查询后，保留的旧认证 recovery 应返回 stale，实际 completed，记录为 `REG-SEARCH-040`。修后同一主要用例先证明等值筛选 Apply 不增加读取、原 recovery 仍 completed，再替换查询并证明旧 recovery 返回 stale 且不增加读取。修前第一次失败阻止了后续计数断言，不能把未观察到的额外请求数写成复现结果。

候选曾无条件使等值 Apply 的 recovery 失效，却没有产生新 Query 请求。该候选回归按 seed `647072` 留下基底 PASS→候选 RED→修正 GREEN：只有当前提交过滤值的 hashKey 实际变化才产生新 intent，没有放宽 stale／completed 断言。它不申报既有产品 REG。通知导航新增 deferred 分支与原 success／error 分支在实际 B06 和最终 B07 均为 3/3 PASS（seed `647074`），是保行为控制，不虚构修前失败或新 Bug。B05 的 submitReply、uploadReplyImage、setPolicyAcceptance 三处真实 Promise 返回链经独立 AST/emit 逐一核对相同，未被旧候选 whole-file 覆盖。

本批已运行证据：

- `STATIC_PASS`：完整 typecheck 退出 0；完整 `npm run verify` 退出 0，UTC 14:33:00.951–14:41:31.681，日志 SHA-256 `3dfab3e8caeae2cdeaf9f9053cef59663821c65f40cde2d9c7783b6a8dfc77d1`。本轮冻结 1168 个输入，SHA-256 `40f88cd07e30a596b7d8ecb2d4b4e28bac49ac23d4480e4505d5f13a9e9fddf9`；文档与审查数据收尾另做治理和文档检查，不冒充早先源码门禁的一部分。
- `UNIT_PASS`：273 文件、4628 项，seed `1794666845555`。
- `UI_PASS`：105 suites、3299 项，seed `-1249148741`；现有 act 告警保留。先前 14 个相关 suite 的 601 项及三个导航基底／最终控制分别保留，不与全量总数重复相加。

- Native `UNIT_PASS`：既有键盘／prewarm／picker 的 66 项按六个实际输入 SHA 完全相同而明确继承，未重跑，也不代替列表、搜索和消息 JS 流程。两个新 APK 分别核对 Native producer／class、R8／DEX 与 Hermes。
- `APK_SANITY`：普通 Release 构建 6m15s，APK SHA-256 `fb898d5f0a0f7597e3ffc4753e0fb46ce0a6a510c6c22dcbc8da4772ce5956c1`，buildId `76a42650c96741c08803d2d8a80b9a7e`；私有 reading Release 构建 5m14s，APK SHA-256 `fb803aeb4e944a1a746cd244387ec3138719e534ec6eba7b1ac43b7a3ff1513e`，buildId `a08519f23d934c1794a21ed3449dc1fb`。真实 map 分别绑定 21／26 个直接模块与 4 个 DOM 输入／生成关系，普通与私有入口分开。普通包在主设备同签名覆盖安装后 UID 10214、首次安装时间 `2026-07-26 16:51:37` 与 162／1.3.158 保持；初始 PID 4458 对应 22 条成功启动记录。
- `DEVICE_REPLAY_PASS`（私有受控范围）：专用 ReaderStorage AVD 实际 66/66，退出 0，UTC 14:50:14.464–14:54:26.829，日志 SHA-256 `48018d975cab4a116e191615acf8198eaae828e2de88d5bda3a27ec9508b80d8`。实际安装 private SHA 与上述 APK 相同，Hermes=true、dev=false；UID 10209、首次安装时间 `2026-09-10 04:04:05`、158／1.3.154 保持。九个数据库／WAL／SHM 已恢复，并由独立只读审计逐项核对字节、mode 与 owner；通知权限前后原始行和 flags 逐字一致。截图的六张与已目视复核 B06 PNG SHA 相同，两张变化的缓存 before 图另行直接查看，正／倒序首条 #2／#40 符合实际原生列表；不把未执行的真实写入算作该回放。
- 限定的 `LIVE_PASS`：普通 B07 包实际显式刷新后，妖火与 NodeSeek 已登录，linux.do 标签「已验证」，身份仍未独立确认。安装后的显式刷新回执单独保存；较早观察在页面加载时尚未匹配到点击，只能证明自动页面读取，不能混写为显式刷新。

主设备 gesture-priority `.ad` 已通过；独立 fling 样本 draggedFraction=0.1047278、coastedFraction=0.1172546，通过保留惯性断言；pull 六种行为通过。两次完整 gesture matrix 均只完成同样的 6 个 settling-vertical 控制后遇到验证遮罩，不相加为 12 项；边界 matrix 通过 13 个控制后同样无法取得 Feed 无障碍观测，三次命令均真实退出 1。没有完整 matrix verdict，不能汇总为 72/72 或全通过。首次摘要不足确认站点；第二次候选的 full Native snapshot 确认 linux.do 安全验证，但不据此推断两次遮罩的原因相同。正常「检测并继续」约 1480 ms 返回 Feed，也不将后来仍被遮罩阻断的重放写成通过。

专用 ReaderStorage 重开时发生原 C8 包 codePath 缺失／PM 异常，UID、首次安装时间、CE／DE 目录与九文件仍保留。经用户当次明确授权，只覆盖补回同一份 C8 包，修复回执核对原身份、目录 inode 与九文件一致，随后才安装匹配私有包执行上述回放。回放后正常覆盖回装原 C8，PM wait／sync 后再次核对原 APK SHA、身份及九文件一致；单次冷启动复核按下文实际结果界定，不把 wait／sync 与之后成功的先后关系写成 flush 根因已经成立。

主设备补充的限定 `LIVE_PASS`／`DEVICE_REPLAY_PASS`：真实消息列表取消刷新后指示器收回，下一次刷新正常结算；NodeSeek 使用已有最近搜索 Android，结果完成且可打开，原默认筛选打开后不变确认，切首页再返回搜索仍保留 Android 输入和完成结果。真实 NodeSeek 用户主页已加载，回复活动与主题两个 Tab 均观察到实际卡片，返回原页面。筛选按钮和用户页文字定位中的驱动误操作已按真实 Native 控件更正，未修改产品来迁就测试。这些场景不证明 HTTP 次数、已过期恢复 callback 的设备注入、消息详情已读写入或真实用户分页。

为区分本批引入的回归，主设备以同版本 162、同签名且保持 UID／首次安装时间覆盖安装已验收 B06 普通 215 包。旧包直接 linux.do 读取有数据，但水平控制仅通过两个 120ms 场景，350ms 阶段同样遇到 full Native snapshot 明确显示的 linux.do 安全验证（日志 SHA-256 `b8afb11d9ffb3cb95d49c743054b64f651b28ba1a530812014f035dc52908a6f`）。这证明验证 surface 在基底也存在，不证明两次遮罩的全部原因相同，也不证明所有手势等价。已覆盖回装 B07 普通 fb898 包并重新核对原身份。

`NOT_VERIFIED`：两次 72 项 gesture matrix、完整边界 matrix，以及刷新中断场景。刷新中断时网络过快，1 秒后已无 pending 圈，前置断言失败；没有改变网络或设置来制造等待，也没有降低断言。上述失败原记录全部保留，受影响的定向产品断言、完整门禁及受控设备回放通过，不扩成所有设备流程均通过。

相对已验收 B06，按 Git numstat（新增文件按实际 LF 行数计入）统计：生产代码 **19 文件，+985／−455 行**（净增 530，其中 11 个新文件）；测试 **4 文件，+36／−5 行**（净增 31）；私有 fixture、验证工具与 patch 本批 **0 行变化**；整文件删除 **0**。文档独立统计，不重复计安装 SDK 或 ignored 证据，不将移动、分类和新增阶段名当作完整转换。

原 C8 回装后实际做了一次无 snapshot load/save 的专用 AVD 冷启动复核，UTC 15:19:24.419–15:19:58.169：APK SHA、签名、UID 10209、首次安装时间、CE／DE 目录 inode、九个数据库／WAL／SHM 字节、mode 与 owner 均与关机前一致。它证明本次冷启动保持，不推断长期耐久或此前 codePath 异常根因；本任务两次启动的 Reader 进程均在精确身份核对后正常关闭。最终主模拟器仍可见响应，普通 B07 APK SHA 与原 UID／首次安装时间／162 保持，当前 App PID 10924；实际显式刷新妖火、NodeSeek 已登录，linux.do「已验证」仍不等同于独立身份确认，原 NodeSeek 账号中心选择已恢复，最终有数据的 All／default 首页。主模拟器、共享 MCP 与 ADB 保留。

真实论坛写入、真实系统通知交付、全部来源和 Native 导航帧交错、物理设备及历史黑图／妖火异常／Search 慢帧因果仍为 `NOT_VERIFIED`；不因普通启动或受控数据通过关闭历史问题。日志、截图、APK、数据库及回执只保存在 ignored 目录。本批只保存本地提交，不 push、不合并、不正式发布。
