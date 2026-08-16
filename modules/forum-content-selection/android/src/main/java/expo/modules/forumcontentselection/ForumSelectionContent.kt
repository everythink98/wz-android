package expo.modules.forumcontentselection

import org.json.JSONArray
import org.json.JSONObject

internal data class ForumSelectionStyle(
  val alignItems: String? = null,
  val alignSelf: String? = null,
  val backgroundColor: String? = null,
  val borderBottomColor: String? = null,
  val borderBottomLeftRadius: Float? = null,
  val borderBottomRightRadius: Float? = null,
  val borderBottomWidth: Float? = null,
  val borderColor: String? = null,
  val borderLeftColor: String? = null,
  val borderLeftWidth: Float? = null,
  val borderRadius: Float? = null,
  val borderRightColor: String? = null,
  val borderRightWidth: Float? = null,
  val borderTopColor: String? = null,
  val borderTopLeftRadius: Float? = null,
  val borderTopRightRadius: Float? = null,
  val borderTopWidth: Float? = null,
  val borderWidth: Float? = null,
  val color: String? = null,
  val columnGap: Float? = null,
  val flexDirection: String? = null,
  val flexWrap: String? = null,
  val fontFamily: String? = null,
  val fontSize: Float? = null,
  val fontStyle: String? = null,
  val fontWeight: String? = null,
  val gap: Float? = null,
  val lineHeight: Float? = null,
  val marginBottom: Float? = null,
  val marginLeft: Float? = null,
  val marginRight: Float? = null,
  val marginTop: Float? = null,
  val paddingBottom: Float? = null,
  val paddingLeft: Float? = null,
  val paddingRight: Float? = null,
  val paddingTop: Float? = null,
  val rowGap: Float? = null,
  val textAlign: String? = null,
  val textDecorationLine: String? = null
)

internal sealed interface ForumSelectionTextPart

internal data class ForumSelectionRun(
  val href: String?,
  val style: ForumSelectionStyle,
  val text: String
) : ForumSelectionTextPart

internal data class ForumSelectionInlineMedia(
  val height: Float,
  val slot: Int,
  val width: Float
) : ForumSelectionTextPart

internal sealed interface ForumSelectionNode

internal data class ForumSelectionBlock(
  val children: List<ForumSelectionNode>,
  val layout: String,
  val style: ForumSelectionStyle,
  val tag: String?
) : ForumSelectionNode

internal data class ForumSelectionListItem(
  val children: List<ForumSelectionNode>,
  val marker: String,
  val markerWidth: Float,
  val style: ForumSelectionStyle
) : ForumSelectionNode

internal data class ForumSelectionMedia(
  val height: Float,
  val slot: Int,
  val style: ForumSelectionStyle,
  val width: Float
) : ForumSelectionNode

internal data class ForumSelectionRule(val style: ForumSelectionStyle) : ForumSelectionNode

internal data class ForumSelectionText(
  val copyBreakAfter: Boolean,
  val parts: List<ForumSelectionTextPart>,
  val style: ForumSelectionStyle
) : ForumSelectionNode

internal data class ForumSelectionCell(
  val children: List<ForumSelectionNode>,
  val colSpan: Int,
  val header: Boolean,
  val rowSpan: Int,
  val style: ForumSelectionStyle,
  val text: String
)

internal data class ForumSelectionRow(val cells: List<ForumSelectionCell>)

internal data class ForumSelectionTable(
  val columns: Int,
  val initialOffset: Int,
  val rows: List<ForumSelectionRow>,
  val scrollKey: String,
  val semanticContinuation: String,
  val semanticId: String
) : ForumSelectionNode

internal data class ForumSelectionDocument(val fallbackText: String, val nodes: List<ForumSelectionNode>)

internal fun parseForumSelectionDocument(content: String, fallbackText: String): ForumSelectionDocument {
  val root = JSONObject(content)
  return ForumSelectionDocument(fallbackText, parseNodes(root.optJSONArray("nodes") ?: JSONArray()))
}

private fun parseNodes(nodes: JSONArray) = (0 until nodes.length()).mapNotNull { index ->
  parseNode(nodes.optJSONObject(index) ?: return@mapNotNull null)
}

