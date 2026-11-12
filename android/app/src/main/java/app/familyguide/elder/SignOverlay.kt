package app.familyguide.elder

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Same ten strings as SIGN_LABELS in shared/src/signs.ts. */
val SIGN_LABELS: Map<String, String> = mapOf(
    "tap" to "לחץ כאן",
    "long_press" to "לחיצה ארוכה",
    "scroll_up" to "גלול למעלה",
    "scroll_down" to "גלול למטה",
    "swipe_right" to "החלק ימינה",
    "swipe_left" to "החלק שמאלה",
    "zoom_in" to "זום פנימה",
    "zoom_out" to "זום החוצה",
    "back" to "חזור",
    "note" to "הערה",
)

/** Same as NOTE_MAX_LENGTH in shared/src/signs.ts. */
const val NOTE_MAX_LENGTH = 40

/** A message on the `signs` DataChannel. There is no message that touches the screen. */
sealed interface ChannelMsg {
    /** [x], [y] are clamped to 0..1; [text] is set only for `note`. */
    data class Sign(val kind: String, val label: String, val x: Float, val y: Float, val text: String?) : ChannelMsg
    data object Clear : ChannelMsg
    data object Hangup : ChannelMsg
}

private val channelJson = Json { isLenient = false }

/**
 * Parses one `signs` channel message (same rules as parseSignsChannelMessage in
 * shared/src/signs.ts). Anything else — including control messages such as
 * `remote_tap` — returns null and is ignored; nothing here can perform a touch.
 */
fun parseChannelMessage(json: String): ChannelMsg? {
    val obj = try {
        channelJson.parseToJsonElement(json) as? JsonObject
    } catch (_: IllegalArgumentException) {
        null
    } ?: return null

    return when (obj.stringField("type")) {
        "clear_sign" -> if (obj.size == 1) ChannelMsg.Clear else null
        "hangup" -> if (obj.size == 1) ChannelMsg.Hangup else null
        "sign" -> parseSign(obj)
        else -> null
    }
}

private fun parseSign(obj: JsonObject): ChannelMsg.Sign? {
    val kind = obj.stringField("kind") ?: return null
    val label = SIGN_LABELS[kind] ?: return null
    val x = obj.numberField("x") ?: return null
    val y = obj.numberField("y") ?: return null
    val text = if (kind == "note") {
        val raw = obj.stringField("text") ?: return null
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed.length > NOTE_MAX_LENGTH) return null
        trimmed
    } else {
        null
    }
    return ChannelMsg.Sign(kind, label, SignMapper.clamp(x.toFloat()), SignMapper.clamp(y.toFloat()), text)
}

private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.numberField(key: String): Double? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

/**
 * The elder's overlay, two `TYPE_APPLICATION_OVERLAY` windows:
 *  - a permanent banner «רואים את המסך» with a large «סיום» button. It cannot be hidden:
 *    pressing «סיום», an accessibility "dismiss", or the system removing the window all
 *    call [onHangup] (end the call), never just hide the banner;
 *  - a full-screen, not-touchable layer that draws one sign at a time. It never swallows
 *    the elder's taps and never performs a touch.
 * Main thread only.
 */
