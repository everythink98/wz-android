package com.wz.reader

import android.content.res.Resources
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import com.facebook.react.common.assets.ReactFontManager
import com.wz.reader.platform.R

object ReaderTypeface {
  fun register(resources: Resources) {
    val manager = ReactFontManager.getInstance()
    if (FAMILY !in manager.customFontFamilies) {
      val regular = Font.Builder(resources, R.font.noto_sans_sc).buildAtWeight(400)
      // Reading the same compressed resource per weight retains a separate decompressed copy.
      val fontBytes = regular.buffer
      val family = FontFamily.Builder(regular)
      for (weight in intArrayOf(500, 600, 700)) {
        family.addFont(Font.Builder(fontBytes).buildAtWeight(weight))
      }
      val typeface = Typeface.CustomFallbackBuilder(family.build()).setSystemFallback("sans-serif").build()
      manager.addCustomFont(FAMILY, typeface)
    }
  }

  private fun Font.Builder.buildAtWeight(weight: Int): Font =
    setWeight(weight).setFontVariationSettings("'wght' $weight").build()

  private const val FAMILY = "WzNotoSansSC"
}
