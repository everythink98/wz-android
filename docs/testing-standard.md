# 测试标准

## 结论

测试必须证明“功能没有被改坏”，不是证明 App 能打开。常规改动至少执行自动测试和 `npm run typecheck`；涉及页面流程、登录态、真实来源结果或交互时，还必须做模拟器验收。

当前自动测试是 `Vitest + jsdom`，共有 81 个测试文件、763 个用例。它们主要覆盖数据规则、来源解析、请求构造、状态计算和源码边界；没有 Android 真机/模拟器自动测试，也没有覆盖率基线。

## 判断原则

- 代码里能固定的数据，用自动测试精确断言数量、字段、顺序和错误状态。
- 真实网站结果每天会变，不能把实时结果条数写成永久固定值；每次验收要记录同一关键词、同一筛选、同一登录态下的各站结果数和首条可打开结果。
- 搜索、首页、详情、回复、用户页和互动结果必须检查 `source`、`id`、`title`、`url`、作者、时间、回复数、分页状态和错误状态，不能只看列表有内容。
- 登录、Cookie、验证、备份、发布和安装属于高风险功能；只跑 UI 不算通过。
- 只打开 App、看首页显示、截图留存，都不算完整测试。
- 优化代码前先看 `docs/emulator-baseline.md`；优化后按同一功能、同一关键词、同一来源和同一登录态复测差异。
- 登录和验证网页必须从 App 的 `更多 -> 账号与验证` 入口打开；页面包名仍应是 `com.wz.reader`。用 Chrome 打开网页不能算登录 / 验证通过。

## 有用测试标准

| 保留 | 删除或合并 |
| --- | --- |
| 能证明站点解析、请求目标、Cookie、登录态、安全边界、写操作、本地数据保存、备份恢复、请求归属或竞态回滚没有被改坏 | 只锁定 `padding`、`color`、`fontSize`、`borderRadius`、memo 比较、性能常量或内部 helper 形状 |
| 能防止用户能感知的回归，例如用户页顶部距离、回复按钮可点、mention 不像普通网页链接、隐藏 WebView 不可见 | 同一行为分支的重复样例，或只复述当前实现写法的断言 |

## 功能标准

| 功能 | 对的标准 | 常用自动测试 |
| --- | --- | --- |
| 入口 / 导航 | 冷启动进入首页；4 个底部入口可切换；从首页、搜索、收藏打开主题和用户页后可返回；详情页内再打开主题不会丢上一级状态 | `src/topicSessionState.test.ts`、`src/userNavigation.test.ts`、`src/androidBestPracticeBoundaries.test.ts` |
| 首页 / 分类 / 分页 | 四站来源按当前支持范围返回；分类不串站；分页不重复、不漏掉下一页；聚合首页保留来源平衡 | `src/feedLogic.test.ts`、`src/feedCategoryRail.test.ts`、`src/forumApi.test.ts`、`src/localSources.test.ts` |
| 搜索 | 空关键词不请求；单站和全部搜索都按站点分组；结果字段完整；错误按站点显示；分页能继续；筛选参数真实传给站点；登录态限制必须显示站点提示；NodeSeek 登录时走站内搜索，未登录时允许受限 Google 搜索结果，且两种状态要分开记录 | `src/forumApi.test.ts`、`src/localSources.test.ts`、`src/searchFilters.test.ts`、`src/searchListItems.test.ts`、`src/sources/sourceGateway.test.ts`、`src/yaohuoApi.test.ts` |
| 详情 / 回复 | 标题、正文、作者、时间、分类、回复数和权限提示正确；回复分页不丢楼层；楼层引用和图片预览可用；返回后上一层详情状态保留 | `src/topicSessionState.test.ts`、`src/topicDerivedData.test.ts`、`src/topicContentSplit.test.ts`、`src/topicContentHtml.test.ts`、`src/topicListItemState.test.ts`、`src/localSources.test.ts` |
| 回复编辑 / 图片上传 | 三站回复失败后输入框仍可点击；格式按钮按站点插入 Markdown / UBB；NodeSeek 通过 NodeImage 自动授权、缓存 Key、过期后重新授权；NodeSeek / linux.do / 妖火上传后只插入草稿，不自动发送 | `src/app/topicActionHelpers.test.ts`、`src/replyImageUpload.test.ts`、`src/linuxdoUpload.test.ts`、`src/loginWebViewScripts.test.ts`、`src/nodeimageAuthWebViewScripts.test.ts`、`src/screens/topic/replyComposerFormatting.test.ts` |
| 回复删除 | NodeSeek、linux.do、妖火只在原站明确允许时显示删除；不得靠作者名判断；删除前必须确认；删除成功后列表中消失；测试只删除本次新发的临时回复 | `src/nodeseekActions.test.ts`、`src/linuxdoActions.test.ts`、`src/yaohuoActions.test.ts`、`src/localSources.test.ts`、`src/localYaohuo.test.ts` |
| 互动 / 写操作 | 未登录时不发送；登录后请求带正确 Cookie / CSRF / sid；成功后本地状态不重复计数；失败后回滚；投票、收藏、点赞、回复的目标不串站 | `src/nodeseekActions.test.ts`、`src/nodeseekActionClient.test.ts`、`src/linuxdoActions.test.ts`、`src/linuxdoActionClient.test.ts`、`src/yaohuoActions.test.ts`、`src/yaohuoActionClient.test.ts`、`src/topicActionState.test.ts` |
| 用户页 | 四站用户资料、头像、发帖数 / 回帖数、主题列表、分页游标正确；用户名和用户 ID 不混用 | `src/forumApi.test.ts`、`src/userNavigation.test.ts` |
| 收藏 / 历史 / 关注 | 本机数据保存失败能暴露；列表筛选、分组、去重、备份恢复后数据一致；备份不含敏感字段 | `src/readerData.test.ts`、`src/readerDataStore.test.ts`、`src/readerBackup.test.ts`、`src/backupFiles.test.ts`、`src/appSecurity.test.ts`、`src/app/useReaderDataController.test.ts` |
| 登录 / 验证 / Cookie | Cookie 只保存在本机；检查登录态不泄露敏感值；Cloudflare / 验证状态用结构化状态判断；不能靠显示文字当流程条件；页面提示必须区分未登录、登录失效、需要验证和普通失败 | `src/siteSessionState.test.ts`、`src/nodeseekCookies.test.ts`、`src/nodeseekCookieBridge.test.ts`、`src/yaohuoCookies.test.ts`、`src/cookieCleanup.test.ts`、`src/sourceErrors.test.ts`、`src/appSecurity.test.ts` |
| 更多页 / 外观 / 更新 | 账号区状态准确且不显示 Cookie 名称；开发版测试工具独立于账号区；备份、状态检查、外观设置和更新检查不互相占用错误状态；更新按钮只在有新版时提示 | `src/moreAccountStatus.test.ts`、`src/theme.test.ts`、`src/appUpdate.test.ts`、`src/androidBestPracticeBoundaries.test.ts` |
| 发布 / 安装 | 版本号一致；release 先跑测试和无用代码检查；正式签名有效；APK 安装能力保留；敏感文件不提交 | `src/releasePackaging.test.ts`、`npm run release:android` |