private fun parseNode(node: JSONObject): ForumSelectionNode? {
  val style = parseStyle(node.optJSONObject("style"))
  return when (node.optString("type")) {
    "block" -> ForumSelectionBlock(
      children = parseNodes(node.optJSONArray("children") ?: JSONArray()),
      layout = node.optString("layout", "column"),
      style = style,
      tag = node.optStringOrNull("tag")
    )
    "listItem" -> ForumSelectionListItem(
      children = parseNodes(node.optJSONArray("children") ?: JSONArray()),
      marker = node.optString("marker"),
      markerWidth = node.optPositiveFloat("markerWidth") ?: 34f,
      style = style
    )
    "media" -> {
      val slot = node.optInt("slot", -1)
      val width = node.optPositiveFloat("width")
      val height = node.optPositiveFloat("height")
      if (slot >= 0 && width != null && height != null) ForumSelectionMedia(height, slot, style, width) else null
    }
    "rule" -> ForumSelectionRule(style)
    "text" -> ForumSelectionText(
      copyBreakAfter = node.optBoolean("copyBreakAfter"),
      parts = parseTextParts(node.optJSONArray("parts") ?: JSONArray()),
      style = style
    )
    "table" -> ForumSelectionTable(
      columns = node.optInt("columns", 1).coerceAtLeast(1),
      initialOffset = node.optInt("initialOffset", 0).coerceAtLeast(0),
      rows = parseRows(node.optJSONArray("rows") ?: JSONArray()),
      scrollKey = node.getString("scrollKey"),
      semanticContinuation = node.optString("semanticContinuation", "only"),
      semanticId = node.optString("semanticId")
    )
    else -> null
  }
}

private fun parseTextParts(parts: JSONArray) = (0 until parts.length()).mapNotNull { index ->
  val part = parts.optJSONObject(index) ?: return@mapNotNull null
  when (part.optString("type")) {
    "run" -> ForumSelectionRun(
      href = part.optStringOrNull("href"),
      style = parseStyle(part.optJSONObject("style")),
      text = part.optString("text")
    )
    "media" -> {
      val slot = part.optInt("slot", -1)
      val width = part.optPositiveFloat("width")
      val height = part.optPositiveFloat("height")
      if (slot >= 0 && width != null && height != null) ForumSelectionInlineMedia(height, slot, width) else null
    }
    else -> null
  }
}

private fun parseRows(rows: JSONArray) = (0 until rows.length()).mapNotNull { rowIndex ->
  val row = rows.optJSONObject(rowIndex) ?: return@mapNotNull null
  val cells = row.optJSONArray("cells") ?: JSONArray()
  ForumSelectionRow(
    (0 until cells.length()).mapNotNull { cellIndex ->
      val cell = cells.optJSONObject(cellIndex) ?: return@mapNotNull null
      ForumSelectionCell(
        children = parseNodes(cell.optJSONArray("children") ?: JSONArray()),
        colSpan = cell.optInt("colSpan", 1).coerceAtLeast(1),
        header = cell.optBoolean("header"),
        rowSpan = cell.optInt("rowSpan", 1).coerceAtLeast(1),
        style = parseStyle(cell.optJSONObject("style")),
        text = cell.optString("text")
      )
    }
  )
}

