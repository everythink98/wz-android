package com.wz.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApkInstallerSignerTest {
  @Test
  fun acceptsOnlyOneCurrentSigner() {
    assertEquals("current", singleCurrentApkSigner(arrayOf("current"), arrayOf("old", "current")))
    assertNull(singleCurrentApkSigner(emptyArray<String>(), arrayOf("old")))
    assertNull(singleCurrentApkSigner(arrayOf("current", "other"), arrayOf("old")))
  }
}
