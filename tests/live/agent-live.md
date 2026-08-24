# Agent Live 验收

## 定位

Agent Live 使用当前任务已经连接的 agent-device MCP，在保留真实登录态的 Android App 上验证动态来源、系统能力和经本次明确授权的写操作。非远端写入场景默认允许无人值守运行；登录、账号授权、交互式 CAPTCHA 和远端写入仍保留人工边界。它不是确定性 CI，也不替代 Vitest、Jest/RNTL、Device Replay 或 APK sanity。

执行顺序固定为：选择能力 ID → `npm run verify` → 相关 `.ad` Replay → Agent Live 非远端写入场景 → 汇报已完成结果并请求本次远端写入授权 → 只执行用户明确同意的场景。前一层失败时先记录失败；除非继续操作会造成数据、安全或状态污染，否则仍可收集其他独立场景的证据。

## Profile

| Profile | 何时运行 | 范围 |
| --- | --- | --- |
| `targeted` | 普通改动完成后 | 只运行产品地图中直接受影响能力及共享 seam 展开的场景。 |
| `full` | 集中修复结束、里程碑或发布前 | 运行本文全部适用场景；没有动态目标的场景记 `NOT_VERIFIED`，环境阻塞记 `BLOCKED_BY_ENV`。 |

启动 Agent 时必须给出 Profile、Git revision、App version、APK SHA-256、设备和能力 ID；不得把账号、Cookie、密码、token 或代理地址写入报告。

## 全局边界

- 每个场景从可确认的根状态开始，先确认入口和前置状态；只有冷启动或重启本身是 oracle 时才 relaunch。可复用同一请求证据，但不得依赖未确认的页面、选项或草稿。
- 不卸载 App，不清 App 数据、Cookie、登录态，不退出账号，不重置模拟器；MCP、ADB 和共享模拟器保持运行。
- 优先使用可见文案、accessibility role/label 和稳定 `testID`；除明确要求验证物理触控几何的 `REG-NAV-001` 等受监督场景外，禁止坐标点击和固定长等待替代状态断言。物理几何坐标必须从当前匹配设备的 UI hierarchy 推导、只点击 App 本机只读控件并在场景结束后恢复根状态，不得写入 tracked Replay。
- App 内原站 WebView 出现普通 Cloudflare checkbox 时按下文自动恢复协议处理，不暂停整轮，也不在运行中等待用户。登录表单、账号授权、一次性验证码、选图/文字题或其他交互式 CAPTCHA 仍是人工边界；只阻塞对应来源，随后继续其他独立场景。
- 动态目标按场景规定的关键词和控件查找；没有合格目标记 `NOT_VERIFIED`，不能拿搜索结果页、普通主题或一次空结果冒充成功。
- 用户给出 NodeSeek、linux.do、V2EX 或妖火主题 URL 时，该 URL 是验收目标：先按来源和主题 id 直达 App 内详情，不得用搜索路径、相似主题或桌面浏览器替代。搜索只用于没有给定目标，或在给定目标已完成只读检查后寻找额外未投只读样本。
- 可逆操作先记录初始状态，完成后恢复并通过刷新或重新进入确认。恢复失败时停止该来源后续写操作，记录残留，但继续其他独立来源。
- 投票前必须记录明确的未投/已投状态和准确选项；不可逆操作按具体对象逐次授权且只提交一次。结果不明确时不得重试，记录可见状态和 `NOT_VERIFIED` 或失败，防止重复投票、签到或写入；提交后通过刷新/重进 App，并从 App 内原站同类页面核对。
- 普通页面失败时保存截图、UI hierarchy 和操作摘要；成功只保留足以证明 oracle 的最小证据，不提交这些运行产物。凭据、登录/认证、代理配置及其他可能显示账号、密码、Cookie、token、代理地址的页面禁止截图和导出 UI hierarchy，只写不含值的脱敏状态摘要；若普通页面意外显示敏感值，立即停止取证并删除本任务产生的相关运行产物。

### Cloudflare checkbox 自动恢复协议

1. 只在 App 自己打开的目标站 WebView 中操作，并同时确认 Cloudflare challenge 上下文、唯一可用的 checkbox role，以及 `Verify you are human` 或语义等价 label。每次操作前重新获取 snapshot，只按语义 ref 点击一次；禁止坐标、图像猜点、DOM 注入、Cookie 导出或独立浏览器旁路。
2. 点击后按 UI 状态有界等待，最长 30 秒，不用固定长 sleep。checkbox 消失且目标页开始加载后，调用 App-owned canonical 检测动作：NodeSeek 等待 `nodeseek-login-webview-settled` 后点“检测登录”，linux.do 点“检测状态”；不能以 checkbox 被点击、WebView 空白或页面看似正常代替账号/clearance 结论。
3. canonical 检测成功后，只恢复触发验证的原始 Query 一次，并等待该请求自己的 `data/empty/partial/error/auth` outcome；不得重跑整套场景或自动重放任何写请求。
4. checkbox 不唯一、没有语义节点、30 秒内未通过、canonical 检测仍返回 `verification-required`，或页面升级为登录、授权、一次性验证码及其他交互式挑战时，不继续猜测或重复点击。保存不含凭据的最小证据，将对应来源的数据轴记 `BLOCKED_BY_ENV`，跳过该来源后续依赖场景并继续其余场景；只在整轮汇报中说明需要用户恢复会话，不在中途等待回复。
5. 全程不得清 Cookie、退出账号、卸载、重置设备或自动提交登录表单。远端写操作仍受逐次授权门禁约束，验证恢复不得让既有写请求自动重放。

