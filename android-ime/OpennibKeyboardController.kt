package com.opennib.mobile.keyboard

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Callbacks the [OpennibInputMethodService] implements so that [OpennibKeyboardController]
 * can stay free of `currentInputConnection` and IME-lifecycle concerns. The controller
 * owns layout + touch + state; the service owns text commit + recording.
 */
interface KeyEventListener {
  fun onCharKey(text: CharSequence)
  fun onBackspace()
  fun onEnter()
  fun onMicDown()
  fun onMicUp()
  fun onSwitchKeyboard()
}

/**
 * Builds a Wispr-Flow-shaped keyboard programmatically from row data so we don't
 * have to maintain N parallel layout XML files for letters / symbols / case
 * variants. Manages shift, caps lock, page-toggle, backspace key-repeat, and the
 * push-to-talk mic key. iOS is unaffected — this is the Android-only IME UI.
 */
class OpennibKeyboardController(
  private val context: Context,
  private val listener: KeyEventListener,
) {
  private enum class ShiftState { OFF, ON, CAPS_LOCK }
  private enum class Page { LETTERS, SYMBOLS }

  private var statusLabel: TextView? = null
  private var rowsContainer: LinearLayout? = null
  private var micKey: TextView? = null
  private var shiftKey: TextView? = null
  private var pageKey: TextView? = null

  private var page: Page = Page.LETTERS
  private var shift: ShiftState = ShiftState.OFF
  private var lastShiftTapAt: Long = 0L
  private val mainHandler = Handler(Looper.getMainLooper())
  private var backspaceRunnable: Runnable? = null

  fun createView(): View {
    val view = LayoutInflater.from(context).inflate(
      context.resources.getIdentifier("keyboard_view", "layout", context.packageName),
      null,
    ) as ViewGroup
    statusLabel = view.findViewById(rid("opennib_status", "id"))
    rowsContainer = view.findViewById(rid("opennib_kbd_rows", "id"))
    rebuild()
    return view
  }

  fun setStatus(text: CharSequence) {
    statusLabel?.text = text
  }

  fun setMicLabel(text: CharSequence) {
    micKey?.text = text
  }

  fun setRecordingTint(recording: Boolean) {
    micKey?.isPressed = recording
  }

  private fun rebuild() {
    val container = rowsContainer ?: return
    container.removeAllViews()
    val rows = if (page == Page.LETTERS) lettersRows() else symbolsRows()
    for (rowSpec in rows) {
      container.addView(buildRow(rowSpec))
    }
    container.addView(buildRow(bottomRow()))
  }

  private fun buildRow(rowSpec: List<KeySpec>): LinearLayout {
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(44),
      ).apply {
        topMargin = dp(6)
      }
    }
    val gap = dp(4)
    for ((idx, spec) in rowSpec.withIndex()) {
      val key = buildKey(spec)
      val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, spec.weight).apply {
        if (idx > 0) leftMargin = gap
      }
      row.addView(key, lp)
    }
    return row
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun buildKey(spec: KeySpec): TextView {
    val tv = TextView(context).apply {
      text = displayLabel(spec)
      setTextColor(0xFF17181C.toInt())
      val sp = if (spec.kind == KeyKind.CHAR && spec.label.length == 1) 18f else 13f
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
      gravity = Gravity.CENTER
      isClickable = true
      isFocusable = true
      val drawable = when {
        spec.kind == KeyKind.MIC -> "key_bg_mic"
        spec.isSpecial -> "key_bg_special"
        else -> "key_bg"
      }
      setBackgroundResource(rid(drawable, "drawable"))
      if (spec.kind == KeyKind.MIC) setTextColor(0xFFFFFFFF.toInt())
    }
    when (spec.kind) {
      KeyKind.CHAR -> {
        tv.setOnClickListener {
          listener.onCharKey(applyShiftToLabel(spec.label))
          consumeShift()
        }
      }
      KeyKind.SHIFT -> {
        shiftKey = tv
        updateShiftLabel()
        tv.setOnClickListener { toggleShift() }
      }
      KeyKind.BACKSPACE -> attachBackspaceTouch(tv)
      KeyKind.PAGE_TOGGLE -> {
        pageKey = tv
        tv.setOnClickListener { togglePage() }
      }
      KeyKind.SPACE -> tv.setOnClickListener { listener.onCharKey(" ") }
      KeyKind.ENTER -> tv.setOnClickListener { listener.onEnter() }
      KeyKind.GLOBE -> tv.setOnClickListener { listener.onSwitchKeyboard() }
      KeyKind.MIC -> {
        micKey = tv
        tv.setOnTouchListener { v, event ->
          when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
              v.isPressed = true
              listener.onMicDown()
              true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
              v.isPressed = false
              listener.onMicUp()
              true
            }
            else -> false
          }
        }
      }
    }
    return tv
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun attachBackspaceTouch(v: TextView) {
    v.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          view.isPressed = true
          listener.onBackspace()
          val r = object : Runnable {
            override fun run() {
              listener.onBackspace()
              mainHandler.postDelayed(this, 50)
            }
          }
          backspaceRunnable = r
          mainHandler.postDelayed(r, 400)
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          view.isPressed = false
          backspaceRunnable?.let { mainHandler.removeCallbacks(it) }
          backspaceRunnable = null
          true
        }
        else -> false
      }
    }
  }

  private fun toggleShift() {
    val now = System.currentTimeMillis()
    shift = when (shift) {
      ShiftState.OFF -> if (now - lastShiftTapAt < 300) ShiftState.CAPS_LOCK else ShiftState.ON
      ShiftState.ON -> ShiftState.OFF
      ShiftState.CAPS_LOCK -> ShiftState.OFF
    }
    lastShiftTapAt = now
    rebuild()
  }

  private fun consumeShift() {
    if (shift == ShiftState.ON) {
      shift = ShiftState.OFF
      rebuild()
    }
  }

  private fun applyShiftToLabel(label: String): String =
    if (shift != ShiftState.OFF) label.uppercase() else label.lowercase()

  private fun displayLabel(spec: KeySpec): String =
    if (spec.kind == KeyKind.CHAR && spec.label.length == 1 && spec.label[0].isLetter()) {
      applyShiftToLabel(spec.label)
    } else {
      spec.label
    }

  private fun togglePage() {
    page = if (page == Page.LETTERS) Page.SYMBOLS else Page.LETTERS
    rebuild()
  }

  private fun updateShiftLabel() {
    shiftKey?.text = when (shift) {
      ShiftState.OFF -> "⇧"
      ShiftState.ON -> "⇧"
      ShiftState.CAPS_LOCK -> "⇪"
    }
  }

  private fun lettersRows(): List<List<KeySpec>> = listOf(
    "qwertyuiop".map { KeySpec(it.toString(), KeyKind.CHAR, 1f) },
    "asdfghjkl".map { KeySpec(it.toString(), KeyKind.CHAR, 1f) },
    buildList {
      add(KeySpec("⇧", KeyKind.SHIFT, 1.5f, isSpecial = true))
      for (c in "zxcvbnm") add(KeySpec(c.toString(), KeyKind.CHAR, 1f))
      add(KeySpec("⌫", KeyKind.BACKSPACE, 1.5f, isSpecial = true))
    },
  )

  private fun symbolsRows(): List<List<KeySpec>> = listOf(
    "1234567890".map { KeySpec(it.toString(), KeyKind.CHAR, 1f) },
    listOf("@", "#", "$", "%", "&", "*", "-", "+", "(", ")")
      .map { KeySpec(it, KeyKind.CHAR, 1f) },
    buildList {
      add(KeySpec("ABC", KeyKind.PAGE_TOGGLE, 1.5f, isSpecial = true))
      for (c in listOf(".", ",", "?", "!", "'", "\"", "/")) add(KeySpec(c, KeyKind.CHAR, 1f))
      add(KeySpec("⌫", KeyKind.BACKSPACE, 1.5f, isSpecial = true))
    },
  )

  private fun bottomRow(): List<KeySpec> {
    val pageToggleLabel = if (page == Page.LETTERS) "?123" else "ABC"
    return listOf(
      KeySpec(pageToggleLabel, KeyKind.PAGE_TOGGLE, 1.5f, isSpecial = true),
      KeySpec("🌐", KeyKind.GLOBE, 1f, isSpecial = true),
      KeySpec("🎤", KeyKind.MIC, 1.5f, isSpecial = true),
      KeySpec("space", KeyKind.SPACE, 4f),
      KeySpec(".", KeyKind.CHAR, 1f),
      KeySpec("⏎", KeyKind.ENTER, 1.5f, isSpecial = true),
    )
  }

  private fun rid(name: String, kind: String): Int =
    context.resources.getIdentifier(name, kind, context.packageName)

  private fun dp(v: Int): Int =
    (v * context.resources.displayMetrics.density).toInt()
}

private enum class KeyKind { CHAR, SHIFT, BACKSPACE, PAGE_TOGGLE, ENTER, SPACE, MIC, GLOBE }

private data class KeySpec(
  val label: String,
  val kind: KeyKind,
  val weight: Float,
  val isSpecial: Boolean = false,
)
