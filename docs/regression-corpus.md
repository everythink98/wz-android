# 回归语料库

本文记录已确认事故的历史症状、根因、当前状态、修复证据和验收边界。按 REG 编号或能力 ID 查找条目，先读状态与当前结论，再核对证据适用的源码、构建、设备和来源。历史通过结果不能直接作为当前版本的验证结论。

表中的「当前 owner」指承担行为验证的测试或实现模块；oracle 指判断行为是否符合预期的可观察结果或断言。测试归属与证据分层见[测试标准](testing-standard.md)，剩余工作见[技术债务与待验收项](code-cleanup-map.md)。REG 编号、状态和字段名供文档检查器使用，保持原有标识。

## `REG-FEED-039` 单站失败连带清空聚合首页的可信内容

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`，共享 `ACCOUNT-02` 的来源失效处理 |
| 历史症状与根因 | 2026-10-07 用户报告单站请求失败后其他站点也不显示。受控 HTTP 复现 NodeSeek 401 触发登录失效，账号事件同步取消聚合 Query，使已成功的 V2EX 首屏无法提交；已有可信列表在 scope 变化后仅依靠 `placeholderData` 保留，新 Query 进入 error 后占位消失，列表变成空数组。普通单站 500 的对照仍保留成功来源。此为已确认代码路径，未取得用户故障现场日志，不推断所有白屏均由此引起。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` 沿真实 Gateway、来源 adapter、Query 与 Controller 验证 401 → 会话切换 → 替代请求失败，并扩展既有 scope owner 覆盖成功、失败、连续身份变化与旧游标禁用。来源聚合及共享网关合同继续归 `src/sources/feedRead.test.ts`、`src/sources/readGateway.test.ts`、`src/sources/readGatewayContract.test.ts`。 |
| 修复与红绿证据 | seed `210607` 修前两项因可信列表丢失而失败。Gateway 在账号事件前允许 Feed 接收已完成首屏；Feed 保留按当前 scope 过滤的展示快照，重读失败不清空其他站点，成功结果继续替换快照。旧请求取消、身份隔离和 Query 分页所有权不放宽；网关合同另覆盖当前、取消和身份已变化的结果交接。定向 131 项 `UNIT_PASS`，随机 seed `1791343013114`；首页及共享入口 108 项 `UI_PASS`，随机 seed `1276127880`。类型、定向 lint、架构和文档检查为 `STATIC_PASS`。 |
| 设备证据与边界 | 隔离 `WZ_LoggedOut_API_35` 同签名覆盖安装当前源码的 Release/Hermes 故障入口，APK SHA-256 `f95cee4ec99410873c4346719e66b98f57fe9cb517bbe4c43784ea3d64284402`。实际生产 Gateway、Controller 与 FeedScreen 在 NodeSeek 401 → epoch 变化 → NodeSeek 503/V2EX 失败后，显示 `v2ex:720` 且 `busy=false / more=false`；点击恢复刷新后显示新 `v2ex:721` 并恢复分页，为该合成场景 `DEVICE_REPLAY_PASS`。首次安装时间保持 `2026-08-03 16:37:36`，没有执行真实写操作；本机证据位于 ignored `.codex-tmp/feed-fix-20261007/`。真实站点故障、物理设备及正式 APK 为 `NOT_VERIFIED`，不将隔离入口外推为完整 App 验收。 |
| 普通入口恢复 | 验收后重新构建并同签名覆盖普通入口 `1.3.152/156`，APK SHA-256 `381ae11270e890d307ed4a629cf35a4925c30d893a1565ad35cc35532ecb60e5`；combined source map 中两处运行时修复与工作区逐字一致，未包含故障入口。实际启动显示聚合列表，当前进程无 AndroidRuntime/ReactNativeJS error，为 `APK_SANITY`。首次安装时间不变，最后关闭本次启动的独立模拟器；未执行正式发布。 |

## `REG-NOTIFY-085` 妖火消息列表可读但详情正文无法打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`，共享 `NOTIFY-01` 的条目身份与 `TOPIC-03` 的回复链接 |
| 历史症状与根因 | 2026-10-06 用户报告此前修复的妖火列表可显示，但点进详情仍报「妖火消息对应的正文未找到」。主模拟器已读消息稳定复现；同一 App 原站会话 GET 为 200。当前详情已改为 `.msgview-page` 与 `.chat-list .chat-msg`，目标消息由页面 ID 和 `is-anchor` 的消息 ID 标识，旧「内容」字段已不存在。此前列表 Live 仅验收列表，没有打开详情。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` 维护当前协议的私信/系统正文、消息身份、相同正文的不同消息、日期排序、清洗和控件排除；`tests/ui/notifications/notifications-route.test.tsx` 通过真实 adapter 与受控 HTTP 响应验证正文链接进入 Topic 的楼层定位。旧协议行为沿用同一来源 owner。 |
| 修复与红绿证据 | 新增的 6 项最低 oracle 修前全部失败，修后来源 owner 28 项通过，seed 1791219000000。精确提取目标气泡；系统消息不因页面包含发送表单而变成私信，聊天按稳定 ID 排除目标并保留其他同文消息；日期按北京时间转换，历史提示改为当前原站返回范围。新版身份异常不会回退到旧内容或邻近气泡。 |
| 真实入口证据与边界 | 普通 Release APK SHA-256 `c1f5073dfa0668540dca0ba491319227e4510b056fe957dfcb7d67ccb158134c` 同签名覆盖安装主 `WZ_Pixel_API_35` 后，按 runbook 排空安装队列并无快照冷启动，`firstInstallTime=2026-07-26 16:51:37` 不变。实际点击 3 条已读系统消息与 1 条已读私信均进入有正文的详情，无正文错误或重试；带主题链接的系统消息及私信保留链接，系统没有输入入口，私信有输入入口，为 `LIVE_PASS`。相关 route/screen 177 项 `UI_PASS`，seed 210606；最终全量门禁 3403 项 `UNIT_PASS`（seed 1791217114845）、2382 项 `UI_PASS`（seed 1863645707），类型及静态检查为 `STATIC_PASS`，主模拟器消息中心只读 Replay 为 `DEVICE_REPLAY_PASS`。脱敏回执位于 ignored `.codex-tmp/yaohuo-message-detail-fix/live-main.json`。未执行私信发送、删除、上传或未读消息点击；更多历史和真实写入仍为 `NOT_VERIFIED`。 |

## `REG-WRITE-128` 妖火标题输入时正文工具按钮无响应

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`，共享 `WRITE-01` 的妖火工具切换 |
| 历史症状与根因 | 2026-10-05 主模拟器大字号验收时，标题拥有 Gboard 输入焦点，点击表情或文字格式没有响应。标题焦点触发的 `dismissPanels` 被工具按钮当作持续禁止打开，而不是收起旧工具的指令。移除此拦截后，标题仍保留原生焦点，再次点击标题会让键盘与表情面板同时出现；只等待键盘隐藏不足以释放标题输入。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 持有标题进入工具、再次编辑标题收起及草稿保留；异步关闭、只读、忙碌和 Modal 接管沿用 `tests/ui/topic/yaohuo-reply-composer.test.tsx` 与现有键盘 handoff owner。 |
| 修复与证据 | 移除持续拦截，复用宿主键盘交接并在隐藏完成后释放发起交接的标题焦点；正文发起的旧交接不会释放后来接管的标题。工具进入、元数据收起及晚到交接的负对照分别实际失败。相关两个 UI owner 110 项通过，seed 1462401415；最终标题五项行为复验通过，seed 1404170016。普通入口匹配 APK build ID `ce2cbac234f64ab1b30fd2066b6a2243` 在主 API 35、真实 Gboard 下完成标题→表情/格式→标题、正文返回、连续插入、面板滚动及浅色 100%／深色 130% 字号截图核对，为 `LIVE_PASS`；面板开启时 IME 隐藏，返回输入时面板收起，光标保留在插入后。 |
| 验收边界 | 标题与正文协议不变；不提交合成草稿。 |

## `REG-ACCOUNT-062` 关闭原站核对期间发帖规则误报页面未关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`，共享 `WRITE-01/04/07` 的 writable session seam |
| 历史症状与根因 | 2026-10-05 从 APP 原站关闭后，新帖显示「登录页面尚未完成，请关闭后重试」，重试规则仍失败。关闭后的自动核对仍执行，但内存认证屏障的 `reconciling` 阶段被 writable gate 当作仍打开的窗口；核对失败后屏障继续存在，无法通过发帖重试恢复。同一自动核对与显式请求共享结果时，第一个调用释放屏障还会让第二个调用误判 stale。 |
| 当前 owner | `tests/ui/account/account-runtime.test.tsx` 持有关闭后等待、失败重试、未知继续阻断和重新打开时丢弃旧结果；`src/domain/session/writableSessionGate.test.ts` 保留身份和 epoch 校验。 |
| 修复与证据 | 只在来源的窗口全部进入 `reconciling` 后等待现有核对，失败后由显式重试重新发起；打开中的窗口继续阻断，unknown 不清身份、不释放屏障。并发调用接受已由同一核对释放的屏障，替换 generation 仍失效。移除等待分支的负对照在 pending 与 failed 两种情况下均失败，Account runtime owner 55 项 `UI_PASS`。主 API 35 的最终普通入口 APK 经 APP 更多→妖火原站→关闭，立即可见自动「刷新中」，随后直接进入发帖规则正常加载，无需手动刷新账号或规则，为 `LIVE_PASS`。 |
| 验收边界 | 不更改 Cookie、不绕过核对，也不授权真实发帖或回复。 |

## `REG-WRITE-127` 妖火回复与发帖上传未使用原站默认入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04/07`，共享 `WRITE-01` 的妖火上传入口 |
| 历史症状与根因 | 2026-10-05 用户反馈回复和发帖图片上传失败。共享上传 helper 接入图床导航中的可选大厂图床，未使用正文旁默认上传图标。经 APP 更多进入原站，实际默认脚本 ImgBed-SHA.js 使用 `aapi.helioho.st/upload.php` 的 multipart `image`，返回 `{code:200,data:{url:URL}}`；当前原站上传后需要再点击图标插入正文。首次原生接入仍返回 403，原因是未携带浏览器自动发送的妖火 Origin；只读 GET 无 Origin／仅 Referer 为 403，带 Origin 则通过来源检查并返回方法不支持的 405。 |
| 当前 owner | `tests/integration/image-upload.test.ts` 固定默认入口、文件大小、单次 multipart、响应确认、拒绝不重传及无效文件拦截；`src/features/topic-composer/topicCreationActions.test.ts` 固定新帖共用上传与 UBB；`tests/ui/topic/topic-actions-controller.test.tsx` 保持代理就绪后身份复核及图床失败不退出妖火会话。 |
| 修复与证据 | 共用原站默认通道及 Origin 并自动插入 UBB，缺少选择器元数据时读取本地大小。默认入口协议 oracle 修前 4 项失败，Origin oracle 修前 2 项失败，修后相关 69 项 `UNIT_PASS`。授权的原站合成 PNG 单次上传返回 HTTP 200 与嵌套图片地址，再点插入成功。最终普通入口 APK 在主 API 35 的原生发帖与回复入口分别从系统选择器上传同一合成 PNG，均成功自动插入 `[img]` 链接；新帖记录显示已上传，忙碌结束后工具恢复。两处为 `LIVE_PASS`，测试正文与新帖上传记录已逐项移出，未发送或发布。表情选择器实际显示 GIF、连续选择保持面板，回复仍使用独立表情字段，新帖仍插入 UBB；移除预览和光标恢复的负对照实际失败。最终模拟器 APK 同签名覆盖安装与冷启动为 `APK_SANITY`，首次安装时间保持 `2026-07-26 16:51:37`。 |
| 验收边界 | 用户持续授权合成纯色 PNG 上传验证，只核对上传与插入；不发送回复或发布帖子。同份源码的签名 ARM64 测试 APK 通过生产签名、ABI、16 KiB 对齐、Hermes 包内代码、source map 与 SHA-256 核验，为 `STATIC_PASS`；物理设备与真实发布仍为 `NOT_VERIFIED`。 |

## `REG-WRITE-126` 表情固定分类栏漏图且半屏只剩一排图片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/07`、`NOTIFY-02` 的 StructuredReplyComposer 共享 seam |
| 历史症状与根因 | 2026-10-05 用户在主模拟器指出吸附效果与半屏空间不合理。截图显示图片从滚动区顶部 padding 穿到分类栏上方；半屏正文空区与工具、发送栏继续占高，表情 body 仅 107.5 CSS px，分类又占 50 px。此前仅核对分类顶部坐标，缺少完整画面与可选行数 oracle，因此没有发现该逃逸。全屏把空余编辑区全部铺为图片也没有必要。模式切换时先聚焦被隐藏的正文，真实 IME 已出现而面板仍保留。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 合并固定分类、回顶、缓存、加载反馈与聚焦交接，相应布局、模式切换及初始 busy oracle 修前失败。`tests/ui/topic/structured-reply-composer.test.tsx` 独立证明 Native 控件收起与恢复且不强制全屏、不重建文档。`scripts/composer-expression-geometry.mjs` 以真实 DOM 尺寸、hit test、未加载图片的可见占位和 Native IME 边界检查可选完整行、漏图、固定栏、正文预览和遮挡，`scripts/run-composer-device-proof.mjs` 持有设备矩阵与截图。 |
| 修复与证据 | 分类/搜索移出图片 scroller 并与关闭按钮共用 header；短窗口让选择器占用正文区域，长窗口限高并保留上方正文，模式切换先关闭面板。初版选择后恢复正文焦点；后续按用户要求改为连续插入，保留面板与现有焦点，显式关闭后才结束选择。初次加载与重试有固定尺寸占位，保留既有懒加载、缓存及失败退避。初版 Runtime/Bridge/tooling 177 项 `UNIT_PASS`，宿主/键盘及提交/私信 route 278 项 `UI_PASS`，typecheck、lint、格式、625 模块架构检查与文档门禁为 `STATIC_PASS`。 |
| L 站样式与连续选择验收 | 2026-10-05 真机截图反馈后，L 站改为 32 px 纯图标、至少 48 px 触控格子，移除截断的英文标题；搜索栏沿主题使用浅底、单层焦点边框，失败重试保持格子高度。连续插入 oracle 修前 4 项失败，修后两站 × 两种编辑模式 × 回复/发帖/私信意图保留面板、查询、滚动、焦点并正确序列化；相关 Runtime/Bridge/tooling 181 项 `UNIT_PASS`，宿主与键盘 111 项 `UI_PASS`。普通入口匹配 APK build ID `8d76224b008246dcb55464982bf867ed` 覆盖安装通过 `APK_SANITY`、首次安装时间不变；主 API 35 的 L 回复富文本/源码 × 半屏/全屏 × 真实搜索 IME 开关、深色 130% 字号下两种模式搜索、连续点选、滚动固定栏和关闭重开均为只读 `LIVE_PASS`，截图人工检查，显示设置与空草稿已恢复。发帖入口规则读取转到 CDK 登录页，取消后表情目录仍在读取，只核对面板边界，完整发帖表情链路为 `BLOCKED_BY_ENV`；真实私信入口、物理设备、真实发布/发送与未运行的隔离组合为 `NOT_VERIFIED`。 |
| 设备范围与限制 | 普通入口 APK 在主 API 35 验收两站回复的富文本/源码、半屏/全屏、分类滚动与回顶、关闭重开、模式交接；半屏有 3～4 排完整可选图片，长窗口保留正文，L 搜索的真实 Gboard 上方仍有多排完整图片。NS 短窗口和 L 发帖搜索也分别实查，显示设置已恢复。最终 APK SHA-256 `43c0b8b97191123eb36977bcf8f5f3216afae4d4681e69ffe9cdbd960e5ebe1d` 同签名覆盖安装，首次安装时间不变；最终包又复验两站半屏/全屏、NS 选择后键盘恢复及 L 半屏/全屏搜索；主设备 App 内深色、130% 字号下，两站富文本/源码 × 半屏/全屏和 L 搜索分别通过，已恢复浅色、100% 字号及原编辑模式。受控延迟下占位实际可见，恢复网络后同分类 49 张 Fluent 加载完成，无需切 Tab，诊断设置已撤销。截图人工核对；部分早期 AX 读取失败的步骤仅记 DOM 与人工图像证据，未冒充 Native bounds 自动通过。上述只读范围为 `LIVE_PASS`。按用户要求关闭全部模拟器后只重开主设备；隔离矩阵中止，未报告完整 `DEVICE_REPLAY_PASS`。真实私信入口、真实发布/发送、物理设备及未运行的隔离组合仍为 `NOT_VERIFIED`；自然发生的间歇空白根因边界沿用 `REG-WRITE-125`。 |

## `REG-NOTIFY-084` 妖火新版信箱无法解析

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03`，共享 `NOTIFY-02` 的已读核对 |
| 历史症状与根因 | 2026-10-04 用户报告消息页顶部报错。主登录模拟器实际显示「妖火消息列表格式不正确」；同一 App 原站 WebView 的信箱可读。原站收件箱已改为 `.msglist-rows .msglist-row`，旧 parser 仅寻找 `.listmms`，因此把有效消息页当作异常。未读改由 `is-unread` 表示，时间在 `.msglist-time[title]`，发送者与 UID 是独立字段。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` 从当前原站结构建立脱敏 fixture，普通/仅未读两项修前均报同一格式错误，修后通过；相对时间、身份、分页、部分损坏、后台扫描预算与已读核对沿用同一 owner。后台组合输入同步到 `tests/ui/notifications/notifications-performance-stress.test.tsx`，不保留旧收件箱解析分支。 |
| 修复与证据 | 新版字段直接映射现有通知模型，保留解析质量、来源隔离和原页核对；消息来源与 gateway 73 项 `UNIT_PASS`，相关 UI 296 项 `UI_PASS`，typecheck 为 `STATIC_PASS`。正常入口开发签名 APK 覆盖安装后，主 API 35 的真实收件箱 4 条、系统 3 条、聊天 1 条及仅未读空态均无格式错误，为 `LIVE_PASS`。未执行真实已读或回复写入，实际写后核对仍为 `NOT_VERIFIED`。 |

## `REG-WRITE-124` 回复表情面板与键盘同时挤占正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05`、`NOTIFY-02`，共享 `WRITE-02/07` 的编辑器 |
| 历史症状与根因 | 2026-10-04 用户报告选表情后点正文弹起输入法，操作区域被压得很小。正文 focusin 只为主题编辑器关闭工具面板，回复与私信没有该交接，导致表情面板保留并继续占据高度。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 使用真实 runtime DOM 验证 NodeSeek/linux.do × 富文本/源码 × 回复/私信的正文聚焦、面板关闭和图片/滚动缓存保留，四项参数用例修前均失败。同一 owner 覆盖 NodeSeek 回复、私信与主题的分类吸附、切换回顶、重复点击保位及成功图片复用；切换回顶的三项 oracle 修前均失败。 |
| 修复与证据 | 把正文聚焦交接扩展到回复/私信的表情面板，继续沿用主题编辑器的既有行为；只关闭对应工具层，不重建表情目录或改稿。切换到其他分类显式回顶。编辑器 149 项 `UNIT_PASS`，相关 UI 296 项 `UI_PASS`，typecheck 为 `STATIC_PASS`。主 API 35 匹配 APK 中，NodeSeek 普通回复富文本/源码点正文均关闭表情并显示真实 IME；滚动、回顶与成功图片节点复用得到验证。原「吸附」证据仅核对顶部坐标，未证明遮挡或选择空间，其逃逸及更强 owner 见 `REG-WRITE-126`；旧结果不外推 linux.do、私信真实入口或物理设备。 |

## `REG-WRITE-125` 新编辑器绕过表情图片资源缓存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/07`、`NOTIFY-02` 的 StructuredReplyComposer 共享 seam |
| 历史症状与根因 | 2026-10-04 用户要求核对表情图片缓存。当前 runtime 已保留同一面板的成功图片节点，但宿主 WebView 显式传入 cacheEnabled=false；本机 react-native-webview Android 实现将其映射到 LOAD_NO_CACHE，新建编辑器绕过已存储资源。同一面板复用不能证明 HTTP 缓存生效，也不能据此认定用户最初必须切 Tab 的间歇空白已复现。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` 沿用既有共享登录态保护 owner，核对启用资源缓存且不使用 incognito；修前期望 true 实得 false，seed 1134769099。runtime 的懒加载、失败退避、取消等待、旧回调和成功节点复用由 `src/ui/composer/editorRuntime.test.ts` 持有。 |
| 修复与证据 | 显式启用默认 WebView HTTP 资源缓存，遵循原站缓存响应头；保持内联文档和 bridge 的生命周期。宿主 64 项 `UI_PASS`，runtime 149 项 `UNIT_PASS`，typecheck、定向 lint/格式及架构检查为 `STATIC_PASS`。正常入口开发签名 APK 在两个不同 NodeSeek 主题新建的编辑器中，各 149 张 AC 娘加载成功、148 张被 CDP 标记为 fromDiskCache，未打开分类仍有 0 个 img[src]。同包首次贴纸请求被阻断后显示失败，恢复请求后在原分类自动显示成功，其他 148 张命中磁盘缓存。覆盖安装及保留数据冷重启后的 firstInstallTime 与 3/3 登录态不变；受控故障注入已撤销。自然发生的首次空白仍未复现，保留 `NOT_VERIFIED`，不把缓存修正等同于原间歇故障的根因。 |

## `REG-TOPIC-186` 旧图片下拉关闭回调误关重新打开的预览

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`，共享 `TOPIC-01/03`、`NOTIFY-02` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：下拉关闭已排队到 RN，用户先用 Back 关闭旧预览并重新打开图片，旧回调随后直接调用共享 onClose，把新预览关闭。回调未核对原内容实例是否仍挂载。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` 延迟实际手势的 scheduleOnRN 回执，通过关闭和重开按钮复现，缺陷用例先红后绿；新预览连续两次下拉只排队一次关闭。与 `tests/ui/topic/topic-image-loading.test.tsx` 合计 185 项通过，seed `20261004`。 |
| 修复与边界 | `ImagePreviewModal` 复用已有 mountedRef，由同一 closePreview 收口下拉、系统返回及关闭按钮，拒绝旧实例回执。竞态为 `UI_PASS`；匹配源码 APK 上放大平移、短下拉取消、长下拉关闭、Back 后打开另一图及按钮关闭为 `LIVE_PASS`，退出前后正文截图 hash 相同。原生跨线程竞态发生频率未验证，未执行保存。 |

## `REG-NOTIFY-083` 返回消息页后重试被旧账号核对忙态拦截

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：普通重试等待账号核对时离开消息页，返回后再次点击可见重试，核对入口预期 2 次、实际仅 1 次。生命周期清理取消恢复意图，却留下独立 recoveryBusyRef，直到旧 Promise 结束才允许新点击。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 经真实 Navigation、Query 与 gateway 验证失焦返回后接管，共享同一个账号核对 Promise，并验证旧核对结束、新读取仍在途时连续点击不重复发起；新增用例先红后绿。四个通知 UI owners 共 237 项通过，seed `410031`。 |
| 修复与边界 | controller 与 pending 归同一恢复请求记录，取消后可立即重试，finally 只处理所属记录；保留验证页面返回后的恢复回调及离页失效，不取消共享账号核对。竞态证据为 `UI_PASS`；匹配源码 APK 上聚合列表、下拉后页签往返可继续读取和操作。真实错误恢复及写入未验证，不以普通成功列表替代该证据。 |

## `REG-WRITE-123` 源码编辑器没有可访问名称

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/05/07`，共享 `NOTIFY-02` |
| 历史症状与根因 | 2026-10-03 旧 APK 的 NodeSeek 空发帖切到源码后，原生无障碍树中输入区可聚焦、可编辑，却没有 label。CodeMirror 未设置 contentAttributes 名称；同实例切换新文档且 Markdown 同为空时，也没有内容更新来刷新用途名称。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 使用真实 CodeMirror contentDOM，覆盖 linux.do、NodeSeek 的新帖、主帖编辑、回复与私信，以及模式切换和新空文档初始化。8 项名称 oracle 修前均得到 null，修后通过；完整 owner 132 项通过，seed `20261004`。 |
| 修复与边界 | `src/ui/composer/editorRuntime.tsx` 按当前用途提供「主题正文源码编辑器」或「回复正文源码编辑器」，初始化新文档时刷新属性，保留输入实例、多行编辑及隐藏模式边界。`UNIT_PASS`；匹配源码 APK 的 NodeSeek 新帖经实际模式切换，运行中 WebView DOM 和 Chromium AX 均确认该名称、textbox、多行、可编辑及焦点，隐藏富文本不暴露。agent-device 0.20.6 未采集原生 hintText，其 snapshot 仍仅显示换行值，不能据此判断名称缺失。该引擎范围为 `LIVE_PASS`；原生 hintText 和 TalkBack 朗读未验证，未发送正文。 |

## `REG-NAV-009` 返回主题时自动重现离页前的临时菜单

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-03`，共享 `TOPIC-01/03` |
| 历史症状与根因 | 2026-10-03 旧 APK 打开主题更多菜单后通过 warm deep link 进入另一主题，新主题正常且无遮挡，Back 返回原主题却自动重现旧菜单。TopicScreen 和 TopicContentList 保留临时菜单开关，路由失活时未清除；回复排序菜单存在同一缺口。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` 挂载真实菜单，验证更多/回复排序在 active false→true 后保持关闭，作者筛选、倒序和滚动调用数不变，手动重开正常。seed `310037` 两例先红后绿；四个相关 UI owners 229 项通过，seed `650318754`；最终 canonical owner 154 项通过，seed `2112655349`。 |
| 修复与边界 | 两个菜单以 active 控制显示并在失活时清除临时开关，后台同样关闭；不重置回复顺序、筛选与阅读位置。`UI_PASS`；匹配源码 APK 上更多菜单与回复排序菜单分别经过 warm deep link → 另一主题 → Back，返回后均保持关闭。回复排序另经 Home → 前台复验，倒序、只看楼主和当前回复位置保留，手动重开正常；此原生范围为 `LIVE_PASS`。 |

## `REG-SEARCH-037` 收起数字键盘后高级筛选跳回顶部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03` |
| 历史症状与根因 | 2026-10-03 在真实 Gboard 下两次复现：linux.do 筛选滚到帖子数输入框，系统 Back 收键盘后回到排序区域。Android KAV 为清除残余补偿重建子树，Sheet 保留展开与草稿，却未保留原生 ScrollView 偏移。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 沿用展开/草稿 owner，真实 keyboardDidHide 后原生起始偏移期望 640、旧实现为 0，seed `20261003` 先红后绿；包含连续两轮、普通输入不控制滚动和取消重开归零。 |
| 修复与边界 | Sheet 记录偏移，局部滚动容器仅在每次挂载时提供该起始值；保留既有 KAV 清补偿逻辑。`UI_PASS`；匹配源码 APK 上真实 Gboard 连续两轮开合保留字段位置与草稿，取消重开回顶部；四个过渡窗口的 169 个编码帧未见回顶再拉回，不推断未编码合成帧。 |

## `REG-SEARCH-038` 候选数量变化让搜索输入框上下跳动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03` |
| 历史症状与根因 | 2026-10-03 真实标签搜索中，多条结果 → 空态 → 5 条结果让输入框随面板高度大幅下移再上移。底部面板按内容自适应，候选 ScrollView 只有 maxHeight，加载、空态与结果高度直接影响输入入口位置。作者候选共用相同结构。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 的标签/作者参数化用例固定稳定理想高度、可收缩、输入实例与操作可用，覆盖加载、空态/失败及少量结果；seed `20261003` 两例先红后绿。 |
| 修复与边界 | 标签与作者候选保留相同理想高度并允许 flexShrink，键盘可压缩列表，分类与主筛选保持原高度策略。`UI_PASS`；匹配源码 APK 上真实来源标签三态、作者两态的输入框 rect 均为 `(42,465,996,111)`，标签完成按钮位置不变且键盘打开时一次点击可关闭候选。此设备为 1080×2400，不推断其他尺寸。 |

## `REG-MORE-010` 外观收起提前卸载正文打断高度过渡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-03`，共享 `ExpandableContent` |
| 历史症状与根因 | 2026-10-03 原生录像中，展开渐进，而收起时设置整块消失、留一帧空白，下一编码帧「关于」直接跳上。AppearancePanel 在外层开始收起时卸载设置，把用于动画的完整测量高度提前缩为 padding。录像为可变帧率，不将编码帧等同所有合成帧。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` 从 MoreScreen 真实开关验证完整测量内容、无障碍隐藏及禁用命中、未提交字号预览丢弃、已提交设置保留；seed `310035` 先红后绿。后续沿同一 owner 补充开合保留原生 Slider 实例、隐藏期间拒绝迟到事件，seed `310036` 先红后绿。相关四个 UI owners 共 52 项通过，随机 seed `1560891448`。 |
| 修复与边界 | 外层测量、动画和内部原生控件实例保持；展开态变化显式重置未提交字号预览，隐藏时拒绝滑块修改与提交，避免重建控件首帧绘制不全。`UI_PASS`，`more-readonly.ad` 为 `DEVICE_REPLAY_PASS`；匹配源码 APK 的首次展开、两次收起共 58 个编码帧中 About 连续移动，未再录到滑块错位或半绘，不推断未编码合成帧或其他设备。 |

## `REG-NAV-008` 回收主题卡片的首次点击被旧主题门禁拦截

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02/03`，共享 `FEED-03`、`SEARCH-02`、`LIBRARY-01/03`、`USER-01` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：点击主题后，列表在 500 ms 内将同一 TopicCard 实例绑定到另一个主题，新主题首击被旧时间戳拦截。原门禁只记录实例的最近点击时间，未记录来源与主题 ID。 |
| 当前 owner | `tests/ui/shared/topic-card.test.tsx` 固定同实例换 ID、换来源后的首击，以及同主题等价 payload 仍受门禁限制；seed `310031` 两个缺陷用例先红后绿，三项相关用例通过。 |
| 修复与边界 | 门禁同时比较 `topicKey` 与时间，保持原 500 ms 窗口；新主题立即可打开，同主题连点仍只打开一次。证据为 `UI_PASS`，沿用共享卡片 owner。 |

## `REG-NOTIFY-081` 新页显示前旧触底回调提前读取下一页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：第二页已写入 Query 缓存，但列表尚未提交新数据，旧触底回调看到请求已结束，继续读取第三页。单站与聚合入口都只检查请求方向，未确认新页已显示。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 经真实 Query、gateway 与 adapter 固定缓存先结算、列表后提交的时序；单站与聚合两例先红后绿，并验证第二页提交后的真实触底正常读取第三页。seed `310031`，通知四个 UI owners 共 236 项通过。 |
| 修复与边界 | 只有当前缓存与列表已显示的 Query snapshot 一致才接受续页；保留分页接替后台刷新、手动刷新优先和失败重试语义，不增加时间延迟。证据为 `UI_PASS`。 |

## `REG-NOTIFY-082` 私信历史提交前连续点击重读同一游标

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：加载更早消息的 Promise 已成功，但 `messageHistory` 尚未提交，finally 提前释放忙态，第二次点击再次请求同一 cursor。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 使用 Discourse HTTP fixture 与连续真实 press，固定成功未提交时不重读、提交后读取下一 cursor，以及取消后旧结果不能释放替代请求；缺陷用例先红后绿。seed `310031`，通知四个 UI owners 共 236 项通过。 |
| 修复与边界 | 成功请求保留身份与 cursor，直到对应已消费 cursor 随历史提交后释放；失败和取消可立即重试，旧 finally 只能处理自己的请求。沿用现有会话与生命周期取消，不改变历史分页范围。证据为 `UI_PASS`。 |

## `REG-SEARCH-036` 关闭默认标签候选未取消在途读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：打开默认空查询的标签候选后关闭 picker，query key 保持不变，只有 enabled 变为 false，旧请求未取消；重开时复用仍在途的旧读取，未发出新的候选请求。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 固定空查询与非空查询的关闭、取消、重开及迟到结果，另验证当前搜索页失活不取消其他来源的候选读取；seed `310031` 空查询用例先红后绿，三项相关用例通过。 |
| 修复与边界 | picker 记录自身激活的候选 query key，仅取消刚失活的 exact key；保留其他来源和其他 scope 的在途候选，重开沿新请求更新。证据为 `UI_PASS`。 |

## `REG-MORE-009` 代理弹层重开后旧异步回执污染新会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 2026-10-03 连续操作审计复现：代理保存尚未完成时路由失焦关闭弹层，重开并编辑新草稿后，旧 success 关闭新草稿、旧 error 弹出错误，旧 finally 还能解除新保存的忙态。原回执没有打开会话与请求身份。 |
| 当前 owner | `tests/ui/more/network-proxy-modal.test.tsx` 固定旧保存成功、失败以及新旧保存交错，seed `310031` 三例先红后绿；完整 owner 13 项通过，随机 seed `621762564`。 |
| 修复与边界 | 每次打开与每个异步操作持有独立身份，只有当前请求可更新 UI；忙态拒绝的操作不显示虚假进度。只隔离回执，不取消用户已经授权的底层保存、代理切换或连通性测试。证据为 `UI_PASS`。 |

## `REG-FEED-038` 快速反向滚动后悬浮操作保持旧显隐

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`WRITE-07`，共享 `TOPIC-03`、`WRITE-01` |
| 历史症状与根因 | 2026-10-03 交互审计复现：同一次 React 提交前下滑再上滑，或上滑再下滑，共享显隐 hook 用旧闭包的 visible 决定是否更新，吞掉最后一次方向变化，必须再滑一次才恢复。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 的连续反向滚动 oracle 两例先红后绿，seed `1729098043`；完整 Feed 与 Topic reply-filters owners 共 195 项通过，随机 seed `-656403955`。 |
| 修复与边界 | 每次跨过原方向阈值都提交最终显隐，由 React 合并相同值，保留阈值、动画与边界回弹规则。证据为 `UI_PASS`，不证明原生帧时或物理触感。 |

## `REG-SEARCH-034` 重复点击当前来源清除分页反馈并滚回顶部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02` |
| 历史症状与根因 | 2026-10-03 交互审计复现：已加载第二页后点击当前来源，Screen 未判断来源是否变化，直接清除分页完成提示并发出滚顶与切站命令。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 在既有自动分页用例中验证提示保留、零滚顶与零切站，seed `548309` 先红后绿；与搜索筛选、共享 Modal 的完整回归共 56 项通过，随机 seed `-1660892964`。 |
| 修复与边界 | 当前来源点击直接返回，真正切站、提交搜索与确认筛选保持原行为。证据为 `UI_PASS`；本轮模拟器存在安装元数据但 `pm path` 为空，已停止安装，设备滚动验收为 `BLOCKED_BY_ENV`。 |

## `REG-SEARCH-035` 收键盘导致高级筛选意外折叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03` |
| 历史症状与根因 | 2026-10-03 交互审计复现：Android keyboardDidHide 为释放旧避让几何而重建 Modal 内部容器，SearchFilterForm 本地持有的 V2EX/linux.do 更多筛选展开态随之丢失，刚输入的字段突然隐藏。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 经真实页面与 Keyboard 事件，验证两站连续两轮收键盘后展开态与输入保留；两例先红后绿，seed `31003`。搜索与共享 Modal owners 共 56 项通过，随机 seed `-1660892964`。 |
| 修复与边界 | 展开态归 Sheet 持有，Form 受控展示；保留既有 KAV 重建与取消、重开、重置事务。证据为 `UI_PASS`；首轮隔离设备安装身份异常后停止变更，该设备仍为 `BLOCKED_BY_ENV`。 |
| 后续设备证据 | 2026-10-03 主登录态 `WZ_Pixel_API_35` 的旧包实际复现 V2EX 收键盘后折叠；当前源码 Release 测试包覆盖安装后，版本 `1.3.150/154`、签名和首次安装时间保持，APK SHA-256 为 `0a5f9885a41185b3bbc87f1c07dcc72bbec3e68e28ca628a27c63dcfd859e6fa`。`tests/device/search-multi-source.ad` 两轮输入、dismiss、草稿保留与取消取得 `DEVICE_REPLAY_PASS`；另用真实 Gboard 与系统 Back 连续两轮确认展开态和输入保留。Replay 的 headless IME 与真实键盘证据分别保存；linux.do 原生键盘、逐帧动画几何及物理设备仍为 `NOT_VERIFIED`，未执行远端写入。 |

## `REG-PERF-032` 无监听 SVG 布局事件重复应用原生动画属性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`NAV-01`，共享 Reanimated 事件分发 |
| 历史症状与根因 | 2026-10-03 原生取证确认 NodesManager 的 UI 线程事件分支没有检查监听者，每个 topSvgLayout 都触发 draw-pass nonLayout flush。三次新进程 Search 首次挂载各 146 个无监听布局事件，让同一个仍存在的原生视图被同步应用属性 146 次；不是失效 tag 异常，也不是 React 同一图标重复提交。 |
| 当前 owner | `patches/react-native-reanimated+4.5.1.patch` 在 UI 事件入口跳过无监听事件，C++ handler 查询同时覆盖指定 tag 与无 tag 全局监听，并沿用 registry mutex。DrawPassDetector 的初始化与 decor 迁移保持在过滤前，避免无先前 RAF 时错过首个 draw；实际 NodesManager JVM oracle 对此先红后绿。`tests/tooling/patch-artifacts.test.ts` 承接真实补丁可逆应用，`dev/reanimated-events-proof/index.tsx` 承接实际 Native scroll、动态全局 handler 与 RAF 行为；操作入口在 `docs/operator-runbook.md`。 |
| 修复与证据 | 修后私有计数包三次新进程仍各收到 146 个 SVG 事件，但 nonLayout、sync batch、registry visit 和 native apply 均为 0。真实 Release/Hermes 专项完成 10 个 Native RAF，tagged scroll 持续响应；全局 SVG hook 注册后计数 0→12、注销再挂载保持 12、再注册增至 24、再次注销后保持 24。诊断计数完全撤回，正式补丁不携带探针。 |
| 边界 | 仅关闭确定的重复同步工作；取证时仍有原生创建、GPU 与系统调度慢帧，计数包且存在并行工作负载，不能把本条当作 `REG-PERF-029` 的冷首挂载性能通过，也不承诺所有物理设备无卡顿。 |

## `REG-FEED-037` 首页快速失败或取消后无法继续同页分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`，共享 `NAV-01` |
| 历史症状与根因 | 2026-10-03 从搜索同类问题展开审核，真实 Controller/Query 与延后通知复现：第二页快速失败未提交 loadingMore=true，Screen 的页锁不会释放，点击重试仍停在 [1,2]；取消还会保留旧滚动距离门槛，列表底部即使重新拖动也可能无法再跨过 80 px。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 使用真实 Controller/Query 验证快速失败后同页重试、取消后原底部位置新拖动恢复、成功先于 props 时旧动作不越页、旧来源请求结算不释放新来源锁；Feed screen、controller session 与内容源导航三个既有 owners 共 99 项通过（seed 1501544229）。 |
| 修复与边界 | Route 保留 Promise，Screen 仅释放该次请求的锁，失败暂停自动连续请求直到新手势；新拖动清除旧距离门槛。Controller 读取当前 Query 状态及真实 page/cursor，拒绝在途或已过期的页动作；未假定后端 cursor 必须等于 page+1。2026-10-03 API 35 Release/Hermes proof `ed719688…` 经真实 FeedRoute/FlashList/gateway/parser，仅在 fetcher 注入故障：快速失败及 Native 导航取消后都得到 [1,2,2]、10→15 条唯一主题；取消发生于请求开始后 2.210 秒、abort=1，排除 5 秒聚合预算超时。设备采用只启用 NS 的「全部」列表，单站页故障及物理设备仍未验证。 |

## `REG-NOTIFY-080` 普通消息图片被尺寸探测失败误判为空框

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`，共享 `TOPIC-02` 图片预览 |
| 历史症状与根因 | 2026-10-03 主 API 35 模拟器的纯本地消息样本中，普通 PNG 在气泡中显示 alt 空框，贴纸与全屏预览能显示同一图像。独立诊断以完全相同的 data URI 对照确认：`Image.getSize` 和 `getSizeWithHeaders` 返回 `Unsupported uri scheme for encoded image fetch`，直接 RN Image 却成功绘制 960×640 位图。RenderHTML 的默认图片状态把独立尺寸探测的失败直接当成显示失败，即使 HTML 已声明尺寸、实际图片组件能够解码。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` 以尺寸查询拒绝但实际图片可以加载的场景先红后绿，承接真实 RenderHTML 与消息图片组件接线、小图声明尺寸、横竖比例、真实加载失败及预览期间旧 RAF 隔离。消息页面与共享预览两个 owners 共 110 项通过，seed `-2121177872`。 |
| 修复与边界 | 普通消息图片复用 ExpoImage 的实际 onLoad 尺寸与现有媒体尺寸缓存，保留请求身份与 referrer、声明尺寸、气泡宽度限制和真实失败提示，不再以独立尺寸查询决定能否显示。主 API 35 的 fixture-v4 合成样本匹配当次 Screen，已实际显示横图与竖图，原空框消失；三图切换、缩放、预览返回锚点 523→523、联系人导航和历史 prepend 锚点 680→680 均通过。此为本地样本 DEVICE_FIXTURE_PASS，同一生成位图的诊断与修复截图分别保留。设备证据只证明上述内嵌 PNG 与当前 Android 运行时的差异，不推断所有 HTTP 图片都曾失败，也不把全屏预览成功代替气泡内显示验收。 |

## `REG-NOTIFY-079` 长私信首读游标不一致且串行读取全部历史

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 2026-10-03 请求链复审通过受控 HTTP 确认：linux.do 话题首批返回 20 个帖子时，移除首帖后产生 nextPage=2、offset=19，而通用回复读取按每页 30 条校验，导致会话详情报游标与页码不一致。即使首批恰好匹配页界，详情仍沿回复游标串行抓取全部历史后才显示，任一后续失败都会使已有首批无法呈现，请求数随会话长度增长。未将合成响应认定为用户原站当次响应。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` 先建立修前失败的长会话 HTTP oracle；修后 1001 条会话只显示最新 30 条、最多两次内容 GET，稳定 post ID 锚点在新消息追加后仍读取正确的前一批。`src/sources/notificationGateway.test.ts` 承接读取间取消、身份失效与诊断隐私；`tests/ui/notifications/notifications-route.test.tsx` 承接显式加载、失败保留、刷新权威尾段替换、未知边界重建提示和缺锚恢复。 |
| 修复与边界 | 初次读取和每次「加载更早消息」各消费至多 30 个 stream ID，仅补取本批缺失帖子；不依赖通用回复页码，也不遍历整段会话。空或不完整 stream、已删除的锚点和不完整帖子响应明确失败，可重试或重新读取会话；原站明确删除的帖子不显示，但继续按 stream 推进。NodeSeek 与妖火保持各自已证实的会话范围，不伪造分页能力。相关 source/gateway 六个 owners 共 122 项通过，seed `1032026`；这属于受控请求 `UNIT_PASS`，不代表真实长私信 `LIVE_PASS`。 |
| 独立布局证据 | Native prepend 合成会话样本插入更早消息前后，同一条 `031` 消息的 y 坐标均为 680，差为 0；该证据只验证已测原生布局保持位置，不证明原站历史请求、所有消息高度或最终新包已验收。 |

## `REG-NOTIFY-078` 消息列表重复触底取消并重发在途分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | 2026-10-03 复查分页并发时，真实 Query/gateway 证明聚合与单站列表在 fetchingMore 尚未提交前收到两次触底，会按默认 cancelRefetch=true 取消在途请求，再请求相同 cursor；修前两项请求序列均为 [undefined,next,next]。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 通过真实 Route、Query、gateway 和可控 adapter 检查实际 cursor、AbortSignal 与最终去重列表；修后重复分页序列均为 [undefined,next]，在途 signal 未取消。新增普通刷新冲突的单站/聚合两项先红后绿：分页取消旧刷新、next 只请求一次、旧刷新晚返回不覆盖新页；完整 owner 76 项通过（seed -1404062621）。 |
| 修复与边界 | 自动补齐空分类页与可见列表触底共享实时 Query 请求方向判定：在途 forward 分页直接跳过重复 fetchNextPage 调用，普通后台刷新仍允许被分页接替；显式下拉刷新持有独立 request guard，分页不能取消它。复审实际 InfiniteQueryObserver 与 FlashList useBoundDetection 证明，无条件 false 会把刷新期间唯一一次触底合并掉；刷新若返回相同数据，列表的触底标记不会重置，原底部继续下拉不能加载更多。未改来源级恢复、轮询、已读或写操作；确定的重复回调时序由 UI oracle 承接，不把它当作所有原站时序均已验证。 |

## `REG-PERF-031` 非视觉设置与字号中间值重复提交主题卡片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-03`，共享 `FEED-01`、`SEARCH-02`、`TOPIC-01/04` |
| 历史症状与根因 | 2026-10-03 复审确认 useAppTheme 依赖完整 ReaderSettings。字号 1→1.1 的 deferred 中间值提交旧字号卡片，随后再提交新字号；修改 NodeSeek 恢复阈值、内容源或传入等价设置对象，也会重建全局主题/context 并通知卡片及图标子树。 |
| 当前 owner | 主题调色板只依赖主题模式，视觉上下文类型与值仅包含六项视觉设置，样式消费者同步收窄类型。`tests/ui/shared/topic-card.test.tsx` 的真实 hook→Provider→MemoizedTopicCard 组合先出现四个失败，修后字号只提交新值一次，无关设置与等价对象零提交；主题、字号、密度、行距、宽度、字体仍有实际样式 oracle。 |
| 设备证据与边界 | 2026-10-03 主登录 API 35 普通 Release/Hermes 候选 `8e2ac764…` 实际切换主题、字号、行距、正文宽度、字体和密度，设置页与 Feed 均更新，随后六项设置恢复原值、登录仍为 3/3。本条关闭确定的 React 冗余传播，不把它当作全部原生慢帧的根因；Search 冷绘制与系统合成仍按 `REG-PERF-029` 独立验证。 |

## `REG-SEARCH-032` 分页取消后继续滑动不再请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`，共享 `NAV-01` |
| 历史症状与根因 | 2026-10-03 排查用户报告的 NS 搜索停止续页，真实 SearchRoute/Controller/Query 复现第二页在途时失焦取消、返回后仍显示「继续下滑」但不再请求。Screen 的 pending 只在错误或页码推进时释放；Query 取消恢复原页且不产生 error，导致四站单源搜索均可能保留死锁。controller 直接返回 stale 时也没有 props 变化来释放它。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 固定分页取消后原页重试、首屏保留、普通网络失败重试、stale/reject 结算和新旧请求交错；既有分页完成提示用例覆盖先结算后提交结果。复审新增真实 Query 通知延迟时不跨页、相同输入五次刷新不重建列表 renderer 的红绿 oracle；Controller 读取当前缓存并稳定 Query key，关闭解除互斥后暴露的两个竞态/重复渲染回归。 |
| 修复与证据 | 每次请求只标记自身已结算，解除互斥但保留分页描述直到实际结果提交；旧请求不能修改新请求。修前 seed 1003 的取消/stale/reject 三项普通断言失败，复审新增两项也先红后绿；最终两个搜索 UI owners 共 112 项通过，seed 31008。2026-10-03 隔离 API 35 Release/Hermes 以真实 SearchRoute/native stack/FlashList 和合成 fetcher 完成实际滑动：第二页在途离开触发 abort=1，返回再滑动请求序列为 [1,2,2]，结果从 10 条增至 15 条且无重复；普通网络失败的可见重试也通过。主登录 AVD 普通候选 SHA `411dc94e…` 的真实 NS 搜索从 60 条经切页返回续载到 90 条。未取得用户原始故障响应，也未验证物理设备。 |
| 最终包复核 | 2026-10-03 普通 Release/Hermes 包 `4526f11f…` 在主 API 35 AVD 再次完成真实 NS 搜索载入 60 条、切到 Feed、返回保留 60 条并继续载入 90 条；三站登录与原 UID、首次安装时间保持。消息列表读取及 Feed 滚动正常，观测窗口无 App crash/ANR、失效 Fabric tag 或 Reanimated 同步更新失败。全量 verify 为 237 个 Vitest 文件 3264 项、97 个 Jest suite 2246 项通过，随后末次消息分页补修的完整 76 项 owner 与 typecheck 通过；此证据不覆盖物理设备或所有冷首挂载性能。 |

## `REG-SEARCH-033` NodeSeek 异常搜索响应被当作成功终页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02/04` |
| 历史症状与根因 | 同次排查发现 HTTP 200 的空响应或错误 HTML 被接受为成功空结果，并返回 hasMore=false/nextPage=null。旧完整性检查只拒绝缺少结果面的搜索表单，且把任意 alert/notice 当作合法结果面。此缺陷通过故障注入确认，未取得用户当次原站响应，不认定为该次现场的唯一原因。 |
| 当前 owner | 扩展 `tests/integration/source-read-contracts/nodeseek.test.ts` 的未完成页面 owner，经过真实 searchTopics/reader/parser 验证失败后同页重试，保留正式空列表、empty-state、embedded 空数组和旧页面壳的兼容对照。复审发现 embedded 正则的最小长度还会排除合法短空数组，移除任意长度门槛并保留 JSON/字段验证；script 与 data 属性中的三种最小空数组共六项先红后绿，NS 合同与来源共 340 项通过（seed 31009）。 |
| 修复与证据 | 无合法结果面或结果数组时抛可重试错误；通用错误提示不能确认空结果或选用旧 embedded 数据。修前 seed 31004 的四个异常响应断言因错误 resolve 转红；修后来源、gateway 与列表相关 229 项通过，随机 seed 1790957500988。2026-10-03 隔离 API 35 Release/Hermes 的真实搜索链路分别注入 HTTP 200 空 body 与独立 alert 错误：实际滑动后保留首屏 10 条、显示重试入口，点击后请求序列 [1,2,2] 并得到 15 条，Query 错误清除。注入只替换 fetcher，经过真实 gateway/reader/parser；不把合成响应当作原站现场证据。错误提示与空 post-list 并存的页面仍遵循既有结果容器优先规则，未证明任意错误 HTML 都能识别；物理设备与原站实际异常仍未验证。 |

## `REG-TOPIC-183` 视频行在全屏启动期间回收导致原生页面退出

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`，共享 `TOPIC-01/03`、`NAV-03` 的视频行生命周期 |
| 历史症状与根因 | 2026-09-23 原生媒体压力测试中，发起全屏后立即回收 inline row，FullscreenPlayerActivity 随后创建时查不到已经从 VideoManager registry 移除的 VideoView，记录 `VideoView ... not found` 并退出。JS 已保留 player/lease，但未覆盖原生 Activity 尚未接管的时间窗口。 |
| 当前 owner | `dev/media-pressure-proof/index.tsx` 与 `scripts/run-media-pressure-device-proof.mjs` 固定 Native 进入时立即回收、实际全屏控件、保留时间和退出释放；旧 APK 在相同设备行为 oracle 失败。`tests/tooling/media-pressure-device-proof.test.ts` 只承接 driver 判据，`tests/tooling/release-packaging.test.ts` 只承接补丁接线，均不替代设备行为。 |
| 修复与边界 | `patches/expo-video+57.0.3.patch` 为每次启动保留待接管的原 View/player，Activity 按唯一 token 领取；普通 registry 仍即时注销，player 释放、模块销毁和启动失败取消待接管对象。生命周期失效与 begin/claim 共享锁，拒绝已更换的 player，退出只归还仍有效的原行。API 35 minified Release Hermes 实跑 26 轮、192.37 秒，7 次全屏进入/退出和 HOME 往返通过；全屏期间同一 Native player 每次推进 3.245–3.327 秒，7 对截图均显示时钟及动态图案推进。创建/释放均 85、末尾 live/observer 均 0，未再出现原异常。不据计数或离散截图声称 native heap 零泄漏、逐帧无卡顿、实际出声或物理设备通过。 |

## 文档职责

本文件只记录已经逃逸的历史事故：当时的用户症状、根因 seam、处置状态，以及当前由谁承接证据。当前产品行为以 `docs/product-map.md` 为准，测试方法以 `docs/testing-standard.md` 为准；普通通过测试使用行为标题，不再携带 REG ID。

历史条目不会因为测试合并或产品演进而删除。多个 REG 可以指向同一个 canonical owner；当前 owner 被更强证据取代时更新本文件，不复制完整测试清单。

编号按事故唯一分配。2026-09-07 整理时发现两组重号：刷新指示器停留改为 `REG-FEED-028`（原误用 `REG-FEED-019`），刷新圆圈闪回改为 `REG-FEED-029`（原误用 `REG-FEED-020`）；原 `REG-FEED-019/020` 分别保留给 Pager 事件顺序和纵向斜滑事故，历史症状、owner 与状态不变。

## 状态模型

| 状态 | 含义 |
| --- | --- |
| `OPEN` | 已确认问题尚未闭合。可自动稳定复现且未修复时，用携带 canonical REG 的 expected-failure 保存失败 oracle；设备专属问题或明确要求完整 Live 才能关闭的条目，记录操作、失败判据和待验收分支。无法稳定复现时明确证据缺口，不伪造 expected-failure。 |
| `RESOLVED` | 当前契约已有 canonical owner，并达到该条目的关闭条件；历史事故不再决定测试结构，也不代表所有设备和真实来源分支都已验证。 |
| `SUPERSEDED` | 原契约已被明确的新模型取代；通过 `superseded-by` 指向后继事故。 |
| `EVIDENCE_GAP` | 事故或当前 owner 的证据不足；不得伪造两套预期。 |

未闭合条目的「当前结论」区分「仍有残余失败」「原始症状待定位」和「已确认缺陷已有修复，待验收」。事故状态不等同于代码修复进度：已有修复但未达到关闭条件的条目继续保留原状态，在[待处理清单](code-cleanup-map.md)中单列验收工作。历史症状没有新的复现或归因证据时，不直接当作当前版本仍有同一缺陷。

## 环境反例：2026-09-20 CF 验证与上报出口不一致

本条是已定位的测试环境反例，不分配产品回归 REG，也不因它撤销既有 Cookie、CSRF、身份、批次与重放保护。证据 owner 为 [维护手册的 CF 出口排查流程](operator-runbook.md#cf-验证循环先核对实际出口)；设备身份与详细运行记录保存在本机 `docs/emulator-baseline.md`。

| 项 | 已确认事实与边界 |
| --- | --- |
| 症状 | 已安装 App 1.3.147 的 L 站阅读 POST 返回 403 且 `cf-mitigated: challenge`；WebView 可以完成验证，原生请求仍被拦截，有时验证入口只显示普通 404。Cookie 存在或已更新不能证明原请求恢复。 |
| 容易误判的对照 | 同一真实批次的独立 OkHttp H1 与 Cronet H2 被 CF 拒绝，带 QUIC hint 的 Cronet 三次实际走 H3 并成功；实验 Cookie、CSRF 和表单一致。这一结果同时改变了出口，不能证明 H3 是必要条件或原生 TLS 指纹不兼容。hint 在另一次只读探测中实际降为 H2，也不保证 H3。 |
| 环境证据 | 默认网络下，CF trace 显示 OkHttp/Cronet H2 为同一 IPv6 出口，验证 WebView H3 为另一个 IPv4 出口。主机 FlClash TUN 已开启，配置未发现显式 TCP/UDP 分流规则；具体差异来自本地转发、远端 DNS/双栈选址还是 NAT，尚未取得唯一归因证据。 |
| 决定性实验 | 不改 App、不换 APK，临时令现有 HTTP 代理同时承接原生与 WebView。WebView 改走 H2，出口与原生一致；重新验证后，原 App 原生 H2 上报返回 200（267 ms），原批次 completed，随后新批次 200（301 ms）。关闭并删除临时代理后，沿用新凭据的新批次及离开收尾仍为 200（265/259 ms）。 |
| 处置 | 保留既有产品传输与恢复实现，不引入实验 helper、不全局切换 H3、不新增「强制 IPv4」承诺。临时代理、设备 helper、转发映射与本任务进程已清理，登录态保留；证据与排查次序持久记录。本轮未证明需要修产品代码。 |
| 未验证 | 同一外部代理未来重新签发凭据后的稳定性、实体机及其他代理、具体远端出口策略、仅通过外部代理限制 QUIC 的实际效果。一次环境恢复不等于所有网络永久兼容。 |

教训：先验证两个通道在服务端的实际出口，再做网络库与协议替换实验；不要把系统代理状态当作整条网络链路的证据。[Cloudflare 对不同 IP 解题的限制](https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/#limitations)提供机制依据，不能替代本站具体规则证据。

## `REG-ACCOUNT-055` 妖火检测已确认登录但验证窗口不自动关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01/02`，共享三站登录页面生命周期 |
| 历史症状与根因 | 妖火页面完成登录且 App 权威检测已确认账号，窗口仍停留，需要手动关闭；原宿主只调用账号检测，没有消费成功结果完成当前面板。三站页面又分别实现操作区，自动检测和成功收尾缺少一致契约。 |
| 当前 owner | `tests/ui/account/account-runtime.test.tsx` 承接真实账号检测、当前窗口关闭及关闭/后台后的迟到结果；`tests/ui/account/account-site-panels.test.tsx` 承接可信页面提示、单次自动检测、失败留页和共享操作区。脚本隐私与挑战状态由既有 `src/platform/network/loginWebViewScripts.test.ts` 承接。 |
| 修复 | 妖火与 NodeSeek 共用 `SiteLoginHost`，妖火仅在本轮手动检测确认登录后关闭。2026-09-29 用户进一步明确普通打开原站用于浏览，不能因已登录而关闭；自动检测门禁因此收窄到 NodeSeek 待恢复的 exact 读取，并删除妖火无消费者的自动探针。普通三站页面保持打开，L 站主动网站验证和恢复流程继续使用既有 CDK 回执。未知、挑战、错误、旧窗口和后台结果不关闭新页面，不清 Cookie，不以页面 200 或 DOM 提示当身份成功。 |
| 前一轮验收（意图收紧前） | 2026-09-29 主 `WZ_Pixel_API_35`（`emulator-5562`）覆盖安装 build `fa6bb0dabf48428fad582ed6c8a6635c`，APK SHA-256 `ee7ec366de79232c3a8fa55f574cd3dc68e6dd984517c178b5993fa1e2e4c9ee`；firstInstallTime 保持 `2026-07-26 16:51:37`，三站登录保留。仅打开「检测或重新登录」，不点窗口内手动检测：妖火 trace48 于北京时间 22:22:28.748 自动检测、22:22:30.017 成功关闭，trace64 于 22:22:54.656 → 22:22:55.958 再次完成；NodeSeek trace80/97 同样两次自动成功关闭。L 站 trace114 从 CDK 返回后于 22:24:19.846 自动检测、22:24:20.562 成功。当时既有登录会话的自动闭环为 `LIVE_PASS`，证据为 `.codex-tmp/unified-site-verification/automatic-login.mp4` 与 `.codex-tmp/unified-site-verification/live-events.json`；该旧行为不再是普通浏览的当前契约。 |
| 本轮验收与边界 | 同一主 AVD 覆盖安装 build `3b8d81a4cbbb4fe092165a9061920cec`，firstInstallTime、三站登录和原外观保持。NodeSeek 普通浏览 100.802 秒、妖火 61.564 秒、L 站 39.883 秒，各为零自动检测；NodeSeek/L 站滚动及妖火点击「新帖」站内跳转均保持窗口，随后手动检测确认成功才关闭。L 站另主动选择网站验证，trace102 于北京时间 22:52:32.240 自动回查、22:52:32.728 成功关闭，获该范围 `LIVE_PASS`。本轮 `UI_PASS` 96 项（seed `1983093102`）、`UNIT_PASS` 31 项（seed `1983093002`），相关静态门禁通过；ARM64 包为 `APK_SANITY`，17 个生产输入与冻结源码匹配，两包 Hermes bundle 相同。证据仅存本机 `.codex-tmp/verification-intent/acceptance.md`、两段 browsing-and-checking 录像、三站 browsing 截图及 602 事件的 direct journal，未新增分享导出。新验证码交互、新 exact 受阻请求恢复与实体手机仍为 `NOT_VERIFIED`。 |

## `REG-ACCOUNT-054` 主站验证入口未恢复 CF 上报且缺少备用入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`，共享 `TOPIC-01/03` 的 Cookie 交接与阅读恢复 |
| 历史症状与根因 | 2026-09-29 同一主 AVD 中，主站 `/challenge` 持续返回普通 404；双通道出口采样一致、实际发送 clearance 与共享存储一致后，原生阅读 POST 仍遭明确 CF 403。原站 WebView 的自然 POST 也被拒绝；按用户授权仅删除 CF Cookie 后，主站后续 JavaScript Detection 签发新 clearance 仍未恢复 POST。已确认产品缺少可选验证入口，服务端具体规则仍未知；上述事实不能将原因归为原生网络库，也不能把 404、无挑战标记或新 Cookie 判为验证成功。 |
| 决定性对照 | 用户授权的同一 App WebView 加载 `https://cdk.linux.do/`，主文档先返回带 `cf-mitigated: challenge` 的 403，随后取得新的 `.linux.do`、同分区 clearance，并到达 `/login` 200；未登录 CDK。检测关闭后，原 App 原生自然阅读 batch3、batch4 连续 POST 200，同进程复用原 Native connection `8e4e24d`，未切传输。安全证据为 `.codex-tmp/cf-cookie-recovery/cdk-challenge-events.jsonl` 与 `.codex-tmp/cf-cookie-recovery/live-cdk-recovered.json`；不保存 Cookie 值于本文。 |
| 产品缺口与首轮修复 | 验证窗口只提供主站入口，用户无法在窗口内选择已证实可恢复的 CDK 路径。首轮修复保留默认 `/challenge`，增加显式「备用验证」，沿用当前窗口及刷新/重新验证生命周期；手动账号检测页也可主动进入。当前 CDK `/login` 载入后回主域继续 probe 与手动检测，其他最终页不自动判成功。不清登录、不自动换传输、不放宽 CDK 消息为主域身份或探针证据，原 Cookie barrier、取消及阅读 100 秒期限不变。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` 最初建立缺少「备用验证」按钮的修前 RED，继续承接当前页面、原生事件顺序及消息边界。自动检测、取消、原请求交接与恢复由 `src/features/account/useVerificationController.test.ts`、`tests/ui/account/account-runtime.test.tsx` 和现有 reading runtime owner 承接，不另建业务重放通道。 |
| 历史自动引导 | 首轮后曾在同一可见窗口首次出现 `verification-required` 检测结果、且不在检测中或登录表单模式时，自动进入 CDK 并复用既有重新验证；不自动检测或上报。自动引导每窗口至多一次，手动备用仍可再次使用并消耗尚未使用的自动机会；关闭窗口或转入登录表单时重置，返回主域、key 刷新和前后台切换不重置；普通 404、网络失败、未知和过期不触发。`tests/ui/account/account-runtime.test.tsx` 的真实 reading 链在旧实现先 RED（seed `1981982290`）；修复后 `UI_PASS`：76 项、seed `929480414`，controller 与 reading `UNIT_PASS`：90 项、seed `1790683893977`。该模拟器包的手动链路已验，真实 CF 自动恢复未验，不由手动入口证据替代。 |
| 后续流程重构 | 经用户授权，专用读取恢复改为直接 CDK → 合格 `/login` 文档消息 → 主域 `/latest` → 自动检测一次；账号页「网站验证」同样可自动执行既有账号检测。页面 hook 要求精确当前文档、无已知错误及无挑战标记，CDK 阶段不在 `onLoadEnd` 补注入，避免 Android 网络错误先发普通 finish 导致误返回。controller 等待可信主域状态与既有五秒出口探针结算，但不以采样质量决定业务放行；保留手动检测、失败留屏及用户主动重新验证，不自动循环。闭集日志增加 `challenge-open/auto-check`，历史动作保留；当前行为以 product map 为准，设备证据范围见下列最终复验。 |
| 后续日志补修 | 候选 buildId `17224373ade94a22a77e446ad41a0327` 的真实 UI 导出缺少已发生的 HTTP 404，日志验收 RED；同包两个自然批次 POST 200 不能证明日志完整，未作为最终日志包交付。补修在 UI URL 过滤前保留 HTTP 错误及匹配布尔值，不记录 URL；原失败 oracle seed `-1230218928`，修后 `UI_PASS` 77/77、seed `-1802990118`，typecheck、ESLint、Prettier 通过。最终 buildId `b185ae5eb4e1465082cd4712357efd50` 的模拟器日志 `LIVE_PASS`：1252 个本构建事件、33 个 Native Cookie 请求中，53 个关键事件与实际分享导出匹配；404 回调先于对应 load-start，`isDocumentUrlMatch=false`，仍完整保留。回主域新 probe、检测交接及两次自然 POST 200 通过，健康计数零新增，未检出原始凭据字段。证据为 `.codex-tmp/cf-auto-verification-logs/emulator-receipt.json`，安装身份、APK 校验、受控导出清理与未验范围见 `.codex-tmp/cf-auto-verification-logs/acceptance.md`。 |
| 历史手动入口设备证据 | `LIVE_PASS`：buildId `b129345cd5cd4cf3977a7b0cffa3bf3e` 在主 AVD `emulator-5562` 保留数据覆盖安装，`firstInstallTime` 不变，三站登录 UI 保留。北京时间 19:48:41 实际点击备用按钮到 CDK `/login` 200，19:48:42 同一 WebView 回主域 `/latest` 200，19:48:44 新主域 probe 成功且同出口，19:49:03 手动检测的 `surface-close` 成功。随后新自然阅读 `trace-103/request-35` 于 19:49:16 POST 200，离开收尾 `trace-105/request-36` 于 19:49:42 POST 200。实际分享导出含 1280 个新构建事件、35 个 Cookie 请求，39 个关键 journal 事件与导出匹配；健康计数零新增，未检出原始凭据字段。证据为 `.codex-tmp/cf-alternate-verification/emulator-receipt.json`、`.codex-tmp/cf-alternate-verification/verification-navigation.json` 与该目录安装前后记录。 |
| 本轮设备逃逸与补修 | 候选 buildId `0d7ce4e735fc4c2da6070c0c6b116376` 首轮自动检测成功；深色/140% 第二轮返回主域后，Android `doUpdateVisitedHistory` 的重复 `load-start` 被当作新导航，按 `progress != 100` 计算的 `loading` 误取消出口探针，后续同文档消息被 stopped guard 丢弃，自动检测停住，手动检测仍可完成。北京时间 2026-09-29 21:27:44.669 出现重复加载事件，21:27:44.678 的 `trace-84`（parent `trace-76`）以 native success、WebView canceled、`probeCancelReason=navigation` 结束；证据为 `.codex-tmp/cf-verification-polish/first-live-events.json`。同期模拟器及 arm64 候选拒绝交付，保留为该目录 `rejected-history-race-*`。既有 controller/runtime owner 先建立修前 RED；补修将加载布尔值仅用于 UI，由允许的顶层导航回调或真实文档变化撤销旧证据。最终 `UNIT_PASS` 219 项（seed `1983092901`），相关 `UI_PASS` 96 项（seed `-1813325405`）；catalog 在并行 Gradle 下曾触及五秒超时，无构建干扰时同 seed 重放全部通过，未放宽阈值。 |
| 最终模拟器复验 | `APK_SANITY`、`LIVE_PASS`：buildId `8334c4bc0cda4d15bd2f3abe29217633` 保留数据覆盖安装主 AVD，`firstInstallTime=2026-07-26 16:51:37` 不变，三站登录保留。深色/140% 下两次账号「网站验证」分别以 `trace-47/key-2`、`trace-69/key-6` 于北京时间 21:38:22.930、21:38:57.250 自动完成，未点击手动检测；均持有双侧 success、同出口采样，并完成两次 Cookie 交接。随后自然阅读 `request-39/40` 两次 POST 200。实际 UI 分享导出含本构建 1370 个事件、38 个 Cookie 请求，与 66 个关键 journal 事件匹配；JS/Native 健康计数相对基线零新增，原始凭据字段检出为零。偏好恢复浅色/100%。回执为 `.codex-tmp/cf-verification-polish/emulator-receipt.json`，打包及安装核验为同目录 `.codex-tmp/cf-verification-polish/emulator-sanity.json`、`.codex-tmp/cf-verification-polish/install-after.txt`。 |
| 关闭范围与未验范围 | 关闭原验证入口缺口及本轮 history 误取消自动检测缺陷；保留首个候选失败历史。最终模拟器沿用已恢复的 clearance，未删除 Cookie 制造新挑战；新受阻原批次恢复、新 CF 真人挑战、实体机、小屏原生结果态及其他 CF 规则仍为 `NOT_VERIFIED`。此前真实 CF 403 → CDK 挑战 → 原生 200 只由旧构建手动对照证明，不能与最终账号自动检测拼成新包完整受阻批次恢复，也不承诺已登录 CDK 的其他最终页均可自动恢复。 |

## `REG-MORE-008` Android 验证消息导致出口探针未启动或误取消

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-02`、`ACCOUNT-02` 的验证出口诊断；不改变原请求恢复与账号身份 |
| 历史症状与根因 | 2026-09-29 真机 buildId `ae63c3310e4c4bb89920b09e5e1a29c5` 的页面消息和 UA 已识别，但北京时间 17:23:09.380、17:23:22.436、17:23:41.495、17:23:56.734 四次检测均为 `egressProbeState=not-started`，没有 `egress-probe`。现代 Android WebMessageListener 把 `sourceOrigin` 作为 `event.url`，controller 却要求完整 `documentKey` 以该值加冒号开头；页面 URL 中的路径使校验失败。原测试只构造旧桥接的完整页面 URL，未覆盖实际平台消息形状。 |
| 修复 | 分别解析完整文档 URL 和末尾时间戳，接受固定 linux.do 来源的 origin-only 或对应完整 URL 消息；注入脚本继续核对当前主文档的完整身份。未通过文档校验时只记录受控原因，不输出原始 URL、IP、Cookie 或页面正文。 |
| 同链路补修 | Android 源码确认 history 更新也发出 `onLoadStart`，加载完成时携带 `loading=false`，宿主却强置为 true；UI oracle 确认会误取消采样。主模拟器两个修前导出在检测时都只持有 canceled 样本；保留明确的 false 后，同环境复测取得有效样本。原日志未直接记录 loading 布尔，设备归因依据为该平台契约与修前/修后对照；真实加载仍取消旧文档探测。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` 固定两种桥接来源、完整文档身份和失效消息；`tests/ui/account/account-runtime.test.tsx` 与 `tests/ui/account/account-site-panels.test.tsx` 固定实际 Account/宿主接线；`src/platform/network/cloudflareEgressDiagnostics.test.ts` 承接实际注入脚本、双通道采样与脱敏。 |
| 失败 oracle | origin-only 的三个 Account UI 场景修前失败，旧完整 URL 对照通过；history `loading=false` 的 UI oracle 先红后绿。`UNIT_PASS`：controller 70/70；`UI_PASS`：Account runtime 43/43、site panels 26/26。 |
| 设备闭合证据 | `LIVE_PASS` 仅针对诊断链：2026-09-29 主 AVD `WZ_Pixel_API_35`、API 35、WebView `156.0.8062.0`，修复 buildId `6a2e81e4786043e687fd4f2d8c076d65` 覆盖安装前后 `firstInstallTime=2026-07-26 16:51:37`，三站登录保留且页面 current-user 可见。实际导出含 1 次成功、0 次取消；手动检测持有双侧 success/H2/IPv4、`isSameEgress=true` 的完整采样，Cookie barrier 父 trace 与检测终态关联通过。receipt 为 `.codex-tmp/cf-diagnostics-v2/main-export-history-fixed.receipt.json`；本轮健康计数相对基线零新增，历史累计写失败与丢弃不为零。 |
| 证据边界 | 本条仅关闭诊断桥接与误取消缺陷；模拟器出口一致只描述该次 trace 采样。原真机 CF 403 的出口差异、服务端触发原因及业务恢复仍为 `NOT_VERIFIED`，不认定用户的 CF 拦截原因，也不声称已修复 CF 循环。 |

## `REG-PERF-026` 清空历史逐条跨桥读写 SQLite

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-02`、`LIBRARY-01/02/03` |
| 历史症状与根因 | 清空 5000 条历史经 ReaderTransaction 逐条读取、删除、写删除标记，容量裁剪再次逐条读取/删除，产生 28008 次串行 SQL 调用，长期占用本机写队列。既有测试只核最终条数，没有约束工作量。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts`；真实 Android SQLite 由 `dev/reader-storage-proof/index.tsx` 补充。 |
| 修复与边界 | 每批最多 50 条，批量读取、删除与写入，裁剪直接复用已读 key/bytes；同事务、ordinal、删除标记容量、membership 与字节计数不变。普通工作量 oracle 修前失败；5000 条降至 488 次 SQL（减少 98.26%），三种 collection 的真实旧新 SQLite 差分和回滚通过。独立 API 35 Release Hermes 清理 5002 条约 795 ms，checkpoint 全部恢复；没有旧版同设备耗时对照，不据此宣称帧率提升或 O(n) 变 O(1)。 |

## `REG-PERF-027` 嵌套正文图片扫描重复遍历后代

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`；四站主楼、回复及引用共享正文编译 |
| 历史症状与根因 | 图片已按所属块建立索引，但每个祖先块的 authoredImageLines 又向嵌套块下钻，带图嵌套正文呈二次方工作量。30/60/120/240 层分别读取 1485/5670/22140/87480 次 tag。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts`；内容守恒与分块由 `src/domain/forum/topicContentSplit.test.ts` 承接。 |
| 修复与边界 | 遇到拥有独立 owner 的嵌套块只结束当前行，不重复下钻；对应工作量为 209/419/839/1679。普通规模增长 oracle 先红后绿，500 个固定 seed 混合树的完整 HTML 与 preview 逐值相等。Node 22 交错测量的 240 层中位约 6.366→0.927 ms，只作算法归因，不冒充设备帧率。 |

## `REG-PERF-028` 原图同身份重渲染丢失已显示状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`；共享 `NAV-03` 图片预览与回收 |
| 历史症状与根因 | 2026-09-22 压测确认：原图 hook 每次 render 创建新的订阅函数，React 重订阅时短暂移除活跃保护；其他活跃 revision 超过 512 条预算后，同身份 source 对象重建也会把当前已显示 revision 从 1 淘汰为 0。正常 viewport 通常不会达到此负载，未据此宣称真实设备普遍闪图。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx`；超过预算的活跃订阅下重渲染、真实身份变化与旧结果隔离由同一行为测试承接。`src/platform/media/originalImageLoading.test.ts` 固定淘汰工作量、释放顺序，以及旧退订重复执行后新监听仍存续。 |
| 修复与边界 | 以完整 request identity 稳定 subscribe 与 snapshot，保留现有缓存预算及淘汰规则。超过预算的剩余条目已全受订阅保护，mark/最终退订只核对变化的 identity，避免反复全扫描；退订闭包只结算一次，防止同一 callback 再订阅后被旧 cleanup 移除。修前 1→0 的 UI oracle、扫描工作量和重复 cleanup oracle 均失败；修后按各 canonical owner 验证。Android 实际视觉、解码和帧率不由此 UI/单元证据代替。 |

## `REG-WRITE-093` 旧编辑文档的异步结果污染新草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05`、`NOTIFY-02` |
| 历史症状与根因 | 上传中关闭编辑，再打开新回复会复用 WebView 并 INIT 新文档；旧宿主 Promise 未失效，富文本和源码都能把旧图片插进新稿。模板及资源解析共用宿主请求表。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts`、`tests/ui/topic/topic-components.test.tsx`；宿主 bridge 继续归 `tests/ui/topic/structured-reply-composer.test.tsx`。 |
| 修复与边界 | INIT、DESTROY 与卸载结算旧请求；文档代际约束旧成功、错误和 finally，避免旧 busy 清除新上传。独立复核又以普通红确认相同 upload:// 内容会复用已取消请求的图片节点，故新 INIT 同步清空后装入新文档；中间态不发快照、不加历史、不异步闪空，同稿模式切换仍复用节点。真实 DOM/Tiptap/CodeMirror owner 及宿主流程通过；未进行未经授权的真实上传或发帖。 |

## `REG-WRITE-094` NodeSeek 编辑删除投票后本地仍显示旧卡片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/05`、`TOPIC-03` |
| 历史症状与根因 | 2026-09-20 主登录态模拟器中，NodeSeek 856117 的第 37 楼删除投票 3199/3200 标记并保存为纯文本后，新正文立即显示，两个旧投票仍保留；手动刷新评论后卡片消失。共享 applyEditedReplyContent 只替换正文，继续携带旧 polls，compiler 将无正文 marker 的旧 sidecar 追加在末尾；该 helper 同时用于确认编辑后的两种排序缓存和回读缺目标的本地 fallback。 |
| 当前 owner | `src/features/topic/actions/actionHelpers.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx`；回读窗口继续由 `tests/ui/topic/topic-session-controller.test.tsx` 承接。 |
| 修复与边界 | 按既有 NodeSeek marker 解析规则筛选新正文仍引用的投票，再复用来源正文归一；删除全部、删除部分、代码与仅 href 标记均先红后绿，保留的投票留在正文原位置，确认编辑立即清理正倒序缓存。2026-09-20 主模拟器普通 Release buildId `3b9b891326164779be4e04064cbac738` 同一第 37 楼复用 3199/3200：删第一项后立即只剩第二项且位于中间／结束正文之间，删全部后立即无卡片，均未手动刷新；随后刷新读回一致，取得 `LIVE_PASS`。截图为 ignored `.codex-tmp/review-fixes-20260920/ns-final-one-poll.png` 与 `.codex-tmp/review-fixes-20260920/ns-final-no-polls.png`。本项复验没有新建投票或提交选项。 |

## `REG-WRITE-095` 妖火连续语音输入只进入首字

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已移除两处 IME 干预，原始语音症状待用户真机复测。2026-10-04 用户明确要求本轮先不测试，之后自行在真机验证；保留 `EVIDENCE_GAP`，不把模拟器键入或用户记忆写成语音通过。 |
| 能力 ID | `WRITE-01`、`NOTIFY-02` |
| 历史症状与根因 | 用户报告妖火语音输入只能进入第一个字，逐字键入正常。共享原生输入器同时存在正文变化后回写受控选区、`keyboardDidHide` 无条件 `blur()` 两处干预 IME 的路径；具体输入法、事件顺序与物理设备语音尚未复验，未确认哪条路径导致原始症状。 |
| 当前 owner | `tests/ui/topic/yaohuo-reply-composer.test.tsx`；主题回复与妖火纯文本私信共用 `src/ui/composer/YaohuoReplyComposer.tsx`。 |
| 修复与边界 | 删除日常输入的受控选区和键盘隐藏撤焦，仅在 ref 记录原生选区；格式工具继续按选区替换并钳制光标，表情与关闭保留显式焦点动作。seed `2092001` 下修复前 4 项失败、4 项通过，修复后 8 项通过；该 UI 证据固定输入器不主动打断 IME，不能替代真实语音识别链路或证明原始根因。用户具体输入法与物理设备语音为 `NOT_VERIFIED`。 |

## `REG-WRITE-096` 妖火图片上传仍调用原站已替换的旧图床

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04/07` |
| 历史症状与根因 | 2026-09-20 新帖选择合成 PNG 后旧 `tucdn.wpon.cn/api/upload` 返回 HTTP 502；回复图片复用同一固定地址。原站当前图床导航已不列 wpon，首项云像素要求独立登录，第二项大厂图床为 `file.sang.pub`。旧 adapter 仍发送 multipart `image`，也未校验业务成功码；新站实际协议为原始文件 POST、`X-Upload-Type: qiyu` 和编码文件名，返回 `{code:200,data:URL}`。旧服务 502 不能证明图片已被保存，也不能用新服务成功倒推旧上传结果。 |
| 当前 owner | `tests/integration/image-upload.test.ts`；新帖调用链由 `src/features/topic-composer/topicCreationActions.test.ts` 承接，回复身份与发送边界归 `tests/ui/topic/topic-actions-controller.test.tsx`。 |
| 修复与边界 | 共享 adapter 切到原站导航的已核对服务，复用 React Native 原生 URI 文件流及现有 Fetcher，不引库、不改变 Cookie 策略、不复制妖火凭据；仅明确成功及 HTTP(S) 地址入文，保留拒绝 `msg`，无自动 fallback/重试。相同输入的协议/响应 oracle 修前 11 项失败，修后两组 42 项通过；新帖失败与未知状态矩阵 14 项通过。原站网页匿名上传本任务 446 B 合成 PNG 并确认图片完整加载，取得网页入口的 `LIVE_PASS`。2026-09-21 匹配普通 APK `image-fixes.apk`（SHA-256 `784928D4303151F0D9CAF4878BCA10B350CDEFDCEA82AE73526AAC2F1FC928C4`）中，原生回复与新帖各自选择全新合成图片，均成功取得图片链接并插入 UBB，取得两个 App 入口的 `LIVE_PASS`；回复原生 trace 确认单次 POST、TLS、HTTP/2、HTTP 200 与成功结算。全程未发表主题或回复。 |
| 后续单次失败与证据 | 同包新帖首次上传曾报 `Network request failed`，原因未确认；只读核对持久文件存在、大小与权限正确，后续全新附件成功，不能据此把首次错误归因于 URI 或宣称临时网络根因已证实。首次附件保持 `unknown`，未重传；旧 wpon 502 的远端结果同样未倒推。既有 `REG-WRITE-088` 的新版 WebView/物理设备缺口保持独立。公开合成图、协议、过滤诊断与各入口证据见本机 `.codex-tmp/topic-live-0920/yaohuo-image-provider.md`。 |

## `REG-WRITE-097` 富文本小图选择框撑满正文宽度

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04/05/07`、`NOTIFY-02` |
| 历史症状与根因 | 2026-09-21 用户报告小图片点选后仍出现长条蓝框。主模拟器 linux.do 的已加载小图实际为 128 × 96 px，外层 `.composer-image.ProseMirror-selectednode` 却为 379.43 × 96 px，二者起点相同。NodeView 的 block div 默认撑满正文宽度，选框画在该 div；并非图片未加载或图片固有尺寸错误。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 的真实 NodeView 加载、失败、重试、选择与模式往返 owner；`src/ui/composer/editorRuntime.css` 持有加载后 wrapper 几何约束。实际 Android bounds 由匹配 APK 复核。 |
| 修复与证据 | 仅当直接子图片已加载可见时，wrapper 使用 `width: fit-content; max-width: 100%`。保留 block 顺序、图片比例、原选择框与文档节点；加载中和失败反馈保持满宽可读，不以隐藏选择框规避问题。原站已加载小图的 Android bounds 构成几何 RED；现有两站 runtime owner 在修前取得 `auto` 而非内容宽度，修后加载态、失败态与选择态检查通过，完整 runtime 77 项通过。 |
| 设备验证 | Android API 35 匹配修复 APK：小图与蓝色选择框均为 128 × 96 px；960 × 160 px 宽图缩为 379.43 × 63.24 px，160 × 640 px 竖图保持比例，各自 wrapper 与图片 bounds 一致。源码往返与继续上传插入通过，未真实发布。物理设备仍未验证。 |

## `REG-USER-016` V2EX 用户页以主题回复总数折叠不同活动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 原站同一用户的不同回复行会链接相同 /t/id#replyN，N 是主题回复总数。parser 将其用作活动 ID 和 floor，controller 按 `source:id` 合并后吞掉不同回复，且没有读取相邻 reply_content。真实匿名样本中 12 行有两组重复链接。 |
| 当前 owner | `src/sources/sourceUserRead.test.ts`；页面展示与 Query 合并仍归既有 User owner。 |
| 修复与边界 | 活动以页、完整正文指纹和同文出现序号区分，读取 .inner/.cell 的相邻正文，移除伪造楼层；同页新插入不同正文和主题总数变化不改旧行 ID。普通反例先红后绿，原站样本 12 行均保留，进入主题沿无 hash 的 topicUrl。原站无稳定回复实体 ID，更新导致行移页时无法精确去重，不新增逐帖补请求。 |

## `REG-TOPIC-182` 表格分块丢弃 caption 中的安全内容

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | sanitizer 保留合法 caption，但 tableRowsForNode 只重建表格行；caption 的标题、链接和图片未进入显示及选择内容。已安装 renderer 也不能直接显示原 caption 标签，仅把标签塞回表格不构成修复。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |
| 修复与边界 | 在表格前沿现有正文编译路径输出 caption 子内容一次，保留安全边界、preview 和选择顺序；分段表格与 typed directive 分支不重复消费标题。普通内容守恒反例先红后绿；不新增 renderer、row 类型或 colgroup 样式能力。 |

## `REG-USER-017` linux.do 用户摘要误认关联用户或合法空身份摘要

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | Discourse summary 的 root users 是关联用户集合，可能包含徽章授予者，也可能完全没有目标 user。parser 任取 users[0] 会改写资料身份并用错误 username 读取主题/回复；合法 summary 无 user 时又被判 parse_empty。 |
| 当前 owner | `src/sources/sourceUserRead.test.ts` |
| 修复与边界 | 只使用明确匹配的关联用户，合法摘要沿用已请求身份，缺失资料不补造；合法结构与错误响应分别核对，不新增 HTTP。协议依据 Discourse 官方 UserSummarySerializer 与 UserBadgeSerializer，普通反例先红后绿。本轮主 AVD 的 Cloudflare checkbox 恢复后 canonical 检测仍未恢复可信读取，当前原站数据轴为 BLOCKED_BY_ENV，不能据此声称真实账号资料已通过。 |

## `REG-DATA-013` 备份净化丢弃合法未知发布日期的本机记录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01/02/03`；共享 `USER-01/02`、`TOPIC-01` |
| 历史症状与根因 | 2026-09-20 再次审查确认：NodeSeek 用户主题解析允许 `createdAt: ''`，UserRoute 传入原摘要，TopicRoute 收藏该摘要，SQLite 可以成功保存；共享 topic schema 却要求正日期，导出会过滤这条收藏，导入合法空备份的合并还会删除本机记录。历史、关注内嵌主题和旧资料迁移共用同一验证边界。 |
| 处置 | 只有来源发布日期允许明确未知；本机操作时间和非法非空日期仍严格校验，不新增字段、备份版本或补造日期。以前已经丢失的数据无法凭此修复重建。 |
| 当前 owner | `src/domain/reader/readerData.test.ts`、`src/platform/storage/readerDataStore.test.ts`；合法未知日期边界值 → 保存/导出/合并 → 重开 SQLite 直接读取，领域矩阵展开四来源，既有迁移 owner 覆盖已知和未知日期。来源 parser 的未知日期契约保留在 `src/sources/sourceUserRead.test.ts`，跨 parser/store 的原始审查反例保存于本机 ignored 目录。Android 补充复用 `dev/reader-storage-proof/index.tsx`。 |
| 失败 oracle 与关闭证据 | 修复前 canonical owner 7 项普通失败；修复后相关 92 项通过（seed `20260920`），另一个随机顺序 71 项通过。日期未知记录保留，缺失/非法日期及保存/关注/删除时间损坏仍拒绝。设备与最终集成结果见 `docs/review-remediation.md` 本轮记录。 |

## `REG-USER-014` V2EX 活动 cursor 误读正文链接和用户名数字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 原 parser 全文寻找带 p 的链接并提取整个 href 的第一个数字；回复正文的外链 p=99 会制造虚假后页，数字用户名的完整分页 URL 会把用户名数字当页码。主题和回复共用此逻辑，controller 接受非空且前进的错误 cursor。 |
| 当前 owner | 只解析当前用户和活动路径的分页区域，读取唯一正整数 p；拒绝正文、跨站、跨用户、另一活动路径及畸形参数。`src/sources/sourceUserRead.test.ts` 通过真实 reader 验证主题/回复两条入口。 |
| 失败 oracle 与关闭证据 | 真实 reader 的两个独立普通红分别返回 99 而非 null、2026 而非 2；canonical owner 扩展正常分页和污染对照后转绿。受控 HTTP 不冒充原站当日样本，实际采样和验收边界见本轮修复记录。 |

## `REG-USER-015` 妖火同主题同分钟的不同回复被误去重

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 无楼层活动按 topicId 与分钟时间形成身份并再次按 topic/time 去重，同一分钟两段不同正文只保留第一条；controller 的 `source/id` 合并会进一步延续同一身份错误。 |
| 当前 owner | 缺楼层时由完整正文参与身份，展示摘要截断不影响区分；仅把有内容条目的无内容重复块折叠，保留同活动跨页去重。`src/sources/yaohuo/parser.test.ts` 与 `src/sources/sourceUserRead.test.ts` 分别承担 parser 和真实 reader 边界。 |
| 失败 oracle 与关闭证据 | 真实 reader 普通红丢失第二段正文；修复后同分钟不同正文及长正文相同摘要前缀均保留不同身份，有楼层和无内容重复对照继续通过。没有构造真实回复或宣称原站发生频率。 |

## `REG-SEARCH-031` V2EX 深分页越过 SOV2EX 的结果窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02/04`；共享 `SEARCH-01/03` |
| 历史症状与根因 | total=1000、批量 30 时，第 33 页返回 961–990 并产生第 34 页，下一请求 from=990/size=30 违反服务端 from+size≤1000，返回 400，最后 10 条无法读取。过去只验证两页和每次 size 上限，未覆盖深度边界。 |
| 当前 owner | `src/sources/v2ex/search.ts` 保持稳定批量计算偏移，末窗缩小请求，达到 1000 终止；单次批量同时受 50 上限约束。`tests/integration/source-read-contracts/v2ex.test.ts` 使用真实搜索链，HTTP 替身执行[官方服务端校验](https://raw.githubusercontent.com/gexiao/sov2ex/v2/pkg/server/handler.go)。 |
| 失败 oracle 与关闭证据 | 修复前普通红在最后 10 条请求收到 400；修复后 960/30 → 990/10 → 无下一页，超过窗口零请求，普通分页和筛选仍通过。确定性协议边界已验证，不将浅页 Live 当作第 34 页实证。 |

## `REG-OPS-021` 正式发布继承开发 ENTRY_FILE 覆盖生产入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01` |
| 历史症状与根因 | 发布普通子进程环境只删除签名变量，保留 ENTRY_FILE；React Native Gradle 插件优先使用该环境变量。真实 Gradle 配置取证确认生产 bundle task 可被导向 dev/forum-selection-proof/index.tsx，空值也被透传。不宣称已经签名或发布错误包。 |
| 当前 owner | 在现有共享子进程环境净化函数移除 ENTRY_FILE（含 Windows 混合大小写），签名变量恢复仍仅发生于签名阶段。`tests/tooling/release-environment.test.ts` 检查实际两阶段环境，保留 unsigned validation 顺序与签名隔离断言。 |
| 失败 oracle 与关闭证据 | 开发路径、空值、混合大小写三项普通红转绿；相关 tooling 70 项通过（seed `20260920`）。真实 Gradle help 使用修复后 assembleRelease 的环境，bundle task 入口为生产 index.ts，未执行正式发布或签名。 |

## `REG-NOTIFY-075` 私信写请求在代理准备后越过失效的身份检查

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`；共享 `ACCOUNT-01`、`MORE-01` |
| 历史症状与根因 | 2026-09-20 全仓审查确认：notificationGateway 的 accessFor 只在调用 fetcher 前后异步检查身份。真实 networkProxyFetcher 内部还要等待代理准备，等待期间访问授权失效但 signal 尚未取消时，最终 HTTP 仍可发送，返回后才报告账号状态已变化。这是 `REG-WRITE-082` 已修复 Topic/签到入口之外的通知 sibling。 |
| 实际触发窗口 | Account 的 beginAuthSurface 先同步改认证 surface ref，再排 React 更新；notificationPrivateAccessAllowed 立即读到阻断，NotificationRoute 却要等 canAccessSource/失焦的 effect 才 abort。同一账号/epoch 即可出现这段窗口；若取消已先完成，既有 signal guard 有效，不推断所有切账号都会发送。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` 运行真实 notification gateway、NodeSeek adapter/action client 和代理 runtime；`src/sources/notificationGateway.test.ts` 展开逐条/全部已读、两站上传及妖火回复；仅替换存储加载、Native 与最终 HTTP。全部为普通行为测试。 |
| 失败 oracle 与边界 | 代理状态加载 pending 时发起私信回复，进入代理等待后把 privateAccessAllowed 设为 false；释放准备后，预期零 HTTP，实际向 `/api/notification/message/send` POST 一次，再抛出账号状态已变化。普通测试 seed `20260920` 因零发送断言失败；未向真实站点发送消息。其他共用 accessFor 的写操作需在修复时展开，不能直接把本反例算作它们已验证。 |
| 处置与关闭证据 | 前台来源/身份授权回调收紧为同步判定，共享 accessFor 复用 withRequestBeforeSend 把当前授权检查送至代理准备后的最终 dispatch；保留响应复核、诊断、取消和 401 语义。原真实代理反例与六个真实 adapter sibling 证明失效零写入、有效正常发送；撤去最终守卫时六例全部转红。定向 Vitest 143、UI 132 项固定与随机顺序均通过。实际远端发送、已读和上传本轮未执行，不将受控 HTTP 记为 Live。 |

## `REG-SEARCH-030` 排除词搜索截断已消费页中的合法结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01/02/03/04` |
| 历史症状与根因 | 2026-09-20 全仓审查确认：`searchRead` 在查询含排除词时把 adapter limit 放大至三倍，再把过滤结果截回原 limit，却沿已经消费完放大页的上游 nextPage 继续读取。被截掉的合法结果不会出现在后页。随后匹配 APK 的 Live 又确认三倍请求把 V2EX size 从 30 放大至 90，超过上游 50 上限并收到 HTTP 400；只删除尾部裁剪不足以闭合真实链路。 |
| 当前 owner | `src/sources/searchRead.test.ts` 运行真实 V2EX/linux.do reader，并覆盖聚合消费；`tests/ui/search/search-controller-ai.test.tsx` 从真实 controller → managed gateway → HTTP 证明概览切单站再读至终页的结果守恒，并拒绝超过官方 size 上限的请求；`tests/ui/search/search-screen.test.tsx` 证明空中间页手动继续与无自动续页。全部为普通行为测试。 |
| 失败 oracle 与边界 | 查询 `keep -excluded`、limit 2，上游 8 条全合法，读到终页仅收到 1、2、7、8，丢失 3–6；固定 seed `20260920` 普通测试因结果不守恒失败。生产单站 V2EX limit 30 同样进入该分支；其他来源共享截断 seam，但本次没有原站 Live 样本。 |
| 处置与关闭证据 | 删除三倍过取、共享单站后过滤及聚合合并的二次截断；limit 保持调用方批量，消费一页后交付全部合法命中，概览仍裁为两条。空中间页用既有 hasMore/nextPage 提供手动继续，不自动扫描、不增加缓存或跨层字段。V2EX/linux.do、聚合、HTTP 参数边界与真实页面链均有修复前红例；110 条原始结果最终保留全部 94 条合法命中且旧列表保持完整前缀。完整自动与设备结果见 [2026-09-20 修复记录](review-remediation.md)。 |

## `REG-FEED-033` 匿名不可用来源使聚合首页持续空分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01` |
| 历史症状与根因 | 2026-09-20 全仓审查确认：聚合 Feed 为当前不可用的来源持续保存原页重试 cursor；其他来源到达末页后依然返回 hasMore，外层 page 每次增加而 cursor 不变。gateway 隐藏匿名妖火的预期授权错误后，页面只见可继续加载的空成功页。 |
| 当前 owner | `src/sources/readGateway.test.ts`、`src/sources/feedRead.test.ts` 运行真实 read plan、gateway 与聚合读取；`tests/ui/feed/feed-controller-session.test.tsx` 覆盖匿名终止、登录恢复与退出移除，全部为普通行为测试。 |
| 失败 oracle 与边界 | 只启用 linux.do 与妖火、两站匿名、linux.do 返回合法空终页；两轮均 items 空、errors 空、hasMore 为真，page 2→3 而妖火 cursor 固定在页 1，实际网络只有一次。普通测试固定 seed `20260920` 因无法到达终态失败。未做设备或 Live 验收，不把逻辑空分页推断为原站请求风暴。 |
| 处置与关闭证据 | 聚合请求、旧 buffer 与 cursor 只包含当前 ReadPlan 可读取的来源，删除对 unavailable 来源制造伪请求失败并保留重试页的路径；真实网络失败/超时继续保留重试页。凭据 epoch 变化沿既有 Query scope 重建计划，不增加 UI 页数上限。Gateway 与真实 Feed controller 红例转绿，负向撤去过滤后两者均转红；定向 Vitest 固定 112、扩展随机 121 项，UI 固定 49 项通过。主设备不退出账号制造匿名状态，该分支由受控 owner 验证。 |

## `REG-NAV-006` 迟到的启动链接覆盖新的链接目标

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02/03` |
| 历史症状与根因 | 2026-09-20 全仓审查确认：`useAppDeepLinkNavigation` 的 getInitialURL 只判断组件是否仍挂载；较新的 warm URL 已到达后，旧 initial URL 仍可执行。导航已就绪时旧目标再次压栈，未就绪时旧目标覆盖 pending destination。 |
| 当前 owner | `tests/ui/app/app-deep-link-navigation.test.tsx` 使用真实 hook 与 URL parser；普通 cold/warm、四站完整目标、pending→ready 与交错时序共同由普通行为测试拥有。 |
| 失败 oracle 与边界 | warm 主题 222/#9 先到，cold 主题 111/#3 后返回，再把导航设为 ready；最终错误打开 111/#3。普通测试 seed `20260920` 为 12 通过、1 预期断言失败。另一个临时探针确认已 ready 时也会覆盖；未做 Android intent 实境重放。 |
| 处置与关闭证据 | 在同一订阅生命周期内记录是否已接受有效目标，迟到 initial URL 不覆盖它；每个新有效目标先结算并清除旧 pending，卸载时清空残留；不支持的 URL 不废弃有效启动目标。导航未就绪/已就绪的两个迟到 cold 场景及 warm 已打开后重放旧 pending 的三个普通红例均转绿。该 owner 固定 seed 16 项通过，连同导航组合随机 seed 31 项通过；没有增加跨页面导航状态或兼容层。 |

## `REG-WRITE-090` NodeSeek 新回复定位到旧的同文回复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 2026-09-18 在已登录主模拟器的 `post-856117-1` 只加载第一页后发送「测试」，新回复实际为 #32，App 却定位到旧的 #19。原站有 `postPageCount=4`，但没有总回复数；代码把已加载的最高楼层 10 当成尾部，猜测新回复在第二页，再以账号和相同正文命中旧评论。该路径由 2026-09-01 的 `71eca0367748205200d8c4718c225dd17211a87b`（v1.3.132，关联 `REG-WRITE-074`）引入。 |
| 处置 | 解析成功 POST 的 `redirect + redirectHash`，直读服务端确认的新回复所在页，回读唯一楼层并取得 commentId；复用已有定位与相邻窗口加载，保持当前正倒序，取消猜页和正文匹配。无法确认时保留旧窗口，不重发。 |
| 当前 owner | `src/sources/nodeseek/actionRequest.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`（真实 NodeSeek reader）。 |
| 失败 oracle 与边界 | 修复前正倒序目标窗口用例失败（seed 839305153）；修复后验证缺失总回复数、同文旧回复、并发他人回复、唯一定位、相邻页连续加载至第一页且无重复；缺失目标、目标不匹配及离线保持旧窗口。linux.do 共用确认目标路径的既有用例通过。相关解析/读取 239 项与 UI 279 项通过；`STATIC_PASS`：类型、定向 lint、架构、格式、文档及 diff 检查。 |
| 模拟器验收 | `APK_SANITY`：主 AVD `emulator-5554` 同签名覆盖安装正常入口开发包 1.3.146/150（SHA-256 `2dea7587f23b9125b793c48aa5c117aab0a49c7d719de853bc0c324b33c2c62b`），首次安装时间仍为 `2026-07-26 16:51:37`，网站登录 3/3。`LIVE_PASS`：用户授权的同一测试帖，正序只读第一页后提交得到 #33，末页保持 31→32→33，向上加载可回到 #1；倒序再次提交得到 #34，保持 34→33→32→31，继续向下读取 #30。并发他人回复由真实 reader 的受控用例验证，未制造原站并发写入；其他站点本轮无 Live 写入。 |

## `REG-WRITE-089` 提交成功后面板残留及全屏顶部露底

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/05`、`NOTIFY-02`；关联 `WRITE-04` |
| 历史症状与根因 | 带键盘回复确认成功后业务已关闭、草稿已清空，但屏幕残留高度等于 IME；先收键盘正常。BottomSheet 5.2.14 未观察 closed detent 的变化，读取 detents[-1] 提前退出，容器变化只追踪 GESTURE 关闭；直接定位又在记录目标后 stopAnimation，丢掉目标索引与完成回调。全屏 topInset 把整个背景下移，生产根布局 statusBarScrim 还会覆盖嵌套 route 内的全屏背景。 |
| 逃逸原因 | 原测试直接完成 session 或断言 close()，没有经过生产按钮/响应解析，也没有在真实 IME 动画与 App 根布局中核对屏幕和重开聚焦。新增用例另外发现旧主题键闭包、迟到 snapshot 恢复已发送正文及测试模式存储串扰。 |
| 处置 | 依赖 source/CommonJS/module 同步补丁，关闭中重新打开可中断旧动画，重复关闭不重复结算；全屏内部安全区、同一 WebView 与根 Portal，Portal 随 routeActive 隐藏；文档代次隔离旧消息，超时请求丢弃，初始化在途去重；异步 Topic 完成同时核对 committed 当前键和编辑会话。立即重开可能稳定在原索引而不触发 onChange，额外观察索引及动画完成状态，仍由同一个每次打开首次聚焦门禁结算。 |
| 当前 owner | `tests/ui/topic/composer-submission.test.tsx`、`src/ui/composer/editorRuntime.test.ts`、`tests/ui/topic/composer-keyboard-viewport.test.tsx`、`dev/composer-proof/`、`scripts/run-composer-device-proof.mjs`、`tests/tooling/composer-device-proof.test.ts` 与既有 native Composer 两类测试。 |
| 失败 oracle | 修复前 tracked 回放确认普通/全屏带键盘均在业务结算后仍有 Bottom Sheet；无键盘对照无残留。顶部背景起点为 63 px；实际根布局另检测到状态栏底色 seam。先只修关闭，普通转绿且全屏仅剩顶部失败。负向控制撤掉关闭后布局修正，再次检测到业务结算/正文空/键盘隐藏但面板可见；恢复旧 topInset，再次检测到顶部 63 px 偏移。控制包的自动定位/冷启动异常不计为产品红例，经当前 token/buildId 校验后从真实按钮继续并运行同一几何 oracle。UI 的旧快照/过期请求/换主题及同主题新会话、迟到聚焦回调、inactive route 的 Portal 保护均有修复前失败。 |
| 验证边界 | `STATIC_PASS`；`UNIT_PASS`：完整 2,637 项、最终增量设备 oracle 5 项及原生 IME/Insets 4 项；`UI_PASS`：79 套 / 1,612 项（seed 1757504483），生产提交 owner 48 项。`DEVICE_REPLAY_PASS`：同一匹配源码的 Release Hermes Mock 包完整 40 项、定向重开/失败保稿 6 项、大挖孔 3 项；实际 cutout 顶部 Insets 为 136 px，覆盖深浅全屏及 5 倍窗口动画下立即重开。旧 overlay 虽启用但实际 Insets 为 0 的回放未计入挖孔证据。关闭及顶部负向控制均检出失败，独立干净安装的补丁正向应用、postinstall、反向校验通过。全部发送为 Mock；物理设备与真实来源写入 `NOT_VERIFIED`，不以模拟器替代真机结论。 |

## `REG-TOPIC-166` 音视频回拖反复加载与缓冲期间无法控制

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 本轮指定视频播放/跳转与音频短时播放/暂停跳转未复现数秒停顿；原始偶发症状和完整来源矩阵仍未闭合。 |
| 2026-10-04 复核 | 普通 Release 1.3.150/154：妖火 bbs-1581015.html 的 12 秒视频到达结尾，结束后跳至约 6 秒并继续播放，进出全屏可用；linux.do 2825663 的 #3 音频时长 4:18，采样进度 0:05/0:10/0:16/0:21，暂停后前后跳至 2:09/0:12。证据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 video-live、video-fullscreen-seek、audio-live 录像及 audio-t*/audio-seek-* 快照。音频脚本最后一次恢复播放采样被后续打开回复的操作打断，该段不计独立通过；没有以这批短样本关闭间歇停顿，也未量化四站、完整后台返回、目标帧/AudioTrack 或物理设备。 |
| 能力 ID | `TOPIC-02`；共享 `TOPIC-01/03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | 用户报告已加载视频回拖仍转圈、中央图案过大。代码确认音视频未启用磁盘缓存，视频把后续 loading 重新覆盖为首次 poster，音频缓冲时禁用暂停与 seek，ready 后没有播放阶段预算。原生 bufferedPosition 在缓冲时被报为零，播放意图与实际 playing 混用；真实来源数秒停顿的网络/解码占比尚未分离。 |
| 处置 | 保留 Expo Video/Media3 与原生 controls，Topic 播放协调统一互斥、进度、30 秒无进展预算、暂停/后台和全屏生命周期。启用 256 MiB LRU，SHA-256 身份包含来源/会话/Referer/表示请求头且排除网络代；缓存故障允许回源。原生视频不再请求或展示 HTML poster，首次 loading 等待真实首帧，缓冲仍可控制，失败手动重试取得当前网络代。中央图形去掉实心圆；用户设备反馈后保留更易识别的 40/48 dp 图标与 56 dp 触控范围。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/topic-media-coordinator.test.tsx`、`src/platform/media/mediaPlaybackSession.test.ts` 与既有媒体请求 owner；Native 缓存、真实 seek 和控件由 Expo Video patch 的 `ReaderPlaybackInstrumentedTest` 承接。 |
| 失败 oracle | 修复前 poster/缓冲中控制/健康音频切代三项 UI 失败（seed 92947533）；补查视频手动重试仍取旧网络代，修复前失败（seed -1161124266），修复后两组媒体 UI 共 169 项通过（seed -980341200）。Native 负向控制中禁用缓存的重复 Range 两次回源，启用后完整缓存区间重复 seek 零新增上游。 |
| 验证边界 | `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`：完整 verify 通过（2529 unit、1439 UI），最终增量 169 项媒体 UI 和 44 项 unit/patch owner 复核通过。`APK_SANITY`：fresh prebuild 与开发签名 x86_64 Release 编译；保留数据覆盖安装，首次安装时间未变。独立 Native 六项实际测试通过，覆盖 Range、身份/Referer 隔离、淘汰、故障、音视频 seek 与目标帧；受控 MP4 六次目标帧恢复为几十毫秒且无新增上游字节。`LIVE_PASS` 仅限匹配 APK 的妖火主楼 `bbs-1581015.html`：暂停中 0→6 秒、结束后 12→2 秒，播放中全屏往返后仍显示 Pause 且 2→4 秒；后台返回停在 10/12 秒，等待手动继续。最新按钮设备截图确认已放大且没有实心圆。这不代表四站全链路通过。 |
| 首帧补查 | 2026-09-14 用户再次报告已加载视频仍黑屏。确认 ForumContentVideo 误将 readyToPlay 当作已绘制首帧；原测试也要求此时撤下 poster。canonical UI owner 改为先保留 poster、再发实际 onFirstFrameRender；修复前失败（seed 2107668605），修复后与 coordinator 共 169 项通过（seed 208410000）。复用 Expo 现有首帧事件，标记按 player 隔离，seek 不重盖封面。两个已知妖火样本在改动前都有画面，当时尚未确认本次黑屏样本；不得把时序修复当作该黑屏已复现或全部解决。类型、lint、格式、架构、文档和开发 Android 构建通过；新包覆盖安装返回 INSTALL_FAILED_INSUFFICIENT_STORAGE，/data 剩余约 409 MiB，首次安装时间不变，未清应用数据。此首帧增量的匹配 APK Live 为 BLOCKED_BY_ENV，设备仍保留上一轮包。 |
| 临时封面与闪烁补查 | 用户随后确认仍为妖火 `bbs-1581015.html`，并要求加载时只显示 loading。移除原生视频的 poster 请求与覆盖层，HTML/虚拟视频行共用该行为；保留实际首帧事件作为首次 loading 的结束信号。修复前 HTML poster oracle 失败（seed -1594374434），修复后媒体 UI 168 项通过（seed -671783530），类型检查通过。旧 APK 的同链接录屏覆盖播放、结束和重播，33.2 秒录像未捕获黑帧，不能据此否定用户闪烁，也不将此次封面删除宣称为闪烁根因修复。用户先取消扩容，随后授权仅改配置试验：将同一 AVD 的 disk.dataPartition.size 从 6G 改为 16G，保留数据冷启动后 hardware-qemu.ini 已读取 16g，但 /data 仍为 5.8G；未自动扩展现有磁盘/文件系统，网站登录及自动填入均保持 3/3。最新增量 lint、架构、文档与开发 Release 编译通过（APK SHA-256 `f99b43f206d8d3bb2c6628f8a7137dc8e6e470e439b606db5825beaf93372717`）；再次覆盖安装仍返回 INSTALL_FAILED_INSUFFICIENT_STORAGE，故该增量设备/Live 验收为 `BLOCKED_BY_ENV`。首次安装时间保持 2026-07-26 16:51:37，设备仍为 13:32 的旧包；原有网站登录 3/3、自动填入 3/3，无清数据或扩盘。播放闪烁根因与新包真实首帧行为仍为 `NOT_VERIFIED`。 |
| 扩容后补验 | 用户随后授权保留数据实际扩盘。2026-09-14 同一 WZ_Pixel_API_35 的 QCOW2 当前内容经完整备份、逐字节 compare 后扩为 16 GiB；Android 加密映射识别新大小，ext4 在线扩容受保留块元数据限制，改为卸载后 resize2fs，并由 e2fsck 修正扩容 inode 7 的大小，最终完整校验为 clean。重启后 /data 为 16G、剩余约 10G。上述 SHA 的修复包成功覆盖安装，lastUpdateTime 为设备报告的 2026-09-14 14:25:51，firstInstallTime 保持 2026-07-26 16:51:37；网站登录和自动填入均 3/3。仓库 runApkSanity 实际通过，解除新包的空间环境阻碍。`TOPIC-02` 的 `LIVE_PASS` 仅限同一妖火 bbs-1581015.html：未播放时已有实际首帧，0→12 秒播放结束，结束后 seek 到 4 秒恢复 Pause/播放状态；13.1 秒录屏按 10 fps 采样未捕获黑帧，不能据此关闭间歇闪烁，真实长时间停顿根因仍 `NOT_VERIFIED`。本次未重跑全屏、后台和音频链路，不将旧 APK 的 Live 证据继承为新包全链路通过。 |
| 真实音频补验 | 2026-09-14 用户要求继续 CF 验证后，在相同 APK 中完成复选验证并点击「检测状态」，恢复 linux.do `t/topic/2825663`；没有清 Cookie 或重新登录。`LIVE_PASS` 限第 3 楼 4:18 音频：进度 0:00→0:21，暂停中 0:21→2:09→0:22，播放中三次连续跳转后 2:23→2:28；Android 同 App UID 的 AudioTrack 为 started、48 kHz、未静音。滚到底部、音频卡不可见时音轨保持 started；后台返回后停在 3:00，等待手动继续。4:16 播到 4:18 后音轨 stopped，回拖到 0:22 后恢复并推进到 0:43；离开 Topic 后对应音轨释放。未复现本样本长时间转圈。Windows host 的音量探针不支持此 Android emulator，未作实际听感/音质结论；卡片不可见不能单独证明 FlashList 已执行物理回收，回收 owner 仍由 UI 测试承接。 |
| 历史重进与整页闪烁补查 | 用户给出「历史重进」稳定入口后，旧包三次回到同帖均为 0:00 黑屏；原生 READY/首帧事件已发出但 TextureView 为黑，点击 Play 或暂停中切全屏立即显示有效帧。改为 VideoView 非零布局后加载，诊断包连续三次历史重进显示真实首帧；切换 SurfaceView 未解决，撤回试验。立即加载负向控制实际失败；排查用 cached paused frame 原生实验仅证明受控源首帧，不能独立复现 App 历史入口竞态，后续清理已移除；真实 seek/目标帧由原有原生 owner 承接。完整调用栈及父链进一步确认，退出全屏约 150 ms 内，TopicRoute 门禁容器和主楼 selection nativeID 容器同时发生 Fabric flatten/unflatten，同一 VideoView 两次 detach/attach，销毁 SurfaceTexture；单独固定任何一层仍闪，两层同时 collapsable=false 后原生实例与表面保持，暂停/播放缩回录屏未再出现两次闪白。GitHub 的 [TextureView reparent issue](https://github.com/kirillzyusko/react-native-teleport/issues/165) 在 RN 0.86 / Expo Video 57 报告相同输出表面机制，提供旁证，不替代本机 oracle。窗口切换仍独立验证：原生 SurfaceView/不透明窗口恢复后出现黑色矩形与入场空窗，关闭启动预览又露出桌面，均不作为通过方案。最终保留 TextureView、宿主窗口与提前配置的 Activity 切换；进入全屏以当前已显示视频帧覆盖输出交接间隙，实际目标首帧后的两次动画帧回调清除。最终开发签名 APK 1.3.143/147、SHA-256 `7ac4e3ca63d9c6187fdb8982efe448b837cab10deb12a8f0d8caccbd7bd90ecf` 完成覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`。同帖三次历史重进均显示真实首帧；30 fps 录屏检查暂停及播放中的进入/退出，无黑白空帧；暂停 0→6→2 秒，播放缩回后 2→4 秒，结束后 12→6 秒可继续；全屏播放时 Home 再返回停在 7 秒，稍后复查仍为 Play/7 秒。上述 `TOPIC-02`、`NAV-03` 为此指定入口的 `LIVE_PASS`；对应 UI 187 项（seed 703715178）、unit/patch 15 项、Native 7 项、typecheck/lint/format/architecture/docs、隔离 pristine postinstall 与 Release/native-test 编译通过。无原生 crash 记录；其他来源及设备仍按关闭条件保留证据缺口。 |
| 后续清理与测试包 | 2026-09-15 删除视频组件对播放协调器的重复状态/缓冲转发及单行包装函数；移除不能复现历史入口竞态的原生布局实验，保留首帧布局 UI 与 Native 缓存/目标帧 owner。清理后 `STATIC_PASS`、`UNIT_PASS`（15 项）、`UI_PASS`（187 项，seed -1000043691），Native 六项、pristine postinstall 与补丁反向检查通过。同源码开发签名 x86_64 包保留数据覆盖安装获得 `APK_SANITY`。提供沿用固定签名的 ARM64 本地测试 APK 1.3.143/147，SHA-256 `afee612457ed5f498c03037817859d7c5208e3ec80a4a8cae947f5c025acbcc9`；已核对签名、ABI、内置 Hermes 与 ZIP 对齐，不递增版本或执行正式发布。真机实际播放仍 `NOT_VERIFIED`。 |
| 关闭条件 | 用户原始数秒停顿场景仍缺同条件网络字节/实例/目标帧关联；四站主楼、回复、展开引用、采纳答案的真实音视频、不同横竖比、深浅色/字体缩放及物理设备手感未全部覆盖，标为 `NOT_VERIFIED`。本条保持 OPEN，不把受控缓存命中或转圈消失当作所有真实来源卡顿已解决。 |

## `REG-TOPIC-165` 妖火审核提示页被渲染成空帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`，共享妖火只读 transport、`WRITE-01` 入口 |
| 历史症状与根因 | 用户给出妖火帖子 `1580807`。模拟器 App 登录态原站返回独立「提示信息」页，正文提示「正在审核中！」；详情解析把页面标题当作有效主题，填入当前时间，显示未知作者、空正文和回复入口，回复读取再报普通窗口为空。 |
| 处置 | 共享只读响应边界在登录检查后识别独立提示页，抛出携带站点提示的错误，复用详情与回复既有失败展示；无已加载详情时隐藏路由占位头部，仍保留已有可信详情。真实正文内引用的提示样式不触发；日志只记闭集原因 `site_notice`。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` 的主题、回复与正文引用行为；`tests/ui/topic/topic-reply-filters.test.tsx` 的提示页展示和回复入口；`src/platform/diagnostics/diagnostics.test.ts` 的脱敏原因。 |
| 失败 oracle | 修复前读取审核页返回带空作者、当前时间和「提示信息」标题的 TopicDetail，期望拒绝的测试失败；修复后保留原站提示并停止额外收藏读取。 |
| 验证边界 | `UNIT_PASS`：来源和诊断 199 项；`UI_PASS`：提示页、可信内容保留与头部相关 8 项，补强作者节点断言先红后绿。`STATIC_PASS`：typecheck、lint、架构和文档检查。`APK_SANITY`、`LIVE_PASS`：匹配 APK 在保留登录态模拟器直达同主题，提示正确、无占位头部及回复入口，重试后仍正确；持久日志保留 `site_notice`。物理真机与其他原站提示分支 `NOT_VERIFIED`。 |

## `REG-ACCOUNT-051` 仅 App 阅读后原站访问记录与等级未更新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已解决。2026-10-04 用户确认每日访问统计现在能够正常计入，本条据此结案。Present 与 XHR 协议修复和既有上报证据保留；下方统计未闭合结论属于此前阶段，本次未新增原站统计或 Live 验证。 |
| 能力 ID | `ACCOUNT-01/04`、`TOPIC-01/03`；共享 `NOTIFY-01` transport |
| 历史症状与根因 | 2026-09-14 用户报告当天未使用网页，仅 App 阅读后访问记录与等级未更新。已确认账号检测与 timings 缺少 `Discourse-Present`，Reader 却固定为 true，等级 JSON 还缺 XHR 标识；这是活跃语义不一致的协议缺口，不能据此断言等级统计只有这一处原因。 |
| 处置 | App 在现有代理就绪之后、实际 fetch 之前装配来源修饰函数，精确匹配 linux.do XHR；前台且最近真实交互不足 60 秒才带 Present。复用 AppState 和一个进程内单调时间戳，移除 Reader 固定头；保留访问、阅读计时、批次、取消和重试语义。JS 修饰后与 Native 实际 request-headers-end 记录同请求 ID 的布尔值。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` 的真实 Account/reading/transport 组合；`src/sources/linuxdo/presence.test.ts`；`tests/ui/app/app-lifecycle-request-timeout.test.tsx`、`tests/ui/shared/modal-sheet-frame.test.tsx`、搜索与结构化编辑器既有 UI owner；模块内 `NetworkProxyRuntimeTest` 实际发送头诊断。 |
| 修复证据 | 修复前组合链三次实际请求的 Present 均为 null，期望 true 的行为 oracle 失败；修复后通过。59/60 秒、后台/未知/恢复、等待代理、CSRF 重试、请求内容及诊断关联另有协议与 UI 证据。 |
| 本次验证 | `STATIC_PASS`：lint、typecheck、架构与文档检查。`UNIT_PASS`：相关来源/阅读/诊断/编辑器 199 项（seed 1789351803825），补充通知隔离与取消 35 项（seed 1789351933894）；fresh prebuild 后 Release Kotlin 编译及 Native 诊断 6 项通过。`UI_PASS`：Account、阅读 transport、生命周期、Modal、搜索和编辑器 113 项（seed 967150168）；新增通知 transport 与组合层复核 69 项（seed -518922577）。各轮含重复 owner，不相加作独立测试总数。 |
| 可见模拟器补验 | 2026-09-14：`WZ_Pixel_API_35 / emulator-5554` 以保留数据冷启动恢复旧 Quick Boot 的 heartbeat=0/ADB offline。开发签名 x86_64 Release `1.3.143/147`，buildId `a4d4611c74714381b5b9c92be017b2d8`，APK 与设备 SHA-256 同为 `a7ada10674d058285a7d8a00f1b5b86dc72f9010f6d671cdc29bb287632460e9`；仅覆盖安装，证书一致，`firstInstallTime=2026-07-26 16:51:37` 不变。`LIVE_PASS` 仅限标记发送：前台账号 `request-23/trace-56` 与通知 `request-15/trace-42` 均在 JS transport 和 Native request-headers-end 记录 Present=true；独立后台认证请求 Native Present=false。进入 More、展开账号、切站和刷新按钮可操作。 |
| 初次设备阻碍（已解除） | 最初为 `BLOCKED_BY_ENV`：新包启动后首次 Cookie barrier 在任何来源响应前即为 hasLoginCookie=false、hasCfClearance=true；后台认证和前台账号检查均返回 404，通知返回 403。UI 原先恢复的「已登录」缓存经核对变为「已验证/登录后查看」。缺失登录 Cookie 的发生时点和原因未知，不能归因于本次修复或声称已保留有效会话；未卸载、清 Cookie、清数据或自动重新登录，发现差异后冻结设备变更，只读取证。 |
| 用户重新登录后的补验 | 同日用户手动恢复 L 站登录后，保持同包与可见主 AVD，`LIVE_PASS`：新普通帖主楼的 8 批 timings 均携带登录 Cookie、Native POST 200，并由 JS 单次正文消费确认；共提交约 304635 ms。首次 `request-56` Present=true，无操作约 63 秒后的 `request-57` 为 false，滚动/长按后 `request-66/67` 恢复 true；后台尾批 `request-68` 为 false，约 51 秒后台期间没有新增 timings，返回前台通知立即为 true，恢复后的首批 `request-77` 仅约 15954 ms，未补入后台时间。上述 Present 均由 JS 与 Native 相同请求 ID 交叉核对。独立 PopupMenu 静置超过 60 秒后点击刷新评论，`request-78` 恢复 true。纵滚、正文长按和跨段拖动选区、原生评论查找输入与清空、WebView 富文本输入均可操作；本次编辑器临时文字已清至 0 字符，发送保持禁用，没有发表或互动写入。 |
| 原站统计结果 | 同次 App 阅读前后，官方 Connect 的浏览帖子 `1744 → 1745`，访问天数 `44 → 44`、浏览话题 `221 → 221`；确认新帖子统计有增量，不能外推其他统计也已更新。summary 活跃数据仍为访问 112 天、话题 285、帖子 2034、时长 4 小时 47 分。客户端刷新确实发起并完成 summary GET；[Discourse 上游 UsersController.summary](https://github.com/discourse/discourse/blob/main/app/controllers/users_controller.rb#L474) 对此 JSON 使用一小时服务端缓存，该差异与其一致，但没有当前 L 站部署缓存期限的直接证据。不得追加请求绕缓存或把旧 summary 当作上报失败。 |
| 原站网页对照 | 同日按用户要求，从 More 的「检测或重新登录」进入已登录原站 WebView，打开一个新建、单主楼、初始明确显示「帖子未读」的普通 Lv1 话题并停留阅读；未读标记随后消失。UTC 03:03:13 基线与 03:06:49、03:07:59 两次返回刷新均为 Connect 帖子 1745、话题 221、访问 44 天；summary 仍为 112/285/2034/4 小时 47 分。`LIVE_PASS` 仅限网页请求观察：通过只读 CDP 监听捕获 03:06:05 的网页原生 POST `/topics/timings`，Present=true、Background=true、XHR=XMLHttpRequest，表单包含 `topic_id`、`topic_time=60000`、单楼层 `timings=60000`，响应 200；与 App 已核对的关键头、字段一致。网页 Content-Type 额外声明 UTF-8、表单字段顺序及毫秒取值不同，没有证据表明这些格式差异导致入账差异。本次网页也没有即时 +1，不能据此认定 App 仍缺协议字段；网页最终入账与 Connect 展示刷新机制仍为 `NOT_VERIFIED`。监听未修改请求、页面或缓存，临时 ADB 转发与监听进程已清理。 |
| 关闭条件与未验范围 | `NOT_VERIFIED`：仅 App 触发当天首次访问、最近访问时间的独立前后对照、访问天数入账及 summary 缓存过期后的最终数值。此次用户重新登录已经经过网页流程，无法作为干净当天样本；按 runbook 另取首次 App 访问前无 Present 的 XHR 基线，再仅 App 阅读未读普通帖。问题仍为 OPEN，不能以此次 POST 200 或帖子 +1 关闭每日访问事故；窗口天数也不能机械要求 +1。设备手势证据仅来自模拟器注入，不代表实体手机手感。 |

## `REG-ACCOUNT-050` 阅读上报遇到 CF 验证后静默丢弃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`ACCOUNT-02`；共享阅读状态和 Cookie 交接 |
| 历史症状与根因 | 2026-09-13 用户手机 1.3.143 日志中，同一构建阅读上报 134 次失败、25 次成功；失败为 132 次 403 HTML 与 2 次 429 HTML，均被识别为 CF 验证。action client 已识别挑战，但 reading hook 未接验证面板；队列丢弃该批次并继续处理后续阅读。再次触发 CF 的具体服务端原因没有充分证据，不能归因于固定标识缺失。 |
| 修复 | 现有 runtime 同步暂停并保留被拒绝增量，复用验证面板及 Cookie 交接；显式检测后刷新 CSRF，原样补发，成功才继续。取消、后台、过期、身份切换和再次拦截均有界处理，未知 POST 结果不重放。诊断补齐批次关联、CF 识别依据、通行 Cookie 存在/变化/一致性及三处 UA 摘要，不记录凭据。 |
| 当前 owner | `src/platform/query/discourseReadingRuntime.test.ts`、`src/sources/linuxdo/reading.test.ts`、`src/features/account/useVerificationController.test.ts` 与 `tests/ui/account/account-runtime.test.tsx`；诊断由现有 JS 导出和 Native Cookie/journal owner 承接。 |
| 失败 oracle | 修复前真实 Account runtime 接线测试 seed `292265768`：收到 CF 上报响应后验证面板仍不可见。修复后该行为扩展为等待 Cookie 交接、原样补发及保持账号代次的 UI 用例；runtime 单测独立覆盖暂停、限时、取消、后台和重复拦截；审查追加的三个失败场景（seed `1789268700`）为手动面板附加阅读未执行、原 Query 失效阻断阅读、CSRF 等待期间切后台仍补发。现由相同 controller/source owner 覆盖，另核对回到前台原样恢复及 CSRF 完成时已过期不发送。 |
| 验证边界 | 自动测试证明恢复与接线。2026-09-13 匹配构建覆盖安装后，模拟器新话题 POST 200；在已登录 App WebView 打开话题前，官网 JSON 已返回 1～4 楼已读、5～10 楼未读，页面随后对应 `read-state read`。Native 实发通行 Cookie 与共享存储一致，WebView/JS/Native UA 摘要一致；统计面板前后仍为 111 天、208 话题、1691 帖子，统计增长未获验证。未自然遇到 CF，真实 CF 恢复与实体手机表现仍为 `NOT_VERIFIED`，不以正常上报代替 CF Live 证据。 |

2026-09-14 未提交代码审查补充：关闭面板的 350 ms 收尾期间，排队中的阅读恢复被取消、替换或随 controller 卸载时，只结算了面板 Promise，未调用阅读 owner 的取消逻辑，导致旧 recovery 持续阻止后续阅读。修复复用现有取消 owner；`src/features/account/useVerificationController.test.ts` 的三个分支在修复前均因取消次数为 0 失败（seed `1789360754393`），修复后与阅读 runtime owner 共 55 项通过。此为受控取消证据，不代表真实 CF 放行或统计入账。

## `REG-TOPIC-162` 原生文字选择取消的 Promise 未被接收

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-03`；共享话题选择、横滑与返回 |
| 历史症状与根因 | L 阅读验收日志出现非致命 canceled/unknown 未处理拒绝。仅增强诊断的候选 SHA-256 `b015bd70738c470bc74796abbe618d0d0b81d749ce5dc4c09fbc8b360056cec4`，在模拟器 Library 普通进入 L 话题时于 2026-09-12 16:14:41.824（UTC+8）实际复现 `unhandled-rejection / selection-view-missing`。原生取消命令排到 MAIN 队列时视图已不可查；JS 将 AsyncFunction 错写成 void 且丢弃 Promise。方法名 cancelSelection 被旧 reason 归为 canceled，底层 ViewNotFound 错误码经 R8 变化又使分类成为 unknown；不是 timings 上报失败。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx` 通过实际 Surface/nativeRef 边界确认即时 Back 清理、拒绝后新选区/卸载安全与脱敏诊断；`tests/ui/topic/topic-table-rendering.test.tsx` 保留横滑准入；`src/platform/diagnostics/diagnostics.test.ts` 固定分类与脱敏。 |
| 失败 oracle | seed `61235`：整个选择 owner 原有 15 项通过，新增当前页面/卸载后两项拒绝因没有 cancel-command 诊断而失败。修正类型和共享 Promise owner 后选择与横滑 33 项通过。 |
| 修复边界 | 仅在现有取消入口接收并诊断原生拒绝；JS 拖动与 Back 反馈仍同步，无重试、全局吞错或新增状态机。保留被动取消，因为尚未触发的长按不由原生已形成选区时的 props 清理覆盖。原生选择算法、NS 业务、网络请求和通知返回链路均未改动。 |
| 自动门禁 | `UNIT_PASS`：205 files / 2457 tests，seed `1789201246306`；`UI_PASS`：75 suites / 1406 tests，seed `-1095380660`。全量 verify 的 lint/format/结构、架构 tooling、UNIT/UI、文档 tooling 与 docs 门禁通过；typecheck 发现新增测试 writer 意外返回 push 数值，改为 void 后另行通过 typecheck、unused、version、相关 lint/format 与 diff，`STATIC_PASS`。不是一次 verify 命令全程退出 0。 |
| 修复候选与模拟器 | SHA-256 `febd152a29c38f06742b25b3461e6577a652d137d0496bd6501d4c92764d162f`，1.3.142 / 146，开发签名 x86_64 Release/Hermes/R8。覆盖安装成功、firstInstallTime 保持 2026-07-26 16:51:37，账号回放确认登录态保留；四条 canonical Replay 均 `DEVICE_REPLAY_PASS`。 |
| 故障路径回放 | `LIVE_PASS`：匹配修复包从 Library 依次进入同三个 L 话题并返回，再对第三帖缓存重进、回主楼；此窗口与之后四条 Replay 的 unhandled-rejection、js-error、native-crash 均为 0。9 个 timings 批次分别匹配 Native POST HTTP 200 与 JS 空响应、0 字节，阅读上报继续正常。此有界回放没有重遇原生取消拒绝，拒绝分支由修复前 RED、修复后 GREEN 的实际 Surface/nativeRef oracle 覆盖，不伪称设备捕获了处理后的同一失败。 |
| 证据边界 | 增强诊断候选实际定位了同类故障，但不反推此前只有通用 CodedError 单帧的每一条旧事件。此次长按尝试未建立可观察选区，不计「选区激活后 Back」的 Live 通过；其同步反馈、旧拒绝不清除新选区和卸载安全由 UI owner 覆盖。原生选择几何、手感与故障矩阵没有重跑；未改原生实现。 |
| 关闭条件 | 实际原生缺失视图拒绝已有明确分类；共享命令的 Promise 所有权已修复，必要取消调用保留，拒绝不再逃逸到全局；匹配最终候选完成原操作路径与四条入口回放。 |

## `REG-TOPIC-161` L 站续读与可见阅读的生命周期错位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`NAV-03`；共享账号读取、Feed/Search/Library/User 进入 |
| 历史症状与根因 | 阅读功能复审中确认四项：旧评论缓存提前消费新续读目标；筛选后同一可见索引仍计入旧楼层；定位期间转后台使过期请求清空目标并改读首窗；共享 fetcher 配置变化重建 L 阅读 owner，序号归零却保留账号缓存，导致新服务端进度被当成旧响应拒绝。 |
| 修复边界 | 本次窗口确认后才定位；过期回调校验命令归属，未完成目标可恢复；数据替换后重新观察可见项；账号阅读 owner 使用最新提交传输但保留序号与批次。复用现有 owner，不新增状态机、逐卡请求或通知返回刷新。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`、`tests/ui/topic/topic-rich-text-selection.test.tsx`、`tests/ui/account/account-runtime.test.tsx`；最低行为 oracle 已取得修复前失败。 |
| 自动门禁 | `UNIT_PASS`：Vitest 205 files / 2457 tests，seed `1789198826030`；`UI_PASS`：Jest 75 suites / 1404 tests，seed `-307406569`。全量 verify 的 lint/format/结构、架构 tooling、UNIT/UI 与文档 tooling 通过；check:docs 发现本条字段名错误，修正文档后另行通过 check:docs、typecheck、unused、version 与 diff 检查，`STATIC_PASS`。不是一次 verify 命令全程退出 0。 |
| 本次候选与安装 | 2026-09-12 SHA-256 `35455b887fe28a1b7870c639c842d00171e55a275acdb7c61b4622f4988f8e4d`，1.3.142 / 146，开发签名 x86_64 Release/Hermes/R8。首次 Smoke 覆盖安装期间模拟器 system_server 故障、ADB Broken pipe，中止后未继续安装；同一 AVD 不加载或保存快照地冷启动，已安装 base.apk 哈希匹配候选，firstInstallTime 保持 2026-07-26 16:51:37，App 可启动且登录态保留。原 Smoke 不计通过；恢复后只读核对安装身份与实包哈希。 |
| 模拟器回放 | 此 SHA 的四条 canonical Replay（账号只读、四来源 Feed、Library 返回、多源 Search）均为 `DEVICE_REPLAY_PASS`。没有卸载、清数据、清 Cookie 或重置 AVD；模拟器保持打开。 |
| 本次实际阅读 | `LIVE_PASS`：同一进程两次进入均各有一次必要访问登记，头和参数完整；第二次复用缓存无评论 GET，返回 Library 后静置无新增 GET，4 个稳定内容矩形前后位置差均为 0 px。筛选「只看楼主」无需 GET，实际显示并上报 #6/#8，后续尾批只含 #6/#8，没有继续累计已隐藏的 #2。转后台约 51.093 秒，尾批后无请求；恢复后的首批话题时长约 1513.60 ms，没有补入后台时间。回主楼并实际向下拖动后产生一次必要的起始/前窗读取，不将其归为恢复前台反查。 |
| 本次发送响应 | 8 批 timings 均分别关联到 Native POST HTTP 200 与 JS 单次正文消费结果：空响应、0 字节。未将首批同 trace 的 CSRF GET 200 重复计为 POST。此候选未重新测量原站等级计数增长，实际统计证据仍按 REG-TOPIC-159 的对应候选保留，HTTP 成功不替代统计验收。 |
| 附带异常与证据边界 | 本候选 15:52:33.137（UTC+8）记录一次非致命 `unhandled-rejection`，reason=canceled、exceptionKind=unknown；匹配本包 source map 只能还原 CodedError 通用构造器，无业务帧，不能确认归属或宣称已解决。本包使用 RN fetch，Expo fetch 未进入 bundle；既有 Selection 原生取消命令是候选边界，未据猜测扩大修改。跨端新目标、删除楼层、定位中后台/刷新失败、传输配置变化与切号的竞态由上述 UI owner 覆盖，此次未逐项做 Live；既有 Native HTTP/2 故障矩阵没有重跑。 |
| 关闭条件 | 四项已证阅读缺陷均有修复前失败 oracle 与修复后通过证据；本包独立完成缓存返回、实际可见楼层、后台暂停、timings 响应与四条入口回放。未归属的附带异常保持证据缺口，不将本条关闭解释为全 App 无 Bug。 |

## `REG-TOPIC-160` L 站自动续读重复读取已加载评论窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`NAV-03`；共享 Feed、Search、Library、User 与通知指定目标入口 |
| 历史症状与根因 | 用户在阅读修复验收后指出重新进入像没有缓存。主楼 RAM 缓存仍存在，访问登记与最多一秒的决策等待也属于既有契约；但自动续读复用了显式定位的临时窗口清理，route 卸载删除已加载 replies Query，导致相同目标重复 GET。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` 的真实 reading runtime + QueryClient + 卸载重挂行为；采样复制与不可变状态由 `src/platform/query/discourseReadingRuntime.test.ts` 拥有。当前缓存与阅读规则见 product map。 |
| 修复范围 | 只保留普通 L 话题自动续读窗口，命中时校验原始失效状态；新目标或失效缓存仍正常读取。新进入主楼缺少起始窗口时从起点读取，不能用 reset 恢复过时内嵌回复；目标失败保留可读窗口，不附加 start。其他来源、私信、显式定位清理、访问登记、一秒决策与通知返回刷新规则不变。 |
| 失败 oracle | seed `171786632`：同目标重进 getReplies 实际 2 次、预期 1 次；seed `-1064714909`：保留中段后 opening/server-reset/invalidated 重进复用错误窗口；加入真实内嵌旧首批与目标失败后 seed `582578142` 又揭示 reset 复活旧正文、失败错误重建。修复后同 seed 的 5 个行为通过，并完成默认随机顺序全量测试。 |
| 性能检查 | 用户明确要求只移除不必要的请求与计算。确定性 oracle 在同话题预置 10,000 个已读楼层、固定可见楼层与锚点：修复前 6 次采样全表枚举 6 次、无共享状态更新；改为遇到新楼层才复制后，静止采样零全表枚举，锚点单独变化沿用原表，新楼层正常发布且旧快照不变。计时、访问登记、失效重读和批次提交节奏保留；不将受控操作计数当作设备 CPU/帧率测量。 |
| 自动门禁 | `UNIT_PASS`：Vitest 205 files / 2457 tests，seed `1789196463957`；`UI_PASS`：Jest 75 suites / 1393 tests，seed `238687877`。全量 verify 中 lint/format/结构与架构 tooling/UNIT/UI/文档门禁通过；随后发现测试夹具 true 字面量被扩宽，补全字面量类型后重新完成 typecheck、unused、version、相关 lint/format、docs 与 diff 检查，`STATIC_PASS`。未改生产行为规避类型门禁。 |
| 新候选与模拟器 | 2026-09-12 SHA-256 `244ae4c8dfe88984576ed0d4affab93d59a618039f32abbbe2b11f5e4ccd957b`，1.3.142 / 146，开发签名 x86_64 Release/Hermes/R8。首次 Smoke 因 ADB snapshot helper 超时中断，不计通过；同包重跑取得 `APK_SANITY` 与 Library 返回 `DEVICE_REPLAY_PASS`。firstInstallTime 仍为 2026-07-26 16:51:37，登录态保留。 |
| 实际请求与响应 | `LIVE_PASS`：新候选同一进程内四次进入同帖，各 1 次带完整访问标记的登记 GET，Native 均 HTTP 200；评论 GET 仅首入 target 1 次与第四次主楼 start 1 次，第二、三次复用缓存均为 0，同 route 回主楼也为 0。第四次实际展示 #2，必要起始读取未省略。10 个 timings 批次均通过关联请求确认 Native HTTP 200 与单次消费的空响应（0 字节），异常记录为 0。设备与宿主第四次时点约有 2 秒差，按同话题请求顺序关联，未混入切 Feed 请求。 |
| 位置与证据边界 | 正文内停留后重新进入，4 个不同内容矩形的位置差均为 0 px。另一次首可见区域在上一楼操作按钮间隙，内容锚点恢复到下一楼开头，4 处统一前移 180 px；未把该样本记作像素完全一致，也未扩大本次范围修改原有非负块内偏移规则。服务端回退、失效目标失败、跨端新目标与旧 seed 的边界由 UI owner 覆盖，不冒充此次 Live；未测设备 CPU 或帧率。 |
| 关闭条件 | 已匹配新 APK 证明缓存命中无重复评论 GET、必要访问登记和主楼起始读取保留、实际阅读仍上报成功；受影响 owner 与门禁通过，本次缓存重复请求关闭。 |

## `REG-TOPIC-159` L 站阅读没有计入原站统计与续读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`NAV-02/03`、`FEED-03`；共享 Search、Library、User、Account 与通知话题入口 |
| 历史症状与根因 | 用户长期在 App 阅读但原站浏览话题、阅读帖子与阅读时长没有相应增长。原先详情 GET 未明确登记 Track-View，缺少可见楼层 timings 链路；已读只靠正文成功后的本机历史，服务端阅读字段没有进入共享判断和自动续读。 |
| 修复范围 | 已接入访问登记、共享账号阅读缓存、即时本机 visit/摘要补全、首次自动续读、可见楼层采集与有界发送；返回不反查，锚点不随批次确认清除。当前契约以 product map 为准。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts`、`src/sources/linuxdo/reading.test.ts`、`src/domain/forum/discourseReading.test.ts`、`src/platform/query/discourseReadingRuntime.test.ts`、`src/sources/readGateway.test.ts`、`src/platform/storage/readerDataStore.test.ts`、`tests/ui/account/account-runtime.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/tooling/expo-fetch-cancellation.test.ts` 与生产内容/共享卡片 UI owner。 |
| 失败 oracle | 修复前来源请求缺少 `Discourse-Track-View`；新增页面 oracle 还暴露失败详情在保留 route 返回时多一次 GET。计时 oracle 固定可见楼层去重、后台暂停、在途新增保留、未知超时不重放和本地回看锚点。 |
| 前一候选与门禁 | 2026-09-12 保留安装数据与登录态的模拟器候选 SHA-256 `2e0543437e0fee7a67bfcf52823127ccd0b566e7199f40721b3b5f88a395d3ab`。`UNIT_PASS`：Vitest 204 files / 2448 tests，seed `1789191075833`；`UI_PASS`：Jest 75 suites / 1383 tests，seed `-707944071`；`STATIC_PASS`：结构 545 模块、文档、typecheck、unused、version 门禁通过。 |
| 模拟器交互与请求 | `DEVICE_REPLAY_PASS`：四条 canonical Replay 通过。`LIVE_PASS`：App 冷启动按服务端进度续读至约第 12 楼；本机回看后重进，同楼五个内容矩形前后偏差均为 0 px；更多菜单「回到主楼」通过。Library 返回静置 13:42:29.900–13:42:42.500、User 返回静置 13:43:48.300–13:43:56.500 均无新增 GET/POST；前者仅有已在途请求结束。阅读状态批量接口 HTTP 200，Gateway 成功解析 8 项、部分错误 0。 |
| 跨端与列表续读 | `LIVE_PASS`：13:55–13:57 在原网页实际阅读同帖更远内容后，13:58 从 Library 重进，App 从此前主楼停留位置自动前移；本次仅 1 个 topic GET 与 1 个 `positionKind=target` 窗口 GET，均成功，无 `start` 窗口。日志没有目标楼层字段，不据此确认精确目标号。Search 再次进入同帖可续读至末尾；返回后关键词、筛选与结果首卡位置保留，14:00:16.300–14:00:30.000 静置窗口无新增 GET/POST。聚合「未读」点开 L 站话题后返回，该条退出结果，其他条相对顺序与首卡位置保留；14:01:00.800–14:01:16.000 无新增 GET/POST，也未自动补页。 |
| 原站阅读时长 | `LIVE_PASS`：同一账号的用户详情 `time_read` 从 13:40:26 的 10434 增至 13:48:13 的 10603，增加 169 秒；期间话题只在 App 阅读，原网页只打开主页和读取统计。对应 13 次 timings 全部完成且 Native POST 均为 HTTP 200，阅读期间单一进程与 generation、无请求取消。13:44:17 的详情统计尚未变化，仅记录延后观测事实，不推断部署原因。 |
| 官方周期等级指标 | `LIVE_PASS`：2026-09-12 同一账号官方 Connect 从 14:14:30 的「浏览话题 86/500、浏览帖子 1277/20000」变为 14:25:13 的「浏览话题 88/500、浏览帖子 1290/20000」，本轮观测差值为 +2/+13。基线后只在 App 阅读新话题及从已有回复通知进入的话题，网页没有看帖；这些是 Connect 等级周期指标，不是用户累计浏览总量，不由约十一分钟的观测间隔推断缓存 TTL。 |
| 附带诊断观察 | 13:58:03.601 记录一条非致命 Expo Promise `canceled`；匹配当时 APK 的 source map 仅还原至 `CodedError` 通用构造器，缺少业务调用帧与关联请求标识，归属为 `NOT_VERIFIED`。该次详情、目标评论窗口及随后 timings 均成功；保留事实，不能据此确认具体取消路径。 |
| 验收发现与修复 | 来源停用时 Account 提交后的身份边界原先未立即通知阅读 runtime，且旧采集会话可能在重新启用时复活；现在 layout 提交后同步 session 变化并永久结束旧 owner，真实 Account→发送链路 oracle 已先失败后通过。另以实际 Expo 57.0.19 JS 与受控 Native 边界证明取消 Promise 所有权缺口，补丁将 stream cancel 的 Promise 交给调用方、在 abort teardown 消费其独立取消拒绝；未吞掉正文 AbortError，干净依赖安装与全部补丁 forward/postinstall/reverse 检查通过。该确定性缺陷不等于已证明 13:58 旧事件的具体归属。 |
| 最终候选与门禁 | SHA-256 `e1508747fbda0d264e536b3cd4ea81aa063c6b9db6b44dea1707ab30428ba338`，开发签名 x86_64 Release/Hermes/R8，版本 1.3.142 / 146。`STATIC_PASS`：完整 `npm run verify` 通过，结构 545 模块、架构 tooling 23 tests、文档 tooling 25 tests，lint/format/docs/typecheck/unused/version 通过。`UNIT_PASS`：Vitest 205 files / 2456 tests，seed `1789194650884`；`UI_PASS`：Jest 75 suites / 1389 tests，seed `1726499523`。`APK_SANITY` 与四条 canonical `DEVICE_REPLAY_PASS`（Feed、Library 返回、通知只读、多源 Search）均在此 SHA 完成；覆盖安装后 firstInstallTime 仍为 2026-07-26 16:51:37，登录态保留。 |
| 最终候选实际请求与响应 | `LIVE_PASS`：14:32:05 的实际 topic GET 同时确认 `track_visit=true`、Track-View 与匹配的话题头，Native HTTP 200。14:32:08 首个可见主楼批次为 form encoded，实际 `topic_time` 与 `timings[1]` 均约 1011.0753 ms；通过 appSessionId/requestId 关联 Native POST 的 HTTP 200 和既有单次 `response.text()` 消费结果，响应为空、字节数 0。此为单批实际值，不是整段阅读总时长；诊断不保存账号、Cookie、CSRF、原始话题 ID 或响应正文。 |
| 最终候选原站计数 | `LIVE_PASS`：以 14:25:13 官方 Connect 的话题 88 / 帖子 1290 为基线，此候选只新读一个此前未读话题的主楼，网页未看帖；14:35:56 获取到话题 89 / 帖子 1291，分别增加 1，实际发送、空响应与官方等级周期计数相互对应。较早 +2/+13 的观测仍归前一候选，不混算。 |
| 最终候选后台与返回 | `LIVE_PASS`：14:32:39 转后台后尾批约 31.618 秒，Native HTTP 200 / 空响应；到 14:34:32 恢复前约 113 秒无新增 timings 或重试。恢复位置保留且无话题/评论/阅读状态 GET；14:34:55 返回时尾批约 23 秒，未补算后台 113 秒，HTTP 200 / 空响应。14:34:55.600–14:35:10 普通列表静置无新增 GET/POST。既有通知恢复请求按用户范围排除。 |
| 最终候选快速返回 | `LIVE_PASS`：同一进程 14:37:14–14:40:30 三次进入只产生 3 个 target 窗口、0 个 start。首轮立即返回，HTTP 200 的旧窗口以 stale 丢弃；两次重入窗口均 HTTP 200，JS 成功解析 20 项，页面正常展示。回到主楼后立即返回时实际取消 1 个 media GET（IOException），forum 取消为 0，不将其冒充 forum abort 现场；该窗口 `js-error`、`unhandled-rejection`、`native-crash` 与 `exceptionKind` 均为 0。最后返回 14:40:24.477–14:40:30 无新增 GET，仅尾批 POST 正常完成 HTTP 200。该有界回放没有再出现旧异常，不倒推 13:58 事件归属。 |
| 失败进入与通知目标 | 前一候选 `LIVE_PASS`：14:18 断网后点开缓存聚合未读项，正文真实 DNS 失败；返回后条目立即退出未读结果，其他条相对顺序与首卡位置保留，没有 timings。返回静置及随后恢复网络均无新增详情/阅读状态重试，网络设置已恢复。14:22–14:23 从已有回复通知两次定位正确作者的 #21；中间回到主楼后再次进入仍由通知目标优先，两次均只取目标窗口，没有额外起始窗口。 |
| 本次通知范围 | 2026-09-12 用户确认通知返回刷新属于原有链路，本轮不修改、不作为本次关闭条件；通知指定楼层仍须通过。该例外仅限定本次验收，不改写全局通知产品契约。 |
| 关闭条件与剩余证据 | 原站统计增量、实际请求与空响应、批量 ID 接口兼容、跨端续读和普通列表返回零额外 GET 均已有匹配候选的实际证据；最终候选已独立完成统计、后台、返回与快速取消复验，本次阅读事故关闭。累计 summary 的 topics 139 / posts 1475、time_read 10188 仅为缓存观测，累计话题/帖子数量增量仍为 `NOT_VERIFIED`，不与已通过的 Connect 周期指标混算。本轮本机收藏为空，删除目标没有真实样本；切号、匿名、来源停用与真实限流/CSRF 拒绝未做 Live，对应故障行为由 UNIT/UI 覆盖，不将其记为 Live 通过。 |

## `REG-TOPIC-158` 评论更新后主题和回复标题仍显示旧总数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`LIBRARY-03` |
| 历史症状与根因 | 2026-09-12 缓存修复的只读模拟器验收中，linux.do 已从 9 条读到 14 条回复并展示第 15 楼，但主题头和「回复列表」仍写 9；妖火已显示第 54 楼，头部与历史记录仍写 51。`useTopicController` 的普通分页/手动评论刷新只替换回复 Query，展示与 visit 仍消费旧 TopicDetail.replyCount；写后刷新有计数写回，普通读取没有。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` 的详情/历史同步、定位、分页与取消行为；`src/sources/yaohuo/reader.test.ts` 拥有最新页计数和旧页不回写的来源边界。 |
| 失败 oracle | 详情初始总数 1；手动刷新确认两条完整回复和 totalCount=2 后，topicReplies 已有两条，topicDetail.replyCount 仍为 1，seed `1283255538` 先红后绿。妖火已确认第一页楼号 559 却缺 totalCount 的 source oracle 在 seed `1789145356212` 先失败。 |
| 修复方向 | 用户授权后，普通窗口、定位、重建和写后确认统一同步合法总数，再失效旧快照；未知计数保留，不增加隐藏 Topic 请求。历史 visit 包含计数变化。妖火沿用详情最新楼号口径，仅确认的第一页且楼号无解析降级时提供统计，旧页与推算楼号不回写；完整性比较优先使用本次原站统计，避免旧计数将新回复误降级为 partial，导致回复区只显示当前页条数。 |
| 验收边界 | 相关 293 项 UI、108 项单测及静态检查通过。保留数据覆盖安装的匹配最终 APK（buildId `58ee011cb4014b8f91e46ecca45adc24`）通过两项 Replay；妖火原帖自然从 115 增到 118，头部、回复区和历史均为 118，没有误降级为当前页 30 条。linux.do 替代帖子在前一候选同一 controller 上从 3 增到 5，最终包三处均为 6。上述计数链路为 `LIVE_PASS`，最终进程无 crash/ANR/JS exception。原 linux.do 帖子已返回资源不存在；未覆盖四站完整矩阵或真实远端写入。 |

## `REG-TOPIC-157` 看过新回复后重进命中旧本地缓存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`NAV-02/03`、`WRITE-01` |
| 历史症状与根因 | 用户报告多个站看过新回复后，从首页等入口再次打开却显示旧回复，且没有请求。共享 controller 的详情内嵌回复、正序和倒序缓存没有统一失效；默认 mount 不重读，播种 effect 对已有缓存做同值写入还会清除失效标记。定位窗口退出后被移除，也能再次从旧详情播种。 |
| 修复方向 | 已确认新回复窗口使详情和另一排序快照失效；过期回复进入时重读，过期详情不再播种，播种只填空缓存并保留原时间。可信缓存与失败后的已加载内容继续保留。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx`：四站倒序刷新后普通重进、定位窗口退出后重进、刷新失败保留缓存；既有 owner 同时覆盖写后窗口、迟到响应和身份隔离。 |
| 失败 oracle | 修复前四站实际 hook 在成功显示更新后的回复后，卸载并重挂仍返回旧正文；seed `-311313808` 四例全部失败，修复后通过。 |
| 验收边界 | 固定数据 Query/controller 及匹配 APK 的四站只读重进/排序缓存路径为 `LIVE_PASS`：旧包 NodeSeek 刷新后首页重进零请求，新包四站均读取失效正序窗口；NodeSeek 第 566 楼、V2EX 第 170 楼保留，linux.do 与妖火分别自然新增到第 15/54 楼后仍可读，NodeSeek/linux.do 另经历史入口验证。相关两项 Replay 与 APK sanity 通过。顶部旧总数另由 `REG-TOPIC-158` 追踪；用户原始帖子、真实写后验收与完整四站分页矩阵仍为 `NOT_VERIFIED`，不把本轮结果扩展为所有缓存陈旧现象的唯一根因。 |

## `REG-ACCOUNT-049` L 站登录页面切后台再返回白屏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02/03` |
| 历史症状与根因 | 2026-09-11 主模拟器上 linux.do 原站已完整显示，Home 后返回只剩登录面板按钮，WebView 节点消失，App PID 未变；手动刷新恢复。`useAccountRuntime` 将 App inactive 接到 `useVerificationController` 的页面卸载、session 递增与待挂载定时任务取消，但面板未关闭，前台也不重新挂载。旧测试只断言面板保持可见，未验证网页实例。 |
| 修复方向 | 页面生命周期独立于 App 活跃状态；后台保留 WebView 与原页面，只取消正在检测的迟到界面结算，保持账号屏障、Cookie 交接及关闭/刷新 owner。 |
| 当前 owner | `tests/ui/account/account-runtime.test.tsx` 挂载真实 runtime、AccountHosts 与登录面板；`src/features/account/useVerificationController.test.ts` 覆盖待挂载和迟到检测，`tests/ui/account/account-site-panels.test.tsx` 保留超时及渲染进程退出后的显式刷新。 |
| 失败 oracle | 修复前加载中/完成后切后台均丢失 WebView 节点；待挂载任务无法完成，后台递增页面 session。对应 UI 两例与单元两例先失败，修复后通过。 |
| 验收边界 | 匹配候选 APK 在主登录态 AVD 完成原站打开后的连续前后台切换、超过 15 秒后台停留、滚动位置保留，以及手动刷新、关闭重开和检测状态，均为 targeted `LIVE_PASS`；一次已滚动页面前后截图 SHA-256 完全一致，整个验收 App PID 不变。20 项 unit、28 项 UI、类型/Lint/架构/文档检查及 x86_64 Release 构建通过。物理手机、未登录表单填写和系统回收 WebView renderer 的设备分支为 `NOT_VERIFIED`，未清登录态制造场景。 |

## `REG-ACCOUNT-047` L 站频繁失效与原站续期入口缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已解决。2026-10-04 用户明确确认 L 站掉登录问题已解决，与 REG-ACCOUNT-048 一并结案。已有续期修复与真实续签证据继续保留；下方未闭合结论属于此前阶段，不再作为当前待办。本次依据用户使用反馈关闭，未新增设备或 Live 测试，也不把原始每次失效追认为同一根因。 |
| 能力 ID | `ACCOUNT-01`、`SEARCH-02/04`、`WRITE-01`、`TOPIC-01/02/03`、`MORE-01/02` |
| 历史症状与根因 | 2026-09-09 用户诊断在 12:23、12:57、13:09（北京时间）三次账号核对为匿名，之前通知/操作已提示登录失效；未发现 App 主动 clear 事件。原生默认响应保存 no-op 确认丢弃续期，但现有日志没有原始响应更新证据，不能断言它是三次失效的唯一原因。 |
| 修复范围 | 仅合格 L 站原站响应受控转交 Android CookieManager；保留默认只读 Jar、禁止快照与手工凭据、按站显式清除、RN/Fresco 容器和代理隔离；原生 revision/基线与账号屏障拒绝旧响应。 |
| 当前 owner | `modules/forum-platform/android/src/test/java/com/wz/reader/network/ManagedCookieResponsesTest.kt`、`modules/forum-platform/android/src/hostTest/java/com/wz/reader/network/ManagedCookieResponsesInstrumentedTest.kt`；模块内 `NetworkProxyRuntimeTest`；`src/features/account/useVerificationController.test.ts` 与 `tests/ui/account/account-runtime.test.tsx`。 |
| 失败 oracle | 实际 HTTP 服务先发凭据 B、下次只接受 B；2026-09-09 修复前 native 测试 expected 200 / actual 401，修复后成功。Cookie 值仅为合成测试数据。 |
| 续期修复证据 | 2026-09-09 原生实际 HTTP 轮换及隔离测试 9 项、既有网络 runtime 77 项、独立 AVD instrumentation 4 项通过。最终候选 `1.3.140/144`、buildId `d7303c65c98c4f289465703bca7aa9f9` 在保留登录的主 AVD 上观察 14:32:05—14:52:28（北京时间，20.4 分钟，超过两个上游默认轮换间隔）；14:37:04、14:47:08 实际应用原站更新，14:48:22 与 14:51:58 后续独立账号核对确认已登录。搜索、通知列表、主题读取及前后台切换成功，窗口内未出现 App clear、写入失败或账号转匿名事件。 |
| 历史证据边界 | 响应续期缺失已有修复与真实更新证据；原始三次失效是否全部由该缺陷导致仍无法归因，当时频繁失效事故保留 `EVIDENCE_GAP`。真实回复、物理 ARM64 安装与长期登录留存在该轮记录为 `NOT_VERIFIED`；不清登录态制造场景，不发送真实回复。 |

## `REG-ACCOUNT-046` L 站操作要求登录但未触发账号核对

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-02/04`、`WRITE-01` |
| 历史症状与根因 | 2026-09-09 用户日志中回复与搜索均返回 403 并提示需要登录，账号仍为 logged-in，期间无 account-reconcile；当前模拟器同时显示搜索登录提示与账号已登录。协议把明确登录要求当作普通权限错误，读取和主题 mutation 只接收原始 `http-401`；回复还包装并丢失错误语义。诊断按文字记录 login_required 不会驱动身份核对。 |
| 修复范围 | 共用 L 站错误解析产生 account-recheck-required；读取直接/聚合错误与主题 mutation 交给 Account runtime，按当前 epoch、来源与登录面板边界核对，复用 single-flight 和唯一身份提交；不重发写操作、不按 403 直接退出。 |
| 当前 owner | `src/sources/readGateway.test.ts` 使用真实搜索解析链覆盖单站/聚合；`src/sources/linuxdo/actionClient.test.ts` 覆盖写协议与负向分类；`tests/ui/account/account-runtime.test.tsx` 覆盖核对、并发、终态与过期信号；`tests/ui/topic/topic-actions-controller.test.tsx` 使用真实 action client 固定回复核对与零重发。 |
| 失败 oracle | 修复前 Vitest seed 1788925249814 的三项测试失败，Jest seed -776346605 的真实回复解析测试未调用核对；修复后同 seed 通过。 |
| 关闭证据与边界 | 2026-09-09 完整 verify 通过；主 API 35 AVD 覆盖安装匹配源码的开发签名候选，首次安装时间不变。11:58:01（北京时间）真实搜索 403 触发一次带父 trace 的 account-reconcile，canonical 账号接口 404 确认 anonymous；搜索转为公共入口，账号中心登录数从 3/3 变为 2/3，L 站显示访客「已验证」，其他两站仍已登录。搜索/回复核对、不误退、并发及迟到隔离由上述自动化 owner 承接；真实回复未发送，其 Live 证据保持 NOT_VERIFIED。 |

## `REG-NOTIFY-062` 通知重试绕过账号核验且未就绪没有登录入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 通知读取受阻后点击重试只重新请求；账号已确认失效后，未就绪空态也无法直接登录。2026-09-07 用户行为日志确认：通知读取返回 403 后未核验，随后的搜索 429 触发 canonical 账号接口核验并以 404 确认掉登录。根因是通知 Route 把结构化错误压为字符串、重试绕过 Account、空态缺少面板动作；L 站可选分类探测还吞掉了登录/验证错误。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 以生产 gateway 和受控 HTTP 固定分类/列表验证、403/429 核验分流、三站重试和未就绪直达面板；`tests/ui/notifications/notifications-runtime.test.tsx` 固定受阻来源暂停与其他来源持续轮询。共享 Account 仍独占身份核验、登录面板及 exact Query 验证恢复。 |
| 后续取证与修复 | 2026-09-07 13:36:45 用户登录核验返回 200，通知分类却在 Account 面板屏障释放前立即读取，被 `private-access-stale` 拒绝；页面同时显示「账号状态已变化」和永久「正在读取消息」。通知准入现复用 canonical 私有访问判断，暂停中的 Query 仍保留原验证恢复；加载态只采用实际初次读取，分类错误不再被禁用列表的 pending 遮盖。runtime 屏障用例及 Route 分类失败用例均先失败再通过。 |
| 失败 oracle | 修复前登录失效和验证挑战都只能找到「重试 linux.do」，无法找到正确面板动作；分类挑战仍继续读取列表。当前测试同时要求点击前零弹窗、点击不重复读取、恢复一次、离页后的回调不再请求，unknown 不得被猜成退出登录。 |
| 验证边界 | 2026-09-07 主 API 35 AVD 覆盖安装匹配候选 `1.3.139/143`（APK SHA-256 `7488c063a736d34183c383b3623e90c7cc5d9aa6c553bf1106d142ab30211a31`），首次安装时间保持不变。真实 L 站未登录时，聚合/单站登录入口可用，点击打开既有 WebView 并显示站点验证页面；关闭后返回通知页。三站分流、挑战恢复一次和取消由 UI oracle 承接；真实登录/挑战完成后的恢复、其他两站真实掉登录尚未验证，未清除真实账号或打开消息。 |
| 后续验收 | 屏障修复候选 `1.3.139/143`（APK SHA-256 `31c574b7b47fc8dd864f42122ec0b6cfd3c4cb620cc384533418fc585431021b`）覆盖主 API 35 AVD，首次安装时间未变、用户刚建立的登录态保留。13:45:23 分类及列表均返回 200，原站 27 条通知加载成功，页面不再出现账号变化错误或永久加载；聚合读取也成功。登录交接时序与暂停 Query 保留由 UI oracle 固定，未清登录态重新制造完整真实登录过程。 |

## `REG-FEED-027` 页面归位后短斜滑切来源被列表抢占

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`；共享 RNGH ScrollView 与 `NOTIFY-01`、`TOPIC-01/02/03`、`NAV-03` |
| 历史症状与根因 | 2026-09-07 用户录屏并明确确认：页面能归位，但继续左右滑切来源仍被挡住。保留数据冷启动后，横纵交接再接 20% 屏宽横移、8% 屏宽纵移的短斜滑重复失败，同速水平滑通过，静止短斜滑也失败。RNGH 依据 Android ScrollView 的纵向 slop 提前激活列表，取消已经横移的 Pager；列表随 Pager 平移，child-local 横向位移会被抵消，不能用它判断手指的真实方向。 |
| 处置 | 在现有 ScrollViewHook 中使用屏幕坐标判断移动。以横向为主、且祖先能沿该方向横滚时，纵向列表不提前拦截，让父容器继续仲裁；无可滚动祖先、纵向主导及已激活的纵滚保留原生处理。沿用惯性停止、轻点消费和取消收尾，不增加 JS 滚动开关或计时器。 |
| 当前 owner | `patches/react-native-gesture-handler+3.2.1.patch`；`scripts/check-feed-gestures.mjs` 的 `handoff-diagonal-short-horizontal` 在 80/120 ms、两个方向检查实际换来源与完整页面。独立惯性、取消、刷新及共享入口仍按完整手势回归执行。 |
| 失败 oracle 与边界 | 原 `1.3.139/143` APK `64b2eecd…` 上，80 ms 向右短斜滑保持妖火，canonical 脚本明确失败；相同横移及速度、纵移为 0 时切页。使用 local 坐标的试验仍失败，事件记录显示横向 Pager 已移动后，列表误判方向并发出 CANCEL。屏幕坐标候选 `ee5c6cb2…` 的双向 80/120 ms 用例通过。该专项通过不代表完整矩阵或物理手机验收；最终范围见本次匹配 APK 的交付记录。 |
| 验证边界 | 同一候选在 API 35 主 AVD 上通过 72 组完整手势矩阵、系统取消/正常松手、独立惯性、下拉取消与再次刷新、12 组来源首尾边界反向切换、4 组交互及通知刷新取消。`npm run verify` 通过。已读为空，实际列表尾部斜滑未验证；刷新在交叉操作前已结束，刷新进行中切来源/底栏未验证；物理手机触感未验证。 |

## `REG-TOPIC-153` 妖火已结束零评论帖子报楼层页码错误且仍可打开回复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`WRITE-01` |
| 历史症状与根因 | 主题 `1578926` 原站有正文外结束记录和「暂无回复」提示，不再提供回复表单。原站 `tofloor=1` 返回「您查看的楼层不存在」，且缺少普通零评论帖随表单提供的 `replyPage` 字段。Adapter 先校验楼层页码再处理空窗口，详情未投影结束状态，UI 因而同时显示页码错误和「写回复」。 |
| 处置 | 解析可信结束及零评论标记，复用 `Topic.closed`、状态标签和统一写权限；明确零评论的原站首屏可返回完整空窗口，target/cursor 仍严格校验。刷新结束状态时收起编辑器保留草稿，异步 Cookie/选图准备后复核权限，阻止迟到提交；请求顺序保持不变。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts`、`src/features/topic/actions/topicActionDecision.test.ts`、`src/features/topic/model/topicHeaderModel.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`。 |
| 失败 oracle | 原站结构的结束空帖应得到 `closed=true`、可信零计数和无游标空窗口；正文伪标记不生效，错误主题与显式不存在楼层仍失败。UI 展示「已结束 / 暂无回复」且无回复工具；结束后旧回调和异步准备中的回复/上传均不得产生写请求，草稿保留。 |
| 验证边界 | `npm run verify` 通过；匹配源码的覆盖安装包已只读验收普通零回复帖 `1578947` 的首次进入、两种刷新和重进，以及结束且有 37 条评论的 `1563351` 的状态、入口、筛选、排序、跨页、合法楼层定位、刷新与重进；后者核对浅色及深色 130% 字号，结束后恢复浅色 100%。目标 `1578926` 在验收期间已被删除（用户确认），原始结束结构有删除前只读取证与解析 oracle，结束零评论的修复包实机场景未验证；编辑中结束及零网络写入由 UI oracle 承接，不进行真实写入。 |

## `REG-FEED-026` 受控慢网切来源时图片加载崩溃

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 本轮受控慢网源切换 5 轮未复现，保留原始入口待定位；尚无新的最小重复 oracle。 |
| 2026-10-04 复核 | 普通 Release 1.3.150/154，关闭 Wi-Fi、核实默认传输为 CELLULAR 后设置 emulator delay=5000ms，同 PID 12161 完成 5 轮 all→yaohuo，每轮均显示妖火数据；本轮对应崩溃缓冲无 Already released、Fatal Exception 或 Fatal signal。Wi-Fi、移动数据、延迟/速率、Gboard 和安装身份均恢复核验。证据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 feed-slow-switch。这是历史准备阶段源切换的只读复测，不包含完整下拉刷新 oracle；缓存列表出现不证明每轮都有全新图片解码，不能由 5 轮未复现关闭偶发事故。 |
| 能力 ID | `FEED-02` |
| 历史症状与根因 | 2026-09-07，API 35 主 AVD 在关闭 Wi-Fi、蜂窝延迟 5000 ms 的只读验收中，从全部切至妖火时 App 退出。发生于刷新交叉脚本的来源准备阶段，尚未开始下拉或横滑；系统退出记录为 `APP CRASH(EXCEPTION)`，不是模拟器挂起。根因尚未确认。 |
| 证据与边界 | 匹配候选 `1.3.138/142`、APK SHA-256 `520b36080bb5b6896ce74180d93972a3c31f3ce70a825c7902b157f3d5ba3747` 的崩溃栈经同包 mapping 还原，异常为 `IllegalStateException: Already released`，路径为 Glide `EngineJob.addCallback` → `SingleRequest` → expo-image `ExpoImageViewWrapper.rerenderIfNeeded/onSizeChanged`。尚无旧包对照或稳定重复 oracle，不能判定与手势补丁的因果关系。 |
| 当前 owner | expo-image 图片请求生命周期与来源切换设备证据；本轮仅保存隔离日志并记录，未修改图片行为。网络已恢复。刷新进行中切来源/底栏两项保持 `NOT_VERIFIED`；后续先建立可重复的最小失败 oracle，再决定修复范围。 |

## `REG-FEED-025` 惯性中再次短横滑被列表提前抢占

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`；共享 RNGH Native ScrollView 与 `NOTIFY-01`、`TOPIC-01/02/03`、`NAV-03` |
| 历史症状与根因 | 2026-09-07 用户指出半页问题修复后，松手再短滑切来源很难触发，大幅拖动较容易。Android ScrollView 在惯性中的 DOWN 直接返回拦截，RNGH 因而立即激活列表并取消 Pager，未等待新移动方向。原矩阵只断言惯性后页面完整，没有要求实际换来源，漏掉了被完整拦住的横滑。 |
| 失败 oracle | `880ca07e…` 候选纵甩松手后约 19 ms 继续横滑，68% 屏宽和 20% 屏宽短滑都未切来源；相同完整横滑只把间隔改为 2 秒则六组通过，静止短滑四组通过。`scripts/check-feed-gestures.mjs` 现在要求完整横滑与短快滑切页，覆盖静止、惯性中、横纵交接后，并保留短慢拖及轻点停止惯性行为。 |
| 处置 | `patches/react-native-gesture-handler+3.2.1.patch` 在既有 ScrollViewHook 内将停止旧惯性与认定新拖动分开：先终止动画，再让原生 ScrollView 根据新移动决定拦截；只停止惯性的轻点仍由列表消费。沿用 Pager 取消桥接与正常 UP 的惯性路径。 |
| 当前 owner | canonical owner 为 `scripts/check-feed-gestures.mjs`、`tests/device/TouchTrace.java`，独立惯性/取消/刷新及共享入口按完整回归执行。同步注入曾把 80 ms 动作延长到约 190–200 ms；已改为至少 16 ms 采样间隔并保存实际事件时间，漂移超过 50 ms 视为无效输入。 |
| 验证边界 | 候选 `1.3.138/142`、APK SHA-256 `520b36080bb5b6896ce74180d93972a3c31f3ce70a825c7902b157f3d5ba3747` 在主 API 35 AVD 分批通过全部 68 组有效连续手势；独立惯性、双向 CANCEL/UP、首页六项刷新、通知取消后再次刷新及导航 Replay 通过。用户告知同时操作后，分类栏、双指恢复、惯性后点远端来源及底栏返回四项独立重试通过。相关 UI 59 项、安装补丁测试 9 项与 typecheck 通过。完整验收仍有缺口：当前有限已读列表为空，首尾斜滑未取得独立重试结果；刷新进行中两项前置条件未满足，较慢网络重试又遇到 `REG-FEED-026`。物理手机、鼠标输入和其余共享原生入口未验证；未发布。 |

## `REG-FEED-024` 切换来源后回到顶部按钮残留

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | 2026-09-07 用户发现切换来源后「回到顶部」按钮没有重置。来源列表已重建并回到首项，但按钮的 `showFloatingActions` 保存在仍挂载的 FeedScreen 中；选择变更的 effect 只重置分页请求状态，缺少按钮状态清理。 |
| 处置 | 在来源、分类、排序和阅读筛选的既有重置位置清除按钮状态；同一列表返回和取消横滑仍保留原状态，不额外重建列表。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 验证切换来源的 Loading/首项阶段无旧按钮，同时保留同列表返回用例；`scripts/check-feed-gestures.mjs` 与 `scripts/check-feed-boundaries.mjs` 分别核对横滑换站和惯性后点站的真实按钮收起。 |
| 失败 oracle | 旧列表滚到 640 px 后按钮出现，切至新来源 Loading 后必须消失；修复前该断言失败，修复后通过。 |

## `REG-FEED-023` 快速甩动松手后列表惯性消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`；共享 RNGH root、`NOTIFY-01` 与原生滚动入口 |
| 历史症状与根因 | 2026-09-06 用户发现首页快速甩动后立即停止。此前为 `REG-FEED-022` 补齐 root 终止事件时，在正常 UP 已由 NativeViewGestureHandler 处理后又向原生子树派发 CANCEL，破坏刚启动的 fling。此前「甩动后能切页」的通过结果未测松手后位移，漏掉了这一回归。 |
| 处置 | root 仅在真实系统 CANCEL 时补齐子树取消；正常 UP 沿既有 native handler 路径处理，不重复派发终止事件。保留 Pager 系统取消归位和通知取消收尾。 |
| 当前 owner | `patches/react-native-gesture-handler+3.2.1.patch`；`scripts/check-feed-fling.mjs` 独立核对松手后位移；`scripts/check-feed-pager-cancel.mjs` 同时检查双向 CANCEL 和正常 UP；共享通知使用 `scripts/check-notification-refresh-cancel.mjs`。 |
| 失败 oracle | 同一隔离 API 35 AVD，补丁前旧包松手后列表内容变化约 11%；上一轮问题包 `e68da10b7d84dcfcf25a29b18f7e3d453df71af609007b46e504f4f5bbc3817b` 能拖动但松手后变化为 0，canonical 脚本失败。收窄补丁后该脚本在隔离与主 AVD 均通过，松手后变化约 11%。该比例只用于识别静态列表是否继续移动，不代表滚动距离或性能指标。 |
| 验证边界 | 候选 `1.3.138/142`、SHA-256 `607ac56d48e2c067aefacd85ae77f8295edef5aa6c31e0f64a8d4e87884ebbdd`；隔离 AVD 的双向 CANCEL/UP 和通知取消后再次刷新通过。主 AVD 保留原首次安装时间并验证惯性恢复；物理手机、所有速度及所有共享手势入口未验证。未发布。 |

## `REG-FEED-022` 列表滚动后横滑停在两页之间

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`；共享 `NOTIFY-01`、`TOPIC-01/02/03`、`NAV-03` |
| 历史症状与根因 | 用户录屏中首页滚动后横向切来源，松手仍停在两页之间。RNGH 3.2.1 root 拦截触摸后直接返回，原生 Compose Pager 收不到终止事件；上游只在下一次 DOWN 前取消遗留子树，当前拖动因而不能自行结算。原生记录确认 Pager 收到 DOWN 与拖动开始，却没有收到本轮 CANCEL。 |
| 处置 | RNGH root 补齐真实系统 CANCEL；初版也对正常 UP 补发取消，引入 `REG-FEED-023`，收窄后惯性恢复但自然交接仍复现。进一步确认：短横滑的归位动画被下一次纵滚打断时，RNGH 接管并逐 View 调用 `onTouchEvent(CANCEL)`，Compose 却在 `dispatchTouchEvent` 处理触摸，因此仍等不到收尾。Pager source patch 将直接 CANCEL 桥接到 Compose，桥接期间 PageHost 不重复取消已由 RNGH 仲裁的原生子列表；真实系统 CANCEL 仍正常分发。不增加 Feed 滚动开关、方向锁、计时器或强制选页。 |
| 当前 owner | `patches/react-native-pager-view+9.0.4.patch` 的 Compose 取消桥接；`patches/react-native-gesture-handler+3.2.1.patch` 的系统取消分发；`scripts/check-feed-gestures.mjs` 与 `tests/device/TouchTrace.java` 覆盖连续交接、快慢/双向/回拖及列表实际位移；`scripts/check-feed-pager-cancel.mjs`、`scripts/check-feed-fling.mjs` 和 `tests/device/feed-gesture-priority.ad` 保留各自终止事件、惯性与导航 owner。 |
| 失败 oracle | 同一 API 35、1080 px 宽设备上，列表滚动后短横拖并注入 CANCEL，旧 APK 的页面持续 x=87、width=993；修复 APK 双向均恢复 x=0、width=1080。脚本先断言页面确实开始移动，再验证取消后完整归位且来源不变。正常松手可能按原生速度判断切至邻页，不以固定返回原页作为其 oracle。 |
| 后续逃逸与新 oracle | 恢复惯性的 `607ac56d…` 候选仍被用户在手机与模拟器复现，原先只等纵滚结束再横滑的通过结果不足以关闭事故。主 AVD 保留 x=184 的妖火现场；同一时间线执行 180 ms 向右短横滑、松手后约 19 ms 开始纵滚，连续两次停在 x=155/153、可见宽度=1109/1111（viewport=1264），且记录中只有 Pager DOWN 和 RNGH MOVE 接管，缺少 Pager 终止事件。桥接候选原样回放恢复 x=0/width=1264，独立惯性 oracle 仍通过；最终覆盖范围以本轮匹配 APK 验收记录为准。 |
| 验证边界 | 候选 `1.3.138/142`、APK SHA-256 `21837abbbd06485e8b1f1c92244a901fa56bc6eaac4099d3a3086d7d8a0b8791` 在 1080 px 与主 AVD 1264 px 均通过双向取消 oracle；主 AVD 的 APK_SANITY、首页手势 Replay、轻拉/长拉/取消后刷新、正文滚动/文字选择/图片预览返回通过。通知列表已确认拉出圆圈后 CANCEL 收起、下一次正常刷新结算；linux.do 通知返回既有需登录状态，不将该站数据读取记为通过。物理设备与其他原生手势组合未验。 |

## `REG-NOTIFY-061` 通知列表取消下拉后指示器残留

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`；共享 `FEED-01/02/04` |
| 历史症状与根因 | 2026-09-06 手势专项审核中，通知列表长拉后注入系统 CANCEL，蓝色圆圈持续停留；下一次正常下拉才能恢复。此前仅直接调用刷新控件 onTouchEvent 的测试没有覆盖内部列表持有触摸的分发路径。 |
| 处置 | 共享 RN source patch 在 CANCEL 分发到子节点之前结束未提交手势；通知 FlashList 关闭不需要的 nestedScrollEnabled。此前这两项仍缺少来自 RNGH root 的本轮终止事件；最终复用 `REG-FEED-022` 的 root 补丁补齐分发，通知沿用 RN RefreshControl，不增加专用计时器或手势 owner。 |
| 当前 owner | `patches/react-native-gesture-handler+3.2.1.patch` 的共享 root 分发；`patches/react-native+0.86.3.patch` 内 ReactSwipeRefreshLayoutTest；`tests/ui/notifications/notifications-screen.test.tsx` 的刷新装配；`scripts/check-notification-refresh-cancel.mjs` 的实际指示器取消与下一次刷新 oracle。 |
| 失败 oracle 与证据边界 | 新 dispatch JVM 用例在旧实现的 CANCEL 后仍得到 isRefreshing=true；共享修复后 5 项 JVM 用例通过。仅共享 patch 的 APK 在真实通知列表仍残留，因此不能用 JVM 绿灯代替设备验收；通知列表关闭 nestedScrollEnabled 的装配断言先以 undefined 转红。最终处置须通过匹配发布 APK 的取消与再次刷新验收后才能关闭证据缺口。 |
| 本次发布验收 | 匹配 1.3.138 APK 的正常通知下拉能够完成，系统注入 CANCEL 后仍残留静态圆圈，下一次正常下拉可恢复；关闭通知列表 nestedScrollEnabled 未消除这个边界。该问题尚未修复，真实 RN 列表与 JVM ScrollView 之间的证据缺口仍待诊断。已明确告知用户，并按其随后要求优先发布正文复制与首页刷新修复，不将此条记为通过。 |
| 修复对照与边界 | 2026-09-06 补齐同一隔离 API 35 AVD 的旧包负控：先确认已拉出指示器，CANCEL 后无需再触摸，中央探针从基线 0 留下 982 个蓝色像素，脚本按原症状失败。当前候选 `1.3.138/142`、SHA-256 `e68da10b7d84dcfcf25a29b18f7e3d453df71af609007b46e504f4f5bbc3817b` 在相同设备及主登录态 AVD 均从 0 恢复为 0，下一次正常下拉在 60 秒上限内结算。检查限定浅色、聚合列表顶部，保留 pulling/cancelled 截图；主 AVD 的 NodeSeek 消息仍可见，linux.do 仍为需登录终态，不将其数据读取或物理手机记为通过。本条修复状态不代表已发布。 |

## `REG-FEED-021` 嵌套滚动竞争及取消收尾缺失导致下拉卡住

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01/02/04`；共享 `NOTIFY-01` |
| 历史症状与根因 | 2026-09-06，用户发现很长的下拉仍会卡住、轻拉也出现圆圈。RN 0.85 起，为带 RefreshControl 的 ScrollView 默认开启 nestedScrollEnabled；当前 RN 0.86.3 保留该默认值。首页已经通过 RNGH ScrollView/RefreshControl 管理刷新，Android nested-scroll 路径却又累计拉动距离并独立结算。设备事件记录证明取消时 native gesture 未激活，随后 nested-scroll stop 仍把 refreshing 设为 true；只清理 ACTION_CANCEL 的圆圈会留下白底和延迟提交。 |
| 处置 | 首页唯一纵向 FlashList 显式关闭 nestedScrollEnabled，保留同库手势装配与受控请求连续性。独立的系统 CANCEL 仍会滞留，故共享 RN source patch 复用原生 stop/reset 完整结束取消：先结算 nested-scroll bookkeeping，再复位指示器与 active pointer，避免迟到的 UP/stop 触发刷新；已经开始的刷新保留。不增加计时器、手势 owner 或自定义阈值。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 验证列表关闭嵌套滚动且刷新/滚动仍有 block 关系；`tests/ui/feed/feed-controller-session.test.tsx` 验证请求连续性；`patches/react-native+0.86.3.patch` 内 ReactSwipeRefreshLayoutTest 验证 direct/nested 取消终态；`tests/device/feed-gesture-priority.ad` 和匹配 APK 的长拉、轻拉只读验收承接真实手势证据。 |
| 失败 oracle | 未显式配置时装配测试得到 undefined（运行时默认 true），修复后必须为 false；该 UI oracle 仅证明配置传递，卡住是否消失仍须匹配 APK 验证。原生测试必须同时固定取消后 GONE、迟到 UP/stop 不刷新、下一次拖动的可见圆弧及刷新可用、进行中刷新保留。仅关闭 nestedScrollEnabled 的 APK 已证明自然长拉和短拉正常，但系统注入 CANCEL 仍滞留；仅复位圆圈的早期 Native 试验也被 nested-scroll 用例否定。 |
| 上游证据 | [RN 默认值变更 PR 55189](https://github.com/react/react-native/pull/55189)；[RNGH 同组合卡住案例及关闭 nestedScrollEnabled 的处理](https://github.com/software-mansion/react-native-gesture-handler/issues/4231#issuecomment-4615780766)。 |
| 修复验收 | 4 项真实 AndroidX JVM 用例与 76 项 Feed UI 测试通过。匹配最终 APK 的 API 35 模拟器验证 50/100 px 轻拉松手收回、2200 px 长拉、拉到 2400 px 后回拉松手、CANCEL 后再次下拉，以及 14 步快慢斜滑/来源切换；NodeSeek 与聚合录屏均只有一个连续刷新圆弧区间。物理设备、通知页真实取消与全部系统中断路径未验。 |

## `REG-FEED-029` 下拉刷新圆圈松手后消失再出现

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01/02/04` |
| 历史症状与根因 | 2026-09-06，刷新手势恢复后，用户继续发现 loading 出现、消失、再出现。匹配 APK 录屏中，圆圈在松手后中断约 150 ms；onRefresh 先异步取消旧 Query，再等待 Query 的 isRefetching 更新，回调触发时 refreshing 仍为 false。RN 的受控 RefreshControl 因此先收起原生指示器，后续 Query 更新又重新打开。 |
| 处置 | 现有 Feed controller 在手动回调中立即设置刷新状态，并持续到取消旧请求和当前请求结算完成；沿用现有 scope/generation 清理，旧请求 finally 不关闭新请求的指示器，切换来源或离开页面时复位。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` 的成功/失败刷新连续性与请求替换用例；共享装配仍由 `tests/ui/feed/feed-screen.test.tsx` 拥有，设备证据使用匹配 APK 的逐帧下拉录屏。 |
| 失败 oracle | 将取消与读取分开结算，原实现的取消阶段 refreshing=false，新实现从回调到成功/失败结算前均为 true，终态为 false。同一模拟器、同一顶部下拉，修复前可见区间为 0.983–2.067s 与 2.217–2.983s；修复后为连续 0.950–2.850s，未出现中间断档。像素探针限定本次固定 viewport 的顶部圆圈区域，不代替其他设备和网络故障验收。 |

## `REG-FEED-028` 首页下拉刷新指示器停留且未触发读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01/02/04` |
| 历史症状与根因 | 2026-09-06，撤回打包优化后首页仍能复现下拉圆圈滞留。FlashList 改用 RNGH ScrollView 承接纵向手势时，RefreshControl 仍从 React Native 导入；它忽略 ScrollView 传入的 block 关系，刷新手势未注册，拉动被滚动手势取消。旧 UI fixture 忽略 renderScrollComponent，并把刷新控件当普通子节点，未覆盖真实装配。 |
| 处置 | Feed 统一使用已安装 RNGH 的 ScrollView 与 RefreshControl，由上游原生手势关系协调下拉和滚动；读取 controller 与请求结算不变。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 保留真实滚动/刷新组件并验证原生 block 关系；`tests/device/feed-gesture-priority.ad` 与匹配 APK 的只读下拉刷新验收承接设备证据。 |
| 失败 oracle | 修复前 UI 测试只观察到一个 NativeViewGestureHandler，缺少刷新手势；配套控件必须注册两个 handler 并配置 blocksHandlers。设备同一顶部下拉修复前圆圈持续停留，修复后聚合与 V2EX 列表真实更新且指示器收起，NodeSeek 显示刷新提示；快慢纵向斜滑不得误切来源。 |

## `REG-TOPIC-152` 小数密度下行内大图超过段落宽度而错位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/02/03`；共享 `NAV-02/03` |
| 历史症状与根因 | 2026-09-05，V2EX `t/1229472` 主楼两张混排图片在手机截图中跟在文字后向右越界，默认模拟器正常。同一 API 35 模拟器设为 `1264×2780 / 560dpi` 后复现，宽度改为 `1265px` 则通过；去掉 HTML、图片加载和固定 lineHeight 后，Text 内嵌 View 仍可复现。Fabric 已将子 View 测为段落上限 `1124px`，随后加 `0.01dp` 并向上对齐，生成 `1125px` 占位，首次违反最大约束。另有 DIP/Float 往返误差可将 `3px / density 2.625` 转换为 `4px`。 |
| 处置 | 共享 `ParagraphShadowNode` 在像素对齐后复用现有 `LayoutConstraints.clamp`；Android 的两条 spannable 构造路径继续共用 DIP helper，在 ceil 前只退一个 Float ULP，保留已对齐整数像素并继续向上取整真实分数。未改变作者图文位置、媒体分类或引入按设备留白。 |
| 当前 owner | `patches/react-native+0.86.3.patch` 内的 `TextLayoutManagerInlineViewSizeTest`；`dev/inline-layout-proof/index.tsx` 对真实 Fabric 的换行及最终 bounds 自检；生产 wiring 仍由 `tests/ui/topic/topic-image-loading.test.tsx` 承接，执行方法见 operator runbook。 |
| 历史修复证据与边界 | 原生 JVM 新用例修复前失败、修复后 3 项通过。最小 Fabric 页面在 `1264/560dpi/fontScale 0.9、1.0`、`1265/560dpi/0.9`、默认 `1080/420dpi/1.0` 均为 5/5 PASS。匹配最终 Debug APK 的原帖在 `1264/560dpi/0.9` 加载真实图片后，两图相对正文左边缘均为 `1px`，宽度 `1123px`、高度 `718/739px`，右侧不越界；预览返回 bounds 完全相同，连续四次下滚后返回仍保持宽度与比例。此前记录全新依赖 forward apply → 真实 postinstall → reverse check 及完整 verify 通过；这些历史结果不代替后续版本验收。 |
| 本轮专项验收 | 2026-09-06：重新执行原生负控、5 组真实 Fabric 矩阵（每组 5/5）、V2EX 原帖 `0.9/1.0` 字体、预览返回与列表回收；NodeSeek `post-889473-1` 第 12 楼引用图首次展开及重开、linux.do `t/topic/2556285` 主楼与第 2 楼长图均实际显示。妖火 `bbs-1577052.html` 未取得有效正文，随后来源读取出现 `network_error`，该站原帖 GIF 记 `NOT_VERIFIED`；物理手机及 iOS 未验。本轮按用户要求只做受影响能力及共享路径回归，不声明全量 verify 通过。 |

## `REG-TOPIC-151` 评论中的邮箱保护占位未还原

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`；共享 `TOPIC-01`、`NAV-02` |
| 历史症状与根因 | 2026-09-05 NodeSeek `post-912680-1` 的评论在 App 显示 `[email protected]`，经「更多操作 → 原站打开」后浏览器显示正常邮箱。原始 HTTP 200 页面在第 1、3、4、5、6 楼使用 `.__cf_email__[data-cfemail]`，原站脚本还原这五处内容；App 的共享 HTML 清洗未执行等价还原，来源 reader 的 `preparedContent` 已含占位，渲染器只是展示该结果。 |
| 影响与复现证据 | 邮箱不可读，部分占位还错误指向邮箱保护地址。修复前公开 `getTopic/getReplies` 契约与安全清洗用例以 seed `20260905` 失败；修复后可见 Android 模拟器加载当前源码，第 1、3、4、5、6 楼邮箱逐一与原站渲染文字相同。内容守恒 owner 对四来源、五角色比较受保护输入与明文输入的完整编译结果，涵盖普通占位、内联图片、分段、selection tape 与 preview catalog。其他站点真实邮箱、Release APK、物理设备和系统邮件操作未作本项验收。 |
| 处置 | 在共享 sanitizer 内复用现有 DOM、实体解码和安全转义，只还原明确邮箱标记及保护链接；生成文本节点而非再次解析 HTML，原邮件链接保留标签，畸形编码保留可读原文。正文 renderer、媒体占位和选择机制不变，不引入依赖或执行原站脚本。 |
| 当前 owner | `tests/integration/source-read-contracts/nodeseek.test.ts`、`tests/integration/html-sanitization-contracts.test.ts`、`src/domain/forum/topicContentSplit.test.ts` |

## `REG-USER-010` 用户页刷新失败仍重置已加载分页并返回完成

2026-09-16 复核：真实 controller/Query 另复现旧分页晚于刷新完成时覆盖新首屏（seed `91605`）。现有刷新 owner 先取消并等待两条活动 Query，再读取资料与新首屏，刷新期间不追加分页；反向完成顺序与失败保留也已覆盖。资料和活动接口已经收窄，删除旧 `firstLaneData` 播种路径；此次自动验证不继承历史设备通过范围。详见[本轮取证记录](review-remediation.md)。

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 2026-09-05 全仓审核以真实 `useUserController` 与 QueryClient 复现：用户页成功加载两页主题，随后首屏刷新请求拒绝；页面仍显示网络错误，但第二页消失，末页的 null cursor 恢复为旧首屏的 `topics-2`，`refreshUser()` 返回 `completed`。根因是该命令等待 `invalidateQueries` 后未检查 Query 错误终态，仍用保留的旧 Profile 调用 `firstLaneData` 覆盖两条活动 lane。现有成功刷新用例只证明新 Profile 成功时应替换旧分页，不能覆盖失败分支。 |
| 影响与复现证据 | P2：刷新失败会丢失已加载的内存分页并允许重复加载，不涉及持久化资料删除。修复前 RNTL 普通用例以 seed `20260905` 确认失败；无快照冷启的 Android App 在 NodeSeek 回复列表追加两页后刷新超时，同样退回第一页，App 与系统进程未重启。修复后真实 QueryClient 测试覆盖两组分页及原 cursor 保留、失败后继续分页、取消/离页/用户及会话变化、空与未变化的成功响应；匹配最终源码的 Debug App 对主题与回复分别完成追加两页→断网刷新超时→后续内容保留→联网继续追加一页→成功刷新重建首屏。验收期间 App/系统进程、APK 与 firstInstallTime 稳定。错误提示出现仍可使可见条目随头部高度移动，不据此声称像素位置不变；其他站点和 Release/物理设备未作本项 Live 验收。 |
| 处置 | 2026-09-05 获用户授权修复。共享刷新命令沿用精确 Query 刷新，检查本次错误/成功更新计数及当前页面、Query 身份和完成状态；失败返回 `failed`，取消或过期返回 `stale`，仅当前身份的新成功结果重建两组分页。复用现有 Query 状态及 `useCommittedRef`，未改变 Query key、协议、存储或公开接口。原 expected-failure 已转为普通行为测试。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |

## `REG-TOPIC-150` NS 页签抓取终端骨架导致正文空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已确认缺陷已有修复，待验收。终端完整 ANSI 恢复已实现，设备 Native 文本与原文比对通过；剩余为剪贴板全文读回、性能与系统取消等分支，不再将历史 Tab 空白直接列为当前未修复。 |
| 能力 ID | `TOPIC-01/02/03` |
| 历史症状与根因 | 2026-09-04 `post-812712-1` 的前两个 Tab 在 App 中空白，原站与同条评论 Markdown 保有完整 ANSI。隐藏 WebView 抓取时 xterm 已创建行但文字仍为空/部分，后续 `window.stop()` 不保证终端绘制完成；另有原站行没有 `xterm-row` class 的形状。共享来源入口现按唯一身份与块顺序恢复同条完整 ANSI，只替换终端子树；通用转换兼容无 class 行。空/部分/完整、主楼/回复及两种传输已有失败转通过的行为 oracle；批量提交父节点避免新增平方复制。四份真实输入在旧/新 Terminal 空白规范化下完整编译结果一致，因此未将此次空白归因于该算法优化，也未追溯其首次引入版本。 |
| 当前 owner | `tests/integration/hidden-browser-scripts.test.ts`、`tests/integration/source-read-contracts/nodeseek.test.ts`、`tests/live/agent-live.md` |
| 证据边界 | C17 APK `d8a0d71e…` 无快照冷启后，两个 Native 文本分别为 2,229/3,919 字符，按既有不可打印控制字符规则与已采集原文逐字一致；四 Tab、ANSI、慢横滑与横向位置保持、两张图片各两轮切回、预览翻页及返回选择取消已有设备证据。Android 工具不支持剪贴板全文读回，该项仍为 `BLOCKED_BY_ENV`，不能以复制提示代替；收尾返回时整个主模拟器进程退出，已无快照恢复且安装身份不变，不据此断言 App 或算法根因。正式性能与系统取消等未测分支仍独立报告，单次重开恢复不证明全部算法等价。 |

## `REG-TOPIC-149` 超高回复对齐与晚测高隐藏目标楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已确认缺陷已有修复，待验收。行起点定位、列表就绪及晚测高命令交接已有修复和失败转通过证据；仍需匹配最终 APK 的暖图、重复定位与关联交互验收。 |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 2026-09-04 妖火真实回复暖图后重复定位只看到正文中部，目标楼层头部已在屏外。既有楼层定位与排序后定位都传 `viewPosition: 0.2`；FlashList 按整行高度对齐该比例，800 高 viewport 对 1800 高回复会得到 headerY=-200，与 MVCP 是否补位无关。文字加图片可编译为一个合法 reply owner，不拆正文掩盖。两处共享调用改按行起点定位后，匹配 C4 APK 的暖态新 route 仍复现偏移：初次 onLoad 前的估算位置，以及最终命令后、确认前后的晚测高没有完整交接给锚点。共享入口现在等待当前列表就绪，controller 在投影、Native 确认和阅读锚点之间保留同一目标 key，拒绝旧代次回调。真实 Topic 点击/排序命令、晚测高及确认/布局两种顺序均有失败转通过的行为 oracle；匹配最终 APK 的暖图与重复定位另行验收。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx`、`tests/live/agent-live.md` |
| 后续定位 | 同源码图片接入修复配官方 FlashList 2.3.2 的隔离对照，冷启动妖火 556 楼仍会被前方长图推出屏外。设备数值诊断确认：6695 的动画命令曾先被旧 Native 上界 1094 截短；尺寸回调无动画重投又提前结束 command，旧动画继续移动并覆盖目标锚点。修复保留当前命令及动画方式，普通测高仍交给 Native MVCP。早期把 idle 校正与对应内容高度拆开的探针，经原生调度核对不作生产根因，已替换为真实布局后校正及迟到 ACK owner。最终设备验收仍须与对应 APK 分开记录。 |

## `REG-TOPIC-148` 补页与晚测高重新选择锚点导致续读偏移

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已确认缺陷已有修复，待验收。补页锚点、BeginDrag 基线与迟到回调交接已修，部分三站自然续读通过；正倒序组合、失败重试及尾窗收缩仍待验收。 |
| 能力 ID | `TOPIC-03`、`NAV-02/03` |
| 历史症状与根因 | 2026-09-04 匹配 APK 对照：V2EX 第 101 楼补页后上移 37 px，NodeSeek 第 11 楼下移 71 px；不是筛选栏损坏，也未证明首次引入版本。共享 FlashList 在补页后重新选中新插入可见行，后续测高不再维护原阅读内容；旧的限时忽略原生事件不能隔离迟到确认。现由同一 key/index/几何基线持续锚定，真实交互与显式命令接管，原生像素取整和含 footer/padding 的边界独立校验。设备另确认 linux.do 定位已到窗口下端时，一次触边通知先被无手势门禁消费，之后正常下滑仍不加载；共享拖动入口现在用现有 Native 尺寸复核边界。失败 oracle 已覆盖该通知/手势顺序、新插入行晚测高、迟到事件、主动导航和拖动打断惯性；匹配最终 APK 的四站续读与关联交互另行验收。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/integration/source-read-contracts/`、`tests/live/agent-live.md` |
| 后续定位 | 拖动开始清空旧锚点后，缓存前页可早于首个 `onScroll` 返回；共享入口现先用 BeginDrag 的实际 offset 建立基线，再通知页面续页。负向控制删除该交接后，同一回复的屏幕坐标变化，恢复交接后保持。2026-09-04 候选 APK `39cf60e0…` 的 V2EX 101 楼已用自然滑动读到 99/100 楼并保持停稳坐标；NS 11 楼以无惯性的慢拖读到 10 楼，后续位移与手势一致；linux.do 110 楼向下自然加载 112 楼时，110/111 楼停稳坐标不变。早期两次较快手势的位移不同不构成锚点错误证据。工具恢复后这些分支已取证，但正倒序全部组合、失败重试及尾窗底部收缩仍须独立验收，不用局部结果关闭整体缺口。 |

## `REG-TOPIC-146` 主楼选择活动没有接入 route 返回拦截

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已确认缺陷已有修复，待验收。主楼选择活动已接入 route 返回拦截，UI 与独立 Native 反例已转绿；剩余为匹配 APK 的系统返回和边缘返回验收。 |
| 能力 ID | `TOPIC-02`、`NAV-03` |
| 历史症状与根因 | 2026-09-04 修复：选择中的系统返回可能直接退出 Topic，JS route 只知道预览和 composer。Native 现在报告活动及所属 document revision，route-local 边界按预览、composer、选择、页面顺序处理；旧 revision 和重复取消不提交，正文不随活动重渲染。UI 与独立 AVD Native 反例先失败后通过；匹配 APK 的系统/边缘返回仍独立验收。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx`、`tests/ui/topic/topic-rich-text-selection.test.tsx`、`modules/forum-content-selection/android/src/androidTest/java/expo/modules/forumcontentselection/ForumContentSelectionViewTest.kt` |

## `REG-TOPIC-147` 嵌套 Tab 媒体使用外层正文宽度

| 字段 | 内容 |
| --- | --- |
| 状态 | `EVIDENCE_GAP` |
| 当前结论 | 已确认缺陷已有修复，待验收。嵌套 Tab、引用和列表已共享逐层扣减的内宽，真实 ancestor 到 consumer 的反例已转绿；四 Tab、横滑和复制的匹配 APK 验收仍未齐。 |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 用户报告 NS Tab 图片溢出；内部 renderer 沿用外层宽度，未扣除 Tab、引用、列表的实际装饰宽度。现在复用共享宽度 context 逐层扣减，图片、代码、表格、公式获得同一内宽，不裁剪掩盖；真实 ancestor→consumer 的失败反例已通过，实际四 Tab、横滑与复制继续按匹配 APK 验收。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`、`tests/live/agent-live.md` |

## `REG-WRITE-077` 表情图片或目录失败后无法自动恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/07`、`TOPIC-01/03`、`NOTIFY-02` |
| 历史症状与根因 | 用户报告 NS 编辑器部分表情永久失败；早期修复只提供点击或重开重试，仍不能自动恢复。linux.do 目录初次读取失败也缺少同页恢复。2026-10-03 两类读取加入 1/2/4/8/16/30 秒退避，间隔封顶 30 秒，成功后停止；不可见或取消时停止等待，旧回调和迟到目录无效。手动恢复保留，失败或重试中的图片不插入，成功节点、滚动位置及草稿保留，不清缓存或随机化 URL。真实 Runtime DOM 与三个目录入口有修前失败 oracle；Android 单图受控 503 已复现旧包停留约 15 秒零重试，受控证据不代表自然原站故障的 Live 通过。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts`、`tests/ui/topic/topic-reply-filters.test.tsx`、`tests/ui/notifications/notifications-route.test.tsx`、`tests/ui/topic-composer/topic-draft-controller.test.tsx` |
| 修复与边界 | 图片完整 owner 139 项、目录三个 owners 345 项通过；匹配源码 APK 的 Android WebView 对同一图片连续注入两次本地 HTTP 503，约 1.16/2.02 秒后自动再请求，第三次取得真实图片并显示 150×130 自然尺寸，后续无重复请求且正文仍为空。实际 Home 后文档进入 hidden、返回为 visible；linux.do 发帖表情目录正常显示 120 个预览。受控单图恢复不代表目录真实网络故障、所有原生回复宿主或自然原站故障已验证，未执行发布、回复等真实写入。 |

## `REG-DATA-008` 备份敏感字段过滤误删合法业务身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-03`、`LIBRARY-02` |
| 历史症状与根因 | 2026-09-04 隔离复现：`v2ex:sidney` 等合法关注键被敏感字段正则过滤，导入空库丢关注；同名 tombstone 丢失使旧关注无法被删除。根因是 schema 字段与业务身份键混为一谈；现只豁免指定 records/tombstones 的合法来源键，记录内部敏感字段、大小和深度限制不变。 |
| 当前 owner | `src/domain/reader/readerBackup.test.ts` |

## `REG-WRITE-075` 损坏投票 journal 被误判为空记录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | 2026-09-04 隔离复现：远端 poll 已物化、回复失败后，journal 读取异常被吞为 []，手动重试可能再次创建。现在仅存储 key 不存在时默认返回空，合法空数组仍有效；读取、JSON、结构、任一条目或重复 localId 错误均阻断，原记录不覆盖、不自动重发。未执行真实投票或回复。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |

## `REG-MORE-006` 损坏代理持久化状态放行直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 2026-09-04 隔离复现：合法 JSON 的错误结构或 enabled 缺失有效 active profile 被规范化为关闭。持久化入口现先验证结构与启用状态完整性，失败保持联网阻断；首次缺省及用户明确关闭、删除保持原行为。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts`、`tests/ui/more/network-proxy-controller.test.tsx` |

## `REG-TOPIC-145` 重复 identity 挤占 warm 导致未准入媒体计时

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 2026-09-04 隔离复现：三个合法可见 row 中，前八实例同 identity，第九个不同；warm 按实例、running 按不同 identity 独立选择，使第九个没有渲染许可却建立 deadline。现先选择合规不同 identity，再保证 running 全部属于 warm；暂停保留仍合规运行实例，未准入不计时。容量及 Release 性能仍由 `REG-TOPIC-144` 与 `REG-PERF-025` 的独立证据约束。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |

## `REG-WRITE-076` Unicode 小写扩长破坏编辑器偏移和私有块边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06` |
| 历史症状与根因 | 2026-09-04 隔离复现：`İ [details]broken` 标记真实位置 2 却报告 3；真实 Tiptap 中 `[spoiler]İİ[/spoiler]TAIL` 的 TA 被吞入不可编辑私有块，details 卡片混入关闭标签。根因是对 Unicode 全文小写后用扩长索引切原文；校验、tokenizer 与卡片切片现统一只折叠 ASCII，保留 UTF-16 位置和后续可编辑文字。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-PERF-001` Library 切换重建列表、集中加载头像及历史写入全量清洗

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`FEED-01`、`FEED-02`、`FEED-03`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 收藏帖子、关注用户和历史之间切换时明显卡顿；Debug 基线出现 17%–32% 掉帧，最慢帧约 69–82 ms。1000 条历史的 x86_64 Release 基线两批最慢帧中位数为 55.45 ms / 51.9 ms，History 就绪中位数为 702.5 ms / 708 ms。Topic 旅程中 20 次历史同步提交有 8 次超过 8 ms，最慢 22 ms；根因：`src/features/library/LibraryScreen.tsx` 的列表 identity、筛选提交、滚顶、Library 专属 `drawDistance` 和 `maintainVisibleContentPosition` 契约；`src/ui/avatar/Avatar.tsx` 是 Feed、Search、Library、Topic、User 共用的头像加载 seam；`src/domain/reader/readerData.ts` 与 `src/app/useReaderRuntime.ts` 共同约束历史写入和持久化。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-002` Topic/User 返回重复恢复同一 Topic session

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`TOPIC-04`、`USER-01`、`USER-02` |
| 历史症状与根因 | 从 Topic 或 User 返回时偶发卡顿或状态回滚；returning native route 已保留自己的可视 presentation，返回链路却又恢复整份 fallback snapshot，User 路径还再次 `openTopic`；根因：旧实现由全局组合层重放 Topic/User 返回状态，并让多个 native route 共享一个 Topic session；native stack 已经保留 route 实例，却又叠加 snapshot restore。当前所有权位于 `src/features/topic/TopicRoute.tsx` 与 `src/features/user/UserRoute.tsx`。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-NAV-002` 列表主题快速连点压入两个相同详情页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`LIBRARY-01`、`LIBRARY-03`、`USER-01` |
| 历史症状与根因 | 在列表中快速点击同一主题后进入两层相同 Topic；第一次返回仍停在重复详情，必须再返回一次才能回到列表；根因：`src/ui/topic/TopicCard.tsx` 是 Feed、Search、Library 和 User 主题列表的共享打开入口；旧实现每次 press 都直接调用 `onOpenTopic`，没有同步的重复激活门禁。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-NAV-003` 内部 Topic deep link 丢失目标楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-03` |
| 历史症状与根因 | 从内部 deep link 打开带楼层的四站 Topic URL 时进入了正确主题，但停在默认位置，没有定位到链接指定的回复；冷启动 pending 路径同样丢失目标；根因：internal open-link parser、pending queue 与 native Topic push 之间没有共享同一个 `RootStackParamList['Topic']` destination，语义身份在进入导航前被截断。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-PERF-003` Feed 来源切换把列表工作压进 Pager 收尾帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 首页左右切换来源时有明显停顿，高刷新率场景尤其容易看出；网络即使异步，目标来源的 React 提交、FlashList/TopicCard 创建和布局仍会与 Pager 收尾帧重叠；根因：`src/features/feed/FeedScreen.tsx` 的视觉来源、Query 来源、Pager idle 结算和列表物化边界；`src/features/feed/useFeedController.ts` 的来源切换入口。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-PERF-004` 双温缓存 Feed 横滑触发过量 native 绘制（已被冷激活模型取代）

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 相邻来源都有数据且已经预布局时，左右横滑仍有明显顿挫；请求时序正确也不能消除卡顿；根因：历史 seam 是 `src/ui/topic/TopicCard.tsx` 的 rich 绘制成本与 `src/features/feed/FeedScreen.tsx` 同时移动两棵 populated FlashList；当前方案删除后一项，不削减 TopicCard、Query、Gateway、Feed transport 或身份屏障。 |
| 当前 owner | superseded-by: `REG-PERF-006` |


## `REG-PERF-005` Feed 性能优化不得删减列表信息或视觉层级

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 横滑优化后 Feed 条目省略头像、图标、徽章背景、标签层级和点击/已读效果，并把多类信息压成单行；内容虽仍在字符串里，实际列表已不是优化前的样式；根因：`src/features/feed/FeedScreen.tsx` 到 `src/ui/topic/TopicCard.tsx` 的 presentation 分叉，以及 `TopicCard` 自持的扁平列表样式。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-PERF-006` Feed 页面、一级选中态与二级导航使用不同切换时钟

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04` |
| 历史症状与根因 | 左右横滑时页面已经移动，一级蓝标、文字和二级导航却仍停在旧来源。过去按 fractional position 提前提交业务、让 scene 继续读取全局分类、增加视觉来源或拼接 idle 的尝试造成错拍与漏请求。9.0.4 Compose Pager 的 `settledPage` 在动画结束时派发选择；专用 `TargetPageFlingBehavior` 补丁也等待 delegate 成功完成，历史记录的「松手定向时提交」与现役实现及测试不符。2026-09-05 修复前设备慢拖中途蓝标中心仍为 96.5 px，结束后才跳至 264.5 px。根修复将视觉进度和业务选择分开：标准 TabBar 消费连续 position；二级导航归所属 scene，按 route 投影分类、排序和 Loading；业务仅处理最终选择。删除 Feed 专用原生选择补丁及其专属测试，恢复上游选择事件，保留一次提交、取消零提交和单个完整列表。 |
| 当前 owner | `tests/ui/feed/feed-navigation-motion.test.tsx`、`tests/ui/feed/feed-screen.test.tsx` |
| 关联验收修复 | 2026-09-06 模拟器发现预铺二级导航切为 active 后，Android 无障碍树仍保留 `enabled=false`；共享 `PillRail` 现明确写回两个 disabled 属性的 `false`。行为测试先以 seed `771547259` 证明缺失状态，再验证恢复；共享控件及 Feed、Search、Library、Notifications 的定向 UI 回归通过。 |


## `REG-PERF-008` 嵌套 Topic 共用 presentation 且大正文同步挂载阻塞返回

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 从评论里的跨主题链接进入大主题后，在「正在读取主题」期间点击顶栏或 Android 返回没有立即离开；加载完成后返回也可能先闪白/灰空页。超长 opening body 虽然被分块，进入和返回时仍有明显同步卡顿；根因：旧全局 Topic runtime、presentation cache 与共享 list ref 让多个 native route 同时消费当前主题；详情列表又曾在 FlashList header 同步挂载全部 opening body chunk。当前 seam 是 `src/features/topic/TopicRoute.tsx` 的 route-local controller 与 `src/features/topic/components/TopicContentList.tsx` 的 list item/memo 输入边界。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-FEED-001` 首次加载出现两套 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04` |
| 历史症状与根因 | 首页首次读取空列表时，页面 Loading 与 Android 下拉刷新指示器同时出现；Smoke 仍可继续并最终通过；根因：`src/features/feed/FeedScreen.tsx` 的空态与 `refreshControl` 渲染契约。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-FEED-002` 切换来源或排序后列表没有回到顶部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | NodeSeek 从「新帖子」切到「新评论」后已有主题却看不到新列表首项，Replay 曾被误判为动态 Feed 无结果；根因：`src/features/feed/FeedScreen.tsx` 的单 active 列表 ref 与显式滚顶契约，以及 `src/ui/list/performance.ts` 的 Feed FlashList 位置策略。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-FEED-004` 单站刷新失败清空可信列表

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | 单站首页已经显示主题，用户下拉刷新遇到来源错误后，旧列表和下一页 cursor 被空失败响应覆盖，只剩错误提示；根因：`src/features/feed/useFeedController.ts` 的 `validateFeedPage` 在 Infinite Query commit 前拒绝失败响应，避免覆盖已经提交的可信 pages。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SOURCE-001` 聚合读取被单站凭据存储失败整体阻断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 历史症状与根因 | 任一来源凭据存储临时读取失败时，「全部」首页或搜索可能在发起站点请求前整体失败；linux.do 还可能把读取失败伪装成无凭据，继续匿名请求并隐藏错误；根因：`src/sources/readGateway.ts` 的聚合凭据装配与来源错误合并边界。 |
| 当前 owner | `src/sources/readGatewayContract.test.ts` |


## `REG-SOURCE-002` HTTP 成功但解析为空被当成有效页面

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`MORE-02` |
| 历史症状与根因 | 来源返回 HTTP 200 但页面结构已经无法解析时，首页、搜索、详情或用户页仍显示为成功；分页还会丢掉失败页 cursor、跳到下一页或误判没有更多内容；根因：`sourceDiagnosticSummary` 与 Feed/Search/Topic/User controller 的结果应用和分页 cursor 提交边界。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SEARCH-001` linux.do 高级筛选接受任意文本或旧候选污染新查询

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-03`、`SEARCH-04` |
| 历史症状与根因 | linux.do 标签和发帖人原本是可任意手输的文本框，可能提交站点不存在的值；快速改词时旧候选或旧 AI 响应还可能覆盖当前查询；空作者输入可能永久显示 Loading；关闭标签选择、切换分类再重开时，上一分类的同词候选可能重新出现并可点击；分页或详情返回后筛选也可能退回浅拷贝中的旧数组；根因：`src/features/search/SearchScreen.tsx` 的候选草稿交互、`src/features/search/useSearchController.ts` 的普通/AI/候选结构化 Query key、`src/features/search/searchRun.ts` 的深快照和合并、`src/sources/linuxdo/search.ts` 的候选接口。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-002` 分页失败隐藏已有结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 搜索第一页已有可打开结果时，继续加载失败会把整个来源的旧结果隐藏，只留下来源错误；用户既无法继续阅读，也无法确认重试的是失败页；根因：`src/features/search/useSearchController.ts` 在分页异常时虽合并回旧 `items`，却把 `hasMore/nextPage` 覆盖为结束态，验证完成回调还会重跑整来源；`src/features/search/listItems.ts` 遇到任何 `group.error` 都提前 `continue`，`src/features/search/SearchScreen.tsx` 的错误按钮也统一重跑整来源。 |
| 当前 owner | `src/features/search/listItems.test.ts` |


## `REG-SEARCH-003` linux.do 首帖搜索作者和头像丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03` |
| 历史症状与根因 | 已登录 linux.do 搜索明确命中首帖时仍显示「未知作者」，头像也不展示；标题、摘要和详情可用；根因：`src/sources/linuxdo/search.ts` 的 `topicsFromLinuxDoSearchData` 已按 `topic_id` 找到首帖，却只读取其 `blurb`；作者仍调用列表页的 `originalPoster(topic, users)`，因此被归一化为空。普通搜索和 AI 语义搜索共用该转换层。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-FEED-019` Pager 先 idle 后 selected 时手势切站不请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02` |
| 历史症状与根因 | 点击来源可正常切换，但横滑在新版 PagerView 的 `idle` 与 `selected` 顺序变化后不会提交目标请求；根因：Feed 把两个原生通知拼成了自定义完成协议。PagerView 的 `onPageSelected` 已表达 settled page，当前点击直接提交，手势只在 TabView `onIndexChange` 提交一次；idle 不再参与业务状态，未产生 settled selection 的取消手势零请求。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-FEED-020` 首页纵向斜滑误触来源切换

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02` |
| 历史症状与根因 | PagerView 9.0.4 的 Compose Pager 与首页 FlashList 默认 ScrollView 抢手势，横向位移小于纵向位移时仍可能切换来源。首页通过 `renderScrollComponent` 接入已安装 RNGH ScrollView，让列表参与手势协作；未叠加 JS 或原生方向锁，最终来源仍只由 TabView `onIndexChange` 提交。 |
| 当前 owner | `tests/device/feed-gesture-priority.ad`；最终提交/取消读取仍由 `tests/ui/feed/feed-navigation-motion.test.tsx`、`tests/ui/feed/feed-screen.test.tsx` 拥有。 |
| 失败 oracle | 2026-09-06，revision `146d87b` 的 `1.3.136/140` 在 `WZ_Pixel_API_35`（1264×2780）从列表执行横移 -650 px、纵移 -1100 px、250 ms，全部误切 linux.do；800 ms 和反向下滑亦复现。仅替换 ScrollView 后原样回放通过；列表首段、中段和已加载尾部共 12 组快慢/上下斜滑保持来源，正常横滑、点选、回到顶部与下拉刷新通过。此证据来自 Android 模拟器；物理设备手感未验证。 |

## `REG-MORE-005` SDK57 异步 File.move 造成诊断日志轮转竞态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-02` |
| 历史症状与根因 | 日志达到轮转阈值后，旧文件移动尚未完成便继续创建新文件，可能丢失上一份日志；根因：升级后仍把 SDK57 的异步 `File.move()` 当同步 API 使用，测试 mock 也错误地同步移动。当前轮转使用 `moveSync()`，mock 分别固定真实异步与同步语义。 |
| 当前 owner | `src/platform/diagnostics/diagnosticFileStore.test.ts` |


## `REG-NODESEEK-005` markdown-it 15 默认值使裸域名和 userinfo URL 退化

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | NodeSeek 正文中的 `www.nodeseek.com/...` 与裸域名不再生成链接，完整 userinfo URL 只识别后半段；根因：升级后继承了 linkify-it 的新默认值。当前 parser 显式固定 `fuzzyLink=true` 与 `urlAuth=true`，不再把第三方默认值当产品协议。 |
| 当前 owner | `src/sources/nodeseek/markdown.test.ts` |


## `REG-NAV-004` 框架升级把通用点击反馈带入全项目

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01` |
| 历史症状与根因 | 返回、底栏、卡片和普通按钮出现产品未拥有的 ripple、蓝色或压暗 pressed 状态、触感、WebView hover/active 与入场动画；根因：升级时把框架和组件库新增的交互默认值直接当成产品行为，又用逐组件 helper 扩散。当前删除通用反馈体系，并由静态 RN Pressable 接管 Navigation 的底栏和 native header，功能选中、焦点、禁用、展开等状态继续保留。 |
| 当前 owner | `tests/tooling/interaction-policy.test.ts`、`tests/ui/app/app-navigator.test.tsx` |


## `REG-SEARCH-013` Discourse 回复命中被丢弃或冒充楼主

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | linux.do 有真实回复命中却显示「内容无法解析」，或把命中回复者、最后回复者显示成主题作者；根因：`src/sources/linuxdo/search.ts` 曾丢弃缺少可靠 OP 的回复命中，或把命中 post/`last_poster_username` 归一化成主题作者。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SEARCH-014` Google JavaScript capability gate 被当成外部跳转

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 真实未登录设备上，NodeSeek 或 linux.do 搜索很快提示「页面跳转到外部地址，已停止读取」；同一关键词在 Android Chrome 可正常显示结果；根因：`src/features/account/HiddenBrowserHost.tsx` 曾把 hidden WebView 的每一次顶层导航都套用最终结果 URL 白名单；NodeSeek 生产 `webViewFetcher` 又只接收论坛域，导致 scoped Google 请求根本不进入 hidden WebView。后续若用论坛域/Google 的并集白名单代替 initial-task binding，还会让搜索任务跨域并错误结算。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-015` Google SearchGuard 访问故障被误报为外部链接

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | NodeSeek 未登录搜索提示跳到外部链接；原地「重试」仍显示外部链接，切换来源后再回来却成功，看起来像只有切站才真正重发；根因：`src/features/account/HiddenBrowserHost.tsx` 把 `is*BrowserNavigationUrl=false` 的所有原因压成「外部地址」，混淆了真实外部导航、另一搜索任务与 Google 自己的 SearchGuard 环境验证失败；来源切换并没有特殊恢复语义。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-016` 自动化结算节点撑高搜索页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 历史症状与根因 | 聚合搜索完成后，账号状态提示与第一组结果之间突然多出一大块空白；来源越多，额外间距越明显；根因：自动化结算状态被实现成生产布局节点，而不是既有可访问元素的状态。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-017` 未结算判断吞掉真实搜索 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 正常聚合搜索期间，某来源显示「等待账号状态」且没有 Spinner，看起来像账号卡住，而实际网络请求正在进行；根因：`searchGroupMeta` 与 `buildSearchListItems` 把请求生命周期的 `settled` 当成身份 pending，并放在更具体的 `loading` 前。 |
| 当前 owner | `src/features/search/listItems.test.ts` |


## `REG-SEARCH-018` NodeSeek 空搜索被旧页面壳误报为无法解析

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | NodeSeek 单站搜索特定关键词时稳定显示「搜索结果返回内容无法解析，请重试」，而普通关键词可返回结果；原站搜索页实际可能只是明确的空结果；根因：`src/sources/nodeseek/feedParser.ts` 的搜索解析器以正式 `.post-list` 为结果面，诊断器却把全页 `post-*` 链接及 embedded candidates 一起计入候选，制造 `candidateCount>0 + validCount=0` 的假 `parse_empty`。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SEARCH-019` 单站空结果仍显示继续加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站搜索已经显示「没有匹配结果」，列表尾部仍同时显示「继续下滑加载更多」，继续滚动还可能发起无意义的下一页请求；根因：`src/features/search/listItems.ts` 分别生成空态和分页哨兵，分页条件没有要求当前累计结果非空。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-020` 搜索来源 Tab 比首页明显偏大

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | 搜索页四站来源 Tab 比首页同一组来源明显更高、更宽，切换底部导航后视觉尺度跳变；根因：`src/ui/controls/SelectionControls.tsx` 同时提供默认 48 dp Tab 与来源栏 compact Tab；`src/features/search/SearchScreen.tsx` 漏传 compact 语义，形成同一来源导航的两套尺寸。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-021` linux.do 搜索会话途中失效后没有切到 Google

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 聚合搜索只有 linux.do 长时间停留在「搜索中」；重新登录后同一页面才完成。请求开始时 App 仍把旧会话投影为已登录，因此没有采用原本已有的匿名 Google 搜索；根因：`src/sources/linuxdo/search.ts` 只在发请求前按 `authenticated` 选择一次协议，authenticated search 响应明确失效后没有转入同一 Adapter 已有的 `searchLinuxDoGoogle`；`fetchLinuxDoJson` 还把 200 登录页误作普通格式错误。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-022` linux.do Google 结果被渲染成「无标题」

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | L 站未登录 Google 搜索出现「无标题」卡片；页面结构变化时还可能被误报为合法空结果；根因：`src/sources/linuxdo/search.ts` 的 Google 候选/标题提取、`src/sources/searchRead.ts` 的统一读取边界和 `src/ui/topic/TopicCard.tsx` 的展示兜底共同放松了标题契约。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-023` Google 同任务会话跳转被拦截或误报为 linux.do 外链

| 字段 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 能力 ID | `SEARCH-04`、`SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | L 站匿名搜索被 Google 导航到同一个 `/search?q=...&sei=...` 后，App 错误拦截并显示「linux.do 页面跳转到外部地址」或「Google 搜索流程已变化」；真正的验证、登录、consent 与未知流程也缺少准确原因；根因：当时的 searchFallback 模块把 Google 生成的惰性会话参数与 site/query/page 任务身份混为一谈，且 `src/features/account/HiddenBrowserHost.tsx` 没有对其余拒绝原因做局部分类；该模块现已由 `REG-SEARCH-028` 删除。 |
| 当前 owner | superseded-by: `REG-SEARCH-028` |


## `REG-SEARCH-028` 匿名 L/NS 搜索把 Google HTML 当成 App 数据协议

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 历史症状与根因 | 未登录模拟器提交 linux.do 或 NodeSeek 搜索后出现伪空结果、结构变化错误或永久 Loading；Google WebView 卡在 JS/SearchGuard 时重开仍可能复现。用户能在浏览器看到结果，却不能可靠回到 App 原生主题；根因：App 把 Google 页面当成内部数据协议，同时试图在不拥有 `linux.do`、`nodeseek.com` 域名的情况下依赖普通结果点击自动拉起 App。搜索协议、浏览器导航与原生 Topic 接回的 owner 混在 adapter 和隐藏 WebView 中。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-LINUXDO-001` linux.do Cloudflare 429 被降级且大响应被截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 历史症状与根因 | linux.do 实际要求 Cloudflare 验证时，直连已识别为 `verification-required`，隐藏 WebView 却把主文档 429 提前报成普通未知错误；偶尔挑战后已得到 200，又因正文固定截断为 12,000 字符而 JSON 解析失败；根因：`src/sources/linuxdo/browserFallback.ts` 的 CF 分类、`src/features/account/HiddenBrowserHost.tsx` 的主文档生命周期、`src/features/account/useHiddenBrowserFetchController.ts` 的 bridge 序列化，以及 `src/features/account/useSessionController.ts` 的最终 Response/typed error 结算。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-002` linux.do 验证关闭重开并无限循环

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04` |
| 历史症状与根因 | 首页聚合的 linux.do child 命中 CF 后面板不拉起，或检测一次后自动循环重开；只剩 V2EX 的 partial 内容还可能被当成新的账号/ReadPlan 状态；根因：`src/features/feed/useFeedController.ts` 的聚合 partial error 投影，以及 `src/features/account/useVerificationController.ts` 对 read recovery 与登录 surface 的责任边界。 |
| 当前 owner | `tests/ui/account/account-runtime.test.tsx` 承接共享恢复生命周期；`src/features/account/useVerificationController.test.ts` 承接分项结果与取消；`tests/ui/account/account-site-panels.test.tsx` 承接网页展示；Feed 入口仍由 `tests/ui/feed/feed-controller-session.test.tsx` 承接。 |
| 后续事故 | 2026-09-14 用户日志中，同一阅读批次连续四次明确 CF 403，第五次 POST 200；用户看到的验证网页一直没有可操作验证码。Cookie 已存在且与发送代次一致，不能归因为 Cookie 未保存。检测先关闭 surface、恢复失败再打开，造成反复弹出；普通网页正常也不证明 timings 放行。 |
| 修复 | 一次恢复会话保留面板至最终结果，WebView 与 UI 占用分离。取消覆盖 Cookie 交接和请求等待，重复通知不重新加载；页面与阅读分别结算，完成项不重发，过期批次不再加载验证页。专用入口只影响展示，不增加 POST 栈、凭据轮询或清理。 |
| 失败 oracle | 共享 Account 跨层用例在旧实现第一次检测仍被拦截后，面板可见值为 false（期望 true）。修复后持续 CF、前后台重复通知及静置期间 WebView 加载数和请求数不再增长；关闭、系统返回、切站、换号及等待阶段的迟到响应均由同一 owner 证明。分项成功、普通失败、过期与精确目标去重由 controller owner 承接。 |
| 自动验证 | `UNIT_PASS`：206 文件 / 2503 项，seed `1789359529381`；`UI_PASS`：75 套件 / 1426 项，seed `-100568505`，最终 Account 专项 48 项（seed `47538508`）。`STATIC_PASS`：lint、格式、architecture、typecheck、unused、文档及 diff 检查，按项执行通过。全量检查曾被工作区已有 Present 请求头迁移的一条过期搜索断言阻断，修正测试归属后按原 seed 定向重放通过，再完成全量单测。 |
| 验证边界 | 设备上的面板连续性、`/challenge` 实际表现、真实 CF 放行与阅读入账均为 `NOT_VERIFIED`；没有将 UI mock 或 HTTP 404 当作服务端验证成功，也未执行真实补报写入或发布。 |


## `REG-LINUXDO-003` 验证后的原页面恢复失败却提示成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 验证 Cookie 已保存，但原 Feed/Search/Topic/User 请求随后遇到普通网络或解析失败时，overlay 仍提示「页面已恢复」并关闭；写成功后的回复刷新也会被诊断为完整成功；根因：`LinuxDoReadResumeOutcome`、四类 read controller、引用帖恢复以及 `useVerificationController`/`useTopicActionsController` 对恢复终态的消费边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-LINUXDO-004` 过期 Cookie 被误判为已登录并阻断搜索

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | linux.do 原站已经显示「登录」，App 账号中心仍显示已登录；搜索继续调用登录接口并报限流，匿名外部 Google 搜索入口没有启用，写入口也可能继续按旧 Cookie 展示；根因：canonical `getCurrentUserProfile` 的服务端身份 oracle、`LINUXDO_WEBVIEW_PROBE_SCRIPT` 的页面登录探针，以及 `useVerificationController` 的 generation-safe 过期态提交。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-LINUXDO-005` 冷启动丢弃已确认终态并重新按 Cookie 猜登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已确认 linux.do 账号在每次冷启动先变 unknown/public，首页和搜索短暂换 lane、重复请求；或首次升级仅凭残留 Cookie 直接伪造登录；根因：`src/platform/storage/accountSessionStore.ts` → `useAccountStatusController` 本机恢复/一次性迁移 → ReadPlan/Search Query key。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-LINUXDO-006` 页面退出后的后台 Query 串扰验证与等级恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 用户已经离开 Search/Feed 后，旧搜索、AI 或分类请求仍在 More 页后台重启并拉起 linux.do、NodeSeek 或妖火面板；linux.do 验证开始后 Search 从登录 key 漂移到匿名 key，旧 recovery 失活，面板随即关闭又重开；「查看等级」命中 CF 时没有精确 recovery，验证流程清掉 Level cache 后反复取消、弹出或无法落地等级；根因：`useAppRuntime` 当前页面与各 route 的 `active` / 验证 overlay → Feed、Search、Account controller 的 Query 执行权；Search 的稳定认证模式 → 结构化 Query key 与 Gateway 参数；Level 的 exact active Query → `LinuxDoReadRecovery` 与 session reset 保留边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-LINUXDO-007` Account 网络探测失败后前台读取永久 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`TOPIC-03`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`USER-01` |
| 历史症状与根因 | 打开 linux.do Topic 后页面一直 Loading，既不请求 Topic，也不出现验证窗口；用户手动进入 linux.do 验证、保存状态并再次打开后才正常加载；根因：exact `/session/current.json` 的 canonical Account reader → direct/hidden WebView transport → 结构化身份检查终态 → `useAccountRuntime` 前台单站 intent → Feed/Search/Topic/User Query barrier 与验证面板。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-VERIFICATION-001` WebView 页面事件取代用户检测

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | linux.do、NodeSeek 或妖火面板在页面加载/跳转时自动保存、恢复或关闭；用户随后点击「检测状态/登录」却复用已消费的内部结果，没有重新读取当前凭据，最终出现「暂未生效」、旧结果覆盖新结果或开关循环；根因：WebView 的候选观察边界 → 用户显式检测的提交边界 → generation/session 所有权 → 原读取 recovery 的完成证明。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-VERIFICATION-002` 业务响应关键词被误判为验证页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | linux.do 搜索返回正常结果后却打开 CF 面板；面板显示已登录的普通首页，没有 challenge。用户点击「检测状态」时 WebView Cookie 已重新读取并保存，但恢复搜索再次被误判，于是仍提示「验证未生效」。NodeSeek 或妖火的 API、帖子正文出现相同关键词时也可能错误拉起验证/登录面板；根因：来源 transport 响应元数据与正文 → Cloudflare/访问验证分类器 → direct/WebView fallback → session recovery 与验证面板。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-VERIFICATION-003` 验证 WebView 使用伪造或过期 User-Agent

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04`、`FEED-01`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | NodeSeek Cloudflare 页面可以显示复选框，但用户每次点击后又回到未勾选状态，始终停留在 `Just a moment...`；相同身份错配也可能让 linux.do、NodeImage 或妖火的 WebView 会话不能被后续请求一致复用；根因：Android WebView provider 的默认身份 → NodeSeek、NodeImage、linux.do、妖火可见 WebView → probe/原生桥取得的真实 UA → Cookie/access 持久化 → 隐藏 WebView、媒体、读取与写操作。 |
| 当前 owner | `src/platform/android/androidWebViewUserAgentValue.test.ts` |


## `REG-VERIFICATION-004` 登录 WebView 超时后仍持续运行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`ACCOUNT-04`、`MORE-02`、`RELEASE-02` |
| 历史症状与根因 | 登录面板已经显示「页面打开超时」，但第三方页面仍在后台刷新；Android accessibility 无法读取 App 自有错误、刷新按钮或 `nodeseek-login-webview-settled`，Release Replay 永久等到失败；根因：登录面板 terminal outcome 与原生 WebView renderer 生命周期分属不同 state owner；timeout 被当成展示状态，而不是当前 generation 的结束边界。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-ACCOUNT-001` 身份读取失败覆盖已确认账号状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 历史症状与根因 | NodeSeek、linux.do 或妖火网站登录仍可能有效，但刷新账号状态时身份接口暂时失败，账号中心却把上次已确认的用户名清空并显示成新的 Cookie 状态；根因：`useAccountStatusController` 的站点检查终态与 `SiteSessionState` 的可信身份保留契约。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-002` 单站凭据读取失败阻断全部账号刷新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02` |
| 历史症状与根因 | NodeSeek、linux.do 或妖火任一 SecureStore 读取暂时失败时，「刷新账号状态」直接整体中止，其余站点状态全部停留在检查中；根因：`useAccountStatusController` 的多站凭据装配、站点隔离和诊断终态。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-003` 启动时单站凭据读取失败阻断其他会话恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | App 启动时只要 NodeSeek、linux.do 或妖火任一安全存储读取暂时失败，其他站已经保存的有效会话也不会恢复，账号中心可能一直显示初始匿名状态；根因：`useSessionController` 启动 effect 的多站凭据恢复、generation 所有权和最终状态汇总。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-004` 妖火明确登录失效被清理事件覆盖

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 妖火已明确返回登录失效时，账号中心最终却显示普通未登录，用户看不到凭据已过期这一可恢复原因；根因：`useAccountController.checkYaohuoCookie` 的失效确认、凭据清理和最终 UI 事件顺序。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-005` NodeSeek 登录桥接接受非站点页面消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-03`、`MORE-02` |
| 历史症状与根因 | NodeSeek 登录 WebView 加载允许的 Cloudflare challenge 页面时，该页面伪造或碰撞 `nodeseek-login` 消息即可污染 App 保存的用户 ID、User-Agent 或 Cookie 候选；根因：`useAccountController.handleLoginMessage` 的 WebView 消息来源信任边界。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-006` 单站凭据摘要失败隐藏其他已保存凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-03`、`MORE-02` |
| 历史症状与根因 | 账号中心首次读取保存凭据时，只要一站 SecureStore 暂时失败，其他站已保存的账号摘要也全部显示为未保存；根因：`accountCredentialDiagnostics` 的部分结果契约与 `useAccountCredentialController` 的状态合并边界。 |
| 当前 owner | `src/features/account/credentialDiagnostics.test.ts` |


## `REG-ACCOUNT-007` 登录凭据未清完却显示已清除或覆盖失效错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户明确清除 NodeSeek、linux.do 或妖火登录后，界面提示已清除，但 WebView Cookie 仍可能保留；反过来，账号检测、刷新或写操作误判失效时如果复用这条破坏性事务，会把原站会话一起删掉并造成重复登录；根因：`useSessionController` 的 multi-store 清理提交顺序、credential generation 返回契约，以及破坏性清理能力的调用权限边界。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-008` 单站刷新收尾失败阻断其他账号状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 账号公共刷新已完成各站网络检查后，妖火或 linux.do 的过期清理、NodeSeek 身份持久化任一步失败，其他站状态都不再应用；linux.do 明确过期还会最终显示成普通未登录/已验证；根因：`useAccountStatusController` 的站点检查结果与后续 multi-store 提交、最终 SiteSessionState 投影边界。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-009` 旧账号刷新覆盖刷新期间保存的新会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户点击刷新账号状态或发起写操作后在站点登录完成，先启动的旧请求仍可能把 NodeSeek、linux.do 或妖火的新会话覆盖成未登录、检查失败或登录已失效，并为新会话弹出错误登录入口；根因：`useAccountStatusController`、`useTopicActionsController` 与各站 action client 的 credential snapshot、异步请求、过期清理和 SiteSessionState/动作结果提交边界。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-PROXY-001` 代理配置读取失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-01`、`MORE-04` |
| 历史症状与根因 | 用户原本依赖服务器代理时，启动阶段 SecureStore 暂时读取失败，App 把代理状态当作「未启用」并让来源、登录 WebView 或更新请求直接联网；根因：`useNetworkProxyRuntime` 的安全存储加载终态、native apply effect 与 `ensureNetworkProxyReady` 门禁。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-UPDATE-001` 更新检查期间可下载旧版本信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | 已显示旧更新信息时，用户快速连续点击「检查更新」和「下载并安装」，旧 APK 下载可在新 manifest 检查尚未结束时启动；根因：`useAppUpdateRuntime` 的 check/download 并发所有权与同步 busy ref 门禁。 |
| 当前 owner | `tests/ui/more/app-update-runtime.test.tsx` |


## `REG-NODESEEK-001` NodeSeek WebView/会话状态被错误证明

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 代码或桌面浏览器看似能访问 NodeSeek，但不能证明 App 内 WebView、现有 Cookie、返回链和后续读取仍然可用；根因：App 内 login/session/verification controller、Cookie bridge、WebView readiness 和 navigation 返回。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 历史症状与根因 | NodeSeek 登录 WebView 已显示「页面打开超时」或加载失败，Replay 仍因 ready testID 可见而通过；根因：当时 `NodeSeekLoginHost` 的 WebView readiness/error 状态和对应 RNTL/Live 等待 oracle。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-NODESEEK-003` NodeSeek 真实页面已可用但 Replay 内部 marker 超时

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 历史症状与根因 | App 内 WebView 已出现可操作内容，Replay 却依赖第三方标题、logo、「新帖子」或 success-only 内部 marker；DOM 变化或桥接时序会让正确流程超时；根因：NodeSeek WebView 的设备级 oracle 及 `tests/tooling/android-smoke-guard.test.ts` 的 Replay 守卫；不是 NodeSeek 页面加载产品逻辑。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-DATA-001` ReaderData 实验与代码回退不兼容

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 新实验写入了旧代码不能读取的本机数据；代码回退后收藏、历史和关注看似丢失；根因：`src/domain/reader/readerData.ts`、`src/platform/storage/readerDataStore.ts`、备份导入和保存队列。 |
| 当前 owner | `src/domain/reader/readerData.test.ts` |


## `REG-OPS-001` 验证当前代码后留下旧 APK

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 开发构建验收通过后又恢复旧 Smoke APK，用户实际看到的仍是旧 bug；新增原生模块后若继续让旧 APK 加载新 JS，还会在访问对应页面时报 `Can't find ViewManager`。根因是跳过安装包 SHA 核对的安装/验收操作，而不是 Feed 业务代码。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-002` 设备侧录屏分片耗尽 Replay 空间

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | `APK_SANITY` 已通过，但 Replay 在第一个业务步骤前因 agent-device 无法写入录屏恢复清单而失败；设备 `/sdcard` 曾残留 471 个工具录屏分片并达到 92% 使用率；根因：`scripts/run-device-replay.mjs` 的 Replay session、设备端 durable recording manifest、`screenrecord` 与录屏 scratch 生命周期，而不是 App、Cookie 或业务存储。旧 runner 曾按进程名/路径批量终止并删除，无法证明目标属于当前 Replay。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-003` Replay 把设备 ID 当成设备名称

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | runner 已按 `emulator-5554` 找到唯一设备并验证 APK 身份，但第一条 Replay 在 `open` 步骤报 `No device named emulator-5554`，全部设备旅程无法开始；根因：`scripts/run-device-replay.mjs` 同时承担设备发现与 Replay 调用：设备发现接受 ID 或名称，但 agent-device 0.19.0 的 test runner 按显示名称绑定设备。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-004` AVD 名与设备显示名不一致导致 Replay 被拒绝

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 同一发布命令已经完成正式构建、签名校验和 `APK_SANITY`，随后 Replay 在身份行前报「无法唯一匹配 Android 设备」，发布闸门无法收尾；根因：Smoke 的 boot/install 接受 AVD 名，`scripts/run-device-replay.mjs` 的设备发现却只接受 ID 或完全相同的显示名，没有处理 agent-device 对下划线与空格的展示差异。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-005` 覆盖安装后的首次启动逃出日志窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 覆盖安装后的第一次启动发生崩溃，但脚本随后清空本机日志文件并执行第二次健康 relaunch，最终仍可能输出 `APK_SANITY`；根因：`scripts/smoke-android.mjs` 把建立 agent-device session 的第一次 `open` 放在受检查日志窗口之外；第二次启动证据不能证明新 APK 的首次启动没有失败。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-006` Replay 自行关闭 session 导致录屏复活并丢失 manifest

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | `agent-device test --record-video` 报告单条 Replay 通过，但设备录屏仍在运行；约 170 秒后旧 daemon 启动下一分片并覆盖唯一 active manifest，安全门禁随后停止整批 Replay；根因：`tests/device/*.ad` 与 agent-device test harness 的录屏收尾顺序，而不是 `scripts/run-device-replay.mjs` 的所有权门禁。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-007` 空 manifest 或原子写入临时文件绕过录屏门禁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 设备仍有 `agent-device-recording-active.json.tmp` 或零字节 active manifest，runner 却认为录屏基线为空并继续启动下一条 Replay；根因：`scripts/run-device-replay.mjs` 的设备 scratch basename 解析只识别时间戳 MP4，manifest 读取又把空内容视为不存在。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-008` 允许的 agent-device 版本不支持 Replay 参数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 版本门禁接受 agent-device 0.14.0，但第一条 Replay 因不认识 `--record-video` 或可重复 `--reporter` 参数而在业务步骤前失败；根因：`scripts/agent-device-runtime.mjs`、`scripts/run-device-replay.mjs` 与 README 的工具版本契约不一致。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-009` 未登录 Replay 与主设备套件混用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02`、`ACCOUNT-01`、`FEED-01`、`SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 | 未登录旅程若在已有账号/Cookie 的主设备或 Release Smoke 上运行，会得到登录态结果或要求清除主设备数据；反过来，主设备基线也可能被未登录测试破坏；根因：文件发现目录、设备选择和 APK 身份校验没有把「普通保留数据设备」与「从未登录论坛的隔离 AVD」建模为两个外部环境。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-010` agent-device 诊断污染设备清单 JSON

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | Replay 在任何旅程和 APK 身份行之前失败，报 `Unexpected non-whitespace character after JSON`；根因：`scripts/agent-device-runtime.mjs` 的 capture 路径把 stdout 与 stderr 拼接后作为机器可读结果返回。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-011` runner 覆盖 Replay 自有超时预算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 四来源 Feed 与 Search 已拿到结果并进入最后详情，却在目标加载成功前后报整条 `TIMEOUT after 180000ms`；根因：`scripts/run-device-replay.mjs` 的命令行 timeout 覆盖 tracked Replay 的 `context timeout`。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-012` 版本升级未递增 Android versionCode

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01` |
| 历史症状与根因 | 新版本已发布，但旧客户端因 manifest 的 versionCode 没有高于已安装版本而无法收到或安装更新；根因：`scripts/check-version.mjs` 的 Git release baseline 与 `scripts/release-android.mjs` 的 fail-closed 发布入口。 |
| 当前 owner | `tests/tooling/version-check.test.ts` |


## `REG-OPS-013` release keystore 路径延迟失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01` |
| 历史症状与根因 | keystore 路径错误时，完整测试和 clean prebuild 后才在 Gradle 报错，且相对路径可能按 `android/app` 而不是仓库根解析；根因：`scripts/release-android.mjs` 的签名环境预检与 Gradle 环境传递。 |
| 当前 owner | `tests/tooling/release-signing.test.ts` |


## `REG-OPS-014` Android Smoke 自相冲突的设备 session

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | Release APK 已完成构建、签名与覆盖安装，首次打开却报 `DEVICE_IN_USE`，完整发布流程无法结算；根因：`scripts/smoke-android.mjs` 把一次 APK sanity 生命周期拆成了两个互斥的 agent-device session。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TOPIC-001` 回复已筛选但标题仍显示主题总数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 切换「只看楼主」或「只看带图」、或执行评论内查找后，可见回复已经减少，但「回复列表 N 条」仍显示主题原始总回复数；根因：`src/features/topic/components/TopicContentList.tsx` 的回复标题计数直接读取主题总数，没有区分当前可见结果与未筛选总数。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-002` 从阅读设置返回后主题详情丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04`、`NAV-03` |
| 历史症状与根因 | 从主题右上菜单进入「阅读设置」后切回首页，原主题详情已经被弹出，用户回到首页列表而不是继续阅读原主题；根因：旧全局导航入口曾复用 `changeScreen('more')`，导致 `popTo('MainTabs')` 移除 Topic；后续 snapshot 方案仍把 native stack 已拥有的 route state 复制到全局。当前 seam 是 `src/features/topic/TopicRoute.tsx` 与 `src/app/appNavigation.ts`。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-TOPIC-003` 评论引用改动误伤正文引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 调整评论引用卡片后，主题正文里的引用也跟着改变；默认简介和展开后的完整帖子混在一起，或展开后仍只看到简介。评论最外层还可能被误改成逐条卡片；根因：`src/features/topic/components/TopicContentList.tsx`、`src/features/topic/components/TopicBodyQuoteCard.tsx` 与 `src/features/topic/components/ReplyItem.tsx` 的两套展示入口；`src/domain/forum/quotedPosts.ts`、`src/features/topic/useTopicController.ts`、`src/features/topic/useTopicSessionController.ts` 的引用标识、加载和 session 缓存；`src/sources/linuxdo/reader.ts` 的简介/完整帖数据边界；`src/features/topic/styles.ts` 与 `TopicContentBlock` 的四站回复间距。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-004` 主题图片尺寸探测与显示各加载一次

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 完整刷新含块级正文图片的主题时，图片先在约 100×100 的小框里转圈，容器放大后又转一次圈，最后才显示图片；同一图片重进也会发生明显尺寸跳变；根因：`src/features/topic/rendering/contentMediaRenderers.tsx` 的旧实现曾同时使用 `react-native-render-html` 的 `useIMGElementState`（内部 `Image.getSize`）和按 URL 加载的 `ExpoImage`，把同一图片拆成「尺寸探测」和「最终显示」两个生命周期；RNRH 未知尺寸默认 100×100，因而产生小框、放大和第二个 Spinner。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-005` V2EX 评论刷新失败却记录成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04`、`MORE-02` |
| 历史症状与根因 | V2EX 详情中执行「仅刷新评论」遇到网络失败时，页面提示失败，但同一次评论刷新诊断仍以 `success` 结束，导出的诊断会误导排障；根因：`src/features/topic/useTopicController.ts` 的 V2EX `refreshTopicReplies` 委托分支只判断 Promise 已结束，没有核对 Topic Query 是否成功写入了新数据。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-006` 图片保存快速双击写入重复文件

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片预览中快速点击两次「保存图片」，App 并行下载并向系统媒体库写入两份相同图片，随后还弹出两次成功提示；根因：`src/features/topic/media/useImagePreviewController.ts` 的保存动作没有同步 busy gate，Modal 按钮的每次点击都会创建独立异步任务。 |
| 当前 owner | `tests/ui/topic/image-preview-controller.test.tsx` |


## `REG-TOPIC-007` 同一引用被多个实例加载时重复请求或串错状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 同一正文或评论引用出现在多个位置并同时展开时，会重复读取同一楼层，或让一个实例的 Loading、内容和错误串到另一个 reference。离开原 Topic 后，旧引用与 linux.do 验证恢复还可能继续结算；根因：`src/features/topic/useTopicController.ts` 的引用 instance 状态与 TanStack Query 远端状态边界，以及 `src/platform/query/serverState.ts` 的结构化 reply key。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-WRITE-001` 首次投票后参与人数未更新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在 linux.do 首次提交投票成功后，所选项和票数已经更新，但当前页面的参与人数仍保持提交前的数值；根因：`src/domain/forum/topicActionState.ts` 的 `applyPollVoteToPolls` 只更新 `voted`、选中项和选项票数，没有同步参与人数。 |
| 当前 owner | `src/domain/forum/topicActionState.test.ts` |


## `REG-WRITE-002` 妖火收藏成功被误报为结果不明

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在妖火主题点击「原站收藏」后，原站已经把主题加入收藏夹，但 App 丢失重定向证据并提示「操作结果无法确认」；根因：`src/sources/yaohuo/actionClient.ts` 的请求 helper 只返回 HTML、丢弃最终 `Response.url`；通用解析器正确地拒绝从长页面文本猜测成功，却也无法知道该请求已经同源跳到收藏夹。旧开源代码中的二次表单流程与当前线上行为不一致。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-WRITE-003` 妖火收藏无法取消且页面不显示已收藏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 妖火原站收藏成功后，App 详情页仍显示未收藏样式；再次点击仍执行添加，无法从 App 取消收藏；重新进入主题也不能恢复原站收藏状态。收藏列表暂时不可用时，主题正文和回复也会一起加载失败，或者未知状态被误显示成「未收藏」；根因：`src/sources/yaohuo/actionClient.ts` 只返回成功文案并丢弃收藏记录 ID；`src/features/topic/actions/useTopicActionsController.ts` 始终构造添加请求且不应用状态；`src/sources/yaohuo/reader.ts` 未读取原站收藏状态，并曾把可选收藏查询放进主题加载的必需 `Promise.all`；旧全局 Topic runtime / 详情列表曾把 `undefined` 强制转换成 `false`，无法区分「未收藏」和「状态未知」。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-WRITE-004` 妖火收藏触发整页忙碌闪动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 在妖火主题点击收藏或取消收藏时，整页操作区会短暂变灰并闪动，而不是只更新收藏按钮；根因：`src/features/topic/actions/useTopicActionsController.ts` 把所有 pending mutation 都计入全局 `actionBusy`，没有沿用 `MutationVariables.busy`；收藏请求因此无法选择非全局忙碌路径。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-005` 妖火收藏确认后正文被重新提交并闪烁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 点击妖火「原站收藏」或「取消原站收藏」后，最终滚动位置看似不变，但正文会在约 170 ms 内闪一下；含图正文会短暂退回灰色 loading 占位，单张操作前后截图容易漏掉；根因：`src/features/topic/rendering/useHtmlRenderingController.tsx` 的链接处理曾直接依赖原始 `topicDetail`，导致 HTML renderer registry 重建；同时旧全局 Topic runtime 传入 route 的多个 action callback 闭包随原始详情换引用，嵌在 route renderer 内的收藏 Context 又使整棵 Topic screen 被重新提交。为稳定这些引用而在 render 阶段写 ref 又会让被 React 丢弃的 render 泄漏未提交状态。FlashList/HTML 图片因此可能重新进入加载态或采用错误引用。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-WRITE-006` 阅读设置返回覆盖已确认的原站收藏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03`、`TOPIC-04`、`NAV-03` |
| 历史症状与根因 | 妖火原站已经确认收藏或取消，但用户在请求期间打开阅读设置，返回后按钮恢复成请求前状态，App 与服务器不一致；根因：复制 route state 产生了第二个所有权；action 更新当前 Query/route 后，snapshot restore 又写回旧值。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-WRITE-007` NodeSeek 投票读取失败且提交后伪造票数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 主题正文保留 `nsapp://vote` 原始标记而没有可用投票卡片；多个投票标记中一个读取失败时详情仍被误报为完整成功。提交成功后 App 又只做本地 `+1`，把原站未返回的未知票数显示成 `1`，与刷新后的服务端结果不一致；根因：`src/sources/nodeseek/polls.ts` 的 NodeSeek 投票协议、`src/sources/nodeseek/topicParser.ts` 的标记解析、`src/sources/nodeseek/reader.ts` 的投票读取/清理和 partial 诊断、`src/sources/nodeseek/actionRequest.ts` 与 `src/sources/nodeseek/actionClient.ts` 的投票专用请求、`src/features/topic/actions/useTopicActionsController.ts` 的写后同步，以及 `src/domain/forum/topicActionState.ts` 的服务端快照/未知计数合并。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-WRITE-008` NodeSeek 不可逆投票未经确认直接提交

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 用户在 NodeSeek 投票卡片点提交后立即产生不可逆远端写入，没有机会核对选项或取消；根因：`src/features/topic/actions/useTopicActionsController.ts` 的站点分流与 non-idempotent mutation task；确认边界属于 NodeSeek，不属于公共 `TopicPolls` 或其他站点协议。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-009` NodeSeek 投票脱离正文被追加到底部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原帖中的投票标记位于正文中间，但 App 删除标记后把投票卡片统一追加到整段正文末尾，改变了原帖阅读顺序；根因：`src/sources/nodeseek/polls.ts` 的成功标记替换和正文分片、`src/sources/nodeseek/topicParser.ts` 的渲染表单占位，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的逐来源正文渲染边界。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-WRITE-010` NodeSeek 投票替换破坏正文段落并导致内容重叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`WRITE-03`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek 投票帖在 App 中残留字面量 `">`，投票卡片前后各多出一条正文分隔线；投票后的文字与 sticker 在底部重叠，而原站同一正文没有这些问题；根因：`src/sources/nodeseek/topicParser.ts` 的原站渲染 HTML 提取/投票表单替换、`src/sources/nodeseek/polls.ts` 的残留 marker 清理，以及 `src/features/topic/components/TopicContentList.tsx` 与 `src/features/topic/rendering/contentMediaRenderers.tsx` 的正文树与自定义投票 renderer 边界。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-ACCOUNT-010` NodeImage 旧授权与上传覆盖已清除凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | 用户取消授权或清除 NodeImage API Key 后，较早的保存、读取或上传仍可能迟到，重新写回旧 Key 或把旧上传结果插入当前草稿；根因：`src/sources/nodeimage/authFlow.ts` 的 phase/nonce、`src/features/account/useNodeImageAuthController.ts` 的 NodeSeek preflight/final reconcile、`src/platform/network/loginWebViewScripts.ts` 的注入边界、`src/sources/nodeimage/credentials.ts` 的 owner/generation，以及 `src/features/topic/actions/useTopicActionsController.ts` 的上传结果所有权。 |
| 当前 owner | `src/sources/nodeimage/authFlow.test.ts` |


## `REG-ACCOUNT-011` 隐藏 WebView 接受伪造来源的读取结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`SEARCH-04` |
| 历史症状与根因 | 恶意或被跳转的页面可以发送一个声称来自 NodeSeek 或 linux.do URL 的完成消息，使 App 接受非目标页面的 HTML、Cookie 或状态；根因：`src/features/account/useHiddenBrowserFetchController.ts` 对原生 message event URL 与 payload URL 的双重来源校验。 |
| 当前 owner | `tests/ui/account/hidden-browser-fetch-controller.test.tsx` |


## `REG-ACCOUNT-012` document.cookie 覆盖并丢失完整会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 隐藏 WebView 只回传 JavaScript 可见 Cookie 时，App 用它替换完整已存候选，导致 HttpOnly Cookie 摘要丢失并让后续身份判断基于不完整候选；根因：`src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的候选 Cookie 合并，以及把身份候选误当成 transport Cookie 的旧边界。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-013` NodeSeek 缺失 Cookie 未归类为会话失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已进入 NodeSeek 写操作但本机 Cookie 缺失时，只收到泛化「缺少凭据」错误，UI 无法进入明确的重新登录流程；根因：`src/sources/nodeseek/actionClient.ts` 在发请求前对空凭据的 typed source/login-required 分类。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-ACCOUNT-014` 损坏的会话存储被当成匿名

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | NodeSeek 或 linux.do 保存的会话 JSON 损坏后，App 把读取结果当成「未登录」，可能覆盖现场并隐藏真正的数据损坏；根因：`src/platform/storage/legacyCookieSnapshotMigration.ts` 与 `src/platform/network/managedCookies.ts` 的旧快照迁移、准确原生读取和错误分类。 |
| 当前 owner | `src/platform/storage/legacyCookieSnapshotMigration.test.ts` |


## `REG-ACCOUNT-015` 单个 Cookie 故障中止其余清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 清除站点登录时，一个 URL 读取或一个 Cookie 删除失败会阻止其他可达 Cookie 清除；已成功删除的 Cookie 也可能未 flush，却被误报为清理完成；根因：当时的 withNetworkProxyModule 生成器 生成的 `clearManagedLoginCookies` 对全部目标 Cookie、主线程 callback、回读确认与错误聚合的顺序。 |
| 当前 owner | `src/platform/network/managedCookies.test.ts` |


## `REG-DATA-002` 旧保存失败后设置写入丢失资料快照

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02` |
| 历史症状与根因 | 一次收藏/历史保存失败后，紧接着只改阅读设置，后一次成功写入可能只带设置而漏掉最新 ReaderData；根因：`src/app/useReaderRuntime.ts` 的提交队列与完整快照基线。 |
| 当前 owner | `tests/ui/library/reader-data-controller.test.tsx` |


## `REG-DATA-003` 配对写入与回滚双失败后仍继续保存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | ReaderData 已写入但 settings 写失败，连旧快照回滚也失败后，磁盘状态未知；后续 queued 保存仍继续，可能永久覆盖可恢复现场；根因：`src/platform/storage/readerDataStore.ts` 的原子补偿和 `src/app/useReaderRuntime.ts` 的未知状态熔断。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts` |


## `REG-DATA-004` 未知磁盘状态下相同备份被跳过

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-03` |
| 历史症状与根因 | 配对写回滚失败后，用户导入内容恰好与内存相同的备份，JSON 相等优化会跳过物理写，损坏或未知的磁盘仍未恢复；根因：`src/app/useReaderRuntime.ts` 的 no-op 去重与恢复强制写边界。 |
| 当前 owner | `tests/ui/library/reader-data-controller.test.tsx` |


## `REG-DATA-005` 关注用户统计保留非法值并漏算零值

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`USER-02`、`LIBRARY-02` |
| 历史症状与根因 | 老备份或异常来源中的负数、小数统计直接出现在关注用户；妖火主题或回复数为 0 时，总贴数又被当成缺失；根因：`src/domain/reader/readerData.ts` 的 UserProfile 统计清洗和妖火派生字段。 |
| 当前 owner | `src/domain/reader/readerData.test.ts` |


## `REG-FEED-005` 单站分类错误被当成空分类

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04` |
| 历史症状与根因 | 进入单站时分类请求失败，筛选栏静默显示为空，用户无法区分「该站无分类」和「加载失败」；根因：`src/features/feed/useFeedController.ts` 的单站 category 结果应用和错误通知边界。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-PROXY-002` 快速代理操作应用未提交或过期配置

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 快速保存、切换、启用或关闭代理时，原生层可能应用尚未持久化的配置或较早 profile；保存未改动的启用 profile 还可能让可用代理变成错误状态；根因：`src/platform/network/useNetworkProxyRuntime.ts` 的持久化队列、native apply 队列与 committed state。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-PROXY-003` 代理状态损坏后无法恢复直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 安全存储中的代理配置无法读取时，App 正确 fail-closed，但 UI 没有恢复入口，所有网络能力永久被阻断；根因：`src/platform/network/useNetworkProxyRuntime.ts` 的 recovery command 与 `src/features/more/components/NetworkProxyModal.tsx` 的显式直连重置入口。 |
| 当前 owner | `tests/ui/more/network-proxy-controller.test.tsx` |


## `REG-SEARCH-004` 单站重试被其他站错误误判失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 |「全部」搜索中重试一个失败来源，该来源已经成功返回，但其他来源保留的错误让这次重试仍提示失败；根因：`src/features/search/useSearchController.ts` 的来源级 retry completion 与聚合错误保留。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-005` 失败分页混入部分结果并推进 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站下一页返回部分条目同时带错误时，App 仍追加这些条目并推进 cursor；用户重试会跳过失败页或得到重复/缺口；根因：`src/features/search/useSearchController.ts` 的分页错误门禁、append 与 cursor commit 顺序。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-006` 未提交的 disabled Query 锁死首次搜索

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02` |
| 历史症状与根因 | 首次进入搜索页并输入关键词后，提交按钮仍是 disabled；点击没有网络请求，结果页永久停在「按键盘上的搜索键开始」；根因：`src/features/search/useSearchController.ts` 的 `searchBusy` 直接读取 disabled Query 的 `isPending`，没有先判断是否已经提交业务查询。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-007` 聚合搜索自动打开单站登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04`、`ACCOUNT-02` |
| 历史症状与根因 | 用户执行「全部」搜索时，某站需要登录或验证会突然打开该站 WebView/验证面板，打断其他站结果的渐进展示；根因：`src/features/search/useSearchController.ts` 的生产 effect 没有聚合门禁；旧单元测试只调用生产链路未使用的 action helper，因此在错误实现下仍通过。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-008` 聚合刷新失败隐藏错误并伪装旧结果成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-04` |
| 历史症状与根因 |「全部」中某站已有预览时再次搜索或重试，该站刷新失败后仍只显示旧结果，没有错误或重试入口，看起来像本次刷新成功；根因：`src/features/search/useSearchController.ts` 的 aggregate group 投影先返回 `query.data`，导致 `SearchPageError.result` 永远不可见。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-TOPIC-008` linux.do 正文用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`NAV-02` |
| 历史症状与根因 | 点击 linux.do 正文中的 `/u/alice` 会离开 App 打开外部页面，无法进入现有用户详情和返回链；根因：`src/domain/forum/links.ts` 的 forum user link 解析、base URL 解析与受信来源映射。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-009` 评论查找把高亮插入 HTML 属性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 评论内查找的关键词出现在带引号且含 `>` 的属性时，App 把 `<mark>` 插进 attribute，破坏链接或正文 HTML；根因：`src/domain/forum/text.ts` 的 quote-aware HTML token scanning 与高亮边界。 |
| 当前 owner | `tests/integration/feature-helper-contracts.test.ts` |


## `REG-TOPIC-010` 长按复制泄漏 HTML 属性片段

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 长按复制含 `title="1 > 0"` 等属性的评论时，剪贴板混入属性后半段，而不是纯可见正文；根因：`src/domain/forum/text.ts` 的 `stripHtml` 可见文本提取。 |
| 当前 owner | `tests/integration/feature-helper-contracts.test.ts` |


## `REG-TOPIC-011` Sticker 属性中的大于号破坏正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek sticker 的 `title` 或其他引号属性包含 `>` 时，sticker 被切断、删除或把后续正文吞掉；根因：`src/domain/forum/forumContentMedia.ts` 在 sticker/image regex 前的 quoted-tag normalization。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-TOPIC-012` 通用 HTML 文本与 mention 解析误切属性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | HTML 属性含引号 `>` 时，可见文本提取泄漏属性碎片；同一标签上的用户 mention 也可能失去 App 内 mention 样式和导航；根因：`src/domain/forum/html.ts` 的共享 `textContentFromHtml` 与 `src/domain/forum/topicContentHtml.ts` 的 render normalization。 |
| 当前 owner | `tests/integration/html-sanitization-contracts.test.ts` |


## `REG-TOPIC-013` 妖火裸域主题链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-02` |
| 历史症状与根因 | `https://yaohuo.me/bbs-654.html` 被样式标为站内链接，却仍通过外部浏览器打开；根因：`src/domain/forum/links.ts` 的妖火 host allowlist 与 canonical topic URL。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-014` 图片下载无超时导致保存永久忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 远程图片下载永不 resolve 时，保存操作和忙碌状态永久悬挂，用户无法得到失败反馈或重试；根因：`src/platform/media/imageSave.ts` 对远程图片下载复用受控 `fetchWithTimeout` 的边界。 |
| 当前 owner | `src/platform/media/imageSave.test.ts` |


## `REG-TOPIC-015` 现代图片格式被错误保存为 JPG

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | AVIF、HEIC、APNG 或 BMP 图片下载后被命名为 `.jpg`；动态地址返回 SVG 等与 URL 后缀不同的图片时，又会沿用误导性后缀，导致扩展名与字节内容不一致，图库或分享应用可能无法识别；根因：`src/platform/media/imageSave.ts` 的 URL/Content-Type 图片扩展名归一化。 |
| 当前 owner | `src/platform/media/imageSave.test.ts` |


## `REG-TOPIC-016` V2EX 致谢数被图标属性截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | V2EX 回复致谢图标属性包含引号 `>` 时，致谢数缺失或解析错误；根因：`src/sources/v2ex/reader.ts` 的 thanks 文本提取改用共享 `textContentFromHtml`。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-017` 分享与剪贴板连续失败时异常逃逸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04` |
| 历史症状与根因 | 系统分享失败后，作为 fallback 的剪贴板复制也失败，点击事件 Promise 被拒绝且用户没有任何反馈；根因：`src/features/topic/shareTopic.ts` 的双层 fallback 收口与 `src/features/topic/TopicRoute.tsx` 的菜单调用。 |
| 当前 owner | `src/features/topic/shareTopic.test.ts` |


## `REG-TOPIC-018` Android 不兼容的动态 SVG 被当作图片加载失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 主题里的报告图片 URL 以 `.png` 结尾、实际返回 `image/svg+xml` 时，Android 正文显示「图片加载失败」；简单改成 data URI 仍使用同一 AndroidSVG decoder，全屏也可能空白；根因：`src/platform/media/compatibleImageSources.ts` 的 SVG document artifact、`src/features/topic/rendering/previewRenderers.tsx` 的海报 native view/几何、`src/ui/media/ImagePreviewModal.tsx` 的全屏 renderer 切换。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-019` NodeSeek 私有媒体在预览和保存时丢失实时会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek 受保护图片可在正文中显示，点开全屏、播放视频或保存时却重新发起匿名请求，或继续使用持久化旧 Cookie，得到登录页、403 或加载失败；根因：原生 managed OkHttp client、Expo Image loader、`src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Video source、图片预览与 `src/platform/media/imageSave.ts`。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-020` Android 不兼容 SVG 在非当前预览页抢占昂贵恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 多图预览会让当前原图与相邻复杂 SVG 同时启动 Chromium/海报兼容恢复，导致当前图片继续等待、手势掉帧或出现多份昂贵渲染；根因：`src/ui/media/ImagePreviewModal.tsx` 的页面 active 状态与 `src/platform/media/compatibleImageSources.ts` 的兼容恢复入口。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-022` 凭据观察事件取消正在执行的同站 Query

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`USER-01`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek 主题详情或关注用户页进入后长期停在「正在读取」；网络请求本可成功，但页面既不显示结果也不进入可重试失败态。真实登录切换、过期或清除时还可能继续显示旧会话的首页、搜索、详情或用户数据。妖火及其他复用同一会话事件边界的读取存在同类风险；根因：`src/features/account/useSessionController.ts` 的 workflow 事件分类与 session epoch、`src/platform/query/serverState.ts` 的 source/`all` Query cache 边界，以及 TanStack Query observer 的取消结算语义。 |
| 当前 owner | `tests/integration/query-session-contracts.test.ts` |


## `REG-TOPIC-023` 回复分页验证恢复重取旧页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`TOPIC-01`、`ACCOUNT-02` |
| 历史症状与根因 | linux.do 回复第二页遇到验证后完成验证，界面提示恢复完成，但新回复没有出现；再次加载仍可能重复进入验证或网络请求；根因：`src/features/topic/useTopicController.ts` 的 Infinite Query error 类型、精确验证恢复操作与 `ReplyPageParam`。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-UPDATE-002` 系统未打开安装确认却提示已开始

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | Android 原生安装请求返回 `false`、没有显示系统确认页时，App 仍提示安装已开始或成功；根因：`src/platform/update/appUpdate.ts` 的 APK 检查、安装请求返回值与 controller 成功提示契约。 |
| 当前 owner | `src/platform/update/appUpdate.test.ts` |


## `REG-UPDATE-003` Release manifest 接受任意自洽 signer

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 历史症状与根因 | Release 资产被替换后，攻击者可用另一把私钥生成 APK 和自洽 manifest，App 下载完成后才依赖系统安装器拒绝，不能在检查更新阶段指出 signer 不可信；根因：`src/platform/update/appUpdate.ts` 的 manifest trust root 与 `app.json` 的 `expo.extra.releaseSignerSha256`。 |
| 当前 owner | `src/platform/update/appUpdate.test.ts` |


## `REG-UPDATE-004` APK 检查把签名历史的最老证书当作当前 signer

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04`、`RELEASE-01` |
| 历史症状与根因 | APK 存在签名历史时，检查器返回旧证书摘要；多 signer APK 还可能任选第一个，导致错误接受或拒绝；根因：当时由 plugin 生成的 `ApkInstallerModule.apkSignerSha256`。 |
| 当前 owner | `modules/forum-platform/android/src/main/java/com/wz/reader/update/ApkInstallerModule.kt` |


## `REG-USER-001` 用户页跨 Tab 分页留下永久忙碌 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 主题分页尚未完成时切到回复并加载更多，其中一个 tab 会接管共享请求状态；另一个 tab 的 cursor 永久 busy，切回后无法重试；根因：`src/features/user/useUserController.ts` 的 profile Query 与 topics/replies 两个 Infinite Query 的 key、`pageParam` 和派生状态边界。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-USER-003` 妖火裸域用户链接被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`NAV-02` |
| 历史症状与根因 | 妖火裸域 `userinfo.aspx` 链接无法进入 App User，而是外部打开；根因：`src/domain/forum/links.ts` 的妖火 user host 识别和参数提取。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-USER-004` Discourse 公开用户 Tab 被外部打开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`NAV-02` |
| 历史症状与根因 | linux.do的 `/u/alice/summary`、`/activity` 等公开 profile tab 被外部打开，尽管 App 已有同一用户页；根因：`src/domain/forum/links.ts` 的 Discourse public profile suffix allowlist。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-USER-005` 新用户的零统计被当成缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`LIBRARY-02` |
| 历史症状与根因 | 新用户明确有 0 主题、0 回复或 0 帖子时，App 隐藏统计，用户看到的状态与来源不一致；根因：`src/sources/linuxdo/account.ts`、`src/sources/nodeseek/protocol.ts`、`src/sources/yaohuo/normalization.ts` 与 `src/sources/v2ex/reader.ts` 的可选非负统计归一化。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-USER-006` Profile 已显示 cursor 但 Infinite Query 尚未接管分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 用户页已经显示首屏和「可继续加载」，此时立即加载更多却没有任何网络请求、错误或提示；稍后再试才可能生效；根因：`src/features/user/useUserController.ts` 的 Profile Query 首屏 seed、两个 Infinite Query observer 与分页命令提交边界。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-WRITE-011` 删除回复后本地详情仍保留楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 服务器已确认删除回复，但当前详情和回复分页仍显示该楼层、回复数不变；若编辑器正回复该楼层，还会继续指向不存在对象；根因：`src/features/topic/useTopicSessionController.ts` 的 `reply-deleted` action update、列表去重和 composer target 收口。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-012` 妖火缺少确认链接仍被报告删除成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02` |
| 历史症状与根因 | 妖火删除预备页只含「确认删除」等普通文案但没有可执行确认 URL 时，App 仍提示删除成功，实际回复尚在；根因：`src/sources/yaohuo/actionClient.ts` 的两阶段删除协议、same-origin confirmation link 与结果分类。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-WRITE-013` NodeSeek 暴露未确认的删除入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02` |
| 历史症状与根因 | NodeSeek 回复菜单显示「删除」，点击后只能进入不受支持或失败路径；原站当前没有已确认的删除协议；根因：`src/domain/forum/sourceCatalog.ts` 的逐来源、逐 action capability。 |
| 当前 owner | `src/domain/forum/sourceCatalog.test.ts` |


## `REG-WRITE-014` 异常百分号文件 URI 使图片上传崩溃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04` |
| 历史症状与根因 | 系统图片选择器返回文件名含残缺 `%` 转义的 URI 时，上传前 `decodeURIComponent` 抛错，图片被丢弃或事件链异常退出；根因：`src/sources/nodeimage/upload.ts` 的 asset filename normalization。 |
| 当前 owner | `tests/integration/image-upload.test.ts` |


## `REG-WRITE-015` NodeSeek 签到复用残留 Topic mutation 身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04` |
| 历史症状与根因 | 离开 linux.do 或妖火详情后从账号中心执行 NodeSeek 签到，操作可能按上一个 Topic 串行并取消其详情/回复 Query，签到的 mutation 诊断来源也错误；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 TanStack Mutation key/scope 与 NodeSeek 全局账号动作边界。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-016` 账号状态与 Topic 写入口读取相反的会话投影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 账号中心显示某站已登录，但详情没有应有写入口；或账号已进入验证/失效状态，详情却继续开放回复；根因：`src/features/account/useAccountRuntime.ts` 向 `src/features/topic/TopicRoute.tsx` / `actions/useTopicActionsController.ts` 投影 writable session 能力的边界。 |
| 当前 owner | `src/features/topic/actions/topicActionDecision.test.ts` |


## `REG-ACCOUNT-018` 等级刷新失败被保留的旧数据误报为成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04` |
| 历史症状与根因 | linux.do 等级成功加载过一次后，再次刷新失败仍提示成功并继续展示旧等级，用户无法知道本次请求失败；根因：`src/features/account/useAccountController.ts` 的刷新结果投影先判断 retained data，再判断当前 error。 |
| 当前 owner | `tests/ui/account/account-controller.test.tsx` |


## `REG-ACCOUNT-019` 三站登录态投影不一致

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 当前登录已经失效，搜索 transport 已回退 Google，但 More 与搜索状态灯仍显示已登录，Topic 写入口也可能继续开放；公开页里的业务文案或旧 Topic 身份又可能被误当当前用户；修复共享缓存 seam 时还可能把旧登录带进新 generation 或误清其他站身份；根因：当前凭据验证与按 ID 公开资料、Topic 身份或 Cookie 候选混用；WebView probe 缺少文档所有权；妖火把业务文字或「未识别为退出」当成功；Discourse reader 没有完整区分明确匿名与协议不确定；Account Query 与 session epoch 更新时序既可能擦掉刚提交的身份结果，也可能通过全局 previous data 保留旧登录。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-020` 妖火检测成功但重启后登录丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户已在 App 内妖火页面登录，点击「检测登录」能立即显示真实账号；强制结束并重启 App 后却又变成未登录，后续每次进入都要求重新登录；根因：`src/sources/yaohuo/reader.ts`、`src/sources/yaohuo/actionClient.ts` 的显式 Cookie 与原生 CookieJar 双重所有权，以及 `src/features/account/useAccountController.ts` 的 verifier 候选与 transport 身份边界。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-ACCOUNT-021` linux.do 已登录但检测只保存验证信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`MORE-02`、`SEARCH-04`、`WRITE-01` |
| 历史症状与根因 | App 内 linux.do 页面已经显示当前账号，点击「检测状态」却只保存 Cloudflare 验证信息，弹层与其他入口没有同步成已登录；重启后读取账号接口又能显示真实账号；根因：`src/features/account/useVerificationController.ts` 的 WebView probe 发起、当前文档所有权和手动检测结算边界。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-ACCOUNT-022` NodeSeek 登录成功后仍回到游客页并反复验证

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02` |
| 历史症状与根因 | 用户在 App 内完成 NodeSeek 账号提交和 Cloudflare 验证，站点已签发新身份 Cookie，却跳回游客首页；再次填入或检测会重新加载 WebView、重新拉起验证，形成「登录成功但仍未登录」的循环；根因：原生 `clearManagedLoginCookies` 对 Cookie 身份与完成条件的建模，以及登录 WebView 把消息 attempt 错当组件身份。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-ACCOUNT-023` 普通凭据读取把已确认登录降级

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原站和 More 刚确认已登录，切到 Search 后却立即显示匿名外部 Google 搜索入口且状态灯熄灭；Topic 写入口也可能随普通读取关闭。linux.do 隐藏读取和妖火 Cookie 恢复存在同类风险；根因：`src/features/account/useSessionController.ts` 的被动凭据生产者与 `src/domain/session/siteSessionState.ts` 的身份 reducer 共用一个布尔字段，缺失证明和明确登出没有分开；低可信 Cookie 事实因此覆盖高可信 current-user 结论。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-ACCOUNT-024` NodeSeek 不存在的当前账号端点触发登录 Cookie 清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 原站和账号中心已经显示登录，离开后刷新账号状态却变成失效；再次进入原站发现账号也被退出，用户必须重新登录；根因：个人中心初版把带 ID 的公开资料路由推测成了无 ID 的当前账号路由，又把未经验证的 HTTP 状态提升为明确游客证据；`src/features/account/useAccountStatusController.ts` 随后正确但破坏性地信任 typed expiry 并清理 Cookie。当前 NodeSeek 前端只用 `/api/account/getInfo/{id}` 读取公开资料，并从页面注入的 `__config__.user` 读取当前用户；日志中 `user GET 404 text/html → clear-login-only → login-cleared → login-expired` 构成完整事故链。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-025` 臆造当前身份接口或失效语义导致误登录/误清理

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户在原站确实已登录，账号刷新却因一个推测接口或未经契约证明的 HTTP 状态变成失效并清掉登录；反向场景中，代码只因为 Cookie、公开资料或普通页面内容存在就显示已登录。妖火已登录时，手动检测还可能被写死的 `sidyaohuo` 名称门禁提前挡住，或只保存数字 ID；已经从当前页证明本人身份后，公开资料补全失败又会错误地把账号打回未登录；根因：当前身份 endpoint 的来源门禁、每站登录/退出证据与破坏性清理权限，以及「验证当前凭据」和「读取公开资料」的边界。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-ACCOUNT-026` App 快照回灌或自动清理破坏原站 WebView 会话

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 用户已经在原站 WebView 登录，账号检测或刷新偶发误判后，重新进入原站发现登录被清掉并被迫反复登录；另一种表现是隐藏 fallback 把 SecureStore 旧 Cookie 作为首跳 header 写回 WebView，使旧会话覆盖当前原站状态。某些账号虽然有可验证候选，却因为缺少一个写死的 Cookie 名而直接显示未登录；根因：原站 Cookie jar、App 内请求快照和登录投影没有明确所有权；破坏性清理能力被当作身份判定的附带动作；隐藏 WebView transport 暴露 App 快照；Cookie 名摘要被提升为协议结论。 |
| 当前 owner | `tests/ui/account/hidden-browser-host.test.tsx` |


## `REG-ACCOUNT-027` React Native 请求隐式读写 WebView CookieJar

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | App 读取原站 Cookie 发起请求后，服务端响应的 `Set-Cookie` 又经 React Native 默认 CookieJar 改写 WebView 会话，导致账号状态、原站页面和后续请求相互污染。若为隔离 Cookie 另建 client，还可能绕过代理 fail-closed 与既有连接资源；根因：`src/platform/network/request.ts` 的受管 credentials 边界、`src/sources/readGateway.ts` 的 public `native-no-cookie` 最外层边界与 当时的 withNetworkProxyModule 生成器 生成的共享 OkHttp client 必须共同表达两条不同 lane。 |
| 当前 owner | `src/platform/network/request.test.ts` 与 `modules/forum-platform/android/src/test/java/com/wz/reader/network/ManagedCookieResponsesTest.kt`；旧的「一律禁止响应写入」已收窄为「默认 Jar 不写，仅合格 L 站原站响应可写」，其他隔离继续保留。 |


## `REG-ACCOUNT-028` 空凭据被动读取误清可信身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | NodeSeek 已在 More 确认登录后，旧实现的普通读取恰好没有从 CookieManager/旧 SecureStore 快照取得值，账号状态会先变成需要验证、再变成未登录；current user、确认时间和私有 Query scope 一并丢失；根因：`src/features/account/useSessionController.ts` 的 NodeSeek 凭据持久化、被动观察和身份投影共用同一副作用分支；`cleared` 没有限定为用户明确清除事务。 |
| 当前 owner | `src/features/account/sessionQueryOwnership.test.ts` |


## `REG-ACCOUNT-029` 手工 Cookie 白名单破坏原生请求身份完整性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | App 冷启动后 Feed、Categories 或账号读取明明处于原站登录会话，却更频繁收到 403/Cloudflare 并进入缓慢 WebView fallback；去 More 刷新后表面恢复，但 direct request 仍可能失败。受保护图片、视频或保存下载也可能因另一份旧 Cookie header 表现不同；根因：`fetchWithTimeout`、NodeSeek/linux.do/妖火 source/action clients、媒体 transport 与 Android `CookieManager` 之间存在多份 Cookie 传输所有者。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-ACCOUNT-030` React Native/Fresco 替换只读 CookieJar

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-02`、`USER-01`、`ACCOUNT-01`、`MORE-01`、`WRITE-01` |
| 历史症状与根因 | 当前 Android 包连接 Metro 后在 `MainActivity` 显示「There was a problem loading the project」，堆栈为 `JavaNetCookieJar cannot be cast to CookieJarContainer`；若只换成默认可变容器规避崩溃，RN/Fresco 又会恢复可写 `ForwardingCookieHandler`；根因：当时的 withNetworkProxyModule 生成器 生成的共享 OkHttp client 同时承担 RN Networking、Fresco、Expo Image、代理和 WebView Cookie 只读边界，却没有满足 RN 的容器生命周期契约。 |
| 当前 owner | 模块内 `NetworkProxyRuntimeTest`；容器继续拒绝 RN/Fresco 替换，合格 L 站响应通过独立受控入口，不恢复默认可写 delegate。 |


## `REG-ACCOUNT-031` 登录页面打开即破坏会话，关闭后又继续信任旧账号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`FEED-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | 只要进入登录/验证页，原本有效的 WebView 登录态就被 App 清除或旧快照覆盖；反过来，用户在页面内退出或切换账号后直接关闭，账号中心、私有缓存和写入口仍继续信任旧账号，直到手动点击检测；根因：登录 surface 生命周期、Account identity、WebView Cookie 所有权、Query cache scope 与写权限分别维护；打开页面被误当成登出事务，关闭页面又没有强制 identity reconciliation。 |
| 当前 owner | `src/domain/session/authSurfaceCoordinator.test.ts` |


## `REG-ACCOUNT-032` 妖火已登录会话在身份核对时打开登录页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 账号中心仍显示妖火用户名和已登录状态，点入后却先打开登录页；点击「检测登录状态」后页面立即恢复为「我的地盘」；根因：当时 `YaohuoLoginHost` 用 `canWrite` 选择登录页或会话页，把「身份核对期间禁止写入」误当成「已经退出」。 |
| 当前 owner | `tests/ui/account/account-site-panels.test.tsx` |


## `REG-ACCOUNT-033` 妖火匿名 Cookie 被误判为清理失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 用户点击「清除登录」后收到「登录 Cookie 删除未确认」，但妖火匿名页面会继续保留或重建会话辅助 Cookie；根因：原生清理事务把三个目标 Cookie 名「全部消失」当作退出 oracle，没有区分认证标记与匿名会话辅助 Cookie。 |
| 当前 owner | `modules/forum-platform/android/src/main/java/com/wz/reader/network/NetworkProxyModule.kt` |


## `REG-ACCOUNT-034` 妖火旧版 www domain Cookie 未被清除

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 点击「清除登录」后提示删除未确认；随后点击「检测登录」，远端页面立即恢复为原登录账号；根因：`clearManagedLoginCookies` 没有为 `Domain=www.yaohuo.me` 写同名过期 Cookie，因此有效 `sidyaohuo` 继续随 `www.yaohuo.me` 请求发送。 |
| 当前 owner | `modules/forum-platform/android/src/main/java/com/wz/reader/network/NetworkProxyModule.kt` |


## `REG-ACCOUNT-035` Account 已结算但请求仍读取旧身份，验证恢复先重试后关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | 登录/验证已经确认同一账号或新账号，紧接着恢复的读取或写入仍看到旧 identity/epoch；linux.do/NodeSeek 面板还可能在原 Query 已恢复时继续挂载，使恢复请求再次落入登录 surface；根因：稳定 Account snapshot、auth surface registry 和恢复回调的提交顺序；若身份再镜像到 React ref/workflow，probe Promise 与请求时刻读取会观察不同 owner。UI 可见性被误当作事后清理而不是恢复前屏障。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-036` 妖火多 scope SID 选择了匿名值或错误账号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`WRITE-01`、`WRITE-02` |
| 历史症状与根因 | 妖火 Cookie header 同时含 host/domain scope 的多个 `sidyaohuo` 时，回复或删除可能拿到空值、匿名 `-2`，或任意选择一个冲突的有效 SID；根因：`extractYaohuoSid` 没有把匿名辅助值、重复 scope 和冲突身份分开，request builder 在未建立唯一 owner 时继续生成 transport。 |
| 当前 owner | `src/sources/yaohuo/actionRequest.test.ts` |


## `REG-ACCOUNT-037` 可读公开页让真实未登录账号长期停在 unknown

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 全新隔离 AVD 没有论坛登录数据，NodeSeek 与妖火公开页面都能正常打开，但账号中心长期显示「登录状态待确认」；未登录 Replay 在进入搜索前即失败，NodeSeek 的外部 Google 入口和妖火的登录限制均无法按权威匿名态分流；根因：内容 transport 把「业务 DOM 已可读」「页面所有资源已结束」和「身份协议已结算」混成 ready 条件；NodeSeek 最初没有桥接渲染 runtime 的精确匿名值，后续虽能识别该值，Account script 仍被 `onLoadEnd` 阻塞。妖火最初没有在首页 unknown 后补读登录 form；补读后又让通用验证码特征覆盖了更强的完整登录 form 退出证据。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-ACCOUNT-038` NodeImage 已有会话仍重复 Connect 且授权成功后不自动完成

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | 用户点击 NodeImage 授权后页面没有自动保存或关闭，只能继续点原站按钮；多次点击最终看到「每天只允许 20 次连接」。已有 NodeImage 登录态时仍可能每次消耗 Connect 配额，上传失败还会再次拉起授权；根因：NodeSeek canonical 身份、NodeImage 独立 session Cookie 与 SecureStore API Key 三份状态被压成一个「重新授权」动作；WebView 文档生命周期、Connect 配额和上传错误恢复缺少单向状态机与一次结算边界。 |
| 当前 owner | `src/platform/network/loginWebViewScripts.test.ts` |


## `REG-FEED-006` 多页 Feed 刷新失败后跳过失败页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-04` |
| 历史症状与根因 | 已加载多页的单站 Feed 刷新时后续页失败，用户再次加载却直接请求更后面的页，失败页内容永久缺失；根因：`src/features/feed/useFeedController.ts` 把任意 Query error 当成 load-more error，没有用 `isFetchNextPageError` 区分 refetch 与分页失败。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-SEARCH-009` 搜索失败响应进入可信 Query data

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 某来源首次搜索失败或要求登录/验证时，页面可能把它当作成功空结果，错误状态不稳定，失败对象还会留在 Query cache；根因：`src/features/search/useSearchController.ts` 的聚合与单站 queryFn 直接 return 业务失败对象，而不是 reject `SearchPageError`。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-010` 多页搜索刷新失败后跳到下一 cursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 单站搜索已加载多页后刷新，后续页失败；用户继续滚动会跳过失败页请求下一 cursor，结果出现永久缺口；根因：`src/features/search/useSearchController.ts` 把 refetch error 误当成 `fetchNextPage` error，并从旧末页推导更后 cursor。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-011` 同 key 搜索刷新不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02` |
| 历史症状与根因 | 单站同条件重新搜索时旧结果仍在，但提交按钮和来源区块都不显示请求进行中，用户可能重复提交；根因：`src/features/search/useSearchController.ts` 的 busy/loading 投影只读取初次 pending，没有覆盖 retained-data refetch。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SEARCH-012` 旧搜索结果为新输入打开动作面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-04` |
| 历史症状与根因 | 用户提交关键词 A 后立即把输入改成 B，A 的迟到登录/验证结果仍突然打开面板，看起来像 B 触发；根因：`src/features/search/useSearchController.ts` 的 action effect 只看 Query 结果与来源，没有确认当前输入仍归属于该次 submitted search。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SOURCE-003` 主动取消被诊断为来源失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 | 切换来源、条件或离开页面取消请求后，诊断把 transport 的 abort rejection 记录成网络失败，污染问题定位并可能触发错误 UI；根因：`src/features/feed/useFeedController.ts` 与 `src/features/search/useSearchController.ts` 的 catch 只按 error 类型归类，没有优先读取请求 signal 的当前状态。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-SOURCE-004` linux.do 受管请求并行维护两条认证链

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 同一次 linux.do 请求中 Gateway 已识别登录态，adapter 却再次读取 SecureStore；两次读取不一致或第二次失败时，请求可能匿名发送、误报存储错误，或与 Query key 的认证身份不一致；根因：`src/sources/readGateway.ts` → 当时的 `discourseRead` 转发层 → `src/sources/linuxdo/reader.ts` 的认证上下文没有显式贯穿，导致 Gateway 与 adapter 同时拥有 credential read。 |
| 当前 owner | `src/sources/readGatewayContract.test.ts`、`src/sources/sourceAccountRead.test.ts` 与 `src/sources/linuxdo/reader.test.ts` |


## `REG-SOURCE-005` 冷启动 fallback 的后台账号请求取消前台列表

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 冷启动直接进入首页时 Feed 或 Categories 请求显示取消/失败；去 More 刷新账号后再回来却能加载，形成「账号刷新修好了网络」的假象；根因：`src/features/account/sessionQueryOwnership.ts`、`src/features/account/browserFetchQueue.ts` 的隐藏 WebView 调度，以及 NodeSeek / linux.do reader 调用方没有标注用户可见优先级。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-SOURCE-006` fallback 排队时间耗尽请求超时并跨任务取消

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 请求尚在等待隐藏 WebView 执行权就达到 15 秒超时；用户只取消一个页面请求，却连带使同站其他 fallback 失败或释放错误任务；根因：`src/platform/network/request.ts` 的 timeout 所有权、`nodeseekFetchFallback` / `linuxdoFetchFallback` 的 handoff，以及隐藏 WebView 队列的 per-task Abort/执行时钟。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-SOURCE-007` 身份核对中的四站被误报暂不可用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | App 偶发进入时三个可登录站点同时显示「暂不可用」，但 V2EX 等公开列表已经正常刷出；数秒后三个错误又自行消失；根因：`ReadGateway` 曾把账号核对 activity 当成来源不可用；聚合 adapter 跳过请求后又生成与真实凭据故障相同的来源错误。 |
| 当前 owner | `src/domain/forum/readPlan.test.ts` |


## `REG-TOPIC-024` linux.do 回复页复用模块全局旧 stream

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | linux.do 主题的回复 stream 已在服务端变化后，后续分页仍按旧 post ID 列表读取，可能缺少新回复或请求已不存在的楼层；根因：`src/sources/linuxdo/reader.ts` 的 `topicStreamCache` 成为 TanStack Query 之外、未按会话和请求生命周期约束的第二份服务端状态所有者。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-025` 完整刷新拼接新首屏与旧回复页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-04` |
| 历史症状与根因 | 主题完整刷新后首屏是新内容，后续回复和 cursor 却来自刷新前快照，造成重复、缺楼或继续从错误位置分页；根因：`src/features/topic/useTopicController.ts` 只替换 replies cache 的第一页，保留旧 pages、pageParams 和 next cursor。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-026` Discourse 系统动作与解决方案沿用普通回复模板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`WRITE-03` |
| 历史症状与根因 | linux.do 的关闭/重开事件被显示成空白普通楼层，带等级、楼层号和点赞等操作；主题正文后缺少原站的已采纳答案区，采纳回复本体也只有作者栏「已采纳」小标签，没有明确的解决状态；根因：`src/features/topic/components/TopicContentList.tsx` 的主题正文尾部、`src/features/topic/components/ReplyItem.tsx` 的共享 Discourse 回复模板，以及 `src/features/topic/useTopicController.ts` 的精确楼层 Query。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-USER-007` 用户页刷新保留旧分页快照且不显示忙碌

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 用户页已经加载多页后刷新，页面没有忙碌反馈；刷新完成仍混有旧后续页和旧 cursor，可能显示已删除内容或跳过新内容；根因：`src/features/user/useUserController.ts` 的 refresh 只 invalidates 首屏 seed，并以 pending 而非 fetching 投影 busy，未用新 profile 替换完整分页快照。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |


## `REG-WRITE-017` 写成功后定向回复刷新在 Query 重构中丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`TOPIC-03` |
| 历史症状与根因 | 回复、编辑或删除已由服务器确认后，当前回复区不出现目标楼层或仍显示旧内容；如果简单整页刷新又会丢失已加载分页和当前位置；根因：请求改为 TanStack Query 唯一所有者时，旧 controller 的 targeted refresh seam 被删除，但 mutation success 没有等价的 Query-native 提交；顺序拆为独立 Query lane 后，写后刷新还必须保留真实服务端窗口语义。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-WRITE-018` 串行 mutation 在排队前共享同一 optimistic snapshot

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03` |
| 历史症状与根因 | 用户快速执行同一 Topic 的两个互动，第一个成功、第二个失败时，第二个 rollback 可能恢复到两个操作之前，复活已经确认撤销的状态或覆盖已确认结果；根因：`src/features/topic/actions/useTopicActionsController.ts` 把 cancel/snapshot/optimistic/rollback 放在 Mutation scope 之外，两个 queued mutation 观察到重叠基线。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-019` rerender 前重复提交进入两个非幂等队列

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01` |
| 历史症状与根因 | 用户快速双击回复提交，在 React 来得及重渲染 busy 之前，两次相同回复都进入队列，可能在原站生成重复内容；根因：`src/features/topic/actions/useTopicActionsController.ts` 只依赖渲染时派生的 busy 防重，没有在执行瞬间检查 exact mutation identity 的 pending 状态。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-020` mutation 前置错误无提示地消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-03`、`WRITE-04` |
| 历史症状与根因 | SecureStore 读取、凭据准备或其他 action wrapper 之前的异常发生时，操作没有成功也没有错误提示，用户只能看到按钮恢复；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 generic mutation `onError` 假定所有错误都已由内部 wrapper 处理。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-021` 离开 Topic 后结算的写入保留旧 route cache

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`NAV-03` |
| 历史症状与根因 | 在 Topic A 提交回复后立即导航到 Topic B，A 的请求随后成功；以后返回 A 时，因为 `refetchOnMount=false`，旧详情和回复 cache 可能继续显示写入前状态；根因：`src/features/topic/actions/useTopicActionsController.ts` 的 after-success refresh 没有处理 mutation identity 与当前 Topic identity 分离后的 inactive cache。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-022` 写操作确认失效后未更新统一会话投影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`SEARCH-04`、`TOPIC-01`、`MORE-02`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 写 transport 明确返回 HTTP 401，用户只看到一次错误，但 Topic、Search 与通知仍按旧账号开放；或 adapter/fallback 吞掉 status 后又补发账号请求，造成限流和竞态；根因：原始 `Response` 与 adapter 之间缺少统一 401 边界，身份失效被分散到每站 client 和消费者。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-WRITE-023` 旧主题或账号在身份待确认、换号后继续写入

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 用户从账号 A 打开旧 Topic 后在 WebView 切到账号 B、退出或身份无法确认，App 仍可能先显示 optimistic 成功、打开文件选择器或发送 A 页面上下文下的回复、编辑、删除、互动、投票、上传和签到；服务器已确认的操作还可能在写后刷新期间换号，随后对新账号弹出旧账号的成功提示；根因：各 action 自行读取 Cookie/SecureStore 判断登录，身份检查与 optimistic snapshot、文件选择、上传、transport 及成功结算之间没有一次性 identity/epoch 所有权；恢复逻辑把写请求当成可自动重试读取。 |
| 当前 owner | `src/domain/session/writableSessionGate.test.ts` |


## `REG-WRITE-024` 普通写失败误触发身份 barrier

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`SEARCH-04`、`WRITE-01`、`WRITE-02`、`WRITE-03`、`WRITE-04`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek、妖火或 linux.do 的普通网络错误、服务端异常或对象权限不足被当成登录失效；一次局部写失败会让目标站进入长期 identity barrier，Topic、Search 和其他私有入口一起关闭；根因：adapter 级错误分类被错误赋予账号生命周期权限；没有把 raw HTTP status 与业务错误分开。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-025` 妖火结果文案被当作控制协议

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-03`、`TOPIC-03` |
| 历史症状与根因 | 妖火返回的操作结果无法确认，但只要提示文案发生同义改写，或普通 200 页面只有空白/任意短文本，App 就把它当作已确认成功，保留 optimistic 状态并弹出成功提示，可能诱导用户重复或误判收藏、回复、删除和投票；根因：妖火 action response parser 到 Topic mutation wrapper 的结果类型缺少稳定判别字段和正向成功 oracle。 |
| 当前 owner | `src/sources/yaohuo/actionClient.test.ts` |


## `REG-TEST-001` Smoke 绿灯被当成功能完整通过

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 历史症状与根因 | Smoke 路径能走通，但 Feed 双 Loading 等用户可见 bug 仍然存在；多来源搜索 Replay 只等到请求结束，即使结果为空或结果打不开也会报绿；根因：证据命名和交付报告把不同测试层混成一个 `SMOKE_PASS`；搜索旅程把 `search-complete` 当成搜索成功，没有验证结果存在并能进入详情。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-002` 搜索完成标记残留导致 Replay 提前断言

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`RELEASE-02` |
| 历史症状与根因 | 真实搜索仍显示「正在搜索...」，Replay 却已经越过等待并立即报告首条结果不存在；同一路径重跑又可能通过；根因：`tests/device-logged-out/logged-out-readonly.ad` 与 `search-multi-source.ad` 曾把泛化请求生命周期 marker、上一请求残留节点或不完整来源集合当成当前聚合请求 oracle。后续逐来源空 marker 又进入生产布局，见 `REG-SEARCH-016`。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-003` App 内伪匿名不能代表真实未登录环境

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`SEARCH-01`、`SEARCH-04`、`RELEASE-02` |
| 历史症状与根因 | App 内切换一个「匿名」布尔值会创造第二套身份事实；要么真实 Cookie 仍参与网络，要么人为过滤全部 Cookie 并触发本不会出现的 Cloudflare 风控。两种结果都不能代表普通用户真实退出论坛但保留访客/clearance Cookie 的状态；根因：测试需求被实现成产品运行模式，导致 Account、Gateway、write ticket、媒体和 Native 网络层都要维护额外分支；测试环境事实与产品身份事实混在同一进程。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-TEST-004` 未登录 Replay 把访客已验证误判为账号登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-01`、`SEARCH-04`、`RELEASE-02` |
| 历史症状与根因 | 独立未登录 AVD 已正确识别 NodeSeek 游客并应显示外部 Google 搜索入口，但保留访客 clearance 后账号中心显示「已验证」，Replay 仍等待唯一「未登录」文案并在搜索前失败；根因：设备 oracle 把展示文案当成账号身份谓词，遗漏了现有状态模型中 `verified` 与 `logged-in` 的明确边界。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-005` 动态 linux.do 等级被误作固定 Replay oracle

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`RELEASE-02`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04` |
| 历史症状与根因 | 旧 `more-readonly` 或 `account-readonly` 在linux.do 等级读取处等待后失败，代理、诊断、备份、外观或整次 Release 随无关的第三方波动失去证据；等待原站冷却后从同一入口再次读取又能成功；根因：Device Replay 把「入口与错误状态是否正确投影」和「第三方身份、等级端点此刻是否可用」压成一个发布 pass/fail；固定 RNTL 已能确定性证明 transport、结算和恢复语义。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-006` 动态来源成功被错误作为唯一 Replay 终态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`RELEASE-02`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | App 已正确显示空态、限流、验证、来源错误或空 Library，Replay 仍因没有动态首条、详情、用户主题、非空本机数据或第三方 DOM 而失败；同一路径稍后重跑又可能通过；根因：Device Replay 同时承担 App 流程、第三方数据可得性和动态对象前置条件，没有复用 controller/UI 的结果模型；稳定入口与实时内容被压成一个布尔值。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-007` 所有旅程经聚合 Feed 启动并制造无关失败与请求突发

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`ACCOUNT-04`、`MORE-01`、`MORE-02`、`MORE-03`、`MORE-04`、`RELEASE-02` |
| 历史症状与根因 | Search、Library、账号、NodeSeek WebView 或本地 More 旅程尚未到目标入口，就因聚合 Feed 动态失败而停止；重复 relaunch 又在短时间触发多次无关来源和账号请求；根因：Replay 以一个网络首页作为所有能力的全局 setup，而不是从目标主 tab 建立最小前置；独立失败域和 probe 所有权没有体现在脚本拓扑中。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-TEST-008` 冷启动空节点让 Replay 在 selector timeout 前失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`MORE-01`、`RELEASE-02` |
| 历史症状与根因 | exact-revision APK 已正常启动且稍后能显示 Feed，但 Replay 在任何旅程操作前报告 Android accessibility hierarchy 为 0 个节点；`more-readonly.ad` 等待 `main-tab-more` 时未用满 60 秒 selector timeout 就失败；根因：`AppComposition` 在 `runtime.routes === null` 时返回空节点。snapshot helper 因前台 App 没有 meaningful accessibility node 转入 stock UIAutomator，后者等待 idle 超时，selector wait 无法继续轮询。 |
| 当前 owner | `tests/ui/app/app-composition.test.tsx` |


## `REG-TEST-009` 账号外站探测波动阻断确定性 Release Replay

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`RELEASE-02`、`MORE-05` |
| 历史症状与根因 | 同一 APK、设备和登录数据下，正式 Release Replay 先在妖火「已登录」等待失败，单独重跑又在 NodeSeek 失败；随后手动同路径三站可恢复为 3/3，tab 切换立即成功；根因：持久化终态恢复与 `account-readonly.ad` / `nodeseek-session.ad` 的设备 oracle 失配；确定性 Replay 不应重新证明登录。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-PROXY-004` 原生代理切换与 bridge 销毁遗留旧连接

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`SEARCH-01`、`ACCOUNT-02`、`MORE-04` |
| 历史症状与根因 | App 冷启动读取代理配置前可能短暂直连；代理切换、关闭或 React Native bridge 销毁后，旧 tunnel、连通性 probe 和阻塞线程仍存活；并发连接持续创建新线程；WebView 清除回调超时仍提示关闭成功，或在关闭过渡期间提前开始加载；根因：当时的 withNetworkProxyModule 生成器 生成的 `NetworkProxyRuntime`、`LocalNetworkProxyServer`、`NetworkProxyModule`，`src/platform/network/networkProxy.ts`、`src/app/useAppRuntime.tsx` 与 Account/More/Topic owner 的 WebView 门禁，以及 CI 原生编译门禁。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-005` CONNECT 成功被误报为完整连通且密码明文输入

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 |「测试代理延迟」只建立到固定 443 目标的 TCP tunnel 就提示成功，即使 TLS、证书 hostname 或 HTTP 已失败；代理密码在输入框和 Android 可访问性树中以普通文本暴露；根因：生成的 `LocalNetworkProxyServer.test()`、`src/platform/network/networkProxy.ts` 的 native Promise 计时、`src/platform/network/useNetworkProxyRuntime.ts` 提示与 `src/features/more/components/NetworkProxyModal.tsx` 输入属性。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-PROXY-006` 普通站点失败清空全局连接并取消其他站请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | NodeSeek 一次普通超时、403 或 fallback 失败后，linux.do、妖火等本来无关的在飞请求一起被取消；随后刷新 More 或重新发请求才恢复；根因：`nodeseekFetchFallback` 的推测性网络恢复与 `NetworkProxyRuntime` 共享 dispatcher/connection pool 的资源所有权冲突。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-027` Discourse emoji 绕过统一 gateway 且切站迟到落地

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`MORE-01` |
| 历史症状与根因 | linux.do 详情中的 reaction 图片目录直接读取 adapter，绕过 App 当前代理 fetcher、站点凭据、诊断和取消；卸载后旧目录可能迟到更新；根因：`src/features/topic/TopicRoute.tsx` → `src/sources/readGateway.ts` → 当时的 `discourseRead` 转发层 的受管读取边界。 |
| 当前 owner | `src/sources/readGatewayContract.test.ts` |


## `REG-TOPIC-028` V2EX 重复楼层被当作回复身份导致大片空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | App 内打开 V2EX 主题 `1229472` 并滚动到 67～68 楼时，两条正常回复之间出现超过一屏的空白，后续回复像被错误跳过。重启模拟器后仍稳定复现；根因：`src/features/topic/components/TopicContentList.tsx` 通过 `src/features/topic/model/replyListModel.ts`、`src/features/topic/model/topicContentIdentity.ts`、`src/features/topic/model/topicHeaderModel.ts`、`src/features/topic/model/topicError.ts` 的 `getReplyKey` 把楼层作为 FlashList 稳定身份，导致不同回复复用同一 key 和历史布局高度；项目已有 `src/domain/forum/feed.ts` 的 `replyKey` 已按 `commentId` 优先表达正确身份。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-FEED-007` 返回 Feed 后重复提示缓存的局部错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-04` |
| 历史症状与根因 | 从详情或其他页面返回 Feed 时没有新请求，却再次弹出上一页的来源错误；NodeSeek 错误还可能重复打开验证面板；根因：`src/features/feed/useFeedController.ts` 的局部分页错误副作用。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-008` 分页加载后已浏览主题回跳

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首页或单站列表向下加载下一页后，已经滑过的主题重新出现在顶部，当前阅读位置产生明显回跳；根因：`src/features/feed/useFeedController.ts` 的 `mergeFeedPages` 必须只按页序追加并去重；旧实现曾把跨页数据重新按活跃度排序并按来源平衡。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-009` 身份屏障复用可信多页时再次重排

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-04`、`ACCOUNT-02` |
| 历史症状与根因 |「全部」已经加载多页后进入登录或验证对账，网络尚未返回，已浏览主题就会换位并带动当前阅读位置回跳；根因：`src/features/feed/useFeedController.ts` 的可信 identity barrier 合并曾全量重排；改为普通 stable append 后又只从旧页保留 pending 来源，安全响应若只返回第一页会截掉旧第二页的安全来源。解除 barrier 时再把完整展示快照压成一个合成页，真实第一页结算后仍会覆盖旧尾页。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-010` 启动身份对账让 Feed 旧列表闪现后退回 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 关闭并重新打开 App 时，首页偶尔先显示上次或首个请求的列表，随后退回全屏 Loading，再显示新列表；分类栏也可能同步闪空；根因：冷启动把「恢复已确认事实」和「重新证明身份」混成同一生命周期，`useAppRuntime` 没有在唯一 ReadPlan 创建前等待 account session hydration。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-FEED-011` 整批身份对账逐站发布导致聚合请求风暴

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | v1.3.80 启动首页时 Loading 反复出现，站点可能提示操作过于频繁；一次启动日志在 3.536 秒内完成 3 次聚合 Feed、4 次聚合 Categories 和 4 个 Account probe，对应 28 个实际 HTTP，并在首批 30 条已可见后再次出现 2 个 busy 帧；根因：启动阶段没有信任上次终态，Account owner 被错误赋予首页启动编排职责。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-SOURCE-008` 会话来源清单与 source catalog 漂移

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01` |
| 历史症状与根因 | 新增可登录来源后，普通读取可以工作，但 session epoch 或 identity barrier 未覆盖该站，换号后的旧请求可能落地；根因：`src/domain/forum/sourceCatalog.ts` 的会话 capability、`readGateway` epoch snapshot 和 `useAccountRuntime` barrier。 |
| 当前 owner | `src/domain/forum/sourceCatalog.test.ts` |


## `REG-SOURCE-009` WebView HTTP 成功在 source parser 前误触发读取 runtime 轮换

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`SEARCH-01`、`TOPIC-01`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-01` |
| 历史症状与根因 | direct timeout/network error 后隐藏 WebView 返回 200，但内容是临时 shell、错误 HTML 或畸形 JSON；页面最终仍解析失败，App 却把这次请求计为成功 fallback 并轮换读取 runtime。聚合读取还可能因另一站成功而确认失败站；详情的辅助 poll 失败被降级为 partial 时也可能误确认；根因：transport 成功、Response 对应的 source parse proof、child typed result、最外层 aggregate result 与最终请求所有权没有统一 lifecycle；恢复计数器把 HTTP 状态误当成 source-readable 证据，并按 operation 一次性确认所有子请求，或让先完成的 child 在 aggregate/Gateway 最终 current/abort guard 前提前提交。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-SOURCE-010` 内容源已隐藏但账号、聚合、后台或旧路由仍出网

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`LIBRARY-01`、`NAV-01`、`NAV-02`、`TOPIC-01`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`DATA-01` |
| 历史症状与根因 | 用户在「更多」停用没有账号或不想看的站点后，页面虽然隐藏，该站仍被账号探测、「全部」聚合、搜索预览、后台消息或旧详情链接请求；重新启用还可能补报停用期间消息；根因：`sourceCatalog` 的静态能力边界、`ReaderSettings.contentSources` 的用户选择和 Account identity 被混成一个状态；请求层没有 fail-closed allowlist，排序也与请求集合共用不稳定 key。 |
| 当前 owner | `src/domain/reader/contentSourcePreferences.test.ts` |


## `REG-ACCOUNT-039` linux.do 身份确认后 workflow 仍停在 verifying

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`TOPIC-01`、`SEARCH-04` |
| 历史症状与根因 | canonical Account 已确认登录，但验证弹层 workflow 仍显示 verified/verifying、丢失 current user 或关闭写入；原页面恢复失败时还可能把可信身份一起降级；根因：`src/features/account/useVerificationController.ts` 的 authoritative reconcile 与 page recovery 顺序。 |
| 当前 owner | `src/features/account/useVerificationController.test.ts` |


## `REG-ACCOUNT-040` Android WebView source origin 被误当成完整页面 URL，Connect 永远不启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`WRITE-04` |
| 历史症状与根因 | NodeImage session 已明确失效后，授权弹层进入 NodeSeek Connect 页面却一直 Loading；用户反复打开或触碰页面仍没有结果，并担心每天 20 次 Connect 额度已被消耗；根因：Native 消息来源 origin、脚本运行 document URL 与 flow nonce/账号 epoch 是三份不同证据；可重试的 bridge ready 握手也不等于受每日配额约束的 `/api/cAuth` 网络调用。 |
| 当前 owner | `src/sources/nodeimage/authFlow.test.ts` |


## `REG-TOPIC-029` 媒体按目标 URL 猜身份并跨来源携带 Cookie

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 一个论坛正文引用另一个受管论坛的图片、头像或视频时，App 可能把目标站登录 Cookie 带给作者可控请求；重定向离源后还可能重新获得 Cookie；根因：`ForumMediaRequestContext`、所有媒体 source/header 构造和生成的 Android OkHttp Cookie policy。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-030` lazy 图片候选越过主动请求 URL 边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 已清洗的安全 `src` 被相对或 `javascript:` lazy/srcset 候选覆盖，正文加载失败；同一候选还可进入全屏预览和保存；根因：`src/domain/forum/forumContentMedia.ts` 的 source upgrade 与 `src/platform/media/imagePreviewCatalog.ts` 的 preview catalog/tapped URL 结算。 |
| 当前 owner | `tests/integration/topic-content-rendering-contracts.test.ts` |


## `REG-TOPIC-031` 全屏预览快速缓存命中后永久 Spinner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片已经由缓存立即显示，但全屏预览仍永久显示「图片加载中」；根因：`src/ui/media/ImagePreviewModal.tsx` 的 request identity 与终态结算。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-032` 正文图片逐图总时限无法表达加载进展

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 服务器接受连接但正文图片长期没有字节进展时，图片可以无限转圈；若改成每图 30 秒完整 `callTimeout`，持续有进展的大图又会在总时长到点后被误杀，海量正文还会线性创建 Timer 和同步失败波次。全屏预览的独立 timeout 由 `REG-TOPIC-052` 管理，不属于本条；根因：当时的 withNetworkProxyModule 生成器 的 Expo Image client timeout 配置与 `src/features/topic/media/TopicBodyMediaCoordinator.tsx` 的正文 permit/deadline 生命周期必须共同定义终态；任一层单独承担完整语义都不够。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-033` HTML 图片属性被重复解码

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片 URL 中本应保留的字面 `&lt;` 被再次变成 `<`，增补平面数字实体也可能被截断；根因：`src/platform/media/imagePreviewCatalog.ts` 的 DOM 属性读取与 raw regex fallback 解码边界。 |
| 当前 owner | `src/platform/media/imagePreviewCatalog.test.ts` |


## `REG-TOPIC-034` 大 SVG 兼容清洗退化为逐字符全尾扫描

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片解码失败后兼容读取接近 1 MiB 的 SVG 时，JS 线程长时间冻结，详情和全屏预览无法操作；根因：`src/platform/media/compatibleImageSources.ts` 把「不可信 SVG 文档」错误建模为「清洗后继续交给 AndroidSVG 的图片字符串」。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-035` Discourse 引用显示名被当作可导航用户名

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02` |
| 历史症状与根因 | linux.do引用缺少 `data-username` 时，显示名、头像路径或标题回退被当成 username；点击作者会进入不存在或错误的用户页；根因：`src/sources/discourse/content.ts` 的共享 Discourse 引用解析、`Reply.quotedPosts[].author` 数据模型与 `ReplyItem` 导航门禁。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-TOPIC-036` NodeSeek 渲染分页缺楼层时从 1 重新编号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | NodeSeek 第 2 页缺少 `.floor-link` 和数字 `id` 时从 1 重新显示楼层，与首屏重复；点赞等 embedded 元数据还可能因错误楼层匹配而丢失；根因：`src/sources/nodeseek/topicParser.ts` 的渲染楼层解析，以及 `src/sources/nodeseek/reader.ts` 的 Topic 首屏与 replies 分页消费。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-037` 带身份媒体被未分区 HTTP cache 跨会话复用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`ACCOUNT-01` |
| 历史症状与根因 | 同一媒体 URL 在账号 A 下返回的私有内容可能被匿名状态或账号 B 直接从 OkHttp cache 复用，即使新请求已不携带 A 的 Cookie；根因：生成的 `ForumMediaRequestInterceptor` 与 OkHttp `CacheInterceptor` 之间的 request cache policy；Expo/Glide 的 session epoch 上层 cache 是独立边界。 |
| 当前 owner | `modules/forum-platform/android/src/main/java/com/wz/reader/network/NetworkProxyRuntime.kt` |


## `REG-TOPIC-038` 复杂动态 SVG 被重复交给 AndroidSVG 后仍加载失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | NodeSeek `post-841430-1` 的正文图片持续 Spinner 或失败；响应实际是合法 SVG，切到 data URI 后仍无法显示，去掉链接包装也无效；根因：`src/platform/media/compatibleImageSources.ts` 曾把失败 SVG 改写后再次交给 Expo Image 的同一个 AndroidSVG decoder；正文与全屏没有共享「SVG 文档 artifact」边界。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-039` NodeSeek 用户名 mention 被候选 UID 优化误作内部导航门禁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`USER-01`、`NAV-02`、`USER-02`、`LIBRARY-02`、`NAV-03` |
| 历史症状与根因 | 同一 NodeSeek Topic 中，有些正文或回复里的 `@用户` 能进入 App 用户页，有些却打开 Google/Chrome；能否内开取决于当前已加载 Topic 数据中是否碰巧带有该用户的数字 UID；根因：`parseForumUserLink` 与 Topic 共享 HTML 点击入口、`UserReference`/`UserProfile` 边界、NodeSeek username resolver、`ReadGateway` 和 User controller 的 Query identity。 |
| 当前 owner | `tests/integration/forum-presentation-contracts.test.ts` |


## `REG-TOPIC-040` 正文误把预览原图当作适屏图片下载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | 浏览器中秒开的论坛图片在 App 正文等待十几秒甚至离页仍未完成；窄屏正文实际下载了灯箱原图或 `srcset` 最大候选，耗时和字节数远大于展示所需；根因：`src/platform/media/imagePreviewCatalog.ts` 的图片候选解析与预览 alias catalog、`src/domain/forum/forumContentMedia.ts` 的正文 source 选择，以及 `src/features/topic/rendering/previewRenderers.tsx` 的最终 native source。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-041` 不同会话 epoch 的同 URL 图片请求被 Glide 合并

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 账号切换、退出或登录更新时，新会话请求与旧会话尚未结束的同 URL 图片可能共用旧 Glide 在途结果，造成旧私有图片进入新页面或新请求无法独立结算；预览保持打开时还可能继承旧会话的放大状态，导致新页无法横滑或动画层继续隐藏；根因：`src/platform/media/mediaRequestContext.ts` 的远程图片 source、当时的 withNetworkProxyModule 生成器 的出网拦截器、Expo `GlideUrlWithCustomCacheKey` 模型相等性，以及 `src/ui/media/ImagePreviewModal.tsx` 的 session identity 边界。 |
| 当前 owner | `src/platform/media/mediaRequestContext.test.ts` |


## `REG-TOPIC-042` App 重启后私有图片磁盘缓存命名空间复用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | App 重启后切到不同账号或匿名状态，同一 URL 可能直接显示上一进程写入的私有图片磁盘缓存；根因：`src/platform/media/mediaSessionEpoch.tsx` 的媒体 session identity 与 Expo/Glide disk cache namespace。 |
| 当前 owner | `src/platform/media/mediaSessionEpoch.test.ts` |


## `REG-TOPIC-043` 复杂静态 SVG 全屏误启 Chromium 导致掉帧与缺层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 复杂静态 SVG 在正文已完整显示，进入全屏后却出现掉帧、局部图层缺失；设备日志反复出现 Chromium tile memory 超限，严重时 App 进程退出；根因：`src/ui/media/ImagePreviewModal.tsx` 对 `CompatibleSvgArtifact.animated` 的消费边界。 |
| 当前 owner | `src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-044` SVG 海报 renderer 空闲后仍占用 Chromium 内存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 正文海报已经生成且可见，打开真实动画 SVG 预览并缩放后仍会持续掉帧、缺层；日志反复出现 Chromium tile memory 超限，严重时 App 或模拟器退出；根因：当时的 withSvgRendererModule 生成器 生成的 `SvgPosterRendererRuntime` 队列结算与 WebView 所有权。 |
| 当前 owner | `tests/tooling/release-packaging.test.ts` |


## `REG-TOPIC-045` 动画 SVG document view 进入缩放树后耗尽 Chromium tile 内存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 动画 SVG 正文和全屏首帧都能立即显示，但双击放大、平移或停留时日志持续出现 Chromium `tile memory limits exceeded`，严重时预览缺层、App 或模拟器退出；根因：`src/ui/media/ImagePreviewModal.tsx` 的分页、缩放树与动态 `CompatibleSvgDocumentView` 挂载边界。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-046` 多图预览被缩放手势截获后无法横滑

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 三图主题打开后稳定显示 `1/3`，但在图片上向左滑动仍停留在第一张，用户无法进入后两张；根因：`src/ui/media/ImagePreviewModal.tsx` 的单一 manual parent Pan 与 ResumableZoom 共享的 UI-thread zoom state。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-047` 评论纵向间距调整误删正文横向缩进

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 只要求调整评论纵向留白后，评论正文却向左扩张到头像列下方，签名、引用、投票和操作区也随正文一起铺满；相邻评论之间的纵向节奏正确，但左右布局已不是原来的样式；根因：`src/features/topic/components/ReplyItem.tsx` 的 `replyContentWidth` 与 `src/features/topic/styles.ts` 的 `replyContentArea`。普通回复的引用、回复目标、正文、投票、签名/留言、reaction/统计/感谢、采纳状态和操作栏都在该容器内；主楼、评论头部、系统事件、User 回复活动和 Reply composer 不经过该容器。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-048` 适屏图显示后不渐进升级且全屏返回仍模糊

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`ACCOUNT-01` |
| 历史症状与根因 | 详情与评论只能一直显示适屏图；即使全屏原图已经清晰显示，关闭预览后外层仍模糊。若直接把原图改成首个请求，长帖又会恢复慢加载、滚动期间整页抢带宽和图片尺寸跳动；根因：`src/platform/media/imagePreviewCatalog.ts` 的原图来源传递、`src/features/topic/rendering/previewRenderers.tsx` 的块图双层生命周期、`src/platform/media/originalImageLoading.tsx` 的附近门禁与进程内显示信号、`src/features/topic/components/TopicContentList.tsx` 的主楼分块范围，以及 `src/ui/media/ImagePreviewModal.tsx` 的全屏 `onDisplay` 结算。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-049` Bilibili 移动播放器跳转被导航白名单拦截

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 主题已把 Bilibili 视频识别成 16:9 播放器区域，但评论里只显示空白卡片，没有封面、控制层或视频；根因：`src/domain/forum/videoEmbeds.ts` 的 Bilibili WebView 导航白名单，以及 `src/features/topic/rendering/contentMediaRenderers.tsx` 对该白名单的共享调用。 |
| 当前 owner | `src/domain/forum/videoEmbeds.test.ts` |


## `REG-TOPIC-050` 全屏图片切换时高清升级闪黑

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 帖子详情的多图预览在 `1x` 横向切换时，新当前页会短暂整体变暗，视觉上像在黑色背景上闪了一下；页码、手势和最终图片均正常；根因：`src/ui/media/ImagePreviewModal.tsx` 普通栅格图分支把同一媒体的清晰度升级当成需要 cross-dissolve 的内容切换。`expo-image@3.0.11` Android 实现同时淡出旧 view、淡入新 view；在预览黑色背景上，两张相同图片的合成亮度中点约为 `75%`。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-052` 全屏重复打开已显示图片仍闪 Spinner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 同一张原图已经在全屏成功显示，关闭后再次点击，仍会短暂出现「图片加载中」并闪一下；根因：`src/ui/media/ImagePreviewModal.tsx` 的普通栅格预览状态没有消费 `src/platform/media/originalImageLoading.tsx` 已有的进程内显示证明。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-053` 跨主题评论引用被当作普通 HTML

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 评论中的跨主题引用没有显示为引用卡片，而是把头像、主题标题、分类和整段灰色 blockquote 当作普通评论 HTML 展开；同楼层还可能误取当前主题的帖子；根因：`src/sources/discourse/content.ts` 的 Discourse reply quote 提取、`Reply.quotedPosts` 的完整身份、linux.do adapter、`ReplyItem` 的本地楼层复用与 `useTopicController` 的引用事件。2026-07-16 的 `REG-TOPIC-003` 只对正文构造跨主题 fixture，评论 fixture 仍是同主题；2026-07-26 抽公共 parser 时保留了该限制，因此文档承诺没有对应评论 oracle。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-054` 超长评论引用展开时同步挂载整帖并挤压作者信息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 已加载的超长跨主题引用再次展开仍会长时间卡顿；头像稍后出现会推挤姓名，长作者名和标题拥挤，引用分块之间还可能露出灰色空带。进入引用目标再返回时，还可能显示「收起」却没有正文；两条同展示楼层的回复可能一起展开或串位；根因：`useTopicController` 的引用 Query、`buildVirtualizedReplyItems`、`TopicScreenBody` 的唯一纵向 FlashList、`ReplyItem` 分段渲染与引用卡片样式。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-055` 超长引用首次展开让 FlashList 同帧预渲染过多富 HTML

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | `REG-TOPIC-054` 已把完整引用拆进父 FlashList 后，首次点击「展开」仍可能明显卡住；展开态还重复显示简介与完整正文，头像、姓名、标题和正文显得拥挤；根因：`buildVirtualizedReplyItems` 的冷引用 materialization、`TopicScreenBody` 的 row `onLayout`/下一帧放开、`ReplyItem` 的 content row 与引用简介显示条件。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-WRITE-026` 回复编辑权限跨账号或 epoch 继续生效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | A 账号进入回复编辑后切换到 B、恢复旧 route 或失去逐条权限，旧编辑仍可能提交、选图或上传；根因：`ReplyEditTarget`、`useTopicSessionController` 与 `useTopicActionsController` 的写 ticket、Replies Query 和 composer 生命周期。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-027` 结构化回复切换模式或展示状态后丢失正文与私有语法

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`TOPIC-02`、`TOPIC-03`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | linux.do/NodeSeek 回复只能看见原始 Markdown，表格是假文本；切换富文本/源码或 Sheet/全屏后可能丢正文、撤销栈、选区，私有块还会被普通 Markdown 规范化破坏。源码异步图片上传期间继续编辑时还可能插错位置或被模式切换覆盖；代码里的 `[poll` 等示例会被误判为待发布语法；根因：`StructuredReplyComposer`、本地 Tiptap/CodeMirror runtime、严格 Bridge、`ComposerBottomSheet` 与 Topic/私信入口。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-028` NodeSeek Stardust marker 可注入付款按钮或脱离正文位置

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 非法收款人/金额 marker、代码示例或恶意参数可能变成可付款卡片；合法卡片被移动到正文底部或重复显示；根因：`stardustMarkup` 的 DOM 原位归一、typed HTML model、`NodeSeekStardustCard` 和付款 controller 信任边界。 |
| 当前 owner | `src/sources/nodeseek/stardust.test.ts` |


## `REG-WRITE-029` NodeSeek 回复失败后手动重试重复创建投票

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05` |
| 历史症状与根因 | 投票已创建但评论发送失败后，用户点重试会留下第二个远端投票和孤立资源；根因：`materializeNodeSeekPolls` 与按 identity 保存的 `nodeSeekPollJournal`。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-030` NodeSeek 投票创建结果不明后再次发起创建

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`ACCOUNT-01` |
| 历史症状与根因 | create 超时或响应不可解析时，当前页面或 App 重启后的下一次提交再次创建投票；根因：`materializeNodeSeekPolls` 的 unknown outcome 与持久化 poll journal。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-031` NodeSeek 投票明确拒绝后被永久锁死

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | 服务端明确拒绝无副作用后，用户修正或手动重试仍被「结果未知」门禁永久阻止；根因：NodeSeek action error 的 `serverRejected` 语义与 poll materialization catch。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-WRITE-032` Stardust 付款确认取消后仍发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | 用户在「不可退回」确认框取消，仍发生 Stardust 扣款；根因：`payNodeSeekStardust` 的 writable ticket、prepare、native confirmation 和 send 分段。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-033` Stardust 付款乐观标记成功或重复发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | send 返回即本地标为已支付，或渲染/重复点击造成两次扣款；根因：`payNodeSeekStardust`、Topic mutation scope 与 `fetchNodeSeekStardustStatus`。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-034` Stardust send 结果不明时自动重发

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`ACCOUNT-01` |
| 历史症状与根因 | send timeout 后客户端直接重试，可能重复扣款；或把未确认状态显示为失败诱导再次付款；根因：`payNodeSeekStardust` 的 send error、权威 status refresh 和 outcome 分类。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` |


## `REG-WRITE-035` 结构化 Composer 把旧回复工具藏到不可发现的长工具栏末尾

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 切换到结构化 Composer 后，首屏只看到撤销、标题和少量格式；NodeSeek 贴纸、LinuxDo Emoji、图片上传、投票及站点工具看似全部消失；根因：Editor Runtime 的移动端工具信息架构，不是写事务、上传 API 或目录加载本身。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-036` 结构化 Composer 的表达式、Sheet 和键盘只保留了源码层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 点击 NodeSeek 贴纸或 LinuxDo Emoji 后富文本只出现灰色 `:token:`；非空文档仍叠着「输入回复内容」；半屏正文留出大片无意义空白，全屏越过导航安全区，Gboard 打开后编辑区与发送栏仍被键盘覆盖；根因：`ForumExpressionNode` 的站点目录到视图属性映射、Editor 的显式空状态，以及 `StructuredReplyComposer → ComposerBottomSheet` 的唯一剩余空间/IME 布局合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-037` Composer 关闭冻结或正文滚动误触关闭

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | Composer 全屏时点击收起只剩幽灵 Header；或在投票/Stardust 表单内纵向滚动时整张 Composer 被意外关闭；根因：`ComposerBottomSheet` 对可见高度、公开 `close()` 生命周期，以及「谁有权关闭 Composer」的唯一所有权合同。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-WRITE-038` Composer 底部露缝、表达式可连点且输入热路径重复整篇计算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 半屏和全屏底部都露出一条非 Sheet 背景；半屏打开后键盘不出现；全屏带键盘关闭后 Gboard 仍覆盖 Topic；选择贴纸或 Emoji 后选择面板不消失，同一项可被连续插入；长正文输入和移动光标时有明显卡顿；根因：`ComposerBottomSheet` 对背景、内容安全区和打开完成事件的所有权，`react-native-webview requestFocus → InputMethodManager.showSoftInput → Editor focus` 的唯一焦点链，Editor Runtime 的 `insertExpression/postState/useEditorState`，以及 Native Bridge 的相同状态去重。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-WRITE-039` 结构化 Composer 工具栏有真实溢出但横向手势被 Sheet 截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 常用工具栏最右侧只露出半个图标，但左右拖动没有任何移动，链接、引用、代码和列表不可达；根因：`StructuredReplyComposer` 唯一 WebView 的 Android 嵌套滚动合同；Editor Runtime 已形成真实横向 overflow，不属于 CSS 宽度或工具项布局问题。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-040` 空表格仍显示整篇占位符

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在空回复中插入表格后，「输入回复内容…」仍压在第一个表头单元格上并横跨单元格边界；根因：Editor Runtime 对「默认空文档」占位符的唯一判定；它必须判断 ProseMirror 文档形状，不能把「没有文本」当成「没有结构」。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-041` 表头可被切掉并在 Markdown 中凭空增加一行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 点击表格工具栏的「表头」后，首行只是不再加粗，但源码会在正文最前凭空增加一行空表头；删除首行也会产生同类数据变化；根因：ProseMirror 表格文档的 GFM 不变量：每个 table 的第一行必须全部是 `tableHeader`，不能等到序列化时补救。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-042` 插入表格后第二排工具栏压住正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 插入表格后编辑器突然增加一整排中文操作按钮，正文视口被向下挤压，新表格末行像被 Footer 截断；窄屏右侧操作只露出一半；根因：Editor Runtime 的主工具栏布局与 Tiptap table selection 上下文；表格动作不能作为文档流中的第二排，也不能替换主工具栏。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-043` 表格对齐只改当前单元格且发送时丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在表格第三列点「居中」后，富文本只可能改变当前单元格；切到源码仍显示 `---`，发送后的 Markdown 不保留对齐；根因：GFM 只表达整列对齐，但 Runtime 直接调用 Tiptap `setCellAttribute`，该命令只更新当前单元格；编辑态文档与发布格式的语义边界不一致。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-044` 工具栏触摸焦点修复反而截断横向滚动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 为避免点工具后丢失选区而统一拦截 `pointerdown` 后，工具栏最右侧只露半个按钮且手指无法横向滚动；触摸手势在按钮命中阶段就被取消；根因：共享 Tiptap `EditorButton` 与 Popover trigger 对指针类型的默认行为所有权；触摸必须交给 WebView 的原生滚动，鼠标点击才需要阻止浏览器抢走编辑选区。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-045` 表格操作以遮罩或第二层菜单盖住正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 点表格后出现不透明弹窗或第二排按钮，用户完全看不到正在编辑的单元格；行列动作含糊，蓝色对齐选中项还可能被横向边界裁掉；根因：Editor Runtime 的 Tiptap table selection 与 BubbleMenu；菜单可见性、命令可用性和锚点都必须直接来自当前 Editor 状态，不能由共享 builder 或返回按钮维护另一套生命周期。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-046` 源码模式出现黄色焦点框且编辑区缩成小块

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | CodeMirror 周围出现浏览器默认黄色/高亮焦点线，源码只占正文区域的一小块，下面留下大片无法输入的空白；根因：Editor Runtime 创建 CodeMirror theme 时的 CSP nonce，以及 source pane 唯一 flex 高度和焦点样式合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-047` Footer 字符数停留在初始草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 编辑已有回复或恢复草稿后正文已经变化，Footer 仍显示 `0 字符` 或旧长度；收到 autosave snapshot 后也不刷新；根因：`StructuredReplyComposer` 的 `editorState.markdownLength`；外部草稿和带 revision 的确认 snapshot 是仅有两个可更新来源，逐键状态消息不携带正文长度。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-048` Builder 校验错误在用户修正后仍不消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06` |
| 历史症状与根因 | NodeSeek 投票点击插入后提示「请输入投票标题」；用户随后填写标题，旧错误仍挂在表单上，视觉上像输入无效或按钮卡死；根因：Editor Runtime Builder 内唯一 `builderError`；它只描述上一次提交的输入，不是独立状态机或服务端错误。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-049` NodeSeek 私有 marker 往返后退化或消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06`、`NOTIFY-02` |
| 历史症状与根因 | 本地生成的 Stardust 收款卡片切到 Markdown 源码后，再切回富文本只剩裸 URL；源码以 GFM 表格结尾时继续插入 poll 和 Stardust，两者会粘到表格末行并在模式往返后消失；根因：Stardust 协议解析只处理已验证前缀后的 query；source-mode poll/Stardust 统一走现有 `insertSourceBlock`。编辑器、阅读 renderer 与发送校验共享 marker 语义，不依赖浏览器自定义 scheme，也不各自补换行。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-050` 表格操作栏滚到末端仍裁掉「删除表格」

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | NodeSeek 表格二级操作栏可以横向滑动，但滚到最右后「删除表格」仍只露出一部分，无法得到完整可读、可点的末端动作；根因：表格 BubbleMenu 的视口边界和横向滚动合同；菜单必须以整表为锚点，同时把自身宽度限制在当前 WebView 可用区域。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-051` 选择贴纸后焦点和 Gboard 没有回到正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02`、`WRITE-05` |
| 历史症状与根因 | NodeSeek 贴纸插入成功并关闭选择器后，Gboard 同时收起；用户必须再次点击正文才能继续输入，看起来像贴纸后不能写文字；根因：Editor Runtime 的表达式插入命令及共享 `insertAtSelection`：成功写入必须由 Tiptap/CodeMirror 自己恢复原选区和 focus，取消或显式关闭 Builder 仍保持不抢焦点。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-052` 贴纸后的光标显示在下一行但文字写到右侧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | 终端贴纸后的蓝色 caret 和选择手柄显示在贴纸左下方的新行；实际按键后文字却出现在贴纸右侧，视觉反馈与真实插入位置不一致；根因：Tiptap `useEditor` 的 `injectNonce` 必须与本地 HTML 的 `style-src nonce-wz-composer-runtime` 保持同一值，使 ProseMirror 自有 separator、gap cursor 和 selection 基础样式成为实际渲染合同。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-053` 两站通用富文本 UI 分叉且表格交互由隐藏 Builder 驱动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 标题点击后出现整页遮罩、链接占满正文、表格操作替换主工具栏并要求「返回」；LinuxDo 与 NodeSeek 对同一格式呈现两套不同交互，修一站会留下另一站旧实现。源码光标处插入列表或表格还可能与前后正文粘成无效 Markdown；根因：L/NS 唯一 `StructuredReplyComposer` 的通用 UI ownership：Tiptap 文档/selection 是格式状态唯一来源，站点 Adapter 只拥有业务能力；CodeMirror 选择替换必须区分行内与块级 Markdown。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-054` LinuxDo 大 Emoji 目录使编辑器 INIT 整体失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek Composer 正常，切到已加载完整 Emoji 目录的 linux.do 后只显示「正在初始化编辑器」，随后变成启动超时；Emoji、图片和全部正文工具都无法使用；根因：`StructuredReplyComposer` 发出 `INIT` 前的目录结算与 `structuredComposerBridge` 的同一数量上限；站点目录不能把编辑器生命周期变成部分有效消息。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-055` 业务表单泄漏浏览器样式且表格菜单覆盖主工具栏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`WRITE-06`、`NOTIFY-02` |
| 历史症状与根因 | 链接输入框同时出现三层蓝色边线，投票和 Stardust checkbox 是突兀的浏览器方框；表格靠近正文顶部时，BubbleMenu 与 sticky 主工具栏叠在同一位置，对齐二级菜单继续堆叠，遮住操作和表格；根因：`editorRuntime.css` 的共享 Tiptap 表单 primitive，以及 `TableContextMenu` 从真实 `.toolbar-stack` rect 派生的 Floating UI collision padding；两站 Builder 和每张表必须共用同一规则。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-056` LinuxDo Emoji 目录晚于编辑器 READY 时仍为空

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | linux.do 回复编辑器已经可输入，但 Emoji 面板只显示少量旧数据或一直显示「正在读取表情目录」；目录稍后加载完成也不会更新；根因：RN→Editor Bridge 的 `set-discourse-emoji` 文档命令：目录是可替换的展示资源，不是文档初始化状态。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-WRITE-057` 表情面板重开反复请求、分类叠图且缩略图过小

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 贴纸或 linux.do Emoji 面板关闭后再打开会重新空白加载；NodeSeek 切到「洋葱头」等分类时仍显示 AC 娘，多个分类实际叠在同一区域；缩略图辨识困难；根因：单个 Editor Runtime 内的表达式图片节点 ownership 与 `.expression-grid[hidden]` 可见性规则。面板和 NodeSeek 各分类只挂载一份真实 `<img>`，打开/关闭和分类切换只使用原生 `hidden`；隐藏图片保留 `loading=lazy`。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-058` LinuxDo 硬换行显示反斜杠且行首 date 被私有块吞掉

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 富文本点「硬换行」会在正文显示反斜杠字符；行首插入 date/time 后显示成通用「站点私有块」，完整 marker 挤满一行；根因：富文本命令应调用 Tiptap `setHardBreak()`；未知块 tokenizer 必须把 `date=` 留给 `LinuxDoDateNode`，专用节点负责紧凑展示并保留原始 Markdown。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-059` 半屏误判横屏导致 Emoji 网格拥挤且搜索割裂

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 竖屏手机的半屏 Composer 把 linux.do Emoji 排成八个拥挤列，缩略图与名称难以辨认；搜索又显示为独立的「搜索」文字和原始输入框，与同一 Builder 的控件风格割裂；根因：表达式网格应由 CSS intrinsic sizing 直接消费当前容器宽度；搜索应复用 Editor Input 的单一 focus perimeter。设备方向、Sheet 展示状态和图片加载不应进入 JS 布局状态。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-060` 投票选项退化为「每行一个」文本域

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 与 linux.do 的投票 Builder 要求用户在一个文本域中手工换行输入全部选项，无法直接看出如何新增、删除或编辑单项；交互比原站倒退；根因：两站 Builder 共用一个无状态的选项列表视图，直接读写领域数组；每项一个受控 Input，增删只做数组的 map/filter/append，不引入 option ID、选区备份或菜单状态机。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-061` 源码模式仍悬浮富文本表格菜单

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 在富文本中选中表格后切换 Markdown 源码，表格的「行/列/对齐/删除表格」BubbleMenu 仍浮在 CodeMirror 上方，遮挡源码并暴露会操作隐藏富文本的控件；根因：表格菜单的渲染 owner 同时需要「当前是 rich mode」和「当前 selection 在表格内」；模式已经是 Runtime 的唯一真值，无需再创建菜单状态或清空 selection。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-DATA-006` 备份 URL 携带未知 query 凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03`、`FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 历史症状与根因 | 备份虽删除已知 token 名，未知签名参数、userinfo 或 fragment 仍可随 Topic、用户和头像 URL 导出并在导入后继续保存；根因：`src/domain/reader/readerData.ts` 的 Topic/User summary 与 ReaderData v2 的 load/save/import/export 统一 sanitizer。 |
| 当前 owner | `src/domain/reader/readerBackup.test.ts` |


## `REG-TOPIC-051` NodeSeek Markdown 无输入预算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 异常大的 NodeSeek Markdown 可进入 Markdown/linkify 全流程，造成不必要的 CPU 与内存占用；根因：`src/sources/nodeseek/markdown.ts` 的唯一 MarkdownIt 实例及进入 `sanitizeContentHtml` 前的输入门禁。 |
| 当前 owner | `src/sources/nodeseek/markdown.test.ts` |


## `REG-PROXY-007` localhost relay 接受危险目标并遗留空闲 tunnel

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | WebView localhost relay 可接受任意端口、userinfo、畸形 request line、非标准 numeric IPv4、IPv4-compatible/mapped IPv6 或私网 IP literal；合法首请求后的流水线第二 target 还能绕过校验，空闲 tunnel 也可能长期占用连接与 copy worker，按方向独立计时又会误杀仍在持续单向传输的 tunnel；worker 结束与 relay 停止并发时还可能抛异常并跳过后续 socket/executor 清理；profile 只改名还会无意义重启；根因：当时的 withNetworkProxyModule 生成器 生成的 `LocalNetworkProxyServer` 与 `useNetworkProxyRuntime` apply key。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-OPS-015` 发布 secret 进入所有子进程且缺少 provenance

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 历史症状与根因 | `.env.release.local` 的签名变量进入全局 `process.env` 并穿透 verify/prebuild/native test/smoke；产物只能看到 APK hash，无法追踪源码、lockfile 与 toolchain；根因：`scripts/release-environment.mjs`、`scripts/release-android.mjs` 与 release manifest 生成顺序。 |
| 当前 owner | `tests/tooling/release-environment.test.ts` |


## `REG-FEED-012` TopicCard memo 忽略不可见 payload 变化

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-03`、`FEED-04`、`SEARCH-02`、`USER-01`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03` |
| 历史症状与根因 | 两个 Topic 展示文字相同但 `url/categoryId/authorId` 已变化时，卡片不重渲染，点击和 trailing action 继续使用旧对象；根因：`TopicCard` 的 immutable Topic 输入和 memo comparator。 |
| 当前 owner | `tests/ui/shared/topic-card.test.tsx` |


## `REG-FEED-013` Feed 请求期间先露空白再出现 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首次读取或切换来源后，顶部内容区可能先闪一帧空白，再出现灰色 Loading；请求最终仍能成功；根因：`FeedScreen.renderFeedScene` 在目标 route 成为 active 后立即用空 `FlashList` 替换预铺 Loading；原生列表布局和 `ListEmptyComponent` 建立前，透明 Pager 暴露页面背景。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-UPDATE-005` 连续版本下载累积历史 APK

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | 每个更新版本使用不同 cache 文件名，连续下载会留下多个历史 APK；下载失败还可能保留 partial；根因：`useAppUpdateRuntime.downloadAppUpdate` 的 cache target 与失败清理。 |
| 当前 owner | `tests/ui/more/app-update-runtime.test.tsx` |


## `REG-UPDATE-006` App 内新版仍打开上一版安装包

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | App 已检测并显示新版本，下载后 Android 安装确认仍提示上一版；同一 Release 由浏览器直接下载时正常；根因：`useAppUpdateRuntime.downloadAppUpdate` 的文件身份与 `ApkInstallerModule.installApk` 的 FileProvider URI。 |
| 当前 owner | `tests/ui/more/app-update-runtime.test.tsx` |


## `REG-PERF-007` 进程级缓存与通知无容量或 identity 边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`DATA-01`、`MORE-02` |
| 历史症状与根因 | 图片尺寸/revision 与诊断引用可随进程运行无界增长；任一原图显示会唤醒所有监听者；memo comparator 和 ReaderData render 反复做无谓扫描/序列化；根因：HTML 图片尺寸、原图 revision、诊断 reference、ReaderData controller 与 Topic/Reply memo comparator。 |
| 当前 owner | `src/platform/media/originalImageLoading.test.ts` |


## `REG-PERF-009` 图片 cache getter 在 React render 阶段提升全局 LRU

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 被 React 丢弃或重复执行的图片 render 也会改变进程级 cache 淘汰顺序；长帖、返回和预览切页期间，真正已提交的热尺寸、原图 revision 或 SVG artifact 可能被 speculative render 挤出；根因：`src/features/topic/rendering/previewRenderers.tsx`、`src/platform/media/originalImageLoading.tsx` 与 `src/platform/media/compatibleImageSources.ts` 的 cache read/promotion ownership。 |
| 当前 owner | `src/platform/media/imageDisplayDimensions.test.ts`、`src/platform/media/originalImageLoading.test.ts`、`src/platform/media/compatibleImageSources.test.ts` |


## `REG-TOPIC-056` Discourse Callout marker 被当作普通灰色引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do cooked HTML 中的 `[!warning]`、`[!caution]` 等 Callout marker 原样可见，整块按普通灰色引用渲染；评论引用展开后同样丢失黄色警告等语义，富文本标题、嵌套和折叠内容没有统一布局；根因：`src/sources/discourse/content.ts` 的 cooked-HTML 协议边界、`compileForumContent()` 的一次性 fold 解释，以及 `TopicSplitDisclosureStore` 的唯一展开状态 owner。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-057` route epoch 被固化为 Topic 身份导致永久 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`NAV-03` |
| 历史症状与根因 | Topic 在账号 generation 变化后会立即隐藏旧内容，但同一路由即使收到新 generation 内容仍永久停在 Loading；返回嵌套 Topic 时还可能复用已经失效的旧内容；根因：`src/features/topic/TopicRoute.tsx` 的固定 `Topic` 参数、`src/features/topic/useTopicSessionController.ts` 的 session epoch 读取，以及 `src/platform/query/serverState.ts` 的 Topic Query key。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-058` 48dp 门禁把回复目标撑成大按钮

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | V2EX 等站点的楼层回复关系原本是紧凑标签，未发布改动后变成高大蓝色按钮，挤开正文并与内联 mention 抢层级；真实 V2EX 7 楼可稳定复现；根因：`ReplyItem` 的 reply-target Pressable 与 `themeStyles.replyTargetPill` 把视觉几何误当成触控几何。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-059` 无关 Topic 状态变化重挂载已显示富媒体

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 正文图片加载完成后，打开全屏预览再返回会闪回灰色占位；评论引用或评论展开/收起时，已显示图片短暂出现 Spinner，inline emoji、贴纸和其他 HTML 富媒体也会消失后重现；根因：`src/features/topic/rendering/useHtmlRenderingController.tsx` 的动作代理与 renderer registry 生命周期，以及 `react-native-render-html` 以 renderer 函数作为 React 组件类型的消费方式。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-060` NodeSeek 后续页首条回复被当作主楼过滤

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 后续分页会缺少该页第一楼；消息通知恰好指向这一楼时，主题内存在正文，但消息详情显示「消息不可见」；根因：`src/sources/nodeseek/topicParser.ts` 的 `parseRenderedNodeSeekTopicHtml` 无条件把首个 `.content-item` 当作主楼过滤，`src/sources/nodeseek/reader.ts` 未把当前页码传入 parser。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-061` 妖火回复目标楼层和作者丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 妖火主题的回复正文正常显示，但原站「回复 88 楼」的关系被丢弃；例如 90 楼明确回复当前用户，App 内既看不到目标楼层，也看不到被回复人；根因：`src/sources/yaohuo/topicParser.ts` 只提取作者和正文，丢弃原站 `tofloor` 关系；共享 `Reply` 又只允许作者字符串，无法独立表达「只知道楼层」或「楼层与作者均已确认」。 |
| 当前 owner | `src/sources/yaohuo/parser.test.ts` |


## `REG-PROXY-008` 阻塞写绕过共享 tunnel deadline

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | relay 任一方向的 socket write 永不返回时，两个 copy task 和 connection worker 可永久占用并发槽；读侧 timeout 已到期也无法结束 tunnel；根因：当时的 withNetworkProxyModule 生成器 生成的 `LocalNetworkProxyServer.pipeBoth` 与既有 `TunnelIdleDeadline`。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-OPS-016` Java 环境提示被写成 release provenance

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-01`、`RELEASE-02` |
| 历史症状与根因 | 设置 `JAVA_TOOL_OPTIONS` 或 `JDK_JAVA_OPTIONS` 后，release manifest 的 `javaVersion` 可能记录提示行而非 JVM 版本；失败路径还可能把原始输出或 marker 带入日志；根因：`scripts/release-environment.mjs` 的 Java provenance parser 与 `scripts/release-android.mjs` 的 preflight 接线。 |
| 当前 owner | `tests/tooling/release-environment.test.ts` |


## `REG-OPS-017` Android Smoke 强制无窗口启动模拟器

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 执行 Android Smoke 时模拟器只在后台启动，操作者看不到设备画面，无法监督首次启动和后续 Replay；根因：`scripts/smoke-android.mjs` 覆盖了 agent-device 默认的 GUI 启动行为。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-018` 正常代码更新误用 agent-device reinstall 重置主 AVD App 数据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02`、`ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`DATA-01`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | 为查看最新构建而安装 APK 后，主模拟器账号中心从已有登录变成全部未登录，本机数据看似被重置；后续普通启动载入旧 Quick Boot 状态后登录又出现，造成「数据已永久丢失」和「Cookie 自己恢复」的相互矛盾判断；根因：`agent-device 0.20.6` 的 Android `reinstall` 会先执行不带 `-k` 的 `adb uninstall`，再安装 APK；帮助文案「Replace installed app」没有承诺保留数据。仓库 Smoke 本来使用安全的 `install`，但临时人工命令绕过了该边界；看到账号全部未登录后又把 UI 当成永久丢失证据，在证据不足时操作 Quick Boot，扩大了诊断风险。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-019` booted emulator ID 被当成 AVD 名导致 Smoke 无法启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 主 AVD、APK SHA、版本和安装时间均已精确匹配，但设置 `WZ_ANDROID_SMOKE_DEVICE=emulator-5554` 后，Smoke 在安装前报不存在名为 `emulator-5554` 的 AVD，`APK_SANITY` 与七条 Replay 均未执行；根因：`withSmokeSession` 把同一个原始 selector 同时用于不同契约：ADB/Replay 接受 booted device ID，`agent-device boot --device` 则需要 AVD 名。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-OPS-020` 多台已启动设备使 Smoke 首次启动与前台校验串到主 AVD

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `RELEASE-02` |
| 历史症状与根因 | 主 AVD 被另一个 agent-device 会话占用时，即使 Smoke 明确选择独立验证 AVD，覆盖安装仍成功但首次 `open` 会误选主 AVD 并报 `DEVICE_IN_USE`；补上设备选择后，`appstate` 又可能读取第一台已启动设备并误判 App 不在前台。根因：`boot` 和 `install` 不保证为后续命令建立可靠的设备绑定，而首次 `open` 未携带所选设备、`appstate` 未携带已解析的 emulator serial。 |
| 当前 owner | `tests/tooling/android-smoke-guard.test.ts` |


## `REG-NOTIFY-001` 前台恢复旧未读被误报为新消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 打开 App 或进入 More 时，页面底部出现带 App 图标、厚胶囊背景和阴影的「有新的站内消息」；它与扁平列表和底部消息圆点重复，且已有未读也被误报成刚收到的新消息；根因：`src/features/notifications/useNotificationsRuntime.ts` 若只比较未读计数就无法区分旧未读与新稳定 ID，并可能把恢复值交给全局 `notify`。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-002` 消息与代理入口缺少分隔线

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | More 中「消息通知」和「服务器代理」连续显示且没有分隔线，两项在视觉上粘成一块；根因：`src/features/more/components/MoreUtilityPanels.tsx` 的工具组只有组末边框和行间距，没有组内分隔。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-NOTIFY-003` 消息页原生顶栏出现悬浮阴影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NAV-01` |
| 历史症状与根因 | 消息页标题栏底部出现明显灰黑渐变阴影，像悬浮层压在来源筛选上，与项目扁平列表不一致；根因：`src/app/AppNavigator.tsx` 依赖 native stack 默认 header elevation，根 `screenOptions` 未关闭 header shadow。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` |


## `REG-NOTIFY-004` 消息栈硬件返回被 App 根处理器截获

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 在消息列表、详情或设置按 Android 返回键时，没有按 native stack 返回上一层，而是被 App 根返回逻辑送回 Feed；根因：`src/app/appNavigation.ts` 的 native-stack route 分类与 `src/app/useAppBackHandler.ts` 的返回所有权。 |
| 当前 owner | `src/app/AppNavigator.test.ts` |


## `REG-NOTIFY-006` 非终态访问不可用被当作退出清除消息状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 登录 surface barrier、旧 unknown 记录或 Cloudflare challenge 期间，某站消息缓存、去重水位和通知摘要被当作退出清空；恢复同一账号后旧未读可能闪失或被重新投递；根因：`src/features/notifications/useNotificationsRuntime.ts` 的可信 identity 投影、active source 门禁和身份变化清理 effect。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-007` 旧账号消息详情使用新账号读取和已读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-02` |
| 历史症状与根因 | 从账号 A 的列表进入消息详情后切到账号 B，旧条目可能通过 B 的 session 加载正文或提交已读，造成串号读取和写入；根因：`src/ui/navigation/appRouteTypes.ts` 的详情 route identity、`src/features/notifications/NotificationRoute.tsx` 的 Query/mutation `AbortController` 生命周期，以及 `src/sources/notificationGateway.ts` 在 adapter I/O 前的 expected identity 门禁。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-008` 系统通知失败仍消耗投递 ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 新消息已经写入 delivered IDs，但 Android 摘要创建失败；后续后台轮次把它当作已投递，用户永远收不到该条通知；根因：`src/platform/notifications/notificationStore.ts` 的投递记录事务与 `src/platform/notifications/notificationWorker.ts` 的系统投递失败处理。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-009` 后台记录后关闭开关或换号仍发送摘要

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 后台扫描或 native 展示期间，用户立即关闭全局/单站通知或切换账号，旧轮次仍可能把 delivered IDs 与旧 identifier 写回已关闭或新账号状态；根因：`src/platform/notifications/notificationWorker.ts` 的 ack 后 currentness 门禁，以及 `notificationStore.recordNotificationDelivery` 的 compound CAS。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-010` 妖火消息列表与详情混入删除动作或聊天历史

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 妖火消息时间显示成「删除」，无方括号日期被拼进发送者；打开真实详情会提示「正文未找到」，或把回复、删除与聊天历史当成正文；根因：`src/sources/yaohuo/notifications.ts` 的 `parsePage` 时间/actor 边界、`loadDetail` 官方内容字段选择和列表复核。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-011` Discourse 顶层通知字段被忽略

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | linux.do通知明明带有标题、发起者和头像，列表却显示「站内消息」、错误 actor 或缺失头像；根因：`src/sources/discourseNotifications.ts` 的 `parseNotification` 顶层/嵌套字段优先级与头像绝对 URL 转换。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-012` NodeSeek 缺失远端 ID 的 fallback 泄露且不稳定

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03`、`MORE-02` |
| 历史症状与根因 | NodeSeek 某些消息行没有远端 row ID 时，列表重排或标题/预览编辑会产生新本地 ID，导致重复 Android 摘要；私信对方 UID 还可能进入持久化 delivered IDs；根因：`src/sources/nodeseek/notifications.ts` 的 `rowNotification` 远端 ID 选择、`stableFallbackId` 输入和私信 target/持久化 identity 分离。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-013` 消息条目读屏文案缺少动作

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | TalkBack 聚焦消息条目时只听到来源、已读状态、参与者和标题，不知道对方是提到、回复、私信还是系统互动；根因：`src/features/notifications/notificationPresentation.ts` 的 `notificationAccessibilityLabel` 与 `notificationActionText`。 |
| 当前 owner | `src/features/notifications/notificationPresentation.test.ts` |


## `REG-NOTIFY-014` 短来源 Tab 可点击区域不足 48dp

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NAV-01` |
| 历史症状与根因 | 消息页「全部」「妖火」「linux.do」等短来源 Tab 点按区域过窄或过矮，视觉上能看到但单手难以稳定点击；根因：`src/ui/controls/SelectionControls.tsx` 的共享 tab style，而不是消息页私有 padding。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-015` 聚合消息页重试一个失败来源会重读或覆盖其他站

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 |「全部」消息页有多个站点失败时只显示一个笼统重试；点击后可能重新请求全部来源，导致其他站已显示的可信消息闪动、消失或被覆盖；根因：`NotificationsScreen` 的来源错误投影与 `NotificationRoute.retrySource` 对聚合 infinite query 的定向 patch；不能把来源级恢复退化成整页 `refetch/listAllPage`。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-016` 暂停私有访问的账号在消息设置中被误报为未登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 同一时刻 More 账号中心显示某站「登录状态待确认」，消息通知设置却显示「未登录；开关意图会保留」，让已登录用户误以为账号丢失；根因：`NotificationScreens.sourceSettingStatus` 与 `NotificationsRoute.sourcePending` 没有区分 unavailable 与 anonymous。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-018` 前台新消息只亮圆点而不显示 Android 摘要

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | App 正在前台时，NodeSeek 等站已收到新回复，More 圆点和未读数会变化，但系统通知栏、横幅和声音均没有提醒；根因：`src/features/notifications/useNotificationsRuntime.ts` 的前台刷新与 `src/platform/notifications/notificationWorker.ts` 投递状态机未连接，以及 `index.ts`/`src/platform/notifications/notificationSystem.ts` 缺少前台展示 handler。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-019` 私有访问暂停或退出后旧聚合缓存仍暴露消息

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01` |
| 历史症状与根因 | 某站因 true unknown/auth-surface barrier 暂停私有访问后，单站页仍显示上次账号消息；明确退出或换号后，单站 Query 已清除，但「全部」聚合 Query 仍保存旧账号条目；根因：`NotificationScreens` 的 active-source 可见性门禁与 `useNotificationsRuntime` 的 canonical identity cache eviction。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-021` 聚合来源重试可串号并截断后续分页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 |「全部」列表重试失败来源时若恰好换号，返回的新账号消息可能被写进旧账号 Query；若其他来源已翻到后续页，重试恢复的来源即使还有下一页，「加载更多」也不会再请求它；根因：`notificationGateway.listPage` 的 exact identity 门禁和 `NotificationRoute.retrySource` 对 aggregate infinite-data cursor 所有权。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-022` 后台任务注册竞态让旧开关意图覆盖最新状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 快速开关消息通知后，设置显示已关闭但 WorkManager 仍注册，或显示已开启但后台任务已经被旧注销操作移除，后续后台新消息没有提醒；根因：`src/platform/notifications/notificationSystem.ts` 把「读取当前注册状态」和「应用目标状态」作为可并发的两段 native 操作。 |
| 当前 owner | `src/platform/notifications/notificationSystem.test.ts` |


## `REG-NOTIFY-023` 快速连续换号时旧身份 effect 覆盖最新水位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-03` |
| 历史症状与根因 | A→B→C 快速身份变化后，UI 已显示 C，但持久化通知身份又被较慢的 A→B 清理写成 B；后续 C 的 worker 因身份不一致持续跳过；根因：`src/features/notifications/useNotificationsRuntime.ts` 的 identity reconciliation 缺少每个异步副作用后的当前 generation 门禁。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-024` 发送期间关闭通知或换号后旧摘要复活

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 用户关闭通知或切换账号后，已经清除的旧账号摘要又出现在通知栏；旧 worker 还可能消耗该条投递 ID，之后无法正确重试；根因：`src/platform/notifications/notificationWorker.ts` 的投递 owner、`notificationStore` 的 identifier CAS、`notificationSystem` 的 strict/broad 撤销边界，以及 config plugin 生成的 native exact present/dismiss bridge 共同组成一项本机事务。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts` |


## `REG-NOTIFY-025` 消息中心可见时跳过系统通知并永久吞掉投递

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | App 在前台且消息中心可见时收到新回复，列表会刷新但 Android 系统通知不出现；投递 ID 已被记录，离开页面或重启后也不会补发；根因：`src/features/notifications/useNotificationsRuntime.ts` 提供给共享 worker 的 foreground notification sink。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-026` 单次 snapshot 写入失败阻断全部前台投递

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 某次未读计数已成功读取，但一次 AsyncStorage 写入失败后，本轮所有成功来源都不进入 worker；用户至少再等一个轮询周期才能收到提醒；根因：`src/features/notifications/useNotificationsRuntime.ts` 的 snapshot 持久化与成功来源投递编排。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-027` 消息列表失焦后隐藏页面仍每分钟读取站点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 从消息列表进入详情或完整主题后，已隐藏但仍 mounted 的列表继续每分钟访问三站，造成无意义请求和与当前页面不一致的刷新；根因：`src/features/notifications/NotificationRoute.tsx` 的 native stack focus 与列表 Query 生命周期。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-028` NodeSeek 省略 `viewed` 的新消息被当成已读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | More 已显示「有未读 · 后台通知已开启」，Android 权限和 channel 正常，但朋友新发的 @我/回复没有系统通知；根因：`src/sources/nodeseek/notifications.ts` 把缺失的已读标记默认成 `true`，worker 因 `unread=false` 过滤该行。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-029` NodeSeek 同一通知记录的新回复被投递水位去重

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 朋友再次回复同一帖子后 More 能看到未读，但 Android 通知栏没有新的系统通知；根因：`src/sources/nodeseek/notifications.ts` 优先用列表行 `id` 生成统一消息 ID，把远端 `markViewed` 记录 ID 与每条回复的稳定身份混为一体，worker 将新回复误判为已投递。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-030` NodeSeek 自己发出的私信被误报为对方新私信

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-03` |
| 历史症状与根因 | 用户刚给对方发送私信后，App 却显示「对方发来私信」并触发一条新的 Android 系统通知；根因：`src/sources/nodeseek/notifications.ts` 的列表解析只看 `viewed`，没有像详情未读 ID 逻辑一样同时校验 `sender_id !== ownUserId`。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-031` 单站通知被全局类型抹平且私信无法按原站协议回复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`NOTIFY-03`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`NAV-01` |
| 历史症状与根因 | 进入某个站点后仍只能看到跨站「全部/未读」，无法选择原站的 @我、回复、个人信息、系统或聊天分类；私信详情只有一段正文，不能连续阅读双方消息，也不能在 App 内回复；根因：展示类型与站点筛选语义被合并在全局 domain；会话读取、回复 transport、身份/scope/abort 门禁和草稿确认语义没有经过 `NotificationAdapter → notificationGateway → NotificationRoute` 同一链路。 |
| 当前 owner | `src/sources/notificationGateway.test.ts` |


## `REG-NOTIFY-032` 私信会话退化成顶部正文且丢失既有图片与表情能力

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01`、`ACCOUNT-01` |
| 历史症状与根因 | 私信消息挤在页面顶部、正文下方留下大块空白，作者与时间反复塞进气泡，底部只有孤立的「回复私信」按钮；打开回复后，Topic 已有的图片上传、NodeSeek 贴纸和 Discourse emoji 全部消失；根因：Topic-local composer 同时拥有共享编辑能力与 Topic 目标文案，通知功能因此复制了残缺实现；会话布局没有把 native header、消息流和固定 composer 入口分成明确层级。App runtime 又直接实现 LinuxDo 模板、计数和投票能力协议，绕过 notification gateway 的 route identity 生命周期。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-033` NodeSeek 后续页通知详情错误显示不可用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 的 @我/回复条目可正常进入完整主题并看到目标楼层，但消息详情却显示「NodeSeek 消息对应的帖子内容未找到」；根因：`src/sources/nodeseek/notifications.ts` 的通知详情分页曾固定从第 2 页开始并按 `replyCount` 推导末页，丢弃了通知 floor 已提供的可靠页提示和原站页拓扑。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-034` 通知详情底栏被系统手势区遮挡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 私信详情底部输入入口贴到系统手势条上，视觉拥挤且底部点击区域可能被遮挡；普通通知的固定主题按钮存在同一风险；根因：`src/features/notifications/NotificationScreens.tsx` 的两个固定 dock 只使用固定垂直 padding，没有消费 `react-native-safe-area-context` 提供的 bottom inset；弹出的共享 Composer 已独立正确处理安全区。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-035` 消息一级 Tab 文字与选中线不同轴

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01` |
| 历史症状与根因 | 消息页一级来源 Tab 看起来歪斜：短中文标签靠在点击区左侧，蓝色选中线却铺满整个最小宽度；长英文标签接近占满宽度，导致同一排各项朝向不一致；根因：`src/ui/controls/SelectionControls.tsx` 的 `tab` 保证了最小宽度，但 `tabText` 没有居中；React Native Text 拉伸到按钮宽度后沿默认起点绘制。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-036` 消息中心与共享回复器忽略 App 字号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | More 已显示「字号 130%」，消息列表、私信气泡和回复输入框却仍保持 100% 大小；页面间字号所有权不一致，大字号也无法改善可读性；根因：`createNotificationStyles`、原生 Composer chrome 与 Yaohuo 输入器没有一致消费 `ReaderStyleProvider` 的 `settings.fontScale`。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-NOTIFY-037` 妖火聊天泄露原始包装并重复、倒序或丢失时间

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 妖火会话气泡显示「回复时间/回复内容」等原站协议标签，原消息在聊天中重复；服务端倒序记录直接展示，日期甚至被当作作者，清理包装后气泡时间又消失；根因：`src/sources/yaohuo/notifications.ts` 把 `.con` 原 HTML 直接当正文，没有先分离协议元数据、按内容去重和按解析时间排序；作者/时间只信任单一 `.info` 结构。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-038` 大字号回复工具与表情网格被截断或失去输入反馈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 130% 下工具栏末尾的引用、代码或列表无法通过横滑到达；输入光标仍是系统默认色；Discourse 表情同时显示英文名称，网格拥挤且不像可浏览的表情面板；根因：结构化 Composer 的工具容器没有同时保证单行内容宽度、嵌套横向手势和末尾工具可达；TextInput 未声明主题 cursor/selection color；Discourse emoji 使用文字型可变宽单元，而不是图像优先等宽网格。工具栏具体布局由后续 `REG-NOTIFY-055` 收敛。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-039` 三站消息时间格式互相跳变

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 同一消息页同时出现「8/3 09:05」、`2026/7/3 13:46` 和 ISO 派生格式，跨年份或站点时难以快速比较；气泡时间与列表又使用不同 formatter；根因：`notificationTimeText` 对两类时间分别调用通用相对格式和原字符串；会话气泡另直接使用 `formatDateTime`。 |
| 当前 owner | `src/features/notifications/notificationPresentation.test.ts` |


## `REG-NOTIFY-040` 通知富文本链接脱离 App 主题色

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 通知详情中的链接使用 `react-native-render-html` 默认蓝色，与 App primary、深浅主题和其他可点击文字不一致，看起来像未完成的网页片段；根因：共享 `DetailHtml` 只传 baseStyle，没有为 `a` 提供由 Reader theme 拥有的 `tagsStyles`。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-041` 表情面板把回复操作压进 Android 导航栏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 130% 下打开 NodeSeek 贴纸或 Discourse emoji 后，「取消/发送回复」被压到 Android 手势条后面；若简单放开高度，linux.do 表情面板又铺满整屏并留下过量空白；根因：`ComposerBottomSheet` 把最大动态内容高度固定为窗口 58%，子内容超过上限后仍继续布局；既有 bottom safe padding 因内容溢出而落到容器外。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` |


## `REG-NOTIFY-042` 妖火气泡外斜杠时间在 Android 丢失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 妖火聊天气泡能显示作者、图片和正文，但真实已读会话的气泡下没有时间；根因：`chatMessages` 只从 `.info` 与正文节点取时间；共享 `toIsoString` 又只规范化连字符日期，导致 Node 测试偶然通过而 Android 返回 null。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-043` Discourse 私信从所有通知进入时退化为普通帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 同一条消息在「所有通知」列表已经显示「发来了私信」，点进去却是普通通知/帖子详情；从「个人信息」点进去才显示完整私信会话和回复入口；根因：`parseNotification` 正确生成了 `kind=private-message`，但 target 仍无条件按 `topic_id/post_number` 生成 `topic-post`；详情 loader 按 target 分支，因此丢失会话与回复能力。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-044` 妖火会话主题链接跳出 App 打开浏览器

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-01`、`TOPIC-03`、`NAV-01`、`NAV-03` |
| 历史症状与根因 | 妖火会话里的「查看主题帖」和「查看完整回复」点击后打开系统浏览器，离开 App；部分真实会话中「查看完整回复」还会被清理器直接删除；根因：妖火 adapter 把「查看完整回复」误当作 footer 包装删除；消息 `DetailHtml` 又未复用 `parseForumTopicLink`，所有锚点都沿 renderer 默认行为交给 `Linking.openURL`，且 route callback 无法携带解析后的 Topic。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-045` 妖火「查看完整回复」进入主题后丢失具体楼层

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 |「查看完整回复」已经留在 App 内，但进入主题后仍停在主楼，用户还要手动寻找原站指向的具体回复；根因：`DetailHtml` 只调用 `parseForumTopicLink` 得到 canonical Topic，原始 query 被丢弃；`onOpenTopic` 与 Notification route 也没有继续传递链接级 `targetReply`。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-NOTIFY-046` 妖火目标楼层线性追页且分页被同名用户劫持

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 |「查看完整回复」进入主题后可能从第 2 页逐页请求到目标页；普通帖子或用户列表遇到昵称为「下一页」的用户时，还会提前停止分页或跳进用户主页；根因：Topic 目标回复加载只保留 `{ floor }`，沿通用「加载更多」从当前页线性追赶；初次直达实现又把可选的 `Response.url` 当成唯一当前页依据，缺失时回退为 1，下一次错误请求第 2 页。妖火 HTML parser 还把链接文本当成分页身份，未要求合法 `page` 游标和对应列表 endpoint。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-NOTIFY-047` NodeSeek 完整主题链路丢弃 comment ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-03` |
| 历史症状与根因 | 通知详情能找到准确回复，但「查看完整主题」在缺少楼层时留在首屏；楼层提示错误时还可能定位到同楼层的其他回复；根因：Topic Controller 把 floor 当成必填目标，且共享读取接口只继续传 `targetFloor/pageHint`，路由已有的完整 `ReplyLocationTarget` 在到达 NodeSeek adapter 前被压扁。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-NOTIFY-048` NodeSeek `message_id` 兼容值只用于去重未进入导航目标

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NOTIFY-03` |
| 历史症状与根因 | 某些 NodeSeek @我/回复行可以稳定显示和去重，但打开完整主题时没有精确 comment ID，只能退化到楼层；根因：mapper 用 `comment_id || message_id` 生成通知 ID，却只把 `comment_id` 写入 `target.postId`，同一个远端身份在投递和导航模型中分叉。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-049` 身份待确认被当成换号并清空私信草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-02` |
| 历史症状与根因 | App 短暂重新确认账号时，正在编辑但未发送的私信草稿被清空；确认仍为同一账号后无法恢复；根因：Notification route 在任何 `canAccessSource=false` 时无条件清草稿，把真正 unknown 或登录 surface barrier 的暂停访问误当成已确认退出或换号。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-050` 消息共享 Tab 与按钮绕过 Reader 字号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-03`、`FEED-02`、`FEED-03`、`FEED-04`、`SEARCH-02`、`SEARCH-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 消息正文随 Reader 字号放大，但来源/分类 Tab 与详情、回复操作按钮仍保持小号，130% 档位下层级割裂且可读性下降；根因：两个共享控件虽然读取 Reader font family/theme，却把 11/12/13/15 和 line-height 写成固定值。 |
| 当前 owner | `tests/ui/shared/accessibility-basics.test.tsx` |


## `REG-NOTIFY-051` 妖火已读复核丢失分类上下文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01`、`NOTIFY-02` |
| 历史症状与根因 | 从「系统」或「聊天」分类打开消息后，原站已经标为已读，App 仍提示「原站仍显示为未读」；根因：adapter 只把页码塞进 `remoteGroup`，复核时回到默认收件箱，丢失原分类；分类与 cursor 两种来源上下文被压成一个字段。 |
| 当前 owner | `src/sources/yaohuo/notifications.test.ts` |


## `REG-NOTIFY-052` More 红点没有指向消息入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03`、`MORE-02` |
| 历史症状与根因 | 底部「更多」出现红点，但进入 More 后「消息通知」入口没有任何红点，用户无法判断提示来自消息还是版本更新；根因：`useAppRuntime` 只把未读状态压成中文 summary 传给 `MoreUtilityPanels`，消息入口没有结构化未读字段，也没有渲染视觉标记。 |
| 当前 owner | `tests/ui/app/app-navigator.test.tsx` 承接当前底栏红点分流，`src/ui/navigation/moreBadge.test.ts` 承接提示语义，未读状态核对沿用 `tests/ui/notifications/notifications-runtime.test.tsx`。 |
| 当前导航模型 | 消息已成为底栏第三格的 Bell 入口，More 不再提供消息行；结构化未读只点亮「消息」，更新只点亮「更多」。 |


## `REG-NOTIFY-053` 主题级通知被强制定位到不存在的具体帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | 点击主题提醒、系统通知或只有主题关系的消息时，详情提示「站内消息没有可定位的帖子」或进入主题后提示找不到对应回复；根因：来源 mapper 把所有带主题身份的通知都生成 `topic-post`，详情 loader 因而强制查找具体帖子，route 又把不存在的定位信息传给 Topic。 |
| 当前 owner | `src/sources/discourseNotifications.test.ts` |


## `REG-NOTIFY-054` Discourse 首帖通知被当作回复楼层定位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NAV-03`、`TOPIC-03` |
| 历史症状与根因 | 在消息详情点击「查看相关主题」后，主题正文已正常打开，却额外提示「目标楼层未找到」；现场样本为 linux.do 已读系统消息「LINUX DO 社区抽奖规则」；根因：`NotificationDetailRoute` 复用同一个 `topic-post` target 同时决定详情读取和 Topic 回复定位，把首帖的 post ID 与 post number 1 无条件转换成 `{ commentId, floor: 1 }`；Topic 回复集合不包含 opening post，因此定位必然失败。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NOTIFY-055` 共享回复工具栏回归为两行换行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 富文本输入框上方的格式工具从原有单行横向滑动变成两行，挤占正文与键盘之间的编辑空间；Topic 和私信入口同时受影响；根因：历史通用 ReplyComposer 把 toolbar 从横向容器改为普通换行 View，并把错误布局固化进测试。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-NOTIFY-056` NodeSeek 私信把字符串会话 ID 直接作为 receiver UID 发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | App 原生 NodeSeek 私信回复后保留草稿并提示「NodeSeek 请求失败：HTTP 200」；刷新原生会话和 App 内 NodeSeek 原站同一会话都看不到该消息；根因：`src/sources/nodeseek/notifications.ts` 把领域层字符串身份未经 adapter 转换直接泄漏到站点 JSON。旧测试又把字符串 receiver UID 与自造 `{ success: true }` 同时写进 Mock，只证明实现符合自身假设，没有固定真实协议。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts` |


## `REG-NOTIFY-057` NodeSeek 私信把表情码当作普通文字渲染

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-02` |
| 历史症状与根因 | App 原生 NodeSeek 私信会话把 `:ac04:` 原样显示在气泡内；App 内 NodeSeek 原站的同一条消息显示粗体 Markdown 与 AC 娘图片，双方内容语义不一致；根因：NodeSeek 已知表情目录只属于 composer UI，来源 adapter 无法复用；评论的 sticker element model、ExpoImage renderer 和图片尺寸 cache 又封装在 Topic feature 内，导致私信输入归一化与展示分别绕过同一套论坛内容能力。 |
| 当前 owner | `src/sources/nodeseek/markdown.test.ts` |


## `REG-TOPIC-062` 极大回复楼层被当作从首屏开始的连续前缀

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02` |
| 历史症状与根因 | 点击很远的被回复楼层会从当前页逐页追赶，长帖产生请求风暴；即使跳到目标，中间缺失页面也可能被拼成连续列表。关系标签整块点击又会打开用户名片，用户无法单独点楼层。定位到中段后只能向下加载，编辑、删除或新回复还可能按已加载数量刷新错误页面；根因：Controller 把 Infinite Query 页组误认为「从第一页开始的完整前缀」，用 `loadMoreReplies` 反复追目标，并以 `topicReplies.length`、数组下标或扩大 page-size 推断绝对页面；route/parser 又使用零散的 reply Pick 类型并丢失 page/fragment。列表只支持 next cursor，写后刷新复用同一错误推断。 |
| 当前 owner | `src/domain/forum/links.test.ts` |


## `REG-TOPIC-063` 回复窗口等到重试按钮可见才加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 从锚点窗口向上滚动时，先看到「加载更早回复」按钮，随后才开始请求和前插，操作感觉迟滞；本地倒序又只翻转已加载片段，并不能代表原站完整倒序结果；根因：`TopicContentList` 把网络需求与重试 UI 绑定；旧实现又把 `newest` 混入 `ReplyFilter`，在展示层反转不完整集合。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-067` 倒序只反转已加载片段而非服务端回复流

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 多页主题切换倒序后仍先看到第一页的倒排片段，继续下滚又混入后续正序页；用户误以为看到最新回复，实际既不完整也不连续；根因：`ReplyFilter.newest` 在 UI 对本地数组执行 `reverse()`，回复 Query key 不区分遍历方向；Controller 根据已加载数量猜页，来源 adapter 没有拥有尾窗算法、页内顺序和 cursor 转换。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-068` NodeSeek 真实下一页被旧回复总数否决

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 主题明明存在下一页，窗口到达边缘却报错；同一页面实际已到 `#14`，主题头和「回复列表」仍显示 10，切到倒序又报「回复总数已变化，无法确认最新窗口」。真实样本是 `post-861053-1`；根因：`src/sources/nodeseek/topicParser.ts` 把详情页 `comments[]` 的当前页长度暴露成总回复数，`src/sources/nodeseek/reader.ts` 又拿这个伪总数定位倒序尾页并否决真实相邻页。`src/domain/forum/models.ts` 原先强制每个 Topic 都有 `replyCount`，使来源不知道总数时只能制造数字；`src/sources/nodeseek/protocol.ts` 还没有把 pager 链接与普通内容链接分开。Controller 的刷新计数恢复只能延后症状，不能修复错误事实。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-069` V2EX 独立缓存端点被拼成伪回复窗口错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 活跃主题 `https://www.v2ex.com/t/1232497` 的原站 HTML 已完整包含全部回复，App 却报「回复总数已变化，无法确认完整集合」；正倒序、楼层定位和评论刷新因此都无法使用；根因：`src/sources/v2ex/reader.ts` 把独立缓存端点错误拼成一个快照，并让「能否证明全集」反向否决已经逐条解析成功的评论。完整性属于当前 HTML 页面窗口，不是评论可见性的总闸门；公共 API 只能在首页 HTML 不可用或没有可用回复时作为独立降级，不能补洞或参与投票。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-070` NodeSeek 热门/置顶展示副本污染倒序窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek `post-832584-1` 正序可读，切换倒序却弹出回复窗口错误；最新回复和相邻更早窗口都无法显示；根因：`src/sources/nodeseek/reader.ts` 把 HTML 中所有回复节点都当作当前固定 10 楼窗口的拓扑成员，并在页内投影前按 `limit` 截断。热门/置顶是展示副本，不证明其楼层属于当前页；把它纳入连续楼层校验会误报，把所有页外项都忽略又会掩盖真实错页。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-071` V2EX 超过 100 条回复时只读取第一页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | V2EX `t/1231874` 声明 107 条回复，App 只显示第一页 100 条且没有下一页游标；`#101..#107` 永久不可达，或必须用「刷新评论」一次抓完整帖才能出现；根因：`src/sources/v2ex/reader.ts` 把「页面窗口完整性」和「整帖是否全部载入」混成一个 boolean：第一页有 100 条有效行和明确 `p=2` 时仍被标成无 cursor 的 partial；旧 `getV2exReplies` 又把一次 Reply Query 实现成跨页全集同步。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-072` 妖火删除边缘楼层与新页码字段阻断整个评论区

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 妖火 `bbs-1570569.html` 的主题正文可读，但评论区正序或倒序弹出「妖火未确认目标楼层所在页」或目标楼层缺失错误，已经返回的回复也完全不展示；根因：`src/sources/yaohuo/reader.ts` 一方面只识别旧页码表单，另一方面把用于寻找正序/倒序边缘页的 `tofloor` hint 当成显式楼层 target，要求该楼层实体必须存在。页码证据与实体身份被错误合并成单一硬门禁，导致可解析、由服务器确认的整页回复被丢弃。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts` |


## `REG-TOPIC-073` Discourse 单条 hydration 竞态阻断整个回复窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do的主题和大部分回复已返回，但批量 hydration 因删帖或读竞态漏回一条，App 仍报「Discourse 回复窗口不完整」并丢弃其他可读回复；根因：`src/sources/discourse/model.ts` 的 hydration 校验把「所有返回实体都属于请求窗口」与「每个请求 ID 必须同次返回」合并成一个硬门禁。前者防止串帖，后者只是对投影时序的过强假设。 |
| 当前 owner | `src/sources/discourse/model.test.ts` |


## `REG-NODESEEK-004` NodeSeek 直连通道卡死只能靠重启 App 恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`DATA-02`、`DATA-03` |
| 历史症状与根因 | NodeSeek 直连连续命中 8 秒，WebView 却能返回；同进程内后续读取继续卡顿，只有关闭重开 App 后恢复；根因：`src/sources/nodeseek/browserFallback.ts` 的直连/WebView 结算边界、`src/platform/network/networkProxy.ts` 的跨来源 generation single-flight 与原生 App 级读取 runtime 轮换；具体是哪一个 Native transport phase 最先污染仍由后续安全诊断证伪。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-008` linux.do 直连长期卡死且检查状态超时

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | linux.do 列表突然无法加载，账号状态检查也长时间超时；关闭重开 App 后恢复；根因：`src/sources/linuxdo/browserFallback.ts` 的直连 watchdog、WebView evidence gate 与 App 级读取 runtime 轮换；Cloudflare challenge 仍是独立且不触发轮换的 fallback 原因。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-LINUXDO-009` Connect 会话失效让官方等级退回本机估算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`、`ACCOUNT-02` |
| 历史症状与根因 | 同一账号在 App 内手动打开 Connect 官方页或在手机 App 可以看到官方等级进度，但模拟器直接点击「查看等级」偶发只显示「本级估算」；手动看过真实页面后又恢复；根因：`src/sources/linuxdo/level.ts` 在 Connect 直连/解析失败后直接吞错并降级估算，没有调用 `src/sources/linuxdo/browserFallback.ts` 已有隐藏 WebView；手动打开真实页之所以「治好」，是页面导航顺带完成了 SSO 和 Connect Cookie 续签。 |
| 当前 owner | `src/sources/linuxdo/level.test.ts` |


## `REG-LINUXDO-010` 过期登录下的搜索 429 被误报为单纯频控

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 模拟器里 linux.do 的真实登录已经失效，但本地仍处于已确认 authenticated scope；普通搜索返回结构化 HTTP 429 后，Search 直接把「次数过多」当成最终结论，没有调用 canonical `/session/current.json` 复核，因此无法区分真实频控与过期会话。修复只在 linux.do 普通 authenticated 搜索的 `status === 429` 且 `kind === ordinary` 分支等待一次现有 Account 复核：身份或 read-plan scope 变化时丢弃旧 Query，由既有 public plan 显示 Google 入口且不自动打开浏览器；身份相同时保留原频控；复核未知时保留会话并显示组合状态。ReadGateway 的 raw-401-only 即时失效门禁与 Cookie 所有权不变。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-PROXY-009` 单站通道恢复误伤其他请求或写操作

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 为恢复 NodeSeek 或 linux.do 读取而全局 `cancelAll` 或替换只有后续 client 才能看到的 pool，会连带取消其他站读取，或显示恢复成功但既有 client 仍复用故障连接；根因：当时的 withNetworkProxyModule 生成器 生成的 App 级 `ReadNetworkRuntimeGeneration`、受控来源/方法识别和旧代 drain；`src/platform/network/networkProxy.ts` 以 `expectedGeneration` 做跨来源 single-flight/CAS。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-010` 兜底显示成功但下一次详情与图片仍卡在旧 Native runtime

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`MORE-02`、`TOPIC-01`、`TOPIC-02`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 阈值为 1 且 WebView fallback 已成功，下一次详情仍长期 Loading，正文图片也约 40 秒不显示；只有结束进程再进入才立即恢复；根因：OkHttp cancel/release 不是同步边界，旧实现在 release 前清池，且只清 forum pool；Dispatcher、两个 pool、ProxySelector wrapper、Glide client 与 Cronet generation 都未真实替换，JS 的 generation 只是计数。 |
| 当前 owner | `src/platform/network/networkProxy.test.ts` |


## `REG-PROXY-012` V2EX 或妖火当前读取超时后持续卡住

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`MORE-01`、`MORE-02`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | V2EX 或妖火的当前列表、搜索、帖子、回复或用户读取偶发一直转圈或报请求失败；完全退出 App 后重新进入却立即成功，说明故障可能留在进程内的 Native 读取 runtime，而不是该页面数据永久不可用；根因：`fetchWithTimeout` 过去只抛同文案的普通 `Error`，`ReadGateway` 无法把「请求自身达到 deadline」与 HTTP、解析、登录、调用方取消区分；NodeSeek/linux.do 只有 parser-proof fallback 路径会调用 `recoverReadNetworkRuntime`，另外两站即使命中同一进程级故障也只把错误交回页面，App 重启才间接换掉 runtime。 |
| 当前 owner | `src/platform/network/request.test.ts` |


## `REG-PROXY-013` App 后台不暂停共享请求 deadline

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01` |
| 历史症状与根因 | 页面请求进入后台一段时间后，回到 App 仍继续 Loading；它要再等待一轮剩余的 8/15 秒预算，之后既有 fallback 或读取 runtime 恢复才会生效；根因：`src/platform/network/request.ts` 用全局 active flag、listener 和剩余预算重算暂停 timeout；`src/app/useAppLifecycleRuntime.ts` 又把 AppState 接入该状态，使 React Native Android 已保留的绝对 Timer deadline 被应用层改写。 |
| 当前 owner | `tests/ui/app/app-lifecycle-request-timeout.test.tsx` |


## `REG-FEED-014` 一个慢来源拖住聚合首页与分类

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 首页「全部」或分类一直 Loading，实际只有一个站不结算，其他站已可用；根因：`src/sources/readAggregation.ts` 复用 `withAbortableTimeout` 的 `AGGREGATE_SOURCE_BUDGET_MS`，并拥有 Feed child 的 typed timeout/cancel 与 cursor 结算。 |
| 当前 owner | `src/sources/feedRead.test.ts` |


## `REG-FEED-015` 在途首页请求让手动刷新失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04` |
| 历史症状与根因 | 列表请求卡住后下拉刷新只提示「列表正在更新」，无法替换旧请求；关闭重开 App 才恢复；根因：`src/features/feed/useFeedController.ts` 的手动刷新所有权，以 TanStack Query exact cancel + `refetch({ cancelRefetch: true })` 替换在途请求。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-FEED-016` 首页来源 Tab 在 100% 下过高过宽

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04`、`MORE-03` |
| 历史症状与根因 | v1.3.95 后首页「全部 + 四站」一级 Tab 在 100% 字号下比二级导航大很多，每项过宽；130% 字号缩放本身仍应保留；根因：`src/ui/controls/SelectionControls.tsx` 的共享 Tab 样式与 `compactTabs` 局部 override；`src/features/feed/FeedScreen.tsx` 只为顶部来源栏启用。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` |


## `REG-TOPIC-064` 论坛图片遭遇 Cloudflare Challenge 后原生详情无法显示

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | NodeSeek `post-857589-1` 的 `im.legend.moe` 1028×937 WebP 在原站 WebView 正常显示，原生详情只显示灰色占位。Expo Image 的 OkHttp 响应为 `403 + Cf-Mitigated: challenge`；复制完整浏览器头仍是 challenge，而匿名 WebView 与 Cronet 均能取得图片；根因：`src/platform/media/imageRequestSource.ts` 的通用请求画像只负责 Accept、UA、语言、内部来源和 identity；`Referer` 由 `REG-TOPIC-078` 的文档/元素契约独立决定。传输恢复 seam 是 当时的 withNetworkProxyModule 生成器 生成的 Expo Image/SVG 专用 client。把补请求头或补图床 Host 当成浏览器等价无法解决网络栈指纹差异。 |
| 当前 owner | `src/platform/media/imageRequestSource.test.ts` |


## `REG-TOPIC-065` NodeSeek 透明动态贴纸出现黑底并在前后台切换时重载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek `post-859086-2#14` 的三个动态贴纸在原站为透明动画，原生详情中前两个出现黑色方块；App 切到后台再回来时贴纸重新加载；根因：NodeSeek HTML 的 `video.sticker` 归一化 → `FORUM_VIDEO_STICKER_TAG` → `src/features/topic/rendering/contentMediaRenderers.tsx` 的透明媒体承载与 App 可见性生命周期。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-066` 同一贴纸目录的不同图片被统一压成小尺寸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 同一楼层中的 `xhj/003.png` 与 `xhj/015.gif` 在原站分别按约 `57×48`、`82×82` 显示，App 却把两张都压成约 `48×48`；只有一个 HTML 尺寸轴时还会被画成正方形，阅读字号放大后又可能突破 100 dp。过往按素材或目录修补后仍会在新贴纸上复发；根因：`src/domain/forum/forumContentMedia.ts` 的混合段落分流 → `src/platform/media/inlineMedia.ts` 的占位尺寸推导 → `src/features/topic/rendering/htmlElementModels.ts` 的 block/textual content model → `src/features/topic/rendering/contentMediaRenderers.tsx` 的 Expo Image `onLoad` → 已有 session-aware 有界自然尺寸缓存。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-PERF-010` 海量正文图片把内容总量线性转换成 App 运行时工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 的正文请求先成功，但 1413 张图片集中在一个顶层 `<p>` 内；App 随后长时间失去响应、图片不显示，返回也卡顿，约 30 秒后出现 1390+ 个同步取消和多条 `ResponseBody` 泄漏，严重时进程卡死或退出。同进程后续详情的响应性也会被残留工作拖累；本条不把该现象归因为 `ReadNetworkRuntimeGeneration` 污染；根因：`src/domain/forum/topicContentSplit.ts` 的唯一公开 `compileForumContent()` 是不可信 HTML 到有界 typed UI rows 的编译边界；poll/quote 提升、视频分类、HTML 分片和 semantic continuation 都藏在该深 module 内，model/renderer 不再拥有第二套 DOM 规则。compiler 只产出 disclosure 的初始值，route-scoped `TopicSplitDisclosureStore` 唯一持有展开状态并在父 FlashList 前过滤 body rows，header renderer 不持有第二份状态或正文。`src/features/topic/media/TopicBodyMediaCoordinator.tsx` 是 Topic 正文媒体许可、timeout、retry 与 runtime-generation restart 的唯一 owner；`src/ui/media/ImagePreviewModal.tsx` 独立拥有预览 physical window，生成的 `CloseSafeGlideStreamFetcher` 拥有 Native body。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-074` Glide 取消竞态泄漏 ResponseBody

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 海量正文退出或媒体 permit 被撤销后，log 出现多条「A connection ... was leaked」警告；在另一种回调顺序下，图片流也可能在 Glide 消费前被过早关闭。长帖的一次批量取消会放大泄漏并拖累后续详情；根因：当时的 withNetworkProxyModule 生成器 生成的 `CloseSafeGlideStreamFetcher` 统一拥有 call/body 状态；`CloseSafeGlideUrlLoader` 与 `CloseSafeGlideUrlWrapperLoader` 必须同时在 App Glide registry 覆盖对应 model，wrapper 继续包装读取进度。依赖升级不能替代本项目的明确资源所有权。 |
| 当前 owner | `tests/tooling/network-proxy-plugin.test.ts` |


## `REG-TOPIC-075` 全屏原图翻页把已访问图片累积成 decoded Bitmap 工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-03` |
| 历史症状与根因 | 海量图片帖的正文已经可以滚动，但进入全屏预览并快速切过多张图片后，Native Heap/PSS 持续增长；关闭预览、返回 Feed 60 秒后仍不回落。极大原图还可能单张占用数百 MiB，使 App 再次卡顿或被系统杀死；根因：`ImagePreviewModal` 拥有稳定的三个 physical slots，slot identity 不随 logical index 增删；`PreviewPageLoadLayer` 在每个 slot 内复用稳定 raster/underlay Native owner，以 `source/recyclingKey` 替换资源并统一拥有全屏 raster、连续显示 underlay、静态 SVG poster 和动画 continuity poster 的 decoded-resource policy；`src/platform/media/previewBitmapBudget.ts` 只把 viewport/DPR 转成固定 Native decode target。不得在关闭预览时调用全局 `Image.clearMemoryCache()` 误伤 App 其他健康图片。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-112` 全屏已下载原图仍按 2048px Bitmap 放大，长图当前视口模糊

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 图片在原站和原始 URL 上清晰，App 也已下载原图，但点进全屏后仍模糊；长图在适屏和深度放大时尤其明显，用户无法看到原图细节；根因：`ImagePreviewModal.PreviewPage.active` 是唯一高清所有权；基础原图 `onDisplay` 后由 Expo Image `getCachePathAsync(cacheKey)` 只读同一 Glide 磁盘文件，`ResumableZoom.getVisibleRect()/getState().scale` 只在静止点产出 viewport，`PreviewRegionImage` Native View 用 `BitmapRegionDecoder` 解码该区域并把 upright 尺寸回传给同一 resolution owner。三槽基础 owner、正文 `TopicBodyMediaCoordinator` 和网络链路不参与高清调度。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-076` V2EX 完整性不确定时清空可信评论或进入后台轮询

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 直达 `https://www.v2ex.com/t/1232881` 时首次出现整页「窗口错误」；重复进入数次后又能完整加载。故障期间主题正文和第一页已经解析成功的评论也全部不可见，旧修复还会在后台反复读取；根因：adapter 把集合完整性和单行可信性合成一个失败边界，Controller 又把来源不确定性扩成 typed error、timer 和重试状态；一个不可信节点或计数因此同时清空可信行并制造后台请求。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-DATA-007` 内容源设置未读到就按全关处理或永久阻塞启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-01`、`DATA-02`、`DATA-03`、`NAV-01`、`MORE-05`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`ACCOUNT-01`、`NOTIFY-03` |
| 历史症状与根因 | 首次或冷启动先看到所有来源消失、搜索显示「未启用/暂停」，甚至一直停在启动页；同时已经存在的收藏、历史或关注可能被空设置覆盖；根因：`src/platform/storage/readerDataStore.ts` 的双 key 读取、`src/app/useReaderRuntime.ts` 的启动结算和 `src/domain/reader/contentSourcePreferences.ts` 的默认投影没有共同区分「配置缺失可默认」与「ReaderData 损坏需恢复」。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts` |


## `REG-PROXY-011` 代理初始化冻结本地页面或失败后静默直连

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`NAV-01`、`LIBRARY-01`、`FEED-01`、`SEARCH-01`、`TOPIC-01`、`TOPIC-02`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-04` |
| 历史症状与根因 | SecureStore 或原生代理初始化稍慢时，App 白屏/启动页停留数秒甚至卡死，收藏和更多等本地页面也进不去；另一种修补会在配置读取超时或 runtime 卸载后放行直连，泄露本应经代理的请求；根因：`src/app/useAppRuntime.tsx` 的 route readiness、`src/platform/network/useNetworkProxyRuntime.ts` 的 SecureStore owner/load/apply queue，以及 `networkProxyFetcher`/WebView 的请求前 readiness 没有分离本地导航可用性与网络安全性。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-SOURCE-011` 账号未知被当成整站不可用并锁死公开读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-05`、`NAV-02`、`WRITE-01` |
| 历史症状与根因 | App 启动或账号检查暂时失败后，公开可读的 Feed/Search/Topic/User 全部显示「账号状态未知/暂停」，任一来源核对 activity 还能让「全部」永久 Loading；反向降级时，妖火或私有操作又可能被误走匿名 transport；根因：`src/domain/forum/readPlan.ts`、`src/sources/readGateway.ts`、聚合 child fetcher 与 Feed/Search/Topic/User Query key 是同一个 operation capability seam；账号事实不应拥有来源静态能力。 |
| 当前 owner | `src/domain/forum/readPlan.test.ts` |


## `REG-SOURCE-012` 旧详情的「管理内容源」只进入 More、面板仍折叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05`、`FEED-01`、`SEARCH-01`、`LIBRARY-01`、`TOPIC-01`、`USER-01`、`NOTIFY-02`、`NAV-01`、`NAV-02` |
| 历史症状与根因 | 从已停用的 Topic、User 或旧 NotificationDetail 点击「管理内容源」后虽然返回 More，内容源面板仍折叠，用户还要再次寻找并展开入口；根因：所有内容源管理入口 → `MainTabs.more` route params → `MoreRoute` → `ContentSourcesPanel` 的导航意图边界。 |
| 当前 owner | `tests/ui/app/content-source-navigation.test.tsx` |


## `REG-SEARCH-024` 首次进入搜索被账号提示占据且来源不能独立结算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 用户尚未输入关键词时就看到「账号状态未知/暂停搜索」；提交后一个站没有确认身份会让整页一直忙碌，公开来源结果也不出现；根因：`src/features/search/useSearchController.ts` 的提交快照/逐来源 `useQueries`、`SearchScreen` 的 idle/blocked presentation 和 `forumQueryKeys.search` 的 ReadPlan scope。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-025` 页面级账号状态重复来源级搜索结果

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 一个站点需要登录或核对时，搜索页头先显示整页账号状态条，结果组又显示同一提示，用户会误以为整个搜索被暂停；根因：`SearchScreen` 页头状态条与 `SearchGroup.authNotice` 重复拥有同一个来源操作状态。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` |


## `REG-SEARCH-026` 搜索筛选收起键盘后弹层持续上跳

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-03`、`ACCOUNT-05`、`MORE-01` |
| 历史症状与根因 | Android 搜索筛选中点开 V2EX 节点或 Discourse 标签、分类、作者输入，收起键盘后弹层仍向上偏移；已复现关闭按钮从 y=1327 移到 y=1128，连续操作可能重复出现；根因：`src/ui/controls/ModalSheetFrame.tsx` 对 Android 键盘可见状态与高度避让的统一 ownership。 |
| 当前 owner | `tests/ui/shared/modal-sheet-frame.test.tsx` |


## `REG-SEARCH-027` 聚合搜索结算后进入 V2EX 导致 App 退出

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`SEARCH-04` |
| 历史症状与根因 |「全部」搜索完成后点击 V2EX，App 立即退出到系统桌面；Release 日志为 JS `TypeError: Cannot read property 'length' of undefined`，栈位于 TanStack Infinite Query 的 `hasNextPage/getNextPageParam`；根因：`src/platform/query/serverState.ts` 的 Search Query key 数据形状身份，以及 `src/features/search/useSearchController.ts` 对聚合预览和单站分页的 key 选择。响应形状不同却缺少 lane，违反同一 Query key 只对应一种数据形状的约束。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |


## `REG-ACCOUNT-041` 账号刷新覆盖可信身份、重复 owner 或 unknown 被计为已登录

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-05`、`FEED-01`、`SEARCH-01`、`SEARCH-04`、`TOPIC-01`、`USER-01`、`WRITE-01`、`NOTIFY-01` |
| 历史症状与根因 | 更多页刷新账号时，已确认账号立即变成「待核对」，Feed/Search/通知换 lane；快速点两次又产生重复探测。网络、403、429 或 CF 后旧身份可能被永久降级，账号计数和私有入口闪动；根因：`useAccountStatusController` 没有把核对 activity (`isVerifying`) 与 canonical identity 分开，也没有按来源 single-flight。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-ACCOUNT-042` L 站验证成功后账号状态未自动同步

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`WRITE-01`、`NOTIFY-01` |
| 历史症状与根因 | linux.do Cloudflare 验证通过并点击检查后面板退出，但账号中心与写权限仍显示旧状态；只有再点一次「刷新账号」才同步；根因：稳定 Account key、`AccountSessionSnapshot` 唯一提交 seam、内容 epoch reset 与 `useVerificationController` 的成功/原页面恢复顺序。旧实现实际同时拥有 Query observation、workflow session 与 identity runtime 三份账号事实。 |
| 当前 owner | `src/domain/session/siteSessionState.test.ts` |


## `REG-TOPIC-077` 回复数或稀疏窗口不一致时整窗被丢弃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03`、`WRITE-01`、`WRITE-02`、`NOTIFY-02` |
| 历史症状与根因 | 原站回复数、页宽或返回行稍有不一致时，已经解析出的有效评论整块消失，详情显示空白/窗口错误；刷新又可能恢复。另一种路径把 partial Topic seed 当成 complete，错误开放权威计数、倒序或末尾确认；根因：`ReplyCompleteness`、各来源 reply-window validator、共享 page 投影、Topic target replacement 与写后精确 refresh target 共同定义完整性和身份；exact target/写后实体读取和普通浏览窗口需要不同严格度。 |
| 当前 owner | `src/features/topic/model/replyPagination.test.ts` |


## `REG-TOPIC-078` Topic 媒体首跳忽略页面 Referrer Policy

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`ACCOUNT-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 妖火指定主题的外部图片与视频在原站可用，App 却因额外发送论坛来源而收到 403；V2EX、NodeSeek、linux.do的正文、预览或保存又可能使用与原页面不同的 Referer。随机素材偶尔返回 200 不能证明 Header 契约正确；根因：四站 Topic adapter 产出的 `MediaReferrerContext` → Sanitizer 的元素策略保留 → `imageRequestSource` 的标准 policy resolver → 正文、原图升级、全屏预览、保存、贴纸、卡片和视频消费者；`contentSource` 只保留身份、Cookie 和重定向隔离职责。 |
| 当前 owner | `src/domain/forum/mediaReferrer.test.ts` |


## `REG-TOPIC-079` Expo Video 重建或卸载释放竞态导致原生崩溃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 正文视频请求失败或超时后，App 立即自动创建第二个 Expo player；正在播放时离开 Topic，组件卸载清理又访问已由 Expo 释放的 player。两条路径均可触发 Android Fatal 或进程退出；根因：`TopicBodyMediaCoordinator` 的 per-lease retry policy → `ManagedTopicContentVideo` admission/identity → `ForumContentVideo` runtime lease、初始化与 Expo 独占的 shared-object 释放生命周期。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-080` 原生正文视频忽略固有比例

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 妖火 `bbs-1571173.html?lpage=11` 的原视频为 `576×1024`，原站按竖屏显示，App 却固定放进 `16:9` 横屏框；根因：`ForumContentVideo` 对 Expo player 元数据的订阅与 frame `aspectRatio`；coordinator 只负责 admission/retry，不能决定媒体形状。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-081` Topic 虚拟化 row 泄漏文章边界与妖火原站结构

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 妖火附件帖被拆成多段卡片，每段重复横线和顶部留白；连续 `<br>`、隐藏占位节点变成异常空洞，原站附件 class 直接泄漏到 App 后呈现松散或不可操作；根因：`contentSanitizer` 的隐藏节点删除 → 妖火 Topic adapter 的语义归一化 → `topicContentSplit/topicOpeningPresentation` → `TopicContentList` article continuation → 共享 HTML styles。 |
| 当前 owner | `src/domain/forum/contentSanitizer.test.ts` |


## `REG-TOPIC-082` 原生正文视频丢失封面并在加载期黑屏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03` |
| 历史症状与根因 | 原帖已有真实视频封面，App 在加载和待播放阶段却只显示纯色底或视频首帧；播放按钮笨重，暂停后还可能错误恢复封面；根因：`contentSanitizer` → `topicContentSplit` → `topicOpeningPresentation/TopicContentList` 与 HTML renderer → `ManagedTopicContentVideo` 的独立图片 lease → `ForumContentVideo` 的首次播放状态。 |
| 当前 owner | `src/domain/forum/contentSanitizer.test.ts` |


## `REG-TOPIC-083` V2EX 把 100 条单页误作无游标的评论全集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`TOPIC-04`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | V2EX `t/1233404` 当次声明 147 条，原站第一页为 `#1..#100`、第二页为 `#101..#147`；App 普通打开正文可见但评论永久停在 `#100`，只有手动「刷新评论」后才能看到 `#147`。即使后页存在单条无效评论，也不应把其余成功解析行一并退回 100 条；根因：`src/sources/v2ex/reader.ts` 把页面窗口与整帖全集混成同一结果；`getV2exReplies(start)` 还会遍历所有链接页并合并全集。`src/features/topic/useTopicController.ts` 随后围绕这一错误模型增加 V2EX-only 完整集合判定、刷新和定位分支。正确 seam 是现有通用 Reply window：Topic 提供 page 1 seed，明确 cursor 驱动相邻页，order/target 各自建立窗口。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-TOPIC-084` 固定单元格宽度与虚拟分片破坏逻辑表语义

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-652056-1` 的两张小表没有清晰间距且第二张不能自然铺满正文；V2EX `t/1233470` 的「时间 / 发生的事」长表跨虚拟 row 后列宽、边框和横向位置可能突变，像多张断开的表；根因：`compileForumContent()` 在 budget packing 前建立完整 typed table、列模型与 rowspan 连通区域 → `topicTableRenderers` 的原生列几何、边框、间距和 route-local 横向 offset；父 FlashList 只负责回收 typed row，不能成为表语义 owner。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-085` 图片实体与回收占位几何不一致导致虚拟边界行高振荡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 的长图滚到虚拟窗口边缘后反复闪现；附近文字、空白占位和相邻回复交替出现，即使滚动偏移未变化也无法 settle；根因：`TopicBodyMediaCoordinator` 只拥有未完成加载调度；`previewRenderers` 分开维护 displayed 状态、稳定视觉 identity、网络 attempt、有效自然尺寸与 `imageDisplayDimensions` 512 项缓存；FlashList 只在 cell 真正复用给新媒体 identity 时清旧状态。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-086` 物理 Row 切割丢失嵌套逻辑节点身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 第 9 层原站的一个 52 行 `<pre>` 在 App 内变成两个独立横向滚动框；相同问题可让跨 row 的 table、details、callout 或 list 丢失边框、折叠状态、祖先容器和横向位置；根因：`compileForumContent()` 的顺序必须是 `semantic blocks → budget packing`：table、block pre/code、details/callout、blockquote 与 list 在物理切片前成为 typed payload；每个 row 直接携带 scope-local DOM path 产生的 `semanticId`、segment/part 和完整 `ancestorFrames`。renderer 只消费 typed row，不读取 HTML binding、TNode 或站点/坐标推断。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-087` 虚拟回复把 ReplyTarget 移到正文之后

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2556285` 第 9 层的「回复 @… · #5」在 App 中出现在长代码正文下方，而原站和未切割回复都把回复关系放在正文之前；根因：`ReplyItem` 的统一 Header/ReplyTarget/Body/Tail 组合顺序，以及 `replyListModel` 对 start/body/end 物理 rows 的职责划分；物理 row 不能重新定义回复文档顺序。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-088` 局部连续性测试通过但真实 FlashList 链路仍丢失语义身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | compiler sidecar 与独立 renderer 测试均通过后，真实 APK 中 linux.do `t/topic/2556285` 第 9 层的 52 行代码仍显示成两个完整圆角框；这证明局部补丁没有贯穿 TopicContentList 和 FlashList recycling；根因：唯一允许的链路是 `compileForumContent → topic/reply model → TopicContentList → FlashList → ReplyItem → TopicContentBlock`。完整 `CompiledForumContentRow` 必须逐层传递；key 使用 owner scope、semantic ID 与 segment，view type 包含 payload kind，attempt/viewability 不参与语义身份。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-089` 普通代码块在 semantic compiler 前被降级为 terminal rich text

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | typed compiler、模型和 renderer 测试均通过后，linux.do `t/topic/2556285` 第 9 层在真实 APK 中仍显示为两个独立圆角代码框；根因：sanitizer 与 semantic compiler 的职责边界。普通 block pre/code 必须保持 DOM 语义直到 `compileForumContent()` 分类；只有明确的 ANSI code、NodeSeek magic tabs 与 terminal report 才进入 terminal 专用转换。 |
| 当前 owner | `tests/integration/discourse-content-contracts.test.ts` |


## `REG-TOPIC-090` 超预算 terminal report 被整块删除并丢失 Tab/复制/滚动语义

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 测评详情原有多个 Tab、ANSI 报告、复制按钮、文本选择、横向滚动条和图片内容；引入正文虚拟化后，小样本可能显示为单个 RNRH terminal，但 report 一旦超过 row 预算就整块变成「内容过于复杂」，Tab 与全部正文同时消失。把普通代码统一降级为 terminal 或恢复巨型 `<pre>` 又会破坏既有 table/code/媒体预算优化；根因：`compileForumContent()` 的 terminal 语义分类、`CompiledForumContentRow`/`ancestorFrames`、Topic list 的 route-scoped semantic state，以及共享原生 CodeFrame。report header、tab body 和 code/table/media 等内容必须先成为 typed semantic rows，再应用既有物理 row 预算。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-TOPIC-091` terminal Tab 切回后长图 row 永久停在 idle

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 测评页长图 Tab 首次可以显示；切到 code Tab 再切回后，原位置只剩保持正确长图高度的灰色空白，占位节点为 `topic-image-idle`，等待或再次切换也不发起图片加载。当前最终 APK 的同一真实页面还证明，在已有旧 Tab viewability 的情况下首次切入长图也可能直接 idle；根因：`TopicContentList` 从 FlashList viewability 投影到 `TopicBodyMediaCoordinatorProvider.viewportRowKeys` 的边界只保存 row key，没有保存这个有界窗口在当前 data 中的位置；semantic filtering 改变 data 后无法把同一视口重投影到新 Tab rows。图片 renderer、请求 identity、网络和解码尚未获得 permit，不是根因。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-092` 同一回复关系目标再次点击不再定位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 回复关系第一次点击可以跳到目标楼层；滚走后再次点击同一目标，有时完全不滚动也不重新高亮。切换到另一个目标后再点原目标也可能失效；根因：稳定目标身份与一次性命令身份必须跨真实入口分开：同主题 HTML 楼层链接由 `TopicRoute` 递增 route-local `targetReplyRequestId`，结构化回复关系由 `TopicContentList` 的稳定 ref 生成本地 request command；列表统一消费二者。 |
| 当前 owner | `tests/ui/app/content-source-route-gates.test.tsx` |


## `REG-TOPIC-093` 物理预算从内部切坏不可分割语义 owner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 长代码或连续富文本超过旧 node/字符预算后被拆成多个独立 cell，出现多重代码框、多个复制入口、边框断裂和上下文断开；图片密集正文又确实需要物理分段；根因：`compileForumContent()` 的 semantic owner 分类必须先于 budget packing：预算只能决定可离散内容的调度粒度，不能创造新的代码或连续文本 owner。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-TOPIC-094` 嵌套 code/table 横滑被外层纵向列表抢走

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 代码或表格区域慢速左右拖动几乎不动，必须多次尝试才偶尔识别；若直接让内层 ScrollView 抢手势，纵向阅读又会卡住；根因：code/table 必须复用一个 RNGH Pan 方向仲裁器；被动 `Animated.ScrollView` 只负责裁剪、内容宽度和命令式 offset，不再拥有原生拖动手势。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-097` 代码慢横拖被 Android 原生文本选择抢占

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek terminal Tab 内左右拖动长代码时，慢拖很容易先出现文本放大镜、选择 handles 与 `Copy / Share / Select all / Translate` 菜单；代码没有横向移动，随后 Back 也只关闭选择菜单而不返回页面。快速横拖通常正常；根因：`TopicHorizontalScroll` 必须在 UI thread 内成为 code/table 唯一方向仲裁者；文本选择只能在手势仍未决且近似静止时保持资格，外层 FlashList 只在纵向意图时接管。Tab、Text、ScrollView 与 React state 不得各自建立第二套所有权。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-098` 横滑已接管但 Android selectable Text 未收到取消事件

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | `REG-TOPIC-097` 后在 NodeSeek terminal code 空白处慢横拖，代码已经横向移动，仍会出现放大镜、选择 handles 或 ActionMode；说明 JS Pan 获胜并未终止 Android selectable Text 的原生长按链路；根因：`TopicHorizontalScroll` 必须同时拥有横纵方向仲裁与后代原生触摸取消边界。内容树挂在直接、不可折叠的 `Gesture.Native()` owner 下，横向 Pan 通过 `blocksExternalGesture()` 声明优先关系；Pan 激活取消 Native handler，由 RNGH 2.28 的 `NativeViewGestureHandler` 向 wrapper 子树派发 Android `ACTION_CANCEL`。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-100` 未切割正文仍无法把选择范围拖入表格

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。文档级连续选择、文字高亮与平台手柄跟随已有实现修复；指定帖子完整复制、跨回收窗口、逐帧几何及物理设备触感仍须按本条关闭条件验收，不能由历史标题推断当前仍无法跨表格选择。 |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-877083-1` 长按表格前正文后，「全选」只选中当前段落；选择手柄不能越过「配置」标题继续进入表格和表后文字；根因：compiler 的语义/调度 row 与 Android 原生选择 owner 被错误等同。React Native `selectable` 只作用于各自 `TextView`，table 又是独立 View 树，因此逐块 selectable 不能形成文档级连续选择。后续 `post-652056-1` 又因 route 把回复注册进 coordinator，让无关回复的 span 映射失败阻断主楼。边界收窄后仍把 logical tape 当成 Native tree schema：协调器用 `isTextSelectable`、`isLaidOut`、owner/fingerprint 和全 mounted window 完整匹配决定是否允许选择；RN/Fabric 的 sticky `requestLayout`、回收和 layout commit 瞬态都会因此误取消整个 document。selection 身份的根因 seam 是当前实际显示的 opening row 根 marker 才是唯一身份，manifest 直接来自同一 visible opening collection；`selectionToken` 只保存逻辑 copy tape，`TextView.Layout` 只服务当前端点和可见投影，瞬态映射缺失只跳过当前帧而不取消逻辑选区。回复、评论和已采纳答案保持零 marker，并独立整条长按复制。同一链路还暴露 opening renderer 仍为 selectable 时双击会进入原生局部选区、active selection 没有普通短按取消转移；中间的 row-wide double-tap detector 虽能吞第二次 `DOWN`，也会误吞同 row 链接的正常 tap，因此最终删除 detector 与 `TextView` long-click patch，统一设置 opening renderer `selectable=false`，只由自定义 selector 接管静止长按。活动选区上的普通短按先完成既有点击再取消，越过 touch slop 的滚动保持选区。随后逐帧证据确认 route-surface 中央高亮仍是错误绘制 owner：高亮 Path 被转换为祖先坐标并缓存进 surface RenderNode，而文字可随内部 ScrollView/child RenderNode 独立移动，出现峰值 `156px`、持续约 `590–720ms` 的错位；增加 scroll/pre-draw 刷新只能追赶时序，不能修复 owner。把高亮迁到 `TextView.overlay` 后，真实录屏的 1,294 个实测样本达到 `<=2px`，但尝试用独立 `PopupWindow` 承载手柄又引入第二个 ViewRoot 时钟：完整可见的起点/终点手柄分别出现 `279px`/`278px` 峰值并有可见端点缺手柄，故该路线按 falsifier 删除。当时最终绘制 owner 收敛为每个 mounted `TextView.overlay`：可见 slice 用本地 `Layout.getSelectionPath()`，两个端点各持一个本地 handle drawable；route 只保存逻辑状态、ActionMode 和触摸命中点。旧合同为避免 View bounds 越界，把自绘圆形向 TextView 内侧收回并用 stem 连回未偏移的 caret hotspot；滚动不再重建第二套视觉坐标。第一版本地手柄仍把 viewport 裁剪错误地当成 drawable 生命周期：端点离屏时先移除 overlay，RenderThread 让 child 回流后只能等下一次 UI pre-draw 重绑；`post-832584-1` 的 204 帧严格审计因此在 f49、f159 各捕获一次可见起点整帧缺柄。修复将本地投影与 route 命中可见性解耦：owner 仍 mounted 时保留 drawable 并交给祖先裁剪，只有真实卸载/回收重绑、取消或 revision 失效才移除；instrumentation 先以该行为红灯，再达到 18/18。修复后同帖一次 900 ms 静止长按、大选区和三轮快速往返的 181 帧审计中，三次起点回流首个完整可见帧 f46/f75/f134 均已有 circle、stem 与 hotspot；高亮 1,301、起点 83、终点 98 个可判定样本的最大 `L∞` 均为 `2px`，真实缺失和确认的 `>2px` 均为 0。随后 1.3.130 真实交互暴露该旧圆形合同会在 wrap-content TextView 的零底部余量中折入字形行并遮住端点文字；这是自定义选择 chrome 的根因，不是 logical document、虚拟化或 TextView-local 同帧 owner 失效。现役合同因此保留跨虚拟行语义、高亮与本地 draw owner，但删除自绘圆形，改用平台主题 left/right handle、AOSP `getLineBottom(line, false)` 与 bidi primary/secondary hotspot；手柄主体从行底向下展开。重复选择同时收敛为 no-op，Android 27+ 只在逻辑端点实际变化后请求 `TEXT_HANDLE_MOVE`。 |
| 最终修复边界 | 上行末段记录的是第一版平台手柄阶段，现已被严格遮挡/同帧滚动 falsifier 取代：TextView/marked-row overlay 在 wrap-content 行底和相邻 row 仍会裁掉平台手柄主体，不能通过关闭 `clipChildren/clipToPadding` 绕开。高亮继续只由 `TextView.overlay` 持有；两个端点改为同一 ViewRoot 内列表 viewport overlay（无唯一全尺寸 viewport child 时为 `TopicSelectionSurface.overlay`）上的平台 handle wrapper。wrapper 保存 source `TextView` 与 Layout content hotspot，每次 draw 重新读取 source/host 屏幕位置，加 host scroll、减 source scroll 后绘制，所以 pre-draw 之后的纵滚、横滚、translation 与回流首帧仍跟随 caret；不得缓存最终 screen 坐标，也不得使用 `PopupWindow` 或独立 ViewRoot。平台方向/AOSP hotspot、至少 `48dp` 命中、抓取偏移与真实端点变化才请求 `TEXT_HANDLE_MOVE` 的合同不变。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx`、`tests/ui/topic/topic-components.test.tsx`、`npm run test:native:forum-selection`、独立 AVD 的 `npm run test:instrumented:forum-selection` 与 `docs/operator-runbook.md` 主楼选择 targeted Live |
| 失败 oracle | 自动 owner 必须以普通行为用例证明 visible opening collection 直接生成唯一 manifest 和 row markers、opening renderer 全部 `selectable=false`，主楼 document 跨 rich text/table/code/media 连续复制，回复、评论和已采纳答案零 marker、整条长按复制不退化；Native oracle 必须证明 selection 不依赖 `isTextSelectable`、`isLaidOut` 或全 mounted window 完整匹配，瞬态映射缺失只跳过当前帧并在稳定帧恢复，且不存在 row-wide double-tap detector/long-click patch 吞普通链接 tap。主要绘制时序 proof 必须用生产等价 `ScrollView + absolute cells` 在 pre-draw 后同一次 draw 内正反向改变 offset，以截图像素证明 TextView-local 高亮和同 draw 平台手柄 hotspot 相对当前文字 Path/caret 误差各自 `<=2px`、旧位置残影 `<=2` 个差异像素、取消/回收重绑后旧 drawable 清空且布局几何不变；零底部余量、多行、软换行、LTR/RTL 和内部 scroll 必须固定平台手柄方向、AOSP hotspot、主体不进入端点字形行、至少 `48dp` 命中区及按下细微拖动不跳变。端点 owner 仍 mounted 但离开 viewport 时，本地手柄必须保持绑定、route 命中点必须隐藏，并在无需下一次 pre-draw 的回流首帧随文字出现。JVM 必须证明重复选择为 no-op；Android 27+ 只有逻辑端点实际变化才能请求 `TEXT_HANDLE_MOVE`，重复 motion、自动滚动但端点未变、取消或重绑不得请求。RecyclerView proof 只辅助固定 recycle/rebind 后的逻辑选区、复制顺序与本地投影恢复。新构建还必须按 runbook 完成同页原生标题对照、静止长按唯一入口、双击无选区、活动选区上静止短按取消而滚动保留、`post-832584-1` 大选区三轮快速往返的逐帧高亮/手柄贴合、`post-877083-1` 主楼复制顺序、`post-863650-1` 回收/预算/PSS/`0px` 位移及回复/评论/采纳答案负向 marker 的全部 Live 分支；模拟器事件不能替代物理设备实际触感，缺少物理设备时该分支记 `NOT_VERIFIED`。任一分支未取得 `LIVE_PASS` 时仍保持 `OPEN`；局部 UI/native green 不计 `RESOLVED`。 |
| 菜单边界 | ActionMode 的稳定语义直接从逻辑范围派生：全选后物理移除 Select all 并把 Copy 留在一级菜单，端点缩回后恢复；不依赖系统浮动菜单返回箭头，不建立菜单阶段状态机。平台扩展不固定造「翻译」或第三方分享目标：标准 Share 只走 parcel-safe 的 `ACTION_SEND` + 系统 Sharesheet；API 23+ 从当前合格的 `ACTION_PROCESS_TEXT` Activity 动态生成显式只读动作；API 24–25 无 classifier，API 26–27 TextClassifier 在工作线程只接入一个 legacy label/icon/onClick-or-intent 动作，API 28+ 在工作线程异步接入 enabled `RemoteAction` 列表。selection snapshot/generation/ActionMode 任一失效即清除或丢弃晚到动作，回填与点击前再次核对；API 26+ classifier 在菜单打开后即可能把选区交给系统/OEM 实现，Share、`PROCESS_TEXT` 与 classifier 动作的外部执行只由用户点击触发。任何 query/classifier/Intent/PendingIntent 失败都不得破坏 Copy/Select all；Share launch 失败还必须保留当前选区。对应 Native oracle 必须固定 resolver 权限过滤、API 分层、legacy click、Component/PendingIntent identity 去重但不按标题合并、一级/overflow 排序、stale/cancel 清理、Share chooser/超长 surrogate 边界、当前 canonical 纯文本与无敏感 extras。 |


## `REG-TOPIC-095` 三槽图片预览翻页闪回错误图片且 pinch 误改 index

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 多图预览横滑到下一张时，目标图片已经到达中心却又瞬间闪成后一张或原图，随后再回到正确页；pinch、横向不对称 pinch 或单指拖动途中加入第二指时还可能意外翻页；根因：`src/ui/media/ImagePreviewModal.tsx` 同时拥有可见 slot 身份、分页状态权威、转场结算顺序与 ResumableZoom/分页/下拉关闭的手势所有权；这四者不能再分散到 Native Pager position、React index 和异步 scrollEnabled。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` |


## `REG-TOPIC-096` 千图帖子首次点击预览需等待约三秒

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 已显示正文首图后，首次点击仍需约 3 秒才出现全屏 chrome；关闭后热重开仍约 2 秒。图片 decode 只占约 100–200 ms，页面期间无反馈，千图正文时尤为明显；根因：图片发现只归 `compileForumContent()` 的单次 DOM 遍历；Lightbox/controller 只能消费 Topic presentation 已产出的结构化 descriptors 和 ready catalog。preview 不拥有业务文档、HTML parser、全文标记器或后台预热任务。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts` |


## `REG-ACCOUNT-043` 后台 More 重渲染关闭全局登录或验证面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`SEARCH-04`、`TOPIC-01`、`TOPIC-03`、`USER-01`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | 在 Topic、Feed、Search 或 User 中自然触发 linux.do Cloudflare 验证后，面板刚出现就消失并回落到「账号冻结中」；用户只能去 More 手动打开验证。NodeImage 等其他全局授权面板也可能被同一路径提前关闭；根因：`src/features/more/MoreRoute.tsx` 把「More 当前 inactive」误当成「More 刚从 focused 变为 blurred」，让后台 route 拥有了全局 auth surface 的关闭权。 |
| 当前 owner | `tests/ui/app/content-source-route-gates.test.tsx` |


## `REG-ACCOUNT-044` 账号检测误用首页五秒预算并读取完整妖火活动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`MORE-02`、`SEARCH-04`、`ACCOUNT-04`、`WRITE-01`、`WRITE-03` |
| 历史症状与根因 | 已登录妖火且代理正常时，「检测登录」仍会在约 5 秒提示超时；偶尔成功时延迟和请求数也明显波动。更多页三站刷新、登录页关闭核对、Search 重试、写前核对和 NodeImage 核对共享同一风险；根因：`src/features/account/useAccountStatusController.ts` 把正常 `reconcileAccountStatus` 包进 `readWithinAggregateSourceBudget`；`src/sources/yaohuo/accountStatus.ts` 又把「证明当前身份」和「读取完整用户活动」合成一次操作。Feed 公平预算、账号协议终态和 User 页面数据具有不同所有权。 |
| 当前 owner | `tests/ui/account/account-status-controller.test.tsx` |


## `REG-ACCOUNT-045` 功能 WebView 挂载清空全站登录态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`WRITE-01`、`WRITE-05`、`RELEASE-02` |
| 历史症状与根因 | 进入 linux.do 或 NodeSeek 详情、打开回复器，或覆盖安装/重启后，三个站点会突然全部退出；账号中心仍可能显示持久化的「网站登录 3/3」，但该快照不能证明 WebView Cookie 仍存在；根因：功能私有编辑器获得了修改 App 全局 WebView profile 的能力，资源所有权从 Account Runtime 逃逸；既有规则只约束显式账号清理事务，没有检查第三方 WebView 属性、生产 TypeScript 清理调用和 tracked Android plugin。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` |


## `REG-ACCOUNT-048` L 站并发 Cookie 更新丢弃与频繁登录失效

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已解决。2026-10-04 用户明确确认 L 站掉登录问题已解决；并发 Cookie、响应取消与 WebView 销毁前落盘的既有修复，以及两次自然续签后重启认证证据继续保留。下方 OPEN 与未闭合结论属于此前阶段，本次按用户使用反馈结案；未新增设备或 Live 测试，历史服务端删除凭据的原因不追加归因。 |
| 能力 ID | `ACCOUNT-01`、`ACCOUNT-02`、`ACCOUNT-04`、`NOTIFY-03` |
| 历史症状与根因 | 2026-09-10 用户两次导出显示：刚确认登录后重启，分类响应应用 Cookie，首页响应因 stale 被拒绝，随后通知 JSON 403 login_required；日志未见主动清除事务。已用修复前失败的实际 HTTP 并发测试确认客户端缺陷：任意响应推进共享 revision、整份 Header 基线检查都会误丢同账号在途更新；原生响应也缺少明确 flush。现拆开隔离代次与回写序号，正常更新按平台语义串行应用，并补充回调恢复、落盘与诊断。但旧日志没有被丢弃 Cookie 的类别/设置或删除证据，不能断言该响应一定是登录续签，也不能排除服务端独立失效。当时事故继续开放，等待真实登录自然续签至少两次、重启及协议核对闭环。 |
| 当前 owner | `modules/forum-platform/android/src/test/java/com/wz/reader/network/ManagedCookieResponsesTest.kt`、`modules/forum-platform/android/src/hostTest/java/com/wz/reader/network/ManagedCookieResponsesInstrumentedTest.kt`、`tests/ui/account/account-runtime.test.tsx` |
| 2026-09-10 新包现场 | 主 API 35 AVD 在 16:20:31（北京时间）手动登录后 current-user 核对成功，WebView 交接 flush 成功；16:23:33 再次核对成功。16:27:06 通知请求发送时 hasLoginCookie=true，响应 403/login_required、Set-Cookie 数为 0。16:29:39 账号请求仍带登录 Cookie，响应 404 并明确下发 login/delete/expired；平台接受后 hasLoginCookie=false，flush 成功，账号按 session-404 变为 anonymous。同一进程内，交接后此前原生响应没有 login/set、拒绝续签或写入/落盘失败；未发生显式清除。用户确认未在其他设备退出、结束会话或修改安全设置。该次删除有服务端指令证据，但服务端失效原因、WebView 内部不可见更新及原手机事故仍未归因；两次自然续签后的重启验收未完成，不能关闭事故。 |
| 后续对照与通过范围 | 同日再次手动登录后，网站 WebView 保持约 11 分钟、三次普通刷新仍登录，期间零原生请求/回写；16:44:36 原生账号核对成功。16:54:38、17:04:38 两次通知响应明确下发 login/set/persistent，分别得到平台接受、凭据变化及 flush 成功记录；两次更新后的账号接口均确认已登录。加入首页、图片及主题读取后仍正常，17:05 保留数据冷启动 PID 29412→32037，17:06:08 新进程 current-user 200 并持久化 confirmed。该条续签→落盘→重启认证链为 `LIVE_PASS`；早先 16:29 的失效原因及原手机事故仍未关闭，不把后续一次成功对照当作排除间歇故障。 |
| 2026-09-18 客户端补修 | 修复前真实 HTTP 取消实验中，下次请求仍发送 A 而非续签 B；手动检测测试确认 WebView 交接前已发身份请求。现统一卸载→交接→核对，并接受已收到的同代合格响应，不因消费者取消而丢弃；交接回调或 flush 失败不再放行，账号页刷新可重试且不会永久 busy。隔离 AVD 中，真实安装依赖的 WebView 在收到 Cookie B 后于加载完成前销毁，进程重启仍读到 A；正常完成与异步网络错误路径可持久化。现于既有 RN WebView source patch 的 destroy 入口补平台 flush，覆盖提前取消；该受控缺陷不证明手机事故由隐藏 WebView 引起。9 月 17 日日志两次请求携带登录 Cookie 后收到服务端明确删除，不能用这两处缺陷替代服务端归因；该轮保持 OPEN，原手机自然续签与外部浏览器对照当时仍缺现场证据。 |
| 本轮受控验证 | `ACCOUNT-01/02/04` 与共享 `NOTIFY-03`：相关 JS 单测 157、账号与相邻页面 RNTL 124、原生 JVM 116 项通过；隔离 API 35 / WebView 124 AVD 验证真实 HTTP 更新/删除（含接收后取消）、平台属性与原生续签后进程重启认证。安装依赖的 WebView 完成/错误/取消三路径各经过写入与重启回读，取消路径由红转绿。普通配置开发包覆盖安装后 `APK_SANITY` 通过，首次安装时间与签名不变；真实账号面板检测先卸载 WebView，遇到自然 CF 返回保留说明与重试，刷新重挂载、关闭后恢复可刷新状态。React 消息传输在该原生探针中为替身，不能替代整条 App 登录验收；该受控阶段尚未覆盖原手机两次自然续签、自然浏览器掉线对照、真实 Connect 与后台通知；主模拟器后续 Live 结果见下行。 |
| 2026-09-18 主模拟器复测 | 可见主 API 35 AVD 保留数据覆盖安装同版本修复包，首次安装时间与签名不变。12:23（北京时间）旧会话的 `/site.json` 请求发送唯一且与平台存储一致的 `_t`，HTTP 200 明确下发 login/delete/expired，平台接受并落盘；这仍不能确定后台失效原因。用户完成 App 内验证后，12:32 current-user 确认登录并持久化；本轮未操作外部浏览器。12:37:49.726 手动检测先完成 WebView 交接落盘，12:37:49.753 才发送唯一身份请求，随后 confirmed 并关闭面板。12:41:48 通知响应自然下发 login/set/persistent，平台确认凭据变化、接受并 flush；12:42:03 后续身份请求携带当前唯一凭据并确认登录。12:42 Connect 真实请求 200，等级页显示「官方要求」，没有使用本机估算。12:52:33 第二次通知响应再次自然更新持久型登录 Cookie 并确认凭据变化、平台接受与 flush；12:53:03 身份核对成功。随后保留数据停止并重启 App，PID 3073→5252；12:53:36 新进程发送平台当前唯一凭据，current-user 200、confirmed 并持久化。ACCOUNT-01/02 的 App 登录、手动交接、两次续签及重启认证与 ACCOUNT-04 的真实 Connect 读取为 `LIVE_PASS`；共享 NOTIFY-03 的前台请求 Cookie 接收与持久化链通过，独立系统后台任务投递、原手机及外部浏览器自然掉线对照仍为 `NOT_VERIFIED`。切后台再返回没有丢失会话。该成功样本不解释启动时旧凭据为何被服务端删除，当时事故保持 OPEN。 |

## `REG-FEED-017` 来源重排后旧 Pager 会话卡在 Loading

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`MORE-05` |
| 历史症状与根因 | 在 More 重排来源后返回首页，顶部仍像是原来源，但内容区一直显示「正在读取主题」；再切一次来源才恢复；根因：PagerView 的页面适配是位置语义，而来源顺序是可变的；在同一 Feed 会话内热更新 children 后，旧数字位置不能稳定表示来源身份。inactive scene 又只允许 controller 当前来源渲染真实列表，因此错位物理页会永久显示 Loading。2026-09-06 设备复测进一步发现，新建原生 Pager 的 initialPage 为 0，Compose 却从共享 View.NO_ID 保存槽恢复旧页 1，导致一级蓝标为「全部」而分类、列表属于 linux.do。React 会话重建已存在，重复加 key 无效；现以独立 ComposeView ID 隔离新实例的保存状态，保留上游 settledPage 选择事件，重排后导航与内容统一回到「全部」。 |
| 当前 owner | `tests/ui/app/content-source-navigation.test.tsx`、`tests/live/feed-source-reorder.ad` |
| 2026-10-06 再次复现与修复 | 用户确认重排返回首页应为「全部」，但首次翻页会回到上次选中项。主安装包与全新 API 35 隔离设备均复现；匹配当前源码的定位包记录新 host `initialPage=0`，首次却派发末页 `position=4`。现有 React key 和唯一 ComposeView ID 已在包内，禁用 `rememberPagerState` 的保存恢复仍失败，排除该方向。隐藏首页重建时，原生 host 在有效视口出现前创建 composition；零尺寸首测量将 Pager 推进到末项。修复将首次 ComposeView 创建移到已有测量/布局入口，要求已附着且尺寸为正，保留原保存状态、稳定 Lifecycle 与已有实例。修复前回放在返回「全部」处失败；移除临时日志后的普通入口 Release APK（SHA-256 `ff681b03a636d82e786efc10515a13d05aab190525b67a144574a63664e05675`）在主 API 35 设备通过完整双向重排、首次横滑与阅读筛选/结果归属回放，隔离设备亦通过该链路（关闭来源安全验证后续跑）；相关 UI 54 项、原生 Lifecycle 3 项通过。 |

## `REG-FEED-018` 未登录妖火关闭登录页后无限重开

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02`、`FEED-04`、`SEARCH-02`、`SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 未登录用户在首页选择妖火后会打开登录页；点击「关闭」后同一个登录页立即再次出现，继续关闭仍会无限循环。搜索页的妖火单站搜索存在相同问题；根因：Feed 仅按 `Error` 对象身份、Search 仅按 `RemoteSearchSourceResult` 对象身份消费登录 action；ReadPlan scope 切换和 refetch 会创建新对象，使同一用户意图被误判为新动作。 |
| 当前 owner | `tests/ui/feed/feed-controller-session.test.tsx` |


## `REG-PERF-011` 内容源拖动逐帧跨入 JS 导致不跟手

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 长按来源排序后上下移动明显滞后，快速跨过多行时活动行跟不上手指；根因：`src/features/more/components/ContentSourcesPanel.tsx` 的活动行位移、边界限制和最近槽计算属于 UI-thread 动画，却被放在 JS gesture callback 中。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-PERF-012` 内容源拖动抬手时回弹或闪空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 来源已经拖到目标槽，抬手时却短暂弹回旧槽，出现行重叠、空白或整块闪动；即使缺行消失，相邻两个名字仍会在放下后的连续帧补换一次位置；根因：`Source` 是不会在一次拖动中改变的 native 内容身份，index 只是实测列表中的视觉槽位。host 和内容应归 `Source`，视觉位置由当前/预览顺序映射到槽位；不能让 source host 随数组重排，也不能让 index host 在提交时更换来源内容。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-001` More 展开面板停住后点击无反应

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01`、`MORE-02`、`MORE-03`、`MORE-05`、`DATA-03` |
| 历史症状与根因 | 进入 More，展开账号中心后再点问题诊断、备份/恢复等标题，按钮有时没有反应；页面只在滚动的瞬间能点开，滚动一停又失效。用户没有点击生成、导出或分享动作；根因：`src/features/more/components/ContentSourcesPanel.tsx` 同时拥有内容源排序行的挂载生命周期、稳定 source host 和 Reanimated transform。普通 ExpandablePanel、诊断导出逻辑与备份导出逻辑不是根因。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |
| 历史修复与动画恢复 | 2026-07-11 `f43c35f9` 曾以关闭滚动惯性规避，07-12 `ed5879f7` 撤回该设置并删除面板透明度/位移动画；08-23 `869db6dc` 才修正隐藏排序行生命周期，最终 `7ae5a768` 以 `transform: []` 正确清除位移。2026-09-29 用户确认当前未再遇到故障，要求恢复展开动画；共享面板仅恢复透明度淡入，收起直接归零，不恢复位移或布局动画。`tests/ui/shared/expandable-controls.test.tsx` 补充动画未完成时的收起/重开、草稿保留和子动作接线；mock 不证明 Native hit-test。历史 ADB 坐标注入会掩盖症状，匹配 APK 必须另从 Emulator 窗口鼠标验证停止滚动后点击。 |
| 2026-09-29 验证边界 | `UI_PASS`：相关 29 项通过，新动画 oracle 修前红、修后绿。`DEVICE_REPLAY_PASS`：身份匹配的 `more-readonly.ad` 通过；`LIVE_PASS`：同一 API35 模拟器窗口鼠标验证停滚展开诊断/备份/外观、内容源换位后诊断收起重开，排序最终恢复。原始录屏首次诊断展开的可测文字帧纵向偏移为 0 px，像素对比度逐步达到终态；不声明零掉帧。正常入口 x86_64 Release buildId `be1dbab05ca94ebe8586c40c21ca58aa`，SHA-256 `288e32f549f1572e4a19da6cc4b22ef14bb0c1c92f006006bb06f7792a6b2104`，覆盖安装保持首次安装时间与三站登录状态。证据在 ignored `.codex-tmp/more-expand-20260929/`；实体手机触摸与 TalkBack 仍 `NOT_VERIFIED`。 |
| 2026-10-02 动效完善与验证边界 | 普通展开区域统一为 200 ms 实测高度、透明度和箭头旋转，遵循系统减弱动态效果；收起提交即隐藏触摸与无障碍子树，普通草稿保留，凭据与 NodeImage 临时输入在所属区域隐藏时清空。内容源排序仍只在展开时挂载，未改 source host/transform。`UI_PASS`：共享 owner 验证动画未完成时反向切换、测量高度与子树隐藏，并以动画对象 mock 验证旋转值不能插值成字符串；该 oracle 修前失败、修后通过。整仓 95 个 UI suite、2142 项通过；最后日期格式调整后的 More owner 25 项通过。`APK_SANITY`、`DEVICE_REPLAY_PASS`：最终正常入口开发签名 x86_64 Release 的账号/更多只读回放通过。`LIVE_PASS`：同一 API35 Emulator 窗口鼠标验证停滚后诊断/备份标题、账号连续反向点击、资料/站点设置/NodeImage 嵌套展开与三站切换；录屏确认过渡和终态，无残留空白，不声明零掉帧。APK SHA-256 `2f49b4144017260756e9ad54c04e314fdf73481dc178283e8e9477d6f718147a`，版本 1.3.150/154，首次安装时间 2026-07-26 16:51:37 与三站登录保留。证据在 ignored `.codex-tmp/account-center-20261002-implementation/`；未执行真实签到或授权写入，实体手机触摸与 TalkBack 仍 `NOT_VERIFIED`。 |


## `REG-MORE-002` 内容源连续拖回原位后两行重叠

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 内容源保持展开时先把一项拖到相邻槽，再把同一项拖回原位，两个来源会叠在同一行；界面声明共四项，但只能命中三个独立 row；根因：`src/features/more/components/ContentSourcesPanel.tsx` 的 `SortableRow.useAnimatedStyle` 零位移分支必须负责撤销旧 native transform。空对象没有清除指令；`undefined` 会被当前 React Native Fabric 的 JSI→dynamic 转换跳过；`null` 又违反 Reanimated Android 同步 transform 操作要求的数组契约。空数组既保留明确的 transform 更新，又由 React Native 重置为 identity。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-003` 内容源多次换位后收起 App 闪退

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 内容源连续换位数次后收起面板，整个 App 立即退出到 Launcher；这是修复 `REG-MORE-001/002` 后引入的发布回归；根因：`SortableRow.useAnimatedStyle` 为撤销旧位移返回 `transform: null`；锁文件实际安装的 Reanimated 4.1.7 Android 在 `NativeProxy.performNonLayoutOperations` 刷新或卸载该 host 时把 transform 按数组处理，收到 dynamic `null` 后在主线程抛出类型异常。React Native 接受 null 作为普通 View transform reset，不代表 Reanimated 的同步 transform 命令也接受 null。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-MORE-004` TalkBack 按旧来源顺序遍历已重排内容源

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-05` |
| 历史症状与根因 | 视觉排序已经变为 linux.do、NodeSeek、妖火、V2EX，但 TalkBack 仍先聚焦视觉末尾的 V2EX，再按初始 source host 顺序遍历；手柄同时朗读「第 4 项」，造成遍历顺序与位置语义互相矛盾；根因：`ContentSourcesPanel` 把视觉拖动的稳定 host 策略同时用于 screen-reader 语义顺序。两种模式需要共享 preferences，但不能共享 Native child order。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` |


## `REG-PERF-013` 巨图编译对同一 URL 候选重复分析

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 1000+ 图片正文的网络响应已经返回，详情页仍长时间占满 JS 主线程才出现；普通图片数量越多，等待近似按重复 URL 判断次数放大；根因：`src/domain/forum/forumContentMedia.ts` 在同一次编译内缺少候选级分析所有权，各 helper 从 attributes 重新解释相同字符串。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts` |


## `REG-PERF-014` 普通启动与站内详情重复请求

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NAV-02`、`FEED-01`、`FEED-02`、`TOPIC-01`、`ACCOUNT-01`、`ACCOUNT-02`、`NOTIFY-03` |
| 历史症状与根因 | 普通冷启动时 Feed、Categories、账号、通知和更新并发争抢；账号逐站结算又让聚合请求反复切换。App 已运行后从列表进入 Topic，返回再进入仍可能重复 transport 和正文编译；根因：`useInitialForegroundRuntime`、`useAppRuntime` 与 `useAccountRuntime` 之间缺少「本机事实已恢复」和 first-content 边界；Topic 重入必须服从唯一 `QueryClient`。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-PERF-015` ReaderData 重复建索引且四个 Tab 冷启动全挂载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`FEED-03`、`SEARCH-01`、`SEARCH-02`、`LIBRARY-01`、`LIBRARY-03`、`USER-01`、`USER-02` |
| 历史症状与根因 | 冷启动同时渲染未访问 Tab；同一份收藏、历史和密度数据在 Feed、Search、Library、User 各扫描一次，设置无关变化也重复派生；根因：App composition 未拥有跨 route 的稳定 Reader 列表派生，route 生命周期也绕过 React Navigation 的默认 lazy/freeze 能力。 |
| 当前 owner | `tests/ui/app/app-runtime-startup.test.tsx` |


## `REG-PERF-016` LinuxDo 列表为探测下一条多翻页且分类重复读取

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`SEARCH-01`、`SEARCH-02`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | LinuxDo 首页或搜索首个页面已经足够显示 30 条，App 仍等待下一页；Catalog、Feed、Search 接近同时进入时又各读一次 `/site.json`，让「全部」更晚原子结算；根因：`src/sources/linuxdo/reader.ts` 与 `src/sources/linuxdo/search.ts` 的分页循环拥有重复探测；LinuxDo adapter 没有一个受 `ReadGateway` scope 约束的 `/site.json` RAM owner。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts` |


## `REG-PERF-017` 来源页面和最终正文被重复解释

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`USER-01`、`USER-02`、`NOTIFY-02`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 正常列表、搜索、用户页或通知详情等待本地重复 parse；1000+ 图片详情把同一最终正文反复 sanitize、扫描、序列化和编译，响应完成后仍长时间占用主线程；根因：页面 document/root 和最终 `PreparedForumContent` 没有成为各自阶段的唯一 owner，HTML string 被当作跨层工作接口。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-PERF-018` 稳定 Query 结果和局部图片状态触发全局重复渲染

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-01`、`SEARCH-02`、`TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 已结算的引用和「全部搜索」在父组件无关重渲染时重建 Map、分组与可见列表；任一 inline 图片状态变化让所有回复重新扫描 HTML 和渲染；同一 `srcset` 在目录状态变化时重复解释，NodeSeek reaction 同一 Topic render 计算两次；根因：Query 层没有输出结构稳定的最小投影，正文行失效边界没有落在 compiled row 的 `dynamicImages`，descriptor 解释与会话投影由同一个函数重复拥有。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx` |


## `REG-PERF-019` 首页冷启动丢弃已确认会话并重复请求首页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-01`、`FEED-02`、`FEED-04`、`ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`、`MORE-02`、`WRITE-01`、`WRITE-03`、`NOTIFY-03`、`NAV-01`、`NAV-02` |
| 历史症状与根因 | 冷启动第一瞬间先出现一份来源不明的列表，随后只剩 V2EX，再刷新成正常多来源列表；同一启动快速请求多次，浪费会话信任并增加站点限流风险；根因：账号终态没有独立持久化；Account probe lifecycle、首页请求和 CF/login recovery 被塞进同一分布式状态链。 |
| 当前 owner | `src/platform/storage/accountSessionStore.test.ts` |


## `REG-PERF-020` 正文原图重复解码适屏图并扩大重图工作集

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 滚动到重图片区域时 PSS 峰值比详情前增加约 `184MB`，超过 `REG-PERF-010` 的 `+150MB` 门槛；返回后约 `+48MB`，说明不是持续泄漏而是离屏图片 cell 与重复解码共同扩大峰值工作集；根因：`src/features/topic/rendering/previewRenderers.tsx` 的适屏底图/原图双层生命周期，以及 `src/features/topic/components/TopicContentList.tsx` 的详情 FlashList 回收池上限。请求并发由既有 coordinator 管理，不等于 decoded Bitmap 驻留预算。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-PERF-021` Library 动态筛选通过批量 Native 节点重建结算

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`NAV-01` |
| 历史症状与根因 | 关注用户切回收藏的隔离样本 `20/20` 帧都 miss，p95 约 `48ms`；收藏与历史切换掉帧约 `43.6%`、p95 `32ms`。相同数量筛选项切换接近一帧，说明数据筛选本身不是主因；根因：`src/ui/controls/SelectionControls.tsx` 的 Pill 位置身份，以及 `src/features/library/LibraryScreen.tsx` 在普通来源切换中是否拥有动态分类 Native children。所有筛选语义状态由外部值驱动，节点自身无业务状态。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-022` Library 空收藏假绿与富内容 tab 复用所有权错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`NAV-01` |
| 历史症状与根因 | 空收藏返回 p95 `21.56ms`，看似达标；同设备进入 238 条 History 为 p95 `40.45ms`，旧实现三组真实收藏↔历史为 p95 `42.81–55.00ms`。空数组会清掉越界回收节点，下一次进入富内容数据集必须重建首屏 TopicCard，因此空收藏不是有效性能 oracle；根因：`LibraryRoute` 对收藏/历史数据的派生所有权，以及 `LibraryScreen` 的 tab viewport、FlashList props identity、分阶段挂载和失焦释放。每个数据集只允许在自身输入变化时派生一次；普通 tab 切换不得重算或重渲染已挂载列表。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` |


## `REG-PERF-023` 等价运行时投影重复提交新引用

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`SEARCH-01`、`NOTIFY-03` |
| 历史症状与根因 | 通知刷新结果未变仍提交新的 errors state，App 无关重渲染仍重建 Navigator `onReady`，单来源搜索结算后无关重渲染仍重建列表 data；下游 memo 因引用变化失效；根因：等价通知错误、导航 ready 回调和单来源 Search groups 没有在各自现有 owner 内保持引用稳定。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-058` 新增通知来源重读稳定 sibling snapshot

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03`、`ACCOUNT-01`、`ACCOUNT-02` |
| 历史症状与根因 | 活跃通知来源从 A 扩到 A+B 或单站换号时，A 已成功的未读 snapshot 被再次读取、持久化和投递扫描；根因：`useNotificationsRuntime` 把 `source + identity` 独立生命周期聚合成一个 Query，并以 aggregate result 驱动副作用。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx` |


## `REG-NOTIFY-059` 通知详情外链打开失败没有任何反馈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02` |
| 历史症状与根因 | 用户点击通知详情中的普通外链时，Android 没有可用处理器或打开失败会毫无反馈；`mailto:` 等非 HTTP(S) scheme 也被直接交给平台，没有明确支持边界；根因：`DetailHtml` 直接执行裸 `void Linking.openURL(href)`，没有观察 rejection，也没有由 Route 持有协议校验和错误反馈 callback。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` |


## `REG-NAV-001` 底部导航只在图文附近响应点击

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-01`、`NOTIFY-03` |
| 历史症状与根因 | 首页、搜索、收藏、更多必须点得非常准；图标左右虽仍属于对应 tab 的视觉槽位，点击却没有跳转；根因：`src/app/styles.ts` 把 App 级 `tabBarItemStyle.navItem.alignItems` 设为 `center`。React Navigation 的外层 item 虽然 `flex: 1`，其直接子 `PlatformPressable` 却在横向交叉轴收缩到图文固有宽度；`src/ui/navigation/NavBar.tsx` 的内部居中视觉样式不是根因。 |
| 当前 owner | `tests/integration/style-ownership.test.ts` |


## `REG-TOPIC-099` 展开主楼引用被显示成上下两张卡片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do 主题正文中的引用展开后，引用摘要和完整正文被父 FlashList 显示成上下两个隔离卡片；正文包含多个物理 row 时还会重复外框、圆角或间距；根因：`TopicContentList` 的逻辑内容 scope 与 quote frame 样式必须共同使用引用 `instanceKey`；语义身份不能只存在于 compiler row，而在父 FlashList presentation 层丢失。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` |


## `REG-TOPIC-108` 新进入屏幕的图片被旧 row 请求占满 permit

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 千图正文继续滚动时，当前已经进入屏幕的图片保持等待；上一屏或预取 row 的图片仍占用全部四个请求位置，必须等旧请求完成或超时后当前图片才开始；根因：Coordinator 用 warm capacity 决定是否取消旧请求，却用当前 running 数决定是否启动新请求；warm 上限大于并发 permit 上限，因此合法保温的旧请求可以永久占满全部 permit。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-109` 展开同主题主楼引用导致 App 闪退

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`TOPIC-01`、`TOPIC-02`、`NAV-03` |
| 历史症状与根因 | App 只读打开 linux.do `t/2768624` 后，点击评论中引用主楼的「展开」必定退出到系统桌面；Release 日志为 `FATAL EXCEPTION: mqt_v_native`，JS 异常是「论坛内容缺少匹配的预编译计划」；根因：`replyForQuotedPost` 用 `local || cached` 同时表达「当前数据优先」和「可渲染对象优先」，因此无计划的本地主楼投影覆盖了有计划的缓存对象；严格 renderer 随后按既定 fail-fast 契约抛错。 |
| 当前 owner | `src/features/topic/model/replyListModel.test.ts` |


## `REG-TOPIC-110` 普通代码块显示并复制字面 code 标签

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | App 只读打开 NodeSeek `post-879597-1` 时，一个普通五行代码块在同一代码框中额外显示 `<code>` 与 `</code>`；复制结果也包含这两个标签；根因：通用整页 parser 的 raw-pre 性能策略泄漏进论坛正文 Module；direct compiler 另行打开 `parsePreContent`，导致同一正文存在两套 AST。重新编译序列化 HTML 的测试使用了正确 AST，因而掩盖 production prepared plan。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-TOPIC-111` 收起结构化正文后标题停止绘制

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | App 只读打开 linux.do `t/topic/2769371` 的「注册地址」details 或 `t/topic/2769388` 的「Quote」Callout，展开后再收起会留下圆角背景框，但标题、图标和箭头像素全部消失；accessibility tree 中对应标题仍存在；根因：`src/features/topic/components/TopicContentBlock.tsx` 的 `continuationFrameStyle`。`only` 状态没有输出完整边框几何，React Native Android 将被移除的 per-edge width 解析进 rounded clip path 后裁掉全部子节点。 |
| 当前 owner | `tests/ui/topic/topic-split-disclosure.test.tsx` |


## `REG-TOPIC-113` linux.do 可读详情被分类策略替换成权限页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01` |
| 历史症状与根因 | App 原生详情打开 linux.do `t/topic/2777081` 时，标题、作者和回复数已经加载，却把真实正文替换成「需权限 / 暂无权限」；同一 App 内原站、同一账号和同一 URL 实际可读；根因：`src/sources/linuxdo/reader.ts` 的 `getLinuxDoTopic` 成功详情边界。分类策略描述对象访问规则，真实拒绝只由请求错误分支表达；两者不能在已成功解析正文的 `TopicDetail` 中同时成立。 |
| 当前 owner | `tests/integration/source-access-requirements.test.ts` |


## `REG-TOPIC-114` Android 正文图片首载使用下采样尺寸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | process-cold 打开含长图的主题时，图片先显示 `4:3` 占位，加载完成后错误缩到约 `342px` 高；退出再进入才按约 `898px` 的真实比例显示。多图片正文中的每张冷图都可能独立命中；根因：`expo-image` `GlideRequestListener` 把下采样 Drawable 的 `intrinsicWidth/intrinsicHeight` 作为事件尺寸，忽略 `ImageViewWrapperTarget` 在同一次 Glide downsample 已记录的 EXIF-upright source width/height。自然尺寸的 owner 应是 Native 解码边界，不是 JS renderer 的比例猜测。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-115` linux.do 已删除主楼被误判为解析失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01` |
| 历史症状与根因 | App 原生详情打开 linux.do `t/topic/2780439` 时显示「主题正文解析失败」，而 App 内原站同一 URL 已返回并展示「（话题已被作者删除）」；根因：`src/sources/discourse/model.ts` 的共享 `discoursePostFields` 把删除回复的可见性规则同时当作主楼字段解析有效性；放行后又用 `hasRenderableHtmlContent` 预检媒体-only `cooked`，使 linux.do reader 在正式 compiler 前多做一次 DOM parse。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts` |


## `REG-TOPIC-116` linux.do emoji 枚举被回收后重进先显示英文 ID

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-03`、`NOTIFY-02`、`WRITE-01` |
| 历史症状与根因 | linux.do 详情已显示贴图反应后，离开一段时间再进入会先显示 `heart 1` 等英文 ID，随后才替换成贴图，看起来像每次都重新请求；根因：Query 只有 `staleTime=Infinity`，但 inactive data 仍会被 GC；来源 adapter 的 module cache 虽能挡住第二次 HTTP，却仍通过异步 loader 返回，使 React 先消费空 map、再提交真实 map。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-117` 密集 inline Expo Image 子树造成停手补帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/342888` 的大量 emoji 与文本混排区域在每次短滑停止后仍会细微补走最后一段，看起来像图片销毁后修正了列表位置；同页展开引用时还容易把既有两阶段完整挂载误判成同一问题；根因：`ManagedInlineForumImage` 是四站正文 inline 图片的唯一共享显示边界。当前 App 开启 New Architecture，`RCTTextInlineImage` 在 Fabric 映射到标准 `Image` attachment；旧 Fresco text span 不是运行时 seam。RN `0.81.5` 的 `node_modules/react-native/Libraries/Image/Image.android.js` Text 分支漏掉标准图片事件；此外 Fabric direct event 最终从 attachment 的 current props 取 listener，旧 controller 已排队的事件可能因此调用新 attempt handler。修复后 App 仍只声明一个 Fabric attachment；锁定 patch 转发 `loadStart/progress/load/error/loadEnd`，并让标准 `ReactImageView` 在每次 controller build 捕获当次 request generation、随事件回传。请求、解码、GIF 与卸载取消继续由标准 Native Image owner 负责。Fresco cache key 不包含 headers，故显示 URI 仍以 opaque request identity 的稳定 hash fragment 分区；fragment 不进入 HTTP 请求，真实 URL 与凭据保持原协议。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-118` 独占一段的用户 mention 背景和边框被拉伸成整行

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 正文中独占一段的 `@用户名` 显示为从正文左侧延伸到右侧的浅色圆角框；同屏 mention 后仍有正文时，框只包住文字；根因：Android/Yoga 默认会拉伸 block 容器中的直接子节点；mention 自带背景、边框和内边距，因此拉伸宽度被完整绘制。混排时 mention 嵌套在外层 `Text` 中，不进入该布局路径。共享 `forum-user-mention` 样式是全部正文入口的最小根因 seam。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-119` Fabric inline emoji 明显高于同一行文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | inline emoji 已加载且尺寸正确，但在同一行中明显偏上；linux.do `t/topic/342888` 的 `#110` 中，同一 mask 下表情彩色内容中心比「是这样嘛」文字中心高 `11.5px`，底边低差也不自然；根因：四站正文都由 `inlineForumImageAlignmentStyle` 得到同一正文 `lineHeight` 与图片显示高度，返回值直接进入 Fabric attachment style。恢复既有 `translateY=max(0, (lineHeight-imageHeight)/2)` 就能由真实运行时消费；大于行高的 sticker 返回零位移，避免裁切。不增加 Native patch，也不按素材、帖子或站点维护偏移常量。 |
| 当前 owner | `src/platform/media/inlineMedia.test.ts` |


## `REG-TOPIC-120` NodeSeek 折叠正文首次展开时图片不加载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-889473-1` 第 12 楼的「哼」处于折叠态时，第一次展开正文图片没有加载；需要后续 viewability 变化才可能恢复；根因：`TopicContentList` 的旧 viewport 状态只保存 key/index，并用 presentation continuity 猜测动态内容归属；它既漏掉 opening/reply quote、accepted answer 等替换，也可能让普通 insert/reorder 因共享 ancestor 冒领 permit。根因位于 FlashList observation 到 Coordinator 的 semantic projection，不在 renderer、URL、网络、缓存或解码。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-121` Fabric attachment 被 permit wave 反复 remount

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | inline 图片首次取得 permit，或普通滚离后恢复 permit 时，虽然还是同一图片与 Native owner，却因 React key 改变被 remount；这会丢失已有 attachment 状态并扩大闪烁、重复解码与迟到事件竞态；根因：`TopicBodyMediaLease` 只暴露一个 identity，同时承担 attempt 结算与 attachment 物理生命周期；拆分后若只保存旧 JS handler，仍漏掉 Fabric direct event 经 current props 分发的 Native queue 竞态。修复须同时分离 `attemptId` 与 `attachmentKey`，让 Native controller/request 捕获可回传的 generation，并禁止不同 generation 进入同一 coalescing bucket；`onDraw` error 也必须从 request-bound listener 取 generation，再由当前 handler fail closed 比对。不改变公共媒体 identity 或其他 renderer。 |
| 当前 owner | `tests/ui/topic/topic-media-coordinator.test.tsx` |


## `REG-TOPIC-122` 块级图片上下间距被排版改动放大

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 普通块级正文图片与上下文字的留白由既有 `6/8` 变为 `8/12`，正文节奏明显变松；同批次其他 paragraph、heading、blockquote、table 与 mention 排版并不要求回退；根因：四站主楼、回复和展开引用共用 `forumTagStyles.img`；只需恢复该共享样式的两个数值，不应回滚同提交其他排版。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-123` 物理语义 row 泄漏文章边界且共享正文尺度粗糙

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`MORE-03` |
| 历史症状与根因 | NodeSeek 等包含 blockquote、重复 `hr`、标题和代码块的详情页出现重复文章顶部 hairline、`16dp` 内边距与 row 间 `10dp` 空带；App-owned 行高、分隔线和块级节奏叠加后显得松散、粗糙；根因：`TopicContentList` 把每个物理 opening row 都当作视觉文章起点并重复应用 `articleBody`，同时为相邻普通语义 row 插入通用 separator；共享 `forumTagStyles` 与 typed block 样式仍使用旧的宽松尺度。来源 CSS 本就不会进入 App。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-124` Topic Header 与首个正文 row 零间距

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2801664` 中标题区末尾标签与紧随其后的「展开」/引用正文直接相接，没有纵向留白；同类普通首段也可能贴住 Header；根因：Header 与正文的边界归 `ListHeaderComponent` 自身所有；把既有 `20dp` 从无效 `gap` 改为 Header 容器 `paddingBottom`，由所有 Topic 共用一次。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` |


## `REG-TOPIC-125` Fabric inline 表情右侧贴住文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2803759` 的哭脸表情与紧随其后的 `OpenCode` 文案在右侧相碰；表情向下靠的基线本身正确；根因：Fabric attachment 必须真实拥有绘制占位：可见 `w × h` 图片使用 `(w + 4) × h` attachment，Native Image 继续 `contain`，从而在两侧各留 `2dp`；inline renderer 不再套用含外部 margin 的共享块样式。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-126` 原图 display revision 改变视觉 recycling identity

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`NAV-03` |
| 历史症状与根因 | 进入图片预览后返回正文会闪一次，适屏图升级到清晰原图时还可能再闪；逐帧可见原图层被短暂清空；根因：Native 视觉 owner identity 只由当前原图或兼容 poster 的 `compatibleImageRequestIdentity(source)` 定义；revision 继续驱动失败恢复、跨预览通知、lease 和迟到事件保护，但不再参与 `recyclingKey`。适屏底图由正文图片 frame 持续持有，原图只负责覆盖。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-127` 表格内线重叠且周界过薄

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | NodeSeek 回复中的 GFM 表格内部分隔线显得重叠、抢眼，四周轮廓却只有一层很薄的 hairline；底边还会因末行和外框同时绘制而比顶边更重；根因：共享 HTML 表格的描边权分散在 `htmlTagsStyles.th/td`、`htmlTableFrame` 与 Cell renderer。正确模型是 Frame 独占周界、Cell 独占内部右/下分隔，每条物理边只有一个 owner。 |
| 当前 owner | `src/features/topic/styles.test.ts` |


## `REG-TOPIC-128` NodeSeek 评论未识别投票与 Stardust，投票归属串入主楼

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`WRITE-03`、`WRITE-05`、`WRITE-06`、`NOTIFY-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek 评论中的 `nsapp://vote` 与 `nsapp://stardust-receive` 直接显示原文；测试帖 #10 明明存在收款链接，App 却不生成卡片；主楼能显示投票时，评论投票仍可能缺失或串到主楼；同一回复同时包含独立 Stardust 段和投票时，收款卡片还会被整段删除；根因：NodeSeek marker 归一、投票读取归属和正文编排各有重复 owner。当前模型固定为：`prepareNodeSeekForumContent` 独占 marker 安全归一及 typed placeholder 保留，NodeSeek reader 按每段正文 ID 集合临时绑定远端 poll，`compileForumContent` 独占原位置 row 编排。 |
| 当前 owner | `src/sources/nodeseek/reader.test.ts` |


## `REG-TOPIC-129` 表格媒体使用整页宽度且 cooked 语义样式缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do `t/topic/2817831` 的两列表格中，右列大图按整页正文宽度绘制并越过单元格分隔线；`bbcode-b/i/u/s`、键帽、增删高亮、固定大小文字和群组 mention 等 cooked 语义在 App 中还会退化成普通文字或弱化样式；根因：`td/th` 是单元格实际内容宽度的唯一 owner，应把扣除自身 padding 与 border 后的数值向后代 renderer 传递；表外继续回退到 RNRH 正文宽度。静态 cooked 语义只由现有 HTML style builder 统一映射，不复制来源 CSS。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx` |


## `REG-TOPIC-130` NodeSeek 原生删除线在 App 中退化为普通文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | NodeSeek 沙盒主题 `post-856117` 第 18 楼在原站显示删除线，App 同一楼层却显示为普通文字；NodeSeek Composer 也缺少原站已有的删除线入口；根因：阅读端缺失的是现有 `tagsStyles` 中的 `<s>` 语义；编辑端缺失的是共享 Runtime 的站点能力投影。Markdown codec 已原生支持 `~~...~~ → <s>`，不需要新增转换、配置或状态。 |
| 当前 owner | `src/features/topic/rendering/htmlStyles.test.ts` |


## `REG-TOPIC-131` linux.do MP3 在原生详情中被当作空正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | linux.do `t/topic/2825663` 的有效 `<audio><source src="…mp3">` 在原站可播放约 4:18，但 App 原生 Topic 详情没有播放器；同帖空 `source` 又不能据 fallback 文字猜造媒体地址。根因：共享 sanitizer、内容 compiler 与 Topic 原生媒体 renderer 只把图片和视频视为离散媒体。修复后安全 HTTP(S) 音频归一为原子 `forum-audio`，主楼、回复、完整引用和采纳答案复用 Topic 级唯一 Expo Video runtime；空源保留 fallback，通知只保留 fallback。 |
| 当前 owner | `tests/integration/html-sanitization-contracts.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-132` 音频随虚拟列表行回收而中断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | Topic 音频开始播放后向下滚动，只要对应 FlashList 行被回收，Expo player 与 Native generation lease 就随行卸载，声音中断；重新滚回还会重新建 player 和请求。根因：播放器真相错误地放在 `ForumContentAudio` 行组件，`TopicBodyMediaCoordinator` 又把离开可见区的 settled audio 降回 waiting。修复后 `TopicAudioSession` 在 Topic provider 内唯一持有 player、lease、活动音频和各段位置；虚拟行只订阅自身快照，行回收不再改变播放生命周期，离开 Topic 才释放一次。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-133` 妖火内联视频无法连续拖动进度

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 妖火正文视频在非全屏状态只有整面点击播放和独立全屏按钮，没有可连续拖动的进度控件；整面 Pressable 还覆盖了播放器手势区域。根因：`ForumContentVideo` 关闭 `VideoView.nativeControls` 后自行维护播放、覆盖层和全屏状态，却没有实现成熟播放器已有的进度、手势和无障碍能力。修复后继续使用既有 Expo Video/Media3 内核，但直接启用平台 native controls，poster 只覆盖 loading 阶段。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-134` 代码横拖误触发主楼连续选择

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-899272-1` 的代码区无需长按，只要直接向左拖动就可能建立主楼连续选区，出现手柄、ActionMode、长按触感和无用途的放大镜。受控的 `120ms` 左滑证明父级 `ForumContentSelectionView` 只收到 `ACTION_DOWN`，子级 Pan 已开始横移，但约 `407ms` 后父级待决长按仍被提交；因此 `4dp` 等值边界、动态 `scaledTouchSlop` 和「任一 MOVE 取消」都不是根因，相关试改全部撤回。真正缺口是 `REG-TOPIC-098` 只取消后代内容 Native owner，没有在横向 Pan 确认接管时取消后来新增的 route 级正文选择 owner。曾尝试给整页再挂一个 `Gesture.Native()`，真实设备上会让 FlashList 收不到纵向 MOVE、页面完全无法上下滚动，因此撤回该 owner。最终由现有 `TopicHorizontalScroll` 继续阻塞后代内容 Native gesture，并仅在横向接管分支调用 `TopicSelectionSurface` 已有的原生 `cancelSelection` 命令；纵向让行不调用取消。既有 JS `4dp` 产品锁与 Native `min(scaledTouchSlop, 4dp)` 容差保持不变；选择手柄保留，但 `Magnifier` owner 完全删除。未新增状态机、Native wrapper、站点特判或公开产品状态。 |
| 当前 owner | `tests/ui/topic/topic-table-rendering.test.tsx`、`npm run test:native:forum-selection`、独立 AVD 的 `npm run test:instrumented:forum-selection` 与 `tests/live/agent-live.md` 的 `post-899272-1` 直达 App 验收 |


## `REG-TOPIC-135` 作者删除的首条回复被过滤并破坏窗口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2835903` 的第一条回复已被作者删除，原站仍提供「帖子已被作者删除」的可渲染占位；App 却在窗口候选阶段把所有 `user_deleted` 提前剔除，使首屏顺序、目标窗口和 `/2` 直达失去同一实体。根因不是 `post_stream` 的游标数学，而是 `discourseVisiblePostIds` 与回复归一化之间重复决定可见性。最终把 raw fetched-window 的身份/重复/完整性验证与归一化后展示子集排序拆开：窗口层只剔除真实 `deleted_at`，共享 linux.do 回复归一化只放行内容可渲染的作者删除占位，全空子集返回 empty partial，混合子集保持原 `post_stream` 顺序/newest 反转；不增加 `allowEmpty`、补抓、重试或状态机。 |
| 当前 owner | `src/sources/discourse/model.test.ts`、`src/sources/linuxdo/reader.test.ts` 与 `tests/live/agent-live.md` 的 `t/topic/2835903`、`/2` 直达 App 验收 |


## `REG-TOPIC-136` LinuxDo 明确公式退化为原始 TeX

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | linux.do `t/topic/2833212/4` 的 `div.math` 与 `span.math` 已明确携带公式语义，App 仍把它们当普通 HTML 文字，两个算式显示为原始 TeX。修复在来源归一化层建立 block/inline canonical 节点，并由所有 Topic 内容入口共享的 renderer 使用固定 MathJax 4.1.3、NewCM 4.1.3、全部 40 个静态 SVG dynamic ranges 与 `viewBox`/`data-mjx-viewBox` 几何生成独立 SVG；普通 `$...$` 不推断，原始 TeX 进入既有 version 1 media tape，inline 对应 `ReplacementSpan` 插入点、block 保留 boundary，失败 fallback 固定 `selectable=false`。不引入 WebView、远程服务、重试、第二个选择 owner 或第二套内容 AST。 |
| 当前 owner | `tests/integration/html-sanitization-contracts.test.ts`、`tests/integration/topic-content-rendering-contracts.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`src/features/topic/rendering/mathJaxSvg.test.ts`、`tests/ui/topic/topic-math-rendering.test.tsx`、`npm run test:native:forum-selection` 与 `tests/live/agent-live.md` 的 `t/topic/2833212/4` 直达 App 验收 |


## `REG-TOPIC-137` 回复中的未知图片被 App 擅自居中

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 幺火 `bbs-1577052.html` 第 2 页 13 楼把一个未标记 GIF 放在句尾，原站按文字流显示；App 因无法把它识别成 Emoji，保留为 RNRH block `img`，随后共享块图 wrapper 又无条件居中，最终制造了作者 HTML 中不存在的换行和居中。根因是「图片类型决定位置」的错误耦合。修复删除自然尺寸、URL 和站点分类器，改由作者行决定 projection：mixed 普通图仍在原 DOM 锚点走 textual owner；`REG-TOPIC-142` 收口后，作者独立行的 standalone 普通图在同一锚点复用完整 block image owner，figure/lightbox 继续保持显式 block。选择 tape 与预览目录仍使用原 DOM 顺序，加载后的尺寸只调整 frame，不重新分类位置；块图无对齐信号时靠起始边，显式 center/right 仍保留。位置判定不增加幺火、`.ubbimg`、GIF、域名或尺寸特判。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`src/sources/yaohuo/reader.test.ts`、`src/platform/media/inlineMedia.test.ts` 与 `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-138` 自然行改写把安全图片变成空节点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | `REG-TOPIC-137` 首轮实现把未识别图片改写成内容为空的 `forum-inline-image`；浅层 TTree 仍能看到标签，但 Android 不物化图片 owner，真实外链 GIF 因而完全消失。补上内容后，直接 Text 图片 attachment 又把约 `104×100` 的图片画得过小；改成可测量 inline View 后，React Native 的固定 `lineHeight` 仍会把已由该 View 撑高的行盒压回文字高度，使 3249/3247 的后续按钮和分隔线穿过图片。最终修复让 mixed 图片始终保留完全转义的非空降级内容，textual renderer 在原 DOM 锚点挂一个可测量 inline View，并由其中的标准 Native Image 继续复用 Referrer、媒体 lease、generation、缓存与预览 owner；standalone 图片由 `REG-TOPIC-142` 的 block owner 收口。锁定的 Android `CustomLineHeightSpan` 只扩展较矮行，不压缩含 inline View 的较高行。加载后的自然尺寸只更新宽高，不重新分类位置；全局缓存只保存事实，同 URL 的每个排队实例仍无条件提交本地尺寸。幺火 adapter 只在 sanitizer 清除伪造标记后，把同源 `/face/` 或 `/bbs/face/` 写成可信「有界自然尺寸」marker；共享层删除 URL fallback，外部 `/face/` 仍为普通预览。HTML、selection tape 与 preview catalog 由 compiler 一次产出并保持不可变，旧动态 descriptor/materialization 管道完整删除，未新增页面状态机。无法选源或最终加载失败时仍显示可重试文字，不得空白消失或重新注入节点。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`tests/integration/topic-content-rendering-contracts.test.ts`、`src/sources/yaohuo/reader.test.ts`、`src/platform/media/inlineMedia.test.ts` 与 `tests/ui/topic/topic-image-loading.test.tsx` |


## `REG-TOPIC-139` 妖火旧式字体标签正文被渲染器丢弃

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 妖火 `bbs-5248.html` 的「前言」「将严格控制灌水！」和各节规则标题在来源 HTML、清洗与内容规划中均完整，App 正文却直接跳过；根因是共享 RNRH 元素模型没有注册原站使用的旧式 `<font>`，引擎将未知标签编译为空节点并连同安全子文本一起丢弃。首轮修复只恢复 textual 内容，导致原站显式 `size`、`color` 仍退化成普通主题正文；补齐模型样式后，真实详情仍因共享 Provider 未显式启用 UA 样式而忽略模型样式；启用后 `size=5/6` 虽放大，却仍继承正文固定行高，Android 字形上下边界被裁切。最终共享入口启用该既有语义，并由按阅读行距生成的模型把合法 `size="1"` 至 `size="7"` 同步映射为相对 `fontSize/lineHeight`，Provider 的 `emSize` 跟随 App 正文基准，非空 `color` 仍交给既有 CSS 颜色校验；来源 `line-height` 和背景样式不开放，不增加妖火、帖子或文本特判。 |
| 当前 owner | `src/features/topic/rendering/htmlElementModels.test.ts`、`tests/ui/topic/topic-rich-text-selection.test.tsx` 与 `tests/live/agent-live.md` 的 `bbs-5248.html` 原站登录态对照及 App deep link 直达验收 |


## `REG-TOPIC-140` 尾随 BR 重复折叠使主楼长按无响应

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 妖火 `bbs-5248.html` 的旧式标题后带三个尾随 `<br>`；RNRH 在当前元素上下文折叠最后一个后实际 `TextView` 保留两个换行，共享 selection compiler 却在元素分析和最终 row owner 各折叠一次，使逻辑 owner 比真实文字少一个换行。Native 严格对齐因此保持 `Deferred`，静止长按无法建立选区。最终修复为内部 `break` atom 增加仅编译期的 `collapsed` 事实：元素上下文已折叠的末尾 BR 不再输出字符但保留状态，最终 owner 只折叠因物理 row 边界新成为末尾且尚未折叠的 BR；marker 在公开 version 1 token 序列化前消费，嵌套 `span/font`、根节点连续 BR 和物理分段继续共享同一规则。未放宽 Native fail-closed 对齐，未改手势、公开 token schema 或按站分支。 |
| 当前 owner | `src/domain/forum/topicContentSplit.test.ts`、`tests/ui/topic/topic-rich-text-selection.test.tsx`、`npm run test:native:forum-selection`、独立 AVD 的 `npm run test:instrumented:forum-selection` 与 `tests/live/agent-live.md` 的 `bbs-5248.html` 只读长按复制验收 |


## `REG-TOPIC-141` Android 小字体缩放使行内图片覆盖相邻文字

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 真机系统 `font_scale=0.9` 时，妖火 `bbs-1577052.html` 的可测量行内 GIF 保持原 DIP 尺寸，文字布局为它保留的宽度却缩小，导致 #3249 的「你也一天一帖吗」和 #3247 的「我不服……」被图片覆盖；恢复默认字体或其他默认字体设备正常。根因是 React Native 0.81.5 Fabric 的两条 Spannable 构造路径把 inline View 的 DIP 宽高经 `PixelUtil.toPixelFromSP` 转换，系统小字体只缩小占位而不缩小真实子 View。当前 patch 精确回移 React Native `551d12a`：两条路径统一使用 DIP 转换并向上取整；既有 `CustomLineHeightSpan` 修复继续独立负责固定行高不得压缩含 inline View 的高行。未增加妖火、GIF、设备、楼层或字体禁用特判。 |
| 当前 owner | `patches/react-native+0.86.3.patch` 内的 `TextLayoutManagerInlineViewSizeTest`、`patches/react-native+0.86.3.patch` 中的 `ReactImageViewEventTest`、`tests/ui/topic/topic-image-loading.test.tsx` 与 `tests/live/agent-live.md` 的 `bbs-1577052.html` 小字体/默认字体真机验收 |


## `REG-TOPIC-142` textual 普通图片迁移丢失块图能力与稳定几何

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03`、`ACCOUNT-01`；身份 seam 展开 `USER-01`、`ACCOUNT-02`、`MORE-02` |
| 历史症状与根因 | 1.3.132 将普通图片迁到 authored-flow textual renderer 后，作者位置虽正确，却绕过块图既有的动态 SVG poster、原图渐进、稳定 `4:3` 占位、`6dp/8dp` 间距、`10dp` 圆角和 frame 内失败重试；已删除生产者的 `data-forum-inline-sized` 仍被信任，来源 HTML 还能伪造该标记并移出 preview catalog。根因是「作者位置、媒体能力、文档生命周期」被错误绑定到 renderer 分类，发布门禁只各自证明 compiler 或块图 loader，没有证明组合 wiring。修复先让两种 projection 共用 compatible SVG artifact、原图 layer、coordinator、请求 identity、尺寸缓存、预览与 generation 结算；Android 模拟器随后证伪 standalone textual attachment——图片解码后内部像素已变为真实比例，但父 attachment 仍停在 `4:3`。最终 sanitizer 删除旧/内部标记，compiler 只按作者行重算 context，standalone 在原锚点复用既有 block image owner，mixed 保持 textual，Emoji/贴纸不改变位置和基线。 |
| 当前 owner | `src/domain/forum/forumContentMedia.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`tests/integration/html-sanitization-contracts.test.ts`、`src/platform/media/inlineMedia.test.ts`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/topic-rich-text-selection.test.tsx` 与 `tests/live/agent-live.md` 的四站 Topic 图片只读验收 |


## `REG-TOPIC-143` 块公式遗漏物理分片边界

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-02`、`NAV-03` |
| 历史症状与根因 | 块公式 renderer 固定写入 `marginVertical: 8`，没有接入其他块内容共用的 physical continuation boundary；公式位于分片首尾时会重复制造文章留白，TeX fallback 与 SVG 成功态也没有统一边界参数。最终由 production `MathBlockRenderer` 调用既有 `useContentBoundarySpacing()`，并把同一内部 boundary style 传给 `ForumMath` 的等待/失败 Text 与成功 View；inline 公式保持原基线和间距。 |
| 当前 owner | `tests/ui/topic/topic-math-rendering.test.tsx`、`src/domain/forum/topicContentSplit.test.ts` 与 linux.do 公式只读模拟器验收 |


## `REG-TOPIC-144` 千图 Topic 的自动原图生命周期存在双 owner

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。自动原图的双 owner、历史累计附近集合与 lease 身份已修；剩余为匹配 Release 的完整重图正反向流程。整体容量与环境故障继续由 REG-PERF-025 单独判断。 |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | `TopicContentList` 曾在既有 viewport owner 之外维护只增不减的 `nearbyTopicContentKeys`，使「附近」最终退化为整个浏览历史；renderer 又允许成功 display revision 永久绕过关闭的 viewport gate，并把每次 revision 放入正常 original lease identity。1413 张图片反向滚动时，512 项自然尺寸 LRU 还会确定性淘汰前段布局事实。修复删除第二套集合及 row `onLayout` 写入，并把自动原图 gate 上移到所有 keyed Topic row 的公共 frame，使主楼、回复正文、签名、引用和采纳答案只受当前 viewport/prefetch row set 控制；base、自然比例、frame、150 ms 过渡和 forced 预览保持不变。正常 original lease 改用稳定 progressive identity，只有真实失败记录可派生一次 `recovery-after` identity；尺寸 LRU 扩到 2,048，仍只缓存元数据、不缓存 Bitmap。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx`、`tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/topic-body-media-viewport.test.tsx`、`tests/ui/topic/topic-media-coordinator.test.tsx`、`src/platform/media/imageDisplayDimensions.test.ts` 与 `docs/operator-runbook.md` 的重图 Topic Release 验收 |
| 失败 oracle | 自动测试必须证明主楼、回复正文、签名、回复引用和采纳答案离开 viewport 后不再自动升级原图，相同 viewability observation 不提交新 state，批量注册不产生 idle 空更新，强制点按预览仍可加载原图；匹配本次源码的 Release APK 还必须按 runbook 对重图 Topic 做正反向只读 Replay，确认无空白、几何回退、重复 identity 请求、OOM、ANR、Fatal 或 PID 退出。取得该设备证据前保持 `OPEN`。 |


## `REG-WRITE-062` LinuxDo Emoji 源码往返卡死

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 含 `:wink:` 等 LinuxDo Emoji 的草稿从源码切回富文本时 WebView/GPU 可卡死，编辑器失去响应；根因：资源预览被错误写入规范文档；一次模式同步又触发第二次 ProseMirror 文档 transaction，造成无意义的整篇改写与渲染。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-063` 连续插入私有原子节点替换前一个节点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-06`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 插入 Details 后立即插入 Spoiler，后者会覆盖前者；NS poll、Stardust、L poll 等相邻节点存在同类风险，插入后也不能稳定继续输入；根因：block 插入与同类型编辑分散在各站点分支，缺少一个拥有 atom selection 语义和尾随文本选区的共享入口。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-064` CodeMirror 首次撤销清空同步正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 从富文本切到源码后第一次点击撤销，整篇同步过来的正文被清空；根因：程序同步与用户编辑共用 undo 所有权。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-065` LinuxDo 投票配置与原站交互偏离

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 用户组要求手输逗号文本，无法搜索/多选；Staff、ranked/number 图表条件错误；卡片丢标题和配置，排序投票仍显示单选圆点；根因：LinuxDo 站点能力目录未进入现有 host-action seam，UI 与 codec/账号权限各自猜测配置。 |
| 当前 owner | `src/sources/linuxdo/pollCapabilities.test.ts` |


## `REG-WRITE-066` LinuxDo Emoji 目录固定截断为 120 项

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05`、`WRITE-01`、`WRITE-02`、`WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | LinuxDo Emoji 明显少于原站，第 121 项之后无法浏览，也无法被搜索命中；根因：首屏渲染批量与目录数据边界混为一体。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-067` 终止块只能显示横向 GapCursor

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 回复或编辑正文以表格、投票、Stardust 或其他 block 结尾时，键盘已显示但表格下方只有一条横线，无法得到正常竖向文字光标；刚加载正文时撤销还可能清空整篇内容；根因：共享 Editor Runtime 显式关闭了 StarterKit 已内置的 TrailingNode，使合法的 GapCursor 被迫承担终止输入位置；两处程序化富文本替换又没有声明 `addToHistory=false`。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-068` NodeSeek 错误移除原站支持的删除线

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-02`、`WRITE-04`、`WRITE-05`、`NOTIFY-02`、`TOPIC-02`、`TOPIC-03` |
| 历史症状与根因 | 旧能力审计把 NodeSeek 的删除线与下划线一起判为不支持，导致 Composer 移除了原站实际存在的删除线；第 18 楼原站已有删除线，App 工具栏却无法继续创作同类内容；根因：共享 Tiptap UI 与站点发布能力被错误捆绑判断。两站可共享同一个删除线命令，只有下划线需要按 site 投影；NodeSeek Markdown 仍是发布边界。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-069` LinuxDo 模板计数故障阻止内容进入草稿

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`WRITE-05`、`NOTIFY-02` |
| 历史症状与根因 | 选择动态模板后正文迟迟不出现，usage POST 延迟或失败时模板内容完全丢失，用户会误以为选择无效；根因：本地草稿编辑与原站 usage accounting 被错误合并成一个远端写事务；计数接口不拥有正文插入。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` |


## `REG-WRITE-070` NodeSeek 作者无法锁定自己的投票

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-03`、`TOPIC-02`、`TOPIC-03`、`ACCOUNT-01` |
| 历史症状与根因 | App 中自己发布的 NodeSeek 投票没有锁定入口；锁定后的投票也沿用通用「已关闭」文案，无法与原站管理语义对齐；根因：来源 adapter 没有保留原站提供的管理权，UI 被迫把「能否管理」当成未知；锁定写入也没有进入现有 writable ticket、mutation scope 与权威 poll snapshot cache owner。 |
| 当前 owner | `src/sources/nodeseek/actionClient.test.ts` |


## `REG-WRITE-071` Stardust Ref、状态查询与付款生命周期使用错误 owner

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-06`、`TOPIC-02`、`TOPIC-03`、`ACCOUNT-01` |
| 历史症状与根因 | Composer 新建卡片固定写出 `ref_id=1`，原帖和回复均无法付款；真实 #10 收款链接漏识别；每日状态查询限额后 App 曾把原站静默处理的「每天最多进行500次星辰记录查询」直接显示在卡片并附加重试控件。即使 send 明确成功，刷新失败也曾被降级为 unknown；非一次性卡片付过一次后被错误关闭；根因：Ref 读取兼容与写入合法性没有分层，marker canonical 来源遗漏，状态展示与非幂等 send 共同拥有付款生命周期。正确模型是：Parser 可读旧卡，serializer/send builder 独占 Ref 写边界，Topic controller 独占 `prepare → confirm → send`；status 成功只补充统计，失败只进入诊断且不拥有卡片 UI。 |
| 当前 owner | `src/domain/forum/structuredComposer.test.ts` |


## `REG-WRITE-072` 新回复成功后丢失定位且完整目标窗被误报为部分失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 新回复已由原站确认并读回，但 Topic 停在目标页第一条而不是新楼层，顶部同时误报「部分评论未能读取，已显示 N 条」；根因：权威回复窗口 owner 必须同时保留页面完整性和写后定位交接；Composer 只拥有草稿与提交，不能猜楼层或拥有列表滚动。 |
| 当前 owner | `tests/integration/source-read-contracts/nodeseek.test.ts` |


## `REG-WRITE-073` NodeSeek 楼层回复生成错误定位链接

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek 楼层回复把楼层号直接当作页码，且没有生成 `#floor` 锚点；#1 虽碰巧落在第 1 页却缺少 `#1`，#18 则会误写为第 18 页。正确地址由固定每页 10 楼计算 `page = ceil(floor / 10)`，并写成 `/post-{id}-{page}#{floor}`。 |
| 当前 owner | `src/sources/nodeseek/actionRequest.test.ts`、`tests/integration/image-upload.test.ts` |


## `REG-WRITE-074` NodeSeek 写后请求瀑布与无界末页发现

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | 回复 POST 后先刷新主题详情，再读尾页、目标页；末页发现又沿 `next` 循环，评论数越多耗时和请求数越不可控，最终还用尾窗首项猜新回复。当时 NodeSeek 写后专属路径以当前详情计数和已加载最高楼层计算下一楼页，只执行一次 POST 与一次直达列表 GET；不用 `start` 发现末页，也不补读。普通浏览的 `start` 尾窗发现仍以入口页加一次直达末页为硬上限。当时回读以当前账号和实际提交内容唯一确认实体，无法确认时提示手动刷新且绝不重发。该猜页与正文匹配随后引发 `REG-WRITE-090`，现由 POST 确认目标取代，保留单次直读和相邻分页 owner。 |
| 当前 owner | `tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/topic/topic-actions-controller.test.tsx`、`tests/integration/source-read-contracts/nodeseek.test.ts` |


## `REG-USER-008` 用户活动末页仍显示加载更多

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | NodeSeek 用户只有一条主题时仍显示「加载更多主题」，回复末页也会继续暴露下一页；linux.do 回复存在同类误报，主题则无条件终止而漏掉后续页。根因：来源 adapter 把「当前解析列表非空」当成「还有下一页」，或没有使用原站可分页主题入口；UI 与 controller 只是忠实投影该来源结果。 |
| 当前 owner | `tests/integration/source-read-contracts/` |


## `REG-USER-009` 用户活动切换重建列表和资料头

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01`、`USER-02` |
| 历史症状与根因 | 主题/回复切换时列表整体重新挂载，资料头进入列表后简介测量状态也随之丢失，头像和布局重复建立。根因：FlashList 的 key 包含活动标签，列表数据和资料头也随标签重新生成。列表身份改为仅属于用户，主题/回复活动项分别按各自数据引用缓存，资料头在无关切换时复用；数据更新仍单次线性构造稳定行 key，不改变分页或切换回顶规则。 |
| 当前 owner | `tests/ui/user/user-screen.test.tsx`、`src/features/user/userScreenItems.test.ts`；匹配构建上的标签切换、吸顶和返回走查。 |


## `REG-PERF-024` Search 空态最近记录曾常驻 Header，转场仍有连续 deadline miss

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 本轮最近一次正式 warm 采样 cfcb8a62… 的三批严格复验为通过/失败/失败，事故重开 `OPEN`；p95/worst 达标，但有 3 对相邻有效 App 记录同时 miss。先前 956 包三批严格通过、四 Tab 与返回恢复验收仍是有效历史证据，不能替代当前包结论。相邻记录间隔约 1.589 秒，不证明连续显示周期掉帧或原生重新附着回归，晚帧是否来自滚动条尚未确认；冷首次进入继续由 `REG-PERF-029` 单列。 |
| 2026-10-04 复核 | 普通 Release 1.3.150/154（APK SHA 4880a3dc…ec339a），同 PID 4627、三批各 10 次双向切页，共 1,620 个有效帧。三批 p95 为 21.878/21.832/21.543 ms，worst 为 23.299/23.424/23.540 ms，时长均过门槛；单次转向内相邻 miss 为 0。第一批首个 Search→Feed 边界有一对相邻有效 miss，IntendedVsync 相隔 2100.076 ms，因此三批严格门槛为失败/通过/通过。无对应 Fatal、Fabric 或 Reanimated 错误，登录前后 3/3。原帧与统计见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 formal-warm-complete；该跨操作间隔不证明连续显示周期掉帧。 |
| 能力 ID | `SEARCH-02`、`NAV-01` |
| 2026-10-02 真实附着链路与最小调整 | 937987c0 包的 Search→Feed 采样中，主线程 UPDATE_PROPS 内反复附着原生树；一次 draw 包含 192 个 Text 与 39 次 palette 计算，不是已证实的 React 重复提交。仅删除首页自定义预绘距离 900，采用锁定 FlashList 默认 250，正常 Release 包 `6a25a9eba246c201f10dde9ed15a76a527a2628c5be651a50f05b3acedd1f3ca` 覆盖安装并正常冷启动，PID2941、原 UID/首次安装时间及三站登录保持。原生树降至 123 Text/23 palette，典型 draw CPU 约 12 ms 降至 6.4 ms；不改变回收池、原生 detach 或读取 gate。 |
| 本轮正式门槛与剩余范围 | 6a25 可见 Host 同 PID 三批各 10 次往返，p95 `22.625/24.679/22.404ms`、worst `23.378/33.931/27.304ms`、missed `16/20/19`；仍有 1/2/1 对相邻 miss 记录，间隔 900～944 ms。快滚 6 下 6 上后另三批 p95 `26.636/32.615/23.398ms`、worst `34.283/32.823/33.156ms`，同样未通过。快滚录屏 10 fps 抽样未见已加载区整片空白；归因 trace 的Text/palette只增至 126/24，props CPU 中位数 3.378→3.379 ms，没有继续缩回收池的证据。剩余成本在 native attach/visibility、App/RT绘制及调度，匹配 SF 帧正常；不得统称环境因素。原始证据在 ignored `.codex-tmp/intermittent-restart-20261002/feed-window-search-compare.json` 与 `.codex-tmp/intermittent-restart-20261002/feed-window-pool-compare.json`。 |
| 历史症状与根因 | Feed → 空态 Search 多次出现约 42–53 ms 帧；「最近搜索」标题和全部记录原先作为 `FlashList.ListHeaderComponent` 的普通子树一次性挂载，最多 20 条记录绕过 item virtualization。记录迁入 typed list data、恢复原单张圆角分组外观并消除相邻点击区重叠后，最终匹配 SHA 的 Release 三批各 10 次往返 p95 为 `23.484/23.377/23.265ms`，worst 为 `33.642/26.996/27.162ms`，两项数值门槛均通过；但按 `FrameCompleted > FrameDeadline` 统计，两个方向仍分别出现最长 `2–3` 帧与 `9` 帧连续 miss。因此 Header 的结构性 owner 已收口，完整 `NAV-01` 性能门槛尚未关闭，不能再把剩余 deadline miss 归因给最近记录或叠加 memo/延时。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 继续拥有 typed history、点击区与搜索头提交，`tests/ui/app/app-composition.test.tsx` 和 `tests/ui/app/app-navigator.test.tsx` 承接稳定路由回调与导航接线；设备门槛仍由 `docs/operator-runbook.md` 的 Search Release 性能回归拥有。 |
| 失败 oracle | 匹配 APK 在主登录态 AVD 上执行三批、每批 10 次 Feed → Search → Feed，任一批 p95 `>25ms`、worst `>35ms` 或出现连续两帧 missed deadline 即保持 `OPEN`；同时要求最近记录是稳定 typed items、UI 与原分组一致、相邻 `48dp` 点击区不重叠。 |
| 后续核对 | 2026-09-20 最终普通 Release APK `93dc6c74…` 预热后三批各 10 次往返，按 post-dump reset 时间排除旧帧，并按单次转向统计连续 miss。三批 p95 为 `23.184/23.106/23.220ms`，worst 为 `33.985/33.385/26.268ms`，最长连续 miss 为 `35/34/34`，故仍 `OPEN`。独立 Perfetto 456 帧中 440 为 Prediction Error/Early、1 为 App Deadline Missed/Late 组合，未建立 React 重复渲染因果；真实导航/controller 的受控 Profiler 无重挂载或累积更新，另一次录屏 780 帧未检出整块闪白，均不能替代帧门禁。取证范围与限制见 `docs/review-remediation.md`「持续复审与性能核对」。 |
| 2026-09-23 D 构建复核 | SearchRoute 按实际依赖稳定 scope 与回调，AppComposition 保持 onScreenChange 稳定；仅 Feed/Search 关闭 freezeOnBlur，保留原生 detach 默认值、Library/More 和外层 Stack 的冻结。D 正常 Release APK SHA-256 `133dc35f02fca959b26e830ea9fe49820c6b1363862032806ea97361c7fb052e`、buildId `91481da2a29746988c4f08dedc11a4f3` 在主 `WZ_Pixel_API_35` 冷启，App PID `2869`。首次挂载单列后，三批各 10 次 Feed→Search→Feed 共 1069 个有效帧；三批 p95 为 `22.367186/22.079458/22.120951ms`，worst 为 `32.772985/27.315046/23.845136ms`，missed 数为 `26/28/29`，各批最长连续 miss 均为 `1`。该 D 构建的这一次重复往返满足既有门槛；后续 E 同源码的独立重复未稳定通过，不能沿用本次通过关闭当前问题。 |
| 2026-09-23 当前 E 与 F 对照 | 当前 E 正常 Release/Hermes APK SHA-256 `afa2a2eb022826b43fa708248add974110b64e3e1ab0287996eb278977eb062a`，两次独立同 PID 三批各 10 次往返：第一轮 p95 `22.976/21.867/22.396ms`、worst `34.451/33.134/23.685ms`、最长相邻记录 miss `2/1/1`；第二轮 p95 `22.074/22.314/22.202ms`、worst `33.612/34.346/25.290ms`、最长 `1/2/1`。两轮各有一批违反现有逐条 gfxinfo 样本的门槛，故重新标 `OPEN`。隔离构建 F 仅将 Tab.Navigator 设为 `detachInactiveScreens={false}`，首轮三批通过，但第二轮第 2 批仍有最长 `2`，未稳定过门槛；它使已访问页面的 Native Views 从 E 的约 `1141` 增至 `1330`，该次首轮前后 PSS 为 `291211→345382KB`（静置 25 秒 `326575KB`），E 可比首轮为 `280444→289594KB`。四对相邻 missed App 记录的 `IntendedVsync` 实际相距 `33–200ms`，不是连续显示周期，不宣称用户看到连续两个显示帧卡顿；既有门槛仍按相邻有效 App 记录保守判定，没有只对 F 放宽。F 未合入，设备已恢复 E。原始帧与内存留在 ignored `.codex-tmp/transition-followup-20260923-021317/`；不能以单轮较快的 p95、一次录屏未闪白或额外驻留换取关闭结论。 |
| 首次挂载与成本边界 | 同一冷启进程的 Search 首次挂载另有 24 帧，p95 `33.145916ms`、worst `33.35254ms`、missed `3`、最长连续 miss `2`；不计入上述预热后往返通过结论，不能宣称冷首次进入无卡顿。后续三个 fresh process 的首次进入仍有慢帧，独立记为 `REG-PERF-029` 并保持 `OPEN`。局部解除冻结允许隐藏页继续更新，仍可能增加驻留内存，不保证 PSS 零增长；其他设备、首挂载与独立媒体/IME 动画仍按各自 owner 验证。 |
| 2026-10-02 冷重启复查 | 原已验收 APK `6f636dc7…`、原 Host 配置与保留数据的同 AVD 冷启动后，PID1997 三批各 10 次往返，逐次 reset；p95 `29.408/22.064/22.446ms`、worst `43.798/33.050/32.998ms`。各单次操作没有相邻有效记录同时 missed；跨轮汇总仍出现相邻 missed 记录，间隔约 0.75～0.93 秒，现有严格门槛保持 `OPEN`。共享浮动操作 hook 已把切页/暂停隐藏与阅读滚动的 160 ms 动画分离，Feed 原 oracle 修前 Expected0/Received0.4、修后最低 1 项及Feed/Topic189项通过（seed1790925250）；不以此证明原生性能改善。新版安装时 Agent 误用已禁用的 reinstall，安装身份改变、App 数据被清除，立即冻结设备；新版三批门槛与重复内存矩阵为 `BLOCKED_BY_ENV`，没有用新匿名状态继续测量或回滚数据。证据在 ignored `.codex-tmp/intermittent-restart-20261002/acceptance.md`。 |
| 2026-10-02 恢复后复验 | 用户授权恢复后，从 9/23 同批磁盘快照恢复原 UID10214 与首次安装时间，当前共享文件逐项校验一致；用户重新登录 L，主 AVD 正常冷启动后保持三站登录。4c54 可见Host/PID17950三批各 10 次 Search 往返，p95 `22.449/22.381/22.853ms`、worst `23.116/23.321/23.207ms` 且无相邻有效 miss 记录。后续 9d 统计槽修复包可见Host/PID2777同样三批，p95 `22.870/22.322/23.207ms`、worst `22.934/22.675/23.260ms`；第三批两条相邻 miss 记录跨 `922.452ms`，严格门槛仍失败，不能称连续显示周期掉帧，也不以 4c54 的通过关闭本事故。Vulkan、AsyncComposeSupport 及软件渲染对照未稳定通过全部场景，均已恢复原 Host 配置。内存、原始帧和恢复边界分别保存在 ignored `.codex-tmp/intermittent-restart-20261002/final-acceptance.md` 与 `.codex-tmp/intermittent-restart-20261002/recovery-acceptance.md`；旧冻结记录只代表历史阶段。 |
| 最终包复验 | 最终正常 Release 包 869e0521、可见Host/PID13505、三站已登录；Search 三批各 10 次往返 p95 `23.093/23.073/22.561ms`、worst `23.257/33.489/22.986ms`。前两批相邻 miss 记录跨 `888.889–922.222ms`，严格门槛未全通过，状态仍 `OPEN`；首次挂载 4 帧worst23.103ms另记，不混入暖路径。没有并行构建、测试或采样器，也没有以其他站点较快替代此结果。双方向与实际次数见 ignored `.codex-tmp/intermittent-restart-20261002/guard-search-summary.json`。 |
| 2026-10-04 原生附着路径修复 | `AppNavigator` 设置 `detachInactiveScreens=false`，访问过的主 Tab 保持原生附着，避免返回时重新附着整棵页面；仍按首次访问懒挂载，最多保留四个主 Tab，不预挂载 Search。`tests/ui/app/app-navigator.test.tsx` 沿真实导航验证四页各自状态、嵌套返回、焦点与无障碍可见性，13/13 为 `UI_PASS`。Feed/Search 既有失焦 Query、读取与媒体 gate 不变，隐藏页不接收无障碍焦点；性能与驻留由下列普通包独立验收。 |
| 2026-10-04 最终普通包验收 | 无 probe 的 Release/Hermes APK `956bce1d…`，按 runbook 覆盖安装后保留数据冷启动主 AVD，PID4362 三批各 10 次 Feed→Search→Feed。60 次转向各保留完整 3 秒，共 1620 帧；三批 p95 `21.717/21.578/21.655ms`、worst `23.665/23.477/23.112ms`、miss `38/40/40`，各批、跨转向及跨全批相邻有效 App miss 对均为 0，旧门槛全部通过，补充 `>=` 口径一致。两个方向各 810 帧的 p95/worst 分别为 `21.775/23.477ms` 与 `21.632/23.665ms`。同 PID Feed PSS 从 warm 基线 `278823` 到 `314803KiB`，增加约 35.14 MiB；随后四 Tab 预热基线 `303440KiB`，15 轮后三个批末为 `314673/314840/316845KiB`，Views 始终 1227，没有随访问轮数增加，离散 PSS 有波动，不据此保证不存在任何泄漏。65 份四页 AX 快照均只暴露当前页内容和四个 Tab；打开详情后 Tab 隐藏，返回及 HOME→前台后 Feed 首行位置保留且 PID 不变。真实导航 UI owner 另证明 React 焦点，AX 不替代它。截图保留原圆角分组和分隔线，首屏完整行独立 48 dp 点击区不相交。身份、登录 3/3 保持，所查 Fatal/Fabric/Reanimated 同步错误均为 0；`NAV-01/SEARCH-02` 本次 warm 范围为 `LIVE_PASS`。证据在 ignored `.codex-tmp/remaining-four-20261004-113939/final-warm/`、`final-four-tabs/` 与 `final-navigation-return/`，不覆盖冷首次进入或物理设备。 |
| 2026-10-04 retained 普通包严格复验 | 无 probe 的 Release/Hermes APK `cfcb8a62d50077d832d8690dd7f426ff10a3112f0a5e02e5c8e24a369ec9aa2e`（sourceHash `6c3c9122291d50f718335a3015a7da91d4f3b815ff3f96cec19396e289e31cf2`），主 AVD/PID4090、登录前后 3/3。三批各 10 次 Feed→Search→Feed，60 个完整 3 秒窗口，共 1621 帧；总体 p95 `21.970383ms`、worst `33.349723ms`。三批 p95 `21.970383/21.988982/21.951938ms`、worst `24.664163/33.349723/32.651491ms`、miss `39/40/41`，时长门槛均通过；第 2 批两对、第 3 批一对相邻有效 App 记录同时 miss，均在单次转向窗口内，`IntendedVsync` 间隔均为 `1588.888873ms`，没有跨操作 miss 对，附加 `>=` 口径结果一致。因此三批既有严格门槛为通过/失败/失败，当前保持 `OPEN`，不放宽门槛或裁掉晚帧。该记录间隔不证明连续显示周期掉帧；原始 gfx 没有晚帧元素身份或同次 App→SF 对应，不能确认滚动条归因，也不能证明原生重新附着根因回归。956 包的历史通过完整保留。证据在 ignored `.codex-tmp/remaining-two-20261004-continue/` 下的 `retained-warm/summary.json`、`retained-warm/readonly-audit.json` 和 `.codex-tmp/remaining-two-20261004-continue/retained-warm-audit.md`。 |

## `REG-PERF-030` 失效动画视图的同步更新在绘制中反复抛错

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01/04`、`NAV-01/02/03` |
| 最终最小调整包复验 | 包 6a25a9eb、可见Host/PID2941在首页预绘调整后再完成 L↔NS、Y↔NS 各 20 次实际选站；p95 分别 `22.812/22.453ms`、worst `23.314/22.726ms`，均无相邻有效 miss 记录；L↔NS 行为 oracle 仍为零失效视图异常。此结果只关闭本条根因，Search 事故继续 OPEN。 |
| 历史症状与根因 | 2026-10-02 可见 Host 模拟器上，869e0521 包的 L↔NS 切换仍有 64～74 ms 长帧。实际 CPU 采样在一次 66.466 ms 帧中捕获 `NativeProxy.synchronouslyUpdateUIProps`、`Throwable.printStackTrace` 与 SVG 绘制分发；日志为不存在的 Fabric tag 触发 `RetryableMountingLayerException`。Reanimated 的 draw-pass 重复读取 retained registry，RN 0.86 的反射路径未检查 view 是否存在，因而每个 SVG layout 事件都可能再次构造并打印长堆栈。独立无采样 20 次切站出现 50 次异常、涉及 5 个失效 tag；不能归因某一个图标，也不是序列化 buffer 没有清空。 |
| 修复 | 现有 `react-native-reanimated+4.5.1.patch` 回补已合并的上游 [PR #10435](https://github.com/software-mansion/react-native-reanimated/pull/10435)。仅在 RN 0.86 分支的同步原生更新前查询 `getViewExists`，不存在则跳过当次 apply；registry 和 commit hook 保留初挂载属性，其他异常保留简短诊断。没有新增缓存、关动画、删除图标、延时切页或改变依赖版本。 |
| 当前 owner | `tests/tooling/patch-artifacts.test.ts` 验证真实补丁可逆应用；独立干净安装的 15 份补丁 forward check、真实 postinstall 和 15 项 reverse check 全部通过，seed 210605。最低行为 oracle 为 ignored `.codex-tmp/intermittent-restart-20261002/account-animation-probe.mjs`：实际读取选站节点并验证每次切换，按设备时间窗口计数原生日志；旧 APK 50≠0 失败，新 APK 三批各 20 次全部为 0。 |
| 原生复测与边界 | 正常 Release/Hermes APK SHA256 `937987c0b66edba77127a6dd870490a3dcdcf92f5632c240ae02a8db4c165710`，同签名覆盖安装并正常冷重启，UID 10214、firstInstallTime `2026-07-26 16:51:37` 与三站登录保持。所有构建和测试结束后，同一 PID 3067 三批 L↔NS 的 p95 为 `23.223/23.087/22.336ms`、worst 为 `34.289/24.816/23.281ms`；第二批两条相邻有效记录均 miss，但 IntendedVsync 间隔 1866.667 ms，不是连续显示周期。另一次定位 trace 中 RenderThread 的 46.121 ms 帧有 44.884 ms 等待系统 buffer，不能把全部系统合成问题也归为该修复。实体机仍未验证，Search 的独立性能事故不随本条关闭。 |

## `REG-PERF-029` Search 首次挂载仍有原生创建与冷绘制慢帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 本轮最近一次正式冷测 cfcb 三个 fresh PID 首次进入 worst 为 `33.028/34.405/22.096ms`，仍有冷帧 deadline miss，保持 `OPEN`。系统 ImageView 与透明 TextInput 原生底图移除保留；新的边框替代方案未证实收益或像素不等价，均已撤回。cold 未另设零 miss 门槛，不以原生节点数、shader 消失或 warm 时长达标替代完整结论。 |
| 2026-10-04 复核 | 同一普通 Release 1.3.150/154、三个 fresh PID 4076/4355/4627，完整采样窗口各 3 秒；有效帧 28/29/29，p95 43.606/25.912/28.828 ms，worst 44.132/33.304/32.723 ms。未见 Fatal、Fabric 或 Reanimated 同步错误；安装身份和登录 3/3 保持。原数据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 formal-cold，不把首次挂载簇与整段采样混成一个统计。 |
| 能力 ID | `SEARCH-02`、`NAV-01` |
| 2026-10-02 单次候选观测 | 6a25a9eb 正常 Release、可见Host/PID2941的 Search 首次挂载 4 帧，p95/worst `33.425ms`、missed2；首次返回 Feed 另 1 帧 `23.203ms`。首次观测与 warm 三批分开保留，不据此关闭本条；没有预挂载或把首次帧移入 warm 样本。 |
| 历史症状与根因 | 2026-09-23 主登录态 AVD 上将 Search 首次进入与预热后往返分开取证：D 三次独立 fresh process 的首次 p95/worst 为 `45.375236/44.649095/44.183480ms`，每次最长连续 missed deadline 均为 `2`；Search 源码相同的 E 三次为 `56.002746/55.666297/54.958170ms`，没有构成改善。独立 D Perfetto 中首两帧 FrameTimeline actual duration 为 `31.09/31.44ms`，RenderThread 上 GPU shader 编译分别占 `8.36/7.65ms`；这些 trace 时长与 gfx 的 IntendedVsync→FrameCompleted 口径不同，不直接比较。实际原生 View 创建共 `286` 次，分批 `32/20/78/78/78`，后三批各含 `12` 个 SVG root、`12` 个 Group、`30` 个 Path、`6` 个 Text 和 `18` 个 View；历史图标形状的 `19` 对纹理分后三个绘制帧上传。已定位首次创建和冷绘制成本，但 trace 不含业务 View identity，尚未证明某个背景或透明度属性单独拥有 shader 峰值。 |
| 当前 owner | `tests/ui/search/search-screen.test.tsx` 承接 typed history、输入与 Header 提交；首次原生挂载由 `docs/operator-runbook.md` 的 Search Release 性能取证单列，原始 fresh-process gfx、Perfetto 和逐帧归因位于 ignored `.codex-tmp/transition-followup-20260923-021317/`。受控真实 Route/controller 的 history 恢复实验未出现额外输入子树提交或列表重挂，不能用 mock FlashList 的通过代替原生绘制验收。 |
| 2026-10-03 原生修复包诊断 | 普通 Release/Hermes 包 `4b2d8475…`（末次通知 guard 补修前，与最终包的 Search/原生实现相同）在构建、测试与任务隔离 AVD 均停止后，以主 AVD 三个 fresh App PID 首次进入 Search。各轮 worst 为 `55.761/55.380/66.779ms`，均是第 3 帧；UI 至提交区间为 `22.812/26.040/27.773ms`，Render 至交换为 `14.269/15.253/16.226ms`，GPU 完成尾部为 `12.517/7.559/9.871ms`，均为时间戳区间而非线程 CPU 时间。后续第 5–28 帧最高 `14.558/14.829/15.102ms`；没有持续重复更新的证据，但首挂载慢帧仍真实存在。未重启共享 AVD，此为诊断而非完整性能门禁；不能凭 gfx 数据直接更改图标或列表预绘距离。原始记录位于 ignored `.codex-tmp/search-followup-20261003/final-cold-search.json` 与 `.codex-tmp/search-followup-20261003/final-cold-search-stages.json`。 |
| 同包线程归因 | 同包独立 Perfetto 的第 3 帧实际区间为 71.394 ms，含追踪开销且与 gfx 口径不同。UI doFrame 为 52.218 ms（running 34.096 ms），包含 premount 4.460 ms、mount 14.343 ms、Record View draw 23.551 ms；Render DrawFrames 为 27.753 ms，包含 prepareTree 7.945 ms、FillRRectOp 与 AAConvexPathOp 两次 shader cache miss 编译 4.431/3.979 ms。嵌套区间不得累加。四个首挂载帧共创建 267 个 Native View，40 SVG root、40 Group、100 Path 与 20 条历史行的两个图标/五条路径对应，未证明同一业务 View 重复创建。未确认可直接移除的新增重复工作，既有重复同步更新根因由 `REG-PERF-032` 独立关闭；不能以旧 trace 的 shader 猜测改动最终包 TextInput。证据在 ignored `.codex-tmp/search-followup-20261003/finaltrace-attribution.json`。 |
| 2026-10-03 原生图标对照 | 同一 AVD、保留 20 条历史的普通包 `4526f11f…` 三个 fresh App PID 首挂载 worst 为 `55.731/55.364/46.567ms`。XML VectorDrawable + RN Image 的真实 source 试测确认 History/Close 各 20 次加载、零错误；移除诊断回调的普通包 `ea66b6cb…` 三轮 worst 为 `92.674/55.165/89.190ms`，首挂载簇 `4/5/7` 帧。独立 trace 的 40 次 Image 创建累计 wall `52.740ms`、running `31.330ms`，最重帧 mount `52.577ms`；创建区段包含构造、初始 props、placeholder 和 controller，不能全部归因为 XML inflate，也不与 gfx 帧时直接比较。RN Image 改用 PNG 的 `22f42244…` 三轮 worst 为 `61.262/61.914/69.165ms`，首挂载簇均为 `12` 帧，不能只取前四帧宣称改善。合并 Lucide Path 仅两轮有效，worst `44.056/77.414ms`、首挂载簇 `4/3` 帧；第三轮在 Feed 前置等待超时，未采到 Search，不能计作三轮通过。以上方案均未稳定改善，已否决；节点减少不能代替帧时验收。探索性记录分别在 ignored `.codex-tmp/search-cold-baseline-20261003-4526/`、`.codex-tmp/search-icon-vector-clean-20261003/`、`.codex-tmp/search-icon-raster-20261003/measurement/final-cold-search.json` 与 `.codex-tmp/search-icon-path-20261003/measurement/capture.log`，不作为完整性能门禁通过。 |
| 系统 ImageView 修复与正式对照 | 保留系统 ImageView 同步加载静态 PNG 的实现。同一 AVD 保留数据冷启动、空闲主机、20 条历史与三个 fresh App PID 的普通 Release/Hermes 正式对照：基线 `4526f11f…` 首挂载簇 UI→queue 累计 `46.58/46.59/45.20ms`、draw→queue 累计 `18.61/15.79/19.53ms`；候选 `4541247b…` 分别为 `27.65/29.88/26.36ms`、`7.10/6.31/4.79ms`。这些是 gfx 时间戳区间之和，不是线程 CPU 时间，draw 段包含于 UI 段，不相加；cold worst 基线 `43.865/43.768/33.400ms`、候选 `32.694/44.467/33.450ms`，并非每轮下降。独立 trace 按整个 Search 事件窗口统计，旧 Lucide 实现的 `4b2d8475…`（与基线 Search 实现相同）共 `299` 个 Native View，候选为 `159`，其中 40 SVG root、40 Group、100 Path 替换为 40 ImageView；不同于前述仅四个 doFrame 的 `267` 个节点口径。800 ms 等待的 warm 短窗口三批 worst 基线 `23.208/32.031/25.186ms`、候选 `23.150/23.210/23.232ms`；候选第二批有 IntendedVsync 间隔 `111.111ms` 的相邻有效记录 miss，基线亦未全通过。相邻记录不等于连续显示周期 miss，不据此猜测根因或关单。复核确认上述 800 ms 等待未覆盖原生滚动条的延迟淡出，不能可靠逐帧判断目标页面归属；短窗口不替代完整 warm 验收。最终同包/PID 的每转向 3 秒完整窗口三批 p95 为 `21.828/21.841/21.926ms`、worst 为 `29.379/24.635/23.460ms`，前两批仍有间隔约 `1588.889ms` 的相邻有效记录 miss，故保持门槛未全通过；同 PID Feed PSS 从 `308489` 到 `305852KiB`，没有用不同进程绝对值比较，零 Fatal/Fabric 失效/Reanimated 同步错误。完整记录在 `.codex-tmp/search-icon-native-20261003/formal-warm-complete/summary.json`。独立晚帧 trace 未出现 mount/UPDATE_PROPS/create，源码存在原生滚动条延迟淡出路径，但没有逐帧 owner 标记，不认定每条晚帧的具体原因。此前证据在 ignored `.codex-tmp/search-icon-native-20261003/` 与 `.codex-tmp/search-icon-baseline-formal-20261003/` 下的 `formal-cold/final-cold-search.json`、`formal-warm/summary.json`，候选独立 trace 在前者 `trace/`。 |
| 处置与边界 | 已降低首次创建/绘制开销；仍有冷帧和相邻有效记录 miss，性能未全通过，保持 `OPEN`。D 的预热后一次重复切换通过不覆盖首次挂载，也已被 E 的独立重复推翻为不稳定。F 全局保留失活 Tab 的单次首次进入 p95 `27.927ms`、worst `28.354ms`、最长连续 miss `2`，且引入额外驻留，未构成可接受修复。后续必须在匹配 APK、同一设备与保留数据下用独立新 PID 重复首次进入并单列 deadline、录屏及 trace，不能通过预挂载、延时或把首次帧移入 warm 样本掩盖。E 较慢不能证明所有首次绘制成本都有同一根因。 |
| 2026-10-04 透明 TextInput 底图修复 | 同 APK 原生底图移除 A-B-A 仅在 B 消除 NonAALatticeOp，单改 alpha=0 仍编译该 shader。正式 RN patch 只在 underline 完全透明时移除原生背景层，保留并可恢复该 Drawable；React 的填充、边框、阴影和 padding 保持。`ReactTextInputUnderlineBackgroundTest` 的真实 Drawable.draw oracle 先失败后通过，相关 JVM 21 项为 `UNIT_PASS`，tooling 58 项及隔离 clean install 的 15 份补丁 forward/postinstall/reverse 检查为 `STATIC_PASS`。匹配 v4 cold trace 的 NonAALatticeOp 为 0，仍有历史行 shader。边框另已归因到 AAConvexPathOp，但替代绘制的原生像素矩阵 32 项中 24 项不等价，方案已否决，Search 样式恢复原样。这些局部结果不是完整性能门槛通过。证据在 ignored `.codex-tmp/remaining-four-20261004-113939/search-native-background-candidate/`、`.codex-tmp/remaining-four-20261004-113939/search-cold-candidate-v4/shader-comparison.log` 与 `.codex-tmp/remaining-four-20261004-113939/clean-install/`。补丁影响共享 Android TextInput，焦点、输入、主题及有样式输入框仍须按入口验收。 |
| 2026-10-04 最终普通包首挂载 | 无诊断 probe 的 Release/Hermes APK `956bce1d…`，覆盖安装后按 runbook 保留数据冷启动同一主 AVD；三站登录、UID10214、首次安装时间与版本 1.3.150/154 均保持。三个 fresh PID3827/4105/4362 各保留完整 3 秒、29 帧，p95 `32.754/22.253/22.262ms`、worst `33.385/22.379/22.396ms`、miss `2/3/3`；各自首挂载簇均为 4 帧、miss `1/2/2`，后续约 1.53 秒起的 25 帧没有裁除。原始 gfx 逐帧重算一致，严格 `>` 与补充 `>=` deadline 口径一致，各轮无相邻有效 App miss 对，日志零 Fatal/Fabric/Reanimated 同步错误。现行文档没有独立 cold 数值关闭门槛，不挪用 warm 门槛或只取前四帧宣称通过。首屏 AX 仅证明 12 条完整历史行的独立 48 dp 点击区互不重叠，第 13 条被视口裁剪，不代表全量 20 条都在屏内。证据在 ignored `.codex-tmp/remaining-four-20261004-113939/final-cold-reboot/` 与同目录 `scratch/final-cold-audit/report.md`。 |
| 2026-10-04 边框候选否决 | 保留原轮廓的同色 quad UNION 虽通过 64 图像素矩阵及 4 项 native owner，普通包 `937cf158…` 三个 fresh PID 首次 worst 为 115.909/32.611/32.684 ms，没有证实设备收益。独立 trace 确认 AAConvexPathOp 消失但出现新的 FillRectOp shader 编译，不能用后测的 31.615 ms 覆盖首轮长尾。直接 DD-RRect 的无 clip/原双 clip 两轮均为 4 项中 2 项失败，分别出现直边 alpha 差 64、角点差 116，未放宽像素门槛。所有边框候选和专属测试均撤回，RN patch 精确恢复 `84e54608…`；不保留无收益的额外快路。证据为 ignored `.codex-tmp/remaining-two-20261004-continue/cold029-union-trace-review.md` 和 `.codex-tmp/remaining-four-20261004-113939/history-border-double-rrect/rollback-receipt.json`。cold 没有另设零 miss 门槛；gfx miss、App Late 与 SF prediction 分开解释，不以单一计数宣称显示通过。 |
| 2026-10-04 保留版首挂载复验 | 普通 APK `cfcb8a62…`、sourceHash `6c3c9122…`，恢复原 RN 边框实现后保留数据冷启同一主 AVD。fresh PID3530/3811/4090 三次各保留完整 3 秒、29 帧，p95 `26.941720/33.306714/22.032793ms`，worst `33.028309/34.404903/22.095730ms`，miss `3/3/4`；三站登录及安装身份保持。没有将边框候选首轮 115.909 ms 长尾计作保留版结果，也没有裁掉后续晚帧。本条仍为 `OPEN`，当前 warm 严格失败另归 `REG-PERF-024`。证据在 ignored `.codex-tmp/remaining-two-20261004-continue/retained-cold/final-cold-search.json`；741 份 runtime 文件及 APK 哈希由同目录 `.codex-tmp/remaining-two-20261004-continue/final-source-check.json` 核对一致。后续普通包 `68651441…` 仅将共享编辑器层恢复为原 hardware，Search 实现未变，但未在该 APK 重跑完整冷/暖性能，不能把本行改记为新 APK 通过。 |

## `REG-PERF-025` 千图 Topic 整体容量复核

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 本轮同包独立 fresh PID 完成真实正文内两轮 40 下/40 上并正常返回，用户自行测试也正常；不列为本轮待修 Bug。历史整体容量条目仅保留完整基线非回退矩阵的验收边界。 |
| 2026-10-04 独立补验 | 同一主 AVD、相同普通 APK，fresh PID 6769 的 160 次固定正文区域手势，每步均断言仍为已加载主题，无系统栏或图片预览覆盖；两轮反向末尾截图均回到帖子顶部，最终断言已回首页。Feed/采样峰值/回首页 0/30/60 秒 PSS 分别为 258149/415878/342533/316069/312721 KiB；gfxinfo 累计 p95/p99 为 18/21 ms，deadline missed 2.00%，有界日志无 Fatal、ANR、OOM 或 Already released。只证明这一次有效完整负载未复现，不代替三次基线非回退对照或所有媒体预算指标。证据为 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38/heavy-verified-gestures`。更早的 heavy-cold-confirmation 上行误入系统栏，已标无效，不用于完整往返、回首页或内存回收结论。 |
| 能力 ID | `TOPIC-01`、`TOPIC-02`、`TOPIC-03`、`NAV-03` |
| 历史症状与根因 | NodeSeek `post-863650-1` 的历史 Release 样本曾出现 Feed `+172,595KB`、`Cannot add callbacks to a cancelled EngineJob`、App PID 退出和模拟器失去响应；有效 heapprofd 样本在 5 次滚动中记录约 1.14 GB 总 malloc、仅约 12 MB 净留存，Release mapping 将主链还原为 Glide `DecodeJob`、`BitmapFactory.decodeStream` 与 `SkJpegCodec`，说明主要风险是巨大解码工作集和分配抖动，而非持续 JS 泄漏。Glide 5.0.9 与当前 compileSdk 36 不兼容，Glide 5.0.5/回收池 40 保持固定。恢复版 APK 的本轮同条件冷启基线为 Feed `254,970KB`，同 PID 两轮 40 下/40 上的采样峰值 `487,861KB`，返回 Feed 60 秒 `358,337KB`，gfxinfo p95/p99 `18/21ms`，无 Fatal、ANR、OOM 或 EngineJob。随后已完成 `REG-TOPIC-144` 的代码修复（该条目仍等待完整设备证据关闭），并在现有 expo-image patch owner 中把 resize rerender 投递到下一主线程任务，以 generation、attach 与最终宽高丢弃 stale task；Release Kotlin、expo-image Release unit test 和 x86_64 APK 均已构建通过。候选 APK `c63fdc4d…` 经授权覆盖安装后，等待 Package Manager handler 与磁盘同步，再关闭同一 `WZ_Pixel_API_35` 并以 `-no-snapshot-load -no-snapshot-save` 冷启；后续各次冷启均保持相同 APK SHA、`1.3.134/138`、`firstInstallTime=2026-07-26 16:51:37` 与登录数据。两次完整独立候选流程均在同一 App PID 内完成两轮 40 下/40 上：其 Feed/采样峰值/返回 Feed 60 秒分别为 `254,352/428,885/352,410KB` 与 `254,142/464,721/362,399KB`，gfxinfo p95/p99 分别为 `18/21ms`、`16/19ms`，jank 为 `0.51%`、`0.38%`，均无 Fatal、ANR、OOM、EngineJob 或网络异常；原生树保持约 `61–62` 节点，顶部、5 步、中段和反向截图未见空白、4:3 回退、比例/行高/圆角/间距变化。第三次独立冷启先出现可关闭的既有 linux.do 登录 WebView，按关闭后的 Feed `296,147KB` 归一；第一轮及第二轮下行完成，第二轮反向约第 26–30 步时整个 emulator/qemu 进程退出，宿主 Android Emulator 36.5.11 同分钟生成 `48,356,112` 字节 crash dump，故该轮记 `BLOCKED_BY_ENV`，不能当成 App Fatal，也不能关闭总体容量问题。再次冷启后 APK/数据仍完整，候选 7/7 只读 Replay 全部通过。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`、`patches/expo-image+57.0.4.patch` 中的 `ExpoImageViewWrapperTest` 与 `docs/operator-runbook.md` 的唯一重图 Release 非回退流程 |
| 失败 oracle | 只在主登录态 `WZ_Pixel_API_35` 对 `post-863650-1` 执行同条件流程；以基线三轮中位数及最大自然偏差判断 PSS/帧/重复请求非回退，首次同方向超出后补一轮复测。新增或更早出现的空白、比例/行高变化、重复 identity 请求、OOM、ANR、Fatal、PID 退出或模拟器失去响应直接保持 `OPEN`；新旧均触发独立 `system_server`/AVD 故障时记 `BLOCKED_BY_ENV`。历史绝对 MB 数值只作观察，不撤销已通过行为 oracle 且性能中性的正确性修复，也不用其他图片帖稀释或替代该对象。 |


## `REG-NOTIFY-069` 通知详情失败态前往主题时把点击事件当成主题

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-01/03` |
| 历史症状与根因 | 2026-09-08 用户报告消息通知中点击「前往主题回复」闪退。详情失败态直接把接受可选 Topic 的 `onOpenTopic` 绑定给按钮，Native press event 被解释为 linkedTopic，覆盖解析出的主题并丢失目标回复；Topic route 随后拿不到合法 source。主 API 35 模拟器上第一条已读 NodeSeek 通知详情报「目标评论未找到」，点击该按钮稳定产生 `TypeError: Cannot read property 'label' of undefined`；Native fatal 堆栈从 `ContentSourceDisabledState` 指向 `TopicRoute`，进程退出，确认本次现场与参数缺陷一致。 |
| 修复范围 | 失败态动作显式零参数调用 `onOpenTopic()`，复用现有通知主题与回复定位；富文本主题链接仍传递其自身目标。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 固定详情失败后带 Native press event 的 Topic 参数与 commentId/floor；`tests/ui/notifications/notifications-screen.test.tsx` 覆盖「查看完整主题」的零参数动作。 |
| 失败 oracle | seed `20260908` 修复前两项失败：事件进入 topic 且 targetReply 丢失；单处回调修复后同 seed 两项通过。 |
| 设备证据 | 2026-09-08 在 `WZ_Pixel_API_35` / `emulator-5554` 上先以旧包 `1.3.140/144`、SHA-256 `0058508a939bd5f7435afc6ece477a3657d2822c4208c3c67c9fba225d0bd95f` 复现 Native fatal；当前 dirty 源码以 `:app:assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon` 构建本地验收包，同版本、SHA-256 `fc3c4706ba9c1467de6e46dcf90684c642b4f3b7cbaad6f5a3dcc2aa99edc7bd`，相同开发签名覆盖安装，`firstInstallTime=2026-07-26 16:51:37` 未变，三站登录态保持。相同已读通知失败态按钮进入目标主题；返回后再次进入成功，进程 PID 保持 7164，目标进程无 JS/Native fatal。`NOTIFY-02` 为 `LIVE_PASS`，安装身份为 `APK_SANITY`。 |
| 验证边界 | 目标主题已由作者设为私有，实际进入既有「暂无权限」终态，不能据此宣称设备已定位原回复；commentId/floor 保留由 UI owner 证明。实体手机、其他来源完整链路与私有帖回复定位为 `NOT_VERIFIED`。本地验收包未走正式发布，未递增版本或提交。 |

## `REG-NOTIFY-060` 超时提前释放通知投递队列，迟到摘要可在清理后出现

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 审核在当前代码及 `v1.3.134` 重现：顶层 deadline 与 native 操作共用 Promise race，channel 初始化、present、对账或撤销尚未结束，同身份 lane 与前台 drain 已释放；后续 worker 可继续堆积原生任务。channel 初始化迟到时，补偿 dismiss 先执行，之后 native present 才入队并留下 Store 未记录的摘要。对账使用 fail-fast Promise.all，也会在部分撤销仍 pending 时提前交出 lane。 |
| 当前 owner | `tests/integration/notification-delivery-contracts.test.ts` 连接真实 worker、Store、系统 adapter，仅隔离 Native、存储介质、网络与时间；替换原 worker 的迟到 present mock 用例。前后台装配分别由 `tests/ui/notifications/notifications-runtime.test.tsx` 与 `src/app/notificationBackgroundTask.test.ts` 拥有。 |
| 失败 oracle | seed `1788600000000` 下，修复前六例均因未完成操作提前释放 lane 或提前返回而失败；同 seed 修复后六例通过。顶层 deadline 必须准时返回，同身份下一轮不得启动原生操作；释放迟到 channel/present 后必须依次 present、exact-dismiss，cleanup pending 期间 drain 仍未完成，旧水位和旧摘要保留。已提交的新摘要与静默 baseline 写入仍等待真实结算，不因 deadline 回滚。 |


## `REG-UPDATE-007` 返回或安装失败后完整包被删除并重复下载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-04` |
| 历史症状与根因 | 下载完成后返回、取消安装或安装入口失败，再次操作仍从头下载。旧 runtime 每次重试先删除目标 APK，且把 APK 校验和打开安装器包进同一个失败清理。文件生命周期与一次操作的结果混在一起，页面离开和进程结束后也没有独立恢复记录。 |
| 当前 owner | `tests/ui/more/app-update-runtime.test.tsx`；APK 可信字段由 `src/platform/update/appUpdate.test.ts` 拥有，原生区间与写入结算由 Expo source patch 内 `DownloadResponseTest` 拥有。 |
| 失败 oracle | 修复前两条测试分别观察到重试产生 2 次下载、安装入口失败删除完整 APK（seed 1788579088230）。当前 owner 必须证明同一完整包安装重试不再下载，安装失败仍可离线安装；新增恢复 oracle 固定磁盘偏移、单次范围回退、代理阻断、旧写入结算与迟到回调。设备上的真实流量、进程重启和系统安装确认独立按 `LOCAL-UPDATE-01` 取证，mock green 不替代该证据。 |
| 实际设备证据 | 2026-09-05 在独立 `WZ_LoggedOut_API_35` 覆盖安装同签名开发构建 `1.3.134/138`，fixture 为 `115,828,989` 字节、SHA `1ee558514b6aa6318a0d05495e97a9492713c6a67765716f9245d80ef6446a36`。真实 Expo 链路暂停后磁盘长度稳定；进程结束重开从 `72,881,056` 续传，206 body 恰为剩余 `42,947,933` 字节；断流在 `57,914,494`，续传 body 为 `57,914,495`；带 `39,845,888` 断点收到 200 时覆盖全量，三条完成路径最终 SHA 均相同。错误范围和 416 均返回结构化错误且不改变既有磁盘长度。未知来源权限跳转后重试、系统取消/返回后再次打开安装确认，完整包不变且 APK 新增请求/传输为 0。阻断测试代理后下载失败，服务端没有新增 APK 请求。测试 AVD 卡顿后按授权正常关闭并冷启同一 AVD；结束已覆盖恢复原 APK（SHA `d8a0d71e…`）、未知来源权限 default 并删除测试文件，首次安装时间始终保持 `2026-08-03 16:37:36`。 |
| 证据边界 | `STATIC_PASS`、`UNIT_PASS`、`UI_PASS` 与开发 APK 的 `APK_SANITY` 分别取证；设备 fixture 只证明下载/校验/安装确认链，不挂生产 More runtime，不计作 `DEVICE_REPLAY_PASS`。生产 More 的合格新版 APK 全流程、系统最终安装结果及真实公网断网场景仍为 `NOT_VERIFIED`；受控断流与 UI mock 不替代这些证据。 |

## `REG-PROXY-014` HTTP 请求结束时提前半关闭导致更新响应截断

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01`、`MORE-04` |
| 历史症状与根因 | 普通 HTTP 请求体已经按 Content-Length 发完，relay 仍立即 shutdownOutput；标准 Node HTTP server 收到请求侧 EOF 后结束尚未发送完的响应。设备更新下载因此在首块 65,536 字节后报 ERR_UNABLE_TO_DOWNLOAD / unexpected end of stream，区间请求应有 32,680,613 字节；既有 fixture 用内部 httpAllowHalfOpen 开关掩盖了这个组合缺陷。 |
| 当前 owner | `modules/forum-platform/android/src/test/java/com/wz/reader/network/NetworkProxyRuntimeTest.kt`：真实 socket、GET/POST 与延迟二进制响应；`tests/tooling/app-update-proof-server.test.ts` 固定标准 HTTP fixture，真实更新下载由 `tests/live/agent-live.md` 的 `LOCAL-UPDATE-01` 验证。 |
| 失败 oracle | 修复前 native owner 期待 65,537 字节但只有 65,536；设备 App 与独立 relay 客户端同样在标准 fixture 下截断。HTTP 请求方向按已验证长度停止 copy，不再提前半关闭；响应完成、错误或共享 deadline 仍由连接 owner 关闭，CONNECT 保留半关闭语义与既有隧道测试。 |
| 实际设备证据 | 修复后在用户指定的主 `WZ_Pixel_API_35` 验证标准 fixture：暂停、错误区间与 416 均保留 14,017,856 字节；App 重启后 206 恰传剩余 54,322,277。断流保留 34,170,066，续传 34,170,067；带 12,206,976 断点收到 200 时覆盖全量 68,340,133。三条完成路径 SHA 均为 `94b0199ce7a0ddc47b0f62a4fb93481df8c80cca64c82d8396de1b35e414126d`。代理阻断无新增 APK 请求，权限跳转、返回/取消及离线安装重试不重新下载；权限恢复 default，firstInstallTime 保持 `2026-07-26 16:51:37`。这些是受控入口证据，生产 More 的正式新版下载到最终安装仍单列 `NOT_VERIFIED`。 |

## `REG-UPDATE-008` 更新下载设备验收中偶发单字节丢失待复现

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 原始症状待定位。本轮主设备诊断入口的真实 DownloadTask 下载与续传矩阵通过，未复现历史丢字节；尚无确认根因或针对性修复，继续等待复现日志并保留 SHA 校验。 |
| 2026-10-04 复核 | 主 API 35 模拟器的诊断入口执行真实 DownloadTask：完整下载、暂停后磁盘偏移稳定、进程重启后 206 续传、断流后 206 续传、错误 206 与 416 拒绝且保留偏移、服务忽略 Range 返回 200 时全量覆盖均通过。四次完整落盘均为 49,238,205 字节，SHA-256 与 fixture `4880a3dc…ec339a` 一致。证据为 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38/main-device-proof/download-matrix.json`、`download-matrix.log` 与对应脚本断言；这是本地受控下载链，不是 More 生产公网更新或最终安装验收，不能据此关闭原间歇事故，保持 `OPEN`。 |
| 能力 ID | `MORE-04`、`MORE-01` |
| 历史症状与根因 | 2026-09-05 的 1.3.135 设备验收中，fixture 应为 68,340,133 字节，App 经本地代理续传后为 68,340,122；损坏样本末段多处各缺一字节，脱离 Expo 的 nc 代理对照也少 10 字节。具体根因未确定；不能把另一项已确认的 HTTP 提前半关闭直接当作这 11 字节丢失的根因。 |
| 当前 owner | `dev/app-update-proof/index.tsx`、`scripts/app-update-proof-server.mjs` 与 `tests/live/agent-live.md` 的 `LOCAL-UPDATE-01`；尚无可靠的自动失败 oracle。 |
| 证据边界 | 同一旧 APK 冷启后，完整下载、暂停/重启/206 续传及多轮直接 relay 字节对照均通过；普通/无窗口、慢接收及 Wi-Fi/蜂窝对照未复现单字节丢失。保留历史记录，按用户要求等待后续复现日志，不继续猜测修改、放宽 SHA 校验或增加自动重试。官方 Android Emulator issue 150758736 具有相似症状，只作后续调查线索，不证明本事故归因。 |


## `REG-PROXY-016` 旧 HTTP/2 连接失联后图片取消重开仍无法恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`MORE-01`；诊断展开 `MORE-02`。 |
| 历史症状与根因 | 2026-09-11 用户导出日志中，两张图片在后台恢复后反复取得同一条先前成功的 HTTP/2 连接，没有响应头；同时另一条媒体连接正常。请求因退出/重开在 30 秒前被取消，重启 App 后新连接约 0.4 秒显示图片。日志不能区分静默断网、客户端状态损坏或阻塞写，也不能据此认定 30 秒定时器失效。已复现的网络层缺口见下行。 |
| 已确认缺口 | 实际解析的 OkHttp 为 4.12.0、Media3 为 1.9.0。生产 factory 的 TCP DROP oracle 重现旧连接成功→无响应→取消重开仍失败；仅配置 PING 不能救回被阻塞的 HTTP/2 writer。另一个失败 oracle 证明旧 runtime 已退休时匿名图片仍会在新连接上重发。调用方线程中断未被证明是此次手机事故根因。 |
| 当前 owner | `modules/forum-platform/android/src/main/java/com/wz/reader/network/MediaConnectionHealth.kt` 使用协议 PING 与独立请求头写入 deadline；TLS 关闭直接作用于原始 TCP socket，按 socket 合并关闭，保留平台 TLS 验证。`modules/forum-platform/android/src/main/java/com/wz/reader/network/NetworkProxyRuntime.kt` 的发送前 generation guard 阻止退休图片上下文重发；沿用 OkHttp 原有恢复与图片层有限预算，不清 Cookie/cache、不关闭 HTTP/2、不重启或无条件轮换 runtime。 |
| 失败 oracle | 基线 `24591c27863a855095cbbb5f760276ad9a785aaf` 上静默和阻塞写两用例均在 15 秒失败、仍只有旧连接；PING-only 的阻塞写仍失败。generation guard 前退休图片用例错误成功 1 次，目标为 0 次。canonical owner 为模块内 `NetworkProxyRuntimeTest`，复用 `modules/forum-platform/android/src/testShared/java/com/wz/reader/network/Http2ImageFaultFixture.kt`，测试标题只描述行为。 |
| 受控结果 | 初轮完整原生 83 项通过：明确断连约 2 ms 开始恢复；静默失联约 7.98 秒建新连接、8.00 秒收完小图；阻塞写约 4 秒，HTTPS 约 4.01 秒。两个消费者最终共用同一新连接；实际可能建 3 条 TCP（旧连接、采用的新连接、被 OkHttp 合并丢弃的候选）。另一条正常连接在恢复期间完成 12 秒慢响应；持续下载 33,792 字节耗时 32.23 秒，仍共用原连接；完全断网仅 2 条连接后进入一个失败终态。夹具收尾断言请求、响应体、线程与退休 executor 释放。最终完整原生 84 项、RN wiring 2 项通过；补充退休失败必须交给 Fresco/Glide，不能伪装成消费者取消。 |
| 设备与边界 | 独立 `WZ_ImageRuntime_Test_API35` 的 instrumentation 7 项通过，另有 Cookie 持久化写入/重启读取各 1 项通过。真实 Fresco/Glide HTTPS 小图：静默失联 8.045 秒显示 2 张、写阻塞 4.049 秒显示 2 张；平台确实进入阻塞 raw write。退休场景 8.014 秒收到 2 个失败，显示 0、旧上下文重发 0；普通恢复不重启 App、不更换 runtime。正常开发 APK 只读浏览通过，范围见下行；实体手机仍未复测。时间门限仅用于健康新连接可用的受控环境。 |
| 正常 APK / Live | `APK_SANITY`：开发签名 Release 1.3.142/146，buildId `13abb56e07024a4a81cecda54870b7bd`，SHA-256 `1029b7c5eeb20e34d3696bea3152cd3b7c7a46ef20cd17543ee9b6f8b821fd40`；正常 manifest 不带测试网络配置。同签名覆盖主 AVD 后 firstInstallTime 仍为 `2026-07-26 16:51:37`，网站登录 3/3、来源 4/4、代理关闭与浅色 100% 保留。`LIVE_PASS`：NodeSeek `post-863650-1` 正文多图、1/1381 预览重开、滚动回收、后台至少 10 秒后恢复；linux.do `t/topic/342888` 的 inline 图及 1/93 预览正常。PID 始终 7027，当前进程日志未检出 Fatal/ANR/OOM/连接泄漏。未保存图片或作远端写入。 |
| 最终门禁与未验证 | `STATIC_PASS`：完整 `npm run verify`、相关 tooling/诊断 50 项、typecheck、lint、格式与 diff。`UNIT_PASS`：Native 84、RN wiring 2、Vitest 2412；`UI_PASS`：1356。隔离 instrumentation 7 项及持久化两阶段各 1 项通过。原图升级/失败保底由现有 UI owner 覆盖，本轮正常公网浏览没有单独量化原图升级的网络时序；实体手机原现场、代理开启公网、长时间后台、完整性能矩阵及 tracked `.ad` Replay 为 `NOT_VERIFIED`，不声明 `DEVICE_REPLAY_PASS`。未改版本、提交或正式发布。 |
| 官方依据 | [OkHttp 4.12 HTTP/2 请求头先于 stream timeout](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http2/Http2ExchangeCodec.kt)、[HTTP/2 writer/PING 队列](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http2/Http2Connection.kt)。外部同名异常不能证明手机事故的物理原因；本条以实际生产入口故障实验为准。 |

## `REG-PROXY-015` 图片消费者持有已退休的网络客户端

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`MORE-01`、`ACCOUNT-01` |
| 历史症状与根因 | 关联 `REG-PROXY-010` 的运行时轮换遗漏：Fresco 初始化后同时持有旧 OkHttp client 与其取消执行器；Glide 已创建的 loader/fetcher 仍可持有旧 client，轮换时重新注册不能更新这些对象。旧 executor drain 后，新图片请求报 `executor rejected`，普通重试继续使用同一个失效入口；SVG 创建 Call 与发送之间也存在退休竞态。真实生产 Glide loader 的修复前测试失败，稳定 factory 接入后同一行为通过。手机日志只证明轮换后图片反复失败且重启恢复，缺少旧会话原生异常栈，未证明该事故根因。 |
| 当前 owner | 模块内 `NetworkProxyRuntimeTest`；RN 注入 wiring 由 `patches/react-native+0.86.3.patch` 中的 `ReactOkHttpNetworkFetcherTest` 负责，设备链路由本地模块 `modules/forum-platform/android/src/hostTest` 的 `NetworkImageRuntimeInstrumentedTest` 负责。 |
| 现场证据边界 | 2026-09-08 的 V2EX 后续现场：实体手机保留原进程时，混排图片仍失败且点按重试未恢复；同期 generation 1 的媒体请求返回 200。该入口走 Fresco，失败后另经 SVG 兼容探测请求；现有记录未关联图片显示失败与具体网络 Call，且安装包未输出该图片的原始异常，故成功请求不能排除旧客户端缺陷，也不能据此认定解码故障。实体手机事故归因仍为 `NOT_VERIFIED`。 |

补充诊断时通过实际 RN Android Image 组件确认：0.86.3 的单对象 source 分支遗漏 header 转发，导致 Fresco 收不到来源及图片关联标记。现有 RN patch 已补齐该分支，`tests/ui/shared/android-image-headers.test.tsx` 保留修复前失败、修复后通过的行为证据；Native owner 同时验证标记在传输前移除、响应读取与 lease 终态。该遗漏是已确认代码缺陷，仍不等同于原手机事故归因。


## `REG-TOPIC-155` 行内大图后的文字基线落到段落之外

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`；共享 Android Text 行高与 `TOPIC-01/03` |
| 历史症状与根因 | 2026-09-08，V2EX `t/1240431` 第二张图后「倒是没报什么错……改回去就正常」可复制却不显示，原帖没有白色字体。已安装 `1.3.140/144` 的原生代码在隔离 StaticLayout 中复现：大图的 ascent 被带到后续文字行，既有 CustomLineHeightSpan 只保护含图片的行，随后按固定行高压缩继承的 metrics，产生负 descent；77 px 行框的 baseline 落在行底下方 702 px。扩大诊断画布后可见完整黑字，排除数据丢失、白字与图片覆盖。 |
| 修复范围 | 仅在同段落已有 inline View、当前行不含 ReplacementSpan 时，用当前 TextPaint 和字体样式恢复该行 metrics，再执行原有行高算法。保留图片尺寸、含图行高度、普通紧凑行高和裁切策略。 |
| 当前 owner | `patches/react-native+0.86.3.patch` 中的 `CustomLineHeightSpanTest`，真实 StaticLayout 行框、baseline 和 Bitmap 像素；原有 `TextLayoutManagerInlineViewSizeTest` 继续独立拥有附件宽度。 |
| 失败 oracle | 修复前原生测试失败在后续文字 baseline 不在行框内；修复后大小 attachment、20/28 px 字号以及普通紧凑行高通过。测试不以 REG 命名。 |
| 参考与取舍 | React Native [#48727](https://github.com/react/react-native/issues/48727) 仍记录固定行高与行内图片冲突；[enriched-markdown PR #2](https://github.com/justmakeapp/enriched-markdown/pull/2) 通过限制图片行高回调作用范围解决相近问题。两者不构成本项目直接可回移的修复；本次不采用全局放大行高或关闭 TextView 裁切。 |
| 验证边界 | 原生红绿测试及两类 owner 共 5 项、typecheck、9 个安装补丁检查、干净依赖 forward apply、真实 postinstall 和 reverse apply 已通过。可见主 API 35 AVD 在 `1264×2780 / 560dpi / font_scale=0.9` 覆盖安装本机验收包 `1.3.140/144`（APK SHA-256 `0058508a939bd5f7435afc6ece477a3657d2822c4208c3c67c9fba225d0bd95f`），`firstInstallTime=2026-07-26 16:51:37` 未变。原帖缺失整段已完整绘出，图片预览返回及滚到评论区再返回仍正常，目标 PID 无 AndroidRuntime/libc fatal。实体手机、其他 Android 版本与其他站点完整链路未验证。 |

## `REG-TOPIC-154` 图片诊断随普通重渲染更换请求头导致闪烁

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`、`TOPIC-03`、`MORE-02` |
| 历史症状与根因 | linux.do `t/topic/2750849` 的已显示图片在小幅滚动及预览返回时同时闪空。`useImageLoadDiagnostics` 把 source 对象引用作为 trace 生命周期依赖，等值重建也生成新的 `X-WZ-Image-Trace`；Glide 的 model equality 比较请求头，因此即使 React 图片实例与 URL 不变，也会重新加载、解码。旧的 renderer/attachment 防重挂载修复未被撤销。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx` 的预览回调变化与已显示图片原生请求连续性；`tests/ui/shared/android-image-headers.test.tsx` 的 Fresco/Glide 等值 source、重试及真实参数变化；原帖录屏与 Native trace 独立验证实际重载。 |
| 失败 oracle | 2026-09-08 修复前 seed `-238043428` 的 3 项检查均失败：仅普通重渲染即可让 trace 改变。设备 `1.3.140/144` 上预览返回及 `120px` 滚动各出现同批 6 次 `ExpoImage load new image`，对应 `UPDATE_PROPS`，resize/force 均为 false。修复应按原生参数值及真实 attempt 保持诊断生命周期，不能删除诊断、禁用动图或放宽会话隔离。 |
| 验证边界 | 同 seed 的 3 项失败 oracle 已转绿，相关 UI 222 项、媒体单测 43 项通过。2026-09-08 无窗口 Android API 35 模拟器覆盖安装修复包（`1.3.140/144`，SHA-256 `055341b1d8d26ddb422ec929ed42f2aec0f7da5e53b0ba0bd765766c26bc026c`）并冷启，安装身份与 firstInstallTime 保持不变。原帖静止、小幅 `120px` 滚动、首图及第 4、5 张预览返回的 Native trace 均为 0 次重复加载；第 3–5 张预览切换正常，返回录屏采样中图片连续显示、动图继续播放。实体手机及其他站点完整链路为 `NOT_VERIFIED`。 |


## `REG-NAV-005` 主楼引用误定位、跨主题回复引用丢失目标及评论 ID 定位缺口

专项设备复核还发现：回复深链定位完成后切换倒序，已消费的 route 目标仍阻止新窗口首批读取，页面持续显示「正在读取最新回复」。同一 controller owner 的失败 seed `-1371965630` 固定此缺口；新顺序恢复普通读取，旧命令不重放。经主楼评论 ID 解析的主楼命令也必须使旧回复请求失效，失败 seed `-624460301` 固定迟到窗口不能覆盖主楼。

目标缺失且没有内嵌评论时，禁用的普通 Query 仍为 pending，旧 loading 计算会在错误反馈后一直转圈。失败 seed `1006293921` 固定此终态；回复定位只在实际请求期间显示 loading，失败保留主题及既有错误/恢复入口，不显示定位成功。

后续获准核对打包门禁：新增 `diagnostics` 参数与登录/Cookie 诊断修复的 JS→Native 调用一致，旧签名断言确已过时。已同步 `tests/tooling/release-packaging.test.ts` 三处签名匹配，保留按站删除范围、回调等待、flush 与回读顺序的全部检查；原失败 seed `1789042244534` 的打包及 Cookie bridge 测试 39 项通过，全量 Vitest seed `1789045321102` 的 2411 项通过。完整 `npm run verify` 随后以退出码 0 通过（Vitest 2411 项、UI 1345 项，含静态、文档及类型门禁）。下表的打包失败是修复测试前的历史结果。

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NAV-02`、`NAV-03`、`TOPIC-03`、`NOTIFY-02` |
| 历史症状与根因 | 2026-09-10 在 App 1.3.140 打开 linux.do 主题 2885866，第 9 楼引用主题 2686247 的首帖；点击引用编号或标题，主题已打开却报「linux.do 目标楼层未找到」。引用直接生成 floor=1，绕过已有通知首帖保护；列表虽识别主楼，controller 仍请求排除了首帖的回复窗口，且无内嵌回复时普通评论读取被目标参数阻断。四站入口审查还确认主楼正文跨主题引用不传 post number，以及 linux.do 仅评论 ID 的目标被拒绝；跨主题引用缺少 URL 时还会错误调用当前主题的同号楼层定位。导航改为明确主楼/回复意图，统一主楼识别；跨主题引用保留目标并共享 canonical 身份解析、拒绝冲突 URL，ID 目标按站点返回的真实 post number 读取窗口，显式定位统一核对唯一实体。 |
| 当前 owner | `src/domain/forum/topicLocation.test.ts`、`tests/ui/topic/topic-session-controller.test.tsx`、`tests/ui/topic/topic-reply-filters.test.tsx`、`tests/ui/topic/topic-components.test.tsx`、`tests/integration/source-read-contracts/discourse.test.ts` |
| 自动验证 | `STATIC_PASS`：lint、格式、架构及 23 项架构测试、25 项文档测试、文档引用、typecheck、unused、版本一致性及 diff 检查。`UI_PASS`：75 套件 / 1345 项，seed `-203118996`。本专项领域及四站来源 owner 为 `UNIT_PASS`；全量 Vitest 为 2410 通过 / 1 失败。最终 `npm run verify` seed `1789043593600` 未全绿：原有 `tests/tooling/release-packaging.test.ts` 仍断言 `clearManagedLoginCookies(source: String, promise: Promise)` 旧签名，工作区插件已增加 `diagnostics: ReadableMap` 参数；本任务未改该插件和打包测试，原 seed `1789042244534` 单独重放仍失败。 |
| 设备构建 | 本地 targeted assembleRelease，未运行正式发布；Android API 35，`1.3.140/144`，最终 APK SHA-256 `b0ef6b128e0577b1cd0475458834bc37603402ddfa78d216d4c40c2c097b02e1`。`APK_SANITY`：同包名同签名覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`，未清数据或登录态。 |
| linux.do Live | `LIVE_PASS`：指定 2885866 第 9 楼的引用展开只显示预览；编号与标题均打开 2686247 主楼、无楼层错误，返回保留第 9 楼及展开状态；回复 #6 滚到头部并高亮。深链后切换倒序正常读取最新回复；查找仅剩第 9 楼时点 #6 清除查找并保持 6→5→4→3 倒序。 |
| 四站启动与负向控制 | 最终构建 `LIVE_PASS`：linux.do `2885866/9`、NodeSeek `post-832584-16#155`、V2EX `945124#r_13198746`（第 6 楼）、妖火 `book_re.aspx?id=1560939&classid=177&tofloor=90` 冷热启动到达真实目标；冷启后返回没有重复 Topic 层。NodeSeek 无 hash 页码链接、V2EX `#reply6` 均显示普通主题；linux.do、妖火普通主题也独立验收。 |
| 真实入口补充 | 同轮主修复构建 `LIVE_PASS`：NodeSeek 第 156 楼回复关系 → #154 → 跨页 #149，目标头部可见并高亮；V2EX 945124 第 7 楼正文 `@Pipecraft #6` 定位高亮，正文 `960065?p=3` 只打开主题；妖火 #90 回复关系 → #88 定位高亮。最终构建另复核上行四站精确深链；这些样本不替代指定 linux.do 案例。 |
| 未验证范围 | `NOT_VERIFIED`：实体手机；通知真实点击、已采纳答案真实入口、写后真实回调；四站分别穷举的倒序/筛选/查找、账号切换、快速切换和网络/权限失败组合；V2EX 跨页真实 ID 样本。上述已有共享 UI/来源确定性 owner，Live 写入未执行，写后行为由 mock 证明。本专项未运行 `.ad` Replay，不声明 `DEVICE_REPLAY_PASS`。 |

## `REG-NOTIFY-063` 通知正文缺少标题、强调和段落样式

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`TOPIC-02` |
| 历史症状与根因 | 2026-09-11 查看三站六条公告、回复和私信，公告的段落/图片间距紧贴，标题和强调层级丢失。通知 DetailHtml 依赖 react-native-render-html 函数组件 defaultProps；React 19 的现代 JSX 入口不补默认值，未显式开启 enableUserAgentStyles。旧 UI 测试读取 CommonJS 入口，createElement 补默认值，掩盖了 Android 实际行为。 |
| 修复范围 | 通知共用入口显式启用基础 HTML 样式、受限行内 CSS、em 字号和字体；帖子纯 HTML 样式下沉 ui/content 供两条旅程复用，详情/原消息和气泡保留基础字号并响应阅读行距。气泡、底部对齐、媒体交互与来源协议不变。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` 使用真实源码入口覆盖三容器的标题、强调、斜体、段落、引用、代码、站点类名和深浅主题/字号；`src/ui/content/forumHtmlStyles.test.ts` 固定共享样式；帖子渲染与通知 route 既有 owner 继续验证消费链。 |
| 失败 oracle | seed 2120019208 修复前三容器小标题均与正文同字号；修复后原用例通过，随后扩充深色、放大字号和 serif 字体场景。 |
| 验证 | `UNIT_PASS`：共享样式与边界 9 项；`UI_PASS`：通知 screen/route、帖子渲染和来源门禁共 236 项；`STATIC_PASS`：类型、架构、lint、格式、unused 与文档检查。`LIVE_PASS`：匹配开发签名构建复看 linux.do 公告/系统消息/私信、NodeSeek 回复/私信和妖火原消息，标题/强调/代码/引用与段落恢复，图片/贴纸不越界，滚动和返回正常；`APK_SANITY`：覆盖安装保持首次安装时间与三站登录，当前进程无 JS/Native fatal。 |
| 验证边界 | 深浅主题、130% 字号、serif 字体和阅读行距由真实源码入口 UI 测试证明；本轮设备六样本使用浅色、100% 字号，未跑 tracked Replay 或实体手机，不声明全站富媒体完整验收。 |

## `REG-NOTIFY-064` 通知 Emoji 被拆成居中块图片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`；回归展开 `TOPIC-02` |
| 历史症状与根因 | 2026-09-11 用户指出 Nicolas 的 linux.do 互动通知仍排版异常：文字中间的 Emoji 被单独居中换行。同一内容在关联帖子中连续显示。前一轮六样本没有覆盖文字夹普通 Emoji；通知仅注册了贴纸 renderer，普通 img 仍走 RNRH 块图片默认模型，启用 HTML 样式不能修复其内容模型。 |
| 修复范围 | 通知共用 DetailHtml 用已有 isInlineForumImage 识别规则把 Emoji 转为 textual 附件，复用 inlineMedia 尺寸/对齐与带会话的图片请求；三个正文入口保持前后文字流和字号缩放，加载失败在原位显示 alt。普通图片和贴纸保持原路径，Topic 交互不变。 |
| 当前 owner | `tests/ui/notifications/notifications-screen.test.tsx` 的现有富文本行为用例，在真实 JSX 源码入口覆盖详情、原消息、私信 × 深浅主题/100%–130% 字号的连续文字流、附件尺寸与失败回退；通知 route 和 Topic 渲染既有 owner 回归。 |
| 失败 oracle | seed `-1533022250` 下六种组合均无法在同一 Text 中找到表情前后文字，修复后同 seed 全通过；扩充尺寸和失败回退后，五套相关 UI 共 236 项通过，seed `-255944687`。 |
| 验证 | `STATIC_PASS`：typecheck、架构、lint、格式和 diff；`UI_PASS`：236 项。`APK_SANITY`：1.3.141/145、buildId `4da7bf4b63bc4f05afd65e90d5a62d22`，APK SHA-256 `9c36aecca4f585c6c096dbd7f5dc60d83de9ab8bac5f6d89c142bd667bf10ca7`，同签名覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`，三站登录保留。`LIVE_PASS`：匹配构建重新打开用户指定互动通知，Emoji 回到原位置随文字换行；关联帖子与返回详情核对。 |
| 验证边界 | 本轮设备为 API 35 模拟器、浅色/100%；深色、130% 和失败回退由 UI 测试覆盖，实体机与 tracked Replay 为 `NOT_VERIFIED`；前次六样本通过不代表已覆盖全部媒体形态。 |

## `REG-TOPIC-174` L 站续读等待期间缺少正常帖子头部

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`；共享详情入口展开 `NAV-02/03` |
| 历史症状与根因 | 等待阅读进度或续读定位时，整个 FlashList 被隐藏，独立加载提示没有帖子标题、作者与正常内容间距。缓存登记的一秒是首次续读决策等待上限，提前结算会立即继续，并非固定缓存读取延迟。 |
| 修复范围 | 等待期间复用同一个 listHeader 与内容区样式，显示完整头部和加载反馈；正文仍在定位后显示，隐藏窗口同时屏蔽触摸及无障碍访问。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx` 的 cold/cached/positioning 头部可见性与完成态转换；登记提前结算、超时及晚到位置沿用 `tests/ui/topic/topic-session-controller.test.tsx`。 |
| 失败 oracle | seed `322212551` 下三种等待阶段修复前均找不到可见标题，修复后同 seed 通过；相关两套 UI 249 项通过，随机 seed `311260443`。controller 套件仍输出异步更新未包裹 act 的 warning。 |
| 设备证据 | 2026-09-12 补验 `LIVE_PASS`：主 API 35 模拟器、浅色/100% 字号，同一 L 站历史帖子冷加载与缓存重进均显示正常头部，加载反馈位于其下，随后直接显示续读窗口；缓存等待没有先闪现主楼正文。同签名覆盖安装并保持 firstInstallTime 和三站登录；匹配包、录屏与截图见本机 `docs/emulator-baseline.md`。深色、大字号、实体机与 tracked Replay 为 `NOT_VERIFIED`。 |

## `REG-TOPIC-156` 短主楼手柄微斜拖动停止更新

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`；回归展开 `TOPIC-01/03`、`NAV-02/03` |
| 历史症状与根因 | 2026-09-11，NodeSeek `post-923467-1` 单行主楼长按后水平拖选可更新，加入约 6 px 向下偏移后停更。连续拖选仍依赖 marked row/TextView 的严格命中，行底仅减 0.5 px；轻微越界便直接返回。原生失败 oracle 在预期 offset 4 时仍为 3。该命中中断已确认，不代表所有掉帧均由它引起。 |
| 修复范围 | 严格长按入口保留；接管后的端点统一按可见、有效映射的最近文字行求解，保留抓取偏移、字符边界与回收恢复。MOVE 按帧合并，UP 结算；拖动期间续期隐藏 Android ActionMode，结束后更新最终菜单。纵滚继续经 FlashList，横滚通过 Native 事件与 Reanimated 更新既有共享 offset，并校验 revision、dragId 和独立 viewport 身份。 |
| 当前 owner | `ForumContentSelectionViewTest.kt` 的微斜拖选、跨行组合字符及既有同帧像素行为；`ForumSelectionDocumentTest.kt` 的文档边界；`tests/ui/topic/topic-rich-text-selection.test.tsx`、`tests/ui/topic/topic-table-rendering.test.tsx` 的生命周期与共享横滚；`dev/forum-selection-proof/index.tsx` 独立验证真实 Expo → Reanimated → ScrollView 和 FlashList 回收。 |
| 自动验证 | `UNIT_PASS`：Native JVM 27 项、相关 Vitest 110 项。`UI_PASS`：选择/表格及主题/导航六套件共 298 项。独立 API 35 AVD instrumentation 最终 46 项通过，包含反向挂载等距裁决与手柄像素专项；保留逻辑 offset、手柄误差不超过 2 px、正文 bounds/baseline 和回流首帧 oracle。类型、unused、lint、格式、架构、文档及 diff 按本次范围检查。 |
| 设备证据 | 原帖 `LIVE_PASS`：同位置手柄向右及向左加入 6 px 偏移均连续更新，Back 取消选区且留在原帖，正文 bounds 与修改前一致。独立 fixture：自动横滚后两个同表片段实际 x 同为 -279.2 dp，无关表仍为 16 dp；松手位置稳定，普通横滑接续当前 offset。纵向持握经过 60 个段落及回收，返回首屏选区和起点手柄恢复；持握 8 秒菜单持续隐藏，松手恢复。此轮不是 tracked `.ad` Replay，不声明 `DEVICE_REPLAY_PASS`。 |
| 主模拟器补验 | 2026-09-11 按用户要求在 `WZ_Pixel_API_35 / emulator-5554` 当前正式入口开发包只读复测：末端手柄分两段向右并加入 6 px 向下偏移，高亮依次扩展后可缩回单字；起点手柄向左扩展正常。长按不松手继续拖选正常，抓住手柄持握 8 秒菜单持续隐藏，UP 恢复。拖到回复区仍只选择主楼；Back 取消后普通纵滚及返回首屏正常，正文 bounds 保持 `53,753,975,63`。回复长按仍显示「评论已复制」且不出现主楼手柄；本轮未读取剪贴板内容。未重装、清数据或改变设备配置；此补验为该原帖的 `LIVE_PASS`，不扩大为主模拟器宽表/长文或完整性能矩阵通过。 |
| 性能边界 | 同一主 AVD、同 Release 构建类型、同原帖，三轮水平往返 gfxinfo 帧耗时 P95：修改前 23.6–24.3 ms，修改后 23.2–23.4 ms；修改后微斜为 23.3–23.7 ms。旧微斜因停更几乎不产帧，不能拿它作流畅度基线。该短帖路径未见持续回退；跨行、自动横纵滚、菜单恢复的独立性能对照及实体机触感/高刷新率仍为 `NOT_VERIFIED`，不声明完整性能矩阵通过。 |
| 安装与交付 | `APK_SANITY`：本地开发 assembleRelease 1.3.141/145，SHA-256 `375cd2316d300bc21bd523d7209a6bb8ce3e587e78b4f9cddb591549892123dc`；同签名覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`，当前 PID 无 JS/Native fatal。未执行版本递增、正式 release、提交或远端写入。 |

## `REG-WRITE-091` 长图回复使用块间光标且上传后丢失可输入位置

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05`；共享 NodeSeek、linux.do 结构化编辑器 |
| 历史症状与根因 | 2026-09-12，NodeSeek 用户「凡想世界」的「测试」帖第 28 楼包含四张长图，进入编辑显示横向 GapCursor；上传走独立插入分支，选区停在图片块上，共享块插入选区又会跳过后续旧图。只处理插入时的滚动也遗漏图片自然尺寸和视口变化；设备收起全屏后视口底为 320 px，光标仍在 700–718 px。 |
| 修复 | 共享 `ComposerTextCaret` 将活动块间选区转为原位置的真实文字段落，并统一观察文档与视口尺寸，在编辑期间跟随当前文字光标，触摸/滚轮浏览时暂停，失焦不滚动，销毁时释放。上传复用共享块后文字选区，禁止跨越后续旧图；不以 CSS 伪装 GapCursor，不维护独立图片加载监听。真实空段落可体现为 Markdown 空行，但不重复生成或进入用户撤销历史。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts`；Bridge wiring 为 `tests/ui/topic/structured-reply-composer.test.tsx`；真实交互入口为 `tests/live/agent-live.md` 的 `LIVE-WRITE-05`。 |
| 失败 oracle | 修复前两站上传用例都停在 doc 而非 paragraph（seed `1789215817979`）；旧图前插入后文字越过旧图（seed `1789216028461`）；块间进入没有普通段落（seed `1789216219170`）；仅监听上传图片无法响应布局/视口尺寸变化（seed `1789217026318`）。当前同一 owner 覆盖正常输入、图序、撤销、模式往返、布局跟随及用户浏览暂停。 |
| 设备证据 | 同一 API 35 主 AVD 内确认图前及实际点击两图间隙后的原生输入，不吞图。布局验收开发签名包 `1.3.142/146`，SHA-256 `e62965d73c3a066179c958de091e651f9974e051c530836fecd75d66b43468e4` 覆盖安装后 firstInstallTime 保持 `2026-07-26 16:51:37`，登录 3/3。当前 WebView 用已有图片地址模拟一次上传成功回调，两张新增 1264×2780 图片由零高度完成加载，文字光标始终在末图后；收起全屏后光标 300–318 px 位于 320 px 视口内。实际手动 pan 后模拟图片撑高，scrollTop 保持 4802.286，未拉回旧光标。测试编辑全部取消，重开为原四图且无测试文字或临时 URL，当前 App PID 未检出 JS/Native fatal。 |
| 验证边界 | 原帖本地编辑交互为 `LIVE_PASS`，上传回调与尺寸变化为真实 Android WebView 的本地受控证据；没有上传新文件、发送或保存远端回复，不声明真实上传服务通过。最终相关 Vitest 48 项通过（seed `1789217515717`），Composer Bridge UI 11 项通过（seed `-1491605931`）；实体手机、可见输入法键盘、linux.do 实时站点和完整设备 Replay 为 `NOT_VERIFIED`。 |
| 收口边界 | 补验替换文档第一张图时，ProseMirror `createParagraphNear` 默认在图前建段落；共享块后聚焦改为在选区末端明确插入段落。失败 seed `1789217492470` 红绿通过，默认随机套件随后通过。最终包 SHA-256 `cb0784219d678b994fb1d3d0a5e955cc9b7394c36828ff508990d089af535297` 已覆盖主 AVD，版本与 firstInstallTime 不变。上行设备几何数据取自该末端边界收口之前的布局验收包；替换首图边界由实际编辑器自动测试证明，最终包安装启动单列为 `APK_SANITY`，不把它扩大成该边界的 Live 证明。 |

## `REG-WRITE-078` 长图回复编辑时图片未完成加载导致正文区域空白

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05`；共享 NodeSeek、linux.do 图片节点 |
| 历史症状与根因 | 2026-09-12，在 NodeSeek 用户「凡想世界」的「测试」帖第 28 楼，退出帖子后重新进入编辑，自然捕获四张图片 complete=false、naturalWidth=0、DOM 高度全部为 0，而 Markdown 已完整存在。只延迟当前编辑器图片请求 12 秒，稳定出现整块空白。裸 img 没有加载/失败反馈，图片预览未完成被表现为正文不存在；本次未复现 INIT 丢失或原文真正为空，不把所有间歇空白归为此原因。 |
| 修复 | `ComposerImage` 在共享 Image NodeView 内持有加载状态：未完成时显示 72 px 占位，失败可单张重试原 URL，成功显示图片。显示状态不写入文档，不重载整个编辑器；替换尝试和销毁时释放旧图片回调。沿用 Image 的 Markdown 编解码和 `ComposerTextCaret` 的布局跟随。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts`；原帖现场与受控图片请求验收归 `tests/live/agent-live.md` 的 `LIVE-WRITE-05`。 |
| 失败 oracle | seed `1789218874890`：两站实际编辑器加载图片时都没有可见反馈，2 项失败；同一行为用例修复后通过，覆盖失败、单张重试、旧尝试回调、Markdown/undo 不变和源码往返保留图片节点。 |
| 自动验证 | `UNIT_PASS`：相关 Vitest 50 项（seed `1789218937933`），最终类型断言和占位样式分别补跑对应行为。`UI_PASS`：Composer Bridge 11 项（seed `-103937472`）。`STATIC_PASS`：typecheck、相关 ESLint/Prettier、architecture、docs 与 diff 检查。 |
| 设备证据 | 开发包 `1.3.142/146`、SHA-256 `e0739eec80b6877a1670ad922b7a7558b7003c89a18cb4f27ee59902a7200aa9` 的原帖本地编辑为 `LIVE_PASS`；Android WebView 受控 12 秒延迟时四个占位均为 72 px，原文 564 字符；自然完成后四图均为 1264×2780，光标仍在 320 px 视口内。受控四个图片请求失败后，原生点击末图重试只增加一个请求，仅末图 DOM 被替换且成功；Markdown 完全相同、undo=false，源码/富文本和全屏切换保留结果。上述受控证据不等同外部图片服务可用性保证。 |
| 验证边界 | 没有上传新文件、发送或保存远端编辑；所有本地编辑取消，干预只限当前 WebView 图片请求，不清全局缓存。实体手机、linux.do 实时站点、真实上传服务与完整设备 Replay 为 `NOT_VERIFIED`。 |
| 最终包收口 | 最后仅提高占位对比度并增加底色/边框，重新生成 bundle 后构建包 SHA-256 `50a8a2a28f354458f4fa68434a4df4e54358f598426399deb99acca527d705a4`，同签名覆盖安装，firstInstallTime 仍为 `2026-07-26 16:51:37`、登录 3/3，当前 PID 无 JS/Native fatal（`APK_SANITY`）。此包重复原帖受控 12 秒延迟，四个占位均为 72 px、opacity=1，之后四图自然加载成功；原生输入在末图后，光标 top=297.214、bottom=315.119，处于 320 px 视口。取消重开后仍为原四图、564 字符且无测试文字。失败重试证据取自上一行所列交互包，最终包此项未重复；两包仅上述 CSS 不同。 |

## `REG-WRITE-079` 妖火缺少回复验证字段且把拒绝提示当成成功

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`；共享 `TOPIC-03`、`ACCOUNT-01/02` |
| 历史症状与根因 | 2026-09-14，原生回复后关闭编辑器并跳到旧末楼，原站没有新回复。实际 POST 返回 HTTP 200 和「页面已过期，请刷新后重试」；App 更多内的已登录原站表单包含 `__CSRFToken`，原生 request 缺少该字段，结果解析又仅排除少数失败词。补齐字段后真实写入成功，但当天原站成功文本已是「回复成功！」加奖励/跳转尾文，旧「评论成功」判断不足。 |
| 当前 owner | `src/sources/yaohuo/actionClient.ts` 每次提交前读取同站、同帖表单，仅携带当前验证值并严格确认已知成功响应；既有 `withFetchGuard` 在每次网络请求前后复核写票据及结束状态。协议归 `src/sources/yaohuo/actionClient.test.ts`，草稿、刷新和身份变化接线归 `tests/ui/topic/topic-actions-controller.test.tsx`。 |
| 失败 oracle | 缺字段及拒绝提示的 9 个行为在 seed `1789377849494` 下失败并转绿；实际新成功文本在 seed `1789378335360` 下失败并修复。 |
| 设备证据 | 用户授权在生日帖 1581016 回复至首次成功。修复 token 的开发包 `20585d44365b64d5e5ea191f1c642d796bcbb59603a64fdef95a732101893f27` 仅提交一次，17:29 原站第 112 楼已出现当前账号回复，SystemUI ToastLog 留下真实成功提示。此后零新增提交；最终包在原生列表只读核对该楼正文、作者和后续楼层。 |
| 验证边界 | 真实 POST 写入为 `LIVE_PASS`；最终成功提示识别、关闭编辑器及写后刷新由真实 adapter 接入 UI 的受控响应证明（`UI_PASS`），不冒充最终包重复 Live 提交。未发布，保留数据覆盖安装。 |

## `REG-TOPIC-163` 重叠回复页和备用身份碰撞破坏列表唯一性

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`；共享 `NAV-02/03`、`WRITE-01` |
| 历史症状与根因 | 用户报告写后向上加载出现空白。已确认分页合并直接 flatMap，重叠页产生重复实体和虚拟列表 key；没有 commentId 时仅以 floor 作 key，不同作者/时间的同楼层也发生碰撞。用户日志未包含直接的重复 key 报错，不能把所有空白都归为此原因。 |
| 当前 owner | `mergedReplyPages` 按共享 `replyKey` 去重，不改原页、游标与顺序；备用 key 纳入作者身份和发表时间，正文更新不换 key，不吞同楼层的不同回复。Canonical owner：`src/features/topic/model/replyPagination.test.ts`、`src/features/topic/model/replyListModel.test.ts`；Topic 会话、列表和媒体 UI 回归展开。 |
| 失败 oracle | seed `1789378785650`：正反序跨页重叠和不同实体同楼层共 3 个行为失败；修复后 key 唯一，所有内容保留，原页游标不变。 |
| 设备证据与边界 | 最终包 `4f45385ba8c6074c5ba0627b8b3b1a3152f3c540c9ddcd9fa8ba732c2e66e044` 在 1581016 定位第 112 楼后连续向上到第 78 楼，跨页可见内容、楼层与位置正常（`LIVE_PASS`）。同页动态插入造成的精确重叠时序由受控 oracle 证明；未声称一对一复现用户历史空白，其他来源现场与实体手机为 `NOT_VERIFIED`。 |

## `REG-TOPIC-164` 视频播放结束重新覆盖加载海报和转圈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`；共享所有原生正文视频 |
| 历史症状与根因 | 1581015 的 12 秒视频播放结束后持续转圈。Expo Android 将无错误的 STATE_ENDED 映射为 idle，同时先发送 playToEnd；App 把 idle 统一当加载，重新覆盖海报与 spinner。 |
| 当前 owner | `ForumContentVideo` 订阅结束/重新播放事件，把结束后的 idle 投影为 ended，重播恢复正常状态；按播放器实例移除订阅并重置状态。`tests/ui/topic/topic-image-loading.test.tsx` 现有原生控件 owner 覆盖加载→就绪→结束→重播，不新建播放器或丢失控件。 |
| 失败 oracle | seed `-417587487` 下实际 ended 事件与 idle 顺序导致仍有 ActivityIndicator；修复后通过。 |
| 设备证据 | 最终包在原帖自然播放两次至 00:12/00:12，保留末帧与原生控件，没有海报和转圈重新覆盖，重播正常（`LIVE_PASS`）。此前模拟器图形服务卡住后按授权冷启动同一 AVD，无清数据/快照恢复。 |
| 本轮共同验证 | `UNIT_PASS`：7 文件 177 项，seed `1789378963191`。`UI_PASS`：回复 action/composer 108 项，seed `941882150`；Topic 会话/列表/正文/媒体 411 项，seed `821661515`。`STATIC_PASS`：typecheck、相关 lint/format、architecture、docs 和 diff。`APK_SANITY`：1.3.143/147 开发签名 x86_64 包，firstInstallTime 保持 `2026-07-26 16:51:37`，当前 App 无 JS/Native fatal；完整 tracked Replay、其他来源现场和实体手机为 `NOT_VERIFIED`。 |

## `REG-WRITE-080` 帖子回复成功后共用富文本编辑器残留已发送正文

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/05`；NodeSeek、linux.do 共用 Composer |
| 历史症状与根因 | 用户报告回复别人后再次打开回复仍有旧正文。提交 controller 已清空宿主草稿，但 `StructuredReplyComposer` 只对 private-message 的空内容执行 INIT；帖子 reply 则发送 insert-markdown 空串，没有清除 WebView 文档。同帖重开继续使用同一实例，因此正文残留。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` 合并原私信清空用例，覆盖两站楼层回复、收起保留、提交清空、同实例重开与后续追加；`src/ui/composer/editorRuntime.test.ts` 验证两站富文本/源码实际 DOM 和下一次快照为空。运行修复仅移除共享清空分支的私信限定。 |
| 失败 oracle | seed `-1573364675` 下私信通过，两站帖子回复均收到 insert-markdown 空串而非清空 INIT，2 项失败；修复后通过。 |
| 自动验证与边界 | `UI_PASS`：Composer、topic actions、topic session 220 项，seed `969286052`。`UNIT_PASS`：实际编辑器 50 项，seed `1789379573607`；首轮既有 LinuxDo 表格工具栏可见性断言失败，同 seed 重放通过，未修改该工具栏行为。按用户要求仅代码与本地测试判断，本轮没有真实回复、设备安装或发布；本次修复的设备/Live 为 `NOT_VERIFIED`。 |


## `REG-FEED-030` 二级分类栏横滑被来源翻页抢占且选择后跳回起点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02/04`；共享分类控件展开 `SEARCH-01`、`LIBRARY-01/02/03`、`NOTIFY-01`、`TOPIC-03`、`MORE-01` |
| 历史症状与根因 | 在二级分类栏左滑会切换一级来源；最右侧来源的隐藏分类也无法滑出。共享 `PillRail` 使用普通 RN ScrollView，没有参与 RNGH 与 Compose Pager 的触摸协调。恢复横滚后又确认 V2EX/NodeSeek 的排序按钮显隐会切换组件树，分类栏重建并跳回起点，选中项消失在屏外。旧设备 owner 允许二级栏横滑换来源，漏检了隐藏分类是否可达。 |
| 当前 owner | `PillRail` 复用 RNGH ScrollView；Feed 保持同一分类栏实例，仅切换排序按钮和布局。`scripts/check-feed-boundaries.mjs` 替换宽松横滑断言，验证四站实际位移、反向回移、两端边界、隐藏项点击后仍可见及来源不变。既有 Feed/Library/Topic UI owner 按行为与所属 handler 验证，不再写死全页面手势数或动画帧数。 |
| 失败 oracle | 原包的首次 V2EX 左滑使来源变成 linux.do；只恢复手势的中间包在「隐藏分类点击后可见」断言失败。最终包四站逐项通过。等距反向拖动不必精确抵消原生惯性，owner 继续拖至起点后独立检查边界，避免把剩余几像素滚动误报为产品 Bug。 |
| 设备证据与边界 | 保留数据覆盖安装，版本与首次安装时间不变；四站分类为 `LIVE_PASS`。中途系统截图与无障碍采集超时，保留磁盘冷启动同一 AVD、临时使用软件渲染后继续验收；具体 APK、手势回归结果和环境记录只保存在本机 baseline。未修改来源偏好、账号、远端内容或执行发布，实体手机仍为 `NOT_VERIFIED`。 |

## `REG-FEED-031` 纵向滚动后正文慢横拖错误回弹

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02` |
| 历史症状与根因 | V2EX 列表先纵滚，再用 800 ms 横拖约 68% 屏宽，页面实际跟手移动约 66%，正常松手却回到原来源。原包同样失败。Compose 1.7.8 的 `dragDirectionDetector` 未结束 consumed CANCEL，下一次 UP 与前次纵滚的 DOWN 配对；原生日志确认本次 734 px 横移被算成 151 px，并带入上次纵滚的 -636 px。120/350 ms 快滑依赖速度归位，未暴露该错误位移。 |
| 当前 owner | `patches/react-native-pager-view+9.0.4.patch` 使用本次 MotionEvent 的按下/松手位移，在原生 fling 入口修正 `PagerState.upDownDifference` 后委托 `PagerDefaults.flingBehavior`；保留原生阈值、速度、动画、取消路由与 JS 最终选择协议。兼容代码依赖锁定 Compose internal 字段，升级时重验，并在上游正确处理取消后删除。 |
| 失败 oracle | 既有 `scripts/check-feed-gestures.mjs` 的 `horizontal`：列表中段、纵滚取消后、双向 120/350/800 ms，断言实际换来源且完整归位。修复前 800 ms 向右失败，修复后双向通过；短慢拖、回拖、连续交接、惯性、系统取消继续由同一矩阵及既有独立 owner 验证。临时位移探针只留本机证据，不进入最终补丁或 APK。 |
| 验证与边界 | 定向 `LIVE_PASS` 已确认原失败动作双向恢复；补丁在干净依赖上的 forward apply、postinstall 与 reverse check、相关单测/UI/typecheck、匹配 Release APK 覆盖启动均通过。完整手势回归的逐项结果、精确 APK 与设备身份只保存在本机 baseline；模拟器自动注入不代表物理手机的主观手感。 |

## `REG-WRITE-081` linux.do 回复提交后串行重复回读

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01`、`TOPIC-03`；共享 action controller 展开 `WRITE-*`、`ACCOUNT-01` |
| 历史症状与根因 | 用户反馈回复他人成功后等待较久。代码将已确认的 POST 响应丢弃，先刷新详情，再发现末尾，正序另读取目标窗口；可编辑回复还可能逐条补原文。已确认重复请求，未测量用户设备历史耗时。 |
| 当前 owner | `src/sources/discourse/actionRequest.test.ts` 校验提交目标；`tests/integration/source-read-contracts/discourse.test.ts` 固定含编辑原文的单次 near-post GET；`tests/ui/topic/topic-actions-controller.test.tsx` 固定确认目标传递和 partial 提示；`tests/ui/topic/topic-session-controller.test.tsx` 合并旧末尾发现 owner，覆盖正倒序单窗口、并发他人回复、失败保留、同目标重试与排序切换。 |
| 失败 oracle | seed `1806424205` 下正倒序两项均因写后额外读取主题而失败；修复后单窗口通过，且阻止窗口应用后由未结算入口状态触发额外读取。 |
| 验证边界 | 本机自动测试验证请求与状态契约；未执行真实回复、设备安装或发布，设备和 Live 为 `NOT_VERIFIED`。 |

## `REG-NOTIFY-065` 通知已读后外层两个红点滞留

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/02/03`；共享 More 入口与底栏红点 |
| 历史症状与根因 | 原站已读后返回，列表与外层未读 snapshot 分离；详情标记回调只在成功且 effect 仍有效时刷新，返回取消无法撤销已生效的服务端已读，却会跳过对账。列表下拉刷新只刷新列表，重新进入中心只切轮询频率，旧 snapshot 可持续保留到轮询或重启。 |
| 当前 owner | `NotificationRoute` 在逐条/批量已读结算后核对列表和 snapshot，并在消息中心获得焦点、下拉刷新时同步 snapshot。复用 runtime 的当前账号读取门禁和总数投影，不做本地减一或进入即清空。 |
| 失败 oracle | `tests/ui/notifications/notifications-route.test.tsx` 挂载真实 runtime、gateway、adapter、QueryClient、Store 和导航，仅控制 HTTP/平台边界；旧代码在返回取消、下拉刷新与重进中心后仍读到 2，修复后按原站变为 0/1，原站仍为 2 时保留。同 owner 覆盖正常确认和批量已读中返回；既有 More/AppNavigator owner 验证两个入口投影。 |
| 证据边界 | 修复前后 UI oracle 已确认；主模拟器当前暂无未读，真实逐条/批量已读与双红点消失的 Live 场景仍为 `NOT_VERIFIED`，只读设备验收另记本机 evidence。 |

## `REG-WRITE-082` 异步准备后写请求越过已失效票据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/03/04/05/06`、`ACCOUNT-04`；linux.do 阅读上报 |
| 历史症状与根因 | 审查后受控 HTTP 复现：CSRF 或代理准备未完成时身份/epoch/来源/认证 surface 变化，普通 action 缺少发送点复核；阅读 sender 的双向守卫还会在已确认响应后抛取消。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx`、`tests/ui/more/network-proxy-controller.test.tsx`、`tests/ui/account/nodeseek-check-in-controller.test.tsx`、`src/sources/linuxdo/reading.test.ts`；本地 Symbol 发送前回调透传并在底层 fetch 前剥离，模板、上传和妖火同类入口一并检查。 |
| 失败 oracle 与边界 | action 4、proxy 1、reading 3 项修复前失败；对应回归通过，既有 serverConfirmed、未知写结果不自动重试保留。无真实发帖/编辑/上传/阅读补发验收，Live 为 `NOT_VERIFIED`。 |
| 2026-09-17 遗漏补齐 | NodeSeek Topic 共用 action 与独立签到入口接入同一 `withRequestBeforeSend`。真实 client 经真实代理等待后，身份/epoch/来源/认证界面四类变化 × 两入口的 8 个反例修复前均发生 POST，修复后均为零；正常各一次。签到过期结果不再通知新身份，保留诊断与 serverConfirmed；未执行真实签到或发帖。 |

## `REG-ACCOUNT-052` NodeSeek hidden WebView 截断合法 JSON

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`USER-01` |
| 历史症状与根因 | JSON 正文误用挑战检测的 12k 文本采样，超过该值的合法 JSON 不完整；真实注入脚本 3 项红例确认。 |
| 当前 owner | `tests/integration/hidden-browser-scripts.test.ts`；正文完整读取，挑战结构检测仍有界，900,000 字符 envelope 不变，超限明确失败且只结算一次。 |
| 证据边界 | Unicode、正常 JSON 中 CF 字样、挑战页面及 linux.do 同类回归通过；真实站点长响应的设备/Live 独立验收。 |

## `REG-TOPIC-167` Topic 手动验证未接入当前详情恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/04`、`ACCOUNT-02` |
| 历史症状与根因 | 固定 identityPending=false 的分支不能完成手动验证接线；普通 Topic 完成首次尝试后 Query 不保持 active，直接用 active Query 判断恢复会丢失仍在当前页面的恢复。 |
| 当前 owner | `useTopicController`、Account verification；可选本地 isCurrent 使用已有 route/身份/请求归属。`tests/ui/topic/topic-route-verification.test.tsx` 真实 Route/Account/Query/导航覆盖取消重开、成功一次、后台/换号/停用后不恢复。 |
| 证据边界 | 定向红例和组合回归通过；保留普通返回不新增访问登记，未引入生命周期状态。原站人工挑战流程的 Live 不由 HTTP fault injection 代替。 |

## `REG-NOTIFY-066` 通知初始化失败后无法恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03` |
| 历史症状与根因 | 存储恢复或权限探测拒绝后没有安全的显式初始化重试入口，错误容易落入不适用的登录提示。 |
| 当前 owner | `tests/ui/notifications/notifications-runtime.test.tsx`、`tests/ui/notifications/notifications-route.test.tsx`；存储和权限分别结算，ready 只确认存储，重试复用 Promise，卸载不提交。存储失败禁写，权限未知禁系统投递/注册。 |
| 失败 oracle 与边界 | runtime 2 项红例；原设置/水位、权限拒绝与异常、重复点击、卸载迟到结果及实际按钮回归通过。真实 OS 异常分支为 `NOT_VERIFIED`。 |

## `REG-USER-011` 用户活动读取失败被包装成成功空态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01/02`、`ACCOUNT-01`、`NOTIFY-03` |
| 历史症状与根因 | 宽 UserProfile getter 并行读取资料与活动，活动异常被空列表吞掉，controller 又播种成功；身份消费者也需拼造 topics。 |
| 当前 owner | 现有 gateway/adapter 拆分身份、资料、活动；`src/sources/sourceUserRead.test.ts` 与 `tests/ui/user/user-activity-reads.test.tsx` 用四站已有样本结构和故障注入覆盖独立成功/失败/重试、真空、刷新保留和请求数量。 |
| 失败 oracle 与边界 | 四站失败活动 4 项红例及妖火轻量身份红例；去掉测试专用整对象假成功路径。字段、游标及必要的妖火资料依赖见取证记录，未声称当天协议或性能 Live 已验证。 |

## `REG-WRITE-083` 一致分页重叠回复被误判为不可编辑

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`WRITE-02/04` |
| 历史症状与根因 | 同一回复在多个窗口一致出现时，数量大于 1 被直接视为冲突。 |
| 当前 owner | `tests/ui/topic/topic-actions-controller.test.tsx` 的提交/上传同一矩阵；所有观察都须明确 canEdit=true 且既有身份/作者/内容/日期一致，未知或否定权限继续拒绝。 |
| 证据边界 | 一致重叠红例转绿；冲突、消失、跨 epoch 与未知权限保持拒绝。未新增版本协议或通过显示去重丢弃否定观察；没有真实编辑/上传。 |

## `REG-WRITE-084` NodeImage 拒绝微信原图且被误报为登录验证

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04`、`NOTIFY-02` |
| 历史症状与根因 | 2026-09-16 用户日志两次 NodeImage HTTP 400，截图可上传而微信原图失败；共享入口只相信 picker MIME/后缀，没有统一实际编码。服务端文件校验文案中的「验证」又被诊断归为登录验证。 |
| 当前 owner | `tests/integration/image-upload.test.ts` 固定原生准备、20 MiB 输入/输出检查、取消、释放及错误分类；Topic 身份/Key 变化由 `tests/ui/topic/topic-actions-controller.test.tsx` 拥有，私信发网前保护与 NodeImage 401 不污染站点会话由 `src/sources/notificationGateway.test.ts` 拥有。 |
| 修复与验证边界 | SDK 57 原生 ImageManipulator 输出原尺寸、质量 100 WebP 缓存副本，实际 GIF/WebP 文件头保留原文件。API 35 隔离 Release Hermes 调用生产准备函数，7 类本地真实文件的编码、尺寸、透明度、EXIF 方向、原图保留和副本清理通过；没有真实上传。微信失败原始样本及原站接受结果为 `NOT_VERIFIED`，不能用合成文件替代。 |

## `REG-WRITE-085` linux.do 上传短地址在编辑器内始终加载失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05` |
| 历史症状与根因 | 同日日志 linux.do 上传 HTTP 200；Discourse 的 `upload://` Markdown 地址被直接传给实际 img 元素，浏览器无法加载该协议。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 拥有预填、上传插入、源码往返、失败重试与非法地址；`tests/integration/composer-upload-preview.test.ts` 从真实上传响应解析、Markdown 生成进入真实 Composer NodeView，固定 HTTPS 显示地址且快照仍为原短地址。 |
| 首轮证据缺口 | 首轮仅将短地址拼接为 `short-url` 路由，确定性测试通过但未完成设备显示验证；后续真实草稿反证该方案不完整，不能把 HTTPS 字符串断言当作修复完成。 |
| 真实根因与最终修复 | 2026-09-16 获准真实上传后，在模拟器原站 WebView 的已有登录会话上传测试 PNG，HTTP 200 同时返回短地址和 CDN URL。隔离编辑器请求 `short-url` 报 `ERR_BLOCKED_BY_ORB`，同图原站读取则 200 跳转 CDN；公开短路由响应为 Cloudflare 403。最终通过既有 Bridge 和站点登录通道调用 Discourse 只读 `POST /uploads/lookup-urls`，仅给图片元素设置返回的 HTTPS CDN 地址。文档和 Markdown 保留短地址；不改变 Composer origin、CSP、第三方 Cookie 或导航策略，不持久化地址映射。异步迟到结果不能更改已销毁/替换节点，解析失败可显式重试，图片重试复用成功解析地址。 |
| 最终 owner 与验证 | `tests/integration/composer-upload-preview.test.ts` 从上传响应、Markdown、真实 NodeView、站点查询 client 到 Bridge 返回形成完整链路；初次缺少查询请求的红例转绿，并拒绝非法短地址、不匹配/不安全返回。`editorRuntime` 拥有失败重试和源码往返，`structured-reply-composer` 拥有实际 Native Bridge 转发，Topic/私信沿原会话守卫接线。相关 Vitest 及 4 套 UI 213 项（seed `-581831114`）、typecheck、lint、架构通过。 |
| 设备验收 | `LIVE_PASS`：同一 API 35 模拟器覆盖安装最终开发签名 APK，首次安装时间与登录态保持。既有失败图片实际解码宽度 1080；App 系统文件选择器再次真实上传 96×64 测试 PNG，显示彩色图块且真实 img 完成解码。源码仍为短地址，新增测试草稿内容已移除，原图片保留；没有发送回复、保存帖子或私信。原站和 App 上传共两次，服务端可能保留未引用上传文件；物理设备与 L 私信实际显示为 `NOT_VERIFIED`。 |

## `REG-WRITE-086` 收键盘时共享输入器工具栏瞬间突跳

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/05`、`NOTIFY-02` |
| 历史症状与根因 | API 35 同设备原版半屏录屏出现约 30.7 ms、308 px 的突跳。窗口 resize 与弹层 pan 模式、伪造 WebView 焦点以及重复位置回调聚焦混用。模式统一后的设备反证显示：边到边窗口只提供 IME insets，配置本身不足；通过 JS onLayout 传递新高度又出现约 130 ms 延迟后的追赶。 |
| 当前 owner | `tests/ui/topic/composer-keyboard-viewport.test.tsx` 固定原生 IME 帧到共享可见高度及关闭完成后释放；`tests/ui/topic/topic-components.test.tsx` 固定每次打开只聚焦一次。回复、编辑、私信继续复用共享 ComposerBottomSheet。 |
| 修复与验证边界 | 窗口/弹层统一 resize，现有 Reanimated 原生 IME 帧直接更新 UI 线程可见容器高度，删除伪造输入焦点和第二次位移补偿。同设备最终 APK 的 L/NS 回复富文本/源码、半屏/全屏、连续开合和系统收键盘逐帧检查未再见停顿后突跳、工具栏闪空或键盘自行重开；L 编辑预填、NS 空私信输入器的富文本/源码及全屏、妖火原生输入器也检查通过，记 `LIVE_PASS`，并非 tracked Replay。L 临时草稿在模式和开合间保持后已清空，编辑预填未改动；没有保存编辑或发送。物理设备、NS 编辑、L 私信与私信草稿完整矩阵为 `NOT_VERIFIED`。 |
| 本轮检查 | 相关 Vitest 4 套 110 项通过（seed `1789544103152`）；最终共享布局相关 UI 5 套 101 项通过（seed `-504235885`），Topic 身份/Key 与通知流程另有相关 UI owner 通过。原生 app 单测 131 项、架构 tooling 23 项、typecheck、相关 lint/格式、架构、文档与 diff 检查通过。普通本地 APK 编译及保留身份覆盖安装通过，`APK_SANITY` 日志窗口无崩溃；未执行正式发布。 |

## `REG-WRITE-087` 系统选图返回遗留键盘空缺并在重新输入时抽动

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 实际面板在自身终态布局及对应硬件帧提交后才结束受控收键盘，共享 WebView 保持 hardware。此前普通包全屏/半屏 77 帧及本轮成对开关普通包独立 Back 的 37 帧中，键盘全消后的旧高位和 21 px 尾差均未再出现，字体未压扁；本轮仍有最大 739 px 跳步，长文光标柄与完整平滑度未闭合，保持 `OPEN`。剩余渲染性能项按用户 2026-10-04 授权暂停；`REG-WRITE-121` 的回升遮挡关闭不代表本条完整动画通过。 |
| 2026-10-04 复核 | 早期普通回复全屏空稿、真实停靠 Gboard 下，仅执行一次 Back 后等待 8 秒，无关闭或重开。`isolated-back.mp4` 的 36 个实际编码帧经过原帧关键边缘筛查并人工复核关键帧，#16（3.035344s）至 #36（10.757367s）在 IME 消失后贴底，该样本未见旧高位露出帖子。#14→#15 间隔 121.600 ms，面板位置跨约 744 px，不能证明连续动画平滑。先前 `reply-fullscreen-back.mp4` 混入正常关闭，不构成 Back 失败。证据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38/editor-original-frame-review/isolated-back-review.md`；该次未复现不覆盖下行后续独立失败，完整选图及光标柄矩阵也未覆盖。 |
| 能力 ID | `WRITE-01/04/05/07`、`NOTIFY-02` |
| 历史症状与根因 | 用户在真机测试包反馈选图返回时先空缺再闪现，收键盘后重新点输入区仍抽动；此前 `REG-WRITE-086` 的普通开合验证未覆盖 Activity 打断。API 35 原生时序实录：选图打断收起时停在 142 dp，Reanimated 把中间高度认作 OPEN；恢复 Activity 的目标 Insets 又先发布 336 dp，下一帧归零再展开。编辑器选图前未交出焦点，上传完成再次强制聚焦，进一步触发自动重开。 |
| 当前 owner | `tests/native/ComposerKeyboardTest.kt` 覆盖 onPrepare 先于目标布局、打断后窗口归零及重叠动画；`tests/native/ComposerKeyboardHostTest.kt` 覆盖实际 Host 的公开 IME 控制、Back、命令及取消/焦点/窗口生命周期。`src/ui/composer/editorRuntime.test.ts` 保留正文与逻辑选区；`tests/ui/topic/composer-keyboard-viewport.test.tsx`、`tests/ui/topic/structured-reply-composer.test.tsx`、`tests/ui/topic/yaohuo-reply-composer.test.tsx` 和 `tests/ui/topic-composer/create-topic-screen.test.tsx` 持有交接顺序、safearea 几何、Portal/Topic/Modal 与原生输入接线。 |
| 初轮根因修复 | `react-native-reanimated+4.5.1.patch` 在 onPrepare 标记动画，在最后一个动画结束时读取窗口真实 Insets；静止高度允许归零。当时编辑器同步 blur 后再请求选图，图片插入与选区调整不再要求 focus；没有二次键盘补偿或清用户状态。后续仍复现独立灰间距，当前交接已改为下述原生收起确认后才 blur，初轮修复不能代表完整视觉问题解决。 |
| 构建逃逸 | 验证中发现 Gradle 原生包复用旧编辑器 HTML：`BundleHermesCTask` 没有追踪生成 JSON，APK 的 Hermes bundle SHA 与旧包完全相同。生成载荷改为懒加载 JS 模块并同步 ignore 与启动 owner，正常 Gradle 即可感知变化；最终包须核对实际载荷。中间仅原生补丁包不计完整修复通过。 |
| 失败与通过证据 | 原生回归修复前 expected CLOSING / actual OPEN，修复后 3 项通过。焦点矩阵修复前两模式均仍持有焦点，修复后相关 Vitest 60 项通过，依赖安装 owner 12 项通过；4 组共享 UI 98 项及启动 UI 3 项通过。补丁经过隔离干净依赖的 npm ci、forward 检查、真实 postinstall 与 reverse 检查。 |
| 设备边界 | API 35 / Gboard / 保留登录态覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`。L/NS 回复的源码与富文本、半屏/全屏选图取消后 `mInputShown=false`；系统收起后点输入区的逐帧工具栏轨迹保持连续。获授权的 L 站 222B 合成图真实上传一次，返回不弹键盘、CDN 预览显示；未发送回复，临时插入已撤销，NS 临时字符清理。此为 `LIVE_PASS`，不冒充 tracked Replay。物理设备、NS 本轮真实上传、回复编辑和私信的完整设备矩阵仍为 `NOT_VERIFIED`。 |
| 2026-09-23 真机复发与边界 | 用户再次报告真机选图返回和直接取消都闪动，键盘场景与旧录像一致；前次模拟器终态不能证明真机修复。旧录像里回复弹层整体悬在屏幕上方约 300 px，无键盘画面提示旧 IME 高度参与了布局。代码同时确认主题页把 `appActive` 合入回复弹层的 `routeActive`：打开系统选图器会让已聚焦路由的弹层关闭，返回时再开。现在按路由聚焦保留弹层；共享 IME viewport 在 App 暂退后台或恢复前台且 RN 键盘已隐藏时忽略旧高度，直到下一次原生键盘开始打开。两个行为 oracle 均修前失败、修后通过；此前等待 `keyboardDidHide` 和原生 Insets 补丁仍保留。同源码隔离模拟器在有、无键盘的选图直接返回后，弹层保持打开且底部无旧键盘空缺；录屏实际帧率较低，无法排除单帧闪动。真机仍未验证，真机实际包身份也待确认。 |
| 2026-09-27 可见模拟器复验 | API 35 / Gboard / WebView 156，Release Hermes 隔离入口使用真实系统选图器、合成 PNG 与 mock 上传响应，未写真实站点。修正 fixture 为生产使用的 markup-only 上传回调，并让 actions 接收真实 AppState、弹层保持路由聚焦。四场景中有/无键盘取消返回本轮未见整层重开；有键盘成功返回的原帧 80–82 仍显示旧高位面板，约 50 ms 后跳到贴底。两条有键盘录像在进入选图前还有 0.38–0.47s 空隙。临时隔离探针确认 RN `keyboardDidHide` 到达时 UI 线程仍为 `CLOSING/336dp`，约 0.7s 后才归零；等待 RN 事件不能证明视口已经归位。保留 `OPEN`，未再据终态截图判定通过；证据在 ignored `.codex-tmp/image-upload-visible-20260927`。真机仍为 `NOT_VERIFIED`。 |
| 2026-09-27 viewport 交接修复 | 工具栏改由现有 viewport owner 确认原始 IME、面板/页面几何在相邻 UI 帧均归位后才启动选图；缺少 handler、关闭、失焦后台、卸载或超时均拒绝，不用 `keyboardDidHide` 或 deadline 当作成功。修前失败的交接与迟到 UI 回调 oracle 归 `tests/ui/topic/composer-keyboard-viewport.test.tsx`、`tests/ui/topic/structured-reply-composer.test.tsx` 和 `tests/ui/topic-composer/create-topic-screen.test.tsx`。修后隔离录像 `sync-gate-keyboard.mp4` 未再出现返回瞬间面板跳位，但进入选择器前仍出现键盘已收而面板高悬，普通 Back 对照也复现；不能将交接修复等同于全部视觉修复。 |
| 2026-09-27 共享选图 IO 与导入意图修复 | 另确证 Expo `DocumentPickerModule.OnActivityResult` 在主线程查询 provider 并复制缓存，慢文件会阻塞返回时绘制。持久化 `expo-document-picker+57.0.1.patch` 将元数据/复制移到 IO dispatcher，保留完成后交付、多选顺序、重入保护及取消/销毁单次结算；`buildFromSource` 确保使用补丁源码。`tests/native/DocumentPickerThreadingTest.kt` 的实际模块与阻塞 provider oracle 修前 6 项中 3 项失败，补齐销毁分支后修后 8 项全部通过，原始 XML 位于 ignored `.codex-tmp/image-upload-fix-20260927/picker-native-red2.xml` 与 `picker-native-green2.xml`。随后仅将缓存图片的精确 `image/*` 请求改为 `ACTION_GET_CONTENT`，其余保留 `ACTION_OPEN_DOCUMENT`，保留 Openable、多选及 MIME；5 项真实 Intent oracle 在修前有 2 项图片分流失败，修后同一 native owner 共 13 项全部通过，证据为同目录 `picker-intent-red.xml` 与 `picker-intent-green.xml`。修复共享给新帖/编辑、主题回复、私信及备份导入，不代表四个入口的视觉流程已验收；Activity 返回闪白仍见 `REG-WRITE-122`，本条继续 `OPEN`，真机为 `NOT_VERIFIED`。 |
| 2026-09-27 组合 APK 复验 | 同时包含 viewport 交接与选图 IO 修复的 `combined-keyboard-success.mp4` 中，有键盘成功返回不再悬空或跳位，DOM trace 822 次采样中占位和图片同时缺失为 0；但进入选择器前仍有 35.056 ms 灰色间距，选择器淡出头两帧仍白 35.489 ms。无键盘成功和有键盘取消本次返程未白，无键盘取消仍有白帧，详见 `REG-WRITE-122`。录像与 trace 保存在 ignored `.codex-tmp/image-upload-fix-20260927`；这些单轮隔离样本不构成全部入口 `DEVICE_REPLAY_PASS` 或真机通过，本条继续 `OPEN`。 |
| 2026-09-27 返回预热与剩余去程缺口 | WebView 返回预热的原生有效 red/green 见 `REG-WRITE-122`。后续三条具有完整停靠 Gboard 的隔离录像中，Photos 取消/成功和 Browse 成功的返程均未见闪白、空隙或跳位；去程在键盘已不可见后，面板仍有约 83 ms 的灰色间距，不能写成全程通过。该轮证据尚不能区分 UI 响应链与原生绘制队列的滞后。本条保持 `OPEN`，最终无探针八路径和真机仍未完成。 |
| 2026-09-27 多级几何传播确证与固定面板修复 | 同一 UI runtime 的有界 ring 记录确认：旧 viewport 写 container 后，detents 在下一 RAF 才处理，Body 先读上一轮 position。普通 Back 的 8 个变化高度在 29.073–34.810 ms 后才到 detents；工具栏末次零高度输入到新 Body 样式为 41.731 ms。对应 `ime-ui-pipeline-toolbar.mp4` 去程原帧 #22 / 7.265256s 至 #27 / 7.463600s 有 198.344 ms 灰 gap，不能把全部间隔归给 mapper，原生输入与最终显示仍有独立延迟；`back2.mp4` 未录到操作，不作像素证据。固定内容分支改由 `FixedComposerPanel` 的 drawing style 直接读取原始 IME 帧并一次求几何，保留显式打开/关闭和全屏动画、正文实例与交接等待；动态妖火分支保留原 owner。`tests/ui/topic/composer-keyboard-viewport.test.tsx` 在 reaction/layout 回调未运行时检查新几何，并覆盖订阅/正文/旧关闭回调边界；最终无探针与后续绘制证据见下行。日志、PTS 与原帧范围见 ignored `.codex-tmp/image-upload-fix-20260927/ime-ui-pipeline-pixel-findings.md`，本条仍为 `OPEN`。 |
| 2026-09-27 固定面板最终包与绘制后边界 | 无探针源码 `8c4bfce994ace5e52ea82ee5650925d65169a15c8fd1c79619a54a76e3b8a193`、buildId `78fc080dce974696b3c25bee19d8f75f` 的普通 Back 仍有 262.622 ms 灰 gap，Photos 有键盘取消去程为 197.178 ms，返程无悬空或跳位；录制均未并行构建/测试。后续临时 v2 探针将原始 IME、实际 View 屏幕位置、pre-draw 与录像烧录时钟对齐：6 个变化高度从 input 到实际几何为 0.461–3.691 ms、到 pre-draw 为 0.562–5.272 ms，但匹配像素晚 99.951–134.229 ms；raw0 的 pre-draw 已贴底，录屏仍晚 118.950 ms 展示。剩余延迟已越过实际原生几何边界，尚不能细分 draw、RenderThread、Surface 队列或合成。单独强制 hardware 仍有 gap；跳过 owner 等待的 window/dismiss 对照会携带旧高位进入 Photos，并在快速取消时跳位，因此未采用。证据为同目录 `.codex-tmp/image-upload-fix-20260927/final-fixed-visual-findings.md`、`.codex-tmp/image-upload-fix-20260927/ime-geometry-pixel-correlation.md` 与 `.codex-tmp/image-upload-fix-20260927/ablation-visual-findings.md`；探针/单变量对照不代替最终无探针验收，也不作为不同 CPU 条件的性能收益比较。本条保持 `OPEN`，物理设备仍未验证。 |
| 2026-09-27 最终有键盘与无键盘覆盖 | 上述同源码无探针包已执行回复 Photos/Browse × 完整停靠 Gboard/无键盘 × 取消/成功八条路径，另补 Topic 附件取消、Topic 正文有键盘取消与私信有键盘成功；返回检查未再见正文闪白或旧高位跳动，草稿与成功图片保留。私信全屏、Back、关闭重开也保留草稿和图片。八路径执行完成不代表整个交互通过：有键盘去程和普通 Back 的灰间距仍复现，Topic/私信独立去程未逐条量化，物理真机及真实站点仍为 `NOT_VERIFIED`。逐项录像、DOM 采样与边界见 ignored `.codex-tmp/image-upload-fix-20260927/final-visual-matrix.json`、`.codex-tmp/image-upload-fix-20260927/final-acceptance.md`；本条继续 `OPEN`。 |
| 2026-09-27 GitHub 方案核查与拒绝候选 | RN 坐标/隐藏复位及 Reanimated 同步 mapper 的上游修复已在当前依赖中；当前窗口没有 legacy FLAG_FULLSCREEN。隔离候选将 layout 与 transform 样式分开并启用官方同步 UI props 路径，原生构建成功后用完整停靠 Gboard 录制普通 Back：基线原帧 #12–16 仍有 165.688 ms 灰间距，候选同样 5 帧、182.811 ms，不能由单样本断言性能优劣，但足以判定没有消除问题，因此未采用。候选源码已还原并覆盖安装原测试包，安装身份不变。两种包覆盖安装后首次启动都出现相同 WebView AssertionError，重开成功；该异常不具候选特异性，该阶段尚未定位，后续独立首启事故与 UA 线程对照见 `REG-NAV-007`。GitHub 适用性、原始录像与独立逐帧验收见 ignored `.codex-tmp/github-ime-gap-20260927/github-findings.md`、`.codex-tmp/github-ime-gap-20260927/candidate-verdict.md`；本条继续 `OPEN`，真机仍为 `NOT_VERIFIED`。 |
| 2026-09-27 Gboard 独立隐藏调用链 | 同轮 SurfaceFlinger 记录到 App 与 IME leash 的同步移动事务仍在继续时，system_server 已独立将 InputMethod 内容子层 reparent-null。Gboard 精确 method trace 的首次 `Dialog.hide` 来自 `Handler → FutureTask → kav.run → Dialog.hide → View.setVisibility`；此前已收到服务端 `hideSoftInputWithToken → InputMethodService.hideWindow → onWindowHidden`，其后才出现另一条 stock `removeImeSurface` 清理链。同轮日志 Back 为 07:00:00.093，Gboard onFinishInputView 为 .095，IME 窗口 GONE/销毁为 .321，App 动画状态隐藏通知到 .575 才发生。WMS 栈为 `Session.relayout → relayoutWindow → relayoutWindowInner → tryStartExitingAnimation → WindowState.destroySurface → destroySurfaceUnchecked → WindowStateAnimator.destroySurfaceLocked → destroySurface`，因此不能仅归因于 App 末次 notifyFinished。方法跟踪未记录对象身份或参数，不能推定混淆任务的固定延时；该取证轮也不用于性能比较。本机事实见 ignored `.codex-tmp/ime-draw-rootcause-20260927/formal-fix-evidence.md` 与 `gboard-hide-method.trace`，不外推用户真机的全部原因。 |
| 2026-09-27 公开 IME 控制原型对照 | API 35、完整停靠 Gboard、同 APK/同 PID3570/SwiftShader 的 key-event Back 对照，仅切换原型开关。关闭控制时原始帧 #16–20 有最大 286 px、181.112 ms 的 App 灰背景缝；开启 `controlWindowInsetsAnimation` 后，全过渡原帧 #9–33 均无该灰缝，SF 显示 IME 内容子层保留到移出视口、隐藏之后才销毁，Gboard onFinishInputView 晚于 `finish(false)`。无 cancel/fallback，但仍有工具栏最大 31 px、85.400 ms 的独立裁切，以及两个编码帧间 401 px 的步进，不能写成无掉帧或整个动画通过。证据为同目录 `.codex-tmp/ime-draw-rootcause-20260927/control-pair-findings.md`、`.codex-tmp/ime-draw-rootcause-20260927/control-pair-verdict.json` 与原帧/trace；只证明这次公开控制机制，未验正式 picker、手势 Back、快速重入或焦点生命周期。 |
| 2026-09-27 正式 Host 与 safearea 修复待验 | 正式 `ComposerKeyboardHost` 统一 Portal、Topic 主窗口、独立 Modal 与妖火输入的原生收起，原焦点/窗口失效即取消；标准 hide 回退也须等待动画结束和隐藏布局，不能把接受请求当完成。共享正文图片交接改为原生确认、相邻两次 UI ready 检查、文档复核、blur、picker；Modal 附件在原生交接后复核面板/草稿再选文件，2.5 秒 deadline 仅拒绝。接入 Host 的 Modal 改为 padding 避让并保留输入节点，避免 keyboardDidHide 提前重挂使控制失焦。半屏高度原已含 bottom inset，旧实现归还 padding 时挤小 WebView 内容区；`FixedComposerPanel` 现同步归还外部高度，在未受限半屏保持内容高度，独立处理原型尾部工具栏裁切。safearea 局部 UI oracle 修前 expected 480 / actual 504，修后对应 3 项通过；这不代表正式设备像素验收通过。无探针匹配 APK、各入口选图与 Back 全过渡、工具栏裁切、快速重入及物理设备仍待补充；最新汇总入口为同目录 `.codex-tmp/ime-draw-rootcause-20260927/formal-fix-evidence.md` 第 6 节。本条继续 `OPEN`，物理设备为 `NOT_VERIFIED`。 |
| 2026-09-27 正式自动化检查 | Host 初轮控制 oracle 修前 15 项全部失败；补齐标准 hide 完成契约后，旧 owner 的 18 项中 6 项失败，正式 Host 为 18/18，Keyboard 3/3、WebView Insets 1/1，前轮 Prewarm 10/10、Package 注册 2/2，均无 errors/skipped。原始 XML 为同目录 `host-native-red.xml`、`host-fallback-red.xml`、`host-fallback-green-*.xml` 及 `host-green-*.xml`。共享 bridge/handoff oracle 分别归 `tests/ui/topic/composer-keyboard-host.test.tsx`、`tests/ui/topic/composer-keyboard-handoff.test.tsx`，连同各调用方、提交和压力 owner 的相关 UI 共 11 suites、263/263，seed `-2146711595`，回执为 `host-handoff-ui-final.log`。这些为 `UNIT_PASS`/`UI_PASS`；正式构建、首启与逐帧设备结果不能由此推定，仍按上行保留缺口。 |
| 2026-09-27 正式无键盘去程逃逸 | 正式包 `formal-hidden-photos-cancel.mp4` 在系统 Back 已收键盘、DOM 仍保留焦点时点图片，完整 Gboard 在原帧 #21–23 突然出现并遮住正文下部、工具栏与 footer；#20 PTS 3.257289s 无键盘，#21 3.274400s 首次出现，#24 3.336511s 已消失，首有至首无为 62.111 ms。Photos 首露出在 #34 / 3.725911s，因此是进入 picker 前的闪现；该样本面板仍贴底、未见额外灰缝或反向跳位，返程也未见整块白层。此前 picker 已 blur 的无键盘成功样本不能覆盖此保留焦点前提。像素本身不能识别触发 focus/show 的具体调用；代码与下行 oracle 另确认交接前已写入占位 DOM，且原流程未等待编辑器激活确认。逐帧范围及缩放采样边界见 ignored `.codex-tmp/ime-draw-rootcause-20260927/formal-photos-review.md`。本条继续 `OPEN`。 |
| 2026-09-27 上传锚点激活交接修复 | `editorRuntime` 的正文工具栏先登记无 decoration 的映射锚点；原生交接完成后，`StructuredReplyComposer` 通过既有 begin 命令激活，runtime 同步 blur、安装占位后才 ACK。调用方等待匹配 ACK 并再次核对当前文档与生命周期，之后才启动 picker；失败清理原请求，旧 `id/epoch` 或迟到 ACK 不得放行重试。`src/ui/composer/editorRuntime.test.ts` 的两模式实际 DOM/Selection oracle 修前 2 项失败（seed `1790498250301`），`tests/ui/topic/structured-reply-composer.test.tsx` 的 ACK 顺序 oracle 修前 1 项失败（seed `312651394`）；修后完整对应 owner 为 100/100（seed `1790498782748`）与 47/47（seed `82631353`），另通过 typecheck、定向格式/lint 与 diff 检查。证据为同目录 `upload-activation-runtime-red.log`、`upload-activation-ui-red.log`、`upload-activation-runtime-final.log`、`upload-activation-ui-final.log`。后续 lifetime 复核确证：关闭、只读、忙碌或后台短暂失效后恢复同 intent/epoch，旧等待/ACK 仍会启动 picker；两个等待阶段的 10 项 oracle 修前全部失败（seed `2131717702`）。现对尚未启动 picker 的原交接保留失效标记，只取消匹配 `id/epoch` 的 begin 回执，已启动 picker 的合法后台与上传继续有效；复用 AppState 监听，Topic 不增加后台 snapshot。最终 Structured owner 58/58（seed `-1391958158`），含恢复边界及合法 picker 保护，定向格式/lint、diff 检查通过；证据为 `upload-lifetime-red.log` 与 `upload-lifetime-green.log`，该增量已随 Modal 整合通过统一 typecheck。以上是 `UNIT_PASS`/`UI_PASS`，不证明实际 IME Surface 行为；匹配本次修复的正式 APK 尚待逐帧复验，物理设备仍为 `NOT_VERIFIED`，不预填设备通过或关闭本条。 |
| 2026-09-27 正式 Modal 提前落底逃逸与局部 Insets 修复 | 正式 v1（sourceHash `ec4217a8cab971a8c6be679c9e7a112123bdf510f61eb98b947442434e3ae31c`）的原生标题 Back 样本通过，但 `formal-modal-description-back.mp4` 在 #10 / PTS 3.209656s 尚位于键盘上方，#11 / 3.236733s 已落到底部，Gboard 仍大部可见；`formal-modal-files-cancel.mp4` 在 #10 / 2.748300s 先露灰条，#11 / 2.772067s 同样落底并遮住文件、说明与提示。文件选择器直到 #41 / 3.740222s 才露出，不能归因于 picker 提前遮盖；返程保留说明且未再弹键盘不能抵消去程失败。原尺寸证据见 ignored `.codex-tmp/ime-draw-rootcause-20260927/formal-native-modal-review.md`。代码确认该 Modal 的 KAV 仍由提前到达的 `keyboardDidHide` 禁用，保留输入节点并未解决 padding 提前归零。现 API 30+ 沿 Host 本地 Insets 动画向 UI worklet 发送实际重叠高度，以稳定容器 padding 跟随当前帧，prepare 后的目标零 Insets 不抢先清值，API 30 以下保留 KAV 回退；不增加 Activity 级订阅或 JS 逐帧状态。最低修前 oracle 是上述真实视频 FAIL 与 UI 缺少本地事件接线的失败；两轮新增 native RED 的 fixture 几何/DisplayMetrics 失败不计有效行为 RED。修后 `ComposerKeyboardHostTest` 21/21、failures/errors/skipped 均为 0（`.codex-tmp/ime-draw-rootcause-20260927/modal-insets-native-green.xml`），Host/Handoff UI 两个 owner 13/13，seed `-172817549`（`.codex-tmp/ime-draw-rootcause-20260927/modal-insets-ui-green2.log`），typecheck 与定向格式/lint 通过。这些为 `UNIT_PASS`/`UI_PASS`，最新 APK 的 Modal 与图片入口像素复验仍待完成，物理设备 `NOT_VERIFIED`，本条保持 `OPEN`。 |
| 2026-09-27 正式 v2 三通过一失败 | sourceHash `b0bedf812cd83be95103e29f84099fd1a1c3ac9604ce2688fcd6fe7a787eaf20`、buildId `53e99fea13bc4859a17cc42181d66a45` 的四条复验中，半屏 Back 与两个 Modal 样本通过；Modal 不再提前落底，说明始终可读，文件取消返回后内容保留且不重开 IME。但无键盘 Photos 取消仍失败：#18 / PTS 3.024989s 面板顶部为 1193 px，#19 / 3.071811s 上跳到 374 px，即 819 px，底部灰带最大 881 px，#28 / 3.422178s 才归零，持续 350.367 ms；完整 Gboard 没再闪出不能代表修好。返程无独立跳位不能抵消去程失败。原始量测与人工判定见 ignored `.codex-tmp/ime-draw-rootcause-20260927/v2-formal-review.md` 与 `.codex-tmp/ime-draw-rootcause-20260927/v2-modal-review.md`；精确像素数值只用于做过量测的样本，Modal 不声称精确 0 px。此轮半屏和 Photos 初态为空，不能代表已有正文/图片保留；真机仍 `NOT_VERIFIED`，本条继续 `OPEN`。 |
| 2026-09-27 手势尾部 IME 再显示与临时策略修复 | v2 取证在不可见锚点没有 focus 或 Selection 写入时仍记录到原生 SHOW；pointerdown、click、touchend prevent 三个单变量均未阻止。Chromium 156 可在手势尾部对仍聚焦的 editable 再请求显示键盘；同 task 给该节点设置 `virtualkeyboardpolicy=manual` 的实验消除本轮 SHOW，保留原生 HIDE，已显示键盘仍由 Host 收完后才 blur。两个有/无键盘去程探针均未见目标缺陷（`.codex-tmp/ime-draw-rootcause-20260927/probe-policy-outbound-review.md`），只计实验样本通过，不计正式 APK 或完整返程通过。正式 runtime 在图片点击同栈持有上传 ID、编辑节点与原策略值；visible begin 先同步 blur 后恢复，finish 及 INIT/DESTROY/unmount 同步释放，旧 `id/epoch` 不得干扰新 owner；不调用全局 keyboard show/hide 或修改 viewport 策略。源码通过 CodeMirror contentAttributes 的 StateField/Effect 随事务设置属性，修掉直接改属性导致的两次额外 style 写入，没有放宽原 DOM/Selection oracle。相同 seed `1790503100007` 下修前 12 项失败、修后完整 runtime 106/106，通过定向格式/lint 与 diff 检查；回执为 `.codex-tmp/ime-draw-rootcause-20260927/upload-policy-runtime-red.log`、`.codex-tmp/ime-draw-rootcause-20260927/upload-policy-runtime-green.log`，中间副作用另留 `.codex-tmp/ime-draw-rootcause-20260927/upload-policy-source-diagnostic.log`。正式 v3 构建与设备像素尚待完成，不以实验或 UNIT_PASS 关闭本条；物理设备 `NOT_VERIFIED`。 |
| 2026-09-27 正式 v3 十三通过三失败 | sourceHash `9ee0947cef847aae3126e46ac1f1851a641a83df1e8c6ce700cfd8534d900682`、buildId `b4d0d4bfb2894c5ca99adc06525cf869` 的 16 条正式录像中，Photos/Browse 有无键盘与取消/成功八路径、源码两路径、半屏 Back、原生标题 Back、关闭重开共 13 条为样本级 `DEVICE_REPLAY_PASS`；原正文/图片及成功结果按各样本保留，未再见目标上跳、完整 Gboard 闪出或返程整块白层。但 Topic 无键盘图片入口和私信有键盘图片入口均误报「键盘尚未收起，请重试」，没有进入选择器；全屏手势 Back 的 HTML 工具栏与原生 footer 分离，#38 / PTS 3.773978s 开始明显分离，#41 / 3.838133s 中间白区人工估约 756 px，#44 / 3.937422s 才重新相接。整体仍为 FAIL，fixture 的 outcome 不替代实际 picker 成功。证据见 ignored `.codex-tmp/ime-draw-rootcause-20260927/v3-stage-review.md` 与 `.codex-tmp/ime-draw-rootcause-20260927/v3-photos-review.md`；样本仍有正向大步进，不宣称精确 0 px 或无掉帧，真机 `NOT_VERIFIED`，本条继续 `OPEN`。 |
| 2026-09-27 订阅中断计数修复与初验 | 旧 Reanimated 键盘观察在退订时可能收不到 onEnd，遗留动画计数和中间高度；重新订阅后目标 Insets 更新仍被旧动画状态挡住，导致原生键盘已隐藏但 UI 交接超时。正式补丁在主线程开始/停止观察时重置本周期状态，新观察读取当前窗口 Insets 并发布；首 listener 先注册，旧 callback 停用且旧 onApply 按实例隔离，漏 prepare 的运行中动画按身份接管，重复 prepare 与无配对 end 不污染计数。`tests/native/ComposerKeyboardTest.kt` 的 7 项中修前 4 项失败、修后 7/7，均无 errors/skipped，证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/keyboard-subscription-red.xml` 与 `.codex-tmp/ime-draw-rootcause-20260927/keyboard-subscription-green.xml`。含该修复的 software 探针包 buildId `d4dd0a48ead04f9d8f6e2e2f2cb08f77` 已在标题 Back 后紧接打开新 Topic、再次显示/收起标题键盘并进入实际 Photos 后取消，草稿保留；只计 `PROBE_BEHAVIOR_PASS`，没有逐帧捕获该中断过程，也含额外 software 变量，不能替代最终正常绘制包验收。回执与日志为同目录 `.codex-tmp/ime-draw-rootcause-20260927/software-topic-after-interrupt-receipt.json`、`.codex-tmp/ime-draw-rootcause-20260927/software-probe-runtime.log`，本条仍 `OPEN`。 |
| 2026-09-27 全屏工具栏候选失败与共享 owner 调整 | CSS 的 fixed + translateZ + flow spacer 实验仍出现工具栏与 footer 分离：候选 #40 / PTS 3.734044s 至 #48 / 3.951267s 才相接，可见窗口 217.223 ms；software 绘制实验也失败，第一段分离为 118.644 ms，随后另有 29.100 ms 分离及 footer/IME 间露出底层 fixture 56.689 ms。不同正文、选区与包内生命周期代码不能支持性能优劣比较，只能证伪这两候选已消除缺陷；证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/fullscreen-toolbar-probe-review.md` 与 `.codex-tmp/ime-draw-rootcause-20260927/fullscreen-toolbar-software-review.md`。后续将共享底部入口交给原生 `ComposerToolbar`，正文、选区和格式/业务表单保留 runtime，通过当前文档 epoch 的 toolbar-action/TOOLBAR_STATE 复用动作；具体契约及 canonical owner 归 product map/testing standard。Bridge 协议初轮 10 项失败；只补协议后 runtime 行为仍 7 项失败，正式修后两 owner 共 117/117（seed `1790516200007`），证据为 `.codex-tmp/ime-draw-rootcause-20260927/native-toolbar-runtime-red.log`、`.codex-tmp/ime-draw-rootcause-20260927/native-toolbar-runtime-behavior-red.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/native-toolbar-runtime-green2.log`。这是局部 `UNIT_PASS`，该迁移的完整 UI、匹配 APK 逐帧与功能验收尚待完成，不预填设备 PASS，不关闭本条或以此关闭独立返程白帧记录。 |
| 2026-09-27 原生工具栏 v4 局部通过与可用性逃逸 | v4 buildId `c6b58b3417bd4e66b1f7555312e69979` 已匹配构建并保数据覆盖安装。全屏手势 Back 的原帧 #34–44（PTS 3.650756–3.953589s）中，原生工具栏与 footer 直接相邻，未再见 v3 约 756 px 分离白带；该检查区间没有整块正文白、工具栏裁切或反向跳位，两图和文字保留，计该单样本目标缺陷 `DEVICE_REPLAY_PASS`。但 #34→35 仍有 36.100 ms 内同向 504 px 的编码帧步进，不能宣称无掉帧。无键盘 Photos 取消样本去返程未见目标闪现，但返回后按钮标签已恢复「图片」，Android accessibility busy 仍保留，阻断下一次按精确语义定位入口，不能把像素恢复等同于完整功能通过。证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v4-fullscreen-review.md`、`.codex-tmp/ime-draw-rootcause-20260927/v4-hidden-photos-review.md` 与 `.codex-tmp/ime-draw-rootcause-20260927/formal-v4-install.json`；v4 整体未验收，本条仍 `OPEN`。 |
| 2026-09-27 v5 忙碌状态修复与 v6 待验 | 工具栏 accessibilityState 的 busy 改为每次显式布尔值，结束上传/取消时清除原生忙碌状态；旧选区、上传和菜单生命周期不变。Bridge/runtime 后续完整 119/119（seed `1790516200007`）；v4 合并 UI 首轮 12 owner 的 307 项中 306 通过，唯一失败为全局 measure mock 的隔离断言，缩到真实 viewport 后 toolbar 同 seed `1243117478` 的 19/19 通过，不能写成当轮全套重跑。v5 已按该 seed 完整重跑 12 suites、307/307，并通过全量 typecheck、定向 ESLint/Prettier/diff；前轮 architecture 588 modules 与 docs 29 项通过。回执为 ignored `.codex-tmp/ime-draw-rootcause-20260927/formal-v4-toolbar-retest.log`、`.codex-tmp/ime-draw-rootcause-20260927/formal-v4-toolbar-typecheck.log`、`.codex-tmp/ime-draw-rootcause-20260927/formal-v5-ui.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/formal-v5-typecheck.log`。v5 buildId `9ecd00ae1df149ff9eaa51d256d0a35a` 的覆盖安装前后 firstInstallTime 保持，首启日志当前 PID32680 未见 FATAL/AssertionError，见同目录完整路径 `.codex-tmp/ime-draw-rootcause-20260927/formal-v5-install.json`、`.codex-tmp/ime-draw-rootcause-20260927/formal-v5-startup.log`；仅为该安装/首启窗口证据。随后发现原生栏普通点击仍有临时 pressed 背景，与既有静默点击契约冲突，已去掉该分支，保留选中、展开、禁用及忙碌状态；包含此变更的最终 v6 类型/UI/匹配 APK 及逐入口设备验收仍待完成，不将 v5 检查或 v4 单样本覆盖为 v6 通过。本条保持 `OPEN`，真机 `NOT_VERIFIED`。 |
| 2026-09-27 v6 八路径行为完成但尾段灰缝仍失败 | v6 buildId `2b6f380f01ac4159aed5b5170be002fa`、sourceHash `6b14a7fa0a43f50efed60401469c37b36a6c98b6dafbaa4c785a092ac27a9f06` 已完成 Photos/Browse × 有无完整停靠 IME × 取消/成功八路径的选图、返回与结果结算，原生工具栏无 pressed 回显，busy 显式归 false。但有键盘 Photos/Browse 去程仍出现 footer 与 Gboard 之间的尾段灰缝，整体不能升级为视觉通过；Browse 成功原帧 #15 / PTS 2.999900s、#16 / 3.033844s 露出 fixture token，#17 / 3.083911s 消失，编码窗口 84.011 ms，高度人工估约 56→90 px。工具栏与 footer 彼此仍紧接，四条 Browse 返程未见整块正文白或旧高位跳动；Browse 独立结论为 3 样本通过、1 样本失败，不能写成四条有键盘链全部失败。证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v6-picker-matrix-run.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/v6-browse-review.md`。保持 `OPEN`，行为走通不替代像素验收。 |
| 2026-09-27 v7 固定面板锚底修复待验 | 旧 top 锚定时，若 transform 已按新面板高度更新、原生仍使用旧高度，底边会缺少两者差值；安全区回填可把该差值变成灰缝。这是可复现的混合几何风险，尚不单凭单测认定为录像中的唯一时序原因。`FixedComposerPanel` 改为 bottom=0，打开态 transform 只依赖 IME 高度，保留原半屏/全屏高度与安全区计算。`tests/ui/topic/composer-keyboard-viewport.test.tsx` 模拟原生高度延后，两个新 oracle 修前失败、原 22 项通过，修后同 seed `1243117478` 为 24/24；证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v7-bottom-anchor-red.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/v7-bottom-anchor-green.log`。仅计 `UI_PASS`；匹配 v7 构建仍须核 footer/IME 灰缝及 header/正文是否因高度迟到产生反向修正，实际设备结果待验，不预填 PASS。本条继续 `OPEN`，物理设备 `NOT_VERIFIED`。 |
| 2026-09-27 v7 局部通过与关闭重开尾段灰带 | v7 主八格选图矩阵及两条源码模式样本通过各自目标缺陷复核，不能扩展为全部入口通过。关闭重开的独立 Back 阶段仍在 #16 / PTS 2.951567s 至 #19 / 3.048800s 暴露 97.233 ms 灰带：原尺寸 RGB 149/150 与同帧 backdrop 150 一致，不同于 IME 尾色 (239,238,243)，灰区 48–61 px 小于约 63 px safe inset；不能因看不到 fixture token 就将其当成输入法尾色，单凭颜色也不能确定原生绘制层归属。证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v7-photos-review.md`、`.codex-tmp/ime-draw-rootcause-20260927/v7-browse-review.md` 与后续细化的 `.codex-tmp/ime-draw-rootcause-20260927/v7-close-reopen-nav-color-review.md`；整体仍失败，本条保持 `OPEN`。 |
| 2026-09-27 v8 导航背景归属修复待验 | 固定面板始终保留 bottom safe padding，以 `max(0, 原始 IME 高度 − safe inset)` 计算有效重叠，让自身背景延入输入法覆盖的导航安全区；稳定打开时 header/footer 与正文有效高度不变，pickerReady 仍要求原始高度为零。原几何 owner 新增半屏/全屏尾段背景 oracle，修前 2 failed / 24 passed，修后 26/26（seed `1243117478`），证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v8-navigation-owner-red.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/v8-navigation-owner-green.log`。只计 `UI_PASS`，v8 匹配设备的灰带、开合及坐标复核仍待验；不预填设备 PASS，物理设备仍 `NOT_VERIFIED`。 |
| 2026-09-27 私信图片 fixture 凭据缺口更正 | 旧 `MessageSubmissionFixture` 返回 null NodeImage key，真实通知路由正确地在打开 picker 前拒绝；`v7-message-shown-photos-cancel` 实际没有进入选择器，后续 Back 关闭 composer，不能计为图片取消通过，成功分支也未取得有效录像。fixture 现与回复 fixture 使用相同 synthetic key。`tests/ui/notifications/notifications-route.test.tsx` 沿真实 fixture/通知路由建立 oracle：旧值下 picker 实际调用 0 次而期望 1 次；修后整个 owner 62/62（seed `1243117478`），mock 上传并插稿、再次取消保稿，真实网络和私信发送均为零。证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/message-upload-fixture-red.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/message-upload-fixture-green.log`。该修复只改测试 fixture，产品拒绝缺少凭据的行为未变；私信设备路径须用重建的 proof 另验。 |
| 2026-09-27 v8 环境退化与同包重启后分层复核 | v8 最初关闭重开与无 AX 的 ADB Back 分别出现 513.678 ms、745.956 ms 大灰 gap，原始 FAIL 保留；无 AX 仍失败，不能单归给工具。重启前 RenderThread 持续 emugl vertex-attrib param 35070 错误，EGL 平均约 509–527 ms；保数据冷启同一 AVD、APK SHA-256 与 firstInstallTime 均不变后，App/RenderThread CPU 从约 92%/77% 降至约 4%/0%，环境退化有独立证据，但不单凭这些统计认定每帧唯一原因。v8r 的 Browse 四格、关闭重开、无 AX Back、全屏手势 Back 共 7 条通过，链接表单 1 条失败（见 ignored `.codex-tmp/ime-draw-rootcause-20260927/v8r-browse-review.md` 与 `.codex-tmp/ime-draw-rootcause-20260927/v8r-panel-review.md`）；另 Photos 四格、源码两条、私信两条的正式报告为 8/8 `DEVICE_REPLAY_PASS`，身份一致、真实发送 requests/confirmations 为零。富文本成功可替换当前 NodeSelection，不能一律要求追加。此阶段仅覆盖 sourceHash `65f1b118c46451e756b59b09ec4f7b03f3a9ac0791cebddb0c433441ed806faf`，不借给后续 v9。证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v8-pre-restart-app.log`、`.codex-tmp/ime-draw-rootcause-20260927/v8-post-restart-apk-hash.txt`、`.codex-tmp/ime-draw-rootcause-20260927/v8-post-restart-identity.txt`、`.codex-tmp/ime-draw-rootcause-20260927/v8r-photos-review.md`，各范围汇总见 `.codex-tmp/ime-draw-rootcause-20260927/formal-fix-evidence.md`。整体未通过，本条保持 `OPEN`，物理设备 `NOT_VERIFIED`。 |
| 2026-09-27 链接表单绕过受控收键盘与共享修复 | 同包 CPU 已恢复且图片矩阵正常时，`v8r-link-builder.mp4` 点击原生链接后 Gboard 先消失、表单仍高位暴露 fixture，之后先落底再切全屏；首灰高 819 px，PTS 2.957467s 至首无灰帧 3.240189s 共 282.722 ms，并有 header 反向上跳。代码证据为 native toolbar-action 直接进入 `showBuilder`，先直接 blur/setBuilder，再由 PANEL_CHANGED 切 fullscreen，未经过现有 `ComposerKeyboardHost`。修复将 hostToolbar=true 的所有 `showBuilder` 入口共用 `prepare-panel`，先等待受控收键盘和布局就绪，再 blur/open；`closeBuilder` 统一关闭与进入帖子选项时的取消，旧 ACK 不得重开。runtime/bridge 最低 RED 为 9 failed / 1 passed，host UI 为 5 failed；内部帖子选项取消另取得真实 1 项 RED。修后两个 runtime/bridge owner 129/129（seed `1790523000001`）、Structured UI 64/64（seed `1243117478`），tsc、ESLint、格式和 diff 通过。日志为 ignored `.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-runtime-red.log`、`.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-ui-red.log`、`.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-close-red.log`、`.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-runtime-final.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-ui-final.log`。未改变固定面板几何，v9 匹配设备表单与其余入口仍待验，不预填设备 PASS。 |
| 2026-09-27 v9 匹配构建与功能检查 | v9 sourceHash `2ac5de498936bbb107b4c0d7819332b8eb927df8b22ec9dd6eb72b1f8e4d7810`、buildId `f4d09fb17a354efb94fe6a678d97312e` 已保数据覆盖安装，firstInstallTime 前后均为 `2026-09-27 01:20:18`，见 ignored `.codex-tmp/ime-draw-rootcause-20260927/formal-v9-install.json`。同目录 `.codex-tmp/ime-draw-rootcause-20260927/v9-functional-receipts.json` 的 13 个 mock 功能回执通过、remoteWrites=0；仅证明功能终态，不能代替原帧。相关 UI 13 suites、378/378（seed `1243117478`）见 `.codex-tmp/ime-draw-rootcause-20260927/formal-v9-ui.log`；此前 runtime/bridge 129、Structured UI 64、原生键盘订阅 7、viewport 26 项各按所属日志和阶段保留，不与 378 重复合计。全量 typecheck、定向 lint/format、architecture 588 modules、tooling 54/54（架构 25 + 文档 29）、14 个 Markdown 引用检查及 diff 检查通过；回执包括 `.codex-tmp/ime-draw-rootcause-20260927/builder-handoff-typecheck.log`、`.codex-tmp/ime-draw-rootcause-20260927/v9-architecture.log`、`.codex-tmp/ime-draw-rootcause-20260927/v9-tooling-tests.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/v9-docs-check.log`。签名包的最终 APK_SANITY 与另七条入口原帧结论尚待补充，不预填通过。 |
| 2026-09-27 v9 目标缺陷通过与未解决视觉边界 | ignored `.codex-tmp/ime-draw-rootcause-20260927/v9-builder-review.md` 的富文本链接、源码链接、贴纸面板三条，以及 `.codex-tmp/ime-draw-rootcause-20260927/v9-return-review.md` 的普通关闭重开、无键盘 Photos 取消、有键盘 Browse 成功三条，均只对旧底部灰洞、误弹键盘、整块正文白层和草稿保持计 `DEVICE_REPLAY_PASS`。仍有两项已见未解决问题：富文本链接 #23 / 3.379011s → #24 / 3.428389s，白色边界在 49.378 ms 内由 y1189 到 y136，同向一步 1053 px；关闭重开 #24 / 3.013956s 的原生绿色光标拖拽柄短暂出现在 header 上方 backdrop，与正文 caret 分离，下一编码帧 #25 / 3.029344s 恢复，间隔 15.388 ms。当前未区分动画值、布局/呈现提交和选区浮层跟随的具体根因，也不能证明由 v9 新引入；这两项属于尚未完成的平滑度/选区跟随范围，不能被旧目标 PASS 掩盖。贴纸资源下载及实际选择插入也不在面板交接 PASS 内。REG 保持 `OPEN`，物理真机 `NOT_VERIFIED`。 |
| 2026-09-27 正常入口原签名 ARM64 测试包静态核对 | 正常入口包 `C:/src/wz-android/.codex-tmp/ime-draw-rootcause-20260927/wz-reader-1.3.148-arm64-image-keyboard-fix-signed.apk`，buildId `d8856a3590c54770b628707308b13159`，APK SHA-256 `85f94fd3ed5faa394ffcbf65db5646e4ae129f5b45ae20353b8051ded8269029`；sourceHash 与 v9 proof 和当前源码一致。ignored `.codex-tmp/ime-draw-rootcause-20260927/signed-apk-static-check.json` 仅为 `STATIC_PASS`：正常 index.ts/AppComposition、无 dev/proof 来源或 scheme、`com.wz.reader` 1.3.148(152)、ARM64-only、non-debuggable、唯一原证书 SHA-256 `6cb2f2a6034e18b7b82315e46e515b909817b9a211ee0f02c3c39224ef5bdd66`。未安装并启动此正常入口包，因此不得计 `APK_SANITY`，本包 APK_SANITY 与物理真机启动均为 `NOT_VERIFIED`；不借隔离 proof 的设备证据代替。 |
| 2026-09-27 v11–v14 增量与未闭合边界 | v11 对共享结构化编辑器持续启用硬件层，已就绪正文聚焦/Back、快速重开选图及长 Browse 返回样本未复现整块白闪；首次加载仍有 516.456 ms 呈现间隔，不外推全阶段。v12 将妖火回复/私信接入自然高度的 `FixedComposerPanel` 和原生 TextInput，相关 UI 162/162；六片 527 个原帧中普通 Back、长文回复/私信重开保稿，但 Photos 去程仍有 72/94 px、49.089 ms 灰带，表情入口有最大 818 px、71.988 ms 背景洞，均露出底层 fixture。v13 仅补妖火真实上传协议的 mock，owner 49/49，设备实际 uploads=1、UBB 插入且无发送；两次未复现尾缝不能判定 v12 间歇失败已解决。v14 表情/格式入口改为复用受控收键盘，确认并复核生命周期后才 blur/开面板；既有 `tests/ui/topic/yaohuo-reply-composer.test.tsx` 的最低 oracle 修前 8 项失败、修后 34/34（seed `1243117478`）。v14 有效 Gboard 样本中旧键盘退场灰洞未复现，但长文表情打开时 footer 裁切 87.967 ms、关闭时旧父高度留白 16.334 ms；Topic 格式/表情在收键盘后标题先展开再折叠，分别持续 176.778 ms/178.866 ms，不能记整体通过。原帧判定见 ignored `.codex-tmp/ime-draw-rootcause-20260927/v14-native-panel-review.md`；两条 Photos 目标通过仅属于对应样本，见 `.codex-tmp/ime-draw-rootcause-20260927/v14-gboard-photos-review.md`。帧证据为 ignored `.codex-tmp/ime-draw-rootcause-20260927/v11-hardware-review.md`、`.codex-tmp/ime-draw-rootcause-20260927/v12-dynamic-review.md`；阶段身份和证据索引见同目录 `.codex-tmp/ime-draw-rootcause-20260927/formal-fix-evidence.md` 第 14 节，几何继续归既有 viewport owner。上行 v9 签名包仅为历史产物，不代表当前源码；本条及相关闪白事故保持 `OPEN`，物理真机 `NOT_VERIFIED`。 |
| 2026-09-27 v15 动态布局与 Topic 元数据修复验收 | 动态面板改为原生自然 height 与 maxHeight，父子同次 layout；测量只用于首测和开合移动距离。妖火现有 onPanelChange 包含键盘交接 pending，工具仍在交接成功后才 blur/展开，成功衔接不释放占用，失败、取消和迟到回执沿同一请求身份清理。viewport 最低 oracle 修前 3 项失败；Topic 原生高度归零至工具 ready 间隙及组件占用 oracle 修前共 5 项失败，见 ignored `.codex-tmp/ime-draw-rootcause-20260927/v15-dynamic-layout-red.log` 与 `.codex-tmp/ime-draw-rootcause-20260927/v15-yaohuo-metadata-red.log`。合并后相关六个 UI owner 306/306（seed `1243117478`），全量 typecheck、定向 lint/format/diff 通过，见同目录 `v15-related-ui.log`、`v15-typecheck.log`、`v15-eslint.log`。匹配 v15 的可见模拟器 Gboard 回放为 9 条目标样本通过：Photos 有键盘取消/无键盘成功、长文表情、已选表情、回复/私信关闭重开及 Topic 格式/表情/直接 Back；原帧报告分别为同目录 `.codex-tmp/ime-draw-rootcause-20260927/v15-photos-review.md`、`.codex-tmp/ime-draw-rootcause-20260927/v15-native-panel-review.md`、`.codex-tmp/ime-draw-rootcause-20260927/v15-shared-sheet-review.md`，仅限对应目标缺陷，不宣称零掉帧。正常入口 ARM64 包 buildId `bd5245cd7ae84c6bbabc99c4b6da4947`、SHA-256 `4d94c45cbc444a6ff1e0ef2678fa4dd5c1d39195fa61b55977668b4488834bb8`，原签名/正常入口/源码一致性静态核验通过。未连接原真机且正常 ARM64 包未运行；本条保持 `OPEN`，APK_SANITY 和物理真机 `NOT_VERIFIED`。 |
| 2026-09-28 真机残余闪现与 Structured 面板交接补齐 | 新真机录像确认 linux.do Topic 从键盘进入更多/表情时标题短暂展开再折回，分别为 41.333/49.022 ms，正文往返 104 px；录像包版本未确认。已知 v15 在可见 API35 模拟器复现同类格式入口回弹 198.244 ms，不能用上一轮妖火通过覆盖 Structured 路径。Runtime 现将工具交接 pending 纳入已有 PANEL_CHANGED.open，请求宿主收键盘前同步通知，成功连续接到实际 builder，失败/取消释放；不改变 expanded、上传焦点或渲染配置。rich/source 最低 owner 修前 2 项失败，修后 runtime/bridge 130 项及相关 UI 156 项通过，类型、lint、格式、架构与 diff 检查通过。v16 匹配源码的可见 Gboard 定向录像共 8 条、611 个编码帧：格式/表情/更多/Back 与 Photos 有无键盘各取消/模拟上传，未再见该标题往返或所查整块正文白帧；不声明零跳帧，表情关闭跨层先后变化仍如实保留。两条未确认选择/未启用上传 mock 的初始样本排除；成功上传后的 retained=false 表示不再等于种子正文，已以完整正文及上传计数另验保稿，example.invalid 图片下载不计通过。证据在 ignored `.codex-tmp/phone-flicker-20260928/` 的 `.codex-tmp/phone-flicker-20260928/phone-flicker-review.md`、`.codex-tmp/phone-flicker-20260928/v15-linuxdo-topic-format-before-review.md`、`.codex-tmp/phone-flicker-20260928/v16-panels-review.md`、`.codex-tmp/phone-flicker-20260928/v16-picker-review.md` 与 `.codex-tmp/phone-flicker-20260928/functional-check.json`。原签名正常入口 ARM64 包 buildId `14fc6068c7b748939cc792c2059e033b`、SHA-256 `0d32abe684e5c176769d29f93099df612c36bc6352b71169240d081bc3010c90` 已过静态核验；原真机和正常 ARM64 包启动仍 `NOT_VERIFIED`，本条保持 `OPEN`。 |
| 2026-10-04 同钟独立 Back 复现 | v2 诊断包 `f2ce897e…`、PID5547，普通 NodeSeek 空回复全屏、真实停靠 Gboard，仅一次 Back。34 个实际编码帧中，#16/17 已无键盘但面板底仍约 y1662，#18 才归位，首个已见失败至恢复为 43.302 ms。唯一原生目标的几何、shown、alpha 与 clip 已正常，正确布局对应 App 帧 536.960 ms、`drawGl` 272.899 ms，随后 SF 呈现与恢复帧对齐；支持旧 App buffer 延后提交，不支持把此时残留归给 toolbar 卸载或裁切。证据为 ignored `.codex-tmp/remaining-four-20261004-113939/editor-native-back-a1/analysis/review.md`。样本含 trace/probe，时长不作无探针性能基准。软件绘制对照与淘汰原因见 `REG-WRITE-121`；最终源码已恢复硬件绘制并移除诊断 probe，本条保持 `OPEN`。 |
| 2026-10-04 最终普通包独立 Back | 无 probe 的 APK `956bce1d…`、PID4362、真实停靠 Gboard，NodeSeek 空白全屏回复仅按一次 Back，随后 8 秒无其他操作。60 个原始编码帧完整复核：#17（PTS2.899467s）键盘已完全消失，但面板保留旧高位并露出下面的主题；#17–28 持续，#29（3.067300s）才归底，编码可见窗口 `167.833ms`，工具栏位置差约 745 px。不是最终静态截图或诊断 probe 的结论；原帧与 Winscope 时间轴一致，但本段无 trace，不能独自归因 GL 耗时。保持 `OPEN`，不以 Topic 工具栏回升通过关闭回复返回、跳步或光标柄范围。证据在 ignored `.codex-tmp/remaining-four-20261004-113939/final-editor-back/original-frame-review/back-review.md`。 |
| 2026-10-04 实际面板提交门修复 | `FixedComposerPanel` 自身承载 Host，并传稳定无 IME 目标高度；原生等待零进度、实际高度/位移、无待处理布局及所属硬件 frame commit，再复核身份和几何后 `finish(false)`。目标/几何变化、取消、失焦、禁用和 detach 使旧回调失效，无硬件提交能力沿系统 hide；没有固定延时或重挂正文。native 最低 RED 为「动画时间已到但旧面板仍不可结束」，修后键盘两 owners 38/38；对应 Host/viewport 等 UI 52/52（seed337528279）、Structured/妖火/Topic 调用方 170/170（seed-1923220454），类型与架构检查通过。普通 APK `937cf158…`、PID4294、主 AVD/Gboard、无 trace 的三次全屏和一次半屏独立 Back，完整 149 帧均未见键盘消失后的旧高位或尾差；仍有 798–814 px 大步位移。固定高度半屏的同一 WebView 始终为 1080×687，因此逐帧 resize 不是跳动的必要原因，未采用提前扩容/裁切重构。该阶段包中的 Search UNION 候选随后独立否决，不作为最终 Search 修复。原帧、字体和因果边界见 ignored `.codex-tmp/remaining-two-20261004-continue/endpoint-back-review.md`；真机、长文光标/选区与其他入口不计本段通过。 |
| 2026-10-04 半屏绘制归因与缓存对照 | 同为 Host 提交门加 WebView NONE 的普通 `937cf158…` 包，独立 trace 的半屏 Back 37 帧中 #12→13 位移 819 px，同期 App→SF 对应 buffer 呈现间隔 247.632 ms。关键 `drawGl` 为 224.588 ms，其中 5602 次 `glGet* encode` 合计 184.436 ms；主线程 doFrame 的 276.844 ms 中 Sleeping 272.966 ms、Record View draw 仅 0.130 ms。支持当前 AVD 的 WebView/HWUI GL 查询提交为瓶颈，不把它写成纯宿主往返、GPU 执行或模拟器崩溃，也不外推真机。临时父面板 hardware cache 的半屏/全屏仍跳约 745/744 px，78 帧未证明整体收益，属性已精确撤回；未采用软件绘制、固定延时或提前扩容。因果边界见 ignored `.codex-tmp/remaining-two-20261004-continue/endpoint-half-trace-back/gl-audit/review.md`、`.codex-tmp/remaining-two-20261004-continue/parent-hw-rejected-review.md`。 |
| 2026-10-04 最终硬件层普通包复验 | 普通 Release/Hermes APK `68651441d8508da45544d9ec97cf66af815cb751506f17563c7d1006198931b6`，sourceHash `62779f29ea9c57708023daff0672cbd33bac41a52bbd9ff163cfb00a42b75c63`，仅保留实际面板提交门，共享编辑器 hardware 和 RN 边框恢复原实现。主 AVD、真实 Gboard、PID2928、无 trace/probe；全屏 36 帧、半屏 41 帧逐原尺寸复核。全屏首个 IME 全消为 #14（PTS3.122967s），此时已到终位；半屏 #19（PTS2.879678s）全消，面板 #15 已到终位，两段之后均无旧高位或尾差。全屏仍跳 798+21 px，半屏为 16+58+740+5 px；文字全屏全部 36 px，半屏 40 帧 36 px、#13 墨迹边界 37 px，未见压扁。本轮 `WRITE-01/07` 仅该末端样本为 `LIVE_PASS`，完整动画、长文光标/选区、选图完整矩阵与真机不计通过。三站登录、UID、首次安装时间保持，741 份 runtime 文件与 APK 身份相符；证据在 ignored `.codex-tmp/remaining-two-20261004-continue/hardware-back-final-review.md`、`.codex-tmp/remaining-two-20261004-continue/hardware-source-check.json`、`.codex-tmp/remaining-two-20261004-continue/hardware-final-device.json`。中间 NONE 并未稳定解决 Topic 回升，已撤回，详见 `REG-WRITE-121`。 |
| 2026-10-04 图形查询根因追查 | 实际 provider 为 `com.android.webview 156.0.8062.0`，APK/ELF 与官方 Chromium tag 的 ANGLE revision `2db891493f26` 对齐，但安装包原始下载来源未确认。既有同次 trace 的 44 次 drawGl 均有 5602 次查询，种类与顺序吻合 external context 全状态保存；3724 次 glGetError 是调用数量，不代表实际错误数量，官方 gfxstream safe 查询的错误保全即可解释成对调用，不能认定启用了调试断言。上游 [e6447ec](https://github.com/google/angle/commit/e6447ec72629e569f80a0a7940fca784b746cb41) 于 2026-08-05 扩大 external 状态保存范围，是具体候选回归点；尚无前后版本单变量实测，不能定为唯一根因。未找到 App 可安全关闭全状态查询的公开 API。安装异常经用户授权保留数据恢复后，同 AVD、同 c629 诊断 APK 的独立原生 Activity 对照已完成：无 RN/Composer 页面树的 GL WebView 19 次 drawGl 均为 5602 次查询，wall min/median/max 为 219.8178/227.4881/267.4514 ms；临时 HWUI Vulkan 的 360 次 drawVk 均无该查询，wall 为 1.5255/1.91215/5.2311 ms，两段全部对应 App/SF，trace 无错误。原生 EditText 控制无 WebView functor。RN/Composer 页面树不是该每次成本的必要条件，但 MainApplication 仍初始化原生依赖；GL→Vulkan 对照支持当前 GL 互操作路径为瓶颈，不能单独定责某个库或候选提交。这是归因证据，不计产品通过。summary 见 ignored `.codex-tmp/editor-root-cause-20261004/` 下的 `native-analysis-v2/summary.json`、`web-analysis-v3/summary.json`、`web-analysis-vulkan-v1/summary.json`。只读证据、二进制身份与固定版本源码链接见 ignored `.codex-tmp/remaining-two-20261004-continue/editor-gl-query-root-cause-research.md`。 |
| 2026-10-04 普通包临时 Vulkan Back 对照 | 同普通 APK `68651441…`、PID3248，仅临时改变 HWUI renderer；全屏 57 帧、半屏 75 帧，共 132 个实际编码帧按原尺寸复核。两段端点稳定，无旧高位或 21 px 尾条，文字墨迹为 36/37 px，未见软件绘制式压扁；最大相邻位置变化为 130/126 px，均记录到 16 次位置变化，相比默认 GL 的 798/740 px 大步明显减少。默认 GL 当前样本本已通过末端归位，因此不将该端点修复归功于 Vulkan，也不以编码帧推断连续显示帧率。当前未找到 App 可稳定按进程选择 HWUI Vulkan 的公开 API，所用 `debug.hwui.renderer` 是临时系统调试属性，实验后恢复 `skiagl`；不是支持的产品修复，默认 GL 完整平滑度及真机仍未闭合，本条保持 `OPEN`。独立原帧报告见 ignored `.codex-tmp/vulkan-back-visual-audit-20261004/review.md`。 |
| 2026-10-04 成对开关普通包 Back 复验 | 普通默认 GL APK `8f73fcfc…`、PID2839，NodeSeek 空全屏回复、真实 Gboard，仅独立 Back。37 个实际编码帧全片原尺寸复核：首个 IME 全消帧 #15（PTS3.105322222s）工具栏已在终位，#15–37 无旧高位或 21 px 尾差；#13→14 仍有最大 739 px 跳步，PTS 间隔 156.011111 ms 不能当作刷新率。35 帧占位文字墨迹高 36 px，#12/13 为 37 px，未见压扁。此末端样本为 `LIVE_PASS`，完整动画、长文光标柄与真机仍未通过；剩余渲染性能按用户要求暂停，状态保留 `OPEN`。独立报告见 ignored `.codex-tmp/pair-ordinary-gl-back-visual-audit-20261004/review.md`。 |

## `REG-WRITE-088` 新版 WebView 重复避让与 Activity 返回后的旧动画样式残留

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。新版 WebView 重复 IME 避让、Reanimated 旧样式、Activity 恢复聚焦与新帖旧 padding 已修，并有局部 Live；剩余为原始物理设备样本与完整编辑、私信和妖火矩阵。 |
| 能力 ID | `WRITE-01/04/05/07`、`NOTIFY-02` |
| 历史症状与根因 | 用户 2026-09-16 新录屏中，回复标题仍在，HTML 格式工具栏短暂被裁掉再恢复。此前键盘验证设备的 WebView 是 124，不包含 M139 起的 IME visual viewport 缩放；`REG-WRITE-086/087` 的设备通过不能代表新版内核或真机通过。 |
| 根因与修复 | 原生 Composer 已按 IME 帧移动/缩放容器，但子 WebView 仍收到已处理的 IME Insets。共享编辑器设置 `automaticallyAdjustContentInsets=false`；对应 Android wrapper 补丁在目标布局和动画帧中只将 IME 置零，继续发送归零事件并保留系统栏 Insets。 |
| 当前 owner | `tests/native/ComposerWebViewInsetsTest.kt` 真实 Android View 分发覆盖目标、连续开合、动画 progress、系统栏保留、输入对象不变及默认恢复；`tests/ui/topic/structured-reply-composer.test.tsx` 固定共享 WebView prop wiring。 |
| 最低可靠证据 | 原生测试修复前 expected 0 / actual 336，修复后通过；相关 Composer UI 98 项、Vitest 60 项和 typecheck 通过。补丁通过干净 npm 依赖 forward/postinstall 验证。 |
| 二次定位 | 只修 WebView 后，非诊断 APK 仍在选图返回时悬空停留，否证单一 Insets 假设。上游 [Reanimated #9574](https://github.com/software-mansion/react-native-reanimated/issues/9574) 含相同 4.5.1 / RN 0.86 / Expo 57 和外部图片 Activity 触发；完整回补其维护者指向的 [PR #9527](https://github.com/software-mansion/react-native-reanimated/pull/9527) runtime/build 改动，按已同步状态回收动画值，并使重新动画前的旧 React 样式失效。 |
| 新增 owner | `tests/tooling/reanimated-settled-props.test.ts` 执行实际依赖的 GC：嵌套 host 重复 unregister 后再次注册，旧版无法同步（0 次调用），补丁后恢复且停止定时器；12 项 patch owner 及干净原始 npm 包 forward/postinstall/reverse 检查通过。C++ 暂停恢复缺陷由修复前后实际 APK 录屏拥有，JS 回归不冒充 C++ 单测。 |
| 设备验证 | 用户授权更新有数据模拟器至 Chromium 官方测试 WebView 156.0.8062.0，firstInstallTime `2026-07-26 16:51:37` 保持。回补后非诊断 APK 的 NS 半屏富文本连续两次选图取消返回均贴底；4503B 合成 PNG 真实选择、上传、预览成功，返回不弹键盘；全屏源码收起/重开键盘及选图取消通过。L 首次上传尝试后账号变为匿名，冻结设备变更；用户手动重新登录后，真实上传及预览成功，源码保留 `upload://`，源码往返、全屏收起/重开键盘和选图取消通过。两站本次插入均已撤销、未发送回复，收尾账号中心仍为 3/3 已登录。录屏未重现此前工具栏单独裁切或持续悬空；不能据此宣称所有动画帧零卡顿。 |
| 验收缺口 | `WRITE-04` 的 L/NS 本次样本为 `LIVE_PASS`；`WRITE-01/05` 回复路径有设备录屏，但物理设备、微信失败原始样本及完整编辑/私信/妖火矩阵仍为 `NOT_VERIFIED`，`NOTIFY-02` 不借用回复通过结果。保留 `OPEN` 直到物理设备复核。arm64 测试包 1.3.144 / 148，buildId `709dd17a88ea4b388c0c9ca9dc5eaa89`，签名、16K 对齐和无诊断探针检查为 `APK_SANITY`。 |
| 2026-09-20 再定位 | 真实 linux.do 富文本回复选图后，CDP 元数据记录前台恢复约 0.9 秒后收到 native `COMMAND focus`，比上传回执早约 1.5 秒，否证「上传完成直接 focus」的猜测。`TopicRoute.active = focused && appActive` 经 `visible && routeActive` 把恢复 Activity 变成新打开，重新消耗首次 focus；另固定 content 在 IME 已覆盖导航区时仍保留安全区 padding，形成额外底部白带。 |
| 本次共享修复与 owner | ComposerBottomSheet 分开 logical visible 与 active，恢复只显示原输入器、不重置 focus 或 presentation；同一原生 IME 帧消除已覆盖的底部导航 padding，不增加二次位移。`tests/ui/topic/topic-components.test.tsx` 的真实 ReplyComposerSheet 前台恢复 oracle 与 `tests/ui/topic/composer-keyboard-viewport.test.tsx` 的导航区 oracle 均先失败后通过；共享输入器/Bridge/runtime 测试覆盖临时上传占位、逻辑选区映射、取消/失败、旧文档与异步不聚焦。此行为修复的设备三站矩阵由本轮新 APK 验收补充，不能引用旧包通过结果，物理设备缺口仍保留。 |
| 2026-09-21 新帖窗口交接 | `WRITE-07` 的新帖页面另有永久键盘观察：只需正文唤起 IME → 图片面板 → 关闭，即在无选图、无上传时留下约 819 px 底部空白。原生 IME 已隐藏、Activity/RN root 仍高 2400 px，而 safe-area 仅高 1581 px，确认是页面旧键盘 padding，并非父窗口缩小。当前页面只在前台且无 Native Modal 时挂载原生键盘观察，交接释放并归零页面 padding，返回重新观察；同一编辑器和草稿保留。`tests/ui/topic-composer/create-topic-screen.test.tsx` 的缺失末帧 oracle 先失败后通过，Screen 27 项及 typecheck 通过；实际窗口几何仍待匹配 APK 验证，不以该 UI 测试关闭物理设备缺口。 |
| 新帖几何复核 | 匹配 `geometry-fixed.apk`（SHA-256 `3200E5C7BAC6EDD1B637D88726C2BD20AF2A7A27C37E97A34B13E893C90451EF`）覆盖安装且 firstInstallTime `2026-07-26 16:51:37` 保持。同一 NodeSeek 新帖正文唤起 IME → 图片面板 → 关闭后，safe-area 恢复 2400 px、底栏下缘 2337 px；再次唤起 IME 为 1581 px/1518 px，系统返回收键盘及 Home 后回 App 均恢复 2400 px/2337 px、IME 隐藏。该原生窗口入口记 `LIVE_PASS`，无发帖；后续 UI 重排需以最终包重验，物理设备缺口和 `OPEN` 保留。 |

## `REG-MORE-007` 新版 WebView 冷启动时代理应用早于内核就绪

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `MORE-01` |
| 历史症状与根因 | 有数据模拟器更新至 Chromium WebView 156 后，冷启动显示代理异常，主题请求报 `Must be started before we block!`。加载 WebView provider 不等于 Chromium 已启动；原生代理事务在内核就绪前调用 ProxyController，重试业务请求不能修复启动失败。 |
| 当前 owner | `modules/forum-platform/android/src/test/java/com/wz/reader/network/NetworkProxyRuntimeTest.kt` 保有代理事务、超时和隔离行为；原生 `applyProxy` 在现有串行事务内等待 AndroidX `startUpWebView` 成功，再开始代理状态切换。失败沿现有错误路径返回，不清配置或登录态。 |
| 失败 oracle 与边界 | 更新后的原包冷启动稳定阻断首页和 NS 详情；修复包覆盖安装后冷启动加载首页与 NS 详情，首次安装时间保持。现有原生代理回归 85 项通过，启动顺序另由此真实 APK 冷启动证据验证；未把旧测试计作新启动分支的单测覆盖。物理设备为 `NOT_VERIFIED`。 |

## `REG-NAV-007` 后台默认 UA 读取触发 WebView 首启竞争

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。生产默认 UA 读取已接入主线程，原生红绿测试与 probe 首启对照通过；无 marker 的正式集成包首启、UA 保持、编辑器可用性及物理设备仍待验收。 |
| 能力 ID | `NAV-01`、`MORE-01` 的共享 WebView 平台初始化入口 |
| 历史症状与根因 | 2026-09-27 可见 API 35 模拟器覆盖安装后首启间歇退出，重开正常。精确核对当前 WebView 156.0.8062.0 APK 与 DEX 后，`WV.ye1.b:91` 对应异步启动 continuation 读到空任务队列的断言；官方同版本 `SharedStatics` 确认后台 `getDefaultUserAgent` 会主动调度 Chromium 启动。实际 probe 捕获 `NetworkProxyModule.getConstants` 在 `mqt_v_js` 读取 UA；共享入口没有约束线程，可能与首个 UI WebView 的同步初始化竞争。此事故独立于代理内核就绪门禁、返回预热及 IME 底部间距。 |
| 当前 owner | `NetworkProxyModule.kt` 的专用 `readDefaultWebViewUserAgentOnMainThread` 供实际 `getConstants` 调用；主线程直接读，后台一次派发并有界等待，超时/中断取消排队任务、保留中断和 provider 原异常。`modules/forum-platform/android/src/test/java/com/wz/reader/network/NetworkProxyRuntimeTest.kt` 固定线程、原值、主线程直接执行、派发失败、超时及中断取消；不新建全局 WebView，也不改变代理启动事务。 |
| 已执行对照与待验 | 同一 probe APK 的 marker-off 匹配日志记录 PID5258 在后台 UA 返回后触发同一空队列断言；marker-on 两次覆盖安装首启均在 main 读取相同长度/hash 的 UA，进程正常且隔离入口可见。`ua-off-first-start.log` 混有历史崩溃，不能将整份日志当作多个独立匹配样本。线程 oracle 在保持原行为的 seam 上实际执行 6 项、4 项失败；正式 FutureTask 修复后完整 `NetworkProxyRuntimeTest` 共 94 项通过，failures/errors/skipped 均为 0。无临时 marker 的正式集成 APK 首启、UA 保持与编辑器可用性仍待验证。本轮样本不能宣称统计上彻底消除竞态，物理设备为 `NOT_VERIFIED`，状态保持 `OPEN`；不据此关闭 `REG-WRITE-087/121/122`。 |
| 本机证据 | ignored `.codex-tmp/ime-draw-rootcause-20260927/startup-assertion-findings.md` 保存 provider provenance、精确分支及官方源码；同目录 `ua-off-first-start.log`、`ua-off-second-install.log`、`ua-on-first-install.log`、`ua-on-second-install.log`、`ua-test-red.log`、`ua-test-green.log` 与 `ua-test-green.xml` 保存按本轮 PID 区分的设备对照和 native 红绿结果。日志与 APK 不进入版本库。 |

## `REG-NOTIFY-067` 有界投递扫描覆盖权威未读总数

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03` |
| 历史症状与根因 | 最多 60 条扫描中的 unreadCount 被写回 Store，与 snapshot 总数争夺所有权，80 被改小、样本 0 清除可信提示。 |
| 当前 owner | `src/platform/notifications/notificationWorker.test.ts`、`src/platform/notifications/notificationStore.test.ts`、`tests/ui/notifications/notifications-runtime.test.tsx`；投递仅提交 ID/水位/identifier，snapshot 独占总数。 |
| 失败 oracle 与边界 | 真实 worker+Store 两项红例及重挂载/snapshot 失败回归；A/B 投递成功、回滚、身份变化保留。没有增加后台总数请求或无限分页。 |

## `REG-FEED-032` 冷筛选仍重建 Android 底层滚动视图

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `FEED-02/04` |
| 历史症状与根因 | 隔离 Release Hermes 设备检查发现：FlashList React 组件未重挂，但冷筛选移除 RNGH RefreshControl，RN Android ScrollView 随父子结构变化重建原生视图。仅统计 mock FlashList 的 mount 无法发现。 |
| 当前 owner | `dev/review-remediation-proof/index.tsx` 的真实 controller / FeedScreen / FlashList 原生 host 检查，经 `scripts/run-review-remediation-device-proof.mjs` 仅在指定隔离 AVD 执行；UI owner 仍为 `tests/ui/feed/feed-screen.test.tsx`。冷筛选保留 RefreshControl，仅禁用刷新。 |
| 失败 oracle 与边界 | 两个 pending→成功/失败的设备用例修复前失败、修复后通过，同时断言旧条目隐藏；41 项运行时设备检查通过。未新增状态机，未将 host 保留推断为性能改善；真实手势和物理设备触感独立验收。 |

## `REG-TOPIC-170` Stardust renderer 重建丢失付款结果未知状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02/03`、`WRITE-01` |
| 历史症状与根因 | 排查表格闪现时发现同一个 `genericHtmlRenderers` memo 内定义 Stardust 组件类型并捕获整个 actions；无关 actions 更新会卸载卡片并重新读取付款状态，丢失卡片本地 `paymentUnknown`、`paymentNotice` 和 `paying` 等状态。用户随后确认收款卡有时持续闪现。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx` 挂载真实生产列表与卡片，固定前后台、busy 和权限变化时原 host、已读状态及请求次数，最新回调可用；mock 付款返回 unknown 后继续更新 actions，「结果待确认」仍禁用且不能再次付款。原卡片级业务分支继续由 `topic-components` 拥有。 |
| 修复与验证边界 | renderer 改为模块级稳定组件，通过列表根部 Context 接收最新 actions。原回归以 seed `73151222` 证明付款保护丢失；加强后的挂载回归以 seed `2011210180` 修复前失败、修复后通过，四套相关 UI 共 205 项通过。未执行真实付款，真实设备持续闪现及原站付款链路为 `NOT_VERIFIED`。 |
| 本轮收口 | 本项与 WebView renderer 隔离修复共同通过 Node 22 `npm run verify`：Vitest 207 套件、2539 项，seed `1789533117971`；Jest 77 套件、1508 项全部正常通过，seed `207276750`，不再保留这两项 expected-failure。类型、lint、格式、架构、文档、unused 与版本检查通过。 |
| 2026-09-16 模拟器验收 | `DEVICE_REPLAY_PASS`：API 35 隔离 Release Hermes 挂载真实生产列表与卡片，14 次 actions 更新、4 次 Home/恢复期间同一 Native View 保持；状态读取仅初始 1 次及模拟付款后 1 次，unknown 后再点击仍只有 1 次付款调用。测试使用合成响应，没有真实付款；原站付款交易与物理设备仍为 `NOT_VERIFIED`。 |

## `REG-TOPIC-171` WebView 阻断提示更新重建普通图片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | `useHtmlRenderingController` 把 WebView、图片、音视频等 renderer 放在同一个工厂 memo 中；`webViewBlockMessage` 变化重建全部类型，即使普通图片的来源、身份和样式均未改变。 |
| 当前 owner | `tests/ui/topic/topic-image-loading.test.tsx`：真实 controller 与图片 renderer 完成 load/display 后只更新 WebView 阻断提示，原图片 frame 与已显示状态保留；音频/视频同层 owner 固定阻断与恢复时原 host、player、播放位置和播放状态，无 release 或重新装载；iframe 仍立即显示最新阻断原因并在解除后挂载 WebView。 |
| 修复与验证边界 | iframe factory 与正文媒体 factory 分离，各自按所需数据 memoize；阻断提示不再重建普通图片、贴纸、链接卡片和音视频组件类型。图片回归以 seed `2011210180` 修复前失败、修复后通过，四套相关 UI 共 205 项通过；音视频播放器的 Native 边界使用 mock，设备闪烁与真实代理切换仍为 `NOT_VERIFIED`。 |
| 2026-09-16 模拟器验收 | `DEVICE_REPLAY_PASS`：API 35 隔离 Release Hermes 使用本地合成 PNG/WAV/MP4 与真实图片加载器、播放器；每类连续 8 次切换 WebView 阻断提示，原生图片/音频/视频 View 均保持，音频继续播放且进度不归零，视频 ExoPlayer 同一实例、保持播放且进度保持在预设的 4 秒之后。两项原生测试全部通过；真实代理切换和物理设备仍为 `NOT_VERIFIED`。 |

## `REG-TOPIC-169` 表格在前后台切换时重挂载

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/02/03`、`NAV-03` |
| 历史症状与根因 | 用户报告 linux.do 主题 `2908426` 的表格在回到 App 时闪现。`TopicContentList` 在依赖整组 actions 的 memo 中创建 table/td/th 组件；actions 每次 controller render 都返回新对象，前后台变化会重建这些组件类型并卸载原滚动容器与单元格。 |
| 当前 owner | `tests/ui/topic/topic-rich-text-selection.test.tsx` 挂载真实生产列表与 HTML renderer，以与 controller 相同的新 actions 对象更新前后台状态，固定原滚动容器和单元格身份；既有 `topic-table-rendering` 继续拥有尺寸、分段横滚与选择手势。 |
| 失败 oracle 与边界 | 新 owner 修复前失败，独立按字号与样式 memoize table renderer 后，两套 UI 共 34 项通过，seed `73151222`。这证明重挂载根因已修复；原帖 Android 前后台的最终视觉效果仍需匹配修复构建验收，不以 UI host 身份断言代替 Live。 |
| 表格修复首轮收口 | Node 22：Vitest 207 套件、2539 项通过；Jest 77 套件、1504 项正常通过及当时两项 OPEN expected-failure，seed `2011210180`；后续两项修复见各自历史条目。lint、格式、架构、文档、typecheck、unused、版本一致性与 diff 检查通过；未安装或发布修复构建，Live 为 `NOT_VERIFIED`。 |
| 2026-09-16 模拟器验收 | 当前源码的完整 Release APK 覆盖安装至 API 35 主模拟器，安装身份与首次安装时间保持。原帖 `2908426` 横滚到右侧后连续 3 次 Home/恢复，前后截图完全一致；62 秒录屏的 280 个原始帧中，169 个完整页面帧未见表格闪空或横向位置回退，记 `LIVE_PASS`。隔离 Release Hermes 原生断言另验证 14 次 actions 更新与 4 次 Home/恢复时同一滚动 View、`scrollX=168` 和收款卡实例保持；物理设备仍为 `NOT_VERIFIED`。 |

## `REG-TOPIC-168` Copy 剪贴板拒绝异常逃出 ActionMode

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/02/03`；Native selection |
| 历史症状与根因 | 独立测试 AVD 对实际 selection View 的剪贴板边界注入 SecurityException，异常逃出 ActionMode；这是受控复现，不是历史生产崩溃报告。 |
| 当前 owner | `ForumContentSelectionViewTest.kt`；局部捕获已证实的平台拒绝，提示并保留选区，成功才结束。Native copy-denied 为本地事件。 |
| 失败 oracle 与边界 | 修复前 instrumentation 48 项中 1 项失败，修复后 48 项通过，包含拒绝后重试及长 Unicode 全文复制读回。不截断或记录正文；其他平台异常、物理设备为 `NOT_VERIFIED`。 |

## `REG-ACCOUNT-053` CF 验证后公开读取仍未携带凭据

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-02`、`FEED-*`、`TOPIC-01/03`、`USER-01` |
| 历史症状与根因 | 鸿蒙/卓易通日志中 L 站 23 次详情请求均有 stored clearance、无 sent clearance；验证后重试仍遭挑战。ReadGateway 的公开通道强制 omit 丢弃全部 Cookie。NS 共享该问题，且检测得到 anonymous 时提前返回、不恢复公开任务。 |
| 当前 owner | `src/domain/forum/readPlan.test.ts`、`src/sources/readGatewayContract.test.ts`、`modules/forum-platform/android/src/test/java/com/wz/reader/network/NetworkProxyRuntimeTest.kt` 与 `tests/ui/account/account-runtime.test.tsx`。原生真实 HTTP oracle 在模拟验证更新平台 Cookie 后，修复前仍返回 403；NS 未登录恢复 oracle 修复前零 resume。 |
| 修复与边界 | 原生按每跳准确 URL 读取 CF-only，拒绝账号 Cookie 和跨 origin 传播，保留响应写入边界；NS 允许未登录的当前公开任务恢复，身份变化与取消仍失效。Android 模拟器的已登录与匿名 L 站均完成真实 CF 后恢复原详情；匿名连续打开 5 个帖子并刷新原帖，日志确认验证后 7 次详情请求带最新 CF、无账号 Cookie。NS 真实 CF 与故障鸿蒙真机仍为 `NOT_VERIFIED`，不承诺服务端一定接受既有 clearance。 |

## `REG-TOPIC-172` 关闭的回复背景拦截详情全部触摸

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`WRITE-01` |
| 历史症状与根因 | 鸿蒙/卓易通中 L/NS 详情初始可滚，加载后返回、回复、滚动均失效；日志确认触摸进入共享回复面板的全屏 AUTO 背景，alpha 约 1.418e-8，面板 visible=false，JS 与主线程仍响应。库以动画 index 的精确边界决定穿透；机型触发差异的底层原因尚未证实。 |
| 当前 owner | `tests/ui/topic/topic-components.test.tsx` 固定接近 -1 的动画值、关闭状态与动态/固定布局切换，修复前背景没有受控 none；既有 composer keyboard/structured/message owner 承接打开与编辑器行为。 |
| 修复与关闭条件 | 共享背景由 visible 直接决定触摸，动画只负责透明度；不改编辑器挂载顺序、不加机型特判。代码/UI oracle 已修复；普通 Android 模拟器的匿名 L/NS 详情滚动与返回、已登录 L/NS 回复面板开关后继续滚动已通过。2026-09-17 用户反馈鸿蒙真机使用本次测试包后问题已消失，据此关闭设备事故；此为用户复测证据。随后撤除临时触摸/心跳/视图路径探针，保留修复及常规诊断。 |

## `REG-DATA-009` 备份合并提前裁剪删除标记导致复活

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-03` |
| 历史症状与根因 | 受控合并及实际 SQLite 导入/重开均复现：删除标记并集超过 1000 条时，旧但有效的删除标记先被裁掉，再导入更旧记录导致复活。 |
| 当前 owner | `src/domain/reader/readerData.test.ts` 三类集合 × 999/1000/1001 × 记录较新/删除较新/同时间；`src/platform/storage/readerDataStore.test.ts` 实际导入和重开。 |
| 修复与边界 | 完整并集先解决冲突，最后执行原有裁剪；同时间删除优先，保留上限、备份 v2 和 schema 不变。新反例修复前失败，修复后通过；不扩大为永久保存删除历史。 |

## `REG-DATA-010` 恢复模式将默认设置误当来源许可

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-02`、`MORE-05`；共享来源消费者 |
| 历史症状与根因 | ReaderData 读取失败仍发布 loaded=true 与默认设置，App 和部分页面据此启用来源；「本地启动结算」与「设置可信」混用。 |
| 当前 owner | `tests/ui/library/reader-data-controller.test.tsx`、`tests/ui/app/app-runtime-startup.test.tsx`、`tests/ui/notifications/notifications-runtime.test.tsx`，沿既有 route gates 覆盖页面。 |
| 修复与边界 | 单一 loading/ready/recovery 状态；本地恢复可达，网络来源投影为空，通知设置未可信且不清理意图。失败导入保持保护，成功导入准确放行，首次安装默认行为保留。UI/存储边界验证不代表设备损坏数据库恢复已验收。 |

## `REG-NOTIFY-068` 详情已读尝试被永久当作完成

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`；关联 `NOTIFY-01/03` |
| 历史症状与根因 | 详情永久记录「已开始」，离页取消后同一实例返回不能重试；详情变化还会取消在途标记。直接漏写主要影响 NodeSeek 与 linux.do 非私信。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx`，真实导航保留详情实例；失败/未确认显式重试先刷新详情，防双击、普通刷新不取消或重试，确认后不重复。 |
| 修复与边界 | 尝试与确认分开，并绑定当前请求；生命周期取消与详情刷新分离。成功、失败、取消仍对账，旧回调不能污染新请求，对账失败不降级确认。`REG-NOTIFY-065` 已修复的取消后对账事实保留。未执行真实远端已读写入。 |


## `REG-SEARCH-029` 等待写入时删除搜索历史后复活

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `SEARCH-02` |
| 历史症状与根因 | 去重标记只在旧写入完成后更新；删除等于旧磁盘快照时被跳过，导致界面与队列目标分叉。 |
| 当前 owner | `tests/ui/search/search-controller-ai.test.tsx` |
| 失败 oracle 与边界 | 真实 controller 与写入队列延迟添加→删除、A→B→A、失败后重试与重挂载。修复前两项反例失败；按最新排队目标去重后通过。产品反例以 Node 22.22.2 验证；受控测试不代表原站 Live。 |


## `REG-TOPIC-173` NodeSeek DOM 缺行时作者与正文错配

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03` |
| 历史症状与根因 | 无 ID/楼层匹配时按数组位置取正文，DOM 缺行会把相邻作者正文拼接给当前评论；重复身份与交叉冲突也未拒绝。 |
| 当前 owner | `tests/integration/hidden-browser-scripts.test.ts` |
| 失败 oracle 与边界 | 真实注入脚本与最终解析共同核对缺行、乱序、重复 DOM/embedded 身份、重复楼层、ID/楼层冲突和楼层 0。新增反例修复前失败，唯一一致匹配后通过；没有请求原站。产品反例以 Node 22.22.2 验证；受控测试不代表原站 Live。 |


## `REG-USER-012` 妖火用户主题聚合截断导致下一游标漏项

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 首轮已消费多页 HTML 后用 slice(0,30) 丢弃尾部，却返回这些页之后的游标。 |
| 当前 owner | `src/sources/sourceUserRead.test.ts` |
| 失败 oracle 与边界 | 真实适配器遍历 14+15+15+2、20+20、29+1、29+30、跨页重复与末页；修复前两项缺项，返回已读取页全部去重记录后完整且无重复。产品反例以 Node 22.22.2 验证；受控测试不代表原站 Live。 |


## `REG-USER-013` 无关 NodeSeek 解析错误污染其他用户页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | disabled Query 仍可读到缓存 error；页面无条件展示，旧验证恢复闭包还可通过 QueryObserver refetch 作用到新用户。 |
| 当前 owner | `tests/ui/user/user-controller-session.test.tsx` |
| 失败 oracle 与边界 | 同名跨来源、数字 UID、新/同实例、用户名/epoch 切换、卸载与迟到响应；修复前旧错误及恢复作用域反例失败。只有当前解析需求和作用域可消费错误及执行恢复，真实当前解析失败仍可重试。产品反例以 Node 22.22.2 验证；受控测试不代表原站 Live。 |


## `REG-TOPIC-175` 首次详情取消后失去恢复入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03` |
| 历史症状与根因 | 页面把后台与路由失焦混用，取消首次请求后又将 reading entry 当成已完成，出现无数据、无请求而持续等待。 |
| 当前 owner | `tests/ui/topic/topic-route-verification.test.tsx`、`tests/ui/topic/topic-session-controller.test.tsx` |
| 修复与边界 | 四来源跨后台保留原 deadline，真实失焦取消后可恢复；真实失败返回仍不自动重读。媒体与验证返回授权继续受前台状态限制。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-TOPIC-176` 新回复将零基线和未知楼号混为一谈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03`、`DATA-01/03` |
| 历史症状与根因 | 历史缺失被表示为 0，逐楼 New 又由当前窗口最大楼号减去新增数量推断，导致旧楼误标和 0→新增不提示。 |
| 当前 owner | `tests/ui/topic/topic-reply-filters.test.tsx`、`src/platform/storage/readerDataStore.test.ts`、`src/domain/reader/readerBackup.test.ts` |
| 修复与边界 | 计数与可缺失的可信水位独立存储，进入时冻结；缺历史、0、未知水位、稀疏楼号、排序/过滤/窗口变化及旧备份往返由行为 owner 验证。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-TOPIC-177` 非连续终端报告吞掉中间正文和图片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/02/03` |
| 历史症状与根因 | 跨任意 HTML 的终端分组正则以首末小节包围整段，重建时丢弃中间普通节点。 |
| 当前 owner | `src/domain/forum/contentSanitizer.test.ts`、`src/domain/forum/topicContentSplit.test.ts`、`tests/ui/topic/topic-rich-text-selection.test.tsx` |
| 修复与边界 | 改为同父节点连续小节 DOM 合并，文字/图片/列表中断分组并原位保留；安全过滤、ANSI 和 magic-tab 继续保留。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-TOPIC-178` linux.do 稀疏楼层引用读到相邻帖子

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-03` |
| 历史症状与根因 | 使用 stream[floor-1] 推算 post ID；删除楼层使 stream 下标与 post_number 分离。 |
| 当前 owner | `src/sources/linuxdo/reader.test.ts` |
| 修复与边界 | 按楼号读取目标窗口，唯一匹配 post_number 并校验主题和删除状态，不下载整帖。固定 HTTP 反例在旧实现失败，修复后目标为 25 楼而非 26 楼。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-WRITE-092` 投票防重复 journal 并发覆盖及发送前无持久意图

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-05` |
| 历史症状与根因 | AsyncStorage 整数组读改写会丢并发记录，最多 32 条淘汰又会遗忘旧结果；发送后才登记在崩溃/断连时留下重复创建窗口。 |
| 当前 owner | `src/platform/persistence/nodeSeekPollJournal.test.ts`、`tests/ui/topic/topic-actions-controller.test.tsx`、`src/platform/network/request.test.ts` |
| 修复与边界 | 独立 SQLite 复合主键和发送前 claim；发送结果不明保留未知，已知结果写回捕获账号且不降级。严格迁移重读后清旧键，ReaderData 操作隔离；不提供冷启动草稿恢复。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-NOTIFY-070` 不完整扫描提前建立通知基线

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03` |
| 历史症状与根因 | 解析诊断只是旁路，业务把部分或全部解析失败视作可信空/少量结果，推进 baseline 与成功状态。 |
| 当前 owner | `tests/integration/notification-delivery-contracts.test.ts`、`src/platform/notifications/notificationWorker.test.ts`、`tests/ui/notifications/notifications-route.test.tsx` |
| 修复与边界 | 必填质量进入来源返回值；后台单来源全轮可信才提交，首次可信扫描静默。前台 partial 有效项可见，invalid 保留精确身份/查询/页的旧内容，未知未读不当成零。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-NOTIFY-071` 分页重叠重复摘要与完成来源重新翻页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03` |
| 历史症状与根因 | 摘要按重复扫描行计数；聚合下一游标丢失之前的 null 终态，第三轮重新读取已完成来源。 |
| 当前 owner | `tests/integration/notification-delivery-contracts.test.ts`、`src/sources/notificationGateway.test.ts`、`src/sources/yaohuo/notifications.test.ts` |
| 修复与边界 | 先按 source/ID 去重再计算差集与摘要，仍保留原始 60 条预算；保留逐来源终态，游标异常整轮失败。妖火未读总数在末页跨预算时也不得使用截断数。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |


## `REG-DATA-011` 旧 settings sidecar 或清理挂起阻断启动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-02` |
| 历史症状与根因 | AsyncStorage sidecar 与清理未使用有界等待，已读出的 ReaderData 仍可能无法交付。 |
| 当前 owner | `src/platform/storage/readerDataStore.test.ts`、`tests/ui/app/app-runtime-startup.test.tsx` |
| 修复与边界 | sidecar 超过 3 秒沿用默认设置并保留已读资料；旧键清理单独 3 秒，超时留下 cleanup_pending 下次重试，迟到设置不重新发布。SQLite 事务继续串行完成，不超时返回空数据。代码与受控行为证据不代表原站 Live；设备结果按本次匹配构建记录单列。 |

## `REG-TOPIC-179` 图片销毁或换绑后仍执行旧 resize 任务

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | ExpoImageViewWrapper 在销毁、更换 recyclingKey 或实际 source/placeholder 改变时未更新 resize generation，排队的旧任务仍执行实际清理。同 key 的真实 A→B 换绑出现 [A,B,B] 三次请求；原补丁字符串断言不能发现关键 guard 缺失。 |
| 当前 owner | `patches/expo-image+57.0.4.patch` 的 `ExpoImageViewWrapperTest`，关联 `patches/react-native+0.86.3.patch` 的 `ReactImageViewEventTest`；patch 适用性仍归 `tests/tooling/patch-artifacts.test.ts`。 |
| 修复与边界 | 按销毁、recyclingKey 和实际 Glide model 变化同步递增 generation；真实 Activity/View/主队列验证同/不同 key 换绑恰有 A/B 两次请求与事件，旧队列不清理 B，最终 Drawable/source 为 B。同 model 重新包装后的合法 resize 仍执行一次。移除 generation 检查、请求绑定事件或禁合并保护时共 6 个反例失败；source-only 修复另有 1 个真实请求数红灯。恢复后 5 个 Native owner 的 17 项通过。删除两份已被替代的字符串测试；此证据不宣称历史用户设备已经串图，也不代替物理设备显示验收。 |

## `REG-TOPIC-180` SVG 海报复用后丢失页面 URL 身份

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02` |
| 历史症状与根因 | 原生静态海报复用 WebView 后，第二张页面 URL 变为 data:，与请求的专属 https URL 不同，严格完成回调校验不能进入稳定帧阶段，最终命中 30 秒总期限。两次渲染之间异步加载 about:blank 后立即开始下一请求，清空尚未提交就再次加载相同内部 data URL；生产源码在模块迁移前后相同，单补 historyUrl 已实测不足以修复。 |
| 当前 owner | `modules/forum-platform/android/src/hostTest/java/com/wz/reader/svg/SvgRendererInstrumentedTest.kt`，容量边界由 `modules/forum-platform/android/src/test/java/com/wz/reader/svg/SvgRendererPolicyTest.kt` 负责。 |
| 修复与边界 | 等待当前 WebView 的 about:blank 完成且当前 URL 一致后再开始下一请求，销毁和排队请求全部超时会释放屏障；historyUrl 显式等于请求 pageUrl。保留精确 URL guard、单 WebView 复用和原 30 秒期限。API 35/WebView 124 上，同一真实二请求 owner 从超时转绿，缓存命中、排空销毁和真实像素均通过，动态 SVG 也通过；二请求修复前同样失败，已撤回「批量压力」归因。构建身份与日志见本轮修复记录，其他 WebView 版本未逐一验收。 |

## `REG-NOTIFY-072` NodeSeek 私信最新消息身份未消费 max_id

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/03` |
| 历史症状与根因 | 同账号原站私信列表四行均没有 `id`，均有唯一正整数 max_id；原站前端将 max_id 映射为 `latestMsg.id`。App 只认 `id`，退回时间身份，既可能碰撞，也在质量门禁启用后使正常列表 partial、后台整轮无法提交。直接更换身份又会使旧 fallback 账本把旧未读消息判为新事件。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts`、`src/platform/notifications/notificationStore.test.ts`、`tests/integration/notification-delivery-contracts.test.ts` |
| 修复与边界 | 私信接受正安全整数数值 max_id，保留 `id` 优先级与非法身份的 partial 防线；已读仍消费详情消息 ID。共享 advance 对仍含旧 message:fallback: 的 NodeSeek 基线，在首轮可信扫描静默重建，失败扫描不改账本；随后真正新消息只投递一次，其他来源及正常基线不重置。不猜测已经没有旧标记的账本。解析器修前 3 红；真实 store/worker 升级 oracle 修前误投递 1 条。修后相关 168 项通过，普通包 Live 结果单列于取证记录，不执行真实已读写入。 |

## `REG-TOPIC-181` 妖火完整稀疏回复页误报部分内容缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03` |
| 历史症状与根因 | 主设备同账号原站 1560939 第 19 页正常返回 12 行、原站本身缺 10 楼；第 1 页有 30 行、缺 528/529 楼。生产 parser 全部读取、没有丢行或合成楼层，但基线既有 hasFloorGap 将完整稀疏页判 partial，正文提示缺失且不显示完整末端。缺号原因未证实，不推断为删除。 |
| 当前 owner | `src/sources/yaohuo/reader.test.ts`；末端和真实 partial 的显示继续归 `tests/ui/topic/topic-reply-filters.test.tsx`，共享窗口投影归 `tests/ui/topic/topic-session-controller.test.tsx`。早期 ignored 复现器只保留历史证据。 |
| 修复与边界 | 用户授权修复后，5 个稀疏窗口场景迁入正式 owner，在修复前全部因 completeness 失败；删除楼号连续性条件后转绿，并在既有降级用例补强 partial/watermark 断言、补充错误 cursor 页拒绝。缺楼号、截断、错误页/主题和不可信边缘检查保留。普通 APK 在主登录态设备的原帖 1560939 中，正序续读至 #558 显示「已到最新回复」，倒序从 #558 续读至 #1 显示「已到最早回复」；两端重复触底稳定，回复标题 558，误报提示消失。未把 UI 终态当成逐条原文比对或零额外 transport 的证据；具体构建、全量检查及只读范围见本轮取证记录。 |

## `REG-NOTIFY-073` Expo 占位 headless 任务提前完成导致后台挂起

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 普通 APK 的 WorkManager 在后台启动任务，原 50 秒截止直到 156.9 秒后返回前台才结算。Expo 注册的空 async headless task 立即 resolve，真实 RN AppRegistry 随即通知完成，JavaTimerManager 在业务尚未结束时暂停后台计时。 |
| 当前 owner | `tests/tooling/expo-task-manager-headless.test.ts`、`dev/review-remediation-proof/background.ts`；补丁安装由 `tests/tooling/patch-artifacts.test.ts` 负责。 |
| 修复与边界 | 用户授权后让占位 Promise 保持 pending，由已有原生 TaskService 在全部 Expo 事件结算后结束。真实 RN/Expo 的源码与发布入口均先红后绿；隔离 Release Hermes 下全程后台的普通任务 528 ms 完成，挂起任务 50034 ms 按原截止失败且不改账本，两轮原生 headless 均完成。设备由 JobScheduler 显式触发，不冒充自然唤醒或厂商省电兼容证据。 |

## `REG-NOTIFY-074` Release 裁剪反射加载器导致后台冷进程无法启动 JS

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-03` |
| 历史症状与根因 | 最小 15 分钟调度注册后退到 HOME，以 am kill 结束后台进程但保留 stopped=false；系统自然拉起新 PID，WorkManager 恢复任务并进入 executeTask，随后 ClassNotFoundException 指向 manifest 中的 RNHeadlessAppLoader，JS 业务回执仍停留 ready。安装的 expo-modules-core 只在 constructor 标注 DoNotStrip，consumer keepclassmembers 未保留反射类本身；minified APK 缺少该类名，关闭 minify 的 proof 则存在。暖进程已持有 ReactContext，未暴露此入口。 |
| 当前 owner | `scripts/run-notification-background-device-proof.mjs`、`dev/review-remediation-proof/background.ts`；真实 R8 Release 产物与系统新进程、业务和原生完成记录联合验证。 |
| 修复与边界 | 在 `app.json` 已有 expo-build-properties 中增加该类及 public 无参构造的精确保留规则，保持 Release 压缩。Expo [上游修复](https://github.com/expo/expo/pull/46920) 已在同一类补充类级 DoNotStrip，安装的 SDK 57 仍未包含。修后真实 R8 Release 的冷进程成功、50 秒 deadline 与自然调度均通过，包含新 PID、唯一 JS/native worker 及正常 jobFinished；自然历史的 pre-bind 重叠取消经原始记录和独立 oracle 复核，保留初次采集器拒绝记录。设备与产物身份见全仓修复验收记录，物理设备和 OEM 省电仍未验证。 |

## `REG-WRITE-098` 混排图片切回富文本后再次插图失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-04/05/07` |
| 历史症状与根因 | linux.do 新帖正文含文字、单换行图片与连续图片，源码切回富文本后再次上传成功，但插入弹出 `Called contentMatchAt on a node with invalid content`，图片按钮保持忙碌。Tiptap 的段落 Markdown 解析仅展开独立单图，混排时将 block image 留在要求 inline* 的段落中；上传占位先被移除，插入异常又跳过了忙碌态释放。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 的混排源码转换/继续上传及上传结算矩阵；有效文档通过 ProseMirror schema 校验，不以显示出图片代替文档有效性。 |
| 修复与边界 | 复用已安装 Paragraph 解析，将其中 block image 按原顺序拆为合法相邻段落和图片；独立单图、普通段落沿用原解析。确认上传 token 后先释放忙碌态，插入异常仍保留正文和本机上传记录。源码转换 oracle 修复前因段落 schema 非法失败，修复后共享 runtime 79 项通过；Android API 35 修复 APK 恢复原混排草稿，源码/富文本往返后再次真实上传并插入第五张图片，schema 校验有效、图片按钮恢复可用；未真实发布。 |

## `REG-WRITE-099` 初始化错过前台切换后发帖读取停滞

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。effect 已同步当前 AppState 到 appActive，最低失败 oracle 转绿；剩余为匹配修复 APK 的配置重建、发帖分类读取与图片恢复，不能仅凭单测关闭整起事故。 |
| 能力 ID | `NAV-01`、`WRITE-07` |
| 历史症状与根因 | 2026-09-21 Android 小屏/字号配置重建后，发帖分类持续禁用、linux.do 正文短地址图片失败；仅退出/重进发帖页面不能恢复，系统 Home 后回到 App 才重新加载规则，重进编辑页后图片恢复。诊断中的规则请求为 canceled，无真实发布。 |
| 已确认缺口 | `useAppLifecycleRuntime` 在 render 读取 AppState 初始化业务前后台状态；effect 再读取当前值时只同步 Query focus，未同步 appActive。挂载监听前由 background 转为 active 会永久留下 false，直到下一次原生 change。现有 lifecycle owner 模拟这个时序，修复前失败，同步初始值后一并通过导航 14 项。 |
| 当前 owner | `tests/ui/app/app-lifecycle-request-timeout.test.tsx`；初始化仅复用当前原生 AppState，不绕过发送前守卫。匹配修复 APK 的配置重建与图片恢复待验；尚未以原生帧证据断言每一次配置重建都属于这一时序。 |

## `REG-WRITE-100` 发帖设置面板关闭后正文键盘重新弹出

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07` |
| 历史症状与根因 | Android 隔离回放在富文本正文弹出系统 IME 后打开并关闭更多面板，键盘重新弹出，不能恢复完整正文视口。页面只调用 React Native Keyboard.dismiss，嵌入 WebView 的编辑焦点仍保留，且一直传 visible=true，未进入共享编辑器已有的 blur 分支。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 的真实编辑器/面板/键盘 owner，以及 `topic-nodeseek-panel-keyboard` 设备回放；前者在修复前缺少 blur 命令而失败，后者留下 IME 仍显示的截图与 receipt。 |
| 修复与证据 | 发帖容器按页面 active 且没有面板传递 visible，复用已有失焦命令，保留同一编辑器和选区；面板关闭不发送 focus。相关 57 项 UI 测试通过；匹配最终源码的隔离回放通过，分别核对 IME 显示与面板关闭后隐藏时的 footer/safe-area/window bounds。主模拟器 linux.do 的源码和富文本同流程均保持键盘收起、完整正文高度，原草稿未丢失。 |

## `REG-WRITE-101` 小屏大字号弹出键盘后正文被挤空

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07` |
| 历史症状与根因 | 隔离 API 35 的 900×1600、420dpi、系统字号 1.4 下，正文获得焦点后，双行底栏与元数据占满剩余高度。真实 WebView frame 仅高 110 px，图片工具按钮底部已达到 frame 底部，正文完全不可见；原来的 120 dp 编辑器最小高度没有计入内部工具栏和双行底栏。 |
| 当前 owner | `scripts/run-composer-device-proof.mjs` 的两个 `topic-*-panel-keyboard` 场景及其几何 oracle，`tests/tooling/composer-device-proof.test.ts` 校验缺失正文空间必须失败；`tests/ui/topic-composer/create-topic-screen.test.tsx` 覆盖短视口的标题/正文聚焦和键盘收起恢复。修复前真实节点被新 oracle 拒绝，短视口交互单测先红后绿。 |
| 修复与证据 | 正文编辑时为结构化编辑器与底栏保留 224 dp；短键盘视口暂收元数据，避免露出半行文字，标题聚焦或收起键盘后恢复。编辑器和草稿不重挂，底部操作不隐藏。同源码 API 35 APK 在 900×1600/字号 1.4 下通过 NodeSeek 浅色和 linux.do 深色原生回放，正文实际可见高度超过一个工具按钮，面板关闭后完整恢复。手动修改标题、切回正文、收起键盘均保留输入并恢复字段，妖火同条件正文与底栏可见。物理设备和不同 IME 高度仍需独立验收。 |

## `REG-WRITE-102` 图片选中后模拟器 WebView 图形调用停滞

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 原始触发根因待定位。本轮同 WebView 内核的真实编辑器诊断入口，NodeSeek/LinuxDo 各四轮图片选中与预览往返未复现卡死或 ANR；普通完整发帖路由及真实远端图片仍未覆盖，不据此认定已修复。 |
| 2026-10-04 复核 | 主 API 35、WebView 156.0.8062.0、同一 App PID 11523，诊断入口挂载真实 StructuredReplyComposer 和已加载的 128×96 内嵌 PNG，两来源各四轮真实点击图片形成 NodeSelection→预览→继续编辑均通过；逐轮确认图片完整、选中态、contenteditable 切换和 PID 稳定，采样日志无 Fatal/ANR。未上传或发送；普通发帖入口原稿为空，诊断入口的内嵌图不等同于普通完整路由的真实远端图片。证据为 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38/main-device-proof/image-matrix.json`、`image-matrix.log`、逐轮截图及两站录像；只记本轮未复现，历史事故保持 `OPEN`，物理设备仍未验证。 |
| 能力 ID | `WRITE-05/07` |
| 历史症状与根因 | 2026-09-21 普通 APK 在主 API 35 AVD、WebView 156.0.8062.0 中，选中已加载的 128×96 正文图片后发生输入 ANR。主线程停在 HardwareRenderer.syncAndDrawFrame，RenderThread 长时间读取 QemuPipeStream，调用来自 GL2Encoder.safe_glGetInteger64i_v 和 WebView drawGl；不是 JS 异常证据，触发根因尚未确认。重开 App 后 feed 可用，但新 WebView 绘制和初始化仍超时。 |
| 当前 owner | 同 APK、同 WebView 的原生图片选中/预览复测与 Android `data_app_anr` 线程记录。`scripts/run-composer-device-proof.mjs` 保存匹配构建及内核版本的隔离交互证据，但不同内核的通过不能替代本场景。 |
| 当前证据与边界 | 本机忽略目录 `topic-final-0920` 的本次 ANR、线程记录及同 APK 哈希；同一设备旧诊断也有绘制等待，不能只凭栈判定产品代码完全无责。保留原 WebView、硬件加速和账号，不用关闭加速或降级内核掩盖结果。按用户既有重启授权冷启动同一 AVD 后，APK SHA-256 仍为 `b789cfee692c8119c2d59ebe1d645d424ebe498645d4fa48aa4291f1fb67e532`、firstInstallTime 不变，原文字/图片草稿恢复；同一 App PID 连续四次图片选中与预览往返通过，系统报告本次启动无 ANR。恢复不能证明根因已消除，隔离设备 WebView 124 回放也不能关闭此差异，物理设备仍未验证。 |

## `REG-WRITE-103` 首页进入发帖页时编辑器初始化拖慢切页

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`、共享 `WRITE-05` |
| 历史症状与根因 | 首页入口已直接导航，但发帖页首轮渲染即创建结构化 WebView，与原生切页同时进行；已知本机草稿还要等 onLoadEnd 后才发送 INIT。回复的 Sheet 子编辑器已挂载，展开回复不承担同样的首次创建工作，不能用回复展开时间代替新页初始化时间。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 的页面字段先显示与早期标题输入，`tests/ui/topic/structured-reply-composer.test.tsx` 的初始数据、稳定 source 和重载 epoch，以及 `src/ui/composer/editorRuntime.test.ts` 的无 host 往返初始化。关闭延后挂载和初始数据后，两条行为 oracle 同时失败，恢复后通过。原生切页仍由同 APK 设备观察负责。 |
| 修复与证据 | 发帖页先进入，原生 transitionEnd 后挂载正文；已知模式的初始稿通过转义并严格校验的 JSON 数据随离线页载入，后续变更与重载继续使用版本化桥接。最新普通 Release Hermes APK `35dbad7c743247f1618df30d7e089287608e56c1ae033da0aa5b4dfee24cf784` 已覆盖安装并保留 firstInstallTime。主 API 35 设备在点击后约 0.41–0.56 秒采集的截图显示发帖页标题与正文准备提示已随页面进入；两次暖进入正文/工具栏观察值为 775/797 ms，修复前同探针为 883/870 ms，均包含宿主轮询开销，不视为普遍性能保证。冷进入单次为 1363 ms，无同条件旧包冷启动基线。相关 81 项 unit、152 项 UI 通过；三站切换和返回保稿只读走查通过。未真实发布；本条不关闭既有原生生命周期或模拟器 GPU 停滞问题。 |

## `REG-WRITE-104` 新帖标签重复搜索并清空候选，规则读取入口缺少反馈

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07` |
| 历史症状与根因 | 2026-09-21 用户选择 linux.do 二级标签后候选重新加载、难以连续选择；刚进入页面时版块/标签不可点击又没有就地 loading。controller 的选择依赖 effect 与面板搜索同时请求标签，后者又把已选标签放在结果显示 key 内，导致每次选择立即清空列表。规则提示位于标题下方，入口没有加载状态。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 覆盖首次加载、连续选择、失败保留/重试、重开复用、跨分类与旧请求取消；`tests/ui/topic-composer/topic-draft-controller.test.tsx` 通过真实来源适配器记录请求数量、已选 ID 与取消后的错误。修复前入口、候选保留和多余请求三条 oracle 均失败。 |
| 修复与边界 | 删除 controller 的重复默认搜索和重复结果状态；面板防抖搜索保留当前范围候选，已选项即时更新，规则刷新显示轻量进度，取消的请求不得回写。首次规则加载直接呈现在入口，已到达的规则不等待表情请求。原站依赖已选 ID 的规则查询和提交前复核仍保留，不以零请求绕过规则。匹配普通 Release APK 的主 API 35 模拟器通过初次 loading、刷新中连续选中、移除、重开复用、搜索/清空及 Gboard 往返；NodeSeek/妖火分类入口正常。切回 L 站自然遇到 Cloudflare 后通过 App 原站检测状态和一次规则重试恢复，原稿两个标签完整保留。相关 101 项 UI、24 项 unit 与 APK sanity 通过；未真实发布，物理设备未验证。 |

前述初次修复仍把已选标签放入面板搜索 key，每次选择继续刷新原站规则；仅保留请求期间候选，无法避免返回空列表后替换候选。用户再次指出这一交互后，当前 owner 改为本地勾选/取消，只有明确搜索或范围变化才读取，发布前复核保持。新增 oracle 修复前证明选择导致第二次请求、在途搜索被取消及过时缺组提示；修后固定候选持续可选、关闭重开复用、在途搜索不因选择重发和过时规则不展示。相关 107 项 UI、类型与架构检查通过；最新普通 Release APK 覆盖安装、保留首次安装时间并冷启动后，真实候选连续选择、重开、行内取消、已选区移除和搜索/清空均通过，候选未随选择消失；恢复本轮开始时实际已有的 5 个标签。请求次数由自动化 oracle 持有，设备证据不冒充网络抓包；未发帖，真机未测。

## `REG-WRITE-105` 发帖读取 CF 未接专用验证与原请求恢复

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`、共享 `ACCOUNT-02` |
| 历史症状与根因 | 用户指出发帖标签遇到 CF 没有打开 L 站专用验证页。标签 catch 只写通用错误；规则失败按钮调用 openAccount 时未传 recovery，Account 因而按普通账号页处理，检测后不能恢复原标签请求。上一轮手动检测账号再点规则重试只证明可绕行，没有证明专用恢复接线。 |
| 当前 owner | `tests/ui/topic-composer/topic-draft-controller.test.tsx` 通过来源适配器证明标签/规则挑战打开恢复流程、相同参数只读恢复、重复 CF、取消、abort、账号变化与零发布；两条专用恢复 oracle 修复前失败。`tests/ui/app/app-runtime-startup.test.tsx` 固定回调完整透传；`src/features/account/useVerificationController.test.ts` 固定本地等待取消与专用模式，已有 Account UI owner 继续持有专用 URL 和 Cookie 交接证据。 |
| 修复与边界 | 复用 Account 的专用验证协调器，读取 callback 与草稿/身份/查询绑定，取消或过期使等待结束；后台返回可替换同 key 的已失效恢复任务，不重开验证文档。标签错误就地显示并在新请求时清除。只对读取进行恢复，发布和上传不自动重发。相关 177 项 UI 与 45 项协调器单测通过；匹配最新源码的普通 Release APK 已覆盖安装并冷启动，首次安装时间不变，APK sanity、真实规则/标签搜索、选中移除、跨站返回和原稿恢复通过。本轮未自然遇到 CF，真实挑战闭环及物理设备仍为 `NOT_VERIFIED`；不以模拟 HTTP 挑战冒充 Live，未真实发布。 |

## `REG-WRITE-106` 发帖局部操作与规则加载、提交状态错误耦合

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`，共享 `ACCOUNT-01/02`、`DATA-01` |
| 历史症状与根因 | 用户要求继续排查发帖交互。已完成的规则 effect 因选图或后台返回重新运行，清空分类并重复请求；可选表情仍占用规则 loading。分类切换重复执行整稿提交校验，导致标签面板自动弹出；重复选择当前分类仍取快照。切站入口及恢复 effect 各取一次正文快照、重复保存站点偏好。文件选择在原生选择器前等待上传网络准备，快速连点可打开多个选择器；批选中一个非法文件会中断后续有效文件，错误又只显示在面板后方。活动发送记录被当作未知结果，允许用户在请求仍运行时进入核对。 |
| 当前 owner | `tests/ui/topic-composer/topic-draft-controller.test.tsx` 固定三站规则保留、显式刷新和 epoch 失效、表情独立、分类与单次快照、单一文件选择器、无网络准备的本地选择、混合合法/非法文件保留；`tests/ui/topic-composer/create-topic-screen.test.tsx` 固定面板内错误及发送状态显示；`tests/ui/topic-composer/topic-submit-controller.test.tsx` 固定在途提交不能核对或重复发送。相应修复前 oracle/负对照失败；沿用三位 canonical owner，未另建平行测试层。 |
| 修复与边界 | 完成规则按草稿/epoch/显式刷新保留，未完成读取仍按生命周期取消恢复；表情独立。分类被动提示由现有页面校验消费，重复选择不动作；删除重复校验、快照、偏好写入和无人使用的清错接口。文件本地选择保留身份门禁，实际上传仍完整复核网络与凭证，按文件收集校验错误并继续处理有效项。发送中隐藏并拒绝核对，持久未结算记录仍保护重发。156 项相关 UI 与 62 项 domain/source/storage 单测、类型/未使用代码、ESLint、架构及编辑器构建通过。匹配源码的普通 Release APK 已覆盖安装并冷启动，首次安装时间不变；三站切换与原稿恢复、三站选图取消、L 站附件选择取消、当前分类重选、标签连续选中/取消、Gboard 与后台往返、妖火文件帖选择取消通过。原有 L 站五个标签和妖火普通帖型已恢复。请求次数由自动化 owner 证明，设备观察不冒充抓包；未真实发布、未上传，本轮未自然遇到 CF，真实提交、真实 CF 与物理设备均为 `NOT_VERIFIED`。 |

## `REG-WRITE-107` 发帖选择行内容偏上，菜单文字错列及已选标签被裁切

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07` |
| 历史症状与根因 | 用户在模拟器发现内容没有居中。Paper List.Item 仅外层设置 48 dp 最小高度，内部行仍使用默认上下 margin，文字及勾选框比整行中心高约 7 dp；右侧重复留白也与左侧不同。更多菜单将说明放在图标与标题行之外，导致说明从图标列开始。已选标签换行区固定 maxHeight 120 dp，第三行仅露出一截。 |
| 当前 owner | `write.topic.create` 设备视觉 owner 以真实 Android 节点和截图核对原生几何；复用 `tests/ui/topic-composer/create-topic-screen.test.tsx` 的交互回归。修复前同一节点几何检查测得标签文字偏移 18.5–19 px、标题与说明左边缘相差 73 px，均失败；不以复述 StyleSheet 属性的单测替代真实布局。 |
| 修复与边界 | Paper 内层行承担最小高度和居中，双行内容自然增高，统一 16 dp 左右内边距与文字行高；菜单图标与整组文字居中，标题、说明和单行操作共用文本列。已选标签改为完整单行横滑，保留所有已选项与移除操作，不改变标签请求逻辑。匹配源码的普通 Release APK 覆盖安装后，原生文字中心偏差为 0.5 px，勾选框也通过居中检查，菜单文字列偏差为 0 px；七至八标签横滑与末项移除、键盘展开/收起、单/双行分类、附件空态及三站选项面板复验通过，原有七标签与三站稿件保留。50 项 UI、类型/ESLint/格式/架构/文档检查和 APK sanity 通过。未真实发布；本轮未重跑大字号、深色及物理设备视觉矩阵。 |

## `REG-WRITE-108` 本人主帖编辑重复进入与恢复边界遗漏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02`，共享 `WRITE-07`、`DATA-01` |
| 历史症状与根因 | 首轮主帖编辑验收只覆盖新目标的一次保存，遗漏历史成功回执：保存后再次进入同一目标会被旧回执立即弹回。L 站部分保存后，本机基线落盘失败时核对动作直接删除 checkpoint；较新草稿恢复又忽略该记录，导致已确认属性被重发。等待落盘后回装旧对象还会覆盖晚到正文快照。分类编辑复用创建校验，误用帖子投票的新帖类型限制。设备复验另发现重启虽保留分步进度，但未恢复部分成功提示。 |
| 当前 owner | `tests/ui/topic-composer/topic-submit-controller.test.tsx` 固定三站重复编辑、分步落盘失败后确认及重启恢复、后续输入保留与延期落盘快照；`src/domain/forum/topicComposer.test.ts` 固定编辑分类跳过创建专属类型限制。新增 oracle 均先失败再通过。隔离 `topic-edit-*-success` 设备用例增加同一目标第二次保存，沿用 `tests/tooling/composer-device-proof.test.ts` 回执守卫。 |
| 修复与边界 | 成功回执与草稿 ID 关联；checkpoint 基线安全落盘后才允许清记录，较新字段保留，合并版本同步安装后再等待落盘。重启从同稿回执恢复部分成功提示。L 站编辑不转换主题类型，上游只在创建时应用投票类型限制。设备与自动测试均使用无网络回退合成传输；三站真实保存、实际部署兼容性与物理设备仍为 `NOT_VERIFIED`。 |

## `REG-DATA-012` 备份未检查文件提供方已经报告的关闭错误

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `DATA-03` |
| 历史症状与根因 | ContentResolver.openOutputStream 返回的流只关闭本地描述符，不检查可靠 provider 已报告的远端错误。独立 UID provider 接收 32768 字节后 closeWithError，真实生产输出工厂仍返回 Success(32768)，备份会误报已保存。 |
| 当前 owner | `modules/forum-platform/android/src/hostTest/java/com/wz/reader/storage/PlatformFileFaultInstrumentedTest.kt`、`modules/forum-platform/android/src/hostTest/java/com/wz/reader/storage/PlatformExportInstrumentedTest.kt`；本地关闭与取消语义继续归 `modules/forum-platform/android/src/test/java/com/wz/reader/storage/BackupExportTest.kt`。 |
| 修复与边界 | 输出由 ParcelFileDescriptor.AutoCloseOutputStream 管理，在关闭前检查可靠描述符已经收到的错误，并在 finally 关闭本地 FD。相同生产工厂的设备 oracle 从误成功转为拒绝，断言原始 provider 错误和 FD 关闭。受控 provider EIO/ENOSPC、真实 Expo Promise 拒绝及下次操作解除 busy、非空图片 part 清理共 4 项通过；真实 SAF 5 MiB/Unicode 往返、重建、相册和延迟分享联合 owner 复验通过。不等待或保证云端同步，不将受控 ENOSPC 当成耗尽整个设备分区。 |

## `REG-WRITE-109` 未选版块的标签面板误报读取失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07` |
| 历史症状与根因 | 尚未选版块时打开 L 站标签面板，页面仍启动搜索；controller 返回空结果以跳过请求，页面却按读取失败显示错误和重试。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 验证中性提示、零搜索调用、进入版块选择及选定后一次正常搜索；同一 oracle 修复前失败。 |
| 修复与边界 | 页面在无分类时不调度搜索，面板提供先选择版块的提示与入口。正常标签候选、失败重试和 CF 恢复继续由原 owner 回归；无真实写入。 |

## `REG-FEED-034` 布局调整误触发发帖按钮显隐

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`，共享 `WRITE-01`、`TOPIC-03` |
| 历史症状与根因 | 用户反馈发帖按钮收起隐藏奇怪。共享显隐 hook 只比较滚动 offset，列表内容或视口变化带来的 offset 修正也被解释为反向阅读。UI 复现中内容高度减少 20 dp、offset 同步减少 20 dp，即错误显示原本隐藏的按钮；尚不认定这是用户设备上所有异常的唯一原因。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 验证内容和视口修正保持显隐、后续真实滚动继续切换、顶部恢复；同一 oracle 修复前失败。共享回复入口继续由 `tests/ui/topic/topic-reply-filters.test.tsx` 验证。 |
| 修复与边界 | 尺寸变化时重建方向基线，不改变当前显隐；保持既有 12 dp 方向阈值、动画、返回恢复与无障碍规则。UI 与设备手势证据分别报告。 |

## `REG-WRITE-110` 改版块遗漏标签校验，正文更正后旧错误不消失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07` |
| 历史症状与根因 | 编辑校验只保留发生变化的字段错误，改分类但未改标签时丢弃新分类的标签要求。结构化编辑器快照更新草稿后未更新错误，补齐正文后仍提示「请输入正文」。 |
| 当前 owner | `src/domain/forum/topicComposer.test.ts` 验证改版块的标签数量、标签组及合法标签；`tests/ui/topic-composer/topic-submit-controller.test.tsx` 验证创建/编辑的正文和投票错误清除、模式切换保留错误、其他字段错误保留及无写请求。修复前同一 oracle 失败。 |
| 修复与边界 | 分类变化同时验证标签，保留字段权限与未改旧正文的编辑契约。正文内容变化清除相关旧错误，再次提交完整校验。共享来源适配器使用同一 domain 校验；未真实提交。 |

## `REG-FEED-035` V2EX 信息流出现跳往其他站点的发帖入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`、`FEED-02` |
| 历史症状与根因 | 信息流无条件显示创建入口，V2EX 点击后因不支持发帖而恢复上一次可写站点，入口语义与当前来源不一致。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 验证 V2EX 加载中和完成后均无入口，切回支持来源恢复；修复前同一 oracle 失败。 |
| 修复与边界 | V2EX 不渲染入口，其他来源保留原有显隐规则。设备验收与真实写入分开报告。 |

## `REG-WRITE-111` 切回 L 站发帖页重复要求 CF 验证

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已解决。2026-10-04 用户明确确认此前 CF 验证问题已解决，本条据此结案并移出待处理清单。下方重复挑战与归因缺口是历史记录，本次未新增设备或 Live 测试，也不外推所有站点和挑战场景均已验证。 |
| 能力 ID | `WRITE-07`、`ACCOUNT-02` |
| 历史症状与根因 | 2026-09-21 普通 Release 1.3.148 模拟器验收中，进入或切回 L 站后再次弹出验证；有时验证文档自行到达普通 404，检测后规则读取成功。根因尚未定位，不认定为弹窗自循环或此前出口差异的再次发生。 |
| 当前 owner | `src/sources/readGateway.test.ts` 和 `tests/ui/topic-composer/topic-draft-controller.test.tsx` 承接受控传输的恢复接线；2026-10-04 用户使用反馈为本次结案依据。历史 CF 出口取证流程见 `docs/operator-runbook.md`，不把受控恢复测试当作挑战根因证明。 |
| 历史确认与缺口 | 导出覆盖可用且无损坏行，但 journal 有历史丢弃/写入失败计数，不外推完整历史。13:50 UTC 的同一 App session 中，原生分类及账号读取 200，网页规则读取 403 并有明确 challenge 标记；请求携带的通行 Cookie 与存储一致。对应隐藏 WebView 也报告挑战；检测后该只读业务经 WebView 200 并完成。再次切站仍可复现。临时延后桥接交接没有建立可自动完成挑战的证据，未合入产品代码；未修改网络、登录态或验证保护。尚缺同一窗口原生与 WebView 实际出口对照及服务端触发原因。 |

## `REG-FEED-036` 发帖按钮淡出突变发灰并留下阴影残影

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-07`，共享 `WRITE-01`、`TOPIC-03` |
| 历史症状与根因 | 用户明确指出隐藏动画难看。旧实现一开始隐藏就把按钮禁用透明度切为 0.45，再叠加父层 160 ms 淡出和 8 dp 下移；Android 未整体合成重叠底色、图标及阴影。匹配旧包的滑动录屏逐帧显示先发灰，再留下灰色圆形残影。 |
| 当前 owner | `tests/ui/feed/feed-screen.test.tsx` 的既有显隐用例固定禁用但不突变子层透明度、固定位置和整体 alpha 合成；修复前同一 oracle 失败。共享回复显隐继续由 `tests/ui/topic/topic-reply-filters.test.tsx` 持有。Android 动效由匹配 APK 的前后滑动录屏逐帧对照，不以 RNTL 的动画 mock 证明视觉效果。 |
| 修复与边界 | 去掉下移与额外禁用透明度，保持 160 ms 整体淡入淡出；两处动画容器使用原生整体 alpha 合成。原滚动方向阈值、布局修正、V2EX 隐藏、点击与无障碍隔离不变。187 项相关 UI、类型和静态检查通过；同签名覆盖安装后，模拟器首页录屏确认位置固定且灰色残影消失，首次安装时间不变。物理设备动效仍未验证。 |

## `REG-WRITE-112` 发帖底栏改版后空白输入失效、长稿挤压工具面板

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07`，正文容器共享 `WRITE-01/04/05`、`NOTIFY-02` |
| 历史症状与根因 | 用户反馈改版后看不到键盘、表情不能用。普通用户操作复现：正文很短时点击大片空白不获得输入焦点，内部 EditorContent 未撑满正文区域；连续插入正文块后，底部工具面板参与 flex 收缩，被长正文挤到只剩少量按钮。先前设备检查仅点击「输入正文」按钮，且只使用短稿，遗漏两种行为。尚不把这两处根因认定为真实站点表情目录失败的原因。 |
| 当前 owner | `dev/composer-proof/topic-focus-body.ad` 直接点击正文，`scripts/run-composer-device-proof.mjs` 的两站 `panel-keyboard` 场景检查真实 IME、标题与面板切换，并实际输入 100 行后比较短/长正文的工具栏位置，再撤销并确认原草稿恢复。相同设备 oracle 在修复前分别因键盘未弹出、面板被挤压而失败。 |
| 修复与边界 | 共享富文本容器填满可编辑区域；发帖工具面板固定自身高度，不随正文增长收缩，短视口继续限制最大高度。匹配 APK 的 NodeSeek 与 linux.do 两例通过，系统 Gboard 完整按键与底栏另经截图检查。表情按需挂载、分类按需设置图片地址和原生 lazy loading 由共享 Runtime owner 维护，保留成功图片及失败重试。真实 L 站目录、原站发送和物理设备未以隔离证据代替。 |

## `REG-WRITE-113` 连续编辑时工具层冲突，选图返回误报保存失败

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/06/07`、`NOTIFY-02` |
| 历史症状与根因 | 2026-09-22 连续操作录像确认：选图取消后出现快照超时；原生恢复事件额外请求尚未恢复的 WebView。格式操作主动聚焦正文，导致面板关闭、键盘反复出现；长表单共用固定小面板，链接再叠浮层；表格浮条只判断选区，进入其他表单后仍显示；三站回复沿用正文上方工具栏。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 固定连续格式、底部工具栏、独立链接表单、表格浮条隐藏和表单固定动作；`tests/ui/topic/structured-reply-composer.test.tsx` 固定展开表单的全屏、原生返回关闭与恢复；`tests/ui/topic/yaohuo-reply-composer.test.tsx` 固定 UBB 连续格式；`tests/ui/topic-composer/topic-draft-controller.test.tsx` 固定后台确认稿与恢复后自动快照落盘。修复前 runtime 与保存 oracle 失败。 |
| 修复与边界 | 复用共享 Builder 区分紧凑工具与展开表单，完成动作独立于滚动区；回复工具移到底部。格式编辑保留面板和选区，显式回正文再聚焦。原生恢复不再抢先请求快照；离页、切站和提交仍严格取得最新正文，真实保存错误仍阻止离开。设备交互和真实原站写入分别验收。 |

## `REG-WRITE-114` 原生回复在中间输入时光标回退

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/05`、`NOTIFY-02`，共享 `WRITE-07` |
| 历史症状与根因 | 2026-09-22 开启完整 Gboard，在妖火回复中间逐键输入 abcd，实际变为 dcba；末尾输入及发帖原生框未暴露问题。回复父级正文经 Gorhom Portal 延迟回传，TextInput 已提交原生事件时仍收到旧 value，触发正文回写与光标回退。仅检查键盘可见或只在末尾输入无法发现。另有格式插入后 setNativeProps(selection) 未可靠定位，后续文字落入标记内部。 |
| 当前 owner | `tests/ui/topic/yaohuo-reply-composer.test.tsx` 的父级回传前输入 owner 固定即时正文、连续插入/删除、外部清空与恢复，临时还原旧实现时 UBB/纯文本两例均失败；格式 owner 固定显式原生选区调用。隔离 Android Gboard 录屏分别验证回复、私信中间插入，以及格式、表情、选图返回后继续输入。 |
| 修复与边界 | 原生编辑器同步保留当前输入，并接收外层草稿替换；普通输入不设置 selection，格式与行内表情通过 React Native 的 setSelection 定位。未修改 Portal 或第三方依赖，未用强制移到末尾掩盖问题。物理设备、其他输入法及语音输入仍需独立验收。 |

## `REG-WRITE-115` 软键盘反复选中图片但无法删除

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/07`、`NOTIFY-02` |
| 历史症状与根因 | 2026-09-22 Gboard 录像复现：已加载图片在连续退格后仍保留。输入法发出 keyCode 229 和 deleteContentBackward，DOM 选区先回到图片后方，ProseMirror 的延迟补偿反复重选图片。只同步删除选中节点虽能删图，但回复弹层仍会收起键盘：在 IME 事件中移除 DOM 会关闭 Android 输入连接。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 固定选中图片、图片旁光标、加载中/已加载/失败、前后删除、撤销、保留文字、延后 DOM 变更及文档替换/只读取消；旧实现和同步删除版本分别使对应 oracle 失败。匹配构建的 Android Gboard 录像负责实际键盘保持与连续编辑，DOM focus 断言不能代替键盘可见。 |
| 修复与边界 | 在共享图片节点拦截可取消的 IME 删除，保留当前文字段落；等本次输入事件结束后于下一帧提交原生编辑事务，不重建编辑器、不强制收起再弹键盘。普通文字、其他节点和范围选区不接管。物理设备、其他输入法和原站写入须独立验证。 |

## `REG-WRITE-116` L 站分类规则失败后未自动核验账号

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07`、`ACCOUNT-01/02` |
| 历史症状与根因 | 2026-09-22 用户报告 linux.do 分类请求 HTTP 400 后仍显示旧登录状态，手动刷新账号后发帖页才要求登录。发帖规则已走共享 ReadGateway，但普通 400 不触发 Account 核验；HTML 规则失败丢失 HTTP 状态，空 current_user 也缺少核验信号。尚未取得用户该次失败的具体端点与响应体，不推断所有 400 均代表掉线。 |
| 当前 owner | `src/sources/readGateway.test.ts` 通过真实规则 adapter 固定三条规则请求的 400、主帖编辑复用、空用户，以及 CF/权限/服务失败反例；修复前五个核验用例为红。`tests/ui/account/account-runtime.test.tsx` 复用原四结果并发核验 owner，以真实分类 400 自动触发，固定匿名、同账号、换账号、未知结果和一次 probe；修复前四例均因零自动 probe 失败，没有另建平行状态测试。 |
| 修复与边界 | 仅在当前有效 linux.do 发帖/编辑规则读取的普通 400 发起现有 Account 核验，并保留 HTML HTTP 元数据及空用户信号。不直接判定登出、不重发业务写入；响应体读取期间取消的迟到错误归为取消，保留原有超时错误契约，不触发账号核验。账号 owner 继续负责并发去重、epoch、来源停用和登录面板隔离。确认匿名后账号与发帖权限立即更新；核验失败或同账号保留身份。受控 HTTP 与 React runtime 验证通过，用户原站当次响应和物理设备登录链为 `NOT_VERIFIED`。 |

## `REG-WRITE-117` 正文收键盘时标题区域与摘要错帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07` |
| 历史症状与根因 | 2026-09-22 用户报告 linux.do 正文收起键盘后标题区域闪现。代码与时序 oracle 确认：标题区域高度直接读取 UI 线程键盘值，摘要与无障碍属性读取回传到 React 的状态；原生高度归零而 React 更新尚未提交时，标题区域与摘要会同时出现。旧实现因此得到 maxHeight=42% 而期望仍为 0。后续用户提供的真机录像在 3.928 秒同时显示完整分类/标题与紧凑摘要，3.986 秒摘要消失、正文再次上移，补足了模拟器未观察到的可见错帧证据；录像中的三次开合对应用户三次操作，没有显示关闭后自主循环。录像未提供 APK buildId，此前交付的真机测试包尚不包含本修复。 |
| 当前 owner | `tests/ui/topic-composer/create-topic-screen.test.tsx` 扩展既有键盘/标题切换 owner，保留原生帧到 React 提交的时间差，固定高度、摘要和无障碍可见性互斥；不新增平行 case。匹配 Release Hermes 的隔离设备与完整 Gboard 负责实际输入、面板和收键盘验收。 |
| 修复与边界 | 移除标题区域独立动画，复用既有 React 状态在一次提交中切换标题区域、摘要与无障碍属性；底部避让继续随原生键盘逐帧更新。没有新增 state、ref、计时器或状态机。时序 oracle 修复前失败、修复后通过；匹配 Release Hermes 的 linux.do 面板/键盘 proof 通过，普通屏、短屏大字号和标题/正文切换的 Gboard 录像中均只恢复一次标题区域。用户物理设备和其他输入法仍为 `NOT_VERIFIED`。 |

## `REG-USER-018` 活动切换的延迟回顶覆盖用户新拖动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 2026-09-23 排查页面跳动时，真实 UserScreen 的受控时序复现：切换主题/回复已完成回顶后，用户开始拖动或惯性滚动，旧 80 ms 定时器仍无条件再次滚顶。原实现使新位置 240 被改回 0；首帧前的新拖动也不能取消待执行复位。 |
| 当前 owner | `tests/ui/user/user-screen.test.tsx` 在 FlashList 原生滚动边界记录位置，覆盖首次回顶后拖动/惯性与首帧前拖动；两个修复前红例均由新位置被覆盖触发。`tests/ui/user/user-route.test.tsx` 继续承接路由上下文。 |
| 修复与边界 | 删除无条件延迟回顶，下一帧和内容尺寸回调只完成尚未结算的复位；用户新滚动取消该复位，卸载取消帧回调。相关 UI owner 已通过。首次 11.51 秒、10 个编码帧的短内容录像未命中滚动竞态，已由真实资料页的 `68` 个主题、`270` 条回复补验：六轮 TouchTrace 在切换后的 `80ms` 级窗口连续拖动，完整录像逐帧核对 `3037` 帧，未出现旧回调覆盖新拖动或意外回顶，取得该场景的 `DEVICE_REPLAY_PASS`。第 4 轮另见仅一帧的吸顶 TabRail 缺口，归独立 `REG-USER-019`，不能将本条关闭解释为所有吸顶绘制均无闪现；其他设备与输入时序仍须独立验证。 |

## `REG-USER-019` 快速切换后吸顶 TabRail 在 JS 交接时短暂缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已改用同一活动栏的原生吸顶动画；主模拟器匹配普通 APK 的六轮快速切换/滚动未再出现整栏缺失，三次 fresh PID 首次进入、跨页与进入主题后返回位置也通过。本条从待修清单移除。 |
| 2026-10-04 复核 | 普通 Release 1.3.150/154、主 API 35，同一 PID 12161，在 NodeSeek 用户夜轻的 217 个主题/7838 条回复资料页执行六轮切 Tab 后立即拖动。2002 个编码帧的像素筛查、上下文索引及 13 张原帧复核确认第 6/7/276/554/1816 帧缺少整条 rail，命中第 1/2/3/6 轮；不能把像素自动筛查表述为 2002 帧逐张人工验收。本次确认共享 UserScreen 入口，不冒充旧 LeoSH 对象重放。证据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 user019-six-rounds 与 editor-original-frame-review。 |
| 能力 ID | `USER-01` |
| 历史症状与根因 | 2026-09-23 对真实 `68` 个主题、`270` 条回复的资料页执行六轮切换与 `80ms` 级快速拖动。`3037` 帧录像中，第 4 轮 `27.112867s`（帧 `1437`）吸顶 TabRail 出现一帧缺口，前后内容仍沿用户拖动方向移动，未发生资料头回顶。根因 seam 为 FlashList `StickyHeaders` 在 JS 滚动回调中计算 currentStickyIndex，再通过 React state 将普通行交接给吸顶副本；该交接没有与原生滚动逐帧原子结算。它与已修的延迟 scrollToOffset 覆盖用户拖动是不同问题。 |
| 当前 owner | `src/features/user/UserScreen.tsx` 的 RN FlatList 与原生 ScrollView sticky 接线；`tests/ui/user/user-screen.test.tsx` 使用真实列表验证切换、回顶取消与两组分页。最低可靠视觉证据仍为实际 APK 的 TouchTrace 和原生录像，组件测试不代替逐帧结论。 |
| 失败 oracle 与边界 | 已确认实际滚动与吸顶发生时，整条 TabRail 任何编码帧缺失均为失败。修前 FlashList 2.3.2 在 sticky index 为 -1 时不挂副本，JS 交接缺口由历史及本轮修前录像确认；修后全编码帧的像素筛查与关键原帧复核未再命中。自动候选筛查不等于逐张人工审阅，不外推其他设备与所有输入时序。 |
| 2026-10-04 修复与验收 | USER 页面改为 RN FlatList，同一栏经原生滚动动画吸顶，保留资料头、同一列表、双组 cursor 与用户滚动意图。首次空数据阶段即固定关闭原生子节点裁剪，避免加载后才出现 sticky 时切换裁剪配置；初候选首次缺栏而暖重进恢复，最终候选三个 fresh PID 均首进正常。普通 1.3.150/154、APK `0eab23334285615fbbd3c10b40de86e36ce039f45bfd8f11735478f0c8d58cd1` 与源码匹配；NodeSeek 夜轻资料页六轮 TouchTrace 完成，43.993189 秒的 2406 个编码帧筛查零缺栏候选，关键窗口 48 个原像素帧复核正常。第 4 轮起点栏 y522，其余主要 y900，六轮均跨过 y305 吸顶阈值；轮间主动回顶不算异常。实际主题/回复分别显示 24/25 条不同内容，跨过来源每页 15 条；User→Topic→Back 锚点 y936→936。取得本场景 `DEVICE_REPLAY_PASS`、只读实际来源 `LIVE_PASS`，USER UI 30/30、列表项单测 2/2、类型检查通过。证据位于 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 user019-fixed-six-rounds、user019-functional-v2、user019-cold-v2 与 editor-original-frame-review；物理设备未验。 |

## `REG-LIBRARY-001` 分类菜单测量前显示并接受迟到定位

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01/03`，共享 `NAV-01` 的页面失活边界 |
| 历史症状与根因 | 2026-09-23 受控 Native 测量确认：分类按钮先设置菜单可见，异步 measureInWindow 尚未返回时已提交默认或上次坐标；页面失活也未关闭菜单。旧实现的「测量前不可见」和「离开后不重现」两个行为 oracle 失败。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` 保留真实 Screen/PopupMenu，延后原生测量回调，核对首次可见位置、来源/页签/失活取消及旧测量晚于新测量完成；`tests/ui/library/library-route.test.tsx` 用可完成的原生测量边界继续验证实际筛选查询。 |
| 修复与边界 | 当前测量完成并提交锚点位置后才显示菜单；关闭、换来源/页签、失活、尺寸变化及卸载使旧请求失效。筛选、确认及列表宿主不变。UI 时序 oracle 已通过；使用相同 Library 源码的 B2 正常 Release 在主 AVD 上三次打开菜单，逐帧检查首次可见锚点已稳定，未见位置跳变。修复前录像也未捕获跳动，因此两段录像不是设备红绿对照；原生 measure 回调延迟导致提前显示的因果由 UI 红绿 oracle 证明。设备证据仅覆盖这三次打开，不外推其他设备或全部异步测量时序。 |

## `REG-LIBRARY-003` 收藏二级页布局异常且本机分类缺失

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-01/02/03`，共享 `NAV-01/03`、`MORE-03`、`DATA-02` 与 More 菜单入口 |
| 历史症状与根因 | 2026-10-02 用户确认 More 的收藏入口与同组条目不对齐，收藏内页的留白、控制区及内容也不合理。共享 `MenuButton` 对空 `value` 仍渲染元数据行；Library 从底栏迁入 native 二级页后仍叠加旧状态栏和底栏留白，列表外层侧边距又与卡片内边距叠加。分类、计数和清空历史分散，关注用户仍保留隐藏分类槽；首次资料尚未加载时将缺省计数显示为零。来源与分类分别结算还使切站的真实 Route 曾查询 `source: v2ex` 与上一站 `category: nodeseek:daily` 的组合。 |
| 当前 owner | `tests/ui/shared/expandable-controls.test.tsx` 承接空副标题及非空值；`tests/ui/library/library-screen.test.tsx` 承接 native header 下的列表 inset、关注用户无分类槽、未加载不报零及稳定筛选宿主；`tests/ui/library/library-route.test.tsx` 承接真实 Query 的来源/分类组合、重复选中来源不重查，以及仅在本机集合中的分类菜单；`src/platform/storage/readerDataStore.test.ts` 承接整个集合的分类查询；`tests/ui/app/content-source-navigation.test.tsx` 承接真实 More route 在 Library 或首页往返后保留内联外观展开。沿用现有 owner，不把普通通过测试绑定到 REG。 |
| 失败 oracle 与修复 | 真实 Route 的跨来源分类 oracle 与三条布局/未加载 oracle 均先 RED 后 GREEN。空副标题不创建文本行，二级页按 native header 与自身安全区布局，帖子卡片使用全宽列表及内部 16 dp 留白；tab、来源在上，分类/计数/清空历史同一控制行，关注用户不创建分类槽。来源变化与分类重置在同批提交并回顶，当前来源或分类重复选择不重查、不滚顶；未加载或读取失败不补零计数。 |
| 本轮 Native 逃逸与根因 | 后续真实模拟器验收中，NodeSeek 历史有 129 条，卡片包含 Dev、测评、沙盒、日常等分类，但分类按钮灰色禁用；全部来源的分类菜单只有妖火。`LibraryRuntime.categories` 来自 Feed 远端 taxonomy 投影，NodeSeek 未读取首页时没有目录，妖火却因本地常量存在目录。分类可用性错误依赖无关的首页读取，已有布局和跨来源筛选 owner 未覆盖仅存于本机集合的分类。 |
| 本机分类修复与证据 | 分类改用现有 SQLite 的 `source/categoryKey/categoryLabel` 查询对应收藏或历史整个集合及已启用来源，独立本地 Query 与列表分页、来源和分类筛选分离，复用 `reader-library` 失效前缀；不扫描当前 50 条、不新建 schema、不新增网络读取。删除 Library 的 Feed 分类投影，Feed/Search 原有分类读取保持不变，分类读取失败独立显示重试。真实 Route 的最低 oracle 在旧菜单缺少本机 summary 独有分类时 RED；启用来源集合变化后的冷读原先又将已选 `nodeseek:daily` 撤回 `all`，该 oracle 同样先 RED。仅当前 scope 真实分类数据到达后才校验分类，placeholder 只复用同 collection 且过滤仍启用的来源，冷读和失败均保留分类与名称，不复用旧帖子分页；修后 Screen/Route 两个 UI owner 38/38 通过（seed `210602`），SQLite owner 38 项通过。 |
| 最终自动验证 | 布局、未加载计数、跨来源筛选、本机分类及 scope 冷读保留均已有 RED→GREEN。`STATIC_PASS`：完整 `npm run verify`（含 unused 与版本门禁）、`npm run typecheck`、定向 ESLint、文档 29 项及 14 份文档一致性检查通过。`UNIT_PASS`：235 文件 3217 项（seed `1790916692862`）；`UI_PASS`：95 suite 2180 项（seed `1121396188`），最终冻结源码相关 7 suite 100 项通过（seed `1307702906`）。 |
| 追加返回逃逸与修复 | 前一候选最终返回 More 时，原来展开的内联外观被关闭。根因是 `MoreRoute` 的 focus effect cleanup 仍执行旧 modal 流程的 `setShowSettingsPanel(false)`，将进入 Library 导致的 More 失焦当成关闭外观。真实导航的 Library/首页两条 oracle 修前 RED（seed `1436050004`），删除该清理后 GREEN；相关 7 suite 100 项 UI 通过（seed `1307702906`），typecheck 与定向 ESLint 通过。 |
| 最终构建与模拟器验收 | 新 APK SHA-256 为 `a67782abc89faca40d56f9a09b472a79b7fb86901f4b3b0d805390340fb1b4a4`，含新增 MoreRoute 的生产 9 文件 sourcemap 与最终源码精确一致，pinned 签名匹配；`APK_SANITY` 通过。`library-return`（24.7 秒）与 `more-readonly`（20.1 秒）两条 `DEVICE_REPLAY_PASS` 均零重试，前者新增展开外观 → Library → 返回仍展开且主题选项可见的 oracle。人工查看新 APK 截图，More 收藏标题与行中心差 0.5 px，收藏行进入/返回 rect 完全一致，外观仍展开，三站登录为 3/3；firstInstallTime 保持 `2026-07-26 16:51:37`。帖子收藏/关注用户空态、历史 418 条及全部/四来源的计数与分类正确，NodeSeek 日常 73/418 且重选当前来源仍为日常。再次进入真实 V2EX Topic 并确认 `topic-detail-loaded` 后返回，V2EX 来源及全部分类保持，未打开的顶部两条旧记录 yDelta 均为 0；打开的旧记录按最近访问重排，其下条目自然上移。 |
| 验收结论 | 最终匹配 APK 已确认 Library 布局、分类和真实详情返回位置，以及 More 外观展开返回保留；canonical 红绿、全量单元/UI 和匹配设备证据达到本轮关闭条件。UI 属性与 Query 调用不代替 Android 绘制，Replay 与人工结果不外推未验设备。 |
| 未验证范围 | 本机设备没有非空收藏或非空关注用户，该两种状态仅由 canonical UI owner 承接；真实写入未执行。不外推其他设备或完整真实来源分支，截图与日志保持 ignored，不纳入仓库。 |

## `REG-LIBRARY-002` 历史重读移除日期分组后返回位置跳动

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `LIBRARY-03`，共享 `NAV-03` 的详情返回位置 |
| 历史症状与根因 | 2026-09-30 保留数据 API 35 主模拟器上，滚动 NodeSeek 历史并重读旧帖后返回，未点击旧卡片出现约 85 px 上移。`visit` 将 `savedAt` 更新为当前时间，数据库按最近访问时间降序返回；原「本周」唯一记录移入「今天」后，分组派生移除空的「本周」标题。Library 禁用 FlashList 可见内容锚定，因此分组高度变化直接改变原可见旧记录位置。最近访问排序属于既有行为，不以固定重读行原坐标为验收条件。 |
| 当前 owner | `tests/ui/library/library-screen.test.tsx` 使用真实日期分组与实际 patched `useRecyclerViewController`，覆盖日期标题及本次打开行处于首个可见位置时，以后续合格旧记录核对重排后的屏幕位置；筛选边界使用真实 `RecyclerViewManager` 与 `ScrollAnchor`，核对默认、冷/缓存数据变化和分类切换不挂载 Native 锚点结构，打开主题才启用，并保留列表身份。该属性边界不复现 Android 绘制。`tests/ui/library/library-route.test.tsx` 继续承接筛选与分页查询。 |
| 失败 oracle 与修复 | 修前两条位置 oracle 在同 seed `13018274` 下均精确少 85 px，修后通过。历史默认及筛选期间保留原 disabled 结构，只有用户从当前历史筛选打开主题才启用 Native 锚定，只选择未被本次打开的可见旧记录，排除日期标题和重读行。访问与数据刷新期间不提前关闭；来源、分类、tab 或启用来源集合变化使旧锚失效，不自动重新开启。不改数据库排序、不延迟刷新、不重建列表宿主。 |
| 本轮 Native 逃逸与撤回 | 首个修复用 `onCommitLayoutEffect` 在筛选新布局后重新开启锚定。主 AVD 的候选 `71d96b` 在 fresh Library → 历史全部 → linux.do 后计数为 131/415，但卡片持续空白超过 20 秒；NodeSeek 冷筛选同样空白，切回全部恢复。同版本、签名和 firstInstallTime 的旧普通包 `9b8` 经保留数据覆盖对照，在相同 linux.do 顺序立即显示四张卡片，确认是本轮列表开关回归。FlashList 开关会动态增删 absolute top=1,000,000 的 `ScrollAnchor` 并改变 Android ScrollView MVCP，不仅改变 JS 校正；Native 空白的更底层布局机制未独立定位。该候选拒绝交付，已撤回 scope/布局回执恢复状态，保留设备失败历史，不以此前 UI 回执测试代替 Native 验收。 |
| 自动验证 | 简化修复的 Library Screen/Route 两套共 30 项为 `UI_PASS`，seed `13018274`。既有 Route 超时同 seed 重放通过；最后默认 seed `-413040164` 又出现一次 5000 ms 超时，同 seed 单 Route 与两套重放、默认 seed `214513185` 的两套 30 项均通过。未确认该偶发超时根因，未加 timeout、重试或修改 owner；移除默认 disabled guard 的负向控制使冷历史挂载真实 `ScrollAnchor`，属性边界 oracle 失败，恢复后通过。该控制不声称复现 Android 空白。 |
| 普通 APK Native | 与当前 Library 源码匹配的普通候选 `89cc2ed` 在保留数据主 AVD 上，linux.do 与 NodeSeek 各完成点击首个、靠后可见卡片再返回：所选未点击旧锚的坐标变化均为 0 px，重读主题均进入最近访问首位；两站冷来源筛选正常显示卡片。上述真实来源入口为 `LIVE_PASS`，未要求锚下所有旧行同时保持坐标。 |
| 隔离 Native 与证据边界 | 同一 Library 源码的 Release/Hermes fixture `f9822d`（buildId `7a43893504464907a7277aa65a8a79fd`）使用真实 LibraryScreen、TopicCard、FlashList 与启用 freeze 的 NativeStack，仅在内存更新访问时间。在首个及靠后可见位置分别重读唯一「本周」记录：本周 1→0、今天 2→3，重读记录进入首位；首个用例排除 viewportTop –21.714 dp 的点击行后锚定 earlier-1，靠后用例锚定 today-01，真实 ref 视口位置及 AX 坐标变化均为 0，列表 Native 实例与 Screen mount 保持，blockedRequests 为 0。此原生补充证据验证日期标题消失和真实可见行排除；不冒充 tracked `.ad` 的 Replay，也不替代普通包持久化，不声称冷筛选空白的底层布局机制已完全定位，也不外推物理设备。 |

## `REG-WRITE-118` 只读状态恢复重放已消费的编辑器聚焦

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/02/04/05/07`、`NOTIFY-02` 的 StructuredReplyComposer 共享 seam |
| 历史症状与根因 | 2026-09-23 真实 Composer 的 Bridge oracle 确认：同一正值 focusSignal 在预览或提交的 readOnly 往返后再次请求 Native 焦点并发送 focus 命令。旧 effect 依赖随 readOnly 改变的回调，把状态恢复误当成新的用户聚焦意图；旧实现期望一次请求而实际两次。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` 固定同一 signal 不重放、新 signal 在未就绪/只读时等待，以及可写后只消费一次；同时核对 WebView/HTML 保持、零重新 INIT 和实际 Native/Bridge 命令。 |
| 修复与边界 | 每个显式 focusSignal 只消费一次，只有 ready 且可写时才记为已消费。没有重新挂载编辑器、重置草稿或修改系统键盘策略。UI oracle 已通过；实际 IME 显隐与帧时序仍由匹配设备验证，妖火原生输入器不属于此修复。 |

## `REG-WRITE-119` 返回收起表单后迟到关闭消息重新全屏

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05`、`NOTIFY-02`，共享 `NAV-03` 的回复返回边界 |
| 历史症状与根因 | 2026-09-23 真实 Composer 的消息顺序 oracle 复现：从全屏回复打开展开表单，Android Back 先把原生弹层收为 sheet，随后 WebView 的 PANEL_CHANGED 关闭消息仍按旧 fullscreen 恢复目标再次全屏。旧实现最后一次 presentation 为 fullscreen 而不是 sheet。 |
| 当前 owner | `tests/ui/topic/structured-reply-composer.test.tsx` 同时覆盖原 sheet/fullscreen 的正常关闭，以及 Native 先收起、Bridge 后关闭的顺序；核对恢复目标、工具栏重新可见、WebView/HTML 未重建和零 INIT。 |
| 修复与边界 | 接收到原生 fullscreen→sheet 的明确收起时同步更新展开表单的恢复目标，再发送 blur；迟到关闭消息遵守新的 sheet 目标。正常关闭仍恢复用户原窗口。UI 红绿已通过，实际 Android Back 动画和 Gboard 行为尚须匹配构建验收。 |

| 2026-09-23 设备复核 | 匹配候选 E 的主 AVD 上，NodeSeek 空回复进入全屏链接表单，IME 已退出后按一次 Android Back。212 个实际编码帧显示返回半屏后直到录像结束都未再次全屏，零输入、未发送，为该入口的 `DEVICE_REPLAY_PASS`。半屏出现后 header/footer 与工具栏分阶段恢复，约 645 ms 才完整；不把终态正确扩大为过渡全程原子。 |

## `REG-TOPIC-184` 图片预览首次可见提交携带空页或上次图片

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-02`，共享 `TOPIC-01/03` 的 preview catalog |
| 历史症状与根因 | 2026-09-23 首次可见 commit oracle 确认：关闭期间仍保留预览内容实例，公开媒体 session key 不变时，打开后的首个提交复用旧三槽状态，effect 才换成当前 catalog。V2EX 和未指定来源两例均复现首次空页、再次打开先提交上一张图片；仅检查 effect 后最终 URI 会漏掉问题。 |
| 当前 owner | `tests/ui/topic/image-preview.test.tsx` 从 Native 图片边界的 layout effect 记录已提交 URI，再由父级 layout effect 采样首次可见提交；V2EX 与 null 两条公开来源路径在旧实现均失败，修复后均只包含本次请求的图片。既有关闭重开、旧回调、会话与三槽回收用例继续共用该 owner。 |
| 修复与边界 | 无当前图片时包装层不挂载预览内容，每次打开由当前 catalog 初始化三槽；全局媒体缓存和打开期间的手势轮换不变。UI owner 已通过；该证据证明 React/Native 属性提交边界，不单独证明屏幕实际绘制、解码或设备帧率。 |

| 2026-09-23 设备复核 | 匹配候选 E 的主 AVD 只读直达 V2EX `t/1229472`，同一主题内对两张可区分图片执行 A→B→A→B 四次关闭重开。351 个实际编码帧均未出现上一次图片，可记该入口 `DEVICE_REPLAY_PASS`。首个可见预览帧有当前计数但图片区域是黑底加载态，约 11–114 ms 后才显示本图；这不等于首帧已完成解码，也不证明其他来源。 |

## `REG-WRITE-120` 工具层返回正文时分类标题先展开再收起

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-02/07`，共享 `WRITE-01/04/05`、`NOTIFY-02` 的编辑器返回意图 |
| 历史症状与根因 | 2026-09-23 主 AVD 的单次坐标点击录像确认：工具层返回正文后，分类/标题先展开，约 0.9 秒后随 IME 到达再次收起。工具关闭消息先于首个原生键盘帧，发帖页只有「工具开着/键盘已显示」两个事实，缺少其间的用户输入意图；这与 `REG-WRITE-117` 的同一键盘状态被两个布局 owner 异步消费不同。妖火 onFocus 先关工具层、IME 后到达也经过相同空档。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 固定 rich/source 的显式返回意图先于面板关闭且草稿不变；`tests/ui/topic/structured-reply-composer.test.tsx` 固定 epoch、ready、可见、可写与遮挡/renderer 门禁；`tests/ui/topic/yaohuo-reply-composer.test.tsx` 固定 Native 焦点与 inline/selection 表情区别；`tests/ui/topic-composer/create-topic-screen.test.tsx` 固定 L/妖火首个键盘帧前标题不展开，以及标题、失活、只读、新草稿、面板、预览接管时取消。runtime 两例、Screen 与妖火对应旧实现 oracle 均实际为红。 |
| 修复与边界 | 新增独立且带 documentEpoch 的 RETURN_TO_EDITOR，保持 PANEL_CHANGED 的普通开关语义；父页只在显式返回与首个 IME 帧之间保留折叠意图，实际键盘或其他所有者接管后清除。妖火通过真实 onFocus 或 inline 表情返回接入，不把普通关闭变为自动弹键盘。相关 UI 243 项、runtime/Bridge 97 项通过，保持 WebView、文档与草稿，不引入延迟定时器。 |
| 设备验证与剩余边界 | 最终 D 正常 Release 的主 AVD「文字格式→输入正文」录像共 5.133 秒，逐帧检查全部 23 个实际编码帧，分类/标题始终 compact、零展开；约 1.720 秒工具面板关闭，2.321 秒开始显示 IME，交接期间无标题回弹、闪白或面板重开，末尾无障碍状态确认真实 IME 已显示。此普通返回路径为 `DEVICE_REPLAY_PASS`；此前 C 的 5.067 秒、25 个实际编码帧亦全部保持 compact。另一次快速三轮录像两次坐标误入工具，只有一次有效返回正文，不能作为快速往返通过证据；旧 IME 尚在收起时立即返回、物理设备与其他输入法仍为 `NOT_VERIFIED`。 |
| 2026-09-23 快速交接补验 | 在同一正常 Release/Hermes 候选 E（SHA-256 `afa2a2eb022826b43fa708248add974110b64e3e1ab0287996eb278977eb062a`）上，发帖页从文字格式返回正文的有效快速操作录像共 31 个实际编码帧，分类/标题始终 compact，正文始终可见，格式面板未重开，结尾真实 Gboard 已显示。新 Screen 的 pending 只在新的 `KeyboardState.OPEN` 且高度超过底部 inset 后清除；旧键盘的关闭余帧不能提前清除，修前失败、修后通过的时序 owner 为 `tests/ui/topic-composer/create-topic-screen.test.tsx`。旧 D 的另一段有效快速录像也未捕获标题展开，所以这两段设备录像不能作为 Native 红绿对照。工具栏被 IME 暂遮约 0.48 秒是独立 `REG-WRITE-121`，不能将标题通过写成整个交接完全平滑；物理设备与其他输入法仍未验证。 |

## `REG-WRITE-121` Gboard 回升时正文工具栏短暂被遮挡

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 当前结论 | 已修复一条经同钟证实的 React commit 暂停 Reanimated 提交、导致 IME 新布局被跳过的根因；采用官方要求的成对开关并覆盖 Android Kotlin provider。普通包 8f73fcfc… 在主 AVD、默认 GL、真实 Gboard 下，两次独立冷启动的六轮 linux.do 新主题空正文「文字格式→输入正文」共 422 个原帧均未见工具栏遮挡，文字均为正常 36 px，`WRITE-02/07` 该链路为 `LIVE_PASS`，本条关闭。保留直接 IME source 修复及全部历史负例；物理设备、其他输入法、长正文、其他来源和未测选区为 `NOT_VERIFIED`，不承诺未编码时刻。GL 渲染间隔、独立 Back 与完整动画继续由 `REG-WRITE-087` 跟踪。 |
| 2026-10-04 复核 | 普通 Release 1.3.150/154、主 API 35、Gboard：文字格式→输入正文三轮，204 个实际编码帧。第 31 帧 PTS 3.899756s 工具栏整行不可见，第 32 帧 4.066944s 恢复；第 98/99 帧 10.531900/10.698833s 不可见，第 100 帧 10.854256s 恢复；第 164 帧 17.156567s 不可见，第 165 帧 17.310822s 恢复。均以真实 IME 已出现为前提，没有用自动化 helper IME 的首段录像判断。证据见 ignored `.codex-tmp/known-issues-verify-20261004-2ae8fd38` 的 gboard-three-cycles.mp4、editor-original-frame-review；仅描述实际采集画面及其时间间隔，不推断两帧之间所有显示周期。 |
| 能力 ID | `WRITE-02/07`，共享 `WRITE-01/04/05` 的结构化编辑器与 IME 绘制边界 |
| 历史症状与根因 | 2026-09-23 主 AVD 上，旧 D 与最终 E 的有效「文字格式→输入正文」录像均显示新 Gboard 开始上升后，底部单行工具栏先完全不可见，再只露上缘，约 0.477 秒后恢复到键盘上方；分类/标题与正文顶部没有同时消失。E 的 DOM/原生 WebView 尺寸已跟到目标值，但屏幕仍显示两至三张错位编码帧。同 APK 的 Chrome + Perfetto + 视频同钟取证中，遮挡帧对应 App RenderThread `WebViewFunctor::drawGl` 约 `246/248ms`，SurfaceFlinger 仅约 `9/6ms`；一帧内 GL 状态查询累计约 `201ms`，App 出现 `Buffer Stuffing`。该历史样本定位当前模拟器的 WebView 原生 GL 绘制提交瓶颈；后续已有同 AVD 后端及独立原生 GL/Vulkan 对照，见下行和 `REG-WRITE-087`，物理设备仍未验证，不能断言所有设备同样耗时，也不能说 GL 查询是模拟器独有。 |
| 当前 owner | `src/features/topic-composer/TopicComposerScreen.tsx` 的直接 IME 高度避让、`tests/ui/topic-composer/create-topic-screen.test.tsx` 的当前帧行为 oracle、`tests/ui/topic/composer-keyboard-viewport.test.tsx` 的共享几何，以及 `src/ui/composer/StructuredReplyComposer.tsx` 的嵌入式 WebView。`package.json` 与 `patches/react-native+0.86.3.patch` 拥有全局提交策略，补丁安装归 `tests/tooling/patch-artifacts.test.ts`；该静态 owner 不证明并发行为。匹配 APK 的真实输入法录像、native geometry、Perfetto/FrameTimeline 与逐帧报告共同拥有绘制证据；既有同钟报告在 ignored `.codex-tmp/transition-followup-20260923-021317/toolbar-attribution-analysis.md`，本轮证据见下行。JS mock 不能证明 Android 绘制连续性。 |
| 软件 GPU 对照 | 保留数据和相同 E APK，临时以 `-gpu swiftshader` 冷启同一 AVD，SurfaceFlinger 报告 Google SwiftShader。无输入/发布的有效文字格式→输入正文重放，两次 DOM click 分别命中目标；45 个实际编码帧中，Gboard 上升的第 26–33 帧工具栏未完整出现在键盘上方，第 34 帧恢复，首个错位帧到恢复帧的录像 PTS 约 `245ms`。故问题并非只在原 AMD host 后端出现；但该次两次 DOM click 相隔约 `959ms`，与 host 原样本手势不等时，不能把两段遮挡时长当作性能收益比较。追踪模式的另一手势第二次 click 未命中「输入正文」按钮，其 trace 不作为同动作 A/B 归因。实验后恢复原 host GPU，登录和安装身份保持。 |
| 失败 oracle 与处置 | 真 IME 已可见时，工具栏不得被遮挡或裁切；同一 oracle 保留历史 host、SwiftShader、686 hardware 与临时 Vulkan 负例，本轮成对开关修复后由两次普通默认 GL 冷启动通过。没有放宽图标可见条件，也未以终态或原生矩形代替逐帧图像。保留直接 IME source，不追加标题 pending、重复 Insets、CSS、固定延时或预留空白；WebView 保持 hardware，不以文字失真或临时 renderer 换取通过。设备与输入法覆盖单列，GL 性能不由本条关闭。 |
| 2026-09-30 回复呈现慢帧与 GPU 后端 A-B-A | 正常 Release/Hermes APK SHA-256 `71d96b01fd3fc4bcbd48ae851af1d60b3e21311a7f4d752908739e359edf9945`、WebView provider 156 与用户数据保持，临时切换同一 API 35 主 AVD 的 GPU 后端后恢复 host。无 trace 的已初始化暖态回复打开最慢帧为 host `478/489ms` → SwiftShader `89ms` → 恢复 host `522ms`；SwiftShader 收起为 `65/70ms`。Perfetto 的 `WebViewFunctor::drawGl` 均值约 `241ms` → `41ms`，实际输入与原始编码帧同钟对齐的录像也从长时间保持原帖后跳到完整面板，变为记录到多个展开、收起中间位置。慢帧在暖态持续复现，A-B-A 支持当前模拟器 GPU 后端显著放大 WebView GL 绘制耗时；不限定某一显卡厂商，也不外推所有真机。host 录像首次打开为冷编辑器，SwiftShader 录像前已开合两轮，首屏初始化时间不作直接对比；编码帧仍有约 `55–79ms` 间隔，不宣称零卡顿或连续 90Hz。`androidLayerType="none"` 单变量候选未消除绘制阻塞，已恢复原 `hardware`。证据在 ignored `.codex-tmp/topic-followthrough-20260930/` 的 `.codex-tmp/topic-followthrough-20260930/backend-comparison.json`、`.codex-tmp/topic-followthrough-20260930/backend-reply-frame-review.md` 与三份 `final-*-unprofiled.json`；本次仅确诊回复呈现的模拟器慢帧，未新增本条真实 IME 遮挡或实体机通过证据，该轮仍保持 `OPEN`。 |
| 2026-10-04 直接 IME source 修复 | `TopicComposerKeyboardObserver` 仍仅在页面 active 且无独立 Modal 时订阅，发布稳定键盘 source；viewport 直接计算当前 `height` 减安全区，不经 reaction 复制 padding。卸载只释放自己的 source，保留 OPEN 交接、Modal 生命周期、同一 WebView 与草稿。当前 IME 帧先于 reaction 的最低 oracle 修前期望 312 实得 0，修后相关 UI 104/104、typecheck、定向 lint/format 通过。v4-A 相比 v3-A2 的收键盘原生几何滞后减少，但回升仍有大幅滞后，`drawGl` 中位数 244.732→243.199 ms；不是无探针视觉通过。证据为 ignored `.codex-tmp/remaining-four-20261004-113939/topic-direct-height/review.md` 与 `.codex-tmp/remaining-four-20261004-113939/scratch/editor-direct-audit/report.md`。 |
| 2026-10-04 软件绘制对照淘汰 | v3 同 APK hardware→IME 中途 software→hardware 的实际层为 2/1/2，software 的 `drawGl` 为 0，但正文文字纵向压扁；v5 从创建即使用 WebView software 仍将同宽 258 px 的文字高度约 36 px 压至 26 px，隐藏键盘后仍失真，DOM 字号、行高、DPR 与 transform 未变。v7 的实际层确认为父 Host software=1、子 WebView none=0，GL 为 0，文字区域与 v5 逐像素相同，不能作为产品修复。未形成预期实际层的诊断样本不计对照。证据在 ignored `.codex-tmp/remaining-four-20261004-113939/editor-ime-probe/layer-aba-review.md`、`.codex-tmp/remaining-four-20261004-113939/scratch/editor-software-v5-audit/report.md` 与 `.codex-tmp/remaining-four-20261004-113939/scratch/editor-parent-v7-audit/report.md`。该阶段 Host 已恢复原实现、WebView 恢复 `hardware`，诊断 WZ probe 已移除；当时只保留直接 IME source 修复，后续改动另见下行。 |
| 2026-10-04 最终普通包原帧验收 | APK `956bce1d…`、PID4362、主 AVD 原 host GPU、Gboard，linux.do 普通新主题空正文三次「文字格式→输入正文」。205 个原始编码帧全部人工复核，三次 Gboard 首可见帧为 #30/94/157（PTS `5.244889/12.889056/20.456522s`），五个工具均已完整出现在其上方；中间 #31/95/158 与稳定 #32/96/159 也完整，至末帧 #205 未见遮挡或裁切。输入前后空草稿保持，采集时无 trace、诊断 probe 或并行构建。旧普通复现每步等待 1200 ms，本次 1500 ms；回升前均已完全退键盘且工具栏归底，没有以未到达相同起点或截断过渡取得通过。`WRITE-02/07` 该入口为 `LIVE_PASS`，不外推每个显示周期零卡顿、其他来源/输入法或真机，也不关闭独立 Back 的失败。原尺寸帧、PTS/Winscope 对齐与逐帧复核在 ignored `.codex-tmp/remaining-four-20261004-113939/final-editor-cycles/original-frame-review/`；原生控件输入另在同任务 `final-input-check/` 验证 Search 输入与恢复空值，未提交搜索、历史保持。 |
| 2026-10-04 中间 none 候选复验 | 普通 APK `cfcb8a62…`、PID4090，linux.do 新主题空正文的三轮「文字格式→输入正文」中，第 2 轮 #88/#89 被真实 Gboard 遮挡，#90 恢复；首个已见失败至首恢复的原始 PTS 间隔为 `310.277778ms`。该段 197 个编码帧的正文占位文字高度均为 36 px；第 1/3 轮编码帧未见遮挡，不能覆盖第 2 轮失败。`androidLayerType="none"` 候选已撤回，源码恢复原 `hardware`；后续 hardware 也复现，不能据此认定 none 是唯一根因。证据为 ignored `.codex-tmp/remaining-two-20261004-continue/retained-final-visual-review.md` 与 `retained-r2-cycles/original-frame-review/`。 |
| 2026-10-04 恢复 hardware 普通包复验 | 无 probe 的 Release/Hermes APK `68651441d8508da45544d9ec97cf66af815cb751506f17563c7d1006198931b6`（sourceHash `62779f29ea9c57708023daff0672cbd33bac41a52bbd9ff163cfb00a42b75c63`），同 PID10530、主 AVD 真实 Gboard。linux.do 普通新主题空正文两段各三轮，共 428 个实际编码帧：r1 第 1 轮 #33/#34 五工具被覆盖，#35 恢复，首失败→首恢复 PTS 间隔 `327.766667ms`；r1 第 3 轮 #165/#166 五工具被覆盖，#167 恢复，间隔 `321.988889ms`；r2 第 3 轮 #165/#166 四个高图标下半部被盖、更多三点仍可见，#167 恢复，间隔 `327.844444ms`。其余三轮编码帧未见遮挡，因此六轮为三次失败、三次未见，该阶段保持 `OPEN`。全部 428 帧占位文字墨迹高度为 36 px、未见纵向压扁；正常字形和稳定终态不替代过渡帧验收。上述间隔只描述已编码首失败至首恢复，不推断全部未编码显示时刻，也不以源码 layer 配置推断本次实测原生层或线程根因。原始帧、PTS 与独立逐帧报告位于 ignored `.codex-tmp/remaining-two-20261004-continue/` 下的 `hardware-r1-cycles/original-frame-review/`、`hardware-r2-cycles/original-frame-review/` 和 `.codex-tmp/remaining-two-20261004-continue/hardware-topic-visual-review.md`。 |
| 2026-10-04 普通包临时 Vulkan 回升对照 | 同普通 APK `68651441…`，两次保留数据冷启动后分别为 PID3248/3269，均无 trace/probe。linux.do 新主题空正文各三轮真实 Gboard 回升，共 324+321=645 个实际编码帧：首冷轮三次及第二冷轮前两次未见遮挡，但第二冷轮第 3 次 #250 五工具全部被 Gboard 盖住，#251 恢复。#249 工具栏完整但仍在旧位；#250 PTS20.725433333s、#251 PTS20.737200000s，首失败至恢复的编码间隔为 11.766667 ms，不是精确故障持续时间。全部 645 帧占位文字墨迹高 36 px，无压字；六轮的一次负例仍否定稳定修复，且视频本身不能区分实际布局滞后与 App buffer 呈现滞后。Vulkan 只作临时环境归因，不是支持的 App 产品方案，不覆盖默认 GL 负例，该阶段保持 `OPEN`。原帧和独立复核见 ignored `.codex-tmp/editor-root-cause-20261004/ordinary-vulkan-topic-r2-independent-review/report.md`；原生 GL/Vulkan 成本对照与公开 API 边界见 `REG-WRITE-087`。 |
| 2026-10-04 提交暂停同钟红例 | G4 诊断包在临时 Vulkan 下仍复现：React hook 于 78.6117861s 暂停 Reanimated，78.6134677/78.6254951s 两个新 IME batch 在 C++ 实际 skip，同 doFrame 的 toolbar bottom 均停在 1702，IME 为 755/798 px，几何重叠为 57/100 px；Java queued gate 未挡住更新。mount unpause/requestFlush 后 registry 重放，下一帧 padding/layout 恢复。原尺寸热点 #230–246 中，#240 四个高图标下沿被盖、#241–242 五图全被盖、#243 恢复，首失败至恢复的编码间隔 31.233333 ms。pre-draw/commit 不等于上屏，不把矩形差代替可见像素。证据为 ignored `.codex-tmp/editor-ime-geometry-probe-20261004/g4-review.md` 与 `.codex-tmp/editor-root-cause-20261004/geometry-g4-visual-review/report.md`；这一原因不覆盖所有历史 GL 慢帧。 |
| 2026-10-04 成对开关修复与诊断绿例 | `package.json` 编译期启用 `DISABLE_COMMIT_PAUSING_MECHANISM=true`；RN source patch 同时将 C++ 与 Android Kotlin defaults 的 `preventShadowTreeCommitExhaustion` 设为 true，保留 stable release level，不额外启用其他 experimental flags。Android stable provider 经 JNI 接管 C++ getter，故 Kotlin 侧不能省略。G5/G6b 两次冷启动、同 6c5c3c30… 诊断包各五轮：340 次实际动画 commit 全部成功，两个运行时开关各 340 次观测均为 1，skip/cancel 为 0，537 次 pre-draw 未见旧几何大差；存在 React 与动画提交交叠，并非无更新条件下的零失败。478+532=1010 个原帧独立复核，十次真实 Gboard 回升均未见遮挡。此前 G6 的 IME 未显示前置检查退出，没有动作或录像，不计有效采样。此层仅为临时 Vulkan 诊断；普通默认 GL 另见下行。证据为 ignored `.codex-tmp/editor-ime-geometry-probe-20261004/pair-diagnostic-summary.md` 及 `.codex-tmp/editor-root-cause-20261004/` 下的 `geometry-g5-visual-review/report.md`、`geometry-g6b-visual-review/report.md`。 |
| 2026-10-04 普通默认 GL 关闭验收 | 无 trace/probe 的普通 Release/Hermes APK `8f73fcfc56a9a48162d3b591afe1910b97c5ca86f01ebaf85ae757dcab68f252`，主 AVD 每轮保留数据冷启动后分别为 PID3162/2839。linux.do 新主题空正文、真实 Gboard，各三轮「文字格式→输入正文」；212+210=422 个 1080×2400 原帧的工具栏与文字均完成原尺寸复核，六次回升未见五工具被遮挡或裁切，文字墨迹均高 36 px、无软件压扁。各动作窗延伸至正文动作后 3 秒且包含稳定尾段。回升相邻编码 PTS 仍有 144.177778–176.011111 ms 间隔，不代表全部显示时刻或性能通过；本条仅按上述入口验收关闭。相关 tooling 87、UI 387、native 280、架构检查（625 个模块）与 typecheck 通过，不能将 UI mock 或该局部 Live 外推为全局 Reanimated 入口已验收。普通功能另核对新帖标题/链接输入框的聚焦与返回，以及分类 Modal 开合，NodeSeek 回复/私信的全屏 Back、半屏与取消重开，既有图片预览开关、Feed 上下 900 px 后的位置及 FAB 隐显恢复、More 账号中心真实内容展开；私信空稿发送保持禁用，未提交发送。这些仅证明本轮实际端态功能，不代表快速竞态、图片拖拽或性能全验。原帧与独立汇总见 ignored `.codex-tmp/editor-root-cause-20261004/pair-ordinary-gl-topic-visual-summary.md` 及其两份逐轮报告。 |

## `REG-WRITE-122` 图片上传完成时占位与图片之间闪出空白帧

| 字段 | 内容 |
| --- | --- |
| 状态 | `OPEN` |
| 当前结论 | 已确认缺陷已有修复，待验收。上传插图与清占位已原子化，返回首帧预热也已接入；最终无探针的隔离 mock Replay 中，八条选图路径及附件取消样本未见返程闪白，另已执行私信成功并确认图片和草稿保留。全部来源、共享入口和物理设备仍须独立验收。 |
| 能力 ID | `WRITE-04/05/07`、`NOTIFY-02` 的共享结构化编辑器 |
| 历史症状与根因 | 2026-09-23 用户真机录屏在无键盘上传完成后，先看到「上传中…」占位消失和正文空白，下一帧才出现「图片加载中…」。富文本结算先独立 dispatch 清除 ProseMirror decoration，再另起 transaction 插入 Markdown 图片，两个可见状态之间没有内容。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 在真实编辑器每次 transaction 后观察占位或图片节点；旧实现出现 `[false, true, …]`，修复后无空白 transaction，同时验证映射选区、正文与焦点。 |
| 修复与边界 | 成功结算在同一 Tiptap transaction 内插图并清占位；解析或插入异常仍立即清理占位。相关 runtime 96 项通过。模拟器只执行了系统选图取消，未模拟成功上传后的设备绘制。用户再次报告无键盘时仍有相同闪动；尚未核对真机是否运行该源码对应 APK，也没有新的成功上传逐帧证据，不能把 DOM transaction oracle 当成设备绘制通过。 |
| 2026-09-27 成功链路补验 | 真实系统选图器读取合成 PNG，mock 上传及图片响应；有键盘成功链的 rAF trace 覆盖占位→图片，二者都缺失的采样为 0，图片实际解码显示。但无键盘成功返回在原帧 59–72 出现正文与 HTML 工具栏同时空白，原生标题/底栏已完整显示后仍白约 148 ms；第 73 帧恢复，相关帧间隔 14.5–18.6 ms。该闪白发生在 Activity 返回阶段，早于上传完成，不能用原子插图修复解释或判绿；此次无键盘 DOM trace 在后台暂停采样，且与录屏没有同钟锚点，尚不能区分白屏窗口的文档与原生绘制层原因。保留 `OPEN`；证据同 `.codex-tmp/image-upload-visible-20260927`，真机未验证。 |
| 2026-09-27 后续修复边界 | viewport 交接与共享 DocumentPicker IO 的确定性修复、原生 red/green 证据见 `REG-WRITE-087`；它们不拥有本条的 WebView 返回绘制结论。组合 APK 的 `combined-hidden-cancel.mp4` 在默认系统动画下仍白 190.477 ms，其中选择器完全返回后仍白 101.133 ms；有键盘成功的选择器淡出头两帧也白 35.489 ms。无键盘成功与有键盘取消本次返程未白，不能覆盖另外两条失败。证据位于 ignored `.codex-tmp/image-upload-fix-20260927`；不能把 `tests/native/DocumentPickerThreadingTest.kt` 的主线程可用性通过或原子插图 oracle 通过写成闪白消失。保留 `OPEN`，各入口完整视觉流程与物理设备仍须分别验证。 |
| 2026-09-27 后台绘制资源回收确证 | `.codex-tmp/image-upload-fix-20260927/viz-long-cancel-trace.json` 中窗口隐藏约 10.002 秒后出现 `BrowserViewRenderer::TrimMemory` 与 `DrawFn_OnContextDestroyed`，旧 functor 3 被回收；返回后新 functor 4 的前三次 `DrawFn_DrawGL` 没有有效 child，也未进入 `VizDrawAndSwap`，约 318 ms 才激活新 child、379 ms 才 present。短隐藏约 1.5 秒的对照保留 functor 3；此前短停留关闭系统动画的对照受停留时长混杂，不能据此把闪白归因于系统动画。这里确证的是该 WebView/设备的后台绘制资源回收与首帧恢复路径，不把图片加载阶段空白混为同一原因。 |
| 2026-09-27 临时 Photo Picker 对照与正式入口缺口 | 临时直接 `ACTION_PICK_IMAGES` 探针的 `photo-long-cancel.mp4` 停留约 23 秒后，首个揭露的编辑区与工具栏完整，未见白帧、间距或跳位；对应 `.codex-tmp/image-upload-fix-20260927/photo-long-cancel-trace.json` 未出现窗口隐藏、TrimMemory 或 context-destroy 事件。该探针不等于最终实现：持久修复使用 `ACTION_GET_CONTENT`，保留系统 Photos 与 Browse 文件提供者能力，照片页每批数量受平台限制，本次不增加应用侧每批选择上限。正式 `GET_CONTENT` 与 Browse 文件路线的完整视觉验收仍待完成，特别是文件路线仍可让宿主窗口长期隐藏；不标整体通过，不关闭本条。上述取证保存在 ignored `.codex-tmp/image-upload-fix-20260927`。 |
| 2026-09-27 返回首帧预热修复 | 确证长期隐藏回收绘制资源后，单独等待 visual callback 不足；临时硬件层 `buildLayer` 后再等待 callback 的 Browse 长停留取消对照通过。持久 `react-native-webview+14.0.1.patch` 新增默认关闭的 `androidPrewarmOnWindowVisible`，由 `StructuredReplyComposer` 恒定标记编辑器身份，原生首个 pre-draw 以 `isShown` 和非空 `getGlobalVisibleRect` 判断可见范围：返回时临时预热并等待所属 callback，之后恢复原 layer；首次可见跳过，关闭开关、再次隐藏、detach/destroy 均清理，旧回调不释放新 epoch，异常或 2 秒 deadline 仅作失败释放。Canonical owner `tests/native/ComposerWebViewPrewarmTest.kt` 使用真实 Activity 与有效 400×600 WebView；同一有效 harness 的原类行为执行 8 项、7 项行为失败，恢复生产实现后 8 项全部通过，零跳过/错误。有效原始 XML 为 `.codex-tmp/image-upload-fix-20260927/prewarm-native-baseline-red.xml` 与 `.codex-tmp/image-upload-fix-20260927/prewarm-native-restored-green.xml`。后续真实 `ReactViewGroup` 的 GONE 祖先与屏外 translate 两项可见性 oracle 修前失败、修后通过，当前 owner 共 10 项。该 owner 控制 GPU 回调，只证明原生生命周期，不证明真实首帧无白或识别 alpha/其他视图遮挡。 |
| 2026-09-27 新入口与预热对照边界 | 正式 `GET_CONTENT` 分流的 `get-content-docked-keyboard-cancel.mp4`、`get-content-docked-keyboard-success.mp4`，以及临时预热构建的 `build-layer-browse-keyboard-success.mp4` 均以完整停靠 Gboard 开始；三条本次返程原帧未见白帧、底部间距或跳位，Browse 路线停留超过 10 秒。但去程仍有约 83 ms 灰色间距（Browse 成功为 83.978 ms），见 `REG-WRITE-087`。上述录像同在 ignored `.codex-tmp/image-upload-fix-20260927`；探针返程通过不能替代包含最终持久开关的无探针八路径验收，各共享入口及真机仍须独立验证，本条保持 `OPEN`。 |
| 2026-09-27 附件面板可见范围逃逸与修复证据 | 旧 `visible` 开关在 Topic 附件面板打开时关闭预热，但面板上方仍露出编辑正文。`prewarm-scope-topic-cancel-baseline.mp4` 返回时原生标题已可见，正文从原帧 #134 / 14.080722s 至 #139 / 14.183767s 才恢复；首个完全返回帧 #138 / 14.164856s 仍无正文，附件面板没有遮住该区域。录制时并行原生 RED 测试，因此这 103.045 ms 仅证明功能闪白，不作可比性能耗时。身份标记与原生可见范围修复后，scope 原生回归从 10 项中 2 项失败变为 10 项全过，四个原生 owner 合计 27 项通过；XML/日志见 `.codex-tmp/image-upload-fix-20260927/prewarm-visible-native-red.xml` 与 `native-final-green.log`。相关 tooling 82 项通过，seed `1790482605682`；WebView/DocumentPicker 两个依赖与根 lock 的 integrity 一致，隔离 `npm ci --ignore-scripts` 后正向检查、真实 postinstall 和反向检查通过，见同目录 `clean-patch-install/receipt.json`。最终无探针构建的八路径、修后附件/私信及真机视觉仍待独立验收，本条保持 `OPEN`。 |
| 2026-09-27 最终无探针返回补验 | sourceHash `8c4bfce994ace5e52ea82ee5650925d65169a15c8fd1c79619a54a76e3b8a193`、buildId `78fc080dce974696b3c25bee19d8f75f` 已完成回复 Photos/Browse × 有/无完整停靠 Gboard × 取消/成功的八条实际路径；检查到的返程编码帧未见正文闪白或旧高位跳动。`final-topic-attachment-cancel.mp4` 在 OPEN_DOCUMENT 长停留后，原帧 #134 开始显露时标题与正文均已出现，#138/139 完全返回时正文完整，并连续到 #166；独立 Topic 正文取消及私信成功也已执行，私信图片和草稿保留。证据在 ignored `.codex-tmp/image-upload-fix-20260927/final-visual-matrix.json`、`.codex-tmp/image-upload-fix-20260927/final-acceptance.md`。本次仅证明这些隔离 mock Replay 样本，未覆盖所有来源/写入入口或真机；去程灰间距仍见 `REG-WRITE-087`，不宣称整体平滑，本条保持 `OPEN`。 |

## `REG-TOPIC-185` LinuxDo 关闭主题仍能打开回复并继续发送

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `TOPIC-01/03`、`WRITE-01` |
| 历史症状与根因 | 2026-09-29 在正常 App 打开 LinuxDo 2967364，页面显示「已关闭」和「话题已被作者删除」，但仍可点「写回复」进入编辑器。Discourse 已解析 `closed`，共享 action decision、编辑器关闭与异步发送前复核却只覆盖妖火。现场仅打开/收起编辑器，没有发送回复。 |
| 当前 owner | `src/features/topic/actions/topicActionDecision.test.ts` 维护关闭决策；`tests/ui/topic/topic-actions-controller.test.tsx` 维护同次渲染拒绝、关闭保稿、旧回调与选图/CSRF/真实代理等待后的零 POST，以及开放和合法编辑对照；`tests/ui/topic/topic-reply-filters.test.tsx` 以真实 decision、TopicScreen 与 ReplyItem 维护主/楼层入口和阅读保留。 |
| 修复 | 共享关闭判断覆盖 LinuxDo，新增回复与上传接入已有请求前 guard；保留已有回复的合法编辑和附件权限；编辑器显示移除错误的点赞权限前置条件，该 UI oracle 修前失败、修后通过（seed `-383859171`）。UNIT 修前 1 项失败（seed `1790696121080`）；controller 修前 5 项失败（seed `-654483801`），包括等待期间关闭后仍产生 POST。 |
| 验收与边界 | `STATIC_PASS`：类型、相关 lint/格式、架构、文档及 diff 检查；`UNIT_PASS` 33 项（seed `1790696412942`）；`UI_PASS` 299 项（seed `-1455260407`）。主 AVD `emulator-5562` 覆盖安装正常 Release/Hermes build `1c8a11e987e749a9aab0cd0de8c08473`，APK SHA-256 `d43172ddc45748719b79b719730094b5be47fd08a341f0547458b9a3c8d64fdb`，firstInstallTime 保持 `2026-07-26 16:51:37`。`LIVE_PASS`：原帖关闭标记、标题、正文及阅读工具正常，回复按钮消失，点赞/收藏入口保留；该帖零回复，楼层回复入口由真实 ReplyItem UI owner 覆盖。`APK_SANITY`：启动后当前进程无 AndroidRuntime/ReactNativeJS error。未执行真实回复、上传或编辑写入，实体机为 `NOT_VERIFIED`。本机证据保存在 ignored `.codex-tmp/closed-topic-20260929`。 |

## `REG-ACCOUNT-056` NodeSeek 签到成功后收益确认长期等待

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`，共享账号中心签到状态与鸡腿流水 |
| 历史症状与根因 | 2026-10-02 用户在保留登录态的模拟器主动随机签到，余额增加 3 鸡腿，页面仍持续显示「签到成功，收益待刷新」。原站 board 的本人 `record` 仅有 `id/member_id/day_id/gain/created_at`，榜单 `list` 才额外包含 `member_name`；adapter 共用榜单结构校验，错误拒绝合法本人记录，签到后的 GET 对账无法确认收益。旧合成 fixture 为本人记录补了原站不存在的姓名，漏检此差异。 |
| 当前 owner | `src/sources/nodeseek/accountData.test.ts` 的 `accepts attendance records without leaderboard-only member names`；同 owner 保留本人身份、必需数字/日期字段、缺失与显式 null、榜单姓名的独立验证。通过测试使用行为标题。 |
| 修复与验证边界 | 拆分 `NodeSeekAttendanceRecord` 与带姓名的榜单 `Entry`，本人记录和 signed 状态消费前者；不放宽 ID、归属、签到日、收益或时间校验，不补零，也不据余额差猜测签到状态。实际 App-owned WebView 只读 GET HTTP 200 已确认原站结构；同结构 oracle 修复前 2 项失败（seed `1790872597764`），修复后相关来源 6 文件 167 项通过。同签名覆盖安装后的实际账号页已通过只读回读显示「今日已签到 · 获得 3 鸡腿」，流水显示收入 3、净变化 +3 和余额 635；重进与返回后状态保持。Agent 未额外提交签到，真实写入由用户主动完成。 |

## `REG-ACCOUNT-057` linux.do 回复统计被拆成独立发言指标

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04`，共享 `USER-01` |
| 历史症状与根因 | 2026-10-02 用户指出账号中心 linux.do 将发言统计与回复入口分开。adapter 把实际 `post_count` 放到 `postCount`，把原站未提供的 `reply_count` 当作回复数；More 因而展示不可点的「发言」，另放「我的回复」。这是来源字段口径误判。 |
| 原站证据 | [Discourse UserStatCountUpdater](https://github.com/discourse/discourse/blob/main/app/services/user_stat_count_updater.rb#L32-L37) 将首帖记为 `topic_count`，普通回复记为 `post_count`；[原站概要 UI](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/templates/user/summary.gjs#L131-L137) 将 `post_count` 直接链接到 `userActivity.replies`。 |
| 当前 owner | `src/sources/sourceUserRead.test.ts` 固定原始 `post_count` 直接映射 `replyCount`、零值与字段缺失；不相减，也不保留重复 `postCount`。`tests/ui/more/more-screen.test.tsx` 固定「回复」数字直达 replies 和缺数 fallback。来源 oracle 修前 5 项失败、More 两项失败，修后分别 39/39、25/25 通过；通过测试使用行为标题。 |
| 只读验收 | 当前签名候选覆盖安装后，实际 L 站账号区显示「回复 33」，数字直达已选中的回复列表，用户页同样显示 33 且没有独立发言指标；返回保留账号中心展开与站点。账号区切站、返回、前后台与手动刷新正常，两类流水缓存返回正常。`APK_SANITY`、`DEVICE_REPLAY_PASS` 与此范围 `LIVE_PASS`；firstInstallTime 仍为 `2026-07-26 16:51:37`，三站登录保留。没有执行真实签到或回复写入，零额外 GET 由 UI Query owner 的调用证据维护，不用界面无转圈代替网络证据。 |

## `REG-ACCOUNT-058` 账号中心缓存切站闪白与重复状态提交

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01/04` |
| 历史症状与根因 | 2026-10-02 用户反馈三站切换反复闪动。账号卡片按站点和身份重建时使用 140 ms FadeIn，已有缓存内容也先变透明；受控选站在子组件再次同步本地镜像并回传父组件；相同签到看板观察也总创建新的 scopedState，额外触发 Account runtime 更新。Query 的手动刷新和无限内存缓存策略没有产生重复的暖切站 GET。 |
| 当前 owner | `tests/ui/account/account-center.test.tsx` 维护切站正文无整卡片淡入、受控选站提交次数与同站点击无操作；`tests/ui/account/nodeseek-check-in-controller.test.tsx` 维护相同看板观察不提交，以及收益、记录、排名、服务端日、身份和 epoch 变化仍更新；`tests/ui/more/more-screen.test.tsx` 维护认证关闭、来源禁用/恢复和全部账号来源为空时的选站记忆。通过测试使用行为标题。 |
| 修复与红绿证据 | 去掉整张账号卡片的 entering 动画，保留身份 key 与展开/收起动效；More 持有受控选站，只记住实际启用的来源；签到状态提交比较实际领域字段。相同受控三站更新修前 6 次提交、修后 3 次（seed `219602`），相同或等值签到看板两次重复观察修前 2 次提交、修后 0 次（seed `19476013`），内容/日期/owner 改变仍提交一次。全部账号来源暂时关闭的新增 oracle 修前失败，实际来源 guard 修后保留原选择。修复前正常 Release/Hermes APK SHA-256 为 `2f49b4144017260756e9ad54c04e314fdf73481dc178283e8e9477d6f718147a`，三站暖缓存各切换两次的原生录屏已捕获整卡片闪白；本机对照证据保存于 ignored `.codex-tmp/account-switch-20261002`。 |
| 验收与边界 | `STATIC_PASS`：`npm run verify`、`npm run typecheck` 与 `git diff --check`；`UNIT_PASS` 235 文件 3211 项（seed `1790908299225`）；`UI_PASS` 95 owner 2157 项（seed `-871781881`）。正常 Release/Hermes APK SHA-256 `f8995c3c5a66e6a64b41c6b3d0e3099c925813d2da4dee4be88aa591019e5e58` 通过同签名覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`，三站登录与原有数据保留。`APK_SANITY`、两条只读旅程 `DEVICE_REPLAY_PASS`；此范围 `LIVE_PASS`：后台构建/测试均结束后，按同一六次暖切站序列录屏（修前 11259 ms、修后 11453 ms），整卡片不再从透明开始，展开/收起动效保留。去重后的变化帧为 104/86 帧，固定昵称区域 `(250,970,730,1090)` 无深色像素的帧从 21 降至 0，逐帧拼图复核确认整卡片闪白被消除；这不是丢帧率或 FPS 指标。UI 红绿仅证明 React 提交与网络调用行为，实体机帧率和真实签到写入仍为 `NOT_VERIFIED`。不修改 Query 数据生命周期，不清 Cookie 或登录状态。 |
| 本轮追加复查与边界 | 后续全面流畅度复查确认，外层账号卡片仍因站点/用户 key 在切站时重建，未打开的站点设置正文也参与挂载。移除外层 key 以复用卡片及共有统计宿主；设置和低频资料仅首次打开时创建，同 owner 收起保留动画子树，来源或用户变化释放旧设置与草稿，低频资料在 site/UID 变化的同次提交中重置展开与正文。linux.do 等级正文首次展开时创建，收起保留，离站释放隐藏正文但保留展开意图，内部 UID key 仍重置 tab。`tests/ui/account/account-center.test.tsx` 与 `tests/ui/more/more-screen.test.tsx` 承接宿主稳定、懒挂载及身份重置，站点面板和共享展开 owner 保留草稿及收起门禁；本轮匹配 APK 的原生流畅度复验仍为 `NOT_VERIFIED`，不以此前淡入或高度动画验收替代。 |
| 本轮结构修复包原生复验 | 匹配 APK SHA-256 `6124ca7f28fbf40f830c0c2c207d041c3aa6ebcc886bc2561cc5af12dfcb091a` 的多批 L↔NS 切换最长帧分别为 24.5/70.4/81.3 ms，同轮旧包为 244.9 ms、中间包为 154/157 ms；Y↔NS 为 23.4 ms，资料与设置开合最长均约 25 ms。仍捕获 NS 返回 draw 73 ms，不据此标为全流程无长帧。source/profiler 仅提供 SVG 相关线索，未证明头像是唯一原因。此范围原生复验为 `LIVE_PASS`；证据保存在 ignored `.codex-tmp/comprehensive-fluidity-20261002`，实体机和真实签到写入边界不变。 |
| 2026-10-02 冷重启与调用栈复查 | 正常冷启仍能捕获长帧。临时去掉头像未消除 101～116 ms 长帧，已还原；从原生节点读取坐标并逐次确认实际选站后，Host 十次L/NS切换worst111.795ms。同期 Perfetto 显示主线程 Record View#draw7.349ms、另一次postAndWait60.318ms，RenderThread DrawFrames92.088ms及 glBufferDataSyncAEMU 编码；不能把 gfxinfo draw 区间当作主线程 SVG 软件绘制。相同 APK 的 SwiftShader 对照使账号 worst 降至 42.423 ms，却让 Search 更慢，已正常关机并恢复 Host；不保留配置或新增头像缓存。新修复的原生复验因安装工具误操作后设备冻结而 `BLOCKED_BY_ENV`，仍不能宣称全部切站无长帧。 |
| 恢复后统计与资料复查 | 同一现有 More owner 继续承接四个固定统计宿主及资料归属。统计 key 从文案改为固定位置，NS→L 不再重建后两项；seed210603 修前复用矩阵为 `[true,true,false,false]`，修后四项同实例且当前金融/公开动作、无障碍属性、UID 目的正确。未访问资料的跨站切换原也会在 render 内同步 owner，使组件函数执行两次但只有一次 commit；现在仅已访问资料在归属改变时重置。既有 standalone case 以实际 `useWindowDimensions` 调用计数建立 oracle，seed210604 修前期待 1 实际 2、修后 1，并保留已打开资料跨站/UID 同 commit 隔离；More30/30通过。没有增加缓存、延时、memo 或多树常驻。原安装身份与三站登录已恢复，可见 Host 的 9d 候选 L↔NS 三批仍有 `58.337/68.538/63.566ms` 长帧，妖火↔NS 独立 20 次切换 worst `23.271ms`；这些不能证明整体卡顿已解决，RenderThread/GL同步线索仍保留，不把重复函数执行当作全部长帧原因。 |
| 最终包与边界 | 加入未访问资料 guard 的 869e0521 包，同一可见Host/PID13505且三站已登录；L↔NS 三批各 20 次实际切站 p95 `23.273/52.267/54.742ms`、worst `74.192/63.912/70.157ms`，未证明稳定性能改善。妖火私有指标加载后独立 20 次切换 p95 `22.974ms`、worst `23.832ms`、无相邻 miss，不能替代 L 站路径。两种流水和收藏返回均实际通过，金融数字未输出；正常冷启、覆盖安装与四条只读 Replay 后原 UID、首次安装时间及三站登录保持。全部 3218 单测和 2194UI、类型与所需静态门禁通过；首次完整 verify 的文档短引用失败已定点修复并补跑后续检查，不将原 exit1 记作 exit0。证据和未验证范围见 ignored `.codex-tmp/intermittent-restart-20261002/final-acceptance.md`；此事故已有结构修复仍保留，但整体长帧没有标为解决。 |

## `REG-ACCOUNT-059` 账号切站内容被高度动画裁住

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01/03/04`，共享 `MORE-02/03/05`、`DATA-03` |
| 历史症状与根因 | 2026-10-02 去掉整卡片淡入后，用户仍反馈切站观感卡顿。`ExpandableContent` 的测量高度每次改变都成为新的 200 ms timing 目标；切站时新内容先替换，外层 clip 却继续从旧高度扩容，先裁掉底部签到与设置。切到较矮卡片后，下方菜单留出旧高度再缓慢回收。上一匹配 APK 原生帧从 0.740011s 到 0.942311s 才展示完整新卡片，约 202 ms；这段录制未展开内层，不代表已测得嵌套交互耗时。 |
| 当前 owner | `tests/ui/shared/expandable-controls.test.tsx` 维护已展开内容变高/变矮时不启动新的高度动画，同时保留中途收起/重开、草稿、隐藏触摸/无障碍、系统减少动态效果与箭头数值验证。Account/More 现有 owner 覆盖实际嵌套入口、会话与选站。 |
| 修复与红绿证据 | 展开和收起只对 0/1 进度插值，实际高度乘以进度，透明度使用同一进度；展开完成后直接跟随新测量尺寸，嵌套展开时祖先不再次追赶。使用安装的 Reanimated `useDerivedValue` 保证 worklet 数值，不把 animation descriptor 直接相乘。新 oracle 修前因新的 240 dp 高度启动 timing 而失败，修后相关四个 owner 89/89 通过（seed `210602`）。共享实现没有增加 props、计时器、组件保活或 Query 读取。 |
| 验收与边界 | `STATIC_PASS`：`npm run verify`、`npm run typecheck` 与 `git diff --check`；`UNIT_PASS` 235 文件 3211 项（seed `1790909403506`）；`UI_PASS` 95 owner 2158 项（seed `-1324880744`）。正常 Release/Hermes APK SHA-256 `ba14e0e556489963d87478652e8e546e9f8fca207b7a902347e3b7d5a9f00b9c` 同签名覆盖安装，firstInstallTime 保持 `2026-07-26 16:51:37`、三站登录保留，`APK_SANITY` 与两条只读旅程 `DEVICE_REPLAY_PASS`。此范围 `LIVE_PASS`：构建和测试结束后同一六次暖切站录屏，修前首次 NS 从选中到完整 footer 约 178 ms、下方布局约 200 ms 才稳定；修后两次 NS 分别从 .630000→.649089s 与 4.242411→4.279522s 展示完整 footer，约 19.1/37.1 ms，不再逐帧插值追赶。仍有一个旧测量高度帧，不能称零裁切或首帧完整；后续头像加载变化不属于几何动画。Windows Emulator 窗口静止后鼠标展开/收起外观与账号中心、展开资料、站点设置、NodeImage 及手动备用均能命中并完整显示，没有输入或保存任何凭据/Key。去重后变化帧 90→19 只作录屏内容记录，不是 FPS。证据在 ignored `.codex-tmp/account-smooth-20261002`；真实签到写入和实体机帧率为 `NOT_VERIFIED`。 |

## `REG-ACCOUNT-060` 鸡腿流水今日签到收益误用站点签到日

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-04` |
| 历史症状与根因 | 2026-10-02 原生只读验收中，设备本机日期已为 10 月 2 日，最新签到账本记录属于本机 10 月 1 日。今日收入和净变化正确为 0，页头却显示「签到 +3」。页头读取 `board.record.gain`，把原站签到日的本人收益当作本机日期的今日账本收益；未齐记录也被该数值错误补成完整合计。 |
| 当前 owner | `tests/ui/more/nodeseek-credits.test.tsx` 维护原站看板缓存与账本本机日期不同、今日记录未齐、完整零值、读取中反馈，以及两种流水首次读取、返回和刷新均不读取看板。共享本机日期汇总仍由 `src/features/more/nodeSeekCredits.test.ts` 承接；账号区看板继续维护签到资格。通过测试使用行为标题。 |
| 修复与证据 | 最低行为 oracle 在修复前稳定复现上述日期与完整性错误，修后通过。页头改用既有 `summary.today.attendanceIncome`，完整后才展示合计，零值显示 0，未完整显示统计中或待补齐；移除流水额外看板 Query、返回字段和 route 投影，不修改账号区的看板读取、签到提交或日期规则。相关流水 UI owner、类型、定向 lint 与格式检查通过。 |
| 验收与边界 | 最终匹配 APK SHA-256 `6f636dc7a7dd0b61f83041f23baaf97c67baa827ff7f90ce6fe35eaf4f26ef88` 以正常 Release/Hermes 同签名覆盖安装，设备本机日期为 GMT `2026-10-02`。More 仍显示原站已签到收益 3；流水读取中先显示统计中，记录完整后本机今日收入、净变化和签到收益均为 0，昨日分组显示签到 +3。右上角 GET 刷新后结果一致，返回 NodeSeek 账号区仍保留选站与展开状态，此跨日显示、刷新和返回范围为 `LIVE_PASS`。证据保存在 ignored `.codex-tmp/comprehensive-fluidity-20261002/accepted-ledger.png`。未执行真实签到 POST；本条不代表最终全量门禁或内存验收结果。 |

## `REG-NOTIFY-077` NodeSeek 个人页重进私信停在旧缓存

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-02`、`NAV-02/03`、`USER-01` |
| 历史症状与根因 | 2026-10-02 用户报告从个人页进入 NS 私信后不更新。临时会话使用稳定 conversation UID，详情虽 staleTime=0，却继承全局 refetchOnMount=false；退出重进同一账号/会话直接复用旧 Query，活动详情也没有周期读取。未读 snapshot 轮询只更新总数，不读取会话内容。 |
| 当前 owner | `tests/ui/notifications/notifications-route.test.tsx` 的同账号缓存重进、可见会话轮询与后台/离页/身份/验证阻断 owner；现有 User route owner 保留入口 descriptor 接线。相关 UI 70 项通过，seed 210602。 |
| 修复与证据 | 实际 Query 与 Navigation 的缓存重进 oracle 修前第二次仍仅 GET 1，私信 21 不可见；轮询 oracle 推进 60001 ms 仍仅 GET 1。详情现在显式重进/前台读取，NS 活动会话按已有消息列表的 60 秒间隔 GET；失焦、后台、来源阻断及身份变化停止。成功读取时间驱动已读核对，相同内容的结构共享不会吞掉回前台的核对。普通模拟器导航与真实互发分别验收，真实互发未获授权，记 `NOT_VERIFIED`；受控 HTTP 响应不冒充原站当天结果。 |
| 本轮真实读取追加证据 | 从用户指定目标的真实头像 `Image → User → Private` 进入会话，原站读取 37 条；重进、停留一分钟和返回前台 GET 均取得 37 条。最新 UTC `06:00:04.706Z`、`06:01:02.346Z` 两次 GET 分别耗时 500/402 ms，此读取入口范围为 `LIVE_PASS`。对方新消息到达与真实互发仍未测试，记 `NOT_VERIFIED`；证据仅存 ignored `.codex-tmp/comprehensive-fluidity-20261002`，不记录私信内容、姓名或目标 ID。 |

## `REG-NOTIFY-076` NodeSeek 会话新消息未读被入口标记挡住

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `NOTIFY-01/02/03`、`USER-01` |
| 历史症状与根因 | 2026-10-02 用户报告进入会话后 NS 红点偶尔不消失，批量已读才消失。个人页临时会话 unread=false、无 remoteGroup，controller 先跳过已读，adapter 又只以 remoteGroup=message 识别私信；列表入口确认一次后整段 confirmed 也会挡住同一会话后来到达的新 ID。审查补充确认旧取消请求的迟到 finally 会删除后续请求的去重记录，后续失败后便自动再提交。 |
| 当前 owner | `src/sources/nodeseek/notifications.test.ts`、`tests/ui/notifications/notifications-route.test.tsx` 与 `tests/ui/notifications/notifications-runtime.test.tsx`；未读总数和红点接线继续由既有 runtime、AppNavigator owners 拥有。此前相关 UI 70 项通过，seed 210602；本轮组合证据见下。 |
| 修复与红绿证据 | 来源分支按 private-conversation 目标识别，只提交原站 unreadMessageIds。修前个人页 descriptor 读取到 20 仍零 mark POST；修后真实 gateway/adapter＋受控 HTTP 响应仅提交 20，再到达 21 仅提交 21，并核对 snapshot=0；已确认 20 重读零重发。失败/未确认 20 刷新零重发，新 21 可独立确认但保留 20 重试入口与 snapshot=1；显式连点只发送一次 20，确认后 snapshot=0。取消时同步释放当前请求的 ID，迟到结算只处理自己的 controller；旧请求迟到、当前重试失败/未确认的两项 oracle 修前额外自动发送第四次，修后保持三次并等待显式重试。后台返回详情修前自动 mark 20，修后零提交，回前台读取后再核对；取消同步更新可重试状态。结算仅失效列表并 GET 核对总数，不强制清零、不重读刚取得的详情。NS source 与 gateway 87 项通过，seed 210602；真实逐条/全部已读和私信发送均 `NOT_VERIFIED`，未执行远端写入。 |
| 本轮追加根因 | 2026-10-02 进一步建立首次 snapshot GET 与已读 POST 交叉的最低 oracle。首个未读 GET 尚未返回、Query 尚无缓存时，即使 `refetch()` 默认允许取消，也会复用原在途 Promise；POST 已确认后对账仍接受写前总数 2，红点要等下一次读取才更新。根因位于共享 `useNotificationsRuntime.refreshSnapshots`，与个人页入口标记及会话新 ID 防重问题并列保留。 |
| 本轮追加修复与证据 | 对账先以当前身份的精确 snapshot key 取消在途 GET，再复核挂载、前台就绪、来源生命周期、身份及 epoch 后读取；不取消 list/detail。修前 seed 210602 的交叉 oracle 期望 GET 2 次、实际仅 1 次；修后得到新的总数 0，并核对可见总数及持久化均为 0，迟到旧响应不能恢复红点。另一组合证明前一批 mark pending 时新 ID 到达，待该批结算后只提交新 ID。6 项取消窗口覆盖换身份、同身份 epoch 变化、后台、来源停用、停用后重启用、runtime 卸载，且 snapshot 取消不伤及 list/detail。最低 8 项 `UI_PASS`，seed 210602；route/runtime 两 owner 与既有 notification performance owner 共 132 项 `UI_PASS`，seed 651002；typecheck 为 `STATIC_PASS`。证据保存于 ignored `.codex-tmp/intermittent-restart-20261002/notifications-oracle-red.log`、`notifications-oracle-green2.log`、`notifications-full.log` 与 `typecheck.log`。这些 oracle 使用 fetcher 边界的受控 `Response`，没有启动本地 HTTP 监听，也不构成原站真实已读写入验收。 |
| 本轮目标会话验收边界 | 用户已授权该目标会话的自动标记未读；实际目标已读，因此产生零 mark POST。真实红点写入仍为 `NOT_VERIFIED`，未执行私信发送或全部已读。 |
| 最终真实入口 | 最终 869e0521 包实点用户给定post-959643-1的主楼头像 ImageView→User→私信；初次、重入与两次前台轮询均新读 37 条，完整操作 370/384/407/344 ms，原生树可见 6 个消息行及 5 行非空正文。零已读/回复/全部已读写入；目标没有真实新未读，故不把新 GET 与已有内容显示当作真实新增未读后的红点验收。四条只读 Replay 与最终自动门禁通过，原安装身份和三站登录保留；脱敏摘要位于 ignored `.codex-tmp/intermittent-restart-20261002/guard-notifications-summary.json`。 |

## `REG-ACCOUNT-061` 账号统计首次加载为空白并切换入口

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `ACCOUNT-01/04`，共享 `USER-01` 的主题与回复入口 |
| 历史症状与根因 | 2026-10-02 用户反馈账号资料先空白、数值随后突然出现。AccountOverviewPanel 对 undefined 统计返回 null，同时在另一区域创建备用入口；数据到达后重新挂载统计项并删除备用入口。修前正常 APK 冷启 → 更多 → 展开账号中心的原生树中统计项为 0，主题、回复和两种流水的备用入口可见；读取完成后才出现四项统计。 |
| 当前 owner | `tests/ui/more/more-screen.test.tsx` 承接三站首次占位、分批返回、真实零值、失败导航、缓存刷新及相同统计宿主；同 owner 的失败重试与回复数缺失入口统一到占位统计项。`tests/ui/more/account-overview.test.tsx` 继续拥有缓存与手动刷新生命周期。 |
| 修复与证据 | 固定四项统计，未知值显示浅灰色「—」，无障碍区分加载中和暂无数据；数值 0 正常显示，数据返回或刷新只更新同一项内容。删除独立备用按钮，入口在占位时仍可用。相关 UI 35/35（seed -1442577342）、typecheck、定向 lint/format、architecture/docs 与 diff check 通过。未取得新增用例修前 RED；修前最低 oracle 为上述真实设备首次加载。 |
| 验收与边界 | 正常 Release/Hermes APK SHA-256 `b3265479ff9b3305cfbeace9ff20e303a52be84840b1810fe000251ad01e789d` 同签名覆盖安装，`APK_SANITY`、More 只读旅程 `DEVICE_REPLAY_PASS`。三站首次资料读取 `LIVE_PASS`：NS/L 首帧四项占位，妖火首帧两项数值及两项占位；读取完成后各四项坐标和尺寸保持一致，NS 缓存返回和手动刷新保留四项数值。占位只属于呈现，不落盘、不改变 Query 读取、身份和签到门禁；可选资料与会员字段不在固定统计位置契约内。实体机和真实签到 POST 为 `NOT_VERIFIED`。 |

## `REG-WRITE-129` 回复提交后立即重开被旧失焦操作清掉焦点

| 字段 | 内容 |
| --- | --- |
| 状态 | `RESOLVED` |
| 能力 ID | `WRITE-01/04/05/07`、`NOTIFY-02` |
| 历史症状与根因 | 2026-10-06 全面测试的隔离 mock 回复已确认提交一次、立即重开为空稿且可见，但真实 Gboard 保持隐藏。匹配修前 APK 的 DOM 观察顺序为 INIT → blur → focus，随后 focusout；Tiptap 的 blur 在 requestAnimationFrame 执行，而 focus 对已有焦点立即返回，旧失焦因此清掉新请求。 |
| 当前 owner | `src/ui/composer/editorRuntime.test.ts` 在受控下一帧前执行关闭或只读往返及重新聚焦，核对实际 DOM 焦点与正文；富文本两条修前失败，源码两条通过。同步 DOM blur 统一覆盖关闭、只读和工具交接，不清选区、不增延迟、不改变连续选表情。 |
| 修复与证据 | 修前设备 buildId `ab723f8f736345b79c0e730f7fc55387`；修前 oracle `focus-red.log` 两项失败，修后相关 runtime/bridge/tooling 185 项 `UNIT_PASS`，seed `1791241000007`。匹配修复包 buildId `f450c52665ea42cb8512f77ca3d3aa2a`、sourceHash `9b7c450f01ed89d5b978b43c06219ae26e42cde64b3b1ca69d67c4ac3e96e637` 的 13 项设备定向回归全部 `DEVICE_REPLAY_PASS`，覆盖提交后立即重开、连续开合、两站富文本/源码/私信/新帖表情、新帖键盘交接与 linux.do 模拟提交；立即重开的空稿可见、keyboardShown=true、请求及确认均恰好一次。普通入口 APK SHA-256 `80ba29ddf97133c69f54f3220894e3acfcce70728f5f8c3d796a46872202ccdd` 同签名覆盖主模拟器，首次安装时间及三站会话状态保持，实际 NodeSeek 空回复两次打开均显示真实 Gboard，为此范围 `LIVE_PASS`。本机证据位于 ignored `.codex-tmp/keyboard-recheck-20261006/`。真实提交、完整 79 项最终矩阵与物理设备 `NOT_VERIFIED`。 |
| 同轮误报纠正 | linux.do 新帖 Emoji 搜索无键盘由 agent-device 默认切到无界面测试 IME 造成。仅修复 runner 在表情验收前恢复真实 IME，同一修前 APK 的原场景即通过；未修改搜索框产品行为。该测试 owner 为 `scripts/run-composer-device-proof.mjs`，证据为 `search-real-ime/`，不得将测试误报记为第二个产品 Bug。 |
