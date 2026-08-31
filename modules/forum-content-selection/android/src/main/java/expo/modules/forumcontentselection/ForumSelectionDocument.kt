package expo.modules.forumcontentselection

import org.json.JSONArray
import org.json.JSONObject

internal data class ForumSelectionRowDefinition(
  val documentId: String,
  val rowKey: String,
  val nativeId: String,
  val selectionToken: String
)

internal enum class ForumSelectionAffinity {
  Upstream,
  Downstream
}

internal data class ForumSelectionAnchor(
  val documentId: String,
  val revision: String,
  val rowKey: String,
  val ownerOrdinal: Int,
  val utf16Offset: Int,
  val affinity: ForumSelectionAffinity
)

internal data class ForumSelectionRange(
  val start: ForumSelectionAnchor,
  val end: ForumSelectionAnchor
)

internal data class ForumOwnerSelectionSlice(
  val startOffset: Int,
  val startAffinity: ForumSelectionAffinity,
  val endOffset: Int,
  val endAffinity: ForumSelectionAffinity
)

internal enum class ForumSelectionFailure {
  BlankIdentity,
  DuplicateNativeId,
  DuplicateRowKey,
  InvalidSelectionToken,
  RevisionReused
}

internal sealed interface ForumSelectionUpdate {
  data object Applied : ForumSelectionUpdate
  data class Invalid(val failure: ForumSelectionFailure) : ForumSelectionUpdate
}

private data class CopySegment(
  val kind: String,
  val text: String
)

private data class CopyInsertion(
  val at: Int,
  val text: String
)

private data class OwnerToken(
  val text: String,
  val tape: List<CopyInsertion>,
  val trailing: List<CopySegment>
) {
  fun copySlice(
    start: Int,
    end: Int,
    includeInsertionsAtStart: Boolean,
    includeInsertionsAtEnd: Boolean
  ): String {
    if (start > end) return ""
    return buildString {
      var cursor = start
      tape.forEach { insertion ->
        if (insertion.at < start || insertion.at > end) return@forEach
        if (insertion.at == start && !includeInsertionsAtStart) return@forEach
        if (insertion.at == end && !includeInsertionsAtEnd) return@forEach
        append(text, cursor, insertion.at)
        append(insertion.text)
        cursor = insertion.at
      }
      append(text, cursor, end)
    }
  }

  fun trailingText(): String = trailing.joinToString(separator = "") { it.text }

  fun fullCopyText(): String = copySlice(
    start = 0,
    end = text.length,
    includeInsertionsAtStart = true,
    includeInsertionsAtEnd = true
  ) + trailingText()
}

private data class SelectionToken(
  val prefix: List<CopySegment>,
  val owners: List<OwnerToken>
) {
  fun prefixText(): String = prefix.joinToString(separator = "") { it.text }

  fun fullCopyText(): String = prefixText() + owners.joinToString(separator = "") { it.fullCopyText() }
}

private data class ParsedRow(
  val definition: ForumSelectionRowDefinition,
  val token: SelectionToken
)

internal class ForumSelectionDocument {
  private var revision = ""
  private var definitions: List<ForumSelectionRowDefinition> = emptyList()
  private var rows: List<ParsedRow> = emptyList()
  private var rowsByKey: Map<String, ParsedRow> = emptyMap()
  private var rowsByNativeId: Map<String, ParsedRow> = emptyMap()
  private var rowIndexesByKey: Map<String, Int> = emptyMap()
  private var selectedRange: ForumSelectionRange? = null
  private var selectAllDocumentId: String? = null

  var isEnabled: Boolean = false
    private set

  fun reset() {
    revision = ""
    definitions = emptyList()
    rows = emptyList()
    rowsByKey = emptyMap()
    rowsByNativeId = emptyMap()
    rowIndexesByKey = emptyMap()
    selectedRange = null
    selectAllDocumentId = null
    isEnabled = false
  }

