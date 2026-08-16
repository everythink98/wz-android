package expo.modules.forumcontentselection

import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ForumContentSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForumContentSelection")

    View(ForumContentSelectionView::class) {
      Events("onContentSizeChange", "onLinkPress", "onTableScroll")
      Prop("content") { view: ForumContentSelectionView, value: String -> view.content = value }
      Prop("contentWidth") { view: ForumContentSelectionView, value: Float -> view.contentWidth = value }
      Prop("fallbackText") { view: ForumContentSelectionView, value: String -> view.fallbackText = value }
      Prop("fontFamily") { view: ForumContentSelectionView, value: String? -> view.fontFamily = value }
      Prop("fontSize") { view: ForumContentSelectionView, value: Float -> view.fontSize = value }
      Prop("highlightColor") { view: ForumContentSelectionView, value: String -> view.highlightColor = value }
      Prop("lineColor") { view: ForumContentSelectionView, value: String -> view.lineColor = value }
      Prop("lineHeight") { view: ForumContentSelectionView, value: Float -> view.lineHeight = value }
      Prop("linkColor") { view: ForumContentSelectionView, value: String -> view.linkColor = value }
      Prop("layoutKey") { view: ForumContentSelectionView, value: String -> view.layoutKey = value }
      Prop("query") { view: ForumContentSelectionView, value: String -> view.query = value }
      Prop("textColor") { view: ForumContentSelectionView, value: String -> view.textColor = value }

      GroupView<ForumContentSelectionView> {
        AddChildView { parent, child: View, index -> parent.addMediaChild(child, index) }
        GetChildCount { parent -> parent.mediaChildCount() }
        GetChildViewAt { parent, index -> parent.mediaChildAt(index) }
        RemoveChildView { parent, child: View -> parent.removeMediaChild(child) }
        RemoveChildViewAt { parent, index -> parent.removeMediaChildAt(index) }
      }
    }
  }
}