### 永久排除

- 编辑或删除已有历史内容、他人内容，以及任何不能安全清理的临时内容。
- NodeSeek“反对”。
- 把备份上传到云端、真实发送含图片草稿、清除登录、卸载、清数据或重置设备。
- 新版本更新 UI；该能力只保留确定性代码检查。

### 逐次授权门禁

- 先完成本次所有不需要真实远端写入的适用场景，再汇报这些场景的结果；不得提前请求授权来打断非远端写入验收。
- 随后列出拟执行的站点、具体操作、是否可逆及恢复方式并询问用户。只有用户对本次所列操作明确同意后，才能执行 `LIVE-ACCOUNT-03`、`LIVE-WRITE-01` 至 `LIVE-WRITE-03` 和 `LIVE-WRITE-05`；未回复、拒绝或只同意部分操作时，其余操作不执行并记 `NOT_VERIFIED`。
- 授权只适用于当前任务和本次列出的操作，不跨任务、不扩展到同站点其他写操作，也不得写入本文作为永久授权。
- 回复、楼层回复、编辑和删除只使用 Agent 本轮逐项获准创建且能安全清理的临时内容；只在 `targeted` 场景执行，`full` 不默认执行。
- NodeSeek 的发帖、回复、编辑和删除在本轮获准后，优先从 App 内原站确认并使用当前名为“沙盒”的官方测试分区；不得硬编码 category id。若受测版本尚无发帖入口，只测试已实现且获准的写能力。测试内容使用唯一中文标识，结束后清理并刷新确认；沙盒本身不授权互动、投票、上传或其他未列出的写操作。
- 受门禁操作包括 NodeSeek 签到、点赞、鸡腿、原站收藏和投票，linux.do 点赞、书签和投票，妖火原站收藏和投票，以及三站上传图片到回复草稿。上传即使不发送也可能产生远端文件，仍按远端写入处理。
- 本机收藏/关注、图片保存、备份导入导出、代理和外观设置不属于远端写入；有初始状态的必须恢复。

## 场景格式

每个场景按以下顺序执行和报告：

1. 能力 ID 与前置状态。
2. 动态目标查找规则和停止条件。
3. 操作前可见状态。
4. 最小操作步骤。
5. 用户可见 oracle；刷新或重新进入后的稳定 oracle。
6. 恢复动作、最终状态和残留。
7. `LIVE_PASS`、`NOT_VERIFIED`、`BLOCKED_BY_ENV` 或明确失败；涉及动态服务时，应用流程与数据读取结果分别报告，不能用来源波动覆盖正确错误流程，也不能用正确错误 UI 掩盖 App 的数据读取缺陷。

动态读取统一按三轴结算：

| 证据轴 | 通过或阻碍 | 明确失败 |
| --- | --- | --- |
| App 流程 | 当前请求进入正确终态，成功/空态/错误分支与恢复入口一致，记 `LIVE_PASS` | 永久 Loading、旧请求冒充当前结果、错误不可见、无恢复入口或来源串扰 |
| 外部数据 | 真实数据出现记 `LIVE_PASS`；有诊断证据的限流、CF 或外部故障记 `BLOCKED_BY_ENV`；证据不足记 `NOT_VERIFIED` | 诊断指向 App 请求构造、鉴权、凭据路由或解析契约 |
| 基础设施 | revision、version/versionCode、APK SHA、设备和证据采集身份完整 | 身份或证据不完整记 `BLOCKED_BY_ENV`，不得借用旧基线 |

真实 probe 只由下表 owner 发起；同一次真实请求已经提供可用证据时，后续场景直接复用，不重复请求：

| 来源 × 能力 | 唯一 probe owner |
| --- | --- |
| 四站 × Feed / Feed → Topic | `LIVE-READ-01` |
| 四站 × Search / Search → Topic | `LIVE-READ-02` |
| V2EX × Topic 筛选 / Topic → User → Topic | `LIVE-READ-03` |
| NodeSeek × Topic 用户链接 → User → Topic | `LIVE-READ-04` |
| 四站 × Topic 回复顺序 | `LIVE-READ-05` |
| NodeSeek/V2EX × 表格；linux.do × 长图 | `LIVE-READ-06` |
| NodeSeek × 1381 图预览首次/重开延迟 | `LIVE-READ-08` |
| NodeSeek、linux.do、妖火 × 账号状态 | `LIVE-ACCOUNT-01` |
| linux.do × 等级与活跃数据 | `LIVE-ACCOUNT-04` |

