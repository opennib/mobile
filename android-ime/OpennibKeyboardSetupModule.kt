package com.opennib.mobile.keyboard

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * RN module exposed as `OpennibKeyboardSetup`. Answers the two questions the
 * Android onboarding needs — is the opennib IME enabled, and is it the current
 * default — and opens the two system surfaces that change those answers.
 * Both reads are plain system settings; no permission is required.
 */
class OpennibKeyboardSetupModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** True when the user has switched opennib on in the system keyboard list. */
  @ReactMethod
  fun isEnabled(promise: Promise) {
    val imm = reactApplicationContext.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    if (imm == null) {
      promise.resolve(false)
      return
    }
    val service = ComponentName(reactApplicationContext, OpennibInputMethodService::class.java)
    promise.resolve(imm.enabledInputMethodList.any { it.component == service })
  }

  /** True when opennib is the keyboard the system shows by default. */
  @ReactMethod
  fun isDefault(promise: Promise) {
    val current = Settings.Secure.getString(
      reactApplicationContext.contentResolver,
      Settings.Secure.DEFAULT_INPUT_METHOD,
    )
    val component = ComponentName.unflattenFromString(current ?: "")
    promise.resolve(component?.packageName == reactApplicationContext.packageName)
  }

  /** Open the system "on-screen keyboards" list where opennib can be enabled. */
  @ReactMethod
  fun openKeyboardSettings(promise: Promise) {
    val intent = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_SETTINGS", "Could not open keyboard settings", error)
    }
  }

  /** Show the system keyboard picker so the user can switch to opennib. */
  @ReactMethod
  fun showKeyboardPicker(promise: Promise) {
    val imm = reactApplicationContext.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    if (imm == null) {
      promise.reject("E_IMM", "Input method manager unavailable")
      return
    }
    imm.showInputMethodPicker()
    promise.resolve(null)
  }

  companion object {
    const val NAME: String = "OpennibKeyboardSetup"
  }
}
