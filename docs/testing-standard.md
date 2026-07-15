# 测试标准

## 结论

测试必须证明“功能没有被改坏”，不是证明 App 能打开。影响运行逻辑、类型或构建的改动至少执行相关自动测试和 `npm run typecheck`；纯文档或注释改动只核对内容、引用和一致性。涉及页面流程、登录态、真实来源结果或交互时，还必须做模拟器验收。

开发前先在 `docs/product-map.md` 选择直接受影响的能力 ID；触及共享 seam 时按地图展开关联 ID。交付时逐个 ID 报告自动测试、模拟器路径、真实写操作、已恢复状态和未验证范围。

当前确定性测试使用 `Vitest + jsdom` 覆盖数据规则、来源解析、请求构造和状态计算；少量 `Jest + React Native Testing Library` 测试负责用户可见渲染行为。agent-device MCP 用于探索真实 App 和执行 `tests/live/agent-live.md` 的受监督验收，tracked `.ad` Replay 用于重复关键旅程。没有覆盖率百分比基线，测试价值以能否拦住明确的用户行为回归判断。

## 判断原则

- 代码里能固定的数据，用自动测试精确断言数量、字段、顺序和错误状态。
- 真实网站结果每天会变，不能把实时结果条数写成永久固定值；每次验收要记录同一关键词、同一筛选、同一登录态下的各站结果数和首条可打开结果。
- 搜索、首页、详情、回复、用户页和互动结果必须按对象检查实际存在且适用的关键字段和状态，具体字段以功能标准为准，不能只看列表有内容。
- 登录、Cookie、验证、备份、发布和安装属于高风险功能；只跑 UI 不算通过。
- 只打开 App、看首页显示、截图留存，都不算完整测试。
- 优化代码前只使用与当前 Git revision、App 版本和 APK 身份匹配的 `docs/emulator-baseline.md` 记录；优化后按同一功能、同一关键词、同一来源和同一登录态复测差异，不能以记录日期较新代替身份匹配。
- 登录和验证网页必须从 App 的 `更多 -> 账号中心` 入口打开；页面包名仍应是 `com.wz.reader`。用 Chrome 打开网页不能算登录 / 验证通过。
- 用户提供 NodeSeek、linux.do、V2EX 或妖火主题链接用于效果验证或排障时，先解析来源和主题 id，再用模拟器 App 内详情页验证；不得用 Chrome 或桌面浏览器代替。该内部验证流程不代表产品需要支持外部链接直达。
- 新增或修改依赖登录态的能力时，必须从 App 内原站同类页面核实字段、权限、入口和请求；未登录页面、桌面浏览器、第三方客户端、作者名或猜测的 API 不能作为依据。必要时可通过 WebView 调试查看 DOM、全局数据、已加载 JS 和 network，但不得输出 Cookie、token 或含敏感信息的截图、UI dump；临时取证文件只能保留在本机且不得提交。
- 单一账号、页面或当前已加载 JS/API 中没有对应入口或行为，不足以证明原站不支持。证据不足时不得猜测实现或新增入口，也不得据此移除或隐藏已有能力；应说明证据缺口。
- “全面测试”默认不授权真实发布、回复、编辑、删除、上传、点赞、投票或收藏切换；这些写操作只用自动测试、请求构造、权限显示和只读入口检查覆盖。
- 确实需要真实写操作验收时，必须先得到用户明确同意。发帖、回复、编辑和删除只作用于本次新建、中文且贴合原帖主题的临时内容，完成后清理并刷新确认；点赞和收藏切换完成后恢复原状态；投票等不可逆操作，以及无法清理的上传，必须针对具体对象或残留风险单独取得同意。

## 证据分层与工具职责

| 结果 | 必须来自 | 不能证明 |
| --- | --- | --- |
| `STATIC_PASS` | 文档、TypeScript、unused、React Doctor changed-lines | 功能在设备上可用 |
| `UNIT_PASS` | Vitest 行为测试 | React Native 实际渲染或当天原站结果 |
| `UI_PASS` | Jest/RNTL 通过 role、label、text 或稳定 `testID` 验证的渲染行为 | Native/WebView 和真实网络行为 |
| `DEVICE_REPLAY_PASS` | `.ad` 在匹配的 App/APK/设备/会话执行成功 | 未包含在脚本里的能力或真实写入 |
| `LIVE_PASS` | App 内真实来源或获授权写操作的可观察结果 | 其他 revision、APK、账号或日期 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR、RedBox | 业务功能完整正确 |
| `NOT_VERIFIED` | 已识别但缺少足够证据 | 不得改写为“应该可用” |
| `BLOCKED_BY_ENV` | 签名、设备、登录态或来源阻碍且不能安全改变环境 | 不等于代码失败 |

