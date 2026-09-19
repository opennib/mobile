package com.opennib.mobile.keyboard

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * RN bridge module exposed as `OpennibKeyboard` to JavaScript. The IME service
 * pushes events into JS via the static `emit(...)` helper:
 *   - `opennib:recordStart`  — UI-only signal that the IME started recording
 *                              (audio is captured natively, JS just updates
 *                              its own UI state).
 *   - `opennib:recordReady`  — payload `{ wavPath: string }`, fired when the
 *                              IME finishes capturing. JS calls `transcribe`
 *                              against the WAV path then sends the text back
 *                              via `resolveTranscript`.
 *
 * `isJsListening(...)` lets the IME probe whether JS is actually subscribed
 * before emitting `recordReady`. A live React context isn't sufficient: when
 * the user dismisses opennib from recents, MainActivity is destroyed and the
 * React tree unmounts (taking JS listeners with it), but the process can still
 * be alive via the keepalive foreground service. JS calls `setListenerReady`
 * when the keyboard listeners are subscribed so the IME falls through to the
 * cold-start "open opennib" hint instead of emitting into the void.
 */
class OpennibKeyboardBridge(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun resolveTranscript(text: String?) {
    Log.d(TAG, "resolveTranscript len=${text?.length ?: 0}")
    OpennibInputMethodService.deliver(text ?: "")
  }

  @ReactMethod
  fun setListenerReady(ready: Boolean) {
    Log.d(TAG, "setListenerReady=$ready")
    listenerReady = ready
  }

  companion object {
    const val NAME: String = "OpennibKeyboard"
    private const val TAG: String = "OpennibKeyboard"

    @Volatile
    private var listenerReady: Boolean = false

    fun hasReactContext(context: Context): Boolean = currentReactContext(context) != null

    /**
     * True only when both the React context exists AND JS has registered the
     * keyboard listeners. The IME uses this as the cold-start gate so a stale
     * context with no JS subscriber still routes through the "open opennib"
     * hint rather than emitting `recordReady` into the void.
     */
    fun isJsListening(context: Context): Boolean =
      hasReactContext(context) && listenerReady

    fun emit(context: Context, eventName: String, payload: WritableMap?): Boolean {
      val reactContext = currentReactContext(context)
      if (reactContext == null) {
        Log.w(TAG, "emit($eventName): no React context")
        return false
      }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, payload)
      return true
    }

    private fun currentReactContext(context: Context): ReactContext? {
      val app = context.applicationContext as? ReactApplication
      if (app == null) {
        Log.w(TAG, "applicationContext is not ReactApplication")
        return null
      }
      val bridgeless = try {
        app.reactHost?.currentReactContext
      } catch (e: Throwable) {
        Log.w(TAG, "reactHost lookup threw", e)
        null
      }
      if (bridgeless != null) return bridgeless
      return try {
        app.reactNativeHost.reactInstanceManager.currentReactContext
      } catch (e: Throwable) {
        Log.w(TAG, "legacy lookup threw", e)
        null
      }
    }
  }
}
