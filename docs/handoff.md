# 交接说明

## 先建立共同上下文

1. 阅读 `AGENTS.md` 和 `README.md`，确认仓库规则、产品范围与开发入口。
2. 阅读 `docs/product-charter.md`，确认目标用户、核心旅程、非目标和功能准入标准。
3. 阅读 `docs/architecture.md` 与 `docs/operator-runbook.md`，确认 module seam、数据边界和操作命令。
4. 阅读 `docs/testing-standard.md`，按改动旅程选择验证；需要模拟器时再读本机的 `docs/emulator-baseline.md`。
5. 本机存在 `memory/MEMORY.md` 时，按索引读取与任务相关的已确认事实；它不是仓库内共享规范，不能覆盖用户最新要求或当前代码。
6. 运行 `npm install`、`npm test`、`npm run typecheck`、`npm run check:unused` 和 `node scripts/check-docs.mjs`。

## 事实源边界

| 内容 | 事实源 |
| --- | --- |
| 产品取舍与新功能准入 | `docs/product-charter.md` |
| 当前 module、interface、数据和原生配置边界 | `docs/architecture.md` |
| 自动测试、模拟器与真实写操作规则 | `docs/testing-standard.md` |
| 构建、签名、发布与设备 smoke 操作 | `docs/operator-runbook.md` |
| 待处理技术债务 | `docs/code-cleanup-map.md` |
| 当前版本与可运行事实 | 代码、配置和实际运行结果 |
| 本机账号、模拟器与原站取证事实 | `memory/` 与 `docs/emulator-baseline.md`，均不进入 Git |

文档或记忆与用户要求、代码或运行结果冲突时，以对应的最新事实为准，并在交付中指出差异。不要把版本号、Release hash 或登录状态复制到稳定文档中长期维护。

## 当前不可破坏边界

- App 支持 NodeSeek、linux.do、V2EX 和妖火；四站共享阅读主干，互动能力按原站真实支持范围提供。
- App 的读取 controller 统一经 `src/sources/sourceGateway.ts` 进入来源层；写操作目前由 `src/app/useTopicActionsController.ts` 按 capability 调用各站 action client。
- Cookie 和服务器代理配置只保存在 Android 本机安全存储，不进入备份 JSON；代理启用失败不能静默直连。
- `App.tsx`、`src/theme.ts` 和 `src/screens/TopicScreen.tsx` 是稳定入口或兼容 facade。
- `android/` 是生成目录；长期原生配置只改 `app.json` 与 `plugins/`。
- 模拟器验收不得卸载 App、清 App 数据、Cookie 或登录态；默认覆盖安装并 force-stop 后重启。
- 未经明确授权，不执行真实回复、编辑、删除、上传、点赞、投票或收藏切换。

## 按旅程定位

- 启动、首页、搜索：`src/app/AppRoot.tsx`、对应 controller、`src/feedLogic.ts` 与 `src/feedCategoryRail.ts`。
- 来源读取：`src/sources/sourceGateway.ts` 及其后的读取实现；互动写入：`src/app/useTopicActionsController.ts` 及各站 action client。
- 详情与返回：Topic controller、`src/topicSessionState.ts`、`src/screens/TopicScreen.tsx` 与 `src/screens/topic/`。
- 账号与登录恢复：账号/session controller、站点 Cookie bridge 与 App 内 WebView 流程。
- 本机资料与备份：reader data、backup module 与相关 controller。
- 发布：`scripts/release-android.mjs`、`scripts/check-version.mjs` 和 `scripts/smoke-android.mjs`。

开始清理或重构前，先在 [用户旅程技术债务清单](code-cleanup-map.md) 中确认影响旅程、必须保留的能力、验收和回滚点。
