package com.opennib.mobile.keyboard

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.opennib.mobile.MainActivity
import java.lang.ref.WeakReference

/**
 * Full opennib keyboard. Audio capture happens entirely inside the IME via
 * `OpennibAudioCapture` (Android grants IMEs mic access without foregrounding
 * the host activity). The UI is built by [OpennibKeyboardController]; this
 * service just owns the IME lifecycle, the recording state machine, and the
 * `InputConnection` calls that commit text from typing keys + dictated transcripts.
 *
 * Mic flow per press:
 *   onMicDown → start AudioRecord, emit `opennib:recordStart` (UI only).
 *   onMicUp   → stop AudioRecord, write WAV to cache, emit `opennib:recordReady`
 *               with `{ wavPath }`.
 * JS receives `recordReady`, calls `transcribe(wavPath)`, then pushes the
 * resulting text back via `OpennibKeyboard.resolveTranscript(...)`, which
 * lands in `deliverTranscript` here and gets inserted via `commitText`.
 *
 * Cold-start fallback: if the React context isn't alive (host app never
 * opened, or Android killed it before the keepalive service started), we
 * skip the whole capture cycle on press DOWN and instead show a
 * "tap to launch" hint on press UP that opens MainActivity.
 */
class OpennibInputMethodService : InputMethodService(), KeyEventListener {
  private var controller: OpennibKeyboardController? = null
  private var capture: OpennibAudioCapture? = null
  private var holding = false
  private var coldStart = false
  private var transcribeTimeout: Runnable? = null

  override fun onCreate() {
    super.onCreate()
    capture = OpennibAudioCapture(cacheDir)
  }

