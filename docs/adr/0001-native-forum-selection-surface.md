# ADR-0001：论坛正文使用 Compose 原生连续选择面

- 状态：Accepted
- 日期：2026-08-16

## 背景

React Native 的多个 selectable `TextView` 不能形成跨标题、表格和图片的 Android 系统选区。正文又必须保留既有图片管线、原生导航、表格横滑、代码块复制和 FlashList 物化预算。

## 决策

正文编译器显式产出 `selectable` 与 `island` 物化区域。每个 `selectable` 区域由本地 Expo Android 模块创建一个 Compose `SelectionContainer`；富文本转为 `AnnotatedString`，表格消费 typed row/cell，既有 React Native 媒体组件通过不可复制媒体槽嵌入。代码及其他交互组件继续作为独立交互岛。

原始 HTML 只在共享 sanitizer 后进入编译器；原生解析异常显示编译器提供的安全纯文本，不重新解释未清洗输入。

选择面不改变既有物化和性能契约：compiler 仍只做一次 DOM/post-order analysis，region packing 复用该次 metrics；每个 region 最多 4 个网络媒体。未知块媒体在原生 child 首次正尺寸前使用与既有图片 renderer 一致的全宽 4:3 首帧槽。JS/Yoga 以该 typed 几何提供有界调度高度，Compose 只携带当前 `layoutKey` 回传自然高度并替换它；原生不得另行写 ShadowNode 尺寸。这样既接受真实内容的增长、缩小和归零，也避免 FlashList 因零高 region 一次挂载整篇。Compose table 保留既有 `4dp` 单指横纵仲裁、纵向让行、clamp/fling、无障碍滚动，以及同 `scope + semanticId` 的实时 offset 同步和重挂恢复。

## 取舍

- 不使用 WebView：避免第二套浏览器文档、导航、Cookie 和媒体生命周期。
- 不使用自定义选区 Overlay：避免重写 Android ActionMode、无障碍和文字布局命中。
- 不继续堆叠多个 `TextView`：系统选区无法跨 owner。
- 代价是 Android Release 必须编译本地 Compose 模块，跨媒体槽选择与平台手势需要匹配 APK 的设备验收。
