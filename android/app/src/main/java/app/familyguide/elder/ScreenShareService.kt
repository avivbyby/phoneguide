package app.familyguide.elder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service required while MediaProjection captures the screen.
 * Shows the persistent notification «משתפים את המסך» for the whole call.
 * It does not capture anything itself; the capture lives in [WebRtcPeerFactory].
 */
class ScreenShareService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // Runs on the main thread: MediaProjection may be used from now on.
        val ready = onForeground
        onForeground = null
        ready?.invoke()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.sharing_notification),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(getString(R.string.sharing_notification))
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_CALL)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "screen_share"
        private const val NOTIFICATION_ID = 1

        /** Called once, on the main thread, after startForeground(). */
        private var onForeground: (() -> Unit)? = null

        fun control(context: Context): ScreenShareControl = object : ScreenShareControl {
            private val app = context.applicationContext

            override fun start(onForeground: () -> Unit) {
                Companion.onForeground = onForeground
                val intent = Intent(app, ScreenShareService::class.java)
                app.startForegroundService(intent)
            }

            override fun stop() {
                Companion.onForeground = null
                app.stopService(Intent(app, ScreenShareService::class.java))
            }
        }
    }
}
