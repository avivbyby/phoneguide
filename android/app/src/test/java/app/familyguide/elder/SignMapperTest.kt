package app.familyguide.elder

import org.junit.Assert.assertEquals
import org.junit.Test

class SignMapperTest {
    @Test
    fun mapsNormalizedCoordinatesToScreenPixels() {
        assertEquals(Pair(0, 0), SignMapper.toPixels(0f, 0f, 1000, 2000))
        assertEquals(Pair(1000, 2000), SignMapper.toPixels(1f, 1f, 1000, 2000))
        assertEquals(Pair(250, 500), SignMapper.toPixels(0.25f, 0.25f, 1000, 2000))
        assertEquals(Pair(0, 2000), SignMapper.toPixels(-1f, 2f, 1000, 2000))
    }

    @Test
    fun nonFiniteValuesGoToTheTopLeft() {
        assertEquals(Pair(0, 0), SignMapper.toPixels(Float.NaN, Float.NaN, 1000, 2000))
    }
}
