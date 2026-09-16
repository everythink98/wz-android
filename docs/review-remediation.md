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
| NodeSeek | 既有 `/`、必要时 `/setting` 身份解析；数字 UID 的 `/api/account/getInfo/{uid}?readme=1`；username-only 先走已有 `/api/account/find/{username}` | `/api/content/list-discussions?uid=…&page=…`；`/api/content/list-comments?uid=…&page=…`；沿用 15 条和已知计数的分页语义。 | `detail.member_id/member_name`、`nPost/nComment`、`discussions`、`comments`；身份仅使用已有配置/明确自身链接。缺少实际列表字段抛错。`userParser.ts`、`sourceUserRead.test.ts`、`source-read-contracts/nodeseek.test.ts`。 |
| V2EX | 无登录身份能力；`/api/members/show.json?username=…` | `/member/{username}/topics`、`/replies`，只使用现有 HTML 下一页解析；主题首屏保留 `/feed/member/{username}.xml` fallback。HTML 与 feed 都失败则抛错。 | `id/username/name/avatar_*/tagline/pro` 与已有 HTML/ATOM parser；不把首屏已读数量当总计。`src/sources/v2ex/account.ts`、`sourceUserRead.test.ts`。 |
| 妖火 | 既有 session 检查的 `currentUser`；资料 `/bbs/userinfo.aspx?touserid=…&siteid=1000` | 首次活动链接从资料 HTML 的真实 href 提取；后续 cursor 继续使用已有安全 URL、next-page parser。主题首屏最多 10 页/30 条，后续每次一页，保留原顺序。 | `sessionParser.ts` 与 `protocol.ts` 的既有身份、昵称、统计、帖子/回复链接解析。未知且缺活动链接时报不支持；只有已知 0 或实际解析结果可显示空。后台直接消费已确认身份；Account 为展示名保留必要资料读取。 |

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

取得上述范围的 `DEVICE_REPLAY_PASS`（受控设备入口）。SQLite APK SHA-256：`19bd486bd32674fb379e3aeaf02944e32339e2f0155a863239f6900887f7088a`；41 项运行时 APK：`32ca3319ea9de5a9017023f4d0ad5c29fe7028456b09ef6b8a80a5dd548d8052`，独立 buildId `457da8d1964b400584436b45f58ae4f8`。完整 receipt 保存在本机 `.codex-tmp/device-fault-validation-20260916/`，不提交正文、日志或 APK。

### 补验发现与最小修复

第二轮运行时检查为 39/41：Feed 两个原生宿主断言失败。当前 RN `ScrollView.js` 在 Android 上将有 RefreshControl 的 ScrollView 包在刷新容器内，移除 RefreshControl 会改变层级；原修复仅保留 FlashList 组件，未保住底层原生视图。现在在既有 Feed owner 内保留 RNGH RefreshControl，冷筛选时只设 `enabled=false`。相同设备检查转为 41/41，相关 Feed/User 三个 UI owner 108 项通过（seed `1048951387`）。没有新增状态机或生产接口。

首轮试验还暴露两处测试接线错误：linux.do 脚本被测试重复注入、NodeSeek 下一页错用了 1 而非生产 cursor 2。按真实实现纠正后通过；这些不记录为产品缺陷。四站样本从既有 UI owner 原样提取为 `tests/fixtures/userActivityEvidence.ts`，该 UI owner 的 24 项独立回归通过（seed `-1583372232`）。新增 HookProbe / recovery probe 都是隔离测试的本地接口，不代表服务器协议。

runner 在主 AVD 上的负向检查明确拒绝，未安装或改权限；隔离设备通知权限在 finally 恢复，合成摘要被撤回，原通知存储键恢复。Feed 补修前的普通 APK 上，主设备历史列表离开底栏再返回，六个可见条目的文字及屏幕边界一致；进入已读 Topic 后可正常返回。历史会按访问时间重排，未据此声称具体条目锚点位置完全不变。

本轮最终 `npm run verify` 使用 Node `22.23.2` 完整退出 0：Vitest 207 文件、2539 项（seed `1789521187257`），UI 77 文件、1503 项（seed `44282459`）；静态、架构、文档、类型、未使用代码和版本门禁通过，取得 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`。这份脱敏修复记录加入文档跟踪白名单，防止其他文档的链接在新 checkout 中失效；本机 receipt、原始日志、截图与 APK 继续 ignored。

Feed 补修后的普通入口也使用 Node 22 构建成功，APK SHA-256 为 `4f5443c2c1c4251c312682aae00039c264203819ba64468962f98c8769a4f78a`，版本仍为 `1.3.144` / `148`，签名与原安装一致。仅覆盖安装主 AVD，`APK_SANITY` 及 `account-readonly.ad`、`feed-gesture-priority.ad`、`four-source-feed.ad` 三份匹配 APK 回放通过；主设备安装时间仍为 `2026-07-26 16:51:37`，最终账号中心显示网站登录 `3/3`。本轮任务创建的隔离模拟器、Gradle 和设备自动化会话均已结束，主模拟器及共享工具保留。没有发帖、编辑、上传、清用户数据、提交或发布。

## 后续验收归属

上方初轮表格中的设备故障缺口，已按本轮补验表缩小。仍为 `NOT_VERIFIED`：原站挑战经 TopicRoute / Account 完成并恢复详情的完整设备链；换号/停用与该完整链交叉；真实编辑/上传及一致重叠回复在写入 UI 的设备流程；Library 隐藏旧分页回调的设备注入、系统文件选择器导入/清空故障；真实后台调度器唤醒、OS 自然异常及物理手机差异。现有真实 Route/Screen 单测不替代这些设备结果，受控设备证据也不等于 `LIVE_PASS`。不通过清理用户登录态、远端写入或清空数据制造条件。

## 工作区与资源收口

保留原送审快照和原 15 个修改文件中的已有业务改动；身份测试中已失效的 `topics:[]` 随接口收窄删除。未提交、发布、上传或增加依赖。任务自建的独立测试 AVD 已关闭，设备自动化会话已关闭，Gradle 与回放子进程已结束；主设备和共享工具服务保留。

原生成目录已保留在本机 ignored 目录供追溯；当前 `android/` 来自 fresh prebuild。取证日志、原 APK、模板字节样本和 Node 22 验证运行时留在本机。自动审批以 `blocked by policy` 拒绝删除临时 Native 副本和三个 Gradle 探针文件，未提供更具体理由；这些临时文件保留在 ignored 目录，属于清理受阻，不属于代码或验收失败。
