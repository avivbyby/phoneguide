package app.familyguide.elder

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class PeerTestSocket : ClientSocket {
    val sent = mutableListOf<String>()
    private var listener: ClientSocket.Listener? = null

    override fun connect(listener: ClientSocket.Listener) {
        this.listener = listener
    }

    override fun send(text: String) {
        sent += text
    }

    override fun close() = Unit

    fun receive(text: String) {
        listener!!.onMessage(text)
    }
}

private class FakeChannel(val label: String, val negotiated: Boolean) : SignsChannelPort {
    var closed = false
    override fun close() {
        closed = true
    }
}

/** Stands in for org.webrtc.PeerConnection (native code cannot load in JVM tests). */
private class FakeRtcPeer(val iceServerUrls: List<String>, val events: RtcPeerEvents) : RtcPeer {
    val log = mutableListOf<String>()
    val tracks = mutableListOf<String>()
    val channels = mutableListOf<FakeChannel>()
    var offerOptions: OfferOptions? = null
    var local: RtcSdp? = null
    var remote: RtcSdp? = null
    val added = mutableListOf<RtcCandidate>()
    var closed = false

    override fun addScreenVideoTrack() {
        tracks += "video"
        log += "track:video"
    }

    override fun createDataChannel(label: String, negotiated: Boolean): SignsChannelPort {
        log += "channel:$label"
        return FakeChannel(label, negotiated).also { channels += it }
    }

    override fun createOffer(options: OfferOptions, onSuccess: (RtcSdp) -> Unit, onFailure: (String) -> Unit) {
        log += "offer"
        offerOptions = options
        onSuccess(RtcSdp(RtcSdp.Type.OFFER, "v=0 offer"))
    }

    override fun setLocalDescription(sdp: RtcSdp, onDone: () -> Unit) {
        local = sdp
        onDone()
    }

    override fun setRemoteDescription(sdp: RtcSdp, onDone: () -> Unit) {
        remote = sdp
        log += "remote:${sdp.type}"
        onDone()
    }

    override fun addIceCandidate(candidate: RtcCandidate) {
        added += candidate
        log += "candidate:${candidate.candidate}"
    }

    override fun close() {
        closed = true
    }
}

private class FakePeerFactory : RtcPeerFactory {
    val created = mutableListOf<FakeRtcPeer>()
    override fun create(iceServerUrls: List<String>, events: RtcPeerEvents): RtcPeer =
        FakeRtcPeer(iceServerUrls, events).also { created += it }
}

private class FakeScreenShare : ScreenShareControl {
    var startCount = 0
    var stopCount = 0
    var onReady: (() -> Unit)? = null

    override fun start(onForeground: () -> Unit) {
        startCount++
        onReady = onForeground
    }

    override fun stop() {
        stopCount++
    }

    fun becomeForeground() = onReady!!.invoke()
}

@OptIn(ExperimentalCoroutinesApi::class)
class ElderPeerTest {
    private val socket = PeerTestSocket()
    private val session = SessionClient(wsFactory = { socket }, url = "wss://test.invalid/ws")
    private val screen = FakeScreenShare()
    private val factory = FakePeerFactory()
    private val signs = mutableListOf<String>()
    private val ended = mutableListOf<String?>()
    private val peer = ElderPeer(session, screen).apply {
        onSignsMessage = { signs += it }
        onEnded = { ended += it }
    }

    private suspend fun TestScope.connectedSession() {
        val code = async { session.createSession() }
        runCurrent()
        socket.receive("""{"type":"created","code":"123456"}""")
        code.await()
        socket.sent.clear()
    }

    private fun startedCall(): FakeRtcPeer {
        peer.startCall(factory)
        screen.becomeForeground()
        return factory.created.single()
    }

    @Test
    fun iceServersAreOnlyTheApprovedStun() = runTest {
        connectedSession()
        val rtc = startedCall()
        assertEquals(listOf("stun:stun.l.google.com:19302"), rtc.iceServerUrls)
        assertEquals(listOf("stun:stun.l.google.com:19302"), ICE_SERVER_URLS)
        assertEquals("stun:stun.l.google.com:19302", STUN_URL)
        assertTrue(rtc.iceServerUrls.none { it.startsWith("turn:") || it.startsWith("turns:") })
    }

    @Test
    fun realIceServerConfigIsStunOnlyWithoutCredentials() {
        val servers = buildIceServers(ICE_SERVER_URLS)
        assertEquals(1, servers.size)
        assertEquals(listOf("stun:stun.l.google.com:19302"), servers.single().urls)
        assertEquals("", servers.single().username)
        assertEquals("", servers.single().password)
    }

    @Test
    fun peerIsCreatedOnlyAfterTheServiceIsInForeground() = runTest {
        connectedSession()
        peer.startCall(factory)
        assertEquals(1, screen.startCount)
        assertTrue(factory.created.isEmpty())
        screen.becomeForeground()
        assertEquals(1, factory.created.size)
    }

