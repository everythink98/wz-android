# 测试标准

## 结论

测试必须证明“功能没有被改坏”，不是证明 App 能打开。影响运行逻辑、类型或构建的改动至少执行相关自动测试和 `npm run typecheck`；纯文档或注释改动只核对内容、引用和一致性。涉及页面流程、登录态、真实来源结果或交互时，还必须做模拟器验收。

开发前先在 `docs/product-map.md` 选择直接受影响的能力 ID；触及共享 seam 时按地图展开关联 ID。交付时逐个 ID 报告自动测试、模拟器路径、真实写操作、已恢复状态和未验证范围。

当前确定性测试使用 `Vitest + jsdom` 覆盖数据规则、来源解析、请求构造和状态计算；少量 `Jest + React Native Testing Library` 测试负责用户可见渲染行为。测试目录归属统一见 `docs/code-standards.md`。agent-device MCP 用于探索真实 App 和执行 `tests/live/agent-live.md` 的受监督验收，tracked `.ad` Replay 用于重复关键旅程。没有覆盖率百分比基线，测试价值以能否拦住明确的用户行为回归判断。

## 判断原则

- 固定 fixture 中能确定的数据，用自动测试精确断言数量、字段、顺序、成功、空态、局部失败、鉴权、超时、解析失败和显式恢复；不新增录制框架，也不把真实认证响应提交进仓库。
- 真实网站结果每天会变，不能把实时结果条数、首条内容或第三方 DOM 写成永久固定 oracle。动态读取分别判断 App 是否让当前请求正确结算并可恢复，以及第三方数据当前是否可得；后一轴只由 Agent Live 记录。
- 搜索、首页、详情、回复、用户页和互动结果必须按对象检查实际存在且适用的关键字段和状态。正确显示错误态可以证明流程，但不能掩盖 App 的请求构造、鉴权、凭据路由或解析缺陷；来源波动也不能被误报为产品失败。
- 登录、Cookie、验证、备份、发布和安装属于高风险功能；只跑 UI 不算通过。
- 只打开 App、看首页显示、截图留存，都不算完整测试。
- 优化代码前只使用与当前 Git revision、App 版本和 APK 身份匹配的 `docs/emulator-baseline.md` 记录；优化后按同一功能、同一关键词、同一来源和同一登录态复测差异，不能以记录日期较新代替身份匹配。
- 登录和验证网页必须从 App 的 `更多 -> 账号中心` 入口打开；页面包名仍应是 `com.wz.reader`。用 Chrome 打开网页不能算登录 / 验证通过。
- 用户提供 NodeSeek、linux.do、V2EX或妖火主题链接用于查看、效果验证或排障时，必须按 `docs/operator-runbook.md` 的“直接打开主题链接”解析来源和主题 id，并直达模拟器 App 内详情页；搜索框、搜索结果、Chrome 或桌面浏览器都不能代替。该内部验证流程不代表产品需要支持外部 HTTPS 链接直达。
- 新增或修改依赖登录态的能力时，必须从 App 内原站同类页面核实字段、权限、入口和请求；未登录页面、桌面浏览器、第三方客户端、作者名或猜测的 API 不能作为依据。必要时可通过 WebView 调试查看 DOM、全局数据、已加载 JS 和 network，但不得输出 Cookie、token 或含敏感信息的截图、UI dump；临时取证文件只能保留在本机且不得提交。
- 单一账号、页面或当前已加载 JS/API 中没有对应入口或行为，不足以证明原站不支持。证据不足时不得猜测实现或新增入口，也不得据此移除或隐藏已有能力；应说明证据缺口。
- “全面测试”默认不授权真实发布、回复、编辑、删除、签到、上传、点赞、鸡腿、反对、投票、原站书签或收藏切换；这些写操作只用自动测试、请求构造、权限显示和只读入口检查覆盖。
- 确实需要真实写操作验收时，必须先得到用户明确同意。发帖、回复、编辑和删除只作用于本次新建、中文且贴合原帖主题的临时内容，完成后清理并刷新确认；NodeSeek 获授权的上述测试优先使用 App 内原站当前标为“沙盒”的官方测试分区，执行前确认分区名称和用途，不硬编码可能变化的 category id；点赞和收藏切换完成后恢复原状态；投票等不可逆操作，以及无法清理的上传，必须针对具体对象或残留风险单独取得同意。沙盒只限定测试对象，不替代每次任务的写入授权。

## 证据分层与工具职责

| 结果 | 必须来自 | 不能证明 |
| --- | --- | --- |
| `STATIC_PASS` | lint、format、architecture、文档、TypeScript、unused、React Doctor 全仓 blocking error | 功能在设备上可用 |
| `UNIT_PASS` | Vitest 行为测试 | React Native 实际渲染或当天原站结果 |
| `UI_PASS` | Jest/RNTL 通过 role、label、text 或稳定 `testID` 验证的渲染行为 | Native/WebView 和真实网络行为 |
| `DEVICE_REPLAY_PASS` | `.ad` 在匹配的 App/APK/设备/会话执行成功 | 第三方当前健康、当天有数据、未包含的能力或真实写入 |
| `LIVE_PASS` | App 内真实来源或获授权写操作的可观察结果 | 其他 revision、APK、账号或日期 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR、RedBox | 业务功能完整正确 |
| `NOT_VERIFIED` | 已识别但缺少足够证据 | 不得改写为“应该可用” |
| `BLOCKED_BY_ENV` | 签名、设备、登录态或来源阻碍且不能安全改变环境 | 不等于代码失败 |

- MCP 是探索、诊断和录制入口；Replay 是经过审查后进入仓库的稳定旅程，二者不互相替代。
- tracked Replay 只能使用稳定 `testID`、accessibility label、role 和稳定文案；禁止坐标、临时引用、动态标题和固定实时数量。
- 动态读取的 Replay 只等待当前请求专属 outcome：Feed 使用 `data/empty/partial/error/auth`，Search 按来源使用同一结果词汇。Loading、未提交或旧请求不能暴露终态；永久 Loading、错误不可见、无恢复入口和来源串扰仍必须失败。一个来源或能力失败不得取消其他独立文件的取证。
- Replay 默认 retries 为 0；单个 `.ad` 首次失败即停止，普通执行失败由外层继续其他独立文件并在最后汇总，清理失败则立即中止后续文件以避免污染，只有全部通过才输出 `DEVICE_REPLAY_PASS`。带 `--record-video` 的 tracked Replay 不自行执行 `close`：test harness 必须先停止并拉回视频，再由 cleanup 关闭 session。诊断性重跑不能覆盖第一次失败。禁止在 CI 使用 `replay -u`：本机 0.19.0 仍可能重写脚本，而 0.19.1 起该参数已退役为 no-op；统一根据 divergence 建议人工修改并审查 diff。
- Agent Live 不是 CI。它只在 `npm run verify` 和相关 Replay 之后按 `targeted` 或 `full` Profile 执行；CF、动态目标、授权、恢复、不可逆写入和失败续跑规则以 `tests/live/agent-live.md` 为准。
- React Doctor 单独扫描全仓并阻断 blocking error；它依赖外部 CLI，不并入确定性的 `npm run verify`，也不替代任何行为测试。
- `npm run check:architecture` 检查真实源码的组合链、依赖方向、route ownership、Screen props 投影、Account raw session/host 能力逃逸、行为测试读取生产源码字符串、旧路径、barrel 和循环；`npm run test:architecture` 用合法/非法 fixture 证明规则本身会接受与拒绝预期输入。两者只提供 `STATIC_PASS`，route 草稿、滚动、inactive gate 和返回优先级仍必须由 RNTL/Replay 证明。
- 历史逃逸事故及负向控制见 `docs/regression-corpus.md`。

## 改动影响面回归

任何会被多个入口、流程或数据路径消费的改动，都不能只用当前复现入口代表完整影响面。修改前后必须按以下顺序执行：

1. 用户指定入口、路径或数据来源时，以该路径作为事实基准；不得用搜索结果、替代入口或近似数据代替。路径确实不可用时，记录阻碍和替代路径的差异。
2. 修改前用代码搜索、结构导航和必要的运行时检查枚举直接调用方、间接消费者、共享状态、配置、样式、数据结构及上下游转换，并记录各入口的输入、默认状态和结果。
3. 按行为而不是文件数量分组。数据约束、生命周期、权限、错误处理或交互结果不同的场景必须分别验收，并在实现上保持清晰边界。
4. 每类受影响行为都要有独立回归证据：优先用能在修复前失败的入口级自动测试；缺少自动化能力时，使用稳定定位和真实运行环境逐入口验收。
5. 局部模块单测只证明局部规则，不能证明所有入口接线正确；静态检查、程序可启动或单个入口截图也不能替代完整影响面回归。
6. 不得为了让新用例通过而删除或合并掉覆盖旧行为的测试。最终交付必须列出“影响面 / 验证方式 / 结果”，未验证项要明确说明原因和风险。

