package app.familyguide.elder

/**
 * On Android 13+ (API 33) the foreground-service notification «משתפים את המסך» is hidden
 * unless POST_NOTIFICATIONS is granted. Ask for it right before the screen-capture consent.
 * A refusal never blocks the share: the system's own capture indicator still shows.
 */
object NotificationPermissionGate {
    const val TIRAMISU = 33

    fun beforeScreenShare(
        sdkInt: Int,
        isGranted: Boolean,
        request: (onResult: (Boolean) -> Unit) -> Unit,
        proceed: () -> Unit,
    ) {
        if (sdkInt < TIRAMISU || isGranted) {
            proceed()
            return
        }
        var done = false
        request { _ ->
            if (!done) {
                done = true
                proceed()
            }
        }
    }
}
