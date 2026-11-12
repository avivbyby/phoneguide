package app.familyguide.elder

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** Same values as shared/src/protocol.ts. */
const val STUN_URL = "stun:stun.l.google.com:19302"
const val SIGNS_CHANNEL = "signs"

/** Public STUN only. No TURN server, paid or free. */
val ICE_SERVER_URLS: List<String> = listOf(STUN_URL)

/** Same text as the helper side (web/src/webrtc.ts). */
const val ICE_FAILED_MESSAGE = "לא הצלחנו להתחבר ישירות. נסו רשת אחרת או לקרב את שני הטלפונים."
const val SCREEN_SHARE_DENIED_MESSAGE = "צריך לאשר שיתוף מסך כדי שהקרוב יוכל לראות."

data class RtcSdp(val type: Type, val sdp: String) {
    enum class Type { OFFER, ANSWER }
}

/** Matches RTCIceCandidate.toJSON() on the helper: {candidate, sdpMid, sdpMLineIndex}. */
data class RtcCandidate(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int)

data class OfferOptions(val receiveAudio: Boolean, val receiveVideo: Boolean)

interface SignsChannelPort {
    fun close()
}

/** Events from the peer connection, delivered on the main thread. */
interface RtcPeerEvents {
    fun onIceCandidate(candidate: RtcCandidate)
    fun onConnectionFailed()
    fun onSignsMessage(json: String)
    /** The user stopped the screen capture from the system UI. */
    fun onScreenCaptureStopped()
}

/**
 * Thin seam over org.webrtc.PeerConnection so ElderPeer can be tested on the JVM.
 * There is deliberately no way to add an audio track.
 */
interface RtcPeer {
    fun addScreenVideoTrack()
    fun createDataChannel(label: String, negotiated: Boolean): SignsChannelPort
    fun createOffer(options: OfferOptions, onSuccess: (RtcSdp) -> Unit, onFailure: (String) -> Unit)
    fun setLocalDescription(sdp: RtcSdp, onDone: () -> Unit)
    fun setRemoteDescription(sdp: RtcSdp, onDone: () -> Unit)
    fun addIceCandidate(candidate: RtcCandidate)
    fun close()
}

fun interface RtcPeerFactory {
    fun create(iceServerUrls: List<String>, events: RtcPeerEvents): RtcPeer
}

/** Starts / stops ScreenShareService (the foreground service MediaProjection requires). */
interface ScreenShareControl {
    /** [onForeground] runs once the service is in the foreground. */
    fun start(onForeground: () -> Unit)
    fun stop()
}

/**
 * Elder side of the call: the elder is the offerer, sends the screen as video only
 * (no audio, STUN only, no TURN) and opens the `signs` DataChannel for the helper.
 * Not thread-safe: call from the main thread only.
 */
class ElderPeer(
    private val session: SessionClient,
    private val screenShare: ScreenShareControl,
) {
    /** Raw JSON received on the `signs` channel. Drawing it is Task 10. */
    var onSignsMessage: (json: String) -> Unit = {}

    /** The call ended without [hangup] being called; [message] is Hebrew text to show, if any. */
    var onEnded: (message: String?) -> Unit = {}

    private var rtc: RtcPeer? = null
    private var channel: SignsChannelPort? = null
    private var started = false
    private var ended = false
    private var remoteSet = false
    private val pendingCandidates = mutableListOf<RtcCandidate>()

    /** The user approved the screen capture: start the service, then the call. */
    fun startCall(factory: RtcPeerFactory) {
        if (ended || started) return
        started = true
        screenShare.start { if (!ended) beginOffer(factory) }
    }

    /** The user refused the screen capture: no call, and the code must not stay usable. */
    fun screenShareDenied() {
        if (ended) return
        end(SCREEN_SHARE_DENIED_MESSAGE)
    }

    /** [json] is the signal payload relayed by SessionClient.onSignal. */
    fun handleSignal(json: String) {
        val peer = rtc ?: return
        if (ended) return
        val signal = try {
            WsProtocol.parsePayload(json) as? JsonObject
        } catch (_: IllegalArgumentException) {
            null
        } ?: return

        when (signal.string("type")) {
            "answer" -> {
                val sdp = signal.string("sdp") ?: return
                if (remoteSet) return
                peer.setRemoteDescription(RtcSdp(RtcSdp.Type.ANSWER, sdp)) {
                    if (ended) return@setRemoteDescription
                    remoteSet = true
                    val queued = pendingCandidates.toList()
                    pendingCandidates.clear()
                    queued.forEach(peer::addIceCandidate)
                }
            }
            "candidate" -> {
                val candidate = parseCandidate(signal["candidate"] as? JsonObject) ?: return
                if (remoteSet) peer.addIceCandidate(candidate) else pendingCandidates += candidate
            }
        }
    }

    /** Stops the service, closes the peer, and hangs up the session. */
    fun hangup() {
        if (ended) return
        teardown()
    }

    private fun beginOffer(factory: RtcPeerFactory) {
        val peer: RtcPeer
        try {
            peer = factory.create(ICE_SERVER_URLS, Events())
            rtc = peer
            peer.addScreenVideoTrack()
            // negotiated = false: the helper receives it on `ondatachannel`.
            channel = peer.createDataChannel(SIGNS_CHANNEL, negotiated = false)
        } catch (e: RuntimeException) {
            end(null)
            return
        }
        peer.createOffer(
            OfferOptions(receiveAudio = false, receiveVideo = false),
            onSuccess = { offer ->
                if (ended) return@createOffer
                peer.setLocalDescription(offer) {
                    if (!ended) sendSignal(sdpPayload(offer))
                }
            },
            onFailure = { if (!ended) end(null) },
        )
    }

    private fun end(message: String?) {
        teardown()
        onEnded(message)
    }

    private fun teardown() {
        ended = true
        pendingCandidates.clear()
        channel?.close()
        channel = null
        rtc?.close()
        rtc = null
        screenShare.stop()
        session.hangup()
    }

    private fun sendSignal(payload: JsonObject) {
        session.sendSignal(payload.toString())
    }

    private inner class Events : RtcPeerEvents {
        override fun onIceCandidate(candidate: RtcCandidate) {
            if (!ended) sendSignal(candidatePayload(candidate))
        }

        override fun onConnectionFailed() {
            // No TURN fallback: tell the elder and end.
            if (!ended) end(ICE_FAILED_MESSAGE)
        }

        override fun onSignsMessage(json: String) {
            if (!ended) this@ElderPeer.onSignsMessage(json)
        }

        override fun onScreenCaptureStopped() {
            if (!ended) end(null)
        }
    }

    private companion object {
        fun sdpPayload(sdp: RtcSdp): JsonObject = buildJsonObject {
            put("type", sdp.type.name.lowercase())
            put("sdp", sdp.sdp)
        }

        fun candidatePayload(c: RtcCandidate): JsonObject = buildJsonObject {
            put("type", "candidate")
            put("candidate", buildJsonObject {
                put("candidate", c.candidate)
                put("sdpMid", c.sdpMid)
                put("sdpMLineIndex", c.sdpMLineIndex)
            })
        }

        fun parseCandidate(obj: JsonObject?): RtcCandidate? {
            obj ?: return null
            val candidate = obj.string("candidate") ?: return null
            val mid = obj["sdpMid"]
            val sdpMid = when {
                mid == null || mid is JsonNull -> null
                else -> (mid as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            }
            val index = (obj["sdpMLineIndex"] as? JsonPrimitive)?.intOrNull ?: 0
            return RtcCandidate(candidate, sdpMid, index)
        }

        fun JsonObject.string(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}
