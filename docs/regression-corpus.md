# 回归语料库

## 文档职责

本文件记录已经逃逸到用户侧、普通自动测试或发布 smoke 没有拦住的问题。它回答“为什么必须测、什么结果才算拦住”，产品现状与入口仍以 `docs/product-map.md` 为准。

每次开发先选择产品能力 ID；命中本文件事故 seam 时，必须执行该条目的最低可靠测试和验收路径。新的逃逸 bug 修复时，同一改动增加一个 `REG-*` 条目和一个能在修复前失败的最小测试。

## 证据名称

| 证据 | 只证明 |
| --- | --- |
| `STATIC_PASS` | 文档、类型、unused 和 React Doctor 增量静态检查通过 |
| `UNIT_PASS` | Vitest 固定的领域、controller、gateway、存储或请求契约通过 |
| `UI_PASS` | Jest/RNTL 固定的用户可见 React Native 渲染与交互通过 |
| `DEVICE_REPLAY_PASS` | `.ad` 脚本在身份匹配的 App、APK、设备和会话上通过 |
| `LIVE_PASS` | App 内真实来源、登录态或获授权写操作得到可观察结果 |
| `APK_SANITY` | 覆盖安装、启动、日志窗口且无崩溃、ANR 或 RedBox |
| `NOT_VERIFIED` | 当前没有足够证据，不推断成功或失败 |
| `BLOCKED_BY_ENV` | 受签名、设备、来源或登录态阻碍，且不能安全改变环境 |

`APK_SANITY` 和 `DEVICE_REPLAY_PASS` 可以由同一个发布命令执行，但不得合并成“功能完整通过”。

Jest 的 `it.failing` 只用于保留已确认但本轮不获准修复的精确失败 oracle。Jest 对这类用例显示通过，含义只是“预期中的失败仍然发生”，不得计为该行为的 `UI_PASS`；修复后必须把它改成普通用例并确认真实通过。

## `REG-FEED-001` 首次加载出现两套 Loading

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-01`、`FEED-04` |
| 用户症状 | 首页首次读取空列表时，页面 Loading 与 Android 下拉刷新指示器同时出现；Smoke 仍可继续并最终通过。 |
| 触发条件 | `busy=true`、`feedItems=[]`，列表已挂载且同时提供 `RefreshControl`。 |
| 根因 seam | `src/screens/FeedScreen.tsx` 的空态与 `refreshControl` 渲染契约。 |
| 必须保持的行为 | 空数据首次加载只显示页面 Loading；已有列表或主动刷新时保留 `RefreshControl`。 |
| 精确失败 oracle | `tests/ui/feed-screen.test.tsx` 同时断言 Loading 数量和 RefreshControl 是否存在。 |
| 最低可靠自动测试层 | `UI_PASS`：必须渲染 React Native 组件；源码字符串或 `APK_SANITY` 都无法证明 Loading 唯一。 |
| Replay 或真实验收路径 | `tests/device/feed-topic-return.ad` 验证 Feed 可用与返回状态；它不能单独证明 Loading 唯一。 |
| 负向验证方式 | 临时让空列表 busy 状态也挂载 RefreshControl，UI 测试必须失败，随后还原。 |
| 明确不覆盖范围 | 实时来源速度、分页数据正确性和四站解析由 `FEED-*` 其他测试与 Live 验收负责。 |

## `REG-FEED-002` 切换来源或排序后列表没有回到顶部

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-02`、`FEED-04` |
| 用户症状 | NodeSeek 从“新帖子”切到“新评论”后已有主题却看不到新列表首项，Replay 曾被误判为动态 Feed 无结果。 |
| 触发条件 | 旧列表已离开顶部，来源、分类、排序或阅读筛选变化后替换数据；FlashList 的旧实例继续持有滚动位置，而筛选 effect 的即时 `scrollToOffset` 早于新数据布局完成。 |
| 根因 seam | `src/screens/FeedScreen.tsx` 的筛选列表 identity 与滚顶契约，以及 `src/components/listPerformance.ts` 的 Feed FlashList 位置策略。 |
| 必须保持的行为 | Feed 的来源、分类、排序或阅读筛选变化后从目标列表首项开始展示，不保留上一组合的可视锚点。 |
| 精确失败 oracle | `tests/ui/feed-screen.test.tsx` 复用同一份主题数组和全部 callback，模拟原生即时滚顶未生效时只改变筛选，要求列表 identity 随之改变且首项重新可见；`src/components/listPerformance.test.ts` 要求 Feed 禁用 `maintainVisibleContentPosition`；`tests/device/four-source-feed.ad` 先滚动到出现“回到顶部”，再切换 NodeSeek 排序并要求 `feed-topic-first` 恢复可见。 |
| 最低可靠自动测试层 | `UI_PASS` 固定筛选变化后的列表重建行为，`UNIT_PASS` 固定 FlashList 配置；`DEVICE_REPLAY_PASS` 证明 Android 原生列表实际回到首项。 |
| Replay 或真实验收路径 | `tests/device/four-source-feed.ad` 覆盖四站及 NodeSeek“新帖子/新评论”；切换排序前必须确认“回到顶部”已出现，切换后再确认新首项可见，从而区分空数据、仍停在旧位置和真实滚顶。 |
| 负向验证方式 | 从 `renderFeedScene` 依赖中移除分类、排序或阅读筛选，或者移除 Feed FlashList 的筛选 identity `key`，RNTL 必须保留错误滚动位置并失败；移除 `maintainVisibleContentPosition: { disabled: true }`，Vitest 必须失败；设备 Replay 必须在真实列表未回顶时失败。 |
| 明确不覆盖范围 | 不固定动态主题标题、数量或来源当天可用性；这些仍按 Replay 动态结果规则与 Live 验收。 |

## `REG-NODESEEK-001` NodeSeek WebView/会话状态被错误证明

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-01`、`ACCOUNT-02` |
| 用户症状 | 代码或桌面浏览器看似能访问 NodeSeek，但不能证明 App 内 WebView、现有 Cookie、返回链和后续读取仍然可用。 |
| 触发条件 | NodeSeek 登录受限、WebView fallback、会话刷新或验证页面路径发生变化。 |
| 根因 seam | App 内 login/session/verification controller、Cookie bridge、WebView readiness 和 navigation 返回。 |
| 必须保持的行为 | 从账号中心进入 App 内 NodeSeek 页面；包名保持 `com.wz.reader`；返回后账号中心和读取路径仍可使用；旧 generation 不覆盖新会话。 |
| 精确失败 oracle | `tests/device/nodeseek-session.ad` 必须等到正确 NodeSeek host、`document.readyState` 非 loading 且正文非空后才出现 readiness；错误 route/selector 必须在对应步骤失败。 |
| 最低可靠自动测试层 | `DEVICE_REPLAY_PASS`：session/Cookie Vitest 只提供确定性支撑，不能替代 Android WebView、App 内 Cookie 和返回链。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad`；动态登录结论只接受 App 内同类页面，必要时再形成 `LIVE_PASS`。 |
| 负向验证方式 | 临时改错 NodeSeek host/readiness 或 Replay selector，必须在精确步骤失败，随后还原。 |
| 明确不覆盖范围 | Replay 不清登录、不清 Cookie，也不声明当天原站 DOM 永久稳定。 |

