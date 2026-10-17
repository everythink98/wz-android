package com.wz.reader

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import java.util.Random
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream
import java.util.zip.InflaterInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class TopicShareCaptureTest {
  @Test fun correlatedImagePixelsCompressWithoutLosingDetail() = runBlocking {
    val directory = Files.createTempDirectory("topic-share-compression-test").toFile()
    val width = 1080
    val height = 2000
    try {
      val unfiltered = ByteArrayOutputStream()
      val baseline = DeflaterOutputStream(unfiltered)
      val bytes = ByteArray(1 + width * 4)
      val file = writeTopicShareCapture(directory, width, height, {}) { writer ->
        val pixels = IntArray(width)
        repeat(height) { y ->
          for (x in pixels.indices) {
            val red = x * 255 / (width - 1)
            val green = y * 255 / (height - 1)
            val blue = (x / 12 + y / 12) % 256
            pixels[x] = (0xff000000L or (red.toLong() shl 16) or (green.toLong() shl 8) or blue.toLong()).toInt()
            val offset = 1 + x * 4
            bytes[offset] = red.toByte()
            bytes[offset + 1] = green.toByte()
            bytes[offset + 2] = blue.toByte()
            bytes[offset + 3] = 0xff.toByte()
          }
          baseline.write(bytes)
          writer.row(pixels)
        }
      }
      baseline.close()
      println("TOPIC_SHARE_COMPRESSION unfiltered=${unfiltered.size()} png=${file.length()}")
      assertTrue("correlated pixels must use less than half the unfiltered bytes", file.length() < unfiltered.size() / 2)
    } finally { directory.deleteRecursively() }
  }

  @Test fun longPngPreservesEveryPixelIncludingTheLastRowAndValidatesEveryChunk() = runBlocking {
    val directory = Files.createTempDirectory("topic-share-png-test").toFile()
    val width = 17
    val height = 35_001
    val random = Random(7)
    try {
      val file = writeTopicShareCapture(directory, width, height, {}) { writer ->
        val row = IntArray(width)
        for (y in 0 until height) {
          for (x in row.indices) row[x] = random.nextInt()
          writer.row(row)
        }
      }
      DataInputStream(file.inputStream()).use { input ->
        val signature = ByteArray(8).also(input::readFully)
        assertArrayEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10), signature)
        val compressed = ByteArrayOutputStream()
        var chunks = 0
        while (true) {
          val count = input.readInt()
          val type = ByteArray(4).also(input::readFully)
          val data = ByteArray(count).also(input::readFully)
          assertEquals(CRC32().apply { update(type); update(data) }.value.toInt(), input.readInt())
          when (String(type, Charsets.US_ASCII)) {
            "IHDR" -> DataInputStream(ByteArrayInputStream(data)).use { header ->
              assertEquals(width, header.readInt())
              assertEquals(height, header.readInt())
              assertArrayEquals(byteArrayOf(8, 6, 0, 0, 0), ByteArray(5).also(header::readFully))
            }
            "IDAT" -> { compressed.write(data); chunks++ }
            "IEND" -> break
          }
        }
        assertTrue("large PNG must span several IDAT chunks", chunks > 1)
        val rows = InflaterInputStream(ByteArrayInputStream(compressed.toByteArray())).use { it.readBytes() }
        assertEquals((1 + width * 4) * height, rows.size)
        val previousPixels = IntArray(width)
        val expected = Random(7)
        for (y in 0 until height) {
          val filter = rows[y * (1 + width * 4)].toInt()
          for (x in 0 until width) {
            val offset = y * (1 + width * 4) + 1 + x * 4
            val previous = when (filter) { 0 -> 0; 2 -> previousPixels[x]; else -> error("Unsupported PNG filter $filter") }
            val actual = (((rows[offset + 3].toInt() + (previous ushr 24)) and 0xff) shl 24) or
              (((rows[offset].toInt() + (previous ushr 16)) and 0xff) shl 16) or
              (((rows[offset + 1].toInt() + (previous ushr 8)) and 0xff) shl 8) or
              ((rows[offset + 2].toInt() + previous) and 0xff)
            previousPixels[x] = actual
            assertEquals(expected.nextInt(), actual)
          }
        }
        assertEquals(-1, input.read())
      }
      assertEquals(listOf(file), directory.listFiles()!!.toList())
    } finally { directory.deleteRecursively() }
  }

  @Test fun cancellationAndWriteOrCloseFailureRemoveOnlyTheOwnedPartialFile() = runBlocking {
    val directory = Files.createTempDirectory("topic-share-failure-test").toFile()
    val unrelated = File(directory, "existing.png").apply { writeText("keep") }
    try {
      for (mode in listOf("cancel", "header", "write", "close", "incomplete")) {
        var rows = 0
        var outputOpened = false
        val failure = try {
          writeTopicShareCapture(directory, 3, 300,
            checkActive = { if (mode == "cancel" && rows >= 257) throw IOException("canceled") },
            openOutput = { file ->
              outputOpened = true
              val output = file.outputStream()
              object : OutputStream() {
                override fun write(value: Int) {
                  if (mode == "header" || mode == "write" && rows >= 257) throw IOException("disk full")
                  output.write(value)
                }
                override fun close() { output.close(); if (mode == "close") throw IOException("close failed") }
              }
            }) { writer ->
            repeat(if (mode == "incomplete") 299 else 300) {
              rows++
              if (mode == "cancel" && rows >= 257) throw IOException("canceled")
              writer.row(intArrayOf(it, it, it))
            }
          }
          null
        } catch (error: Exception) { error }
        assertNotNull("$mode must fail", failure)
        assertTrue(outputOpened)
        assertEquals(listOf(unrelated), directory.listFiles()!!.toList())
        assertEquals("keep", unrelated.readText())
      }
    } finally { directory.deleteRecursively() }
  }

  @Test fun cancellationBeforeRenderingDoesNotOpenAnOutput() = runBlocking {
    val directory = Files.createTempDirectory("topic-share-pre-cancel-test").toFile()
    try {
      var opened = false
      try {
        writeTopicShareCapture(directory, 3, 300, { throw IOException("canceled") },
          openOutput = { opened = true; it.outputStream() }) { fail("canceled capture rendered") }
        fail("canceled capture succeeded")
      } catch (error: IOException) { assertEquals("canceled", error.message) }
      assertFalse(opened)
      assertEquals(0, directory.listFiles()!!.size)
    } finally { directory.deleteRecursively() }
  }
}
