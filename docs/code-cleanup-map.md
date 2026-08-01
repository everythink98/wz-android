# 用户旅程技术债务清单

## 使用方式

本清单只记录会影响真实用户旅程的未完成债务，不按文件夹或代码行数安排清理。每次开发触及某条旅程时，选择能够独立验证、独立回滚的最小一项一起收口；代码 ownership 与拆分规则统一见 `docs/code-standards.md`，没有行为证据时不拆散现有 cohesive owner。

| 优先级 | 用户旅程 | 债务与当前证据 | 必须保留 | 验收 | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| P0 | 登录失效 → 恢复阅读或互动 | 首页、搜索、主题、回复和用户资料读取已由 managed gateway 内聚 Cookie、User-Agent、WebView fallback、凭据 generation 和妖火失效清理；剩余债务集中在账号状态检查和写操作仍由各自 controller / action client 组装来源细节 | 已有登录态、Cloudflare 验证、普通请求优先与 WebView fallback、代理 fail-closed | 四个可登录来源分别覆盖各自适用的有效、失效、验证或授权中状态和普通网络错误；失效后能从 App 内入口恢复，其他来源不受影响 | 保持 managed read interface 稳定；每次只收口一个账号状态或写入路径，失败时恢复该路径原调用，不改安全存储键或 Cookie 格式 |
| P0 | 写操作 → 成功或状态回滚 | 来源静态 capability、原站解析出的对象权限和 UI 操作状态尚未形成单一判定链，容易出现“来源支持但当前对象不允许”的入口 | 原站明确权限、确认步骤、防重复提交、失败后草稿与计数恢复 | 未登录或缺少真实 token/id/link 时不发送；成功不重复计数；失败后草稿可编辑、乐观状态回滚 | 以单项 action 为提交和回滚单位；保留原请求格式，不改变 Cookie、token 或备份结构 |

## 清理约束

- `src/sources/readGateway.ts` 是统一读取 seam，新读取调用方不得绕过它；写操作目前按 capability 由 `src/features/topic/actions/useTopicActionsController.ts` 调用各站 action client，并在触及具体路径时逐项收口。
- `App.tsx` 是真实 Expo bootstrap；内部模块移动时一次性更新调用方，不保留旧路径 re-export 或纯转发 facade。
- `android/` 是生成目录，不把生成结果当长期配置，也不把删除生成目录算作产品债务完成。
- 每项债务完成时，在对应测试和真实旅程验收通过后从本清单删除；未完成部分应缩小描述，不能改名后继续悬空。