评论布局或间距改动还必须覆盖“正文最后一个可见内容”之后的行为差异，不能只按站点各抽一条普通文本评论：

| 来源 | 必查末尾分支 |
| --- | --- |
| NodeSeek | 普通正文、纯表情 / sticker、带用户留言或签名；可写时检查操作栏，不可写且有统计时检查统计栏 |
| linux.do | 有 / 无 reaction 统计、含投票的回复；可写时检查操作栏 |

| V2EX | 有 / 无回复目标、有 / 无感谢；回复目标必须是紧凑关系标签，不得为了 48dp 触控区用 `minHeight` 撑成大按钮；本站没有评论操作栏，检查末块到分隔线及下一条评论的留白 |
| 妖火 | 普通正文、表情 / 图片；检查回复操作栏，出现删除入口时不得改变操作栏纵向几何 |

每个分支都要比较正文、表情、留言、统计或感谢中的最后一个实际可见元素到操作栏或分隔线的距离，以及操作栏到分隔线的距离；同时用真实截图做视觉复核。只量父容器、只看一张截图或只验证某站普通文本，均不能代表该改动已完整回归。

## 诊断日志完成标准

新增或修改用户可感知的功能时，诊断链是完成标准的一部分。每次公共操作至少写入 `intent`、一个能区分失败阶段的关键事件，以及唯一 `finish`；controller、gateway、传输和状态应用必须复用同一个 `traceId`。日志写入、轮转或导出失败不得改变产品行为。

| 链路 | 必须可判断 | 禁止记录 | 自动验证重点 |
| --- | --- | --- | --- |
| 首页 / 分类 / 搜索 / 详情 / 回复 / 用户页 | 用户触发或分页门禁、credential 是否存在、direct / WebView 通道、HTTP 元数据、解析数量、partial、合并前后数量、stale / cancel / apply | 搜索词、标题、作者、正文、真实 topic / user / cursor、URL path / query | 同一 `traceId` 的 start / 阶段 / 唯一终态；HTTP 200 解析为空、partial source failure、重复 cursor、旧请求丢弃 |
| 回复 / 编辑 / 删除 / 互动 / 投票 / 上传 | 权限门禁、credential / CSRF 来源枚举、请求阶段、乐观更新、rollback、本地 commit、成功后刷新是否失败 | Cookie、token、CSRF / API Key 值、正文、真实目标 ID、投票选项内容、上传文件名 / 路径 / URL | 重复写、缺 credential、乐观回滚、写成功但刷新失败、授权刷新；正文只断言长度，投票只断言选择数量 |
| Session / Cookie / WebView / 代理 | generation、store 空 / timeout / error、会话状态迁移、WebView 队列与 renderer gone、代理 load / apply / save 状态 | Cookie 名称和值、header、WebView HTML / message、代理地址 / 账号 / 密码 | stale generation、fallback / timeout、代理 apply 失败、日志中无伪造 secret |
| 本机资料 / 备份 / 更新 / 图片 / 导航 | save queue、superseded、persist、rollback、备份取消 / 解析 / 合并、更新检查 / 下载 / 校验、图片权限 / 下载 / MediaLibrary、route identity / native stack / back 优先级 | 任意对象序列化、备份内容、文件名 / 路径、图片 URL、页面内容 | 保存失败回滚、损坏 / 超限备份、分享取消、更新失败、权限失败、复杂返回链 |
| 导出与隐私 | 两份 1 MiB 轮转、旧到新 JSON Lines、固定元数据头、系统分享、临时文件删除 | 未列入白名单的任意字段 | 伪造 secret、ID、标题、正文、URL、路径贯穿写入和导出后均不存在；日志故障静默降级 |

诊断日志的合理目标是把多数业务问题定位到模块和失败阶段。纯视觉错位仍需截图，特定内容解析问题仍需原帖链接；native crash / ANR、GPU 和内存问题不以本地 JS 业务日志作为唯一证据。

## 有用测试标准

| 保留 | 删除或合并 |
| --- | --- |
| 能证明站点解析、请求目标、Cookie、登录态、安全边界、写操作、本地数据保存、备份恢复、请求归属或竞态回滚没有被改坏 | 只锁定 `padding`、`color`、`fontSize`、`borderRadius`、memo 比较、性能常量或内部 helper 形状 |
| 能防止用户能感知的回归，例如用户页顶部距离、回复按钮可点、mention 不像普通网页链接、隐藏 WebView 不可见 | 同一行为分支的重复样例，或只复述当前实现写法的断言 |

## 功能与回归选路

本文件不复述产品行为或事故清单。选择验证范围时：

- 从 `docs/product-map.md` 的稳定能力 ID、用户入口和共享 seam 确认当前契约。
- 按能力 ID 到 `docs/regression-corpus.md` 检索历史逃逸问题、精确 oracle 与最低可靠测试层。
- 触及共享 seam 时展开关联能力，不能用单入口成功代表完整链路。
- 本文件只规定测试方法、证据层、授权边界和变更类型对应的验证强度。
## 文档、UI、Replay 与发布候选

稳定 Markdown 改动运行：

```powershell
npm run test:docs
npm run check:docs
git diff --check
```

检查器验证已跟踪 Markdown 与稳定文档中的相对链接、反引号仓库路径、`npm run` 脚本、能力 ID、REG ID 和用户身份认证术语；本机专用的 `docs/emulator-baseline.md` 不要求在干净 checkout 中存在，也不按当前目录检查绑定旧 revision 的历史路径。

在已安装当前目标构建、设备身份明确且不需要覆盖安装时运行只读 Replay；必须同时指定用来核对设备 `base.apk` SHA-256 的目标 APK：

```powershell
$env:WZ_ANDROID_TEST_DEVICE = 'WZ Pixel API 35'
$env:WZ_ANDROID_TEST_APK = 'C:\path\to\current.apk'
npm run test:device
```

`test:device` 要求可信安装为 `agent-device >= 0.19.0`，随后核对 App version/versionCode，并从明确设备只读拉取已安装 `base.apk` 计算 SHA-256；任何身份不匹配都直接失败。它只形成 `DEVICE_REPLAY_PASS`；JUnit、截图、视频和日志产物进入 ignored 的 `tmp/agent-device/`。每个 `.ad` 使用唯一 session、独立 relaunch且不自行 `close`，让 test harness 先完成录屏 stop，再执行 session cleanup；单文件内部零重试并在失败处停止。普通执行失败时外层继续其余文件并汇总为非零退出，任何录屏隔离或恢复失败则立即中止。执行前若明确设备存在 active manifest、对应 `.tmp`、工具录屏进程或 orphan scratch，流程按 `BLOCKED_BY_ENV` 停止并保留现场；正式 manifest 即使为空也按文件存在视为占用。执行后只对同时匹配本条唯一 session 与 device 的 manifest 调用 agent-device `record stop`，未知或畸形 manifest、录屏进程和 scratch 一律不终止、不删除。runner 不结束本机 daemon，不使用 wildcard 清设备文件，也不能停止 MCP、清 App 数据、Cookie、用户文件或本机首败证据。统一 ReaderData 加载尚未结算、routes 尚未放行时必须渲染静态、可访问且无动画的启动状态，使 selector wait 能继续等待而不是因零 accessibility node 提前失败；代理 SecureStore/native apply 不阻断本地 routes，只让 managed network/WebView fail-closed，见 `REG-TEST-008`、`REG-PROXY-011`；不得以固定 sleep 或 retry 掩盖。普通套件固定七个独立失败域：账号终态与服务入口、聚合 Feed、聚合 Search、Library、本地 More、NodeSeek 恢复入口、统一消息中心。主设备账号 Replay 只接受“已登录”或“本次核对失败，可重试”这两个合法 terminal 结果，拒绝 pending、明确退出和失效；不点击公共刷新，不把三站 5 秒内都健康作为门禁。Feed/Search 只断言当前请求进入合法 outcome，不要求实时首条、固定列表长度或动态详情成功；Topic/User 嵌套、登录 WebView lifecycle、linux.do 等级 transport 与 Library 空/非空由固定 RNTL 严格覆盖，真实 WebView、等级和对象链由 Agent Live 在满足前置条件时核实，见 `REG-TEST-005/006/007/009`。

真实未登录验收使用 `tests/device-logged-out/logged-out-readonly.ad` 和独立 AVD：

```powershell
$env:WZ_ANDROID_LOGGED_OUT_DEVICE = 'WZ Logged Out API 35'
$env:WZ_ANDROID_TEST_APK = 'C:\path\to\current.apk'
npm run test:device:logged-out
```

