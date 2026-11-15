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
| B08 | 媒体、预览与原生资源归属 | 已验收：5 项完整转换、8 项局部简化 |
| B09 | 本地存储、更新、后台与诊断 | 已验收：4 项完整转换、1 项局部简化 |
| B10 | SDK 补丁、验证工具与整体验收 | 已验收：逐项处置完成，2 项具体证据缺口保留 |

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

## B08

媒体、预览、分享与原生资源按原完整 scope 审查 53 项。实际收益为 **5 项完整转换、8 项局部简化、40 项保留**；实际 Native 红绿、完整门禁、普通 APK 与设备证据按下文界定，本批按该有限范围验收。

完整转换为 `PL-JS-playback-handle-intent-budget`、`ui.preview-load`、`ui.share-capture`、`PL-N-svg-render-admission`、`PL-N-svg-page-visual-capture`。实际调用已经使用播放 handle、预览 load、分享 capture、SVG request 和 renderer lease 的负责模块，旧并行状态写入随调用方迁走，不只在外面包一个 phase。首次就绪、当前缓冲、播放意图、全屏资源和生命周期分开表达；首次 ready 不等于当前 readyToPlay，暂停也不等于加载超时。

SVG 的 Reserved 发生在 main enqueue 之前，32 项准入计量不能由 queue 长度推导。页面的 Loading／AwaitingVisual／AwaitingCapture／Capturing／Encoding 跟随具体 PreparedPoster 与页面票据；renderer 的 Empty／Ready／Clearing 则负责物理 WebView 及 about:blank 回执，两条职责不合成一个总 busy。结算只消费本请求，编码仍拥有已交接的 Bitmap，即使请求已超时也沿原路径完成自身回收。新增 draw 失败回收修复的真实 Native 红绿证据另列，不以源码推演或构建失败冒充复现。

8 项局部收益按原 scope 记账：

| 原项 | 实际接管的职责 | 保留职责与边界 |
| --- | --- | --- |
| `PL-PATCH-video-activity-transition` | 全屏截图 overlay、decoder listener、两帧 composition 与一次 release | Activity 的 didFinish、播放器安装、auto pause、stop 与导航归属仍独立 |
| `ui.audio-events` | 异步 replace、超时和 captured intent 使用同一 AudioLoadRun | Native event 没有 source ticket，不能凭当前 run 辨认所有晚到旧源事件 |
| `ui.audio-owner` | replacing／active／failed／disposed 的逻辑源实例与收尾 | 物理 player、串行 replaceQueue 和 retained generation 不互相派生 |
| `ui.media-admission` | deadline／progress 只随 running，failure 只随 failed | 原调度器、warm／viewport／visible 集合和实际 timer 保留；原阶段已明确，不算整套调度新建模型 |
| `ui.preview-ring` | JS ring、目标与待重建意图；真实 React layout 只确认 exact ring | UI worklet 仍按 slot／index／adjacency 接纳旧协议，没有为所有同值回调新增命令 ticket |
| `ui.preview-svg` | poster refresh 及 load owner 的请求归属 | Native view ready 与 poster displayed 是两个实际确认，不能由一次 loaded 推导 |
| `ui.video-events` | 当前 committed player 的 layout／首帧／ended 展示 | bufferedPosition 历史 watermark 与跨 source 路径仍独立 |
| `ui.video-lease` | 请求代际与物理 retained lease 的一次释放 | generation retry admission、acquiredAttempt、pending retry 与 hasBeenReady 仍由组件管理 |

视频行回收只释放行的逻辑附着；仍在全屏的真实 handle 持续持有 generation，直到其实际 dispose 后才归还物理 lease。Audio retire 的 cleanup 后使用原 owner 身份再提交 idle，避免候选中清理重入覆盖后来的 disposed／替换 owner；这属于候选审查修正，没有真实既有消费者的修前复现，不申报产品事故。

三项重审保留为 `PL-N-native-selection-overlay-drag`、`PL-N-region-decode-generation`、`ui.selection-document`。它们已有 PointerGesture sealed、不可变 DecodeRequest／generation 和 keyed document revision 的真实 owner；拖动／pre-draw／redraw 排队、正在显示的 Bitmap、Native cancel ref、布局和去重回执各有独立消费者。另造总枚举会丢失合法并存关系，没有额外旁路可接管。

`UI-NEW-042` 原证据缺口现有真实 DOM canonical：纯 HTML builder 与三个协议常量原样迁至 `src/features/topic/rendering/videoStickerDocument.ts`，生产 owner 实际导入并删除旧副本；独立核对原函数体、常量与五组 HTML 字节等价。canonical 直接 import 真实 builder，在 JSDOM 执行实际 IIFE；实际事件与受控 RAF 触发一次两帧 READY、严格递增有限 buffer watermark、独立 ERROR，两个生成脚本守卫移除负控证明断言可识别重复发布。5/5 已执行通过。READY 的一次 claim、buffer 数值和 ERROR 不能互相派生，因此具体保留现有实现，不给迁移或消除信用；Native 解码、视觉、自动播放和网络仍未由 JSDOM 证明。首轮从生产源码抽取 AST 的写法被完整架构门禁拒绝，失败记录保留，改为真实生产纯函数边界后定向架构检查通过，没有增加门禁例外。

原始 B08 是 16 项 refactor、36 项 keep、1 项 investigate。本批更新 13 项实施、3 项重审 KEEP 和 1 项补证 KEEP，共 17 行；原 36 个 KEEP 对象不变，281 项分类由 91／186／4 调整为 **88／190／3**。分类与实施成果分开，原 375 项历史保持。

已实际执行的证据：

