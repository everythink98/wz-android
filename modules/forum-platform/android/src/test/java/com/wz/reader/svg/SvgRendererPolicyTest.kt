package com.wz.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SvgRendererPolicyTest {
  @Test
  fun enforcesDecodedInputAndCacheKeyLimits() {
    validateDecodedSvgSize(ByteArray(MAX_SVG_BYTES))
    assertThrows(Exception::class.java) {
      validateDecodedSvgSize(ByteArray(MAX_SVG_BYTES + 1))
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("")
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("x".repeat(MAX_SVG_CACHE_KEY_CHARS + 1))
    }
    assertThrows(Exception::class.java) {
      validateSvgCacheKey("svg-invalid\u0000key")
    }
  }

  @Test
  fun sizesAtScreenPixelsAndUsesExplicitViewportBeforeViewBox() {
    val explicitSquare = """<svg width="400" height="400" viewBox="0 0 16 9"></svg>"""
    assertEquals(PosterDimensions(1080, 1080), computeSvgPosterDimensions(1080, explicitSquare))

    val singleExplicitSide = """<svg width="320" viewBox="0 0 320 180"></svg>"""
    assertEquals(PosterDimensions(1080, 608), computeSvgPosterDimensions(1080, singleExplicitSide))

    val physicalUnits = """<svg width="2in" height="1in"></svg>"""
    assertEquals(PosterDimensions(1200, 600), computeSvgPosterDimensions(1200, physicalUnits))

    val commentDecoy = """<!-- <svg viewBox="0 0 1 100"> --><svg viewBox="0 0 2 1"></svg>"""
    assertEquals(PosterDimensions(1200, 600), computeSvgPosterDimensions(1200, commentDecoy))
  }

  @Test
  fun documentDimensionsComeFromTheValidatedDecodedRoot() {
    val encodedHeight = """<svg width="100" height="&#50;00" viewBox="0 0 1 1"></svg>"""
    assertEquals(SvgDocumentDimensions(100.0, 200.0), svgDocumentDimensions(encodedHeight))

    val commentDecoy = """<!-- <svg viewBox="0 0 1 100"> --><svg viewBox="0 0 2 1"></svg>"""
    assertEquals(SvgDocumentDimensions(2.0, 1.0), svgDocumentDimensions(commentDecoy))
  }

  @Test
  fun boundedReaderStopsAfterOneMiBPlusOneByte() {
    val exact = okio.Buffer().write(ByteArray(MAX_SVG_BYTES))
    assertEquals(MAX_SVG_BYTES, boundedSvgBytes(exact)?.size)

    val oversized = okio.Buffer().write(ByteArray(MAX_SVG_BYTES + 1024))
    assertNull(boundedSvgBytes(oversized))
    assertEquals(1023L, oversized.size)
  }

  @Test
  fun fetchTimeoutCannotOutliveTheRemainingRecoveryBudget() {
    assertEquals(250L, boundedSvgFetchTimeoutMs(250.9))
    assertEquals(10_000L, boundedSvgFetchTimeoutMs(15_000.0))
  }

  @Test
  fun posterDimensionsNeverExceedEdgeOrPixelBudgets() {
    val square = computeSvgPosterDimensions(4096, """<svg viewBox="0 0 1 1"></svg>""")
    assertTrue(square.width <= MAX_POSTER_EDGE)
    assertTrue(square.height <= MAX_POSTER_EDGE)
    assertTrue(square.width.toLong() * square.height.toLong() <= MAX_POSTER_PIXELS)

    val tall = computeSvgPosterDimensions(4096, """<svg viewBox="0 0 1 1000000"></svg>""")
    assertTrue(tall.width >= 1)
    assertTrue(tall.height <= MAX_POSTER_EDGE)
    assertTrue(tall.width.toLong() * tall.height.toLong() <= MAX_POSTER_PIXELS)
  }

  @Test
  fun generatedHtmlCarriesOnlyBase64SvgAndFailClosedPolicy() {
    val base64 = "PHN2ZyB2aWV3Qm94PVwiMCAwIDEgMVwiPjwvc3ZnPg=="
    val html = buildSvgPosterHtml(base64, 100, 100)
    assertTrue(html.contains("Content-Security-Policy"))
    assertTrue(html.contains("default-src 'none'"))
    assertTrue(html.contains("img-src data:"))
    assertTrue(html.contains("script-src 'none'"))
    assertTrue(html.contains("connect-src 'none'"))
    assertTrue(html.contains("object-src 'none'"))
    assertTrue(html.contains("data:image/svg+xml;base64," + base64))
    assertFalse(html.contains("<script"))
    assertFalse(html.contains("http://"))
    assertFalse(html.contains("https://"))
  }

  @Test
  fun rejectsMalformedXmlAndNonSvgRootsBeforeChromiumCanCacheABrokenImage() {
    validateSvgDocument("""<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>""")
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<svg><g></svg>""")
    }
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<html><svg /></html>""")
    }
    assertThrows(Exception::class.java) {
      validateSvgDocument("""<!DOCTYPE svg SYSTEM "https://example.com/evil.dtd"><svg />""")
    }
  }

  @Test
  fun cachePolicyIsBoundedLruAndAlwaysProtectsReturnedFile() {
    val entries = listOf(
      SvgPosterCacheEntry("new.png", 40, 30),
      SvgPosterCacheEntry("middle.png", 40, 20),
      SvgPosterCacheEntry("old.png", 40, 10)
    )
    assertEquals(
      setOf("old.png"),
      svgPosterCacheEntriesToEvict(entries, null, maxFiles = 2, maxBytes = 100)
    )
    assertEquals(
      setOf("middle.png"),
      svgPosterCacheEntriesToEvict(entries, "old.png", maxFiles = 2, maxBytes = 100)
    )
  }

  @Test
  fun rendererQueueIsBoundedAndCountsTheActiveDocument() {
    assertTrue(hasSvgPosterQueueCapacity(active = false, queued = MAX_RENDER_REQUESTS - 1))
    assertFalse(hasSvgPosterQueueCapacity(active = false, queued = MAX_RENDER_REQUESTS))
    assertFalse(hasSvgPosterQueueCapacity(active = true, queued = MAX_RENDER_REQUESTS - 1))
  }

  @Test
  fun stalePageErrorsCannotFailTheCurrentRenderRequest() {
    val current = "https://svg-renderer.invalid/render/2/"
    assertTrue(isCurrentSvgPageError(current, current, isForMainFrame = true))
    assertFalse(isCurrentSvgPageError(current, "https://svg-renderer.invalid/render/1/", isForMainFrame = true))
    assertFalse(isCurrentSvgPageError(current, current, isForMainFrame = false))
  }

  @Test
  fun cacheIdentityIncludesSvgBytesAndCachedPngMustMatchExpectedBounds() {
    val dimensions = PosterDimensions(320, 180)
    val first = sha256PosterFileName("svg-0123456789abcdef", "first".toByteArray(), dimensions)
    val same = sha256PosterFileName("svg-0123456789abcdef", "first".toByteArray(), dimensions)
    val changed = sha256PosterFileName("svg-0123456789abcdef", "second".toByteArray(), dimensions)
    assertEquals(first, same)
    assertTrue(first.matches(Regex("[0-9a-f]{64}\\.png")))
    assertFalse(first == changed)

    assertTrue(validCachedPosterBounds(320, 180, dimensions))
    assertFalse(validCachedPosterBounds(321, 180, dimensions))
    assertFalse(validCachedPosterBounds(MAX_POSTER_EDGE + 1, 180, PosterDimensions(MAX_POSTER_EDGE + 1, 180)))
  }

  @Test
  fun sharedComplexSvgFixtureUsesItsViewBoxWithoutEmbeddingRawMarkupInHtml() {
    val fixture = checkNotNull(javaClass.classLoader?.getResource("complex-svg-document.svg"))
      .readText()
    assertTrue(fixture.contains("<animate"))
    assertTrue(fixture.contains("<filter"))
    assertEquals(PosterDimensions(1080, 608), computeSvgPosterDimensions(1080, fixture))
  }
}