  fun replace(nextRevision: String, nextDefinitions: List<ForumSelectionRowDefinition>): ForumSelectionUpdate {
    val invalidIdentity = nextRevision.isBlank() || nextDefinitions.any {
      it.documentId.isBlank() || it.rowKey.isBlank() || it.nativeId.isBlank()
    }
    if (invalidIdentity) return invalidate(ForumSelectionFailure.BlankIdentity)
    if (nextDefinitions.distinctBy { it.rowKey }.size != nextDefinitions.size) {
      return invalidate(ForumSelectionFailure.DuplicateRowKey)
    }
    if (nextDefinitions.distinctBy { it.nativeId }.size != nextDefinitions.size) {
      return invalidate(ForumSelectionFailure.DuplicateNativeId)
    }
    if (revision == nextRevision && definitions.isNotEmpty() && definitions != nextDefinitions) {
      return invalidate(ForumSelectionFailure.RevisionReused)
    }
    if (isEnabled && revision == nextRevision && definitions == nextDefinitions) {
      return ForumSelectionUpdate.Applied
    }

    val parsedRows = nextDefinitions.map { definition ->
      val token = SelectionTokenParser.parse(definition.selectionToken)
        ?: return invalidate(ForumSelectionFailure.InvalidSelectionToken)
      ParsedRow(definition, token)
    }

    val identityChanged = revision != nextRevision || definitions != nextDefinitions
    revision = nextRevision
    definitions = nextDefinitions.toList()
    rows = parsedRows
    rowsByKey = parsedRows.associateBy { it.definition.rowKey }
    rowsByNativeId = parsedRows.associateBy { it.definition.nativeId }
    rowIndexesByKey = parsedRows.mapIndexed { index, row -> row.definition.rowKey to index }.toMap()
    isEnabled = true
    if (identityChanged) selectedRange = null
    if (identityChanged) selectAllDocumentId = null
    return ForumSelectionUpdate.Applied
  }

  fun cancel() {
    selectedRange = null
    selectAllDocumentId = null
  }

  fun selection(): ForumSelectionRange? = selectedRange

  fun rowForNativeId(nativeId: String): ForumSelectionRowDefinition? = rowsByNativeId[nativeId]?.definition

  fun select(start: ForumSelectionAnchor, end: ForumSelectionAnchor): Boolean {
    if (!isEnabled || !isValid(start) || !isValid(end) || start.documentId != end.documentId) return false
    val nextRange = ForumSelectionRange(start, end)
    if (selectedRange == nextRange) return false
    selectedRange = nextRange
    selectAllDocumentId = null
    return true
  }

  fun extend(anchor: ForumSelectionAnchor): Boolean {
    val current = selectedRange ?: return false
    return select(current.start, anchor)
  }

  fun canSelectAll(documentId: String): Boolean =
    isEnabled && selectAllDocumentId != documentId &&
      rows.any { it.definition.documentId == documentId && it.token.owners.isNotEmpty() }

  fun selectAll(documentId: String): Boolean {
    val selectableRows = rows.filter { it.definition.documentId == documentId && it.token.owners.isNotEmpty() }
    if (selectableRows.isEmpty()) return false
    val first = selectableRows.first()
    val last = selectableRows.last()
    val start = ForumSelectionAnchor(
      documentId,
      revision,
      first.definition.rowKey,
      0,
      0,
      ForumSelectionAffinity.Upstream
    )
    val end = ForumSelectionAnchor(
      documentId,
      revision,
      last.definition.rowKey,
      last.token.owners.lastIndex,
      last.token.owners.last().text.length,
      ForumSelectionAffinity.Downstream
    )
    val selectionChanged = select(start, end)
    if (!selectionChanged && selectedRange != ForumSelectionRange(start, end)) return false
    val selectAllChanged = selectAllDocumentId != documentId
    selectAllDocumentId = documentId
    return selectionChanged || selectAllChanged
  }

  fun expectedOwnerTexts(documentId: String, rowKey: String): List<String>? = rowsByKey[rowKey]
    ?.takeIf { it.definition.documentId == documentId }
    ?.token
    ?.owners
    ?.map { it.text }

  fun anchor(
    documentId: String,
    rowKey: String,
    ownerOrdinal: Int,
    utf16Offset: Int,
    affinity: ForumSelectionAffinity
  ): ForumSelectionAnchor? {
    val anchor = ForumSelectionAnchor(
      documentId,
      revision,
      rowKey,
      ownerOrdinal,
      utf16Offset,
      affinity
    )
    return anchor.takeIf(::isValid)
  }

  fun selectedOffsets(documentId: String, rowKey: String, ownerOrdinal: Int): IntRange? {
    val normalized = selectedRange?.let(::normalize) ?: return null
    val candidate = anchor(documentId, rowKey, ownerOrdinal, 0, ForumSelectionAffinity.Downstream) ?: return null
    val owner = rowsByKey.getValue(rowKey).token.owners[ownerOrdinal]
    val ownerEnd = candidate.copy(utf16Offset = owner.text.length)
    if ((compare(ownerEnd, normalized.start) ?: return null) <= 0) return null
    if ((compare(candidate, normalized.end) ?: return null) >= 0) return null
    val start = if (candidate.rowKey == normalized.start.rowKey && ownerOrdinal == normalized.start.ownerOrdinal) {
      normalized.start.utf16Offset
    } else {
      0
    }
    val end = if (candidate.rowKey == normalized.end.rowKey && ownerOrdinal == normalized.end.ownerOrdinal) {
      normalized.end.utf16Offset
    } else {
      owner.text.length
    }
    if (start >= end) return null
    return start until end
  }

