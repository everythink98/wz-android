package expo.modules.forumcontentselection

import android.content.Context
import android.graphics.Color as AndroidColor
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.ScrollableDefaults
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.MultiMeasureLayout
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ScrollAxisRange
import androidx.compose.ui.semantics.horizontalScrollAxisRange
import androidx.compose.ui.semantics.scrollBy
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.ExpoComposeView
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

private const val INLINE_MEDIA_SENTINEL = "\u2063"
private const val COPY_BREAK_SENTINEL = "\u2062"

internal fun forumContentMeasurementConstraints(constraints: Constraints) = Constraints(
  minWidth = constraints.minWidth,
  maxWidth = constraints.maxWidth,
  minHeight = 0,
  maxHeight = Constraints.Infinity
)

internal fun forumMediaSlotBounds(
  currentWidth: Int,
  currentHeight: Int,
  fallbackWidth: Int,
  fallbackHeight: Int,
  hasMeasuredSize: Boolean
) = IntRect(
  0,
  0,
  (if (hasMeasuredSize) currentWidth else fallbackWidth).coerceAtLeast(1),
  (if (hasMeasuredSize) currentHeight else fallbackHeight).coerceAtLeast(1)
)

internal enum class ForumTableGestureDecision { CLAIM_HORIZONTAL, PENDING, YIELD }

internal fun forumTableGestureDecision(
  deltaX: Float,
  deltaY: Float,
  pointerCount: Int,
  hasOverflow: Boolean,
  directionLock: Float
): ForumTableGestureDecision {
  if (pointerCount != 1 || !hasOverflow) return ForumTableGestureDecision.YIELD
  if (maxOf(abs(deltaX), abs(deltaY)) < directionLock) return ForumTableGestureDecision.PENDING
  return if (abs(deltaX) > abs(deltaY)) ForumTableGestureDecision.CLAIM_HORIZONTAL else ForumTableGestureDecision.YIELD
}

private object ForumTableScrollStates {
  private data class Entry(val state: ScrollState, var owners: Int)
  private val entries = mutableMapOf<String, Entry>()

  @Synchronized
  fun acquire(key: String, initialOffset: Int): ScrollState {
    val entry = entries.getOrPut(key) { Entry(ScrollState(initialOffset), 0) }
    entry.owners += 1
    return entry.state
  }

  @Synchronized
  fun release(key: String, state: ScrollState) {
    val entry = entries[key] ?: return
    if (entry.state !== state) return
    entry.owners -= 1
    if (entry.owners <= 0) entries.remove(key)
  }
}

@Composable
private fun rememberForumTableScrollState(key: String, initialOffset: Int): ScrollState {
  val state = remember(key) { ForumTableScrollStates.acquire(key, initialOffset) }
  DisposableEffect(key, state) {
    onDispose { ForumTableScrollStates.release(key, state) }
  }
  return state
}

@Suppress("DEPRECATION")
private class MediaFilteringClipboardManager(private val delegate: ClipboardManager) : ClipboardManager {
  override fun getText() = delegate.getText()
  override fun hasText() = delegate.hasText()
  override fun setText(annotatedString: AnnotatedString) {
    delegate.setText(
      AnnotatedString(
        annotatedString.text
          .replace(INLINE_MEDIA_SENTINEL, "")
          .replace(COPY_BREAK_SENTINEL, "\n")
      )
    )
  }
}

private class ForumMediaChild(val host: ExpoComposeView<*>, val view: View) {
  var height = view.height
  var hasMeasuredSize = view.width > 0 && view.height > 0
  var width = view.width
  lateinit var layoutListener: View.OnLayoutChangeListener
}

