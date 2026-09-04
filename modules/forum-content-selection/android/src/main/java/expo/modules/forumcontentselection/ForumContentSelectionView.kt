package expo.modules.forumcontentselection

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.icu.text.BreakIterator
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import android.text.Layout
import android.util.Log
import android.util.TypedValue
import android.view.ActionMode
import android.view.HapticFeedbackConstants
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.IdentityHashMap
import java.util.Locale
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

internal fun Layout.legacyLineBottomWithoutSpacing(line: Int): Int {
  if (line == lineCount - 1) return getLineBottom(line)
  val multiplier = spacingMultiplier
  if (multiplier == 0f) return getLineBottom(line)
  val spacedHeight = getLineDescent(line) - getLineAscent(line)
  val extra = ((spacedHeight * (multiplier - 1f) + spacingAdd) / multiplier).let {
    if (it >= 0f) (it + 0.5f).toInt() else -(-it + 0.5f).toInt()
  }
  return getLineBottom(line) - extra
}

@android.annotation.TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
private object LayoutApi34 {
  fun lineBottomWithoutSpacing(layout: Layout, line: Int): Int = layout.getLineBottom(line, false)
}

class ForumContentSelectionView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext),
  ViewTreeObserver.OnPreDrawListener,
  ViewTreeObserver.OnScrollChangedListener {
  val onAutoScroll by EventDispatcher<Map<String, Any>>()
  val onSelectionChange by EventDispatcher<Map<String, Any>>()

  internal var pendingEnabled = true
  internal var pendingRevision = ""
  internal var pendingRows: List<ForumSelectionRowRecord> = emptyList()
  internal var hapticFeedbackObserverForTest: ((Int) -> Unit)? = null
  internal var selectionChangeObserverForTest: ((Map<String, Any>) -> Unit)? = null
  internal var systemActionLoaderForTest:
    ((String, (List<ForumSelectionSystemAction>) -> Unit) -> List<ForumSelectionSystemAction>)? = null

  private val selectionDocument = ForumSelectionDocument()
  private val platformSystemActions = ForumSelectionSystemActionOwner(
    create = { ForumSelectionPlatformActions(this) { appContext.currentActivity } },
    cancelOwner = ForumSelectionPlatformActions::cancelPendingClassification
  )
  private val density = resources.displayMetrics.density
  private val longPressMotionTolerance = forumLongPressMotionTolerancePx(
    ViewConfiguration.get(context).scaledTouchSlop.toFloat(),
    density
  )
  private val handleTouchHalfWidth = 24f * density
  private val handleTouchHeight = 48f * density
  private val highlightColor = resolveThemeColor(context, android.R.attr.textColorHighlight, 0x523376FF)
  private val localHighlights = IdentityHashMap<TextView, LocalHighlight>()
  private val markedRowAlignments = IdentityHashMap<View, CachedMarkedRowAlignment>()
  private val hostScreenLocation = IntArray(2)
  private val childScreenLocation = IntArray(2)
  private val localVisibleRect = Rect()
  private val cursorPath = Path()
  private val cursorPathBounds = RectF()
  private var enabled = true
  private var preDrawAttached = false
  private var selectionActive = false
  private var activeSelectionRevision = ""
  private var actionMode: ActionMode? = null
  private var systemActionRequest: ForumSelectionSystemActionRequest? = null
  private var systemActionGeneration = 0L
  private var systemActions = emptyList<ForumSelectionSystemAction>()
  private var systemActionMenuDirty = false
  private val systemActionsByMenuId = mutableMapOf<Int, BoundForumSelectionSystemAction>()
  private var destroying = false
  private var suppressActionModeDestroy = false
  private var downTime = 0L
  private var downX = 0f
  private var downY = 0f
  private var lastTouchX = 0f
  private var lastTouchY = 0f
  private var activePointerId = MotionEvent.INVALID_POINTER_ID
  private var coordinatorOwnsGesture = false
  private var selectionGestureRoot: View? = null
  private var cancelSelectionOnTap = false
  private var draggingHandle: DraggingHandle? = null
  private var handleDragOffsetX = 0f
  private var handleDragOffsetY = 0f
  private var autoScrollPosted = false
  private var lastErrorCode: String? = null
  private var scrollRedrawPending = false
  private var startLocalHandle: LocalHandle? = null
  private var endLocalHandle: LocalHandle? = null
  private var startHandlePoint: PointF? = null
  private var endHandlePoint: PointF? = null
  private var alignmentBuildCount = 0
  private val longPressRunnable = Runnable { beginLongPressSelection() }
  private val autoScrollRunnable = object : Runnable {
    override fun run() {
      autoScrollPosted = false
      if (!selectionActive || draggingHandle == null) return
      val payload = runAutoScrollFrame() ?: return
      onAutoScroll(payload.asEventMap())
      postAutoScroll()
    }
  }

  init {
    orientation = VERTICAL
    isLongClickable = false
    isFocusable = false
  }

  internal fun commitProps() {
    enabled = pendingEnabled
    if (!enabled || pendingRevision.isBlank()) {
      selectionDocument.reset()
      cancelSelection()
      return
    }
    val rows = pendingRows.map {
      ForumSelectionRowDefinition(
        documentId = it.documentId,
        rowKey = it.rowKey,
        nativeId = it.nativeId,
        selectionToken = it.selectionToken
      )
    }
    val hadActiveSelection = selectionActive || selectionDocument.selection() != null
    when (val update = selectionDocument.replace(pendingRevision, rows)) {
      ForumSelectionUpdate.Applied -> {
        lastErrorCode = null
        if (hadActiveSelection && selectionDocument.selection() == null) {
          cancelSelection()
        } else {
          if (selectionDocument.selection() == null) setSelectionActive(false)
          refreshOverlay()
        }
      }
      is ForumSelectionUpdate.Invalid -> {
        cancelSelection()
        emitError(update.failure.eventCode())
      }
    }
  }

  internal fun addReactChild(child: View, index: Int) {
    addView(child, index)
  }

  internal fun reactChildCount(): Int = childCount

  internal fun reactChildAt(index: Int): View? = getChildAt(index)

  internal fun removeReactChild(child: View) {
    removeView(child)
  }

  internal fun removeReactChildAt(index: Int) {
    removeViewAt(index)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (selectionActive) attachPreDraw()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(longPressRunnable)
    selectionGestureRoot = null
    cancelSelectionOnTap = false
    removeCallbacks(autoScrollRunnable)
    autoScrollPosted = false
    detachPreDraw()
    if (!destroying) cancelSelection()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    if (selectionActive) refreshOverlay()
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!enabled || !selectionDocument.isEnabled) return super.dispatchTouchEvent(event)
    lastTouchX = event.x
    lastTouchY = event.y
    var cancelAfterDispatch = false

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        activePointerId = event.getPointerId(0)
        downTime = event.downTime
        downX = event.x
        downY = event.y
        handleDragOffsetX = 0f
        handleDragOffsetY = 0f
        val touchedHandle = handleAt(event.x, event.y)
        draggingHandle = touchedHandle?.first
        if (touchedHandle != null) {
          handleDragOffsetX = touchedHandle.second.x - event.x
          handleDragOffsetY = touchedHandle.second.y - event.y
          cancelSelectionOnTap = false
          coordinatorOwnsGesture = true
          parent?.requestDisallowInterceptTouchEvent(true)
          return true
        }
        cancelSelectionOnTap = selectionActive
        coordinatorOwnsGesture = false
        removeCallbacks(longPressRunnable)
        selectionGestureRoot = markedSelectionRowAt(event.x, event.y)
        if (selectionGestureRoot != null) {
          postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
        }
      }
      MotionEvent.ACTION_MOVE -> {
        val pointerIndex = event.findPointerIndex(activePointerId)
        if (pointerIndex < 0) {
          cancelSelectionOnTap = false
          return finishOwnedGesture(cancelled = true)
        }
        val x = event.getX(pointerIndex)
        val y = event.getY(pointerIndex)
        lastTouchX = x
        lastTouchY = y
        if (coordinatorOwnsGesture) {
          updateDraggedHandle(x, y)
          postAutoScroll()
          return true
        }
        if (hypot(x - downX, y - downY) > longPressMotionTolerance) {
          cancelSelectionOnTap = false
          removeCallbacks(longPressRunnable)
        }
      }
      MotionEvent.ACTION_UP -> {
        removeCallbacks(longPressRunnable)
        if (coordinatorOwnsGesture) {
          cancelSelectionOnTap = false
          return finishOwnedGesture(cancelled = false)
        }
        cancelAfterDispatch = cancelSelectionOnTap &&
          event.eventTime - downTime < ViewConfiguration.getLongPressTimeout().toLong() &&
          hypot(event.x - downX, event.y - downY) <= longPressMotionTolerance
        cancelSelectionOnTap = false
        activePointerId = MotionEvent.INVALID_POINTER_ID
        selectionGestureRoot = null
      }
      MotionEvent.ACTION_CANCEL -> {
        removeCallbacks(longPressRunnable)
        cancelSelectionOnTap = false
        if (coordinatorOwnsGesture) return finishOwnedGesture(cancelled = true)
        activePointerId = MotionEvent.INVALID_POINTER_ID
        selectionGestureRoot = null
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        cancelSelectionOnTap = false
        removeCallbacks(longPressRunnable)
      }
    }
    return try {
      super.dispatchTouchEvent(event)
    } finally {
      if (cancelAfterDispatch) cancelSelection()
    }
  }

  private fun beginLongPressSelection() {
    if (!isAttachedToWindow || !enabled || coordinatorOwnsGesture || selectionGestureRoot == null) {
      return
    }
    cancelSelectionOnTap = false
    val mounted = mountedOwners(selectionGestureRoot ?: return)
    if (mounted.deferred) {
      postOnAnimation(longPressRunnable)
      return
    }
    val hit = hitTest(mounted.owners, downX, downY) ?: return
    val word = wordRange(hit.owner.text, hit.offset)
    val start = selectionDocument.anchor(
      hit.owner.row.documentId,
      hit.owner.row.rowKey,
      hit.owner.ownerOrdinal,
      word.first,
      ForumSelectionAffinity.Downstream
    ) ?: return
    val end = selectionDocument.anchor(
      hit.owner.row.documentId,
      hit.owner.row.rowKey,
      hit.owner.ownerOrdinal,
      word.last + 1,
      ForumSelectionAffinity.Upstream
    ) ?: return
    if (!selectionDocument.select(start, end)) return

    coordinatorOwnsGesture = true
    draggingHandle = DraggingHandle.RawEnd
    parent?.requestDisallowInterceptTouchEvent(true)
    cancelChildTouch()
    setSelectionActive(true)
    startSelectionActionMode()
    refreshOverlay()
    draggingHandlePoint()?.let { point ->
      handleDragOffsetX = point.x - downX
      handleDragOffsetY = point.y - downY
    }
    requestHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
  }

  private fun cancelChildTouch() {
    val cancel = MotionEvent.obtain(
      downTime,
      SystemClock.uptimeMillis(),
      MotionEvent.ACTION_CANCEL,
      downX,
      downY,
      0
    )
    try {
      super.dispatchTouchEvent(cancel)
    } finally {
      cancel.recycle()
    }
  }

  private fun updateDraggedHandle(x: Float, y: Float) {
    val endpoint = draggingHandle ?: return
    val adjustedX = (x + handleDragOffsetX).coerceIn(0f, max(0f, width - 1f))
    val adjustedY = (y + handleDragOffsetY).coerceIn(0f, max(0f, height - 1f))
    // A line-bottom hotspot sits on the previous row's bottom-exclusive edge.
    val hitY = adjustedY - 0.5f
    val mounted = mountedOwners(markedSelectionRowAt(adjustedX, hitY) ?: return)
    if (mounted.deferred) return
    val hit = hitTest(mounted.owners, adjustedX, hitY) ?: return
    val current = selectionDocument.selection() ?: return
    val currentEndpoint = if (endpoint == DraggingHandle.RawStart) current.start else current.end
    val otherEndpoint = if (endpoint == DraggingHandle.RawStart) current.end else current.start
    val provisional = selectionDocument.anchor(
      hit.owner.row.documentId,
      hit.owner.row.rowKey,
      hit.owner.ownerOrdinal,
      hit.offset,
      currentEndpoint.affinity
    ) ?: return
    if (provisional == currentEndpoint && hit.mediaSide == null) return
    val candidateIsNormalizedStart = (selectionDocument.compareAnchors(provisional, otherEndpoint) ?: return) <= 0
    val anchor = provisional.copy(affinity = hit.mediaSide.affinityFor(candidateIsNormalizedStart))
    val updated = if (endpoint == DraggingHandle.RawStart) {
      selectionDocument.select(anchor, current.end)
    } else {
      selectionDocument.select(current.start, anchor)
    }
    if (updated) {
      refreshOverlay()
      actionMode?.invalidate()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        requestHapticFeedback(HapticFeedbackConstants.TEXT_HANDLE_MOVE)
      }
    }
  }

  private fun finishOwnedGesture(cancelled: Boolean): Boolean {
    removeCallbacks(longPressRunnable)
    removeCallbacks(autoScrollRunnable)
    autoScrollPosted = false
    draggingHandle = null
    handleDragOffsetX = 0f
    handleDragOffsetY = 0f
    coordinatorOwnsGesture = false
    activePointerId = MotionEvent.INVALID_POINTER_ID
    selectionGestureRoot = null
    cancelSelectionOnTap = false
    parent?.requestDisallowInterceptTouchEvent(false)
    if (cancelled && selectionDocument.selection() == null) setSelectionActive(false)
    actionMode?.invalidate()
    return true
  }

  private fun requestHapticFeedback(constant: Int) {
    hapticFeedbackObserverForTest?.invoke(constant)
    performHapticFeedback(constant)
  }

  internal fun cancelSelection() {
    clearSystemActionRequest()
    selectionDocument.cancel()
    removeCallbacks(longPressRunnable)
    removeCallbacks(autoScrollRunnable)
    autoScrollPosted = false
    draggingHandle = null
    handleDragOffsetX = 0f
    handleDragOffsetY = 0f
    coordinatorOwnsGesture = false
    activePointerId = MotionEvent.INVALID_POINTER_ID
    selectionGestureRoot = null
    cancelSelectionOnTap = false
    parent?.requestDisallowInterceptTouchEvent(false)
    markedRowAlignments.clear()
    clearOverlay()
    setSelectionActive(false)
    val mode = actionMode
    actionMode = null
    if (mode != null) {
      suppressActionModeDestroy = true
      mode.finish()
      suppressActionModeDestroy = false
    }
  }

  internal fun destroy() {
    destroying = true
    cancelSelection()
    detachPreDraw()
    selectionDocument.reset()
    platformSystemActions.close()
  }

  override fun onPreDraw(): Boolean {
    if (selectionActive) {
      refreshOverlay(invalidate = false)
      if (scrollRedrawPending) {
        scrollRedrawPending = false
        actionMode?.invalidateContentRect()
      }
    }
    return true
  }

  override fun onScrollChanged() {
    if (!selectionActive) return
    scrollRedrawPending = true
    startLocalHandle?.drawable?.invalidateSelf()
    endLocalHandle?.drawable?.invalidateSelf()
  }

  private fun refreshOverlay(invalidate: Boolean = true) {
    if (!selectionActive || selectionDocument.selection() == null || width <= 0 || height <= 0) {
      clearOverlay(invalidate)
      return
    }
    val mounted = mountedOwners(this).owners
    val normalized = selectionDocument.normalizedSelection()
    if (normalized == null) {
      clearOverlay(invalidate)
      return
    }

    val wantedHighlights = IdentityHashMap<TextView, HighlightProjection>()
    mounted.forEach { owner ->
      val layout = owner.view.layout ?: return@forEach
      val slice = selectionDocument.selectedSlice(
        owner.row.documentId,
        owner.row.rowKey,
        owner.ownerOrdinal
      )
      if (slice != null) {
        val layoutStart = owner.offsetMap.layoutOffset(slice.startOffset, slice.startAffinity)
        val layoutEnd = owner.offsetMap.layoutOffset(slice.endOffset, slice.endAffinity)
        if (layoutStart < layoutEnd) {
          wantedHighlights[owner.view] = HighlightProjection(
            documentId = owner.row.documentId,
            rowKey = owner.row.rowKey,
            ownerOrdinal = owner.ownerOrdinal,
            layout = layout,
            layoutStart = layoutStart,
            layoutEnd = layoutEnd,
            width = owner.view.width,
            height = owner.view.height,
            paddingLeft = owner.view.totalPaddingLeft,
            paddingTop = owner.view.totalPaddingTop
          )
        }
      }
    }
    syncLocalHighlights(wantedHighlights)
    updateHandleGeometry(
      mounted.firstOrNull { it.matches(normalized.start) },
      normalized.start,
      mounted.firstOrNull { it.matches(normalized.end) },
      normalized.end
    )
    if (invalidate) {
      invalidate()
      actionMode?.invalidateContentRect()
    }
  }

  private fun syncLocalHighlights(wanted: IdentityHashMap<TextView, HighlightProjection>) {
    val iterator = localHighlights.entries.iterator()
    while (iterator.hasNext()) {
      val (view, highlight) = iterator.next()
      if (!wanted.containsKey(view)) {
        view.overlay.remove(highlight.drawable)
        iterator.remove()
      }
    }
    wanted.forEach { (view, projection) ->
      val current = localHighlights[view]
      if (current?.projection == projection) return@forEach

      val path = Path()
      projection.layout.getSelectionPath(projection.layoutStart, projection.layoutEnd, path)
      path.offset(projection.paddingLeft.toFloat(), projection.paddingTop.toFloat())
      if (current == null) {
        val drawable = ForumSelectionHighlightDrawable(highlightColor)
        drawable.update(path, projection.width, projection.height)
        view.overlay.add(drawable)
        localHighlights[view] = LocalHighlight(drawable, projection)
      } else {
        current.projection = projection
        current.drawable.update(path, projection.width, projection.height)
      }
    }
  }

  private fun updateHandleGeometry(
    startOwner: MountedOwner?,
    startAnchor: ForumSelectionAnchor,
    endOwner: MountedOwner?,
    endAnchor: ForumSelectionAnchor
  ) {
    getLocationOnScreen(hostScreenLocation)
    val start = handleProjection(startOwner, startAnchor, isStartHandle = true)
    val end = handleProjection(endOwner, endAnchor, isStartHandle = false)
    startHandlePoint = visibleRoutePoint(start)
    endHandlePoint = visibleRoutePoint(end)
    startLocalHandle = syncLocalHandle(startLocalHandle, start, startHandlePoint != null)
    endLocalHandle = syncLocalHandle(endLocalHandle, end, endHandlePoint != null)
  }

  private fun handleProjection(
    owner: MountedOwner?,
    anchor: ForumSelectionAnchor,
    isStartHandle: Boolean
  ): HandleProjection? {
    if (owner == null || !owner.matches(anchor)) return null
    val view = owner.view
    val layout = view.layout ?: return null
    val layoutOffset = owner.offsetMap.layoutOffset(anchor.utf16Offset, anchor.affinity)
    val offset = layoutOffset.coerceIn(0, layout.text.length)
    val line = layout.getLineForOffset(offset)
    val offsetToCheck = if (isStartHandle) offset else max(offset - 1, 0)
    val isRtlRun = layout.isRtlCharAt(offsetToCheck)
    val isRtlParagraph = layout.getParagraphDirection(line) == Layout.DIR_RIGHT_TO_LEFT
    val horizontal = if (isRtlRun != isRtlParagraph) {
      layout.getSecondaryHorizontal(offset)
    } else {
      layout.getPrimaryHorizontal(offset)
    }
    val contentPoint = PointF(
      view.totalPaddingLeft + horizontal,
      view.totalPaddingTop + lineBottomWithoutSpacing(layout, line, offset)
    )
    view.getLocationOnScreen(childScreenLocation)
    val routePoint = PointF(
      childScreenLocation[0] - hostScreenLocation[0] + contentPoint.x - view.scrollX,
      childScreenLocation[1] - hostScreenLocation[1] + contentPoint.y - view.scrollY
    )
    val direction = if (isRtlRun == isStartHandle) HandleDrawableDirection.Right else HandleDrawableDirection.Left
    return HandleProjection(view, handleOverlayHost(owner.overlayHost), contentPoint, routePoint, direction)
  }

  @Suppress("DEPRECATION")
  private fun lineBottomWithoutSpacing(layout: Layout, line: Int, offset: Int): Float {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return LayoutApi34.lineBottomWithoutSpacing(layout, line).toFloat()
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      layout.getCursorPath(offset, cursorPath, "")
      cursorPath.computeBounds(cursorPathBounds, true)
      return cursorPathBounds.bottom
    }
    return layout.legacyLineBottomWithoutSpacing(line).toFloat()
  }

  private fun handleOverlayHost(markedRow: View): View {
    var directChild = markedRow
    while (true) {
      val parent = directChild.parent
      if (parent === this) break
      directChild = parent as? View ?: return this
    }
    return directChild.takeIf {
      childCount == 1 && getChildAt(0) === it && it.width >= width && it.height >= height
    } ?: this
  }

  private fun visibleRoutePoint(projection: HandleProjection?): PointF? {
    projection ?: return null
    val clip = ownerVisibleClip(projection.view) ?: return null
    return projection.routePoint.takeIf { it.x in clip.left..clip.right && it.y in clip.top..clip.bottom }
  }

  private fun syncLocalHandle(
    current: LocalHandle?,
    projection: HandleProjection?,
    visible: Boolean
  ): LocalHandle? {
    if (projection == null) {
      current?.overlayHost?.overlay?.remove(current.drawable)
      return null
    }
    val drawing = HandleDrawingProjection(
      x = projection.contentPoint.x,
      y = projection.contentPoint.y,
      routeX = projection.routePoint.x,
      routeY = projection.routePoint.y,
      visible = visible,
      hostWidth = projection.overlayHost.width,
      hostHeight = projection.overlayHost.height,
      direction = projection.direction
    )
    if (
      current?.overlayHost === projection.overlayHost &&
      current.sourceView === projection.view &&
      current.projection.direction == drawing.direction
    ) {
      if (current.projection != drawing) {
        current.projection = drawing
        current.drawable.update(projection.contentPoint)
      }
      return current
    }
    current?.overlayHost?.overlay?.remove(current.drawable)
    val platformDrawable = selectionHandleDrawable(projection.view, drawing.direction) ?: return null
    val drawable = ForumSelectionPlatformHandleDrawable(
      sourceView = projection.view,
      overlayHost = projection.overlayHost,
      platformDrawable = platformDrawable,
      hotspotQuarter = if (drawing.direction == HandleDrawableDirection.Left) 3 else 1
    )
    drawable.update(projection.contentPoint)
    projection.overlayHost.overlay.add(drawable)
    return LocalHandle(projection.overlayHost, projection.view, drawable, drawing)
  }

  private fun selectionHandleDrawable(view: TextView, direction: HandleDrawableDirection): Drawable? {
    val attribute = when (direction) {
      HandleDrawableDirection.Left -> android.R.attr.textSelectHandleLeft
      HandleDrawableDirection.Right -> android.R.attr.textSelectHandleRight
    }
    val configured = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      when (direction) {
        HandleDrawableDirection.Left -> view.textSelectHandleLeft
        HandleDrawableDirection.Right -> view.textSelectHandleRight
      }
    } else {
      null
    }
    val drawable = configured?.constantState
      ?.newDrawable(view.resources, view.context.theme)
      ?.mutate()
      ?: resolveTextViewDrawable(view.context, attribute)
      ?: return null
    drawable.state = view.drawableState
    drawable.layoutDirection = view.layoutDirection
    return drawable
  }

  private fun mountedOwners(root: View): MountedOwnerCollection {
    val markerRoots = LinkedHashMap<String, MutableList<View>>()
    collectMarkedRows(root, markerRoots)
    val owners = ArrayList<MountedOwner>()
    val mountedRoots = IdentityHashMap<View, Boolean>()
    var deferred = false
    markerRoots.values.forEach { roots ->
      if (roots.size != 1) {
        roots.forEach(markedRowAlignments::remove)
        deferred = true
        return@forEach
      }
      val markerRoot = roots.single()
      mountedRoots[markerRoot] = true
      val nativeId = markerRoot.getTag(R.id.view_tag_native_id) as? String ?: return@forEach
      val row = selectionDocument.rowForNativeId(nativeId) ?: return@forEach
      when (val alignment = alignMarkedRow(markerRoot, row)) {
        is MarkedRowAlignment.Ready -> owners += alignment.owners
        MarkedRowAlignment.Deferred -> deferred = true
      }
    }
    if (root === this) {
      val iterator = markedRowAlignments.keys.iterator()
      while (iterator.hasNext()) {
        if (!mountedRoots.containsKey(iterator.next())) iterator.remove()
      }
    }
    return MountedOwnerCollection(owners, deferred)
  }

  private fun collectMarkedRows(view: View, output: MutableMap<String, MutableList<View>>) {
    val nativeId = view.getTag(R.id.view_tag_native_id) as? String
    val markedRow = nativeId?.let(selectionDocument::rowForNativeId)
    if (markedRow != null) {
      output.getOrPut(markedRow.nativeId, ::mutableListOf).add(view)
      return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        collectMarkedRows(view.getChildAt(index), output)
      }
    }
  }

  private fun alignMarkedRow(root: View, row: ForumSelectionRowDefinition): MarkedRowAlignment {
    val candidates = ArrayList<TextView>()
    collectTextCandidates(root, candidates)
    markedRowAlignments[root]?.takeIf { it.matches(row, candidates) }?.let {
      return MarkedRowAlignment.Ready(it.owners)
    }
    markedRowAlignments.remove(root)
    val expectedTexts = selectionDocument.expectedOwnerTexts(row.documentId, row.rowKey)
      ?: return MarkedRowAlignment.Deferred
    if (expectedTexts.isEmpty()) {
      val alignment = CachedMarkedRowAlignment(row, candidates, emptyList())
      markedRowAlignments[root] = alignment
      alignmentBuildCount += 1
      return MarkedRowAlignment.Ready(emptyList())
    }
    val earliest = alignOwners(root, row, candidates, expectedTexts, reverse = false)
      ?: return MarkedRowAlignment.Deferred
    val latest = alignOwners(root, row, candidates, expectedTexts, reverse = true)
      ?: return MarkedRowAlignment.Deferred
    if (earliest.indices.any { earliest[it].view !== latest[it].view }) return MarkedRowAlignment.Deferred
    markedRowAlignments[root] = CachedMarkedRowAlignment(row, candidates, earliest)
    alignmentBuildCount += 1
    return MarkedRowAlignment.Ready(earliest)
  }

  private fun collectTextCandidates(view: View, output: MutableList<TextView>) {
    if (!view.isShown) return
    if (view is TextView) {
      output += view
      return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) collectTextCandidates(view.getChildAt(index), output)
    }
  }

  private fun alignOwners(
    overlayHost: View,
    row: ForumSelectionRowDefinition,
    candidates: List<TextView>,
    expectedTexts: List<String>,
    reverse: Boolean
  ): List<MountedOwner>? {
    val aligned = arrayOfNulls<MountedOwner>(expectedTexts.size)
    val step = if (reverse) -1 else 1
    var candidateIndex = if (reverse) candidates.lastIndex else 0
    val ownerOrdinals = if (reverse) expectedTexts.indices.reversed() else expectedTexts.indices
    for (ownerOrdinal in ownerOrdinals) {
      var matched = false
      while (candidateIndex in candidates.indices) {
        val view = candidates[candidateIndex]
        when (val mapping = forumTextLayoutMapping(view, expectedTexts[ownerOrdinal])) {
          is ForumTextLayoutMapping.Ready -> {
            aligned[ownerOrdinal] = MountedOwner(
              row,
              ownerOrdinal,
              view,
              overlayHost,
              mapping.offsets.logicalText,
              mapping.offsets
            )
            candidateIndex += step
            matched = true
            break
          }
          ForumTextLayoutMapping.NotOwner -> candidateIndex += step
          ForumTextLayoutMapping.StaleLayout,
          ForumTextLayoutMapping.AmbiguousReplacementRanges -> return null
        }
      }
      if (!matched) return null
    }
    return aligned.map { it ?: return null }
  }

  private fun markedSelectionRowAt(hostX: Float, hostY: Float): View? {
    getLocationOnScreen(hostScreenLocation)
    return markedSelectionRowAt(
      this,
      hostScreenLocation[0] + hostX.toInt(),
      hostScreenLocation[1] + hostY.toInt()
    )
  }

  private fun markedSelectionRowAt(
    view: View,
    screenX: Int,
    screenY: Int
  ): View? {
    view.getLocationOnScreen(childScreenLocation)
    val localX = screenX - childScreenLocation[0] + view.scrollX
    val localY = screenY - childScreenLocation[1] + view.scrollY
    if (
      !view.isShown ||
      !view.getLocalVisibleRect(localVisibleRect) ||
      !localVisibleRect.contains(localX, localY)
    ) return null
    val nativeId = view.getTag(R.id.view_tag_native_id) as? String
    if (nativeId != null && selectionDocument.rowForNativeId(nativeId) != null) return view
    if (view is ViewGroup) {
      for (index in view.childCount - 1 downTo 0) {
        markedSelectionRowAt(view.getChildAt(index), screenX, screenY)?.let { return it }
      }
    }
    return null
  }

  private fun hitTest(owners: List<MountedOwner>, hostX: Float, hostY: Float): HitResult? {
    getLocationOnScreen(hostScreenLocation)
    val screenX = hostScreenLocation[0] + hostX
    val screenY = hostScreenLocation[1] + hostY
    for (owner in owners.asReversed()) {
      if (owner.text.isEmpty()) continue
      val view = owner.view
      view.getLocationOnScreen(childScreenLocation)
      val localX = screenX - childScreenLocation[0] + view.scrollX
      val localY = screenY - childScreenLocation[1] + view.scrollY
      if (
        !view.getLocalVisibleRect(localVisibleRect) ||
        localX < localVisibleRect.left || localX >= localVisibleRect.right ||
        localY < localVisibleRect.top || localY >= localVisibleRect.bottom
      ) {
        continue
      }
      val layout = view.layout ?: continue
      val layoutX = localX - view.totalPaddingLeft
      val layoutY = localY - view.totalPaddingTop
      val line = layout.getLineForVertical(layoutY.toInt().coerceIn(0, max(0, layout.height - 1)))
      val layoutOffset = layout.getOffsetForHorizontal(line, layoutX).coerceIn(0, layout.text.length)
      val logicalOffset = owner.offsetMap.layoutToLogical(layoutOffset).coerceIn(0, owner.text.length)
      val removedRange = owner.offsetMap.removedRangeAt(layoutOffset)
      val mediaSide = if (removedRange == null) {
        null
      } else if (layoutOffset * 2 <= removedRange.start + removedRange.end) {
        MediaSide.Before
      } else {
        MediaSide.After
      }
      return HitResult(owner, logicalOffset, mediaSide)
    }
    return null
  }

  private fun wordRange(text: String, rawOffset: Int): IntRange {
    if (text.isEmpty()) return 0 until 0
    val probe = rawOffset.coerceIn(0, text.length - 1)
    val words = BreakIterator.getWordInstance(Locale.getDefault()).apply { setText(text) }
    var start = words.preceding(probe + 1)
    var end = words.following(probe)
    if (start == BreakIterator.DONE) start = 0
    if (end == BreakIterator.DONE) end = text.length
    if (start >= end || text.substring(start, end).all(Char::isWhitespace)) {
      val characters = BreakIterator.getCharacterInstance(Locale.getDefault()).apply { setText(text) }
      start = characters.preceding(probe + 1).takeUnless { it == BreakIterator.DONE } ?: probe
      end = characters.following(probe).takeUnless { it == BreakIterator.DONE } ?: text.length
    }
    return start until end
  }

  private fun ownerVisibleClip(view: TextView): RectF? {
    if (!view.getLocalVisibleRect(localVisibleRect)) return null
    view.getLocationOnScreen(childScreenLocation)
    val viewLeft = (childScreenLocation[0] - hostScreenLocation[0] - view.scrollX).toFloat()
    val viewTop = (childScreenLocation[1] - hostScreenLocation[1] - view.scrollY).toFloat()
    val left = max(0f, viewLeft + localVisibleRect.left)
    val top = max(0f, viewTop + localVisibleRect.top)
    val right = min(width.toFloat(), viewLeft + localVisibleRect.right)
    val bottom = min(height.toFloat(), viewTop + localVisibleRect.bottom)
    return RectF(left, top, right, bottom).takeIf { it.width() > 0f && it.height() > 0f }
  }

  private fun handleAt(x: Float, y: Float): Pair<DraggingHandle, PointF>? {
    val selection = selectionDocument.selection() ?: return null
    val rawStartIsVisibleStart = (selectionDocument.compareAnchors(selection.start, selection.end) ?: return null) <= 0
    val candidates = listOf(
      (if (rawStartIsVisibleStart) DraggingHandle.RawStart else DraggingHandle.RawEnd) to startHandlePoint,
      (if (rawStartIsVisibleStart) DraggingHandle.RawEnd else DraggingHandle.RawStart) to endHandlePoint
    ).mapNotNull { (handle, point) -> point?.let { Triple(handle, it, hypot(x - it.x, y - it.y)) } }
      .filter { (_, point, _) ->
        val targetWidth = min(width.toFloat(), handleTouchHalfWidth * 2f)
        val targetHeight = min(height.toFloat(), handleTouchHeight)
        val left = (point.x - handleTouchHalfWidth).coerceIn(0f, max(0f, width - targetWidth))
        val top = point.y.coerceIn(0f, max(0f, height - targetHeight))
        x in left..(left + targetWidth) && y in top..(top + targetHeight)
      }
    return candidates.minByOrNull { it.third }?.let { it.first to it.second }
  }

  private fun draggingHandlePoint(): PointF? {
    val handle = draggingHandle ?: return null
    val selection = selectionDocument.selection() ?: return null
    val rawStartIsVisibleStart = (selectionDocument.compareAnchors(selection.start, selection.end) ?: return null) <= 0
    return when (handle) {
      DraggingHandle.RawStart -> if (rawStartIsVisibleStart) startHandlePoint else endHandlePoint
      DraggingHandle.RawEnd -> if (rawStartIsVisibleStart) endHandlePoint else startHandlePoint
    }
  }

  private fun startSelectionActionMode() {
    if (actionMode != null) return
    actionMode = startActionMode(SelectionActionModeCallback(), ActionMode.TYPE_FLOATING)
  }

  private inner class SelectionActionModeCallback : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      menu.add(Menu.NONE, MENU_COPY, 5, android.R.string.copy).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
      menu.add(Menu.NONE, MENU_SELECT_ALL, 8, android.R.string.selectAll)
        .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
      menu.add(Menu.NONE, MENU_SHARE, 7, R.string.forum_selection_share)
        .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
      return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      val documentId = selectionDocument.selection()?.start?.documentId
      val shouldShow = documentId != null && selectionDocument.canSelectAll(documentId)
      val hasSelectAll = menu.findItem(MENU_SELECT_ALL) != null
      val selectAllChanged = shouldShow != hasSelectAll
      if (shouldShow && !hasSelectAll) {
        menu.add(Menu.NONE, MENU_SELECT_ALL, 8, android.R.string.selectAll)
          .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
      } else if (!shouldShow && hasSelectAll) {
        menu.removeItem(MENU_SELECT_ALL)
      }
      return syncSystemActions(mode, menu) || selectAllChanged
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = when (item.itemId) {
      MENU_COPY -> {
        copyToClipboard()
        mode.finish()
        true
      }
      MENU_SELECT_ALL -> {
        val documentId = selectionDocument.selection()?.start?.documentId ?: return false
        if (selectionDocument.selectAll(documentId)) {
          refreshOverlay()
          mode.invalidate()
        }
        true
      }
      MENU_SHARE -> {
        val shared = selectionDocument.copySelection()?.let(platformSystemActions.get()::share) == true
        if (shared) mode.finish()
        shared
      }
      else -> invokeSystemAction(item)
    }

    override fun onDestroyActionMode(mode: ActionMode) {
      if (actionMode === mode) actionMode = null
      clearSystemActionRequest()
      if (!suppressActionModeDestroy) cancelSelection()
    }

    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
      val points = listOfNotNull(startHandlePoint, endHandlePoint)
      if (points.isEmpty()) {
        outRect.set(0, 0, width, height)
        return
      }
      val left = points.minOf { it.x }.toInt().coerceIn(0, width)
      val top = (points.minOf { it.y } - 32f * density).toInt().coerceIn(0, height)
      val right = points.maxOf { it.x }.toInt().coerceIn(left, width)
      val bottom = (points.maxOf { it.y } + 16f * density).toInt().coerceIn(top, height)
      outRect.set(left, top, right, bottom)
    }
  }

  private fun syncSystemActions(mode: ActionMode, menu: Menu): Boolean {
    val range = selectionDocument.selection()
    val text = range?.let {
      forumSelectionSystemActionText(
        isDragging = draggingHandle != null,
        copySelection = selectionDocument::copySelection
      )
    }
    if (range == null || text == null) {
      if (systemActionRequest != null || systemActions.isNotEmpty()) clearSystemActionRequest()
      return renderSystemActions(menu)
    }
    val request = ForumSelectionSystemActionRequest(range, text)
    if (systemActionRequest != request) {
      clearSystemActionRequest()
      systemActionRequest = request
      val generation = systemActionGeneration
      var immediateActions = emptyList<ForumSelectionSystemAction>()
      val publishSmartActions: (List<ForumSelectionSystemAction>) -> Unit = { smartActions ->
        val applyActions = Runnable {
          if (actionMode !== mode || systemActionGeneration != generation ||
            systemActionRequest != request || selectionDocument.selection() != request.range ||
            selectionDocument.copySelection() != request.text || !isAttachedToWindow) {
            return@Runnable
          }
          systemActions = immediateActions + smartActions
          systemActionMenuDirty = true
          mode.invalidate()
        }
        if (Looper.myLooper() == Looper.getMainLooper()) applyActions.run() else post(applyActions)
      }
      immediateActions = runCatching {
        (systemActionLoaderForTest ?: platformSystemActions.get()::load).invoke(text, publishSmartActions)
      }.onFailure {
        Log.w(LOG_TAG, "system text actions could not load", it)
      }.getOrDefault(emptyList())
      systemActions = immediateActions
      systemActionMenuDirty = true
    }
    return renderSystemActions(menu)
  }

  private fun renderSystemActions(menu: Menu): Boolean {
    if (!systemActionMenuDirty) return false
    menu.removeGroup(MENU_GROUP_SYSTEM_ACTIONS)
    systemActionsByMenuId.clear()
    val request = systemActionRequest
    if (request != null) {
      systemActions.distinctBy { it.key }.forEachIndexed { index, action ->
        val itemId = MENU_SYSTEM_ACTION_START + index
        val item = menu.add(MENU_GROUP_SYSTEM_ACTIONS, itemId, action.order, action.title)
          .setEnabled(action.enabled)
          .setShowAsActionFlags(action.showAsAction)
        action.icon?.let(item::setIcon)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          item.contentDescription = action.contentDescription
        }
        systemActionsByMenuId[itemId] = BoundForumSelectionSystemAction(request, action)
      }
    }
    systemActionMenuDirty = false
    return true
  }

  private fun invokeSystemAction(item: MenuItem): Boolean {
    val bound = systemActionsByMenuId[item.itemId] ?: return false
    if (!bound.action.enabled || selectionDocument.selection() != bound.request.range ||
      selectionDocument.copySelection() != bound.request.text) {
      return false
    }
    val invoked = runCatching(bound.action.invoke).onFailure {
      Log.w(LOG_TAG, "system text action could not run", it)
    }.getOrDefault(false)
    if (invoked && bound.action.finishSelectionOnSuccess) actionMode?.finish()
    return true
  }

  private fun clearSystemActionRequest() {
    platformSystemActions.cancelPendingClassification()
    systemActionGeneration += 1
    systemActionRequest = null
    systemActions = emptyList()
    systemActionsByMenuId.clear()
    systemActionMenuDirty = true
  }

  private fun copyToClipboard(): String? {
    val copied = selectionDocument.copySelection()
    if (copied == null) {
      failClosed("copy-mapping-mismatch")
      return null
    }
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("forum-content", copied))
    return copied
  }

  private fun postAutoScroll() {
    if (autoScrollPosted || forumEdgeScrollDeltaPx(lastTouchY, height, density) == 0f) return
    autoScrollPosted = true
    postOnAnimation(autoScrollRunnable)
  }

  private fun runAutoScrollFrame(): ForumAutoScrollPayload? {
    updateDraggedHandle(lastTouchX, lastTouchY)
    if (!selectionActive || draggingHandle == null) return null
    return forumAutoScrollPayload(lastTouchY, height, density)
  }

  internal fun selectionSnapshotForTest(): ForumSelectionRange? = selectionDocument.selection()

  internal fun interactionStateForTest(): ForumSelectionInteractionState = ForumSelectionInteractionState(
    active = selectionActive,
    hasActionMode = actionMode != null,
    ownsGesture = coordinatorOwnsGesture
  )

  internal fun overlayHandlesForTest(): Pair<PointF?, PointF?> =
    startHandlePoint?.let(::PointF) to endHandlePoint?.let(::PointF)

  internal fun overlayHandleHotspotQuartersForTest(): Pair<Int?, Int?> =
    startLocalHandle?.drawable?.hotspotQuarterForTest() to
      endLocalHandle?.drawable?.hotspotQuarterForTest()

  internal fun copySelectionToClipboardForTest(): String? = copyToClipboard()

  internal fun actionModeMenuVisibilityForTest(): Pair<Boolean, Boolean>? = actionMode?.menu?.let { menu ->
    (menu.findItem(MENU_COPY)?.isVisible == true) to
      (menu.findItem(MENU_SELECT_ALL)?.isVisible == true)
  }

  internal fun selectAllFromActionModeForTest(): Boolean =
    actionMode?.menu?.performIdentifierAction(MENU_SELECT_ALL, 0) == true

  internal fun copyFromActionModeForTest(): Boolean =
    actionMode?.menu?.performIdentifierAction(MENU_COPY, 0) == true

  internal fun actionModeMenuTitlesForTest(): List<String> = actionMode?.menu?.let { menu ->
    (0 until menu.size()).map { menu.getItem(it).title.toString() }
  }.orEmpty()

  internal fun clickActionModeItemWithTitleForTest(title: String): Boolean {
    val menu = actionMode?.menu ?: return false
    val item = (0 until menu.size()).map(menu::getItem).firstOrNull { it.title.toString() == title }
      ?: return false
    return menu.performIdentifierAction(item.itemId, 0)
  }

  internal fun selectAllForTest(): Boolean {
    val documentId = selectionDocument.selection()?.start?.documentId ?: return false
    return selectionDocument.selectAll(documentId).also { changed ->
      if (changed) refreshOverlay()
    }
  }

  internal fun autoScrollFrameForTest(x: Float, y: Float): Map<String, Any>? {
    lastTouchX = x
    lastTouchY = y
    return runAutoScrollFrame()?.asEventMap()
  }

  internal fun hasSelectionGestureForTest(): Boolean = selectionGestureRoot != null

  internal fun alignmentBuildCountForTest(): Int = alignmentBuildCount

  private fun clearOverlay(invalidate: Boolean = true) {
    localHighlights.forEach { (view, highlight) -> view.overlay.remove(highlight.drawable) }
    localHighlights.clear()
    startLocalHandle?.let { it.overlayHost.overlay.remove(it.drawable) }
    endLocalHandle?.let { it.overlayHost.overlay.remove(it.drawable) }
    startLocalHandle = null
    endLocalHandle = null
    startHandlePoint = null
    endHandlePoint = null
    if (invalidate) invalidate()
  }

  private fun setSelectionActive(active: Boolean) {
    if (selectionActive == active) return
    if (active) activeSelectionRevision = selectionDocument.selection()?.start?.revision ?: return
    selectionActive = active
    if (active) attachPreDraw() else detachPreDraw()
    val event = mapOf("active" to active, "revision" to activeSelectionRevision)
    onSelectionChange(event)
    selectionChangeObserverForTest?.invoke(event)
    if (!active) activeSelectionRevision = ""
  }

  private fun attachPreDraw() {
    if (preDrawAttached || !viewTreeObserver.isAlive) return
    viewTreeObserver.addOnPreDrawListener(this)
    viewTreeObserver.addOnScrollChangedListener(this)
    preDrawAttached = true
  }

  private fun detachPreDraw() {
    if (!preDrawAttached) return
    if (viewTreeObserver.isAlive) {
      viewTreeObserver.removeOnPreDrawListener(this)
      viewTreeObserver.removeOnScrollChangedListener(this)
    }
    scrollRedrawPending = false
    preDrawAttached = false
  }

  private fun failClosed(code: String, rowKey: String? = null) {
    emitError(code, rowKey)
    cancelSelection()
  }

  private fun emitError(code: String, rowKey: String? = null) {
    val diagnosticKey = if (rowKey == null) code else "$code:$rowKey"
    if (lastErrorCode == diagnosticKey) return
    lastErrorCode = diagnosticKey
    Log.w(LOG_TAG, if (rowKey == null) "selection-error code=$code" else "selection-error code=$code rowKey=$rowKey")
  }

  private class CachedMarkedRowAlignment(
    private val row: ForumSelectionRowDefinition,
    candidates: List<TextView>,
    val owners: List<MountedOwner>
  ) {
    private val candidates = candidates.map { TextCandidateIdentity(it, it.layout, it.text) }

    fun matches(nextRow: ForumSelectionRowDefinition, nextCandidates: List<TextView>): Boolean =
      row === nextRow && candidates.size == nextCandidates.size && candidates.indices.all { index ->
        val cached = candidates[index]
        val next = nextCandidates[index]
        cached.view === next && cached.layout === next.layout && cached.text === next.text
      }
  }

  private data class TextCandidateIdentity(
    val view: TextView,
    val layout: android.text.Layout?,
    val text: CharSequence
  )

  private data class MountedOwner(
    val row: ForumSelectionRowDefinition,
    val ownerOrdinal: Int,
    val view: TextView,
    val overlayHost: View,
    val text: String,
    val offsetMap: ForumTextOffsetMap
  ) {
    fun matches(anchor: ForumSelectionAnchor): Boolean =
      row.documentId == anchor.documentId && row.rowKey == anchor.rowKey && ownerOrdinal == anchor.ownerOrdinal
  }

  private data class HighlightProjection(
    val documentId: String,
    val rowKey: String,
    val ownerOrdinal: Int,
    val layout: android.text.Layout,
    val layoutStart: Int,
    val layoutEnd: Int,
    val width: Int,
    val height: Int,
    val paddingLeft: Int,
    val paddingTop: Int
  )

  private data class LocalHighlight(
    val drawable: ForumSelectionHighlightDrawable,
    var projection: HighlightProjection
  )

  private data class HandleProjection(
    val view: TextView,
    val overlayHost: View,
    val contentPoint: PointF,
    val routePoint: PointF,
    val direction: HandleDrawableDirection
  )

  private data class HandleDrawingProjection(
    val x: Float,
    val y: Float,
    val routeX: Float,
    val routeY: Float,
    val visible: Boolean,
    val hostWidth: Int,
    val hostHeight: Int,
    val direction: HandleDrawableDirection
  )

  private data class LocalHandle(
    val overlayHost: View,
    val sourceView: TextView,
    val drawable: ForumSelectionPlatformHandleDrawable,
    var projection: HandleDrawingProjection
  )

  private enum class HandleDrawableDirection {
    Left,
    Right
  }

  private data class MountedOwnerCollection(
    val owners: List<MountedOwner>,
    val deferred: Boolean
  )

  private sealed interface MarkedRowAlignment {
    data class Ready(val owners: List<MountedOwner>) : MarkedRowAlignment
    data object Deferred : MarkedRowAlignment
  }

  private data class HitResult(
    val owner: MountedOwner,
    val offset: Int,
    val mediaSide: MediaSide?
  )

  private enum class MediaSide {
    Before,
    After;

    fun affinity(): ForumSelectionAffinity = when (this) {
      Before -> ForumSelectionAffinity.Upstream
      After -> ForumSelectionAffinity.Downstream
    }
  }

  private fun MediaSide?.affinityFor(normalizedStart: Boolean): ForumSelectionAffinity =
    this?.affinity() ?: if (normalizedStart) {
      ForumSelectionAffinity.Downstream
    } else {
      ForumSelectionAffinity.Upstream
    }

  private enum class DraggingHandle {
    RawStart,
    RawEnd
  }

  private companion object {
    const val LOG_TAG = "ForumSelection"
    const val MENU_COPY = android.R.id.copy
    const val MENU_SELECT_ALL = android.R.id.selectAll
    const val MENU_SHARE = android.R.id.shareText
    const val MENU_GROUP_SYSTEM_ACTIONS = 0x46534310
    const val MENU_SYSTEM_ACTION_START = 0x46534400
  }
}

