# 评论渲染、编辑器与取证工具复盘

本文保留评论列表重复渲染、编辑器重复计算、输入取证和 Android 绘制诊断中已经付出过的验证成本，供后续选择最小实验。它不维护事故状态，也不提供可直接执行的设备命令。

当前状态以[事故档案](../regression-corpus.md)、[产品地图](../product-map.md)为准；证据分层见[测试标准](../testing-standard.md)，设备与构建操作见[维护手册](../operator-runbook.md)。本文涉及共享结构化编辑器的 `WRITE-01/02/04/05/06/07`、`NOTIFY-02`，具体通过范围始终随样本记录。

2026-10-19 在 `fa491fa108f3afa2c49197ecb1349b72a0071956` 之后重新筛选的四项局部性能改动，与本手册一同纳入提交，正式产包状态以发布记录为准。编辑器重新采用文档序列化和工具栏派生复用；旧 Worker、导航与其他已回退改动不随本文恢复。

旧 `REG-PERF-034/039` 的验证结论在下文按方法、结果和边界保留；旧状态不直接覆盖现役档案。本文不依赖临时快照或历史 harness 继续存在。需要重开实验时，先在当前 owner 建立相同判据，再准备受控工具，不能照搬旧包和设备身份。

## 草稿变化不应带动未变化的回复列表

试法：通过真实 Topic session/controller 与生产回复组件更新草稿，同时观察未变化回复的渲染；另外检查引用、正文、revision 和最新 notify，不能仅把子组件替换成一个计数 mock。

原问题与原因：session 每次返回新的命令组对象，使依赖 quote/composer 命令的回调也变化。即使回复内容没变，传下去的回调身份已经变了，memo 仍会让生产回复组件再次渲染。

已做、已验：旧候选随整体迭代撤回后，2026-10-19 仅重新实施 Topic 的命令组复用，各组 useMemo 保留原有真实依赖。修前额外累计渲染为 `[2,3,4]`，预期为 `[0,0,0]`；修后目标用例及完整 owner 129 项通过，引用和最新回调行为保持。

踩坑与取舍：稳定对象身份不能靠空依赖冻结命令或旧闭包，也不需要把草稿提升、增加页面状态机或重写列表生命周期。这次没有恢复 User、导航或其他保活候选。减少回复渲染不证明输入到屏幕延迟下降，也不关闭全部评论卡顿。

继续入口：[Topic session](../../src/features/topic/useTopicSessionController.ts)与[现有 UI owner](../../tests/ui/topic/topic-session-controller.test.tsx)。只有当前相同草稿路径再次带动无关回复，或稳定后命令读到旧值时重开对应反例；不要因一次 Native 慢帧继续叠加 React memo。历史归属为 `REG-PERF-033`，当前状态仍由事故档案维护。

## Markdown 缓存必须跟随文档身份

试法：在真实 Tiptap 中反复请求未变化文档的快照，再依次改选区、编辑、撤销、重做、程序替换和切换模式。对真实 `getMarkdown()` 计数，并比较完整 Markdown，不能只检查缓存命中。

历史两站各以约 128 KiB 正文、0 或 256 个图片引用请求 100 次 rich snapshot，序列化由 100 次降到 1 次；source 对照始终为 0 次。它减少重复遍历，没有证明单次序列化算法变快。

缓存键不能只用 revision。程序替换可以保持 revision，却换了文档；相同 revision 的新内容必须重新序列化。当前候选只保留最后一份 Editor、不可变 `editor.state.doc` 与 Markdown，INIT/DESTROY 清除。

本轮从 `fa491fa1` 重新建立两站 RED：累计调用 `[4,6,7,8,9,10,14]` 变为 `[1,2,3,4,5,6,7]`。这些是受控工作量，不是 Android 输入延迟。

否决按 revision 或正文长度复用结果的方案。只有文档身份变化仍复用旧值，或同一文档仍发生多次序列化，才沿该缓存重新定位；不能因一次慢帧扩成全局缓存。

继续入口：[当前 runtime owner](../../src/ui/composer/editorRuntime.test.ts)、[既有压力 owner](../../tests/integration/performance/editor-stress.test.ts)。本轮 seed `20261019` 的真实 runtime 与既有压力检查共 189 项通过；该组合不包含 Native 时延证明。

## 文档缓存不能缓存发送许可或整个 snapshot

试法：保持相同 Markdown，改变接收人身份等业务配置、投票状态或上传占位，再请求 snapshot；同时检查旧请求和旧 epoch 不能覆盖当前结果。身份校验用例经过 INIT 替换 doc 并清缓存，不能将它表述为同一 doc 身份下直接切换所有账号权限。