## `REG-NODESEEK-002` NodeSeek 页面超时却被 Replay 判为 ready

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `SEARCH-04`、`ACCOUNT-02`、`RELEASE-02` |
| 用户症状 | NodeSeek 登录 WebView 已显示“页面打开超时”或加载失败，Replay 仍因 ready testID 可见而通过。 |
| 触发条件 | readiness 脚本消息在超时或错误状态之后到达；旧 Replay 又固定等待 15 秒，只检查 ready testID，不检查错误是否存在。 |
| 根因 seam | `src/screens/more/MorePanels.tsx` 的 WebView readiness/error 状态和 `tests/device/nodeseek-session.ad` 的等待 oracle。 |
| 必须保持的行为 | 超时和错误立即清除 readiness；只要存在 WebView block/error 就不得暴露 ready testID。Replay 必须按 ready 状态等待，并明确确认超时错误不可见。 |
| 精确失败 oracle | `tests/ui/account-site-panels.test.tsx` 先触发 WebView 错误、再送达 readiness 消息，断言错误仍可见且 ready testID 不存在；`src/androidSmokeGuard.test.ts` 固定 Replay 使用状态等待并拒绝固定长等待。 |
| 最低可靠自动测试层 | `UI_PASS` 固定错误与 testID 不能同时出现；`DEVICE_REPLAY_PASS` 再证明真实 Android WebView readiness 和返回链。 |
| Replay 或真实验收路径 | `tests/device/nodeseek-session.ad`；若原站在 15 秒内没有真实 ready，脚本必须失败而不是把超时页记为通过。 |
| 负向验证方式 | 恢复仅由 `webViewReadyForReplay` 控制 testID，错误后迟到的 readiness 消息会让 UI 测试精确失败；恢复 `wait 15000` 会让 Replay 守卫失败。 |
| 明确不覆盖范围 | 不保证 NodeSeek 当天必定可访问；网络或原站阻塞仍记 `BLOCKED_BY_ENV` 或 `NOT_VERIFIED`，不能伪造 ready。 |

## `REG-DATA-001` ReaderData 实验与代码回退不兼容

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `FEED-03`、`LIBRARY-01`、`LIBRARY-02`、`LIBRARY-03`、`DATA-01`、`DATA-02`、`DATA-03` |
| 用户症状 | 新实验写入了旧代码不能读取的本机数据；代码回退后收藏、历史和关注看似丢失。 |
| 触发条件 | 改动 `reader-data` key、version、schema、序列化、分块或保存顺序，却只验证新代码读取新格式。 |
| 根因 seam | `src/readerData.ts`、`src/readerDataStore.ts`、备份导入和保存队列。 |
| 必须保持的行为 | 当前 version 2 数据可读；失败写入不覆盖旧数据；新旧备份契约明确；改变格式时同时证明升级、失败回滚和代码回退结果。 |
| 精确失败 oracle | 无效 version 必须被拒绝，迟到写入不得覆盖最新状态，损坏/超限备份不得改变原数据。 |
| 最低可靠自动测试层 | `UNIT_PASS`：`src/readerData.test.ts`、`src/readerDataStore.test.ts`、`src/readerBackup.test.ts`、`src/backupOperation.test.ts`。 |
| Replay 或真实验收路径 | 覆盖安装和重启后核对 Library 数量及 Feed 已读/收藏状态；不得清 App 数据制造通过。 |
| 负向验证方式 | 使用无效 version 或迟到写入 fixture，Vitest 必须拒绝覆盖或保持最新状态，随后恢复正确 fixture。 |
| 明确不覆盖范围 | 本机真实数量和 APK 身份只记录在 `docs/emulator-baseline.md`。 |

## `REG-OPS-001` 验证当前代码后留下旧 APK

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 开发构建验收通过后又恢复旧 Smoke APK，用户实际看到的仍是旧 bug。 |
| 触发条件 | 验收流程把“恢复旧基线 APK”当作清理动作，却没有确认用户接下来要检查哪个构建。 |
| 根因 seam | 安装/验收操作协议，而不是业务代码。 |
| 必须保持的行为 | 每次设备结论绑定 commit、dirty 状态、App 版本、versionCode、APK 类型/SHA、设备和登录来源；交付时保留用户应检查的已测构建。 |
| 精确失败 oracle | 指定 APK 与设备 `base.apk` 的 SHA、versionName 或 versionCode 任一不匹配，`test:device` 必须在 Replay 前失败。 |
| 最低可靠自动测试层 | `DEVICE_REPLAY_PASS` 的身份前置门禁；`src/androidSmokeGuard.test.ts` 固定脚本契约。 |
| Replay 或真实验收路径 | `npm run smoke:android` 覆盖安装后执行 APK sanity 与 Replay；本机基线记录最终安装状态和登录来源。 |
| 负向验证方式 | 指向与设备已安装包不一致的 APK，必须拒绝宣称 Replay 通过且不得卸载/清数据。 |
| 明确不覆盖范围 | 未明确发布时不上传、push 或发布正式 APK。 |