    @Test
    fun offerHasNoAudioTrack() = runTest {
        connectedSession()
        val rtc = startedCall()
        assertEquals(listOf("video"), rtc.tracks)
        assertFalse(rtc.offerOptions!!.receiveAudio)
        assertFalse(rtc.offerOptions!!.receiveVideo)
        assertEquals(RtcSdp(RtcSdp.Type.OFFER, "v=0 offer"), rtc.local)
        assertEquals(
            listOf("""{"type":"signal","payload":{"type":"offer","sdp":"v=0 offer"}}"""),
            socket.sent,
        )
    }

    @Test
    fun opensChannelNamedSignsBeforeTheOffer() = runTest {
        connectedSession()
        val rtc = startedCall()
        val channel = rtc.channels.single()
        assertEquals("signs", channel.label)
        assertEquals(SIGNS_CHANNEL, channel.label)
        assertFalse(channel.negotiated)
        assertTrue(rtc.log.indexOf("channel:signs") < rtc.log.indexOf("offer"))
    }

    @Test
    fun hangupClosesChannelPeerServiceAndSession() = runTest {
        connectedSession()
        val rtc = startedCall()
        socket.sent.clear()

        peer.hangup()

        assertTrue(rtc.channels.single().closed)
        assertTrue(rtc.closed)
        assertEquals(1, screen.stopCount)
        assertEquals(listOf("""{"type":"hangup"}"""), socket.sent)
        assertTrue(ended.isEmpty())

        peer.hangup()
        assertEquals(1, screen.stopCount)
        assertEquals(1, socket.sent.size)
    }

    @Test
    fun refusingScreenShareEndsTheSessionWithoutACall() = runTest {
        connectedSession()
        peer.screenShareDenied()

        assertEquals(0, screen.startCount)
        assertTrue(factory.created.isEmpty())
        assertEquals(listOf("""{"type":"hangup"}"""), socket.sent)
        assertEquals(listOf("צריך לאשר שיתוף מסך כדי שהקרוב יוכל לראות."), ended)
    }

    @Test
    fun iceFailureShowsHebrewMessageAndEnds() = runTest {
        connectedSession()
        val rtc = startedCall()
        socket.sent.clear()

        rtc.events.onConnectionFailed()

        assertEquals(listOf("לא הצלחנו להתחבר ישירות. נסו רשת אחרת או לקרב את שני הטלפונים."), ended)
        assertTrue(rtc.closed)
        assertTrue(rtc.channels.single().closed)
        assertEquals(1, screen.stopCount)
        assertEquals(listOf("""{"type":"hangup"}"""), socket.sent)
        // No retry with another server.
        assertEquals(1, factory.created.size)
    }

    @Test
    fun localCandidateIsSentInTheHelperEnvelope() = runTest {
        connectedSession()
        val rtc = startedCall()
        socket.sent.clear()

        rtc.events.onIceCandidate(RtcCandidate("candidate:1 1 udp 1 1.2.3.4 5 typ host", "0", 0))

        assertEquals(
            listOf(
                """{"type":"signal","payload":{"type":"candidate","candidate":""" +
                    """{"candidate":"candidate:1 1 udp 1 1.2.3.4 5 typ host","sdpMid":"0","sdpMLineIndex":0}}}""",
            ),
            socket.sent,
        )
    }

    @Test
    fun remoteCandidatesAreQueuedUntilTheAnswerIsSet() = runTest {
        connectedSession()
        val rtc = startedCall()

        peer.handleSignal("""{"type":"candidate","candidate":{"candidate":"candidate:a","sdpMid":"0","sdpMLineIndex":0}}""")
        assertTrue(rtc.added.isEmpty())

        peer.handleSignal("""{"type":"answer","sdp":"v=0 answer"}""")
        assertEquals(RtcSdp(RtcSdp.Type.ANSWER, "v=0 answer"), rtc.remote)
        assertEquals(listOf(RtcCandidate("candidate:a", "0", 0)), rtc.added)
        assertTrue(rtc.log.indexOf("remote:ANSWER") < rtc.log.indexOf("candidate:candidate:a"))

        peer.handleSignal("""{"type":"candidate","candidate":{"candidate":"candidate:b","sdpMid":null,"sdpMLineIndex":1}}""")
        assertEquals(RtcCandidate("candidate:b", null, 1), rtc.added.last())
    }

    @Test
    fun malformedSignalsAreIgnored() = runTest {
        connectedSession()
        val rtc = startedCall()
        peer.handleSignal("not json")
        peer.handleSignal("""{"type":"offer","sdp":"x"}""")
        peer.handleSignal("""{"type":"candidate"}""")
        assertNull(rtc.remote)
        assertTrue(rtc.added.isEmpty())
    }

    @Test
    fun signsMessagesAreDeliveredAsJson() = runTest {
        connectedSession()
        val rtc = startedCall()
        rtc.events.onSignsMessage("""{"type":"sign","id":"tap"}""")
        assertEquals(listOf("""{"type":"sign","id":"tap"}"""), signs)
    }

    @Test
    fun foregroundAfterHangupDoesNotStartAPeer() = runTest {
        connectedSession()
        peer.startCall(factory)
        peer.hangup()
        screen.becomeForeground()
        assertTrue(factory.created.isEmpty())
    }
}