- `UNIT_PASS`：播放预算和真实视频贴纸 DOM 两文件 10/10，seed `648081`，包括上述 5 项 DOM canonical；不把负控另加进用例总数。
- `UI_PASS`：媒体、预览、分享、列表与压力五个主要 owner 共 500/500，seed `648081`；原 act 告警保留。
- 定向 typecheck、lint 与格式检查退出 0。最终 builder seam 后重跑实际两文件 10 项 UNIT、renderer 140 项 UI 和架构检查，seed `648081`；此前五文件 500 项 UI 为其余未变媒体运行代码证据，不把两次 UI 重复累计。最终 v3 为 16 个 tracked scope 路径、8 个普通包 JS runtime 与 22 个安装 SDK 文件，共 38 个唯一源码 pin；未把静态语法检查写成真实行为通过。
- `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`：完整 typecheck 与 `npm run verify` v2 均退出 0，UNIT 274 文件／4634 项，seed `1794675873547`；UI 105 suites／3299 项，seed `-634224729`。verify 于 UTC 17:03:29.973–17:13:21.665 执行，日志 SHA-256 `99936ffdc1061713ea28047437d0cde5c254a270b3a734ab296297e75a020aa2`，绑定 v2 冻结 `4bfff10b…e3d`。独立比较最终 v3 冻结 `cc003609…9444` 的 1196 输入，1195 项逐字不变，唯一变化是 JS 检查之外的 Native 分享 HostTest；因此按相同 JS／类型／工具输入继承完整 v2 结果，不称为 v3 全量重跑。原 act 告警保留。
- SDK 重放：expo-video 57.0.3 官方完整包校验 lock integrity 后，真实 patch-package 正向／反向校验通过，22 个补丁文件与安装树相同；其它 21 段保持，实际新增的是 FullscreenPlayerActivity 的 transition-frame owner。这里只证明该包，不代替 B10 的 17 套最终干净依赖树重放，也不证明最终 APK 已编译入此 SDK 源码。

本批确认的实际资源缺陷记录为 `REG-TOPIC-223`：Bitmap 分配后，Canvas 初始化／clear／draw 若抛错，原 `.also` 没有把资源交给编码 worker，也没有保留可回收引用。先把原 draw 顺序等价提取到真实生产 owner，再运行真实 Android Bitmap canonical；RED 的 6 个方法中 5 个控制通过，失败明确为「poster drawing leaked its allocated bitmap on failure」。首个 IllegalStateException 迭代已中止该方法，RED 没有执行到 OOM，不把它写成两个修前失败。

最小修复由 `drawSvgPosterBitmap` 接收已分配的真实 Bitmap，在失败时 recycle 并重新抛出同一 Throwable；成功时仍返回同一 live Bitmap，交原编码 worker 的 finally 回收，外层异常分类和原有编码／缓存写入路径不改。GREEN 六方法全通过，包含 IllegalStateException 与 OutOfMemoryError 两个迭代、成功蓝色像素／同实例／未提前回收控制，以及真实队列渲染、准入 33 项拒绝和准入过期释放。受控异常证明回收路径，不证明 WebView.draw 在线故障频率，也不解释历史长会话黑图。

Native RED 的源 SHA `6551cff1…c2b21`、GREEN `ae4899a9…3e5ee`、两次相同 canonical SHA `9614838d…e86e6` 均绑定实际仪器产物；GREEN APK SHA-256 `1a7d88067340491a8d265c649ba25df540cf61981940783e040f27e0b3ffe136`、buildId `a64ad87f8ea049159731f57493f4ef63`。原长 `.cxx`／ninja mkdir 环境失败发生在安装和测试前，不算修前 oracle，失败记录仍保留。

此后全屏 transition-frame 的私有依赖从 PlayerView 收窄为其实际 FrameLayout，唯一 Activity 调用方同批迁移；解码与两帧 composition 行为保持，新增三个真实 owner 单测已与两个原有 early-exit 控制实际通过。SDK 源码 `69f4e181…92fa6`、补丁 `a2bd377e…478d1` 已实际正反重放 22 个文件，另外 21 段不变。最终 APK 已不同于上述 GREEN 包：只有最终 SVG source／test 以及 33 个实际编译 producer class 与归档逐字相同，才能继承六方法证据；完整新包、SDK Native 接线和设备证据必须另行验证，不能声称整份旧 APK 同源。

全屏新单测曾在编译阶段因 Media3 的 Player／PlaybackException 不可见而失败，该次尚未执行五个方法。实际 expo-video 将 Media3 1.9.0 作为 implementation，未向 forum-platform 的测试编译导出；本地仅补一行相同版本的 `testImplementation('androidx.media3:media3-common:1.9.0')`，没有新增生产依赖。该配置行不在此前 SHA 以 `1464` 开头的首轮冻结（1195 输入）中，新增后的真实 Native 单测与最终 APK 必须单独记录，不能把旧冻结描述成包含它；原编译失败保留，不当作行为 RED。

`UNIT_PASS`：最终 Native frame v3 fresh XML 为 5 tests、0 failures、0 errors、0 skipped，实际报告 SHA-256 `501786c905b1af65cb398186bfb5778cc9b19e4189c08febb4fbeb9280ff4569`。报告绑定测试配置 `988d8704…2458`、canonical `b25188ef…40e9`、SDK `69f4e181…92fa6` 与补丁 `a2bd377e…478d1`；真实 Android FrameLayout／ImageView／Drawable 验证 first-frame 两次受控 draw 回调、error 与 destroy 的一次释放及旧回调不能清除替换 overlay。这里控制动画边界，不宣称两帧物理 GPU 合成已经通过。

Native 分享 v2 原始结果是三方法通过、一方法在 PNG 解码返回 null 处失败，记录保留。生产 `shareTopicImageFile` 实际 await 文件复制后才调用系统分享，原测试却在仅发现目标文件名后立即解码；这是可达的测试读取窗口，不证明该次失败的唯一根因。v3 只把原九行 chooser 等待及同一断言移至 `captured` 之后、decode 之前，保留原 40 秒找文件再 20 秒等 chooser 的顺序、完整 PNG 宽度／条纹／返回断言；移除同一块后整个 Native 测试文件与 HEAD 相同，没有产品修复或新 REG。

最终 HostTest SHA `16b5ebe7ab754d362205dff22bb24759adde07364b93f7f1a2d96f2bd8044fbe` 的真实 v3 仪器输出为四方法全部结束 0、`OK (4 tests)`；分享 PNG 为 1440×1605、182918 bytes、179 次条纹转换，原要求为至少 170。四方法还覆盖长 PNG 分片、取消／磁盘失败／布局变化丢弃 partial，以及真实 Fabric／ExpoImage 的 JS bridge。完整 runner 在 finally 普通重建后退出 0，UTC 17:20:53.505–17:24:49.535，日志 SHA-256 `de9c720140fe388b5e6109948a72e4884d613dcba616f9bcfe322f1fdb2d2fe7`。实际拉取的分享专用包 SHA `323f6d2cbd2cf55cecc2d36ede625ef7ed5a90550b5694e8bd7b34b850de74d0`、buildId `f133f9c788e243a9af0e04c11f489d7b` 与四份归档来源已分别核对；此包用于分享仪器流程，不替代后续普通／MediaPressure 包和主模拟器预览验收。

