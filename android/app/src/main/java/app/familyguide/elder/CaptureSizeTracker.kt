package app.familyguide.elder

data class ScreenSize(val width: Int, val height: Int)

/**
 * Keeps the screen capture at the real full-screen size (the same frame [SignOverlay]
 * places signs against), and re-sizes it when the display rotates. Plain logic so it
 * runs in JVM tests; [WebRtcPeer] feeds it the real display metrics and wires
 * [changeFormat] to ScreenCapturerAndroid.changeCaptureFormat.
 */
class CaptureSizeTracker(
    private val fps: Int,
    private val realScreenSize: () -> ScreenSize,
    private val changeFormat: (width: Int, height: Int, fps: Int) -> Unit,
) {
    private var current: ScreenSize? = null

    /** Size to start the capture with. */
    fun initial(): ScreenSize = realScreenSize().also { current = it }

    /** Call on a display change (e.g. rotation); changes the capture format only if the size changed. */
    fun onDisplayChanged() {
        val previous = current ?: return
        val size = realScreenSize()
        if (size.width <= 0 || size.height <= 0 || size == previous) return
        current = size
        changeFormat(size.width, size.height, fps)
    }
}
