# Search history icons

These SVG sources preserve the Lucide 1.39.0 History and X paths and the existing search row stroke widths. Their license is in `../lucide.LICENSE`.

Export transparent PNGs at the SVG's declared size into `../android/src/main/res/drawable-xxxhdpi/`:

| Source | PNG size | Display size |
| --- | --- | --- |
| `wz_search_history.svg` | 68 × 68 | 17dp |
| `wz_search_close.svg` | 64 × 64 | 16dp |

Keep the black alpha mask; `SearchHistoryIconViewManager` applies the current theme color. These resources use the Android `ImageView` directly, without an asynchronous image loader.
