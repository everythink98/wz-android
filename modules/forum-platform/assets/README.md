# 搜索历史图标

这些 SVG 源文件保留 Lucide 1.39.0 的 History 和 X 图标路径，以及搜索行现有的描边宽度。许可证见 `modules/forum-platform/lucide.LICENSE`。

按 SVG 声明的尺寸导出透明背景 PNG，保存到 `modules/forum-platform/android/src/main/res/drawable-xxxhdpi/`：

| 源文件 | PNG 尺寸 | 显示尺寸 |
| --- | --- | --- |
| `wz_search_history.svg` | 68 × 68 | 17 dp |
| `wz_search_close.svg` | 64 × 64 | 16 dp |

保留黑色 Alpha 蒙版，由 `SearchHistoryIconViewManager` 应用当前主题颜色。这些资源直接使用 Android `ImageView`，不经过异步图片加载器。