private fun parseStyle(style: JSONObject?): ForumSelectionStyle {
  if (style == null) return ForumSelectionStyle()
  return ForumSelectionStyle(
    alignItems = style.optStringOrNull("alignItems"),
    alignSelf = style.optStringOrNull("alignSelf"),
    backgroundColor = style.optStringOrNull("backgroundColor"),
    borderBottomColor = style.optStringOrNull("borderBottomColor"),
    borderBottomLeftRadius = style.optFloat("borderBottomLeftRadius"),
    borderBottomRightRadius = style.optFloat("borderBottomRightRadius"),
    borderBottomWidth = style.optFloat("borderBottomWidth"),
    borderColor = style.optStringOrNull("borderColor"),
    borderLeftColor = style.optStringOrNull("borderLeftColor"),
    borderLeftWidth = style.optFloat("borderLeftWidth"),
    borderRadius = style.optFloat("borderRadius"),
    borderRightColor = style.optStringOrNull("borderRightColor"),
    borderRightWidth = style.optFloat("borderRightWidth"),
    borderTopColor = style.optStringOrNull("borderTopColor"),
    borderTopLeftRadius = style.optFloat("borderTopLeftRadius"),
    borderTopRightRadius = style.optFloat("borderTopRightRadius"),
    borderTopWidth = style.optFloat("borderTopWidth"),
    borderWidth = style.optFloat("borderWidth"),
    color = style.optStringOrNull("color"),
    columnGap = style.optFloat("columnGap"),
    flexDirection = style.optStringOrNull("flexDirection"),
    flexWrap = style.optStringOrNull("flexWrap"),
    fontFamily = style.optStringOrNull("fontFamily"),
    fontSize = style.optFloat("fontSize"),
    fontStyle = style.optStringOrNull("fontStyle"),
    fontWeight = style.optStringOrNull("fontWeight"),
    gap = style.optFloat("gap"),
    lineHeight = style.optFloat("lineHeight"),
    marginBottom = style.optFloat("marginBottom"),
    marginLeft = style.optFloat("marginLeft"),
    marginRight = style.optFloat("marginRight"),
    marginTop = style.optFloat("marginTop"),
    paddingBottom = style.optFloat("paddingBottom"),
    paddingLeft = style.optFloat("paddingLeft"),
    paddingRight = style.optFloat("paddingRight"),
    paddingTop = style.optFloat("paddingTop"),
    rowGap = style.optFloat("rowGap"),
    textAlign = style.optStringOrNull("textAlign"),
    textDecorationLine = style.optStringOrNull("textDecorationLine")
  )
}

private fun JSONObject.optFloat(name: String) =
  optDouble(name, Double.NaN).takeIf { it.isFinite() }?.toFloat()

private fun JSONObject.optPositiveFloat(name: String) = optFloat(name)?.takeIf { it > 0f }

private fun JSONObject.optStringOrNull(name: String) =
  optString(name).takeIf { has(name) && it.isNotEmpty() }

internal data class ForumTableCellPlacement(
  val cellIndex: Int,
  val colSpan: Int,
  val column: Int,
  val row: Int,
  val rowSpan: Int
)

internal fun forumTableCellPlacements(rows: List<ForumSelectionRow>, columnCount: Int): List<ForumTableCellPlacement> {
  val columns = columnCount.coerceAtLeast(1)
  val occupied = Array(rows.size) { BooleanArray(columns) }
  val placements = mutableListOf<ForumTableCellPlacement>()
  var cellIndex = 0
  rows.forEachIndexed { rowIndex, row ->
    row.cells.forEach { cell ->
      var column = 0
      val requestedSpan = cell.colSpan.coerceIn(1, columns)
      while (column < columns && occupied[rowIndex][column]) column += 1
      while (column + requestedSpan <= columns && (column until column + requestedSpan).any { occupied[rowIndex][it] }) {
        column += 1
      }
      if (column >= columns) column = columns - 1
      val colSpan = requestedSpan.coerceAtMost(columns - column)
      val rowSpan = cell.rowSpan.coerceAtMost(rows.size - rowIndex).coerceAtLeast(1)
      for (targetRow in rowIndex until rowIndex + rowSpan) {
        for (targetColumn in column until column + colSpan) occupied[targetRow][targetColumn] = true
      }
      placements += ForumTableCellPlacement(cellIndex++, colSpan, column, rowIndex, rowSpan)
    }
  }
  return placements
}

internal fun forumTableRowHeights(
  rowCount: Int,
  placements: List<ForumTableCellPlacement>,
  naturalHeights: List<Int>
): IntArray {
  val rowHeights = IntArray(rowCount)
  placements.forEachIndexed { index, placement ->
    if (placement.rowSpan == 1) rowHeights[placement.row] = maxOf(rowHeights[placement.row], naturalHeights[index])
  }
  placements.forEachIndexed { index, placement ->
    val current = (placement.row until placement.row + placement.rowSpan).sumOf { rowHeights[it] }
    if (naturalHeights[index] > current) {
      rowHeights[placement.row + placement.rowSpan - 1] += naturalHeights[index] - current
    }
  }
  return rowHeights
}

internal fun forumTableCellHeight(placement: ForumTableCellPlacement, rowHeights: IntArray) =
  (placement.row until placement.row + placement.rowSpan).sumOf { rowHeights[it] }
