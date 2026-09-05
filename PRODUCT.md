# Product

本文只维护品牌、视觉和 accessibility 约束。产品定位与准入标准见 [产品章程](docs/product-charter.md)，现有功能与来源差异见 [产品地图](docs/product-map.md)。

## Brand Personality

克制、清晰、可靠。界面服务于内容与任务，操作层级直接，反馈明确，不用装饰抢占阅读注意力。

## Anti-references

不采用营销页式视觉、渐变炫技、玻璃拟态、装饰性卡片堆叠或为对称而重复的信息。借鉴 linux.do 等成熟产品的紧凑信息层级，但不复制具体社区的品牌外观，也不让站点私有能力破坏阅坛的一致导航。

## Design Principles

- 内容先于装饰，重要状态和主操作应一眼可见。
- 紧凑而不拥挤，用间距、字号和位置建立层级。
- 共享阅读体验保持一致，站点私有能力明确隔离。
- 风险与状态透明，授权、失效、危险操作和失败结果不隐藏。
- 只引入完成当前用户旅程所需的最小完整界面改动。

## Accessibility & Inclusion

保留 Android 字体缩放与 App 阅读设置；文本和控件保持清晰对比，触控目标足够大，交互提供语义标签与状态，不只依赖颜色传达含义。

## 用户资料页

- 资料、标签与内容文字对齐到 16dp 左右边距，采用 4/8/12/16dp 间距层级；姓名 20sp、简介 14sp、统计值 16sp、辅助信息 12sp，并响应字体设置。
- 主操作靠近身份信息，关注前后保持相同位置与尺寸；关注用主题主色实心，已关注用中性描边。触控区域至少 48dp，普通文字对比度至少 4.5:1。
- 用字号、留白和位置组织统计，避免每项套框或重复展示同一语义；详细文字渐进展开，资料随内容滚动，只保留活动标签吸顶。
- 已有内容刷新使用原按钮位置的进度反馈；加载提示不增加资料区高度。首次加载、刷新和分页使用各自对应区域的反馈。
- 交互与无障碍依据 [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility) 和 [Material 按钮层级](https://developer.android.com/develop/ui/compose/components/button)，沿用阅坛现有主题与字体。
