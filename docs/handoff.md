# 交接说明

这是一份常青交接入口，不保存版本号、Release hash、dirty 快照或“当前做到哪一步”。实时进度由 Git、版本配置和与当前对象身份匹配的运行证据现场生成。

## 接手顺序

1. 阅读仓库根目录的 `AGENTS.md` 与 `README.md`，确认执行约束、产品范围和最小开发入口。
2. 用下方命令记录 Git revision、dirty 状态和版本配置；不要先借用历史交接结论。
3. 阅读 `docs/product-charter.md` 与 `docs/product-map.md`；产品/runtime 改动选择直接影响的能力 ID 并展开共享 seam，纯测试、文档或治理改动记录 evidence owner。
4. 按能力或 owner 检索 `docs/regression-corpus.md`，确认历史逃逸问题的状态、根因与当前归属。
5. 按任务读取 `docs/code-standards.md`、`docs/architecture.md`、`docs/testing-standard.md` 与 `docs/operator-runbook.md`；不要把它们全部复制进任务说明。
6. 本机存在 `memory/MEMORY.md` 时，只按索引读取相关补充事实；需要模拟器证据时，只采用与当前 revision、App 版本和 APK 身份同时匹配的 `docs/emulator-baseline.md` 记录。
7. 安装依赖并运行 `npm run verify`；只有任务确实涉及真实页面或设备行为时，才按测试标准扩大验证。

## 事实源地图

| 事实 | 权威位置 |
| --- | --- |
| 品牌、视觉和 accessibility | 根目录 `PRODUCT.md` |
| 产品取舍与功能准入 | `docs/product-charter.md` |
| 现有能力、入口、能力 ID 与共享 seam | `docs/product-map.md` |
| 历史逃逸问题的状态、根因与当前 owner | `docs/regression-corpus.md` |
| ownership、import、测试归属与质量门禁 | `docs/code-standards.md` |
| module、interface、数据与原生配置边界 | `docs/architecture.md` |
| 测试方法、证据层与授权边界 | `docs/testing-standard.md` |
| 构建、覆盖安装、Replay、Smoke 与发布操作 | `docs/operator-runbook.md` |
| 已确认待处理技术债务 | `docs/code-cleanup-map.md` |
| 当前实现和可运行行为 | 代码、配置与实际运行结果 |
| 本机专项取证与设备历史证据 | `memory/` 与 `docs/emulator-baseline.md` |

用户最新明确要求优先于既有文档；实现与文档冲突时，以代码和匹配身份的运行结果为当前事实，并在交付中指出差异。本机记忆只作补充，不能覆盖 tracked 文档。

## 现场生成当前状态

```powershell
git rev-parse HEAD
git status --short
git log -1 --oneline
node -p "require('./package.json').version"
node -p "require('./app.json').expo.android.versionCode"
```

- `git status --short` 非空时，逐文件区分既有 WIP 与本任务改动；不得把 dirty tree 描述成已交付版本。
- 发布状态以 Git、版本配置、Release 产物和实际发布结果共同判定；交接文档不维护手写进度表。
- 模拟器记录只有在 revision、App 版本和 APK 身份全部匹配时才是当前证据；没有匹配记录就是未验证。
- 当前技术债务以 `docs/code-cleanup-map.md` 为准；没有条目不等于可以凭猜测新增或删除能力。

## 文档与记忆收口

1. 枚举 tracked Markdown，并按需检查本机 `memory/`、`docs/emulator-baseline.md` 和 workspace residue。
2. 以用户要求、当前代码、配置及匹配身份的运行结果核对事实；每类事实只在上表的权威位置写完整版本。
3. 删除过时的现役说法和重复索引；历史事故留在回归语料库，历史设备证据留在模拟器基线，普通演进交给 Git。
4. `memory/MEMORY.md` 只做索引，`memory/project.md` 只保留本机独有事实和权威文档指针。
5. 运行 `npm run test:docs`、`npm run check:docs` 与 `git diff --check`；代码或工具发生变化时，再运行相应测试、`npm run typecheck` 和 `npm run verify`。
6. 交付时现场报告最近完整基线、眼前 dirty WIP、已确认技术债务、未验证范围和清理候选；未经确认不删除录屏、`tmp/`、dogfood 结果或额外 worktree。