- MCP 是探索、诊断和录制入口；Replay 是经过审查后进入仓库的稳定旅程，二者不互相替代。
- tracked Replay 只能使用稳定 `testID`、accessibility label、role 和稳定文案；禁止坐标、临时引用、动态标题和固定实时数量。
- Replay 默认 retries 为 0；单个 `.ad` 首次失败即停止，普通执行失败由外层继续其他独立文件并在最后汇总，清理失败则立即中止后续文件以避免污染，只有全部通过才输出 `DEVICE_REPLAY_PASS`。诊断性重跑不能覆盖第一次失败。禁止在 CI 使用 `replay -u`：本机 0.19.0 仍可能重写脚本，而 0.19.1 起该参数已退役为 no-op；统一根据 divergence 建议人工修改并审查 diff。
- Agent Live 不是 CI。它只在 `npm run verify` 和相关 Replay 之后按 `targeted` 或 `full` Profile 执行；CF、动态目标、授权、恢复、不可逆写入和失败续跑规则以 `tests/live/agent-live.md` 为准。
- React Doctor 只扫描新增行并阻断新增 error；它是静态建议，不替代任何行为测试。
- 历史逃逸事故及负向控制见 `docs/regression-corpus.md`。

## 诊断日志完成标准

新增或修改用户可感知的功能时，诊断链是完成标准的一部分。每次公共操作至少写入 `intent`、一个能区分失败阶段的关键事件，以及唯一 `finish`；controller、gateway、传输和状态应用必须复用同一个 `traceId`。日志写入、轮转或导出失败不得改变产品行为。

| 链路 | 必须可判断 | 禁止记录 | 自动验证重点 |
| --- | --- | --- | --- |
| 首页 / 分类 / 搜索 / 详情 / 回复 / 用户页 | 用户触发或分页门禁、credential 是否存在、direct / WebView 通道、HTTP 元数据、解析数量、partial、合并前后数量、stale / cancel / apply | 搜索词、标题、作者、正文、真实 topic / user / cursor、URL path / query | 同一 `traceId` 的 start / 阶段 / 唯一终态；HTTP 200 解析为空、partial source failure、重复 cursor、旧请求丢弃 |
| 回复 / 编辑 / 删除 / 互动 / 投票 / 上传 | 权限门禁、credential / CSRF 来源枚举、请求阶段、乐观更新、rollback、本地 commit、成功后刷新是否失败 | Cookie、token、CSRF / API Key 值、正文、真实目标 ID、投票选项内容、上传文件名 / 路径 / URL | 重复写、缺 credential、乐观回滚、写成功但刷新失败、授权刷新；正文只断言长度，投票只断言选择数量 |
| Session / Cookie / WebView / 代理 | generation、store 空 / timeout / error、会话状态迁移、WebView 队列与 renderer gone、代理 load / apply / save 状态 | Cookie 名称和值、header、WebView HTML / message、代理地址 / 账号 / 密码 | stale generation、fallback / timeout、代理 apply 失败、日志中无伪造 secret |
| 本机资料 / 备份 / 更新 / 图片 / 导航 | save queue、superseded、persist、rollback、备份取消 / 解析 / 合并、更新检查 / 下载 / 校验、图片权限 / 下载 / MediaLibrary、route / snapshot / back 决策 | 任意对象序列化、备份内容、文件名 / 路径、图片 URL、页面内容 | 保存失败回滚、损坏 / 超限备份、分享取消、更新失败、权限失败、复杂返回链 |
| 导出与隐私 | 两份 1 MiB 轮转、旧到新 JSON Lines、固定元数据头、系统分享、临时文件删除 | 未列入白名单的任意字段 | 伪造 secret、ID、标题、正文、URL、路径贯穿写入和导出后均不存在；日志故障静默降级 |

