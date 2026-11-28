package expo.modules.forumcontentselection

import android.view.View
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

private fun ReadableMap?.selectionString(key: String): String =
  if (this != null && hasKey(key) && getType(key) == ReadableType.String) getString(key).orEmpty() else ""

class ForumContentSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForumContentSelection")

    View(ForumContentSelectionView::class) {
      Events("onAutoScroll", "onSelectionChange", "onSelectionError", "onSelectionDragChange", "onHorizontalAutoScroll")

      Prop("horizontalTargets") { view: ForumContentSelectionView, targets: List<String>? ->
        view.horizontalTargets = targets.orEmpty().filter(String::isNotBlank).toSet()
      }

      Prop("enabled") { view: ForumContentSelectionView, enabled: Boolean? ->
        view.pendingEnabled = enabled != false
      }
      Prop("revision") { view: ForumContentSelectionView, revision: String? ->
        view.pendingRevision = revision.orEmpty()
      }
      Prop("rows") { view: ForumContentSelectionView, rows: ReadableArray? ->
        view.pendingRows = if (rows == null) emptyList() else List(rows.size()) { index ->
          val row = if (rows.getType(index) == ReadableType.Map) rows.getMap(index) else null
          ForumSelectionRowDefinition(
            documentId = row.selectionString("documentId"),
            rowKey = row.selectionString("rowKey"),
            nativeId = row.selectionString("nativeId"),
            selectionToken = row.selectionString("selectionToken")
          )
        }
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