Markdown 是可复用的文档投影；revision、documentEpoch、requestId、投票 sidecar、校验结果和发送许可仍须按当次状态产生。正文不变不意味着账号、附件或投票条件不变。

旧压力对照的 bridge 字节数相同，说明当时未靠删字段减量；它不能替代字段语义断言，也不证明传输耗时下降。

否决缓存整个 snapshot、校验结果或允许发送状态的方案。只要新权限/sidecar 被旧缓存遮住，就应停止性能验收并保留该功能负例；不能以更少序列化次数放行。

继续入口仍是 `src/ui/composer/editorRuntime.test.ts` 的账号、投票、上传与请求关联用例。验收必须同时满足正文复用、当次校验变化、旧请求不能覆盖新请求；任一不满足都不能以工作量减少抵消。

## 两个工具栏订阅可以共享同一 EditorState 的派生

试法：真实 runtime 载入 131072 字符、272 段正文，全选后打开文字格式面板，同时观察 HTML 按钮与 Native `TOOLBAR_STATE`。计数 spy 必须继续调用真实 `isActive` 和遍历实现。

旧实现的两个 `useEditorState` 订阅分别派生相同状态。面板打开时，13 类 `isActive` 各调用 2 次，根遍历 26 次、访问 14144 个节点；复用后分别为 1 次、13 次和 7072 个节点。

订阅结果相等只能避免后续更新，无法追回 selector 已做的计算。保留两处局部订阅，按 Editor 的最近一份 EditorState 复用结果，比把状态提升到整个编辑器父组件更小。

EditorState 包含 selection 与 storedMarks；只按 doc 缓存会遗漏选区/格式状态变化。mode、builder、imageBusy、documentEpoch 和权限不进入这份缓存。

否决用「没有重新渲染」证明没有派生工作。若同 doc 换选区、同 selection 换 storedMarks、heading 2→3 或 undo 出现两面状态不一致，重开该 owner；没有这些负例时不重构订阅体系。

当前继续入口为 `src/ui/composer/editorRuntime.tsx` 的 `selectToolbarState` 及 runtime owner。2026-10-19 小型真实文档序列的 bold 派生计数从 `[2,4,2,4,4]` 变为 `[1,1,1,1,1]`；旧大选区节点数不冒充本轮 Native 提速。

## 压力用例超时与延迟销毁要分别判断

试法：把 mount、选区、格式化和 undo 分段观察，并检查卸载后的真实 Editor 是否销毁；按原随机 seed 重放，不先延长所有测试期限。

旧完整门禁的一项大选区测试超时，诊断约 5.57 秒耗在双编辑器 mount，随后选区、格式化与 undo 合计约 148 ms。该 128 KiB 用例的 30 秒期限只是挂起保护，不能用作性能门槛。

另一个可复现清理缺口是 fake timers 下卸载后立即恢复真实计时器，遗漏 Tiptap 延迟 1 ms 的销毁。真实 `isDestroyed` 的 RED 为 `false != true`；全部卸载后仅在 fake timers 下推进 1 ms，旧 owner 182 项通过。

不能据此断言泄漏导致了前述 mount 超时，两者因果未证。也不能把测试清理措施搬到产品，主动销毁仍在使用的 Editor。

继续入口是 runtime owner 的 teardown；旧失败 seed 为 `1792276211003`。依赖或测试集合改变后，旧 seed 不保证相同顺序，须先重新证明资源未销毁。只在卸载后资源仍存活或当前版本再现挂起时重开，不为消除超时关闭功能断言；历史清理修正不代表本轮已重新采用。

## 大稿 CDP timeout 不等于编辑器计算卡死

试法：旧隔离 Release/CDP 包先验证 source/rich 的 131072 字符，再用 Android InputManager 输入 32 个 ASCII 字符，随后请求 runtime snapshot。

run01、run02 均在后一次 CDP snapshot 超时，伴随 ADB 短暂离线。重连后只读取得的后验 RN 缓存回执达到 131104 字符；失败当时没有取得输入后的 runtime snapshot。两轮尚未执行到大选区、格式、undo/redo 或重开，必须保留为失败流程。

当时 WebView 为 124.0.6367.219，实际图形后端未记录；不能借主 AVD 的 156/ANGLE 结论解释。保留窗口未见 fatal/OOM/renderer crash/ANR，也不等于完整排除了这些故障。

冻结旧采集器的 host 对照能接收完整和分片的 131104 字符响应；服务端关闭连接后，旧采集器却等待约 5 秒再报 DOM timeout。这证实错误分类缺陷，没有证明原两轮 Android 正是断连。