诊断日志的合理目标是把多数业务问题定位到模块和失败阶段。纯视觉错位仍需截图，特定内容解析问题仍需原帖链接；native crash / ANR、GPU 和内存问题不以本地 JS 业务日志作为唯一证据。

## 有用测试标准

| 保留 | 删除或合并 |
| --- | --- |
| 能证明站点解析、请求目标、Cookie、登录态、安全边界、写操作、本地数据保存、备份恢复、请求归属或竞态回滚没有被改坏 | 只锁定 `padding`、`color`、`fontSize`、`borderRadius`、memo 比较、性能常量或内部 helper 形状 |
| 能防止用户能感知的回归，例如用户页顶部距离、回复按钮可点、mention 不像普通网页链接、隐藏 WebView 不可见 | 同一行为分支的重复样例，或只复述当前实现写法的断言 |

## 功能标准

| 功能 | 对的标准 | 常用自动测试 |
| --- | --- | --- |
| 入口 / 导航 | 冷启动进入首页；4 个底部入口可切换；从首页、搜索、收藏打开主题和用户页后可返回；详情页内再打开主题不会丢上一级状态 | `src/topicSessionState.test.ts`、`src/userNavigation.test.ts`、`src/app/backHandlerHelpers.test.ts` |
| 首页 / 分类 / 分页 | 四站来源按当前支持范围返回；分类不串站；分页不重复、不漏掉下一页；聚合首页保留来源平衡；linux.do、NodeSeek、V2EX 单站排序参数和缓存 key 不串用 | `src/feedLogic.test.ts`、`src/feedCategoryRail.test.ts`、`src/forumApi.test.ts`、`src/localSources.test.ts` |
| 搜索 | 空关键词不请求；单站和全部搜索都按站点分组；结果字段完整；错误按站点显示；分页能继续；筛选参数真实传给站点；登录态限制必须显示站点提示；NodeSeek 登录时走站内搜索，未登录时允许受限 Google 搜索结果，且两种状态要分开记录 | `src/forumApi.test.ts`、`src/localSources.test.ts`、`src/searchFilters.test.ts`、`src/searchListItems.test.ts`、`src/sources/sourceGateway.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`src/yaohuoApi.test.ts` |
| 详情 / 回复 | 标题、正文、作者、时间、分类、回复数和权限提示正确；回复分页不丢楼层；楼层引用和图片预览可用；返回后上一层详情状态保留 | `src/topicSessionState.test.ts`、`src/topicDerivedData.test.ts`、`src/topicContentSplit.test.ts`、`src/topicContentHtml.test.ts`、`src/topicListItemState.test.ts`、`src/localSources.test.ts` |
| 回复编辑 / 图片上传 | 三站回复失败后输入框仍可点击；格式按钮按站点插入 Markdown / UBB；NodeSeek 通过 NodeImage 自动授权、缓存 Key、过期后重新授权；NodeSeek / linux.do / 妖火上传后只插入草稿，不自动发送 | `src/app/topicActionHelpers.test.ts`、`src/replyImageUpload.test.ts`、`src/linuxdoUpload.test.ts`、`src/loginWebViewScripts.test.ts`、`src/nodeimageAuthWebViewScripts.test.ts`、`src/screens/topic/replyComposerFormatting.test.ts` |
| 回复删除 | NodeSeek、linux.do、妖火只在原站明确允许时显示删除；不得靠作者名判断；删除前必须确认；删除成功后列表中消失；默认不真实发回复或删除回复，真实删除只在用户明确同意后使用本次新发的临时回复 | `src/nodeseekActions.test.ts`、`src/linuxdoActions.test.ts`、`src/yaohuoActions.test.ts`、`src/localSources.test.ts`、`src/localYaohuo.test.ts` |
| 互动 / 写操作 | 未登录时不发送；登录后请求带正确 Cookie / CSRF / sid；成功后本地状态不重复计数；失败后回滚；投票、收藏、点赞、回复的目标不串站 | `src/nodeseekActions.test.ts`、`src/nodeseekActionClient.test.ts`、`src/linuxdoActions.test.ts`、`src/linuxdoActionClient.test.ts`、`src/yaohuoActions.test.ts`、`src/yaohuoActionClient.test.ts`、`src/topicActionState.test.ts` |
| 用户页 | 四站用户资料、头像、发帖数 / 回帖数、主题列表、回复列表、分页游标正确；主题和回复的来源、分类、标题、作者、时间、楼层、摘要按原站支持范围显示；用户名和用户 ID 不混用 | `src/forumApi.test.ts`、`src/localYaohuo.test.ts`、`src/yaohuoApi.test.ts`、`src/screens/user/userScreenItems.test.ts`、`src/components/TopicCard.test.ts`、`src/userNavigation.test.ts` |
| 收藏 / 历史 / 关注 | 本机数据保存失败能暴露；列表筛选、分组、去重、备份恢复后数据一致；备份不含敏感字段 | `src/readerData.test.ts`、`src/readerDataStore.test.ts`、`src/readerBackup.test.ts`、`src/backupImportFile.test.ts`、`src/backupOperation.test.ts`、`src/appSecurity.test.ts`、`src/app/useReaderDataController.test.ts` |
| 登录 / 验证 / Cookie / 凭据 | `SiteSessionState` 是三站唯一登录状态来源；Cookie 与保存凭据互不删除；账号密码仅进 SecureStore；填入前后都校验可信 URL、路径和字段，触发输入事件但不提交；检查登录态和诊断不泄露敏感值；页面提示区分未登录、失效、验证和普通失败 | `src/siteSessionState.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/screens/more/accountCenter.test.ts`、`src/nodeseekCookies.test.ts`、`src/yaohuoCookies.test.ts`、`src/cookieCleanup.test.ts`、`src/appSecurity.test.ts` |
| 问题诊断 | Release 常驻入口可生成 UTF-8 JSON Lines 并打开系统分享；日志轮转和导出不阻塞业务；临时分享文件随后删除；所有字段经过白名单和脱敏；页面提示显示问题附截图、内容特例附原帖链接 | `src/diagnostics.test.ts`、`src/diagnosticFileStore.test.ts`、`src/sources/sourceGatewayContract.test.ts`、`src/app/useReaderDataController.test.ts`、`src/imageSave.test.ts` |
| 更多页 / 外观 / 更新 | 单一账号中心按 NodeSeek、linux.do、妖火排列且只显示一站详情；顶部区分待处理、网站登录和自动填入数量；原主页、登录 / 验证、检测、清除登录、刷新网页、签到、NodeImage 和等级入口均保留；进入 More 页不自动刷新；测试工具独立；代理、备份、诊断、外观和更新行为不变 | `src/app/accountStatusHelpers.test.ts`、`src/screens/more/accountCenter.test.ts`、`src/siteSessionState.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/networkProxy.test.ts`、`src/webViewProxyGuard.test.ts`、`src/appUpdate.test.ts`、`src/releasePackaging.test.ts` |
| 发布 / 安装 | 版本号一致；release 先跑测试、文档和无用代码检查；正式签名有效；按设备 ABI 覆盖安装签名 APK；`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 分别通过；敏感文件不提交 | `src/releasePackaging.test.ts`、`src/androidSmokeGuard.test.ts`、`npm run release:android` |

