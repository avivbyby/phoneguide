package app.familyguide.elder

import kotlinx.coroutines.CompletableDeferred

class SessionException(val code: String) : Exception("session failed: $code")

/**
 * Elder side of the signaling WebSocket (/ws): create a session, relay WebRTC
 * signals, hang up. No touch control, nothing recorded.
 */
class SessionClient(
    private val wsFactory: (url: String) -> ClientSocket,
    private val url: String = BuildConfig.SIGNALING_URL,
) {
    var onPeerJoined: () -> Unit = {}
    var onSignal: (payload: String) -> Unit = {}
    var onPeerLeft: () -> Unit = {}
    var onError: (code: String) -> Unit = {}

    /**
     * The connection dropped (network or server close) after the code was shown. Not fired for [hangup].
     * [lastError] is the server's last `error` code on this connection (e.g. "expired" when the
     * unused code timed out), or null for a plain drop; the caller should keep that specific text.
     */
    var onClosed: (lastError: String?) -> Unit = {}

    private var socket: ClientSocket? = null
    private var pendingCode: CompletableDeferred<String>? = null
    private var lastError: String? = null

    /** Sends {"type":"create"} and returns the 6-digit code; throws if no `created` arrives. */
    suspend fun createSession(): String {
        close()
        lastError = null
        val deferred = CompletableDeferred<String>()
        pendingCode = deferred
        val ws = wsFactory(url)
        socket = ws
        ws.connect(Listener(ws))
        ws.send(WsProtocol.encode(WsClientMessage.Create))
        return try {
            deferred.await()
        } catch (e: Throwable) {
            if (socket === ws) close()
            throw e
        }
    }

    /** [payload] is JSON text, e.g. {"type":"offer","sdp":"…"}; sent as the `payload` object. */
    fun sendSignal(payload: String) {
        val element = WsProtocol.parsePayload(payload)
        socket?.send(WsProtocol.encode(WsClientMessage.Signal(element)))
    }

    fun hangup() {
        socket?.send(WsProtocol.encode(WsClientMessage.Hangup))
        close()
    }

    private fun close() {
        val ws = socket
        socket = null
        pendingCode?.cancel()
        pendingCode = null
        ws?.close()
    }

    private inner class Listener(private val ws: ClientSocket) : ClientSocket.Listener {
        override fun onMessage(text: String) {
            if (socket !== ws) return
            when (val msg = WsProtocol.parseServer(text)) {
                is WsServerMessage.Created -> {
                    val pending = pendingCode ?: return
                    pendingCode = null
                    if (CODE_PATTERN.matches(msg.code)) {
                        pending.complete(msg.code)
                    } else {
                        pending.completeExceptionally(SessionException("bad_code"))
                    }
                }
                is WsServerMessage.Error -> {
                    lastError = msg.code
                    onError(msg.code)
                    pendingCode?.let {
                        pendingCode = null
                        it.completeExceptionally(SessionException(msg.code))
                    }
                }
                WsServerMessage.PeerJoined -> onPeerJoined()
                is WsServerMessage.Signal -> onSignal(msg.payload.toString())
                WsServerMessage.PeerLeft -> onPeerLeft()
                is WsServerMessage.Joined, null -> Unit
            }
        }

        override fun onClosed() {
            // Ignore stale sockets, repeats, and the close that follows our own hangup().
            if (socket !== ws) return
            socket = null
            val pending = pendingCode
            if (pending != null) {
                // Still waiting for `created`: createSession() reports the failure.
                pendingCode = null
                pending.completeExceptionally(SessionException("closed"))
            } else {
                // The code was already shown and can no longer work.
                onClosed.invoke(lastError)
            }
        }
    }

    private companion object {
        val CODE_PATTERN = Regex("^[0-9]{6}$")
    }
}