## 本机导航

### LIVE-NAV-01 底部导航整格点击

- 能力：`NAV-01`；保持 `NOTIFY-03`、`REG-NOTIFY-052` 的 More 红点和无障碍文案。
- 前置：使用身份匹配的当前 APK、竖屏主 AVD 和无弹层的首页；只读记录 `firstInstallTime`，从 UI hierarchy 读取底栏与 `main-tab-feed/search/library/more` 的实际 bounds，并保存首页选中态的底栏截图。
- 点击 oracle：四个按钮在保留既有外层 padding 的底栏内容区内首尾相接、互不重叠且高度保持现有 `48dp`。每个按钮分别从另一个 tab 开始，在其上、下、左、右边缘内侧 2px 点击；相邻边界两侧各点一次，均必须只选中坐标所属 tab，并显示对应首页、搜索、收藏或更多页面。坐标每次从当前 hierarchy 推导，不复用其他设备或分辨率的固定值。
- 视觉 oracle：恢复首页后对比修复前后底栏截图，底栏高度、外层留白、安全区、四个图标与文字的位置/尺寸/颜色、选中态及 More 红点保持一致；只允许按钮 accessibility bounds 扩展。
- 结束：恢复首页，确认 `firstInstallTime` 未变化且无 crash、ANR、RedBox 或意外 PID 重启；本场景不发搜索、不打开动态内容、不执行任何本机或远端写操作。坐标步骤不得录成 `.ad`。

### LIVE-NAV-02 四站内部楼层 deep link

- 能力：`NAV-02/03`；共享 `TOPIC-03`、`REG-NAV-003`。只使用当前仍存在且无需写入的四站楼层 URL；每站先在 warm App 发送一次 `exp+wz-android://open-topic?url=<encoded>`，再 force-stop App 后从 process-cold 发送同一链接。force-stop 不清数据、不改登录态。
- oracle：两种启动态都只 push 一层 Topic，进入正确来源与主题并定位目标楼层；Android Back 一次回到原页面或 Launcher。NodeSeek 的 hash、linux.do 的 path、V2EX `#replyN`、妖火 `tofloor` 分别报告；目标被删、权限不足或公网不可达时仅该站记 `NOT_VERIFIED/BLOCKED_BY_ENV`，不得搜索相似帖子替代。
- 全程不发送回复、不打开未读消息、不清 App 数据/Cookie/登录态；普通无楼层 Topic URL另作负向控制，必须进入主题但不产生伪目标高亮。

## 动态读取与返回

### LIVE-READ-01 四站 Feed 与 Topic

- 能力：`FEED-01`、`FEED-02`、`TOPIC-01`、`NAV-02`、`NAV-03`。
- 逐站切换 V2EX、linux.do、NodeSeek、妖火，等待当前请求进入明确 outcome；有数据时尝试各打开一个真实主题，同一次 Feed 证据不在其他场景重复请求。
- 流程 oracle：来源与所选来源一致，成功、空态或错误分支正确结算且可恢复；打开 Topic 后显示来源、标题、作者、正文或明确错误态，返回后仍是原来源和列表状态。
- 数据轴逐站报告；无结果、CF、限流或外部错误只影响该来源，不阻止其他来源，也不能冒充真实数据成功。

### LIVE-READ-02 搜索、筛选与投票目标

- 能力：`SEARCH-01`、`SEARCH-02`、`SEARCH-03`、`SEARCH-04`、`TOPIC-01`。
- 普通搜索按受影响来源执行，每个“来源 × Search”只发一次 probe；没有给定 URL 而需要投票目标时，必须在对应来源搜索准确关键词“投票”，打开实际显示投票选项和提交控件的 Topic。给定 URL 时先直达该 Topic，搜索不能替代。
- 流程 oracle：提交后当前请求才暴露结果终态，来源和筛选保持隔离；有数据时打开结果并返回相同关键词、来源和筛选。空态或明确错误可证明流程但不能记数据成功；只看到搜索结果列表不算找到投票目标。

### LIVE-READ-03 Topic、User 与状态恢复