## 文档、UI、Replay 与发布候选

稳定 Markdown 改动运行：

```powershell
npm run verify
node --test scripts/check-docs.test.mjs
node scripts/check-docs.mjs
npm run test:ui
npm run check:react
```

检查器验证已跟踪 Markdown 与稳定文档中的相对链接、反引号仓库路径、能力 ID、回归语料库引用和用户身份认证术语；本机专用的 `docs/emulator-baseline.md` 不要求在干净 checkout 中存在。

在已安装当前目标构建、设备身份明确且不需要覆盖安装时运行只读 Replay；必须同时指定用来核对设备 `base.apk` SHA-256 的目标 APK：

```powershell
$env:WZ_ANDROID_TEST_DEVICE = 'WZ Pixel API 35'
$env:WZ_ANDROID_TEST_APK = 'C:\path\to\current.apk'
npm run test:device
```

`test:device` 先核对 App version/versionCode，并从明确设备只读拉取已安装 `base.apk` 计算 SHA-256；任何身份不匹配都直接失败。它只形成 `DEVICE_REPLAY_PASS`；JUnit、截图、视频和日志产物进入 ignored 的 `tmp/agent-device/`。每个 `.ad` 独立 relaunch，单文件内部零重试并在失败处停止；普通执行失败时外层继续其余文件并汇总为非零退出，若本机 daemon 或设备录屏 scratch 清理失败则立即中止，后续场景不再具备隔离证据。证据拉回后只终止本条 Replay 新增的本机 daemon，并只清理明确设备上路径匹配 agent-device 录屏前缀的进程/scratch；不能停止 MCP、清 App 数据、Cookie、用户文件或本机首败证据。动态结果只断言状态、来源和可打开性，不固定主题标题或数量，也不把依赖动态对象内容长度、回复组成或权限的交互塞进固定 Replay；这类行为由 RNTL 固定、Agent Live 选择满足前置条件的真实对象核实。

