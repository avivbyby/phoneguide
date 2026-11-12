package app.familyguide.elder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SignOverlayParseTest {
    @Test
    fun parsesSignClearAndRejectsControlAndLongNotes() {
        assertTrue(parseChannelMessage("""{"type":"sign","kind":"scroll_down","x":0.5,"y":0.4}""") is ChannelMsg.Sign)
        assertEquals("גלול למטה", (parseChannelMessage("""{"type":"sign","kind":"scroll_down","x":0.5,"y":0.4}""") as ChannelMsg.Sign).label)
        assertTrue(parseChannelMessage("""{"type":"clear_sign"}""") is ChannelMsg.Clear)
        assertEquals(null, parseChannelMessage("""{"type":"remote_tap","x":0.5,"y":0.5}"""))
        assertEquals(null, parseChannelMessage("""{"type":"sign","kind":"note","x":0.1,"y":0.1,"text":"${"א".repeat(41)}"}"""))
    }

    @Test
    fun parsesHangup() {
        assertTrue(parseChannelMessage("""{"type":"hangup"}""") is ChannelMsg.Hangup)
    }

    @Test
    fun labelsMatchSharedSignLabels() {
        val expected = mapOf(
            "tap" to "לחץ כאן",
            "long_press" to "לחיצה ארוכה",
            "scroll_up" to "גלול למעלה",
            "scroll_down" to "גלול למטה",
            "swipe_right" to "החלק ימינה",
            "swipe_left" to "החלק שמאלה",
            "zoom_in" to "זום פנימה",
            "zoom_out" to "זום החוצה",
            "back" to "חזור",
            "note" to "הערה",
        )
        assertEquals(expected, SIGN_LABELS)
        for ((kind, label) in expected) {
            val text = if (kind == "note") ""","text":"שלום"""" else ""
            val msg = parseChannelMessage("""{"type":"sign","kind":"$kind","x":0.5,"y":0.5$text}""")
            assertEquals(label, (msg as ChannelMsg.Sign).label)
        }
    }

    @Test
    fun noteKeepsTrimmedTextUpTo40Chars() {
        val msg = parseChannelMessage("""{"type":"sign","kind":"note","x":0.1,"y":0.1,"text":"  ${"א".repeat(40)} "}""")
        assertEquals("א".repeat(40), (msg as ChannelMsg.Sign).text)
        assertEquals(null, parseChannelMessage("""{"type":"sign","kind":"note","x":0.1,"y":0.1,"text":"   "}"""))
        assertEquals(null, parseChannelMessage("""{"type":"sign","kind":"note","x":0.1,"y":0.1}"""))
    }

    @Test
    fun clampsCoordinatesLikeShared() {
        val msg = parseChannelMessage("""{"type":"sign","kind":"tap","x":-3,"y":7}""") as ChannelMsg.Sign
        assertEquals(0f, msg.x, 0f)
        assertEquals(1f, msg.y, 0f)
    }

    @Test
    fun rejectsMalformedOrControlMessages() {
        val bad = listOf(
            "not json",
            "[]",
            "\"sign\"",
            """{"type":"sign","kind":"click","x":0.5,"y":0.5}""",
            """{"type":"sign","kind":"tap","x":"0.5","y":0.5}""",
            """{"type":"sign","kind":"tap","x":0.5}""",
            """{"type":"sign","kind":"tap","x":true,"y":0.5}""",
            """{"type":"clear_sign","x":1}""",
            """{"type":"hangup","reason":"x"}""",
            """{"type":"remote_swipe","x":0.5,"y":0.5}""",
            """{"type":"inject_input","x":0.5,"y":0.5}""",
            """{"kind":"tap","x":0.5,"y":0.5}""",
        )
        for (json in bad) assertEquals(json, null, parseChannelMessage(json))
    }
}