## 搜索验收

搜索是最容易出现“看起来能搜，实际坏了”的功能。改搜索、来源解析、Cookie、隐藏 WebView、筛选、列表分组或请求归属时，必须执行下面两层。

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

## 回复图片上传验收

改回复、楼层回复、格式工具栏、图片上传、NodeImage 授权或写操作锁时，必须执行。

### 自动测试

```powershell
npm test -- src/app/topicActionHelpers.test.ts src/app/topicActionControllerHelpers.test.ts src/app/useTopicUiStateController.test.ts src/replyImageUpload.test.ts src/linuxdoUpload.test.ts src/loginWebViewScripts.test.ts src/nodeimageAuthWebViewScripts.test.ts src/nodeseekActions.test.ts src/nodeseekCookies.test.ts src/nodeseekBrowserFetchScript.test.ts src/screens/topic/replyComposerFormatting.test.ts
npm run typecheck
```

通过标准：

- 发送失败或上传失败后，同一个回复框还能继续点击和编辑。
- NodeSeek 图片上传使用用户自己的 NodeImage Key；无 Key 时自动打开 App 内授权页；已有 Key 时不重复授权；401 / 403 后只刷新一次 Key 再重试。
- NodeSeek 回复 / 编辑必须使用登录页或详情页保存的真实 token；没有 token 时拒绝发送并提示重新检测登录，不允许随机 token。
- NodeSeek 自己的回复只有同时有评论 id 和原始正文时才显示编辑；只隐藏自己的点赞 / 鸡腿 / 反对，不展示点了会失败的编辑入口。
- 取消编辑或系统返回关闭编辑框后，编辑正文不能残留成普通回复草稿。
- NodeSeek 详情必须保留原站渲染后的 at、楼层链接、表情 / sticker 和签名显示，不得因为编辑源数据回退成纯文本。
- NodeSeek 楼层回复的草稿请求包含 `@用户` 和楼层链接；测试只构造请求，不发送真实回复。
- linux.do 上传走 `/uploads.json` 且保留 FormData；妖火上传走图床后插入 `[img]...[/img]`。

### 模拟器验收

在不卸载、不清数据、不清 Cookie 的前提下执行：