class SignOverlay(context: Context, private val onHangup: () -> Unit) {
    private val ctx: Context = ContextThemeWrapper(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.applicationContext.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
        } else {
            context.applicationContext
        },
        android.R.style.Theme_Material_Light_NoActionBar,
    )
    private val wm = ctx.getSystemService(WindowManager::class.java)

    private var banner: View? = null
    private var layer: FrameLayout? = null
    private var sign: View? = null
    private var animator: ValueAnimator? = null
    /** True while we remove our own windows, so the detach is not taken as "closed by someone". */
    private var dismissing = false
    private var hangupSent = false

    val isShowing: Boolean get() = banner != null

    /** Adds both windows. Returns false (and adds nothing) if the overlay cannot be shown. */
    fun show(): Boolean {
        if (isShowing) return true
        dismissing = false
        hangupSent = false
        val newLayer = FrameLayout(ctx)
        val newBanner = buildBanner()
        try {
            wm.addView(newLayer, layerParams())
            layer = newLayer
            wm.addView(newBanner, bannerParams())
            banner = newBanner
        } catch (e: RuntimeException) {
            dismiss()
            return false
        }
        newBanner.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {}
            override fun onViewDetachedFromWindow(v: View) {
                if (!dismissing) requestHangup()
            }
        })
        return true
    }

    /** A new sign replaces the previous one. */
    fun showSign(msg: ChannelMsg.Sign) {
        val container = layer ?: return
        clearSign()
        val view = buildSign(msg)
        container.addView(view, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))
        sign = view
        view.visibility = View.INVISIBLE
        view.post {
            if (sign !== view) return@post
            place(view, container, msg)
            view.visibility = View.VISIBLE
            animator = animate(view.findViewWithTag(MARKER_TAG), msg.kind)
        }
    }

    /** Removes the sign; the banner stays. */
    fun clearSign() {
        animator?.cancel()
        animator = null
        sign?.let { layer?.removeView(it) }
        sign = null
    }

    /** Removes everything and closes the overlay. Does not call [onHangup]. */
    fun dismiss() {
        dismissing = true
        clearSign()
        banner?.let { removeWindow(it) }
        banner = null
        layer?.let { removeWindow(it) }
        layer = null
    }

    private fun requestHangup() {
        if (hangupSent) return
        hangupSent = true
        onHangup()
    }

    private fun removeWindow(view: View) {
        try {
            wm.removeViewImmediate(view)
        } catch (_: IllegalArgumentException) {
            // Already removed by the system.
        }
    }

    private fun buildBanner(): View {
        val bar = object : LinearLayout(ctx) {
            override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
                super.onInitializeAccessibilityNodeInfo(info)
                info.isDismissable = true
                info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_DISMISS)
            }

            override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
                if (action == AccessibilityNodeInfo.ACTION_DISMISS) {
                    // Closing the banner = ending the call, not hiding it.
                    requestHangup()
                    return true
                }
                return super.performAccessibilityAction(action, arguments)
            }
        }
        bar.orientation = LinearLayout.HORIZONTAL
        bar.layoutDirection = View.LAYOUT_DIRECTION_RTL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setBackgroundColor(Color.parseColor("#B00020"))
        bar.setPadding(dp(16), dp(10), dp(16), dp(10))

        val label = TextView(ctx).apply {
            text = ctx.getString(R.string.sharing_banner)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        bar.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val end = Button(ctx).apply {
            text = ctx.getString(R.string.overlay_end)
            setTextColor(Color.parseColor("#B00020"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(12).toFloat()
            }
            minimumWidth = dp(120)
            minHeight = dp(64)
            setOnClickListener { requestHangup() }
        }
        bar.addView(end, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(64)))
        return bar
    }

    private fun buildSign(msg: ChannelMsg.Sign): View {
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            // Purely visual: never clickable or focusable.
            isClickable = false
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val marker = TextView(ctx).apply {
            tag = MARKER_TAG
            text = MARKER_SYMBOLS[msg.kind] ?: ""
            gravity = Gravity.CENTER
            setTextColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#CCFFD600"))
                setStroke(dp(4), Color.parseColor("#0B57D0"))
            }
        }
        box.addView(marker, LinearLayout.LayoutParams(dp(MARKER_DP), dp(MARKER_DP)))
        val label = TextView(ctx).apply {
            text = if (msg.kind == "note") msg.text else msg.label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            maxWidth = dp(280)
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0B57D0"))
                cornerRadius = dp(14).toFloat()
            }
        }
        box.addView(label, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(8) })
        return box
    }

    /** Puts the marker's centre on the sign point (screen coordinates), kept on screen. */
    private fun place(view: View, container: View, msg: ChannelMsg.Sign) {
        val screen = screenSize()
        val (px, py) = SignMapper.toPixels(msg.x, msg.y, screen.width(), screen.height())
        val origin = IntArray(2)
        container.getLocationOnScreen(origin)
        val localX = px - origin[0]
        val localY = py - origin[1]
        val half = dp(MARKER_DP) / 2
        val maxX = (container.width - view.width).coerceAtLeast(0)
        val maxY = (container.height - view.height).coerceAtLeast(0)
        view.x = (localX - view.width / 2).coerceIn(0, maxX).toFloat()
        view.y = (localY - half).coerceIn(0, maxY).toFloat()
    }

    @Suppress("DEPRECATION")
    private fun screenSize(): Rect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            wm.currentWindowMetrics.bounds
        } else {
            val metrics = DisplayMetrics()
            wm.defaultDisplay.getRealMetrics(metrics)
            Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
        }

    private fun animate(marker: View?, kind: String): ValueAnimator? {
        marker ?: return null
        val move = dp(56).toFloat()
        val (holders, duration) = when (kind) {
            "tap" -> scale(1f, 1.3f) to 450L
            "long_press" -> scale(1f, 1.6f) to 1400L
            "scroll_up" -> listOf(PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, move / 2, -move)) to 900L
            "scroll_down" -> listOf(PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, -move / 2, move)) to 900L
            "swipe_right" -> listOf(PropertyValuesHolder.ofFloat(View.TRANSLATION_X, -move / 2, move)) to 900L
            "swipe_left" -> listOf(PropertyValuesHolder.ofFloat(View.TRANSLATION_X, move / 2, -move)) to 900L
            "zoom_in" -> scale(0.7f, 1.5f) to 900L
            "zoom_out" -> scale(1.5f, 0.7f) to 900L
            "back" -> listOf(PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.35f)) to 600L
            else -> listOf(PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.7f)) to 1000L // note
        }
        val restart = kind.startsWith("scroll_") || kind.startsWith("swipe_") || kind.startsWith("zoom_")
        return ObjectAnimator.ofPropertyValuesHolder(marker, *holders.toTypedArray()).apply {
            this.duration = duration
            repeatCount = ValueAnimator.INFINITE
            repeatMode = if (restart) ValueAnimator.RESTART else ValueAnimator.REVERSE
            start()
        }
    }

    private fun scale(from: Float, to: Float): List<PropertyValuesHolder> = listOf(
        PropertyValuesHolder.ofFloat(View.SCALE_X, from, to),
        PropertyValuesHolder.ofFloat(View.SCALE_Y, from, to),
    )

    private fun layerParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        // Android 12+ blocks touches that pass through an untrusted overlay above 0.8 opacity.
        alpha = MAX_PASS_THROUGH_ALPHA
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            fitInsetsTypes = 0
        }
    }

    private fun bannerParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        // Clickable «סיום», but no focus/keys taken and touches outside the bar pass through.
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), ctx.resources.displayMetrics).toInt()

    private companion object {
        const val MARKER_TAG = "sign_marker"
        const val MARKER_DP = 76
        const val MAX_PASS_THROUGH_ALPHA = 0.8f
        val MARKER_SYMBOLS = mapOf(
            "tap" to "",
            "long_press" to "",
            "scroll_up" to "↑",
            "scroll_down" to "↓",
            "swipe_right" to "→",
            "swipe_left" to "←",
            "zoom_in" to "+",
            "zoom_out" to "−",
            "back" to "↩",
            "note" to "✎",
        )
    }
}