- 能力：`TOPIC-03`、`USER-01`、`USER-02`、`NAV-03`。
- 筛选目标固定从 V2EX 当前 Feed 自上而下检查前 5 个 Topic，选择第一个同时包含楼主与其他作者回复、至少一条带图回复，并能从可见回复中选出一个长度至少 3、只命中部分回复的 ASCII 查找词的 Topic；每个候选只读取一次，不满足即返回继续，5 个均不满足则本段记 `NOT_VERIFIED`。
- 用户返回目标独立从同一 Feed 自上而下检查前 5 个 Topic，选择第一个作者 User 页至少有一个可打开主题的 Topic；执行 Topic → 作者 → User → 首个主题 → 逐层返回。5 个均不满足则本段记 `NOT_VERIFIED`，不得借用前一场景残留页面。
- 在筛选目标依次检查全部、只看楼主、只看带图和既定 ASCII 评论查找词；每次同时核对可见列表与数量。再切换倒序，确认同一组内容筛选和查找仍可用且不会把当前片段本地反转；清空查找、恢复全部并切回正序。
- 若已有已读消息或可见回复关系能进入远端楼层锚点，则缓慢向上滚动，确认上一窗口在“加载更早回复”按钮出现前开始加载且前插不跳位；没有只读目标时记 `NOT_VERIFIED`，不得发送回复制造状态。
- oracle：每层返回到正确页面，筛选后的列表和数量一致；另从筛选目标打开“阅读设置”并返回，必须仍是同一个 Topic、同一筛选和阅读位置，固定回归见 `REG-TOPIC-002/063`。

### LIVE-READ-04 NodeSeek 用户名内导航与 UID 归一

- 能力：`TOPIC-02`、`TOPIC-03`、`USER-01`、`NAV-02`；共享 `USER-02`、`LIBRARY-02`、`NAV-03`。仅当当前 revision、version/versionCode、APK SHA 匹配，NodeSeek Account Query 已确认登录，且目标链接仍存在对应可信 href 时执行；否则按证据轴记 `BLOCKED_BY_ENV` 或 `NOT_VERIFIED`，不改用搜索、相似主题或纯文本 `@name`。
- 用 App 内主题链接直达 `https://www.nodeseek.com/post-832584-1`，依次检查正文 `@lcy0828`、正文 `@xy`、回复 `@Tokin`，以及 `/space/1414` 的 `@男朋友`。每个 username 最多触发一次真实 resolver probe；`/space/1414` 必须零 resolver。不得连点、预取全文用户或用重复请求制造 429。
- 每次点击后 `com.wz.reader` 必须保持前台并进入 `user-screen-loaded`；不得启动 Chrome/Google。`@xy` 必须归一到 exact canonical 用户（UID `8052`），不能选择排在前面的模糊结果；Profile、主题/回复分页和可见关注目标只使用 canonical 数字 UID。解析中不显示关注；无匹配、非法响应、网络或 429 必须留在 App 并显示可刷新错误与显式“原站主页”，零自动重试、零自动外开。
- 每个 User 检查完成后使用 Android 物理返回，必须回到同一 Topic 并保持原回复位置，再检查下一个目标。全程只读，不切换关注、不执行任何真实写操作；Cloudflare checkbox 按全局自动恢复协议处理，成功后只恢复原 User Query。

### LIVE-READ-05 四站真实回复顺序

- 能力：`TOPIC-01/03/04`；共享 `NAV-02`、`NAV-03`、`NOTIFY-02`、`WRITE-01`。保留当前登录态；用户给出主题 URL 时先按来源和 id 直达该目标，否则从 `LIVE-READ-01` 已读结果复用或逐站最多检查前 5 个 Topic。四站都选择一个原站明确多页的主题；V2EX 优先选择原站明确超过 100 条且带同主题 `p=N` 链接的主题。没有合格目标的单站记 `NOT_VERIFIED`，不发送回复制造尾页。
- 每站先确认三种内容筛选位于左侧、当前正序位于右侧单选菜单，并记录头窗首条稳定楼层或评论身份；切换倒序时，部分集合必须先进入“正在读取最新回复”而不能瞬间显示旧头窗倒排。结算后首条必须与 App 内原站同类页面的最新回复一致；向下滚动一次只能追加相邻更早窗口，列表方向持续由新到旧。最后一个窗口结算后当次显示“已到最早回复”，继续触底不得新增请求；切回正序必须恢复原头窗和内容筛选/查找状态，正序尾端对应显示“已到最新回复”。离开并返回该 Topic 后恢复该 route 的顺序。
- NodeSeek 五页样本的脱敏 diagnostics 必须显示首次 resolved page 5、下一窗 4，不能出现为构造倒序而读取 2、3；linux.do 按真实 stream 实体连续；妖火必须以主题页 `reply` / `tofloor` 链接中的最大真实楼层定位最新 page 1，下一窗只读 page 2，正序则以 `tofloor=1` 定位最早页后只读 page - 1，不能把“更多回帖(N)”当总数。V2EX 首屏必须显示正文、可信总数和第一页评论，静置时最高可见楼保持在 `#100` 且零 Reply transport；向下滚动后才以显式 `p=2` cursor 追加到当次最高楼。倒序建立末页窗口并向下加载显式前页，未加载楼层使用一个 target Query；仅刷新评论只重建 start 窗口。即使公共主题/回复 API 缓存数量暂时不同也要保留 HTML 有效行。边缘窗口无法确认、解析为空、重复 cursor 或来源自身的计数竞态时，应保留已解析有效行、回复级错误和重试入口，不得退回第一页上限或显示整页窗口错误。
- 全程只读，不提交回复、编辑、删除、互动，不打开未读通知，不清 App 数据、Cookie 或登录态。每站分别报告 App 流程、外部数据和基础设施；CF 只阻塞对应来源。

