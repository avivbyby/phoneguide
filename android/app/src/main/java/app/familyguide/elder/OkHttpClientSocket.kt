package app.familyguide.elder

import android.os.Handler
import android.os.Looper
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
        ws = http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { listener.onMessage(text) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { listener.onClosed() }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post { listener.onFailure(t) }
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