class ForumContentSelectionView(context: Context, appContext: AppContext) :
  ExpoComposeView<ComposeProps>(context, appContext, withHostingView = true) {
  val onContentSizeChange by EventDispatcher<Map<String, Any>>()
  val onLinkPress by EventDispatcher<Map<String, String>>()
  val onTableScroll by EventDispatcher<Map<String, Any>>()

  var content by mutableStateOf("{}")
  var contentWidth by mutableStateOf(1f)
  var fallbackText by mutableStateOf("")
  var fontFamily by mutableStateOf<String?>(null)
  var fontSize by mutableStateOf(16f)
  var highlightColor by mutableStateOf("#fff3bf")
  var lineColor by mutableStateOf("#d1d5db")
  var lineHeight by mutableStateOf(24f)
  var linkColor by mutableStateOf("#2563eb")
  var layoutKey by mutableStateOf("")
  var query by mutableStateOf("")
  var textColor by mutableStateOf("#111827")

  private val mediaChildren = mutableListOf<ForumMediaChild>()
  private var lastReportedHeight = -1
  private var lastReportedLayoutKey = ""
  private var mediaRevision by mutableIntStateOf(0)

  private fun reportContentHeight(height: Int, density: Float) {
    if (height < 0 || density <= 0f || (lastReportedLayoutKey == layoutKey && lastReportedHeight == height)) return
    val reportedKey = layoutKey
    lastReportedHeight = height
    lastReportedLayoutKey = reportedKey
    post {
      onContentSizeChange(mapOf("height" to height.toDouble() / density, "layoutKey" to reportedKey))
    }
  }

  internal fun addMediaChild(child: View, index: Int) {
    val mediaIndex = index.coerceIn(0, mediaChildren.size)
    val params = child.layoutParams ?: ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    )
    super.addView(child, mediaIndex, params)
    val media = ForumMediaChild(getChildAt(mediaIndex) as ExpoComposeView<*>, child)
    media.layoutListener = View.OnLayoutChangeListener { view, left, top, right, bottom, _, _, _, _ ->
      updateMediaChildSize(view, right - left, bottom - top)
    }
    mediaChildren.add(mediaIndex, media)
    child.addOnLayoutChangeListener(media.layoutListener)
    mediaRevision += 1
    child.post { updateMediaChildSize(child, child.width, child.height) }
  }

  internal fun mediaChildCount() = mediaChildren.size

  internal fun mediaChildAt(index: Int) = mediaChildren[index].view

  internal fun removeMediaChild(child: View) {
    val index = mediaChildren.indexOfFirst { it.view === child }
    if (index >= 0) removeMediaChildAt(index)
  }

  internal fun removeMediaChildAt(index: Int) {
    val media = mediaChildren.removeAt(index)
    media.view.removeOnLayoutChangeListener(media.layoutListener)
    (media.view.parent as? ViewGroup)?.removeView(media.view)
    super.removeView(media.host)
    mediaRevision += 1
  }

  private fun updateMediaChildSize(child: View, width: Int, height: Int) {
    val media = mediaChildren.firstOrNull { it.view === child } ?: return
    if (!media.hasMeasuredSize && (width <= 0 || height <= 0)) return
    if (media.hasMeasuredSize && media.width == width && media.height == height) return
    media.hasMeasuredSize = true
    media.width = width
    media.height = height
    mediaRevision += 1
  }

  @Suppress("DEPRECATION")
  @Composable
  override fun Content(modifier: Modifier) {
    val document = remember(content, fallbackText) {
      runCatching { parseForumSelectionDocument(content, fallbackText) }
        .getOrElse { ForumSelectionDocument(fallbackText, emptyList()) }
    }
    val baseStyle = TextStyle(
      color = color(textColor, Color.Black),
      fontFamily = fontFamily(fontFamily),
      fontSize = fontSize.sp,
      lineHeight = lineHeight.sp
    )
    val revision = mediaRevision
    val clipboard = LocalClipboardManager.current
    val filteringClipboard = remember(clipboard) { MediaFilteringClipboardManager(clipboard) }
    val density = LocalDensity.current.density

    Layout(
      content = {
        CompositionLocalProvider(LocalClipboardManager provides filteringClipboard) {
          SelectionContainer {
            if (document.nodes.isEmpty()) {
              BasicText(document.fallbackText, modifier.fillMaxWidth(), baseStyle)
            } else {
              ForumNodes(document.nodes, revision, baseStyle, modifier.fillMaxWidth())
            }
          }
        }
      },
      modifier = modifier.fillMaxWidth()
    ) { measurables, constraints ->
      val placeable = measurables.single().measure(forumContentMeasurementConstraints(constraints))
      reportContentHeight(placeable.height, density)
      layout(
        placeable.width.coerceIn(constraints.minWidth, constraints.maxWidth),
        placeable.height.coerceIn(constraints.minHeight, constraints.maxHeight)
      ) {
        placeable.place(0, 0)
      }
    }
  }

  @Composable
  private fun ForumNodes(
    nodes: List<ForumSelectionNode>,
    revision: Int,
    baseStyle: TextStyle,
    modifier: Modifier = Modifier
  ) {
    Column(modifier) {
      nodes.forEach { ForumNode(it, revision, baseStyle, true) }
    }
  }

  @Composable
  private fun ForumNode(node: ForumSelectionNode, revision: Int, baseStyle: TextStyle, expand: Boolean) {
    when (node) {
      is ForumSelectionBlock -> ForumBlock(node, revision, baseStyle, expand)
      is ForumSelectionListItem -> ForumListItem(node, revision, baseStyle, expand)
      is ForumSelectionMedia -> ForumBlockMedia(node, revision, expand)
      is ForumSelectionRule -> ForumRule(node.style, expand)
      is ForumSelectionTable -> ForumTable(node, revision, baseStyle)
      is ForumSelectionText -> ForumText(node, revision, baseStyle, expand)
    }
  }

  @OptIn(ExperimentalLayoutApi::class)
  @Composable
  private fun ForumBlock(node: ForumSelectionBlock, revision: Int, baseStyle: TextStyle, expand: Boolean) {
    StyledContainer(node.style, expand) { inner ->
      val gap = (node.style.gap ?: 0f).coerceAtLeast(0f).dp
      when (node.layout) {
        "row" -> Row(
          modifier = inner,
          horizontalArrangement = Arrangement.spacedBy(gap),
          verticalAlignment = if (node.style.alignItems == "center") Alignment.CenterVertically else Alignment.Top
        ) {
          node.children.forEach { ForumNode(it, revision, baseStyle, false) }
        }
        "flow" -> FlowRow(
          modifier = inner,
          horizontalArrangement = Arrangement.spacedBy((node.style.columnGap ?: node.style.gap ?: 0f).coerceAtLeast(0f).dp),
          verticalArrangement = Arrangement.spacedBy((node.style.rowGap ?: node.style.gap ?: 0f).coerceAtLeast(0f).dp)
        ) {
          node.children.forEach { ForumNode(it, revision, baseStyle, false) }
        }
        else -> Column(inner, verticalArrangement = Arrangement.spacedBy(gap)) {
          node.children.forEach { ForumNode(it, revision, baseStyle, true) }
        }
      }
    }
  }

  @Composable
  private fun ForumListItem(node: ForumSelectionListItem, revision: Int, baseStyle: TextStyle, expand: Boolean) {
    StyledContainer(node.style, expand) { inner ->
      Row(inner) {
        if (node.marker.isEmpty()) {
          Box(Modifier.width(node.markerWidth.dp))
        } else {
          BasicText(node.marker, Modifier.width(node.markerWidth.dp), baseStyle)
        }
        Column(Modifier.weight(1f)) {
          node.children.forEach { ForumNode(it, revision, baseStyle, true) }
        }
      }
    }
  }

  @Composable
  private fun ForumBlockMedia(node: ForumSelectionMedia, revision: Int, expand: Boolean) {
    val outer = outerModifier(node.style, expand)
    Box(outer) { MediaSlot(node.slot, revision, Modifier.fillMaxWidth(), node.width, node.height) }
  }

  @Composable
  private fun ForumRule(style: ForumSelectionStyle, expand: Boolean) {
    val width = (style.borderBottomWidth ?: style.borderWidth ?: 1f).coerceAtLeast(0.5f)
    val ruleColor = color(style.borderBottomColor ?: style.borderColor ?: lineColor, Color.Gray)
    Box(outerModifier(style, expand).background(ruleColor).padding(top = width.dp))
  }

  @Composable
  private fun ForumText(node: ForumSelectionText, revision: Int, baseStyle: TextStyle, expand: Boolean) {
    val parsed = remember(node.parts, node.copyBreakAfter, linkColor) {
      annotatedText(node.parts, node.copyBreakAfter)
    }
    val highlighted = remember(parsed, query, highlightColor) {
      highlight(parsed, query, color(highlightColor, Color.Yellow))
    }
    val density = LocalDensity.current
    val inlineContent = remember(node.parts, revision, density) {
      node.parts.filterIsInstance<ForumSelectionInlineMedia>().associate { media ->
        "media-${media.slot}" to InlineTextContent(
          Placeholder(
            with(density) { media.width.dp.toSp() },
            with(density) { media.height.dp.toSp() },
            PlaceholderVerticalAlign.TextCenter
          )
        ) {
          MediaSlot(media.slot, revision, Modifier.fillMaxSize(), media.width, media.height)
        }
      }
    }
    BasicText(
      text = highlighted,
      modifier = if (expand) Modifier.fillMaxWidth() else Modifier,
      style = textStyle(baseStyle, node.style),
      inlineContent = inlineContent
    )
  }

  private fun annotatedText(parts: List<ForumSelectionTextPart>, copyBreakAfter: Boolean): AnnotatedString {
    val builder = AnnotatedString.Builder()
    parts.forEach { part ->
      when (part) {
        is ForumSelectionInlineMedia -> builder.appendInlineContent("media-${part.slot}", INLINE_MEDIA_SENTINEL)
        is ForumSelectionRun -> {
          val start = builder.length
          builder.append(part.text)
          val end = builder.length
          if (end > start) {
            builder.addStyle(spanStyle(part.style), start, end)
            part.href?.let { href ->
              builder.addLink(
                LinkAnnotation.Url(
                  url = href,
                  styles = TextLinkStyles(style = SpanStyle(color = color(part.style.color ?: linkColor, Color.Blue))),
                  linkInteractionListener = { link ->
                    if (link is LinkAnnotation.Url) onLinkPress(mapOf("href" to link.url))
                  }
                ),
                start,
                end
              )
            }
          }
        }
      }
    }
    if (copyBreakAfter) builder.append(COPY_BREAK_SENTINEL)
    return builder.toAnnotatedString()
  }

  @Composable
  private fun MediaSlot(slot: Int, revision: Int, modifier: Modifier, fallbackWidth: Float, fallbackHeight: Float) {
    val media = remember(slot, revision) { mediaChildren.getOrNull(slot) } ?: return
    val density = LocalDensity.current
    val bounds = forumMediaSlotBounds(
      media.width,
      media.height,
      with(density) { fallbackWidth.dp.roundToPx() },
      with(density) { fallbackHeight.dp.roundToPx() },
      media.hasMeasuredSize
    )
    key(media.host) {
      Layout(content = { media.host.Content(Modifier) }, modifier = modifier) { measurables, constraints ->
        val width = bounds.width.coerceIn(constraints.minWidth, constraints.maxWidth)
        val height = bounds.height.coerceIn(constraints.minHeight, constraints.maxHeight)
        val placeable = measurables.single().measure(Constraints.fixed(width, height))
        layout(width, height) { placeable.place(0, 0) }
      }
    }
  }

  @Composable
  private fun ForumTable(table: ForumSelectionTable, revision: Int, baseStyle: TextStyle) {
    val columns = table.columns.coerceAtLeast(1)
    val tableWidth = maxOf(contentWidth, columns * 96f * (fontSize / 16f).coerceAtLeast(0.5f))
    val scroll = rememberForumTableScrollState(table.scrollKey, table.initialOffset)
    val directionLock = with(LocalDensity.current) { 4.dp.toPx() }
    val scope = rememberCoroutineScope()
    val flingBehavior = ScrollableDefaults.flingBehavior()
    val persistOffset = {
      onTableScroll(mapOf("offset" to scroll.value, "semanticId" to table.semanticId))
    }
    val scrollModifier = Modifier
      .pointerInput(scroll, directionLock, table.semanticId) {
        awaitEachGesture {
          val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
          val start = down.position
          val velocityTracker = VelocityTracker().apply { addPosition(down.uptimeMillis, down.position) }
          var claimed = false
          var released = false
          while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            velocityTracker.addPosition(change.uptimeMillis, change.position)
            val pointerCount = event.changes.count { it.pressed || it.previousPressed }
            if (!claimed) {
              if (change.isConsumed) break
              when (
                forumTableGestureDecision(
                  change.position.x - start.x,
                  change.position.y - start.y,
                  pointerCount,
                  scroll.maxValue > 0,
                  directionLock
                )
              ) {
                ForumTableGestureDecision.PENDING -> {
                  if (!change.pressed) break
                  continue
                }
                ForumTableGestureDecision.YIELD -> break
                ForumTableGestureDecision.CLAIM_HORIZONTAL -> claimed = true
              }
            }
            if (pointerCount != 1) break
            val delta = change.positionChange().x
            if (delta != 0f) {
              scroll.dispatchRawDelta(-delta)
              change.consume()
            }
            if (!change.pressed) {
              released = true
              break
            }
          }
          if (claimed) {
            val velocity = if (released) velocityTracker.calculateVelocity().x else 0f
            scope.launch {
              if (velocity != 0f) {
                scroll.scroll {
                  with(flingBehavior) { performFling(-velocity) }
                }
              }
              persistOffset()
            }
          }
        }
      }
      .semantics {
        horizontalScrollAxisRange = ScrollAxisRange(
          value = { scroll.value.toFloat() },
          maxValue = { scroll.maxValue.toFloat() }
        )
        scrollBy { x, _ ->
          scope.launch {
            scroll.scrollTo((scroll.value + x).roundToInt())
            persistOffset()
          }
          true
        }
      }
    val border = 1f
    val radius = 8f
    val first = table.semanticContinuation == "first"
    val last = table.semanticContinuation == "last"
    val only = table.semanticContinuation == "only"
    val frameStyle = ForumSelectionStyle(
      borderBottomLeftRadius = if (only || last) radius else 0f,
      borderBottomRightRadius = if (only || last) radius else 0f,
      borderBottomWidth = if (only || last) border else 0f,
      borderColor = lineColor,
      borderLeftWidth = border,
      borderRightWidth = border,
      borderTopLeftRadius = if (only || first) radius else 0f,
      borderTopRightRadius = if (only || first) radius else 0f,
      borderTopWidth = if (only || first) border else 0f
    )
    Box(Modifier.fillMaxWidth().then(scrollModifier).horizontalScroll(scroll, enabled = false)) {
      ForumTableLayout(
        rows = table.rows,
        columns = columns,
        modifier = contentModifier(frameStyle, Modifier.width(tableWidth.dp))
      ) { cell ->
        StyledContainer(cell.style, true, fillHeight = true) { inner ->
          if (cell.children.isEmpty()) BasicText(cell.text, inner, baseStyle)
          else ForumNodes(cell.children, revision, baseStyle, inner)
        }
      }
    }
  }

  @Composable
  private fun StyledContainer(
    style: ForumSelectionStyle,
    expand: Boolean,
    fillHeight: Boolean = false,
    content: @Composable (Modifier) -> Unit
  ) {
    Box(outerModifier(style, expand)) {
      content(contentModifier(style, if (fillHeight) Modifier.fillMaxSize() else Modifier.fillMaxWidth()))
    }
  }
}