  override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
    super.onStartInput(attribute, restarting)
    OpennibKeepAliveService.start(applicationContext)
  }

  override fun onFinishInput() {
    super.onFinishInput()
    OpennibKeepAliveService.stop(applicationContext)
  }

  override fun onCreateInputView(): View {
    val c = OpennibKeyboardController(this, this)
    c.levelProvider = { capture?.level ?: 0f }
    controller = c
    val view = c.createView()
    c.setStatus(LABEL_IDLE)
    instance = WeakReference(this)
    return view
  }

  override fun onDestroy() {
    instance?.clear()
    instance = null
    cancelTranscribeTimeout()
    try { capture?.stopAndWriteWav() } catch (_: Throwable) {}
    capture = null
    controller = null
    super.onDestroy()
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    super.onFinishInputView(finishingInput)
    if (holding) {
      holding = false
      try { capture?.stopAndWriteWav() } catch (_: Throwable) {}
    }
    cancelTranscribeTimeout()
    coldStart = false
    controller?.setStatus(LABEL_IDLE)
    controller?.setRecordingTint(false)
    controller?.showKeys()
  }

  // -------- KeyEventListener --------

  override fun onCharKey(text: CharSequence) {
    val ic = currentInputConnection ?: return
    ic.commitText(text, 1)
  }

  override fun onBackspace() {
    val ic = currentInputConnection ?: return
    val selected = ic.getSelectedText(0)
    if (selected != null && selected.isNotEmpty()) {
      ic.commitText("", 1)
    } else {
      ic.deleteSurroundingText(1, 0)
    }
  }

  override fun onEnter() {
    val ic = currentInputConnection ?: return
    val opts = currentInputEditorInfo?.imeOptions ?: 0
    val action = opts and EditorInfo.IME_MASK_ACTION
    val noEnterAction = (opts and EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0
    if (!noEnterAction && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
      ic.performEditorAction(action)
      return
    }
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
  }

  override fun onSwitchKeyboard() {
    val imm = applicationContext.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      ?: return
    imm.showInputMethodPicker()
  }

  override fun onMicDown() {
    if (!hasMicPermission()) {
      Log.w(TAG, "onMicDown: mic permission missing")
      coldStart = true
      controller?.setStatus("Open opennib to grant mic")
      return
    }
    if (!OpennibKeyboardBridge.isJsListening(applicationContext)) {
      Log.d(TAG, "onMicDown: JS not listening, cold-start fallback")
      coldStart = true
      controller?.setStatus("Open opennib first — release to launch")
      return
    }
    try {
      capture?.start()
      holding = true
      coldStart = false
      controller?.setStatus("Recording…")
      controller?.setRecordingTint(true)
      controller?.showRecording()
      OpennibKeyboardBridge.emit(applicationContext, "opennib:recordStart", null)
    } catch (e: Throwable) {
      Log.w(TAG, "capture.start failed", e)
      holding = false
      controller?.setStatus("Mic error")
    }
  }

  override fun onMicUp() {
    Log.d(TAG, "onMicUp coldStart=$coldStart holding=$holding")
    controller?.setRecordingTint(false)
    if (coldStart) {
      coldStart = false
      launchHost()
      controller?.setStatus(LABEL_IDLE)
      return
    }
    if (!holding) return
    holding = false
    controller?.setStatus("Transcribing…")
    controller?.showTranscribing()
    val wavPath = try {
      capture?.stopAndWriteWav()
    } catch (e: Throwable) {
      Log.w(TAG, "capture.stop failed", e)
      null
    }
    if (wavPath == null) {
      Log.d(TAG, "onMicUp: no audio captured")
      controller?.setStatus(LABEL_IDLE)
      controller?.showKeys()
      return
    }
    val payload = Arguments.createMap().apply { putString("wavPath", wavPath) }
    val ok = OpennibKeyboardBridge.emit(applicationContext, "opennib:recordReady", payload)
    Log.d(TAG, "onMicUp emit recordReady ok=$ok path=$wavPath")
    if (ok) {
      armTranscribeTimeout(wavPath)
    } else {
      controller?.setStatus(LABEL_IDLE)
      controller?.showKeys()
    }
  }

  /**
   * Safety net for the case where JS thinks it's listening (or `emit` returns
   * true) but the transcript never comes back — e.g. JS crashed mid-transcribe,
   * or a regression in the listener-readiness signal. Without this the keyboard
   * sits at "Transcribing…" forever. After the timeout we reset the label and
   * delete the orphaned wav so cache doesn't grow unboundedly.
   */
  private fun armTranscribeTimeout(wavPath: String) {
    cancelTranscribeTimeout()
    val r = Runnable {
      Log.w(TAG, "transcribe timeout — JS never replied, resetting")
      transcribeTimeout = null
      controller?.setStatus(LABEL_IDLE)
      controller?.showKeys()
      try { java.io.File(wavPath).delete() } catch (_: Throwable) {}
    }
    transcribeTimeout = r
    mainHandler.postDelayed(r, TRANSCRIBE_TIMEOUT_MS)
  }

  private fun cancelTranscribeTimeout() {
    transcribeTimeout?.let { mainHandler.removeCallbacks(it) }
    transcribeTimeout = null
  }

  // -------- Helpers --------

  private fun hasMicPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      applicationContext,
      android.Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED

  private fun launchHost() {
    val intent = Intent(applicationContext, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      data = Uri.parse("opennib://record")
    }
    startActivity(intent)
  }

  private fun deliverTranscript(text: String) {
    mainHandler.post {
      cancelTranscribeTimeout()
      val ic = currentInputConnection
      Log.d(TAG, "deliverTranscript len=${text.length} ic=${ic != null}")
      if (text.isNotEmpty() && ic != null) {
        // Some chat apps (custom compose views) drop a bare commitText that
        // arrives seconds after the last key event. Wrap it in a batch edit
        // and clear any composing region first, the way stock keyboards do,
        // and report whether the editor accepted it.
        ic.beginBatchEdit()
        ic.finishComposingText()
        val ok = ic.commitText(text, 1)
        ic.endBatchEdit()
        Log.d(TAG, "commitText accepted=$ok")
        controller?.setStatus(if (ok) "Inserted ✓" else "Couldn't insert here")
      } else {
        controller?.setStatus(if (text.isEmpty()) "No speech detected" else LABEL_IDLE)
      }
      controller?.showKeys()
    }
  }

  companion object {
    private const val TAG: String = "OpennibIME"
    private const val LABEL_IDLE = "opennib"
    private const val TRANSCRIBE_TIMEOUT_MS: Long = 20_000L
    private val mainHandler = Handler(Looper.getMainLooper())
    private var instance: WeakReference<OpennibInputMethodService>? = null

    fun deliver(text: String) {
      val svc = instance?.get()
      Log.d(TAG, "deliver svc=${svc != null} len=${text.length}")
      svc?.deliverTranscript(text)
    }
  }
}