主模拟器普通包的图片基本流程限定通过：NodeSeek 主题内首张、第二张可见，HOME 后约 32 秒返回仍为同 PID 与 `2/1381`，关闭再打开相同第二张仍显示同一内容。一次工具呈现曾被误判为黑图；独立读取实际文件后，返回前／返回后／同值重开三份 PNG 均为 1035834 bytes，完整 SHA-256 同为 `f3512fed05ab61fdf6fa58432fd9e0113eb808893b7610848767e243740f355b`，独立解码中央像素也同为 RGB 243／210／201，实际图像没有该次黑帧差异。原图与诊断更正均保留，没有为此建立产品事故或执行所设想的 B07 旧包对照，也没有修改产品。这个观察只证明本次截图时点的返回与重开，历史长会话黑图、其它后台时长及全部 worklet 回调交错仍未解释。

- `APK_SANITY`：普通 v3 Release 构建 4m23s、退出 0，APK SHA-256 `a404e6630a2415f80cc5166efc0a83b9bb3259e93d41ee1201613ae7ca837f42`，buildId `f7a741175d6e4f4b99510c92c67b259a`；实际 map 绑定 8 个生产运行模块和两个 SDK dist 模块。媒体专用 v3 构建 4m17s、退出 0，APK SHA-256 `c8c723f89e6d7e1a6deb806752877ae36c2f3bf9037214b4fd600c3c49ae840a`，buildId `e5c8a2f23ba046ca82237d05ee95ee69`；实际 map 绑定三个生产媒体模块、三个 proof 模块与 Paper dist；冻结另包含三个本地媒体文件及 manifest，APK 逐字核对三个媒体文件。两包各自核对 SourceMap、Hermes、provider、版本、签名、RNC 与 DEX 身份；Native 两个实际 source 分别绑定 33 个 SVG、7 个 Fullscreen 编译 class、jar、R8 输入与 APK class definition，R8 已合并或内联的私有类不冒称仍独立存在。普通与媒体的 33 个 SVG producer class 各自与原 GREEN 逐字一致，继承六方法证据；不称整份旧 APK 未变。
- `DEVICE_REPLAY_PASS`（媒体功能范围）：匹配媒体包在专用 ImageRuntime AVD 完整 runner 退出 0，UTC 17:40:32.371–17:43:37.118，日志 SHA-256 `c8b6b37487ba66c3fe0a4e79e1fac062ac818a66b0a27286aa157bef2d10efa6`。目标至少 20 轮／180 秒，实际 25 轮、180819.716 ms；created／released 为 81／81、peak 2、live 0、observer subscriptions 0，6 次全屏往返与 6 次后台返回，errors 为空。真实行移除已 commit 后，同一物理 player 仍在全屏推进，回行后再归还；UID 10209、首次安装时间 `2026-09-07 17:29:25`、versionCode 162 与安装 SHA 前后一致。
- 媒体视觉按实际边界报告：14 张原 PNG 中 13 张有真实测试画面；round 0／5／10／15／19 五对全屏起止图都有可见斜带／方块变化，两个 inline sample 也有画面变化，排除时间码区域后的像素比较支持该观察。round 20 的 start 原 PNG 全部 2073600 个 RGB 像素为 0，随后 end 有彩色视频；该单点保留，不能宣称六对起止全部有图或零转场黑帧。静态对照确认 B07 与 B08 的正常 overlay 安装、首次 decoder 回执后两个 postOnAnimation 时点相同；本批 error release 会立即移除 listener。五个 owner 单测直接调用 error，不证明首帧移除 listener 后的两帧窗口还能收到新 Native error。这个黑色起始截图的原因、时长与 B08 因果关系均未建立，不新建事故或关闭历史黑图。
- Native 日志含 49 条同文的 ExpoVideo PiP 配置 E 级信息。实际 SDK helper 默认 `shouldThrow=false`，对 IllegalStateException 记录后软处理；本批未修改该 helper 或启用 PiP。功能回执通过不等于 0 条 E 级日志，也不提供该信息与黑色起始截图的因果关系。
- 限定的 `LIVE_PASS`：普通包在可见主模拟器覆盖安装，UID 10214、首次安装时间 `2026-07-26 16:51:37`、versionCode 162 保持；PID 12282 的当前 buildId 匹配 22 条成功启动记录。上述前两张图片／32 秒后台返回／同值重开按实际 PNG 验收，最终回到 All／默认数据首页。独立站点身份刷新与主设备私有数据库字节指纹未验证，没有保存图片或真实论坛写入。
- 设备收尾：ImageRuntime 的 App 与 test 两份原 APK 已同签名 install-r 恢复为 `b30f80bf…f0ddf`／`a5c5d220…fb99`，原 UID、首次安装时间、versionCode 与权限逐项相同；PackageManager wait 与 sync 后复核一致。仅本批拥有的 Image AVD／launcher 精确关闭，可见主模拟器 qemu 67008、window 13700600 仍响应。原 375 历史和用户文档保持；下一批独立启动的 Reader 不属于本批清理对象。

相对已验收 B07 提交，16 个实际源码路径按 Git numstat 与新文件实际 LF 行数统计：生产代码 **+1096／−775 行，净 +321**；测试 **+455／−11 行，净 +444**，包含 test-only Gradle 依赖一行；SDK patch **+72／−35 行，净 +37**。整文件删除 **0**；两个新文件已计入，不重复计算安装 SDK 或 ignored 证据，三份文档另列。实际收益仍为 5 项完整转换、8 项局部简化、40 项保留；Bitmap 修复及同值 HTML seam 不另增模型消除数量。

Native renderer-gone／重复 visual／晚到编码、全部 Audio 旧源事件、所有同值 worklet 回调、全屏和系统分享的全部退出交错、真实论坛写入、物理设备与历史黑图根因均不能由本批局部通过自动关闭。日志、截图、APK、数据库与原始回执只保存在 ignored 目录；不 push、不合并、不正式发布。

## B09

本地资料、更新、通知后台与诊断按原完整 scope 审查 22 项。实际收益为 **4 项完整转换、1 项局部简化、17 项保留**；源码、完整门禁、APK 与设备证据按下文范围验收。