@Composable
private fun ForumTableLayout(
  rows: List<ForumSelectionRow>,
  columns: Int,
  modifier: Modifier,
  cell: @Composable (ForumSelectionCell) -> Unit
) {
  val cells = rows.flatMap { it.cells }
  val placements = remember(rows, columns) { forumTableCellPlacements(rows, columns) }
  MultiMeasureLayout(
    content = { for (item in cells) cell(item) },
    modifier = modifier
  ) { measurables, constraints ->
    val width = if (constraints.maxWidth == Constraints.Infinity) constraints.minWidth else constraints.maxWidth
    val unitWidth = width.coerceAtLeast(columns) / columns
    val naturalPlaceables = measurables.mapIndexed { index, measurable ->
      val placement = placements[index]
      measurable.measure(
        Constraints(
          minWidth = unitWidth * placement.colSpan,
          maxWidth = unitWidth * placement.colSpan,
          minHeight = 0,
          maxHeight = Constraints.Infinity
        )
      )
    }
    val rowHeights = forumTableRowHeights(rows.size, placements, naturalPlaceables.map { it.height })
    val placeables = measurables.mapIndexed { index, measurable ->
      val placement = placements[index]
      measurable.measure(
        Constraints.fixed(
          unitWidth * placement.colSpan,
          forumTableCellHeight(placement, rowHeights)
        )
      )
    }
    val rowOffsets = IntArray(rows.size)
    for (index in 1 until rows.size) rowOffsets[index] = rowOffsets[index - 1] + rowHeights[index - 1]
    layout(width, rowHeights.sum()) {
      placements.forEachIndexed { index, placement ->
        placeables[index].placeRelative(placement.column * unitWidth, rowOffsets[placement.row])
      }
    }
  }
}