该设备必须与 `WZ_ANDROID_TEST_DEVICE` / `WZ_ANDROID_SMOKE_DEVICE` 不同，不得从主 AVD 克隆用户数据，也不得登录三个论坛；使用与当前 revision、version/versionCode 和 SHA-256 匹配的同一 APK。脚本先验证三站 Account Query 的权威未登录终态，再各提交一次聚合 Search 和聚合 Feed。未登录 Search 的稳定 oracle 是 linux.do/NodeSeek 各出现一个 `search-external-*` settled action、零自动浏览器弹窗；Replay 不读取动态 Google 结果，也不依赖 Chrome 首次启动状态。NodeSeek “未登录”与仅访客“已验证”都必须保持 `isLoggedIn=false` 并走外部 Google 页面，不能调用 ReadGateway 搜索。Agent Live 才分别打开 L/NS 单站，核对 exact `site:` 查询、Custom Tab 浏览、菜单“在阅坛中打开当前主题”回到原生主题，以及 Back 返回后关键词和入口保留；普通浏览器 fallback 必须提示只能浏览。Chrome 首启条款、账号或隐私确认阻断时不得代替用户接受，记录 `BLOCKED_BY_ENV` 并停止发布。runner 不卸载、不清数据、不清 Cookie，也不触碰主设备。

发布脚本分别校验正式 APK 与开发签名 smoke APK 后运行：

```powershell
npm run smoke:android
```

通过标准：覆盖安装且不清 App 数据；确认 App 版本、versionCode、APK SHA、设备和登录来源；覆盖安装后先读取设备 epoch、再写唯一 logcat marker 并执行第一次启动，以 `logcat -T` 有界读取该时间之后的日志，按包名与该包 PID 裁剪 marker 后窗口。`APK_SANITY` 只要求 `main-tab-feed` 可见、目标包在前台且该窗口无崩溃、ANR 或 RedBox；marker 丢失同样失败，不得清空设备全局 logcat。随后执行 `tests/device/` 的七条普通 Replay，形成独立的 `DEVICE_REPLAY_PASS`；真实未登录旅程通过独立设备命令另行执行。动态搜索无结果、合法空 Library 或第三方阻碍不构成 APK 产品失败，只有 APK 身份错误、App 自有入口或当前请求无法结算、永久 Loading、错误不可见或无恢复入口才失败。全程只读，不创建或切换收藏，也不执行其他真实写操作；独立能力继续取证。

动态来源、真实账号和已授权写操作按 `tests/live/agent-live.md` 执行。普通改动只跑受影响能力的 `targeted`；集中修复、里程碑或发布前跑 `full`。非远端写入场景可无人值守且相互独立：App 内原站 WebView 的普通 CF checkbox 只在 Cloudflare 上下文、唯一 checkbox role 和语义 label 同时成立时按新 snapshot ref 点击一次，随后必须通过 App-owned canonical 检测并只恢复原 Query 一次；禁止坐标、DOM 注入、Cookie 导出、独立浏览器旁路、整套重跑或写请求自动重放。登录、账号授权、一次性验证码、题目式 CAPTCHA、无法语义定位、30 秒未通过或 canonical 检测失败只将对应来源记 `BLOCKED_BY_ENV`，不在运行中等待用户，继续其他独立场景；不可逆结果不明确时不得重试。动态服务同时报告应用流程和数据读取结果：成功数据，或明确错误可见、可刷新且无自动请求突发，应用流程均可记 `LIVE_PASS`；数据真实出现记 `LIVE_PASS`，明确限流或有诊断证据的外部故障记 `BLOCKED_BY_ENV`，证据不足记 `NOT_VERIFIED`，诊断证明 App 的请求构造、凭据路由、鉴权头或解析契约错误时则记数据读取明确失败，即使错误 UI 流程本身正确。linux.do 等级首次失败时先保留错误和脱敏诊断；只有错误明确给出可执行的限流/冷却时间（时长或截止时刻），才等待至窗口结束再加 2 秒并显式刷新一次。复试成功仍记录首败，再次限流记数据 `BLOCKED_BY_ENV`；其他错误不猜成限流，也不得仅因 App 正确展示错误态就判产品失败。不得重跑整套或增加全局 retry。

## 消息通知验收

消息中心同时跨三站、账号身份、后台调度和 Android 权限，必须分层验收，不能用“列表能打开”代替协议、隐私或后台证据。

### 自动测试

1. 三站脱敏 fixture 固定分页、稳定 ID、未知类型、未读、auth/CF/畸形响应和来源隔离；NodeSeek 的 CF challenge 与畸形 JSON、Discourse 的 401 与畸形 JSON、妖火的失效登录与损坏详情 target 都必须明确失败，不能结算为空页。NodeSeek 另固定三类 `markViewed` body、列表省略 `viewed` 时仍为未读、缺远端 ID 的非敏感稳定 fallback、同 timestamp 无 ID 多会话保守丢弃，以及 `commentId` 在 floor 缺失/无效/错误时仍为主身份并在 `postPageCount` / pager 确认的页界内逐页命中；Discourse 固定单条/批量 PUT 与顶层 serializer 字段；妖火固定时间/删除动作分离、目标详情 block、目标 ID 缺失明确失败和详情后重读列表复核。
   - NodeSeek @我/回复 fixture 必须同时给出可复用的列表行 `id` 和变化的 `comment_id`，证明投递身份跟随 `comment_id`，而 `markViewed` 仍只使用原始行 ID。
   - `REG-NOTIFY-031` 另固定三站 adapter-owned 分类、category endpoint/type/query、Discourse PM topic 与 Chat 声明、NodeSeek Markdown 标志、妖火 hidden fields/最近 20 条气泡/精确成功文本，以及原消息正文与聊天历史隔离。
   - `REG-NOTIFY-043` 固定同一条 Discourse 私信从“所有通知”和“个人信息”进入时生成相同 `private-conversation` target；必须继续加载完整会话与 Markdown reply，不能按普通 `topic-post` 读取单帖。
   - `REG-NOTIFY-053` 固定 Discourse 只有 `topic_id`/URL 的主题提醒及 NodeSeek 没有 comment ID/floor 的主题行生成 `topic` target；详情不得发起精确帖子读取，“查看相关主题”必须只传 Topic 且 `targetReply` 缺失。显式 `post_id`/`post_number`/comment ID/floor 继续生成 `topic-post` 并保持精确定位。
   - `REG-NOTIFY-054` 固定 Discourse opening post 的 `topic-post { postId, postNumber: 1 }` 继续用于读取完整通知详情，但进入 Topic 时 `targetReply` 必须缺失；不得按系统消息 kind 或标题关闭其他真实回复定位。匹配开发包用已有已读“LINUX DO 社区抽奖规则”只读验收正文和“查看相关主题”，不得出现楼层定位提示。
   - `REG-NOTIFY-032` 固定私信消息靠底、元信息置于气泡外、整行 composer 入口，以及 L/NS Topic/私信共享 `StructuredReplyComposer` 的 NodeSeek 贴纸/NodeImage、linux.do Emoji 与 `/uploads.json`、妖火独立纯文本边界；上传测试必须证明 writable gate/NodeImage Key 早于 picker、重复或取消零上传、成功只插入草稿且文件名/API Key 不进入 diagnostics。
   - `REG-NOTIFY-033` 固定 NodeSeek 通知携带精确 comment ID、远端 floor 位于后续页且主题没有总回复数的组合；详情必须先读 floor 提示页并仍以 comment ID 精确匹配，页界来自 `postPageCount` / pager。
   - `REG-NOTIFY-034` 固定私信回复 dock 与普通通知主题操作 dock 都追加 bottom safe-area inset；共享 Composer 已自行消费安全区，不得重复垫高。
   - `REG-NOTIFY-035` 固定 tabs 短标签在至少 48dp 点击区与选中线内水平居中；保留内容宽度与横向滚动，不以强制等宽破坏大字号或长标签。
   - `REG-NOTIFY-036/038/041/050/055` 固定消息、共享 Tab/按钮与两类 Composer 消费 Reader 字号、L/NS 常用与站点工具无“加号”聚合且在单行内横向可达、Yaohuo UBB 工具栏横滑、主题光标、Discourse Emoji 网格及 Bottom Sheet 的 top-safe 75% 高度与 bottom inset；设备必须在 100%/130%、键盘开关和表格 BubbleMenu 展开三种状态复核，不得只看默认字号静态截图。
   - `REG-NOTIFY-037/042` 的妖火 fixture 同时包含原消息重复项、倒序历史、日期作者、位于正文内或气泡外包装的斜杠“回复时间”、图片和导航链接；测试必须模拟 Android 严格日期解析，真实只读验收必须确认协议标签消失，但作者、图片、时间和导航链接仍保留。
   - `REG-PERF-017` 固定妖火详情完整页只解析一次、正文与每条最终聊天 fragment 各 sanitize parse 一次；可见性和原消息去重必须复用 sanitized root，临时 `contentKey` 返回前删除，system 消息继续不暴露聊天或回复入口。
   - `REG-NOTIFY-044` 固定妖火主题链接（`/bbs-*.html` 或 `book_view.aspx`）与 `book_re.aspx` 都保留 href；Notifications RNTL 必须证明点击后经过共享 `parseForumTopicLink` 进入 App 内 Topic，而不是调用 `Linking.openURL`。
   - `REG-NOTIFY-045` 使用原站真实 `book_re.aspx?...&tofloor=90&...` 形态固定精确楼层；`src/domain/forum/links.test.ts` 拒绝无效/站外参数，Notifications Screen/Route RNTL 必须把 `{ floor: 90 }` 传入现有 Topic target，而普通主题链接不得伪造目标。
   - `REG-NOTIFY-047/048` 固定 NodeSeek 完整主题链路原样传递 `ReplyLocationTarget`，缺失/错误 floor 时仍以 comment ID 在响应页拓扑的已知页界内精确命中且不依赖 `replyCount`；只含 `message_id` 的兼容行也必须把同一 ID 写入 target，不能只用于通知去重。
   - `REG-NOTIFY-049` 固定同身份检查中继续使用可信会话；真正 unknown 或 auth surface barrier 只暂停私信访问并保留内存草稿，确认退出或换号才清空；不得为测试持久化草稿。
   - `REG-NOTIFY-051` 固定妖火条目分别保存来源分类和页码，详情后的已读复核必须回到原分类、原页；真实逐条已读仍需单独写授权。
   - `REG-NOTIFY-039/040` 分别固定列表/气泡统一 `YYYY-MM-DD HH:mm` 与富文本链接使用 Reader theme primary；未知时间继续显式未知，不能为视觉统一猜值。