### LIVE-READ-06 逻辑节点连续性与长图像素稳定

- 能力：`TOPIC-01/02/03`、`MORE-03`；共享 `NAV-02/03`。仅在 targeted 包含 `REG-TOPIC-084/085/086/087/088/089/090/094/097/123` 时执行；目标均使用 `exp+wz-android://open-topic?url=<encoded URL>` 直达，不经过搜索或相似帖子。
- NodeSeek 直达 `https://www.nodeseek.com/post-652056-1`：两张独立小表都铺满正文，表间有明确 `12dp` 间距，边框和长文字换行正确，页面纵向滚动不被横向容器截获。
- V2EX 直达 `https://www.v2ex.com/t/1233470`：只验收正文“时间 / 发生的事”两列表；表头出现一次，18 行按原站顺序完整显示。该样本按当前硬预算应保持一个 typed table row；滚动时列宽、hairline 和横向位置稳定，无重复边框、空带或行跳动。返回再进入、修改阅读字号和切换主题后仍正确。`https://www.v2ex.com/t/1233404` 只属于 `LIVE-READ-05` 评论分页，不得替代表格目标。
- linux.do 直达 `https://linux.do/t/topic/2556285`：通过“更多”进入原站对照第 9 层，确认 reply target 位于正文前，52 行代码完整有序且视觉上只有一个连续代码框。对代码执行慢速纯横拖、快速 fling、反向拖动及代码区域纵拖；横向位置必须稳定变化，纵拖只滚动主题且 x 不漂，静止长按仍可原生选择。停在“对比一下5.5”及各张长图进入/离开边界分别无触摸观察 60 秒，目标文字可见性转换必须为 0，普通 scroll settle 能结束；滚过主楼前三张长图和一张回复长图，已显示像素、比例和高度稳定，不出现“显示 → 空白 → 再显示”或请求波。滚离再返回、打开图片预览再返回后位置和高度保持；按要求 `adb am force-stop com.wz.reader` 后重启并重新进入，再重复第 9 层与长图边界核对。
- NodeSeek 直达 `https://www.nodeseek.com/post-812712-1`：逐个切换“💻基本信息 / 🎬IP质量 / 🌐网络质量 / 📍回程路由”，每个 Tab 的首末内容、ANSI 前景/背景色、图片与 report 外项目链接均存在；长图 Tab 首次显示后切到 code Tab，等待 viewability 结算但不滚动，再切回长图两轮，像素必须直接恢复且不得停在 `topic-image-idle`。在可见 terminal code 上录屏执行 `240px / 5s` 慢横拖、快速/反向/斜向/纵向拖动和途中加指；慢横拖必须移动代码且 UI hierarchy/逐帧画面均无放大镜、selection handles 或 `Copy / Share / Select all / Translate` ActionMode，纵拖只滚动主题，途中加指不继续改 x。静止长按作为正向控制必须出现原生选择，第一次 Back 只关闭选择并留在 Topic；干净横拖后第一次 Back 必须正常返回。复制得到当前完整 code owner，长行出现原生横向滚动条且切换/滚离/返回后 offset 与 active tab 不跳。组合评论查找把目标回复隐藏再恢复，并从详情内嵌套页面 Back，当前 route 的 active tab 必须保持；切到另一 Topic 后相同 semantic path 必须回到首 Tab。agent-device 的坐标 pan 只用于本监督式 Live，不保存为 tracked Replay；原站动态内容不匹配固定 fixture 时记录实际 tab/标题并记 `NOT_VERIFIED`，不得换相似帖子冒充。
- NodeSeek 直达 `https://www.nodeseek.com/post-863650-1`：确认海量图片正文仍按每 row `<=4` 的父 FlashList typed rows 有界挂载，可正常滚动和返回；同一 PID 连续两轮执行相同滚动后，warm `<=8`、running `<=4`、原图 `<=1`，mounted media 与 PSS 不得持续增长，不得出现 ANR、OOM、Fatal 或 PID 意外重启。
- `REG-TOPIC-120/122`：只读直达 `https://www.nodeseek.com/post-889473-1`，定位第 12 楼“哼”；在 header 可见、未滚动的冷折叠态只展开一次，图片必须自行显示。随后收起/重开，并在同页主楼、回复或展开引用中核对普通块图上下间距与相邻文字节奏没有被放大；动态内容已改变时分别记 `NOT_VERIFIED`，不换相似帖子。
- `REG-TOPIC-123`：只读直达 `https://www.nodeseek.com/post-890382-1`，按 blockquote → 重复分隔线 → 两个标题 → paragraph → 普通代码块的原始顺序核对主楼与评论；整篇只出现一次顶部文章边界，连续语义 row 间不得出现重复 hairline、`16dp` 内缩或虚拟列表空带。再只读直达 linux.do `https://linux.do/t/topic/2556285`、V2EX `https://www.v2ex.com/t/1233470`、妖火 `https://www.yaohuo.me/bbs-1570569.html`，确认四站主楼、评论与展开引用沿同一 prose theme 且原有表格、媒体和评论结构不变。NodeSeek 样本依次核对浅/深色、紧凑/标准/宽松行距及 `130%` 字号，记录初始设置并在结束前恢复；固定尺度由自动测试承担，不按截图反推 dp。
- `REG-TOPIC-121`：在 linux.do `t/topic/342888` 或同一场景的现存 inline 媒体上记录首次准入、短距离滚离/返回和跨 Tab/引用展开；普通 permit wave 不得让已见图片退回空白，旧事件不得造成错误成功/失败或 fatal。自然 error/retry 不出现时该设备分支记 `NOT_VERIFIED`，不得改 URL、清缓存或断网制造失败。
- 全程只读，不回复、不互动、不保存图片；每轮确认无 ANR、OOM、Fatal 或非预期 PID 重启，脱敏媒体诊断保持未完成 warm `<=8`、running `<=4`、原图 `<=1`。记录 mounted media 与 PSS，连续两轮相同滚动后不得持续增长。动态内容变化只影响数据轴；固定数量由自动测试承担，不创建依赖远端数量的 tracked Replay。

