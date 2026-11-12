package app.familyguide.elder

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
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
 * Elder screen: «אני צריך עזרה» → overlay permission check → create session → show code.
 * Screen share starts in Task 9; the «רואים את המסך» banner is Task 10.
 */
class MainActivity : ComponentActivity() {
    private val client = SessionClient(wsFactory = { url -> OkHttpClientSocket(url) })
    private var createJob: Job? = null

    private lateinit var helpButton: Button
    private lateinit var endButton: Button
    private lateinit var codeLabel: TextView
    private lateinit var codeView: TextView
    private lateinit var statusView: TextView

    private val overlaySettings =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (Settings.canDrawOverlays(this)) startSession() else showStatus(R.string.overlay_denied)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        helpButton = findViewById(R.id.help_button)
        endButton = findViewById(R.id.end_button)
        codeLabel = findViewById(R.id.code_label)
        codeView = findViewById(R.id.code)
        statusView = findViewById(R.id.status)

        client.onPeerJoined = { showStatus(R.string.helper_joined) }
        client.onPeerLeft = { showStatus(R.string.helper_left) }
        client.onError = { code -> showStatus(errorText(code)) }

        helpButton.setOnClickListener { onHelpClicked() }
        endButton.setOnClickListener { endCall(R.string.call_ended) }
        showIdle()
    }

    override fun onDestroy() {
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

    private fun endCall(message: Int) {
        createJob?.cancel()
        createJob = null
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