完整转换为 `ui.reader-command`、`PL-JS-update-operation-owner`、`ui.notify-init`、`ui.notify-delivery`。Reader 的 committed 数据、待提交绝对命令、挂载许可与展示投影交给同一 queue，存储仍是事务排序权威；失败后从 committed 加剩余命令重新投影。更新 operation 绑定实际阶段、请求身份、暂停意图和 Native task，持久文件／metadata 与跨挂载 writer 继续独立。通知 bootstrap 分开表达本地存储准备、系统权限与共享初始化 Promise；前台 delivery owner 接管待发 Map、drain 许可和 generation，具体来源、账号、epoch 与 lifecycle 守卫留在实际消费者。

`PL-JS-notification-worker-deadline` 只记局部收益：deadline 与 staged／recording／recorded 补偿子流程迁入各自负责模块，原 keyed delivery lane、分页循环和整轮生命周期继续存在。对外超时不等于已开始的展示、持久记录或补偿已经结束，真实 settlement 前不得释放 lane。不能把两个局部 helper 记成整个 worker 全量转换。

17 项保留各有具体职责：通知持久意图／baseline、事务变更集合、SQLite 冻结与恢复、日志文件／句柄和导出租期、Native executor、请求 trace 失效、页面去重历史、独立说明开闭、SDK 下载暂停，以及跨进程崩溃交接。它们的消费者与测试边界继续逐项记录，不以一个统一 KEEP 理由代替证据。

`PL-X-process-crash-handoff` 从证据不足改为具体保留：当前 `DiagnosticJournal.kt` SHA 与历史隔离 API 35 证据一致。实际 Java fatal 于 UTC 07:31:57.688 记录旧 process session，重开后 07:32:18.989 的 OS previous-exit 记录关联同一旧 session／buildId、reason code 4；新 process session 不同。源码在写新 marker 前读取旧 marker，将 prior 捕获后交异步 OS 查询，uncaught 路径 finally 委派原 handler。磁盘历史、OS 退出信息和当前处理器不能从新进程内存推导，因此保留现有实现，不新增模型或重跑崩溃。SIGSEGV、force-kill、PID 重用、持久化故障及 API＜30／缺 OS 记录分支仍未验证。

原 B09 是 5 项 refactor、16 项 KEEP、1 项 investigate；本批更新五项实施与一项补证 KEEP，原 16 个 KEEP 对象不变，281 项分类由 88／190／3 调整为 **88／191／2**。原 375 历史保持，分类不等于实施数量。

保留行为的三项实际控制分别覆盖：较早收藏失败后重算较晚设置、不保留未提交记录；Native download task 创建前的暂停；Strict Effects 下复用未决初始化。相同 seed `649091` 在旧实现与迁移实现均为 3/3 通过，是保持行为的控制，不写成修前 RED。暂停控制发生在已准备 artifact metadata 后的 beforeRequest 等待，不能冒充 metadata 持久化期间暂停验证。

已执行定向证据：13 个实际源码／测试路径、10 个运行模块已冻结；相关 UI 三文件 111/111（通知 69、更新 30、Reader 12），UNIT 四文件 132/132（worker 57、store 53、SQLite 6、update 16），seed `649091`。typecheck、lint、format 与架构检查均退出 0。17 套补丁和 134 个安装 SDK 文件实际 SHA 不变；本批没有 Native／SDK 修改，不把既有证据写成新增执行。

- `STATIC_PASS`：完整 typecheck 与 `npm run verify` 均退出 0，绑定 1202 输入，冻结 SHA-256 `8a11d83f2a63b65bea2250a0b2660db9d5e73490757be4ffc9102d754a7b199d`。verify 于 UTC 18:13:04.855–18:21:18.303 执行，日志 SHA-256 `84a97f218dfdf9401316b74f3cfc3b6a5f804186464761ddaebf0f4adebebdfc`；最终文档收尾另做治理与引用检查。
- `UNIT_PASS`：274 文件、4634 项，seed `1794680050390`。`UI_PASS`：105 suites、3300 项，seed `-208489848`；原 act 告警保留，定向通过不与完整数量重复累加。
- `APK_SANITY`：普通 Release 构建 6m02s，APK SHA-256 `8d09e1394d5e0611d70a99256e015edfb2ce499a56b993a3fd6558a68efe17f0`、52784742 bytes，buildId `7f511afd020944bfadc09a97d7afaa41`；隔离 reading 包构建 4m15s，APK SHA-256 `44ea7062c7a240039bb954c2602797d0972d3ec9e4f06cf1256b4797480338dc`、53066794 bytes，buildId `cb2aed950c6f494a90d3ad72089a46f1`，保留设备 158／1.3.154。两包分别绑定 10 个生产运行模块、4 项生成 DOM 输入、实际 SDK dist、Hermes、provider、签名和版本；reading 另绑定五个 proof 输入。Native 两 source、33 个 SVG 与 7 个 Frame producer class、jar、R8／DEX 定义均按实际产物核对。
- Native 证据明确继承 B08 的五项 frame unit 与六项 SVG 仪器结果：源码／unit 输入及两个新包的 40 个 producer class 与 B08 精确相同，本轮未重新运行这 5／6 项，不冒称 Reader 设备新执行了 SVG 或全部首帧边界。
- `DEVICE_REPLAY_PASS`（受控通知与既有隔离场景）：匹配 reading 包实际 66/66、退出 0，UTC 18:31:28.293–18:35:31.071，日志 SHA-256 `3e773ea516e17018ce98d40e7f9cffcde78b4590b41a51ddb1ef083a99e4f9c7`。后台 cold 的成功与 deadline 两场景分别在新进程执行，536 ms／50012 ms，均实际 background、Native task／worker 完成；UTC 18:39:07.639–18:40:28.736，日志 SHA-256 `c0cfd5aa806f7db71de73d7f5b6e71cd6d6cba30c8bd12b1d0cfe72816c24c44`。这是强制 headless 验证，不是自然 15 分钟调度通过。
- 限定的 `LIVE_PASS`：可见主模拟器普通包覆盖安装后 UID 10214、首次安装时间 `2026-07-26 16:51:37`、versionCode 162 保持，PID 13458 匹配当前 buildId 的 22 条成功启动记录。历史列表 622 条 ready，首个 NodeSeek 主题正常打开并返回 ready；收藏空态与用户页可读。显式检查更新结算为最新版 1.3.158，未下载或安装；More 滚回顶部，最终回到 All／默认数据首页。Reader 失败回滚／导入与 Update 暂停／恢复／安装返回的完整设备转换仍未验证，不能由 66 项或 map 引用代替；主要断言由受控 hook 测试负责。
- 数据与设备恢复：独立审计及恢复原 C8 包后的再次检查，均确认九个 DB／WAL／SHM 字节、mode、owner、CE／DE inode 与权限保持原值；同签名 install-r 后经过 PackageManager wait／sync。Reader 的 qemu 89228／launcher 58656 于 18:43:24 正常关闭，可见主模拟器 qemu 67008／window 13700600 保持响应。主设备私有库字节指纹与独立站点身份刷新未验证。
- 构建输出卫生另有未完成项：实际普通 APK 留有三个未被 normal map／Hermes 引用的合成媒体资源，共 2944589 bytes。B10 已准备精确清理三个已知生成副本并加 APK absence gate，尚未执行；B09 的正常功能和上述绑定通过不代表普通包零测试素材残留。这是本轮验证输出卫生，不修改产品行为、不新增 REG，最终普通包由 B10 再验。