private fun outerModifier(style: ForumSelectionStyle, expand: Boolean): Modifier {
  var modifier = if (expand && style.alignSelf != "flex-start") Modifier.fillMaxWidth() else Modifier
  modifier = modifier.padding(
    start = (style.marginLeft ?: 0f).coerceAtLeast(0f).dp,
    top = (style.marginTop ?: 0f).coerceAtLeast(0f).dp,
    end = (style.marginRight ?: 0f).coerceAtLeast(0f).dp,
    bottom = (style.marginBottom ?: 0f).coerceAtLeast(0f).dp
  )
  return modifier
}

private fun contentModifier(style: ForumSelectionStyle, base: Modifier): Modifier {
  val shape = shape(style)
  var modifier = base
  if (hasRadius(style)) modifier = modifier.clip(shape)
  style.backgroundColor?.let { modifier = modifier.background(color(it, Color.Transparent), shape) }
  modifier = modifier.forumBorder(style, shape)
  return modifier.padding(
    start = (style.paddingLeft ?: 0f).coerceAtLeast(0f).dp,
    top = (style.paddingTop ?: 0f).coerceAtLeast(0f).dp,
    end = (style.paddingRight ?: 0f).coerceAtLeast(0f).dp,
    bottom = (style.paddingBottom ?: 0f).coerceAtLeast(0f).dp
  )
}

