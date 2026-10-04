import { NativeModules, Platform } from "react-native"

/**
 * Android-only bridge to the system keyboard settings, implemented in
 * `android-ime/OpennibKeyboardSetupModule.kt`. Returns null on iOS, where
 * keyboard activation is tracked through the App Group instead (see
 * `shared-group.ts`), and in builds without the IME plugin.
 */
export interface KeyboardSetupModule {
  /** opennib is switched on in the system's on-screen keyboard list. */
  isEnabled(): Promise<boolean>
  /** opennib is the keyboard the system currently shows by default. */
  isDefault(): Promise<boolean>
  /** Open the system keyboard list so the user can enable opennib. */
  openKeyboardSettings(): Promise<void>
  /** Show the system keyboard picker so the user can switch to opennib. */
  showKeyboardPicker(): Promise<void>
}

const native: KeyboardSetupModule | null = (() => {
  if (Platform.OS !== "android") return null
  const raw = NativeModules["OpennibKeyboardSetup"] as KeyboardSetupModule | undefined
  return raw ?? null
})()

export function getKeyboardSetup(): KeyboardSetupModule | null {
  return native
}