  fun selectedSlice(documentId: String, rowKey: String, ownerOrdinal: Int): ForumOwnerSelectionSlice? {
    val normalized = selectedRange?.let(::normalize) ?: return null
    val owner = rowsByKey[rowKey]
      ?.takeIf { it.definition.documentId == documentId }
      ?.token
      ?.owners
      ?.getOrNull(ownerOrdinal) ?: return null
    val outerStart = anchor(
      documentId,
      rowKey,
      ownerOrdinal,
      0,
      ForumSelectionAffinity.Upstream
    ) ?: return null
    val outerEnd = anchor(
      documentId,
      rowKey,
      ownerOrdinal,
      owner.text.length,
      ForumSelectionAffinity.Downstream
    ) ?: return null
    val sliceStart = if ((compare(normalized.start, outerStart) ?: return null) >= 0) normalized.start else outerStart
    val sliceEnd = if ((compare(normalized.end, outerEnd) ?: return null) <= 0) normalized.end else outerEnd
    if ((compare(sliceStart, sliceEnd) ?: return null) >= 0) return null
    if (sliceStart.rowKey != rowKey || sliceStart.ownerOrdinal != ownerOrdinal ||
      sliceEnd.rowKey != rowKey || sliceEnd.ownerOrdinal != ownerOrdinal) return null
    return ForumOwnerSelectionSlice(
      startOffset = sliceStart.utf16Offset,
      startAffinity = sliceStart.affinity,
      endOffset = sliceEnd.utf16Offset,
      endAffinity = sliceEnd.affinity
    )
  }

  fun compareAnchors(left: ForumSelectionAnchor, right: ForumSelectionAnchor): Int? = compare(left, right)

  fun normalizedSelection(): ForumSelectionRange? = selectedRange?.let(::normalize)

  fun copySelection(): String? {
    val range = selectedRange ?: return null
    selectAllDocumentId?.let { documentId ->
      return rows.asSequence()
        .filter { it.definition.documentId == documentId }
        .joinToString(separator = "") { it.token.fullCopyText() }
    }
    val normalized = normalize(range) ?: return null
    if (normalized.start == normalized.end) return ""
    val startRowIndex = rowIndex(normalized.start)
    val endRowIndex = rowIndex(normalized.end)
    if (startRowIndex < 0 || endRowIndex < startRowIndex) return null

    return buildString {
      for (rowIndex in startRowIndex..endRowIndex) {
        val row = rows[rowIndex]
        if (row.definition.documentId != normalized.start.documentId) return null
        val startsHere = rowIndex == startRowIndex
        val endsHere = rowIndex == endRowIndex
        if (!startsHere || (normalized.start.ownerOrdinal == 0 && normalized.start.utf16Offset == 0 &&
            normalized.start.affinity == ForumSelectionAffinity.Upstream)) {
          append(row.token.prefixText())
        }
        row.token.owners.forEachIndexed { ownerIndex, owner ->
          if (startsHere && ownerIndex < normalized.start.ownerOrdinal) return@forEachIndexed
          if (endsHere && ownerIndex > normalized.end.ownerOrdinal) return@forEachIndexed
          val sliceStart = if (startsHere && ownerIndex == normalized.start.ownerOrdinal) {
            normalized.start.utf16Offset
          } else {
            0
          }
          val sliceEnd = if (endsHere && ownerIndex == normalized.end.ownerOrdinal) {
            normalized.end.utf16Offset
          } else {
            owner.text.length
          }
          val startsAtThisOwner = startsHere && ownerIndex == normalized.start.ownerOrdinal
          val endsAtThisOwner = endsHere && ownerIndex == normalized.end.ownerOrdinal
          append(
            owner.copySlice(
              sliceStart,
              sliceEnd,
              includeInsertionsAtStart = !startsAtThisOwner ||
                normalized.start.affinity == ForumSelectionAffinity.Upstream,
              includeInsertionsAtEnd = !endsAtThisOwner ||
                normalized.end.affinity == ForumSelectionAffinity.Downstream
            )
          )
          val selectionContinues = rowIndex < endRowIndex || ownerIndex < normalized.end.ownerOrdinal
          if (selectionContinues) append(owner.trailingText())
        }
      }
    }
  }

