# AGENTS.md

## 任务与授权

- 用户使用中文时全程使用中文；最终回复以结论、实际改动、原因和验证结果为主。
- 最新明确用户目标优先。只有歧义会实质改变范围、行为、安全或产生不可逆后果时才询问；否则说明合理假设后继续。
- 本次改动造成的失败、以及完成本次目标所必需的测试或文档问题，属于本次修复范围；计划外既有产品 Bug 只记录已确认事实、影响与证据缺口，未经用户授权不修改产品行为。
- 测试、诊断和只读验收不授权远端写入、产品降级、扩大功能范围或清理用户状态。发现能力缺失或真实链路与测试不一致时，先按 Bug 报告。
- 采用满足目标的最小完整改动；用户指定方案明显增加复杂度或脆弱性时说明代价并给出更简单方案，不擅自降低明确目标。

## 事实源路由

- 项目背景读 `README.md`，交接边界读 `docs/handoff.md`，结构与数据边界读 `docs/architecture.md`。
- 当前产品行为、入口、共享 seam 与 canonical evidence 只以 `docs/product-map.md` 为准；历史事故只以 `docs/regression-corpus.md` 为准。
- 测试 owner、证据层、隔离和验证强度读 `docs/testing-standard.md`；代码 ownership、测试归属、命名和结构门禁读 `docs/code-standards.md`。
- 命令、覆盖安装、Replay、Smoke、工具版本和正式发布步骤只以 `package.json` 与 `docs/operator-runbook.md` 为准。
- 已确认本机事实先读 `memory/MEMORY.md` 的索引，再按需读 `memory/project.md`；memory 只作短指针，不复制项目政策。
- 冲突时按“用户最新要求 → 当前代码与运行事实 → 对应唯一权威文档”裁决，并同步修正失真的文档或记忆指针。

## 实施工作流

- 修改前记录 Git revision 与 dirty 状态，沿真实依赖关系枚举直接调用方、间接消费者、共享状态、配置和行为入口；保留工作区已有用户改动。
- 产品或 runtime 改动必须从 product map 选择受影响 capability ID，并展开共享 seam；纯测试、文档或治理改动记录受影响的 evidence owner，不虚构产品 ID。
- 修复产品 Bug 时先建立修复前会失败的最低可靠行为 oracle，再修根因并合并重复 owner；通过测试使用行为标题，不携带 REG。只有确认未修复的 expected-failure 可引用一个状态为 `OPEN` 的 canonical REG。
- 新的逃逸事故在获准修复时保留历史条目，但历史与测试不一一绑定：多个 REG 可以指向同一个 canonical owner，过时 owner 可合并、替换或删除。
- 查找优先使用 `rg`；第三方行为不确定时先查官方资料，官方证据不足再查 GitHub issue/discussion 或成熟项目。已知 GitHub 对象优先直达连接工具或 `gh`，不把 URL 当搜索词。
- 只改任务直接相关内容，不顺手重构、格式化、改名或修复无关问题；`android/` 是生成目录，长期原生配置只改 `app.json`、`plugins/` 或对应 source patch。

## 安全硬边界

- 未经明确要求，不执行破坏性 Git 操作，不提交、合并、push、发布，也不覆盖或删除用户工作区残留。
- 不输出或提交 Cookie、token、密码、keystore、`.env.release.local`、数据库、截图、日志、临时 bundle、生成目录或 release 产物。
- 保留数据的 Android 设备只能覆盖安装；不得卸载 App、清 App 数据、Cookie、登录态或重置模拟器。安装身份、`firstInstallTime` 或登录态异常时立即冻结设备变更并按 runbook 只读取证，不能自动降级为卸载或快照恢复。
- 全面测试默认不授权发帖、回复、编辑、删除、点赞、投票、收藏切换或其他真实写操作；Live 写入必须逐项取得用户明确同意。
- Android WebView 的 Cookie、WebStorage 与全局 cache 是进程共享资产；只有 Account 用户明确发起的按站清除事务拥有删除权，功能 WebView 不得做进程级清理。具体禁用 API 与静态门禁由 code standards/architecture checker 维护。
- 启动长驻进程前记录本机与设备进程基线；结束时只清理由本任务创建且能确认归属的进程与 scratch，不停止共享 MCP、模拟器、ADB 或未知进程。

## 验证与交付

- 验证强度按行为风险选择，并按每类受影响入口独立报告；局部单测、静态检查或 App 启动不能代表完整链路。
- 纯文档/注释改动只做内容、引用与一致性检查；运行逻辑、类型或构建改动至少运行相关测试和 `npm run typecheck`。页面流程、登录态或真实来源按 testing standard/runbook 做对应模拟器或 Live 验收。
- `npm test`、`npm run test:ui` 和 `npm run verify` 的当前组合以 `package.json` 为准，测试随机顺序是正常门禁；失败必须能用输出 seed 重放。
- `npm run release:android` 只在用户明确要求正式发布时运行。版本、签名或原生配置的普通开发改动使用相关 tooling test、fresh prebuild/compile 或 targeted build，不以要求 clean tree 的正式 release 代替开发验证。
- 交付按 capability ID 或 evidence owner 报告实际运行的 `STATIC_PASS`、`UNIT_PASS`、`UI_PASS`、`DEVICE_REPLAY_PASS`、`LIVE_PASS`、`APK_SANITY`、`NOT_VERIFIED` 或 `BLOCKED_BY_ENV`，并列出未验证范围。
- 最终回复前运行相关门禁、`git diff --check`，确认本任务进程回到基线；无法安全验证时报告已确认事实、尝试、阻碍与剩余选择，不用笼统绿灯掩盖证据缺口。
