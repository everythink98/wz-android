package com.wz.reader

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForumSearchCustomTabUrlTest {
  @Test
  fun acceptsOnlyScopedGoogleSearchUrls() {
    assertTrue(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+codex"))
    assertTrue(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Anodeseek.com+codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+"))
    assertFalse(isAllowedForumSearchUrl("https://attacker@www.google.com/search?q=site%3Alinux.do+codex"))
    assertFalse(isAllowedForumSearchUrl("https://example.com/search?q=site%3Alinux.do+codex"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+codex&start=10"))
    assertFalse(isAllowedForumSearchUrl("https://www.google.com/search?q=site%3Alinux.do+%"))
  }
}