### LIVE-READ-08 千图预览 ready catalog 与点击延迟

- 能力：`TOPIC-02`；共享 `TOPIC-01/03`、`NAV-02/03`、`REG-PERF-010` 与 `REG-TOPIC-075/096`。仅在当前 revision、version/versionCode、APK SHA 与主 AVD 身份匹配时执行；用 `exp+wz-android://open-topic?url=https%3A%2F%2Fwww.nodeseek.com%2Fpost-863650-1` 直达，不搜索相似帖子。
- 等正文首图可点击后记录 PID 与起始 PSS，只点击首图，要求页码第一次出现即为完整 `1/1381`；记录 press 到 chrome/页码、当前图 displayed 的单调时间，分别要求 `<=500ms` 与 disk-cached `<=800ms`。用 Android Back 关闭后再打开三次，每次使用同一首图和同一 PID，不滚动正文、不翻页、不保存；动态实时数量与坐标动作不进入 tracked Replay。
- oracle：四次均无临时 `1/1`、两秒空档、ANR、OOM、Fatal、ResponseBody leak 或 PID 变化；关闭后回到同一正文位置。若动态帖子图片数不再是 1381，保留实际数量证据并记目标身份不匹配，不能把新数量冒充历史 `1/1381` 通过。
- 本路径只验证 catalog readiness 和点击/Modal 首帧，不执行 25/100 页遍历；因此不能把结果记为 `REG-TOPIC-075` 的完整 PSS/Native Heap `LIVE_PASS`。若 ready catalog 后仍超过 500ms，转查 `bodyMediaPaused`、Native Modal 和 React commit，不恢复 HTML parser/cache/预热补丁。

## 账号、验证与签到

### LIVE-ACCOUNT-01 三站账号状态

- 能力：`ACCOUNT-01`、`ACCOUNT-02`、`SEARCH-04`。
- 从更多 → 账号中心刷新三个可登录来源状态；NodeSeek、linux.do、妖火登录或验证页只能从 App 内打开。
- 真实登录及确认由用户亲自操作；Agent 不读取、输入或截图账号凭据。回到 App 后核对账号身份，重启 App 再核对授权保持；取消、拒绝或过期必须返回明确状态。
- oracle：登录、匿名、验证中、授权中、失效和失败不混淆；返回后账号中心仍可操作。三站不得用桌面浏览器状态代替。
- 同轮若 Topic、Feed、Search 或 User 自然触发 linux.do Cloudflare，验证面板必须保持到 WebView 挂载并按全局 checkbox 协议完成 canonical 检查，随后只恢复原 Query 一次；后台 More 重渲染不得关闭它。没有自然 challenge 时本项记 `NOT_VERIFIED`，不得清 Cookie、退出账号或人为制造。

### LIVE-ACCOUNT-02 凭据与用户身份认证

- 能力：`ACCOUNT-03`、`ACCOUNT-05`。
- 只验证可信登录 URL 上的填入入口、认证取消和提示；不读取、不截图、不报告密码，也不自动提交登录表单。
- oracle：取消认证不损坏保存状态；不支持认证时必须出现明确降级确认。

### LIVE-ACCOUNT-03 NodeSeek 签到与站点服务

- 能力：`ACCOUNT-04`。
- 记录签到前按钮/状态后点击一次；立即捕获“签到成功”或“今天已签到”等快速提示，再关闭并重新进入 NodeSeek 服务区。
- oracle：瞬时提示和重新进入后的稳定已签到状态至少有一个可观察证据；结果不明确不得再次点击。
- linux.do 等级和 NodeImage 只验证当前 App 登录态可见数据与入口，不伪造授权成功。