## `REG-OPS-002` 设备侧录屏分片耗尽 Replay 空间

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | `APK_SANITY` 已通过，但 Replay 在第一个业务步骤前因 agent-device 无法写入录屏恢复清单而失败；设备 `/sdcard` 曾残留 471 个工具录屏分片并达到 92% 使用率。 |
| 触发条件 | 多次使用 `--record-video` 执行 Replay，设备侧 agent-device 录屏分片或 active manifest 没有在证据拉回本机后清理。 |
| 根因 seam | `scripts/run-device-replay.mjs` 的 Replay session、设备端 durable recording manifest、`screenrecord` 与录屏 scratch 生命周期，而不是 App、Cookie 或业务存储。旧 runner 曾按进程名/路径批量终止并删除，无法证明目标属于当前 Replay。 |
| 必须保持的行为 | JUnit、视频和失败日志保存在 ignored `tmp/agent-device/`；每条 Replay 使用唯一 base session。执行前若存在 manifest、工具录屏进程或 orphan scratch，只按 `BLOCKED_BY_ENV` 阻断并保留；执行后只有 manifest 同时匹配当前 session 前缀、device id、recording id 和安全录屏路径时，才对该精确 session 调用 agent-device `record stop`。不终止 daemon、不 wildcard 删除文件，也不触碰 MCP、App 数据、Cookie、用户文件或本机首败证据。 |
| 精确失败 oracle | `replayRecordingRecoverySession` 对当前 session/device 的合法 manifest 返回精确 recovery session，对其他 session/device、畸形 JSON 或异常路径返回 `undefined`；scratch parser 只接受两个受控根目录下的 active manifest、对应 `.tmp` 和 `agent-device-recording-<时间戳>.mp4` basename。完整 Replay 后 manifest、工具录屏进程和 scratch 均为 0；未知现场必须保留并阻断后续 Replay。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定所有权识别、受控根目录和禁止 wildcard/daemon 清理；`DEVICE_REPLAY_PASS` 证明实际设备录屏可连续收口；二者缺一不能宣称工具链稳定。 |
| Replay 或真实验收路径 | `src/androidSmokeGuard.test.ts`；`npm run test:device`；必要时只读检查显式设备的 `/sdcard/agent-device-recording-*` 数量和剩余空间。 |
| 负向验证方式 | 把 manifest 的 session/device 改成其他值、提供畸形 manifest 或把 scratch basename 改成非时间戳工具名，所有权识别必须拒绝；守卫测试同时禁止 raw `kill`、wildcard `rm` 和 daemon 终止。不通过填满用户设备存储制造负向条件。 |
| 明确不覆盖范围 | runner 不自动删除历史未知 scratch，也不终止无法证明归属的 recorder/daemon；这类现场按环境阻碍保留，需另行确认归属。不删除 App 数据、下载目录中的用户文件或本机 `tmp/agent-device/` 证据，也不承诺修复 agent-device 上游实现。 |

## `REG-OPS-003` Replay 把设备 ID 当成设备名称

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | runner 已按 `emulator-5554` 找到唯一设备并验证 APK 身份，但第一条 Replay 在 `open` 步骤报 `No device named emulator-5554`，全部设备旅程无法开始。 |
| 触发条件 | `WZ_ANDROID_TEST_DEVICE` 使用 agent-device 列表中的设备 ID，且 runner 把这个原始选择值继续传给 `agent-device test --device`。 |
| 根因 seam | `scripts/run-device-replay.mjs` 同时承担设备发现与 Replay 调用：设备发现接受 ID 或名称，但 agent-device 0.19.0 的 test runner 按显示名称绑定设备。 |
| 必须保持的行为 | 环境变量仍可显式填写设备 ID 或名称；runner 必须先唯一解析同一台已启动 Android 设备，ADB 身份校验使用 `device.id`，Replay test 使用解析后的 `device.name`，不得自动选择、启动或重置其他设备。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 用 `id=emulator-5554`、`name=WZ Pixel API 35` 的真实列表形状断言 Replay 参数为 `--device WZ Pixel API 35`；恢复传原始 ID 时测试先失败，真实 Replay 再精确失败在第一步 `open`。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定 ID → 名称映射，`DEVICE_REPLAY_PASS` 证明 agent-device 实际接受该参数并走完七条旅程；二者缺一不能宣称设备闸门恢复。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts`；随后在身份匹配的保留数据设备上执行 `npm run test:device`，七条 tracked Replay 均须 `retries=0`。 |
| 负向验证方式 | 在隔离测试中把 Replay 参数临时改回环境变量中的 `emulator-5554`，单元 oracle 必须失败，CLI 单步回放必须报 `No device named emulator-5554`；还原后重新跑完整 Replay。 |
| 明确不覆盖范围 | 不承诺修复 agent-device 上游的失联 daemon 生命周期，也不通过卸载、清数据、清 Cookie 或切换设备制造通过。 |

## `REG-OPS-004` AVD 名与设备显示名不一致导致 Replay 被拒绝

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 同一发布命令已经完成正式构建、签名校验和 `APK_SANITY`，随后 Replay 在身份行前报“无法唯一匹配 Android 设备”，发布闸门无法收尾。 |
| 触发条件 | `WZ_ANDROID_SMOKE_DEVICE` 使用 agent-device 可启动的 AVD 名 `WZ_Pixel_API_35`，但 booted device 清单把同一设备显示为 `WZ Pixel API 35`。 |
| 根因 seam | Smoke 的 boot/install 接受 AVD 名，`scripts/run-device-replay.mjs` 的设备发现却只接受 ID 或完全相同的显示名，没有处理 agent-device 对下划线与空格的展示差异。 |
| 必须保持的行为 | 设备 ID 和完全相同的显示名继续精确匹配；AVD 名只把连续下划线/空白视为等价并且仍须唯一匹配；不能模糊选择另一台设备。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 以清单设备 `emulator-5554 / WZ Pixel API 35` 断言配置值 `WZ_Pixel_API_35` 唯一映射到同一设备；修复前返回空数组。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定纯设备匹配，`APK_SANITY` 与 `DEVICE_REPLAY_PASS` 证明 release 命令能在同一保留数据设备继续完成。 |
| Replay 或真实验收路径 | `.env.release.local` 保持 `WZ_ANDROID_SMOKE_DEVICE=WZ_Pixel_API_35`，执行 `npm run release:android`；身份行必须记录解析后的 display name/ID，七条 Replay 全部零重试通过。 |
| 负向验证方式 | 在隔离测试中恢复完全相等比较，AVD 名映射断言必须收到空数组；不改真实 AVD 名、不创建重复设备制造失败。 |
| 明确不覆盖范围 | 不把连字符、任意标点或部分字符串当成同一设备；归一化后出现多个候选仍必须拒绝，也不自动启动另一台设备。 |

## `REG-OPS-005` 覆盖安装后的首次启动逃出日志窗口

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 覆盖安装后的第一次启动发生崩溃，但脚本随后清空本机日志文件并执行第二次健康 relaunch，最终仍可能输出 `APK_SANITY`。 |
| 触发条件 | Smoke 依次执行覆盖安装、第一次 `open`、`logs clear --restart`、第二次 `open --relaunch`；agent-device 又要求先有 app session 才能启动日志流。 |
| 根因 seam | `scripts/smoke-android.mjs` 把建立 agent-device session 的第一次 `open` 放在受检查日志窗口之外；第二次启动证据不能证明新 APK 的首次启动没有失败。 |
| 必须保持的行为 | 覆盖安装成功后先读取设备 epoch，再于第一次 `open` 前向设备 logcat 写入唯一 marker；流程结束后以 `logcat -T <epoch>` 有界读取日志，从 marker 起只保留目标包名行和由启动/崩溃记录确认的目标包 PID 行，再检查崩溃、ANR 与 RedBox。marker 丢失必须失败；日志读取不得受 Node 默认 1 MiB 缓冲限制，也不得清空全局 logcat。既有 agent-device session 日志继续检查第二次 relaunch 和 Feed readiness。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 注入一个“后续 appstate/Feed 都成功，但首次启动 PID 输出 `FATAL EXCEPTION`”的命令 runner，断言仍返回含“Android 崩溃”的 `AggregateError`，并固定 `install < device epoch < marker < first open < logcat -T dump`。修复前同一首次启动不在任何受检窗口；真实设备曾用完整 logcat 触发 Node `ENOBUFS`，故同一 oracle 也固定有界起点。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定命令顺序、包/PID 裁剪和首次崩溃 oracle；`APK_SANITY` 在明确设备上证明 marker 与真实 logcat 命令可用。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts`；在目标 APK 和保留数据设备上运行 `npm run smoke:android`，确认首次启动与 session relaunch 均无运行时失败。 |
| 负向验证方式 | 将 marker 调用移到第一次 `open` 之后，或只检查 agent-device 第二次 relaunch 的日志，`REG-OPS-005` 必须因顺序或漏报首次崩溃而失败；不向真实 App 注入崩溃。 |
| 明确不覆盖范围 | 包外其他进程的运行时失败不会归因于本 App；`APK_SANITY` 仍不证明搜索、详情、写操作或其他业务功能正确，这些由 Replay、UI 与 Live 分层验收。 |

