import { useCallback, useEffect, useState } from "react"
import { Linking, Platform } from "react-native"

import { getKeyboardSetup } from "../native/keyboard-setup"
import { getSharedGroup } from "../native/shared-group"

/** iOS deep link into Settings ▸ General ▸ Keyboard ▸ Keyboards. */
const IOS_KEYBOARD_SETTINGS_URL = "App-Prefs:General&path=Keyboard/KEYBOARDS"
/** How long to watch for a default-keyboard change after the Android picker. */
const PICKER_POLL_INTERVAL_MS = 700
const PICKER_POLL_ATTEMPTS = 17

/** `null` means we have no signal (simulator, or a build without the keyboard plugin). */
export type KeyboardFlag = boolean | null

export interface KeyboardStatus {
  /**
   * The keyboard is fully set up: on iOS it has been shown once inside a host
   * app; on Android it is enabled and is the current default keyboard.
   */
  readonly ready: KeyboardFlag
  /** Android: opennib is switched on in the system keyboard list. iOS: null. */
  readonly enabled: KeyboardFlag
  /** Android: opennib is the system's default keyboard. iOS: null. */
  readonly isDefault: KeyboardFlag
  refresh(): Promise<void>
  /** Open the system screen where the keyboard is added or enabled. */
  openSettings(): Promise<void>
  /**
   * Android: show the system keyboard picker, then watch for the default to
   * change (the picker is a dialog, so the app never goes to the background
   * and `AppState` cannot tell us when to re-check). No-op on iOS.
   */
  showPicker(): Promise<void>
}

interface Snapshot {
  readonly ready: KeyboardFlag
  readonly enabled: KeyboardFlag
  readonly isDefault: KeyboardFlag
}

const UNKNOWN: Snapshot = { ready: null, enabled: null, isDefault: null }

async function readSnapshot(): Promise<Snapshot> {
  const setup = getKeyboardSetup()
  if (setup !== null) {
    const [enabled, isDefault] = await Promise.all([setup.isEnabled(), setup.isDefault()])
    return { ready: enabled && isDefault, enabled, isDefault }
  }
  const sharedGroup = getSharedGroup()
  if (sharedGroup !== null) {
    const activated = await sharedGroup.readKeyboardActivated()
    return { ready: activated, enabled: null, isDefault: null }
  }
  return UNKNOWN
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tracks keyboard setup state on both platforms. iOS is backed by the App
 * Group sentinel written by `KeyboardViewController.viewDidAppear`; Android
 * reads the system keyboard list and default-keyboard setting through
 * `OpennibKeyboardSetupModule`.
 */
export function useKeyboardStatus(): KeyboardStatus {
  const [snapshot, setSnapshot] = useState<Snapshot>(UNKNOWN)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await readSnapshot())
    } catch {
      // A failed read means "no signal", the same as a missing module.
      setSnapshot(UNKNOWN)
    }
  }, [])

  const openSettings = useCallback(async (): Promise<void> => {
    const setup = getKeyboardSetup()
    if (setup !== null) {
      await setup.openKeyboardSettings()
      return
    }
    if (Platform.OS === "ios") {
      try {
        await Linking.openURL(IOS_KEYBOARD_SETTINGS_URL)
        return
      } catch {
        // The App-Prefs scheme is undocumented; fall through to the app's page.
      }
    }
    await Linking.openSettings()
  }, [])

  const showPicker = useCallback(async (): Promise<void> => {
    const setup = getKeyboardSetup()
    if (setup === null) return
    await setup.showKeyboardPicker()
    for (let attempt = 0; attempt < PICKER_POLL_ATTEMPTS; attempt += 1) {
      await sleep(PICKER_POLL_INTERVAL_MS)
      if (await setup.isDefault()) break
    }
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...snapshot, refresh, openSettings, showPicker }
}
