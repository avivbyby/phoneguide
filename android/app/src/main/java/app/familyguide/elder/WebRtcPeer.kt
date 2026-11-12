package app.familyguide.elder

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/** org.webrtc ICE servers for [urls]: plain STUN entries, no credentials (so no TURN). */
fun buildIceServers(urls: List<String>): List<PeerConnection.IceServer> =
    urls.map { PeerConnection.IceServer.builder(it).createIceServer() }

/**
 * Real [RtcPeerFactory] backed by stream-webrtc-android. [projectionData] is the
 * result Intent of MediaProjectionManager.createScreenCaptureIntent().
 * Must be used only after ScreenShareService is in the foreground.
 */
class WebRtcPeerFactory(
    private val context: Context,
    private val projectionData: Intent,
) : RtcPeerFactory {
    override fun create(iceServerUrls: List<String>, events: RtcPeerEvents): RtcPeer =
        WebRtcPeer(context.applicationContext, projectionData, iceServerUrls, events)
}

private class WebRtcPeer(
    private val context: Context,
    projectionData: Intent,
    iceServerUrls: List<String>,
    private val events: RtcPeerEvents,
) : RtcPeer {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var closed = false

    private val egl: EglBase = EglBase.create()
    private val factory: PeerConnectionFactory
    private val pc: PeerConnection
    private val capturer: ScreenCapturerAndroid
    private var textureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions(),
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()

        val config = PeerConnection.RTCConfiguration(buildIceServers(iceServerUrls)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        pc = requireNotNull(factory.createPeerConnection(config, Observer())) {
            "createPeerConnection failed"
        }
        capturer = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() {
            override fun onStop() = onMain { events.onScreenCaptureStopped() }
        })
    }

    override fun addScreenVideoTrack() {
        val helper = SurfaceTextureHelper.create("ScreenCapture", egl.eglBaseContext)
        val source = factory.createVideoSource(/* isScreencast = */ true)
        capturer.initialize(helper, context, source.capturerObserver)
        val metrics = context.resources.displayMetrics
        capturer.startCapture(metrics.widthPixels, metrics.heightPixels, CAPTURE_FPS)
        val track = factory.createVideoTrack("screen", source)
        pc.addTrack(track, listOf("screen"))
        textureHelper = helper
        videoSource = source
        videoTrack = track
    }

    override fun createDataChannel(label: String, negotiated: Boolean): SignsChannelPort {
        val init = DataChannel.Init().apply {
            ordered = true
            this.negotiated = negotiated
        }
        val channel = requireNotNull(pc.createDataChannel(label, init)) { "createDataChannel failed" }
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() = Unit
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (buffer.binary) return
                val text = buffer.data.utf8()
                onMain { events.onSignsMessage(text) }
            }
        })
        return object : SignsChannelPort {
            private var done = false
            override fun close() {
                if (done) return
                done = true
                channel.unregisterObserver()
                channel.close()
                channel.dispose()
            }
        }
    }

    override fun createOffer(options: OfferOptions, onSuccess: (RtcSdp) -> Unit, onFailure: (String) -> Unit) {
        val constraints = MediaConstraints().apply {
            mandatory += MediaConstraints.KeyValuePair("OfferToReceiveAudio", options.receiveAudio.toString())
            mandatory += MediaConstraints.KeyValuePair("OfferToReceiveVideo", options.receiveVideo.toString())
        }
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(sdp: SessionDescription) =
                onMain { onSuccess(RtcSdp(RtcSdp.Type.OFFER, sdp.description)) }

            override fun onCreateFailure(error: String?) = onMain { onFailure(error ?: "") }
        }, constraints)
    }

    override fun setLocalDescription(sdp: RtcSdp, onDone: () -> Unit) {
        pc.setLocalDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() = onMain(onDone)
        }, sdp.toWebRtc())
    }

    override fun setRemoteDescription(sdp: RtcSdp, onDone: () -> Unit) {
        pc.setRemoteDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() = onMain(onDone)
        }, sdp.toWebRtc())
    }

    override fun addIceCandidate(candidate: RtcCandidate) {
        if (closed) return
        pc.addIceCandidate(IceCandidate(candidate.sdpMid ?: "", candidate.sdpMLineIndex, candidate.candidate))
    }

    override fun close() {
        if (closed) return
        closed = true
        try {
            capturer.stopCapture()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        capturer.dispose()
        pc.dispose() // closes the connection and releases senders / transceivers
        videoSource?.dispose()
        textureHelper?.dispose()
        factory.dispose()
        egl.release()
        videoTrack = null
        videoSource = null
        textureHelper = null
    }

    /** WebRTC calls back on its own threads; ElderPeer runs on the main thread. */
    private fun onMain(block: () -> Unit) {
        main.post { if (!closed) block() }
    }

    private inner class Observer : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) = onMain {
            // IceCandidate.sdp is the candidate line; the helper expects it as `candidate`.
            events.onIceCandidate(RtcCandidate(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex))
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            if (newState == PeerConnection.PeerConnectionState.FAILED) onMain { events.onConnectionFailed() }
        }

        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
            if (newState == PeerConnection.IceConnectionState.FAILED) onMain { events.onConnectionFailed() }
        }

        override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = channel.dispose() // the elder opens `signs` itself
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = Unit
    }

    private companion object {
        const val CAPTURE_FPS = 15

        fun RtcSdp.toWebRtc() = SessionDescription(
            when (type) {
                RtcSdp.Type.OFFER -> SessionDescription.Type.OFFER
                RtcSdp.Type.ANSWER -> SessionDescription.Type.ANSWER
            },
            sdp,
        )

        fun ByteBuffer.utf8(): String {
            val bytes = ByteArray(remaining())
            get(bytes)
            return String(bytes, StandardCharsets.UTF_8)
        }
    }
}

private open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