## `REG-OPS-006` Replay 自行关闭 session 导致录屏复活并丢失 manifest

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | `agent-device test --record-video` 报告单条 Replay 通过，但设备录屏仍在运行；约 170 秒后旧 daemon 启动下一分片并覆盖唯一 active manifest，安全门禁随后停止整批 Replay。 |
| 触发条件 | tracked `.ad` 在结尾执行 `close`；agent-device 0.19.0 删除 session 后，测试收尾找不到 recording，跳过 `record stop`，但原 daemon 的分片定时器仍存活。 |
| 根因 seam | `tests/device/*.ad` 与 agent-device test harness 的录屏收尾顺序，而不是 `scripts/run-device-replay.mjs` 的所有权门禁。 |
| 必须保持的行为 | tracked Replay 不自行执行 `close`；test harness 先成功停止并拉回视频，再由自身 cleanup 关闭 session。异常路径仍只能按当前 session/device manifest 精确恢复，不能扩大删除或终止范围。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 拒绝任何 tracked Replay 中的独立 `close`；完整设备执行后每条 trace 都有成功的 `video_recording_stop`，且 manifest、工具 `screenrecord` 和录屏 scratch 均为 0。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定七条 Replay 的生命周期契约；`DEVICE_REPLAY_PASS` 证明真实 daemon、manifest 和 Android `screenrecord` 连续收口。 |
| Replay 或真实验收路径 | `npm run test:device` 在空录屏基线上连续执行七条 `--record-video` Replay，并在结束后核对设备与本机任务进程基线。 |
| 负向验证方式 | 给任一 Replay 恢复末尾 `close`，守卫测试必须失败；隔离设备运行会只有录屏 start/preroll、没有成功 stop。 |
| 明确不覆盖范围 | 不承诺修复 agent-device 其他 daemon 生命周期问题，也不删除未知历史 scratch；现有所有权安全门禁必须保留。 |

## `REG-OPS-007` 空 manifest 或原子写入临时文件绕过录屏门禁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 设备仍有 `agent-device-recording-active.json.tmp` 或零字节 active manifest，runner 却认为录屏基线为空并继续启动下一条 Replay。 |
| 触发条件 | agent-device 0.19.0 原子写 manifest 时在 `.tmp` 写入或移动阶段中断，或者正式 manifest 已创建但内容尚为空。 |
| 根因 seam | `scripts/run-device-replay.mjs` 的设备 scratch basename 解析只识别时间戳 MP4，manifest 读取又把空内容视为不存在。 |
| 必须保持的行为 | 两个受控根目录中的 active manifest、对应 `.tmp` 和时间戳 MP4 只要文件存在都视为录屏占用；未知现场只阻断并保留，不删除、不终止。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 的 `REG-OPS-007` fixture 同时包含 MP4、正式 manifest、`.tmp`、用户文件和畸形工具名，只接受前三类 agent-device 路径。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定文件存在性门禁；`DEVICE_REPLAY_PASS` 证明真实录屏结束后这些路径均归零。 |
| Replay 或真实验收路径 | `npm test -- src/androidSmokeGuard.test.ts` 后，在身份匹配设备执行 `npm run test:device`，执行前后只读核对 active manifest、`.tmp`、工具 MP4 与 recorder 进程。 |
| 负向验证方式 | 从 parser 移除正式 manifest 或 `.tmp` 分支，`REG-OPS-007` 必须分别缺少对应路径而失败；不在真实设备制造未知残留。 |
| 明确不覆盖范围 | 不修复 agent-device 上游原子写入，也不自动清理历史未知文件；无法证明归属时仍按 `BLOCKED_BY_ENV` 停止。 |

## `REG-OPS-008` 允许的 agent-device 版本不支持 Replay 参数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `RELEASE-02` |
| 用户症状 | 版本门禁接受 agent-device 0.14.0，但第一条 Replay 因不认识 `--record-video` 或可重复 `--reporter` 参数而在业务步骤前失败。 |
| 触发条件 | `MIN_AGENT_DEVICE_VERSION` 与 README 仍声明 0.14.0，而新增 runner 使用 0.19.0 已验证支持的 test flags。 |
| 根因 seam | `scripts/agent-device-runtime.mjs`、`scripts/run-device-replay.mjs` 与 README 的工具版本契约不一致。 |
| 必须保持的行为 | Replay 入口拒绝低于 0.19.0 和 0.19.0 prerelease 的安装；README 与运行时使用同一最低版本。 |
| 精确失败 oracle | `src/androidSmokeGuard.test.ts` 的 `REG-OPS-008` 断言最低版本为 0.19.0，拒绝 0.18.9 和 0.19.0 beta，接受 0.19.0 及更高稳定版本。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定版本比较；`DEVICE_REPLAY_PASS` 证明当前可信安装实际接受 runner 参数。 |
| Replay 或真实验收路径 | 先执行版本门禁，再在明确设备运行 `npm run test:device`；版本不满足时不得进入设备发现、录屏或 App 操作。 |
| 负向验证方式 | 把最低版本恢复为 0.14.0，`REG-OPS-008` 必须精确收到旧值并失败。 |
| 明确不覆盖范围 | 不自动安装或升级全局工具；未来版本若移除参数，需要单独更新兼容契约和测试。 |