2. Store/worker/system 固定首次 baseline 静默、首发三站 opt-in allowlist、每站摘要、200-ID 上限、重复运行不重复、全局/单站开关重启恢复、换号/退出清理、代理失败零请求、墙钟 deadline 和单站失败不阻断其他站；至少用两页 fixture 证明 worker 沿 opaque cursor 请求 `[undefined, next]` 并只记录最新 60 条，同时固定重复 cursor/无下一页停止。摘要使用账号级 A/B 两槽在非当前槽 stage，只有 native `notify(tag, 0, notification)` 返回后的 ack 才算 present 完成，Expo schedule Promise 不得充当 ack。测试必须证明 ack pending 时 Store 的 delivered IDs 与 identifier 均不变，ack 后恰好一次 compound write 同时提交两者；present reject、ack 后 commit reject 或 ack 后强杀都让同一远端 ID 可在下轮重试，旧槽 exact dismiss reject 的 compound rollback 必须精确恢复提交前完整水位（包括 200-ID 截断反向用例）和 previous identifier。deadline-during-commit oracle 必须在固定墙钟内返回，并证明 deadline 当下 rollback=0/dismiss=0：late `committed=true` 保留 Store current 与 staged，late false/reject 才 exact-dismiss；commit 已成功后的 post-commit deadline 同样不 rollback、不撤 staged，旧槽留给下轮 reconcile。worker 返回 deadline 后立即启动同身份第二轮时，第一轮的 single-flight lane 仍须持有：pending commit settle 前第二轮 reconcile/probe 均为 0；late true 后第二轮才以 staged current 进入，late false/reject 则必须先等 staged exact dismiss 完成再放行。还必须覆盖 deadline 后 late present、transactional exact dismiss 不误删 legacy source-only、同身份并发 ABA single-flight，以及启动/下轮按 Store current 清 crash orphan。native present/exact dismiss 必须共用单线程 Executor；native lifecycle oracle 要阻塞 present、排入 dismiss、调用 invalidate/shutdown、再释放 present，并证明 `notify → cancel` FIFO、两个 Promise 均结算，shutdown 后的新任务明确 reject。broad best-effort cleanup 只用于关闭/换号/停用；权限或目标 channel 已关闭时 native present 必须 reject。registration 测试必须阻塞 register/unregister 并交错提交相反意图，最终状态只服从最后一次调用；空 eligible-source 集合不得注册后台任务，foreground handler 必须展示 banner/list 且不设置 badge。
3. 隐私断言必须证明标题、正文、预览、会话、Cookie 和 token 不进入持久化、诊断或系统通知 payload；参与者只允许进入当次 Android 摘要正文，不进入持久化或诊断。摘要除此之外只含来源、动作和新增数量。
4. Gateway/RNTL/导航测试固定 More 入口和 `none/update/messages/both` 无障碍文案、总览/单站/未读筛选、合法 outcome marker、分页/刷新/局部错误、详情、已读失败提示、首次 opt-in、权限拒绝/撤销意图及三站开关；聚合局部错误必须为每个失败来源显示独立重试，并证明点击只调用目标来源 `listPage`、携带发起时 expected identity 与 cancel signal、只 patch 对应失败页；失败页不是末页时恢复 cursor 必须传播到末页，其他来源数据和 `listAllPage` 不变。还必须覆盖消息 native route 的 Android 硬件返回、真正 unknown 或 auth surface barrier 保留 cache 但不参与读取也不渲染旧私有 row、确认退出清 aggregate Query、前台 snapshot 调用共用投递 worker、snapshot 存储失败不阻断成功来源、消息中心可见时仍调用 Android system sink、隐藏但 mounted 的列表停止读取、快速连续身份变化只允许最新 effect 落盘、详情 route 绑定条目身份，以及 adapter I/O 前的 expected identity/abort；主题级 target 打开 Topic 时不得携带 `targetReply`，精确帖子 target 必须保留完整定位字段；条目 label 包含动作，短来源 Tab 双轴至少 48dp。
   - `REG-NOTIFY-052` 固定未读消息同时点亮底栏 More 和 More 内“消息通知”入口；入口使用结构化未读布尔值显示主题 danger 红点，清零立即消失，只有版本更新时不得误亮消息入口。
   - `REG-NOTIFY-058` 固定每个 `source + identityKey` 独立 snapshot Query：A 扩为 A+B 时 A 总读取一次、B 一次；同一 `dataUpdatedAt` 只持久化和触发对应 foreground delivery 一次。本地账号终态恢复且首页首次内容 settled 前零远端 snapshot；显式刷新、App 恢复和定时刷新仍对当前每来源各增加一次。
   - 分类/私信 RNTL 必须覆盖聚合页无分类、单站分类切换与切站重置、category Query key、子分类无批量已读、靠底左右气泡/作者/时间/最新定位、Markdown/纯文本 composer、图片/表情站点边界、空白/发送中防重复、未确认保留草稿、确认后清空及失效详情/单站/聚合/snapshot；Gateway 还固定图片上传的 exact identity/abort 和敏感正文/文件/凭据不进入 diagnostics。
5. 运行相关 Vitest/Jest、`npm run typecheck` 和 `npm run verify`；`app.json`、TaskManager 或原生依赖变化还要 fresh Expo prebuild，检查生成 manifest/permission/icon/plugin，运行生成的 Kotlin 单测和 `:app:compileReleaseKotlin`。正式 release 脚本仍受 Node 22、clean tree、签名和设备前置门禁约束。

### 设备与 Live 边界

1. `tests/device/notifications-readonly.ad` 从 More 进入消息中心，依次检查总览与三站 `data/empty/partial/error/auth` 合法结算，切换“只看未读”开/关，打开设置确认三站都存在，再用系统返回依次回到消息列表和 More。Replay 不要求当天有数据，不点击消息行、不下拉刷新、不改变字号或启用 TalkBack；详情、刷新、默认/大字号布局和 TalkBack 动作朗读由匹配 APK 手动/只读 Live 补验，未执行记 `NOT_VERIFIED`。全程不执行真实已读、全部已读或主设备 Android 通知设置变更。
2. Android 13+ 权限 grant/deny/revoke、前台普通页/消息中心与后台的每站摘要替换、锁屏 `PRIVATE`、warm/cold 点击只进来源列表及约 15 分钟 WorkManager 调度，在一次性 AVD 上验证；不得清除或卸载主登录模拟器 App。前台/后台真实新消息需要外部账号产生一条 baseline 之后的 @我、回复或私信；缺少该前置时分别记 `LIVE_PASS NOT_VERIFIED`，不能用恢复旧未读冒充。
3. 原站当天有无消息不作为 Replay 前置。逐条和批量已读属于真实写入，只有用户对具体来源另行明确授权后才执行 `LIVE_PASS`；否则统一记 `NOT_VERIFIED`，不得用 Fixture 通过冒充线上写入通过。
4. 匹配 APK 的只读 Live 可切换三站原生分类并打开已有已读私信会话，检查会话气泡与 composer，但不得点击图片或发送。真实上传必须另获“站点、测试文件”授权；每个站点的真实回复必须另外取得“站点、收件人、测试内容”三项明确授权。未授权统一记 `NOT_VERIFIED`，未确认响应不可自动重试。

