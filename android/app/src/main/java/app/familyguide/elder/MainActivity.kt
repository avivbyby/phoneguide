package app.familyguide.elder

import android.app.Activity
import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Elder screen: «אני צריך עזרה» → overlay permission check → create session → show code
 * → helper joins → screen-share consent → WebRTC (video only, `signs` channel).
 * The «רואים את המסך» banner and the sign overlay are Task 10.
 */
class MainActivity : ComponentActivity() {
    private val client = SessionClient(wsFactory = { url -> OkHttpClientSocket(url) })
    private var createJob: Job? = null
    private var peer: ElderPeer? = null

    private lateinit var helpButton: Button
    private lateinit var endButton: Button
    private lateinit var codeLabel: TextView
    private lateinit var codeView: TextView
    private lateinit var statusView: TextView

    private val overlaySettings =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (Settings.canDrawOverlays(this)) startSession() else showStatus(R.string.overlay_denied)
        }

    private val screenCapture =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val current = peer ?: return@registerForActivityResult
            val data = result.data
            if (result.resultCode == Activity.RESULT_OK && data != null) {
                current.startCall(WebRtcPeerFactory(applicationContext, data))
            } else {
                current.screenShareDenied()
            }
        }

    /** Answer to POST_NOTIFICATIONS; a refusal still continues to the screen-share dialog. */
    private var onNotificationAnswer: ((Boolean) -> Unit)? = null

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val answer = onNotificationAnswer
            onNotificationAnswer = null
            answer?.invoke(granted)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        helpButton = findViewById(R.id.help_button)
        endButton = findViewById(R.id.end_button)
        codeLabel = findViewById(R.id.code_label)
        codeView = findViewById(R.id.code)
        statusView = findViewById(R.id.status)

        client.onPeerJoined = { onHelperJoined() }
        client.onSignal = { payload -> peer?.handleSignal(payload) }
        client.onPeerLeft = {
            // While sharing, stop at once; before that, keep the code as in Task 8.
            if (peer != null) endCall(R.string.helper_left) else showStatus(R.string.helper_left)
        }
        client.onError = { code -> showStatus(errorText(code)) }
        client.onClosed = {
            // Connection lost after the code was shown: the code is dead, go back to start.
            closePeer()
            showIdle()
            showStatus(R.string.error_connect)
        }

        helpButton.setOnClickListener { onHelpClicked() }
        endButton.setOnClickListener { endCall(R.string.call_ended) }
        showIdle()
    }

    override fun onDestroy() {
        closePeer()
        client.hangup()
        super.onDestroy()
    }

    private fun onHelpClicked() {
        if (Settings.canDrawOverlays(this)) {
            startSession()
            return
        }
        // Ask once per attempt, with an explanation; never start the call without it.
        AlertDialog.Builder(this)
            .setTitle(R.string.overlay_title)
            .setMessage(R.string.overlay_explanation)
            .setPositiveButton(R.string.overlay_open_settings) { _, _ ->
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                )
                overlaySettings.launch(intent)
            }
            .setNegativeButton(R.string.overlay_cancel) { _, _ -> showStatus(R.string.overlay_denied) }
            .setOnCancelListener { showStatus(R.string.overlay_denied) }
            .show()
    }

    private fun startSession() {
        if (!Settings.canDrawOverlays(this)) {
            showStatus(R.string.overlay_denied)
            return
        }
        createJob?.cancel()
        helpButton.visibility = View.GONE
        endButton.visibility = View.VISIBLE
        showStatus(R.string.creating)
        createJob = lifecycleScope.launch {
            try {
                val code = client.createSession()
                codeLabel.visibility = View.VISIBLE
                codeView.visibility = View.VISIBLE
                codeView.text = code
                codeView.contentDescription = code.toCharArray().joinToString(" ")
                showStatus(R.string.waiting_for_helper)
            } catch (e: CancellationException) {
                throw e
            } catch (e: SessionException) {
                showIdle()
                showStatus(errorText(e.code))
            } catch (e: Exception) {
                showIdle()
                showStatus(R.string.error_connect)
            }
        }
    }

    /** The helper entered the code: ask the elder (system dialog) to share the screen. */
    private fun onHelperJoined() {
        if (peer != null) return
        showStatus(R.string.helper_joined)
        val newPeer = ElderPeer(client, ScreenShareService.control(this))
        newPeer.onSignsMessage = { _ -> /* Task 10 draws the signs. */ }
        newPeer.onEnded = { message ->
            peer = null
            showIdle()
            if (message != null) statusView.text = message else showStatus(R.string.call_ended)
        }
        peer = newPeer
        // Android 13+: ask for notifications first so «משתפים את המסך» is visible.
        // Refusing notifications does not stop the share (unlike refusing the capture).
        NotificationPermissionGate.beforeScreenShare(
            sdkInt = Build.VERSION.SDK_INT,
            isGranted = Build.VERSION.SDK_INT < NotificationPermissionGate.TIRAMISU ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED,
            request = { onResult ->
                onNotificationAnswer = onResult
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            },
            proceed = { askScreenCapture() },
        )
    }

    private fun askScreenCapture() {
        if (peer == null) return // the call ended while the permission dialog was open
        val projection = getSystemService(MediaProjectionManager::class.java)
        screenCapture.launch(projection.createScreenCaptureIntent())
    }

    /** Stops the screen share and the peer (ElderPeer also hangs up the session). */
    private fun closePeer() {
        val current = peer ?: return
        peer = null
        current.hangup()
    }

    private fun endCall(message: Int) {
        createJob?.cancel()
        createJob = null
        closePeer()
        client.hangup()
        showIdle()
        showStatus(message)
    }

    private fun showIdle() {
        helpButton.visibility = View.VISIBLE
        endButton.visibility = View.GONE
        codeLabel.visibility = View.GONE
        codeView.visibility = View.GONE
        codeView.text = ""
    }

    private fun errorText(code: String): Int = when (code) {
        "closed" -> R.string.error_connect
        "rate_limited" -> R.string.error_rate_limited
        "expired", "not_found" -> R.string.error_expired
        else -> R.string.error_generic
    }

    private fun showStatus(resId: Int) {
        statusView.setText(resId)
    }
}