发布脚本分别校验正式 APK 与开发签名 smoke APK 后运行：

```powershell
npm run smoke:android
```

通过标准：覆盖安装且不清 App 数据；确认 App 版本、versionCode、APK SHA、设备和登录来源；冷启动与日志窗口没有本次流程产生的崩溃、ANR 或 RedBox，形成 `APK_SANITY`；随后执行 tracked Replay，形成独立的 `DEVICE_REPLAY_PASS`。缺少搜索结果、用户主题、收藏基线、页面 readiness 或 APK 身份均判定失败，不降级为跳过。全程只读，不创建或切换收藏，也不执行其他真实写操作；受影响来源仍要继续执行本文件对应专项验收。

动态来源、真实账号和已授权写操作按 `tests/live/agent-live.md` 执行。普通改动只跑受影响能力的 `targeted`；集中修复、里程碑或发布前跑 `full`。场景相互独立，CF 由用户手动处理；无人处理记 `BLOCKED_BY_ENV`，不可逆结果不明确时不得重试。

## 搜索验收

搜索是最容易出现“看起来能搜，实际坏了”的功能。改搜索、来源解析、筛选、列表分组、请求归属，或改动会影响搜索路径的 Cookie、隐藏 WebView 时，必须执行下面两层。

### 自动测试

```powershell
npm test -- src/forumApi.test.ts src/localSources.test.ts src/searchFilters.test.ts src/searchListItems.test.ts src/sources/sourceGateway.test.ts src/yaohuoApi.test.ts src/requestOwnership.test.ts
npm run typecheck
```

通过标准：

- 固定样本的搜索结果数量、顺序、分页和字段断言通过。
- NodeSeek、linux.do、V2EX、妖火的搜索请求没有回到本地项目服务。
- 单站失败不会让全部搜索整体失败。
- 筛选参数和分页参数进入真实站点请求。

### 模拟器验收

在不清 App 数据的前提下执行。推荐关键词：

| 关键词 | 目的 |
| --- | --- |
| `codex` | 英文技术词，检查四站普通搜索、分组数量和 NodeSeek 登录 / 未登录搜索路径；模拟器当前登录态下的 NodeSeek 数量只能作为站内搜索基准 |
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
- NodeSeek 未登录时跳到 Google 搜索页但 App 直接判读取失败。

固定操作：

1. 点底部 `搜索`，确保回到搜索页顶部。
2. 输入或选择关键词后，必须点击 App 内提交按钮；最近搜索词只填入关键词，不代表已经搜索。
3. 分别检查 `全部`、`V2EX`、`linux.do`、`NodeSeek`、`妖火`。
4. 每个来源记录结果数、首条标题、错误文案和是否可继续加载。
5. 打开至少一个结果详情，再返回搜索页，确认关键词、来源和结果仍保留。
6. 打开搜索筛选，确认筛选项存在；非必要不改变筛选。
7. 若点到 `linux.do 老帖` 的外部搜索入口，记录为外部跳转检查，不作为登录 / 验证检查。

NodeSeek 单源搜索有两种通过状态：

- 已登录：站内搜索结果正常显示，结果可打开详情；模拟器基准要标注为“已登录”。
- 未登录 / 仅验证：允许读取 `google.com/search` 中限定 `nodeseek.com` 的结果，结果仍必须显示为 NodeSeek 来源，并可打开详情；不能为了制造该状态清除 App 数据，自动化测试必须覆盖这个路径。

