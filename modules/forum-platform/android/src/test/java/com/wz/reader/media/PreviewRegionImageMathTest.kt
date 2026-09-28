package com.wz.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewRegionImageMathTest {
  @Test
  fun mapsTheUprightViewportThroughAllExifOrientations() {
    val viewport = NormalizedViewport(0.1, 0.2, 0.3, 0.4)
    val expected =
      mapOf(
        1 to PixelRect(10, 20, 40, 60),
        2 to PixelRect(60, 20, 90, 60),
        3 to PixelRect(60, 40, 90, 80),
        4 to PixelRect(10, 40, 40, 80),
        5 to PixelRect(20, 10, 60, 40),
        6 to PixelRect(20, 60, 60, 90),
        7 to PixelRect(40, 60, 80, 90),
        8 to PixelRect(40, 10, 80, 40),
      )

    expected.forEach { (orientation, rect) ->
      assertEquals(rect, PreviewRegionMath.encodedRect(100, 100, orientation, viewport))
    }
  }

  @Test
  fun mapsEncodedPixelsBackToTheSameUprightPoint() {
    for (orientation in 1..8) {
      val encoded = PreviewRegionMath.encodedPoint(0.23, 0.67, orientation)
      val upright = PreviewRegionMath.uprightPoint(encoded.x * 1_200, encoded.y * 800, 1_200, 800, orientation)
      val size = PreviewRegionMath.uprightSize(1_200, 800, orientation)
      assertEquals(0.23, upright.x / size.width, 0.000_001)
      assertEquals(0.67, upright.y / size.height, 0.000_001)
    }
  }

  @Test
  fun swapsTheReportedSourceSizeOnlyForQuarterTurnOrientations() {
    for (orientation in 1..4) {
      assertEquals(PixelSize(1_200, 800), PreviewRegionMath.uprightSize(1_200, 800, orientation))
    }
    for (orientation in 5..8) {
      assertEquals(PixelSize(800, 1_200), PreviewRegionMath.uprightSize(1_200, 800, orientation))
    }
  }

  @Test
  fun choosesTheLargestSampleThatStillCoversPhysicalPixels() {
    val region = PixelRect(0, 0, 8_000, 4_000)
    assertEquals(8, PreviewRegionMath.sampleSize(region, 1, 1_000.0, 500.0))
    assertEquals(4, PreviewRegionMath.sampleSize(region, 1, 2_000.0, 1_000.0))
  }

  @Test
  fun runsOnlyTheCurrentQueuedGeneration() {
    val generation = PreviewRegionGeneration()
    val first = generation.invalidate()
    var executed = false
    generation.runIfCurrent(first) { executed = true }
    assertTrue(executed)

    executed = false
    generation.invalidate()
    generation.runIfCurrent(first) { executed = true }
    assertFalse(executed)
  }
}