## 搜索验收

搜索是最容易出现“看起来能搜，实际坏了”的功能。改搜索、来源解析、筛选、列表分组、请求归属，或改动会影响搜索路径的 Cookie、隐藏 WebView 时，必须执行下面两层。

### 自动测试

```powershell
npm test -- src/sources/feedRead.test.ts src/sources/searchRead.test.ts src/sources/sourceTopicRead.test.ts src/sources/sourceUserRead.test.ts src/sources/sourceAccountRead.test.ts tests/integration/source-read-contracts/ src/domain/forum/searchFilters.test.ts src/features/search/listItems.test.ts src/sources/readGateway.test.ts src/sources/readGatewayContract.test.ts src/sources/yaohuo/reader.test.ts tests/integration/query-session-contracts.test.ts src/features/search/searchRun.test.ts
npm run test:ui -- tests/ui/search/search-screen.test.tsx tests/ui/search/search-controller-ai.test.tsx tests/ui/account/account-status-controller.test.tsx
npm run typecheck
```

通过标准：

- 固定样本的搜索结果数量、顺序、分页和字段断言通过。
- NodeSeek、linux.do、V2EX、妖火的搜索请求没有回到本地项目服务。
- 单站失败不会让全部搜索整体失败。
- “全部”预览与单站分页缓存使用不同 lane；聚合结算后进入同条件单站不得复用错误数据形状、退出 App 或跳过首屏请求，见 `REG-SEARCH-027`。
- 筛选参数和分页参数进入真实站点请求。
- linux.do 已保存终态在冷启动直接恢复；只有首次升级且存在 Cookie 候选时做一次精确迁移核对。没有终态时账号与搜索保持非登录、AI 关闭，匿名/已确认登录搜索的 Query key 和 transport 不串用，见 `REG-LINUXDO-005`。

### Agent Live / 受监督模拟器验收

在不清 App 数据的前提下执行。推荐关键词：

若设备自然存在 linux.do 残留 `_t` 且远端身份检查为未知，必须保留该现场冷启动验收：账号中心不显示已登录，搜索不开放 AI 或登录专属路径，Topic 不显示依赖登录的写入口；不得清 Cookie 制造或消除该状态。若身份被远端重新确认，则三个入口应同时恢复登录能力。

| 关键词 | 目的 |
| --- | --- |
| `codex` | 英文技术词，检查四站普通搜索、“全部”来源预览和 NodeSeek 登录 / 未登录搜索路径；模拟器当前登录态下的 NodeSeek 数量只能作为站内搜索基准 |
| `AI` | 高频词，检查分页、去重和 V2EX / linux.do 结果 |
| `安卓手机免` | 中文长词，检查妖火官方搜索不被本地错误过滤 |

每个关键词记录：

| 项 | 记录内容 |
| --- | --- |
| 环境 | 日期、版本号、是否登录 NodeSeek / linux.do / 妖火 |
| 条件 | 搜索来源、筛选、关键词 |
| 数量 | NodeSeek、linux.do、V2EX、妖火各自可见数量；有错误时记录错误文案 |
| 首条 | 每站首条标题、来源、作者、时间、链接是否能打开 |
| 结果 | 新代码相对同条件基线是否少结果、空结果、字段缺失或打不开 |

失败标准：

- 原本有结果的站点变成空结果，且不是网站验证、登录失效或网络错误。
- 同条件下结果数量明显下降，且首条结果或分页状态异常。
- 标题、来源、链接、作者、时间任一关键字段缺失。
- 搜索结果能显示但打不开详情。
- NodeSeek 搜索只剩少量静态首屏结果，或验证通过后没有重试。
- 未登录 L/NS 没有展示外部入口、提交后不是 exact `site:` Google 页面、误调用 gateway/解析 Google HTML，或 Custom Tab 菜单把非主题/非受信 URL 导入 App。

固定操作：

1. 点底部 `搜索`，确保回到搜索页顶部。
2. 手动输入关键词后点击 App 内提交按钮；清空输入后点击最近搜索词必须立即发起同一关键词请求，不得要求再次提交。
3. 在 `全部` 按用户顺序检查当前已启用来源：原生来源显示预览，public L/NS 各显示一个外部入口且不自动打开；再分别检查 authenticated 来源的连续单站列表。若本轮验收覆盖内容源启停，先记录原设置并在结束时恢复。
4. 对原生来源记录结果数、首条标题、错误文案和分页；对 public L/NS 记录 exact Google URL、入口 settled 状态和是否未出现伪空结果。“全部”的外部入口不提供分页或“查看全部”。
5. tracked Replay 只提交一次聚合搜索，等待 `search-all-sources-settled`，并断言 `search-external-linuxdo` 与 `search-external-nodeseek`；不得打开动态 Google 页面、首条结果或向布局插入自动化空节点。Agent Live 才逐来源打开有前置条件的真实结果或外部入口，再返回 Search 确认关键词、来源和适用筛选仍保留。
6. authenticated 原生来源打开筛选并确认既有条件；public L/NS 必须没有筛选入口，不得把站内条件带到 Google。
7. public L/NS 单站提交后核对 Custom Tab；打开一个受支持主题，再从浏览器菜单选择“在阅坛中打开当前主题”。菜单若不能在冷、热启动任一场景回到正确原生主题，停止发布且不恢复 Google HTML parser。

NodeSeek 单源搜索有两种通过状态：

- 已登录：站内搜索结果正常显示，结果可打开详情；模拟器基准要标注为“已登录”。
- 未登录 / 仅验证：单站提交打开限定 `nodeseek.com` 的 Google 页面，返回后保留关键词和再次打开入口；App 不读取或解析 Google 结果。用户在 Custom Tab 打开受支持主题后可通过固定菜单回到原生详情；不能为了制造该状态清除 App 数据。

当前可对照的模拟器结果见 `docs/emulator-baseline.md`。

## 用户主页验收

改 NodeSeek、linux.do、V2EX、妖火的用户资料、主题、回复、分页、用户页 tab 或用户页列表渲染时，必须执行。

### 自动测试

```powershell
npm test -- src/sources/sourceUserRead.test.ts src/sources/yaohuo/parser.test.ts src/sources/yaohuo/reader.test.ts src/features/user/userScreenItems.test.ts
npm run test:ui -- tests/ui/shared/topic-card.test.tsx
npm run typecheck
```

通过标准：

- 四站主题和回复的来源、标题、链接、作者、头像、分类、时间、楼层、摘要、分页游标按原站支持范围显示；原站没有的字段不得伪造。
- 妖火主题和回复时间必须保留原站文本，不得把历史日期统一显示成“几分钟前”。
- 用户名和用户 ID 不混用；妖火只拿到数字 ID 时，要用原站可确认的昵称修正展示。
- 用户资料不放进虚拟列表；列表 key 不重复；主题和回复 tab 切换后不串数据。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. 从 App 内登录态入口打开 NodeSeek、linux.do、妖火当前账号主页；V2EX 用 App 内真实主题作者进入用户主页。
2. 四站分别检查 `主题` 和 `回复` tab；记录首屏可见字段，至少包含来源、分类、标题、作者、时间、回复数或楼层、摘要。
3. 有 `加载更多主题` 或 `加载更多回复` 时点一次，确认不会重复首屏、不会串到另一个 tab。
4. 打开一条用户主题或回复对应的原帖，再返回用户主页，确认 tab、列表和用户资料仍正确。
5. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 投票验收

修改投票标记解析、投票卡片数据、公共投票 UI、action builder/client/controller、写后状态或 Topic Query cache 时必须执行。先沿真实依赖关系列出三个可写来源消费者；只有语义、数据约束、生命周期和错误处理一致时才允许共享。即使代码只改一个分支，也要证明 NodeSeek、LinuxDo、妖火的提交行为和 V2EX 只读行为没有回归。

### 自动测试

```powershell
npm test -- tests/integration/source-read-contracts/ src/sources/nodeseek/actionRequest.test.ts src/sources/nodeseek/actionClient.test.ts src/domain/forum/topicActionState.test.ts tests/integration/hidden-browser-scripts.test.ts src/sources/yaohuo/reader.test.ts
npm run test:ui -- tests/ui/topic/topic-actions-controller.test.tsx tests/ui/topic/topic-components.test.tsx tests/ui/topic/topic-reply-filters.test.tsx
npm run typecheck
```