private fun Modifier.forumBorder(style: ForumSelectionStyle, shape: Shape): Modifier {
  val fallbackWidth = style.borderWidth ?: 0f
  val top = (style.borderTopWidth ?: fallbackWidth).coerceAtLeast(0f)
  val right = (style.borderRightWidth ?: fallbackWidth).coerceAtLeast(0f)
  val bottom = (style.borderBottomWidth ?: fallbackWidth).coerceAtLeast(0f)
  val left = (style.borderLeftWidth ?: fallbackWidth).coerceAtLeast(0f)
  val fallbackColor = style.borderColor ?: "transparent"
  if (top == right && right == bottom && bottom == left && top > 0f) {
    return border(top.dp, color(fallbackColor, Color.Transparent), shape)
  }
  if (top <= 0f && right <= 0f && bottom <= 0f && left <= 0f) return this
  return drawBehind {
    if (top > 0f) drawLine(color(style.borderTopColor ?: fallbackColor, Color.Transparent), Offset.Zero, Offset(size.width, 0f), top.dp.toPx())
    if (right > 0f) drawLine(color(style.borderRightColor ?: fallbackColor, Color.Transparent), Offset(size.width, 0f), Offset(size.width, size.height), right.dp.toPx())
    if (bottom > 0f) drawLine(color(style.borderBottomColor ?: fallbackColor, Color.Transparent), Offset(0f, size.height), Offset(size.width, size.height), bottom.dp.toPx())
    if (left > 0f) drawLine(color(style.borderLeftColor ?: fallbackColor, Color.Transparent), Offset.Zero, Offset(0f, size.height), left.dp.toPx())
  }
}