## `REG-TOPIC-001` 回复已筛选但标题仍显示主题总数

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-03` |
| 用户症状 | 切换“只看楼主”或“只看带图”、或执行评论内查找后，可见回复已经减少，但“回复列表 N 条”仍显示主题原始总回复数。 |
| 触发条件 | Topic detail 的 `replyCount` 大于筛选后的 `replies.length`，且回复筛选或评论查询处于生效状态。 |
| 根因 seam | `src/screens/topic/TopicScreenBody.tsx` 的回复标题计数直接读取主题总数，没有区分当前可见结果与未筛选总数。 |
| 必须保持的行为 | “只看楼主”“只看带图”和评论内查找显示当前可见回复数；“全部”与仅“倒序”继续显示主题总回复数；可见列表、选中状态和数量必须同步。 |
| 精确失败 oracle | `tests/ui/topic-reply-filters.test.tsx` 渲染真实 Topic 回复筛选控件：普通用例断言四种筛选、评论查询和列表顺序，4 个带 `REG-TOPIC-001` 的普通测试分别钉住楼主/带图/查询后的标题数量，以及清空原始输入但 debounce 结果尚未更新时的列表与数量一致；`src/app/useTopicSessionController.test.ts` 固定确定性过滤结果。 |
| 最低可靠自动测试层 | `UI_PASS`：Vitest 可证明过滤数组，但只有 RNTL 能证明用户看到的标题数量跟随数组变化。4 个回归用例必须作为普通测试真实通过。 |
| Replay 或真实验收路径 | 从 Feed/Search/Library 打开有多位回复者且含图片的 Topic，逐项切换筛选并执行一次评论内查找；作者页返回后复核筛选与数量仍保留。 |
| 负向验证方式 | 修复前同一 UI 测试在“只看楼主”步骤精确失败：可见回复为 2 条而标题仍为 3 条；恢复直接读取 `replyCount` 时该断言必须再次失败。 |
| 明确不覆盖范围 | 动态来源返回的原始 `replyCount`、回复分页完整性和图片解析正确性仍由 gateway/controller 测试及 App 内 Live 验收负责。 |

## `REG-TOPIC-002` 从阅读设置返回后主题详情丢失

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `TOPIC-04`、`NAV-03` |
| 用户症状 | 从主题右上菜单进入“阅读设置”后切回首页，原主题详情已经被弹出，用户回到首页列表而不是继续阅读原主题。 |
| 触发条件 | 当前位于 Topic route，执行“阅读设置”，完成查看或调整后返回。修复前该入口展开 More 的外观面板并切换到 More tab，随后返回首页。 |
| 根因 seam | `src/app/AppRoot.tsx` 的入口曾复用 `changeScreen('more')`，导致 `popTo('MainTabs')` 移除 Topic；改为临时 `ReadingSettings` route 后，又曾先 dispatch `push`、再依赖下一次 render 保存 Topic，navigation state 变化可能先触发旧闭包，得到滞后一帧 snapshot。 |
| 必须保持的行为 | 阅读设置入口先按当前 Topic route key 同步保存最新 Topic snapshot，再 push 既有外观控件；关闭或离开设置后返回同一个主题详情、同一回复筛选和滚动上下文。普通底部 tab 导航仍保持既有契约。 |
| 精确失败 oracle | `src/app/AppNavigator.test.ts` 的 `REG-TOPIC-002` 断言当前 Topic route 先执行 `saveTopicRoute`、后 dispatch `push`；`tests/ui/app-navigator.test.tsx` 再固定用户进入阅读设置并返回后仍为同一个 Topic 组件且内部状态未丢失。旧顺序精确失败为 `push` 先发生或返回旧 snapshot。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定保存与导航的同步顺序；`UI_PASS` 证明用户经过可见入口返回后 Topic 组件及内部状态仍保留。 |
| Replay 或真实验收路径 | Feed → Topic → 更多操作 → 阅读设置 → 系统或顶栏返回；核对外观控件可见，并且返回后仍是原 Topic、原筛选和原阅读位置。 |
| 负向验证方式 | 临时恢复 `changeScreen('more')` 时 UI 用例必须失败；保留临时 route 但把 `saveTopicRoute` 移回 dispatch 之后时，单元顺序 oracle 必须失败。 |
| 明确不覆盖范围 | 外观各设置的切换、持久化与恢复由 `MORE-03` 验收；一般 tab 切换、Topic → User 嵌套返回仍由其他 NAV 测试负责。 |

## `REG-WRITE-001` 首次投票后参与人数未更新

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在 linux.do 首次提交投票成功后，所选项和票数已经更新，但当前页面的参与人数仍保持提交前的数值。 |
| 触发条件 | 投票带有数值型 `participantCount`、当前尚未投票，并且成功响应进入统一的本地 `poll-vote` 补丁。 |
| 根因 seam | `src/topicActionState.ts` 的 `applyPollVoteToPolls` 只更新 `voted`、选中项和选项票数，没有同步参与人数。 |
| 必须保持的行为 | 首次成功投票使参与人数只增加 1；多选投票也只增加 1；每个新选中的选项票数增加 1；同一成功补丁即使被重复应用也不得重复计数。 |
| 精确失败 oracle | `src/topicActionState.test.ts` 的两个 `REG-WRITE-001` 用例分别固定单选与多选：单选从参与人数 4、选项票数 2 开始，首次应用后为 5 和 3；多选从参与人数 8 开始，两个所选项各加 1 但参与人数仅到 9；重复应用均不得再次增长。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定统一投票状态补丁的确定性计数；`LIVE_PASS` 再证明 App 内首次投票后的显示与原站最终结果一致。 |
| Replay 或真实验收路径 | 按 `tests/live/agent-live.md` 搜索精确关键词“投票”，打开真实 linux.do 投票 Topic；提交一次已授权投票后核对当前页面，再刷新或重新进入并与原站结果对照，不得为重试而再次投票。 |
| 负向验证方式 | 临时移除参与人数增量，`REG-WRITE-001` 单元用例必须从期望 5 精确失败为收到 4；恢复后重跑。 |
| 明确不覆盖范围 | 原站并发投票导致的动态总数变化、匿名或隐藏结果策略以及网络成功语义仍由 action client 与 App 内 Live 验收负责。 |

## `REG-WRITE-002` 妖火收藏成功被误报为结果不明

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在妖火主题点击“原站收藏”后，原站已经把主题加入收藏夹，但 App 丢失重定向证据并提示“操作结果无法确认”。 |
| 触发条件 | 使用 App 内已检测并全局保存的妖火登录态，对尚未原站收藏的主题请求一次 `/bbs/Share.aspx?action=fav&siteid=1000&classid=...&id=...`；妖火完成写入后跳转到 `/bbs/favlist.aspx` 并返回完整收藏夹页面。 |
| 根因 seam | `src/yaohuoActionClient.ts` 的请求 helper 只返回 HTML、丢弃最终 `Response.url`；通用解析器正确地拒绝从长页面文本猜测成功，却也无法知道该请求已经同源跳到收藏夹。旧开源代码中的二次表单流程与当前线上行为不一致。 |
| 必须保持的行为 | 收藏只发送一次既有 GET，不增加二次 POST；业务操作继续读取登录检测时全局保存的 Cookie，不在每次收藏时重读 WebView；只有当前收藏请求最终跳到妖火同源 `/bbs/favlist.aspx` 时补充“收藏成功”，登录、验证、HTTP 失败、明确失败提示和其他长页面继续阻断或保持不确定。 |
| 精确失败 oracle | `src/yaohuoActionClient.test.ts` 的 `REG-WRITE-002` 用例固定完整请求参数、恰好一次 GET、无 body、最终 URL 为同源收藏夹和结果文案“收藏成功”；修复前同一响应精确得到“操作结果无法确认，请刷新原帖核对”。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定单次请求、最终 URL 和保守解析；`LIVE_PASS` 使用全局保存的登录态证明未收藏主题经 App 操作一次后真实进入妖火收藏夹。 |
| Replay 或真实验收路径 | App 内妖火 Topic → 原站收藏一次 → 更多 → 账号中心 → 妖火原站主页 → 我的 → 我的收藏；按标题或主题 id 核对目标存在。结果不明确时不得重投。 |
| 负向验证方式 | 把最终 URL 改为原帖、普通列表或其他主机时不得返回“收藏成功”；登录页、访问验证页和明确失败提示仍必须失败；若增加第二次 fetch，单次请求断言必须失败。 |
| 明确不覆盖范围 | 妖火投票、本机收藏、原站收藏分类管理、Cloudflare/访问验证和原站未来路由变更仍按各自能力与 Live 结果验收。 |

## `REG-WRITE-003` 妖火收藏无法取消且页面不显示已收藏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 妖火原站收藏成功后，App 详情页仍显示未收藏样式；再次点击仍执行添加，无法从 App 取消收藏；重新进入主题也不能恢复原站收藏状态。收藏列表暂时不可用时，主题正文和回复也会一起加载失败，或者未知状态被误显示成“未收藏”。 |
| 触发条件 | 已登录妖火并打开可收藏主题；原站收藏夹把帖子链接和独立的 `data-fav-id` 收藏记录 id 放在同一条目中，取消接口要求该记录 id，而不是帖子 id；或者主题正文与回复请求成功，但 `/bbs/favlist.aspx` 查询失败。 |
| 根因 seam | `src/yaohuoActionClient.ts` 只返回成功文案并丢弃收藏记录 id；`src/app/useTopicActionsController.ts` 始终构造添加请求且不应用状态；`src/yaohuoApi.ts` 未读取原站收藏状态，并曾把可选收藏查询放进主题加载的必需 `Promise.all`；`AppRoot`/`TopicScreenBody` 曾把 `undefined` 强制转换成 `false`，无法区分“未收藏”和“状态未知”。 |
| 必须保持的行为 | 主题加载使用已全局保存的登录态，对收藏列表做一次按标题过滤的只读查询，并按帖子 id 精确取得收藏记录 id；收藏查询失败时仍返回已成功取得的主题正文和回复，把 `bookmarked` 保持为 `undefined`，并把本次详情读取诊断标记为降级，使 caller-owned trace 的成功终态提升为 `partial`；未知状态显示“状态未知”、按钮禁用且不得发起写请求。收藏仍只发送一次既有 GET，从同一次收藏夹响应取得记录 id，不增加第二次写请求；服务端确认后立即显示黄色“取消原站收藏”；取消只发送一次 `/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=<收藏记录id>` POST，并仅在 JSON `success: true` 后清除样式；不得在每次操作时重读 WebView Cookie。 |
| 精确失败 oracle | `src/yaohuoApi.test.ts` 固定按标题查询但按帖子 id 匹配记录，并固定收藏查询抛错时主题正文和回复仍可读、收藏字段缺省且 source summary 的 `partialErrorCount` 为 1、`hasDegradation` 为真；`src/sources/sourceGatewayContract.test.ts` 固定该降级进入 caller-owned Topic trace 后只有一个 `partial` 终态且诊断不含主题、正文、URL 或 Cookie；`src/yaohuoActionClient.test.ts` 固定收藏响应返回记录 id、取消 POST 和失败 JSON 不误报；`src/app/useTopicActionsController.test.ts` 固定添加/取消后的 `bookmark` 补丁；`tests/ui/topic-reply-filters.test.tsx` 固定已收藏时按钮为选中、`favorite` 色调并显示“取消原站收藏”，状态未知时显示对应文案、禁用且不调用操作回调。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定请求、解析和状态补丁；`UI_PASS` 固定用户可见按钮状态与既有黄色样式接线；`LIVE_PASS` 证明 App 按钮、重新进入后的状态和妖火原站收藏夹一致。 |
| Replay 或真实验收路径 | 选择可重新找到的妖火主题并记录初始状态；若已收藏，先在 App 取消并核对按钮与原站收藏夹均消失，再重新收藏恢复；若未收藏则反向操作。每一步只操作一次，重新进入主题核对，最终恢复初始状态。 |
| 负向验证方式 | 把收藏条目的帖子 id 改为其他值时不得采用其记录 id；让收藏查询抛错时不得阻断正文、把未知状态变成可点击的未收藏按钮，或把整体详情读取误记为 `success`；取消 JSON 为 `success: false` 或非 JSON 时不得清除激活状态；移除控制器状态补丁或 UI 的 `active`/`favorite` 接线时对应测试必须失败。 |
| 明确不覆盖范围 | 妖火收藏分类管理、批量清空、原站未来 HTML/接口变更和访问验证仍按各自能力验收；状态未知不会自动重试或猜测收藏结果。 |

## `REG-WRITE-004` 妖火收藏触发整页忙碌闪动

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 在妖火主题点击收藏或取消收藏时，整页操作区会短暂变灰并闪动，而不是只更新收藏按钮。 |
| 触发条件 | 妖火收藏进入统一请求 helper；请求开始和结束分别切换全局 `actionBusy`，该状态同时进入 Topic 列表 `extraData` 和所有操作按钮的禁用样式。 |
| 根因 seam | `src/app/useTopicActionsController.ts` 的 `runYaohuoRequest` 把 busy 写死为全局 `true`，没有沿用 `ActionRunOptions.busy`；收藏请求因此无法选择已有的非全局忙碌路径。 |
| 必须保持的行为 | 妖火收藏和取消请求使用 `busy: false`，服务端确认后只通过既有 `bookmark` 补丁更新收藏按钮；不得刷新主题、切换全局 `actionBusy` 或改变滚动位置；其他需要全局门禁的妖火写操作继续保持默认 busy。 |
| 精确失败 oracle | `src/app/useTopicActionsController.test.ts` 的 `REG-WRITE-004` 断言收藏成功仍应用精确 `bookmark` 补丁，同时 `setActionBusy` 零调用；修复前精确收到 `true`、`false` 两次调用。 |
| 最低可靠自动测试层 | `UNIT_PASS` 固定控制器状态边界；`LIVE_PASS` 再确认真实请求期间页面不整体变灰、内容和滚动位置不跳动，只有收藏按钮在确认后改变。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 记录初始状态后收藏或取消一次，观察请求期间页面其余内容和操作按钮，确认结果后核对收藏按钮及原站状态，最后恢复初始状态。 |
| 负向验证方式 | 移除收藏调用的 `busy: false`，测试必须精确失败并记录全局 busy 的 `true`、`false` 调用；收藏协议或结果不确认时仍不得误切按钮状态。 |
| 明确不覆盖范围 | Android 原生 ripple、网络耗时和成功提示自身的动画不属于整页 busy 闪动；服务端确认后正文被重新提交造成的独立闪烁由 `REG-WRITE-005` 覆盖。 |

## `REG-WRITE-005` 妖火收藏确认后正文被重新提交并闪烁

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03` |
| 用户症状 | 点击妖火“原站收藏”或“取消原站收藏”后，最终滚动位置看似不变，但正文会在约 170 ms 内闪一下；含图正文会短暂退回灰色 loading 占位，单张操作前后截图容易漏掉。 |
| 触发条件 | 妖火服务端确认后，本地用新 `TopicDetail` 对象应用只包含 `bookmarked`/`bookmarkId` 的补丁。布局使用的主题对象已经稳定，但 HTML 渲染输入或 Topic screen action callback 仍跟随原始对象换引用。 |
| 根因 seam | `src/app/useHtmlRenderingController.tsx` 的链接处理曾直接依赖原始 `topicDetail`，导致 HTML renderer registry 重建；同时 `src/app/AppRoot.tsx` 传入 Topic screen 的多个 action callback 闭包随原始详情换引用，嵌在 route renderer 内的收藏 Context 又使整棵 Topic screen 被重新提交。为稳定这些引用而在 render 阶段写 ref 又会让被 React 丢弃的 render 泄漏未提交状态。FlashList/HTML 图片因此可能重新进入加载态或采用错误引用。 |
| 必须保持的行为 | 收藏确认只更新收藏按钮及成功提示；布局主题、筛选回复、HTML renderer 与 renderer props 在只改收藏字段时保持引用稳定；Topic screen 使用稳定 handler 转发到最新已提交实现，相关 ref 只在 layout effect 提交后更新，render 保持纯净；收藏 Context 位于 route renderer 外侧。正文、图片、回复列表和滚动位置都不得重新提交或重载。 |
| 精确失败 oracle | `tests/ui/topic-reply-filters.test.tsx` 的 `REG-WRITE-005` 对收藏与取消两个方向连续换入只含收藏字段差异的详情，断言 `htmlRenderers` 和 `htmlRenderersProps` 始终保持同一引用；`npm run check:react` 要求本次相关变更不存在 `no-ref-current-in-render` 或 `no-prop-callback-in-render`。真实可见 oracle 使用 30 fps 录屏逐帧检查：修复前收藏/取消确认曾分别出现约 50.0%/55.5% 正文像素变化和灰色图片占位，修复后同路径正文变化最高约 0.315%，只剩按钮与 Toast 局部动画。 |
| 最低可靠自动测试层 | `STATIC_PASS` 固定 React render purity，`UI_PASS` 固定 bookmark-only 更新不会重建 HTML 渲染输入；React Native 原生图片和 FlashList 的瞬时重新提交仍必须用 `LIVE_PASS` 的 30 fps 录屏确认，最终截图不能替代。 |
| Replay 或真实验收路径 | 按 `LIVE-WRITE-03` 在收藏按钮、正文图片和回复区同时可见的位置开始 30 fps 录屏，静置后只点击一次，持续到服务端确认后至少 1 秒；逐帧检查正文不得出现其他楼层、灰色占位或大面积明暗跳变。收藏和取消两个方向都验收，最后恢复初始状态。 |
| 负向验证方式 | 临时恢复 HTML controller 对原始详情的依赖时，`REG-WRITE-005` UI 用例必须因 renderer 引用变化失败；把 committed ref 更新移回 render 阶段时 React Doctor 必须失败；临时改回随详情变化的 Topic handler/route 内收藏 Provider 时，30 fps 设备 oracle 必须重新捕获正文或图片的大面积重绘。 |
| 明确不覆盖范围 | 收藏按钮 ripple、黄色选中样式和成功 Toast 的局部动画允许变化；首次进入主题时的正常图片加载、网络耗时、图片源自身更新和其他站点的互动状态由各自能力验收。 |