### LIVE-ACCOUNT-04 linux.do 等级动态读取

- 能力：`ACCOUNT-04`。
- 仅在账号中心已确认 linux.do 登录时执行：从可确认的更多页根状态进入账号中心 → linux.do，点击“查看等级”一次，等待等级进度与活跃数据，或明确错误和“刷新等级”。不得读取浏览器 Cookie。
- 分两轴判定。应用流程：数据显示，或错误明确可见、提供“刷新等级”、无自动请求突发且不阻断其他 More 入口，均记 `LIVE_PASS`；永久 Loading、错误不可见、无恢复入口、旧数据误报成功或串扰兄弟旅程才是明确失败。数据读取：当前用户名、等级与至少一项活跃数据出现时记 `LIVE_PASS`，不固定动态数值。
- 首次错误时保存不含凭据的可见错误和脱敏诊断。明确限流时，应用流程仍可 `LIVE_PASS`，外部数据记 `BLOCKED_BY_ENV`。只有错误明确给出可执行的限流/冷却时间（时长或截止时刻）时，才换算并等待至窗口结束再加 2 秒，然后点击一次“刷新等级”；不得靠固定 sleep、连续点击或重跑整套 Replay 制造额外请求。
- 单次复试成功将数据读取记 `LIVE_PASS`，并注明首次瞬态失败和复试次数；再次明确限流保持数据读取 `BLOCKED_BY_ENV`。其他错误不猜测为限流：有诊断证据证明外部故障时数据读取记 `BLOCKED_BY_ENV`，证据不足记 `NOT_VERIFIED`；若证据指向 App 的请求构造、凭据路由、鉴权头或解析契约，数据读取记明确失败，即使应用错误流程可记 `LIVE_PASS`；若 App 没有按错误 UI 契约结算，则应用流程也明确失败。不继续重试。

## 本机与系统能力

### LIVE-LOCAL-01 收藏、关注与历史