private fun hasRadius(style: ForumSelectionStyle) = listOf(
  style.borderRadius,
  style.borderTopLeftRadius,
  style.borderTopRightRadius,
  style.borderBottomLeftRadius,
  style.borderBottomRightRadius
).any { (it ?: 0f) > 0f }

private fun shape(style: ForumSelectionStyle): Shape {
  val radius = style.borderRadius ?: 0f
  return RoundedCornerShape(
    topStart = (style.borderTopLeftRadius ?: radius).coerceAtLeast(0f).dp,
    topEnd = (style.borderTopRightRadius ?: radius).coerceAtLeast(0f).dp,
    bottomEnd = (style.borderBottomRightRadius ?: radius).coerceAtLeast(0f).dp,
    bottomStart = (style.borderBottomLeftRadius ?: radius).coerceAtLeast(0f).dp
  )
}

private fun textStyle(base: TextStyle, style: ForumSelectionStyle) = base.copy(
  color = style.color?.let { color(it, base.color) } ?: base.color,
  fontFamily = style.fontFamily?.let(::fontFamily) ?: base.fontFamily,
  fontSize = style.fontSize?.sp ?: base.fontSize,
  fontStyle = fontStyle(style.fontStyle) ?: base.fontStyle,
  fontWeight = fontWeight(style.fontWeight) ?: base.fontWeight,
  lineHeight = style.lineHeight?.sp ?: base.lineHeight,
  textAlign = textAlign(style.textAlign) ?: base.textAlign
)

