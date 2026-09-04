package expo.modules.forumcontentselection

import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.functions.Queues

data class ForumSelectionRowRecord(
  @Field val documentId: String = "",
  @Field val rowKey: String = "",
  @Field val nativeId: String = "",
  @Field val selectionToken: String = ""
) : Record

class ForumContentSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForumContentSelection")

    View(ForumContentSelectionView::class) {
      Events("onAutoScroll", "onSelectionChange")

      Prop("enabled") { view: ForumContentSelectionView, enabled: Boolean? ->
        view.pendingEnabled = enabled != false
      }
      Prop("revision") { view: ForumContentSelectionView, revision: String? ->
        view.pendingRevision = revision.orEmpty()
      }
      Prop("rows") { view: ForumContentSelectionView, rows: List<ForumSelectionRowRecord>? ->
        view.pendingRows = rows.orEmpty()
      }

      OnViewDidUpdateProps { view: ForumContentSelectionView ->
        view.commitProps()
      }
      OnViewDestroys { view: ForumContentSelectionView ->
        view.destroy()
      }

      AsyncFunction("cancelSelection") { view: ForumContentSelectionView ->
        view.cancelSelection()
      }.runOnQueue(Queues.MAIN)

      GroupView<ForumContentSelectionView> {
        AddChildView { parent, child: View, index -> parent.addReactChild(child, index) }
        GetChildCount { parent -> parent.reactChildCount() }
        GetChildViewAt { parent, index -> parent.reactChildAt(index) }
        RemoveChildView { parent, child: View -> parent.removeReactChild(child) }
        RemoveChildViewAt { parent, index -> parent.removeReactChildAt(index) }
      }
    }
  }
}