相对已验收 B08 提交，13 个实际源码路径按 Git numstat 与六个新文件实际 LF 行数统计：生产代码 **+563／−267 行，净 +296**；测试 **+48／−0 行**；SDK patch **0**；整文件删除 **0**。两份改动文档另计，corpus 保持原字节；安装 SDK 与 ignored 证据不重复统计。实际收益为 4 项完整转换、1 项局部简化、17 项保留，Native 崩溃交接补证不算新模型转换；用户文档与原 375 历史不变。

设备范围须逐项界定：reading／review-remediation 的既有 66 项实际挂载通知 Runtime，可证明其受控通知与存储场景；AppRoot 的字面引用使 Reader／Update 出现在 map，并不表示 66 项执行了这两个 hook。普通包的 Library／Update 只读入口观察与 canonical hook 测试分开报告；实际下载／暂停／回滚、安装器返回、所有持久化故障、自然 15 分钟后台调度、物理设备和真实远端写入不能由启动或 map 绑定自动关闭。没有已确认新产品 Bug 时不新增 REG；日志、数据库与 APK 仅保存在 ignored 目录，不 push、不合并、不正式发布。

## B10

本批收尾审查 36 项开发／验证工具与 2 项 SDK 原始 scope，最终为 **36 项具体保留、2 项证据不足**；未给工具重分类或 SDK 分发一致性增加完整转换信用。另对前批范围作小幅减法：通知删除无产品消费者的错误投影，B05 删除已被模型替代的冗余 payload；原提交、草稿和副作用收据仍保留。

实际源码范围为 12 个 tracked 路径、4 个普通包运行模块及 2 个安装 SDK 文件。Git 相对 B09 统计：生产代码 **+35／−70 行，净 −35**；测试 **+56／−50 行，净 +6**；proof／fixture **+0／−4 行**；SDK patch **+57／−2 行，净 +55**。整文件删除 **0**；安装 SDK 与 ignored 证据不重复计行，文档另计。两套 SDK 修复增加 patch 行，不把它们混称为 App 新增状态。

### 删除与保留的实际依据

`snapshotErrors`／`partialUnavailable` 在旧 HEAD 的全仓匹配只落在 owner 写入／返回、fixture 和对应测试，没有产品读取者；当前 `src`、`dev`、`tests` 的 TS／TSX 搜索为零。删除状态、setter、转发与 `errorUpdatedAt` 的投影触发后，Query 仍持有请求／错误，来源 lifecycle 的 cleanup 拒绝、诊断日志、发送前 revision 和持久消费收据继续有效。测试观察真实 Query `status/error` 或实际 cleanup 拒绝，不为被删副本保留断言。此收益归到原 `ui.notify-snapshot` 的一次局部简化，不能称为整个通知模型已被替换。

B05 删除的 `Feedback.draftId`、travel command、submitting mode 和 prepared／claimed 重复阶段均没有独立消费者；真实 draftId／revision／retired、磁盘日志、发送资格与 `mayHaveSent` 仍在。edit 的 attempted 仍在 durable begin 之前，create 仍在其之后，发送时点和 unknown 分类不改。它们属于已计原项的进一步减法，不再增加模型数量。

`ui.new-topic-exit` 从遗留 refactor 分类改为具体 KEEP：`entered` 是 Native 非 closing 且 focused 的首次进入回执，决定编辑器挂载；`exitAction` 是上传／草稿 flush 后批准的原 NavigationAction，须先 React commit 解除 prevent，再派发。两个事实有独立消费者，不能互相派生。route／screen／draft canonical 分别证明旧 epoch 返回、编辑器挂载前输入保留及保存失败阻止退出；不冒称完整 Native 转场矩阵已验。

工具保留理由按实际入口逐项核对：独立 `registerRootComponent` proof、package script／runner、VisualGallery scenario 和测试 fixture 都有各自消费者。设备操作许可、已取得的 session、录屏进程、已分配的 Native task、已提交资料与观察取消不是同一个 busy 的重复表达。`TOOL-07` 的 finally 已先撤许可再核身份，只在再次确认后驱动或关闭本次 session；现有媒体 runner 保留，不再加总 phase。真实 proof-root 生命周期与 visual scenario canonical 可作局部证据，但未覆盖的 Native 安装器、全部故障收尾和硬件返回组合仍逐项留缺口，不能因有测试文件便写成全面通过。

### 两项 SDK 实际红绿

Reanimated 的 `node_modules/react-native-reanimated/src/PropsRegistryGarbageCollector.ts` 已是 Map 成员资格与 timer 资源的明确实现，保持不变；公开 `lib/module` 分发副本仍使用过期计数。相同 canonical 在旧源码入口通过、旧 dist 入口失败于应回写 `height:460` 却实际调用 0 次；同步 dist 的 Map.size 与成功 delete 后两个入口均通过。主要普通包实际 map 使用 src，因此这是分发一致性修复，不能写成新发现并修复了 App 的线上视觉故障，也不计 whole／partial。

Hermes 使用真实 `downloadHermes`／`unzipHermes` task 建立归档布局断言：旧 task 虽报告 BUILD SUCCESSFUL，cached meta 归档仍多一层目录，根 CMake／API 缺失，实际 oracle 为 RED。新实现使用 meta URL 并兼容 `facebook-hermes-`、`meta-hermes-` 两类 archive root；官方下载、cached facebook、cached meta 三条真实 task 路径均 GREEN。没有改版本、根缓存或生产业务状态；不把该问题描述成永久 404。Hermes 不属于原 281 项，作为额外构建修复报告。