- 能力：`FEED-03`、`USER-02`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`。
- 选择可重新找到的对象，记录初始收藏/关注状态，切换一次并在 Library/User 验证，然后恢复初始状态并重新进入确认。
- 历史只验证读取和返回；删除及清空不执行。

### LIVE-LOCAL-02 图片保存与备份

- 能力：`TOPIC-02`、`DATA-03`、`MORE-02`。
- 保存一张可识别图片并确认系统结果；备份执行本地导出、取消分享、选择受控备份导入并核对结果。
- oracle：失败有明确提示；取消不改变数据；Cookie、密码、token 和代理不出现在备份。备份不得上传云端。

### LIVE-LOCAL-03 代理与外观

- 能力：`MORE-01`、`MORE-03`。
- 记录代理启用状态和全部外观值；只使用已有配置进行延迟/读取验证，逐项改变一个外观值后检查 Feed/Topic，再恢复全部初始值。
- oracle：代理失败不能静默直连；恢复后重新进入显示原设置。报告不得包含代理地址或凭据。

### LIVE-LOCAL-04 内容源管理往返

- 能力：`MORE-05`；共享 `FEED-01/02/04`、`SEARCH-01..04`、`LIBRARY-01..03`、`ACCOUNT-01/02`、`NOTIFY-01..03`、`NAV-01/02`、`DATA-01..03`。
- 先只读记录 `firstInstallTime`、四站精确顺序与开关状态，以及 Feed、Search、Library、Account、Notifications 当前投影。选择相邻两站，用排序手柄完成一次语义化长按拖拽；按各入口支持的来源子集核对相对顺序后立即做反向拖拽，并重新进入 More 确认恢复。普通滚动和开关不得触发排序。
- 重排前先在 Feed 选中一个非 `全部` 来源；重排后返回 Feed，必须按最新顺序从 `全部` 开始，并最终显示列表或明确错误，不能永久 Loading。反向重排后再验证一次回到 `全部`。拖动同时覆盖慢速跟随、快速跨槽、首尾边界和取消；活动行应跟手，兄弟行只在跨槽时预览。另以 raw 高质量录屏逐帧检查抬手窗口，拖动态到最终顺序之间不得回弹、重叠、闪空白或重复文字。
- `REG-MORE-004` 只在独立验证 AVD 执行：记录原顺序并开启 TalkBack，重排后用读屏焦点逐项记录来源与“第 N 项”，遍历必须与视觉顺序一致；再执行手柄上移/下移，焦点连续且只持久化一次。关闭 TalkBack并重启 App 后，普通视觉模式再做一次正反拖动。最终恢复原顺序；主 AVD 的 TalkBack/无障碍设置不得改变。ADB Tab/UI hierarchy 可证明 traversal 与 Native order，不能冒充真实用户主观语音体验。
- 记录妖火初始状态；若初始停用，先启用并等待一次账号结算作为前置。随后只停用一次，重启并做一次前后台往返；Feed、Search、Library、Account、Notifications 不得再显示妖火，旧 Topic/User/Notification 入口必须 fail-closed 到明确管理或错误状态。只有当前会话确实捕获到 host 级请求时才判定妖火请求为零；没有网络事件的日志不能冒充零请求，网络轴记 `NOT_VERIFIED`，由既有 Gateway、Query、Account 和 worker 确定性测试承担自动 oracle。
- 最后恢复妖火原始开关和四站原始顺序，重启后逐项复读，并确认 `firstInstallTime` 未变化。任一恢复步骤失败立即停止后续 App/AVD 变更并报告残留；不得卸载、清数据、清 Cookie、退出账号或用默认顺序覆盖用户设置。
- oracle：排序和开关持久化，五入口投影一致，恢复后与初始记录逐项相同。应用流程、网络轴和恢复结果分别报告，不得用 UI 隐藏推断零请求。

## 站点互动与上传

### LIVE-WRITE-01 NodeSeek 互动

- 能力：`WRITE-03`。
- 在权限明确的 Topic 上分别验证点赞、鸡腿、原站收藏或投票；“反对”始终不操作。
- 可逆互动记录初始状态并恢复。已投投票只读核对准确所选项、动态计数、禁用状态、卡片位于原始正文标记位置且正文底部没有重复卡片，并确认原始标记已消失；绝不再次提交。
- 未投投票先记录准确选项和未投状态，点击提交后必须出现“提交后不可修改”确认；非写入验收只取消并确认选项保留。真正提交前重新按该主题和准确选项逐次授权，确认后只提交一次；结果不明确不得重试。
- 提交成功后刷新/重进 App 核对已投、所选项和服务端计数，再从 App 内 NodeSeek 原站同类页面核对。若 App 提示“提交成功但结果刷新失败”，记录 `partial` 证据并停止，不得再次投票；搜索只用于没有目标或另找未投只读样本。

### LIVE-WRITE-02 linux.do 互动与投票

- 能力：`WRITE-03`。
- 点赞和书签按初始状态恢复。投票目标按“投票”搜索规则找到，记录参与人数、各选项票数和所选项后只提交一次。
- oracle：刷新或重新进入后仍显示已投和所选项；参与人数及选项票数的变化必须与原站结果一致。参与人数未随首次投票更新时记录 `REG-WRITE-001` 失败证据，不重投。

### LIVE-WRITE-03 妖火收藏与投票

- 能力：`WRITE-03`。
- 只在入口、全局保存的登录态和目标均明确时操作；收藏操作不得为每次请求重新读取 WebView Cookie。先记录目标初始收藏状态，每一步只点击一次，最后恢复初始状态。
- 已收藏目标：在 App 点击“取消原站收藏”后，按钮必须恢复未选中样式，重新进入仍为未收藏，并在 App 内妖火原站“我的收藏”按同一标题或主题 id 确认消失；随后重新收藏，按钮必须立即变为黄色选中并显示“取消原站收藏”，重新进入和原站收藏夹均恢复。未收藏目标按相反顺序验收。
- 请求期间页面其余内容、滚动位置和其他操作按钮不得整体变灰或跳动；确认后只更新收藏按钮。必须在收藏按钮、正文图片和回复区同时可见的位置，以 30 fps 录制从点击前静置到确认后至少 1 秒的过程，并逐帧检查正文未切换楼层、图片未退回灰色 loading 占位、页面未出现大面积明暗跳变；单张操作前后截图不能替代该 oracle。收藏与取消两个方向都要覆盖。只看到客户端提示不能计为通过；按钮状态、重新进入状态和原站收藏夹三者必须一致，固定回归见 `REG-WRITE-002`、`REG-WRITE-003`、`REG-WRITE-004`、`REG-WRITE-005`。
- 投票或收藏若被访问验证阻断、服务端状态未变化或返回含义不明确，记 `BLOCKED_BY_ENV`、明确失败或 `NOT_VERIFIED`，不能推断成功或重复提交。

### LIVE-WRITE-05 三站图片上传草稿

- 能力：`WRITE-01`、`WRITE-04`。
- NodeSeek、linux.do、妖火各选择一张测试图片并上传到回复草稿，只验证 Markdown/UBB 已插入和预览/提示正确。
- 随后清空草稿并关闭编辑器，绝不发送。若远端产生无法删除的孤立文件，记录残留和来源，不再次上传。

## 报告与门禁

报告按能力 ID 和来源列出 Profile、场景、App flow status、external data status、基础设施状态、用户可见 oracle、证据位置、恢复结果和残留。确认的功能失败始终阻断；受影响能力为 `BLOCKED_BY_ENV` 或 `NOT_VERIFIED` 时阻断，未受影响能力只报告风险。

只有场景不再需要动态目标、模型判断或人工动作，并且能够可靠恢复时，才把它迁入 `tests/device/`；否则继续保留在本文件，不增加自定义 runner 或 DSL。