当前可对照的模拟器结果见 `docs/emulator-baseline.md`。

## 用户主页验收

改 NodeSeek、linux.do、V2EX、妖火的用户资料、主题、回复、分页、用户页 tab 或用户页列表渲染时，必须执行。

### 自动测试

```powershell
npm test -- src/forumApi.test.ts src/localYaohuo.test.ts src/yaohuoApi.test.ts src/components/TopicCard.test.ts src/screens/user/userScreenItems.test.ts
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

## 回复图片上传验收

改回复、楼层回复、格式工具栏、图片上传、NodeImage 授权或写操作锁时，必须执行。

### 自动测试

```powershell
npm test -- src/app/topicActionHelpers.test.ts src/app/topicActionControllerHelpers.test.ts src/app/useTopicSessionController.test.ts src/replyImageUpload.test.ts src/linuxdoUpload.test.ts src/loginWebViewScripts.test.ts src/nodeimageAuthWebViewScripts.test.ts src/nodeseekActions.test.ts src/nodeseekCookies.test.ts src/nodeseekBrowserFetchScript.test.ts src/screens/topic/replyComposerFormatting.test.ts
npm run typecheck
```

通过标准：

- 发送失败或上传失败后，同一个回复框还能继续点击和编辑。
- NodeSeek 图片上传使用用户自己的 NodeImage Key；无 Key 时自动打开 App 内授权页；已有 Key 时不重复授权；401 / 403 后只刷新一次 Key 再重试。
- NodeSeek 回复 / 编辑必须使用真实 post/comment id；当前请求未传 token 时由 `src/nodeseekActions.ts` 生成 16 位 `csrf-token`，自动测试必须固定该请求契约。
- NodeSeek 自己的回复只有同时有评论 id 和原始正文时才显示编辑；只隐藏自己的点赞 / 鸡腿 / 反对，不展示点了会失败的编辑入口。
- 取消编辑或系统返回关闭编辑框后，编辑正文不能残留成普通回复草稿。
- NodeSeek 详情必须保留原站渲染后的 at、楼层链接、表情 / sticker 和签名显示，不得因为编辑源数据回退成纯文本。
- NodeSeek 楼层回复的草稿请求包含 `@用户` 和楼层链接；测试只构造请求，不发送真实回复。
- linux.do 上传走 `/uploads.json` 且保留 FormData；妖火上传走图床后插入 `[img]...[/img]`。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. `更多 -> 账号中心` 确认 NodeSeek、linux.do、妖火是可写登录态；NodeImage 显示已保存或可自动授权。
2. NodeSeek 无 Key 或强制重新授权时，点击图片按钮应打开 App 内 NodeImage 授权页；授权成功后关闭弹层并显示已保存。
3. force-stop 后重新打开 App，再进 NodeSeek 回复框点图片，已有 Key 时应直接打开文件选择器，不再弹授权。
4. 默认只打开三站文件选择器并取消，确认回复框和草稿状态没有损坏；上传请求、响应解析和草稿插入由自动测试覆盖。
5. 只有用户明确同意真实图片上传时，才各选一张小图并确认草稿中分别出现 Markdown 图片、Markdown / `upload://` 图片、UBB 图片；不点击真实发送。若上传文件无法清理，必须在操作前说明残留风险并单独取得同意。
6. 发送失败状态默认由自动测试覆盖；模拟器只在自然遇到失败或能安全拦截请求、不产生真实写入时复测，不得为了制造失败发送真实回复。失败后回复框必须仍可点击和编辑，不允许靠收起再展开恢复。
7. 结束前清空草稿或收起回复框，检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 回复删除验收

改回复、楼层回复、写操作、权限解析或删除按钮时，必须执行。默认不在真实站点新发回复或删除回复；删除成功后的列表变化由自动测试固定。用户明确同意真实写操作验收时，只删除本次测试新发的临时回复，不删除已有历史内容。

### 自动测试

```powershell
npm test -- src/nodeseekActions.test.ts src/linuxdoActions.test.ts src/yaohuoActions.test.ts src/localSources.test.ts src/localYaohuo.test.ts
npm run typecheck
```

通过标准：