定向证据实际通过：5 个 UI 文件 **347/347**，patch／collector 两个 UNIT 文件 **19/19**；typecheck、lint、format 与架构检查均退出 0。修前两个预期 RED 与修后 GREEN 原日志保留；ignored recipe 的 `vi.fn` 文本守卫适配只影响应用前检查，没有删改 canonical 断言。

- `STATIC_PASS`：最终完整 typecheck 与 `npm run verify` 均退出 0；冻结 1205 个输入，SHA-256 `5e2b5aa743398ffb3e7742b4fe99abfd794e9967b447b57bb09f4a9baee1119a`。verify 于 UTC 19:05:25.314–19:13:53.505 执行，日志 SHA-256 `18f898d8ae11b98c32dafc2e65833ac5fc86d1232127d1b4186826356b306561`。
- `UNIT_PASS`：274 文件／4635 项，seed `1794683197125`；`UI_PASS`：105 suites／3300 项，seed `200272678`。原 act 告警保留，定向数量不重复累计。
- SDK 最终干净重放：隔离目录实际 `npm ci`、17 套 patch-package 与原 canonical 17 项均退出 0，seed `650101`，134 个对应安装文件逐字一致；主依赖树／package 与补丁输入保持。fixture 只增加局部 Vitest config 及显式 `--config`，避免继承父工作区配置；原 canonical 字节与断言未改。它证明补丁可重放，不代替 Native 编译或真实设备。

- `APK_SANITY`：普通 Release 构建 6m41.633s、完整 wrapper 退出 0；APK SHA-256 `53d0b70ad12a317579124040951342dfaaf775c78f174e7a15e32ab266851340`，49845386 bytes，buildId `b5ad7679e41c4aa9b31e5df0a3c704ef`。实际 map 绑定四个本批生产运行模块、FlashList／Paper／Reanimated 三个 SDK 输入与四项 DOM 输入；Hermes、版本、签名、provider 和 RNC 接线逐项核对。
- Native 按实际产物确认两个 producer source、40 个编译 class、六个 JAR 与两个 R8 输入，实际 APK class definitions／public anchor 通过；33 个 SVG、7 个 Fullscreen class 及五项 frame-unit 输入与 B08 同字节。只继承原五项 Native unit／六项 SVG 仪器证据，本批没有重跑，也不新增首帧／长期黑图结论。
- 生成资源卫生已在最终普通包验收：只删除 `android/app/build/generated/res/react/release/raw` 中三个同名、同大小、同 SHA 的已知生成副本，共 2944589 bytes；三个原始 ignored 媒体文件保留。实际 APK 所有 wav／mp4 entry 为零，三个 synthetic payload 零匹配，map／Hermes 无五个指定 proof 引用；脏 B09 包拒绝、干净 B08 包通过的负控与最终包分别记录。此为本次输出卫生，不写成全局 Gradle 缺陷或产品行为修复。
- 限定的 `LIVE_PASS`：主模拟器同签名覆盖安装后 UID 10214、首次安装时间 `2026-07-26 16:51:37`、versionCode 162 保持，PID 14978 的当前 buildId 对应 22 条成功启动记录。实际首页数据、空输入 Search、消息列表 76 条、More、历史 622 条均可读；历史首个既有 NodeSeek 主题打开正常，图片预览 `1/1381` 有可见内容，返回主题／历史后回到首页。消息数量与 B09 安装前只读基线一致；未开消息详情或触发已读、发帖、点赞、切换收藏及清理。
- IME 如实收尾：实际发现 helper IME，按工具保存的 previous 值及早期基线核对后，仅一次 `ime set` 恢复 Gboard 并读回一致。`testIme=false` 仅跳过 activation，不能证明原 IME 未变；切换时点不明，本批没有键盘几何／输入／composing 验收，不归因为 App 故障。
- 设备与进程收尾：实际可见主模拟器 qemu 67008／window 13700600 未最小化且响应；本批 full-gate、构建与隔离重放会话已结束，观察为 Java 0、B10 脚本 0，仅保留主模拟器，ADB 仅列 emulator-5554。专用 proof 设备此前按各批恢复后关闭；共享 MCP／ADB 与未知进程未停止。独立站点身份刷新、主设备私有数据库字节指纹与完整键盘／业务写操作均未验证。

### 原 281 项的最终处置

| 归属 | 完整转换 | 局部简化 |
| --- | --- | --- |
| B01 | 0 | 1 |
| B02 | 2 | 7 |
| B03 | 7 | 3 |
| B04 | 8 | 5 |
| B05 | 11 | 2 |
| B06 | 7 | 4 |
| B07 | 5 | 6 |
| B08 | 5 | 8 |
| B09 | 4 | 1 |
| B10 | 0 | 1 |
| 合计 | **49** | **38** |

其余 **192 项合理保留、2 项证据不足**，合计仍为 281。B01 头像只修正缓存请求归属，补记局部成果；B10 通知只删除死投影；B05 进一步减法不重复计数；Reanimated dist、Hermes 与生成资源卫生分别报告。49／38 是原 scope 的实施结果，不是文件数、删除字段数或“所有状态机均已消失”。必要的身份、资源和回执仍存在，38 个局部项也各有剩余控制职责。

动作分类最终为 **87 refactor／192 keep／2 investigate**，其中 87 项已分别交付 49 whole 与 38 partial。原 `ui.new-topic-exit`、`TOOL-07` 改为具体 KEEP，通知从 KEEP 改为实际局部简化；不以历史分类数字充当未完成数量。原 375 项历史、原 ID／owner 与用户文档保持。当前逐项审查保留实际消费者、不可派生理由、canonical 与具体证据缺口；本轮 source 审计另核 owner SHA、字面入口图及独立 proof 入口。字面 import 图包含 type import，动态／Native／公开入口另按实际契约判断，静态不可达本身不构成删除证明。

两项证据不足继续保留：

- `DEV-X02`：`pendingAction.settled` 与 fresh-JS sentinel 有实际消费者；`.operation` 没有显式读取，但可能在 checkpoint／GC 期间强引用未决 Promise。尚缺“只去掉 operation”后的同 Hermes GC 压力、未决 transport、force-stop／reopen 与 durable journal 因果对照，不能仅凭搜索删掉。
- `ROOT-TOOLING-NEW-005`：全局替换 `String.prototype.split/slice` 跨 await 计量，finally 恢复精确 descriptor。已有真实 Hermes 成功、输出／预算和 descriptor 恢复证据；缺口是 DB／materializer 暂停时与其它 React／Query／trace／proof String 消费或另一 hook 重叠，以及失败／取消的恢复隔离。正常成功不能证明全局计量互不污染。