## `REG-WRITE-006` 阅读设置返回覆盖已确认的原站收藏

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `WRITE-03`、`TOPIC-04`、`NAV-03` |
| 用户症状 | 妖火原站已经确认收藏或取消，但用户在请求期间打开阅读设置，返回后按钮恢复成请求前状态，App 与服务器不一致。 |
| 触发条件 | 进入阅读设置时保存 Topic route snapshot；非全局 busy 的收藏请求随后完成并更新当前 Topic；返回时旧 snapshot 覆盖最新 `bookmarked`/`bookmarkId`。 |
| 根因 seam | `src/app/useTopicSessionController.ts` 的 action update 只更新当前 React state，没有同步当前活动 route 已保存的 snapshot。 |
| 必须保持的行为 | action 确认后同时补丁当前 Topic state 和当前活动 route snapshot；从阅读设置或覆盖层返回时保留已确认的收藏、互动、投票和回复删除结果，同时继续恢复筛选、草稿和滚动上下文。 |
| 精确失败 oracle | `tests/ui/topic-session-controller.test.tsx` 保存未收藏 Topic route，应用收藏成功补丁后恢复同一路由，最终仍必须为 `bookmarked=true` 且保留 `bookmarkId`；修复前恢复为未收藏。 |
| 最低可靠自动测试层 | `UI_PASS` 通过真实 hook state/update/restore 生命周期固定竞态；真实原站最终一致性仍需获授权的 `LIVE_PASS`。 |
| Replay 或真实验收路径 | 确定性测试模拟请求完成；真实验收仅在逐次授权后执行妖火收藏 → 立即打开阅读设置 → 等待确认 → 返回，并与原站收藏夹核对后恢复初始状态。 |
| 负向验证方式 | 移除 action update 对活动 route snapshot 的补丁，测试会在 restore 后精确收到 `bookmarked=false`。 |
| 明确不覆盖范围 | 不替代服务端并发变更、失败响应和访问验证处理；只有已由 action client 确认的结果进入 snapshot。 |

