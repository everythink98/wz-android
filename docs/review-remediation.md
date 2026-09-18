# 2026-09-16 代码审查修复取证记录

本文记录本次修复与验证，不替代产品地图、架构说明和维护手册。原始基线为 `c89787f13e2c0862179edbd1694b87c750a99dfd`，叠加开工时 15 个未提交文件；保留原修改，不提交、发布或上传。日志、原送审包和设备资料仅在本机 ignored 目录保存。

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
- 同一 APK 的 `tests/device/account-readonly.ad`、`tests/device/feed-gesture-priority.ad`、`tests/device/four-source-feed.ad`、`tests/device/library-return.ad`、`tests/device/notifications-readonly.ad` 五份回放全部通过，取得对应入口的 `DEVICE_REPLAY_PASS`。回放包含账号切换查看、Feed 手势和 Topic 返回、Library 集合/来源切换及通知只读操作；其中允许 error outcome 的断言仅证明页面能正确结算，不证明所有远端请求成功。
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

Feed 补修后的普通入口也使用 Node 22 构建成功，APK SHA-256 为 `4f5443c2c1c4251c312682aae00039c264203819ba64468962f98c8769a4f78a`，版本仍为 `1.3.144` / `148`，签名与原安装一致。仅覆盖安装主 AVD，`APK_SANITY` 及 `account-readonly.ad`、`feed-gesture-priority.ad`、`four-source-feed.ad` 三份匹配 APK 回放通过；主设备安装时间仍为 `2026-07-26 16:51:37`，最终账号中心显示网站登录 `3/3`。本轮任务创建的隔离模拟器、Gradle 和设备自动化会话均已结束，主模拟器及共享工具保留。没有发帖、编辑、上传、清用户数据、提交或发布。

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
