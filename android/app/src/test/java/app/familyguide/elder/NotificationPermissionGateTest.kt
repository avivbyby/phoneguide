package app.familyguide.elder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionGateTest {
    private var requests = 0
    private var pending: ((Boolean) -> Unit)? = null
    private val events = mutableListOf<String>()

    private fun run(sdkInt: Int, granted: Boolean) {
        NotificationPermissionGate.beforeScreenShare(
            sdkInt = sdkInt,
            isGranted = granted,
            request = { onResult ->
                requests++
                pending = onResult
            },
            proceed = { events += "proceed" },
        )
    }

    @Test
    fun belowAndroid13_doesNotAsk_andShares() {
        run(sdkInt = 32, granted = false)
        assertEquals(0, requests)
        assertEquals(listOf("proceed"), events)
    }

    @Test
    fun alreadyGranted_doesNotAsk_andShares() {
        run(sdkInt = 33, granted = true)
        assertEquals(0, requests)
        assertEquals(listOf("proceed"), events)
    }

    @Test
    fun android13NotGranted_asksFirst_thenShares() {
        run(sdkInt = 35, granted = false)
        assertEquals(1, requests)
        assertTrue("must wait for the answer before the capture dialog", events.isEmpty())
        pending!!(true)
        assertEquals(listOf("proceed"), events)
    }

    @Test
    fun refusedNotifications_stillShares_once() {
        run(sdkInt = 33, granted = false)
        pending!!(false)
        assertEquals(listOf("proceed"), events)
    }
}