基线 `beff077f` 至最终工作树按 Git 直接差分统计，未累加批间反复编辑；原用户文档、安装 SDK 与 ignored 证据排除。

| 类别 | 增加行 | 删除行 | 净变化 |
| --- | --- | --- | --- |
| 生产代码 | 9345 | 5793 | +3552 |
| 测试 | 2033 | 379 | +1654 |
| 文档 | 5665 | 1 | +5664 |
| SDK patch | 294 | 131 | +163 |
| proof／fixture | 907 | 102 | +805 |
| 开发工具 | 158 | 5 | +153 |

整文件删除 **0**，新增整文件 **55**；移动、重命名和 SDK 安装副本不算删除。这里的删除行是 Git 差分，不能换算成模型数量。生产净增加来自真正接管旧流程的 owner、类型和必要边界；本轮目标按“状态清晰优先”验收，不以总行数下降代替行为证明。

长期黑图、妖火掉线／空回复、Search 慢帧和冷启动波动仍按各批已确认范围保留；本轮没有补齐因果的历史问题不关闭。媒体 round 20 的黑色起始截图、Native 首帧窗口、真实下载／安装返回与全部身份交错等已列 NOT_VERIFIED 边界继续生效。没有新增已确认的 App 产品事故，corpus 保持原字节；测试、构建、设备截图与原始日志仅保存 ignored。不 push、不合并、不正式发布。

## 2026-11-15 审查后续实施

本次以 `9a92d686` 为代码基线，按用户要求一次性完成妖火评论兼容、必要减法、审查门禁及遗漏清理整合，不 push、不合并、不执行正式发布。原有 `docs/code-cleanup-map.md` 未提交改动保留。历史范围分别为 `c3a0a45f..bcbc97b0` 的去重与依赖清理、`bcbc97b0..9a92d686` 的全部状态机治理和 `beff077f..9a92d686` 的最近模型重构；原始 unused-code-audit 工作区单独核对，不覆盖当前实现。

妖火评论根因及修复证据归 `REG-TOPIC-224`；新旧集合和引用类名兼容，作者/时间优先读取头部，正文嵌套节点不进入回复集合。`TOPIC-01/03` 的新增四项断言在 seed `651201` 修前失败，修后现有来源 owner 共 97 项通过。

`ACCOUNT-01/02/04` 的 preparation 删除内部事件转发，保留 marker、identity、persistence 的独立事实和 pending 守卫。`TOPIC-04` 的分享捕获删除无消费者的阶段字段，以当前 run 绑定认领、取消与结束，独立保留 preview ticket 和 Native ready；没有改变分享或保存协议。定向 Account/Share UI 215 项、preparation unit 4 项通过，seed `15112026`。

治理检查新增实施记录与分类一致性、完整转换/局部简化的剩余职责、测试文件及验证章节引用检查；10 个新增负向断言修前失败，修后 13 项通过，seed `641117`。同步过期描述，原 281 项分类和 49 whole／38 partial／192 keep／2 investigate 数量保持；不把新增门禁当作全部运行时行为已验证。

原 unused-code-audit 的 92 文件、125 个差异块均按当前消费者重新核对，实际迁移 89 文件、+130／−174 行；原工作区 92 文件哈希全部保持。127 个导出候选中，124 个收窄到模块内部，1 个已无消费者的类型删除，1 个认证取消函数因新增两处真实调用保留导出，1 个旧写队列已被新模型替代。旧 Session 重复守卫和 Topic 判空已被后续重构覆盖，不重新套入；无消费者样式、测试 Context、类型与重复判断按当前实现删除。符号审查覆盖 1015 文件，相关运行模块的 194 处引用均为静态命名 import；检查动态入口后再执行删除，完整类型及运行门禁继续兜底。逐文件、原始 hunk 与原工作区哈希回执仅保存在 ignored 目录。

最终 `STATIC_PASS`：typecheck、完整 verify、281 项治理及收尾文档检查通过。`UNIT_PASS`：274 文件／4651 项，seed `1794686352106`；`UI_PASS`：105 suites／3300 项，seed `-1880201876`，既有 act／StrictMode 告警保留。额外定向数量不重复累计到全量数。

普通 x86_64 Release 构建 5m1s，APK SHA-256 `dbf89d88d76c313d607e4a93fe455c74639675258eea79aa0eedca7f5934f860`、buildId `d4388a2b485445c5808370db1f74baed`。638 个生产路径、782 个生产/SDK/配置输入前后冻结相同；88 个变更模块中 84 个实际 SourceMap 内容逐字匹配，三份纯类型文件不在图中，linuxDoPoll 的类型导出改动经 Composer builder 和实际生成模块另行绑定。APK 的 Hermes、普通入口、非调试、签名、版本和 DEX 身份通过，未带合成音视频或指定 proof 引用；没有重跑或继承宣称 Native 专项通过。

`APK_SANITY` 与有限 `LIVE_PASS`：主模拟器同签名覆盖，UID、首次安装时间与 Gboard 保持，当前 PID 的 22 条启动记录匹配新构建，崩溃和运行失败窗口未命中。妖火短长帖正倒序、跨页终态、目标与引用、筛选、查找、刷新及重进见 `REG-TOPIC-224`。四来源实际主题/回复/排序只读抽查通过；Share 的真实预览、Native 捕获、系统图片分享面板、取消后重试通过，未选择接收方或保存相册；妖火原有账号 surface 打开/关闭后仍已登录。消息列表、空搜索与历史列表可读，不打开消息详情或清理数据。

未验证物理设备、真实业务写入、完整键盘/上传及 Native 回调矩阵、全部原站媒体和历史掉线原因；未把部分原站图片失败静默算成媒体全通过。192 个合理保留和两项工具缺口维持原结论，Native 事件来源及预览旧 worklet 回调的既有证据缺口继续保留。完整测试与构建自有进程已退出，保留共享 MCP、ADB 和原主模拟器；改动留在当前分支工作树，不新增提交、不 push、不合并。

## 2026-11-15 冷启动与建连核对

本轮继续使用上节工作树与普通包为基线，影响 `NAV-01`、`FEED-01/02/04`，共享分类、账号和后台启动门禁一并核对。用户要求启动状态可追踪、内容更快出现；目标不是把必要的生命周期状态按数量删除。以下为启动关键路径的现有 owner，完整清单仍由[状态审查记录](state-model-review.json)维护。