- linux.do 只读取 Discourse `can_delete`，删除请求为 `DELETE /posts/{id}.json`。
- 妖火只读取原站回复里的 `Book_re_del.aspx` 删除链接，普通回复没有删除入口。
- NodeSeek 只读取原站数据中的可删字段或删除入口，不靠作者名推断。
- 删除请求缺少评论 id、删除链接或必要参数时必须拒绝。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. 确认 NodeSeek、linux.do、妖火均为可写登录态；如 NodeSeek 触发 Cloudflare，先在 App 内完成验证，无法自动完成时停止并交给用户。
2. 默认只检查已有页面上的删除入口是否只出现在原站允许的回复上；不得为了验收主动发布临时回复，也不得点击已有历史内容的删除入口。
3. 确认框和取消行为默认由自动测试覆盖；只有用户明确授权并使用本次新建的临时回复时，才在模拟器点击删除入口。
4. 删除请求、删除后列表立即消失、刷新后不残留，默认通过自动测试覆盖。
5. 只有用户明确同意真实写操作验收时，才新发中文且贴合主题的临时回复，再确认删除后刷新检查。
6. 回复框在失败、取消和删除后仍可点击、可编辑，不需要收起再展开。
7. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 模拟器验收清单

| 区域 | 必查 | 不默认点击 |
| --- | --- | --- |
| 首页 | 四个来源、分类、阅读筛选、单站排序、打开详情、返回列表 | 无 |
| 详情 | 来源、标题、作者、时间、正文、回复数、附件、图片预览、返回 | 保存图片、回复、点赞、收藏切换 |
| 搜索 | 关键词、来源分组、结果数、首条、筛选、详情、返回、错误文案 | 外部网页、写操作 |
| 收藏 | 收藏数、来源筛选、分类筛选、已收藏 / 已读状态 | 取消收藏 |
| 历史 | 历史数、最近阅读、已读状态 | 删除、清空历史 |
| 关注用户 | 关注数、用户页、用户主题列表、返回 | 取消关注 |
| 账号中心 | 三站顺序、单站详情、真实状态、身份、凭据摘要、主操作、顶部唯一公共 `刷新账号状态` 和全部原服务入口；从 App 内打开登录 / 验证页并确认包名仍为 `com.wz.reader`；临时匿名下账号中心与弹层同步，关闭后恢复；测试凭据填入但不提交并在结束前删除 | 清除网站登录、退出登录、手工改 Cookie、提交测试登录、真实签到 |
| 回复编辑 / 图片上传 | 三站回复框、失败后可继续编辑、格式按钮、文件选择器打开和取消、NodeImage 授权和缓存；真实上传及草稿插入默认由自动测试覆盖 | 真实上传、真实发送回复、清除 NodeImage Key |
| 回复删除 | 删除入口和权限显示；确认框取消及删除后消失默认由自动测试覆盖 | 点击已有内容的删除入口、真实新发回复、真实删除回复、删除旧回复、删除他人回复、清数据制造状态 |
| 测试工具 | 只在开发版可见；正式版不可见；临时匿名开关独立于账号区；说明“不删除 Cookie” | 清数据、退出登录、清 Cookie |
| 更多页 | 版本、检查更新、账号中心、linux.do 等级、服务器代理入口、问题诊断入口、备份入口、外观入口；诊断日志验收时打开分享面板后取消，确认 App 可继续使用 | 备份导出、导入、安装更新、切换外观、启用未知代理 |

## 改动类型对应验证