拒绝自动重连、重复输入或放宽全文断言来换通过。继续时先区分 socket close/error、协议错误、页面异常与真正 deadline；同时保存原错误和 cleanup 的 closeError，清理失败不得覆盖首因。

继续入口是[现役工具 owner](../../tests/tooling/composer-device-proof.test.ts)。若重建 CDP 诊断，先用完整响应、分片、协议错误、页面异常和 socket close/error 校准分类；关闭时立即拒绝待处理请求并清监听器/timer，不自动重连。旧修复曾有 11 项 RED 转为 51 项全过，但回退后不能假设历史大稿分支与连接修复仍在。

## Host 回执能证明业务接受，不能伪装 runtime 内部回执

后续 run03 采用两种边界。前两阶段通过 CDP 核对 seed 的 requestId/epoch；Native 输入前断开 CDP。后七阶段只读生产宿主接受的完整 snapshot，核对新 sequence、同 processSession/token/build、mode 与 revision。

该轮完整逐字对照通过：预置 131072 字符，单批 Native ASCII 后 131104 字符，272 段加粗后 132192 字符；undo/redo、源码/富文本往返和关闭重开均保持预期。关闭 sequence 10、重开 11，避免拿关闭前旧快照当重开结果。

结果仅属于隔离 debuggable Release fixture 的九阶段功能证据，请求、确认和上传为 0。前两个种子是公开 DOM 预置，不能写成 128 KiB 全部由 Native IME 输入。

原 run01/02 失败没有被 run03 改写。该轮 15 条 ADB offline/not-found 日志缺少逐条命令/时间归属；有期限的回执读取轮询不是动作重试，也不能用于估算产品响应时间。

否决只校验长度/hash、同进程旧 sequence 或替后七阶段补造 requestId/epoch。只有新增功能风险或回执不再新鲜时重开对应检查点，不为补中文覆盖重跑已完成的九阶段。

若确需重建，沿[现役 Composer fixture](../../tests/ui/composerSubmissionFixture.tsx)与工具 owner 加隔离观测：宿主接受快照后才发布 sequence，关闭快照成为重开下界，逐字构造九阶段预期。历史迁移的两项 RED 只是新 validator 导出缺失，不是旧快照错误复现；不把它记作产品 Bug 红绿。普通包不能假定具备这套诊断回执。

## ADB 单批 ASCII 过期会制造「编辑器丢字」

旧压力轮一次注入 512 字符。一个负例预期 3101 字符、实际 2890；重复 `x` 无法定位少了新字还是旧字，所以「删除旧文 211 字符」被否决。

后续诊断同时取得输入前选区、真实 DOM、输入事件和宿主全文：第 4 轮只交付 510 个新字符，30 秒后仍相同；输入跨度约 10005 ms，系统同时记录 stale event 丢弃。5 条按键丢弃日志不等于丢 5 个字符。

已核 API 35 平台路径会给整批生成的 KeyEvent 使用同一次时间戳。工具改为连续 8×64 字符命令刷新时间戳，字符总数、20 轮和全文断言不减，也不重传失败输入；后续完整批次通过。

这属于注入协议修正，产品源码未因该输入问题改变。命令耗时包含平台、driver、输入和 bridge，不能称编辑器纯 CPU 时间；真实键盘处于活动状态也不能把键事件改称软键盘 composition。

继续入口：[现有工具](../../scripts/run-composer-device-proof.mjs)的 `injectComposerImeInput` 及其 tooling owner。旧修后 20 轮、160 批、10240 个新字符逐字完整，最终仅一次隔离 mock 请求和确认。重开前先取可区分的新输入、真实选区与事件交付证据；不沿用重复填充文本定位损坏，不把历史 mock 提交授权带到真实站点。

## 真中文、语音和 ASCII 是三种证据

普通非 debug 真机曾在 NodeSeek 空回复稿用实际百度九键拼音输入 `zhongwen` 并选「中文」，源码精确为 2 字；源码再输入 `ceshi` 后退格取消，关闭重开仍为「中文」。只删除本轮两字，恢复空稿、禁用发送和原模式。

这补足了小稿的真实中文候选提交、取消与重开，未观察 DOM composition 事件链，也不覆盖大稿或输入延迟。普通包没有 fixture 请求计数，不能伪造 `requests=0`；记录的是实际没有触发发送、上传等入口。

妖火语音「只进入首字」另有独立风险：受控选区回写和 `keyboardDidHide` 无条件 blur 曾干预输入。移除干预的 UI 红绿仅证明 App 不主动打断，不能替代用户实际输入法的连续语音复测。