| owner | 真实等待与状态 | 是否阻塞冷启动；本轮结论 |
| --- | --- | --- |
| `useReaderRuntime` / Reader command queue | `loading → ready/recovery`，先取得可信设置与本机资料；写入独立排序 | 阻塞正常路由与来源许可。保留，不能用默认设置提前放行或覆盖资料。 |
| `useAccountStatusController` | `reading → loaded → restoring → ready`；已有快照恢复与一次性候选迁移分开 | 普通已迁移启动只读本机终态，本轮样本没有启动 Account probe。5 秒迁移预算不是所有冷启动必经的网络等待。 |
| `useLocalIdentityRestore` | UA 读取、逐站身份恢复、legacy Cookie 迁移各自绑定当前 owner；失败可重试 | 身份恢复参与正常路由门禁；保留真实成功、失败和取消。不能把存储未返回当成已恢复。 |
| `useAppStartupRuntime` | `awaiting-navigation → delivering-navigation → awaiting-layout ↔ check-queued → ready`；另有挂载 owner、Splash 一次交接和 idle task | 只等本机恢复后的导航与当前 route 布局，不等网络；保留以避免旧页面布局或深链交接误放行。 |
| `useNetworkProxyRuntime` | `loading → applying → disabled/applied/failed`；apply Promise 与持久化分别拥有顺序 | 读取前等待实际代理生效，准备共享 10 秒 deadline。基线直连冷启 Native apply 仍涉及 WebView，约数百毫秒，是否能安全减少须独立对照；本轮未跳过。 |
| 默认 WebView UA reader | `cold → reading(task) → ready(value)`，失败归回 cold；并发读取共用 Promise | 只影响确实缺 UA 的来源；准备完成后才开始 transport 预算。保留成功缓存与失败重试，不新增预热旗标。 |
| Feed Query / `feedSnapshot` | Query 拥有请求和 cursor；快照只展示本次部分结果或此前可信内容 | 原来必须等全部来源结算才有帖子。本轮解除这一显示等待，复用现有快照，没有增加持久缓存或第二个请求状态机。 |
| `useInitialForegroundRuntime` | `awaiting-both/awaiting-feed/awaiting-catalog/ready` | 只限制通知、更新与延后分类；首个来源展示不提前触发该终态。保留以免后台任务抢首屏资源。 |

全部来源 Feed 的每站读取预算由 5 秒改为普通 HTTP 的 15 秒，仍取消超时 transport；准备的 10 秒和 Categories 的 5 秒不变。无 Query 数据的首屏先展示各来源有限份额，最终保留已显示顺序并补齐平衡选集；刷新已有列表仍整次替换，部分结果不提供 cursor。Gateway 与 controller 两层复核取消、来源许可、身份 scope 和活动入口。修复前的慢来源与提前布局断言失败，修后通过；相关事故归 `REG-FEED-046`。

主 API 35 模拟器保留数据的进程冷启动，普通 Release/Hermes，旧包 3 次、新包 5 次，各次 PID 独立。以下是有限样本，覆盖安装首开包含在新包样本中，没有把 CPU 采样或录像轮次混入计时。

| 指标 | 旧包 | 新包 | 解释 |
| --- | --- | --- | --- |
| `page-ready` 中位数 | 621 ms | 719 ms | 可见路由布局标记，非系统实际呈现；未证明本机壳层提速。 |
| 首批帖子 `feed-content` 中位数 | 3854 ms | 2678 ms | 提前 1176 ms，约 30.5%；新包范围 2559–2708 ms。 |
| 完整 Feed 读取中位数 | 3165 ms | 3047 ms | 从读取 intent 起算；新包范围 2942–3682 ms，不能视为建连提速或与进程起点直接相减。 |
| 每次首屏来源错误数 | 0 | 0 | 本轮没有现场复现用户频繁 5 秒超时，慢 6 秒的正确结算由受控测试证明。 |

Native 逐请求事件显示单进程共享 forum pool、IPv4/direct、TLS 1.3 与 HTTP/2，未见地址回退失败。新包 DNS 约 251–913 ms、TCP 约 476–515 ms、TLS 约 154–534 ms；各区段来自同一 call 的成对事件，不是纯 CPU。旧包暖刷新在 2–7 ms 取得复用连接，新包一次暖刷新全量 1317 ms。连接复用已经有效，当前没有证据支持更换网络库、固定 IP、持久 DNS 缓存或单独 HEAD 预热。独立 Simpleperf 5 秒、331 个样本无丢失，主要采到模拟器时钟和绘制工作；不足以把建连等待归因为 TLS CPU。事件语义参考 [OkHttp 官方连接说明](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/docs/connections.md)。

`STATIC_PASS`：typecheck、完整 verify、收尾文档与差分检查。`UNIT_PASS`：274 文件／4655 项，seed `1794689751495`；`UI_PASS`：105 suites／3302 项，seed `-883213479`。随后补强快来源多帖的份额断言，31 项来源测试再次通过，seed `151150`，未改生产构建输入。Gateway 取消、停用与身份变化隔离，Controller 首屏/刷新，以及实际布局后才启动后台均有相应行为断言。

普通 APK SHA-256 `f2e70288f895cf84291c989d6bff7d917662a58459a88b1ad49dd0d260b6a9f1`、buildId `3c8996c609214c44b56b313b307b71b2`，638 个生产路径及 782 个构建输入冻结匹配；93 个变更模块中 89 个 SourceMap 内容逐字匹配，其余四个纯类型/仅类型消费路径另归构建清单。`APK_SANITY` 通过，同签名覆盖安装，UID、首次安装时间、Gboard、三站已登录状态保持。有限 `LIVE_PASS`：五次冷启均有真实首批与完整 Feed 终态，额外录像可见先显示的帖子在全量返回后保持位置；实际下拉刷新、L 站切换和返回全部成功。部分结果 footer 与取消竞态由 UI/Unit 证明，不冒充完整设备注入回放；本轮没有新增 `DEVICE_REPLAY_PASS`。

`REG-NAV-010` 仍保持 OPEN：未证明所有冷启动波动消失，未覆盖物理设备、首次候选迁移、自然 CF、代理与多网络条件。后续 Android 专项与工具选择见[性能实施计划](performance/android-optimization-plan.md)。本轮不提交、不推送、不合并。