通过标准：

- NodeSeek `/api/vote/info/{id}` 缺少动态签名的 403 必须能被测试复现；fallback header 只进入投票读取和提交，不能扩散到其他 NodeSeek JSON 或写操作。隐藏 WebView 不等待投票 DOM。
- 未投、已投、多选、锁定和多个标记部分失败分别有 oracle。未投时不提前展示结果票数；成功标记替换为正文内投票占位，渲染表单与相邻 `">` 原始标记并存时也只能保留一张卡，且严格位于标记前后正文之间；整篇 NodeSeek 正文保持一个 HTML 渲染树，不因投票新增正文分隔线，投票后的文本、图片和 sticker 不重叠；失败标记保留且详情诊断为 `partial`。
- `REG-TOPIC-128` 必须同时覆盖 NodeSeek opening、首屏评论、分页评论和定位评论：纯文本及“完整 marker 作为可见文字”的原站 anchor 都能归一，anchor 的跳转 href 不得成为 marker 身份来源；`pre/code`、普通链接和非法 marker 不转换。每个 poll 只归属于引用它的正文 owner，同一窗口相同 ID 只读取一次；独立 Stardust 段与相邻投票均须保留原始顺序且不重复渲染，投票空壳清理不得把 typed placeholder 当成空段。Composer corpus 还须固定 `~~...~~` 渲染为 `<s>`、不支持的 `++...++` 保持惰性文本、只读任务列表和 GFM 三种对齐，sanitizer 只允许 `text-align: left|center|right`。
- NodeSeek 取消确认时保留当前选择且零请求；确认后只有一次 POST，随后只有一次结果 GET。服务端快照替换精确 Topic Query cache 中的投票数据，不刷新整篇正文。
- 结果 GET 失败仍显示已投和所选项，未知票数保持未知，诊断为 `partial` 并提示刷新失败；不得重发 POST 或把未知票数写成 `1`。
- LinuxDo 保留 `REG-WRITE-001` 的已知计数/参与人数单次增量，妖火仍可提交投票，V2EX 仍只显示原站可读票数；公共 `TopicPolls` 的样式和交互未因 NodeSeek 专项协议改变。

### 模拟器与 Agent Live 验收

1. 记录当前 revision、dirty 状态、App version/versionCode、安装 APK SHA、设备和 Metro 身份；安装包或 bundle 不匹配时不能沿用旧基线。
2. 用户给出主题 URL 时，解析来源与 id 后直达 App 内详情页。该 URL 是目标，不得先走搜索；只有没有目标，或需要额外寻找一个未投只读样本时，才可搜索准确关键词“投票”。
3. 对已投 NodeSeek 目标只读核对：准确所选项、动态票数、禁用/已投状态、投票卡片位于原始正文标记位置且正文底部没有重复卡片，并确认原始 `nsapp://vote` 标记和相邻泄漏前缀消失；对投票前后含正文/媒体的目标，再与“原站打开”对照，确认没有额外正文分隔线，后文、图片和 sticker 不重叠。动态票数只记录当次结果，不写成固定基线；不得再次投票。
4. 对未投 NodeSeek 目标，先记录准确选项和未投状态，只打开“提交后不可修改”确认框并取消，确认本地选择仍在且没有远端写入。没有合格目标记 `NOT_VERIFIED`，不能拿搜索结果页或普通主题冒充。
5. 只读打开 LinuxDo、妖火各一个真实投票和 V2EX 一个可见票数主题，分别核对卡片/选项/状态；某站没有合格动态目标时只记该站 `NOT_VERIFIED`，不能用另一站通过代替。
6. 真正投票属于不可逆写入：必须先报告主题、准确选项和残留风险，再取得针对该对象和本次提交的逐次授权。确认后只提交一次；结果不明时停止且不得重试。刷新/重进 App 后，再从 App 内原站同类页面核对所选项和结果，桌面浏览器或第三方客户端不能替代。
7. fallback 未来返回 403、原站字段改变或真实结果与测试不一致时，先登记新 bug、影响面和证据缺口并汇报；不得自动引入加密依赖、改走投票 DOM、隐藏失败或猜测式修复。动态投票目标不进入 tracked Replay。

## 结构化回复、投票创建与 Stardust 验收

修改本地 Editor runtime、Markdown codec、Bridge、Composer Sheet、NodeSeek 投票创建 journal、Stardust marker/card/payment controller，或切换 Topic/私信回复入口时必须执行。新主题、分类、标签和 rank 不属于本验收；不得用旧 TextInput 或 HTML 发布格式作为降级通过条件。

### 自动测试

```powershell
npm test -- --run src/domain/forum/structuredComposer.test.ts src/domain/forum/linuxDoPoll.test.ts src/ui/composer/editorRuntime.test.ts src/ui/composer/structuredComposerBridge.test.ts src/sources/linuxdo/templates.test.ts src/sources/nodeseek/stardust.test.ts
npm run test:ui -- tests/ui/topic/structured-reply-composer.test.tsx tests/ui/topic/topic-actions-controller.test.tsx tests/ui/topic/topic-components.test.tsx tests/ui/notifications/notifications-screen.test.tsx tests/ui/notifications/notifications-route.test.tsx
npm run typecheck
```

通过标准：

- GFM table 的对齐、空单元格和转义 pipe 经 `parse → serialize → parse` 保持语义；HTML/Excel 表格可进入真 table，任何 `rowspan/colspan` 使整次粘贴保持文档不变。普通 HTML 只保留允许结构，脚本、事件属性、iframe 和危险 URL 不进入文档。
- NodeSeek 工具栏显示删除线但不显示下划线，linux.do 仍显示两者；NodeSeek fallback 必须将 `~~...~~` 渲染为 `<s>`，且不得将 `++...++` 渲染为下划线。粗体、斜体、标题、引用、链接、图片、普通/有序/任务列表、行内/块代码、分隔线和表格继续作为 GFM 能力保留。
- linux.do poll 未知属性、全部私有块、NodeSeek remote poll、pending poll token 和 Stardust 未修改 marker 精确保存；源码解析失败保留原文并停留源码。Bridge 拒绝未知字段、旧 revision 和超限内容，正文、凭据和金额不进入 diagnostics。
- 连续插入 NS poll、Stardust、L poll、Details 与 Spoiler 时节点互不替换，最后存在可继续输入的文本选区；选中同类型节点才允许原位更新。富文本同步到源码后第一次 undo 不改变正文，用户随后真实输入的 undo 只撤销该次输入。
- LinuxDo poll 的 group 能力只通过现有 host action 读取：同一 Runtime 成功时请求一次，失败可显式重试；搜索、多选、Chip 删除、不可见已选组保留、Staff 条件和 ranked/number 不显示 chart 均有行为 oracle。Topic 与 Markdown 私信都在网络请求前后复核同一个 writable ticket。
- LinuxDo Emoji fixture 至少 250 项：滚动与“加载更多”可到达 121–250 项，搜索能直接命中未呈现批次；目录晚到只刷新 NodeView，不产生 ProseMirror doc transaction，关闭/重开面板复用已加载图片 DOM。
- Sheet/全屏、富文本/源码和楼层 intent 不重挂 WebView；关闭、route inactive、后台、模式切换和提交前请求最新 snapshot。旧 snapshot 不发送；renderer gone 不回退旧输入框。
- 表达式 Builder 成功插入后，富文本/源码均立即恢复原编辑器 focus；Tiptap 动态基础样式携带本地 CSP nonce，终端贴纸后的 caret、选择手柄和真实文字插入位置一致。取消 Builder 不得主动弹出键盘。
- NodeSeek 插入 pending poll 为零请求；提交时每个 fingerprint 只物化一次并先落 journal，再发送正文。回复失败手动重试复用 remote ID；明确 create 失败可手动重试，响应不明禁止重试。
- 合法 Stardust marker 只在原正文位置产生一张卡，代码块和非法 marker 保持惰性文本。取消付款只允许 prepare、零 send；确认后 send 恰好一次并只信权威刷新，响应不明不自动重发。
- `WRITE-01..04` 原 writable-session、credential generation、编辑权限、上传、防重复、写后精确窗口刷新和现有投票读取/表决回归继续通过；妖火仍用 UBB/纯文本，V2EX 仍只读。

### 设备与 Agent Live 验收