private fun ForumSelectionFailure.eventCode(): String = when (this) {
  ForumSelectionFailure.BlankIdentity -> "blank-identity"
  ForumSelectionFailure.DuplicateNativeId -> "duplicate-native-id"
  ForumSelectionFailure.DuplicateRowKey -> "duplicate-row-key"
  ForumSelectionFailure.InvalidSelectionToken -> "invalid-selection-token"
  ForumSelectionFailure.RevisionReused -> "revision-reused"
}

private fun resolveThemeColor(context: Context, attribute: Int, fallback: Int): Int {
  val value = TypedValue()
  if (!context.theme.resolveAttribute(attribute, value, true)) return fallback
  if (value.type in TypedValue.TYPE_FIRST_COLOR_INT..TypedValue.TYPE_LAST_COLOR_INT) return value.data
  val resourceId = value.resourceId
  return if (resourceId != 0) runCatching { context.getColor(resourceId) }.getOrDefault(fallback) else fallback
}

private fun resolveTextViewDrawable(context: Context, attribute: Int): Drawable? {
  val attributes = context.obtainStyledAttributes(
    null,
    intArrayOf(attribute),
    android.R.attr.textViewStyle,
    0
  )
  return try {
    attributes.getDrawable(0)?.mutate()
  } finally {
    attributes.recycle()
  }
}

