package expo.modules.forumcontentselection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ForumSelectionDocumentTest {
  private fun row(
    rowKey: String,
    nativeId: String,
    ownerText: String,
    trailing: String = "\n",
    tape: String = "[]"
  ) = ForumSelectionRowDefinition(
    documentId = "reply:42",
    rowKey = rowKey,
    nativeId = nativeId,
    selectionToken = """{"version":1,"prefix":[],"owners":[{"text":${ownerText.quoteJson()},"tape":$tape,"trailing":[{"kind":"separator","text":${trailing.quoteJson()}}]}]}"""
  )

  @Test
  fun `copies a cross-row range from stable logical anchors without mounted views`() {
    val document = ForumSelectionDocument()
    assertEquals(
      ForumSelectionUpdate.Applied,
      document.replace("revision-1", listOf(row("row-1", "native-1", "alpha"), row("row-2", "native-2", "beta", "")))
    )

    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "revision-1", "row-1", 0, 2, ForumSelectionAffinity.Downstream),
        ForumSelectionAnchor("reply:42", "revision-1", "row-2", 0, 2, ForumSelectionAffinity.Upstream)
      )
    )

    assertEquals("pha\nbe", document.copySelection())
  }

  @Test
  fun `injects media copy tape at UTF-16 offsets in stable array order`() {
    val document = ForumSelectionDocument()
    val emoji = "A\uD83D\uDE00B"
    val tape = """[{"at":1,"text":"[first]"},{"at":1,"text":"[second]"}]"""
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(row("row", "native", emoji, "", tape))))
    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Upstream),
        ForumSelectionAnchor("reply:42", "r1", "row", 0, emoji.length, ForumSelectionAffinity.Upstream)
      )
    )

    assertEquals("[first][second]\uD83D\uDE00B", document.copySelection())
  }

  @Test
  fun `rejects duplicate mapping and reused revision with different rows`() {
    val document = ForumSelectionDocument()
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(row("one", "same", "one"))))
    assertEquals(
      ForumSelectionUpdate.Invalid(ForumSelectionFailure.DuplicateNativeId),
      document.replace("r2", listOf(row("one", "same", "one"), row("two", "same", "two")))
    )
    assertFalse(document.isEnabled)

    assertEquals(ForumSelectionUpdate.Applied, document.replace("r3", listOf(row("one", "one", "one"))))
    assertEquals(
      ForumSelectionUpdate.Invalid(ForumSelectionFailure.RevisionReused),
      document.replace("r3", listOf(row("two", "two", "two")))
    )
    assertFalse(document.isEnabled)
  }

  @Test
  fun `revision change clears logical selection`() {
    val document = ForumSelectionDocument()
    val first = row("row", "native", "text", "")
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(first)))
    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "r1", "row", 0, 0, ForumSelectionAffinity.Downstream),
        ForumSelectionAnchor("reply:42", "r1", "row", 0, 4, ForumSelectionAffinity.Upstream)
      )
    )
    assertEquals("text", document.copySelection())

    assertEquals(ForumSelectionUpdate.Applied, document.replace("r2", listOf(first)))
    assertNull(document.copySelection())
  }

  @Test
  fun `identical revision and manifest retain compiled row identity`() {
    val document = ForumSelectionDocument()
    val definition = row("row", "native", "text", "")
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(definition)))
    val compiledRow = requireNotNull(document.rowForNativeId("native"))

    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(definition.copy())))
    assertSame(compiledRow, document.rowForNativeId("native"))
  }

  @Test
  fun `malformed token and invalid anchor offset fail closed`() {
    val document = ForumSelectionDocument()
    val malformed = ForumSelectionRowDefinition("reply:42", "row", "native", "{\"version\":2}")
    assertEquals(
      ForumSelectionUpdate.Invalid(ForumSelectionFailure.InvalidSelectionToken),
      document.replace("r1", listOf(malformed))
    )
    assertFalse(document.isEnabled)

    assertEquals(ForumSelectionUpdate.Applied, document.replace("r2", listOf(row("row", "native", "ok", ""))))
    assertFalse(
      document.select(
        ForumSelectionAnchor("reply:42", "r2", "row", 0, 3, ForumSelectionAffinity.Downstream),
        ForumSelectionAnchor("reply:42", "r2", "row", 0, 2, ForumSelectionAffinity.Upstream)
      )
    )
  }

  @Test
  fun `copies media-only prefix when its row is between text anchors`() {
    val document = ForumSelectionDocument()
    val mediaOnly = ForumSelectionRowDefinition(
      documentId = "reply:42",
      rowKey = "media",
      nativeId = "media-native",
      selectionToken = """{"version":1,"prefix":[{"kind":"media","text":"[sticker]"},{"kind":"separator","text":"\n"}],"owners":[]}"""
    )
    assertEquals(
      ForumSelectionUpdate.Applied,
      document.replace(
        "r1",
        listOf(row("before", "before-native", "A"), mediaOnly, row("after", "after-native", "B", ""))
      )
    )
    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "r1", "before", 0, 0, ForumSelectionAffinity.Downstream),
        ForumSelectionAnchor("reply:42", "r1", "after", 0, 1, ForumSelectionAffinity.Upstream)
      )
    )

    assertEquals("A\n[sticker]\nB", document.copySelection())
  }

  @Test
  fun `select all includes leading media-only rows without inventing a text owner`() {
    val document = ForumSelectionDocument()
    val leadingMedia = ForumSelectionRowDefinition(
      documentId = "reply:42",
      rowKey = "leading-media",
      nativeId = "leading-media-native",
      selectionToken = """{"version":1,"prefix":[{"kind":"media","text":"[leading sticker]"},{"kind":"separator","text":"\n"}],"owners":[]}"""
    )
    assertEquals(
      ForumSelectionUpdate.Applied,
      document.replace("r1", listOf(leadingMedia, row("text", "text-native", "body", "")))
    )

    assertTrue(document.selectAll("reply:42"))
    assertEquals("[leading sticker]\nbody", document.copySelection())
  }

  @Test
  fun `reverse handles preserve tape boundary affinity`() {
    val document = ForumSelectionDocument()
    val tape = """[{"at":0,"text":"[zero]"},{"at":1,"text":"[one]"},{"at":2,"text":"[two]"}]"""
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(row("row", "native", "AB", "", tape))))
    val low = ForumSelectionAnchor("reply:42", "r1", "row", 0, 0, ForumSelectionAffinity.Upstream)
    val high = ForumSelectionAnchor("reply:42", "r1", "row", 0, 2, ForumSelectionAffinity.Upstream)

    assertTrue(document.select(high, low))
    assertEquals("[zero]A[one]B", document.copySelection())

    assertTrue(document.select(low, high.copy(affinity = ForumSelectionAffinity.Downstream)))
    assertEquals("[zero]A[one]B[two]", document.copySelection())
  }

  @Test
  fun `inline media boundary affinity includes only the visually crossed side`() {
    val document = ForumSelectionDocument()
    val tape = """[{"at":1,"text":"[media]"}]"""
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(row("row", "native", "AB", "", tape))))
    val startBeforeMedia = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Upstream)
    val startAfterMedia = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Downstream)
    val endBeforeMedia = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Upstream)
    val endAfterMedia = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Downstream)
    val ownerStart = ForumSelectionAnchor("reply:42", "r1", "row", 0, 0, ForumSelectionAffinity.Downstream)
    val ownerEnd = ForumSelectionAnchor("reply:42", "r1", "row", 0, 2, ForumSelectionAffinity.Upstream)

    assertTrue(document.select(startBeforeMedia, ownerEnd))
    assertEquals("[media]B", document.copySelection())

    assertTrue(document.select(startAfterMedia, ownerEnd))
    assertEquals("B", document.copySelection())

    assertTrue(document.select(ownerStart, endBeforeMedia))
    assertEquals("A", document.copySelection())

    assertTrue(document.select(ownerStart, endAfterMedia))
    assertEquals("A[media]", document.copySelection())

    assertTrue(document.select(ownerEnd, startBeforeMedia))
    assertEquals("[media]B", document.copySelection())
  }

  @Test
  fun `row prefix follows the same physical upstream boundary as inline media tape`() {
    val document = ForumSelectionDocument()
    val prefixed = ForumSelectionRowDefinition(
      documentId = "reply:42",
      rowKey = "row",
      nativeId = "native",
      selectionToken = """{"version":1,"prefix":[{"kind":"media","text":"[prefix]"}],"owners":[{"text":"A","tape":[],"trailing":[]}]}"""
    )
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(prefixed)))
    val end = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Upstream)

    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "r1", "row", 0, 0, ForumSelectionAffinity.Upstream),
        end
      )
    )
    assertEquals("[prefix]A", document.copySelection())

    assertTrue(
      document.select(
        ForumSelectionAnchor("reply:42", "r1", "row", 0, 0, ForumSelectionAffinity.Downstream),
        end
      )
    )
    assertEquals("A", document.copySelection())
  }

  @Test
  fun `same logical offset orders physical before and after sides and copies only crossed media`() {
    val document = ForumSelectionDocument()
    val tape = """[{"at":1,"text":"[media]"}]"""
    assertEquals(ForumSelectionUpdate.Applied, document.replace("r1", listOf(row("row", "native", "AB", "", tape))))
    val before = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Upstream)
    val after = ForumSelectionAnchor("reply:42", "r1", "row", 0, 1, ForumSelectionAffinity.Downstream)

    assertEquals(-1, document.compareAnchors(before, after))
    assertTrue(document.select(before, after))
    assertEquals("[media]", document.copySelection())
    assertEquals(
      ForumOwnerSelectionSlice(1, ForumSelectionAffinity.Upstream, 1, ForumSelectionAffinity.Downstream),
      document.selectedSlice("reply:42", "row", 0)
    )

    assertTrue(document.select(after, before))
    assertEquals("[media]", document.copySelection())
    assertTrue(document.select(before, before))
    assertEquals("", document.copySelection())
  }
}

private fun String.quoteJson(): String = org.json.JSONObject.quote(this)
