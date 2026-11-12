package app.familyguide.elder

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

private class FakeSocket : ClientSocket {
    val sent = mutableListOf<String>()
    var closed = false
    private var listener: ClientSocket.Listener? = null

    override fun connect(listener: ClientSocket.Listener) {
        this.listener = listener
    }

    override fun send(text: String) {
        sent += text
    }

    override fun close() {
        closed = true
    }

    fun receive(text: String) {
        listener!!.onMessage(text)
    }

    fun drop() {
        listener!!.onClosed()
    }

    fun fail(error: Throwable) {
        listener!!.onFailure(error)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SessionClientTest {
    private val socket = FakeSocket()
    private val urls = mutableListOf<String>()
    private val client = SessionClient(
        wsFactory = { url -> urls += url; socket },
        url = "wss://test.invalid/ws",
    )

    @Test
    fun createSessionSendsCreateAndReturnsCode() = runTest {
        val code = async { client.createSession() }
        runCurrent()
        assertEquals(listOf("wss://test.invalid/ws"), urls)
        assertEquals(listOf("""{"type":"create"}"""), socket.sent)

        socket.receive("""{ "type":"created", "code":"654321" }""")
        assertEquals("654321", code.await())
    }

    @Test
    fun errorMessageInvokesOnError() = runTest {
        val errors = mutableListOf<String>()
        client.onError = { errors += it }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        socket.receive("""{ "type":"error", "code":"invalid" }""")
        assertEquals(listOf("invalid"), errors)
    }

    @Test
    fun errorBeforeCreatedFailsCreateSession() = runTest {
        val errors = mutableListOf<String>()
        client.onError = { errors += it }
        val code = async { runCatching { client.createSession() } }
        runCurrent()
        socket.receive("""{ "type":"error", "code":"rate_limited" }""")
        val result = code.await()
        assertTrue(result.isFailure)
        assertEquals(listOf("rate_limited"), errors)
    }

    @Test
    fun socketClosedBeforeCreatedFailsCreateSession() = runTest {
        val code = async { runCatching { client.createSession() } }
        runCurrent()
        socket.drop()
        assertTrue(code.await().isFailure)
    }

    @Test
    fun createdWithoutSixDigitCodeFails() = runTest {
        val code = async { runCatching { client.createSession() } }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"12ab" }""")
        assertTrue(code.await().isFailure)
    }

    @Test
    fun hangupSendsHangupAndCloses() = runTest {
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        client.hangup()
        assertEquals("""{"type":"hangup"}""", socket.sent.last())
        assertTrue(socket.closed)
    }

    @Test
    fun peerEventsAndSignalsReachCallbacks() = runTest {
        var joined = 0
        var left = 0
        val signals = mutableListOf<String>()
        client.onPeerJoined = { joined++ }
        client.onPeerLeft = { left++ }
        client.onSignal = { signals += it }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        socket.receive("""{"type":"peer-joined"}""")
        socket.receive("""{"type":"signal","payload":{"type":"answer","sdp":"v=0"}}""")
        socket.receive("""{"type":"peer-left"}""")
        socket.receive("""not json""")
        socket.receive("""{"type":"mystery"}""")

        assertEquals(1, joined)
        assertEquals(1, left)
        assertEquals(listOf("""{"type":"answer","sdp":"v=0"}"""), signals)
    }

    @Test
    fun sendSignalWrapsPayloadObject() = runTest {
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        client.sendSignal("""{"type":"offer","sdp":"v=0"}""")
        assertEquals(
            """{"type":"signal","payload":{"type":"offer","sdp":"v=0"}}""",
            socket.sent.last(),
        )
    }

    @Test
    fun sendSignalRejectsNonJson() = runTest {
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()
        try {
            client.sendSignal("not json")
            fail("expected IllegalArgumentException")
        } catch (_: IllegalArgumentException) {
        }
    }

    @Test
    fun socketClosedAfterCreatedFiresOnClosedOnce() = runTest {
        var closes = 0
        client.onClosed = { closes++ }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        socket.drop()
        socket.drop()
        socket.fail(RuntimeException("late failure after close"))
        assertEquals(1, closes)

        // The dead socket is forgotten: nothing is sent into it.
        val before = socket.sent.size
        client.sendSignal("""{"type":"offer","sdp":"v=0"}""")
        assertEquals(before, socket.sent.size)
    }

    @Test
    fun socketFailureAfterCreatedFiresOnClosed() = runTest {
        var closes = 0
        client.onClosed = { closes++ }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        socket.fail(RuntimeException("network down"))
        assertEquals(1, closes)
    }

    @Test
    fun deliberateHangupDoesNotFireOnClosedOrOnError() = runTest {
        var closes = 0
        val errors = mutableListOf<String>()
        client.onClosed = { closes++ }
        client.onError = { errors += it }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        client.hangup()
        socket.drop() // the transport confirms the close afterwards
        assertEquals(0, closes)
        assertEquals(emptyList<String>(), errors)
    }

    @Test
    fun socketClosedBeforeCreatedDoesNotFireOnClosed() = runTest {
        var closes = 0
        client.onClosed = { closes++ }
        val code = async { runCatching { client.createSession() } }
        runCurrent()
        socket.drop()
        assertTrue(code.await().isFailure)
        assertEquals(0, closes)
    }

    @Test
    fun serverErrorBeforeCloseIsPassedToOnClosed() = runTest {
        val reasons = mutableListOf<String?>()
        client.onClosed = { reasons += it }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        // The server tells the elder the unused code expired, then closes.
        socket.receive("""{ "type":"error", "code":"expired" }""")
        socket.drop()
        assertEquals(listOf<String?>("expired"), reasons)
    }

    @Test
    fun plainDropAfterCreatedHasNoServerError() = runTest {
        val reasons = mutableListOf<String?>()
        client.onClosed = { reasons += it }
        val code = async { client.createSession() }
        runCurrent()
        socket.receive("""{ "type":"created", "code":"654321" }""")
        code.await()

        socket.drop()
        assertEquals(listOf<String?>(null), reasons)
    }
}
