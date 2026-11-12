package app.familyguide.elder

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureSizeTrackerTest {
    private var real = ScreenSize(1080, 2400)
    private val changes = mutableListOf<Triple<Int, Int, Int>>()
    private val tracker = CaptureSizeTracker(fps = 15, realScreenSize = { real }) { w, h, fps ->
        changes += Triple(w, h, fps)
    }

    @Test
    fun initialSizeIsTheRealScreenSize() {
        assertEquals(ScreenSize(1080, 2400), tracker.initial())
        assertEquals(emptyList<Triple<Int, Int, Int>>(), changes)
    }

    @Test
    fun rotationChangesTheCaptureFormatToTheNewRealSize() {
        tracker.initial()
        real = ScreenSize(2400, 1080)
        tracker.onDisplayChanged()
        assertEquals(listOf(Triple(2400, 1080, 15)), changes)

        real = ScreenSize(1080, 2400)
        tracker.onDisplayChanged()
        assertEquals(listOf(Triple(2400, 1080, 15), Triple(1080, 2400, 15)), changes)
    }

    @Test
    fun displayChangeWithTheSameSizeDoesNothing() {
        tracker.initial()
        tracker.onDisplayChanged()
        tracker.onDisplayChanged()
        assertEquals(emptyList<Triple<Int, Int, Int>>(), changes)
    }

    @Test
    fun displayChangeBeforeCaptureStartsDoesNothing() {
        real = ScreenSize(2400, 1080)
        tracker.onDisplayChanged()
        assertEquals(emptyList<Triple<Int, Int, Int>>(), changes)
    }

    @Test
    fun invalidSizeIsIgnored() {
        tracker.initial()
        real = ScreenSize(0, 0)
        tracker.onDisplayChanged()
        assertEquals(emptyList<Triple<Int, Int, Int>>(), changes)
    }
}
