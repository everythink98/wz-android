# 交接说明

## 先建立共同上下文

1. 阅读 `AGENTS.md` 和 `README.md`，确认仓库规则、产品范围与开发入口。
2. 阅读 `docs/product-charter.md`，确认目标用户、核心旅程、非目标和功能准入标准。
3. 阅读 `docs/product-map.md`，按稳定能力 ID 了解完整功能、用户入口、代码入口和回归范围。
4. 阅读 `docs/regression-corpus.md`，确认触及的共享 seam 是否已有逃逸事故和强制 oracle。
5. 阅读 `docs/code-standards.md`、`docs/architecture.md` 与 `docs/operator-runbook.md`，确认 ownership、module seam、数据边界和操作命令。
6. 阅读 `docs/testing-standard.md`，按能力 ID 选择验证；需要模拟器时只读取与当前 Git revision、版本和 APK 身份匹配的本机 `docs/emulator-baseline.md`。
7. 本机存在 `memory/MEMORY.md` 时，按索引读取与任务相关的已确认事实；它只是补充，不能覆盖用户最新要求、当前代码或运行结果。
8. 运行 `npm install` 和 `npm run verify`；需要真实设备时再按能力 ID 运行 Replay 与 `tests/live/agent-live.md`。

## 事实源边界

| 内容 | 事实源 |
| --- | --- |
| 品牌、视觉和 accessibility 约束 | `PRODUCT.md` |
| 产品取舍与新功能准入 | `docs/product-charter.md` |
| 现有功能、用户入口、能力 ID 和共享回归范围 | `docs/product-map.md` |
| 历史逃逸问题、精确 oracle 和最低可靠测试层 | `docs/regression-corpus.md` |
| 代码 ownership、import、测试归属和质量门禁 | `docs/code-standards.md` |
| 当前 module、interface、数据和原生配置边界 | `docs/architecture.md` |
| 自动测试、模拟器与真实写操作规则 | `docs/testing-standard.md` |
| 构建、签名、发布与设备 smoke 操作 | `docs/operator-runbook.md` |
| 待处理技术债务 | `docs/code-cleanup-map.md` |
| 当前版本与可运行事实 | 代码、配置和实际运行结果 |
| 本机补充事实、模拟器与原站取证事实 | `memory/` 与 `docs/emulator-baseline.md`，均不进入 Git |

文档或记忆与用户要求、代码或运行结果冲突时，以对应的最新事实为准，并在交付中指出差异。模拟器记录只有在 Git revision、App 版本和 APK 身份与当前对象匹配时才能作为基线；不要把版本号、Release hash 或登录状态复制到稳定文档中长期维护。

## 周期性文档与记忆维护

- 开始时记录 Git revision 与 dirty 状态，用 `git ls-files -- '*.md'` 枚举 tracked Markdown；再从 `memory/MEMORY.md` 索引读取相关本机记忆，并单独检查 ignored 的 `docs/emulator-baseline.md`。不能只审查本轮碰巧打开的文件。
- 每项事实只在上表指定的唯一事实源写完整版本；README、交接和其他消费者只保留读者需要的摘要与链接。发现重复定义时删除副本，不建立双向同步清单。
- 逐项用用户最新要求、当前代码、配置和匹配身份的运行结果核对。已失效内容直接删除或替换，不在旧说法后追加“更新说明”留下冲突；证据不足时记录缺口，不把推测升级为事实。
- `memory/MEMORY.md` 只做索引；`memory/project.md` 只保留跨任务稳定的本机事实与 tracked 文档入口；专项记忆保存不可从仓库直接恢复的取证结论。版本号、timeout、完整能力清单、事故 oracle 和可由代码读出的 schema 不复制进 memory。
- `docs/emulator-baseline.md` 的历史记录保留；顶部索引只认同时匹配 revision、App 版本和 APK 身份的结果。没有匹配记录就明确写“无当前基线”，不得按日期借用旧结论。
- 收口时检查事实源及其摘要消费者，删除过时草稿和本轮临时产物，然后运行 `npm run test:docs`、`npm run check:docs` 与 `git diff --check`。只有运行时文件发生变化才扩大到对应代码验证；不为周期维护引入更新时间机器人或新文档 schema。

## 当前不可破坏边界

- App 支持 NodeSeek、linux.do、V2EX、妖火和小隐寺；五站共享阅读主干，互动能力按原站真实支持范围提供。
- App 的读取 controller 统一经 `src/sources/readGateway.ts` 进入来源层；写操作目前由 `src/features/topic/actions/useTopicActionsController.ts` 按 capability 调用各站 action client。
- NodeSeek、linux.do、妖火 Cookie 只由网站 WebView 与 Android `CookieManager` 持有；小隐寺 User API Key / Client ID、保存的账号密码和服务器代理配置使用 SecureStore；小隐寺 RSA 私钥只存在 Android Keystore。以上敏感材料都不进入备份 JSON，代理启用失败不能静默直连。
- `App.tsx` 是真实 Expo bootstrap。
- `android/` 是生成目录；长期原生配置只改 `app.json` 与 `plugins/`。
- 模拟器验收不得卸载 App、清 App 数据、Cookie 或登录态；默认覆盖安装并 force-stop 后重启。
- 未经明确授权，不执行真实回复、编辑、删除、上传、点赞、投票或收藏切换。

## 按旅程定位

- 先在 `docs/product-map.md` 选择受影响能力 ID；如果触及共享 seam，按地图展开关联能力，不能只回归最初入口。
- 启动、首页、搜索：`src/app/AppRoot.tsx`、`src/features/feed/`、`src/features/search/`、`src/domain/forum/feed.ts` 与 `src/domain/forum/feedOptions.ts`。
- 来源读取：`src/sources/readGateway.ts` 及其后的读取实现；互动写入：`src/features/topic/actions/useTopicActionsController.ts` 及各站 action client。
- 详情与返回：`src/features/topic/useTopicController.ts`、`src/features/topic/model/sessionState.ts`、`src/features/topic/TopicScreen.tsx` 与 `src/features/topic/`。
- 账号与登录恢复：原三站使用账号/session controller、Cookie bridge 与 App 内 WebView；小隐寺使用独立 Device Code controller 与 Android Keystore，系统浏览器仅承载一次性授权页，不属于 App 会话。
- 本机资料与备份：reader data、backup module 与相关 controller。
- 发布：`scripts/release-android.mjs`、`scripts/check-version.mjs` 和 `scripts/smoke-android.mjs`。

开始清理或重构前，先在 [用户旅程技术债务清单](code-cleanup-map.md) 中确认影响旅程、必须保留的能力、验收和回滚点。
