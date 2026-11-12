package app.familyguide.elder

import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** Real WebSocket; all listener callbacks are delivered on the main thread. */
class OkHttpClientSocket(
    private val url: String,
    private val http: OkHttpClient = OkHttpClient(),
) : ClientSocket {
    private val main = Handler(Looper.getMainLooper())
    private var ws: WebSocket? = null

    override fun connect(listener: ClientSocket.Listener) {
        val request = Request.Builder().url(url).build()
        // Report the end of the connection to [listener] exactly once.
        val ended = AtomicBoolean(false)
        ws = http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { listener.onMessage(text) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                // Server started the close (e.g. code TTL expired): finish the handshake,
                // otherwise OkHttp never calls onClosed. Tell the app now.
                webSocket.close(1000, null)
                if (ended.compareAndSet(false, true)) main.post { listener.onClosed() }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (ended.compareAndSet(false, true)) main.post { listener.onClosed() }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (ended.compareAndSet(false, true)) main.post { listener.onFailure(t) }
            }
        })
    }

    override fun send(text: String) {
        ws?.send(text)
    }

    override fun close() {
        ws?.close(1000, null)
        ws = null
    }
}