## `REG-TEST-001` Smoke 绿灯被当成功能完整通过

| 字段 | 内容 |
| --- | --- |
| 能力 ID | `NAV-01`、`NAV-02`、`NAV-03`、`RELEASE-02` |
| 用户症状 | Smoke 路径能走通，但 Feed 双 Loading 等用户可见 bug 仍然存在；多来源搜索 Replay 只等到请求结束，即使结果为空或结果打不开也会报绿。 |
| 触发条件 | 测试只验证元素最终出现、源码包含某段字符串、请求完成或 App 没崩溃，没有精确的用户可见 oracle。 |
| 根因 seam | 证据命名和交付报告把不同测试层混成一个 `SMOKE_PASS`；搜索旅程把 `search-complete` 当成搜索成功，没有验证结果存在并能进入详情。 |
| 必须保持的行为 | APK 启动、设备旅程、组件行为、确定性逻辑和真实来源分别报告；缺少的层明确标记 `NOT_VERIFIED`。多来源搜索 Replay 对 Linux.do、NodeSeek、妖火分别完成查询后，必须看到第一条结果、打开详情、等待详情加载并返回搜索页。 |
| 精确失败 oracle | `npm run verify` 必须包含 `npm run test:ui`；`npm run test:device` 和 `npm run smoke:android` 输出不同证据名称，Smoke 不输出 `SMOKE_PASS` 或“功能完整通过”；`src/androidSmokeGuard.test.ts` 精确要求搜索 Replay 中三个来源各有一次结果可见、点击、详情加载和系统返回。 |
| 最低可靠自动测试层 | 由具体事故决定；对 Feed 双 Loading 是 `UI_PASS`，不得用更低层的 `APK_SANITY` 替代。 |
| Replay 或真实验收路径 | Smoke 只汇总 `APK_SANITY` 与 `DEVICE_REPLAY_PASS`；动态来源和获授权写入另报 `LIVE_PASS`。搜索 Replay 必须逐个来源查询、打开第一条结果、等待主题详情并返回。 |
| 负向验证方式 | 注入 `REG-FEED-001` 故障时 APK 仍可启动，但 UI 测试必须失败，证明两个证据层互不替代；从任一搜索来源删除结果可见、点击、详情等待或返回步骤时，守卫测试必须失败。 |
| 明确不覆盖范围 | 不设置覆盖率百分比；测试价值由能否拦住具体用户行为回归判断。 |

