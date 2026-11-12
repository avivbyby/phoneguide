package app.familyguide.elder

import kotlin.math.roundToInt

/**
 * Maps the helper's normalized sign position to screen pixels.
 * `(0,0)` is the top-left of the screen and `(1,1)` the bottom-right; values outside 0..1
 * are clamped (same rule as `clampCoord` in shared/src/signs.ts).
 */
object SignMapper {
    fun toPixels(x: Float, y: Float, width: Int, height: Int): Pair<Int, Int> =
        Pair((clamp(x) * width).roundToInt(), (clamp(y) * height).roundToInt())

    fun clamp(n: Float): Float = when {
        n.isNaN() || n.isInfinite() -> 0f
        n < 0f -> 0f
        n > 1f -> 1f
        else -> n
    }
}