1. 使用与当前 revision/App version/APK identity 匹配的主 AVD，安装前后只读比较 `firstInstallTime`；仅覆盖安装，不卸载、不清数据、Cookie 或登录态。
2. 在 100%/130%、浅/深色和 Gboard 中文输入下检查组合输入、退格、光标、选区、原子节点、主工具栏横滑、整表锚定 BubbleMenu、行列 Dropdown、链接 Popover、表格横滑、键盘 Back、Sheet/全屏以及连续十次开关；WebView、`.ProseMirror` 与主 toolbar 实例不得因菜单或 presentation 变化。
3. 原站事实只能从 App“更多 → 账号中心 → 检测或重新登录”进入登录态原站 WebView 核对；不得用桌面浏览器或直接 URL 代替。
4. 获授权写入时，linux.do 只在“深海”、NodeSeek 只在“沙盒”回复合适的既有测试主题；各发送一条表格、投票和本站私有节点回复并编辑、刷新详情。NodeSeek poll 只创建一次，记录残留 ID，禁止使用研究 poll `3022` 或结果不明后重试。
5. NodeSeek Stardust 收款 marker/卡片和状态读取可随获授权测试回复验证；实际 `payment-prepare/send` 默认 `NOT_VERIFIED`。只有用户另行指定收款对象和金额后才可单次执行，取消、结果不明或 credential 变化都不得调用或重发 send。
6. 不实际投票、不计划外上传、不自动重试任何非幂等请求。无法取得稳定对象或协议事实不一致时按能力 ID 记 `NOT_VERIFIED`/bug，不用模拟测试冒充 `LIVE_PASS`。

性能记录必须覆盖 cold/hot READY、Sheet/全屏布局、20,000 中文字符输入、50,000 字符序列化、bundle gzip 大小和十次开关后的 PSS；门槛分别为 1.5s/500ms、150ms、p95 32ms、300ms、1.5MiB 和增量 10MiB。无法可靠采样的轴单独记 `NOT_VERIFIED`，不能以 App 可启动代替。

## 回复图片上传验收

改回复、楼层回复、格式工具栏、图片上传、NodeImage 授权或写操作锁时，必须执行。

### 自动测试

```powershell
npm test -- src/features/topic/shareTopic.test.ts src/features/topic/actions/actionHelpers.test.ts src/features/topic/useTopicSessionController.test.ts tests/integration/image-upload.test.ts src/sources/discourse/imageUpload.test.ts src/platform/network/loginWebViewScripts.test.ts src/sources/nodeimage/authFlow.test.ts src/platform/network/loginWebViewScripts.nodeimage.test.ts src/sources/nodeimage/credentials.test.ts src/platform/diagnostics/diagnostics.test.ts src/sources/nodeseek/actionRequest.test.ts src/platform/network/managedCookies.test.ts src/sources/nodeseek/session.test.ts tests/integration/hidden-browser-scripts.test.ts src/ui/composer/editorRuntime.test.ts
npx jest --config jest.config.cjs --runInBand tests/ui/account/account-host.test.tsx tests/ui/topic/topic-actions-controller.test.tsx
npm run typecheck
```

通过标准：

- 发送失败或上传失败后，同一个回复框还能继续点击和编辑。
- NodeSeek 图片上传使用用户自己的 NodeImage Key；无 Key、Key 归属不符或 401/403 时只提示到账号中心“获取 / 恢复授权”或手动粘贴，授权入口调用为零，文件选择/上传都不重放，草稿保持不变。
- 用户主动“获取 / 恢复授权”时先探测现有 NodeImage session：有效 session 自动保存并关闭且 Connect 为零；只有精确 `401 + JSON error` 才恰好 Connect 一次。HTML 403、网络、5xx、无效 JSON、200 缺 Key、WebView 重载、重复/迟到消息都不得进入额外 Connect 或多次结算。
- NodeSeek 回复 / 编辑必须使用真实 post/comment id；当前请求未传 token 时由 `src/sources/nodeseek/actionRequest.ts` 生成 16 位 `csrf-token`，自动测试必须固定该请求契约。
- NodeSeek 自己的回复只有同时有评论 id 和原始正文时才显示编辑；只隐藏自己的点赞 / 鸡腿 / 反对，不展示点了会失败的编辑入口。
- 取消编辑或系统返回关闭编辑框后，编辑正文不能残留成普通回复草稿。
- NodeSeek 详情必须保留原站渲染后的 at、楼层链接、表情 / sticker 和签名显示，不得因为编辑源数据回退成纯文本。
- NodeSeek 楼层回复的草稿请求包含 `@用户` 和楼层链接；测试只构造请求，不发送真实回复。
- linux.do 上传走 `/uploads.json` 且保留 FormData；妖火上传走图床后插入 `[img]...[/img]`。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. `更多 -> 账号中心` 确认 NodeSeek、linux.do、妖火是可写登录态；NodeImage 显示已保存或可“获取 / 恢复授权”。
2. 在保留现有 NodeImage session 的前提下主动点击“获取 / 恢复授权”；弹层应先打开 NodeImage，自动保存并关闭，脱敏诊断只出现 `session-check → session-reused → key-saved`，不得出现 `connect-started`。不得点击网页、清 Cookie 或使用 Connect 配额制造失效。
3. force-stop 后重新打开 App，再进 NodeSeek 回复框点图片，已有且属于当前账号的 Key 应直接打开文件选择器，不弹授权；取消选择后草稿不变。
4. 默认只打开三个可写来源的文件选择器并取消，确认回复框和草稿状态没有损坏；上传请求、响应解析和草稿插入由自动测试覆盖。
5. 只有用户明确同意真实图片上传时，才各选一张小图并确认草稿中分别出现对应 Markdown、`upload://` 或 UBB 图片；等待 UI 稳定后用 accessibility 状态确认“发送回复”和格式按钮不再是 `disabled`，按钮颜色不作为可用性证据，也不点击真实发送。若上传文件无法清理，必须在操作前说明残留风险并单独取得同意。
6. 发送失败状态默认由自动测试覆盖；模拟器只在自然遇到失败或能安全拦截请求、不产生真实写入时复测，不得为了制造失败发送真实回复。失败后回复框必须仍可点击和编辑，不允许靠收起再展开恢复。
7. 结束前清空草稿或收起回复框，检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 回复删除验收

改回复、楼层回复、写操作、权限解析或删除按钮时，必须执行。默认不在真实站点新发回复或删除回复；删除成功后的列表变化由自动测试固定。用户明确同意真实写操作验收时，只删除本次测试新发的临时回复，不删除已有历史内容。

### 自动测试

```powershell
npm test -- src/sources/discourse/actionRequest.test.ts src/sources/discourse/model.test.ts src/sources/nodeseek/actionRequest.test.ts src/sources/yaohuo/actionRequest.test.ts tests/integration/source-read-contracts/ src/sources/yaohuo/parser.test.ts
npm run typecheck
```

通过标准：

- linux.do 只读取 Discourse `can_delete`，删除请求为 `DELETE /posts/{id}.json`。
- 妖火只读取原站回复里的 `Book_re_del.aspx` 删除链接，普通回复没有删除入口。
- NodeSeek 只读取原站数据中的可删字段或删除入口，不靠作者名推断。
- 删除请求缺少评论 id、删除链接或必要参数时必须拒绝。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. 确认 NodeSeek、linux.do、妖火均为各自协议下的可写登录态；删除入口仍以逐条权限为准。如 NodeSeek 触发 Cloudflare，先在 App 内完成验证，无法自动完成时停止并交给用户。
2. 默认只检查已有页面上的删除入口是否只出现在原站允许的回复上；不得为了验收主动发布临时回复，也不得点击已有历史内容的删除入口。
3. 确认框和取消行为默认由自动测试覆盖；只有用户明确授权并使用本次新建的临时回复时，才在模拟器点击删除入口。
4. 删除请求、删除后列表立即消失、刷新后不残留，默认通过自动测试覆盖。
5. 只有用户明确同意真实写操作验收时，才新发中文且贴合主题的临时回复，再确认删除后刷新检查。
6. 回复框在失败、取消和删除后仍可点击、可编辑，不需要收起再展开。
7. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 模拟器验收清单