否决用 `adb input text`、DOM insertText 或人工 CompositionEvent 代替真实中文，也不以百度小稿通过关闭语音问题。若要补事件链，必须在隔离诊断入口观察真实 IME；普通包只在能保全原草稿与完整读回时增加本地样本。

继续入口见现役 `REG-WRITE-095`、[妖火输入 owner](../../tests/ui/topic/yaohuo-reply-composer.test.tsx)和共享 editor owner。上述小稿样本来自 PHK110、百度 IME、普通 `4e43e59d…` 包；不是本轮候选。普通包大稿须先证明全文预置/读回与原稿恢复通道，不能以字数、尾部 AX 或截图代替完整内容。

## 模拟器 EGL 校准不能包装成 App 修复

试法：固定 App/provider，比较 host GPU、SwiftShader、GL/Vulkan 与 native EGL，并区分有 trace、无 trace 和录像条件。必须保存实际 provider/后端，不能从启动参数或另一台 AVD 推断。

历史 156 引擎的 native EGL→默认→native EGL 对照中，约 4 秒动画的 drawGl 次数为 180→21→180，中位耗时 0.890→203.992→0.923 ms，状态查询为 0→5602→0。它支持该环境的 ANGLE 查询瓶颈；单升级 Emulator 或换 ASG 没有解决。

主 AVD 应用 native EGL 后，真实 NodeSeek 的固定拖动记录到更多中间位置；仍有 deadline miss。配置影响模拟器之后的 WebView，不是生产 App 公共 API 修复，也不能解释后端未记录的 WebView 124 大稿超时。

曾试图改 software layer 避开 drawGl，但文字高度从约 36 px 压到 26 px；该方案被否决。`androidLayerType="none"` 也未稳定消除历史遮挡，不能因一次终态正常保留视觉降级。

继续入口是 `REG-WRITE-087/121`、维护手册的环境校准与[配置工具 owner](../../tests/tooling/emulator-webview-config.test.ts)。只有同条件再次出现慢路径、真实后端或 provider 改变时重开；先固定产品与 provider，再分别验证环境，不反复切渲染器凑一次绿灯。配置写入/恢复只能作用于已确认自有文件，环境恢复不能靠清数据。

## IME 终态、布局提交和上屏不能互相替代

历史选图交接显示，RN `keyboardDidHide` 到达时 Native 仍可能处于中间高度；最终截图贴底不证明过渡无空隙。另一次同钟诊断确认 React commit 暂停期间 Reanimated 的新 IME batch 被跳过，这与 GL 查询慢段是不同原因。

继续验证必须把当前 IME、面板几何、提交与实际编码画面放在同一窗口。原生矩形无重叠不能代替像素可见；commit 成功或 pre-draw 发生也不等于已经上屏。

历史成对开关普通默认 GL 包有两次冷启动、六轮、422 个原帧未见工具栏遮挡，仍有 144–176 ms 的相邻编码间隔。它只覆盖当时 linux.do 空正文入口，不能证明连续帧率、长文选区、完整选图矩阵或真机通过。

否决重复 Insets 补偿、固定延时、预留空白或删除业务状态来躲开旧负例。若真实过渡再次遮挡，先沿已有几何与提交 owner 定位；没有新负例时不恢复整轮试验，也不扩大全局 feature flags。

继续入口：[原生键盘 owner](../../tests/native/ComposerKeyboardTest.kt)、[共享 viewport owner](../../tests/ui/topic/composer-keyboard-viewport.test.tsx)。重开时须同时确认实际 IME 已显示、同次更新是否被 skip、原生布局是否变化及画面是否可见；只看 pause 调用不足以归因。现役结论仍只读 `REG-WRITE-087/121`，不将旧全局开关实验复刻成本轮默认方案。

## 仍未覆盖的范围

- 当前候选在普通真机上的编辑响应、物理输入延迟、连续帧率与长期内存，没有由上述工作量计数证明。
- 普通包 128 KiB 大稿的真实中文 IME、全选工具栏响应与完整全文读回，没有由隔离 ASCII 九阶段证明。
- 百度小稿的结果不覆盖其他输入法、连续语音、实体键盘或 DOM composition 事件链。
- 原两轮大稿 CDP/ADB 中断的设备侧原因仍未定位；host 断连分类修正没有补齐这条因果链。
- 模拟器 EGL 样本不覆盖所有 WebView/provider、物理 GPU、长文光标与完整选图矩阵；编码帧没有覆盖所有实际显示周期。
- 以上本地草稿和隔离 mock 验证不授权真实发帖、回复、上传或修改用户已有草稿。后续执行范围仍按维护手册和当次授权决定。