| 改动类型 | 必跑 |
| --- | --- |
| 来源解析、搜索、详情、用户页 | 对应来源测试、`src/forumApi.test.ts`、`src/localSources.test.ts`、`npm run typecheck`、模拟器验收 |
| App controller、请求归属、取消请求 | 对应 controller helper 测试、`src/requestOwnership.test.ts`、`npm run typecheck`、模拟器验收 |
| 登录、验证、Cookie、写操作 | 相关 cookie / action / session 测试、`src/appSecurity.test.ts`、`npm run typecheck`、模拟器验收 |
| 账号中心、凭据保存 / 填入、NodeSeek 当前账号兜底 | `src/forumApi.test.ts`、`src/nodeseekCookies.test.ts`、`src/loginWebViewScripts.test.ts`、`src/screens/more/accountCenter.test.ts`、`src/credentialVault.test.ts`、`src/loginFormAdapters.test.ts`、`src/siteSessionState.test.ts`、`src/app/sessionControllerHelpers.test.ts`、`npm run typecheck`、模拟器验收 |
| 回复编辑、楼层回复、图片上传、NodeImage Key | 回复图片上传验收、相关 action / WebView script 测试、`npm run typecheck`、模拟器验收 |
| 回复删除、删除权限、评论 id / 删除链接解析 | 回复删除验收、相关 action / 来源解析测试、`npm run typecheck`、模拟器验收 |
| 收藏、历史、备份 / 恢复 | reader data / backup 测试、`src/appSecurity.test.ts`、`npm run typecheck` |
| 服务器代理 | `src/networkProxy.test.ts`、`src/networkProxyControllerGuard.test.ts`、`src/networkProxyModalGuard.test.ts`、`src/webViewProxyGuard.test.ts`、`src/appUpdateProxyGuard.test.ts`、`src/releasePackaging.test.ts`、`npm run typecheck`、模拟器验收 |
| UI 样式、主题 | 只保留事故级 UI helper 测试、`src/theme.test.ts`、`npm run typecheck`、模拟器验收 |
| App 内更新检查、安装入口 | `src/appUpdate.test.ts`、`src/appUpdateProxyGuard.test.ts`、`src/releasePackaging.test.ts`、`npm run typecheck`、模拟器验收 |
| 签名、版本、原生构建配置、发布脚本、正式发布 | `npm run release:android` |

## Review 修复回归基线

| 修复点 | 必跑自动测试 | 必做模拟器验收 |
| --- | --- | --- |
| NodeSeek 未登录 Google 兜底 Cookie 不落盘 | `src/nodeseekCookies.test.ts`、`src/appSecurity.test.ts` | 已登录态下复测 NodeSeek 搜索和详情；不得为制造未登录态清数据或清 Cookie |
| 首页 `全部` + 妖火拆分分页失败不混入半页结果 | `src/app/useFeedController.test.ts` | 首页 `全部` 下滑加载下一页，确认四站来源仍可见，且没有加载失败后混入半页结果或错误状态残留 |
| V2EX 默认 `all` 页分页起点 | `src/localSources.test.ts` | 切到 V2EX 单站，下滑加载更多，确认出现新的 V2EX 主题且无重复首屏 |
| 备份敏感字段过滤 | `src/appSecurity.test.ts`、`src/readerBackup.test.ts` | 只检查备份入口；未经用户同意不得点击导出或导入 |
| 详情页返回、用户页返回、回复弹层返回 | `src/app/backHandlerHelpers.test.ts`、`src/topicSessionState.test.ts`、`src/userNavigation.test.ts` | 打开详情、切换回复筛选、进入作者用户页，再用系统返回，确认回到原详情状态；能安全复现时再测回复弹层关闭 |
| NodeSeek 清除登录后 WebView 刷新 | 账号 controller 相关测试、`src/nodeseekCookieBridge.test.ts` | 只打开 App 内 NodeSeek 登录 / 验证页并确认包名为 `com.wz.reader`；未经用户同意不得点击 `清除登录` |
| linux.do 缺失引用楼层 | `src/forumApi.test.ts` | 有具体 linux.do 主题链接时再用 App 内详情页复测；没有链接时不靠随机帖子判断 |
| 详情回复数跟随筛选结果 | `src/topicDerivedData.test.ts`、详情 UI 相关测试 | 打开有回复的详情页，切换 `只看楼主` / `只看带图` 等筛选，确认 `回复列表 N 条` 随筛选变化 |
| release 签名摘要固定 | `src/releasePackaging.test.ts` | 修改签名、版本、原生构建配置、release manifest 或发布脚本时必须跑 `npm run release:android`；确认签名摘要和 manifest 生成成功 |

## 模拟器规则

允许：

```powershell
npx expo start --dev-client --clear --port 8081
npx expo run:android --no-bundler --app-id com.wz.reader --no-build-cache
adb shell am force-stop com.wz.reader
adb shell monkey -p com.wz.reader -c android.intent.category.LAUNCHER 1
```

禁止：

```powershell
adb uninstall com.wz.reader
adb shell pm clear com.wz.reader
```

确实需要清数据时，必须先得到用户明确同意。