| 区域 | 必查 | 不默认点击 |
| --- | --- | --- |
| 首页 | 所有已启用来源按用户顺序显示，分类、阅读筛选、单站排序及当前请求形成合法 outcome；账号核对期间公开来源不得暂停；仅在存在数据前置时打开详情并返回 | 无 |
| 详情 | 来源、标题、作者、时间、正文、回复数、附件、图片预览、返回；含图长帖按 `REG-TOPIC-048` 检查适屏先显、附近渐进清晰、远段不抢加载、全屏返回外层保持适屏像素且不跳位，并可从磁盘缓存恢复原图升级层、原图失败保留适屏图；超长 opening body 按 `REG-PERF-008` 检查 chunk 随列表 viewport 挂载，不在 header 一次性渲染；正文引用与评论引用分别检查简介常显、展开完整帖、收起恢复简介，跨主题评论引用检查目标链接和错误同楼层隔离；进入目标后分别在 Loading 与完成态返回，确认一次恢复原详情、转场无 B 内容/白灰空页且两类引用互不串样式和状态 | 保存图片、回复、点赞、收藏切换 |
| 搜索 | 首次进入无账号暂停提示；提交关键词后已启用来源按用户顺序渐进形成合法 outcome，公开来源不等账号，妖火保持严格；检查筛选、清空和错误/空态；仅在存在数据前置时打开详情并返回 | 外部网页、写操作 |
| 收藏 | ready/empty、来源筛选、分类筛选；有前置数据时检查已收藏 / 已读状态 | 取消收藏 |
| 历史 | ready/empty；有前置数据时检查最近阅读和已读状态 | 删除、清空历史 |
| 关注用户 | ready/empty；有前置数据时检查用户页、用户主题列表和返回 | 取消关注 |
| 账号中心 | 已启用可登录来源按用户顺序、单站详情、真实状态、身份、主操作、顶部唯一公共 `刷新账号状态` 和全部原服务入口；刷新 activity 独立显示，检查失败保留上次确认身份，confirmed 才计登录、真正 unknown 计“待核对”；三站显示凭据摘要并从 App 内打开登录 / 验证页；测试凭据填入但不提交并在结束前删除 | 清除网站登录、撤销授权、退出登录、手工改 Cookie、提交测试登录、真实签到 |
| 消息通知 | More 入口、总览/三站来源、各站原生分类、只看未读、当前请求合法 outcome、空态/局部错误、已有已读会话气泡与 composer、设置文案与默认关闭；一次性 AVD 另验权限、摘要隐私和 warm/cold 跳转 | 打开具体未读条目、点击发送私信回复、全部已读、启用主设备后台通知、真实逐条/批量已读 |
| 回复编辑 / 图片上传 | 三个可写来源回复框、失败后可继续编辑、格式按钮、文件选择器打开和取消；只用现有 NodeImage session 验证自动保存、关闭和零 Connect；失效兜底流程由自动测试固定，真实 Connect / 上传只按 Agent Live 逐次授权 | 真实 Connect、真实上传、真实发送回复、清除 NodeImage Key/Cookie |
| 回复删除 | 删除入口和权限显示；确认框取消及删除后消失默认由自动测试覆盖 | 点击已有内容的删除入口、真实新发回复、真实删除回复、删除旧回复、删除他人回复、清数据制造状态 |
| 未登录设备 | 只在独立 AVD 上使用同一 APK，三站结算为权威未登录状态（NodeSeek 可为“未登录”或仅访客“已验证”，linux.do 为“匿名可用”）；可完成访客 CF 验证但不登录论坛；主设备数据、Cookie 和登录态不变 | 克隆主 AVD 数据、登录论坛、清主设备数据或 Cookie |
| 更多页 | 内容源四站开关、48dp 手柄长按拖拽、TalkBack 上移/下移、普通滚动/开关不被手势抢占；另检查版本、更新、账号中心、等级、服务器代理、诊断、备份和外观入口；内容源改动须记录并恢复原设置，诊断分享面板打开后取消 | 动态等级复试、备份导出、导入、安装更新、切换外观、启用未知代理 |

## 改动类型对应验证

| 改动类型 | 必跑 |
| --- | --- |
| 来源解析、搜索、详情、用户页 | 对应来源测试、`src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`tests/integration/source-read-contracts/`、`npm run typecheck`、模拟器验收 |
| App controller、server state key、取消请求 | 对应 controller 测试、`tests/integration/query-session-contracts.test.ts`、`src/sources/readGatewayContract.test.ts`、`npm run typecheck`、模拟器验收 |
| 内容源、ReadPlan、启动配置 | `src/domain/reader/contentSourcePreferences.test.ts`、`src/domain/forum/readPlan.test.ts`、`src/platform/storage/readerDataStore.test.ts`、`src/sources/readGatewayContract.test.ts`、Feed/Search/Topic/User/More/route-gate UI tests、`tests/integration/query-session-contracts.test.ts`、`npm run typecheck`；模拟器记录/恢复内容源设置并保留 `firstInstallTime` |
| 登录、验证、Cookie、写操作 | `src/domain/session/authSurfaceCoordinator.test.ts`、`src/platform/network/managedCookies.test.ts`、`src/domain/session/writableSessionGate.test.ts`、相关 verifier / action / session 测试、`tests/tooling/release-packaging.test.ts`、`tests/integration/security-boundaries.test.ts`、`npm run typecheck`、模拟器验收 |
| 投票解析、卡片数据、提交或写后状态 | 完整执行“投票验收”；按四站展开影响面，NodeSeek 真实提交必须逐次授权且结果不明不得重试 |
| 账号中心、凭据保存 / 填入与当前会话证明 | `src/sources/feedRead.test.ts`、`src/sources/searchRead.test.ts`、`src/sources/sourceTopicRead.test.ts`、`src/sources/sourceUserRead.test.ts`、`src/sources/sourceAccountRead.test.ts`、`src/sources/nodeseek/session.test.ts`、`src/platform/network/managedCookies.test.ts`、`src/domain/session/authSurfaceCoordinator.test.ts`、`src/platform/network/loginWebViewScripts.test.ts`、`src/features/more/accountCenter.test.ts`、`src/platform/storage/credentialVault.test.ts`、`src/domain/session/loginFormAdapters.test.ts`、`src/domain/session/siteSessionState.test.ts`、`src/features/account/sessionQueryOwnership.test.ts`、`src/features/account/browserFetchQueue.test.ts`、`tests/tooling/release-packaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 回复编辑、楼层回复、图片上传、NodeImage Key | 回复图片上传验收、相关 action / WebView script 测试、`npm run typecheck`、模拟器验收 |
| 回复删除、删除权限、评论 id / 删除链接解析 | 回复删除验收、相关 action / 来源解析测试、`npm run typecheck`、模拟器验收 |
| 收藏、历史、备份 / 恢复 | reader data / backup 测试、`tests/integration/security-boundaries.test.ts`、`npm run typecheck` |
| 服务器代理 | `src/platform/network/networkProxy.test.ts`、`tests/ui/app/app-runtime-startup.test.tsx`、`tests/ui/more/network-proxy-controller.test.tsx`、`tests/ui/more/network-proxy-modal.test.tsx`、`tests/ui/account/hidden-browser-host.test.tsx`、`tests/ui/account/account-host.test.tsx`、`tests/ui/account/account-site-panels.test.tsx`、`tests/ui/topic/topic-image-loading.test.tsx`、`src/platform/media/mediaSessionEpoch.test.ts`、`tests/ui/shared/avatar.test.tsx`、`src/platform/update/useAppUpdateRuntime.test.ts`、`tests/tooling/release-packaging.test.ts`、fresh Expo prebuild、生成 Kotlin JUnit（含 `REG-PROXY-007/008` 的 stop/worker overlap 与阻塞写 deadline）、`:app:compileReleaseKotlin`、`npm run typecheck`；模拟器默认只做离线 UI 验收，不启用真实代理 |
| 消息中心、私信回复、Android 通知、后台任务 | 三站 notification adapter/gateway/store/worker 测试、notification UI/AppNavigator/More 与两类 Composer 测试、账号测试、代理 fail-closed 测试、`tests/tooling/release-packaging.test.ts`、fresh Expo prebuild、生成 Kotlin JUnit、`:app:compileReleaseKotlin`、`npm run typecheck`、`tests/device/notifications-readonly.ad`；真实已读与每站私信回复另行授权 |
| UI 样式、主题 | 只保留事故级 UI helper 测试、`tests/integration/style-ownership.test.ts`、`npm run typecheck`、模拟器验收 |
| App 内更新检查、安装入口 | `src/platform/update/appUpdate.test.ts`、`src/platform/update/useAppUpdateRuntime.test.ts`、`tests/tooling/release-packaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 签名、版本、原生构建配置、发布脚本、正式发布 | `npm run release:android` |

## 模拟器规则

- 设备状态安全边界以仓库根目录 `AGENTS.md` 为准；覆盖安装、Replay、Smoke 与发布命令只在 `docs/operator-runbook.md` 维护。
- 模拟器证据必须同时匹配 Git revision、App 版本和 APK 身份，安装前后 `firstInstallTime` 必须不变；不匹配的记录只能作为历史证据。
- 主登录态 AVD 是用户状态资产，未登录旅程使用独立 AVD；不得通过卸载、清数据、清 Cookie、重置或快照试探制造测试状态。
- 安装时间、账号、本机数据或登录态异常时立即停止设备变更，只读取证并报告 `BLOCKED_BY_ENV`；快照恢复属于需要另行授权的独立任务。
- 真实回复、编辑、删除、点赞、投票、收藏切换、上传或其他远端写入必须逐项取得授权，未执行时如实标记 `NOT_VERIFIED`。
