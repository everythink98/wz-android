# 代码与项目结构规范

## 适用范围

本文是仓库内代码组织、import、测试归属和质量门禁的唯一规范。产品范围见 `docs/product-map.md`，运行架构见 `docs/architecture.md`，验收证据见 `docs/testing-standard.md`；其他文档只链接本文，不复制规则。

外部项目仅用于校准取舍，不作为可直接套用的模板：Obytes 的 [feature ownership](https://github.com/obytes/react-native-template-obytes/blob/master/docs/src/content/docs/getting-started/project-structure.mdx)、Bluesky 的 [源码布局](https://github.com/bluesky-social/social-app/tree/main/src)，以及 Expo 官方的 [TypeScript 路径别名](https://docs.expo.dev/guides/typescript/) 与 [ESLint/Prettier](https://docs.expo.dev/guides/using-eslint/)。仓库当前代码和本规范始终优先。

## Ownership 目录

`src/` 根目录不得放源码文件，也不得新增下列六类以外的一级目录：

| 路径 | 唯一职责 |
| --- | --- |
| `src/app/` | Expo bootstrap 之后的声明式组合链、导航命令和无条件挂载的 App 级 runtime 投影；全局 host 仍放在真实 feature owner |
| `src/domain/` | 无 React、无 I/O 的 Forum、ReaderData、Session canonical model 与确定性规则 |
| `src/features/` | `feed`、`search`、`topic`、`user`、`library`、`account`、`more`、`notifications` 用户旅程的 controller、screen、局部组件和样式 |
| `src/sources/` | 统一读取 gateway、聚合读取、共享协议与各站独立 parser/reader/account/action adapter |
| `src/platform/` | Query、网络、存储、诊断、媒体、更新和 Android bridge |
| `src/ui/` | 跨旅程复用的 UI primitive、TopicCard、Avatar、导航控件和主题 token |

仓库根 `App.tsx` 是真实 Expo bootstrap，保留 `QueryClientProvider` 与 `AppRoot` 装配；它不是内部兼容壳。

## Import 与依赖方向

- 跨模块 import 使用 `@/* -> src/*`；同一 feature、provider 或基础模块内部使用相对路径。
- 允许方向如下；未列出的方向全部禁止：

| 调用方 | 可依赖 |
| --- | --- |
| `domain` | `domain` |
| `platform` | `domain`、`platform` |
| `sources` | `domain`、`platform`、`sources` |
| `ui` | `domain`、`platform`、`ui` |
| `features/<name>` | `domain`、`platform`、`sources`、`ui`、同一个 `features/<name>` |
| `app` | 六类模块 |

- feature 不得反向依赖 app，也不得跨 feature 直接调用；共享语义下沉到 domain/platform/ui，共享来源能力留在 sources。
- source 不得依赖 UI 或 feature。具体 provider 不得横向依赖另一个 provider；`src/sources/feedRead.ts`、`src/sources/searchRead.ts`、`src/sources/sourceRead.ts`、`src/sources/discourseRead.ts`、`src/sources/discourseActions.ts`、`src/sources/readGateway.ts`、`src/sources/discourseNotifications.ts`、`src/sources/notificationAdapter.ts`、`src/sources/notificationAdapters.ts`、`src/sources/notificationForegroundAccess.ts`、`src/sources/notificationBackgroundAccess.ts` 与 `src/sources/notificationGateway.ts` 是允许组合多个 adapter 的来源根模块。
- `src/sources/readGateway.ts` 是论坛读取统一入口，`src/sources/notificationGateway.ts` 是消息读取与已读协议的独立统一入口。写操作继续复用现有 action client；不为目录整洁另造 service、factory 或 provider registry。
- 禁止新增 barrel `index.ts`、旧内部路径 re-export 和纯转发 facade。移动内部模块时一次性更新调用方、测试与文档。
- App 组合链固定为 `AppRoot → AppComposition → AppRoutes → AppNavigator`：`AppRoot` 只能依赖 `AppComposition`；`useAppRuntime` 只能组合深 runtime、用 `useMemo` 投影 route capability，不得持有 `useState/useRef/useEffect/useCallback` 或导入 Screen/component；`AppComposition` 只依赖深 runtime、全局 provider 与 `AppRoutes`；`AppRoutes` 只映射七个 feature route entry；`AppNavigator` 不得依赖 feature。
- Feed、Search、Library、More tab 长期挂载但以 `active` 控制 Query 和副作用；Topic/User 的 controller、list ref、草稿、筛选和滚动状态归各自 native route。禁止恢复 Topic presentation cache、route snapshot、手工 back stack、全局 openTopic/openUser ref 或 deferred navigation registry。

## 模块与文件拆分

- 按 owner 和独立变化原因拆分，不按行数拆分。一个复杂 hook 若仍是唯一生命周期 owner，就保留 cohesive module。
- Screen 只拥有渲染与局部交互；远端状态、取消、草稿、返回栈、身份 epoch 等状态继续由现有 controller 或 Query owner 管理。
- Runtime 跨 owner 只暴露按旅程分组的语义能力。Account 的公开接口固定为 `read`、`write`、`center`、`hosts`；`hosts` 只提供 Account 自己生成的 host 节点、surface 状态和语义命令，不得泄漏 raw session、setter、ref、WebView controller 或 registry。Route runtime 不得用 `ComponentProps<typeof Screen>` 反向复制 Screen props。
- Android WebView 共享状态由 Account 单一 owner 管理：功能组件只能显式传入文档级 WebView props，不得用 props spread 暴露原生组件能力；truthy/dynamic `incognito`、`removeAllCookies`、`removeSessionCookies`、`WebStorage.deleteAllData` 与 `clearCache(true)` 在生产 TypeScript 和 tracked plugin 中一律由 `global-webview-state-owner` 拒绝。显式 `incognito={false}` 与实例级 `clearCache(false)` 允许；`sharedCookiesEnabled={false}` 不承担 Android 隔离语义。
- 可复用必须以语义、生命周期、权限和错误处理一致为前提。只相似但行为不同的 provider、feature 和写操作保持独立。
- 样式跟随 owner：feature 样式位于对应 feature，跨旅程 token/primitive 位于 UI；`ReaderStyleContextValue` 只提供 `theme/settings`，控件和 feature 用自己的 style factory 消费，禁止恢复全局 feature-style registry。
- 不增加未要求的扩展点、配置层或单实现 interface。新增抽象必须减少现有重复或切断真实反向依赖。

## 测试归属

- 确定性单元测试与实现同目录，使用 Vitest。
- 跨模块安全、数据与行为契约放在 `tests/integration/`。
- 脚本、plugin、release 和构建门禁测试放在 `tests/tooling/`。
- React Native 用户可见行为按能力族放在 `tests/ui/<family>/`；共享 fixture 只保留在 `tests/ui/` 根目录。
- 通过测试使用当前行为标题，不包含 REG ID；同一行为只保留 `docs/testing-standard.md` 定义的最低可靠 canonical owner。Replay、Agent Live 和证据状态同样遵循该标准。

## 格式与质量门禁

- TypeScript/JavaScript 使用单引号、分号、无尾逗号和 120 列；全部受管文本使用 LF，JSON/YAML 遵循 Prettier 的合法语法。Markdown、`package-lock.json`、生成目录与产物不做批量格式化。
- 具体质量命令和组合只以 `package.json` 为准；验证强度按 `docs/testing-standard.md` 选择，不在本文复制 script 字符串。
- `npm run verify` 是最终随机顺序质量门禁；Vitest/Jest 失败必须保留并重放输出 seed。
- `scripts/check-architecture.mjs` 使用仓库已安装的 TypeScript AST 检查六类根目录、依赖矩阵、跨 feature/provider、domain 网络 I/O 全局、组合链 allowlist、AppRoot/`useAppRuntime` 状态 hook、route 的 Screen props 投影、Account raw session/host 能力逃逸、全局 WebView 状态 owner、AppNavigator feature 隔离、行为测试读取生产源码字符串、旧路径、barrel 和依赖环；同时递归检查 tracked plugin 的进程级 WebView 清理调用。合法/非法 fixture 由 `npm run test:architecture` 固定。规则失败应修正 ownership，不得用文件级豁免绕过，也不得新增 LOC、文件数或 props 数量门禁。

## 改动边界

- 结构重构默认保持站点协议、Query key、缓存生命周期、权限、持久化 key、备份 schema、SecureStore/Cookie 边界、原生 plugin 和发布配置不变。
- 为保持行为而抽取职责、消除循环或满足静态门禁可以调整实现；计划外产品缺陷仍按 `AGENTS.md` 先报告、后授权修复。
- 每批提交应能独立验证和回滚，不混入产品功能或无关格式化。