1. `更多 -> 账号与验证` 确认 NodeSeek、linux.do、妖火是可写登录态；NodeImage 显示已保存或可自动授权。
2. NodeSeek 无 Key 或强制重新授权时，点击图片按钮应打开 App 内 NodeImage 授权页；授权成功后关闭弹层并显示已保存。
3. force-stop 后重新打开 App，再进 NodeSeek 回复框点图片，已有 Key 时应直接打开文件选择器，不再弹授权。
4. NodeSeek、linux.do、妖火各选一张小图上传；上传成功后确认草稿中分别出现 Markdown 图片、Markdown / `upload://` 图片、UBB 图片。
5. 上传后模拟构造回复内容即可，不点击真实发送；需要发送真实回复时必须先得到用户明确同意。
6. 人为制造或遇到发送失败后，回复框必须仍可点击、可改文字、可再次点发送；不允许靠收起再展开恢复。
7. 结束前清空草稿或收起回复框，检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 回复删除验收

改回复、楼层回复、写操作、权限解析或删除按钮时，必须执行。只删除本次测试新发的临时回复，不删除已有历史内容。

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
2. 每个站点找一个回复较多且允许回复的主题，发表一条明确为测试用途的临时回复；如当前改动涉及图片上传，回复内容必须带一张测试图。
3. 新回复出现后，确认只有这条自己的回复显示 `删除`，其他人的回复不显示。
4. 点击 `删除` 后必须出现确认框；取消不会删除，再次点击并确认后才发请求。
5. 删除成功后，当前回复列表立即不再显示这条回复；刷新原帖后仍不显示。
6. 回复框在失败、取消和删除后仍可点击、可编辑，不需要收起再展开。
7. 结束前检查 `ReactNativeJS`、`AndroidRuntime` 没有红屏、未处理异常或崩溃。

## 模拟器验收清单

| 区域 | 必查 | 不默认点击 |
| --- | --- | --- |
| 首页 | 四个来源、分类、阅读筛选、打开详情、返回列表 | 无 |
| 详情 | 来源、标题、作者、时间、正文、回复数、附件、图片预览、返回 | 保存图片、回复、点赞、收藏切换 |
| 搜索 | 关键词、来源分组、结果数、首条、筛选、详情、返回、错误文案 | 外部网页、写操作 |
| 收藏 | 收藏数、来源筛选、分类筛选、已收藏 / 已读状态 | 取消收藏 |
| 历史 | 历史数、最近阅读、已读状态 | 删除、清空历史 |
| 关注用户 | 关注数、用户页、用户主题列表、返回 | 取消关注 |
| 账号与验证 | 三站状态；从 App 内打开登录 / 验证页；确认包名仍为 `com.wz.reader` | 清除登录、退出登录、手工改 Cookie |
| 回复编辑 / 图片上传 | 三站回复框、失败后可继续编辑、格式按钮、图片上传插入草稿、NodeImage 授权和缓存 | 真实发送回复、清除 NodeImage Key |
| 回复删除 | 三站新发临时回复、删除入口、确认框、删除后消失、刷新后仍消失 | 删除旧回复、删除他人回复、清数据制造状态 |
| 测试工具 | 只在开发版可见；正式版不可见；临时匿名开关独立于账号区；说明“不删除 Cookie” | 清数据、退出登录、清 Cookie |
| 更多页 | 版本、检查更新、个人中心当前账号识别、linux.do 等级、备份入口、外观入口 | 导出、导入、安装更新、切换外观 |

## 改动类型对应验证

| 改动类型 | 必跑 |
| --- | --- |
| 来源解析、搜索、详情、用户页 | 对应来源测试、`src/forumApi.test.ts`、`src/localSources.test.ts`、`npm run typecheck`、模拟器验收 |
| App controller、请求归属、取消请求 | 对应 controller helper 测试、`src/requestOwnership.test.ts`、`npm run typecheck`、模拟器验收 |
| 登录、验证、Cookie、写操作 | 相关 cookie / action / session 测试、`src/appSecurity.test.ts`、`npm run typecheck`、模拟器验收 |
| 回复编辑、楼层回复、图片上传、NodeImage Key | 回复图片上传验收、相关 action / WebView script 测试、`npm run typecheck`、模拟器验收 |
| 回复删除、删除权限、评论 id / 删除链接解析 | 回复删除验收、相关 action / 来源解析测试、`npm run typecheck`、模拟器验收 |
| 收藏、历史、备份 / 恢复 | reader data / backup 测试、`src/appSecurity.test.ts`、`npm run typecheck` |
| UI 样式、主题 | 只保留事故级 UI helper 测试、`src/theme.test.ts`、`npm run typecheck`、模拟器验收 |
| 发布、安装、自更新 | `npm run release:android` |

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
| release 签名摘要固定 | `src/releasePackaging.test.ts` | 发布相关改动必须跑 `npm run release:android`；确认签名摘要和 manifest 生成成功 |

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