## 待确认观察

下表只保存本轮探索中出现过、但尚不足以认定为当前业务 bug 的线索。它们不等同于 `REG-*`，也不能据此增加猜测式 workaround。只有在身份匹配的当前 APK 上稳定复现并得到明确失败 oracle 后，才升级为回归条目和最低可靠测试。53 个失联 daemon、30 个工具录屏进程及设备录屏分片未清理已经有完整证据，归入 `REG-OPS-002`，不再作为“疑似”。

| 观察 ID | 能力 ID | 已看到的现象 | 当前判断 | 下一次可证伪检查 |
| --- | --- | --- | --- | --- |
| `OBS-APP-001` | `FEED-02`、`ACCOUNT-02` | 一次早期候选 APK 在四站来源切换期间出现 Chromium `NetworkService` `SIGSEGV`，随后 App 进程被系统终止；后续当前候选未稳定复现。 | `NOT_VERIFIED`：可能是 Android System WebView/模拟器瞬时故障，也可能是 App WebView 使用路径触发；单次日志不能定根因。 | 在 revision、APK SHA、设备和 System WebView 版本均记录的只读四站旅程中复现；只有再次出现相同 native crash 且能定位触发入口时才建 `REG-*`。 |
| `OBS-LIST-001` | `FEED-02`、`FEED-04` | 一次 V2EX 来源切换后，Replay 的列表 readiness 断言早于稳定列表状态。后续同路径可以通过。 | `NOT_VERIFIED`：当前证据无法区分列表真实竞态与自动化 selector/等待时机问题。 | 同时观察页面可见列表、`feed-list-ready-v2ex` 和请求终态；若用户可见列表为空或串站则按 Feed bug 处理，仅 selector 迟到则修 Replay。 |
| `OBS-AUTO-001` | `ACCOUNT-02`、`RELEASE-02` | NodeSeek DOM readiness 已出现后，UIAutomator 曾因持续变化的 WebView 无法取得 idle accessibility hierarchy。 | 自动化限制，不作为 App 失败：marker 已可见，冗余文案读取才阻塞。 | Replay 只依赖稳定 readiness marker 和返回链；若 marker 本身不可达或用户无法操作页面，再升级为 NodeSeek 产品回归。 |
| `OBS-AUTO-002` | `RELEASE-02` | 本轮首次实际执行筛选 Replay 时，`npm run test:device` 在输出身份行前持续挂起；隔离执行 `agent-device devices --platform android --json` 随后报告旧 daemon PID 不可达并完成替换，启动阶段恢复。 | agent-device 生命周期异常，不作为 App 失败；恢复后另行发现并修复 `REG-OPS-003`，最终五条 Replay 全部通过。失联 daemon 为一次可观察证据，尚未形成稳定复现和独立根因。 | 给设备发现/daemon 启动增加可观察超时和首阶段日志；若相同失联状态可稳定复现，再单独建立 `REG-OPS-*`，不能与设备名称映射混为同一根因。 |
| `OBS-INPUT-001` | `SEARCH-02` | 一次 ADB 键盘提交搜索后前台回到系统桌面，随后用 App 内提交按钮复测通过。 | 自动输入路径异常，不作为搜索功能失败。 | 只在真实软键盘搜索键也能重复使 App 退出、且有对应 App/system 日志时升级；默认 Replay 使用稳定提交按钮。 |

## 新条目模板

新条目必须写明：能力 ID、用户症状、触发条件、根因 seam、必须保持的行为、精确失败 oracle、最低可靠自动测试层、Replay 或真实验收路径、负向验证方式和明确不覆盖范围。没有修复前失败证据的条目不能标记完成。