private fun spanStyle(style: ForumSelectionStyle) = SpanStyle(
  background = style.backgroundColor?.let { color(it, Color.Transparent) } ?: Color.Unspecified,
  color = style.color?.let { color(it, Color.Unspecified) } ?: Color.Unspecified,
  fontFamily = style.fontFamily?.let(::fontFamily),
  fontSize = style.fontSize?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
  fontStyle = fontStyle(style.fontStyle),
  fontWeight = fontWeight(style.fontWeight),
  textDecoration = textDecoration(style.textDecorationLine)
)

private fun fontFamily(value: String?): FontFamily = when {
  value?.contains("mono", ignoreCase = true) == true -> FontFamily.Monospace
  value?.contains("serif", ignoreCase = true) == true -> FontFamily.Serif
  else -> FontFamily.Default
}

private fun fontStyle(value: String?) = if (value == "italic") FontStyle.Italic else null

private fun fontWeight(value: String?) = when (value?.lowercase()) {
  "100" -> FontWeight.W100
  "200" -> FontWeight.W200
  "300" -> FontWeight.W300
  "400", "normal" -> FontWeight.W400
  "500" -> FontWeight.W500
  "600" -> FontWeight.W600
  "700", "bold" -> FontWeight.W700
  "800" -> FontWeight.W800
  "900" -> FontWeight.W900
  else -> null
}

private fun textAlign(value: String?) = when (value) {
  "center" -> TextAlign.Center
  "right" -> TextAlign.Right
  "justify" -> TextAlign.Justify
  else -> null
}

private fun textDecoration(value: String?) = when {
  value?.contains("underline") == true && value.contains("line-through") ->
    TextDecoration.combine(listOf(TextDecoration.Underline, TextDecoration.LineThrough))
  value?.contains("underline") == true -> TextDecoration.Underline
  value?.contains("line-through") == true -> TextDecoration.LineThrough
  else -> null
}

private fun color(value: String, fallback: Color) =
  runCatching { Color(AndroidColor.parseColor(value)) }.getOrDefault(fallback)

private fun highlight(source: AnnotatedString, query: String, background: Color): AnnotatedString {
  val needle = query.trim().lowercase()
  if (needle.isEmpty()) return source
  val builder = AnnotatedString.Builder(source)
  val haystack = source.text.lowercase()
  var cursor = 0
  while (cursor < haystack.length) {
    val index = haystack.indexOf(needle, cursor)
    if (index < 0) break
    builder.addStyle(SpanStyle(background = background), index, index + needle.length)
    cursor = index + needle.length
  }
  return builder.toAnnotatedString()
}