  private fun normalize(range: ForumSelectionRange): ForumSelectionRange? {
    val comparison = compare(range.start, range.end) ?: return null
    return if (comparison <= 0) range else ForumSelectionRange(range.end, range.start)
  }

  private fun compare(left: ForumSelectionAnchor, right: ForumSelectionAnchor): Int? {
    if (left.documentId != right.documentId || left.revision != revision || right.revision != revision) return null
    val leftRow = rowIndex(left)
    val rightRow = rowIndex(right)
    if (leftRow < 0 || rightRow < 0) return null
    if (leftRow != rightRow) return leftRow.compareTo(rightRow)
    if (left.ownerOrdinal != right.ownerOrdinal) return left.ownerOrdinal.compareTo(right.ownerOrdinal)
    if (left.utf16Offset != right.utf16Offset) return left.utf16Offset.compareTo(right.utf16Offset)
    return left.affinity.compareTo(right.affinity)
  }

  private fun rowIndex(anchor: ForumSelectionAnchor): Int {
    val row = rowsByKey[anchor.rowKey] ?: return -1
    if (row.definition.documentId != anchor.documentId) return -1
    return rowIndexesByKey[anchor.rowKey] ?: -1
  }

  private fun isValid(anchor: ForumSelectionAnchor): Boolean {
    if (anchor.revision != revision || anchor.ownerOrdinal < 0 || anchor.utf16Offset < 0) return false
    val row = rowsByKey[anchor.rowKey]?.takeIf {
      it.definition.documentId == anchor.documentId
    } ?: return false
    val owner = row.token.owners.getOrNull(anchor.ownerOrdinal) ?: return false
    return anchor.utf16Offset <= owner.text.length
  }

  private fun invalidate(failure: ForumSelectionFailure): ForumSelectionUpdate.Invalid {
    reset()
    return ForumSelectionUpdate.Invalid(failure)
  }
}

private object SelectionTokenParser {
  private const val MAX_OWNERS = 2_048
  private const val MAX_TAPE_ENTRIES = 8_192
  private const val MAX_SEGMENTS = 8_192

  fun parse(raw: String): SelectionToken? = runCatching {
    val root = JSONObject(raw)
    if (root.optInt("version", -1) != 1) return null
    val prefix = parseSegments(root.optJSONArray("prefix") ?: JSONArray()) ?: return null
    val ownersJson = root.optJSONArray("owners") ?: return null
    if (ownersJson.length() > MAX_OWNERS) return null
    val owners = ArrayList<OwnerToken>(ownersJson.length())
    repeat(ownersJson.length()) { ownerIndex ->
      val ownerJson = ownersJson.optJSONObject(ownerIndex) ?: return null
      val text = ownerJson.optStringStrict("text") ?: return null
      val tapeJson = ownerJson.optJSONArray("tape") ?: return null
      if (tapeJson.length() > MAX_TAPE_ENTRIES) return null
      val tape = ArrayList<CopyInsertion>(tapeJson.length())
      var previousOffset = -1
      repeat(tapeJson.length()) { tapeIndex ->
        val insertionJson = tapeJson.optJSONObject(tapeIndex) ?: return null
        val at = insertionJson.optInt("at", -1)
        val insertedText = insertionJson.optStringStrict("text") ?: return null
        if (at < previousOffset || at < 0 || at > text.length) return null
        previousOffset = at
        tape += CopyInsertion(at, insertedText)
      }
      val trailing = parseSegments(ownerJson.optJSONArray("trailing") ?: return null) ?: return null
      owners += OwnerToken(text, tape, trailing)
    }
    SelectionToken(prefix, owners)
  }.getOrNull()

  private fun parseSegments(array: JSONArray): List<CopySegment>? {
    if (array.length() > MAX_SEGMENTS) return null
    return buildList(array.length()) {
      repeat(array.length()) { index ->
        val item = array.optJSONObject(index) ?: return null
        val kind = item.optStringStrict("kind") ?: return null
        if (kind != "media" && kind != "separator") return null
        val text = item.optStringStrict("text") ?: return null
        add(CopySegment(kind, text))
      }
    }
  }
}

private fun JSONObject.optStringStrict(name: String): String? {
  if (!has(name) || isNull(name) || opt(name) !is String) return null
  return getString(name)
}
