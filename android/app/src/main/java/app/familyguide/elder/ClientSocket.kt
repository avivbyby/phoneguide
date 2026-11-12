package app.familyguide.elder

/** Minimal text WebSocket, so SessionClient can be tested with a fake. */
interface ClientSocket {
    /** Opens the connection; messages may be sent right away (they are queued until open). */
    fun connect(listener: Listener)
    fun send(text: String)
    fun close()

    interface Listener {
        fun onMessage(text: String)
        fun onClosed()
        fun onFailure(error: Throwable) = onClosed()
    }
}