internal data class ForumAutoScrollPayload(
  val deltaDp: Float
) {
  fun asEventMap(): Map<String, Any> = mapOf(
    "delta" to deltaDp
  )
}

internal data class ForumSelectionInteractionState(
  val active: Boolean,
  val hasActionMode: Boolean,
  val ownsGesture: Boolean
)

private data class ForumSelectionSystemActionRequest(
  val range: ForumSelectionRange,
  val text: String
)

private data class BoundForumSelectionSystemAction(
  val request: ForumSelectionSystemActionRequest,
  val action: ForumSelectionSystemAction
)

internal fun forumAutoScrollPayload(
  pointerYpx: Float,
  viewportHeightPx: Int,
  density: Float
): ForumAutoScrollPayload? {
  if (density <= 0f) return null
  val deltaPx = forumEdgeScrollDeltaPx(pointerYpx, viewportHeightPx, density)
  if (deltaPx == 0f) return null
  return ForumAutoScrollPayload(deltaDp = deltaPx / density)
}

internal fun forumEdgeScrollDeltaPx(y: Float, height: Int, density: Float): Float {
  if (height <= 0 || density <= 0f) return 0f
  val edgeScrollZone = 56f * density
  return when {
    y < edgeScrollZone -> -max(4f * density, (edgeScrollZone - y) / edgeScrollZone * 28f * density)
    y > height - edgeScrollZone -> max(
      4f * density,
      (y - (height - edgeScrollZone)) / edgeScrollZone * 28f * density
    )
    else -> 0f
  }
}
